begin;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 150),
  owner_id uuid unique references public.profiles(id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists group_id uuid references public.groups(id) on delete set null;
alter table public.members add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.contribution_settings add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.contribution_periods add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.contributions add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.expenses add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.withdrawals add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.savings_goals add column if not exists group_id uuid references public.groups(id) on delete restrict;
alter table public.audit_logs add column if not exists group_id uuid references public.groups(id) on delete set null;

do $$
declare
  v_group_id uuid;
  v_owner_id uuid;
begin
  select id into v_owner_id
  from public.profiles
  where role = 'ADMIN'
  order by (status = 'ACTIVE') desc, created_at, id
  limit 1;

  select id into v_group_id from public.groups order by created_at, id limit 1;

  if v_group_id is null and (
    v_owner_id is not null
    or exists (select 1 from public.members)
    or exists (select 1 from public.contributions)
    or exists (select 1 from public.expenses)
    or exists (select 1 from public.withdrawals)
  ) then
    insert into public.groups (name, owner_id)
    values ('Primary Savings Group', v_owner_id)
    returning id into v_group_id;
  end if;

  if v_group_id is not null then
    update public.profiles
    set group_id = v_group_id
    where group_id is null
      and (id = v_owner_id or role in ('TREASURER', 'MEMBER'));

    update public.members set group_id = v_group_id where group_id is null;
    update public.contribution_settings set group_id = v_group_id where group_id is null;
    update public.contribution_periods cp
    set group_id = m.group_id
    from public.members m
    where cp.member_id = m.id and cp.group_id is null;
    update public.contributions c
    set group_id = cp.group_id
    from public.contribution_periods cp
    where c.contribution_period_id = cp.id and c.group_id is null;
    update public.expenses set group_id = v_group_id where group_id is null;
    update public.withdrawals set group_id = v_group_id where group_id is null;
    update public.savings_goals set group_id = v_group_id where group_id is null;
  end if;
end $$;

alter table public.members alter column group_id set not null;
alter table public.contribution_settings alter column group_id set not null;
alter table public.contribution_periods alter column group_id set not null;
alter table public.contributions alter column group_id set not null;
alter table public.expenses alter column group_id set not null;
alter table public.withdrawals alter column group_id set not null;
alter table public.savings_goals alter column group_id set not null;

alter table public.contribution_settings drop constraint if exists contribution_settings_effective_month_key;
create unique index if not exists contribution_settings_group_month_unique
  on public.contribution_settings (group_id, effective_month);
create index if not exists profiles_group_idx on public.profiles (group_id);
create index if not exists members_group_idx on public.members (group_id);
create index if not exists contribution_periods_group_idx on public.contribution_periods (group_id, period_month);
create index if not exists contributions_group_idx on public.contributions (group_id, payment_date);
create index if not exists expenses_group_idx on public.expenses (group_id, transaction_date);
create index if not exists withdrawals_group_idx on public.withdrawals (group_id, transaction_date);
create index if not exists savings_goals_group_idx on public.savings_goals (group_id);
create index if not exists audit_logs_group_idx on public.audit_logs (group_id, changed_at desc);

create or replace function public.current_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id
  from public.profiles
  where id = auth.uid() and status = 'ACTIVE';
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() = 'SUPER_ADMIN', false);
$$;

create or replace function public.enforce_group_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_group uuid := public.current_group_id();
  v_row_group uuid;
begin
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
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'members', 'contribution_settings', 'contribution_periods', 'contributions',
    'expenses', 'withdrawals', 'savings_goals'
  ] loop
    execute format('drop trigger if exists %I_group_scope on public.%I', v_table, v_table);
    execute format(
      'create trigger %I_group_scope before insert or update or delete on public.%I for each row execute function public.enforce_group_scope()',
      v_table,
      v_table
    );
  end loop;
end $$;

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
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '') is not null
     and nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '') is not null then
    v_first_name := public.validated_name_part(new.raw_user_meta_data ->> 'first_name', 'First name');
    v_middle_name := public.validated_name_part(new.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
    v_last_name := public.validated_name_part(new.raw_user_meta_data ->> 'last_name', 'Last name');
    v_full_name := concat_ws(' ', v_first_name, v_middle_name, v_last_name);
  else
    v_full_name := case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2
        then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2
        then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end;
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, 'MEMBER', 'PENDING')
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.write_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_action text := tg_op;
  v_record_id uuid;
  v_group_id uuid;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  v_record_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  v_group_id := coalesce((v_new ->> 'group_id')::uuid, (v_old ->> 'group_id')::uuid);

  if tg_op = 'UPDATE' and v_old ->> 'approval_status' is distinct from v_new ->> 'approval_status' then
    v_action := case v_new ->> 'approval_status'
      when 'CONFIRMED' then 'CONFIRM'
      when 'REJECTED' then 'REJECT'
      when 'VOIDED' then 'VOID'
      else 'UPDATE'
    end;
  end if;

  insert into public.audit_logs (group_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (v_group_id, tg_table_name, v_record_id, v_action, v_old, v_new, auth.uid());

  if tg_op = 'DELETE' then
    return old;
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
    where id = p_user_id
      and (
        (role = 'SUPER_ADMIN' and id = auth.uid())
        or role = 'ADMIN'
        or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null)
      );
  elsif v_actor_role = 'ADMIN' and v_actor_group is not null then
    if p_user_id = auth.uid() or p_role <> 'MEMBER' then
      raise exception 'Group administrators can only manage member accounts in their own group.' using errcode = '42501';
    end if;
    if p_member_id is not null and not exists (
      select 1 from public.members where id = p_member_id and group_id = v_actor_group
    ) then
      raise exception 'The selected member does not belong to your savings group.' using errcode = '42501';
    end if;

    update public.profiles
    set role = 'MEMBER', status = p_status, member_id = p_member_id, group_id = v_actor_group
    where id = p_user_id
      and role = 'MEMBER'
      and (group_id is null or group_id = v_actor_group);
  else
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;

  if not found then
    raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002';
  end if;
end;
$$;

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

  return v_group_id;
end;
$$;

drop trigger if exists groups_updated_at on public.groups;
create trigger groups_updated_at before update on public.groups
  for each row execute function public.set_updated_at();
drop trigger if exists groups_audit on public.groups;
create trigger groups_audit after insert or update or delete on public.groups
  for each row execute function public.write_audit_log();

create or replace function public.set_contribution_setting(
  p_effective_month date,
  p_default_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_effective_month)::date;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can change contribution settings.' using errcode = '42501';
  end if;

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_group_id, v_month, public.validated_money(p_default_amount, 'Default amount'), auth.uid())
  on conflict (group_id, effective_month) do update set
    default_amount = excluded.default_amount,
    created_by = auth.uid(),
    created_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.generate_contribution_periods(p_month date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_month date := date_trunc('month', p_month)::date;
begin
  if not public.is_treasurer_or_admin() or public.current_group_id() is null then
    raise exception 'You are not allowed to generate contribution periods.' using errcode = '42501';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount)
  select id, v_month, monthly_contribution_amount
  from public.members
  where status = 'ACTIVE'
    and group_id = public.current_group_id()
    and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_savings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not public.is_treasurer_or_admin() or public.current_group_id() is null then null
    else jsonb_build_object(
      'total_additions', (select coalesce(sum(amount), 0) from public.contributions where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'total_deductions', (select coalesce(sum(amount), 0) from public.withdrawals where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'total_expenses', (select coalesce(sum(amount), 0) from public.expenses where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'tracked_savings',
        (select coalesce(sum(amount), 0) from public.contributions where group_id = public.current_group_id() and approval_status = 'CONFIRMED')
        - (select coalesce(sum(amount), 0) from public.withdrawals where group_id = public.current_group_id() and approval_status = 'CONFIRMED')
        - (select coalesce(sum(amount), 0) from public.expenses where group_id = public.current_group_id() and approval_status = 'CONFIRMED'),
      'pending_entries',
        (select count(*) from public.contributions where group_id = public.current_group_id() and approval_status = 'PENDING')
        + (select count(*) from public.withdrawals where group_id = public.current_group_id() and approval_status = 'PENDING')
        + (select count(*) from public.expenses where group_id = public.current_group_id() and approval_status = 'PENDING')
    )
  end;
$$;

alter table public.groups enable row level security;

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
using (public.is_super_admin() or id = public.current_group_id());

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or (public.is_admin() and group_id = public.current_group_id())
);

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
  and (public.is_treasurer_or_admin() or id = public.current_member_id())
);

drop policy if exists contribution_settings_select on public.contribution_settings;
create policy contribution_settings_select on public.contribution_settings for select to authenticated
using (group_id = public.current_group_id() and public.current_user_role() <> 'SUPER_ADMIN');

drop policy if exists contribution_periods_select on public.contribution_periods;
create policy contribution_periods_select on public.contribution_periods for select to authenticated
using (
  group_id = public.current_group_id()
  and (public.is_treasurer_or_admin() or member_id = public.current_member_id())
);

drop policy if exists contributions_select on public.contributions;
create policy contributions_select on public.contributions for select to authenticated
using (
  group_id = public.current_group_id()
  and (
    public.is_treasurer_or_admin()
    or exists (
      select 1 from public.contribution_periods cp
      where cp.id = contribution_period_id and cp.member_id = public.current_member_id()
    )
  )
);

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
using (group_id = public.current_group_id() and public.is_treasurer_or_admin());

drop policy if exists withdrawals_select on public.withdrawals;
create policy withdrawals_select on public.withdrawals for select to authenticated
using (
  group_id = public.current_group_id()
  and (public.is_treasurer_or_admin() or submitted_by = auth.uid())
);

drop policy if exists savings_goals_select on public.savings_goals;
create policy savings_goals_select on public.savings_goals for select to authenticated
using (group_id = public.current_group_id() and public.current_user_role() <> 'SUPER_ADMIN');

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
using (
  (public.is_super_admin() and table_name in ('profiles', 'groups'))
  or (public.is_admin() and group_id = public.current_group_id())
);

revoke all on public.groups from public, anon, authenticated;
grant select on public.groups to authenticated;
revoke execute on function public.current_group_id() from public, anon;
revoke execute on function public.is_super_admin() from public, anon;
revoke execute on function public.enforce_group_scope() from public, anon;
revoke execute on function public.super_admin_create_group(text, uuid) from public, anon;
grant execute on function public.current_group_id() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.super_admin_create_group(text, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261110_005', 'isolate savings data by group')
on conflict (version) do nothing;

commit;
