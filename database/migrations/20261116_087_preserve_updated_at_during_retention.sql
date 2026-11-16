-- Migration 087: Keep original updated_at intact when backend retention cleanup scrubs expired receipt_url values
-- so clearing a 90-day rejected receipt never falsely resets a dormant group's last activity timestamp.

begin;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null and current_setting('ipon.maintenance_retention_cleanup', true) = 'on' then
    return new;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

insert into public.schema_migrations (version, name)
values ('20261116_087', 'preserve updated_at timestamps during automated retention receipt cleanup')
on conflict (version) do nothing;

commit;
