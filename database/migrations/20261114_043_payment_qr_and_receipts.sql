-- Migration 043: Group payment QR info and contribution/expense receipt uploads
begin;

alter table public.groups
  add column if not exists payment_qr_url text,
  add column if not exists payment_method_label text,
  add column if not exists payment_account_name text,
  add column if not exists payment_account_number text,
  add column if not exists payment_instructions text;

alter table public.contributions
  add column if not exists receipt_url text;

alter table public.expenses
  add column if not exists receipt_url text;

create or replace function public.get_group_payment_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_row record;
begin
  if auth.uid() is null or v_group_id is null or public.current_user_role() is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;

  select
    g.id,
    g.name,
    g.payment_qr_url,
    g.payment_method_label,
    g.payment_account_name,
    g.payment_account_number,
    g.payment_instructions
  into v_row
  from public.groups g
  where g.id = v_group_id
    and g.status = 'ACTIVE';

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'group_id', v_row.id,
    'group_name', v_row.name,
    'payment_qr_url', v_row.payment_qr_url,
    'payment_method_label', v_row.payment_method_label,
    'payment_account_name', v_row.payment_account_name,
    'payment_account_number', v_row.payment_account_number,
    'payment_instructions', v_row.payment_instructions
  );
end;
$$;

create or replace function public.update_group_payment_info(
  p_payment_qr_url text default null,
  p_clear_qr boolean default false,
  p_payment_method_label text default null,
  p_payment_account_name text default null,
  p_payment_account_number text default null,
  p_payment_instructions text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_method text := nullif(btrim(coalesce(p_payment_method_label, '')), '');
  v_acc_name text := nullif(btrim(coalesce(p_payment_account_name, '')), '');
  v_acc_num text := nullif(btrim(coalesce(p_payment_account_number, '')), '');
  v_notes text := nullif(btrim(coalesce(p_payment_instructions, '')), '');
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update group payment details.' using errcode = '42501';
  end if;

  if v_method is not null and char_length(v_method) > 60 then
    raise exception 'Payment channel must be 60 characters or fewer.' using errcode = '22023';
  end if;
  if v_acc_name is not null and char_length(v_acc_name) > 120 then
    raise exception 'Account name must be 120 characters or fewer.' using errcode = '22023';
  end if;
  if v_acc_num is not null and char_length(v_acc_num) > 80 then
    raise exception 'Account number must be 80 characters or fewer.' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Payment instructions must be 500 characters or fewer.' using errcode = '22023';
  end if;
  if p_payment_qr_url is not null and (p_payment_qr_url !~ '^data:image/' or char_length(p_payment_qr_url) > 600000) then
    raise exception 'Payment QR must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  update public.groups
  set payment_qr_url = case
        when p_clear_qr then null
        when p_payment_qr_url is not null then p_payment_qr_url
        else payment_qr_url
      end,
      payment_method_label = v_method,
      payment_account_name = v_acc_name,
      payment_account_number = v_acc_num,
      payment_instructions = v_notes
  where id = v_group_id;

  if not found then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
end;
$$;

drop function if exists public.record_contribution(uuid, date, numeric, date, text, text, uuid);

create or replace function public.record_contribution(
  p_member_id uuid,
  p_contribution_month date,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null
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
    idempotency_key, notes, receipt_url, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    v_period_id, public.validated_money(p_amount, 'Contribution amount'), p_payment_date,
    nullif(btrim(p_transaction_reference), ''), p_idempotency_key,
    nullif(btrim(p_notes), ''), v_receipt, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;

  return v_id;
end;
$$;

drop function if exists public.record_expense(date, numeric, text, text, text, text, text, uuid);

create or replace function public.record_expense(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role := public.current_user_role();
  v_status public.approval_status;
  v_id uuid;
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
begin
  if v_role is null or v_role not in ('ADMIN', 'TREASURER') then
    raise exception 'You are not allowed to record expenses.' using errcode = '42501';
  end if;
  if v_receipt is not null and (v_receipt !~ '^data:image/' or char_length(v_receipt) > 600000) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.expenses (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, receipt_url, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Expense amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_receipt, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.get_group_payment_info() to authenticated;
grant execute on function public.update_group_payment_info(text, boolean, text, text, text, text) to authenticated;
grant execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid, text) to authenticated;
grant execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_043', 'group payment qr and contribution/expense receipts')
on conflict (version) do nothing;

commit;
