begin;

create or replace function public.set_anonymous_chat(p_conversation_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_latest public.messages%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.status <> 'ACCEPTED'
     or v_conv.kind not in ('DIRECT', 'GROUP')
     or (v_conv.kind = 'DIRECT' and v_conv.user_a = v_conv.user_b)
     or not public.is_conversation_member(p_conversation_id, v_uid) then
    raise exception 'Anonymous mode is available only in accepted conversations.' using errcode = '42501';
  end if;
  if v_conv.kind = 'GROUP' and not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_conv.id and user_id = v_uid and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Only group owners or admins can change chat privacy.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Choose whether to enable anonymous mode.' using errcode = '22023';
  end if;
  if p_enabled and v_conv.anonymous_session_id is null then
    update public.conversations set anonymous_session_id = gen_random_uuid() where id = v_conv.id;
  elsif not p_enabled and v_conv.anonymous_session_id is not null then
    delete from public.notifications n using public.messages m
    where m.conversation_id = v_conv.id
      and m.anonymous_session_id = v_conv.anonymous_session_id
      and n.link like '%msg=' || m.id::text;
    delete from public.messages
    where conversation_id = v_conv.id and anonymous_session_id = v_conv.anonymous_session_id;
    select * into v_latest from public.messages
    where conversation_id = v_conv.id and deleted_for_everyone_at is null
    order by created_at desc limit 1;
    update public.conversations set
      anonymous_session_id = null,
      last_message_id = v_latest.id,
      last_message_at = v_latest.created_at,
      last_message_preview = case when v_latest.id is null then null else left(v_latest.body, 140) end,
      last_message_sender_id = v_latest.sender_id
    where id = v_conv.id;
  end if;
  return jsonb_build_object('anonymous_enabled', p_enabled);
end;
$$;

create or replace function public.get_anonymous_chat_state(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_messaging_actor(); v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  return jsonb_build_object('anonymous_enabled', v_conv.anonymous_session_id is not null);
end;
$$;

create or replace function public.get_conversations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    case when c.anonymous_session_id is not null then
      jsonb_set(
        jsonb_set(
          case when c.kind = 'GROUP' then
            jsonb_set(item, '{members_preview}', '[]'::jsonb) || jsonb_build_object('avatar_url', null)
          else jsonb_set(item, '{peer}', coalesce(item -> 'peer', '{}'::jsonb) ||
            jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
              'social_links', '{}'::jsonb, 'allow_online_status', false, 'last_seen_at', null)) end,
          '{last_message_sender_name}', to_jsonb('Anonymous'::text)),
        '{last_message_preview}', case
          when item ->> 'last_message_type' in ('SYSTEM', 'CALL_EVENT')
            then to_jsonb('Conversation update'::text)
          when item ->> 'last_message_preview' ~ ' set a message\.$'
            then to_jsonb('Vanishing message'::text)
          else item -> 'last_message_preview' end) ||
        jsonb_build_object('anonymous_enabled', true)
    else item || jsonb_build_object('anonymous_enabled', false) end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(public.get_conversations_unmasked()) with ordinality as x(item, ord)
  join public.conversations c on c.id = (item ->> 'id')::uuid;
$$;

create or replace function public.get_conversation_messages(
  p_conversation_id uuid, p_before timestamptz default null,
  p_limit integer default 60, p_around_message_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_data jsonb; v_enabled boolean; v_group boolean;
begin
  v_data := public.get_conversation_messages_unmasked(p_conversation_id, p_before, p_limit, p_around_message_id);
  select anonymous_session_id is not null, kind = 'GROUP' into v_enabled, v_group
  from public.conversations where id = p_conversation_id;
  if not coalesce(v_enabled, false) then return v_data || jsonb_build_object('anonymous_enabled', false); end if;
  return jsonb_set(
    jsonb_set(v_data,
      '{conversation}', (v_data -> 'conversation') ||
        case when v_group then jsonb_build_object(
          'members', '[]'::jsonb, 'created_by', null, 'avatar_url', null, 'anonymous_enabled', true)
        else jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
          'bio', null, 'social_links', '{}'::jsonb, 'allow_online_status', false,
          'last_seen_at', null, 'anonymous_enabled', true) end),
      '{messages}', coalesce((
        select jsonb_agg(m || jsonb_build_object('sender_name', 'Anonymous', 'sender_avatar_url', null,
          'sender_app_role', null, 'seen_by', '[]'::jsonb,
          'body', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then to_jsonb('Conversation update'::text) else m -> 'body' end,
          'metadata', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then '{}'::jsonb else m -> 'metadata' end,
          'reply_preview', case when m -> 'reply_preview' is not null then
            (m -> 'reply_preview') || jsonb_build_object('sender_name', 'Anonymous') else null end,
          'reactions', coalesce((select jsonb_agg(r || jsonb_build_object('user_name', 'Anonymous'))
            from jsonb_array_elements(coalesce(m -> 'reactions', '[]'::jsonb)) as x(r)), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(coalesce(v_data -> 'messages', '[]'::jsonb)) with ordinality as x(m, ord)
      ), '[]'::jsonb)) || jsonb_build_object('anonymous_enabled', true,
        'pinned_messages', coalesce((select jsonb_agg(p || jsonb_build_object('sender_name', 'Anonymous'))
          from jsonb_array_elements(coalesce(v_data -> 'pinned_messages', '[]'::jsonb)) as x(p)), '[]'::jsonb));
end;
$$;

create or replace function public.mask_anonymous_chat_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := substring(coalesce(new.link, '') from '[?&]chat=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
  if v_id is not null and exists (select 1 from public.conversations
    where id = v_id::uuid and anonymous_session_id is not null) then
    new.title := 'Anonymous';
    new.message := 'Conversation update';
    new.actor_id := null;
    new.actor_avatar_url := null;
  end if;
  return new;
end;
$$;

create or replace function public.mask_existing_anonymous_chat_notifications()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.anonymous_session_id is null and new.anonymous_session_id is not null then
    update public.notifications
    set title = 'Anonymous', message = 'Conversation update',
        actor_id = null, actor_avatar_url = null
    where substring(coalesce(link, '') from '[?&]chat=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') = new.id::text;
  end if;
  return new;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261122_170', 'anonymous group chats with shared privacy and session cleanup')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
