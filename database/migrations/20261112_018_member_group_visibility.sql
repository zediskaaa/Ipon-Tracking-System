-- Allow active group members to view the shared savings calendar, group records, goals, and reports within their own savings group.

begin;

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

create or replace function public.get_pending_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with entries as (
    select id, amount, payment_date as activity_date, created_at, 'contribution'::text as entry_type from public.contributions where group_id = public.current_group_id() and approval_status = 'PENDING'
    union all select id, amount, transaction_date, created_at, 'withdrawal' from public.withdrawals where group_id = public.current_group_id() and approval_status = 'PENDING'
    union all select id, amount, transaction_date, created_at, 'expense' from public.expenses where group_id = public.current_group_id() and approval_status = 'PENDING'
  ), recent as (select * from entries order by created_at desc limit 3)
  select case when public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER') and public.current_group_id() is not null then jsonb_build_object(
    'count', (select count(*) from entries), 'amount', (select coalesce(sum(amount), 0) from entries),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'date', activity_date, 'type', entry_type) order by created_at desc) from recent), '[]'::jsonb)
  ) else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb) end;
$$;

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
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

insert into public.schema_migrations (version, name)
values ('20261112_018', 'member group calendar and transparency visibility')
on conflict (version) do nothing;

commit;

