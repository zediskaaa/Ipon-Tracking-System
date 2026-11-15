-- Migration 076: Complete Messaging, Social Connections, File Attachments, Privacy & WebRTC Calls System
begin;

alter table public.profiles
  add column if not exists username text,
  add column if not exists bio text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists chat_privacy jsonb not null default jsonb_build_object(
    'show_online', true,
    'show_last_seen', true,
    'read_receipts', true,
    'allow_friend_requests', 'EVERYONE',
    'allow_message_requests', 'EVERYONE'
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-z0-9_]{3,24}$');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_bio_length_check'
  ) then
    alter table public.profiles
      add constraint profiles_bio_length_check
      check (bio is null or char_length(btrim(bio)) <= 240);
  end if;
end $$;

create unique index if not exists profiles_username_uidx
  on public.profiles (lower(username))
  where username is not null;

create or replace function public.is_messaging_eligible(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = coalesce(p_user_id, auth.uid())
      and p.status = 'ACTIVE'
      and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
  );
$$;

create or replace function public.canonical_pair_key(p_a uuid, p_b uuid)
returns text
language sql
immutable
as $$
  select least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text;
$$;

create table if not exists public.blocked_users (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocked_users_no_self check (blocker_id <> blocked_id),
  constraint blocked_users_unique_pair unique (blocker_id, blocked_id)
);

create index if not exists blocked_users_blocker_idx on public.blocked_users (blocker_id, created_at desc);
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked_id);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  pair_key text generated always as (least(sender_id, receiver_id)::text || ':' || greatest(sender_id, receiver_id)::text) stored,
  status text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint friend_requests_no_self check (sender_id <> receiver_id)
);

create unique index if not exists friend_requests_active_pair_uidx
  on public.friend_requests (pair_key)
  where status = 'PENDING';
create index if not exists friend_requests_receiver_idx on public.friend_requests (receiver_id, status, created_at desc);
create index if not exists friend_requests_sender_idx on public.friend_requests (sender_id, status, created_at desc);

drop trigger if exists friend_requests_updated_at on public.friend_requests;
create trigger friend_requests_updated_at before update on public.friend_requests
  for each row execute function public.set_updated_at();

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint friendships_ordered_pair check (user_a < user_b),
  constraint friendships_unique_pair unique (user_a, user_b)
);

create index if not exists friendships_user_a_idx on public.friendships (user_a);
create index if not exists friendships_user_b_idx on public.friendships (user_b);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'DIRECT' check (kind in ('DIRECT')),
  pair_key text not null unique,
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  initiator_id uuid references public.profiles(id) on delete set null,
  status text not null default 'ACCEPTED' check (status in ('ACCEPTED', 'PENDING_REQUEST', 'DECLINED')),
  accepted_at timestamptz,
  last_message_id uuid,
  last_message_at timestamptz,
  last_message_preview text,
  last_message_sender_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_ordered_pair check (user_a < user_b)
);

create index if not exists conversations_user_a_idx on public.conversations (user_a, last_message_at desc nulls last);
create index if not exists conversations_user_b_idx on public.conversations (user_b, last_message_at desc nulls last);

drop trigger if exists conversations_updated_at on public.conversations;
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  is_pinned boolean not null default false,
  pinned_at timestamptz,
  is_muted boolean not null default false,
  is_archived boolean not null default false,
  marked_unread boolean not null default false,
  deleted_before_at timestamptz,
  hidden_at timestamptz,
  last_read_message_id uuid,
  last_read_at timestamptz,
  chat_theme text not null default 'paper' check (chat_theme in ('paper', 'emerald', 'sage', 'sand', 'midnight')),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id, is_archived, is_pinned);

drop trigger if exists conversation_participants_updated_at on public.conversation_participants;
create trigger conversation_participants_updated_at before update on public.conversation_participants
  for each row execute function public.set_updated_at();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 5000),
  message_type text not null default 'TEXT' check (message_type in ('TEXT', 'MEDIA', 'VOICE', 'FORWARDED', 'CALL_EVENT', 'SYSTEM')),
  reply_to_id uuid references public.messages(id) on delete set null,
  forwarded_from_id uuid references public.messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  edited_at timestamptz,
  deleted_for_everyone_at timestamptz,
  deleted_for_user_ids uuid[] not null default '{}',
  pinned_at timestamptz,
  pinned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists messages_sender_idx
  on public.messages (sender_id, created_at desc);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  bucket_id text not null default 'chat-attachments',
  storage_path text not null,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 240),
  mime_type text not null default 'application/octet-stream',
  file_size bigint not null check (file_size >= 0 and file_size <= 52428800),
  attachment_kind text not null check (attachment_kind in ('image', 'document', 'audio', 'video', 'file')),
  width integer,
  height integer,
  duration_seconds integer,
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_message_idx on public.message_attachments (message_id);
create index if not exists message_attachments_conv_idx on public.message_attachments (conversation_id, created_at desc);

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(btrim(emoji)) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index if not exists message_reactions_message_idx on public.message_reactions (message_id);

create table if not exists public.message_receipts (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id)
);

create index if not exists message_receipts_user_idx on public.message_receipts (user_id, read_at);

create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  call_type text not null check (call_type in ('VOICE', 'VIDEO')),
  status text not null default 'RINGING' check (status in ('RINGING', 'ACCEPTED', 'DECLINED', 'MISSED', 'ENDED', 'FAILED')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  end_reason text,
  constraint call_sessions_no_self check (caller_id <> callee_id)
);

create index if not exists call_sessions_conv_idx on public.call_sessions (conversation_id, started_at desc);
create index if not exists call_sessions_callee_status_idx on public.call_sessions (callee_id, status, started_at desc);
create index if not exists call_sessions_caller_status_idx on public.call_sessions (caller_id, status, started_at desc);

create or replace function public.is_user_blocked_between(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.blocked_users b
    where (b.blocker_id = p_user_a and b.blocked_id = p_user_b)
       or (b.blocker_id = p_user_b and b.blocked_id = p_user_a)
  );
$$;

create or replace function public.are_friends(p_user_a uuid, p_user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.user_a = least(p_user_a, p_user_b)
      and f.user_b = greatest(p_user_a, p_user_b)
  );
$$;

create or replace function public.push_social_notification(
  p_recipient_id uuid,
  p_actor_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_dedupe_key text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient record;
  v_clean_title text := left(btrim(coalesce(p_title, 'Notification')), 120);
  v_clean_msg text := left(btrim(coalesce(p_message, 'Update')), 500);
begin
  if p_recipient_id is null or p_recipient_id = p_actor_id then
    return;
  end if;

  if char_length(v_clean_title) < 2 then v_clean_title := 'Message update'; end if;
  if char_length(v_clean_msg) < 2 then v_clean_msg := 'Open Messages to view this update.'; end if;

  if p_actor_id is not null and not public.is_messaging_eligible(p_actor_id) then
    return;
  end if;

  if p_actor_id is not null and public.is_user_blocked_between(p_recipient_id, p_actor_id) then
    return;
  end if;

  select id, status, role, notifications_enabled into v_recipient
  from public.profiles
  where id = p_recipient_id;

  if v_recipient.id is null
     or v_recipient.status <> 'ACTIVE'
     or v_recipient.role not in ('ADMIN', 'TREASURER', 'MEMBER')
     or coalesce(v_recipient.notifications_enabled, true) is not true then
    return;
  end if;

  if p_dedupe_key is not null and btrim(p_dedupe_key) <> '' then
    insert into public.notifications (recipient_id, group_id, type, title, message, link, dedupe_key)
    values (p_recipient_id, null, p_type, v_clean_title, v_clean_msg, nullif(btrim(p_link), ''), btrim(p_dedupe_key))
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null
    do update set
      type = excluded.type,
      title = excluded.title,
      message = excluded.message,
      link = excluded.link,
      read_at = null,
      created_at = now();
  else
    insert into public.notifications (recipient_id, group_id, type, title, message, link)
    values (p_recipient_id, null, p_type, v_clean_title, v_clean_msg, nullif(btrim(p_link), ''));
  end if;
end;
$$;

-- RLS & Permissions: All tables read-accessible only to eligible non-SUPER_ADMIN participants; writes via RPCs.
alter table public.blocked_users enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.message_receipts enable row level security;
alter table public.call_sessions enable row level security;

revoke all on
  public.blocked_users,
  public.friend_requests,
  public.friendships,
  public.conversations,
  public.conversation_participants,
  public.messages,
  public.message_attachments,
  public.message_reactions,
  public.message_receipts,
  public.call_sessions
from authenticated, anon, public;

grant select on
  public.blocked_users,
  public.friend_requests,
  public.friendships,
  public.conversations,
  public.conversation_participants,
  public.messages,
  public.message_attachments,
  public.message_reactions,
  public.message_receipts,
  public.call_sessions
to authenticated;

-- Restrictive MFA policies
drop policy if exists mfa_verified_for_opted_in on public.blocked_users;
create policy mfa_verified_for_opted_in on public.blocked_users as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.friend_requests;
create policy mfa_verified_for_opted_in on public.friend_requests as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.friendships;
create policy mfa_verified_for_opted_in on public.friendships as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.conversations;
create policy mfa_verified_for_opted_in on public.conversations as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.conversation_participants;
create policy mfa_verified_for_opted_in on public.conversation_participants as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.messages;
create policy mfa_verified_for_opted_in on public.messages as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.message_attachments;
create policy mfa_verified_for_opted_in on public.message_attachments as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.message_reactions;
create policy mfa_verified_for_opted_in on public.message_reactions as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.message_receipts;
create policy mfa_verified_for_opted_in on public.message_receipts as restrictive to authenticated using (public.mfa_access_allowed());

drop policy if exists mfa_verified_for_opted_in on public.call_sessions;
create policy mfa_verified_for_opted_in on public.call_sessions as restrictive to authenticated using (public.mfa_access_allowed());

-- Restrictive SUPER_ADMIN exclusion policies across all social tables
drop policy if exists social_exclude_super_admin on public.blocked_users;
create policy social_exclude_super_admin on public.blocked_users as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.friend_requests;
create policy social_exclude_super_admin on public.friend_requests as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.friendships;
create policy social_exclude_super_admin on public.friendships as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.conversations;
create policy social_exclude_super_admin on public.conversations as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.conversation_participants;
create policy social_exclude_super_admin on public.conversation_participants as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.messages;
create policy social_exclude_super_admin on public.messages as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.message_attachments;
create policy social_exclude_super_admin on public.message_attachments as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.message_reactions;
create policy social_exclude_super_admin on public.message_reactions as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.message_receipts;
create policy social_exclude_super_admin on public.message_receipts as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

drop policy if exists social_exclude_super_admin on public.call_sessions;
create policy social_exclude_super_admin on public.call_sessions as restrictive to authenticated using (public.is_messaging_eligible(auth.uid()));

-- SELECT policies
drop policy if exists blocked_users_select on public.blocked_users;
create policy blocked_users_select on public.blocked_users for select to authenticated
using (blocker_id = auth.uid());

drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests for select to authenticated
using (
  (sender_id = auth.uid() or receiver_id = auth.uid())
  and not public.is_user_blocked_between(sender_id, receiver_id)
);

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
using (
  (user_a = auth.uid() or user_b = auth.uid())
  and not public.is_user_blocked_between(user_a, user_b)
);

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
using (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists conversation_participants_select on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants for select to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
using (
  not (auth.uid() = any(deleted_for_user_ids))
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments for select to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = message_id
      and not (auth.uid() = any(m.deleted_for_user_ids))
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

drop policy if exists message_receipts_select on public.message_receipts;
create policy message_receipts_select on public.message_receipts for select to authenticated
using (
  exists (
    select 1
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
    where m.id = message_id
      and (c.user_a = auth.uid() or c.user_b = auth.uid())
  )
);

drop policy if exists call_sessions_select on public.call_sessions;
create policy call_sessions_select on public.call_sessions for select to authenticated
using (caller_id = auth.uid() or callee_id = auth.uid());

-- Helper to ensure active non-SUPER_ADMIN caller
create or replace function public.require_messaging_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.mfa_access_allowed() then
    raise exception 'Sign in and complete security verification first.' using errcode = '42501';
  end if;
  if not public.is_messaging_eligible(v_uid) then
    raise exception 'Messaging is only available to active group members, treasurers, and administrators.' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Touch own last seen (respects privacy on read side)
create or replace function public.touch_user_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_messaging_eligible(v_uid) then
    return;
  end if;
  update public.profiles
  set last_seen_at = now()
  where id = v_uid;
end;
$$;

-- Update own username, bio & chat privacy preferences
create or replace function public.update_social_profile_and_privacy(
  p_username text default null,
  p_bio text default null,
  p_chat_privacy jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_username text := nullif(lower(btrim(coalesce(p_username, ''))), '');
  v_bio text := nullif(btrim(coalesce(p_bio, '')), '');
  v_existing jsonb;
  v_next jsonb;
  v_friend_req text;
  v_msg_req text;
begin
  if v_username is not null and v_username !~ '^[a-z0-9_]{3,24}$' then
    raise exception 'Username must be 3-24 characters using lowercase letters, numbers, or underscores.' using errcode = '22023';
  end if;

  if v_bio is not null and char_length(v_bio) > 240 then
    raise exception 'Bio must be 240 characters or fewer.' using errcode = '22023';
  end if;

  select coalesce(chat_privacy, '{}'::jsonb) into v_existing
  from public.profiles
  where id = v_uid;

  v_next := v_existing;
  if p_chat_privacy is not null and jsonb_typeof(p_chat_privacy) = 'object' then
    v_friend_req := upper(coalesce(p_chat_privacy ->> 'allow_friend_requests', v_existing ->> 'allow_friend_requests', 'EVERYONE'));
    if v_friend_req not in ('EVERYONE', 'MUTUAL_GROUPS', 'NOBODY') then
      v_friend_req := 'EVERYONE';
    end if;
    v_msg_req := upper(coalesce(p_chat_privacy ->> 'allow_message_requests', v_existing ->> 'allow_message_requests', 'EVERYONE'));
    if v_msg_req not in ('EVERYONE', 'FRIENDS_ONLY') then
      v_msg_req := 'EVERYONE';
    end if;
    v_next := jsonb_build_object(
      'show_online', coalesce((p_chat_privacy ->> 'show_online')::boolean, coalesce((v_existing ->> 'show_online')::boolean, true)),
      'show_last_seen', coalesce((p_chat_privacy ->> 'show_last_seen')::boolean, coalesce((v_existing ->> 'show_last_seen')::boolean, true)),
      'read_receipts', coalesce((p_chat_privacy ->> 'read_receipts')::boolean, coalesce((v_existing ->> 'read_receipts')::boolean, true)),
      'allow_friend_requests', v_friend_req,
      'allow_message_requests', v_msg_req
    );
  end if;

  update public.profiles
  set username = v_username,
      bio = v_bio,
      chat_privacy = v_next,
      updated_at = now()
  where id = v_uid;

  return jsonb_build_object(
    'username', v_username,
    'bio', v_bio,
    'chat_privacy', v_next
  );
exception
  when unique_violation then
    raise exception 'That username is already taken.' using errcode = '23505';
end;
$$;

-- Helper returning relationship status & privacy-respecting social card data for a target user
create or replace function public.get_social_user_profile(p_target_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_target record;
  v_is_friend boolean;
  v_blocked_by_me boolean;
  v_blocked_me boolean;
  v_req record;
  v_shared_groups text[];
  v_mutual_count integer := 0;
  v_conv_id uuid;
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'Select another valid user profile.' using errcode = '22023';
  end if;

  select id, full_name, username, bio, avatar_url, role, status, last_seen_at, chat_privacy
  into v_target
  from public.profiles
  where id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This account is not available for messaging or connections.' using errcode = 'P0002';
  end if;

  v_blocked_by_me := exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = p_target_id);
  v_blocked_me := exists (select 1 from public.blocked_users b where b.blocker_id = p_target_id and b.blocked_id = v_uid);
  v_is_friend := public.are_friends(v_uid, p_target_id);

  select id, sender_id, receiver_id, status into v_req
  from public.friend_requests
  where pair_key = public.canonical_pair_key(v_uid, p_target_id)
    and status = 'PENDING'
  limit 1;

  select coalesce(array_agg(distinct g.name order by g.name), '{}') into v_shared_groups
  from (
    select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
    union
    select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
  ) mine
  join (
    select gm.group_id from public.group_memberships gm where gm.user_id = p_target_id and gm.status = 'ACTIVE'
    union
    select p.group_id from public.profiles p where p.id = p_target_id and p.group_id is not null
  ) theirs on mine.group_id = theirs.group_id
  join public.groups g on g.id = mine.group_id;

  select count(*)::integer into v_mutual_count
  from (
    select case when f.user_a = v_uid then f.user_b else f.user_a end as fid
    from public.friendships f where f.user_a = v_uid or f.user_b = v_uid
  ) myf
  join (
    select case when f.user_a = p_target_id then f.user_b else f.user_a end as fid
    from public.friendships f where f.user_a = p_target_id or f.user_b = p_target_id
  ) theirf on myf.fid = theirf.fid;

  select id into v_conv_id
  from public.conversations
  where pair_key = public.canonical_pair_key(v_uid, p_target_id);

  return jsonb_build_object(
    'id', v_target.id,
    'full_name', v_target.full_name,
    'username', v_target.username,
    'bio', case when v_blocked_me then null else v_target.bio end,
    'avatar_url', v_target.avatar_url,
    'friendship_status', case
      when v_blocked_by_me then 'BLOCKED_BY_ME'
      when v_blocked_me then 'BLOCKED_ME'
      when v_is_friend then 'FRIENDS'
      when v_req.id is not null and v_req.sender_id = v_uid then 'OUTGOING_REQUEST'
      when v_req.id is not null and v_req.receiver_id = v_uid then 'INCOMING_REQUEST'
      else 'NONE'
    end,
    'friend_request_id', v_req.id,
    'can_message', (not v_blocked_by_me and not v_blocked_me and (v_is_friend or coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY')),
    'can_send_friend_request', (
      not v_blocked_by_me and not v_blocked_me and not v_is_friend and v_req.id is null
      and coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'NOBODY'
      and (
        coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'MUTUAL_GROUPS'
        or coalesce(array_length(v_shared_groups, 1), 0) > 0
      )
    ),
    'allow_online_status', (not v_blocked_me and not v_blocked_by_me and coalesce((v_target.chat_privacy ->> 'show_online')::boolean, true)),
    'last_seen_at', case
      when not v_blocked_me and not v_blocked_by_me
           and coalesce((v_target.chat_privacy ->> 'show_online')::boolean, true)
           and coalesce((v_target.chat_privacy ->> 'show_last_seen')::boolean, true)
      then v_target.last_seen_at
      else null
    end,
    'shared_groups', coalesce(v_shared_groups, '{}'),
    'mutual_friends_count', coalesce(v_mutual_count, 0),
    'conversation_id', v_conv_id
  );
end;
$$;

-- User search (excludes self, SUPER_ADMIN, inactive accounts, and blocked pairs)
create or replace function public.search_social_users(
  p_query text default '',
  p_limit integer default 24
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_lim integer := greatest(1, least(coalesce(p_limit, 24), 50));
begin
  return (
    with my_groups as (
      select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
      union
      select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
    ),
    my_friends as (
      select case when f.user_a = v_uid then f.user_b else f.user_a end as fid
      from public.friendships f where f.user_a = v_uid or f.user_b = v_uid
    ),
    candidates as (
      select
        p.id,
        p.full_name,
        p.username,
        p.bio,
        p.avatar_url,
        p.last_seen_at,
        p.chat_privacy,
        exists (select 1 from my_friends mf where mf.fid = p.id) as is_friend,
        (
          select fr.id
          from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id) and fr.status = 'PENDING'
          limit 1
        ) as pending_request_id,
        (
          select fr.sender_id
          from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id) and fr.status = 'PENDING'
          limit 1
        ) as pending_sender_id,
        (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) as shared_groups,
        (
          select count(*)::integer
          from my_friends mf
          join public.friendships f2
            on f2.user_a = least(mf.fid, p.id) and f2.user_b = greatest(mf.fid, p.id)
        ) as mutual_friends_count
      from public.profiles p
      where p.id <> v_uid
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
        and (
          v_q = ''
          or lower(p.full_name) like '%' || v_q || '%'
          or lower(coalesce(p.username, '')) like '%' || replace(v_q, '@', '') || '%'
          or lower(coalesce(p.bio, '')) like '%' || v_q || '%'
        )
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'username', c.username,
        'bio', c.bio,
        'avatar_url', c.avatar_url,
        'friendship_status', case
          when c.is_friend then 'FRIENDS'
          when c.pending_request_id is not null and c.pending_sender_id = v_uid then 'OUTGOING_REQUEST'
          when c.pending_request_id is not null then 'INCOMING_REQUEST'
          else 'NONE'
        end,
        'friend_request_id', c.pending_request_id,
        'shared_groups', c.shared_groups,
        'mutual_friends_count', c.mutual_friends_count,
        'can_message', (c.is_friend or coalesce(c.chat_privacy ->> 'allow_message_requests', 'EVERYONE') <> 'FRIENDS_ONLY'),
        'allow_online_status', coalesce((c.chat_privacy ->> 'show_online')::boolean, true),
        'last_seen_at', case
          when coalesce((c.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((c.chat_privacy ->> 'show_last_seen')::boolean, true)
          then c.last_seen_at
          else null
        end
      )
      order by
        c.is_friend desc,
        coalesce(array_length(c.shared_groups, 1), 0) desc,
        c.mutual_friends_count desc,
        c.full_name asc
    ), '[]'::jsonb)
    from (select * from candidates limit v_lim) c
  );
end;
$$;

-- Friend Suggestions (excludes self, SUPER_ADMIN, blocked, friends, pending requests, privacy opt-out)
create or replace function public.get_friend_suggestions(p_limit integer default 16)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_lim integer := greatest(1, least(coalesce(p_limit, 16), 40));
begin
  return (
    with my_groups as (
      select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
      union
      select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
    ),
    my_friends as (
      select case when f.user_a = v_uid then f.user_b else f.user_a end as fid
      from public.friendships f where f.user_a = v_uid or f.user_b = v_uid
    ),
    suggestions as (
      select
        p.id,
        p.full_name,
        p.username,
        p.bio,
        p.avatar_url,
        p.chat_privacy,
        p.last_seen_at,
        (
          select coalesce(array_agg(distinct g.name order by g.name), '{}')
          from (
            select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p.id and gm2.status = 'ACTIVE'
            union
            select p.group_id where p.group_id is not null
          ) tg
          join my_groups mg on mg.group_id = tg.group_id
          join public.groups g on g.id = tg.group_id
        ) as shared_groups,
        (
          select count(*)::integer
          from my_friends mf
          join public.friendships f2
            on f2.user_a = least(mf.fid, p.id) and f2.user_b = greatest(mf.fid, p.id)
        ) as mutual_friends_count
      from public.profiles p
      where p.id <> v_uid
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
        and not public.are_friends(v_uid, p.id)
        and not exists (
          select 1 from public.friend_requests fr
          where fr.pair_key = public.canonical_pair_key(v_uid, p.id)
            and fr.status = 'PENDING'
        )
        and coalesce(p.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'NOBODY'
    )
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'full_name', s.full_name,
        'username', s.username,
        'bio', s.bio,
        'avatar_url', s.avatar_url,
        'shared_groups', s.shared_groups,
        'mutual_friends_count', s.mutual_friends_count,
        'allow_online_status', coalesce((s.chat_privacy ->> 'show_online')::boolean, true),
        'last_seen_at', case
          when coalesce((s.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((s.chat_privacy ->> 'show_last_seen')::boolean, true)
          then s.last_seen_at
          else null
        end,
        'suggestion_reason', case
          when s.mutual_friends_count > 0 and coalesce(array_length(s.shared_groups, 1), 0) > 0
            then s.mutual_friends_count::text || ' mutual friend(s) · Shared group: ' || s.shared_groups[1]
          when coalesce(array_length(s.shared_groups, 1), 0) > 0
            then 'Same group: ' || s.shared_groups[1]
          when s.mutual_friends_count > 0
            then s.mutual_friends_count::text || ' mutual friend(s)'
          else 'Eligible community member'
        end
      )
      order by
        coalesce(array_length(s.shared_groups, 1), 0) desc,
        s.mutual_friends_count desc,
        s.full_name asc
    ), '[]'::jsonb)
    from (
      select * from suggestions
      where coalesce(chat_privacy ->> 'allow_friend_requests', 'EVERYONE') <> 'MUTUAL_GROUPS'
         or coalesce(array_length(shared_groups, 1), 0) > 0
      limit v_lim
    ) s
  );
end;
$$;

-- Friend Request & Blocking Actions
create or replace function public.send_friend_request(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_sender_name text;
  v_target record;
  v_shared boolean;
  v_reverse public.friend_requests%rowtype;
  v_new_id uuid;
  v_pair text;
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'You cannot send a friend request to yourself.' using errcode = '22023';
  end if;

  select full_name into v_sender_name from public.profiles where id = v_uid;
  select id, full_name, role, status, chat_privacy into v_target
  from public.profiles where id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This account cannot receive friend requests.' using errcode = '42501';
  end if;

  if public.is_user_blocked_between(v_uid, p_target_id) then
    raise exception 'Unable to send a friend request because one of you has blocked the other.' using errcode = '42501';
  end if;

  if public.are_friends(v_uid, p_target_id) then
    return jsonb_build_object('status', 'ALREADY_FRIENDS');
  end if;

  if coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') = 'NOBODY' then
    raise exception 'This user is not accepting friend requests.' using errcode = '42501';
  end if;

  if coalesce(v_target.chat_privacy ->> 'allow_friend_requests', 'EVERYONE') = 'MUTUAL_GROUPS' then
    select exists (
      select 1
      from (
        select gm.group_id from public.group_memberships gm where gm.user_id = v_uid and gm.status = 'ACTIVE'
        union
        select p.group_id from public.profiles p where p.id = v_uid and p.group_id is not null
      ) a
      join (
        select gm2.group_id from public.group_memberships gm2 where gm2.user_id = p_target_id and gm2.status = 'ACTIVE'
        union
        select p2.group_id from public.profiles p2 where p2.id = p_target_id and p2.group_id is not null
      ) b on a.group_id = b.group_id
    ) into v_shared;
    if not v_shared then
      raise exception 'This user only accepts friend requests from members in a shared group.' using errcode = '42501';
    end if;
  end if;

  v_pair := public.canonical_pair_key(v_uid, p_target_id);
  select * into v_reverse
  from public.friend_requests
  where pair_key = v_pair and status = 'PENDING'
  limit 1;

  if v_reverse.id is not null then
    if v_reverse.sender_id = v_uid then
      return jsonb_build_object('id', v_reverse.id, 'status', 'PENDING');
    end if;
    -- Mutual request: accept reverse request automatically
    update public.friend_requests
    set status = 'ACCEPTED', responded_at = now()
    where id = v_reverse.id;

    insert into public.friendships (user_a, user_b)
    values (least(v_uid, p_target_id), greatest(v_uid, p_target_id))
    on conflict (user_a, user_b) do nothing;

    update public.conversations
    set status = 'ACCEPTED', accepted_at = coalesce(accepted_at, now())
    where pair_key = v_pair and status = 'PENDING_REQUEST';

    perform public.push_social_notification(
      p_target_id,
      v_uid,
      'SOCIAL_FRIEND_ACCEPTED',
      'Friend request accepted',
      coalesce(v_sender_name, 'Someone') || ' accepted your friend request.',
      'dashboard.html?messages=friends',
      'SOCIAL_FRIEND_ACCEPTED:' || v_reverse.id::text
    );

    return jsonb_build_object('id', v_reverse.id, 'status', 'ACCEPTED', 'auto_accepted', true);
  end if;

  insert into public.friend_requests (sender_id, receiver_id, status)
  values (v_uid, p_target_id, 'PENDING')
  returning id into v_new_id;

  perform public.push_social_notification(
    p_target_id,
    v_uid,
    'SOCIAL_FRIEND_REQUEST',
    'New friend request',
    coalesce(v_sender_name, 'Someone') || ' sent you a friend request.',
    'dashboard.html?messages=requests',
    'SOCIAL_FRIEND_REQ:' || v_pair
  );

  return jsonb_build_object('id', v_new_id, 'status', 'PENDING');
end;
$$;

create or replace function public.respond_friend_request(
  p_request_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_dec text := upper(btrim(coalesce(p_decision, '')));
  v_req public.friend_requests%rowtype;
  v_my_name text;
begin
  if v_dec not in ('ACCEPT', 'DECLINE') then
    raise exception 'Decision must be ACCEPT or DECLINE.' using errcode = '22023';
  end if;

  select * into v_req
  from public.friend_requests
  where id = p_request_id
  for update;

  if v_req.id is null or v_req.receiver_id <> v_uid or v_req.status <> 'PENDING' then
    raise exception 'Friend request is no longer pending.' using errcode = 'P0002';
  end if;

  if not public.is_messaging_eligible(v_req.sender_id) or public.is_user_blocked_between(v_uid, v_req.sender_id) then
    update public.friend_requests set status = 'DECLINED', responded_at = now() where id = v_req.id;
    raise exception 'This user is no longer available.' using errcode = '42501';
  end if;

  update public.friend_requests
  set status = case when v_dec = 'ACCEPT' then 'ACCEPTED' else 'DECLINED' end,
      responded_at = now()
  where id = v_req.id;

  if v_dec = 'ACCEPT' then
    insert into public.friendships (user_a, user_b)
    values (least(v_req.sender_id, v_req.receiver_id), greatest(v_req.sender_id, v_req.receiver_id))
    on conflict (user_a, user_b) do nothing;

    update public.conversations
    set status = 'ACCEPTED', accepted_at = coalesce(accepted_at, now())
    where pair_key = public.canonical_pair_key(v_req.sender_id, v_req.receiver_id)
      and status = 'PENDING_REQUEST';

    select full_name into v_my_name from public.profiles where id = v_uid;
    perform public.push_social_notification(
      v_req.sender_id,
      v_uid,
      'SOCIAL_FRIEND_ACCEPTED',
      'Friend request accepted',
      coalesce(v_my_name, 'Someone') || ' accepted your friend request.',
      'dashboard.html?messages=friends',
      'SOCIAL_FRIEND_ACCEPTED:' || v_req.id::text
    );
  end if;

  return jsonb_build_object('id', v_req.id, 'status', case when v_dec = 'ACCEPT' then 'ACCEPTED' else 'DECLINED' end);
end;
$$;

create or replace function public.cancel_friend_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_req public.friend_requests%rowtype;
begin
  select * into v_req from public.friend_requests where id = p_request_id for update;
  if v_req.id is null or v_req.sender_id <> v_uid or v_req.status <> 'PENDING' then
    raise exception 'Sent friend request is no longer pending.' using errcode = 'P0002';
  end if;
  update public.friend_requests set status = 'CANCELLED', responded_at = now() where id = v_req.id;
  return jsonb_build_object('id', v_req.id, 'status', 'CANCELLED');
end;
$$;

create or replace function public.remove_friend(p_friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
begin
  delete from public.friendships
  where user_a = least(v_uid, p_friend_id)
    and user_b = greatest(v_uid, p_friend_id);
  return jsonb_build_object('removed', true, 'user_id', p_friend_id);
end;
$$;

create or replace function public.block_social_user(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_target_role public.app_role;
  v_pair text := public.canonical_pair_key(v_uid, p_target_id);
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'You cannot block yourself.' using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_target_id;
  if v_target_role is null or v_target_role = 'SUPER_ADMIN' then
    raise exception 'Target account cannot be blocked here.' using errcode = '42501';
  end if;

  insert into public.blocked_users (blocker_id, blocked_id)
  values (v_uid, p_target_id)
  on conflict (blocker_id, blocked_id) do nothing;

  delete from public.friendships
  where user_a = least(v_uid, p_target_id)
    and user_b = greatest(v_uid, p_target_id);

  update public.friend_requests
  set status = 'DECLINED', responded_at = now()
  where pair_key = v_pair and status = 'PENDING';

  update public.conversations
  set status = case when status = 'PENDING_REQUEST' then 'DECLINED' else status end
  where pair_key = v_pair;

  update public.call_sessions
  set status = 'ENDED', ended_at = coalesce(ended_at, now()), end_reason = 'BLOCKED'
  where status in ('RINGING', 'ACCEPTED')
    and ((caller_id = v_uid and callee_id = p_target_id) or (caller_id = p_target_id and callee_id = v_uid));

  return jsonb_build_object('blocked', true, 'user_id', p_target_id);
end;
$$;

create or replace function public.unblock_social_user(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
begin
  delete from public.blocked_users
  where blocker_id = v_uid and blocked_id = p_target_id;
  return jsonb_build_object('unblocked', true, 'user_id', p_target_id);
end;
$$;

create or replace function public.get_social_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_me record;
begin
  select id, full_name, username, bio, avatar_url, chat_privacy into v_me
  from public.profiles where id = v_uid;

  return jsonb_build_object(
    'me', jsonb_build_object(
      'id', v_me.id,
      'full_name', v_me.full_name,
      'username', v_me.username,
      'bio', v_me.bio,
      'avatar_url', v_me.avatar_url,
      'chat_privacy', coalesce(v_me.chat_privacy, '{}'::jsonb)
    ),
    'friends', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'full_name', p.full_name,
          'username', p.username,
          'bio', p.bio,
          'avatar_url', p.avatar_url,
          'allow_online_status', coalesce((p.chat_privacy ->> 'show_online')::boolean, true),
          'last_seen_at', case
            when coalesce((p.chat_privacy ->> 'show_online')::boolean, true)
                 and coalesce((p.chat_privacy ->> 'show_last_seen')::boolean, true)
            then p.last_seen_at
            else null
          end,
          'friends_since', f.created_at
        )
        order by p.full_name asc
      )
      from public.friendships f
      join public.profiles p on p.id = case when f.user_a = v_uid then f.user_b else f.user_a end
      where (f.user_a = v_uid or f.user_b = v_uid)
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
    ), '[]'::jsonb),
    'incoming_requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'user_id', p.id,
          'full_name', p.full_name,
          'username', p.username,
          'avatar_url', p.avatar_url,
          'created_at', fr.created_at
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.sender_id
      where fr.receiver_id = v_uid
        and fr.status = 'PENDING'
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
    ), '[]'::jsonb),
    'sent_requests', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', fr.id,
          'user_id', p.id,
          'full_name', p.full_name,
          'username', p.username,
          'avatar_url', p.avatar_url,
          'created_at', fr.created_at
        )
        order by fr.created_at desc
      )
      from public.friend_requests fr
      join public.profiles p on p.id = fr.receiver_id
      where fr.sender_id = v_uid
        and fr.status = 'PENDING'
        and p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, p.id)
    ), '[]'::jsonb),
    'blocked_users', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.blocked_id,
          'full_name', p.full_name,
          'username', p.username,
          'avatar_url', p.avatar_url,
          'blocked_at', b.created_at
        )
        order by b.created_at desc
      )
      from public.blocked_users b
      join public.profiles p on p.id = b.blocked_id
      where b.blocker_id = v_uid
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
    ), '[]'::jsonb)
  );
end;
$$;

-- Direct conversation initiation / opening
create or replace function public.start_or_open_direct_chat(p_target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_a uuid := least(v_uid, p_target_id);
  v_b uuid := greatest(v_uid, p_target_id);
  v_pair text;
  v_target record;
  v_conv public.conversations%rowtype;
  v_is_friend boolean;
  v_next_status text;
begin
  if p_target_id is null or p_target_id = v_uid then
    raise exception 'Select another eligible user to start a conversation.' using errcode = '22023';
  end if;

  select id, full_name, status, role, chat_privacy into v_target
  from public.profiles where id = p_target_id;

  if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'This user is not available for messaging.' using errcode = '42501';
  end if;

  if public.is_user_blocked_between(v_uid, p_target_id) then
    raise exception 'Messaging is unavailable because one of you has blocked the other.' using errcode = '42501';
  end if;

  v_pair := public.canonical_pair_key(v_uid, p_target_id);
  v_is_friend := public.are_friends(v_uid, p_target_id);
  v_next_status := case when v_is_friend then 'ACCEPTED' else 'PENDING_REQUEST' end;

  select * into v_conv from public.conversations where pair_key = v_pair for update;
  if v_conv.id is null then
    if not v_is_friend and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
    end if;

    insert into public.conversations (kind, pair_key, user_a, user_b, initiator_id, status, accepted_at)
    values (
      'DIRECT',
      v_pair,
      v_a,
      v_b,
      v_uid,
      v_next_status,
      case when v_next_status = 'ACCEPTED' then now() else null end
    )
    on conflict (pair_key) do nothing
    returning * into v_conv;

    if v_conv.id is null then
      select * into v_conv from public.conversations where pair_key = v_pair;
    end if;
  elsif v_conv.status = 'PENDING_REQUEST' and v_is_friend then
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  elsif v_conv.status = 'DECLINED' then
    if not v_is_friend and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
    end if;
    update public.conversations
    set status = v_next_status,
        initiator_id = v_uid,
        accepted_at = case when v_next_status = 'ACCEPTED' then now() else null end
    where id = v_conv.id
    returning * into v_conv;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_a), (v_conv.id, v_b)
  on conflict (conversation_id, user_id) do nothing;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false
  where conversation_id = v_conv.id and user_id = v_uid;

  return jsonb_build_object(
    'id', v_conv.id,
    'status', v_conv.status,
    'initiator_id', v_conv.initiator_id
  );
end;
$$;

create or replace function public.can_send_to_conversation(p_conversation_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
begin
  if v_uid is null or not public.mfa_access_allowed() or not public.is_messaging_eligible(v_uid) then
    return false;
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    return false;
  end if;
  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
  if not public.is_messaging_eligible(v_peer_id) or public.is_user_blocked_between(v_uid, v_peer_id) then
    return false;
  end if;
  return true;
end;
$$;

create or replace function public.get_conversation_attachment_paths(
  p_conversation_id uuid,
  p_paths text[]
)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_part public.conversation_participants%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    return '{}';
  end if;
  select * into v_part from public.conversation_participants where conversation_id = p_conversation_id and user_id = v_uid;

  return coalesce((
    select array_agg(distinct ma.storage_path)
    from public.message_attachments ma
    join public.messages m on m.id = ma.message_id
    where ma.conversation_id = p_conversation_id
      and ma.storage_path = any(coalesce(p_paths, '{}'))
      and m.deleted_for_everyone_at is null
      and not (v_uid = any(m.deleted_for_user_ids))
      and (v_part.deleted_before_at is null or m.created_at > v_part.deleted_before_at)
  ), '{}');
end;
$$;

-- Accept, Delete, or Block an incoming message request
create or replace function public.respond_message_request(
  p_conversation_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_dec text := upper(btrim(coalesce(p_decision, '')));
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_my_name text;
begin
  if v_dec not in ('ACCEPT', 'DELETE', 'BLOCK') then
    raise exception 'Decision must be ACCEPT, DELETE, or BLOCK.' using errcode = '22023';
  end if;

  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Message request was not found.' using errcode = 'P0002';
  end if;
  if v_conv.status <> 'PENDING_REQUEST' or v_conv.initiator_id = v_uid then
    raise exception 'Only pending incoming message requests can be handled this way.' using errcode = '42501';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  if v_dec = 'ACCEPT' then
    if not public.is_messaging_eligible(v_peer_id) or public.is_user_blocked_between(v_uid, v_peer_id) then
      raise exception 'This user is no longer available.' using errcode = '42501';
    end if;

    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id;

    update public.conversation_participants
    set is_archived = false, hidden_at = null, marked_unread = false
    where conversation_id = v_conv.id and user_id = v_uid;

    select full_name into v_my_name from public.profiles where id = v_uid;
    perform public.push_social_notification(
      v_peer_id,
      v_uid,
      'SOCIAL_MESSAGE_ACCEPTED',
      'Message request accepted',
      coalesce(v_my_name, 'Someone') || ' accepted your message request.',
      'dashboard.html?chat=' || v_conv.id::text,
      'SOCIAL_MSG_REQ_ACCEPT:' || v_conv.id::text
    );

    return jsonb_build_object('id', v_conv.id, 'status', 'ACCEPTED');
  elsif v_dec = 'BLOCK' then
    perform public.block_social_user(v_peer_id);
    update public.conversation_participants
    set hidden_at = now(), deleted_before_at = now(), marked_unread = false
    where conversation_id = v_conv.id and user_id = v_uid;
    return jsonb_build_object('id', v_conv.id, 'status', 'BLOCKED');
  else
    update public.conversations
    set status = 'DECLINED'
    where id = v_conv.id;
    update public.conversation_participants
    set hidden_at = now(), deleted_before_at = now(), marked_unread = false
    where conversation_id = v_conv.id and user_id = v_uid;
    return jsonb_build_object('id', v_conv.id, 'status', 'DECLINED');
  end if;
end;
$$;

create or replace function public.send_chat_message(
  p_conversation_id uuid,
  p_body text default '',
  p_message_type text default 'TEXT',
  p_reply_to_id uuid default null,
  p_forwarded_from_id uuid default null,
  p_attachments jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_peer record;
  v_sender record;
  v_clean_body text := btrim(coalesce(p_body, ''));
  v_type text := upper(btrim(coalesce(p_message_type, 'TEXT')));
  v_att_count integer := 0;
  v_msg public.messages%rowtype;
  v_att jsonb;
  v_idx integer := 0;
  v_preview text;
  v_peer_part public.conversation_participants%rowtype;
  v_notif_title text;
  v_notif_type text;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  select id, full_name, role, status, chat_privacy into v_peer from public.profiles where id = v_peer_id;
  select id, full_name into v_sender from public.profiles where id = v_uid;

  if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Recipient is unavailable for messaging.' using errcode = '42501';
  end if;

  if public.is_user_blocked_between(v_uid, v_peer_id) then
    raise exception 'Cannot send message because one of you has blocked the other.' using errcode = '42501';
  end if;

  if v_type not in ('TEXT', 'MEDIA', 'VOICE', 'FORWARDED') then
    v_type := 'TEXT';
  end if;

  if p_attachments is null or jsonb_typeof(p_attachments) <> 'array' then
    p_attachments := '[]'::jsonb;
  end if;
  v_att_count := jsonb_array_length(p_attachments);
  if v_att_count > 10 then
    raise exception 'Attach at most 10 files per message.' using errcode = '22023';
  end if;

  if char_length(v_clean_body) = 0 and v_att_count = 0 then
    raise exception 'Enter a message or attach at least one file.' using errcode = '22023';
  end if;
  if char_length(v_clean_body) > 5000 then
    raise exception 'Message must be 5000 characters or fewer.' using errcode = '22023';
  end if;

  if v_conv.status = 'DECLINED' then
    if not public.are_friends(v_uid, v_peer_id)
       and coalesce(v_peer.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
      raise exception 'This user only accepts messages from friends.' using errcode = '42501';
    end if;
    update public.conversations
    set status = case when public.are_friends(v_uid, v_peer_id) then 'ACCEPTED' else 'PENDING_REQUEST' end,
        initiator_id = v_uid,
        accepted_at = case when public.are_friends(v_uid, v_peer_id) then now() else null end
    where id = v_conv.id
    returning * into v_conv;
  elsif v_conv.status = 'PENDING_REQUEST' and v_conv.initiator_id is distinct from v_uid then
    -- Recipient replying directly promotes conversation to accepted main inbox
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  elsif public.are_friends(v_uid, v_peer_id) and v_conv.status = 'PENDING_REQUEST' then
    update public.conversations
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_conv.id
    returning * into v_conv;
  end if;

  if p_reply_to_id is not null then
    if not exists (
      select 1 from public.messages m
      where m.id = p_reply_to_id and m.conversation_id = v_conv.id and m.deleted_for_everyone_at is null
    ) then
      raise exception 'The referenced reply message is unavailable.' using errcode = '22023';
    end if;
  end if;

  if p_forwarded_from_id is not null then
    if not exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where m.id = p_forwarded_from_id
        and m.deleted_for_everyone_at is null
        and (c.user_a = v_uid or c.user_b = v_uid)
        and not (v_uid = any(m.deleted_for_user_ids))
    ) then
      raise exception 'Original forwarded message is unavailable.' using errcode = '42501';
    end if;
    v_type := 'FORWARDED';
  elsif v_att_count > 0 and v_type = 'TEXT' then
    v_type := 'MEDIA';
  end if;

  insert into public.messages (conversation_id, sender_id, body, message_type, reply_to_id, forwarded_from_id, metadata)
  values (v_conv.id, v_uid, v_clean_body, v_type, p_reply_to_id, p_forwarded_from_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_msg;

  for v_att in select value from jsonb_array_elements(p_attachments) loop
    v_idx := v_idx + 1;
    if coalesce(v_att ->> 'path', '') = '' or (v_att ->> 'path') like '%..%' then
      raise exception 'Invalid attachment storage path.' using errcode = '22023';
    end if;
    if (v_att ->> 'path') not like (v_conv.id::text || '/' || v_uid::text || '/%') then
      raise exception 'Attachment ownership check failed.' using errcode = '42501';
    end if;
    insert into public.message_attachments (
      message_id, conversation_id, uploader_id, bucket_id, storage_path,
      file_name, mime_type, file_size, attachment_kind, width, height, duration_seconds
    ) values (
      v_msg.id,
      v_conv.id,
      v_uid,
      'chat-attachments',
      v_att ->> 'path',
      left(coalesce(nullif(btrim(v_att ->> 'name'), ''), 'attachment'), 240),
      left(coalesce(nullif(btrim(v_att ->> 'type'), ''), 'application/octet-stream'), 120),
      greatest(0, least(52428800, coalesce((v_att ->> 'size')::bigint, 0))),
      case when (v_att ->> 'kind') in ('image', 'document', 'audio', 'video', 'file') then (v_att ->> 'kind') else 'file' end,
      nullif((v_att ->> 'width')::integer, 0),
      nullif((v_att ->> 'height')::integer, 0),
      nullif((v_att ->> 'duration_seconds')::integer, 0)
    );
  end loop;

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  values (v_msg.id, v_peer_id, now(), null)
  on conflict (message_id, user_id) do nothing;

  v_preview := case
    when char_length(v_clean_body) > 0 then left(v_clean_body, 140)
    when v_type = 'VOICE' then 'Sent a voice message'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'image' then 'Sent a photo'
    when v_att_count > 1 then 'Sent ' || v_att_count::text || ' attachments'
    else 'Sent an attachment'
  end;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_uid
  where id = v_conv.id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_conv.user_a), (v_conv.id, v_conv.user_b)
  on conflict (conversation_id, user_id) do nothing;

  update public.conversation_participants
  set hidden_at = null,
      marked_unread = false,
      last_read_message_id = v_msg.id,
      last_read_at = now()
  where conversation_id = v_conv.id and user_id = v_uid;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false
  where conversation_id = v_conv.id and user_id = v_peer_id
  returning * into v_peer_part;

  if coalesce(v_peer_part.is_muted, false) is not true then
    if v_conv.status = 'PENDING_REQUEST' then
      v_notif_type := 'SOCIAL_MESSAGE_REQUEST';
      v_notif_title := 'Message request from ' || coalesce(v_sender.full_name, 'User');
      perform public.push_social_notification(
        v_peer_id,
        v_uid,
        v_notif_type,
        v_notif_title,
        v_preview,
        'dashboard.html?messages=requests&chat=' || v_conv.id::text,
        'SOCIAL_MSG_REQ:' || v_conv.id::text
      );
    else
      v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
      v_notif_title := case when p_reply_to_id is not null then 'New reply from ' else 'New message from ' end || coalesce(v_sender.full_name, 'User');
      perform public.push_social_notification(
        v_peer_id,
        v_uid,
        v_notif_type,
        v_notif_title,
        v_preview,
        'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
        'SOCIAL_MSG:' || v_conv.id::text
      );
    end if;
  end if;

  return jsonb_build_object(
    'id', v_msg.id,
    'conversation_id', v_msg.conversation_id,
    'sender_id', v_msg.sender_id,
    'body', v_msg.body,
    'message_type', v_msg.message_type,
    'reply_to_id', v_msg.reply_to_id,
    'forwarded_from_id', v_msg.forwarded_from_id,
    'created_at', v_msg.created_at
  );
end;
$$;

create or replace function public.edit_chat_message(
  p_message_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_msg public.messages%rowtype;
  v_clean text := btrim(coalesce(p_body, ''));
  v_has_att boolean;
begin
  select * into v_msg from public.messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.sender_id <> v_uid or v_msg.deleted_for_everyone_at is not null then
    raise exception 'You can only edit your own active messages.' using errcode = '42501';
  end if;
  if v_msg.message_type in ('CALL_EVENT', 'SYSTEM') then
    raise exception 'System events cannot be edited.' using errcode = '42501';
  end if;

  v_has_att := exists (select 1 from public.message_attachments ma where ma.message_id = v_msg.id);
  if char_length(v_clean) = 0 and not v_has_att then
    raise exception 'Message cannot be empty.' using errcode = '22023';
  end if;
  if char_length(v_clean) > 5000 then
    raise exception 'Message must be 5000 characters or fewer.' using errcode = '22023';
  end if;

  update public.messages
  set body = v_clean, edited_at = now()
  where id = v_msg.id;

  update public.conversations
  set last_message_preview = case when char_length(v_clean) > 0 then left(v_clean, 140) else 'Sent an attachment' end
  where id = v_msg.conversation_id and last_message_id = v_msg.id;

  return jsonb_build_object('id', v_msg.id, 'body', v_clean, 'edited_at', now());
end;
$$;

create or replace function public.delete_chat_message(
  p_message_id uuid,
  p_mode text default 'FOR_ME'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_mode text := upper(btrim(coalesce(p_mode, 'FOR_ME')));
  v_msg public.messages%rowtype;
  v_conv public.conversations%rowtype;
  v_paths text[] := '{}';
begin
  if v_mode not in ('FOR_ME', 'FOR_EVERYONE') then
    raise exception 'Deletion mode must be FOR_ME or FOR_EVERYONE.' using errcode = '22023';
  end if;

  select * into v_msg from public.messages where id = p_message_id for update;
  if v_msg.id is null then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation access denied.' using errcode = '42501';
  end if;

  if v_mode = 'FOR_EVERYONE' then
    if v_msg.sender_id <> v_uid then
      raise exception 'Only the sender can unsend a message for everyone.' using errcode = '42501';
    end if;

    select coalesce(array_agg(storage_path), '{}') into v_paths
    from public.message_attachments
    where message_id = v_msg.id;

    delete from public.message_attachments where message_id = v_msg.id;
    delete from public.message_reactions where message_id = v_msg.id;

    update public.messages
    set body = '',
        deleted_for_everyone_at = now(),
        pinned_at = null,
        pinned_by = null
    where id = v_msg.id;

    update public.conversations
    set last_message_preview = 'Message removed'
    where id = v_msg.conversation_id and last_message_id = v_msg.id;
  else
    update public.messages
    set deleted_for_user_ids = array(select distinct unnest(deleted_for_user_ids || array[v_uid]))
    where id = v_msg.id;
  end if;

  return jsonb_build_object('id', v_msg.id, 'mode', v_mode, 'removed_paths', v_paths);
end;
$$;

create or replace function public.toggle_message_reaction(
  p_message_id uuid,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_emoji text := btrim(coalesce(p_emoji, ''));
  v_msg public.messages%rowtype;
  v_conv public.conversations%rowtype;
  v_existing text;
begin
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 16 then
    raise exception 'Choose a valid reaction emoji.' using errcode = '22023';
  end if;

  select * into v_msg from public.messages where id = p_message_id;
  if v_msg.id is null or v_msg.deleted_for_everyone_at is not null or v_uid = any(v_msg.deleted_for_user_ids) then
    raise exception 'Message cannot be reacted to.' using errcode = 'P0002';
  end if;

  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Access denied.' using errcode = '42501';
  end if;

  select emoji into v_existing from public.message_reactions
  where message_id = v_msg.id and user_id = v_uid;

  if v_existing = v_emoji then
    delete from public.message_reactions where message_id = v_msg.id and user_id = v_uid;
    return jsonb_build_object('message_id', v_msg.id, 'emoji', null, 'action', 'REMOVED');
  else
    insert into public.message_reactions (message_id, user_id, emoji)
    values (v_msg.id, v_uid, v_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
    return jsonb_build_object('message_id', v_msg.id, 'emoji', v_emoji, 'action', 'SET');
  end if;
end;
$$;

create or replace function public.pin_chat_message(p_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_msg public.messages%rowtype;
  v_conv public.conversations%rowtype;
  v_pinned timestamptz;
begin
  select * into v_msg from public.messages where id = p_message_id for update;
  if v_msg.id is null or v_msg.deleted_for_everyone_at is not null then
    raise exception 'Message unavailable.' using errcode = 'P0002';
  end if;
  select * into v_conv from public.conversations where id = v_msg.conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) or v_conv.status <> 'ACCEPTED' then
    raise exception 'Accept the conversation before pinning messages.' using errcode = '42501';
  end if;

  v_pinned := case when v_msg.pinned_at is null then now() else null end;
  update public.messages
  set pinned_at = v_pinned,
      pinned_by = case when v_pinned is not null then v_uid else null end
  where id = v_msg.id;

  return jsonb_build_object('id', v_msg.id, 'pinned_at', v_pinned);
end;
$$;

create or replace function public.mark_conversation_read(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
  v_peer_privacy jsonb;
  v_latest_id uuid;
  v_allow_receipts boolean := false;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;

  select chat_privacy into v_me_privacy from public.profiles where id = v_uid;
  select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;

  select id into v_latest_id
  from public.messages
  where conversation_id = v_conv.id
  order by created_at desc
  limit 1;

  update public.conversation_participants
  set marked_unread = false,
      last_read_at = now(),
      last_read_message_id = coalesce(v_latest_id, last_read_message_id)
  where conversation_id = v_conv.id and user_id = v_uid;

  -- Strictly NEVER write read_at if conversation is PENDING_REQUEST or either party disabled read receipts
  v_allow_receipts := v_conv.status = 'ACCEPTED'
    and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
    and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);

  if v_allow_receipts then
    update public.message_receipts mr
    set read_at = coalesce(read_at, now())
    from public.messages m
    where mr.message_id = m.id
      and m.conversation_id = v_conv.id
      and mr.user_id = v_uid
      and mr.read_at is null;
  end if;

  -- Also clear corresponding inbox notifications for this conversation
  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and read_at is null
    and type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_ACCEPTED', 'SOCIAL_MESSAGE_REQUEST')
    and (link like '%' || v_conv.id::text || '%' or dedupe_key like '%' || v_conv.id::text || '%');

  return jsonb_build_object('read_at', now(), 'receipts_shared', v_allow_receipts);
end;
$$;

create or replace function public.update_conversation_member_state(
  p_conversation_id uuid,
  p_action text,
  p_theme text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_act text := lower(btrim(coalesce(p_action, '')));
  v_conv public.conversations%rowtype;
  v_part public.conversation_participants%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_uid)
  on conflict (conversation_id, user_id) do nothing;

  select * into v_part from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid for update;

  if v_act = 'pin' then
    update public.conversation_participants set is_pinned = true, pinned_at = now() where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'unpin' then
    update public.conversation_participants set is_pinned = false, pinned_at = null where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'mute' then
    update public.conversation_participants set is_muted = true where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'unmute' then
    update public.conversation_participants set is_muted = false where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'archive' then
    update public.conversation_participants set is_archived = true, is_pinned = false, pinned_at = null where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'unarchive' then
    update public.conversation_participants set is_archived = false where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'mark_unread' then
    update public.conversation_participants set marked_unread = true where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'mark_read' then
    return public.mark_conversation_read(v_conv.id);
  elsif v_act = 'delete_for_me' then
    update public.conversation_participants
    set deleted_before_at = now(),
        hidden_at = now(),
        is_pinned = false,
        pinned_at = null,
        is_archived = false,
        marked_unread = false
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'theme' then
    if coalesce(p_theme, 'paper') not in ('paper', 'emerald', 'sage', 'sand', 'midnight') then
      raise exception 'Unsupported chat theme.' using errcode = '22023';
    end if;
    update public.conversation_participants set chat_theme = p_theme where conversation_id = v_conv.id and user_id = v_uid;
  else
    raise exception 'Unknown conversation action.' using errcode = '22023';
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv.id, 'action', v_act);
end;
$$;

-- Conversation list for inbox, archived, and message requests
create or replace function public.get_conversations()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'status', c.status,
        'initiator_id', c.initiator_id,
        'is_incoming_request', (c.status = 'PENDING_REQUEST' and c.initiator_id is distinct from v_uid),
        'is_outgoing_request', (c.status = 'PENDING_REQUEST' and c.initiator_id = v_uid),
        'peer', jsonb_build_object(
          'id', peer.id,
          'full_name', peer.full_name,
          'username', peer.username,
          'avatar_url', peer.avatar_url,
          'is_friend', public.are_friends(v_uid, peer.id),
          'is_blocked', public.is_user_blocked_between(v_uid, peer.id),
          'blocked_by_me', exists (select 1 from public.blocked_users b where b.blocker_id = v_uid and b.blocked_id = peer.id),
          'allow_online_status', (not public.is_user_blocked_between(v_uid, peer.id) and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true)),
          'last_seen_at', case
            when not public.is_user_blocked_between(v_uid, peer.id)
                 and coalesce((peer.chat_privacy ->> 'show_online')::boolean, true)
                 and coalesce((peer.chat_privacy ->> 'show_last_seen')::boolean, true)
            then peer.last_seen_at
            else null
          end
        ),
        'is_pinned', coalesce(cp.is_pinned, false),
        'pinned_at', cp.pinned_at,
        'is_muted', coalesce(cp.is_muted, false),
        'is_archived', coalesce(cp.is_archived, false),
        'marked_unread', coalesce(cp.marked_unread, false),
        'chat_theme', coalesce(cp.chat_theme, 'paper'),
        'last_message_at', coalesce(latest.created_at, c.last_message_at, c.created_at),
        'last_message_preview', coalesce(
          case
            when latest.id is null then null
            when latest.deleted_for_everyone_at is not null then 'Message removed'
            when char_length(btrim(latest.body)) > 0 then left(latest.body, 140)
            when latest.message_type = 'VOICE' then 'Sent a voice message'
            when latest.message_type = 'CALL_EVENT' then coalesce(latest.metadata ->> 'summary', 'Call activity')
            else 'Sent an attachment'
          end,
          'Start a conversation'
        ),
        'last_message_sender_id', coalesce(latest.sender_id, c.last_message_sender_id),
        'unread_count', (
          select count(*)::integer
          from public.messages um
          where um.conversation_id = c.id
            and um.sender_id <> v_uid
            and um.deleted_for_everyone_at is null
            and not (v_uid = any(um.deleted_for_user_ids))
            and (cp.deleted_before_at is null or um.created_at > cp.deleted_before_at)
            and (cp.last_read_at is null or um.created_at > cp.last_read_at)
        )
      )
      order by
        coalesce(cp.is_pinned, false) desc,
        cp.pinned_at desc nulls last,
        coalesce(latest.created_at, c.last_message_at, c.created_at) desc
    )
    from public.conversations c
    join public.profiles peer on peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
    left join lateral (
      select m.*
      from public.messages m
      where m.conversation_id = c.id
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
      order by m.created_at desc
      limit 1
    ) latest on true
    where (c.user_a = v_uid or c.user_b = v_uid)
      and peer.role in ('ADMIN', 'TREASURER', 'MEMBER')
      and peer.status = 'ACTIVE'
      and cp.hidden_at is null
      and c.status <> 'DECLINED'
      and (latest.id is not null or c.status = 'ACCEPTED')
  ), '[]'::jsonb);
end;
$$;

-- Messages loader for an open thread (supports pagination & reply/search jump)
create or replace function public.get_conversation_messages(
  p_conversation_id uuid,
  p_before timestamptz default null,
  p_limit integer default 60,
  p_around_message_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_me_privacy jsonb;
  v_peer_privacy jsonb;
  v_part public.conversation_participants%rowtype;
  v_lim integer := greatest(10, least(coalesce(p_limit, 60), 120));
  v_share_receipts boolean := false;
  v_anchor timestamptz;
  v_unread_first_id uuid;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
  if not public.is_messaging_eligible(v_peer_id) then
    raise exception 'This user is unavailable.' using errcode = '42501';
  end if;

  select chat_privacy into v_me_privacy from public.profiles where id = v_uid;
  select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;
  select * into v_part from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid;

  v_share_receipts := v_conv.status = 'ACCEPTED'
    and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
    and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);

  if p_around_message_id is not null then
    select created_at into v_anchor
    from public.messages
    where id = p_around_message_id and conversation_id = v_conv.id;
  end if;

  select id into v_unread_first_id
  from public.messages um
  where um.conversation_id = v_conv.id
    and um.sender_id <> v_uid
    and um.deleted_for_everyone_at is null
    and not (v_uid = any(um.deleted_for_user_ids))
    and (v_part.deleted_before_at is null or um.created_at > v_part.deleted_before_at)
    and v_part.last_read_at is not null
    and um.created_at > v_part.last_read_at
  order by um.created_at asc
  limit 1;

  return (
    with visible as (
      select m.*
      from public.messages m
      where m.conversation_id = v_conv.id
        and not (v_uid = any(m.deleted_for_user_ids))
        and (v_part.deleted_before_at is null or m.created_at > v_part.deleted_before_at)
        and (
          (v_anchor is null and (p_before is null or m.created_at < p_before))
          or (v_anchor is not null and m.created_at <= (v_anchor + interval '30 days'))
        )
      order by m.created_at desc
      limit v_lim + 1
    ),
    sliced as (
      select * from visible order by created_at desc limit v_lim
    ),
    ordered as (
      select * from sliced order by created_at asc
    )
    select jsonb_build_object(
      'conversation', public.get_social_user_profile(v_peer_id) || jsonb_build_object(
        'conversation_id', v_conv.id,
        'status', v_conv.status,
        'initiator_id', v_conv.initiator_id,
        'is_muted', coalesce(v_part.is_muted, false),
        'is_pinned', coalesce(v_part.is_pinned, false),
        'is_archived', coalesce(v_part.is_archived, false),
        'chat_theme', coalesce(v_part.chat_theme, 'paper'),
        'receipts_enabled', v_share_receipts
      ),
      'has_older', ((select count(*) from visible) > v_lim),
      'unread_first_id', v_unread_first_id,
      'pinned_messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pm.id,
            'sender_id', pm.sender_id,
            'body', case when pm.deleted_for_everyone_at is not null then '' else left(pm.body, 140) end,
            'pinned_at', pm.pinned_at,
            'created_at', pm.created_at
          ) order by pm.pinned_at desc
        )
        from public.messages pm
        where pm.conversation_id = v_conv.id
          and pm.pinned_at is not null
          and pm.deleted_for_everyone_at is null
          and not (v_uid = any(pm.deleted_for_user_ids))
          and (v_part.deleted_before_at is null or pm.created_at > v_part.deleted_before_at)
      ), '[]'::jsonb),
      'messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'conversation_id', o.conversation_id,
            'sender_id', o.sender_id,
            'body', case when o.deleted_for_everyone_at is not null then '' else o.body end,
            'message_type', o.message_type,
            'metadata', coalesce(o.metadata, '{}'::jsonb),
            'reply_to_id', o.reply_to_id,
            'reply_preview', (
              select case
                when rm.id is null then null
                else jsonb_build_object(
                  'id', rm.id,
                  'sender_id', rm.sender_id,
                  'sender_name', rp.full_name,
                  'body', case when rm.deleted_for_everyone_at is not null then 'Message removed' else left(nullif(btrim(rm.body), ''), 120) end
                )
              end
              from public.messages rm
              join public.profiles rp on rp.id = rm.sender_id
              where rm.id = o.reply_to_id
            ),
            'forwarded_from_id', o.forwarded_from_id,
            'edited_at', o.edited_at,
            'deleted_for_everyone_at', o.deleted_for_everyone_at,
            'pinned_at', o.pinned_at,
            'created_at', o.created_at,
            'delivered_at', (
              select mr.delivered_at from public.message_receipts mr
              where mr.message_id = o.id and mr.user_id = v_peer_id
              limit 1
            ),
            'read_at', case
              when o.sender_id = v_uid and v_share_receipts then (
                select mr.read_at from public.message_receipts mr
                where mr.message_id = o.id and mr.user_id = v_peer_id
                limit 1
              )
              else null
            end,
            'attachments', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', ma.id,
                    'path', ma.storage_path,
                    'name', ma.file_name,
                    'type', ma.mime_type,
                    'size', ma.file_size,
                    'kind', ma.attachment_kind,
                    'width', ma.width,
                    'height', ma.height,
                    'duration_seconds', ma.duration_seconds
                  ) order by ma.created_at asc
                )
                from public.message_attachments ma
                where ma.message_id = o.id
              ), '[]'::jsonb)
            end,
            'reactions', case
              when o.deleted_for_everyone_at is not null then '[]'::jsonb
              else coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'user_id', mr2.user_id,
                    'emoji', mr2.emoji,
                    'user_name', rp2.full_name
                  ) order by mr2.created_at asc
                )
                from public.message_reactions mr2
                join public.profiles rp2 on rp2.id = mr2.user_id
                where mr2.message_id = o.id
              ), '[]'::jsonb)
            end
          )
          order by o.created_at asc
        )
        from ordered o
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- Search within a single conversation or across all conversations
create or replace function public.search_conversation_messages(
  p_conversation_id uuid default null,
  p_query text default '',
  p_sender_id uuid default null,
  p_limit integer default 40
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_lim integer := greatest(1, least(coalesce(p_limit, 40), 80));
begin
  if v_q = '' and p_sender_id is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'message_id', m.id,
        'conversation_id', m.conversation_id,
        'sender_id', m.sender_id,
        'sender_name', sp.full_name,
        'peer_id', peer.id,
        'peer_name', peer.full_name,
        'peer_avatar', peer.avatar_url,
        'body', left(m.body, 220),
        'created_at', m.created_at
      )
      order by m.created_at desc
    )
    from (
      select m.*
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
      where (c.user_a = v_uid or c.user_b = v_uid)
        and (p_conversation_id is null or m.conversation_id = p_conversation_id)
        and m.deleted_for_everyone_at is null
        and m.message_type not in ('CALL_EVENT', 'SYSTEM')
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
        and c.status <> 'DECLINED'
        and (p_sender_id is null or m.sender_id = p_sender_id)
        and (
          v_q = ''
          or lower(m.body) like '%' || v_q || '%'
          or exists (
            select 1 from public.message_attachments ma
            where ma.message_id = m.id and lower(ma.file_name) like '%' || v_q || '%'
          )
        )
      order by m.created_at desc
      limit v_lim
    ) m
    join public.conversations c on c.id = m.conversation_id
    join public.profiles sp on sp.id = m.sender_id
    join public.profiles peer on peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    where peer.role in ('ADMIN', 'TREASURER', 'MEMBER')
      and not public.is_user_blocked_between(v_uid, peer.id)
  ), '[]'::jsonb);
end;
$$;

-- Voice & Video Call session RPCs
create or replace function public.start_call_session(
  p_conversation_id uuid,
  p_call_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_type text := upper(btrim(coalesce(p_call_type, '')));
  v_conv public.conversations%rowtype;
  v_peer_id uuid;
  v_caller record;
  v_peer record;
  v_busy boolean;
  v_call public.call_sessions%rowtype;
begin
  if v_type not in ('VOICE', 'VIDEO') then
    raise exception 'Call type must be VOICE or VIDEO.' using errcode = '22023';
  end if;

  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or (v_conv.user_a <> v_uid and v_conv.user_b <> v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;
  if v_conv.status <> 'ACCEPTED' then
    raise exception 'Accept the conversation or become friends before starting a call.' using errcode = '42501';
  end if;

  v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
  select id, full_name, role, status into v_peer from public.profiles where id = v_peer_id;
  select id, full_name, avatar_url into v_caller from public.profiles where id = v_uid;

  if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
    raise exception 'Recipient cannot receive calls.' using errcode = '42501';
  end if;
  if public.is_user_blocked_between(v_uid, v_peer_id) then
    raise exception 'Calls are unavailable because one of you has blocked the other.' using errcode = '42501';
  end if;

  -- Clean up orphaned stale rings (> 90 seconds old) before busy check
  update public.call_sessions
  set status = 'MISSED', ended_at = now(), end_reason = 'TIMEOUT'
  where status = 'RINGING'
    and started_at < now() - interval '90 seconds'
    and (caller_id in (v_uid, v_peer_id) or callee_id in (v_uid, v_peer_id));

  select exists (
    select 1 from public.call_sessions cs
    where cs.status in ('RINGING', 'ACCEPTED')
      and (cs.caller_id in (v_uid, v_peer_id) or cs.callee_id in (v_uid, v_peer_id))
  ) into v_busy;

  if v_busy then
    raise exception 'Another call is already active with you or this recipient.' using errcode = '42501';
  end if;

  insert into public.call_sessions (conversation_id, caller_id, callee_id, call_type, status)
  values (v_conv.id, v_uid, v_peer_id, v_type, 'RINGING')
  returning * into v_call;

  perform public.push_social_notification(
    v_peer_id,
    v_uid,
    'SOCIAL_CALL_INCOMING',
    case when v_type = 'VIDEO' then 'Incoming video call' else 'Incoming voice call' end,
    coalesce(v_caller.full_name, 'Someone') || ' started a ' || lower(v_type) || ' call.',
    'dashboard.html?chat=' || v_conv.id::text || '&call=' || v_call.id::text,
    'SOCIAL_CALL:' || v_call.id::text
  );

  return jsonb_build_object(
    'id', v_call.id,
    'conversation_id', v_call.conversation_id,
    'caller_id', v_call.caller_id,
    'callee_id', v_call.callee_id,
    'call_type', v_call.call_type,
    'status', v_call.status,
    'started_at', v_call.started_at
  );
end;
$$;

create or replace function public.update_call_session(
  p_call_id uuid,
  p_status text,
  p_end_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_next text := upper(btrim(coalesce(p_status, '')));
  v_call public.call_sessions%rowtype;
  v_caller_name text;
  v_duration integer := 0;
  v_summary text;
  v_msg_id uuid;
  v_label text;
begin
  if v_next not in ('ACCEPTED', 'DECLINED', 'MISSED', 'ENDED', 'FAILED') then
    raise exception 'Invalid call session status.' using errcode = '22023';
  end if;

  select * into v_call from public.call_sessions where id = p_call_id for update;
  if v_call.id is null or (v_call.caller_id <> v_uid and v_call.callee_id <> v_uid) then
    raise exception 'Call session not found.' using errcode = 'P0002';
  end if;

  if v_call.status in ('DECLINED', 'MISSED', 'ENDED', 'FAILED') then
    return jsonb_build_object('id', v_call.id, 'status', v_call.status, 'ended_at', v_call.ended_at);
  end if;

  if v_next = 'ACCEPTED' then
    if v_call.callee_id <> v_uid or v_call.status <> 'RINGING' then
      raise exception 'Only the callee can accept a ringing call.' using errcode = '42501';
    end if;
    update public.call_sessions
    set status = 'ACCEPTED', answered_at = coalesce(answered_at, now())
    where id = v_call.id
    returning * into v_call;
    return jsonb_build_object('id', v_call.id, 'status', v_call.status, 'answered_at', v_call.answered_at);
  end if;

  -- Terminal states
  update public.call_sessions
  set status = v_next,
      ended_at = coalesce(ended_at, now()),
      end_reason = nullif(left(btrim(coalesce(p_end_reason, '')), 120), '')
  where id = v_call.id
  returning * into v_call;

  if v_call.answered_at is not null and v_call.ended_at is not null then
    v_duration := greatest(0, floor(extract(epoch from (v_call.ended_at - v_call.answered_at)))::integer);
  end if;

  v_label := case when v_call.call_type = 'VIDEO' then 'Video call' else 'Voice call' end;
  v_summary := case
    when v_next = 'MISSED' then 'Missed ' || lower(v_label)
    when v_next = 'DECLINED' then v_label || ' declined'
    when v_next = 'FAILED' then v_label || ' connection interrupted'
    when v_duration > 0 then v_label || ' · ' || (v_duration / 60)::text || 'm ' || (v_duration % 60)::text || 's'
    else v_label || ' ended'
  end;

  if not exists (
    select 1 from public.messages m
    where m.conversation_id = v_call.conversation_id
      and m.message_type = 'CALL_EVENT'
      and m.metadata ->> 'call_id' = v_call.id::text
  ) then
    insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
    values (
      v_call.conversation_id,
      v_call.caller_id,
      v_summary,
      'CALL_EVENT',
      jsonb_build_object(
        'call_id', v_call.id,
        'call_type', v_call.call_type,
        'status', v_call.status,
        'duration_seconds', v_duration,
        'summary', v_summary
      )
    )
    returning id into v_msg_id;

    update public.conversations
    set last_message_id = v_msg_id,
        last_message_at = now(),
        last_message_preview = v_summary,
        last_message_sender_id = v_call.caller_id
    where id = v_call.conversation_id;
  end if;

  if v_next = 'MISSED' then
    select full_name into v_caller_name from public.profiles where id = v_call.caller_id;
    perform public.push_social_notification(
      v_call.callee_id,
      v_call.caller_id,
      'SOCIAL_CALL_MISSED',
      'Missed ' || lower(v_label),
      'You missed a ' || lower(v_label) || ' from ' || coalesce(v_caller_name, 'someone') || '.',
      'dashboard.html?chat=' || v_call.conversation_id::text,
      'SOCIAL_CALL:' || v_call.id::text
    );
  end if;

  return jsonb_build_object(
    'id', v_call.id,
    'status', v_call.status,
    'duration_seconds', v_duration,
    'ended_at', v_call.ended_at
  );
end;
$$;

-- Tighten function grants (authenticated only, revoke public & anon)
revoke all on function
  public.is_messaging_eligible(uuid),
  public.canonical_pair_key(uuid, uuid),
  public.is_user_blocked_between(uuid, uuid),
  public.are_friends(uuid, uuid),
  public.push_social_notification(uuid, uuid, text, text, text, text, text),
  public.require_messaging_actor(),
  public.touch_user_last_seen(),
  public.update_social_profile_and_privacy(text, text, jsonb),
  public.get_social_user_profile(uuid),
  public.search_social_users(text, integer),
  public.get_friend_suggestions(integer),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, text),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.block_social_user(uuid),
  public.unblock_social_user(uuid),
  public.get_social_overview(),
  public.start_or_open_direct_chat(uuid),
  public.can_send_to_conversation(uuid),
  public.get_conversation_attachment_paths(uuid, text[]),
  public.respond_message_request(uuid, text),
  public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.edit_chat_message(uuid, text),
  public.delete_chat_message(uuid, text),
  public.toggle_message_reaction(uuid, text),
  public.pin_chat_message(uuid),
  public.mark_conversation_read(uuid),
  public.update_conversation_member_state(uuid, text, text),
  public.get_conversations(),
  public.get_conversation_messages(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages(uuid, text, uuid, integer),
  public.start_call_session(uuid, text),
  public.update_call_session(uuid, text, text)
from public, anon;

grant execute on function
  public.is_messaging_eligible(uuid),
  public.canonical_pair_key(uuid, uuid),
  public.is_user_blocked_between(uuid, uuid),
  public.are_friends(uuid, uuid),
  public.touch_user_last_seen(),
  public.update_social_profile_and_privacy(text, text, jsonb),
  public.get_social_user_profile(uuid),
  public.search_social_users(text, integer),
  public.get_friend_suggestions(integer),
  public.send_friend_request(uuid),
  public.respond_friend_request(uuid, text),
  public.cancel_friend_request(uuid),
  public.remove_friend(uuid),
  public.block_social_user(uuid),
  public.unblock_social_user(uuid),
  public.get_social_overview(),
  public.start_or_open_direct_chat(uuid),
  public.can_send_to_conversation(uuid),
  public.get_conversation_attachment_paths(uuid, text[]),
  public.respond_message_request(uuid, text),
  public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.edit_chat_message(uuid, text),
  public.delete_chat_message(uuid, text),
  public.toggle_message_reaction(uuid, text),
  public.pin_chat_message(uuid),
  public.mark_conversation_read(uuid),
  public.update_conversation_member_state(uuid, text, text),
  public.get_conversations(),
  public.get_conversation_messages(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages(uuid, text, uuid, integer),
  public.start_call_session(uuid, text),
  public.update_call_session(uuid, text, text)
to authenticated;

-- Private storage bucket for lossless chat media & files
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = 52428800;

-- Publish real-time social and messaging tables idempotently
do $$
declare
  v_tbl text;
begin
  foreach v_tbl in array array[
    'blocked_users',
    'friend_requests',
    'friendships',
    'conversations',
    'conversation_participants',
    'messages',
    'message_attachments',
    'message_reactions',
    'message_receipts',
    'call_sessions'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_tbl);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version, name)
values ('20261115_076', 'messaging and social connection system')
on conflict (version) do nothing;

commit;
