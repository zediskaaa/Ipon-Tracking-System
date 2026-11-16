-- Migration 084: Protect ongoing savings & active goals from retention, add completion/reset to 30-day Bin lifecycle with remaining-days tracking and automatic DB + Storage purge after expiry.

begin;

-- 1. Extend savings_goals with completion & 30-day recycle-bin lifecycle columns
alter table public.savings_goals
  add column if not exists completed_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

create index if not exists savings_goals_active_idx
  on public.savings_goals (group_id, created_at desc)
  where deleted_at is null;

drop policy if exists savings_goals_select on public.savings_goals;
create policy savings_goals_select on public.savings_goals for select to authenticated
using (
  group_id = public.current_group_id()
  and deleted_at is null
  and public.current_user_role() <> 'SUPER_ADMIN'
);

create or replace function public.save_savings_goal(
  p_goal_id uuid,
  p_title text,
  p_target_amount numeric,
  p_target_date date,
  p_status public.goal_status,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_group_id uuid := public.current_group_id();
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an administrator can manage goals.' using errcode = '42501';
  end if;

  if p_goal_id is null then
    insert into public.savings_goals (
      group_id, title, target_amount, target_date, status, completed_at, notes, created_by, updated_by
    )
    values (
      v_group_id,
      btrim(p_title),
      public.validated_money(p_target_amount, 'Target amount'),
      p_target_date,
      p_status,
      case when p_status = 'COMPLETED' then now() else null end,
      nullif(btrim(p_notes), ''),
      auth.uid(),
      auth.uid()
    )
    returning id into v_id;
  else
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

-- 2. Finished group savings batch snapshots for 30-day reset -> bin -> auto-purge
create table if not exists public.savings_cycle_batches (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  notes text check (char_length(coalesce(notes, '')) <= 500),
  period_start date,
  period_end date,
  total_additions numeric(14,2) not null default 0,
  total_deductions numeric(14,2) not null default 0,
  total_expenses numeric(14,2) not null default 0,
  net_savings numeric(14,2) generated always as (total_additions - total_deductions - total_expenses) stored,
  records_count integer not null default 0,
  periods_count integer not null default 0,
  goals_binned_count integer not null default 0,
  snapshot jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default now(),
  deleted_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '1 month'),
  restored_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists savings_cycle_batches_bin_idx
  on public.savings_cycle_batches (group_id, deleted_at desc)
  where restored_at is null;

alter table public.savings_cycle_batches enable row level security;
alter table public.savings_cycle_batches force row level security;

drop policy if exists mfa_verified_for_opted_in on public.savings_cycle_batches;
create policy mfa_verified_for_opted_in on public.savings_cycle_batches
as restrictive for all to authenticated
using (public.mfa_access_allowed());

drop policy if exists savings_cycle_batches_select on public.savings_cycle_batches;
create policy savings_cycle_batches_select on public.savings_cycle_batches for select to authenticated
using (
  group_id = public.current_group_id()
  and public.is_admin()
);

revoke all on public.savings_cycle_batches from public, anon, authenticated;
grant select on public.savings_cycle_batches to authenticated;

-- 3. Trigger coordination for bin snapshot reset & recovery (preserve receipt Storage during 30d bin window)
create or replace function public.queue_replaced_media_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and tg_op = 'DELETE'
     and tg_table_name in ('contributions', 'expenses') then
    return old;
  end if;

  if tg_table_name = 'profiles' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
  elsif tg_table_name = 'groups' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
    if old.payment_qr_url is not null and (tg_op = 'DELETE' or new.payment_qr_url is distinct from old.payment_qr_url) then
      perform public.queue_media_url_deletion(old.payment_qr_url);
    end if;
  elsif tg_table_name in ('contributions', 'expenses') then
    if old.receipt_url is not null and (tg_op = 'DELETE' or new.receipt_url is distinct from old.receipt_url) then
      perform public.queue_media_url_deletion(old.receipt_url);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
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
begin
  if current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if current_setting('ipon.maintenance_archive_rollup', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_admin()
     and tg_op = 'DELETE'
     and tg_table_name in ('contributions', 'withdrawals', 'expenses') then
    if old.group_id is not distinct from v_actor_group then
      return old;
    end if;
  end if;

  if current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_admin()
     and tg_table_name in ('contribution_periods', 'contributions', 'withdrawals', 'expenses', 'record_comments', 'savings_goals') then
    if (tg_op = 'DELETE' and old.group_id is not distinct from v_actor_group)
       or (tg_op <> 'DELETE' and new.group_id is not distinct from v_actor_group) then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
  end if;

  if current_setting('ipon.maintenance_receipt_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_super_admin()
     and tg_op = 'UPDATE'
     and tg_table_name in ('contributions', 'expenses') then
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

  if tg_op = 'UPDATE'
     and tg_table_name = 'members'
     and current_setting('ipon.activating_member_id', true) = new.id::text
     and pg_trigger_depth() <= 1
     and old.group_id is not distinct from new.group_id
     and old.activation_status <> 'ACTIVE'
     and new.activation_status = 'ACTIVE' then
    return new;
  end if;

  if tg_op = 'INSERT'
     and tg_table_name = 'contribution_periods'
     and current_setting('ipon.activating_member_id', true) = new.member_id::text
     and pg_trigger_depth() <= 1 then
    select group_id into v_row_group from public.members where id = new.member_id;
    new.group_id := v_row_group;
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

  return case when tg_op = 'DELETE' then old else new end;
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

revoke execute on function public.notify_record_activity() from public, anon, authenticated;

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

-- 4. Shared helper to queue cloud Storage deletion for expired/permanently deleted bin items
create or replace function public.purge_bin_item_storage(
  p_item_type text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_comment jsonb;
  v_att jsonb;
  v_path text;
begin
  if p_payload is null then
    return;
  end if;

  if p_item_type = 'announcement' then
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_payload, '[]'::jsonb))
    loop
      v_path := nullif(btrim(coalesce(v_item ->> 'path', '')), '');
      if v_path is not null then
        perform public.queue_storage_object_deletion('announcements', v_path);
      end if;
    end loop;
  elsif p_item_type = 'savings_cycle' then
    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_payload -> 'contributions', '[]'::jsonb))
    loop
      if nullif(btrim(coalesce(v_item ->> 'receipt_url', '')), '') is not null then
        perform public.queue_media_url_deletion(v_item ->> 'receipt_url');
      end if;
    end loop;

    for v_item in
      select value
      from jsonb_array_elements(coalesce(p_payload -> 'expenses', '[]'::jsonb))
    loop
      if nullif(btrim(coalesce(v_item ->> 'receipt_url', '')), '') is not null then
        perform public.queue_media_url_deletion(v_item ->> 'receipt_url');
      end if;
    end loop;

    for v_comment in
      select value
      from jsonb_array_elements(coalesce(p_payload -> 'record_comments', '[]'::jsonb))
    loop
      for v_att in
        select value
        from jsonb_array_elements(coalesce(v_comment -> 'attachments', '[]'::jsonb))
      loop
        v_path := nullif(btrim(coalesce(v_att ->> 'path', '')), '');
        if v_path is not null then
          perform public.queue_storage_object_deletion('record-comments', v_path);
        end if;
      end loop;
    end loop;
  end if;
end;
$$;

revoke execute on function public.purge_bin_item_storage(text, jsonb) from public, anon, authenticated;

-- 5. Move savings goals cleanly to 30-day bin when completed or removed (instead of immediate permanent erase)
drop function if exists public.delete_savings_goal(uuid);

create or replace function public.delete_savings_goal(
  p_goal_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_goal public.savings_goals%rowtype;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an administrator can manage goals.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if p_goal_id is null then
    raise exception 'Savings goal is required.' using errcode = '22023';
  end if;

  select * into v_goal
  from public.savings_goals
  where id = p_goal_id
    and group_id = v_group_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Savings goal not found.' using errcode = 'P0002';
  end if;

  update public.savings_goals
  set deleted_at = now(),
      deleted_by = auth.uid(),
      delete_reason = coalesce(
        v_reason,
        case
          when status = 'COMPLETED' then 'Completed goal cleared to recycle bin'
          else 'Removed from savings goals'
        end
      ),
      updated_by = auth.uid()
  where id = p_goal_id;

  return p_goal_id;
end;
$$;

revoke execute on function public.delete_savings_goal(uuid, text) from public, anon;
grant execute on function public.delete_savings_goal(uuid, text) to authenticated;

create or replace function public.complete_and_bin_savings_goal(
  p_goal_id uuid,
  p_move_to_bin boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_row public.savings_goals%rowtype;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an administrator can manage goals.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if p_goal_id is null then
    raise exception 'Savings goal is required.' using errcode = '22023';
  end if;

  select * into v_row
  from public.savings_goals
  where id = p_goal_id
    and group_id = v_group_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Savings goal not found.' using errcode = 'P0002';
  end if;

  update public.savings_goals
  set status = 'COMPLETED',
      completed_at = coalesce(completed_at, now()),
      deleted_at = case when coalesce(p_move_to_bin, true) then now() else null end,
      deleted_by = case when coalesce(p_move_to_bin, true) then auth.uid() else null end,
      delete_reason = case
        when coalesce(p_move_to_bin, true) then coalesce(v_reason, 'Goal marked done and moved to 30-day bin')
        else null
      end,
      updated_by = auth.uid()
  where id = p_goal_id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'completed_at', v_row.completed_at,
    'deleted_at', v_row.deleted_at,
    'expires_at', case when v_row.deleted_at is not null then v_row.deleted_at + interval '1 month' else null end
  );
end;
$$;

revoke execute on function public.complete_and_bin_savings_goal(uuid, boolean, text) from public, anon;
grant execute on function public.complete_and_bin_savings_goal(uuid, boolean, text) to authenticated;

-- 6. Finish completed savings cycle & reset active workspace cleanly into the 30-day Recycle Bin
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
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can finish and reset the savings batch.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_title is null then
    v_title := 'Savings Batch — ' || to_char(now() at time zone 'Asia/Manila', 'Mon DD, YYYY');
  elsif char_length(v_title) < 2 then
    raise exception 'Batch title must be at least 2 characters.' using errcode = '22023';
  end if;

  select
    (select count(*) from public.contributions c where c.group_id = v_group_id and c.approval_status = 'PENDING')
    + (select count(*) from public.withdrawals w where w.group_id = v_group_id and w.approval_status = 'PENDING')
    + (select count(*) from public.expenses e where e.group_id = v_group_id and e.approval_status = 'PENDING')
  into v_pending;

  if coalesce(v_pending, 0) > 0 then
    raise exception 'Review or resolve all pending transactions before finishing and resetting this savings batch.' using errcode = 'P0001';
  end if;

  select
    coalesce((select sum(c.amount) from public.contributions c where c.group_id = v_group_id and c.approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    coalesce((select sum(w.amount) from public.withdrawals w where w.group_id = v_group_id and w.approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    coalesce((select sum(e.amount) from public.expenses e where e.group_id = v_group_id and e.approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    (select count(*) from public.contributions c where c.group_id = v_group_id)
      + (select count(*) from public.withdrawals w where w.group_id = v_group_id)
      + (select count(*) from public.expenses e where e.group_id = v_group_id),
    (select count(*) from public.contribution_periods cp where cp.group_id = v_group_id),
    (select cycle_start_date from public.groups where id = v_group_id)
  into v_add, v_ded, v_exp, v_records_count, v_periods_count, v_prev_cycle_start;

  select min(dt), max(dt)
  into v_period_start, v_period_end
  from (
    select c.payment_date as dt from public.contributions c where c.group_id = v_group_id
    union all
    select w.transaction_date as dt from public.withdrawals w where w.group_id = v_group_id
    union all
    select e.transaction_date as dt from public.expenses e where e.group_id = v_group_id
    union all
    select cp.period_month as dt from public.contribution_periods cp where cp.group_id = v_group_id
  ) dates;

  if coalesce(p_include_completed_goals, false) then
    select coalesce(jsonb_agg(sg.id), '[]'::jsonb), count(*)
    into v_goal_ids, v_goals_count
    from public.savings_goals sg
    where sg.group_id = v_group_id
      and sg.deleted_at is null
      and sg.status in ('COMPLETED', 'CANCELLED');
  end if;

  if coalesce(v_records_count, 0) = 0
     and coalesce(v_periods_count, 0) = 0
     and coalesce(v_goals_count, 0) = 0
     and v_prev_cycle_start is null then
    raise exception 'No active savings records or contribution periods found to reset.' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(to_jsonb(cp) order by cp.period_month, cp.created_at), '[]'::jsonb)
  into v_periods_json
  from public.contribution_periods cp
  where cp.group_id = v_group_id;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.payment_date, c.created_at), '[]'::jsonb)
  into v_contribs_json
  from public.contributions c
  where c.group_id = v_group_id;

  select coalesce(jsonb_agg(to_jsonb(w) order by w.transaction_date, w.created_at), '[]'::jsonb)
  into v_withdrawals_json
  from public.withdrawals w
  where w.group_id = v_group_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.transaction_date, e.created_at), '[]'::jsonb)
  into v_expenses_json
  from public.expenses e
  where e.group_id = v_group_id;

  select coalesce(jsonb_agg(to_jsonb(rc) order by rc.created_at), '[]'::jsonb)
  into v_comments_json
  from public.record_comments rc
  where rc.group_id = v_group_id
    and (
      (rc.record_type = 'contribution' and exists (select 1 from public.contributions c where c.id = rc.record_id and c.group_id = v_group_id))
      or (rc.record_type = 'withdrawal' and exists (select 1 from public.withdrawals w where w.id = rc.record_id and w.group_id = v_group_id))
      or (rc.record_type = 'expense' and exists (select 1 from public.expenses e where e.id = rc.record_id and e.group_id = v_group_id))
    );

  perform set_config('ipon.maintenance_bin_snapshot', 'on', true);

  insert into public.savings_cycle_batches (
    group_id, title, notes, period_start, period_end,
    total_additions, total_deductions, total_expenses,
    records_count, periods_count, goals_binned_count,
    snapshot, deleted_at, deleted_by, expires_at
  ) values (
    v_group_id,
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
    auth.uid(),
    v_expires_at
  )
  returning id into v_batch_id;

  delete from public.record_comments rc
  where rc.group_id = v_group_id
    and (
      (rc.record_type = 'contribution' and exists (select 1 from public.contributions c where c.id = rc.record_id and c.group_id = v_group_id))
      or (rc.record_type = 'withdrawal' and exists (select 1 from public.withdrawals w where w.id = rc.record_id and w.group_id = v_group_id))
      or (rc.record_type = 'expense' and exists (select 1 from public.expenses e where e.id = rc.record_id and e.group_id = v_group_id))
    );

  delete from public.contributions where group_id = v_group_id;
  delete from public.withdrawals where group_id = v_group_id;
  delete from public.expenses where group_id = v_group_id;
  delete from public.contribution_periods where group_id = v_group_id;

  if coalesce(v_goals_count, 0) > 0 then
    update public.savings_goals
    set deleted_at = now(),
        deleted_by = auth.uid(),
        delete_reason = coalesce(v_reason, 'Cleared with finished savings batch "' || v_title || '"'),
        updated_by = auth.uid()
    where group_id = v_group_id
      and id = any(array(select (jsonb_array_elements_text(v_goal_ids))::uuid));
  end if;

  update public.groups
  set cycle_start_date = null
  where id = v_group_id;

  insert into public.audit_logs (group_id, table_name, record_id, action, new_data, changed_by)
  values (
    v_group_id,
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
    auth.uid()
  );

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

revoke execute on function public.archive_and_reset_savings_cycle(text, text, boolean) from public, anon;
grant execute on function public.archive_and_reset_savings_cycle(text, text, boolean) to authenticated;

-- 7. Unified Recycle Bin query, recovery & permanent purge RPCs with remaining-days countdown
create or replace function public.get_bin_items(p_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := nullif(lower(btrim(coalesce(p_type, ''))), '');
  v_cutoff timestamptz := now() - interval '1 month';
  v_items jsonb;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can view the bin.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_type is not null and v_type not in ('member', 'announcement', 'goal', 'savings_cycle') then
    raise exception 'Invalid bin item filter.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(row_to_json(entry)::jsonb order by entry.deleted_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      raw_entry.item_type,
      raw_entry.type_label,
      raw_entry.item_id,
      raw_entry.title,
      raw_entry.subtitle,
      raw_entry.reason,
      raw_entry.deleted_by_name,
      raw_entry.deleted_at,
      raw_entry.expires_at,
      greatest(0, ceil(extract(epoch from (raw_entry.expires_at - now())) / 86400.0))::integer as days_remaining
    from (
      select
        'member'::text as item_type,
        'Member'::text as type_label,
        m.id as item_id,
        m.full_name as title,
        concat_ws(
          ' · ',
          m.status::text,
          nullif(m.contact_number, ''),
          'Registered ' || to_char(m.date_registered, 'Mon DD, YYYY')
        ) as subtitle,
        coalesce(m.delete_reason, 'No reason provided') as reason,
        coalesce(dp.full_name, 'Group Administrator') as deleted_by_name,
        m.deleted_at,
        (m.deleted_at + interval '1 month') as expires_at
      from public.members m
      left join public.profiles dp on dp.id = m.deleted_by
      where m.group_id = v_group_id
        and m.deleted_at is not null
        and m.deleted_at >= v_cutoff
        and (v_type is null or v_type = 'member')

      union all

      select
        'announcement'::text as item_type,
        'Announcement'::text as type_label,
        a.id as item_id,
        a.title,
        left(btrim(a.description), 110)
          || case when char_length(btrim(a.description)) > 110 then '…' else '' end as subtitle,
        coalesce(a.delete_reason, 'Removed from announcements') as reason,
        coalesce(dp.full_name, a.author_name, 'Group Administrator') as deleted_by_name,
        a.deleted_at,
        (a.deleted_at + interval '1 month') as expires_at
      from public.announcements a
      left join public.profiles dp on dp.id = a.deleted_by
      where a.group_id = v_group_id
        and a.author_role = 'ADMIN'
        and a.deleted_at is not null
        and a.deleted_at >= v_cutoff
        and char_length(btrim(a.title)) > 0
        and char_length(btrim(a.description)) > 0
        and (v_type is null or v_type = 'announcement')

      union all

      select
        'goal'::text as item_type,
        'Goal'::text as type_label,
        sg.id as item_id,
        sg.title,
        'Target PHP ' || to_char(sg.target_amount, 'FM999,999,990.00')
          || ' · ' || initcap(lower(sg.status::text))
          || coalesce(' · Due ' || to_char(sg.target_date, 'Mon DD, YYYY'), '') as subtitle,
        coalesce(sg.delete_reason, 'Goal cleared to recycle bin') as reason,
        coalesce(dp.full_name, 'Group Administrator') as deleted_by_name,
        sg.deleted_at,
        (sg.deleted_at + interval '1 month') as expires_at
      from public.savings_goals sg
      left join public.profiles dp on dp.id = sg.deleted_by
      where sg.group_id = v_group_id
        and sg.deleted_at is not null
        and sg.deleted_at >= v_cutoff
        and (v_type is null or v_type = 'goal')

      union all

      select
        'savings_cycle'::text as item_type,
        'Savings batch'::text as type_label,
        sc.id as item_id,
        sc.title,
        sc.records_count::text || ' record' || case when sc.records_count = 1 then '' else 's' end
          || ' · Net PHP ' || to_char(sc.net_savings, 'FM999,999,990.00')
          || coalesce(' · ' || to_char(sc.period_start, 'Mon DD, YYYY') || ' to ' || to_char(sc.period_end, 'Mon DD, YYYY'), '') as subtitle,
        coalesce(nullif(btrim(sc.notes), ''), 'Completed savings cycle cleared to bin') as reason,
        coalesce(dp.full_name, 'Group Administrator') as deleted_by_name,
        sc.deleted_at,
        sc.expires_at
      from public.savings_cycle_batches sc
      left join public.profiles dp on dp.id = sc.deleted_by
      where sc.group_id = v_group_id
        and sc.restored_at is null
        and sc.expires_at >= now()
        and (v_type is null or v_type = 'savings_cycle')
    ) raw_entry
  ) entry;

  return v_items;
end;
$$;

revoke execute on function public.get_bin_items(text) from public, anon;
grant execute on function public.get_bin_items(text) to authenticated;

create or replace function public.recover_bin_item(
  p_item_type text,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := lower(btrim(coalesce(p_item_type, '')));
  v_cutoff timestamptz := now() - interval '1 month';
  v_member public.members%rowtype;
  v_announcement public.announcements%rowtype;
  v_goal public.savings_goals%rowtype;
  v_batch public.savings_cycle_batches%rowtype;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date;
  v_prev_cycle date;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can recover deleted items.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if p_item_id is null then
    raise exception 'Deleted item is required.' using errcode = '22023';
  end if;

  if v_type = 'member' then
    select * into v_member
    from public.members
    where id = p_item_id
      and group_id = v_group_id
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted member not found in bin.' using errcode = 'P0002';
    end if;

    if v_member.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    update public.members
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null,
        updated_by = auth.uid()
    where id = p_item_id;

    update public.profiles
    set status = coalesce(previous_account_status, status),
        previous_account_status = null
    where member_id = p_item_id
      and group_id = v_group_id
      and role = 'MEMBER'
      and previous_account_status is not null;

    update public.group_memberships
    set status = case
      when v_member.activation_status = 'ACTIVE' then 'ACTIVE'::public.account_status
      else 'PENDING'::public.account_status
    end
    where member_id = p_item_id
      and group_id = v_group_id
      and role = 'MEMBER'
      and status = 'DISABLED';

    if v_member.status = 'ACTIVE'
       and v_member.activation_status = 'ACTIVE'
       and v_member.date_registered <= (v_month + interval '1 month - 1 day')::date
       and exists (
         select 1
         from public.contribution_periods cp
         join public.members m2 on m2.id = cp.member_id
         where m2.group_id = v_group_id
           and m2.deleted_at is null
           and cp.period_month = v_month
       ) then
      insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
      values (
        v_member.id,
        v_month,
        v_member.monthly_contribution_amount,
        public.contribution_period_due_date(v_group_id, v_month)
      )
      on conflict (member_id, period_month) do nothing;
    end if;
  elsif v_type = 'announcement' then
    select * into v_announcement
    from public.announcements
    where id = p_item_id
      and group_id = v_group_id
      and author_role = 'ADMIN'
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted announcement not found in bin.' using errcode = 'P0002';
    end if;

    if v_announcement.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    if char_length(btrim(coalesce(v_announcement.title, ''))) = 0
       or char_length(btrim(coalesce(v_announcement.description, ''))) = 0 then
      raise exception 'This announcement can no longer be recovered.' using errcode = 'P0001';
    end if;

    update public.announcements
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null
    where id = p_item_id;
  elsif v_type = 'goal' then
    select * into v_goal
    from public.savings_goals
    where id = p_item_id
      and group_id = v_group_id
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted savings goal not found in bin.' using errcode = 'P0002';
    end if;

    if v_goal.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    update public.savings_goals
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null,
        updated_by = auth.uid()
    where id = p_item_id;
  elsif v_type = 'savings_cycle' then
    select * into v_batch
    from public.savings_cycle_batches
    where id = p_item_id
      and group_id = v_group_id
      and restored_at is null
    for update;

    if not found then
      raise exception 'Deleted savings batch not found in bin.' using errcode = 'P0002';
    end if;

    if v_batch.expires_at < now() then
      raise exception 'This savings batch passed the 1-month limit and can no longer be recovered.' using errcode = 'P0001';
    end if;

    perform set_config('ipon.maintenance_bin_snapshot', 'on', true);

    insert into public.contribution_periods (
      id, member_id, period_month, required_amount, created_at, group_id, due_date,
      is_exempt, exempt_reason, archived_paid_amount, archived_first_paid_date
    )
    select
      cp.id, cp.member_id, cp.period_month, cp.required_amount, coalesce(cp.created_at, now()),
      v_group_id, coalesce(cp.due_date, public.contribution_period_due_date(v_group_id, cp.period_month)),
      coalesce(cp.is_exempt, false), cp.exempt_reason,
      coalesce(cp.archived_paid_amount, 0), cp.archived_first_paid_date
    from jsonb_populate_recordset(
      null::public.contribution_periods,
      coalesce(v_batch.snapshot -> 'contribution_periods', '[]'::jsonb)
    ) cp
    where exists (select 1 from public.members m where m.id = cp.member_id)
    on conflict (member_id, period_month) do nothing;

    with snapped_periods as (
      select cp.id as old_id, cp.member_id, cp.period_month
      from jsonb_populate_recordset(
        null::public.contribution_periods,
        coalesce(v_batch.snapshot -> 'contribution_periods', '[]'::jsonb)
      ) cp
    ),
    period_map as (
      select
        sp.old_id,
        coalesce(live_by_id.id, live_by_key.id) as target_period_id
      from snapped_periods sp
      left join public.contribution_periods live_by_id
        on live_by_id.id = sp.old_id and live_by_id.group_id = v_group_id
      left join public.contribution_periods live_by_key
        on live_by_key.member_id = sp.member_id and live_by_key.period_month = sp.period_month
    )
    insert into public.contributions (
      id, contribution_period_id, amount, payment_date, transaction_reference,
      idempotency_key, notes, approval_status, submitted_by, reviewed_by, reviewed_at,
      review_note, voided_by, voided_at, void_reason, created_at, updated_at,
      group_id, receipt_url, payment_method
    )
    select
      c.id, pm.target_period_id, c.amount, c.payment_date, c.transaction_reference,
      c.idempotency_key, c.notes, c.approval_status,
      case when exists (select 1 from public.profiles p where p.id = c.submitted_by) then c.submitted_by else null end,
      case when exists (select 1 from public.profiles p where p.id = c.reviewed_by) then c.reviewed_by else null end,
      c.reviewed_at, c.review_note,
      case when exists (select 1 from public.profiles p where p.id = c.voided_by) then c.voided_by else null end,
      c.voided_at, c.void_reason, coalesce(c.created_at, now()), coalesce(c.updated_at, now()),
      v_group_id, c.receipt_url, c.payment_method
    from jsonb_populate_recordset(
      null::public.contributions,
      coalesce(v_batch.snapshot -> 'contributions', '[]'::jsonb)
    ) c
    join period_map pm on pm.old_id = c.contribution_period_id
    where pm.target_period_id is not null
    on conflict (id) do nothing;

    insert into public.withdrawals (
      id, transaction_date, amount, category, description, person_responsible,
      reference_number, idempotency_key, notes, approval_status, submitted_by,
      reviewed_by, reviewed_at, review_note, voided_by, voided_at, void_reason,
      created_at, updated_at, group_id, payment_method
    )
    select
      w.id, w.transaction_date, w.amount, w.category, w.description, w.person_responsible,
      w.reference_number, w.idempotency_key, w.notes, w.approval_status,
      case when exists (select 1 from public.profiles p where p.id = w.submitted_by) then w.submitted_by else null end,
      case when exists (select 1 from public.profiles p where p.id = w.reviewed_by) then w.reviewed_by else null end,
      w.reviewed_at, w.review_note,
      case when exists (select 1 from public.profiles p where p.id = w.voided_by) then w.voided_by else null end,
      w.voided_at, w.void_reason, coalesce(w.created_at, now()), coalesce(w.updated_at, now()),
      v_group_id, w.payment_method
    from jsonb_populate_recordset(
      null::public.withdrawals,
      coalesce(v_batch.snapshot -> 'withdrawals', '[]'::jsonb)
    ) w
    on conflict (id) do nothing;

    insert into public.expenses (
      id, transaction_date, amount, category, description, person_responsible,
      reference_number, idempotency_key, notes, approval_status, submitted_by,
      reviewed_by, reviewed_at, review_note, voided_by, voided_at, void_reason,
      created_at, updated_at, group_id, receipt_url, payment_method
    )
    select
      e.id, e.transaction_date, e.amount, e.category, e.description, e.person_responsible,
      e.reference_number, e.idempotency_key, e.notes, e.approval_status,
      case when exists (select 1 from public.profiles p where p.id = e.submitted_by) then e.submitted_by else null end,
      case when exists (select 1 from public.profiles p where p.id = e.reviewed_by) then e.reviewed_by else null end,
      e.reviewed_at, e.review_note,
      case when exists (select 1 from public.profiles p where p.id = e.voided_by) then e.voided_by else null end,
      e.voided_at, e.void_reason, coalesce(e.created_at, now()), coalesce(e.updated_at, now()),
      v_group_id, e.receipt_url, e.payment_method
    from jsonb_populate_recordset(
      null::public.expenses,
      coalesce(v_batch.snapshot -> 'expenses', '[]'::jsonb)
    ) e
    on conflict (id) do nothing;

    insert into public.record_comments (
      id, group_id, record_type, record_id, author_id, body, created_at, attachments
    )
    select
      rc.id, v_group_id, rc.record_type, rc.record_id, rc.author_id, rc.body,
      coalesce(rc.created_at, now()), coalesce(rc.attachments, '[]'::jsonb)
    from jsonb_populate_recordset(
      null::public.record_comments,
      coalesce(v_batch.snapshot -> 'record_comments', '[]'::jsonb)
    ) rc
    where exists (select 1 from public.profiles p where p.id = rc.author_id)
    on conflict (id) do nothing;

    if jsonb_array_length(coalesce(v_batch.snapshot -> 'goal_ids', '[]'::jsonb)) > 0 then
      update public.savings_goals
      set deleted_at = null,
          deleted_by = null,
          delete_reason = null,
          updated_by = auth.uid()
      where group_id = v_group_id
        and id = any(array(select (jsonb_array_elements_text(v_batch.snapshot -> 'goal_ids'))::uuid));
    end if;

    v_prev_cycle := nullif(v_batch.snapshot ->> 'previous_cycle_start_date', '')::date;
    if v_prev_cycle is not null then
      update public.groups
      set cycle_start_date = coalesce(cycle_start_date, v_prev_cycle)
      where id = v_group_id;
    end if;

    insert into public.audit_logs (group_id, table_name, record_id, action, new_data, changed_by)
    values (
      v_group_id,
      'savings_cycle_batches',
      v_batch.id,
      'INSERT',
      jsonb_build_object(
        'title', v_batch.title,
        'restored_records_count', v_batch.records_count,
        'net_savings', v_batch.net_savings
      ),
      auth.uid()
    );

    delete from public.savings_cycle_batches where id = p_item_id;
  else
    raise exception 'Unsupported bin item type.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.recover_bin_item(text, uuid) from public, anon;
grant execute on function public.recover_bin_item(text, uuid) to authenticated;

create or replace function public.purge_bin_item_permanently(
  p_item_type text,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := lower(btrim(coalesce(p_item_type, '')));
  v_member public.members%rowtype;
  v_announcement public.announcements%rowtype;
  v_goal public.savings_goals%rowtype;
  v_batch public.savings_cycle_batches%rowtype;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can permanently delete bin items.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if p_item_id is null then
    raise exception 'Bin item is required.' using errcode = '22023';
  end if;

  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  if v_type = 'member' then
    select * into v_member
    from public.members
    where id = p_item_id
      and group_id = v_group_id
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted member not found in bin.' using errcode = 'P0002';
    end if;

    if exists (
      select 1
      from public.contribution_periods cp
      join public.contributions c on c.contribution_period_id = cp.id
      where cp.member_id = p_item_id
    ) then
      raise exception 'This member has contribution records and cannot be permanently deleted.' using errcode = 'P0001';
    end if;

    delete from public.contribution_periods where member_id = p_item_id;
    delete from public.members where id = p_item_id;
  elsif v_type = 'announcement' then
    select * into v_announcement
    from public.announcements
    where id = p_item_id
      and group_id = v_group_id
      and author_role = 'ADMIN'
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted announcement not found in bin.' using errcode = 'P0002';
    end if;

    perform public.purge_bin_item_storage('announcement', v_announcement.attachments);
    delete from public.announcements where id = p_item_id;
  elsif v_type = 'goal' then
    select * into v_goal
    from public.savings_goals
    where id = p_item_id
      and group_id = v_group_id
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted savings goal not found in bin.' using errcode = 'P0002';
    end if;

    delete from public.savings_goals where id = p_item_id;
  elsif v_type = 'savings_cycle' then
    select * into v_batch
    from public.savings_cycle_batches
    where id = p_item_id
      and group_id = v_group_id
      and restored_at is null
    for update;

    if not found then
      raise exception 'Deleted savings batch not found in bin.' using errcode = 'P0002';
    end if;

    perform public.purge_bin_item_storage('savings_cycle', v_batch.snapshot);
    delete from public.savings_cycle_batches where id = p_item_id;
  else
    raise exception 'Unsupported bin item type.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.purge_bin_item_permanently(text, uuid) from public, anon;
grant execute on function public.purge_bin_item_permanently(text, uuid) to authenticated;

-- 8. Update automated retention cleanup: auto-delete expired bin goals, announcements, & savings batches while keeping ALL active ongoing savings & goals untouched
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

  -- Ongoing unbinned savings goals (deleted_at is null) are NEVER touched regardless of age.
  -- Only goals explicitly moved to the recycle bin whose 30-day recovery window expired are permanently deleted.
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

  -- Ongoing active group ledgers stay protected indefinitely; only finished/binned batches past 30 days auto-purge (DB + Storage)
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
    'pending_storage_queue', (select count(*) from public.pending_storage_deletions)
  );
end;
$$;

revoke execute on function public.run_data_retention_cleanup(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;

-- 9. Protect long-term savers in actively ongoing savings groups from premature inactivity purge
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
  -- Clear stale warnings if user logged in, opened the app, or had confirmed savings recorded on their member profile
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

  -- Users ready to purge (warned >= 7 days ago and still inactive, and not in an actively saving group with open ongoing goals)
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
      and greatest(
        coalesce((select max(c3.created_at) from public.contributions c3 where c3.group_id = p.group_id), 'epoch'::timestamptz),
        coalesce((select max(p3.last_seen_at) from public.profiles p3 where p3.group_id = p.group_id), 'epoch'::timestamptz)
      ) > now() - v_inactive_span
    );

  -- Users reaching (6 months - 7 days) inactivity without active group savings participation -> 7-day warning email
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
        and greatest(
          coalesce((select max(c3.created_at) from public.contributions c3 where c3.group_id = p.group_id), 'epoch'::timestamptz),
          coalesce((select max(p3.last_seen_at) from public.profiles p3 where p3.group_id = p.group_id), 'epoch'::timestamptz)
        ) > now() - v_inactive_span
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

insert into public.schema_migrations (version, name)
values ('20261116_084', 'protect ongoing savings and active goals from retention with 30-day completion bin lifecycle')
on conflict (version) do nothing;

commit;
