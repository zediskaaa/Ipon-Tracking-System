-- Migration 056: Payment Method Tagging (Cash, GCash, Maya, Bank Transfer, Other) & Wallet Reconciliation

begin;

alter table public.contributions
  add column if not exists payment_method text;

alter table public.withdrawals
  add column if not exists payment_method text;

alter table public.expenses
  add column if not exists payment_method text;

alter table public.contributions
  drop constraint if exists contributions_payment_method_check;
alter table public.contributions
  add constraint contributions_payment_method_check
  check (payment_method is null or payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

alter table public.withdrawals
  drop constraint if exists withdrawals_payment_method_check;
alter table public.withdrawals
  add constraint withdrawals_payment_method_check
  check (payment_method is null or payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

alter table public.expenses
  drop constraint if exists expenses_payment_method_check;
alter table public.expenses
  add constraint expenses_payment_method_check
  check (payment_method is null or payment_method in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'));

create index if not exists contributions_group_payment_method_idx
  on public.contributions (group_id, payment_method);

create index if not exists withdrawals_group_payment_method_idx
  on public.withdrawals (group_id, payment_method);

create index if not exists expenses_group_payment_method_idx
  on public.expenses (group_id, payment_method);

create or replace function public.normalized_payment_method(p_method text)
returns text
language plpgsql
immutable
as $$
declare
  v_norm text := nullif(upper(regexp_replace(btrim(coalesce(p_method, '')), '\s+', '_', 'g')), '');
begin
  if v_norm is null then
    return null;
  end if;
  if v_norm in ('BANK', 'BANK_TRANSFER', 'INSTAPAY', 'PESONET') then
    return 'BANK_TRANSFER';
  end if;
  if v_norm in ('CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER') then
    return v_norm;
  end if;
  raise exception 'Invalid payment method. Choose Cash, GCash, Maya, Bank Transfer, or Other.' using errcode = '22023';
end;
$$;

drop function if exists public.record_contribution(uuid, date, numeric, date, text, text, uuid, text);

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

drop function if exists public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean);

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
    and deleted_at is null
    and date_registered <= (v_month + interval '1 month - 1 day')::date;

  if v_required is null then
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
      select coalesce(sum(amount) filter (where approval_status in ('CONFIRMED', 'PENDING')), 0)::numeric(14,2)
      into v_covered
      from public.contributions
      where contribution_period_id = v_period.id;

      v_needed := greatest(v_period.required_amount - coalesce(v_covered, 0), 0);
      if v_needed > 0 then
        v_slice := least(v_remaining, v_needed);
        v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
        v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;
        v_slice_notes := case
          when coalesce(array_length(v_ids, 1), 0) = 0 then v_notes
          else left(trim(both ' ' from concat_ws(' · ', 'Advance carry-over from ' || to_char(v_month, 'Mon YYYY'), v_notes)), 1000)
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
        v_remaining := v_remaining - v_slice;
      end if;
    end if;

    v_cursor_month := (v_cursor_month + interval '1 month')::date;
    v_i := v_i + 1;
  end loop;

  if v_remaining > 0 then
    select id into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_month;

    v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
    v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;

    insert into public.contributions (
      contribution_period_id, amount, payment_date, transaction_reference,
      idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
      reviewed_by, reviewed_at
    ) values (
      v_period.id, v_remaining, p_payment_date,
      nullif(btrim(p_transaction_reference), ''), v_slice_key,
      left(trim(both ' ' from concat_ws(' · ', v_notes, 'Excess beyond 24 months')), 1000),
      v_use_receipt, v_method, v_status, auth.uid(),
      case when v_status = 'CONFIRMED' then auth.uid() end,
      case when v_status = 'CONFIRMED' then now() end
    ) returning id into v_id;

    v_ids := array_append(v_ids, v_id);
  end if;

  return jsonb_build_object('ids', v_ids, 'months_covered', coalesce(array_length(v_ids, 1), 0));
end;
$$;

drop function if exists public.update_contribution(uuid, numeric, date, text, text);

create or replace function public.update_contribution(
  p_contribution_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_transaction_reference text,
  p_notes text,
  p_payment_method text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.contributions;
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_next_method text;
begin
  select * into v_entry
  from public.contributions
  where id = p_contribution_id and group_id = v_group_id;
  if not found then raise exception 'Contribution not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then
    raise exception 'Only pending contributions can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023';
  end if;
  if v_role <> 'ADMIN' and not (
    v_entry.submitted_by = auth.uid() or v_role = 'TREASURER'
  ) then
    raise exception 'You are not allowed to edit this entry.' using errcode = '42501';
  end if;

  v_next_method := case
    when p_payment_method = '__KEEP__' then v_entry.payment_method
    else public.normalized_payment_method(p_payment_method)
  end;

  update public.contributions
  set amount = public.validated_money(p_amount, 'Contribution amount'),
      payment_date = p_payment_date,
      transaction_reference = nullif(btrim(p_transaction_reference), ''),
      notes = nullif(btrim(p_notes), ''),
      payment_method = v_next_method
  where id = p_contribution_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending contribution not found.' using errcode = 'P0002'; end if;
end;
$$;

drop function if exists public.record_withdrawal(date, numeric, text, text, text, text, text, uuid);

create or replace function public.record_withdrawal(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_payment_method text default null
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
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'Only administrators and treasurers can record withdrawals.' using errcode = '42501'; end if;
  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.withdrawals (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, payment_method, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Withdrawal amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_method, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.update_withdrawal(uuid, date, numeric, text, text, text, text, text);

create or replace function public.update_withdrawal(
  p_withdrawal_id uuid,
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text,
  p_notes text,
  p_payment_method text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.withdrawals;
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_next_method text;
begin
  select * into v_entry
  from public.withdrawals
  where id = p_withdrawal_id and group_id = v_group_id;
  if not found then raise exception 'Withdrawal not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending withdrawals can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'You are not allowed to edit this entry.' using errcode = '42501'; end if;

  v_next_method := case
    when p_payment_method = '__KEEP__' then v_entry.payment_method
    else public.normalized_payment_method(p_payment_method)
  end;

  update public.withdrawals set
    transaction_date = p_transaction_date,
    amount = public.validated_money(p_amount, 'Withdrawal amount'),
    category = btrim(p_category),
    description = btrim(p_description),
    person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''),
    notes = nullif(btrim(p_notes), ''),
    payment_method = v_next_method
  where id = p_withdrawal_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending withdrawal not found.' using errcode = 'P0002'; end if;
end;
$$;

drop function if exists public.record_expense(date, numeric, text, text, text, text, text, uuid, text);

create or replace function public.record_expense(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid(),
  p_receipt_url text default null,
  p_payment_method text default null
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
  v_method text := public.normalized_payment_method(p_payment_method);
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
    reference_number, idempotency_key, notes, receipt_url, payment_method, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Expense amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_receipt, v_method, v_status, auth.uid(),
    case when v_status = 'CONFIRMED' then auth.uid() end,
    case when v_status = 'CONFIRMED' then now() end
  ) returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.update_expense(uuid, date, numeric, text, text, text, text, text);

create or replace function public.update_expense(
  p_expense_id uuid,
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text,
  p_notes text,
  p_payment_method text default '__KEEP__'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.expenses;
  v_role public.app_role := public.current_user_role();
  v_group_id uuid := public.current_group_id();
  v_next_method text;
begin
  select * into v_entry
  from public.expenses
  where id = p_expense_id and group_id = v_group_id;
  if not found then raise exception 'Expense not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending expenses can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role <> 'ADMIN' and v_role <> 'TREASURER' then
    raise exception 'You are not allowed to edit this expense.' using errcode = '42501';
  end if;

  v_next_method := case
    when p_payment_method = '__KEEP__' then v_entry.payment_method
    else public.normalized_payment_method(p_payment_method)
  end;

  update public.expenses set
    transaction_date = p_transaction_date,
    amount = public.validated_money(p_amount, 'Expense amount'),
    category = btrim(p_category),
    description = btrim(p_description),
    person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''),
    notes = nullif(btrim(p_notes), ''),
    payment_method = v_next_method
  where id = p_expense_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending expense not found.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.get_pending_review_summary()
returns jsonb language sql stable security definer set search_path = public as $$
  with gid as (
    select public.current_group_id() as group_id
  ),
  entries as (
    select
      c.id,
      c.amount,
      c.payment_date as activity_date,
      c.created_at,
      'contribution'::text as entry_type,
      'Savings Addition'::text as entry_label,
      m.full_name as member_name,
      coalesce(sp.full_name, m.full_name) as submitted_by_name,
      coalesce(
        public.group_member_avatar(m.id),
        case when sp.status = 'ACTIVE' then sp.avatar_url end
      ) as avatar_url,
      cp.period_month,
      null::text as category,
      c.transaction_reference as reference,
      c.notes,
      null::text as description,
      c.receipt_url,
      c.payment_method
    from public.contributions c
    join gid on c.group_id = gid.group_id
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    left join public.profiles sp
      on sp.id = c.submitted_by
     and sp.group_id = c.group_id
    where c.approval_status = 'PENDING'

    union all

    select
      w.id,
      w.amount,
      w.transaction_date as activity_date,
      w.created_at,
      'withdrawal'::text as entry_type,
      'Deduction'::text as entry_label,
      w.person_responsible as member_name,
      coalesce(sp.full_name, w.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      w.category,
      w.reference_number as reference,
      w.notes,
      w.description,
      null::text as receipt_url,
      w.payment_method
    from public.withdrawals w
    join gid on w.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = w.submitted_by
     and sp.group_id = w.group_id
    where w.approval_status = 'PENDING'

    union all

    select
      e.id,
      e.amount,
      e.transaction_date as activity_date,
      e.created_at,
      'expense'::text as entry_type,
      'Expense'::text as entry_label,
      e.person_responsible as member_name,
      coalesce(sp.full_name, e.person_responsible) as submitted_by_name,
      case when sp.status = 'ACTIVE' then sp.avatar_url end as avatar_url,
      null::date as period_month,
      e.category,
      e.reference_number as reference,
      e.notes,
      e.description,
      e.receipt_url,
      e.payment_method
    from public.expenses e
    join gid on e.group_id = gid.group_id
    left join public.profiles sp
      on sp.id = e.submitted_by
     and sp.group_id = e.group_id
    where e.approval_status = 'PENDING'
  ),
  recent as (
    select * from entries order by created_at desc limit 3
  )
  select case
    when public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and public.current_group_id() is not null
    then jsonb_build_object(
      'count', (select count(*) from entries),
      'amount', (select coalesce(sum(amount), 0) from entries),
      'items', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', id,
              'amount', amount,
              'date', activity_date,
              'type', entry_type,
              'entry_label', entry_label,
              'member_name', member_name,
              'submitted_by_name', submitted_by_name,
              'avatar_url', avatar_url,
              'period_month', period_month,
              'category', category,
              'reference', reference,
              'notes', notes,
              'description', description,
              'receipt_url', receipt_url,
              'payment_method', payment_method
            )
            order by created_at desc
          )
          from recent
        ),
        '[]'::jsonb
      )
    )
    else jsonb_build_object('count', 0, 'amount', 0, 'items', '[]'::jsonb)
  end;
$$;

create or replace function public.get_wallet_reconciliation()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select
      public.current_user_role() as role_name,
      public.current_group_id() as group_id
  ),
  grp as (
    select g.id, g.cycle_start_date
    from public.groups g
    join ctx on ctx.group_id = g.id
  ),
  methods(method_key, sort_order) as (
    values
      ('CASH', 1),
      ('GCASH', 2),
      ('MAYA', 3),
      ('BANK_TRANSFER', 4),
      ('OTHER', 5),
      ('UNTAGGED', 6)
  ),
  raw_entries as (
    select
      coalesce(c.payment_method, 'UNTAGGED') as method_key,
      c.approval_status,
      c.amount as addition_amount,
      0::numeric(14,2) as deduction_amount,
      0::numeric(14,2) as expense_amount
    from public.contributions c
    join grp on c.group_id = grp.id
    where c.approval_status in ('CONFIRMED', 'PENDING')
      and (
        c.approval_status = 'PENDING'
        or grp.cycle_start_date is null
        or c.payment_date >= grp.cycle_start_date
      )

    union all

    select
      coalesce(w.payment_method, 'UNTAGGED') as method_key,
      w.approval_status,
      0::numeric(14,2) as addition_amount,
      w.amount as deduction_amount,
      0::numeric(14,2) as expense_amount
    from public.withdrawals w
    join grp on w.group_id = grp.id
    where w.approval_status in ('CONFIRMED', 'PENDING')
      and (
        w.approval_status = 'PENDING'
        or grp.cycle_start_date is null
        or w.transaction_date >= grp.cycle_start_date
      )

    union all

    select
      coalesce(e.payment_method, 'UNTAGGED') as method_key,
      e.approval_status,
      0::numeric(14,2) as addition_amount,
      0::numeric(14,2) as deduction_amount,
      e.amount as expense_amount
    from public.expenses e
    join grp on e.group_id = grp.id
    where e.approval_status in ('CONFIRMED', 'PENDING')
      and (
        e.approval_status = 'PENDING'
        or grp.cycle_start_date is null
        or e.transaction_date >= grp.cycle_start_date
      )
  ),
  agg as (
    select
      m.method_key,
      m.sort_order,
      coalesce(sum(r.addition_amount) filter (where r.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as additions,
      coalesce(sum(r.deduction_amount) filter (where r.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as deductions,
      coalesce(sum(r.expense_amount) filter (where r.approval_status = 'CONFIRMED'), 0)::numeric(14,2) as expenses,
      coalesce(sum(r.addition_amount) filter (where r.approval_status = 'PENDING'), 0)::numeric(14,2) as pending_inflow,
      coalesce(sum(r.deduction_amount + r.expense_amount) filter (where r.approval_status = 'PENDING'), 0)::numeric(14,2) as pending_outflow,
      count(*) filter (where r.approval_status = 'CONFIRMED') as entry_count,
      count(*) filter (where r.approval_status = 'PENDING') as pending_count
    from methods m
    left join raw_entries r on r.method_key = m.method_key
    group by m.method_key, m.sort_order
  ),
  channel_rows as (
    select
      method_key,
      sort_order,
      additions,
      deductions,
      expenses,
      (additions - deductions - expenses)::numeric(14,2) as net_balance,
      pending_inflow,
      pending_outflow,
      entry_count,
      pending_count
    from agg
    where method_key <> 'UNTAGGED' or entry_count > 0 or pending_count > 0
  )
  select case
    when ctx.role_name not in ('ADMIN', 'TREASURER', 'MEMBER') or ctx.group_id is null then null
    else jsonb_build_object(
      'cycle_start_date', (select cycle_start_date from grp limit 1),
      'tracked_savings', coalesce((select sum(net_balance) from channel_rows), 0),
      'physical_cash_balance', coalesce((select net_balance from channel_rows where method_key = 'CASH'), 0),
      'digital_wallet_balance', coalesce((select sum(net_balance) from channel_rows where method_key in ('GCASH', 'MAYA', 'BANK_TRANSFER')), 0),
      'other_balance', coalesce((select net_balance from channel_rows where method_key = 'OTHER'), 0),
      'untagged_balance', coalesce((select net_balance from channel_rows where method_key = 'UNTAGGED'), 0),
      'has_untagged', exists (select 1 from channel_rows where method_key = 'UNTAGGED'),
      'channels', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'method', cr.method_key,
              'additions', cr.additions,
              'deductions', cr.deductions,
              'expenses', cr.expenses,
              'net_balance', cr.net_balance,
              'pending_inflow', cr.pending_inflow,
              'pending_outflow', cr.pending_outflow,
              'entry_count', cr.entry_count,
              'pending_count', cr.pending_count
            )
            order by cr.sort_order
          )
          from channel_rows cr
        ),
        '[]'::jsonb
      )
    )
  end
  from ctx;
$$;

revoke execute on function public.normalized_payment_method(text) from public, anon;
revoke execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid, text, text) from public, anon;
revoke execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean, text) from public, anon;
revoke execute on function public.update_contribution(uuid, numeric, date, text, text, text) from public, anon;
revoke execute on function public.record_withdrawal(date, numeric, text, text, text, text, text, uuid, text) from public, anon;
revoke execute on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text, text) from public, anon;
revoke execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid, text, text) from public, anon;
revoke execute on function public.update_expense(uuid, date, numeric, text, text, text, text, text, text) from public, anon;
revoke execute on function public.get_pending_review_summary() from public, anon;
revoke execute on function public.get_wallet_reconciliation() from public, anon;

grant execute on function public.normalized_payment_method(text) to authenticated;
grant execute on function public.record_contribution(uuid, date, numeric, date, text, text, uuid, text, text) to authenticated;
grant execute on function public.record_contribution_with_carryover(uuid, date, numeric, date, text, text, uuid, text, boolean, text) to authenticated;
grant execute on function public.update_contribution(uuid, numeric, date, text, text, text) to authenticated;
grant execute on function public.record_withdrawal(date, numeric, text, text, text, text, text, uuid, text) to authenticated;
grant execute on function public.update_withdrawal(uuid, date, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.record_expense(date, numeric, text, text, text, text, text, uuid, text, text) to authenticated;
grant execute on function public.update_expense(uuid, date, numeric, text, text, text, text, text, text) to authenticated;
grant execute on function public.get_pending_review_summary() to authenticated;
grant execute on function public.get_wallet_reconciliation() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_056', 'add payment method tagging and wallet reconciliation')
on conflict (version) do nothing;

commit;

