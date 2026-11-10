begin;

create or replace function public.admin_set_user_access(
  p_user_id uuid,
  p_role public.app_role,
  p_status public.account_status,
  p_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change user access.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() and p_status <> 'ACTIVE' then
    raise exception 'You cannot disable or set your own administrator account to pending.' using errcode = '22023';
  end if;

  if (p_role <> 'ADMIN' or p_status <> 'ACTIVE')
     and exists (select 1 from public.profiles where id = p_user_id and role = 'ADMIN' and status = 'ACTIVE')
     and not exists (select 1 from public.profiles where id <> p_user_id and role = 'ADMIN' and status = 'ACTIVE') then
    raise exception 'Assign another active administrator before changing this administrator''s role or status.' using errcode = '22023';
  end if;

  update public.profiles
  set role = p_role, status = p_status, member_id = p_member_id
  where id = p_user_id;

  if not found then
    raise exception 'User profile not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) from public, anon;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261110_003', 'standardize administrator access errors in English')
on conflict (version) do nothing;

commit;
