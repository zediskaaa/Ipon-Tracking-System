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

Do not edit an applied migration. Add the next numbered file for every future production database change, update `schema.sql` to the same final state, and test the sequence against a restored copy before production.
