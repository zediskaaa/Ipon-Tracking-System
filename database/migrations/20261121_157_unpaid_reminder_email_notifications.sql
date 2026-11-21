-- Migration 157: Automatic email notifications for unpaid contribution & savings goal reminders
-- Dispatches branded email notifications alongside in-app notifications via manage-account
-- using atomic emailed_at claiming (zero duplicate emails, automatic rollback on delivery error).

begin;

alter table public.notifications
  add column if not exists emailed_at timestamptz;

-- Mark historical reminders older than 24 hours as already processed so old records never trigger backfill emails
update public.notifications
set emailed_at = created_at
where type in ('CONTRIBUTION_REMINDER', 'GOAL_REMINDER')
  and emailed_at is null
  and created_at < now() - interval '24 hours';

create index if not exists notifications_unpaid_email_pending_idx
  on public.notifications (created_at desc)
  where type in ('CONTRIBUTION_REMINDER', 'GOAL_REMINDER') and emailed_at is null;

create or replace function public.enqueue_unpaid_reminder_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_secret text;
  v_push_url text;
  v_manage_url text;
  v_has_email boolean := false;
begin
  if new.type not in ('CONTRIBUTION_REMINDER', 'GOAL_REMINDER')
     or new.read_at is not null
     or new.emailed_at is not null then
    return new;
  end if;

  select exists (
    select 1
    from public.profiles p
    left join auth.users u on u.id = p.id
    where p.id = new.recipient_id
      and p.status = 'ACTIVE'
      and p.notifications_enabled = true
      and coalesce(nullif(trim(p.email), ''), nullif(trim(u.email), '')) like '%@%.%'
  ) into v_has_email;

  if not coalesce(v_has_email, false) then
    return new;
  end if;

  select value into v_secret
  from public.internal_webhook_config
  where key = 'push_webhook_secret';

  if v_secret is null or v_secret = '' then
    return new;
  end if;

  select value into v_push_url
  from public.internal_webhook_config
  where key = 'send_push_url';

  v_manage_url := coalesce(
    (select nullif(value, '') from public.internal_webhook_config where key = 'manage_account_url'),
    case
      when nullif(v_push_url, '') is not null then regexp_replace(v_push_url, '/send-push/?$', '/manage-account')
      else 'https://woslmwokhhyszkgevnli.supabase.co/functions/v1/manage-account'
    end
  );

  begin
    perform net.http_post(
      url := v_manage_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-webhook-secret', v_secret
      ),
      body := jsonb_build_object(
        'action', 'send-unpaid-reminder-emails',
        'notification_id', new.id,
        'recipient_id', new.recipient_id
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

drop trigger if exists notifications_unpaid_email_dispatch on public.notifications;
create trigger notifications_unpaid_email_dispatch
after insert on public.notifications
for each row
when (new.type in ('CONTRIBUTION_REMINDER', 'GOAL_REMINDER') and new.read_at is null and new.emailed_at is null)
execute function public.enqueue_unpaid_reminder_email();

create or replace function public.dispatch_pending_unpaid_reminder_emails()
returns boolean
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_secret text;
  v_push_url text;
  v_manage_url text;
  v_has_pending boolean := false;
begin
  select exists (
    select 1
    from public.notifications n
    join public.profiles p on p.id = n.recipient_id
    where n.type in ('CONTRIBUTION_REMINDER', 'GOAL_REMINDER')
      and n.read_at is null
      and n.emailed_at is null
      and n.created_at >= now() - interval '24 hours'
      and p.status = 'ACTIVE'
      and p.notifications_enabled = true
  ) into v_has_pending;

  if not coalesce(v_has_pending, false) then
    return false;
  end if;

  select value into v_secret
  from public.internal_webhook_config
  where key = 'push_webhook_secret';

  if v_secret is null or v_secret = '' then
    return false;
  end if;

  select value into v_push_url
  from public.internal_webhook_config
  where key = 'send_push_url';

  v_manage_url := coalesce(
    (select nullif(value, '') from public.internal_webhook_config where key = 'manage_account_url'),
    case
      when nullif(v_push_url, '') is not null then regexp_replace(v_push_url, '/send-push/?$', '/manage-account')
      else 'https://woslmwokhhyszkgevnli.supabase.co/functions/v1/manage-account'
    end
  );

  begin
    perform net.http_post(
      url := v_manage_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-push-webhook-secret', v_secret
      ),
      body := jsonb_build_object(
        'action', 'send-unpaid-reminder-emails',
        'batch', true
      ),
      timeout_milliseconds := 10000
    );
    return true;
  exception when others then
    return false;
  end;
end;
$$;

revoke all on function public.dispatch_pending_unpaid_reminder_emails() from public, anon, authenticated;

-- Keep daily 8:00 AM Asia/Manila cron job creating reminders and sweeping any unsent reminder emails
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ipon-due-reminders') then
      perform cron.alter_job(
        job_id := (select jobid from cron.job where jobname = 'ipon-due-reminders' limit 1),
        schedule := '0 0 * * *',
        command := 'select public.create_due_reminders(); select public.dispatch_pending_unpaid_reminder_emails();'
      );
    else
      perform cron.schedule(
        'ipon-due-reminders',
        '0 0 * * *',
        'select public.create_due_reminders(); select public.dispatch_pending_unpaid_reminder_emails();'
      );
    end if;
  end if;
exception when others then
  null;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261121_157', 'unpaid_reminder_email_notifications')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
