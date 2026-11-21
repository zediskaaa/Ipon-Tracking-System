-- Migration 155: Make workspace creation (Group & Solo) unrestricted for all signed-in active users
-- Self-heals missing profile rows, allows creation inserts through enforce_group_scope() via transaction-local GUC,
-- and aligns monthly amount validation bounds cleanly (1 to 1,000,000).

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

create or replace function public.admin_create_group(
  p_name text,
  p_avatar_url text default null,
  p_include_self boolean default false,
  p_monthly_amount numeric default 100,
  p_workspace_mode text default 'GROUP'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_new_group_id uuid;
  v_amount numeric := round(coalesce(p_monthly_amount, 100), 2);
  v_mode text := upper(btrim(coalesce(p_workspace_mode, 'GROUP')));
  v_include_self boolean;
  v_user_email text;
  v_user_full_name text;
begin
  if v_uid is null then
    raise exception 'Sign in first before creating a savings workspace.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'DISABLED') then
    raise exception 'Your account is deactivated or disabled.' using errcode = '42501';
  end if;
  if public.is_super_admin() then
    raise exception 'Super administrators manage platform access from the Super Admin console.' using errcode = '42501';
  end if;
  if v_mode not in ('SOLO', 'GROUP') then
    raise exception 'Workspace mode must be SOLO or GROUP.' using errcode = '22023';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Workspace name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;
  if not public.is_valid_media_reference(p_avatar_url) then
    raise exception 'Workspace picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_amount < 1 or v_amount > 1000000 then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  v_include_self := case when v_mode = 'SOLO' then true else coalesce(p_include_self, false) end;

  insert into public.groups (name, owner_id, avatar_url, status, workspace_mode)
  values (v_name, v_uid, p_avatar_url, 'ACTIVE', v_mode)
  returning id into v_new_group_id;

  perform set_config('ipon.creating_group_id', v_new_group_id::text, true);

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_new_group_id, v_uid, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  update public.profiles
  set group_id = v_new_group_id,
      role = 'ADMIN',
      status = 'ACTIVE',
      member_id = null
  where id = v_uid;

  if not found then
    select u.email,
           coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), 'Savings Member')
    into v_user_email, v_user_full_name
    from auth.users u
    where u.id = v_uid;

    insert into public.profiles (id, email, full_name, role, status, group_id, member_id)
    values (v_uid, v_user_email, coalesce(v_user_full_name, 'Savings Member'), 'ADMIN', 'ACTIVE', v_new_group_id, null)
    on conflict (id) do update
    set group_id = v_new_group_id,
        role = 'ADMIN',
        status = 'ACTIVE',
        member_id = null;
  end if;

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_new_group_id, date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date, v_amount, v_uid);

  if v_include_self then
    perform public.set_admin_contributor(true, v_amount);
  end if;

  return v_new_group_id;
end;
$$;

revoke all on function public.admin_create_group(text, text, boolean, numeric, text) from public, anon;
grant execute on function public.admin_create_group(text, text, boolean, numeric, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_155', 'unrestricted_workspace_creation')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
