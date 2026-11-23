-- Finish removing Friend Requests and Friends cleanly (forward-only, zero CASCADE).
-- Builds on 20261123_193_remove_chat_system.sql without modifying any prior migration.
-- Pre-removal backup of historical friend_requests (18 rows), friendships (13 rows),
-- SOCIAL_FRIEND_* notifications (31 rows), and profile friend-privacy keys (22 profiles)
-- was captured securely outside the repository prior to executing this migration.

begin;

-- 1. Ensure friend_requests and friendships are removed from Supabase Realtime publication
do $$
declare
  v_tbl text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach v_tbl in array array['friend_requests', 'friendships'] loop
      if exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = v_tbl
      ) then
        execute format('alter publication supabase_realtime drop table public.%I', v_tbl);
      end if;
    end loop;
  end if;
end $$;

-- 2. Explicitly drop all non-internal triggers on friend_requests and friendships
drop trigger if exists friend_requests_updated_at on public.friend_requests;
do $$
declare
  v_trig record;
begin
  for v_trig in
    select c.relname as tbl, t.tgname as name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('friend_requests', 'friendships')
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on public.%I', v_trig.name, v_trig.tbl);
  end loop;
end $$;

-- 3. Explicitly drop all RLS policies and revoke grants on friend_requests and friendships
do $$
declare
  v_tbl text;
  v_pol record;
begin
  foreach v_tbl in array array['friend_requests', 'friendships'] loop
    if to_regclass(format('public.%I', v_tbl)) is not null then
      for v_pol in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = v_tbl
      loop
        execute format('drop policy if exists %I on public.%I', v_pol.policyname, v_tbl);
      end loop;
      execute format('revoke all on table public.%I from public, anon, authenticated', v_tbl);
    end if;
  end loop;
end $$;

-- 4. Explicitly drop non-constraint indexes on friend_requests and friendships (no CASCADE)
drop index if exists public.friend_requests_active_pair_uidx;
drop index if exists public.friend_requests_receiver_idx;
drop index if exists public.friend_requests_sender_idx;
drop index if exists public.friendships_user_a_idx;
drop index if exists public.friendships_user_b_idx;

-- 5. Explicitly drop friend-only functions and RPCs (no CASCADE; safe if already dropped by 193)
drop function if exists public.are_friends(uuid, uuid);
drop function if exists public.send_friend_request(uuid);
drop function if exists public.respond_friend_request(uuid, text);
drop function if exists public.cancel_friend_request(uuid);
drop function if exists public.remove_friend(uuid);
drop function if exists public.get_friend_suggestions(integer);
drop function if exists public.get_mutual_friends_summary(uuid, uuid, integer);
drop function if exists public.get_user_friends_count(uuid, uuid);
drop function if exists public.can_view_social_profile(uuid, uuid, text);
drop function if exists public.get_social_user_profile(uuid);
drop function if exists public.search_social_users(text, integer);
drop function if exists public.update_social_profile_and_privacy(text, text, jsonb);
drop function if exists public.canonical_pair_key(uuid, uuid);

-- 6. Retain zero-table-scan stale-client tombstone on get_social_overview()
-- so already-open web tabs and older installed Android APKs settle cleanly without retry loops.
create or replace function public.get_social_overview()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'me', null,
    'friends', '[]'::jsonb,
    'incoming_requests', '[]'::jsonb,
    'sent_requests', '[]'::jsonb,
    'blocked_users', '[]'::jsonb,
    'chat_disabled', true,
    'friends_disabled', true
  );
$$;

revoke all on function public.get_social_overview() from public;
grant execute on function public.get_social_overview() to authenticated, service_role;

-- 7. Drop friend_requests and friendships tables cleanly without CASCADE
-- PostgreSQL will abort this transaction if any unexpected view, FK, or object still depends on them.
drop table if exists public.friend_requests;
drop table if exists public.friendships;

-- 8. Remove friend-only privacy settings from profiles.chat_privacy and reset default to '{}'
-- Keep the chat_privacy column itself as an empty-default compatibility column so un-updated
-- Android APKs selecting profiles(..., chat_privacy, ...) on boot do not hit HTTP 400.
alter table public.profiles
  alter column chat_privacy set default '{}'::jsonb;

update public.profiles
set chat_privacy = coalesce(chat_privacy, '{}'::jsonb)
  - array['allow_friend_requests', 'profile_visibility', 'allow_message_requests']
where chat_privacy ?| array['allow_friend_requests', 'profile_visibility', 'allow_message_requests'];

comment on column public.profiles.chat_privacy is
  'Deprecated empty-default compatibility column retained solely so un-updated clients selecting chat_privacy on boot do not hit HTTP 400; friend and profile-visibility privacy settings were removed in 20261123_194.';

-- 9. Delete ONLY friend-only historical notifications; preserve all announcements,
-- account alerts, financial/group/badge/effect notifications, and non-friend rows.
delete from public.notifications
where type in ('SOCIAL_FRIEND_REQUEST', 'SOCIAL_FRIEND_ACCEPTED');

insert into public.schema_migrations (version, name)
values ('20261123_194', 'remove_friends_system')
on conflict (version) do nothing;

commit;
