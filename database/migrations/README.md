# Database migrations

`schema.sql` is the clean-project baseline. These files upgrade an existing production database in filename order and record successful applications in `public.schema_migrations`.

The migration baseline is the database schema shipped before commit `112f658` (structured names). For an existing project:

1. Back up the database.
2. Run `0000_create_migration_ledger.sql`.
3. Run every later migration in filename order. The files are idempotent, so rerunning an already-applied migration is safe.
4. Verify the ledger:

```sql
select version, name, applied_at
from public.schema_migrations
order by version;
```

Migration `20261110_005` assigns existing savings records to one `Primary Savings Group`. The earliest administrator keeps that group; additional administrator profiles are intentionally left unassigned so they cannot inherit the same financial data. After applying it, bootstrap one platform owner as `SUPER_ADMIN`, then use `super_admin_create_group` to give each additional administrator a separate group.

Migration `20261110_006` adds the atomic administrator request workflow used by the Super Admin panel. Apply it before opening `super-admin.html`.

Migration `20261110_007` completes administrator request details, the User panel, notifications, contribution deadlines, profile security, and managed account workflows. Apply it after `006`, then deploy `supabase/functions/manage-account` so Super Admin and Admin account-creation forms can create Auth users without exposing the service-role key.

Do not edit an applied migration. Add the next numbered file for every future production database change, update `schema.sql` to the same final state, and test the sequence against a restored copy before production.
