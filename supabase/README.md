# Supabase server functions

`manage-account` creates Auth users without exposing the service-role key to the browser. Deploy it after applying all database migrations:

```sh
supabase functions deploy manage-account
```

The hosted Supabase environment automatically supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. Keep JWT verification enabled. Never put the service-role key in `js/config.js`.

Migration `20261112_014_enforce_opt_in_mfa.sql` is applied by the database deployment workflow after it reaches `main`. Enable TOTP enrollment and verification in hosted Auth settings, and allow the deployed `reset-password.html` URL in Auth redirect URLs. Local Auth uses `supabase/templates/recovery.html`; the hosted default reset-link template works without customization. Use custom SMTP later when a verified sending domain is available.

Migration `database/migrations/20261111_010_enable_dashboard_realtime.sql` enables automatic dashboard refresh and is also applied by the database deployment workflow. It adds the dashboard source tables to the `supabase_realtime` publication; existing RLS policies still determine which changes each signed-in role can receive.

## Cloudflare R2 private media

The `manage-account` function stores new chat, announcement, and record-comment files in the private `myipon-private-media` R2 bucket when all four secrets below are configured. Existing Supabase Storage paths remain readable and deletable, and missing R2 configuration safely keeps new uploads on Supabase Storage.

```sh
supabase secrets set \
  R2_ACCOUNT_ID=4b0fc7ef59cd45a047da632eba75d8af \
  R2_ACCESS_KEY_ID=... \
  R2_SECRET_ACCESS_KEY=... \
  R2_BUCKET=myipon-private-media
```

Keep the bucket private. Its R2 token only needs Object Read & Write access to that bucket. Configure this bucket CORS policy before deploying the function:

```json
[
  {
    "AllowedOrigins": ["https://my-ipon.vercel.app"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Never put R2 credentials in `js/config.js`. The browser receives short-lived, single-object signed URLs only.

For automatic contribution reminders, enable Supabase Cron and schedule this SQL daily:

```sql
select public.create_due_reminders();
```

Also schedule `select public.generate_all_contribution_periods(current_date);` for the first day of every month. The function is intentionally unavailable to browser roles and is safe to rerun because existing member/month periods are ignored.
