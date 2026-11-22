-- ============================================================
-- Migration 20261123_183: Fix delete_for_everyone attachment & notification columns
-- ============================================================
-- Fixes two schema mismatches introduced in 20261123_182 inside
-- public.update_conversation_member_state ('delete_for_everyone'):
--   1. Chat attachments live in public.message_attachments (storage_path, bucket_id),
--      not a m.attachments JSONB column on public.messages.
--   2. public.notifications uses recipient_id, not user_id.
-- Also clears last_read_message_id on conversation_participants when wiping a thread.

begin;

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
  v_own_paths jsonb := '[]'::jsonb;
  v_now timestamptz := now();
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = 'P0002';
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv.id, v_uid)
  on conflict (conversation_id, user_id) do nothing;

  select * into v_part
  from public.conversation_participants
  where conversation_id = v_conv.id and user_id = v_uid
  for update;

  if v_act = 'pin' then
    update public.conversation_participants
    set is_pinned = true, pinned_at = v_now
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'unpin' then
    update public.conversation_participants
    set is_pinned = false, pinned_at = null
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'mute' then
    update public.conversation_participants
    set is_muted = true
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'unmute' then
    update public.conversation_participants
    set is_muted = false
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'archive' then
    update public.conversation_participants
    set is_archived = true, is_pinned = false, pinned_at = null
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'unarchive' then
    update public.conversation_participants
    set is_archived = false
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'mark_unread' then
    update public.conversation_participants
    set marked_unread = true
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'mark_read' then
    return public.mark_conversation_read(v_conv.id);
  elsif v_act = 'delete_for_me' then
    update public.conversation_participants
    set deleted_before_at = v_now,
        hidden_at = v_now,
        is_pinned = false,
        pinned_at = null,
        is_archived = false,
        marked_unread = false
    where conversation_id = v_conv.id and user_id = v_uid;
  elsif v_act = 'delete_for_everyone' then
    if v_conv.kind = 'GROUP' and coalesce(v_part.role, 'MEMBER') not in ('OWNER', 'ADMIN') then
      raise exception 'Only group owners or admins can delete a group conversation for everyone.' using errcode = '42501';
    end if;

    -- Collect actor-owned attachment paths for immediate storage cleanup and queue ALL paths for permanent cloud purge.
    select coalesce(jsonb_agg(distinct btrim(ma.storage_path)), '[]'::jsonb)
    into v_own_paths
    from public.message_attachments ma
    where ma.conversation_id = v_conv.id
      and coalesce(btrim(ma.storage_path), '') <> ''
      and position('/' || v_uid::text || '/' in btrim(ma.storage_path)) > 0;

    insert into public.pending_storage_deletions (bucket_id, object_path)
    select distinct coalesce(nullif(btrim(ma.bucket_id), ''), 'chat-attachments'), btrim(ma.storage_path)
    from public.message_attachments ma
    where ma.conversation_id = v_conv.id
      and coalesce(btrim(ma.storage_path), '') <> ''
    on conflict (bucket_id, object_path) do nothing;

    -- Remove linked chat notifications for all participants.
    delete from public.notifications n
    where n.recipient_id in (
      select cp.user_id from public.conversation_participants cp where cp.conversation_id = v_conv.id
      union select v_conv.user_a where v_conv.user_a is not null
      union select v_conv.user_b where v_conv.user_b is not null
    )
      and (
        n.link like '%' || v_conv.id::text || '%'
        or n.dedupe_key like '%' || v_conv.id::text || '%'
        or exists (
          select 1 from public.messages m
          where m.conversation_id = v_conv.id
            and n.link like '%msg=' || m.id::text
        )
      );

    -- Permanently erase all messages (cascading attachments, reactions, and receipts).
    delete from public.messages where conversation_id = v_conv.id;

    -- Reset conversation summary and any active anonymous session.
    update public.conversations
    set last_message_id = null,
        last_message_at = null,
        last_message_preview = null,
        last_message_sender_id = null,
        anonymous_session_id = null,
        updated_at = v_now
    where id = v_conv.id;

    -- Ensure every participant row exists, then clear & hide for everyone (triggers Realtime sync for peer).
    if v_conv.kind = 'DIRECT' then
      insert into public.conversation_participants (conversation_id, user_id)
      select v_conv.id, u_id
      from (values (v_conv.user_a), (v_conv.user_b)) as t(u_id)
      where u_id is not null
      on conflict (conversation_id, user_id) do nothing;
    end if;

    update public.conversation_participants
    set deleted_before_at = v_now,
        hidden_at = v_now,
        last_read_message_id = null,
        is_pinned = false,
        pinned_at = null,
        is_archived = false,
        marked_unread = false
    where conversation_id = v_conv.id;
  elsif v_act = 'theme' then
    if coalesce(p_theme, 'paper') not in ('paper', 'emerald', 'sage', 'sand', 'midnight') then
      raise exception 'Unsupported chat theme.' using errcode = '22023';
    end if;
    update public.conversation_participants
    set chat_theme = p_theme
    where conversation_id = v_conv.id and user_id = v_uid;
  else
    raise exception 'Unknown conversation action.' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'conversation_id', v_conv.id,
    'action', v_act,
    'removed_paths', coalesce(v_own_paths, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.update_conversation_member_state(uuid, text, text) from public, anon;
grant execute on function public.update_conversation_member_state(uuid, text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261123_183', 'fix message_attachments and notifications recipient_id columns in delete_for_everyone')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
