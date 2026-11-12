# IPON release verification checklist

Complete this checklist on the exact commit that will be deployed. Record any failed item before release; do not rely on memory or a different local branch.

## 1. Code and automated checks

- [ ] `git status --short` is clean.
- [ ] Local `main` matches `origin/main`.
- [ ] `npm test` passes with no failed or skipped tests.
- [ ] The latest GitHub Actions **Quality checks** run is green.
- [ ] No real password, service-role key, or private token is present in tracked files.
- [ ] `js/config.js` contains only the intended Supabase project URL and publishable/anon key.

## 2. Database and recovery

- [ ] A current Supabase database backup is available and its restore procedure is known.
- [ ] Pending SQL files in `database/migrations/` were tested against a restored copy first.
- [ ] Pending migrations were applied in filename order.
- [ ] Migration `20261110_007_complete_account_notifications.sql` was applied after `006`.
- [ ] `public.schema_migrations` lists every shipped migration exactly once.
- [ ] `database/schema.sql` still represents the final clean-install schema.
- [ ] Row-level security remains enabled on profiles, members, contributions, withdrawals, expenses, goals, and audit logs.
- [ ] Confirmed financial records cannot be edited directly; correction uses void plus replacement.

Ledger verification:

```sql
select version, name, applied_at
from public.schema_migrations
order by version;
```

## 3. Authentication and authorization

- [ ] An administrator request creates a pending account and preserves the entered structured name, contact, and reason.
- [ ] A normal managed account is created only through the deployed `manage-account` Edge Function.
- [ ] Pending and disabled accounts cannot open protected pages.
- [ ] SUPER_ADMIN opens only the platform panel and cannot read group savings records.
- [ ] ADMIN opens only their isolated group data and can create linked member accounts.
- [ ] MEMBER opens the User panel and can view and submit only their own permitted records.
- [ ] TREASURER can perform the intended recording workflows but cannot use admin-only controls.
- [ ] ADMIN can review entries, manage access, and open the read-only audit log.
- [ ] A non-admin cannot read `audit_logs` through the Supabase API.
- [ ] The last active administrator cannot accidentally remove their own required admin access.
- [ ] Sign out clears the local session and returns to the login page.

## 4. Critical financial workflows

- [ ] Addition submission creates the correct pending or confirmed state for the current role.
- [ ] Deduction and expense submissions require valid positive amounts and required details.
- [ ] Confirm, reject, and void actions require the expected confirmation/reason.
- [ ] Duplicate submission protection prevents a repeated request from creating a second record.
- [ ] Dashboard totals include confirmed entries only and calculate additions minus deductions and expenses.
- [ ] Calendar activity, monthly reports, contribution status, and CSV export match the same confirmed data.
- [ ] Contribution deadline and reminder notifications match the configured deadline day.
- [ ] Notification read state and notification preference persist after refresh.
- [ ] Table status filters, member search, and Previous/Next pagination return correct server-side results.
- [ ] Audit log records the actor, action, record type, and time for tested changes.

## 5. Usability and accessibility

- [ ] Keyboard-only navigation reaches all links, forms, tabs, dialogs, calendar days, and table actions.
- [ ] Focus indicators remain visible and login tabs work with Arrow, Home, and End keys.
- [ ] Form errors identify the affected field and preserve entered values.
- [ ] Loading, empty, success, error, and Retry states are understandable with a screen reader.
- [ ] Text and controls remain readable at 200% browser zoom.
- [ ] Calendar days are usable by touch and day details open and close on a phone.
- [ ] No horizontal page overflow occurs at 390 px, 768 px, 1280 px, and 1920 px widths.

## 6. Browser, network, and deployment smoke test

- [ ] The `manage-account` Edge Function is deployed with JWT verification enabled.
- [ ] A daily Supabase Cron job calls `public.create_due_reminders()`.
- [ ] A monthly Supabase Cron job calls `public.generate_all_contribution_periods(current_date)` before reminders run.
- [ ] Login and the critical workflows pass in current Chrome or Edge and one additional browser.
- [ ] A slow connection shows loading feedback without duplicate saves.
- [ ] An offline or failed Supabase request shows recovery guidance and Retry where applicable.
- [ ] The production URL loads over HTTPS with no console errors or failed required assets.
- [ ] CSP, frame protection, referrer policy, and permissions policy headers are present in production responses.
- [ ] The deployed commit SHA is recorded in the release notes.

## 7. Release and rollback

- [ ] Release notes describe user-visible changes and database migrations.
- [ ] The person responsible for post-release verification is identified.
- [ ] After deployment, repeat login, one read-only dashboard check, and one reversible test workflow.
- [ ] If the frontend fails, redeploy the last known-good commit.
- [ ] Do not reverse a production migration ad hoc. Use a reviewed forward-fix migration, or restore the verified backup only when incident recovery requires it.
- [ ] Record the release result, unresolved issues, and rollback decision.
