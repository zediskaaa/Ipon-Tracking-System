-- IPON Tracking System - Supabase PostgreSQL schema
-- Run this entire file in the Supabase SQL Editor on a new project.

begin;

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('ADMIN', 'TREASURER', 'MEMBER');
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
  role public.app_role not null default 'MEMBER',
  status public.account_status not null default 'PENDING',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 150),
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
  constraint members_deactivation_consistent check (
    (status = 'ACTIVE' and deactivated_at is null)
    or (status = 'INACTIVE' and deactivated_at is not null)
  )
);

alter table public.profiles
  add column if not exists member_id uuid unique references public.members(id) on delete set null;

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

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'ADMIN', false);
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_first boolean;
begin
  select not exists (select 1 from public.profiles) into v_is_first;

  insert into public.profiles (id, full_name, role, status)
  values (
    new.id,
    case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2
        then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end,
    case when v_is_first then 'ADMIN'::public.app_role else 'MEMBER'::public.app_role end,
    case when v_is_first then 'ACTIVE'::public.account_status else 'PENDING'::public.account_status end
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
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_record_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);

  if tg_op = 'UPDATE' and v_old ->> 'approval_status' is distinct from v_new ->> 'approval_status' then
    v_action := case v_new ->> 'approval_status'
      when 'CONFIRMED' then 'CONFIRM'
      when 'REJECTED' then 'REJECT'
      when 'VOIDED' then 'VOID'
      else 'UPDATE'
    end;
  end if;

  insert into public.audit_logs (table_name, record_id, action, old_data, new_data, changed_by)
  values (tg_table_name, v_record_id, v_action, v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
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
    execute format('drop trigger if exists %I_audit on public.%I', table_name, table_name);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.write_audit_log()',
      table_name,
      table_name
    );
  end loop;
end $$;

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
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change user access.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() and p_status <> 'ACTIVE' then
    raise exception 'You cannot disable or set your own administrator account to pending.' using errcode = '22023';
  end if;

  if (p_role <> 'ADMIN' or p_status <> 'ACTIVE')
     and exists (select 1 from public.profiles where id = p_user_id and role = 'ADMIN' and status = 'ACTIVE')
     and not exists (select 1 from public.profiles where id <> p_user_id and role = 'ADMIN' and status = 'ACTIVE') then
    raise exception 'Bawal ibaba ang Admin role hangga''t walang kapalit na Admin mula sa mga members.' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role, status = p_status, member_id = p_member_id
  where id = p_user_id;

  if not found then
    raise exception 'User profile not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.create_member(
  p_full_name text,
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
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can create members.' using errcode = '42501';
  end if;

  insert into public.members (
    full_name, contact_number, date_registered, monthly_contribution_amount,
    notes, created_by, updated_by
  ) values (
    btrim(p_full_name), nullif(btrim(p_contact_number), ''), p_date_registered,
    p_monthly_contribution_amount, nullif(btrim(p_notes), ''), auth.uid(), auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_member(
  p_member_id uuid,
  p_full_name text,
  p_contact_number text,
  p_monthly_contribution_amount numeric,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can update members.' using errcode = '42501';
  end if;

  update public.members
  set full_name = btrim(p_full_name),
      contact_number = nullif(btrim(p_contact_number), ''),
      monthly_contribution_amount = p_monthly_contribution_amount,
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
  v_month date := date_trunc('month', p_effective_month)::date;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change contribution settings.' using errcode = '42501';
  end if;

  insert into public.contribution_settings (effective_month, default_amount, created_by)
  values (v_month, p_default_amount, auth.uid())
  on conflict (effective_month) do update set
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
  if not public.is_treasurer_or_admin() then
    raise exception 'You are not allowed to generate contribution periods.' using errcode = '42501';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount)
  select id, v_month, monthly_contribution_amount
  from public.members
  where status = 'ACTIVE'
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
    v_period_id, p_amount, p_payment_date,
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
  if v_entry.approval_status in ('REJECTED', 'VOIDED') then
    raise exception 'Rejected or voided entries cannot be edited.' using errcode = '22023';
  end if;
  if v_role <> 'ADMIN' and not (
    v_entry.approval_status = 'PENDING'
    and (v_entry.submitted_by = auth.uid() or v_role = 'TREASURER')
  ) then
    raise exception 'You are not allowed to edit this entry.' using errcode = '42501';
  end if;

  update public.contributions
  set amount = p_amount,
      payment_date = p_payment_date,
      transaction_reference = nullif(btrim(p_transaction_reference), ''),
      notes = nullif(btrim(p_notes), '')
  where id = p_contribution_id;
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
    p_transaction_date, p_amount, btrim(p_category), btrim(p_description),
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
  if v_entry.approval_status in ('REJECTED', 'VOIDED') then raise exception 'Rejected or voided entries cannot be edited.' using errcode = '22023'; end if;
  if v_role <> 'ADMIN' and not (v_entry.approval_status = 'PENDING' and (v_entry.submitted_by = auth.uid() or v_role = 'TREASURER')) then
    raise exception 'You are not allowed to edit this entry.' using errcode = '42501';
  end if;

  update public.withdrawals set
    transaction_date = p_transaction_date, amount = p_amount, category = btrim(p_category),
    description = btrim(p_description), person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''), notes = nullif(btrim(p_notes), '')
  where id = p_withdrawal_id;
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
    p_transaction_date, p_amount, btrim(p_category), btrim(p_description),
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
  if v_entry.approval_status in ('REJECTED', 'VOIDED') then raise exception 'Rejected or voided entries cannot be edited.' using errcode = '22023'; end if;
  if v_role <> 'ADMIN' and not (v_role = 'TREASURER' and v_entry.approval_status = 'PENDING') then
    raise exception 'You are not allowed to edit this expense.' using errcode = '42501';
  end if;

  update public.expenses set
    transaction_date = p_transaction_date, amount = p_amount, category = btrim(p_category),
    description = btrim(p_description), person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''), notes = nullif(btrim(p_notes), '')
  where id = p_expense_id;
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
    values (btrim(p_title), p_target_amount, p_target_date, p_status, nullif(btrim(p_notes), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.savings_goals set
      title = btrim(p_title), target_amount = p_target_amount, target_date = p_target_date,
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
from public.expenses e;
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
  select case when public.current_user_role() is null then null else jsonb_build_object(
    'total_additions', (select coalesce(sum(amount), 0) from public.contributions where approval_status = 'CONFIRMED'),
    'total_deductions', (select coalesce(sum(amount), 0) from public.withdrawals where approval_status = 'CONFIRMED'),
    'total_expenses', (select coalesce(sum(amount), 0) from public.expenses where approval_status = 'CONFIRMED'),
    'tracked_savings',
      (select coalesce(sum(amount), 0) from public.contributions where approval_status = 'CONFIRMED')
      - (select coalesce(sum(amount), 0) from public.withdrawals where approval_status = 'CONFIRMED')
      - (select coalesce(sum(amount), 0) from public.expenses where approval_status = 'CONFIRMED'),
    'pending_entries',
      (select count(*) from public.contributions where approval_status = 'PENDING')
      + (select count(*) from public.withdrawals where approval_status = 'PENDING')
      + (select count(*) from public.expenses where approval_status = 'PENDING')
  ) end;
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

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (public.is_treasurer_or_admin() or id = public.current_member_id());

drop policy if exists contribution_settings_select on public.contribution_settings;
create policy contribution_settings_select on public.contribution_settings for select to authenticated
using (public.current_user_role() is not null);

drop policy if exists contribution_periods_select on public.contribution_periods;
create policy contribution_periods_select on public.contribution_periods for select to authenticated
using (public.is_treasurer_or_admin() or member_id = public.current_member_id());

drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions for select to authenticated
using (
  public.is_treasurer_or_admin()
  or exists (
    select 1 from public.contribution_periods cp
    where cp.id = contribution_period_id and cp.member_id = public.current_member_id()
  )
);

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
using (public.is_treasurer_or_admin());

drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals for select to authenticated
using (public.is_treasurer_or_admin() or submitted_by = auth.uid());

drop policy if exists savings_goals_select on public.savings_goals;
create policy savings_goals_select on public.savings_goals for select to authenticated
using (public.current_user_role() is not null);

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (public.is_admin());

revoke all on all tables in schema public from anon;
revoke create on schema public from public;
revoke all on public.profiles, public.members, public.contribution_settings,
  public.contribution_periods, public.contributions, public.expenses,
  public.withdrawals, public.savings_goals, public.audit_logs from authenticated;

grant select on public.profiles, public.members, public.contribution_settings,
  public.contribution_periods, public.contributions, public.expenses,
  public.withdrawals, public.savings_goals, public.audit_logs to authenticated;
grant select on public.v_contribution_status, public.v_savings_calendar,
  public.v_monthly_financial_summary to authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.current_member_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_treasurer_or_admin() to authenticated;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;
grant execute on function public.create_member(text, text, date, numeric, text) to authenticated;
grant execute on function public.update_member(uuid, text, text, numeric, text) to authenticated;
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
    if p_member_id is not null and not exists (select 1 from public.members where id = p_member_id and group_id = v_actor_group) then raise exception 'The selected member does not belong to your savings group.' using errcode = '42501'; end if;
    update public.profiles set role = p_role, status = p_status, member_id = case when p_role = 'MEMBER' then p_member_id end, group_id = v_actor_group
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
  select m.id, v_month, m.monthly_contribution_amount, make_date(extract(year from v_month)::integer, extract(month from v_month)::integer, coalesce(s.deadline_day, 28))
  from public.members m
  left join lateral (select cs.deadline_day from public.contribution_settings cs where cs.group_id = m.group_id and cs.effective_month <= v_month order by cs.effective_month desc limit 1) s on true
  where m.status = 'ACTIVE' and m.date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_pending_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with entries as (
    select id, amount, payment_date as activity_date, created_at, 'contribution'::text as entry_type from public.contributions where group_id = public.current_group_id() and approval_status = 'PENDING'
    union all select id, amount, transaction_date, created_at, 'withdrawal' from public.withdrawals where group_id = public.current_group_id() and approval_status = 'PENDING'
    union all select id, amount, transaction_date, created_at, 'expense' from public.expenses where group_id = public.current_group_id() and approval_status = 'PENDING'
  ), recent as (select * from entries order by created_at desc limit 3)
  select case when public.current_user_role() in ('ADMIN', 'TREASURER') then jsonb_build_object(
    'count', (select count(*) from entries), 'amount', (select coalesce(sum(amount), 0) from entries),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'date', activity_date, 'type', entry_type) order by created_at desc) from recent), '[]'::jsonb)
  ) else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb) end;
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
values
  ('20261112_014', 'enforce opt-in multi-factor authentication'),
  ('20261112_015', 'require mobile number on profile updates'),
  ('20261112_016', 'add feature requests')
on conflict (version) do nothing;

commit;

-- BOOTSTRAP THE FIRST SUPER ADMIN
-- 1. Create the platform owner in Authentication > Users.
-- 2. Replace the email below, then run only this statement once:
--
-- update public.profiles p
-- set role = 'ADMIN', status = 'ACTIVE'
-- from auth.users u
-- where p.id = u.id and lower(u.email) = lower('your-email@example.com');
