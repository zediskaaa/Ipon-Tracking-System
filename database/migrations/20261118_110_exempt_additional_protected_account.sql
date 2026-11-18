begin;

-- Exempt both protected accounts from inactivity retention warnings and purges
create or replace function public.is_protected_retention_account(p_email text)
returns boolean
language sql
immutable
as $$
  select lower(btrim(coalesce(p_email, ''))) in (
    'breadspanish231@gmail.com',
    'antalannhicolejoy19@gmail.com'
  );
$$;

revoke all on function public.is_protected_retention_account(text) from public, anon, authenticated;

update public.profiles p
set inactivity_warned_at = null
from auth.users u
where u.id = p.id
  and p.inactivity_warned_at is not null
  and public.is_protected_retention_account(coalesce(nullif(p.email, ''), u.email));

-- Keep SUPER_ADMIN announcement avatar linked specifically to breadspanish231@gmail.com
create or replace function public.announcement_author_social_id(
  p_author_id uuid,
  p_author_role text
)
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select case
    when p_author_role = 'SUPER_ADMIN' then (
      select p.id
      from public.profiles p
      left join auth.users u on u.id = p.id
      where p.status = 'ACTIVE'
        and p.role in ('ADMIN', 'TREASURER', 'MEMBER')
        and lower(btrim(coalesce(nullif(p.email, ''), u.email, ''))) = 'breadspanish231@gmail.com'
      order by p.created_at desc
      limit 1
    )
    else null
  end;
$$;

revoke execute on function public.announcement_author_social_id(uuid, text) from public, anon;
grant execute on function public.announcement_author_social_id(uuid, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_110', 'exempt antalannhicolejoy19@gmail.com from inactivity retention')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
