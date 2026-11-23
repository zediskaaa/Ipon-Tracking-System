begin;

-- Session refreshes and recorded actions continue to prove activity after the chat heartbeat ends.
-- Keep this helper private: callers already run with narrowly scoped definer privileges.
create or replace function public.latest_retention_activity_at(p_user_id uuid)
returns timestamptz
language sql stable security definer
set search_path = public, auth
as $$
  select greatest(
    coalesce((select max(s.updated_at) from auth.sessions s where s.user_id = p_user_id), '-infinity'::timestamptz),
    coalesce((select max(a.created_at) from public.account_activity a where a.user_id = p_user_id
      and a.event in ('LOGIN', 'PROFILE_UPDATE', 'PASSWORD_CHANGE')), '-infinity'::timestamptz)
  );
$$;

revoke all on function public.latest_retention_activity_at(uuid) from public, anon, authenticated;

create or replace function public.collect_inactive_account_candidates(
  p_inactive_months integer default 6,
  p_warning_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inactive_span interval := make_interval(months => greatest(coalesce(p_inactive_months, 6), 1));
  v_warning_span interval := make_interval(days => greatest(coalesce(p_warning_days, 7), 1));
  v_warn_cutoff timestamptz := now() - (v_inactive_span - v_warning_span);
  v_warn_candidates jsonb := '[]'::jsonb;
  v_purge_candidates jsonb := '[]'::jsonb;
begin
  update public.profiles p
  set inactivity_warned_at = null
  from auth.users u
  where u.id = p.id
    and p.inactivity_warned_at is not null
    and (
      public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
      or greatest(
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce(p.last_seen_at, p.created_at),
        public.latest_retention_activity_at(p.id),
        coalesce((
          select max(c2.created_at)
          from public.contributions c2
          join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
          where cp2.member_id = p.member_id
            and c2.approval_status = 'CONFIRMED'
        ), 'epoch'::timestamptz)
      ) > p.inactivity_warned_at
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'email', coalesce(nullif(p.email, ''), u.email),
        'full_name', p.full_name,
        'inactivity_warned_at', p.inactivity_warned_at
      )
    ),
    '[]'::jsonb
  )
  into v_purge_candidates
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role <> 'SUPER_ADMIN'
    and not public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
    and p.inactivity_warned_at is not null
    and p.inactivity_warned_at <= now() - v_warning_span
    and greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce(p.last_seen_at, p.created_at),
        public.latest_retention_activity_at(p.id),
      coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
      coalesce((
        select max(c2.created_at)
        from public.contributions c2
        join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
        where cp2.member_id = p.member_id
          and c2.approval_status = 'CONFIRMED'
      ), 'epoch'::timestamptz),
      coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
    ) <= p.inactivity_warned_at
    and not (
      p.group_id is not null
      and exists (
        select 1
        from public.savings_goals sg
        where sg.group_id = p.group_id
          and sg.deleted_at is null
          and sg.status = 'ACTIVE'
      )
      and public.group_last_savings_activity_at(p.group_id) > now() - v_inactive_span
    );

  with due_warn as (
    select p.id, coalesce(nullif(p.email, ''), u.email) as email, p.full_name,
           greatest(
             coalesce(u.last_sign_in_at, u.created_at),
             coalesce(p.last_seen_at, p.created_at),
        public.latest_retention_activity_at(p.id),
             coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
             coalesce((
               select max(c2.created_at)
               from public.contributions c2
               join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
               where cp2.member_id = p.member_id
                 and c2.approval_status = 'CONFIRMED'
             ), 'epoch'::timestamptz),
             coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
           ) as last_active_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role <> 'SUPER_ADMIN'
      and not public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email))
      and p.inactivity_warned_at is null
      and not (
        p.group_id is not null
        and exists (
          select 1
          from public.savings_goals sg
          where sg.group_id = p.group_id
            and sg.deleted_at is null
            and sg.status = 'ACTIVE'
        )
        and public.group_last_savings_activity_at(p.group_id) > now() - v_inactive_span
      )
      and greatest(
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce(p.last_seen_at, p.created_at),
        public.latest_retention_activity_at(p.id),
        coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
        coalesce((
          select max(c2.created_at)
          from public.contributions c2
          join public.contribution_periods cp2 on cp2.id = c2.contribution_period_id
          where cp2.member_id = p.member_id
            and c2.approval_status = 'CONFIRMED'
        ), 'epoch'::timestamptz),
        coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
      ) <= v_warn_cutoff
  ),
  stamped as (
    update public.profiles p
    set inactivity_warned_at = now()
    from due_warn dw
    where p.id = dw.id
    returning dw.id as user_id, dw.email, dw.full_name, dw.last_active_at, (now() + v_warning_span) as scheduled_purge_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', s.user_id,
        'email', s.email,
        'full_name', s.full_name,
        'last_active_at', s.last_active_at,
        'scheduled_purge_at', s.scheduled_purge_at
      )
    ),
    '[]'::jsonb
  )
  into v_warn_candidates
  from stamped s;

  return jsonb_build_object(
    'warn_candidates', v_warn_candidates,
    'purge_candidates', v_purge_candidates
  );
end;
$$;

create or replace function public.get_active_verified_badges()
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
           greatest(p.last_seen_at, public.latest_retention_activity_at(p.id)),
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
      greatest(p.last_seen_at, public.latest_retention_activity_at(p.id)),
      p.created_at,
      coalesce(nullif(p.email, ''), u.email),
      u.last_sign_in_at,
      p.verified_badge_acknowledged_at
    ) <> 'NONE';
$$;

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
           greatest(p.last_seen_at, public.latest_retention_activity_at(p.id)),
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
    greatest(v_target.last_seen_at, public.latest_retention_activity_at(v_target.id)),
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
      'can_block', false,
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
    'can_message', (not v_blocked_by_me and not v_blocked_me and (
      v_is_friend or public.is_creator_messaging_account(v_uid)
      or (public.is_creator_messaging_account(p_target_id) and exists (
        select 1 from public.conversations c where c.id = v_conv_id
          and c.status = 'ACCEPTED' and c.initiator_id = p_target_id
      ))
      or coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'FRIENDS_ONLY') <> 'FRIENDS_ONLY'
    )),
    'can_block', not public.is_creator_messaging_account(p_target_id),
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

insert into public.schema_migrations (version, name)
values ('20261123_187', 'use session and account activity for inactivity and badges')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
