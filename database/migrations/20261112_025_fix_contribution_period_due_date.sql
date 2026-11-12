-- 025: Populate required due_date whenever record_contribution creates a contribution_periods row

begin;

create or replace function public.contribution_period_due_date(
  p_group_id uuid,
  p_month date
)
returns date
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select date_trunc('month', p_month)::date as period_month
  )
  select make_date(
    extract(year from m.period_month)::integer,
    extract(month from m.period_month)::integer,
    least(
      coalesce(
        (
          select deadline_day
          from public.contribution_settings
          where group_id = p_group_id
            and effective_month <= m.period_month
          order by effective_month desc
          limit 1
        ),
        28
      ),
      extract(day from (m.period_month + interval '1 month - 1 day'))::integer
    )
  )
  from m;
$$;

revoke execute on function public.contribution_period_due_date(uuid, date) from public, anon, authenticated;

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

insert into public.schema_migrations (version, name)
values ('20261112_025', 'fix contribution period due date')
on conflict (version) do nothing;

commit;

