-- Move the forced password-change flag out of user-editable metadata.

begin;

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('must_change_password', true),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'must_change_password'
where coalesce(raw_user_meta_data ->> 'must_change_password', 'false') = 'true';

insert into public.schema_migrations (version, name)
values ('20261111_012', 'protect temporary password state')
on conflict (version) do nothing;

commit;
