begin;

create or replace function public.can_view_super_admin_announcement_reactors(
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select auth.uid() is not null
    and coalesce(p_user_id, auth.uid()) = auth.uid()
    and exists (
      select 1
      from auth.users u
      left join public.profiles p on p.id = u.id
      where u.id = auth.uid()
        and lower(btrim(coalesce(nullif(u.email, ''), nullif(p.email, ''), ''))) = 'breadspanish231@gmail.com'
    );
$$;

revoke all on function public.can_view_super_admin_announcement_reactors(uuid) from public, anon;
grant execute on function public.can_view_super_admin_announcement_reactors(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_148', 'grant_announcement_reactor_helper_for_rls')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
