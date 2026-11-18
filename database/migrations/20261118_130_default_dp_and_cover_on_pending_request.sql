-- Keep DP and cover/profile card details default on unaccepted message requests and hidden profiles
begin;

-- A direct-chat connection exists only after the direct conversation is ACCEPTED
-- (never while it is still an unaccepted or declined PENDING_REQUEST).
create or replace function public.has_direct_chat_connection(
  p_viewer_id uuid,
  p_target_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_viewer_id is null or p_target_id is null or p_viewer_id = p_target_id then
    return false;
  end if;

  if public.is_user_blocked_between(p_viewer_id, p_target_id) then
    return false;
  end if;

  return exists (
    select 1
    from public.conversations c
    where c.kind = 'DIRECT'
      and c.pair_key = public.canonical_pair_key(p_viewer_id, p_target_id)
      and c.status = 'ACCEPTED'
  );
end;
$$;

revoke all on function public.has_direct_chat_connection(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_mutual_friends_summary(
  p_viewer_id uuid,
  p_target_id uuid,
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lim integer := greatest(1, least(coalesce(p_limit, 24), 50));
  v_total integer := 0;
  v_list jsonb := '[]'::jsonb;
begin
  if p_viewer_id is null or p_target_id is null or p_viewer_id = p_target_id then
    return jsonb_build_object('count', 0, 'friends', '[]'::jsonb);
  end if;

  with my_friends as (
    select case when f.user_a = p_viewer_id then f.user_b else f.user_a end as fid
    from public.friendships f
    where f.user_a = p_viewer_id or f.user_b = p_viewer_id
  ),
  mutual_profiles as (
    select
      p.id,
      p.full_name,
      case when vis.can_view then p.username else null end as username,
      case when vis.can_view then p.avatar_url else null end as avatar_url,
      vis.can_view as profile_visible
    from my_friends mf
    join public.friendships f2
      on f2.user_a = least(mf.fid, p_target_id)
     and f2.user_b = greatest(mf.fid, p_target_id)
    join public.profiles p on p.id = mf.fid
    cross join lateral (
      select public.can_view_social_profile(p_viewer_id, p.id, p.chat_privacy ->> 'profile_visibility') as can_view
    ) vis
    where p.status = 'ACTIVE'
      and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
      and not public.is_user_blocked_between(p_viewer_id, p.id)
    order by p.full_name asc
  )
  select
    (select count(*)::integer from mutual_profiles),
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'full_name', m.full_name,
            'username', m.username,
            'avatar_url', m.avatar_url,
            'profile_visible', m.profile_visible
          )
          order by m.full_name asc
        )
        from (select * from mutual_profiles limit v_lim) m
      ),
      '[]'::jsonb
    )
  into v_total, v_list;

  return jsonb_build_object(
    'count', coalesce(v_total, 0),
    'friends', coalesce(v_list, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_mutual_friends_summary(uuid, uuid, integer) from public, anon, authenticated;

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

  v_blocked_by_me := exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = p_target_id);
  v_blocked_me := exists (select 1 from public.blocked_users b where b.blocker_id = p_target_id and b.blocked_id = v_uid);
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
        'can_message', (c.is_self or c.is_friend or coalesce(c.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY'),
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

revoke all on function public.search_social_users(text, integer) from public, anon;
grant execute on function public.search_social_users(text, integer) to authenticated;

create or replace function public.get_friend_suggestions(p_limit integer default 16)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_lim integer := greatest(1, least(coalesce(p_limit, 16), 40));
begin
  return (
    with my_groups as (
      select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
      union
      select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
    ),
    suggestions as (
      select
        p.id,
        vis.can_view as profile_visible,
        p.full_name,
        case when vis.can_view then p.username else null end as username,
        case when vis.can_view then p.bio else null end as bio,
        case when vis.can_view then p.avatar_url else null end as avatar_url,
        p.chat_privacy,
        p.last_seen_at,
        case when vis.can_view then (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) else '{}'::text[] end as shared_groups,
        case when vis.can_view then public.get_user_friends_count(v_uid, p.id) else 0 end as friends_count,
        case when vis.can_view then public.get_mutual_friends_summary(v_uid, p.id, 16) else jsonb_build_object('count', 0, 'friends', '[]'::jsonb) end as mutual_summary
      from public.profiles p
      cross join lateral (
        select
          upper(coalesce(nullif(btrim(p.chat_privacy ->> 'profile_visibility'), ''), 'EVERYONE')) as vis_mode,
          public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility') as can_view
      ) vis
      where p.id <> v_uid
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
        and not public.are_friends(v_uid, p.id)
        and (vis.vis_mode <> 'NOBODY' or public.has_direct_chat_connection(v_uid, p.id))
        and not exists (
          select 1 from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id)
            and fr.status = 'PENDING'
        )
        and coalesce(p.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'NOBODY'
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'profile_visible', s.profile_visible,
        'full_name', s.full_name,
        'username', s.username,
        'bio', s.bio,
        'avatar_url', s.avatar_url,
        'shared_groups', s.shared_groups,
        'friends_count', coalesce(s.friends_count, 0),
        'mutual_friends_count', coalesce((s.mutual_summary ->> 'count')::integer, 0),
        'mutual_friends', coalesce(s.mutual_summary -> 'friends', '[]'::jsonb),
        'allow_online_status', (s.profile_visible and coalesce((s.chat_privacy ->> 'show_online')::boolean, true)),
        'last_seen_at', case
          when s.profile_visible
               and coalesce((s.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((s.chat_privacy ->> 'show_last_seen')::boolean, true)
          then s.last_seen_at
          else null
        end,
        'suggestion_reason', case
          when s.profile_visible and coalesce((s.mutual_summary ->> 'count')::integer, 0) > 0 and coalesce(array_length(s.shared_groups, 1), 0) > 0
            then (s.mutual_summary ->> 'count') || ' mutual friend(s) · Shared group: ' || s.shared_groups[1]
          when s.profile_visible and coalesce(array_length(s.shared_groups, 1), 0) > 0
            then 'Same group: ' || s.shared_groups[1]
          when s.profile_visible and coalesce((s.mutual_summary ->> 'count')::integer, 0) > 0
            then (s.mutual_summary ->> 'count') || ' mutual friend(s)'
          else 'Eligible community member'
        end
      )
      order by
        coalesce(array_length(s.shared_groups, 1), 0) desc,
        coalesce((s.mutual_summary ->> 'count')::integer, 0) desc,
        s.full_name asc
    ), '[]'::jsonb)
    from (select * from suggestions limit v_lim) s
  );
end;
$$;

revoke all on function public.get_friend_suggestions(integer) from public, anon;
grant execute on function public.get_friend_suggestions(integer) to authenticated;

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
            'blocked_by_me', (peer.id <> v_uid and exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id)),
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
      select (
        peer.id = v_uid
        or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility')
      ) as can_view
    ) peer_vis on c.kind = 'DIRECT' and peer.id is not null
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

revoke all on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

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
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
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

  select chat_privacy into v_me_privacy from public.profiles where id = v_uid;
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

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'profile_visible', gmvis.can_view,
        'full_name', mp.full_name,
        'username', case when gmvis.can_view then mp.username else null end,
        'avatar_url', case when gmvis.can_view then mp.avatar_url else null end,
        'role', gcp.role,
        'joined_at', gcp.joined_at,
        'is_friend', (mp.id <> v_uid and public.are_friends(v_uid, mp.id)),
        'is_blocked', (mp.id <> v_uid and public.is_user_blocked_between(v_uid, mp.id)),
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
    cross join lateral (
      select (
        mp.id = v_uid
        or public.can_view_social_profile(v_uid, mp.id, mp.chat_privacy ->> 'profile_visibility')
      ) as can_view
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
            'sender_name', sp.full_name,
            'sender_avatar_url', case
              when sp.id = v_uid then sp.avatar_url
              when v_conv.kind = 'DIRECT' then (v_conv_payload ->> 'avatar_url')
              when public.can_view_social_profile(v_uid, sp.id, sp.chat_privacy ->> 'profile_visibility') then sp.avatar_url
              else null
            end,
            'body', case when o.deleted_for_everyone_at is not null then '' else o.body end,
            'message_type', o.message_type,
            'metadata', coalesce(o.metadata, '{}'::jsonb),
            'reply_to_id', o.reply_to_id,
            'reply_preview', (
              select case
                when rm.id is null then null
                else jsonb_build_object(
                  'id', rm.id,
                  'sender_id', rm.sender_id,
                  'sender_name', rp.full_name,
                  'body', case when rm.deleted_for_everyone_at is not null then 'Message removed' else left(nullif(btrim(rm.body), ''), 120) end
                )
              end
              from public.messages rm
              join public.profiles rp on rp.id = rm.sender_id
              where rm.id = o.reply_to_id
            ),
            'forwarded_from_id', o.forwarded_from_id,
            'edited_at', o.edited_at,
            'deleted_for_everyone_at', o.deleted_for_everyone_at,
            'pinned_at', o.pinned_at,
            'created_at', o.created_at,
            'delivered_at', case
              when v_conv.kind = 'DIRECT' then (
                select mr.delivered_at from public.message_receipts mr
                where mr.message_id = o.id and mr.user_id = v_peer_id
                limit 1
              )
              when o.sender_id = v_uid then (
                select min(mr.delivered_at) from public.message_receipts mr
                where mr.message_id = o.id and mr.delivered_at is not null
              )
              else null
            end,
            'read_at', case
              when o.sender_id = v_uid and v_share_receipts then
                case
                  when v_conv.kind = 'DIRECT' then (
                    select mr.read_at from public.message_receipts mr
                    where mr.message_id = o.id and mr.user_id = v_peer_id
                    limit 1
                  )
                  else (
                    select min(mr.read_at) from public.message_receipts mr
                    where mr.message_id = o.id and mr.read_at is not null
                  )
                end
              else null
            end,
            'seen_by', case
              when v_conv.kind = 'GROUP' and o.sender_id = v_uid and v_share_receipts then coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', rp3.id,
                    'full_name', rp3.full_name,
                    'read_at', mr3.read_at
                  ) order by mr3.read_at asc
                )
                from public.message_receipts mr3
                join public.profiles rp3 on rp3.id = mr3.user_id
                where mr3.message_id = o.id
                  and mr3.read_at is not null
              ), '[]'::jsonb)
              else '[]'::jsonb
            end,
            'attachments', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce((
                select jsonb_agg(
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
                )
                from public.message_attachments ma
                where ma.message_id = o.id
              ), '[]'::jsonb)
            end,
            'reactions', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'user_id', mr2.user_id,
                    'emoji', mr2.emoji,
                    'user_name', rp2.full_name
                  ) order by mr2.created_at asc
                )
                from public.message_reactions mr2
                join public.profiles rp2 on rp2.id = mr2.user_id
                where mr2.message_id = o.id
              ), '[]'::jsonb)
            end
          )
          order by o.created_at asc
        )
        from ordered o
        join public.profiles sp on sp.id = o.sender_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_130', 'default_dp_and_cover_on_pending_request')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
