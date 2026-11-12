# IPON Tracking System

Track real-world group savings contributions, deductions, expenses, goals, deadlines, and approvals. This is a tracking system, not a virtual wallet.

## Application panels

- **Super Admin** manages administrator requests, administrator accounts, and isolated savings groups. Super Admin cannot access group financial records.
- **Admin** manages members, managed member accounts, contribution settings, approvals, reports, and audit history for one savings group.
- **User** views personal contribution progress and history, submits additions for review, manages profile security, and receives reminders.

## Existing Supabase project upgrade

Back up the database, then run the SQL files in `database/migrations/` in filename order. For the current release, migration `20261110_007_complete_account_notifications.sql` must be applied after `006`.

Deploy the secure account-management function from a terminal authenticated with the Supabase CLI:

```sh
supabase functions deploy manage-account
```

The function uses the hosted `SUPABASE_SERVICE_ROLE_KEY`; never add that key to browser code or `js/config.js`.

To send deadline reminders automatically, enable Supabase Cron and schedule this SQL once per day:

```sql
select public.create_due_reminders();
```

Create a monthly Supabase Cron job on the first day of each month before the reminder job runs:

```sql
select public.generate_all_contribution_periods(current_date);
```

After deployment, sign out and sign in again so the new role route and notification subscription start with a fresh session.

## Release process

Run `npm test`, then complete [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) before publishing a release.

## Supabase Auth settings

Keep the hosted Auth password policy aligned with the application. In the project's Supabase Auth password security settings, use a minimum length of 12 and require at least one lowercase letter, uppercase letter, number, and symbol. Enable leaked-password protection when the project plan supports it. Existing users may continue signing in, but new passwords and password changes must meet the stronger policy.

Enable **App Authenticator (TOTP)** enrollment and verification in the hosted Auth MFA settings. Users can then add one or more authenticator apps from **My account → Sign-in security**. Migration `20261112_014_enforce_opt_in_mfa.sql` requires an AAL2 session across database access and account-management functions after a user enrolls a verified factor.

For password recovery by email code, update the hosted **Reset password** email template to include `{{ .Token }}` instead of relying only on `{{ .ConfirmationURL }}`. Use the subject `{{ .Token }} is your IPON password reset code`; the local equivalent is tracked in `supabase/templates/recovery.html`. Configure custom SMTP before production because the built-in Supabase email service has a low delivery rate limit.
