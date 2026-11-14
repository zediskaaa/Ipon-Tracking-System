-- Migration 068: Progressive anti-brute-force protection for email/password sign-in.
-- 5th failed password -> 3 min (180s), 6th -> 10 min (600s), 7th -> 30 min (1800s),
-- 8th -> 60 min (3600s), 9th+ -> exponential backoff up to 24 hours (86400s).

begin;

create table if not exists public.auth_login_throttles (
  throttle_key text primary key,
  scope text not null check (scope in ('EMAIL', 'IP')),
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists auth_login_throttles_locked_idx
  on public.auth_login_throttles (locked_until)
  where locked_until is not null;

alter table public.auth_login_throttles enable row level security;
revoke all on table public.auth_login_throttles from public, anon, authenticated;

create or replace function public.login_lockout_seconds(
  p_failed_attempts integer,
  p_threshold integer default 5
)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when p_failed_attempts < p_threshold then 0
    when p_failed_attempts = p_threshold then 180
    when p_failed_attempts = p_threshold + 1 then 600
    when p_failed_attempts = p_threshold + 2 then 1800
    when p_failed_attempts = p_threshold + 3 then 3600
    else least(86400, (3600 * power(2, least(5, p_failed_attempts - (p_threshold + 3))))::integer)
  end;
$$;

revoke execute on function public.login_lockout_seconds(integer, integer) from public, anon, authenticated;
grant execute on function public.login_lockout_seconds(integer, integer) to service_role;

create or replace function public.check_login_throttle(
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_email_key text;
  v_ip_key text;
  v_email_attempts integer := 0;
  v_email_locked_until timestamptz := null;
  v_email_retry integer := 0;
  v_ip_attempts integer := 0;
  v_ip_locked_until timestamptz := null;
  v_ip_retry integer := 0;
  v_locked boolean := false;
  v_scope text := null;
  v_retry_sec integer := 0;
  v_lock_duration_sec integer := 0;
  v_next_lock_sec integer := 0;
  v_locked_until timestamptz := null;
begin
  if v_ip is not null and lower(v_ip) = 'unknown' then
    v_ip := null;
  end if;

  if v_email is not null then
    v_email_key := 'email:' || v_email;
    delete from public.auth_login_throttles
    where throttle_key = v_email_key
      and last_failed_at is not null
      and last_failed_at < v_now - interval '24 hours'
      and (locked_until is null or locked_until <= v_now);

    select failed_attempts, locked_until
    into v_email_attempts, v_email_locked_until
    from public.auth_login_throttles
    where throttle_key = v_email_key;

    v_email_attempts := coalesce(v_email_attempts, 0);
    if v_email_locked_until is not null and v_email_locked_until > v_now then
      v_email_retry := greatest(1, ceil(extract(epoch from (v_email_locked_until - v_now)))::integer);
    end if;
  end if;

  if v_ip is not null then
    v_ip_key := 'ip:' || v_ip;
    delete from public.auth_login_throttles
    where throttle_key = v_ip_key
      and last_failed_at is not null
      and last_failed_at < v_now - interval '24 hours'
      and (locked_until is null or locked_until <= v_now);

    select failed_attempts, locked_until
    into v_ip_attempts, v_ip_locked_until
    from public.auth_login_throttles
    where throttle_key = v_ip_key;

    v_ip_attempts := coalesce(v_ip_attempts, 0);
    if v_ip_locked_until is not null and v_ip_locked_until > v_now then
      v_ip_retry := greatest(1, ceil(extract(epoch from (v_ip_locked_until - v_now)))::integer);
    end if;
  end if;

  if v_email_retry >= v_ip_retry and v_email_retry > 0 then
    v_locked := true;
    v_scope := 'EMAIL';
    v_retry_sec := v_email_retry;
    v_locked_until := v_email_locked_until;
    v_lock_duration_sec := public.login_lockout_seconds(v_email_attempts, 5);
    v_next_lock_sec := public.login_lockout_seconds(greatest(5, v_email_attempts + 1), 5);
  elsif v_ip_retry > 0 then
    v_locked := true;
    v_scope := 'IP';
    v_retry_sec := v_ip_retry;
    v_locked_until := v_ip_locked_until;
    v_lock_duration_sec := public.login_lockout_seconds(v_ip_attempts, 15);
    v_next_lock_sec := public.login_lockout_seconds(greatest(15, v_ip_attempts + 1), 15);
  else
    v_next_lock_sec := public.login_lockout_seconds(greatest(5, v_email_attempts + 1), 5);
  end if;

  return jsonb_build_object(
    'locked', v_locked,
    'scope', v_scope,
    'failed_attempts', v_email_attempts,
    'threshold', 5,
    'remaining_attempts', case when v_locked then 0 else greatest(0, 5 - v_email_attempts) end,
    'retry_after_seconds', v_retry_sec,
    'lock_duration_seconds', v_lock_duration_sec,
    'next_lock_duration_seconds', v_next_lock_sec,
    'locked_until', v_locked_until
  );
end;
$$;

revoke execute on function public.check_login_throttle(text, text) from public, anon, authenticated;
grant execute on function public.check_login_throttle(text, text) to service_role;

create or replace function public.record_failed_login_attempt(
  p_email text,
  p_ip text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_ip text := nullif(btrim(coalesce(p_ip, '')), '');
  v_email_key text;
  v_ip_key text;
begin
  if v_ip is not null and lower(v_ip) = 'unknown' then
    v_ip := null;
  end if;

  if v_email is not null then
    v_email_key := 'email:' || v_email;
    insert into public.auth_login_throttles as t (
      throttle_key, scope, failed_attempts, locked_until, last_failed_at, updated_at
    )
    values (v_email_key, 'EMAIL', 1, null, v_now, v_now)
    on conflict (throttle_key) do update set
      failed_attempts = case
        when t.last_failed_at is not null
             and t.last_failed_at < v_now - interval '24 hours'
             and (t.locked_until is null or t.locked_until <= v_now)
        then 1
        else t.failed_attempts + 1
      end,
      locked_until = case
        when public.login_lockout_seconds(
          case
            when t.last_failed_at is not null
                 and t.last_failed_at < v_now - interval '24 hours'
                 and (t.locked_until is null or t.locked_until <= v_now)
            then 1
            else t.failed_attempts + 1
          end,
          5
        ) > 0
        then v_now + make_interval(secs => public.login_lockout_seconds(
          case
            when t.last_failed_at is not null
                 and t.last_failed_at < v_now - interval '24 hours'
                 and (t.locked_until is null or t.locked_until <= v_now)
            then 1
            else t.failed_attempts + 1
          end,
          5
        ))
        else null
      end,
      last_failed_at = v_now,
      updated_at = v_now
    where t.locked_until is null or t.locked_until <= v_now;
  end if;

  if v_ip is not null then
    v_ip_key := 'ip:' || v_ip;
    insert into public.auth_login_throttles as t (
      throttle_key, scope, failed_attempts, locked_until, last_failed_at, updated_at
    )
    values (v_ip_key, 'IP', 1, null, v_now, v_now)
    on conflict (throttle_key) do update set
      failed_attempts = case
        when t.last_failed_at is not null
             and t.last_failed_at < v_now - interval '24 hours'
             and (t.locked_until is null or t.locked_until <= v_now)
        then 1
        else t.failed_attempts + 1
      end,
      locked_until = case
        when public.login_lockout_seconds(
          case
            when t.last_failed_at is not null
                 and t.last_failed_at < v_now - interval '24 hours'
                 and (t.locked_until is null or t.locked_until <= v_now)
            then 1
            else t.failed_attempts + 1
          end,
          15
        ) > 0
        then v_now + make_interval(secs => public.login_lockout_seconds(
          case
            when t.last_failed_at is not null
                 and t.last_failed_at < v_now - interval '24 hours'
                 and (t.locked_until is null or t.locked_until <= v_now)
            then 1
            else t.failed_attempts + 1
          end,
          15
        ))
        else null
      end,
      last_failed_at = v_now,
      updated_at = v_now
    where t.locked_until is null or t.locked_until <= v_now;
  end if;

  return public.check_login_throttle(v_email, v_ip);
end;
$$;

revoke execute on function public.record_failed_login_attempt(text, text) from public, anon, authenticated;
grant execute on function public.record_failed_login_attempt(text, text) to service_role;

create or replace function public.clear_login_throttle(
  p_email text,
  p_ip text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if v_email is not null then
    delete from public.auth_login_throttles
    where throttle_key = 'email:' || v_email;
  end if;
end;
$$;

revoke execute on function public.clear_login_throttle(text, text) from public, anon, authenticated;
grant execute on function public.clear_login_throttle(text, text) to service_role;

insert into public.schema_migrations (version, name)
values ('20261115_068', 'login bruteforce protection')
on conflict (version) do nothing;

commit;

