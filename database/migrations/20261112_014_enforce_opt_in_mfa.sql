-- Require AAL2 across database access after a user opts in to MFA.

begin;

create or replace function public.mfa_access_allowed()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce((auth.jwt() ->> 'aal') = 'aal2', false)
    or not exists (
      select 1
      from auth.mfa_factors
      where user_id = auth.uid()
        and status = 'verified'
    );
$$;

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and status = 'ACTIVE'
    and public.mfa_access_allowed();
$$;

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select member_id
  from public.profiles
  where id = auth.uid()
    and status = 'ACTIVE'
    and public.mfa_access_allowed();
$$;

create or replace function public.current_group_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select group_id
  from public.profiles
  where id = auth.uid()
    and status = 'ACTIVE'
    and public.mfa_access_allowed();
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'profiles', 'members', 'contribution_settings', 'contribution_periods',
    'contributions', 'expenses', 'withdrawals', 'savings_goals', 'audit_logs',
    'groups', 'admin_requests', 'notifications', 'account_activity'
  ]
  loop
    execute format('drop policy if exists mfa_verified_for_opted_in on public.%I', v_table);
    execute format(
      'create policy mfa_verified_for_opted_in on public.%I as restrictive for all to authenticated using (public.mfa_access_allowed()) with check (public.mfa_access_allowed())',
      v_table
    );
  end loop;
end;
$$;

revoke execute on function public.mfa_access_allowed() from public, anon;
grant execute on function public.mfa_access_allowed() to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_014', 'enforce opt-in multi-factor authentication')
on conflict (version) do nothing;

commit;
