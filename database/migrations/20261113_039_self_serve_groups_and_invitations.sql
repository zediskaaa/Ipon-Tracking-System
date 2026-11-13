-- Migration 20261113_039: Self-serve group creation, instant user registration with verified email, and interactive group invitation accept/decline.
begin;

-- 1. Allow any authenticated user (non-super-admin) to create a savings group and automatically become its Admin.
create or replace function public.admin_create_group(
  p_name text,
  p_avatar_url text default null,
  p_include_self boolean default true,
  p_monthly_amount numeric default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_new_group_id uuid;
  v_amount numeric := round(coalesce(p_monthly_amount, 100), 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if public.is_super_admin() then
    raise exception 'Super administrators manage platform access from the Super Admin console.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  if v_amount <= 0 or v_amount > 1000000 then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id, avatar_url, status)
  values (v_name, auth.uid(), p_avatar_url, 'ACTIVE')
  returning id into v_new_group_id;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_new_group_id, auth.uid(), 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  update public.profiles
  set group_id = v_new_group_id,
      role = 'ADMIN',
      status = 'ACTIVE',
      member_id = null
  where id = auth.uid();

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_new_group_id, date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date, v_amount, auth.uid());

  if p_include_self then
    perform public.set_admin_contributor(true, v_amount);
  end if;

  return v_new_group_id;
end;
$$;

revoke execute on function public.admin_create_group(text, text, boolean, numeric) from public, anon;
grant execute on function public.admin_create_group(text, text, boolean, numeric) to authenticated;

-- 2. Interactive acceptance of group invitations from notification.
create or replace function public.accept_group_invitation(p_notification_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notif record;
  v_group record;
  v_membership record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_notif
  from public.notifications
  where id = p_notification_id
    and recipient_id = auth.uid();

  if not found then
    raise exception 'Invitation notification not found.' using errcode = 'P0002';
  end if;

  if v_notif.group_id is null then
    raise exception 'This notification is not associated with a savings group.' using errcode = '22023';
  end if;

  select * into v_group
  from public.groups
  where id = v_notif.group_id and status = 'ACTIVE';

  if not found then
    raise exception 'The invited savings group is no longer active.' using errcode = 'P0002';
  end if;

  -- Activate or create group membership
  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_notif.group_id, auth.uid(), 'MEMBER', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set status = 'ACTIVE'
  returning * into v_membership;

  -- Set active group on profile if user has none
  update public.profiles
  set group_id = coalesce(group_id, v_notif.group_id),
      role = case when group_id is null then v_membership.role else role end,
      member_id = case when group_id is null then v_membership.member_id else member_id end,
      status = 'ACTIVE'
  where id = auth.uid();

  -- Mark notification as read
  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;

  return jsonb_build_object(
    'success', true,
    'group_id', v_notif.group_id,
    'group_name', v_group.name,
    'role', v_membership.role
  );
end;
$$;

revoke execute on function public.accept_group_invitation(bigint) from public, anon;
grant execute on function public.accept_group_invitation(bigint) to authenticated;

-- 3. Interactive declining of group invitations.
create or replace function public.decline_group_invitation(p_notification_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notif record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_notif
  from public.notifications
  where id = p_notification_id
    and recipient_id = auth.uid();

  if not found then
    raise exception 'Invitation notification not found.' using errcode = 'P0002';
  end if;

  if v_notif.group_id is not null then
    update public.group_memberships
    set status = 'REJECTED'
    where group_id = v_notif.group_id
      and user_id = auth.uid();
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function public.decline_group_invitation(bigint) from public, anon;
grant execute on function public.decline_group_invitation(bigint) to authenticated;

-- 4. Enable immediate active account creation for verified users.
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
  v_account_kind text := coalesce(new.raw_user_meta_data ->> 'account_kind', 'MANAGED');
  v_super_admin record;
  v_status public.account_status := 'PENDING';
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

  if v_account_kind = 'DIRECT_SIGNUP' or v_account_kind = 'MEMBER' then
    v_status := 'ACTIVE';
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

    -- Enforce email ownership verification
    if not exists (
      select 1 from public.email_verifications ev
      where lower(ev.email) = lower(new.email)
        and ev.purpose = 'ADMIN_REQUEST'
        and ev.verified_at is not null
        and ev.verified_at >= now() - interval '30 minutes'
    ) then
      raise exception 'Email ownership has not been verified. Please verify your email before submitting.' using errcode = '22023';
    end if;
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', v_status)
  on conflict (id) do nothing;

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

-- 5. Safe multi-group user access management
create or replace function public.admin_set_user_access(
  p_user_id uuid,
  p_role public.app_role,
  p_status public.account_status,
  p_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.app_role := public.current_user_role();
  v_actor_group uuid := public.current_group_id();
  v_member public.members;
  v_target public.profiles;
  v_link_member_id uuid;
begin
  if v_actor_role = 'SUPER_ADMIN' then
    if p_role not in ('SUPER_ADMIN', 'ADMIN') or p_member_id is not null then
      raise exception 'Super administrators can only manage platform administrator accounts.' using errcode = '42501';
    end if;
    if p_role = 'SUPER_ADMIN' and p_user_id <> auth.uid() then
      raise exception 'Additional super administrator accounts cannot be assigned here.' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() and (p_role <> 'SUPER_ADMIN' or p_status <> 'ACTIVE') then
      raise exception 'You cannot remove or disable your own super administrator access.' using errcode = '22023';
    end if;
    update public.profiles
    set role = p_role, status = p_status, member_id = null
    where id = p_user_id and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
    if not found then
      raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
    end if;
    return;
  end if;

  if v_actor_role <> 'ADMIN' or v_actor_group is null then
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() or p_role not in ('MEMBER', 'TREASURER') then
    raise exception 'Group administrators can only manage member and treasurer accounts in their own group.' using errcode = '42501';
  end if;

  if p_role = 'MEMBER' and p_status = 'ACTIVE' and p_member_id is null then
    raise exception 'Active member accounts must be linked to a member.' using errcode = '22023';
  end if;

  if p_role = 'TREASURER' and p_member_id is not null then
    raise exception 'Treasurer accounts cannot be linked to a member profile.' using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found or v_target.role = 'SUPER_ADMIN' then
    raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
  end if;

  v_link_member_id := case when p_role = 'MEMBER' then p_member_id else null end;

  if v_link_member_id is not null then
    select * into v_member from public.members
    where id = v_link_member_id and group_id = v_actor_group and deleted_at is null;
    if not found then
      raise exception 'The selected member does not belong to your savings group.' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.group_memberships gm
      where gm.group_id = v_actor_group
        and gm.member_id = v_link_member_id
        and gm.user_id <> p_user_id
    ) then
      raise exception 'That member already has a linked user account in this group.' using errcode = '22023';
    end if;
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_actor_group, p_user_id, p_role, p_status, v_link_member_id)
  on conflict (group_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      member_id = excluded.member_id;

  -- Update active profile context only when this user has no other active group selected and the change is active
  if (v_target.group_id is null or v_target.group_id = v_actor_group) and (p_status = 'ACTIVE' or v_target.status <> 'ACTIVE') then
    update public.profiles
    set role = p_role,
        status = case when v_target.status = 'ACTIVE' then 'ACTIVE' else p_status end,
        member_id = v_link_member_id,
        group_id = v_actor_group,
        first_name = coalesce(first_name, v_member.first_name),
        middle_name = coalesce(middle_name, v_member.middle_name),
        last_name = coalesce(last_name, v_member.last_name),
        full_name = coalesce(nullif(btrim(full_name), ''), v_member.full_name),
        contact_number = coalesce(contact_number, v_member.contact_number)
    where id = p_user_id;
  end if;
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) from public, anon;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;

-- 6. Record migration
insert into public.schema_migrations (version, name)
values ('20261113_039', 'self serve groups and interactive invitations')
on conflict (version) do nothing;

commit;
