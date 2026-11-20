-- Migration 142: Fix notify_new_member() trigger referencing nonexistent new.user_id on public.members
begin;

create or replace function public.notify_new_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace_mode text;
  v_actor_id uuid := coalesce(new.created_by, auth.uid());
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
    if v_actor_id is not null and v_admin.id = v_actor_id then
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

insert into public.schema_migrations (version, name)
values ('20261121_142', 'fix_notify_new_member_created_by')
on conflict (version) do nothing;

commit;
