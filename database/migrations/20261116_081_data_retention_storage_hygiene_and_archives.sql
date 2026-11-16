-- Migration 081: Automated data retention (TTL), cloud storage media migration,
-- financial annual roll-up archives, 500-char input caps, 6-month inactive account lifecycle
-- with 7-day email warning queue, pg_cron midnight schedule, and autovacuum tuning.

begin;

-- 1. Public unguessable-UUID bucket for compressed UI images (avatars, group DPs, QR codes, receipts, bug shots)
insert into storage.buckets (id, name, public, file_size_limit)
values ('ipon-media', 'ipon-media', true, 10485760)
on conflict (id) do update
set public = true,
    file_size_limit = 10485760;

-- 2. Shared Storage deletion queue so database TTL/purges also erase backing Storage files reliably
create table if not exists public.pending_storage_deletions (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  object_path text not null,
  queued_at timestamptz not null default now(),
  unique (bucket_id, object_path)
);

revoke all on public.pending_storage_deletions from public, anon, authenticated;

create or replace function public.extract_ipon_media_path(p_url text)
returns text
language sql
immutable
as $$
  select case
    when p_url is null then null
    when p_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/ipon-media/'
      then nullif(btrim(split_part(regexp_replace(p_url, '^https://[a-z0-9.-]+/storage/v1/object/public/ipon-media/', ''), '?', 1)), '')
    else null
  end;
$$;

create or replace function public.queue_storage_object_deletion(
  p_bucket_id text,
  p_object_path text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := nullif(btrim(coalesce(p_bucket_id, '')), '');
  v_path text := nullif(btrim(coalesce(p_object_path, '')), '');
begin
  if v_bucket is null or v_path is null or position('..' in v_path) > 0 then
    return;
  end if;
  insert into public.pending_storage_deletions (bucket_id, object_path)
  values (v_bucket, v_path)
  on conflict (bucket_id, object_path) do nothing;
end;
$$;

revoke execute on function public.queue_storage_object_deletion(text, text) from public, anon, authenticated;

create or replace function public.queue_media_url_deletion(p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path text := public.extract_ipon_media_path(p_url);
begin
  if v_path is not null then
    perform public.queue_storage_object_deletion('ipon-media', v_path);
  end if;
end;
$$;

revoke execute on function public.queue_media_url_deletion(text) from public, anon, authenticated;

create or replace function public.is_valid_media_reference(p_url text)
returns boolean
language sql
immutable
as $$
  select
    p_url is null
    or (p_url ~ '^data:image/' and char_length(p_url) <= 600000)
    or (p_url ~ '^https://[a-z0-9.-]+/storage/v1/object/public/ipon-media/' and char_length(p_url) <= 500);
$$;

-- Trigger to automatically queue Storage cleanup when message_attachments rows are removed (direct delete or cascade)
create or replace function public.queue_deleted_chat_attachment_storage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.queue_storage_object_deletion(coalesce(nullif(old.bucket_id, ''), 'chat-attachments'), old.storage_path);
  return old;
end;
$$;

drop trigger if exists message_attachments_queue_storage_delete on public.message_attachments;
create trigger message_attachments_queue_storage_delete
  after delete on public.message_attachments
  for each row execute function public.queue_deleted_chat_attachment_storage();

-- Queue replaced/cleared ipon-media URLs cleanly so orphaned files do not accumulate
create or replace function public.queue_replaced_media_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'profiles' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
  elsif tg_table_name = 'groups' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
    if old.payment_qr_url is not null and (tg_op = 'DELETE' or new.payment_qr_url is distinct from old.payment_qr_url) then
      perform public.queue_media_url_deletion(old.payment_qr_url);
    end if;
  elsif tg_table_name in ('contributions', 'expenses') then
    if old.receipt_url is not null and (tg_op = 'DELETE' or new.receipt_url is distinct from old.receipt_url) then
      perform public.queue_media_url_deletion(old.receipt_url);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

do $$
declare
  v_tbl text;
begin
  foreach v_tbl in array array['profiles', 'groups', 'contributions', 'expenses'] loop
    execute format('drop trigger if exists %I_queue_media_cleanup on public.%I', v_tbl, v_tbl);
    execute format(
      'create trigger %I_queue_media_cleanup after update or delete on public.%I for each row execute function public.queue_replaced_media_refs()',
      v_tbl,
      v_tbl
    );
  end loop;
end $$;

-- 3. Update media checks to accept cloud Storage HTTPS URLs cleanly alongside legacy data URIs
alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles add constraint profiles_avatar_url_check check (public.is_valid_media_reference(avatar_url));

alter table public.groups drop constraint if exists groups_avatar_url_check;
alter table public.groups add constraint groups_avatar_url_check check (public.is_valid_media_reference(avatar_url));

create or replace function public.update_own_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not public.is_valid_media_reference(p_avatar_url) then
    raise exception 'Please choose a valid picture under 500 KB.' using errcode = '22023';
  end if;
  update public.profiles set avatar_url = p_avatar_url where id = auth.uid();
  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.update_group_profile(
  p_name text,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can edit group details.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;
  if not public.is_valid_media_reference(p_avatar_url) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  update public.groups
  set name = v_name,
      avatar_url = case
        when p_clear_avatar then null
        when p_avatar_url is not null then p_avatar_url
        else avatar_url
      end
  where id = v_group_id;
  if not found then
    raise exception 'Group not found.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_create_group(
  p_name text,
  p_avatar_url text default null,
  p_include_self boolean default false,
  p_monthly_amount numeric default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_new_group_id uuid;
  v_amount numeric := round(coalesce(p_monthly_amount, 100), 2);
begin
  if auth.uid() is null then
    raise exception 'Sign in first before creating a savings group.' using errcode = '42501';
  end if;
  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'DISABLED') then
    raise exception 'Your account is deactivated or disabled.' using errcode = '42501';
  end if;
  if public.is_super_admin() then
    raise exception 'Super administrators manage platform access from the Super Admin console.' using errcode = '42501';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;
  if not public.is_valid_media_reference(p_avatar_url) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;
  if v_amount <= 0 or v_amount > 1000000 then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id, avatar_url, status)
  values (v_name, auth.uid(), p_avatar_url, 'ACTIVE')
  returning id into v_new_group_id;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_new_group_id, auth.uid(), 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  update public.profiles
  set group_id = v_new_group_id,
      role = 'ADMIN',
      status = 'ACTIVE',
      member_id = null
  where id = auth.uid();

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_new_group_id, date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date, v_amount, auth.uid());

  if p_include_self then
    perform public.set_admin_contributor(true, v_amount);
  end if;

  return v_new_group_id;
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
  if not public.is_valid_media_reference(p_payment_qr_url) then
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
  if not public.is_valid_media_reference(v_receipt) then
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

-- 4. 500-character caps on chat messages, notes, and record discussion replies (announcements remain unlimited)
update public.messages
set body = left(body, 500)
where char_length(body) > 500;

alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check check (char_length(body) <= 500);

update public.record_comments
set body = left(body, 500)
where char_length(btrim(coalesce(body, ''))) > 500;

alter table public.record_comments drop constraint if exists record_comments_body_length_check;
alter table public.record_comments add constraint record_comments_body_length_check check (char_length(btrim(coalesce(body, ''))) <= 500);

create or replace function public.enforce_data_quality()
returns trigger
language plpgsql
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_is_super_admin boolean := false;
begin
  if tg_table_name = 'profiles' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name
        or new.role is distinct from old.role)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      v_is_super_admin := (new.role = 'SUPER_ADMIN');
      new.first_name := public.validated_name_part_mode(new.first_name, 'First name', true, not v_is_super_admin, false);
      new.middle_name := public.validated_name_part_mode(new.middle_name, 'Middle name', false, not v_is_super_admin, true);
      new.last_name := public.validated_name_part_mode(new.last_name, 'Last name', not v_is_super_admin, not v_is_super_admin, false);
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
      if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    end if;
  elsif tg_table_name = 'members' then
    if (tg_op = 'INSERT'
        or new.first_name is distinct from old.first_name
        or new.middle_name is distinct from old.middle_name
        or new.last_name is distinct from old.last_name)
       and (new.first_name is not null or new.middle_name is not null or new.last_name is not null) then
      new.first_name := public.validated_name_part(new.first_name, 'First name');
      new.middle_name := public.validated_name_part(new.middle_name, 'Middle name', false);
      new.last_name := public.validated_name_part(new.last_name, 'Last name');
      new.full_name := concat_ws(' ', new.first_name, new.middle_name, new.last_name);
    end if;
    if nullif(btrim(new.full_name), '') is null then raise exception 'Full name is required.' using errcode = '22023'; end if;
    if char_length(new.full_name) > 150 then raise exception 'Full name must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if new.date_registered < date '2000-01-01' or new.date_registered > current_date then raise exception 'Date registered must be between 2000-01-01 and today.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contribution_settings' then
    if new.effective_month < date '2000-01-01' or new.effective_month > date '2100-12-01' then raise exception 'Effective month must be between January 2000 and December 2100.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contribution_periods' then
    if new.period_month < date '2000-01-01' or new.period_month > date '2100-12-01' then raise exception 'Contribution month must be between January 2000 and December 2100.' using errcode = '22023'; end if;
  elsif tg_table_name = 'contributions' then
    if new.payment_date < date '2000-01-01' or new.payment_date > current_date then raise exception 'Date added must be between 2000-01-01 and today.' using errcode = '22023'; end if;
    if char_length(coalesce(new.transaction_reference, '')) > 100 then raise exception 'Reference must not exceed 100 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.review_note, '')) > 500 then raise exception 'Review note must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.void_reason, '')) > 500 then raise exception 'Void reason must not exceed 500 characters.' using errcode = '22023'; end if;
  elsif tg_table_name in ('expenses', 'withdrawals') then
    if new.transaction_date < date '2000-01-01' or new.transaction_date > current_date then raise exception 'Transaction date must be between 2000-01-01 and today.' using errcode = '22023'; end if;
    if nullif(btrim(new.category), '') is null then raise exception 'Category is required.' using errcode = '22023'; end if;
    if nullif(btrim(new.description), '') is null then raise exception 'Description is required.' using errcode = '22023'; end if;
    if nullif(btrim(new.person_responsible), '') is null then raise exception 'Person responsible is required.' using errcode = '22023'; end if;
    if char_length(new.category) > 80 then raise exception 'Category must not exceed 80 characters.' using errcode = '22023'; end if;
    if char_length(new.description) > 500 then raise exception 'Description must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(new.person_responsible) > 150 then raise exception 'Person responsible must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.reference_number, '')) > 100 then raise exception 'Reference must not exceed 100 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.review_note, '')) > 500 then raise exception 'Review note must not exceed 500 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.void_reason, '')) > 500 then raise exception 'Void reason must not exceed 500 characters.' using errcode = '22023'; end if;
  elsif tg_table_name = 'savings_goals' then
    if nullif(btrim(new.title), '') is null then raise exception 'Goal title is required.' using errcode = '22023'; end if;
    if char_length(new.title) > 150 then raise exception 'Goal title must not exceed 150 characters.' using errcode = '22023'; end if;
    if char_length(coalesce(new.notes, '')) > 500 then raise exception 'Notes must not exceed 500 characters.' using errcode = '22023'; end if;
    if new.target_date is not null and (new.target_date < date '2000-01-01' or new.target_date > date '2100-12-31') then raise exception 'Target date must be between 2000-01-01 and 2100-12-31.' using errcode = '22023'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_body text default '',
  p_message_type text default 'TEXT',
  p_reply_to_id uuid default null,
  p_forwarded_from_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_peer record;
  v_sender record;
  v_clean_body text := btrim(coalesce(p_body, ''));
  v_type text := upper(btrim(coalesce(p_message_type, 'TEXT')));
  v_att_count integer := 0;
  v_msg public.messages%rowtype;
  v_att jsonb;
  v_idx integer := 0;
  v_preview text;
  v_peer_part public.conversation_participants%rowtype;
  v_notif_title text;
  v_notif_type text;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  select id, full_name, role, status, chat_privacy into v_peer from public.profiles where id = v_peer_id;
  select id, full_name into v_sender from public.profiles where id = v_uid;

  if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Recipient is unavailable for messaging.' using errcode = '42501';
  end if;

  if public.is_user_blocked_between(v_uid, v_peer_id) then
    raise exception 'Cannot send message because one of you has blocked the other.' using errcode = '42501';
  end if;

  if v_type not in ('TEXT', 'MEDIA', 'VOICE', 'FORWARDED') then
    v_type := 'TEXT';
  end if;

  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    p_attachments := '[]'::jsonb;
  end if;
  v_att_count := jsonb_array_length(p_attachments);
  if v_att_count > 10 then
    raise exception 'Attach at most 10 files per message.' using errcode = '22023';
  end if;

  if char_length(v_clean_body) = 0 and v_att_count = 0 then
    raise exception 'Enter a message or attach at least one file.' using errcode = '22023';
  end if;
  if char_length(v_clean_body) > 500 then
    raise exception 'Message must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if v_conv.status = 'DECLINED' then
    if not public.are_friends(v_uid, v_peer_id)
       and coalesce(v_peer.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
    end if;
    update public.conversations
    set status = case when public.are_friends(v_uid, v_peer_id) then 'ACCEPTED' else 'PENDING_REQUEST' end,
        initiator_id = v_uid,
        accepted_at = case when public.are_friends(v_uid, v_peer_id) then now() else null end
    where id = v_conv.id
    returning * into v_conv;
  elsif v_conv.status = 'PENDING_REQUEST' and v_conv.initiator_id is distinct from v_uid then
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  elsif public.are_friends(v_uid, v_peer_id) and v_conv.status = 'PENDING_REQUEST' then
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  end if;

  if p_reply_to_id is not null then
    if not exists (
      select 1 from public.messages m
      where m.id = p_reply_to_id and m.conversation_id = v_conv.id and m.deleted_for_everyone_at is null
    ) then
      raise exception 'The referenced reply message is unavailable.' using errcode = '22023';
    end if;
  end if;

  if p_forwarded_from_id is not null then
    if not exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = p_forwarded_from_id
        and m.deleted_for_everyone_at is null
        and (c.user_a = v_uid or c.user_b = v_uid)
        and not (v_uid = any(m.deleted_for_user_ids))
    ) then
      raise exception 'Original forwarded message is unavailable.' using errcode = '42501';
    end if;
    v_type := 'FORWARDED';
  elsif v_att_count > 0 and v_type = 'TEXT' then
    v_type := 'MEDIA';
  end if;

  insert into public.messages (conversation_id, sender_id, body, message_type, reply_to_id, forwarded_from_id, metadata)
  values (v_conv.id, v_uid, v_clean_body, v_type, p_reply_to_id, p_forwarded_from_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_msg;

  for v_att in select value from jsonb_array_elements(p_attachments) loop
    v_idx := v_idx + 1;
    if coalesce(v_att ->> 'path', '') = '' or (v_att ->> 'path') like '%..%' then
      raise exception 'Invalid attachment storage path.' using errcode = '22023';
    end if;
    if (v_att ->> 'path') not like (v_conv.id::text || '/' || v_uid::text || '/%') then
      raise exception 'Attachment ownership check failed.' using errcode = '42501';
    end if;
    insert into public.message_attachments (
      message_id, conversation_id, uploader_id, bucket_id, storage_path,
      file_name, mime_type, file_size, attachment_kind, width, height, duration_seconds
    ) values (
      v_msg.id,
      v_conv.id,
      v_uid,
      'chat-attachments',
      v_att ->> 'path',
      left(coalesce(nullif(btrim(v_att ->> 'name'), ''), 'attachment'), 240),
      left(coalesce(nullif(btrim(v_att ->> 'type'), ''), 'application/octet-stream'), 120),
      greatest(0, least(52428800, coalesce((v_att ->> 'size')::bigint, 0))),
      case when (v_att ->> 'kind') in ('image', 'document', 'audio', 'video', 'file') then (v_att ->> 'kind') else 'file' end,
      nullif((v_att ->> 'width')::integer, 0),
      nullif((v_att ->> 'height')::integer, 0),
      nullif((v_att ->> 'duration_seconds')::integer, 0)
    );
  end loop;

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  values (v_msg.id, v_peer_id, null, null)
  on conflict (message_id, user_id) do nothing;

  v_preview := case
    when char_length(v_clean_body) > 0 then left(v_clean_body, 140)
    when v_type = 'VOICE' or (v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'audio') then 'Sent a voice message'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'image' then 'Sent a photo'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'video' then 'Sent a video'
    when v_att_count > 1 then 'Sent ' || v_att_count::text || ' attachments'
    else 'Sent an attachment'
  end;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_uid
  where id = v_conv.id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_conv.user_a), (v_conv.id, v_conv.user_b)
  on conflict (conversation_id, user_id) do nothing;

  update public.conversation_participants
  set hidden_at = null,
      marked_unread = false,
      last_read_message_id = v_msg.id,
      last_read_at = now()
  where conversation_id = v_conv.id and user_id = v_uid;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false
  where conversation_id = v_conv.id and user_id = v_peer_id
  returning * into v_peer_part;

  if coalesce(v_peer_part.is_muted, false) is not true then
    if v_conv.status = 'PENDING_REQUEST' then
      v_notif_type := 'SOCIAL_MESSAGE_REQUEST';
      v_notif_title := 'Message request from ' || coalesce(v_sender.full_name, 'User');
      perform public.push_social_notification(
        v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
        'dashboard.html?messages=requests&chat=' || v_conv.id::text,
        'SOCIAL_MSG_REQ:' || v_conv.id::text
      );
    else
      v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
      v_notif_title := case when p_reply_to_id is not null then 'New reply from ' else 'New message from ' end || coalesce(v_sender.full_name, 'User');
      perform public.push_social_notification(
        v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
        'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
        'SOCIAL_MSG:' || v_conv.id::text
      );
    end if;
  end if;

  return jsonb_build_object(
    'id', v_msg.id,
    'conversation_id', v_msg.conversation_id,
    'sender_id', v_msg.sender_id,
    'body', v_msg.body,
    'message_type', v_msg.message_type,
    'reply_to_id', v_msg.reply_to_id,
    'forwarded_from_id', v_msg.forwarded_from_id,
    'created_at', v_msg.created_at
  );
end;
$$;

create or replace function public.edit_chat_message(
  p_message_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_msg public.messages%rowtype;
  v_clean text := btrim(coalesce(p_body, ''));
  v_has_att boolean;
begin
  select * into v_msg from public.messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.sender_id <> v_uid or v_msg.deleted_for_everyone_at is not null then
    raise exception 'You can only edit your own active messages.' using errcode = '42501';
  end if;
  if v_msg.message_type in ('CALL_EVENT', 'SYSTEM') then
    raise exception 'System events cannot be edited.' using errcode = '42501';
  end if;

  v_has_att := exists (select 1 from public.message_attachments ma where ma.message_id = v_msg.id);
  if char_length(v_clean) = 0 and not v_has_att then
    raise exception 'Message cannot be empty.' using errcode = '22023';
  end if;
  if char_length(v_clean) > 500 then
    raise exception 'Message must be 500 characters or fewer.' using errcode = '22023';
  end if;

  update public.messages
  set body = v_clean, edited_at = now()
  where id = v_msg.id;

  update public.conversations
  set last_message_preview = case when char_length(v_clean) > 0 then left(v_clean, 140) else 'Sent an attachment' end
  where id = v_msg.conversation_id and last_message_id = v_msg.id;

  return jsonb_build_object('id', v_msg.id, 'body', v_clean, 'edited_at', now());
end;
$$;

-- Tighten add_record_comment to 500 chars
create or replace function public.add_record_comment(
  p_record_type text,
  p_record_id uuid,
  p_body text default '',
  p_attachments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := lower(btrim(coalesce(p_record_type, '')));
  v_body text := btrim(coalesce(p_body, ''));
  v_attachments jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_sanitized_attachments jsonb := '[]'::jsonb;
  v_att jsonb;
  v_att_path text;
  v_att_name text;
  v_att_kind text;
  v_att_type text;
  v_att_size bigint;
  v_expected_prefix text;
  v_att_count integer := 0;
  v_first_att_name text := '';
  v_group uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_member_id uuid := public.current_member_id();
  v_submitted_by uuid;
  v_target_member_id uuid;
  v_person_responsible text;
  v_my_member_name text;
  v_amount numeric(14,2);
  v_subject_name text;
  v_allowed boolean := false;
  v_comment public.record_comments;
  v_author_name text;
  v_author_avatar text;
  v_type_label text;
  v_page text;
  v_snippet text;
  v_dedupe_key text;
  v_thread_marker text;
  v_title text;
  v_message text;
  v_link text;
  v_recipient record;
begin
  if auth.uid() is null or v_group is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Join or select a savings group first.' using errcode = '42501';
  end if;
  if v_type not in ('contribution', 'withdrawal', 'expense') or p_record_id is null then
    raise exception 'Invalid record reference.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_attachments) <> 'array' then
    raise exception 'Attachments must be an array.' using errcode = '22023';
  end if;
  v_att_count := jsonb_array_length(v_attachments);
  if v_att_count > 5 then
    raise exception 'You can attach at most 5 files per reply.' using errcode = '22023';
  end if;
  if char_length(v_body) > 500 or (char_length(v_body) = 0 and v_att_count = 0) then
    raise exception 'Enter a reply or attach at least one file (max 500 characters).' using errcode = '22023';
  end if;

  if v_type = 'contribution' then
    select c.submitted_by, cp.member_id, m.full_name, c.amount
    into v_submitted_by, v_target_member_id, v_subject_name, v_amount
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    join public.members m on m.id = cp.member_id
    where c.id = p_record_id and c.group_id = v_group;
    v_type_label := 'contribution';
    v_page := 'contributions.html';
  elsif v_type = 'withdrawal' then
    select w.submitted_by, w.person_responsible, w.person_responsible, w.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.withdrawals w
    where w.id = p_record_id and w.group_id = v_group;
    v_type_label := 'deduction';
    v_page := 'withdrawals.html';
  else
    select e.submitted_by, e.person_responsible, e.person_responsible, e.amount
    into v_submitted_by, v_person_responsible, v_subject_name, v_amount
    from public.expenses e
    where e.id = p_record_id and e.group_id = v_group;
    v_type_label := 'expense';
    v_page := 'expenses.html';
  end if;

  if v_subject_name is null then
    raise exception 'Financial record not found in your group.' using errcode = 'P0002';
  end if;

  if v_role in ('ADMIN', 'TREASURER') then
    v_allowed := true;
  elsif v_submitted_by = auth.uid() then
    v_allowed := true;
  elsif v_type = 'contribution' and v_member_id is not null and v_target_member_id = v_member_id then
    v_allowed := true;
  elsif v_type in ('withdrawal', 'expense') and v_member_id is not null then
    select m.full_name into v_my_member_name from public.members m where m.id = v_member_id;
    if v_my_member_name is not null and lower(btrim(v_my_member_name)) = lower(btrim(coalesce(v_person_responsible, ''))) then
      v_allowed := true;
    end if;
  end if;

  if not v_allowed then
    raise exception 'You do not have permission to reply on this record.' using errcode = '42501';
  end if;

  v_expected_prefix := v_group::text || '/' || v_type || '/' || p_record_id::text || '/' || auth.uid()::text || '/';
  for v_att in select value from jsonb_array_elements(v_attachments) loop
    v_att_path := btrim(coalesce(v_att ->> 'path', ''));
    v_att_name := left(coalesce(nullif(btrim(v_att ->> 'name'), ''), 'attachment'), 180);
    v_att_kind := case when (v_att ->> 'kind') in ('image', 'video', 'file') then (v_att ->> 'kind') else 'file' end;
    v_att_type := left(coalesce(btrim(v_att ->> 'type'), ''), 120);
    v_att_size := greatest(0, least(52428800, coalesce((v_att ->> 'size')::bigint, 0)));
    if v_att_path = '' or position('..' in v_att_path) > 0 or left(v_att_path, char_length(v_expected_prefix)) <> v_expected_prefix then
      raise exception 'Invalid attachment path for this record.' using errcode = '42501';
    end if;
    if v_first_att_name = '' then
      v_first_att_name := v_att_name;
    end if;
    v_sanitized_attachments := v_sanitized_attachments || jsonb_build_array(
      jsonb_build_object(
        'path', v_att_path,
        'name', v_att_name,
        'kind', v_att_kind,
        'type', v_att_type,
        'size', v_att_size
      )
    );
  end loop;

  insert into public.record_comments (group_id, record_type, record_id, author_id, body, attachments)
  values (v_group, v_type, p_record_id, auth.uid(), v_body, v_sanitized_attachments)
  returning * into v_comment;

  select coalesce(nullif(btrim(p.full_name), ''), 'Group member'), p.avatar_url
  into v_author_name, v_author_avatar
  from public.profiles p
  where p.id = auth.uid();

  if char_length(v_body) > 0 then
    v_snippet := case when char_length(v_body) > 120 then left(v_body, 117) || '...' else v_body end;
    if v_att_count > 0 then
      v_snippet := v_snippet || ' (+' || v_att_count::text || case when v_att_count = 1 then ' attachment)' else ' attachments)' end;
    end if;
  elsif v_att_count = 1 then
    v_snippet := 'Sent attachment: ' || left(v_first_att_name, 80);
  else
    v_snippet := 'Sent ' || v_att_count::text || ' attachments';
  end if;

  v_dedupe_key := 'RECORD_COMMENT:' || v_type || ':' || p_record_id::text;
  v_thread_marker := 'thread=' || v_type || ':' || p_record_id::text;
  v_title := 'New reply on ' || v_type_label;
  v_message := v_author_name || ' (' || coalesce(v_subject_name, 'Member') || ' · PHP '
    || to_char(coalesce(v_amount, 0), 'FM999,999,990.00') || '): "' || v_snippet || '"';

  for v_recipient in
    select distinct
      r.user_id,
      coalesce(gm.role, p.role) as target_role
    from (
      select a.user_id from public.group_admin_ids(v_group) a
      union
      select gm_t.user_id from public.group_memberships gm_t where gm_t.group_id = v_group and gm_t.role = 'TREASURER' and gm_t.status = 'ACTIVE'
      union
      select p_t.id from public.profiles p_t where p_t.group_id = v_group and p_t.role = 'TREASURER' and p_t.status = 'ACTIVE'
      union
      select v_submitted_by where v_submitted_by is not null
      union
      select gm_m.user_id from public.group_memberships gm_m where v_target_member_id is not null and gm_m.group_id = v_group and gm_m.member_id = v_target_member_id and gm_m.status = 'ACTIVE'
      union
      select p_m.id from public.profiles p_m where v_target_member_id is not null and p_m.member_id = v_target_member_id and p_m.status = 'ACTIVE'
      union
      select gm_pr.user_id from public.members m_pr join public.group_memberships gm_pr on gm_pr.group_id = v_group and gm_pr.member_id = m_pr.id and gm_pr.status = 'ACTIVE'
      where v_type in ('withdrawal', 'expense') and m_pr.group_id = v_group and lower(btrim(m_pr.full_name)) = lower(btrim(coalesce(v_person_responsible, '')))
      union
      select p_pr.id from public.members m_pr2 join public.profiles p_pr on p_pr.member_id = m_pr2.id and p_pr.status = 'ACTIVE'
      where v_type in ('withdrawal', 'expense') and m_pr2.group_id = v_group and lower(btrim(m_pr2.full_name)) = lower(btrim(coalesce(v_person_responsible, '')))
      union
      select prev.author_id from public.record_comments prev where prev.group_id = v_group and prev.record_type = v_type and prev.record_id = p_record_id
    ) r
    join public.profiles p on p.id = r.user_id
    left join public.group_memberships gm on gm.group_id = v_group and gm.user_id = r.user_id and gm.status = 'ACTIVE'
    where r.user_id is not null
      and r.user_id <> auth.uid()
      and p.status = 'ACTIVE'
      and p.notifications_enabled
  loop
    v_link := (case
      when v_type = 'contribution' and v_recipient.target_role = 'MEMBER' then 'user.html'
      else v_page
    end) || '?' || v_thread_marker;

    delete from public.notifications n
    where n.recipient_id = v_recipient.user_id
      and n.type = 'RECORD_COMMENT'
      and (
        n.dedupe_key = v_dedupe_key
        or (n.dedupe_key is null and position(v_thread_marker in coalesce(n.link, '')) > 0)
      );

    insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
    values (v_recipient.user_id, v_group, 'RECORD_COMMENT', btrim(v_title), btrim(v_message), v_link, v_dedupe_key);
  end loop;

  return jsonb_build_object(
    'id', v_comment.id,
    'record_type', v_comment.record_type,
    'record_id', v_comment.record_id,
    'author_id', v_comment.author_id,
    'author_name', v_author_name,
    'author_role', v_role::text,
    'author_avatar_url', v_author_avatar,
    'body', v_comment.body,
    'attachments', coalesce(v_comment.attachments, '[]'::jsonb),
    'created_at', v_comment.created_at,
    'is_own', true
  );
end;
$$;

-- 5. Scrub existing base64 image blobs from audit_logs & prevent write_audit_log() from storing raw data:image dumps
create or replace function public.scrub_audit_media_jsonb(p_data jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_res jsonb := p_data;
  v_key text;
begin
  if v_res is null then
    return null;
  end if;
  foreach v_key in array array['avatar_url', 'payment_qr_url', 'receipt_url'] loop
    if coalesce(v_res ->> v_key, '') ~ '^data:image/' then
      v_res := jsonb_set(v_res, array[v_key], to_jsonb('[inline-image]'::text), true);
    end if;
  end loop;
  return v_res;
end;
$$;

update public.audit_logs
set old_data = public.scrub_audit_media_jsonb(old_data),
    new_data = public.scrub_audit_media_jsonb(new_data)
where (old_data::text ~ 'data:image/' or new_data::text ~ 'data:image/');

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
  v_noise_keys constant text[] := array[
    'updated_at',
    'created_at',
    'last_seen_at',
    'chat_privacy',
    'username',
    'bio',
    'name_setup_required',
    'previous_account_status',
    'idempotency_key',
    'inactivity_warned_at'
  ];
begin
  if current_setting('ipon.maintenance_archive_rollup', true) = 'on'
     and tg_op = 'DELETE'
     and pg_trigger_depth() <= 1
     and tg_table_name in ('contributions', 'withdrawals', 'expenses') then
    return old;
  end if;

  if current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
     and tg_op = 'DELETE'
     and pg_trigger_depth() <= 1 then
    return old;
  end if;

  v_old := case when tg_op in ('UPDATE', 'DELETE') then public.scrub_audit_media_jsonb(to_jsonb(old) - v_noise_keys) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then public.scrub_audit_media_jsonb(to_jsonb(new) - v_noise_keys) else null end;

  if tg_op = 'UPDATE' and v_old = v_new then
    return new;
  end if;

  v_record_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  v_group_id := coalesce((v_new ->> 'group_id')::uuid, (v_old ->> 'group_id')::uuid);

  if v_group_id is not null and not exists (select 1 from public.groups g where g.id = v_group_id) then
    v_group_id := null;
  end if;

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

-- 6. Financial annual archive table & safe year-older roll-up preserving balances & wallet reconciliation
create table if not exists public.financial_annual_archives (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  archive_year integer not null check (archive_year between 2000 and 2100),
  summary_label text not null check (char_length(btrim(summary_label)) between 3 and 180),
  total_additions numeric(14,2) not null default 0 check (total_additions >= 0),
  total_deductions numeric(14,2) not null default 0 check (total_deductions >= 0),
  total_expenses numeric(14,2) not null default 0 check (total_expenses >= 0),
  net_savings numeric(14,2) generated always as (total_additions - total_deductions - total_expenses) stored,
  rows_archived_count integer not null default 0 check (rows_archived_count >= 0),
  payment_breakdown jsonb not null default '{}'::jsonb,
  member_totals jsonb not null default '{}'::jsonb,
  csv_exported boolean not null default false,
  archived_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz not null default now(),
  unique (group_id, archive_year)
);

alter table public.contribution_periods
  add column if not exists archived_paid_amount numeric(14,2) not null default 0,
  add column if not exists archived_first_paid_date date;

create or replace view public.v_contribution_status
with (security_invoker = true)
as
select
  cp.id as contribution_period_id,
  cp.member_id,
  m.full_name as member_name,
  cp.period_month,
  cp.required_amount,
  (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0))::numeric(14,2) as paid_amount,
  case
    when cp.is_exempt then 0::numeric(14,2)
    else greatest(cp.required_amount - (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)), 0)::numeric(14,2)
  end as outstanding_amount,
  greatest((coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)) - cp.required_amount, 0)::numeric(14,2) as overpaid_amount,
  case
    when cp.is_exempt then 'EXEMPT'
    when (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)) = 0 then 'UNPAID'
    when (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)) < cp.required_amount then 'PARTIALLY PAID'
    when (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0)) = cp.required_amount then 'PAID'
    else 'OVERPAID'
  end as payment_status,
  cp.is_exempt,
  cp.exempt_reason
from public.contribution_periods cp
join public.members m on m.id = cp.member_id
left join public.contributions c on c.contribution_period_id = cp.id
where m.deleted_at is null
  and ((m.status = 'ACTIVE' and m.activation_status = 'ACTIVE') or c.id is not null or coalesce(cp.archived_paid_amount, 0) > 0)
group by cp.id, cp.member_id, m.full_name, cp.period_month, cp.required_amount, cp.is_exempt, cp.exempt_reason, cp.archived_paid_amount;

create or replace function public.get_user_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_member_id uuid := public.current_member_id();
  v_current_month date := date_trunc('month', current_date)::date;
  v_rec record;
  v_payment_streak integer := 0;
  v_on_time_streak integer := 0;
  v_break_paid boolean := false;
  v_break_on_time boolean := false;
begin
  if v_member_id is null then
    return null;
  end if;

  for v_rec in
    select
      cp.period_month,
      cp.due_date,
      cp.is_exempt,
      cp.required_amount,
      (coalesce(cp.archived_paid_amount, 0) + coalesce(sum(c.amount) filter (where c.approval_status = 'CONFIRMED'), 0))::numeric(14,2) as paid_amount,
      least(cp.archived_first_paid_date, min(c.payment_date) filter (where c.approval_status = 'CONFIRMED')) as first_paid_date
    from public.contribution_periods cp
    left join public.contributions c on c.contribution_period_id = cp.id
    where cp.member_id = v_member_id
      and cp.period_month <= v_current_month
    group by cp.id, cp.period_month, cp.due_date, cp.is_exempt, cp.required_amount, cp.archived_paid_amount, cp.archived_first_paid_date
    order by cp.period_month desc
  loop
    if v_rec.period_month = v_current_month and v_rec.paid_amount < v_rec.required_amount and not v_rec.is_exempt and current_date <= v_rec.due_date then
      continue;
    end if;

    if not v_break_paid then
      if v_rec.is_exempt or v_rec.paid_amount >= v_rec.required_amount then
        v_payment_streak := v_payment_streak + 1;
      else
        v_break_paid := true;
      end if;
    end if;

    if not v_break_on_time then
      if v_rec.is_exempt or (v_rec.paid_amount >= v_rec.required_amount and v_rec.first_paid_date is not null and v_rec.first_paid_date <= v_rec.due_date) then
        v_on_time_streak := v_on_time_streak + 1;
      else
        v_break_on_time := true;
      end if;
    end if;

    exit when v_break_paid and v_break_on_time;
  end loop;

  return jsonb_build_object(
    'total_contributed',
      (select coalesce(sum(cp.archived_paid_amount), 0) from public.contribution_periods cp where cp.member_id = v_member_id)
      + (select coalesce(sum(c.amount), 0) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'CONFIRMED'),
    'months_paid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('PAID', 'OVERPAID')),
    'months_unpaid', (select count(*) from public.v_contribution_status where member_id = v_member_id and payment_status in ('UNPAID', 'PARTIALLY PAID') and period_month <= v_current_month),
    'pending_submissions', (select count(*) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = v_member_id and c.approval_status = 'PENDING'),
    'payment_streak', v_payment_streak,
    'on_time_streak', v_on_time_streak,
    'current_period', (select to_jsonb(x) from (select vcs.period_month, vcs.required_amount, vcs.paid_amount, vcs.outstanding_amount, vcs.payment_status, cp.due_date, cp.is_exempt, cp.exempt_reason from public.v_contribution_status vcs join public.contribution_periods cp on cp.id = vcs.contribution_period_id where vcs.member_id = v_member_id and vcs.period_month = v_current_month) x)
  );
end;
$$;

alter table public.financial_annual_archives enable row level security;

drop policy if exists mfa_verified_for_opted_in on public.financial_annual_archives;
create policy mfa_verified_for_opted_in on public.financial_annual_archives
  as restrictive for all to authenticated
  using (public.mfa_access_allowed())
  with check (public.mfa_access_allowed());

drop policy if exists financial_annual_archives_select on public.financial_annual_archives;
create policy financial_annual_archives_select on public.financial_annual_archives
  for select to authenticated
  using (
    group_id = public.current_group_id()
    and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
  );

revoke all on public.financial_annual_archives from public, anon, authenticated;
grant select on public.financial_annual_archives to authenticated;

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
  if current_setting('ipon.maintenance_retention_cleanup', true) = 'on'
     and pg_trigger_depth() <= 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if current_setting('ipon.maintenance_archive_rollup', true) = 'on'
     and pg_trigger_depth() <= 1
     and public.is_admin()
     and tg_op = 'DELETE'
     and tg_table_name in ('contributions', 'withdrawals', 'expenses') then
    if old.group_id is not distinct from v_actor_group then
      return old;
    end if;
  end if;

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

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.get_archivable_years()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_role public.app_role := public.current_user_role();
  v_cutoff date := (current_date - interval '1 year')::date;
begin
  if v_group_id is null or v_role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    return jsonb_build_object('eligible', '[]'::jsonb, 'archived', '[]'::jsonb, 'cutoff_date', v_cutoff);
  end if;

  return jsonb_build_object(
    'cutoff_date', v_cutoff,
    'eligible', coalesce(
      (
        with raw_tx as (
          select extract(year from c.payment_date)::integer as yr, c.payment_date as dt, c.amount, 'ADD'::text as kind, c.approval_status
          from public.contributions c
          where c.group_id = v_group_id
          union all
          select extract(year from w.transaction_date)::integer as yr, w.transaction_date as dt, w.amount, 'DED'::text as kind, w.approval_status
          from public.withdrawals w
          where w.group_id = v_group_id
          union all
          select extract(year from e.transaction_date)::integer as yr, e.transaction_date as dt, e.amount, 'EXP'::text as kind, e.approval_status
          from public.expenses e
          where e.group_id = v_group_id
        ),
        by_year as (
          select
            yr,
            max(dt) as latest_date,
            count(*) as row_count,
            count(*) filter (where approval_status = 'PENDING') as pending_count,
            coalesce(sum(amount) filter (where kind = 'ADD' and approval_status = 'CONFIRMED'), 0)::numeric(14,2) as total_additions,
            coalesce(sum(amount) filter (where kind = 'DED' and approval_status = 'CONFIRMED'), 0)::numeric(14,2) as total_deductions,
            coalesce(sum(amount) filter (where kind = 'EXP' and approval_status = 'CONFIRMED'), 0)::numeric(14,2) as total_expenses
          from raw_tx
          group by yr
        )
        select jsonb_agg(
          jsonb_build_object(
            'year', yr,
            'row_count', row_count,
            'pending_count', pending_count,
            'total_additions', total_additions,
            'total_deductions', total_deductions,
            'total_expenses', total_expenses,
            'net_savings', (total_additions - total_deductions - total_expenses)
          )
          order by yr desc
        )
        from by_year
        where latest_date < v_cutoff
      ),
      '[]'::jsonb
    ),
    'archived', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'archive_year', a.archive_year,
            'summary_label', a.summary_label,
            'total_additions', a.total_additions,
            'total_deductions', a.total_deductions,
            'total_expenses', a.total_expenses,
            'net_savings', a.net_savings,
            'rows_archived_count', a.rows_archived_count,
            'csv_exported', a.csv_exported,
            'archived_at', a.archived_at
          )
          order by a.archive_year desc
        )
        from public.financial_annual_archives a
        where a.group_id = v_group_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke execute on function public.get_archivable_years() from public, anon;
grant execute on function public.get_archivable_years() to authenticated;

create or replace function public.archive_group_year(
  p_year integer,
  p_csv_exported boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
set timezone = 'Asia/Manila'
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_cutoff date := (current_date - interval '1 year')::date;
  v_start date;
  v_end date;
  v_latest date;
  v_pending integer := 0;
  v_rows integer := 0;
  v_add numeric(14,2) := 0;
  v_ded numeric(14,2) := 0;
  v_exp numeric(14,2) := 0;
  v_breakdown jsonb := '{}'::jsonb;
  v_member_totals jsonb := '{}'::jsonb;
  v_archive_id uuid;
  v_label text;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only the group administrator can archive annual financial records.' using errcode = '42501';
  end if;
  if p_year is null or p_year < 2000 or p_year > 2100 then
    raise exception 'Invalid archive year.' using errcode = '22023';
  end if;

  v_start := make_date(p_year, 1, 1);
  v_end := make_date(p_year, 12, 31);

  select
    max(dt),
    count(*),
    count(*) filter (where approval_status = 'PENDING'),
    coalesce(sum(amount) filter (where kind = 'ADD' and approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    coalesce(sum(amount) filter (where kind = 'DED' and approval_status = 'CONFIRMED'), 0)::numeric(14,2),
    coalesce(sum(amount) filter (where kind = 'EXP' and approval_status = 'CONFIRMED'), 0)::numeric(14,2)
  into v_latest, v_rows, v_pending, v_add, v_ded, v_exp
  from (
    select c.payment_date as dt, c.amount, 'ADD'::text as kind, c.approval_status from public.contributions c where c.group_id = v_group_id and c.payment_date between v_start and v_end
    union all
    select w.transaction_date as dt, w.amount, 'DED'::text as kind, w.approval_status from public.withdrawals w where w.group_id = v_group_id and w.transaction_date between v_start and v_end
    union all
    select e.transaction_date as dt, e.amount, 'EXP'::text as kind, e.approval_status from public.expenses e where e.group_id = v_group_id and e.transaction_date between v_start and v_end
  ) all_yr;

  if coalesce(v_rows, 0) = 0 then
    raise exception 'No unarchived transactions found for year %.', p_year using errcode = 'P0002';
  end if;
  if v_latest >= v_cutoff then
    raise exception 'Only years whose transactions are more than 1 year old (before %) can be rolled up.', v_cutoff using errcode = '22023';
  end if;
  if v_pending > 0 then
    raise exception 'Review or resolve all pending entries in % before archiving.', p_year using errcode = '22023';
  end if;

  select coalesce(
    jsonb_object_agg(
      method_key,
      jsonb_build_object('additions', adds, 'deductions', deds, 'expenses', exps)
    ),
    '{}'::jsonb
  )
  into v_breakdown
  from (
    select
      method_key,
      coalesce(sum(adds), 0)::numeric(14,2) as adds,
      coalesce(sum(deds), 0)::numeric(14,2) as deds,
      coalesce(sum(exps), 0)::numeric(14,2) as exps
    from (
      select coalesce(c.payment_method, 'UNTAGGED') as method_key, c.amount as adds, 0::numeric as deds, 0::numeric as exps
      from public.contributions c where c.group_id = v_group_id and c.approval_status = 'CONFIRMED' and c.payment_date between v_start and v_end
      union all
      select coalesce(w.payment_method, 'UNTAGGED'), 0::numeric, w.amount, 0::numeric
      from public.withdrawals w where w.group_id = v_group_id and w.approval_status = 'CONFIRMED' and w.transaction_date between v_start and v_end
      union all
      select coalesce(e.payment_method, 'UNTAGGED'), 0::numeric, 0::numeric, e.amount
      from public.expenses e where e.group_id = v_group_id and e.approval_status = 'CONFIRMED' and e.transaction_date between v_start and v_end
    ) ch
    group by method_key
  ) agg_ch;

  select coalesce(
    jsonb_object_agg(member_id::text, total_paid),
    '{}'::jsonb
  )
  into v_member_totals
  from (
    select cp.member_id, coalesce(sum(c.amount), 0)::numeric(14,2) as total_paid
    from public.contributions c
    join public.contribution_periods cp on cp.id = c.contribution_period_id
    where c.group_id = v_group_id and c.approval_status = 'CONFIRMED' and c.payment_date between v_start and v_end
    group by cp.member_id
  ) mt;

  v_label := format('%s Total Net Savings Roll-up', p_year);

  perform set_config('ipon.maintenance_archive_rollup', 'on', true);

  insert into public.financial_annual_archives (
    group_id, archive_year, summary_label,
    total_additions, total_deductions, total_expenses,
    rows_archived_count, payment_breakdown, member_totals,
    csv_exported, archived_by, archived_at
  ) values (
    v_group_id, p_year, v_label,
    v_add, v_ded, v_exp,
    v_rows, v_breakdown, v_member_totals,
    coalesce(p_csv_exported, false), auth.uid(), now()
  )
  on conflict (group_id, archive_year) do update
  set total_additions = public.financial_annual_archives.total_additions + excluded.total_additions,
      total_deductions = public.financial_annual_archives.total_deductions + excluded.total_deductions,
      total_expenses = public.financial_annual_archives.total_expenses + excluded.total_expenses,
      rows_archived_count = public.financial_annual_archives.rows_archived_count + excluded.rows_archived_count,
      csv_exported = public.financial_annual_archives.csv_exported or excluded.csv_exported,
      archived_by = auth.uid(),
      archived_at = now()
  returning id into v_archive_id;

  -- Roll confirmed period totals into contribution_periods before deleting archived individual contributions
  with period_rollup as (
    select
      c.contribution_period_id,
      coalesce(sum(c.amount), 0)::numeric(14,2) as add_total,
      min(c.payment_date) as first_dt
    from public.contributions c
    where c.group_id = v_group_id
      and c.payment_date between v_start and v_end
      and c.approval_status = 'CONFIRMED'
    group by c.contribution_period_id
  )
  update public.contribution_periods cp
  set archived_paid_amount = coalesce(cp.archived_paid_amount, 0) + pr.add_total,
      archived_first_paid_date = least(cp.archived_first_paid_date, pr.first_dt)
  from period_rollup pr
  where cp.id = pr.contribution_period_id;

  delete from public.contributions where group_id = v_group_id and payment_date between v_start and v_end;
  delete from public.withdrawals where group_id = v_group_id and transaction_date between v_start and v_end;
  delete from public.expenses where group_id = v_group_id and transaction_date between v_start and v_end;

  insert into public.audit_logs (group_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (
    v_group_id,
    'financial_annual_archives',
    v_archive_id,
    'INSERT',
    null,
    jsonb_build_object(
      'archive_year', p_year,
      'summary_label', v_label,
      'total_additions', v_add,
      'total_deductions', v_ded,
      'total_expenses', v_exp,
      'net_savings', (v_add - v_ded - v_exp),
      'rows_archived_count', v_rows,
      'csv_exported', coalesce(p_csv_exported, false)
    ),
    auth.uid()
  );

  return jsonb_build_object(
    'archive_id', v_archive_id,
    'archive_year', p_year,
    'summary_label', v_label,
    'net_savings', (v_add - v_ded - v_exp),
    'rows_archived', v_rows
  );
end;
$$;

revoke execute on function public.archive_group_year(integer, boolean) from public, anon;
grant execute on function public.archive_group_year(integer, boolean) to authenticated;

-- Fold archived annual summaries into lifetime & wallet totals so balances never drop after roll-up
create or replace function public.get_savings_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select public.current_user_role() as role_name, public.current_group_id() as group_id
  ),
  grp as (
    select g.id, g.cycle_start_date from public.groups g join ctx on ctx.group_id = g.id
  ),
  archived_cycle as (
    select
      coalesce(sum(a.total_additions), 0) as add_amt,
      coalesce(sum(a.total_deductions), 0) as ded_amt,
      coalesce(sum(a.total_expenses), 0) as exp_amt
    from public.financial_annual_archives a
    join grp on grp.id = a.group_id
    where grp.cycle_start_date is null or make_date(a.archive_year, 12, 31) >= grp.cycle_start_date
  ),
  archived_life as (
    select coalesce(sum(a.net_savings), 0) as net_amt
    from public.financial_annual_archives a
    join grp on grp.id = a.group_id
  ),
  cycle_totals as (
    select
      (select coalesce(sum(c.amount), 0) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or c.payment_date >= grp.cycle_start_date))
        + (select add_amt from archived_cycle) as total_additions,
      (select coalesce(sum(w.amount), 0) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or w.transaction_date >= grp.cycle_start_date))
        + (select ded_amt from archived_cycle) as total_deductions,
      (select coalesce(sum(e.amount), 0) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'CONFIRMED' and (grp.cycle_start_date is null or e.transaction_date >= grp.cycle_start_date))
        + (select exp_amt from archived_cycle) as total_expenses,
      (select coalesce(sum(c.amount), 0) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'CONFIRMED')
        - (select coalesce(sum(w.amount), 0) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'CONFIRMED')
        - (select coalesce(sum(e.amount), 0) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'CONFIRMED')
        + (select net_amt from archived_life) as lifetime_tracked_savings,
      (select cycle_start_date from grp limit 1) as cycle_start_date,
      (select count(*) from public.contributions c join grp on c.group_id = grp.id where c.approval_status = 'PENDING')
        + (select count(*) from public.withdrawals w join grp on w.group_id = grp.id where w.approval_status = 'PENDING')
        + (select count(*) from public.expenses e join grp on e.group_id = grp.id where e.approval_status = 'PENDING') as pending_entries
  )
  select case
    when ctx.role_name not in ('ADMIN', 'TREASURER', 'MEMBER') or ctx.group_id is null then null
    else jsonb_build_object(
      'total_additions', ct.total_additions,
      'total_deductions', ct.total_deductions,
      'total_expenses', ct.total_expenses,
      'tracked_savings', ct.total_additions - ct.total_deductions - ct.total_expenses,
      'lifetime_tracked_savings', ct.lifetime_tracked_savings,
      'cycle_start_date', ct.cycle_start_date,
      'pending_entries', ct.pending_entries
    )
  end
  from ctx, cycle_totals ct;
$$;

create or replace function public.get_wallet_reconciliation()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select public.current_user_role() as role_name, public.current_group_id() as group_id
  ),
  grp as (
    select g.id, g.cycle_start_date from public.groups g join ctx on ctx.group_id = g.id
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
    select coalesce(c.payment_method, 'UNTAGGED') as method_key, c.approval_status,
           c.amount as addition_amount, 0::numeric(14,2) as deduction_amount, 0::numeric(14,2) as expense_amount
    from public.contributions c join grp on c.group_id = grp.id
    where c.approval_status in ('CONFIRMED', 'PENDING')
      and (c.approval_status = 'PENDING' or grp.cycle_start_date is null or c.payment_date >= grp.cycle_start_date)
    union all
    select coalesce(w.payment_method, 'UNTAGGED'), w.approval_status,
           0::numeric(14,2), w.amount, 0::numeric(14,2)
    from public.withdrawals w join grp on w.group_id = grp.id
    where w.approval_status in ('CONFIRMED', 'PENDING')
      and (w.approval_status = 'PENDING' or grp.cycle_start_date is null or w.transaction_date >= grp.cycle_start_date)
    union all
    select coalesce(e.payment_method, 'UNTAGGED'), e.approval_status,
           0::numeric(14,2), 0::numeric(14,2), e.amount
    from public.expenses e join grp on e.group_id = grp.id
    where e.approval_status in ('CONFIRMED', 'PENDING')
      and (e.approval_status = 'PENDING' or grp.cycle_start_date is null or e.transaction_date >= grp.cycle_start_date)
    union all
    select kv.key as method_key, 'CONFIRMED'::public.approval_status as approval_status,
           coalesce((kv.value ->> 'additions')::numeric(14,2), 0),
           coalesce((kv.value ->> 'deductions')::numeric(14,2), 0),
           coalesce((kv.value ->> 'expenses')::numeric(14,2), 0)
    from public.financial_annual_archives a
    join grp on grp.id = a.group_id
    cross join lateral jsonb_each(coalesce(a.payment_breakdown, '{}'::jsonb)) kv
    where grp.cycle_start_date is null or make_date(a.archive_year, 12, 31) >= grp.cycle_start_date
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
    select method_key, sort_order, additions, deductions, expenses,
           (additions - deductions - expenses)::numeric(14,2) as net_balance,
           pending_inflow, pending_outflow, entry_count, pending_count
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

-- 7. Automatic TTL Data Retention + 6-Month Inactive Account Lifecycle (with 7-day Email Warning)
alter table public.profiles
  add column if not exists inactivity_warned_at timestamptz;

create or replace function public.clear_inactivity_warning_on_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_seen_at is distinct from old.last_seen_at and new.last_seen_at is not null then
    new.inactivity_warned_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_clear_inactivity_warning on public.profiles;
create trigger profiles_clear_inactivity_warning
  before update of last_seen_at on public.profiles
  for each row execute function public.clear_inactivity_warning_on_activity();

create or replace function public.run_data_retention_cleanup(
  p_message_days integer default 90,
  p_audit_days integer default 90,
  p_read_notif_days integer default 30,
  p_unread_notif_days integer default 90,
  p_call_days integer default 30,
  p_bin_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_message_days, 90), 30));
  v_audit_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_audit_days, 90), 30));
  v_read_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_read_notif_days, 30), 7));
  v_unread_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_unread_notif_days, 90), 30));
  v_call_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_call_days, 30), 7));
  v_bin_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_bin_days, 30), 14));
  v_deleted_messages integer := 0;
  v_deleted_calls integer := 0;
  v_deleted_notifs integer := 0;
  v_deleted_audits integer := 0;
  v_deleted_activity integer := 0;
  v_deleted_throttles integer := 0;
  v_deleted_admin_req integer := 0;
  v_cleaned_receipts integer := 0;
  v_deleted_members integer := 0;
  v_conv_id uuid;
  v_latest record;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  -- Record affected conversations before purging >90d messages (message_attachments trigger queues Storage deletions)
  with purged as (
    delete from public.messages
    where created_at < v_msg_cutoff
    returning conversation_id
  )
  select count(*) into v_deleted_messages from purged;

  if v_deleted_messages > 0 then
    for v_conv_id in
      select c.id
      from public.conversations c
      where c.last_message_at is not null
        and (
          c.last_message_id is null
          or not exists (select 1 from public.messages m where m.id = c.last_message_id)
        )
    loop
      select m.id, m.created_at, m.sender_id,
             case
               when m.deleted_for_everyone_at is not null then 'Message removed'
               when char_length(btrim(m.body)) > 0 then left(btrim(m.body), 140)
               when m.message_type = 'VOICE' then 'Sent a voice message'
               else 'Sent an attachment'
             end as preview
      into v_latest
      from public.messages m
      where m.conversation_id = v_conv_id
      order by m.created_at desc
      limit 1;

      update public.conversations
      set last_message_id = v_latest.id,
          last_message_at = v_latest.created_at,
          last_message_sender_id = v_latest.sender_id,
          last_message_preview = v_latest.preview
      where id = v_conv_id;
    end loop;
  end if;

  delete from public.call_sessions
  where coalesce(ended_at, started_at, created_at) < v_call_cutoff;
  get diagnostics v_deleted_calls = row_count;

  delete from public.notifications
  where (read_at is not null and read_at < v_read_notif_cutoff)
     or (read_at is null and created_at < v_unread_notif_cutoff);
  get diagnostics v_deleted_notifs = row_count;

  delete from public.audit_logs
  where changed_at < v_audit_cutoff;
  get diagnostics v_deleted_audits = row_count;

  delete from public.account_activity
  where created_at < v_audit_cutoff;
  get diagnostics v_deleted_activity = row_count;

  delete from public.auth_login_throttles
  where updated_at < now() - interval '7 days';
  get diagnostics v_deleted_throttles = row_count;

  delete from public.admin_requests
  where status = 'REJECTED' and updated_at < v_audit_cutoff;
  get diagnostics v_deleted_admin_req = row_count;

  -- Clean rejected/voided receipt attachments >90 days (queues Storage cleanup trigger automatically)
  with upd_c as (
    update public.contributions
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_msg_cutoff
    returning 1
  ),
  upd_e as (
    update public.expenses
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_msg_cutoff
    returning 1
  )
  select (select count(*) from upd_c) + (select count(*) from upd_e) into v_cleaned_receipts;

  -- Permanently purge soft-deleted members older than 30 days who have zero remaining contributions
  delete from public.contribution_periods cp
  using public.members m
  where cp.member_id = m.id
    and m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.contribution_period_id = cp.id)
    and not exists (select 1 from public.contribution_periods cp2 join public.contributions c2 on c2.contribution_period_id = cp2.id where cp2.member_id = m.id);

  delete from public.members m
  where m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contribution_periods cp where cp.member_id = m.id);
  get diagnostics v_deleted_members = row_count;

  return jsonb_build_object(
    'messages_deleted', v_deleted_messages,
    'calls_deleted', v_deleted_calls,
    'notifications_deleted', v_deleted_notifs,
    'audit_logs_deleted', v_deleted_audits,
    'account_activity_deleted', v_deleted_activity,
    'login_throttles_deleted', v_deleted_throttles,
    'rejected_admin_requests_deleted', v_deleted_admin_req,
    'receipts_cleaned', v_cleaned_receipts,
    'expired_bin_members_deleted', v_deleted_members,
    'pending_storage_queue', (select count(*) from public.pending_storage_deletions)
  );
end;
$$;

revoke execute on function public.run_data_retention_cleanup(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;

-- Service-only candidate collector for 6-month inactive accounts (warns 7 days prior, purges after grace window)
create or replace function public.collect_inactive_account_candidates(
  p_inactive_months integer default 6,
  p_warning_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_inactive_span interval := make_interval(months => greatest(coalesce(p_inactive_months, 6), 1));
  v_warning_span interval := make_interval(days => greatest(coalesce(p_warning_days, 7), 1));
  v_warn_cutoff timestamptz := now() - (v_inactive_span - v_warning_span);
  v_warn_candidates jsonb := '[]'::jsonb;
  v_purge_candidates jsonb := '[]'::jsonb;
begin
  -- Clear stale warnings if user logged in or had activity after warning was sent
  update public.profiles p
  set inactivity_warned_at = null
  from auth.users u
  where u.id = p.id
    and p.inactivity_warned_at is not null
    and greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce(p.last_seen_at, p.created_at)
    ) > p.inactivity_warned_at;

  -- Users ready to purge (warned >= 7 days ago and still inactive)
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', p.id,
        'email', coalesce(nullif(p.email, ''), u.email),
        'full_name', p.full_name,
        'inactivity_warned_at', p.inactivity_warned_at
      )
    ),
    '[]'::jsonb
  )
  into v_purge_candidates
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role <> 'SUPER_ADMIN'
    and p.inactivity_warned_at is not null
    and p.inactivity_warned_at <= now() - v_warning_span
    and greatest(
      coalesce(u.last_sign_in_at, u.created_at),
      coalesce(p.last_seen_at, p.created_at),
      coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
      coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
    ) <= p.inactivity_warned_at;

  -- Users reaching (6 months - 7 days) inactivity -> mark & return for 7-day warning email
  with due_warn as (
    select p.id, coalesce(nullif(p.email, ''), u.email) as email, p.full_name,
           greatest(
             coalesce(u.last_sign_in_at, u.created_at),
             coalesce(p.last_seen_at, p.created_at),
             coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
             coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
           ) as last_active_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role <> 'SUPER_ADMIN'
      and p.inactivity_warned_at is null
      and greatest(
        coalesce(u.last_sign_in_at, u.created_at),
        coalesce(p.last_seen_at, p.created_at),
        coalesce((select max(c.created_at) from public.contributions c where c.submitted_by = p.id), 'epoch'::timestamptz),
        coalesce((select max(m.created_at) from public.messages m where m.sender_id = p.id), 'epoch'::timestamptz)
      ) <= v_warn_cutoff
  ),
  stamped as (
    update public.profiles p
    set inactivity_warned_at = now()
    from due_warn dw
    where p.id = dw.id
    returning dw.id as user_id, dw.email, dw.full_name, dw.last_active_at, (now() + v_warning_span) as scheduled_purge_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', s.user_id,
        'email', s.email,
        'full_name', s.full_name,
        'last_active_at', s.last_active_at,
        'scheduled_purge_at', s.scheduled_purge_at
      )
    ),
    '[]'::jsonb
  )
  into v_warn_candidates
  from stamped s;

  return jsonb_build_object(
    'warn_candidates', v_warn_candidates,
    'purge_candidates', v_purge_candidates
  );
end;
$$;

revoke execute on function public.collect_inactive_account_candidates(integer, integer) from public, anon, authenticated;

create or replace function public.reset_inactivity_warning_flag(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set inactivity_warned_at = null where id = p_user_id;
end;
$$;

revoke execute on function public.reset_inactivity_warning_flag(uuid) from public, anon, authenticated;

create or replace function public.purge_inactive_user_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.profiles%rowtype;
  v_grp record;
  v_next_owner uuid;
  v_att jsonb;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  select * into v_prof from public.profiles where id = p_user_id for update;
  if not found or v_prof.role = 'SUPER_ADMIN' then
    return false;
  end if;

  -- Queue chat attachments belonging to user's DM conversations or uploaded by them
  insert into public.pending_storage_deletions (bucket_id, object_path)
  select coalesce(nullif(ma.bucket_id, ''), 'chat-attachments'), ma.storage_path
  from public.message_attachments ma
  join public.conversations c on c.id = ma.conversation_id
  where c.user_a = p_user_id or c.user_b = p_user_id or ma.uploader_id = p_user_id
  on conflict (bucket_id, object_path) do nothing;

  -- Queue bug report media URLs belonging to this user
  for v_att in
    select elem
    from public.bug_reports br
    cross join lateral jsonb_array_elements(coalesce(br.attachments, '[]'::jsonb)) elem
    where br.reporter_id = p_user_id
  loop
    perform public.queue_media_url_deletion(coalesce(v_att ->> 'url', v_att ->> 'dataUrl'));
  end loop;

  -- Queue record-comments storage attachments authored by this user
  for v_att in
    select elem
    from public.record_comments rc
    cross join lateral jsonb_array_elements(coalesce(rc.attachments, '[]'::jsonb)) elem
    where rc.author_id = p_user_id
  loop
    perform public.queue_storage_object_deletion('record-comments', v_att ->> 'path');
  end loop;

  perform public.queue_media_url_deletion(v_prof.avatar_url);

  -- Preserve active shared groups by promoting the next active member; suspend dormant solo groups cleanly
  for v_grp in select id, avatar_url, payment_qr_url from public.groups where owner_id = p_user_id loop
    select gm.user_id into v_next_owner
    from public.group_memberships gm
    join public.profiles op on op.id = gm.user_id
    where gm.group_id = v_grp.id
      and gm.user_id <> p_user_id
      and gm.status = 'ACTIVE'
      and op.status = 'ACTIVE'
    order by
      case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end,
      gm.created_at asc
    limit 1;

    if v_next_owner is not null then
      update public.groups set owner_id = v_next_owner where id = v_grp.id;
      update public.group_memberships set role = 'ADMIN' where group_id = v_grp.id and user_id = v_next_owner;
      update public.announcements set author_id = v_next_owner where group_id = v_grp.id and author_id = p_user_id;
    else
      perform public.queue_media_url_deletion(v_grp.avatar_url);
      perform public.queue_media_url_deletion(v_grp.payment_qr_url);
      update public.groups set owner_id = null, status = 'SUSPENDED', avatar_url = null, payment_qr_url = null where id = v_grp.id;
    end if;
  end loop;

  delete from public.group_memberships where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  return true;
end;
$$;

revoke execute on function public.purge_inactive_user_data(uuid) from public, anon, authenticated;

-- Enhanced telemetry for Super Admin (DB inline media + Cloud Storage bucket usage + archive counts)
create or replace function public.super_admin_storage_overview()
returns jsonb
language sql
stable
security definer
set search_path = public, storage
as $$
  select case
    when not public.is_super_admin() then null
    else jsonb_build_object(
      'contribution_receipts_count', (select count(*) from public.contributions where receipt_url is not null),
      'contribution_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null),
      'expense_receipts_count', (select count(*) from public.expenses where receipt_url is not null),
      'expense_receipts_bytes', (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null),
      'announcements_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.announcements where jsonb_array_length(attachments) > 0),
      'bug_reports_media_bytes', (select coalesce(sum(pg_column_size(attachments)), 0) from public.bug_reports where jsonb_array_length(attachments) > 0),
      'avatars_and_qr_bytes',
        (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.profiles where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(avatar_url)), 0) from public.groups where avatar_url is not null)
        + (select coalesce(sum(pg_column_size(payment_qr_url)), 0) from public.groups where payment_qr_url is not null),
      'reclaimable_rejected_count',
        (select count(*) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select count(*) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'reclaimable_rejected_bytes',
        (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.contributions where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days')
        + (select coalesce(sum(pg_column_size(receipt_url)), 0) from public.expenses where receipt_url is not null and approval_status in ('REJECTED', 'VOIDED') and coalesce(reviewed_at, voided_at, updated_at, created_at) < now() - interval '90 days'),
      'audit_logs_bytes', pg_total_relation_size('public.audit_logs'),
      'audit_logs_count', (select count(*) from public.audit_logs),
      'messages_count', (select count(*) from public.messages),
      'storage_bucket_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
      'storage_bucket_objects', (select count(*) from storage.objects),
      'pending_storage_deletions', (select count(*) from public.pending_storage_deletions),
      'annual_archives_count', (select count(*) from public.financial_annual_archives)
    )
  end;
$$;

-- Trigger daily retention cleanup (runs SQL TTL now + invokes manage-account Edge Function for Storage + 7-day warning/inactive purge)
create or replace function public.trigger_daily_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_stats jsonb;
  v_secret text;
  v_push_url text;
  v_manage_url text;
begin
  v_stats := public.run_data_retention_cleanup();

  select value into v_secret from public.internal_webhook_config where key = 'push_webhook_secret';
  select value into v_push_url from public.internal_webhook_config where key = 'send_push_url';
  v_manage_url := coalesce(
    (select nullif(value, '') from public.internal_webhook_config where key = 'retention_cron_url'),
    case
      when nullif(v_push_url, '') is not null then regexp_replace(v_push_url, '/send-push/?$', '/manage-account')
      else 'https://woslmwokhhyszkgevnli.supabase.co/functions/v1/manage-account'
    end
  );

  if v_secret is not null and v_secret <> '' then
    begin
      perform net.http_post(
        url := v_manage_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-push-webhook-secret', v_secret
        ),
        body := jsonb_build_object(
          'action', 'retention-cron',
          'sql_summary', v_stats
        ),
        timeout_milliseconds := 10000
      );
    exception when others then
      null;
    end;
  end if;

  return v_stats;
end;
$$;

revoke execute on function public.trigger_daily_retention_cleanup() from public, anon, authenticated;

-- 8. Tune PostgreSQL autovacuum on high-churn tables so deleted dead tuples reclaim space quickly
alter table public.audit_logs set (autovacuum_enabled = true, autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.05);
alter table public.messages set (autovacuum_enabled = true, autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.05);
alter table public.notifications set (autovacuum_enabled = true, autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50, autovacuum_analyze_scale_factor = 0.05);
alter table public.account_activity set (autovacuum_enabled = true, autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 50);
alter table public.auth_login_throttles set (autovacuum_enabled = true, autovacuum_vacuum_scale_factor = 0.05, autovacuum_vacuum_threshold = 25);

-- Schedule daily midnight (00:00 Asia/Manila = 16:00 UTC) pg_cron retention sweep idempotently
do $$
declare
  v_job_id bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for v_job_id in select jobid from cron.job where jobname = 'ipon-daily-retention-cleanup' loop
      perform cron.unschedule(v_job_id);
    end loop;
    perform cron.schedule(
      'ipon-daily-retention-cleanup',
      '0 16 * * *',
      'select public.trigger_daily_retention_cleanup();'
    );
  end if;
exception when others then
  null;
end $$;

insert into public.schema_migrations (version, name)
values ('20261116_081', 'automated data retention ttl, cloud media storage, annual financial rollups, 500-char limits, and 6-month inactive purge')
on conflict (version) do nothing;

commit;
