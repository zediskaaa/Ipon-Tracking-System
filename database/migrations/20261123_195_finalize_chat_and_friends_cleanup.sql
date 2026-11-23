-- Finalize removal of historical chat tables, legacy chat notifications, chat R2 media,
-- obsolete client-platform columns, and unreachable chat tombstones (forward-only, zero CASCADE).
-- Builds on 20261123_193_remove_chat_system.sql and 20261123_194_remove_friends_system.sql
-- without modifying any already-applied migration.
-- Pre-removal private backup of all 8 chat tables (894 rows), 29 attachment records (25,692,801 bytes),
-- and 36 legacy SOCIAL_* chat notifications was captured outside the repository before applying.
-- profiles.last_seen_at is intentionally retained because auth.sessions is volatile on sign-out and
-- account_activity is pruned at 90 days (< 6-month inactivity window); see deployment notes.

begin;

-- 1. Enqueue all verified-unreferenced chat attachment paths for R2/Storage deletion before dropping table
do $$
begin
  if to_regclass('public.message_attachments') is not null then
    insert into public.pending_storage_deletions (bucket_id, object_path)
    select distinct
      coalesce(nullif(btrim(ma.bucket_id), ''), 'chat-attachments') as bucket_id,
      btrim(ma.storage_path) as object_path
    from public.message_attachments ma
    where ma.storage_path is not null
      and btrim(ma.storage_path) <> ''
      and not exists (
        select 1
        from public.pending_storage_deletions d
        where d.bucket_id = coalesce(nullif(btrim(ma.bucket_id), ''), 'chat-attachments')
          and d.object_path = btrim(ma.storage_path)
      );
  end if;
end $$;

-- 2. Explicitly drop non-constraint indexes on all 8 legacy chat tables
drop index if exists public.blocked_users_blocked_idx;
drop index if exists public.blocked_users_blocker_idx;
drop index if exists public.call_sessions_callee_status_idx;
drop index if exists public.call_sessions_caller_status_idx;
drop index if exists public.call_sessions_conv_idx;
drop index if exists public.conversation_participants_user_idx;
drop index if exists public.conversations_kind_last_msg_idx;
drop index if exists public.conversations_user_a_idx;
drop index if exists public.conversations_user_b_idx;
drop index if exists public.message_attachments_conv_idx;
drop index if exists public.message_attachments_message_idx;
drop index if exists public.message_reactions_message_idx;
drop index if exists public.message_receipts_user_idx;
drop index if exists public.messages_anonymous_session_idx;
drop index if exists public.messages_conversation_created_idx;
drop index if exists public.messages_sender_idx;
drop index if exists public.messages_vanish_due_idx;
drop index if exists public.messages_vanish_pending_idx;

-- 3. Drop all 8 historical chat tables in strict child-to-parent dependency order (NO CASCADE)
drop table if exists public.message_receipts;
drop table if exists public.message_reactions;
drop table if exists public.message_attachments;
drop table if exists public.messages;
drop table if exists public.call_sessions;
drop table if exists public.conversation_participants;
drop table if exists public.conversations;
drop table if exists public.blocked_users;

-- 4. Delete ONLY the 4 remaining legacy chat notification types; preserve all active product notifications
delete from public.notifications
where type in (
  'SOCIAL_NEW_MESSAGE',
  'SOCIAL_MESSAGE_REQUEST',
  'SOCIAL_MESSAGE_ACCEPTED',
  'SOCIAL_CALL_INCOMING'
);

-- 5. Drop obsolete chat-era client platform columns and check constraint (zero active client reads)
alter table public.profiles
  drop constraint if exists profiles_last_client_platform_check;

alter table public.profiles
  drop column if exists last_client_platform,
  drop column if exists last_client_platform_at;

-- 6. Drop the 3 unreachable chat tombstones (never called once conversations and SOCIAL_* alerts are empty)
drop function if exists public.get_conversation_messages(uuid, timestamptz, integer, uuid);
drop function if exists public.mark_conversation_read(uuid);
drop function if exists public.ack_message_notifications_by_token(uuid, bigint[]);

-- 7. Stamp explicit 2026-11-30 retirement cutoff on the remaining in-flight pre-v261 boot shims
comment on function public.get_conversations() is
  'Temporary zero-scan compatibility shim for in-flight pre-v261 tabs; drop on/after 2026-11-30 after 72h zero-call confirmation.';
comment on function public.get_social_overview() is
  'Temporary zero-scan compatibility shim for in-flight pre-v261 tabs; drop on/after 2026-11-30 after 72h zero-call confirmation.';
comment on function public.mark_messages_delivered(uuid) is
  'Temporary zero-scan compatibility shim for in-flight pre-v261 tabs; drop on/after 2026-11-30 after 72h zero-call confirmation.';
comment on function public.report_client_platform(text) is
  'Temporary zero-scan compatibility shim for in-flight pre-v261 tabs; drop on/after 2026-11-30 after 72h zero-call confirmation.';
comment on function public.touch_user_last_seen() is
  'Temporary zero-scan compatibility shim for in-flight pre-v257 tabs; drop on/after 2026-11-30 after 72h zero-call confirmation.';
comment on column public.profiles.chat_privacy is
  'Temporary empty-default compatibility column retained for in-flight pre-v261 tabs; drop on/after 2026-11-30 after 72h zero-select confirmation.';
comment on column public.v_announcements.author_social_user_id is
  'Temporary NULL compatibility column retained for in-flight pre-v261 tabs; drop view column on/after 2026-11-30 after 72h zero-select confirmation.';

-- 8. Remove dead chat placeholder counters from super_admin_storage_overview and run_data_retention_cleanup
create or replace function public.super_admin_storage_overview()
returns jsonb
language sql
stable
security definer
set search_path = public, storage
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
        + (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'audit_logs_bytes', pg_total_relation_size('public.audit_logs'),
      'audit_logs_count', (select count(*) from public.audit_logs),
      'storage_bucket_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
      'storage_bucket_objects', (select count(*) from storage.objects),
      'pending_storage_deletions', (select count(*) from public.pending_storage_deletions),
      'annual_archives_count', (select count(*) from public.financial_annual_archives)
    )
  end;
$$;

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
  v_receipt_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_message_days, 90), 30));
  v_audit_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_audit_days, 90), 30));
  v_read_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_read_notif_days, 30), 7));
  v_unread_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_unread_notif_days, 90), 30));
  v_bin_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_bin_days, 30), 14));
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
  v_expired_ann record;
  v_expired_batch record;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

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
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_receipt_cutoff
    returning id
  ),
  upd_e as (
    update public.expenses
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_receipt_cutoff
    returning id
  )
  select (select count(*) from upd_c) + (select count(*) from upd_e)
  into v_cleaned_receipts;

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
  where cs.group_id in (
    select g.id
    from public.groups g
    where g.status = 'SUSPENDED'
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

insert into public.schema_migrations (version, name)
values ('20261123_195', 'finalize_chat_and_friends_cleanup')
on conflict (version) do nothing;

commit;
