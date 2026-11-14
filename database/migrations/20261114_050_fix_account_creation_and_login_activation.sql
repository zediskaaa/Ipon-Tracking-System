-- Migration 050: Reliable self-serve account activation & recovery on sign-in
begin;

create or replace function public.activate_own_pending_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_auth record;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
  v_contact text;
  v_membership record;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid;

  if not found then
    select id, email, raw_user_meta_data
    into v_auth
    from auth.users
    where id = v_uid;

    if not found then
      raise exception 'User account not found.' using errcode = 'P0002';
    end if;

    begin
      if nullif(btrim(v_auth.raw_user_meta_data ->> 'first_name'), '') is not null
         and nullif(btrim(v_auth.raw_user_meta_data ->> 'last_name'), '') is not null then
        v_first := public.validated_name_part(v_auth.raw_user_meta_data ->> 'first_name', 'First name');
        v_middle := public.validated_name_part(v_auth.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
        v_last := public.validated_name_part(v_auth.raw_user_meta_data ->> 'last_name', 'Last name');
        v_full := concat_ws(' ', v_first, v_middle, v_last);
      end if;
    exception when others then
      v_first := null;
      v_middle := null;
      v_last := null;
    end;

    if v_full is null then
      v_full := coalesce(
        nullif(btrim(v_auth.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(split_part(coalesce(v_auth.email, ''), '@', 1)), ''),
        'New User'
      );
    end if;

    v_contact := public.normalize_ph_mobile(v_auth.raw_user_meta_data ->> 'contact_number');

    insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
    values (v_uid, v_full, v_first, v_middle, v_last, lower(v_auth.email), v_contact, 'MEMBER', 'ACTIVE')
    on conflict (id) do nothing;

    select * into v_profile
    from public.profiles
    where id = v_uid;
  end if;

  if v_profile.status = 'DISABLED' then
    raise exception 'Your account is deactivated or disabled.' using errcode = '42501';
  end if;

  update public.group_memberships
  set status = 'ACTIVE'
  where user_id = v_uid
    and status = 'PENDING';

  select gm.group_id, gm.role, gm.member_id
  into v_membership
  from public.group_memberships gm
  where gm.user_id = v_uid
    and gm.status = 'ACTIVE'
  order by gm.created_at desc
  limit 1;

  if v_profile.status <> 'ACTIVE' or (v_profile.group_id is null and v_membership.group_id is not null) then
    update public.profiles
    set status = 'ACTIVE',
        group_id = coalesce(group_id, v_membership.group_id),
        role = case when group_id is null and v_membership.group_id is not null then coalesce(v_membership.role, role) else role end,
        member_id = coalesce(member_id, case when group_id is null then v_membership.member_id else null end)
    where id = v_uid
      and status <> 'DISABLED'
    returning * into v_profile;
  end if;

  return jsonb_build_object(
    'id', v_profile.id,
    'role', v_profile.role,
    'status', v_profile.status,
    'group_id', v_profile.group_id,
    'member_id', v_profile.member_id,
    'first_name', v_profile.first_name,
    'last_name', v_profile.last_name,
    'contact_number', v_profile.contact_number
  );
end;
$$;

revoke execute on function public.activate_own_pending_account() from public, anon;
grant execute on function public.activate_own_pending_account() to authenticated;

-- Sync latest trigger from 042 in case an older deployment still created PENDING direct signups
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_full_name text;
  v_contact text;
  v_reason text;
  v_account_kind text := coalesce(new.raw_user_meta_data ->> 'account_kind', 'DIRECT_SIGNUP');
  v_super_admin record;
  v_status public.account_status := 'ACTIVE';
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '') is not null
     and nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '') is not null then
    v_first_name := public.validated_name_part(new.raw_user_meta_data ->> 'first_name', 'First name');
    v_middle_name := public.validated_name_part(new.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
    v_last_name := public.validated_name_part(new.raw_user_meta_data ->> 'last_name', 'Last name');
    v_full_name := concat_ws(' ', v_first_name, v_middle_name, v_last_name);
  else
    v_full_name := case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2 then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2 then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end;
  end if;

  v_contact := public.normalize_ph_mobile(new.raw_user_meta_data ->> 'contact_number');
  v_reason := nullif(btrim(new.raw_user_meta_data ->> 'request_reason'), '');

  if v_account_kind = 'DISABLED' then
    v_status := 'DISABLED';
  elsif v_account_kind = 'ADMIN_REQUEST' then
    if exists (
      select 1 from public.admin_requests ar
      where lower(ar.email) = lower(new.email)
        and ar.status = 'REJECTED'
    ) or exists (
      select 1 from public.profiles p
      where lower(p.email) = lower(new.email)
        and p.status = 'DISABLED'
        and p.role = 'MEMBER'
    ) then
      raise exception 'This email address was declined for administrator access and cannot request again.' using errcode = '22023';
    end if;

    if v_contact is null or v_reason is null or char_length(v_reason) < 10 then
      raise exception 'Administrator requests require a contact number and a reason of at least 10 characters.' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.email_verifications ev
      where lower(ev.email) = lower(new.email)
        and ev.purpose = 'ADMIN_REQUEST'
        and ev.verified_at is not null
        and ev.verified_at >= now() - interval '30 minutes'
    ) then
      raise exception 'Email ownership has not been verified. Please verify your email before submitting.' using errcode = '22023';
    end if;
    v_status := 'PENDING';
  elsif v_account_kind in ('INVITED', 'MANAGED') then
    v_status := 'PENDING';
  else
    v_status := 'ACTIVE';
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', v_status)
  on conflict (id) do update set
    status = case when v_account_kind in ('INVITED', 'MANAGED') then 'PENDING' when public.profiles.status = 'PENDING' then 'ACTIVE' else public.profiles.status end,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    contact_number = coalesce(public.profiles.contact_number, excluded.contact_number);

  if v_account_kind = 'ADMIN_REQUEST' then
    insert into public.admin_requests (requester_id, email, contact_number, reason)
    values (new.id, lower(new.email), v_contact, v_reason);

    for v_super_admin in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_super_admin.id, 'ADMIN_REQUEST', 'New administrator request', v_full_name || ' requested administrator access.', 'super-admin.html#requests');
    end loop;
  end if;
  return new;
end;
$$;

-- Activate any non-disabled orphaned pending profiles from direct signups
update public.profiles p
set status = 'ACTIVE'
where p.status = 'PENDING'
  and not exists (
    select 1 from public.admin_requests ar
    where ar.requester_id = p.id
      and ar.status in ('PENDING', 'REJECTED')
  );

insert into public.schema_migrations (version, name)
values ('20261114_050', 'fix account creation and login activation')
on conflict (version) do nothing;

commit;

