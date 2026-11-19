begin;

alter table public.profiles
  add column if not exists new_device_email_otp_enabled boolean not null default false;

create table if not exists public.account_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null check (char_length(token_hash) = 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (user_id, token_hash)
);

create table if not exists public.account_device_otp_challenges (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null check (char_length(code_hash) = 64),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists account_trusted_devices_user_expiry_idx
  on public.account_trusted_devices (user_id, expires_at desc);
create index if not exists account_device_otp_user_created_idx
  on public.account_device_otp_challenges (user_id, created_at desc);

alter table public.account_trusted_devices enable row level security;
alter table public.account_device_otp_challenges enable row level security;

revoke all on public.account_trusted_devices, public.account_device_otp_challenges from public, anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261119_132', 'new_device_email_otp')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
