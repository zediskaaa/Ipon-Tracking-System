begin;

create or replace function public.is_valid_profile_effect_id(p_effect_id text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_effect_id, ''))) in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil',
    'laurel', 'scholar', 'circuit', 'neural', 'blueprint', 'atelier', 'vetpulse', 'sanctuary'
  );
$$;

revoke all on function public.is_valid_profile_effect_id(text) from public, anon;
grant execute on function public.is_valid_profile_effect_id(text) to authenticated;

alter table public.profiles drop constraint if exists profiles_equipped_profile_effect_check;
alter table public.profiles add constraint profiles_equipped_profile_effect_check
  check (equipped_profile_effect in (
    'none', 'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil',
    'laurel', 'scholar', 'circuit', 'neural', 'blueprint', 'atelier', 'vetpulse', 'sanctuary'
  ));

alter table public.profile_effect_grants drop constraint if exists profile_effect_grants_effect_check;
alter table public.profile_effect_grants add constraint profile_effect_grants_effect_check
  check (effect_id in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil',
    'laurel', 'scholar', 'circuit', 'neural', 'blueprint', 'atelier', 'vetpulse', 'sanctuary'
  ));

alter table public.profile_effect_trial_requests drop constraint if exists profile_effect_trial_requests_effect_check;
alter table public.profile_effect_trial_requests add constraint profile_effect_trial_requests_effect_check
  check (effect_id in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil',
    'laurel', 'scholar', 'circuit', 'neural', 'blueprint', 'atelier', 'vetpulse', 'sanctuary'
  ));

create or replace function public.profile_effect_label(p_effect_id text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_effect_id, '')))
    when 'stardust' then 'Stardust'
    when 'orbit' then 'Orbit'
    when 'butterflies' then 'Neon Butterflies'
    when 'koi' then 'Aurora Koi'
    when 'robots' then 'Mini Bots'
    when 'drones' then 'Patrol Drones'
    when 'holo' then 'Holo Rings'
    when 'glitch' then 'Glitch Stream'
    when 'fireflies' then 'Firefly Grove'
    when 'petals' then 'Sakura Drift'
    when 'singularity' then 'Singularity'
    when 'warp' then 'Hyperdrive'
    when 'jelly' then 'Lumen Jelly'
    when 'astro' then 'Drift Astronaut'
    when 'constellation' then 'Lyra Chart'
    when 'sigil' then 'Arcane Sigil'
    when 'laurel' then 'Golden Laurel'
    when 'scholar' then 'Scholar''s Folio'
    when 'circuit' then 'Silicon Hex'
    when 'neural' then 'Quantum Prism'
    when 'blueprint' then 'Arch Blueprint'
    when 'atelier' then 'Gilded Dome'
    when 'vetpulse' then 'Vital Paw'
    when 'sanctuary' then 'Sanctuary Caduceus'
    else 'Profile Effect'
  end;
$$;

create or replace function public.get_own_profile_effects()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_email text;
  v_grants jsonb;
  v_requests jsonb;
  v_used_effects text[];
  v_active_trial jsonb;
  v_pending_req jsonb;
  v_last_trial_end timestamptz;
  v_cooldown_until timestamptz := null;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  perform public.cleanup_expired_profile_effect_trials(v_uid);

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(v_profile.email, ''), u.email, '')
  into v_email
  from auth.users u
  where u.id = v_uid;

  if public.is_creator_owner_account(v_email) then
    insert into public.profile_effect_grants (
      user_id, effect_id, is_permanent, expires_at, granted_by, granted_at, grant_message, acknowledged_at
    )
    select
      v_uid,
      eid,
      true,
      null,
      v_uid,
      now(),
      'Unlocked permanently for the myIPON creator account.',
      now()
    from unnest(array[
      'stardust', 'orbit', 'butterflies', 'koi',
      'robots', 'drones', 'holo', 'glitch',
      'fireflies', 'petals', 'singularity', 'warp',
      'jelly', 'astro', 'constellation', 'sigil',
      'laurel', 'scholar', 'circuit', 'neural',
      'blueprint', 'atelier', 'vetpulse', 'sanctuary'
    ]) as eid
    on conflict (user_id, effect_id) do update
    set is_permanent = true,
        expires_at = null,
        acknowledged_at = coalesce(public.profile_effect_grants.acknowledged_at, now());
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'effect_id', g.effect_id,
        'is_permanent', coalesce(g.is_permanent, true),
        'expires_at', g.expires_at,
        'granted_at', g.granted_at,
        'grant_message', g.grant_message,
        'acknowledged_at', g.acknowledged_at
      )
      order by g.granted_at desc, g.effect_id asc
    ),
    '[]'::jsonb
  )
  into v_grants
  from public.profile_effect_grants g
  where g.user_id = v_uid
    and (g.is_permanent = true or g.expires_at is null or g.expires_at > now());

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'effect_id', r.effect_id,
        'request_note', r.request_note,
        'status', r.status,
        'review_note', r.review_note,
        'trial_expires_at', r.trial_expires_at,
        'created_at', r.created_at,
        'reviewed_at', r.reviewed_at
      )
      order by r.created_at desc
    ),
    '[]'::jsonb
  )
  into v_requests
  from public.profile_effect_trial_requests r
  where r.user_id = v_uid;

  select coalesce(array_agg(distinct r.effect_id order by r.effect_id), '{}'::text[])
  into v_used_effects
  from public.profile_effect_trial_requests r
  where r.user_id = v_uid
    and r.status = 'APPROVED';

  select jsonb_build_object(
    'effect_id', g.effect_id,
    'expires_at', g.expires_at
  )
  into v_active_trial
  from public.profile_effect_grants g
  where g.user_id = v_uid
    and g.is_permanent = false
    and g.expires_at is not null
    and g.expires_at > now()
  order by g.expires_at desc
  limit 1;

  select jsonb_build_object(
    'id', r.id,
    'effect_id', r.effect_id,
    'request_note', r.request_note,
    'created_at', r.created_at
  )
  into v_pending_req
  from public.profile_effect_trial_requests r
  where r.user_id = v_uid
    and r.status = 'PENDING'
  order by r.created_at desc
  limit 1;

  select max(coalesce(r.trial_expires_at, r.reviewed_at, r.created_at))
  into v_last_trial_end
  from public.profile_effect_trial_requests r
  where r.user_id = v_uid
    and r.status = 'APPROVED';

  if v_last_trial_end is not null and (v_last_trial_end + interval '1 month') > now() then
    v_cooldown_until := v_last_trial_end + interval '1 month';
  end if;

  return jsonb_build_object(
    'equipped_effect', coalesce(v_profile.equipped_profile_effect, 'none'),
    'grants', v_grants,
    'trial_requests', v_requests,
    'trial_state', jsonb_build_object(
      'used_effects', to_jsonb(coalesce(v_used_effects, '{}'::text[])),
      'active_trial', v_active_trial,
      'pending_request', v_pending_req,
      'cooldown_until', v_cooldown_until
    )
  );
end;
$$;

create or replace function public.equip_own_profile_effect(p_effect_id text)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_email text;
  v_effect text := lower(btrim(coalesce(p_effect_id, '')));
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  perform public.cleanup_expired_profile_effect_trials(v_uid);

  if v_effect = '' then
    v_effect := 'none';
  end if;

  if v_effect <> 'none' and not public.is_valid_profile_effect_id(v_effect) then
    raise exception 'Invalid profile effect.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(v_profile.email, ''), u.email, '')
  into v_email
  from auth.users u
  where u.id = v_uid;

  if v_effect <> 'none' and v_profile.role <> 'SUPER_ADMIN' and not public.is_creator_owner_account(v_email) then
    if not exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = v_uid
        and g.effect_id = v_effect
        and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
    ) then
      raise exception 'This profile effect is not currently active or unlocked on your account.' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set equipped_profile_effect = v_effect
  where id = v_uid
    and status = 'ACTIVE';

  return public.get_own_profile_effects();
end;
$$;

create or replace function public.acknowledge_my_profile_effects(
  p_effect_ids text[] default null,
  p_equip_effect_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_email text;
  v_equip text := nullif(lower(btrim(coalesce(p_equip_effect_id, ''))), '');
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  perform public.cleanup_expired_profile_effect_trials(v_uid);

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(v_profile.email, ''), u.email, '')
  into v_email
  from auth.users u
  where u.id = v_uid;

  update public.profile_effect_grants
  set acknowledged_at = coalesce(acknowledged_at, now())
  where user_id = v_uid
    and acknowledged_at is null
    and (is_permanent = true or expires_at is null or expires_at > now())
    and (p_effect_ids is null or effect_id = any(p_effect_ids));

  if v_equip is not null then
    if v_equip = 'none' then
      update public.profiles
      set equipped_profile_effect = 'none'
      where id = v_uid and status = 'ACTIVE';
    elsif public.is_valid_profile_effect_id(v_equip) and (
      v_profile.role = 'SUPER_ADMIN'
      or public.is_creator_owner_account(v_email)
      or exists (
        select 1
        from public.profile_effect_grants g
        where g.user_id = v_uid
          and g.effect_id = v_equip
          and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
      )
    ) then
      update public.profiles
      set equipped_profile_effect = v_equip
      where id = v_uid and status = 'ACTIVE';
    end if;
  end if;

  return public.get_own_profile_effects();
end;
$$;

create or replace function public.submit_profile_effect_trial_request(
  p_effect_id text,
  p_note text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_effect text := lower(btrim(coalesce(p_effect_id, '')));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
  v_active record;
  v_pending record;
  v_last_trial_end timestamptz;
  v_cooldown_until timestamptz;
  v_req public.profile_effect_trial_requests%rowtype;
  v_effect_name text;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  perform public.cleanup_expired_profile_effect_trials(v_uid);

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Only active accounts can request a trial effect.' using errcode = '42501';
  end if;

  if v_profile.role = 'SUPER_ADMIN' then
    raise exception 'Super Admins already have access to all profile effects.' using errcode = '22023';
  end if;

  if not public.is_valid_profile_effect_id(v_effect) then
    raise exception 'Choose a valid profile effect.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profile_effect_grants g
    where g.user_id = v_uid
      and g.effect_id = v_effect
      and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
  ) then
    raise exception 'You already own or have this profile effect active.' using errcode = '22023';
  end if;

  select id, effect_id into v_pending
  from public.profile_effect_trial_requests
  where user_id = v_uid and status = 'PENDING'
  limit 1;
  if found then
    raise exception 'You already have a pending trial request (%). Wait for Super Admin review or cancel it first.', public.profile_effect_label(v_pending.effect_id) using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.profile_effect_trial_requests r
    where r.user_id = v_uid and r.effect_id = v_effect and r.status = 'APPROVED'
  ) then
    raise exception 'You already used your 1-time trial for %.', public.profile_effect_label(v_effect) using errcode = '22023';
  end if;

  select effect_id, expires_at into v_active
  from public.profile_effect_grants
  where user_id = v_uid
    and is_permanent = false
    and expires_at is not null
    and expires_at > now()
  order by expires_at desc
  limit 1;
  if found then
    raise exception 'You already have an active trial (% until %). You cannot request a new trial yet.',
      public.profile_effect_label(v_active.effect_id),
      to_char(v_active.expires_at at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM')
      using errcode = '22023';
  end if;

  select max(coalesce(r.trial_expires_at, r.reviewed_at, r.created_at))
  into v_last_trial_end
  from public.profile_effect_trial_requests r
  where r.user_id = v_uid and r.status = 'APPROVED';

  if v_last_trial_end is not null then
    v_cooldown_until := v_last_trial_end + interval '1 month';
    if v_cooldown_until > now() then
      raise exception 'Your 1-month trial cooldown is active until %.',
        to_char(v_cooldown_until at time zone 'Asia/Manila', 'Mon DD, YYYY')
        using errcode = '22023';
    end if;
  end if;

  insert into public.profile_effect_trial_requests (user_id, effect_id, request_note)
  values (v_uid, v_effect, v_note)
  returning * into v_req;

  v_effect_name := public.profile_effect_label(v_effect);
  insert into public.notifications (
    recipient_id,
    group_id,
    type,
    title,
    message,
    link,
    dedupe_key
  )
  select
    sa.id,
    null,
    'EFFECT_TRIAL_REQUESTED',
    'New profile effect trial request',
    left(v_profile.full_name || ' requested a trial for "' || v_effect_name || '".', 500),
    'super-admin.html#effects',
    'EFFECT_TRIAL_REQUESTED:' || v_req.id::text || ':' || sa.id::text
  from public.profiles sa
  where sa.role = 'SUPER_ADMIN'
    and sa.status = 'ACTIVE';

  return public.get_own_profile_effects();
end;
$$;

create or replace function public.super_admin_grant_profile_effects(
  p_user_id uuid,
  p_effect_ids text[],
  p_creator_message text default '',
  p_duration_days integer default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_clean_ids text[] := '{}'::text[];
  v_new_ids text[] := '{}'::text[];
  v_effect_id text;
  v_message text := nullif(left(btrim(coalesce(p_creator_message, '')), 400), '');
  v_is_permanent boolean := true;
  v_expires_at timestamptz := null;
  v_names_label text;
  v_notif_message text;
  v_notif_title text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can grant profile effects.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Target user is required.' using errcode = '22023';
  end if;

  select * into v_target
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_target.status <> 'ACTIVE' then
    raise exception 'Only active user accounts can receive profile effects.' using errcode = '22023';
  end if;

  if p_duration_days is not null and p_expires_at is not null then
    raise exception 'Choose either a trial duration preset or a custom expiration date.' using errcode = '22023';
  end if;

  if p_duration_days is not null then
    if p_duration_days < 1 or p_duration_days > 90 then
      raise exception 'Trial duration must be between 1 and 90 days.' using errcode = '22023';
    end if;
    v_is_permanent := false;
    v_expires_at := now() + make_interval(days => p_duration_days);
  elsif p_expires_at is not null then
    if p_expires_at <= now() + interval '5 minutes' then
      raise exception 'Custom trial expiration must be at least 5 minutes in the future.' using errcode = '22023';
    end if;
    v_is_permanent := false;
    v_expires_at := p_expires_at;
  end if;

  perform public.cleanup_expired_profile_effect_trials(p_user_id);

  select array_agg(distinct lower(btrim(x)))
  into v_clean_ids
  from unnest(coalesce(p_effect_ids, '{}'::text[])) as x
  where nullif(btrim(x), '') is not null;

  if v_clean_ids is null or array_length(v_clean_ids, 1) is null then
    raise exception 'Select at least one profile effect to award.' using errcode = '22023';
  end if;

  foreach v_effect_id in array v_clean_ids loop
    if not public.is_valid_profile_effect_id(v_effect_id) then
      raise exception 'Invalid profile effect selection: %', v_effect_id using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = p_user_id
        and g.effect_id = v_effect_id
        and g.is_permanent = true
    ) then
      update public.profile_effect_grants
      set grant_message = coalesce(v_message, grant_message)
      where user_id = p_user_id
        and effect_id = v_effect_id
        and acknowledged_at is null;
      continue;
    end if;

    insert into public.profile_effect_grants (
      user_id, effect_id, is_permanent, expires_at, granted_by, granted_at, grant_message, acknowledged_at
    ) values (
      p_user_id, v_effect_id, v_is_permanent, v_expires_at, v_admin_id, now(), v_message, null
    )
    on conflict (user_id, effect_id) do update
    set is_permanent = case when profile_effect_grants.is_permanent then true else v_is_permanent end,
        expires_at = case when profile_effect_grants.is_permanent then null else v_expires_at end,
        granted_by = v_admin_id,
        granted_at = now(),
        grant_message = coalesce(v_message, profile_effect_grants.grant_message),
        acknowledged_at = null;

    v_new_ids := array_append(v_new_ids, v_effect_id);

    if exists (
      select 1
      from public.profile_effect_trial_requests r
      where r.user_id = p_user_id
        and r.effect_id = v_effect_id
        and r.status = 'PENDING'
    ) then
      if not v_is_permanent and not exists (
        select 1
        from public.profile_effect_trial_requests r2
        where r2.user_id = p_user_id
          and r2.effect_id = v_effect_id
          and r2.status = 'APPROVED'
      ) then
        update public.profile_effect_trial_requests
        set status = 'APPROVED',
            reviewed_by = v_admin_id,
            reviewed_at = now(),
            review_note = v_message,
            trial_expires_at = v_expires_at
        where user_id = p_user_id
          and effect_id = v_effect_id
          and status = 'PENDING';
      else
        update public.profile_effect_trial_requests
        set status = 'CANCELLED',
            reviewed_by = v_admin_id,
            reviewed_at = now(),
            review_note = coalesce(v_message, 'Awarded directly by Super Admin')
        where user_id = p_user_id
          and effect_id = v_effect_id
          and status = 'PENDING';
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_new_ids, 1), 0) = 0 then
    raise exception 'All selected profile effects are already permanently owned by this user.' using errcode = '22023';
  end if;

  select string_agg(public.profile_effect_label(eid), ', ')
  into v_names_label
  from unnest(v_new_ids) as eid;

  if v_is_permanent then
    v_notif_title := case when array_length(v_new_ids, 1) > 1
      then 'Congratulations! Profile effects unlocked'
      else 'Congratulations! Profile effect unlocked'
    end;
    v_notif_message := case
      when v_message is not null then
        'Congratulations! You unlocked the permanent profile effect'
        || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
        || v_names_label || '. Message from creator: "' || v_message || '"'
      else
        'Congratulations! The creator awarded you the permanent profile effect'
        || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
        || v_names_label || '.'
    end;
  else
    v_notif_title := case when array_length(v_new_ids, 1) > 1
      then 'Congratulations! Trial profile effects unlocked'
      else 'Congratulations! Trial profile effect unlocked'
    end;
    v_notif_message := 'Congratulations! The creator awarded you a trial profile effect'
      || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
      || v_names_label || ' (active until '
      || to_char(v_expires_at at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM')
      || ').'
      || case when v_message is not null then ' Message from creator: "' || v_message || '"' else '' end;
  end if;

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
    'EFFECT_GRANTED',
    v_notif_title,
    left(v_notif_message, 500),
    null,
    'EFFECT_GRANTED:' || p_user_id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'granted_effects', to_jsonb(v_new_ids),
    'is_permanent', v_is_permanent,
    'expires_at', v_expires_at,
    'message', v_message
  );
end;
$$;

revoke all on function public.profile_effect_label(text) from public, anon;
revoke all on function public.get_own_profile_effects() from public, anon;
revoke all on function public.equip_own_profile_effect(text) from public, anon;
revoke all on function public.acknowledge_my_profile_effects(text[], text) from public, anon;
revoke all on function public.submit_profile_effect_trial_request(text, text) from public, anon;
revoke all on function public.super_admin_grant_profile_effects(uuid, text[], text, integer, timestamptz) from public, anon;

grant execute on function public.profile_effect_label(text) to authenticated;
grant execute on function public.get_own_profile_effects() to authenticated;
grant execute on function public.equip_own_profile_effect(text) to authenticated;
grant execute on function public.acknowledge_my_profile_effects(text[], text) to authenticated;
grant execute on function public.submit_profile_effect_trial_request(text, text) to authenticated;
grant execute on function public.super_admin_grant_profile_effects(uuid, text[], text, integer, timestamptz) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_159', 'add themed education, information technology, architecture, and veterinary medicine profile effects')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
