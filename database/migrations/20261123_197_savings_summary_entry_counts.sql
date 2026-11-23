begin;

create or replace function public.get_savings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select public.current_user_role() as role_name, public.current_group_id() as group_id
  ),
  grp as (
    select g.id, g.cycle_start_date from public.groups g join ctx on ctx.group_id = g.id
  ),
  archived_cycle as (
    select
      coalesce(sum(a.total_additions), 0) as add_amt,
      coalesce(sum(a.total_deductions), 0) as ded_amt,
      coalesce(sum(a.total_expenses), 0) as exp_amt
    from public.financial_annual_archives a
    join grp on grp.id = a.group_id
    where grp.cycle_start_date is null or make_date(a.archive_year, 12, 31) >= grp.cycle_start_date
  ),
  archived_life as (
    select coalesce(sum(a.net_savings), 0) as net_amt
    from public.financial_annual_archives a
    join grp on grp.id = a.group_id
  ),
  contrib_cycle as (
    select
      coalesce(sum(c.amount), 0) as amt,
      count(*)::integer as cnt
    from public.contributions c
    join grp on c.group_id = grp.id
    where c.approval_status = 'CONFIRMED'
      and (grp.cycle_start_date is null or c.payment_date >= grp.cycle_start_date)
  ),
  withdrawal_cycle as (
    select
      coalesce(sum(w.amount), 0) as amt,
      count(*)::integer as cnt
    from public.withdrawals w
    join grp on w.group_id = grp.id
    where w.approval_status = 'CONFIRMED'
      and (grp.cycle_start_date is null or w.transaction_date >= grp.cycle_start_date)
  ),
  expense_cycle as (
    select
      coalesce(sum(e.amount), 0) as amt,
      count(*)::integer as cnt
    from public.expenses e
    join grp on e.group_id = grp.id
    where e.approval_status = 'CONFIRMED'
      and (grp.cycle_start_date is null or e.transaction_date >= grp.cycle_start_date)
  ),
  cycle_totals as (
    select
      (select amt from contrib_cycle) + (select add_amt from archived_cycle) as total_additions,
      (select amt from withdrawal_cycle) + (select ded_amt from archived_cycle) as total_deductions,
      (select amt from expense_cycle) + (select exp_amt from archived_cycle) as total_expenses,
      (select cnt from contrib_cycle) as additions_count,
      (select cnt from withdrawal_cycle) as deductions_count,
      (select cnt from expense_cycle) as expenses_count,
      ((select add_amt from archived_cycle) > 0) as has_archived_additions,
      ((select ded_amt from archived_cycle) > 0) as has_archived_deductions,
      ((select exp_amt from archived_cycle) > 0) as has_archived_expenses,
      (select coalesce(sum(c.amount), 0) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'CONFIRMED')
        - (select coalesce(sum(w.amount), 0) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'CONFIRMED')
        - (select coalesce(sum(e.amount), 0) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'CONFIRMED')
        + (select net_amt from archived_life) as lifetime_tracked_savings,
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
      'additions_count', ct.additions_count,
      'deductions_count', ct.deductions_count,
      'expenses_count', ct.expenses_count,
      'has_archived_additions', ct.has_archived_additions,
      'has_archived_deductions', ct.has_archived_deductions,
      'has_archived_expenses', ct.has_archived_expenses,
      'tracked_savings', ct.total_additions - ct.total_deductions - ct.total_expenses,
      'lifetime_tracked_savings', ct.lifetime_tracked_savings,
      'cycle_start_date', ct.cycle_start_date,
      'pending_entries', ct.pending_entries
    )
  end
  from ctx, cycle_totals ct;
$$;

revoke all on function public.get_savings_summary() from public, anon;
grant execute on function public.get_savings_summary() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261123_197', 'savings_summary_entry_counts')
on conflict (version) do nothing;

commit;
