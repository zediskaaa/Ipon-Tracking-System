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
  date_registered date not null default ((now() at time zone 'Asia/Manila')::date),
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
  payment_date date not null default ((now() at time zone 'Asia/Manila')::date),
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
  transaction_date date not null default ((now() at time zone 'Asia/Manila')::date),
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
  transaction_date date not null default ((now() at time zone 'Asia/Manila')::date),
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
  ('20261110_005', 'isolate savings data by group'),
  ('20261110_006', 'super administrator account workflow'),
  ('20261110_007', 'complete account notifications and user workflow'),
  ('20261111_008', 'restore validation helper functions'),
  ('20261111_009', 'use Philippine business date'),
  ('20261111_011', 'scope references and restrict withdrawals'),
  ('20261111_012', 'protect temporary password state'),
  ('20261112_015', 'require mobile number on profile updates')
on conflict (version) do nothing;

create index if not exists members_name_idx on public.members (lower(full_name));
create index if not exists members_status_idx on public.members (status);
create index if not exists contribution_periods_month_idx on public.contribution_periods (period_month);
create index if not exists contributions_period_idx on public.contributions (contribution_period_id);
create index if not exists contributions_payment_date_idx on public.contributions (payment_date);
create index if not exists contributions_status_idx on public.contributions (approval_status);
create unique index if not exists contributions_reference_unique_idx
  on public.contributions (group_id, lower(btrim(transaction_reference)))
  where nullif(btrim(transaction_reference), '') is not null;
create index if not exists expenses_date_idx on public.expenses (transaction_date);
create index if not exists expenses_status_idx on public.expenses (approval_status);
create unique index if not exists expenses_reference_unique_idx
  on public.expenses (group_id, lower(btrim(reference_number)))
  where nullif(btrim(reference_number), '') is not null;
create index if not exists withdrawals_date_idx on public.withdrawals (transaction_date);
create index if not exists withdrawals_status_idx on public.withdrawals (approval_status);
create unique index if not exists withdrawals_reference_unique_idx
  on public.withdrawals (group_id, lower(btrim(reference_number)))
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
set timezone = 'Asia/Manila'
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

  if v_group_id is not null and not exists (select 1 from public.groups g where g.id = v_group_id) then
    v_group_id := null;
  end if;

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

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text := btrim(coalesce(p_group_name, ''));
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501';
  end if;
  if char_length(v_group_name) < 2 or char_length(v_group_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  update public.profiles
  set role = 'ADMIN', status = 'ACTIVE', member_id = null
  where id = p_user_id
    and role = 'MEMBER'
    and status = 'PENDING'
    and group_id is null
    and member_id is null;

  if not found then
    raise exception 'Pending administrator request not found.' using errcode = 'P0002';
  end if;

  insert into public.groups (name, owner_id)
  values (v_group_name, p_user_id)
  returning id into v_group_id;

  update public.profiles set group_id = v_group_id where id = p_user_id;
  return v_group_id;
end;
$$;

create or replace function public.super_admin_reject_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501';
  end if;

  update public.profiles
  set status = 'DISABLED'
  where id = p_user_id
    and role = 'MEMBER'
    and status = 'PENDING'
    and group_id is null
    and member_id is null;

  if not found then
    raise exception 'Pending administrator request not found.' using errcode = 'P0002';
  end if;
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

create or replace function public.contribution_period_due_date(
  p_group_id uuid,
  p_month date
)
returns date
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select date_trunc('month', p_month)::date as period_month
  )
  select make_date(
    extract(year from m.period_month)::integer,
    extract(month from m.period_month)::integer,
    least(
      coalesce(
        (
          select deadline_day
          from public.contribution_settings
          where group_id = p_group_id
            and effective_month <= m.period_month
          order by effective_month desc
          limit 1
        ),
        28
      ),
      extract(day from (m.period_month + interval '1 month - 1 day'))::integer
    )
  )
  from m;
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
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_period_id uuid;
  v_required numeric(14,2);
  v_id uuid;
  v_status public.approval_status;
  v_month date := date_trunc('month', p_contribution_month)::date;
begin
  if v_role is null or v_group_id is null then
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
    and group_id = v_group_id
    and status = 'ACTIVE'
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  values (p_member_id, v_month, v_required, public.contribution_period_due_date(v_group_id, v_month))
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
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'Only administrators and treasurers can record withdrawals.' using errcode = '42501'; end if;
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
  if v_role not in ('ADMIN', 'TREASURER') then
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
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name
from public.contributions c
join public.contribution_periods cp on cp.id = c.contribution_period_id
join public.members m on m.id = cp.member_id
where c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at,
       w.person_responsible as subject_name
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name
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
where public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
group by month;

create or replace function public.get_savings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() not in ('ADMIN', 'TREASURER', 'MEMBER') or public.current_group_id() is null then null
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
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists contribution_settings_select on public.contribution_settings;
create policy contribution_settings_select on public.contribution_settings for select to authenticated
using (group_id = public.current_group_id() and public.current_user_role() <> 'SUPER_ADMIN');

drop policy if exists contribution_periods_select on public.contribution_periods;
create policy contribution_periods_select on public.contribution_periods for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists savings_goals_select on public.savings_goals;
create policy savings_goals_select on public.savings_goals for select to authenticated
using (group_id = public.current_group_id() and public.current_user_role() <> 'SUPER_ADMIN');

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (
  (
    public.is_super_admin()
    and (
      table_name = 'groups'
      or (
        table_name = 'profiles'
        and (
          group_id is null
          or coalesce(new_data ->> 'role', old_data ->> 'role') in ('SUPER_ADMIN', 'ADMIN')
        )
      )
    )
  )
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
grant execute on function public.super_admin_approve_request(uuid, text) to authenticated;
grant execute on function public.super_admin_reject_request(uuid) to authenticated;

-- Account requests, personal dashboards, notifications, deadlines, and account security.
alter table public.profiles
  add column if not exists email text,
  add column if not exists contact_number text,
  add column if not exists notifications_enabled boolean not null default true;

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id and p.email is null;

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email)) where email is not null;

create table if not exists public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null unique references public.profiles(id) on delete cascade,
  email text not null,
  contact_number text,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  details text not null check (char_length(btrim(details)) between 10 and 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'IMPLEMENTED', 'REJECTED')),
  allow_credit boolean not null default true,
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  release_version text,
  created_at timestamptz not null default now()
);

create index if not exists feature_requests_status_idx on public.feature_requests (status, created_at desc);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  type text not null,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  message text not null check (char_length(btrim(message)) between 2 and 500),
  link text,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.account_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('LOGIN', 'PROFILE_UPDATE', 'PASSWORD_CHANGE')),
  created_at timestamptz not null default now()
);

alter table public.contribution_settings
  add column if not exists deadline_day smallint not null default 28
  check (deadline_day between 1 and 28);

alter table public.contribution_periods add column if not exists due_date date;

-- Migration backfill runs without an authenticated app user in the SQL Editor.
alter table public.contribution_periods disable trigger contribution_periods_group_scope;
update public.contribution_periods
set due_date = (period_month + interval '1 month - 1 day')::date
where due_date is null;
alter table public.contribution_periods enable trigger contribution_periods_group_scope;

alter table public.contribution_periods alter column due_date set not null;

create index if not exists admin_requests_status_idx on public.admin_requests (status, created_at desc);
create index if not exists feature_requests_created_at_idx on public.feature_requests (created_at desc);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);
create index if not exists account_activity_user_idx on public.account_activity (user_id, created_at desc);

insert into public.admin_requests (requester_id, email, contact_number, reason)
select id, email, contact_number, 'This request was created before detailed request information was required.'
from public.profiles
where role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null and email is not null
on conflict (requester_id) do nothing;

drop trigger if exists admin_requests_updated_at on public.admin_requests;
create trigger admin_requests_updated_at before update on public.admin_requests
  for each row execute function public.set_updated_at();

create or replace function public.push_notification(
  p_recipient_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_group_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where id = p_recipient_id and status <> 'DISABLED' and notifications_enabled
  ) then
    insert into public.notifications (recipient_id, group_id, type, title, message, link)
    values (p_recipient_id, p_group_id, p_type, btrim(p_title), btrim(p_message), nullif(btrim(p_link), ''));
  end if;
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
  v_account_kind text := coalesce(new.raw_user_meta_data ->> 'account_kind', 'MANAGED');
  v_super_admin record;
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

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', 'PENDING')
  on conflict (id) do nothing;

  if v_account_kind = 'ADMIN_REQUEST' then
    if v_contact is null or v_reason is null or char_length(v_reason) < 10 then
      raise exception 'Administrator requests require a contact number and a reason of at least 10 characters.' using errcode = '22023';
    end if;
    insert into public.admin_requests (requester_id, email, contact_number, reason)
    values (new.id, lower(new.email), v_contact, v_reason);

    for v_super_admin in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_super_admin.id, 'ADMIN_REQUEST', 'New administrator request', v_full_name || ' requested administrator access.', 'super-admin.html#requests');
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email is distinct from new.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_user_email();

create or replace function public.update_own_profile(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text
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
begin
  if v_contact is null then
    raise exception 'Mobile number is required.' using errcode = '22023';
  end if;
  update public.profiles
  set first_name = v_first, middle_name = v_middle, last_name = v_last,
      full_name = concat_ws(' ', v_first, v_middle, v_last),
      contact_number = v_contact
  where id = auth.uid() and status = 'ACTIVE';
  if not found then raise exception 'Active profile not found.' using errcode = 'P0002'; end if;
  insert into public.account_activity (user_id, event) values (auth.uid(), 'PROFILE_UPDATE');
end;
$$;

create or replace function public.record_account_activity(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('LOGIN', 'PASSWORD_CHANGE') then
    raise exception 'Unsupported account activity.' using errcode = '22023';
  end if;
  insert into public.account_activity (user_id, event) values (auth.uid(), p_event);
end;
$$;

create or replace function public.set_notification_preferences(p_enabled boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set notifications_enabled = p_enabled where id = auth.uid();
$$;

create or replace function public.mark_notification_read(p_notification_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = coalesce(read_at, now())
  where id = p_notification_id and recipient_id = auth.uid();
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text := btrim(coalesce(p_group_name, ''));
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if char_length(v_group_name) < 2 or char_length(v_group_name) > 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;

  update public.profiles set role = 'ADMIN', status = 'ACTIVE', member_id = null
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;
  update public.profiles set group_id = v_group_id where id = p_user_id;
  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_APPROVED', 'Administrator access approved', 'Your administrator account and savings group are ready.', 'dashboard.html', v_group_id);
  perform public.push_notification(auth.uid(), 'ADMIN_CREATED', 'Administrator account created', v_group_name || ' is now active.', 'super-admin.html#administrators');
  return v_group_id;
end;
$$;

drop function if exists public.super_admin_reject_request(uuid);
create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  update public.profiles set status = 'DISABLED'
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;
  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_review_note), '')
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', coalesce(nullif(btrim(p_review_note), ''), 'Your administrator access request was not approved.'), null);
end;
$$;

create or replace function public.super_admin_update_administrator(
  p_user_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_group_name text
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
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can edit administrators.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_group_name, ''))) not between 2 and 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;
  update public.profiles set first_name = v_first, middle_name = v_middle, last_name = v_last, full_name = concat_ws(' ', v_first, v_middle, v_last)
  where id = p_user_id and role = 'ADMIN';
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups set name = btrim(p_group_name) where owner_id = p_user_id;
end;
$$;

create or replace function public.super_admin_archive_administrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can archive administrators.' using errcode = '42501'; end if;
  update public.profiles set status = 'DISABLED' where id = p_user_id and role = 'ADMIN';
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups set status = 'SUSPENDED' where owner_id = p_user_id;
  perform public.push_notification(auth.uid(), 'ADMIN_ARCHIVED', 'Administrator archived', 'An administrator account and its group were suspended.', 'super-admin.html#administrators');
end;
$$;

drop function if exists public.set_contribution_setting(date, numeric);
create or replace function public.set_contribution_setting(
  p_effective_month date,
  p_default_amount numeric,
  p_deadline_day integer default 28
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
  if not public.is_admin() or v_group_id is null then raise exception 'Only a group administrator can change contribution settings.' using errcode = '42501'; end if;
  if p_deadline_day not between 1 and 28 then raise exception 'Deadline day must be between 1 and 28.' using errcode = '22023'; end if;
  insert into public.contribution_settings (group_id, effective_month, default_amount, deadline_day, created_by)
  values (v_group_id, v_month, public.validated_money(p_default_amount, 'Default amount'), p_deadline_day, auth.uid())
  on conflict (group_id, effective_month) do update set default_amount = excluded.default_amount, deadline_day = excluded.deadline_day, created_by = auth.uid(), created_at = now()
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
  v_group_id uuid := public.current_group_id();
  v_due_date date;
begin
  if not public.is_admin() or v_group_id is null then raise exception 'Only a group administrator can generate contribution periods.' using errcode = '42501'; end if;
  v_due_date := public.contribution_period_due_date(v_group_id, v_month);
  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select id, v_month, monthly_contribution_amount, v_due_date from public.members
  where status = 'ACTIVE' and group_id = v_group_id and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_user_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
  select case when public.current_member_id() is null then null else jsonb_build_object(
    'total_contributed', (select coalesce(sum(c.amount), 0) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = public.current_member_id() and c.approval_status = 'CONFIRMED'),
    'months_paid', (select count(*) from public.v_contribution_status where member_id = public.current_member_id() and payment_status in ('PAID', 'OVERPAID')),
    'months_unpaid', (select count(*) from public.v_contribution_status where member_id = public.current_member_id() and payment_status in ('UNPAID', 'PARTIALLY PAID') and period_month <= date_trunc('month', current_date)::date),
    'pending_submissions', (select count(*) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = public.current_member_id() and c.approval_status = 'PENDING'),
    'current_period', (select to_jsonb(x) from (select vcs.period_month, vcs.required_amount, vcs.paid_amount, vcs.outstanding_amount, vcs.payment_status, cp.due_date from public.v_contribution_status vcs join public.contribution_periods cp on cp.id = vcs.contribution_period_id where vcs.member_id = public.current_member_id() and vcs.period_month = date_trunc('month', current_date)::date) x)
  ) end;
$$;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name when 'contributions' then 'contribution' when 'withdrawals' then 'deduction' else 'expense' end;
begin
  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in select id from public.profiles where group_id = v_group and role = 'ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_admin.id, 'REVIEW_REQUIRED', 'New ' || v_label || ' submitted', 'A record is waiting for your review.', 'dashboard.html', v_group);
    end loop;
    if new.submitted_by is not null then perform public.push_notification(new.submitted_by, 'SUBMITTED', initcap(v_label) || ' submitted', 'Your record is waiting for administrator review.', 'user.html', v_group); end if;
  elsif tg_op = 'UPDATE' and old.approval_status = 'PENDING' and new.approval_status in ('CONFIRMED', 'REJECTED') and new.submitted_by is not null then
    perform public.push_notification(new.submitted_by, 'REVIEWED', initcap(v_label) || ' ' || lower(new.approval_status::text), 'Your submitted ' || v_label || ' was ' || lower(new.approval_status::text) || '.', 'user.html', v_group);
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_admin record;
begin
  for v_admin in select id from public.profiles where group_id = new.group_id and role = 'ADMIN' and status = 'ACTIVE' loop
    perform public.push_notification(v_admin.id, 'MEMBER_CREATED', 'Member registered', new.full_name || ' was added to your group.', 'members.html', new.group_id);
  end loop;
  return new;
end;
$$;

create or replace function public.notify_profile_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'MEMBER' and old.status is distinct from new.status and new.status = 'ACTIVE' then
    perform public.push_notification(new.id, 'ACCOUNT_READY', 'Your account is ready', 'Your member account is active and linked to your savings profile.', 'user.html', new.group_id);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_access_notifications on public.profiles;
create trigger profiles_access_notifications after update of status on public.profiles
  for each row execute function public.notify_profile_access();

drop trigger if exists members_notifications on public.members;
create trigger members_notifications after insert on public.members
  for each row execute function public.notify_new_member();

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare v_count integer;
begin
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select p.id, cp.group_id, 'CONTRIBUTION_REMINDER', 'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.', 'user.html'
  from public.contribution_periods cp
  join public.profiles p on p.member_id = cp.member_id and p.status = 'ACTIVE' and p.notifications_enabled
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n where n.recipient_id = p.id and n.type = 'CONTRIBUTION_REMINDER'
        and n.created_at::date = current_date and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['contributions', 'withdrawals', 'expenses'] loop
    execute format('drop trigger if exists %I_notifications on public.%I', v_table, v_table);
    execute format('create trigger %I_notifications after insert or update of approval_status on public.%I for each row execute function public.notify_record_activity()', v_table, v_table);
  end loop;
end $$;

alter table public.admin_requests enable row level security;
alter table public.feature_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.account_activity enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feature_requests') then
    alter publication supabase_realtime add table public.feature_requests;
  end if;
end $$;

drop policy if exists admin_requests_select on public.admin_requests;
create policy admin_requests_select on public.admin_requests for select to authenticated
using (requester_id = auth.uid() or public.is_super_admin());
drop policy if exists feature_requests_select on public.feature_requests;
create policy feature_requests_select on public.feature_requests for select to authenticated
using (
  requester_id = auth.uid()
  or public.is_super_admin()
  or (status = 'IMPLEMENTED' and release_version is not null)
);
drop policy if exists feature_requests_insert on public.feature_requests;
create policy feature_requests_insert on public.feature_requests for insert to authenticated
with check (requester_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (recipient_id = auth.uid());
drop policy if exists account_activity_select on public.account_activity;
create policy account_activity_select on public.account_activity for select to authenticated
using (user_id = auth.uid() or (public.is_super_admin() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'ADMIN')));

revoke all on public.admin_requests, public.feature_requests, public.notifications, public.account_activity from public, anon, authenticated;
grant select on public.admin_requests, public.feature_requests, public.notifications, public.account_activity to authenticated;
grant insert (requester_id, title, details) on public.feature_requests to authenticated;

revoke execute on function public.push_notification(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.update_own_profile(text, text, text, text) from public, anon;
revoke execute on function public.record_account_activity(text) from public, anon;
revoke execute on function public.set_notification_preferences(boolean) from public, anon;
revoke execute on function public.mark_notification_read(bigint) from public, anon;
revoke execute on function public.mark_all_notifications_read() from public, anon;
revoke execute on function public.super_admin_update_administrator(uuid, text, text, text, text) from public, anon;
revoke execute on function public.super_admin_archive_administrator(uuid) from public, anon;
revoke execute on function public.super_admin_reject_request(uuid, text) from public, anon;
revoke execute on function public.get_user_dashboard() from public, anon;
revoke execute on function public.notify_record_activity() from public, anon, authenticated;
revoke execute on function public.notify_new_member() from public, anon, authenticated;
revoke execute on function public.notify_profile_access() from public, anon, authenticated;
revoke execute on function public.create_due_reminders() from public, anon, authenticated;
grant execute on function public.update_own_profile(text, text, text, text) to authenticated;
grant execute on function public.record_account_activity(text) to authenticated;
grant execute on function public.set_notification_preferences(boolean) to authenticated;
grant execute on function public.mark_notification_read(bigint) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.super_admin_update_administrator(uuid, text, text, text, text) to authenticated;
grant execute on function public.super_admin_archive_administrator(uuid) to authenticated;
grant execute on function public.super_admin_reject_request(uuid, text) to authenticated;
grant execute on function public.get_user_dashboard() to authenticated;
grant execute on function public.set_contribution_setting(date, numeric, integer) to authenticated;

create or replace function public.super_admin_set_administrator_status(p_user_id uuid, p_status public.account_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can change administrator status.' using errcode = '42501'; end if;
  if p_status not in ('ACTIVE', 'DISABLED') then raise exception 'Administrator status must be ACTIVE or DISABLED.' using errcode = '22023'; end if;
  update public.profiles set status = p_status where id = p_user_id and role = 'ADMIN';
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'SUSPENDED' end where owner_id = p_user_id;
  perform public.push_notification(auth.uid(), 'ADMIN_STATUS', 'Administrator status changed', 'An administrator account is now ' || lower(p_status::text) || '.', 'super-admin.html#administrators');
end;
$$;

revoke execute on function public.super_admin_set_administrator_status(uuid, public.account_status) from public, anon;
grant execute on function public.super_admin_set_administrator_status(uuid, public.account_status) to authenticated;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name when 'contributions' then 'contribution' when 'withdrawals' then 'deduction' else 'expense' end;
begin
  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in select id from public.profiles where group_id = v_group and role = 'ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_admin.id, 'REVIEW_REQUIRED', 'New ' || v_label || ' submitted', 'A record is waiting for your review.', 'dashboard.html', v_group);
    end loop;
    if new.submitted_by is not null then perform public.push_notification(new.submitted_by, 'SUBMITTED', initcap(v_label) || ' submitted', 'Your record is waiting for administrator review.', 'user.html', v_group); end if;
  elsif tg_op = 'UPDATE' and old.approval_status = 'PENDING' and new.approval_status in ('CONFIRMED', 'REJECTED') and new.submitted_by is not null then
    perform public.push_notification(new.submitted_by, 'REVIEWED', initcap(v_label) || ' ' || lower(new.approval_status::text), 'Your submitted ' || v_label || ' was ' || lower(new.approval_status::text) || '.', 'user.html', v_group);
  elsif tg_op = 'UPDATE' and old.approval_status = new.approval_status and new.approval_status = 'PENDING' then
    for v_admin in select id from public.profiles where group_id = v_group and role = 'ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_admin.id, 'RECORD_UPDATED', initcap(v_label) || ' updated', 'A pending record was updated and remains ready for review.', 'dashboard.html', v_group);
    end loop;
  end if;
  return new;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['contributions', 'withdrawals', 'expenses'] loop
    execute format('drop trigger if exists %I_notifications on public.%I', v_table, v_table);
    execute format('create trigger %I_notifications after insert or update on public.%I for each row execute function public.notify_record_activity()', v_table, v_table);
  end loop;
end $$;

commit;

-- Migration 20261111_010: enable realtime dashboard refresh.
begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'members', 'groups', 'admin_requests', 'account_activity',
    'audit_logs', 'contribution_periods', 'contributions', 'withdrawals', 'expenses'
  ] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version, name)
values ('20261111_010', 'enable realtime dashboard refresh')
on conflict (version) do nothing;

commit;

-- Migration 20261112_013: complete operational workflows.
begin;

create or replace function public.admin_set_user_access(
  p_user_id uuid, p_role public.app_role, p_status public.account_status, p_member_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor_role public.app_role := public.current_user_role();
  v_actor_group uuid := public.current_group_id();
  v_member public.members;
begin
  if v_actor_role = 'SUPER_ADMIN' then
    if p_role not in ('SUPER_ADMIN', 'ADMIN') or p_member_id is not null then raise exception 'Super administrators can only manage platform administrator accounts.' using errcode = '42501'; end if;
    if p_role = 'SUPER_ADMIN' and p_user_id <> auth.uid() then raise exception 'Additional super administrator accounts cannot be assigned here.' using errcode = '42501'; end if;
    if p_user_id = auth.uid() and (p_role <> 'SUPER_ADMIN' or p_status <> 'ACTIVE') then raise exception 'You cannot remove or disable your own super administrator access.' using errcode = '22023'; end if;
    update public.profiles set role = p_role, status = p_status, member_id = null
    where id = p_user_id and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
  elsif v_actor_role = 'ADMIN' and v_actor_group is not null then
    if p_user_id = auth.uid() or p_role not in ('MEMBER', 'TREASURER') then raise exception 'Group administrators can only manage member and treasurer accounts in their own group.' using errcode = '42501'; end if;
    if p_role = 'MEMBER' and p_status = 'ACTIVE' and p_member_id is null then raise exception 'Active member accounts must be linked to a member.' using errcode = '22023'; end if;
    if p_role = 'TREASURER' and p_member_id is not null then raise exception 'Treasurer accounts cannot be linked to a member profile.' using errcode = '22023'; end if;
    if p_member_id is not null then
      select * into v_member from public.members where id = p_member_id and group_id = v_actor_group;
      if not found then raise exception 'The selected member does not belong to your savings group.' using errcode = '42501'; end if;
    end if;
    update public.profiles
    set role = p_role, status = p_status, member_id = case when p_role = 'MEMBER' then p_member_id end, group_id = v_actor_group,
        first_name = coalesce(first_name, v_member.first_name), middle_name = coalesce(middle_name, v_member.middle_name),
        last_name = coalesce(last_name, v_member.last_name), full_name = coalesce(nullif(btrim(full_name), ''), v_member.full_name),
        contact_number = coalesce(contact_number, v_member.contact_number)
    where id = p_user_id and role in ('MEMBER', 'TREASURER') and (group_id is null or group_id = v_actor_group);
  else
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;
  if not found then raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.reactivate_member(p_member_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can reactivate members.' using errcode = '42501'; end if;
  update public.members set status = 'ACTIVE' where id = p_member_id and group_id = public.current_group_id() and status = 'INACTIVE';
  if not found then raise exception 'Inactive member not found in your group.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.super_admin_reopen_request(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reopen administrator requests.' using errcode = '42501'; end if;
  update public.profiles set status = 'PENDING' where id = p_user_id and role = 'MEMBER' and status = 'DISABLED' and group_id is null and member_id is null;
  if not found then raise exception 'Rejected administrator request not found.' using errcode = 'P0002'; end if;
  update public.admin_requests set status = 'PENDING', reviewed_by = null, reviewed_at = null, review_note = null where requester_id = p_user_id and status = 'REJECTED';
end;
$$;

create or replace function public.generate_all_contribution_periods(p_month date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare v_month date := date_trunc('month', p_month)::date; v_count integer;
begin
  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select m.id, v_month, m.monthly_contribution_amount, public.contribution_period_due_date(m.group_id, v_month)
  from public.members m
  where m.status = 'ACTIVE' and m.date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_pending_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with gid as (
    select public.current_group_id() as group_id
  ),
  entries as (
    select
      c.id,
      c.amount,
      c.payment_date as activity_date,
      c.created_at,
      'contribution'::text as entry_type,
      'Savings Addition'::text as entry_label,
      m.full_name as member_name,
      coalesce(sp.full_name, m.full_name) as submitted_by_name,
      coalesce(
        public.group_member_avatar(m.id),
        case when sp.status = 'ACTIVE' then sp.avatar_url end
      ) as avatar_url,
      cp.period_month,
      null::text as category,
      c.transaction_reference as reference,
      c.notes,
      null::text as description
    from public.contributions c
    join gid on c.group_id = gid.group_id
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    left join public.profiles sp
      on sp.id = c.submitted_by
     and sp.group_id = c.group_id
    where c.approval_status = 'PENDING'

    union all

    select
      w.id,
      w.amount,
      w.transaction_date as activity_date,
      w.created_at,
      'withdrawal'::text as entry_type,
      'Deduction'::text as entry_label,
      w.person_responsible as member_name,
      coalesce(sp.full_name, w.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      w.category,
      w.reference_number as reference,
      w.notes,
      w.description
    from public.withdrawals w
    join gid on w.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = w.submitted_by
     and sp.group_id = w.group_id
    where w.approval_status = 'PENDING'

    union all

    select
      e.id,
      e.amount,
      e.transaction_date as activity_date,
      e.created_at,
      'expense'::text as entry_type,
      'Expense'::text as entry_label,
      e.person_responsible as member_name,
      coalesce(sp.full_name, e.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      e.category,
      e.reference_number as reference,
      e.notes,
      e.description
    from public.expenses e
    join gid on e.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = e.submitted_by
     and sp.group_id = e.group_id
    where e.approval_status = 'PENDING'
  ),
  recent as (
    select * from entries order by created_at desc limit 3
  )
  select case
    when public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and public.current_group_id() is not null
    then jsonb_build_object(
      'count', (select count(*) from entries),
      'amount', (select coalesce(sum(amount), 0) from entries),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'amount', amount,
              'date', activity_date,
              'type', entry_type,
              'entry_label', entry_label,
              'member_name', member_name,
              'submitted_by_name', submitted_by_name,
              'avatar_url', avatar_url,
              'period_month', period_month,
              'category', category,
              'reference', reference,
              'notes', notes,
              'description', description
            )
            order by created_at desc
          )
          from recent
        ),
        '[]'::jsonb
      )
    )
    else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb)
  end;
$$;

create or replace function public.record_account_activity(p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('LOGIN', 'PASSWORD_CHANGE') then raise exception 'Unsupported account activity.' using errcode = '22023'; end if;
  if not exists (select 1 from public.account_activity where user_id = auth.uid() and event = p_event and created_at > now() - interval '1 minute') then
    insert into public.account_activity (user_id, event) values (auth.uid(), p_event);
  end if;
end;
$$;

revoke execute on function public.contribution_period_due_date(uuid, date) from public, anon, authenticated;
revoke execute on function public.generate_all_contribution_periods(date) from public, anon, authenticated;
revoke execute on function public.reactivate_member(uuid) from public, anon;
revoke execute on function public.super_admin_reopen_request(uuid) from public, anon;
revoke execute on function public.get_pending_review_summary() from public, anon;
revoke execute on function public.record_account_activity(text) from public, anon;
grant execute on function public.reactivate_member(uuid) to authenticated;
grant execute on function public.super_admin_reopen_request(uuid) to authenticated;
grant execute on function public.get_pending_review_summary() to authenticated;
grant execute on function public.record_account_activity(text) to authenticated;

insert into public.schema_migrations (version, name) values ('20261112_013', 'complete operational workflows') on conflict (version) do nothing;

commit;

-- Migration 20261112_014: enforce opt-in multi-factor authentication.
begin;

create or replace function public.mfa_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    or not exists (
      select 1 from auth.mfa_factors
      where user_id = auth.uid() and status = 'verified'
    );
$$;

create or replace function public.current_user_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and public.mfa_access_allowed();
$$;

create or replace function public.current_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select member_id from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and public.mfa_access_allowed();
$$;

create or replace function public.current_group_id()
returns uuid language sql stable security definer set search_path = public as $$
  select group_id from public.profiles
  where id = auth.uid() and status = 'ACTIVE' and public.mfa_access_allowed();
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'profiles', 'members', 'contribution_settings', 'contribution_periods',
    'contributions', 'expenses', 'withdrawals', 'savings_goals', 'audit_logs',
    'groups', 'admin_requests', 'feature_requests', 'notifications', 'account_activity'
  ] loop
    execute format('drop policy if exists mfa_verified_for_opted_in on public.%I', v_table);
    execute format('create policy mfa_verified_for_opted_in on public.%I as restrictive for all to authenticated using (public.mfa_access_allowed()) with check (public.mfa_access_allowed())', v_table);
  end loop;
end;
$$;

revoke execute on function public.mfa_access_allowed() from public, anon;
grant execute on function public.mfa_access_allowed() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_014', 'enforce opt-in multi-factor authentication')
on conflict (version) do nothing;

commit;

-- Migration 20261112_019: publish savings_goals and contribution_settings for realtime refresh.
begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['savings_goals', 'contribution_settings'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version, name)
values ('20261112_019', 'enable remaining realtime tables')
on conflict (version) do nothing;

commit;

-- Migration 20261112_020: store bug reports and optional image attachments for Super Admin review.
begin;

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  image_count integer generated always as (jsonb_array_length(attachments)) stored,
  created_at timestamptz not null default now()
);

create index if not exists bug_reports_created_at_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists bug_reports_select on public.bug_reports;
create policy bug_reports_select on public.bug_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_super_admin());

drop policy if exists bug_reports_insert on public.bug_reports;
create policy bug_reports_insert on public.bug_reports for insert to authenticated
with check (reporter_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

drop policy if exists mfa_verified_for_opted_in on public.bug_reports;
create policy mfa_verified_for_opted_in on public.bug_reports as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bug_reports'
  ) then
    alter publication supabase_realtime add table public.bug_reports;
  end if;
end;
$$;

revoke all on public.bug_reports from public, anon, authenticated;
grant select on public.bug_reports to authenticated;
grant insert (reporter_id, title, description, attachments) on public.bug_reports to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_020', 'add bug reports')
on conflict (version) do nothing;

commit;

-- Migration 20261112_021: allow Super Admin user management and activity tracking for all user roles.
begin;

create or replace function public.super_admin_update_administrator(
  p_user_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_group_name text
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
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can edit user accounts.' using errcode = '42501';
  end if;

  select role into v_role
  from public.profiles
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER');

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' and char_length(btrim(coalesce(p_group_name, ''))) not between 2 and 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  update public.profiles
  set first_name = v_first,
      middle_name = v_middle,
      last_name = v_last,
      full_name = concat_ws(' ', v_first, v_middle, v_last)
  where id = p_user_id;

  if v_role = 'ADMIN' then
    update public.groups set name = btrim(p_group_name) where owner_id = p_user_id;
  end if;
end;
$$;

create or replace function public.super_admin_set_administrator_status(
  p_user_id uuid,
  p_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can change account status.' using errcode = '42501';
  end if;

  if p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'Account status must be ACTIVE or DISABLED.' using errcode = '22023';
  end if;

  update public.profiles
  set status = p_status
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups
    set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'SUSPENDED' end
    where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_STATUS',
    'Account status changed',
    'A user account is now ' || lower(p_status::text) || '.',
    'super-admin.html#administrators'
  );
end;
$$;

create or replace function public.super_admin_archive_administrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can archive user accounts.' using errcode = '42501';
  end if;

  update public.profiles
  set status = 'DISABLED'
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups set status = 'SUSPENDED' where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_ARCHIVED',
    'Account archived',
    'A user account was disabled.',
    'super-admin.html#administrators'
  );
end;
$$;

drop policy if exists account_activity_select on public.account_activity;
create policy account_activity_select on public.account_activity for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.is_super_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = user_id and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
    )
  )
);

insert into public.schema_migrations (version, name)
values ('20261112_021', 'super admin manage all users')
on conflict (version) do nothing;

commit;

-- Migration 20261112_022: add user display pictures and expose contributor avatars on the calendar view.
begin;

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  drop constraint if exists profiles_avatar_url_check;

alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url is null or (avatar_url ~ '^data:image/' and char_length(avatar_url) <= 600000));

create or replace function public.group_member_avatar(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.avatar_url
      from public.profiles p
      where p.member_id = p_member_id
        and p.group_id = public.current_group_id()
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
      limit 1
    ),
    (
      select p.avatar_url
      from public.members m
      join public.profiles p
        on p.group_id = m.group_id
       and p.status = 'ACTIVE'
       and lower(btrim(p.full_name)) = lower(btrim(m.full_name))
      where m.id = p_member_id
        and m.group_id = public.current_group_id()
        and p.avatar_url is not null
      limit 1
    )
  );
$$;

create or replace function public.update_own_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Please choose a valid picture under 500 KB.' using errcode = '22023';
  end if;

  update public.profiles
  set avatar_url = p_avatar_url
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.group_member_avatar(uuid) from public, anon;
grant execute on function public.group_member_avatar(uuid) to authenticated;

revoke execute on function public.update_own_avatar(text) from public, anon;
grant execute on function public.update_own_avatar(text) to authenticated;

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name,
       m.id as subject_member_id,
       public.group_member_avatar(m.id) as subject_avatar_url
from public.contributions c
join public.contribution_periods cp on cp.id = c.contribution_period_id
join public.members m on m.id = cp.member_id
where c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at,
       w.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

insert into public.schema_migrations (version, name)
values ('20261112_022', 'user avatars and calendar contributors')
on conflict (version) do nothing;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null check (char_length(btrim(author_name)) > 0),
  author_role public.app_role not null check (author_role in ('SUPER_ADMIN', 'ADMIN')),
  title text not null check (char_length(btrim(title)) > 0),
  description text not null check (char_length(btrim(description)) > 0),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  announcement_type text not null default 'GENERAL' check (announcement_type in ('GENERAL', 'RELEASE')),
  release_version text,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists announcements_active_created_idx
  on public.announcements (created_at desc)
  where deleted_at is null;

create unique index if not exists announcements_release_version_unique_idx
  on public.announcements (btrim(lower(release_version)))
  where deleted_at is null and release_version is not null;

alter table public.announcements enable row level security;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  public.current_user_role() is not null
  and (
    public.is_super_admin()
    or group_id is null
    or group_id = public.current_group_id()
  )
);

drop policy if exists mfa_verified_for_opted_in on public.announcements;
create policy mfa_verified_for_opted_in on public.announcements as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end;
$$;

create or replace function public.review_feature_request(
  p_request_id uuid,
  p_status text,
  p_release_version text default null
)
returns public.feature_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_row public.feature_requests;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can review feature requests.' using errcode = '42501';
  end if;

  if v_status not in ('PENDING', 'IMPLEMENTED', 'REJECTED') then
    raise exception 'Invalid feature request status.' using errcode = '22023';
  end if;

  update public.feature_requests
  set status = v_status,
      reviewed_at = case when v_status = 'PENDING' then null else now() end,
      reviewed_by = case when v_status = 'PENDING' then null else auth.uid() end,
      release_version = case when v_status = 'IMPLEMENTED' then nullif(btrim(coalesce(p_release_version, release_version, '')), '') else null end
  where id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Feature request not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.review_feature_request(uuid, text, text) from public, anon;
grant execute on function public.review_feature_request(uuid, text, text) to authenticated;

create or replace function public.create_announcement(
  p_id uuid default null,
  p_title text default '',
  p_description text default '',
  p_attachments jsonb default '[]'::jsonb,
  p_announcement_type text default 'GENERAL',
  p_release_version text default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_prefix text;
  v_item jsonb;
  v_path text;
  v_type text := upper(btrim(coalesce(p_announcement_type, 'GENERAL')));
  v_version text := nullif(btrim(coalesce(p_release_version, '')), '');
  v_row public.announcements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid() and status = 'ACTIVE';

  if not found or v_profile.role not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only the Owner or a Group Administrator can post announcements.' using errcode = '42501';
  end if;

  if v_profile.role = 'ADMIN' and v_profile.group_id is null then
    raise exception 'Administrator account is not assigned to a savings group.' using errcode = '42501';
  end if;

  if v_type not in ('GENERAL', 'RELEASE') then
    raise exception 'Invalid announcement type.' using errcode = '22023';
  end if;

  if v_type = 'RELEASE' then
    if v_profile.role <> 'SUPER_ADMIN' then
      raise exception 'Only the Super Admin can publish system release updates.' using errcode = '42501';
    end if;
    if v_version is null then
      raise exception 'Release version is required for system release updates.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.announcements
      where deleted_at is null
        and lower(btrim(coalesce(release_version, ''))) = lower(v_version)
    ) then
      raise exception 'Release version "%" has already been published. Please use a unique version.', v_version using errcode = '23505';
    end if;
  else
    v_version := null;
  end if;

  if char_length(btrim(coalesce(p_title, ''))) = 0 or char_length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Announcement title and description are required.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Announcement attachments must be a JSON array.' using errcode = '22023';
  end if;

  v_prefix := case
    when v_profile.role = 'SUPER_ADMIN' then 'platform/' || v_profile.id::text || '/'
    else 'group/' || v_profile.group_id::text || '/'
  end;

  for v_item in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_path := coalesce(v_item->>'path', '');
    if v_path = '' or position('..' in v_path) > 0 or left(v_path, char_length(v_prefix)) <> v_prefix then
      raise exception 'Invalid attachment storage path.' using errcode = '42501';
    end if;
  end loop;

  insert into public.announcements (
    id, group_id, author_id, author_name, author_role, title, description, attachments, announcement_type, release_version
  ) values (
    v_id,
    case when v_profile.role = 'SUPER_ADMIN' then null else v_profile.group_id end,
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    btrim(p_title),
    btrim(p_description),
    coalesce(p_attachments, '[]'::jsonb),
    v_type,
    v_version
  )
  returning * into v_row;

  if v_type = 'RELEASE' and v_version is not null then
    update public.feature_requests
    set release_version = v_version
    where status = 'IMPLEMENTED' and release_version is null;
  end if;

  return v_row;
end;
$$;

create or replace function public.get_release_features(p_release_version text)
returns table (
  id uuid,
  title text,
  details text,
  requester_id uuid,
  requester_name text,
  requester_avatar_url text,
  allow_credit boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.id,
    f.title,
    f.details,
    case when f.allow_credit then f.requester_id else null end as requester_id,
    case when f.allow_credit then coalesce(p.full_name, 'Contributor') else 'Community Member' end as requester_name,
    case when f.allow_credit then p.avatar_url else null end as requester_avatar_url,
    f.allow_credit,
    f.created_at
  from public.feature_requests f
  left join public.profiles p on p.id = f.requester_id
  where f.status = 'IMPLEMENTED'
    and f.release_version = nullif(btrim(p_release_version), '')
  order by f.created_at asc;
$$;

revoke all on function public.get_release_features(text) from public, anon;
grant execute on function public.get_release_features(text) to authenticated;

create or replace function public.delete_announcement(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements;
  v_attachments jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if public.current_user_role() not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only the Owner or a Group Administrator can delete announcements.' using errcode = '42501';
  end if;

  select * into v_row
  from public.announcements
  where id = p_announcement_id and deleted_at is null;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  if not (public.is_super_admin() or (v_row.author_role = 'ADMIN' and v_row.group_id = public.current_group_id())) then
    raise exception 'You are not allowed to delete this announcement.' using errcode = '42501';
  end if;

  v_attachments := coalesce(v_row.attachments, '[]'::jsonb);

  update public.announcements
  set deleted_at = now(),
      title = '',
      description = '',
      attachments = '[]'::jsonb
  where id = p_announcement_id;

  return v_attachments;
end;
$$;

revoke all on public.announcements from public, anon, authenticated;
grant select on public.announcements to authenticated;

revoke execute on function public.create_announcement(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_announcement(uuid, text, text, jsonb) to authenticated;

revoke execute on function public.delete_announcement(uuid) from public, anon;
grant execute on function public.delete_announcement(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_023', 'add announcements')
on conflict (version) do nothing;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  (public.is_super_admin() and group_id is null)
  or (
    public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
    and (
      group_id is null
      or (public.current_group_id() is not null and group_id = public.current_group_id())
    )
  )
);

create or replace function public.announcement_author_avatar(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.avatar_url
  from public.profiles p
  where p.id = p_author_id
    and p.status = 'ACTIVE'
    and public.current_user_role() is not null
    and (
      p.role = 'SUPER_ADMIN'
      or (
        public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
        and p.role = 'ADMIN'
        and public.current_group_id() is not null
        and p.group_id = public.current_group_id()
      )
    );
$$;

create or replace view public.v_announcements
with (security_invoker = true)
as
select a.id,
       a.group_id,
       a.author_id,
       a.author_name,
       a.author_role,
       public.announcement_author_avatar(a.author_id) as author_avatar_url,
       a.title,
       a.description,
       a.attachments,
       a.created_at,
       a.announcement_type,
       a.release_version
from public.announcements a
where a.deleted_at is null;

revoke execute on function public.announcement_author_avatar(uuid) from public, anon;
grant execute on function public.announcement_author_avatar(uuid) to authenticated;

revoke all on public.v_announcements from public, anon;
grant select on public.v_announcements to authenticated;

alter table public.members
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

alter table public.profiles
  add column if not exists previous_account_status public.account_status;

alter table public.announcements
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

create index if not exists members_group_active_idx
  on public.members (group_id, full_name)
  where deleted_at is null;

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
  and deleted_at is null
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  deleted_at is null
  and (
    (public.is_super_admin() and group_id is null)
    or (
      public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and (
        group_id is null
        or (public.current_group_id() is not null and group_id = public.current_group_id())
      )
    )
  )
);

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
where m.deleted_at is null
  and (m.status = 'ACTIVE' or c.id is not null)
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount;

create or replace function public.group_member_avatar(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.avatar_url
      from public.profiles p
      join public.members m on m.id = p.member_id
      where p.member_id = p_member_id
        and p.group_id = public.current_group_id()
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
        and m.deleted_at is null
      limit 1
    ),
    (
      select p.avatar_url
      from public.members m
      join public.profiles p
        on p.group_id = m.group_id
       and p.status = 'ACTIVE'
       and lower(btrim(p.full_name)) = lower(btrim(m.full_name))
      where m.id = p_member_id
        and m.group_id = public.current_group_id()
        and m.deleted_at is null
        and p.avatar_url is not null
      limit 1
    )
  );
$$;

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name,
       m.id as subject_member_id,
       public.group_member_avatar(m.id) as subject_avatar_url
from public.contributions c
join public.contribution_periods cp on cp.id = c.contribution_period_id
join public.members m on m.id = cp.member_id
where m.deleted_at is null
  and c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at,
       w.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

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
  where id = p_member_id
    and group_id = public.current_group_id()
    and deleted_at is null;

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
  where id = p_member_id
    and group_id = public.current_group_id()
    and status = 'ACTIVE'
    and deleted_at is null;

  if not found then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.reactivate_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can reactivate members.' using errcode = '42501';
  end if;

  update public.members
  set status = 'ACTIVE',
      updated_by = auth.uid()
  where id = p_member_id
    and group_id = public.current_group_id()
    and status = 'INACTIVE'
    and deleted_at is null;

  if not found then
    raise exception 'Inactive member not found in your group.' using errcode = 'P0002';
  end if;
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
  v_group_id uuid := public.current_group_id();
  v_due_date date;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can generate contribution periods.' using errcode = '42501';
  end if;

  v_due_date := public.contribution_period_due_date(v_group_id, v_month);

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select id, v_month, monthly_contribution_amount, v_due_date
  from public.members
  where status = 'ACTIVE'
    and deleted_at is null
    and group_id = v_group_id
    and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.generate_all_contribution_periods(p_month date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_count integer;
begin
  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select
    m.id,
    v_month,
    m.monthly_contribution_amount,
    public.contribution_period_due_date(m.group_id, v_month)
  from public.members m
  where m.status = 'ACTIVE'
    and m.deleted_at is null
    and m.date_registered <= (v_month + interval '1 month - 1 day')::date
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
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_period_id uuid;
  v_required numeric(14,2);
  v_id uuid;
  v_status public.approval_status;
  v_month date := date_trunc('month', p_contribution_month)::date;
begin
  if v_role is null or v_group_id is null then
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
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month)
  )
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

drop function if exists public.delete_announcement(uuid);

create or replace function public.delete_announcement(
  p_announcement_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if public.current_user_role() not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only the Owner or a Group Administrator can delete announcements.' using errcode = '42501';
  end if;

  select * into v_row
  from public.announcements
  where id = p_announcement_id and deleted_at is null;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  if not (public.is_super_admin() or (v_row.author_role = 'ADMIN' and v_row.group_id = public.current_group_id())) then
    raise exception 'You are not allowed to delete this announcement.' using errcode = '42501';
  end if;

  update public.announcements
  set deleted_at = now(),
      deleted_by = auth.uid(),
      delete_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_announcement_id;

  return coalesce(v_row.attachments, '[]'::jsonb);
end;
$$;

create or replace function public.delete_member(
  p_member_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_member public.members;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can delete members.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Please select or enter a deletion reason between 3 and 500 characters.' using errcode = '22023';
  end if;

  select * into v_member
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    where cp.member_id = p_member_id
  ) then
    raise exception 'Members with contribution data cannot be deleted. Deactivate this member instead.' using errcode = 'P0001';
  end if;

  update public.members
  set deleted_at = now(),
      deleted_by = auth.uid(),
      delete_reason = v_reason,
      updated_by = auth.uid()
  where id = p_member_id;

  update public.profiles
  set previous_account_status = case
        when status <> 'DISABLED' then status
        else coalesce(previous_account_status, status)
      end,
      status = 'DISABLED'
  where member_id = p_member_id
    and group_id = v_group_id
    and role = 'MEMBER';
end;
$$;

create or replace function public.get_bin_items(p_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := nullif(lower(btrim(coalesce(p_type, ''))), '');
  v_cutoff timestamptz := now() - interval '1 month';
  v_items jsonb;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can view the bin.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_type is not null and v_type not in ('member', 'announcement') then
    raise exception 'Invalid bin item filter.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(row_to_json(entry)::jsonb order by entry.deleted_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      'member'::text as item_type,
      'Member'::text as type_label,
      m.id as item_id,
      m.full_name as title,
      concat_ws(
        ' · ',
        m.status::text,
        nullif(m.contact_number, ''),
        'Registered ' || to_char(m.date_registered, 'Mon DD, YYYY')
      ) as subtitle,
      coalesce(m.delete_reason, 'No reason provided') as reason,
      coalesce(dp.full_name, 'Group Administrator') as deleted_by_name,
      m.deleted_at,
      (m.deleted_at + interval '1 month') as expires_at
    from public.members m
    left join public.profiles dp on dp.id = m.deleted_by
    where m.group_id = v_group_id
      and m.deleted_at is not null
      and m.deleted_at >= v_cutoff
      and (v_type is null or v_type = 'member')

    union all

    select
      'announcement'::text as item_type,
      'Announcement'::text as type_label,
      a.id as item_id,
      a.title,
      left(btrim(a.description), 110)
        || case when char_length(btrim(a.description)) > 110 then '…' else '' end as subtitle,
      coalesce(a.delete_reason, 'Removed from announcements') as reason,
      coalesce(dp.full_name, a.author_name, 'Group Administrator') as deleted_by_name,
      a.deleted_at,
      (a.deleted_at + interval '1 month') as expires_at
    from public.announcements a
    left join public.profiles dp on dp.id = a.deleted_by
    where a.group_id = v_group_id
      and a.author_role = 'ADMIN'
      and a.deleted_at is not null
      and a.deleted_at >= v_cutoff
      and char_length(btrim(a.title)) > 0
      and char_length(btrim(a.description)) > 0
      and (v_type is null or v_type = 'announcement')
  ) entry;

  return v_items;
end;
$$;

create or replace function public.recover_bin_item(
  p_item_type text,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := lower(btrim(coalesce(p_item_type, '')));
  v_cutoff timestamptz := now() - interval '1 month';
  v_member public.members;
  v_announcement public.announcements;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can recover deleted items.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_type = 'member' then
    select * into v_member
    from public.members
    where id = p_item_id
      and group_id = v_group_id
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted member not found in bin.' using errcode = 'P0002';
    end if;

    if v_member.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    update public.members
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null,
        updated_by = auth.uid()
    where id = p_item_id;

    update public.profiles
    set status = coalesce(previous_account_status, status),
        previous_account_status = null
    where member_id = p_item_id
      and group_id = v_group_id
      and role = 'MEMBER'
      and previous_account_status is not null;
  elsif v_type = 'announcement' then
    select * into v_announcement
    from public.announcements
    where id = p_item_id
      and group_id = v_group_id
      and author_role = 'ADMIN'
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted announcement not found in bin.' using errcode = 'P0002';
    end if;

    if v_announcement.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    if char_length(btrim(coalesce(v_announcement.title, ''))) = 0
       or char_length(btrim(coalesce(v_announcement.description, ''))) = 0 then
      raise exception 'This announcement can no longer be recovered.' using errcode = 'P0001';
    end if;

    update public.announcements
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null
    where id = p_item_id;
  else
    raise exception 'Unsupported bin item type.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.delete_announcement(uuid, text) from public, anon;
grant execute on function public.delete_announcement(uuid, text) to authenticated;

revoke execute on function public.delete_member(uuid, text) from public, anon;
grant execute on function public.delete_member(uuid, text) to authenticated;

revoke execute on function public.get_bin_items(text) from public, anon;
grant execute on function public.get_bin_items(text) to authenticated;

revoke execute on function public.recover_bin_item(text, uuid) from public, anon;
grant execute on function public.recover_bin_item(text, uuid) to authenticated;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name
    when 'contributions' then 'contribution'
    when 'withdrawals' then 'deduction'
    else 'expense'
  end;
  v_status text := lower(new.approval_status::text);
  v_submitter_role public.app_role;
  v_link text;
  v_reason text;
  v_message text;
begin
  if new.submitted_by is not null then
    select role into v_submitter_role from public.profiles where id = new.submitted_by;
    v_link := case
      when tg_table_name = 'contributions' and v_submitter_role = 'MEMBER' then 'user.html'
      when tg_table_name = 'contributions' then 'contributions.html'
      when tg_table_name = 'withdrawals' then 'withdrawals.html'
      else 'expenses.html'
    end;
  end if;

  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in
      select id
      from public.profiles
      where group_id = v_group
        and role = 'ADMIN'
        and status = 'ACTIVE'
    loop
      perform public.push_notification(
        v_admin.id,
        'REVIEW_REQUIRED',
        'New ' || v_label || ' submitted',
        'A record is waiting for your review.',
        'dashboard.html',
        v_group
      );
    end loop;
    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        'SUBMITTED',
        initcap(v_label) || ' submitted',
        'Your record is waiting for administrator review.',
        v_link,
        v_group
      );
    end if;
  elsif tg_op = 'UPDATE'
    and new.submitted_by is not null
    and (
      (old.approval_status = 'PENDING' and new.approval_status in ('CONFIRMED', 'REJECTED'))
      or (old.approval_status = 'CONFIRMED' and new.approval_status = 'VOIDED')
    )
  then
    v_reason := nullif(btrim(coalesce(
      case when new.approval_status = 'VOIDED' then new.void_reason else new.review_note end,
      ''
    )), '');
    v_message := case
      when new.approval_status = 'VOIDED' then 'Your ' || v_label || ' was voided.'
      else 'Your submitted ' || v_label || ' was ' || v_status || '.'
    end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end;
    if char_length(v_message) > 500 then
      v_message := left(v_message, 499) || '…';
    end if;
    perform public.push_notification(
      new.submitted_by,
      case when new.approval_status = 'VOIDED' then 'VOIDED' else 'REVIEWED' end,
      initcap(v_label) || ' ' || v_status,
      v_message,
      v_link,
      v_group
    );
  elsif tg_op = 'UPDATE'
    and old.approval_status = new.approval_status
    and new.approval_status = 'PENDING'
  then
    for v_admin in
      select id
      from public.profiles
      where group_id = v_group
        and role = 'ADMIN'
        and status = 'ACTIVE'
    loop
      perform public.push_notification(
        v_admin.id,
        'RECORD_UPDATED',
        initcap(v_label) || ' updated',
        'A pending record was updated and remains ready for review.',
        'dashboard.html',
        v_group
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name,
       m.id as subject_member_id,
       public.group_member_avatar(m.id) as subject_avatar_url,
       c.review_note
from public.contributions c
join public.contribution_periods cp on cp.id = c.contribution_period_id
join public.members m on m.id = cp.member_id
where m.deleted_at is null
  and c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at,
       w.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url,
       w.review_note
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url,
       e.review_note
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

insert into public.schema_migrations (version, name)
values
  ('20261112_024', 'announcement avatars and group scope'),
  ('20261112_025', 'fix contribution period due date'),
  ('20261112_026', 'fix review notification cast and enrich pending summary'),
  ('20261112_027', 'add member soft delete and recycle bin'),
  ('20261112_028', 'include review reason in notifications and calendar')
on conflict (version) do nothing;

commit;


-- Migration 20261112_029: Multi-group workspaces, editable group name/DP, admin contributor toggle, and group memberships.
begin;

alter table public.groups
  drop constraint if exists groups_owner_id_key;

alter table public.groups
  add column if not exists avatar_url text;

alter table public.groups
  drop constraint if exists groups_avatar_url_check;

alter table public.groups
  add constraint groups_avatar_url_check
  check (avatar_url is null or (avatar_url ~ '^data:image/' and char_length(avatar_url) <= 600000));

create table if not exists public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null check (role in ('ADMIN', 'TREASURER', 'MEMBER')),
  status public.account_status not null default 'ACTIVE',
  member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id),
  unique (group_id, member_id)
);

create index if not exists group_memberships_user_status_idx
  on public.group_memberships (user_id, status);

drop trigger if exists group_memberships_updated_at on public.group_memberships;
create trigger group_memberships_updated_at before update on public.group_memberships
for each row execute function public.set_updated_at();

alter table public.group_memberships enable row level security;
alter table public.group_memberships force row level security;

drop policy if exists mfa_verified_for_opted_in on public.group_memberships;
create policy mfa_verified_for_opted_in on public.group_memberships
as restrictive for all to authenticated
using (public.mfa_access_allowed());

drop policy if exists group_memberships_select on public.group_memberships;
create policy group_memberships_select on public.group_memberships for select to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or (public.is_admin() and group_id = public.current_group_id())
);

-- Backfill existing profiles into group_memberships.
insert into public.group_memberships (group_id, user_id, role, status, member_id)
select p.group_id, p.id, p.role, p.status, p.member_id
from public.profiles p
where p.group_id is not null
  and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
on conflict (group_id, user_id) do update
set role = excluded.role,
    status = excluded.status,
    member_id = coalesce(public.group_memberships.member_id, excluded.member_id);

-- Allow authenticated users to inspect any active group they belong to.
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
using (
  public.is_super_admin()
  or id = public.current_group_id()
  or exists (
    select 1
    from public.group_memberships gm
    where gm.group_id = groups.id
      and gm.user_id = auth.uid()
      and gm.status = 'ACTIVE'
  )
);

-- Keep avatar resolution accurate for Owner (SUPER_ADMIN) and across multiple groups via group_memberships.
create or replace function public.announcement_author_avatar(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.avatar_url
  from public.profiles p
  where p.id = p_author_id
    and p.status = 'ACTIVE'
    and public.current_user_role() is not null
    and (
      p.role = 'SUPER_ADMIN'
      or public.current_user_role() = 'SUPER_ADMIN'
      or (
        public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
        and public.current_group_id() is not null
        and (
          exists (
            select 1
            from public.group_memberships gm
            where gm.user_id = p.id
              and gm.group_id = public.current_group_id()
              and gm.role = 'ADMIN'
              and gm.status = 'ACTIVE'
          )
          or (
            p.role = 'ADMIN'
            and p.group_id = public.current_group_id()
          )
        )
      )
    )
  limit 1;
$$;

create or replace function public.group_member_avatar(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.avatar_url
      from public.group_memberships gm
      join public.profiles p on p.id = gm.user_id
      join public.members m on m.id = gm.member_id
      where gm.member_id = p_member_id
        and gm.group_id = public.current_group_id()
        and gm.status = 'ACTIVE'
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
        and m.deleted_at is null
      limit 1
    ),
    (
      select p.avatar_url
      from public.profiles p
      join public.members m on m.id = p.member_id
      where p.member_id = p_member_id
        and p.group_id = public.current_group_id()
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
        and m.deleted_at is null
      limit 1
    ),
    (
      select p.avatar_url
      from public.members m
      join public.group_memberships gm
        on gm.group_id = m.group_id
       and gm.status = 'ACTIVE'
      join public.profiles p
        on p.id = gm.user_id
       and p.status = 'ACTIVE'
       and lower(btrim(p.full_name)) = lower(btrim(m.full_name))
      where m.id = p_member_id
        and m.group_id = public.current_group_id()
        and m.deleted_at is null
        and p.avatar_url is not null
      limit 1
    )
  );
$$;

-- Keep super_admin group creation / approval / update in sync with group_memberships.
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

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_admin_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  return v_group_id;
end;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text := btrim(coalesce(p_group_name, ''));
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if char_length(v_group_name) < 2 or char_length(v_group_name) > 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;

  update public.profiles set role = 'ADMIN', status = 'ACTIVE', member_id = null
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;
  update public.profiles set group_id = v_group_id where id = p_user_id;
  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_user_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE', member_id = null;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_APPROVED', 'Administrator access approved', 'Your administrator account and savings group are ready.', 'dashboard.html', v_group_id);
  perform public.push_notification(auth.uid(), 'ADMIN_CREATED', 'Administrator account created', v_group_name || ' is now active.', 'super-admin.html#administrators');
  return v_group_id;
end;
$$;

create or replace function public.super_admin_update_administrator(
  p_user_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_group_name text
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
  v_target_group uuid;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can edit administrators.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_group_name, ''))) not between 2 and 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;
  update public.profiles set first_name = v_first, middle_name = v_middle, last_name = v_last, full_name = concat_ws(' ', v_first, v_middle, v_last)
  where id = p_user_id and role = 'ADMIN'
  returning group_id into v_target_group;
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups
  set name = btrim(p_group_name)
  where owner_id = p_user_id
    and id = coalesce(v_target_group, (select g.id from public.groups g where g.owner_id = p_user_id order by g.created_at asc limit 1));
end;
$$;

-- Multi-group-aware admin access assignment (supports existing accounts across groups too).
create or replace function public.admin_set_user_access(
  p_user_id uuid, p_role public.app_role, p_status public.account_status, p_member_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor_role public.app_role := public.current_user_role();
  v_actor_group uuid := public.current_group_id();
  v_member public.members;
  v_target public.profiles;
  v_link_member_id uuid;
begin
  if v_actor_role = 'SUPER_ADMIN' then
    if p_role not in ('SUPER_ADMIN', 'ADMIN') or p_member_id is not null then raise exception 'Super administrators can only manage platform administrator accounts.' using errcode = '42501'; end if;
    if p_role = 'SUPER_ADMIN' and p_user_id <> auth.uid() then raise exception 'Additional super administrator accounts cannot be assigned here.' using errcode = '42501'; end if;
    if p_user_id = auth.uid() and (p_role <> 'SUPER_ADMIN' or p_status <> 'ACTIVE') then raise exception 'You cannot remove or disable your own super administrator access.' using errcode = '22023'; end if;
    update public.profiles set role = p_role, status = p_status, member_id = null
    where id = p_user_id and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
    if not found then raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002'; end if;
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

  -- Update active profile context only when this user has no other active group selected.
  if v_target.group_id is null or v_target.group_id = v_actor_group then
    update public.profiles
    set role = p_role,
        status = p_status,
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

-- List active groups that the signed-in user belongs to.
create or replace function public.get_my_groups()
returns table (
  group_id uuid,
  name text,
  avatar_url text,
  role public.app_role,
  status public.account_status,
  member_id uuid,
  is_current boolean,
  is_contributor boolean,
  active_member_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.group_id as current_group_id, p.role as current_role, p.member_id as current_member_id
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
  ),
  my_groups as (
    select
      g.id as group_id,
      g.name,
      g.avatar_url,
      coalesce(gm.role, me.current_role) as role,
      coalesce(gm.status, 'ACTIVE'::public.account_status) as status,
      coalesce(gm.member_id, case when me.current_group_id = g.id then me.current_member_id else null end) as member_id,
      (me.current_group_id = g.id) as is_current,
      g.created_at
    from me
    join public.groups g on g.status = 'ACTIVE'
    left join public.group_memberships gm
      on gm.group_id = g.id
     and gm.user_id = me.id
    where (gm.id is not null and gm.status = 'ACTIVE')
       or g.id = me.current_group_id
  )
  select
    mg.group_id,
    mg.name,
    mg.avatar_url,
    mg.role,
    mg.status,
    mg.member_id,
    mg.is_current,
    exists (
      select 1
      from public.members m
      where m.id = mg.member_id
        and m.group_id = mg.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null
    ) as is_contributor,
    (
      select count(*)
      from public.members m
      where m.group_id = mg.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null
    ) as active_member_count,
    mg.created_at
  from my_groups mg
  order by mg.is_current desc, mg.created_at asc;
$$;

-- Switch the active group context of the signed-in user.
create or replace function public.switch_active_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gm public.group_memberships;
  v_group public.groups;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and status = 'ACTIVE' and role <> 'SUPER_ADMIN'
  ) then
    raise exception 'Only active group users can switch workspaces.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = p_group_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active savings group not found.' using errcode = 'P0002';
  end if;

  select * into v_gm
  from public.group_memberships
  where group_id = p_group_id
    and user_id = auth.uid()
    and status = 'ACTIVE';

  if not found then
    raise exception 'You do not have active access to that group.' using errcode = '42501';
  end if;

  if v_gm.role = 'MEMBER' then
    v_member_id := v_gm.member_id;
  elsif v_gm.role = 'ADMIN' and v_gm.member_id is not null then
    select m.id into v_member_id
    from public.members m
    where m.id = v_gm.member_id
      and m.group_id = p_group_id
      and m.status = 'ACTIVE'
      and m.deleted_at is null;
  else
    v_member_id := null;
  end if;

  update public.profiles
  set group_id = v_gm.group_id,
      role = v_gm.role,
      member_id = v_member_id
  where id = auth.uid();

  return jsonb_build_object(
    'group_id', v_group.id,
    'name', v_group.name,
    'role', v_gm.role,
    'member_id', v_member_id
  );
end;
$$;

-- Allow group admins to edit group name and group chat display picture.
create or replace function public.update_group_profile(
  p_name text,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can edit group details.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  update public.groups
  set name = v_name,
      avatar_url = case
        when p_clear_avatar then null
        when p_avatar_url is not null then p_avatar_url
        else avatar_url
      end
  where id = v_group_id;

  if not found then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- Toggle whether the current Group Admin also participates as a contributor in their active group.
create or replace function public.set_admin_contributor(
  p_enabled boolean,
  p_monthly_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_profile public.profiles;
  v_gm public.group_memberships;
  v_member_id uuid;
  v_default_amount numeric;
  v_amount numeric;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update contributor participation.' using errcode = '42501';
  end if;

  if p_monthly_amount is not null and (p_monthly_amount <= 0 or p_monthly_amount > 1000000) then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, auth.uid(), 'ADMIN', 'ACTIVE', v_profile.member_id)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE'
  returning * into v_gm;

  v_member_id := coalesce(v_profile.member_id, v_gm.member_id);

  if p_enabled then
    select cs.default_amount into v_default_amount
    from public.contribution_settings cs
    where cs.group_id = v_group_id
      and cs.effective_month <= date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date
    order by cs.effective_month desc
    limit 1;

    v_amount := round(coalesce(p_monthly_amount, v_default_amount, 100), 2);

    if v_member_id is not null then
      select m.id into v_member_id
      from public.members m
      where m.id = v_member_id
        and m.group_id = v_group_id
        and m.deleted_at is null;
    end if;

    if v_member_id is null then
      select m.id into v_member_id
      from public.members m
      where m.group_id = v_group_id
        and m.deleted_at is null
        and lower(btrim(m.full_name)) = lower(btrim(v_profile.full_name))
        and not exists (
          select 1 from public.group_memberships gm2
          where gm2.group_id = v_group_id and gm2.member_id = m.id and gm2.user_id <> auth.uid()
        )
        and not exists (
          select 1 from public.profiles p2
          where p2.group_id = v_group_id and p2.member_id = m.id and p2.id <> auth.uid()
        )
      order by m.created_at asc
      limit 1;
    end if;

    if v_member_id is not null then
      update public.members
      set status = 'ACTIVE',
          deactivated_at = null,
          monthly_contribution_amount = coalesce(p_monthly_amount, monthly_contribution_amount),
          updated_by = auth.uid()
      where id = v_member_id;
    else
      v_full := btrim(coalesce(nullif(v_profile.full_name, ''), split_part(coalesce(v_profile.email, 'Group Admin'), '@', 1)));
      v_first := coalesce(nullif(btrim(v_profile.first_name), ''), nullif(split_part(v_full, ' ', 1), ''), 'Group');
      v_middle := nullif(btrim(v_profile.middle_name), '');
      v_last := coalesce(nullif(btrim(v_profile.last_name), ''), nullif(btrim(substr(v_full, char_length(split_part(v_full, ' ', 1)) + 1)), ''), 'Admin');

      insert into public.members (
        group_id, first_name, middle_name, last_name, full_name,
        contact_number, date_registered, monthly_contribution_amount,
        status, notes, created_by
      ) values (
        v_group_id,
        v_first,
        v_middle,
        v_last,
        concat_ws(' ', v_first, v_middle, v_last),
        coalesce(nullif(btrim(v_profile.contact_number), ''), '09000000000'),
        (now() at time zone 'Asia/Manila')::date,
        v_amount,
        'ACTIVE',
        'Group administrator contributor',
        auth.uid()
      )
      returning id into v_member_id;
    end if;

    update public.group_memberships
    set member_id = v_member_id
    where group_id = v_group_id and user_id = auth.uid();

    update public.profiles
    set member_id = v_member_id
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', true, 'member_id', v_member_id);
  else
    if v_member_id is not null then
      update public.members
      set status = 'INACTIVE',
          deactivated_at = now(),
          updated_by = auth.uid()
      where id = v_member_id
        and group_id = v_group_id
        and deleted_at is null;

      delete from public.contribution_periods cp
      where cp.member_id = v_member_id
        and not exists (
          select 1 from public.contributions c
          where c.contribution_period_id = cp.id
        );
    end if;

    update public.profiles
    set member_id = null
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', false, 'member_id', null);
  end if;
end;
$$;

-- Allow an active Admin to create an additional savings group and immediately switch into it.
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
  if not public.is_admin() then
    raise exception 'Only a group administrator can create a savings group.' using errcode = '42501';
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
  values (v_new_group_id, auth.uid(), 'ADMIN', 'ACTIVE', null);

  update public.profiles
  set group_id = v_new_group_id,
      role = 'ADMIN',
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

-- List user accounts belonging to the current active group for Settings -> Account access.
create or replace function public.get_group_access_list()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  status public.account_status,
  member_id uuid,
  member_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gm.user_id,
    p.full_name,
    p.email,
    gm.role,
    gm.status,
    gm.member_id,
    m.full_name as member_name
  from public.group_memberships gm
  join public.profiles p on p.id = gm.user_id
  left join public.members m on m.id = gm.member_id and m.deleted_at is null
  where public.is_admin()
    and gm.group_id = public.current_group_id()
    and p.role <> 'SUPER_ADMIN'
  order by
    case gm.role
      when 'ADMIN' then 0
      when 'TREASURER' then 1
      else 2
    end,
    p.full_name asc;
$$;

revoke execute on function public.announcement_author_avatar(uuid) from public, anon;
revoke execute on function public.group_member_avatar(uuid) from public, anon;
revoke execute on function public.get_my_groups() from public, anon;
revoke execute on function public.switch_active_group(uuid) from public, anon;
revoke execute on function public.update_group_profile(text, text, boolean) from public, anon;
revoke execute on function public.set_admin_contributor(boolean, numeric) from public, anon;
revoke execute on function public.admin_create_group(text, text, boolean, numeric) from public, anon;
revoke execute on function public.get_group_access_list() from public, anon;

grant execute on function public.announcement_author_avatar(uuid) to authenticated;
grant execute on function public.group_member_avatar(uuid) to authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.switch_active_group(uuid) to authenticated;
grant execute on function public.update_group_profile(text, text, boolean) to authenticated;
grant execute on function public.set_admin_contributor(boolean, numeric) to authenticated;
grant execute on function public.admin_create_group(text, text, boolean, numeric) to authenticated;
grant execute on function public.get_group_access_list() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_029', 'multi groups, group dp, and admin contributor toggle')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261112_030', 'restore owner and multi-group announcement author avatars')
on conflict (version) do nothing;

create or replace function public.check_admin_request_eligibility(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_request record;
  v_profile record;
begin
  if v_email = '' or v_email not like '%@%.%' then
    return jsonb_build_object('eligible', false, 'reason', 'invalid_email', 'message', 'Please provide a valid email address.');
  end if;

  select status, review_note, created_at into v_request
  from public.admin_requests
  where lower(email) = v_email
  order by created_at desc
  limit 1;

  if v_request.status = 'REJECTED' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'rejected',
      'message', 'This email address was previously declined for administrator access and cannot request again.',
      'review_note', v_request.review_note
    );
  end if;

  if v_request.status = 'PENDING' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'pending',
      'message', 'An administrator request for this email is already awaiting Super Admin review.'
    );
  end if;

  select role, status into v_profile
  from public.profiles
  where lower(email) = v_email
  limit 1;

  if v_profile.status = 'DISABLED' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'disabled',
      'message', 'This account has been disabled and cannot submit an administrator request.'
    );
  end if;

  if v_profile.status = 'ACTIVE' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'active',
      'message', 'An account already exists for this email address. Please sign in instead.'
    );
  end if;

  return jsonb_build_object('eligible', true);
end;
$$;

revoke execute on function public.check_admin_request_eligibility(text) from public;
grant execute on function public.check_admin_request_eligibility(text) to anon, authenticated;

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

  if v_account_kind = 'ADMIN_REQUEST' then
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
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', 'PENDING')
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

create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'A reason of at least 3 characters is required when rejecting an administrator request.' using errcode = '22023';
  end if;
  update public.profiles set status = 'DISABLED'
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;
  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', v_note, null);
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261113_031', 'block rejected admin request emails and add eligibility check')
on conflict (version) do nothing;

create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null check (char_length(code) = 6),
  purpose text not null default 'ADMIN_REQUEST',
  metadata jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verifications_lookup_idx
on public.email_verifications (lower(email), purpose, created_at desc);

alter table public.email_verifications enable row level security;
revoke all on public.email_verifications from public, anon;
grant select on public.email_verifications to authenticated;

create or replace function public.request_admin_email_verification(p_email text, p_full_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_eligibility jsonb;
  v_recent_count integer;
  v_code text;
begin
  if v_email = '' or v_email not like '%@%.%' then
    return jsonb_build_object('success', false, 'message', 'Please provide a valid email address.');
  end if;

  v_eligibility := public.check_admin_request_eligibility(v_email);
  if not coalesce((v_eligibility ->> 'eligible')::boolean, false) then
    return jsonb_build_object('success', false, 'message', coalesce(v_eligibility ->> 'message', 'This email is not eligible for administrator access.'));
  end if;

  select count(*) into v_recent_count
  from public.email_verifications
  where lower(email) = v_email
    and purpose = 'ADMIN_REQUEST'
    and created_at >= (now() - interval '15 minutes');

  if v_recent_count >= 5 then
    return jsonb_build_object('success', false, 'message', 'Too many verification attempts for this email. Please wait 15 minutes before requesting a new code.');
  end if;

  v_code := lpad((floor(random() * 900000) + 100000)::text, 6, '0');

  insert into public.email_verifications (email, code, purpose, metadata, expires_at)
  values (
    v_email,
    v_code,
    'ADMIN_REQUEST',
    jsonb_build_object('full_name', v_name),
    now() + interval '10 minutes'
  );

  return jsonb_build_object(
    'success', true,
    'email', v_email,
    'code', v_code,
    'message', 'Verification code generated.'
  );
end;
$$;

create or replace function public.verify_admin_email_verification(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := btrim(coalesce(p_code, ''));
  v_rec record;
begin
  if v_email = '' or v_code = '' then
    return jsonb_build_object('success', false, 'message', 'Email and 6-digit verification code are required.');
  end if;

  select id, code, attempts, expires_at, verified_at
  into v_rec
  from public.email_verifications
  where lower(email) = v_email
    and purpose = 'ADMIN_REQUEST'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'message', 'No active verification code found for this email. Please request a new code.');
  end if;

  if v_rec.verified_at is not null then
    return jsonb_build_object('success', true, 'message', 'Email is already verified.');
  end if;

  if v_rec.expires_at < now() then
    return jsonb_build_object('success', false, 'message', 'Verification code has expired. Please request a new code.');
  end if;

  if v_rec.attempts >= 5 then
    return jsonb_build_object('success', false, 'message', 'Too many invalid attempts. Please request a new verification code.');
  end if;

  if v_rec.code <> v_code then
    update public.email_verifications
    set attempts = attempts + 1
    where id = v_rec.id;
    return jsonb_build_object('success', false, 'message', 'Incorrect 6-digit verification code. Please check your inbox.');
  end if;

  update public.email_verifications
  set verified_at = now()
  where id = v_rec.id;

  return jsonb_build_object('success', true, 'message', 'Email verified successfully.');
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

create or replace function public.super_admin_unblock_admin_request(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can unblock administrator requests.' using errcode = '42501';
  end if;

  select id, email, full_name, role, status, group_id
  into v_target
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Target request profile not found.' using errcode = 'P0002';
  end if;

  if v_target.role <> 'MEMBER' or v_target.group_id is not null then
    raise exception 'Only pending or declined administrator applicants without a savings group can be unblocked.' using errcode = '22023';
  end if;

  delete from public.admin_requests where requester_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from public.email_verifications where lower(email) = lower(v_target.email);

  perform public.log_system_action(
    'ADMIN_REQUEST_UNBLOCKED',
    v_target.email,
    jsonb_build_object(
      'target_user_id', p_user_id,
      'email', v_target.email,
      'full_name', v_target.full_name
    )
  );

  return jsonb_build_object(
    'unblocked', true,
    'email', v_target.email,
    'full_name', v_target.full_name
  );
end;
$$;

revoke execute on function public.request_admin_email_verification(text, text) from public;
grant execute on function public.request_admin_email_verification(text, text) to anon, authenticated;

revoke execute on function public.verify_admin_email_verification(text, text) from public;
grant execute on function public.verify_admin_email_verification(text, text) to anon, authenticated;

revoke execute on function public.super_admin_unblock_admin_request(uuid) from public, anon;
grant execute on function public.super_admin_unblock_admin_request(uuid) to authenticated;

create or replace function public.log_system_action(
  p_action text,
  p_target text,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record_id uuid := null;
  v_action text := 'DELETE';
begin
  if p_details ? 'target_user_id' and (p_details ->> 'target_user_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_record_id := (p_details ->> 'target_user_id')::uuid;
  end if;

  if p_action in ('INSERT', 'UPDATE', 'DELETE', 'CONFIRM', 'REJECT', 'VOID') then
    v_action := p_action;
  elsif p_action like '%UNBLOCK%' or p_action like '%DELETE%' or p_action like '%REMOVE%' or p_action like '%PURGE%' then
    v_action := 'DELETE';
  elsif p_action like '%APPROVE%' or p_action like '%CONFIRM%' then
    v_action := 'CONFIRM';
  elsif p_action like '%REJECT%' or p_action like '%DECLINE%' then
    v_action := 'REJECT';
  else
    v_action := 'UPDATE';
  end if;

  insert into public.audit_logs (
    group_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data,
    changed_by
  ) values (
    null,
    'admin_requests',
    v_record_id,
    v_action,
    jsonb_build_object('target', p_target, 'system_action', p_action),
    p_details,
    auth.uid()
  );
end;
$$;

revoke execute on function public.log_system_action(text, text, jsonb) from public, anon;
grant execute on function public.log_system_action(text, text, jsonb) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_032', 'admin request email ownership verification and unblock')
on conflict (version) do nothing;

create or replace function public.set_admin_contributor(
  p_enabled boolean,
  p_monthly_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_profile public.profiles;
  v_gm public.group_memberships;
  v_member_id uuid;
  v_default_amount numeric;
  v_amount numeric;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update contributor participation.' using errcode = '42501';
  end if;

  if p_monthly_amount is not null and (p_monthly_amount <= 0 or p_monthly_amount > 1000000) then
    raise exception 'Monthly contribution amount must be greater than zero.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid() and group_id = v_group_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  select * into v_gm
  from public.group_memberships
  where group_id = v_group_id and user_id = auth.uid() and status = 'ACTIVE';

  v_member_id := coalesce(v_profile.member_id, v_gm.member_id);

  if p_enabled then
    select default_amount into v_default_amount
    from public.contribution_settings
    where group_id = v_group_id
    order by effective_month desc
    limit 1;

    v_amount := round(coalesce(p_monthly_amount, v_default_amount, 100), 2);

    if v_member_id is not null then
      update public.members
      set status = 'ACTIVE',
          deactivated_at = null,
          monthly_contribution_amount = coalesce(p_monthly_amount, monthly_contribution_amount, v_amount),
          updated_by = auth.uid()
      where id = v_member_id and group_id = v_group_id;
    else
      v_full := coalesce(nullif(btrim(v_profile.full_name), ''), 'Group Admin');
      v_first := coalesce(nullif(btrim(v_profile.first_name), ''), split_part(v_full, ' ', 1));
      v_middle := nullif(btrim(v_profile.middle_name), '');
      v_last := coalesce(nullif(btrim(v_profile.last_name), ''), nullif(btrim(substr(v_full, char_length(split_part(v_full, ' ', 1)) + 1)), ''), 'Admin');

      insert into public.members (
        group_id, first_name, middle_name, last_name, full_name,
        contact_number, date_registered, monthly_contribution_amount,
        status, notes, created_by
      ) values (
        v_group_id,
        v_first,
        v_middle,
        v_last,
        concat_ws(' ', v_first, v_middle, v_last),
        coalesce(nullif(btrim(v_profile.contact_number), ''), '09000000000'),
        (now() at time zone 'Asia/Manila')::date,
        v_amount,
        'ACTIVE',
        'Group administrator contributor',
        auth.uid()
      )
      returning id into v_member_id;
    end if;

    update public.group_memberships
    set member_id = v_member_id
    where group_id = v_group_id and user_id = auth.uid();

    update public.profiles
    set member_id = v_member_id
    where id = auth.uid() and group_id = v_group_id;

    perform public.generate_contribution_periods(date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date);

    -- Update any unpaid contribution period for the current month so the new pledge takes effect immediately
    update public.contribution_periods cp
    set required_amount = v_amount
    where cp.member_id = v_member_id
      and cp.period_month = date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date
      and not exists (
        select 1 from public.contributions c
        where c.contribution_period_id = cp.id
      );

    return jsonb_build_object('is_contributor', true, 'member_id', v_member_id, 'monthly_contribution_amount', v_amount);
  else
    if v_member_id is not null then
      update public.members
      set status = 'INACTIVE',
          deactivated_at = now(),
          updated_by = auth.uid()
      where id = v_member_id
        and group_id = v_group_id
        and deleted_at is null;

      delete from public.contribution_periods cp
      where cp.member_id = v_member_id
        and not exists (
          select 1 from public.contributions c
          where c.contribution_period_id = cp.id
        );
    end if;

    update public.profiles
    set member_id = null
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', false, 'member_id', null, 'monthly_contribution_amount', null);

    return jsonb_build_object('is_contributor', false, 'member_id', null);
  end if;
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
where m.deleted_at is null
  and (m.status = 'ACTIVE' or c.id is not null)
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount;

insert into public.schema_migrations (version, name)
values ('20261113_033', 'clean unpaid periods on admin contributor toggle')
on conflict (version) do nothing;

update public.profiles p
set email = lower(ar.email)
from public.admin_requests ar
where p.id = ar.requester_id
  and (p.email is null or btrim(p.email) = '');

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id
  and (p.email is null or btrim(p.email) = '');

create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'A reason of at least 3 characters is required when rejecting an administrator request.' using errcode = '22023';
  end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  update public.profiles
  set status = 'DISABLED',
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', v_note, null);
end;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text := nullif(btrim(p_group_name), '');
  v_group_id uuid;
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if v_group_name is null or char_length(v_group_name) < 2 then raise exception 'A group name of at least 2 characters is required.' using errcode = '22023'; end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;

  update public.profiles
  set role = 'ADMIN',
      status = 'ACTIVE',
      group_id = v_group_id,
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(p_user_id, 'ADMIN_APPROVED', 'Administrator request approved', 'Your request was approved. Group "' || v_group_name || '" is ready.', 'admin.html');
  return v_group_id;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261113_034', 'ensure admin request email backfill and decision delivery')
on conflict (version) do nothing;

create table if not exists public.announcement_reactions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('👍', '❤️', '😆', '😮', '😢', '😡')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

create index if not exists announcement_reactions_announcement_idx
  on public.announcement_reactions (announcement_id, reaction);

create index if not exists announcement_reactions_user_idx
  on public.announcement_reactions (user_id);

alter table public.announcement_reactions enable row level security;

drop policy if exists announcement_reactions_select on public.announcement_reactions;
create policy announcement_reactions_select on public.announcement_reactions for select to authenticated
using (
  exists (
    select 1 from public.announcements a
    where a.id = announcement_reactions.announcement_id
      and a.deleted_at is null
      and (
        public.is_super_admin()
        or a.group_id is null
        or a.group_id = public.current_group_id()
      )
  )
);

drop policy if exists mfa_verified_for_opted_in on public.announcement_reactions;
create policy mfa_verified_for_opted_in on public.announcement_reactions as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcement_reactions'
  ) then
    alter publication supabase_realtime add table public.announcement_reactions;
  end if;
end;
$$;

create or replace function public.toggle_announcement_reaction(
  p_announcement_id uuid,
  p_reaction text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing text;
  v_action text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if p_reaction not in ('👍', '❤️', '😆', '😮', '😢', '😡') then
    raise exception 'Invalid reaction emoji.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.deleted_at is null
      and (
        public.is_super_admin()
        or a.group_id is null
        or a.group_id = public.current_group_id()
      )
  ) then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  select reaction into v_existing
  from public.announcement_reactions
  where announcement_id = p_announcement_id and user_id = v_user_id;

  if v_existing is not null and v_existing = p_reaction then
    delete from public.announcement_reactions
    where announcement_id = p_announcement_id and user_id = v_user_id;
    v_action := 'removed';
  elsif v_existing is not null then
    update public.announcement_reactions
    set reaction = p_reaction, updated_at = now()
    where announcement_id = p_announcement_id and user_id = v_user_id;
    v_action := 'updated';
  else
    insert into public.announcement_reactions (announcement_id, user_id, reaction)
    values (p_announcement_id, v_user_id, p_reaction);
    v_action := 'added';
  end if;

  return jsonb_build_object(
    'action', v_action,
    'reaction', p_reaction,
    'announcement_id', p_announcement_id
  );
end;
$$;

create or replace function public.get_announcement_reactions(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', ar.user_id,
        'reaction', ar.reaction,
        'full_name', p.full_name,
        'role', p.role,
        'avatar_url', p.avatar_url,
        'created_at', ar.created_at
      ) order by ar.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.announcement_reactions ar
  join public.profiles p on p.id = ar.user_id
  where ar.announcement_id = p_announcement_id;

  return v_result;
end;
$$;

revoke all on public.announcement_reactions from public, anon;
grant select on public.announcement_reactions to authenticated;

revoke execute on function public.toggle_announcement_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_announcement_reaction(uuid, text) to authenticated;

revoke execute on function public.get_announcement_reactions(uuid) from public, anon;
grant execute on function public.get_announcement_reactions(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_035', 'add announcement reactions')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261113_036', 'feature request workflow and release updates')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261113_037', 'admin contributor amount sync')
on conflict (version) do nothing;

-- 20261113_038_feature_request_credit_and_release_sections.sql
alter table public.feature_requests
  add column if not exists allow_credit boolean not null default true;

drop policy if exists feature_requests_select on public.feature_requests;
create policy feature_requests_select on public.feature_requests for select to authenticated
using (
  requester_id = auth.uid()
  or public.is_super_admin()
  or (status = 'IMPLEMENTED' and release_version is not null)
);

create or replace function public.get_release_features(p_release_version text)
returns table (
  id uuid,
  title text,
  details text,
  requester_id uuid,
  requester_name text,
  requester_avatar_url text,
  allow_credit boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.id,
    f.title,
    f.details,
    case when f.allow_credit then f.requester_id else null end as requester_id,
    case when f.allow_credit then coalesce(p.full_name, 'Contributor') else 'Community Member' end as requester_name,
    case when f.allow_credit then p.avatar_url else null end as requester_avatar_url,
    f.allow_credit,
    f.created_at
  from public.feature_requests f
  left join public.profiles p on p.id = f.requester_id
  where f.status = 'IMPLEMENTED'
    and f.release_version = nullif(btrim(p_release_version), '')
  order by f.created_at asc;
$$;

revoke all on function public.get_release_features(text) from public, anon;
grant execute on function public.get_release_features(text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_038', 'feature request credit consent and release sections')
on conflict (version) do nothing;

-- 20261113_039_self_serve_groups_and_invitations.sql
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

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'DISABLED'
  ) then
    raise exception 'Your account is deactivated or disabled.' using errcode = '42501';
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

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_notif.group_id, auth.uid(), 'MEMBER', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set status = 'ACTIVE'
  returning * into v_membership;

  update public.profiles
  set group_id = coalesce(group_id, v_notif.group_id),
      role = case when group_id is null then v_membership.role else role end,
      member_id = case when group_id is null then v_membership.member_id else member_id end,
      status = 'ACTIVE'
  where id = auth.uid();

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

insert into public.schema_migrations (version, name)
values ('20261113_039', 'self serve groups and interactive invitations')
on conflict (version) do nothing;

-- 20261113_040_super_admin_account_actions_and_reasons.sql
alter table public.groups
  drop constraint if exists groups_owner_id_fkey;

alter table public.groups
  add constraint groups_owner_id_fkey
  foreign key (owner_id) references public.profiles(id)
  on delete set null;

create or replace function public.super_admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can delete user accounts.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own super administrator account.' using errcode = '22023';
  end if;

  select role into v_role
  from public.profiles
  where id = p_user_id;

  if not found or v_role = 'SUPER_ADMIN' then
    raise exception 'User account not found or cannot be deleted.' using errcode = 'P0002';
  end if;

  update public.groups
  set owner_id = null,
      status = 'SUSPENDED'
  where owner_id = p_user_id;

  delete from public.group_memberships
  where user_id = p_user_id;

  delete from public.profiles
  where id = p_user_id;

  perform public.push_notification(
    auth.uid(),
    'USER_DELETED',
    'Account deleted',
    'A user account was permanently deleted.',
    'super-admin.html#administrators'
  );
end;
$$;

revoke execute on function public.super_admin_delete_user(uuid) from public, anon;
grant execute on function public.super_admin_delete_user(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_040', 'super admin account actions with reasons and safe delete')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261113_041', 'activate all new verified accounts and fix auth loading')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261113_042', 'invited account activation flow via email accept')
on conflict (version) do nothing;

alter table public.groups
  add column if not exists payment_qr_url text,
  add column if not exists payment_method_label text,
  add column if not exists payment_account_name text,
  add column if not exists payment_account_number text,
  add column if not exists payment_instructions text;

alter table public.contributions
  add column if not exists receipt_url text;

alter table public.expenses
  add column if not exists receipt_url text;

create or replace function public.get_group_payment_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_row record;
begin
  if auth.uid() is null or v_group_id is null or public.current_user_role() is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;

  select
    g.id,
    g.name,
    g.payment_qr_url,
    g.payment_method_label,
    g.payment_account_name,
    g.payment_account_number,
    g.payment_instructions
  into v_row
  from public.groups g
  where g.id = v_group_id
    and g.status = 'ACTIVE';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'group_id', v_row.id,
    'group_name', v_row.name,
    'payment_qr_url', v_row.payment_qr_url,
    'payment_method_label', v_row.payment_method_label,
    'payment_account_name', v_row.payment_account_name,
    'payment_account_number', v_row.payment_account_number,
    'payment_instructions', v_row.payment_instructions
  );
end;
$$;

create or replace function public.update_group_payment_info(
  p_payment_qr_url text default null,
  p_clear_qr boolean default false,
  p_payment_method_label text default null,
  p_payment_account_name text default null,
  p_payment_account_number text default null,
  p_payment_instructions text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_method text := nullif(btrim(coalesce(p_payment_method_label, '')), '');
  v_acc_name text := nullif(btrim(coalesce(p_payment_account_name, '')), '');
  v_acc_num text := nullif(btrim(coalesce(p_payment_account_number, '')), '');
  v_notes text := nullif(btrim(coalesce(p_payment_instructions, '')), '');
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update group payment details.' using errcode = '42501';
  end if;

  if v_method is not null and char_length(v_method) > 60 then
    raise exception 'Payment channel must be 60 characters or fewer.' using errcode = '22023';
  end if;
  if v_acc_name is not null and char_length(v_acc_name) > 120 then
    raise exception 'Account name must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if v_acc_num is not null and char_length(v_acc_num) > 80 then
    raise exception 'Account number must be 80 characters or fewer.' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Payment instructions must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if p_payment_qr_url is not null and (p_payment_qr_url !~ '^data:image/' or char_length(p_payment_qr_url) > 600000) then
    raise exception 'Payment QR must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  update public.groups
  set payment_qr_url = case
        when p_clear_qr then null
        when p_payment_qr_url is not null then p_payment_qr_url
        else payment_qr_url
      end,
      payment_method_label = v_method,
      payment_account_name = v_acc_name,
      payment_account_number = v_acc_num,
      payment_instructions = v_notes
  where id = v_group_id;

  if not found then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
end;
$$;

drop function if exists public.record_contribution(uuid, date, numeric, date, text, text, uuid);

create or replace function public.record_contribution(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_period_id uuid;
  v_required numeric(14,2);
  v_id uuid;
  v_status public.approval_status;
  v_month date := date_trunc('month', p_contribution_month)::date;
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
begin
  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month)
  )
  on conflict (member_id, period_month) do nothing;

  select id into v_period_id
  from public.contribution_periods
  where member_id = p_member_id and period_month = v_month;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.contributions (
    contribution_period_id, amount, payment_date, transaction_reference,
    idempotency_key, notes, receipt_url, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    v_period_id, public.validated_money(p_amount, 'Contribution amount'), p_payment_date,
    nullif(btrim(p_transaction_reference), ''), p_idempotency_key,
    nullif(btrim(p_notes), ''), v_receipt, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.record_expense(date, numeric, text, text, text, text, text, uuid);

create or replace function public.record_expense(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null
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
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
begin
  if v_role is null or v_role not in ('ADMIN', 'TREASURER') then
    raise exception 'You are not allowed to record expenses.' using errcode = '42501';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.expenses (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, receipt_url, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Expense amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_receipt, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.get_group_payment_info() to authenticated;
grant execute on function public.update_group_payment_info(text, boolean, text, text, text, text) to authenticated;
grant execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid, text) to authenticated;
grant execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_043', 'group payment qr and contribution/expense receipts')
on conflict (version) do nothing;

create or replace function public.get_pending_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with gid as (
    select public.current_group_id() as group_id
  ),
  entries as (
    select
      c.id,
      c.amount,
      c.payment_date as activity_date,
      c.created_at,
      'contribution'::text as entry_type,
      'Savings Addition'::text as entry_label,
      m.full_name as member_name,
      coalesce(sp.full_name, m.full_name) as submitted_by_name,
      coalesce(
        public.group_member_avatar(m.id),
        case when sp.status = 'ACTIVE' then sp.avatar_url end
      ) as avatar_url,
      cp.period_month,
      null::text as category,
      c.transaction_reference as reference,
      c.notes,
      null::text as description,
      c.receipt_url
    from public.contributions c
    join gid on c.group_id = gid.group_id
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    left join public.profiles sp
      on sp.id = c.submitted_by
     and sp.group_id = c.group_id
    where c.approval_status = 'PENDING'

    union all

    select
      w.id,
      w.amount,
      w.transaction_date as activity_date,
      w.created_at,
      'withdrawal'::text as entry_type,
      'Deduction'::text as entry_label,
      w.person_responsible as member_name,
      coalesce(sp.full_name, w.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      w.category,
      w.reference_number as reference,
      w.notes,
      w.description,
      null::text as receipt_url
    from public.withdrawals w
    join gid on w.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = w.submitted_by
     and sp.group_id = w.group_id
    where w.approval_status = 'PENDING'

    union all

    select
      e.id,
      e.amount,
      e.transaction_date as activity_date,
      e.created_at,
      'expense'::text as entry_type,
      'Expense'::text as entry_label,
      e.person_responsible as member_name,
      coalesce(sp.full_name, e.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      e.category,
      e.reference_number as reference,
      e.notes,
      e.description,
      e.receipt_url
    from public.expenses e
    join gid on e.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = e.submitted_by
     and sp.group_id = e.group_id
    where e.approval_status = 'PENDING'
  ),
  recent as (
    select * from entries order by created_at desc limit 3
  )
  select case
    when public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and public.current_group_id() is not null
    then jsonb_build_object(
      'count', (select count(*) from entries),
      'amount', (select coalesce(sum(amount), 0) from entries),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'amount', amount,
              'date', activity_date,
              'type', entry_type,
              'entry_label', entry_label,
              'member_name', member_name,
              'submitted_by_name', submitted_by_name,
              'avatar_url', avatar_url,
              'period_month', period_month,
              'category', category,
              'reference', reference,
              'notes', notes,
              'description', description,
              'receipt_url', receipt_url
            )
            order by created_at desc
          )
          from recent
        ),
        '[]'::jsonb
      )
    )
    else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb)
  end;
$$;

grant execute on function public.get_pending_review_summary() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_044', 'include receipt_url in pending review summary')
on conflict (version) do nothing;

commit;

-- Migration 20261114_045: Add administrator RPC to delete a group savings goal with audit logging.
begin;

create or replace function public.delete_savings_goal(
  p_goal_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can manage goals.' using errcode = '42501';
  end if;
  if p_goal_id is null then
    raise exception 'Savings goal is required.' using errcode = '22023';
  end if;

  delete from public.savings_goals
  where id = p_goal_id
    and group_id = public.current_group_id()
  returning id into v_id;

  if v_id is null then
    raise exception 'Savings goal not found.' using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.delete_savings_goal(uuid) from public, anon;
grant execute on function public.delete_savings_goal(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_045', 'add delete_savings_goal RPC')
on conflict (version) do nothing;

commit;

-- Migration 20261114_046: Complete role-based notifications across multi-group admins, treasurers, members, announcements, feedback, and due reminder sync.
begin;

create or replace function public.group_admin_ids(p_group_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.id as user_id
  from (
    select gm.user_id as id
    from public.group_memberships gm
    where gm.group_id = p_group_id
      and gm.role = 'ADMIN'
      and gm.status = 'ACTIVE'
    union
    select p.id
    from public.profiles p
    where p.group_id = p_group_id
      and p.role = 'ADMIN'
      and p.status = 'ACTIVE'
    union
    select g.owner_id as id
    from public.groups g
    where g.id = p_group_id
      and g.owner_id is not null
  ) u
  join public.profiles p on p.id = u.id
  where p.status = 'ACTIVE'
    and p.notifications_enabled;
$$;

revoke execute on function public.group_admin_ids(uuid) from public, anon, authenticated;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_member_user record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name
    when 'contributions' then 'contribution'
    when 'withdrawals' then 'deduction'
    else 'expense'
  end;
  v_status text := lower(new.approval_status::text);
  v_submitter_role public.app_role;
  v_submitter_name text := 'A group user';
  v_amount_text text := to_char(coalesce(new.amount, 0), 'FM999,999,990.00');
  v_link text := 'dashboard.html';
  v_reason text;
  v_message text;
begin
  if new.submitted_by is not null then
    select coalesce(gm.role, p.role), coalesce(nullif(btrim(p.full_name), ''), 'A group user')
    into v_submitter_role, v_submitter_name
    from public.profiles p
    left join public.group_memberships gm
      on gm.group_id = v_group
     and gm.user_id = p.id
     and gm.status = 'ACTIVE'
    where p.id = new.submitted_by;

    v_link := case
      when tg_table_name = 'contributions' and v_submitter_role = 'MEMBER' then 'user.html'
      when tg_table_name = 'contributions' then 'contributions.html'
      when tg_table_name = 'withdrawals' then 'withdrawals.html'
      else 'expenses.html'
    end;
  end if;

  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group)
    loop
      perform public.push_notification(
        v_admin.id,
        'REVIEW_REQUIRED',
        'New ' || v_label || ' submitted',
        v_submitter_name || ' submitted a ' || v_label || ' (PHP ' || v_amount_text || ') for review.',
        'dashboard.html',
        v_group
      );
    end loop;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        'SUBMITTED',
        initcap(v_label) || ' submitted',
        'Your ' || v_label || ' (PHP ' || v_amount_text || ') is waiting for administrator review.',
        v_link,
        v_group
      );
    end if;
  elsif tg_op = 'INSERT'
    and tg_table_name = 'contributions'
    and new.approval_status = 'CONFIRMED'
  then
    for v_member_user in
      select distinct u.id as user_id
      from public.contribution_periods cp
      join (
        select gm.user_id as id, gm.member_id
        from public.group_memberships gm
        where gm.group_id = v_group and gm.status = 'ACTIVE' and gm.member_id is not null
        union
        select p.id, p.member_id
        from public.profiles p
        where p.group_id = v_group and p.status = 'ACTIVE' and p.member_id is not null
      ) u on u.member_id = cp.member_id
      where cp.id = new.contribution_period_id
        and u.id is distinct from new.submitted_by
    loop
      perform public.push_notification(
        v_member_user.user_id,
        'CONTRIBUTION_RECORDED',
        'Contribution recorded',
        'A confirmed contribution of PHP ' || v_amount_text || ' was recorded on your profile.',
        'user.html',
        v_group
      );
    end loop;
  elsif tg_op = 'UPDATE'
    and (
      (old.approval_status = 'PENDING' and new.approval_status in ('CONFIRMED', 'REJECTED'))
      or (old.approval_status = 'CONFIRMED' and new.approval_status = 'VOIDED')
    )
  then
    v_reason := nullif(btrim(coalesce(
      case when new.approval_status = 'VOIDED' then new.void_reason else new.review_note end,
      ''
    )), '');
    v_message := case
      when new.approval_status = 'VOIDED' then 'Your ' || v_label || ' (PHP ' || v_amount_text || ') was voided.'
      else 'Your submitted ' || v_label || ' (PHP ' || v_amount_text || ') was ' || v_status || '.'
    end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end;
    if char_length(v_message) > 500 then
      v_message := left(v_message, 499) || '…';
    end if;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        case when new.approval_status = 'VOIDED' then 'VOIDED' else 'REVIEWED' end,
        initcap(v_label) || ' ' || v_status,
        v_message,
        v_link,
        v_group
      );
    end if;

    if tg_table_name = 'contributions' and new.approval_status in ('CONFIRMED', 'VOIDED') then
      for v_member_user in
        select distinct u.id as user_id
        from public.contribution_periods cp
        join (
          select gm.user_id as id, gm.member_id
          from public.group_memberships gm
          where gm.group_id = v_group and gm.status = 'ACTIVE' and gm.member_id is not null
          union
          select p.id, p.member_id
          from public.profiles p
          where p.group_id = v_group and p.status = 'ACTIVE' and p.member_id is not null
        ) u on u.member_id = cp.member_id
        where cp.id = new.contribution_period_id
          and u.id is distinct from new.submitted_by
      loop
        perform public.push_notification(
          v_member_user.user_id,
          case when new.approval_status = 'VOIDED' then 'VOIDED' else 'CONTRIBUTION_RECORDED' end,
          'Contribution ' || v_status,
          case when new.approval_status = 'VOIDED'
            then 'A contribution on your profile (PHP ' || v_amount_text || ') was voided.'
            else 'A contribution on your profile (PHP ' || v_amount_text || ') was confirmed.'
          end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end,
          'user.html',
          v_group
        );
      end loop;
    end if;
  elsif tg_op = 'UPDATE'
    and old.approval_status = new.approval_status
    and new.approval_status = 'PENDING'
  then
    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group)
    loop
      perform public.push_notification(
        v_admin.id,
        'RECORD_UPDATED',
        initcap(v_label) || ' updated',
        v_submitter_name || ' updated a pending ' || v_label || ' (PHP ' || v_amount_text || ') awaiting review.',
        'dashboard.html',
        v_group
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  for v_admin in
    select user_id as id
    from public.group_admin_ids(new.group_id)
  loop
    perform public.push_notification(
      v_admin.id,
      'MEMBER_CREATED',
      'Member registered',
      new.full_name || ' was added to your group.',
      'members.html',
      new.group_id
    );
  end loop;
  return new;
end;
$$;

create or replace function public.notify_profile_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in ('MEMBER', 'TREASURER')
    and old.status is distinct from new.status
    and new.status = 'ACTIVE'
  then
    perform public.push_notification(
      new.id,
      'ACCOUNT_READY',
      'Your account is ready',
      case
        when new.role = 'TREASURER' then 'Your treasurer account is active in your savings group.'
        else 'Your member account is active and linked to your savings profile.'
      end,
      case when new.role = 'TREASURER' then 'dashboard.html' else 'user.html' end,
      new.group_id
    );
  end if;
  return new;
end;
$$;

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
  v_prev_membership public.group_memberships;
  v_link_member_id uuid;
  v_group_name text := 'your savings group';
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

  select * into v_prev_membership
  from public.group_memberships
  where group_id = v_actor_group and user_id = p_user_id;

  select name into v_group_name from public.groups where id = v_actor_group;
  v_group_name := coalesce(nullif(btrim(v_group_name), ''), 'your savings group');

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

  if v_prev_membership.user_id is not null and (
    v_prev_membership.role is distinct from p_role
    or v_prev_membership.status is distinct from p_status
  ) then
    perform public.push_notification(
      p_user_id,
      'ACCESS_UPDATED',
      'Group access updated',
      case
        when p_status = 'DISABLED' then 'Your access to "' || v_group_name || '" was disabled by an administrator.'
        when v_prev_membership.role is distinct from p_role then 'Your role in "' || v_group_name || '" was changed to ' || initcap(lower(p_role::text)) || '.'
        else 'Your access in "' || v_group_name || '" is now ' || lower(p_status::text) || '.'
      end,
      case when p_role = 'MEMBER' then 'user.html' else 'dashboard.html' end,
      v_actor_group
    );
  end if;
end;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text := nullif(btrim(p_group_name), '');
  v_group_id uuid;
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if v_group_name is null or char_length(v_group_name) < 2 then raise exception 'A group name of at least 2 characters is required.' using errcode = '22023'; end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;

  update public.profiles
  set role = 'ADMIN',
      status = 'ACTIVE',
      group_id = v_group_id,
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_user_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE', member_id = null;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(
    p_user_id,
    'ADMIN_APPROVED',
    'Administrator request approved',
    'Your request was approved. Group "' || v_group_name || '" is ready.',
    'dashboard.html',
    v_group_id
  );
  return v_group_id;
end;
$$;

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
  v_admin record;
  v_user_name text := 'A user';
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

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_notif.group_id, auth.uid(), 'MEMBER', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set status = 'ACTIVE'
  returning * into v_membership;

  update public.profiles
  set group_id = coalesce(group_id, v_notif.group_id),
      role = case when group_id is null then v_membership.role else role end,
      member_id = case when group_id is null then v_membership.member_id else member_id end,
      status = 'ACTIVE'
  where id = auth.uid()
  returning coalesce(nullif(btrim(full_name), ''), 'A user') into v_user_name;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;

  for v_admin in
    select user_id as id
    from public.group_admin_ids(v_notif.group_id)
    where user_id <> auth.uid()
  loop
    perform public.push_notification(
      v_admin.id,
      'GROUP_INVITE_ACCEPTED',
      'Invitation accepted',
      v_user_name || ' accepted the invitation to join "' || v_group.name || '".',
      'settings.html',
      v_notif.group_id
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'group_id', v_notif.group_id,
    'group_name', v_group.name,
    'role', v_membership.role
  );
end;
$$;

create or replace function public.decline_group_invitation(p_notification_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notif record;
  v_group_name text := 'the savings group';
  v_user_name text := 'A user';
  v_admin record;
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

  select coalesce(nullif(btrim(full_name), ''), 'A user') into v_user_name
  from public.profiles
  where id = auth.uid();

  if v_notif.group_id is not null then
    update public.group_memberships
    set status = 'REJECTED'
    where group_id = v_notif.group_id
      and user_id = auth.uid();

    select coalesce(nullif(btrim(name), ''), 'the savings group') into v_group_name
    from public.groups
    where id = v_notif.group_id;

    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_notif.group_id)
      where user_id <> auth.uid()
    loop
      perform public.push_notification(
        v_admin.id,
        'GROUP_INVITE_DECLINED',
        'Invitation declined',
        v_user_name || ' declined the invitation to join "' || v_group_name || '".',
        'settings.html',
        v_notif.group_id
      );
    end loop;
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.notify_feature_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super_admin record;
  v_requester_name text := 'A user';
begin
  select coalesce(nullif(btrim(full_name), ''), 'A user') into v_requester_name
  from public.profiles
  where id = new.requester_id;

  for v_super_admin in
    select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE'
  loop
    perform public.push_notification(
      v_super_admin.id,
      'FEATURE_REQUEST',
      'New feature request',
      v_requester_name || ': ' || left(new.title, 120),
      'super-admin.html#feature-requests'
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_feature_request_created() from public, anon, authenticated;

drop trigger if exists feature_requests_notifications on public.feature_requests;
create trigger feature_requests_notifications
  after insert on public.feature_requests
  for each row execute function public.notify_feature_request_created();

create or replace function public.review_feature_request(
  p_request_id uuid,
  p_status text,
  p_release_version text default null
)
returns public.feature_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_row public.feature_requests;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can review feature requests.' using errcode = '42501';
  end if;

  if v_status not in ('PENDING', 'IMPLEMENTED', 'REJECTED') then
    raise exception 'Invalid feature request status.' using errcode = '22023';
  end if;

  update public.feature_requests
  set status = v_status,
      reviewed_at = case when v_status = 'PENDING' then null else now() end,
      reviewed_by = case when v_status = 'PENDING' then null else auth.uid() end,
      release_version = case when v_status = 'IMPLEMENTED' then nullif(btrim(coalesce(p_release_version, release_version, '')), '') else null end
  where id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Feature request not found.' using errcode = 'P0002';
  end if;

  if v_status in ('IMPLEMENTED', 'REJECTED') and v_row.requester_id is not null then
    perform public.push_notification(
      v_row.requester_id,
      'FEATURE_REQUEST_REVIEWED',
      'Feature request ' || lower(v_status),
      case
        when v_status = 'IMPLEMENTED' then 'Your feature request "' || left(v_row.title, 90) || '" was marked as implemented.'
        else 'Your feature request "' || left(v_row.title, 90) || '" was not prioritized right now.'
      end,
      'dashboard.html'
    );
  end if;

  return v_row;
end;
$$;

create or replace function public.notify_bug_report_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super_admin record;
  v_reporter_name text := 'A user';
begin
  select coalesce(nullif(btrim(full_name), ''), 'A user') into v_reporter_name
  from public.profiles
  where id = new.reporter_id;

  for v_super_admin in
    select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE'
  loop
    perform public.push_notification(
      v_super_admin.id,
      'BUG_REPORT',
      'New bug report',
      v_reporter_name || ': ' || left(new.title, 120),
      'super-admin.html#bug-reports'
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_bug_report_created() from public, anon, authenticated;

drop trigger if exists bug_reports_notifications on public.bug_reports;
create trigger bug_reports_notifications
  after insert on public.bug_reports
  for each row execute function public.notify_bug_report_created();

create or replace function public.notify_announcement_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient record;
  v_notif_type text;
  v_title text;
  v_preview text := left(btrim(new.description), 160);
begin
  if new.group_id is not null then
    for v_recipient in
      select distinct u.id
      from (
        select gm.user_id as id
        from public.group_memberships gm
        where gm.group_id = new.group_id
          and gm.status = 'ACTIVE'
        union
        select p.id
        from public.profiles p
        where p.group_id = new.group_id
          and p.status = 'ACTIVE'
      ) u
      join public.profiles p on p.id = u.id
      where p.id is distinct from new.author_id
        and p.status = 'ACTIVE'
        and p.notifications_enabled
    loop
      perform public.push_notification(
        v_recipient.id,
        'ANNOUNCEMENT',
        'Announcement: ' || left(new.title, 80),
        v_preview,
        'dashboard.html',
        new.group_id
      );
    end loop;
  else
    v_notif_type := case when new.announcement_type = 'RELEASE' then 'RELEASE' else 'PLATFORM_ANNOUNCEMENT' end;
    v_title := case
      when new.announcement_type = 'RELEASE' and new.release_version is not null
        then 'Update ' || new.release_version || ': ' || left(new.title, 65)
      else 'Platform update: ' || left(new.title, 75)
    end;

    for v_recipient in
      select p.id
      from public.profiles p
      where p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and p.status = 'ACTIVE'
        and p.notifications_enabled
        and p.id is distinct from new.author_id
    loop
      perform public.push_notification(
        v_recipient.id,
        v_notif_type,
        v_title,
        v_preview,
        'dashboard.html',
        null
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_announcement_created() from public, anon, authenticated;

drop trigger if exists announcements_notifications on public.announcements;
create trigger announcements_notifications
  after insert on public.announcements
  for each row execute function public.notify_announcement_created();

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_count integer;
begin
  with linked_users as (
    select distinct p.id as user_id, u.member_id
    from (
      select gm.user_id as id, gm.member_id
      from public.group_memberships gm
      where gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.id, p.member_id
      from public.profiles p
      where p.status = 'ACTIVE' and p.member_id is not null
    ) u
    join public.profiles p on p.id = u.id
    where p.status = 'ACTIVE' and p.notifications_enabled
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select lu.user_id,
         cp.group_id,
         'CONTRIBUTION_REMINDER',
         'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.',
         'user.html'
  from public.contribution_periods cp
  join linked_users lu on lu.member_id = cp.member_id
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = lu.user_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from cp.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.sync_my_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_uid uuid := auth.uid();
  v_schedule jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'ACTIVE' and notifications_enabled
  ) then
    return '[]'::jsonb;
  end if;

  with my_memberships as (
    select distinct member_id
    from (
      select gm.member_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.member_id from public.profiles p where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select v_uid,
         cp.group_id,
         'CONTRIBUTION_REMINDER',
         'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.',
         'user.html'
  from public.contribution_periods cp
  join my_memberships mm on mm.member_id = cp.member_id
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = v_uid
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from cp.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );

  with my_memberships as (
    select distinct member_id
    from (
      select gm.member_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.member_id from public.profiles p where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period_id', cp.id,
    'group_id', cp.group_id,
    'group_name', g.name,
    'period_month', cp.period_month,
    'period_label', to_char(cp.period_month, 'FMMonth YYYY'),
    'due_date', cp.due_date,
    'outstanding_amount', vcs.outstanding_amount
  ) order by cp.due_date asc), '[]'::jsonb)
  into v_schedule
  from public.contribution_periods cp
  join my_memberships mm on mm.member_id = cp.member_id
  join public.groups g on g.id = cp.group_id and g.status = 'ACTIVE'
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 14
    and vcs.outstanding_amount > 0;

  return coalesce(v_schedule, '[]'::jsonb);
end;
$$;

revoke execute on function public.sync_my_due_reminders() from public, anon;
grant execute on function public.sync_my_due_reminders() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_046', 'complete role-based notifications and due reminder sync')
on conflict (version) do nothing;

commit;

-- Migration 20261114_047: Scoped read-only notification feed token for mobile background notification polling.
begin;

create table if not exists public.notification_feed_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);

alter table public.notification_feed_tokens enable row level security;
revoke all on public.notification_feed_tokens from public, anon, authenticated;

create or replace function public.ensure_notification_feed_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'ACTIVE'
  ) then
    raise exception 'Active account required.' using errcode = '42501';
  end if;

  insert into public.notification_feed_tokens (user_id, token, updated_at)
  values (v_uid, gen_random_uuid(), now())
  on conflict (user_id) do update
  set updated_at = now()
  returning token into v_token;

  return v_token;
end;
$$;

revoke execute on function public.ensure_notification_feed_token() from public, anon;
grant execute on function public.ensure_notification_feed_token() to authenticated;

create or replace function public.revoke_notification_feed_token()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.notification_feed_tokens where user_id = auth.uid();
end;
$$;

revoke execute on function public.revoke_notification_feed_token() from public, anon;
grant execute on function public.revoke_notification_feed_token() to authenticated;

create or replace function public.get_unread_notifications_by_token(p_token uuid)
returns table (
  id bigint,
  type text,
  title text,
  message text,
  link text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.type, n.title, n.message, n.link, n.created_at
  from public.notification_feed_tokens t
  join public.profiles p on p.id = t.user_id
  join public.notifications n on n.recipient_id = p.id
  where p_token is not null
    and t.token = p_token
    and p.status = 'ACTIVE'
    and p.notifications_enabled
    and n.read_at is null
    and n.created_at >= now() - interval '48 hours'
  order by n.created_at desc
  limit 8;
$$;

revoke execute on function public.get_unread_notifications_by_token(uuid) from public;
grant execute on function public.get_unread_notifications_by_token(uuid) to anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_047', 'background notification feed token for mobile drawer polling')
on conflict (version) do nothing;

create or replace function public.notify_announcement_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $
declare
  v_announcement_id uuid := case when tg_op = 'DELETE' then old.announcement_id else new.announcement_id end;
  v_actor_id uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_dedupe_key text;
  v_announcement record;
  v_recipient record;
  v_reactor_name text := 'A user';
  v_announcement_label text := 'your announcement';
  v_title_prefix text;
  v_message_suffix text;
  v_reaction_label text;
  v_title text;
  v_message text;
  v_link text;
begin
  if tg_op = 'UPDATE' and new.reaction is not distinct from old.reaction then
    return new;
  end if;

  v_dedupe_key := 'ANNOUNCEMENT_REACTION:' || v_announcement_id::text || ':' || v_actor_id::text;

  select coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), ''),
    nullif(btrim(p.email), ''),
    'A user'
  )
  into v_reactor_name
  from public.profiles p
  where p.id = v_actor_id;

  select a.id, a.group_id, a.author_id, a.title, a.deleted_at
  into v_announcement
  from public.announcements a
  where a.id = v_announcement_id;

  if found then
    v_announcement_label := coalesce(nullif(btrim(v_announcement.title), ''), 'your announcement');
  end if;

  v_title_prefix := left(v_reactor_name, 95) || ' reacted ';
  v_message_suffix := ' to "' || left(v_announcement_label, 120) || '".';

  if tg_op = 'DELETE' then
    delete from public.notifications n
    where n.type = 'ANNOUNCEMENT_REACTION'
      and (
        n.dedupe_key = v_dedupe_key
        or (
          n.dedupe_key is null
          and left(n.title, char_length(v_title_prefix)) = v_title_prefix
          and right(n.message, char_length(v_message_suffix)) = v_message_suffix
        )
      );
    return old;
  end if;

  if not found or v_announcement.deleted_at is not null then
    return new;
  end if;

  v_reaction_label := case new.reaction
    when '👍' then 'Like'
    when '❤️' then 'Love'
    when '😆' then 'Haha'
    when '😮' then 'Wow'
    when '😢' then 'Sad'
    when '😡' then 'Angry'
    else new.reaction
  end;

  v_title := left(v_reactor_name, 95) || ' reacted ' || new.reaction;
  v_message := 'Reacted ' || v_reaction_label || ' (' || new.reaction || ') to "' || left(v_announcement_label, 120) || '".';

  for v_recipient in
    select p.id, p.role
    from public.profiles p
    where p.status = 'ACTIVE'
      and p.notifications_enabled
      and p.id is distinct from v_actor_id
      and (
        p.id = v_announcement.author_id
        or (v_announcement.group_id is null and p.role = 'SUPER_ADMIN')
      )
  loop
    v_link := case when v_recipient.role = 'SUPER_ADMIN' then 'super-admin.html#announcements' else 'dashboard.html' end;

    delete from public.notifications n
    where n.recipient_id = v_recipient.id
      and n.type = 'ANNOUNCEMENT_REACTION'
      and n.dedupe_key is null
      and left(n.title, char_length(v_title_prefix)) = v_title_prefix
      and right(n.message, char_length(v_message_suffix)) = v_message_suffix;

    insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
    values (v_recipient.id, v_announcement.group_id, 'ANNOUNCEMENT_REACTION', btrim(v_title), btrim(v_message), v_link, v_dedupe_key)
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null
    do update set
      group_id = excluded.group_id,
      title = excluded.title,
      message = excluded.message,
      link = excluded.link,
      read_at = null,
      created_at = now();
  end loop;

  return new;
end;
$;

revoke execute on function public.notify_announcement_reaction() from public, anon, authenticated;

drop trigger if exists announcement_reactions_notifications on public.announcement_reactions;
create trigger announcement_reactions_notifications
  after insert or update or delete on public.announcement_reactions
  for each row execute function public.notify_announcement_reaction();

insert into public.schema_migrations (version, name)
values ('20261114_048', 'notify super admin and announcement authors when users react to announcements')
on conflict (version) do nothing;


-- 1. Savings cycle start date on groups
alter table public.groups
  add column if not exists cycle_start_date date;

create or replace function public.set_group_cycle_start(
  p_cycle_start_date date default null
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_month date := case when p_cycle_start_date is null then null else date_trunc('month', p_cycle_start_date)::date end;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update the savings cycle.' using errcode = '42501';
  end if;
  if v_month is not null and (v_month < date '2000-01-01' or v_month > date '2100-12-01') then
    raise exception 'Cycle start month must be between January 2000 and December 2100.' using errcode = '22023';
  end if;

  update public.groups
  set cycle_start_date = v_month
  where id = v_group_id;

  return v_month;
end;
$$;

revoke execute on function public.set_group_cycle_start(date) from public, anon;
grant execute on function public.set_group_cycle_start(date) to authenticated;

create or replace function public.get_savings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select
      public.current_user_role() as role_name,
      public.current_group_id() as group_id
  ),
  grp as (
    select g.id, g.cycle_start_date
    from public.groups g
    join ctx on ctx.group_id = g.id
  ),
  cycle_totals as (
    select
      (select coalesce(sum(c.amount), 0) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or c.payment_date >= grp.cycle_start_date)) as total_additions,
      (select coalesce(sum(w.amount), 0) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or w.transaction_date >= grp.cycle_start_date)) as total_deductions,
      (select coalesce(sum(e.amount), 0) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or e.transaction_date >= grp.cycle_start_date)) as total_expenses,
      (select coalesce(sum(c.amount), 0) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'CONFIRMED')
        - (select coalesce(sum(w.amount), 0) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'CONFIRMED')
        - (select coalesce(sum(e.amount), 0) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'CONFIRMED') as lifetime_tracked_savings,
      (select cycle_start_date from grp limit 1) as cycle_start_date,
      (select count(*) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'PENDING')
        + (select count(*) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'PENDING')
        + (select count(*) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'PENDING') as pending_entries
  )
  select case
    when ctx.role_name not in ('ADMIN', 'TREASURER', 'MEMBER') or ctx.group_id is null then null
    else jsonb_build_object(
      'total_additions', ct.total_additions,
      'total_deductions', ct.total_deductions,
      'total_expenses', ct.total_expenses,
      'tracked_savings', ct.total_additions - ct.total_deductions - ct.total_expenses,
      'lifetime_tracked_savings', ct.lifetime_tracked_savings,
      'cycle_start_date', ct.cycle_start_date,
      'pending_entries', ct.pending_entries
    )
  end
  from ctx, cycle_totals ct;
$$;

-- 2. Period exemptions
alter table public.contribution_periods
  add column if not exists is_exempt boolean not null default false,
  add column if not exists exempt_reason text;

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
  case
    when cp.is_exempt then 0::numeric(14,2)
    else greatest(cp.required_amount - coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0), 0)::numeric(14,2)
  end as outstanding_amount,
  greatest(coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) - cp.required_amount, 0)::numeric(14,2) as overpaid_amount,
  case
    when cp.is_exempt then 'EXEMPT'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = 0 then 'UNPAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) < cp.required_amount then 'PARTIALLY PAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = cp.required_amount then 'PAID'
    else 'OVERPAID'
  end as payment_status,
  cp.is_exempt,
  cp.exempt_reason
from public.contribution_periods cp
join public.members m on m.id = cp.member_id
left join public.contributions c on c.contribution_period_id = cp.id
where m.deleted_at is null
  and (m.status = 'ACTIVE' or c.id is not null)
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount, cp.is_exempt, cp.exempt_reason;

create or replace function public.set_period_exemption(
  p_member_id uuid,
  p_period_month date,
  p_exempt boolean default true,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_period_month)::date;
  v_required numeric(14,2);
  v_reason text := case when coalesce(p_exempt, true) then nullif(btrim(coalesce(p_reason, '')), '') else null end;
  v_user_id uuid;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can change period exemptions.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date '2100-12-01' then
    raise exception 'Invalid contribution month.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 300 then
    raise exception 'Exemption reason must not exceed 300 characters.' using errcode = '22023';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and deleted_at is null;

  if v_required is null then
    raise exception 'Member not found in the active group.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date, is_exempt, exempt_reason)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month),
    coalesce(p_exempt, true),
    v_reason
  )
  on conflict (member_id, period_month) do update
    set is_exempt = excluded.is_exempt,
        exempt_reason = excluded.exempt_reason;

  select u.id into v_user_id
  from (
    select gm.user_id as id from public.group_memberships gm where gm.group_id = v_group_id and gm.member_id = p_member_id and gm.status = 'ACTIVE'
    union
    select p.id from public.profiles p where p.group_id = v_group_id and p.member_id = p_member_id and p.status = 'ACTIVE'
  ) u
  join public.profiles p on p.id = u.id
  where p.notifications_enabled
  limit 1;

  if v_user_id is not null then
    perform public.push_notification(
      v_user_id,
      'PERIOD_EXEMPTION',
      case when coalesce(p_exempt, true) then 'Contribution period marked exempt' else 'Contribution exemption removed' end,
      to_char(v_month, 'FMMonth YYYY') || case
        when coalesce(p_exempt, true) then ' has been marked exempt' || coalesce(': ' || v_reason, '.')
        else ' is active again for regular contribution tracking.'
      end,
      'user.html',
      v_group_id
    );
  end if;
end;
$$;

revoke execute on function public.set_period_exemption(uuid, date, boolean, text) from public, anon;
grant execute on function public.set_period_exemption(uuid, date, boolean, text) to authenticated;

-- 3. Advance / excess contribution carry-over
create or replace function public.record_contribution_with_carryover(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_allocate_excess boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_contribution_month)::date;
  v_amount numeric(14,2) := public.validated_money(p_amount, 'Contribution amount');
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_required numeric(14,2);
  v_status public.approval_status;
  v_remaining numeric(14,2);
  v_cursor_month date;
  v_period record;
  v_covered numeric(14,2);
  v_needed numeric(14,2);
  v_slice numeric(14,2);
  v_first_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_i integer := 0;
  v_use_receipt text;
  v_slice_notes text;
  v_slice_key uuid;
begin
  if not coalesce(p_allocate_excess, false) then
    v_id := public.record_contribution(
      p_member_id,
      p_contribution_month,
      v_amount,
      p_payment_date,
      p_transaction_reference,
      p_notes,
      p_idempotency_key,
      p_receipt_url
    );
    return jsonb_build_object('ids', array[v_id], 'months_covered', 1);
  end if;

  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select id into v_first_id
  from public.contributions
  where idempotency_key = p_idempotency_key;

  if v_first_id is not null then
    return jsonb_build_object('ids', array[v_first_id], 'months_covered', 1);
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;
  v_remaining := v_amount;
  v_cursor_month := v_month;

  while v_remaining > 0 and v_i < 24 loop
    insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
    values (
      p_member_id,
      v_cursor_month,
      v_required,
      public.contribution_period_due_date(v_group_id, v_cursor_month)
    )
    on conflict (member_id, period_month) do nothing;

    select id, required_amount, is_exempt into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_cursor_month;

    if not coalesce(v_period.is_exempt, false) then
      select coalesce(sum(amount) filter (where approval_status in ('CONFIRMED', 'PENDING')), 0)::numeric(14,2)
      into v_covered
      from public.contributions
      where contribution_period_id = v_period.id;

      v_needed := greatest(v_period.required_amount - coalesce(v_covered, 0), 0);
      if v_needed > 0 then
        v_slice := least(v_remaining, v_needed);
        v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
        v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;
        v_slice_notes := case
          when coalesce(array_length(v_ids, 1), 0) = 0 then v_notes
          else left(trim(both ' ' from concat_ws(' · ', 'Advance carry-over from ' || to_char(v_month, 'Mon YYYY'), v_notes)), 1000)
        end;

        insert into public.contributions (
          contribution_period_id, amount, payment_date, transaction_reference,
          idempotency_key, notes, receipt_url, approval_status, submitted_by,
          reviewed_by, reviewed_at
        ) values (
          v_period.id, v_slice, p_payment_date,
          nullif(btrim(p_transaction_reference), ''), v_slice_key,
          v_slice_notes, v_use_receipt, v_status, auth.uid(),
          case when v_status = 'CONFIRMED' then auth.uid() end,
          case when v_status = 'CONFIRMED' then now() end
        ) returning id into v_id;

        v_ids := array_append(v_ids, v_id);
        v_remaining := v_remaining - v_slice;
      end if;
    end if;

    v_cursor_month := (v_cursor_month + interval '1 month')::date;
    v_i := v_i + 1;
  end loop;

  if v_remaining > 0 then
    select id into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_month;

    v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
    v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;

    insert into public.contributions (
      contribution_period_id, amount, payment_date, transaction_reference,
      idempotency_key, notes, receipt_url, approval_status, submitted_by,
      reviewed_by, reviewed_at
    ) values (
      v_period.id, v_remaining, p_payment_date,
      nullif(btrim(p_transaction_reference), ''), v_slice_key,
      left(trim(both ' ' from concat_ws(' · ', v_notes, 'Excess beyond 24 months')), 1000),
      v_use_receipt, v_status, auth.uid(),
      case when v_status = 'CONFIRMED' then auth.uid() end,
      case when v_status = 'CONFIRMED' then now() end
    ) returning id into v_id;

    v_ids := array_append(v_ids, v_id);
  end if;

  return jsonb_build_object('ids', v_ids, 'months_covered', coalesce(array_length(v_ids, 1), 0));
end;
$$;

revoke execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean) from public, anon;
grant execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean) to authenticated;

-- 4. Bulk confirm pending contributions
create or replace function public.bulk_confirm_contributions(
  p_contribution_ids uuid[],
  p_review_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_count integer := 0;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can confirm pending contributions.' using errcode = '42501';
  end if;
  if p_contribution_ids is null or coalesce(array_length(p_contribution_ids, 1), 0) = 0 then
    raise exception 'Select at least one pending contribution to confirm.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'Review note must not exceed 500 characters.' using errcode = '22023';
  end if;

  update public.contributions
  set approval_status = 'CONFIRMED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = v_note
  where id = any(p_contribution_ids)
    and group_id = v_group_id
    and approval_status = 'PENDING';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.bulk_confirm_contributions(uuid[], text) from public, anon;
grant execute on function public.bulk_confirm_contributions(uuid[], text) to authenticated;

-- 5. Batch remind unpaid members
create or replace function public.remind_unpaid_members(
  p_period_month date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', coalesce(p_period_month, current_date))::date;
  v_row record;
  v_user_id uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
  v_unlinked integer := 0;
  v_unpaid_total integer := 0;
begin
  if v_role not in ('ADMIN', 'TREASURER') or v_group_id is null then
    raise exception 'Only an administrator or treasurer can send payment reminders.' using errcode = '42501';
  end if;

  for v_row in
    select vcs.member_id, vcs.member_name, vcs.outstanding_amount, cp.due_date
    from public.v_contribution_status vcs
    join public.contribution_periods cp on cp.id = vcs.contribution_period_id
    where cp.group_id = v_group_id
      and vcs.period_month = v_month
      and vcs.payment_status in ('UNPAID', 'PARTIALLY PAID')
      and vcs.outstanding_amount > 0
  loop
    v_unpaid_total := v_unpaid_total + 1;

    select u.id into v_user_id
    from (
      select gm.user_id as id from public.group_memberships gm where gm.group_id = v_group_id and gm.member_id = v_row.member_id and gm.status = 'ACTIVE'
      union
      select p.id from public.profiles p where p.group_id = v_group_id and p.member_id = v_row.member_id and p.status = 'ACTIVE'
    ) u
    join public.profiles p on p.id = u.id
    where p.notifications_enabled
    limit 1;

    if v_user_id is null then
      v_unlinked := v_unlinked + 1;
    elsif exists (
      select 1 from public.notifications n
      where n.recipient_id = v_user_id
        and n.group_id = v_group_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.created_at > now() - interval '6 hours'
        and n.message like '%' || to_char(v_month, 'FMMonth YYYY') || '%'
    ) then
      v_skipped := v_skipped + 1;
    else
      perform public.push_notification(
        v_user_id,
        'CONTRIBUTION_REMINDER',
        'Contribution reminder for ' || to_char(v_month, 'FMMonth YYYY'),
        'Outstanding balance: PHP ' || to_char(v_row.outstanding_amount, 'FM999,999,990.00') || '. Due ' || to_char(v_row.due_date, 'Mon DD, YYYY') || '.',
        'user.html',
        v_group_id
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'sent', v_sent,
    'skipped_recent', v_skipped,
    'unlinked', v_unlinked,
    'unpaid_total', v_unpaid_total
  );
end;
$$;

revoke execute on function public.remind_unpaid_members(date) from public, anon;
grant execute on function public.remind_unpaid_members(date) to authenticated;

-- 6. Member payment & on-time streak inside get_user_dashboard()
create or replace function public.get_user_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_member_id uuid := public.current_member_id();
  v_current_month date := date_trunc('month', current_date)::date;
  v_rec record;
  v_payment_streak integer := 0;
  v_on_time_streak integer := 0;
  v_break_paid boolean := false;
  v_break_on_time boolean := false;
begin
  if v_member_id is null then
    return null;
  end if;

  for v_rec in
    select
      cp.period_month,
      cp.due_date,
      cp.is_exempt,
      cp.required_amount,
      coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as paid_amount,
      min(c.payment_date) filter (where c.approval_status = 'CONFIRMED') as first_paid_date
    from public.contribution_periods cp
    left join public.contributions c on c.contribution_period_id = cp.id
    where cp.member_id = v_member_id
      and cp.period_month <= v_current_month
    group by cp.id, cp.period_month, cp.due_date, cp.is_exempt, cp.required_amount
    order by cp.period_month desc
  loop
    -- Do not break an existing streak for an open current period not yet past due.
    if v_rec.period_month = v_current_month and v_rec.paid_amount < v_rec.required_amount and not v_rec.is_exempt and current_date <= v_rec.due_date then
      continue;
    end if;

    if not v_break_paid then
      if v_rec.is_exempt or v_rec.paid_amount >= v_rec.required_amount then
        v_payment_streak := v_payment_streak + 1;
      else
        v_break_paid := true;
      end if;
    end if;

    if not v_break_on_time then
      if v_rec.is_exempt or (v_rec.paid_amount >= v_rec.required_amount and v_rec.first_paid_date is not null and v_rec.first_paid_date <= v_rec.due_date) then
        v_on_time_streak := v_on_time_streak + 1;
      else
        v_break_on_time := true;
      end if;
    end if;

    exit when v_break_paid and v_break_on_time;
  end loop;

  return jsonb_build_object(
    'total_contributed', (select coalesce(sum(c.amount), 0) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'CONFIRMED'),
    'months_paid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('PAID', 'OVERPAID')),
    'months_unpaid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('UNPAID', 'PARTIALLY PAID') and period_month <= v_current_month),
    'pending_submissions', (select count(*) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'PENDING'),
    'payment_streak', v_payment_streak,
    'on_time_streak', v_on_time_streak,
    'current_period', (select to_jsonb(x) from (select vcs.period_month, vcs.required_amount, vcs.paid_amount, vcs.outstanding_amount, vcs.payment_status, cp.due_date, cp.is_exempt, cp.exempt_reason from public.v_contribution_status vcs join public.contribution_periods cp on cp.id = vcs.contribution_period_id where vcs.member_id = v_member_id and vcs.period_month = v_current_month) x)
  );
end;
$$;

-- 7. Cloud-synced goal calculator plans
create table if not exists public.savings_calculator_plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date,
  split_members integer not null default 1 check (split_members between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists savings_calculator_plans_group_user_idx
  on public.savings_calculator_plans (group_id, user_id, updated_at desc);

drop trigger if exists savings_calculator_plans_updated_at on public.savings_calculator_plans;
create trigger savings_calculator_plans_updated_at before update on public.savings_calculator_plans
  for each row execute function public.set_updated_at();

alter table public.savings_calculator_plans enable row level security;

drop policy if exists mfa_verified_for_opted_in on public.savings_calculator_plans;
create policy mfa_verified_for_opted_in on public.savings_calculator_plans
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists savings_calculator_plans_select on public.savings_calculator_plans;
create policy savings_calculator_plans_select on public.savings_calculator_plans
  for select to authenticated
  using (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

drop policy if exists savings_calculator_plans_insert on public.savings_calculator_plans;
create policy savings_calculator_plans_insert on public.savings_calculator_plans
  for insert to authenticated
  with check (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

drop policy if exists savings_calculator_plans_update on public.savings_calculator_plans;
create policy savings_calculator_plans_update on public.savings_calculator_plans
  for update to authenticated
  using (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'))
  with check (group_id = public.current_group_id() and user_id = auth.uid());

drop policy if exists savings_calculator_plans_delete on public.savings_calculator_plans;
create policy savings_calculator_plans_delete on public.savings_calculator_plans
  for delete to authenticated
  using (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

grant select, insert, update, delete on public.savings_calculator_plans to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.savings_calculator_plans;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- 8. Super Admin storage overview and old rejected/voided receipt cleanup
create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
  v_old jsonb;
  v_new jsonb;
begin
  if current_setting('ipon.maintenance_receipt_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_super_admin()
     and tg_op = 'UPDATE'
     and tg_table_name in ('contributions', 'expenses') then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if (v_old ->> 'group_id') is not distinct from (v_new ->> 'group_id')
       and (v_old ->> 'amount') is not distinct from (v_new ->> 'amount')
       and (v_old ->> 'approval_status') is not distinct from (v_new ->> 'approval_status')
       and (v_old ->> 'approval_status') in ('REJECTED', 'VOIDED')
       and nullif(v_new ->> 'receipt_url', '') is null then
      return new;
    end if;
  end if;

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

create or replace function public.super_admin_storage_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_super_admin() then null
    else jsonb_build_object(
      'contribution_receipts_count', (select count(*) from public.contributions where receipt_url is not null),
      'contribution_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null),
      'expense_receipts_count', (select count(*) from public.expenses where receipt_url is not null),
      'expense_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null),
      'announcements_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.announcements where jsonb_array_length(attachments) > 0),
      'bug_reports_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.bug_reports where jsonb_array_length(attachments) > 0),
      'avatars_and_qr_bytes',
        (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.profiles where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.groups where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(payment_qr_url)), 0) from public.groups where payment_qr_url is not null),
      'reclaimable_rejected_count',
        (select count(*) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select count(*) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'reclaimable_rejected_bytes',
        (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
    )
  end;
$$;

revoke execute on function public.super_admin_storage_overview() from public, anon;
grant execute on function public.super_admin_storage_overview() to authenticated;

create or replace function public.super_admin_cleanup_rejected_receipts(
  p_older_than_days integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(coalesce(p_older_than_days, 90), 30);
  v_cutoff timestamptz := now() - make_interval(days => v_days);
  v_c integer := 0;
  v_e integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can purge archived receipt attachments.' using errcode = '42501';
  end if;

  perform set_config('ipon.maintenance_receipt_cleanup', 'on', true);

  update public.contributions
  set receipt_url = null
  where receipt_url is not null
    and approval_status in ('REJECTED', 'VOIDED')
    and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_cutoff;
  get diagnostics v_c = row_count;

  update public.expenses
  set receipt_url = null
  where receipt_url is not null
    and approval_status in ('REJECTED', 'VOIDED')
    and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_cutoff;
  get diagnostics v_e = row_count;

  return v_c + v_e;
end;
$$;

revoke execute on function public.super_admin_cleanup_rejected_receipts(integer) from public, anon;
grant execute on function public.super_admin_cleanup_rejected_receipts(integer) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_049', 'workflow planning exemptions carryover cycle archive and storage hygiene')
on conflict (version) do nothing;


-- Migration 050: Reliable self-serve account activation & recovery on sign-in
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

alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_recipient_dedupe_uidx
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notifications replica identity full;

insert into public.schema_migrations (version, name)
values ('20261114_051', 'replace or remove prior announcement reaction notifications instead of stacking duplicates')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261114_052', 'restore self-serve admin_create_group and admin contributor pledge sync')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261114_053', 'use jsonb old/new inspection in enforce_group_scope so tables without amount do not fail')
on conflict (version) do nothing;

-- 20261114_054: Allow group admins to transfer ownership and leave or permanently delete a group.
create or replace function public.admin_transfer_and_leave_group(
  p_group_id uuid,
  p_new_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_group uuid := public.current_group_id();
  v_actor_name text;
  v_group public.groups;
  v_target_gm public.group_memberships;
  v_old_member_id uuid;
  v_next_gm public.group_memberships;
  v_next_member_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_admin() or v_actor_group is null or v_actor_group is distinct from p_group_id then
    raise exception 'Only the active administrator of this group can transfer ownership.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_actor_group and status = 'ACTIVE';

  if not found then
    raise exception 'Active savings group not found.' using errcode = 'P0002';
  end if;

  if p_new_admin_user_id is null or p_new_admin_user_id = v_actor_id then
    raise exception 'Choose another active member in this group to receive the administrator role.' using errcode = '22023';
  end if;

  select gm.* into v_target_gm
  from public.group_memberships gm
  join public.profiles p on p.id = gm.user_id
  where gm.group_id = v_actor_group
    and gm.user_id = p_new_admin_user_id
    and gm.status = 'ACTIVE'
    and p.status = 'ACTIVE'
    and p.role <> 'SUPER_ADMIN';

  if not found then
    raise exception 'Selected user must be an active member or treasurer of this savings group.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name
  from public.profiles
  where id = v_actor_id;

  update public.groups
  set owner_id = p_new_admin_user_id
  where id = v_actor_group;

  update public.group_memberships
  set role = 'ADMIN'
  where group_id = v_actor_group
    and user_id = p_new_admin_user_id;

  update public.profiles
  set role = 'ADMIN',
      group_id = case when group_id is null then v_actor_group else group_id end,
      member_id = case
        when (group_id is null or group_id = v_actor_group) and v_target_gm.member_id is not null
          then (select m.id from public.members m where m.id = v_target_gm.member_id and m.group_id = v_actor_group and m.status = 'ACTIVE' and m.deleted_at is null)
        when group_id is null or group_id = v_actor_group then null
        else member_id
      end
  where id = p_new_admin_user_id
    and (group_id = v_actor_group or group_id is null);

  delete from public.group_memberships
  where group_id = v_actor_group
    and user_id = v_actor_id
  returning member_id into v_old_member_id;

  if v_old_member_id is not null then
    update public.members
    set status = 'INACTIVE',
        deactivated_at = now(),
        updated_by = v_actor_id
    where id = v_old_member_id
      and group_id = v_actor_group
      and deleted_at is null;

    delete from public.contribution_periods cp
    where cp.member_id = v_old_member_id
      and cp.group_id = v_actor_group
      and not exists (
        select 1 from public.contributions c
        where c.contribution_period_id = cp.id
      );
  end if;

  select gm.* into v_next_gm
  from public.group_memberships gm
  join public.groups g on g.id = gm.group_id
  where gm.user_id = v_actor_id
    and gm.status = 'ACTIVE'
    and g.status = 'ACTIVE'
  order by gm.created_at asc
  limit 1;

  if found then
    v_next_member_id := null;
    if v_next_gm.member_id is not null then
      select m.id into v_next_member_id
      from public.members m
      where m.id = v_next_gm.member_id
        and m.group_id = v_next_gm.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null;
    end if;

    update public.profiles
    set group_id = v_next_gm.group_id,
        role = v_next_gm.role,
        member_id = v_next_member_id
    where id = v_actor_id;
  else
    update public.profiles
    set group_id = null,
        role = 'MEMBER',
        member_id = null
    where id = v_actor_id;
  end if;

  perform public.push_notification(
    p_new_admin_user_id,
    'GROUP_ADMIN_TRANSFERRED',
    'You are now group administrator',
    coalesce(nullif(btrim(v_actor_name), ''), 'The previous administrator')
      || ' transferred administrator ownership of "' || v_group.name || '" to you.',
    'dashboard.html',
    v_actor_group
  );

  return jsonb_build_object(
    'group_id', v_actor_group,
    'transferred_to', p_new_admin_user_id,
    'next_group_id', v_next_gm.group_id
  );
end;
$$;

create or replace function public.admin_delete_group(
  p_group_id uuid,
  p_confirm_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_group uuid := public.current_group_id();
  v_group public.groups;
  v_affected_users uuid[];
  v_uid uuid;
  v_next_gm public.group_memberships;
  v_next_member_id uuid;
  v_actor_next_group_id uuid := null;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_admin() or v_actor_group is null or v_actor_group is distinct from p_group_id then
    raise exception 'Only the active administrator of this group can delete it.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_actor_group;

  if not found then
    raise exception 'Savings group not found.' using errcode = 'P0002';
  end if;

  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_group.name)) then
    raise exception 'Group name confirmation does not match "%".', v_group.name using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct u.user_id), '{}'::uuid[])
  into v_affected_users
  from (
    select p.id as user_id
    from public.profiles p
    where p.group_id = v_actor_group and p.role <> 'SUPER_ADMIN'
    union
    select gm.user_id
    from public.group_memberships gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = v_actor_group and p.role <> 'SUPER_ADMIN'
  ) u;

  delete from public.contributions where group_id = v_actor_group;
  delete from public.contribution_periods where group_id = v_actor_group;
  delete from public.expenses where group_id = v_actor_group;
  delete from public.withdrawals where group_id = v_actor_group;
  delete from public.savings_goals where group_id = v_actor_group;
  delete from public.contribution_settings where group_id = v_actor_group;

  update public.profiles
  set member_id = null
  where member_id in (select id from public.members where group_id = v_actor_group);

  update public.group_memberships
  set member_id = null
  where group_id = v_actor_group;

  delete from public.members where group_id = v_actor_group;

  foreach v_uid in array v_affected_users loop
    if exists (select 1 from public.profiles p where p.id = v_uid and p.group_id = v_actor_group) then
      select gm.* into v_next_gm
      from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
      where gm.user_id = v_uid
        and gm.group_id <> v_actor_group
        and gm.status = 'ACTIVE'
        and g.status = 'ACTIVE'
      order by gm.created_at asc
      limit 1;

      if found then
        v_next_member_id := null;
        if v_next_gm.member_id is not null then
          select m.id into v_next_member_id
          from public.members m
          where m.id = v_next_gm.member_id
            and m.group_id = v_next_gm.group_id
            and m.status = 'ACTIVE'
            and m.deleted_at is null;
        end if;

        update public.profiles
        set group_id = v_next_gm.group_id,
            role = v_next_gm.role,
            member_id = v_next_member_id
        where id = v_uid;

        if v_uid = v_actor_id then
          v_actor_next_group_id := v_next_gm.group_id;
        end if;
      else
        update public.profiles
        set group_id = null,
            role = 'MEMBER',
            member_id = null
        where id = v_uid;
      end if;
    end if;

    if v_uid <> v_actor_id then
      perform public.push_notification(
        v_uid,
        'GROUP_DELETED',
        'Savings group deleted',
        '"' || v_group.name || '" was permanently deleted by its administrator.',
        'dashboard.html',
        null
      );
    end if;
  end loop;

  delete from public.groups where id = v_actor_group;

  return jsonb_build_object(
    'deleted_group_id', v_actor_group,
    'deleted_group_name', v_group.name,
    'next_group_id', v_actor_next_group_id
  );
end;
$$;

revoke execute on function public.admin_transfer_and_leave_group(uuid, uuid) from public, anon;
revoke execute on function public.admin_delete_group(uuid, text) from public, anon;

grant execute on function public.admin_transfer_and_leave_group(uuid, uuid) to authenticated;
grant execute on function public.admin_delete_group(uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_054', 'allow group admins to transfer ownership and leave or permanently delete a group')
on conflict (version) do nothing;

insert into public.schema_migrations (version, name)
values ('20261114_055', 'guard write_audit_log against deleted group_id and detach profiles before deleting groups')
on conflict (version) do nothing;

-- Migration 056: Payment Method Tagging & Wallet Reconciliation
alter table public.contributions
  add column if not exists payment_method text;

alter table public.withdrawals
  add column if not exists payment_method text;

alter table public.expenses
  add column if not exists payment_method text;

alter table public.contributions
  drop constraint if exists contributions_payment_method_check;
alter table public.contributions
  add constraint contributions_payment_method_check
  check (payment_method is null or payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

alter table public.withdrawals
  drop constraint if exists withdrawals_payment_method_check;
alter table public.withdrawals
  add constraint withdrawals_payment_method_check
  check (payment_method is null or payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

alter table public.expenses
  drop constraint if exists expenses_payment_method_check;
alter table public.expenses
  add constraint expenses_payment_method_check
  check (payment_method is null or payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

create index if not exists contributions_group_payment_method_idx
  on public.contributions (group_id, payment_method);

create index if not exists withdrawals_group_payment_method_idx
  on public.withdrawals (group_id, payment_method);

create index if not exists expenses_group_payment_method_idx
  on public.expenses (group_id, payment_method);

create or replace function public.normalized_payment_method(p_method text)
returns text
language plpgsql
immutable
as $$
declare
  v_norm text := nullif(upper(regexp_replace(btrim(coalesce(p_method, '')), '\s+', '_', 'g')), '');
begin
  if v_norm is null then
    return null;
  end if;
  if v_norm in ('BANK', 'BANK_TRANSFER', 'INSTAPAY', 'PESONET') then
    return 'BANK_TRANSFER';
  end if;
  if v_norm in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER') then
    return v_norm;
  end if;
  raise exception 'Invalid payment method. Choose Cash, GCash, Maya, Bank Transfer, or Other.' using errcode = '22023';
end;
$$;

drop function if exists public.record_contribution(uuid, date, numeric, date, text, text, uuid, text);

create or replace function public.record_contribution(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_payment_method text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_period_id uuid;
  v_required numeric(14,2);
  v_id uuid;
  v_status public.approval_status;
  v_month date := date_trunc('month', p_contribution_month)::date;
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month)
  )
  on conflict (member_id, period_month) do nothing;

  select id into v_period_id
  from public.contribution_periods
  where member_id = p_member_id and period_month = v_month;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.contributions (
    contribution_period_id, amount, payment_date, transaction_reference,
    idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    v_period_id, public.validated_money(p_amount, 'Contribution amount'), p_payment_date,
    nullif(btrim(p_transaction_reference), ''), p_idempotency_key,
    nullif(btrim(p_notes), ''), v_receipt, v_method, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean);

create or replace function public.record_contribution_with_carryover(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_allocate_excess boolean default false,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_contribution_month)::date;
  v_amount numeric(14,2) := public.validated_money(p_amount, 'Contribution amount');
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_method text := public.normalized_payment_method(p_payment_method);
  v_required numeric(14,2);
  v_status public.approval_status;
  v_remaining numeric(14,2);
  v_cursor_month date;
  v_period record;
  v_covered numeric(14,2);
  v_needed numeric(14,2);
  v_slice numeric(14,2);
  v_first_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_i integer := 0;
  v_use_receipt text;
  v_slice_notes text;
  v_slice_key uuid;
begin
  if not coalesce(p_allocate_excess, false) then
    v_id := public.record_contribution(
      p_member_id,
      p_contribution_month,
      v_amount,
      p_payment_date,
      p_transaction_reference,
      p_notes,
      p_idempotency_key,
      p_receipt_url,
      v_method
    );
    return jsonb_build_object('ids', array[v_id], 'months_covered', 1);
  end if;

  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select id into v_first_id
  from public.contributions
  where idempotency_key = p_idempotency_key;

  if v_first_id is not null then
    return jsonb_build_object('ids', array[v_first_id], 'months_covered', 1);
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;
  v_remaining := v_amount;
  v_cursor_month := v_month;

  while v_remaining > 0 and v_i < 24 loop
    insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
    values (
      p_member_id,
      v_cursor_month,
      v_required,
      public.contribution_period_due_date(v_group_id, v_cursor_month)
    )
    on conflict (member_id, period_month) do nothing;

    select id, required_amount, is_exempt into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_cursor_month;

    if not coalesce(v_period.is_exempt, false) then
      select coalesce(sum(amount) filter (where approval_status in ('CONFIRMED', 'PENDING')), 0)::numeric(14,2)
      into v_covered
      from public.contributions
      where contribution_period_id = v_period.id;

      v_needed := greatest(v_period.required_amount - coalesce(v_covered, 0), 0);
      if v_needed > 0 then
        v_slice := least(v_remaining, v_needed);
        v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
        v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;
        v_slice_notes := case
          when coalesce(array_length(v_ids, 1), 0) = 0 then v_notes
          else left(trim(both ' ' from concat_ws(' · ', 'Advance carry-over from ' || to_char(v_month, 'Mon YYYY'), v_notes)), 1000)
        end;

        insert into public.contributions (
          contribution_period_id, amount, payment_date, transaction_reference,
          idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
          reviewed_by, reviewed_at
        ) values (
          v_period.id, v_slice, p_payment_date,
          nullif(btrim(p_transaction_reference), ''), v_slice_key,
          v_slice_notes, v_use_receipt, v_method, v_status, auth.uid(),
          case when v_status = 'CONFIRMED' then auth.uid() end,
          case when v_status = 'CONFIRMED' then now() end
        ) returning id into v_id;

        v_ids := array_append(v_ids, v_id);
        v_remaining := v_remaining - v_slice;
      end if;
    end if;

    v_cursor_month := (v_cursor_month + interval '1 month')::date;
    v_i := v_i + 1;
  end loop;

  if v_remaining > 0 then
    select id into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_month;

    v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
    v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;

    insert into public.contributions (
      contribution_period_id, amount, payment_date, transaction_reference,
      idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
      reviewed_by, reviewed_at
    ) values (
      v_period.id, v_remaining, p_payment_date,
      nullif(btrim(p_transaction_reference), ''), v_slice_key,
      left(trim(both ' ' from concat_ws(' · ', v_notes, 'Excess beyond 24 months')), 1000),
      v_use_receipt, v_method, v_status, auth.uid(),
      case when v_status = 'CONFIRMED' then auth.uid() end,
      case when v_status = 'CONFIRMED' then now() end
    ) returning id into v_id;

    v_ids := array_append(v_ids, v_id);
  end if;

  return jsonb_build_object('ids', v_ids, 'months_covered', coalesce(array_length(v_ids, 1), 0));
end;
$$;

drop function if exists public.update_contribution(uuid, numeric, date, text, text);

create or replace function public.update_contribution(
  p_contribution_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text,
  p_notes text,
  p_payment_method text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.contributions;
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_next_method text;
begin
  select * into v_entry
  from public.contributions
  where id = p_contribution_id and group_id = v_group_id;
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

  v_next_method := case
    when p_payment_method = '__KEEP__' then v_entry.payment_method
    else public.normalized_payment_method(p_payment_method)
  end;

  update public.contributions
  set amount = public.validated_money(p_amount, 'Contribution amount'),
      payment_date = p_payment_date,
      transaction_reference = nullif(btrim(p_transaction_reference), ''),
      notes = nullif(btrim(p_notes), ''),
      payment_method = v_next_method
  where id = p_contribution_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending contribution not found.' using errcode = 'P0002'; end if;
end;
$$;

drop function if exists public.record_withdrawal(date, numeric, text, text, text, text, text, uuid);

create or replace function public.record_withdrawal(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_payment_method text default null
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
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'Only administrators and treasurers can record withdrawals.' using errcode = '42501'; end if;
  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.withdrawals (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, payment_method, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Withdrawal amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_method, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.update_withdrawal(uuid, date, numeric, text, text, text, text, text);

create or replace function public.update_withdrawal(
  p_withdrawal_id uuid,
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text,
  p_notes text,
  p_payment_method text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.withdrawals;
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_next_method text;
begin
  select * into v_entry
  from public.withdrawals
  where id = p_withdrawal_id and group_id = v_group_id;
  if not found then raise exception 'Withdrawal not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending withdrawals can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'You are not allowed to edit this entry.' using errcode = '42501'; end if;

  v_next_method := case
    when p_payment_method = '__KEEP__' then v_entry.payment_method
    else public.normalized_payment_method(p_payment_method)
  end;

  update public.withdrawals set
    transaction_date = p_transaction_date,
    amount = public.validated_money(p_amount, 'Withdrawal amount'),
    category = btrim(p_category),
    description = btrim(p_description),
    person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''),
    notes = nullif(btrim(p_notes), ''),
    payment_method = v_next_method
  where id = p_withdrawal_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending withdrawal not found.' using errcode = 'P0002'; end if;
end;
$$;

drop function if exists public.record_expense(date, numeric, text, text, text, text, text, uuid, text);

create or replace function public.record_expense(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_payment_method text default null
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
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null or v_role not in ('ADMIN', 'TREASURER') then
    raise exception 'You are not allowed to record expenses.' using errcode = '42501';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.expenses (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Expense amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_receipt, v_method, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.update_expense(uuid, date, numeric, text, text, text, text, text);

create or replace function public.update_expense(
  p_expense_id uuid,
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text,
  p_notes text,
  p_payment_method text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.expenses;
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_next_method text;
begin
  select * into v_entry
  from public.expenses
  where id = p_expense_id and group_id = v_group_id;
  if not found then raise exception 'Expense not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending expenses can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role <> 'ADMIN' and v_role <> 'TREASURER' then
    raise exception 'You are not allowed to edit this expense.' using errcode = '42501';
  end if;

  v_next_method := case
    when p_payment_method = '__KEEP__' then v_entry.payment_method
    else public.normalized_payment_method(p_payment_method)
  end;

  update public.expenses set
    transaction_date = p_transaction_date,
    amount = public.validated_money(p_amount, 'Expense amount'),
    category = btrim(p_category),
    description = btrim(p_description),
    person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''),
    notes = nullif(btrim(p_notes), ''),
    payment_method = v_next_method
  where id = p_expense_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending expense not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.get_pending_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with gid as (
    select public.current_group_id() as group_id
  ),
  entries as (
    select
      c.id,
      c.amount,
      c.payment_date as activity_date,
      c.created_at,
      'contribution'::text as entry_type,
      'Savings Addition'::text as entry_label,
      m.full_name as member_name,
      coalesce(sp.full_name, m.full_name) as submitted_by_name,
      coalesce(
        public.group_member_avatar(m.id),
        case when sp.status = 'ACTIVE' then sp.avatar_url end
      ) as avatar_url,
      cp.period_month,
      null::text as category,
      c.transaction_reference as reference,
      c.notes,
      null::text as description,
      c.receipt_url,
      c.payment_method
    from public.contributions c
    join gid on c.group_id = gid.group_id
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    left join public.profiles sp
      on sp.id = c.submitted_by
     and sp.group_id = c.group_id
    where c.approval_status = 'PENDING'

    union all

    select
      w.id,
      w.amount,
      w.transaction_date as activity_date,
      w.created_at,
      'withdrawal'::text as entry_type,
      'Deduction'::text as entry_label,
      w.person_responsible as member_name,
      coalesce(sp.full_name, w.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      w.category,
      w.reference_number as reference,
      w.notes,
      w.description,
      null::text as receipt_url,
      w.payment_method
    from public.withdrawals w
    join gid on w.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = w.submitted_by
     and sp.group_id = w.group_id
    where w.approval_status = 'PENDING'

    union all

    select
      e.id,
      e.amount,
      e.transaction_date as activity_date,
      e.created_at,
      'expense'::text as entry_type,
      'Expense'::text as entry_label,
      e.person_responsible as member_name,
      coalesce(sp.full_name, e.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      e.category,
      e.reference_number as reference,
      e.notes,
      e.description,
      e.receipt_url,
      e.payment_method
    from public.expenses e
    join gid on e.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = e.submitted_by
     and sp.group_id = e.group_id
    where e.approval_status = 'PENDING'
  ),
  recent as (
    select * from entries order by created_at desc limit 3
  )
  select case
    when public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and public.current_group_id() is not null
    then jsonb_build_object(
      'count', (select count(*) from entries),
      'amount', (select coalesce(sum(amount), 0) from entries),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'amount', amount,
              'date', activity_date,
              'type', entry_type,
              'entry_label', entry_label,
              'member_name', member_name,
              'submitted_by_name', submitted_by_name,
              'avatar_url', avatar_url,
              'period_month', period_month,
              'category', category,
              'reference', reference,
              'notes', notes,
              'description', description,
              'receipt_url', receipt_url,
              'payment_method', payment_method
            )
            order by created_at desc
          )
          from recent
        ),
        '[]'::jsonb
      )
    )
    else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb)
  end;
$$;

create or replace function public.get_wallet_reconciliation()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select
      public.current_user_role() as role_name,
      public.current_group_id() as group_id
  ),
  grp as (
    select g.id, g.cycle_start_date
    from public.groups g
    join ctx on ctx.group_id = g.id
  ),
  methods(method_key, sort_order) as (
    values
      ('CASH', 1),
      ('GCASH', 2),
      ('MAYA', 3),
      ('BANK_TRANSFER', 4),
      ('OTHER', 5),
      ('UNTAGGED', 6)
  ),
  raw_entries as (
    select
      coalesce(c.payment_method, 'UNTAGGED') as method_key,
      c.approval_status,
      c.amount as addition_amount,
      0::numeric(14,2) as deduction_amount,
      0::numeric(14,2) as expense_amount
    from public.contributions c
    join grp on c.group_id = grp.id
    where c.approval_status in ('CONFIRMED', 'PENDING')
      and (
        c.approval_status = 'PENDING'
        or grp.cycle_start_date is null
        or c.payment_date >= grp.cycle_start_date
      )

    union all

    select
      coalesce(w.payment_method, 'UNTAGGED') as method_key,
      w.approval_status,
      0::numeric(14,2) as addition_amount,
      w.amount as deduction_amount,
      0::numeric(14,2) as expense_amount
    from public.withdrawals w
    join grp on w.group_id = grp.id
    where w.approval_status in ('CONFIRMED', 'PENDING')
      and (
        w.approval_status = 'PENDING'
        or grp.cycle_start_date is null
        or w.transaction_date >= grp.cycle_start_date
      )

    union all

    select
      coalesce(e.payment_method, 'UNTAGGED') as method_key,
      e.approval_status,
      0::numeric(14,2) as addition_amount,
      0::numeric(14,2) as deduction_amount,
      e.amount as expense_amount
    from public.expenses e
    join grp on e.group_id = grp.id
    where e.approval_status in ('CONFIRMED', 'PENDING')
      and (
        e.approval_status = 'PENDING'
        or grp.cycle_start_date is null
        or e.transaction_date >= grp.cycle_start_date
      )
  ),
  agg as (
    select
      m.method_key,
      m.sort_order,
      coalesce(sum(r.addition_amount) filter (where r.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as additions,
      coalesce(sum(r.deduction_amount) filter (where r.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as deductions,
      coalesce(sum(r.expense_amount) filter (where r.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as expenses,
      coalesce(sum(r.addition_amount) filter (where r.approval_status = 'PENDING'), 0)::numeric(14,2) as pending_inflow,
      coalesce(sum(r.deduction_amount + r.expense_amount) filter (where r.approval_status = 'PENDING'), 0)::numeric(14,2) as pending_outflow,
      count(*) filter (where r.approval_status = 'CONFIRMED') as entry_count,
      count(*) filter (where r.approval_status = 'PENDING') as pending_count
    from methods m
    left join raw_entries r on r.method_key = m.method_key
    group by m.method_key, m.sort_order
  ),
  channel_rows as (
    select
      method_key,
      sort_order,
      additions,
      deductions,
      expenses,
      (additions - deductions - expenses)::numeric(14,2) as net_balance,
      pending_inflow,
      pending_outflow,
      entry_count,
      pending_count
    from agg
    where method_key <> 'UNTAGGED' or entry_count > 0 or pending_count > 0
  )
  select case
    when ctx.role_name not in ('ADMIN', 'TREASURER', 'MEMBER') or ctx.group_id is null then null
    else jsonb_build_object(
      'cycle_start_date', (select cycle_start_date from grp limit 1),
      'tracked_savings', coalesce((select sum(net_balance) from channel_rows), 0),
      'physical_cash_balance', coalesce((select net_balance from channel_rows where method_key = 'CASH'), 0),
      'digital_wallet_balance', coalesce((select sum(net_balance) from channel_rows where method_key in ('GCASH', 'MAYA', 'BANK_TRANSFER')), 0),
      'other_balance', coalesce((select net_balance from channel_rows where method_key = 'OTHER'), 0),
      'untagged_balance', coalesce((select net_balance from channel_rows where method_key = 'UNTAGGED'), 0),
      'has_untagged', exists (select 1 from channel_rows where method_key = 'UNTAGGED'),
      'channels', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'method', cr.method_key,
              'additions', cr.additions,
              'deductions', cr.deductions,
              'expenses', cr.expenses,
              'net_balance', cr.net_balance,
              'pending_inflow', cr.pending_inflow,
              'pending_outflow', cr.pending_outflow,
              'entry_count', cr.entry_count,
              'pending_count', cr.pending_count
            )
            order by cr.sort_order
          )
          from channel_rows cr
        ),
        '[]'::jsonb
      )
    )
  end
  from ctx;
$$;

revoke execute on function public.normalized_payment_method(text) from public, anon;
revoke execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid, text, text) from public, anon;
revoke execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean, text) from public, anon;
revoke execute on function public.update_contribution(uuid, numeric, date, text, text, text) from public, anon;
revoke execute on function public.record_withdrawal(date, numeric, text, text, text, text, text, uuid, text) from public, anon;
revoke execute on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text, text) from public, anon;
revoke execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid, text, text) from public, anon;
revoke execute on function public.update_expense(uuid, date, numeric, text, text, text, text, text, text) from public, anon;
revoke execute on function public.get_pending_review_summary() from public, anon;
revoke execute on function public.get_wallet_reconciliation() from public, anon;

grant execute on function public.normalized_payment_method(text) to authenticated;
grant execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid, text, text) to authenticated;
grant execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean, text) to authenticated;
grant execute on function public.update_contribution(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.record_withdrawal(date, numeric, text, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.update_expense(uuid, date, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_pending_review_summary() to authenticated;
grant execute on function public.get_wallet_reconciliation() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_056', 'add payment method tagging and wallet reconciliation')
on conflict (version) do nothing;

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

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  record_type text not null check (record_type in ('contribution', 'withdrawal', 'expense')),
  record_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists record_comments_lookup_idx
  on public.record_comments (group_id, record_type, record_id, created_at asc);

alter table public.record_comments enable row level security;
alter table public.record_comments force row level security;

drop policy if exists mfa_verified_for_opted_in on public.record_comments;
create policy mfa_verified_for_opted_in on public.record_comments
as restrictive for all to authenticated
using (public.mfa_access_allowed());

drop policy if exists record_comments_select on public.record_comments;
create policy record_comments_select on public.record_comments for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

do $$
begin
  alter publication supabase_realtime add table public.record_comments;
exception when duplicate_object then null;
end $$;

create or replace function public.get_record_comments(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_record jsonb;
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_can_reply boolean := false;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;

  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select
      jsonb_build_object(
        'id', c.id,
        'type', 'contribution',
        'authorName', m.full_name,
        'amount', c.amount,
        'date', c.payment_date,
        'periodMonth', cp.period_month,
        'status', c.approval_status::text,
        'paymentMethod', c.payment_method,
        'reference', c.transaction_reference,
        'notes', coalesce(nullif(c.void_reason, ''), nullif(c.review_note, ''), nullif(c.notes, '')),
        'reviewNote', coalesce(nullif(c.void_reason, ''), nullif(c.review_note, '')),
        'receiptUrl', c.receipt_url
      ),
      c.submitted_by,
      cp.member_id
    into v_record, v_submitted_by, v_target_member_id
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id
      and c.group_id = v_group;
  elsif v_type = 'withdrawal' then
    select
      jsonb_build_object(
        'id', w.id,
        'type', 'withdrawal',
        'authorName', w.person_responsible,
        'amount', w.amount,
        'date', w.transaction_date,
        'category', w.category,
        'status', w.approval_status::text,
        'paymentMethod', w.payment_method,
        'reference', w.reference_number,
        'description', w.description,
        'notes', coalesce(nullif(w.void_reason, ''), nullif(w.review_note, ''), nullif(w.notes, '')),
        'reviewNote', coalesce(nullif(w.void_reason, ''), nullif(w.review_note, '')),
        'receiptUrl', null
      ),
      w.submitted_by,
      w.person_responsible
    into v_record, v_submitted_by, v_person_responsible
    from public.withdrawals w
    where w.id = p_record_id
      and w.group_id = v_group;
  else
    select
      jsonb_build_object(
        'id', e.id,
        'type', 'expense',
        'authorName', e.person_responsible,
        'amount', e.amount,
        'date', e.transaction_date,
        'category', e.category,
        'status', e.approval_status::text,
        'paymentMethod', e.payment_method,
        'reference', e.reference_number,
        'description', e.description,
        'notes', coalesce(nullif(e.void_reason, ''), nullif(e.review_note, ''), nullif(e.notes, '')),
        'reviewNote', coalesce(nullif(e.void_reason, ''), nullif(e.review_note, '')),
        'receiptUrl', e.receipt_url
      ),
      e.submitted_by,
      e.person_responsible
    into v_record, v_submitted_by, v_person_responsible
    from public.expenses e
    where e.id = p_record_id
      and e.group_id = v_group;
  end if;

  if v_record is null then
    raise exception 'Record not found in the active savings group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_can_reply := true;
  else
    if v_member_id is not null then
      select m.full_name into v_my_member_name
      from public.members m
      where m.id = v_member_id and m.group_id = v_group;
    end if;
    if v_type = 'contribution' then
      v_can_reply := (v_submitted_by = auth.uid() or (v_member_id is not null and v_target_member_id = v_member_id));
    else
      v_can_reply := (
        v_submitted_by = auth.uid()
        or (v_my_member_name is not null and lower(btrim(coalesce(v_person_responsible, ''))) = lower(btrim(v_my_member_name)))
      );
    end if;
  end if;

  return jsonb_build_object(
    'record', v_record,
    'can_reply', v_can_reply,
    'comments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', rc.id,
            'record_type', rc.record_type,
            'record_id', rc.record_id,
            'author_id', rc.author_id,
            'author_name', coalesce(nullif(btrim(p.full_name), ''), 'Group member'),
            'author_role', coalesce(gm.role::text, p.role::text, 'MEMBER'),
            'author_avatar_url', p.avatar_url,
            'body', rc.body,
            'created_at', rc.created_at,
            'is_own', rc.author_id = auth.uid()
          )
          order by rc.created_at asc, rc.id asc
        )
        from public.record_comments rc
        join public.profiles p on p.id = rc.author_id
        left join public.group_memberships gm
          on gm.group_id = v_group
         and gm.user_id = rc.author_id
         and gm.status = 'ACTIVE'
        where rc.group_id = v_group
          and rc.record_type = v_type
          and rc.record_id = p_record_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_record_comment_counts(
  p_record_type text,
  p_record_ids uuid[]
)
returns table (
  record_id uuid,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select rc.record_id, count(*)::bigint as comment_count
  from public.record_comments rc
  where rc.group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
    and rc.record_type = lower(btrim(coalesce(p_record_type, '')))
    and rc.record_id = any(coalesce(p_record_ids, '{}'::uuid[]))
  group by rc.record_id;
$$;

create or replace function public.add_record_comment(
  p_record_type text,
  p_record_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_amount numeric(14,2);
  v_subject_name text;
  v_allowed boolean := false;
  v_comment public.record_comments;
  v_author_name text;
  v_author_avatar text;
  v_type_label text;
  v_page text;
  v_snippet text;
  v_recipient record;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;

  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;

  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'Reply must be between 1 and 1000 characters.' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select c.submitted_by, cp.member_id, m.full_name, c.amount
    into v_submitted_by, v_target_member_id, v_subject_name, v_amount
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id
      and c.group_id = v_group;
    v_type_label := 'contribution';
    v_page := 'contributions.html';
  elsif v_type = 'withdrawal' then
    select w.submitted_by, w.person_responsible, w.person_responsible, w.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.withdrawals w
    where w.id = p_record_id
      and w.group_id = v_group;
    v_type_label := 'deduction';
    v_page := 'withdrawals.html';
  else
    select e.submitted_by, e.person_responsible, e.person_responsible, e.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.expenses e
    where e.id = p_record_id
      and e.group_id = v_group;
    v_type_label := 'expense';
    v_page := 'expenses.html';
  end if;

  if not found then
    raise exception 'Record not found in the active savings group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_allowed := true;
  else
    if v_member_id is not null then
      select m.full_name into v_my_member_name
      from public.members m
      where m.id = v_member_id and m.group_id = v_group;
    end if;
    if v_type = 'contribution' then
      v_allowed := (v_submitted_by = auth.uid() or (v_member_id is not null and v_target_member_id = v_member_id));
    else
      v_allowed := (
        v_submitted_by = auth.uid()
        or (v_my_member_name is not null and lower(btrim(coalesce(v_person_responsible, ''))) = lower(btrim(v_my_member_name)))
      );
    end if;
  end if;

  if not v_allowed then
    raise exception 'You can only reply to records associated with your account.' using errcode = '42501';
  end if;

  insert into public.record_comments (group_id, record_type, record_id, author_id, body)
  values (v_group, v_type, p_record_id, auth.uid(), v_body)
  returning * into v_comment;

  select coalesce(nullif(btrim(p.full_name), ''), 'Group member'), p.avatar_url
  into v_author_name, v_author_avatar
  from public.profiles p
  where p.id = auth.uid();

  v_snippet := case
    when char_length(v_body) > 120 then left(v_body, 117) || '...'
    else v_body
  end;

  for v_recipient in
    select distinct
      r.user_id,
      coalesce(gm.role, p.role) as target_role
    from (
      select a.user_id
      from public.group_admin_ids(v_group) a
      union
      select v_submitted_by where v_submitted_by is not null
      union
      select gm_m.user_id
      from public.group_memberships gm_m
      where v_target_member_id is not null
        and gm_m.group_id = v_group
        and gm_m.member_id = v_target_member_id
        and gm_m.status = 'ACTIVE'
      union
      select p_m.id
      from public.profiles p_m
      where v_target_member_id is not null
        and p_m.member_id = v_target_member_id
        and p_m.status = 'ACTIVE'
      union
      select prev.author_id
      from public.record_comments prev
      where prev.group_id = v_group
        and prev.record_type = v_type
        and prev.record_id = p_record_id
    ) r
    join public.profiles p on p.id = r.user_id
    left join public.group_memberships gm
      on gm.group_id = v_group
     and gm.user_id = r.user_id
     and gm.status = 'ACTIVE'
    where r.user_id is not null
      and r.user_id <> auth.uid()
      and p.status = 'ACTIVE'
      and p.notifications_enabled
  loop
    perform public.push_notification(
      v_recipient.user_id,
      'RECORD_COMMENT',
      'New reply on ' || v_type_label,
      v_author_name || ' (' || coalesce(v_subject_name, 'Member') || ' · PHP '
        || to_char(coalesce(v_amount, 0), 'FM999,999,990.00') || '): "' || v_snippet || '"',
      (case
        when v_type = 'contribution' and v_recipient.target_role = 'MEMBER' then 'user.html'
        else v_page
      end) || '?thread=' || v_type || ':' || p_record_id::text,
      v_group
    );
  end loop;

  return jsonb_build_object(
    'id', v_comment.id,
    'record_type', v_comment.record_type,
    'record_id', v_comment.record_id,
    'author_id', v_comment.author_id,
    'author_name', v_author_name,
    'author_role', v_role::text,
    'author_avatar_url', v_author_avatar,
    'body', v_comment.body,
    'created_at', v_comment.created_at,
    'is_own', true
  );
end;
$$;

revoke execute on function public.get_record_comments(text, uuid) from public, anon;
revoke execute on function public.get_record_comment_counts(text, uuid[]) from public, anon;
revoke execute on function public.add_record_comment(text, uuid, text) from public, anon;

grant execute on function public.get_record_comments(text, uuid) to authenticated;
grant execute on function public.get_record_comment_counts(text, uuid[]) to authenticated;
grant execute on function public.add_record_comment(text, uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_058', 'add in-record discussion comments and review replies')
on conflict (version) do nothing;

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

create table if not exists public.record_comments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  record_type text not null check (record_type in ('contribution', 'withdrawal', 'expense')),
  record_id uuid not null,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists record_comments_lookup_idx
  on public.record_comments (group_id, record_type, record_id, created_at asc);

alter table public.record_comments enable row level security;
alter table public.record_comments force row level security;

drop policy if exists mfa_verified_for_opted_in on public.record_comments;
create policy mfa_verified_for_opted_in on public.record_comments
as restrictive for all to authenticated
using (public.mfa_access_allowed());

drop policy if exists record_comments_select on public.record_comments;
create policy record_comments_select on public.record_comments for select to authenticated
using (
  group_id = public.current_group_id()
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

do $$
begin
  alter publication supabase_realtime add table public.record_comments;
exception when duplicate_object then null;
end $$;

create or replace function public.get_record_comments(
  p_record_type text,
  p_record_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_record jsonb;
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_can_reply boolean := false;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;

  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select
      jsonb_build_object(
        'id', c.id,
        'type', 'contribution',
        'authorName', m.full_name,
        'amount', c.amount,
        'date', c.payment_date,
        'periodMonth', cp.period_month,
        'status', c.approval_status::text,
        'paymentMethod', c.payment_method,
        'reference', c.transaction_reference,
        'notes', coalesce(nullif(c.void_reason, ''), nullif(c.review_note, ''), nullif(c.notes, '')),
        'reviewNote', coalesce(nullif(c.void_reason, ''), nullif(c.review_note, '')),
        'receiptUrl', c.receipt_url
      ),
      c.submitted_by,
      cp.member_id
    into v_record, v_submitted_by, v_target_member_id
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id
      and c.group_id = v_group;
  elsif v_type = 'withdrawal' then
    select
      jsonb_build_object(
        'id', w.id,
        'type', 'withdrawal',
        'authorName', w.person_responsible,
        'amount', w.amount,
        'date', w.transaction_date,
        'category', w.category,
        'status', w.approval_status::text,
        'paymentMethod', w.payment_method,
        'reference', w.reference_number,
        'description', w.description,
        'notes', coalesce(nullif(w.void_reason, ''), nullif(w.review_note, ''), nullif(w.notes, '')),
        'reviewNote', coalesce(nullif(w.void_reason, ''), nullif(w.review_note, '')),
        'receiptUrl', null
      ),
      w.submitted_by,
      w.person_responsible
    into v_record, v_submitted_by, v_person_responsible
    from public.withdrawals w
    where w.id = p_record_id
      and w.group_id = v_group;
  else
    select
      jsonb_build_object(
        'id', e.id,
        'type', 'expense',
        'authorName', e.person_responsible,
        'amount', e.amount,
        'date', e.transaction_date,
        'category', e.category,
        'status', e.approval_status::text,
        'paymentMethod', e.payment_method,
        'reference', e.reference_number,
        'description', e.description,
        'notes', coalesce(nullif(e.void_reason, ''), nullif(e.review_note, ''), nullif(e.notes, '')),
        'reviewNote', coalesce(nullif(e.void_reason, ''), nullif(e.review_note, '')),
        'receiptUrl', e.receipt_url
      ),
      e.submitted_by,
      e.person_responsible
    into v_record, v_submitted_by, v_person_responsible
    from public.expenses e
    where e.id = p_record_id
      and e.group_id = v_group;
  end if;

  if v_record is null then
    raise exception 'Record not found in the active savings group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_can_reply := true;
  else
    if v_member_id is not null then
      select m.full_name into v_my_member_name
      from public.members m
      where m.id = v_member_id and m.group_id = v_group;
    end if;
    if v_type = 'contribution' then
      v_can_reply := (v_submitted_by = auth.uid() or (v_member_id is not null and v_target_member_id = v_member_id));
    else
      v_can_reply := (
        v_submitted_by = auth.uid()
        or (v_my_member_name is not null and lower(btrim(coalesce(v_person_responsible, ''))) = lower(btrim(v_my_member_name)))
      );
    end if;
  end if;

  return jsonb_build_object(
    'record', v_record,
    'can_reply', v_can_reply,
    'comments', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', rc.id,
            'record_type', rc.record_type,
            'record_id', rc.record_id,
            'author_id', rc.author_id,
            'author_name', coalesce(nullif(btrim(p.full_name), ''), 'Group member'),
            'author_role', coalesce(gm.role::text, p.role::text, 'MEMBER'),
            'author_avatar_url', p.avatar_url,
            'body', rc.body,
            'created_at', rc.created_at,
            'is_own', rc.author_id = auth.uid()
          )
          order by rc.created_at asc, rc.id asc
        )
        from public.record_comments rc
        join public.profiles p on p.id = rc.author_id
        left join public.group_memberships gm
          on gm.group_id = v_group
         and gm.user_id = rc.author_id
         and gm.status = 'ACTIVE'
        where rc.group_id = v_group
          and rc.record_type = v_type
          and rc.record_id = p_record_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

create or replace function public.get_record_comment_counts(
  p_record_type text,
  p_record_ids uuid[]
)
returns table (
  record_id uuid,
  comment_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select rc.record_id, count(*)::bigint as comment_count
  from public.record_comments rc
  where rc.group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
    and rc.record_type = lower(btrim(coalesce(p_record_type, '')))
    and rc.record_id = any(coalesce(p_record_ids, '{}'::uuid[]))
  group by rc.record_id;
$$;

create or replace function public.add_record_comment(
  p_record_type text,
  p_record_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_amount numeric(14,2);
  v_subject_name text;
  v_allowed boolean := false;
  v_comment public.record_comments;
  v_author_name text;
  v_author_avatar text;
  v_type_label text;
  v_page text;
  v_snippet text;
  v_recipient record;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;

  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;

  if v_body is null or char_length(v_body) > 1000 then
    raise exception 'Reply must be between 1 and 1000 characters.' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select c.submitted_by, cp.member_id, m.full_name, c.amount
    into v_submitted_by, v_target_member_id, v_subject_name, v_amount
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id
      and c.group_id = v_group;
    v_type_label := 'contribution';
    v_page := 'contributions.html';
  elsif v_type = 'withdrawal' then
    select w.submitted_by, w.person_responsible, w.person_responsible, w.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.withdrawals w
    where w.id = p_record_id
      and w.group_id = v_group;
    v_type_label := 'deduction';
    v_page := 'withdrawals.html';
  else
    select e.submitted_by, e.person_responsible, e.person_responsible, e.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.expenses e
    where e.id = p_record_id
      and e.group_id = v_group;
    v_type_label := 'expense';
    v_page := 'expenses.html';
  end if;

  if not found then
    raise exception 'Record not found in the active savings group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_allowed := true;
  else
    if v_member_id is not null then
      select m.full_name into v_my_member_name
      from public.members m
      where m.id = v_member_id and m.group_id = v_group;
    end if;
    if v_type = 'contribution' then
      v_allowed := (v_submitted_by = auth.uid() or (v_member_id is not null and v_target_member_id = v_member_id));
    else
      v_allowed := (
        v_submitted_by = auth.uid()
        or (v_my_member_name is not null and lower(btrim(coalesce(v_person_responsible, ''))) = lower(btrim(v_my_member_name)))
      );
    end if;
  end if;

  if not v_allowed then
    raise exception 'You can only reply to records associated with your account.' using errcode = '42501';
  end if;

  insert into public.record_comments (group_id, record_type, record_id, author_id, body)
  values (v_group, v_type, p_record_id, auth.uid(), v_body)
  returning * into v_comment;

  select coalesce(nullif(btrim(p.full_name), ''), 'Group member'), p.avatar_url
  into v_author_name, v_author_avatar
  from public.profiles p
  where p.id = auth.uid();

  v_snippet := case
    when char_length(v_body) > 120 then left(v_body, 117) || '...'
    else v_body
  end;

  for v_recipient in
    select distinct
      r.user_id,
      coalesce(gm.role, p.role) as target_role
    from (
      select a.user_id
      from public.group_admin_ids(v_group) a
      union
      select v_submitted_by where v_submitted_by is not null
      union
      select gm_m.user_id
      from public.group_memberships gm_m
      where v_target_member_id is not null
        and gm_m.group_id = v_group
        and gm_m.member_id = v_target_member_id
        and gm_m.status = 'ACTIVE'
      union
      select p_m.id
      from public.profiles p_m
      where v_target_member_id is not null
        and p_m.member_id = v_target_member_id
        and p_m.status = 'ACTIVE'
      union
      select prev.author_id
      from public.record_comments prev
      where prev.group_id = v_group
        and prev.record_type = v_type
        and prev.record_id = p_record_id
    ) r
    join public.profiles p on p.id = r.user_id
    left join public.group_memberships gm
      on gm.group_id = v_group
     and gm.user_id = r.user_id
     and gm.status = 'ACTIVE'
    where r.user_id is not null
      and r.user_id <> auth.uid()
      and p.status = 'ACTIVE'
      and p.notifications_enabled
  loop
    perform public.push_notification(
      v_recipient.user_id,
      'RECORD_COMMENT',
      'New reply on ' || v_type_label,
      v_author_name || ' (' || coalesce(v_subject_name, 'Member') || ' · PHP '
        || to_char(coalesce(v_amount, 0), 'FM999,999,990.00') || '): "' || v_snippet || '"',
      (case
        when v_type = 'contribution' and v_recipient.target_role = 'MEMBER' then 'user.html'
        else v_page
      end) || '?thread=' || v_type || ':' || p_record_id::text,
      v_group
    );
  end loop;

  return jsonb_build_object(
    'id', v_comment.id,
    'record_type', v_comment.record_type,
    'record_id', v_comment.record_id,
    'author_id', v_comment.author_id,
    'author_name', v_author_name,
    'author_role', v_role::text,
    'author_avatar_url', v_author_avatar,
    'body', v_comment.body,
    'created_at', v_comment.created_at,
    'is_own', true
  );
end;
$$;

revoke execute on function public.get_record_comments(text, uuid) from public, anon;
revoke execute on function public.get_record_comment_counts(text, uuid[]) from public, anon;
revoke execute on function public.add_record_comment(text, uuid, text) from public, anon;

grant execute on function public.get_record_comments(text, uuid) to authenticated;
grant execute on function public.get_record_comment_counts(text, uuid[]) to authenticated;
grant execute on function public.add_record_comment(text, uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_058', 'add in-record discussion comments and review replies')
on conflict (version) do nothing;

commit;

-- BOOTSTRAP THE FIRST SUPER ADMIN
-- 1. Create the platform owner in Authentication > Users.
-- 2. Replace the email below, then run only this statement once:
--
-- update public.profiles p
-- set role = 'SUPER_ADMIN', status = 'ACTIVE', group_id = null, member_id = null
-- from auth.users u
-- where p.id = u.id and lower(u.email) = lower('your-email@example.com');
