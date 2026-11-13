-- Migration 20261113_040: Super Admin account deactivation, deletion with reasons and email notification
begin;

-- 1. Ensure groups.owner_id sets null on profile deletion
alter table public.groups
  drop constraint if exists groups_owner_id_fkey;

alter table public.groups
  add constraint groups_owner_id_fkey
  foreign key (owner_id) references public.profiles(id)
  on delete set null;

-- 2. Super admin delete user RPC
create or replace function public.super_admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can delete user accounts.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'You cannot delete your own super administrator account.' using errcode = '22023';
  end if;

  select role into v_role
  from public.profiles
  where id = p_user_id;

  if not found or v_role = 'SUPER_ADMIN' then
    raise exception 'User account not found or cannot be deleted.' using errcode = 'P0002';
  end if;

  -- Suspend any groups owned by this user
  update public.groups
  set owner_id = null,
      status = 'SUSPENDED'
  where owner_id = p_user_id;

  -- Remove group memberships
  delete from public.group_memberships
  where user_id = p_user_id;

  -- Remove profile
  delete from public.profiles
  where id = p_user_id;

  perform public.push_notification(
    auth.uid(),
    'USER_DELETED',
    'Account deleted',
    'A user account was permanently deleted.',
    'super-admin.html#administrators'
  );
end;
$$;

revoke execute on function public.super_admin_delete_user(uuid) from public, anon;
grant execute on function public.super_admin_delete_user(uuid) to authenticated;

-- 3. Record migration
insert into public.schema_migrations (version, name)
values ('20261113_040', 'super admin account actions with reasons and safe delete')
on conflict (version) do nothing;

commit;
