-- Migration 20261113_032: Admin request email ownership verification (OTP) and Super Admin unblock / clear bogus email
begin;

create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null check (char_length(code) = 6),
  purpose text not null default 'ADMIN_REQUEST',
  metadata jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verifications_lookup_idx
on public.email_verifications (lower(email), purpose, created_at desc);

alter table public.email_verifications enable row level security;
revoke all on public.email_verifications from public, anon;
grant select on public.email_verifications to authenticated;

create or replace function public.request_admin_email_verification(p_email text, p_full_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(p_full_name, ''));
  v_eligibility jsonb;
  v_recent_count integer;
  v_code text;
begin
  if v_email = '' or v_email not like '%@%.%' then
    return jsonb_build_object('success', false, 'message', 'Please provide a valid email address.');
  end if;

  v_eligibility := public.check_admin_request_eligibility(v_email);
  if not coalesce((v_eligibility ->> 'eligible')::boolean, false) then
    return jsonb_build_object('success', false, 'message', coalesce(v_eligibility ->> 'message', 'This email is not eligible for administrator access.'));
  end if;

  select count(*) into v_recent_count
  from public.email_verifications
  where lower(email) = v_email
    and purpose = 'ADMIN_REQUEST'
    and created_at >= (now() - interval '15 minutes');

  if v_recent_count >= 5 then
    return jsonb_build_object('success', false, 'message', 'Too many verification attempts for this email. Please wait 15 minutes before requesting a new code.');
  end if;

  v_code := lpad((floor(random() * 900000) + 100000)::text, 6, '0');

  insert into public.email_verifications (email, code, purpose, metadata, expires_at)
  values (
    v_email,
    v_code,
    'ADMIN_REQUEST',
    jsonb_build_object('full_name', v_name),
    now() + interval '10 minutes'
  );

  return jsonb_build_object(
    'success', true,
    'email', v_email,
    'code', v_code,
    'message', 'Verification code generated.'
  );
end;
$$;

create or replace function public.verify_admin_email_verification(p_email text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_code text := btrim(coalesce(p_code, ''));
  v_rec record;
begin
  if v_email = '' or v_code = '' then
    return jsonb_build_object('success', false, 'message', 'Email and 6-digit verification code are required.');
  end if;

  select id, code, attempts, expires_at, verified_at
  into v_rec
  from public.email_verifications
  where lower(email) = v_email
    and purpose = 'ADMIN_REQUEST'
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'message', 'No active verification code found for this email. Please request a new code.');
  end if;

  if v_rec.verified_at is not null then
    return jsonb_build_object('success', true, 'message', 'Email is already verified.');
  end if;

  if v_rec.expires_at < now() then
    return jsonb_build_object('success', false, 'message', 'Verification code has expired. Please request a new code.');
  end if;

  if v_rec.attempts >= 5 then
    return jsonb_build_object('success', false, 'message', 'Too many invalid attempts. Please request a new verification code.');
  end if;

  if v_rec.code <> v_code then
    update public.email_verifications
    set attempts = attempts + 1
    where id = v_rec.id;
    return jsonb_build_object('success', false, 'message', 'Incorrect 6-digit verification code. Please check your inbox.');
  end if;

  update public.email_verifications
  set verified_at = now()
  where id = v_rec.id;

  return jsonb_build_object('success', true, 'message', 'Email verified successfully.');
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

  if v_account_kind = 'ADMIN_REQUEST' then
    if exists (
      select 1 from public.admin_requests ar
      where lower(ar.email) = lower(new.email)
        and ar.status = 'REJECTED'
    ) or exists (
      select 1 from public.profiles p
      where lower(p.email) = lower(new.email)
        and p.status = 'DISABLED'
        and p.role = 'MEMBER'
    ) then
      raise exception 'This email address was declined for administrator access and cannot request again.' using errcode = '22023';
    end if;

    if v_contact is null or v_reason is null or char_length(v_reason) < 10 then
      raise exception 'Administrator requests require a contact number and a reason of at least 10 characters.' using errcode = '22023';
    end if;

    -- Enforce email ownership verification
    if not exists (
      select 1 from public.email_verifications ev
      where lower(ev.email) = lower(new.email)
        and ev.purpose = 'ADMIN_REQUEST'
        and ev.verified_at is not null
        and ev.verified_at >= now() - interval '30 minutes'
    ) then
      raise exception 'Email ownership has not been verified. Please verify your email before submitting.' using errcode = '22023';
    end if;
  end if;

  insert into public.profiles (id, full_name, first_name, middle_name, last_name, email, contact_number, role, status)
  values (new.id, v_full_name, v_first_name, v_middle_name, v_last_name, lower(new.email), v_contact, 'MEMBER', 'PENDING')
  on conflict (id) do nothing;

  if v_account_kind = 'ADMIN_REQUEST' then
    insert into public.admin_requests (requester_id, email, contact_number, reason)
    values (new.id, lower(new.email), v_contact, v_reason);

    for v_super_admin in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
      perform public.push_notification(v_super_admin.id, 'ADMIN_REQUEST', 'New administrator request', v_full_name || ' requested administrator access.', 'super-admin.html#requests');
    end loop;
  end if;
  return new;
end;
$$;

create or replace function public.super_admin_unblock_admin_request(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target record;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super administrator can unblock administrator requests.' using errcode = '42501';
  end if;

  select id, email, full_name, role, status, group_id
  into v_target
  from public.profiles
  where id = p_user_id;

  if not found then
    raise exception 'Target request profile not found.' using errcode = 'P0002';
  end if;

  if v_target.role <> 'MEMBER' or v_target.group_id is not null then
    raise exception 'Only pending or declined administrator applicants without a savings group can be unblocked.' using errcode = '22023';
  end if;

  delete from public.admin_requests where requester_id = p_user_id;
  delete from public.profiles where id = p_user_id;
  delete from public.email_verifications where lower(email) = lower(v_target.email);

  perform public.log_system_action(
    'ADMIN_REQUEST_UNBLOCKED',
    v_target.email,
    jsonb_build_object(
      'target_user_id', p_user_id,
      'email', v_target.email,
      'full_name', v_target.full_name
    )
  );

  return jsonb_build_object(
    'unblocked', true,
    'email', v_target.email,
    'full_name', v_target.full_name
  );
end;
$$;

revoke execute on function public.request_admin_email_verification(text, text) from public;
grant execute on function public.request_admin_email_verification(text, text) to anon, authenticated;

revoke execute on function public.verify_admin_email_verification(text, text) from public;
grant execute on function public.verify_admin_email_verification(text, text) to anon, authenticated;

revoke execute on function public.super_admin_unblock_admin_request(uuid) from public, anon;
grant execute on function public.super_admin_unblock_admin_request(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_032', 'admin request email ownership verification and unblock')
on conflict (version) do nothing;

commit;

