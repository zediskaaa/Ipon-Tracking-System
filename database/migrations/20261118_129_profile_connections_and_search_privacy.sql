-- Hide "No one" users from discovery/search unless a direct chat connection exists, and add "Friends and connections" profile visibility
begin;

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
      and c.status <> 'DECLINED'
      and (
        c.status = 'ACCEPTED'
        or c.initiator_id = p_target_id
        or exists (
          select 1
          from public.messages m
          where m.conversation_id = c.id
            and m.sender_id = p_target_id
            and m.deleted_for_everyone_at is null
        )
      )
  );
end;
$$;

revoke all on function public.has_direct_chat_connection(uuid, uuid) from public, anon, authenticated;

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
    return public.has_direct_chat_connection(p_viewer_id, p_target_id);
  elsif v_vis = 'FRIENDS_ONLY' then
    return public.are_friends(p_viewer_id, p_target_id);
  elsif v_vis = 'FRIENDS_AND_CONNECTIONS' then
    return public.are_friends(p_viewer_id, p_target_id)
      or public.has_direct_chat_connection(p_viewer_id, p_target_id);
  elsif v_vis = 'FRIENDS_OF_FRIENDS' then
    if public.are_friends(p_viewer_id, p_target_id)
       or public.has_direct_chat_connection(p_viewer_id, p_target_id) then
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
    if v_profile_vis not in ('EVERYONE', 'FRIENDS_OF_FRIENDS', 'FRIENDS_AND_CONNECTIONS', 'FRIENDS_ONLY', 'NOBODY') then
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

insert into public.schema_migrations (version, name)
values ('20261118_129', 'profile_connections_and_search_privacy')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
