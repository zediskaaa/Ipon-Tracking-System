begin;

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
            'profile_visible', peer_vis.can_view,
            'full_name', peer.full_name,
            'username', case when peer_vis.can_view then peer.username else null end,
            'avatar_url', case when peer_vis.can_view then peer.avatar_url else null end,
            'social_links', case
              when peer_vis.can_view then public.sanitize_social_app_links(peer.social_links, false)
              else '{}'::jsonb
            end,
            'is_friend', (peer.id <> v_uid and public.are_friends(v_uid, peer.id)),
            'is_blocked', (peer.id <> v_uid and public.is_user_blocked_between(v_uid, peer.id)),
            'blocked_by_me', (peer.id <> v_uid and exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id and not b.hidden_from_blocker)),
            'allow_online_status', (peer.id = v_uid or (peer_vis.can_view and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true))),
            'last_seen_at', case
              when peer.id <> v_uid
                   and peer_vis.can_view
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
                'profile_visible', gm.profile_visible,
                'full_name', gm.full_name,
                'avatar_url', gm.avatar_url,
                'allow_online_status', gm.allow_online_status
              )
            )
            from (
              select
                mp.id,
                mvis.can_view as profile_visible,
                mp.full_name,
                case when mvis.can_view then mp.avatar_url else null end as avatar_url,
                (mvis.can_view and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)) as allow_online_status
              from public.conversation_participants gcp
              join public.profiles mp on mp.id = gcp.user_id
              cross join lateral (
                select public.can_view_social_profile(v_uid, mp.id, mp.chat_privacy ->> 'profile_visibility') as can_view
              ) mvis
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
        'last_message_at', coalesce(latest.created_at, c.created_at),
        'last_message_type', latest.message_type,
        'last_message_preview', coalesce(
          case
            when latest.id is null then null
            when latest.deleted_for_everyone_at is not null then 'Message removed'
            when latest.vanish_after_seconds is not null then coalesce(sender_p.full_name, 'Someone') || ' set a message.'
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
        'last_message_sender_id', latest.sender_id,
        'last_message_sender_name', sender_p.full_name,
        'unread_count', (
          select count(*)::integer
          from public.messages um
          where um.conversation_id = c.id
            and (um.vanish_at is null or um.vanish_at > now())
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
        coalesce(latest.created_at, c.created_at) desc
    )
    from public.conversations c
    left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
    left join public.profiles peer on c.kind = 'DIRECT' and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    left join lateral (
      select (
        peer.id = v_uid
        or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility')
      ) as can_view
    ) peer_vis on c.kind = 'DIRECT' and peer.id is not null
    left join lateral (
      select m.*
      from public.messages m
      where m.conversation_id = c.id
        and (m.vanish_at is null or m.vanish_at > now())
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
      order by m.created_at desc
      limit 1
    ) latest on true
    left join public.profiles sender_p on sender_p.id = latest.sender_id
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

revoke all on function public.send_chat_message(uuid,text,text,uuid,uuid,jsonb,jsonb), public.get_conversations() from public, anon;
grant execute on function public.send_chat_message(uuid,text,text,uuid,uuid,jsonb,jsonb), public.get_conversations() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_149', 'vanishing_message_private_notification')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
