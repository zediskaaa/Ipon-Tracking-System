begin;

create or replace function public.notify_super_admin_new_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_name text;
  v_super_admin record;
begin
  -- Administrator requests already notify Super Admin from handle_new_user().
  if new.raw_user_meta_data ->> 'account_kind' = 'ADMIN_REQUEST' then
    return new;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(split_part(new.email, '@', 1), ''), 'New user')
  into v_account_name
  from public.profiles p
  where p.id = new.id;

  for v_super_admin in
    select id from public.profiles
    where role = 'SUPER_ADMIN' and status = 'ACTIVE' and id <> new.id
  loop
    perform public.push_notification(
      v_super_admin.id,
      'ACCOUNT_CREATED',
      'New account created',
      coalesce(v_account_name, 'New user') || ' created a myIPON account.',
      'super-admin.html#administrators'
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.notify_super_admin_new_account() from public, anon, authenticated;

drop trigger if exists zz_notify_super_admin_new_account on auth.users;
create trigger zz_notify_super_admin_new_account
  after insert on auth.users
  for each row execute function public.notify_super_admin_new_account();

insert into public.schema_migrations (version, name)
values ('20261120_136', 'notify Super Admin when an account is created')
on conflict (version) do nothing;

commit;
