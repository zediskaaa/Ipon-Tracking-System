-- Migration 20261116_079: Always dispatch push wakeups when unread deduplicated notifications advance created_at.
begin;

create or replace function public.enqueue_notification_push()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_secret text;
  v_endpoint text;
  v_enabled boolean;
begin
  if new.read_at is not null then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.read_at is null
       and new.title is not distinct from old.title
       and new.message is not distinct from old.message
       and new.link is not distinct from old.link
       and new.created_at is not distinct from old.created_at then
      return new;
    end if;
  end if;

  select p.notifications_enabled into v_enabled
  from public.profiles p
  where p.id = new.recipient_id and p.status = 'ACTIVE';

  if coalesce(v_enabled, false) is not true then
    return new;
  end if;

  select value into v_secret
  from public.internal_webhook_config
  where key = 'push_webhook_secret';

  if v_secret is null or v_secret = '' then
    return new;
  end if;

  select coalesce(
    (select nullif(value, '') from public.internal_webhook_config where key = 'send_push_url'),
    'https://woslmwokhhyszkgevnli.supabase.co/functions/v1/send-push'
  ) into v_endpoint;

  begin
    perform net.http_post(
      url := v_endpoint,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-webhook-secret', v_secret
      ),
      body := jsonb_build_object(
        'notification_id', new.id,
        'recipient_id', new.recipient_id
      ),
      timeout_milliseconds := 5000
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists notifications_push_dispatch on public.notifications;
create trigger notifications_push_dispatch
after insert or update of title, message, link, read_at, created_at on public.notifications
for each row execute function public.enqueue_notification_push();

insert into public.schema_migrations (version, name)
values ('20261116_079', 'dispatch background push whenever unread deduped notification refreshes created_at')
on conflict (version) do nothing;

commit;
