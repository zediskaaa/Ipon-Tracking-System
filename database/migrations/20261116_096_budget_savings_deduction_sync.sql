-- Sync Budget Allocation expenses with real IPON savings (public.expenses) so authorized
-- deductions reduce tracked savings live across Dashboard, Expenses, Reports, and Budget.

begin;

-- 1. Extend budget_expenses to store linkage and payment method metadata
alter table public.budget_expenses
  add column if not exists linked_expense_id uuid references public.expenses(id) on delete set null,
  add column if not exists payment_method text not null default 'CASH',
  add column if not exists deduct_from_savings boolean not null default true;

alter table public.budget_expenses
  drop constraint if exists budget_expenses_payment_method_check;

alter table public.budget_expenses
  add constraint budget_expenses_payment_method_check
  check (payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

create index if not exists budget_expenses_linked_expense_idx
  on public.budget_expenses (linked_expense_id)
  where linked_expense_id is not null;

-- 2. Upgrade get_budget_overview() so live remaining savings, allocation pool, and sync states reflect deductions cleanly
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
  v_current_savings numeric(14,2) := 0;
  v_deducted_confirmed numeric(14,2) := 0;
  v_deducted_pending numeric(14,2) := 0;
  v_ref_balance numeric(14,2) := 0;
  v_balance_source text := 'GROUP_TRACKED';
  v_can_deduct boolean := false;
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

  v_can_deduct := v_role in ('ADMIN', 'TREASURER');

  if v_role = 'MEMBER' then
    v_member_dash := public.get_user_dashboard();
    v_raw_balance := round(coalesce((v_member_dash->>'total_contributed')::numeric, 0), 2);
    v_current_savings := greatest(0.00, v_raw_balance);
    v_balance_source := 'MEMBER_CONFIRMED';
    v_ref_balance := v_current_savings;
  else
    v_summary := public.get_savings_summary();
    v_raw_balance := round(coalesce((v_summary->>'tracked_savings')::numeric, 0), 2);
    v_current_savings := greatest(0.00, v_raw_balance);
    v_balance_source := case when coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then 'SOLO_TRACKER' else 'GROUP_TRACKED' end;

    select
      coalesce(sum(e.amount) filter (
        where e.approval_status = 'CONFIRMED'
          and (v_group.cycle_start_date is null or e.transaction_date >= v_group.cycle_start_date)
      ), 0)::numeric(14,2),
      coalesce(sum(e.amount) filter (
        where e.approval_status = 'PENDING'
          and (v_group.cycle_start_date is null or e.transaction_date >= v_group.cycle_start_date)
      ), 0)::numeric(14,2)
    into v_deducted_confirmed, v_deducted_pending
    from public.budget_expenses be
    join public.expenses e
      on e.id = be.linked_expense_id
     and e.group_id = v_group_id
    where be.user_id = auth.uid()
      and be.group_id = v_group_id;

    -- Keep category allocations anchored to the pre-deduction pool so spending from savings
    -- reduces Remaining and Current IPON savings 1:1 instead of double-shrinking budgets.
    v_ref_balance := greatest(0.00, v_raw_balance + v_deducted_confirmed);
  end if;

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
      coalesce(sum(be.amount) filter (
        where be.linked_expense_id is null
           or e.approval_status is null
           or e.approval_status in ('CONFIRMED', 'PENDING')
      ), 0)::numeric(14,2) as spent_amount,
      (bi.allocated_amount - coalesce(sum(be.amount) filter (
        where be.linked_expense_id is null
           or e.approval_status is null
           or e.approval_status in ('CONFIRMED', 'PENDING')
      ), 0))::numeric(14,2) as remaining_amount,
      count(be.id) filter (
        where be.linked_expense_id is null
           or e.approval_status is null
           or e.approval_status in ('CONFIRMED', 'PENDING')
      )::integer as expense_count,
      bi.created_at,
      bi.updated_at
    from public.budget_items bi
    left join public.budget_expenses be
      on be.item_id = bi.id
     and be.user_id = bi.user_id
     and be.group_id = bi.group_id
    left join public.expenses e
      on e.id = be.linked_expense_id
     and e.group_id = bi.group_id
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
      be.payment_method,
      be.deduct_from_savings,
      be.linked_expense_id,
      case
        when be.linked_expense_id is not null and e.id is not null then e.approval_status::text
        when be.deduct_from_savings and be.linked_expense_id is null then 'VOIDED'
        else 'MONITORING'
      end as savings_sync_status,
      be.created_at
    from public.budget_expenses be
    join public.budget_items bi
      on bi.id = be.item_id
     and bi.user_id = be.user_id
     and bi.group_id = be.group_id
    left join public.expenses e
      on e.id = be.linked_expense_id
     and e.group_id = be.group_id
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
    coalesce(sum(be.amount) filter (
      where bi.category = 'NEEDS'
        and (be.linked_expense_id is null or e.approval_status is null or e.approval_status in ('CONFIRMED', 'PENDING'))
    ), 0),
    coalesce(sum(be.amount) filter (
      where bi.category = 'WANTS'
        and (be.linked_expense_id is null or e.approval_status is null or e.approval_status in ('CONFIRMED', 'PENDING'))
    ), 0),
    coalesce(sum(be.amount) filter (
      where bi.category = 'SAVINGS'
        and (be.linked_expense_id is null or e.approval_status is null or e.approval_status in ('CONFIRMED', 'PENDING'))
    ), 0),
    coalesce(sum(be.amount) filter (
      where be.linked_expense_id is null or e.approval_status is null or e.approval_status in ('CONFIRMED', 'PENDING')
    ), 0)
  into v_spent_needs, v_spent_wants, v_spent_savings, v_total_spent
  from public.budget_expenses be
  join public.budget_items bi
    on bi.id = be.item_id
   and bi.user_id = be.user_id
   and bi.group_id = be.group_id
  left join public.expenses e
    on e.id = be.linked_expense_id
   and e.group_id = be.group_id
  where be.user_id = auth.uid()
    and be.group_id = v_group_id;

  return jsonb_build_object(
    'has_workspace', true,
    'group_id', v_group.id,
    'group_name', v_group.name,
    'workspace_mode', coalesce(v_group.workspace_mode, 'GROUP'),
    'role', v_role,
    'can_deduct_savings', v_can_deduct,
    'balance_source', v_balance_source,
    'raw_savings_balance', v_raw_balance,
    'current_savings', v_current_savings,
    'deducted_confirmed', v_deducted_confirmed,
    'deducted_pending', v_deducted_pending,
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

-- 3. Drop old 5-arg signature cleanly before creating the upgraded unified RPC
drop function if exists public.save_budget_expense(uuid, uuid, numeric, date, text);

create or replace function public.save_budget_expense(
  p_expense_id uuid default null,
  p_item_id uuid default null,
  p_amount numeric default 0,
  p_expense_date date default null,
  p_note text default null,
  p_category text default null,
  p_item_name text default null,
  p_deduct_from_savings boolean default true,
  p_payment_method text default 'CASH'
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
  v_method text := coalesce(public.normalized_payment_method(p_payment_method), 'CASH');
  v_item public.budget_items;
  v_cat text := upper(btrim(coalesce(p_category, '')));
  v_item_name text := btrim(regexp_replace(coalesce(p_item_name, ''), '\s+', ' ', 'g'));
  v_existing public.budget_expenses;
  v_old_exp public.expenses;
  v_new_linked_id uuid := null;
  v_deduct boolean;
  v_available numeric(14,2) := 0;
  v_actor_name text;
  v_exp_status public.approval_status;
  v_exp_category text;
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
  if v_amount <= 0 or v_amount > 999999999999.99 then
    raise exception 'Expense amount must be greater than 0 and up to 999,999,999,999.99.' using errcode = '22023';
  end if;
  if v_date < date '2000-01-01' or v_date > current_date then
    raise exception 'Expense date must be between 2000-01-01 and today.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'Note must not exceed 500 characters.' using errcode = '22023';
  end if;

  if p_item_id is not null then
    select * into v_item
    from public.budget_items bi
    where bi.id = p_item_id
      and bi.user_id = auth.uid()
      and bi.group_id = v_group_id;

    if not found then
      raise exception 'Selected budget item was not found in your account.' using errcode = 'P0002';
    end if;
  else
    if v_cat not in ('NEEDS', 'WANTS', 'SAVINGS') then
      raise exception 'Select Needs, Wants, or Savings when adding a new budget item.' using errcode = '22023';
    end if;
    if char_length(v_item_name) < 1 or char_length(v_item_name) > 100 then
      raise exception 'Budget item name must contain between 1 and 100 characters.' using errcode = '22023';
    end if;

    select * into v_item
    from public.budget_items bi
    where bi.user_id = auth.uid()
      and bi.group_id = v_group_id
      and bi.category = v_cat
      and lower(btrim(bi.name)) = lower(v_item_name)
    limit 1;

    if not found then
      insert into public.budget_items (user_id, group_id, category, name, allocated_amount)
      values (auth.uid(), v_group_id, v_cat, v_item_name, 0)
      returning * into v_item;
    end if;
  end if;

  v_deduct := coalesce(p_deduct_from_savings, v_role in ('ADMIN', 'TREASURER'));
  if v_deduct and v_role not in ('ADMIN', 'TREASURER') then
    raise exception 'Only workspace administrators or treasurers can deduct directly from shared savings.' using errcode = '42501';
  end if;

  if p_expense_id is not null then
    select * into v_existing
    from public.budget_expenses
    where id = p_expense_id
      and user_id = auth.uid()
      and group_id = v_group_id;

    if not found then
      raise exception 'Budget expense not found in your account.' using errcode = 'P0002';
    end if;

    if v_existing.linked_expense_id is not null then
      select * into v_old_exp
      from public.expenses
      where id = v_existing.linked_expense_id
        and group_id = v_group_id;
    end if;
  end if;

  if v_old_exp.id is not null and v_old_exp.approval_status = 'CONFIRMED' and v_role <> 'ADMIN' then
    raise exception 'This expense was already confirmed in IPON savings. Ask a group administrator to edit or void it.' using errcode = '42501';
  end if;

  if v_deduct then
    v_available := coalesce((public.get_savings_summary()->>'tracked_savings')::numeric, 0);
    if v_old_exp.id is not null and v_old_exp.approval_status = 'CONFIRMED' then
      v_available := v_available + v_old_exp.amount;
    end if;

    if v_amount > greatest(0.00, v_available) then
      raise exception 'Deduction exceeds current available IPON savings (PHP %). Turn off "Deduct from IPON savings" to log without deducting.',
        to_char(greatest(0.00, v_available), 'FM999,999,990.00')
        using errcode = '22023';
    end if;
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Workspace manager')
  into v_actor_name
  from public.profiles
  where id = auth.uid();

  v_exp_category := 'Budget - ' || initcap(lower(v_item.category));
  v_exp_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  if v_old_exp.id is not null and v_old_exp.approval_status = 'PENDING' then
    if v_deduct then
      update public.expenses
      set transaction_date = v_date,
          amount = v_amount,
          category = v_exp_category,
          description = v_item.name,
          person_responsible = left(v_actor_name, 150),
          notes = v_note,
          payment_method = v_method
      where id = v_old_exp.id and approval_status = 'PENDING';
      v_new_linked_id := v_old_exp.id;
    else
      delete from public.expenses
      where id = v_old_exp.id and approval_status = 'PENDING';
      v_new_linked_id := null;
    end if;
  else
    if v_old_exp.id is not null and v_old_exp.approval_status = 'CONFIRMED' then
      update public.expenses
      set approval_status = 'VOIDED',
          voided_by = auth.uid(),
          voided_at = now(),
          void_reason = case
            when v_deduct then 'Replaced by edited budget expense'
            else 'Switched to monitoring-only in Budget tracker'
          end
      where id = v_old_exp.id and approval_status = 'CONFIRMED';
    end if;

    if v_deduct then
      insert into public.expenses (
        group_id,
        transaction_date,
        amount,
        category,
        description,
        person_responsible,
        notes,
        payment_method,
        approval_status,
        submitted_by,
        reviewed_by,
        reviewed_at
      ) values (
        v_group_id,
        v_date,
        v_amount,
        v_exp_category,
        left(v_item.name, 500),
        left(v_actor_name, 150),
        v_note,
        v_method,
        v_exp_status,
        auth.uid(),
        case when v_exp_status = 'CONFIRMED' then auth.uid() end,
        case when v_exp_status = 'CONFIRMED' then now() end
      ) returning id into v_new_linked_id;
    else
      v_new_linked_id := null;
    end if;
  end if;

  if p_expense_id is null then
    insert into public.budget_expenses (
      user_id, group_id, item_id, amount, expense_date, note,
      payment_method, deduct_from_savings, linked_expense_id
    ) values (
      auth.uid(), v_group_id, v_item.id, v_amount, v_date, v_note,
      v_method, v_deduct, v_new_linked_id
    ) returning * into v_row;
  else
    update public.budget_expenses
    set item_id = v_item.id,
        amount = v_amount,
        expense_date = v_date,
        note = v_note,
        payment_method = v_method,
        deduct_from_savings = v_deduct,
        linked_expense_id = v_new_linked_id
    where id = p_expense_id
      and user_id = auth.uid()
      and group_id = v_group_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- 4. Reconcile linked public.expenses safely when deleting budget expenses or items
create or replace function public.delete_budget_expense(p_expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_existing public.budget_expenses;
  v_linked public.expenses;
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

  select * into v_existing
  from public.budget_expenses
  where id = p_expense_id
    and user_id = auth.uid()
    and group_id = v_group_id;

  if not found then
    raise exception 'Budget expense not found in your account.' using errcode = 'P0002';
  end if;

  if v_existing.linked_expense_id is not null then
    select * into v_linked
    from public.expenses
    where id = v_existing.linked_expense_id
      and group_id = v_group_id;

    if found then
      if v_linked.approval_status = 'CONFIRMED' then
        if v_role <> 'ADMIN' then
          raise exception 'This deduction was already confirmed in IPON savings. Ask a group administrator to void it.' using errcode = '42501';
        end if;
        update public.expenses
        set approval_status = 'VOIDED',
            voided_by = auth.uid(),
            voided_at = now(),
            void_reason = 'Removed from Budget allocation tracker'
        where id = v_linked.id and approval_status = 'CONFIRMED';
      elsif v_linked.approval_status = 'PENDING' then
        delete from public.expenses
        where id = v_linked.id and approval_status = 'PENDING';
      end if;
    end if;
  end if;

  delete from public.budget_expenses
  where id = p_expense_id
    and user_id = auth.uid()
    and group_id = v_group_id;
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
  v_rec record;
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

  if not exists (
    select 1 from public.budget_items bi
    where bi.id = p_item_id
      and bi.user_id = auth.uid()
      and bi.group_id = v_group_id
  ) then
    raise exception 'Budget item not found in your account.' using errcode = 'P0002';
  end if;

  for v_rec in
    select e.id, e.approval_status
    from public.budget_expenses be
    join public.expenses e
      on e.id = be.linked_expense_id
     and e.group_id = v_group_id
    where be.item_id = p_item_id
      and be.user_id = auth.uid()
      and be.group_id = v_group_id
  loop
    if v_rec.approval_status = 'CONFIRMED' then
      if v_role <> 'ADMIN' then
        raise exception 'This item has deductions already confirmed in IPON savings. Ask a group administrator to void them first.' using errcode = '42501';
      end if;
      update public.expenses
      set approval_status = 'VOIDED',
          voided_by = auth.uid(),
          voided_at = now(),
          void_reason = 'Budget item removed from tracker'
      where id = v_rec.id and approval_status = 'CONFIRMED';
    elsif v_rec.approval_status = 'PENDING' then
      delete from public.expenses
      where id = v_rec.id and approval_status = 'PENDING';
    end if;
  end loop;

  delete from public.budget_items
  where id = p_item_id
    and user_id = auth.uid()
    and group_id = v_group_id;
end;
$$;

revoke all on function public.get_budget_overview() from public, anon;
grant execute on function public.get_budget_overview() to authenticated;
revoke all on function public.save_budget_expense(uuid, uuid, numeric, date, text, text, text, boolean, text) from public, anon;
grant execute on function public.save_budget_expense(uuid, uuid, numeric, date, text, text, text, boolean, text) to authenticated;
revoke all on function public.delete_budget_expense(uuid) from public, anon;
grant execute on function public.delete_budget_expense(uuid) to authenticated;
revoke all on function public.delete_budget_item(uuid) from public, anon;
grant execute on function public.delete_budget_item(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_096', 'sync budget expenses with real ipon savings deductions and support inline item creation')
on conflict (version) do nothing;

commit;
