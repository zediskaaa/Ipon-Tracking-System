-- Allow group administrators to either transfer group admin ownership and leave,
-- or permanently delete a savings group and all of its scoped records.
begin;

create or replace function public.admin_transfer_and_leave_group(
  p_group_id uuid,
  p_new_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_group uuid := public.current_group_id();
  v_actor_name text;
  v_group public.groups;
  v_target_gm public.group_memberships;
  v_old_member_id uuid;
  v_next_gm public.group_memberships;
  v_next_member_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_admin() or v_actor_group is null or v_actor_group is distinct from p_group_id then
    raise exception 'Only the active administrator of this group can transfer ownership.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_actor_group and status = 'ACTIVE';

  if not found then
    raise exception 'Active savings group not found.' using errcode = 'P0002';
  end if;

  if p_new_admin_user_id is null or p_new_admin_user_id = v_actor_id then
    raise exception 'Choose another active member in this group to receive the administrator role.' using errcode = '22023';
  end if;

  select gm.* into v_target_gm
  from public.group_memberships gm
  join public.profiles p on p.id = gm.user_id
  where gm.group_id = v_actor_group
    and gm.user_id = p_new_admin_user_id
    and gm.status = 'ACTIVE'
    and p.status = 'ACTIVE'
    and p.role <> 'SUPER_ADMIN';

  if not found then
    raise exception 'Selected user must be an active member or treasurer of this savings group.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name
  from public.profiles
  where id = v_actor_id;

  update public.groups
  set owner_id = p_new_admin_user_id
  where id = v_actor_group;

  update public.group_memberships
  set role = 'ADMIN'
  where group_id = v_actor_group
    and user_id = p_new_admin_user_id;

  update public.profiles
  set role = 'ADMIN'
  where id = p_new_admin_user_id
    and group_id = v_actor_group;

  delete from public.group_memberships
  where group_id = v_actor_group
    and user_id = v_actor_id
  returning member_id into v_old_member_id;

  if v_old_member_id is not null then
    update public.members
    set status = 'INACTIVE',
        deactivated_at = now(),
        updated_by = v_actor_id
    where id = v_old_member_id
      and group_id = v_actor_group
      and deleted_at is null;

    delete from public.contribution_periods cp
    where cp.member_id = v_old_member_id
      and cp.group_id = v_actor_group
      and not exists (
        select 1 from public.contributions c
        where c.contribution_period_id = cp.id
      );
  end if;

  select gm.* into v_next_gm
  from public.group_memberships gm
  join public.groups g on g.id = gm.group_id
  where gm.user_id = v_actor_id
    and gm.status = 'ACTIVE'
    and g.status = 'ACTIVE'
  order by gm.created_at asc
  limit 1;

  if found then
    v_next_member_id := null;
    if v_next_gm.member_id is not null then
      select m.id into v_next_member_id
      from public.members m
      where m.id = v_next_gm.member_id
        and m.group_id = v_next_gm.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null;
    end if;

    update public.profiles
    set group_id = v_next_gm.group_id,
        role = v_next_gm.role,
        member_id = v_next_member_id
    where id = v_actor_id;
  else
    update public.profiles
    set group_id = null,
        role = 'MEMBER',
        member_id = null
    where id = v_actor_id;
  end if;

  perform public.push_notification(
    p_new_admin_user_id,
    'GROUP_ADMIN_TRANSFERRED',
    'You are now group administrator',
    coalesce(nullif(btrim(v_actor_name), ''), 'The previous administrator')
      || ' transferred administrator ownership of "' || v_group.name || '" to you.',
    'dashboard.html',
    v_actor_group
  );

  return jsonb_build_object(
    'group_id', v_actor_group,
    'transferred_to', p_new_admin_user_id,
    'next_group_id', v_next_gm.group_id
  );
end;
$$;

create or replace function public.admin_delete_group(
  p_group_id uuid,
  p_confirm_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_group uuid := public.current_group_id();
  v_group public.groups;
  v_affected_users uuid[];
  v_uid uuid;
  v_next_gm public.group_memberships;
  v_next_member_id uuid;
  v_actor_next_group_id uuid := null;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_admin() or v_actor_group is null or v_actor_group is distinct from p_group_id then
    raise exception 'Only the active administrator of this group can delete it.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_actor_group;

  if not found then
    raise exception 'Savings group not found.' using errcode = 'P0002';
  end if;

  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_group.name)) then
    raise exception 'Group name confirmation does not match "%".', v_group.name using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct u.user_id), '{}'::uuid[])
  into v_affected_users
  from (
    select p.id as user_id
    from public.profiles p
    where p.group_id = v_actor_group and p.role <> 'SUPER_ADMIN'
    union
    select gm.user_id
    from public.group_memberships gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = v_actor_group and p.role <> 'SUPER_ADMIN'
  ) u;

  -- Delete scoped records while the actor still holds current_group_id() = v_actor_group
  -- so enforce_group_scope() and write_audit_log() pass cleanly.
  delete from public.contributions where group_id = v_actor_group;
  delete from public.contribution_periods where group_id = v_actor_group;
  delete from public.expenses where group_id = v_actor_group;
  delete from public.withdrawals where group_id = v_actor_group;
  delete from public.savings_goals where group_id = v_actor_group;
  delete from public.contribution_settings where group_id = v_actor_group;

  update public.profiles
  set member_id = null
  where member_id in (select id from public.members where group_id = v_actor_group);

  update public.group_memberships
  set member_id = null
  where group_id = v_actor_group;

  delete from public.members where group_id = v_actor_group;

  -- Cascades group_memberships, announcements, notifications, and savings_calculator_plans,
  -- and sets profiles.group_id / audit_logs.group_id to NULL.
  delete from public.groups where id = v_actor_group;

  foreach v_uid in array v_affected_users loop
    if exists (select 1 from public.profiles p where p.id = v_uid and p.group_id is null) then
      select gm.* into v_next_gm
      from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
      where gm.user_id = v_uid
        and gm.status = 'ACTIVE'
        and g.status = 'ACTIVE'
      order by gm.created_at asc
      limit 1;

      if found then
        v_next_member_id := null;
        if v_next_gm.member_id is not null then
          select m.id into v_next_member_id
          from public.members m
          where m.id = v_next_gm.member_id
            and m.group_id = v_next_gm.group_id
            and m.status = 'ACTIVE'
            and m.deleted_at is null;
        end if;

        update public.profiles
        set group_id = v_next_gm.group_id,
            role = v_next_gm.role,
            member_id = v_next_member_id
        where id = v_uid;

        if v_uid = v_actor_id then
          v_actor_next_group_id := v_next_gm.group_id;
        end if;
      else
        update public.profiles
        set group_id = null,
            role = 'MEMBER',
            member_id = null
        where id = v_uid;
      end if;
    end if;

    if v_uid <> v_actor_id then
      perform public.push_notification(
        v_uid,
        'GROUP_DELETED',
        'Savings group deleted',
        '"' || v_group.name || '" was permanently deleted by its administrator.',
        'dashboard.html',
        null
      );
    end if;
  end loop;

  return jsonb_build_object(
    'deleted_group_id', v_actor_group,
    'deleted_group_name', v_group.name,
    'next_group_id', v_actor_next_group_id
  );
end;
$$;

revoke execute on function public.admin_transfer_and_leave_group(uuid, uuid) from public, anon;
revoke execute on function public.admin_delete_group(uuid, text) from public, anon;

grant execute on function public.admin_transfer_and_leave_group(uuid, uuid) to authenticated;
grant execute on function public.admin_delete_group(uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_054', 'allow group admins to transfer ownership and leave or permanently delete a group')
on conflict (version) do nothing;

commit;
