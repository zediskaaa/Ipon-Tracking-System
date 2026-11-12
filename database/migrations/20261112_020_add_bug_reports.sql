-- Store bug reports and optional screenshot attachments from active users for Super Admin review.

begin;

create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 120),
  description text not null check (char_length(btrim(description)) between 10 and 2000),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  image_count integer generated always as (jsonb_array_length(attachments)) stored,
  created_at timestamptz not null default now()
);

create index if not exists bug_reports_created_at_idx
  on public.bug_reports (created_at desc);

alter table public.bug_reports enable row level security;

drop policy if exists bug_reports_select on public.bug_reports;
create policy bug_reports_select on public.bug_reports for select to authenticated
using (reporter_id = auth.uid() or public.is_super_admin());

drop policy if exists bug_reports_insert on public.bug_reports;
create policy bug_reports_insert on public.bug_reports for insert to authenticated
with check (reporter_id = auth.uid() and public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER'));

drop policy if exists mfa_verified_for_opted_in on public.bug_reports;
create policy mfa_verified_for_opted_in on public.bug_reports as restrictive for all to authenticated
using (public.mfa_access_allowed()) with check (public.mfa_access_allowed());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bug_reports'
  ) then
    alter publication supabase_realtime add table public.bug_reports;
  end if;
end;
$$;

revoke all on public.bug_reports from public, anon, authenticated;
grant select on public.bug_reports to authenticated;
grant insert (reporter_id, title, description, attachments) on public.bug_reports to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_020', 'add bug reports')
on conflict (version) do nothing;

commit;

