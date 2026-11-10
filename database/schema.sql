-- IPON Tracking System - Supabase PostgreSQL schema
-- Run this entire file in the Supabase SQL Editor on a new project.

begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.account_status as enum ('PENDING', 'ACTIVE', 'DISABLED');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.member_status as enum ('ACTIVE', 'INACTIVE');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.approval_status as enum ('PENDING', 'CONFIRMED', 'REJECTED', 'VOIDED');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.goal_status as enum ('ACTIVE', 'COMPLETED', 'CANCELLED');
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 150),
  first_name text,
  middle_name text,
  last_name text,
  role public.app_role not null default 'MEMBER',
  status public.account_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_structured_name_consistent check (
    (first_name is null and middle_name is null and last_name is null)
    or (first_name is not null and last_name is not null)
  )
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 150),
  first_name text,
  middle_name text,
  last_name text,
  contact_number text,
  date_registered date not null default current_date,
  monthly_contribution_amount numeric(14,2) not null check (monthly_contribution_amount > 0),
  status public.member_status not null default 'ACTIVE',
  notes text,
  deactivated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint members_contact_number_format check (
    contact_number is null or contact_number ~ '^09[0-9]{9}$'
  ),
  constraint members_structured_name_consistent check (
    (first_name is null and middle_name is null and last_name is null)
    or (first_name is not null and last_name is not null)
  ),
  constraint members_deactivation_consistent check (
    (status = 'ACTIVE' and deactivated_at is null)
    or (status = 'INACTIVE' and deactivated_at is not null)
  )
);

alter table public.profiles
  add column if not exists member_id uuid unique references public.members(id) on delete set null;

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

create table if not exists public.contribution_settings (
  id uuid primary key default gen_random_uuid(),
  effective_month date not null unique,
  default_amount numeric(14,2) not null check (default_amount > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint contribution_settings_month_start check (
    effective_month = date_trunc('month', effective_month)::date
  )
);

create table if not exists public.contribution_periods (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete restrict,
  period_month date not null,
  required_amount numeric(14,2) not null check (required_amount > 0),
  created_at timestamptz not null default now(),
  constraint contribution_periods_month_start check (
    period_month = date_trunc('month', period_month)::date
  ),
  constraint contribution_periods_member_month_unique unique (member_id, period_month)
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  contribution_period_id uuid not null references public.contribution_periods(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null default current_date,
  transaction_reference text,
  idempotency_key uuid not null unique default gen_random_uuid(),
  notes text,
  approval_status public.approval_status not null default 'PENDING',
  submitted_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contributions_review_consistent check (
    (approval_status = 'PENDING' and reviewed_by is null and reviewed_at is null)
    or (approval_status in ('CONFIRMED', 'REJECTED', 'VOIDED') and reviewed_at is not null)
  ),
  constraint contributions_void_consistent check (
    (approval_status <> 'VOIDED' and voided_by is null and voided_at is null and void_reason is null)
    or (approval_status = 'VOIDED' and voided_at is not null and nullif(btrim(void_reason), '') is not null)
  )
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  transaction_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  category text not null check (nullif(btrim(category), '') is not null),
  description text not null check (nullif(btrim(description), '') is not null),
  person_responsible text not null check (nullif(btrim(person_responsible), '') is not null),
  reference_number text,
  idempotency_key uuid not null unique default gen_random_uuid(),
  notes text,
  approval_status public.approval_status not null default 'PENDING',
  submitted_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_review_consistent check (
    (approval_status = 'PENDING' and reviewed_by is null and reviewed_at is null)
    or (approval_status in ('CONFIRMED', 'REJECTED', 'VOIDED') and reviewed_at is not null)
  ),
  constraint expenses_void_consistent check (
    (approval_status <> 'VOIDED' and voided_by is null and voided_at is null and void_reason is null)
    or (approval_status = 'VOIDED' and voided_at is not null and nullif(btrim(void_reason), '') is not null)
  )
);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  transaction_date date not null default current_date,
  amount numeric(14,2) not null check (amount > 0),
  category text not null check (nullif(btrim(category), '') is not null),
  description text not null check (nullif(btrim(description), '') is not null),
  person_responsible text not null check (nullif(btrim(person_responsible), '') is not null),
  reference_number text,
  idempotency_key uuid not null unique default gen_random_uuid(),
  notes text,
  approval_status public.approval_status not null default 'PENDING',
  submitted_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint withdrawals_review_consistent check (
    (approval_status = 'PENDING' and reviewed_by is null and reviewed_at is null)
    or (approval_status in ('CONFIRMED', 'REJECTED', 'VOIDED') and reviewed_at is not null)
  ),
  constraint withdrawals_void_consistent check (
    (approval_status <> 'VOIDED' and voided_by is null and voided_at is null and void_reason is null)
    or (approval_status = 'VOIDED' and voided_at is not null and nullif(btrim(void_reason), '') is not null)
  )
);

create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 150),
  target_amount numeric(14,2) not null check (target_amount > 0),
  target_date date,
  status public.goal_status not null default 'ACTIVE',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'CONFIRM', 'REJECT', 'VOID')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create table if not exists public.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 150),
  owner_id uuid unique references public.profiles(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.members add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.contribution_settings add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.contribution_periods add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.contributions add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.expenses add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.withdrawals add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.savings_goals add column if not exists group_id uuid not null references public.groups(id) on delete restrict;
alter table public.audit_logs add column if not exists group_id uuid references public.groups(id) on delete set null;

alter table public.contribution_settings drop constraint if exists contribution_settings_effective_month_key;
create unique index if not exists contribution_settings_group_month_unique
  on public.contribution_settings (group_id, effective_month);

insert into public.schema_migrations (version, name) values
  ('0000', 'create migration ledger'),
  ('20261110_001', 'lock confirmed financial records'),
  ('20261110_002', 'structured profile and member names'),
  ('20261110_003', 'standardize administrator access errors in English'),
  ('20261110_004', 'add super administrator role'),
  ('20261110_005', 'isolate savings data by group')
on conflict (version) do nothing;

create index if not exists members_name_idx on public.members (lower(full_name));
create index if not exists members_status_idx on public.members (status);
create index if not exists contribution_periods_month_idx on public.contribution_periods (period_month);
create index if not exists contributions_period_idx on public.contributions (contribution_period_id);
create index if not exists contributions_payment_date_idx on public.contributions (payment_date);
create index if not exists contributions_status_idx on public.contributions (approval_status);
create unique index if not exists contributions_reference_unique_idx
  on public.contributions (lower(btrim(transaction_reference)))
  where nullif(btrim(transaction_reference), '') is not null;
create index if not exists expenses_date_idx on public.expenses (transaction_date);
create index if not exists expenses_status_idx on public.expenses (approval_status);
create unique index if not exists expenses_reference_unique_idx
  on public.expenses (lower(btrim(reference_number)))
  where nullif(btrim(reference_number), '') is not null;
create index if not exists withdrawals_date_idx on public.withdrawals (transaction_date);
create index if not exists withdrawals_status_idx on public.withdrawals (approval_status);
create unique index if not exists withdrawals_reference_unique_idx
  on public.withdrawals (lower(btrim(reference_number)))
  where nullif(btrim(reference_number), '') is not null;
create index if not exists audit_logs_record_idx on public.audit_logs (table_name, record_id, changed_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (changed_by, changed_at desc);
create index if not exists profiles_group_idx on public.profiles (group_id);
create index if not exists members_group_idx on public.members (group_id);
create index if not exists contribution_periods_group_idx on public.contribution_periods (group_id, period_month);
create index if not exists contributions_group_idx on public.contributions (group_id, payment_date);
create index if not exists expenses_group_idx on public.expenses (group_id, transaction_date);
create index if not exists withdrawals_group_idx on public.withdrawals (group_id, transaction_date);
create index if not exists savings_goals_group_idx on public.savings_goals (group_id);
create index if not exists audit_logs_group_idx on public.audit_logs (group_id, changed_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.normalize_ph_mobile(p_contact_number text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_number text := btrim(coalesce(p_contact_number, ''));
begin
  if v_number = '' then return null; end if;
  if v_number ~ '^09[0-9]{9}$' then return v_number; end if;
  if v_number ~ '^\+639[0-9]{9}$' then return '0' || substr(v_number, 4); end if;
  raise exception 'Contact number must use 09XXXXXXXXX or +639XXXXXXXXX.' using errcode = '22023';
end;
$$;

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
  if v_value !~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$$name$ then
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
    and parts[1] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$$name$
    and parts[2] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$$name$
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
    and parts[1] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$$name$
    and parts[2] ~ $name$^[[:alpha:]]+([ '’-][[:alpha:]]+)*$$name$
)
update public.members m
set first_name = s.first_name, last_name = s.last_name
from safe_names s
where m.id = s.id;

alter table public.profiles validate constraint profiles_structured_name_consistent;
alter table public.members validate constraint members_structured_name_consistent;

update public.members
set contact_number = public.normalize_ph_mobile(contact_number)
where contact_number is not null
  and btrim(contact_number) ~ '^(09[0-9]{9}|\+639[0-9]{9})$'
  and contact_number is distinct from public.normalize_ph_mobile(contact_number);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'members_contact_number_format'
      and conrelid = 'public.members'::regclass
  ) then
    alter table public.members
      add constraint members_contact_number_format
      check (contact_number is null or contact_number ~ '^09[0-9]{9}$') not valid;
  end if;

  if exists (
    select 1 from pg_constraint
    where conname = 'members_contact_number_format'
      and conrelid = 'public.members'::regclass
      and not convalidated
  ) and not exists (
    select 1 from public.members
    where contact_number is not null
      and contact_number !~ '^09[0-9]{9}$'
  ) then
    alter table public.members validate constraint members_contact_number_format;
  end if;
end $$;

create or replace function public.validated_money(p_amount numeric, p_label text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '% must be greater than zero.', p_label using errcode = '22023';
  end if;
  if p_amount > 999999999999.99 then
    raise exception '% must not exceed 999999999999.99.', p_label using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception '% must have no more than two decimal places.', p_label using errcode = '22023';
  end if;
  return p_amount;
end;
$$;

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

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid() and status = 'ACTIVE';
$$;

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select member_id
  from public.profiles
  where id = auth.uid() and status = 'ACTIVE';
$$;

create or replace function public.current_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id
  from public.profiles
  where id = auth.uid() and status = 'ACTIVE';
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'ADMIN', false);
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'SUPER_ADMIN', false);
$$;

create or replace function public.is_treasurer_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('ADMIN', 'TREASURER'), false);
$$;

create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
begin
  if tg_op = 'DELETE' then
    v_row_group := old.group_id;
  elsif tg_table_name = 'contribution_periods' then
    select group_id into v_row_group from public.members where id = new.member_id;
    new.group_id := v_row_group;
  elsif tg_table_name = 'contributions' then
    select group_id into v_row_group from public.contribution_periods where id = new.contribution_period_id;
    new.group_id := v_row_group;
  else
    new.group_id := coalesce(new.group_id, v_actor_group);
    v_row_group := new.group_id;
  end if;

  if v_actor_group is null or v_row_group is distinct from v_actor_group then
    raise exception 'You cannot access another savings group.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
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
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '') is not null
     and nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '') is not null then
    v_first_name := public.validated_name_part(new.raw_user_meta_data ->> 'first_name', 'First name');
    v_middle_name := public.validated_name_part(new.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
    v_last_name := public.validated_name_part(new.raw_user_meta_data ->> 'last_name', 'Last name');
    v_full_name := concat_ws(' ', v_first_name, v_middle_name, v_last_name);
  else
    v_full_name := case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2
        then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end;
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, role, status)
  values (
    new.id,
    v_full_name,
    v_first_name,
    v_middle_name,
    v_last_name,
    'MEMBER'::public.app_role,
    'PENDING'::public.account_status
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text := tg_op;
  v_record_id uuid;
  v_group_id uuid;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_record_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  v_group_id := coalesce((v_new ->> 'group_id')::uuid, (v_old ->> 'group_id')::uuid);

  if tg_op = 'UPDATE' and v_old ->> 'approval_status' is distinct from v_new ->> 'approval_status' then
    v_action := case v_new ->> 'approval_status'
      when 'CONFIRMED' then 'CONFIRM'
      when 'REJECTED' then 'REJECT'
      when 'VOIDED' then 'VOID'
      else 'UPDATE'
    end;
  end if;

  insert into public.audit_logs (group_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (v_group_id, tg_table_name, v_record_id, v_action, v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
drop trigger if exists groups_updated_at on public.groups;
create trigger groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();
drop trigger if exists members_updated_at on public.members;
create trigger members_updated_at before update on public.members
  for each row execute function public.set_updated_at();
drop trigger if exists contributions_updated_at on public.contributions;
create trigger contributions_updated_at before update on public.contributions
  for each row execute function public.set_updated_at();
drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
drop trigger if exists withdrawals_updated_at on public.withdrawals;
create trigger withdrawals_updated_at before update on public.withdrawals
  for each row execute function public.set_updated_at();
drop trigger if exists savings_goals_updated_at on public.savings_goals;
create trigger savings_goals_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();

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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'members', 'contribution_settings', 'contribution_periods', 'contributions',
    'expenses', 'withdrawals', 'savings_goals'
  ] loop
    execute format('drop trigger if exists %I_group_scope on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_group_scope before insert or update or delete on public.%I for each row execute function public.enforce_group_scope()',
      table_name,
      table_name
    );
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'members', 'contribution_settings', 'contribution_periods',
    'contributions', 'expenses', 'withdrawals', 'savings_goals'
  ] loop
    execute format('drop trigger if exists %I_audit on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
      table_name,
      table_name
    );
  end loop;
end $$;

drop trigger if exists groups_audit on public.groups;
create trigger groups_audit after insert or update or delete on public.groups
  for each row execute function public.write_audit_log();

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
    where id = p_user_id
      and (
        (role = 'SUPER_ADMIN' and id = auth.uid())
        or role = 'ADMIN'
        or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null)
      );
  elsif v_actor_role = 'ADMIN' and v_actor_group is not null then
    if p_user_id = auth.uid() or p_role <> 'MEMBER' then
      raise exception 'Group administrators can only manage member accounts in their own group.' using errcode = '42501';
    end if;
    if p_member_id is not null and not exists (
      select 1 from public.members where id = p_member_id and group_id = v_actor_group
    ) then
      raise exception 'The selected member does not belong to your savings group.' using errcode = '42501';
    end if;

    update public.profiles
    set role = 'MEMBER', status = p_status, member_id = p_member_id, group_id = v_actor_group
    where id = p_user_id
      and role = 'MEMBER'
      and (group_id is null or group_id = v_actor_group);
  else
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;

  if not found then
    raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.super_admin_create_group(p_name text, p_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can create savings groups.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Group name is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_admin_id and role = 'ADMIN' and group_id is null
  ) then
    raise exception 'An unassigned administrator account is required.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id)
  values (btrim(p_name), p_admin_id)
  returning id into v_group_id;

  update public.profiles
  set group_id = v_group_id, status = 'ACTIVE'
  where id = p_admin_id;

  return v_group_id;
end;
$$;

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
  if not public.is_admin() then
    raise exception 'Only an administrator can create members.' using errcode = '42501';
  end if;

  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  insert into public.members (
    full_name, first_name, middle_name, last_name, contact_number, date_registered, monthly_contribution_amount,
    notes, created_by, updated_by
  ) values (
    concat_ws(' ', v_first_name, v_middle_name, v_last_name), v_first_name, v_middle_name, v_last_name,
    public.normalize_ph_mobile(p_contact_number), p_date_registered,
    public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'), nullif(btrim(p_notes), ''), auth.uid(), auth.uid()
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
  if not public.is_admin() then
    raise exception 'Only an administrator can update members.' using errcode = '42501';
  end if;

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

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.deactivate_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can deactivate members.' using errcode = '42501';
  end if;

  update public.members
  set status = 'INACTIVE', deactivated_at = now(), updated_by = auth.uid()
  where id = p_member_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.set_contribution_setting(
  p_effective_month date,
  p_default_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_effective_month)::date;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can change contribution settings.' using errcode = '42501';
  end if;

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_group_id, v_month, public.validated_money(p_default_amount, 'Default amount'), auth.uid())
  on conflict (group_id, effective_month) do update set
    default_amount = excluded.default_amount,
    created_by = auth.uid(),
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.generate_contribution_periods(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_treasurer_or_admin() or public.current_group_id() is null then
    raise exception 'You are not allowed to generate contribution periods.' using errcode = '42501';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount)
  select id, v_month, monthly_contribution_amount
  from public.members
  where status = 'ACTIVE'
    and group_id = public.current_group_id()
    and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.record_contribution(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_period_id uuid;
  v_required numeric(14,2);
  v_id uuid;
  v_status public.approval_status;
  v_month date := date_trunc('month', p_contribution_month)::date;
begin
  if v_role is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;

  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and status = 'ACTIVE'
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount)
  values (p_member_id, v_month, v_required)
  on conflict (member_id, period_month) do nothing;

  select id into v_period_id
  from public.contribution_periods
  where member_id = p_member_id and period_month = v_month;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.contributions (
    contribution_period_id, amount, payment_date, transaction_reference,
    idempotency_key, notes, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    v_period_id, public.validated_money(p_amount, 'Contribution amount'), p_payment_date,
    nullif(btrim(p_transaction_reference), ''), p_idempotency_key,
    nullif(btrim(p_notes), ''), v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.review_contribution(
  p_contribution_id uuid,
  p_decision public.approval_status,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can review entries.' using errcode = '42501';
  end if;
  if p_decision not in ('CONFIRMED', 'REJECTED') then
    raise exception 'Decision must be CONFIRMED or REJECTED.' using errcode = '22023';
  end if;
  if p_decision = 'REJECTED' and nullif(btrim(p_review_note), '') is null then
    raise exception 'A rejection reason is required.' using errcode = '22023';
  end if;

  update public.contributions
  set approval_status = p_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(btrim(p_review_note), '')
  where id = p_contribution_id and approval_status = 'PENDING';

  if not found then
    raise exception 'Pending contribution not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.update_contribution(
  p_contribution_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.contributions;
  v_role public.app_role := public.current_user_role();
begin
  select * into v_entry from public.contributions where id = p_contribution_id;
  if not found then raise exception 'Contribution not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then
    raise exception 'Only pending contributions can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023';
  end if;
  if v_role <> 'ADMIN' and not (
    v_entry.submitted_by = auth.uid() or v_role = 'TREASURER'
  ) then
    raise exception 'You are not allowed to edit this entry.' using errcode = '42501';
  end if;

  update public.contributions
  set amount = public.validated_money(p_amount, 'Contribution amount'),
      payment_date = p_payment_date,
      transaction_reference = nullif(btrim(p_transaction_reference), ''),
      notes = nullif(btrim(p_notes), '')
  where id = p_contribution_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending contribution not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.void_contribution(p_contribution_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can void confirmed entries.' using errcode = '42501';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'A void reason is required.' using errcode = '22023';
  end if;

  update public.contributions
  set approval_status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
  where id = p_contribution_id and approval_status = 'CONFIRMED';

  if not found then raise exception 'Confirmed contribution not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.record_withdrawal(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_status public.approval_status;
  v_id uuid;
begin
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.withdrawals (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Withdrawal amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_withdrawal(
  p_withdrawal_id uuid,
  p_decision public.approval_status,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can review entries.' using errcode = '42501'; end if;
  if p_decision not in ('CONFIRMED', 'REJECTED') then raise exception 'Decision must be CONFIRMED or REJECTED.' using errcode = '22023'; end if;
  if p_decision = 'REJECTED' and nullif(btrim(p_review_note), '') is null then raise exception 'A rejection reason is required.' using errcode = '22023'; end if;

  update public.withdrawals
  set approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(p_review_note), '')
  where id = p_withdrawal_id and approval_status = 'PENDING';
  if not found then raise exception 'Pending withdrawal not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.update_withdrawal(
  p_withdrawal_id uuid,
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.withdrawals;
  v_role public.app_role := public.current_user_role();
begin
  select * into v_entry from public.withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'Withdrawal not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending withdrawals can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role <> 'ADMIN' and not (v_entry.submitted_by = auth.uid() or v_role = 'TREASURER') then
    raise exception 'You are not allowed to edit this entry.' using errcode = '42501';
  end if;

  update public.withdrawals set
    transaction_date = p_transaction_date, amount = public.validated_money(p_amount, 'Withdrawal amount'), category = btrim(p_category),
    description = btrim(p_description), person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''), notes = nullif(btrim(p_notes), '')
  where id = p_withdrawal_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending withdrawal not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.void_withdrawal(p_withdrawal_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can void confirmed entries.' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A void reason is required.' using errcode = '22023'; end if;
  update public.withdrawals
  set approval_status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
  where id = p_withdrawal_id and approval_status = 'CONFIRMED';
  if not found then raise exception 'Confirmed withdrawal not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.record_expense(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_status public.approval_status;
  v_id uuid;
begin
  if v_role is null or v_role not in ('ADMIN', 'TREASURER') then raise exception 'You are not allowed to record expenses.' using errcode = '42501'; end if;
  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.expenses (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Expense amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.review_expense(
  p_expense_id uuid,
  p_decision public.approval_status,
  p_review_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can review entries.' using errcode = '42501'; end if;
  if p_decision not in ('CONFIRMED', 'REJECTED') then raise exception 'Decision must be CONFIRMED or REJECTED.' using errcode = '22023'; end if;
  if p_decision = 'REJECTED' and nullif(btrim(p_review_note), '') is null then raise exception 'A rejection reason is required.' using errcode = '22023'; end if;

  update public.expenses
  set approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(p_review_note), '')
  where id = p_expense_id and approval_status = 'PENDING';
  if not found then raise exception 'Pending expense not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.update_expense(
  p_expense_id uuid,
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.expenses;
  v_role public.app_role := public.current_user_role();
begin
  select * into v_entry from public.expenses where id = p_expense_id;
  if not found then raise exception 'Expense not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending expenses can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role <> 'ADMIN' and v_role <> 'TREASURER' then
    raise exception 'You are not allowed to edit this expense.' using errcode = '42501';
  end if;

  update public.expenses set
    transaction_date = p_transaction_date, amount = public.validated_money(p_amount, 'Expense amount'), category = btrim(p_category),
    description = btrim(p_description), person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''), notes = nullif(btrim(p_notes), '')
  where id = p_expense_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending expense not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.void_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can void confirmed entries.' using errcode = '42501'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'A void reason is required.' using errcode = '22023'; end if;
  update public.expenses
  set approval_status = 'VOIDED', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
  where id = p_expense_id and approval_status = 'CONFIRMED';
  if not found then raise exception 'Confirmed expense not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.save_savings_goal(
  p_goal_id uuid,
  p_title text,
  p_target_amount numeric,
  p_target_date date,
  p_status public.goal_status,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only an administrator can manage goals.' using errcode = '42501'; end if;
  if p_goal_id is null then
    insert into public.savings_goals (title, target_amount, target_date, status, notes, created_by, updated_by)
    values (btrim(p_title), public.validated_money(p_target_amount, 'Target amount'), p_target_date, p_status, nullif(btrim(p_notes), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.savings_goals set
      title = btrim(p_title), target_amount = public.validated_money(p_target_amount, 'Target amount'), target_date = p_target_date,
      status = p_status, notes = nullif(btrim(p_notes), ''), updated_by = auth.uid()
    where id = p_goal_id returning id into v_id;
    if v_id is null then raise exception 'Savings goal not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end;
$$;

create or replace view public.v_contribution_status
with (security_invoker = true)
as
select
  cp.id as contribution_period_id,
  cp.member_id,
  m.full_name as member_name,
  cp.period_month,
  cp.required_amount,
  coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as paid_amount,
  greatest(cp.required_amount - coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0), 0)::numeric(14,2) as outstanding_amount,
  greatest(coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) - cp.required_amount, 0)::numeric(14,2) as overpaid_amount,
  case
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = 0 then 'UNPAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) < cp.required_amount then 'PARTIALLY PAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = cp.required_amount then 'PAID'
    else 'OVERPAID'
  end as payment_status
from public.contribution_periods cp
join public.members m on m.id = cp.member_id
left join public.contributions c on c.contribution_period_id = cp.id
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount;

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at
from public.contributions c
where c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

create or replace view public.v_monthly_financial_summary
with (security_invoker = true)
as
with activity as (
  select date_trunc('month', payment_date)::date as month,
         sum(amount) filter (where approval_status = 'CONFIRMED') as additions,
         0::numeric as deductions,
         0::numeric as expenses
  from public.contributions group by 1
  union all
  select date_trunc('month', transaction_date)::date, 0,
         sum(amount) filter (where approval_status = 'CONFIRMED'), 0
  from public.withdrawals group by 1
  union all
  select date_trunc('month', transaction_date)::date, 0, 0,
         sum(amount) filter (where approval_status = 'CONFIRMED')
  from public.expenses group by 1
)
select month,
       coalesce(sum(additions), 0)::numeric(14,2) as total_additions,
       coalesce(sum(deductions), 0)::numeric(14,2) as total_deductions,
       coalesce(sum(expenses), 0)::numeric(14,2) as total_expenses,
       (coalesce(sum(additions), 0) - coalesce(sum(deductions), 0) - coalesce(sum(expenses), 0))::numeric(14,2) as net_change
from activity
where public.is_treasurer_or_admin()
group by month;

create or replace function public.get_savings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_treasurer_or_admin() or public.current_group_id() is null then null
    else jsonb_build_object(
      'total_additions', (select coalesce(sum(amount), 0) from public.contributions where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'total_deductions', (select coalesce(sum(amount), 0) from public.withdrawals where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'total_expenses', (select coalesce(sum(amount), 0) from public.expenses where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'tracked_savings',
        (select coalesce(sum(amount), 0) from public.contributions where group_id = public.current_group_id() and approval_status = 'CONFIRMED')
        - (select coalesce(sum(amount), 0) from public.withdrawals where group_id = public.current_group_id() and approval_status = 'CONFIRMED')
        - (select coalesce(sum(amount), 0) from public.expenses where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'pending_entries',
        (select count(*) from public.contributions where group_id = public.current_group_id() and approval_status = 'PENDING')
        + (select count(*) from public.withdrawals where group_id = public.current_group_id() and approval_status = 'PENDING')
        + (select count(*) from public.expenses where group_id = public.current_group_id() and approval_status = 'PENDING')
    )
  end;
$$;

alter table public.profiles enable row level security;
alter table public.members enable row level security;
alter table public.contribution_settings enable row level security;
alter table public.contribution_periods enable row level security;
alter table public.contributions enable row level security;
alter table public.expenses enable row level security;
alter table public.withdrawals enable row level security;
alter table public.savings_goals enable row level security;
alter table public.audit_logs enable row level security;
alter table public.groups enable row level security;

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
using (public.is_super_admin() or id = public.current_group_id());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (public.is_admin() and group_id = public.current_group_id())
);

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
  and (public.is_treasurer_or_admin() or id = public.current_member_id())
);

drop policy if exists contribution_settings_select on public.contribution_settings;
create policy contribution_settings_select on public.contribution_settings for select to authenticated
using (group_id = public.current_group_id() and public.current_user_role() <> 'SUPER_ADMIN');

drop policy if exists contribution_periods_select on public.contribution_periods;
create policy contribution_periods_select on public.contribution_periods for select to authenticated
using (
  group_id = public.current_group_id()
  and (public.is_treasurer_or_admin() or member_id = public.current_member_id())
);

drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions for select to authenticated
using (
  group_id = public.current_group_id()
  and (
    public.is_treasurer_or_admin()
    or exists (
      select 1 from public.contribution_periods cp
      where cp.id = contribution_period_id and cp.member_id = public.current_member_id()
    )
  )
);

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
using (group_id = public.current_group_id() and public.is_treasurer_or_admin());

drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals for select to authenticated
using (
  group_id = public.current_group_id()
  and (public.is_treasurer_or_admin() or submitted_by = auth.uid())
);

drop policy if exists savings_goals_select on public.savings_goals;
create policy savings_goals_select on public.savings_goals for select to authenticated
using (group_id = public.current_group_id() and public.current_user_role() <> 'SUPER_ADMIN');

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (
  (public.is_super_admin() and table_name in ('profiles', 'groups'))
  or (public.is_admin() and group_id = public.current_group_id())
);

revoke all on all tables in schema public from anon;
revoke create on schema public from public;
revoke all on public.profiles, public.members, public.contribution_settings,
  public.contribution_periods, public.contributions, public.expenses,
  public.withdrawals, public.savings_goals, public.audit_logs, public.groups,
  public.schema_migrations from authenticated;

grant select on public.profiles, public.members, public.contribution_settings,
  public.contribution_periods, public.contributions, public.expenses,
  public.withdrawals, public.savings_goals, public.audit_logs, public.groups to authenticated;
grant select on public.v_contribution_status, public.v_savings_calendar,
  public.v_monthly_financial_summary to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.current_group_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_treasurer_or_admin() to authenticated;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;
grant execute on function public.create_member(text, text, text, text, date, numeric, text) to authenticated;
grant execute on function public.update_member(uuid, text, text, text, text, numeric, text) to authenticated;
grant execute on function public.deactivate_member(uuid) to authenticated;
grant execute on function public.set_contribution_setting(date, numeric) to authenticated;
grant execute on function public.generate_contribution_periods(date) to authenticated;
grant execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid) to authenticated;
grant execute on function public.review_contribution(uuid, public.approval_status, text) to authenticated;
grant execute on function public.update_contribution(uuid, numeric, date, text, text) to authenticated;
grant execute on function public.void_contribution(uuid, text) to authenticated;
grant execute on function public.record_withdrawal(date, numeric, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.review_withdrawal(uuid, public.approval_status, text) to authenticated;
grant execute on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.void_withdrawal(uuid, text) to authenticated;
grant execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.review_expense(uuid, public.approval_status, text) to authenticated;
grant execute on function public.update_expense(uuid, date, numeric, text, text, text, text, text) to authenticated;
grant execute on function public.void_expense(uuid, text) to authenticated;
grant execute on function public.save_savings_goal(uuid, text, numeric, date, public.goal_status, text) to authenticated;
grant execute on function public.get_savings_summary() to authenticated;
grant execute on function public.super_admin_create_group(text, uuid) to authenticated;

commit;

-- BOOTSTRAP THE FIRST SUPER ADMIN
-- 1. Create the platform owner in Authentication > Users.
-- 2. Replace the email below, then run only this statement once:
--
-- update public.profiles p
-- set role = 'SUPER_ADMIN', status = 'ACTIVE', group_id = null, member_id = null
-- from auth.users u
-- where p.id = u.id and lower(u.email) = lower('your-email@example.com');
