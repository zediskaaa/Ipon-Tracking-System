-- Migration 20261113_035: Add announcement reactions with Messenger-style pickers, counts, and user list modal.
begin;

create table if not exists public.announcement_reactions (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction text not null check (reaction in ('👍', '❤️', '😆', '😮', '😢', '😡')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (announcement_id, user_id)
);

create index if not exists announcement_reactions_announcement_idx
  on public.announcement_reactions (announcement_id, reaction);

create index if not exists announcement_reactions_user_idx
  on public.announcement_reactions (user_id);

alter table public.announcement_reactions enable row level security;

drop policy if exists announcement_reactions_select on public.announcement_reactions;
create policy announcement_reactions_select on public.announcement_reactions for select to authenticated
using (
  exists (
    select 1 from public.announcements a
    where a.id = announcement_reactions.announcement_id
      and a.deleted_at is null
      and (
        public.is_super_admin()
        or a.group_id is null
        or a.group_id = public.current_group_id()
      )
  )
);

drop policy if exists mfa_verified_for_opted_in on public.announcement_reactions;
create policy mfa_verified_for_opted_in on public.announcement_reactions as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcement_reactions'
  ) then
    alter publication supabase_realtime add table public.announcement_reactions;
  end if;
end;
$$;

create or replace function public.toggle_announcement_reaction(
  p_announcement_id uuid,
  p_reaction text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing text;
  v_action text;
begin
  if v_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if p_reaction not in ('👍', '❤️', '😆', '😮', '😢', '😡') then
    raise exception 'Invalid reaction emoji.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.announcements a
    where a.id = p_announcement_id
      and a.deleted_at is null
      and (
        public.is_super_admin()
        or a.group_id is null
        or a.group_id = public.current_group_id()
      )
  ) then
    raise exception 'Announcement not found.' using errcode = 'P0002';
  end if;

  select reaction into v_existing
  from public.announcement_reactions
  where announcement_id = p_announcement_id and user_id = v_user_id;

  if v_existing is not null and v_existing = p_reaction then
    delete from public.announcement_reactions
    where announcement_id = p_announcement_id and user_id = v_user_id;
    v_action := 'removed';
  elsif v_existing is not null then
    update public.announcement_reactions
    set reaction = p_reaction, updated_at = now()
    where announcement_id = p_announcement_id and user_id = v_user_id;
    v_action := 'updated';
  else
    insert into public.announcement_reactions (announcement_id, user_id, reaction)
    values (p_announcement_id, v_user_id, p_reaction);
    v_action := 'added';
  end if;

  return jsonb_build_object(
    'action', v_action,
    'reaction', p_reaction,
    'announcement_id', p_announcement_id
  );
end;
$$;

create or replace function public.get_announcement_reactions(p_announcement_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', ar.user_id,
        'reaction', ar.reaction,
        'full_name', p.full_name,
        'role', p.role,
        'avatar_url', p.avatar_url,
        'created_at', ar.created_at
      ) order by ar.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.announcement_reactions ar
  join public.profiles p on p.id = ar.user_id
  where ar.announcement_id = p_announcement_id;

  return v_result;
end;
$$;

revoke all on public.announcement_reactions from public, anon;
grant select on public.announcement_reactions to authenticated;

revoke execute on function public.toggle_announcement_reaction(uuid, text) from public, anon;
grant execute on function public.toggle_announcement_reaction(uuid, text) to authenticated;

revoke execute on function public.get_announcement_reactions(uuid) from public, anon;
grant execute on function public.get_announcement_reactions(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261113_035', 'add announcement reactions')
on conflict (version) do nothing;

commit;
