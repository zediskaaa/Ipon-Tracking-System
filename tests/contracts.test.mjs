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
  assert.match(html, /id="feature-requests-body"/);
  assert.match(html, /id="administrators-body"/);
  assert.match(html, /id="users-role-filter"/);
  assert.match(html, /id="user-password-dialog"/);
  for (const view of ['overview', 'requests', 'feature-requests', 'administrators', 'activity']) {
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
  assert.match(script, /admin-set-password/);
  assert.match(script, /subscribeToChanges\('super-admin'/);
  assert.doesNotMatch(script, /from\(['"](?:contributions|withdrawals|expenses|members)['"]\)/);
  assert.match(core, /function homeForRole\(role\)/);
  assert.match(core, /\['super-admin', 'account'\]\.includes\(document\.body\.dataset\.page\)/);
  assert.match(core, /role === 'SUPER_ADMIN' \? 'super-admin\.html' : 'dashboard\.html'/);
});

test('users can submit feature requests and Super Admin can review them', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  const html = read('super-admin.html');
  const script = read('js/super-admin.js');
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_016_add_feature_requests.sql');
  assert.match(core, /class="account-support" data-role="ADMIN,TREASURER,MEMBER"/);
  assert.match(css, /body\[data-panel="super-admin"\] \.account-support\{display:none\}/);
  assert.match(core, /id="feature-request-dialog"[\s\S]*?id="feature-request-form"/);
  assert.match(core, /id="feature-request-success"/);
  assert.match(core, /data-feature-request-open[\s\S]*?>Request a feature</);
  assert.match(core, /confirmAction\(\{[\s\S]*?title: 'Submit feature request\?'/);
  assert.match(core, /from\('feature_requests'\)\.insert\(\{ requester_id: currentProfile\.id, title:/);
  assert.match(html, /data-platform-view="feature-requests"/);
  assert.match(script, /from\('feature_requests'\)\.select\('id,requester_id,title,details,status,reviewed_at,reviewed_by,release_version,created_at'\)/);
  assert.match(script, /subscribeToChanges\('super-admin',[\s\S]*?'feature_requests'/);
  assert.match(schema, /create table if not exists public\.feature_requests/i);
  assert.match(migration, /create policy feature_requests_select[\s\S]*?requester_id = auth\.uid\(\) or public\.is_super_admin\(\)/i);
  assert.match(migration, /create policy feature_requests_insert[\s\S]*?requester_id = auth\.uid\(\) and public\.current_user_role\(\) in \('ADMIN', 'TREASURER', 'MEMBER'\)/i);
  assert.match(migration, /create policy mfa_verified_for_opted_in on public\.feature_requests as restrictive/i);
  assert.match(migration, /grant insert \(requester_id, title, details\) on public\.feature_requests to authenticated/i);
});

test('users can submit bug reports with up to 5 images and Super Admin can inspect them', () => {
  const core = read('js/core.js');
  const html = read('super-admin.html');
  const script = read('js/super-admin.js');
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_020_add_bug_reports.sql');
  assert.match(core, /MAX_BUG_IMAGES = 5/);
  assert.match(core, /id="bug-report-dialog"[\s\S]*?id="bug-report-form"/);
  assert.match(core, /id="bug-report-images"[^>]*accept="image\/\*"[^>]*multiple/);
  assert.match(core, /data-bug-report-open[\s\S]*?>Report a bug</);
  assert.match(core, /from\('bug_reports'\)\.insert\(\{ reporter_id: currentProfile\.id, title, description, attachments: bugImages \}\)/);
  assert.match(html, /data-platform-view="bug-reports"/);
  assert.match(html, /id="bug-viewer-dialog"/);
  assert.match(script, /from\('bug_reports'\)\.select\('id,reporter_id,title,description,image_count,created_at'\)/);
  assert.match(script, /subscribeToChanges\('super-admin',[\s\S]*?'bug_reports'/);
  assert.match(schema, /create table if not exists public\.bug_reports/i);
  assert.match(migration, /jsonb_array_length\(attachments\) <= 5/i);
  assert.match(migration, /create policy bug_reports_select[\s\S]*?reporter_id = auth\.uid\(\) or public\.is_super_admin\(\)/i);
  assert.match(migration, /create policy bug_reports_insert[\s\S]*?reporter_id = auth\.uid\(\) and public\.current_user_role\(\) in \('ADMIN', 'TREASURER', 'MEMBER'\)/i);
  assert.match(migration, /create policy mfa_verified_for_opted_in on public\.bug_reports as restrictive/i);
  assert.match(migration, /grant insert \(reporter_id, title, description, attachments\) on public\.bug_reports to authenticated/i);
});

test('users can upload display pictures and calendar days show up to 4 contributor avatars plus modal details', () => {
  const core = read('js/core.js');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const migration = read('database/migrations/20261112_022_user_avatars_and_calendar_contributors.sql');
  assert.match(core, /id="quick-avatar-input"[^>]*accept="image\/\*"/);
  assert.match(core, /rpc\('update_own_avatar'/);
  assert.match(core, /id="avatar-crop-dialog"/);
  assert.match(core, /id="avatar-crop-canvas"/);
  assert.match(core, /function openAvatarCropper\(/);
  assert.match(core, /confirmAction\(\{\s*title:\s*'Remove display picture\?'/);
  assert.match(dashboardHtml, /id="day-contributors-dialog"/);
  assert.match(dashboardJs, /contributors\.slice\(0, 4\)/);
  assert.match(dashboardJs, /day-avatar-more/);
  assert.match(dashboardJs, /function openDayModal\(date\)/);
  assert.match(migration, /create or replace function public\.group_member_avatar\(p_member_id uuid\)/i);
  assert.match(migration, /create or replace function public\.update_own_avatar\(p_avatar_url text\)/i);
  assert.match(migration, /subject_avatar_url/i);
});

test('Owner and Admins can post and delete unlimited-length announcements with pictures or videos synced live', () => {
  const core = read('js/core.js');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const superAdminHtml = read('super-admin.html');
  const superAdminJs = read('js/super-admin.js');
  const edge = read('supabase/functions/manage-account/index.ts');
  const migration = read('database/migrations/20261112_023_add_announcements.sql');
  const css = read('css/app.css');
  assert.match(dashboardHtml, /id="dashboard-announcement-list"/);
  assert.match(dashboardHtml, /id="dashboard-add-announcement"/);
  assert.match(superAdminHtml, /id="sa-announcement-list"/);
  assert.match(superAdminHtml, /id="sa-add-announcement"/);
  assert.match(dashboardJs, /subscribeToChanges\('dashboard',[\s\S]*?'announcements'/);
  assert.match(superAdminJs, /subscribeToChanges\('super-admin',[\s\S]*?'announcements'/);
  assert.match(core, /id="announcement-media-input"[^>]*accept="image\/\*,video\/\*"/);
  assert.doesNotMatch(core, /id="announcement-(?:title|description)-input"[^>]*maxlength/i);
  assert.match(core, /announcement-role-badge is-owner/);
  assert.match(core, /announcement-author[\s\S]*?is-owner/);
  assert.match(core, /announcement-empty-state/);
  assert.match(core, /from\('v_announcements'\)/);
  assert.match(css, /\.announcement-list\{[^}]*overflow-y:auto/);
  assert.match(css, /\.announcement-author\.is-owner\{/);
  assert.match(css, /\.bug-image-card\{[^}]*margin:0/);
  assert.match(core, /rpc\('create_announcement'/);
  assert.match(core, /rpc\('delete_announcement'/);
  assert.match(edge, /announcement-upload-urls/);
  assert.match(edge, /announcement-view-urls/);
  assert.match(edge, /announcement-cleanup-media/);
  assert.match(migration, /create table if not exists public\.announcements/i);
  assert.match(migration, /create or replace function public\.create_announcement/i);
  assert.match(migration, /create or replace function public\.delete_announcement/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.announcements/i);
  const migration024 = read('database/migrations/20261112_024_announcement_avatars_and_group_scope.sql');
  assert.match(migration024, /create or replace view public\.v_announcements/i);
  assert.match(migration024, /create or replace function public\.announcement_author_avatar/i);
  assert.match(migration024, /group_id = public\.current_group_id\(\)/i);
});

test('sessions stay synchronized across browser tabs for sign-in and logout', () => {
  const core = read('js/core.js');
  const auth = read('js/auth.js');
  assert.match(core, /function watchCrossTabAuth/);
  assert.match(core, /'ipon-auth-sync'/);
  assert.match(core, /window\.addEventListener\('storage'/);
  assert.match(core, /onAuthStateChange/);
  assert.match(core, /broadcastAuthEvent\('SIGNED_OUT'\)/);
  assert.match(auth, /Ipon\.broadcastAuthEvent\('SIGNED_IN'/);
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
  assert.match(core, /dashboard: \['ADMIN', 'TREASURER', 'MEMBER'\]/);
  assert.match(core, /reports: \['ADMIN', 'TREASURER', 'MEMBER'\]/);
  assert.match(core, /user: \['MEMBER'\]/);
  assert.match(userHtml, /data-page="user"/);
  assert.match(userScript, /allowedRoles: \['MEMBER'\]/);
  assert.match(userScript, /get_user_dashboard/);
  assert.match(read('js/dashboard.js'), /allowedRoles: \['ADMIN', 'TREASURER', 'MEMBER'\]/);
  assert.match(read('js/dashboard.js'), /activity\.subject_name/);
  assert.match(read('js/records.js'), /allowedRoles: \['ADMIN', 'TREASURER', 'MEMBER'\]/);
  assert.match(read('js/records.js'), /page === 'expenses' \|\| page === 'withdrawals'/);
  assert.match(read('js/reports.js'), /allowedRoles: \['ADMIN', 'TREASURER', 'MEMBER'\]/);
  assert.match(read('database/migrations/20261112_018_member_group_visibility.sql'), /current_user_role\(\) in \('ADMIN', 'TREASURER', 'MEMBER'\)/);
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
  assert.match(core, /value\.length < 8 \|\| value\.length > 128/);
  assert.match(core, /Do not include your name or email/);
  assert.match(edge, /password\.length >= 8 && password\.length <= 128/);
  assert.match(edge, /Password must not contain the account name or email/);
  for (const file of ['account.html', 'members.html', 'super-admin.html']) assert.match(read(file), /minlength="8"[^>]*maxlength="128"/i);
  assert.match(read('js/auth.js'), /Ipon\.passwordIssue/);
  assert.match(read('js/auth.js'), /passwordStrength\.element\.hidden = true/);
  assert.match(core, /function bindPasswordStrength/);
  assert.match(read('README.md'), /minimum length of 8/);
});

test('login credential errors mark both fields without revealing account existence', () => {
  const auth = read('js/auth.js');
  const loginHtml = read('login.html');
  assert.match(auth, /error\?\.code === 'invalid_credentials'/);
  assert.match(auth, /\[email, password\]\.forEach\(\(input\) => input\.setAttribute\('aria-invalid', 'true'\)\)/);
  assert.match(auth, /message\.textContent = 'Incorrect email or password\.'/);
  assert.match(loginHtml, /class="password-toggle"[^>]*><svg/);
  assert.doesNotMatch(loginHtml, /class="password-toggle"[^>]*>Show<\/button>/);
});

test('phone fields reject letters and incomplete accounts finish setup before panel access', () => {
  const core = read('js/core.js');
  const auth = read('js/auth.js');
  const account = read('account.html') + read('js/account.js');
  assert.match(core, /input\.value\.replace\(\/\\D\/g, ''\)/);
  assert.match(core, /function validatePhoneInput\(input\)/);
  assert.match(core, /function profileNeedsSetup\(profile\)/);
  assert.match(core, /first_name,middle_name,last_name,contact_number,role,status/);
  assert.match(auth, /Ipon\.accountSetupUrl\(profile, data\.user\)/);
  assert.match(account, /id="profile-setup-notice"/);
  assert.match(account, /id="account-contact"[^>]*maxlength="13"[^>]*required/);
  assert.match(account, /finishSetupIfReady\(\)/);
  assert.match(read('database/migrations/20261112_015_require_profile_mobile.sql'), /if v_contact is null[\s\S]*?Mobile number is required/);
});

test('name fields reject numbers and unsupported symbols across every form', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  assert.match(core, /function prepareFormValidation\(\)/);
  assert.match(core, /function getValidationMessage\(control\)/);
  assert.match(core, /document\.addEventListener\('invalid',[\s\S]*?event\.preventDefault\(\)/);
  assert.match(css, /\.field select\[aria-invalid="true"\]:focus/);
  assert.match(core, /function prepareNameInputs\(\)/);
  assert.match(core, /input\[name="first_name"\],input\[name="middle_name"\],input\[name="last_name"\]/);
  assert.ok(core.includes("input.value = input.value.replace(/[^\\p{L}\\p{M} '\\u2019-]/gu, '');"));
  assert.match(core, /input\.addEventListener\('blur', \(\) => validateNameInput\(input\)\)/);
  assert.match(core, /prepareNameInputs\(\);[\s\S]*preparePhoneInputs\(\)/);
});

test('login provides development, terms, and privacy disclosures', () => {
  const html = read('login.html');
  const auth = read('js/auth.js');
  assert.match(html, /Development preview/);
  assert.match(html, /IPON is still under active development/);
  assert.match(html, /data-policy-open="terms"/);
  assert.match(html, /data-policy-open="privacy"/);
  assert.match(html, /body\.is-request-mode :is\(\.development-notice,\.login-legal\)\{display:none\}/);
  assert.match(html, /<dialog class="policy-dialog" id="policy-dialog" aria-labelledby="policy-title">/);
  assert.match(html, /tracking system only and does not hold, transfer, receive, or safeguard money/);
  assert.match(html, /contact your assigned administrator/);
  assert.match(auth, /policyDialog\.showModal\(\)/);
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
  assert.match(core, /class="account-card account-profile-card"/);
  assert.match(core, /class="account-support"[\s\S]*?data-donate-open[\s\S]*?>Donate me</);
  assert.match(core, /id="donate-dialog"[\s\S]*?class="donate-sticker" src="assets\/donate-sticker\.jpg"[\s\S]*?id="copy-donate-number"[\s\S]*?id="open-donate-qr"[^>]*>Scan me<\/button>[\s\S]*?id="donate-qr-dialog"[\s\S]*?src="assets\/donate-qr\.jpg"[\s\S]*?>Scan with GCash<\/p>/);
  assert.match(core, /data-donate-open[\s\S]*?donate\?\.showModal\(\)/);
  assert.match(core, /class="account-side-stack"/);
  assert.match(core, /class="account-password-disclosure"/);
  assert.doesNotMatch(`${core}\n${read('account.html')}`, /account-header-avatar|account-profile-avatar/);
  assert.doesNotMatch(core, /<h3>Profile<\/h3>|Update your personal information\./);
  assert.match(core, /function bindAccountDialog\(\)/);
  assert.match(core, /update_own_profile/);
  assert.doesNotMatch(core, /\['account', 'account\.html', 'My account'/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(44px,1fr\)\)/);
  assert.match(css, /\.account-dialog-header\{[^}]*linear-gradient\(125deg,#062d23/);
  assert.match(css, /\.account-dialog-content\{[^}]*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(css, /\.account-support\{[^}]*margin-top:auto/);
  assert.match(css, /\.account-dialog\{width:100%;height:100dvh/);
});

test('first-login account setup opens as a locked responsive modal', () => {
  const html = read('account.html');
  const script = read('js/account.js');
  const css = read('css/app.css');
  assert.match(html, /<dialog[^>]+id="account-page-dialog"[^>]+aria-labelledby="account-page-title"/);
  assert.match(script, /pageDialog\.showModal\(\)/);
  assert.match(script, /pageDialog\.addEventListener\('cancel',[\s\S]*?event\.preventDefault\(\)/);
  assert.match(script, /closeButton\.hidden = onboarding/);
  assert.match(css, /body\.account-onboarding \.account-page-dialog \.account-grid>section:nth-child\(n\+3\)\{display:none\}/);
});

test('calendar navigation includes the administrator audit log', () => {
  assert.match(read('dashboard.html'), /href="audit\.html" data-role="ADMIN"[^>]*>[\s\S]*?<span>Audit log<\/span>/);
  assert.match(read('audit.html'), /<dialog[^>]+id="audit-detail-dialog"[^>]+aria-labelledby="audit-detail-title"/);
  assert.match(read('js/audit.js'), /detailDialog\.showModal\(\)/);
  assert.doesNotMatch(read('js/audit.js'), /<details\b/);
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
  const versions = new Set();
  assert.ok(migrations.length >= 3);
  for (const file of migrations) {
    const sql = readFileSync(new URL(file, directory), 'utf8');
    const expectedVersion = file === '0000_create_migration_ledger.sql' ? '0000' : file.match(/^(\d{8}_\d{3})_/i)?.[1];
    const recordedVersion = sql.match(/insert into public\.schema_migrations\s*\(version, name\)\s*values\s*\(\s*'([^']+)'/i)?.[1];
    assert.match(sql, /^begin;/im, `${file} must begin a transaction`);
    assert.match(sql, /^commit;/im, `${file} must commit its transaction`);
    assert.match(sql, /schema_migrations/i, `${file} must update the migration ledger`);
    assert.equal(recordedVersion, expectedVersion, `${file} must record its filename version`);
    assert.ok(!versions.has(recordedVersion), `${file} has a duplicate migration version`);
    versions.add(recordedVersion);
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
  assert.match(read('assets/favicon.svg'), /<svg[^>]+viewBox="0 0 64 64"/i);
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /Content-Security-Policy/i, `${file} must declare a CSP`);
    assert.match(html, /<link rel="icon" href="assets\/favicon\.svg" type="image\/svg\+xml">/i, `${file} must use the IPON favicon`);
    assert.doesNotMatch(html, /<th>\s*<\/th>/i, `${file} has an unlabeled table column`);
  }
  assert.match(read('login.html'), /<a class="login-brand" href="index\.html"[^>]*><img class="login-brand-logo" src="assets\/favicon\.svg" alt=""><span>IPON<\/span><\/a>/);
  assert.match(read('login.html'), /class="auth-tabs"[^>]*aria-label="Account access"/);
  assert.doesNotMatch(read('login.html'), /role="tab(?:list|panel)?"/);
  assert.match(read('manifest.webmanifest'), /"display":\s*"standalone"/);
  assert.match(read('js/core.js'), /serviceWorker\.register\('\/sw\.js'\)/);
});

test('large record lists use server-side counts, filters, and ranges', () => {
  const records = read('js/records.js');
  const members = read('js/members.js');
  assert.match(records, /count: 'exact'/);
  assert.match(records, /\.eq\('approval_status'/);
  assert.match(records, /\.range\(/);
  assert.doesNotMatch(records, /\.limit\(200\)/);
  assert.match(read('withdrawals.html'), /<select id="responsible" name="person_responsible" required>/);
  assert.match(read('expenses.html'), /<select id="responsible" name="person_responsible" required>/);
  assert.match(records, /function populateResponsibleSelect/);
  assert.match(records, /responsibleSelect\.closest\('\.field'\)\.hidden = true/);
  assert.match(members, /\.ilike\('full_name'/);
  assert.match(members, /\.eq\('status'/);
  assert.match(members, /\.range\(/);
});

test('secondary member and goal editing uses accessible dialogs', () => {
  const membersPage = read('members.html');
  const goalsPage = read('savings.html');
  assert.match(membersPage, /<dialog[^>]+id="member-dialog"[^>]+aria-labelledby="member-form-title"/);
  assert.match(membersPage, /id="member-email"[^>]+type="email"[^>]+required/);
  assert.match(membersPage, /id="member-password"[^>]+type="password"[^>]+minlength="8"/);
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
  assert.match(html, /auth-tab-indicator/);
  assert.match(script, /updateTabIndicator/);
  assert.match(script, /loginTab\.textContent = 'Sign in'/);
  assert.match(script, /signupTab\.textContent = 'Create account'/);
  assert.match(html, /body\.is-request-mode \.login-page\{grid-template-columns:minmax\(380px,1\.1fr\) minmax\(380px,\.9fr\)/);
  assert.match(html, /body\.is-request-mode \.login-story\{display:flex\}/);
  assert.match(html, /body\.is-request-mode \.login-card\{position:relative;width:min\(660px,100%\)/);
  assert.match(html, /body\.is-request-mode \.login-card \.form-grid\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:14px 16px\}/);
  assert.doesNotMatch(read('js/core.js'), /<meter\b/i);
  assert.doesNotMatch(html, /zediskaaa(?:%40|@)gmail\.com/i);
  assert.match(html, /body\.is-request-mode :is\(#first-name-field,#middle-name-field,#last-name-field\)\{grid-column:span 2\}/);
  assert.match(html, /body\.is-request-mode :is\(#contact-number-field,#email-field,#password-field,#password-confirmation-field\)\{grid-column:span 3\}/);
  assert.match(html, /@media\(max-width:780px\)[\s\S]*?\.login-card \.form-grid\{grid-template-columns:1fr/);
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
  const script = read('js/reports.js');
  assert.equal((html.match(/class="panel report-panel"/g) || []).length, 3);
  assert.match(css, /\.report-panel\s*\{[^}]*padding:20px 22px/);
  assert.match(css, /\.report-chart\{height:240px\}/);
  assert.match(css, /@media print\{[\s\S]*?\.compact-filter,\.table-filters,\.panel-header>select[\s\S]*?display:none!important/);
  assert.match(css, /@media print\{[\s\S]*?\.panel-header\[data-print-meta\]::after/);
  assert.match(script, /setAttribute\('data-print-meta'/);
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

test('dashboard lets users choose the calendar tracking goal and uses a bounded pending summary', () => {
  const html = read('dashboard.html');
  const script = read('js/dashboard.js');
  const css = read('css/app.css');
  assert.match(html, /id="calendar-goal-select"[^>]*>[\s\S]*?General savings/);
  assert.match(html, /id="mobile-calendar-goal-select"[^>]*>[\s\S]*?General savings/);
  assert.doesNotMatch(html, /id="dashboard-completion"/);
  assert.match(script, /rpc\('get_pending_review_summary'\)/);
  assert.match(script, /from\('savings_goals'\)\.select\('id,title'\)[\s\S]*?eq\('status', 'ACTIVE'\)/);
  assert.match(script, /renderGoalOptions\(goalResult\.data \|\| \[\]\)/);
  assert.match(script, /goalSelects\.forEach\(\(select\) => select\.addEventListener\('change'/);
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

test('production headers are configured for Vercel response delivery', () => {
  const config = JSON.parse(read('vercel.json'));
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.match(headers['Strict-Transport-Security'], /max-age=31536000/);
});

test('operational workflow migration supports recovery, treasurers, automation, and bounded reviews', () => {
  const migration = read('database/migrations/20261112_013_complete_operational_workflows.sql');
  const edge = read('supabase/functions/manage-account/index.ts');
  assert.match(migration, /p_role not in \('MEMBER', 'TREASURER'\)/);
  assert.match(migration, /create or replace function public\.reactivate_member/);
  assert.match(migration, /create or replace function public\.super_admin_reopen_request/);
  assert.match(migration, /create or replace function public\.generate_all_contribution_periods/);
  assert.match(migration, /recent as \(select \* from entries order by created_at desc limit 3\)/);
  assert.match(edge, /body\.role === 'TREASURER'/);
});

test('password changes reauthenticate and financial decisions use the shared dialog', () => {
  const edge = read('supabase/functions/manage-account/index.ts');
  const core = read('js/core.js');
  const dashboard = read('js/dashboard.js');
  const records = read('js/records.js');
  assert.match(edge, /signInWithPassword\(\{ email: userResult\.user\.email, password: currentPassword \}\)/);
  assert.match(core, /function requestRecordAction/);
  assert.match(dashboard, /Ipon\.requestRecordAction/);
  assert.match(records, /Ipon\.requestRecordAction/);
  assert.doesNotMatch(`${dashboard}\n${records}`, /window\.prompt/);
});

test('password recovery uses a hosted reset link before accepting a new password', () => {
  const login = read('login.html');
  const auth = read('js/auth.js');
  const reset = read('js/reset-password.js');
  const config = read('supabase/config.toml');
  const template = read('supabase/templates/recovery.html');
  assert.match(login, /id="forgot-password-open"/);
  assert.match(login, /Email reset link/);
  assert.doesNotMatch(login, /id="recovery-code"/);
  assert.match(auth, /resetPasswordForEmail\(recoveryEmail, \{ redirectTo \}\)/);
  assert.doesNotMatch(auth, /verifyOtp/);
  assert.match(reset, /auth\.updateUser\(\{ password: password\.value \}\)/);
  assert.match(config, /\[auth\.email\.template\.recovery\][\s\S]*?content_path = "\.\/supabase\/templates\/recovery\.html"/);
  assert.match(template, /\{\{ \.ConfirmationURL \}\}/);
});

test('opt-in TOTP MFA is enrolled, challenged, and enforced at AAL2', () => {
  const core = read('js/core.js');
  const challenge = read('js/mfa.js');
  const migration = read('database/migrations/20261112_014_enforce_opt_in_mfa.sql');
  const config = read('supabase/config.toml');
  const edge = read('supabase/functions/manage-account/index.ts');
  assert.match(core, /auth\.mfa\.enroll\(\{ factorType: 'totp'/);
  assert.match(core, /auth\.mfa\.enroll\([^\n]+issuer: 'IPON'/);
  assert.match(core, /auth\.mfa\.listFactors\(\)/);
  assert.match(core, /auth\.mfa\.unenroll\(\{ factorId/);
  assert.match(core, /!securityCard\.querySelector\('\[data-mfa-settings\]'\)/);
  assert.match(core, /<dialog class="mfa-enrollment-dialog"[^>]+data-mfa-enrollment/);
  assert.match(core, /enrollment\.showModal\(\)/);
  assert.match(core, /enrollment\.addEventListener\('cancel'/);
  assert.match(read('css/app.css'), /\.account-dialog-sheet\{[^}]*scrollbar-width:none\}[\s\S]*?\.account-dialog-sheet::-webkit-scrollbar\{display:none\}/);
  assert.match(core, /getAuthenticatorAssuranceLevel\(\)/);
  assert.match(challenge, /challengeAndVerify\(\{ factorId: factorSelect\.value, code \}\)/);
  assert.match(migration, /from auth\.mfa_factors[\s\S]*?status = 'verified'/);
  assert.match(migration, /as restrictive for all to authenticated/);
  assert.match(migration, /and public\.mfa_access_allowed\(\)/);
  assert.match(config, /\[auth\.mfa\.totp\]\s*enroll_enabled = true\s*verify_enabled = true/);
  assert.match(edge, /hasVerifiedMfa && tokenAal\(token\) !== 'aal2'/);
});

test('record_contribution supplies required due_date when auto-creating a contribution period', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_025_fix_contribution_period_due_date.sql');
  for (const sql of [schema, migration]) {
    assert.match(sql, /create or replace function public\.contribution_period_due_date\(/);
    assert.match(sql, /create or replace function public\.record_contribution\([\s\S]*?insert into public\.contribution_periods \(member_id, period_month, required_amount, due_date\)[\s\S]*?public\.contribution_period_due_date\(v_group_id, v_month\)/);
  }
});

test('review notifications cast approval_status to text and review modal displays entry DP, user, type, amount, and confirmation', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_026_fix_review_notification_and_enrich_pending.sql');
  const core = read('js/core.js');
  const dashboard = read('js/dashboard.js');
  const records = read('js/records.js');
  for (const sql of [schema, migration]) {
    assert.doesNotMatch(sql, /lower\(new\.approval_status\)(?!::text)/);
    assert.match(sql, /lower\(new\.approval_status::text\)/);
    assert.match(sql, /create or replace function public\.get_pending_review_summary\(\)[\s\S]*?'entry_label'[\s\S]*?'member_name'[\s\S]*?'avatar_url'/);
  }
  assert.match(core, /id="record-action-summary"/);
  assert.match(core, /id="record-action-step-confirm"/);
  assert.match(core, /record-type-pill/);
  assert.match(core, /avatarMarkup\(entry\.avatarUrl \|\| ''/);
  assert.match(dashboard, /Ipon\.requestRecordAction\(\{[\s\S]*?entry,[\s\S]*?onSubmit:/);
  assert.match(records, /Ipon\.requestRecordAction\(\{[\s\S]*?entry,[\s\S]*?onSubmit:/);
});

test('members without contributions can be soft-deleted with a reason and recovered from the bin within 1 month', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_027_add_member_delete_and_recycle_bin.sql');
  const membersHtml = read('members.html');
  const membersJs = read('js/members.js');
  const core = read('js/core.js');
  for (const sql of [schema, migration]) {
    assert.match(sql, /create or replace function public\.delete_member\(/);
    assert.match(sql, /from public\.contributions c[\s\S]*?join public\.contribution_periods cp/);
    assert.match(sql, /create or replace function public\.get_bin_items\(/);
    assert.match(sql, /create or replace function public\.recover_bin_item\(/);
    assert.match(sql, /interval '1 month'/);
    assert.match(sql, /group by|and deleted_at is null/i);
  }
  assert.match(membersHtml, /id="see-bin"[^>]*>See bin</);
  assert.match(membersHtml, /id="member-delete-dialog"/);
  assert.match(membersHtml, /id="member-delete-reason-select"[\s\S]*?value="OTHERS"/);
  assert.match(membersHtml, /id="member-delete-custom-reason"/);
  assert.match(membersHtml, /id="member-delete-confirm-step"/);
  assert.match(membersHtml, /id="bin-dialog"/);
  assert.match(membersHtml, /id="bin-type-filter"/);
  assert.match(membersJs, /!membersWithContributions\.has\(member\.id\)/);
  assert.match(membersJs, /rpc\('delete_member'/);
  assert.match(membersJs, /rpc\('get_bin_items'/);
  assert.match(membersJs, /rpc\('recover_bin_item'/);
  const deleteBlock = core.match(/viewerDelete\.onclick[\s\S]*?finally \{[\s\S]*?\}\s*\};/)?.[0] || '';
  assert.match(deleteBlock, /rpc\('delete_announcement'/);
  assert.doesNotMatch(deleteBlock, /announcement-cleanup-media/);
});

test('review and void reasons appear in submitter notifications, calendar details, and record tables', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_028_include_review_reason_in_notifications_and_calendar.sql');
  const dashboard = read('js/dashboard.js');
  const records = read('js/records.js');
  const members = read('js/members.js');
  const css = read('css/app.css');
  for (const sql of [schema, migration]) {
    assert.match(sql, /create or replace function public\.notify_record_activity\(\)[\s\S]*?'\\nReason: '[\s\S]*?char_length\(v_message\) > 500/);
    assert.match(sql, /create or replace view public\.v_savings_calendar[\s\S]*?c\.review_note[\s\S]*?w\.review_note[\s\S]*?e\.review_note/);
  }
  assert.match(dashboard, /activity\.review_note/);
  assert.match(records, /function reasonNoteHtml/);
  assert.match(members, /review_note,void_reason/);
  assert.match(css, /\.notification-item p\{[^}]*white-space:pre-line/);
  assert.match(css, /\.record-reason-note/);
});

test('calendar day cells display circular status icons instead of text words', () => {
  const dashboard = read('js/dashboard.js');
  const heroCss = read('css/hero-plates.css');
  assert.match(dashboard, /function eventIconMarkup\(klass\)/);
  assert.match(dashboard, /aria-label="\$\{Ipon\.escapeHtml\(label\)\}">\$\{eventIconMarkup\(klass\)\}<\/span>/);
  assert.match(heroCss, /\.day \.event \.status-icon/);
  assert.match(heroCss, /\.day \{[^}]*display:grid;[^}]*grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(heroCss, /\.day-avatars \{[^}]*grid-row:2;[^}]*overflow:hidden/);
});

test('multi-group workspaces support editable group name/DP, admin contributor toggle, and email invites', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261112_029_multi_groups_dp_and_admin_contributor.sql');
  const edge = read('supabase/functions/manage-account/index.ts');
  const core = read('js/core.js');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const settingsHtml = read('settings.html');
  const settingsJs = read('js/settings.js');
  for (const sql of [schema, migration]) {
    assert.match(sql, /create table if not exists public\.group_memberships/i);
    assert.match(sql, /create or replace function public\.get_my_groups\(\)/i);
    assert.match(sql, /create or replace function public\.switch_active_group\(p_group_id uuid\)/i);
    assert.match(sql, /create or replace function public\.update_group_profile\(/i);
    assert.match(sql, /create or replace function public\.set_admin_contributor\(/i);
    assert.match(sql, /create or replace function public\.admin_create_group\(/i);
    assert.match(sql, /create or replace function public\.get_group_access_list\(\)/i);
  }
  assert.match(edge, /async function sendInviteEmail\(/);
  assert.match(edge, /BREVO_API_KEY/);
  assert.match(edge, /RESEND_API_KEY/);
  assert.match(edge, /IPON Group Savings Tracker/);
  assert.match(core, /function inviteAccount\(/);
  assert.match(core, /function showInviteSummary\(/);
  assert.match(core, /function switchActiveGroup\(/);
  assert.match(dashboardHtml, /id="dashboard-group-bar"/);
  assert.match(dashboardHtml, /id="dashboard-group-select"/);
  assert.match(dashboardHtml, /id="dashboard-manage-group"/);
  assert.match(dashboardHtml, /id="group-manage-hub-dialog"/);
  assert.match(dashboardHtml, /id="dashboard-edit-group"/);
  assert.match(dashboardHtml, /id="dashboard-invite-member"/);
  assert.match(dashboardHtml, /id="dashboard-create-group"/);
  assert.match(dashboardHtml, /id="manage-hub-self-toggle"[^>]*role="switch"/);
  assert.match(dashboardHtml, /id="group-self-contributor"[^>]*role="switch"/);
  assert.match(dashboardHtml, /id="group-add-invite-row"/);
  assert.match(dashboardJs, /rpc\('update_group_profile'/);
  assert.match(dashboardJs, /rpc\('admin_create_group'/);
  assert.match(dashboardJs, /rpc\('set_admin_contributor'/);
  assert.match(settingsHtml, /id="settings-group-select"/);
  assert.match(settingsHtml, /id="settings-admin-contributor"[^>]*role="switch"/);
  assert.match(settingsJs, /rpc\('get_group_access_list'\)/);
  assert.match(settingsJs, /rpc\('set_admin_contributor'/);
  assert.match(core, /function generateTemporaryPassword\(\)/);
  assert.match(core, /function prepareTemporaryPassword\(input\)/);
  assert.match(dashboardJs, /prepareTemporaryPassword\(/);
  assert.match(read('members.html'), /id="member-password"[^>]*data-temp-password/);
  assert.match(read('members.html'), /id="members-group-bar"[\s\S]*id="members-group-select"/);
  assert.match(read('js/members.js'), /rpc\('get_my_groups'\)/);
  assert.match(read('js/members.js'), /switchActiveGroup\(/);
  assert.match(settingsHtml, /id="treasurer-password"[^>]*data-temp-password/);
  assert.match(read('super-admin.html'), /id="administrator-password"[^>]*data-temp-password/);
  const fixAvatarSql = read('database/migrations/20261112_030_fix_announcement_author_avatar_super_admin.sql');
  assert.match(fixAvatarSql, /p\.role = 'SUPER_ADMIN'/);
  assert.match(schema, /public\.announcement_author_avatar[\s\S]*p\.role = 'SUPER_ADMIN'[\s\S]*public\.group_memberships/);
  const appCss = read('css/app.css');
  assert.match(appCss, /\.field input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)/);
  assert.match(appCss, /\.field input\.toggle-switch-input,\.toggle-switch-input\{[^}]*width:48px;[^}]*height:28px/);
  assert.match(appCss, /\.group-hub-sheet\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*overflow-x:hidden/);
  assert.match(appCss, /\.group-hub-copy h2\{[^}]*overflow-wrap:break-word;word-break:normal/);
  const manageAccountEdge = read('supabase/functions/manage-account/index.ts');
  assert.match(manageAccountEdge, /async function deliverEmail\(/);
  assert.match(manageAccountEdge, /async function sendAdminRequestDecisionEmail\(/);
  assert.match(manageAccountEdge, /body\.action === 'admin-request-decision-email'/);
  assert.match(manageAccountEdge, /Congratulations! Your administrator request/);
  assert.match(manageAccountEdge, /We're sorry, your administrator request/);
  assert.match(manageAccountEdge, /Reason for decline:/);
  assert.match(core, /function notifyAdminRequestDecision\(/);
  const superAdminJs = read('js/super-admin.js');
  assert.match(superAdminJs, /notifyAdminRequestDecision\(/);
  assert.match(read('login.html'), /id="request-success-dialog"/);
  const authJs = read('js/auth.js');
  assert.match(authJs, /setMode\('login'\)[\s\S]*requestSuccessDialog\?\.showModal\(\)/);
  const migration031 = read('database/migrations/20261113_031_block_rejected_admin_request_emails.sql');
  assert.match(migration031, /create or replace function public\.check_admin_request_eligibility/);
  assert.match(migration031, /create or replace function public\.super_admin_reject_request/);
  assert.match(schema, /create or replace function public\.check_admin_request_eligibility/);
  assert.match(read('super-admin.html'), /id="reject-request-dialog"[\s\S]*id="reject-reason-preset"[\s\S]*id="reject-reason-text"/);
  assert.match(superAdminJs, /rejectForm\?\.addEventListener\('submit'[\s\S]*Ipon\.confirmAction\(\{[\s\S]*title: 'Reject administrator request\?'/);
  assert.match(superAdminJs, /approvalForm\.addEventListener\('submit'[\s\S]*Ipon\.confirmAction\(\{[\s\S]*title: 'Approve administrator request\?'/);
  assert.match(authJs, /check_admin_request_eligibility/);
  assert.match(core, /function resolveActiveRole\(/);
  assert.match(core, /host\.dataset\.renderedRole === effectiveRole/);
  assert.match(appCss, /@media \(max-width:720px\)[\s\S]*?\.app-nav\s*\{[^}]*min-height:58px/);
  const migration032 = read('database/migrations/20261113_032_admin_request_email_verification_and_unblock.sql');
  assert.match(migration032, /create table if not exists public\.email_verifications/);
  assert.match(migration032, /create or replace function public\.request_admin_email_verification/);
  assert.match(migration032, /create or replace function public\.verify_admin_email_verification/);
  assert.match(migration032, /create or replace function public\.super_admin_unblock_admin_request/);
  assert.match(schema, /create table if not exists public\.email_verifications/);
  assert.match(schema, /create or replace function public\.super_admin_unblock_admin_request/);
  assert.match(read('login.html'), /id="request-verify-dialog"[\s\S]*id="request-verify-code"/);
  assert.match(manageAccountEdge, /body\.action === 'send-verification-otp'/);
  assert.match(manageAccountEdge, /body\.action === 'unblock-admin-request'/);
  assert.match(core, /sendAdminRequestVerificationCode/);
  assert.match(core, /verifyAdminRequestVerificationCode/);
  assert.match(core, /unblockAdminRequest/);
  assert.match(superAdminJs, /data-unblock-request/);
  assert.match(superAdminJs, /unblockAdminRequest/);
  assert.match(authJs, /sendAdminRequestVerificationCode/);
  assert.match(authJs, /verifyAdminRequestVerificationCode/);
  assert.match(dashboardJs, /activeIds\.has\(item\.member_id\)/);
  assert.match(schema, /delete from public\.contribution_periods cp[\s\S]*cp\.member_id = v_member_id[\s\S]*not exists \([\s\S]*select 1 from public\.contributions c/);
  const migration033 = read('database/migrations/20261113_033_clean_unpaid_periods_on_admin_contributor_toggle.sql');
  assert.match(migration033, /m\.status = 'ACTIVE' or c\.id is not null/);
  const migration034 = read('database/migrations/20261113_034_ensure_admin_request_email_and_decision_delivery.sql');
  assert.match(migration034, /set email = lower\(ar\.email\)/);
  assert.match(migration034, /create or replace function public\.super_admin_reject_request/);
  assert.match(migration034, /create or replace function public\.super_admin_approve_request/);
  assert.match(schema, /insert into public\.schema_migrations[\s\S]*20261113_034/);
  assert.match(manageAccountEdge, /from\('admin_requests'\)\s*\.select\('email'\)/);
  assert.match(manageAccountEdge, /bccSuperAdmin/);
  assert.match(superAdminJs, /email:\s*targetEmail/);
});

test('financial records support member filtering, DP spotlight card, activity graph, and balanced form inputs across additions, deductions, and expenses', () => {
  const records = read('js/records.js');
  const css = read('css/app.css');
  for (const pageName of ['contributions.html', 'withdrawals.html', 'expenses.html']) {
    const html = read(pageName);
    assert.match(html, /<select id="record-member-filter"/);
    assert.match(html, /id="member-spotlight"[^>]*hidden/);
    assert.match(html, /id="member-spotlight-avatar"/);
    assert.match(html, /id="member-spotlight-name"/);
    assert.match(html, /id="member-spotlight-clear"/);
    assert.match(html, /<canvas id="member-spotlight-chart"/);
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/chart\.js/);
  }
  assert.match(records, /function renderMemberSpotlight/);
  assert.match(records, /selectedMemberId/);
  assert.match(records, /selectedMemberName/);
  assert.match(records, /Ipon\.avatarMarkup/);
  assert.match(records, /function updateTabLinksWithMember/);
  assert.match(css, /\.record-member-bar/);
  assert.match(css, /\.member-spotlight-card/);
  assert.match(css, /\.member-spotlight-metrics/);
  assert.match(css, /\.split-layout \.sticky-panel \.form-grid/);
});

test('announcements support Messenger-style reaction picker, Facebook-style reaction pill summary, and who-reacted modal', () => {
  const migration = read('database/migrations/20261113_035_add_announcement_reactions.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const dashboard = read('js/dashboard.js');
  const superAdmin = read('js/super-admin.js');
  const css = read('css/app.css');

  assert.match(migration, /create table if not exists public\.announcement_reactions/i);
  assert.match(migration, /create or replace function public\.toggle_announcement_reaction/i);
  assert.match(migration, /create or replace function public\.get_announcement_reactions/i);
  assert.match(migration, /alter publication supabase_realtime add table public\.announcement_reactions/i);

  assert.match(schema, /create table if not exists public\.announcement_reactions/i);
  assert.match(schema, /public\.toggle_announcement_reaction/i);
  assert.match(schema, /public\.get_announcement_reactions/i);

  assert.match(core, /announcement-reactions-dialog/);
  assert.match(core, /announcement-reactions-pill/);
  assert.match(core, /announcement-react-container/);
  assert.match(core, /announcement-reaction-picker/);
  assert.match(core, /announcement-viewer-reactions/);
  assert.match(core, /toggle_announcement_reaction/);
  assert.match(core, /get_announcement_reactions/);

  assert.match(dashboard, /'announcement_reactions'/);
  assert.match(superAdmin, /'announcement_reactions'/);

  assert.match(css, /\.announcement-reactions-pill/);
  assert.match(css, /\.announcement-reaction-picker/);
  assert.match(css, /\.reaction-choice-btn/);
  assert.match(css, /\.announcement-reactions-dialog/);
  assert.match(css, /\.reaction-user-item/);
});

test('dashboard provides modal shortcut for recording additions, deductions, and expenses with role-aware member flow', () => {
  const html = read('dashboard.html');
  const js = read('js/dashboard.js');
  const css = read('css/app.css');

  assert.match(html, /id="dashboard-record-entry"/);
  assert.match(html, /id="quick-record-dialog"/);
  assert.match(html, /id="quick-record-form"/);
  assert.match(html, /id="quick-record-type-tabs"/);
  assert.match(html, /id="quick-tab-addition"/);
  assert.match(html, /id="quick-tab-deduction"/);
  assert.match(html, /id="quick-tab-expense"/);
  assert.match(html, /id="quick-member-id"/);
  assert.match(html, /id="quick-member-auto"/);
  assert.match(html, /id="quick-responsible"/);

  assert.match(js, /function openQuickRecordDialog/);
  assert.match(js, /function setQuickRecordType/);
  assert.match(js, /function populateQuickRecordMembers/);
  assert.match(js, /record_contribution/);
  assert.match(js, /record_withdrawal/);
  assert.match(js, /record_expense/);

  assert.match(css, /\.quick-record-dialog/);
  assert.match(css, /\.quick-record-type-tabs/);
  assert.match(css, /\.quick-type-tab/);
  assert.match(css, /\.quick-member-auto-chip/);
});

test('Super Admin can manage feature request statuses and publish release updates', () => {
  const migration = read('database/migrations/20261113_036_feature_request_workflow_and_release_updates.sql');
  const schema = read('database/schema.sql');
  const html = read('super-admin.html');
  const script = read('js/super-admin.js');
  const core = read('js/core.js');
  const css = read('css/app.css');

  assert.match(migration, /alter table public\.feature_requests[\s\S]*?status text not null default 'PENDING'/i);
  assert.match(migration, /create or replace function public\.review_feature_request/i);
  assert.match(migration, /create or replace function public\.create_announcement/i);
  assert.match(migration, /announcements_release_version_unique_idx/i);
  assert.match(schema, /review_feature_request/i);
  assert.match(schema, /announcement_type/i);
  assert.match(schema, /release_version/i);

  assert.match(html, /id="feature-requests-status-tabs"/);
  assert.match(html, /data-status-filter="ALL"/);
  assert.match(html, /data-status-filter="PENDING"/);
  assert.match(html, /data-status-filter="IMPLEMENTED"/);
  assert.match(html, /data-status-filter="REJECTED"/);
  assert.match(html, /id="sa-add-release-update"/);
  assert.match(html, /id="release-update-dialog"/);
  assert.match(html, /id="release-update-form"/);
  assert.match(html, /id="release-update-version"/);
  assert.match(html, /id="release-update-heading"/);
  assert.match(html, /id="release-update-details"/);

  assert.match(script, /updateFeatureCounts/);
  assert.match(script, /data-feat-action="IMPLEMENTED"/);
  assert.match(script, /data-feat-action="REJECTED"/);
  assert.match(script, /data-feat-action="PENDING"/);
  assert.match(script, /confirmAction\(\{[\s\S]*?title:\s*'Mark feature as implemented\?'/);
  assert.match(script, /confirmAction\(\{[\s\S]*?title:\s*'Reject feature request\?'/);
  assert.match(script, /confirmAction\(\{[\s\S]*?title:\s*'Reset feature request\?'/);
  assert.match(script, /review_feature_request/);
  assert.match(script, /openReleaseUpdateDialog/);
  assert.match(script, /req\.status === 'IMPLEMENTED' && !req\.release_version/);
  assert.match(script, /confirmAction\(\{[\s\S]*?title:\s*'Publish release update\?'/);
  assert.match(script, /p_announcement_type:\s*'RELEASE'/);
  assert.match(script, /RELEASE_INTROS/);
  assert.match(script, /RELEASE_OUTROS/);
  assert.match(script, /composeReleaseNotes/);
  assert.match(script, /release-update-shuffle/);
  assert.match(html, /id="release-update-shuffle"/);

  assert.match(core, /is-release-update/);
  assert.match(core, /announcement-release-banner/);
  assert.match(core, /announcement-release-badge/);
  assert.match(core, /announcement-version-chip/);
  assert.match(core, /announcement-viewer-release-banner/);

  assert.match(css, /\.segmented-control/);
  assert.match(css, /\.status-pill\.status-implemented/);
  assert.match(css, /\.status-pill\.status-rejected/);
  assert.match(css, /\.announcement-item\.is-release-update/);
  assert.match(css, /\.announcement-release-badge/);
});

test('Super Admin feature requests display requester avatars and system tracks real-time active now presence', () => {
  const html = read('super-admin.html');
  const dashHtml = read('dashboard.html');
  const script = read('js/super-admin.js');
  const core = read('js/core.js');
  const css = read('css/app.css');

  assert.match(html, /id="feature-requests-view-toggle"/);
  assert.match(html, /id="feature-requests-cards"/);
  assert.match(html, /id="feature-requests-table-wrap"/);
  assert.match(script, /feature-card/);
  assert.match(script, /feature-card-avatar/);
  assert.match(script, /table-user-cell/);
  assert.match(script, /table-user-avatar/);
  assert.match(script, /select\('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,avatar_url,created_at'\)/);

  assert.match(core, /ipon-active-presence/);
  assert.match(core, /isUserOnline/);
  assert.match(core, /syncPresenceDots/);
  assert.match(core, /avatar-presence-wrap/);
  assert.match(core, /presence-dot/);
  assert.match(core, /data-presence-id/);
  assert.match(dashHtml, /avatar-presence-wrap/);

  assert.match(css, /\.avatar-presence-wrap/);
  assert.match(css, /\.presence-dot/);
  assert.match(css, /\.presence-dot\.is-online/);
  assert.match(css, /\.view-mode-toggle/);
  assert.match(css, /\.feature-cards-grid/);
  assert.match(css, /\.feature-card/);
  assert.match(css, /\.table-user-cell/);
  assert.match(css, /\.account-avatar-picker \.presence-dot,\.reaction-user-avatar-wrap \.presence-dot\{display:none!important\}/);
  assert.doesNotMatch(core, /quickPreview\.innerHTML = avatarMarkup\([^)]*profile\.id\)/);
  assert.doesNotMatch(core, /avatarMarkup\(entry\.avatar_url,\s*name,\s*'reaction-user-avatar',\s*entry\.user_id\)/);
});

test('admin contributor toggle prompts for monthly contribution amount with confirmation and synchronizes to member pledge', () => {
  const dashHtml = read('dashboard.html');
  const dashJs = read('js/dashboard.js');
  const setHtml = read('settings.html');
  const setJs = read('js/settings.js');
  const migration = read('database/migrations/20261113_037_admin_contributor_amount_sync.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');

  assert.match(dashHtml, /id="admin-contributor-dialog"/);
  assert.match(dashHtml, /id="admin-contributor-form"/);
  assert.match(dashHtml, /id="admin-contributor-amount"/);
  assert.match(dashHtml, /id="group-hub-contributor-details"/);
  assert.match(dashHtml, /id="group-hub-pledge-val"/);
  assert.match(dashHtml, /id="group-hub-edit-pledge"/);

  assert.match(setHtml, /id="settings-contributor-dialog"/);
  assert.match(setHtml, /id="settings-contributor-form"/);
  assert.match(setHtml, /id="settings-contributor-amount"/);
  assert.match(setHtml, /id="settings-contributor-details"/);
  assert.match(setHtml, /id="settings-pledge-val"/);
  assert.match(setHtml, /id="settings-edit-pledge"/);

  assert.match(dashJs, /openAdminContributorDialog/);
  assert.match(dashJs, /confirmAction\(\{[\s\S]*?Remove yourself as a contributor\?/);
  assert.match(dashJs, /rpc\('set_admin_contributor',\s*\{\s*p_enabled:\s*true,\s*p_monthly_amount:\s*amount\s*\}\)/);

  assert.match(setJs, /openSettingsContributorDialog/);
  assert.match(setJs, /confirmAction\(\{[\s\S]*?Remove yourself as a contributor\?/);
  assert.match(setJs, /rpc\('set_admin_contributor',\s*\{\s*p_enabled:\s*true,\s*p_monthly_amount:\s*amount\s*\}\)/);

  assert.match(migration, /create or replace function public\.set_admin_contributor/i);
  assert.match(migration, /update public\.contribution_periods cp[\s\S]*?set required_amount = v_amount/i);
  assert.match(schema, /admin contributor amount sync/i);

  assert.match(css, /\.group-hub-contributor-details/);
  assert.match(css, /\.group-hub-pledge-value/);
  assert.match(css, /\.settings-contributor-details/);
});

test('feature requests support credit consent toggle and release updates display interactive hover tooltips in dedicated section', () => {
  const core = read('js/core.js');
  const superAdminJs = read('js/super-admin.js');
  const migration = read('database/migrations/20261113_038_feature_request_credit_and_release_sections.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');

  assert.match(core, /id="feature-request-credit"[^>]*name="allow_credit"/);
  assert.match(core, /Credit me in release updates/);
  assert.match(core, /allow_credit:\s*allowCredit/);
  assert.match(core, /id="announcement-viewer-release-features"/);
  assert.match(core, /rpc\('get_release_features'/);
  assert.match(core, /class="announcement-view-trigger"/);
  assert.match(core, /class="announcement-release-section"/);
  assert.match(core, /class="release-credit-tooltip"/);
  assert.match(core, /Feature requested by:/);

  assert.match(superAdminJs, /credit-consent-badge/);

  assert.match(migration, /add column if not exists allow_credit boolean not null default true/i);
  assert.match(migration, /create or replace function public\.get_release_features/i);
  assert.match(migration, /case when f\.allow_credit then f\.requester_id else null end/i);

  assert.match(schema, /allow_credit boolean not null default true/i);
  assert.match(schema, /public\.get_release_features/i);

  assert.match(css, /\.announcement-list\{display:grid;grid-template-columns:/);
  assert.match(css, /\.announcement-view-trigger\{/);
  assert.match(css, /\.credit-toggle-row\{/);
  assert.match(css, /\.release-credit-tooltip\{/);
  assert.match(css, /\.announcement-release-section\{/);
});

test('system integrates Gemini AI for release updates with procedural fallbacks', () => {
  const edge = read('supabase/functions/manage-account/index.ts');
  const superAdminHtml = read('super-admin.html');
  const superAdminJs = read('js/super-admin.js');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const css = read('css/app.css');

  assert.match(edge, /generateWithGemini/);
  assert.match(edge, /generateProceduralReleaseNotes/);
  assert.match(edge, /action === 'ai-generate-release-notes'/);
  assert.doesNotMatch(edge, /action === 'ai-savings-insights'/);
  assert.match(edge, /action === 'test-gemini-key'/);
  assert.match(edge, /gemini-1\.5-flash/);

  assert.match(superAdminHtml, /id="release-update-ai-btn"/);
  assert.match(superAdminHtml, /id="release-update-key-btn"/);
  assert.match(superAdminHtml, /id="release-update-ai-status"/);
  assert.match(superAdminHtml, /id="gemini-key-dialog"/);
  assert.match(superAdminHtml, /id="gemini-api-key-input"/);

  assert.match(superAdminJs, /release-update-ai-btn/);
  assert.match(superAdminJs, /gemini-key-dialog/);
  assert.match(superAdminJs, /ipon_gemini_api_key/);
  assert.match(superAdminJs, /ai-generate-release-notes/);

  assert.doesNotMatch(dashboardHtml, /id="dashboard-ai-insights-btn"/);
  assert.doesNotMatch(dashboardHtml, /id="ai-insights-dialog"/);
  assert.doesNotMatch(dashboardJs, /ai-insights-dialog/);
  assert.doesNotMatch(dashboardJs, /ai-savings-insights/);

  assert.match(css, /\.button-ai-trigger/);
  assert.doesNotMatch(css, /\.button-ai-inline/);
  assert.doesNotMatch(css, /\.ai-insights-dialog/);
});

test('self-serve group creation, direct signup, and interactive invitation acceptance/decline', () => {
  const migration = read('database/migrations/20261113_039_self_serve_groups_and_invitations.sql');
  const schema = read('database/schema.sql');
  const dashHtml = read('dashboard.html');
  const dashJs = read('js/dashboard.js');
  const core = read('js/core.js');
  const auth = read('js/auth.js');
  const css = read('css/app.css');
  const manageAccountEdge = read('supabase/functions/manage-account/index.ts');

  assert.match(migration, /create or replace function public\.admin_create_group/);
  assert.match(migration, /create or replace function public\.accept_group_invitation/);
  assert.match(migration, /create or replace function public\.decline_group_invitation/);
  assert.match(schema, /20261113_039/);
  assert.match(schema, /20261113_042/);

  assert.match(auth, /direct_signup:\s*true/);
  assert.match(auth, /accept_invite/);
  assert.match(manageAccountEdge, /body\.direct_signup !== false \? 'DIRECT_SIGNUP' : 'ADMIN_REQUEST'/);
  assert.match(manageAccountEdge, /action === 'accept-email-invite'/);
  assert.match(manageAccountEdge, /invite_token/);

  assert.match(dashHtml, /id="dashboard-no-group-card"/);
  assert.match(dashHtml, /id="no-group-create-btn"/);
  assert.match(dashJs, /dashboard-no-group-card/);
  assert.match(core, /data-invite-action="accept"/);
  assert.match(core, /data-invite-action="decline"/);
  assert.match(core, /accept_group_invitation/);
  assert.match(core, /decline_group_invitation/);
  assert.match(css, /\.notification-invite-actions/);
  assert.match(css, /\.no-group-card/);
});

test('Super Admin can deactivate and delete user accounts with required reasons and email delivery', () => {
  const superAdminHtml = read('super-admin.html');
  const superAdminJs = read('js/super-admin.js');
  const core = read('js/core.js');
  const manageAccountEdge = read('supabase/functions/manage-account/index.ts');
  const migration = read('database/migrations/20261113_040_super_admin_account_actions_and_reasons.sql');
  const schema = read('database/schema.sql');

  assert.match(superAdminHtml, /id="account-action-dialog"/);
  assert.match(superAdminHtml, /id="account-action-form"/);
  assert.match(superAdminHtml, /id="account-action-reason"/);
  assert.match(superAdminJs, /openAccountActionDialog/);
  assert.match(superAdminJs, /data-delete-user/);
  assert.match(superAdminJs, /notifyAccountStatusChange/);
  assert.match(core, /notifyAccountStatusChange/);
  assert.match(core, /action:\s*'super-admin-account-action'/);
  assert.match(manageAccountEdge, /action === 'super-admin-account-action'/);
  assert.match(manageAccountEdge, /sendAccountStatusEmail/);
  assert.match(migration, /create or replace function public\.super_admin_delete_user/);
  assert.match(schema, /20261113_040/);
});

test('live password validation feedback and non-blocking authentication flow', () => {
  const core = read('js/core.js');
  const auth = read('js/auth.js');
  const css = read('css/app.css');
  const migration = read('database/migrations/20261113_041_activate_all_new_accounts_and_fix_loading.sql');
  const schema = read('database/schema.sql');

  assert.match(core, /password-rules-list/);
  assert.match(core, /password-rule-item/);
  assert.match(core, /data-rule="length"/);
  assert.match(core, /data-rule="upper"/);
  assert.match(core, /data-rule="lower"/);
  assert.match(core, /data-rule="number"/);
  assert.match(core, /data-rule="symbol"/);
  assert.match(core, /loaderSafetyTimer/);
  const loaderTimerIndex = core.indexOf('let loaderSafetyTimer = null;');
  const firstSetLoadingCall = core.indexOf('setLoading(true)');
  assert.ok(loaderTimerIndex > -1 && loaderTimerIndex < firstSetLoadingCall, 'loaderSafetyTimer must be declared before any setLoading invocation');
  assert.match(core, /options\.requireAuth !== false/);

  assert.match(auth, /Ipon\.setLoading\(false\)/);
  assert.match(auth, /passwordRequirements\.hidden = true/);

  assert.match(css, /\.password-rules-list/);
  assert.match(css, /\.password-rule-item/);
  assert.match(css, /\.password-rule-item\.is-met/);
  assert.match(css, /\.password-rule-item\.is-unmet/);

  assert.match(migration, /update public\.profiles\s+set status = 'ACTIVE'/);
  assert.match(schema, /20261113_041/);
});

test('group payment QR, receipt uploads, and savings goal calculator are wired across UI, JS, CSS, and SQL', () => {
  const settingsHtml = read('settings.html');
  const settingsJs = read('js/settings.js');
  const userHtml = read('user.html');
  const userJs = read('js/user.js');
  const contribHtml = read('contributions.html');
  const expensesHtml = read('expenses.html');
  const recordsJs = read('js/records.js');
  const savingsHtml = read('savings.html');
  const savingsJs = read('js/savings.js');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const migration = read('database/migrations/20261114_043_payment_qr_and_receipts.sql');

  assert.match(settingsHtml, /id="payment-info-form"/);
  assert.match(settingsHtml, /id="payment-qr-file"/);
  assert.match(settingsJs, /get_group_payment_info/);
  assert.match(settingsJs, /update_group_payment_info/);

  assert.match(userHtml, /id="member-payment-card"/);
  assert.match(userHtml, /id="user-receipt-input"/);
  assert.match(userJs, /get_group_payment_info/);
  assert.match(userJs, /p_receipt_url/);
  assert.match(userJs, /openImageViewer/);

  assert.match(contribHtml, /id="record-receipt-input"/);
  assert.match(expensesHtml, /id="record-receipt-input"/);
  assert.match(recordsJs, /p_receipt_url/);
  assert.match(recordsJs, /openImageViewer/);

  assert.match(savingsHtml, /id="goal-calc-title"/);
  assert.match(savingsHtml, /id="calc-target"/);
  assert.match(savingsHtml, /id="calc-daily"/);
  assert.match(savingsJs, /updateCalculator/);
  assert.match(savingsJs, /calc-create-goal/);

  assert.match(coreJs, /openImageViewer/);
  assert.match(coreJs, /prepareImageDataUrl/);
  assert.match(coreJs, /bindReceiptPicker/);
  assert.match(coreJs, /record-review-receipt-btn/);
  assert.match(coreJs, /prepareNumericInputs/);
  assert.match(coreJs, /validateNumericInput/);
  assert.match(userJs, /Ipon\.confirmAction/);
  assert.match(recordsJs, /Save record changes\?/);
  assert.match(savingsJs, /Ipon\.confirmAction/);
  assert.match(settingsJs, /Save group payment details\?/);
  assert.match(coreJs, /bindReceiptPicker/);
  assert.match(coreJs, /record-review-receipt-btn/);
  assert.match(coreJs, /prepareNumericInputs/);
  assert.match(coreJs, /validateNumericInput/);
  assert.match(userJs, /Ipon\.confirmAction/);
  assert.match(recordsJs, /Save record changes\?/);
  assert.match(savingsJs, /Ipon\.confirmAction/);
  assert.match(settingsJs, /Save group payment details\?/);

  assert.match(css, /\.savings-layout/);
  assert.match(css, /\.goal-calc-panel/);
  assert.match(css, /\.payment-info-card/);
  assert.match(css, /\.receipt-dropzone/);
  assert.match(css, /\.record-review-receipt/);
  assert.match(css, /\.image-viewer-dialog/);

  assert.match(migration, /payment_qr_url/);
  assert.match(migration, /receipt_url/);
  assert.match(migration, /20261114_043/);
  const migration044 = read('database/migrations/20261114_044_pending_review_receipts.sql');
  assert.match(migration044, /20261114_044/);

  const migration045 = read('database/migrations/20261114_045_delete_savings_goal.sql');
  assert.match(migration045, /create or replace function public\.delete_savings_goal/i);
  assert.match(migration045, /20261114_045/);
  assert.match(savingsHtml, /id="calc-plan-name"/);
  assert.match(savingsHtml, /id="calc-save-plan"/);
  assert.match(savingsHtml, /id="calc-delete-plan"/);
  assert.match(savingsJs, /delete_savings_goal/);
  assert.match(savingsJs, /Delete savings goal\?/);
  assert.match(savingsJs, /Delete saved plan\?/);
  assert.match(settingsHtml, /class="settings-layout"/);
  assert.match(settingsJs, /Remove group payment QR\?/);
  assert.match(css, /\.settings-layout/);
  assert.match(css, /\.settings-access-panel/);
  assert.match(coreJs, /initPullToRefresh/);
  assert.match(coreJs, /triggerManualRefresh/);
  assert.match(coreJs, /controllerchange/);
  assert.match(css, /\.ptr-indicator/);
  assert.match(css, /\.ptr-spinner/);
});

test('role-based notifications and device drawer alerts are wired across SQL, SW, Android, and UI', () => {
  const migration046 = read('database/migrations/20261114_046_complete_role_notifications.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const accountHtml = read('account.html');
  const accountJs = read('js/account.js');
  const sw = read('sw.js');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const pkg = JSON.parse(read('package.json'));

  assert.match(migration046, /create or replace function public\.group_admin_ids/i);
  assert.match(migration046, /create or replace function public\.notify_record_activity/i);
  assert.match(migration046, /create or replace function public\.notify_feature_request_created/i);
  assert.match(migration046, /create or replace function public\.notify_bug_report_created/i);
  assert.match(migration046, /create or replace function public\.notify_announcement_created/i);
  assert.match(migration046, /create or replace function public\.sync_my_due_reminders/i);
  assert.match(migration046, /new\.role in \('MEMBER', 'TREASURER'\)/i);
  assert.match(migration046, /'ACCESS_UPDATED'/);
  assert.match(migration046, /'GROUP_INVITE_ACCEPTED'/);
  assert.match(migration046, /'GROUP_INVITE_DECLINED'/);
  assert.match(migration046, /'FEATURE_REQUEST_REVIEWED'/);
  assert.match(migration046, /20261114_046/);
  assert.match(schema, /20261114_046/);

  assert.match(manifest, /android\.permission\.POST_NOTIFICATIONS/);
  assert.ok(pkg.devDependencies['@capacitor/local-notifications'], 'Capacitor LocalNotifications must be installed');
  assert.match(sw, /addEventListener\('push'/);
  assert.match(sw, /addEventListener\('notificationclick'/);
  assert.match(core, /dispatchDeviceNotification/);
  assert.match(core, /requestDeviceNotificationPermission/);
  assert.match(core, /scheduleNativeDueReminders/);
  assert.match(core, /bindDeviceNotificationControls/);
  assert.match(core, /sync_my_due_reminders/);
  assert.match(accountHtml, /data-device-notif-row/);
  assert.match(accountJs, /bindDeviceNotificationControls/);
});

test('background notification feed, permission banner, and native poll receiver stay synchronized', () => {
  const migration047 = read('database/migrations/20261114_047_background_notification_feed.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const css = read('css/app.css');
  const versionJson = JSON.parse(read('version.json'));
  const capConfig = JSON.parse(read('capacitor.config.json'));
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');

  assert.match(migration047, /create table if not exists public\.notification_feed_tokens/i);
  assert.match(migration047, /create or replace function public\.ensure_notification_feed_token/i);
  assert.match(migration047, /create or replace function public\.revoke_notification_feed_token/i);
  assert.match(migration047, /create or replace function public\.get_unread_notifications_by_token/i);
  assert.match(migration047, /20261114_047/);
  assert.match(schema, /20261114_047/);

  assert.equal(versionJson.nativeBuild, 19);
  assert.match(capConfig.appendUserAgent, /myIPONApp\/19/);
  assert.match(manifest, /com\.myipon\.app\.NotificationPollReceiver/);
  assert.match(mainActivity, /registerPlugin\(BackgroundNotificationsPlugin\.class\)/);
  assert.match(bgPlugin, /@CapacitorPlugin\(name = "BackgroundNotifications"\)/);
  assert.match(pollReceiver, /get_unread_notifications_by_token/);

  assert.match(core, /id="notification-permission-bar"/);
  assert.match(core, /ensure_notification_feed_token/);
  assert.match(core, /syncBackgroundNotificationPolling/);
  assert.match(core, /setNotificationPreference/);
  assert.match(css, /\.notification-permission-bar/);
});

test('announcement reactions notify Super Admin and authors for in-app and mobile alerts', () => {
  const migration048 = read('database/migrations/20261114_048_announcement_reaction_notifications.sql');
  const schema = read('database/schema.sql');

  assert.match(migration048, /create or replace function public\.notify_announcement_reaction/i);
  assert.match(migration048, /create trigger announcement_reactions_notifications[\s\S]*after insert or update on public\.announcement_reactions/i);
  assert.match(migration048, /'ANNOUNCEMENT_REACTION'/);
  assert.match(migration048, /'super-admin\.html#announcements'/);
  assert.match(migration048, /20261114_048/);
  assert.match(schema, /create trigger announcement_reactions_notifications/i);
  assert.match(schema, /20261114_048/);
});

test('stacked mobile form action buttons reset flex basis instead of stretching vertically', () => {
  const css = read('css/app.css');
  assert.match(css, /\.settings-inline-actions \.button,\s*\.settings-form-actions-end \.button\s*\{\s*flex:\s*0 0 auto;/);
});

test('every Ipon helper called across scripts is exported by js/core.js', () => {
  const core = read('js/core.js');
  const exportBlockMatch = core.match(/window\.Ipon\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(exportBlockMatch, 'window.Ipon export object must exist in js/core.js');

  const rawBody = exportBlockMatch[1]
    .replace(/\bget\s+([A-Za-z_$][\w$]*)\s*\(\)\s*\{[^}]*\}/g, '$1')
    .replace(/\b([A-Za-z_$][\w$]*)\s*:/g, '$1');
  const exported = new Set(
    rawBody
      .split(',')
      .map((part) => part.trim())
      .filter((token) => /^[A-Za-z_$][\w$]*$/.test(token))
  );

  const jsFiles = readdirSync(new URL('js', root)).filter((file) => file.endsWith('.js'));
  for (const file of jsFiles) {
    const src = read(`js/${file}`);
    for (const match of src.matchAll(/\bIpon\.([A-Za-z_$][\w$]*)\s*\(/g)) {
      const fnName = match[1];
      assert.ok(exported.has(fnName), `${file} calls Ipon.${fnName}() which is missing from window.Ipon`);
    }
  }
});

test('mobile UI polish, custom group switchers, clickable notifications, version sync, and Super Admin deep-links are wired', () => {
  const css = read('css/app.css');
  const core = read('js/core.js');
  const dashboard = read('js/dashboard.js');
  const members = read('js/members.js');
  const settings = read('js/settings.js');
  const superAdmin = read('js/super-admin.js');
  const versionJson = JSON.parse(read('version.json'));
  const versionJs = read('js/version.js');
  const prepareMobile = read('scripts/prepare-mobile.mjs');

  assert.match(css, /@media\(max-width:620px\)\{[^}]*\.account-dialog\{[^}]*max-width:none/);
  assert.doesNotMatch(core, /account-section-icon/);
  assert.doesNotMatch(css, /\.account-section-icon\b/);
  assert.equal((css.match(/select:not\(\.custom-select-native\)\{/g) || []).length, 1, 'select custom-select CSS should not be duplicated');

  assert.match(core, /data-nav-target="\$\{escapeHtml\(safeTarget\)\}"/);
  assert.match(css, /\.notification-item\[data-nav-target\],\.notification-item\.is-unread\{cursor:pointer\}/);

  assert.match(core, /function populateGroupSelect\(/);
  assert.match(dashboard, /Ipon\.populateGroupSelect\(groupHubSelect/);
  assert.match(dashboard, /Ipon\.populateGroupSelect\(groupSelect/);
  assert.match(members, /Ipon\.populateGroupSelect\(groupSelect/);
  assert.match(settings, /Ipon\.populateGroupSelect\(groupSelect/);

  assert.match(versionJs, new RegExp(`version:\\s*'${versionJson.version.replace('.', '\\.')}'`));
  assert.match(versionJs, new RegExp(`nativeBuild:\\s*${versionJson.nativeBuild}`));
  assert.match(versionJs, /isApp:\s*false/);
  assert.match(prepareMobile, /fs\.writeFileSync\(path\.join\(rootDir,\s*'js',\s*'version\.js'\),\s*webVersionJsContent/);

  assert.match(superAdmin, /getElementById\(`\$\{key\}-pager`\)/);
  assert.match(superAdmin, /requestedView === 'announcements'/);
});

test('workflow enhancements migration 049, schema sync, and all UI integrations are wired cleanly', () => {
  const migration049 = read('database/migrations/20261114_049_workflow_and_planning_enhancements.sql');
  const schema = read('database/schema.sql');
  const sw = read('sw.js');
  const core = read('js/core.js');
  const css = read('css/app.css');
  const savingsJs = read('js/savings.js');
  const recordsJs = read('js/records.js');
  const reportsJs = read('js/reports.js');
  const reportsHtml = read('reports.html');
  const dashboardJs = read('js/dashboard.js');
  const dashboardHtml = read('dashboard.html');
  const auditJs = read('js/audit.js');
  const auditHtml = read('audit.html');
  const settingsJs = read('js/settings.js');
  const settingsHtml = read('settings.html');
  const userJs = read('js/user.js');
  const userHtml = read('user.html');
  const superAdminJs = read('js/super-admin.js');
  const superAdminHtml = read('super-admin.html');
  const contributionsHtml = read('contributions.html');

  // Database migration & schema sync
  for (const symbol of [
    'cycle_start_date',
    'set_group_cycle_start',
    'set_period_exemption',
    'record_contribution_with_carryover',
    'bulk_confirm_contributions',
    'remind_unpaid_members',
    'payment_streak',
    'on_time_streak',
    'savings_calculator_plans',
    'super_admin_storage_overview',
    'super_admin_cleanup_rejected_receipts',
    '20261114_049'
  ]) {
    assert.ok(migration049.includes(symbol), `migration 049 missing ${symbol}`);
    assert.ok(schema.includes(symbol), `schema.sql missing ${symbol}`);
  }

  // Service worker offline shell + connectivity banner
  assert.match(sw, /ipon-shell-v7/);
  assert.match(sw, /ignoreSearch:\s*true/);
  assert.match(core, /function initConnectivityBanner\(/);
  assert.match(core, /function initInfoTips\(/);
  assert.match(core, /function remindUnpaidMembers\(/);
  assert.match(css, /\.offline-status-banner/);
  assert.match(css, /\.info-tip-btn/);
  assert.match(css, /\.info-tip-popover/);
  assert.match(css, /\.summary-list\s*>\s*div/);
  assert.doesNotMatch(css, /\.summary-list\s+div\s*\{/);

  // Feature wiring across pages
  assert.match(savingsJs, /from\('savings_calculator_plans'\)/);
  assert.match(contributionsHtml, /id="allocate-excess"/);
  assert.match(contributionsHtml, /id="bulk-confirm-bar"/);
  assert.match(recordsJs, /set_period_exemption/);
  assert.match(recordsJs, /record_contribution_with_carryover/);
  assert.match(recordsJs, /bulk_confirm_contributions/);
  assert.match(reportsHtml, /id="remind-unpaid-btn"/);
  assert.match(reportsHtml, /<option>EXEMPT<\/option>/);
  assert.match(reportsJs, /Ipon\.remindUnpaidMembers/);
  assert.match(reportsJs, /<option value="ALL">All years<\/option>/);
  assert.match(dashboardHtml, /id="dashboard-cycle-badge"/);
  assert.match(dashboardHtml, /id="dashboard-bulk-confirm-btn"/);
  assert.match(dashboardHtml, /id="bulk-confirm-dialog"/);
  assert.match(dashboardJs, /bulk_confirm_contributions/);
  assert.match(dashboardJs, /Ipon\.remindUnpaidMembers/);
  assert.match(auditHtml, /id="audit-search"/);
  assert.match(auditHtml, /id="audit-date-from"/);
  assert.match(auditJs, /audit-search/);
  assert.match(settingsHtml, /id="cycle-start-month"/);
  assert.match(settingsJs, /set_group_cycle_start/);
  assert.match(userHtml, /id="user-streak"/);
  assert.match(userHtml, /id="user-history-pager"/);
  assert.match(userJs, /data-resubmit/);
  assert.match(userJs, /record_contribution_with_carryover/);
  assert.match(superAdminHtml, /id="sa-storage-grid"/);
  assert.match(superAdminJs, /super_admin_storage_overview/);
  assert.match(superAdminJs, /super_admin_cleanup_rejected_receipts/);
});

test('HTML files have valid UTF-8 characters and intact stylesheet/script asset URLs', () => {
  const htmlFiles = readdirSync(root).filter((file) => file.endsWith('.html'));
  for (const file of htmlFiles) {
    const html = read(file);
    assert.doesNotMatch(html, /\uFFFD|\u00E2\u20AC|\u00E2\u201A/, `${file} must not contain replacement characters or mojibake`);
    assert.doesNotMatch(html, /(?:href|src)="=2026/, `${file} must not have corrupted asset URL`);
    assert.match(html, /href="css\/app\.css\?v=/, `${file} must link css/app.css`);
    assert.match(html, /src="js\/core\.js\?v=/, `${file} must load js/core.js`);
  }
});

test('account creation, login activation, and mobile submit responsiveness contracts', () => {
  const migration050 = read('database/migrations/20261114_050_fix_account_creation_and_login_activation.sql');
  const schema = read('database/schema.sql');
  const authJs = read('js/auth.js');
  const coreJs = read('js/core.js');
  const manageAccountTs = read('supabase/functions/manage-account/index.ts');

  // Migration 050 + schema parity
  assert.match(migration050, /function public\.activate_own_pending_account\(\)/);
  assert.match(migration050, /'20261114_050'/);
  assert.match(schema, /function public\.activate_own_pending_account\(\)/);
  assert.match(schema, /'20261114_050'/);

  // Auth page must attach submit handler synchronously without top-level await blocking taps
  assert.doesNotMatch(authJs, /^\s*\(async function\s*\(\)/);
  assert.match(authJs, /const initPromise = Ipon\.init\(/);
  const initIdx = authJs.indexOf('const initPromise = Ipon.init(');
  const submitIdx = authJs.indexOf("form.addEventListener('submit'");
  assert.ok(initIdx >= 0 && submitIdx > initIdx, 'submit listener must register synchronously after initPromise starts');

  // Auth login + auto-login verify real DB activation instead of faking ACTIVE in memory
  assert.match(authJs, /async function resolveActiveProfile\(/);
  assert.match(authJs, /Ipon\.rpc\('activate_own_pending_account'\)/);
  assert.doesNotMatch(authJs, /profile\.status\s*=\s*'ACTIVE'/);
  assert.match(authJs, /statusParam === 'pending'/);
  assert.match(authJs, /statusParam === 'disabled'/);

  // Core phone setup + active session redirect consistency
  assert.match(coreJs, /function profileNeedsSetup\(profile\)\s*\{[\s\S]*?validPhoneNumber\(profile\.contact_number\)/);
  assert.match(coreJs, /accountSetupUrl\(profile, session\.user\) \|\| homeForRole\(profile\.role\)/);
  for (const scriptFile of readdirSync(new URL('js', root)).filter((f) => f.endsWith('.js'))) {
    assert.doesNotMatch(
      read(`js/${scriptFile}`),
      /client\.(?:rpc|from)\([^\n]*\.catch\(/,
      `${scriptFile} must not call .catch() directly on a Supabase Postgrest builder`
    );
  }

  // Manage-account Edge Function: paginated auth lookup, membership activation, email_confirm on password reset, no unscoped global PENDING activation
  assert.match(manageAccountTs, /async function findAuthUserByEmail\(/);
  assert.match(manageAccountTs, /async function activateUserAndMembership\(/);
  assert.match(manageAccountTs, /if \(body\.action === 'admin-set-password'\)[\s\S]*?email_confirm:\s*true/);
  assert.match(manageAccountTs, /if \(body\.action === 'admin-set-password'\)[\s\S]*?activateUserAndMembership\(admin, target\.id\)/);
  assert.doesNotMatch(manageAccountTs, /\.from\('profiles'\)\.update\(\{ status: 'ACTIVE' \}\)\.eq\('status', 'PENDING'\)/);

  // Automatic Supabase CLI migration script & workflow wiring
  const pkg = JSON.parse(read('package.json'));
  const migrateScript = read('scripts/supabase-migrate.mjs');
  const deployWorkflow = read('.github/workflows/deploy-database.yml');
  const vsTasks = JSON.parse(read('.vscode/tasks.json'));
  assert.match(pkg.scripts['db:status'] || '', /supabase-migrate\.mjs --status/);
  assert.match(pkg.scripts['db:migrate'] || '', /supabase-migrate\.mjs --apply/);
  assert.match(pkg.scripts['supabase:deploy'] || '', /supabase-migrate\.mjs --apply --deploy-functions/);
  assert.match(pkg.scripts['supabase:sync'] || '', /supabase-migrate\.mjs --sync/);
  assert.match(pkg.scripts['supabase:watch'] || '', /supabase-migrate\.mjs --sync --watch/);
  assert.match(migrateScript, /--no-verify-jwt/);
  assert.match(migrateScript, /deployed-functions\.json/);
  assert.match(deployWorkflow, /SUPABASE_ACCESS_TOKEN/);
  assert.ok(vsTasks.tasks.some((t) => t.runOptions?.runOn === 'folderOpen' && t.command === 'npm run supabase:sync'));
});

