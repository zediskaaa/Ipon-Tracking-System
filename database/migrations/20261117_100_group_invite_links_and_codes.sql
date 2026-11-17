-- Group Invite Links & 6-Character Join Codes (with optional admin approval queue)
begin;

create table if not exists public.group_invite_codes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  code text not null,
  created_by uuid references public.profiles(id) on delete set null,
  require_approval boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  use_count integer not null default 0 check (use_count >= 0),
  max_uses integer check (max_uses is null or max_uses >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_invite_codes_format_chk check (code ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$')
);

create unique index if not exists group_invite_codes_code_uidx
  on public.group_invite_codes (code);

create unique index if not exists group_invite_codes_one_active_per_group_uidx
  on public.group_invite_codes (group_id)
  where revoked_at is null;

create index if not exists group_invite_codes_group_created_idx
  on public.group_invite_codes (group_id, created_at desc);

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  invite_code_id uuid references public.group_invite_codes(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists group_join_requests_one_pending_uidx
  on public.group_join_requests (group_id, user_id)
  where status = 'PENDING';

create index if not exists group_join_requests_group_status_idx
  on public.group_join_requests (group_id, status, created_at asc);

create index if not exists group_join_requests_user_status_idx
  on public.group_join_requests (user_id, status, created_at desc);

drop trigger if exists group_invite_codes_updated_at on public.group_invite_codes;
create trigger group_invite_codes_updated_at before update on public.group_invite_codes
  for each row execute function public.set_updated_at();

drop trigger if exists group_join_requests_updated_at on public.group_join_requests;
create trigger group_join_requests_updated_at before update on public.group_join_requests
  for each row execute function public.set_updated_at();

drop trigger if exists group_invite_codes_audit on public.group_invite_codes;
create trigger group_invite_codes_audit after insert or update or delete on public.group_invite_codes
  for each row execute function public.write_audit_log();

drop trigger if exists group_join_requests_audit on public.group_join_requests;
create trigger group_join_requests_audit after insert or update or delete on public.group_join_requests
  for each row execute function public.write_audit_log();

alter table public.group_invite_codes enable row level security;
alter table public.group_join_requests enable row level security;

drop policy if exists group_invite_codes_select on public.group_invite_codes;
create policy group_invite_codes_select on public.group_invite_codes
  for select to authenticated
  using (
    group_id = public.current_group_id()
    and public.is_admin()
  );

drop policy if exists group_join_requests_select on public.group_join_requests;
create policy group_join_requests_select on public.group_join_requests
  for select to authenticated
  using (
    user_id = auth.uid()
    or (group_id = public.current_group_id() and public.is_admin())
  );

do $$
begin
  alter publication supabase_realtime add table public.group_invite_codes;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.group_join_requests;
exception when duplicate_object then null;
end $$;

-- Update enforce_group_scope() to permit verified SECURITY DEFINER invite-code joins
create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
  v_old jsonb;
  v_new jsonb;
  v_sync_member_id uuid;
  v_sync_group_id uuid;
begin
  -- Retention cleanup (scheduled edge worker or super-admin sweep)
  if current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and (auth.uid() is null or public.is_super_admin()) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Annual archive roll-up deletes within the active admin's group
  if tg_op = 'DELETE' then
    if tg_table_name in ('contributions', 'withdrawals', 'expenses')
       and current_setting('ipon.maintenance_archive_rollup', true) = 'on'
       and pg_trigger_depth() <= 1
       and public.is_admin() then
      if old.group_id is not distinct from v_actor_group then
        return old;
      end if;
    end if;
  end if;

  -- 30-day savings cycle bin snapshots (both admin-initiated reset and scheduled dormant sweep)
  if tg_table_name in ('contribution_periods', 'contributions', 'withdrawals', 'expenses', 'record_comments', 'savings_goals')
     and current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and pg_trigger_depth() <= 1
     and (auth.uid() is null or public.is_admin()) then
    if auth.uid() is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'DELETE' then
      if old.group_id is not distinct from v_actor_group then
        return old;
      end if;
    else
      if new.group_id is not distinct from v_actor_group then
        return new;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Super-admin expired rejected/voided receipt purge
    if tg_table_name in ('contributions', 'expenses')
       and current_setting('ipon.maintenance_receipt_cleanup', true) = 'on'
       and pg_trigger_depth() <= 1
       and public.is_super_admin() then
      v_old := to_jsonb(old);
      v_new := to_jsonb(new);
      if (v_old ->> 'group_id') is not distinct from (v_new ->> 'group_id')
         and (v_old ->> 'amount') is not distinct from (v_new ->> 'amount')
         and (v_old ->> 'approval_status') is not distinct from (v_new ->> 'approval_status')
         and (v_old ->> 'approval_status') in ('REJECTED', 'VOIDED')
         and nullif(v_new ->> 'receipt_url', '') is null then
        return new;
      end if;
    end if;

    -- Table-specific guards for members (only compiled when tg_table_name = 'members')
    if tg_table_name = 'members' and pg_trigger_depth() <= 1 then
      if current_setting('ipon.activating_member_id', true) = new.id::text
         and old.group_id is not distinct from new.group_id
         and old.activation_status <> 'ACTIVE'
         and new.activation_status = 'ACTIVE' then
        return new;
      end if;

      if auth.uid() is not null
         and current_setting('ipon.syncing_own_profile_user_id', true) = auth.uid()::text
         and old.group_id is not distinct from new.group_id
         and (
           old.id = (select p.member_id from public.profiles p where p.id = auth.uid())
           or exists (
             select 1
             from public.group_memberships gm
             where gm.user_id = auth.uid()
               and gm.group_id = old.group_id
               and gm.status = 'ACTIVE'
               and gm.member_id = old.id
           )
         ) then
        return new;
      end if;

      if public.is_admin()
         and nullif(current_setting('ipon.syncing_member_profile_id', true), '') is not null
         and old.group_id is not distinct from new.group_id then
        begin
          v_sync_member_id := current_setting('ipon.syncing_member_profile_id', true)::uuid;
        exception when others then
          v_sync_member_id := null;
        end;
        if v_sync_member_id is not null then
          select m.group_id into v_sync_group_id
          from public.members m
          where m.id = v_sync_member_id and m.deleted_at is null;

          if v_sync_group_id is not distinct from v_actor_group
             and exists (
               select 1
               from (
                 select p.id as uid from public.profiles p where p.member_id = v_sync_member_id
                 union
                 select gm.user_id as uid from public.group_memberships gm where gm.member_id = v_sync_member_id and gm.status <> 'DISABLED'
               ) src
               join (
                 select p.id as uid from public.profiles p where p.member_id = old.id
                 union
                 select gm.user_id as uid from public.group_memberships gm where gm.member_id = old.id and gm.status <> 'DISABLED'
               ) dst on dst.uid = src.uid
             ) then
            return new;
          end if;
        end if;
      end if;
    end if;
  elsif tg_op = 'INSERT' then
    -- Initial period generation when activating a member across groups
    if tg_table_name = 'contribution_periods' and pg_trigger_depth() <= 1 then
      if current_setting('ipon.activating_member_id', true) = new.member_id::text then
        select group_id into v_row_group from public.members where id = new.member_id;
        new.group_id := v_row_group;
        return new;
      end if;
    end if;

    -- Verified SECURITY DEFINER invite-code join inserting member slot or initial period
    if tg_table_name in ('members', 'contribution_periods')
       and pg_trigger_depth() <= 1
       and auth.uid() is not null
       and nullif(current_setting('ipon.joining_group_id', true), '') is not null then
      if tg_table_name = 'members'
         and current_setting('ipon.joining_group_id', true) = new.group_id::text then
        return new;
      elsif tg_table_name = 'contribution_periods' then
        select group_id into v_row_group from public.members where id = new.member_id;
        if current_setting('ipon.joining_group_id', true) = v_row_group::text then
          new.group_id := v_row_group;
          return new;
        end if;
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    v_row_group := old.group_id;
  elsif tg_table_name = 'contribution_periods' then
    select group_id into v_row_group from public.members where id = new.member_id;
    new.group_id := v_row_group;
  elsif tg_table_name = 'contributions' then
    select group_id into v_row_group from public.contribution_periods where id = new.contribution_period_id;
    new.group_id := v_row_group;
  else
    new.group_id := coalesce(new.group_id, v_actor_group);
    v_row_group := new.group_id;
  end if;

  if v_actor_group is null or v_row_group is distinct from v_actor_group then
    raise exception 'You cannot access another savings group.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.group_id is distinct from new.group_id then
      raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.enforce_group_scope() from public, anon, authenticated;

-- Suppress redundant generic MEMBER_CREATED alert when invite-code flow sends its tailored join alert
create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_admin record;
begin
  if nullif(current_setting('ipon.joining_group_id', true), '') = new.group_id::text then
    return new;
  end if;
  for v_admin in select id from public.profiles where group_id = new.group_id and role = 'ADMIN' and status = 'ACTIVE' loop
    perform public.push_notification(v_admin.id, 'MEMBER_CREATED', 'Member registered', new.full_name || ' was added to your group.', 'members.html', new.group_id);
  end loop;
  return new;
end;
$$;

-- Revoke active invite codes and cancel pending join requests when switching workspace to SOLO
create or replace function public.update_group_profile(
  p_name text,
  p_avatar_url text default null,
  p_clear_avatar boolean default false,
  p_workspace_mode text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_name text := btrim(coalesce(p_name, ''));
  v_next_mode text := upper(nullif(btrim(coalesce(p_workspace_mode, '')), ''));
  v_current_mode text;
  v_other_users bigint;
  v_member_count bigint;
  v_own_member_id uuid;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can edit workspace details.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Workspace name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;
  if not public.is_valid_media_reference(p_avatar_url) then
    raise exception 'Workspace picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_next_mode is not null and v_next_mode not in ('SOLO', 'GROUP') then
    raise exception 'Workspace mode must be SOLO or GROUP.' using errcode = '22023';
  end if;

  select coalesce(workspace_mode, 'GROUP') into v_current_mode
  from public.groups
  where id = v_group_id;

  if not found then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;

  if v_next_mode = 'SOLO' and v_current_mode <> 'SOLO' then
    select count(*) into v_other_users
    from public.group_memberships
    where group_id = v_group_id
      and user_id <> auth.uid()
      and status <> 'DISABLED';

    select count(*) into v_member_count
    from public.members
    where group_id = v_group_id
      and deleted_at is null;

    select coalesce(gm.member_id, p.member_id) into v_own_member_id
    from public.profiles p
    left join public.group_memberships gm
      on gm.group_id = v_group_id
     and gm.user_id = p.id
    where p.id = auth.uid();

    if v_other_users > 0
       or v_member_count > 1
       or (v_member_count = 1 and not exists (
             select 1 from public.members m
             where m.group_id = v_group_id
               and m.deleted_at is null
               and m.id = v_own_member_id
           )) then
      raise exception 'Remove other members before switching this workspace to Solo savings.' using errcode = '22023';
    end if;
  end if;

  update public.groups
  set name = v_name,
      avatar_url = case
        when p_clear_avatar then null
        when p_avatar_url is not null then p_avatar_url
        else avatar_url
      end,
      workspace_mode = coalesce(v_next_mode, workspace_mode)
  where id = v_group_id;

  if v_next_mode = 'SOLO' then
    update public.group_invite_codes
    set revoked_at = coalesce(revoked_at, now())
    where group_id = v_group_id
      and revoked_at is null;

    update public.group_join_requests
    set status = 'CANCELLED',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = 'Workspace switched to Solo savings.'
    where group_id = v_group_id
      and status = 'PENDING';

    perform public.set_admin_contributor(true, null);
  end if;
end;
$$;

revoke all on function public.update_group_profile(text, text, boolean, text) from public, anon;
grant execute on function public.update_group_profile(text, text, boolean, text) to authenticated;

-- Internal helpers (not directly callable from clients)
create or replace function public._normalize_invite_code(p_code text)
returns text
language sql
immutable
as $$
  select regexp_replace(upper(coalesce(p_code, '')), '[^A-Z0-9]', '', 'g');
$$;

revoke all on function public._normalize_invite_code(text) from public, anon, authenticated;

create or replace function public._generate_unique_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code text;
  i integer;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    if v_attempt > 30 then
      raise exception 'Could not allocate a unique group invite code. Please try again.' using errcode = '55000';
    end if;
    v_bytes := decode(md5(gen_random_uuid()::text || clock_timestamp()::text || v_attempt::text), 'hex');
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    if not exists (select 1 from public.group_invite_codes c where c.code = v_code) then
      return v_code;
    end if;
  end loop;
end;
$$;

revoke all on function public._generate_unique_invite_code() from public, anon, authenticated;

create or replace function public._grant_group_member_via_invite(
  p_group_id uuid,
  p_user_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_group public.groups;
  v_target public.profiles;
  v_prev_gm public.group_memberships;
  v_link_member_id uuid;
  v_contact text;
  v_default_amount numeric(14, 2);
  v_amount numeric(14, 2);
  v_full text;
  v_first text;
  v_middle text;
  v_last text;
  v_has_signed_in boolean := false;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date;
  v_member public.members;
begin
  select * into v_group
  from public.groups
  where id = p_group_id and status = 'ACTIVE'
  for share;

  if not found then
    raise exception 'This savings group is no longer active.' using errcode = 'P0002';
  end if;

  if coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then
    raise exception 'Solo savings workspaces do not accept additional members.' using errcode = '42501';
  end if;

  select * into v_target
  from public.profiles
  where id = p_user_id;

  if not found or v_target.role = 'SUPER_ADMIN' then
    raise exception 'This account cannot join a savings group.' using errcode = '42501';
  end if;

  if v_target.status = 'DISABLED' then
    raise exception 'This account is disabled.' using errcode = '42501';
  end if;

  select * into v_prev_gm
  from public.group_memberships
  where group_id = p_group_id and user_id = p_user_id;

  if v_prev_gm.id is not null and v_prev_gm.status = 'DISABLED' then
    raise exception 'Your access to this savings group was disabled by an administrator.' using errcode = '42501';
  end if;

  if v_prev_gm.member_id is not null then
    select m.id into v_link_member_id
    from public.members m
    where m.id = v_prev_gm.member_id
      and m.group_id = p_group_id
      and m.deleted_at is null;
  end if;

  v_contact := case
    when btrim(coalesce(v_target.contact_number, '')) ~ '^(?:09|\+639)[0-9]{9}$'
      then nullif(public.normalize_ph_mobile(v_target.contact_number), '09000000000')
    else null
  end;

  if v_link_member_id is null then
    select m.id into v_link_member_id
    from public.members m
    where m.group_id = p_group_id
      and m.deleted_at is null
      and lower(btrim(m.full_name)) = lower(btrim(coalesce(v_target.full_name, '')))
      and not exists (
        select 1 from public.group_memberships gm
        where gm.group_id = p_group_id
          and gm.member_id = m.id
          and gm.user_id <> p_user_id
      )
    order by (coalesce(m.contact_number, '') = coalesce(v_contact, '')) desc,
             (m.activation_status = 'ACTIVE') desc,
             m.created_at desc
    limit 1;
  end if;

  select (
    p_user_id = auth.uid()
    or exists (select 1 from auth.users u where u.id = p_user_id and u.last_sign_in_at is not null)
  ) into v_has_signed_in;

  if v_link_member_id is null then
    select cs.default_amount into v_default_amount
    from public.contribution_settings cs
    where cs.group_id = p_group_id
    order by cs.effective_month desc
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

    perform set_config('ipon.joining_group_id', p_group_id::text, true);

    insert into public.members (
      group_id, first_name, middle_name, last_name, full_name,
      contact_number, payout_channel, payout_account_number, payout_account_name,
      date_registered, monthly_contribution_amount,
      status, activation_status, activated_at, notes, created_by, updated_by
    ) values (
      p_group_id,
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
      case when v_has_signed_in then 'ACTIVE' else 'PENDING' end,
      case when v_has_signed_in then now() else null end,
      'Joined via group invite link / code',
      coalesce(p_actor_id, p_user_id),
      coalesce(p_actor_id, p_user_id)
    ) returning * into v_member;

    v_link_member_id := v_member.id;

    if v_has_signed_in
       and exists (
         select 1
         from public.contribution_periods cp
         join public.members m2 on m2.id = cp.member_id
         where m2.group_id = p_group_id
           and m2.deleted_at is null
           and cp.period_month = v_month
       ) then
      insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
      values (
        v_link_member_id,
        v_month,
        v_amount,
        public.contribution_period_due_date(p_group_id, v_month)
      )
      on conflict (member_id, period_month) do nothing;
    end if;

    perform set_config('ipon.joining_group_id', '', true);
  else
    select * into v_member from public.members where id = v_link_member_id;
    if v_has_signed_in and v_member.activation_status <> 'ACTIVE' then
      perform public.activate_member_record(v_link_member_id, p_user_id);
    end if;
  end if;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (
    p_group_id,
    p_user_id,
    coalesce(v_prev_gm.role, 'MEMBER'::public.app_role),
    'ACTIVE',
    v_link_member_id
  )
  on conflict (group_id, user_id) do update
  set status = 'ACTIVE',
      member_id = coalesce(group_memberships.member_id, excluded.member_id);

  if v_target.group_id is null then
    update public.profiles
    set group_id = p_group_id,
        role = coalesce(v_prev_gm.role, 'MEMBER'::public.app_role),
        status = 'ACTIVE',
        member_id = case when coalesce(v_prev_gm.role, 'MEMBER'::public.app_role) in ('MEMBER', 'ADMIN') then v_link_member_id else null end
    where id = p_user_id;
  end if;

  return jsonb_build_object(
    'group_id', p_group_id,
    'group_name', v_group.name,
    'member_id', v_link_member_id,
    'role', coalesce(v_prev_gm.role, 'MEMBER'::public.app_role)
  );
end;
$$;

revoke all on function public._grant_group_member_via_invite(uuid, uuid, uuid) from public, anon, authenticated;

-- Admin: create or rotate group invite code (24h/7d/30d default 7d, optional approval toggle)
create or replace function public.create_group_invite_code(
  p_expires_hours integer default 168,
  p_require_approval boolean default false,
  p_max_uses integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_group public.groups;
  v_hours integer := coalesce(p_expires_hours, 168);
  v_max_uses integer := p_max_uses;
  v_code text;
  v_row public.group_invite_codes;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can generate invite links or codes.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Two-factor authentication is required before managing group invite links.' using errcode = '42501';
  end if;

  select * into v_group
  from public.groups
  where id = v_group_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active savings group not found.' using errcode = 'P0002';
  end if;
  if coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then
    raise exception 'Solo savings workspaces do not support invite links or group codes. Switch to Group savings first.' using errcode = '22023';
  end if;

  if v_hours < 1 or v_hours > 720 then
    raise exception 'Invite expiration must be between 1 hour and 30 days.' using errcode = '22023';
  end if;
  if v_max_uses is not null and (v_max_uses < 1 or v_max_uses > 500) then
    raise exception 'Maximum uses must be between 1 and 500.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('invite_code:' || v_group_id::text));

  update public.group_invite_codes
  set revoked_at = coalesce(revoked_at, now())
  where group_id = v_group_id
    and revoked_at is null;

  v_code := public._generate_unique_invite_code();

  insert into public.group_invite_codes (
    group_id, code, created_by, require_approval, expires_at, max_uses
  ) values (
    v_group_id,
    v_code,
    auth.uid(),
    coalesce(p_require_approval, false),
    now() + make_interval(hours => v_hours),
    v_max_uses
  ) returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'group_id', v_row.group_id,
    'code', v_row.code,
    'require_approval', v_row.require_approval,
    'expires_at', v_row.expires_at,
    'use_count', v_row.use_count,
    'max_uses', v_row.max_uses,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.create_group_invite_code(integer, boolean, integer) from public, anon;
grant execute on function public.create_group_invite_code(integer, boolean, integer) to authenticated;

-- Admin: update approval toggle / expiry or revoke an invite code
create or replace function public.update_group_invite_code(
  p_code_id uuid,
  p_require_approval boolean default null,
  p_revoke boolean default false,
  p_expires_hours integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_row public.group_invite_codes;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update invite links or codes.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Two-factor authentication is required before updating group invite settings.' using errcode = '42501';
  end if;

  select * into v_row
  from public.group_invite_codes
  where id = p_code_id
    and group_id = v_group_id
  for update;

  if not found then
    raise exception 'Invite code not found in your active savings group.' using errcode = 'P0002';
  end if;

  if p_revoke then
    update public.group_invite_codes
    set revoked_at = coalesce(revoked_at, now())
    where id = v_row.id
    returning * into v_row;

    return jsonb_build_object(
      'id', v_row.id,
      'revoked', true,
      'revoked_at', v_row.revoked_at
    );
  end if;

  if v_row.revoked_at is not null or v_row.expires_at <= now() then
    raise exception 'This invite code has already expired or been revoked. Generate a new code instead.' using errcode = '22023';
  end if;

  if p_expires_hours is not null and (p_expires_hours < 1 or p_expires_hours > 720) then
    raise exception 'Invite expiration must be between 1 hour and 30 days.' using errcode = '22023';
  end if;

  update public.group_invite_codes
  set require_approval = coalesce(p_require_approval, require_approval),
      expires_at = case
        when p_expires_hours is not null then now() + make_interval(hours => p_expires_hours)
        else expires_at
      end
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'group_id', v_row.group_id,
    'code', v_row.code,
    'require_approval', v_row.require_approval,
    'expires_at', v_row.expires_at,
    'use_count', v_row.use_count,
    'max_uses', v_row.max_uses,
    'revoked', false
  );
end;
$$;

revoke all on function public.update_group_invite_code(uuid, boolean, boolean, integer) from public, anon;
grant execute on function public.update_group_invite_code(uuid, boolean, boolean, integer) to authenticated;

-- Admin & Member: load active code + pending requests for admin, plus caller's own pending join requests
create or replace function public.get_group_invite_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid := public.current_group_id();
  v_is_admin boolean := public.is_admin();
  v_mode text := 'GROUP';
  v_active_code jsonb := null;
  v_pending_requests jsonb := '[]'::jsonb;
  v_my_requests jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', jr.id,
    'group_id', jr.group_id,
    'group_name', g.name,
    'group_avatar_url', g.avatar_url,
    'created_at', jr.created_at
  ) order by jr.created_at desc), '[]'::jsonb)
  into v_my_requests
  from public.group_join_requests jr
  join public.groups g on g.id = jr.group_id and g.status = 'ACTIVE'
  where jr.user_id = v_uid
    and jr.status = 'PENDING';

  if v_group_id is not null and v_is_admin then
    select coalesce(g.workspace_mode, 'GROUP') into v_mode
    from public.groups g
    where g.id = v_group_id;

    select jsonb_build_object(
      'id', c.id,
      'group_id', c.group_id,
      'code', c.code,
      'require_approval', c.require_approval,
      'expires_at', c.expires_at,
      'use_count', c.use_count,
      'max_uses', c.max_uses,
      'created_at', c.created_at
    )
    into v_active_code
    from public.group_invite_codes c
    where c.group_id = v_group_id
      and c.revoked_at is null
      and c.expires_at > now()
      and (c.max_uses is null or c.use_count < c.max_uses)
    order by c.created_at desc
    limit 1;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id', jr.id,
      'user_id', jr.user_id,
      'full_name', coalesce(nullif(btrim(p.full_name), ''), p.email, 'Member'),
      'email', p.email,
      'contact_number', p.contact_number,
      'avatar_url', p.avatar_url,
      'code', ic.code,
      'created_at', jr.created_at
    ) order by jr.created_at asc), '[]'::jsonb)
    into v_pending_requests
    from public.group_join_requests jr
    join public.profiles p on p.id = jr.user_id
    left join public.group_invite_codes ic on ic.id = jr.invite_code_id
    where jr.group_id = v_group_id
      and jr.status = 'PENDING';
  end if;

  return jsonb_build_object(
    'workspace_mode', coalesce(v_mode, 'GROUP'),
    'active_code', v_active_code,
    'pending_requests', v_pending_requests,
    'my_pending_requests', v_my_requests
  );
end;
$$;

revoke all on function public.get_group_invite_overview() from public, anon;
grant execute on function public.get_group_invite_overview() to authenticated;

-- Public (anon + auth): safe invite preview without exposing private financial records or rosters
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
        'reason', 'DISABLED',
        'message', 'Your access to this savings group was disabled by an administrator.'
      );
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

-- Authenticated user: join a savings group via invite code (instant or queued for admin approval)
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

-- Admin: approve or decline a pending join request
create or replace function public.review_group_join_request(
  p_request_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_note text := nullif(left(btrim(coalesce(p_review_note, '')), 300), '');
  v_req public.group_join_requests;
  v_group public.groups;
  v_requester public.profiles;
  v_grant jsonb;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can review join requests.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Two-factor authentication is required before reviewing join requests.' using errcode = '42501';
  end if;
  if v_decision not in ('APPROVED', 'DECLINED') then
    raise exception 'Decision must be APPROVED or DECLINED.' using errcode = '22023';
  end if;

  select * into v_req
  from public.group_join_requests
  where id = p_request_id
    and group_id = v_group_id
  for update;

  if not found then
    raise exception 'Join request not found in your active group.' using errcode = 'P0002';
  end if;
  if v_req.status <> 'PENDING' then
    raise exception 'This join request has already been processed.' using errcode = '22023';
  end if;

  select * into v_group
  from public.groups
  where id = v_req.group_id;

  select * into v_requester
  from public.profiles
  where id = v_req.user_id;

  if v_decision = 'DECLINED' then
    update public.group_join_requests
    set status = 'DECLINED',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_note = v_note
    where id = v_req.id;

    perform public.push_notification(
      v_req.user_id,
      'GROUP_JOIN_DECLINED',
      'Join request declined',
      'Your request to join "' || coalesce(v_group.name, 'this savings group') || '" was declined by an administrator.' || case when v_note is not null then ' Note: ' || v_note else '' end,
      null,
      v_req.group_id
    );

    return jsonb_build_object(
      'status', 'DECLINED',
      'request_id', v_req.id,
      'user_id', v_req.user_id
    );
  end if;

  if v_group.id is null or v_group.status <> 'ACTIVE' or coalesce(v_group.workspace_mode, 'GROUP') = 'SOLO' then
    raise exception 'Switch this workspace back to Group savings before approving new members.' using errcode = '22023';
  end if;

  v_grant := public._grant_group_member_via_invite(v_req.group_id, v_req.user_id, auth.uid());

  if v_req.invite_code_id is not null then
    update public.group_invite_codes
    set use_count = use_count + 1
    where id = v_req.invite_code_id;
  end if;

  update public.group_join_requests
  set status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = v_note
  where id = v_req.id;

  perform public.push_notification(
    v_req.user_id,
    'GROUP_JOIN_APPROVED',
    'Join request approved',
    'Your request to join "' || v_group.name || '" was approved! Open your workspace to get started.',
    'user.html',
    v_req.group_id
  );

  return jsonb_build_object(
    'status', 'APPROVED',
    'request_id', v_req.id,
    'user_id', v_req.user_id,
    'member_id', v_grant ->> 'member_id',
    'full_name', coalesce(v_requester.full_name, v_requester.email, 'Member')
  );
end;
$$;

revoke all on function public.review_group_join_request(uuid, text, text) from public, anon;
grant execute on function public.review_group_join_request(uuid, text, text) to authenticated;

-- Caller: withdraw own pending join request
create or replace function public.cancel_own_join_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  update public.group_join_requests
  set status = 'CANCELLED',
      reviewed_at = now(),
      review_note = 'Cancelled by requester.'
  where id = p_request_id
    and user_id = auth.uid()
    and status = 'PENDING';

  return found;
end;
$$;

revoke all on function public.cancel_own_join_request(uuid) from public, anon;
grant execute on function public.cancel_own_join_request(uuid) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261117_100', 'add group invite links, 6-char join codes, and optional approval queue')
on conflict (version) do nothing;

commit;
