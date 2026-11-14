-- Migration 067: Allow Super Admin own profile names to use lowercase and first-name-only while keeping strict formal name rules for all other accounts.
begin;

alter table public.profiles
  drop constraint if exists profiles_structured_name_consistent;

alter table public.profiles
  add constraint profiles_structured_name_consistent check (
    (first_name is null and middle_name is null and last_name is null)
    or (first_name is not null and (last_name is not null or role = 'SUPER_ADMIN'))
  );

create or replace function public.validated_name_part_mode(
  p_value text,
  p_label text,
  p_required boolean default true,
  p_formal boolean default true,
  p_allow_single_initial boolean default false
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
  if not p_allow_single_initial and v_letter_count < 2 then
    if p_formal then
      raise exception '% must contain at least 2 letters using formal capitalization.', p_label using errcode = '22023';
    end if;
    raise exception '% must contain at least 2 letters.', p_label using errcode = '22023';
  end if;

  if p_allow_single_initial and v_letter_count = 1 then
    if p_formal and v_value !~ '^[[:upper:]]$' then
      raise exception '% initial must be capitalized.', p_label using errcode = '22023';
    end if;
    return v_value;
  end if;

  if not p_formal then
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

create or replace function public.validated_name_part(
  p_value text,
  p_label text,
  p_required boolean default true
)
returns text
language sql
immutable
set search_path = public
as $$
  select public.validated_name_part_mode(p_value, p_label, p_required, true, not p_required);
$$;

create or replace function public.enforce_data_quality()
returns trigger
language plpgsql
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_is_super_admin boolean := false;
begin
  if tg_table_name = 'profiles' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name
        or new.role is distinct from old.role)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      v_is_super_admin := (new.role = 'SUPER_ADMIN');
      new.first_name := public.validated_name_part_mode(new.first_name, 'First name', true, not v_is_super_admin, false);
      new.middle_name := public.validated_name_part_mode(new.middle_name, 'Middle name', false, not v_is_super_admin, true);
      new.last_name := public.validated_name_part_mode(new.last_name, 'Last name', not v_is_super_admin, not v_is_super_admin, false);
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
  v_role public.app_role;
  v_is_super_admin boolean := false;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
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
  select p.role
  into v_role
  from public.profiles p
  where p.id = auth.uid()
    and p.status = 'ACTIVE';

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  v_is_super_admin := (v_role = 'SUPER_ADMIN');
  v_first := public.validated_name_part_mode(p_first_name, 'First name', true, not v_is_super_admin, false);
  v_middle := public.validated_name_part_mode(p_middle_name, 'Middle name', false, not v_is_super_admin, true);
  v_last := public.validated_name_part_mode(p_last_name, 'Last name', not v_is_super_admin, not v_is_super_admin, false);
  v_full := concat_ws(' ', v_first, v_middle, v_last);
  if char_length(v_full) > 150 then
    raise exception 'Full name must not exceed 150 characters.' using errcode = '22023';
  end if;

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

  if not v_is_super_admin then
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
  end if;

  if not v_is_super_admin and v_update_payout and v_active_group is not null then
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

revoke execute on function public.update_own_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text, text, text, text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261115_067', 'super admin flexible name')
on conflict (version) do nothing;

commit;

