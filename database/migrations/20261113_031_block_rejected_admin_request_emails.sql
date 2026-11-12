-- Migration 20261113_031: Block re-requesting administrator access with rejected emails and add eligibility check.
begin;

create or replace function public.check_admin_request_eligibility(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_request record;
  v_profile record;
begin
  if v_email = '' or v_email not like '%@%.%' then
    return jsonb_build_object('eligible', false, 'reason', 'invalid_email', 'message', 'Please provide a valid email address.');
  end if;

  select status, review_note, created_at into v_request
  from public.admin_requests
  where lower(email) = v_email
  order by created_at desc
  limit 1;

  if v_request.status = 'REJECTED' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'rejected',
      'message', 'This email address was previously declined for administrator access and cannot request again.',
      'review_note', v_request.review_note
    );
  end if;

  if v_request.status = 'PENDING' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'pending',
      'message', 'An administrator request for this email is already awaiting Super Admin review.'
    );
  end if;

  select role, status into v_profile
  from public.profiles
  where lower(email) = v_email
  limit 1;

  if v_profile.status = 'DISABLED' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'disabled',
      'message', 'This account has been disabled and cannot submit an administrator request.'
    );
  end if;

  if v_profile.status = 'ACTIVE' then
    return jsonb_build_object(
      'eligible', false,
      'reason', 'active',
      'message', 'An account already exists for this email address. Please sign in instead.'
    );
  end if;

  return jsonb_build_object('eligible', true);
end;
$$;

revoke execute on function public.check_admin_request_eligibility(text) from public;
grant execute on function public.check_admin_request_eligibility(text) to anon, authenticated;

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

create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'A reason of at least 3 characters is required when rejecting an administrator request.' using errcode = '22023';
  end if;
  update public.profiles set status = 'DISABLED'
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;
  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where requester_id = p_user_id and status = 'PENDING';
  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', v_note, null);
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261113_031', 'block rejected admin request emails and add eligibility check')
on conflict (version) do nothing;

commit;
