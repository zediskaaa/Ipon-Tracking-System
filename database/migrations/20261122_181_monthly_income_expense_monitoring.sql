-- Migration 181: Monthly Income & Expense Monitoring (Personal Cash-Flow Tracker)
-- Tracks per-user monthly income sources, configurable mandatory savings (default 20%),
-- categorized monthly expenses, and real-time net monthly income, strictly isolated by user and (year, month).

begin;

-- 1. Normalized tables
create table if not exists public.monthly_monitor_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  monitor_year smallint not null check (monitor_year between 2000 and 2100),
  monitor_month smallint not null check (monitor_month between 1 and 12),
  mandatory_savings_pct numeric(5,2) not null default 20.00
    check (mandatory_savings_pct >= 0 and mandatory_savings_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_monitor_settings_user_ym_uniq unique (user_id, monitor_year, monitor_month)
);

create index if not exists monthly_monitor_settings_user_ym_idx
  on public.monthly_monitor_settings (user_id, monitor_year desc, monitor_month desc);

drop trigger if exists monthly_monitor_settings_updated_at on public.monthly_monitor_settings;
create trigger monthly_monitor_settings_updated_at
  before update on public.monthly_monitor_settings
  for each row execute function public.set_updated_at();

create table if not exists public.monthly_monitor_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  entry_type text not null check (entry_type in ('INCOME', 'EXPENSE')),
  monitor_year smallint not null check (monitor_year between 2000 and 2100),
  monitor_month smallint not null check (monitor_month between 1 and 12),
  category text not null check (char_length(btrim(category)) between 1 and 80),
  description text check (description is null or char_length(btrim(description)) <= 240),
  amount numeric(14,2) not null check (amount > 0 and amount <= 999999999999.99),
  entry_date date not null default ((now() at time zone 'Asia/Manila')::date)
    check (entry_date >= date '2000-01-01' and entry_date <= date '2100-12-31'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monthly_monitor_entries_date_matches_ym_check check (
    extract(year from entry_date)::smallint = monitor_year
    and extract(month from entry_date)::smallint = monitor_month
  )
);

create index if not exists monthly_monitor_entries_user_ym_type_idx
  on public.monthly_monitor_entries (user_id, monitor_year desc, monitor_month desc, entry_type, entry_date desc, created_at desc);

drop trigger if exists monthly_monitor_entries_updated_at on public.monthly_monitor_entries;
create trigger monthly_monitor_entries_updated_at
  before update on public.monthly_monitor_entries
  for each row execute function public.set_updated_at();

-- 2. Strict per-user RLS + MFA enforcement (no cross-user or SUPER_ADMIN access)
alter table public.monthly_monitor_settings enable row level security;
alter table public.monthly_monitor_entries enable row level security;

drop policy if exists mfa_verified_for_opted_in on public.monthly_monitor_settings;
create policy mfa_verified_for_opted_in on public.monthly_monitor_settings
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists monthly_monitor_settings_select on public.monthly_monitor_settings;
create policy monthly_monitor_settings_select on public.monthly_monitor_settings
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists monthly_monitor_settings_insert on public.monthly_monitor_settings;
create policy monthly_monitor_settings_insert on public.monthly_monitor_settings
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists monthly_monitor_settings_update on public.monthly_monitor_settings;
create policy monthly_monitor_settings_update on public.monthly_monitor_settings
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  )
  with check (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists monthly_monitor_settings_delete on public.monthly_monitor_settings;
create policy monthly_monitor_settings_delete on public.monthly_monitor_settings
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists mfa_verified_for_opted_in on public.monthly_monitor_entries;
create policy mfa_verified_for_opted_in on public.monthly_monitor_entries
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists monthly_monitor_entries_select on public.monthly_monitor_entries;
create policy monthly_monitor_entries_select on public.monthly_monitor_entries
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists monthly_monitor_entries_insert on public.monthly_monitor_entries;
create policy monthly_monitor_entries_insert on public.monthly_monitor_entries
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists monthly_monitor_entries_update on public.monthly_monitor_entries;
create policy monthly_monitor_entries_update on public.monthly_monitor_entries
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  )
  with check (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists monthly_monitor_entries_delete on public.monthly_monitor_entries;
create policy monthly_monitor_entries_delete on public.monthly_monitor_entries
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

revoke all on public.monthly_monitor_settings from public, anon;
revoke all on public.monthly_monitor_entries from public, anon;
grant select, insert, update, delete on public.monthly_monitor_settings to authenticated;
grant select, insert, update, delete on public.monthly_monitor_entries to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.monthly_monitor_settings;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.monthly_monitor_entries;
exception when duplicate_object or undefined_object then null;
end $$;

-- 3. RPCs: atomic per-month overview, entry CRUD, and mandatory savings configuration
create or replace function public.get_monthly_monitor(
  p_year integer default null,
  p_month integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_year smallint := coalesce(p_year, extract(year from v_today)::integer)::smallint;
  v_month smallint := coalesce(p_month, extract(month from v_today)::integer)::smallint;
  v_pct numeric(5,2) := 20.00;
  v_is_custom_pct boolean := false;
  v_gross_income numeric(14,2) := 0;
  v_mandatory_savings numeric(14,2) := 0;
  v_available_income numeric(14,2) := 0;
  v_total_expenses numeric(14,2) := 0;
  v_net_income numeric(14,2) := 0;
  v_spent_ratio numeric(6,1) := 0;
  v_income_count integer := 0;
  v_expense_count integer := 0;
  v_incomes jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_trend jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_target_month_start date;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Monthly income and expense monitoring is not available for this account role.' using errcode = '42501';
  end if;
  if v_year < 2000 or v_year > 2100 then
    raise exception 'Year must be between 2000 and 2100.' using errcode = '22023';
  end if;
  if v_month < 1 or v_month > 12 then
    raise exception 'Month must be between 1 and 12.' using errcode = '22023';
  end if;

  v_target_month_start := make_date(v_year::integer, v_month::integer, 1);

  select s.mandatory_savings_pct, true
  into v_pct, v_is_custom_pct
  from public.monthly_monitor_settings s
  where s.user_id = v_uid
    and s.monitor_year = v_year
    and s.monitor_month = v_month;

  if not found then
    v_pct := 20.00;
    v_is_custom_pct := false;
  end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'entry_type', e.entry_type,
        'monitor_year', e.monitor_year,
        'monitor_month', e.monitor_month,
        'category', e.category,
        'description', coalesce(e.description, ''),
        'amount', e.amount,
        'entry_date', e.entry_date,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      )
      order by e.entry_date desc, e.created_at desc
    ), '[]'::jsonb),
    coalesce(round(sum(e.amount), 2), 0)::numeric(14,2),
    count(*)::integer
  into v_incomes, v_gross_income, v_income_count
  from public.monthly_monitor_entries e
  where e.user_id = v_uid
    and e.monitor_year = v_year
    and e.monitor_month = v_month
    and e.entry_type = 'INCOME';

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'entry_type', e.entry_type,
        'monitor_year', e.monitor_year,
        'monitor_month', e.monitor_month,
        'category', e.category,
        'description', coalesce(e.description, ''),
        'amount', e.amount,
        'entry_date', e.entry_date,
        'created_at', e.created_at,
        'updated_at', e.updated_at
      )
      order by e.entry_date desc, e.created_at desc
    ), '[]'::jsonb),
    coalesce(round(sum(e.amount), 2), 0)::numeric(14,2),
    count(*)::integer
  into v_expenses, v_total_expenses, v_expense_count
  from public.monthly_monitor_entries e
  where e.user_id = v_uid
    and e.monitor_year = v_year
    and e.monitor_month = v_month
    and e.entry_type = 'EXPENSE';

  v_mandatory_savings := round((v_gross_income * v_pct) / 100.0, 2);
  v_available_income := round(v_gross_income - v_mandatory_savings, 2);
  v_net_income := round(v_available_income - v_total_expenses, 2);
  v_spent_ratio := case
    when v_available_income > 0 then least(9999.9, round((v_total_expenses / v_available_income) * 100.0, 1))
    when v_total_expenses > 0 then 100.0
    else 0.0
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'category', b.category,
      'total', b.total,
      'count', b.entry_count,
      'share_pct', case when v_total_expenses > 0 then round((b.total / v_total_expenses) * 100.0, 1) else 0.0 end
    )
    order by b.total desc, lower(b.category) asc
  ), '[]'::jsonb)
  into v_breakdown
  from (
    select
      min(btrim(e.category)) as category,
      round(sum(e.amount), 2)::numeric(14,2) as total,
      count(*)::integer as entry_count
    from public.monthly_monitor_entries e
    where e.user_id = v_uid
      and e.monitor_year = v_year
      and e.monitor_month = v_month
      and e.entry_type = 'EXPENSE'
    group by lower(btrim(e.category))
  ) b;

  -- 6-month comparison window ending at selected month
  with months_series as (
    select
      (v_target_month_start - make_interval(months => g.n))::date as month_start
    from generate_series(5, 0, -1) as g(n)
  ),
  per_month as (
    select
      extract(year from ms.month_start)::smallint as yr,
      extract(month from ms.month_start)::smallint as mo,
      coalesce(st.mandatory_savings_pct, 20.00)::numeric(5,2) as pct,
      coalesce(round(sum(e.amount) filter (where e.entry_type = 'INCOME'), 2), 0)::numeric(14,2) as gross_income,
      coalesce(round(sum(e.amount) filter (where e.entry_type = 'EXPENSE'), 2), 0)::numeric(14,2) as total_expenses
    from months_series ms
    left join public.monthly_monitor_settings st
      on st.user_id = v_uid
     and st.monitor_year = extract(year from ms.month_start)::smallint
     and st.monitor_month = extract(month from ms.month_start)::smallint
    left join public.monthly_monitor_entries e
      on e.user_id = v_uid
     and e.monitor_year = extract(year from ms.month_start)::smallint
     and e.monitor_month = extract(month from ms.month_start)::smallint
    group by ms.month_start, st.mandatory_savings_pct
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'year', pm.yr,
      'month', pm.mo,
      'mandatory_savings_pct', pm.pct,
      'gross_income', pm.gross_income,
      'mandatory_savings', round((pm.gross_income * pm.pct) / 100.0, 2),
      'available_income', round(pm.gross_income - round((pm.gross_income * pm.pct) / 100.0, 2), 2),
      'total_expenses', pm.total_expenses,
      'net_income', round(pm.gross_income - round((pm.gross_income * pm.pct) / 100.0, 2) - pm.total_expenses, 2)
    )
    order by pm.yr asc, pm.mo asc
  ), '[]'::jsonb)
  into v_trend
  from per_month pm;

  -- Complete recorded monthly financial history (up to last 24 active months, newest first)
  with recorded_months as (
    select monitor_year as yr, monitor_month as mo
    from public.monthly_monitor_entries
    where user_id = v_uid
    union
    select monitor_year as yr, monitor_month as mo
    from public.monthly_monitor_settings
    where user_id = v_uid
  ),
  history_rows as (
    select
      rm.yr,
      rm.mo,
      coalesce(st.mandatory_savings_pct, 20.00)::numeric(5,2) as pct,
      coalesce(round(sum(e.amount) filter (where e.entry_type = 'INCOME'), 2), 0)::numeric(14,2) as gross_income,
      coalesce(round(sum(e.amount) filter (where e.entry_type = 'EXPENSE'), 2), 0)::numeric(14,2) as total_expenses,
      count(e.id) filter (where e.entry_type = 'INCOME')::integer as income_count,
      count(e.id) filter (where e.entry_type = 'EXPENSE')::integer as expense_count
    from recorded_months rm
    left join public.monthly_monitor_settings st
      on st.user_id = v_uid
     and st.monitor_year = rm.yr
     and st.monitor_month = rm.mo
    left join public.monthly_monitor_entries e
      on e.user_id = v_uid
     and e.monitor_year = rm.yr
     and e.monitor_month = rm.mo
    group by rm.yr, rm.mo, st.mandatory_savings_pct
    order by rm.yr desc, rm.mo desc
    limit 24
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'year', hr.yr,
      'month', hr.mo,
      'mandatory_savings_pct', hr.pct,
      'gross_income', hr.gross_income,
      'mandatory_savings', round((hr.gross_income * hr.pct) / 100.0, 2),
      'available_income', round(hr.gross_income - round((hr.gross_income * hr.pct) / 100.0, 2), 2),
      'total_expenses', hr.total_expenses,
      'net_income', round(hr.gross_income - round((hr.gross_income * hr.pct) / 100.0, 2) - hr.total_expenses, 2),
      'income_count', hr.income_count,
      'expense_count', hr.expense_count
    )
    order by hr.yr desc, hr.mo desc
  ), '[]'::jsonb)
  into v_history
  from history_rows hr;

  return jsonb_build_object(
    'year', v_year,
    'month', v_month,
    'mandatory_savings_pct', v_pct,
    'is_custom_pct', v_is_custom_pct,
    'totals', jsonb_build_object(
      'gross_income', v_gross_income,
      'mandatory_savings', v_mandatory_savings,
      'available_income', v_available_income,
      'total_expenses', v_total_expenses,
      'net_income', v_net_income,
      'income_count', v_income_count,
      'expense_count', v_expense_count,
      'spent_ratio_pct', v_spent_ratio,
      'is_over_budget', (v_net_income < 0)
    ),
    'incomes', v_incomes,
    'expenses', v_expenses,
    'expense_breakdown', v_breakdown,
    'comparison_trend', v_trend,
    'monthly_history', v_history
  );
end;
$$;

create or replace function public.save_monthly_monitor_entry(
  p_entry_id uuid default null,
  p_entry_type text default 'INCOME',
  p_year integer default null,
  p_month integer default null,
  p_category text default '',
  p_description text default null,
  p_amount numeric default 0,
  p_entry_date date default null
)
returns public.monthly_monitor_entries
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.current_user_role();
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_type text := upper(btrim(coalesce(p_entry_type, '')));
  v_year smallint := coalesce(p_year, extract(year from coalesce(p_entry_date, v_today))::integer)::smallint;
  v_month smallint := coalesce(p_month, extract(month from coalesce(p_entry_date, v_today))::integer)::smallint;
  v_category text := btrim(regexp_replace(coalesce(p_category, ''), '\s+', ' ', 'g'));
  v_description text := nullif(btrim(regexp_replace(coalesce(p_description, ''), '\s+', ' ', 'g')), '');
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_date date;
  v_row public.monthly_monitor_entries;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Monthly income and expense monitoring is not available for this account role.' using errcode = '42501';
  end if;
  if v_type not in ('INCOME', 'EXPENSE') then
    raise exception 'Entry type must be INCOME or EXPENSE.' using errcode = '22023';
  end if;
  if v_year < 2000 or v_year > 2100 then
    raise exception 'Year must be between 2000 and 2100.' using errcode = '22023';
  end if;
  if v_month < 1 or v_month > 12 then
    raise exception 'Month must be between 1 and 12.' using errcode = '22023';
  end if;
  if char_length(v_category) < 1 or char_length(v_category) > 80 then
    raise exception 'Category or name must contain between 1 and 80 characters.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_description, '')) > 240 then
    raise exception 'Description must not exceed 240 characters.' using errcode = '22023';
  end if;
  if v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Amount must be greater than 0 and up to 999,999,999,999.99.' using errcode = '22023';
  end if;

  if p_entry_date is not null then
    v_date := p_entry_date;
  elsif extract(year from v_today)::smallint = v_year and extract(month from v_today)::smallint = v_month then
    v_date := v_today;
  else
    v_date := make_date(v_year::integer, v_month::integer, 1);
  end if;

  if extract(year from v_date)::smallint <> v_year or extract(month from v_date)::smallint <> v_month then
    raise exception 'Entry date must fall inside the selected month and year.' using errcode = '22023';
  end if;

  if p_entry_id is null then
    insert into public.monthly_monitor_entries (
      user_id, entry_type, monitor_year, monitor_month, category, description, amount, entry_date
    ) values (
      v_uid, v_type, v_year, v_month, v_category, v_description, v_amount, v_date
    )
    returning * into v_row;
  else
    update public.monthly_monitor_entries
    set category = v_category,
        description = v_description,
        amount = v_amount,
        entry_date = v_date,
        monitor_year = v_year,
        monitor_month = v_month
    where id = p_entry_id
      and user_id = v_uid
      and entry_type = v_type
    returning * into v_row;

    if not found then
      raise exception 'Entry not found in your account.' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_monthly_monitor_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.current_user_role();
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'You are not permitted to delete this record.' using errcode = '42501';
  end if;

  delete from public.monthly_monitor_entries
  where id = p_entry_id
    and user_id = v_uid;

  if not found then
    raise exception 'Entry not found in your account.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.save_monthly_monitor_settings(
  p_year integer,
  p_month integer,
  p_mandatory_savings_pct numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.app_role := public.current_user_role();
  v_year smallint := p_year::smallint;
  v_month smallint := p_month::smallint;
  v_pct numeric(5,2) := round(coalesce(p_mandatory_savings_pct, 20), 2);
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_role is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Monthly income and expense monitoring is not available for this account role.' using errcode = '42501';
  end if;
  if v_year is null or v_year < 2000 or v_year > 2100 then
    raise exception 'Year must be between 2000 and 2100.' using errcode = '22023';
  end if;
  if v_month is null or v_month < 1 or v_month > 12 then
    raise exception 'Month must be between 1 and 12.' using errcode = '22023';
  end if;
  if v_pct < 0 or v_pct > 100 then
    raise exception 'Mandatory savings percentage must be between 0 and 100 percent.' using errcode = '22023';
  end if;

  insert into public.monthly_monitor_settings (user_id, monitor_year, monitor_month, mandatory_savings_pct)
  values (v_uid, v_year, v_month, v_pct)
  on conflict (user_id, monitor_year, monitor_month) do update
  set mandatory_savings_pct = excluded.mandatory_savings_pct;

  return public.get_monthly_monitor(v_year::integer, v_month::integer);
end;
$$;

revoke all on function public.get_monthly_monitor(integer, integer) from public, anon;
grant execute on function public.get_monthly_monitor(integer, integer) to authenticated;
revoke all on function public.save_monthly_monitor_entry(uuid, text, integer, integer, text, text, numeric, date) from public, anon;
grant execute on function public.save_monthly_monitor_entry(uuid, text, integer, integer, text, text, numeric, date) to authenticated;
revoke all on function public.delete_monthly_monitor_entry(uuid) from public, anon;
grant execute on function public.delete_monthly_monitor_entry(uuid) to authenticated;
revoke all on function public.save_monthly_monitor_settings(integer, integer, numeric) from public, anon;
grant execute on function public.save_monthly_monitor_settings(integer, integer, numeric) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_181', 'add monthly income and expense monitoring tables and RPCs')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
