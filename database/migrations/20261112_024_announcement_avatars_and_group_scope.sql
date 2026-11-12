-- Expose announcer avatars cleanly to permitted readers and restrict admin announcements strictly to their own group members.

begin;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  (public.is_super_admin() and group_id is null)
  or (
    public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
    and (
      group_id is null
      or (public.current_group_id() is not null and group_id = public.current_group_id())
    )
  )
);

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
      or (
        public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
        and p.role = 'ADMIN'
        and public.current_group_id() is not null
        and p.group_id = public.current_group_id()
      )
    );
$$;

create or replace view public.v_announcements
with (security_invoker = true)
as
select a.id,
       a.group_id,
       a.author_id,
       a.author_name,
       a.author_role,
       public.announcement_author_avatar(a.author_id) as author_avatar_url,
       a.title,
       a.description,
       a.attachments,
       a.created_at
from public.announcements a
where a.deleted_at is null;

revoke execute on function public.announcement_author_avatar(uuid) from public, anon;
grant execute on function public.announcement_author_avatar(uuid) to authenticated;

revoke all on public.v_announcements from public, anon;
grant select on public.v_announcements to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_024', 'announcement avatars and group scope')
on conflict (version) do nothing;

commit;

