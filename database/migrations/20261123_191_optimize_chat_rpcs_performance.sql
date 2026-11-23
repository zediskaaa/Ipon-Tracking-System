begin;

-- Optimize get_conversations_unmasked, get_conversations, and get_conversation_messages_unmasked
-- to eliminate per-row SECURITY DEFINER function fan-out and correlated per-message subqueries
-- while preserving exact JSON response contracts, privacy rules, creator exceptions, and masking.

create or replace function public.get_conversations_unmasked()
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
    with my_friends as (
      select case when f.user_a = v_uid then f.user_b else f.user_a end as other_id
      from public.friendships f
      where f.user_a = v_uid or f.user_b = v_uid
    ),
    my_blocks as (
      select
        case when b.blocker_id = v_uid then b.blocked_id else b.blocker_id end as other_id,
        bool_or(b.blocker_id = v_uid and not b.hidden_from_blocker) as blocked_by_me
      from public.blocked_users b
      where b.blocker_id = v_uid or b.blocked_id = v_uid
      group by 1
    ),
    base_convs as (
      select
        c.id,
        c.kind,
        c.title,
        c.description,
        c.avatar_url,
        c.status,
        c.initiator_id,
        c.user_a,
        c.user_b,
        c.created_at,
        cp.role as my_role,
        cp.is_pinned,
        cp.pinned_at,
        cp.is_muted,
        cp.is_archived,
        cp.marked_unread,
        cp.chat_theme,
        cp.deleted_before_at,
        cp.last_read_at,
        peer.id as peer_id,
        peer.full_name as peer_full_name,
        peer.username as peer_username,
        peer.avatar_url as peer_avatar_url,
        peer.social_links as peer_social_links,
        peer.chat_privacy as peer_chat_privacy,
        peer.last_seen_at as peer_last_seen_at,
        (peer.id is not null and peer.id <> v_uid and mf.other_id is not null) as is_friend,
        (peer.id is not null and peer.id <> v_uid and mb.other_id is not null) as is_blocked,
        (peer.id is not null and peer.id <> v_uid and coalesce(mb.blocked_by_me, false)) as blocked_by_me,
        latest.id as latest_id,
        latest.created_at as latest_created_at,
        latest.message_type as latest_message_type,
        latest.deleted_for_everyone_at as latest_deleted_for_everyone_at,
        latest.vanish_after_seconds as latest_vanish_after_seconds,
        latest.body as latest_body,
        latest.metadata as latest_metadata,
        latest.sender_id as latest_sender_id,
        sender_p.full_name as latest_sender_name
      from public.conversations c
      left join public.conversation_participants cp
        on cp.conversation_id = c.id and cp.user_id = v_uid
      left join public.profiles peer
        on c.kind = 'DIRECT'
       and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
      left join my_friends mf on mf.other_id = peer.id
      left join my_blocks mb on mb.other_id = peer.id
      left join lateral (
        select
          m.id,
          m.created_at,
          m.message_type,
          m.deleted_for_everyone_at,
          m.vanish_after_seconds,
          m.body,
          m.metadata,
          m.sender_id
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
    ),
    group_counts as (
      select gcp.conversation_id, count(*)::integer as member_count
      from public.conversation_participants gcp
      where gcp.conversation_id in (select id from base_convs where kind = 'GROUP')
      group by gcp.conversation_id
    ),
    unread_counts as (
      select um.conversation_id, count(*)::integer as unread_count
      from public.messages um
      join base_convs bc on bc.id = um.conversation_id
      where (um.vanish_at is null or um.vanish_at > now())
        and um.sender_id <> v_uid
        and um.message_type <> 'SYSTEM'
        and um.deleted_for_everyone_at is null
        and not (v_uid = any(um.deleted_for_user_ids))
        and (bc.deleted_before_at is null or um.created_at > bc.deleted_before_at)
        and (bc.last_read_at is null or um.created_at > bc.last_read_at)
      group by um.conversation_id
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', bc.id,
        'kind', bc.kind,
        'title', bc.title,
        'description', bc.description,
        'avatar_url', bc.avatar_url,
        'status', bc.status,
        'initiator_id', bc.initiator_id,
        'is_incoming_request', (bc.kind = 'DIRECT' and bc.status = 'PENDING_REQUEST' and bc.initiator_id is distinct from v_uid),
        'is_outgoing_request', (bc.kind = 'DIRECT' and bc.status = 'PENDING_REQUEST' and bc.initiator_id = v_uid),
        'peer', case
          when bc.kind = 'DIRECT' and peer.id is not null then jsonb_build_object(
            'id', peer.id,
            'is_self', (peer.id = v_uid),
            'profile_visible', peer_vis.can_view,
            'full_name', peer.full_name,
            'username', case when peer_vis.can_view then peer.username else null end,
            'avatar_url', case when peer_vis.can_view then peer.avatar_url else null end,
            'social_links', case
              when not peer_vis.can_view or peer.social_links is null or peer.social_links = '{}'::jsonb then '{}'::jsonb
              else public.sanitize_social_app_links(peer.social_links, false)
            end,
            'is_friend', bc.is_friend,
            'is_blocked', bc.is_blocked,
            'blocked_by_me', bc.blocked_by_me,
            'can_message', (
              peer.id = v_uid
              or (
                not bc.is_blocked
                and (
                  bc.is_friend
                  or coalesce(peer.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') <> 'FRIENDS_ONLY'
                )
              )
            ),
            'friends_only_locked', (
              peer.id <> v_uid
              and not bc.is_blocked
              and not bc.is_friend
              and coalesce(peer.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY'
            ),
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
        'my_role', case when bc.kind = 'GROUP' then bc.my_role else null end,
        'member_count', case
          when bc.kind = 'GROUP' then coalesce(gc.member_count, 0)
          when bc.user_a = bc.user_b then 1
          else 2
        end,
        'members_preview', case
          when bc.kind = 'GROUP' then coalesce((
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
              left join my_friends gmf on gmf.other_id = mp.id
              left join my_blocks gmb on gmb.other_id = mp.id
              cross join lateral (
                select case
                  when gmb.other_id is not null then false
                  when upper(coalesce(nullif(btrim(mp.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'EVERYONE' then true
                  when upper(coalesce(nullif(btrim(mp.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'FRIENDS_ONLY' then (gmf.other_id is not null)
                  else public.can_view_social_profile(v_uid, mp.id, mp.chat_privacy ->> 'profile_visibility')
                end as can_view
              ) mvis
              where gcp.conversation_id = bc.id
                and gcp.user_id <> v_uid
                and mp.status = 'ACTIVE'
              order by gcp.joined_at asc
              limit 4
            ) gm
          ), '[]'::jsonb)
          else '[]'::jsonb
        end,
        'is_pinned', coalesce(bc.is_pinned, false),
        'pinned_at', bc.pinned_at,
        'is_muted', coalesce(bc.is_muted, false),
        'is_archived', coalesce(bc.is_archived, false),
        'marked_unread', coalesce(bc.marked_unread, false),
        'chat_theme', coalesce(bc.chat_theme, 'paper'),
        'last_message_at', coalesce(bc.latest_created_at, bc.created_at),
        'last_message_type', bc.latest_message_type,
        'last_message_preview', coalesce(
          case
            when bc.latest_id is null then null
            when bc.latest_deleted_for_everyone_at is not null then 'Message removed'
            when bc.latest_vanish_after_seconds is not null then coalesce(bc.latest_sender_name, 'Someone') || ' set a message.'
            when char_length(btrim(bc.latest_body)) > 0 then left(bc.latest_body, 140)
            when bc.latest_message_type = 'VOICE' then 'Sent a voice message'
            when bc.latest_message_type = 'CALL_EVENT' then coalesce(bc.latest_metadata ->> 'summary', 'Call activity')
            else 'Sent an attachment'
          end,
          case
            when bc.kind = 'GROUP' then 'No recent messages'
            when bc.user_a = bc.user_b then 'Personal notes & saved messages'
            else 'Start a conversation'
          end
        ),
        'last_message_sender_id', bc.latest_sender_id,
        'last_message_sender_name', bc.latest_sender_name,
        'unread_count', coalesce(uc.unread_count, 0)
      )
      order by
        coalesce(bc.is_pinned, false) desc,
        bc.pinned_at desc nulls last,
        coalesce(bc.latest_created_at, bc.created_at) desc
    )
    from base_convs bc
    left join lateral (
      select
        bc.peer_id as id,
        bc.peer_full_name as full_name,
        bc.peer_username as username,
        bc.peer_avatar_url as avatar_url,
        bc.peer_social_links as social_links,
        bc.peer_chat_privacy as chat_privacy,
        bc.peer_last_seen_at as last_seen_at
    ) peer on bc.kind = 'DIRECT' and bc.peer_id is not null
    left join lateral (
      select case
        when peer.id = v_uid then true
        when bc.is_blocked then false
        when upper(coalesce(nullif(btrim(peer.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'EVERYONE' then true
        when upper(coalesce(nullif(btrim(peer.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'NOBODY' then (bc.status = 'ACCEPTED')
        when upper(coalesce(nullif(btrim(peer.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'FRIENDS_ONLY' then bc.is_friend
        when upper(coalesce(nullif(btrim(peer.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'FRIENDS_AND_CONNECTIONS' then (bc.is_friend or bc.status = 'ACCEPTED')
        when upper(coalesce(nullif(btrim(peer.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) = 'FRIENDS_OF_FRIENDS' then (
          bc.is_friend
          or bc.status = 'ACCEPTED'
          or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility')
        )
        else true
      end as can_view
    ) peer_vis on bc.kind = 'DIRECT' and peer.id is not null
    left join group_counts gc on gc.conversation_id = bc.id
    left join unread_counts uc on uc.conversation_id = bc.id
  ), '[]'::jsonb);
end;
$$;

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
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
  v_viewer_group_id uuid;
  v_peer_privacy jsonb;
  v_part public.conversation_participants%rowtype;
  v_lim integer := greatest(10, least(coalesce(p_limit, 60), 120));
  v_share_receipts boolean := false;
  v_anchor timestamptz;
  v_unread_first_id uuid;
  v_conv_payload jsonb;
  v_group_members jsonb := '[]'::jsonb;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select chat_privacy, group_id into v_me_privacy, v_viewer_group_id from public.profiles where id = v_uid;
  select * into v_part from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid;

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    if not public.is_messaging_eligible(v_peer_id) then
      raise exception 'This user is unavailable.' using errcode = '42501';
    end if;
    select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;
    v_share_receipts := v_conv.status = 'ACCEPTED'
      and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
      and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);

    v_conv_payload := public.get_social_user_profile(v_peer_id) || jsonb_build_object(
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

revoke all on function public.get_conversations_unmasked() from public, anon, authenticated;
revoke all on function public.get_conversation_messages_unmasked(uuid, timestamptz, integer, uuid) from public, anon, authenticated;
revoke all on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261123_191', 'optimize chat rpc queries to reduce cpu and connection pool load')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
