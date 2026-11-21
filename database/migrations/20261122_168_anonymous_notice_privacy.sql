begin;

create or replace function public.stamp_anonymous_chat_message()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select anonymous_session_id into new.anonymous_session_id
  from public.conversations where id = new.conversation_id for share;
  if new.forwarded_from_id is not null and (
    new.anonymous_session_id is not null or exists (
      select 1 from public.messages where id = new.forwarded_from_id and anonymous_session_id is not null
    )
  ) then
    raise exception 'Anonymous chat messages cannot be forwarded.' using errcode = '42501';
  end if;
  if new.anonymous_session_id is not null and new.message_type in ('SYSTEM', 'CALL_EVENT') then
    new.body := 'Conversation update';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) - 'summary';
  end if;
  return new;
end;
$$;

-- System and call notices may contain a member's real name in their body or summary.
create or replace function public.get_conversations()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(
    case when c.anonymous_session_id is not null and item ->> 'kind' = 'DIRECT' then
      jsonb_set(
        jsonb_set(
          jsonb_set(item, '{peer}', coalesce(item -> 'peer', '{}'::jsonb) ||
            jsonb_build_object('full_name', 'Anonymous', 'username', null, 'avatar_url', null,
              'social_links', '{}'::jsonb, 'allow_online_status', false, 'last_seen_at', null)),
          '{last_message_sender_name}', to_jsonb('Anonymous'::text)),
        '{last_message_preview}', case when item ->> 'last_message_type' in ('SYSTEM', 'CALL_EVENT')
          then to_jsonb('Conversation update'::text) else item -> 'last_message_preview' end) ||
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

-- Cover every notification linked to an anonymous direct chat, including old notices.
create or replace function public.mask_anonymous_chat_notification()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id text;
begin
  v_id := substring(coalesce(new.link, '') from '[?&]chat=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})');
  if v_id is not null and exists (select 1 from public.conversations
    where id = v_id::uuid and kind = 'DIRECT' and anonymous_session_id is not null) then
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
  if old.anonymous_session_id is null and new.anonymous_session_id is not null and new.kind = 'DIRECT' then
    update public.notifications
    set title = 'Anonymous', message = 'Conversation update',
        actor_id = null, actor_avatar_url = null
    where substring(coalesce(link, '') from '[?&]chat=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') = new.id::text;
  end if;
  return new;
end;
$$;
drop trigger if exists conversations_mask_anonymous_notifications on public.conversations;
create trigger conversations_mask_anonymous_notifications after update of anonymous_session_id on public.conversations
  for each row execute function public.mask_existing_anonymous_chat_notifications();

-- Also redact notices for conversations that are already anonymous at deployment.
update public.notifications n
set title = 'Anonymous', message = 'Conversation update',
    actor_id = null, actor_avatar_url = null
from public.conversations c
where c.kind = 'DIRECT' and c.anonymous_session_id is not null
  and substring(coalesce(n.link, '') from '[?&]chat=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') = c.id::text;

insert into public.schema_migrations (version, name)
values ('20261122_168', 'mask notices and notifications in anonymous chats')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
