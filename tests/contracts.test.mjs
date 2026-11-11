import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('all browser scripts pass syntax validation', () => {
  const directory = fileURLToPath(new URL('../js/', import.meta.url));
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', join(directory, file)]);
  }
});

test('database keeps financial writes behind RLS and reviewed RPCs', () => {
  const schema = read('database/schema.sql');
  for (const table of ['profiles', 'members', 'contributions', 'expenses', 'withdrawals', 'audit_logs']) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(schema, /create policy audit_logs_select[\s\S]*?group_id = public\.current_group_id\(\)/i);
  assert.match(schema, /revoke all on public\.profiles,[\s\S]*?public\.audit_logs[\s\S]*?from authenticated/i);
  assert.match(schema, /grant select on public\.profiles,[\s\S]*?public\.audit_logs, public\.groups to authenticated/i);
  assert.match(read('database/migrations/20261110_001_lock_confirmed_financial_records.sql'), /Only pending contributions can be edited/i);
});

test('savings data is isolated by database-enforced group scope', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261110_005_isolate_savings_groups.sql');
  for (const table of ['members', 'contribution_settings', 'contribution_periods', 'contributions', 'expenses', 'withdrawals', 'savings_goals']) {
    assert.match(schema, new RegExp(`alter table public\\.${table} add column if not exists group_id uuid not null`, 'i'));
  }
  assert.match(schema, /create or replace function public\.enforce_group_scope\(\)/i);
  assert.match(schema, /You cannot access another savings group/i);
  assert.match(schema, /create policy contributions_select[\s\S]*?group_id = public\.current_group_id\(\)/i);
  assert.match(schema, /create or replace function public\.get_savings_summary\(\)[\s\S]*?group_id = public\.current_group_id\(\)/i);
  assert.match(migration, /Primary Savings Group/);
  assert.match(migration, /alter table public\.members alter column group_id set not null/i);
});

test('financial references and withdrawal RPCs respect group roles', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261111_011_scope_references_and_restrict_withdrawals.sql');
  for (const column of ['transaction_reference', 'reference_number']) {
    assert.match(schema, new RegExp(`on public\\.(?:contributions|expenses|withdrawals) \\(group_id, lower\\(btrim\\(${column}\\)\\)\\)`, 'i'));
  }
  assert.match(migration, /if v_role not in \('ADMIN', 'TREASURER'\) then raise exception 'Only administrators and treasurers can record withdrawals\.'/i);
  assert.match(migration, /create or replace function public\.update_withdrawal[\s\S]*?if v_role not in \('ADMIN', 'TREASURER'\)/i);
});

test('public signup cannot bootstrap privileged access', () => {
  const schema = read('database/schema.sql');
  const handler = schema.match(/create or replace function public\.handle_new_user\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(schema, /'SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER'/);
  assert.match(handler, /'MEMBER'::public\.app_role/);
  assert.match(handler, /'PENDING'::public\.account_status/);
  assert.doesNotMatch(handler, /not exists \(select 1 from public\.profiles\)/i);
  assert.match(schema, /create or replace function public\.super_admin_create_group\(p_name text, p_admin_id uuid\)/i);
});

test('Super Admin panel is role-routed and excludes savings operations', () => {
  const html = read('super-admin.html');
  const script = read('js/super-admin.js');
  const core = read('js/core.js');
  assert.match(html, /data-panel="super-admin"/);
  assert.match(html, /id="requests-body"/);
  assert.match(html, /id="administrators-body"/);
  for (const view of ['overview', 'requests', 'administrators', 'activity']) {
    assert.match(html, new RegExp(`data-platform-view="${view}"`));
    assert.match(core, new RegExp(`super-admin\\.html#${view}`));
  }
  assert.match(script, /addEventListener\('hashchange'/);
  assert.match(html, /id="platform-attention"/);
  assert.match(html, /id="overview-error"/);
  assert.match(script, /Ipon\.init\(\{ allowedRoles: \['SUPER_ADMIN'\] \}\)/);
  assert.match(script, /super_admin_approve_request/);
  assert.match(script, /super_admin_reject_request/);
  assert.match(script, /super_admin_set_administrator_status/);
  assert.match(script, /subscribeToChanges\('super-admin'/);
  assert.doesNotMatch(script, /from\(['"](?:contributions|withdrawals|expenses|members)['"]\)/);
  assert.match(core, /function homeForRole\(role\)/);
  assert.match(core, /\['super-admin', 'account'\]\.includes\(document\.body\.dataset\.page\)/);
  assert.match(core, /role === 'SUPER_ADMIN' \? 'super-admin\.html' : role === 'MEMBER' \? 'user\.html' : 'dashboard\.html'/);
});

test('all three role dashboards subscribe to permitted database changes', () => {
  const core = read('js/core.js');
  const realtimeHelper = core.match(/function subscribeToChanges[\s\S]*?return channel;/)?.[0] || '';
  assert.match(realtimeHelper, /\['INSERT', 'UPDATE'\]/);
  assert.doesNotMatch(realtimeHelper, /'DELETE'/);
  assert.match(read('js/dashboard.js'), /subscribeToChanges\('dashboard'/);
  assert.match(read('js/user.js'), /subscribeToChanges\('member-dashboard'/);
  assert.match(read('js/reports.js'), /subscribeToChanges\('reports'/);
  assert.match(read('database/migrations/20261111_010_enable_dashboard_realtime.sql'), /alter publication supabase_realtime add table/i);
});

test('dashboard refresh failures never mix stale totals with cleared sections', () => {
  const dashboard = read('js/dashboard.js');
  assert.match(read('dashboard.html'), /id="dashboard-data-status"[^>]*role="status"/);
  assert.match(dashboard, /if \(!hasSnapshot\) renderEmptySnapshot\(\)/);
  assert.match(dashboard, /previous complete snapshot remains visible and may be outdated/);
  assert.doesNotMatch(dashboard, /catch \(error\) \{ Ipon\.toast\([\s\S]*?renderCalendar\(\[\]\); renderPending\(\[\]\); \}/);
});

test('three panels have separate routes and backend-owned account workflows', () => {
  const core = read('js/core.js');
  const userHtml = read('user.html');
  const userScript = read('js/user.js');
  const accountHtml = read('account.html');
  const migration = read('database/migrations/20261110_007_complete_account_notifications.sql');
  const edgeFunction = read('supabase/functions/manage-account/index.ts');
  assert.match(core, /user: \['MEMBER'\]/);
  assert.match(userHtml, /data-page="user"/);
  assert.match(userScript, /allowedRoles: \['MEMBER'\]/);
  assert.match(userScript, /get_user_dashboard/);
  assert.match(accountHtml, /id="password-form"/);
  assert.match(migration, /create table if not exists public\.admin_requests/i);
  assert.match(migration, /create table if not exists public\.notifications/i);
  assert.match(migration, /alter table public\.notifications enable row level security/i);
  assert.match(migration, /recipient_id = auth\.uid\(\)/i);
  assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(read('js/core.js') + read('js/super-admin.js') + read('js/members.js'), /SERVICE_ROLE_KEY/);
});

test('new passwords use one strong policy in browser and Edge boundaries', () => {
  const core = read('js/core.js');
  const edge = read('supabase/functions/manage-account/index.ts');
  assert.match(core, /value\.length < 12 \|\| value\.length > 128/);
  assert.match(core, /Do not include your name or email/);
  assert.match(edge, /password\.length >= 12 && password\.length <= 128/);
  assert.match(edge, /Password must not contain the account name or email/);
  for (const file of ['account.html', 'members.html', 'super-admin.html']) assert.match(read(file), /minlength="12"[^>]*maxlength="128"/i);
  assert.match(read('js/auth.js'), /Ipon\.passwordIssue/);
  assert.match(core, /function bindPasswordStrength/);
  assert.match(read('README.md'), /minimum length of 12/);
});

test('temporary password state is server-owned and cleared by the Edge workflow', () => {
  const core = read('js/core.js');
  const auth = read('js/auth.js');
  const edge = read('supabase/functions/manage-account/index.ts');
  const migration = read('database/migrations/20261111_012_protect_temporary_password_state.sql');
  assert.match(edge, /app_metadata: \{ must_change_password: true \}/);
  assert.match(edge, /body\.action === 'change-password'/);
  assert.match(edge, /updateUserById\(userResult\.user\.id/);
  assert.match(core + auth, /user\.app_metadata\?\.must_change_password/);
  assert.doesNotMatch(core + auth, /user\.user_metadata\?\.must_change_password/);
  assert.doesNotMatch(core, /updateUser\(\{ password, data:/);
  assert.match(migration, /raw_app_meta_data[\s\S]*?raw_user_meta_data[\s\S]*?- 'must_change_password'/);
});

test('account settings open from the responsive identity control', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  const dashboard = read('dashboard.html');
  assert.match(core, /data-account-open/);
  assert.match(dashboard, /data-account-open/);
  assert.match(core, /id="account-dialog"/);
  assert.match(core, /function bindAccountDialog\(\)/);
  assert.match(core, /update_own_profile/);
  assert.doesNotMatch(core, /\['account', 'account\.html', 'My account'/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(44px,1fr\)\)/);
  assert.match(css, /\.account-dialog\{width:100%;height:100dvh/);
});

test('calendar navigation includes the administrator audit log', () => {
  assert.match(read('dashboard.html'), /href="audit\.html" data-role="ADMIN"[^>]*>[\s\S]*?<span>Audit log<\/span>/);
});

test('logout protects restored pages from browser history', () => {
  const core = read('js/core.js');
  assert.match(core, /addEventListener\('pagehide'[\s\S]*?visibility = 'hidden'/);
  assert.match(core, /addEventListener\('pageshow'[\s\S]*?event\.persisted[\s\S]*?auth\.getSession\(\)[\s\S]*?location\.replace\('login\.html'\)/);
  assert.match(core, /homeForRole, signOut, toast/);
  assert.match(core, /signOut\(\)[\s\S]*?confirmAction\(\{ title: 'Sign out\?'/);
  assert.match(read('js/dashboard.js'), /addEventListener\('click', Ipon\.signOut\)/);
});

test('notifications use a responsive non-blocking activity panel', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  assert.match(core, /notifications\.show\(\)/);
  assert.doesNotMatch(core, /notifications\?\.showModal\(\)/);
  assert.match(core, /notification-item-icon/);
  assert.match(core, /notification-unread/);
  assert.doesNotMatch(core, /<span>Notifications<\/span>/);
  assert.doesNotMatch(read('dashboard.html'), /<span>Notifications<\/span>/);
  assert.match(core, /headerBottom = button\.closest\('\.app-sidebar'\)/);
  assert.match(core, /dashboard-sidebar'[\s\S]*?max-width:860px/);
  assert.match(css, /\.sidebar-utility\[data-notifications-open\]\{position:fixed;[^}]*inset:16px 16px auto auto;[^}]*width:44px/);
  assert.match(css, /\.notification-dialog\{position:fixed;[^}]*inset:68px 16px auto auto;[^}]*height:min\(620px/);
  assert.match(css, /\.notification-list\{[^}]*flex:1;[^}]*overflow-y:auto/);
  assert.match(css, /@media\(max-width:720px\)\{\.app-sidebar-footer \.sidebar-utilities\{order:1\}[\s\S]*?\.notification-dialog/);
});

test('compact dashboard header keeps notifications, profile, and logout in one ordered row', () => {
  const dashboardCss = read('css/hero-plates.css');
  const appCss = read('css/app.css');
  assert.match(appCss, /\.app-sidebar-footer\s*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(appCss, /\.sidebar-user-card\s*\{[^}]*grid-column:1\/-1;[^}]*grid-row:1/);
  assert.match(appCss, /\.sidebar-signout\s*\{[^}]*grid-column:2;[^}]*grid-row:2/);
  assert.match(dashboardCss, /@media \(max-width:860px\)[\s\S]*?\.dashboard-sidebar \.app-sidebar-footer\s*\{[^}]*grid-row:1/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-signout\s*\{[^}]*order:3/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-user-card\s*\{[^}]*order:2/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-utilities\s*\{[^}]*order:1/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-utility\[data-donate-open\]\s*\{\s*display:none/);
  assert.match(appCss, /@media\(max-width:720px\)\{\.app-sidebar-footer \.sidebar-utilities\{order:1\}\.sidebar-user-card\{order:2\}\.sidebar-signout\{order:3\}/);
});

test('security-sensitive email recovery actions require confirmation', () => {
  const members = read('js/members.js');
  const superAdmin = read('js/super-admin.js');
  assert.match(members, /action === 'reset'[\s\S]*?confirmAction\([\s\S]*?resetPasswordForEmail/);
  assert.match(superAdmin, /if \(reset\)[\s\S]*?confirmAction\([\s\S]*?resetPasswordForEmail/);
});

test('deadline backfill bypasses only the group-scope trigger during migration', () => {
  const migration = read('database/migrations/20261110_007_complete_account_notifications.sql');
  const disabled = migration.indexOf('disable trigger contribution_periods_group_scope');
  const backfill = migration.indexOf('update public.contribution_periods');
  const enabled = migration.indexOf('enable trigger contribution_periods_group_scope');
  assert.ok(disabled >= 0 && disabled < backfill, 'group-scope trigger must be disabled before the backfill');
  assert.ok(enabled > backfill, 'group-scope trigger must be restored after the backfill');
});

test('upgraded databases receive every validation helper used by RPCs', () => {
  const migration = read('database/migrations/20261111_008_restore_validation_helpers.sql');
  assert.match(migration, /create or replace function public\.normalize_ph_mobile\(p_contact_number text\)/i);
  assert.match(migration, /create or replace function public\.validated_money\(p_amount numeric, p_label text\)/i);
  assert.match(migration, /revoke execute on function public\.normalize_ph_mobile\(text\) from public, anon, authenticated/i);
  assert.match(migration, /revoke execute on function public\.validated_money\(numeric, text\) from public, anon, authenticated/i);
});

test('business-date validation uses Philippine time without changing database timezone', () => {
  const migration = read('database/migrations/20261111_009_use_philippine_business_date.sql');
  assert.match(migration, /alter function public\.enforce_data_quality\(\) set timezone to 'Asia\/Manila'/i);
  assert.match(migration, /alter function public\.create_due_reminders\(\) set timezone to 'Asia\/Manila'/i);
  assert.match(migration, /now\(\) at time zone 'Asia\/Manila'/i);
  assert.doesNotMatch(migration, /alter database/i);
});

test('administrator approval and group creation are atomic database operations', () => {
  const migration = read('database/migrations/20261110_006_super_admin_account_workflow.sql');
  assert.match(migration, /create or replace function public\.super_admin_approve_request\(p_user_id uuid, p_group_name text\)/i);
  assert.match(migration, /update public\.profiles[\s\S]*?insert into public\.groups[\s\S]*?update public\.profiles set group_id/i);
  assert.match(migration, /create or replace function public\.super_admin_reject_request\(p_user_id uuid\)/i);
  assert.match(migration, /public\.is_super_admin\(\)/i);
  assert.doesNotMatch(migration, /service_role/i);
});

test('every versioned migration is transactional and recorded', () => {
  const directory = new URL('../database/migrations/', import.meta.url);
  const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(migrations.length >= 3);
  for (const file of migrations) {
    const sql = readFileSync(new URL(file, directory), 'utf8');
    assert.match(sql, /^begin;/im, `${file} must begin a transaction`);
    assert.match(sql, /^commit;/im, `${file} must commit its transaction`);
    assert.match(sql, /schema_migrations/i, `${file} must update the migration ledger`);
  }
});

test('SQL dollar quotes are balanced in the baseline and every migration', () => {
  const migrations = readdirSync(new URL('../database/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).map((name) => `database/migrations/${name}`);
  for (const file of ['database/schema.sql', ...migrations]) {
    const sql = read(file);
    assert.doesNotMatch(sql, /\$\$name\$/, `${file} contains a malformed name dollar quote`);
    assert.equal((sql.match(/\$\$/g) || []).length % 2, 0, `${file} has an unbalanced dollar quote`);
    assert.equal((sql.match(/\$name\$/g) || []).length % 2, 0, `${file} has an unbalanced name dollar quote`);
  }
});

test('pages keep baseline security and accessible table headings', () => {
  const pages = readdirSync(root).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length >= 10);
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /Content-Security-Policy/i, `${file} must declare a CSP`);
    assert.doesNotMatch(html, /<th>\s*<\/th>/i, `${file} has an unlabeled table column`);
  }
  assert.match(read('login.html'), /role="tab"/);
  assert.match(read('login.html'), /role="tabpanel"/);
});

test('large record lists use server-side counts, filters, and ranges', () => {
  const records = read('js/records.js');
  const members = read('js/members.js');
  assert.match(records, /count: 'exact'/);
  assert.match(records, /\.eq\('approval_status'/);
  assert.match(records, /\.range\(/);
  assert.doesNotMatch(records, /\.limit\(200\)/);
  assert.match(members, /\.ilike\('full_name'/);
  assert.match(members, /\.eq\('status'/);
  assert.match(members, /\.range\(/);
});

test('secondary member and goal editing uses accessible dialogs', () => {
  const membersPage = read('members.html');
  const goalsPage = read('savings.html');
  assert.match(membersPage, /<dialog[^>]+id="member-dialog"[^>]+aria-labelledby="member-form-title"/);
  assert.match(goalsPage, /<dialog[^>]+id="goal-dialog"[^>]+aria-labelledby="goal-form-title"/);
  assert.match(read('js/members.js'), /dialog\.showModal\(\)/);
  assert.match(read('js/savings.js'), /dialog\.showModal\(\)/);
  assert.doesNotMatch(read('js/members.js'), /scrollIntoView/);
  assert.doesNotMatch(read('js/savings.js'), /scrollIntoView/);
});

test('user-facing interface copy is English-only', () => {
  const sources = [
    ...readdirSync(root).filter((name) => name.endsWith('.html')).map(read),
    ...readdirSync(new URL('../js/', import.meta.url)).filter((name) => name.endsWith('.js')).map((name) => read(`js/${name}`)),
    read('database/schema.sql'),
    read('README.md')
  ].join('\n');
  assert.doesNotMatch(sources, /\b(?:ako|ikaw|unang|kasalukuyang|bawal|hindi|kailangan|naipasa|pumili|pumalit|puwede|puwedeng|ibaba|kapalit|iyong|mga|muna|dagdag|bawas|magiging|bilang|wala)\b/i);
});

test('HTML dialogs are balanced and page IDs remain unique', () => {
  for (const file of readdirSync(root).filter((name) => name.endsWith('.html'))) {
    const html = read(file);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${file} contains duplicate IDs`);
    assert.equal((html.match(/<dialog\b/g) || []).length, (html.match(/<\/dialog>/g) || []).length, `${file} contains an unbalanced dialog`);
  }
});

test('modal forms and settings layout include responsive fallbacks', () => {
  const css = read('css/app.css');
  assert.match(css, /\.field\s*\{[^}]*align-content:start/i);
  assert.match(css, /\.form-grid-3\s*\{[^}]*grid-template-columns:repeat\(3/i);
  assert.match(css, /\.settings-grid\s*\{[^}]*grid-template-columns:/i);
  assert.match(css, /\.form-dialog\s*\{[^}]*max-height:/i);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.form-grid-3\s*\{[^}]*grid-template-columns:1fr/i);
});

test('administrator request form uses a desktop grid with a mobile fallback', () => {
  const html = read('login.html');
  const script = read('js/auth.js');
  assert.match(script, /document\.body\.classList\.toggle\('is-request-mode', signup\)/);
  assert.match(html, /body\.is-request-mode \.login-card \.form-grid\{grid-template-columns:repeat\(6/);
  assert.match(html, /#first-name-field,#middle-name-field,#last-name-field\)\{grid-column:span 2\}/);
  assert.match(html, /#contact-number-field,#email-field,#password-field,#password-confirmation-field\)\{grid-column:span 3\}/);
  assert.match(html, /@media\(max-width:780px\)[\s\S]*?body\.is-request-mode \.login-card \.form-grid\{grid-template-columns:1fr/);
});

test('mobile navigation and data tables do not require horizontal scrolling', () => {
  const css = read('css/app.css');
  const dashboardCss = read('css/hero-plates.css');
  const core = read('js/core.js');
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.app-nav\s*\{[^}]*display:grid/i);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.record-tabs\s*\{[^}]*grid-template-columns:repeat\(4/i);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.data-table td\s*\{[^}]*grid-template-columns:/i);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.data-table td > \*\s*\{[^}]*grid-column:2/i);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.toast\s*\{[^}]*left:12px/i);
  assert.match(dashboardCss, /@media \(max-width:860px\)[\s\S]*?\.dashboard-sidebar \.sidebar-nav\s*\{[^}]*display:grid/i);
  assert.match(dashboardCss, /@media \(max-width:860px\)[\s\S]*?\.summary-hero-body\s*\{[^}]*flex-direction:column/i);
  assert.match(dashboardCss, /@media \(max-width:860px\)[\s\S]*?\.record-entry-action\s*\{[^}]*width:100%/i);
  assert.match(core, /function prepareResponsiveTables\(\)/);
  assert.match(core, /cell\.dataset\.label/);
  assert.match(css, /html\s*\{[^}]*overflow-x:clip/);
  assert.match(css, /body\s*\{[^}]*overflow-x:clip/);
  assert.doesNotMatch(css.match(/@media \(max-width:720px\)[\s\S]*?(?=@media \(prefers-reduced-motion)/)?.[0] || '', /overflow-x:auto/i);
  assert.doesNotMatch(dashboardCss.match(/@media \(max-width:860px\)[\s\S]*?(?=@media \(prefers-reduced-motion)/)?.[0] || '', /overflow-x:auto/i);
});

test('reports keep a compact desktop rhythm', () => {
  const html = read('reports.html');
  const css = read('css/app.css');
  assert.equal((html.match(/class="panel report-panel"/g) || []).length, 3);
  assert.match(css, /\.report-panel\s*\{[^}]*padding:20px 22px/);
  assert.match(css, /\.report-chart\{height:240px\}/);
});

test('shared desktop surfaces use a compact layout rhythm', () => {
  const css = read('css/app.css');
  assert.match(css, /\.workspace\s*\{[^}]*padding:28px clamp\(20px,3vw,44px\) 48px/);
  assert.match(css, /\.panel\s*\{[^}]*padding:20px 22px/);
  assert.match(css, /\.data-table th,\.data-table td\s*\{[^}]*padding:11px 10px/);
  assert.match(css, /\.form-grid\s*\{[^}]*gap:16px/);
  assert.match(css, /@media \(max-width:980px\)[\s\S]*?\.workspace\s*\{[^}]*padding:26px 22px 44px/);
});

test('loading feedback uses savings motion with reduced-motion support', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  assert.match(core, /class="savings-loader"/);
  assert.match(core, /class="piggy-bank"/);
  assert.match(core, /class="loader-coin"/);
  assert.match(core, /classList\.toggle\('is-busy', busy\)/);
  assert.match(css, /@keyframes coin-spin/);
  assert.match(css, /@keyframes coin-pulse/);
  assert.doesNotMatch(css, /\.loader-sheet::before/);
  assert.match(css, /@keyframes coin-flip/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)[^}]*[\s\S]*?\.loader-coin/);
  assert.match(read('dashboard.html'), /app\.css\?v=\d/);
  assert.match(read('dashboard.html'), /core\.js\?v=\d/);
});

test('calendar supports direct month and year navigation', () => {
  const html = read('dashboard.html');
  const script = read('js/dashboard.js');
  const css = read('css/hero-plates.css');
  assert.match(html, /id="calendar-jump-dialog"/);
  assert.match(html, /id="calendar-jump-month"/);
  assert.match(html, /id="calendar-jump-year"/);
  assert.match(html, /id="calendar-jump-today"/);
  assert.match(script, /function navigateTo\(date\)/);
  assert.match(script, /classList|is-today/);
  assert.match(css, /\.mobile-calendar-jump/);
});

test('dashboard lets users choose the calendar tracking goal without a default completion metric', () => {
  const html = read('dashboard.html');
  const script = read('js/dashboard.js');
  const css = read('css/app.css');
  assert.match(html, /id="calendar-goal-select"[^>]*>[\s\S]*?General savings/);
  assert.match(html, /id="mobile-calendar-goal-select"[^>]*>[\s\S]*?General savings/);
  assert.doesNotMatch(html, /id="dashboard-completion"/);
  assert.match(script, /from\('savings_goals'\)\.select\('id,title'\)[\s\S]*?eq\('status', 'ACTIVE'\)/);
  assert.match(script, /renderGoalOptions\(goalResult\.data \|\| \[\]\)/);
  assert.match(script, /goalSelects\.forEach\(\(select\) => select\.addEventListener\('change'/);
  assert.match(script, /subscribeToChanges\('dashboard',[\s\S]*?'savings_goals'/);
  assert.match(css, /\.admin-progress\{grid-column:1\/-1;grid-template-columns:repeat\(4/);
});

test('decorative section labels use an editorial rule instead of dot badges', () => {
  const appCss = read('css/app.css');
  const dashboardCss = read('css/hero-plates.css');
  for (const [selector, css] of [['eyebrow', appCss], ['tracked-label', dashboardCss], ['review-title', dashboardCss]]) {
    const block = css.match(new RegExp(`\\.${selector}\\s*\\{[^}]+\\}`))?.[0] || '';
    assert.match(block, /background:transparent/);
    assert.doesNotMatch(block, /border-radius:999px/);
  }
  assert.match(dashboardCss, /\.tracked-label::before\s*\{[^}]*width:24px[^}]*height:1px/);
});
