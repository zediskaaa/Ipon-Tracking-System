begin;

create or replace function public.set_admin_contributor(
  p_enabled boolean,
  p_monthly_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid := public.current_group_id();
  v_profile public.profiles;
  v_gm public.group_memberships;
  v_member_id uuid;
  v_default_amount numeric;
  v_amount numeric;
  v_first text;
  v_middle text;
  v_last text;
  v_full text;
begin
  if not public.is_admin() or v_group_id is null then
    raise exception 'Only a group administrator can update contributor participation.' using errcode = '42501';
  end if;

  if p_monthly_amount is not null and (p_monthly_amount <= 0 or p_monthly_amount > 1000000) then
    raise exception 'Monthly contribution amount must be greater than zero.' using errcode = '22023';
  end if;

  select * into v_profile
  from public.profiles
  where id = auth.uid() and group_id = v_group_id and status = 'ACTIVE';

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  select * into v_gm
  from public.group_memberships
  where group_id = v_group_id and user_id = auth.uid() and status = 'ACTIVE';

  v_member_id := coalesce(v_profile.member_id, v_gm.member_id);

  if p_enabled then
    select default_amount into v_default_amount
    from public.contribution_settings
    where group_id = v_group_id
    order by effective_month desc
    limit 1;

    v_amount := round(coalesce(p_monthly_amount, v_default_amount, 100), 2);

    if v_member_id is not null then
      update public.members
      set status = 'ACTIVE',
          deactivated_at = null,
          monthly_contribution_amount = coalesce(p_monthly_amount, monthly_contribution_amount, v_amount),
          updated_by = auth.uid()
      where id = v_member_id and group_id = v_group_id;
    else
      v_full := coalesce(nullif(btrim(v_profile.full_name), ''), 'Group Admin');
      v_first := coalesce(nullif(btrim(v_profile.first_name), ''), split_part(v_full, ' ', 1));
      v_middle := nullif(btrim(v_profile.middle_name), '');
      v_last := coalesce(nullif(btrim(v_profile.last_name), ''), nullif(btrim(substr(v_full, char_length(split_part(v_full, ' ', 1)) + 1)), ''), 'Admin');

      insert into public.members (
        group_id, first_name, middle_name, last_name, full_name,
        contact_number, date_registered, monthly_contribution_amount,
        status, notes, created_by
      ) values (
        v_group_id,
        v_first,
        v_middle,
        v_last,
        concat_ws(' ', v_first, v_middle, v_last),
        coalesce(nullif(btrim(v_profile.contact_number), ''), '09000000000'),
        (now() at time zone 'Asia/Manila')::date,
        v_amount,
        'ACTIVE',
        'Group administrator contributor',
        auth.uid()
      )
      returning id into v_member_id;
    end if;

    update public.group_memberships
    set member_id = v_member_id
    where group_id = v_group_id and user_id = auth.uid();

    update public.profiles
    set member_id = v_member_id
    where id = auth.uid() and group_id = v_group_id;

    perform public.generate_contribution_periods(date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date);

    update public.contribution_periods cp
    set required_amount = v_amount
    where cp.member_id = v_member_id
      and cp.period_month = date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date
      and not exists (
        select 1 from public.contributions c
        where c.contribution_period_id = cp.id
      );

    return jsonb_build_object('is_contributor', true, 'member_id', v_member_id, 'monthly_contribution_amount', v_amount);
  else
    if v_member_id is not null then
      update public.members
      set status = 'INACTIVE',
          deactivated_at = now(),
          updated_by = auth.uid()
      where id = v_member_id
        and group_id = v_group_id
        and deleted_at is null;

      delete from public.contribution_periods cp
      where cp.member_id = v_member_id
        and not exists (
          select 1 from public.contributions c
          where c.contribution_period_id = cp.id
        );
    end if;

    update public.profiles
    set member_id = null
    where id = auth.uid() and group_id = v_group_id;

    return jsonb_build_object('is_contributor', false, 'member_id', null, 'monthly_contribution_amount', null);
  end if;
end;
$$;

revoke execute on function public.set_admin_contributor(boolean, numeric) from public, anon;
grant execute on function public.set_admin_contributor(boolean, numeric) to authenticated;

create or replace function public.admin_create_group(
  p_name text,
  p_avatar_url text default null,
  p_include_self boolean default true,
  p_monthly_amount numeric default 100
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_new_group_id uuid;
  v_amount numeric := round(coalesce(p_monthly_amount, 100), 2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not public.mfa_access_allowed() then
    raise exception 'Complete multi-factor authentication first.' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'DISABLED'
  ) then
    raise exception 'Your account is deactivated or disabled.' using errcode = '42501';
  end if;

  if public.is_super_admin() then
    raise exception 'Super administrators manage platform access from the Super Admin console.' using errcode = '42501';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 150 then
    raise exception 'Group name must contain between 2 and 150 characters.' using errcode = '22023';
  end if;

  if p_avatar_url is not null and (p_avatar_url !~ '^data:image/' or char_length(p_avatar_url) > 600000) then
    raise exception 'Group picture must be a valid image under 450 KB.' using errcode = '22023';
  end if;

  if v_amount <= 0 or v_amount > 1000000 then
    raise exception 'Monthly contribution amount must be between 1 and 1,000,000.' using errcode = '22023';
  end if;

  insert into public.groups (name, owner_id, avatar_url, status)
  values (v_name, auth.uid(), p_avatar_url, 'ACTIVE')
  returning id into v_new_group_id;

  insert into public.group_memberships (group_id, user_id, role, status, member_id)
  values (v_new_group_id, auth.uid(), 'ADMIN', 'ACTIVE', null)
  on conflict (group_id, user_id) do update
  set role = 'ADMIN', status = 'ACTIVE';

  update public.profiles
  set group_id = v_new_group_id,
      role = 'ADMIN',
      status = 'ACTIVE',
      member_id = null
  where id = auth.uid();

  insert into public.contribution_settings (group_id, effective_month, default_amount, created_by)
  values (v_new_group_id, date_trunc('month', (now() at time zone 'Asia/Manila')::date)::date, v_amount, auth.uid());

  if p_include_self then
    perform public.set_admin_contributor(true, v_amount);
  end if;

  return v_new_group_id;
end;
$$;

revoke execute on function public.admin_create_group(text, text, boolean, numeric) from public, anon;
grant execute on function public.admin_create_group(text, text, boolean, numeric) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261114_052', 'restore self-serve admin_create_group and admin contributor pledge sync')
on conflict (version) do nothing;

commit;

