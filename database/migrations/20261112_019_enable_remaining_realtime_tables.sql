-- Publish remaining group configuration and goal tables for live realtime refresh.

begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['savings_goals', 'contribution_settings'] loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end $$;

insert into public.schema_migrations (version, name)
values ('20261112_019', 'enable remaining realtime tables')
on conflict (version) do nothing;

commit;

