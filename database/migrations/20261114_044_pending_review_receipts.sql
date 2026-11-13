-- Migration 044: Include receipt_url in get_pending_review_summary for Dashboard quick review
begin;

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
