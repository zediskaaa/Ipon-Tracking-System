-- Store feature suggestions from active users for Super Admin review.

begin;

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  details text not null check (char_length(btrim(details)) between 10 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists feature_requests_created_at_idx
  on public.feature_requests (created_at desc);

alter table public.feature_requests enable row level security;

drop policy if exists feature_requests_select on public.feature_requests;
create policy feature_requests_select on public.feature_requests for select to authenticated
using (requester_id = auth.uid() or public.is_super_admin());

drop policy if exists feature_requests_insert on public.feature_requests;
create policy feature_requests_insert on public.feature_requests for insert to authenticated
with check (requester_id = auth.uid() and public.current_user_role() is not null);

drop policy if exists mfa_verified_for_opted_in on public.feature_requests;
create policy mfa_verified_for_opted_in on public.feature_requests as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'feature_requests'
  ) then
    alter publication supabase_realtime add table public.feature_requests;
  end if;
end;
$$;

revoke all on public.feature_requests from public, anon, authenticated;
grant select on public.feature_requests to authenticated;
grant insert (requester_id, title, details) on public.feature_requests to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_016', 'add feature requests')
on conflict (version) do nothing;

commit;
