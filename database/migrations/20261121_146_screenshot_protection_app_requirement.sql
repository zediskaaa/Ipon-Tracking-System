begin;

alter table public.profiles
  add column if not exists last_client_platform text not null default 'browser'
    check (last_client_platform in ('browser', 'android_app')),
  add column if not exists last_client_platform_at timestamptz;

create or replace function public.conversation_supports_screenshot_block(
  p_conversation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversations c
    where c.id = p_conversation_id
      and (
        (
          c.kind = 'DIRECT'
          and exists (
            select 1
            from public.profiles pa
            where pa.id = c.user_a
              and coalesce(pa.last_client_platform, 'browser') = 'android_app'
          )
          and exists (
            select 1
            from public.profiles pb
            where pb.id = c.user_b
              and coalesce(pb.last_client_platform, 'browser') = 'android_app'
          )
        )
        or (
          c.kind = 'GROUP'
          and exists (
            select 1
            from public.conversation_participants cp0
            where cp0.conversation_id = c.id
          )
          and not exists (
            select 1
            from public.conversation_participants cp
            left join public.profiles p on p.id = cp.user_id
            where cp.conversation_id = c.id
              and coalesce(p.last_client_platform, 'browser') <> 'android_app'
          )
        )
      )
  );
$$;

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

  if v_platform = 'browser' then
    update public.conversations c
    set block_screenshots = false
    where c.block_screenshots = true
      and (
        (c.kind = 'DIRECT' and (c.user_a = v_uid or c.user_b = v_uid))
        or (
          c.kind = 'GROUP'
          and exists (
            select 1
            from public.conversation_participants cp
            where cp.conversation_id = c.id
              and cp.user_id = v_uid
          )
        )
      );
  end if;

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
    'block_screenshots', (v_conv.block_screenshots and v_eligible),
    'block_forwarding', v_conv.block_forwarding,
    'vanish_after_seconds', v_conv.vanish_after_seconds,
    'screenshot_block_eligible', v_eligible
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
    if coalesce(p_enabled, false) and not public.conversation_supports_screenshot_block(v_conv.id) then
      if v_conv.kind = 'GROUP' then
        raise exception 'Block screenshots requires all members in this chat to use the mobile app.' using errcode = '42501';
      else
        raise exception 'Block screenshots requires both people in this chat to use the mobile app.' using errcode = '42501';
      end if;
    end if;
    update public.conversations set block_screenshots = coalesce(p_enabled, false) where id = v_conv.id;
  elsif p_setting = 'forwarding' then
    update public.conversations set block_forwarding = coalesce(p_enabled, false) where id = v_conv.id;
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
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and not (c.block_screenshots and public.conversation_supports_screenshot_block(c.id))
      and public.is_conversation_member(c.id, v_uid)
  ) then
    raise exception 'Conversation is unavailable for screenshots.' using errcode = '42501';
  end if;
  select full_name into v_name from public.profiles where id = v_uid;
  insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
  values (p_conversation_id, v_uid, coalesce(nullif(v_name, ''), 'A member') || ' took a screenshot.', 'SYSTEM', jsonb_build_object('event', 'screenshot_taken'))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.conversation_supports_screenshot_block(uuid), public.report_client_platform(text), public.get_conversation_protection(uuid), public.set_conversation_protection(uuid, text, boolean), public.record_conversation_screenshot(uuid) from public, anon;
grant execute on function public.report_client_platform(text), public.get_conversation_protection(uuid), public.set_conversation_protection(uuid, text, boolean), public.record_conversation_screenshot(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_146', 'screenshot_protection_app_requirement')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
