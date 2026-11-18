begin;

alter table public.profiles
  add column if not exists verified_badge_tier text not null default 'NONE',
  add column if not exists verified_badge_expires_at timestamptz,
  add column if not exists verified_badge_message text,
  add column if not exists verified_badge_granted_at timestamptz,
  add column if not exists verified_badge_acknowledged_at timestamptz,
  add column if not exists verified_badge_granted_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_verified_badge_tier_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_verified_badge_tier_check
      check (verified_badge_tier in ('NONE', 'BLUE', 'CREATOR_GREEN'));
  end if;
end $$;

create or replace function public.effective_verified_badge(
  p_tier text,
  p_expires_at timestamptz
)
returns text
language sql
stable
as $$
  select case
    when p_tier is null or btrim(p_tier) = '' or btrim(p_tier) = 'NONE' then 'NONE'
    when p_expires_at is not null and p_expires_at <= now() then 'NONE'
    when btrim(p_tier) in ('BLUE', 'CREATOR_GREEN') then btrim(p_tier)
    else 'NONE'
  end;
$$;

grant execute on function public.effective_verified_badge(text, timestamptz) to authenticated;

-- Permanently award Creator Green dual badges to the owner's primary account
update public.profiles p
set verified_badge_tier = 'CREATOR_GREEN',
    verified_badge_expires_at = null,
    verified_badge_message = coalesce(nullif(btrim(p.verified_badge_message), ''), 'Creator & Lead Developer of myIPON.'),
    verified_badge_granted_at = coalesce(p.verified_badge_granted_at, now()),
    verified_badge_acknowledged_at = coalesce(p.verified_badge_acknowledged_at, now())
from auth.users u
where u.id = p.id
  and lower(btrim(coalesce(nullif(p.email, ''), u.email))) = 'breadspanish231@gmail.com';

create or replace function public.get_active_verified_badges()
returns table (
  user_id uuid,
  verified_badge text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id as user_id,
         public.effective_verified_badge(p.verified_badge_tier, p.verified_badge_expires_at) as verified_badge,
         p.verified_badge_expires_at as expires_at
  from public.profiles p
  where auth.uid() is not null
    and public.effective_verified_badge(p.verified_badge_tier, p.verified_badge_expires_at) <> 'NONE';
$$;

revoke all on function public.get_active_verified_badges() from public, anon;
grant execute on function public.get_active_verified_badges() to authenticated;

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

  v_notif_message := case
    when v_message is not null then
      'Congratulations! You received a verified badge (' || v_duration_label || '). Message from creator: "' || v_message || '"'
    else
      'Congratulations! The creator awarded you a verified badge (' || v_duration_label || ').'
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
    'verified_badge_message', v_message
  );
end;
$$;

revoke all on function public.super_admin_grant_verified_badge(uuid, integer, timestamptz, text, text) from public, anon;
grant execute on function public.super_admin_grant_verified_badge(uuid, integer, timestamptz, text, text) to authenticated;

create or replace function public.super_admin_remove_verified_badge(
  p_user_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
  v_reason text := left(btrim(coalesce(p_reason, '')), 400);
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can remove verified badges.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Select a valid user account.' using errcode = '22023';
  end if;

  if char_length(v_reason) < 2 then
    raise exception 'Enter a short reason explaining why the badge is being removed.' using errcode = '22023';
  end if;

  select id, full_name, verified_badge_tier
  into v_target
  from public.profiles
  where id = p_user_id;

  if v_target.id is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if coalesce(v_target.verified_badge_tier, 'NONE') = 'NONE' then
    raise exception 'This user does not currently hold a verified badge.' using errcode = '22023';
  end if;

  update public.profiles
  set verified_badge_tier = 'NONE',
      verified_badge_expires_at = null,
      verified_badge_message = null,
      verified_badge_granted_at = null,
      verified_badge_acknowledged_at = now(),
      verified_badge_granted_by = null
  where id = p_user_id;

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
    'BADGE_REMOVED',
    'Verified badge removed',
    left('Your verified badge was removed by the creator. Reason: ' || v_reason, 500),
    null,
    'BADGE_REMOVED:' || p_user_id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'removed', true,
    'reason', v_reason
  );
end;
$$;

revoke all on function public.super_admin_remove_verified_badge(uuid, text) from public, anon;
grant execute on function public.super_admin_remove_verified_badge(uuid, text) to authenticated;

create or replace function public.acknowledge_my_verified_badge()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;

  update public.profiles
  set verified_badge_acknowledged_at = v_now
  where id = v_uid;

  return jsonb_build_object('acknowledged_at', v_now);
end;
$$;

revoke all on function public.acknowledge_my_verified_badge() from public, anon;
grant execute on function public.acknowledge_my_verified_badge() to authenticated;

-- Include verified_badge directly inside get_social_user_profile while preserving friends_count & mutual_friends
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

  select id, full_name, username, bio, avatar_url, role, status, last_seen_at, chat_privacy,
         verified_badge_tier, verified_badge_expires_at
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
    'verified_badge', public.effective_verified_badge(v_target.verified_badge_tier, v_target.verified_badge_expires_at),
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
values ('20261118_111', 'Verified user blue badge and dual creator green badges with duration, creator message, first-open celebration modal, and notification-only removal')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
