-- Migration 178: Scheduled Awards (Verified Badges & Profile Effects)
-- Allows Super Admins to schedule Verified Badges and/or Profile Effects for one or multiple users
-- with a shared release date/time or per-user schedules, automatically delivering rewards on time.

begin;

create table if not exists public.scheduled_awards (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  award_badge boolean not null default false,
  badge_duration_days integer null check (badge_duration_days is null or (badge_duration_days >= 1 and badge_duration_days <= 3650)),
  badge_expires_at timestamptz null,
  effect_ids text[] not null default '{}'::text[],
  effect_duration_days integer null check (effect_duration_days is null or (effect_duration_days >= 1 and effect_duration_days <= 90)),
  effect_expires_at timestamptz null,
  creator_message text null,
  scheduled_for timestamptz not null,
  status text not null default 'PENDING' check (status in ('PENDING', 'DELIVERED', 'CANCELLED', 'FAILED')),
  error_message text null,
  created_by uuid null references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz null,
  cancelled_at timestamptz null,
  constraint scheduled_awards_has_reward_check check (
    award_badge = true or coalesce(array_length(effect_ids, 1), 0) > 0
  )
);

create index if not exists scheduled_awards_pending_due_idx
  on public.scheduled_awards (scheduled_for)
  where status = 'PENDING';

create index if not exists scheduled_awards_user_pending_idx
  on public.scheduled_awards (user_id, scheduled_for)
  where status = 'PENDING';

alter table public.scheduled_awards enable row level security;

drop policy if exists "scheduled_awards_super_admin_select" on public.scheduled_awards;
create policy "scheduled_awards_super_admin_select"
  on public.scheduled_awards
  for select
  to authenticated
  using (public.is_super_admin());

do $$
begin
  alter publication supabase_realtime add table public.scheduled_awards;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create or replace function public.process_due_scheduled_awards(
  p_user_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_caller uuid := auth.uid();
  v_scope_user_id uuid := p_user_id;
  v_row public.scheduled_awards%rowtype;
  v_target record;
  v_email text;
  v_tier text;
  v_badge_expires timestamptz;
  v_badge_dur_label text;
  v_badge_notif text;
  v_eff_is_perm boolean;
  v_eff_expires timestamptz;
  v_eff_id text;
  v_new_ids text[];
  v_names_label text;
  v_eff_title text;
  v_eff_notif text;
  v_message text;
  v_delivered integer := 0;
begin
  if v_caller is null then
    raise exception 'Authentication required to process scheduled awards.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    v_scope_user_id := v_caller;
  end if;

  for v_row in
    select *
    from public.scheduled_awards
    where status = 'PENDING'
      and scheduled_for <= now()
      and (v_scope_user_id is null or user_id = v_scope_user_id)
    order by scheduled_for asc, created_at asc
    for update skip locked
  loop
    begin
      select p.id, p.full_name, p.role, p.status, p.email, u.email as auth_email
      into v_target
      from public.profiles p
      left join auth.users u on u.id = p.id
      where p.id = v_row.user_id;

      if v_target.id is null or v_target.role = 'SUPER_ADMIN' or v_target.status <> 'ACTIVE' then
        update public.scheduled_awards
        set status = 'FAILED',
            error_message = 'Target account is no longer active.'
        where id = v_row.id;
        continue;
      end if;

      v_message := nullif(left(btrim(coalesce(v_row.creator_message, '')), 400), '');
      v_email := lower(btrim(coalesce(nullif(v_target.email, ''), v_target.auth_email, '')));

      if v_row.award_badge then
        v_tier := case when v_email = 'breadspanish231@gmail.com' then 'CREATOR_GREEN' else 'BLUE' end;
        if v_row.badge_duration_days is not null then
          v_badge_expires := now() + make_interval(days => v_row.badge_duration_days);
        elsif v_row.badge_expires_at is not null then
          v_badge_expires := case
            when v_row.badge_expires_at > now() + interval '1 minute' then v_row.badge_expires_at
            else now() + interval '1 day'
          end;
        else
          v_badge_expires := null;
        end if;

        update public.profiles
        set verified_badge_tier = v_tier,
            verified_badge_expires_at = v_badge_expires,
            verified_badge_message = v_message,
            verified_badge_granted_at = now(),
            verified_badge_acknowledged_at = null,
            verified_badge_granted_by = v_row.created_by
        where id = v_row.user_id;

        v_badge_dur_label := case
          when v_badge_expires is null then 'Permanent'
          else 'Valid until ' || to_char(v_badge_expires at time zone 'Asia/Manila', 'Mon DD, YYYY')
        end;

        v_badge_notif := case
          when v_message is not null then
            'Congratulations! You received a verified badge (' || v_badge_dur_label || '). Message from creator: "' || v_message || '". Note: Even permanent badges are automatically removed after 2 months of inactivity.'
          else
            'Congratulations! The creator awarded you a verified badge (' || v_badge_dur_label || '). Note: Even permanent badges are automatically removed after 2 months of inactivity.'
        end;

        insert into public.notifications (
          recipient_id, group_id, type, title, message, link, dedupe_key
        ) values (
          v_row.user_id,
          null,
          'BADGE_GRANTED',
          'Congratulations! Verified badge awarded',
          left(v_badge_notif, 500),
          null,
          'SCHEDULED_BADGE_GRANTED:' || v_row.id::text
        )
        on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
      end if;

      if coalesce(array_length(v_row.effect_ids, 1), 0) > 0 then
        perform public.cleanup_expired_profile_effect_trials(v_row.user_id);

        v_eff_is_perm := true;
        v_eff_expires := null;
        if v_row.effect_duration_days is not null then
          v_eff_is_perm := false;
          v_eff_expires := now() + make_interval(days => v_row.effect_duration_days);
        elsif v_row.effect_expires_at is not null then
          v_eff_is_perm := false;
          v_eff_expires := case
            when v_row.effect_expires_at > now() + interval '5 minutes' then v_row.effect_expires_at
            else now() + interval '1 day'
          end;
        end if;

        v_new_ids := '{}'::text[];
        foreach v_eff_id in array v_row.effect_ids loop
          v_eff_id := lower(btrim(coalesce(v_eff_id, '')));
          if v_eff_id = '' or not public.is_valid_profile_effect_id(v_eff_id) then
            continue;
          end if;

          if exists (
            select 1
            from public.profile_effect_grants g
            where g.user_id = v_row.user_id
              and g.effect_id = v_eff_id
              and g.is_permanent = true
          ) then
            update public.profile_effect_grants
            set grant_message = coalesce(v_message, grant_message)
            where user_id = v_row.user_id
              and effect_id = v_eff_id
              and acknowledged_at is null;
            continue;
          end if;

          insert into public.profile_effect_grants (
            user_id, effect_id, is_permanent, expires_at, granted_by, granted_at, grant_message, acknowledged_at
          ) values (
            v_row.user_id,
            v_eff_id,
            case when v_eff_id = 'ex_early_user' then true else v_eff_is_perm end,
            case when v_eff_id = 'ex_early_user' then null else v_eff_expires end,
            v_row.created_by,
            now(),
            v_message,
            null
          )
          on conflict (user_id, effect_id) do update
          set is_permanent = case when profile_effect_grants.is_permanent or v_eff_id = 'ex_early_user' then true else v_eff_is_perm end,
              expires_at = case when profile_effect_grants.is_permanent or v_eff_id = 'ex_early_user' then null else v_eff_expires end,
              granted_by = v_row.created_by,
              granted_at = now(),
              grant_message = coalesce(v_message, profile_effect_grants.grant_message),
              acknowledged_at = null;

          v_new_ids := array_append(v_new_ids, v_eff_id);

          if exists (
            select 1
            from public.profile_effect_trial_requests r
            where r.user_id = v_row.user_id
              and r.effect_id = v_eff_id
              and r.status = 'PENDING'
          ) then
            update public.profile_effect_trial_requests
            set status = 'CANCELLED',
                reviewed_by = v_row.created_by,
                reviewed_at = now(),
                review_note = coalesce(v_message, 'Awarded via scheduled award by Super Admin')
            where user_id = v_row.user_id
              and effect_id = v_eff_id
              and status = 'PENDING';
          end if;
        end loop;

        if coalesce(array_length(v_new_ids, 1), 0) > 0 then
          select string_agg(public.profile_effect_label(eid), ', ')
          into v_names_label
          from unnest(v_new_ids) as eid;

          if v_eff_is_perm then
            v_eff_title := case when array_length(v_new_ids, 1) > 1
              then 'Congratulations! Profile effects unlocked'
              else 'Congratulations! Profile effect unlocked'
            end;
            v_eff_notif := case
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
            v_eff_title := case when array_length(v_new_ids, 1) > 1
              then 'Trial profile effects unlocked'
              else 'Trial profile effect unlocked'
            end;
            v_eff_notif := case
              when v_message is not null then
                'You received a limited-time trial for ' || v_names_label
                || ' (active until ' || to_char(v_eff_expires at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM')
                || '). Message from creator: "' || v_message || '"'
              else
                'You received a limited-time trial for ' || v_names_label
                || ' (active until ' || to_char(v_eff_expires at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI AM') || ').'
            end;
          end if;

          insert into public.notifications (
            recipient_id, group_id, type, title, message, link, dedupe_key
          ) values (
            v_row.user_id,
            null,
            'EFFECT_GRANTED',
            v_eff_title,
            left(v_eff_notif, 500),
            null,
            'SCHEDULED_EFFECT_GRANTED:' || v_row.id::text
          )
          on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
        end if;
      end if;

      update public.scheduled_awards
      set status = 'DELIVERED',
          delivered_at = now(),
          error_message = null
      where id = v_row.id;

      v_delivered := v_delivered + 1;
    exception when others then
      update public.scheduled_awards
      set status = 'FAILED',
          error_message = left(coalesce(sqlerrm, 'Failed to deliver scheduled award.'), 300)
      where id = v_row.id;
    end;
  end loop;

  return v_delivered;
end;
$$;

create or replace function public.super_admin_create_scheduled_awards(
  p_items jsonb,
  p_award_badge boolean default false,
  p_badge_duration_days integer default null,
  p_badge_expires_at timestamptz default null,
  p_effect_ids text[] default '{}'::text[],
  p_effect_duration_days integer default null,
  p_effect_expires_at timestamptz default null,
  p_creator_message text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid := auth.uid();
  v_batch_id uuid := gen_random_uuid();
  v_clean_effects text[] := '{}'::text[];
  v_eff_id text;
  v_message text := nullif(left(btrim(coalesce(p_creator_message, '')), 400), '');
  v_item jsonb;
  v_uid uuid;
  v_sched timestamptz;
  v_target public.profiles%rowtype;
  v_inserted integer := 0;
  v_delivered_now integer := 0;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can schedule awards.' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Select at least one recipient and schedule date/time.' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) > 250 then
    raise exception 'You can schedule up to 250 recipients per batch.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(btrim(x))), '{}'::text[])
  into v_clean_effects
  from unnest(coalesce(p_effect_ids, '{}'::text[])) as x
  where nullif(btrim(x), '') is not null;

  if not coalesce(p_award_badge, false) and coalesce(array_length(v_clean_effects, 1), 0) = 0 then
    raise exception 'Select a verified badge and/or at least one profile effect to schedule.' using errcode = '22023';
  end if;

  if coalesce(p_award_badge, false) then
    if p_badge_duration_days is not null and p_badge_expires_at is not null then
      raise exception 'Choose either a badge duration preset or a custom badge expiration date.' using errcode = '22023';
    end if;
    if p_badge_duration_days is not null and (p_badge_duration_days < 1 or p_badge_duration_days > 3650) then
      raise exception 'Badge duration must be between 1 and 3,650 days.' using errcode = '22023';
    end if;
    if p_badge_expires_at is not null and p_badge_expires_at <= now() + interval '1 minute' then
      raise exception 'Custom badge expiration date must be in the future.' using errcode = '22023';
    end if;
  end if;

  if coalesce(array_length(v_clean_effects, 1), 0) > 0 then
    if p_effect_duration_days is not null and p_effect_expires_at is not null then
      raise exception 'Choose either an effect trial preset or a custom effect expiration date.' using errcode = '22023';
    end if;
    if p_effect_duration_days is not null and (p_effect_duration_days < 1 or p_effect_duration_days > 90) then
      raise exception 'Effect trial duration must be between 1 and 90 days.' using errcode = '22023';
    end if;
    if p_effect_expires_at is not null and p_effect_expires_at <= now() + interval '5 minutes' then
      raise exception 'Custom effect trial expiration must be at least 5 minutes in the future.' using errcode = '22023';
    end if;
    foreach v_eff_id in array v_clean_effects loop
      if not public.is_valid_profile_effect_id(v_eff_id) then
        raise exception 'Invalid profile effect selection: %', v_eff_id using errcode = '22023';
      end if;
      if v_eff_id = 'ex_early_user' and (p_effect_duration_days is not null or p_effect_expires_at is not null) then
        raise exception 'Founders'' Grove can only be scheduled as a permanent award.' using errcode = '22023';
      end if;
    end loop;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    begin
      v_uid := nullif(btrim(coalesce(v_item->>'user_id', '')), '')::uuid;
    exception when others then
      raise exception 'Invalid recipient user ID in scheduled award list.' using errcode = '22023';
    end;
    begin
      v_sched := nullif(btrim(coalesce(v_item->>'scheduled_for', '')), '')::timestamptz;
    exception when others then
      raise exception 'Invalid scheduled date and time format.' using errcode = '22023';
    end;

    if v_uid is null or v_sched is null then
      raise exception 'Every recipient must have a valid user ID and scheduled date/time.' using errcode = '22023';
    end if;

    if v_sched < now() - interval '1 minute' then
      raise exception 'Scheduled release date and time cannot be in the past.' using errcode = '22023';
    end if;

    select * into v_target
    from public.profiles
    where id = v_uid;

    if not found or v_target.role = 'SUPER_ADMIN' or v_target.status <> 'ACTIVE' then
      raise exception 'Only active user accounts can receive scheduled awards.' using errcode = '22023';
    end if;

    if p_badge_expires_at is not null and p_badge_expires_at <= v_sched then
      raise exception 'Custom badge expiration must be after the scheduled release date and time.' using errcode = '22023';
    end if;

    if p_effect_expires_at is not null and p_effect_expires_at <= v_sched then
      raise exception 'Custom effect trial expiration must be after the scheduled release date and time.' using errcode = '22023';
    end if;

    insert into public.scheduled_awards (
      batch_id,
      user_id,
      award_badge,
      badge_duration_days,
      badge_expires_at,
      effect_ids,
      effect_duration_days,
      effect_expires_at,
      creator_message,
      scheduled_for,
      status,
      created_by
    ) values (
      v_batch_id,
      v_uid,
      coalesce(p_award_badge, false),
      case when coalesce(p_award_badge, false) then p_badge_duration_days else null end,
      case when coalesce(p_award_badge, false) then p_badge_expires_at else null end,
      v_clean_effects,
      case when coalesce(array_length(v_clean_effects, 1), 0) > 0 then p_effect_duration_days else null end,
      case when coalesce(array_length(v_clean_effects, 1), 0) > 0 then p_effect_expires_at else null end,
      v_message,
      v_sched,
      'PENDING',
      v_admin_id
    );
    v_inserted := v_inserted + 1;
  end loop;

  v_delivered_now := public.process_due_scheduled_awards(null);

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'count', v_inserted,
    'delivered_now', v_delivered_now
  );
end;
$$;

create or replace function public.super_admin_list_scheduled_awards()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can view scheduled awards.' using errcode = '42501';
  end if;

  perform public.process_due_scheduled_awards(null);

  select coalesce(jsonb_agg(row_obj), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', sa.id,
      'batch_id', sa.batch_id,
      'user_id', sa.user_id,
      'full_name', coalesce(p.full_name, 'User'),
      'email', p.email,
      'avatar_url', p.avatar_url,
      'user_status', p.status,
      'award_badge', sa.award_badge,
      'badge_duration_days', sa.badge_duration_days,
      'badge_expires_at', sa.badge_expires_at,
      'effect_ids', coalesce(sa.effect_ids, '{}'::text[]),
      'effect_duration_days', sa.effect_duration_days,
      'effect_expires_at', sa.effect_expires_at,
      'creator_message', sa.creator_message,
      'scheduled_for', sa.scheduled_for,
      'status', sa.status,
      'error_message', sa.error_message,
      'created_at', sa.created_at,
      'delivered_at', sa.delivered_at,
      'cancelled_at', sa.cancelled_at
    ) as row_obj
    from public.scheduled_awards sa
    left join public.profiles p on p.id = sa.user_id
    order by
      case when sa.status = 'PENDING' then 0 else 1 end asc,
      case when sa.status = 'PENDING' then extract(epoch from sa.scheduled_for) else -extract(epoch from coalesce(sa.delivered_at, sa.cancelled_at, sa.scheduled_for)) end asc
    limit 200
  ) sub;

  return v_rows;
end;
$$;

create or replace function public.super_admin_update_scheduled_award(
  p_id uuid,
  p_scheduled_for timestamptz,
  p_creator_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_awards%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can update scheduled awards.' using errcode = '42501';
  end if;

  if p_id is null or p_scheduled_for is null then
    raise exception 'Scheduled award ID and date/time are required.' using errcode = '22023';
  end if;

  if p_scheduled_for < now() - interval '1 minute' then
    raise exception 'Scheduled release date and time cannot be in the past.' using errcode = '22023';
  end if;

  select * into v_row
  from public.scheduled_awards
  where id = p_id
  for update;

  if not found then
    raise exception 'Scheduled award not found.' using errcode = 'P0002';
  end if;

  if v_row.status <> 'PENDING' then
    raise exception 'Only pending scheduled awards can be rescheduled.' using errcode = '22023';
  end if;

  if v_row.badge_expires_at is not null and v_row.badge_expires_at <= p_scheduled_for then
    raise exception 'Scheduled time must be earlier than the custom badge expiration.' using errcode = '22023';
  end if;

  if v_row.effect_expires_at is not null and v_row.effect_expires_at <= p_scheduled_for then
    raise exception 'Scheduled time must be earlier than the custom effect expiration.' using errcode = '22023';
  end if;

  update public.scheduled_awards
  set scheduled_for = p_scheduled_for,
      creator_message = case when p_creator_message is null then creator_message else nullif(left(btrim(p_creator_message), 400), '') end
  where id = p_id
  returning * into v_row;

  perform public.process_due_scheduled_awards(v_row.user_id);

  select * into v_row from public.scheduled_awards where id = p_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.super_admin_cancel_scheduled_award(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.scheduled_awards%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Only Super Admins can cancel scheduled awards.' using errcode = '42501';
  end if;

  update public.scheduled_awards
  set status = 'CANCELLED',
      cancelled_at = now()
  where id = p_id
    and status = 'PENDING'
  returning * into v_row;

  if not found then
    raise exception 'Pending scheduled award not found.' using errcode = 'P0002';
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.process_due_scheduled_awards(uuid) from public, anon;
grant execute on function public.process_due_scheduled_awards(uuid) to authenticated;
grant execute on function public.super_admin_create_scheduled_awards(jsonb, boolean, integer, timestamptz, text[], integer, timestamptz, text) to authenticated;
grant execute on function public.super_admin_list_scheduled_awards() to authenticated;
grant execute on function public.super_admin_update_scheduled_award(uuid, timestamptz, text) to authenticated;
grant execute on function public.super_admin_cancel_scheduled_award(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_178', 'add scheduled awards for verified badges and profile effects')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
