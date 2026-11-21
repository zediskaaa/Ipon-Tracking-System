begin;

create or replace function public.report_client_platform(
  p_platform text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_platform text := lower(trim(coalesce(p_platform, '')));
begin
  if v_uid is null then
    return 'browser';
  end if;
  if v_platform not in ('browser', 'android_app') then
    raise exception 'Invalid client platform.' using errcode = '22023';
  end if;

  update public.profiles
  set last_client_platform = v_platform,
      last_client_platform_at = now()
  where id = v_uid
    and (
      last_client_platform is distinct from v_platform
      or last_client_platform_at is null
      or last_client_platform_at < now() - interval '5 minutes'
    );

  return v_platform;
end;
$$;

create or replace function public.get_conversation_protection(
  p_conversation_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conv public.conversations%rowtype;
  v_eligible boolean;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, public.require_messaging_actor()) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  v_eligible := public.conversation_supports_screenshot_block(v_conv.id);
  return jsonb_build_object(
    'block_screenshots', v_conv.block_screenshots,
    'block_forwarding', v_conv.block_forwarding,
    'vanish_after_seconds', v_conv.vanish_after_seconds,
    'screenshot_block_eligible', v_eligible,
    'screenshot_notices_enabled', v_conv.screenshot_notices_enabled
  );
end;
$$;

create or replace function public.set_conversation_protection(
  p_conversation_id uuid,
  p_setting text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_next_enabled boolean := coalesce(p_enabled, false);
  v_name text;
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
    if v_next_enabled and not public.conversation_supports_screenshot_block(v_conv.id) then
      if v_conv.kind = 'GROUP' then
        raise exception 'Block screenshots requires all members in this chat to use the mobile app.' using errcode = '42501';
      else
        raise exception 'Block screenshots requires both people in this chat to use the mobile app.' using errcode = '42501';
      end if;
    end if;
    if v_conv.block_screenshots is distinct from v_next_enabled then
      update public.conversations set block_screenshots = v_next_enabled where id = v_conv.id;
      select coalesce(nullif(btrim(full_name), ''), 'A member') into v_name
      from public.profiles where id = v_uid;
      v_name := coalesce(v_name, 'A member');
      insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
      values (
        v_conv.id,
        v_uid,
        v_name || case when v_next_enabled then ' turned on screenshot blocking' else ' turned off screenshot blocking' end,
        'SYSTEM',
        jsonb_build_object('event', case when v_next_enabled then 'screenshot_block_enabled' else 'screenshot_block_disabled' end)
      );
    end if;
  elsif p_setting = 'screenshot_notices' then
    if v_conv.kind <> 'GROUP' then
      raise exception 'Screenshot notices can only be changed for group chats.' using errcode = '22023';
    end if;
    update public.conversations set screenshot_notices_enabled = v_next_enabled where id = v_conv.id;
  elsif p_setting = 'forwarding' then
    update public.conversations set block_forwarding = v_next_enabled where id = v_conv.id;
  else
    raise exception 'Invalid chat privacy setting.' using errcode = '22023';
  end if;
  return public.get_conversation_protection(v_conv.id);
end;
$$;

create or replace function public.record_conversation_screenshot(
  p_conversation_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_name text;
  v_id uuid;
  v_conv public.conversations%rowtype;
begin
  select * into v_conv from public.conversations where id = p_conversation_id;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid)
    or v_conv.block_screenshots then
    raise exception 'Conversation is unavailable for screenshots.' using errcode = '42501';
  end if;
  if v_conv.kind = 'GROUP' and not v_conv.screenshot_notices_enabled then
    return null;
  end if;
  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (p_conversation_id, v_uid, coalesce(nullif(trim(v_name), ''), 'A member') || ' took a screenshot.', 'SYSTEM', jsonb_build_object('event', 'screenshot_taken'))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.report_client_platform(text), public.get_conversation_protection(uuid), public.set_conversation_protection(uuid, text, boolean), public.record_conversation_screenshot(uuid) from public, anon;
grant execute on function public.report_client_platform(text), public.get_conversation_protection(uuid), public.set_conversation_protection(uuid, text, boolean), public.record_conversation_screenshot(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_152', 'screenshot_block_notices_and_persistence')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
