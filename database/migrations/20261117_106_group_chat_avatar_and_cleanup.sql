begin;

alter table public.conversations drop constraint if exists conversations_avatar_url_check;
alter table public.conversations add constraint conversations_avatar_url_check
  check (public.is_valid_media_reference(avatar_url));

create or replace function public.queue_replaced_media_refs()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('ipon.maintenance_bin_snapshot', true) = 'on'
     and tg_op = 'DELETE'
     and tg_table_name in ('contributions', 'expenses') then
    return old;
  end if;

  if tg_table_name = 'profiles' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
  elsif tg_table_name = 'groups' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
    if old.payment_qr_url is not null and (tg_op = 'DELETE' or new.payment_qr_url is distinct from old.payment_qr_url) then
      perform public.queue_media_url_deletion(old.payment_qr_url);
    end if;
  elsif tg_table_name = 'conversations' then
    if old.avatar_url is not null and (tg_op = 'DELETE' or new.avatar_url is distinct from old.avatar_url) then
      perform public.queue_media_url_deletion(old.avatar_url);
    end if;
  elsif tg_table_name in ('contributions', 'expenses') then
    if old.receipt_url is not null and (tg_op = 'DELETE' or new.receipt_url is distinct from old.receipt_url) then
      perform public.queue_media_url_deletion(old.receipt_url);
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists conversations_queue_media_cleanup on public.conversations;
create trigger conversations_queue_media_cleanup
  after update or delete on public.conversations
  for each row
  execute function public.queue_replaced_media_refs();

drop function if exists public.create_group_chat(text, uuid[], text);
drop function if exists public.update_group_chat_info(uuid, text, text);

create or replace function public.create_group_chat(
  p_title text,
  p_member_ids uuid[],
  p_description text default null,
  p_avatar_url text default null
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
  v_avatar_url text := nullif(btrim(coalesce(p_avatar_url, '')), '');
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
  if not public.is_valid_media_reference(v_avatar_url) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
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
    kind, title, description, avatar_url, created_by, initiator_id, status, accepted_at
  ) values (
    'GROUP', v_title, v_desc, v_avatar_url, v_uid, v_uid, 'ACCEPTED', now()
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
    'avatar_url', v_conv.avatar_url,
    'status', v_conv.status,
    'member_count', array_length(v_member_ids, 1) + 1
  );
end;
$$;

create or replace function public.update_group_chat_info(
  p_conversation_id uuid,
  p_title text default null,
  p_description text default null,
  p_avatar_url text default null,
  p_clear_avatar boolean default false
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
  v_prev_avatar text;
  v_next_title text;
  v_next_desc text;
  v_avatar_input text := nullif(btrim(coalesce(p_avatar_url, '')), '');
  v_next_avatar text;
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
  v_prev_avatar := v_conv.avatar_url;

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

  if not public.is_valid_media_reference(v_avatar_input) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  v_next_avatar := case
    when coalesce(p_clear_avatar, false) then null
    when v_avatar_input is not null then v_avatar_input
    else v_conv.avatar_url
  end;

  update public.conversations
  set title = v_next_title,
      description = v_next_desc,
      avatar_url = v_next_avatar
  where id = v_conv.id
  returning * into v_conv;

  if v_next_title is distinct from v_prev_title
     or v_next_desc is distinct from v_prev_desc
     or v_next_avatar is distinct from v_prev_avatar then
    select full_name into v_actor_name from public.profiles where id = v_uid;
    v_sys_body := case
      when v_next_title is distinct from v_prev_title
        then coalesce(v_actor_name, 'Someone') || ' renamed the group to "' || v_next_title || '"'
      when v_next_avatar is distinct from v_prev_avatar and v_next_avatar is null
        then coalesce(v_actor_name, 'Someone') || ' removed the group photo'
      when v_next_avatar is distinct from v_prev_avatar
        then coalesce(v_actor_name, 'Someone') || ' updated the group photo'
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
    'description', v_conv.description,
    'avatar_url', v_conv.avatar_url
  );
end;
$$;

revoke all on function
  public.create_group_chat(text, uuid[], text, text),
  public.update_group_chat_info(uuid, text, text, text, boolean)
from public, anon;

grant execute on function
  public.create_group_chat(text, uuid[], text, text),
  public.update_group_chat_info(uuid, text, text, text, boolean)
to authenticated;

insert into public.schema_migrations (version, name)
values ('20261117_106', 'group chat avatar url validation upload support and cleanup trigger')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
