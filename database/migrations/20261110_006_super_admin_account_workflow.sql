begin;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text := btrim(coalesce(p_group_name, ''));
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501';
  end if;
  if char_length(v_group_name) < 2 or char_length(v_group_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  update public.profiles
  set role = 'ADMIN', status = 'ACTIVE', member_id = null
  where id = p_user_id
    and role = 'MEMBER'
    and status = 'PENDING'
    and group_id is null
    and member_id is null;

  if not found then
    raise exception 'Pending administrator request not found.' using errcode = 'P0002';
  end if;

  insert into public.groups (name, owner_id)
  values (v_group_name, p_user_id)
  returning id into v_group_id;

  update public.profiles set group_id = v_group_id where id = p_user_id;
  return v_group_id;
end;
$$;

create or replace function public.super_admin_reject_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501';
  end if;

  update public.profiles
  set status = 'DISABLED'
  where id = p_user_id
    and role = 'MEMBER'
    and status = 'PENDING'
    and group_id is null
    and member_id is null;

  if not found then
    raise exception 'Pending administrator request not found.' using errcode = 'P0002';
  end if;
end;
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (
    public.is_super_admin()
    and (
      role in ('SUPER_ADMIN', 'ADMIN')
      or (role = 'MEMBER' and group_id is null and member_id is null)
    )
  )
  or (public.is_admin() and group_id = public.current_group_id())
);

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (
  (
    public.is_super_admin()
    and (
      table_name = 'groups'
      or (
        table_name = 'profiles'
        and (
          group_id is null
          or coalesce(new_data ->> 'role', old_data ->> 'role') in ('SUPER_ADMIN', 'ADMIN')
        )
      )
    )
  )
  or (public.is_admin() and group_id = public.current_group_id())
);

revoke execute on function public.super_admin_approve_request(uuid, text) from public, anon;
revoke execute on function public.super_admin_reject_request(uuid) from public, anon;
grant execute on function public.super_admin_approve_request(uuid, text) to authenticated;
grant execute on function public.super_admin_reject_request(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261110_006', 'super administrator account workflow')
on conflict (version) do nothing;

commit;
