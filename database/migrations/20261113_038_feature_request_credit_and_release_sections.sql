-- 20261113_038_feature_request_credit_and_release_sections.sql
begin;

-- 1. Add allow_credit column to feature_requests
alter table public.feature_requests
  add column if not exists allow_credit boolean not null default true;

-- 2. Update feature_requests SELECT policy so users can read released implemented requests
drop policy if exists feature_requests_select on public.feature_requests;
create policy feature_requests_select on public.feature_requests for select to authenticated
using (
  requester_id = auth.uid()
  or public.is_super_admin()
  or (status = 'IMPLEMENTED' and release_version is not null)
);

-- 3. Function to get release feature requests with credit consent enforced
create or replace function public.get_release_features(p_release_version text)
returns table (
  id uuid,
  title text,
  details text,
  requester_id uuid,
  requester_name text,
  requester_avatar_url text,
  allow_credit boolean,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.id,
    f.title,
    f.details,
    case when f.allow_credit then f.requester_id else null end as requester_id,
    case when f.allow_credit then coalesce(p.full_name, 'Contributor') else 'Community Member' end as requester_name,
    case when f.allow_credit then p.avatar_url else null end as requester_avatar_url,
    f.allow_credit,
    f.created_at
  from public.feature_requests f
  left join public.profiles p on p.id = f.requester_id
  where f.status = 'IMPLEMENTED'
    and f.release_version = nullif(btrim(p_release_version), '')
  order by f.created_at asc;
$$;

revoke all on function public.get_release_features(text) from public, anon;
grant execute on function public.get_release_features(text) to authenticated;

-- 4. Record migration
insert into public.schema_migrations (version, name)
values ('20261113_038', 'feature request credit consent and release sections')
on conflict (version) do nothing;

commit;
