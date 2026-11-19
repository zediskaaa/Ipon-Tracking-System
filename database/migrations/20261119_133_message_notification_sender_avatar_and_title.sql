-- Migration 20261119_133: Use sender name and display picture in message notifications without "New message from" prefix
begin;

alter table public.notifications
  add column if not exists actor_id uuid references public.profiles(id) on delete set null,
  add column if not exists actor_avatar_url text;

create or replace function public.push_social_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient record;
  v_actor_avatar text := null;
  v_clean_title text := left(btrim(coalesce(p_title, 'Notification')), 120);
  v_clean_msg text := left(btrim(coalesce(p_message, '')), 500);
begin
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;

  if p_type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY') then
    v_clean_title := left(btrim(regexp_replace(v_clean_title, '^(?:New message from|New reply from)\s+', '', 'i')), 120);
  end if;

  if char_length(v_clean_title) < 2 then v_clean_title := 'Message update'; end if;
  if char_length(v_clean_msg) < 1 then v_clean_msg := 'Open Messages to view this update.'; end if;

  if p_actor_id is not null and not public.is_messaging_eligible(p_actor_id) then
    return;
  end if;

  if p_actor_id is not null and public.is_user_blocked_between(p_recipient_id, p_actor_id) then
    return;
  end if;

  select id, status, role, notifications_enabled into v_recipient
  from public.profiles
  where id = p_recipient_id;

  if v_recipient.id is null
     or v_recipient.status <> 'ACTIVE'
     or v_recipient.role not in ('ADMIN', 'TREASURER', 'MEMBER')
     or coalesce(v_recipient.notifications_enabled, true) is not true then
    return;
  end if;

  if p_actor_id is not null then
    select avatar_url into v_actor_avatar
    from public.profiles
    where id = p_actor_id;
  end if;

  if p_dedupe_key is not null and btrim(p_dedupe_key) <> '' then
    insert into public.notifications (
      recipient_id, group_id, type, title, message, link, dedupe_key, actor_id, actor_avatar_url
    )
    values (
      p_recipient_id, null, p_type, v_clean_title, v_clean_msg,
      nullif(btrim(p_link), ''), btrim(p_dedupe_key), p_actor_id, v_actor_avatar
    )
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null
    do update set
      type = excluded.type,
      title = excluded.title,
      message = excluded.message,
      link = excluded.link,
      actor_id = excluded.actor_id,
      actor_avatar_url = excluded.actor_avatar_url,
      read_at = null,
      created_at = now();
  else
    insert into public.notifications (
      recipient_id, group_id, type, title, message, link, actor_id, actor_avatar_url
    )
    values (
      p_recipient_id, null, p_type, v_clean_title, v_clean_msg,
      nullif(btrim(p_link), ''), p_actor_id, v_actor_avatar
    );
  end if;
end;
$$;

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_body text default '',
  p_message_type text default 'TEXT',
  p_reply_to_id uuid default null,
  p_forwarded_from_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_is_self boolean := false;
  v_peer record;
  v_sender record;
  v_clean_body text := btrim(coalesce(p_body, ''));
  v_type text := upper(btrim(coalesce(p_message_type, 'TEXT')));
  v_att_count integer := 0;
  v_msg public.messages%rowtype;
  v_att jsonb;
  v_idx integer := 0;
  v_preview text;
  v_peer_part public.conversation_participants%rowtype;
  v_rec record;
  v_notif_title text;
  v_notif_type text;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select id, full_name into v_sender from public.profiles where id = v_uid;

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    v_is_self := (v_peer_id = v_uid);
    select id, full_name, role, status, chat_privacy into v_peer from public.profiles where id = v_peer_id;
    if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'Recipient is unavailable for messaging.' using errcode = '42501';
    end if;
    if not v_is_self and public.is_user_blocked_between(v_uid, v_peer_id) then
      raise exception 'Cannot send message because one of you has blocked the other.' using errcode = '42501';
    end if;
  end if;

  if v_type not in ('TEXT', 'MEDIA', 'VOICE', 'FORWARDED') then
    v_type := 'TEXT';
  end if;

  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    p_attachments := '[]'::jsonb;
  end if;
  v_att_count := jsonb_array_length(p_attachments);
  if v_att_count > 10 then
    raise exception 'Attach at most 10 files per message.' using errcode = '22023';
  end if;

  if char_length(v_clean_body) = 0 and v_att_count = 0 then
    raise exception 'Enter a message or attach at least one file.' using errcode = '22023';
  end if;
  if char_length(v_clean_body) > 500 then
    raise exception 'Message must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if v_conv.kind = 'DIRECT' and not v_is_self then
    if v_conv.status = 'DECLINED' then
      if not public.are_friends(v_uid, v_peer_id)
         and coalesce(v_peer.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
        raise exception 'This user only accepts messages from friends.' using errcode = '42501';
      end if;
      update public.conversations
      set status = case when public.are_friends(v_uid, v_peer_id) then 'ACCEPTED' else 'PENDING_REQUEST' end,
          initiator_id = v_uid,
          accepted_at = case when public.are_friends(v_uid, v_peer_id) then now() else null end
      where id = v_conv.id
      returning * into v_conv;
    elsif v_conv.status = 'PENDING_REQUEST' and v_conv.initiator_id is distinct from v_uid then
      update public.conversations
      set status = 'ACCEPTED', accepted_at = now()
      where id = v_conv.id
      returning * into v_conv;
    elsif public.are_friends(v_uid, v_peer_id) and v_conv.status = 'PENDING_REQUEST' then
      update public.conversations
      set status = 'ACCEPTED', accepted_at = now()
      where id = v_conv.id
      returning * into v_conv;
    end if;
  end if;

  if p_reply_to_id is not null then
    if not exists (
      select 1 from public.messages m
      where m.id = p_reply_to_id and m.conversation_id = v_conv.id and m.deleted_for_everyone_at is null
    ) then
      raise exception 'The referenced reply message is unavailable.' using errcode = '22023';
    end if;
  end if;

  if p_forwarded_from_id is not null then
    if not exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = p_forwarded_from_id
        and m.deleted_for_everyone_at is null
        and public.is_conversation_member(c.id, v_uid)
        and not (v_uid = any(m.deleted_for_user_ids))
    ) then
      raise exception 'Original forwarded message is unavailable.' using errcode = '42501';
    end if;
    v_type := 'FORWARDED';
  elsif v_att_count > 0 and v_type = 'TEXT' then
    v_type := 'MEDIA';
  end if;

  insert into public.messages (conversation_id, sender_id, body, message_type, reply_to_id, forwarded_from_id, metadata)
  values (v_conv.id, v_uid, v_clean_body, v_type, p_reply_to_id, p_forwarded_from_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_msg;

  for v_att in select value from jsonb_array_elements(p_attachments) loop
    v_idx := v_idx + 1;
    if coalesce(v_att ->> 'path', '') = '' or (v_att ->> 'path') like '%..%' then
      raise exception 'Invalid attachment storage path.' using errcode = '22023';
    end if;
    if (v_att ->> 'path') not like (v_conv.id::text || '/' || v_uid::text || '/%') then
      raise exception 'Attachment ownership check failed.' using errcode = '42501';
    end if;
    insert into public.message_attachments (
      message_id, conversation_id, uploader_id, bucket_id, storage_path,
      file_name, mime_type, file_size, attachment_kind, width, height, duration_seconds
    ) values (
      v_msg.id,
      v_conv.id,
      v_uid,
      'chat-attachments',
      v_att ->> 'path',
      left(coalesce(nullif(btrim(v_att ->> 'name'), ''), 'attachment'), 240),
      left(coalesce(nullif(btrim(v_att ->> 'type'), ''), 'application/octet-stream'), 120),
      greatest(0, least(52428800, coalesce((v_att ->> 'size')::bigint, 0))),
      case when (v_att ->> 'kind') in ('image', 'document', 'audio', 'video', 'file') then (v_att ->> 'kind') else 'file' end,
      nullif((v_att ->> 'width')::integer, 0),
      nullif((v_att ->> 'height')::integer, 0),
      nullif((v_att ->> 'duration_seconds')::integer, 0)
    );
  end loop;

  v_preview := case
    when char_length(v_clean_body) > 0 then left(v_clean_body, 140)
    when v_type = 'VOICE' or (v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'audio') then 'Sent a voice message'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'image' then 'Sent a photo'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'video' then 'Sent a video'
    when v_att_count > 1 then 'Sent ' || v_att_count::text || ' attachments'
    else 'Sent an attachment'
  end;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_uid
  where id = v_conv.id;

  if v_conv.kind = 'DIRECT' then
    insert into public.conversation_participants (conversation_id, user_id)
    values (v_conv.id, v_conv.user_a), (v_conv.id, v_conv.user_b)
    on conflict (conversation_id, user_id) do nothing;

    update public.conversation_participants
    set hidden_at = null,
        is_archived = false,
        marked_unread = false,
        last_read_message_id = v_msg.id,
        last_read_at = now()
    where conversation_id = v_conv.id and user_id = v_uid;

    if not v_is_self then
      insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
      values (v_msg.id, v_peer_id, null, null)
      on conflict (message_id, user_id) do nothing;

      update public.conversation_participants
      set hidden_at = null,
          is_archived = false
      where conversation_id = v_conv.id and user_id = v_peer_id
      returning * into v_peer_part;

      if coalesce(v_peer_part.is_muted, false) is not true then
        if v_conv.status = 'PENDING_REQUEST' then
          v_notif_type := 'SOCIAL_MESSAGE_REQUEST';
          v_notif_title := coalesce(nullif(btrim(v_sender.full_name), ''), 'User');
          perform public.push_social_notification(
            v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
            'dashboard.html?messages=requests&chat=' || v_conv.id::text,
            'SOCIAL_MSG_REQ:' || v_conv.id::text
          );
        else
          v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
          v_notif_title := coalesce(nullif(btrim(v_sender.full_name), ''), 'User');
          perform public.push_social_notification(
            v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
            'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
            'SOCIAL_MSG:' || v_conv.id::text
          );
        end if;
      end if;
    end if;
  else
    insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
    select v_msg.id, cp.user_id, null, null
    from public.conversation_participants cp
    join public.profiles rp on rp.id = cp.user_id
    where cp.conversation_id = v_conv.id
      and cp.user_id <> v_uid
      and rp.status = 'ACTIVE'
      and rp.role in ('ADMIN', 'TREASURER', 'MEMBER')
    on conflict (message_id, user_id) do nothing;

    update public.conversation_participants
    set hidden_at = null,
        marked_unread = false,
        last_read_message_id = v_msg.id,
        last_read_at = now()
    where conversation_id = v_conv.id and user_id = v_uid;

    update public.conversation_participants
    set hidden_at = null,
        is_archived = false
    where conversation_id = v_conv.id and user_id <> v_uid;

    v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
    for v_rec in
      select cp.user_id, cp.is_muted
      from public.conversation_participants cp
      join public.profiles rp on rp.id = cp.user_id
      where cp.conversation_id = v_conv.id
        and cp.user_id <> v_uid
        and rp.status = 'ACTIVE'
        and rp.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, cp.user_id)
    loop
      if coalesce(v_rec.is_muted, false) is not true then
        perform public.push_social_notification(
          v_rec.user_id,
          v_uid,
          v_notif_type,
          coalesce(v_conv.title, 'Group Chat'),
          coalesce(v_sender.full_name, 'Someone') || ': ' || v_preview,
          'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
          'SOCIAL_MSG:' || v_conv.id::text
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'id', v_msg.id,
    'conversation_id', v_msg.conversation_id,
    'sender_id', v_msg.sender_id,
    'body', v_msg.body,
    'message_type', v_msg.message_type,
    'reply_to_id', v_msg.reply_to_id,
    'forwarded_from_id', v_msg.forwarded_from_id,
    'created_at', v_msg.created_at
  );
end;
$$;

update public.notifications
set title = left(btrim(regexp_replace(title, '^(?:New message from|New reply from|Message request from)\s+', '', 'i')), 120)
where type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST')
  and title ~* '^(?:New message from|New reply from|Message request from)\s+'
  and char_length(btrim(regexp_replace(title, '^(?:New message from|New reply from|Message request from)\s+', '', 'i'))) >= 2;

update public.notifications n
set actor_id = coalesce(n.actor_id, p.id),
    actor_avatar_url = coalesce(n.actor_avatar_url, p.avatar_url)
from public.profiles p
where n.type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST', 'SOCIAL_FRIEND_REQUEST', 'SOCIAL_FRIEND_ACCEPTED')
  and n.actor_avatar_url is null
  and lower(btrim(p.full_name)) = lower(btrim(regexp_replace(n.title, '^(?:New message from|New reply from|Message request from)\s+', '', 'i')));

drop function if exists public.get_unread_notifications_by_token(uuid);
create or replace function public.get_unread_notifications_by_token(p_token uuid)
returns table (
  id bigint,
  type text,
  title text,
  message text,
  link text,
  dedupe_key text,
  actor_avatar_url text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    n.id,
    n.type,
    case
      when n.type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST')
        then coalesce(nullif(btrim(regexp_replace(n.title, '^(?:New message from|New reply from|Message request from)\s+', '', 'i')), ''), n.title)
      else n.title
    end as title,
    n.message,
    n.link,
    n.dedupe_key,
    coalesce(n.actor_avatar_url, ap.avatar_url) as actor_avatar_url,
    n.created_at
  from public.notification_feed_tokens t
  join public.profiles p on p.id = t.user_id
  join public.notifications n on n.recipient_id = p.id
  left join public.profiles ap on ap.id = n.actor_id
  where p_token is not null
    and t.token = p_token
    and p.status = 'ACTIVE'
    and p.notifications_enabled
    and n.read_at is null
    and n.created_at >= now() - interval '48 hours'
  order by n.created_at desc
  limit 8;
$$;

revoke execute on function public.get_unread_notifications_by_token(uuid) from public;
grant execute on function public.get_unread_notifications_by_token(uuid) to anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261119_133', 'use sender name and display picture in message notifications without New message from prefix')
on conflict (version) do nothing;

commit;
