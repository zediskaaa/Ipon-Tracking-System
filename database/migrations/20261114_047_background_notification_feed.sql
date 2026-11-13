-- Migration 20261114_047: Scoped read-only notification feed token for mobile background notification polling.
begin;

create table if not exists public.notification_feed_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  updated_at timestamptz not null default now()
);

alter table public.notification_feed_tokens enable row level security;
revoke all on public.notification_feed_tokens from public, anon, authenticated;

create or replace function public.ensure_notification_feed_token()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_token uuid;
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

  insert into public.notification_feed_tokens (user_id, token, updated_at)
  values (v_uid, gen_random_uuid(), now())
  on conflict (user_id) do update
  set updated_at = now()
  returning token into v_token;

  return v_token;
end;
$$;

revoke execute on function public.ensure_notification_feed_token() from public, anon;
grant execute on function public.ensure_notification_feed_token() to authenticated;

create or replace function public.revoke_notification_feed_token()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  delete from public.notification_feed_tokens where user_id = auth.uid();
end;
$$;

revoke execute on function public.revoke_notification_feed_token() from public, anon;
grant execute on function public.revoke_notification_feed_token() to authenticated;

create or replace function public.get_unread_notifications_by_token(p_token uuid)
returns table (
  id bigint,
  type text,
  title text,
  message text,
  link text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.type, n.title, n.message, n.link, n.created_at
  from public.notification_feed_tokens t
  join public.profiles p on p.id = t.user_id
  join public.notifications n on n.recipient_id = p.id
  where p_token is not null
    and t.token = p_token
    and p.status = 'ACTIVE'
    and p.notifications_enabled
    and n.read_at is null
    and n.created_at >= now() - interval '48 hours'
  order by n.created_at desc
  limit 8;
$$;

revoke execute on function public.get_unread_notifications_by_token(uuid) from public;
grant execute on function public.get_unread_notifications_by_token(uuid) to anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_047', 'background notification feed token for mobile drawer polling')
on conflict (version) do nothing;

commit;

