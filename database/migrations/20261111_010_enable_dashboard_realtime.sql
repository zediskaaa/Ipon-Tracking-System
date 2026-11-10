-- Publish dashboard source tables so authorized clients receive live inserts and updates.

begin;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'members', 'groups', 'admin_requests', 'account_activity',
    'audit_logs', 'contribution_periods', 'contributions', 'withdrawals', 'expenses'
  ] loop
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
values ('20261111_010', 'enable realtime dashboard refresh')
on conflict (version) do nothing;

commit;
