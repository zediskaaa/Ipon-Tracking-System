-- Add announcements for Owner (Super Admin) and Group Admins with unlimited text, media attachments, and realtime sync.

begin;

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null check (char_length(btrim(author_name)) > 0),
  author_role public.app_role not null check (author_role in ('SUPER_ADMIN', 'ADMIN')),
  title text not null check (char_length(btrim(title)) > 0),
  description text not null check (char_length(btrim(description)) > 0),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists announcements_active_created_idx
  on public.announcements (created_at desc)
  where deleted_at is null;

alter table public.announcements enable row level security;

drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
using (
  public.current_user_role() is not null
  and (
    public.is_super_admin()
    or group_id is null
    or group_id = public.current_group_id()
  )
);

drop policy if exists mfa_verified_for_opted_in on public.announcements;
create policy mfa_verified_for_opted_in on public.announcements as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;
end;
$$;

create or replace function public.create_announcement(
  p_id uuid default null,
  p_title text default '',
  p_description text default '',
  p_attachments jsonb default '[]'::jsonb
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
    id, group_id, author_id, author_name, author_role, title, description, attachments
  ) values (
    v_id,
    case when v_profile.role = 'SUPER_ADMIN' then null else v_profile.group_id end,
    v_profile.id,
    v_profile.full_name,
    v_profile.role,
    btrim(p_title),
    btrim(p_description),
    coalesce(p_attachments, '[]'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_announcement(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements;
  v_attachments jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if public.current_user_role() not in ('SUPER_ADMIN', 'ADMIN') then
    raise exception 'Only the Owner or a Group Administrator can delete announcements.' using errcode = '42501';
  end if;

  select * into v_row
  from public.announcements
  where id = p_announcement_id and deleted_at is null;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  if not (public.is_super_admin() or (v_row.author_role = 'ADMIN' and v_row.group_id = public.current_group_id())) then
    raise exception 'You are not allowed to delete this announcement.' using errcode = '42501';
  end if;

  v_attachments := coalesce(v_row.attachments, '[]'::jsonb);

  update public.announcements
  set deleted_at = now(),
      title = '',
      description = '',
      attachments = '[]'::jsonb
  where id = p_announcement_id;

  return v_attachments;
end;
$$;

revoke all on public.announcements from public, anon, authenticated;
grant select on public.announcements to authenticated;

revoke execute on function public.create_announcement(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_announcement(uuid, text, text, jsonb) to authenticated;

revoke execute on function public.delete_announcement(uuid) from public, anon;
grant execute on function public.delete_announcement(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_023', 'add announcements')
on conflict (version) do nothing;

commit;
