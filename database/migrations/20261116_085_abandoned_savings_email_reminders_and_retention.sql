-- Migration 085: Email reminders (3-month nudge & 6-month 7-day final warning) and automatic 30-day Bin -> permanent DB/Storage retention when users abandon or forget their savings and goals.

begin;

-- 1. Track dormant savings email milestones per group without polluting audit logs
alter table public.groups
  add column if not exists savings_inactivity_reminded_at timestamptz,
  add column if not exists savings_retention_warned_at timestamptz;

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
     and tg_op = 'DELETE'
     and pg_trigger_depth() <= 1 then
    return old;
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

-- 2. Compute latest savings / goal activity timestamp for a group
create or replace function public.group_last_savings_activity_at(p_group_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((select max(greatest(c.created_at, c.updated_at)) from public.contributions c where c.group_id = p_group_id), 'epoch'::timestamptz),
    coalesce((select max(greatest(w.created_at, w.updated_at)) from public.withdrawals w where w.group_id = p_group_id), 'epoch'::timestamptz),
    coalesce((select max(greatest(e.created_at, e.updated_at)) from public.expenses e where e.group_id = p_group_id), 'epoch'::timestamptz),
    coalesce((select max(greatest(sg.created_at, sg.updated_at)) from public.savings_goals sg where sg.group_id = p_group_id and sg.deleted_at is null), 'epoch'::timestamptz)
  );
$$;

revoke execute on function public.group_last_savings_activity_at(uuid) from public, anon, authenticated;

-- 3. Shared internal helper for moving active savings & goals into the 30-day Recycle Bin (reused by manual batch reset & automated dormant retention)
create or replace function public.snapshot_and_clear_group_savings_to_bin(
  p_group_id uuid,
  p_title text default null,
  p_reason text default null,
  p_actor_id uuid default null,
  p_include_completed_goals boolean default false,
  p_include_all_goals boolean default false,
  p_allow_pending boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := nullif(left(btrim(coalesce(p_title, '')), 160), '');
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_pending integer := 0;
  v_add numeric(14,2) := 0;
  v_ded numeric(14,2) := 0;
  v_exp numeric(14,2) := 0;
  v_records_count integer := 0;
  v_periods_count integer := 0;
  v_goals_count integer := 0;
  v_period_start date;
  v_period_end date;
  v_prev_cycle_start date;
  v_periods_json jsonb := '[]'::jsonb;
  v_contribs_json jsonb := '[]'::jsonb;
  v_withdrawals_json jsonb := '[]'::jsonb;
  v_expenses_json jsonb := '[]'::jsonb;
  v_comments_json jsonb := '[]'::jsonb;
  v_goal_ids jsonb := '[]'::jsonb;
  v_batch_id uuid;
  v_expires_at timestamptz := now() + interval '1 month';
begin
  if p_group_id is null then
    raise exception 'Group is required.' using errcode = '22023';
  end if;

  if v_title is null then
    v_title := 'Savings Batch — ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD, YYYY');
  elsif char_length(v_title) < 2 then
    raise exception 'Batch title must be at least 2 characters.' using errcode = '22023';
  end if;

  if not coalesce(p_allow_pending, false) then
    select
      (select count(*) from public.contributions c where c.group_id = p_group_id and c.approval_status = 'PENDING')
      + (select count(*) from public.withdrawals w where w.group_id = p_group_id and w.approval_status = 'PENDING')
      + (select count(*) from public.expenses e where e.group_id = p_group_id and e.approval_status = 'PENDING')
    into v_pending;

    if coalesce(v_pending, 0) > 0 then
      raise exception 'Review or resolve all pending transactions before finishing and resetting this savings batch.' using errcode = 'P0001';
    end if;
  end if;

  select
    coalesce((select sum(c.amount) from public.contributions c where c.group_id = p_group_id and c.approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    coalesce((select sum(w.amount) from public.withdrawals w where w.group_id = p_group_id and w.approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    coalesce((select sum(e.amount) from public.expenses e where e.group_id = p_group_id and e.approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    (select count(*) from public.contributions c where c.group_id = p_group_id)
      + (select count(*) from public.withdrawals w where w.group_id = p_group_id)
      + (select count(*) from public.expenses e where e.group_id = p_group_id),
    (select count(*) from public.contribution_periods cp where cp.group_id = p_group_id),
    (select cycle_start_date from public.groups where id = p_group_id)
  into v_add, v_ded, v_exp, v_records_count, v_periods_count, v_prev_cycle_start;

  select min(dt), max(dt)
  into v_period_start, v_period_end
  from (
    select c.payment_date as dt from public.contributions c where c.group_id = p_group_id
    union all
    select w.transaction_date as dt from public.withdrawals w where w.group_id = p_group_id
    union all
    select e.transaction_date as dt from public.expenses e where e.group_id = p_group_id
    union all
    select cp.period_month as dt from public.contribution_periods cp where cp.group_id = p_group_id
  ) dates;

  if coalesce(p_include_all_goals, false) then
    select coalesce(jsonb_agg(sg.id), '[]'::jsonb), count(*)
    into v_goal_ids, v_goals_count
    from public.savings_goals sg
    where sg.group_id = p_group_id
      and sg.deleted_at is null;
  elsif coalesce(p_include_completed_goals, false) then
    select coalesce(jsonb_agg(sg.id), '[]'::jsonb), count(*)
    into v_goal_ids, v_goals_count
    from public.savings_goals sg
    where sg.group_id = p_group_id
      and sg.deleted_at is null
      and sg.status in ('COMPLETED', 'CANCELLED');
  end if;

  if coalesce(v_records_count, 0) = 0
     and coalesce(v_periods_count, 0) = 0
     and coalesce(v_goals_count, 0) = 0
     and v_prev_cycle_start is null then
    raise exception 'No active savings records or contribution periods found to reset.' using errcode = 'P0002';
  end if;

  perform set_config('ipon.maintenance_bin_snapshot', 'on', true);

  if coalesce(v_records_count, 0) > 0 or coalesce(v_periods_count, 0) > 0 then
    select coalesce(jsonb_agg(to_jsonb(cp) order by cp.period_month, cp.created_at), '[]'::jsonb)
    into v_periods_json
    from public.contribution_periods cp
    where cp.group_id = p_group_id;

    select coalesce(jsonb_agg(to_jsonb(c) order by c.payment_date, c.created_at), '[]'::jsonb)
    into v_contribs_json
    from public.contributions c
    where c.group_id = p_group_id;

    select coalesce(jsonb_agg(to_jsonb(w) order by w.transaction_date, w.created_at), '[]'::jsonb)
    into v_withdrawals_json
    from public.withdrawals w
    where w.group_id = p_group_id;

    select coalesce(jsonb_agg(to_jsonb(e) order by e.transaction_date, e.created_at), '[]'::jsonb)
    into v_expenses_json
    from public.expenses e
    where e.group_id = p_group_id;

    select coalesce(jsonb_agg(to_jsonb(rc) order by rc.created_at), '[]'::jsonb)
    into v_comments_json
    from public.record_comments rc
    where rc.group_id = p_group_id
      and (
        (rc.record_type = 'contribution' and exists (select 1 from public.contributions c where c.id = rc.record_id and c.group_id = p_group_id))
        or (rc.record_type = 'withdrawal' and exists (select 1 from public.withdrawals w where w.id = rc.record_id and w.group_id = p_group_id))
        or (rc.record_type = 'expense' and exists (select 1 from public.expenses e where e.id = rc.record_id and e.group_id = p_group_id))
      );

    insert into public.savings_cycle_batches (
      group_id, title, notes, period_start, period_end,
      total_additions, total_deductions, total_expenses,
      records_count, periods_count, goals_binned_count,
      snapshot, deleted_at, deleted_by, expires_at
    ) values (
      p_group_id,
      v_title,
      coalesce(v_reason, 'Finished savings cycle cleared to 30-day recycle bin'),
      v_period_start,
      v_period_end,
      v_add,
      v_ded,
      v_exp,
      v_records_count,
      v_periods_count,
      v_goals_count,
      jsonb_build_object(
        'previous_cycle_start_date', v_prev_cycle_start,
        'contribution_periods', v_periods_json,
        'contributions', v_contribs_json,
        'withdrawals', v_withdrawals_json,
        'expenses', v_expenses_json,
        'record_comments', v_comments_json,
        'goal_ids', v_goal_ids
      ),
      now(),
      p_actor_id,
      v_expires_at
    )
    returning id into v_batch_id;

    delete from public.record_comments rc
    where rc.group_id = p_group_id
      and (
        (rc.record_type = 'contribution' and exists (select 1 from public.contributions c where c.id = rc.record_id and c.group_id = p_group_id))
        or (rc.record_type = 'withdrawal' and exists (select 1 from public.withdrawals w where w.id = rc.record_id and w.group_id = p_group_id))
        or (rc.record_type = 'expense' and exists (select 1 from public.expenses e where e.id = rc.record_id and e.group_id = p_group_id))
      );

    delete from public.contributions where group_id = p_group_id;
    delete from public.withdrawals where group_id = p_group_id;
    delete from public.expenses where group_id = p_group_id;
    delete from public.contribution_periods where group_id = p_group_id;

    insert into public.audit_logs (group_id, table_name, record_id, action, new_data, changed_by)
    values (
      p_group_id,
      'savings_cycle_batches',
      v_batch_id,
      'DELETE',
      jsonb_build_object(
        'title', v_title,
        'net_savings', (v_add - v_ded - v_exp),
        'records_count', v_records_count,
        'periods_count', v_periods_count,
        'goals_binned_count', v_goals_count,
        'expires_at', v_expires_at
      ),
      p_actor_id
    );
  end if;

  if coalesce(v_goals_count, 0) > 0 then
    update public.savings_goals
    set deleted_at = now(),
        deleted_by = p_actor_id,
        delete_reason = coalesce(v_reason, 'Cleared with finished savings batch "' || v_title || '"'),
        updated_by = coalesce(p_actor_id, updated_by)
    where group_id = p_group_id
      and id = any(array(select (jsonb_array_elements_text(v_goal_ids))::uuid));
  end if;

  update public.groups
  set cycle_start_date = null,
      savings_inactivity_reminded_at = null,
      savings_retention_warned_at = null
  where id = p_group_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'title', v_title,
    'net_savings', (v_add - v_ded - v_exp),
    'records_count', v_records_count,
    'periods_count', v_periods_count,
    'goals_binned_count', v_goals_count,
    'expires_at', v_expires_at
  );
end;
$$;

revoke execute on function public.snapshot_and_clear_group_savings_to_bin(uuid, text, text, uuid, boolean, boolean, boolean) from public, anon, authenticated;

create or replace function public.archive_and_reset_savings_cycle(
  p_title text default null,
  p_reason text default null,
  p_include_completed_goals boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can finish and reset the savings batch.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  return public.snapshot_and_clear_group_savings_to_bin(
    v_group_id,
    p_title,
    p_reason,
    auth.uid(),
    coalesce(p_include_completed_goals, false),
    false,
    false
  );
end;
$$;

revoke execute on function public.archive_and_reset_savings_cycle(text, text, boolean) from public, anon;
grant execute on function public.archive_and_reset_savings_cycle(text, text, boolean) to authenticated;

-- 4. Dormant savings reminder (3m) + final 7-day warning (6m) + automatic move to 30d Bin
create or replace function public.collect_dormant_savings_groups(
  p_remind_days integer default 90,
  p_inactive_months integer default 6,
  p_warning_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_remind_span interval := make_interval(days => greatest(coalesce(p_remind_days, 90), 30));
  v_inactive_span interval := make_interval(months => greatest(coalesce(p_inactive_months, 6), 2));
  v_warning_span interval := make_interval(days => greatest(coalesce(p_warning_days, 7), 1));
  v_remind_cutoff timestamptz := now() - v_remind_span;
  v_warn_cutoff timestamptz := now() - (v_inactive_span - v_warning_span);
  v_reminder_groups jsonb := '[]'::jsonb;
  v_warn_groups jsonb := '[]'::jsonb;
  v_bin_groups jsonb := '[]'::jsonb;
begin
  -- Clear stale reminder/warning flags immediately whenever a deposit, transaction, or goal edit happens, or if no active data remains
  update public.groups g
  set savings_inactivity_reminded_at = null,
      savings_retention_warned_at = null
  where (g.savings_inactivity_reminded_at is not null or g.savings_retention_warned_at is not null)
    and (
      not (
        exists (select 1 from public.contributions c where c.group_id = g.id)
        or exists (select 1 from public.withdrawals w where w.group_id = g.id)
        or exists (select 1 from public.expenses e where e.group_id = g.id)
        or exists (select 1 from public.savings_goals sg where sg.group_id = g.id and sg.deleted_at is null)
      )
      or public.group_last_savings_activity_at(g.id) > least(
        coalesce(g.savings_inactivity_reminded_at, 'infinity'::timestamptz),
        coalesce(g.savings_retention_warned_at, 'infinity'::timestamptz)
      )
    );

  -- Groups ready to move into 30-day Bin (warned >= 7 days ago and still zero new deposits/goal activity)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_id', g.id,
        'group_name', g.name,
        'warned_at', g.savings_retention_warned_at
      )
    ),
    '[]'::jsonb
  )
  into v_bin_groups
  from public.groups g
  where g.savings_retention_warned_at is not null
    and g.savings_retention_warned_at <= now() - v_warning_span
    and (
      exists (select 1 from public.contributions c where c.group_id = g.id)
      or exists (select 1 from public.withdrawals w where w.group_id = g.id)
      or exists (select 1 from public.expenses e where e.group_id = g.id)
      or exists (select 1 from public.savings_goals sg where sg.group_id = g.id and sg.deleted_at is null)
    )
    and public.group_last_savings_activity_at(g.id) <= g.savings_retention_warned_at;

  -- Final 7-day warning emails (6 months - 7 days with zero deposits/goal updates)
  with due_warn as (
    select g.id, g.name, public.group_last_savings_activity_at(g.id) as last_act
    from public.groups g
    where g.savings_retention_warned_at is null
      and (
        exists (select 1 from public.contributions c where c.group_id = g.id)
        or exists (select 1 from public.withdrawals w where w.group_id = g.id)
        or exists (select 1 from public.expenses e where e.group_id = g.id)
        or exists (select 1 from public.savings_goals sg where sg.group_id = g.id and sg.deleted_at is null)
      )
      and public.group_last_savings_activity_at(g.id) > 'epoch'::timestamptz
      and public.group_last_savings_activity_at(g.id) <= v_warn_cutoff
  ),
  stamped_warn as (
    update public.groups g
    set savings_retention_warned_at = now()
    from due_warn dw
    where g.id = dw.id
    returning dw.id as group_id, dw.name as group_name, dw.last_act as last_activity_at, (now() + v_warning_span) as scheduled_bin_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_id', sw.group_id,
        'group_name', sw.group_name,
        'last_activity_at', sw.last_activity_at,
        'scheduled_bin_at', sw.scheduled_bin_at,
        'recipients', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'user_id', rec.user_id,
              'email', rec.email,
              'full_name', rec.full_name
            )
          )
          from (
            select distinct on (p.id)
              p.id as user_id,
              coalesce(nullif(btrim(p.email), ''), u.email) as email,
              coalesce(nullif(btrim(p.full_name), ''), 'Saver') as full_name
            from public.profiles p
            join auth.users u on u.id = p.id
            left join public.group_memberships gm on gm.user_id = p.id and gm.group_id = sw.group_id
            where p.role <> 'SUPER_ADMIN'
              and (
                (p.group_id = sw.group_id and p.status = 'ACTIVE')
                or (gm.group_id = sw.group_id and gm.status = 'ACTIVE')
              )
              and coalesce(nullif(btrim(p.email), ''), u.email) like '%@%'
          ) rec
        ), '[]'::jsonb)
      )
    ),
    '[]'::jsonb
  )
  into v_warn_groups
  from stamped_warn sw;

  -- Early 3-month (90-day) nudge reminder emails before approaching the 6-month cutoff
  with due_remind as (
    select g.id, g.name, public.group_last_savings_activity_at(g.id) as last_act
    from public.groups g
    where g.savings_inactivity_reminded_at is null
      and g.savings_retention_warned_at is null
      and (
        exists (select 1 from public.contributions c where c.group_id = g.id)
        or exists (select 1 from public.withdrawals w where w.group_id = g.id)
        or exists (select 1 from public.expenses e where e.group_id = g.id)
        or exists (select 1 from public.savings_goals sg where sg.group_id = g.id and sg.deleted_at is null)
      )
      and public.group_last_savings_activity_at(g.id) <= v_remind_cutoff
      and public.group_last_savings_activity_at(g.id) > v_warn_cutoff
  ),
  stamped_remind as (
    update public.groups g
    set savings_inactivity_reminded_at = now()
    from due_remind dr
    where g.id = dr.id
    returning dr.id as group_id, dr.name as group_name, dr.last_act as last_activity_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'group_id', sr.group_id,
        'group_name', sr.group_name,
        'last_activity_at', sr.last_activity_at,
        'recipients', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'user_id', rec.user_id,
              'email', rec.email,
              'full_name', rec.full_name
            )
          )
          from (
            select distinct on (p.id)
              p.id as user_id,
              coalesce(nullif(btrim(p.email), ''), u.email) as email,
              coalesce(nullif(btrim(p.full_name), ''), 'Saver') as full_name
            from public.profiles p
            join auth.users u on u.id = p.id
            left join public.group_memberships gm on gm.user_id = p.id and gm.group_id = sr.group_id
            where p.role <> 'SUPER_ADMIN'
              and (
                (p.group_id = sr.group_id and p.status = 'ACTIVE')
                or (gm.group_id = sr.group_id and gm.status = 'ACTIVE')
              )
              and coalesce(nullif(btrim(p.email), ''), u.email) like '%@%'
          ) rec
        ), '[]'::jsonb)
      )
    ),
    '[]'::jsonb
  )
  into v_reminder_groups
  from stamped_remind sr;

  return jsonb_build_object(
    'reminder_groups', v_reminder_groups,
    'warn_groups', v_warn_groups,
    'bin_groups', v_bin_groups
  );
end;
$$;

revoke execute on function public.collect_dormant_savings_groups(integer, integer, integer) from public, anon, authenticated;

create or replace function public.reset_dormant_savings_flag(
  p_group_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(p_stage, '')) = 'reminder' then
    update public.groups set savings_inactivity_reminded_at = null where id = p_group_id;
  elsif lower(coalesce(p_stage, '')) = 'warning' then
    update public.groups set savings_retention_warned_at = null where id = p_group_id;
  end if;
end;
$$;

revoke execute on function public.reset_dormant_savings_flag(uuid, text) from public, anon, authenticated;

create or replace function public.move_dormant_savings_group_to_bin(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grp public.groups%rowtype;
  v_last_act timestamptz;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);
  perform set_config('ipon.maintenance_bin_snapshot', 'on', true);

  select * into v_grp from public.groups where id = p_group_id for update;
  if not found or v_grp.savings_retention_warned_at is null then
    return jsonb_build_object('moved', false);
  end if;

  v_last_act := public.group_last_savings_activity_at(p_group_id);
  if v_grp.savings_retention_warned_at > now() - interval '7 days'
     or v_last_act > v_grp.savings_retention_warned_at then
    return jsonb_build_object('moved', false);
  end if;

  return jsonb_build_object(
    'moved', true,
    'batch', public.snapshot_and_clear_group_savings_to_bin(
      p_group_id,
      'Dormant Savings Batch — ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD, YYYY'),
      'Automatically moved to bin after 6 months of no savings or goal activity (+ 7-day email notice)',
      null,
      false,
      true,
      true
    )
  );
end;
$$;

revoke execute on function public.move_dormant_savings_group_to_bin(uuid) from public, anon, authenticated;

-- 5. Align account inactivity check so active goals only exempt groups that actually still record savings or goal updates
create or replace function public.collect_inactive_account_candidates(
  p_inactive_months integer default 6,
  p_warning_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inactive_span interval := make_interval(months => greatest(coalesce(p_inactive_months, 6), 1));
  v_warning_span interval := make_interval(days => greatest(coalesce(p_warning_days, 7), 1));
  v_warn_cutoff timestamptz := now() - (v_inactive_span - v_warning_span);
  v_warn_candidates jsonb := '[]'::jsonb;
  v_purge_candidates jsonb := '[]'::jsonb;
begin
  update public.profiles p
  set inactivity_warned_at = null
  from auth.users u
  where u.id = p.id
    and p.inactivity_warned_at is not null
    and greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce(p.last_seen_at, p.created_at),
      coalesce((
        select max(c2.created_at)
        from public.contributions c2
        join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
        where cp2.member_id = p.member_id
          and c2.approval_status = 'CONFIRMED'
      ), 'epoch'::timestamptz)
    ) > p.inactivity_warned_at;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'email', coalesce(nullif(p.email, ''), u.email),
        'full_name', p.full_name,
        'inactivity_warned_at', p.inactivity_warned_at
      )
    ),
    '[]'::jsonb
  )
  into v_purge_candidates
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role <> 'SUPER_ADMIN'
    and p.inactivity_warned_at is not null
    and p.inactivity_warned_at <= now() - v_warning_span
    and greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce(p.last_seen_at, p.created_at),
      coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
      coalesce((
        select max(c2.created_at)
        from public.contributions c2
        join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
        where cp2.member_id = p.member_id
          and c2.approval_status = 'CONFIRMED'
      ), 'epoch'::timestamptz),
      coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
    ) <= p.inactivity_warned_at
    and not (
      p.group_id is not null
      and exists (
        select 1
        from public.savings_goals sg
        where sg.group_id = p.group_id
          and sg.deleted_at is null
          and sg.status = 'ACTIVE'
      )
      and public.group_last_savings_activity_at(p.group_id) > now() - v_inactive_span
    );

  with due_warn as (
    select p.id, coalesce(nullif(p.email, ''), u.email) as email, p.full_name,
           greatest(
             coalesce(u.last_sign_in_at, u.created_at),
             coalesce(p.last_seen_at, p.created_at),
             coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
             coalesce((
               select max(c2.created_at)
               from public.contributions c2
               join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
               where cp2.member_id = p.member_id
                 and c2.approval_status = 'CONFIRMED'
             ), 'epoch'::timestamptz),
             coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
           ) as last_active_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role <> 'SUPER_ADMIN'
      and p.inactivity_warned_at is null
      and not (
        p.group_id is not null
        and exists (
          select 1
          from public.savings_goals sg
          where sg.group_id = p.group_id
            and sg.deleted_at is null
            and sg.status = 'ACTIVE'
        )
        and public.group_last_savings_activity_at(p.group_id) > now() - v_inactive_span
      )
      and greatest(
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce(p.last_seen_at, p.created_at),
        coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
        coalesce((
          select max(c2.created_at)
          from public.contributions c2
          join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
          where cp2.member_id = p.member_id
            and c2.approval_status = 'CONFIRMED'
        ), 'epoch'::timestamptz),
        coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
      ) <= v_warn_cutoff
  ),
  stamped as (
    update public.profiles p
    set inactivity_warned_at = now()
    from due_warn dw
    where p.id = dw.id
    returning dw.id as user_id, dw.email, dw.full_name, dw.last_active_at, (now() + v_warning_span) as scheduled_purge_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', s.user_id,
        'email', s.email,
        'full_name', s.full_name,
        'last_active_at', s.last_active_at,
        'scheduled_purge_at', s.scheduled_purge_at
      )
    ),
    '[]'::jsonb
  )
  into v_warn_candidates
  from stamped s;

  return jsonb_build_object(
    'warn_candidates', v_warn_candidates,
    'purge_candidates', v_purge_candidates
  );
end;
$$;

revoke execute on function public.collect_inactive_account_candidates(integer, integer) from public, anon, authenticated;

-- 6. Clean up truly abandoned empty suspended groups after all binned savings/batches expire
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
  where coalesce(ended_at, started_at, created_at) < v_call_cutoff;
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

  delete from public.groups g
  where g.status = 'SUSPENDED'
    and g.owner_id is null
    and g.updated_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.group_id = g.id)
    and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
    and not exists (select 1 from public.expenses e where e.group_id = g.id)
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

insert into public.schema_migrations (version, name)
values ('20261116_085', 'abandoned savings email reminders and 6-month dormant savings retention into 30-day bin')
on conflict (version) do nothing;

commit;
