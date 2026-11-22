begin;

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
        'can_add_to_group', (
          c.is_friend
          or coalesce(c.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') <> 'FRIENDS_ONLY'
        ),
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

create or replace function public.create_group_chat(
  p_title text,
  p_member_ids uuid[],
  p_description text default null,
  p_avatar_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_avatar_url text := nullif(btrim(coalesce(p_avatar_url, '')), '');
  v_creator_name text;
  v_member_ids uuid[];
  v_conv public.conversations%rowtype;
  v_msg public.messages%rowtype;
  v_target record;
  v_mid uuid;
  v_sys_body text;
begin
  if char_length(v_title) < 2 or char_length(v_title) > 80 then
    raise exception 'Group name must be between 2 and 80 characters.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 240 then
    raise exception 'Group description must be 240 characters or fewer.' using errcode = '22023';
  end if;
  if not public.is_valid_media_reference(v_avatar_url) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_member_ids
  from unnest(coalesce(p_member_ids, '{}')) as x
  where x is not null and x <> v_uid;

  if coalesce(array_length(v_member_ids, 1), 0) < 1 then
    raise exception 'Select at least 1 other member to start a group chat.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_member_ids, 1), 0) > 49 then
    raise exception 'A group chat supports up to 50 total members.' using errcode = '22023';
  end if;

  select full_name into v_creator_name from public.profiles where id = v_uid;

  foreach v_mid in array v_member_ids loop
    select id, full_name, status, role, chat_privacy into v_target
    from public.profiles where id = v_mid;

    if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'One or more selected accounts are unavailable for group chats.' using errcode = '42501';
    end if;
    if public.is_user_blocked_between(v_uid, v_mid) then
      raise exception 'Cannot add % because messaging is blocked between you two.', coalesce(v_target.full_name, 'this user') using errcode = '42501';
    end if;
    if not public.are_friends(v_uid, v_mid)
       and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY' then
      raise exception '% only accepts chats from friends.', coalesce(v_target.full_name, 'Selected user') using errcode = '42501';
    end if;
  end loop;

  insert into public.conversations (
    kind, title, description, avatar_url, created_by, initiator_id, status, accepted_at
  ) values (
    'GROUP', v_title, v_desc, v_avatar_url, v_uid, v_uid, 'ACCEPTED', now()
  )
  returning * into v_conv;

  insert into public.conversation_participants (conversation_id, user_id, role, added_by, last_read_at)
  values (v_conv.id, v_uid, 'OWNER', v_uid, now());

  foreach v_mid in array v_member_ids loop
    insert into public.conversation_participants (conversation_id, user_id, role, added_by)
    values (v_conv.id, v_mid, 'MEMBER', v_uid)
    on conflict (conversation_id, user_id) do nothing;
  end loop;

  v_sys_body := coalesce(v_creator_name, 'Someone') || ' created the group "' || v_title || '"';
  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (
    v_conv.id,
    v_uid,
    v_sys_body,
    'SYSTEM',
    jsonb_build_object('event', 'GROUP_CREATED', 'title', v_title, 'member_count', array_length(v_member_ids, 1) + 1)
  )
  returning * into v_msg;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = left(v_sys_body, 140),
      last_message_sender_id = v_uid
  where id = v_conv.id;

  update public.conversation_participants
  set last_read_message_id = v_msg.id, last_read_at = v_msg.created_at
  where conversation_id = v_conv.id and user_id = v_uid;

  foreach v_mid in array v_member_ids loop
    perform public.push_social_notification(
      v_mid,
      v_uid,
      'SOCIAL_NEW_MESSAGE',
      v_title,
      coalesce(v_creator_name, 'Someone') || ' added you to the group "' || v_title || '".',
      'dashboard.html?chat=' || v_conv.id::text,
      'SOCIAL_MSG:' || v_conv.id::text
    );
  end loop;

  return jsonb_build_object(
    'id', v_conv.id,
    'kind', 'GROUP',
    'title', v_conv.title,
    'avatar_url', v_conv.avatar_url,
    'status', v_conv.status,
    'member_count', array_length(v_member_ids, 1) + 1
  );
end;
$$;

create or replace function public.add_group_chat_members(
  p_conversation_id uuid,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_part public.conversation_participants%rowtype;
  v_existing_count integer := 0;
  v_new_ids uuid[];
  v_added_names text[] := '{}';
  v_target record;
  v_actor_name text;
  v_mid uuid;
  v_sys_body text;
  v_msg public.messages%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.kind <> 'GROUP' then
    raise exception 'Group chat not found.' using errcode = 'P0002';
  end if;

  select * into v_part
  from public.conversation_participants
  where conversation_id = v_conv.id and user_id = v_uid;
  if v_part.user_id is null or v_part.role not in ('OWNER', 'ADMIN') then
    raise exception 'Only group owners or admins can add members.' using errcode = '42501';
  end if;

  select count(*)::integer into v_existing_count
  from public.conversation_participants
  where conversation_id = v_conv.id;

  select coalesce(array_agg(distinct x), '{}') into v_new_ids
  from unnest(coalesce(p_member_ids, '{}')) as x
  where x is not null
    and not exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = v_conv.id and cp.user_id = x
    );

  if coalesce(array_length(v_new_ids, 1), 0) = 0 then
    raise exception 'Select at least one person who is not already in this group.' using errcode = '22023';
  end if;
  if v_existing_count + array_length(v_new_ids, 1) > 50 then
    raise exception 'A group chat supports up to 50 members.' using errcode = '22023';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;

  foreach v_mid in array v_new_ids loop
    select id, full_name, status, role, chat_privacy into v_target
    from public.profiles where id = v_mid;
    if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'One or more selected accounts are unavailable.' using errcode = '42501';
    end if;
    if public.is_user_blocked_between(v_uid, v_mid) then
      raise exception 'Cannot add % because messaging is blocked between you two.', coalesce(v_target.full_name, 'this user') using errcode = '42501';
    end if;
    if not public.are_friends(v_uid, v_mid)
       and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') = 'FRIENDS_ONLY' then
      raise exception '% only accepts chats from friends.', coalesce(v_target.full_name, 'Selected user') using errcode = '42501';
    end if;

    insert into public.conversation_participants (conversation_id, user_id, role, added_by)
    values (v_conv.id, v_mid, 'MEMBER', v_uid)
    on conflict (conversation_id, user_id) do nothing;

    v_added_names := array_append(v_added_names, coalesce(v_target.full_name, 'User'));
  end loop;

  v_sys_body := case
    when array_length(v_added_names, 1) = 1
      then coalesce(v_actor_name, 'Someone') || ' added ' || v_added_names[1]
    else coalesce(v_actor_name, 'Someone') || ' added ' || v_added_names[1] || ' and ' || (array_length(v_added_names, 1) - 1)::text || ' other(s)'
  end;

  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (v_conv.id, v_uid, v_sys_body, 'SYSTEM', jsonb_build_object('event', 'MEMBERS_ADDED', 'added_ids', v_new_ids))
  returning * into v_msg;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = left(v_sys_body, 140),
      last_message_sender_id = v_uid
  where id = v_conv.id;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false,
      last_read_message_id = case when user_id = v_uid then v_msg.id else last_read_message_id end,
      last_read_at = case when user_id = v_uid then v_msg.created_at else last_read_at end
  where conversation_id = v_conv.id
    and (user_id = v_uid or user_id = any(v_new_ids));

  foreach v_mid in array v_new_ids loop
    perform public.push_social_notification(
      v_mid,
      v_uid,
      'SOCIAL_NEW_MESSAGE',
      coalesce(v_conv.title, 'Group Chat'),
      coalesce(v_actor_name, 'Someone') || ' added you to "' || coalesce(v_conv.title, 'Group Chat') || '".',
      'dashboard.html?chat=' || v_conv.id::text,
      'SOCIAL_MSG:' || v_conv.id::text
    );
  end loop;

  return jsonb_build_object('added_count', array_length(v_new_ids, 1), 'conversation_id', v_conv.id);
end;
$$;

revoke all on function public.search_social_users(text, integer), public.create_group_chat(text, uuid[], text, text), public.add_group_chat_members(uuid, uuid[]) from public, anon;
grant execute on function public.search_social_users(text, integer), public.create_group_chat(text, uuid[], text, text), public.add_group_chat_members(uuid, uuid[]) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_173', 'exclude friends-only non-friends from group member picker and default group privacy check to FRIENDS_ONLY')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
