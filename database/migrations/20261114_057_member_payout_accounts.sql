-- Migration 057: Member Payout Account Info (optional e-wallet / bank cashout destination on profiles & members)

begin;

alter table public.profiles
  add column if not exists payout_channel text,
  add column if not exists payout_account_number text,
  add column if not exists payout_account_name text;

alter table public.profiles
  drop constraint if exists profiles_payout_channel_check;
alter table public.profiles
  add constraint profiles_payout_channel_check
  check (payout_channel is null or payout_channel in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

alter table public.profiles
  drop constraint if exists profiles_payout_account_number_len;
alter table public.profiles
  add constraint profiles_payout_account_number_len
  check (payout_account_number is null or char_length(btrim(payout_account_number)) <= 80);

alter table public.profiles
  drop constraint if exists profiles_payout_account_name_len;
alter table public.profiles
  add constraint profiles_payout_account_name_len
  check (payout_account_name is null or char_length(btrim(payout_account_name)) <= 120);

alter table public.members
  add column if not exists payout_channel text,
  add column if not exists payout_account_number text,
  add column if not exists payout_account_name text;

alter table public.members
  drop constraint if exists members_payout_channel_check;
alter table public.members
  add constraint members_payout_channel_check
  check (payout_channel is null or payout_channel in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

alter table public.members
  drop constraint if exists members_payout_account_number_len;
alter table public.members
  add constraint members_payout_account_number_len
  check (payout_account_number is null or char_length(btrim(payout_account_number)) <= 80);

alter table public.members
  drop constraint if exists members_payout_account_name_len;
alter table public.members
  add constraint members_payout_account_name_len
  check (payout_account_name is null or char_length(btrim(payout_account_name)) <= 120);

create or replace function public.validated_payout_account(
  p_channel text,
  p_account_number text,
  p_account_name text
)
returns table (
  out_channel text,
  out_account_number text,
  out_account_name text
)
language plpgsql
immutable
as $$
declare
  v_channel text := public.normalized_payment_method(p_channel);
  v_number text := nullif(btrim(coalesce(p_account_number, '')), '');
  v_name text := nullif(btrim(coalesce(p_account_name, '')), '');
begin
  if v_number is not null and char_length(v_number) > 80 then
    raise exception 'Payout account number must not exceed 80 characters.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Payout account name must not exceed 120 characters.' using errcode = '22023';
  end if;
  if v_channel is null and (v_number is not null or v_name is not null) then
    raise exception 'Select a payout channel before saving account details.' using errcode = '22023';
  end if;
  if v_channel in ('GCASH', 'MAYA', 'BANK_TRANSFER') and v_number is null then
    raise exception 'Enter an account or mobile number for % payouts.',
      replace(initcap(replace(v_channel, '_', ' ')), 'Gcash', 'GCash')
      using errcode = '22023';
  end if;

  out_channel := v_channel;
  out_account_number := v_number;
  out_account_name := v_name;
  return next;
end;
$$;

drop function if exists public.create_member(text, text, text, text, date, numeric, text);
drop function if exists public.create_member(text, text, text, text, date, numeric, text, text, text, text);

create or replace function public.create_member(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_date_registered date,
  p_monthly_contribution_amount numeric,
  p_notes text default null,
  p_payout_channel text default null,
  p_payout_account_number text default null,
  p_payout_account_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_payout_channel text;
  v_payout_number text;
  v_payout_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can create members.' using errcode = '42501';
  end if;

  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  select vp.out_channel, vp.out_account_number, vp.out_account_name
  into v_payout_channel, v_payout_number, v_payout_name
  from public.validated_payout_account(p_payout_channel, p_payout_account_number, p_payout_account_name) vp;

  insert into public.members (
    full_name, first_name, middle_name, last_name, contact_number, date_registered,
    monthly_contribution_amount, notes,
    payout_channel, payout_account_number, payout_account_name,
    created_by, updated_by
  ) values (
    concat_ws(' ', v_first_name, v_middle_name, v_last_name), v_first_name, v_middle_name, v_last_name,
    public.normalize_ph_mobile(p_contact_number), p_date_registered,
    public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'),
    nullif(btrim(p_notes), ''),
    v_payout_channel, v_payout_number, v_payout_name,
    auth.uid(), auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.update_member(uuid, text, text, text, text, numeric, text);
drop function if exists public.update_member(uuid, text, text, text, text, numeric, text, text, text, text);

create or replace function public.update_member(
  p_member_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_monthly_contribution_amount numeric,
  p_notes text,
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
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_update_payout boolean := (
    coalesce(p_payout_channel, '') <> '__KEEP__'
    or coalesce(p_payout_account_number, '') <> '__KEEP__'
    or coalesce(p_payout_account_name, '') <> '__KEEP__'
  );
  v_payout_channel text;
  v_payout_number text;
  v_payout_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can update members.' using errcode = '42501';
  end if;

  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  if v_update_payout then
    select vp.out_channel, vp.out_account_number, vp.out_account_name
    into v_payout_channel, v_payout_number, v_payout_name
    from public.validated_payout_account(
      case when p_payout_channel = '__KEEP__' then null else p_payout_channel end,
      case when p_payout_account_number = '__KEEP__' then null else p_payout_account_number end,
      case when p_payout_account_name = '__KEEP__' then null else p_payout_account_name end
    ) vp;
  end if;

  update public.members
  set full_name = concat_ws(' ', v_first_name, v_middle_name, v_last_name),
      first_name = v_first_name,
      middle_name = v_middle_name,
      last_name = v_last_name,
      contact_number = public.normalize_ph_mobile(p_contact_number),
      monthly_contribution_amount = public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'),
      notes = nullif(btrim(p_notes), ''),
      payout_channel = case when v_update_payout then v_payout_channel else payout_channel end,
      payout_account_number = case when v_update_payout then v_payout_number else payout_account_number end,
      payout_account_name = case when v_update_payout then v_payout_name else payout_account_name end,
      updated_by = auth.uid()
  where id = p_member_id
    and group_id = public.current_group_id()
    and deleted_at is null;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  if v_update_payout then
    update public.profiles
    set payout_channel = v_payout_channel,
        payout_account_number = v_payout_number,
        payout_account_name = v_payout_name
    where member_id = p_member_id;
  end if;
end;
$$;

drop function if exists public.update_own_profile(text, text, text, text);
drop function if exists public.update_own_profile(text, text, text, text, text, text, text);

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
      full_name = concat_ws(' ', v_first, v_middle, v_last),
      contact_number = v_contact,
      payout_channel = case when v_update_payout then v_payout_channel else payout_channel end,
      payout_account_number = case when v_update_payout then v_payout_number else payout_account_number end,
      payout_account_name = case when v_update_payout then v_payout_name else payout_account_name end
  where id = auth.uid() and status = 'ACTIVE'
  returning member_id into v_member_id;

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

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

revoke execute on function public.validated_payout_account(text, text, text) from public, anon;
revoke execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) from public, anon;
revoke execute on function public.update_member(uuid, text, text, text, text, numeric, text, text, text, text) from public, anon;
revoke execute on function public.update_own_profile(text, text, text, text, text, text, text) from public, anon;

grant execute on function public.validated_payout_account(text, text, text) to authenticated;
grant execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) to authenticated;
grant execute on function public.update_member(uuid, text, text, text, text, numeric, text, text, text, text) to authenticated;
grant execute on function public.update_own_profile(text, text, text, text, text, text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_057', 'add optional member and profile payout account fields')
on conflict (version) do nothing;

commit;

