begin;

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

insert into public.schema_migrations (version, name)
values ('20261122_169', 'mask named vanishing message previews in anonymous chats')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
