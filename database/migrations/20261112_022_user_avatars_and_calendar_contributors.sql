-- Add user display pictures (any picture format) and expose member avatars safely on the group savings calendar.

begin;

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  drop constraint if exists profiles_avatar_url_check;

alter table public.profiles
  add constraint profiles_avatar_url_check
  check (avatar_url is null or (avatar_url ~ '^data:image/' and char_length(avatar_url) <= 600000));

create or replace function public.group_member_avatar(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.avatar_url
      from public.profiles p
      where p.member_id = p_member_id
        and p.group_id = public.current_group_id()
        and p.status = 'ACTIVE'
        and p.avatar_url is not null
      limit 1
    ),
    (
      select p.avatar_url
      from public.members m
      join public.profiles p
        on p.group_id = m.group_id
       and p.status = 'ACTIVE'
       and lower(btrim(p.full_name)) = lower(btrim(m.full_name))
      where m.id = p_member_id
        and m.group_id = public.current_group_id()
        and p.avatar_url is not null
      limit 1
    )
  );
$$;

create or replace function public.update_own_avatar(p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Please choose a valid picture under 500 KB.' using errcode = '22023';
  end if;

  update public.profiles
  set avatar_url = p_avatar_url
  where id = auth.uid();

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.group_member_avatar(uuid) from public, anon;
grant execute on function public.group_member_avatar(uuid) to authenticated;

revoke execute on function public.update_own_avatar(text) from public, anon;
grant execute on function public.update_own_avatar(text) to authenticated;

create or replace view public.v_savings_calendar
with (security_invoker = true)
as
select c.id, c.payment_date as activity_date, 'ADDITION'::text as activity_type,
       c.amount, c.approval_status, c.submitted_by, c.notes, c.created_at,
       m.full_name as subject_name,
       m.id as subject_member_id,
       public.group_member_avatar(m.id) as subject_avatar_url
from public.contributions c
join public.contribution_periods cp on cp.id = c.contribution_period_id
join public.members m on m.id = cp.member_id
where c.approval_status in ('CONFIRMED', 'PENDING')
union all
select w.id, w.transaction_date, 'DEDUCTION'::text,
       w.amount, w.approval_status, w.submitted_by, w.notes, w.created_at,
       w.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.withdrawals w
where w.approval_status in ('CONFIRMED', 'PENDING')
union all
select e.id, e.transaction_date, 'EXPENSE'::text,
       e.amount, e.approval_status, e.submitted_by, e.notes, e.created_at,
       e.person_responsible as subject_name,
       null::uuid as subject_member_id,
       null::text as subject_avatar_url
from public.expenses e
where e.approval_status in ('CONFIRMED', 'PENDING');

insert into public.schema_migrations (version, name)
values ('20261112_022', 'user avatars and calendar contributors')
on conflict (version) do nothing;

commit;
