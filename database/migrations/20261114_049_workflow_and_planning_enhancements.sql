-- Migration 20261114_049: Workflow, planning, exemption, carryover, cycle archive, and storage hygiene enhancements.
begin;

-- 1. Savings cycle start date on groups
alter table public.groups
  add column if not exists cycle_start_date date;

create or replace function public.set_group_cycle_start(
  p_cycle_start_date date default null
)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_month date := case when p_cycle_start_date is null then null else date_trunc('month', p_cycle_start_date)::date end;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update the savings cycle.' using errcode = '42501';
  end if;
  if v_month is not null and (v_month < date '2000-01-01' or v_month > date '2100-12-01') then
    raise exception 'Cycle start month must be between January 2000 and December 2100.' using errcode = '22023';
  end if;

  update public.groups
  set cycle_start_date = v_month
  where id = v_group_id;

  return v_month;
end;
$$;

revoke execute on function public.set_group_cycle_start(date) from public, anon;
grant execute on function public.set_group_cycle_start(date) to authenticated;

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

-- 2. Period exemptions
alter table public.contribution_periods
  add column if not exists is_exempt boolean not null default false,
  add column if not exists exempt_reason text;

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
  case
    when cp.is_exempt then 0::numeric(14,2)
    else greatest(cp.required_amount - coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0), 0)::numeric(14,2)
  end as outstanding_amount,
  greatest(coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) - cp.required_amount, 0)::numeric(14,2) as overpaid_amount,
  case
    when cp.is_exempt then 'EXEMPT'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = 0 then 'UNPAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) < cp.required_amount then 'PARTIALLY PAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = cp.required_amount then 'PAID'
    else 'OVERPAID'
  end as payment_status,
  cp.is_exempt,
  cp.exempt_reason
from public.contribution_periods cp
join public.members m on m.id = cp.member_id
left join public.contributions c on c.contribution_period_id = cp.id
where m.deleted_at is null
  and (m.status = 'ACTIVE' or c.id is not null)
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount, cp.is_exempt, cp.exempt_reason;

create or replace function public.set_period_exemption(
  p_member_id uuid,
  p_period_month date,
  p_exempt boolean default true,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_period_month)::date;
  v_required numeric(14,2);
  v_reason text := case when coalesce(p_exempt, true) then nullif(btrim(coalesce(p_reason, '')), '') else null end;
  v_user_id uuid;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can change period exemptions.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date '2100-12-01' then
    raise exception 'Invalid contribution month.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 300 then
    raise exception 'Exemption reason must not exceed 300 characters.' using errcode = '22023';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and deleted_at is null;

  if v_required is null then
    raise exception 'Member not found in the active group.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date, is_exempt, exempt_reason)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month),
    coalesce(p_exempt, true),
    v_reason
  )
  on conflict (member_id, period_month) do update
    set is_exempt = excluded.is_exempt,
        exempt_reason = excluded.exempt_reason;

  select u.id into v_user_id
  from (
    select gm.user_id as id from public.group_memberships gm where gm.group_id = v_group_id and gm.member_id = p_member_id and gm.status = 'ACTIVE'
    union
    select p.id from public.profiles p where p.group_id = v_group_id and p.member_id = p_member_id and p.status = 'ACTIVE'
  ) u
  join public.profiles p on p.id = u.id
  where p.notifications_enabled
  limit 1;

  if v_user_id is not null then
    perform public.push_notification(
      v_user_id,
      'PERIOD_EXEMPTION',
      case when coalesce(p_exempt, true) then 'Contribution period marked exempt' else 'Contribution exemption removed' end,
      to_char(v_month, 'FMMonth YYYY') || case
        when coalesce(p_exempt, true) then ' has been marked exempt' || coalesce(': ' || v_reason, '.')
        else ' is active again for regular contribution tracking.'
      end,
      'user.html',
      v_group_id
    );
  end if;
end;
$$;

revoke execute on function public.set_period_exemption(uuid, date, boolean, text) from public, anon;
grant execute on function public.set_period_exemption(uuid, date, boolean, text) to authenticated;

-- 3. Advance / excess contribution carry-over
create or replace function public.record_contribution_with_carryover(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_allocate_excess boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_contribution_month)::date;
  v_amount numeric(14,2) := public.validated_money(p_amount, 'Contribution amount');
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_required numeric(14,2);
  v_status public.approval_status;
  v_remaining numeric(14,2);
  v_cursor_month date;
  v_period record;
  v_covered numeric(14,2);
  v_needed numeric(14,2);
  v_slice numeric(14,2);
  v_first_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_i integer := 0;
  v_use_receipt text;
  v_slice_notes text;
  v_slice_key uuid;
begin
  if not coalesce(p_allocate_excess, false) then
    v_id := public.record_contribution(
      p_member_id,
      p_contribution_month,
      v_amount,
      p_payment_date,
      p_transaction_reference,
      p_notes,
      p_idempotency_key,
      p_receipt_url
    );
    return jsonb_build_object('ids', array[v_id], 'months_covered', 1);
  end if;

  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select id into v_first_id
  from public.contributions
  where idempotency_key = p_idempotency_key;

  if v_first_id is not null then
    return jsonb_build_object('ids', array[v_first_id], 'months_covered', 1);
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;
  v_remaining := v_amount;
  v_cursor_month := v_month;

  while v_remaining > 0 and v_i < 24 loop
    insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
    values (
      p_member_id,
      v_cursor_month,
      v_required,
      public.contribution_period_due_date(v_group_id, v_cursor_month)
    )
    on conflict (member_id, period_month) do nothing;

    select id, required_amount, is_exempt into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_cursor_month;

    if not coalesce(v_period.is_exempt, false) then
      select coalesce(sum(amount) filter (where approval_status in ('CONFIRMED', 'PENDING')), 0)::numeric(14,2)
      into v_covered
      from public.contributions
      where contribution_period_id = v_period.id;

      v_needed := greatest(v_period.required_amount - coalesce(v_covered, 0), 0);
      if v_needed > 0 then
        v_slice := least(v_remaining, v_needed);
        v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
        v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;
        v_slice_notes := case
          when coalesce(array_length(v_ids, 1), 0) = 0 then v_notes
          else left(trim(both ' ' from concat_ws(' · ', 'Advance carry-over from ' || to_char(v_month, 'Mon YYYY'), v_notes)), 1000)
        end;

        insert into public.contributions (
          contribution_period_id, amount, payment_date, transaction_reference,
          idempotency_key, notes, receipt_url, approval_status, submitted_by,
          reviewed_by, reviewed_at
        ) values (
          v_period.id, v_slice, p_payment_date,
          nullif(btrim(p_transaction_reference), ''), v_slice_key,
          v_slice_notes, v_use_receipt, v_status, auth.uid(),
          case when v_status = 'CONFIRMED' then auth.uid() end,
          case when v_status = 'CONFIRMED' then now() end
        ) returning id into v_id;

        v_ids := array_append(v_ids, v_id);
        v_remaining := v_remaining - v_slice;
      end if;
    end if;

    v_cursor_month := (v_cursor_month + interval '1 month')::date;
    v_i := v_i + 1;
  end loop;

  if v_remaining > 0 then
    select id into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_month;

    v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
    v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;

    insert into public.contributions (
      contribution_period_id, amount, payment_date, transaction_reference,
      idempotency_key, notes, receipt_url, approval_status, submitted_by,
      reviewed_by, reviewed_at
    ) values (
      v_period.id, v_remaining, p_payment_date,
      nullif(btrim(p_transaction_reference), ''), v_slice_key,
      left(trim(both ' ' from concat_ws(' · ', v_notes, 'Excess beyond 24 months')), 1000),
      v_use_receipt, v_status, auth.uid(),
      case when v_status = 'CONFIRMED' then auth.uid() end,
      case when v_status = 'CONFIRMED' then now() end
    ) returning id into v_id;

    v_ids := array_append(v_ids, v_id);
  end if;

  return jsonb_build_object('ids', v_ids, 'months_covered', coalesce(array_length(v_ids, 1), 0));
end;
$$;

revoke execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean) from public, anon;
grant execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean) to authenticated;

-- 4. Bulk confirm pending contributions
create or replace function public.bulk_confirm_contributions(
  p_contribution_ids uuid[],
  p_review_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_count integer := 0;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can confirm pending contributions.' using errcode = '42501';
  end if;
  if p_contribution_ids is null or coalesce(array_length(p_contribution_ids, 1), 0) = 0 then
    raise exception 'Select at least one pending contribution to confirm.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'Review note must not exceed 500 characters.' using errcode = '22023';
  end if;

  update public.contributions
  set approval_status = 'CONFIRMED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = v_note
  where id = any(p_contribution_ids)
    and group_id = v_group_id
    and approval_status = 'PENDING';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.bulk_confirm_contributions(uuid[], text) from public, anon;
grant execute on function public.bulk_confirm_contributions(uuid[], text) to authenticated;

-- 5. Batch remind unpaid members
create or replace function public.remind_unpaid_members(
  p_period_month date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', coalesce(p_period_month, current_date))::date;
  v_row record;
  v_user_id uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
  v_unlinked integer := 0;
  v_unpaid_total integer := 0;
begin
  if v_role not in ('ADMIN', 'TREASURER') or v_group_id is null then
    raise exception 'Only an administrator or treasurer can send payment reminders.' using errcode = '42501';
  end if;

  for v_row in
    select vcs.member_id, vcs.member_name, vcs.outstanding_amount, cp.due_date
    from public.v_contribution_status vcs
    join public.contribution_periods cp on cp.id = vcs.contribution_period_id
    where cp.group_id = v_group_id
      and vcs.period_month = v_month
      and vcs.payment_status in ('UNPAID', 'PARTIALLY PAID')
      and vcs.outstanding_amount > 0
  loop
    v_unpaid_total := v_unpaid_total + 1;

    select u.id into v_user_id
    from (
      select gm.user_id as id from public.group_memberships gm where gm.group_id = v_group_id and gm.member_id = v_row.member_id and gm.status = 'ACTIVE'
      union
      select p.id from public.profiles p where p.group_id = v_group_id and p.member_id = v_row.member_id and p.status = 'ACTIVE'
    ) u
    join public.profiles p on p.id = u.id
    where p.notifications_enabled
    limit 1;

    if v_user_id is null then
      v_unlinked := v_unlinked + 1;
    elsif exists (
      select 1 from public.notifications n
      where n.recipient_id = v_user_id
        and n.group_id = v_group_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.created_at > now() - interval '6 hours'
        and n.message like '%' || to_char(v_month, 'FMMonth YYYY') || '%'
    ) then
      v_skipped := v_skipped + 1;
    else
      perform public.push_notification(
        v_user_id,
        'CONTRIBUTION_REMINDER',
        'Contribution reminder for ' || to_char(v_month, 'FMMonth YYYY'),
        'Outstanding balance: PHP ' || to_char(v_row.outstanding_amount, 'FM999,999,990.00') || '. Due ' || to_char(v_row.due_date, 'Mon DD, YYYY') || '.',
        'user.html',
        v_group_id
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'sent', v_sent,
    'skipped_recent', v_skipped,
    'unlinked', v_unlinked,
    'unpaid_total', v_unpaid_total
  );
end;
$$;

revoke execute on function public.remind_unpaid_members(date) from public, anon;
grant execute on function public.remind_unpaid_members(date) to authenticated;

-- 6. Member payment & on-time streak inside get_user_dashboard()
create or replace function public.get_user_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_member_id uuid := public.current_member_id();
  v_current_month date := date_trunc('month', current_date)::date;
  v_rec record;
  v_payment_streak integer := 0;
  v_on_time_streak integer := 0;
  v_break_paid boolean := false;
  v_break_on_time boolean := false;
begin
  if v_member_id is null then
    return null;
  end if;

  for v_rec in
    select
      cp.period_month,
      cp.due_date,
      cp.is_exempt,
      cp.required_amount,
      coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as paid_amount,
      min(c.payment_date) filter (where c.approval_status = 'CONFIRMED') as first_paid_date
    from public.contribution_periods cp
    left join public.contributions c on c.contribution_period_id = cp.id
    where cp.member_id = v_member_id
      and cp.period_month <= v_current_month
    group by cp.id, cp.period_month, cp.due_date, cp.is_exempt, cp.required_amount
    order by cp.period_month desc
  loop
    -- Do not break an existing streak for an open current period not yet past due.
    if v_rec.period_month = v_current_month and v_rec.paid_amount < v_rec.required_amount and not v_rec.is_exempt and current_date <= v_rec.due_date then
      continue;
    end if;

    if not v_break_paid then
      if v_rec.is_exempt or v_rec.paid_amount >= v_rec.required_amount then
        v_payment_streak := v_payment_streak + 1;
      else
        v_break_paid := true;
      end if;
    end if;

    if not v_break_on_time then
      if v_rec.is_exempt or (v_rec.paid_amount >= v_rec.required_amount and v_rec.first_paid_date is not null and v_rec.first_paid_date <= v_rec.due_date) then
        v_on_time_streak := v_on_time_streak + 1;
      else
        v_break_on_time := true;
      end if;
    end if;

    exit when v_break_paid and v_break_on_time;
  end loop;

  return jsonb_build_object(
    'total_contributed', (select coalesce(sum(c.amount), 0) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'CONFIRMED'),
    'months_paid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('PAID', 'OVERPAID')),
    'months_unpaid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('UNPAID', 'PARTIALLY PAID') and period_month <= v_current_month),
    'pending_submissions', (select count(*) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'PENDING'),
    'payment_streak', v_payment_streak,
    'on_time_streak', v_on_time_streak,
    'current_period', (select to_jsonb(x) from (select vcs.period_month, vcs.required_amount, vcs.paid_amount, vcs.outstanding_amount, vcs.payment_status, cp.due_date, cp.is_exempt, cp.exempt_reason from public.v_contribution_status vcs join public.contribution_periods cp on cp.id = vcs.contribution_period_id where vcs.member_id = v_member_id and vcs.period_month = v_current_month) x)
  );
end;
$$;

-- 7. Cloud-synced goal calculator plans
create table if not exists public.savings_calculator_plans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 150),
  target_amount numeric(14,2) not null check (target_amount > 0),
  current_amount numeric(14,2) not null default 0 check (current_amount >= 0),
  target_date date,
  split_members integer not null default 1 check (split_members between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists savings_calculator_plans_group_user_idx
  on public.savings_calculator_plans (group_id, user_id, updated_at desc);

drop trigger if exists savings_calculator_plans_updated_at on public.savings_calculator_plans;
create trigger savings_calculator_plans_updated_at before update on public.savings_calculator_plans
  for each row execute function public.set_updated_at();

alter table public.savings_calculator_plans enable row level security;

drop policy if exists mfa_verified_for_opted_in on public.savings_calculator_plans;
create policy mfa_verified_for_opted_in on public.savings_calculator_plans
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists savings_calculator_plans_select on public.savings_calculator_plans;
create policy savings_calculator_plans_select on public.savings_calculator_plans
  for select to authenticated
  using (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

drop policy if exists savings_calculator_plans_insert on public.savings_calculator_plans;
create policy savings_calculator_plans_insert on public.savings_calculator_plans
  for insert to authenticated
  with check (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

drop policy if exists savings_calculator_plans_update on public.savings_calculator_plans;
create policy savings_calculator_plans_update on public.savings_calculator_plans
  for update to authenticated
  using (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'))
  with check (group_id = public.current_group_id() and user_id = auth.uid());

drop policy if exists savings_calculator_plans_delete on public.savings_calculator_plans;
create policy savings_calculator_plans_delete on public.savings_calculator_plans
  for delete to authenticated
  using (group_id = public.current_group_id() and user_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

grant select, insert, update, delete on public.savings_calculator_plans to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.savings_calculator_plans;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- 8. Super Admin storage overview and old rejected/voided receipt cleanup
create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
begin
  if current_setting('ipon.maintenance_receipt_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_super_admin()
     and tg_op = 'UPDATE'
     and tg_table_name in ('contributions', 'expenses')
     and old.group_id = new.group_id
     and old.amount = new.amount
     and old.approval_status = new.approval_status
     and old.approval_status in ('REJECTED', 'VOIDED')
     and new.receipt_url is null then
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_row_group := old.group_id;
  elsif tg_table_name = 'contribution_periods' then
    select group_id into v_row_group from public.members where id = new.member_id;
    new.group_id := v_row_group;
  elsif tg_table_name = 'contributions' then
    select group_id into v_row_group from public.contribution_periods where id = new.contribution_period_id;
    new.group_id := v_row_group;
  else
    new.group_id := coalesce(new.group_id, v_actor_group);
    v_row_group := new.group_id;
  end if;

  if v_actor_group is null or v_row_group is distinct from v_actor_group then
    raise exception 'You cannot access another savings group.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.super_admin_storage_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_super_admin() then null
    else jsonb_build_object(
      'contribution_receipts_count', (select count(*) from public.contributions where receipt_url is not null),
      'contribution_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null),
      'expense_receipts_count', (select count(*) from public.expenses where receipt_url is not null),
      'expense_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null),
      'announcements_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.announcements where jsonb_array_length(attachments) > 0),
      'bug_reports_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.bug_reports where jsonb_array_length(attachments) > 0),
      'avatars_and_qr_bytes',
        (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.profiles where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.groups where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(payment_qr_url)), 0) from public.groups where payment_qr_url is not null),
      'reclaimable_rejected_count',
        (select count(*) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select count(*) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'reclaimable_rejected_bytes',
        (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
    )
  end;
$$;

revoke execute on function public.super_admin_storage_overview() from public, anon;
grant execute on function public.super_admin_storage_overview() to authenticated;

create or replace function public.super_admin_cleanup_rejected_receipts(
  p_older_than_days integer default 90
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(coalesce(p_older_than_days, 90), 30);
  v_cutoff timestamptz := now() - make_interval(days => v_days);
  v_c integer := 0;
  v_e integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can purge archived receipt attachments.' using errcode = '42501';
  end if;

  perform set_config('ipon.maintenance_receipt_cleanup', 'on', true);

  update public.contributions
  set receipt_url = null
  where receipt_url is not null
    and approval_status in ('REJECTED', 'VOIDED')
    and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_cutoff;
  get diagnostics v_c = row_count;

  update public.expenses
  set receipt_url = null
  where receipt_url is not null
    and approval_status in ('REJECTED', 'VOIDED')
    and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_cutoff;
  get diagnostics v_e = row_count;

  return v_c + v_e;
end;
$$;

revoke execute on function public.super_admin_cleanup_rejected_receipts(integer) from public, anon;
grant execute on function public.super_admin_cleanup_rejected_receipts(integer) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_049', 'workflow planning exemptions carryover cycle archive and storage hygiene')
on conflict (version) do nothing;

commit;
