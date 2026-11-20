begin;

create table if not exists public.notification_device_tokens (
  fcm_token text primary key check (char_length(fcm_token) between 40 and 1024),
  feed_token uuid not null references public.notification_feed_tokens(token) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists notification_device_tokens_feed_idx
  on public.notification_device_tokens (feed_token);

alter table public.notification_device_tokens enable row level security;
revoke all on public.notification_device_tokens from public, anon, authenticated;

create or replace function public.register_notification_device_token(p_fcm_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_feed_token uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_fcm_token is null or char_length(p_fcm_token) not between 40 and 1024 then
    raise exception 'Invalid device token.' using errcode = '22023';
  end if;

  select token into v_feed_token
  from public.notification_feed_tokens
  where user_id = auth.uid();
  if v_feed_token is null then
    raise exception 'Notification feed is not registered.' using errcode = '42501';
  end if;

  insert into public.notification_device_tokens (fcm_token, feed_token, updated_at)
  values (p_fcm_token, v_feed_token, now())
  on conflict (fcm_token) do update
  set feed_token = excluded.feed_token, updated_at = now();
end;
$$;

revoke execute on function public.register_notification_device_token(text) from public, anon;
grant execute on function public.register_notification_device_token(text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261120_134', 'register Android FCM device tokens for direct notification delivery')
on conflict (version) do nothing;

commit;
