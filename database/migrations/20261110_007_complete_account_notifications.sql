begin;

alter table public.profiles
  add column if not exists email text,
  add column if not exists contact_number text,
  add column if not exists notifications_enabled boolean not null default true;

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id and p.email is null;

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email)) where email is not null;

create table if not exists public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null unique references public.profiles(id) on delete cascade,
  email text not null,
  contact_number text,
  reason text not null check (char_length(btrim(reason)) between 10 and 1000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  type text not null,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  message text not null check (char_length(btrim(message)) between 2 and 500),
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.account_activity (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event text not null check (event in ('LOGIN', 'PROFILE_UPDATE', 'PASSWORD_CHANGE')),
  created_at timestamptz not null default now()
);

alter table public.contribution_settings
  add column if not exists deadline_day smallint not null default 28
  check (deadline_day between 1 and 28);

alter table public.contribution_periods add column if not exists due_date date;

update public.contribution_periods
set due_date = (period_month + interval '1 month - 1 day')::date
where due_date is null;

alter table public.contribution_periods alter column due_date set not null;

create index if not exists admin_requests_status_idx on public.admin_requests (status, created_at desc);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);
create index if not exists account_activity_user_idx on public.account_activity (user_id, created_at desc);

insert into public.admin_requests (requester_id, email, contact_number, reason)
select id, email, contact_number, 'This request was created before detailed request information was required.'
from public.profiles
where role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null and email is not null
on conflict (requester_id) do nothing;

drop trigger if exists admin_requests_updated_at on public.admin_requests;
create trigger admin_requests_updated_at before update on public.admin_requests
  for each row execute function public.set_updated_at();

create or replace function public.push_notification(
  p_recipient_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_group_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.profiles
    where id = p_recipient_id and status <> 'DISABLED' and notifications_enabled
  ) then
    insert into public.notifications (recipient_id, group_id, type, title, message, link)
    values (p_recipient_id, p_group_id, p_type, btrim(p_title), btrim(p_message), nullif(btrim(p_link), ''));
  end if;
end;
$$;

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
  v_contact text;
  v_reason text;
  v_account_kind text := coalesce(new.raw_user_meta_data ->> 'account_kind', 'MANAGED');
  v_super_admin record;
begin
  if nullif(btrim(new.raw_user_meta_data ->> 'first_name'), '') is not null
     and nullif(btrim(new.raw_user_meta_data ->> 'last_name'), '') is not null then
    v_first_name := public.validated_name_part(new.raw_user_meta_data ->> 'first_name', 'First name');
    v_middle_name := public.validated_name_part(new.raw_user_meta_data ->> 'middle_name', 'Middle name', false);
    v_last_name := public.validated_name_part(new.raw_user_meta_data ->> 'last_name', 'Last name');
    v_full_name := concat_ws(' ', v_first_name, v_middle_name, v_last_name);
  else
    v_full_name := case
      when char_length(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''))) >= 2 then btrim(new.raw_user_meta_data ->> 'full_name')
      when char_length(btrim(split_part(coalesce(new.email, ''), '@', 1))) >= 2 then btrim(split_part(new.email, '@', 1))
      else 'New User'
    end;
  end if;

  v_contact := public.normalize_ph_mobile(new.raw_user_meta_data ->> 'contact_number');
  v_reason := nullif(btrim(new.raw_user_meta_data ->> 'request_reason'), '');

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', 'PENDING')
  on conflict (id) do nothing;

  if v_account_kind = 'ADMIN_REQUEST' then
    if v_contact is null or v_reason is null or char_length(v_reason) < 10 then
      raise exception 'Administrator requests require a contact number and a reason of at least 10 characters.' using errcode = '22023';
    end if;
    insert into public.admin_requests (requester_id, email, contact_number, reason)
    values (new.id, lower(new.email), v_contact, v_reason);

    for v_super_admin in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_super_admin.id, 'ADMIN_REQUEST', 'New administrator request', v_full_name || ' requested administrator access.', 'super-admin.html#requests');
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.sync_user_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.email is distinct from new.email then
    update public.profiles set email = lower(new.email) where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_user_email();

create or replace function public.update_own_profile(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.validated_name_part(p_first_name, 'First name');
  v_middle text := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last text := public.validated_name_part(p_last_name, 'Last name');
begin
  update public.profiles
  set first_name = v_first, middle_name = v_middle, last_name = v_last,
      full_name = concat_ws(' ', v_first, v_middle, v_last),
      contact_number = public.normalize_ph_mobile(p_contact_number)
  where id = auth.uid() and status = 'ACTIVE';
  if not found then raise exception 'Active profile not found.' using errcode = 'P0002'; end if;
  insert into public.account_activity (user_id, event) values (auth.uid(), 'PROFILE_UPDATE');
end;
$$;

create or replace function public.record_account_activity(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event not in ('LOGIN', 'PASSWORD_CHANGE') then
    raise exception 'Unsupported account activity.' using errcode = '22023';
  end if;
  insert into public.account_activity (user_id, event) values (auth.uid(), p_event);
end;
$$;

create or replace function public.set_notification_preferences(p_enabled boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set notifications_enabled = p_enabled where id = auth.uid();
$$;

create or replace function public.mark_notification_read(p_notification_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = coalesce(read_at, now())
  where id = p_notification_id and recipient_id = auth.uid();
$$;

create or replace function public.mark_all_notifications_read()
returns void
language sql
security definer
set search_path = public
as $$
  update public.notifications set read_at = now()
  where recipient_id = auth.uid() and read_at is null;
$$;

create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_group_name text := btrim(coalesce(p_group_name, ''));
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if char_length(v_group_name) < 2 or char_length(v_group_name) > 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;

  update public.profiles set role = 'ADMIN', status = 'ACTIVE', member_id = null
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;
  update public.profiles set group_id = v_group_id where id = p_user_id;
  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_APPROVED', 'Administrator access approved', 'Your administrator account and savings group are ready.', 'dashboard.html', v_group_id);
  perform public.push_notification(auth.uid(), 'ADMIN_CREATED', 'Administrator account created', v_group_name || ' is now active.', 'super-admin.html#administrators');
  return v_group_id;
end;
$$;

drop function if exists public.super_admin_reject_request(uuid);
create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  update public.profiles set status = 'DISABLED'
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;
  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(btrim(p_review_note), '')
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', coalesce(nullif(btrim(p_review_note), ''), 'Your administrator access request was not approved.'), null);
end;
$$;

create or replace function public.super_admin_update_administrator(
  p_user_id uuid,
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_group_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.validated_name_part(p_first_name, 'First name');
  v_middle text := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last text := public.validated_name_part(p_last_name, 'Last name');
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can edit administrators.' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_group_name, ''))) not between 2 and 150 then raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023'; end if;
  update public.profiles set first_name = v_first, middle_name = v_middle, last_name = v_last, full_name = concat_ws(' ', v_first, v_middle, v_last)
  where id = p_user_id and role = 'ADMIN';
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups set name = btrim(p_group_name) where owner_id = p_user_id;
end;
$$;

create or replace function public.super_admin_archive_administrator(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can archive administrators.' using errcode = '42501'; end if;
  update public.profiles set status = 'DISABLED' where id = p_user_id and role = 'ADMIN';
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups set status = 'SUSPENDED' where owner_id = p_user_id;
  perform public.push_notification(auth.uid(), 'ADMIN_ARCHIVED', 'Administrator archived', 'An administrator account and its group were suspended.', 'super-admin.html#administrators');
end;
$$;

create or replace function public.super_admin_set_administrator_status(p_user_id uuid, p_status public.account_status)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can change administrator status.' using errcode = '42501'; end if;
  if p_status not in ('ACTIVE', 'DISABLED') then raise exception 'Administrator status must be ACTIVE or DISABLED.' using errcode = '22023'; end if;
  update public.profiles set status = p_status where id = p_user_id and role = 'ADMIN';
  if not found then raise exception 'Administrator not found.' using errcode = 'P0002'; end if;
  update public.groups set status = case when p_status = 'ACTIVE' then 'ACTIVE' else 'SUSPENDED' end where owner_id = p_user_id;
  perform public.push_notification(auth.uid(), 'ADMIN_STATUS', 'Administrator status changed', 'An administrator account is now ' || lower(p_status::text) || '.', 'super-admin.html#administrators');
end;
$$;

drop function if exists public.set_contribution_setting(date, numeric);
create or replace function public.set_contribution_setting(
  p_effective_month date,
  p_default_amount numeric,
  p_deadline_day integer default 28
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
  if not public.is_admin() or v_group_id is null then raise exception 'Only a group administrator can change contribution settings.' using errcode = '42501'; end if;
  if p_deadline_day not between 1 and 28 then raise exception 'Deadline day must be between 1 and 28.' using errcode = '22023'; end if;
  insert into public.contribution_settings (group_id, effective_month, default_amount, deadline_day, created_by)
  values (v_group_id, v_month, public.validated_money(p_default_amount, 'Default amount'), p_deadline_day, auth.uid())
  on conflict (group_id, effective_month) do update set default_amount = excluded.default_amount, deadline_day = excluded.deadline_day, created_by = auth.uid(), created_at = now()
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
  v_deadline integer;
  v_due_date date;
begin
  if not public.is_admin() or public.current_group_id() is null then raise exception 'Only a group administrator can generate contribution periods.' using errcode = '42501'; end if;
  select deadline_day into v_deadline from public.contribution_settings
  where group_id = public.current_group_id() and effective_month <= v_month order by effective_month desc limit 1;
  v_deadline := coalesce(v_deadline, 28);
  v_due_date := make_date(extract(year from v_month)::integer, extract(month from v_month)::integer, v_deadline);
  insert into public.contribution_periods (member_id, period_month, required_amount, due_date)
  select id, v_month, monthly_contribution_amount, v_due_date from public.members
  where status = 'ACTIVE' and group_id = public.current_group_id() and date_registered <= (v_month + interval '1 month - 1 day')::date
  on conflict (member_id, period_month) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.get_user_dashboard()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.current_member_id() is null then null else jsonb_build_object(
    'total_contributed', (select coalesce(sum(c.amount), 0) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = public.current_member_id() and c.approval_status = 'CONFIRMED'),
    'months_paid', (select count(*) from public.v_contribution_status where member_id = public.current_member_id() and payment_status in ('PAID', 'OVERPAID')),
    'months_unpaid', (select count(*) from public.v_contribution_status where member_id = public.current_member_id() and payment_status in ('UNPAID', 'PARTIALLY PAID') and period_month <= date_trunc('month', current_date)::date),
    'pending_submissions', (select count(*) from public.contributions c join public.contribution_periods cp on cp.id = c.contribution_period_id where cp.member_id = public.current_member_id() and c.approval_status = 'PENDING'),
    'current_period', (select to_jsonb(x) from (select vcs.period_month, vcs.required_amount, vcs.paid_amount, vcs.outstanding_amount, vcs.payment_status, cp.due_date from public.v_contribution_status vcs join public.contribution_periods cp on cp.id = vcs.contribution_period_id where vcs.member_id = public.current_member_id() and vcs.period_month = date_trunc('month', current_date)::date) x)
  ) end;
$$;

create or replace function public.notify_record_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin record;
  v_group uuid := new.group_id;
  v_label text := case tg_table_name when 'contributions' then 'contribution' when 'withdrawals' then 'deduction' else 'expense' end;
begin
  if tg_op = 'INSERT' and new.approval_status = 'PENDING' then
    for v_admin in select id from public.profiles where group_id = v_group and role = 'ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_admin.id, 'REVIEW_REQUIRED', 'New ' || v_label || ' submitted', 'A record is waiting for your review.', 'dashboard.html', v_group);
    end loop;
    if new.submitted_by is not null then perform public.push_notification(new.submitted_by, 'SUBMITTED', initcap(v_label) || ' submitted', 'Your record is waiting for administrator review.', 'user.html', v_group); end if;
  elsif tg_op = 'UPDATE' and old.approval_status = 'PENDING' and new.approval_status in ('CONFIRMED', 'REJECTED') and new.submitted_by is not null then
    perform public.push_notification(new.submitted_by, 'REVIEWED', initcap(v_label) || ' ' || lower(new.approval_status), 'Your submitted ' || v_label || ' was ' || lower(new.approval_status) || '.', 'user.html', v_group);
  elsif tg_op = 'UPDATE' and old.approval_status = new.approval_status and new.approval_status = 'PENDING' then
    for v_admin in select id from public.profiles where group_id = v_group and role = 'ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_admin.id, 'RECORD_UPDATED', initcap(v_label) || ' updated', 'A pending record was updated and remains ready for review.', 'dashboard.html', v_group);
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_admin record;
begin
  for v_admin in select id from public.profiles where group_id = new.group_id and role = 'ADMIN' and status = 'ACTIVE' loop
    perform public.push_notification(v_admin.id, 'MEMBER_CREATED', 'Member registered', new.full_name || ' was added to your group.', 'members.html', new.group_id);
  end loop;
  return new;
end;
$$;

create or replace function public.notify_profile_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role = 'MEMBER' and old.status is distinct from new.status and new.status = 'ACTIVE' then
    perform public.push_notification(new.id, 'ACCOUNT_READY', 'Your account is ready', 'Your member account is active and linked to your savings profile.', 'user.html', new.group_id);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_access_notifications on public.profiles;
create trigger profiles_access_notifications after update of status on public.profiles
  for each row execute function public.notify_profile_access();

drop trigger if exists members_notifications on public.members;
create trigger members_notifications after insert on public.members
  for each row execute function public.notify_new_member();

create or replace function public.create_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  insert into public.notifications (recipient_id, group_id, type, title, message, link)
  select p.id, cp.group_id, 'CONTRIBUTION_REMINDER', 'Contribution deadline approaching',
         'Your ' || to_char(cp.period_month, 'FMMonth YYYY') || ' contribution is due on ' || to_char(cp.due_date, 'Mon DD, YYYY') || '.', 'user.html'
  from public.contribution_periods cp
  join public.profiles p on p.member_id = cp.member_id and p.status = 'ACTIVE' and p.notifications_enabled
  join public.v_contribution_status vcs on vcs.contribution_period_id = cp.id
  where cp.due_date between current_date and current_date + 3
    and vcs.outstanding_amount > 0
    and not exists (
      select 1 from public.notifications n where n.recipient_id = p.id and n.type = 'CONTRIBUTION_REMINDER'
        and n.created_at::date = current_date and n.message like '%' || to_char(cp.period_month, 'FMMonth YYYY') || '%'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

do $$
declare v_table text;
begin
  foreach v_table in array array['contributions', 'withdrawals', 'expenses'] loop
    execute format('drop trigger if exists %I_notifications on public.%I', v_table, v_table);
    execute format('create trigger %I_notifications after insert or update on public.%I for each row execute function public.notify_record_activity()', v_table, v_table);
  end loop;
end $$;

alter table public.admin_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.account_activity enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

drop policy if exists admin_requests_select on public.admin_requests;
create policy admin_requests_select on public.admin_requests for select to authenticated
using (requester_id = auth.uid() or public.is_super_admin());
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
using (recipient_id = auth.uid());
drop policy if exists account_activity_select on public.account_activity;
create policy account_activity_select on public.account_activity for select to authenticated
using (user_id = auth.uid() or (public.is_super_admin() and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'ADMIN')));

revoke all on public.admin_requests, public.notifications, public.account_activity from public, anon, authenticated;
grant select on public.admin_requests, public.notifications, public.account_activity to authenticated;

revoke execute on function public.push_notification(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.update_own_profile(text, text, text, text) from public, anon;
revoke execute on function public.record_account_activity(text) from public, anon;
revoke execute on function public.set_notification_preferences(boolean) from public, anon;
revoke execute on function public.mark_notification_read(bigint) from public, anon;
revoke execute on function public.mark_all_notifications_read() from public, anon;
revoke execute on function public.super_admin_update_administrator(uuid, text, text, text, text) from public, anon;
revoke execute on function public.super_admin_archive_administrator(uuid) from public, anon;
revoke execute on function public.super_admin_set_administrator_status(uuid, public.account_status) from public, anon;
revoke execute on function public.super_admin_reject_request(uuid, text) from public, anon;
revoke execute on function public.get_user_dashboard() from public, anon;
revoke execute on function public.notify_record_activity() from public, anon, authenticated;
revoke execute on function public.notify_new_member() from public, anon, authenticated;
revoke execute on function public.notify_profile_access() from public, anon, authenticated;
revoke execute on function public.create_due_reminders() from public, anon, authenticated;
grant execute on function public.update_own_profile(text, text, text, text) to authenticated;
grant execute on function public.record_account_activity(text) to authenticated;
grant execute on function public.set_notification_preferences(boolean) to authenticated;
grant execute on function public.mark_notification_read(bigint) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.super_admin_update_administrator(uuid, text, text, text, text) to authenticated;
grant execute on function public.super_admin_archive_administrator(uuid) to authenticated;
grant execute on function public.super_admin_set_administrator_status(uuid, public.account_status) to authenticated;
grant execute on function public.super_admin_reject_request(uuid, text) to authenticated;
grant execute on function public.get_user_dashboard() to authenticated;
grant execute on function public.set_contribution_setting(date, numeric, integer) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261110_007', 'complete account notifications and user workflow')
on conflict (version) do nothing;

commit;
