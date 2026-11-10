# Supabase server functions

`manage-account` creates Auth users without exposing the service-role key to the browser. Deploy it after applying all database migrations:

```sh
supabase functions deploy manage-account
```

The hosted Supabase environment automatically supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep JWT verification enabled. Never put the service-role key in `js/config.js`.

For automatic contribution reminders, enable Supabase Cron and schedule this SQL daily:

```sql
select public.create_due_reminders();
```
