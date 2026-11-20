begin;

create or replace function public.update_announcement(
  p_announcement_id uuid,
  p_title text default '',
  p_description text default '',
  p_attachments jsonb default null,
  p_release_version text default null
)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_existing public.announcements;
  v_prefix text;
  v_old_paths text[] := '{}'::text[];
  v_item jsonb;
  v_path text;
  v_next_version text;
  v_next_attachments jsonb;
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
    raise exception 'Only the Owner or a Group Administrator can edit announcements.' using errcode = '42501';
  end if;

  select * into v_existing
  from public.announcements
  where id = p_announcement_id
    and deleted_at is null
  for update;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  if v_profile.role <> 'SUPER_ADMIN' then
    if v_existing.author_role <> 'ADMIN' or v_existing.group_id is distinct from v_profile.group_id then
      raise exception 'You can only edit announcements posted in your own group.' using errcode = '42501';
    end if;
  end if;

  if char_length(btrim(coalesce(p_title, ''))) = 0 or char_length(btrim(coalesce(p_description, ''))) = 0 then
    raise exception 'Announcement title and description are required.' using errcode = '22023';
  end if;

  v_next_version := v_existing.release_version;
  if v_existing.announcement_type = 'RELEASE' and p_release_version is not null then
    v_next_version := nullif(btrim(p_release_version), '');
    if v_next_version is null then
      raise exception 'Release version is required for system release updates.' using errcode = '22023';
    end if;
    if lower(v_next_version) <> lower(coalesce(v_existing.release_version, '')) and exists (
      select 1
      from public.announcements
      where id <> v_existing.id
        and deleted_at is null
        and lower(btrim(coalesce(release_version, ''))) = lower(v_next_version)
    ) then
      raise exception 'Release version "%" has already been published. Please use a unique version.', v_next_version using errcode = '23505';
    end if;
  end if;

  v_next_attachments := coalesce(v_existing.attachments, '[]'::jsonb);
  if p_attachments is not null then
    if jsonb_typeof(p_attachments) <> 'array' then
      raise exception 'Announcement attachments must be a JSON array.' using errcode = '22023';
    end if;

    select coalesce(array_agg(elem->>'path'), '{}'::text[])
    into v_old_paths
    from jsonb_array_elements(coalesce(v_existing.attachments, '[]'::jsonb)) elem
    where coalesce(elem->>'path', '') <> '';

    v_prefix := case
      when v_profile.role = 'SUPER_ADMIN' then 'platform/' || v_profile.id::text || '/'
      else 'group/' || v_profile.group_id::text || '/'
    end;

    for v_item in select value from jsonb_array_elements(p_attachments) loop
      v_path := coalesce(v_item->>'path', '');
      if v_path = '' or position('..' in v_path) > 0 then
        raise exception 'Invalid attachment storage path.' using errcode = '42501';
      end if;
      if not (v_path = any(v_old_paths)) and left(v_path, char_length(v_prefix)) <> v_prefix then
        raise exception 'Invalid attachment storage path.' using errcode = '42501';
      end if;
    end loop;

    v_next_attachments := p_attachments;
  end if;

  update public.announcements
  set
    title = btrim(p_title),
    description = btrim(p_description),
    attachments = v_next_attachments,
    release_version = v_next_version
  where id = v_existing.id
  returning * into v_row;

  if v_existing.announcement_type = 'RELEASE'
     and v_existing.release_version is not null
     and v_next_version is not null
     and v_next_version <> v_existing.release_version then
    update public.feature_requests
    set release_version = v_next_version
    where release_version = v_existing.release_version;

    update public.bug_reports
    set release_version = v_next_version
    where release_version = v_existing.release_version;
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_announcement(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.update_announcement(uuid, text, text, jsonb, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261120_139', 'add update_announcement RPC for editing announcements, release versions, and media attachments')
on conflict (version) do nothing;

commit;
