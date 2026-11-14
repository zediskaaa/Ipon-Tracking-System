-- Migration 064: Enforce formal capitalization on names and track mandatory name setup for optional-name invites
begin;

alter table public.profiles
  add column if not exists name_setup_required boolean not null default false;

create or replace function public.validated_name_part(
  p_value text,
  p_label text,
  p_required boolean default true
)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_value text := regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g');
  v_words text[];
  v_word text;
  v_segments text[];
  v_seg text;
  v_idx integer;
  v_word_count integer;
  v_letter_count integer;
  v_particles constant text[] := array[
    'de', 'del', 'dela', 'los', 'las', 'la', 'le', 'da', 'di', 'do', 'dos', 'das',
    'van', 'von', 'den', 'der', 'ter', 'ten', 'ben', 'bin', 'binti', 'ibn', 'al'
  ];
begin
  if v_value = '' then
    if p_required then
      raise exception '% is required.', p_label using errcode = '22023';
    end if;
    return null;
  end if;
  if char_length(v_value) > 80 then
    raise exception '% must not exceed 80 characters.', p_label using errcode = '22023';
  end if;
  if v_value !~ '^[[:alpha:]]+([ ''’-][[:alpha:]]+)*$' then
    raise exception '% may contain only letters, spaces, hyphens, and apostrophes.', p_label using errcode = '22023';
  end if;

  v_letter_count := char_length(regexp_replace(v_value, '[^[:alpha:]]', '', 'g'));
  if p_required and v_letter_count < 2 then
    raise exception '% must contain at least 2 letters using formal capitalization.', p_label using errcode = '22023';
  end if;

  if not p_required and v_letter_count = 1 then
    if v_value !~ '^[[:upper:]]$' then
      raise exception '% initial must be capitalized.', p_label using errcode = '22023';
    end if;
    return v_value;
  end if;

  v_words := string_to_array(v_value, ' ');
  v_word_count := coalesce(array_length(v_words, 1), 0);

  for v_idx in 1..v_word_count loop
    v_word := v_words[v_idx];

    if v_idx > 1 and v_idx < v_word_count and v_word = any(v_particles) then
      continue;
    end if;

    if v_idx > 1 and v_idx = v_word_count and v_word ~ '^(II|III|IV|V|VI|VII|VIII|IX|X)$' then
      continue;
    end if;

    v_segments := regexp_split_to_array(v_word, '[''’-]');
    foreach v_seg in array v_segments loop
      if v_seg = '' then
        raise exception '% may contain only letters, spaces, hyphens, and apostrophes.', p_label using errcode = '22023';
      end if;

      if char_length(v_seg) = 1 then
        if array_length(v_segments, 1) > 1 and v_seg ~ '^[[:upper:]]$' then
          continue;
        end if;
        raise exception '% must use formal capitalization (e.g., Juan Dela Cruz). Do not use ALL CAPS or all lowercase.', p_label using errcode = '22023';
      end if;

      if v_seg !~ '^[[:upper:]][[:lower:]]+([[:upper:]][[:lower:]]+)*$' then
        raise exception '% must use formal capitalization (e.g., Juan Dela Cruz). Do not use ALL CAPS or all lowercase.', p_label using errcode = '22023';
      end if;
    end loop;
  end loop;

  return v_value;
end;
$$;

create or replace function public.enforce_data_quality()
returns trigger
language plpgsql
set search_path = public
set timezone = 'Asia/Manila'
as $$
begin
  if tg_table_name = 'profiles' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      new.first_name := public.validated_name_part(new.first_name, 'First name');
      new.middle_name := public.validated_name_part(new.middle_name, 'Middle name', false);
      new.last_name := public.validated_name_part(new.last_name, 'Last name');
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
      if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    end if;
  elsif tg_table_name = 'members' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      new.first_name := public.validated_name_part(new.first_name, 'First name');
      new.middle_name := public.validated_name_part(new.middle_name, 'Middle name', false);
      new.last_name := public.validated_name_part(new.last_name, 'Last name');
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
    end if;
    if nullif(btrim(new.full_name), '') is null then raise exception 'Full name is required.' using errcode = '22023'; end if;
    if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 1000 then raise exception 'Notes must not exceed 1000 characters.' using errcode = '22023'; end if;
    if new.date_registered < date '2000-01-01' or new.date_registered > current_date then raise exception 'Date registered must be between 2000-01-01 and today.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contribution_settings' then
    if new.effective_month < date '2000-01-01' or new.effective_month > date '2100-12-01' then raise exception 'Effective month must be between January 2000 and December 2100.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contribution_periods' then
    if new.period_month < date '2000-01-01' or new.period_month > date '2100-12-01' then raise exception 'Contribution month must be between January 2000 and December 2100.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contributions' then
    if new.payment_date < date '2000-01-01' or new.payment_date > current_date then raise exception 'Date added must be between 2000-01-01 and today.' using errcode = '22023'; end if;
    if char_length(coalesce(new.transaction_reference, '')) > 100 then raise exception 'Reference must not exceed 100 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 1000 then raise exception 'Notes must not exceed 1000 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.review_note, '')) > 500 then raise exception 'Review note must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.void_reason, '')) > 500 then raise exception 'Void reason must not exceed 500 characters.' using errcode = '22023'; end if;
  elsif tg_table_name in ('expenses', 'withdrawals') then
    if new.transaction_date < date '2000-01-01' or new.transaction_date > current_date then raise exception 'Transaction date must be between 2000-01-01 and today.' using errcode = '22023'; end if;
    if nullif(btrim(new.category), '') is null then raise exception 'Category is required.' using errcode = '22023'; end if;
    if nullif(btrim(new.description), '') is null then raise exception 'Description is required.' using errcode = '22023'; end if;
    if nullif(btrim(new.person_responsible), '') is null then raise exception 'Person responsible is required.' using errcode = '22023'; end if;
    if char_length(new.category) > 80 then raise exception 'Category must not exceed 80 characters.' using errcode = '22023'; end if;
    if char_length(new.description) > 500 then raise exception 'Description must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(new.person_responsible) > 150 then raise exception 'Person responsible must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.reference_number, '')) > 100 then raise exception 'Reference must not exceed 100 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 1000 then raise exception 'Notes must not exceed 1000 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.review_note, '')) > 500 then raise exception 'Review note must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.void_reason, '')) > 500 then raise exception 'Void reason must not exceed 500 characters.' using errcode = '22023'; end if;
  elsif tg_table_name = 'savings_goals' then
    if nullif(btrim(new.title), '') is null then raise exception 'Goal title is required.' using errcode = '22023'; end if;
    if char_length(new.title) > 150 then raise exception 'Goal title must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 1000 then raise exception 'Notes must not exceed 1000 characters.' using errcode = '22023'; end if;
    if new.target_date is not null and (new.target_date < date '2000-01-01' or new.target_date > date '2100-12-31') then raise exception 'Target date must be between 2000-01-01 and 2100-12-31.' using errcode = '22023'; end if;
  end if;
  return new;
end;
$$;

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
  v_name_setup_required boolean := coalesce((new.raw_user_meta_data ->> 'name_setup_required')::boolean, false);
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
    v_name_setup_required := true;
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

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status, name_setup_required)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', v_status, v_name_setup_required)
  on conflict (id) do update set
    status = case when v_account_kind in ('INVITED', 'MANAGED') then 'PENDING' when public.profiles.status = 'PENDING' then 'ACTIVE' else public.profiles.status end,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    contact_number = coalesce(public.profiles.contact_number, excluded.contact_number),
    name_setup_required = public.profiles.name_setup_required or excluded.name_setup_required;

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
  v_name_setup_required boolean := false;
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

    v_name_setup_required := coalesce((v_auth.raw_user_meta_data ->> 'name_setup_required')::boolean, false);

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
      v_name_setup_required := true;
    end;

    if v_full is null then
      v_full := coalesce(
        nullif(btrim(v_auth.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(split_part(coalesce(v_auth.email, ''), '@', 1)), ''),
        'New User'
      );
      v_name_setup_required := true;
    end if;

    v_contact := public.normalize_ph_mobile(v_auth.raw_user_meta_data ->> 'contact_number');

    insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status, name_setup_required)
    values (v_uid, v_full, v_first, v_middle, v_last, lower(v_auth.email), v_contact, 'MEMBER', 'ACTIVE', v_name_setup_required)
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
    'middle_name', v_profile.middle_name,
    'last_name', v_profile.last_name,
    'contact_number', v_profile.contact_number,
    'name_setup_required', coalesce(v_profile.name_setup_required, false)
  );
end;
$$;

create or replace function public.update_own_profile(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_payout_channel text default '__KEEP__',
  p_payout_account_number text default '__KEEP__',
  p_payout_account_name text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.validated_name_part(p_first_name, 'First name');
  v_middle text := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last text := public.validated_name_part(p_last_name, 'Last name');
  v_full text := concat_ws(' ', v_first, v_middle, v_last);
  v_contact text := public.normalize_ph_mobile(p_contact_number);
  v_member_id uuid;
  v_active_group uuid := public.current_group_id();
  v_update_payout boolean := (
    coalesce(p_payout_channel, '') <> '__KEEP__'
    or coalesce(p_payout_account_number, '') <> '__KEEP__'
    or coalesce(p_payout_account_name, '') <> '__KEEP__'
  );
  v_payout_channel text;
  v_payout_number text;
  v_payout_name text;
begin
  if v_contact is null then
    raise exception 'Mobile number is required.' using errcode = '22023';
  end if;

  if v_update_payout then
    select vp.out_channel, vp.out_account_number, vp.out_account_name
    into v_payout_channel, v_payout_number, v_payout_name
    from public.validated_payout_account(
      case when p_payout_channel = '__KEEP__' then null else p_payout_channel end,
      case when p_payout_account_number = '__KEEP__' then null else p_payout_account_number end,
      case when p_payout_account_name = '__KEEP__' then null else p_payout_account_name end
    ) vp;
  end if;

  update public.profiles
  set first_name = v_first,
      middle_name = v_middle,
      last_name = v_last,
      full_name = v_full,
      contact_number = v_contact,
      name_setup_required = false,
      payout_channel = case when v_update_payout then v_payout_channel else payout_channel end,
      payout_account_number = case when v_update_payout then v_payout_number else payout_account_number end,
      payout_account_name = case when v_update_payout then v_payout_name else payout_account_name end
  where id = auth.uid() and status = 'ACTIVE'
  returning member_id into v_member_id;

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  update public.members m
  set first_name = v_first,
      middle_name = v_middle,
      last_name = v_last,
      full_name = v_full,
      contact_number = case when m.contact_number = '09000000000' then v_contact else m.contact_number end,
      updated_by = auth.uid()
  where m.deleted_at is null
    and (
      m.id = v_member_id
      or m.id in (
        select gm.member_id
        from public.group_memberships gm
        where gm.user_id = auth.uid()
          and gm.member_id is not null
      )
    );

  if v_update_payout and v_active_group is not null then
    update public.members m
    set payout_channel = v_payout_channel,
        payout_account_number = v_payout_number,
        payout_account_name = v_payout_name,
        updated_by = auth.uid()
    where m.group_id = v_active_group
      and m.deleted_at is null
      and (
        m.id = v_member_id
        or m.id in (
          select gm.member_id
          from public.group_memberships gm
          where gm.user_id = auth.uid()
            and gm.group_id = v_active_group
            and gm.member_id is not null
        )
      );
  end if;

  insert into public.account_activity (user_id, event)
  values (auth.uid(), 'PROFILE_UPDATE');
end;
$$;

revoke execute on function public.activate_own_pending_account() from public, anon;
grant execute on function public.activate_own_pending_account() to authenticated;

revoke execute on function public.update_own_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text, text, text, text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_064', 'formal names and invite onboarding')
on conflict (version) do nothing;

commit;

