begin;

create or replace function public.set_conversation_vanish(p_conversation_id uuid, p_seconds integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public.require_messaging_actor();
  v_conv public.conversations%rowtype;
  v_name text;
  v_duration text;
  v_event text;
begin
  if p_seconds is not null and (p_seconds < 1 or p_seconds > 3600) then
    raise exception 'Choose a duration from 1 second to 60 minutes.' using errcode = '22023';
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if v_conv.id is null or not public.is_conversation_member(v_conv.id, v_uid) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  if v_conv.status <> 'ACCEPTED' or (v_conv.kind = 'DIRECT' and v_conv.user_a = v_conv.user_b) then
    raise exception 'Vanishing messages are unavailable in this conversation.' using errcode = '42501';
  end if;
  if v_conv.kind = 'GROUP' and not exists (
    select 1 from public.conversation_participants
    where conversation_id = v_conv.id and user_id = v_uid and role in ('OWNER', 'ADMIN')
  ) then
    raise exception 'Only group owners or admins can change this setting.' using errcode = '42501';
  end if;
  if v_conv.vanish_after_seconds is distinct from p_seconds then
    update public.conversations set vanish_after_seconds = p_seconds where id = v_conv.id;
    select coalesce(nullif(btrim(full_name), ''), 'A member') into v_name
    from public.profiles where id = v_uid;
    v_name := coalesce(v_name, 'A member');
    if p_seconds is null then
      v_event := 'vanish_disabled';
    elsif v_conv.vanish_after_seconds is null then
      v_event := 'vanish_enabled';
    else
      v_event := 'vanish_updated';
    end if;
    if p_seconds is not null then
      v_duration := case when p_seconds % 60 = 0 then
        (p_seconds / 60)::text || case when p_seconds = 60 then ' minute' else ' minutes' end
      else p_seconds::text || case when p_seconds = 1 then ' second' else ' seconds' end end;
    end if;
    insert into public.messages (conversation_id, sender_id, body, message_type, metadata)
    values (v_conv.id, v_uid,
      v_name || case v_event
        when 'vanish_disabled' then ' turned off vanishing messages.'
        when 'vanish_enabled' then ' turned on vanishing messages for ' || v_duration || '.'
        else ' changed vanishing messages to ' || v_duration || '.'
      end,
      'SYSTEM', jsonb_build_object('event', v_event));
  end if;
  return public.get_conversation_protection(v_conv.id);
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261121_151', 'vanish_setting_events')
on conflict (version) do nothing;

notify pgrst, 'reload schema';
commit;
