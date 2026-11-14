begin;

alter table public.notifications
  add column if not exists dedupe_key text;

delete from public.notifications
where id in (
  select id
  from (
    select
      n.id,
      row_number() over (
        partition by
          n.recipient_id,
          coalesce(n.group_id::text, ''),
          regexp_replace(n.title, ' reacted .*$', ''),
          regexp_replace(n.message, '^Reacted .*? to ', '')
        order by n.created_at desc, n.id desc
      ) as rn
    from public.notifications n
    where n.type = 'ANNOUNCEMENT_REACTION'
      and n.dedupe_key is null
  ) ranked
  where ranked.rn > 1
);

create unique index if not exists notifications_recipient_dedupe_uidx
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;

alter table public.notifications replica identity full;

create or replace function public.notify_announcement_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement_id uuid := case when tg_op = 'DELETE' then old.announcement_id else new.announcement_id end;
  v_actor_id uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_dedupe_key text;
  v_announcement record;
  v_recipient record;
  v_reactor_name text := 'A user';
  v_announcement_label text := 'your announcement';
  v_title_prefix text;
  v_message_suffix text;
  v_reaction_label text;
  v_title text;
  v_message text;
  v_link text;
begin
  if tg_op = 'UPDATE' and new.reaction is not distinct from old.reaction then
    return new;
  end if;

  v_dedupe_key := 'ANNOUNCEMENT_REACTION:' || v_announcement_id::text || ':' || v_actor_id::text;

  select coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), ''),
    nullif(btrim(p.email), ''),
    'A user'
  )
  into v_reactor_name
  from public.profiles p
  where p.id = v_actor_id;

  select a.id, a.group_id, a.author_id, a.title, a.deleted_at
  into v_announcement
  from public.announcements a
  where a.id = v_announcement_id;

  if found then
    v_announcement_label := coalesce(nullif(btrim(v_announcement.title), ''), 'your announcement');
  end if;

  v_title_prefix := left(v_reactor_name, 95) || ' reacted ';
  v_message_suffix := ' to "' || left(v_announcement_label, 120) || '".';

  if tg_op = 'DELETE' then
    delete from public.notifications n
    where n.type = 'ANNOUNCEMENT_REACTION'
      and (
        n.dedupe_key = v_dedupe_key
        or (
          n.dedupe_key is null
          and left(n.title, char_length(v_title_prefix)) = v_title_prefix
          and right(n.message, char_length(v_message_suffix)) = v_message_suffix
        )
      );
    return old;
  end if;

  if not found or v_announcement.deleted_at is not null then
    return new;
  end if;

  v_reaction_label := case new.reaction
    when '👍' then 'Like'
    when '❤️' then 'Love'
    when '😆' then 'Haha'
    when '😮' then 'Wow'
    when '😢' then 'Sad'
    when '😡' then 'Angry'
    else new.reaction
  end;

  v_title := left(v_reactor_name, 95) || ' reacted ' || new.reaction;
  v_message := 'Reacted ' || v_reaction_label || ' (' || new.reaction || ') to "' || left(v_announcement_label, 120) || '".';

  for v_recipient in
    select p.id, p.role
    from public.profiles p
    where p.status = 'ACTIVE'
      and p.notifications_enabled
      and p.id is distinct from v_actor_id
      and (
        p.id = v_announcement.author_id
        or (v_announcement.group_id is null and p.role = 'SUPER_ADMIN')
      )
  loop
    v_link := case when v_recipient.role = 'SUPER_ADMIN' then 'super-admin.html#announcements' else 'dashboard.html' end;

    delete from public.notifications n
    where n.recipient_id = v_recipient.id
      and n.type = 'ANNOUNCEMENT_REACTION'
      and n.dedupe_key is null
      and left(n.title, char_length(v_title_prefix)) = v_title_prefix
      and right(n.message, char_length(v_message_suffix)) = v_message_suffix;

    insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
    values (v_recipient.id, v_announcement.group_id, 'ANNOUNCEMENT_REACTION', btrim(v_title), btrim(v_message), v_link, v_dedupe_key)
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null
    do update set
      group_id = excluded.group_id,
      title = excluded.title,
      message = excluded.message,
      link = excluded.link,
      read_at = null,
      created_at = now();
  end loop;

  return new;
end;
$$;

revoke execute on function public.notify_announcement_reaction() from public, anon, authenticated;

drop trigger if exists announcement_reactions_notifications on public.announcement_reactions;
create trigger announcement_reactions_notifications
  after insert or update or delete on public.announcement_reactions
  for each row execute function public.notify_announcement_reaction();

insert into public.schema_migrations (version, name)
values ('20261114_051', 'replace or remove prior announcement reaction notifications instead of stacking duplicates')
on conflict (version) do nothing;

commit;
