-- Add structured profile/member names while preserving full_name compatibility.

begin;

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text;

alter table public.members
  add column if not exists first_name text,
  add column if not exists middle_name text,
  add column if not exists last_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_structured_name_consistent'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles add constraint profiles_structured_name_consistent check (
      (first_name is null and middle_name is null and last_name is null)
      or (first_name is not null and last_name is not null)
    ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'members_structured_name_consistent'
      and conrelid = 'public.members'::regclass
  ) then
    alter table public.members add constraint members_structured_name_consistent check (
      (first_name is null and middle_name is null and last_name is null)
      or (first_name is not null and last_name is not null)
    ) not valid;
  end if;
end $$;

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
  if v_value !~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$name$ then
    raise exception '% may contain only letters, spaces, hyphens, and apostrophes.', p_label using errcode = '22023';
  end if;
  return v_value;
end;
$$;

with candidates as (
  select id, regexp_split_to_array(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g'), ' ') as parts
  from public.profiles
  where first_name is null and middle_name is null and last_name is null
), safe_names as (
  select id, parts[1] as first_name, parts[2] as last_name
  from candidates
  where cardinality(parts) = 2
    and char_length(parts[1]) <= 80
    and char_length(parts[2]) <= 80
    and parts[1] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$name$
    and parts[2] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$name$
)
update public.profiles p
set first_name = s.first_name, last_name = s.last_name
from safe_names s
where p.id = s.id;

with candidates as (
  select id, regexp_split_to_array(regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g'), ' ') as parts
  from public.members
  where first_name is null and middle_name is null and last_name is null
), safe_names as (
  select id, parts[1] as first_name, parts[2] as last_name
  from candidates
  where cardinality(parts) = 2
    and char_length(parts[1]) <= 80
    and char_length(parts[2]) <= 80
    and parts[1] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$name$
    and parts[2] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$name$
)
update public.members m
set first_name = s.first_name, last_name = s.last_name
from safe_names s
where m.id = s.id;

alter table public.profiles validate constraint profiles_structured_name_consistent;
alter table public.members validate constraint members_structured_name_consistent;

create or replace function public.enforce_data_quality()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    if new.first_name is not null or new.middle_name is not null or new.last_name is not null then
      new.first_name := public.validated_name_part(new.first_name, 'First name');
      new.middle_name := public.validated_name_part(new.middle_name, 'Middle name', false);
      new.last_name := public.validated_name_part(new.last_name, 'Last name');
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
      if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    end if;
  elsif tg_table_name = 'members' then
    if new.first_name is not null or new.middle_name is not null or new.last_name is not null then
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
  v_is_first boolean;
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_full_name text;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

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

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, role, status)
  values (
    new.id, v_full_name, v_first_name, v_middle_name, v_last_name,
    case when v_is_first then 'ADMIN'::public.app_role else 'MEMBER'::public.app_role end,
    case when v_is_first then 'ACTIVE'::public.account_status else 'PENDING'::public.account_status end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'members', 'contribution_settings', 'contribution_periods',
    'contributions', 'expenses', 'withdrawals', 'savings_goals'
  ] loop
    execute format('drop trigger if exists %I_data_quality on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_data_quality before insert or update on public.%I for each row execute function public.enforce_data_quality()',
      table_name,
      table_name
    );
  end loop;
end $$;

drop function if exists public.create_member(text, text, date, numeric, text);

create or replace function public.create_member(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_date_registered date,
  p_monthly_contribution_amount numeric,
  p_notes text default null
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
begin
  if not public.is_admin() then raise exception 'Only an administrator can create members.' using errcode = '42501'; end if;
  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  insert into public.members (
    full_name, first_name, middle_name, last_name, contact_number, date_registered,
    monthly_contribution_amount, notes, created_by, updated_by
  ) values (
    concat_ws(' ', v_first_name, v_middle_name, v_last_name), v_first_name, v_middle_name, v_last_name,
    public.normalize_ph_mobile(p_contact_number), p_date_registered,
    public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'),
    nullif(btrim(p_notes), ''), auth.uid(), auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.update_member(uuid, text, text, numeric, text);

create or replace function public.update_member(
  p_member_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_monthly_contribution_amount numeric,
  p_notes text
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
begin
  if not public.is_admin() then raise exception 'Only an administrator can update members.' using errcode = '42501'; end if;
  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  update public.members
  set full_name = concat_ws(' ', v_first_name, v_middle_name, v_last_name),
      first_name = v_first_name,
      middle_name = v_middle_name,
      last_name = v_last_name,
      contact_number = public.normalize_ph_mobile(p_contact_number),
      monthly_contribution_amount = public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'),
      notes = nullif(btrim(p_notes), ''),
      updated_by = auth.uid()
  where id = p_member_id;
  if not found then raise exception 'Member not found.' using errcode = 'P0002'; end if;
end;
$$;

revoke execute on function public.create_member(text, text, text, text, date, numeric, text) from public, anon;
revoke execute on function public.update_member(uuid, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.create_member(text, text, text, text, date, numeric, text) to authenticated;
grant execute on function public.update_member(uuid, text, text, text, text, numeric, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261110_002', 'structured profile and member names')
on conflict (version) do nothing;

commit;
