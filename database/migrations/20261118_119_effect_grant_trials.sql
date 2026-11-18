begin;

drop function if exists public.super_admin_grant_profile_effects(uuid, text[], text);
drop function if exists public.super_admin_grant_profile_effects(uuid, text[], text, integer, timestamptz);

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

  select array_agg(distinct btrim(x))
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

revoke all on function public.super_admin_grant_profile_effects(uuid, text[], text, integer, timestamptz) from public, anon;
grant execute on function public.super_admin_grant_profile_effects(uuid, text[], text, integer, timestamptz) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_119', 'allow super admin to grant trial card duration directly from award effect dialog')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
