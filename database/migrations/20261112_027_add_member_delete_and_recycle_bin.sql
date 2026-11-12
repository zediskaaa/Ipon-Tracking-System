-- 027: Add member soft delete with reason + 1-month recycle bin recovery for deleted members and announcements

begin;

alter table public.members
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

alter table public.profiles
  add column if not exists previous_account_status public.account_status;

alter table public.announcements
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delete_reason text;

create index if not exists members_group_active_idx
  on public.members (group_id, full_name)
  where deleted_at is null;

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
  and deleted_at is null
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  deleted_at is null
  and (
    (public.is_super_admin() and group_id is null)
    or (
      public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and (
        group_id is null
        or (public.current_group_id() is not null and group_id = public.current_group_id())
      )
    )
  )
);

create or replace view public.v_contribution_status
with (security_invoker = true)
as
select
  cp.id as contribution_period_id,
  cp.member_id,
  m.full_name as member_name,
  cp.period_month,
  cp.required_amount,
  coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as paid_amount,
  greatest(cp.required_amount - coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0), 0)::numeric(14,2) as outstanding_amount,
  greatest(coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) - cp.required_amount, 0)::numeric(14,2) as overpaid_amount,
  case
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = 0 then 'UNPAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) < cp.required_amount then 'PARTIALLY PAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = cp.required_amount then 'PAID'
    else 'OVERPAID'
  end as payment_status
from public.contribution_periods cp
join public.members m on m.id = cp.member_id
left join public.contributions c on c.contribution_period_id = cp.id
where m.deleted_at is null
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount;

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
      join public.profiles p
        on p.group_id = m.group_id
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

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name,
       m.id as subject_member_id,
       public.group_member_avatar(m.id) as subject_avatar_url
from public.contributions c
join public.contribution_periods cp on cp.id = c.contribution_period_id
join public.members m on m.id = cp.member_id
where m.deleted_at is null
  and c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at,
       w.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

create or replace function public.update_member(
  p_member_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_monthly_contribution_amount numeric,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first_name text;
  v_middle_name text;
  v_last_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can update members.' using errcode = '42501';
  end if;

  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  update public.members
  set full_name = concat_ws(' ', v_first_name, v_middle_name, v_last_name),
      first_name = v_first_name,
      middle_name = v_middle_name,
      last_name = v_last_name,
      contact_number = public.normalize_ph_mobile(p_contact_number),
      monthly_contribution_amount = public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'),
      notes = nullif(btrim(p_notes), ''),
      updated_by = auth.uid()
  where id = p_member_id
    and group_id = public.current_group_id()
    and deleted_at is null;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.deactivate_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can deactivate members.' using errcode = '42501';
  end if;

  update public.members
  set status = 'INACTIVE', deactivated_at = now(), updated_by = auth.uid()
  where id = p_member_id
    and group_id = public.current_group_id()
    and status = 'ACTIVE'
    and deleted_at is null;

  if not found then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.reactivate_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can reactivate members.' using errcode = '42501';
  end if;

  update public.members
  set status = 'ACTIVE',
      updated_by = auth.uid()
  where id = p_member_id
    and group_id = public.current_group_id()
    and status = 'INACTIVE'
    and deleted_at is null;

  if not found then
    raise exception 'Inactive member not found in your group.' using errcode = 'P0002';
  end if;
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
  v_group_id uuid := public.current_group_id();
  v_due_date date;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can generate contribution periods.' using errcode = '42501';
  end if;

  v_due_date := public.contribution_period_due_date(v_group_id, v_month);

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select id, v_month, monthly_contribution_amount, v_due_date
  from public.members
  where status = 'ACTIVE'
    and deleted_at is null
    and group_id = v_group_id
    and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.generate_all_contribution_periods(p_month date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_count integer;
begin
  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select
    m.id,
    v_month,
    m.monthly_contribution_amount,
    public.contribution_period_due_date(m.group_id, v_month)
  from public.members m
  where m.status = 'ACTIVE'
    and m.deleted_at is null
    and m.date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.record_contribution(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns uuid
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_period_id uuid;
  v_required numeric(14,2);
  v_id uuid;
  v_status public.approval_status;
  v_month date := date_trunc('month', p_contribution_month)::date;
begin
  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;

  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  values (
    p_member_id,
    v_month,
    v_required,
    public.contribution_period_due_date(v_group_id, v_month)
  )
  on conflict (member_id, period_month) do nothing;

  select id into v_period_id
  from public.contribution_periods
  where member_id = p_member_id and period_month = v_month;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.contributions (
    contribution_period_id, amount, payment_date, transaction_reference,
    idempotency_key, notes, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    v_period_id, public.validated_money(p_amount, 'Contribution amount'), p_payment_date,
    nullif(btrim(p_transaction_reference), ''), p_idempotency_key,
    nullif(btrim(p_notes), ''), v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.delete_announcement(uuid);

create or replace function public.delete_announcement(
  p_announcement_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if public.current_user_role() not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only the Owner or a Group Administrator can delete announcements.' using errcode = '42501';
  end if;

  select * into v_row
  from public.announcements
  where id = p_announcement_id and deleted_at is null;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  if not (public.is_super_admin() or (v_row.author_role = 'ADMIN' and v_row.group_id = public.current_group_id())) then
    raise exception 'You are not allowed to delete this announcement.' using errcode = '42501';
  end if;

  update public.announcements
  set deleted_at = now(),
      deleted_by = auth.uid(),
      delete_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_announcement_id;

  return coalesce(v_row.attachments, '[]'::jsonb);
end;
$$;

create or replace function public.delete_member(
  p_member_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_member public.members;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can delete members.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Please select or enter a deletion reason between 3 and 500 characters.' using errcode = '22023';
  end if;

  select * into v_member
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Member not found.' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    where cp.member_id = p_member_id
  ) then
    raise exception 'Members with contribution data cannot be deleted. Deactivate this member instead.' using errcode = 'P0001';
  end if;

  update public.members
  set deleted_at = now(),
      deleted_by = auth.uid(),
      delete_reason = v_reason,
      updated_by = auth.uid()
  where id = p_member_id;

  update public.profiles
  set previous_account_status = case
        when status <> 'DISABLED' then status
        else coalesce(previous_account_status, status)
      end,
      status = 'DISABLED'
  where member_id = p_member_id
    and group_id = v_group_id
    and role = 'MEMBER';
end;
$$;

create or replace function public.get_bin_items(p_type text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := nullif(lower(btrim(coalesce(p_type, ''))), '');
  v_cutoff timestamptz := now() - interval '1 month';
  v_items jsonb;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can view the bin.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_type is not null and v_type not in ('member', 'announcement') then
    raise exception 'Invalid bin item filter.' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(row_to_json(entry)::jsonb order by entry.deleted_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      'member'::text as item_type,
      'Member'::text as type_label,
      m.id as item_id,
      m.full_name as title,
      concat_ws(
        ' · ',
        m.status::text,
        nullif(m.contact_number, ''),
        'Registered ' || to_char(m.date_registered, 'Mon DD, YYYY')
      ) as subtitle,
      coalesce(m.delete_reason, 'No reason provided') as reason,
      coalesce(dp.full_name, 'Group Administrator') as deleted_by_name,
      m.deleted_at,
      (m.deleted_at + interval '1 month') as expires_at
    from public.members m
    left join public.profiles dp on dp.id = m.deleted_by
    where m.group_id = v_group_id
      and m.deleted_at is not null
      and m.deleted_at >= v_cutoff
      and (v_type is null or v_type = 'member')

    union all

    select
      'announcement'::text as item_type,
      'Announcement'::text as type_label,
      a.id as item_id,
      a.title,
      left(btrim(a.description), 110)
        || case when char_length(btrim(a.description)) > 110 then '…' else '' end as subtitle,
      coalesce(a.delete_reason, 'Removed from announcements') as reason,
      coalesce(dp.full_name, a.author_name, 'Group Administrator') as deleted_by_name,
      a.deleted_at,
      (a.deleted_at + interval '1 month') as expires_at
    from public.announcements a
    left join public.profiles dp on dp.id = a.deleted_by
    where a.group_id = v_group_id
      and a.author_role = 'ADMIN'
      and a.deleted_at is not null
      and a.deleted_at >= v_cutoff
      and char_length(btrim(a.title)) > 0
      and char_length(btrim(a.description)) > 0
      and (v_type is null or v_type = 'announcement')
  ) entry;

  return v_items;
end;
$$;

create or replace function public.recover_bin_item(
  p_item_type text,
  p_item_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_type text := lower(btrim(coalesce(p_item_type, '')));
  v_cutoff timestamptz := now() - interval '1 month';
  v_member public.members;
  v_announcement public.announcements;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can recover deleted items.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if v_type = 'member' then
    select * into v_member
    from public.members
    where id = p_item_id
      and group_id = v_group_id
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted member not found in bin.' using errcode = 'P0002';
    end if;

    if v_member.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    update public.members
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null,
        updated_by = auth.uid()
    where id = p_item_id;

    update public.profiles
    set status = coalesce(previous_account_status, status),
        previous_account_status = null
    where member_id = p_item_id
      and group_id = v_group_id
      and role = 'MEMBER'
      and previous_account_status is not null;
  elsif v_type = 'announcement' then
    select * into v_announcement
    from public.announcements
    where id = p_item_id
      and group_id = v_group_id
      and author_role = 'ADMIN'
      and deleted_at is not null
    for update;

    if not found then
      raise exception 'Deleted announcement not found in bin.' using errcode = 'P0002';
    end if;

    if v_announcement.deleted_at < v_cutoff then
      raise exception 'This item can no longer be recovered because it passed the 1-month limit.' using errcode = 'P0001';
    end if;

    if char_length(btrim(coalesce(v_announcement.title, ''))) = 0
       or char_length(btrim(coalesce(v_announcement.description, ''))) = 0 then
      raise exception 'This announcement can no longer be recovered.' using errcode = 'P0001';
    end if;

    update public.announcements
    set deleted_at = null,
        deleted_by = null,
        delete_reason = null
    where id = p_item_id;
  else
    raise exception 'Unsupported bin item type.' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.delete_announcement(uuid, text) from public, anon;
grant execute on function public.delete_announcement(uuid, text) to authenticated;

revoke execute on function public.delete_member(uuid, text) from public, anon;
grant execute on function public.delete_member(uuid, text) to authenticated;

revoke execute on function public.get_bin_items(text) from public, anon;
grant execute on function public.get_bin_items(text) to authenticated;

revoke execute on function public.recover_bin_item(text, uuid) from public, anon;
grant execute on function public.recover_bin_item(text, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_027', 'add member soft delete and recycle bin')
on conflict (version) do nothing;

commit;
