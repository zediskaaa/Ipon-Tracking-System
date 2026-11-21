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
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune', 'ex_early_user'
  );
$$;

alter table public.profiles drop constraint if exists profiles_equipped_profile_effect_check;
alter table public.profiles add constraint profiles_equipped_profile_effect_check
  check (equipped_profile_effect = 'none' or public.is_valid_profile_effect_id(equipped_profile_effect));

alter table public.profile_effect_grants drop constraint if exists profile_effect_grants_effect_check;
alter table public.profile_effect_grants add constraint profile_effect_grants_effect_check
  check (public.is_valid_profile_effect_id(effect_id));

-- Founding recognition is permanent and cannot be requested as a temporary trial.
alter table public.profile_effect_grants add constraint profile_effect_grants_early_user_permanent_check
  check (effect_id <> 'ex_early_user' or is_permanent = true);

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
    else 'Profile Effect'
  end;
$$;

revoke all on function public.is_valid_profile_effect_id(text) from public, anon;
revoke all on function public.profile_effect_label(text) from public, anon;
grant execute on function public.is_valid_profile_effect_id(text) to authenticated;
grant execute on function public.profile_effect_label(text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_162', 'add permanent early user profile effect')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
