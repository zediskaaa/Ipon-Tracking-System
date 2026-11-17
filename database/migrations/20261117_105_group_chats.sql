-- Migration 20261117_105: Full-featured Group Chats in Messaging with identical 90-day retention & privacy hygiene.

begin;

-- 1. Extend public.conversations & public.conversation_participants for GROUP conversations
do $$
declare
  v_con record;
begin
  for v_con in
    select conname
    from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%DIRECT%'
        or pg_get_constraintdef(oid) ilike '%user_a < user_b%'
      )
  loop
    execute format('alter table public.conversations drop constraint if exists %I', v_con.conname);
  end loop;
end $$;

alter table public.conversations
  alter column pair_key drop not null,
  alter column user_a drop not null,
  alter column user_b drop not null,
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists avatar_url text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

alter table public.conversations
  drop constraint if exists conversations_kind_check,
  add constraint conversations_kind_check check (kind in ('DIRECT', 'GROUP'));

alter table public.conversations
  drop constraint if exists conversations_kind_shape_check,
  add constraint conversations_kind_shape_check check (
    (kind = 'DIRECT' and pair_key is not null and user_a is not null and user_b is not null and user_a < user_b)
    or (kind = 'GROUP' and user_a is null and user_b is null and title is not null and char_length(btrim(title)) between 2 and 80)
  );

alter table public.conversations
  drop constraint if exists conversations_description_check,
  add constraint conversations_description_check check (
    description is null or char_length(btrim(description)) <= 240
  );

alter table public.conversation_participants
  add column if not exists role text not null default 'MEMBER',
  add column if not exists joined_at timestamptz not null default now(),
  add column if not exists added_by uuid references public.profiles(id) on delete set null;

alter table public.conversation_participants
  drop constraint if exists conversation_participants_role_check,
  add constraint conversation_participants_role_check check (role in ('OWNER', 'ADMIN', 'MEMBER'));

create index if not exists conversations_kind_last_msg_idx
  on public.conversations (kind, last_message_at desc nulls last);

-- 2. Recursion-free membership helper + updated RLS SELECT policies
create or replace function public.is_conversation_member(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_conversation_id is not null
    and p_user_id is not null
    and public.is_messaging_eligible(p_user_id)
    and exists (
      select 1
      from public.conversations c
      where c.id = p_conversation_id
        and (
          (c.kind = 'DIRECT' and (c.user_a = p_user_id or c.user_b = p_user_id))
          or (
            c.kind = 'GROUP'
            and exists (
              select 1
              from public.conversation_participants cp
              where cp.conversation_id = c.id
                and cp.user_id = p_user_id
            )
          )
        )
    );
$$;

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
using (
  user_a = auth.uid()
  or user_b = auth.uid()
  or (kind = 'GROUP' and public.is_conversation_member(id, auth.uid()))
);

drop policy if exists conversation_participants_select on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants for select to authenticated
using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
using (
  not (auth.uid() = any(deleted_for_user_ids))
  and public.is_conversation_member(conversation_id, auth.uid())
);

drop policy if exists message_attachments_select on public.message_attachments;
create policy message_attachments_select on public.message_attachments for select to authenticated
using (public.is_conversation_member(conversation_id, auth.uid()));

drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_id
      and not (auth.uid() = any(m.deleted_for_user_ids))
      and public.is_conversation_member(m.conversation_id, auth.uid())
  )
);

drop policy if exists message_receipts_select on public.message_receipts;
create policy message_receipts_select on public.message_receipts for select to authenticated
using (
  exists (
    select 1
    from public.messages m
    where m.id = message_id
      and public.is_conversation_member(m.conversation_id, auth.uid())
  )
);

-- 3. Update attachment & membership checks for DIRECT + GROUP
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
  if v_conv.id is null then
    return false;
  end if;
  if v_conv.kind = 'GROUP' then
    return v_conv.status = 'ACCEPTED'
      and exists (
        select 1 from public.conversation_participants cp
        where cp.conversation_id = v_conv.id and cp.user_id = v_uid
      );
  end if;
  if v_conv.user_a <> v_uid and v_conv.user_b <> v_uid then
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
  v_part public.conversation_participants%rowtype;
begin
  if not public.is_conversation_member(p_conversation_id, v_uid) then
    return '{}';
  end if;
  select * into v_part
  from public.conversation_participants
  where conversation_id = p_conversation_id and user_id = v_uid;

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

-- 4. Group Chat Lifecycle RPCs (Create, Rename/Describe, Add Members, Role Control, Leave/Remove)
create or replace function public.create_group_chat(
  p_title text,
  p_member_ids uuid[],
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_creator_name text;
  v_member_ids uuid[];
  v_conv public.conversations%rowtype;
  v_msg public.messages%rowtype;
  v_target record;
  v_mid uuid;
  v_sys_body text;
begin
  if char_length(v_title) < 2 or char_length(v_title) > 80 then
    raise exception 'Group name must be between 2 and 80 characters.' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 240 then
    raise exception 'Group description must be 240 characters or fewer.' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_member_ids
  from unnest(coalesce(p_member_ids, '{}')) as x
  where x is not null and x <> v_uid;

  if coalesce(array_length(v_member_ids, 1), 0) < 1 then
    raise exception 'Select at least 1 other member to start a group chat.' using errcode = '22023';
  end if;
  if coalesce(array_length(v_member_ids, 1), 0) > 49 then
    raise exception 'A group chat supports up to 50 total members.' using errcode = '22023';
  end if;

  select full_name into v_creator_name from public.profiles where id = v_uid;

  foreach v_mid in array v_member_ids loop
    select id, full_name, status, role, chat_privacy into v_target
    from public.profiles where id = v_mid;

    if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'One or more selected accounts are unavailable for group chats.' using errcode = '42501';
    end if;
    if public.is_user_blocked_between(v_uid, v_mid) then
      raise exception 'Cannot add % because messaging is blocked between you two.', coalesce(v_target.full_name, 'this user') using errcode = '42501';
    end if;
    if not public.are_friends(v_uid, v_mid)
       and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
      raise exception '% only accepts chats from friends.', coalesce(v_target.full_name, 'Selected user') using errcode = '42501';
    end if;
  end loop;

  insert into public.conversations (
    kind, title, description, created_by, initiator_id, status, accepted_at
  ) values (
    'GROUP', v_title, v_desc, v_uid, v_uid, 'ACCEPTED', now()
  )
  returning * into v_conv;

  insert into public.conversation_participants (conversation_id, user_id, role, added_by, last_read_at)
  values (v_conv.id, v_uid, 'OWNER', v_uid, now());

  foreach v_mid in array v_member_ids loop
    insert into public.conversation_participants (conversation_id, user_id, role, added_by)
    values (v_conv.id, v_mid, 'MEMBER', v_uid)
    on conflict (conversation_id, user_id) do nothing;
  end loop;

  v_sys_body := coalesce(v_creator_name, 'Someone') || ' created the group "' || v_title || '"';
  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (
    v_conv.id,
    v_uid,
    v_sys_body,
    'SYSTEM',
    jsonb_build_object('event', 'GROUP_CREATED', 'title', v_title, 'member_count', array_length(v_member_ids, 1) + 1)
  )
  returning * into v_msg;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = left(v_sys_body, 140),
      last_message_sender_id = v_uid
  where id = v_conv.id;

  update public.conversation_participants
  set last_read_message_id = v_msg.id, last_read_at = v_msg.created_at
  where conversation_id = v_conv.id and user_id = v_uid;

  foreach v_mid in array v_member_ids loop
    perform public.push_social_notification(
      v_mid,
      v_uid,
      'SOCIAL_NEW_MESSAGE',
      v_title,
      coalesce(v_creator_name, 'Someone') || ' added you to the group "' || v_title || '".',
      'dashboard.html?chat=' || v_conv.id::text,
      'SOCIAL_MSG:' || v_conv.id::text
    );
  end loop;

  return jsonb_build_object(
    'id', v_conv.id,
    'kind', 'GROUP',
    'title', v_conv.title,
    'status', v_conv.status,
    'member_count', array_length(v_member_ids, 1) + 1
  );
end;
$$;

create or replace function public.update_group_chat_info(
  p_conversation_id uuid,
  p_title text default null,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_part public.conversation_participants%rowtype;
  v_prev_title text;
  v_prev_desc text;
  v_next_title text;
  v_next_desc text;
  v_actor_name text;
  v_sys_body text;
  v_msg public.messages%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.kind <> 'GROUP' then
    raise exception 'Group chat not found.' using errcode = 'P0002';
  end if;

  select * into v_part
  from public.conversation_participants
  where conversation_id = v_conv.id and user_id = v_uid;

  if v_part.user_id is null or v_part.role not in ('OWNER', 'ADMIN') then
    raise exception 'Only group owners or admins can edit group details.' using errcode = '42501';
  end if;

  v_prev_title := v_conv.title;
  v_prev_desc := v_conv.description;

  v_next_title := case
    when p_title is not null then btrim(regexp_replace(p_title, '\s+', ' ', 'g'))
    else v_conv.title
  end;
  if char_length(coalesce(v_next_title, '')) < 2 or char_length(v_next_title) > 80 then
    raise exception 'Group name must be between 2 and 80 characters.' using errcode = '22023';
  end if;

  v_next_desc := case
    when p_description is not null then nullif(btrim(p_description), '')
    else v_conv.description
  end;
  if v_next_desc is not null and char_length(v_next_desc) > 240 then
    raise exception 'Group description must be 240 characters or fewer.' using errcode = '22023';
  end if;

  update public.conversations
  set title = v_next_title,
      description = v_next_desc
  where id = v_conv.id
  returning * into v_conv;

  if v_next_title is distinct from v_prev_title or v_next_desc is distinct from v_prev_desc then
    select full_name into v_actor_name from public.profiles where id = v_uid;
    v_sys_body := case
      when v_next_title is distinct from v_prev_title
        then coalesce(v_actor_name, 'Someone') || ' renamed the group to "' || v_next_title || '"'
      else coalesce(v_actor_name, 'Someone') || ' updated the group description'
    end;
    insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
    values (v_conv.id, v_uid, v_sys_body, 'SYSTEM', jsonb_build_object('event', 'GROUP_UPDATED', 'title', v_next_title))
    returning * into v_msg;

    update public.conversations
    set last_message_id = v_msg.id,
        last_message_at = v_msg.created_at,
        last_message_preview = left(v_sys_body, 140),
        last_message_sender_id = v_uid
    where id = v_conv.id;

    update public.conversation_participants
    set last_read_message_id = v_msg.id, last_read_at = v_msg.created_at
    where conversation_id = v_conv.id and user_id = v_uid;
  end if;

  return jsonb_build_object(
    'id', v_conv.id,
    'title', v_conv.title,
    'description', v_conv.description
  );
end;
$$;

create or replace function public.add_group_chat_members(
  p_conversation_id uuid,
  p_member_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_part public.conversation_participants%rowtype;
  v_existing_count integer := 0;
  v_new_ids uuid[];
  v_added_names text[] := '{}';
  v_target record;
  v_actor_name text;
  v_mid uuid;
  v_sys_body text;
  v_msg public.messages%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.kind <> 'GROUP' then
    raise exception 'Group chat not found.' using errcode = 'P0002';
  end if;

  select * into v_part
  from public.conversation_participants
  where conversation_id = v_conv.id and user_id = v_uid;
  if v_part.user_id is null or v_part.role not in ('OWNER', 'ADMIN') then
    raise exception 'Only group owners or admins can add members.' using errcode = '42501';
  end if;

  select count(*)::integer into v_existing_count
  from public.conversation_participants
  where conversation_id = v_conv.id;

  select coalesce(array_agg(distinct x), '{}') into v_new_ids
  from unnest(coalesce(p_member_ids, '{}')) as x
  where x is not null
    and not exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = v_conv.id and cp.user_id = x
    );

  if coalesce(array_length(v_new_ids, 1), 0) = 0 then
    raise exception 'Select at least one person who is not already in this group.' using errcode = '22023';
  end if;
  if v_existing_count + array_length(v_new_ids, 1) > 50 then
    raise exception 'A group chat supports up to 50 members.' using errcode = '22023';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;

  foreach v_mid in array v_new_ids loop
    select id, full_name, status, role, chat_privacy into v_target
    from public.profiles where id = v_mid;
    if v_target.id is null or v_target.status <> 'ACTIVE' or v_target.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'One or more selected accounts are unavailable.' using errcode = '42501';
    end if;
    if public.is_user_blocked_between(v_uid, v_mid) then
      raise exception 'Cannot add % because messaging is blocked between you two.', coalesce(v_target.full_name, 'this user') using errcode = '42501';
    end if;
    if not public.are_friends(v_uid, v_mid)
       and coalesce(v_target.chat_privacy ->> 'allow_message_requests', 'EVERYONE') = 'FRIENDS_ONLY' then
      raise exception '% only accepts chats from friends.', coalesce(v_target.full_name, 'Selected user') using errcode = '42501';
    end if;

    insert into public.conversation_participants (conversation_id, user_id, role, added_by)
    values (v_conv.id, v_mid, 'MEMBER', v_uid)
    on conflict (conversation_id, user_id) do nothing;

    v_added_names := array_append(v_added_names, coalesce(v_target.full_name, 'User'));
  end loop;

  v_sys_body := case
    when array_length(v_added_names, 1) = 1
      then coalesce(v_actor_name, 'Someone') || ' added ' || v_added_names[1]
    else coalesce(v_actor_name, 'Someone') || ' added ' || v_added_names[1] || ' and ' || (array_length(v_added_names, 1) - 1)::text || ' other(s)'
  end;

  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (v_conv.id, v_uid, v_sys_body, 'SYSTEM', jsonb_build_object('event', 'MEMBERS_ADDED', 'added_ids', v_new_ids))
  returning * into v_msg;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = left(v_sys_body, 140),
      last_message_sender_id = v_uid
  where id = v_conv.id;

  update public.conversation_participants
  set hidden_at = null,
      is_archived = false,
      last_read_message_id = case when user_id = v_uid then v_msg.id else last_read_message_id end,
      last_read_at = case when user_id = v_uid then v_msg.created_at else last_read_at end
  where conversation_id = v_conv.id
    and (user_id = v_uid or user_id = any(v_new_ids));

  foreach v_mid in array v_new_ids loop
    perform public.push_social_notification(
      v_mid,
      v_uid,
      'SOCIAL_NEW_MESSAGE',
      coalesce(v_conv.title, 'Group Chat'),
      coalesce(v_actor_name, 'Someone') || ' added you to "' || coalesce(v_conv.title, 'Group Chat') || '".',
      'dashboard.html?chat=' || v_conv.id::text,
      'SOCIAL_MSG:' || v_conv.id::text
    );
  end loop;

  return jsonb_build_object('added_count', array_length(v_new_ids, 1), 'conversation_id', v_conv.id);
end;
$$;

create or replace function public.update_group_chat_member_role(
  p_conversation_id uuid,
  p_target_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_next_role text := upper(btrim(coalesce(p_role, '')));
  v_conv public.conversations%rowtype;
  v_actor public.conversation_participants%rowtype;
  v_target public.conversation_participants%rowtype;
  v_actor_name text;
  v_target_name text;
  v_sys_body text;
  v_msg public.messages%rowtype;
begin
  if v_next_role not in ('OWNER', 'ADMIN', 'MEMBER') then
    raise exception 'Role must be OWNER, ADMIN, or MEMBER.' using errcode = '22023';
  end if;
  if p_target_user_id is null or p_target_user_id = v_uid then
    raise exception 'Select another group member.' using errcode = '22023';
  end if;

  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.kind <> 'GROUP' then
    raise exception 'Group chat not found.' using errcode = 'P0002';
  end if;

  select * into v_actor from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid for update;
  select * into v_target from public.conversation_participants where conversation_id = v_conv.id and user_id = p_target_user_id for update;

  if v_actor.user_id is null or v_actor.role <> 'OWNER' then
    raise exception 'Only the group owner can change member roles.' using errcode = '42501';
  end if;
  if v_target.user_id is null then
    raise exception 'Member is no longer in this group.' using errcode = 'P0002';
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;
  select full_name into v_target_name from public.profiles where id = p_target_user_id;

  if v_next_role = 'OWNER' then
    update public.conversation_participants set role = 'ADMIN' where conversation_id = v_conv.id and user_id = v_uid;
    update public.conversation_participants set role = 'OWNER' where conversation_id = v_conv.id and user_id = p_target_user_id;
    update public.conversations set created_by = p_target_user_id where id = v_conv.id;
    v_sys_body := coalesce(v_actor_name, 'Someone') || ' made ' || coalesce(v_target_name, 'a member') || ' the group owner';
  else
    update public.conversation_participants set role = v_next_role where conversation_id = v_conv.id and user_id = p_target_user_id;
    v_sys_body := case
      when v_next_role = 'ADMIN' then coalesce(v_actor_name, 'Someone') || ' made ' || coalesce(v_target_name, 'a member') || ' a group admin'
      else coalesce(v_actor_name, 'Someone') || ' removed ' || coalesce(v_target_name, 'a member') || ' as group admin'
    end;
  end if;

  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (v_conv.id, v_uid, v_sys_body, 'SYSTEM', jsonb_build_object('event', 'ROLE_UPDATED', 'target_id', p_target_user_id, 'role', v_next_role))
  returning * into v_msg;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = left(v_sys_body, 140),
      last_message_sender_id = v_uid
  where id = v_conv.id;

  update public.conversation_participants
  set last_read_message_id = v_msg.id, last_read_at = v_msg.created_at
  where conversation_id = v_conv.id and user_id = v_uid;

  return jsonb_build_object('ok', true, 'user_id', p_target_user_id, 'role', v_next_role);
end;
$$;

create or replace function public.remove_group_chat_member(
  p_conversation_id uuid,
  p_target_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_target_id uuid := coalesce(p_target_user_id, v_uid);
  v_is_leave boolean := (v_target_id = v_uid);
  v_conv public.conversations%rowtype;
  v_actor public.conversation_participants%rowtype;
  v_target public.conversation_participants%rowtype;
  v_remaining integer := 0;
  v_next_owner uuid;
  v_next_owner_name text;
  v_actor_name text;
  v_target_name text;
  v_sys_body text;
  v_msg public.messages%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.kind <> 'GROUP' then
    raise exception 'Group chat not found.' using errcode = 'P0002';
  end if;

  select * into v_actor from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid;
  if v_actor.user_id is null then
    raise exception 'You are not a member of this group chat.' using errcode = '42501';
  end if;

  select * into v_target from public.conversation_participants where conversation_id = v_conv.id and user_id = v_target_id;
  if v_target.user_id is null then
    raise exception 'Selected member is no longer in this group.' using errcode = 'P0002';
  end if;

  if not v_is_leave then
    if v_actor.role not in ('OWNER', 'ADMIN') then
      raise exception 'Only group owners or admins can remove members.' using errcode = '42501';
    end if;
    if v_target.role = 'OWNER' or (v_actor.role = 'ADMIN' and v_target.role = 'ADMIN') then
      raise exception 'You do not have permission to remove this member.' using errcode = '42501';
    end if;
  end if;

  select full_name into v_actor_name from public.profiles where id = v_uid;
  select full_name into v_target_name from public.profiles where id = v_target_id;

  delete from public.conversation_participants
  where conversation_id = v_conv.id and user_id = v_target_id;

  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = v_target_id
    and read_at is null
    and type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY')
    and (link like '%' || v_conv.id::text || '%' or dedupe_key like '%' || v_conv.id::text || '%');

  select count(*)::integer into v_remaining
  from public.conversation_participants
  where conversation_id = v_conv.id;

  if v_remaining = 0 then
    insert into public.pending_storage_deletions (bucket_id, object_path)
    select coalesce(nullif(ma.bucket_id, ''), 'chat-attachments'), ma.storage_path
    from public.message_attachments ma
    where ma.conversation_id = v_conv.id
    on conflict (bucket_id, object_path) do nothing;

    delete from public.conversations where id = v_conv.id;
    return jsonb_build_object('ok', true, 'left', v_is_leave, 'deleted_group', true);
  end if;

  if v_target.role = 'OWNER' or v_conv.created_by = v_target_id then
    select cp.user_id into v_next_owner
    from public.conversation_participants cp
    join public.profiles p on p.id = cp.user_id
    where cp.conversation_id = v_conv.id
      and p.status = 'ACTIVE'
    order by
      case cp.role when 'ADMIN' then 1 else 2 end,
      cp.joined_at asc
    limit 1;

    if v_next_owner is not null then
      update public.conversation_participants
      set role = 'OWNER'
      where conversation_id = v_conv.id and user_id = v_next_owner;

      update public.conversations
      set created_by = v_next_owner
      where id = v_conv.id;

      select full_name into v_next_owner_name from public.profiles where id = v_next_owner;
    end if;
  end if;

  v_sys_body := case
    when v_is_leave then coalesce(v_actor_name, 'Someone') || ' left the group'
      || case when v_next_owner_name is not null then ' · ' || v_next_owner_name || ' is now group owner' else '' end
    else coalesce(v_actor_name, 'Someone') || ' removed ' || coalesce(v_target_name, 'a member')
  end;

  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (
    v_conv.id,
    v_uid,
    v_sys_body,
    'SYSTEM',
    jsonb_build_object('event', case when v_is_leave then 'MEMBER_LEFT' else 'MEMBER_REMOVED' end, 'target_id', v_target_id)
  )
  returning * into v_msg;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = left(v_sys_body, 140),
      last_message_sender_id = v_uid
  where id = v_conv.id;

  if not v_is_leave then
    update public.conversation_participants
    set last_read_message_id = v_msg.id, last_read_at = v_msg.created_at
    where conversation_id = v_conv.id and user_id = v_uid;
  end if;

  return jsonb_build_object('ok', true, 'left', v_is_leave, 'removed_user_id', v_target_id, 'deleted_group', false);
end;
$$;

-- 5. Update core messaging RPCs for DIRECT + GROUP compatibility
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
  v_rec record;
  v_notif_title text;
  v_notif_type text;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select id, full_name into v_sender from public.profiles where id = v_uid;

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    select id, full_name, role, status, chat_privacy into v_peer from public.profiles where id = v_peer_id;
    if v_peer.id is null or v_peer.status <> 'ACTIVE' or v_peer.role not in ('ADMIN', 'TREASURER', 'MEMBER') then
      raise exception 'Recipient is unavailable for messaging.' using errcode = '42501';
    end if;
    if public.is_user_blocked_between(v_uid, v_peer_id) then
      raise exception 'Cannot send message because one of you has blocked the other.' using errcode = '42501';
    end if;
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
  if char_length(v_clean_body) > 500 then
    raise exception 'Message must be 500 characters or fewer.' using errcode = '22023';
  end if;

  if v_conv.kind = 'DIRECT' then
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
        and public.is_conversation_member(c.id, v_uid)
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

  v_preview := case
    when char_length(v_clean_body) > 0 then left(v_clean_body, 140)
    when v_type = 'VOICE' or (v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'audio') then 'Sent a voice message'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'image' then 'Sent a photo'
    when v_att_count = 1 and coalesce(p_attachments -> 0 ->> 'kind', '') = 'video' then 'Sent a video'
    when v_att_count > 1 then 'Sent ' || v_att_count::text || ' attachments'
    else 'Sent an attachment'
  end;

  update public.conversations
  set last_message_id = v_msg.id,
      last_message_at = v_msg.created_at,
      last_message_preview = v_preview,
      last_message_sender_id = v_uid
  where id = v_conv.id;

  if v_conv.kind = 'DIRECT' then
    insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
    values (v_msg.id, v_peer_id, null, null)
    on conflict (message_id, user_id) do nothing;

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
          v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
          'dashboard.html?messages=requests&chat=' || v_conv.id::text,
          'SOCIAL_MSG_REQ:' || v_conv.id::text
        );
      else
        v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
        v_notif_title := case when p_reply_to_id is not null then 'New reply from ' else 'New message from ' end || coalesce(v_sender.full_name, 'User');
        perform public.push_social_notification(
          v_peer_id, v_uid, v_notif_type, v_notif_title, v_preview,
          'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
          'SOCIAL_MSG:' || v_conv.id::text
        );
      end if;
    end if;
  else
    insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
    select v_msg.id, cp.user_id, null, null
    from public.conversation_participants cp
    join public.profiles rp on rp.id = cp.user_id
    where cp.conversation_id = v_conv.id
      and cp.user_id <> v_uid
      and rp.status = 'ACTIVE'
      and rp.role in ('ADMIN', 'TREASURER', 'MEMBER')
    on conflict (message_id, user_id) do nothing;

    update public.conversation_participants
    set hidden_at = null,
        marked_unread = false,
        last_read_message_id = v_msg.id,
        last_read_at = now()
    where conversation_id = v_conv.id and user_id = v_uid;

    update public.conversation_participants
    set hidden_at = null,
        is_archived = false
    where conversation_id = v_conv.id and user_id <> v_uid;

    v_notif_type := case when p_reply_to_id is not null then 'SOCIAL_MESSAGE_REPLY' else 'SOCIAL_NEW_MESSAGE' end;
    for v_rec in
      select cp.user_id, cp.is_muted
      from public.conversation_participants cp
      join public.profiles rp on rp.id = cp.user_id
      where cp.conversation_id = v_conv.id
        and cp.user_id <> v_uid
        and rp.status = 'ACTIVE'
        and rp.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and not public.is_user_blocked_between(v_uid, cp.user_id)
    loop
      if coalesce(v_rec.is_muted, false) is not true then
        perform public.push_social_notification(
          v_rec.user_id,
          v_uid,
          v_notif_type,
          coalesce(v_conv.title, 'Group Chat'),
          coalesce(v_sender.full_name, 'Someone') || ': ' || v_preview,
          'dashboard.html?chat=' || v_conv.id::text || '&msg=' || v_msg.id::text,
          'SOCIAL_MSG:' || v_conv.id::text
        );
      end if;
    end loop;
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
  v_paths text[] := '{}';
begin
  if v_mode not in ('FOR_ME', 'FOR_EVERYONE') then
    raise exception 'Deletion mode must be FOR_ME or FOR_EVERYONE.' using errcode = '22023';
  end if;

  select * into v_msg from public.messages where id = p_message_id for update;
  if v_msg.id is null then
    raise exception 'Message not found.' using errcode = 'P0002';
  end if;
  if not public.is_conversation_member(v_msg.conversation_id, v_uid) then
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
  v_existing text;
begin
  if char_length(v_emoji) < 1 or char_length(v_emoji) > 16 then
    raise exception 'Choose a valid reaction emoji.' using errcode = '22023';
  end if;

  select * into v_msg from public.messages where id = p_message_id;
  if v_msg.id is null or v_msg.deleted_for_everyone_at is not null or v_uid = any(v_msg.deleted_for_user_ids) then
    raise exception 'Message cannot be reacted to.' using errcode = 'P0002';
  end if;

  if not public.is_conversation_member(v_msg.conversation_id, v_uid) then
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
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) or v_conv.status <> 'ACCEPTED' then
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

create or replace function public.mark_messages_delivered(p_conversation_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_updated integer := 0;
begin
  if p_conversation_id is not null and not public.is_conversation_member(p_conversation_id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  update public.message_receipts mr
  set delivered_at = coalesce(mr.delivered_at, now())
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where mr.message_id = m.id
    and mr.user_id = v_uid
    and mr.delivered_at is null
    and m.deleted_for_everyone_at is null
    and public.is_conversation_member(c.id, v_uid)
    and c.status <> 'DECLINED'
    and (c.kind = 'GROUP' or not public.is_user_blocked_between(c.user_a, c.user_b))
    and (p_conversation_id is null or c.id = p_conversation_id);

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
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
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select chat_privacy into v_me_privacy from public.profiles where id = v_uid;

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

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;
    v_allow_receipts := v_conv.status = 'ACCEPTED'
      and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
      and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);
  else
    v_allow_receipts := coalesce((v_me_privacy ->> 'read_receipts')::boolean, true);
  end if;

  update public.message_receipts mr
  set delivered_at = coalesce(mr.delivered_at, now()),
      read_at = case when v_allow_receipts then coalesce(mr.read_at, now()) else mr.read_at end
  from public.messages m
  where mr.message_id = m.id
    and m.conversation_id = v_conv.id
    and mr.user_id = v_uid
    and (mr.delivered_at is null or (v_allow_receipts and mr.read_at is null));

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
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
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
        'kind', c.kind,
        'title', c.title,
        'description', c.description,
        'avatar_url', c.avatar_url,
        'status', c.status,
        'initiator_id', c.initiator_id,
        'is_incoming_request', (c.kind = 'DIRECT' and c.status = 'PENDING_REQUEST' and c.initiator_id is distinct from v_uid),
        'is_outgoing_request', (c.kind = 'DIRECT' and c.status = 'PENDING_REQUEST' and c.initiator_id = v_uid),
        'peer', case
          when c.kind = 'DIRECT' and peer.id is not null then jsonb_build_object(
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
          )
          else null
        end,
        'my_role', case when c.kind = 'GROUP' then cp.role else null end,
        'member_count', case
          when c.kind = 'GROUP' then (
            select count(*)::integer
            from public.conversation_participants gcp
            where gcp.conversation_id = c.id
          )
          else 2
        end,
        'members_preview', case
          when c.kind = 'GROUP' then coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', gm.id,
                'full_name', gm.full_name,
                'avatar_url', gm.avatar_url,
                'allow_online_status', gm.allow_online_status
              )
            )
            from (
              select
                mp.id,
                mp.full_name,
                mp.avatar_url,
                (not public.is_user_blocked_between(v_uid, mp.id) and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)) as allow_online_status
              from public.conversation_participants gcp
              join public.profiles mp on mp.id = gcp.user_id
              where gcp.conversation_id = c.id
                and gcp.user_id <> v_uid
                and mp.status = 'ACTIVE'
              order by gcp.joined_at asc
              limit 4
            ) gm
          ), '[]'::jsonb)
          else '[]'::jsonb
        end,
        'is_pinned', coalesce(cp.is_pinned, false),
        'pinned_at', cp.pinned_at,
        'is_muted', coalesce(cp.is_muted, false),
        'is_archived', coalesce(cp.is_archived, false),
        'marked_unread', coalesce(cp.marked_unread, false),
        'chat_theme', coalesce(cp.chat_theme, 'paper'),
        'last_message_at', coalesce(latest.created_at, c.last_message_at, c.created_at),
        'last_message_type', latest.message_type,
        'last_message_preview', coalesce(
          case
            when latest.id is null then null
            when latest.deleted_for_everyone_at is not null then 'Message removed'
            when char_length(btrim(latest.body)) > 0 then left(latest.body, 140)
            when latest.message_type = 'VOICE' then 'Sent a voice message'
            when latest.message_type = 'CALL_EVENT' then coalesce(latest.metadata ->> 'summary', 'Call activity')
            else 'Sent an attachment'
          end,
          case when c.kind = 'GROUP' then 'No recent messages' else 'Start a conversation' end
        ),
        'last_message_sender_id', coalesce(latest.sender_id, c.last_message_sender_id),
        'last_message_sender_name', sender_p.full_name,
        'unread_count', (
          select count(*)::integer
          from public.messages um
          where um.conversation_id = c.id
            and um.sender_id <> v_uid
            and um.message_type <> 'SYSTEM'
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
    left join public.conversation_participants cp on cp.conversation_id = c.id and cp.user_id = v_uid
    left join public.profiles peer on c.kind = 'DIRECT' and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    left join lateral (
      select m.*
      from public.messages m
      where m.conversation_id = c.id
        and not (v_uid = any(m.deleted_for_user_ids))
        and (cp.deleted_before_at is null or m.created_at > cp.deleted_before_at)
      order by m.created_at desc
      limit 1
    ) latest on true
    left join public.profiles sender_p on sender_p.id = coalesce(latest.sender_id, c.last_message_sender_id)
    where (
      (c.kind = 'GROUP' and cp.user_id = v_uid and cp.hidden_at is null and c.status = 'ACCEPTED')
      or (
        c.kind = 'DIRECT'
        and (c.user_a = v_uid or c.user_b = v_uid)
        and peer.id is not null
        and peer.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and peer.status = 'ACTIVE'
        and cp.hidden_at is null
        and c.status <> 'DECLINED'
        and (latest.id is not null or c.status = 'ACCEPTED')
      )
    )
  ), '[]'::jsonb);
end;
$$;

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
  v_conv_payload jsonb;
  v_group_members jsonb := '[]'::jsonb;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  select chat_privacy into v_me_privacy from public.profiles where id = v_uid;
  select * into v_part from public.conversation_participants where conversation_id = v_conv.id and user_id = v_uid;

  if v_conv.kind = 'DIRECT' then
    v_peer_id := case when v_conv.user_a = v_uid then v_conv.user_b else v_conv.user_a end;
    if not public.is_messaging_eligible(v_peer_id) then
      raise exception 'This user is unavailable.' using errcode = '42501';
    end if;
    select chat_privacy into v_peer_privacy from public.profiles where id = v_peer_id;
    v_share_receipts := v_conv.status = 'ACCEPTED'
      and coalesce((v_me_privacy ->> 'read_receipts')::boolean, true)
      and coalesce((v_peer_privacy ->> 'read_receipts')::boolean, true);

    v_conv_payload := public.get_social_user_profile(v_peer_id) || jsonb_build_object(
      'conversation_id', v_conv.id,
      'kind', 'DIRECT',
      'status', v_conv.status,
      'initiator_id', v_conv.initiator_id,
      'is_muted', coalesce(v_part.is_muted, false),
      'is_pinned', coalesce(v_part.is_pinned, false),
      'is_archived', coalesce(v_part.is_archived, false),
      'chat_theme', coalesce(v_part.chat_theme, 'paper'),
      'receipts_enabled', v_share_receipts
    );
  else
    v_share_receipts := coalesce((v_me_privacy ->> 'read_receipts')::boolean, true);

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', mp.id,
        'full_name', mp.full_name,
        'username', mp.username,
        'avatar_url', mp.avatar_url,
        'role', gcp.role,
        'joined_at', gcp.joined_at,
        'is_friend', (mp.id <> v_uid and public.are_friends(v_uid, mp.id)),
        'is_blocked', (mp.id <> v_uid and public.is_user_blocked_between(v_uid, mp.id)),
        'allow_online_status', (
          mp.id = v_uid
          or (not public.is_user_blocked_between(v_uid, mp.id) and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true))
        ),
        'last_seen_at', case
          when mp.id <> v_uid
               and not public.is_user_blocked_between(v_uid, mp.id)
               and coalesce((mp.chat_privacy ->> 'show_online')::boolean, true)
               and coalesce((mp.chat_privacy ->> 'show_last_seen')::boolean, true)
          then mp.last_seen_at
          else null
        end
      )
      order by
        case gcp.role when 'OWNER' then 1 when 'ADMIN' then 2 else 3 end,
        mp.full_name asc
    ), '[]'::jsonb)
    into v_group_members
    from public.conversation_participants gcp
    join public.profiles mp on mp.id = gcp.user_id
    where gcp.conversation_id = v_conv.id
      and mp.status = 'ACTIVE'
      and mp.role in ('ADMIN', 'TREASURER', 'MEMBER');

    v_conv_payload := jsonb_build_object(
      'id', v_conv.id,
      'conversation_id', v_conv.id,
      'kind', 'GROUP',
      'title', v_conv.title,
      'full_name', v_conv.title,
      'description', v_conv.description,
      'avatar_url', v_conv.avatar_url,
      'created_by', v_conv.created_by,
      'status', v_conv.status,
      'my_role', v_part.role,
      'member_count', jsonb_array_length(v_group_members),
      'members', v_group_members,
      'is_muted', coalesce(v_part.is_muted, false),
      'is_pinned', coalesce(v_part.is_pinned, false),
      'is_archived', coalesce(v_part.is_archived, false),
      'chat_theme', coalesce(v_part.chat_theme, 'paper'),
      'receipts_enabled', v_share_receipts
    );
  end if;

  if p_around_message_id is not null then
    select created_at into v_anchor
    from public.messages
    where id = p_around_message_id and conversation_id = v_conv.id;
  end if;

  select id into v_unread_first_id
  from public.messages um
  where um.conversation_id = v_conv.id
    and um.sender_id <> v_uid
    and um.message_type <> 'SYSTEM'
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
      'conversation', v_conv_payload,
      'has_older', ((select count(*) from visible) > v_lim),
      'unread_first_id', v_unread_first_id,
      'pinned_messages', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pm.id,
            'sender_id', pm.sender_id,
            'sender_name', sp.full_name,
            'body', case when pm.deleted_for_everyone_at is not null then '' else left(pm.body, 140) end,
            'pinned_at', pm.pinned_at,
            'created_at', pm.created_at
          ) order by pm.pinned_at desc
        )
        from public.messages pm
        join public.profiles sp on sp.id = pm.sender_id
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
            'sender_name', sp.full_name,
            'sender_avatar_url', sp.avatar_url,
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
            'delivered_at', case
              when v_conv.kind = 'DIRECT' then (
                select mr.delivered_at from public.message_receipts mr
                where mr.message_id = o.id and mr.user_id = v_peer_id
                limit 1
              )
              when o.sender_id = v_uid then (
                select min(mr.delivered_at) from public.message_receipts mr
                where mr.message_id = o.id and mr.delivered_at is not null
              )
              else null
            end,
            'read_at', case
              when o.sender_id = v_uid and v_share_receipts then
                case
                  when v_conv.kind = 'DIRECT' then (
                    select mr.read_at from public.message_receipts mr
                    where mr.message_id = o.id and mr.user_id = v_peer_id
                    limit 1
                  )
                  else (
                    select min(mr.read_at) from public.message_receipts mr
                    where mr.message_id = o.id and mr.read_at is not null
                  )
                end
              else null
            end,
            'seen_by', case
              when v_conv.kind = 'GROUP' and o.sender_id = v_uid and v_share_receipts then coalesce((
                select jsonb_agg(
                  jsonb_build_object(
                    'id', rp3.id,
                    'full_name', rp3.full_name,
                    'read_at', mr3.read_at
                  ) order by mr3.read_at asc
                )
                from public.message_receipts mr3
                join public.profiles rp3 on rp3.id = mr3.user_id
                where mr3.message_id = o.id
                  and mr3.read_at is not null
              ), '[]'::jsonb)
              else '[]'::jsonb
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
        join public.profiles sp on sp.id = o.sender_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

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
        'kind', c.kind,
        'sender_id', m.sender_id,
        'sender_name', sp.full_name,
        'peer_id', case when c.kind = 'GROUP' then c.id else peer.id end,
        'peer_name', case when c.kind = 'GROUP' then c.title else peer.full_name end,
        'peer_avatar', case when c.kind = 'GROUP' then c.avatar_url else peer.avatar_url end,
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
      where public.is_conversation_member(c.id, v_uid)
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
    left join public.profiles peer on c.kind = 'DIRECT' and peer.id = case when c.user_a = v_uid then c.user_b else c.user_a end
    where (
      c.kind = 'GROUP'
      or (peer.id is not null and peer.role in ('ADMIN', 'TREASURER', 'MEMBER') and not public.is_user_blocked_between(v_uid, peer.id))
    )
  ), '[]'::jsonb);
end;
$$;

-- 6. Preserve exact 90-day chat retention + inactive user purge for group chats
create or replace function public.run_data_retention_cleanup(
  p_message_days integer default 90,
  p_audit_days integer default 90,
  p_read_notif_days integer default 30,
  p_unread_notif_days integer default 90,
  p_call_days integer default 30,
  p_bin_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_message_days, 90), 30));
  v_audit_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_audit_days, 90), 30));
  v_read_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_read_notif_days, 30), 7));
  v_unread_notif_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_unread_notif_days, 90), 30));
  v_call_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_call_days, 30), 7));
  v_bin_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_bin_days, 30), 14));
  v_deleted_messages integer := 0;
  v_deleted_calls integer := 0;
  v_deleted_notifs integer := 0;
  v_deleted_audits integer := 0;
  v_deleted_activity integer := 0;
  v_deleted_throttles integer := 0;
  v_cleaned_receipts integer := 0;
  v_deleted_members integer := 0;
  v_deleted_goals integer := 0;
  v_deleted_announcements integer := 0;
  v_deleted_batches integer := 0;
  v_deleted_suspended_groups integer := 0;
  v_conv_id uuid;
  v_latest record;
  v_expired_ann record;
  v_expired_batch record;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  with purged as (
    delete from public.messages
    where created_at < v_msg_cutoff
    returning conversation_id
  )
  select count(*) into v_deleted_messages from purged;

  if v_deleted_messages > 0 then
    for v_conv_id in
      select c.id
      from public.conversations c
      where c.last_message_at is not null
        and (
          c.last_message_id is null
          or not exists (select 1 from public.messages m where m.id = c.last_message_id)
        )
    loop
      select m.id, m.created_at, m.sender_id,
             case
               when m.deleted_for_everyone_at is not null then 'Message removed'
               when char_length(btrim(m.body)) > 0 then left(btrim(m.body), 140)
               when m.message_type = 'VOICE' then 'Sent a voice message'
               when m.message_type = 'CALL_EVENT' then coalesce(m.metadata ->> 'summary', 'Call activity')
               else 'Sent an attachment'
             end as preview
      into v_latest
      from public.messages m
      where m.conversation_id = v_conv_id
      order by m.created_at desc
      limit 1;

      update public.conversations
      set last_message_id = v_latest.id,
          last_message_at = v_latest.created_at,
          last_message_sender_id = v_latest.sender_id,
          last_message_preview = v_latest.preview
      where id = v_conv_id;
    end loop;
  end if;

  -- Clean up empty orphaned group chats (zero remaining participants)
  delete from public.conversations c
  where c.kind = 'GROUP'
    and not exists (select 1 from public.conversation_participants cp where cp.conversation_id = c.id);

  delete from public.call_sessions
  where coalesce(ended_at, started_at) < v_call_cutoff;
  get diagnostics v_deleted_calls = row_count;

  delete from public.notifications
  where (read_at is not null and read_at < v_read_notif_cutoff)
     or (read_at is null and created_at < v_unread_notif_cutoff);
  get diagnostics v_deleted_notifs = row_count;

  delete from public.audit_logs
  where changed_at < v_audit_cutoff;
  get diagnostics v_deleted_audits = row_count;

  delete from public.account_activity
  where created_at < v_audit_cutoff;
  get diagnostics v_deleted_activity = row_count;

  delete from public.auth_login_throttles
  where updated_at < now() - interval '7 days';
  get diagnostics v_deleted_throttles = row_count;

  with upd_c as (
    update public.contributions
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_msg_cutoff
    returning 1
  ),
  upd_e as (
    update public.expenses
    set receipt_url = null
    where receipt_url is not null
      and approval_status in ('REJECTED', 'VOIDED')
      and coalesce(reviewed_at, voided_at, updated_at, created_at) < v_msg_cutoff
    returning 1
  )
  select (select count(*) from upd_c) + (select count(*) from upd_e) into v_cleaned_receipts;

  delete from public.savings_goals
  where deleted_at is not null
    and deleted_at < v_bin_cutoff;
  get diagnostics v_deleted_goals = row_count;

  for v_expired_ann in
    select id, attachments
    from public.announcements
    where deleted_at is not null
      and deleted_at < v_bin_cutoff
  loop
    perform public.purge_bin_item_storage('announcement', v_expired_ann.attachments);
    delete from public.announcements where id = v_expired_ann.id;
    v_deleted_announcements := v_deleted_announcements + 1;
  end loop;

  for v_expired_batch in
    select id, snapshot
    from public.savings_cycle_batches
    where restored_at is null
      and (expires_at < now() or deleted_at < v_bin_cutoff)
  loop
    perform public.purge_bin_item_storage('savings_cycle', v_expired_batch.snapshot);
    delete from public.savings_cycle_batches where id = v_expired_batch.id;
    v_deleted_batches := v_deleted_batches + 1;
  end loop;

  delete from public.contribution_periods cp
  using public.members m
  where cp.member_id = m.id
    and m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.contribution_period_id = cp.id)
    and not exists (select 1 from public.contribution_periods cp2 join public.contributions c2 on c2.contribution_period_id = cp2.id where cp2.member_id = m.id);

  delete from public.members m
  where m.deleted_at is not null
    and m.deleted_at < v_bin_cutoff
    and not exists (select 1 from public.contribution_periods cp where cp.member_id = m.id);
  get diagnostics v_deleted_members = row_count;

  delete from public.contribution_settings cs
  where exists (
    select 1
    from public.groups g
    where g.id = cs.group_id
      and g.status = 'SUSPENDED'
      and g.owner_id is null
      and g.updated_at < v_bin_cutoff
      and not exists (select 1 from public.contributions c where c.group_id = g.id)
      and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
      and not exists (select 1 from public.expenses e where e.group_id = g.id)
      and not exists (select 1 from public.contribution_periods cp where cp.group_id = g.id)
      and not exists (select 1 from public.savings_goals sg where sg.group_id = g.id)
      and not exists (select 1 from public.savings_cycle_batches sc where sc.group_id = g.id)
      and not exists (select 1 from public.members m where m.group_id = g.id)
  );

  delete from public.groups g
  where g.status = 'SUSPENDED'
    and g.owner_id is null
    and g.updated_at < v_bin_cutoff
    and not exists (select 1 from public.contributions c where c.group_id = g.id)
    and not exists (select 1 from public.withdrawals w where w.group_id = g.id)
    and not exists (select 1 from public.expenses e where e.group_id = g.id)
    and not exists (select 1 from public.contribution_periods cp where cp.group_id = g.id)
    and not exists (select 1 from public.savings_goals sg where sg.group_id = g.id)
    and not exists (select 1 from public.savings_cycle_batches sc where sc.group_id = g.id)
    and not exists (select 1 from public.members m where m.group_id = g.id);
  get diagnostics v_deleted_suspended_groups = row_count;

  return jsonb_build_object(
    'messages_deleted', v_deleted_messages,
    'calls_deleted', v_deleted_calls,
    'notifications_deleted', v_deleted_notifs,
    'audit_logs_deleted', v_deleted_audits,
    'account_activity_deleted', v_deleted_activity,
    'login_throttles_deleted', v_deleted_throttles,
    'receipts_cleaned', v_cleaned_receipts,
    'expired_bin_members_deleted', v_deleted_members,
    'expired_bin_goals_deleted', v_deleted_goals,
    'expired_bin_announcements_deleted', v_deleted_announcements,
    'expired_bin_savings_batches_deleted', v_deleted_batches,
    'abandoned_suspended_groups_deleted', v_deleted_suspended_groups,
    'pending_storage_queue', (select count(*) from public.pending_storage_deletions)
  );
end;
$$;

revoke execute on function public.run_data_retention_cleanup(integer, integer, integer, integer, integer, integer) from public, anon, authenticated;

create or replace function public.purge_inactive_user_data(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof public.profiles%rowtype;
  v_grp record;
  v_chat record;
  v_next_owner uuid;
  v_next_chat_owner uuid;
  v_att jsonb;
begin
  perform set_config('ipon.maintenance_retention_cleanup', 'on', true);

  select * into v_prof from public.profiles where id = p_user_id for update;
  if not found or v_prof.role = 'SUPER_ADMIN' then
    return false;
  end if;

  -- Queue chat attachments belonging to user's DM conversations or uploaded by them
  insert into public.pending_storage_deletions (bucket_id, object_path)
  select coalesce(nullif(ma.bucket_id, ''), 'chat-attachments'), ma.storage_path
  from public.message_attachments ma
  join public.conversations c on c.id = ma.conversation_id
  where c.user_a = p_user_id or c.user_b = p_user_id or ma.uploader_id = p_user_id
  on conflict (bucket_id, object_path) do nothing;

  -- Transfer group chat ownership or clean empty orphaned group chats
  for v_chat in
    select distinct c.id, c.created_by
    from public.conversations c
    join public.conversation_participants cp on cp.conversation_id = c.id
    where c.kind = 'GROUP' and cp.user_id = p_user_id
  loop
    delete from public.conversation_participants where conversation_id = v_chat.id and user_id = p_user_id;

    select cp.user_id into v_next_chat_owner
    from public.conversation_participants cp
    join public.profiles mp on mp.id = cp.user_id
    where cp.conversation_id = v_chat.id
      and mp.status = 'ACTIVE'
    order by
      case cp.role when 'OWNER' then 0 when 'ADMIN' then 1 else 2 end,
      cp.joined_at asc
    limit 1;

    if v_next_chat_owner is not null then
      if v_chat.created_by = p_user_id or not exists (
        select 1 from public.conversation_participants cp2
        where cp2.conversation_id = v_chat.id and cp2.role = 'OWNER'
      ) then
        update public.conversation_participants set role = 'OWNER' where conversation_id = v_chat.id and user_id = v_next_chat_owner;
        update public.conversations set created_by = v_next_chat_owner where id = v_chat.id;
      end if;
    else
      insert into public.pending_storage_deletions (bucket_id, object_path)
      select coalesce(nullif(ma.bucket_id, ''), 'chat-attachments'), ma.storage_path
      from public.message_attachments ma
      where ma.conversation_id = v_chat.id
      on conflict (bucket_id, object_path) do nothing;
      delete from public.conversations where id = v_chat.id;
    end if;
  end loop;

  for v_att in
    select elem
    from public.bug_reports br
    cross join lateral jsonb_array_elements(coalesce(br.attachments, '[]'::jsonb)) elem
    where br.reporter_id = p_user_id
  loop
    perform public.queue_media_url_deletion(coalesce(v_att ->> 'url', v_att ->> 'dataUrl'));
  end loop;

  for v_att in
    select elem
    from public.record_comments rc
    cross join lateral jsonb_array_elements(coalesce(rc.attachments, '[]'::jsonb)) elem
    where rc.author_id = p_user_id
  loop
    perform public.queue_storage_object_deletion('record-comments', v_att ->> 'path');
  end loop;

  perform public.queue_media_url_deletion(v_prof.avatar_url);

  for v_grp in select id, avatar_url, payment_qr_url from public.groups where owner_id = p_user_id loop
    select gm.user_id into v_next_owner
    from public.group_memberships gm
    join public.profiles op on op.id = gm.user_id
    where gm.group_id = v_grp.id
      and gm.user_id <> p_user_id
      and gm.status = 'ACTIVE'
      and op.status = 'ACTIVE'
    order by
      case gm.role when 'ADMIN' then 1 when 'TREASURER' then 2 else 3 end,
      gm.created_at asc
    limit 1;

    if v_next_owner is not null then
      update public.groups set owner_id = v_next_owner where id = v_grp.id;
      update public.group_memberships set role = 'ADMIN' where group_id = v_grp.id and user_id = v_next_owner;
      update public.announcements set author_id = v_next_owner where group_id = v_grp.id and author_id = p_user_id;
    else
      perform public.queue_media_url_deletion(v_grp.avatar_url);
      perform public.queue_media_url_deletion(v_grp.payment_qr_url);
      update public.groups set owner_id = null, status = 'SUSPENDED', avatar_url = null, payment_qr_url = null where id = v_grp.id;
    end if;
  end loop;

  delete from public.group_memberships where user_id = p_user_id;
  delete from public.profiles where id = p_user_id;

  return true;
end;
$$;

revoke execute on function public.purge_inactive_user_data(uuid) from public, anon, authenticated;

-- 7. Tighten grants on all messaging helpers & RPCs
revoke all on function
  public.is_conversation_member(uuid, uuid),
  public.can_send_to_conversation(uuid),
  public.get_conversation_attachment_paths(uuid, text[]),
  public.create_group_chat(text, uuid[], text),
  public.update_group_chat_info(uuid, text, text),
  public.add_group_chat_members(uuid, uuid[]),
  public.update_group_chat_member_role(uuid, uuid, text),
  public.remove_group_chat_member(uuid, uuid),
  public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.delete_chat_message(uuid, text),
  public.toggle_message_reaction(uuid, text),
  public.pin_chat_message(uuid),
  public.mark_messages_delivered(uuid),
  public.mark_conversation_read(uuid),
  public.update_conversation_member_state(uuid, text, text),
  public.get_conversations(),
  public.get_conversation_messages(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages(uuid, text, uuid, integer)
from public, anon;

grant execute on function
  public.is_conversation_member(uuid, uuid),
  public.can_send_to_conversation(uuid),
  public.get_conversation_attachment_paths(uuid, text[]),
  public.create_group_chat(text, uuid[], text),
  public.update_group_chat_info(uuid, text, text),
  public.add_group_chat_members(uuid, uuid[]),
  public.update_group_chat_member_role(uuid, uuid, text),
  public.remove_group_chat_member(uuid, uuid),
  public.send_chat_message(uuid, text, text, uuid, uuid, jsonb, jsonb),
  public.delete_chat_message(uuid, text),
  public.toggle_message_reaction(uuid, text),
  public.pin_chat_message(uuid),
  public.mark_messages_delivered(uuid),
  public.mark_conversation_read(uuid),
  public.update_conversation_member_state(uuid, text, text),
  public.get_conversations(),
  public.get_conversation_messages(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages(uuid, text, uuid, integer)
to authenticated;

insert into public.schema_migrations (version, name)
values ('20261117_105', 'group chats with shared 90-day retention and controls')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
