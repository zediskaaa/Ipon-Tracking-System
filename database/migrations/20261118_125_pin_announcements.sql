-- Allow Super Admin to pin and highlight important announcements at the top of announcement feeds
begin;

alter table public.announcements
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.profiles(id) on delete set null;

create index if not exists announcements_pinned_created_idx
  on public.announcements (pinned_at desc nulls last, created_at desc)
  where deleted_at is null;

create or replace view public.v_announcements
with (security_invoker = true)
as
select a.id,
       a.group_id,
       a.author_id,
       public.announcement_author_name(a.author_id, a.author_name) as author_name,
       a.author_role,
       public.announcement_author_avatar(a.author_id) as author_avatar_url,
       a.title,
       a.description,
       a.attachments,
       a.created_at,
       a.announcement_type,
       a.release_version,
       public.announcement_author_social_id(a.author_id, a.author_role::text) as author_social_user_id,
       (a.pinned_at is not null) as is_pinned,
       a.pinned_at
from public.announcements a
where a.deleted_at is null;

revoke all on public.v_announcements from public, anon;
grant select on public.v_announcements to authenticated;

create or replace function public.set_announcement_pinned(
  p_announcement_id uuid,
  p_pinned boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.announcements;
  v_pinned boolean := coalesce(p_pinned, true);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if not public.is_super_admin() then
    raise exception 'Only the Super Admin can pin or unpin announcements.' using errcode = '42501';
  end if;

  update public.announcements
  set pinned_at = case when v_pinned then now() else null end,
      pinned_by = case when v_pinned then auth.uid() else null end
  where id = p_announcement_id
    and deleted_at is null
  returning * into v_row;

  if not found then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'is_pinned', (v_row.pinned_at is not null),
    'pinned_at', v_row.pinned_at
  );
end;
$$;

revoke all on function public.set_announcement_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_announcement_pinned(uuid, boolean) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_125', 'pin_announcements')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
