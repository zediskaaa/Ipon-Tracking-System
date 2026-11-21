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
    'laurel', 'scholar', 'orrery', 'diploma',
    'circuit', 'neural', 'cybergrid', 'fibercloud',
    'blueprint', 'atelier', 'stainedglass', 'cantilever',
    'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
    'iponcoins', 'iponsprout', 'iponvault',
    'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
    'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune'
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
    'laurel', 'scholar', 'orrery', 'diploma',
    'circuit', 'neural', 'cybergrid', 'fibercloud',
    'blueprint', 'atelier', 'stainedglass', 'cantilever',
    'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
    'iponcoins', 'iponsprout', 'iponvault',
    'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
    'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune'
  ));

alter table public.profile_effect_grants drop constraint if exists profile_effect_grants_effect_check;
alter table public.profile_effect_grants add constraint profile_effect_grants_effect_check
  check (effect_id in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil',
    'laurel', 'scholar', 'orrery', 'diploma',
    'circuit', 'neural', 'cybergrid', 'fibercloud',
    'blueprint', 'atelier', 'stainedglass', 'cantilever',
    'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
    'iponcoins', 'iponsprout', 'iponvault',
    'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
    'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune'
  ));

alter table public.profile_effect_trial_requests drop constraint if exists profile_effect_trial_requests_effect_check;
alter table public.profile_effect_trial_requests add constraint profile_effect_trial_requests_effect_check
  check (effect_id in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil',
    'laurel', 'scholar', 'orrery', 'diploma',
    'circuit', 'neural', 'cybergrid', 'fibercloud',
    'blueprint', 'atelier', 'stainedglass', 'cantilever',
    'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
    'iponcoins', 'iponsprout', 'iponvault',
    'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
    'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune'
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
      'laurel', 'scholar', 'orrery', 'diploma',
      'circuit', 'neural', 'cybergrid', 'fibercloud',
      'blueprint', 'atelier', 'stainedglass', 'cantilever',
      'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
      'iponcoins', 'iponsprout', 'iponvault',
      'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
      'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
      'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune'
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

revoke all on function public.profile_effect_label(text) from public, anon;
revoke all on function public.get_own_profile_effects() from public, anon;
grant execute on function public.profile_effect_label(text) to authenticated;
grant execute on function public.get_own_profile_effects() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_161', 'add 14 exclusive 4-scene cinematic looping profile effects')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
