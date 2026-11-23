begin;

-- Guard chat list/thread RPCs with a non-blocking per-user transaction advisory lock
-- so a stale or reconnecting client cannot exhaust the PostgREST connection pool or CPU
-- for other users, and replace the heavy get_social_user_profile() call inside
-- get_conversation_messages_unmasked() with a lightweight direct-peer header query.

create or replace function public.get_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_creator_id uuid;
  v_viewer_is_creator boolean := false;
begin
  if v_uid is not null and not pg_try_advisory_xact_lock(hashtext('ipon_chat_convs'), hashtext(v_uid::text)) then
    raise exception 'Too many concurrent chat refreshes. Please wait a moment.' using errcode = '53300';
  end if;

  select u.id into v_creator_id
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(btrim(u.email)) = 'breadspanish231@gmail.com'
    and p.status = 'ACTIVE'
    and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
  limit 1;

  v_viewer_is_creator := (v_creator_id is not null and v_uid = v_creator_id);

  return coalesce((
    select jsonb_agg(
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
      order by ord
    )
    from jsonb_array_elements(public.get_conversations_unmasked()) with ordinality as x(raw_item, ord)
    join public.conversations c on c.id = (raw_item ->> 'id')::uuid
    cross join lateral (
      select case
        when c.kind = 'DIRECT'
             and not coalesce((raw_item -> 'peer' ->> 'is_blocked')::boolean, false)
             and (
               v_viewer_is_creator
               or (c.status = 'ACCEPTED' and v_creator_id is not null and c.initiator_id = v_creator_id)
             )
        then jsonb_set(raw_item, '{peer}', coalesce(raw_item -> 'peer', '{}'::jsonb) ||
          jsonb_build_object(
            'can_message', true,
            'friends_only_locked', false,
            'can_block', not (v_creator_id is not null and (raw_item -> 'peer' ->> 'id')::uuid = v_creator_id)
          ))
        when c.kind = 'DIRECT'
        then jsonb_set(raw_item, '{peer}', coalesce(raw_item -> 'peer', '{}'::jsonb) ||
          jsonb_build_object(
            'can_block', not (v_creator_id is not null and (raw_item -> 'peer' ->> 'id')::uuid = v_creator_id)
          ))
        else raw_item
      end as item
    ) visible
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_conversation_messages_unmasked(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_limit integer default 60,
  p_around_message_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
  v_viewer_group_id uuid;
  v_peer record;
  v_part public.conversation_participants%rowtype;
  v_lim integer := greatest(10, least(coalesce(p_limit, 60), 120));
  v_share_receipts boolean := false;
  v_anchor timestamptz;
  v_unread_first_id uuid;
  v_conv_payload jsonb;
  v_group_members jsonb := '[]'::jsonb;
  v_creator_id uuid;
  v_is_self boolean := false;
  v_is_friend boolean := false;
  v_blocked_by_me boolean := false;
  v_blocked_me boolean := false;
  v_profile_vis text := 'EVERYONE';
  v_can_view boolean := true;
  v_req record;
  v_has_shared_group boolean := false;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select chat_privacy, group_id into v_me_privacy, v_viewer_group_id from public.profiles where id = v_uid;
  select * into v_part from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid;

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    v_is_self := (v_peer_id = v_uid);

    select p.id, p.full_name, p.username, p.bio, p.social_links, p.avatar_url,
           p.role, p.status, p.last_seen_at, p.chat_privacy
    into v_peer
    from public.profiles p
    where p.id = v_peer_id;

    if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'This user is unavailable.' using errcode = '42501';
    end if;

    v_share_receipts := v_conv.status = 'ACCEPTED'
      and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
      and coalesce((v_peer.chat_privacy ->> 'read_receipts')::boolean, true);

    v_profile_vis := upper(coalesce(nullif(btrim(v_peer.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE'));
    if v_profile_vis not in ('EVERYONE', 'FRIENDS_OF_FRIENDS', 'FRIENDS_AND_CONNECTIONS', 'FRIENDS_ONLY', 'NOBODY') then
      v_profile_vis := 'EVERYONE';
    end if;

    if v_is_self then
      v_conv_payload := jsonb_build_object(
        'id', v_peer.id,
        'is_self', true,
        'profile_visible', true,
        'profile_visibility', v_profile_vis,
        'full_name', v_peer.full_name,
        'username', v_peer.username,
        'bio', v_peer.bio,
        'social_links', case
          when v_peer.social_links is null or v_peer.social_links = '{}'::jsonb then '{}'::jsonb
          else public.sanitize_social_app_links(v_peer.social_links, false)
        end,
        'avatar_url', v_peer.avatar_url,
        'friendship_status', 'SELF',
        'friend_request_id', null,
        'can_message', true,
        'can_block', false,
        'can_send_friend_request', false,
        'allow_online_status', true,
        'last_seen_at', v_peer.last_seen_at,
        'conversation_id', v_conv.id,
        'kind', 'DIRECT',
        'status', v_conv.status,
        'initiator_id', v_conv.initiator_id,
        'is_muted', coalesce(v_part.is_muted, false),
        'is_pinned', coalesce(v_part.is_pinned, false),
        'is_archived', coalesce(v_part.is_archived, false),
        'chat_theme', coalesce(v_part.chat_theme, 'paper'),
        'receipts_enabled', v_share_receipts
      );
    else
      select u.id into v_creator_id
      from auth.users u
      join public.profiles p on p.id = u.id
      where lower(btrim(u.email)) = 'breadspanish231@gmail.com'
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
      limit 1;

      select
        coalesce(bool_or(b.blocker_id = v_uid and b.blocked_id = v_peer_id and not b.hidden_from_blocker), false),
        coalesce(bool_or((b.blocker_id = v_peer_id and b.blocked_id = v_uid) or (b.blocker_id = v_uid and b.blocked_id = v_peer_id and b.hidden_from_blocker)), false)
      into v_blocked_by_me, v_blocked_me
      from public.blocked_users b
      where (b.blocker_id = v_uid and b.blocked_id = v_peer_id)
         or (b.blocker_id = v_peer_id and b.blocked_id = v_uid);

      v_is_friend := exists (
        select 1 from public.friendships f
        where f.user_a = least(v_uid, v_peer_id)
          and f.user_b = greatest(v_uid, v_peer_id)
      );

      v_can_view := (not v_blocked_me) and (not v_blocked_by_me) and (
        case
          when v_profile_vis = 'EVERYONE' then true
          when v_profile_vis = 'NOBODY' then (v_conv.status = 'ACCEPTED')
          when v_profile_vis = 'FRIENDS_ONLY' then v_is_friend
          when v_profile_vis = 'FRIENDS_AND_CONNECTIONS' then (v_is_friend or v_conv.status = 'ACCEPTED')
          when v_profile_vis = 'FRIENDS_OF_FRIENDS' then (
            v_is_friend or v_conv.status = 'ACCEPTED'
            or public.can_view_social_profile(v_uid, v_peer_id, v_profile_vis)
          )
          else true
        end
      );

      select id, sender_id, receiver_id, status into v_req
      from public.friend_requests
      where pair_key = public.canonical_pair_key(v_uid, v_peer_id)
        and status = 'PENDING'
      limit 1;

      if not v_blocked_by_me and not v_blocked_me and not v_is_friend and v_req.id is null
         and coalesce(v_peer.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') = 'MUTUAL_GROUPS' then
        v_has_shared_group := exists (
          select 1
          from (
            select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
            union
            select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
          ) mine
          join (
            select gm.group_id from public.group_memberships gm where gm.user_id = v_peer_id and gm.status = 'ACTIVE'
            union
            select p.group_id from public.profiles p where p.id = v_peer_id and p.group_id is not null
          ) theirs on mine.group_id = theirs.group_id
        );
      end if;

      v_conv_payload := jsonb_build_object(
        'id', v_peer.id,
        'is_self', false,
        'profile_visible', v_can_view,
        'profile_visibility', case when v_blocked_me or v_blocked_by_me then 'NOBODY' else v_profile_vis end,
        'full_name', v_peer.full_name,
        'username', case when v_can_view then v_peer.username else null end,
        'bio', case when v_can_view then v_peer.bio else null end,
        'social_links', case
          when not v_can_view or v_peer.social_links is null or v_peer.social_links = '{}'::jsonb then '{}'::jsonb
          else public.sanitize_social_app_links(v_peer.social_links, false)
        end,
        'avatar_url', case when v_can_view then v_peer.avatar_url else null end,
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
          v_is_friend
          or (v_creator_id is not null and v_uid = v_creator_id)
          or (v_creator_id is not null and v_peer_id = v_creator_id and v_conv.status = 'ACCEPTED' and v_conv.initiator_id = v_peer_id)
          or coalesce(v_peer.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') <> 'FRIENDS_ONLY'
        )),
        'can_block', not (v_creator_id is not null and v_peer_id = v_creator_id),
        'can_send_friend_request', (
          not v_blocked_by_me and not v_blocked_me and not v_is_friend and v_req.id is null
          and coalesce(v_peer.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'NOBODY'
          and (
            coalesce(v_peer.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'MUTUAL_GROUPS'
            or v_has_shared_group
          )
        ),
        'allow_online_status', (v_can_view and coalesce((v_peer.chat_privacy ->> 'show_online')::boolean, true)),
        'last_seen_at', case
          when v_can_view
               and coalesce((v_peer.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((v_peer.chat_privacy ->> 'show_last_seen')::boolean, true)
          then v_peer.last_seen_at
          else null
        end,
        'conversation_id', v_conv.id,
        'kind', 'DIRECT',
        'status', v_conv.status,
        'initiator_id', v_conv.initiator_id,
        'is_muted', coalesce(v_part.is_muted, false),
        'is_pinned', coalesce(v_part.is_pinned, false),
        'is_archived', coalesce(v_part.is_archived, false),
        'chat_theme', coalesce(v_part.chat_theme, 'paper'),
        'receipts_enabled', v_share_receipts
      );
    end if;
  else
    v_share_receipts := coalesce((v_me_privacy ->> 'read_receipts')::boolean, true);

    with my_friends as (
      select case when f.user_a = v_uid then f.user_b else f.user_a end as other_id
      from public.friendships f
      where f.user_a = v_uid or f.user_b = v_uid
    ),
    my_blocks as (
      select case when b.blocker_id = v_uid then b.blocked_id else b.blocker_id end as other_id
      from public.blocked_users b
      where b.blocker_id = v_uid or b.blocked_id = v_uid
    ),
    my_groups as (
      select gm.group_id
      from public.group_memberships gm
      where gm.user_id = v_uid and gm.status = 'ACTIVE'
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'profile_visible', gmvis.can_view,
        'full_name', mp.full_name,
        'username', case when gmvis.can_view then mp.username else null end,
        'avatar_url', case when gmvis.can_view then mp.avatar_url else null end,
        'role', gcp.role,
        'app_role', coalesce(
          (
            select gm.role
            from public.group_memberships gm
            where gm.user_id = mp.id
              and gm.status = 'ACTIVE'
              and v_viewer_group_id is not null
              and gm.group_id = v_viewer_group_id
            limit 1
          ),
          (
            select gm.role
            from public.group_memberships gm
            join my_groups mg on mg.group_id = gm.group_id
            where gm.user_id = mp.id
              and gm.status = 'ACTIVE'
            order by case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end
            limit 1
          ),
          case when mp.role in ('ADMIN', 'TREASURER') then mp.role else 'MEMBER' end
        ),
        'joined_at', gcp.joined_at,
        'is_friend', (mp.id <> v_uid and mf.other_id is not null),
        'is_blocked', (mp.id <> v_uid and mb.other_id is not null),
        'allow_online_status', (
          mp.id = v_uid
          or (gmvis.can_view and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true))
        ),
        'last_seen_at', case
          when mp.id <> v_uid
               and gmvis.can_view
               and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((mp.chat_privacy ->> 'show_last_seen')::boolean, true)
          then mp.last_seen_at
          else null
        end
      )
      order by
        case gcp.role when 'OWNER' then 1 when 'ADMIN' then 2 else 3 end,
        mp.full_name asc
    ), '[]'::jsonb)
    into v_group_members
    from public.conversation_participants gcp
    join public.profiles mp on mp.id = gcp.user_id
    left join my_friends mf on mf.other_id = mp.id
    left join my_blocks mb on mb.other_id = mp.id
    cross join lateral (
      select case
        when mp.id = v_uid then true
        when mb.other_id is not null then false
        when upper(coalesce(nullif(btrim(mp.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'EVERYONE' then true
        when upper(coalesce(nullif(btrim(mp.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'FRIENDS_ONLY' then (mf.other_id is not null)
        else public.can_view_social_profile(v_uid, mp.id, mp.chat_privacy ->> 'profile_visibility')
      end as can_view
    ) gmvis
    where gcp.conversation_id = v_conv.id
      and mp.status = 'ACTIVE'
      and mp.role in ('ADMIN', 'TREASURER', 'MEMBER');

    v_conv_payload := jsonb_build_object(
      'id', v_conv.id,
      'conversation_id', v_conv.id,
      'kind', 'GROUP',
      'title', v_conv.title,
      'full_name', v_conv.title,
      'description', v_conv.description,
      'avatar_url', v_conv.avatar_url,
      'created_by', v_conv.created_by,
      'status', v_conv.status,
      'my_role', v_part.role,
      'member_count', jsonb_array_length(v_group_members),
      'members', v_group_members,
      'is_muted', coalesce(v_part.is_muted, false),
      'is_pinned', coalesce(v_part.is_pinned, false),
      'is_archived', coalesce(v_part.is_archived, false),
      'chat_theme', coalesce(v_part.chat_theme, 'paper'),
      'receipts_enabled', v_share_receipts
    );
  end if;

  if p_around_message_id is not null then
    select created_at into v_anchor
    from public.messages
    where id = p_around_message_id and conversation_id = v_conv.id;
  end if;

  select id into v_unread_first_id
  from public.messages um
  where um.conversation_id = v_conv.id
    and (um.vanish_at is null or um.vanish_at > now())
    and um.sender_id <> v_uid
    and um.message_type <> 'SYSTEM'
    and um.deleted_for_everyone_at is null
    and not (v_uid = any(um.deleted_for_user_ids))
    and (v_part.deleted_before_at is null or um.created_at > v_part.deleted_before_at)
    and v_part.last_read_at is not null
    and um.created_at > v_part.last_read_at
  order by um.created_at asc
  limit 1;

  return (
    with visible as (
      select m.*
      from public.messages m
      where m.conversation_id = v_conv.id
        and (m.vanish_at is null or m.vanish_at > now())
        and not (v_uid = any(m.deleted_for_user_ids))
        and (v_part.deleted_before_at is null or m.created_at > v_part.deleted_before_at)
        and (
          (v_anchor is null and (p_before is null or m.created_at < p_before))
          or (v_anchor is not null and m.created_at <= (v_anchor + interval '30 days'))
        )
      order by m.created_at desc
      limit v_lim + 1
    ),
    sliced as (
      select * from visible order by created_at desc limit v_lim
    ),
    ordered as (
      select * from sliced order by created_at asc
    ),
    sender_ids as (
      select distinct o.sender_id from ordered o
    ),
    my_groups as (
      select gm.group_id
      from public.group_memberships gm
      where v_conv.kind = 'GROUP'
        and gm.user_id = v_uid
        and gm.status = 'ACTIVE'
    ),
    sender_meta as (
      select
        sp.id,
        sp.full_name,
        case
          when v_conv.kind <> 'GROUP' then null
          else coalesce(
            (
              select gm.role
              from public.group_memberships gm
              where gm.user_id = sp.id
                and gm.status = 'ACTIVE'
                and v_viewer_group_id is not null
                and gm.group_id = v_viewer_group_id
              limit 1
            ),
            (
              select gm.role
              from public.group_memberships gm
              join my_groups mg on mg.group_id = gm.group_id
              where gm.user_id = sp.id
                and gm.status = 'ACTIVE'
              order by case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end
              limit 1
            ),
            case when sp.role in ('ADMIN', 'TREASURER') then sp.role else 'MEMBER' end
          )
        end as sender_app_role,
        case
          when sp.id = v_uid then sp.avatar_url
          when v_conv.kind = 'DIRECT' then (v_conv_payload ->> 'avatar_url')
          when public.can_view_social_profile(v_uid, sp.id, sp.chat_privacy ->> 'profile_visibility') then sp.avatar_url
          else null
        end as sender_avatar_url
      from sender_ids s
      join public.profiles sp on sp.id = s.sender_id
    ),
    replies_map as (
      select
        rm.id,
        jsonb_build_object(
          'id', rm.id,
          'sender_id', rm.sender_id,
          'sender_name', rp.full_name,
          'body', case when rm.deleted_for_everyone_at is not null then 'Message removed' else left(nullif(btrim(rm.body), ''), 120) end
        ) as preview
      from public.messages rm
      join public.profiles rp on rp.id = rm.sender_id
      where rm.id in (select distinct o.reply_to_id from ordered o where o.reply_to_id is not null)
        and (rm.vanish_at is null or rm.vanish_at > now())
    ),
    receipts_agg as (
      select
        mr.message_id,
        max(mr.delivered_at) filter (where mr.user_id = v_peer_id) as direct_delivered_at,
        min(mr.delivered_at) filter (where mr.delivered_at is not null) as min_delivered_at,
        max(mr.read_at) filter (where mr.user_id = v_peer_id) as direct_read_at,
        min(mr.read_at) filter (where mr.read_at is not null) as min_read_at,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'id', rp3.id,
              'full_name', rp3.full_name,
              'read_at', mr.read_at
            ) order by mr.read_at asc
          ) filter (where mr.read_at is not null and rp3.id is not null),
          '[]'::jsonb
        ) as seen_by
      from public.message_receipts mr
      left join public.profiles rp3
        on v_conv.kind = 'GROUP' and mr.read_at is not null and rp3.id = mr.user_id
      where mr.message_id in (select o.id from ordered o)
      group by mr.message_id
    ),
    attachments_agg as (
      select
        ma.message_id,
        jsonb_agg(
          jsonb_build_object(
            'id', ma.id,
            'path', ma.storage_path,
            'name', ma.file_name,
            'type', ma.mime_type,
            'size', ma.file_size,
            'kind', ma.attachment_kind,
            'width', ma.width,
            'height', ma.height,
            'duration_seconds', ma.duration_seconds
          ) order by ma.created_at asc
        ) as items
      from public.message_attachments ma
      where ma.message_id in (select o.id from ordered o where o.deleted_for_everyone_at is null)
      group by ma.message_id
    ),
    reactions_agg as (
      select
        mr2.message_id,
        jsonb_agg(
          jsonb_build_object(
            'user_id', mr2.user_id,
            'emoji', mr2.emoji,
            'user_name', rp2.full_name
          ) order by mr2.created_at asc
        ) as items
      from public.message_reactions mr2
      join public.profiles rp2 on rp2.id = mr2.user_id
      where mr2.message_id in (select o.id from ordered o where o.deleted_for_everyone_at is null)
      group by mr2.message_id
    )
    select jsonb_build_object(
      'conversation', v_conv_payload,
      'has_older', ((select count(*) from visible) > v_lim),
      'unread_first_id', v_unread_first_id,
      'pinned_messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pm.id,
            'sender_id', pm.sender_id,
            'sender_name', sp.full_name,
            'body', case when pm.deleted_for_everyone_at is not null then '' else left(pm.body, 140) end,
            'pinned_at', pm.pinned_at,
            'created_at', pm.created_at
          ) order by pm.pinned_at desc
        )
        from public.messages pm
        join public.profiles sp on sp.id = pm.sender_id
        where pm.conversation_id = v_conv.id
          and (pm.vanish_at is null or pm.vanish_at > now())
          and pm.pinned_at is not null
          and pm.deleted_for_everyone_at is null
          and not (v_uid = any(pm.deleted_for_user_ids))
          and (v_part.deleted_before_at is null or pm.created_at > v_part.deleted_before_at)
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'conversation_id', o.conversation_id,
            'sender_id', o.sender_id,
            'sender_name', sm.full_name,
            'sender_app_role', sm.sender_app_role,
            'sender_avatar_url', sm.sender_avatar_url,
            'body', case when o.deleted_for_everyone_at is not null then '' else o.body end,
            'message_type', o.message_type,
            'metadata', coalesce(o.metadata, '{}'::jsonb),
            'reply_to_id', o.reply_to_id,
            'reply_preview', rmap.preview,
            'forwarded_from_id', o.forwarded_from_id,
            'edited_at', o.edited_at,
            'deleted_for_everyone_at', o.deleted_for_everyone_at,
            'pinned_at', o.pinned_at,
            'created_at', o.created_at,
            'vanish_after_seconds', o.vanish_after_seconds,
            'vanish_started_at', o.vanish_started_at,
            'vanish_at', o.vanish_at,
            'delivered_at', case
              when v_conv.kind = 'DIRECT' then ra.direct_delivered_at
              when o.sender_id = v_uid then ra.min_delivered_at
              else null
            end,
            'read_at', case
              when o.sender_id = v_uid and v_share_receipts then
                case
                  when v_conv.kind = 'DIRECT' then ra.direct_read_at
                  else ra.min_read_at
                end
              else null
            end,
            'seen_by', case
              when v_conv.kind = 'GROUP' and o.sender_id = v_uid and v_share_receipts then coalesce(ra.seen_by, '[]'::jsonb)
              else '[]'::jsonb
            end,
            'attachments', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce(aa.items, '[]'::jsonb)
            end,
            'reactions', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce(rxa.items, '[]'::jsonb)
            end
          )
          order by o.created_at asc
        )
        from ordered o
        join sender_meta sm on sm.id = o.sender_id
        left join replies_map rmap on rmap.id = o.reply_to_id
        left join receipts_agg ra on ra.message_id = o.id
        left join attachments_agg aa on aa.message_id = o.id
        left join reactions_agg rxa on rxa.message_id = o.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_limit integer default 60,
  p_around_message_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_data jsonb;
  v_session_id uuid;
  v_group boolean;
begin
  if v_uid is not null and not pg_try_advisory_xact_lock(hashtext('ipon_chat_msgs'), hashtext(v_uid::text)) then
    raise exception 'Too many concurrent chat refreshes. Please wait a moment.' using errcode = '53300';
  end if;

  v_data := public.get_conversation_messages_unmasked(p_conversation_id, p_before, p_limit, p_around_message_id);
  select anonymous_session_id, kind = 'GROUP' into v_session_id, v_group
  from public.conversations where id = p_conversation_id;
  if v_session_id is null then
    return v_data || jsonb_build_object('anonymous_enabled', false);
  end if;
  return jsonb_set(
    jsonb_set(v_data,
      '{conversation}', (v_data -> 'conversation') ||
        case when v_group then jsonb_build_object(
          'members', '[]'::jsonb, 'created_by', null, 'avatar_url', null, 'anonymous_enabled', true)
        else jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
          'bio', null, 'social_links', '{}'::jsonb, 'allow_online_status', false,
          'last_seen_at', null, 'can_block', false, 'anonymous_enabled', true) end),
      '{messages}', coalesce((
        select jsonb_agg(m || jsonb_build_object(
          'sender_name', 'Anonymous',
          'sender_avatar_url', null,
          'sender_app_role', null,
          'seen_by', '[]'::jsonb,
          'seen_count', case
            when v_group and jsonb_typeof(m -> 'seen_by') = 'array' then jsonb_array_length(m -> 'seen_by')
            when not v_group and m ->> 'read_at' is not null then 1
            else 0
          end,
          'anon_seen_keys', case
            when v_group and jsonb_typeof(m -> 'seen_by') = 'array' then coalesce((
              select jsonb_agg(
                to_jsonb('anon_' || substr(md5(v_session_id::text || ':' || coalesce(s ->> 'id', s ->> 'user_id', s_ord::text)), 1, 16))
                order by s_ord
              )
              from jsonb_array_elements(m -> 'seen_by') with ordinality as sx(s, s_ord)
            ), '[]'::jsonb)
            else '[]'::jsonb
          end,
          'body', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then to_jsonb('Conversation update'::text) else m -> 'body' end,
          'metadata', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then '{}'::jsonb else m -> 'metadata' end,
          'reply_preview', case when jsonb_typeof(m -> 'reply_preview') = 'object' then
            (m -> 'reply_preview') || jsonb_build_object('sender_name', 'Anonymous') else null end,
          'reactions', coalesce((select jsonb_agg(r || jsonb_build_object('user_name', 'Anonymous'))
            from jsonb_array_elements(coalesce(m -> 'reactions', '[]'::jsonb)) as x(r)), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(coalesce(v_data -> 'messages', '[]'::jsonb)) with ordinality as x(m, ord)
      ), '[]'::jsonb)) || jsonb_build_object('anonymous_enabled', true,
        'pinned_messages', coalesce((select jsonb_agg(p || jsonb_build_object('sender_name', 'Anonymous'))
          from jsonb_array_elements(coalesce(v_data -> 'pinned_messages', '[]'::jsonb)) as x(p)), '[]'::jsonb));
end;
$$;

revoke all on function public.get_conversation_messages_unmasked(uuid, timestamptz, integer, uuid) from public, anon, authenticated;
revoke all on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;
revoke all on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261123_192', 'add per-user chat rpc concurrency guard and lightweight direct peer header')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
