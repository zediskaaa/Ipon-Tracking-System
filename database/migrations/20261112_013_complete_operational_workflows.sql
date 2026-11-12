-- Complete reversible member access, treasurer provisioning, request recovery, scheduled periods, and bounded review summaries.

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
      and ((role = 'SUPER_ADMIN' and id = auth.uid()) or role = 'ADMIN' or (p_role = 'ADMIN' and role = 'MEMBER' and group_id is null and member_id is null));
  elsif v_actor_role = 'ADMIN' and v_actor_group is not null then
    if p_user_id = auth.uid() or p_role not in ('MEMBER', 'TREASURER') then
      raise exception 'Group administrators can only manage member and treasurer accounts in their own group.' using errcode = '42501';
    end if;
    if p_role = 'MEMBER' and p_status = 'ACTIVE' and p_member_id is null then
      raise exception 'Active member accounts must be linked to a member.' using errcode = '22023';
    end if;
    if p_role = 'TREASURER' and p_member_id is not null then
      raise exception 'Treasurer accounts cannot be linked to a member profile.' using errcode = '22023';
    end if;
    if p_member_id is not null and not exists (select 1 from public.members where id = p_member_id and group_id = v_actor_group) then
      raise exception 'The selected member does not belong to your savings group.' using errcode = '42501';
    end if;
    update public.profiles
    set role = p_role, status = p_status, member_id = case when p_role = 'MEMBER' then p_member_id end, group_id = v_actor_group
    where id = p_user_id and role in ('MEMBER', 'TREASURER') and (group_id is null or group_id = v_actor_group);
  else
    raise exception 'You are not allowed to change user access.' using errcode = '42501';
  end if;
  if not found then raise exception 'User profile not found in your permitted account scope.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.reactivate_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Only an administrator can reactivate members.' using errcode = '42501'; end if;
  update public.members set status = 'ACTIVE'
  where id = p_member_id and group_id = public.current_group_id() and status = 'INACTIVE';
  if not found then raise exception 'Inactive member not found in your group.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.super_admin_reopen_request(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reopen administrator requests.' using errcode = '42501'; end if;
  update public.profiles set status = 'PENDING'
  where id = p_user_id and role = 'MEMBER' and status = 'DISABLED' and group_id is null and member_id is null;
  if not found then raise exception 'Rejected administrator request not found.' using errcode = 'P0002'; end if;
  update public.admin_requests set status = 'PENDING', reviewed_by = null, reviewed_at = null, review_note = null
  where requester_id = p_user_id and status = 'REJECTED';
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
  select m.id, v_month, m.monthly_contribution_amount,
    make_date(extract(year from v_month)::integer, extract(month from v_month)::integer, coalesce(s.deadline_day, 28))
  from public.members m
  left join lateral (
    select cs.deadline_day from public.contribution_settings cs
    where cs.group_id = m.group_id and cs.effective_month <= v_month
    order by cs.effective_month desc limit 1
  ) s on true
  where m.status = 'ACTIVE' and m.date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_pending_review_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with entries as (
    select id, amount, payment_date as activity_date, created_at, 'contribution'::text as entry_type from public.contributions where group_id = public.current_group_id() and approval_status = 'PENDING'
    union all
    select id, amount, transaction_date, created_at, 'withdrawal' from public.withdrawals where group_id = public.current_group_id() and approval_status = 'PENDING'
    union all
    select id, amount, transaction_date, created_at, 'expense' from public.expenses where group_id = public.current_group_id() and approval_status = 'PENDING'
  ), recent as (select * from entries order by created_at desc limit 3)
  select case when public.current_user_role() in ('ADMIN', 'TREASURER') then jsonb_build_object(
    'count', (select count(*) from entries),
    'amount', (select coalesce(sum(amount), 0) from entries),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'amount', amount, 'date', activity_date, 'type', entry_type) order by created_at desc) from recent), '[]'::jsonb)
  ) else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb) end;
$$;

create or replace function public.record_account_activity(p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_event not in ('LOGIN', 'PASSWORD_CHANGE') then raise exception 'Unsupported account activity.' using errcode = '22023'; end if;
  if not exists (select 1 from public.account_activity where user_id = auth.uid() and event = p_event and created_at > now() - interval '1 minute') then
    insert into public.account_activity (user_id, event) values (auth.uid(), p_event);
  end if;
end;
$$;

revoke execute on function public.generate_all_contribution_periods(date) from public, anon, authenticated;
revoke execute on function public.reactivate_member(uuid) from public, anon;
revoke execute on function public.super_admin_reopen_request(uuid) from public, anon;
revoke execute on function public.get_pending_review_summary() from public, anon;
revoke execute on function public.record_account_activity(text) from public, anon;
grant execute on function public.reactivate_member(uuid) to authenticated;
grant execute on function public.super_admin_reopen_request(uuid) to authenticated;
grant execute on function public.get_pending_review_summary() to authenticated;
grant execute on function public.record_account_activity(text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_013', 'complete operational workflows')
on conflict (version) do nothing;

commit;
