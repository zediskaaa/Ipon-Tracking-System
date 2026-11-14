-- Migration 20261115_069: Emit deep-linked targets on every notification so tapping any web, push, or Android alert opens the specific announcement, record, request, member, reminder, or detail modal.
begin;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_member_user record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name
    when 'contributions' then 'contribution'
    when 'withdrawals' then 'deduction'
    else 'expense'
  end;
  v_record_type text := case tg_table_name
    when 'contributions' then 'contribution'
    when 'withdrawals' then 'withdrawal'
    else 'expense'
  end;
  v_record_key text := v_record_type || ':' || new.id::text;
  v_status text := lower(new.approval_status::text);
  v_submitter_role public.app_role;
  v_submitter_name text := 'A group user';
  v_amount_text text := to_char(coalesce(new.amount, 0), 'FM999,999,990.00');
  v_link text := 'dashboard.html';
  v_reason text;
  v_message text;
begin
  if new.submitted_by is not null then
    select coalesce(gm.role, p.role), coalesce(nullif(btrim(p.full_name), ''), 'A group user')
    into v_submitter_role, v_submitter_name
    from public.profiles p
    left join public.group_memberships gm
      on gm.group_id = v_group
     and gm.user_id = p.id
     and gm.status = 'ACTIVE'
    where p.id = new.submitted_by;

    v_link := case
      when tg_table_name = 'contributions' and v_submitter_role = 'MEMBER' then 'user.html'
      when tg_table_name = 'contributions' then 'contributions.html'
      when tg_table_name = 'withdrawals' then 'withdrawals.html'
      else 'expenses.html'
    end;
  end if;

  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group)
    loop
      perform public.push_notification(
        v_admin.id,
        'REVIEW_REQUIRED',
        'New ' || v_label || ' submitted',
        v_submitter_name || ' submitted a ' || v_label || ' (PHP ' || v_amount_text || ') for review.',
        'dashboard.html?review=' || v_record_key,
        v_group
      );
    end loop;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        'SUBMITTED',
        initcap(v_label) || ' submitted',
        'Your ' || v_label || ' (PHP ' || v_amount_text || ') is waiting for administrator review.',
        v_link || '?record=' || v_record_key,
        v_group
      );
    end if;
  elsif tg_op = 'INSERT'
    and tg_table_name = 'contributions'
    and new.approval_status = 'CONFIRMED'
  then
    for v_member_user in
      select distinct u.id as user_id
      from public.contribution_periods cp
      join (
        select gm.user_id as id, gm.member_id
        from public.group_memberships gm
        where gm.group_id = v_group and gm.status = 'ACTIVE' and gm.member_id is not null
        union
        select p.id, p.member_id
        from public.profiles p
        where p.group_id = v_group and p.status = 'ACTIVE' and p.member_id is not null
      ) u on u.member_id = cp.member_id
      where cp.id = new.contribution_period_id
        and u.id is distinct from new.submitted_by
    loop
      perform public.push_notification(
        v_member_user.user_id,
        'CONTRIBUTION_RECORDED',
        'Contribution recorded',
        'A confirmed contribution of PHP ' || v_amount_text || ' was recorded on your profile.',
        'user.html?record=' || v_record_key,
        v_group
      );
    end loop;
  elsif tg_op = 'UPDATE'
    and (
      (old.approval_status = 'PENDING' and new.approval_status in ('CONFIRMED', 'REJECTED'))
      or (old.approval_status = 'CONFIRMED' and new.approval_status = 'VOIDED')
    )
  then
    v_reason := nullif(btrim(coalesce(
      case when new.approval_status = 'VOIDED' then new.void_reason else new.review_note end,
      ''
    )), '');
    v_message := case
      when new.approval_status = 'VOIDED' then 'Your ' || v_label || ' (PHP ' || v_amount_text || ') was voided.'
      else 'Your submitted ' || v_label || ' (PHP ' || v_amount_text || ') was ' || v_status || '.'
    end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end;
    if char_length(v_message) > 500 then
      v_message := left(v_message, 499) || '…';
    end if;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        case when new.approval_status = 'VOIDED' then 'VOIDED' else 'REVIEWED' end,
        initcap(v_label) || ' ' || v_status,
        v_message,
        v_link || '?record=' || v_record_key,
        v_group
      );
    end if;

    if tg_table_name = 'contributions' and new.approval_status in ('CONFIRMED', 'VOIDED') then
      for v_member_user in
        select distinct u.id as user_id
        from public.contribution_periods cp
        join (
          select gm.user_id as id, gm.member_id
          from public.group_memberships gm
          where gm.group_id = v_group and gm.status = 'ACTIVE' and gm.member_id is not null
          union
          select p.id, p.member_id
          from public.profiles p
          where p.group_id = v_group and p.status = 'ACTIVE' and p.member_id is not null
        ) u on u.member_id = cp.member_id
        where cp.id = new.contribution_period_id
          and u.id is distinct from new.submitted_by
      loop
        perform public.push_notification(
          v_member_user.user_id,
          case when new.approval_status = 'VOIDED' then 'VOIDED' else 'CONTRIBUTION_RECORDED' end,
          'Contribution ' || v_status,
          case when new.approval_status = 'VOIDED'
            then 'A contribution on your profile (PHP ' || v_amount_text || ') was voided.'
            else 'A contribution on your profile (PHP ' || v_amount_text || ') was confirmed.'
          end || case when v_reason is not null then E'\nReason: ' || v_reason else '' end,
          'user.html?record=' || v_record_key,
          v_group
        );
      end loop;
    end if;
  elsif tg_op = 'UPDATE'
    and old.approval_status = new.approval_status
    and new.approval_status = 'PENDING'
  then
    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_group)
    loop
      perform public.push_notification(
        v_admin.id,
        'RECORD_UPDATED',
        initcap(v_label) || ' updated',
        v_submitter_name || ' updated a pending ' || v_label || ' (PHP ' || v_amount_text || ') awaiting review.',
        'dashboard.html?review=' || v_record_key,
        v_group
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_record_activity() from public, anon, authenticated;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
begin
  for v_admin in
    select user_id as id
    from public.group_admin_ids(new.group_id)
  loop
    perform public.push_notification(
      v_admin.id,
      'MEMBER_CREATED',
      'Member registered',
      new.full_name || ' was added to your group.',
      'members.html?member=' || new.id::text,
      new.group_id
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_new_member() from public, anon, authenticated;

create or replace function public.notify_profile_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role in ('MEMBER', 'TREASURER')
    and old.status is distinct from new.status
    and new.status = 'ACTIVE'
  then
    perform public.push_notification(
      new.id,
      'ACCOUNT_READY',
      'Your account is ready',
      case
        when new.role = 'TREASURER' then 'Your treasurer account is active in your savings group.'
        else 'Your member account is active and linked to your savings profile.'
      end,
      case when new.role = 'TREASURER' then 'dashboard.html?notice=account-ready' else 'user.html?notice=account-ready' end,
      new.group_id
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_profile_access() from public, anon, authenticated;

create or replace function public.admin_set_user_access(
  p_user_id uuid,
  p_role public.app_role,
  p_status public.account_status,
  p_member_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.app_role := public.current_user_role();
  v_actor_group uuid := public.current_group_id();
  v_member public.members;
  v_target public.profiles;
  v_prev_membership public.group_memberships;
  v_link_member_id uuid;
  v_group_name text := 'your savings group';
begin
  if v_actor_role = 'SUPER_ADMIN' then
    if p_role not in ('SUPER_ADMIN', 'ADMIN') or p_member_id is not null then
      raise exception 'Super administrators can only manage platform administrator accounts.' using errcode = '42501';
    end if;
    if p_role = 'SUPER_ADMIN' and p_user_id <> auth.uid() then
      raise exception 'Additional super administrator accounts cannot be assigned here.' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() and (p_role <> 'SUPER_ADMIN' or p_status <> 'ACTIVE') then
      raise exception 'You cannot remove or disable your own super administrator access.' using errcode = '22023';
    end if;
    update public.profiles
    set role = p_role, status = p_status, member_id = null
    where id = p_user_id and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
    if not found then
      raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
    end if;
    return;
  end if;

  if v_actor_role <> 'ADMIN' or v_actor_group is null then
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() or p_role not in ('MEMBER', 'TREASURER') then
    raise exception 'Group administrators can only manage member and treasurer accounts in their own group.' using errcode = '42501';
  end if;

  if p_role = 'MEMBER' and p_status = 'ACTIVE' and p_member_id is null then
    raise exception 'Active member accounts must be linked to a member.' using errcode = '22023';
  end if;

  if p_role = 'TREASURER' and p_member_id is not null then
    raise exception 'Treasurer accounts cannot be linked to a member profile.' using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found or v_target.role = 'SUPER_ADMIN' then
    raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
  end if;

  select * into v_prev_membership
  from public.group_memberships
  where group_id = v_actor_group and user_id = p_user_id;

  select name into v_group_name from public.groups where id = v_actor_group;
  v_group_name := coalesce(nullif(btrim(v_group_name), ''), 'your savings group');

  v_link_member_id := case when p_role = 'MEMBER' then p_member_id else null end;

  if v_link_member_id is not null then
    select * into v_member from public.members
    where id = v_link_member_id and group_id = v_actor_group and deleted_at is null;
    if not found then
      raise exception 'The selected member does not belong to your savings group.' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.group_memberships gm
      where gm.group_id = v_actor_group
        and gm.member_id = v_link_member_id
        and gm.user_id <> p_user_id
    ) then
      raise exception 'That member already has a linked user account in this group.' using errcode = '22023';
    end if;
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_actor_group, p_user_id, p_role, p_status, v_link_member_id)
  on conflict (group_id, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      member_id = excluded.member_id;

  if (v_target.group_id is null or v_target.group_id = v_actor_group) and (p_status = 'ACTIVE' or v_target.status <> 'ACTIVE') then
    update public.profiles
    set role = p_role,
        status = case when v_target.status = 'ACTIVE' then 'ACTIVE' else p_status end,
        member_id = v_link_member_id,
        group_id = v_actor_group,
        first_name = coalesce(first_name, v_member.first_name),
        middle_name = coalesce(middle_name, v_member.middle_name),
        last_name = coalesce(last_name, v_member.last_name),
        full_name = coalesce(nullif(btrim(full_name), ''), v_member.full_name),
        contact_number = coalesce(contact_number, v_member.contact_number)
    where id = p_user_id;
  end if;

  if v_prev_membership.user_id is not null and (
    v_prev_membership.role is distinct from p_role
    or v_prev_membership.status is distinct from p_status
  ) then
    perform public.push_notification(
      p_user_id,
      'ACCESS_UPDATED',
      'Group access updated',
      case
        when p_status = 'DISABLED' then 'Your access to "' || v_group_name || '" was disabled by an administrator.'
        when v_prev_membership.role is distinct from p_role then 'Your role in "' || v_group_name || '" was changed to ' || initcap(lower(p_role::text)) || '.'
        else 'Your access in "' || v_group_name || '" is now ' || lower(p_status::text) || '.'
      end,
      (case when p_role = 'MEMBER' then 'user.html' else 'dashboard.html' end) || '?notice=access-updated',
      v_actor_group
    );
  end if;
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) from public, anon;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text := nullif(btrim(p_group_name), '');
  v_group_id uuid;
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if v_group_name is null or char_length(v_group_name) < 2 then raise exception 'A group name of at least 2 characters is required.' using errcode = '22023'; end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;

  update public.profiles
  set role = 'ADMIN',
      status = 'ACTIVE',
      group_id = v_group_id,
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_user_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE', member_id = null;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(
    p_user_id,
    'ADMIN_APPROVED',
    'Administrator request approved',
    'Your request was approved. Group "' || v_group_name || '" is ready.',
    'dashboard.html?notice=admin-approved',
    v_group_id
  );
  return v_group_id;
end;
$$;

revoke execute on function public.super_admin_approve_request(uuid, text) from public, anon;
grant execute on function public.super_admin_approve_request(uuid, text) to authenticated;

create or replace function public.accept_group_invitation(p_notification_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notif record;
  v_group record;
  v_membership record;
  v_admin record;
  v_user_name text := 'A user';
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_notif
  from public.notifications
  where id = p_notification_id
    and recipient_id = auth.uid();

  if not found then
    raise exception 'Invitation notification not found.' using errcode = 'P0002';
  end if;

  if v_notif.group_id is null then
    raise exception 'This notification is not associated with a savings group.' using errcode = '22023';
  end if;

  select * into v_group
  from public.groups
  where id = v_notif.group_id and status = 'ACTIVE';

  if not found then
    raise exception 'The invited savings group is no longer active.' using errcode = 'P0002';
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_notif.group_id, auth.uid(), 'MEMBER', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set status = 'ACTIVE'
  returning * into v_membership;

  update public.profiles
  set group_id = coalesce(group_id, v_notif.group_id),
      role = case when group_id is null then v_membership.role else role end,
      member_id = case when group_id is null then v_membership.member_id else member_id end,
      status = 'ACTIVE'
  where id = auth.uid()
  returning coalesce(nullif(btrim(full_name), ''), 'A user') into v_user_name;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;

  for v_admin in
    select user_id as id
    from public.group_admin_ids(v_notif.group_id)
    where user_id <> auth.uid()
  loop
    perform public.push_notification(
      v_admin.id,
      'GROUP_INVITE_ACCEPTED',
      'Invitation accepted',
      v_user_name || ' accepted the invitation to join "' || v_group.name || '".',
      'settings.html?access_user=' || auth.uid()::text || '#access',
      v_notif.group_id
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'group_id', v_notif.group_id,
    'group_name', v_group.name,
    'role', v_membership.role
  );
end;
$$;

revoke execute on function public.accept_group_invitation(bigint) from public, anon;
grant execute on function public.accept_group_invitation(bigint) to authenticated;

create or replace function public.decline_group_invitation(p_notification_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notif record;
  v_group_name text := 'the savings group';
  v_user_name text := 'A user';
  v_admin record;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_notif
  from public.notifications
  where id = p_notification_id
    and recipient_id = auth.uid();

  if not found then
    raise exception 'Invitation notification not found.' using errcode = 'P0002';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'A user') into v_user_name
  from public.profiles
  where id = auth.uid();

  if v_notif.group_id is not null then
    update public.group_memberships
    set status = 'REJECTED'
    where group_id = v_notif.group_id
      and user_id = auth.uid();

    select coalesce(nullif(btrim(name), ''), 'the savings group') into v_group_name
    from public.groups
    where id = v_notif.group_id;

    for v_admin in
      select user_id as id
      from public.group_admin_ids(v_notif.group_id)
      where user_id <> auth.uid()
    loop
      perform public.push_notification(
        v_admin.id,
        'GROUP_INVITE_DECLINED',
        'Invitation declined',
        v_user_name || ' declined the invitation to join "' || v_group_name || '".',
        'settings.html?access_user=' || auth.uid()::text || '#access',
        v_notif.group_id
      );
    end loop;
  end if;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke execute on function public.decline_group_invitation(bigint) from public, anon;
grant execute on function public.decline_group_invitation(bigint) to authenticated;

create or replace function public.notify_feature_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super_admin record;
  v_requester_name text := 'A user';
begin
  select coalesce(nullif(btrim(full_name), ''), 'A user') into v_requester_name
  from public.profiles
  where id = new.requester_id;

  for v_super_admin in
    select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE'
  loop
    perform public.push_notification(
      v_super_admin.id,
      'FEATURE_REQUEST',
      'New feature request',
      v_requester_name || ': ' || left(new.title, 120),
      'super-admin.html?feature_request=' || new.id::text || '#feature-requests'
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_feature_request_created() from public, anon, authenticated;

create or replace function public.review_feature_request(
  p_request_id uuid,
  p_status text,
  p_release_version text default null
)
returns public.feature_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_row public.feature_requests;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can review feature requests.' using errcode = '42501';
  end if;

  if v_status not in ('PENDING', 'IMPLEMENTED', 'REJECTED') then
    raise exception 'Invalid feature request status.' using errcode = '22023';
  end if;

  update public.feature_requests
  set status = v_status,
      reviewed_at = case when v_status = 'PENDING' then null else now() end,
      reviewed_by = case when v_status = 'PENDING' then null else auth.uid() end,
      release_version = case when v_status = 'IMPLEMENTED' then nullif(btrim(coalesce(p_release_version, release_version, '')), '') else null end
  where id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Feature request not found.' using errcode = 'P0002';
  end if;

  if v_status in ('IMPLEMENTED', 'REJECTED') and v_row.requester_id is not null then
    perform public.push_notification(
      v_row.requester_id,
      'FEATURE_REQUEST_REVIEWED',
      'Feature request ' || lower(v_status),
      case
        when v_status = 'IMPLEMENTED' then 'Your feature request "' || left(v_row.title, 90) || '" was marked as implemented.'
        else 'Your feature request "' || left(v_row.title, 90) || '" was not prioritized right now.'
      end,
      'dashboard.html?feature_request=' || p_request_id::text
    );
  end if;

  return v_row;
end;
$$;

revoke all on function public.review_feature_request(uuid, text, text) from public, anon;
grant execute on function public.review_feature_request(uuid, text, text) to authenticated;

create or replace function public.notify_bug_report_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super_admin record;
  v_reporter_name text := 'A user';
begin
  select coalesce(nullif(btrim(full_name), ''), 'A user') into v_reporter_name
  from public.profiles
  where id = new.reporter_id;

  for v_super_admin in
    select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE'
  loop
    perform public.push_notification(
      v_super_admin.id,
      'BUG_REPORT',
      'New bug report',
      v_reporter_name || ': ' || left(new.title, 120),
      'super-admin.html?bug_report=' || new.id::text || '#bug-reports'
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_bug_report_created() from public, anon, authenticated;

create or replace function public.notify_announcement_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient record;
  v_notif_type text;
  v_title text;
  v_preview text := left(btrim(new.description), 160);
  v_link text := 'dashboard.html?announcement=' || new.id::text;
begin
  if new.group_id is not null then
    for v_recipient in
      select distinct u.id
      from (
        select gm.user_id as id
        from public.group_memberships gm
        where gm.group_id = new.group_id
          and gm.status = 'ACTIVE'
        union
        select p.id
        from public.profiles p
        where p.group_id = new.group_id
          and p.status = 'ACTIVE'
      ) u
      join public.profiles p on p.id = u.id
      where p.id is distinct from new.author_id
        and p.status = 'ACTIVE'
        and p.notifications_enabled
    loop
      perform public.push_notification(
        v_recipient.id,
        'ANNOUNCEMENT',
        'Announcement: ' || left(new.title, 80),
        v_preview,
        v_link,
        new.group_id
      );
    end loop;
  else
    v_notif_type := case when new.announcement_type = 'RELEASE' then 'RELEASE' else 'PLATFORM_ANNOUNCEMENT' end;
    v_title := case
      when new.announcement_type = 'RELEASE' and new.release_version is not null
        then 'Update ' || new.release_version || ': ' || left(new.title, 65)
      else 'Platform update: ' || left(new.title, 75)
    end;

    for v_recipient in
      select p.id
      from public.profiles p
      where p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and p.status = 'ACTIVE'
        and p.notifications_enabled
        and p.id is distinct from new.author_id
    loop
      perform public.push_notification(
        v_recipient.id,
        v_notif_type,
        v_title,
        v_preview,
        v_link,
        null
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_announcement_created() from public, anon, authenticated;

create or replace function public.notify_announcement_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement_id uuid := case when tg_op = 'DELETE' then old.announcement_id else new.announcement_id end;
  v_actor_id uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_dedupe_key text;
  v_announcement record;
  v_recipient record;
  v_reactor_name text := 'A user';
  v_announcement_label text := 'your announcement';
  v_title_prefix text;
  v_message_suffix text;
  v_reaction_label text;
  v_title text;
  v_message text;
  v_link text;
begin
  if tg_op = 'UPDATE' and new.reaction is not distinct from old.reaction then
    return new;
  end if;

  v_dedupe_key := 'ANNOUNCEMENT_REACTION:' || v_announcement_id::text || ':' || v_actor_id::text;

  select coalesce(
    nullif(btrim(p.full_name), ''),
    nullif(concat_ws(' ', nullif(btrim(p.first_name), ''), nullif(btrim(p.last_name), '')), ''),
    nullif(btrim(p.email), ''),
    'A user'
  )
  into v_reactor_name
  from public.profiles p
  where p.id = v_actor_id;

  select a.id, a.group_id, a.author_id, a.title, a.deleted_at
  into v_announcement
  from public.announcements a
  where a.id = v_announcement_id;

  if found then
    v_announcement_label := coalesce(nullif(btrim(v_announcement.title), ''), 'your announcement');
  end if;

  v_title_prefix := left(v_reactor_name, 95) || ' reacted ';
  v_message_suffix := ' to "' || left(v_announcement_label, 120) || '".';

  if tg_op = 'DELETE' then
    delete from public.notifications n
    where n.type = 'ANNOUNCEMENT_REACTION'
      and (
        n.dedupe_key = v_dedupe_key
        or (
          n.dedupe_key is null
          and left(n.title, char_length(v_title_prefix)) = v_title_prefix
          and right(n.message, char_length(v_message_suffix)) = v_message_suffix
        )
      );
    return old;
  end if;

  if not found or v_announcement.deleted_at is not null then
    return new;
  end if;

  v_reaction_label := case new.reaction
    when '👍' then 'Like'
    when '❤️' then 'Love'
    when '😆' then 'Haha'
    when '😮' then 'Wow'
    when '😢' then 'Sad'
    when '😡' then 'Angry'
    else new.reaction
  end;

  v_title := left(v_reactor_name, 95) || ' reacted ' || new.reaction;
  v_message := 'Reacted ' || v_reaction_label || ' (' || new.reaction || ') to "' || left(v_announcement_label, 120) || '".';

  for v_recipient in
    select p.id, p.role
    from public.profiles p
    where p.status = 'ACTIVE'
      and p.notifications_enabled
      and p.id is distinct from v_actor_id
      and (
        p.id = v_announcement.author_id
        or (v_announcement.group_id is null and p.role = 'SUPER_ADMIN')
      )
  loop
    v_link := case
      when v_recipient.role = 'SUPER_ADMIN' then 'super-admin.html?announcement=' || v_announcement_id::text || '#announcements'
      else 'dashboard.html?announcement=' || v_announcement_id::text
    end;

    delete from public.notifications n
    where n.recipient_id = v_recipient.id
      and n.type = 'ANNOUNCEMENT_REACTION'
      and n.dedupe_key is null
      and left(n.title, char_length(v_title_prefix)) = v_title_prefix
      and right(n.message, char_length(v_message_suffix)) = v_message_suffix;

    insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
    values (v_recipient.id, v_announcement.group_id, 'ANNOUNCEMENT_REACTION', btrim(v_title), btrim(v_message), v_link, v_dedupe_key)
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null
    do update set
      group_id = excluded.group_id,
      title = excluded.title,
      message = excluded.message,
      link = excluded.link,
      read_at = null,
      created_at = now();
  end loop;

  return new;
end;
$$;

revoke execute on function public.notify_announcement_reaction() from public, anon, authenticated;

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_count integer;
begin
  with linked_users as (
    select distinct p.id as user_id, u.member_id
    from (
      select gm.user_id as id, gm.member_id
      from public.group_memberships gm
      where gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.id, p.member_id
      from public.profiles p
      where p.status = 'ACTIVE' and p.member_id is not null
    ) u
    join public.profiles p on p.id = u.id
    where p.status = 'ACTIVE' and p.notifications_enabled
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select lu.user_id,
         cp.group_id,
         'CONTRIBUTION_REMINDER',
         'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.',
         'user.html?reminder=' || to_char(cp.period_month, 'YYYY-MM')
  from public.contribution_periods cp
  join linked_users lu on lu.member_id = cp.member_id
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = lu.user_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from cp.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.create_due_reminders() from public, anon, authenticated;

create or replace function public.sync_my_due_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_uid uuid := auth.uid();
  v_schedule jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'ACTIVE' and notifications_enabled
  ) then
    return '[]'::jsonb;
  end if;

  with my_memberships as (
    select distinct member_id
    from (
      select gm.member_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.member_id from public.profiles p where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
  )
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select v_uid,
         cp.group_id,
         'CONTRIBUTION_REMINDER',
         'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.',
         'user.html?reminder=' || to_char(cp.period_month, 'YYYY-MM')
  from public.contribution_periods cp
  join my_memberships mm on mm.member_id = cp.member_id
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = v_uid
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.group_id is not distinct from cp.group_id
        and (n.created_at at time zone 'Asia/Manila')::date = current_date
        and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );

  with my_memberships as (
    select distinct member_id
    from (
      select gm.member_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE' and gm.member_id is not null
      union
      select p.member_id from public.profiles p where p.id = v_uid and p.status = 'ACTIVE' and p.member_id is not null
    ) s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'period_id', cp.id,
    'group_id', cp.group_id,
    'group_name', g.name,
    'period_month', cp.period_month,
    'period_label', to_char(cp.period_month, 'FMMonth YYYY'),
    'due_date', cp.due_date,
    'outstanding_amount', vcs.outstanding_amount
  ) order by cp.due_date asc), '[]'::jsonb)
  into v_schedule
  from public.contribution_periods cp
  join my_memberships mm on mm.member_id = cp.member_id
  join public.groups g on g.id = cp.group_id and g.status = 'ACTIVE'
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 14
    and vcs.outstanding_amount > 0;

  return coalesce(v_schedule, '[]'::jsonb);
end;
$$;

revoke execute on function public.sync_my_due_reminders() from public, anon;
grant execute on function public.sync_my_due_reminders() to authenticated;

create or replace function public.set_period_exemption(
  p_member_id uuid,
  p_period_month date,
  p_exempt boolean default true,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_period_month)::date;
  v_required numeric(14,2);
  v_reason text := case when coalesce(p_exempt, true) then nullif(btrim(coalesce(p_reason, '')), '') else null end;
  v_user_id uuid;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can change period exemptions.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date '2100-12-01' then
    raise exception 'Invalid contribution month.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_reason, '')) > 300 then
    raise exception 'Exemption reason must not exceed 300 characters.' using errcode = '22023';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and deleted_at is null;

  if v_required is null then
    raise exception 'Member not found in the active group.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date, is_exempt, exempt_reason)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month),
    coalesce(p_exempt, true),
    v_reason
  )
  on conflict (member_id, period_month) do update
    set is_exempt = excluded.is_exempt,
        exempt_reason = excluded.exempt_reason;

  select u.id into v_user_id
  from (
    select gm.user_id as id from public.group_memberships gm where gm.group_id = v_group_id and gm.member_id = p_member_id and gm.status = 'ACTIVE'
    union
    select p.id from public.profiles p where p.group_id = v_group_id and p.member_id = p_member_id and p.status = 'ACTIVE'
  ) u
  join public.profiles p on p.id = u.id
  where p.notifications_enabled
  limit 1;

  if v_user_id is not null then
    perform public.push_notification(
      v_user_id,
      'PERIOD_EXEMPTION',
      case when coalesce(p_exempt, true) then 'Contribution period marked exempt' else 'Contribution exemption removed' end,
      to_char(v_month, 'FMMonth YYYY') || case
        when coalesce(p_exempt, true) then ' has been marked exempt' || coalesce(': ' || v_reason, '.')
        else ' is active again for regular contribution tracking.'
      end,
      'user.html?exemption=' || to_char(v_month, 'YYYY-MM'),
      v_group_id
    );
  end if;
end;
$$;

revoke execute on function public.set_period_exemption(uuid, date, boolean, text) from public, anon;
grant execute on function public.set_period_exemption(uuid, date, boolean, text) to authenticated;

create or replace function public.remind_unpaid_members(p_period_month date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', coalesce(p_period_month, current_date))::date;
  v_row record;
  v_user_id uuid;
  v_sent integer := 0;
  v_skipped integer := 0;
  v_unlinked integer := 0;
  v_unpaid_total integer := 0;
begin
  if v_role not in ('ADMIN', 'TREASURER') or v_group_id is null then
    raise exception 'Only an administrator or treasurer can send payment reminders.' using errcode = '42501';
  end if;

  for v_row in
    select vcs.member_id, vcs.member_name, vcs.outstanding_amount, cp.due_date
    from public.v_contribution_status vcs
    join public.contribution_periods cp on cp.id = vcs.contribution_period_id
    where cp.group_id = v_group_id
      and vcs.period_month = v_month
      and vcs.payment_status in ('UNPAID', 'PARTIALLY PAID')
      and vcs.outstanding_amount > 0
  loop
    v_unpaid_total := v_unpaid_total + 1;

    select u.id into v_user_id
    from (
      select gm.user_id as id from public.group_memberships gm where gm.group_id = v_group_id and gm.member_id = v_row.member_id and gm.status = 'ACTIVE'
      union
      select p.id from public.profiles p where p.group_id = v_group_id and p.member_id = v_row.member_id and p.status = 'ACTIVE'
    ) u
    join public.profiles p on p.id = u.id
    where p.notifications_enabled
    limit 1;

    if v_user_id is null then
      v_unlinked := v_unlinked + 1;
    elsif exists (
      select 1 from public.notifications n
      where n.recipient_id = v_user_id
        and n.group_id = v_group_id
        and n.type = 'CONTRIBUTION_REMINDER'
        and n.created_at > now() - interval '6 hours'
        and n.message like '%' || to_char(v_month, 'FMMonth YYYY') || '%'
    ) then
      v_skipped := v_skipped + 1;
    else
      perform public.push_notification(
        v_user_id,
        'CONTRIBUTION_REMINDER',
        'Contribution reminder for ' || to_char(v_month, 'FMMonth YYYY'),
        'Outstanding balance: PHP ' || to_char(v_row.outstanding_amount, 'FM999,999,990.00') || '. Due ' || to_char(v_row.due_date, 'Mon DD, YYYY') || '.',
        'user.html?reminder=' || to_char(v_month, 'YYYY-MM'),
        v_group_id
      );
      v_sent := v_sent + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'sent', v_sent,
    'skipped_recent', v_skipped,
    'unlinked', v_unlinked,
    'unpaid_total', v_unpaid_total
  );
end;
$$;

revoke execute on function public.remind_unpaid_members(date) from public, anon;
grant execute on function public.remind_unpaid_members(date) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_full_name text;
  v_contact text;
  v_reason text;
  v_account_kind text := coalesce(new.raw_user_meta_data ->> 'account_kind', 'DIRECT_SIGNUP');
  v_name_setup_required boolean := coalesce((new.raw_user_meta_data ->> 'name_setup_required')::boolean, false);
  v_super_admin record;
  v_request_id uuid;
  v_status public.account_status := 'ACTIVE';
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '') is not null
     and nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '') is not null then
    v_first_name := public.validated_name_part(new.raw_user_meta_data ->> 'first_name', 'First name');
    v_middle_name := public.validated_name_part(new.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
    v_last_name := public.validated_name_part(new.raw_user_meta_data ->> 'last_name', 'Last name');
    v_full_name := concat_ws(' ', v_first_name, v_middle_name, v_last_name);
  else
    v_full_name := case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2 then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2 then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end;
    v_name_setup_required := true;
  end if;

  v_contact := public.normalize_ph_mobile(new.raw_user_meta_data ->> 'contact_number');
  v_reason := nullif(btrim(new.raw_user_meta_data ->> 'request_reason'), '');

  if v_account_kind = 'DISABLED' then
    v_status := 'DISABLED';
  elsif v_account_kind = 'ADMIN_REQUEST' then
    if exists (
      select 1 from public.admin_requests ar
      where lower(ar.email) = lower(new.email)
        and ar.status = 'REJECTED'
    ) or exists (
      select 1 from public.profiles p
      where lower(p.email) = lower(new.email)
        and p.status = 'DISABLED'
        and p.role = 'MEMBER'
    ) then
      raise exception 'This email address was declined for administrator access and cannot request again.' using errcode = '22023';
    end if;

    if v_contact is null or v_reason is null or char_length(v_reason) < 10 then
      raise exception 'Administrator requests require a contact number and a reason of at least 10 characters.' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.email_verifications ev
      where lower(ev.email) = lower(new.email)
        and ev.purpose = 'ADMIN_REQUEST'
        and ev.verified_at is not null
        and ev.verified_at >= now() - interval '30 minutes'
    ) then
      raise exception 'Email ownership has not been verified. Please verify your email before submitting.' using errcode = '22023';
    end if;
    v_status := 'PENDING';
  elsif v_account_kind in ('INVITED', 'MANAGED') then
    v_status := 'PENDING';
  else
    v_status := 'ACTIVE';
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status, name_setup_required)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', v_status, v_name_setup_required)
  on conflict (id) do update set
    status = case when v_account_kind in ('INVITED', 'MANAGED') then 'PENDING' when public.profiles.status = 'PENDING' then 'ACTIVE' else public.profiles.status end,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    first_name = coalesce(public.profiles.first_name, excluded.first_name),
    last_name = coalesce(public.profiles.last_name, excluded.last_name),
    contact_number = coalesce(public.profiles.contact_number, excluded.contact_number),
    name_setup_required = public.profiles.name_setup_required or excluded.name_setup_required;

  if v_account_kind = 'ADMIN_REQUEST' then
    insert into public.admin_requests (requester_id, email, contact_number, reason)
    values (new.id, lower(new.email), v_contact, v_reason)
    returning id into v_request_id;

    for v_super_admin in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(
        v_super_admin.id,
        'ADMIN_REQUEST',
        'New administrator request',
        v_full_name || ' requested administrator access.',
        'super-admin.html?admin_request=' || v_request_id::text || '#requests'
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.super_admin_set_administrator_status(
  p_user_id uuid,
  p_status public.account_status
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can change account status.' using errcode = '42501';
  end if;

  if p_status not in ('ACTIVE', 'DISABLED') then
    raise exception 'Account status must be ACTIVE or DISABLED.' using errcode = '22023';
  end if;

  update public.profiles
  set status = p_status
  where id = p_user_id and role in ('ADMIN', 'TREASURER', 'MEMBER')
  returning role into v_role;

  if v_role is null then
    raise exception 'User account not found.' using errcode = 'P0002';
  end if;

  if v_role = 'ADMIN' then
    update public.groups
    set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'SUSPENDED' end
    where owner_id = p_user_id;
  end if;

  perform public.push_notification(
    auth.uid(),
    'USER_STATUS',
    'Account status changed',
    'A user account is now ' || lower(p_status::text) || '.',
    'super-admin.html?admin_user=' || p_user_id::text || '#administrators'
  );
end;
$$;

revoke execute on function public.super_admin_set_administrator_status(uuid, public.account_status) from public, anon;
grant execute on function public.super_admin_set_administrator_status(uuid, public.account_status) to authenticated;

create or replace function public.admin_transfer_and_leave_group(
  p_group_id uuid,
  p_new_admin_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_group uuid := public.current_group_id();
  v_actor_name text;
  v_group public.groups;
  v_target_gm public.group_memberships;
  v_target_member_id uuid;
  v_old_member_id uuid;
  v_next_gm public.group_memberships;
  v_next_member_id uuid;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_admin() or v_actor_group is null or v_actor_group is distinct from p_group_id then
    raise exception 'Only the active administrator of this group can transfer ownership.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_actor_group and status = 'ACTIVE';

  if not found then
    raise exception 'Active savings group not found.' using errcode = 'P0002';
  end if;

  if p_new_admin_user_id is null or p_new_admin_user_id = v_actor_id then
    raise exception 'Choose another active member in this group to receive the administrator role.' using errcode = '22023';
  end if;

  select gm.* into v_target_gm
  from public.group_memberships gm
  join public.profiles p on p.id = gm.user_id
  where gm.group_id = v_actor_group
    and gm.user_id = p_new_admin_user_id
    and gm.status = 'ACTIVE'
    and p.status = 'ACTIVE'
    and p.role <> 'SUPER_ADMIN';

  if not found then
    raise exception 'Selected user must be an active member or treasurer of this savings group.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name
  from public.profiles
  where id = v_actor_id;

  update public.groups
  set owner_id = p_new_admin_user_id
  where id = v_actor_group;

  update public.group_memberships
  set role = 'ADMIN'
  where group_id = v_actor_group
    and user_id = p_new_admin_user_id;

  v_target_member_id := null;
  if v_target_gm.member_id is not null then
    select m.id into v_target_member_id
    from public.members m
    where m.id = v_target_gm.member_id
      and m.group_id = v_actor_group
      and m.status = 'ACTIVE'
      and m.deleted_at is null;
  end if;

  update public.profiles
  set role = 'ADMIN',
      group_id = case when group_id is null then v_actor_group else group_id end,
      member_id = case when group_id is null or group_id = v_actor_group then v_target_member_id else member_id end
  where id = p_new_admin_user_id
    and (group_id = v_actor_group or group_id is null);

  delete from public.group_memberships
  where group_id = v_actor_group
    and user_id = v_actor_id
  returning member_id into v_old_member_id;

  if v_old_member_id is not null then
    update public.members
    set status = 'INACTIVE',
        deactivated_at = now(),
        updated_by = v_actor_id
    where id = v_old_member_id
      and group_id = v_actor_group
      and deleted_at is null;

    delete from public.contribution_periods cp
    where cp.member_id = v_old_member_id
      and cp.group_id = v_actor_group
      and not exists (
        select 1 from public.contributions c
        where c.contribution_period_id = cp.id
      );
  end if;

  select gm.* into v_next_gm
  from public.group_memberships gm
  join public.groups g on g.id = gm.group_id
  where gm.user_id = v_actor_id
    and gm.status = 'ACTIVE'
    and g.status = 'ACTIVE'
  order by gm.created_at asc
  limit 1;

  if found then
    v_next_member_id := null;
    if v_next_gm.member_id is not null then
      select m.id into v_next_member_id
      from public.members m
      where m.id = v_next_gm.member_id
        and m.group_id = v_next_gm.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null;
    end if;

    update public.profiles
    set group_id = v_next_gm.group_id,
        role = v_next_gm.role,
        member_id = v_next_member_id
    where id = v_actor_id;
  else
    update public.profiles
    set group_id = null,
        role = 'MEMBER',
        member_id = null
    where id = v_actor_id;
  end if;

  perform public.push_notification(
    p_new_admin_user_id,
    'GROUP_ADMIN_TRANSFERRED',
    'You are now group administrator',
    coalesce(nullif(btrim(v_actor_name), ''), 'The previous administrator')
      || ' transferred administrator ownership of "' || v_group.name || '" to you.',
    'dashboard.html?notice=group-admin-transferred',
    v_actor_group
  );

  return jsonb_build_object(
    'group_id', v_actor_group,
    'transferred_to', p_new_admin_user_id,
    'next_group_id', v_next_gm.group_id
  );
end;
$$;

revoke execute on function public.admin_transfer_and_leave_group(uuid, uuid) from public, anon;
grant execute on function public.admin_transfer_and_leave_group(uuid, uuid) to authenticated;

create or replace function public.admin_delete_group(
  p_group_id uuid,
  p_confirm_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_group uuid := public.current_group_id();
  v_group public.groups;
  v_affected_users uuid[];
  v_uid uuid;
  v_next_gm public.group_memberships;
  v_next_member_id uuid;
  v_actor_next_group_id uuid := null;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_admin() or v_actor_group is null or v_actor_group is distinct from p_group_id then
    raise exception 'Only the active administrator of this group can delete it.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_actor_group;

  if not found then
    raise exception 'Savings group not found.' using errcode = 'P0002';
  end if;

  if lower(btrim(coalesce(p_confirm_name, ''))) <> lower(btrim(v_group.name)) then
    raise exception 'Group name confirmation does not match "%".', v_group.name using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct u.user_id), '{}'::uuid[])
  into v_affected_users
  from (
    select p.id as user_id
    from public.profiles p
    where p.group_id = v_actor_group and p.role <> 'SUPER_ADMIN'
    union
    select gm.user_id
    from public.group_memberships gm
    join public.profiles p on p.id = gm.user_id
    where gm.group_id = v_actor_group and p.role <> 'SUPER_ADMIN'
  ) u;

  delete from public.contributions where group_id = v_actor_group;
  delete from public.contribution_periods where group_id = v_actor_group;
  delete from public.expenses where group_id = v_actor_group;
  delete from public.withdrawals where group_id = v_actor_group;
  delete from public.savings_goals where group_id = v_actor_group;
  delete from public.contribution_settings where group_id = v_actor_group;

  update public.profiles
  set member_id = null
  where member_id in (select id from public.members where group_id = v_actor_group);

  update public.group_memberships
  set member_id = null
  where group_id = v_actor_group;

  delete from public.members where group_id = v_actor_group;

  foreach v_uid in array v_affected_users loop
    if exists (select 1 from public.profiles p where p.id = v_uid and p.group_id = v_actor_group) then
      select gm.* into v_next_gm
      from public.group_memberships gm
      join public.groups g on g.id = gm.group_id
      where gm.user_id = v_uid
        and gm.group_id <> v_actor_group
        and gm.status = 'ACTIVE'
        and g.status = 'ACTIVE'
      order by gm.created_at asc
      limit 1;

      if found then
        v_next_member_id := null;
        if v_next_gm.member_id is not null then
          select m.id into v_next_member_id
          from public.members m
          where m.id = v_next_gm.member_id
            and m.group_id = v_next_gm.group_id
            and m.status = 'ACTIVE'
            and m.deleted_at is null;
        end if;

        update public.profiles
        set group_id = v_next_gm.group_id,
            role = v_next_gm.role,
            member_id = v_next_member_id
        where id = v_uid;

        if v_uid = v_actor_id then
          v_actor_next_group_id := v_next_gm.group_id;
        end if;
      else
        update public.profiles
        set group_id = null,
            role = 'MEMBER',
            member_id = null
        where id = v_uid;
      end if;
    end if;

    if v_uid <> v_actor_id then
      perform public.push_notification(
        v_uid,
        'GROUP_DELETED',
        'Savings group deleted',
        '"' || v_group.name || '" was permanently deleted by its administrator.',
        'dashboard.html?notice=group-deleted',
        null
      );
    end if;
  end loop;

  delete from public.groups where id = v_actor_group;

  return jsonb_build_object(
    'deleted_group_id', v_actor_group,
    'deleted_group_name', v_group.name,
    'next_group_id', v_actor_next_group_id
  );
end;
$$;

revoke execute on function public.admin_delete_group(uuid, text) from public, anon;
grant execute on function public.admin_delete_group(uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261115_069', 'deep link targets for all notifications')
on conflict (version) do nothing;

commit;
