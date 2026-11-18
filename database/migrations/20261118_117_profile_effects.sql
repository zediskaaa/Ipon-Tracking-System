begin;

alter table public.profiles
  add column if not exists equipped_profile_effect text not null default 'none';

alter table public.profiles drop constraint if exists profiles_equipped_profile_effect_check;
alter table public.profiles add constraint profiles_equipped_profile_effect_check
  check (equipped_profile_effect in (
    'none', 'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil'
  ));

create table if not exists public.profile_effect_grants (
  user_id uuid not null references public.profiles(id) on delete cascade,
  effect_id text not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  grant_message text,
  acknowledged_at timestamptz,
  primary key (user_id, effect_id),
  constraint profile_effect_grants_effect_check check (effect_id in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil'
  ))
);

create index if not exists idx_profile_effect_grants_user_ack
  on public.profile_effect_grants (user_id, acknowledged_at, granted_at desc);

alter table public.profile_effect_grants enable row level security;

revoke all on public.profile_effect_grants from public, anon, authenticated;
grant select on public.profile_effect_grants to authenticated;

drop policy if exists profile_effect_grants_select_own on public.profile_effect_grants;
create policy profile_effect_grants_select_own on public.profile_effect_grants
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

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
    else 'Profile Effect'
  end;
$$;

revoke execute on function public.profile_effect_label(text) from public, anon;
grant execute on function public.profile_effect_label(text) to authenticated;

create or replace function public.get_profile_card_appearance(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
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

  return jsonb_build_object(
    'card_theme', v_profile.card_theme,
    'cover_url', v_profile.cover_url,
    'profile_effect', coalesce(v_profile.equipped_profile_effect, 'none')
  );
end;
$$;

create or replace function public.update_own_profile_card(
  p_theme text default null,
  p_cover_url text default null,
  p_clear_cover boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;
  if p_theme is not null and p_theme not in ('emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono') then
    raise exception 'Invalid card color.' using errcode = '22023';
  end if;
  if p_cover_url is not null and (
    length(p_cover_url) > 500 or
    p_cover_url !~ ('^https://woslmwokhhyszkgevnli\.supabase\.co/storage/v1/object/public/ipon-media/covers/' || auth.uid()::text || '/[a-f0-9-]+\.(jpg|png|webp)$')
  ) then
    raise exception 'Invalid cover photo.' using errcode = '22023';
  end if;
  if p_clear_cover and p_cover_url is not null then
    raise exception 'Invalid cover update.' using errcode = '22023';
  end if;

  update public.profiles
  set card_theme = coalesce(p_theme, card_theme),
      cover_url = case when p_clear_cover then null else coalesce(p_cover_url, cover_url) end
  where id = auth.uid()
    and status = 'ACTIVE'
  returning * into v_profile;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'card_theme', v_profile.card_theme,
    'cover_url', v_profile.cover_url,
    'profile_effect', coalesce(v_profile.equipped_profile_effect, 'none')
  );
end;
$$;

create or replace function public.get_own_profile_effects()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_grants jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'effect_id', g.effect_id,
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
  where g.user_id = v_uid;

  return jsonb_build_object(
    'equipped_effect', coalesce(v_profile.equipped_profile_effect, 'none'),
    'grants', v_grants
  );
end;
$$;

create or replace function public.equip_own_profile_effect(p_effect_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_effect text := lower(btrim(coalesce(p_effect_id, '')));
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  if v_effect = '' then
    v_effect := 'none';
  end if;

  if v_effect not in (
    'none', 'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil'
  ) then
    raise exception 'Invalid profile effect.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  if v_effect <> 'none' and v_profile.role <> 'SUPER_ADMIN' then
    if not exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = v_uid
        and g.effect_id = v_effect
    ) then
      raise exception 'This profile effect has not been unlocked for your account yet.' using errcode = '42501';
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
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_equip text := nullif(lower(btrim(coalesce(p_equip_effect_id, ''))), '');
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid and status = 'ACTIVE';

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  update public.profile_effect_grants
  set acknowledged_at = coalesce(acknowledged_at, now())
  where user_id = v_uid
    and acknowledged_at is null
    and (p_effect_ids is null or effect_id = any(p_effect_ids));

  if v_equip is not null then
    if v_equip = 'none' then
      update public.profiles
      set equipped_profile_effect = 'none'
      where id = v_uid and status = 'ACTIVE';
    elsif v_equip in (
      'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
      'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
      'astro', 'constellation', 'sigil'
    ) and (
      v_profile.role = 'SUPER_ADMIN'
      or exists (
        select 1
        from public.profile_effect_grants g
        where g.user_id = v_uid
          and g.effect_id = v_equip
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

create or replace function public.super_admin_list_profile_effects()
returns table (
  user_id uuid,
  effect_id text,
  granted_at timestamptz,
  grant_message text,
  acknowledged_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can view platform profile effect assignments.' using errcode = '42501';
  end if;

  return query
  select g.user_id,
         g.effect_id,
         g.granted_at,
         g.grant_message,
         g.acknowledged_at
  from public.profile_effect_grants g
  order by g.granted_at desc, g.effect_id asc;
end;
$$;

create or replace function public.super_admin_grant_profile_effects(
  p_user_id uuid,
  p_effect_ids text[],
  p_creator_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_target record;
  v_clean_ids text[];
  v_new_ids text[] := '{}'::text[];
  v_effect_id text;
  v_message text := nullif(left(btrim(coalesce(p_creator_message, '')), 400), '');
  v_names_label text;
  v_notif_message text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can grant profile effects.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Select a valid user account.' using errcode = '22023';
  end if;

  select p.id, p.full_name, p.role, p.status
  into v_target
  from public.profiles p
  where p.id = p_user_id;

  if v_target.id is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_target.role = 'SUPER_ADMIN' then
    raise exception 'Super Admin system accounts cannot be assigned user rewards here.' using errcode = '22023';
  end if;

  if v_target.status <> 'ACTIVE' then
    raise exception 'Only active user accounts can receive profile effects.' using errcode = '22023';
  end if;

  select array_agg(distinct lower(btrim(x)) order by lower(btrim(x)))
  into v_clean_ids
  from unnest(coalesce(p_effect_ids, '{}'::text[])) as x
  where nullif(btrim(x), '') is not null;

  if v_clean_ids is null or array_length(v_clean_ids, 1) is null then
    raise exception 'Select at least one profile effect to award.' using errcode = '22023';
  end if;

  foreach v_effect_id in array v_clean_ids loop
    if v_effect_id not in (
      'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
      'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
      'astro', 'constellation', 'sigil'
    ) then
      raise exception 'Invalid profile effect selection: %', v_effect_id using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = p_user_id
        and g.effect_id = v_effect_id
    ) then
      insert into public.profile_effect_grants (
        user_id, effect_id, granted_by, granted_at, grant_message, acknowledged_at
      ) values (
        p_user_id, v_effect_id, v_admin_id, now(), v_message, null
      );
      v_new_ids := array_append(v_new_ids, v_effect_id);
    else
      update public.profile_effect_grants
      set grant_message = coalesce(v_message, grant_message)
      where user_id = p_user_id
        and effect_id = v_effect_id
        and acknowledged_at is null;
    end if;
  end loop;

  if coalesce(array_length(v_new_ids, 1), 0) = 0 then
    raise exception 'All selected profile effects are already permanently owned by this user.' using errcode = '22023';
  end if;

  select string_agg(public.profile_effect_label(eid), ', ')
  into v_names_label
  from unnest(v_new_ids) as eid;

  v_notif_message := case
    when v_message is not null then
      'Congratulations! You unlocked permanent profile effect'
      || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
      || v_names_label || ' (Never expires). Message from creator: "' || v_message || '"'
    else
      'Congratulations! The creator awarded you permanent profile effect'
      || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
      || v_names_label || ' (Never expires).'
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
    'EFFECT_GRANTED',
    case when array_length(v_new_ids, 1) > 1
      then 'Congratulations! Profile effects unlocked'
      else 'Congratulations! Profile effect unlocked'
    end,
    left(v_notif_message, 500),
    null,
    'EFFECT_GRANTED:' || p_user_id::text || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'granted_effects', to_jsonb(v_new_ids),
    'message', v_message
  );
end;
$$;

create or replace function public.super_admin_revoke_profile_effect(
  p_user_id uuid,
  p_effect_id text,
  p_reason text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean_effect text := lower(btrim(coalesce(p_effect_id, '')));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 400), '');
  v_effect_name text;
  v_equipped text;
  v_notif_msg text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can revoke profile effects.' using errcode = '42501';
  end if;

  if p_user_id is null or v_clean_effect = '' then
    raise exception 'Select a valid user and profile effect.' using errcode = '22023';
  end if;

  if v_reason is null or length(v_reason) < 2 then
    raise exception 'Enter a brief reason for removing this profile effect.' using errcode = '22023';
  end if;

  delete from public.profile_effect_grants
  where user_id = p_user_id
    and effect_id = v_clean_effect;

  if not found then
    raise exception 'That profile effect is not currently assigned to this user.' using errcode = 'P0002';
  end if;

  update public.profiles
  set equipped_profile_effect = case when equipped_profile_effect = v_clean_effect then 'none' else equipped_profile_effect end
  where id = p_user_id
  returning equipped_profile_effect into v_equipped;

  v_effect_name := public.profile_effect_label(v_clean_effect);
  v_notif_msg := 'The profile effect "' || v_effect_name || '" was removed by the Super Admin. Reason: ' || v_reason;

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
    'EFFECT_REMOVED',
    'Profile effect update',
    left(v_notif_msg, 500),
    null,
    'EFFECT_REMOVED:' || p_user_id::text || ':' || v_clean_effect || ':' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  );

  return jsonb_build_object(
    'user_id', p_user_id,
    'removed_effect_id', v_clean_effect,
    'equipped_effect', coalesce(v_equipped, 'none')
  );
end;
$$;

revoke all on function public.get_profile_card_appearance(uuid) from public, anon;
revoke all on function public.update_own_profile_card(text, text, boolean) from public, anon;
revoke all on function public.get_own_profile_effects() from public, anon;
revoke all on function public.equip_own_profile_effect(text) from public, anon;
revoke all on function public.acknowledge_my_profile_effects(text[], text) from public, anon;
revoke all on function public.super_admin_list_profile_effects() from public, anon;
revoke all on function public.super_admin_grant_profile_effects(uuid, text[], text) from public, anon;
revoke all on function public.super_admin_revoke_profile_effect(uuid, text, text) from public, anon;

grant execute on function public.get_profile_card_appearance(uuid) to authenticated;
grant execute on function public.update_own_profile_card(text, text, boolean) to authenticated;
grant execute on function public.get_own_profile_effects() to authenticated;
grant execute on function public.equip_own_profile_effect(text) to authenticated;
grant execute on function public.acknowledge_my_profile_effects(text[], text) to authenticated;
grant execute on function public.super_admin_list_profile_effects() to authenticated;
grant execute on function public.super_admin_grant_profile_effects(uuid, text[], text) to authenticated;
grant execute on function public.super_admin_revoke_profile_effect(uuid, text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_117', 'permanent profile effects granted by super admin with celebration unlock')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
