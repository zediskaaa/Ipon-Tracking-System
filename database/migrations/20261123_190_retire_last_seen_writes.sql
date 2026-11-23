begin;

-- Older web/APK clients still call this RPC. Keep its signature and grants so
-- those clients do not fail, but stop writing obsolete presence timestamps.
create or replace function public.touch_user_last_seen()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  return;
end;
$$;

-- Warning flags are now reset from durable activity by migration 189.
drop trigger if exists profiles_clear_inactivity_warning on public.profiles;
drop function if exists public.clear_inactivity_warning_on_activity();

insert into public.schema_migrations (version, name)
values ('20261123_190', 'retire last seen writes while preserving legacy rpc compatibility')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
