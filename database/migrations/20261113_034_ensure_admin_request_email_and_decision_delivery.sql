begin;

-- 1. Backfill public.profiles.email from admin_requests and auth.users where email is missing
update public.profiles p
set email = lower(ar.email)
from public.admin_requests ar
where p.id = ar.requester_id
  and (p.email is null or btrim(p.email) = '');

update public.profiles p
set email = lower(u.email)
from auth.users u
where p.id = u.id
  and (p.email is null or btrim(p.email) = '');

-- 2. Update super_admin_reject_request to ensure email is retained/backfilled when rejecting
create or replace function public.super_admin_reject_request(p_user_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_review_note, '')), '');
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can reject administrator requests.' using errcode = '42501'; end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'A reason of at least 3 characters is required when rejecting an administrator request.' using errcode = '22023';
  end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  update public.profiles
  set status = 'DISABLED',
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  update public.admin_requests set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(p_user_id, 'ADMIN_REJECTED', 'Administrator request declined', v_note, null);
end;
$$;

-- 3. Update super_admin_approve_request to ensure email is retained/backfilled when approving
create or replace function public.super_admin_approve_request(p_user_id uuid, p_group_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_name text := nullif(btrim(p_group_name), '');
  v_group_id uuid;
  v_admin_email text;
begin
  if not public.is_super_admin() then raise exception 'Only a super administrator can approve administrator requests.' using errcode = '42501'; end if;
  if v_group_name is null or char_length(v_group_name) < 2 then raise exception 'A group name of at least 2 characters is required.' using errcode = '22023'; end if;

  select lower(ar.email) into v_admin_email
  from public.admin_requests ar
  where ar.requester_id = p_user_id and ar.status = 'PENDING'
  order by ar.created_at desc limit 1;

  insert into public.groups (name, owner_id) values (v_group_name, p_user_id) returning id into v_group_id;

  update public.profiles
  set role = 'ADMIN',
      status = 'ACTIVE',
      group_id = v_group_id,
      email = coalesce(email, v_admin_email)
  where id = p_user_id and role = 'MEMBER' and status = 'PENDING' and group_id is null and member_id is null;
  if not found then raise exception 'Pending administrator request not found.' using errcode = 'P0002'; end if;

  update public.admin_requests set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
  where requester_id = p_user_id and status = 'PENDING';

  perform public.push_notification(p_user_id, 'ADMIN_APPROVED', 'Administrator request approved', 'Your request was approved. Group "' || v_group_name || '" is ready.', 'admin.html');
  return v_group_id;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261113_034', 'ensure admin request email backfill and decision delivery')
on conflict (version) do nothing;

commit;

