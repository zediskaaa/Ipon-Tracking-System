begin;

create or replace function public.ack_message_notifications_by_token(
  p_token uuid,
  p_notification_ids bigint[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  if p_token is null or p_notification_ids is null or cardinality(p_notification_ids) > 32 then
    return 0;
  end if;

  update public.message_receipts mr
  set delivered_at = now()
  from public.messages m
  join public.notifications n on n.id = any(p_notification_ids)
  join public.notification_feed_tokens ft on ft.user_id = n.recipient_id and ft.token = p_token
  join public.profiles p on p.id = ft.user_id
  where mr.message_id = m.id
    and mr.user_id = ft.user_id
    and mr.delivered_at is null
    and m.deleted_for_everyone_at is null
    and m.conversation_id::text = substring(n.link from '[?&]chat=([0-9a-fA-F-]{36})')
    and m.created_at <= n.created_at
    and n.type in ('SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST')
    and p.status = 'ACTIVE'
    and p.notifications_enabled;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke execute on function public.ack_message_notifications_by_token(uuid, bigint[]) from public;
grant execute on function public.ack_message_notifications_by_token(uuid, bigint[]) to anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261120_135', 'acknowledge delivered chat messages after Android notification display')
on conflict (version) do nothing;

commit;
