-- Interpret business dates in Philippine time while keeping the database timezone in UTC.

begin;

alter function public.enforce_data_quality() set timezone to 'Asia/Manila';
alter function public.record_contribution(uuid, date, numeric, date, text, text, uuid) set timezone to 'Asia/Manila';
alter function public.get_user_dashboard() set timezone to 'Asia/Manila';
alter function public.create_due_reminders() set timezone to 'Asia/Manila';

alter table public.members
  alter column date_registered set default ((now() at time zone 'Asia/Manila')::date);
alter table public.contributions
  alter column payment_date set default ((now() at time zone 'Asia/Manila')::date);
alter table public.expenses
  alter column transaction_date set default ((now() at time zone 'Asia/Manila')::date);
alter table public.withdrawals
  alter column transaction_date set default ((now() at time zone 'Asia/Manila')::date);

insert into public.schema_migrations (version, name)
values ('20261111_009', 'use Philippine business date')
on conflict (version) do nothing;

commit;
