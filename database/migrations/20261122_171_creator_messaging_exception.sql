-- 20261122_171: Protected creator messaging exception
begin;

create or replace function public.is_creator_messaging_account(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = p_user_id
      and lower(btrim(u.email)) = 'breadspanish231@gmail.com'
      and p.status = 'ACTIVE'
      and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
  );
$$;
revoke all on function public.is_creator_messaging_account(uuid) from public, anon, authenticated;


-- Existing blocks against the protected account must not keep its chats locked.
delete from public.blocked_users b
using auth.users u
where b.blocked_id = u.id
  and lower(btrim(u.email)) = 'breadspanish231@gmail.com';

update public.conversations c
set status = 'ACCEPTED', accepted_at = coalesce(c.accepted_at, now())
from auth.users u
where c.initiator_id = u.id
  and c.kind = 'DIRECT'
  and c.status = 'PENDING_REQUEST'
  and c.user_a <> c.user_b
  and lower(btrim(u.email)) = 'breadspanish231@gmail.com';


create or replace function public.block_social_user(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_target_role public.app_role;
  v_pair text := public.canonical_pair_key(v_uid, p_target_id);
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'You cannot block yourself.' using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_target_id;
  if v_target_role is null or v_target_role = 'SUPER_ADMIN' then
    raise exception 'Target account cannot be blocked here.' using errcode = '42501';
  end if;

  if public.is_creator_messaging_account(p_target_id) then
    raise exception 'This account cannot be blocked.' using errcode = '42501';
  end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (v_uid, p_target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.friendships
  where user_a = least(v_uid, p_target_id)
    and user_b = greatest(v_uid, p_target_id);

  update public.friend_requests
  set status = 'DECLINED', responded_at = now()
  where pair_key = v_pair and status = 'PENDING';

  update public.conversations
  set status = case when status = 'PENDING_REQUEST' then 'DECLINED' else status end
  where pair_key = v_pair;

  update public.call_sessions
  set status = 'ENDED', ended_at = coalesce(ended_at, now()), end_reason = 'BLOCKED'
  where status in ('RINGING', 'ACCEPTED')
    and ((caller_id = v_uid and callee_id = p_target_id) or (caller_id = p_target_id and callee_id = v_uid));

  return jsonb_build_object('blocked', true, 'user_id', p_target_id);
end;
$$;

create or replace function public.start_or_open_direct_chat(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_is_self boolean := (p_target_id = v_uid);
  v_a uuid := least(v_uid, p_target_id);
  v_b uuid := greatest(v_uid, p_target_id);
  v_pair text;
  v_target record;
  v_conv public.conversations%rowtype;
  v_is_friend boolean;
  v_next_status text;
begin
  if p_target_id is null then
    raise exception 'Select an eligible user to start a conversation.' using errcode = '22023';
  end if;

  select id, full_name, status, role, chat_privacy into v_target
  from public.profiles where id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This user is not available for messaging.' using errcode = '42501';
  end if;

  if not v_is_self and public.is_user_blocked_between(v_uid, p_target_id) then
    raise exception 'Messaging is unavailable because one of you has blocked the other.' using errcode = '42501';
  end if;

  v_pair := public.canonical_pair_key(v_uid, p_target_id);
  v_is_friend := not v_is_self and public.are_friends(v_uid, p_target_id);
  v_next_status := case when v_is_self or v_is_friend or public.is_creator_messaging_account(v_uid) then 'ACCEPTED' else 'PENDING_REQUEST' end;

  select * into v_conv from public.conversations where pair_key = v_pair for update;
  if v_conv.id is null then
    if not v_is_self and not v_is_friend and not public.is_creator_messaging_account(v_uid)
       and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
    end if;

    insert into public.conversations (kind, pair_key, user_a, user_b, initiator_id, status, accepted_at)
    values (
      'DIRECT',
      v_pair,
      v_a,
      v_b,
      v_uid,
      v_next_status,
      case when v_next_status = 'ACCEPTED' then now() else null end
    )
    on conflict (pair_key) do nothing
    returning * into v_conv;

    if v_conv.id is null then
      select * into v_conv from public.conversations where pair_key = v_pair;
    end if;
  elsif v_conv.status = 'PENDING_REQUEST' and (v_is_self or v_is_friend or public.is_creator_messaging_account(v_uid)) then
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  elsif v_conv.status = 'DECLINED' then
    if not v_is_self and not v_is_friend and not public.is_creator_messaging_account(v_uid)
       and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
    end if;
    update public.conversations
    set status = v_next_status,
        initiator_id = v_uid,
        accepted_at = case when v_next_status = 'ACCEPTED' then now() else null end
    where id = v_conv.id
    returning * into v_conv;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_a), (v_conv.id, v_b)
  on conflict (conversation_id, user_id) do nothing;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false
  where conversation_id = v_conv.id and user_id = v_uid;

  return jsonb_build_object(
    'id', v_conv.id,
    'status', v_conv.status,
    'initiator_id', v_conv.initiator_id,
    'peer_id', p_target_id,
    'is_self', v_is_self
  );
end;
$$;

create or replace function public.can_send_to_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_peer record;
begin
  if v_uid is null or not public.mfa_access_allowed() or not public.is_messaging_eligible(v_uid) then
    return false;
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null then
    return false;
  end if;
  if v_conv.kind = 'GROUP' then
    return v_conv.status = 'ACCEPTED'
      and exists (
        select 1 from public.conversation_participants cp
        where cp.conversation_id = v_conv.id and cp.user_id = v_uid
      );
  end if;
  if v_conv.user_a <> v_uid and v_conv.user_b <> v_uid then
    return false;
  end if;
  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
  if v_peer_id = v_uid then
    return true;
  end if;
  select id, role, status, chat_privacy into v_peer from public.profiles where id = v_peer_id;
  if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    return false;
  end if;
  if public.is_user_blocked_between(v_uid, v_peer_id) then
    return false;
  end if;
  if not public.are_friends(v_uid, v_peer_id)
     and not public.is_creator_messaging_account(v_uid)
     and not (v_conv.status = 'ACCEPTED' and public.is_creator_messaging_account(v_conv.initiator_id))
     and coalesce(v_peer.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY' then
    return false;
  end if;
  return true;
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
  v_notification_preview text;
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
    if not v_is_self
       and not public.are_friends(v_uid, v_peer_id)
       and not public.is_creator_messaging_account(v_uid)
       and not (v_conv.status = 'ACCEPTED' and public.is_creator_messaging_account(v_conv.initiator_id))
       and coalesce(v_peer.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
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
      update public.conversations
      set status = case when public.are_friends(v_uid, v_peer_id) or public.is_creator_messaging_account(v_uid) then 'ACCEPTED' else 'PENDING_REQUEST' end,
          initiator_id = v_uid,
          accepted_at = case when public.are_friends(v_uid, v_peer_id) or public.is_creator_messaging_account(v_uid) then now() else null end
      where id = v_conv.id
      returning * into v_conv;
    elsif v_conv.status = 'PENDING_REQUEST' and v_conv.initiator_id is distinct from v_uid then
      update public.conversations
      set status = 'ACCEPTED', accepted_at = now()
      where id = v_conv.id
      returning * into v_conv;
    elsif (public.are_friends(v_uid, v_peer_id) or public.is_creator_messaging_account(v_uid)) and v_conv.status = 'PENDING_REQUEST' then
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

  v_notification_preview := case
    when v_msg.vanish_after_seconds is not null then coalesce(nullif(btrim(v_sender.full_name), ''), 'Someone') || ' set a message.'
    else v_preview
  end;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = v_notification_preview,
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
            v_peer_id, v_uid, v_notif_type, v_notif_title, v_notification_preview,
            'dashboard.html?messages=requests&chat=' || v_conv.id::text,
            'SOCIAL_MSG_REQ:' || v_conv.id::text
          );
        else
          v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
          v_notif_title := coalesce(nullif(btrim(v_sender.full_name), ''), 'User');
          perform public.push_social_notification(
            v_peer_id, v_uid, v_notif_type, v_notif_title, v_notification_preview,
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
          v_notification_preview,
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

create or replace function public.get_social_user_profile(p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_is_self boolean := (p_target_id = v_uid);
  v_target record;
  v_is_friend boolean;
  v_blocked_by_me boolean;
  v_blocked_me boolean;
  v_req record;
  v_shared_groups text[];
  v_mutual jsonb;
  v_conv_id uuid;
  v_badge_tier text;
  v_my_friends_count integer := 0;
  v_profile_vis text := 'EVERYONE';
  v_can_view boolean := true;
begin
  if p_target_id is null then
    raise exception 'Select a valid user profile.' using errcode = '22023';
  end if;

  select p.id, p.full_name, p.username, p.bio, p.social_links, p.avatar_url, p.role, p.status,
         p.last_seen_at, p.created_at, p.chat_privacy, p.email, u.email as auth_email,
         u.last_sign_in_at, p.verified_badge_tier, p.verified_badge_expires_at,
         p.verified_badge_granted_at, p.verified_badge_acknowledged_at
  into v_target
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This account is not available for messaging or connections.' using errcode = 'P0002';
  end if;

  v_badge_tier := public.effective_verified_badge_for_user(
    v_target.verified_badge_tier,
    v_target.verified_badge_expires_at,
    v_target.verified_badge_granted_at,
    v_target.last_seen_at,
    v_target.created_at,
    coalesce(nullif(v_target.email, ''), v_target.auth_email),
    v_target.last_sign_in_at,
    v_target.verified_badge_acknowledged_at
  );

  select id into v_conv_id
  from public.conversations
  where pair_key = public.canonical_pair_key(v_uid, p_target_id);

  v_profile_vis := upper(coalesce(nullif(btrim(v_target.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE'));
  if v_profile_vis not in ('EVERYONE', 'FRIENDS_OF_FRIENDS', 'FRIENDS_AND_CONNECTIONS', 'FRIENDS_ONLY', 'NOBODY') then
    v_profile_vis := 'EVERYONE';
  end if;

  if v_is_self then
    select count(*)::integer into v_my_friends_count
    from public.friendships f
    where f.user_a = v_uid or f.user_b = v_uid;

    return jsonb_build_object(
      'id', v_target.id,
      'is_self', true,
      'profile_visible', true,
      'profile_visibility', v_profile_vis,
      'full_name', v_target.full_name,
      'username', v_target.username,
      'verified_badge', v_badge_tier,
      'verified_badge_granted_at', case when v_badge_tier = 'NONE' then null else coalesce(v_target.verified_badge_granted_at, v_target.created_at) end,
      'bio', v_target.bio,
      'social_links', public.sanitize_social_app_links(v_target.social_links, false),
      'avatar_url', v_target.avatar_url,
      'friendship_status', 'SELF',
      'friend_request_id', null,
      'can_message', true,
      'can_block', false,
      'can_send_friend_request', false,
      'allow_online_status', true,
      'last_seen_at', v_target.last_seen_at,
      'shared_groups', '{}'::text[],
      'friends_count', coalesce(v_my_friends_count, 0),
      'mutual_friends_count', 0,
      'mutual_friends', '[]'::jsonb,
      'conversation_id', v_conv_id
    );
  end if;

  v_blocked_by_me := exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = p_target_id and not b.hidden_from_blocker);
  v_blocked_me := exists (select 1 from public.blocked_users b where (b.blocker_id = p_target_id and b.blocked_id = v_uid) or (b.blocker_id = v_uid and b.blocked_id = p_target_id and b.hidden_from_blocker));
  v_is_friend := public.are_friends(v_uid, p_target_id);
  v_can_view := (not v_blocked_me) and (not v_blocked_by_me) and public.can_view_social_profile(v_uid, p_target_id, v_profile_vis);

  select id, sender_id, receiver_id, status into v_req
  from public.friend_requests
  where pair_key = public.canonical_pair_key(v_uid, p_target_id)
    and status = 'PENDING'
  limit 1;

  select coalesce(array_agg(distinct g.name order by g.name), '{}') into v_shared_groups
  from (
    select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
    union
    select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
  ) mine
  join (
    select gm.group_id from public.group_memberships gm where gm.user_id = p_target_id and gm.status = 'ACTIVE'
    union
    select p.group_id from public.profiles p where p.id = p_target_id and p.group_id is not null
  ) theirs on mine.group_id = theirs.group_id
  join public.groups g on g.id = mine.group_id;

  v_mutual := case when v_can_view then public.get_mutual_friends_summary(v_uid, p_target_id, 50) else jsonb_build_object('count', 0, 'friends', '[]'::jsonb) end;

  return jsonb_build_object(
    'id', v_target.id,
    'is_self', false,
    'profile_visible', v_can_view,
    'profile_visibility', case when v_blocked_me or v_blocked_by_me then 'NOBODY' else v_profile_vis end,
    'full_name', v_target.full_name,
    'username', case when v_can_view then v_target.username else null end,
    'verified_badge', case when v_can_view then v_badge_tier else 'NONE' end,
    'verified_badge_granted_at', case when not v_can_view or v_badge_tier = 'NONE' then null else coalesce(v_target.verified_badge_granted_at, v_target.created_at) end,
    'bio', case when v_can_view then v_target.bio else null end,
    'social_links', case when v_can_view then public.sanitize_social_app_links(v_target.social_links, false) else '{}'::jsonb end,
    'avatar_url', case when v_can_view then v_target.avatar_url else null end,
    'friendship_status', case
      when v_blocked_by_me then 'BLOCKED_BY_ME'
      when v_blocked_me then 'BLOCKED_ME'
      when v_is_friend then 'FRIENDS'
      when v_req.id is not null and v_req.sender_id = v_uid then 'OUTGOING_REQUEST'
      when v_req.id is not null and v_req.receiver_id = v_uid then 'INCOMING_REQUEST'
      else 'NONE'
    end,
    'friend_request_id', v_req.id,
    'can_message', (not v_blocked_by_me and not v_blocked_me and (
      v_is_friend or public.is_creator_messaging_account(v_uid)
      or (public.is_creator_messaging_account(p_target_id) and exists (
        select 1 from public.conversations c where c.id = v_conv_id
          and c.status = 'ACCEPTED' and c.initiator_id = p_target_id
      ))
      or coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') <> 'FRIENDS_ONLY'
    )),
    'can_block', not public.is_creator_messaging_account(p_target_id),
    'can_send_friend_request', (
      not v_blocked_by_me and not v_blocked_me and not v_is_friend and v_req.id is null
      and coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'NOBODY'
      and (
        coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'MUTUAL_GROUPS'
        or coalesce(array_length(v_shared_groups, 1), 0) > 0
      )
    ),
    'allow_online_status', (v_can_view and coalesce((v_target.chat_privacy ->> 'show_online')::boolean, true)),
    'last_seen_at', case
      when v_can_view
           and coalesce((v_target.chat_privacy ->> 'show_online')::boolean, true)
           and coalesce((v_target.chat_privacy ->> 'show_last_seen')::boolean, true)
      then v_target.last_seen_at
      else null
    end,
    'shared_groups', case when v_can_view then coalesce(v_shared_groups, '{}') else '{}'::text[] end,
    'friends_count', case
      when v_can_view then public.get_user_friends_count(v_uid, p_target_id)
      else 0
    end,
    'mutual_friends_count', case when v_can_view then coalesce((v_mutual ->> 'count')::integer, 0) else 0 end,
    'mutual_friends', case when v_can_view then coalesce(v_mutual -> 'friends', '[]'::jsonb) else '[]'::jsonb end,
    'conversation_id', v_conv_id
  );
end;
$$;

create or replace function public.search_social_users(
  p_query text default '',
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_lim integer := greatest(1, least(coalesce(p_limit, 24), 50));
begin
  return (
    with my_groups as (
      select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
      union
      select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
    ),
    my_friends as (
      select case when f.user_a = v_uid then f.user_b else f.user_a end as fid
      from public.friendships f where f.user_a = v_uid or f.user_b = v_uid
    ),
    candidates as (
      select
        p.id,
        (p.id = v_uid) as is_self,
        vis.can_view as profile_visible,
        p.full_name,
        case when vis.can_view then p.username else null end as username,
        case when vis.can_view then p.bio else null end as bio,
        case when p.id = v_uid or vis.can_view then p.avatar_url else null end as avatar_url,
        p.last_seen_at,
        p.chat_privacy,
        (p.id <> v_uid and exists (select 1 from my_friends mf where mf.fid = p.id)) as is_friend,
        case when p.id = v_uid then null else (
          select fr.id
          from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id) and fr.status = 'PENDING'
          limit 1
        ) end as pending_request_id,
        case when p.id = v_uid then null else (
          select fr.sender_id
          from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id) and fr.status = 'PENDING'
          limit 1
        ) end as pending_sender_id,
        case when p.id = v_uid or not vis.can_view then '{}'::text[] else (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) end as shared_groups,
        case when p.id = v_uid or not vis.can_view then 0 else public.get_user_friends_count(v_uid, p.id) end as friends_count,
        case when p.id = v_uid or not vis.can_view then jsonb_build_object('count', 0, 'friends', '[]'::jsonb) else public.get_mutual_friends_summary(v_uid, p.id, 16) end as mutual_summary
      from public.profiles p
      cross join lateral (
        select
          upper(coalesce(nullif(btrim(p.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) as vis_mode,
          ((p.id = v_uid) or public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility')) as can_view
      ) vis
      where p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and (p.id = v_uid or not public.is_user_blocked_between(v_uid, p.id))
        and (
          p.id = v_uid
          or vis.vis_mode <> 'NOBODY'
          or public.is_creator_messaging_account(v_uid)
          or public.has_direct_chat_connection(v_uid, p.id)
        )
        and (
          v_q = ''
          or (p.id = v_uid and ('you' like '%' || v_q || '%' or 'self' like '%' || v_q || '%' or 'saved messages' like '%' || v_q || '%'))
          or lower(p.full_name) like '%' || v_q || '%'
          or (vis.can_view and lower(coalesce(p.username, '')) like '%' || replace(v_q, '@', '') || '%')
          or (vis.can_view and lower(coalesce(p.bio, '')) like '%' || v_q || '%')
        )
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'is_self', c.is_self,
        'profile_visible', c.profile_visible,
        'full_name', c.full_name,
        'username', c.username,
        'bio', c.bio,
        'avatar_url', c.avatar_url,
        'friendship_status', case
          when c.is_self then 'SELF'
          when c.is_friend then 'FRIENDS'
          when c.pending_request_id is not null and c.pending_sender_id = v_uid then 'OUTGOING_REQUEST'
          when c.pending_request_id is not null then 'INCOMING_REQUEST'
          else 'NONE'
        end,
        'friend_request_id', c.pending_request_id,
        'shared_groups', c.shared_groups,
        'friends_count', coalesce(c.friends_count, 0),
        'mutual_friends_count', coalesce((c.mutual_summary ->> 'count')::integer, 0),
        'mutual_friends', coalesce(c.mutual_summary -> 'friends', '[]'::jsonb),
        'can_message', (c.is_self or c.is_friend or public.is_creator_messaging_account(v_uid)
          or (public.is_creator_messaging_account(c.id) and exists (
            select 1 from public.conversations dc
            where dc.pair_key = public.canonical_pair_key(v_uid, c.id)
              and dc.status = 'ACCEPTED' and dc.initiator_id = c.id
          ))
          or coalesce(c.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') <> 'FRIENDS_ONLY'),
        'can_block', not public.is_creator_messaging_account(c.id),
        'allow_online_status', (c.is_self or (c.profile_visible and coalesce((c.chat_privacy ->> 'show_online')::boolean, true))),
        'last_seen_at', case
          when not c.is_self
               and c.profile_visible
               and coalesce((c.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((c.chat_privacy ->> 'show_last_seen')::boolean, true)
          then c.last_seen_at
          else null
        end
      )
      order by
        c.is_self desc,
        c.is_friend desc,
        coalesce(array_length(c.shared_groups, 1), 0) desc,
        coalesce((c.mutual_summary ->> 'count')::integer, 0) desc,
        c.full_name asc
    ), '[]'::jsonb)
    from (select * from candidates order by is_self desc, is_friend desc, full_name asc limit v_lim) c
  );
end;
$$;

create or replace function public.get_social_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_me record;
begin
  select id, full_name, username, bio, avatar_url, chat_privacy into v_me
  from public.profiles where id = v_uid;

  return jsonb_build_object(
    'me', jsonb_build_object(
      'id', v_me.id,
      'full_name', v_me.full_name,
      'username', v_me.username,
      'bio', v_me.bio,
      'avatar_url', v_me.avatar_url,
      'chat_privacy', coalesce(v_me.chat_privacy, '{}'::jsonb)
    ),
    'friends', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'can_block', not public.is_creator_messaging_account(p.id),
          'profile_visible', vis.can_view,
          'full_name', p.full_name,
          'username', case when vis.can_view then p.username else null end,
          'bio', case when vis.can_view then p.bio else null end,
          'avatar_url', case when vis.can_view then p.avatar_url else null end,
          'allow_online_status', (vis.can_view and coalesce((p.chat_privacy ->> 'show_online')::boolean, true)),
          'last_seen_at', case
            when vis.can_view
                 and coalesce((p.chat_privacy ->> 'show_online')::boolean, true)
                 and coalesce((p.chat_privacy ->> 'show_last_seen')::boolean, true)
            then p.last_seen_at
            else null
          end,
          'friends_since', f.created_at,
          'friends_count', case when vis.can_view then public.get_user_friends_count(v_uid, p.id) else 0 end,
          'mutual_friends_count', case when vis.can_view then coalesce((m.summary ->> 'count')::integer, 0) else 0 end,
          'mutual_friends', case when vis.can_view then coalesce(m.summary -> 'friends', '[]'::jsonb) else '[]'::jsonb end
        )
        order by p.full_name asc
      )
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_uid then f.user_b else f.user_a end
      cross join lateral (select public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility') as can_view) vis
      cross join lateral (select case when vis.can_view then public.get_mutual_friends_summary(v_uid, p.id, 16) else jsonb_build_object('count', 0, 'friends', '[]'::jsonb) end as summary) m
      where (f.user_a = v_uid or f.user_b = v_uid)
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
    ), '[]'::jsonb),
    'incoming_requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'user_id', p.id,
          'can_block', not public.is_creator_messaging_account(p.id),
          'profile_visible', vis.can_view,
          'full_name', p.full_name,
          'username', case when vis.can_view then p.username else null end,
          'avatar_url', case when vis.can_view then p.avatar_url else null end,
          'created_at', fr.created_at,
          'friends_count', case when vis.can_view then public.get_user_friends_count(v_uid, p.id) else 0 end,
          'mutual_friends_count', case when vis.can_view then coalesce((m.summary ->> 'count')::integer, 0) else 0 end,
          'mutual_friends', case when vis.can_view then coalesce(m.summary -> 'friends', '[]'::jsonb) else '[]'::jsonb end
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.sender_id
      cross join lateral (select public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility') as can_view) vis
      cross join lateral (select case when vis.can_view then public.get_mutual_friends_summary(v_uid, p.id, 16) else jsonb_build_object('count', 0, 'friends', '[]'::jsonb) end as summary) m
      where fr.receiver_id = v_uid
        and fr.status = 'PENDING'
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
    ), '[]'::jsonb),
    'sent_requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'user_id', p.id,
          'can_block', not public.is_creator_messaging_account(p.id),
          'profile_visible', vis.can_view,
          'full_name', p.full_name,
          'username', case when vis.can_view then p.username else null end,
          'avatar_url', case when vis.can_view then p.avatar_url else null end,
          'created_at', fr.created_at,
          'friends_count', case when vis.can_view then public.get_user_friends_count(v_uid, p.id) else 0 end,
          'mutual_friends_count', case when vis.can_view then coalesce((m.summary ->> 'count')::integer, 0) else 0 end,
          'mutual_friends', case when vis.can_view then coalesce(m.summary -> 'friends', '[]'::jsonb) else '[]'::jsonb end
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.receiver_id
      cross join lateral (select public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility') as can_view) vis
      cross join lateral (select case when vis.can_view then public.get_mutual_friends_summary(v_uid, p.id, 16) else jsonb_build_object('count', 0, 'friends', '[]'::jsonb) end as summary) m
      where fr.sender_id = v_uid
        and fr.status = 'PENDING'
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
    ), '[]'::jsonb),
    'blocked_users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.blocked_id,
          'full_name', p.full_name,
          'username', p.username,
          'avatar_url', p.avatar_url,
          'blocked_at', b.created_at
        )
        order by b.created_at desc
      )
      from public.blocked_users b
      join public.profiles p on p.id = b.blocked_id
      where b.blocker_id = v_uid
        and not b.hidden_from_blocker
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid, p_before timestamptz default null,
  p_limit integer default 60, p_around_message_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_data jsonb; v_enabled boolean; v_group boolean;
begin
  v_data := public.get_conversation_messages_unmasked(p_conversation_id, p_before, p_limit, p_around_message_id);
  select anonymous_session_id is not null, kind = 'GROUP' into v_enabled, v_group
  from public.conversations where id = p_conversation_id;
  if not coalesce(v_enabled, false) then return v_data || jsonb_build_object('anonymous_enabled', false); end if;
  return jsonb_set(
    jsonb_set(v_data,
      '{conversation}', (v_data -> 'conversation') ||
        case when v_group then jsonb_build_object(
          'members', '[]'::jsonb, 'created_by', null, 'avatar_url', null, 'anonymous_enabled', true)
        else jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
          'bio', null, 'social_links', '{}'::jsonb, 'allow_online_status', false,
          'last_seen_at', null, 'can_block', false, 'anonymous_enabled', true) end),
      '{messages}', coalesce((
        select jsonb_agg(m || jsonb_build_object('sender_name', 'Anonymous', 'sender_avatar_url', null,
          'sender_app_role', null, 'seen_by', '[]'::jsonb,
          'body', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then to_jsonb('Conversation update'::text) else m -> 'body' end,
          'metadata', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then '{}'::jsonb else m -> 'metadata' end,
          'reply_preview', case when m -> 'reply_preview' is not null then
            (m -> 'reply_preview') || jsonb_build_object('sender_name', 'Anonymous') else null end,
          'reactions', coalesce((select jsonb_agg(r || jsonb_build_object('user_name', 'Anonymous'))
            from jsonb_array_elements(coalesce(m -> 'reactions', '[]'::jsonb)) as x(r)), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(coalesce(v_data -> 'messages', '[]'::jsonb)) with ordinality as x(m, ord)
      ), '[]'::jsonb)) || jsonb_build_object('anonymous_enabled', true,
        'pinned_messages', coalesce((select jsonb_agg(p || jsonb_build_object('sender_name', 'Anonymous'))
          from jsonb_array_elements(coalesce(v_data -> 'pinned_messages', '[]'::jsonb)) as x(p)), '[]'::jsonb));
end;
$$;

create or replace function public.get_conversations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    case when c.anonymous_session_id is not null then
      jsonb_set(
        jsonb_set(
          case when c.kind = 'GROUP' then
            jsonb_set(item, '{members_preview}', '[]'::jsonb) || jsonb_build_object('avatar_url', null)
          else jsonb_set(item, '{peer}', coalesce(item -> 'peer', '{}'::jsonb) ||
            jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
              'social_links', '{}'::jsonb, 'allow_online_status', false, 'last_seen_at', null,
              'can_block', false)) end,
          '{last_message_sender_name}', to_jsonb('Anonymous'::text)),
        '{last_message_preview}', case
          when item ->> 'last_message_type' in ('SYSTEM', 'CALL_EVENT')
            then to_jsonb('Conversation update'::text)
          when item ->> 'last_message_preview' ~ ' set a message\.$'
            then to_jsonb('Vanishing message'::text)
          else item -> 'last_message_preview' end) ||
        jsonb_build_object('anonymous_enabled', true)
    else item || jsonb_build_object('anonymous_enabled', false) end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(public.get_conversations_unmasked()) with ordinality as x(raw_item, ord)
  join public.conversations c on c.id = (raw_item ->> 'id')::uuid
  cross join lateral (
    select case when c.kind = 'DIRECT' and not public.is_user_blocked_between(c.user_a, c.user_b) and (
      public.is_creator_messaging_account(auth.uid())
      or (c.status = 'ACCEPTED' and public.is_creator_messaging_account(c.initiator_id))
    ) then jsonb_set(raw_item, '{peer}', coalesce(raw_item -> 'peer', '{}'::jsonb) ||
      jsonb_build_object('can_message', true, 'friends_only_locked', false,
        'can_block', not public.is_creator_messaging_account((raw_item -> 'peer' ->> 'id')::uuid)))
    when c.kind = 'DIRECT' then jsonb_set(raw_item, '{peer}', coalesce(raw_item -> 'peer', '{}'::jsonb) ||
      jsonb_build_object('can_block', not public.is_creator_messaging_account((raw_item -> 'peer' ->> 'id')::uuid)))
    else raw_item end as item
  ) visible;
$$;
insert into public.schema_migrations (version, name)
values ('20261122_171', 'protected creator messaging access and block prevention')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
