-- Automatically remove announcement and reaction notifications whenever an announcement is soft-deleted or permanently deleted.
begin;

create or replace function public.cleanup_deleted_announcement_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements;
  v_id text;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  elsif tg_op = 'UPDATE' and old.deleted_at is null and new.deleted_at is not null then
    v_row := new;
  else
    return coalesce(new, old);
  end if;

  v_id := v_row.id::text;

  delete from public.notifications n
  where n.type in ('ANNOUNCEMENT', 'RELEASE', 'PLATFORM_ANNOUNCEMENT', 'ANNOUNCEMENT_REACTION')
    and (
      coalesce(n.link, '') like ('%announcement=' || v_id || '%')
      or coalesce(n.dedupe_key, '') like ('ANNOUNCEMENT_REACTION:' || v_id || ':%')
      or (
        coalesce(n.link, '') in ('', 'dashboard.html')
        and coalesce(v_row.title, '') <> ''
        and (
          n.title = ('Announcement: ' || left(v_row.title, 80))
          or n.title = ('Platform update: ' || left(v_row.title, 75))
          or (
            v_row.release_version is not null
            and n.title = ('Update ' || v_row.release_version || ': ' || left(v_row.title, 65))
          )
        )
        and coalesce(n.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(v_row.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
      )
    );

  return coalesce(new, old);
end;
$$;

revoke all on function public.cleanup_deleted_announcement_notifications() from public, anon, authenticated;

drop trigger if exists announcements_cleanup_deleted_notifications on public.announcements;
create trigger announcements_cleanup_deleted_notifications
  after update of deleted_at or delete on public.announcements
  for each row
  execute function public.cleanup_deleted_announcement_notifications();

-- Clean up any notifications pointing to already-deleted or removed announcements
delete from public.notifications n
where n.type in ('ANNOUNCEMENT', 'RELEASE', 'PLATFORM_ANNOUNCEMENT', 'ANNOUNCEMENT_REACTION')
  and (
    exists (
      select 1
      from public.announcements a
      where a.deleted_at is not null
        and (
          coalesce(n.link, '') like ('%announcement=' || a.id::text || '%')
          or coalesce(n.dedupe_key, '') like ('ANNOUNCEMENT_REACTION:' || a.id::text || ':%')
          or (
            coalesce(n.link, '') in ('', 'dashboard.html')
            and coalesce(a.title, '') <> ''
            and (
              n.title = ('Announcement: ' || left(a.title, 80))
              or n.title = ('Platform update: ' || left(a.title, 75))
              or (
                a.release_version is not null
                and n.title = ('Update ' || a.release_version || ': ' || left(a.title, 65))
              )
            )
            and coalesce(n.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(a.group_id, '00000000-0000-0000-0000-000000000000'::uuid)
          )
        )
    )
    or (
      coalesce(n.link, '') ~* 'announcement=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      and not exists (
        select 1
        from public.announcements a
        where a.deleted_at is null
          and coalesce(n.link, '') like ('%announcement=' || a.id::text || '%')
      )
    )
    or (
      coalesce(n.dedupe_key, '') ~* '^ANNOUNCEMENT_REACTION:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:'
      and not exists (
        select 1
        from public.announcements a
        where a.deleted_at is null
          and n.dedupe_key like ('ANNOUNCEMENT_REACTION:' || a.id::text || ':%')
      )
    )
  );

insert into public.schema_migrations (version, name)
values ('20261117_097', 'cleanup deleted announcement notifications automatically')
on conflict (version) do nothing;

commit;
