# Supabase server functions

`manage-account` creates Auth users without exposing the service-role key to the browser. Deploy it after applying all database migrations:

```sh
supabase functions deploy manage-account
```

The hosted Supabase environment automatically supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep JWT verification enabled. Never put the service-role key in `js/config.js`.

Apply migration `20261112_014_enforce_opt_in_mfa.sql`, enable TOTP enrollment and verification in hosted Auth settings, and allow the deployed `reset-password.html` URL in Auth redirect URLs. Local Auth uses `supabase/templates/recovery.html`; the hosted default reset-link template works without customization. Use custom SMTP later when a verified sending domain is available.

For automatic dashboard refresh, apply `database/migrations/20261111_010_enable_dashboard_realtime.sql` to the hosted database. It adds the dashboard source tables to the `supabase_realtime` publication; existing RLS policies still determine which changes each signed-in role can receive.

For automatic contribution reminders, enable Supabase Cron and schedule this SQL daily:

```sql
select public.create_due_reminders();
```

Also schedule `select public.generate_all_contribution_periods(current_date);` for the first day of every month. The function is intentionally unavailable to browser roles and is safe to rerun because existing member/month periods are ignored.
