-- Delivery vs Read receipts:
--   * Sent: delivered_at is null, read_at is null (1 gray check)
--   * Delivered: delivered_at is set when recipient's app syncs/receives, read_at is null (1 green check)
--   * Seen: read_at is set when recipient opens/reads the thread with read receipts enabled (2 green checks)

begin;

alter table public.message_receipts
  alter column delivered_at drop not null,
  alter column delivered_at drop default;

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
  v_notif_title text;
  v_notif_type text;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  select id, full_name, role, status, chat_privacy into v_peer from public.profiles where id = v_peer_id;
  select id, full_name into v_sender from public.profiles where id = v_uid;

  if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Recipient is unavailable for messaging.' using errcode = '42501';
  end if;

  if public.is_user_blocked_between(v_uid, v_peer_id) then
    raise exception 'Cannot send message because one of you has blocked the other.' using errcode = '42501';
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
  if char_length(v_clean_body) > 5000 then
    raise exception 'Message must be 5000 characters or fewer.' using errcode = '22023';
  end if;

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
    -- Recipient replying directly promotes conversation to accepted main inbox
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
        and (c.user_a = v_uid or c.user_b = v_uid)
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

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  values (v_msg.id, v_peer_id, null, null)
  on conflict (message_id, user_id) do nothing;

  v_preview := case
    when char_length(v_clean_body) > 0 then left(v_clean_body, 140)
    when v_type = 'VOICE' then 'Sent a voice message'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'image' then 'Sent a photo'
    when v_att_count > 1 then 'Sent ' || v_att_count::text || ' attachments'
    else 'Sent an attachment'
  end;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_uid
  where id = v_conv.id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_conv.user_a), (v_conv.id, v_conv.user_b)
  on conflict (conversation_id, user_id) do nothing;

  update public.conversation_participants
  set hidden_at = null,
      marked_unread = false,
      last_read_message_id = v_msg.id,
      last_read_at = now()
  where conversation_id = v_conv.id and user_id = v_uid;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false
  where conversation_id = v_conv.id and user_id = v_peer_id
  returning * into v_peer_part;

  if coalesce(v_peer_part.is_muted, false) is not true then
    if v_conv.status = 'PENDING_REQUEST' then
      v_notif_type := 'SOCIAL_MESSAGE_REQUEST';
      v_notif_title := 'Message request from ' || coalesce(v_sender.full_name, 'User');
      perform public.push_social_notification(
        v_peer_id,
        v_uid,
        v_notif_type,
        v_notif_title,
        v_preview,
        'dashboard.html?messages=requests&chat=' || v_conv.id::text,
        'SOCIAL_MSG_REQ:' || v_conv.id::text
      );
    else
      v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
      v_notif_title := case when p_reply_to_id is not null then 'New reply from ' else 'New message from ' end || coalesce(v_sender.full_name, 'User');
      perform public.push_social_notification(
        v_peer_id,
        v_uid,
        v_notif_type,
        v_notif_title,
        v_preview,
        'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
        'SOCIAL_MSG:' || v_conv.id::text
      );
    end if;
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

create or replace function public.mark_messages_delivered(p_conversation_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_updated integer := 0;
begin
  if p_conversation_id is not null and not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.user_a = v_uid or c.user_b = v_uid)
  ) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  update public.message_receipts mr
  set delivered_at = coalesce(mr.delivered_at, now())
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where mr.message_id = m.id
    and mr.user_id = v_uid
    and mr.delivered_at is null
    and m.deleted_for_everyone_at is null
    and (c.user_a = v_uid or c.user_b = v_uid)
    and c.status <> 'DECLINED'
    and not public.is_user_blocked_between(c.user_a, c.user_b)
    and (p_conversation_id is null or c.id = p_conversation_id);

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
  v_peer_privacy jsonb;
  v_latest_id uuid;
  v_allow_receipts boolean := false;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  select chat_privacy into v_me_privacy from public.profiles where id = v_uid;
  select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;

  select id into v_latest_id
  from public.messages
  where conversation_id = v_conv.id
  order by created_at desc
  limit 1;

  update public.conversation_participants
  set marked_unread = false,
      last_read_at = now(),
      last_read_message_id = coalesce(v_latest_id, last_read_message_id)
  where conversation_id = v_conv.id and user_id = v_uid;

  -- Strictly NEVER write read_at if conversation is PENDING_REQUEST or either party disabled read receipts
  v_allow_receipts := v_conv.status = 'ACCEPTED'
    and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
    and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);

  update public.message_receipts mr
  set delivered_at = coalesce(mr.delivered_at, now()),
      read_at = case when v_allow_receipts then coalesce(mr.read_at, now()) else mr.read_at end
  from public.messages m
  where mr.message_id = m.id
    and m.conversation_id = v_conv.id
    and mr.user_id = v_uid
    and (mr.delivered_at is null or (v_allow_receipts and mr.read_at is null));

  -- Also clear corresponding inbox notifications for this conversation
  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and read_at is null
    and type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_ACCEPTED', 'SOCIAL_MESSAGE_REQUEST')
    and (link like '%' || v_conv.id::text || '%' or dedupe_key like '%' || v_conv.id::text || '%');

  return jsonb_build_object('read_at', now(), 'receipts_shared', v_allow_receipts);
end;
$$;

revoke all on function
  public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.mark_messages_delivered(uuid),
  public.mark_conversation_read(uuid)
from public, anon;

grant execute on function
  public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.mark_messages_delivered(uuid),
  public.mark_conversation_read(uuid)
to authenticated;

insert into public.schema_migrations (version, name)
values ('20261115_077', 'messaging delivery vs read receipt states')
on conflict (version) do nothing;

commit;
