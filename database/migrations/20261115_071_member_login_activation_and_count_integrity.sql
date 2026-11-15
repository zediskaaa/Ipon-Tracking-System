-- Require login activation before members become official active contributors,
-- restore deleted_at filtering on members_select RLS, clean orphan periods,
-- and make delete_member cleanly handle linked/pending/self-contributor rows.

begin;

alter table public.members
  add column if not exists activation_status text not null default 'PENDING',
  add column if not exists activated_at timestamptz;

alter table public.members drop constraint if exists members_activation_status_check;
alter table public.members
  add constraint members_activation_status_check
  check (activation_status in ('PENDING', 'ACTIVE'));

alter table public.members disable trigger members_group_scope;
alter table public.contribution_periods disable trigger contribution_periods_group_scope;

update public.members m
set activation_status = case
      when exists (
        select 1
        from auth.users u
        join public.profiles p on p.id = u.id
        left join public.group_memberships gm
          on gm.user_id = u.id and gm.group_id = m.group_id
        where u.last_sign_in_at is not null
          and p.status = 'ACTIVE'
          and (
            (gm.member_id = m.id and gm.status = 'ACTIVE')
            or (gm.id is null and p.member_id = m.id and p.group_id = m.group_id)
          )
      ) then 'ACTIVE'
      else 'PENDING'
    end,
    activated_at = case
      when exists (
        select 1
        from auth.users u
        join public.profiles p on p.id = u.id
        left join public.group_memberships gm
          on gm.user_id = u.id and gm.group_id = m.group_id
        where u.last_sign_in_at is not null
          and p.status = 'ACTIVE'
          and (
            (gm.member_id = m.id and gm.status = 'ACTIVE')
            or (gm.id is null and p.member_id = m.id and p.group_id = m.group_id)
          )
      ) then coalesce(m.activated_at, now())
      else null
    end;

-- Clean empty contribution periods left behind on deleted or unactivated members
delete from public.contribution_periods cp
using public.members m
where m.id = cp.member_id
  and (m.deleted_at is not null or m.activation_status <> 'ACTIVE')
  and not exists (
    select 1
    from public.contributions c
    where c.contribution_period_id = cp.id
  );

-- Clear stale member links pointing at already-deleted member rows
update public.group_memberships gm
set status = case when gm.role = 'MEMBER' then 'DISABLED'::public.account_status else gm.status end,
    member_id = case when gm.role <> 'MEMBER' then null else gm.member_id end
from public.members m
where m.id = gm.member_id
  and m.deleted_at is not null;

update public.profiles p
set member_id = null
from public.members m
where m.id = p.member_id
  and m.deleted_at is not null
  and p.role <> 'MEMBER';

alter table public.contribution_periods enable trigger contribution_periods_group_scope;
alter table public.members enable trigger members_group_scope;

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
begin
  if current_setting('ipon.maintenance_receipt_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_super_admin()
     and tg_op = 'UPDATE'
     and tg_table_name in ('contributions', 'expenses') then
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

  if tg_op = 'UPDATE'
     and tg_table_name = 'members'
     and current_setting('ipon.activating_member_id', true) = new.id::text
     and pg_trigger_depth() <= 1
     and old.group_id is not distinct from new.group_id
     and old.activation_status <> 'ACTIVE'
     and new.activation_status = 'ACTIVE' then
    return new;
  end if;

  if tg_op = 'INSERT'
     and tg_table_name = 'contribution_periods'
     and current_setting('ipon.activating_member_id', true) = new.member_id::text
     and pg_trigger_depth() <= 1 then
    select group_id into v_row_group from public.members where id = new.member_id;
    new.group_id := v_row_group;
    return new;
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
  if tg_op = 'UPDATE' and old.group_id is distinct from new.group_id then
    raise exception 'A record cannot be moved to another savings group.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
using (
  group_id = public.current_group_id()
  and deleted_at is null
  and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
);

create or replace function public.activate_member_record(
  p_member_id uuid,
  p_actor_id uuid default auth.uid()
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.members;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date;
  v_admin record;
begin
  if p_member_id is null then
    return false;
  end if;

  perform set_config('ipon.activating_member_id', p_member_id::text, true);

  update public.members m
  set activation_status = 'ACTIVE',
      activated_at = coalesce(m.activated_at, now()),
      updated_by = coalesce(p_actor_id, m.updated_by)
  where m.id = p_member_id
    and m.deleted_at is null
    and m.activation_status <> 'ACTIVE'
  returning m.* into v_member;

  if not found then
    perform set_config('ipon.activating_member_id', '', true);
    return false;
  end if;

  if v_member.status = 'ACTIVE'
     and v_member.date_registered <= (v_month + interval '1 month - 1 day')::date
     and exists (
       select 1
       from public.contribution_periods cp
       join public.members m2 on m2.id = cp.member_id
       where m2.group_id = v_member.group_id
         and m2.deleted_at is null
         and cp.period_month = v_month
     ) then
    insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
    values (
      v_member.id,
      v_month,
      v_member.monthly_contribution_amount,
      public.contribution_period_due_date(v_member.group_id, v_month)
    )
    on conflict (member_id, period_month) do nothing;
  end if;

  perform set_config('ipon.activating_member_id', '', true);

  for v_admin in
    select user_id as id
    from public.group_admin_ids(v_member.group_id)
    where user_id <> coalesce(p_actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform public.push_notification(
      v_admin.id,
      'MEMBER_ACTIVATED',
      'Member activated',
      v_member.full_name || ' signed in and is now an official active member.',
      'members.html?member=' || v_member.id::text,
      v_member.group_id
    );
  end loop;

  return true;
end;
$$;

revoke execute on function public.activate_member_record(uuid, uuid) from public, anon, authenticated;

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
      case when new.activation_status = 'ACTIVE' then 'Member activated' else 'Member added (pending login)' end,
      case
        when new.activation_status = 'ACTIVE' then new.full_name || ' was added as an official active member.'
        else new.full_name || ' was added and will become an official active member after signing in.'
      end,
      'members.html?member=' || new.id::text,
      new.group_id
    );
  end loop;
  return new;
end;
$$;

revoke execute on function public.notify_new_member() from public, anon, authenticated;

create or replace function public.create_member(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text,
  p_date_registered date,
  p_monthly_contribution_amount numeric,
  p_notes text default null,
  p_payout_channel text default null,
  p_payout_account_number text default null,
  p_payout_account_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_first_name text;
  v_middle_name text;
  v_last_name text;
  v_payout_channel text;
  v_payout_number text;
  v_payout_name text;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can create members.' using errcode = '42501';
  end if;

  v_first_name := public.validated_name_part(p_first_name, 'First name');
  v_middle_name := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last_name := public.validated_name_part(p_last_name, 'Last name');

  select vp.out_channel, vp.out_account_number, vp.out_account_name
  into v_payout_channel, v_payout_number, v_payout_name
  from public.validated_payout_account(p_payout_channel, p_payout_account_number, p_payout_account_name) vp;

  insert into public.members (
    full_name, first_name, middle_name, last_name, contact_number, date_registered,
    monthly_contribution_amount, notes, activation_status, activated_at,
    payout_channel, payout_account_number, payout_account_name,
    created_by, updated_by
  ) values (
    concat_ws(' ', v_first_name, v_middle_name, v_last_name), v_first_name, v_middle_name, v_last_name,
    public.normalize_ph_mobile(p_contact_number), p_date_registered,
    public.validated_money(p_monthly_contribution_amount, 'Monthly contribution amount'),
    nullif(btrim(p_notes), ''), 'PENDING', null,
    v_payout_channel, v_payout_number, v_payout_name,
    auth.uid(), auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) from public, anon;
grant execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) to authenticated;

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
      deactivated_at = null,
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
    and activation_status = 'ACTIVE'
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
    and m.activation_status = 'ACTIVE'
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
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_payment_method text default null
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
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and activation_status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    if exists (
      select 1 from public.members
      where id = p_member_id
        and group_id = v_group_id
        and deleted_at is null
        and status = 'ACTIVE'
        and activation_status <> 'ACTIVE'
    ) then
      raise exception 'This member must log in to their account to activate official membership before contributions can be recorded.' using errcode = 'P0001';
    end if;
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
    idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    v_period_id, public.validated_money(p_amount, 'Contribution amount'), p_payment_date,
    nullif(btrim(p_transaction_reference), ''), p_idempotency_key,
    nullif(btrim(p_notes), ''), v_receipt, v_method, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.record_contribution_with_carryover(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_allocate_excess boolean default false,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_month date := date_trunc('month', p_contribution_month)::date;
  v_amount numeric(14,2) := public.validated_money(p_amount, 'Contribution amount');
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_method text := public.normalized_payment_method(p_payment_method);
  v_required numeric(14,2);
  v_status public.approval_status;
  v_remaining numeric(14,2);
  v_cursor_month date;
  v_period record;
  v_covered numeric(14,2);
  v_needed numeric(14,2);
  v_slice numeric(14,2);
  v_first_id uuid;
  v_ids uuid[] := array[]::uuid[];
  v_id uuid;
  v_i integer := 0;
  v_use_receipt text;
  v_slice_notes text;
  v_slice_key uuid;
begin
  if not coalesce(p_allocate_excess, false) then
    v_id := public.record_contribution(
      p_member_id,
      p_contribution_month,
      v_amount,
      p_payment_date,
      p_transaction_reference,
      p_notes,
      p_idempotency_key,
      p_receipt_url,
      v_method
    );
    return jsonb_build_object('ids', array[v_id], 'months_covered', 1);
  end if;

  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if v_month is null or v_month < date '2000-01-01' or v_month > date_trunc('month', current_date)::date then
    raise exception 'Contribution month must be between January 2000 and the current month.' using errcode = '22023';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select id into v_first_id
  from public.contributions
  where idempotency_key = p_idempotency_key;

  if v_first_id is not null then
    return jsonb_build_object('ids', array[v_first_id], 'months_covered', 1);
  end if;

  select monthly_contribution_amount into v_required
  from public.members
  where id = p_member_id
    and group_id = v_group_id
    and status = 'ACTIVE'
    and activation_status = 'ACTIVE'
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
    if exists (
      select 1 from public.members
      where id = p_member_id
        and group_id = v_group_id
        and deleted_at is null
        and status = 'ACTIVE'
        and activation_status <> 'ACTIVE'
    ) then
      raise exception 'This member must log in to their account to activate official membership before contributions can be recorded.' using errcode = 'P0001';
    end if;
    raise exception 'Active member not found.' using errcode = 'P0002';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;
  v_remaining := v_amount;
  v_cursor_month := v_month;

  while v_remaining > 0 and v_i < 24 loop
    insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
    values (
      p_member_id,
      v_cursor_month,
      v_required,
      public.contribution_period_due_date(v_group_id, v_cursor_month)
    )
    on conflict (member_id, period_month) do nothing;

    select id, required_amount, is_exempt into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_cursor_month;

    if not coalesce(v_period.is_exempt, false) then
      select coalesce(sum(amount), 0)::numeric(14,2) into v_covered
      from public.contributions
      where contribution_period_id = v_period.id
        and approval_status in ('CONFIRMED', 'PENDING');

      v_needed := greatest(coalesce(v_period.required_amount, v_required) - v_covered, 0);

      if v_needed > 0 or v_i = 23 then
        if v_needed > 0 and v_remaining > v_needed and v_i < 23 then
          v_slice := v_needed;
        else
          v_slice := v_remaining;
        end if;

        v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
        v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;
        v_slice_notes := case
          when coalesce(array_length(v_ids, 1), 0) = 0 then v_notes
          else concat_ws(' · ', 'Carry-over from ' || to_char(v_month, 'Mon YYYY'), v_notes)
        end;

        insert into public.contributions (
          contribution_period_id, amount, payment_date, transaction_reference,
          idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
          reviewed_by, reviewed_at
        ) values (
          v_period.id, v_slice, p_payment_date,
          nullif(btrim(p_transaction_reference), ''), v_slice_key,
          v_slice_notes, v_use_receipt, v_method, v_status, auth.uid(),
          case when v_status = 'CONFIRMED' then auth.uid() end,
          case when v_status = 'CONFIRMED' then now() end
        ) returning id into v_id;

        v_ids := array_append(v_ids, v_id);
        v_remaining := round(v_remaining - v_slice, 2);
      end if;
    end if;

    v_cursor_month := (v_cursor_month + interval '1 month')::date;
    v_i := v_i + 1;
  end loop;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    v_id := public.record_contribution(
      p_member_id,
      p_contribution_month,
      v_amount,
      p_payment_date,
      p_transaction_reference,
      p_notes,
      p_idempotency_key,
      p_receipt_url,
      v_method
    );
    v_ids := array[v_id];
  end if;

  return jsonb_build_object('ids', v_ids, 'months_covered', coalesce(array_length(v_ids, 1), 1));
end;
$$;

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
  case
    when cp.is_exempt then 0::numeric(14,2)
    else greatest(cp.required_amount - coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0), 0)::numeric(14,2)
  end as outstanding_amount,
  greatest(coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) - cp.required_amount, 0)::numeric(14,2) as overpaid_amount,
  case
    when cp.is_exempt then 'EXEMPT'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = 0 then 'UNPAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) < cp.required_amount then 'PARTIALLY PAID'
    when coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0) = cp.required_amount then 'PAID'
    else 'OVERPAID'
  end as payment_status,
  cp.is_exempt,
  cp.exempt_reason
from public.contribution_periods cp
join public.members m on m.id = cp.member_id
left join public.contributions c on c.contribution_period_id = cp.id
where m.deleted_at is null
  and ((m.status = 'ACTIVE' and m.activation_status = 'ACTIVE') or c.id is not null)
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount, cp.is_exempt, cp.exempt_reason;

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
    and activation_status = 'ACTIVE'
    and deleted_at is null;

  if v_required is null then
    if exists (
      select 1 from public.members
      where id = p_member_id
        and group_id = v_group_id
        and deleted_at is null
        and activation_status <> 'ACTIVE'
    ) then
      raise exception 'This member must log in first before period exemptions apply.' using errcode = 'P0001';
    end if;
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
        and m.activation_status = 'ACTIVE'
        and m.deleted_at is null
    ) as is_contributor,
    (
      select count(*)
      from public.members m
      where m.group_id = mg.group_id
        and m.status = 'ACTIVE'
        and m.activation_status = 'ACTIVE'
        and m.deleted_at is null
    ) as active_member_count,
    mg.created_at
  from my_groups mg
  order by mg.is_current desc, mg.created_at asc;
$$;

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
    raise exception 'Monthly contribution amount must be greater than zero.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid() and group_id = v_group_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  select * into v_gm
  from public.group_memberships
  where group_id = v_group_id and user_id = auth.uid() and status = 'ACTIVE';

  v_member_id := coalesce(v_profile.member_id, v_gm.member_id);

  if p_enabled then
    select default_amount into v_default_amount
    from public.contribution_settings
    where group_id = v_group_id
    order by effective_month desc
    limit 1;

    v_amount := round(coalesce(p_monthly_amount, v_default_amount, 100), 2);

    if v_member_id is not null and exists (
      select 1 from public.members where id = v_member_id and group_id = v_group_id and deleted_at is null
    ) then
      update public.members
      set status = 'ACTIVE',
          deactivated_at = null,
          activation_status = 'ACTIVE',
          activated_at = coalesce(activated_at, now()),
          monthly_contribution_amount = coalesce(p_monthly_amount, monthly_contribution_amount, v_amount),
          updated_by = auth.uid()
      where id = v_member_id and group_id = v_group_id;
    else
      v_full := coalesce(nullif(btrim(v_profile.full_name), ''), 'Group Admin');
      v_first := coalesce(nullif(btrim(v_profile.first_name), ''), split_part(v_full, ' ', 1));
      v_middle := nullif(btrim(v_profile.middle_name), '');
      v_last := coalesce(nullif(btrim(v_profile.last_name), ''), nullif(btrim(substr(v_full, char_length(split_part(v_full, ' ', 1)) + 1)), ''), 'Admin');

      insert into public.members (
        group_id, first_name, middle_name, last_name, full_name,
        contact_number, date_registered, monthly_contribution_amount,
        status, activation_status, activated_at, notes, created_by
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
        'ACTIVE',
        now(),
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

    perform public.generate_contribution_periods(date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date);

    update public.contribution_periods cp
    set required_amount = v_amount
    where cp.member_id = v_member_id
      and cp.period_month = date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date
      and not exists (
        select 1 from public.contributions c
        where c.contribution_period_id = cp.id
      );

    return jsonb_build_object('is_contributor', true, 'member_id', v_member_id, 'monthly_contribution_amount', v_amount);
  else
    if v_member_id is not null then
      update public.members
      set status = 'INACTIVE',
          deactivated_at = now(),
          updated_by = auth.uid()
      where id = v_member_id
        and group_id = v_group_id
        and deleted_at is null;

      delete from public.contribution_periods cp
      where cp.member_id = v_member_id
        and not exists (
          select 1 from public.contributions c
          where c.contribution_period_id = cp.id
        );
    end if;

    update public.profiles
    set member_id = null
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', false, 'member_id', null, 'monthly_contribution_amount', null);
  end if;
end;
$$;

create or replace function public.activate_own_pending_account()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_auth record;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
  v_contact text;
  v_membership record;
  v_name_setup_required boolean := false;
  v_link record;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = v_uid;

  if not found then
    select id, email, raw_user_meta_data
    into v_auth
    from auth.users
    where id = v_uid;

    if not found then
      raise exception 'User account not found.' using errcode = 'P0002';
    end if;

    v_name_setup_required := coalesce((v_auth.raw_user_meta_data ->> 'name_setup_required')::boolean, false);

    begin
      if nullif(btrim(v_auth.raw_user_meta_data ->> 'first_name'), '') is not null
         and nullif(btrim(v_auth.raw_user_meta_data ->> 'last_name'), '') is not null then
        v_first := public.validated_name_part(v_auth.raw_user_meta_data ->> 'first_name', 'First name');
        v_middle := public.validated_name_part(v_auth.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
        v_last := public.validated_name_part(v_auth.raw_user_meta_data ->> 'last_name', 'Last name');
        v_full := concat_ws(' ', v_first, v_middle, v_last);
      end if;
    exception when others then
      v_first := null;
      v_middle := null;
      v_last := null;
      v_name_setup_required := true;
    end;

    if v_full is null then
      v_full := coalesce(
        nullif(btrim(v_auth.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(split_part(coalesce(v_auth.email, ''), '@', 1)), ''),
        'New User'
      );
      v_name_setup_required := true;
    end if;

    v_contact := public.normalize_ph_mobile(v_auth.raw_user_meta_data ->> 'contact_number');

    insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status, name_setup_required)
    values (v_uid, v_full, v_first, v_middle, v_last, lower(v_auth.email), v_contact, 'MEMBER', 'ACTIVE', v_name_setup_required)
    on conflict (id) do nothing;

    select * into v_profile
    from public.profiles
    where id = v_uid;
  end if;

  if v_profile.status = 'DISABLED' then
    raise exception 'Your account is deactivated or disabled.' using errcode = '42501';
  end if;

  update public.group_memberships
  set status = 'ACTIVE'
  where user_id = v_uid
    and status = 'PENDING';

  select gm.group_id, gm.role, gm.member_id
  into v_membership
  from public.group_memberships gm
  where gm.user_id = v_uid
    and gm.status = 'ACTIVE'
  order by gm.created_at desc
  limit 1;

  if v_profile.status <> 'ACTIVE' or (v_profile.group_id is null and v_membership.group_id is not null) then
    update public.profiles
    set status = 'ACTIVE',
        group_id = coalesce(group_id, v_membership.group_id),
        role = case when group_id is null and v_membership.group_id is not null then coalesce(v_membership.role, role) else role end,
        member_id = coalesce(member_id, case when group_id is null then v_membership.member_id else null end)
    where id = v_uid
      and status <> 'DISABLED'
    returning * into v_profile;
  end if;

  -- Official login activation gate: activate linked member rows once the user logs in
  for v_link in
    select distinct m.id as member_id
    from public.members m
    where m.deleted_at is null
      and m.activation_status <> 'ACTIVE'
      and (
        m.id = v_profile.member_id
        or m.id in (
          select gm.member_id
          from public.group_memberships gm
          where gm.user_id = v_uid
            and gm.status = 'ACTIVE'
            and gm.member_id is not null
        )
      )
  loop
    perform public.activate_member_record(v_link.member_id, v_uid);
  end loop;

  return jsonb_build_object(
    'id', v_profile.id,
    'role', v_profile.role,
    'status', v_profile.status,
    'group_id', v_profile.group_id,
    'member_id', v_profile.member_id,
    'first_name', v_profile.first_name,
    'middle_name', v_profile.middle_name,
    'last_name', v_profile.last_name,
    'contact_number', v_profile.contact_number,
    'name_setup_required', coalesce(v_profile.name_setup_required, false)
  );
end;
$$;

revoke execute on function public.activate_own_pending_account() from public, anon;
grant execute on function public.activate_own_pending_account() to authenticated;

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

  if v_membership.member_id is not null then
    perform public.activate_member_record(v_membership.member_id, auth.uid());
  end if;

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

  if p_status = 'ACTIVE' and v_link_member_id is not null and exists (
    select 1 from auth.users u where u.id = p_user_id and u.last_sign_in_at is not null
  ) then
    perform public.activate_member_record(v_link_member_id, p_user_id);
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

  delete from public.contribution_periods cp
  where cp.member_id = p_member_id
    and not exists (
      select 1
      from public.contributions c
      where c.contribution_period_id = cp.id
    );

  update public.profiles
  set previous_account_status = case
        when status <> 'DISABLED' then status
        else coalesce(previous_account_status, status)
      end,
      status = 'DISABLED'
  where member_id = p_member_id
    and group_id = v_group_id
    and role = 'MEMBER';

  update public.group_memberships
  set status = 'DISABLED'
  where member_id = p_member_id
    and group_id = v_group_id
    and role = 'MEMBER';

  update public.group_memberships
  set member_id = null
  where member_id = p_member_id
    and group_id = v_group_id
    and role <> 'MEMBER';

  update public.profiles
  set member_id = null
  where member_id = p_member_id
    and group_id = v_group_id
    and role <> 'MEMBER';
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
  v_month date := date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date;
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

    update public.group_memberships
    set status = case
      when v_member.activation_status = 'ACTIVE' then 'ACTIVE'::public.account_status
      else 'PENDING'::public.account_status
    end
    where member_id = p_item_id
      and group_id = v_group_id
      and role = 'MEMBER'
      and status = 'DISABLED';

    if v_member.status = 'ACTIVE'
       and v_member.activation_status = 'ACTIVE'
       and v_member.date_registered <= (v_month + interval '1 month - 1 day')::date
       and exists (
         select 1
         from public.contribution_periods cp
         join public.members m2 on m2.id = cp.member_id
         where m2.group_id = v_group_id
           and m2.deleted_at is null
           and cp.period_month = v_month
       ) then
      insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
      values (
        v_member.id,
        v_month,
        v_member.monthly_contribution_amount,
        public.contribution_period_due_date(v_group_id, v_month)
      )
      on conflict (member_id, period_month) do nothing;
    end if;
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

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261115_071', 'member login activation and count integrity')
on conflict (version) do nothing;

commit;
