begin;

alter type public.app_role add value if not exists 'SUPER_ADMIN' before 'ADMIN';

insert into public.schema_migrations (version, name)
values ('20261110_004', 'add super administrator role')
on conflict (version) do nothing;

commit;
