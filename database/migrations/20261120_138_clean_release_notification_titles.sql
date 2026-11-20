begin;

create or replace function public.notify_announcement_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient record;
  v_notif_type text;
  v_clean_title text := btrim(regexp_replace(coalesce(new.title, ''), '^Update\s+Update\s+', 'Update ', 'i'));
  v_clean_version text := btrim(coalesce(new.release_version, ''));
  v_ver_num text;
  v_title text;
  v_preview text := left(btrim(new.description), 160);
  v_link text := 'dashboard.html?announcement=' || new.id::text;
begin
  if new.group_id is not null then
    v_title := case
      when v_clean_title ~* '^Announcement\b' then left(v_clean_title, 90)
      else 'Announcement: ' || left(v_clean_title, 80)
    end;

    for v_recipient in
      select distinct u.id
      from (
        select gm.user_id as id
        from public.group_memberships gm
        where gm.group_id = new.group_id
          and gm.status = 'ACTIVE'
        union
        select p.id
        from public.profiles p
        where p.group_id = new.group_id
          and p.status = 'ACTIVE'
      ) u
      join public.profiles p on p.id = u.id
      where p.id is distinct from new.author_id
        and p.status = 'ACTIVE'
        and p.notifications_enabled
    loop
      perform public.push_notification(
        v_recipient.id,
        'ANNOUNCEMENT',
        v_title,
        v_preview,
        v_link,
        new.group_id
      );
    end loop;
  else
    v_notif_type := case when new.announcement_type = 'RELEASE' then 'RELEASE' else 'PLATFORM_ANNOUNCEMENT' end;
    v_ver_num := nullif(btrim(regexp_replace(v_clean_version, '^(?:update|release|version)\s+', '', 'i')), '');

    if new.announcement_type = 'RELEASE' and v_ver_num is not null then
      if v_clean_title <> '' and position(lower(v_ver_num) in lower(v_clean_title)) > 0 then
        v_title := left(v_clean_title, 90);
      elsif v_clean_title <> '' then
        v_title := (case when v_ver_num ~* '^v\d' then v_ver_num else 'v' || v_ver_num end) || ': ' || left(v_clean_title, 75);
      else
        v_title := 'Release ' || v_ver_num;
      end if;
    else
      v_title := coalesce(nullif(left(v_clean_title, 90), ''), 'Platform announcement');
    end if;

    for v_recipient in
      select p.id
      from public.profiles p
      where p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and p.status = 'ACTIVE'
        and p.notifications_enabled
        and p.id is distinct from new.author_id
    loop
      perform public.push_notification(
        v_recipient.id,
        v_notif_type,
        v_title,
        v_preview,
        v_link,
        null
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.notify_announcement_created() from public, anon, authenticated;

update public.notifications
set title = regexp_replace(title, '^Update\s+Update\s+', 'Update ', 'i')
where type = 'RELEASE'
  and title ~* '^Update\s+Update\s+';

update public.notifications
set title = left(btrim(regexp_replace(title, '^Update\s+v?[0-9]+(?:\.[0-9]+)*\s*:\s*', '', 'i')), 90)
where type = 'RELEASE'
  and title ~* '^Update\s+v?([0-9]+(?:\.[0-9]+)*)\s*:\s*.*\1';

update public.notifications
set title = left(regexp_replace(title, '^Update\s+([0-9]+(?:\.[0-9]+)*)\s*:\s*', 'v\1: ', 'i'), 90)
where type = 'RELEASE'
  and title ~* '^Update\s+[0-9]+(?:\.[0-9]+)*\s*:\s*';

insert into public.schema_migrations (version, name)
values ('20261120_138', 'remove redundant update prefixes from release and platform announcement notification titles')
on conflict (version) do nothing;

commit;
