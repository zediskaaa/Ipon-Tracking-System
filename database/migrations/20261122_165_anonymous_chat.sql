begin;

alter table public.conversations
  add column if not exists anonymous_session_id uuid;
alter table public.messages
  add column if not exists anonymous_session_id uuid;
create index if not exists messages_anonymous_session_idx
  on public.messages (conversation_id, anonymous_session_id)
  where anonymous_session_id is not null;

create or replace function public.stamp_anonymous_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The shared row lock serializes sends with turning anonymous mode off.
  select anonymous_session_id into new.anonymous_session_id
  from public.conversations where id = new.conversation_id for share;
  if new.forwarded_from_id is not null and (
    new.anonymous_session_id is not null or exists (
      select 1 from public.messages where id = new.forwarded_from_id and anonymous_session_id is not null
    )
  ) then
    raise exception 'Anonymous chat messages cannot be forwarded.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_stamp_anonymous_session on public.messages;
create trigger messages_stamp_anonymous_session before insert on public.messages
  for each row execute function public.stamp_anonymous_chat_message();

create or replace function public.set_anonymous_chat(p_conversation_id uuid, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_latest public.messages%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or v_conv.kind <> 'DIRECT' or v_conv.user_a = v_conv.user_b
     or v_conv.status <> 'ACCEPTED' or v_uid not in (v_conv.user_a, v_conv.user_b) then
    raise exception 'Anonymous mode is available only in accepted direct chats.' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'Choose whether to enable anonymous mode.' using errcode = '22023';
  end if;
  if p_enabled and v_conv.anonymous_session_id is null then
    update public.conversations set anonymous_session_id = gen_random_uuid() where id = v_conv.id;
  elsif not p_enabled and v_conv.anonymous_session_id is not null then
    -- Attachment deletion cascades to the existing Storage cleanup queue.
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

create or replace function public.mask_anonymous_chat_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  if new.type not in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY') then return new; end if;
  v_id := split_part(split_part(coalesce(new.link, ''), 'chat=', 2), '&', 1);
  if v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and exists (select 1 from public.conversations
       where id = v_id::uuid and anonymous_session_id is not null) then
    new.title := 'Anonymous';
    new.message := 'New message in anonymous chat';
    new.actor_id := null;
    new.actor_avatar_url := null;
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_mask_anonymous_chat on public.notifications;
create trigger notifications_mask_anonymous_chat before insert or update on public.notifications
  for each row execute function public.mask_anonymous_chat_notification();

create or replace function public.get_anonymous_chat_state(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := public.require_messaging_actor(); v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  return jsonb_build_object('anonymous_enabled',
    v_conv.kind = 'DIRECT' and v_conv.anonymous_session_id is not null);
end;
$$;

alter function public.get_conversation_protection(uuid) rename to get_conversation_protection_unmasked;
create function public.get_conversation_protection(p_conversation_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.get_conversation_protection_unmasked(p_conversation_id)
    || public.get_anonymous_chat_state(p_conversation_id);
$$;
revoke all on function public.get_conversation_protection_unmasked(uuid) from public, anon, authenticated;
revoke all on function public.get_conversation_protection(uuid) from public, anon;
grant execute on function public.get_conversation_protection(uuid) to authenticated;

alter function public.get_conversations() rename to get_conversations_unmasked;
create function public.get_conversations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    case when c.anonymous_session_id is not null and item ->> 'kind' = 'DIRECT' then
      jsonb_set(
        jsonb_set(item, '{peer}', coalesce(item -> 'peer', '{}'::jsonb) ||
          jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
            'social_links', '{}'::jsonb, 'allow_online_status', false, 'last_seen_at', null)),
        '{last_message_sender_name}', to_jsonb('Anonymous'::text)) ||
        jsonb_build_object('anonymous_enabled', true)
    else item || jsonb_build_object('anonymous_enabled', false) end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(public.get_conversations_unmasked()) with ordinality as x(item, ord)
  join public.conversations c on c.id = (item ->> 'id')::uuid;
$$;

alter function public.get_conversation_messages(uuid, timestamptz, integer, uuid)
  rename to get_conversation_messages_unmasked;
create function public.get_conversation_messages(
  p_conversation_id uuid, p_before timestamptz default null,
  p_limit integer default 60, p_around_message_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_data jsonb; v_enabled boolean;
begin
  v_data := public.get_conversation_messages_unmasked(p_conversation_id, p_before, p_limit, p_around_message_id);
  select anonymous_session_id is not null into v_enabled
  from public.conversations where id = p_conversation_id;
  if not coalesce(v_enabled, false) then return v_data || jsonb_build_object('anonymous_enabled', false); end if;
  return jsonb_set(
    jsonb_set(v_data,
      '{conversation}', (v_data -> 'conversation') ||
        jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
          'bio', null, 'social_links', '{}'::jsonb, 'allow_online_status', false,
          'last_seen_at', null, 'anonymous_enabled', true)),
      '{messages}', coalesce((
        select jsonb_agg(m || jsonb_build_object('sender_name', 'Anonymous', 'sender_avatar_url', null,
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

alter function public.search_conversation_messages(uuid, text, uuid, integer)
  rename to search_conversation_messages_unmasked;
create function public.search_conversation_messages(
  p_conversation_id uuid default null, p_query text default '',
  p_sender_id uuid default null, p_limit integer default 40
) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    case when c.anonymous_session_id is not null then
      hit || jsonb_build_object('sender_name', 'Anonymous', 'peer_name', 'Anonymous', 'peer_avatar', null, 'anonymous_enabled', true)
    else hit end order by ord), '[]'::jsonb)
  from jsonb_array_elements(public.search_conversation_messages_unmasked(
    p_conversation_id, p_query, p_sender_id, p_limit)) with ordinality as x(hit, ord)
  join public.conversations c on c.id = (hit ->> 'conversation_id')::uuid;
$$;

revoke all on function public.get_conversations_unmasked(),
  public.get_conversation_messages_unmasked(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages_unmasked(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_conversations(),
  public.get_conversation_messages(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages(uuid, text, uuid, integer) from public, anon;
grant execute on function public.get_conversations(),
  public.get_conversation_messages(uuid, timestamptz, integer, uuid),
  public.search_conversation_messages(uuid, text, uuid, integer) to authenticated;

revoke all on function public.set_anonymous_chat(uuid, boolean), public.get_anonymous_chat_state(uuid) from public, anon;
grant execute on function public.set_anonymous_chat(uuid, boolean), public.get_anonymous_chat_state(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_165', 'anonymous direct chat sessions with message deletion')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
