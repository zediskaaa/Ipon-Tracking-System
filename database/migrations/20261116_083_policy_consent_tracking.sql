-- Migration 083: Per-account Terms of Use & Privacy Policy acceptance tracking

begin;

alter table public.profiles
  add column if not exists policy_accepted_version text,
  add column if not exists policy_accepted_at timestamptz;

create or replace function public.accept_current_policy(
  p_version text default '2026-11-16'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_version text := coalesce(nullif(btrim(p_version), ''), '2026-11-16');
  v_saved record;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if char_length(v_version) < 3 or char_length(v_version) > 40 then
    raise exception 'Invalid policy version.' using errcode = '22023';
  end if;

  update public.profiles
  set policy_accepted_version = v_version,
      policy_accepted_at = now()
  where id = v_uid
  returning policy_accepted_version, policy_accepted_at into v_saved;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'policy_accepted_version', v_saved.policy_accepted_version,
    'policy_accepted_at', v_saved.policy_accepted_at
  );
end;
$$;

revoke execute on function public.accept_current_policy(text) from public, anon;
grant execute on function public.accept_current_policy(text) to authenticated;

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

insert into public.schema_migrations (version, name)
values ('20261116_083', 'per-account terms and privacy policy acceptance tracking')
on conflict (version) do nothing;

commit;
