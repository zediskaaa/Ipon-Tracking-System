-- Migration 20261112_030: Restore SUPER_ADMIN (Owner) and cross-group announcement author avatar lookup.
begin;

create or replace function public.announcement_author_avatar(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.avatar_url
  from public.profiles p
  where p.id = p_author_id
    and p.status = 'ACTIVE'
    and public.current_user_role() is not null
    and (
      p.role = 'SUPER_ADMIN'
      or public.current_user_role() = 'SUPER_ADMIN'
      or (
        public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
        and public.current_group_id() is not null
        and (
          exists (
            select 1
            from public.group_memberships gm
            where gm.user_id = p.id
              and gm.group_id = public.current_group_id()
              and gm.role = 'ADMIN'
              and gm.status = 'ACTIVE'
          )
          or (
            p.role = 'ADMIN'
            and p.group_id = public.current_group_id()
          )
        )
      )
    )
  limit 1;
$$;

revoke execute on function public.announcement_author_avatar(uuid) from public, anon;
grant execute on function public.announcement_author_avatar(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_030', 'restore owner and multi-group announcement author avatars')
on conflict (version) do nothing;

commit;

