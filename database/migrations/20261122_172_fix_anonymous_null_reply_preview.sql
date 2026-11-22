begin;

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
          'last_seen_at', null, 'can_block', false, 'anonymous_enabled', true) end),
      '{messages}', coalesce((
        select jsonb_agg(m || jsonb_build_object('sender_name', 'Anonymous', 'sender_avatar_url', null,
          'sender_app_role', null, 'seen_by', '[]'::jsonb,
          'body', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then to_jsonb('Conversation update'::text) else m -> 'body' end,
          'metadata', case when m ->> 'message_type' in ('SYSTEM', 'CALL_EVENT')
            then '{}'::jsonb else m -> 'metadata' end,
          'reply_preview', case when jsonb_typeof(m -> 'reply_preview') = 'object' then
            (m -> 'reply_preview') || jsonb_build_object('sender_name', 'Anonymous') else null end,
          'reactions', coalesce((select jsonb_agg(r || jsonb_build_object('user_name', 'Anonymous'))
            from jsonb_array_elements(coalesce(m -> 'reactions', '[]'::jsonb)) as x(r)), '[]'::jsonb)) order by ord)
        from jsonb_array_elements(coalesce(v_data -> 'messages', '[]'::jsonb)) with ordinality as x(m, ord)
      ), '[]'::jsonb)) || jsonb_build_object('anonymous_enabled', true,
        'pinned_messages', coalesce((select jsonb_agg(p || jsonb_build_object('sender_name', 'Anonymous'))
          from jsonb_array_elements(coalesce(v_data -> 'pinned_messages', '[]'::jsonb)) as x(p)), '[]'::jsonb));
end;
$$;

revoke all on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) from public, anon;
grant execute on function public.get_conversation_messages(uuid, timestamptz, integer, uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_172', 'fix anonymous mode jsonb null reply_preview turning into ghost User Attachment quote')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
