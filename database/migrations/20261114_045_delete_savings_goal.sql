-- Migration 045: Add administrator RPC to delete a group savings goal with audit logging
begin;

create or replace function public.delete_savings_goal(
  p_goal_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can manage goals.' using errcode = '42501';
  end if;
  if p_goal_id is null then
    raise exception 'Savings goal is required.' using errcode = '22023';
  end if;

  delete from public.savings_goals
  where id = p_goal_id
    and group_id = public.current_group_id()
  returning id into v_id;

  if v_id is null then
    raise exception 'Savings goal not found.' using errcode = 'P0002';
  end if;

  return v_id;
end;
$$;

revoke execute on function public.delete_savings_goal(uuid) from public, anon;
grant execute on function public.delete_savings_goal(uuid) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_045', 'add delete_savings_goal RPC')
on conflict (version) do nothing;

commit;

