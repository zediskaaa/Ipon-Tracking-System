-- Add OPEN/FIXED status workflow for bug reports integrated with release announcements
-- and Release AI notes, and remove the unintended group assignment from Brainier Garcia.

begin;

-- 1. Remove unintended group membership/assignment where no member record is linked
delete from public.group_memberships
where user_id = '68853776-6a1b-4170-afb8-5dd93c3de90c'::uuid
  and group_id = '0ef665ea-3fb3-4919-8d39-f4c1a2693d78'::uuid
  and member_id is null;

update public.profiles
set group_id = null,
    member_id = null
where id = '68853776-6a1b-4170-afb8-5dd93c3de90c'::uuid
  and group_id = '0ef665ea-3fb3-4919-8d39-f4c1a2693d78'::uuid
  and member_id is null;

-- 2. Extend bug_reports with status, review metadata, and release linkage
alter table public.bug_reports
  add column if not exists status text not null default 'OPEN' check (status in ('OPEN', 'FIXED')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists release_version text;

create index if not exists bug_reports_status_idx
  on public.bug_reports (status, created_at desc);

-- 3. Super Admin RPC to mark bug reports fixed or reopen them
create or replace function public.review_bug_report(
  p_report_id uuid,
  p_status text,
  p_release_version text default null
)
returns public.bug_reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_row public.bug_reports;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can review bug reports.' using errcode = '42501';
  end if;

  if v_status not in ('OPEN', 'FIXED') then
    raise exception 'Invalid bug report status.' using errcode = '22023';
  end if;

  update public.bug_reports
  set status = v_status,
      reviewed_at = case when v_status = 'OPEN' then null else now() end,
      reviewed_by = case when v_status = 'OPEN' then null else auth.uid() end,
      release_version = case
        when v_status = 'FIXED' then nullif(btrim(coalesce(p_release_version, release_version, '')), '')
        else null
      end
  where id = p_report_id
  returning * into v_row;

  if not found then
    raise exception 'Bug report not found.' using errcode = 'P0002';
  end if;

  if v_status = 'FIXED' and v_row.reporter_id is not null then
    perform public.push_notification(
      v_row.reporter_id,
      'BUG_REPORT_FIXED',
      'Bug report fixed',
      'Your bug report "' || left(v_row.title, 90) || '" was marked as fixed.',
      'dashboard.html'
    );
  end if;

  return v_row;
end;
$$;

revoke all on function public.review_bug_report(uuid, text, text) from public, anon;
grant execute on function public.review_bug_report(uuid, text, text) to authenticated;

-- 4. Stamp release_version on FIXED unreleased bug reports when publishing a RELEASE announcement
create or replace function public.create_announcement(
  p_id uuid default null,
  p_title text default '',
  p_description text default '',
  p_attachments jsonb default '[]'::jsonb,
  p_announcement_type text default 'GENERAL',
  p_release_version text default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_id uuid := coalesce(p_id, gen_random_uuid());
  v_prefix text;
  v_item jsonb;
  v_path text;
  v_type text := upper(btrim(coalesce(p_announcement_type, 'GENERAL')));
  v_version text := nullif(btrim(coalesce(p_release_version, '')), '');
  v_row public.announcements;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid() and status = 'ACTIVE';

  if not found or v_profile.role not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only the Owner or a Group Administrator can post announcements.' using errcode = '42501';
  end if;

  if v_profile.role = 'ADMIN' and v_profile.group_id is null then
    raise exception 'Administrator account is not assigned to a savings group.' using errcode = '42501';
  end if;

  if v_type not in ('GENERAL', 'RELEASE') then
    raise exception 'Invalid announcement type.' using errcode = '22023';
  end if;

  if v_type = 'RELEASE' then
    if v_profile.role <> 'SUPER_ADMIN' then
      raise exception 'Only the Super Admin can publish system release updates.' using errcode = '42501';
    end if;
    if v_version is null then
      raise exception 'Release version is required for system release updates.' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.announcements
      where deleted_at is null
        and lower(btrim(coalesce(release_version, ''))) = lower(v_version)
    ) then
      raise exception 'Release version "%" has already been published. Please use a unique version.', v_version using errcode = '23505';
    end if;
  else
    v_version := null;
  end if;

  if char_length(btrim(coalesce(p_title, ''))) = 0 or char_length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Announcement title and description are required.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
    raise exception 'Announcement attachments must be a JSON array.' using errcode = '22023';
  end if;

  v_prefix := case
    when v_profile.role = 'SUPER_ADMIN' then 'platform/' || v_profile.id::text || '/'
    else 'group/' || v_profile.group_id::text || '/'
  end;

  for v_item in select value from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb)) loop
    v_path := coalesce(v_item->>'path', '');
    if v_path = '' or position('..' in v_path) > 0 or left(v_path, char_length(v_prefix)) <> v_prefix then
      raise exception 'Invalid attachment storage path.' using errcode = '42501';
    end if;
  end loop;

  insert into public.announcements (
    id, group_id, author_id, author_name, author_role, title, description, attachments, announcement_type, release_version
  ) values (
    v_id,
    case when v_profile.role = 'SUPER_ADMIN' then null else v_profile.group_id end,
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    btrim(p_title),
    btrim(p_description),
    coalesce(p_attachments, '[]'::jsonb),
    v_type,
    v_version
  )
  returning * into v_row;

  if v_type = 'RELEASE' and v_version is not null then
    update public.feature_requests
    set release_version = v_version
    where status = 'IMPLEMENTED' and release_version is null;

    update public.bug_reports
    set release_version = v_version
    where status = 'FIXED' and release_version is null;
  end if;

  return v_row;
end;
$$;

revoke all on function public.create_announcement(uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function public.create_announcement(uuid, text, text, jsonb, text, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261116_092', 'add bug report open/fixed workflow for release updates and remove stray group assignment')
on conflict (version) do nothing;

commit;
