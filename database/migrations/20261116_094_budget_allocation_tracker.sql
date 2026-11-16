-- Integrated Budget Allocation & Expense Tracker
-- Non-destructive planning and expense-monitoring layer linked live to existing IPON savings balances.

begin;

-- 1. Normalized tables (100% isolated from real savings ledger tables; strictly scoped per user & workspace)
create table if not exists public.budget_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  needs_pct numeric(5,2) not null default 50.00 check (needs_pct >= 0 and needs_pct <= 100),
  wants_pct numeric(5,2) not null default 30.00 check (wants_pct >= 0 and wants_pct <= 100),
  savings_pct numeric(5,2) not null default 20.00 check (savings_pct >= 0 and savings_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_configs_total_pct_check check (needs_pct + wants_pct + savings_pct = 100.00),
  constraint budget_configs_user_group_uniq unique (user_id, group_id)
);

create index if not exists budget_configs_user_group_idx
  on public.budget_configs (user_id, group_id);

drop trigger if exists budget_configs_updated_at on public.budget_configs;
create trigger budget_configs_updated_at before update on public.budget_configs
  for each row execute function public.set_updated_at();

create table if not exists public.budget_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  category text not null check (category in ('NEEDS', 'WANTS', 'SAVINGS')),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  allocated_amount numeric(14,2) not null default 0 check (allocated_amount >= 0 and allocated_amount <= 999999999999.99),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_items_ownership_uniq unique (id, user_id, group_id)
);

create unique index if not exists budget_items_unique_name_idx
  on public.budget_items (user_id, group_id, category, lower(btrim(name)));

create index if not exists budget_items_user_group_cat_idx
  on public.budget_items (user_id, group_id, category, created_at asc);

drop trigger if exists budget_items_updated_at on public.budget_items;
create trigger budget_items_updated_at before update on public.budget_items
  for each row execute function public.set_updated_at();

create table if not exists public.budget_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  item_id uuid not null,
  amount numeric(14,2) not null check (amount > 0 and amount <= 999999999999.99),
  expense_date date not null default ((now() at time zone 'Asia/Manila')::date)
    check (expense_date >= date '2000-01-01' and expense_date <= date '2100-12-31'),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budget_expenses_item_owner_fk
    foreign key (item_id, user_id, group_id)
    references public.budget_items (id, user_id, group_id)
    on delete cascade
);

create index if not exists budget_expenses_user_group_date_idx
  on public.budget_expenses (user_id, group_id, expense_date desc, created_at desc);

create index if not exists budget_expenses_item_idx
  on public.budget_expenses (item_id);

drop trigger if exists budget_expenses_updated_at on public.budget_expenses;
create trigger budget_expenses_updated_at before update on public.budget_expenses
  for each row execute function public.set_updated_at();

-- 2. Strict per-user RLS + MFA enforcement (no cross-user or SUPER_ADMIN access)
alter table public.budget_configs enable row level security;
alter table public.budget_items enable row level security;
alter table public.budget_expenses enable row level security;

drop policy if exists mfa_verified_for_opted_in on public.budget_configs;
create policy mfa_verified_for_opted_in on public.budget_configs
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists budget_configs_select on public.budget_configs;
create policy budget_configs_select on public.budget_configs
  for select to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_configs_insert on public.budget_configs;
create policy budget_configs_insert on public.budget_configs
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_configs_update on public.budget_configs;
create policy budget_configs_update on public.budget_configs
  for update to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  )
  with check (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_configs_delete on public.budget_configs;
create policy budget_configs_delete on public.budget_configs
  for delete to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists mfa_verified_for_opted_in on public.budget_items;
create policy mfa_verified_for_opted_in on public.budget_items
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists budget_items_select on public.budget_items;
create policy budget_items_select on public.budget_items
  for select to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_items_insert on public.budget_items;
create policy budget_items_insert on public.budget_items
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_items_update on public.budget_items;
create policy budget_items_update on public.budget_items
  for update to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  )
  with check (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_items_delete on public.budget_items;
create policy budget_items_delete on public.budget_items
  for delete to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists mfa_verified_for_opted_in on public.budget_expenses;
create policy mfa_verified_for_opted_in on public.budget_expenses
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists budget_expenses_select on public.budget_expenses;
create policy budget_expenses_select on public.budget_expenses
  for select to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_expenses_insert on public.budget_expenses;
create policy budget_expenses_insert on public.budget_expenses
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_expenses_update on public.budget_expenses;
create policy budget_expenses_update on public.budget_expenses
  for update to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  )
  with check (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop policy if exists budget_expenses_delete on public.budget_expenses;
create policy budget_expenses_delete on public.budget_expenses
  for delete to authenticated
  using (
    user_id = auth.uid()
    and group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

revoke all on public.budget_configs from public, anon;
revoke all on public.budget_items from public, anon;
revoke all on public.budget_expenses from public, anon;
grant select, insert, update, delete on public.budget_configs to authenticated;
grant select, insert, update, delete on public.budget_items to authenticated;
grant select, insert, update, delete on public.budget_expenses to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.budget_configs;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.budget_items;
exception when duplicate_object or undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.budget_expenses;
exception when duplicate_object or undefined_object then null;
end $$;

-- 3. Budget RPCs: automatically connect to existing live IPON savings without modifying ledger balances
create or replace function public.get_budget_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_group public.groups;
  v_summary jsonb;
  v_member_dash jsonb;
  v_raw_balance numeric(14,2) := 0;
  v_ref_balance numeric(14,2) := 0;
  v_balance_source text := 'GROUP_TRACKED';
  v_needs_pct numeric(5,2) := 50.00;
  v_wants_pct numeric(5,2) := 30.00;
  v_savings_pct numeric(5,2) := 20.00;
  v_needs_budget numeric(14,2) := 0;
  v_wants_budget numeric(14,2) := 0;
  v_savings_budget numeric(14,2) := 0;
  v_remainder numeric(14,2) := 0;
  v_config public.budget_configs;
  v_items jsonb := '[]'::jsonb;
  v_expenses jsonb := '[]'::jsonb;
  v_spent_needs numeric(14,2) := 0;
  v_spent_wants numeric(14,2) := 0;
  v_spent_savings numeric(14,2) := 0;
  v_itemized_needs numeric(14,2) := 0;
  v_itemized_wants numeric(14,2) := 0;
  v_itemized_savings numeric(14,2) := 0;
  v_total_spent numeric(14,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_role is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Budget tracking is not available for this account role.' using errcode = '42501';
  end if;

  if v_group_id is null then
    return jsonb_build_object('has_workspace', false);
  end if;

  select * into v_group
  from public.groups
  where id = v_group_id and status = 'ACTIVE';

  if not found then
    return jsonb_build_object('has_workspace', false);
  end if;

  if v_role = 'MEMBER' then
    v_member_dash := public.get_user_dashboard();
    v_raw_balance := round(coalesce((v_member_dash->>'total_contributed')::numeric, 0), 2);
    v_balance_source := 'MEMBER_CONFIRMED';
  else
    v_summary := public.get_savings_summary();
    v_raw_balance := round(coalesce((v_summary->>'tracked_savings')::numeric, 0), 2);
    v_balance_source := case when coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then 'SOLO_TRACKER' else 'GROUP_TRACKED' end;
  end if;

  v_ref_balance := greatest(0.00, v_raw_balance);

  select * into v_config
  from public.budget_configs
  where user_id = auth.uid()
    and group_id = v_group_id;

  if found then
    v_needs_pct := v_config.needs_pct;
    v_wants_pct := v_config.wants_pct;
    v_savings_pct := v_config.savings_pct;
  end if;

  v_needs_budget := round(v_ref_balance * v_needs_pct / 100.0, 2);
  v_wants_budget := round(v_ref_balance * v_wants_pct / 100.0, 2);
  v_savings_budget := round(v_ref_balance * v_savings_pct / 100.0, 2);
  v_remainder := v_ref_balance - (v_needs_budget + v_wants_budget + v_savings_budget);
  if v_remainder <> 0 then
    if v_savings_pct > 0 then
      v_savings_budget := v_savings_budget + v_remainder;
    elsif v_wants_pct > 0 then
      v_wants_budget := v_wants_budget + v_remainder;
    else
      v_needs_budget := v_needs_budget + v_remainder;
    end if;
  end if;

  select coalesce(jsonb_agg(item_row order by item_row.category, item_row.created_at), '[]'::jsonb)
  into v_items
  from (
    select
      bi.id,
      bi.category,
      bi.name,
      bi.allocated_amount,
      coalesce(sum(be.amount), 0)::numeric(14,2) as spent_amount,
      (bi.allocated_amount - coalesce(sum(be.amount), 0))::numeric(14,2) as remaining_amount,
      count(be.id)::integer as expense_count,
      bi.created_at,
      bi.updated_at
    from public.budget_items bi
    left join public.budget_expenses be
      on be.item_id = bi.id
     and be.user_id = bi.user_id
     and be.group_id = bi.group_id
    where bi.user_id = auth.uid()
      and bi.group_id = v_group_id
    group by bi.id
  ) as item_row;

  select coalesce(jsonb_agg(exp_row order by exp_row.expense_date desc, exp_row.created_at desc), '[]'::jsonb)
  into v_expenses
  from (
    select
      be.id,
      be.item_id,
      bi.name as item_name,
      bi.category,
      be.amount,
      be.expense_date,
      be.note,
      be.created_at
    from public.budget_expenses be
    join public.budget_items bi
      on bi.id = be.item_id
     and bi.user_id = be.user_id
     and bi.group_id = be.group_id
    where be.user_id = auth.uid()
      and be.group_id = v_group_id
  ) as exp_row;

  select
    coalesce(sum(bi.allocated_amount) filter (where bi.category = 'NEEDS'), 0),
    coalesce(sum(bi.allocated_amount) filter (where bi.category = 'WANTS'), 0),
    coalesce(sum(bi.allocated_amount) filter (where bi.category = 'SAVINGS'), 0)
  into v_itemized_needs, v_itemized_wants, v_itemized_savings
  from public.budget_items bi
  where bi.user_id = auth.uid()
    and bi.group_id = v_group_id;

  select
    coalesce(sum(be.amount) filter (where bi.category = 'NEEDS'), 0),
    coalesce(sum(be.amount) filter (where bi.category = 'WANTS'), 0),
    coalesce(sum(be.amount) filter (where bi.category = 'SAVINGS'), 0),
    coalesce(sum(be.amount), 0)
  into v_spent_needs, v_spent_wants, v_spent_savings, v_total_spent
  from public.budget_expenses be
  join public.budget_items bi
    on bi.id = be.item_id
   and bi.user_id = be.user_id
   and bi.group_id = be.group_id
  where be.user_id = auth.uid()
    and be.group_id = v_group_id;

  return jsonb_build_object(
    'has_workspace', true,
    'group_id', v_group.id,
    'group_name', v_group.name,
    'workspace_mode', coalesce(v_group.workspace_mode, 'GROUP'),
    'role', v_role,
    'balance_source', v_balance_source,
    'raw_savings_balance', v_raw_balance,
    'reference_balance', v_ref_balance,
    'config', jsonb_build_object(
      'needs_pct', v_needs_pct,
      'wants_pct', v_wants_pct,
      'savings_pct', v_savings_pct,
      'is_custom', v_config.id is not null
    ),
    'categories', jsonb_build_object(
      'NEEDS', jsonb_build_object(
        'pct', v_needs_pct,
        'allocated', v_needs_budget,
        'itemized', v_itemized_needs,
        'spent', v_spent_needs,
        'remaining', (v_needs_budget - v_spent_needs)::numeric(14,2)
      ),
      'WANTS', jsonb_build_object(
        'pct', v_wants_pct,
        'allocated', v_wants_budget,
        'itemized', v_itemized_wants,
        'spent', v_spent_wants,
        'remaining', (v_wants_budget - v_spent_wants)::numeric(14,2)
      ),
      'SAVINGS', jsonb_build_object(
        'pct', v_savings_pct,
        'allocated', v_savings_budget,
        'itemized', v_itemized_savings,
        'spent', v_spent_savings,
        'remaining', (v_savings_budget - v_spent_savings)::numeric(14,2)
      )
    ),
    'totals', jsonb_build_object(
      'allocated', v_ref_balance,
      'itemized', (v_itemized_needs + v_itemized_wants + v_itemized_savings)::numeric(14,2),
      'spent', v_total_spent,
      'remaining', (v_ref_balance - v_total_spent)::numeric(14,2)
    ),
    'items', v_items,
    'expenses', v_expenses
  );
end;
$$;

create or replace function public.save_budget_allocation(
  p_needs_pct numeric,
  p_wants_pct numeric,
  p_savings_pct numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_needs numeric(5,2) := round(coalesce(p_needs_pct, 0), 2);
  v_wants numeric(5,2) := round(coalesce(p_wants_pct, 0), 2);
  v_savings numeric(5,2) := round(coalesce(p_savings_pct, 0), 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_group_id is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Select an active workspace before configuring your budget.' using errcode = '42501';
  end if;
  if v_needs < 0 or v_needs > 100 or v_wants < 0 or v_wants > 100 or v_savings < 0 or v_savings > 100 then
    raise exception 'Each allocation percentage must be between 0 and 100 percent.' using errcode = '22023';
  end if;
  if v_needs + v_wants + v_savings <> 100.00 then
    raise exception 'Allocation percentages must add up to exactly 100 percent.' using errcode = '22023';
  end if;

  insert into public.budget_configs (user_id, group_id, needs_pct, wants_pct, savings_pct)
  values (auth.uid(), v_group_id, v_needs, v_wants, v_savings)
  on conflict (user_id, group_id) do update
  set needs_pct = excluded.needs_pct,
      wants_pct = excluded.wants_pct,
      savings_pct = excluded.savings_pct;

  return public.get_budget_overview();
end;
$$;

create or replace function public.save_budget_item(
  p_item_id uuid default null,
  p_category text default 'NEEDS',
  p_name text default '',
  p_allocated_amount numeric default 0
)
returns public.budget_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_cat text := upper(btrim(coalesce(p_category, '')));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_amount numeric(14,2) := round(coalesce(p_allocated_amount, 0), 2);
  v_row public.budget_items;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_group_id is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Select an active workspace before adding budget items.' using errcode = '42501';
  end if;
  if v_cat not in ('NEEDS', 'WANTS', 'SAVINGS') then
    raise exception 'Category must be NEEDS, WANTS, or SAVINGS.' using errcode = '22023';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 100 then
    raise exception 'Item name must contain between 1 and 100 characters.' using errcode = '22023';
  end if;
  if v_amount < 0 or v_amount > 999999999999.99 then
    raise exception 'Allocated amount must be between 0 and 999,999,999,999.99.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.budget_items bi
    where bi.user_id = auth.uid()
      and bi.group_id = v_group_id
      and bi.category = v_cat
      and lower(btrim(bi.name)) = lower(v_name)
      and (p_item_id is null or bi.id <> p_item_id)
  ) then
    raise exception 'An item named "%" already exists in this category.', v_name using errcode = '23505';
  end if;

  if p_item_id is null then
    insert into public.budget_items (user_id, group_id, category, name, allocated_amount)
    values (auth.uid(), v_group_id, v_cat, v_name, v_amount)
    returning * into v_row;
  else
    update public.budget_items
    set category = v_cat,
        name = v_name,
        allocated_amount = v_amount
    where id = p_item_id
      and user_id = auth.uid()
      and group_id = v_group_id
    returning * into v_row;

    if not found then
      raise exception 'Budget item not found in your account.' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_budget_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_group_id is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'You are not permitted to delete this budget item.' using errcode = '42501';
  end if;

  delete from public.budget_items
  where id = p_item_id
    and user_id = auth.uid()
    and group_id = v_group_id;

  if not found then
    raise exception 'Budget item not found in your account.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.save_budget_expense(
  p_expense_id uuid default null,
  p_item_id uuid default null,
  p_amount numeric default 0,
  p_expense_date date default null,
  p_note text default null
)
returns public.budget_expenses
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_amount numeric(14,2) := round(coalesce(p_amount, 0), 2);
  v_date date := coalesce(p_expense_date, current_date);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_row public.budget_expenses;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_group_id is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Select an active workspace before recording budget expenses.' using errcode = '42501';
  end if;
  if p_item_id is null or not exists (
    select 1
    from public.budget_items bi
    where bi.id = p_item_id
      and bi.user_id = auth.uid()
      and bi.group_id = v_group_id
  ) then
    raise exception 'Selected budget item was not found in your account.' using errcode = 'P0002';
  end if;
  if v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Expense amount must be greater than 0 and up to 999,999,999,999.99.' using errcode = '22023';
  end if;
  if v_date < date '2000-01-01' or v_date > current_date then
    raise exception 'Expense date must be between 2000-01-01 and today.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'Note must not exceed 500 characters.' using errcode = '22023';
  end if;

  if p_expense_id is null then
    insert into public.budget_expenses (user_id, group_id, item_id, amount, expense_date, note)
    values (auth.uid(), v_group_id, p_item_id, v_amount, v_date, v_note)
    returning * into v_row;
  else
    update public.budget_expenses
    set item_id = p_item_id,
        amount = v_amount,
        expense_date = v_date,
        note = v_note
    where id = p_expense_id
      and user_id = auth.uid()
      and group_id = v_group_id
    returning * into v_row;

    if not found then
      raise exception 'Budget expense not found in your account.' using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_budget_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_group_id is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'You are not permitted to delete this expense record.' using errcode = '42501';
  end if;

  delete from public.budget_expenses
  where id = p_expense_id
    and user_id = auth.uid()
    and group_id = v_group_id;

  if not found then
    raise exception 'Budget expense not found in your account.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.get_budget_overview() from public, anon;
grant execute on function public.get_budget_overview() to authenticated;
revoke all on function public.save_budget_allocation(numeric, numeric, numeric) from public, anon;
grant execute on function public.save_budget_allocation(numeric, numeric, numeric) to authenticated;
revoke all on function public.save_budget_item(uuid, text, text, numeric) from public, anon;
grant execute on function public.save_budget_item(uuid, text, text, numeric) to authenticated;
revoke all on function public.delete_budget_item(uuid) from public, anon;
grant execute on function public.delete_budget_item(uuid) to authenticated;
revoke all on function public.save_budget_expense(uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.save_budget_expense(uuid, uuid, numeric, date, text) to authenticated;
revoke all on function public.delete_budget_expense(uuid) from public, anon;
grant execute on function public.delete_budget_expense(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_094', 'add integrated budget allocation and expense tracker linked to live savings')
on conflict (version) do nothing;

commit;
