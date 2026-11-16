-- Use nested IF branches by tg_op and tg_table_name inside enforce_group_scope()
-- so PL/pgSQL never evaluates table-specific columns (e.g. members.activation_status
-- or contribution_periods.member_id) on trigger rows from other tables.

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

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_089', 'fix enforce_group_scope PL/pgSQL cross-table field evaluation using nested IFs')
on conflict (version) do nothing;

commit;
