-- Migration 20261114_046: Complete role-based notifications across multi-group admins, treasurers, members, announcements, feedback, and due reminder sync.
begin;

create or replace function public.group_admin_ids(p_group_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.id as user_id
  from (
    select gm.user_id as id
    from public.group_memberships gm
    where gm.group_id = p_group_id
      and gm.role = 'ADMIN'
      and gm.status = 'ACTIVE'
    union
    select p.id
    from public.profiles p
    where p.group_id = p_group_id
      and p.role = 'ADMIN'
      and p.status = 'ACTIVE'
    union
    select g.owner_id as id
    from public.groups g
    where g.id = p_group_id
      and g.owner_id is not null
  ) u
  join public.profiles p on p.id = u.id
  where p.status = 'ACTIVE'
    and p.notifications_enabled;
$$;

revoke execute on function public.group_admin_ids(uuid) from public, anon, authenticated;

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
        'dashboard.html',
        v_group
      );
    end loop;

    if new.submitted_by is not null then
      perform public.push_notification(
        new.submitted_by,
        'SUBMITTED',
        initcap(v_label) || ' submitted',
        'Your ' || v_label || ' (PHP ' || v_amount_text || ') is waiting for administrator review.',
        v_link,
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
        'user.html',
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
        v_link,
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
          'user.html',
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
        'dashboard.html',
        v_group
      );
    end loop;
  end if;
  return new;
end;
$$;

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
      'members.html',
      new.group_id
    );
  end loop;
  return new;
end;
$$;

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
      case when new.role = 'TREASURER' then 'dashboard.html' else 'user.html' end,
      new.group_id
    );
  end if;
  return new;
end;
$$;

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
      case when p_role = 'MEMBER' then 'user.html' else 'dashboard.html' end,
      v_actor_group
    );
  end if;
end;
$$;

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
    'dashboard.html',
    v_group_id
  );
  return v_group_id;
end;
$$;

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
      'settings.html',
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
        'settings.html',
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
      'super-admin.html#feature-requests'
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_feature_request_created() from public, anon, authenticated;

drop trigger if exists feature_requests_notifications on public.feature_requests;
create trigger feature_requests_notifications
  after insert on public.feature_requests
  for each row execute function public.notify_feature_request_created();

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
      'dashboard.html'
    );
  end if;

  return v_row;
end;
$$;

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
      'super-admin.html#bug-reports'
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_bug_report_created() from public, anon, authenticated;

drop trigger if exists bug_reports_notifications on public.bug_reports;
create trigger bug_reports_notifications
  after insert on public.bug_reports
  for each row execute function public.notify_bug_report_created();

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
        'dashboard.html',
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
        'dashboard.html',
        null
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke execute on function public.notify_announcement_created() from public, anon, authenticated;

drop trigger if exists announcements_notifications on public.announcements;
create trigger announcements_notifications
  after insert on public.announcements
  for each row execute function public.notify_announcement_created();

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
         'user.html'
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
         'user.html'
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

insert into public.schema_migrations (version, name)
values ('20261114_046', 'complete role-based notifications and due reminder sync')
on conflict (version) do nothing;

commit;
