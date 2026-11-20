-- Migration 145: Support hidden_from_blocker flag on blocked_users so admin-enforced blocks stay hidden from the blocker's blocked list
begin;

alter table public.blocked_users
  add column if not exists hidden_from_blocker boolean not null default false;

drop policy if exists blocked_users_select on public.blocked_users;
create policy blocked_users_select on public.blocked_users for select to authenticated
using (blocker_id = auth.uid() and not hidden_from_blocker);

create or replace function public.unblock_social_user(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
begin
  delete from public.blocked_users
  where blocker_id = v_uid
    and blocked_id = p_target_id
    and not hidden_from_blocker;
  return jsonb_build_object('unblocked', true, 'user_id', p_target_id);
end;
$$;

revoke all on function public.unblock_social_user(uuid) from public, anon;
grant execute on function public.unblock_social_user(uuid) to authenticated;

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
    'can_message', (not v_blocked_by_me and not v_blocked_me and (v_is_friend or coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY')),
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

revoke all on function public.get_social_user_profile(uuid) from public, anon;
grant execute on function public.get_social_user_profile(uuid) to authenticated;

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

revoke all on function public.get_social_overview() from public, anon;
grant execute on function public.get_social_overview() to authenticated;

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

revoke all on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_145', 'hidden_user_blocks')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
