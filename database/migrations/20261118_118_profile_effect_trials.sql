begin;

alter table public.profile_effect_grants
  add column if not exists is_permanent boolean not null default true,
  add column if not exists expires_at timestamptz;

create table if not exists public.profile_effect_trial_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  effect_id text not null,
  request_note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  trial_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profile_effect_trial_requests_effect_check check (effect_id in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil'
  ))
);

create index if not exists idx_effect_trial_requests_user_status
  on public.profile_effect_trial_requests (user_id, status, created_at desc);

create unique index if not exists idx_effect_trial_one_pending_per_user
  on public.profile_effect_trial_requests (user_id)
  where status = 'PENDING';

create unique index if not exists idx_effect_trial_one_approved_per_effect
  on public.profile_effect_trial_requests (user_id, effect_id)
  where status = 'APPROVED';

alter table public.profile_effect_trial_requests enable row level security;

revoke all on public.profile_effect_trial_requests from public, anon, authenticated;
grant select on public.profile_effect_trial_requests to authenticated;

drop policy if exists profile_effect_trial_requests_select_own on public.profile_effect_trial_requests;
create policy profile_effect_trial_requests_select_own on public.profile_effect_trial_requests
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

create or replace function public.cleanup_expired_profile_effect_trials(p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles p
  set equipped_profile_effect = 'none'
  where (p_user_id is null or p.id = p_user_id)
    and p.role <> 'SUPER_ADMIN'
    and coalesce(p.equipped_profile_effect, 'none') <> 'none'
    and not exists (
      select 1
      from public.profile_effect_grants g
      where g.user_id = p.id
        and g.effect_id = p.equipped_profile_effect
        and (g.is_permanent = true or g.expires_at is null or g.expires_at > now())
    );

  delete from public.profile_effect_grants g
  where (p_user_id is null or g.user_id = p_user_id)
    and g.is_permanent = false
    and g.expires_at is not null
    and g.expires_at <= now();
end;
$$;

revoke all on function public.cleanup_expired_profile_effect_trials(uuid) from public, anon, authenticated;

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
    'profile_effect', v_effect
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

  if v_effect <> 'none' and v_profile.role <> 'SUPER_ADMIN' then
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

  perform public.cleanup_expired_profile_effect_trials(v_uid);

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
    and (is_permanent = true or expires_at is null or expires_at > now())
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

  if v_effect not in (
    'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
    'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp', 'jelly',
    'astro', 'constellation', 'sigil'
  ) then
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

create or replace function public.cancel_own_profile_effect_trial_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  update public.profile_effect_trial_requests
  set status = 'CANCELLED',
      reviewed_at = now()
  where id = p_request_id
    and user_id = v_uid
    and status = 'PENDING';

  if not found then
    raise exception 'Pending trial request not found.' using errcode = 'P0002';
  end if;

  return public.get_own_profile_effects();
end;
$$;

create or replace function public.super_admin_list_effect_trial_requests()
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  email text,
  avatar_url text,
  effect_id text,
  request_note text,
  status text,
  review_note text,
  trial_expires_at timestamptz,
  created_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can view profile effect trial requests.' using errcode = '42501';
  end if;

  perform public.cleanup_expired_profile_effect_trials(null);

  return query
  select r.id,
         r.user_id,
         p.full_name,
         p.email,
         p.avatar_url,
         r.effect_id,
         r.request_note,
         r.status,
         r.review_note,
         r.trial_expires_at,
         r.created_at,
         r.reviewed_at
  from public.profile_effect_trial_requests r
  join public.profiles p on p.id = r.user_id
  order by (case when r.status = 'PENDING' then 0 else 1 end) asc, r.created_at desc
  limit 200;
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

  perform public.cleanup_expired_profile_effect_trials(p_user_id);

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
        and g.is_permanent = true
    ) then
      insert into public.profile_effect_grants (
        user_id, effect_id, is_permanent, expires_at, granted_by, granted_at, grant_message, acknowledged_at
      ) values (
        p_user_id, v_effect_id, true, null, v_admin_id, now(), v_message, null
      )
      on conflict (user_id, effect_id) do update
      set is_permanent = true,
          expires_at = null,
          granted_by = v_admin_id,
          granted_at = now(),
          grant_message = coalesce(v_message, profile_effect_grants.grant_message),
          acknowledged_at = null;
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
      'Congratulations! You unlocked the permanent profile effect'
      || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
      || v_names_label || '. Message from creator: "' || v_message || '"'
    else
      'Congratulations! The creator awarded you the permanent profile effect'
      || case when array_length(v_new_ids, 1) > 1 then 's: ' else ': ' end
      || v_names_label || '.'
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

create or replace function public.super_admin_review_effect_trial_request(
  p_request_id uuid,
  p_decision text,
  p_duration_days integer default null,
  p_expires_at timestamptz default null,
  p_creator_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_req public.profile_effect_trial_requests%rowtype;
  v_target public.profiles%rowtype;
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_message text := nullif(left(btrim(coalesce(p_creator_message, '')), 400), '');
  v_expires_at timestamptz;
  v_effect_name text;
  v_last_trial_end timestamptz;
  v_notif_msg text;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can review profile effect trial requests.' using errcode = '42501';
  end if;

  if v_decision not in ('APPROVE', 'REJECT') then
    raise exception 'Choose APPROVE or REJECT.' using errcode = '22023';
  end if;

  select * into v_req
  from public.profile_effect_trial_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'Trial request not found.' using errcode = 'P0002';
  end if;

  if v_req.status <> 'PENDING' then
    raise exception 'This trial request has already been processed.' using errcode = '22023';
  end if;

  perform public.cleanup_expired_profile_effect_trials(v_req.user_id);

  select * into v_target
  from public.profiles
  where id = v_req.user_id;

  v_effect_name := public.profile_effect_label(v_req.effect_id);

  if v_decision = 'REJECT' then
    if v_message is null or length(v_message) < 2 then
      raise exception 'Enter a brief reason for declining this trial request.' using errcode = '22023';
    end if;

    update public.profile_effect_trial_requests
    set status = 'REJECTED',
        reviewed_by = v_admin_id,
        reviewed_at = now(),
        review_note = v_message
    where id = v_req.id;

    insert into public.notifications (
      recipient_id,
      group_id,
      type,
      title,
      message,
      link,
      dedupe_key
    ) values (
      v_req.user_id,
      null,
      'EFFECT_TRIAL_REJECTED',
      'Profile effect trial request update',
      left('Your trial request for "' || v_effect_name || '" was declined. Note: ' || v_message, 500),
      null,
      'EFFECT_TRIAL_REJECTED:' || v_req.id::text
    );

    return jsonb_build_object('request_id', v_req.id, 'status', 'REJECTED');
  end if;

  if v_target.id is null or v_target.status <> 'ACTIVE' then
    raise exception 'Only active user accounts can receive a trial effect.' using errcode = '22023';
  end if;

  if p_duration_days is not null and p_expires_at is not null then
    raise exception 'Choose either a trial duration preset or a custom expiration date.' using errcode = '22023';
  end if;

  if p_duration_days is not null then
    if p_duration_days < 1 or p_duration_days > 90 then
      raise exception 'Trial duration must be between 1 and 90 days.' using errcode = '22023';
    end if;
    v_expires_at := now() + make_interval(days => p_duration_days);
  elsif p_expires_at is not null then
    if p_expires_at <= now() + interval '5 minutes' then
      raise exception 'Custom trial expiration must be at least 5 minutes in the future.' using errcode = '22023';
    end if;
    v_expires_at := p_expires_at;
  else
    v_expires_at := now() + interval '7 days';
  end if;

  if exists (
    select 1 from public.profile_effect_grants g
    where g.user_id = v_req.user_id and g.is_permanent = false and g.expires_at > now()
  ) then
    raise exception 'This user currently has an active trial running.' using errcode = '22023';
  end if;

  select max(coalesce(r.trial_expires_at, r.reviewed_at, r.created_at))
  into v_last_trial_end
  from public.profile_effect_trial_requests r
  where r.user_id = v_req.user_id and r.status = 'APPROVED';

  if v_last_trial_end is not null and (v_last_trial_end + interval '1 month') > now() then
    raise exception 'This user is still in their 1-month trial cooldown until %.',
      to_char((v_last_trial_end + interval '1 month') at time zone 'Asia/Manila', 'Mon DD, YYYY')
      using errcode = '22023';
  end if;

  update public.profile_effect_trial_requests
  set status = 'APPROVED',
      reviewed_by = v_admin_id,
      reviewed_at = now(),
      review_note = v_message,
      trial_expires_at = v_expires_at
  where id = v_req.id;

  insert into public.profile_effect_grants (
    user_id, effect_id, is_permanent, expires_at, granted_by, granted_at, grant_message, acknowledged_at
  ) values (
    v_req.user_id, v_req.effect_id, false, v_expires_at, v_admin_id, now(), v_message, null
  )
  on conflict (user_id, effect_id) do update
  set is_permanent = case when profile_effect_grants.is_permanent then true else false end,
      expires_at = case when profile_effect_grants.is_permanent then null else v_expires_at end,
      granted_by = v_admin_id,
      granted_at = now(),
      grant_message = coalesce(v_message, profile_effect_grants.grant_message),
      acknowledged_at = null;

  v_notif_msg := case
    when v_message is not null then
      'Congratulations! Your trial for "' || v_effect_name || '" is active until '
      || to_char(v_expires_at at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM')
      || '. Message from creator: "' || v_message || '"'
    else
      'Congratulations! Your trial for "' || v_effect_name || '" was approved and is active until '
      || to_char(v_expires_at at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM') || '.'
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
    v_req.user_id,
    null,
    'EFFECT_GRANTED',
    'Congratulations! Trial profile effect approved',
    left(v_notif_msg, 500),
    null,
    'EFFECT_GRANTED:' || v_req.user_id::text || ':TRIAL:' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text
  );

  return jsonb_build_object(
    'request_id', v_req.id,
    'status', 'APPROVED',
    'user_id', v_req.user_id,
    'effect_id', v_req.effect_id,
    'trial_expires_at', v_expires_at
  );
end;
$$;

drop function if exists public.super_admin_list_profile_effects();
create function public.super_admin_list_profile_effects()
returns table (
  user_id uuid,
  effect_id text,
  is_permanent boolean,
  expires_at timestamptz,
  granted_at timestamptz,
  grant_message text,
  acknowledged_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can view platform profile effect assignments.' using errcode = '42501';
  end if;

  perform public.cleanup_expired_profile_effect_trials(null);

  return query
  select g.user_id,
         g.effect_id,
         coalesce(g.is_permanent, true) as is_permanent,
         g.expires_at,
         g.granted_at,
         g.grant_message,
         g.acknowledged_at
  from public.profile_effect_grants g
  where g.is_permanent = true or g.expires_at is null or g.expires_at > now()
  order by g.granted_at desc, g.effect_id asc;
end;
$$;

revoke all on function public.get_profile_card_appearance(uuid) from public, anon;
revoke all on function public.get_own_profile_effects() from public, anon;
revoke all on function public.equip_own_profile_effect(text) from public, anon;
revoke all on function public.acknowledge_my_profile_effects(text[], text) from public, anon;
revoke all on function public.submit_profile_effect_trial_request(text, text) from public, anon;
revoke all on function public.cancel_own_profile_effect_trial_request(uuid) from public, anon;
revoke all on function public.super_admin_list_profile_effects() from public, anon;
revoke all on function public.super_admin_list_effect_trial_requests() from public, anon;
revoke all on function public.super_admin_grant_profile_effects(uuid, text[], text) from public, anon;
revoke all on function public.super_admin_review_effect_trial_request(uuid, text, integer, timestamptz, text) from public, anon;

grant execute on function public.get_profile_card_appearance(uuid) to authenticated;
grant execute on function public.get_own_profile_effects() to authenticated;
grant execute on function public.equip_own_profile_effect(text) to authenticated;
grant execute on function public.acknowledge_my_profile_effects(text[], text) to authenticated;
grant execute on function public.submit_profile_effect_trial_request(text, text) to authenticated;
grant execute on function public.cancel_own_profile_effect_trial_request(uuid) to authenticated;
grant execute on function public.super_admin_list_profile_effects() to authenticated;
grant execute on function public.super_admin_list_effect_trial_requests() to authenticated;
grant execute on function public.super_admin_grant_profile_effects(uuid, text[], text) to authenticated;
grant execute on function public.super_admin_review_effect_trial_request(uuid, text, integer, timestamptz, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_118', 'profile effect trial requests, super admin approval with duration, 1 per effect and 1 month cooldown')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
