-- Migration ledger. Run once before every numbered migration.

begin;

create table if not exists public.schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);

revoke all on public.schema_migrations from anon, authenticated;

insert into public.schema_migrations (version, name)
values ('0000', 'create migration ledger')
on conflict (version) do nothing;

commit;
