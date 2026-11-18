-- Connected social app links in profile bio & My Account (Telegram, Instagram, Facebook, Threads, Discord)
begin;

alter table public.profiles
  add column if not exists social_links jsonb not null default '{}'::jsonb;

alter table public.profiles drop constraint if exists profiles_social_links_object_check;
alter table public.profiles add constraint profiles_social_links_object_check
  check (jsonb_typeof(social_links) = 'object');

create or replace function public.sanitize_social_app_links(
  p_links jsonb,
  p_strict boolean default false
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_keys constant text[] := array['telegram', 'instagram', 'facebook', 'threads', 'discord'];
  v_key text;
  v_val jsonb;
  v_raw text;
  v_handle text;
  v_url text;
  v_host text;
  v_path text;
  v_allowed boolean;
  v_out jsonb := '{}'::jsonb;
begin
  if p_links is null or jsonb_typeof(p_links) = 'null' then
    return '{}'::jsonb;
  end if;

  if jsonb_typeof(p_links) <> 'object' then
    if p_strict then
      raise exception 'Connected app links must be a JSON object.' using errcode = '22023';
    end if;
    return '{}'::jsonb;
  end if;

  foreach v_key in array v_keys loop
    if not (p_links ? v_key) then
      continue;
    end if;

    v_val := p_links -> v_key;
    if v_val is null or jsonb_typeof(v_val) = 'null' then
      continue;
    end if;

    if jsonb_typeof(v_val) <> 'string' then
      if p_strict then
        raise exception 'Connected app link for % must be text.', v_key using errcode = '22023';
      end if;
      continue;
    end if;

    v_raw := btrim(coalesce(p_links ->> v_key, ''));
    if v_raw = '' then
      continue;
    end if;

    if char_length(v_raw) > 240 or v_raw ~ '[[:cntrl:][:space:]<>"''`\\]' then
      if p_strict then
        raise exception 'Enter a valid % link without spaces or invalid characters.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    if v_raw ~* '^(javascript|data|vbscript|file|blob):' then
      if p_strict then
        raise exception 'Enter a valid % link.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_url := null;
    if v_raw ~* '^https?://' then
      v_url := regexp_replace(v_raw, '^https?://', 'https://', 'i');
    elsif v_raw like '//%' then
      v_url := 'https:' || v_raw;
    elsif left(v_raw, 1) = '@' then
      v_handle := substr(v_raw, 2);
      if v_key = 'telegram' and v_handle ~ '^[A-Za-z0-9_]{3,32}$' then
        v_url := 'https://t.me/' || v_handle;
      elsif v_key = 'instagram' and v_handle ~ '^[A-Za-z0-9._]{1,30}$' and position('..' in v_handle) = 0 and left(v_handle, 1) <> '.' and right(v_handle, 1) <> '.' then
        v_url := 'https://www.instagram.com/' || v_handle;
      elsif v_key = 'facebook' and v_handle ~ '^[A-Za-z0-9.]{3,50}$' and position('..' in v_handle) = 0 and left(v_handle, 1) <> '.' and right(v_handle, 1) <> '.' then
        v_url := 'https://www.facebook.com/' || v_handle;
      elsif v_key = 'threads' and v_handle ~ '^[A-Za-z0-9._]{1,30}$' and position('..' in v_handle) = 0 and left(v_handle, 1) <> '.' and right(v_handle, 1) <> '.' then
        v_url := 'https://www.threads.net/@' || v_handle;
      elsif v_key = 'discord' then
        if p_strict then
          raise exception 'For Discord, paste a discord.com/users/... link, discord.gg/... invite, or your numeric Discord User ID.' using errcode = '22023';
        end if;
        continue;
      else
        if p_strict then
          raise exception 'Enter a valid % @username or profile link.', initcap(v_key) using errcode = '22023';
        end if;
        continue;
      end if;
    elsif v_key = 'discord' and v_raw ~ '^[0-9]{15,22}$' then
      v_url := 'https://discord.com/users/' || v_raw;
    elsif v_raw ~* '^(www\.)?(t\.me|telegram\.me|telegram\.dog|instagram\.com|instagr\.am|m\.instagram\.com|facebook\.com|m\.facebook\.com|mbasic\.facebook\.com|web\.facebook\.com|fb\.com|fb\.me|m\.me|threads\.net|threads\.com|discord\.com|discord\.gg|discordapp\.com)(/|\?|$)' then
      v_url := 'https://' || v_raw;
    elsif position('.' in v_raw) = 0 and position('/' in v_raw) = 0 and position(':' in v_raw) = 0 and position('?' in v_raw) = 0 and position('#' in v_raw) = 0 then
      if v_key = 'telegram' and v_raw ~ '^[A-Za-z0-9_]{3,32}$' then
        v_url := 'https://t.me/' || v_raw;
      elsif v_key = 'instagram' and v_raw ~ '^[A-Za-z0-9_]{1,30}$' then
        v_url := 'https://www.instagram.com/' || v_raw;
      elsif v_key = 'facebook' and v_raw ~ '^[A-Za-z0-9]{3,50}$' then
        v_url := 'https://www.facebook.com/' || v_raw;
      elsif v_key = 'threads' and v_raw ~ '^[A-Za-z0-9_]{1,30}$' then
        v_url := 'https://www.threads.net/@' || v_raw;
      elsif v_key = 'discord' then
        if p_strict then
          raise exception 'For Discord, paste a discord.com/users/... link, discord.gg/... invite, or your numeric Discord User ID.' using errcode = '22023';
        end if;
        continue;
      else
        if p_strict then
          raise exception 'Enter a valid % link or @username.', initcap(v_key) using errcode = '22023';
        end if;
        continue;
      end if;
    else
      if p_strict then
        raise exception 'Enter a valid % URL or @username.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_host := lower(coalesce(substring(v_url from '^https://([^/?#]+)'), ''));
    if v_host = '' or position('@' in v_host) > 0 or position(':' in v_host) > 0 then
      if p_strict then
        raise exception 'Enter a valid % link.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_path := coalesce(substring(v_url from '^https://[^/?#]+(.*)$'), '');
    if char_length(btrim(regexp_replace(v_path, '[#?].*$', ''), '/')) = 0 then
      if p_strict then
        raise exception 'Include your % profile path after the domain.', initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_allowed := case v_key
      when 'telegram' then v_host in ('t.me', 'www.t.me', 'telegram.me', 'www.telegram.me', 'telegram.dog')
      when 'instagram' then v_host in ('instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am')
      when 'facebook' then v_host in ('facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.me', 'm.me')
      when 'threads' then v_host in ('threads.net', 'www.threads.net', 'threads.com', 'www.threads.com')
      when 'discord' then v_host in ('discord.com', 'www.discord.com', 'discord.gg', 'www.discord.gg', 'discordapp.com', 'www.discordapp.com')
      else false
    end;

    if not v_allowed then
      if p_strict then
        raise exception '% link must use an official % domain.', initcap(v_key), initcap(v_key) using errcode = '22023';
      end if;
      continue;
    end if;

    v_url := 'https://' || v_host || v_path;
    v_out := v_out || jsonb_build_object(v_key, v_url);
  end loop;

  return v_out;
end;
$$;

create or replace function public.update_own_social_links(
  p_links jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clean jsonb;
  v_saved jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  v_clean := public.sanitize_social_app_links(p_links, true);

  update public.profiles
  set social_links = v_clean
  where id = v_uid
    and status = 'ACTIVE'
  returning social_links into v_saved;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'social_links', coalesce(v_saved, '{}'::jsonb)
  );
end;
$$;

create or replace function public.get_profile_card_appearance(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_effect text := 'none';
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

  if v_is_self then
    select count(*)::integer into v_my_friends_count
    from public.friendships f
    where f.user_a = v_uid or f.user_b = v_uid;

    return jsonb_build_object(
      'id', v_target.id,
      'is_self', true,
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

  return jsonb_build_object(
    'id', v_target.id,
    'is_self', false,
    'full_name', v_target.full_name,
    'username', v_target.username,
    'verified_badge', v_badge_tier,
    'verified_badge_granted_at', case when v_badge_tier = 'NONE' then null else coalesce(v_target.verified_badge_granted_at, v_target.created_at) end,
    'bio', case when v_blocked_me then null else v_target.bio end,
    'social_links', case when v_blocked_me then '{}'::jsonb else public.sanitize_social_app_links(v_target.social_links, false) end,
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
            'full_name', peer.full_name,
            'username', peer.username,
            'avatar_url', peer.avatar_url,
            'social_links', case
              when peer.id = v_uid or not public.is_user_blocked_between(v_uid, peer.id) then public.sanitize_social_app_links(peer.social_links, false)
              else '{}'::jsonb
            end,
            'is_friend', (peer.id <> v_uid and public.are_friends(v_uid, peer.id)),
            'is_blocked', (peer.id <> v_uid and public.is_user_blocked_between(v_uid, peer.id)),
            'blocked_by_me', (peer.id <> v_uid and exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id)),
            'allow_online_status', (peer.id = v_uid or (not public.is_user_blocked_between(v_uid, peer.id) and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true))),
            'last_seen_at', case
              when peer.id <> v_uid
                   and not public.is_user_blocked_between(v_uid, peer.id)
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

revoke all on function public.sanitize_social_app_links(jsonb, boolean) from public, anon;
grant execute on function public.sanitize_social_app_links(jsonb, boolean) to authenticated;

revoke all on function public.update_own_social_links(jsonb) from public, anon;
grant execute on function public.update_own_social_links(jsonb) to authenticated;

revoke execute on function public.get_profile_card_appearance(uuid) from public, anon;
grant execute on function public.get_profile_card_appearance(uuid) to authenticated;

revoke execute on function public.get_social_user_profile(uuid) from public, anon;
grant execute on function public.get_social_user_profile(uuid) to authenticated;

revoke execute on function public.get_conversations() from public, anon;
grant execute on function public.get_conversations() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_122', 'social_app_links')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
