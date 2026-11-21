-- Migration 154: Remove internal client-platform heartbeat and cosmetic social profile noise from audit_logs
-- Prevents report_client_platform() heartbeats (last_client_platform / last_client_platform_at),
-- social profile cosmetics (card_theme, cover_url, equipped_profile_effect, social_links, verified_badge_*),
-- and internal goal baseline math (schedule_baseline_amount) from cluttering user-facing Audit Logs,
-- and purges historical noise-only UPDATE rows.

begin;

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
    'last_client_platform',
    'last_client_platform_at',
    'chat_privacy',
    'username',
    'bio',
    'card_theme',
    'cover_url',
    'equipped_profile_effect',
    'social_links',
    'verified_badge_tier',
    'verified_badge_expires_at',
    'verified_badge_message',
    'verified_badge_granted_at',
    'verified_badge_acknowledged_at',
    'verified_badge_granted_by',
    'name_setup_required',
    'previous_account_status',
    'idempotency_key',
    'inactivity_warned_at',
    'savings_inactivity_reminded_at',
    'savings_retention_warned_at',
    'policy_accepted_version',
    'policy_accepted_at',
    'snapshot',
    'archived_paid_amount',
    'archived_first_paid_date',
    'schedule_baseline_amount'
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

  if tg_op = 'UPDATE' and (v_old - array['updated_by']) = (v_new - array['updated_by']) then
    return new;
  end if;

  v_record_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  v_group_id := case
    when tg_table_name = 'groups' then v_record_id
    else coalesce((v_new ->> 'group_id')::uuid, (v_old ->> 'group_id')::uuid)
  end;

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

revoke all on function public.write_audit_log() from public, anon, authenticated;

-- Purge historical client-platform heartbeat and cosmetic social profile noise UPDATE rows
delete from public.audit_logs
where action = 'UPDATE'
  and (
    coalesce(old_data, '{}'::jsonb) - array[
      'updated_at',
      'created_at',
      'updated_by',
      'last_seen_at',
      'last_client_platform',
      'last_client_platform_at',
      'chat_privacy',
      'username',
      'bio',
      'card_theme',
      'cover_url',
      'equipped_profile_effect',
      'social_links',
      'verified_badge_tier',
      'verified_badge_expires_at',
      'verified_badge_message',
      'verified_badge_granted_at',
      'verified_badge_acknowledged_at',
      'verified_badge_granted_by',
      'name_setup_required',
      'previous_account_status',
      'idempotency_key',
      'inactivity_warned_at',
      'savings_inactivity_reminded_at',
      'savings_retention_warned_at',
      'policy_accepted_version',
      'policy_accepted_at',
      'snapshot',
      'archived_paid_amount',
      'archived_first_paid_date',
      'schedule_baseline_amount'
    ]
  ) = (
    coalesce(new_data, '{}'::jsonb) - array[
      'updated_at',
      'created_at',
      'updated_by',
      'last_seen_at',
      'last_client_platform',
      'last_client_platform_at',
      'chat_privacy',
      'username',
      'bio',
      'card_theme',
      'cover_url',
      'equipped_profile_effect',
      'social_links',
      'verified_badge_tier',
      'verified_badge_expires_at',
      'verified_badge_message',
      'verified_badge_granted_at',
      'verified_badge_acknowledged_at',
      'verified_badge_granted_by',
      'name_setup_required',
      'previous_account_status',
      'idempotency_key',
      'inactivity_warned_at',
      'savings_inactivity_reminded_at',
      'savings_retention_warned_at',
      'policy_accepted_version',
      'policy_accepted_at',
      'snapshot',
      'archived_paid_amount',
      'archived_first_paid_date',
      'schedule_baseline_amount'
    ]
  );

insert into public.schema_migrations (version, name)
values ('20261121_154', 'suppress_client_platform_and_social_audit_noise')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
