-- Migration 078: Keep audit_logs focused on financial, member, group, and account governance events
-- Excludes ephemeral messaging/presence fields (last_seen_at, chat_privacy, username, bio, metadata timestamps)
-- and purges historical non-applicable profile presence/noise entries.

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
    'idempotency_key'
  ];
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) - v_noise_keys else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) - v_noise_keys else null end;

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

delete from public.audit_logs
where table_name not in (
  'profiles',
  'groups',
  'members',
  'contribution_settings',
  'contribution_periods',
  'contributions',
  'withdrawals',
  'expenses',
  'savings_goals'
)
or (
  action = 'UPDATE'
  and (
    coalesce(old_data, '{}'::jsonb) - array[
      'updated_at',
      'created_at',
      'last_seen_at',
      'chat_privacy',
      'username',
      'bio',
      'name_setup_required',
      'previous_account_status',
      'idempotency_key'
    ]
  ) = (
    coalesce(new_data, '{}'::jsonb) - array[
      'updated_at',
      'created_at',
      'last_seen_at',
      'chat_privacy',
      'username',
      'bio',
      'name_setup_required',
      'previous_account_status',
      'idempotency_key'
    ]
  )
);

insert into public.schema_migrations (version, name)
values ('20261115_078', 'filter audit log to governance and financial events')
on conflict (version) do nothing;

commit;
