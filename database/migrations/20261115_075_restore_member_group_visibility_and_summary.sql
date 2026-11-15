-- Restore shared group summary RPC and read-only RLS transparency for group members
-- so Member dashboards reflect the exact same group Tracked Savings, additions,
-- member count, monthly collection totals, and calendar entries as group Admins.

begin;

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

revoke execute on function public.get_savings_summary() from public, anon;
grant execute on function public.get_savings_summary() to authenticated;

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
  and deleted_at is null
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

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

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261115_075', 'restore member group savings summary and transparency rls')
on conflict (version) do nothing;

commit;
