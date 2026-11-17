-- Migration 103: Complete anti-cheat audit coverage (savings_cycle_batches, groups group_id resolution, snapshot scrubbing, and strict audit_logs immutability).

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
    'policy_accepted_at',
    'snapshot'
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

-- Attach audit trigger to savings cycle batch archives/restores/deletes
drop trigger if exists savings_cycle_batches_audit on public.savings_cycle_batches;
create trigger savings_cycle_batches_audit
  after insert or update or delete on public.savings_cycle_batches
  for each row execute function public.write_audit_log();

-- Ensure group admins see historical group setting updates for their active group
update public.audit_logs
set group_id = record_id
where table_name = 'groups'
  and group_id is null
  and record_id is not null
  and exists (select 1 from public.groups g where g.id = audit_logs.record_id);

-- Enforce strict read-only immutability on audit_logs for all client roles
revoke insert, update, delete on public.audit_logs from public, anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261117_103', 'complete governance audit triggers and immutability')
on conflict (version) do nothing;

commit;
