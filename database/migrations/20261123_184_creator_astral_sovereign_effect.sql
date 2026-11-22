-- ============================================================
-- Migration 20261123_184: Creator-Exclusive Sci-Fi Profile Effect
-- ============================================================
-- Registers 'creator_astral_sovereign' ("Astral Sovereign") and locks
-- ALL creator_* effects strictly and exclusively to the application
-- creator account (breadspanish231@gmail.com) across grants, trials,
-- equipping, acknowledgements, and profile appearance reads.
-- Grants and equips 'creator_astral_sovereign' permanently on
-- breadspanish231@gmail.com.

begin;

create or replace function public.is_valid_profile_effect_id(p_effect_id text)
returns boolean language sql immutable as $$
  select lower(btrim(coalesce(p_effect_id, ''))) in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil', 'laurel', 'scholar', 'orrery', 'diploma',
    'circuit', 'neural', 'cybergrid', 'fibercloud',
    'blueprint', 'atelier', 'stainedglass', 'cantilever',
    'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
    'iponcoins', 'iponsprout', 'iponvault',
    'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
    'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune', 'ex_early_user',
    'divine_meridian', 'divine_boreal', 'divine_opal', 'divine_imperial', 'divine_hellebore',
    'deluxe_aureate', 'deluxe_parure', 'deluxe_nocturne',
    'deluxe_nacre', 'deluxe_malachite', 'deluxe_argent', 'deluxe_calibre',
    'creator_astral_sovereign'
  );
$$;

create or replace function public.profile_effect_label(p_effect_id text)
returns text language sql immutable as $$
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
    when 'orrery' then 'Celestial Academy'
    when 'diploma' then 'Honor Seal'
    when 'circuit' then 'Silicon Hex'
    when 'neural' then 'Quantum Prism'
    when 'cybergrid' then 'Syntax Matrix'
    when 'fibercloud' then 'Optic Lattice'
    when 'blueprint' then 'Arch Blueprint'
    when 'atelier' then 'Gilded Dome'
    when 'stainedglass' then 'Cathedral Rose'
    when 'cantilever' then 'Zenith Wireframe'
    when 'vetpulse' then 'Vital Paw'
    when 'sanctuary' then 'Sanctuary Caduceus'
    when 'biolumfauna' then 'Moonlit Whiskers'
    when 'botanicvet' then 'Healing Terrarium'
    when 'iponcoins' then 'Peso Cascade'
    when 'iponsprout' then 'Emerald Harvest'
    when 'iponvault' then 'Sovereign Vault'
    when 'ex_phoenix' then 'Solar Phoenix'
    when 'ex_dragon' then 'Imperial Jade Dragon'
    when 'ex_eclipse' then 'Sovereign Eclipse'
    when 'ex_tempest' then 'Volt Overlord'
    when 'ex_blossom' then 'Crimson Tempest'
    when 'ex_frost' then 'Crystalline Shatter'
    when 'ex_sovereign' then 'myIPON Sovereign'
    when 'ex_cybermech' then 'Mecha Override'
    when 'ex_prism' then 'Chromatic Supernova'
    when 'ex_abyss' then 'Phantom Monarch'
    when 'ex_valkyrie' then 'Aether Valkyrie'
    when 'ex_leviathan' then 'Abyssal Leviathan'
    when 'ex_chronos' then 'Chronos Astral'
    when 'ex_kitsune' then 'Nine-Tail Mirage'
    when 'ex_early_user' then 'Founders'' Grove'
    when 'divine_meridian' then 'Meridian Observatory'
    when 'divine_boreal' then 'Boreal Veil'
    when 'divine_opal' then 'Opal Sanctum'
    when 'divine_imperial' then 'Imperial Reliquary'
    when 'divine_hellebore' then 'Gilded Hellebore'
    when 'deluxe_aureate' then 'Aureate Mobile'
    when 'deluxe_parure' then 'Diamond Parure'
    when 'deluxe_nocturne' then 'Midnight Nocturne'
    when 'deluxe_nacre' then 'Atelier Nacre'
    when 'deluxe_malachite' then 'Malachite Cabinet'
    when 'deluxe_argent' then 'Argent Helix'
    when 'deluxe_calibre' then 'Rose Calibre'
    when 'creator_astral_sovereign' then 'Astral Sovereign'
    else 'Profile Effect'
  end;
$$;

-- Prevent any trial requests for creator_* effects at the table level
alter table public.profile_effect_trial_requests
  drop constraint if exists profile_effect_trial_requests_no_creator;
alter table public.profile_effect_trial_requests
  add constraint profile_effect_trial_requests_no_creator
  check (left(lower(btrim(effect_id)), 8) <> 'creator_');

-- Hard table-level triggers guaranteeing ONLY breadspanish231@gmail.com can ever hold or equip creator_* effects
create or replace function public.enforce_creator_only_profile_effect_grant()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  if left(lower(btrim(coalesce(new.effect_id, ''))), 8) = 'creator_' then
    select coalesce(nullif(p.email, ''), u.email, '')
    into v_email
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.id = new.user_id;

    if not public.is_creator_owner_account(v_email) then
      raise exception 'Creator-exclusive profile effects are reserved solely for the application creator account.' using errcode = '42501';
    end if;
    if coalesce(new.is_permanent, true) = false or new.expires_at is not null then
      raise exception 'Creator-exclusive profile effects are permanent only.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_effect_grants_creator_only on public.profile_effect_grants;
create trigger profile_effect_grants_creator_only
  before insert or update of user_id, effect_id, is_permanent, expires_at
  on public.profile_effect_grants
  for each row execute function public.enforce_creator_only_profile_effect_grant();

create or replace function public.enforce_creator_only_equipped_profile_effect()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text;
begin
  if left(lower(btrim(coalesce(new.equipped_profile_effect, ''))), 8) = 'creator_' then
    select coalesce(nullif(new.email, ''), u.email, '')
    into v_email
    from auth.users u
    where u.id = new.id;

    if v_email is null or btrim(v_email) = '' then
      v_email := coalesce(new.email, '');
    end if;

    if not public.is_creator_owner_account(v_email) then
      raise exception 'This creator-exclusive profile effect is reserved solely for the application creator.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_creator_only_equipped_effect on public.profiles;
create trigger profiles_creator_only_equipped_effect
  before insert or update of equipped_profile_effect
  on public.profiles
  for each row execute function public.enforce_creator_only_equipped_profile_effect();

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
  v_is_creator boolean := false;
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

  v_is_creator := public.is_creator_owner_account(v_email);

  if v_is_creator then
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
      case when eid = 'creator_astral_sovereign'
        then 'Exclusive creator signature effect reserved solely for the myIPON founder.'
        else 'Unlocked permanently for the myIPON creator account.'
      end,
      now()
    from unnest(array[
      'stardust', 'orbit', 'butterflies', 'koi',
      'robots', 'drones', 'holo', 'glitch',
      'fireflies', 'petals', 'singularity', 'warp',
      'jelly', 'astro', 'constellation', 'sigil',
      'laurel', 'scholar', 'orrery', 'diploma',
      'circuit', 'neural', 'cybergrid', 'fibercloud',
      'blueprint', 'atelier', 'stainedglass', 'cantilever',
      'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
      'iponcoins', 'iponsprout', 'iponvault',
      'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
      'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
      'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune',
      'divine_meridian', 'divine_boreal', 'divine_opal', 'divine_imperial', 'divine_hellebore',
      'deluxe_aureate', 'deluxe_parure', 'deluxe_nocturne',
      'deluxe_nacre', 'deluxe_malachite', 'deluxe_argent', 'deluxe_calibre',
      'creator_astral_sovereign'
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
    and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
    and (v_is_creator or left(lower(btrim(g.effect_id)), 8) <> 'creator_');

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
    'equipped_effect', case
      when not v_is_creator and left(lower(btrim(coalesce(v_profile.equipped_profile_effect, ''))), 8) = 'creator_' then 'none'
      else coalesce(v_profile.equipped_profile_effect, 'none')
    end,
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

  if left(v_effect, 8) = 'creator_' and not public.is_creator_owner_account(v_email) then
    raise exception 'This creator-exclusive profile effect is reserved solely for the application creator.' using errcode = '42501';
  end if;

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
    elsif public.is_valid_profile_effect_id(v_equip)
      and (left(v_equip, 8) <> 'creator_' or public.is_creator_owner_account(v_email))
      and (
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

  if left(v_effect, 8) = 'creator_' then
    raise exception 'Creator-exclusive profile effects are not eligible for trial requests.' using errcode = '22023';
  end if;

  if v_effect like 'ex\_%' escape '\' then
    raise exception 'Exclusive profile effects are not eligible for trial requests.' using errcode = '22023';
  end if;

  if left(v_effect, 7) = 'divine_' then
    raise exception 'Divine profile effects are not eligible for trial requests.' using errcode = '22023';
  end if;

  if left(v_effect, 7) = 'deluxe_' then
    raise exception 'Deluxe profile effects are not eligible for trial requests.' using errcode = '22023';
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
set search_path = public, auth
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_target_email text;
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

  select coalesce(nullif(v_target.email, ''), u.email, '')
  into v_target_email
  from auth.users u
  where u.id = v_target.id;

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

    if left(v_effect_id, 8) = 'creator_' then
      if not public.is_creator_owner_account(v_target_email) then
        raise exception 'Creator-exclusive profile effects can only be assigned to the application creator account.' using errcode = '42501';
      end if;
      if not v_is_permanent then
        raise exception 'Creator-exclusive profile effects are permanent only.' using errcode = '22023';
      end if;
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

create or replace function public.get_profile_card_appearance(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_profile public.profiles%rowtype;
  v_email text;
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

  select coalesce(nullif(v_profile.email, ''), u.email, '')
  into v_email
  from auth.users u
  where u.id = v_profile.id;

  v_effect := coalesce(v_profile.equipped_profile_effect, 'none');
  if left(lower(btrim(v_effect)), 8) = 'creator_' and not public.is_creator_owner_account(v_email) then
    v_effect := 'none';
  elsif v_effect <> 'none' and v_profile.role <> 'SUPER_ADMIN' and not public.is_creator_owner_account(v_email) then
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

-- Purge any accidental creator_* assignments on non-creator accounts
delete from public.profile_effect_grants g
using public.profiles p
left join auth.users u on u.id = p.id
where g.user_id = p.id
  and left(lower(btrim(g.effect_id)), 8) = 'creator_'
  and not public.is_creator_owner_account(coalesce(nullif(p.email, ''), u.email));

update public.profiles p
set equipped_profile_effect = 'none'
where left(lower(btrim(coalesce(p.equipped_profile_effect, ''))), 8) = 'creator_'
  and not exists (
    select 1 from auth.users u
    where u.id = p.id
      and public.is_creator_owner_account(coalesce(nullif(p.email, ''), u.email))
  );

-- Permanently unlock and equip Astral Sovereign exclusively on breadspanish231@gmail.com
do $$
declare
  v_creator_id uuid;
begin
  select p.id into v_creator_id
  from public.profiles p
  left join auth.users u on u.id = p.id
  where public.is_creator_owner_account(coalesce(nullif(p.email, ''), u.email))
    and p.status = 'ACTIVE'
  limit 1;

  if v_creator_id is not null then
    insert into public.profile_effect_grants (
      user_id, effect_id, is_permanent, expires_at, granted_by, granted_at, grant_message, acknowledged_at
    ) values (
      v_creator_id,
      'creator_astral_sovereign',
      true,
      null,
      v_creator_id,
      now(),
      'Exclusive creator signature effect reserved solely for the myIPON founder.',
      now()
    )
    on conflict (user_id, effect_id) do update
    set is_permanent = true,
        expires_at = null,
        acknowledged_at = coalesce(public.profile_effect_grants.acknowledged_at, now());

    update public.profiles
    set equipped_profile_effect = 'creator_astral_sovereign'
    where id = v_creator_id;
  end if;
end $$;

insert into public.schema_migrations (version, name)
values ('20261123_184', 'add creator-exclusive Astral Sovereign sci-fi profile effect restricted strictly to breadspanish231@gmail.com')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
