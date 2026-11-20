begin;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_mode text;
  v_admin record;
begin
  if nullif(current_setting('ipon.joining_group_id', true), '') = new.group_id::text then
    return new;
  end if;

  select upper(coalesce(g.workspace_mode, 'GROUP'))
  into v_workspace_mode
  from public.groups g
  where g.id = new.group_id;

  if v_workspace_mode = 'SOLO' then
    return new;
  end if;

  for v_admin in
    select user_id as id
    from public.group_admin_ids(new.group_id)
  loop
    if new.user_id is not null and v_admin.id = new.user_id then
      continue;
    end if;
    perform public.push_notification(
      v_admin.id,
      'MEMBER_CREATED',
      'Member registered',
      new.full_name || ' was added to your group.',
      'members.html?member=' || new.id::text,
      new.group_id
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.notify_new_member() from public, anon, authenticated;

delete from public.notifications n
using public.groups g
where n.group_id = g.id
  and upper(coalesce(g.workspace_mode, 'GROUP')) = 'SOLO'
  and n.type = 'MEMBER_CREATED';

insert into public.schema_migrations (version, name)
values ('20261120_137', 'suppress member registered notifications in solo workspaces and self-registration')
on conflict (version) do nothing;

commit;
