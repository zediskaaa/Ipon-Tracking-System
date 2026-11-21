begin;

create or replace function public.announce_anonymous_chat_enabled()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null or v_uid not in (new.user_a, new.user_b) then
    raise exception 'Conversation member required.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(full_name), ''), 'A member') into v_name
  from public.profiles where id = v_uid;
  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (
    new.id, v_uid, coalesce(v_name, 'A member') || ' turned on anonymous chat.',
    'SYSTEM', jsonb_build_object('event', 'anonymous_enabled')
  );
  return new;
end;
$$;

drop trigger if exists conversations_announce_anonymous_enabled on public.conversations;
create trigger conversations_announce_anonymous_enabled
after update of anonymous_session_id on public.conversations
for each row when (old.anonymous_session_id is null and new.anonymous_session_id is not null)
execute function public.announce_anonymous_chat_enabled();

insert into public.schema_migrations (version, name)
values ('20261122_166', 'show anonymous chat enabled notice')
on conflict (version) do nothing;
notify pgrst, 'reload schema';
commit;
