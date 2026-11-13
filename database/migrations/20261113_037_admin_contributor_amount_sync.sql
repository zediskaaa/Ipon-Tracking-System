begin;

-- Enhance set_admin_contributor to guarantee the monthly contribution amount
-- is applied to the member record and any unpaid current-month period,
-- and return the updated monthly amount in the json response.
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

    -- Update any unpaid contribution period for the current month so the new pledge takes effect immediately
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

      -- Remove empty contribution periods where this member made zero contributions
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

insert into public.schema_migrations (version, name)
values ('20261113_037', '20261113_037_admin_contributor_amount_sync')
on conflict (version) do nothing;

commit;
