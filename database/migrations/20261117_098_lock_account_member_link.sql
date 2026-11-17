-- Prevent reassigning an already-linked member login to a different member profile
-- and auto-link/create a member profile when promoting an unlinked account (e.g., Treasurer -> Member).
begin;

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
  v_existing_member_id uuid;
  v_link_member_id uuid;
  v_group_name text := 'your savings group';
  v_group_mode text := 'GROUP';
  v_default_amount numeric(14, 2);
  v_amount numeric(14, 2);
  v_full text;
  v_first text;
  v_middle text;
  v_last text;
  v_contact text;
  v_has_signed_in boolean := false;
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

  select name, coalesce(workspace_mode, 'GROUP') into v_group_name, v_group_mode
  from public.groups
  where id = v_actor_group;
  v_group_name := coalesce(nullif(btrim(v_group_name), ''), 'your savings group');

  if v_group_mode = 'SOLO' and p_status <> 'DISABLED' then
    raise exception 'Solo savings workspaces do not accept member or treasurer invitations. Switch to Group savings in Group settings first.' using errcode = '42501';
  end if;

  if p_user_id = auth.uid() or p_role not in ('MEMBER', 'TREASURER') then
    raise exception 'Group administrators can only manage member and treasurer accounts in their own group.' using errcode = '42501';
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

  if v_prev_membership.member_id is not null then
    select m.id into v_existing_member_id
    from public.members m
    where m.id = v_prev_membership.member_id
      and m.group_id = v_actor_group
      and m.deleted_at is null;
  end if;

  v_contact := case
    when btrim(coalesce(v_target.contact_number, '')) ~ '^(?:09|\+639)[0-9]{9}$'
      then nullif(public.normalize_ph_mobile(v_target.contact_number), '09000000000')
    else null
  end;

  if p_role = 'MEMBER' then
    if v_existing_member_id is not null then
      if p_member_id is not null and p_member_id <> v_existing_member_id then
        raise exception 'A linked member login cannot be reassigned to a different member profile.' using errcode = '22023';
      end if;
      v_link_member_id := v_existing_member_id;
    elsif p_member_id is not null then
      v_link_member_id := p_member_id;
    else
      -- Reconnect to an existing unlinked member row with the same name in this group (e.g. Member -> Treasurer -> Member)
      select m.id into v_link_member_id
      from public.members m
      where m.group_id = v_actor_group
        and m.deleted_at is null
        and lower(btrim(m.full_name)) = lower(btrim(coalesce(v_target.full_name, '')))
        and not exists (
          select 1 from public.group_memberships gm
          where gm.group_id = v_actor_group
            and gm.member_id = m.id
            and gm.user_id <> p_user_id
        )
      order by (coalesce(m.contact_number, '') = coalesce(v_contact, '')) desc,
               (m.activation_status = 'ACTIVE') desc,
               m.created_at desc
      limit 1;

      -- Or auto-create a member profile when activating an unlinked account as MEMBER
      if v_link_member_id is null and p_status = 'ACTIVE' then
        select default_amount into v_default_amount
        from public.contribution_settings
        where group_id = v_actor_group
        order by effective_month desc
        limit 1;

        v_amount := round(coalesce(v_default_amount, 100), 2);
        v_full := coalesce(nullif(btrim(v_target.full_name), ''), 'Group Member');
        v_first := coalesce(nullif(btrim(v_target.first_name), ''), split_part(v_full, ' ', 1));
        v_middle := nullif(btrim(v_target.middle_name), '');
        v_last := coalesce(
          nullif(btrim(v_target.last_name), ''),
          nullif(btrim(substr(v_full, char_length(split_part(v_full, ' ', 1)) + 1)), ''),
          'Member'
        );

        insert into public.members (
          group_id, first_name, middle_name, last_name, full_name,
          contact_number, payout_channel, payout_account_number, payout_account_name,
          date_registered, monthly_contribution_amount,
          status, activation_status, activated_at, notes, created_by
        ) values (
          v_actor_group,
          v_first,
          v_middle,
          v_last,
          left(concat_ws(' ', v_first, v_middle, v_last), 150),
          v_contact,
          v_target.payout_channel,
          v_target.payout_account_number,
          v_target.payout_account_name,
          (now() at time zone 'Asia/Manila')::date,
          v_amount,
          'ACTIVE',
          'PENDING',
          null,
          'Member profile created from account access',
          auth.uid()
        ) returning id into v_link_member_id;
      end if;
    end if;
  else
    v_link_member_id := null;
  end if;

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

  if p_status = 'ACTIVE' and v_link_member_id is not null then
    select exists (
      select 1 from auth.users u where u.id = p_user_id and u.last_sign_in_at is not null
    ) into v_has_signed_in;
    if v_has_signed_in then
      perform public.activate_member_record(v_link_member_id, p_user_id);
    end if;
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

revoke all on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) from public, anon;
grant execute on function public.admin_set_user_access(uuid, public.app_role, public.account_status, uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261117_098', 'lock linked member on account access and auto-link unlinked promotions')
on conflict (version) do nothing;

commit;
