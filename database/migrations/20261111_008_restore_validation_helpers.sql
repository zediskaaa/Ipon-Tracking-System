-- Restore validation helpers referenced by upgraded RPCs but missing from migration 002.

begin;

create or replace function public.normalize_ph_mobile(p_contact_number text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_number text := btrim(coalesce(p_contact_number, ''));
begin
  if v_number = '' then return null; end if;
  if v_number ~ '^09[0-9]{9}$' then return v_number; end if;
  if v_number ~ '^\+639[0-9]{9}$' then return '0' || substr(v_number, 4); end if;
  raise exception 'Contact number must use 09XXXXXXXXX or +639XXXXXXXXX.' using errcode = '22023';
end;
$$;

create or replace function public.validated_money(p_amount numeric, p_label text)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_amount is null or p_amount <= 0 then
    raise exception '% must be greater than zero.', p_label using errcode = '22023';
  end if;
  if p_amount > 999999999999.99 then
    raise exception '% must not exceed 999999999999.99.', p_label using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception '% must have no more than two decimal places.', p_label using errcode = '22023';
  end if;
  return p_amount;
end;
$$;

revoke execute on function public.normalize_ph_mobile(text) from public, anon, authenticated;
revoke execute on function public.validated_money(numeric, text) from public, anon, authenticated;

insert into public.schema_migrations (version, name)
values ('20261111_008', 'restore validation helper functions')
on conflict (version) do nothing;

commit;
