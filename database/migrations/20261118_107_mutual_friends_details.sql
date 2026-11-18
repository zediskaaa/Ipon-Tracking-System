begin;

-- Helper returning total mutual friends count + active mutual friend profiles (id, full_name, username, avatar_url)
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
    select p.id, p.full_name, p.username, p.avatar_url
    from my_friends mf
    join public.friendships f2
      on f2.user_a = least(mf.fid, p_target_id)
     and f2.user_b = greatest(mf.fid, p_target_id)
    join public.profiles p on p.id = mf.fid
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
            'avatar_url', m.avatar_url
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

-- Update get_social_user_profile to return mutual_friends list alongside mutual_friends_count
create or replace function public.get_social_user_profile(p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_target record;
  v_is_friend boolean;
  v_blocked_by_me boolean;
  v_blocked_me boolean;
  v_req record;
  v_shared_groups text[];
  v_mutual jsonb;
  v_conv_id uuid;
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'Select another valid user profile.' using errcode = '22023';
  end if;

  select id, full_name, username, bio, avatar_url, role, status, last_seen_at, chat_privacy
  into v_target
  from public.profiles
  where id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This account is not available for messaging or connections.' using errcode = 'P0002';
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

  select id into v_conv_id
  from public.conversations
  where pair_key = public.canonical_pair_key(v_uid, p_target_id);

  return jsonb_build_object(
    'id', v_target.id,
    'full_name', v_target.full_name,
    'username', v_target.username,
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
    'mutual_friends_count', coalesce((v_mutual ->> 'count')::integer, 0),
    'mutual_friends', coalesce(v_mutual -> 'friends', '[]'::jsonb),
    'conversation_id', v_conv_id
  );
end;
$$;

-- Update search_social_users to include mutual_friends preview list
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
        p.full_name,
        p.username,
        p.bio,
        p.avatar_url,
        p.last_seen_at,
        p.chat_privacy,
        exists (select 1 from my_friends mf where mf.fid = p.id) as is_friend,
        (
          select fr.id
          from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id) and fr.status = 'PENDING'
          limit 1
        ) as pending_request_id,
        (
          select fr.sender_id
          from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id) and fr.status = 'PENDING'
          limit 1
        ) as pending_sender_id,
        (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) as shared_groups,
        public.get_mutual_friends_summary(v_uid, p.id, 16) as mutual_summary
      from public.profiles p
      where p.id <> v_uid
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
        and (
          v_q = ''
          or lower(p.full_name) like '%' || v_q || '%'
          or lower(coalesce(p.username, '')) like '%' || replace(v_q, '@', '') || '%'
          or lower(coalesce(p.bio, '')) like '%' || v_q || '%'
        )
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'username', c.username,
        'bio', c.bio,
        'avatar_url', c.avatar_url,
        'friendship_status', case
          when c.is_friend then 'FRIENDS'
          when c.pending_request_id is not null and c.pending_sender_id = v_uid then 'OUTGOING_REQUEST'
          when c.pending_request_id is not null then 'INCOMING_REQUEST'
          else 'NONE'
        end,
        'friend_request_id', c.pending_request_id,
        'shared_groups', c.shared_groups,
        'mutual_friends_count', coalesce((c.mutual_summary ->> 'count')::integer, 0),
        'mutual_friends', coalesce(c.mutual_summary -> 'friends', '[]'::jsonb),
        'can_message', (c.is_friend or coalesce(c.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY'),
        'allow_online_status', coalesce((c.chat_privacy ->> 'show_online')::boolean, true),
        'last_seen_at', case
          when coalesce((c.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((c.chat_privacy ->> 'show_last_seen')::boolean, true)
          then c.last_seen_at
          else null
        end
      )
      order by
        c.is_friend desc,
        coalesce(array_length(c.shared_groups, 1), 0) desc,
        coalesce((c.mutual_summary ->> 'count')::integer, 0) desc,
        c.full_name asc
    ), '[]'::jsonb)
    from (select * from candidates limit v_lim) c
  );
end;
$$;

-- Update get_friend_suggestions to include mutual_friends preview list
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
        p.full_name,
        p.username,
        p.bio,
        p.avatar_url,
        p.chat_privacy,
        p.last_seen_at,
        (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) as shared_groups,
        public.get_mutual_friends_summary(v_uid, p.id, 16) as mutual_summary
      from public.profiles p
      where p.id <> v_uid
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
        and not public.are_friends(v_uid, p.id)
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
        'full_name', s.full_name,
        'username', s.username,
        'bio', s.bio,
        'avatar_url', s.avatar_url,
        'shared_groups', s.shared_groups,
        'mutual_friends_count', coalesce((s.mutual_summary ->> 'count')::integer, 0),
        'mutual_friends', coalesce(s.mutual_summary -> 'friends', '[]'::jsonb),
        'allow_online_status', coalesce((s.chat_privacy ->> 'show_online')::boolean, true),
        'last_seen_at', case
          when coalesce((s.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((s.chat_privacy ->> 'show_last_seen')::boolean, true)
          then s.last_seen_at
          else null
        end,
        'suggestion_reason', case
          when coalesce((s.mutual_summary ->> 'count')::integer, 0) > 0 and coalesce(array_length(s.shared_groups, 1), 0) > 0
            then (s.mutual_summary ->> 'count') || ' mutual friend(s) · Shared group: ' || s.shared_groups[1]
          when coalesce(array_length(s.shared_groups, 1), 0) > 0
            then 'Same group: ' || s.shared_groups[1]
          when coalesce((s.mutual_summary ->> 'count')::integer, 0) > 0
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

-- Update get_social_overview so friends, incoming_requests, and sent_requests also include mutual_friends details
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
          'full_name', p.full_name,
          'username', p.username,
          'bio', p.bio,
          'avatar_url', p.avatar_url,
          'allow_online_status', coalesce((p.chat_privacy ->> 'show_online')::boolean, true),
          'last_seen_at', case
            when coalesce((p.chat_privacy ->> 'show_online')::boolean, true)
                 and coalesce((p.chat_privacy ->> 'show_last_seen')::boolean, true)
            then p.last_seen_at
            else null
          end,
          'friends_since', f.created_at,
          'mutual_friends_count', coalesce((m.summary ->> 'count')::integer, 0),
          'mutual_friends', coalesce(m.summary -> 'friends', '[]'::jsonb)
        )
        order by p.full_name asc
      )
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_uid then f.user_b else f.user_a end
      cross join lateral (select public.get_mutual_friends_summary(v_uid, p.id, 16) as summary) m
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
          'full_name', p.full_name,
          'username', p.username,
          'avatar_url', p.avatar_url,
          'created_at', fr.created_at,
          'mutual_friends_count', coalesce((m.summary ->> 'count')::integer, 0),
          'mutual_friends', coalesce(m.summary -> 'friends', '[]'::jsonb)
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.sender_id
      cross join lateral (select public.get_mutual_friends_summary(v_uid, p.id, 16) as summary) m
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
          'full_name', p.full_name,
          'username', p.username,
          'avatar_url', p.avatar_url,
          'created_at', fr.created_at,
          'mutual_friends_count', coalesce((m.summary ->> 'count')::integer, 0),
          'mutual_friends', coalesce(m.summary -> 'friends', '[]'::jsonb)
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.receiver_id
      cross join lateral (select public.get_mutual_friends_summary(v_uid, p.id, 16) as summary) m
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

grant execute on function public.get_social_user_profile(uuid) to authenticated;
grant execute on function public.search_social_users(text, integer) to authenticated;
grant execute on function public.get_friend_suggestions(integer) to authenticated;
grant execute on function public.get_social_overview() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_107', 'mutual friends avatar details in social RPCs')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
