begin;

create or replace function public.notify_announcement_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement record;
  v_recipient record;
  v_reactor_name text := 'A user';
  v_reaction_label text;
begin
  if tg_op = 'UPDATE' and new.reaction is not distinct from old.reaction then
    return new;
  end if;

  select a.id, a.group_id, a.author_id, a.title, a.deleted_at
  into v_announcement
  from public.announcements a
  where a.id = new.announcement_id;

  if not found or v_announcement.deleted_at is not null then
    return new;
  end if;

  select coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), ''),
    nullif(btrim(p.email), ''),
    'A user'
  )
  into v_reactor_name
  from public.profiles p
  where p.id = new.user_id;

  v_reaction_label := case new.reaction
    when '👍' then 'Like'
    when '❤️' then 'Love'
    when '😆' then 'Haha'
    when '😮' then 'Wow'
    when '😢' then 'Sad'
    when '😡' then 'Angry'
    else new.reaction
  end;

  for v_recipient in
    select p.id, p.role
    from public.profiles p
    where p.status = 'ACTIVE'
      and p.notifications_enabled
      and p.id is distinct from new.user_id
      and (
        p.id = v_announcement.author_id
        or (v_announcement.group_id is null and p.role = 'SUPER_ADMIN')
      )
  loop
    perform public.push_notification(
      v_recipient.id,
      'ANNOUNCEMENT_REACTION',
      left(v_reactor_name, 95) || ' reacted ' || new.reaction,
      'Reacted ' || v_reaction_label || ' (' || new.reaction || ') to "' || left(coalesce(nullif(btrim(v_announcement.title), ''), 'your announcement'), 120) || '".',
      case when v_recipient.role = 'SUPER_ADMIN' then 'super-admin.html#overview' else 'dashboard.html' end,
      v_announcement.group_id
    );
  end loop;

  return new;
end;
$$;

revoke execute on function public.notify_announcement_reaction() from public, anon, authenticated;

drop trigger if exists announcement_reactions_notifications on public.announcement_reactions;
create trigger announcement_reactions_notifications
  after insert or update on public.announcement_reactions
  for each row execute function public.notify_announcement_reaction();

insert into public.schema_migrations (version, name)
values ('20261114_048', 'notify super admin and announcement authors when users react to announcements')
on conflict (version) do nothing;

commit;
