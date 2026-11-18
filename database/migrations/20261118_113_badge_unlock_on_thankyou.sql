begin;

-- Keep badges hidden beside user names until the recipient clicks "Thank you"
-- (verified_badge_acknowledged_at is set), while preserving unacknowledged grants
-- in the database until they expire or hit 2 months of inactivity.
drop function if exists public.effective_verified_badge_for_user(text, timestamptz, timestamptz, timestamptz, timestamptz, text, timestamptz);

create or replace function public.effective_verified_badge_for_user(
  p_tier text,
  p_expires_at timestamptz,
  p_granted_at timestamptz,
  p_last_seen_at timestamptz,
  p_created_at timestamptz,
  p_email text default null,
  p_last_sign_in_at timestamptz default null,
  p_acknowledged_at timestamptz default null
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tier text := upper(btrim(coalesce(p_tier, 'NONE')));
  v_last_active timestamptz;
begin
  if v_tier not in ('BLUE', 'CREATOR_GREEN') then
    return 'NONE';
  end if;

  if v_tier <> 'CREATOR_GREEN' and p_acknowledged_at is null then
    return 'NONE';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    return 'NONE';
  end if;

  if v_tier <> 'CREATOR_GREEN' and not public.is_protected_retention_account(p_email) then
    v_last_active := greatest(
      coalesce(p_last_seen_at, '-infinity'::timestamptz),
      coalesce(p_granted_at, '-infinity'::timestamptz),
      coalesce(p_last_sign_in_at, '-infinity'::timestamptz),
      coalesce(p_created_at, now())
    );
    if v_last_active <= now() - interval '2 months' then
      return 'NONE';
    end if;
  end if;

  return v_tier;
end;
$$;

revoke all on function public.effective_verified_badge_for_user(text, timestamptz, timestamptz, timestamptz, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated;

-- Re-create get_active_verified_badges checking p.verified_badge_acknowledged_at
drop function if exists public.get_active_verified_badges();

create function public.get_active_verified_badges()
returns table (
  user_id uuid,
  verified_badge text,
  granted_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select p.id as user_id,
         public.effective_verified_badge_for_user(
           p.verified_badge_tier,
           p.verified_badge_expires_at,
           p.verified_badge_granted_at,
           p.last_seen_at,
           p.created_at,
           coalesce(nullif(p.email, ''), u.email),
           u.last_sign_in_at,
           p.verified_badge_acknowledged_at
         ) as verified_badge,
         coalesce(p.verified_badge_granted_at, p.created_at) as granted_at,
         p.verified_badge_expires_at as expires_at
  from public.profiles p
  left join auth.users u on u.id = p.id
  where auth.uid() is not null
    and public.effective_verified_badge_for_user(
      p.verified_badge_tier,
      p.verified_badge_expires_at,
      p.verified_badge_granted_at,
      p.last_seen_at,
      p.created_at,
      coalesce(nullif(p.email, ''), u.email),
      u.last_sign_in_at,
      p.verified_badge_acknowledged_at
    ) <> 'NONE';
$$;

revoke all on function public.get_active_verified_badges() from public, anon;
grant execute on function public.get_active_verified_badges() to authenticated;

-- Pass coalesce(p.verified_badge_acknowledged_at, now()) so pending unacknowledged awards are NOT purged prematurely
create or replace function public.cleanup_inactive_verified_badges()
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row record;
  v_cleaned integer := 0;
  v_reason text;
begin
  if auth.uid() is null then
    return 0;
  end if;

  for v_row in
    select p.id,
           p.verified_badge_expires_at,
           p.verified_badge_granted_at,
           p.last_seen_at,
           p.created_at,
           coalesce(nullif(p.email, ''), u.email) as resolved_email,
           u.last_sign_in_at
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.verified_badge_tier <> 'NONE'
      and public.effective_verified_badge_for_user(
        p.verified_badge_tier,
        p.verified_badge_expires_at,
        p.verified_badge_granted_at,
        p.last_seen_at,
        p.created_at,
        coalesce(nullif(p.email, ''), u.email),
        u.last_sign_in_at,
        coalesce(p.verified_badge_acknowledged_at, now())
      ) = 'NONE'
  loop
    v_reason := case
      when v_row.verified_badge_expires_at is not null and v_row.verified_badge_expires_at <= now() then
        'Your temporary verified badge duration ended.'
      else
        'Automatically removed after 2 months of account inactivity.'
    end;

    update public.profiles
    set verified_badge_tier = 'NONE',
        verified_badge_expires_at = null,
        verified_badge_message = null,
        verified_badge_granted_at = null,
        verified_badge_acknowledged_at = now(),
        verified_badge_granted_by = null
    where id = v_row.id
      and verified_badge_tier <> 'NONE';

    if found then
      v_cleaned := v_cleaned + 1;
      insert into public.notifications (
        recipient_id,
        group_id,
        type,
        title,
        message,
        link,
        dedupe_key
      ) values (
        v_row.id,
        null,
        'BADGE_REMOVED',
        'Verified badge removed',
        left('Your verified badge was removed. Reason: ' || v_reason, 500),
        null,
        'BADGE_AUTO_REMOVED:' || v_row.id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
      );
    end if;
  end loop;

  return v_cleaned;
end;
$$;

revoke all on function public.cleanup_inactive_verified_badges() from public, anon;
grant execute on function public.cleanup_inactive_verified_badges() to authenticated;

-- Update grant notification copy cleanly for permanent vs temporary durations
create or replace function public.super_admin_grant_verified_badge(
  p_user_id uuid,
  p_duration_days integer default null,
  p_expires_at timestamptz default null,
  p_creator_message text default '',
  p_badge_tier text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target record;
  v_email text;
  v_tier text;
  v_expires_at timestamptz := null;
  v_message text;
  v_duration_label text;
  v_policy_note text;
  v_notif_message text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can assign verified badges.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Select a valid user account.' using errcode = '22023';
  end if;

  select p.id, p.full_name, p.role, p.status, p.email, u.email as auth_email
  into v_target
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if v_target.id is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_target.role = 'SUPER_ADMIN' then
    raise exception 'Super Admin system accounts cannot be assigned user badges here.' using errcode = '22023';
  end if;

  if v_target.status <> 'ACTIVE' then
    raise exception 'Only active user accounts can receive a verified badge.' using errcode = '22023';
  end if;

  v_email := lower(btrim(coalesce(nullif(v_target.email, ''), v_target.auth_email, '')));
  v_tier := upper(btrim(coalesce(nullif(p_badge_tier, ''), case when v_email = 'breadspanish231@gmail.com' then 'CREATOR_GREEN' else 'BLUE' end)));

  if v_tier not in ('BLUE', 'CREATOR_GREEN') then
    raise exception 'Choose a valid badge type.' using errcode = '22023';
  end if;

  if v_tier = 'CREATOR_GREEN' and v_email <> 'breadspanish231@gmail.com' then
    v_tier := 'BLUE';
  end if;

  if p_duration_days is not null and p_expires_at is not null then
    raise exception 'Choose either a duration in days or a custom expiration date.' using errcode = '22023';
  end if;

  if p_duration_days is not null then
    if p_duration_days < 1 or p_duration_days > 3650 then
      raise exception 'Badge duration must be between 1 and 3,650 days.' using errcode = '22023';
    end if;
    v_expires_at := now() + make_interval(days => p_duration_days);
  elsif p_expires_at is not null then
    if p_expires_at <= now() + interval '1 minute' then
      raise exception 'Custom expiration date must be in the future.' using errcode = '22023';
    end if;
    v_expires_at := p_expires_at;
  else
    v_expires_at := null;
  end if;

  v_message := nullif(left(btrim(coalesce(p_creator_message, '')), 400), '');

  update public.profiles
  set verified_badge_tier = v_tier,
      verified_badge_expires_at = v_expires_at,
      verified_badge_message = v_message,
      verified_badge_granted_at = now(),
      verified_badge_acknowledged_at = null,
      verified_badge_granted_by = v_admin_id
  where id = p_user_id;

  v_duration_label := case
    when v_expires_at is null then 'Permanent'
    else 'Valid until ' || to_char(v_expires_at at time zone 'Asia/Manila', 'Mon DD, YYYY')
  end;

  v_policy_note := case
    when v_expires_at is null then 'Permanent badges stay active while you use myIPON, but are automatically removed after 2 months of inactivity.'
    else 'Open myIPON and tap Thank you to display your badge.'
  end;

  v_notif_message := case
    when v_message is not null then
      'Congratulations! You received a verified badge (' || v_duration_label || '). Message from creator: "' || v_message || '". ' || v_policy_note
    else
      'Congratulations! You received a verified badge (' || v_duration_label || '). ' || v_policy_note
  end;

  insert into public.notifications (
    recipient_id,
    group_id,
    type,
    title,
    message,
    link,
    dedupe_key
  ) values (
    p_user_id,
    null,
    'BADGE_GRANTED',
    'Congratulations! Verified badge awarded',
    left(v_notif_message, 500),
    null,
    'BADGE_GRANTED:' || p_user_id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'verified_badge_tier', v_tier,
    'verified_badge_expires_at', v_expires_at,
    'verified_badge_message', v_message,
    'verified_badge_granted_at', now()
  );
end;
$$;

-- Include verified_badge_acknowledged_at check inside get_social_user_profile
create or replace function public.get_social_user_profile(p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
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
  v_badge_tier text;
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'Select another valid user profile.' using errcode = '22023';
  end if;

  select p.id, p.full_name, p.username, p.bio, p.avatar_url, p.role, p.status,
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
    'verified_badge', v_badge_tier,
    'verified_badge_granted_at', case when v_badge_tier = 'NONE' then null else coalesce(v_target.verified_badge_granted_at, v_target.created_at) end,
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
    'friends_count', case
      when v_blocked_me or v_blocked_by_me then 0
      else public.get_user_friends_count(v_uid, p_target_id)
    end,
    'mutual_friends_count', coalesce((v_mutual ->> 'count')::integer, 0),
    'mutual_friends', coalesce(v_mutual -> 'friends', '[]'::jsonb),
    'conversation_id', v_conv_id
  );
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261118_113', 'Unlock verified badge visibility next to names only after Thank you acknowledgement')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
