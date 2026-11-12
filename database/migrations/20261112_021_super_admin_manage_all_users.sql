-- Allow Super Admin user management RPCs and activity visibility to operate on all group user roles (ADMIN, TREASURER, MEMBER).

begin;

create or replace function public.super_admin_update_administrator(
  p_user_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_group_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.validated_name_part(p_first_name, 'First name');
  v_middle text := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last text := public.validated_name_part(p_last_name, 'Last name');
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can edit user accounts.' using errcode = '42501';
  end if;

  select role into v_role
  from public.profiles
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER');

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' and char_length(btrim(coalesce(p_group_name, ''))) not between 2 and 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  update public.profiles
  set first_name = v_first,
      middle_name = v_middle,
      last_name = v_last,
      full_name = concat_ws(' ', v_first, v_middle, v_last)
  where id = p_user_id;

  if v_role = 'ADMIN' then
    update public.groups set name = btrim(p_group_name) where owner_id = p_user_id;
  end if;
end;
$$;

create or replace function public.super_admin_set_administrator_status(
  p_user_id uuid,
  p_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can change account status.' using errcode = '42501';
  end if;

  if p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'Account status must be ACTIVE or DISABLED.' using errcode = '22023';
  end if;

  update public.profiles
  set status = p_status
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups
    set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'SUSPENDED' end
    where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_STATUS',
    'Account status changed',
    'A user account is now ' || lower(p_status::text) || '.',
    'super-admin.html#administrators'
  );
end;
$$;

create or replace function public.super_admin_archive_administrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can archive user accounts.' using errcode = '42501';
  end if;

  update public.profiles
  set status = 'DISABLED'
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups set status = 'SUSPENDED' where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_ARCHIVED',
    'Account archived',
    'A user account was disabled.',
    'super-admin.html#administrators'
  );
end;
$$;

drop policy if exists account_activity_select on public.account_activity;
create policy account_activity_select on public.account_activity for select to authenticated
using (
  user_id = auth.uid()
  or (
    public.is_super_admin()
    and exists (
      select 1 from public.profiles p
      where p.id = user_id and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
    )
  )
);

insert into public.schema_migrations (version, name)
values ('20261112_021', 'super admin manage all users')
on conflict (version) do nothing;

commit;

