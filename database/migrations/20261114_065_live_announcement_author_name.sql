-- Migration 20261114_065: Keep announcement author_name live with profile full_name changes.
begin;

create or replace function public.announcement_author_name(p_author_id uuid, p_fallback text default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select nullif(btrim(p.full_name), '')
      from public.profiles p
      where p.id = p_author_id
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
      limit 1
    ),
    nullif(btrim(p_fallback), ''),
    'Administrator'
  );
$$;

revoke execute on function public.announcement_author_name(uuid, text) from public, anon;
grant execute on function public.announcement_author_name(uuid, text) to authenticated;

create or replace view public.v_announcements
with (security_invoker = true)
as
select a.id,
       a.group_id,
       a.author_id,
       public.announcement_author_name(a.author_id, a.author_name) as author_name,
       a.author_role,
       public.announcement_author_avatar(a.author_id) as author_avatar_url,
       a.title,
       a.description,
       a.attachments,
       a.created_at,
       a.announcement_type,
       a.release_version
from public.announcements a
where a.deleted_at is null;

revoke all on public.v_announcements from public, anon;
grant select on public.v_announcements to authenticated;

create or replace function public.sync_announcement_author_name_on_profile_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.full_name is distinct from old.full_name and nullif(btrim(new.full_name), '') is not null then
    update public.announcements
    set author_name = new.full_name
    where author_id = new.id
      and author_name is distinct from new.full_name;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_announcement_author_name on public.profiles;
create trigger trg_profiles_sync_announcement_author_name
  after update of full_name on public.profiles
  for each row
  execute function public.sync_announcement_author_name_on_profile_update();

update public.announcements a
set author_name = p.full_name
from public.profiles p
where a.author_id = p.id
  and nullif(btrim(p.full_name), '') is not null
  and a.author_name is distinct from p.full_name;

insert into public.schema_migrations (version, name)
values ('20261114_065', 'live announcement author name')
on conflict (version) do nothing;

commit;

