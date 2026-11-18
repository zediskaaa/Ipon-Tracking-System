begin;

create or replace function public.is_creator_owner_account(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, ''))) = 'breadspanish231@gmail.com';
$$;

revoke all on function public.is_creator_owner_account(text) from public, anon, authenticated;

-- Remove accidental creator-backfill grants from any non-creator account (keeps real grants like Sakura Drift intact)
delete from public.profile_effect_grants g
using public.profiles p
left join auth.users u on u.id = p.id
where g.user_id = p.id
  and not public.is_creator_owner_account(coalesce(nullif(p.email, ''), u.email))
  and g.grant_message = 'Unlocked permanently for the myIPON creator account.';

-- Ensure equipped_profile_effect on non-creator accounts stays within currently owned grants
update public.profiles p
set equipped_profile_effect = coalesce(
  (
    select g.effect_id
    from public.profile_effect_grants g
    where g.user_id = p.id
      and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
    order by (g.effect_id = 'petals') desc, g.granted_at asc
    limit 1
  ),
  'none'
)
where p.role <> 'SUPER_ADMIN'
  and p.equipped_profile_effect <> 'none'
  and not exists (
    select 1
    from auth.users u
    where u.id = p.id
      and public.is_creator_owner_account(coalesce(nullif(p.email, ''), u.email))
  )
  and not exists (
    select 1
    from public.profile_effect_grants g
    where g.user_id = p.id
      and g.effect_id = p.equipped_profile_effect
      and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
  );

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
      'jelly', 'astro', 'constellation', 'sigil'
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

revoke all on function public.get_own_profile_effects() from public, anon;
revoke all on function public.equip_own_profile_effect(text) from public, anon;
grant execute on function public.get_own_profile_effects() to authenticated;
grant execute on function public.equip_own_profile_effect(text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_121', 'restrict creator all-effects unlock strictly to breadspanish231@gmail.com and clean up accidental grants')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
