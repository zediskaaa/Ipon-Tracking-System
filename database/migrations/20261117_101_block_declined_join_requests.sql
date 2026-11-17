-- Block declined join-request users from reusing the same invite code or link
begin;

create or replace function public.preview_group_invite_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_code text := public._normalize_invite_code(p_code);
  v_uid uuid := auth.uid();
  v_invite public.group_invite_codes;
  v_group public.groups;
  v_member_count bigint := 0;
  v_gm public.group_memberships;
  v_pending_req boolean := false;
  v_declined_req boolean := false;
  v_role public.app_role;
begin
  if char_length(v_code) <> 6 then
    return jsonb_build_object(
      'valid', false,
      'reason', 'INVALID_FORMAT',
      'message', 'Enter a valid 6-character group code.'
    );
  end if;

  if v_uid is not null then
    select p.role into v_role from public.profiles p where p.id = v_uid;
    if v_role = 'SUPER_ADMIN' then
      return jsonb_build_object(
        'valid', false,
        'reason', 'SUPER_ADMIN',
        'message', 'Super administrator accounts cannot join savings groups.'
      );
    end if;
  end if;

  select * into v_invite
  from public.group_invite_codes
  where code = v_code;

  if not found then
    return jsonb_build_object(
      'valid', false,
      'reason', 'NOT_FOUND',
      'message', 'Group invite code not found. Double-check the 6-character code or ask your admin for a new link.'
    );
  end if;

  select * into v_group
  from public.groups
  where id = v_invite.group_id;

  if not found or v_group.status <> 'ACTIVE' or coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then
    return jsonb_build_object(
      'valid', false,
      'reason', 'UNAVAILABLE',
      'message', 'This savings group is not accepting invites right now.'
    );
  end if;

  if v_invite.revoked_at is not null then
    return jsonb_build_object(
      'valid', false,
      'reason', 'REVOKED',
      'message', 'This invite link or code has been revoked by the group administrator.'
    );
  end if;

  if v_invite.expires_at <= now() then
    return jsonb_build_object(
      'valid', false,
      'reason', 'EXPIRED',
      'message', 'This invite link or code has expired. Ask the group administrator to generate a new one.'
    );
  end if;

  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    return jsonb_build_object(
      'valid', false,
      'reason', 'LIMIT_REACHED',
      'message', 'This invite link has reached its maximum number of uses. Ask the administrator for a new code.'
    );
  end if;

  select count(*) into v_member_count
  from public.members m
  where m.group_id = v_group.id
    and m.deleted_at is null
    and m.status = 'ACTIVE';

  if v_uid is not null then
    select * into v_gm
    from public.group_memberships gm
    where gm.group_id = v_group.id
      and gm.user_id = v_uid;

    if v_gm.id is not null and v_gm.status = 'DISABLED' then
      return jsonb_build_object(
        'valid', false,
        'blocked', true,
        'reason', 'DISABLED',
        'group_id', v_group.id,
        'group_name', v_group.name,
        'group_avatar_url', v_group.avatar_url,
        'message', 'Your access to this savings group was disabled by an administrator.'
      );
    end if;

    if not (v_gm.id is not null and v_gm.status = 'ACTIVE') then
      select exists (
        select 1 from public.group_join_requests jr
        where jr.group_id = v_group.id
          and jr.user_id = v_uid
          and jr.status = 'DECLINED'
          and (jr.invite_code_id = v_invite.id or jr.invite_code_id is null)
      ) into v_declined_req;

      if v_declined_req then
        return jsonb_build_object(
          'valid', false,
          'blocked', true,
          'reason', 'DECLINED_BLOCKED',
          'group_id', v_group.id,
          'group_name', v_group.name,
          'group_avatar_url', v_group.avatar_url,
          'member_count', v_member_count,
          'message', 'Your previous request to join "' || v_group.name || '" was declined. You are blocked from using this invite link or code.'
        );
      end if;
    end if;

    select exists (
      select 1 from public.group_join_requests jr
      where jr.group_id = v_group.id
        and jr.user_id = v_uid
        and jr.status = 'PENDING'
    ) into v_pending_req;
  end if;

  return jsonb_build_object(
    'valid', true,
    'code', v_invite.code,
    'group_id', v_group.id,
    'group_name', v_group.name,
    'group_avatar_url', v_group.avatar_url,
    'member_count', v_member_count,
    'require_approval', v_invite.require_approval,
    'expires_at', v_invite.expires_at,
    'already_member', (v_gm.id is not null and v_gm.status = 'ACTIVE'),
    'existing_role', case when v_gm.id is not null and v_gm.status = 'ACTIVE' then v_gm.role else null end,
    'pending_request', v_pending_req
  );
end;
$$;

revoke all on function public.preview_group_invite_code(text) from public;
grant execute on function public.preview_group_invite_code(text) to anon, authenticated;

create or replace function public.join_group_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := public._normalize_invite_code(p_code);
  v_profile public.profiles;
  v_invite public.group_invite_codes;
  v_group public.groups;
  v_gm public.group_memberships;
  v_existing_req public.group_join_requests;
  v_request_id uuid;
  v_grant jsonb;
  v_user_name text;
  v_admin record;
begin
  if v_uid is null then
    raise exception 'Sign in or create an account before joining a savings group.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete two-factor verification before joining a savings group.' using errcode = '42501';
  end if;
  if char_length(v_code) <> 6 then
    raise exception 'Enter a valid 6-character group code.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid;

  if not found then
    raise exception 'Account profile not found.' using errcode = 'P0002';
  end if;
  if v_profile.role = 'SUPER_ADMIN' then
    raise exception 'Super administrator accounts cannot join savings groups.' using errcode = '42501';
  end if;
  if v_profile.status <> 'ACTIVE' then
    raise exception 'Your account must be active before joining a savings group.' using errcode = '42501';
  end if;

  select * into v_invite
  from public.group_invite_codes
  where code = v_code
  for update;

  if not found then
    raise exception 'Group invite code not found. Double-check the 6-character code.' using errcode = 'P0002';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'This invite link or code has been revoked by the group administrator.' using errcode = '22023';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'This invite link or code has expired. Ask the group administrator for a new one.' using errcode = '22023';
  end if;
  if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
    raise exception 'This invite link has reached its maximum number of uses.' using errcode = '22023';
  end if;

  select * into v_group
  from public.groups
  where id = v_invite.group_id and status = 'ACTIVE';

  if not found or coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then
    raise exception 'This savings group is not accepting new members right now.' using errcode = '22023';
  end if;

  v_user_name := coalesce(nullif(btrim(v_profile.full_name), ''), v_profile.email, 'A user');

  select * into v_gm
  from public.group_memberships
  where group_id = v_group.id
    and user_id = v_uid;

  if v_gm.id is not null and v_gm.status = 'DISABLED' then
    raise exception 'Your access to this savings group was disabled by an administrator.' using errcode = '42501';
  end if;

  if v_gm.id is not null and v_gm.status = 'ACTIVE' then
    return jsonb_build_object(
      'status', 'ALREADY_MEMBER',
      'group_id', v_group.id,
      'group_name', v_group.name,
      'role', v_gm.role,
      'message', 'You are already a member of "' || v_group.name || '".'
    );
  end if;

  if exists (
    select 1
    from public.group_join_requests jr
    where jr.group_id = v_group.id
      and jr.user_id = v_uid
      and jr.status = 'DECLINED'
      and (jr.invite_code_id = v_invite.id or jr.invite_code_id is null)
  ) then
    raise exception 'You are blocked from joining "%" using this invite link or code because your previous request was declined.', v_group.name using errcode = '42501';
  end if;

  if v_invite.require_approval then
    select * into v_existing_req
    from public.group_join_requests
    where group_id = v_group.id
      and user_id = v_uid
      and status = 'PENDING';

    if found then
      update public.group_join_requests
      set invite_code_id = v_invite.id
      where id = v_existing_req.id;

      return jsonb_build_object(
        'status', 'PENDING_APPROVAL',
        'already_pending', true,
        'request_id', v_existing_req.id,
        'group_id', v_group.id,
        'group_name', v_group.name,
        'message', 'Your request to join "' || v_group.name || '" is already waiting for admin approval.'
      );
    end if;

    insert into public.group_join_requests (group_id, invite_code_id, user_id, status)
    values (v_group.id, v_invite.id, v_uid, 'PENDING')
    returning id into v_request_id;

    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group.id)
      where user_id <> v_uid
    loop
      perform public.push_notification(
        v_admin.id,
        'GROUP_JOIN_REQUEST',
        'Join request received',
        v_user_name || ' wants to join "' || v_group.name || '" via invite code ' || v_invite.code || '.',
        'settings.html?join_requests=1#access',
        v_group.id
      );
    end loop;

    return jsonb_build_object(
      'status', 'PENDING_APPROVAL',
      'already_pending', false,
      'request_id', v_request_id,
      'group_id', v_group.id,
      'group_name', v_group.name,
      'message', 'Request sent! An administrator of "' || v_group.name || '" will review your join request.'
    );
  end if;

  -- Instant join flow
  update public.group_invite_codes
  set use_count = use_count + 1
  where id = v_invite.id;

  v_grant := public._grant_group_member_via_invite(v_group.id, v_uid, v_uid);

  update public.group_join_requests
  set status = 'APPROVED',
      reviewed_by = v_invite.created_by,
      reviewed_at = now(),
      review_note = 'Auto-joined with instant invite link.'
  where group_id = v_group.id
    and user_id = v_uid
    and status = 'PENDING';

  perform public.switch_active_group(v_group.id);

  for v_admin in
    select user_id as id
    from public.group_admin_ids(v_group.id)
    where user_id <> v_uid
  loop
    perform public.push_notification(
      v_admin.id,
      'GROUP_JOINED_VIA_CODE',
      'Member joined via invite',
      v_user_name || ' joined "' || v_group.name || '" using the group invite link.',
      'settings.html?access_user=' || v_uid::text || '#access',
      v_group.id
    );
  end loop;

  return jsonb_build_object(
    'status', 'JOINED',
    'group_id', v_group.id,
    'group_name', v_group.name,
    'role', v_grant ->> 'role',
    'member_id', v_grant ->> 'member_id',
    'message', 'Welcome to "' || v_group.name || '"!'
  );
end;
$$;

revoke all on function public.join_group_by_code(text) from public, anon;
grant execute on function public.join_group_by_code(text) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261117_101', 'block declined join requests from reusing the same invite link or code')
on conflict (version) do nothing;

commit;
