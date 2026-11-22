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
    'divine_meridian', 'divine_boreal', 'divine_opal'
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
    else 'Profile Effect'
  end;
$$;

-- Keep Divine out of the request queue even on writes outside the submission RPC.
alter table public.profile_effect_trial_requests
  drop constraint if exists profile_effect_trial_requests_no_divine;
alter table public.profile_effect_trial_requests
  add constraint profile_effect_trial_requests_no_divine
  check (left(lower(btrim(effect_id)), 7) <> 'divine_');

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

  if v_effect like 'ex\_%' escape '\' then
    raise exception 'Exclusive profile effects are not eligible for trial requests.' using errcode = '22023';
  end if;

  if left(v_effect, 7) = 'divine_' then
    raise exception 'Divine profile effects are not eligible for trial requests.' using errcode = '22023';
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

revoke all on function public.submit_profile_effect_trial_request(text, text) from public, anon;
grant execute on function public.submit_profile_effect_trial_request(text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_175', 'add Divine profile effects without trial requests')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
