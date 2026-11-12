-- Require a valid Philippine mobile number whenever a user saves their own profile.

begin;

create or replace function public.update_own_profile(
  p_first_name text,
  p_middle_name text,
  p_last_name text,
  p_contact_number text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_first text := public.validated_name_part(p_first_name, 'First name');
  v_middle text := public.validated_name_part(p_middle_name, 'Middle name', false);
  v_last text := public.validated_name_part(p_last_name, 'Last name');
  v_contact text := public.normalize_ph_mobile(p_contact_number);
begin
  if v_contact is null then
    raise exception 'Mobile number is required.' using errcode = '22023';
  end if;

  update public.profiles
  set first_name = v_first,
      middle_name = v_middle,
      last_name = v_last,
      full_name = concat_ws(' ', v_first, v_middle, v_last),
      contact_number = v_contact
  where id = auth.uid() and status = 'ACTIVE';

  if not found then
    raise exception 'Active profile not found.' using errcode = 'P0002';
  end if;

  insert into public.account_activity (user_id, event)
  values (auth.uid(), 'PROFILE_UPDATE');
end;
$$;

revoke execute on function public.update_own_profile(text, text, text, text) from public, anon;
grant execute on function public.update_own_profile(text, text, text, text) to authenticated;

insert into public.schema_migrations (version, name)
values ('20261112_015', 'require mobile number on profile updates')
on conflict (version) do nothing;

commit;
