-- Migration 102: Per-member granular workspace permissions and calendar entry change-request approval workflow.

begin;

-- 1. Add per-member permission columns to group_memberships
do $$
declare
  v_had_cols boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'group_memberships'
      and column_name = 'can_record_expenses'
  ) into v_had_cols;

  alter table public.group_memberships
    add column if not exists can_edit_own_entries boolean not null default true,
    add column if not exists require_edit_approval boolean not null default true,
    add column if not exists require_add_approval boolean not null default true,
    add column if not exists can_record_expenses boolean not null default false,
    add column if not exists require_expense_approval boolean not null default true,
    add column if not exists can_record_withdrawals boolean not null default false,
    add column if not exists require_withdrawal_approval boolean not null default true;

  if not v_had_cols then
    update public.group_memberships
    set can_edit_own_entries = true,
        require_edit_approval = (role <> 'ADMIN'),
        require_add_approval = (role <> 'ADMIN'),
        can_record_expenses = (role in ('ADMIN', 'TREASURER')),
        require_expense_approval = (role <> 'ADMIN'),
        can_record_withdrawals = (role in ('ADMIN', 'TREASURER')),
        require_withdrawal_approval = (role <> 'ADMIN');
  end if;
end $$;

create or replace function public.sync_group_membership_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'ADMIN' then
    new.can_edit_own_entries := true;
    new.require_edit_approval := false;
    new.require_add_approval := false;
    new.can_record_expenses := true;
    new.require_expense_approval := false;
    new.can_record_withdrawals := true;
    new.require_withdrawal_approval := false;
  elsif tg_op = 'INSERT' and new.role = 'TREASURER' then
    new.can_record_expenses := true;
    new.can_record_withdrawals := true;
  elsif tg_op = 'UPDATE' and old.role is distinct from new.role then
    if new.role = 'TREASURER' then
      new.can_edit_own_entries := true;
      new.require_edit_approval := true;
      new.require_add_approval := true;
      new.can_record_expenses := true;
      new.require_expense_approval := true;
      new.can_record_withdrawals := true;
      new.require_withdrawal_approval := true;
    elsif new.role = 'MEMBER' then
      new.can_edit_own_entries := true;
      new.require_edit_approval := true;
      new.require_add_approval := true;
      new.can_record_expenses := false;
      new.require_expense_approval := true;
      new.can_record_withdrawals := false;
      new.require_withdrawal_approval := true;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists group_memberships_role_permissions on public.group_memberships;
create trigger group_memberships_role_permissions
  before insert or update of role on public.group_memberships
  for each row execute function public.sync_group_membership_role_permissions();

revoke execute on function public.sync_group_membership_role_permissions() from public, anon, authenticated;

-- 2. Create financial_change_requests table for audited Calendar entry edits & approvals
create table if not exists public.financial_change_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  record_type text not null check (record_type in ('contribution', 'withdrawal', 'expense')),
  record_id uuid not null,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  current_amount numeric(14,2) not null,
  current_payment_method text,
  current_notes text,
  entry_date date,
  proposed_amount numeric(14,2) not null check (proposed_amount > 0 and proposed_amount <= 999999999999.99),
  proposed_payment_method text,
  proposed_notes text,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(btrim(review_note)) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_change_requests_one_pending_idx
  on public.financial_change_requests (group_id, record_type, record_id)
  where status = 'PENDING';

create index if not exists financial_change_requests_group_status_idx
  on public.financial_change_requests (group_id, status, created_at desc);

create index if not exists financial_change_requests_requester_idx
  on public.financial_change_requests (requested_by, created_at desc);

alter table public.financial_change_requests enable row level security;
alter table public.financial_change_requests force row level security;

drop policy if exists mfa_verified_for_opted_in on public.financial_change_requests;
create policy mfa_verified_for_opted_in on public.financial_change_requests
  as restrictive for all to authenticated
  using (public.mfa_access_allowed());

drop policy if exists financial_change_requests_select on public.financial_change_requests;
create policy financial_change_requests_select on public.financial_change_requests
  for select to authenticated
  using (
    group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

drop trigger if exists financial_change_requests_updated_at on public.financial_change_requests;
create trigger financial_change_requests_updated_at
  before update on public.financial_change_requests
  for each row execute function public.set_updated_at();

drop trigger if exists financial_change_requests_group_scope on public.financial_change_requests;
create trigger financial_change_requests_group_scope
  before insert or update on public.financial_change_requests
  for each row execute function public.enforce_group_scope();

drop trigger if exists financial_change_requests_audit on public.financial_change_requests;
create trigger financial_change_requests_audit
  after insert or update or delete on public.financial_change_requests
  for each row execute function public.write_audit_log();

revoke all on public.financial_change_requests from public, anon, authenticated;
grant select on public.financial_change_requests to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'financial_change_requests'
     ) then
    alter publication supabase_realtime add table public.financial_change_requests;
  end if;
exception when others then null;
end $$;

-- 3. Permission resolution helper + client RPCs
create or replace function public.current_member_permissions(
  p_group_id uuid default public.current_group_id(),
  p_user_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gm public.group_memberships;
  v_role public.app_role;
begin
  if p_user_id is null or p_group_id is null then
    return jsonb_build_object(
      'role', null,
      'can_edit_own_entries', false,
      'require_edit_approval', true,
      'require_add_approval', true,
      'can_record_expenses', false,
      'require_expense_approval', true,
      'can_record_withdrawals', false,
      'require_withdrawal_approval', true
    );
  end if;

  select * into v_gm
  from public.group_memberships gm
  where gm.group_id = p_group_id
    and gm.user_id = p_user_id
    and gm.status = 'ACTIVE'
  limit 1;

  if found then
    if v_gm.role = 'ADMIN' then
      return jsonb_build_object(
        'role', v_gm.role,
        'can_edit_own_entries', true,
        'require_edit_approval', false,
        'require_add_approval', false,
        'can_record_expenses', true,
        'require_expense_approval', false,
        'can_record_withdrawals', true,
        'require_withdrawal_approval', false
      );
    end if;
    return jsonb_build_object(
      'role', v_gm.role,
      'can_edit_own_entries', coalesce(v_gm.can_edit_own_entries, true),
      'require_edit_approval', coalesce(v_gm.require_edit_approval, true),
      'require_add_approval', coalesce(v_gm.require_add_approval, true),
      'can_record_expenses', coalesce(v_gm.can_record_expenses, v_gm.role = 'TREASURER'),
      'require_expense_approval', coalesce(v_gm.require_expense_approval, true),
      'can_record_withdrawals', coalesce(v_gm.can_record_withdrawals, v_gm.role = 'TREASURER'),
      'require_withdrawal_approval', coalesce(v_gm.require_withdrawal_approval, true)
    );
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = p_user_id
    and p.group_id = p_group_id
    and p.status = 'ACTIVE'
  limit 1;

  return jsonb_build_object(
    'role', v_role,
    'can_edit_own_entries', true,
    'require_edit_approval', (v_role <> 'ADMIN'),
    'require_add_approval', (v_role <> 'ADMIN'),
    'can_record_expenses', (v_role in ('ADMIN', 'TREASURER')),
    'require_expense_approval', (v_role <> 'ADMIN'),
    'can_record_withdrawals', (v_role in ('ADMIN', 'TREASURER')),
    'require_withdrawal_approval', (v_role <> 'ADMIN')
  );
end;
$$;

create or replace function public.get_my_member_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.current_member_permissions(public.current_group_id(), auth.uid());
$$;

create or replace function public.get_member_permissions_list()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an active group administrator can view member permissions.' using errcode = '42501';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'user_id', gm.user_id,
          'member_id', gm.member_id,
          'full_name', coalesce(m.full_name, p.full_name),
          'email', p.email,
          'avatar_url', case when p.status = 'ACTIVE' then p.avatar_url else null end,
          'role', gm.role,
          'status', gm.status,
          'can_edit_own_entries', case when gm.role = 'ADMIN' then true else coalesce(gm.can_edit_own_entries, true) end,
          'require_edit_approval', case when gm.role = 'ADMIN' then false else coalesce(gm.require_edit_approval, true) end,
          'require_add_approval', case when gm.role = 'ADMIN' then false else coalesce(gm.require_add_approval, true) end,
          'can_record_expenses', case when gm.role = 'ADMIN' then true else coalesce(gm.can_record_expenses, gm.role = 'TREASURER') end,
          'require_expense_approval', case when gm.role = 'ADMIN' then false else coalesce(gm.require_expense_approval, true) end,
          'can_record_withdrawals', case when gm.role = 'ADMIN' then true else coalesce(gm.can_record_withdrawals, gm.role = 'TREASURER') end,
          'require_withdrawal_approval', case when gm.role = 'ADMIN' then false else coalesce(gm.require_withdrawal_approval, true) end
        )
        order by
          case gm.role when 'ADMIN' then 0 when 'TREASURER' then 1 else 2 end,
          coalesce(m.full_name, p.full_name) asc
      )
      from public.group_memberships gm
      join public.profiles p on p.id = gm.user_id
      left join public.members m on m.id = gm.member_id and m.deleted_at is null
      where gm.group_id = v_group_id
        and gm.status in ('ACTIVE', 'PENDING')
        and p.role <> 'SUPER_ADMIN'
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.update_member_permissions(
  p_user_id uuid,
  p_can_edit_own_entries boolean,
  p_require_edit_approval boolean,
  p_require_add_approval boolean,
  p_can_record_expenses boolean,
  p_require_expense_approval boolean,
  p_can_record_withdrawals boolean,
  p_require_withdrawal_approval boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_target public.group_memberships;
  v_group_name text;
  v_parts text[] := array[]::text[];
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an active group administrator can update member permissions.' using errcode = '42501';
  end if;

  select * into v_target
  from public.group_memberships gm
  where gm.group_id = v_group_id
    and gm.user_id = p_user_id
    and gm.status in ('ACTIVE', 'PENDING')
  for update;

  if not found then
    raise exception 'Group member account not found.' using errcode = 'P0002';
  end if;
  if v_target.role = 'ADMIN' then
    raise exception 'Administrator accounts keep full permissions in their workspace.' using errcode = '22023';
  end if;

  update public.group_memberships
  set can_edit_own_entries = coalesce(p_can_edit_own_entries, true),
      require_edit_approval = coalesce(p_require_edit_approval, true),
      require_add_approval = coalesce(p_require_add_approval, true),
      can_record_expenses = coalesce(p_can_record_expenses, false),
      require_expense_approval = coalesce(p_require_expense_approval, true),
      can_record_withdrawals = coalesce(p_can_record_withdrawals, false),
      require_withdrawal_approval = coalesce(p_require_withdrawal_approval, true)
  where id = v_target.id
  returning * into v_target;

  select name into v_group_name from public.groups where id = v_group_id;

  v_parts := array_append(
    v_parts,
    case
      when not v_target.can_edit_own_entries then 'Calendar edits: disabled'
      when v_target.require_edit_approval then 'Calendar edits: approval required'
      else 'Calendar edits: instant'
    end
  );
  v_parts := array_append(
    v_parts,
    case when v_target.require_add_approval then 'Additions: approval required' else 'Additions: instant confirm' end
  );
  if v_target.can_record_expenses then
    v_parts := array_append(
      v_parts,
      case when v_target.require_expense_approval then 'Expenses: allowed (approval required)' else 'Expenses: allowed (instant)' end
    );
  end if;
  if v_target.can_record_withdrawals then
    v_parts := array_append(
      v_parts,
      case when v_target.require_withdrawal_approval then 'Deductions: allowed (approval required)' else 'Deductions: allowed (instant)' end
    );
  end if;

  perform public.push_notification(
    v_target.user_id,
    'PERMISSION_UPDATED',
    'Workspace permissions updated',
    'Your admin updated your permissions in "' || coalesce(v_group_name, 'your group') || '": ' || array_to_string(v_parts, ' · ') || '.',
    'dashboard.html',
    v_group_id
  );

  return jsonb_build_object(
    'user_id', v_target.user_id,
    'role', v_target.role,
    'can_edit_own_entries', v_target.can_edit_own_entries,
    'require_edit_approval', v_target.require_edit_approval,
    'require_add_approval', v_target.require_add_approval,
    'can_record_expenses', v_target.can_record_expenses,
    'require_expense_approval', v_target.require_expense_approval,
    'can_record_withdrawals', v_target.can_record_withdrawals,
    'require_withdrawal_approval', v_target.require_withdrawal_approval
  );
end;
$$;

-- 4. Upgrade financial write RPCs to honor per-member permissions
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
  v_perms jsonb := public.current_member_permissions(v_group_id, auth.uid());
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
  if not public.is_valid_media_reference(v_receipt) then
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

  v_status := case
    when v_role = 'ADMIN' or not coalesce((v_perms ->> 'require_add_approval')::boolean, true) then 'CONFIRMED'
    else 'PENDING'
  end;

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
  v_perms jsonb := public.current_member_permissions(v_group_id, auth.uid());
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
  if not public.is_valid_media_reference(v_receipt) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_role = 'MEMBER' and public.current_member_id() is distinct from p_member_id then
    raise exception 'Members can only submit their own savings entries.' using errcode = '42501';
  end if;

  select id into v_first_id from public.contributions where idempotency_key = p_idempotency_key;
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

  v_status := case
    when v_role = 'ADMIN' or not coalesce((v_perms ->> 'require_add_approval')::boolean, true) then 'CONFIRMED'
    else 'PENDING'
  end;
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

    select id, required_amount, is_exempt, coalesce(archived_paid_amount, 0) as archived_paid_amount into v_period
    from public.contribution_periods
    where member_id = p_member_id and period_month = v_cursor_month;

    if not coalesce(v_period.is_exempt, false) then
      select coalesce(sum(amount) filter (where approval_status in ('CONFIRMED', 'PENDING')), 0)::numeric(14,2)
      into v_covered
      from public.contributions
      where contribution_period_id = v_period.id;

      v_covered := coalesce(v_covered, 0) + coalesce(v_period.archived_paid_amount, 0);

      v_needed := greatest(v_period.required_amount - coalesce(v_covered, 0), 0);
      if v_needed > 0 then
        v_slice := least(v_remaining, v_needed);
        v_use_receipt := case when coalesce(array_length(v_ids, 1), 0) = 0 then v_receipt else null end;
        v_slice_key := case when coalesce(array_length(v_ids, 1), 0) = 0 then p_idempotency_key else gen_random_uuid() end;
        v_slice_notes := case
          when coalesce(array_length(v_ids, 1), 0) = 0 then left(v_notes, 500)
          else left(trim(both ' ' from concat_ws(' · ', 'Advance carry-over from ' || to_char(v_month, 'Mon YYYY'), v_notes)), 500)
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
      left(trim(both ' ' from concat_ws(' · ', v_notes, 'Excess beyond 24 months')), 500),
      v_use_receipt, v_method, v_status, auth.uid(),
      case when v_status = 'CONFIRMED' then auth.uid() end,
      case when v_status = 'CONFIRMED' then now() end
    ) returning id into v_id;

    v_ids := array_append(v_ids, v_id);
  end if;

  return jsonb_build_object('ids', v_ids, 'months_covered', coalesce(array_length(v_ids, 1), 0));
end;
$$;

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
  v_group_id uuid := public.current_group_id();
  v_perms jsonb := public.current_member_permissions(v_group_id, auth.uid());
  v_can_record boolean := v_role = 'ADMIN' or coalesce((v_perms ->> 'can_record_withdrawals')::boolean, v_role = 'TREASURER');
  v_status public.approval_status;
  v_id uuid;
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if not v_can_record then
    raise exception 'You do not have permission to record deductions.' using errcode = '42501';
  end if;
  v_status := case
    when v_role = 'ADMIN' or not coalesce((v_perms ->> 'require_withdrawal_approval')::boolean, true) then 'CONFIRMED'
    else 'PENDING'
  end;

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
  v_group_id uuid := public.current_group_id();
  v_perms jsonb := public.current_member_permissions(v_group_id, auth.uid());
  v_can_record boolean := v_role = 'ADMIN' or coalesce((v_perms ->> 'can_record_expenses')::boolean, v_role = 'TREASURER');
  v_status public.approval_status;
  v_id uuid;
  v_receipt text := nullif(btrim(coalesce(p_receipt_url, '')), '');
  v_method text := public.normalized_payment_method(p_payment_method);
begin
  if v_role is null or v_group_id is null then
    raise exception 'Your account is not active.' using errcode = '42501';
  end if;
  if not v_can_record then
    raise exception 'You do not have permission to record expenses.' using errcode = '42501';
  end if;
  if not public.is_valid_media_reference(v_receipt) then
    raise exception 'Receipt must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  v_status := case
    when v_role = 'ADMIN' or not coalesce((v_perms ->> 'require_expense_approval')::boolean, true) then 'CONFIRMED'
    else 'PENDING'
  end;

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
  v_perms jsonb := public.current_member_permissions(v_group_id, auth.uid());
  v_next_method text;
begin
  select * into v_entry
  from public.withdrawals
  where id = p_withdrawal_id and group_id = v_group_id;
  if not found then raise exception 'Withdrawal not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then
    raise exception 'Confirmed withdrawals must use the calendar edit request workflow.' using errcode = '22023';
  end if;
  if v_role <> 'ADMIN' and not (
    v_role = 'TREASURER' or (v_entry.submitted_by = auth.uid() and coalesce((v_perms ->> 'can_edit_own_entries')::boolean, true))
  ) then
    raise exception 'You are not allowed to edit this entry.' using errcode = '42501';
  end if;

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
  v_perms jsonb := public.current_member_permissions(v_group_id, auth.uid());
  v_next_method text;
begin
  select * into v_entry
  from public.expenses
  where id = p_expense_id and group_id = v_group_id;
  if not found then raise exception 'Expense not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then
    raise exception 'Confirmed expenses must use the calendar edit request workflow.' using errcode = '22023';
  end if;
  if v_role <> 'ADMIN' and not (
    v_role = 'TREASURER' or (v_entry.submitted_by = auth.uid() and coalesce((v_perms ->> 'can_edit_own_entries')::boolean, true))
  ) then
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

-- 5. Calendar entry edit / change-request workflow RPCs
create or replace function public.submit_record_change_request(
  p_record_type text,
  p_record_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_perms jsonb;
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_new_amount numeric(14,2);
  v_new_method text := public.normalized_payment_method(p_payment_method);
  v_new_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_old_amount numeric(14,2);
  v_old_method text;
  v_old_notes text;
  v_old_date date;
  v_old_status public.approval_status;
  v_submitted_by uuid;
  v_subject_member_id uuid;
  v_subject_name text;
  v_requester_name text;
  v_direct_apply boolean;
  v_req public.financial_change_requests;
  v_admin record;
  v_member_user record;
  v_label text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if v_group_id is null or v_role is null then
    raise exception 'Your workspace membership is not active.' using errcode = '42501';
  end if;
  if v_type not in ('contribution', 'withdrawal', 'expense') then
    raise exception 'Unsupported entry type.' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 500 then
    raise exception 'Enter a reason between 3 and 500 characters explaining this change.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_new_notes, '')) > 500 then
    raise exception 'Notes must not exceed 500 characters.' using errcode = '22023';
  end if;

  v_new_amount := public.validated_money(p_amount, 'Amount');
  v_perms := public.current_member_permissions(v_group_id, auth.uid());

  if v_type = 'contribution' then
    select c.amount, c.payment_method, c.notes, c.payment_date, c.approval_status, c.submitted_by, cp.member_id, m.full_name
    into v_old_amount, v_old_method, v_old_notes, v_old_date, v_old_status, v_submitted_by, v_subject_member_id, v_subject_name
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id and c.group_id = v_group_id;
    v_label := 'contribution';
  elsif v_type = 'withdrawal' then
    select w.amount, w.payment_method, w.notes, w.transaction_date, w.approval_status, w.submitted_by, null::uuid, w.person_responsible
    into v_old_amount, v_old_method, v_old_notes, v_old_date, v_old_status, v_submitted_by, v_subject_member_id, v_subject_name
    from public.withdrawals w
    where w.id = p_record_id and w.group_id = v_group_id;
    v_label := 'deduction';
  else
    select e.amount, e.payment_method, e.notes, e.transaction_date, e.approval_status, e.submitted_by, null::uuid, e.person_responsible
    into v_old_amount, v_old_method, v_old_notes, v_old_date, v_old_status, v_submitted_by, v_subject_member_id, v_subject_name
    from public.expenses e
    where e.id = p_record_id and e.group_id = v_group_id;
    v_label := 'expense';
  end if;

  if not found then
    raise exception 'Calendar entry not found in this workspace.' using errcode = 'P0002';
  end if;
  if v_old_status not in ('PENDING', 'CONFIRMED') then
    raise exception 'Rejected or voided entries cannot be modified.' using errcode = '22023';
  end if;

  if v_role <> 'ADMIN' then
    if not coalesce((v_perms ->> 'can_edit_own_entries')::boolean, true) then
      raise exception 'Editing calendar entries is disabled for your account by your administrator.' using errcode = '42501';
    end if;
    if v_submitted_by is distinct from auth.uid()
       and not (v_type = 'contribution' and v_subject_member_id is not null and v_subject_member_id = public.current_member_id())
    then
      raise exception 'You can only edit or request changes on your own entries.' using errcode = '42501';
    end if;
  end if;

  if v_new_amount = v_old_amount
     and coalesce(v_new_method, '') = coalesce(v_old_method, '')
     and coalesce(v_new_notes, '') = coalesce(nullif(btrim(coalesce(v_old_notes, '')), ''), '')
  then
    raise exception 'No changes detected. Update the amount, payment method, or notes before submitting.' using errcode = '22023';
  end if;

  select coalesce(nullif(btrim(full_name), ''), 'Group user') into v_requester_name
  from public.profiles where id = auth.uid();

  v_direct_apply := (v_role = 'ADMIN') or not coalesce((v_perms ->> 'require_edit_approval')::boolean, true);

  if v_direct_apply then
    if v_type = 'contribution' then
      update public.contributions
      set amount = v_new_amount,
          payment_method = v_new_method,
          notes = v_new_notes
      where id = p_record_id and group_id = v_group_id;
    elsif v_type = 'withdrawal' then
      update public.withdrawals
      set amount = v_new_amount,
          payment_method = v_new_method,
          notes = v_new_notes
      where id = p_record_id and group_id = v_group_id;
    else
      update public.expenses
      set amount = v_new_amount,
          payment_method = v_new_method,
          notes = v_new_notes
      where id = p_record_id and group_id = v_group_id;

      update public.budget_expenses
      set amount = v_new_amount,
          payment_method = coalesce(v_new_method, payment_method),
          note = coalesce(v_new_notes, note)
      where linked_expense_id = p_record_id and group_id = v_group_id;
    end if;

    insert into public.financial_change_requests (
      group_id, record_type, record_id, requested_by, status,
      current_amount, current_payment_method, current_notes, entry_date,
      proposed_amount, proposed_payment_method, proposed_notes, reason,
      reviewed_by, reviewed_at, review_note
    ) values (
      v_group_id, v_type, p_record_id, auth.uid(), 'APPROVED',
      v_old_amount, v_old_method, v_old_notes, v_old_date,
      v_new_amount, v_new_method, v_new_notes, v_reason,
      auth.uid(), now(),
      case when v_role = 'ADMIN' then 'Updated directly by administrator' else 'Auto-approved by direct edit permission' end
    ) returning * into v_req;

    if v_role <> 'ADMIN' then
      for v_admin in select user_id as id from public.group_admin_ids(v_group_id) loop
        perform public.push_notification(
          v_admin.id,
          'RECORD_UPDATED',
          initcap(v_label) || ' edited directly',
          left(
            v_requester_name || ' updated ' || coalesce(v_subject_name, v_label) || ' (' || to_char(v_old_date, 'Mon DD, YYYY') || ') from PHP '
            || to_char(v_old_amount, 'FM999,999,990.00') || ' (' || coalesce(v_old_method, 'Untagged') || ') to PHP '
            || to_char(v_new_amount, 'FM999,999,990.00') || ' (' || coalesce(v_new_method, 'Untagged') || '). Reason: ' || v_reason,
            500
          ),
          'dashboard.html?day=' || to_char(v_old_date, 'YYYY-MM-DD'),
          v_group_id
        );
      end loop;
    elsif v_type = 'contribution' and v_subject_member_id is not null then
      for v_member_user in
        select distinct gm.user_id as id
        from public.group_memberships gm
        where gm.group_id = v_group_id
          and gm.member_id = v_subject_member_id
          and gm.status = 'ACTIVE'
          and gm.user_id is distinct from auth.uid()
      loop
        perform public.push_notification(
          v_member_user.id,
          'RECORD_UPDATED',
          'Contribution entry updated',
          left(
            'An administrator updated your ' || to_char(v_old_date, 'Mon DD, YYYY') || ' contribution from PHP '
            || to_char(v_old_amount, 'FM999,999,990.00') || ' to PHP '
            || to_char(v_new_amount, 'FM999,999,990.00') || '. Reason: ' || v_reason,
            500
          ),
          'dashboard.html?day=' || to_char(v_old_date, 'YYYY-MM-DD'),
          v_group_id
        );
      end loop;
    end if;

    return jsonb_build_object(
      'status', 'APPLIED',
      'request_id', v_req.id,
      'message', 'Calendar entry updated.'
    );
  end if;

  if exists (
    select 1
    from public.financial_change_requests fcr
    where fcr.group_id = v_group_id
      and fcr.record_type = v_type
      and fcr.record_id = p_record_id
      and fcr.status = 'PENDING'
  ) then
    raise exception 'A change request for this entry is already waiting for administrator approval.' using errcode = '23505';
  end if;

  insert into public.financial_change_requests (
    group_id, record_type, record_id, requested_by, status,
    current_amount, current_payment_method, current_notes, entry_date,
    proposed_amount, proposed_payment_method, proposed_notes, reason
  ) values (
    v_group_id, v_type, p_record_id, auth.uid(), 'PENDING',
    v_old_amount, v_old_method, v_old_notes, v_old_date,
    v_new_amount, v_new_method, v_new_notes, v_reason
  ) returning * into v_req;

  for v_admin in select user_id as id from public.group_admin_ids(v_group_id) loop
    perform public.push_notification(
      v_admin.id,
      'RECORD_CHANGE_REQUESTED',
      'Change request: ' || initcap(v_label),
      left(
        v_requester_name || ' requested to change ' || coalesce(v_subject_name, v_label) || ' (' || to_char(v_old_date, 'Mon DD, YYYY') || ') from PHP '
        || to_char(v_old_amount, 'FM999,999,990.00') || ' (' || coalesce(v_old_method, 'Untagged') || ') to PHP '
        || to_char(v_new_amount, 'FM999,999,990.00') || ' (' || coalesce(v_new_method, 'Untagged') || '). Reason: ' || v_reason,
        500
      ),
      'dashboard.html?change_request=' || v_req.id::text,
      v_group_id
    );
  end loop;

  return jsonb_build_object(
    'status', 'PENDING_APPROVAL',
    'request_id', v_req.id,
    'message', 'Change request sent to your administrator for approval.'
  );
end;
$$;

create or replace function public.review_financial_change_request(
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
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_req public.financial_change_requests;
  v_label text;
  v_subject_member_id uuid;
  v_member_user record;
  v_msg text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only an active group administrator can review change requests.' using errcode = '42501';
  end if;
  if v_decision not in ('APPROVED', 'REJECTED') then
    raise exception 'Decision must be APPROVED or REJECTED.' using errcode = '22023';
  end if;
  if v_decision = 'REJECTED' and char_length(coalesce(v_note, '')) < 2 then
    raise exception 'A rejection reason is required.' using errcode = '22023';
  end if;

  select * into v_req
  from public.financial_change_requests fcr
  where fcr.id = p_request_id
    and fcr.group_id = v_group_id
    and fcr.status = 'PENDING'
  for update;

  if not found then
    raise exception 'Pending change request not found.' using errcode = 'P0002';
  end if;

  v_label := case v_req.record_type
    when 'contribution' then 'contribution'
    when 'withdrawal' then 'deduction'
    else 'expense'
  end;

  if v_decision = 'APPROVED' then
    if v_req.record_type = 'contribution' then
      update public.contributions
      set amount = v_req.proposed_amount,
          payment_method = v_req.proposed_payment_method,
          notes = v_req.proposed_notes
      where id = v_req.record_id
        and group_id = v_group_id
        and approval_status in ('PENDING', 'CONFIRMED');

      if not found then
        raise exception 'The original contribution was already voided or rejected and can no longer be edited.' using errcode = 'P0002';
      end if;

      select cp.member_id into v_subject_member_id
      from public.contributions c
      join public.contribution_periods cp on cp.id = c.contribution_period_id
      where c.id = v_req.record_id;
    elsif v_req.record_type = 'withdrawal' then
      update public.withdrawals
      set amount = v_req.proposed_amount,
          payment_method = v_req.proposed_payment_method,
          notes = v_req.proposed_notes
      where id = v_req.record_id
        and group_id = v_group_id
        and approval_status in ('PENDING', 'CONFIRMED');

      if not found then
        raise exception 'The original deduction was already voided or rejected and can no longer be edited.' using errcode = 'P0002';
      end if;
    else
      update public.expenses
      set amount = v_req.proposed_amount,
          payment_method = v_req.proposed_payment_method,
          notes = v_req.proposed_notes
      where id = v_req.record_id
        and group_id = v_group_id
        and approval_status in ('PENDING', 'CONFIRMED');

      if not found then
        raise exception 'The original expense was already voided or rejected and can no longer be edited.' using errcode = 'P0002';
      end if;

      update public.budget_expenses
      set amount = v_req.proposed_amount,
          payment_method = coalesce(v_req.proposed_payment_method, payment_method),
          note = coalesce(v_req.proposed_notes, note)
      where linked_expense_id = v_req.record_id and group_id = v_group_id;
    end if;
  end if;

  update public.financial_change_requests
  set status = v_decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = v_note
  where id = v_req.id;

  v_msg := case
    when v_decision = 'APPROVED' then
      'Your change request for ' || v_label || ' (' || to_char(v_req.entry_date, 'Mon DD, YYYY') || ') was approved: PHP '
      || to_char(v_req.current_amount, 'FM999,999,990.00') || ' → PHP ' || to_char(v_req.proposed_amount, 'FM999,999,990.00')
      || ' (' || coalesce(v_req.proposed_payment_method, 'Untagged') || ').'
    else
      'Your change request for ' || v_label || ' (' || to_char(v_req.entry_date, 'Mon DD, YYYY') || ') was rejected.'
  end || case when v_note is not null then E'\nNote: ' || v_note else '' end;

  perform public.push_notification(
    v_req.requested_by,
    'RECORD_CHANGE_REVIEWED',
    case when v_decision = 'APPROVED' then 'Change request approved' else 'Change request rejected' end,
    left(v_msg, 500),
    'dashboard.html?day=' || to_char(v_req.entry_date, 'YYYY-MM-DD'),
    v_group_id
  );

  if v_decision = 'APPROVED' and v_req.record_type = 'contribution' and v_subject_member_id is not null then
    for v_member_user in
      select distinct gm.user_id as id
      from public.group_memberships gm
      where gm.group_id = v_group_id
        and gm.member_id = v_subject_member_id
        and gm.status = 'ACTIVE'
        and gm.user_id is distinct from v_req.requested_by
        and gm.user_id is distinct from auth.uid()
    loop
      perform public.push_notification(
        v_member_user.id,
        'RECORD_CHANGE_REVIEWED',
        'Contribution entry updated',
        left('A contribution on ' || to_char(v_req.entry_date, 'Mon DD, YYYY') || ' was updated to PHP ' || to_char(v_req.proposed_amount, 'FM999,999,990.00') || '.', 500),
        'dashboard.html?day=' || to_char(v_req.entry_date, 'YYYY-MM-DD'),
        v_group_id
      );
    end loop;
  end if;

  return jsonb_build_object(
    'status', v_decision,
    'request_id', v_req.id,
    'message', case when v_decision = 'APPROVED' then 'Change request approved and entry updated.' else 'Change request rejected.' end
  );
end;
$$;

create or replace function public.cancel_financial_change_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  update public.financial_change_requests
  set status = 'CANCELLED',
      updated_at = now()
  where id = p_request_id
    and group_id = v_group_id
    and requested_by = auth.uid()
    and status = 'PENDING';

  if not found then
    raise exception 'Pending change request not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.get_pending_financial_change_requests()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
      and public.current_group_id() is not null
    then coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', fcr.id,
            'record_type', fcr.record_type,
            'record_id', fcr.record_id,
            'entry_label', case fcr.record_type when 'contribution' then 'Savings Addition' when 'withdrawal' then 'Deduction' else 'Expense' end,
            'requested_by', fcr.requested_by,
            'requested_by_name', coalesce(nullif(btrim(rp.full_name), ''), 'Group member'),
            'requested_by_role', coalesce(rgm.role::text, rp.role::text, 'MEMBER'),
            'avatar_url', case when rp.status = 'ACTIVE' then rp.avatar_url else null end,
            'subject_name', coalesce(
              case
                when fcr.record_type = 'contribution' then (
                  select m.full_name
                  from public.contributions c
                  join public.contribution_periods cp on cp.id = c.contribution_period_id
                  join public.members m on m.id = cp.member_id
                  where c.id = fcr.record_id
                  limit 1
                )
                when fcr.record_type = 'withdrawal' then (select w.person_responsible from public.withdrawals w where w.id = fcr.record_id limit 1)
                else (select e.person_responsible from public.expenses e where e.id = fcr.record_id limit 1)
              end,
              rp.full_name,
              'Group entry'
            ),
            'current_amount', fcr.current_amount,
            'current_payment_method', fcr.current_payment_method,
            'current_notes', fcr.current_notes,
            'entry_date', fcr.entry_date,
            'proposed_amount', fcr.proposed_amount,
            'proposed_payment_method', fcr.proposed_payment_method,
            'proposed_notes', fcr.proposed_notes,
            'reason', fcr.reason,
            'status', fcr.status,
            'created_at', fcr.created_at
          )
          order by fcr.created_at desc
        )
        from public.financial_change_requests fcr
        join public.profiles rp on rp.id = fcr.requested_by
        left join public.group_memberships rgm
          on rgm.group_id = fcr.group_id
         and rgm.user_id = fcr.requested_by
         and rgm.status = 'ACTIVE'
        where fcr.group_id = public.current_group_id()
          and fcr.status = 'PENDING'
      ),
      '[]'::jsonb
    )
    else '[]'::jsonb
  end;
$$;

-- 6. Enrich get_pending_review_summary() with pending financial change requests
create or replace function public.get_pending_review_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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
    left join public.group_memberships sgm
      on sgm.group_id = c.group_id
     and sgm.user_id = c.submitted_by
     and sgm.status = 'ACTIVE'
    left join public.profiles sp
      on sp.id = c.submitted_by
     and (sp.group_id = c.group_id or sgm.id is not null)
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
    left join public.group_memberships sgm
      on sgm.group_id = w.group_id
     and sgm.user_id = w.submitted_by
     and sgm.status = 'ACTIVE'
    left join public.profiles sp
      on sp.id = w.submitted_by
     and (sp.group_id = w.group_id or sgm.id is not null)
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
    left join public.group_memberships sgm
      on sgm.group_id = e.group_id
     and sgm.user_id = e.submitted_by
     and sgm.status = 'ACTIVE'
    left join public.profiles sp
      on sp.id = e.submitted_by
     and (sp.group_id = e.group_id or sgm.id is not null)
    where e.approval_status = 'PENDING'
  ),
  recent as (
    select * from entries order by created_at desc limit 3
  ),
  cr_list as (
    select public.get_pending_financial_change_requests() as rows_json
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
      ),
      'change_request_count', coalesce((select jsonb_array_length(rows_json) from cr_list), 0),
      'change_requests', coalesce((select rows_json from cr_list), '[]'::jsonb)
    )
    else jsonb_build_object(
      'count', 0,
      'amount', 0,
      'items', '[]'::jsonb,
      'change_request_count', 0,
      'change_requests', '[]'::jsonb
    )
  end;
$$;

-- 7. Grants
revoke all on function public.current_member_permissions(uuid, uuid) from public, anon, authenticated;
revoke all on function public.get_my_member_permissions() from public, anon;
revoke all on function public.get_member_permissions_list() from public, anon;
revoke all on function public.update_member_permissions(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon;
revoke all on function public.submit_record_change_request(text, uuid, numeric, text, text, text) from public, anon;
revoke all on function public.review_financial_change_request(uuid, text, text) from public, anon;
revoke all on function public.cancel_financial_change_request(uuid) from public, anon;
revoke all on function public.get_pending_financial_change_requests() from public, anon;
revoke all on function public.get_pending_review_summary() from public, anon;

grant execute on function public.get_my_member_permissions() to authenticated;
grant execute on function public.get_member_permissions_list() to authenticated;
grant execute on function public.update_member_permissions(uuid, boolean, boolean, boolean, boolean, boolean, boolean, boolean) to authenticated;
grant execute on function public.submit_record_change_request(text, uuid, numeric, text, text, text) to authenticated;
grant execute on function public.review_financial_change_request(uuid, text, text) to authenticated;
grant execute on function public.cancel_financial_change_request(uuid) to authenticated;
grant execute on function public.get_pending_financial_change_requests() to authenticated;
grant execute on function public.get_pending_review_summary() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261117_102', 'add per-member workspace permissions and calendar entry change request workflow')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
