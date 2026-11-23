-- Add least-privilege, group-scoped read-only member profile RPC for calendar and
-- day-details avatar clicks. Respects active group isolation, Super Admin visibility,
-- verified badge acknowledgment/inactivity rules, and profile effect grant expiration.
-- Forward-only, zero CASCADE.

begin;

create or replace function public.get_group_member_profile(p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_is_self boolean := false;
  v_is_super boolean := false;
  v_group_id uuid := null;
  v_caller_role text := null;
  v_target_group_role text := null;
  v_shares_active_group boolean := false;
  v_group_name text := null;
  v_profile public.profiles%rowtype;
  v_email text := '';
  v_last_sign_in_at timestamptz := null;
  v_effect text := 'none';
  v_badge_tier text := 'NONE';
begin
  if v_uid is null then
    raise exception 'Sign in required.' using errcode = '28000';
  end if;

  if p_target_id is null then
    return jsonb_build_object('profile_visible', false);
  end if;

  v_is_self := (p_target_id = v_uid);
  v_is_super := public.is_super_admin();
  v_group_id := public.current_group_id();
  v_caller_role := public.current_user_role();

  if v_group_id is not null and v_caller_role in ('ADMIN', 'TREASURER', 'MEMBER') then
    select gm.role::text
    into v_target_group_role
    from public.group_memberships gm
    where gm.group_id = v_group_id
      and gm.user_id = p_target_id
      and gm.status = 'ACTIVE'
    limit 1;

    if v_target_group_role is not null then
      v_shares_active_group := true;
    else
      select p.role::text
      into v_target_group_role
      from public.profiles p
      where p.id = p_target_id
        and p.group_id = v_group_id
        and p.status = 'ACTIVE'
      limit 1;
      v_shares_active_group := (v_target_group_role is not null);
    end if;
  end if;

  if not v_is_self and not v_is_super and not v_shares_active_group then
    return jsonb_build_object('profile_visible', false);
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_target_id
    and status = 'ACTIVE';

  if not found then
    return jsonb_build_object('profile_visible', false);
  end if;

  if v_shares_active_group and v_group_id is not null then
    select g.name
    into v_group_name
    from public.groups g
    where g.id = v_group_id
      and g.status = 'ACTIVE';
  end if;

  select coalesce(nullif(v_profile.email, ''), u.email, ''), u.last_sign_in_at
  into v_email, v_last_sign_in_at
  from auth.users u
  where u.id = v_profile.id;

  v_effect := coalesce(nullif(btrim(v_profile.equipped_profile_effect), ''), 'none');
  if not public.is_valid_profile_effect_id(v_effect) then
    v_effect := 'none';
  elsif left(lower(v_effect), 8) = 'creator_' and not public.is_creator_owner_account(v_email) then
    v_effect := 'none';
  elsif v_effect <> 'none'
    and v_profile.role <> 'SUPER_ADMIN'
    and not public.is_creator_owner_account(v_email) then
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

  v_badge_tier := public.effective_verified_badge_for_user(
    v_profile.verified_badge_tier,
    v_profile.verified_badge_expires_at,
    v_profile.verified_badge_granted_at,
    greatest(v_profile.last_seen_at, public.latest_retention_activity_at(v_profile.id)),
    v_profile.created_at,
    v_email,
    v_last_sign_in_at,
    v_profile.verified_badge_acknowledged_at
  );

  return jsonb_build_object(
    'profile_visible', true,
    'id', v_profile.id,
    'full_name', v_profile.full_name,
    'username', v_profile.username,
    'bio', v_profile.bio,
    'avatar_url', v_profile.avatar_url,
    'group_role', coalesce(v_target_group_role, case when v_profile.role = 'SUPER_ADMIN' then 'SUPER_ADMIN' else null end),
    'group_name', v_group_name,
    'card_theme', coalesce(nullif(btrim(v_profile.card_theme), ''), 'emerald'),
    'cover_url', v_profile.cover_url,
    'equipped_profile_effect', v_effect,
    'verified_badge_tier', v_badge_tier,
    'verified_badge_granted_at', case when v_badge_tier <> 'NONE' then v_profile.verified_badge_granted_at else null end,
    'social_links', public.sanitize_social_app_links(v_profile.social_links, false)
  );
end;
$$;

revoke all on function public.get_group_member_profile(uuid) from public, anon;
grant execute on function public.get_group_member_profile(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261123_196', 'group_member_readonly_profile')
on conflict (version) do nothing;

commit;
