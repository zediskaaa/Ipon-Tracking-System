begin;

create or replace function public.send_friend_request(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_sender_name text;
  v_target record;
  v_shared boolean;
  v_reverse public.friend_requests%rowtype;
  v_new_id uuid;
  v_pair text;
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'You cannot send a friend request to yourself.' using errcode = '22023';
  end if;

  select full_name into v_sender_name from public.profiles where id = v_uid;
  select id, full_name, role, status, chat_privacy into v_target
  from public.profiles where id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This account cannot receive friend requests.' using errcode = '42501';
  end if;

  if public.is_user_blocked_between(v_uid, p_target_id) then
    raise exception 'Unable to send a friend request because one of you has blocked the other.' using errcode = '42501';
  end if;

  if public.are_friends(v_uid, p_target_id) then
    return jsonb_build_object('status', 'ALREADY_FRIENDS');
  end if;

  if coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') = 'NOBODY' then
    raise exception 'This user is not accepting friend requests.' using errcode = '42501';
  end if;

  if coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') = 'MUTUAL_GROUPS' then
    select exists (
      select 1
      from (
        select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
        union
        select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
      ) a
      join (
        select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p_target_id and gm2.status = 'ACTIVE'
        union
        select p2.group_id from public.profiles p2 where p2.id = p_target_id and p2.group_id is not null
      ) b on a.group_id = b.group_id
    ) into v_shared;
    if not v_shared then
      raise exception 'This user only accepts friend requests from members in a shared group.' using errcode = '42501';
    end if;
  end if;

  v_pair := public.canonical_pair_key(v_uid, p_target_id);
  select * into v_reverse
  from public.friend_requests
  where pair_key = v_pair and status = 'PENDING'
  limit 1;

  if v_reverse.id is not null then
    if v_reverse.sender_id = v_uid then
      return jsonb_build_object('id', v_reverse.id, 'status', 'PENDING');
    end if;
    -- Mutual request: accept reverse request automatically
    update public.friend_requests
    set status = 'ACCEPTED', responded_at = now()
    where id = v_reverse.id;

    insert into public.friendships (user_a, user_b)
    values (least(v_uid, p_target_id), greatest(v_uid, p_target_id))
    on conflict (user_a, user_b) do nothing;

    update public.conversations
    set status = 'ACCEPTED', accepted_at = coalesce(accepted_at, now())
    where pair_key = v_pair and status = 'PENDING_REQUEST';

    perform public.push_social_notification(
      p_target_id,
      v_uid,
      'SOCIAL_FRIEND_ACCEPTED',
      'Friend request accepted',
      coalesce(v_sender_name, 'Someone') || ' accepted your friend request.',
      'dashboard.html?messages=friends',
      'SOCIAL_FRIEND_ACCEPTED:' || v_reverse.id::text
    );

    return jsonb_build_object('id', v_reverse.id, 'status', 'ACCEPTED', 'auto_accepted', true);
  end if;

  insert into public.friend_requests (sender_id, receiver_id, status)
  values (v_uid, p_target_id, 'PENDING')
  returning id into v_new_id;

  perform public.push_social_notification(
    p_target_id,
    v_uid,
    'SOCIAL_FRIEND_REQUEST',
    'New friend request',
    coalesce(v_sender_name, 'Someone') || ' sent you a friend request.',
    'dashboard.html?messages=friend_requests',
    'SOCIAL_FRIEND_REQ:' || v_pair
  );

  return jsonb_build_object('id', v_new_id, 'status', 'PENDING');
end;
$$;

update public.notifications
set link = 'dashboard.html?messages=friend_requests'
where type = 'SOCIAL_FRIEND_REQUEST'
  and coalesce(link, '') in ('', 'dashboard.html?messages=requests', 'dashboard.html?messages=inbox');

update public.notifications
set link = 'dashboard.html?messages=friends'
where type = 'SOCIAL_FRIEND_ACCEPTED'
  and coalesce(link, '') in ('', 'dashboard.html?messages=requests', 'dashboard.html?messages=inbox');

insert into public.schema_migrations (version, name)
values ('20261121_153', 'friend_request_notification_link')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
