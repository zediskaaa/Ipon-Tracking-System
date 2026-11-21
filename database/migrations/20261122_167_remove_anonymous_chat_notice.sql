begin;

drop trigger if exists conversations_announce_anonymous_enabled on public.conversations;
drop function if exists public.announce_anonymous_chat_enabled();

do $$
declare
  v_conversation_id uuid;
  v_latest public.messages%rowtype;
begin
  for v_conversation_id in
    select distinct conversation_id
    from public.messages
    where message_type = 'SYSTEM' and metadata ->> 'event' = 'anonymous_enabled'
  loop
    delete from public.messages
    where conversation_id = v_conversation_id
      and message_type = 'SYSTEM'
      and metadata ->> 'event' = 'anonymous_enabled';

    select * into v_latest
    from public.messages
    where conversation_id = v_conversation_id
    order by created_at desc
    limit 1;

    update public.conversations
    set last_message_id = v_latest.id,
        last_message_at = v_latest.created_at,
        last_message_preview = case when v_latest.id is null then null else left(v_latest.body, 140) end,
        last_message_sender_id = v_latest.sender_id
    where id = v_conversation_id;
  end loop;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261122_167', 'remove anonymous chat activation notices')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
