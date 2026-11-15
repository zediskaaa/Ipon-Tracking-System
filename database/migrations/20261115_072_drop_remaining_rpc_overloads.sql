begin;

-- Ensure stale shorter overloaded RPC signatures are dropped from live Postgres
-- so PostgREST (PGRST203) never encounters ambiguous candidate functions.
drop function if exists public.create_member(text, text, text, text, date, numeric, text);
drop function if exists public.update_member(uuid, text, text, text, text, numeric, text);
drop function if exists public.update_contribution(uuid, numeric, date, text, text);
drop function if exists public.update_expense(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.update_withdrawal(uuid, date, numeric, text, text, text, text, text);
drop function if exists public.update_own_profile(text, text, text, text);

revoke execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) from public, anon;
grant execute on function public.create_member(text, text, text, text, date, numeric, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';

insert into public.schema_migrations (version, name)
values ('20261115_072', 'drop remaining rpc overloads')
on conflict (version) do nothing;

commit;
