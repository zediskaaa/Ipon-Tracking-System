begin;

-- Allow direct self-messaging (Saved Messages / Personal Notes) where user_a = user_b = auth.uid().

-- 1. Relax DIRECT check from (user_a < user_b) to (user_a <= user_b)
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%user_a < user_b%'
  loop
    execute format('alter table public.conversations drop constraint if exists %I', v_con.conname);
  end loop;
end $$;

alter table public.conversations
  drop constraint if exists conversations_kind_shape_check,
  add constraint conversations_kind_shape_check check (
    (kind = 'DIRECT' and pair_key is not null and user_a is not null and user_b is not null and user_a <= user_b)
    or (kind = 'GROUP' and user_a is null and user_b is null and title is not null and char_length(btrim(title)) between 2 and 80)
  );

-- 2. start_or_open_direct_chat: allow p_target_id = v_uid (always ACCEPTED personal chat)
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
  v_next_status := case when v_is_self or v_is_friend then 'ACCEPTED' else 'PENDING_REQUEST' end;

  select * into v_conv from public.conversations where pair_key = v_pair for update;
  if v_conv.id is null then
    if not v_is_self and not v_is_friend and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
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
  elsif v_conv.status = 'PENDING_REQUEST' and (v_is_self or v_is_friend) then
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  elsif v_conv.status = 'DECLINED' then
    if not v_is_self and not v_is_friend and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
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

-- 3. send_chat_message: handle self-messaging cleanly (no self-block check, no self-notification spam)
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
          v_notif_title := 'Message request from ' || coalesce(v_sender.full_name, 'User');
          perform public.push_social_notification(
            v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
            'dashboard.html?messages=requests&chat=' || v_conv.id::text,
            'SOCIAL_MSG_REQ:' || v_conv.id::text
          );
        else
          v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
          v_notif_title := case when p_reply_to_id is not null then 'New reply from ' else 'New message from ' end || coalesce(v_sender.full_name, 'User');
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

-- 4. get_social_user_profile: support p_target_id = v_uid (returns is_self = true cleanly)
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
begin
  if p_target_id is null then
    raise exception 'Select a valid user profile.' using errcode = '22023';
  end if;

  select p.id, p.full_name, p.username, p.bio, p.avatar_url, p.role, p.status,
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

  if v_is_self then
    select count(*)::integer into v_my_friends_count
    from public.friendships f
    where f.user_a = v_uid or f.user_b = v_uid;

    return jsonb_build_object(
      'id', v_target.id,
      'is_self', true,
      'full_name', v_target.full_name,
      'username', v_target.username,
      'verified_badge', v_badge_tier,
      'verified_badge_granted_at', case when v_badge_tier = 'NONE' then null else coalesce(v_target.verified_badge_granted_at, v_target.created_at) end,
      'bio', v_target.bio,
      'avatar_url', v_target.avatar_url,
      'friendship_status', 'SELF',
      'friend_request_id', null,
      'can_message', true,
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

  v_blocked_by_me := exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = p_target_id);
  v_blocked_me := exists (select 1 from public.blocked_users b where b.blocker_id = p_target_id and b.blocked_id = v_uid);
  v_is_friend := public.are_friends(v_uid, p_target_id);

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

  v_mutual := public.get_mutual_friends_summary(v_uid, p_target_id, 50);

  return jsonb_build_object(
    'id', v_target.id,
    'is_self', false,
    'full_name', v_target.full_name,
    'username', v_target.username,
    'verified_badge', v_badge_tier,
    'verified_badge_granted_at', case when v_badge_tier = 'NONE' then null else coalesce(v_target.verified_badge_granted_at, v_target.created_at) end,
    'bio', case when v_blocked_me then null else v_target.bio end,
    'avatar_url', v_target.avatar_url,
    'friendship_status', case
      when v_blocked_by_me then 'BLOCKED_BY_ME'
      when v_blocked_me then 'BLOCKED_ME'
      when v_is_friend then 'FRIENDS'
      when v_req.id is not null and v_req.sender_id = v_uid then 'OUTGOING_REQUEST'
      when v_req.id is not null and v_req.receiver_id = v_uid then 'INCOMING_REQUEST'
      else 'NONE'
    end,
    'friend_request_id', v_req.id,
    'can_message', (not v_blocked_by_me and not v_blocked_me and (v_is_friend or coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY')),
    'can_send_friend_request', (
      not v_blocked_by_me and not v_blocked_me and not v_is_friend and v_req.id is null
      and coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'NOBODY'
      and (
        coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'MUTUAL_GROUPS'
        or coalesce(array_length(v_shared_groups, 1), 0) > 0
      )
    ),
    'allow_online_status', (not v_blocked_me and not v_blocked_by_me and coalesce((v_target.chat_privacy ->> 'show_online')::boolean, true)),
    'last_seen_at', case
      when not v_blocked_me and not v_blocked_by_me
           and coalesce((v_target.chat_privacy ->> 'show_online')::boolean, true)
           and coalesce((v_target.chat_privacy ->> 'show_last_seen')::boolean, true)
      then v_target.last_seen_at
      else null
    end,
    'shared_groups', coalesce(v_shared_groups, '{}'),
    'friends_count', case
      when v_blocked_me or v_blocked_by_me then 0
      else public.get_user_friends_count(v_uid, p_target_id)
    end,
    'mutual_friends_count', coalesce((v_mutual ->> 'count')::integer, 0),
    'mutual_friends', coalesce(v_mutual -> 'friends', '[]'::jsonb),
    'conversation_id', v_conv_id
  );
end;
$$;

-- 5. get_conversations: mark peer.is_self and member_count = 1 for self chat
create or replace function public.get_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'kind', c.kind,
        'title', c.title,
        'description', c.description,
        'avatar_url', c.avatar_url,
        'status', c.status,
        'initiator_id', c.initiator_id,
        'is_incoming_request', (c.kind = 'DIRECT' and c.status = 'PENDING_REQUEST' and c.initiator_id is distinct from v_uid),
        'is_outgoing_request', (c.kind = 'DIRECT' and c.status = 'PENDING_REQUEST' and c.initiator_id = v_uid),
        'peer', case
          when c.kind = 'DIRECT' and peer.id is not null then jsonb_build_object(
            'id', peer.id,
            'is_self', (peer.id = v_uid),
            'full_name', peer.full_name,
            'username', peer.username,
            'avatar_url', peer.avatar_url,
            'is_friend', (peer.id <> v_uid and public.are_friends(v_uid, peer.id)),
            'is_blocked', (peer.id <> v_uid and public.is_user_blocked_between(v_uid, peer.id)),
            'blocked_by_me', (peer.id <> v_uid and exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id)),
            'allow_online_status', (peer.id = v_uid or (not public.is_user_blocked_between(v_uid, peer.id) and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true))),
            'last_seen_at', case
              when peer.id <> v_uid
                   and not public.is_user_blocked_between(v_uid, peer.id)
                   and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true)
                   and coalesce((peer.chat_privacy ->> 'show_last_seen')::boolean, true)
              then peer.last_seen_at
              else null
            end
          )
          else null
        end,
        'my_role', case when c.kind = 'GROUP' then cp.role else null end,
        'member_count', case
          when c.kind = 'GROUP' then (
            select count(*)::integer
            from public.conversation_participants gcp
            where gcp.conversation_id = c.id
          )
          when c.user_a = c.user_b then 1
          else 2
        end,
        'members_preview', case
          when c.kind = 'GROUP' then coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', gm.id,
                'full_name', gm.full_name,
                'avatar_url', gm.avatar_url,
                'allow_online_status', gm.allow_online_status
              )
            )
            from (
              select
                mp.id,
                mp.full_name,
                mp.avatar_url,
                (not public.is_user_blocked_between(v_uid, mp.id) and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)) as allow_online_status
              from public.conversation_participants gcp
              join public.profiles mp on mp.id = gcp.user_id
              where gcp.conversation_id = c.id
                and gcp.user_id <> v_uid
                and mp.status = 'ACTIVE'
              order by gcp.joined_at asc
              limit 4
            ) gm
          ), '[]'::jsonb)
          else '[]'::jsonb
        end,
        'is_pinned', coalesce(cp.is_pinned, false),
        'pinned_at', cp.pinned_at,
        'is_muted', coalesce(cp.is_muted, false),
        'is_archived', coalesce(cp.is_archived, false),
        'marked_unread', coalesce(cp.marked_unread, false),
        'chat_theme', coalesce(cp.chat_theme, 'paper'),
        'last_message_at', coalesce(latest.created_at, c.last_message_at, c.created_at),
        'last_message_type', latest.message_type,
        'last_message_preview', coalesce(
          case
            when latest.id is null then null
            when latest.deleted_for_everyone_at is not null then 'Message removed'
            when char_length(btrim(latest.body)) > 0 then left(latest.body, 140)
            when latest.message_type = 'VOICE' then 'Sent a voice message'
            when latest.message_type = 'CALL_EVENT' then coalesce(latest.metadata ->> 'summary', 'Call activity')
            else 'Sent an attachment'
          end,
          case
            when c.kind = 'GROUP' then 'No recent messages'
            when c.user_a = c.user_b then 'Personal notes & saved messages'
            else 'Start a conversation'
          end
        ),
        'last_message_sender_id', coalesce(latest.sender_id, c.last_message_sender_id),
        'last_message_sender_name', sender_p.full_name,
        'unread_count', (
          select count(*)::integer
          from public.messages um
          where um.conversation_id = c.id
            and um.sender_id <> v_uid
            and um.message_type <> 'SYSTEM'
            and um.deleted_for_everyone_at is null
            and not (v_uid = any(um.deleted_for_user_ids))
            and (cp.deleted_before_at is null or um.created_at > cp.deleted_before_at)
            and (cp.last_read_at is null or um.created_at > cp.last_read_at)
        )
      )
      order by
        coalesce(cp.is_pinned, false) desc,
        cp.pinned_at desc nulls last,
        coalesce(latest.created_at, c.last_message_at, c.created_at) desc
    )
    from public.conversations c
    left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
    left join public.profiles peer on c.kind = 'DIRECT' and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    left join lateral (
      select m.*
      from public.messages m
      where m.conversation_id = c.id
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
      order by m.created_at desc
      limit 1
    ) latest on true
    left join public.profiles sender_p on sender_p.id = coalesce(latest.sender_id, c.last_message_sender_id)
    where (
      (c.kind = 'GROUP' and cp.user_id = v_uid and cp.hidden_at is null and c.status = 'ACCEPTED')
      or (
        c.kind = 'DIRECT'
        and (c.user_a = v_uid or c.user_b = v_uid)
        and peer.id is not null
        and peer.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and peer.status = 'ACTIVE'
        and cp.hidden_at is null
        and c.status <> 'DECLINED'
        and (latest.id is not null or c.status = 'ACCEPTED')
      )
    )
  ), '[]'::jsonb);
end;
$$;

-- 6. search_social_users: include self cleanly so users can message themselves from search/people
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
        p.full_name,
        p.username,
        p.bio,
        p.avatar_url,
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
        case when p.id = v_uid then '{}'::text[] else (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) end as shared_groups,
        case when p.id = v_uid then 0 else public.get_user_friends_count(v_uid, p.id) end as friends_count,
        case when p.id = v_uid then jsonb_build_object('count', 0, 'friends', '[]'::jsonb) else public.get_mutual_friends_summary(v_uid, p.id, 16) end as mutual_summary
      from public.profiles p
      where p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and (p.id = v_uid or not public.is_user_blocked_between(v_uid, p.id))
        and (
          v_q = ''
          or (p.id = v_uid and ('you' like '%' || v_q || '%' or 'self' like '%' || v_q || '%' or 'saved messages' like '%' || v_q || '%'))
          or lower(p.full_name) like '%' || v_q || '%'
          or lower(coalesce(p.username, '')) like '%' || replace(v_q, '@', '') || '%'
          or lower(coalesce(p.bio, '')) like '%' || v_q || '%'
        )
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'is_self', c.is_self,
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
        'can_message', (c.is_self or c.is_friend or coalesce(c.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY'),
        'allow_online_status', (c.is_self or coalesce((c.chat_privacy ->> 'show_online')::boolean, true)),
        'last_seen_at', case
          when not c.is_self
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

revoke execute on function public.start_or_open_direct_chat(uuid) from public, anon;
grant execute on function public.start_or_open_direct_chat(uuid) to authenticated;

revoke execute on function public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb) to authenticated;

revoke execute on function public.get_social_user_profile(uuid) from public, anon;
grant execute on function public.get_social_user_profile(uuid) to authenticated;

revoke execute on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

revoke execute on function public.search_social_users(text, integer) from public, anon;
grant execute on function public.search_social_users(text, integer) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_115', 'allow direct self messaging (saved messages / personal notes)')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
