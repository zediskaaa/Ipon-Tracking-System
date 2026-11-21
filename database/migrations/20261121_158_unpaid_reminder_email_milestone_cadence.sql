-- Migration 158: Ultra-tipid milestone warning cadence for unpaid reminder emails (Brevo quota saver)
-- Keeps daily in-app reminders unchanged while restricting email alerts to key warning milestones:
--   - Contributions: 3 days before due date, on the due date (0d), 1 day overdue (-1d), then every 7 days while overdue (-7d, -14d, -21d...)
--   - Savings goals: at most once every 7 days per goal while unpaid carry-over remains

begin;

create or replace function public.is_unpaid_reminder_email_due(
  p_type text,
  p_dedupe_key text,
  p_recipient_id uuid,
  p_today date default (now() at time zone 'Asia/Manila')::date
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_period_id uuid;
  v_due_date date;
  v_days_until integer;
  v_goal_prefix text;
begin
  if p_type = 'CONTRIBUTION_REMINDER' then
    v_parts := string_to_array(coalesce(p_dedupe_key, ''), ':');
    if array_length(v_parts, 1) >= 2 then
      begin
        v_period_id := v_parts[2]::uuid;
      exception when others then
        v_period_id := null;
      end;
    end if;

    if v_period_id is null then
      return false;
    end if;

    select cp.due_date into v_due_date
    from public.contribution_periods cp
    where cp.id = v_period_id
      and not cp.is_exempt;

    if v_due_date is null then
      return false;
    end if;

    v_days_until := (v_due_date - p_today);
    return v_days_until in (3, 0, -1)
      or (v_days_until <= -7 and mod(-v_days_until, 7) = 0);
  end if;

  if p_type = 'GOAL_REMINDER' then
    v_parts := string_to_array(coalesce(p_dedupe_key, ''), ':');
    if array_length(v_parts, 1) < 2 or nullif(v_parts[2], '') is null then
      return false;
    end if;
    v_goal_prefix := 'GOAL_REMINDER:' || v_parts[2] || ':%';
    return not exists (
      select 1
      from public.notifications n
      where n.recipient_id = p_recipient_id
        and n.type = 'GOAL_REMINDER'
        and n.emailed_at is not null
        and n.emailed_at >= now() - interval '7 days'
        and n.dedupe_key like v_goal_prefix
    );
  end if;

  return false;
end;
$$;

revoke all on function public.is_unpaid_reminder_email_due(text, text, uuid, date) from public, anon, authenticated;

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

  if not public.is_unpaid_reminder_email_due(new.type, new.dedupe_key, new.recipient_id) then
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

create or replace function public.dispatch_pending_unpaid_reminder_emails()
returns boolean
language plpgsql
security definer
set search_path = public, net, extensions
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
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
      and (n.created_at at time zone 'Asia/Manila')::date = v_today
      and p.status = 'ACTIVE'
      and p.notifications_enabled = true
      and public.is_unpaid_reminder_email_due(n.type, n.dedupe_key, n.recipient_id, v_today)
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

insert into public.schema_migrations (version, name)
values ('20261121_158', 'unpaid_reminder_email_milestone_cadence')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
