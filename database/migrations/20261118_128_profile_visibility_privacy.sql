-- Enforce "Who can see your profile" (Everyone, Friends of friends, Friends only, No one) across messaging & social RPCs
begin;

alter table public.profiles
  alter column chat_privacy set default jsonb_build_object(
    'show_online', true,
    'show_last_seen', true,
    'read_receipts', true,
    'allow_friend_requests', 'EVERYONE',
    'allow_message_requests', 'EVERYONE',
    'profile_visibility', 'EVERYONE'
  );

create or replace function public.can_view_social_profile(
  p_viewer_id uuid,
  p_target_id uuid,
  p_visibility text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_vis text;
begin
  if p_viewer_id is null or p_target_id is null then
    return false;
  end if;

  if p_viewer_id = p_target_id then
    return true;
  end if;

  if public.is_user_blocked_between(p_viewer_id, p_target_id) then
    return false;
  end if;

  v_vis := upper(coalesce(
    nullif(btrim(p_visibility), ''),
    (select p.chat_privacy ->> 'profile_visibility' from public.profiles p where p.id = p_target_id),
    'EVERYONE'
  ));

  if v_vis = 'EVERYONE' then
    return true;
  elsif v_vis = 'NOBODY' then
    return false;
  elsif v_vis = 'FRIENDS_ONLY' then
    return public.are_friends(p_viewer_id, p_target_id);
  elsif v_vis = 'FRIENDS_OF_FRIENDS' then
    if public.are_friends(p_viewer_id, p_target_id) then
      return true;
    end if;
    return exists (
      select 1
      from public.friendships f1
      join public.friendships f2
        on f2.user_a = least(case when f1.user_a = p_viewer_id then f1.user_b else f1.user_a end, p_target_id)
       and f2.user_b = greatest(case when f1.user_a = p_viewer_id then f1.user_b else f1.user_a end, p_target_id)
      join public.profiles mp
        on mp.id = case when f1.user_a = p_viewer_id then f1.user_b else f1.user_a end
      where (f1.user_a = p_viewer_id or f1.user_b = p_viewer_id)
        and mp.status = 'ACTIVE'
        and mp.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(p_viewer_id, mp.id)
        and not public.is_user_blocked_between(p_target_id, mp.id)
    );
  end if;

  return true;
end;
$$;

revoke all on function public.can_view_social_profile(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.update_social_profile_and_privacy(
  p_username text default '__KEEP__',
  p_bio text default '__KEEP__',
  p_chat_privacy jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_keep_username boolean := (p_username = '__KEEP__');
  v_keep_bio boolean := (p_bio = '__KEEP__');
  v_username text := case when p_username = '__KEEP__' then null else nullif(lower(btrim(coalesce(p_username, ''))), '') end;
  v_bio text := case when p_bio = '__KEEP__' then null else nullif(btrim(coalesce(p_bio, '')), '') end;
  v_existing_username text;
  v_existing_bio text;
  v_existing jsonb;
  v_next jsonb;
  v_friend_req text;
  v_msg_req text;
  v_profile_vis text;
begin
  if not v_keep_username and v_username is not null and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters using lowercase letters, numbers, or underscores.' using errcode = '22023';
  end if;

  if not v_keep_bio and v_bio is not null and char_length(v_bio) > 58 then
    raise exception 'Bio must be 58 characters or fewer.' using errcode = '22023';
  end if;

  select username, bio, coalesce(chat_privacy, '{}'::jsonb)
  into v_existing_username, v_existing_bio, v_existing
  from public.profiles
  where id = v_uid;

  v_next := v_existing;
  if p_chat_privacy is not null and jsonb_typeof(p_chat_privacy) = 'object' then
    v_friend_req := upper(coalesce(p_chat_privacy ->> 'allow_friend_requests', v_existing ->> 'allow_friend_requests', 'EVERYONE'));
    if v_friend_req not in ('EVERYONE', 'MUTUAL_GROUPS', 'NOBODY') then
      v_friend_req := 'EVERYONE';
    end if;
    v_msg_req := upper(coalesce(p_chat_privacy ->> 'allow_message_requests', v_existing ->> 'allow_message_requests', 'EVERYONE'));
    if v_msg_req not in ('EVERYONE', 'FRIENDS_ONLY') then
      v_msg_req := 'EVERYONE';
    end if;
    v_profile_vis := upper(coalesce(p_chat_privacy ->> 'profile_visibility', v_existing ->> 'profile_visibility', 'EVERYONE'));
    if v_profile_vis not in ('EVERYONE', 'FRIENDS_OF_FRIENDS', 'FRIENDS_ONLY', 'NOBODY') then
      v_profile_vis := 'EVERYONE';
    end if;
    v_next := jsonb_build_object(
      'show_online', coalesce((p_chat_privacy ->> 'show_online')::boolean, coalesce((v_existing ->> 'show_online')::boolean, true)),
      'show_last_seen', coalesce((p_chat_privacy ->> 'show_last_seen')::boolean, coalesce((v_existing ->> 'show_last_seen')::boolean, true)),
      'read_receipts', coalesce((p_chat_privacy ->> 'read_receipts')::boolean, coalesce((v_existing ->> 'read_receipts')::boolean, true)),
      'allow_friend_requests', v_friend_req,
      'allow_message_requests', v_msg_req,
      'profile_visibility', v_profile_vis
    );
  end if;

  update public.profiles
  set username = case when v_keep_username then v_existing_username else v_username end,
      bio = case when v_keep_bio then v_existing_bio else v_bio end,
      chat_privacy = v_next,
      updated_at = now()
  where id = v_uid;

  return jsonb_build_object(
    'username', case when v_keep_username then v_existing_username else v_username end,
    'bio', case when v_keep_bio then v_existing_bio else v_bio end,
    'chat_privacy', v_next
  );
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

revoke all on function public.update_social_profile_and_privacy(text, text, jsonb) from public, anon;
grant execute on function public.update_social_profile_and_privacy(text, text, jsonb) to authenticated;

create or replace function public.get_profile_card_appearance(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_effect text := 'none';
  v_can_view boolean := true;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  select * into v_profile
  from public.profiles
  where id = p_target_id
    and status = 'ACTIVE'
    and (id = auth.uid() or role in ('ADMIN', 'TREASURER', 'MEMBER'));

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  v_can_view := (v_profile.id = auth.uid())
    or public.can_view_social_profile(auth.uid(), v_profile.id, v_profile.chat_privacy ->> 'profile_visibility');

  if not v_can_view then
    return jsonb_build_object(
      'profile_visible', false,
      'card_theme', 'emerald',
      'cover_url', null,
      'profile_effect', 'none',
      'social_links', '{}'::jsonb
    );
  end if;

  v_effect := coalesce(v_profile.equipped_profile_effect, 'none');
  if v_effect <> 'none' and v_profile.role <> 'SUPER_ADMIN' then
    if not exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = v_profile.id
        and g.effect_id = v_effect
        and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
    ) then
      v_effect := 'none';
    end if;
  end if;

  return jsonb_build_object(
    'profile_visible', true,
    'card_theme', v_profile.card_theme,
    'cover_url', v_profile.cover_url,
    'profile_effect', v_effect,
    'social_links', case
      when v_profile.id <> auth.uid() and public.is_user_blocked_between(auth.uid(), v_profile.id) then '{}'::jsonb
      else public.sanitize_social_app_links(v_profile.social_links, false)
    end
  );
end;
$$;

revoke all on function public.get_profile_card_appearance(uuid) from public, anon;
grant execute on function public.get_profile_card_appearance(uuid) to authenticated;

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
  if v_profile_vis not in ('EVERYONE', 'FRIENDS_OF_FRIENDS', 'FRIENDS_ONLY', 'NOBODY') then
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
        select ((p.id = v_uid) or public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility')) as can_view
      ) vis
      where p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and (p.id = v_uid or not public.is_user_blocked_between(v_uid, p.id))
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
          'avatar_url', p.avatar_url,
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
          'avatar_url', p.avatar_url,
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
          'avatar_url', p.avatar_url,
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
            'profile_visible', (peer.id = v_uid or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility')),
            'full_name', peer.full_name,
            'username', case
              when peer.id = v_uid or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility') then peer.username
              else null
            end,
            'avatar_url', peer.avatar_url,
            'social_links', case
              when peer.id = v_uid or public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility') then public.sanitize_social_app_links(peer.social_links, false)
              else '{}'::jsonb
            end,
            'is_friend', (peer.id <> v_uid and public.are_friends(v_uid, peer.id)),
            'is_blocked', (peer.id <> v_uid and public.is_user_blocked_between(v_uid, peer.id)),
            'blocked_by_me', (peer.id <> v_uid and exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id)),
            'allow_online_status', (peer.id = v_uid or (public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility') and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true))),
            'last_seen_at', case
              when peer.id <> v_uid
                   and public.can_view_social_profile(v_uid, peer.id, peer.chat_privacy ->> 'profile_visibility')
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

revoke all on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_128', 'profile_visibility_privacy')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
