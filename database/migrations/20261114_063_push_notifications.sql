-- Migration 20261114_063: Web Push (VAPID) subscriptions and instant background notification dispatch
begin;

create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique check (char_length(btrim(endpoint)) between 24 and 2048 and endpoint ~* '^https://'),
  p256dh text not null check (char_length(btrim(p256dh)) between 16 and 512),
  auth text not null check (char_length(btrim(auth)) between 8 and 256),
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id, updated_at desc);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

create table if not exists public.internal_webhook_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.internal_webhook_config enable row level security;
revoke all on public.internal_webhook_config from public, anon, authenticated;

create or replace function public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_platform text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_p256dh text := btrim(coalesce(p_p256dh, ''));
  v_auth text := btrim(coalesce(p_auth, ''));
  v_platform text := nullif(left(btrim(coalesce(p_platform, '')), 64), '');
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'ACTIVE'
  ) then
    raise exception 'Active account required.' using errcode = '42501';
  end if;

  if v_endpoint !~* '^https://' or char_length(v_endpoint) < 24 or char_length(v_endpoint) > 2048 then
    raise exception 'Invalid push subscription endpoint.';
  end if;

  if char_length(v_p256dh) < 16 or char_length(v_auth) < 8 then
    raise exception 'Invalid push subscription encryption keys.';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, platform, updated_at)
  values (v_uid, v_endpoint, v_p256dh, v_auth, v_platform, now())
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      platform = coalesce(excluded.platform, public.push_subscriptions.platform),
      updated_at = now();
end;
$$;

revoke execute on function public.upsert_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.upsert_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(
  p_endpoint text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_endpoint text := nullif(btrim(coalesce(p_endpoint, '')), '');
begin
  if v_uid is null then
    return;
  end if;

  if v_endpoint is not null then
    delete from public.push_subscriptions
    where user_id = v_uid and endpoint = v_endpoint;
  else
    delete from public.push_subscriptions
    where user_id = v_uid;
  end if;
end;
$$;

revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

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
       and new.link is not distinct from old.link then
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
after insert or update of title, message, link, read_at on public.notifications
for each row execute function public.enqueue_notification_push();

insert into public.schema_migrations (version, name)
values ('20261114_063', 'web push subscriptions and instant background notification dispatch')
on conflict (version) do nothing;

commit;

