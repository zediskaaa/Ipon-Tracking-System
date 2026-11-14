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
begin
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

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261114_053', 'use jsonb old/new inspection in enforce_group_scope so tables without amount do not fail')
on conflict (version) do nothing;

commit;

