-- Migration 059: Include payment_method in v_savings_calendar so calendar cells, tooltips, and day details show payment channels.

begin;

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name,
       m.id as subject_member_id,
       public.group_member_avatar(m.id) as subject_avatar_url,
       c.review_note,
       c.payment_method
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
       w.review_note,
       w.payment_method
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url,
       e.review_note,
       e.payment_method
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

insert into public.schema_migrations (version, name)
values ('20261114_059', 'include payment_method in v_savings_calendar')
on conflict (version) do nothing;

commit;

