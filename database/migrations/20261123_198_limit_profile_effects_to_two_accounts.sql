-- Keep profile effects only for the two named accounts. Verified badges remain independent.
begin;

create or replace function public.can_use_profile_effects(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.profiles p on p.id = u.id
    where u.id = p_user_id
      and p.status = 'ACTIVE'
      and lower(btrim(u.email)) in (
        'breadspanish231@gmail.com',
        'antalannhicolejoy19@gmail.com'
      )
  );
$$;

revoke all on function public.can_use_profile_effects(uuid) from public, anon, authenticated;

-- Fail before changing anyone's effects if an allowed account cannot be identified.
do $$
begin
  if (
    select count(distinct lower(btrim(u.email)))
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.status = 'ACTIVE'
      and lower(btrim(u.email)) in (
        'breadspanish231@gmail.com',
        'antalannhicolejoy19@gmail.com'
      )
  ) <> 2 then
    raise exception 'Both allowed profile-effect accounts must exist and be active before this migration runs.';
  end if;
end $$;

-- Preserve badge-only scheduled awards; cancel only effect-only schedules for other users.
update public.scheduled_awards s
set effect_ids = '{}'::text[], effect_duration_days = null, effect_expires_at = null
where s.status = 'PENDING'
  and s.award_badge = true
  and coalesce(array_length(s.effect_ids, 1), 0) > 0
  and not public.can_use_profile_effects(s.user_id);

update public.scheduled_awards s
set status = 'CANCELLED', cancelled_at = now(),
    error_message = 'Profile effects are no longer available for this account.'
where s.status = 'PENDING'
  and s.award_badge = false
  and coalesce(array_length(s.effect_ids, 1), 0) > 0
  and not public.can_use_profile_effects(s.user_id);

update public.profile_effect_trial_requests r
set status = 'CANCELLED', reviewed_at = now(),
    review_note = 'Profile effects are no longer available for this account.'
where r.status = 'PENDING'
  and not public.can_use_profile_effects(r.user_id);

update public.profiles p
set equipped_profile_effect = 'none'
where p.equipped_profile_effect <> 'none'
  and not public.can_use_profile_effects(p.id);

delete from public.profile_effect_grants g
where not public.can_use_profile_effects(g.user_id);

delete from public.notifications n
where n.type in ('EFFECT_GRANTED', 'EFFECT_REMOVED', 'EFFECT_TRIAL_REJECTED', 'EFFECT_TRIAL_REQUESTED')
  and not public.can_use_profile_effects(n.recipient_id);

create or replace function public.guard_profile_effect_grant_access()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.can_use_profile_effects(new.user_id) then
    raise exception 'Profile effects are unavailable for this account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_profile_effect_trial_access()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if new.status in ('PENDING', 'APPROVED') and not public.can_use_profile_effects(new.user_id) then
    raise exception 'Profile effects are unavailable for this account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.guard_equipped_profile_effect_access()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if coalesce(new.equipped_profile_effect, 'none') <> 'none'
     and not public.can_use_profile_effects(new.id) then
    if tg_op = 'UPDATE' and new.equipped_profile_effect is not distinct from old.equipped_profile_effect then
      new.equipped_profile_effect := 'none';
    else
      raise exception 'Profile effects are unavailable for this account.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_scheduled_profile_effect_access()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  if coalesce(array_length(new.effect_ids, 1), 0) > 0
     and not public.can_use_profile_effects(new.user_id) then
    raise exception 'Profile effects cannot be scheduled for this account.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profile_effect_grants_allowed_accounts on public.profile_effect_grants;
create trigger profile_effect_grants_allowed_accounts before insert or update
  on public.profile_effect_grants for each row execute function public.guard_profile_effect_grant_access();

drop trigger if exists profile_effect_trials_allowed_accounts on public.profile_effect_trial_requests;
create trigger profile_effect_trials_allowed_accounts before insert or update of user_id, effect_id, status
  on public.profile_effect_trial_requests for each row execute function public.guard_profile_effect_trial_access();

drop trigger if exists profiles_equipped_effect_allowed_accounts on public.profiles;
create trigger profiles_equipped_effect_allowed_accounts before insert or update of equipped_profile_effect, email, status
  on public.profiles for each row execute function public.guard_equipped_profile_effect_access();

drop trigger if exists scheduled_effects_allowed_accounts on public.scheduled_awards;
create trigger scheduled_effects_allowed_accounts before insert or update of user_id, effect_ids
  on public.scheduled_awards for each row execute function public.guard_scheduled_profile_effect_access();

revoke all on function public.guard_profile_effect_grant_access() from public, anon, authenticated;
revoke all on function public.guard_profile_effect_trial_access() from public, anon, authenticated;
revoke all on function public.guard_equipped_profile_effect_access() from public, anon, authenticated;
revoke all on function public.guard_scheduled_profile_effect_access() from public, anon, authenticated;

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

  if not public.can_use_profile_effects(v_uid) then
    return jsonb_build_object(
      'equipped_effect', 'none',
      'grants', '[]'::jsonb,
      'trial_requests', '[]'::jsonb,
      'trial_state', jsonb_build_object(
        'used_effects', '[]'::jsonb,
        'active_trial', null,
        'pending_request', null,
        'cooldown_until', null
      )
    );
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
        acknowledged_at = coalesce(public.profile_effect_grants.acknowledged_at, now())
    where profile_effect_grants.is_permanent is distinct from true
       or profile_effect_grants.expires_at is not null
       or profile_effect_grants.acknowledged_at is null;
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

insert into public.schema_migrations (version, name)
values ('20261123_198', 'restrict profile effects to two named accounts')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
