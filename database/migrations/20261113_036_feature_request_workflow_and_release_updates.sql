-- 20261113_036_feature_request_workflow_and_release_updates.sql
begin;

-- 1. Extend feature_requests table with status and review tracking
alter table public.feature_requests
  add column if not exists status text not null default 'PENDING' check (status in ('PENDING', 'IMPLEMENTED', 'REJECTED')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists release_version text;

create index if not exists feature_requests_status_idx
  on public.feature_requests (status, created_at desc);

-- 2. Extend announcements table with announcement_type and release_version
alter table public.announcements
  add column if not exists announcement_type text not null default 'GENERAL' check (announcement_type in ('GENERAL', 'RELEASE')),
  add column if not exists release_version text;

create unique index if not exists announcements_release_version_unique_idx
  on public.announcements (btrim(lower(release_version)))
  where deleted_at is null and release_version is not null;

-- 3. Function for Super Admin to review feature requests
create or replace function public.review_feature_request(
  p_request_id uuid,
  p_status text,
  p_release_version text default null
)
returns public.feature_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_row public.feature_requests;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can review feature requests.' using errcode = '42501';
  end if;

  if v_status not in ('PENDING', 'IMPLEMENTED', 'REJECTED') then
    raise exception 'Invalid feature request status.' using errcode = '22023';
  end if;

  update public.feature_requests
  set status = v_status,
      reviewed_at = case when v_status = 'PENDING' then null else now() end,
      reviewed_by = case when v_status = 'PENDING' then null else auth.uid() end,
      release_version = case when v_status = 'IMPLEMENTED' then nullif(btrim(coalesce(p_release_version, release_version, '')), '') else null end
  where id = p_request_id
  returning * into v_row;

  if not found then
    raise exception 'Feature request not found.' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.review_feature_request(uuid, text, text) from public, anon;
grant execute on function public.review_feature_request(uuid, text, text) to authenticated;

-- 4. Update create_announcement to accept announcement_type and release_version
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
  end if;

  return v_row;
end;
$$;

revoke all on function public.create_announcement(uuid, text, text, jsonb, text, text) from public, anon;
grant execute on function public.create_announcement(uuid, text, text, jsonb, text, text) to authenticated;

-- 5. Drop and recreate v_announcements view to include announcement_type and release_version
drop view if exists public.v_announcements cascade;

create view public.v_announcements
with (security_invoker = true)
as
select a.id,
       a.group_id,
       a.author_id,
       a.author_name,
       a.author_role,
       public.announcement_author_avatar(a.author_id) as author_avatar_url,
       a.title,
       a.description,
       a.attachments,
       a.created_at,
       a.announcement_type,
       a.release_version
from public.announcements a
where a.deleted_at is null;

revoke all on public.v_announcements from public, anon;
grant select on public.v_announcements to authenticated;

grant select on public.feature_requests to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_036', 'feature request workflow and release updates')
on conflict (version) do nothing;

commit;
