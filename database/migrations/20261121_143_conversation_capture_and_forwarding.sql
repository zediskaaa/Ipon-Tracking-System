begin;

alter table public.conversations
  add column if not exists block_screenshots boolean not null default false,
  add column if not exists block_forwarding boolean not null default false;

create or replace function public.get_conversation_protection(p_conversation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, public.require_messaging_actor()) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  return jsonb_build_object('block_screenshots', v_conv.block_screenshots, 'block_forwarding', v_conv.block_forwarding);
end;
$$;

create or replace function public.set_conversation_protection(p_conversation_id uuid, p_setting text, p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  if v_conv.kind = 'GROUP' and not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_conv.id and user_id = v_uid and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Only group owners or admins can change chat privacy.' using errcode = '42501';
  end if;
  if p_setting = 'screenshots' then
    update public.conversations set block_screenshots = coalesce(p_enabled, false) where id = v_conv.id;
  elsif p_setting = 'forwarding' then
    update public.conversations set block_forwarding = coalesce(p_enabled, false) where id = v_conv.id;
  else
    raise exception 'Invalid chat privacy setting.' using errcode = '22023';
  end if;
  return public.get_conversation_protection(v_conv.id);
end;
$$;

create or replace function public.record_conversation_screenshot(p_conversation_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_name text;
  v_id uuid;
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id and not c.block_screenshots
      and public.is_conversation_member(c.id, v_uid)
  ) then
    raise exception 'Conversation is unavailable for screenshots.' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (p_conversation_id, v_uid, coalesce(nullif(v_name, ''), 'A member') || ' took a screenshot.', 'SYSTEM', jsonb_build_object('event', 'SCREENSHOT'))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.reject_protected_message_forward()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.forwarded_from_id is not null and exists (
    select 1 from public.messages source
    join public.conversations c on c.id = source.conversation_id
    where source.id = new.forwarded_from_id and c.block_forwarding
  ) then
    raise exception 'Forwarding is disabled in the original conversation.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists messages_protected_forward on public.messages;
create trigger messages_protected_forward before insert or update of forwarded_from_id on public.messages
  for each row execute function public.reject_protected_message_forward();

revoke all on function public.get_conversation_protection(uuid), public.set_conversation_protection(uuid,text,boolean), public.record_conversation_screenshot(uuid) from public, anon;
grant execute on function public.get_conversation_protection(uuid), public.set_conversation_protection(uuid,text,boolean), public.record_conversation_screenshot(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_143', 'conversation_capture_and_forwarding')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
