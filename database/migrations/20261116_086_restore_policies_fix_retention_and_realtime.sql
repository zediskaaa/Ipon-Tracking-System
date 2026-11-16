-- Migration 086: Restore member dashboard transparency + Super Admin name rules,
-- fix call_sessions/enforce_group_scope/contribution_settings bugs in automated retention cleanup,
-- drop stale overloaded RPC signatures, and publish group/ledger tables to supabase_realtime.

begin;

-- 1. Drop stale shorter overloaded RPC signatures left by legacy migrations (prevents PGRST203 ambiguity)
drop function if exists public.create_member(text, text, text, text, date, numeric, text);
drop function if exists public.update_member(uuid, text, text, text, text, numeric, text);
drop function if exists public.update_contribution(uuid, numeric, date, text, text);
drop function if exists public.update_expense(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.update_withdrawal(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.update_own_profile(text, text, text, text);

-- 2. Restore latest enforce_data_quality() with Super Admin flexible names + unchanged-name skip
--    so accept_current_policy / avatar / presence updates never trigger "Last name is required."
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

-- 3. Restore shared group summary RPC and Member group transparency RLS (including cycle & annual archives)
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

-- 4. Allow backend cron / service-role retention & bin snapshot RPCs to maintain group-scoped tables cleanly
create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
  v_is_backend_maintenance boolean :=
    auth.uid() is null
    and (
      current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
      or current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
    );
begin
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

  if not v_is_backend_maintenance then
    if v_actor_group is null or v_row_group is distinct from v_actor_group then
      raise exception 'You cannot access another savings group.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
      raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
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

-- 5. Fix call_sessions column (ended_at, started_at) and contribution_settings RESTRICT cleanup in run_data_retention_cleanup()
create or replace function public.run_data_retention_cleanup(
  p_message_days integer default 90,
  p_audit_days integer default 90,
  p_read_notif_days integer default 30,
  p_unread_notif_days integer default 90,
  p_call_days integer default 30,
  p_bin_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_message_days, 90), 30));
  v_audit_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_audit_days, 90), 30));
  v_read_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_read_notif_days, 30), 7));
  v_unread_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_unread_notif_days, 90), 30));
  v_call_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_call_days, 30), 7));
  v_bin_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_bin_days, 30), 14));
  v_deleted_messages integer := 0;
  v_deleted_calls integer := 0;
  v_deleted_notifs integer := 0;
  v_deleted_audits integer := 0;
  v_deleted_activity integer := 0;
  v_deleted_throttles integer := 0;
  v_cleaned_receipts integer := 0;
  v_deleted_members integer := 0;
  v_deleted_goals integer := 0;
  v_deleted_announcements integer := 0;
  v_deleted_batches integer := 0;
  v_deleted_suspended_groups integer := 0;
  v_conv_id uuid;
  v_latest record;
  v_expired_ann record;
  v_expired_batch record;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  with purged as (
    delete from public.messages
    where created_at < v_msg_cutoff
    returning conversation_id
  )
  select count(*) into v_deleted_messages from purged;

  if v_deleted_messages > 0 then
    for v_conv_id in
      select c.id
      from public.conversations c
      where c.last_message_at is not null
        and (
          c.last_message_id is null
          or not exists (select 1 from public.messages m where m.id = c.last_message_id)
        )
    loop
      select m.id, m.created_at, m.sender_id,
             case
               when m.deleted_for_everyone_at is not null then 'Message removed'
               when char_length(btrim(m.body)) > 0 then left(btrim(m.body), 140)
               when m.message_type = 'VOICE' then 'Sent a voice message'
               else 'Sent an attachment'
             end as preview
      into v_latest
      from public.messages m
      where m.conversation_id = v_conv_id
      order by m.created_at desc
      limit 1;

      update public.conversations
      set last_message_id = v_latest.id,
          last_message_at = v_latest.created_at,
          last_message_sender_id = v_latest.sender_id,
          last_message_preview = v_latest.preview
      where id = v_conv_id;
    end loop;
  end if;

  delete from public.call_sessions
  where coalesce(ended_at, started_at) < v_call_cutoff;
  get diagnostics v_deleted_calls = row_count;

  delete from public.notifications
  where (read_at is not null and read_at < v_read_notif_cutoff)
     or (read_at is null and created_at < v_unread_notif_cutoff);
  get diagnostics v_deleted_notifs = row_count;

  delete from public.audit_logs
  where changed_at < v_audit_cutoff;
  get diagnostics v_deleted_audits = row_count;

  delete from public.account_activity
  where created_at < v_audit_cutoff;
  get diagnostics v_deleted_activity = row_count;

  delete from public.auth_login_throttles
  where updated_at < now() - interval '7 days';
  get diagnostics v_deleted_throttles = row_count;

  with upd_c as (
    update public.contributions
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_msg_cutoff
    returning 1
  ),
  upd_e as (
    update public.expenses
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_msg_cutoff
    returning 1
  )
  select (select count(*) from upd_c) + (select count(*) from upd_e) into v_cleaned_receipts;

  delete from public.savings_goals
  where deleted_at is not null
    and deleted_at < v_bin_cutoff;
  get diagnostics v_deleted_goals = row_count;

  for v_expired_ann in
    select id, attachments
    from public.announcements
    where deleted_at is not null
      and deleted_at < v_bin_cutoff
  loop
    perform public.purge_bin_item_storage('announcement', v_expired_ann.attachments);
    delete from public.announcements where id = v_expired_ann.id;
    v_deleted_announcements := v_deleted_announcements + 1;
  end loop;

  for v_expired_batch in
    select id, snapshot
    from public.savings_cycle_batches
    where restored_at is null
      and (expires_at < now() or deleted_at < v_bin_cutoff)
  loop
    perform public.purge_bin_item_storage('savings_cycle', v_expired_batch.snapshot);
    delete from public.savings_cycle_batches where id = v_expired_batch.id;
    v_deleted_batches := v_deleted_batches + 1;
  end loop;

  delete from public.contribution_periods cp
  using public.members m
  where cp.member_id = m.id
    and m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.contribution_period_id = cp.id)
    and not exists (select 1 from public.contribution_periods cp2 join public.contributions c2 on c2.contribution_period_id = cp2.id where cp2.member_id = m.id);

  delete from public.members m
  where m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contribution_periods cp where cp.member_id = m.id);
  get diagnostics v_deleted_members = row_count;

  delete from public.contribution_settings cs
  where exists (
    select 1
    from public.groups g
    where g.id = cs.group_id
      and g.status = 'SUSPENDED'
      and g.owner_id is null
      and g.updated_at < v_bin_cutoff
      and not exists (select 1 from public.contributions c where c.group_id = g.id)
      and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
      and not exists (select 1 from public.expenses e where e.group_id = g.id)
      and not exists (select 1 from public.contribution_periods cp where cp.group_id = g.id)
      and not exists (select 1 from public.savings_goals sg where sg.group_id = g.id)
      and not exists (select 1 from public.savings_cycle_batches sc where sc.group_id = g.id)
      and not exists (select 1 from public.members m where m.group_id = g.id)
  );

  delete from public.groups g
  where g.status = 'SUSPENDED'
    and g.owner_id is null
    and g.updated_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.group_id = g.id)
    and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
    and not exists (select 1 from public.expenses e where e.group_id = g.id)
    and not exists (select 1 from public.contribution_periods cp where cp.group_id = g.id)
    and not exists (select 1 from public.savings_goals sg where sg.group_id = g.id)
    and not exists (select 1 from public.savings_cycle_batches sc where sc.group_id = g.id)
    and not exists (select 1 from public.members m where m.group_id = g.id);
  get diagnostics v_deleted_suspended_groups = row_count;

  return jsonb_build_object(
    'messages_deleted', v_deleted_messages,
    'calls_deleted', v_deleted_calls,
    'notifications_deleted', v_deleted_notifs,
    'audit_logs_deleted', v_deleted_audits,
    'account_activity_deleted', v_deleted_activity,
    'login_throttles_deleted', v_deleted_throttles,
    'receipts_cleaned', v_cleaned_receipts,
    'expired_bin_members_deleted', v_deleted_members,
    'expired_bin_goals_deleted', v_deleted_goals,
    'expired_bin_announcements_deleted', v_deleted_announcements,
    'expired_bin_savings_batches_deleted', v_deleted_batches,
    'abandoned_suspended_groups_deleted', v_deleted_suspended_groups,
    'pending_storage_queue', (select count(*) from public.pending_storage_deletions)
  );
end;
$$;

revoke execute on function public.run_data_retention_cleanup(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;

-- 6. Publish group & financial tables to supabase_realtime so connected pages auto-refresh live
do $$
declare
  v_tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_tbl in array array[
      'contributions',
      'withdrawals',
      'expenses',
      'contribution_periods',
      'members',
      'groups',
      'group_memberships',
      'profiles',
      'savings_cycle_batches'
    ] loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_tbl
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_tbl);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_086', 'restore member visibility and data quality, fix retention cleanup bugs, enable group realtime')
on conflict (version) do nothing;

commit;
