begin;

-- Upsert missing message_receipts rows in mark_conversation_read so every messaging-eligible
-- group chat participant (including late joiners and the creator account) always records read_at.
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

  insert into public.message_receipts (message_id, user_id, delivered_at, read_at)
  select
    m.id,
    v_uid,
    now(),
    case when v_allow_receipts then now() else null end
  from public.messages m
  where m.conversation_id = v_conv.id
    and m.sender_id <> v_uid
    and m.deleted_for_everyone_at is null
    and (m.vanish_at is null or m.vanish_at > now())
  on conflict (message_id, user_id) do update
  set delivered_at = coalesce(public.message_receipts.delivered_at, excluded.delivered_at),
      read_at = case
        when v_allow_receipts then coalesce(public.message_receipts.read_at, excluded.read_at)
        else public.message_receipts.read_at
      end
  where public.message_receipts.delivered_at is null
     or (v_allow_receipts and public.message_receipts.read_at is null);

  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and read_at is null
    and type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_ACCEPTED', 'SOCIAL_MESSAGE_REQUEST')
    and (link like '%' || v_conv.id::text || '%' or dedupe_key like '%' || v_conv.id::text || '%');

  return jsonb_build_object('read_at', now(), 'receipts_shared', v_allow_receipts);
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261122_180', 'upsert missing message receipts in mark_conversation_read for all group chat members')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
