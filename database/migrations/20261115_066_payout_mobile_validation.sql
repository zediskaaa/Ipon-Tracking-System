-- Enforce PH mobile number validation (09XXXXXXXXX / +639XXXXXXXXX) for GCash & Maya payout accounts.

begin;

create or replace function public.validated_payout_account(
  p_channel text,
  p_account_number text,
  p_account_name text
)
returns table (
  out_channel text,
  out_account_number text,
  out_account_name text
)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_channel text := public.normalized_payment_method(p_channel);
  v_number text := nullif(btrim(coalesce(p_account_number, '')), '');
  v_name text := nullif(btrim(coalesce(p_account_name, '')), '');
begin
  if v_number is not null and char_length(v_number) > 80 then
    raise exception 'Payout account number must not exceed 80 characters.' using errcode = '22023';
  end if;
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'Payout account name must not exceed 120 characters.' using errcode = '22023';
  end if;
  if v_channel is null and (v_number is not null or v_name is not null) then
    raise exception 'Select a payout channel before saving account details.' using errcode = '22023';
  end if;
  if v_channel in ('GCASH', 'MAYA', 'BANK_TRANSFER') and v_number is null then
    raise exception 'Enter an account or mobile number for % payouts.',
      replace(initcap(replace(v_channel, '_', ' ')), 'Gcash', 'GCash')
      using errcode = '22023';
  end if;
  if v_channel in ('GCASH', 'MAYA') then
    v_number := public.normalize_ph_mobile(v_number);
  end if;

  out_channel := v_channel;
  out_account_number := v_number;
  out_account_name := v_name;
  return next;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261115_066', 'payout mobile validation')
on conflict (version) do nothing;

commit;
