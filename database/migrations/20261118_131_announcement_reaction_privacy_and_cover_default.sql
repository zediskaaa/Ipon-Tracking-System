-- Apply profile visibility privacy (default DP and cover behavior) to announcement reactions and author avatars
begin;

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

revoke all on function public.get_announcement_reactions(uuid) from public, anon;
grant execute on function public.get_announcement_reactions(uuid) to authenticated;

create or replace function public.announcement_author_avatar(p_author_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.id = auth.uid()
         or p.role = 'SUPER_ADMIN'
         or public.current_user_role() = 'SUPER_ADMIN'
         or public.can_view_social_profile(auth.uid(), p.id, p.chat_privacy ->> 'profile_visibility')
    then p.avatar_url
    else null
  end
  from public.profiles p
  where p.id = p_author_id
    and p.status = 'ACTIVE'
    and public.current_user_role() is not null
    and (
      p.role = 'SUPER_ADMIN'
      or public.current_user_role() = 'SUPER_ADMIN'
      or (
        public.current_user_role() in ('ADMIN', 'TREASURER', 'MEMBER')
        and public.current_group_id() is not null
        and (
          exists (
            select 1
            from public.group_memberships gm
            where gm.user_id = p.id
              and gm.group_id = public.current_group_id()
              and gm.role = 'ADMIN'
              and gm.status = 'ACTIVE'
          )
          or (
            p.role = 'ADMIN'
            and p.group_id = public.current_group_id()
          )
        )
      )
    )
  limit 1;
$$;

revoke all on function public.announcement_author_avatar(uuid) from public, anon;
grant execute on function public.announcement_author_avatar(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261118_131', 'announcement_reaction_privacy_and_cover_default')
on conflict (version) do nothing;

notify pgrst, 'reload schema';

commit;
