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
  select exists (
    select 1
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = p_user_id
      and lower(btrim(coalesce(nullif(u.email, ''), nullif(p.email, ''), ''))) = 'breadspanish231@gmail.com'
  );
$$;

create or replace function public.is_super_admin_announcement(
  p_announcement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.announcements a
    left join public.profiles ap on ap.id = a.author_id
    where a.id = p_announcement_id
      and a.deleted_at is null
      and (a.group_id is null or ap.role = 'SUPER_ADMIN')
  );
$$;

drop policy if exists announcement_reactions_select on public.announcement_reactions;
create policy announcement_reactions_select on public.announcement_reactions for select to authenticated
using (
  exists (
    select 1
    from public.announcements a
    left join public.profiles ap on ap.id = a.author_id
    where a.id = announcement_reactions.announcement_id
      and a.deleted_at is null
      and (
        (
          (a.group_id is null or ap.role = 'SUPER_ADMIN')
          and (
            announcement_reactions.user_id = auth.uid()
            or public.can_view_super_admin_announcement_reactors(auth.uid())
          )
        )
        or (
          a.group_id is not null
          and coalesce(ap.role::text, '') <> 'SUPER_ADMIN'
          and (
            public.is_super_admin()
            or a.group_id = public.current_group_id()
            or exists (
              select 1
              from public.group_memberships gm
              where gm.group_id = a.group_id
                and gm.user_id = auth.uid()
                and gm.status = 'ACTIVE'
            )
          )
        )
      )
  )
);

create or replace function public.get_announcement_reaction_summaries()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'announcement_id', s.announcement_id,
        'reaction', s.reaction,
        'count', s.reaction_count,
        'reacted_by_me', s.reacted_by_me
      )
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      ar.announcement_id,
      ar.reaction,
      count(*)::integer as reaction_count,
      bool_or(ar.user_id = v_uid) as reacted_by_me
    from public.announcement_reactions ar
    join public.announcements a on a.id = ar.announcement_id
    where a.deleted_at is null
      and (
        public.is_super_admin()
        or a.group_id is null
        or a.group_id = public.current_group_id()
        or exists (
          select 1
          from public.group_memberships gm
          where gm.group_id = a.group_id
            and gm.user_id = v_uid
            and gm.status = 'ACTIVE'
        )
      )
    group by ar.announcement_id, ar.reaction
  ) s;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_announcement_reactions(p_announcement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if public.is_super_admin_announcement(p_announcement_id)
     and not public.can_view_super_admin_announcement_reactors(v_uid) then
    raise exception 'Only the creator account can view who reacted to this announcement.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', ar.user_id,
        'profile_visible', vis.can_view,
        'reaction', ar.reaction,
        'full_name', p.full_name,
        'role', p.role,
        'avatar_url', case when vis.can_view then p.avatar_url else null end,
        'created_at', ar.created_at
      ) order by ar.created_at desc
    ),
    '[]'::jsonb
  ) into v_result
  from public.announcement_reactions ar
  join public.announcements a on a.id = ar.announcement_id
  join public.profiles p on p.id = ar.user_id
  cross join lateral (
    select (
      ar.user_id = v_uid
      or public.can_view_social_profile(v_uid, p.id, p.chat_privacy ->> 'profile_visibility')
    ) as can_view
  ) vis
  where ar.announcement_id = p_announcement_id
    and a.deleted_at is null
    and (
      public.is_super_admin()
      or a.group_id is null
      or a.group_id = public.current_group_id()
      or exists (
        select 1
        from public.group_memberships gm
        where gm.group_id = a.group_id
          and gm.user_id = v_uid
          and gm.status = 'ACTIVE'
      )
    );

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on function public.can_view_super_admin_announcement_reactors(uuid), public.is_super_admin_announcement(uuid), public.get_announcement_reaction_summaries(), public.get_announcement_reactions(uuid) from public, anon;
grant execute on function public.get_announcement_reaction_summaries(), public.get_announcement_reactions(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261121_147', 'restrict_super_admin_announcement_reactors')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
