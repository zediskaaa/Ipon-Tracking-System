-- Restore RPCs, triggers, strict ACLs, and RLS policies after legacy 20261110_001..006 replay,
-- drop recreated legacy RPC overloads, and clean unlinked group assignments left by 20261110_005.

begin;

-- 1. Drop stale legacy RPC overloads recreated by replayed 20261110 migrations
drop function if exists public.create_member(text, text, text, text, date, numeric, text);
drop function if exists public.update_member(uuid, text, text, text, text, numeric, text);
drop function if exists public.update_own_profile(text, text, text, text);
drop function if exists public.update_contribution(uuid, numeric, date, text, text);
drop function if exists public.update_withdrawal(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.update_expense(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.set_contribution_setting(date, numeric);
drop function if exists public.super_admin_reject_request(uuid);

-- 2. Restore the 21 reverted functions/triggers to their latest migration definitions (086, 088, 089)
create or replace function public.current_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id
  from public.profiles
  where id = auth.uid()
    and status = 'ACTIVE'
    and public.mfa_access_allowed();
$$;

create or replace function public.validated_name_part(
  p_value text,
  p_label text,
  p_required boolean default true
)
returns text
language sql
immutable
set search_path = public
as $$
  select public.validated_name_part_mode(p_value, p_label, p_required, true, not p_required);
$$;

create or replace function public.enforce_data_quality()
returns trigger
language plpgsql
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_is_super_admin boolean := false;
begin
  if tg_table_name = 'profiles' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name
        or new.role is distinct from old.role)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      v_is_super_admin := (new.role = 'SUPER_ADMIN');
      new.first_name := public.validated_name_part_mode(new.first_name, 'First name', true, not v_is_super_admin, false);
      new.middle_name := public.validated_name_part_mode(new.middle_name, 'Middle name', false, not v_is_super_admin, true);
      new.last_name := public.validated_name_part_mode(new.last_name, 'Last name', not v_is_super_admin, not v_is_super_admin, false);
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
      if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    end if;
  elsif tg_table_name = 'members' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      new.first_name := public.validated_name_part(new.first_name, 'First name');
      new.middle_name := public.validated_name_part(new.middle_name, 'Middle name', false);
      new.last_name := public.validated_name_part(new.last_name, 'Last name');
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
    end if;
    if nullif(btrim(new.full_name), '') is null then raise exception 'Full name is required.' using errcode = '22023'; end if;
    if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if new.date_registered < date '2000-01-01' or new.date_registered > current_date then raise exception 'Date registered must be between 2000-01-01 and today.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contribution_settings' then
    if new.effective_month < date '2000-01-01' or new.effective_month > date '2100-12-01' then raise exception 'Effective month must be between January 2000 and December 2100.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contribution_periods' then
    if new.period_month < date '2000-01-01' or new.period_month > date '2100-12-01' then raise exception 'Contribution month must be between January 2000 and December 2100.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contributions' then
    if new.payment_date < date '2000-01-01' or new.payment_date > current_date then raise exception 'Date added must be between 2000-01-01 and today.' using errcode = '22023'; end if;
    if char_length(coalesce(new.transaction_reference, '')) > 100 then raise exception 'Reference must not exceed 100 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.review_note, '')) > 500 then raise exception 'Review note must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.void_reason, '')) > 500 then raise exception 'Void reason must not exceed 500 characters.' using errcode = '22023'; end if;
  elsif tg_table_name in ('expenses', 'withdrawals') then
    if new.transaction_date < date '2000-01-01' or new.transaction_date > current_date then raise exception 'Transaction date must be between 2000-01-01 and today.' using errcode = '22023'; end if;
    if nullif(btrim(new.category), '') is null then raise exception 'Category is required.' using errcode = '22023'; end if;
    if nullif(btrim(new.description), '') is null then raise exception 'Description is required.' using errcode = '22023'; end if;
    if nullif(btrim(new.person_responsible), '') is null then raise exception 'Person responsible is required.' using errcode = '22023'; end if;
    if char_length(new.category) > 80 then raise exception 'Category must not exceed 80 characters.' using errcode = '22023'; end if;
    if char_length(new.description) > 500 then raise exception 'Description must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(new.person_responsible) > 150 then raise exception 'Person responsible must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.reference_number, '')) > 100 then raise exception 'Reference must not exceed 100 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.review_note, '')) > 500 then raise exception 'Review note must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.void_reason, '')) > 500 then raise exception 'Void reason must not exceed 500 characters.' using errcode = '22023'; end if;
  elsif tg_table_name = 'savings_goals' then
    if nullif(btrim(new.title), '') is null then raise exception 'Goal title is required.' using errcode = '22023'; end if;
    if char_length(new.title) > 150 then raise exception 'Goal title must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if new.target_date is not null and (new.target_date < date '2000-01-01' or new.target_date > date '2100-12-31') then raise exception 'Target date must be between 2000-01-01 and 2100-12-31.' using errcode = '22023'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
  v_old jsonb;
  v_new jsonb;
  v_sync_member_id uuid;
  v_sync_group_id uuid;
begin
  -- Retention cleanup (scheduled edge worker or super-admin sweep)
  if current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and (auth.uid() is null or public.is_super_admin()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Annual archive roll-up deletes within the active admin's group
  if tg_op = 'DELETE' then
    if tg_table_name in ('contributions', 'withdrawals', 'expenses')
       and current_setting('ipon.maintenance_archive_rollup', true) = 'on'
       and pg_trigger_depth() <= 1
       and public.is_admin() then
      if old.group_id is not distinct from v_actor_group then
        return old;
      end if;
    end if;
  end if;

  -- 30-day savings cycle bin snapshots (both admin-initiated reset and scheduled dormant sweep)
  if tg_table_name in ('contribution_periods', 'contributions', 'withdrawals', 'expenses', 'record_comments', 'savings_goals')
     and current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and pg_trigger_depth() <= 1
     and (auth.uid() is null or public.is_admin()) then
    if auth.uid() is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'DELETE' then
      if old.group_id is not distinct from v_actor_group then
        return old;
      end if;
    else
      if new.group_id is not distinct from v_actor_group then
        return new;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Super-admin expired rejected/voided receipt purge
    if tg_table_name in ('contributions', 'expenses')
       and current_setting('ipon.maintenance_receipt_cleanup', true) = 'on'
       and pg_trigger_depth() <= 1
       and public.is_super_admin() then
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      if (v_old ->> 'group_id') is not distinct from (v_new ->> 'group_id')
         and (v_old ->> 'amount') is not distinct from (v_new ->> 'amount')
         and (v_old ->> 'approval_status') is not distinct from (v_new ->> 'approval_status')
         and (v_old ->> 'approval_status') in ('REJECTED', 'VOIDED')
         and nullif(v_new ->> 'receipt_url', '') is null then
        return new;
      end if;
    end if;

    -- Table-specific guards for members (only compiled when tg_table_name = 'members')
    if tg_table_name = 'members' and pg_trigger_depth() <= 1 then
      if current_setting('ipon.activating_member_id', true) = new.id::text
         and old.group_id is not distinct from new.group_id
         and old.activation_status <> 'ACTIVE'
         and new.activation_status = 'ACTIVE' then
        return new;
      end if;

      if auth.uid() is not null
         and current_setting('ipon.syncing_own_profile_user_id', true) = auth.uid()::text
         and old.group_id is not distinct from new.group_id
         and (
           old.id = (select p.member_id from public.profiles p where p.id = auth.uid())
           or exists (
             select 1
             from public.group_memberships gm
             where gm.user_id = auth.uid()
               and gm.member_id = old.id
           )
         ) then
        return new;
      end if;

      if public.is_admin()
         and nullif(current_setting('ipon.syncing_member_profile_id', true), '') is not null
         and old.group_id is not distinct from new.group_id then
        begin
          v_sync_member_id := current_setting('ipon.syncing_member_profile_id', true)::uuid;
        exception when others then
          v_sync_member_id := null;
        end;
        if v_sync_member_id is not null then
          select m.group_id into v_sync_group_id
          from public.members m
          where m.id = v_sync_member_id and m.deleted_at is null;

          if v_sync_group_id is not distinct from v_actor_group
             and exists (
               select 1
               from (
                 select p.id as uid from public.profiles p where p.member_id = v_sync_member_id
                 union
                 select gm.user_id as uid from public.group_memberships gm where gm.member_id = v_sync_member_id and gm.status <> 'DISABLED'
               ) src
               join (
                 select p.id as uid from public.profiles p where p.member_id = old.id
                 union
                 select gm.user_id as uid from public.group_memberships gm where gm.member_id = old.id and gm.status <> 'DISABLED'
               ) dst on dst.uid = src.uid
             ) then
            return new;
          end if;
        end if;
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    -- Initial period generation when activating a member across groups
    if tg_table_name = 'contribution_periods' and pg_trigger_depth() <= 1 then
      if current_setting('ipon.activating_member_id', true) = new.member_id::text then
        select group_id into v_row_group from public.members where id = new.member_id;
        new.group_id := v_row_group;
        return new;
      end if;
    end if;
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
  if tg_op = 'UPDATE' then
    if old.group_id is distinct from new.group_id then
      raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text := tg_op;
  v_record_id uuid;
  v_group_id uuid;
  v_noise_keys constant text[] := array[
    'updated_at',
    'created_at',
    'last_seen_at',
    'chat_privacy',
    'username',
    'bio',
    'name_setup_required',
    'previous_account_status',
    'idempotency_key',
    'inactivity_warned_at',
    'savings_inactivity_reminded_at',
    'savings_retention_warned_at',
    'policy_accepted_version',
    'policy_accepted_at'
  ];
begin
  if current_setting('ipon.maintenance_archive_rollup', true) = 'on'
     and tg_op = 'DELETE'
     and pg_trigger_depth() <= 1
     and tg_table_name in ('contributions', 'withdrawals', 'expenses') then
    return old;
  end if;

  if current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and pg_trigger_depth() <= 1
     and tg_table_name in ('contribution_periods', 'contributions', 'withdrawals', 'expenses', 'record_comments') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and (
       tg_op = 'DELETE'
       or (auth.uid() is null and tg_op = 'UPDATE' and tg_table_name in ('contributions', 'expenses'))
     ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_old := case when tg_op in ('UPDATE', 'DELETE') then public.scrub_audit_media_jsonb(to_jsonb(old) - v_noise_keys) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then public.scrub_audit_media_jsonb(to_jsonb(new) - v_noise_keys) else null end;

  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  v_record_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  v_group_id := coalesce((v_new ->> 'group_id')::uuid, (v_old ->> 'group_id')::uuid);

  if v_group_id is not null and not exists (select 1 from public.groups g where g.id = v_group_id) then
    v_group_id := null;
  end if;

  if tg_op = 'UPDATE' and v_old ->> 'approval_status' is distinct from v_new ->> 'approval_status' then
    v_action := case v_new ->> 'approval_status'
      when 'CONFIRMED' then 'CONFIRM'
      when 'REJECTED' then 'REJECT'
      when 'VOIDED' then 'VOID'
      else 'UPDATE'
    end;
  end if;

  insert into public.audit_logs (group_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (v_group_id, tg_table_name, v_record_id, v_action, v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.record_account_activity(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('LOGIN', 'PASSWORD_CHANGE') then
    raise exception 'Unsupported account activity.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.account_activity
    where user_id = auth.uid()
      and event = p_event
      and created_at > now() - interval '1 minute'
  ) then
    insert into public.account_activity (user_id, event)
    values (auth.uid(), p_event);
  end if;
end;
$$;

create or replace function public.generate_contribution_periods(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_month date := date_trunc('month', p_month)::date;
  v_group_id uuid := public.current_group_id();
  v_due_date date;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can generate contribution periods.' using errcode = '42501';
  end if;

  v_due_date := public.contribution_period_due_date(v_group_id, v_month);

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select id, v_month, monthly_contribution_amount, v_due_date
  from public.members
  where status = 'ACTIVE'
    and activation_status = 'ACTIVE'
    and deleted_at is null
    and group_id = v_group_id
    and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
  cycle_totals as (
    select
      (select coalesce(sum(c.amount), 0) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or c.payment_date >= grp.cycle_start_date))
        + (select add_amt from archived_cycle) as total_additions,
      (select coalesce(sum(w.amount), 0) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or w.transaction_date >= grp.cycle_start_date))
        + (select ded_amt from archived_cycle) as total_deductions,
      (select coalesce(sum(e.amount), 0) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or e.transaction_date >= grp.cycle_start_date))
        + (select exp_amt from archived_cycle) as total_expenses,
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
      'tracked_savings', ct.total_additions - ct.total_deductions - ct.total_expenses,
      'lifetime_tracked_savings', ct.lifetime_tracked_savings,
      'cycle_start_date', ct.cycle_start_date,
      'pending_entries', ct.pending_entries
    )
  end
  from ctx, cycle_totals ct;
$$;

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
      (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0))::numeric(14,2) as paid_amount,
      least(cp.archived_first_paid_date, min(c.payment_date) filter (where c.approval_status = 'CONFIRMED')) as first_paid_date
    from public.contribution_periods cp
    left join public.contributions c on c.contribution_period_id = cp.id
    where cp.member_id = v_member_id
      and cp.period_month <= v_current_month
    group by cp.id, cp.period_month, cp.due_date, cp.is_exempt, cp.required_amount, cp.archived_paid_amount, cp.archived_first_paid_date
    order by cp.period_month desc
  loop
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
    'total_contributed',
      (select coalesce(sum(cp.archived_paid_amount), 0) from public.contribution_periods cp where cp.member_id = v_member_id)
      + (select coalesce(sum(c.amount), 0) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'CONFIRMED'),
    'months_paid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('PAID', 'OVERPAID')),
    'months_unpaid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('UNPAID', 'PARTIALLY PAID') and period_month <= v_current_month),
    'pending_submissions', (select count(*) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'PENDING'),
    'payment_streak', v_payment_streak,
    'on_time_streak', v_on_time_streak,
    'current_period', (select to_jsonb(x) from (select vcs.period_month, vcs.required_amount, vcs.paid_amount, vcs.outstanding_amount, vcs.payment_status, cp.due_date, cp.is_exempt, cp.exempt_reason from public.v_contribution_status vcs join public.contribution_periods cp on cp.id = vcs.contribution_period_id where vcs.member_id = v_member_id and vcs.period_month = v_current_month) x)
  );
end;
$$;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_member_user record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name
    when 'contributions' then 'contribution'
    when 'withdrawals' then 'deduction'
    else 'expense'
  end;
  v_record_type text := case tg_table_name
    when 'contributions' then 'contribution'
    when 'withdrawals' then 'withdrawal'
    else 'expense'
  end;
  v_record_key text := v_record_type || ':' || new.id::text;
  v_status text := lower(new.approval_status::text);
  v_submitter_role public.app_role;
  v_submitter_name text := 'A group user';
  v_amount_text text := to_char(coalesce(new.amount, 0), 'FM999,999,990.00');
  v_link text := 'dashboard.html';
  v_reason text;
  v_message text;
begin
  if current_setting('ipon.maintenance_bin_snapshot', true) = 'on' then
    return new;
  end if;

  if new.submitted_by is not null then
    select coalesce(gm.role, p.role), coalesce(nullif(btrim(p.full_name), ''), 'A group user')
    into v_submitter_role, v_submitter_name
    from public.profiles p
    left join public.group_memberships gm
      on gm.group_id = v_group
     and gm.user_id = p.id
     and gm.status = 'ACTIVE'
    where p.id = new.submitted_by;

    v_link := case
      when tg_table_name = 'contributions' and v_submitter_role = 'MEMBER' then 'user.html'
      when tg_table_name = 'contributions' then 'contributions.html'
      when tg_table_name = 'withdrawals' then 'withdrawals.html'
      else 'expenses.html'
    end;
  end if;

  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group)
    loop
      perform public.push_notification(
        v_admin.id,
        'REVIEW_REQUIRED',
        'New ' || v_label || ' submitted',
        v_submitter_name || ' submitted a ' || v_label || ' (PHP ' || v_amount_text || ') for review.',
        'dashboard.html?review=' || v_record_key,
        v_group
      );
    end loop;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        'SUBMITTED',
        initcap(v_label) || ' submitted',
        'Your ' || v_label || ' (PHP ' || v_amount_text || ') is waiting for administrator review.',
        v_link || '?record=' || v_record_key,
        v_group
      );
    end if;
  elsif tg_op = 'INSERT'
    and tg_table_name = 'contributions'
    and new.approval_status = 'CONFIRMED'
  then
    for v_member_user in
      select distinct u.id as user_id
      from public.contribution_periods cp
      join (
        select gm.user_id as id, gm.member_id
        from public.group_memberships gm
        where gm.group_id = v_group and gm.status = 'ACTIVE' and gm.member_id is not null
        union
        select p.id, p.member_id
        from public.profiles p
        where p.group_id = v_group and p.status = 'ACTIVE' and p.member_id is not null
      ) u on u.member_id = cp.member_id
      where cp.id = new.contribution_period_id
        and u.id is distinct from new.submitted_by
    loop
      perform public.push_notification(
        v_member_user.user_id,
        'CONTRIBUTION_RECORDED',
        'Contribution recorded',
        'A confirmed contribution of PHP ' || v_amount_text || ' was recorded on your profile.',
        'user.html?record=' || v_record_key,
        v_group
      );
    end loop;
  elsif tg_op = 'UPDATE'
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
      when new.approval_status = 'VOIDED' then 'Your ' || v_label || ' (PHP ' || v_amount_text || ') was voided.'
      else 'Your submitted ' || v_label || ' (PHP ' || v_amount_text || ') was ' || v_status || '.'
    end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end;
    if char_length(v_message) > 500 then
      v_message := left(v_message, 499) || '…';
    end if;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        case when new.approval_status = 'VOIDED' then 'VOIDED' else 'REVIEWED' end,
        initcap(v_label) || ' ' || v_status,
        v_message,
        v_link || '?record=' || v_record_key,
        v_group
      );
    end if;

    if tg_table_name = 'contributions' and new.approval_status in ('CONFIRMED', 'VOIDED') then
      for v_member_user in
        select distinct u.id as user_id
        from public.contribution_periods cp
        join (
          select gm.user_id as id, gm.member_id
          from public.group_memberships gm
          where gm.group_id = v_group and gm.status = 'ACTIVE' and gm.member_id is not null
          union
          select p.id, p.member_id
          from public.profiles p
          where p.group_id = v_group and p.status = 'ACTIVE' and p.member_id is not null
        ) u on u.member_id = cp.member_id
        where cp.id = new.contribution_period_id
          and u.id is distinct from new.submitted_by
      loop
        perform public.push_notification(
          v_member_user.user_id,
          case when new.approval_status = 'VOIDED' then 'VOIDED' else 'CONTRIBUTION_RECORDED' end,
          'Contribution ' || v_status,
          case when new.approval_status = 'VOIDED'
            then 'A contribution on your profile (PHP ' || v_amount_text || ') was voided.'
            else 'A contribution on your profile (PHP ' || v_amount_text || ') was confirmed.'
          end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end,
          'user.html?record=' || v_record_key,
          v_group
        );
      end loop;
    end if;
  elsif tg_op = 'UPDATE'
    and old.approval_status = new.approval_status
    and new.approval_status = 'PENDING'
  then
    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group)
    loop
      perform public.push_notification(
        v_admin.id,
        'RECORD_UPDATED',
        initcap(v_label) || ' updated',
        v_submitter_name || ' updated a pending ' || v_label || ' (PHP ' || v_amount_text || ') awaiting review.',
        'dashboard.html?review=' || v_record_key,
        v_group
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  for v_admin in
    select user_id as id
    from public.group_admin_ids(new.group_id)
  loop
    perform public.push_notification(
      v_admin.id,
      'MEMBER_CREATED',
      case when new.activation_status = 'ACTIVE' then 'Member activated' else 'Member added (pending login)' end,
      case
        when new.activation_status = 'ACTIVE' then new.full_name || ' was added as an official active member.'
        else new.full_name || ' was added and will become an official active member after signing in.'
      end,
      'members.html?member=' || new.id::text,
      new.group_id
    );
  end loop;
  return new;
end;
$$;

create or replace function public.notify_profile_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in ('MEMBER', 'TREASURER')
    and old.status is distinct from new.status
    and new.status = 'ACTIVE'
  then
    perform public.push_notification(
      new.id,
      'ACCOUNT_READY',
      'Your account is ready',
      case
        when new.role = 'TREASURER' then 'Your treasurer account is active in your savings group.'
        else 'Your member account is active and linked to your savings profile.'
      end,
      case when new.role = 'TREASURER' then 'dashboard.html?notice=account-ready' else 'user.html?notice=account-ready' end,
      new.group_id
    );
  end if;
  return new;
end;
$$;

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_count integer;
begin
  with linked_users as (
    select distinct p.id as user_id, u.member_id
    from (
      select gm.user_id as id, gm.member_id
      from public.group_memberships gm
      where gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.id, p.member_id
      from public.profiles p
      where p.status = 'ACTIVE' and p.member_id is not null
    ) u
    join public.profiles p on p.id = u.id
    where p.status = 'ACTIVE' and p.notifications_enabled
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select lu.user_id,
         cp.group_id,
         'CONTRIBUTION_REMINDER',
         'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.',
         'user.html?reminder=' || to_char(cp.period_month, 'YYYY-MM')
  from public.contribution_periods cp
  join linked_users lu on lu.member_id = cp.member_id
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = lu.user_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from cp.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_full_name text;
  v_contact text;
  v_reason text;
  v_account_kind text := coalesce(new.raw_user_meta_data ->> 'account_kind', 'DIRECT_SIGNUP');
  v_name_setup_required boolean := coalesce((new.raw_user_meta_data ->> 'name_setup_required')::boolean, false);
  v_super_admin record;
  v_request_id uuid;
  v_status public.account_status := 'ACTIVE';
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '') is not null
     and nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '') is not null then
    v_first_name := public.validated_name_part(new.raw_user_meta_data ->> 'first_name', 'First name');
    v_middle_name := public.validated_name_part(new.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
    v_last_name := public.validated_name_part(new.raw_user_meta_data ->> 'last_name', 'Last name');
    v_full_name := concat_ws(' ', v_first_name, v_middle_name, v_last_name);
  else
    v_full_name := case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2 then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2 then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end;
    v_name_setup_required := true;
  end if;

  v_contact := public.normalize_ph_mobile(new.raw_user_meta_data ->> 'contact_number');
  v_reason := nullif(btrim(new.raw_user_meta_data ->> 'request_reason'), '');

  if v_account_kind = 'DISABLED' then
    v_status := 'DISABLED';
  elsif v_account_kind = 'ADMIN_REQUEST' then
    if exists (
      select 1 from public.admin_requests ar
      where lower(ar.email) = lower(new.email)
        and ar.status = 'REJECTED'
    ) or exists (
      select 1 from public.profiles p
      where lower(p.email) = lower(new.email)
        and p.status = 'DISABLED'
        and p.role = 'MEMBER'
    ) then
      raise exception 'This email address was declined for administrator access and cannot request again.' using errcode = '22023';
    end if;

    if v_contact is null or v_reason is null or char_length(v_reason) < 10 then
      raise exception 'Administrator requests require a contact number and a reason of at least 10 characters.' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.email_verifications ev
      where lower(ev.email) = lower(new.email)
        and ev.purpose = 'ADMIN_REQUEST'
        and ev.verified_at is not null
        and ev.verified_at >= now() - interval '30 minutes'
    ) then
      raise exception 'Email ownership has not been verified. Please verify your email before submitting.' using errcode = '22023';
    end if;
    v_status := 'PENDING';
  elsif v_account_kind in ('INVITED', 'MANAGED') then
    v_status := 'PENDING';
  else
    v_status := 'ACTIVE';
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status, name_setup_required)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', v_status, v_name_setup_required)
  on conflict (id) do update set
    status = case when v_account_kind in ('INVITED', 'MANAGED') then 'PENDING' when public.profiles.status = 'PENDING' then 'ACTIVE' else public.profiles.status end,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    contact_number = coalesce(public.profiles.contact_number, excluded.contact_number),
    name_setup_required = public.profiles.name_setup_required or excluded.name_setup_required;

  if v_account_kind = 'ADMIN_REQUEST' then
    insert into public.admin_requests (requester_id, email, contact_number, reason)
    values (new.id, lower(new.email), v_contact, v_reason)
    returning id into v_request_id;

    for v_super_admin in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(
        v_super_admin.id,
        'ADMIN_REQUEST',
        'New administrator request',
        v_full_name || ' requested administrator access.',
        'super-admin.html?admin_request=' || v_request_id::text || '#requests'
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text := nullif(btrim(p_group_name), '');
  v_group_id uuid;
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if v_group_name is null or char_length(v_group_name) < 2 then raise exception 'A group name of at least 2 characters is required.' using errcode = '22023'; end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;

  update public.profiles
  set role = 'ADMIN',
      status = 'ACTIVE',
      group_id = v_group_id,
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_user_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE', member_id = null;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(
    p_user_id,
    'ADMIN_APPROVED',
    'Administrator request approved',
    'Your request was approved. Group "' || v_group_name || '" is ready.',
    'dashboard.html?notice=admin-approved',
    v_group_id
  );
  return v_group_id;
end;
$$;

create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'A reason of at least 3 characters is required when rejecting an administrator request.' using errcode = '22023';
  end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  update public.profiles
  set status = 'DISABLED',
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', v_note, null);
end;
$$;

create or replace function public.super_admin_archive_administrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can archive user accounts.' using errcode = '42501';
  end if;

  update public.profiles
  set status = 'DISABLED'
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups set status = 'SUSPENDED' where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_ARCHIVED',
    'Account archived',
    'A user account was disabled.',
    'super-admin.html#administrators'
  );
end;
$$;

create or replace function public.super_admin_create_group(p_name text, p_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can create savings groups.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Group name is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_admin_id and role = 'ADMIN' and group_id is null
  ) then
    raise exception 'An unassigned administrator account is required.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id)
  values (btrim(p_name), p_admin_id)
  returning id into v_group_id;

  update public.profiles
  set group_id = v_group_id, status = 'ACTIVE'
  where id = p_admin_id;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_admin_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  return v_group_id;
end;
$$;

create or replace function public.super_admin_set_administrator_status(
  p_user_id uuid,
  p_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can change account status.' using errcode = '42501';
  end if;

  if p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'Account status must be ACTIVE or DISABLED.' using errcode = '22023';
  end if;

  update public.profiles
  set status = p_status
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups
    set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'SUSPENDED' end
    where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_STATUS',
    'Account status changed',
    'A user account is now ' || lower(p_status::text) || '.',
    'super-admin.html?admin_user=' || p_user_id::text || '#administrators'
  );
end;
$$;

-- 3. Re-assert strict function execution privileges
revoke all on function public.enforce_data_quality() from public, anon, authenticated;
revoke all on function public.enforce_group_scope() from public, anon, authenticated;
revoke all on function public.write_audit_log() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.notify_record_activity() from public, anon, authenticated;
revoke all on function public.notify_new_member() from public, anon, authenticated;
revoke all on function public.notify_profile_access() from public, anon, authenticated;
revoke all on function public.create_due_reminders() from public, anon, authenticated;

revoke all on function public.validated_name_part(text, text, boolean) from public, anon;
grant execute on function public.validated_name_part(text, text, boolean) to authenticated;
revoke all on function public.current_group_id() from public, anon;
grant execute on function public.current_group_id() to authenticated;
revoke all on function public.record_account_activity(text) from public, anon;
grant execute on function public.record_account_activity(text) to authenticated;
revoke all on function public.generate_contribution_periods(date) from public, anon;
grant execute on function public.generate_contribution_periods(date) to authenticated;
revoke all on function public.get_savings_summary() from public, anon;
grant execute on function public.get_savings_summary() to authenticated;
revoke all on function public.get_user_dashboard() from public, anon;
grant execute on function public.get_user_dashboard() to authenticated;
revoke all on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) from public, anon;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;
revoke all on function public.super_admin_approve_request(uuid, text) from public, anon;
grant execute on function public.super_admin_approve_request(uuid, text) to authenticated;
revoke all on function public.super_admin_reject_request(uuid, text) from public, anon;
grant execute on function public.super_admin_reject_request(uuid, text) to authenticated;
revoke all on function public.super_admin_archive_administrator(uuid) from public, anon;
grant execute on function public.super_admin_archive_administrator(uuid) to authenticated;
revoke all on function public.super_admin_create_group(text, uuid) from public, anon;
grant execute on function public.super_admin_create_group(text, uuid) to authenticated;
revoke all on function public.super_admin_set_administrator_status(uuid, public.account_status) from public, anon;
grant execute on function public.super_admin_set_administrator_status(uuid, public.account_status) to authenticated;
revoke all on function public.super_admin_update_administrator(uuid, text, text, text, text) from public, anon;
grant execute on function public.super_admin_update_administrator(uuid, text, text, text, text) to authenticated;

revoke all on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) from public, anon;
grant execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) to authenticated;
revoke all on function public.update_member(uuid, text, text, text, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.update_member(uuid, text, text, text, text, numeric, text, text, text, text) to authenticated;
revoke all on function public.update_own_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text, text, text, text, text) to authenticated;
revoke all on function public.update_contribution(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.update_contribution(uuid, numeric, date, text, text, text) to authenticated;
revoke all on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text, text) to authenticated;
revoke all on function public.update_expense(uuid, date, numeric, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_expense(uuid, date, numeric, text, text, text, text, text, text) to authenticated;

-- 4. Restore the 9 reverted RLS SELECT policies
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (public.is_admin() and group_id = public.current_group_id())
);

drop policy if exists account_activity_select on public.account_activity;
create policy account_activity_select on public.account_activity for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.is_super_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = user_id and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
    )
  )
);

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
using (
  public.is_super_admin()
  or id = public.current_group_id()
  or exists (
    select 1
    from public.group_memberships gm
    where gm.group_id = groups.id
      and gm.user_id = auth.uid()
      and gm.status = 'ACTIVE'
  )
);

drop policy if exists savings_goals_select on public.savings_goals;
create policy savings_goals_select on public.savings_goals for select to authenticated
using (
  group_id = public.current_group_id()
  and deleted_at is null
  and public.current_user_role() <> 'SUPER_ADMIN'
);

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

-- 5. Restore admin_set_user_access with Solo workspace invite guard and multi-group support
create or replace function public.admin_set_user_access(
  p_user_id uuid,
  p_role public.app_role,
  p_status public.account_status,
  p_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.app_role := public.current_user_role();
  v_actor_group uuid := public.current_group_id();
  v_member public.members;
  v_target public.profiles;
  v_prev_membership public.group_memberships;
  v_link_member_id uuid;
  v_group_name text := 'your savings group';
  v_group_mode text := 'GROUP';
begin
  if v_actor_role = 'SUPER_ADMIN' then
    if p_role not in ('SUPER_ADMIN', 'ADMIN') or p_member_id is not null then
      raise exception 'Super administrators can only manage platform administrator accounts.' using errcode = '42501';
    end if;
    if p_role = 'SUPER_ADMIN' and p_user_id <> auth.uid() then
      raise exception 'Additional super administrator accounts cannot be assigned here.' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() and (p_role <> 'SUPER_ADMIN' or p_status <> 'ACTIVE') then
      raise exception 'You cannot remove or disable your own super administrator access.' using errcode = '22023';
    end if;
    update public.profiles
    set role = p_role, status = p_status, member_id = null
    where id = p_user_id and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
    if not found then
      raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
    end if;
    return;
  end if;

  if v_actor_role <> 'ADMIN' or v_actor_group is null then
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;

  select name, coalesce(workspace_mode, 'GROUP') into v_group_name, v_group_mode
  from public.groups
  where id = v_actor_group;
  v_group_name := coalesce(nullif(btrim(v_group_name), ''), 'your savings group');

  if v_group_mode = 'SOLO' and p_status <> 'DISABLED' then
    raise exception 'Solo savings workspaces do not accept member or treasurer invitations. Switch to Group savings in Group settings first.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() or p_role not in ('MEMBER', 'TREASURER') then
    raise exception 'Group administrators can only manage member and treasurer accounts in their own group.' using errcode = '42501';
  end if;

  if p_role = 'MEMBER' and p_status = 'ACTIVE' and p_member_id is null then
    raise exception 'Active member accounts must be linked to a member.' using errcode = '22023';
  end if;

  if p_role = 'TREASURER' and p_member_id is not null then
    raise exception 'Treasurer accounts cannot be linked to a member profile.' using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found or v_target.role = 'SUPER_ADMIN' then
    raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
  end if;

  select * into v_prev_membership
  from public.group_memberships
  where group_id = v_actor_group and user_id = p_user_id;

  v_link_member_id := case when p_role = 'MEMBER' then p_member_id else null end;

  if v_link_member_id is not null then
    select * into v_member from public.members
    where id = v_link_member_id and group_id = v_actor_group and deleted_at is null;
    if not found then
      raise exception 'The selected member does not belong to your savings group.' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.group_memberships gm
      where gm.group_id = v_actor_group
        and gm.member_id = v_link_member_id
        and gm.user_id <> p_user_id
    ) then
      raise exception 'That member already has a linked user account in this group.' using errcode = '22023';
    end if;
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_actor_group, p_user_id, p_role, p_status, v_link_member_id)
  on conflict (group_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      member_id = excluded.member_id;

  if (v_target.group_id is null or v_target.group_id = v_actor_group) and (p_status = 'ACTIVE' or v_target.status <> 'ACTIVE') then
    update public.profiles
    set role = p_role,
        status = case when v_target.status = 'ACTIVE' then 'ACTIVE' else p_status end,
        member_id = v_link_member_id,
        group_id = v_actor_group,
        first_name = coalesce(first_name, v_member.first_name),
        middle_name = coalesce(middle_name, v_member.middle_name),
        last_name = coalesce(last_name, v_member.last_name),
        full_name = coalesce(nullif(btrim(full_name), ''), v_member.full_name),
        contact_number = coalesce(contact_number, v_member.contact_number)
    where id = p_user_id;
  end if;

  if p_status = 'ACTIVE' and v_link_member_id is not null and exists (
    select 1 from auth.users u where u.id = p_user_id and u.last_sign_in_at is not null
  ) then
    perform public.activate_member_record(v_link_member_id, p_user_id);
  end if;

  if v_prev_membership.user_id is not null and (
    v_prev_membership.role is distinct from p_role
    or v_prev_membership.status is distinct from p_status
  ) then
    perform public.push_notification(
      p_user_id,
      'ACCESS_UPDATED',
      'Group access updated',
      case
        when p_status = 'DISABLED' then 'Your access to "' || v_group_name || '" was disabled by an administrator.'
        when v_prev_membership.role is distinct from p_role then 'Your role in "' || v_group_name || '" was changed to ' || initcap(lower(p_role::text)) || '.'
        else 'Your access in "' || v_group_name || '" is now ' || lower(p_status::text) || '.'
      end,
      (case when p_role = 'MEMBER' then 'user.html' else 'dashboard.html' end) || '?notice=access-updated',
      v_actor_group
    );
  end if;
end;
$$;

revoke all on function public.set_contribution_setting(date, numeric, integer) from public, anon;
grant execute on function public.set_contribution_setting(date, numeric, integer) to authenticated;

-- 6. Remove stray unlinked group assignments introduced when 20261110_005 forced NULL-group members into the oldest group
delete from public.group_memberships
where group_id = '0ef665ea-3fb3-4919-8d39-f4c1a2693d78'::uuid
  and role = 'MEMBER'
  and member_id is null
  and user_id in ('68853776-6a1b-4170-afb8-5dd93c3de90c'::uuid, 'e9181a7f-7211-47ce-b4ee-bf95e99f78d4'::uuid);

update public.profiles
set group_id = null,
    member_id = null
where id in ('68853776-6a1b-4170-afb8-5dd93c3de90c'::uuid, 'e9181a7f-7211-47ce-b4ee-bf95e99f78d4'::uuid)
  and role = 'MEMBER'
  and group_id = '0ef665ea-3fb3-4919-8d39-f4c1a2693d78'::uuid
  and member_id is null;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_095', 'restore reverted rpcs and policies, drop legacy overloads, and clean unlinked groups')
on conflict (version) do nothing;

commit;
