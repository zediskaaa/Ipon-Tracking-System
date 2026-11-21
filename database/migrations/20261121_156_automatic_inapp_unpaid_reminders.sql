-- Migration 156: Automatic in-app unpaid reminders for all unpaid, partial, and overdue members
-- Ensures current-month contribution periods exist automatically, generates daily deduplicated
-- in-app CONTRIBUTION_REMINDER and GOAL_REMINDER notifications (strictly app notifications, no email),
-- and skips exempt periods or periods already covered by a pending submission awaiting review.

begin;

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
               and gm.group_id = old.group_id
               and gm.status = 'ACTIVE'
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
      if current_setting('ipon.sync_due_periods', true) = 'on' then
        select group_id into v_row_group from public.members where id = new.member_id;
        new.group_id := v_row_group;
        return new;
      end if;
    end if;

    -- Verified SECURITY DEFINER workspace creation inserting initial schedule, creator member, or first period
    if tg_table_name in ('contribution_settings', 'members', 'contribution_periods')
       and pg_trigger_depth() <= 1
       and auth.uid() is not null
       and nullif(current_setting('ipon.creating_group_id', true), '') is not null then
      if tg_table_name in ('contribution_settings', 'members')
         and current_setting('ipon.creating_group_id', true) = new.group_id::text then
        return new;
      elsif tg_table_name = 'contribution_periods' then
        select group_id into v_row_group from public.members where id = new.member_id;
        if current_setting('ipon.creating_group_id', true) = v_row_group::text then
          new.group_id := v_row_group;
          return new;
        end if;
      end if;
    end if;

    -- Verified SECURITY DEFINER invite-code join inserting member slot or initial period
    if tg_table_name in ('members', 'contribution_periods')
       and pg_trigger_depth() <= 1
       and auth.uid() is not null
       and nullif(current_setting('ipon.joining_group_id', true), '') is not null then
      if tg_table_name = 'members'
         and current_setting('ipon.joining_group_id', true) = new.group_id::text then
        return new;
      elsif tg_table_name = 'contribution_periods' then
        select group_id into v_row_group from public.members where id = new.member_id;
        if current_setting('ipon.joining_group_id', true) = v_row_group::text then
          new.group_id := v_row_group;
          return new;
        end if;
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

create or replace function public.sync_my_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_uid uuid := auth.uid();
  v_current_month date := date_trunc('month', current_date)::date;
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

  -- Auto-ensure current-month contribution periods exist for this user's active member slots
  perform set_config('ipon.sync_due_periods', 'on', true);

  with my_memberships as (
    select member_id,
           max(case when role = 'ADMIN' then 3 when role = 'TREASURER' then 2 else 1 end) as role_rank
    from (
      select gm.member_id, gm.role::text as role
      from public.group_memberships gm
      where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union all
      select p.member_id, p.role::text as role
      from public.profiles p
      where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
    group by member_id
  )
  insert into public.contribution_periods (member_id, group_id, period_month, required_amount, due_date)
  select m.id,
         m.group_id,
         v_current_month,
         coalesce(
           nullif(m.monthly_contribution_amount, 0),
           (select cs.default_amount
            from public.contribution_settings cs
            where cs.group_id = m.group_id
              and cs.effective_month <= v_current_month
            order by cs.effective_month desc
            limit 1),
           100
         ),
         public.contribution_period_due_date(m.group_id, v_current_month)
  from my_memberships mm
  join public.members m on m.id = mm.member_id
  join public.groups g on g.id = m.group_id and g.status = 'ACTIVE'
  where m.status = 'ACTIVE'
    and m.activation_status = 'ACTIVE'
    and m.deleted_at is null
    and m.date_registered <= (v_current_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  -- Automatic in-app reminders for all unpaid, partial, approaching, or overdue periods
  with my_memberships as (
    select member_id,
           max(case when role = 'ADMIN' then 3 when role = 'TREASURER' then 2 else 1 end) as role_rank
    from (
      select gm.member_id, gm.role::text as role
      from public.group_memberships gm
      where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union all
      select p.member_id, p.role::text as role
      from public.profiles p
      where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
    group by member_id
  ),
  unpaid_periods as (
    select cp.id as period_id,
           cp.group_id,
           g.name as group_name,
           cp.period_month,
           cp.due_date,
           mm.role_rank,
           vcs.outstanding_amount,
           coalesce((
             select sum(c.amount)
             from public.contributions c
             where c.contribution_period_id = cp.id
               and c.approval_status = 'PENDING'
           ), 0)::numeric(14,2) as pending_amount
    from public.contribution_periods cp
    join my_memberships mm on mm.member_id = cp.member_id
    join public.members m on m.id = cp.member_id
    join public.groups g on g.id = cp.group_id and g.status = 'ACTIVE'
    join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
    where m.status = 'ACTIVE'
      and m.activation_status = 'ACTIVE'
      and m.deleted_at is null
      and not cp.is_exempt
      and vcs.outstanding_amount > 0
      and (
        cp.period_month <= v_current_month
        or cp.due_date <= current_date + 3
      )
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
  select v_uid,
         up.group_id,
         'CONTRIBUTION_REMINDER',
         case
           when up.due_date < current_date then 'Unpaid contribution overdue'
           when up.due_date <= current_date + 3 then 'Contribution deadline approaching'
           else 'Unpaid monthly contribution'
         end,
         case
           when up.due_date < current_date then
             'Your ' || to_char(up.period_month, 'FMMonth YYYY') || ' contribution for ' || up.group_name
             || ' is overdue (PHP ' || trim(to_char(up.outstanding_amount, 'FM999,999,999,990.00'))
             || ' remaining; due date was ' || to_char(up.due_date, 'Mon DD, YYYY') || ').'
           when up.due_date <= current_date + 3 then
             'Your ' || to_char(up.period_month, 'FMMonth YYYY') || ' contribution for ' || up.group_name
             || ' is due on ' || to_char(up.due_date, 'Mon DD, YYYY')
             || ' (PHP ' || trim(to_char(up.outstanding_amount, 'FM999,999,999,990.00')) || ' remaining).'
           else
             'Your ' || to_char(up.period_month, 'FMMonth YYYY') || ' contribution for ' || up.group_name
             || ' is still unpaid (PHP ' || trim(to_char(up.outstanding_amount, 'FM999,999,999,990.00'))
             || ' remaining, due ' || to_char(up.due_date, 'Mon DD, YYYY') || ').'
         end,
         case when up.role_rank = 1 then 'user.html?reminder=' || to_char(up.period_month, 'YYYY-MM')
              else 'contributions.html?reminder=' || to_char(up.period_month, 'YYYY-MM') end,
         'CONTRIBUTION_REMINDER:' || up.period_id::text || ':' || to_char(current_date, 'YYYY-MM-DD')
  from unpaid_periods up
  where up.pending_amount < up.outstanding_amount
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = v_uid
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from up.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(up.period_month, 'FMMonth YYYY') || '%'
    )
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;

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
  join public.members m on m.id = cp.member_id
  join public.groups g on g.id = cp.group_id and g.status = 'ACTIVE'
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where m.status = 'ACTIVE'
    and m.activation_status = 'ACTIVE'
    and m.deleted_at is null
    and cp.due_date between current_date and current_date + 14
    and not cp.is_exempt
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

revoke all on function public.sync_my_due_reminders() from public, anon;
grant execute on function public.sync_my_due_reminders() to authenticated;

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_current_month date := date_trunc('month', current_date)::date;
  v_count integer := 0;
  v_goal_count integer := 0;
begin
  -- Auto-ensure current-month contribution periods exist for all active members in active groups
  perform set_config('ipon.sync_due_periods', 'on', true);

  insert into public.contribution_periods (member_id, group_id, period_month, required_amount, due_date)
  select m.id,
         m.group_id,
         v_current_month,
         coalesce(
           nullif(m.monthly_contribution_amount, 0),
           (select cs.default_amount
            from public.contribution_settings cs
            where cs.group_id = m.group_id
              and cs.effective_month <= v_current_month
            order by cs.effective_month desc
            limit 1),
           100
         ),
         public.contribution_period_due_date(m.group_id, v_current_month)
  from public.members m
  join public.groups g on g.id = m.group_id and g.status = 'ACTIVE'
  where m.status = 'ACTIVE'
    and m.activation_status = 'ACTIVE'
    and m.deleted_at is null
    and m.date_registered <= (v_current_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  with linked_users as (
    select p.id as user_id,
           u.member_id,
           max(case when u.role = 'ADMIN' then 3 when u.role = 'TREASURER' then 2 else 1 end) as role_rank
    from (
      select gm.user_id as id, gm.member_id, gm.role::text as role
      from public.group_memberships gm
      where gm.status = 'ACTIVE' and gm.member_id is not null
      union all
      select p.id, p.member_id, p.role::text as role
      from public.profiles p
      where p.status = 'ACTIVE' and p.member_id is not null
    ) u
    join public.profiles p on p.id = u.id
    where p.status = 'ACTIVE' and p.notifications_enabled
    group by p.id, u.member_id
  ),
  unpaid_periods as (
    select lu.user_id,
           lu.role_rank,
           cp.id as period_id,
           cp.group_id,
           g.name as group_name,
           cp.period_month,
           cp.due_date,
           vcs.outstanding_amount,
           coalesce((
             select sum(c.amount)
             from public.contributions c
             where c.contribution_period_id = cp.id
               and c.approval_status = 'PENDING'
           ), 0)::numeric(14,2) as pending_amount
    from public.contribution_periods cp
    join linked_users lu on lu.member_id = cp.member_id
    join public.members m on m.id = cp.member_id
    join public.groups g on g.id = cp.group_id and g.status = 'ACTIVE'
    join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
    where m.status = 'ACTIVE'
      and m.activation_status = 'ACTIVE'
      and m.deleted_at is null
      and not cp.is_exempt
      and vcs.outstanding_amount > 0
      and (
        cp.period_month <= v_current_month
        or cp.due_date <= current_date + 3
      )
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
  select up.user_id,
         up.group_id,
         'CONTRIBUTION_REMINDER',
         case
           when up.due_date < current_date then 'Unpaid contribution overdue'
           when up.due_date <= current_date + 3 then 'Contribution deadline approaching'
           else 'Unpaid monthly contribution'
         end,
         case
           when up.due_date < current_date then
             'Your ' || to_char(up.period_month, 'FMMonth YYYY') || ' contribution for ' || up.group_name
             || ' is overdue (PHP ' || trim(to_char(up.outstanding_amount, 'FM999,999,999,990.00'))
             || ' remaining; due date was ' || to_char(up.due_date, 'Mon DD, YYYY') || ').'
           when up.due_date <= current_date + 3 then
             'Your ' || to_char(up.period_month, 'FMMonth YYYY') || ' contribution for ' || up.group_name
             || ' is due on ' || to_char(up.due_date, 'Mon DD, YYYY')
             || ' (PHP ' || trim(to_char(up.outstanding_amount, 'FM999,999,999,990.00')) || ' remaining).'
           else
             'Your ' || to_char(up.period_month, 'FMMonth YYYY') || ' contribution for ' || up.group_name
             || ' is still unpaid (PHP ' || trim(to_char(up.outstanding_amount, 'FM999,999,999,990.00'))
             || ' remaining, due ' || to_char(up.due_date, 'Mon DD, YYYY') || ').'
         end,
         case when up.role_rank = 1 then 'user.html?reminder=' || to_char(up.period_month, 'YYYY-MM')
              else 'contributions.html?reminder=' || to_char(up.period_month, 'YYYY-MM') end,
         'CONTRIBUTION_REMINDER:' || up.period_id::text || ':' || to_char(current_date, 'YYYY-MM-DD')
  from unpaid_periods up
  where up.pending_amount < up.outstanding_amount
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = up.user_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from up.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(up.period_month, 'FMMonth YYYY') || '%'
    )
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
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

revoke all on function public.create_due_reminders() from public, anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_156', 'automatic_inapp_unpaid_reminders')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
