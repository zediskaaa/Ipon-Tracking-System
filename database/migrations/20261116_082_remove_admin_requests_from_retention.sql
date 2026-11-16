-- Migration 082: Remove deprecated admin_requests cleanup from automated retention
-- (Admin Requests workflow was removed in favor of direct signup).

begin;

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
  v_conv_id uuid;
  v_latest record;
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
    'pending_storage_queue', (select count(*) from public.pending_storage_deletions)
  );
end;
$$;

revoke execute on function public.run_data_retention_cleanup(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261116_082', 'remove deprecated admin_requests cleanup from retention schedule')
on conflict (version) do nothing;

commit;
