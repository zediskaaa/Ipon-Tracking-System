-- 028: Include review/void reasons in submitter notifications and expose review_note on v_savings_calendar

begin;

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
values ('20261112_028', 'include review reason in notifications and calendar')
on conflict (version) do nothing;

commit;
