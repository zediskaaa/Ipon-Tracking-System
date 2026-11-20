-- Migration 141: Savings goal schedules (daily/weekly/monthly), carry-over/credit tracking, and unpaid goal reminders
begin;

alter table public.savings_goals
  add column if not exists saving_frequency text not null default 'NONE',
  add column if not exists scheduled_amount numeric(14,2),
  add column if not exists schedule_start_date date,
  add column if not exists schedule_baseline_amount numeric(14,2) not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'savings_goals_saving_frequency_check'
      and conrelid = 'public.savings_goals'::regclass
  ) then
    alter table public.savings_goals
      add constraint savings_goals_saving_frequency_check
      check (saving_frequency in ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'savings_goals_scheduled_amount_check'
      and conrelid = 'public.savings_goals'::regclass
  ) then
    alter table public.savings_goals
      add constraint savings_goals_scheduled_amount_check
      check (scheduled_amount is null or (scheduled_amount > 0 and scheduled_amount <= 999999999999.99));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'savings_goals_schedule_baseline_check'
      and conrelid = 'public.savings_goals'::regclass
  ) then
    alter table public.savings_goals
      add constraint savings_goals_schedule_baseline_check
      check (schedule_baseline_amount >= 0 and schedule_baseline_amount <= 999999999999.99);
  end if;
end $$;

create or replace function public.group_tracked_savings(p_group_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  with grp as (
    select g.id, g.cycle_start_date
    from public.groups g
    where g.id = p_group_id
  ),
  archived_cycle as (
    select
      coalesce(sum(a.total_additions), 0) as add_amt,
      coalesce(sum(a.total_deductions), 0) as ded_amt,
      coalesce(sum(a.total_expenses), 0) as exp_amt
    from public.financial_annual_archives a
    join grp on grp.id = a.group_id
    where grp.cycle_start_date is null or make_date(a.archive_year, 12, 31) >= grp.cycle_start_date
  )
  select coalesce((
    (select coalesce(sum(c.amount), 0)
     from public.contributions c
     join grp on c.group_id = grp.id
     where c.approval_status = 'CONFIRMED'
       and (grp.cycle_start_date is null or c.payment_date >= grp.cycle_start_date))
    + (select add_amt from archived_cycle)
    - (select coalesce(sum(w.amount), 0)
       from public.withdrawals w
       join grp on w.group_id = grp.id
       where w.approval_status = 'CONFIRMED'
         and (grp.cycle_start_date is null or w.transaction_date >= grp.cycle_start_date))
    - (select ded_amt from archived_cycle)
    - (select coalesce(sum(e.amount), 0)
       from public.expenses e
       join grp on e.group_id = grp.id
       where e.approval_status = 'CONFIRMED'
         and (grp.cycle_start_date is null or e.transaction_date >= grp.cycle_start_date))
    - (select exp_amt from archived_cycle)
  ), 0)::numeric(14,2);
$$;

revoke all on function public.group_tracked_savings(uuid) from public, anon, authenticated;

drop function if exists public.save_savings_goal(uuid, text, numeric, date, public.goal_status, text);
drop function if exists public.save_savings_goal(uuid, text, numeric, date, public.goal_status, text, text, numeric, date);

create or replace function public.save_savings_goal(
  p_goal_id uuid,
  p_title text,
  p_target_amount numeric,
  p_target_date date,
  p_status public.goal_status,
  p_notes text default null,
  p_saving_frequency text default 'NONE',
  p_scheduled_amount numeric default null,
  p_schedule_start_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_id uuid;
  v_group_id uuid := public.current_group_id();
  v_freq text := upper(coalesce(nullif(btrim(p_saving_frequency), ''), 'NONE'));
  v_sched_amt numeric(14,2) := null;
  v_start_date date := null;
  v_baseline numeric(14,2) := 0;
  v_existing record;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an administrator can manage goals.' using errcode = '42501';
  end if;

  if v_freq not in ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY') then
    raise exception 'Saving schedule must be None, Daily, Weekly, or Monthly.' using errcode = '22023';
  end if;

  if v_freq <> 'NONE' then
    v_sched_amt := public.validated_money(p_scheduled_amount, 'Scheduled deposit');
  end if;

  if p_goal_id is null then
    if v_freq <> 'NONE' then
      v_start_date := coalesce(p_schedule_start_date, current_date);
      v_baseline := greatest(0, public.group_tracked_savings(v_group_id));
    end if;

    insert into public.savings_goals (
      group_id,
      title,
      target_amount,
      target_date,
      status,
      completed_at,
      notes,
      saving_frequency,
      scheduled_amount,
      schedule_start_date,
      schedule_baseline_amount,
      created_by,
      updated_by
    )
    values (
      v_group_id,
      btrim(p_title),
      public.validated_money(p_target_amount, 'Target amount'),
      p_target_date,
      p_status,
      case when p_status = 'COMPLETED' then now() else null end,
      nullif(btrim(p_notes), ''),
      v_freq,
      v_sched_amt,
      v_start_date,
      v_baseline,
      auth.uid(),
      auth.uid()
    )
    returning id into v_id;
  else
    select saving_frequency, schedule_start_date, schedule_baseline_amount
    into v_existing
    from public.savings_goals
    where id = p_goal_id
      and group_id = v_group_id
      and deleted_at is null;

    if not found then
      raise exception 'Savings goal not found.' using errcode = 'P0002';
    end if;

    if v_freq <> 'NONE' then
      if coalesce(v_existing.saving_frequency, 'NONE') = 'NONE'
         or v_existing.saving_frequency is distinct from v_freq
         or (p_schedule_start_date is not null and p_schedule_start_date is distinct from v_existing.schedule_start_date) then
        v_start_date := coalesce(p_schedule_start_date, current_date);
        v_baseline := greatest(0, public.group_tracked_savings(v_group_id));
      else
        v_start_date := coalesce(v_existing.schedule_start_date, current_date);
        v_baseline := coalesce(v_existing.schedule_baseline_amount, 0);
      end if;
    else
      v_start_date := null;
      v_baseline := 0;
    end if;

    update public.savings_goals
    set title = btrim(p_title),
        target_amount = public.validated_money(p_target_amount, 'Target amount'),
        target_date = p_target_date,
        status = p_status,
        completed_at = case
          when p_status = 'COMPLETED' then coalesce(completed_at, now())
          when p_status = 'ACTIVE' then null
          else completed_at
        end,
        notes = nullif(btrim(p_notes), ''),
        saving_frequency = v_freq,
        scheduled_amount = v_sched_amt,
        schedule_start_date = v_start_date,
        schedule_baseline_amount = v_baseline,
        updated_by = auth.uid()
    where id = p_goal_id
      and group_id = v_group_id
      and deleted_at is null
    returning id into v_id;

    if v_id is null then
      raise exception 'Savings goal not found.' using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.save_savings_goal(uuid, text, numeric, date, public.goal_status, text, text, numeric, date) from public, anon;
grant execute on function public.save_savings_goal(uuid, text, numeric, date, public.goal_status, text, text, numeric, date) to authenticated;

create or replace function public.sync_my_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_uid uuid := auth.uid();
  v_schedule jsonb := '[]'::jsonb;
  v_goal_schedule jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'ACTIVE' and notifications_enabled
  ) then
    return '[]'::jsonb;
  end if;

  with my_memberships as (
    select distinct member_id
    from (
      select gm.member_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.member_id from public.profiles p where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select v_uid,
         cp.group_id,
         'CONTRIBUTION_REMINDER',
         'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.',
         'user.html?reminder=' || to_char(cp.period_month, 'YYYY-MM')
  from public.contribution_periods cp
  join my_memberships mm on mm.member_id = cp.member_id
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = v_uid
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from cp.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );

  -- Unpaid scheduled savings goal reminders (daily / weekly / monthly with carry-over)
  with my_groups as (
    select group_id,
           max(case when role = 'ADMIN' then 3 when role = 'TREASURER' then 2 else 1 end) as role_rank
    from (
      select gm.group_id, gm.role::text as role
      from public.group_memberships gm
      where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.group_id is not null
      union all
      select p.group_id, p.role::text as role
      from public.profiles p
      where p.id = v_uid and p.status = 'ACTIVE' and p.group_id is not null
    ) s
    group by group_id
  ),
  goal_eval as (
    select
      sg.id as goal_id,
      sg.group_id,
      g.name as group_name,
      mg.role_rank,
      sg.title,
      sg.target_amount,
      sg.saving_frequency,
      sg.scheduled_amount,
      coalesce(sg.schedule_start_date, (sg.created_at at time zone 'Asia/Manila')::date) as start_date,
      coalesce(sg.schedule_baseline_amount, 0) as baseline_amount,
      greatest(0, public.group_tracked_savings(sg.group_id)) as tracked_savings
    from public.savings_goals sg
    join my_groups mg on mg.group_id = sg.group_id
    join public.groups g on g.id = sg.group_id and g.status = 'ACTIVE'
    where sg.deleted_at is null
      and sg.status = 'ACTIVE'
      and sg.saving_frequency in ('DAILY', 'WEEKLY', 'MONTHLY')
      and sg.scheduled_amount is not null
      and sg.scheduled_amount > 0
  ),
  goal_calc as (
    select
      ge.*,
      greatest(0, ge.target_amount - ge.tracked_savings) as remaining_to_target,
      greatest(0, ge.tracked_savings - ge.baseline_amount) as paid_since_start,
      case
        when current_date < ge.start_date then 0
        when ge.saving_frequency = 'DAILY' then (current_date - ge.start_date) + 1
        when ge.saving_frequency = 'WEEKLY' then floor((current_date - ge.start_date) / 7.0)::int + 1
        else greatest(1,
          (extract(year from current_date)::int - extract(year from ge.start_date)::int) * 12
          + (extract(month from current_date)::int - extract(month from ge.start_date)::int)
          + case
              when extract(day from current_date)::int >= least(
                extract(day from ge.start_date)::int,
                extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int
              ) then 1
              else 0
            end
        )
      end as elapsed_periods
    from goal_eval ge
  ),
  goal_due as (
    select
      gc.*,
      least(
        gc.remaining_to_target,
        greatest(
          0,
          round(
            least(greatest(0, gc.target_amount - gc.baseline_amount), gc.elapsed_periods * gc.scheduled_amount)
            - gc.paid_since_start,
            2
          )
        )
      ) as due_now,
      greatest(
        0,
        round(
          gc.paid_since_start
          - least(greatest(0, gc.target_amount - gc.baseline_amount), gc.elapsed_periods * gc.scheduled_amount),
          2
        )
      ) as credit_ahead
    from goal_calc gc
    where gc.remaining_to_target > 0
      and gc.elapsed_periods >= 1
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
  select
    v_uid,
    gd.group_id,
    'GOAL_REMINDER',
    case when gd.due_now > gd.scheduled_amount then 'Unpaid savings goal carry-over' else 'Savings goal deposit due' end,
    'Your ' || lower(gd.saving_frequency) || ' deposit for "' || gd.title || '" is unpaid. Due now: PHP '
      || trim(to_char(gd.due_now, 'FM999,999,999,990.00'))
      || case
           when gd.due_now > gd.scheduled_amount then
             ' (includes PHP ' || trim(to_char(round(gd.due_now - gd.scheduled_amount, 2), 'FM999,999,999,990.00')) || ' unpaid carry-over)'
           else ''
         end
      || '.',
    case when gd.role_rank = 1 then 'user.html?goal_due=' || gd.goal_id::text else 'dashboard.html?record_goal=' || gd.goal_id::text end,
    'GOAL_REMINDER:' || gd.goal_id::text || ':' ||
      case
        when gd.saving_frequency = 'DAILY' then to_char(current_date, 'YYYY-MM-DD')
        when gd.saving_frequency = 'WEEKLY' then gd.start_date::text || ':W' || gd.elapsed_periods::text
        else gd.start_date::text || ':M' || gd.elapsed_periods::text
      end
  from goal_due gd
  where gd.due_now > 0
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;

  with my_memberships as (
    select distinct member_id
    from (
      select gm.member_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.member_id from public.profiles p where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', 'CONTRIBUTION',
    'period_id', cp.id,
    'group_id', cp.group_id,
    'group_name', g.name,
    'period_month', cp.period_month,
    'period_label', to_char(cp.period_month, 'FMMonth YYYY'),
    'due_date', cp.due_date,
    'outstanding_amount', vcs.outstanding_amount
  ) order by cp.due_date asc), '[]'::jsonb)
  into v_schedule
  from public.contribution_periods cp
  join my_memberships mm on mm.member_id = cp.member_id
  join public.groups g on g.id = cp.group_id and g.status = 'ACTIVE'
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 14
    and vcs.outstanding_amount > 0;

  with my_groups as (
    select group_id,
           max(case when role = 'ADMIN' then 3 when role = 'TREASURER' then 2 else 1 end) as role_rank
    from (
      select gm.group_id, gm.role::text as role
      from public.group_memberships gm
      where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.group_id is not null
      union all
      select p.group_id, p.role::text as role
      from public.profiles p
      where p.id = v_uid and p.status = 'ACTIVE' and p.group_id is not null
    ) s
    group by group_id
  ),
  goal_eval as (
    select
      sg.id as goal_id,
      sg.group_id,
      g.name as group_name,
      mg.role_rank,
      sg.title,
      sg.target_amount,
      sg.saving_frequency,
      sg.scheduled_amount,
      coalesce(sg.schedule_start_date, (sg.created_at at time zone 'Asia/Manila')::date) as start_date,
      coalesce(sg.schedule_baseline_amount, 0) as baseline_amount,
      greatest(0, public.group_tracked_savings(sg.group_id)) as tracked_savings
    from public.savings_goals sg
    join my_groups mg on mg.group_id = sg.group_id
    join public.groups g on g.id = sg.group_id and g.status = 'ACTIVE'
    where sg.deleted_at is null
      and sg.status = 'ACTIVE'
      and sg.saving_frequency in ('DAILY', 'WEEKLY', 'MONTHLY')
      and sg.scheduled_amount is not null
      and sg.scheduled_amount > 0
  ),
  goal_calc as (
    select
      ge.*,
      greatest(0, ge.target_amount - ge.tracked_savings) as remaining_to_target,
      greatest(0, ge.tracked_savings - ge.baseline_amount) as paid_since_start,
      case
        when current_date < ge.start_date then 0
        when ge.saving_frequency = 'DAILY' then (current_date - ge.start_date) + 1
        when ge.saving_frequency = 'WEEKLY' then floor((current_date - ge.start_date) / 7.0)::int + 1
        else greatest(1,
          (extract(year from current_date)::int - extract(year from ge.start_date)::int) * 12
          + (extract(month from current_date)::int - extract(month from ge.start_date)::int)
          + case
              when extract(day from current_date)::int >= least(
                extract(day from ge.start_date)::int,
                extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int
              ) then 1
              else 0
            end
        )
      end as elapsed_periods
    from goal_eval ge
  ),
  goal_next as (
    select
      gc.*,
      least(
        gc.remaining_to_target,
        greatest(
          0,
          round(
            least(greatest(0, gc.target_amount - gc.baseline_amount), gc.elapsed_periods * gc.scheduled_amount)
            - gc.paid_since_start,
            2
          )
        )
      ) as due_now,
      greatest(
        0,
        round(
          gc.paid_since_start
          - least(greatest(0, gc.target_amount - gc.baseline_amount), gc.elapsed_periods * gc.scheduled_amount),
          2
        )
      ) as credit_ahead
    from goal_calc gc
    where gc.remaining_to_target > 0
  ),
  goal_upcoming as (
    select
      gn.*,
      case
        when gn.elapsed_periods = 0 then gn.start_date
        when gn.saving_frequency = 'DAILY' then gn.start_date + (gn.elapsed_periods + floor(gn.credit_ahead / gn.scheduled_amount)::int)
        when gn.saving_frequency = 'WEEKLY' then gn.start_date + ((gn.elapsed_periods + floor(gn.credit_ahead / gn.scheduled_amount)::int) * 7)
        else (gn.start_date + ((gn.elapsed_periods + floor(gn.credit_ahead / gn.scheduled_amount)::int)::text || ' months')::interval)::date
      end as next_due_date,
      case
        when gn.due_now > 0 then least(gn.remaining_to_target, round(gn.due_now + gn.scheduled_amount, 2))
        else least(
          gn.remaining_to_target,
          greatest(0.01, round(gn.scheduled_amount - (gn.credit_ahead - floor(gn.credit_ahead / gn.scheduled_amount) * gn.scheduled_amount), 2))
        )
      end as next_due_amount
    from goal_next gn
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', 'GOAL',
    'goal_id', gu.goal_id,
    'group_id', gu.group_id,
    'group_name', gu.group_name,
    'goal_title', gu.title,
    'saving_frequency', gu.saving_frequency,
    'due_date', gu.next_due_date,
    'outstanding_amount', gu.next_due_amount,
    'link', case when gu.role_rank = 1 then 'user.html?goal_due=' || gu.goal_id::text else 'dashboard.html?record_goal=' || gu.goal_id::text end
  ) order by gu.next_due_date asc), '[]'::jsonb)
  into v_goal_schedule
  from goal_upcoming gu
  where gu.next_due_date between current_date and current_date + 14;

  return coalesce(v_schedule, '[]'::jsonb) || coalesce(v_goal_schedule, '[]'::jsonb);
end;
$$;

revoke execute on function public.sync_my_due_reminders() from public, anon;
grant execute on function public.sync_my_due_reminders() to authenticated;

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_count integer := 0;
  v_goal_count integer := 0;
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

  with group_users as (
    select u.user_id,
           u.group_id,
           max(case when u.role = 'ADMIN' then 3 when u.role = 'TREASURER' then 2 else 1 end) as role_rank
    from (
      select gm.user_id, gm.group_id, gm.role::text as role
      from public.group_memberships gm
      where gm.status = 'ACTIVE' and gm.group_id is not null
      union all
      select p.id as user_id, p.group_id, p.role::text as role
      from public.profiles p
      where p.status = 'ACTIVE' and p.group_id is not null
    ) u
    join public.profiles p on p.id = u.user_id
    where p.status = 'ACTIVE' and p.notifications_enabled
    group by u.user_id, u.group_id
  ),
  goal_eval as (
    select
      sg.id as goal_id,
      sg.group_id,
      sg.title,
      sg.target_amount,
      sg.saving_frequency,
      sg.scheduled_amount,
      coalesce(sg.schedule_start_date, (sg.created_at at time zone 'Asia/Manila')::date) as start_date,
      coalesce(sg.schedule_baseline_amount, 0) as baseline_amount,
      greatest(0, public.group_tracked_savings(sg.group_id)) as tracked_savings
    from public.savings_goals sg
    join public.groups g on g.id = sg.group_id and g.status = 'ACTIVE'
    where sg.deleted_at is null
      and sg.status = 'ACTIVE'
      and sg.saving_frequency in ('DAILY', 'WEEKLY', 'MONTHLY')
      and sg.scheduled_amount is not null
      and sg.scheduled_amount > 0
  ),
  goal_calc as (
    select
      ge.*,
      greatest(0, ge.target_amount - ge.tracked_savings) as remaining_to_target,
      greatest(0, ge.tracked_savings - ge.baseline_amount) as paid_since_start,
      case
        when current_date < ge.start_date then 0
        when ge.saving_frequency = 'DAILY' then (current_date - ge.start_date) + 1
        when ge.saving_frequency = 'WEEKLY' then floor((current_date - ge.start_date) / 7.0)::int + 1
        else greatest(1,
          (extract(year from current_date)::int - extract(year from ge.start_date)::int) * 12
          + (extract(month from current_date)::int - extract(month from ge.start_date)::int)
          + case
              when extract(day from current_date)::int >= least(
                extract(day from ge.start_date)::int,
                extract(day from (date_trunc('month', current_date) + interval '1 month - 1 day'))::int
              ) then 1
              else 0
            end
        )
      end as elapsed_periods
    from goal_eval ge
  ),
  goal_due as (
    select
      gc.*,
      least(
        gc.remaining_to_target,
        greatest(
          0,
          round(
            least(greatest(0, gc.target_amount - gc.baseline_amount), gc.elapsed_periods * gc.scheduled_amount)
            - gc.paid_since_start,
            2
          )
        )
      ) as due_now
    from goal_calc gc
    where gc.remaining_to_target > 0
      and gc.elapsed_periods >= 1
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
  select
    gu.user_id,
    gd.group_id,
    'GOAL_REMINDER',
    case when gd.due_now > gd.scheduled_amount then 'Unpaid savings goal carry-over' else 'Savings goal deposit due' end,
    'Your ' || lower(gd.saving_frequency) || ' deposit for "' || gd.title || '" is unpaid. Due now: PHP '
      || trim(to_char(gd.due_now, 'FM999,999,999,990.00'))
      || case
           when gd.due_now > gd.scheduled_amount then
             ' (includes PHP ' || trim(to_char(round(gd.due_now - gd.scheduled_amount, 2), 'FM999,999,999,990.00')) || ' unpaid carry-over)'
           else ''
         end
      || '.',
    case when gu.role_rank = 1 then 'user.html?goal_due=' || gd.goal_id::text else 'dashboard.html?record_goal=' || gd.goal_id::text end,
    'GOAL_REMINDER:' || gd.goal_id::text || ':' ||
      case
        when gd.saving_frequency = 'DAILY' then to_char(current_date, 'YYYY-MM-DD')
        when gd.saving_frequency = 'WEEKLY' then gd.start_date::text || ':W' || gd.elapsed_periods::text
        else gd.start_date::text || ':M' || gd.elapsed_periods::text
      end
  from goal_due gd
  join group_users gu on gu.group_id = gd.group_id
  where gd.due_now > 0
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;

  get diagnostics v_goal_count = row_count;
  return coalesce(v_count, 0) + coalesce(v_goal_count, 0);
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261120_141', 'savings_goal_schedules_and_reminders')
on conflict (version) do nothing;

commit;
