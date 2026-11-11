-- Keep transaction references private to each savings group and prevent member deductions.

begin;

drop index if exists public.contributions_reference_unique_idx;
create unique index contributions_reference_unique_idx
  on public.contributions (group_id, lower(btrim(transaction_reference)))
  where nullif(btrim(transaction_reference), '') is not null;

drop index if exists public.expenses_reference_unique_idx;
create unique index expenses_reference_unique_idx
  on public.expenses (group_id, lower(btrim(reference_number)))
  where nullif(btrim(reference_number), '') is not null;

drop index if exists public.withdrawals_reference_unique_idx;
create unique index withdrawals_reference_unique_idx
  on public.withdrawals (group_id, lower(btrim(reference_number)))
  where nullif(btrim(reference_number), '') is not null;

create or replace function public.record_withdrawal(
  p_transaction_date date,
  p_amount numeric,
  p_category text,
  p_description text,
  p_person_responsible text,
  p_reference_number text default null,
  p_notes text default null,
  p_idempotency_key uuid default gen_random_uuid()
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
begin
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'Only administrators and treasurers can record withdrawals.' using errcode = '42501'; end if;
  v_status := case when v_role = 'ADMIN' then 'CONFIRMED' else 'PENDING' end;

  insert into public.withdrawals (
    transaction_date, amount, category, description, person_responsible,
    reference_number, idempotency_key, notes, approval_status, submitted_by,
    reviewed_by, reviewed_at
  ) values (
    p_transaction_date, public.validated_money(p_amount, 'Withdrawal amount'), btrim(p_category), btrim(p_description),
    btrim(p_person_responsible), nullif(btrim(p_reference_number), ''),
    p_idempotency_key, nullif(btrim(p_notes), ''), v_status, auth.uid(),
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
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.withdrawals;
  v_role public.app_role := public.current_user_role();
begin
  select * into v_entry from public.withdrawals where id = p_withdrawal_id;
  if not found then raise exception 'Withdrawal not found.' using errcode = 'P0002'; end if;
  if v_role is null then raise exception 'Your account is not active.' using errcode = '42501'; end if;
  if v_entry.approval_status <> 'PENDING' then raise exception 'Only pending withdrawals can be edited. Void a confirmed entry and create a replacement.' using errcode = '22023'; end if;
  if v_role not in ('ADMIN', 'TREASURER') then raise exception 'You are not allowed to edit this entry.' using errcode = '42501'; end if;

  update public.withdrawals set
    transaction_date = p_transaction_date, amount = public.validated_money(p_amount, 'Withdrawal amount'), category = btrim(p_category),
    description = btrim(p_description), person_responsible = btrim(p_person_responsible),
    reference_number = nullif(btrim(p_reference_number), ''), notes = nullif(btrim(p_notes), '')
  where id = p_withdrawal_id and approval_status = 'PENDING';

  if not found then raise exception 'Pending withdrawal not found.' using errcode = 'P0002'; end if;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261111_011', 'scope references and restrict withdrawals')
on conflict (version) do nothing;

commit;
