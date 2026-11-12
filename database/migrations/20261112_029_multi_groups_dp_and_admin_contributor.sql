-- Migration 20261112_029: Multi-group workspaces, editable group name/DP, admin contributor toggle, and group memberships.
begin;

alter table public.groups
  drop constraint if exists groups_owner_id_key;

alter table public.groups
  add column if not exists avatar_url text;

alter table public.groups
  drop constraint if exists groups_avatar_url_check;

alter table public.groups
  add constraint groups_avatar_url_check
  check (avatar_url is null or (avatar_url ~ '^data:image/' and char_length(avatar_url) <= 600000));

create table if not exists public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null check (role in ('ADMIN', 'TREASURER', 'MEMBER')),
  status public.account_status not null default 'ACTIVE',
  member_id uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, user_id),
  unique (group_id, member_id)
);

create index if not exists group_memberships_user_status_idx
  on public.group_memberships (user_id, status);

drop trigger if exists group_memberships_updated_at on public.group_memberships;
create trigger group_memberships_updated_at before update on public.group_memberships
for each row execute function public.set_updated_at();

alter table public.group_memberships enable row level security;
alter table public.group_memberships force row level security;

drop policy if exists mfa_verified_for_opted_in on public.group_memberships;
create policy mfa_verified_for_opted_in on public.group_memberships
as restrictive for all to authenticated
using (public.mfa_access_allowed());

drop policy if exists group_memberships_select on public.group_memberships;
create policy group_memberships_select on public.group_memberships for select to authenticated
using (
  user_id = auth.uid()
  or public.is_super_admin()
  or (public.is_admin() and group_id = public.current_group_id())
);

-- Backfill existing profiles into group_memberships.
insert into public.group_memberships (group_id, user_id, role, status, member_id)
select p.group_id, p.id, p.role, p.status, p.member_id
from public.profiles p
where p.group_id is not null
  and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
on conflict (group_id, user_id) do update
set role = excluded.role,
    status = excluded.status,
    member_id = coalesce(public.group_memberships.member_id, excluded.member_id);

-- Allow authenticated users to inspect any active group they belong to.
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
using (
  public.is_super_admin()
  or id = public.current_group_id()
  or exists (
    select 1
    from public.group_memberships gm
    where gm.group_id = groups.id
      and gm.user_id = auth.uid()
      and gm.status = 'ACTIVE'
  )
);

-- Keep avatar resolution accurate across multiple groups via group_memberships.
create or replace function public.announcement_author_avatar(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.avatar_url
      from public.group_memberships gm
      join public.profiles p on p.id = gm.user_id
      where gm.user_id = p_author_id
        and gm.group_id = public.current_group_id()
        and gm.status = 'ACTIVE'
        and p.status = 'ACTIVE'
      limit 1
    ),
    (
      select p.avatar_url
      from public.profiles p
      where p.id = p_author_id
        and p.group_id = public.current_group_id()
        and p.status = 'ACTIVE'
      limit 1
    )
  );
$$;

create or replace function public.group_member_avatar(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.avatar_url
      from public.group_memberships gm
      join public.profiles p on p.id = gm.user_id
      join public.members m on m.id = gm.member_id
      where gm.member_id = p_member_id
        and gm.group_id = public.current_group_id()
        and gm.status = 'ACTIVE'
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
        and m.deleted_at is null
      limit 1
    ),
    (
      select p.avatar_url
      from public.profiles p
      join public.members m on m.id = p.member_id
      where p.member_id = p_member_id
        and p.group_id = public.current_group_id()
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
        and m.deleted_at is null
      limit 1
    ),
    (
      select p.avatar_url
      from public.members m
      join public.group_memberships gm
        on gm.group_id = m.group_id
       and gm.status = 'ACTIVE'
      join public.profiles p
        on p.id = gm.user_id
       and p.status = 'ACTIVE'
       and lower(btrim(p.full_name)) = lower(btrim(m.full_name))
      where m.id = p_member_id
        and m.group_id = public.current_group_id()
        and m.deleted_at is null
        and p.avatar_url is not null
      limit 1
    )
  );
$$;

-- Keep super_admin group creation / approval / update in sync with group_memberships.
create or replace function public.super_admin_create_group(p_name text, p_admin_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can create savings groups.' using errcode = '42501';
  end if;
  if nullif(btrim(p_name), '') is null then
    raise exception 'Group name is required.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_admin_id and role = 'ADMIN' and group_id is null
  ) then
    raise exception 'An unassigned administrator account is required.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id)
  values (btrim(p_name), p_admin_id)
  returning id into v_group_id;

  update public.profiles
  set group_id = v_group_id, status = 'ACTIVE'
  where id = p_admin_id;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_admin_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  return v_group_id;
end;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text := btrim(coalesce(p_group_name, ''));
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if char_length(v_group_name) < 2 or char_length(v_group_name) > 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;

  update public.profiles set role = 'ADMIN', status = 'ACTIVE', member_id = null
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;
  update public.profiles set group_id = v_group_id where id = p_user_id;
  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, p_user_id, 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE', member_id = null;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_APPROVED', 'Administrator access approved', 'Your administrator account and savings group are ready.', 'dashboard.html', v_group_id);
  perform public.push_notification(auth.uid(), 'ADMIN_CREATED', 'Administrator account created', v_group_name || ' is now active.', 'super-admin.html#administrators');
  return v_group_id;
end;
$$;

create or replace function public.super_admin_update_administrator(
  p_user_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_group_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.validated_name_part(p_first_name, 'First name');
  v_middle text := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last text := public.validated_name_part(p_last_name, 'Last name');
  v_target_group uuid;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can edit administrators.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_group_name, ''))) not between 2 and 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;
  update public.profiles set first_name = v_first, middle_name = v_middle, last_name = v_last, full_name = concat_ws(' ', v_first, v_middle, v_last)
  where id = p_user_id and role = 'ADMIN'
  returning group_id into v_target_group;
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups
  set name = btrim(p_group_name)
  where owner_id = p_user_id
    and id = coalesce(v_target_group, (select g.id from public.groups g where g.owner_id = p_user_id order by g.created_at asc limit 1));
end;
$$;

-- Multi-group-aware admin access assignment (supports existing accounts across groups too).
create or replace function public.admin_set_user_access(
  p_user_id uuid, p_role public.app_role, p_status public.account_status, p_member_id uuid default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor_role public.app_role := public.current_user_role();
  v_actor_group uuid := public.current_group_id();
  v_member public.members;
  v_target public.profiles;
  v_link_member_id uuid;
begin
  if v_actor_role = 'SUPER_ADMIN' then
    if p_role not in ('SUPER_ADMIN', 'ADMIN') or p_member_id is not null then raise exception 'Super administrators can only manage platform administrator accounts.' using errcode = '42501'; end if;
    if p_role = 'SUPER_ADMIN' and p_user_id <> auth.uid() then raise exception 'Additional super administrator accounts cannot be assigned here.' using errcode = '42501'; end if;
    if p_user_id = auth.uid() and (p_role <> 'SUPER_ADMIN' or p_status <> 'ACTIVE') then raise exception 'You cannot remove or disable your own super administrator access.' using errcode = '22023'; end if;
    update public.profiles set role = p_role, status = p_status, member_id = null
    where id = p_user_id and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
    if not found then raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002'; end if;
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

  -- Update active profile context only when this user has no other active group selected.
  if v_target.group_id is null or v_target.group_id = v_actor_group then
    update public.profiles
    set role = p_role,
        status = p_status,
        member_id = v_link_member_id,
        group_id = v_actor_group,
        first_name = coalesce(first_name, v_member.first_name),
        middle_name = coalesce(middle_name, v_member.middle_name),
        last_name = coalesce(last_name, v_member.last_name),
        full_name = coalesce(nullif(btrim(full_name), ''), v_member.full_name),
        contact_number = coalesce(contact_number, v_member.contact_number)
    where id = p_user_id;
  end if;
end;
$$;

-- List active groups that the signed-in user belongs to.
create or replace function public.get_my_groups()
returns table (
  group_id uuid,
  name text,
  avatar_url text,
  role public.app_role,
  status public.account_status,
  member_id uuid,
  is_current boolean,
  is_contributor boolean,
  active_member_count bigint,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select p.id, p.group_id as current_group_id, p.role as current_role, p.member_id as current_member_id
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'ACTIVE'
  ),
  my_groups as (
    select
      g.id as group_id,
      g.name,
      g.avatar_url,
      coalesce(gm.role, me.current_role) as role,
      coalesce(gm.status, 'ACTIVE'::public.account_status) as status,
      coalesce(gm.member_id, case when me.current_group_id = g.id then me.current_member_id else null end) as member_id,
      (me.current_group_id = g.id) as is_current,
      g.created_at
    from me
    join public.groups g on g.status = 'ACTIVE'
    left join public.group_memberships gm
      on gm.group_id = g.id
     and gm.user_id = me.id
    where (gm.id is not null and gm.status = 'ACTIVE')
       or g.id = me.current_group_id
  )
  select
    mg.group_id,
    mg.name,
    mg.avatar_url,
    mg.role,
    mg.status,
    mg.member_id,
    mg.is_current,
    exists (
      select 1
      from public.members m
      where m.id = mg.member_id
        and m.group_id = mg.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null
    ) as is_contributor,
    (
      select count(*)
      from public.members m
      where m.group_id = mg.group_id
        and m.status = 'ACTIVE'
        and m.deleted_at is null
    ) as active_member_count,
    mg.created_at
  from my_groups mg
  order by mg.is_current desc, mg.created_at asc;
$$;

-- Switch the active group context of the signed-in user.
create or replace function public.switch_active_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gm public.group_memberships;
  v_group public.groups;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles where id = auth.uid() and status = 'ACTIVE' and role <> 'SUPER_ADMIN'
  ) then
    raise exception 'Only active group users can switch workspaces.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = p_group_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active savings group not found.' using errcode = 'P0002';
  end if;

  select * into v_gm
  from public.group_memberships
  where group_id = p_group_id
    and user_id = auth.uid()
    and status = 'ACTIVE';

  if not found then
    raise exception 'You do not have active access to that group.' using errcode = '42501';
  end if;

  if v_gm.role = 'MEMBER' then
    v_member_id := v_gm.member_id;
  elsif v_gm.role = 'ADMIN' and v_gm.member_id is not null then
    select m.id into v_member_id
    from public.members m
    where m.id = v_gm.member_id
      and m.group_id = p_group_id
      and m.status = 'ACTIVE'
      and m.deleted_at is null;
  else
    v_member_id := null;
  end if;

  update public.profiles
  set group_id = v_gm.group_id,
      role = v_gm.role,
      member_id = v_member_id
  where id = auth.uid();

  return jsonb_build_object(
    'group_id', v_group.id,
    'name', v_group.name,
    'role', v_gm.role,
    'member_id', v_member_id
  );
end;
$$;

-- Allow group admins to edit group name and group chat display picture.
create or replace function public.update_group_profile(
  p_name text,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can edit group details.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  update public.groups
  set name = v_name,
      avatar_url = case
        when p_clear_avatar then null
        when p_avatar_url is not null then p_avatar_url
        else avatar_url
      end
  where id = v_group_id;

  if not found then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
end;
$$;

-- Toggle whether the current Group Admin also participates as a contributor in their active group.
create or replace function public.set_admin_contributor(
  p_enabled boolean,
  p_monthly_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_profile public.profiles;
  v_gm public.group_memberships;
  v_member_id uuid;
  v_default_amount numeric;
  v_amount numeric;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update contributor participation.' using errcode = '42501';
  end if;

  if p_monthly_amount is not null and (p_monthly_amount <= 0 or p_monthly_amount > 1000000) then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_group_id, auth.uid(), 'ADMIN', 'ACTIVE', v_profile.member_id)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE'
  returning * into v_gm;

  v_member_id := coalesce(v_profile.member_id, v_gm.member_id);

  if p_enabled then
    select cs.default_amount into v_default_amount
    from public.contribution_settings cs
    where cs.group_id = v_group_id
      and cs.effective_month <= date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date
    order by cs.effective_month desc
    limit 1;

    v_amount := round(coalesce(p_monthly_amount, v_default_amount, 100), 2);

    if v_member_id is not null then
      select m.id into v_member_id
      from public.members m
      where m.id = v_member_id
        and m.group_id = v_group_id
        and m.deleted_at is null;
    end if;

    if v_member_id is null then
      select m.id into v_member_id
      from public.members m
      where m.group_id = v_group_id
        and m.deleted_at is null
        and lower(btrim(m.full_name)) = lower(btrim(v_profile.full_name))
        and not exists (
          select 1 from public.group_memberships gm2
          where gm2.group_id = v_group_id and gm2.member_id = m.id and gm2.user_id <> auth.uid()
        )
        and not exists (
          select 1 from public.profiles p2
          where p2.group_id = v_group_id and p2.member_id = m.id and p2.id <> auth.uid()
        )
      order by m.created_at asc
      limit 1;
    end if;

    if v_member_id is not null then
      update public.members
      set status = 'ACTIVE',
          deactivated_at = null,
          monthly_contribution_amount = coalesce(p_monthly_amount, monthly_contribution_amount),
          updated_by = auth.uid()
      where id = v_member_id;
    else
      v_full := btrim(coalesce(nullif(v_profile.full_name, ''), split_part(coalesce(v_profile.email, 'Group Admin'), '@', 1)));
      v_first := coalesce(nullif(btrim(v_profile.first_name), ''), nullif(split_part(v_full, ' ', 1), ''), 'Group');
      v_middle := nullif(btrim(v_profile.middle_name), '');
      v_last := coalesce(nullif(btrim(v_profile.last_name), ''), nullif(btrim(substr(v_full, char_length(split_part(v_full, ' ', 1)) + 1)), ''), 'Admin');

      insert into public.members (
        group_id, first_name, middle_name, last_name, full_name,
        contact_number, date_registered, monthly_contribution_amount,
        status, notes, created_by
      ) values (
        v_group_id,
        v_first,
        v_middle,
        v_last,
        concat_ws(' ', v_first, v_middle, v_last),
        coalesce(nullif(btrim(v_profile.contact_number), ''), '09000000000'),
        (now() at time zone 'Asia/Manila')::date,
        v_amount,
        'ACTIVE',
        'Group administrator contributor',
        auth.uid()
      )
      returning id into v_member_id;
    end if;

    update public.group_memberships
    set member_id = v_member_id
    where group_id = v_group_id and user_id = auth.uid();

    update public.profiles
    set member_id = v_member_id
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', true, 'member_id', v_member_id);
  else
    if v_member_id is not null then
      update public.members
      set status = 'INACTIVE',
          deactivated_at = now(),
          updated_by = auth.uid()
      where id = v_member_id
        and group_id = v_group_id
        and deleted_at is null;
    end if;

    update public.profiles
    set member_id = null
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', false, 'member_id', null);
  end if;
end;
$$;

-- Allow an active Admin to create an additional savings group and immediately switch into it.
create or replace function public.admin_create_group(
  p_name text,
  p_avatar_url text default null,
  p_include_self boolean default true,
  p_monthly_amount numeric default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_new_group_id uuid;
  v_amount numeric := round(coalesce(p_monthly_amount, 100), 2);
begin
  if not public.is_admin() then
    raise exception 'Only a group administrator can create a savings group.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  if v_amount <= 0 or v_amount > 1000000 then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id, avatar_url, status)
  values (v_name, auth.uid(), p_avatar_url, 'ACTIVE')
  returning id into v_new_group_id;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_new_group_id, auth.uid(), 'ADMIN', 'ACTIVE', null);

  update public.profiles
  set group_id = v_new_group_id,
      role = 'ADMIN',
      member_id = null
  where id = auth.uid();

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_new_group_id, date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date, v_amount, auth.uid());

  if p_include_self then
    perform public.set_admin_contributor(true, v_amount);
  end if;

  return v_new_group_id;
end;
$$;

-- List user accounts belonging to the current active group for Settings -> Account access.
create or replace function public.get_group_access_list()
returns table (
  user_id uuid,
  full_name text,
  email text,
  role public.app_role,
  status public.account_status,
  member_id uuid,
  member_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    gm.user_id,
    p.full_name,
    p.email,
    gm.role,
    gm.status,
    gm.member_id,
    m.full_name as member_name
  from public.group_memberships gm
  join public.profiles p on p.id = gm.user_id
  left join public.members m on m.id = gm.member_id and m.deleted_at is null
  where public.is_admin()
    and gm.group_id = public.current_group_id()
    and p.role <> 'SUPER_ADMIN'
  order by
    case gm.role
      when 'ADMIN' then 0
      when 'TREASURER' then 1
      else 2
    end,
    p.full_name asc;
$$;

revoke execute on function public.announcement_author_avatar(uuid) from public, anon;
revoke execute on function public.group_member_avatar(uuid) from public, anon;
revoke execute on function public.get_my_groups() from public, anon;
revoke execute on function public.switch_active_group(uuid) from public, anon;
revoke execute on function public.update_group_profile(text, text, boolean) from public, anon;
revoke execute on function public.set_admin_contributor(boolean, numeric) from public, anon;
revoke execute on function public.admin_create_group(text, text, boolean, numeric) from public, anon;
revoke execute on function public.get_group_access_list() from public, anon;

grant execute on function public.announcement_author_avatar(uuid) to authenticated;
grant execute on function public.group_member_avatar(uuid) to authenticated;
grant execute on function public.get_my_groups() to authenticated;
grant execute on function public.switch_active_group(uuid) to authenticated;
grant execute on function public.update_group_profile(text, text, boolean) to authenticated;
grant execute on function public.set_admin_contributor(boolean, numeric) to authenticated;
grant execute on function public.admin_create_group(text, text, boolean, numeric) to authenticated;
grant execute on function public.get_group_access_list() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_029', 'multi groups, group dp, and admin contributor toggle')
on conflict (version) do nothing;

commit;
