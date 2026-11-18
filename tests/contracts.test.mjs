import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('all browser scripts pass syntax validation', () => {
  const directory = fileURLToPath(new URL('../js/', import.meta.url));
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', join(directory, file)]);
  }
});

test('large JPEG and static PNG uploads use bounded WebP only when it saves space', async () => {
  const core = read('js/core.js');
  const messages = read('js/messages.js');
  const helper = core.match(/  async function optimizeUploadImage\(file\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper);
  function makeFile(parts, name, options) {
    Object.assign(this, { name, type: options.type, size: parts[0].size, lastModified: options.lastModified });
  }
  const input = { name: 'photo.jpg', type: 'image/jpeg', size: 16 * 1024 * 1024, lastModified: 123 };
  let outputSize = 400 * 1024;
  let closed = false;
  let canvas;
  let quality;
  const pngBytes = new Uint8Array(20);
  pngBytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  pngBytes.set([73, 68, 65, 84], 12);
  const context = {
    File: makeFile,
    createImageBitmap: async () => ({ width: 4000, height: 3000, close: () => { closed = true; } }),
    document: { createElement: () => (canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toBlob: (done, _type, q) => { quality = q; done({ type: 'image/webp', size: outputSize }); } }) }
  };
  const optimize = vm.runInNewContext(`(${helper.trim()})`, context);
  const result = await optimize(input);
  assert.equal(result.name, 'photo.webp');
  assert.equal(result.type, 'image/webp');
  assert.equal(result.size, outputSize);
  assert.equal(result.lastModified, input.lastModified);
  assert.equal(canvas.width, 2560);
  assert.equal(canvas.height, 1920);
  assert.equal(quality, 0.9);
  assert.equal(closed, true);
  const png = { ...input, name: 'photo.png', type: 'image/png', slice: () => ({ arrayBuffer: async () => pngBytes.buffer }) };
  assert.equal((await optimize(png)).name, 'photo.webp');
  assert.equal(canvas.width, 2560);
  assert.equal(canvas.height, 1920);
  assert.equal(quality, 0.9);
  pngBytes.set([97, 99, 84, 76], 12);
  assert.equal(await optimize(png), png);
  outputSize = 15 * 1024 * 1024;
  assert.equal(await optimize(input), input);
  const gif = { ...input, type: 'image/gif' };
  assert.equal(await optimize(gif), gif);
  assert.match(core, /files: media\.map\(\(entry\) => \(\{ name: entry\.file\.name/);
  assert.match(messages, /entry\.file = await ipon\(\)\.optimizeUploadMedia\(entry\.file\)/);
});

test('MP4 and MP3 uploads use smaller playable encodes before signing and retain originals on failure', async () => {
  const core = read('js/core.js');
  const helper = core.match(/  async function optimizeUploadMedia\(file\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper);
  const commands = [];
  let encodedSize = 500_000;
  const codec = {
    writeFile: async () => {},
    exec: async (args) => { commands.push(args); return 0; },
    readFile: async () => new Uint8Array(encodedSize),
    deleteFile: async () => {}
  };
  function MockFile(parts, name, options) {
    Object.assign(this, { name, type: options.type, size: parts[0].length, lastModified: options.lastModified });
  }
  const context = {
    File: MockFile,
    crypto: { randomUUID: () => String(commands.length) },
    optimizeUploadImage: async (file) => file,
    loadMediaCodec: async () => codec,
    mediaCodecQueue: Promise.resolve()
  };
  const optimize = vm.runInNewContext(`(${helper.trim()})`, context);
  const mp4 = { name: 'clip.mp4', type: 'video/mp4', size: 5_000_000, lastModified: 1, arrayBuffer: async () => new ArrayBuffer(8) };
  const video = await optimize(mp4);
  assert.equal(video.type, 'video/mp4');
  assert.equal(video.size, encodedSize);
  assert.ok(commands[0].includes('libx264'));
  const mp3 = { ...mp4, name: 'song.mp3', type: 'audio/mpeg' };
  const audio = await optimize(mp3);
  assert.equal(audio.type, 'audio/mpeg');
  assert.ok(commands[1].includes('libmp3lame'));
  encodedSize = 4_500_000;
  assert.equal(await optimize(mp4), mp4);
  assert.equal(await optimize({ ...mp4, name: 'notes.pdf', type: 'application/pdf' }).then((file) => file.name), 'notes.pdf');
  assert.match(core, /files: media\.map\(\(entry\) => \(\{ name: entry\.file\.name/);
  assert.match(read('js/messages.js'), /entry\.file = await ipon\(\)\.optimizeUploadMedia\(entry\.file\)/);
  assert.match(read('vercel.json'), /wasm-unsafe-eval/);
});

test('profile card cover and theme persist with owner-only edits and storage cleanup', () => {
  const migration = read('database/migrations/20261118_116_profile_card_appearance.sql');
  const core = read('js/core.js');
  const messages = read('js/messages.js');
  const edge = read('supabase/functions/manage-account/index.ts');
  const css = read('css/app.css');
  assert.match(migration, /where id = auth\.uid\(\) and status = 'ACTIVE'/);
  assert.match(migration, /card_theme in \('emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono'\)/);
  assert.match(migration, /ipon-media\/covers\/.*auth\.uid\(\)/);
  assert.match(migration, /queue_media_url_deletion\(old\.cover_url\)/);
  assert.match(edge, /'avatars', 'covers', 'group-avatars'/);
  assert.match(core, /id="quick-cover-input"[^>]*accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(core, /openAvatarCropper\(file,\s*\{[\s\S]*mode:\s*'cover'[\s\S]*category:\s*'covers'/);
  assert.match(core, /uploadMediaDataUrl\(croppedDataUrl,\s*\{\s*category,\s*name:\s*uploadName\s*\}\)/);
  assert.match(core, /rpc\('update_own_profile_card', \{ p_cover_url: url \}\)/);
  assert.match(core, /rpc\('update_own_profile_card', \{ p_clear_cover: true \}\)/);
  assert.match(messages, /rpc\('get_profile_card_appearance', \{ p_target_id: targetId \}\)/);
  assert.match(messages, /delete pop\.dataset\.cardTheme/);
  assert.match(css, /\.msg-pop-cover\{/);
  assert.match(css, /\.effects-dock button:focus-visible\s*\{/);
  assert.doesNotMatch(core, /class="account-card-colors"/);
  assert.match(css, /\.notification-dialog\{[^}]*overflow:hidden/);
  assert.match(css, /\.notification-sheet\{[^}]*overflow:hidden;border-radius:inherit/);
  assert.match(css, /html\[data-theme="dark"\] \.account-cover-actions \.button\b/);
  assert.match(css, /html\[data-theme="dark"\] \.msg-profile-popover:has\(\.msg-pop-cover\) \.msg-pop-head \.avatar-circle\.avatar-lg\b/);
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
  assert.match(html, /id="feature-requests-body"/);
  assert.match(html, /id="bug-reports-body"/);
  assert.match(html, /id="administrators-body"/);
  assert.doesNotMatch(html, /id="users-role-filter"/);
  assert.match(html, /id="users-status-filter"/);
  assert.match(html, /id="user-groups-dialog"/);
  assert.match(html, /id="user-password-dialog"/);
  for (const view of ['overview', 'feature-requests', 'bug-reports', 'administrators', 'activity']) {
    assert.match(html, new RegExp(`data-platform-view="${view}"`));
    assert.match(core, new RegExp(`super-admin\\.html#${view}`));
  }
  assert.doesNotMatch(html, /id="(?:requests|requests-body|metric-pending-requests|approve-request-dialog|reject-request-dialog)"/);
  assert.doesNotMatch(html, /super-admin\.html#requests/);
  assert.doesNotMatch(core, /super-admin\.html#requests/);
  assert.doesNotMatch(script, /super_admin_(?:approve|reject|reopen)_request|renderRequests|requestsBody/);
  assert.match(script, /addEventListener\('hashchange'/);
  assert.match(html, /id="platform-attention"/);
  assert.match(html, /id="overview-error"/);
  assert.match(script, /Ipon\.init\(\{ allowedRoles: \['SUPER_ADMIN'\] \}\)/);
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
  assert.match(script, /from\('feature_requests'\)\.select\('id,requester_id,allow_credit,title,details,status,reviewed_at,reviewed_by,release_version,created_at'\)/);
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
  assert.match(script, /from\('bug_reports'\)\.select\('id,reporter_id,title,description,image_count,status,reviewed_at,release_version,created_at'\)/);
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
  assert.doesNotMatch(core, /announcement-role-badge/);
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
  assert.match(dashboard, /if \(!hasSnapshot\)\s*\{\s*renderEmptySnapshot\(\)/);
  assert.doesNotMatch(dashboard, /previous complete snapshot remains visible and may be outdated/);
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
  const indexHtml = read('index.html');
  const auth = read('js/auth.js');
  assert.match(html, /Development preview/);
  assert.match(html, /IPON is still under active development/);
  assert.match(html, /data-policy-open="terms"/);
  assert.match(html, /data-policy-open="privacy"/);
  assert.match(html, /Last updated: November 16, 2026/);
  assert.match(html, /90-day chat &amp; operational TTL|older than 90 days/i);
  assert.match(html, /6-month inactive accounts|inactive for 6 months/i);
  assert.match(html, /7 days prior|7-day prior email notice/i);
  assert.match(html, /financial_annual_archives|annual net-savings summaries/i);
  assert.match(html, /ipon-media/);
  assert.match(html, /capped at 500 characters/i);
  assert.match(html, /body\.is-request-mode :is\(\.development-notice,\.login-legal\)\{display:none\}/);
  assert.match(html, /<dialog class="policy-dialog" id="policy-dialog" aria-labelledby="policy-title">/);
  assert.match(html, /tracking system only and does not hold, transfer, receive, or safeguard money/);
  assert.match(html, /wallet reconciliation balances/i);
  assert.match(html, /30-day soft-delete member recovery bin/i);
  assert.match(html, /Web Push subscription tokens/i);
  assert.match(html, /email <a href="https:\/\/mail\.google\.com\/mail\/\?view=cm&amp;fs=1&amp;to=zedrickdemonteverde1@gmail\.com[^"]*"|email <a href="https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=zedrickdemonteverde1@gmail\.com[^"]*"/);
  assert.match(auth, /policyDialog\.showModal\(\)/);
  assert.match(auth, /new URLSearchParams\(location\.search\)\.get\('policy'\)/);

  // Landing page stays synced with current system features and links directly to updated legal notices
  assert.doesNotMatch(indexHtml, /Once approved, name your group/i);
  assert.match(indexHtml, /href="login\.html\?policy=terms"/);
  assert.match(indexHtml, /href="login\.html\?policy=privacy"/);
  assert.doesNotMatch(indexHtml, /Live announcements/);
  assert.doesNotMatch(indexHtml, /Wallets &amp; payout channels/);
  assert.doesNotMatch(indexHtml, /Push alerts &amp; dark mode/);
  assert.doesNotMatch(indexHtml, /id="demo-theme-toggle"/);
  assert.doesNotMatch(indexHtml, /Can I switch themes or turn on phone notifications\?/);
  assert.match(indexHtml, /Record discussions &amp; proofs/);
  assert.match(indexHtml, /<div class="l-nav-cta">[\s\S]*Sign in[\s\S]*Sign up[\s\S]*<\/div>/);
  assert.doesNotMatch(indexHtml, /class="l-btn[^"]*"[^>]*>[\s\S]*?M5 12h14m-6-6 6 6-6 6/);
  assert.match(indexHtml, /<section class="l-trust"[^>]*>[\s\S]*E-wallet · Bank · Cash[\s\S]*<\/section>/);
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
  assert.match(css, /\.account-card\{[^}]*background:#fcfaf5/);
  assert.match(css, /\.account-section-heading h3\{[^}]*"IPON Serif",serif/);
  assert.match(css, /\.account-profile-identity strong\{[^}]*"IPON Serif",serif/);
  assert.match(css, /\.account-support\{[^}]*margin-top:auto/);
  assert.match(css, /\.account-support strong\{[^}]*"IPON Serif",serif/);
  assert.match(css, /\.account-support \.button\{[^}]*border-radius:999px/);
  assert.match(css, /\.payout-fieldset-grid\s*>\s*\.payout-detail-field:last-of-type\s*\{[^}]*grid-column:\s*1 \/ -1;/);
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

test('administrator audit log lives inside Reports and Manage Group hub', () => {
  const dashHtml = read('dashboard.html');
  assert.match(read('reports.html'), /<a[^>]+href="audit\.html"[^>]+data-role="ADMIN"[^>]+id="reports-open-audit"[\s\S]*?<span>Audit log<\/span>/);
  assert.match(dashHtml, /<a class="group-hub-link" href="audit\.html" data-role="ADMIN">[\s\S]*?<strong>Audit log<\/strong>/);
  assert.doesNotMatch(dashHtml.match(/<nav class="app-nav[\s\S]*?<\/nav>/)?.[0] || '', /audit\.html|settings\.html/);
  assert.match(read('audit.html'), /<dialog[^>]+id="audit-detail-dialog"[^>]+aria-labelledby="audit-detail-title"/);
  assert.match(read('js/audit.js'), /detailDialog\.showModal\(\)/);
  assert.doesNotMatch(read('js/audit.js'), /<details\b/);
});

test('logout protects restored pages from browser history and lives at the bottom of settings', () => {
  const core = read('js/core.js');
  const dashHtml = read('dashboard.html');
  const settingsHtml = read('settings.html');
  const accountHtml = read('account.html');
  assert.match(core, /addEventListener\('pagehide'[\s\S]*?visibility = 'hidden'/);
  assert.match(core, /addEventListener\('pageshow'[\s\S]*?event\.persisted[\s\S]*?auth\.getSession\(\)[\s\S]*?location\.replace\('login\.html'\)/);
  assert.match(core, /homeForRole, signOut, toast/);
  assert.match(core, /signOut\(\)[\s\S]*?confirmAction\(\{ title: 'Sign out\?'/);
  assert.match(core, /querySelectorAll\('\[data-sign-out\]'\)\.forEach\(\(button\) => button\.onclick = signOut\)/);
  assert.doesNotMatch(dashHtml, /dashboard-signout|sidebar-signout/);
  assert.doesNotMatch(core, /class="sidebar-signout|id="sign-out"/);
  assert.match(core, /class="account-card account-session-card"[\s\S]*?id="account-dialog-signout" data-sign-out/);
  assert.match(settingsHtml, /class="panel settings-session-panel"[\s\S]*?id="settings-signout" data-sign-out/);
  assert.match(accountHtml, /class="panel account-page-session-panel"[\s\S]*?id="account-page-signout" data-sign-out/);
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

test('compact dashboard header keeps notifications and profile in one ordered row without sidebar logout', () => {
  const dashboardCss = read('css/hero-plates.css');
  const appCss = read('css/app.css');
  assert.match(appCss, /\.app-sidebar-footer\s*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(appCss, /\.sidebar-user-card\s*\{[^}]*grid-column:1\/-1;[^}]*grid-row:1/);
  assert.doesNotMatch(appCss, /\.sidebar-signout/);
  assert.doesNotMatch(dashboardCss, /\.sidebar-signout/);
  assert.match(dashboardCss, /@media \(max-width:860px\)[\s\S]*?\.dashboard-sidebar \.app-sidebar-footer\s*\{[^}]*grid-row:1/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-user-card\s*\{[^}]*order:2/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-utilities\s*\{[^}]*order:1/);
  assert.match(dashboardCss, /\.dashboard-sidebar \.sidebar-utility\[data-donate-open\]\s*\{\s*display:none/);
  assert.match(appCss, /@media\(max-width:720px\)\{\.app-sidebar-footer \.sidebar-utilities\{order:1\}\.sidebar-user-card\{order:2\}/);
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
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)]
      .map((match) => /src="([^"]+)"/i.exec(match[1])?.[1]?.split('?')[0])
      .filter(Boolean);
    assert.equal(new Set(scripts).size, scripts.length, `${file} loads duplicate scripts`);
    const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/gi)]
      .map((match) => /href="([^"]+)"/i.exec(match[0])?.[1]?.split('?')[0])
      .filter(Boolean);
    assert.equal(new Set(links).size, links.length, `${file} loads duplicate stylesheets`);
    for (const tag of ['dialog', 'section', 'form', 'div']) {
      const opens = (html.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
      const closes = (html.match(new RegExp(`<\\/${tag}>`, 'gi')) || []).length;
      assert.equal(opens, closes, `${file} contains unbalanced <${tag}> tags (${opens} vs ${closes})`);
    }
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
  assert.doesNotMatch(html, /#auth-submit[^}]*(\\2192|→)/);
});

test('mobile navigation and data tables do not require horizontal scrolling', () => {
  const css = read('css/app.css');
  const dashboardCss = read('css/hero-plates.css');
  const core = read('js/core.js');
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.app-nav\s*\{[^}]*display:grid/i);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.record-tabs\s*\{[^}]*grid-template-columns:repeat\(5/i);
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
  assert.doesNotMatch(css, /\.data-table-wrap\s*\{[^}]*overflow-x:\s*auto/i);
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
  assert.match(script, /goalPrefStorageKey\(groupId\)/);
  assert.match(script, /selectedGoalId = goalOptions\[0\]\.id/);
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
  assert.match(read('login.html'), /id="request-success-dialog"/);
  const authJs = read('js/auth.js');
  assert.match(authJs, /setMode\('login'\)[\s\S]*requestSuccessDialog\?\.showModal\(\)/);
  const migration031 = read('database/migrations/20261113_031_block_rejected_admin_request_emails.sql');
  assert.match(migration031, /create or replace function public\.check_admin_request_eligibility/);
  assert.match(migration031, /create or replace function public\.super_admin_reject_request/);
  assert.match(schema, /create or replace function public\.check_admin_request_eligibility/);
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
  assert.match(css, /\.pm-pill > span\s*\{/);
  assert.doesNotMatch(css, /\.pm-pill\s+span\s*\{/);
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
  assert.doesNotMatch(script, /RELEASE_INTROS|RELEASE_OUTROS|composeReleaseNotes|humanizeReleaseUpdate/);
  assert.match(script, /release-update-ai-btn/);
  assert.match(script, /ai-generate-release-notes/);
  assert.match(html, /id="release-update-ai-error"/);

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
  assert.match(script, /select\('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,avatar_url,created_at(?:,[^']*)?'\)/);

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
  assert.match(core, /class="release-credit-name"/);
  assert.doesNotMatch(core, /if\s*\(descHasRequested\)\s*return;/);
  assert.match(core, /inlineRequested\[0\]\.replaceWith/);
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

test('system integrates server-side Gemini AI for release updates without procedural templates', () => {
  const edge = read('supabase/functions/manage-account/index.ts');
  const superAdminHtml = read('super-admin.html');
  const superAdminJs = read('js/super-admin.js');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const css = read('css/app.css');

  assert.match(edge, /generateWithGemini/);
  assert.doesNotMatch(edge, /generateProceduralReleaseNotes|humanizeReleaseUpdate/);
  assert.match(edge, /action === 'ai-generate-release-notes'/);
  assert.match(edge, /action === 'gemini-key-status'/);
  assert.match(edge, /action === 'save-gemini-key'/);
  assert.match(edge, /resolveServerGeminiKey/);
  assert.match(edge, /internal_webhook_config/);
  assert.match(edge, /BILLING_DISABLED/);
  assert.match(edge, /Deno\.env\.get\('GEMINI_API_KEY'\)/);
  assert.doesNotMatch(edge, /action === 'ai-savings-insights'/);
  assert.match(edge, /action === 'test-gemini-key'/);
  assert.match(edge, /gemini-1\.5-flash/);

  assert.match(superAdminHtml, /id="release-update-ai-btn"/);
  assert.match(superAdminHtml, /id="release-update-key-btn"/);
  assert.match(superAdminHtml, /id="release-update-ai-status"/);
  assert.match(superAdminHtml, /id="release-update-ai-error"/);

  assert.match(superAdminJs, /release-update-ai-btn/);
  assert.match(superAdminJs, /ai-generate-release-notes/);
  assert.match(superAdminJs, /save-gemini-key/);
  assert.match(superAdminJs, /Configure API key/);
  assert.match(superAdminJs, /Ipon\.showInlineError\(\s*releaseAiError/);
  assert.doesNotMatch(superAdminJs, /localStorage\.setItem\('ipon_gemini_api_key'/);
  assert.doesNotMatch(superAdminJs, /RELEASE_INTROS|RELEASE_OUTROS|composeReleaseNotes|humanizeReleaseUpdate/);

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
  assert.match(dashJs, /is-empty-group/);
  assert.match(core, /data-invite-action="accept"/);
  assert.match(core, /data-invite-action="decline"/);
  assert.match(core, /accept_group_invitation/);
  assert.match(core, /decline_group_invitation/);
  assert.match(css, /\.notification-invite-actions/);
  assert.match(css, /\.no-group-card/);
  assert.match(css, /\.summary-card\.is-empty-group/);
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
  assert.doesNotMatch(accountHtml, /Phone &amp; drawer alerts|data-device-notif-row/);
  assert.doesNotMatch(core, /Phone &amp; drawer alerts|<[^>]+data-device-notif-row/);
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

  assert.equal(versionJson.nativeBuild, 20);
  assert.match(capConfig.appendUserAgent, /myIPONApp\/20/);
  assert.match(manifest, /com\.myipon\.app\.NotificationPollReceiver/);
  assert.match(mainActivity, /registerPlugin\(BackgroundNotificationsPlugin\.class\)/);
  assert.match(bgPlugin, /@CapacitorPlugin\([\s\S]*?name\s*=\s*"BackgroundNotifications"/);
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

  assert.match(versionJs, new RegExp(`["']?version["']?:\\s*['"]${versionJson.version.replaceAll('.', '\\.')}['"]`));
  assert.match(versionJs, new RegExp(`["']?nativeBuild["']?:\\s*${versionJson.nativeBuild}`));
  assert.match(versionJs, /["']?isApp["']?:\s*false/);
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
  assert.match(sw, /ipon-shell-v(?:11|12|\d+)/);
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

test('group-required prompts block recording flows before form submission when user has no active group', () => {
  const coreJs = read('js/core.js');
  const dashboardJs = read('js/dashboard.js');
  const recordsJs = read('js/records.js');
  const userJs = read('js/user.js');

  assert.match(coreJs, /function showGroupRequiredDialog\(/);
  assert.match(coreJs, /function renderGroupRequiredCard\(/);
  assert.match(coreJs, /dashboard\.html\?create_group=1/);
  assert.match(dashboardJs, /function openQuickRecordDialog\([\s\S]*?Ipon\.showGroupRequiredDialog\(/);
  assert.match(dashboardJs, /create_group'\) === '1'/);
  assert.match(recordsJs, /if \(!state\.profile\.group_id\)\s*\{\s*Ipon\.renderGroupRequiredCard\(/);
  assert.match(userJs, /if \(!state\.profile\.group_id \|\| !state\.profile\.member_id\)\s*\{\s*Ipon\.showGroupRequiredDialog\(/);
  assert.doesNotMatch(userJs, /submit-contribution'\)\.disabled\s*=\s*!data\.member_id/);
});

test('announcement reaction notifications replace or remove prior reaction entries instead of flooding', () => {
  const migration051 = read('database/migrations/20261114_051_dedupe_announcement_reaction_notifications.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');

  assert.match(migration051, /add column if not exists dedupe_key text/i);
  assert.match(migration051, /notifications_recipient_dedupe_uidx/i);
  assert.match(migration051, /after insert or update or delete on public\.announcement_reactions/i);
  assert.match(migration051, /if tg_op = 'DELETE' then/i);
  assert.match(migration051, /on conflict \(recipient_id, dedupe_key\) where dedupe_key is not null\s*do update/i);
  assert.match(migration051, /20261114_051/);

  assert.match(schema, /after insert or update or delete on public\.announcement_reactions/i);
  assert.match(schema, /20261114_051/);

  assert.match(coreJs, /select\('id,group_id,type,title,message,link,dedupe_key,read_at,created_at'\)/);
  assert.match(coreJs, /event: '\*', schema: 'public', table: 'notifications'/);
  assert.match(coreJs, /realtimePayload\?\.eventType !== 'DELETE'/);
});

test('release composer reads live recent commits and prior releases instead of frozen Update 1.0 bullets', () => {
  const superAdminJs = read('js/super-admin.js');
  const edgeTs = read('supabase/functions/manage-account/index.ts');

  assert.match(superAdminJs, /fetchRecentSystemUpdates/);
  assert.match(superAdminJs, /collectReleaseContext/);
  assert.match(superAdminJs, /api\.github\.com\/repos\/zediskaaa\/Ipon-Tracking-System\/commits/);
  assert.doesNotMatch(superAdminJs, /Interactive Avatar Studio/);
  assert.doesNotMatch(superAdminJs, /Synchronized Group Pledges/);

  assert.match(edgeTs, /fetchRecentSystemUpdates/);
  assert.match(edgeTs, /previous_releases/);
  assert.doesNotMatch(edgeTs, /Profile Picture Editor: Crop, rotate 90 degrees/);

  assert.match(superAdminJs, /TECH_COMMIT_RE/);
  assert.match(superAdminJs, /CODE_TOKEN_RE/);
  assert.match(edgeTs, /cleanCommitSummary/);
  assert.match(edgeTs, /findMissingReleaseItems/);
  assert.match(edgeTs, /Missed changes/);

  assert.doesNotMatch(superAdminJs, /RELEASE_FEATURE_CATALOG|RELEASE_FALLBACK_POOLS|RELEASE_FALLBACK_UPDATES|RELEASE_INTROS|RELEASE_OUTROS|humanizeReleaseUpdate|composeReleaseNotes/);
  assert.doesNotMatch(edgeTs, /RELEASE_FEATURE_CATALOG|EDGE_FALLBACK_UPDATES|humanizeReleaseUpdate|generateProceduralReleaseNotes/);

  const techMatch = superAdminJs.match(/const TECH_COMMIT_RE = (\/.*\/[a-z]*);/);
  const codeMatch = superAdminJs.match(/const CODE_TOKEN_RE = (\/.*\/[a-z]*);/);
  const noiseMatch = superAdminJs.match(/const NOISE_CLAUSE_RE = (\/.*\/[a-z]*);/);
  const verbMatch = superAdminJs.match(/const COMMIT_VERB_RE = (\/.*\/[a-z]*);/);
  const stopWordsMatch = superAdminJs.match(/const COMMIT_STOP_WORDS = new Set\(\[[\s\S]*?\]\);/);
  const canonClauseMatch = superAdminJs.match(/function canonicalizeClauseForParsing\(rawLine\)\s*\{[\s\S]*?\n  \}/);
  const extractMatch = superAdminJs.match(/function extractCommitUpdates\(rawMessage\)\s*\{[\s\S]*?\n  \}/);
  const fnMatch = superAdminJs.match(/function cleanCommitSummary\(rawMessage\)\s*\{[\s\S]*?\n  \}/);
  const stemsMatch = superAdminJs.match(/function extractCommitStems\(text\)\s*\{[\s\S]*?\n  \}/);
  const overlapMatch = superAdminJs.match(/function clausesOverlapTopic\(a, b\)\s*\{[\s\S]*?\n  \}/);
  const canonUpdatesMatch = superAdminJs.match(/function canonicalizeCommitUpdates\(rawItems = \[\], excludedText = ''\)\s*\{[\s\S]*?\n  \}/);
  const missingMatch = superAdminJs.match(/function findMissingReleaseItems\(buckets, expectedRawItems = \[\]\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(techMatch && codeMatch && noiseMatch && verbMatch && stopWordsMatch && canonClauseMatch && extractMatch && fnMatch && stemsMatch && overlapMatch && canonUpdatesMatch && missingMatch, 'release commit extraction and missing-item helpers must exist in js/super-admin.js');
  const sharedCommitScope = `
    const TECH_COMMIT_RE = ${techMatch[1]};
    const CODE_TOKEN_RE = ${codeMatch[1]};
    const NOISE_CLAUSE_RE = ${noiseMatch[1]};
    const COMMIT_VERB_RE = ${verbMatch[1]};
    ${stopWordsMatch[0]}
    ${canonClauseMatch[0]}
    ${extractMatch[0]}
    ${fnMatch[0]}
    ${stemsMatch[0]}
    ${overlapMatch[0]}
    ${canonUpdatesMatch[0]}
    ${missingMatch[0]}
  `;
  const {
    cleanCommitSummary: cleanFn,
    extractCommitUpdates: extractFn,
    canonicalizeCommitUpdates: canonFn,
    findMissingReleaseItems: findMissingFn
  } = new Function(`${sharedCommitScope}; return { cleanCommitSummary, extractCommitUpdates, canonicalizeCommitUpdates, findMissingReleaseItems };`)();

  assert.equal(cleanFn('Add group ownership transfer and permanent deletion flow'), 'Add group ownership transfer and permanent deletion flow');
  assert.equal(cleanFn('Start group creation without pre-opened invite row and fix enforce_group_scope old.amount'), '');
  assert.equal(cleanFn('Keep Add group action visible to members, align HTML CSP, and sync Edge Function cache'), 'Keep Add group action visible to members');
  assert.equal(cleanFn('Make release AI and composer read live repo commits and prior releases'), '');
  assert.equal(cleanFn('Render release feature credits with requester avatar and name pill'), '');
  assert.equal(cleanFn('Auto-sync Supabase migrations and Edge Functions on IDE open and changes'), '');
  assert.equal(cleanFn('Automate Supabase CLI migrations and Edge Function deployment'), '');

  const bundledA = extractFn('Add wallet reconciliation, payout accounts, record discussion threads, and UI polish');
  assert.ok(bundledA.includes('Add wallet reconciliation'), `Expected wallet reconciliation in ${JSON.stringify(bundledA)}`);
  assert.ok(bundledA.includes('Add payout accounts'), `Expected payout accounts in ${JSON.stringify(bundledA)}`);
  assert.ok(bundledA.includes('Add record discussion threads'), `Expected record discussion threads in ${JSON.stringify(bundledA)}`);

  const bundledB = extractFn('Add settings theme switcher, payment channel icons, live announcement names, and AI release notes polish');
  assert.ok(bundledB.includes('Add settings theme switcher'), `Expected theme switcher in ${JSON.stringify(bundledB)}`);
  assert.ok(bundledB.includes('Add payment channel icons'), `Expected payment channel icons in ${JSON.stringify(bundledB)}`);
  assert.ok(bundledB.includes('Add live announcement names'), `Expected live announcement names in ${JSON.stringify(bundledB)}`);

  const bundledC = extractFn('Add money input validation, zero-layout-shift wallet table, mobile-only drawer alerts, and workspace UI/UX skills');
  assert.ok(bundledC.includes('Add money input validation'), `Expected money input validation in ${JSON.stringify(bundledC)}`);
  assert.ok(bundledC.includes('Add zero-layout-shift wallet table'), `Expected zero-layout-shift wallet table in ${JSON.stringify(bundledC)}`);
  assert.ok(bundledC.includes('Add mobile-only drawer alerts'), `Expected mobile-only drawer alerts in ${JSON.stringify(bundledC)}`);
  assert.ok(!bundledC.some(item => /skills/i.test(item)), `Unexpected dev skill item in ${JSON.stringify(bundledC)}`);

  const canonicalPreferLonger = canonFn([
    'Add settings theme switcher\n\n- Add Light/Dark mode switcher inside Settings with readable contrast across dashboards, hero plates, and landing views'
  ]);
  assert.ok(canonicalPreferLonger.some((item) => /Light\/Dark mode switcher inside Settings/i.test(item)), 'canonicalizeCommitUpdates must replace short subject clause with richer commit body explanation');

  const fluffMatch = superAdminJs.match(/function stripReleaseFluffTails\(text\)\s*\{[\s\S]*?\n  \}/);
  const sanMatch = superAdminJs.match(/function sanitizeReleaseDetails\(rawDetails\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fluffMatch && sanMatch, 'stripReleaseFluffTails and sanitizeReleaseDetails must exist in js/super-admin.js');
  const sanitizeFn = new Function(`${sharedCommitScope}; ${fluffMatch[0]}; ${sanMatch[0]}; return sanitizeReleaseDetails;`)();
  const cleaned = sanitizeFn([
    'Welcome to myIPON Update 1.4!',
    'New Features\n• Add group ownership transfer and permanent deletion flow\n• Start group creation without pre-opened invite row and fix enforce_group_scope old.amount\n• Automate Supabase CLI migrations and Edge Function deployment',
    'Thank you for saving with myIPON!'
  ].join('\n\n'));
  assert.equal(cleaned.bulletCount, 1);
  assert.equal(cleaned.strippedCount, 2);
  assert.match(cleaned.text, /Add group ownership transfer and permanent deletion flow/);
  assert.doesNotMatch(cleaned.text, /enforce_group_scope|old\.amount|Edge Function|invite row|CLI|migrations/i);

  const missingDraft = findMissingFn(
    { newFeatures: ['Group Ownership Transfer: Group owners can transfer ownership cleanly.'], fixes: [], improvements: [], securityUpdates: [], otherChanges: [] },
    [
      'Add Light/Dark mode switcher inside Settings with readable contrast across dashboards, hero plates, and landing views',
      'Add record discussion threads',
      'Add payout accounts',
      'Add wallet reconciliation',
      'Fix author names on announcements when a user updates their profile name'
    ]
  );
  assert.ok(missingDraft.some((b) => /Light\/Dark mode switcher/i.test(b)), 'Missing detector must flag Dark Mode when AI omits it');
  assert.ok(missingDraft.some((b) => /record discussion threads/i.test(b)), 'Missing detector must flag Record Discussion Threads when AI omits it');
  assert.ok(missingDraft.some((b) => /payout accounts/i.test(b)), 'Missing detector must flag Payout Accounts when AI omits it');
  assert.ok(missingDraft.some((b) => /wallet reconciliation/i.test(b)), 'Missing detector must flag Wallet Reconciliation when AI omits it');
  assert.ok(missingDraft.some((b) => /author names/i.test(b)), 'Missing detector must flag Author Names fix when AI omits it');

  // Natural AI English bullets with examples ("e.g.,"), "headers", or "functions" must NOT be falsely stripped as code.
  const naturalAiSanitized = sanitizeFn([
    'Welcome to myIPON Update 1.1!',
    'New Features\n• Payment Methods: Tag deposits with clear payment methods (e.g., GCash, Maya, or Bank) inside forms.\n• Dark Mode Polish: Improved dashboard headers, chart contrast, and core tracking functions for smoother navigation.',
    'Thank you!'
  ].join('\n\n'));
  assert.equal(naturalAiSanitized.strippedCount, 0, 'Natural AI English with e.g., headers, or functions must not be falsely stripped');
  assert.equal(naturalAiSanitized.bulletCount, 2);

  // When Gemini naturally paraphrases a commit, findMissingReleaseItems should recognize it instead of re-prompting.
  const naturalAiParaphrase = findMissingFn(
    {
      newFeatures: ['Appearance Modes: Switch smoothly between Warm Light and Forest Dark themes right inside Settings for comfortable viewing day or night.'],
      fixes: [],
      improvements: []
    },
    ['Add Light/Dark mode switcher inside Settings with readable contrast across dashboards, hero plates, and landing views']
  );
  assert.equal(naturalAiParaphrase.length, 0, 'Natural AI paraphrase of Light/Dark mode must not be flagged as missing');

  // Even when another unrelated bullet shares stray words (like "group" or "notifications"), missing items must still be flagged 1-to-1.
  const mergedDecoyDraft = findMissingFn(
    {
      newFeatures: ['Notifications Overview: Updated alert preferences inside Settings for everyday users.'],
      fixes: [],
      improvements: []
    },
    [
      'Make notification cards clickable anywhere and fix mobile My Account dialog width',
      'Upgrade group switcher dropdowns with avatar DPs and role badges'
    ]
  );
  assert.ok(mergedDecoyDraft.some((b) => /notification cards clickable/i.test(b)), 'Per-bullet check must detect missing clickable notification cards item');
  assert.ok(mergedDecoyDraft.some((b) => /group switcher dropdowns/i.test(b)), 'Per-bullet check must detect missing group switcher dropdowns item');

  const coerceMatch = superAdminJs.match(/function coerceReleaseBulletText\(raw\)\s*\{[\s\S]*?\n  \}/);
  const formatBodyMatch = superAdminJs.match(/function formatSectionedReleaseBody\([\s\S]*?\n  \}/);
  assert.ok(coerceMatch && formatBodyMatch, 'coerceReleaseBulletText and formatSectionedReleaseBody must exist in js/super-admin.js');
  const formatBodyFn = new Function(`${sharedCommitScope}; ${fluffMatch[0]}; ${coerceMatch[0]}; ${formatBodyMatch[0]}; return formatSectionedReleaseBody;`)();
  assert.match(edgeTs, /coerceReleaseBulletText/);
  assert.match(edgeTs, /coerceReleaseBulletList/);
  assert.match(edgeTs, /OBJECT_STR_RE/);
  const objectBulletBody = formatBodyFn({
    intro: 'Welcome to myIPON Update 1.1.',
    newFeatures: [
      {
        feature: 'Dark Mode Toggle',
        description: 'Added a theme switcher inside Settings.',
        impact: 'Reduces eye strain at night.'
      }
    ],
    fixes: ['• [object Object]', 'Calendar Icons: Restored scheduled icon spacing across mobile screens.'],
    outro: 'Thanks for saving with myIPON!'
  });
  assert.doesNotMatch(objectBulletBody, /\[object Object\]/);
  assert.match(objectBulletBody, /Dark Mode Toggle:\s*Added a theme switcher/);
  assert.match(objectBulletBody, /Calendar Icons:\s*Restored scheduled icon spacing/);
  const cleanedObjects = sanitizeFn('Fixes\n• [object Object]\n• Calendar Icons: Restored scheduled icon spacing across mobile screens.');
  assert.equal(cleanedObjects.bulletCount, 1);
  assert.equal(cleanedObjects.strippedCount, 1);
  assert.doesNotMatch(cleanedObjects.text, /\[object Object\]/);

  const cssLeakCommit = [
    'Standardize confirmation dialogs to warm-cream card with top gold accent and equal pill actions',
    '',
    '- Update .confirm-dialog in css/app.css (22px rounded #faf6ee card, 26px #b88c3e top accent rule, bold serif heading, equal 2-column button bar with #ffffff Cancel and #102420 forest-emerald primary button, plus dark-mode and <=720px responsive tuning)',
    '- Elevate .app-sidebar (z-index 190), .dashboard-sidebar (z-index 190), and fixed [data-messages-open]/[data-notifications-open] controls above workspace panels',
    '- Remove duplicated outer page headers on Super Admin Users, add 0 pending), and update verify 143/143 tests'
  ].join('\n');
  assert.deepEqual(extractFn(cssLeakCommit), []);

  const cssSanitized = sanitizeFn([
    'Improvements',
    '• .confirm-Dialog (22px Rounded #faf6ee: Updated .confirm-dialog (22px rounded #faf6ee card.',
    '• 26px #b88c3e Top Accent: Updated 26px #b88c3e top accent rule.',
    '• Equal 2-Column Button Bar: Updated equal 2-column button bar with #ffffff Cancel and #102420 forest-emerald primary button,.',
    '• Floating Chat & Notification Buttons: Kept floating chat and notification buttons visible above scrolling workspace panels.'
  ].join('\n'));
  assert.equal(cssSanitized.bulletCount, 1);
  assert.equal(cssSanitized.strippedCount, 3);
  assert.doesNotMatch(cssSanitized.text, /\.confirm-dialog|#faf6ee|#b88c3e|#ffffff|#102420|22px|26px|button bar|top accent rule|forest-emerald/i);
  assert.match(cssSanitized.text, /Floating Chat & Notification Buttons/);

  assert.deepEqual(
    extractFn('fix: expand budget workspace full-width and harden supabase:sync CLI parsing'),
    ['Expand budget workspace full-width']
  );

  assert.match(edgeTs, /gemini-2\.5-flash/);
  assert.match(edgeTs, /current_draft/);
  assert.match(edgeTs, /previous_title/);
  assert.match(edgeTs, /formatReleaseTitle/);
  assert.match(edgeTs, /maxOutputTokens:\s*8192/);
  assert.match(edgeTs, /security_updates/);
  assert.match(edgeTs, /other_changes/);
  assert.match(edgeTs, /findMissingReleaseItems/);
  assert.match(edgeTs, /no_new_changes/);
  assert.match(superAdminJs, /findMissingReleaseItems/);
  assert.match(superAdminJs, /release-update-change-notice/);
  assert.match(superAdminJs, /No new system changes yet/);
  assert.match(superAdminJs, /js\/release-commits\.json/);
  assert.match(read('super-admin.html'), /id="release-update-change-notice"/);
  assert.match(read('js/core.js'), /maxOutputTokens:\s*8192/);
  const releaseFeed = JSON.parse(read('js/release-commits.json'));
  assert.ok(Array.isArray(releaseFeed) && releaseFeed.length > 0, 'js/release-commits.json must be a non-empty array');
  assert.ok(typeof releaseFeed[0].date === 'string' && typeof releaseFeed[0].message === 'string', 'release-commits.json entries must have date and message');
  const feedCanonical = canonFn(releaseFeed.map((e) => e.message));
  assert.ok(feedCanonical.length >= 30, `Expected all 30+ recent release items without early truncation, got ${feedCanonical.length}`);
  assert.ok(!feedCanonical.some((item) => /^Maximum limits up to 999$|^Hero plates$|validateMoneyInput|NotificationSyncWorker|\bVAPID\b/i.test(item)), `Unexpected broken fragment in ${JSON.stringify(feedCanonical)}`);

  const genericTitleMatch = superAdminJs.match(/const GENERIC_RELEASE_TITLE_RE = (\/.*\/[a-z]*);/);
  const verPrefixMatch = superAdminJs.match(/function formatReleaseVersionPrefix\(ver\)\s*\{[\s\S]*?\n  \}/);
  const topicExtractMatch = superAdminJs.match(/function extractReleaseTopicLabels\(items = \[\]\)\s*\{[\s\S]*?\n  \}/);
  const titleFormatMatch = superAdminJs.match(/function formatReleaseTitle\(ver, candidateTitle = '', contentItems = \[\], variant = 0\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(genericTitleMatch && verPrefixMatch && topicExtractMatch && titleFormatMatch, 'release title helpers must exist in js/super-admin.js');
  const titleFn = new Function(`
    const TECH_COMMIT_RE = ${techMatch[1]};
    const CODE_TOKEN_RE = ${codeMatch[1]};
    const GENERIC_RELEASE_TITLE_RE = ${genericTitleMatch[1]};
    ${verPrefixMatch[0]}
    ${topicExtractMatch[0]}
    ${titleFormatMatch[0]}
    return formatReleaseTitle;
  `)();

  const bodyBullets = [
    '• Group Ownership & Deletion: Admins can now transfer group ownership cleanly.',
    '• Dark Mode Contrast: Improved arrows and icons across every calendar view.'
  ];
  const fromGeneric = titleFn('Update 1.1', 'myIPON Update 1.1 Feature Update', bodyBullets, 0);
  assert.ok(fromGeneric.startsWith('myIPON Update 1.1: '), `Expected prefix at start, got: ${fromGeneric}`);
  assert.doesNotMatch(fromGeneric, /Feature Update/i);
  assert.match(fromGeneric, /Group Ownership & Deletion/i);
  assert.match(fromGeneric, /Dark Mode Contrast/i);

  const fromAiReversed = titleFn('Update 1.2', 'Faster Savings & Clearer Group Transfers in myIPON Update 1.2', bodyBullets, 0);
  assert.equal(fromAiReversed, 'myIPON Update 1.2: Faster Savings & Clearer Group Transfers');
});

test('self-serve admin_create_group allows any non-super-admin active user without requiring prior admin role', () => {
  const migration052 = read('database/migrations/20261114_052_restore_self_serve_admin_create_group.sql');
  const schema = read('database/schema.sql');

  assert.match(migration052, /create or replace function public\.admin_create_group\(/i);
  assert.doesNotMatch(migration052, /if not public\.is_admin\(\) then[\s\S]*Only a group administrator can create a savings group/i);
  assert.match(migration052, /create or replace function public\.set_admin_contributor\(/i);
  assert.match(migration052, /20261114_052/);
  assert.match(schema, /mfa_access_allowed[\s\S]*Your account is deactivated or disabled/);
  assert.match(schema, /20261114_052/);
});

test('enforce_group_scope inspects old/new via jsonb and group creation starts without a pre-opened invite row', () => {
  const migration053 = read('database/migrations/20261114_053_fix_enforce_group_scope_old_record.sql');
  const schema = read('database/schema.sql');
  const dashboardJs = read('js/dashboard.js');

  assert.match(migration053, /to_jsonb\(old\)/i);
  assert.doesNotMatch(migration053, /old\.amount/i);
  assert.match(migration053, /20261114_053/);
  assert.doesNotMatch(schema, /old\.amount\s*=\s*new\.amount/i);
  assert.match(schema, /20261114_053/);

  assert.doesNotMatch(dashboardJs, /groupInviteRows\.replaceChildren\(\);\s*if \(isCreate\) appendInviteRow/);
  assert.match(dashboardJs, /rows\.length \? '\+ Add another' : '\+ Add member'/);
});

test('group admins can transfer ownership and leave or permanently delete a group with confirmation', () => {
  const migration054 = read('database/migrations/20261114_054_group_transfer_and_delete.sql');
  const schema = read('database/schema.sql');
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');

  assert.match(migration054, /create or replace function public\.admin_transfer_and_leave_group\(/i);
  assert.match(migration054, /create or replace function public\.admin_delete_group\(/i);
  assert.match(migration054, /delete from public\.contributions where group_id = v_actor_group/i);
  assert.match(migration054, /delete from public\.contribution_periods where group_id = v_actor_group/i);
  assert.match(migration054, /delete from public\.groups where id = v_actor_group/i);
  assert.match(migration054, /20261114_054/);
  assert.match(schema, /create or replace function public\.admin_transfer_and_leave_group\(/i);
  assert.match(schema, /create or replace function public\.admin_delete_group\(/i);
  assert.match(schema, /20261114_054/);

  assert.match(dashboardHtml, /id="group-hub-delete-btn"/);
  assert.match(dashboardHtml, /id="group-delete-dialog"/);
  assert.match(dashboardHtml, /value="transfer"/);
  assert.match(dashboardHtml, /value="delete"/);
  assert.match(dashboardHtml, /id="group-transfer-member"/);
  assert.match(dashboardHtml, /id="group-delete-confirm-name"/);

  assert.match(dashboardJs, /Ipon\.rpc\('admin_transfer_and_leave_group'/);
  assert.match(dashboardJs, /Ipon\.rpc\('admin_delete_group'/);
  assert.match(dashboardJs, /Transfer admin role & leave group\?/);
  assert.match(dashboardJs, /Permanently delete "/);

  const migration055 = read('database/migrations/20261114_055_fix_audit_logs_fk_on_group_delete.sql');
  assert.match(migration055, /not exists \(select 1 from public\.groups g where g\.id = v_group_id\)/i);
  assert.match(migration055, /group_id <> v_actor_group/i);
  assert.match(migration055, /20261114_055/);
  assert.match(schema, /not exists \(select 1 from public\.groups g where g\.id = v_group_id\)/i);
  assert.match(schema, /20261114_055/);
});

test('release announcements render and generate sectioned New Features, Fixes, Improvements, and Requested blocks', () => {
  const coreJs = read('js/core.js');
  const superAdminJs = read('js/super-admin.js');
  const edgeTs = read('supabase/functions/manage-account/index.ts');
  const css = read('css/app.css');

  assert.match(coreJs, /function renderAnnouncementDescriptionHtml\(/);
  assert.match(coreJs, /announcement-section-block/);
  assert.match(coreJs, /announcement-item-title/);
  assert.match(coreJs, /inferReleaseBulletKind/);

  assert.match(css, /\.announcement-section-block/);
  assert.match(css, /\.announcement-section-block\.is-fixes/);
  assert.match(css, /\.announcement-section-block\.is-improvements/);
  assert.match(css, /\.announcement-section-block\.is-security/);
  assert.match(css, /\.announcement-section-block\.is-other/);

  assert.match(superAdminJs, /function formatSectionedReleaseBody\(/);
  assert.match(superAdminJs, /pushSection\('New Features'/);
  assert.match(superAdminJs, /pushSection\('Fixes'/);
  assert.match(superAdminJs, /pushSection\('Improvements'/);
  assert.match(superAdminJs, /pushSection\('Security Updates'/);
  assert.match(superAdminJs, /pushSection\('Other Changes'/);

  assert.match(edgeTs, /function formatSectionedReleaseBody\(/);
  assert.match(edgeTs, /pushSection\('New Features'/);
  assert.match(edgeTs, /pushSection\('Fixes'/);
  assert.match(edgeTs, /pushSection\('Improvements'/);
  assert.match(edgeTs, /pushSection\('Security Updates'/);
  assert.match(edgeTs, /pushSection\('Other Changes'/);
});

test('payment method tagging and wallet reconciliation stay wired end to end', () => {
  const migration = read('database/migrations/20261114_056_payment_methods_and_wallet_reconciliation.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const recordsJs = read('js/records.js');
  const userJs = read('js/user.js');
  const dashboardJs = read('js/dashboard.js');
  const reportsJs = read('js/reports.js');
  const css = read('css/app.css');

  for (const sqlText of [migration, schema]) {
    assert.match(sqlText, /create or replace function public\.normalized_payment_method\(p_method text\)/i);
    assert.match(sqlText, /create or replace function public\.get_wallet_reconciliation\(\)/i);
    assert.match(sqlText, /p_payment_method text default null/i);
    assert.match(sqlText, /p_payment_method text default '__KEEP__'/i);
  }

  assert.match(core, /const PAYMENT_METHODS = Object\.freeze\(/);
  assert.match(core, /function normalizePaymentMethod\(/);
  assert.match(core, /function guessPaymentMethodFromLabel\(/);
  assert.match(core, /function paymentMethodBadge\(/);
  assert.match(core, /function mountPaymentMethodPickers\(/);
  assert.match(core, /function paymentMethodOptionsHtml\(/);

  for (const htmlFile of ['contributions.html', 'withdrawals.html', 'expenses.html']) {
    const html = read(htmlFile);
    assert.match(html, /data-pm-picker/);
    assert.match(html, /id="record-method-filter"/);
    assert.match(html, /<th>Method<\/th>/);
  }

  assert.match(read('user.html'), /data-pm-picker/);
  assert.match(read('user.html'), /<th>Method<\/th>/);
  assert.match(read('dashboard.html'), /id="dashboard-wallet-strip"/);
  assert.match(read('dashboard.html'), /id="quick-field-payment-method"/);
  assert.match(read('reports.html'), /id="wallet-reconciliation"/);
  assert.match(read('reports.html'), /id="wallet-reconciliation-body"/);

  assert.match(recordsJs, /paymentMethodBadge/);
  assert.match(recordsJs, /p_payment_method/);
  assert.match(userJs, /paymentMethodBadge/);
  assert.match(userJs, /p_payment_method/);
  assert.match(dashboardJs, /get_wallet_reconciliation/);
  assert.match(dashboardJs, /renderWalletStrip/);
  assert.match(reportsJs, /get_wallet_reconciliation/);
  assert.match(reportsJs, /renderWalletReconciliation/);

  assert.match(css, /\.pm-picker/);
  assert.match(css, /\.pm-badge/);
  assert.match(css, /\.dashboard-wallet-strip/);
  assert.match(css, /\.wallet-summary-cards/);
  assert.match(read('css/hero-plates.css'), /\.summary-card\s+\.dashboard-wallet-strip\s*\{[^}]*flex-wrap:nowrap;/);
});

test('member payout account info is integrated across database, profiles, members, deductions, and reports', () => {
  const migration = read('database/migrations/20261114_057_member_payout_accounts.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const accountJs = read('js/account.js');
  const membersJs = read('js/members.js');
  const recordsJs = read('js/records.js');
  const dashboardJs = read('js/dashboard.js');
  const reportsJs = read('js/reports.js');
  const userJs = read('js/user.js');
  const css = read('css/app.css');

  for (const sqlText of [migration, schema]) {
    assert.match(sqlText, /create or replace function public\.validated_payout_account\(/i);
    assert.match(sqlText, /p_payout_channel text default null/i);
    assert.match(sqlText, /p_payout_channel text default '__KEEP__'/i);
  }

  assert.match(core, /function payoutFieldsetMarkup\(/);
  assert.match(core, /function mountPayoutFieldsets\(/);
  assert.match(core, /function setPayoutFields\(/);
  assert.match(core, /function validatePayoutFields\(/);
  assert.match(core, /function readPayoutPayload\(/);
  assert.match(core, /function payoutSummaryChip\(/);
  assert.match(core, /function renderPayoutDestinationBox\(/);
  assert.match(core, /data-payout-fields data-prefix="quick"/);

  assert.match(read('account.html'), /data-payout-fields data-prefix="account"/);
  assert.match(read('members.html'), /data-payout-fields data-prefix="member"/);
  assert.match(read('members.html'), /<th>Payout account<\/th>/);
  assert.match(read('withdrawals.html'), /id="record-payout-destination"/);
  assert.match(read('dashboard.html'), /id="quick-payout-destination"/);
  assert.match(read('user.html'), /class="member-status-top"/);
  assert.match(read('user.html'), /class="member-status-heading"/);
  assert.match(read('user.html'), /id="user-payout-strip"/);
  assert.match(css, /\.member-status-top\s*\{/);
  assert.match(css, /\.user-payout-strip/);
  assert.match(css, /\.member-metrics #user-total\s*\{/);

  assert.match(accountJs, /setPayoutFields/);
  assert.match(accountJs, /readPayoutPayload/);
  assert.match(membersJs, /payoutSummaryChip/);
  assert.match(membersJs, /readPayoutPayload/);
  assert.match(recordsJs, /renderPayoutDestinationBox/);
  assert.match(dashboardJs, /renderPayoutDestinationBox/);
  assert.match(reportsJs, /payoutSummaryChip/);
  assert.match(userJs, /renderOwnPayoutStrip/);

  assert.match(css, /\.payout-fieldset/);
  assert.match(css, /\.payout-chip/);
  assert.match(css, /\.payout-dest-box/);
  assert.match(css, /\.user-payout-strip/);
});

test('in-record comments and review discussion thread are wired across database, review modal, records, and notifications', () => {
  const migration = read('database/migrations/20261114_058_record_comments.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const recordsJs = read('js/records.js');
  const userJs = read('js/user.js');
  const dashboardJs = read('js/dashboard.js');
  const css = read('css/app.css');

  for (const sql of [migration, schema]) {
    assert.match(sql, /create table if not exists public\.record_comments/i);
    assert.match(sql, /get_record_comments\(\s*p_record_type text,\s*p_record_id uuid\s*\)/i);
    assert.match(sql, /get_record_comment_counts\(\s*p_record_type text,\s*p_record_ids uuid\[\]\s*\)/i);
    assert.match(sql, /add_record_comment\(\s*p_record_type text,\s*p_record_id uuid,\s*p_body text\s*\)/i);
    assert.match(sql, /'RECORD_COMMENT'/);
  }

  assert.match(coreJs, /id="record-thread-dialog"/);
  assert.match(coreJs, /getRecordCommentCounts/);
  assert.match(coreJs, /recordDiscussionButtonHtml/);
  assert.match(coreJs, /openRecordDiscussion/);
  assert.match(coreJs, /\(\?:\\\?\[a-z0-9_=&:%\.-\]\+\)\?/);

  assert.match(recordsJs, /getRecordCommentCounts/);
  assert.match(recordsJs, /recordDiscussionButtonHtml/);
  assert.match(recordsJs, /openRequestedThreadFromUrl/);
  assert.match(recordsJs, /subscribeToChanges\([^)]*'record_comments'/);

  assert.match(userJs, /getRecordCommentCounts/);
  assert.match(userJs, /recordDiscussionButtonHtml/);
  assert.match(userJs, /openRequestedThreadFromUrl/);
  assert.match(userJs, /subscribeToChanges\([^)]*'record_comments'/);

  assert.match(dashboardJs, /id:\s*item\.id/);

  assert.match(css, /#record-thread-dialog/);
  assert.match(css, /\.record-thread-messages/);
  assert.match(css, /\.record-thread-msg\.is-own/);
  assert.match(css, /\.record-discuss-btn/);

  const dashHtml = read('dashboard.html');
  const heroCss = read('css/hero-plates.css');
  assert.match(dashHtml, /class="dashboard-wallet-pills"/);
  assert.doesNotMatch(dashHtml, /id="dashboard-month-progress-fill"|class="month-progress-track"/);
  assert.doesNotMatch(heroCss, /\.month-progress-track/);
  assert.match(heroCss, /\.summary-card \.admin-progress/);
});

test('reports script renders wallet reconciliation and member reports without runtime ReferenceError and keeps responsive wrapping', async () => {
  const reportsCss = read('css/app.css');
  assert.match(reportsCss, /\.report-panel \.table-filters\s*\{[^}]*flex-wrap:wrap/);
  assert.match(reportsCss, /@media \(max-width:1380px\)[\s\S]*?\.reports-grid\s*\{[^}]*grid-template-columns:1fr/);

  const reportsJs = read('js/reports.js');
  const elements = new Map();
  const makeEl = (id = '') => {
    const el = {
      id,
      value: '',
      innerHTML: '',
      textContent: '',
      hidden: false,
      dataset: {},
      options: [{ text: 'All statuses' }],
      selectedIndex: 0,
      attributes: new Map(),
      addEventListener() { },
      closest() { return makeEl('closest'); },
      setAttribute(k, v) { this.attributes.set(k, v); },
      getAttribute(k) { return this.attributes.get(k) ?? null; },
      querySelectorAll() { return []; },
      querySelector() { return null; }
    };
    return el;
  };
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };
  const queryChain = (data = []) => ({
    select() { return this; },
    eq() { return this; },
    is() { return this; },
    order() { return Promise.resolve({ data, error: null }); },
    then(cb) { return Promise.resolve({ data, error: null }).then(cb); }
  });
  const fakeWindow = {
    location: { href: 'http://localhost/reports.html', pathname: '/reports.html', search: '', hash: '' },
    addEventListener() { },
    Chart: null
  };
  const fakeIpon = {
    init: async () => ({ configured: true, failed: false, profile: { role: 'ADMIN', group_id: 'g1' } }),
    money: (v) => `₱${Number(v || 0).toFixed(2)}`,
    dateLabel: (v) => String(v || ''),
    monthStart: () => '2026-11-01',
    isoDate: () => '2026-11-14',
    escapeHtml: (v) => String(v ?? ''),
    paymentMethodMeta: (m) => ({ value: m || '', label: m || 'Untagged' }),
    paymentMethodBadge: (m) => `<span>${m || 'Untagged'}</span>`,
    payoutSummaryChip: () => '',
    MAX_MONEY_AMOUNT: 999999999999.99,
    guardMoneyInput() { },
    parseMoneyAmount: (raw) => {
      const s = String(raw ?? '').trim();
      if (!s) return { valid: true, value: null, error: '' };
      const n = Number(s);
      return Number.isFinite(n) && n >= 0 && n <= 999999999999.99
        ? { valid: true, value: Math.round(n * 100) / 100, error: '' }
        : { valid: false, value: null, error: 'Invalid' };
    },
    setLoading() { },
    showInlineError(_b, err) { throw err; },
    subscribeToChanges() { },
    client: {
      rpc: async (name) => name === 'get_wallet_reconciliation'
        ? {
          data: {
            tracked_savings: 100,
            physical_cash_balance: 100,
            digital_wallet_balance: 0,
            other_balance: 0,
            untagged_balance: 0,
            channels: [{ method: 'CASH', additions: 100, deductions: 0, expenses: 0, net_balance: 100, entry_count: 1 }]
          },
          error: null
        }
        : { data: { total_additions: 100, total_deductions: 0, total_expenses: 0, tracked_savings: 100 }, error: null },
      from: (table) => table === 'v_contribution_status'
        ? queryChain([{ member_id: 'm1', member_name: 'Tester', required_amount: 100, paid_amount: 0, outstanding_amount: 100, payment_status: 'UNPAID' }])
        : table === 'members'
          ? queryChain([{ id: 'm1', payout_channel: null }])
          : queryChain([{ month: '2026-11-01', total_additions: 100, total_deductions: 0, total_expenses: 0, net_change: 100 }])
    }
  };
  const context = {
    window: fakeWindow,
    Ipon: fakeIpon,
    document: { getElementById: getEl, createElement: () => makeEl('created'), body: makeEl('body') },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    URL: { createObjectURL: () => '', revokeObjectURL() { } },
    Blob: class { },
    Promise, Map, Set, Number, String, Array, Math, Date, JSON, Boolean, setTimeout
  };
  await vm.runInNewContext(reportsJs, context, { filename: 'js/reports.js' });
  await new Promise((r) => setTimeout(r, 20));
  assert.match(getEl('wallet-reconciliation-body').innerHTML, /wallet-total-row/);
  assert.match(getEl('wallet-reconciliation-body').innerHTML, /₱100\.00/);
  assert.match(getEl('member-report-body').innerHTML, /Tester/);
});

test('category dropdowns with custom input and peso amount prefixes are wired cleanly across forms', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  const dashboardJs = read('js/dashboard.js');
  const recordsJs = read('js/records.js');

  assert.match(core, /const PESO_INPUT_SELECTOR = \[/);
  assert.match(core, /function preparePesoInputs\(/);
  assert.match(core, /const CATEGORY_PRESETS = Object\.freeze\(/);
  assert.match(core, /function mountCategoryControls\(/);
  assert.match(core, /function syncCategoryControl\(/);
  assert.match(core, /function setCategoryPresetGroup\(/);

  assert.match(read('withdrawals.html'), /data-category-presets="deduction"/);
  assert.match(read('withdrawals.html'), /Paid from wallet/);
  assert.match(read('expenses.html'), /data-category-presets="expense"/);
  assert.match(read('expenses.html'), /Paid from wallet/);
  assert.match(read('dashboard.html'), /id="quick-category"[^>]*data-category-presets="deduction"/);

  assert.match(dashboardJs, /Ipon\.preparePesoInputs\(row\)/);
  assert.match(dashboardJs, /Ipon\.setCategoryPresetGroup\(quickCategoryInput,/);
  assert.match(dashboardJs, /Ipon\.syncCategoryControl\(quickCategoryInput,\s*''\)/);
  assert.match(recordsJs, /data-category-presets="/);
  assert.match(recordsJs, /Ipon\.syncCategoryControl\(editForm\.elements\.category/);

  assert.match(css, /\.peso-input-wrap\s*\{/);
  assert.match(css, /\.peso-prefix\s*\{/);
  assert.match(css, /\.category-control\s*\{/);
});

test('core script initializes without TDZ ReferenceError and mounts peso inputs plus category dropdowns', () => {
  const core = read('js/core.js');
  class FakeEl {
    constructor(tag = 'div', attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.attributes = new Map();
      this.parentNode = null;
      this.type = attrs.type || '';
      this.name = attrs.name || '';
      this.id = attrs.id || '';
      this.value = attrs.value || '';
      this.required = Boolean(attrs.required);
      this.hidden = Boolean(attrs.hidden);
      if (attrs['data-category-presets']) this.dataset.categoryPresets = attrs['data-category-presets'];
      this.classList = {
        set: new Set((attrs.class || '').split(/\s+/).filter(Boolean)),
        add: (...c) => c.forEach((x) => this.classList.set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList.set.delete(x)),
        toggle: (x, f) => (f ? this.classList.set.add(x) : this.classList.set.delete(x)),
        contains: (x) => this.classList.set.has(x)
      };
    }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classList.set].join(' '); }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    removeAttribute(k) { this.attributes.delete(k); }
    toggleAttribute(k, f) { if (f === false) this.attributes.delete(k); else this.attributes.set(k, ''); }
    addEventListener() { }
    setCustomValidity() { }
    checkValidity() { return true; }
    focus() { }
    closest(sel) {
      let cur = this;
      const cls = sel.startsWith('.') ? sel.slice(1) : '';
      while (cur) {
        if (cls && cur.classList?.contains(cls)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }
    insertBefore(node, ref) {
      const idx = this.children.indexOf(ref);
      node.parentNode = this;
      if (idx >= 0) this.children.splice(idx, 0, node); else this.children.push(node);
    }
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; }
    append(...nodes) { nodes.forEach((n) => typeof n === 'object' && this.appendChild(n)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.children || []) {
          if (sel.includes('data-category-presets') && c.tagName === 'INPUT' && c.dataset?.categoryPresets) out.push(c);
          else if (sel.includes('input[type="number"]') && c.tagName === 'INPUT' && c.type === 'number') out.push(c);
          else if (sel === '.category-preset-select' && c.classList?.contains('category-preset-select')) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    insertAdjacentHTML() { }
  }
  class FakeInput extends FakeEl { }
  const body = new FakeEl('body');
  body.dataset = { page: 'dashboard' };
  const loader = new FakeEl('div', { id: 'app-loader' });
  const amountField = new FakeEl('div', { class: 'field' });
  const amountInput = new FakeInput('input', { type: 'number', name: 'amount', id: 'quick-amount' });
  amountField.appendChild(amountInput);
  const categoryField = new FakeEl('div', { class: 'field' });
  const categoryInput = new FakeInput('input', { type: 'text', name: 'category', id: 'quick-category', 'data-category-presets': 'deduction', required: true });
  categoryField.appendChild(categoryInput);
  body.appendChild(amountField);
  body.appendChild(categoryField);

  const doc = {
    documentElement: new FakeEl('html'),
    body,
    head: new FakeEl('head'),
    getElementById: (id) => (id === 'quick-amount' ? amountInput : id === 'quick-category' ? categoryInput : id === 'app-loader' ? loader : null),
    querySelector: (s) => body.querySelector(s),
    querySelectorAll: (s) => body.querySelectorAll(s),
    createElement: (t) => (t === 'input' ? new FakeInput(t) : new FakeEl(t)),
    addEventListener() { },
    readyState: 'complete'
  };
  const ctx = {
    window: null,
    document: doc,
    HTMLInputElement: FakeInput,
    HTMLFormElement: FakeEl,
    HTMLElement: FakeEl,
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/dashboard.html', pathname: '/dashboard.html', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0,
    clearTimeout() { },
    setInterval: () => 0,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });
  assert.equal(amountInput.parentNode.className, 'peso-input-wrap');
  assert.equal(categoryInput.parentNode.className, 'category-control');
  ctx.window.Ipon.setCategoryPresetGroup(categoryInput, 'expense', { required: true });
  ctx.window.Ipon.syncCategoryControl(categoryInput, 'Custom team lunch');
  assert.equal(categoryInput.hidden, false);
  assert.equal(categoryInput.value, 'Custom team lunch');
  assert.equal(categoryInput.parentNode.querySelector('.category-preset-select').value, '__CUSTOM__');
});

test('requestRecordAction completes VOID review confirmation flow in VM without ReferenceError', async () => {
  const core = read('js/core.js');
  const ids = new Map();
  const makeNode = (id, extra = {}) => {
    const node = {
      id,
      hidden: false,
      disabled: false,
      required: false,
      value: '',
      textContent: '',
      innerHTML: '',
      className: '',
      dataset: {},
      style: {},
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      setAttribute() { },
      removeAttribute() { },
      addEventListener() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      after() { },
      before() { },
      focus() { },
      ...extra
    };
    if (id) ids.set(id, node);
    return node;
  };
  const dialog = makeNode('record-action-dialog', { returnValue: '', showModal() { }, close(v) { this.returnValue = v; } });
  const decisionRadio = { value: 'VOID' };
  const form = makeNode('record-action-form', { reportValidity: () => true, elements: { decision: decisionRadio } });
  const editStep = makeNode('record-action-step-edit');
  const confirmStep = makeNode('record-action-step-confirm', { hidden: true });
  makeNode('record-action-title');
  makeNode('record-action-summary');
  makeNode('record-action-options');
  makeNode('record-action-reason-label');
  makeNode('record-action-help');
  const reason = makeNode('record-action-reason');
  const nextButton = makeNode('record-action-next');
  makeNode('record-action-back');
  const submitButton = makeNode('record-action-submit');
  const confirmBox = makeNode('record-action-confirm-box');
  makeNode('record-action-confirm-heading');
  const confirmText = makeNode('record-action-confirm-text');
  const confirmNote = makeNode('record-action-confirm-note');
  makeNode('record-action-error');
  makeNode('app-loader');
  const body = { dataset: { page: 'contributions' }, classList: { add() { }, remove() { }, toggle() { }, contains: () => false }, querySelectorAll: () => [], insertAdjacentHTML() { }, appendChild() { }, addEventListener() { } };
  const ctx = {
    window: null,
    document: {
      documentElement: { dataset: {} },
      body,
      head: { appendChild() { }, insertAdjacentHTML() { } },
      getElementById: (id) => ids.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => makeNode(''),
      addEventListener() { },
      readyState: 'complete'
    },
    HTMLInputElement: class { },
    HTMLFormElement: class { },
    HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/contributions.html', pathname: '/contributions.html', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  let submittedPayload = null;
  const promise = ctx.window.Ipon.requestRecordAction({
    title: 'Void record',
    actions: ['VOID'],
    entry: { id: 'c1', type: 'contribution', authorName: 'Juan Dela Cruz', amount: 300, status: 'CONFIRMED' },
    onSubmit: async (payload) => { submittedPayload = payload; }
  });
  reason.value = 'Re-tagging payment method';
  form.onsubmit({ preventDefault() { } });
  assert.equal(editStep.hidden, true);
  assert.equal(confirmStep.hidden, false);
  assert.equal(confirmBox.dataset.tone, 'danger');
  assert.match(confirmText.textContent, /300\.00 \(Savings Addition\) for Juan Dela Cruz/);
  assert.equal(confirmNote.textContent, 'Note: "Re-tagging payment method"');
  assert.equal(nextButton.disabled, false);

  await submitButton.onclick();
  const res = await promise;
  assert.equal(res?.decision, 'VOID');
  assert.equal(res?.note, 'Re-tagging payment method');
  assert.equal(submittedPayload?.decision, 'VOID');
  assert.equal(submittedPayload?.note, 'Re-tagging payment method');
});

test('calendar view and dashboard show payment methods in hover/click details and render side-by-side status icons per day', () => {
  const schema = read('database/schema.sql');
  const migration = read('database/migrations/20261114_059_calendar_payment_method.sql');
  const core = read('js/core.js');
  const dashboard = read('js/dashboard.js');
  const appCss = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  for (const sql of [schema, migration]) {
    assert.match(sql, /create or replace view public\.v_savings_calendar[\s\S]*?c\.payment_method[\s\S]*?w\.payment_method[\s\S]*?e\.payment_method/);
  }
  assert.match(core, /paymentMethodIconHtml,/);
  assert.match(dashboard, /function dayEventStatuses\(/);
  assert.match(dashboard, /<span class="day-events">/);
  assert.doesNotMatch(dashboard, /dayPaymentMethodsHtml/);
  assert.match(dashboard, /paymentMethods:\s*new Set\(\)/);
  assert.match(dashboard, /<div class="day-detail-badges">/);
  assert.match(dashboard, /<div class="day-contributor-badges">/);
  assert.match(appCss, /\.day-detail-list article > span\s*\{/);
  assert.match(heroCss, /\.day \.day-events\s*\{/);
});

test('record discussion dialog layout CSS is single-sourced, responsive, and openRecordDiscussion renders replies cleanly', async () => {
  const appCss = read('css/app.css');
  assert.equal((appCss.match(/In-Record Comments & Review Discussion Thread/g) || []).length, 1);
  assert.match(appCss, /\.record-thread-dialog\s*\{\s*width:\s*min\(640px,/);
  assert.match(appCss, /\.record-thread-dialog \.form-dialog-sheet\s*\{[\s\S]*?width:\s*100%;/);
  assert.match(appCss, /\.record-thread-body\s*\{[\s\S]*?padding:\s*16px 22px 20px;/);
  assert.match(appCss, /\.record-thread-messages\s*\{[\s\S]*?height:\s*clamp\(/);
  assert.match(appCss, /\.record-thread-msg\s*\{[\s\S]*?flex-shrink:\s*0;/);
  assert.match(appCss, /\.record-thread-empty\s*\{[\s\S]*?flex-direction:\s*column;/);
  assert.match(appCss, /\.record-thread-dialog form\.record-thread-composer\s*\{\s*padding:\s*0;/);
  assert.match(appCss, /@media \(max-width:\s*640px\)\s*\{[\s\S]*?\.record-thread-dialog\s*\{[\s\S]*?width:\s*calc\(100vw - 16px\);/);

  const core = read('js/core.js');
  const makeNode = (id) => ({
    id,
    hidden: false,
    disabled: false,
    dataset: {},
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    innerHTML: '',
    value: '',
    textContent: '',
    scrollTop: 0,
    scrollHeight: 120,
    listeners: new Map(),
    setAttribute() { },
    getAttribute: () => '',
    removeAttribute() { },
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeEventListener(type) { this.listeners.delete(type); },
    querySelector(sel) { return sel === '[type="submit"]' ? submitBtn : null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    reset() { input.value = ''; },
    focus() { },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.get('close')?.(); },
    requestSubmit() { this.onsubmit?.({ preventDefault() { } }); }
  });
  const submitBtn = makeNode('submit');
  const dialog = makeNode('record-thread-dialog');
  const summaryBox = makeNode('record-thread-summary');
  const messagesEl = makeNode('record-thread-messages');
  const form = makeNode('record-thread-form');
  const input = makeNode('record-thread-input');
  const readonlyEl = makeNode('record-thread-readonly');
  const titleEl = makeNode('record-thread-title');
  const subtitleEl = makeNode('record-thread-subtitle');
  const els = {
    'app-loader': makeNode('app-loader'),
    'record-thread-dialog': dialog,
    'record-thread-summary': summaryBox,
    'record-thread-messages': messagesEl,
    'record-thread-form': form,
    'record-thread-input': input,
    'record-thread-readonly': readonlyEl,
    'record-thread-title': titleEl,
    'record-thread-subtitle': subtitleEl
  };

  let rpcCalls = [];
  const doc = {
    body: {
      dataset: { page: 'contributions' },
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      querySelectorAll: () => [],
      insertAdjacentHTML() { },
      appendChild() { },
      addEventListener() { }
    },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    documentElement: { dataset: {} },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => els[id] || null,
    createElement: () => makeNode('tmp'),
    addEventListener: () => { }
  };
  const ctx = {
    window: null,
    document: doc,
    HTMLInputElement: class { },
    HTMLFormElement: class { },
    HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/contributions.html', pathname: '/contributions.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    supabase: {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => { }
        },
        rpc: async (fn, args) => {
          rpcCalls.push([fn, args]);
          if (fn === 'get_record_comments') {
            return {
              data: {
                record: { id: 'r1', type: 'contribution', author_name: 'Zedrick', amount: 100, status: 'CONFIRMED' },
                comments: [],
                can_reply: true
              },
              error: null
            };
          }
          if (fn === 'add_record_comment') {
            return {
              data: { id: 'm1', author_id: 'u1', author_name: 'Zedrick', author_role: 'ADMIN', body: args.p_body, created_at: '2026-11-14T09:00:00Z' },
              error: null
            };
          }
          return { data: null, error: null };
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: async () => { }
      })
    },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  await ctx.window.Ipon.openRecordDiscussion('contribution', 'r1');
  assert.equal(titleEl.textContent, 'Savings Addition discussion');
  assert.match(messagesEl.innerHTML, /class="record-thread-empty"/);
  assert.equal(form.hidden, false);
  assert.equal(readonlyEl.hidden, true);

  input.value = 'Checked GCash receipt';
  await form.onsubmit({ preventDefault() { } });
  assert.match(messagesEl.innerHTML, /Checked GCash receipt/);
  assert.equal(input.value, '');
  assert.ok(rpcCalls.some(([fn]) => fn === 'add_record_comment'));
  dialog.close();
});

test('discussion DP circle styling and replaceable phone/panel record-comment notifications are wired end to end', async () => {
  const appCss = read('css/app.css');
  const coreJs = read('js/core.js');
  const migration060 = read('database/migrations/20261114_060_record_comment_notifications.sql');
  const schema = read('database/schema.sql');
  const pollJava = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const mainJava = read('android/app/src/main/java/com/myipon/app/MainActivity.java');

  assert.match(appCss, /\.avatar-circle\.avatar-sm\s*\{\s*width:\s*30px;\s*height:\s*30px;/);
  assert.match(appCss, /\.record-thread-msg-avatar\s*\{\s*flex-shrink:\s*0;\s*line-height:\s*0;\s*\}/);
  assert.match(appCss, /\.record-thread-msg-avatar \.avatar-circle\s*\{[\s\S]*?width:\s*30px;\s*height:\s*30px;/);

  for (const sql of [migration060, schema]) {
    assert.match(sql, /v_dedupe_key := 'RECORD_COMMENT:' \|\| v_type \|\| ':' \|\| p_record_id::text;/);
    assert.match(sql, /delete from public\.notifications n[\s\S]*?n\.type = 'RECORD_COMMENT'[\s\S]*?insert into public\.notifications/i);
    assert.match(sql, /create or replace function public\.get_unread_notifications_by_token\(p_token uuid\)[\s\S]*?dedupe_key text/i);
  }
  assert.match(pollJava, /String dedupeKey = row\.optString\("dedupe_key", ""\);/);
  assert.match(mainJava, /\\\.html\(\?:\\\\\?/);
  assert.match(mainJava, /\[a-zA-Z0-9_=&:%\.-]\+/);
  assert.match(coreJs, /function notifShownKey\(item\)/);
  assert.match(coreJs, /function safeNotificationTarget\(link\)/);
  assert.match(coreJs, /\^\[a-z0-9_-\]\+\\\.html\(\?:\\\?\[a-z0-9_=&:%\.-\]\+\)\?/);
  assert.match(coreJs, /normalizeRolePageTarget\(event\?\.notification\?\.extra\?\.link\)/);
});

test('record discussion supports photo, video, and document attachments with signed upload/view URLs', async () => {
  const migration061 = read('database/migrations/20261114_061_record_comment_attachments.sql');
  const schema = read('database/schema.sql');
  const edgeFn = read('supabase/functions/manage-account/index.ts');
  const appCss = read('css/app.css');
  const coreJs = read('js/core.js');

  for (const sql of [migration061, schema]) {
    assert.match(sql, /attachments\s+jsonb\s+not null\s+default '\[\]'::jsonb/i);
    assert.match(sql, /add_record_comment\(\s*p_record_type text,\s*p_record_id uuid,\s*p_body text default '',\s*p_attachments jsonb default '\[\]'::jsonb\s*\)/i);
    assert.match(sql, /'attachments',\s*coalesce\(rc\.attachments,\s*'\[\]'::jsonb\)/i);
  }

  assert.match(edgeFn, /const RECORD_COMMENTS_BUCKET = 'record-comments';/);
  assert.match(edgeFn, /action === 'record-comment-upload-urls'/);
  assert.match(edgeFn, /action === 'record-comment-view-urls'/);
  assert.match(edgeFn, /action === 'record-comment-cleanup-media'/);
  assert.match(edgeFn, /BLOCKED_DISCUSSION_EXT_RE/);

  assert.match(appCss, /\.record-thread-attach-btn\b/);
  assert.match(appCss, /\.record-thread-queued\b/);
  assert.match(appCss, /\.record-thread-att-photo\b/);
  assert.match(appCss, /\.record-thread-att-video\b/);
  assert.match(appCss, /\.record-thread-att-file\b/);
  assert.match(coreJs, /const isSafeUrl = raw\.startsWith\('data:image\/'\) \|\| raw\.startsWith\('blob:'\) \|\| \/\^https\?:\\\/\\\/\/i\.test\(raw\);/);

  const core = coreJs;
  const makeNode = (id = '') => ({
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    files: [],
    dataset: {},
    style: {},
    scrollHeight: 120,
    scrollTop: 0,
    listeners: new Map(),
    setAttribute() { },
    getAttribute: () => '',
    removeAttribute() { },
    classList: {
      set: new Set(),
      add(...c) { c.forEach((x) => this.set.add(x)); },
      remove(...c) { c.forEach((x) => this.set.delete(x)); },
      toggle(c, f) { if (f === undefined) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); } else if (f) { this.set.add(c); } else { this.set.delete(c); } },
      contains(c) { return this.set.has(c); }
    },
    focus() { },
    click() { },
    reset() { input.value = ''; },
    showModal() { this.open = true; },
    close() { this.open = false; if (typeof this.onclose === 'function') this.onclose(); this.listeners.get('close')?.(); },
    closest: () => null,
    addEventListener(evt, fn) { this[`on${evt}`] = fn; this.listeners.set(evt, fn); },
    removeEventListener(evt) { this[`on${evt}`] = null; this.listeners.delete(evt); },
    querySelector: () => null,
    querySelectorAll: () => []
  });

  const dialog = makeNode('record-thread-dialog');
  const form = makeNode('record-thread-form');
  const input = makeNode('record-thread-input');
  const filesInput = makeNode('record-thread-files');
  const attachBtn = makeNode('record-thread-attach-btn');
  const queuedEl = makeNode('record-thread-queued');
  const messagesEl = makeNode('record-thread-messages');
  const sendBtn = makeNode('record-thread-send');
  const readonlyEl = makeNode('record-thread-readonly');
  const summaryEl = makeNode('record-thread-summary');
  const closeBtn = makeNode('record-thread-close');
  const titleEl = makeNode('record-thread-title');
  const subtitleEl = makeNode('record-thread-subtitle');
  const els = {
    'app-loader': makeNode('app-loader'),
    'record-thread-dialog': dialog,
    'record-thread-form': form,
    'record-thread-input': input,
    'record-thread-files': filesInput,
    'record-thread-attach-btn': attachBtn,
    'record-thread-queued': queuedEl,
    'record-thread-messages': messagesEl,
    'record-thread-send': sendBtn,
    'record-thread-readonly': readonlyEl,
    'record-thread-summary': summaryEl,
    'record-thread-close': closeBtn,
    'record-thread-title': titleEl,
    'record-thread-subtitle': subtitleEl
  };
  form.querySelector = () => sendBtn;

  let rpcCalls = [];
  let fnActions = [];
  let uploadedPayloads = [];
  let revokedUrls = [];
  const storageBucket = 'record-comments';

  const FakeURL = class extends URL { };
  FakeURL.createObjectURL = (f) => `blob:mock/${f.name}`;
  FakeURL.revokeObjectURL = (u) => revokedUrls.push(u);

  const doc = {
    body: {
      dataset: { page: 'contributions' },
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      querySelectorAll: () => [],
      insertAdjacentHTML() { },
      appendChild() { },
      addEventListener() { }
    },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    documentElement: { dataset: {} },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => els[id] || null,
    createElement: () => makeNode('tmp'),
    addEventListener: () => { }
  };

  const ctx = {
    window: null,
    document: doc,
    HTMLInputElement: class { },
    HTMLFormElement: class { },
    HTMLElement: class { },
    Blob,
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/contributions.html', pathname: '/contributions.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    fetch: async (url, init) => {
      if (String(url).includes('/functions/v1/manage-account')) {
        const body = JSON.parse(init.body || '{}');
        fnActions.push(body);
        if (body.action === 'record-comment-upload-urls') {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              ok: true,
              uploads: (body.files || []).map((f, idx) => ({
                path: `contribution/r1/att-${idx}-${f.name}`,
                token: `tok-${idx}`,
                signedUrl: `https://storage.example/upload/${idx}`
              }))
            })
          };
        }
        if (body.action === 'record-comment-view-urls') {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              ok: true,
              urls: {
                'contribution/r1/att-0-receipt.png': 'https://storage.example/view/receipt.png',
                'contribution/r1/att-1-clip.mp4': 'https://storage.example/view/clip.mp4',
                'contribution/r1/att-2-proof.pdf': 'https://storage.example/view/proof.pdf'
              }
            })
          };
        }
      }
      if (String(url).includes('storage.example/upload/')) {
        uploadedPayloads.push({ file: init.body, contentType: init.headers?.['Content-Type'] });
      }
      return { ok: true, status: 200, text: async () => '{}' };
    },
    supabase: {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { access_token: 'jwt-1' } } }),
          onAuthStateChange: () => { }
        },
        functions: {
          invoke: async (name, { body } = {}) => {
            assert.equal(name, 'manage-account');
            fnActions.push(body);
            if (body?.action === 'record-comment-upload-urls') {
              return {
                data: {
                  ok: true,
                  uploads: (body.files || []).map((f, idx) => ({
                    path: `contribution/r1/att-${idx}-${f.name}`,
                    token: `tok-${idx}`,
                    signedUrl: `https://storage.example/upload/${idx}`,
                    name: f.name,
                    type: f.type,
                    kind: f.kind,
                    size: f.size
                  }))
                },
                error: null
              };
            }
            if (body?.action === 'record-comment-view-urls') {
              return {
                data: {
                  ok: true,
                  urls: {
                    'contribution/r1/att-0-receipt.png': 'https://storage.example/view/receipt.png',
                    'contribution/r1/att-1-clip.mp4': 'https://storage.example/view/clip.mp4',
                    'contribution/r1/att-2-proof.pdf': 'https://storage.example/view/proof.pdf'
                  }
                },
                error: null
              };
            }
            return { data: { ok: true }, error: null };
          }
        },
        storage: {
          from: (bucket) => {
            assert.equal(bucket, storageBucket);
            return {
              uploadToSignedUrl: async (path, token, file) => {
                uploadedPayloads.push({ path, token, file });
                return { data: { path }, error: null };
              }
            };
          }
        },
        rpc: async (fn, args) => {
          rpcCalls.push([fn, args]);
          if (fn === 'get_record_comments') {
            return {
              data: {
                record: { id: 'r1', type: 'contribution', author_name: 'Zedrick', amount: 100, status: 'CONFIRMED' },
                comments: [],
                can_reply: true
              },
              error: null
            };
          }
          if (fn === 'add_record_comment') {
            return {
              data: {
                id: 'm1',
                author_id: 'u1',
                author_name: 'Zedrick',
                author_role: 'ADMIN',
                body: args.p_body,
                attachments: args.p_attachments,
                created_at: '2026-11-14T09:00:00Z'
              },
              error: null
            };
          }
          return { data: null, error: null };
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: async () => { }
      })
    },
    Intl, URL: FakeURL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  await ctx.window.Ipon.openRecordDiscussion('contribution', 'r1');

  const photoFile = { name: 'receipt.png', type: 'image/png', size: 2048 };
  const videoFile = { name: 'clip.mp4', type: 'video/mp4', size: 4096 };
  const docFile = { name: 'proof.pdf', type: 'application/pdf', size: 1024 };
  const dangerousFile = { name: 'payload.exe', type: 'application/x-msdownload', size: 512 };

  filesInput.files = [photoFile, videoFile, docFile, dangerousFile];
  await filesInput.listeners.get('change')?.({ target: filesInput });
  assert.match(queuedEl.innerHTML, /receipt\.png/);
  assert.match(queuedEl.innerHTML, /clip\.mp4/);
  assert.match(queuedEl.innerHTML, /proof\.pdf/);
  assert.doesNotMatch(queuedEl.innerHTML, /payload\.exe/);

  input.value = '';
  await form.onsubmit({ preventDefault() { } });

  assert.equal(uploadedPayloads.length, 3);
  assert.equal(uploadedPayloads[0].file, photoFile);
  assert.equal(uploadedPayloads[1].file, videoFile);
  assert.equal(uploadedPayloads[2].file, docFile);
  const addCall = rpcCalls.find(([fn]) => fn === 'add_record_comment');
  assert.ok(addCall);
  assert.equal(addCall[1].p_attachments.length, 3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(messagesEl.innerHTML, /class="record-thread-att-photo"/);
  assert.match(messagesEl.innerHTML, /<video controls playsinline preload="metadata"/);
  assert.match(messagesEl.innerHTML, /class="record-thread-att-file"/);

  dialog.close();
  assert.ok(revokedUrls.length >= 2);
});

test('discussion unread count pill disappears once messages are opened and read', async () => {
  const migration062 = read('database/migrations/20261114_062_record_comment_read_state.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');

  for (const sql of [migration062, schema]) {
    assert.match(sql, /create table if not exists public\.record_comment_reads/i);
    assert.match(sql, /unread_count bigint/i);
    assert.match(sql, /where rc\.author_id <> auth\.uid\(\)[\s\S]*?rc\.created_at > coalesce\(rcr\.last_read_at/i);
    assert.match(sql, /insert into public\.record_comment_reads \(user_id, record_type, record_id, last_read_at\)/i);
  }

  const makeNode = (id = '') => ({
    id,
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    disabled: false,
    dataset: {},
    style: {},
    scrollHeight: 120,
    scrollTop: 0,
    listeners: new Map(),
    setAttribute() { },
    getAttribute: () => '',
    removeAttribute() { },
    classList: {
      set: new Set(['has-comments']),
      add(...c) { c.forEach((x) => this.set.add(x)); },
      remove(...c) { c.forEach((x) => this.set.delete(x)); },
      toggle(c, f) { if (f === undefined) { this.set.has(c) ? this.set.delete(c) : this.set.add(c); } else if (f) { this.set.add(c); } else { this.set.delete(c); } },
      contains(c) { return this.set.has(c); }
    },
    focus() { },
    click() { },
    reset() { },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.get('close')?.(); },
    closest: () => null,
    addEventListener(evt, fn) { this[`on${evt}`] = fn; this.listeners.set(evt, fn); },
    removeEventListener(evt) { this[`on${evt}`] = null; this.listeners.delete(evt); },
    querySelector: () => null,
    querySelectorAll: () => []
  });

  const discussBtn = makeNode('table-discuss-btn');
  discussBtn.textContent = 'Discuss 4';
  const reviewBtn = makeNode('record-review-discuss-btn');
  reviewBtn.dataset.recordId = 'r1';
  reviewBtn.textContent = 'Discussion 4';

  const dialog = makeNode('record-thread-dialog');
  const form = makeNode('record-thread-form');
  const input = makeNode('record-thread-input');
  const messagesEl = makeNode('record-thread-messages');
  const readonlyEl = makeNode('record-thread-readonly');
  const summaryEl = makeNode('record-thread-summary');
  const titleEl = makeNode('record-thread-title');
  const subtitleEl = makeNode('record-thread-subtitle');

  const els = {
    'app-loader': makeNode('app-loader'),
    'record-thread-dialog': dialog,
    'record-thread-form': form,
    'record-thread-input': input,
    'record-thread-messages': messagesEl,
    'record-thread-readonly': readonlyEl,
    'record-thread-summary': summaryEl,
    'record-thread-title': titleEl,
    'record-thread-subtitle': subtitleEl,
    'record-review-discuss-btn': reviewBtn
  };

  let isRead = false;
  let updatedCalls = 0;
  const doc = {
    body: {
      dataset: { page: 'contributions' },
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      querySelectorAll: () => [],
      insertAdjacentHTML() { },
      appendChild() { },
      addEventListener() { }
    },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    documentElement: { dataset: {} },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-action="discuss"][data-id="r1"]' ? [discussBtn] : []),
    getElementById: (id) => els[id] || null,
    createElement: () => makeNode('tmp'),
    addEventListener: () => { }
  };

  const ctx = {
    window: null,
    document: doc,
    HTMLInputElement: class { },
    HTMLFormElement: class { },
    HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/contributions.html', pathname: '/contributions.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    supabase: {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => { }
        },
        rpc: async (fn) => {
          if (fn === 'get_record_comment_counts') {
            return { data: [{ record_id: 'r1', comment_count: 4, unread_count: isRead ? 0 : 4 }], error: null };
          }
          if (fn === 'get_record_comments') {
            isRead = true;
            return {
              data: {
                record: { id: 'r1', type: 'contribution', author_name: 'Zedrick', amount: 100, status: 'CONFIRMED' },
                comments: [{ id: 'm1', author_id: 'u2', author_name: 'Other', author_role: 'MEMBER', body: 'Sent!', created_at: '2026-11-14T09:00:00Z' }],
                can_reply: true
              },
              error: null
            };
          }
          return { data: null, error: null };
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: async () => { }
      })
    },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  const beforeCounts = await ctx.window.Ipon.getRecordCommentCounts('contribution', ['r1']);
  const beforeHtml = ctx.window.Ipon.recordDiscussionButtonHtml({ id: 'r1', approval_status: 'CONFIRMED' }, beforeCounts.get('r1'));
  assert.match(beforeHtml, /class="icon-action record-discuss-btn has-comments"/);
  assert.match(beforeHtml, /<span class="comment-count-pill">4<\/span>/);

  await ctx.window.Ipon.openRecordDiscussion('contribution', 'r1', { onUpdated: () => { updatedCalls += 1; } });

  assert.equal(discussBtn.classList.contains('has-comments'), false);
  assert.equal(discussBtn.textContent, 'Discuss');
  assert.equal(reviewBtn.classList.contains('has-comments'), false);
  assert.equal(reviewBtn.textContent, 'Discussion');

  dialog.close();
  assert.equal(updatedCalls, 1);

  const afterCounts = await ctx.window.Ipon.getRecordCommentCounts('contribution', ['r1']);
  const afterHtml = ctx.window.Ipon.recordDiscussionButtonHtml({ id: 'r1', approval_status: 'CONFIRMED' }, afterCounts.get('r1'));
  assert.doesNotMatch(afterHtml, /comment-count-pill/);
  assert.match(afterHtml, />Discuss<\/button>/);

  for (const status of ['PENDING', 'CONFIRMED', 'REJECTED', 'VOIDED']) {
    const emptyThreadBtn = ctx.window.Ipon.recordDiscussionButtonHtml({ id: `r-${status}`, approval_status: status }, 0);
    assert.match(emptyThreadBtn, />Discuss<\/button>/);
  }
  const appCss = read('css/app.css');
  assert.match(appCss, /\.icon-action \{[^}]*justify-content:center;/);
  assert.match(appCss, /\.record-discuss-btn \{[\s\S]*?justify-content:\s*center;/);
});

test('excess carry-over toggle stays hidden unless entered amount exceeds monthly due', async () => {
  const contribHtml = read('contributions.html');
  const userHtml = read('user.html');
  const recordsJs = read('js/records.js');
  const userJs = read('js/user.js');
  const appCss = read('css/app.css');
  const core = read('js/core.js');

  assert.match(contribHtml, /<div class="field field-wide" id="allocate-excess-field" hidden>/);
  assert.match(userHtml, /<div class="field field-wide" id="user-allocate-excess-field" hidden>/);
  assert.match(recordsJs, /bindExcessContributionToggle/);
  assert.match(userJs, /bindExcessContributionToggle/);
  assert.match(appCss, /\.excess-carryover-field/);
  assert.match(appCss, /\.excess-carryover-meta/);

  const makeNode = (id = '') => {
    const classSet = new Set();
    return {
      id,
      value: '',
      checked: false,
      hidden: false,
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      children: [],
      listeners: new Map(),
      classList: {
        add(...c) { c.forEach((x) => classSet.add(x)); },
        remove(...c) { c.forEach((x) => classSet.delete(x)); },
        toggle(c, f) { if (f === undefined) { classSet.has(c) ? classSet.delete(c) : classSet.add(c); } else if (f) { classSet.add(c); } else { classSet.delete(c); } },
        contains: (c) => classSet.has(c)
      },
      appendChild(child) { this.children.push(child); return child; },
      setAttribute() { },
      closest() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener(evt, fn) { this.listeners.set(evt, fn); }
    };
  };

  const hintSpan = makeNode('label-span');
  const labelNode = makeNode('label');
  labelNode.querySelector = (s) => (s === 'span' ? hintSpan : null);
  const fieldNode = makeNode('allocate-excess-field');
  const checkboxNode = makeNode('allocate-excess');
  checkboxNode.closest = (s) => (s === '.field' ? fieldNode : s === 'label' ? labelNode : null);
  const amountInput = makeNode('amount');

  const els = { 'app-loader': makeNode('app-loader') };
  const doc = {
    body: { dataset: { page: 'contributions' }, classList: { add() { }, remove() { }, toggle() { }, contains: () => false }, querySelectorAll: () => [], insertAdjacentHTML() { }, appendChild() { }, addEventListener() { } },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    documentElement: { dataset: {} },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => els[id] || null,
    createElement: (tag) => makeNode(tag),
    addEventListener: () => { }
  };
  const ctx = {
    window: null, document: doc, HTMLInputElement: class { }, HTMLFormElement: class { }, HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/contributions.html', pathname: '/contributions.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    IPON_CONFIG: { supabaseUrl: '', supabaseAnonKey: '' },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  const { computeContributionExcess, bindExcessContributionToggle } = ctx.window.Ipon;
  assert.deepEqual({ ...computeContributionExcess({ amount: 0, fallbackMonthlyAmount: 500 }) }, { show: false, excess: 0, remainingDue: 0 });
  assert.deepEqual({ ...computeContributionExcess({ amount: 300, statusRow: { required_amount: 500, outstanding_amount: 500 } }) }, { show: false, excess: 0, remainingDue: 500 });
  assert.deepEqual({ ...computeContributionExcess({ amount: 500, statusRow: { required_amount: 500, outstanding_amount: 500 } }) }, { show: false, excess: 0, remainingDue: 500 });
  assert.deepEqual({ ...computeContributionExcess({ amount: 750, statusRow: { required_amount: 500, outstanding_amount: 500 } }) }, { show: true, excess: 250, remainingDue: 500 });
  assert.deepEqual({ ...computeContributionExcess({ amount: 150, statusRow: { required_amount: 500, outstanding_amount: 0 } }) }, { show: true, excess: 150, remainingDue: 0 });

  const sync = bindExcessContributionToggle({
    amountInput,
    checkbox: checkboxNode,
    field: fieldNode,
    getContext: async () => ({ statusRow: { required_amount: 500, outstanding_amount: 500 }, fallbackMonthlyAmount: 500 })
  });
  assert.equal(fieldNode.hidden, true);

  amountInput.value = '500';
  await sync();
  assert.equal(fieldNode.hidden, true);

  amountInput.value = '750';
  await sync();
  assert.equal(fieldNode.hidden, false);
  assert.equal(hintSpan.children[0].hidden, false);
  assert.match(hintSpan.children[0].textContent, /250\.00 excess/);

  checkboxNode.checked = true;
  amountInput.value = '400';
  await sync();
  assert.equal(fieldNode.hidden, true);
  assert.equal(checkboxNode.checked, false);
});

test('sidebar profile card, account modal, and announcement reactions omit group ADMIN badge outside group contexts', () => {
  const coreJs = read('js/core.js');
  const settingsJs = read('js/settings.js');
  const appCss = read('css/app.css');

  assert.match(coreJs, /sidebarUser\.innerHTML = `<strong class="sidebar-user-name"><span>\$\{escapeHtml\(profile\.full_name\)\}<\/span>\$\{verifiedBadgesHtml\(profile\)\}<\/strong><small>\$\{escapeHtml\(profile\.role === 'SUPER_ADMIN' \? 'Owner' : 'My account'\)\}<\/small>`/);
  assert.match(coreJs, /getElementById\('quick-account-role'\)\.textContent = currentProfile\.role === 'SUPER_ADMIN' \? 'Owner' : \(data\.email \|\| 'My account'\)/);
  assert.match(appCss, /\.account-profile-identity\s+small\s*\{[^}]*border-radius\s*:\s*999px[^}]*background\s*:\s*#dceee3[^}]*color\s*:\s*#16553e/);
  assert.match(coreJs, /\$\{isOwner \? '<span class="reaction-user-role-badge is-owner">Owner<\/span>' : ''\}/);
  assert.doesNotMatch(coreJs, /reaction-user-role-badge \$\{roleClass\}/);
  assert.match(settingsJs, /class="role-badge/);
});

test('closed-app Web Push (VAPID), Edge dispatch, and Android instant background sync are wired end to end', () => {
  const migration063 = read('database/migrations/20261114_063_push_notifications.sql');
  const schema = read('database/schema.sql');
  const sendPushFn = read('supabase/functions/send-push/index.ts');
  const migrateScript = read('scripts/supabase-migrate.mjs');
  const configJs = read('js/config.js');
  const sw = read('sw.js');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const gradle = read('android/app/build.gradle');
  const syncService = read('android/app/src/main/java/com/myipon/app/NotificationSyncService.java');
  const syncWorker = read('android/app/src/main/java/com/myipon/app/NotificationSyncWorker.java');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');

  for (const symbol of [
    'push_subscriptions',
    'upsert_push_subscription',
    'delete_push_subscription',
    'enqueue_notification_push',
    'notifications_push_dispatch',
    '20261114_063'
  ]) {
    assert.ok(migration063.includes(symbol), `migration 063 missing ${symbol}`);
    assert.ok(schema.includes(symbol), `schema.sql missing ${symbol}`);
  }

  assert.match(sendPushFn, /webpush\.sendNotification/);
  assert.match(sendPushFn, /notif-wake:/);
  assert.match(sendPushFn, /push_subscriptions/);
  assert.match(migrateScript, /'send-push'/);
  assert.match(configJs, /vapidPublicKey:\s*'[A-Za-z0-9_-]{40,}'/);

  assert.match(sw, /renotify:/);
  assert.match(sw, /pushsubscriptionchange/);
  assert.match(sw, /MYIPON_PUSH_SHOWN/);

  assert.match(coreJs, /function syncWebPushSubscription/);
  assert.match(coreJs, /function removeWebPushSubscription/);
  assert.match(coreJs, /function sendBackgroundTestNotification/);
  assert.match(coreJs, /data-device-test-btn/);
  assert.match(css, /\.preference-device-actions/);

  assert.match(manifest, /RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /FOREGROUND_SERVICE_REMOTE_MESSAGING/);
  assert.match(manifest, /REQUEST_IGNORE_BATTERY_OPTIMIZATIONS/);
  assert.match(manifest, /com\.myipon\.app\.NotificationSyncService/);
  assert.match(gradle, /androidx\.work:work-runtime/);
  assert.match(gradle, /com\.squareup\.okhttp3:okhttp/);
  assert.match(syncService, /realtime:notif-wake:/);
  assert.match(syncService, /START_STICKY/);
  assert.match(syncWorker, /PeriodicWorkRequest/);
  assert.match(pollReceiver, /NotificationSyncService\.ensureStarted/);
  assert.match(bgPlugin, /requestIgnoreBatteryOptimizations/);
  assert.match(bgPlugin, /openNotificationSettings/);
  assert.match(bgPlugin, /getBackgroundStatus/);
  assert.match(coreJs, /openNotificationUnblockGuide/);
  assert.match(coreJs, /recheckDeviceNotificationPermission/);
  assert.match(mainActivity, /NotificationSyncService\.ensureStarted/);
});

test('formal name validation rejects ALL CAPS and all-lowercase names live and requires setup for optional-name invites', () => {
  const coreJs = read('js/core.js');
  const authJs = read('js/auth.js');
  const accountJs = read('js/account.js');
  const membersJs = read('js/members.js');
  const settingsJs = read('js/settings.js');
  const superAdminJs = read('js/super-admin.js');
  const dashboardJs = read('js/dashboard.js');
  const manageAccountTs = read('supabase/functions/manage-account/index.ts');
  const migration064 = read('database/migrations/20261114_064_formal_names_and_invite_onboarding.sql');
  const schema = read('database/schema.sql');
  const appCss = read('css/app.css');

  const makeMockInput = (name, { required = true } = {}) => {
    const attrs = new Map();
    const errEl = { classList: { contains: (c) => c === 'field-error' }, textContent: '', hidden: true, setAttribute() { } };
    const container = { querySelector: () => errEl, append() { } };
    return {
      name,
      value: '',
      required,
      customValidity: '',
      listeners: new Map(),
      dataset: {},
      setCustomValidity(msg) { this.customValidity = String(msg || ''); },
      toggleAttribute(k, force) {
        if (force) attrs.set(k, 'true'); else attrs.delete(k);
      },
      hasAttribute(k) { return attrs.has(k); },
      getAttribute() { return ''; },
      closest() { return container; },
      addEventListener(type, fn) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(fn);
      },
      _errEl: errEl
    };
  };

  const firstInput = makeMockInput('first_name', { required: true });
  const middleInput = makeMockInput('middle_name', { required: false });
  const lastInput = makeMockInput('last_name', { required: true });

  const makeNode = (tag) => ({
    tagName: String(tag).toUpperCase(),
    className: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    classList: { add() { }, toggle() { }, remove() { }, contains: () => false },
    setAttribute() { },
    appendChild() { },
    append() { },
    remove() { },
    addEventListener() { },
    querySelectorAll: () => [],
    querySelector: () => null
  });
  const loaderNode = makeNode('div');
  const doc = {
    body: {
      dataset: { page: 'account' },
      classList: { add() { }, toggle() { }, contains: () => false },
      insertAdjacentHTML() { },
      appendChild() { },
      append() { },
      addEventListener() { },
      querySelector: () => null
    },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    documentElement: { dataset: {} },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: (sel) => sel.includes('first_name') ? [firstInput, middleInput, lastInput] : [],
    getElementById: (id) => (id === 'app-loader' ? loaderNode : null),
    createElement: (tag) => makeNode(tag),
    addEventListener: () => { }
  };
  const ctx = {
    window: null, document: doc, HTMLInputElement: class { }, HTMLFormElement: class { }, HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/account.html', pathname: '/account.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    IPON_CONFIG: { supabaseUrl: '', supabaseAnonKey: '' },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const {
    validNamePart,
    validFullName,
    validateNameInput,
    prepareNameInputs,
    profileNeedsSetup,
    accountSetupUrl
  } = ctx.window.Ipon;

  // Formal names accepted
  for (const ok of ['Juan', 'Dela Cruz', 'De La Cruz', 'De Monteverde', 'Anna-Maria', "O'Connor", 'McDonald', 'Maria de Jesus', 'Santos III']) {
    assert.equal(validNamePart(ok), true, `expected formal name part to pass: ${ok}`);
  }
  assert.equal(validNamePart('A', { allowSingleInitial: true }), true);
  assert.equal(validNamePart('A', { allowSingleInitial: false }), false);

  // Informal casing (all lowercase, ALL CAPS, mixed gibberish) rejected
  for (const bad of ['dwadaw', 'DAWDSA', 'juan', 'JUAN', 'dela cruz', 'DELA CRUZ', 'jUAN', 'DwadAW', 'Juan 123', 'a']) {
    assert.equal(validNamePart(bad), false, `expected malformed name to be rejected: ${bad}`);
  }
  assert.equal(validNamePart('a', { allowSingleInitial: true }), false);

  // Full name invite field validator
  assert.equal(validFullName('Juan Dela Cruz'), true);
  assert.equal(validFullName('Juan A Dela Cruz'), true);
  assert.equal(validFullName('dwadaw A DAWDSA'), false);
  assert.equal(validFullName('JUAN DELA CRUZ'), false);
  assert.equal(validFullName('juan dela cruz'), false);
  assert.equal(validFullName('Juan'), false);

  // Live typing triggers error immediately on lowercase / ALL CAPS without false positives while typing valid Title Case
  prepareNameInputs();
  const triggerInput = (inp, val) => {
    inp.value = val;
    for (const fn of inp.listeners.get('input') || []) fn();
  };
  triggerInput(firstInput, 'd');
  assert.equal(firstInput.hasAttribute('aria-invalid'), true);
  assert.match(firstInput.customValidity, /formal capitalization/i);
  assert.match(firstInput.customValidity, /e\.g\., Juan\)/);
  assert.doesNotMatch(firstInput.customValidity, /Juan Dela Cruz/);

  triggerInput(firstInput, 'DA');
  assert.equal(firstInput.hasAttribute('aria-invalid'), true);
  assert.match(firstInput.customValidity, /formal capitalization/i);
  assert.match(firstInput.customValidity, /e\.g\., Juan\)/);

  triggerInput(middleInput, 's');
  assert.equal(middleInput.hasAttribute('aria-invalid'), true);
  assert.match(middleInput.customValidity, /e\.g\., Santos or A\)/);

  triggerInput(lastInput, 'delacruz');
  assert.equal(lastInput.hasAttribute('aria-invalid'), true);
  assert.match(lastInput.customValidity, /e\.g\., Dela Cruz\)/);
  assert.doesNotMatch(lastInput.customValidity, /Juan Dela Cruz/);

  triggerInput(firstInput, 'McD');
  assert.equal(firstInput.hasAttribute('aria-invalid'), false);

  triggerInput(firstInput, 'McDonald');
  assert.equal(validateNameInput(firstInput), true);
  assert.equal(firstInput.hasAttribute('aria-invalid'), false);

  // Payout channel & payment dropdown icon picker enhancement
  assert.equal(typeof ctx.window.Ipon.enhancePaymentSelect, 'function');
  assert.match(coreJs, /enhancePaymentSelect\(channelSel\)/);
  assert.match(read('js/records.js'), /Ipon\.enhancePaymentSelect\?\.\(methodFilter,\s*\{\s*compact:\s*true\s*\}\)/);
  assert.match(read('js/records.js'), /Ipon\.enhancePaymentSelect\?\.\(editForm\?\.elements\?\.payment_method\)/);
  assert.match(read('js/auth.js'), /fieldName:\s*'first_name'/);
  assert.match(read('js/auth.js'), /fieldName:\s*'last_name'/);
  assert.match(appCss, /\.custom-payment-select-wrap\b/);
  assert.match(appCss, /\.custom-select-icon-slot\b/);

  // Mandatory onboarding right after login for optional-name invites and existing malformed profiles
  assert.equal(profileNeedsSetup({
    first_name: 'Group',
    last_name: 'Member',
    contact_number: '09171234567',
    name_setup_required: true
  }), true);
  assert.match(accountSetupUrl({
    first_name: 'Group',
    last_name: 'Member',
    contact_number: '09171234567',
    name_setup_required: true
  }, { app_metadata: {} }), /complete_profile=1/);

  assert.equal(profileNeedsSetup({
    first_name: 'dwadaw',
    middle_name: 'A',
    last_name: 'DAWDSA',
    contact_number: '09171234567'
  }), true);

  assert.equal(profileNeedsSetup({
    first_name: 'Juan',
    middle_name: 'A',
    last_name: 'Dela Cruz',
    contact_number: '09171234567',
    name_setup_required: false
  }), false);

  // Form wiring + sidebar layout + Edge + SQL migration parity
  assert.match(appCss, /\.sidebar-utilities\{display:contents/);
  assert.match(accountJs, /validateNameFields\(profileForm\)/);
  assert.match(accountJs, /mustCompleteName/);
  assert.match(authJs, /name_setup_required/);
  assert.match(membersJs, /Ipon\.validateNameFields\(form\)/);
  assert.match(settingsJs, /Ipon\.validateNameFields\(treasurerForm\)/);
  assert.match(superAdminJs, /Ipon\.validateNameFields\(administratorForm\)/);
  assert.match(dashboardJs, /prepareInviteNameInput/);
  assert.match(dashboardJs, /name_optional:/);
  assert.match(manageAccountTs, /function validFormalNamePart/);
  assert.match(manageAccountTs, /name_setup_required:\s*nameOptional/);
  for (const token of ['name_setup_required', 'validated_name_part', 'update_own_profile', 'enforce_data_quality', '20261114_064']) {
    assert.ok(migration064.includes(token), `migration 064 missing ${token}`);
    assert.ok(schema.includes(token), `schema.sql missing ${token}`);
  }
});

test('phone and drawer alerts accurately detect OS/browser ON state and show clear status labels', () => {
  const core = read('js/core.js');
  const accountHtml = read('account.html');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');

  assert.match(core, /function isMobileDeviceNotifClient/);
  assert.match(core, /navigator\.permissions\.query\(\{\s*name:\s*'notifications'\s*\}\)/);
  assert.match(core, /pushManager\?\.permissionState/);
  assert.match(core, /nativePromptPromise/);
  assert.match(core, /bindBrowserPermissionObserver/);
  assert.match(core, /bgRes\?\.hasPermission === true/);
  assert.match(core, /Notification permission: On/);
  assert.match(core, /Device permission: Off/);
  assert.match(core, /Browser site permission: Off/);
  assert.match(core, /Device permission: Blocked/);
  assert.match(core, /button\.textContent = 'Turn on'/);
  assert.match(core, /button\.textContent = 'On'/);
  assert.doesNotMatch(accountHtml, /Phone &amp; drawer alerts|data-device-notif-row/);
  assert.doesNotMatch(core, /Phone &amp; drawer alerts|<[^>]+data-device-notif-row/);
  assert.match(pollReceiver, /NotificationManagerCompat\.from\(context\)\.areNotificationsEnabled\(\)/);
});

test('wallet reconciliation and peso inputs validate bounds, block overflow precision loss, and show inline errors', () => {
  const coreJs = read('js/core.js');
  const reportsJs = read('js/reports.js');
  const recordsJs = read('js/records.js');
  const savingsHtml = read('savings.html');
  const css = read('css/app.css');

  const doc = {
    documentElement: { dataset: {} },
    head: { insertAdjacentHTML() { }, querySelector: () => null },
    body: { dataset: {}, classList: { toggle() { }, add() { }, remove() { }, contains: () => false }, insertAdjacentHTML() { }, append() { } },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    createElement: () => ({ setAttribute() { }, appendChild() { }, classList: { add() { }, toggle() { } }, dataset: {}, style: {} }),
    addEventListener() { }
  };
  const ctx = {
    window: null, document: doc, HTMLInputElement: class { }, HTMLFormElement: class { }, HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/reports.html', pathname: '/reports.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    IPON_CONFIG: { supabaseUrl: '', supabaseAnonKey: '' },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const { parseMoneyAmount, MAX_MONEY_AMOUNT } = ctx.window.Ipon;
  assert.equal(MAX_MONEY_AMOUNT, 999999999999.99);

  // Reject oversized 34-digit overflow, negatives, scientific notation, badInput, and >2 decimals
  assert.equal(parseMoneyAmount('1233131123131231312313131231312313').valid, false);
  assert.equal(parseMoneyAmount('1000000000000').valid, false);
  assert.equal(parseMoneyAmount('-50').valid, false);
  assert.equal(parseMoneyAmount('1e20').valid, false);
  assert.equal(parseMoneyAmount('10.123').valid, false);
  assert.equal(parseMoneyAmount('', { badInput: true }).valid, false);
  assert.equal(parseMoneyAmount('', { required: true }).valid, false);

  // Accept clean empty (optional) and bounded currency values
  const emptyParsed = parseMoneyAmount('', { required: false });
  assert.equal(emptyParsed.valid, true);
  assert.equal(emptyParsed.value, null);
  assert.equal(parseMoneyAmount('0').value, 0);
  assert.equal(parseMoneyAmount('100.50').value, 100.5);
  assert.equal(parseMoneyAmount('.5').value, 0.5);
  assert.equal(parseMoneyAmount('999999999999.99').valid, true);

  assert.match(reportsJs, /Ipon\.parseMoneyAmount/);
  assert.match(reportsJs, /Ipon\.guardMoneyInput/);
  assert.match(reportsJs, /data-wallet-error/);
  assert.match(reportsJs, /wallet-variance-pill is-invalid/);
  assert.match(reportsJs, /Fix invalid count/);
  assert.match(recordsJs, /id="edit-amount"[^>]*max="999999999999\.99"/);
  assert.match(savingsHtml, /id="calc-target"[^>]*max="999999999999\.99"/);
  assert.match(savingsHtml, /id="calc-current"[^>]*max="999999999999\.99"/);
  assert.match(css, /\.wallet-count-error/);
  assert.match(css, /table-layout:\s*fixed/);
  assert.match(css, /\.wallet-variance-pill\.is-invalid/);
});

test('dark and light theme toggle persists across tabs, updates charts, preserves print paper, and meets WCAG contrast', () => {
  const coreJs = read('js/core.js');
  const recordsJs = read('js/records.js');
  const reportsJs = read('js/reports.js');
  const appCss = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  const landingCss = read('css/landing.css');
  const loginHtml = read('login.html');

  const store = new Map([['myipon_theme', 'dark']]);
  const listeners = new Map();
  const rootEl = { dataset: {}, style: {} };
  const metaTheme = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const dispatched = [];
  const docStub = {
    body: { dataset: {}, classList: { contains: () => false, toggle() { }, add() { }, remove() { } }, insertAdjacentHTML() { }, append() { } },
    head: { insertAdjacentHTML() { } },
    documentElement: rootEl,
    createElement: () => ({ style: {}, dataset: {}, classList: { contains: () => false, add() { }, toggle() { }, remove() { } }, setAttribute() { }, querySelector: () => null, appendChild() { }, append() { }, prepend() { }, remove() { }, addEventListener() { } }),
    querySelector(sel) {
      if (sel === 'meta[name="theme-color"]') return metaTheme;
      return sel === 'link[rel="manifest"]' ? {} : null;
    },
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); }
  };
  const winListeners = new Map();
  const ctx = {
    URLSearchParams,
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    window: null,
    document: docStub,
    navigator: {},
    location: { protocol: 'https:', hostname: 'myipon.example', search: '' },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: {},
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener(type, fn) { winListeners.set(type, [...(winListeners.get(type) || []), fn]); },
    dispatchEvent(evt) { dispatched.push(evt); },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const { getTheme, setTheme, toggleTheme, isDarkTheme, chartThemeOptions } = ctx.window.Ipon;
  assert.equal(getTheme(), 'dark');
  assert.equal(isDarkTheme(), true);
  assert.equal(rootEl.dataset.theme, 'dark');
  assert.equal(rootEl.style.colorScheme, 'dark');
  assert.equal(metaTheme.attrs.content, '#081310');
  assert.equal(chartThemeOptions().isDark, true);
  assert.equal(chartThemeOptions().textColor, '#d2e0d9');

  assert.equal(toggleTheme(), 'light');
  assert.equal(getTheme(), 'light');
  assert.equal(isDarkTheme(), false);
  assert.equal(store.get('myipon_theme'), 'light');
  assert.equal(rootEl.style.colorScheme, 'light');
  assert.equal(metaTheme.attrs.content, '#0b3428');
  assert.equal(chartThemeOptions().isDark, false);
  assert.ok(dispatched.some((e) => e.type === 'ipon:themechange' && e.detail?.theme === 'light'));

  // Cross-tab storage sync updates live without rewriting storage
  (winListeners.get('storage') || []).forEach((fn) => fn({ key: 'myipon_theme', newValue: 'dark' }));
  assert.equal(rootEl.dataset.theme, 'dark');
  assert.equal(setTheme('invalid-value'), 'light');

  // Dark mode switcher lives in Settings / Account Preferences instead of reserving sidebar-utilities (reserved for chat)
  const sidebarUtilityStub = {
    prepended: [],
    querySelector: () => null,
    prepend(el) { this.prepended.push(el); }
  };
  const prevDocQuery = docStub.querySelector;
  docStub.querySelector = (sel) => (sel === '.sidebar-utilities' ? sidebarUtilityStub : prevDocQuery(sel));
  ctx.window.Ipon.mountThemeControls(docStub);
  assert.equal(sidebarUtilityStub.prepended.length, 0);

  const settingsHtml = read('settings.html');
  const accountHtml = read('account.html');
  assert.match(settingsHtml, /id="settings-theme-dark"[^>]*data-theme-checkbox/);
  assert.match(accountHtml, /id="account-theme-dark"[^>]*data-theme-checkbox/);
  assert.match(coreJs, /id="quick-theme-dark"[^>]*data-theme-checkbox/);
  assert.doesNotMatch(coreJs, /sidebar-theme-toggle/);

  // Stylesheets cover app shell, dashboard hero plates, landing, and login + print light reset
  assert.match(appCss, /html\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/);
  assert.match(appCss, /@media print\s*\{[\s\S]*?html\[data-theme="dark"\][\s\S]*?background:\s*#ffffff\s*!important/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s+\.tracked-total\s*\{\s*color:#ffffff;/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s+\.tracked-label\s*\{\s*color:#8fd2ae;/);
  assert.match(heroCss, /\.month-button\s+svg\s*\{[^}]*stroke:currentColor;/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s+\.month-button\s*\{[^}]*color:#ecf3ef;/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s+\.month-button\s+svg\s*\{\s*stroke:currentColor;\s*\}/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s+\.calendar-jump-chevron\s*\{\s*stroke:#cad9d2;\s*\}/);
  assert.match(heroCss, /html\[data-theme="dark"\]\s+\.calendar-title-icon\s*\{\s*stroke:#7ee0ab;\s*\}/);
  assert.equal((appCss.match(/^html\[data-theme="dark"\]\s*\{/gm) || []).length, 1);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.bug-viewer-item/);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.announcement-media-item/);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.release-credit-anonymous/);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.invite-row-badge/);
  assert.match(appCss, /\.avatar-circle\s+img\s*\{[^}]*border-radius:50%/);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.presence-dot\s*\{[^}]*border-color:\s*var\(--surface\)/);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.announcement-avatar\.is-owner\s*\{[^}]*border-color:/);
  assert.match(appCss, /html\[data-theme="dark"\]\s+\.reaction-stack-emoji,\s*html\[data-theme="dark"\]\s+\.reaction-user-emoji-badge\s*\{[^}]*box-shadow:\s*0 0 0 1\.5px var\(--surface\)/);
  assert.match(landingCss, /html\[data-theme="dark"\]\s+\.landing/);
  assert.doesNotMatch(landingCss, /\.l-btn:hover\s+svg\s*\{[^}]*translateX/);
  assert.match(landingCss, /\.l-btn\[data-theme-toggle\]:hover,[\s\S]*?\.l-btn\[data-theme-toggle\]:hover svg,[\s\S]*?transform:\s*none;/);
  assert.match(loginHtml, /html\[data-theme="dark"\]\s+\.login-card/);
  assert.doesNotMatch(coreJs, /color:#324841/);
  assert.doesNotMatch(coreJs, /color: #354741/);
  assert.match(recordsJs, /ipon:themechange/);
  assert.match(reportsJs, /ipon:themechange/);
  assert.match(recordsJs, /Ipon\.chartThemeOptions/);
  assert.match(reportsJs, /Ipon\.chartThemeOptions/);

  // Programmatic WCAG AA (>= 4.5:1) verification on dark mode token pairs
  const luminance = (hex) => {
    const [r, g, b] = hex.replace('#', '').match(/../g).map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  assert.ok(contrast('#ecf3ef', '#0b1613') >= 12, 'dark paper ink contrast');
  assert.ok(contrast('#ecf3ef', '#13231f') >= 10, 'dark surface ink contrast');
  assert.ok(contrast('#9eb3aa', '#13231f') >= 6.5, 'dark muted contrast >= AA');
  assert.ok(contrast('#cad9d2', '#192f29') >= 7, 'dark subtle surface soft ink contrast');
  assert.ok(contrast('#ffffff', '#1e6249') >= 6.5, 'dark primary button white text contrast');
});

test('enhancePaymentSelect upgrades payout channel and payment selects with GCash, Maya, Bank, and Cash icons', () => {
  const core = read('js/core.js');
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.attributes = new Map();
      this.listeners = new Map();
      this.parentNode = null;
      this.hidden = false;
      this.disabled = false;
      this.textContent = '';
      this._innerHTML = '';
      this.classList = {
        set: new Set(),
        add: (...c) => c.forEach((x) => this.classList.set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList.set.delete(x)),
        toggle: (x, f) => (f ? this.classList.set.add(x) : this.classList.set.delete(x)),
        contains: (x) => this.classList.set.has(x)
      };
    }
    set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classList.set].join(' '); }
    set innerHTML(v) { this._innerHTML = String(v); }
    get innerHTML() { return this._innerHTML; }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.get(k) ?? null; }
    addEventListener(t, fn) { if (!this.listeners.has(t)) this.listeners.set(t, []); this.listeners.get(t).push(fn); }
    dispatchEvent(e) { (this.listeners.get(e.type) || []).forEach((fn) => fn(e)); return true; }
    appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
    insertBefore(n, ref) {
      const idx = this.children.indexOf(ref);
      n.parentNode = this;
      if (idx >= 0) this.children.splice(idx, 0, n); else this.children.push(n);
    }
    replaceChildren(...nodes) { this.children = []; nodes.forEach((n) => this.appendChild(n)); }
    insertAdjacentHTML() { }
    focus() { }
    querySelector(sel) {
      if (sel === '.custom-select-trigger-icon') {
        if (!this._triggerIcon) this._triggerIcon = new Node('span');
        return this._triggerIcon;
      }
      if (sel === '.custom-select-trigger-label') {
        if (!this._triggerLabel) this._triggerLabel = new Node('span');
        return this._triggerLabel;
      }
      if (sel === '.custom-select-badge') {
        if (!this._triggerBadge) this._triggerBadge = new Node('span');
        return this._triggerBadge;
      }
      return null;
    }
    querySelectorAll() { return []; }
  }

  const fieldWrap = new Node('div');
  const select = new Node('select');
  select.id = 'account-payout-channel';
  select.name = 'payout_channel';
  select.options = [
    { value: '', textContent: 'Not set', selected: true, disabled: false },
    { value: 'GCASH', textContent: 'GCash', selected: false, disabled: false },
    { value: 'MAYA', textContent: 'Maya', selected: false, disabled: false },
    { value: 'BANK_TRANSFER', textContent: 'Bank Transfer', selected: false, disabled: false },
    { value: 'CASH', textContent: 'Cash pickup', selected: false, disabled: false },
    { value: 'OTHER', textContent: 'Other e-wallet / bank', selected: false, disabled: false }
  ];
  let _val = '';
  Object.defineProperty(select, 'value', {
    get: () => _val,
    set: (v) => {
      _val = String(v);
      select.options.forEach((o) => { o.selected = o.value === _val; });
    }
  });
  Object.defineProperty(select, 'selectedIndex', {
    get: () => Math.max(0, select.options.findIndex((o) => o.value === _val))
  });
  fieldWrap.appendChild(select);

  const loaderNode = new Node('div');
  const doc = {
    body: new Node('body'),
    head: new Node('head'),
    documentElement: { dataset: {} },
    readyState: 'complete',
    createElement: (tag) => new Node(tag),
    getElementById: (id) => (id === 'app-loader' ? loaderNode : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => { }
  };
  doc.body.dataset = { page: 'account' };

  const ctx = {
    window: null, document: doc,
    Event: class { constructor(type) { this.type = type; } },
    CSS: { escape: (v) => v },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/account.html', pathname: '/account.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } disconnect() { } },
    IPON_CONFIG: { supabaseUrl: '', supabaseAnonKey: '' },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  const api = ctx.window.Ipon.enhancePaymentSelect(select);
  assert.ok(api.wrap.classList.contains('custom-payment-select-wrap'));
  assert.ok(select.classList.contains('custom-select-native'));

  const [, trigger, menu] = api.wrap.children;
  assert.equal(trigger.querySelector('.custom-select-trigger-label').textContent, 'Not set');
  assert.match(trigger.querySelector('.custom-select-trigger-icon').innerHTML, /is-untagged/);

  const options = menu.children[0].children;
  assert.equal(options.length, 6);
  assert.match(options[1].innerHTML, /is-gcash/);
  assert.match(options[2].innerHTML, /is-maya/);
  assert.match(options[3].innerHTML, /is-bank/);
  assert.match(options[4].innerHTML, /is-cash/);
  assert.match(options[5].innerHTML, /is-other/);

  let changes = 0;
  select.addEventListener('change', () => { changes += 1; });
  (options[1].listeners.get('click') || []).forEach((fn) => fn({ stopPropagation() { } }));

  assert.equal(select.value, 'GCASH');
  assert.equal(changes, 1);
  assert.equal(trigger.querySelector('.custom-select-trigger-label').textContent, 'GCash');
  assert.match(trigger.querySelector('.custom-select-trigger-icon').innerHTML, /is-gcash/);
});

test('startup initialization auto-recovers transient errors, JWT expiry, and Web Lock contention without false startup-error overlay', async () => {
  const core = read('js/core.js');
  const injectedHtml = [];
  const winListeners = new Map();
  const makeNode = (tag = 'div') => ({
    tagName: tag.toUpperCase(),
    dataset: {},
    style: { removeProperty() { } },
    classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
    setAttribute() { }, removeAttribute() { }, getAttribute: () => null, hasAttribute: () => false,
    addEventListener() { }, removeEventListener() { },
    querySelector: () => null, querySelectorAll: () => [],
    insertAdjacentHTML(_pos, html) { injectedHtml.push(String(html)); },
    append() { }, appendChild() { }, prepend() { }, remove() { }, closest: () => null, focus() { },
    innerHTML: '', textContent: '', hidden: false
  });
  const loaderStub = makeNode('div');
  const sidebarStub = makeNode('aside');
  const doc = {
    body: Object.assign(makeNode('body'), { dataset: { page: 'dashboard' } }),
    head: makeNode('head'),
    documentElement: makeNode('html'),
    createElement: (t) => makeNode(t),
    querySelector: (sel) => (sel === 'link[rel="manifest"]' ? {} : null),
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'app-loader' ? loaderStub : id === 'app-sidebar' ? sidebarStub : null),
    addEventListener() { }
  };

  let sessionCalls = 0;
  let profileCalls = 0;
  let refreshCalls = 0;
  const ctx = {
    URLSearchParams, URL, CustomEvent: class { constructor(t, i) { this.type = t; this.detail = i?.detail; } },
    Intl, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    navigator: { onLine: true },
    location: { origin: 'https://myipon.example', href: 'https://myipon.example/dashboard.html', pathname: '/dashboard.html', search: '', hostname: 'myipon.example', protocol: 'https:', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    supabase: {
      createClient: () => {
        return {
          auth: {
            getSession: async () => {
              sessionCalls += 1;
              if (sessionCalls === 1) throw new Error('Failed to fetch');
              return { data: { session: { user: { id: 'u1', app_metadata: {}, user_metadata: {} } } }, error: null };
            },
            refreshSession: async () => {
              refreshCalls += 1;
              return { data: { session: { user: { id: 'u1' } } }, error: null };
            },
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }),
            mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }) }
          },
          from: () => ({
            select: () => ({
              eq: () => ({
                single: async () => {
                  profileCalls += 1;
                  if (profileCalls === 1) return { data: null, error: { status: 401, message: 'JWT expired' } };
                  return {
                    data: {
                      id: 'u1', full_name: 'Juan Dela Cruz', first_name: 'Juan', last_name: 'Dela Cruz',
                      contact_number: '09171234567', role: 'ADMIN', status: 'ACTIVE', group_id: 'g1', name_setup_required: false
                    },
                    error: null
                  };
                },
                order: () => ({ limit: async () => ({ data: [], error: null }) })
              })
            })
          }),
          channel: () => ({ on() { return this; }, subscribe() { return this; }, track: async () => { } }),
          removeChannel() { }
        };
      }
    },
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout() { },
    setInterval: () => 0,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener(type, fn) { winListeners.set(type, [...(winListeners.get(type) || []), fn]); },
    dispatchEvent() { },
    document: doc,
    window: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  const res = await ctx.window.Ipon.init({ allowedRoles: ['ADMIN'] });
  assert.equal(typeof ctx.window.Ipon.mountPayoutFieldsets, 'function');
  // Startup mounts happen after all payment-method constants are initialized (no TDZ ReferenceError)
  assert.doesNotMatch(core, /if \(document\.body\.dataset\.page && !document\.body\.classList\.contains\('security-page'\)\) mountShell\(\);[\s\S]*const PAYMENT_METHOD_MAP/);

  assert.equal(res.failed, undefined);
  assert.equal(res.profile?.id, 'u1');
  assert.equal(sessionCalls, 2);
  assert.equal(refreshCalls, 1);
  assert.equal(profileCalls, 2);
  assert.ok(!injectedHtml.some((html) => html.includes('id="startup-error"')));

  // Background unhandledrejection with NavigatorLockAcquireTimeoutError never renders #startup-error
  (winListeners.get('unhandledrejection') || []).forEach((fn) => fn({
    preventDefault() { },
    reason: new Error('Acquiring an exclusive Navigator LockManager lock "lock:sb-auth-token" timed out')
  }));
  assert.ok(!injectedHtml.some((html) => html.includes('id="startup-error"')));
});

test('SVG eye-open path uses valid cubic commands across auth and shell templates', () => {
  for (const file of ['js/core.js', 'js/auth.js', 'login.html']) {
    assert.doesNotMatch(read(file), /M2 12s3\.5-7 10-7 10 7 10 7-3\.5 7-10 7-10-7Z/, `${file} must not contain invalid 2-arg trailing s curve`);
  }
});

test('avatarMarkup suffixes every wrapper class token so multi-class avatars never gain a square outer border', () => {
  const core = read('js/core.js');
  const stub = () => ({ dataset: {}, classList: { contains: () => false, add() { }, remove() { }, toggle() { } }, setAttribute() { }, addEventListener() { }, querySelector: () => null, querySelectorAll: () => [], style: { removeProperty() { } }, append() { }, insertAdjacentHTML() { }, remove() { } });
  const ctx = {
    URLSearchParams, URL, CustomEvent: class { }, Intl, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    navigator: { onLine: true },
    location: { origin: 'https://myipon.example', href: 'https://myipon.example/', pathname: '/', search: '', hostname: 'myipon.example', protocol: 'https:', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { }, requestAnimationFrame: () => { },
    addEventListener() { }, dispatchEvent() { },
    document: { body: stub(), head: stub(), documentElement: stub(), createElement: stub, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() { } },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  const html = ctx.window.Ipon.avatarMarkup('data:image/png;base64,iVBORw0KGgo=', 'Juan Dela Cruz', 'announcement-avatar is-owner', 'user-1');
  assert.match(html, /class="avatar-presence-wrap announcement-avatar-wrap is-owner-wrap"/);
  assert.match(html, /class="avatar-circle announcement-avatar is-owner"/);
});

test('all close and remove X buttons enforce circular aspect-ratio: 1 / 1 geometry (never oblong)', () => {
  const appCss = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  const loginHtml = read('login.html');

  assert.match(appCss, /\.dialog-close\s*\{[^}]*width:\s*40px;\s*height:\s*40px;\s*flex:\s*0 0 40px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.notification-sheet \.dialog-close\s*\{[^}]*width:\s*36px;\s*height:\s*36px;\s*flex:\s*0 0 36px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.account-dialog-header \.dialog-close\s*\{[^}]*width:\s*44px;\s*height:\s*44px;\s*flex:\s*0 0 44px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.announcement-modal-close\s*\{[^}]*width:\s*36px;\s*height:\s*36px;\s*flex:\s*0 0 36px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.group-hub-hero \.dialog-close\s*\{[^}]*flex:\s*0 0 42px;\s*width:\s*42px;\s*height:\s*42px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.account-avatar-remove\s*\{[^}]*width:\s*22px;\s*height:\s*22px;\s*flex:\s*0 0 22px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.bug-image-remove\s*\{[^}]*width:\s*22px;\s*height:\s*22px;\s*flex:\s*0 0 22px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.invite-row-remove\s*\{[^}]*width:\s*28px;\s*height:\s*28px;\s*flex:\s*0 0 28px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.calc-plan-remove\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*flex:\s*0 0 28px;[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(appCss, /\.record-thread-queued-remove\s*\{[^}]*width:\s*24px;[^}]*height:\s*24px;[^}]*flex:\s*0 0 24px;[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(heroCss, /\.calendar-jump-close\s*\{[^}]*width:\s*40px;\s*height:\s*40px;\s*flex:\s*0 0 40px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(heroCss, /\.day-detail-panel header button\s*\{[^}]*width:\s*40px;\s*height:\s*40px;\s*flex:\s*0 0 40px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
  assert.match(loginHtml, /\.login-card-close\s*\{[^}]*width:\s*36px;\s*height:\s*36px;\s*flex:\s*0 0 36px;\s*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/);
});

test('announcement author_name stays live with profile full_name changes across DB view, trigger, and UI', () => {
  const migration065 = read('database/migrations/20261114_065_live_announcement_author_name.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');

  assert.match(migration065, /create or replace function public\.announcement_author_name\(p_author_id uuid, p_fallback text default null\)/i);
  assert.match(migration065, /public\.announcement_author_name\(a\.author_id, a\.author_name\) as author_name/i);
  assert.match(migration065, /trg_profiles_sync_announcement_author_name/i);
  assert.match(migration065, /update public\.announcements a/i);
  assert.match(schema, /public\.announcement_author_name\(a\.author_id, a\.author_name\) as author_name/i);
  assert.match(core, /ipon:profile-updated/);
  assert.match(core, /isOwnPost && currentProfile\.full_name/);
});

test('dashboard wallet pills stay compact sans-serif and group switcher lives inside left group identity', () => {
  const dashboardHtml = read('dashboard.html');
  const dashboardJs = read('js/dashboard.js');
  const heroCss = read('css/hero-plates.css');

  const identityBlock = dashboardHtml.match(/<div class="group-bar-identity">[\s\S]*?<div class="group-bar-controls">/)?.[0] || '';
  assert.match(identityBlock, /id="dashboard-group-switcher-wrap"/);
  assert.match(identityBlock, /id="dashboard-group-select"/);
  const controlsBlock = dashboardHtml.match(/<div class="group-bar-controls">[\s\S]*?<section class="no-group-card"/)?.[0] || '';
  assert.doesNotMatch(controlsBlock, /dashboard-group-switcher-wrap|dashboard-group-select/);

  assert.match(dashboardJs, /groupIdentityEl\?\.classList\.toggle\('is-switchable',\s*canSwitchGroup\)/);
  assert.match(dashboardJs, /groupIdentityEl\?\.addEventListener\('click',/);

  assert.match(heroCss, /#dashboard-group-bar \.group-switcher-wrap \.custom-select-selection\s*\{\s*display:none;/);
  assert.match(heroCss, /\.summary-card \.dashboard-wallet-pill\s*\{[^}]*height:auto;\s*min-height:0;[^}]*border-radius:11px;/);
  assert.match(heroCss, /\.summary-card \.dashboard-wallet-pill strong\s*\{[^}]*"IPON Serif",serif;/);
  assert.match(heroCss, /\.summary-card \.dashboard-wallet-link\s*\{[^}]*border-radius:11px;/);
  assert.match(heroCss, /\.summary-breakdown dt span\s*\{[^}]*display:block;/);
});

test('member status mobile flex-basis reset and payout PH mobile live validation hold', () => {
  const appCss = read('css/app.css');
  const core = read('js/core.js');
  const migration066 = read('database/migrations/20261115_066_payout_mobile_validation.sql');

  const mobileStatusBlock = appCss.match(/@media \(max-width:\s*900px\)\s*\{[\s\S]*?\.member-metrics\s*\{/)?.[0] || '';
  assert.match(mobileStatusBlock, /\.member-status-summary\s*\{[^}]*flex:\s*0 0 auto;\s*width:\s*100%;/);
  assert.match(appCss, /\.field-label-row \.link-action\s*\{[^}]*white-space:\s*nowrap;\s*flex-shrink:\s*0;/);
  assert.match(migration066, /if v_channel in \('GCASH', 'MAYA'\) then\s+v_number := public\.normalize_ph_mobile\(v_number\);/i);

  class FakeEl {
    constructor(tag = 'div', attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.attributes = new Map();
      this.classList = {
        _set: new Set(),
        add: (...c) => c.forEach((x) => this.classList._set.add(x)),
        remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
        toggle: (x, f) => (f === undefined ? (this.classList._set.has(x) ? this.classList._set.delete(x) : this.classList._set.add(x)) : (f ? this.classList._set.add(x) : this.classList._set.delete(x))),
        contains: (x) => this.classList._set.has(x)
      };
      this.children = [];
      this.listeners = new Map();
      this.dataset = {};
      this.style = {};
      this.value = '';
      this.hidden = false;
      this.customValidity = '';
      this.parentNode = null;
      this.fieldContainer = null;
      Object.entries(attrs).forEach(([k, v]) => this.setAttribute(k, v));
    }
    setAttribute(k, v) {
      this.attributes.set(k, String(v));
      if (k === 'id') this.id = String(v);
      if (k === 'name') this.name = String(v);
      if (k === 'class') String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
    }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    hasAttribute(k) { return this.attributes.has(k); }
    removeAttribute(k) { this.attributes.delete(k); }
    toggleAttribute(k, force) {
      const on = force === undefined ? !this.hasAttribute(k) : Boolean(force);
      if (on) this.setAttribute(k, '');
      else this.removeAttribute(k);
      return on;
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    insertAdjacentHTML() { }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    dispatchEvent(type) { (this.listeners.get(type) || []).forEach((fn) => fn({ target: this, preventDefault() { } })); }
    setCustomValidity(msg) { this.customValidity = String(msg || ''); }
    focus() { this.focused = true; }
    closest(sel) {
      if (sel.includes('.field')) return this.fieldContainer || null;
      if (sel === 'form') return this.formRef || null;
      return null;
    }
    matches(sel) { return sel === '[data-payout-fields]'; }
  }

  const channelSel = new FakeEl('select', { name: 'payout_channel' });
  const numInput = new FakeEl('input', { name: 'payout_account_number' });
  const nameInput = new FakeEl('input', { name: 'payout_account_name' });
  const numError = new FakeEl('small', { class: 'field-error' });
  const useMobileBtn = new FakeEl('button');
  const detailField = new FakeEl('div', { class: 'field payout-detail-field' });
  numInput.fieldContainer = { querySelector: (sel) => (sel === '.field-error' ? numError : null) };
  const container = new FakeEl('div');
  container.dataset.mounted = 'true';
  container.querySelector = (sel) => ({
    'select[name="payout_channel"]': channelSel,
    'input[name="payout_account_number"]': numInput,
    'input[name="payout_account_name"]': nameInput,
    '[data-payout-use-mobile]': useMobileBtn
  }[sel] || null);
  container.querySelectorAll = (sel) => (sel === '.payout-detail-field' ? [detailField] : []);

  const loader = new FakeEl('div', { id: 'app-loader' });
  const body = new FakeEl('body');
  body.dataset = { page: 'user' };
  const doc = {
    documentElement: new FakeEl('html'),
    body,
    head: new FakeEl('head'),
    getElementById: (id) => (id === 'app-loader' ? loader : null),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-payout-fields]' ? [container] : []),
    createElement: (t) => new FakeEl(t),
    addEventListener() { },
    readyState: 'complete'
  };
  const ctx = {
    window: null, document: doc,
    HTMLInputElement: FakeEl, HTMLFormElement: FakeEl, HTMLElement: FakeEl,
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/user.html', pathname: '/user.html', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(core, ctx, { filename: 'js/core.js' });

  ctx.window.Ipon.setPayoutFields(container, { payout_channel: 'GCASH', payout_account_number: '' });
  assert.equal(numInput.maxLength, 13);
  assert.equal(numInput.inputMode, 'tel');

  numInput.value = '098472134132313131';
  numInput.dispatchEvent('input');
  assert.equal(numInput.value, '09847213413');
  assert.equal(ctx.window.Ipon.validatePayoutFields(container), true);
  assert.equal(numError.hidden, true);

  numInput.value = '123';
  numInput.dispatchEvent('input');
  assert.match(numError.textContent, /11 digits starting with 09/);
  assert.equal(numError.hidden, false);

  numInput.value = '09123';
  numInput.removeAttribute('aria-invalid');
  numInput.dispatchEvent('input');
  assert.equal(numError.hidden, true);
  numInput.dispatchEvent('blur');
  assert.equal(numError.hidden, false);
  assert.equal(ctx.window.Ipon.validatePayoutFields(container), false);

  numInput.value = '+639171234567';
  numInput.dispatchEvent('input');
  assert.equal(numError.hidden, true);
  assert.equal(ctx.window.Ipon.validatePayoutFields(container), true);

  channelSel.value = 'BANK_TRANSFER';
  channelSel.dispatchEvent('change');
  assert.equal(numInput.maxLength, 80);
  assert.equal(numInput.inputMode, 'text');
  numInput.value = 'BPI · 1234-5678-90';
  assert.equal(ctx.window.Ipon.validatePayoutFields(container), true);
});

test('questions email contact and landing footer social links render with icons and valid hrefs', () => {
  const loginHtml = read('login.html');
  const indexHtml = read('index.html');
  const landingCss = read('css/landing.css');

  assert.match(loginHtml, /<h3>Questions<\/h3>\s*<p>For privacy, payout-info visibility, or account concerns, email <a href="https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=zedrickdemonteverde1@gmail\.com[^"]*" target="_blank" rel="noopener noreferrer">zedrickdemonteverde1@gmail\.com<\/a>\.<\/p>/);
  assert.match(indexHtml, /href="https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=zedrickdemonteverde1@gmail\.com[^"]*" target="_blank" rel="noopener noreferrer"/);

  for (const url of [
    'https://www.facebook.com/zediskaaa/',
    'https://x.com/zediskaaa/',
    'https://www.instagram.com/zediskaaa/',
    'https://discord.com/channels/@765791188745322516'
  ]) {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(indexHtml, new RegExp(`<a class="l-social-link"[^>]*href="${escaped}"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>\\s*<svg[\\s\\S]*?<\\/svg>\\s*<\\/a>`));
  }
  assert.match(landingCss, /\.l-social-link\s*\{[^}]*aspect-ratio:\s*1 \/ 1;\s*border-radius:\s*50%;/);
});

test('Super Admin can edit own name in all lowercase and with first name only across UI and SQL while other roles keep formal rules', () => {
  const coreJs = read('js/core.js');
  const accountJs = read('js/account.js');
  const superAdminJs = read('js/super-admin.js');
  const migration067 = read('database/migrations/20261115_067_super_admin_flexible_name.sql');
  const schema = read('database/schema.sql');

  const makeNode = (tag) => ({
    tagName: String(tag).toUpperCase(),
    className: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    style: {},
    dataset: {},
    classList: { add() { }, toggle() { }, remove() { }, contains: () => false },
    setAttribute() { },
    appendChild() { },
    append() { },
    remove() { },
    addEventListener() { },
    querySelectorAll: () => [],
    querySelector: () => null
  });
  const doc = {
    body: { dataset: { page: 'super-admin' }, classList: { add() { }, toggle() { }, contains: () => false }, insertAdjacentHTML() { }, appendChild() { }, append() { }, addEventListener() { }, querySelector: () => null },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    documentElement: { dataset: {} },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'app-loader' ? makeNode('div') : null),
    createElement: (tag) => makeNode(tag),
    addEventListener() { }
  };
  const ctx = {
    window: null, document: doc, HTMLInputElement: class { }, HTMLFormElement: class { }, HTMLElement: class { },
    navigator: { onLine: true, serviceWorker: null },
    location: { href: 'http://localhost/super-admin.html', pathname: '/super-admin.html', origin: 'http://localhost', search: '', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: '', supabaseAnonKey: '' },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval: () => 0,
    requestAnimationFrame: (fn) => fn(), addEventListener() { }, console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const { validNamePart, validateNameFields, syncProfileNameMode, profileNeedsSetup } = ctx.window.Ipon;

  // Validator behavior
  assert.equal(validNamePart('zedrick'), false);
  assert.equal(validNamePart('zedrick', { formal: false }), true);
  assert.equal(validNamePart('zedrick dela cruz', { formal: false }), true);
  assert.equal(validNamePart('zedrick123', { formal: false }), false);
  assert.equal(validNamePart('z', { formal: false }), false);

  // Mock form with first/middle/last inputs
  const makeField = (form, name, labelText, required = true) => {
    const errEl = { classList: { contains: (c) => c === 'field-error' }, textContent: '', hidden: true, setAttribute() { } };
    const labelEl = { textContent: labelText };
    const container = {
      querySelector: (sel) => (sel === 'label' ? labelEl : errEl),
      append() { }
    };
    const attrs = new Map();
    const input = {
      form,
      name,
      value: '',
      required,
      disabled: false,
      title: '',
      labels: [labelEl],
      customValidity: '',
      setCustomValidity(msg) { this.customValidity = String(msg || ''); },
      toggleAttribute(k, force) { if (force) attrs.set(k, 'true'); else attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      getAttribute() { return ''; },
      closest() { return container; },
      focus() { },
      _labelEl: labelEl,
      _errEl: errEl
    };
    return input;
  };
  const form = { dataset: {}, elements: {} };
  form.elements.first_name = makeField(form, 'first_name', 'First name', true);
  form.elements.middle_name = makeField(form, 'middle_name', 'Middle name (optional)', false);
  form.elements.last_name = makeField(form, 'last_name', 'Last name', true);

  // Relaxed mode for Super Admin accepts all lowercase & blank last name
  syncProfileNameMode(form, true);
  assert.equal(form.dataset.relaxedNames, 'true');
  assert.equal(form.elements.last_name.required, false);
  assert.equal(form.elements.last_name._labelEl.textContent, 'Last name (optional)');
  form.elements.first_name.value = 'zedrick';
  form.elements.last_name.value = '';
  assert.equal(validateNameFields(form), true);
  assert.equal(form.elements.first_name.customValidity, '');
  assert.equal(form.elements.last_name.customValidity, '');

  // Digits still rejected for Super Admin
  form.elements.first_name.value = 'zedrick 2';
  assert.equal(validateNameFields(form), false);

  // Strict mode (regular roles) rejects all lowercase & blank last name
  syncProfileNameMode(form, false);
  assert.equal(form.elements.last_name.required, true);
  assert.equal(form.elements.last_name._labelEl.textContent, 'Last name');
  form.elements.first_name.value = 'zedrick';
  form.elements.last_name.value = '';
  assert.equal(validateNameFields(form), false);

  // Onboarding gate skips last name requirement & formal casing for SUPER_ADMIN only
  assert.equal(profileNeedsSetup({
    role: 'SUPER_ADMIN',
    first_name: 'zedrick',
    middle_name: null,
    last_name: null,
    contact_number: '09171234567'
  }), false);
  assert.equal(profileNeedsSetup({
    role: 'ADMIN',
    first_name: 'zedrick',
    middle_name: null,
    last_name: null,
    contact_number: '09171234567'
  }), true);
  assert.equal(profileNeedsSetup({
    role: 'MEMBER',
    first_name: 'zedrick',
    middle_name: null,
    last_name: 'cruz',
    contact_number: '09171234567'
  }), true);

  // Wiring & SQL migration parity
  assert.match(coreJs, /syncProfileNameMode\(document\.getElementById\('quick-profile-form'\),\s*role === 'SUPER_ADMIN'\)/);
  assert.match(coreJs, /p_last_name:\s*values\.get\('last_name'\)\s*\|\|\s*null/);
  assert.match(accountJs, /syncProfileNameMode\?\.\(profileForm,\s*isSuperAdmin\)/);
  assert.match(superAdminJs, /Ipon\.validateNameFields\(administratorForm\)/);
  assert.doesNotMatch(superAdminJs, /relaxedNames|syncProfileNameMode/);
  for (const token of [
    'last_name is not null or role = \'SUPER_ADMIN\'',
    'validated_name_part_mode',
    'v_is_super_admin := (new.role = \'SUPER_ADMIN\')',
    'v_is_super_admin := (v_role = \'SUPER_ADMIN\')',
    '20261115_067'
  ]) {
    assert.ok(migration067.includes(token), `migration 067 missing ${token}`);
    assert.ok(schema.includes(token), `schema.sql missing ${token}`);
  }
});

test('Android cold-start splash uses emerald #0b3428 with inline pulsing logo and no auto update popup', async () => {
  const stylesXml = read('android/app/src/main/res/values/styles.xml');
  const activityMainXml = read('android/app/src/main/res/layout/activity_main.xml');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const capConfig = JSON.parse(read('capacitor.config.json'));
  const androidCapConfig = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
  const loginHtml = read('login.html');
  const authJs = read('js/auth.js');
  const coreJs = read('js/core.js');

  // Native splash & window backgrounds avoid white flash on cold start
  assert.match(stylesXml, /<style name="AppTheme\.NoActionBar"[\s\S]*?<item name="android:background">@null<\/item>[\s\S]*?<item name="android:windowBackground">@color\/ic_launcher_background<\/item>/);
  assert.match(stylesXml, /<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?windowSplashScreenBackground[\s\S]*?windowSplashScreenAnimatedIcon[\s\S]*?postSplashScreenTheme/);
  assert.match(activityMainXml, /android:background="#0b3428"[\s\S]*?<WebView[\s\S]*?android:background="#0b3428"/);
  assert.match(mainActivity, /setBackgroundColor\(Color\.parseColor\("#0b3428"\)\)/);
  assert.equal(capConfig.backgroundColor, '#0b3428');
  assert.equal(androidCapConfig.backgroundColor, '#0b3428');
  assert.equal(androidCapConfig.appendUserAgent, 'myIPONApp/20');

  // Login splash uses inline SVG logo + gentle smooth pulse animation & honors reduced motion
  assert.match(loginHtml, /html:has\(#app-splash\),html:has\(#app-splash\) body\{background:#0b3428\}/);
  assert.match(loginHtml, /@keyframes splashPulse\{0%,100%\{transform:scale\(1\)\}50%\{transform:scale\(1\.06\)\}\}/);
  assert.match(loginHtml, /@media \(prefers-reduced-motion:reduce\)\{\.app-splash-logo\{animation:none\}\}/);
  assert.match(loginHtml, /id="app-splash"[\s\S]*?<svg class="app-splash-logo"[\s\S]*?<\/svg>[\s\S]*?<main/);
  assert.doesNotMatch(loginHtml.match(/<div id="app-splash"[\s\S]*?<main/)?.[0] || '', /icon-192\.png/);
  assert.match(authJs, /state\.session && state\.profile\?\.status === 'ACTIVE'[\s\S]*?clearTimeout\(splashSafetyTimer\)/);

  // Automatic app update dialog popup is disabled unless explicitly forced
  let fetchCount = 0;
  let dialogShown = false;
  const stubEl = () => ({
    dataset: {},
    style: { removeProperty() { } },
    classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
    setAttribute() { },
    removeAttribute() { },
    addEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML() { },
    prepend() { },
    append() { },
    appendChild() { },
    showModal() { dialogShown = true; },
    remove() { }
  });
  const loaderStub = { hidden: false, querySelector: () => ({ textContent: '' }), setAttribute() { }, removeAttribute() { } };
  const doc = {
    body: { ...stubEl(), dataset: { page: 'user' } },
    head: stubEl(),
    documentElement: { ...stubEl(), style: { setProperty() { }, removeProperty() { } } },
    createElement: () => stubEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: (id) => (id === 'app-loader' ? loaderStub : null),
    addEventListener() { }
  };
  const ctx = {
    URL, URLSearchParams, CustomEvent: class { }, Intl, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout() { return 1; },
    clearTimeout() { },
    fetch: async () => { fetchCount += 1; return { ok: true, json: async () => ({ version: '1.0.99', nativeBuild: 99 }) }; },
    navigator: { userAgent: 'Mozilla/5.0 myIPONApp/19', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/user.html', pathname: '/user.html', search: '' },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    addEventListener() { },
    document: doc,
    window: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  await ctx.window.Ipon.checkForAppUpdate();
  assert.equal(fetchCount, 0);
  assert.equal(dialogShown, false);
});

test('navigation shell preserves active role tabs, notification count, and user DP from pixel zero while loading', () => {
  const dashboardHtml = read('dashboard.html');
  const configJs = read('js/config.js');
  const heroPlatesCss = read('css/hero-plates.css');
  const coreJs = read('js/core.js');

  // config.js loads in <head> on dashboard.html and stamps dataset.shellRole pre-paint
  assert.match(dashboardHtml, /<head>[\s\S]*?<script src="js\/config\.js\?v=[^"]+"><\/script>[\s\S]*?<\/head>/);
  assert.doesNotMatch(dashboardHtml, /<\/dialog>[\s\S]*?js\/config\.js/);
  assert.match(configJs, /dataset\.shellRole\s*=\s*activeRole/);
  assert.match(heroPlatesCss, /html\[data-shell-role="MEMBER"\]\s+\.dashboard-sidebar\s+\.nav-link\[data-role="ADMIN"\][^{]*\{[^}]*display:none!important/);

  const makeStorage = (initial = {}) => {
    const store = new Map(Object.entries(initial));
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    };
  };

  // Case 1: dashboard.html static sidebar pre-hydrates MEMBER role, unread badge, and cached DP synchronously
  const adminLink = { dataset: { role: 'ADMIN' }, hidden: false };
  const memberLink = { dataset: { role: 'MEMBER' }, hidden: false };
  const badgeA = { textContent: '0', hidden: true };
  const badgeB = { textContent: '0', hidden: true };
  const presenceDot = { dataset: {}, classList: { add() { } } };
  const avatarSlot = {
    innerHTML: '<svg></svg>',
    closest: () => ({ querySelector: () => presenceDot }),
    querySelector: () => null
  };
  const sidebarUser = { innerHTML: '<strong>Checking session…</strong><small>ACCOUNT</small>' };
  const rootEl = { dataset: {}, style: { setProperty() { }, removeProperty() { } } };
  const storageDash = makeStorage({
    ipon_active_role: 'MEMBER',
    ipon_shell_snapshot: JSON.stringify({ userId: 'u1', role: 'MEMBER', fullName: 'Juan Dela Cruz', unreadCount: 3 }),
    ipon_shell_avatar: JSON.stringify({ userId: 'u1', avatarUrl: 'data:image/png;base64,AAA' })
  });
  const dashLoader = { hidden: false, querySelector: () => ({ textContent: '' }), setAttribute() { }, removeAttribute() { } };
  const stubNode = () => ({ dataset: {}, classList: { contains: () => false, add() { }, remove() { }, toggle() { } }, setAttribute() { }, removeAttribute() { }, addEventListener() { }, querySelector: () => null, querySelectorAll: () => [], prepend() { }, append() { }, appendChild() { }, style: { removeProperty() { } }, textContent: '' });
  const dashDoc = {
    body: {
      dataset: { page: 'dashboard' },
      classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
      insertAdjacentHTML() { },
      prepend() { },
      append() { },
      appendChild() { }
    },
    head: { insertAdjacentHTML() { }, append() { } },
    documentElement: rootEl,
    createElement: () => stubNode(),
    querySelector: (sel) => (sel === 'link[rel="manifest"]' ? {} : null),
    querySelectorAll: (sel) => {
      if (sel === '[data-role]') return [adminLink, memberLink];
      if (sel === '[data-notification-count]') return [badgeA, badgeB];
      if (sel === '.sidebar-user-avatar') return [avatarSlot];
      return [];
    },
    getElementById: (id) => (id === 'sidebar-user' ? sidebarUser : id === 'app-loader' ? dashLoader : null),
    addEventListener() { }
  };
  const dashCtx = {
    URL, URLSearchParams, CustomEvent: class { }, Intl, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    sessionStorage: storageDash,
    localStorage: storageDash,
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    setTimeout: () => 1,
    clearTimeout() { },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/dashboard.html', pathname: '/dashboard.html', search: '', hash: '' },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    addEventListener() { },
    document: dashDoc,
    window: null,
    console
  };
  dashCtx.window = dashCtx;
  vm.runInNewContext(coreJs, dashCtx, { filename: 'js/core.js' });

  assert.equal(rootEl.dataset.shellRole, 'MEMBER');
  assert.equal(adminLink.hidden, true);
  assert.equal(memberLink.hidden, false);
  assert.equal(badgeA.textContent, '3');
  assert.equal(badgeA.hidden, false);
  assert.equal(badgeB.hidden, false);
  assert.match(sidebarUser.innerHTML, /Juan Dela Cruz/);
  assert.match(sidebarUser.innerHTML, /My account/);
  assert.match(avatarSlot.innerHTML, /data:image\/png;base64,AAA/);

  // Case 2: #app-sidebar pages render cached badge, name, and avatar directly in mountShell() before requireAuth resolves
  const hostEl = {
    dataset: {},
    innerHTML: '',
    querySelectorAll: () => []
  };
  const userAvatarSlot = {
    innerHTML: '',
    closest: () => ({ querySelector: () => presenceDot }),
    querySelector: () => null
  };
  const userSidebarInfo = { innerHTML: '' };
  const userDoc = {
    body: {
      dataset: { page: 'user' },
      classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
      insertAdjacentHTML() { },
      prepend() { },
      append() { },
      appendChild() { }
    },
    head: { insertAdjacentHTML() { }, append() { }, appendChild() { } },
    documentElement: { dataset: {}, style: { setProperty() { }, removeProperty() { } } },
    createElement: () => stubNode(),
    querySelector: (sel) => (sel === 'link[rel="manifest"]' ? {} : null),
    querySelectorAll: (sel) => (sel === '.sidebar-user-avatar' ? [userAvatarSlot] : []),
    getElementById: (id) => {
      if (id === 'app-sidebar') return hostEl;
      if (id === 'sidebar-user') return userSidebarInfo;
      if (id === 'app-loader') return dashLoader;
      return null;
    },
    addEventListener() { }
  };
  const userCtx = {
    ...dashCtx,
    document: userDoc,
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/user.html', pathname: '/user.html', search: '', hash: '' },
    window: null
  };
  userCtx.window = userCtx;
  vm.runInNewContext(coreJs, userCtx, { filename: 'js/core.js' });

  assert.match(hostEl.innerHTML, /data-notification-count>3<\/b>/);
  assert.doesNotMatch(hostEl.innerHTML, /href="members\.html"/);
  assert.match(hostEl.innerHTML, /Juan Dela Cruz/);
  assert.match(userAvatarSlot.innerHTML, /data:image\/png;base64,AAA/);
});

test('Android v31 splash screen and progressive anti-bruteforce login protection work end-to-end', async () => {
  const stylesV31 = read('android/app/src/main/res/values-v31/styles.xml');
  const stylesBase = read('android/app/src/main/res/values/styles.xml');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const loginHtml = read('login.html');
  const authJs = read('js/auth.js');
  const migration = read('database/migrations/20261115_068_login_bruteforce_protection.sql');
  const schema = read('database/schema.sql');
  const edge = read('supabase/functions/manage-account/index.ts');

  // Native Android 12+ starting window & MainActivity splash continuity (zero white flash)
  assert.match(stylesBase, /<style name="AppTheme"[^>]*>[\s\S]*?@color\/ic_launcher_background/);
  assert.match(stylesV31, /android:windowSplashScreenBackground">@color\/ic_launcher_background/);
  assert.match(stylesV31, /android:windowSplashScreenAnimatedIcon">@mipmap\/ic_launcher_foreground/);
  assert.match(stylesV31, /android:forceDarkAllowed">false/);
  assert.match(mainActivity, /SplashScreen\.installSplashScreen\(this\);[\s\S]*?super\.onCreate\(savedInstanceState\);/);
  assert.match(mainActivity, /splashScreen\.setKeepOnScreenCondition/);
  assert.match(loginHtml, /html,body\{background:#0b3428\}/);
  assert.match(loginHtml, /id="auth-security-notice"[\s\S]*?id="auth-security-timer"[\s\S]*?id="auth-security-bar"/);

  // SQL & Edge progressive lockout schedule: 5 -> 3m (180s), 6 -> 10m (600s), 7 -> 30m (1800s), 8 -> 60m (3600s)
  for (const sqlText of [migration, schema]) {
    assert.match(sqlText, /create table if not exists public\.auth_login_throttles/);
    assert.match(sqlText, /when p_failed_attempts = p_threshold then 180/);
    assert.match(sqlText, /when p_failed_attempts = p_threshold \+ 1 then 600/);
    assert.match(sqlText, /when p_failed_attempts = p_threshold \+ 2 then 1800/);
    assert.match(sqlText, /when p_failed_attempts = p_threshold \+ 3 then 3600/);
    assert.match(sqlText, /revoke all on table public\.auth_login_throttles from public, anon, authenticated/);
    assert.match(sqlText, /grant execute on function public\.record_failed_login_attempt\(text, text\) to service_role/);
  }
  assert.match(edge, /body\.action === 'login-throttle-status'/);
  assert.match(edge, /body\.action === 'login-attempt'/);
  assert.match(edge, /check_login_throttle/);
  assert.match(edge, /record_failed_login_attempt/);
  assert.match(edge, /clear_login_throttle/);

  // Runtime VM verification of progressive escalation (1..4 -> warn, 5 -> 3m, 6 -> 10m, 7 -> 30m, 8 -> 1h, success clears)
  const makeEl = (id) => {
    const listeners = {};
    return {
      id,
      value: '',
      name: id.replace(/-/g, '_'),
      type: id === 'password' ? 'password' : 'text',
      hidden: false,
      disabled: false,
      textContent: '',
      innerHTML: '',
      required: false,
      autocomplete: '',
      dataset: {},
      style: { width: '' },
      attrs: {},
      validity: { valid: true },
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        toggle(c, force) { if (force === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); } else if (force) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      },
      elements: {},
      checkValidity() { return Boolean(this.value); },
      reportValidity() { return true; },
      setCustomValidity() { },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(evt, fn) { (listeners[evt] ||= []).push(fn); },
      dispatch(evt, payload = {}) {
        for (const fn of listeners[evt] || []) {
          return fn({ preventDefault() { }, ...payload });
        }
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      after() { },
      before() { },
      focus() { },
      close() { },
      showModal() { },
      reset() { this.value = ''; },
      offsetLeft: 0,
      offsetWidth: 80
    };
  };

  const els = new Map([
    'auth-form', 'auth-message', 'auth-submit',
    'auth-security-notice', 'auth-security-title', 'auth-security-detail',
    'auth-security-timer', 'auth-security-bar-wrap', 'auth-security-bar',
    'first-name-field', 'middle-name-field', 'last-name-field',
    'first-name', 'middle-name', 'last-name', 'email',
    'contact-number-field', 'contact-number', 'request-reason-field', 'request-reason',
    'password', 'password-confirmation-field', 'password-confirmation',
    'password-toggle', 'password-confirmation-toggle', 'forgot-password-open',
    'recovery-dialog', 'recovery-request-form', 'recovery-message',
    'show-login', 'show-signup', 'auth-tab-indicator', 'auth-title', 'auth-copy'
  ].map((id) => [id, makeEl(id)]));
  els.get('recovery-request-form').elements = { email: makeEl('recovery-email') };
  els.get('auth-submit').textContent = 'Sign in';

  const storage = new Map();
  let fakeNow = 1_794_700_000_000;
  let invokeCalls = 0;
  let simulatedFails = 0;
  let nextAllowedPassword = 'CorrectPassword!1';

  const FakeDate = class extends Date {
    constructor(...args) { super(args.length ? args[0] : fakeNow); }
    static now() { return fakeNow; }
  };

  const doc = {
    body: makeEl('body'),
    getElementById: (id) => els.get(id) || makeEl(id),
    querySelectorAll: () => [],
    addEventListener() { }
  };
  const IponMock = {
    init: async () => ({ configured: true, session: null, profile: null }),
    setLoading() { },
    setBusy(btn, busy, text) {
      if (!btn) return;
      btn.disabled = Boolean(busy);
      btn.classList.toggle('is-busy', Boolean(busy));
      if (busy && text) btn.textContent = text;
    },
    bindPasswordStrength: () => ({ element: makeEl('pw-strength'), update() { } }),
    nameRuleForField: () => ({ ruleMsg: '', placeholder: '' }),
    friendlyError: (e) => String(e?.message || e || 'Error'),
    broadcastAuthEvent() { },
    requiresMfaChallenge: async () => false,
    rpc: async () => null,
    homeForRole: () => 'dashboard.html',
    accountSetupUrl: () => null,
    invokeAccountFunction: async (body) => {
      if (body.action === 'login-throttle-status') return { ok: true, locked: false, retry_after_seconds: 0 };
      if (body.action !== 'login-attempt') return {};
      invokeCalls += 1;
      if (body.password === nextAllowedPassword) {
        simulatedFails = 0;
        return {
          ok: true,
          locked: false,
          session: { access_token: 'tok', refresh_token: 'ref' },
          user: { id: 'u1', email: body.email }
        };
      }
      simulatedFails += 1;
      const durations = { 5: 180, 6: 600, 7: 1800, 8: 3600 };
      const lockSec = durations[simulatedFails] || (simulatedFails >= 9 ? 7200 : 0);
      const nextSec = durations[simulatedFails + 1] || 7200;
      return {
        ok: false,
        locked: lockSec > 0,
        error: { code: 'invalid_credentials', message: 'Incorrect email or password.' },
        throttle: {
          locked: lockSec > 0,
          scope: 'EMAIL',
          failed_attempts: simulatedFails,
          threshold: 5,
          remaining_attempts: Math.max(0, 5 - simulatedFails),
          retry_after_seconds: lockSec,
          lock_duration_seconds: lockSec,
          next_lock_duration_seconds: nextSec
        }
      };
    },
    client: {
      auth: {
        setSession: async () => ({ data: { user: { id: 'u1', email: 'user@example.com' }, session: {} }, error: null }),
        signOut: async () => ({})
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'u1', role: 'MEMBER', status: 'ACTIVE', contact_number: '09171234567' }, error: null })
          })
        })
      })
    }
  };

  let replacedTo = null;
  const ctx = {
    document: doc,
    Ipon: IponMock,
    navigator: { onLine: true, standalone: false },
    location: { search: '', href: 'https://my-ipon.vercel.app/login.html', pathname: '/login.html', replace(u) { replacedTo = u; } },
    history: { replaceState() { } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    sessionStorage: {
      _m: new Map(),
      getItem(k) { return this._m.get(k) || null; },
      setItem(k, v) { this._m.set(k, String(v)); }
    },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, JSON, Error, RegExp, Promise,
    Date: FakeDate,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    matchMedia: () => ({ matches: false }),
    addEventListener() { },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(authJs, ctx, { filename: 'js/auth.js' });
  await new Promise((r) => setTimeout(r, 10));

  const emailEl = els.get('email');
  const passEl = els.get('password');
  const submitBtn = els.get('auth-submit');
  const noticeEl = els.get('auth-security-notice');
  const detailEl = els.get('auth-security-detail');
  const timerEl = els.get('auth-security-timer');
  const msgEl = els.get('auth-message');

  emailEl.value = 'tester@example.com';
  passEl.value = 'WrongPass1!';

  // Fail 1 & 2: error message shown, no security notice yet
  await els.get('auth-form').dispatch('submit');
  await els.get('auth-form').dispatch('submit');
  assert.equal(msgEl.textContent, 'Incorrect email or password.');
  assert.equal(noticeEl.hidden, true);

  // Fail 3 & 4: amber warning with exact remaining attempts
  await els.get('auth-form').dispatch('submit');
  assert.equal(noticeEl.hidden, false);
  assert.equal(noticeEl.dataset.state, 'warn');
  assert.match(detailEl.textContent, /2 attempts left/);

  await els.get('auth-form').dispatch('submit');
  assert.equal(noticeEl.dataset.state, 'warn');
  assert.match(detailEl.textContent, /1 attempt left/);

  // Fail 5: locked for 3 minutes (03:00), submit disabled
  await els.get('auth-form').dispatch('submit');
  assert.equal(noticeEl.dataset.state, 'locked');
  assert.equal(timerEl.textContent, '03:00');
  assert.equal(submitBtn.disabled, true);
  assert.equal(invokeCalls, 5);

  // Submitting again while still inside 3m cooldown is blocked client-side before backend
  await els.get('auth-form').dispatch('submit');
  assert.equal(invokeCalls, 5);

  // Wait 3 minutes -> fail 6th attempt -> escalates to 10 minutes (10:00)
  fakeNow += 181_000;
  await els.get('auth-form').dispatch('submit');
  assert.equal(invokeCalls, 6);
  assert.equal(noticeEl.dataset.state, 'locked');
  assert.equal(timerEl.textContent, '10:00');

  // Wait 10 minutes -> fail 7th attempt -> escalates to 30 minutes (30:00)
  fakeNow += 601_000;
  await els.get('auth-form').dispatch('submit');
  assert.equal(invokeCalls, 7);
  assert.equal(timerEl.textContent, '30:00');

  // Wait 30 minutes -> fail 8th attempt -> escalates to 1 hour (1:00:00)
  fakeNow += 1_801_000;
  await els.get('auth-form').dispatch('submit');
  assert.equal(invokeCalls, 8);
  assert.equal(timerEl.textContent, '1:00:00');

  // Wait 1 hour -> correct password succeeds & resets lockout
  fakeNow += 3_601_000;
  passEl.value = nextAllowedPassword;
  await els.get('auth-form').dispatch('submit');
  assert.equal(replacedTo, 'dashboard.html');
  assert.equal(noticeEl.hidden, true);
  assert.equal(submitBtn.disabled, false);
});

test('all notification types route to exact destination modals or highlighted targets across SQL, Edge, SW, Android, and all role pages', () => {
  const migration069 = read('database/migrations/20261115_069_notification_deep_links.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const dashboardJs = read('js/dashboard.js');
  const recordsJs = read('js/records.js');
  const userJs = read('js/user.js');
  const membersJs = read('js/members.js');
  const settingsJs = read('js/settings.js');
  const superAdminJs = read('js/super-admin.js');
  const manageAccount = read('supabase/functions/manage-account/index.ts');
  const sendPush = read('supabase/functions/send-push/index.ts');
  const sw = read('sw.js');
  const mainJava = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const css = read('css/app.css');

  // 1. SQL migration 069 & schema emit specific deep links for every notification type
  for (const sql of [migration069, schema]) {
    assert.match(sql, /\?review=/);
    assert.match(sql, /\?record=/);
    assert.match(sql, /\?member=/);
    assert.match(sql, /\?notice=/);
    assert.match(sql, /\?access_user=/);
    assert.match(sql, /\?feature_request=/);
    assert.match(sql, /\?bug_report=/);
    assert.match(sql, /\?announcement=/);
    assert.match(sql, /\?reminder=/);
    assert.match(sql, /\?exemption=/);
    assert.match(sql, /\?admin_request=/);
    assert.match(sql, /\?admin_user=/);
    assert.match(sql, /'dashboard\.html\?announcement=' \|\| new\.id::text/);
    assert.match(sql, /'super-admin\.html\?announcement=' \|\| v_announcement_id::text \|\| '#announcements'/);
  }

  // 2. Edge functions & service worker & Android MainActivity preserve deep links & group context
  assert.match(manageAccount, /link:\s*`dashboard\.html\?invite=\$\{encodeURIComponent\(actor\.group_id\)\}`/);
  assert.match(sendPush, /select\('id, recipient_id, group_id, type, title, message, link, dedupe_key, read_at, created_at'\)/);
  assert.match(sendPush, /notif\.type === 'RELEASE' && \/\^https\?:/);
  assert.match(sw, /const CACHE_NAME = 'ipon-shell-v(?:11|12|\d+)'/);
  assert.match(sw, /group_id:\s*payload\.group_id \?\? null/);
  assert.match(sw, /type:\s*'MYIPON_NOTIFICATION_CLICK'/);
  assert.match(mainJava, /\[a-zA-Z0-9_=&:%\.-]\+/);

  // 3. core.js fixes dialog ID bug, exports deep-link helpers, never injects synthetic push release notices or Download APK buttons, and opens announcement modal on card click
  assert.match(coreJs, /id="record-detail-dialog"/);
  assert.match(coreJs, /id="notice-detail-dialog"/);
  assert.doesNotMatch(coreJs, /#notifications-dialog/);
  assert.match(coreJs, /document\.getElementById\('notification-dialog'\)\?\.close\(\)/);
  assert.doesNotMatch(coreJs, /notification-download-row|Download APK|Download Android \(\.apk\)/);
  assert.match(coreJs, /\?release=\$\{encodeQueryValue\(ver\)\}/);
  assert.match(coreJs, /review_\$\{entry\.type\}/);
  assert.match(coreJs, /resolveNotificationTarget,\s*navigateNotificationTarget,\s*openRecordDetails,\s*openFeatureRequestDetails,\s*openPeriodNoticeModal,\s*openNoticeDetailModal,\s*highlightFocus,\s*consumeDeepLink/);

  // 4. All 6 authenticated pages register Ipon.consumeDeepLink handlers + user row attribute + focus styles
  for (const script of [dashboardJs, recordsJs, userJs, membersJs, settingsJs, superAdminJs]) {
    assert.match(script, /Ipon\.consumeDeepLink\(/);
  }
  assert.match(userJs, /<tr data-row-id="\$\{row\.id\}">/);
  assert.match(superAdminJs, /<tr data-user-id="\$\{profile\.id\}">/);
  assert.match(css, /\.is-highlight-focus\b/);
  assert.match(css, /\.notice-detail-dialog\b/);
});

test('notification deep-link runtime routes updates, reviews, reminders, and fallback notices without page reload on same view', async () => {
  const vm = await import('node:vm');
  const coreJs = read('js/core.js');

  const ids = new Map();
  const makeEl = (id, extra = {}) => {
    const node = {
      id,
      open: false,
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      innerHTML: '',
      className: '',
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      children: [],
      listeners: {},
      classList: {
        _set: new Set(),
        add(...cls) { cls.forEach((c) => this._set.add(c)); },
        remove(...cls) { cls.forEach((c) => this._set.delete(c)); },
        toggle(c, force) { if (force === undefined ? !this._set.has(c) : force) this._set.add(c); else this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      },
      showModal() { this.open = true; },
      show() { this.open = true; },
      close() { this.open = false; },
      focus() { },
      scrollIntoView() { },
      removeAttribute(k) { delete this[k]; },
      setAttribute(k, v) { this[k] = v; },
      appendChild(child) { this.children.push(child); return child; },
      replaceChildren(...nodes) { this.children = [...nodes]; },
      addEventListener(type, fn) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(fn);
      },
      dispatch(type, ev = {}) {
        const event = { target: this, preventDefault() { }, ...ev };
        if (type === 'click' && typeof this.onclick === 'function') this.onclick(event);
        for (const fn of this.listeners[type] || []) fn(event);
      },
      click() { this.dispatch('click'); },
      querySelector(sel) {
        if (sel.startsWith('#')) return ids.get(sel.slice(1)) || null;
        return this.children.find((c) => c.className?.includes(sel.replace('.', ''))) || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children || []) {
            if (sel === 'button' && c.tagName === 'BUTTON') out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      closest() { return null; },
      ...extra
    };
    if (id) ids.set(id, node);
    return node;
  };

  makeEl('app-loader');
  const notifDialog = makeEl('notification-dialog', { open: true });
  makeEl('record-detail-dialog');
  makeEl('record-detail-title');
  makeEl('record-detail-subtitle');
  const recordSummary = makeEl('record-detail-summary');
  const recordActions = makeEl('record-detail-actions');
  const noticeDialog = makeEl('notice-detail-dialog');
  const noticeTitle = makeEl('notice-detail-title');
  makeEl('notice-detail-subtitle');
  const noticeBody = makeEl('notice-detail-body');
  const noticeActions = makeEl('notice-detail-actions');
  makeEl('record-action-dialog');
  const decisionRadio = { value: 'CONFIRM' };
  const actionForm = makeEl('record-action-form', { reportValidity: () => true, elements: { decision: decisionRadio } });
  makeEl('record-action-step-edit');
  makeEl('record-action-step-confirm', { hidden: true });
  makeEl('record-action-title');
  makeEl('record-action-summary');
  makeEl('record-action-options');
  makeEl('record-action-reason-label');
  makeEl('record-action-help');
  const actionReason = makeEl('record-action-reason');
  makeEl('record-action-next');
  makeEl('record-action-back');
  const actionSubmit = makeEl('record-action-submit');
  makeEl('record-action-confirm-box');
  makeEl('record-action-confirm-heading');
  makeEl('record-action-confirm-text');
  makeEl('record-action-confirm-note');
  makeEl('record-action-error');
  const viewerDialog = makeEl('announcement-viewer-dialog');
  const viewerTitle = makeEl('announcement-viewer-title');
  makeEl('announcement-viewer-release-banner');
  makeEl('announcement-viewer-meta');
  makeEl('announcement-viewer-description');
  makeEl('announcement-viewer-release-features');
  makeEl('announcement-viewer-media');
  makeEl('announcement-viewer-delete');
  makeEl('announcement-viewer-reactions');
  makeEl('announcement-viewer-done');
  makeEl('announcement-viewer-close');
  makeEl('announcement-reactions-dialog');
  makeEl('announcement-reactions-tabs');
  makeEl('announcement-reactions-list');
  makeEl('announcement-reactions-title');
  makeEl('announcement-reactions-close');
  makeEl('announcement-compose-dialog');
  makeEl('announcement-compose-form');
  makeEl('announcement-compose-close');
  makeEl('announcement-compose-cancel');
  makeEl('announcement-media-input');
  makeEl('announcement-media-help');
  makeEl('announcement-media-previews');
  makeEl('announcement-submit');
  const announcementList = makeEl('announcement-list');

  const historyUpdates = [];
  const windowListeners = new Map();
  let hrefValue = 'https://my-ipon.vercel.app/dashboard.html';
  const locationObj = {
    get href() { return hrefValue; },
    set href(v) { hrefValue = v; },
    origin: 'https://my-ipon.vercel.app',
    protocol: 'https:',
    hostname: 'my-ipon.vercel.app',
    pathname: '/dashboard.html',
    search: '',
    hash: '',
    replace(v) { hrefValue = v; }
  };

  const rpcCalls = [];
  const sampleRelease = {
    id: 'ann-rel-240',
    announcement_type: 'RELEASE',
    release_version: '2.4.0',
    title: 'Version 2.4.0 is live',
    description: 'Added specific deep linking for every notification.',
    media_urls: [],
    created_at: '2026-11-15T00:00:00Z'
  };
  const makeQueryChain = (table) => {
    const state = { filters: [] };
    const chain = {
      select() { return chain; },
      eq(col, val) { state.filters.push([col, val]); return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() {
        if (table === 'contributions') {
          return {
            data: {
              id: 'rec-c1',
              amount: 500,
              payment_date: '2026-11-15',
              transaction_reference: '123456',
              payment_method: 'GCASH',
              notes: 'Nov payment',
              receipt_url: '',
              approval_status: 'PENDING',
              review_note: '',
              contribution_periods: {
                period_month: '2026-11-01',
                members: { full_name: 'Juan Dela Cruz', user_id: 'u-mem' }
              }
            },
            error: null
          };
        }
        if (table === 'v_announcements') {
          return { data: sampleRelease, error: null };
        }
        if (table === 'v_contribution_status') {
          return { data: { payment_status: 'UNPAID', paid_amount: 0, required_amount: 500, outstanding_amount: 500, due_date: '2026-11-30' }, error: null };
        }
        if (table === 'contribution_periods') {
          return { data: { id: 'p-1', due_date: '2026-11-30', is_exempt: false, exempt_reason: '', required_amount: 500 }, error: null };
        }
        if (table === 'notifications') {
          return { data: { id: 91, type: 'GENERAL', title: 'Group settings updated', message: 'Your group rules were updated.', link: 'dashboard.html', created_at: '2026-11-15T00:00:00Z' }, error: null };
        }
        return { data: null, error: null };
      },
      then(resolve) {
        if (table === 'v_announcements') return Promise.resolve({ data: [sampleRelease], error: null }).then(resolve);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      }
    };
    return chain;
  };

  const doc = {
    documentElement: { dataset: {} },
    body: {
      dataset: { page: 'dashboard' },
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      querySelectorAll: () => [],
      insertAdjacentHTML() { },
      appendChild() { },
      addEventListener() { }
    },
    head: { appendChild() { }, insertAdjacentHTML() { } },
    readyState: 'complete',
    getElementById: (id) => ids.get(id) || null,
    querySelector: (sel) => (sel.startsWith('#') ? ids.get(sel.slice(1)) || null : null),
    querySelectorAll: () => [],
    createElement: (tag) => makeEl('', { tagName: String(tag || 'div').toUpperCase() }),
    addEventListener() { }
  };

  class CustomEventPolyfill {
    constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
  }
  const sessionStore = new Map([
    ['myipon_active_notice', JSON.stringify({
      id: 91,
      type: 'GENERAL',
      title: 'Group settings updated',
      message: 'Your group rules were updated.',
      link: 'dashboard.html',
      created_at: '2026-11-15T00:00:00Z'
    })]
  ]);
  const swListeners = new Map();
  const ctx = {
    window: null,
    document: doc,
    CustomEvent: CustomEventPolyfill,
    Event: CustomEventPolyfill,
    HTMLInputElement: class { },
    HTMLFormElement: class { },
    HTMLElement: class { },
    navigator: {
      onLine: true,
      userAgent: 'Mozilla/5.0',
      serviceWorker: {
        controller: null,
        register: async () => ({ update: async () => { } }),
        addEventListener(type, fn) { swListeners.set(type, fn); }
      }
    },
    location: locationObj,
    history: {
      replaceState(_state, _title, nextUrl) {
        historyUpdates.push(nextUrl);
        const parsed = new URL(nextUrl, locationObj.origin);
        locationObj.pathname = parsed.pathname;
        locationObj.search = parsed.search;
        locationObj.hash = parsed.hash;
      }
    },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: {
      getItem: (k) => sessionStore.get(k) ?? null,
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: (k) => sessionStore.delete(k)
    },
    Notification: { permission: 'default' },
    MutationObserver: class { observe() { } },
    CSS: { escape: (v) => String(v) },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    supabase: {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => { }
        },
        from: (table) => makeQueryChain(table),
        rpc: async (fn, args) => {
          rpcCalls.push([fn, args]);
          return { data: null, error: null };
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: async () => { }
      })
    },
    Intl, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout: () => 0, clearTimeout() { }, setInterval: () => 0, clearInterval: () => 0,
    requestAnimationFrame: (fn) => fn(),
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      for (const fn of windowListeners.get(ev.type) || []) fn(ev);
      return true;
    },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const {
    resolveNotificationTarget,
    navigateNotificationTarget,
    consumeDeepLink,
    openRecordDetails,
    openPeriodNoticeModal,
    openNoticeDetailModal,
    bindAnnouncements
  } = ctx.window.Ipon;

  // A. Legacy external GitHub release link NEVER leaks to card tap target; routes inside app to specific release announcement
  assert.equal(
    resolveNotificationTarget({
      id: 'system-app-release-notice',
      type: 'RELEASE',
      title: 'Update available: v2.4.0',
      link: 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest'
    }, 'MEMBER'),
    'dashboard.html?release=2.4.0'
  );
  assert.equal(
    resolveNotificationTarget({
      id: 101,
      type: 'RELEASE',
      title: 'myIPON v2.4.0',
      link: 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk'
    }, 'SUPER_ADMIN'),
    'super-admin.html?release=2.4.0#announcements'
  );

  // B. Announcements controller + consumeDeepLink handles same-page release notification click without full reload
  const annController = bindAnnouncements({ listElement: announcementList });
  await annController.load();
  consumeDeepLink(async (params) => {
    const release = params.get('release') || '';
    if (release) return annController.openMatching({ releaseVersion: release });
    return false;
  });

  await navigateNotificationTarget({
    id: 'system-app-release-notice',
    type: 'RELEASE',
    title: 'Update available: v2.4.0',
    link: 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest'
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(notifDialog.open, false);
  assert.equal(hrefValue, 'https://my-ipon.vercel.app/dashboard.html');
  assert.equal(historyUpdates.at(-1), 'dashboard.html?release=2.4.0');
  assert.equal(viewerDialog.open, true);
  assert.match(viewerTitle.innerHTML, /Version 2\.4\.0 is live/);
  assert.doesNotMatch(ids.get('announcement-viewer-release-banner').innerHTML, /Download Android|Download APK|\.apk/i);

  // C. Payment reminder deep link opens #notice-detail-dialog with balance & "Submit contribution" CTA
  let submittedPaymentCtx = null;
  await openPeriodNoticeModal({
    mode: 'reminder',
    month: '2026-11',
    memberId: 'mem-1',
    onSubmitPayment: (payload) => { submittedPaymentCtx = payload; }
  });
  assert.equal(noticeDialog.open, true);
  assert.match(noticeTitle.textContent, /Contribution reminder/);
  assert.match(noticeBody.innerHTML, /500\.00/);
  const ctaButtons = noticeActions.querySelectorAll('button');
  assert.ok(ctaButtons.some((btn) => btn.textContent === 'Submit contribution'));
  ctaButtons.find((btn) => btn.textContent === 'Submit contribution').click();
  assert.deepEqual({ ...submittedPaymentCtx }, { monthStart: '2026-11-01', outstanding: 500 });

  // D. Record detail deep link renders record summary & actions, and openNoticeDetailModal restores cached notice
  await openRecordDetails('contribution', 'rec-c1', {
    allowReview: true,
    onUpdated: async () => { }
  });
  assert.match(recordSummary.innerHTML, /Juan Dela Cruz/);
  assert.match(recordSummary.innerHTML, /GCash/);
  assert.match(recordSummary.innerHTML, /For Nov 2026/);
  assert.match(recordSummary.innerHTML, /500\.00/);
  assert.match(recordSummary.innerHTML, /PENDING/);
  const recordBtns = recordActions.querySelectorAll('button');
  assert.ok(recordBtns.some((b) => b.textContent === 'Open discussion'));
  assert.ok(recordBtns.some((b) => b.textContent === 'Close'));

  // E. Notice detail modal restores cross-page notification copy & close works
  sessionStore.set('myipon_active_notice', JSON.stringify({
    id: 91,
    type: 'GENERAL',
    title: 'Group settings updated',
    message: 'Your group rules were updated.',
    link: 'dashboard.html',
    created_at: '2026-11-15T00:00:00Z'
  }));
  noticeDialog.open = false;
  const noticeResult = await openNoticeDetailModal(91);
  assert.equal(noticeDialog.open, true);
  assert.equal(noticeResult?.id, 'notice-detail-dialog');
  assert.equal(noticeTitle.textContent, 'Group settings updated');
  assert.match(noticeBody.innerHTML, /Your group rules were updated\./);
  noticeDialog.open = false;
  noticeActions.children = [];
  await openNoticeDetailModal({ id: 92, type: 'RELEASE', title: 'Update 2.5.0: Mobile polish', message: 'Published by Super Admin.' });
  assert.equal(noticeDialog.open, true);
  assert.equal(noticeActions.querySelectorAll('button').some((b) => /Download APK/i.test(b.textContent)), false);
  assert.equal(typeof swListeners.get('message'), 'function');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0][0], 'get_release_features');
  assert.equal(rpcCalls[0][1]?.p_release_version, '2.4.0');

  // F. Closing announcement viewer, switching groups, or reloading clears one-shot ?release=/?announcement= URL state
  ctx.history.replaceState(null, '', 'dashboard.html?release=2.4.0');
  viewerDialog.close();
  viewerDialog.dispatch('close');
  assert.equal(locationObj.search, '');
  assert.equal(historyUpdates.at(-1), '/dashboard.html');

  ctx.history.replaceState(null, '', 'dashboard.html?announcement=ann-1#announcements');
  assert.equal(locationObj.search, '?announcement=ann-1');
  await ctx.window.Ipon.switchActiveGroup('group-2');
  assert.equal(locationObj.search, '');
  assert.equal(locationObj.hash, '');

  viewerDialog.open = false;
  locationObj.href = 'https://my-ipon.vercel.app/dashboard.html?release=2.4.0#announcements';
  ctx.history.replaceState(null, '', 'dashboard.html?release=2.4.0#announcements');
  consumeDeepLink(async (params) => {
    const release = params.get('release') || '';
    if (release) return annController.openMatching({ releaseVersion: release });
    return false;
  });
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(viewerDialog.open, true);
  assert.equal(locationObj.search, '');
  assert.equal(locationObj.hash, '');
});

test('audit log renders plain-language summaries and clean field-level Before/After diffs without raw column names or base64 dumps', () => {
  const auditHtml = read('audit.html');
  const auditJs = read('js/audit.js');
  const superAdminJs = read('js/super-admin.js');
  const css = read('css/app.css');

  assert.match(auditHtml, /id="audit-detail-changes"/);
  assert.doesNotMatch(auditHtml, /<pre\s+id="audit-detail-before"/);
  assert.match(auditJs, /Ipon\.formatAuditEntry\(/);
  assert.match(auditJs, /Ipon\.collectAuditLookupsFromRows\(/);
  assert.match(auditJs, /data-label="Summary"/);
  assert.doesNotMatch(auditJs, /Changed: \$\{/);
  assert.doesNotMatch(auditJs, /JSON\.stringify\(row\.old_data/);
  assert.match(superAdminJs, /Ipon\.auditActionLabel/);
  assert.match(css, /\.audit-diff-card/);
  assert.match(css, /\.audit-diff-detail\.is-reason/);
  assert.match(css, /\.audit-diff-media/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.audit-diff-card/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.audit-diff-detail\.is-reason/);
  assert.match(auditJs, /change\.display === 'detail'/);
  assert.match(auditJs, /class="audit-diff-detail/);

  const coreSrc = read('js/core.js');
  const makeNode = (id) => ({
    id,
    innerHTML: '',
    textContent: '',
    hidden: false,
    dataset: {},
    className: '',
    children: [],
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    style: { setProperty() { }, removeProperty() { } },
    setAttribute() { },
    removeAttribute() { },
    getAttribute: () => '',
    appendChild() { },
    append() { },
    prepend() { },
    insertAdjacentHTML() { },
    addEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const doc = {
    documentElement: { setAttribute() { }, removeAttribute() { }, dataset: {}, classList: { add() { }, remove() { }, toggle() { } }, style: { setProperty() { }, removeProperty() { } } },
    body: { dataset: {}, classList: { add() { }, remove() { }, toggle() { }, contains: () => false }, appendChild() { }, append() { }, insertAdjacentHTML() { }, addEventListener() { }, querySelector: () => null },
    head: { appendChild() { }, insertAdjacentHTML() { }, querySelector: () => null },
    createElement: (tag) => makeNode(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { }
  };
  const ctx = vm.createContext({
    console,
    Date,
    Math,
    Intl,
    JSON,
    Map,
    Set,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Promise,
    Error,
    URL,
    RegExp,
    setTimeout,
    clearTimeout,
    document: doc,
    window: {
      location: { pathname: '/audit.html', search: '', hash: '' },
      IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon' },
      addEventListener() { },
      dispatchEvent() { },
      CustomEvent: class CustomEvent { },
      matchMedia: () => ({ matches: false, addEventListener() { } })
    },
    navigator: { onLine: true, serviceWorker: null },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    location: { pathname: '/audit.html', search: '', hash: '', replace() { } },
    history: { replaceState() { } },
    supabase: { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() { } } }) }
  });
  ctx.globalThis = ctx;
  ctx.self = ctx.window;
  vm.runInContext(coreSrc, ctx, { filename: 'js/core.js' });
  const Ipon = ctx.window.Ipon;

  const baseLookups = {
    profiles: new Map([['u-admin', 'Zedrick De Monteverde']]),
    members: new Map([['m-1', 'Juan'], ['m-old', 'Juan Dela Cruz']]),
    groups: new Map([['g-new', 'Ipon Barkada']]),
    periods: new Map([['p-1', { period_month: '2026-11-01', member_id: 'm-1' }]])
  };

  // 1. Name rename ("Juan" -> "Jumoi") shows exact Before/After names with zero raw keys
  const renameEntry = Ipon.formatAuditEntry({
    id: 101,
    table_name: 'members',
    record_id: 'm-1',
    action: 'UPDATE',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T02:39:00Z',
    old_data: { id: 'm-1', full_name: 'Juan', first_name: 'Juan', last_name: 'Santos', status: 'ACTIVE', updated_at: '2026-11-14T10:00:00Z' },
    new_data: { id: 'm-1', full_name: 'Jumoi', first_name: 'Jumoi', last_name: 'Santos', status: 'ACTIVE', updated_at: '2026-11-15T02:39:00Z' }
  }, baseLookups);
  assert.equal(renameEntry.tableLabel, 'Member');
  assert.equal(renameEntry.actionLabel, 'Updated');
  assert.equal(renameEntry.summary, 'Renamed member from "Juan" to "Jumoi"');
  assert.equal(renameEntry.changes.length, 1);
  assert.equal(renameEntry.changes[0].label, 'Full name');
  assert.equal(renameEntry.changes[0].before.text, 'Juan');
  assert.equal(renameEntry.changes[0].after.text, 'Jumoi');

  // 2. Group/member switch on profile suppresses unchanged huge base64 avatar and avoids group_id/member_id strings
  const longAvatar = `data:image/jpeg;base64,${'A'.repeat(400)}`;
  const profileSwitchEntry = Ipon.formatAuditEntry({
    id: 102,
    table_name: 'profiles',
    record_id: 'u-admin',
    action: 'UPDATE',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T02:39:00Z',
    old_data: { id: 'u-admin', full_name: 'Zedrick De Monteverde', role: 'ADMIN', group_id: '10865ab8-e651-4af1-82b8-6b2d4fd5fcd2', member_id: 'm-old', avatar_url: longAvatar, updated_at: 't1' },
    new_data: { id: 'u-admin', full_name: 'Zedrick De Monteverde', role: 'ADMIN', group_id: 'g-new', member_id: null, avatar_url: longAvatar, updated_at: 't2' }
  }, baseLookups);
  assert.equal(profileSwitchEntry.tableLabel, 'Account');
  assert.equal(profileSwitchEntry.summary, 'Switched active group to "Ipon Barkada"');
  assert.doesNotMatch(profileSwitchEntry.summary, /group_id|member_id|profiles|UPDATE/i);
  assert.equal(profileSwitchEntry.changes.length, 2);
  assert.equal(profileSwitchEntry.changes[0].label, 'Active savings group');
  assert.equal(profileSwitchEntry.changes[0].before.text, 'Savings group (10865ab8)');
  assert.equal(profileSwitchEntry.changes[0].after.text, 'Ipon Barkada');
  assert.equal(profileSwitchEntry.changes[1].label, 'Linked member');
  assert.equal(profileSwitchEntry.changes[1].before.text, 'Juan Dela Cruz');
  assert.equal(profileSwitchEntry.changes[1].after.text, 'Not linked');

  // 3. Avatar change renders safe image preview metadata instead of base64 text
  const avatarChangedEntry = Ipon.formatAuditEntry({
    id: 103,
    table_name: 'profiles',
    record_id: 'u-admin',
    action: 'UPDATE',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T03:00:00Z',
    old_data: { id: 'u-admin', full_name: 'Zedrick De Monteverde', avatar_url: null },
    new_data: { id: 'u-admin', full_name: 'Zedrick De Monteverde', avatar_url: longAvatar }
  }, baseLookups);
  assert.equal(avatarChangedEntry.summary, 'Updated profile photo');
  assert.equal(avatarChangedEntry.changes[0].label, 'Profile photo');
  assert.equal(avatarChangedEntry.changes[0].before.kind, 'empty');
  assert.equal(avatarChangedEntry.changes[0].after.kind, 'image');
  assert.equal(avatarChangedEntry.changes[0].after.src, longAvatar);

  // 4. Contribution confirmation formats currency, enum labels, and action attribution without Before/After clutter
  const confirmEntry = Ipon.formatAuditEntry({
    id: 104,
    table_name: 'contributions',
    record_id: 'c-1',
    action: 'CONFIRM',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T03:05:00Z',
    old_data: { id: 'c-1', contribution_period_id: 'p-1', amount: 500, approval_status: 'PENDING', reviewed_by: null },
    new_data: { id: 'c-1', contribution_period_id: 'p-1', amount: 500, approval_status: 'CONFIRMED', reviewed_by: 'u-admin', reviewed_at: '2026-11-15T03:05:00Z' }
  }, baseLookups);
  assert.equal(confirmEntry.actionLabel, 'Confirmed');
  assert.match(confirmEntry.summary, /Confirmed ₱500\.00 addition for Juan/);
  assert.equal(confirmEntry.changes[0].label, 'Approval status');
  assert.equal(confirmEntry.changes[0].display, 'diff');
  assert.equal(confirmEntry.changes[0].before.text, 'Pending review');
  assert.equal(confirmEntry.changes[0].after.text, 'Confirmed');
  assert.equal(confirmEntry.changes[1].label, 'Reviewed by');
  assert.equal(confirmEntry.changes[1].display, 'detail');
  assert.equal(confirmEntry.changes[1].detailTag, 'Recorded by');
  assert.equal(confirmEntry.changes[1].detailValue.text, 'Zedrick De Monteverde');
  assert.equal(confirmEntry.changes[1].after.text, 'Zedrick De Monteverde');

  // 5. Soft-delete / move to recovery bin shows Removal reason & Removed by as single detail cards (no Before/After) and skips redundant updated_by
  const deleteBinEntry = Ipon.formatAuditEntry({
    id: 105,
    table_name: 'members',
    record_id: 'm-1',
    action: 'UPDATE',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T03:10:00Z',
    old_data: { id: 'm-1', full_name: 'Juan', status: 'ACTIVE', deleted_at: null, deleted_by: null, delete_reason: null, updated_by: 'u-prev' },
    new_data: { id: 'm-1', full_name: 'Juan', status: 'ACTIVE', deleted_at: '2026-11-15T03:10:00Z', deleted_by: 'u-admin', delete_reason: 'Duplicate member entry', updated_by: 'u-admin' }
  }, baseLookups);
  assert.equal(deleteBinEntry.summary, 'Moved Juan to recovery bin');
  assert.equal(deleteBinEntry.changes.length, 2);
  assert.equal(deleteBinEntry.changes[0].label, 'Removal reason');
  assert.equal(deleteBinEntry.changes[0].display, 'detail');
  assert.equal(deleteBinEntry.changes[0].detailTag, 'Reason');
  assert.equal(deleteBinEntry.changes[0].detailTone, 'reason');
  assert.equal(deleteBinEntry.changes[0].detailValue.text, 'Duplicate member entry');
  assert.equal(deleteBinEntry.changes[1].label, 'Removed by');
  assert.equal(deleteBinEntry.changes[1].display, 'detail');
  assert.equal(deleteBinEntry.changes[1].detailTag, 'Recorded by');
  assert.equal(deleteBinEntry.changes[1].detailValue.text, 'Zedrick De Monteverde');

  // 6. Voiding a confirmed entry uses Before/After on Approval status, and single detail cards for Void reason & Voided by
  const voidEntry = Ipon.formatAuditEntry({
    id: 106,
    table_name: 'contributions',
    record_id: 'c-1',
    action: 'VOID',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T03:11:00Z',
    old_data: { id: 'c-1', contribution_period_id: 'p-1', amount: 500, approval_status: 'CONFIRMED', voided_by: null, voided_at: null, void_reason: null },
    new_data: { id: 'c-1', contribution_period_id: 'p-1', amount: 500, approval_status: 'VOIDED', voided_by: 'u-admin', voided_at: '2026-11-15T03:11:00Z', void_reason: 'Encoded twice' }
  }, baseLookups);
  assert.equal(voidEntry.changes[0].label, 'Approval status');
  assert.equal(voidEntry.changes[0].display, 'diff');
  assert.equal(voidEntry.changes[1].label, 'Void reason');
  assert.equal(voidEntry.changes[1].display, 'detail');
  assert.equal(voidEntry.changes[1].detailValue.text, 'Encoded twice');
  assert.equal(voidEntry.changes[2].label, 'Voided by');
  assert.equal(voidEntry.changes[2].display, 'detail');

  // 7. Restoring from bin shows cleared prior values without a fake "After: None" diff, while editing an existing note still shows Before/After
  const restoreEntry = Ipon.formatAuditEntry({
    id: 107,
    table_name: 'members',
    record_id: 'm-1',
    action: 'UPDATE',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T03:12:00Z',
    old_data: { id: 'm-1', full_name: 'Juan', deleted_at: '2026-11-15T03:10:00Z', deleted_by: 'u-admin', delete_reason: 'Duplicate member entry' },
    new_data: { id: 'm-1', full_name: 'Juan', deleted_at: null, deleted_by: null, delete_reason: null }
  }, baseLookups);
  assert.equal(restoreEntry.summary, 'Restored Juan from recovery bin');
  assert.equal(restoreEntry.changes[0].display, 'detail');
  assert.equal(restoreEntry.changes[0].detailTag, 'Previously recorded');
  assert.equal(restoreEntry.changes[0].detailTone, 'cleared');
  assert.equal(restoreEntry.changes[0].detailValue.text, 'Duplicate member entry');

  const editedNoteEntry = Ipon.formatAuditEntry({
    id: 108,
    table_name: 'contributions',
    record_id: 'c-1',
    action: 'UPDATE',
    changed_by: 'u-admin',
    changed_at: '2026-11-15T03:13:00Z',
    old_data: { id: 'c-1', review_note: 'Blurry screenshot' },
    new_data: { id: 'c-1', review_note: 'Verified clearer receipt' }
  }, baseLookups);
  assert.equal(editedNoteEntry.changes[0].display, 'diff');
  assert.equal(editedNoteEntry.changes[0].before.text, 'Blurry screenshot');
  assert.equal(editedNoteEntry.changes[0].after.text, 'Verified clearer receipt');
});

test('migration 070 drops all stale overloaded RPC signatures and core passes explicit create_announcement arguments', () => {
  const migration070 = read('database/migrations/20261115_070_drop_overloaded_rpc_signatures.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const expectedDrops = [
    'create_announcement(uuid, text, text, jsonb)',
    'create_member(text, text, text, text, date, numeric, text)',
    'update_member(uuid, text, text, text, text, numeric, text)',
    'update_contribution(uuid, numeric, date, text, text)',
    'update_expense(uuid, date, numeric, text, text, text, text, text)',
    'update_withdrawal(uuid, date, numeric, text, text, text, text, text)',
    'update_own_profile(text, text, text, text)'
  ];
  for (const sig of expectedDrops) {
    assert.ok(migration070.includes(`drop function if exists public.${sig};`), `missing drop in 070 for ${sig}`);
    assert.ok(schema.includes(`drop function if exists public.${sig};`), `missing drop in schema.sql for ${sig}`);
  }
  assert.match(migration070, /grant execute on function public\.create_announcement\(uuid, text, text, jsonb, text, text\) to authenticated;/i);
  assert.match(migration070, /notify pgrst, 'reload schema';/i);
  assert.match(migration070, /'20261115_070'/);
  assert.match(schema, /grant execute on function public\.create_announcement\(uuid, text, text, jsonb, text, text\) to authenticated;/i);
  assert.doesNotMatch(schema, /grant execute on function public\.create_announcement\(uuid, text, text, jsonb\) to authenticated;/i);
  assert.match(schema, /'20261115_070'/);
  assert.match(core, /rpc\('create_announcement',\s*\{[\s\S]*p_announcement_type:\s*'GENERAL'[\s\S]*p_release_version:\s*null/);
});

test('migration 071 enforces login activation before official membership, fixes deleted_at RLS, and keeps member counts consistent', () => {
  const migration071 = read('database/migrations/20261115_071_member_login_activation_and_count_integrity.sql');
  const schema = read('database/schema.sql');
  const manageAccountEdge = read('supabase/functions/manage-account/index.ts');
  const authJs = read('js/auth.js');
  const coreJs = read('js/core.js');
  const membersHtml = read('members.html');
  const membersJs = read('js/members.js');
  const dashboardJs = read('js/dashboard.js');
  const recordsJs = read('js/records.js');
  const reportsJs = read('js/reports.js');
  const savingsJs = read('js/savings.js');
  const settingsJs = read('js/settings.js');
  const css = read('css/app.css');

  for (const sql of [migration071, schema]) {
    assert.match(sql, /activation_status text not null default 'PENDING'/i);
    assert.match(sql, /check \(activation_status in \('PENDING', 'ACTIVE'\)\)/i);
    assert.match(sql, /create policy members_select on public\.members[\s\S]*deleted_at is null[\s\S]*public\.current_user_role\(\) in \('ADMIN', 'TREASURER', 'MEMBER'\)/i);
    assert.match(sql, /create or replace function public\.activate_member_record\(/i);
    assert.match(sql, /create or replace function public\.activate_own_pending_account\(\)[\s\S]*activate_member_record\(/i);
    assert.match(sql, /create or replace function public\.get_my_groups\(\)[\s\S]*m\.activation_status = 'ACTIVE'[\s\S]*m\.deleted_at is null/i);
    assert.match(sql, /create or replace view public\.v_contribution_status[\s\S]*m\.activation_status = 'ACTIVE'/i);
    assert.match(sql, /create or replace function public\.delete_member\([\s\S]*delete from public\.contribution_periods[\s\S]*update public\.group_memberships[\s\S]*set status = 'DISABLED'[\s\S]*role <> 'MEMBER'/i);
    assert.match(sql, /'20261115_071'/);
  }
  assert.match(migration071, /notify pgrst, 'reload schema';/i);

  // Invite verification stays gated on actual login before marking members official ACTIVE
  assert.match(manageAccountEdge, /accept-email-invite[\s\S]*pending_login:\s*true/);
  assert.match(manageAccountEdge, /activateUserAndMembership[\s\S]*last_sign_in_at[\s\S]*\.from\('members'\)/);
  assert.match(authJs, /if \(profile\?\.role !== 'SUPER_ADMIN'\)\s*\{\s*\/\/[^\n]*\n\s*await Ipon\.rpc\('activate_own_pending_account'\)/);
  assert.match(coreJs, /client\.rpc\('activate_own_pending_account'\)/);

  // Every panel counting or tracking active contributors excludes soft-deleted and pending-login members
  for (const [label, src] of [
    ['dashboard.js', dashboardJs],
    ['records.js', recordsJs],
    ['reports.js', reportsJs],
    ['savings.js', savingsJs]
  ]) {
    assert.match(src, /\.from\('members'\)\.select\([\s\S]*?\.eq\('status',\s*'ACTIVE'\)\.eq\('activation_status',\s*'ACTIVE'\)\.is\('deleted_at',\s*null\)/, `${label} must count only non-deleted official active members`);
  }
  assert.match(settingsJs, /\.from\('members'\)\.select\([\s\S]*?activation_status[\s\S]*?\.is\('deleted_at',\s*null\)/);

  // Member directory surfaces clear active vs pending-login breakdown and safe mobile stacking
  assert.match(membersHtml, /id="member-count"[^>]*role="status"/);
  assert.match(membersHtml, /<option value="PENDING">Pending login<\/option>/);
  assert.match(membersJs, /function memberStatusMeta\(member\)/);
  assert.match(membersJs, /\.from\('members'\)\.select\('\*',\s*\{\s*count:\s*'exact'\s*\}\)\.is\('deleted_at',\s*null\)/);
  assert.match(membersJs, /pendingLoginCount/);
  assert.match(css, /\.member-state-stack/);

  const migration072 = read('database/migrations/20261115_072_drop_remaining_rpc_overloads.sql');
  assert.match(migration072, /drop function if exists public\.create_member\(text, text, text, text, date, numeric, text\);/i);
  assert.match(migration072, /'20261115_072'/);
  assert.match(schema, /'20261115_072'/);
});

test('desktop dashboard calendar maintains fixed row heights and announcement panel scrolls cleanly inside right rail', () => {
  const heroCss = read('css/hero-plates.css');
  const appCss = read('css/app.css');

  // Calendar grid keeps fixed row height on desktop and never stretches to match right rail announcements
  assert.match(heroCss, /\.calendar-card\s*\{[^}]*flex:\s*0 0 auto;/);
  assert.match(heroCss, /\.calendar-board\s*\{[^}]*flex:\s*0 0 auto;/);
  assert.match(heroCss, /\.calendar-week\s*\{[^}]*flex:\s*0 0 90px;\s*height:\s*90px;\s*min-height:\s*90px;/);
  assert.match(heroCss, /@media \(max-width:860px\)[\s\S]*?\.calendar-week\s*\{[^}]*height:\s*auto;\s*min-height:\s*56px;/);

  // Desktop 3-column grid prevents right rail from inflating row height while aligning bottom with calendar card
  assert.match(heroCss, /@media \(min-width:1181px\)\s*\{[\s\S]*?\.comp-frame\s*\{\s*grid-template-rows:\s*auto minmax\(0,1fr\);\s*\}[\s\S]*?\.review-column\s*\{[^}]*contain:\s*size;\s*overflow:\s*hidden;[^}]*\}[\s\S]*?\.announcement-panel\s*\{[^}]*flex:\s*1 1 0;\s*min-height:\s*220px;/);

  // Announcement list scrolls internally instead of rendering all cards inline/stacked or squishing cards
  assert.match(appCss, /\.announcement-panel \.announcement-list\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
  assert.match(appCss, /\.announcement-panel \.announcement-item\{[^}]*flex:\s*0 0 auto;[^}]*height:\s*260px;/);
  assert.match(appCss, /\.announcement-item\{[^}]*height:\s*260px;/);
  assert.match(appCss, /\.announcement-item-head \.announcement-item-title\{[^}]*-webkit-line-clamp:\s*3;/);
  assert.match(appCss, /\.notification-item\{[^}]*height:\s*106px;/);
  assert.match(appCss, /\.notification-item p\{[^}]*-webkit-line-clamp:\s*2;/);
});

test('migration 075 restores group summary RPC and read-only group transparency RLS for members', () => {
  const migration075 = read('database/migrations/20261115_075_restore_member_group_visibility_and_summary.sql');
  const schema = read('database/schema.sql');

  for (const sql of [migration075, schema]) {
    assert.match(sql, /'20261115_075'/);
  }

  assert.match(migration075, /create or replace function public\.get_savings_summary\(\)/i);
  assert.match(migration075, /when ctx\.role_name not in \('ADMIN', 'TREASURER', 'MEMBER'\) or ctx\.group_id is null then null/i);
  assert.doesNotMatch(migration075, /is_treasurer_or_admin/i);
  for (const policy of [
    'members_select',
    'contribution_periods_select',
    'contributions_select',
    'expenses_select',
    'withdrawals_select'
  ]) {
    assert.match(migration075, new RegExp(`create policy ${policy} on public\\.\\w+ for select to authenticated[\\s\\S]*?current_user_role\\(\\) in \\('ADMIN', 'TREASURER', 'MEMBER'\\)`, 'i'));
  }
  assert.match(migration075, /create policy members_select on public\.members[\s\S]*?deleted_at is null/i);
});

test('migration 076, 077, Edge Function, shell integration, and UI implement Messaging & Social Connections cleanly with Super Admin excluded', async () => {
  const migration076 = read('database/migrations/20261115_076_messaging_and_social_system.sql');
  const migration077 = read('database/migrations/20261115_077_messaging_delivery_receipts.sql');
  const schema = read('database/schema.sql');
  const edge = read('supabase/functions/manage-account/index.ts');
  const core = read('js/core.js');
  const messagesJs = read('js/messages.js');
  const sw = read('sw.js');
  const appCss = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  const vercel = read('vercel.json');
  const manifest = read('android/app/src/main/AndroidManifest.xml');

  // 1. SQL schema & Super Admin complete exclusion + MFA + private storage bucket
  for (const sql of [migration076, schema]) {
    assert.match(sql, /'20261115_076'/);
    assert.match(sql, /create or replace function public\.is_messaging_eligible\(/i);
    assert.match(sql, /role in \('ADMIN', 'TREASURER', 'MEMBER'\)/i);
    assert.match(sql, /create or replace function public\.is_user_blocked_between\(/i);
  }
  for (const sql of [migration077, schema]) {
    assert.match(sql, /'20261115_077'/);
    assert.match(sql, /values\s*\(\s*v_msg\.id,\s*v_peer_id,\s*null,\s*null\s*\)/i);
    assert.match(sql, /create or replace function public\.mark_messages_delivered\(/i);
    assert.match(sql, /delivered_at\s*=\s*coalesce\(mr\.delivered_at,\s*now\(\)\)/i);
  }
  assert.match(migration077, /alter table public\.message_receipts\s+alter column delivered_at drop not null/i);
  assert.match(migration077, /grant execute on function[\s\S]*?public\.mark_messages_delivered\(uuid\)[\s\S]*?to authenticated/i);
  for (const tbl of [
    'blocked_users',
    'friend_requests',
    'friendships',
    'conversations',
    'conversation_participants',
    'messages',
    'message_attachments',
    'message_reactions',
    'message_receipts',
    'call_sessions'
  ]) {
    assert.match(migration076, new RegExp(`create policy social_exclude_super_admin on public\\.${tbl}[\\s\\S]*?as restrictive[\\s\\S]*?mfa_access_allowed\\(\\)`, 'i'));
    assert.match(migration076, new RegExp(`'${tbl}'`, 'i'));
  }
  assert.match(migration076, /execute format\('alter publication supabase_realtime add table public\.%I', v_tbl\)/i);
  assert.match(migration076, /values\s*\('chat-attachments',\s*'chat-attachments',\s*false,\s*52428800/i);
  assert.match(migration076, /when o\.sender_id = v_uid and v_share_receipts then/i);

  // 2. Edge Function attachment signing and cleanup (calls/VC disabled)
  for (const action of ['chat-upload-urls', 'chat-view-urls', 'chat-cleanup-media']) {
    assert.match(edge, new RegExp(`body\\.action === '${action}'`));
  }
  assert.doesNotMatch(edge, /webrtc-ice-servers|TURN_SERVER_URLS/);
  assert.match(edge, /ALLOWED_CHAT_EXT_RE/);
  assert.match(edge, /BLOCKED_DISCUSSION_EXT_RE/);
  assert.match(edge, /signedUrl:\s*data\.signedUrl/);

  // 3. Reserved slot integration across shell & desktop dashboard (excluded from Super Admin)
  assert.match(read('dashboard.html'), /id="dashboard-group-actions"[\s\S]*?data-messages-open[\s\S]*?data-notifications-open/);
  assert.doesNotMatch(read('super-admin.html'), /js\/messages\.js/);
  for (const page of ['dashboard.html', 'user.html', 'members.html', 'contributions.html', 'expenses.html', 'withdrawals.html', 'savings.html', 'reports.html', 'audit.html', 'settings.html', 'account.html']) {
    assert.match(read(page), /js\/messages\.js\?v=\d+/);
  }
  assert.match(core, /data-messages-open/);
  assert.match(core, /function syncMessagesBadges\(/);
  assert.match(core, /function setOnlineVisibility\(/);
  assert.match(core, /window\.IponMessages\?\.openFromNotification/);
  assert.match(core, /role !== 'SUPER_ADMIN'[\s\S]*?window\.IponMessages\?\.init\?\.\(profile\)/);
  assert.match(sw, /'js\/messages\.js'/);

  // 4. Frontend messaging features, direct uploads, & camera/VC removal
  assert.match(messagesJs, /xhr\.send\(entry\.file\)/);
  assert.doesNotMatch(messagesJs, /prepareImageDataUrl|canvas\.toBlob/);
  assert.doesNotMatch(messagesJs, /CallManager|data-start-call|msg-call-dialog|msg-incoming-call-dialog/);
  assert.match(messagesJs, /download_path:\s*path/);
  assert.match(messagesJs, /ev\.isComposing\s*\|\|\s*ev\.keyCode\s*===\s*229/);
  assert.match(messagesJs, /id="msg-profile-popover"/);
  assert.match(messagesJs, /ipon\(\)\.confirmAction\(/);
  assert.doesNotMatch(messagesJs, /\bwindow\.(alert|confirm|prompt)\s*\(/);
  assert.match(messagesJs, /data-msg-tab="chats"[\s\S]*?data-msg-tab="requests"[\s\S]*?data-msg-tab="friends"/);
  assert.doesNotMatch(messagesJs, /data-msg-tab="discover"|id="msg-view-discover"|class="msg-brand-icon"/);
  assert.match(messagesJs, /id="msg-list-search"[\s\S]*?id="msg-list-search-clear"[\s\S]*?id="msg-new-chat-btn"/);
  assert.doesNotMatch(messagesJs, /setBusy\s*\(\s*sendBtn/);
  assert.match(messagesJs, /data-pending-retry[\s\S]*?data-pending-delete/);
  assert.match(messagesJs, /MAX_QUEUE_ATTACHMENTS\s*=\s*30/);
  assert.match(messagesJs, /SINGLE_CHECK_SVG[\s\S]*?DOUBLE_CHECK_SVG/);
  assert.match(messagesJs, /id="msg-typing-live"[\s\S]*?class="msg-typing-text"[^>]*>is typing<span class="msg-typing-dots">/);
  assert.match(messagesJs, /class="msg-video-player"[\s\S]*?class="msg-att-video"[\s\S]*?class="msg-video-controls"[\s\S]*?class="msg-video-seek"[\s\S]*?data-vact="play"[\s\S]*?data-vact="mute"[\s\S]*?data-vact="fs"[\s\S]*?data-vact="menu"/);
  assert.doesNotMatch(messagesJs, /<video controls\b|<audio controls\b/);
  assert.match(messagesJs, /class="msg-voice-card"[\s\S]*?data-aact="play"[\s\S]*?class="msg-voice-wave"[\s\S]*?data-aact="mute"[\s\S]*?class="msg-att-audio"/);
  assert.match(messagesJs, /has-top-media[\s\S]*?has-audio-only|has-audio-only[\s\S]*?has-top-media/);
  assert.match(messagesJs, /class="msg-bubble-body-pad"/);
  assert.match(messagesJs, /function buildMetaHtml\(/);
  assert.match(messagesJs, /lastShownClockKey/);
  assert.match(messagesJs, /is-media-only/);
  assert.match(messagesJs, /is-media-overlay/);
  assert.match(messagesJs, /is-tick-only/);
  assert.match(messagesJs, /data-ctx-do="download"[\s\S]*?if\s*\(\s*op\s*===\s*'download'/);
  assert.match(messagesJs, /MSG_REACT_SVG[\s\S]*?MSG_REPLY_SVG[\s\S]*?MSG_MORE_SVG[\s\S]*?MSG_PLUS_SVG/);
  assert.match(messagesJs, /function closeFloatingMenus\(/);
  assert.match(messagesJs, /data-react-expand/);
  assert.doesNotMatch(messagesJs, /data-react-more-ctx|>More…<|Suggestions|get_friend_suggestions|View suggestions/);
  assert.match(messagesJs, /class="msg-friends-hero"[\s\S]*?class="msg-friends-tabs"[\s\S]*?data-friends-sub="all"[\s\S]*?data-friends-sub="incoming"[\s\S]*?data-friends-sub="sent"/);
  assert.match(messagesJs, /setTimeout\([\s\S]*?'is-highlight-focus'[\s\S]*?3600\)/);
  assert.doesNotMatch(messagesJs, /msg-att-file-foot|Original<\/a>/);
  assert.match(vercel, /"Permissions-Policy"[\s\S]*?camera=\(\),\s*microphone=\(self\)/);
  assert.doesNotMatch(manifest, /android\.permission\.CAMERA/);
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(manifest, /android\.permission\.MODIFY_AUDIO_SETTINGS/);

  // 5. CSS responsive layout, circular X geometry, dark theme & badge hiding
  assert.match(appCss, /\.msg-dialog,[\s\S]*?font-family:\s*system-ui/);
  assert.match(appCss, /\.msg-topbar\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto;/);
  assert.match(appCss, /\.msg-topbar-actions\s*\{[\s\S]*?grid-column:\s*3;[\s\S]*?justify-self:\s*end;/);
  assert.match(appCss, /\.msg-topbar-actions\s+\.msg-icon-btn\s*\{[\s\S]*?border-radius:\s*50%;/);
  assert.match(appCss, /\.msg-mini-close,\s*\.msg-queue-remove,\s*\.msg-pop-close\s*\{[^}]*flex:\s*0\s+0\s+26px\s*!important;[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(appCss, /\.msg-upload-queue\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
  assert.match(appCss, /\.msg-attachments\.is-carousel\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
  assert.match(appCss, /\.msg-row\.is-failed\s+\.msg-bubble[\s\S]*?background:\s*#c62828\s*!important/);
  assert.match(appCss, /\.msg-tick\.is-sent\s*\{[\s\S]*?\.msg-tick\.is-delivered,[\s\S]*?\.msg-tick\.is-read\s*\{/);
  assert.match(appCss, /\.msg-typing-live\.is-visible\s*\{[\s\S]*?grid-template-rows:\s*1fr;/);
  assert.match(appCss, /\.msg-typing-text\s*\{[\s\S]*?font-style:\s*italic;/);
  assert.match(appCss, /@keyframes\s+msgTypingDot\s*\{/);
  assert.match(appCss, /\.msg-video-controls\s*\{[\s\S]*?opacity:\s*0;[\s\S]*?\.msg-video-player\.is-controls-visible\s+\.msg-video-controls\s*\{[\s\S]*?opacity:\s*1;/);
  assert.match(appCss, /\.msg-video-seek\s*\{[\s\S]*?#e5c994/);
  assert.match(appCss, /\.msg-bubble\.has-top-media\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;/);
  assert.match(appCss, /\.msg-bubble\.has-audio-only[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;/);
  assert.match(appCss, /\.msg-voice-card\s*\{[\s\S]*?#0d1f19[\s\S]*?\.msg-voice-play-btn\s*\{[\s\S]*?#e2c385[\s\S]*?\.msg-voice-wave-bar\.is-played\s*\{[\s\S]*?#e2c385/);
  assert.match(appCss, /\.msg-row\.is-highlight-focus,\s*\.msg-system-event\.is-highlight-focus\s*\{[\s\S]*?outline:\s*none\s*!important;[\s\S]*?box-shadow:\s*none\s*!important;/);
  assert.match(appCss, /@keyframes\s+msgFocusGlow\s*\{[\s\S]*?3\.4s cubic-bezier|msgFocusGlow\s+3\.4s\s+cubic-bezier/s);
  assert.match(appCss, /@keyframes\s+msgFocusGlowDark\s*\{/);
  assert.match(appCss, /@keyframes\s+appFocusFade\s*\{/);
  assert.match(appCss, /@media\s*\(hover:\s*none\),\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.msg-row-actions\s+\.msg-action-mini\[data-msg-act="react"\],\s*\.msg-row-actions\s+\.msg-action-mini\[data-msg-act="reply"\]\s*\{\s*display:\s*none;/);
  assert.match(appCss, /\.msg-bubble-col\s*\{[\s\S]*?calc\(100% - 46px\)[\s\S]*?\.msg-bubble-wrap\s*\{[\s\S]*?gap:\s*6px;/);
  assert.match(appCss, /\.msg-voice-card\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(appCss, /\.msg-react-strip\s*\{[\s\S]*?\.msg-react-btn\.is-selected\s*\{[\s\S]*?\.msg-react-palette\s*\{/);
  assert.match(appCss, /@keyframes\s+msgWaveDot\s*\{/);
  assert.match(appCss, /\.msg-search-clear\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(appCss, /\.msg-dialog\[open\]/);
  assert.match(appCss, /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.msg-topbar-actions\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*1;[\s\S]*?justify-self:\s*end;[\s\S]*?\.msg-tabs\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(appCss, /@media\s*\(max-width:\s*820px\)\s*\{[\s\S]*?\.msg-chat-layout\.is-mobile-thread\s+\.msg-sidebar\s*\{\s*display:\s*none/s);
  assert.match(appCss, /\.sidebar-utility\s+\.notification-badge\[hidden\][\s\S]*?display:\s*none\s*!important/s);
  assert.match(appCss, /\.msg-thread-skeleton\s*\{/);
  assert.match(appCss, /\.msg-wave-dots\s*\{/);
  assert.match(appCss, /@keyframes\s+msgShimmer\s*\{/);
  assert.match(appCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.msg-skel/);
  assert.match(heroCss, /\.group-bar-msg-btn\s*\{/);

  // 6. Behavioral check of IponMessages utilities & SUPER_ADMIN guard in sandboxed VM
  const { default: vm } = await import('node:vm');
  const inserted = [];
  const docStub = {
    documentElement: { dataset: {} },
    body: {
      insertAdjacentHTML(_pos, html) { inserted.push(html); }
    },
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => { }
  };
  const winStub = {
    Ipon: {
      escapeHtml: (s) => String(s ?? ''),
      rpc: async () => [],
      client: null
    },
    addEventListener: () => { },
    location: { search: '', href: 'https://example.test/dashboard.html' }
  };
  const ctx = {
    window: winStub,
    document: docStub,
    location: winStub.location,
    Map,
    Set,
    URLSearchParams,
    navigator: {},
    setInterval: () => 0,
    clearInterval: () => { }
  };
  winStub.window = winStub;
  vm.runInNewContext(messagesJs, ctx);
  assert.equal(typeof winStub.IponMessages?.detectAttachmentKind, 'function');
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'photo.png', type: 'image/png' }), 'image');
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'receipt.pdf', type: 'application/pdf' }), 'document');
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'voice.webm', type: 'audio/webm' }), 'audio');
  assert.equal(winStub.IponMessages.formatBytes(2048), '2.0 KB');
  await winStub.IponMessages.init({ id: '00000000-0000-0000-0000-000000000001', role: 'SUPER_ADMIN', status: 'ACTIVE' });
  assert.equal(inserted.length, 0, 'SUPER_ADMIN must never mount messaging dialogs');

  // 7. Regression guard against mark_conversation_read <-> realtime flicker loop
  let createdNodes = [];
  let mockSocialProfile = null;
  const makeEl = (id) => {
    const classes = new Set();
    const attrs = new Map();
    const cls = {
      toggle: (c, force) => {
        if (force === undefined ? !classes.has(c) : force) classes.add(c);
        else classes.delete(c);
      },
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c)
    };
    let html = '';
    const el = {
      id,
      hidden: false,
      open: false,
      value: '',
      scrollTop: 100,
      scrollHeight: 500,
      clientHeight: 400,
      dataset: {},
      style: {},
      classList: cls,
      children: [],
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      getBoundingClientRect: () => ({ left: 240, right: 270, top: 200, bottom: 230 }),
      addEventListener: () => { },
      focus: () => { },
      select: () => { },
      appendChild: (node) => { createdNodes.push(node); },
      contains: () => false,
      querySelectorAll: () => [],
      querySelector: () => null,
      showModal() { this.open = true; },
      close() { this.open = false; }
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set: (v) => {
        html = String(v ?? '');
        if (id === 'msg-messages-list' && html.includes('Loading conversation')) {
          loadingFlashes += 1;
          lastThreadSkeletonHtml = html;
        }
        if (id === 'msg-thread-header' && html.includes('Syncing messages')) {
          lastLoadingHeaderHtml = html;
        }
      }
    });
    return el;
  };

  let loadingFlashes = 0;
  let lastThreadSkeletonHtml = '';
  let lastLoadingHeaderHtml = '';
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };

  const rpcCalls = [];
  const tableHandlers = new Map();
  const broadcastHandlers = new Map();
  const broadcastSent = [];
  const sentBatches = [];
  const downloadRequests = [];
  const clickedAnchors = [];
  const meId = '00000000-0000-0000-0000-000000000010';
  const peerId = '00000000-0000-0000-0000-000000000020';
  const convId = '00000000-0000-0000-0000-0000000000c1';
  let threadMessages = [
    { id: 'm1', conversation_id: convId, sender_id: peerId, body: 'hello', message_type: 'TEXT', created_at: '2026-11-15T10:02:00Z', attachments: [], reactions: [] }
  ];
  let pinnedMsgs = [];
  let convUnread = 1;

  const rtChannelMock = {
    on(kind, filter, cb) {
      if (kind === 'postgres_changes' && filter?.table) tableHandlers.set(filter.table, cb);
      if (kind === 'broadcast' && filter?.event) broadcastHandlers.set(filter.event, cb);
      return this;
    },
    subscribe() { return this; },
    async send(payload) { broadcastSent.push(payload); return { status: 'ok' }; }
  };

  const docListeners = new Map();
  const doc2 = {
    documentElement: { dataset: {} },
    visibilityState: 'visible',
    body: { insertAdjacentHTML() { }, appendChild(node) { createdNodes.push(node); } },
    createElement: (tag) => {
      const classes = new Set();
      let clsName = '';
      const node = {
        tagName: String(tag || '').toUpperCase(),
        get className() { return clsName; },
        set className(v) {
          clsName = String(v ?? '');
          classes.clear();
          clsName.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        },
        innerHTML: '',
        style: {},
        dataset: {},
        attributes: new Map(),
        _palette: { hidden: true },
        classList: {
          add: (c) => { classes.add(c); clsName = [...classes].join(' '); },
          remove: (c) => { classes.delete(c); clsName = [...classes].join(' '); },
          toggle: (c, f) => {
            if (f === undefined ? !classes.has(c) : f) classes.add(c);
            else classes.delete(c);
            clsName = [...classes].join(' ');
          },
          contains: (c) => classes.has(c)
        },
        setAttribute(k, v) { this.attributes.set(k, String(v)); },
        getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; },
        querySelector(sel) {
          if (sel === '.msg-react-palette') return this._palette;
          return null;
        },
        click() { clickedAnchors.push(this); },
        remove() { createdNodes = createdNodes.filter((n) => n !== this); }
      };
      createdNodes.push(node);
      return node;
    },
    getElementById: (id) => getEl(id),
    querySelectorAll: (sel) => (sel.includes('msg-floating-menu') ? createdNodes.filter((n) => String(n.className).includes('msg-floating-menu')) : []),
    querySelector: (sel) => (sel.includes('msg-react-menu')
      ? createdNodes.find((n) => String(n.className).includes('msg-react-menu')) || null
      : (sel.includes('msg-floating-menu') ? createdNodes.find((n) => String(n.className).includes('msg-floating-menu')) || null : null)),
    addEventListener: (evName, fn) => {
      if (!docListeners.has(evName)) docListeners.set(evName, []);
      docListeners.get(evName).push(fn);
    }
  };
  const toastCalls = [];
  let setBusyCalls = 0;
  let imageViewerOpened = 0;
  let failNextSend = false;
  let failNextUpload = false;
  let nextSentSeq = 0;
  const win2 = {
    innerWidth: 1200,
    innerHeight: 800,
    Ipon: {
      escapeHtml: (s) => String(s ?? ''),
      optimizeUploadImage: async (file) => file,
      initials: () => 'NJ',
      isUserOnline: () => true,
      bindAvatarFallbacks: () => { },
      syncPresenceDots: () => { },
      syncMessagesBadges: () => { },
      openImageViewer: () => { imageViewerOpened += 1; },
      setBusy: () => { setBusyCalls += 1; },
      toast: (msg, kind = 'info') => toastCalls.push({ msg, kind }),
      friendlyError: (e) => String(e?.message || e),
      invokeAccountFunction: async (payload) => {
        if (payload?.action === 'chat-upload-urls') {
          if (failNextUpload) throw new Error('Upload link expired');
          return {
            uploads: (payload.files || []).map((f, idx) => ({
              path: `${convId}/up-${idx}-${f.name}`,
              token: `tok-${idx}`,
              signedUrl: `https://upload.test/${idx}`,
              name: f.name,
              type: f.type
            }))
          };
        }
        if (payload?.action === 'chat-view-urls') {
          if (payload.download_path) {
            downloadRequests.push(payload);
            return { downloadUrl: `https://cdn.example/dl/${encodeURIComponent(payload.download_path)}` };
          }
          return {
            urls: Object.fromEntries((payload.paths || []).map((p) => [p, `https://cdn.example/view/${encodeURIComponent(p)}`]))
          };
        }
        return {};
      },
      rpc: async (name, params) => {
        rpcCalls.push(name);
        if (name === 'start_or_open_direct_chat') {
          return { id: convId, status: 'ACCEPTED', initiator_id: meId };
        }
        if (name === 'mark_messages_delivered') {
          return 0;
        }
        if (name === 'send_chat_message') {
          if (failNextSend) throw new Error('Network offline');
          const id = `sent-${++nextSentSeq}`;
          sentBatches.push((params?.p_attachments || []).length);
          const row = {
            id,
            conversation_id: convId,
            sender_id: meId,
            body: params?.p_body || '',
            message_type: params?.p_message_type || 'TEXT',
            created_at: '2026-11-15T10:10:00Z',
            delivered_at: null,
            read_at: null,
            attachments: params?.p_attachments || [],
            reactions: []
          };
          threadMessages = [...threadMessages, row];
          return { id };
        }
        if (name === 'get_conversations') {
          return [{
            id: convId, status: 'ACCEPTED', initiator_id: peerId, is_incoming_request: false,
            peer: { id: peerId, full_name: 'Nhicole Joy Gadia Antalan', allow_online_status: true },
            unread_count: convUnread, marked_unread: false, last_message_at: '2026-11-15T10:02:00Z',
            last_message_preview: threadMessages[threadMessages.length - 1].body, last_message_sender_id: peerId
          }];
        }
        if (name === 'search_social_users') {
          return [{ id: '00000000-0000-0000-0000-000000000030', full_name: 'Zedrick De Monteverde', username: 'zedrick', friendship_status: 'NONE' }];
        }
        if (name === 'search_conversation_messages') {
          return [{ conversation_id: convId, message_id: 'm1', peer_name: 'Nhicole Joy Gadia Antalan', sender_name: 'Nhicole', body: 'hello world', created_at: '2026-11-15T10:02:00Z' }];
        }
        if (name === 'get_social_overview') return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        if (name === 'get_social_user_profile') {
          return mockSocialProfile || {
            id: params?.p_target_id || peerId,
            full_name: 'Nhicole Joy Gadia Antalan',
            username: 'nhicole',
            bio: '',
            avatar_url: '',
            friendship_status: 'INCOMING_REQUEST',
            friend_request_id: 'req-1',
            can_message: true,
            can_send_friend_request: false,
            shared_groups: ['Ipon namin ni prettyynhic'],
            mutual_friends_count: 0
          };
        }
        if (name === 'mark_conversation_read') {
          convUnread = 0;
          // Simulate Postgres realtime echoes caused by mark_conversation_read
          tableHandlers.get('conversation_participants')?.({ eventType: 'UPDATE', new: { conversation_id: convId, user_id: meId } });
          tableHandlers.get('message_receipts')?.({ eventType: 'UPDATE', new: { message_id: 'm1', user_id: meId, read_at: '2026-11-15T10:05:00Z' } });
          return { read_at: '2026-11-15T10:05:00Z', receipts_shared: true };
        }
        if (name === 'pin_chat_message') {
          const pid = params?.p_message_id;
          const exists = pinnedMsgs.some((p) => p.id === pid);
          pinnedMsgs = exists ? pinnedMsgs.filter((p) => p.id !== pid) : [{ id: pid, body: threadMessages.find((m) => m.id === pid)?.body || '', pinned_at: '2026-11-15T10:15:00Z' }, ...pinnedMsgs];
          return { id: pid, pinned_at: exists ? null : '2026-11-15T10:15:00Z' };
        }
        if (name === 'get_conversation_messages') {
          return {
            conversation: { id: peerId, conversation_id: convId, full_name: 'Nhicole Joy Gadia Antalan', status: 'ACCEPTED', friendship_status: 'FRIENDS', allow_online_status: true, receipts_enabled: true },
            has_older: false,
            unread_first_id: convUnread > 0 ? 'm1' : null,
            pinned_messages: pinnedMsgs,
            messages: threadMessages
          };
        }
        return [];
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => rtChannelMock,
        removeChannel: () => { }
      }
    },
    addEventListener: () => { },
    location: { search: '', href: 'https://example.test/dashboard.html' }
  };
  win2.window = win2;
  vm.runInNewContext(messagesJs, {
    window: win2, document: doc2, location: win2.location,
    Map, Set, URLSearchParams, navigator: {}, Math, JSON, Date, Intl,
    URL: { createObjectURL: (f) => `blob:mock/${f?.name || 'file'}`, revokeObjectURL: () => { } },
    CSS: { escape: (s) => String(s) },
    XMLHttpRequest: class {
      constructor() { this.upload = {}; this.status = 200; }
      open() { }
      setRequestHeader() { }
      send() { this.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 }); this.onload?.(); }
    },
    requestAnimationFrame: (fn) => fn(),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => { }
  });

  await win2.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', chat_privacy: { show_online: true } });
  await win2.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  assert.equal(loadingFlashes, 1, 'initial thread load renders loading indicator exactly once');
  assert.match(lastThreadSkeletonHtml, /msg-thread-skeleton[\s\S]*msg-wave-dots[\s\S]*msg-bubble-skel/);
  assert.match(lastLoadingHeaderHtml, /Nhicole Joy Gadia Antalan[\s\S]*Syncing messages/);
  const markReadAfterOpen = rpcCalls.filter((r) => r === 'mark_conversation_read').length;
  assert.equal(markReadAfterOpen, 1);

  // User types a draft while self echoes & peer receipt update fire via realtime
  getEl('msg-composer-input').value = 'typing reply';
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(loadingFlashes, 1, 'self echoes must never flash Loading conversation');
  assert.equal(rpcCalls.filter((r) => r === 'mark_conversation_read').length, 1, 'self echoes must never loop mark_conversation_read');

  // Incoming peer message updates thread silently without flashing loading or wiping draft
  threadMessages = [
    ...threadMessages,
    { id: 'm2', conversation_id: convId, sender_id: peerId, body: 'kamusta', message_type: 'TEXT', created_at: '2026-11-15T10:06:00Z', attachments: [], reactions: [] }
  ];
  convUnread = 1;
  tableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm2', conversation_id: convId, sender_id: peerId } });
  await new Promise((r) => setTimeout(r, 320));
  assert.equal(loadingFlashes, 1, 'live incoming message updates silently without flashing Loading conversation');
  assert.equal(getEl('msg-composer-input').value, 'typing reply', 'silent realtime refresh must preserve unsent composer draft');
  assert.equal(rpcCalls.filter((r) => r === 'mark_conversation_read').length, 2, 'incoming peer message marks read once and settles');

  // Unified inline sidebar search renders People + Messages without a separate top tab
  const inputHandlers = docListeners.get('input') || [];
  const clickHandlers = docListeners.get('click') || [];
  inputHandlers.forEach((fn) => fn({ target: { id: 'msg-list-search', value: 'hello' } }));
  await new Promise((r) => setTimeout(r, 240));
  const listHtml = getEl('msg-conv-list').innerHTML;
  assert.match(listHtml, /Zedrick De Monteverde/);
  assert.match(listHtml, /Messages<\/span><b>1<\/b>/);
  assert.equal(getEl('msg-filter-pills').hidden, true);
  assert.equal(getEl('msg-list-search-clear').hidden, false);
  assert.equal(getEl('msg-new-chat-btn').dataset.mode, 'back');

  // Clear button inside search input cleanly clears & exits back to inbox without ReferenceError
  const dispatchClick = async (matchSel, node = { dataset: {} }) => {
    await Promise.all(clickHandlers.map((fn) => fn({
      stopPropagation: () => { },
      target: { closest: (sel) => (sel === matchSel ? node : null) }
    })));
  };
  await dispatchClick('#msg-list-search-clear', getEl('msg-list-search-clear'));
  assert.equal(getEl('msg-list-search').value, '');
  assert.equal(getEl('msg-filter-pills').hidden, false);
  assert.equal(getEl('msg-new-chat-btn').dataset.mode, 'compose');

  // Rapid spam toggling of People directory / Back button never throws and omits useless Done banner
  for (let i = 0; i < 4; i += 1) {
    await dispatchClick('#msg-new-chat-btn', getEl('msg-new-chat-btn'));
  }
  await dispatchClick('#msg-new-chat-btn', getEl('msg-new-chat-btn'));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(getEl('msg-new-chat-btn').dataset.mode, 'back');
  assert.equal(getEl('msg-list-search-clear').hidden, true);
  assert.doesNotMatch(getEl('msg-conv-list').innerHTML, /msg-directory-done|>Done</);

  // Tapping a user from directory opens direct chat cleanly with zero error toasts
  await dispatchClick('[data-social-action]', { dataset: { socialAction: 'message', targetId: '00000000-0000-0000-0000-000000000030' } });
  assert.equal(getEl('msg-new-chat-btn').dataset.mode, 'compose');
  assert.equal(toastCalls.filter((t) => t.kind === 'error').length, 0);

  // Optimistic Messenger-style sending, preserved send-button SVG, carousel strip & red failed Retry/Delete
  const sendBtnEl = getEl('msg-send-btn');
  const originalSendSvg = '<svg viewBox="0 0 24 24"><path d="M22 2 11 13"/></svg>';
  sendBtnEl.innerHTML = originalSendSvg;
  const changeHandlers = docListeners.get('change') || [];
  const submitHandlers = docListeners.get('submit') || [];

  // Queue 2 attachments -> horizontal strip queue renders both cards
  changeHandlers.forEach((fn) => fn({
    target: {
      id: 'msg-file-input',
      value: 'selected',
      files: [
        { name: 'money.png', type: 'image/png', size: 22700 },
        { name: 'receipt.pdf', type: 'application/pdf', size: 14200 }
      ]
    }
  }));
  assert.equal(getEl('msg-upload-queue').dataset.count, '2');
  assert.match(getEl('msg-upload-queue').innerHTML, /money\.png[\s\S]*receipt\.pdf/);

  // Submit queued media while upload fails -> queue clears, carousel + red failed bar render, Retry/Delete shown, send SVG intact
  failNextUpload = true;
  await Promise.all(submitHandlers.map((fn) => fn({ preventDefault: () => { }, target: getEl('msg-composer-form') })));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(setBusyCalls, 0, 'send button must never be overwritten via setBusy');
  assert.equal(sendBtnEl.innerHTML, originalSendSvg, 'send button SVG icon must stay intact');
  assert.equal(getEl('msg-upload-queue').hidden, true);
  let msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /class="msg-row is-mine is-pending is-failed"/);
  assert.match(msgsHtml, /class="msg-attachments is-carousel"/);
  assert.match(msgsHtml, /Upload link expired/);
  const failedMediaId = msgsHtml.match(/data-pending-delete="([^"]+)"/)?.[1];
  assert.ok(failedMediaId);

  // Clicking Delete removes the failed attachment bubble cleanly
  await dispatchClick('[data-pending-delete]', { dataset: { pendingDelete: failedMediaId } });
  await new Promise((r) => setTimeout(r, 20));
  assert.doesNotMatch(getEl('msg-messages-list').innerHTML, /msg-row is-mine is-pending is-failed/);

  // Submit text while RPC fails -> turns red with Retry; clicking Retry delivers and reconciles
  failNextUpload = false;
  failNextSend = true;
  getEl('msg-composer-input').value = 'Failed ping test';
  await Promise.all(submitHandlers.map((fn) => fn({ preventDefault: () => { }, target: getEl('msg-composer-form') })));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(getEl('msg-composer-input').value, '');
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /Failed ping test[\s\S]*data-pending-retry="pending-/);
  const failedTextId = msgsHtml.match(/data-pending-retry="([^"]+)"/)?.[1];
  assert.ok(failedTextId);

  failNextSend = false;
  await dispatchClick('[data-pending-retry]', { dataset: { pendingRetry: failedTextId } });
  await new Promise((r) => setTimeout(r, 40));
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /Failed ping test/);
  assert.doesNotMatch(msgsHtml, /msg-row is-mine is-pending is-failed/);
  assert.equal(setBusyCalls, 0);

  // Delivery & read checkmarks: 1 gray check (Sent) -> 2 gray checks (Delivered) -> 2 green checks (Seen)
  const sentRow = threadMessages[threadMessages.length - 1];
  assert.ok(sentRow?.id, 'sent message row present');
  assert.match(msgsHtml, /class="msg-tick is-sent"[\s\S]*?<svg class="msg-tick-svg"/);

  sentRow.delivered_at = '2026-11-15T10:10:05Z';
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: sentRow.id, user_id: peerId, delivered_at: sentRow.delivered_at, read_at: null }
  });
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /class="msg-tick is-delivered"[\s\S]*?<svg class="msg-tick-svg is-double"/);

  sentRow.read_at = '2026-11-15T10:11:00Z';
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: sentRow.id, user_id: peerId, delivered_at: sentRow.delivered_at, read_at: sentRow.read_at }
  });
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /class="msg-tick is-read"[\s\S]*?<svg class="msg-tick-svg is-double"/);

  // Batch splitting: queuing 12 files (>10, <=30) auto-splits into sequential batches of 10 + 2
  const twelveFiles = Array.from({ length: 12 }, (_, idx) => ({
    name: `photo-${idx + 1}.png`,
    type: 'image/png',
    size: 4096 + idx
  }));
  changeHandlers.forEach((fn) => fn({
    target: { id: 'msg-file-input', value: 'selected', files: twelveFiles }
  }));
  assert.equal(getEl('msg-upload-queue').dataset.count, '12');
  assert.match(toastCalls[toastCalls.length - 1]?.msg || '', /2 batches \(up to 10/);

  const batchesBefore = sentBatches.length;
  await Promise.all(submitHandlers.map((fn) => fn({ preventDefault: () => { }, target: getEl('msg-composer-form') })));
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(sentBatches.slice(batchesBefore), [10, 2]);
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.doesNotMatch(msgsHtml, /msg-att-file-foot|<figcaption|Original<\/a>/);

  // Download lives in the 3-dots message menu & downloads batch attachments cleanly
  const tenBatchMsg = threadMessages.find((m) => (m.attachments || []).length === 10);
  assert.ok(tenBatchMsg);
  createdNodes = [];
  await dispatchClick('[data-msg-act]', {
    dataset: { msgAct: 'menu', msgId: tenBatchMsg.id },
    getBoundingClientRect: () => ({ left: 240, right: 270, top: 200, bottom: 230 })
  });
  const ctxMenuNode = createdNodes.find((n) => String(n.className).includes('msg-ctx-menu'));
  assert.ok(ctxMenuNode, 'context menu created for attachment message');
  assert.match(ctxMenuNode.innerHTML, /data-ctx-do="reply"[^>]*>Reply</);
  assert.match(ctxMenuNode.innerHTML, /data-ctx-do="download"[\s\S]*?Download all \(10\)/);
  await dispatchClick('[data-ctx-do]', { dataset: { ctxDo: 'download', msgId: tenBatchMsg.id } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(downloadRequests.length, 10);
  assert.equal(clickedAnchors.length, 10);

  // Typing indicator: smooth .is-visible reveal, instant clear on peer INSERT, and stop on blur
  broadcastHandlers.get('typing')?.({ payload: { conversationId: convId, user_id: peerId, typing: true } });
  assert.equal(getEl('msg-typing-live').classList.contains('is-visible'), true);
  assert.equal(getEl('msg-typing-live').getAttribute('aria-hidden'), 'false');

  threadMessages = [
    ...threadMessages,
    { id: 'm3', conversation_id: convId, sender_id: peerId, body: 'got your photos!', message_type: 'TEXT', created_at: '2026-11-15T10:12:00Z', attachments: [], reactions: [] }
  ];
  tableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm3', conversation_id: convId, sender_id: peerId } });
  assert.equal(getEl('msg-typing-live').classList.contains('is-visible'), false);
  assert.equal(getEl('msg-typing-live').getAttribute('aria-hidden'), 'true');

  getEl('msg-composer-input').value = 'drafting now';
  inputHandlers.forEach((fn) => fn({ target: getEl('msg-composer-input') }));
  assert.equal(broadcastSent.filter((b) => b?.payload?.typing === true).length >= 1, true);
  const focusoutHandlers = docListeners.get('focusout') || [];
  const falseBefore = broadcastSent.filter((b) => b?.payload?.typing === false).length;
  focusoutHandlers.forEach((fn) => fn({ target: { id: 'msg-composer-input' } }));
  assert.equal(broadcastSent.filter((b) => b?.payload?.typing === false).length, falseBefore + 1);

  // Custom video player: renders without permanent native controls, shows floating controls on tap & auto-hides
  changeHandlers.forEach((fn) => fn({
    target: { id: 'msg-file-input', value: 'selected', files: [{ name: 'clip.mp4', type: 'video/mp4', size: 12000 }] }
  }));
  await Promise.all(submitHandlers.map((fn) => fn({ preventDefault: () => { }, target: getEl('msg-composer-form') })));
  await new Promise((r) => setTimeout(r, 40));
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /class="msg-video-player"[\s\S]*?<video class="msg-att-video" preload="metadata" playsinline/);
  assert.doesNotMatch(msgsHtml, /class="msg-video-player is-controls-visible"|<video[^>]*\bcontrols\b/);
  assert.match(msgsHtml, /class="msg-video-controls"[\s\S]*?data-vact="play"[\s\S]*?data-vact="mute"[\s\S]*?data-vact="fs"[\s\S]*?data-vact="menu"/);

  const mockVideo = {
    paused: true,
    ended: false,
    muted: false,
    volume: 1,
    duration: 10,
    currentTime: 0,
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const mockPlayer = makeEl('mock-vid-player');
  mockPlayer.querySelector = (sel) => (sel === 'video' ? mockVideo : null);
  await dispatchClick('.msg-video-player', mockPlayer);
  assert.equal(mockVideo.paused, false);
  assert.equal(mockPlayer.classList.contains('is-controls-visible'), true);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(mockPlayer.classList.contains('is-controls-visible'), false);

  // Captionless media renders edge-to-edge without bottom slab, using frosted overlay meta; captioned media keeps body pad; voice card hides native controls
  assert.match(msgsHtml, /class="msg-row is-mine[^"]*"[\s\S]*?class="msg-bubble has-top-media is-media-only"[\s\S]*?class="msg-bubble-meta is-media-overlay(?:\s+is-tick-only)?"/);
  const mediaOnlyIdx = msgsHtml.indexOf('has-top-media is-media-only');
  assert.ok(mediaOnlyIdx >= 0);
  const mediaOnlyEnd = msgsHtml.indexOf('</article>', mediaOnlyIdx);
  assert.doesNotMatch(msgsHtml.slice(mediaOnlyIdx, mediaOnlyEnd), /class="msg-bubble-body-pad"/);
  assert.match(msgsHtml, /class="msg-bubble has-top-media"[\s\S]*?clip\.mp4[\s\S]*?class="msg-bubble-body-pad"[\s\S]*?drafting now/);

  threadMessages = [
    ...threadMessages,
    {
      id: 'm4',
      conversation_id: convId,
      sender_id: peerId,
      body: '',
      message_type: 'TEXT',
      created_at: '2026-11-15T10:15:00Z',
      attachments: [{ path: `${convId}/voice.webm`, name: 'voice.webm', kind: 'audio', duration_seconds: 6 }],
      reactions: []
    },
    {
      id: 'm5',
      conversation_id: convId,
      sender_id: meId,
      body: 'First same-minute msg',
      message_type: 'TEXT',
      created_at: '2026-11-15T10:20:00Z',
      delivered_at: null,
      read_at: null,
      reply_preview: { id: 'm1', sender_id: peerId, sender_name: 'Peer', body: 'original quote' },
      attachments: [],
      reactions: []
    },
    {
      id: 'm6',
      conversation_id: convId,
      sender_id: meId,
      body: 'Second same-minute msg',
      message_type: 'TEXT',
      created_at: '2026-11-15T10:20:42Z',
      delivered_at: '2026-11-15T10:20:45Z',
      read_at: null,
      attachments: [],
      reactions: []
    },
    {
      id: 'm7',
      conversation_id: convId,
      sender_id: meId,
      body: 'Receipt copy',
      message_type: 'TEXT',
      created_at: '2026-11-15T10:21:05Z',
      delivered_at: '2026-11-15T10:21:06Z',
      read_at: '2026-11-15T10:21:10Z',
      attachments: [{ path: `${convId}/receipt.png`, name: 'receipt.png', kind: 'image' }],
      reactions: []
    }
  ];
  tableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm7', conversation_id: convId, sender_id: meId } });
  await new Promise((r) => setTimeout(r, 320));
  msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /class="msg-bubble has-audio-only"[\s\S]*?class="msg-voice-card"[\s\S]*?0:00 \/ 0:06[\s\S]*?<audio class="msg-att-audio"/);
  assert.doesNotMatch(msgsHtml, /<audio[^>]*\bcontrols\b/);

  // Same-minute messages show <time> only on the first message of that minute while preserving Sent / Delivered / Seen checkmarks, and reply quotes render outside/above the bottom bubble
  const m5Pos = msgsHtml.indexOf('data-msg-id="m5"');
  const m6Pos = msgsHtml.indexOf('data-msg-id="m6"');
  const m7Pos = msgsHtml.indexOf('data-msg-id="m7"');
  assert.ok(m5Pos >= 0 && m6Pos > m5Pos && m7Pos > m6Pos, 'ordered m5/m6/m7 rendered');
  const m5Slice = msgsHtml.slice(m5Pos, m6Pos);
  const m6Slice = msgsHtml.slice(m6Pos, m7Pos);
  const m7Slice = msgsHtml.slice(m7Pos);
  assert.match(m5Slice, /<div class="msg-bubble-col">\s*<button type="button" class="msg-reply-quote" data-jump-msg="m1">[\s\S]*?<\/button>\s*<div class="msg-bubble-wrap">\s*<div class="msg-bubble(?=["\s])/);
  assert.doesNotMatch(m5Slice, /<div class="msg-bubble(?=["\s])[\s\S]*?class="msg-reply-quote"/);
  assert.match(m5Slice, /<time\b[^>]*>[^<]+<\/time>/);
  assert.match(m5Slice, /class="msg-tick is-sent"[^>]*aria-label="Sent"/);
  assert.doesNotMatch(m6Slice, /<time\b/);
  assert.match(m6Slice, /class="msg-bubble-meta is-tick-only"[\s\S]*?class="msg-tick is-delivered"[^>]*aria-label="Delivered"/);
  assert.match(m7Slice, /<time\b[^>]*>[^<]+<\/time>/);
  assert.match(m7Slice, /class="msg-tick is-read"[^>]*aria-label="Seen"/);
  assert.match(m7Slice, /class="msg-bubble has-top-media"[\s\S]*?class="msg-bubble-body-pad"[\s\S]*?Receipt copy/);

  const mockAudio = {
    paused: true,
    ended: false,
    muted: false,
    volume: 1,
    duration: 6,
    currentTime: 0,
    closest: (sel) => (sel === '.msg-voice-card' ? mockVoiceCard : null),
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; }
  };
  const mockVoiceBars = Array.from({ length: 10 }, () => makeEl('bar'));
  const mockVoiceTime = { textContent: '0:00 / 0:06' };
  const mockVoicePlayBtn = { innerHTML: '', setAttribute: () => { } };
  const mockVoiceMuteBtn = { innerHTML: '', setAttribute: () => { } };
  const mockVoiceWave = makeEl('mock-voice-wave');
  mockVoiceWave.querySelectorAll = (sel) => (sel === '.msg-voice-wave-bar' ? mockVoiceBars : []);
  mockVoiceWave.getBoundingClientRect = () => ({ left: 100, right: 300, width: 200, top: 0, bottom: 24 });
  const mockVoiceCard = makeEl('mock-voice-card');
  mockVoiceCard.dataset.dur = '6';
  mockVoiceCard.querySelectorAll = () => [];
  mockVoiceCard.querySelector = (sel) => ({
    'audio.msg-att-audio': mockAudio,
    '[data-aact="play"]': mockVoicePlayBtn,
    '[data-aact="mute"]': mockVoiceMuteBtn,
    '.msg-voice-wave': mockVoiceWave,
    '.msg-voice-time': mockVoiceTime
  }[sel] || null);
  mockVoiceWave.closest = (sel) => (sel === '.msg-voice-card' ? mockVoiceCard : null);

  await dispatchClick('[data-aact]', {
    dataset: { aact: 'play' },
    closest: (sel) => (sel === '.msg-voice-card' ? mockVoiceCard : null)
  });
  assert.equal(mockAudio.paused, false);
  await Promise.all(clickHandlers.map((fn) => fn({
    clientX: 200,
    stopPropagation: () => { },
    target: { closest: (sel) => (sel === '.msg-voice-wave' ? mockVoiceWave : null) }
  })));
  assert.equal(mockAudio.currentTime, 3);
  assert.equal(mockVoiceTime.textContent, '0:03 / 0:06');
  assert.equal(mockVoiceBars.filter((b) => b.classList.contains('is-played')).length, 5);

  await dispatchClick('[data-aact]', {
    dataset: { aact: 'mute' },
    closest: (sel) => (sel === '.msg-voice-card' ? mockVoiceCard : null)
  });
  assert.equal(mockAudio.muted, true);

  // Messenger-style floating reaction menu highlights user's active reaction, expands '+' palette, and exposes quick actions on mobile tap
  threadMessages = threadMessages.map((m) => (m.id === 'm3' ? { ...m, reactions: [{ user_id: meId, emoji: '❤️' }] } : m));
  tableHandlers.get('message_reactions')?.({ eventType: 'INSERT', new: { message_id: 'm3', user_id: meId, emoji: '❤️' } });
  await new Promise((r) => setTimeout(r, 320));

  createdNodes = [];
  await dispatchClick('[data-msg-act]', {
    dataset: { msgAct: 'react', msgId: 'm3' },
    getBoundingClientRect: () => ({ left: 240, right: 270, top: 200, bottom: 230, width: 30 })
  });
  const reactMenuNode = createdNodes.find((n) => String(n.className).includes('msg-react-menu'));
  assert.ok(reactMenuNode, 'clicking React opens upgraded floating reaction menu');
  assert.match(reactMenuNode.innerHTML, /class="msg-react-strip"[\s\S]*?class="msg-react-btn is-selected"[^>]*data-react-emoji="❤️"/);
  assert.match(reactMenuNode.innerHTML, /data-react-expand[\s\S]*?class="msg-react-palette"/);

  // Expanding '+' reveals extra emojis in the floating palette while keeping menu open
  const clickEl = (target) => Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: target?.closest ? target : { closest: () => null, ...target } })));
  const expandBtnMock = {
    closest: (sel) => (sel === '[data-react-expand]' ? expandBtnMock : (sel === '.msg-react-menu' || sel === '.msg-floating-menu' ? reactMenuNode : null)),
    setAttribute: () => { }
  };
  await clickEl(expandBtnMock);
  assert.equal(reactMenuNode._palette.hidden, false);
  assert.equal(reactMenuNode.classList.contains('has-extra'), true);

  // Outside click transitions open Pic 1 smoothly via .is-leaving and removes after exit duration
  assert.equal(reactMenuNode.classList.contains('is-visible'), true);
  await clickEl(makeEl('outside-stage'));
  assert.equal(reactMenuNode.classList.contains('is-leaving'), true);
  assert.equal(reactMenuNode.classList.contains('is-visible'), false);
  assert.equal(reactMenuNode.getAttribute('aria-hidden'), 'true');
  await new Promise((r) => setTimeout(r, 230));
  assert.equal(createdNodes.some((n) => n === reactMenuNode), false);

  // Quick tap does NOT auto-open reactions; hold (touch or stationary mouse) on message, picture, or video opens Pic 1 without triggering media open/play
  win2.innerWidth = 390;
  const pointerDownHandlers = docListeners.get('pointerdown') || [];
  const pointerMoveHandlers = docListeners.get('pointermove') || [];
  const pointerUpHandlers = docListeners.get('pointerup') || [];
  const contextMenuHandlers = docListeners.get('contextmenu') || [];
  const mockRow = makeEl('mock-row-m3');
  mockRow.dataset.msgId = 'm3';
  const mockBubble = makeEl('mock-bubble-m3');
  mockRow.querySelector = (s) => (s === '.msg-bubble' ? mockBubble : null);
  mockBubble.getBoundingClientRect = () => ({ left: 24, right: 240, top: 320, bottom: 370, width: 216 });
  mockBubble.closest = (s) => (s === '.msg-row' || s === '[data-msg-id]' || s === '[data-msg-id="m3"]' ? mockRow : (s === '#msg-messages-list .msg-bubble:not(.is-deleted)' ? mockBubble : null));

  createdNodes = [];
  await clickEl(mockBubble);
  assert.equal(createdNodes.some((n) => String(n.className).includes('msg-react-menu')), false, 'quick tap must not auto-open reaction pill');

  // Hold text message bubble (touch) -> opens Pic 1 & suppresses trailing click
  pointerDownHandlers.forEach((fn) => fn({ pointerType: 'touch', clientX: 50, clientY: 50, target: mockBubble }));
  await new Promise((r) => setTimeout(r, 410));
  const textHoldMenu = createdNodes.find((n) => String(n.className).includes('msg-react-menu'));
  assert.ok(textHoldMenu, 'holding a text bubble opens reactions floating strip');
  assert.equal(textHoldMenu.classList.contains('is-visible'), true);
  assert.match(textHoldMenu.innerHTML, /class="msg-react-strip"[\s\S]*?data-react-msg="m3"[\s\S]*?data-react-expand/);
  assert.doesNotMatch(textHoldMenu.innerHTML, /msg-react-quick-actions|data-ctx-do="reply"|data-ctx-do="copy"|data-ctx-do="download"|data-react-more-ctx|More…/);
  pointerUpHandlers.forEach((fn) => fn({ pointerType: 'touch', target: mockBubble }));
  await clickEl(mockBubble);
  assert.equal(textHoldMenu.classList.contains('is-leaving'), false, 'trailing click after hold is suppressed');

  // Dismiss cleanly before testing picture & video holds
  await clickEl(makeEl('outside-stage'));
  await new Promise((r) => setTimeout(r, 230));

  // Picture: quick tap opens full-size viewer; hold opens Pic 1 WITHOUT opening viewer & ignores OS trailing contextmenu
  const mockImgFigure = makeEl('mock-att-img');
  mockImgFigure.getBoundingClientRect = () => ({ left: 24, right: 224, top: 200, bottom: 420, width: 200 });
  mockImgFigure.closest = (s) => (s === '.msg-row' || s === '[data-msg-id]' || s === '[data-msg-id="m3"]' ? mockRow : (s === '#msg-messages-list .msg-bubble:not(.is-deleted)' ? mockBubble : (s === '.msg-att-image' || s === '.msg-att-image, .msg-video-player' ? mockImgFigure : null)));
  const mockImgBtn = makeEl('mock-img-btn');
  mockImgBtn.dataset = { openImg: 'https://cdn.example/view/pic.jpg', imgName: 'pic.jpg', imgPath: 'pic.jpg' };
  mockImgBtn.closest = (s) => (s === '[data-open-img]' ? mockImgBtn : mockImgFigure.closest(s));
  const prevViewerCount = imageViewerOpened;
  await clickEl(mockImgBtn);
  assert.equal(imageViewerOpened, prevViewerCount + 1, 'quick tap on picture opens full-size viewer');

  createdNodes = [];
  pointerDownHandlers.forEach((fn) => fn({ pointerType: 'touch', clientX: 80, clientY: 240, target: mockImgBtn }));
  await new Promise((r) => setTimeout(r, 410));
  const picHoldMenu = createdNodes.find((n) => String(n.className).includes('msg-react-menu'));
  assert.ok(picHoldMenu, 'holding a picture opens Pic 1 reaction strip');
  assert.equal(picHoldMenu.classList.contains('is-visible'), true);
  let ctxPrevented = false;
  contextMenuHandlers.forEach((fn) => fn({ target: mockImgBtn, preventDefault: () => { ctxPrevented = true; } }));
  assert.equal(ctxPrevented, true, 'OS contextmenu on held picture is prevented');
  assert.equal(picHoldMenu.classList.contains('is-leaving'), false, 'trailing contextmenu keeps held reaction pill open');
  pointerUpHandlers.forEach((fn) => fn({ pointerType: 'touch', target: mockImgBtn }));
  await clickEl(mockImgBtn);
  assert.equal(imageViewerOpened, prevViewerCount + 1, 'trailing click after picture hold must NOT open viewer');

  // Hold video with stationary primary mouse -> opens Pic 1 without playing video; drag >10px cancels hold
  await clickEl(makeEl('outside-stage'));
  await new Promise((r) => setTimeout(r, 230));
  const mockVidEl = { paused: true, ended: false, play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  const mockVidPlayer = makeEl('mock-video-player');
  mockVidPlayer.getBoundingClientRect = () => ({ left: 24, right: 280, top: 240, bottom: 420, width: 256 });
  mockVidPlayer.querySelector = (s) => (s === 'video' ? mockVidEl : null);
  mockVidPlayer.closest = (s) => (s === '.msg-row' || s === '[data-msg-id]' || s === '[data-msg-id="m3"]' ? mockRow : (s === '#msg-messages-list .msg-bubble:not(.is-deleted)' ? mockBubble : (s === '.msg-video-player' || s === '.msg-att-image, .msg-video-player' ? mockVidPlayer : null)));
  const mockVideoTarget = { closest: (s) => (s === 'video' ? mockVideoTarget : mockVidPlayer.closest(s)) };

  createdNodes = [];
  pointerDownHandlers.forEach((fn) => fn({ pointerType: 'mouse', button: 0, clientX: 100, clientY: 300, target: mockVideoTarget }));
  pointerMoveHandlers.forEach((fn) => fn({ clientX: 118, clientY: 300 }));
  await new Promise((r) => setTimeout(r, 410));
  assert.equal(createdNodes.some((n) => String(n.className).includes('msg-react-menu')), false, 'moving pointer >10px cancels hold');

  createdNodes = [];
  pointerDownHandlers.forEach((fn) => fn({ pointerType: 'mouse', button: 0, clientX: 100, clientY: 300, target: mockVideoTarget }));
  await new Promise((r) => setTimeout(r, 410));
  const vidHoldMenu = createdNodes.find((n) => String(n.className).includes('msg-react-menu'));
  assert.ok(vidHoldMenu, 'holding a video opens Pic 1 reaction strip');
  assert.equal(vidHoldMenu.classList.contains('is-visible'), true);
  pointerUpHandlers.forEach((fn) => fn({ pointerType: 'mouse', button: 0, target: mockVideoTarget }));
  await clickEl(mockVideoTarget);
  assert.equal(mockVidEl.paused, true, 'trailing click after video hold must NOT start video playback');
  await clickEl(makeEl('outside-stage'));
  await new Promise((r) => setTimeout(r, 230));

  // Pinned message light-green pill banner, expandable panel without row 'X' buttons, and single active-pin highlight
  threadMessages.forEach((m) => { if (m.id === 'm1' || m.id === 'sent-1') m.pinned_at = '2026-11-15T10:15:00Z'; });
  pinnedMsgs = [
    { id: 'm1', body: 'hello', pinned_at: '2026-11-15T10:15:00Z' },
    { id: 'sent-1', body: 'Second pinned note', pinned_at: '2026-11-15T10:14:00Z' }
  ];
  tableHandlers.get('messages')?.({ eventType: 'UPDATE', new: { id: 'm1', conversation_id: convId, sender_id: peerId } });
  await new Promise((r) => setTimeout(r, 320));
  const pinBannerEl = getEl('msg-pinned-banner');
  assert.equal(pinBannerEl.hidden, false);
  assert.match(pinBannerEl.innerHTML, /class="msg-pinned-pill"[\s\S]*?PINNED MESSAGE\s*<span class="msg-pinned-count">2<\/span>[\s\S]*?<strong>hello<\/strong>[\s\S]*?data-pinned-toggle[^>]*aria-expanded="false"/);
  assert.match(pinBannerEl.innerHTML, /id="msg-pinned-panel" hidden/);

  // Only the chosen active pinned message gets the .is-pinned border in the thread, and .msg-bubble-wrap hugs .msg-bubble + .msg-row-actions
  const pinnedMsgsHtml = getEl('msg-messages-list').innerHTML;
  assert.equal((pinnedMsgsHtml.match(/class="msg-bubble[^"]*\bis-pinned\b/g) || []).length, 1, 'only the active selected pinned message gets the highlight border');
  assert.match(pinnedMsgsHtml, /data-msg-id="m1"[\s\S]*?class="msg-bubble-wrap"[\s\S]*?class="msg-bubble is-pinned"/);
  assert.match(pinnedMsgsHtml, /class="msg-bubble-wrap">[\s\S]*?class="msg-bubble[\s\S]*?class="msg-row-actions"/);

  // Toggle chevron expands dropdown panel with no row 'X' unpin buttons
  const pinToggleTarget = {
    dataset: {},
    closest: (sel) => (sel === '[data-pinned-toggle]' || sel === '#msg-pinned-banner' ? pinToggleTarget : null)
  };
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: pinToggleTarget })));
  assert.match(pinBannerEl.innerHTML, /data-pinned-toggle[^>]*aria-expanded="true"/);
  assert.doesNotMatch(pinBannerEl.innerHTML, /id="msg-pinned-panel" hidden/);
  assert.match(pinBannerEl.innerHTML, /<h3>Pinned messages <em>2<\/em><\/h3>[\s\S]*?msg-pinned-item is-active[\s\S]*?msg-pinned-item-num">1<\/span>/);
  assert.doesNotMatch(pinBannerEl.innerHTML, /data-unpin-msg|msg-pinned-item-unpin/);

  // Selecting pinned #2 moves the .is-pinned border exclusively to that message and updates the top banner
  const mockBubble1 = makeEl('mock-b1');
  mockBubble1.classList.add('is-pinned');
  const mockBubble2 = makeEl('mock-b2');
  getEl('msg-messages-list').querySelectorAll = (sel) => (sel === '.msg-row[data-msg-id]' ? [
    { dataset: { msgId: 'm1' }, querySelector: () => mockBubble1 },
    { dataset: { msgId: 'sent-1' }, querySelector: () => mockBubble2 }
  ] : []);
  const selectPin2Target = {
    dataset: { pinnedSelect: 'sent-1', jumpMsg: 'sent-1' },
    closest: (sel) => (sel === '[data-jump-msg]' || sel === '#msg-pinned-banner' ? selectPin2Target : null)
  };
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: selectPin2Target })));
  assert.equal(mockBubble1.classList.contains('is-pinned'), false);
  assert.equal(mockBubble2.classList.contains('is-pinned'), true);
  assert.match(pinBannerEl.innerHTML, /<strong>Second pinned note<\/strong>/);

  // Clicking 3-dots includes 'Reply' and choosing it arms composer reply bar
  const dotsTarget = {
    dataset: { msgAct: 'menu', msgId: 'm1' },
    getBoundingClientRect: () => ({ left: 100, right: 128, top: 180, bottom: 208, width: 28, height: 28 }),
    closest: (sel) => (sel === '[data-msg-act]' ? dotsTarget : (sel === '.msg-row' ? makeEl('row-m1') : null))
  };
  createdNodes = [];
  await clickEl(dotsTarget);
  const dotsCtxMenu = createdNodes.find((n) => String(n.className).includes('msg-ctx-menu'));
  assert.ok(dotsCtxMenu);
  assert.match(dotsCtxMenu.innerHTML, /data-ctx-do="reply"[^>]*>Reply<\/button>/);
  const replyMenuBtn = { dataset: { ctxDo: 'reply', msgId: 'm1' }, closest: (sel) => (sel === '[data-ctx-do]' ? replyMenuBtn : null) };
  await clickEl(replyMenuBtn);
  assert.equal(getEl('msg-context-bar').hidden, false);
  assert.match(getEl('msg-context-bar').innerHTML, /Replying to/);

  // Mobile Back button then clicking the SAME chat again re-opens the thread view immediately
  const chatsViewEl = getEl('msg-view-chats');
  assert.equal(chatsViewEl.classList.contains('is-mobile-thread'), true);
  await dispatchClick('#msg-back-to-list', { dataset: {} });
  assert.equal(chatsViewEl.classList.contains('is-mobile-thread'), false);
  await dispatchClick('[data-open-conv]', { dataset: { openConv: convId } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(chatsViewEl.classList.contains('is-mobile-thread'), true, 're-selecting same chat after Back must reopen mobile thread');

  // Messenger-style Chat Info drawer: overview shows ONLY Shared media & Shared files selectors (no inline grids/lists); picking one enters its scrollable view with Back button
  threadMessages = [
    ...threadMessages,
    {
      id: 'm-media-batch',
      conversation_id: convId,
      sender_id: peerId,
      body: 'Receipts and video',
      message_type: 'MEDIA',
      created_at: '2026-11-15T10:20:00Z',
      attachments: [
        ...Array.from({ length: 11 }, (_, idx) => ({ path: `${convId}/photo-${idx + 1}.jpg`, kind: 'image', name: `photo-${idx + 1}.jpg`, size: 42000 })),
        { path: `${convId}/clip.mp4`, kind: 'video', name: 'clip.mp4', size: 256000 },
        { path: `${convId}/ledger.pdf`, kind: 'file', name: 'ledger.pdf', size: 184320 },
        { path: `${convId}/summary.xlsx`, kind: 'file', name: 'summary.xlsx', size: 96256 }
      ],
      reactions: []
    }
  ];
  tableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm-media-batch', conversation_id: convId, sender_id: peerId } });
  await new Promise((r) => setTimeout(r, 340));

  const expectedMediaCount = threadMessages.filter((m) => !m.deleted_for_everyone_at).reduce((n, m) => n + (m.attachments || []).filter((a) => a.kind === 'image' || a.kind === 'video').length, 0);
  const expectedFileCount = threadMessages.filter((m) => !m.deleted_for_everyone_at).reduce((n, m) => n + (m.attachments || []).filter((a) => a.kind !== 'image' && a.kind !== 'video' && a.kind !== 'audio').length, 0);
  assert.ok(expectedMediaCount >= 12);
  assert.ok(expectedFileCount >= 2);
  const drawerEl = getEl('msg-thread-drawer');
  await dispatchClick('#msg-thread-info-toggle', { dataset: {} });
  assert.equal(drawerEl.hidden, false);
  assert.match(drawerEl.innerHTML, new RegExp(`data-drawer-view="media"[\\s\\S]*?Shared media[\\s\\S]*?<span class="msg-drawer-nav-count">${expectedMediaCount}<\\/span>`));
  assert.match(drawerEl.innerHTML, new RegExp(`data-drawer-view="files"[\\s\\S]*?Shared files[\\s\\S]*?<span class="msg-drawer-nav-count">${expectedFileCount}<\\/span>`));
  assert.doesNotMatch(drawerEl.innerHTML, /class="msg-drawer-media-grid"|class="msg-drawer-files"|photo-1\.jpg|ledger\.pdf|voice\.webm/);

  // Drill into Shared media -> ONLY scrollable media grid renders (all items, never sliced) + Back button
  await clickEl({ dataset: { drawerView: 'media' }, closest: (sel) => (sel === '[data-drawer-view]' ? { dataset: { drawerView: 'media' } } : null) });
  assert.match(drawerEl.innerHTML, new RegExp(`class="msg-drawer-back" data-drawer-view="root"[\\s\\S]*?<h3>Shared media<\\/h3>[\\s\\S]*?<span class="msg-drawer-head-count">${expectedMediaCount}<\\/span>`));
  assert.match(drawerEl.innerHTML, /data-drawer-screen="media"[\s\S]*?class="msg-drawer-media-grid"/);
  assert.equal((drawerEl.innerHTML.match(/class="msg-drawer-thumb/g) || []).length, expectedMediaCount, 'Shared media subview shows all items for scrolling');
  assert.doesNotMatch(drawerEl.innerHTML, /class="msg-drawer-profile"|class="msg-drawer-files"|Chat actions/);

  // Navigate back -> root overview again without inline grids/lists
  await clickEl({ dataset: { drawerView: 'root' }, closest: (sel) => (sel === '[data-drawer-view]' ? { dataset: { drawerView: 'root' } } : null) });
  assert.match(drawerEl.innerHTML, /data-drawer-screen="root"[\s\S]*?data-drawer-view="media"/);
  assert.doesNotMatch(drawerEl.innerHTML, /class="msg-drawer-media-grid"|class="msg-drawer-files"/);

  // Drill into Shared files -> ONLY scrollable files list renders + Back button
  await clickEl({ dataset: { drawerView: 'files' }, closest: (sel) => (sel === '[data-drawer-view]' ? { dataset: { drawerView: 'files' } } : null) });
  assert.match(drawerEl.innerHTML, new RegExp(`class="msg-drawer-back" data-drawer-view="root"[\\s\\S]*?<h3>Shared files<\\/h3>[\\s\\S]*?<span class="msg-drawer-head-count">${expectedFileCount}<\\/span>`));
  assert.match(drawerEl.innerHTML, /data-drawer-screen="files"[\s\S]*?class="msg-drawer-files"[\s\S]*?summary\.xlsx[\s\S]*?ledger\.pdf/);
  assert.doesNotMatch(drawerEl.innerHTML, /class="msg-drawer-profile"|class="msg-drawer-media-grid"|Chat actions/);

  // Close drawer cleanly
  await dispatchClick('#msg-drawer-close', { dataset: {} });
  assert.equal(drawerEl.hidden, true);

  // Switching to Friends view renders dark-emerald hero card with 3 underline tabs and zero Suggestions UI
  await dispatchClick('[data-msg-tab]', { dataset: { msgTab: 'friends' } });
  const friendsHtml = getEl('msg-view-friends').innerHTML;
  assert.match(friendsHtml, /class="msg-friends-hero"[\s\S]*?Friends <span class="msg-hero-amp">&amp;<\/span> Connections/);
  assert.match(friendsHtml, /class="msg-friends-tabs"[\s\S]*?data-friends-sub="all"[\s\S]*?My Friends[\s\S]*?data-friends-sub="incoming"[\s\S]*?Friend Requests[\s\S]*?data-friends-sub="sent"[\s\S]*?Sent/);
  assert.doesNotMatch(friendsHtml, /Suggestions|privacy-respecting suggestions|data-friends-sub="suggestions"/);

  // User profile popover matches warm-cream card mockup for 1 group and scales cleanly for many shared groups
  const popEl = getEl('msg-profile-popover');
  const dpAnchor = makeEl('mock-dp-anchor');
  dpAnchor.dataset = { socialUserDp: peerId };
  dpAnchor.getBoundingClientRect = () => ({ left: 40, right: 80, top: 120, bottom: 160, width: 40, height: 40 });
  await dispatchClick('[data-social-user-dp]', dpAnchor);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(popEl.hidden, false);
  assert.match(popEl.innerHTML, /id="msg-pop-close"/);
  assert.match(popEl.innerHTML, /avatar-circle(?:\s+avatar-fallback)?\s+avatar-lg/);
  assert.match(popEl.innerHTML, /<strong id="msg-pop-name">Nhicole Joy Gadia Antalan<\/strong>/);
  assert.match(popEl.innerHTML, /@nhicole · Sent you a friend request/);
  assert.doesNotMatch(popEl.innerHTML, /msg-handle-chip|data-pop-groups-toggle|mutual friend/);
  assert.match(popEl.innerHTML, /class="msg-pop-groups-card"[\s\S]*?class="msg-pop-groups-label">Groups<[\s\S]*?class="msg-pop-groups-name"[^>]*>Ipon namin ni prettyynhic</);
  assert.match(popEl.innerHTML, /class="msg-pop-btn msg-pop-primary-btn" data-req-decision="ACCEPT" data-req-id="req-1"[\s\S]*?<span>Accept Friend<\/span>/);
  assert.match(popEl.innerHTML, /class="msg-pop-secondary-row"[\s\S]*?>Message<[\s\S]*?class="msg-pop-btn msg-pop-outline-btn is-danger" data-social-action="block"/);

  // Many shared groups -> compact +N bar by default, expanding drawer reveals all groups without closing popover
  mockSocialProfile = {
    id: peerId,
    full_name: 'Nhicole Joy Gadia Antalan',
    username: 'nhicole',
    bio: '',
    avatar_url: '',
    friendship_status: 'FRIENDS',
    friend_request_id: null,
    can_message: true,
    can_send_friend_request: false,
    shared_groups: ['Alpha Savers', 'Barkada Fund', 'Emergency Stash', 'Family Ipon', 'Travel Jar'],
    mutual_friends_count: 3
  };
  await dispatchClick('[data-social-user-dp]', dpAnchor);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(popEl.innerHTML, /3 mutual friends/);
  assert.match(popEl.innerHTML, /data-pop-groups-toggle aria-expanded="false"[\s\S]*?>Alpha Savers<[\s\S]*?class="msg-pop-groups-more">\+4<svg/);
  assert.match(popEl.innerHTML, /class="msg-pop-groups-list" hidden/);
  for (const g of mockSocialProfile.shared_groups) {
    assert.match(popEl.innerHTML, new RegExp(`class="msg-pop-group-chip"[^>]*>${g}<`));
  }

  const mockGroupsCard = makeEl('mock-pop-groups-card');
  const mockGroupsList = makeEl('mock-pop-groups-list');
  mockGroupsList.hidden = true;
  mockGroupsCard.querySelector = (s) => (s === '.msg-pop-groups-list' ? mockGroupsList : null);
  const mockGroupsToggle = makeEl('mock-pop-groups-toggle');
  mockGroupsToggle.closest = (s) => {
    if (s === '[data-pop-groups-toggle]') return mockGroupsToggle;
    if (s === '[data-pop-groups-card]') return mockGroupsCard;
    if (s === '#msg-profile-popover') return popEl;
    return null;
  };
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: mockGroupsToggle })));
  assert.equal(popEl.hidden, false, 'expanding shared groups must not trigger outside-click close');
  assert.equal(mockGroupsList.hidden, false);
  assert.equal(mockGroupsCard.classList.contains('is-open'), true);
  assert.equal(mockGroupsToggle.getAttribute('aria-expanded'), 'true');

  // Close popover via close X button
  await dispatchClick('#msg-pop-close', { dataset: {} });
  assert.equal(popEl.hidden, true);

  // Switching to Requests tab while inside a chat conversation exits mobile thread & clears mismatched chat pane
  await dispatchClick('[data-open-conv]', { dataset: { openConv: convId } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(chatsViewEl.classList.contains('is-mobile-thread'), true);
  assert.equal(getEl('msg-thread-active').hidden, false);
  await dispatchClick('[data-msg-tab]', { dataset: { msgTab: 'requests' } });
  assert.equal(chatsViewEl.classList.contains('is-mobile-thread'), false, 'switching to Requests tab must exit mobile conversation view');
  assert.equal(getEl('msg-thread-active').hidden, true, 'switching to Requests from a regular chat must clear active thread pane');
  assert.equal(getEl('msg-thread-empty').hidden, false);

  // Re-opening workspace from Dashboard without explicit tab/conversationId always defaults to Chats list
  await dispatchClick('[data-msg-tab]', { dataset: { msgTab: 'friends' } });
  assert.equal(getEl('msg-view-friends').hidden, false);
  await win2.IponMessages.openWorkspace();
  assert.equal(getEl('msg-view-chats').hidden, false, 'default openWorkspace must always land on Chats view');
  assert.equal(getEl('msg-view-friends').hidden, true);
  assert.equal(chatsViewEl.classList.contains('is-mobile-thread'), false, 'default openWorkspace must show Chats list instead of sticky thread');
});

test('migration 078 filters audit logs to meaningful governance/financial events and offline page omits broken logo', () => {
  const migration078 = read('database/migrations/20261115_078_filter_audit_log_signal_only.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const prepareMobile = read('scripts/prepare-mobile.mjs');

  for (const sql of [migration078, schema]) {
    assert.match(sql, /create or replace function public\.write_audit_log\(/i);
    assert.match(sql, /'last_seen_at'/);
    assert.match(sql, /'chat_privacy'/);
    assert.match(sql, /'username'/);
    assert.match(sql, /'bio'/);
    assert.match(sql, /if tg_op = 'UPDATE' and v_old = v_new then\s+return (?:new|null);\s+end if;/i);
  }
  assert.match(migration078, /delete from public\.audit_logs/i);
  assert.match(migration078, /'20261115_078'/);

  for (const noiseField of ['last_seen_at', 'chat_privacy', 'username', 'bio']) {
    assert.match(core, new RegExp(`'${noiseField}'`));
  }

  assert.doesNotMatch(prepareMobile, /class="offline-brand"|favicon\.svg|<img\b|alt="myIPON"/i);
  assert.match(prepareMobile, /<h1>You appear to be offline<\/h1>/);
  const bundledOffline = read('android/app/src/main/assets/public/offline.html');
  assert.doesNotMatch(bundledOffline, /class="offline-brand"|favicon\.svg|<img\b|<svg\b|alt="myIPON"/i);
  assert.match(bundledOffline, /<h1>You appear to be offline<\/h1>/);
});

test('chat captionless media overlay and audit log calendar date-range chips meet UI reliability contracts', () => {
  const auditHtml = read('audit.html');
  const auditJs = read('js/audit.js');
  const css = read('css/app.css');

  // Chat captionless media & timestamp grouping CSS
  assert.match(css, /\.msg-bubble\.has-top-media\.is-media-only\s*\{/);
  assert.match(css, /\.msg-bubble-meta\.is-media-overlay\s*\{/);
  assert.match(css, /\.msg-bubble\.is-video-controls-active\s+\.msg-bubble-meta\.is-media-overlay\s*\{/);
  assert.match(css, /\.msg-bubble-meta\.is-tick-only\s*\{/);
  assert.match(css, /\.msg-send-progress\.is-media-overlay\s*\{/);

  // Audit Log calendar range chips & filter bar DOM + JS + CSS
  assert.match(auditHtml, /class="panel-header audit-panel-header"/);
  assert.match(auditHtml, /class="table-filters audit-filters"/);
  assert.match(auditHtml, /id="audit-search-clear"/);
  assert.match(auditHtml, /class="audit-date-range"/);
  assert.match(auditHtml, /data-date-chip="audit-date-from"[\s\S]*?id="audit-date-from-label">\s*Start date\s*<[\s\S]*?id="audit-date-from"[\s\S]*?data-clear-date="audit-date-from"/);
  assert.match(auditHtml, /data-date-chip="audit-date-to"[\s\S]*?id="audit-date-to-label">\s*End date\s*<[\s\S]*?id="audit-date-to"[\s\S]*?data-clear-date="audit-date-to"/);
  assert.match(auditHtml, /id="audit-filters-reset"[^>]*hidden/);

  assert.match(auditJs, /function formatFilterDate\(iso\)/);
  assert.match(auditJs, /function syncAuditFilterUi\(changedInput = null\)/);
  assert.match(auditJs, /showPicker\?\.\(\)/);
  assert.match(auditJs, /dateToInput\.value = dateFromInput\.value/);
  assert.match(auditJs, /dateFromInput\.value = dateToInput\.value/);
  assert.match(auditJs, /\[data-clear-date\]/);
  assert.match(auditJs, /audit-filters-reset/);

  assert.match(css, /\.table-filters\.audit-filters\s*\{/);
  assert.match(css, /\.audit-date-range\s*\{/);
  assert.match(css, /\.date-filter-chip\s*\{/);
  assert.match(css, /\.date-filter-chip\s+input\[type="date"\]::-webkit-calendar-picker-indicator\s*\{/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.date-filter-chip\b/);

  // Uniform chat photo thumbnail frame, aligned mobile bubble gutters, full-size image viewer toggle, centered voice speaker button, mobile 3-dots preservation, and Pic 2 Friends hero card
  const coreJs = read('js/core.js');
  const msgJs = read('js/messages.js');
  assert.match(css, /\.msg-att-image\s*\{[^}]*width:\s*clamp\(176px,\s*56vw,\s*232px\);\s*max-width:\s*100%;\s*height:\s*220px;/s);
  assert.match(css, /\.msg-attachments\.is-carousel\s*>\s*\.msg-att-image\s*\{[^}]*width:\s*clamp\(176px,\s*56vw,\s*232px\);\s*height:\s*220px;/s);
  assert.match(css, /\.msg-bubble-col,\s*\.msg-row\.is-mine\s+\.msg-bubble-col\s*\{\s*max-width:\s*min\(520px,\s*calc\(100%\s*-\s*72px\)\);\s*\}/s);
  assert.doesNotMatch(css, /@media\s*\(max-width:\s*720px\)\s*\{[^}]*\.msg-bubble-col\s*\{\s*max-width:\s*86%;/s);
  assert.match(css, /\.msg-voice-wave\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.msg-voice-mute-btn\s*\{[^}]*align-self:\s*center;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.msg-att-image img\s*\{[^}]*width:\s*100%;\s*height:\s*100%;[^}]*object-fit:\s*cover;/s);
  assert.match(css, /\.msg-row-actions \.msg-action-mini\[data-msg-act="react"\],\s*\.msg-row-actions \.msg-action-mini\[data-msg-act="reply"\]\s*\{\s*display:\s*none;\s*\}/s);
  assert.match(coreJs, /dialog\.id = 'ipon-image-viewer'[\s\S]*?id="ipon-iv-close"[\s\S]*?id="ipon-iv-title"[\s\S]*?class="image-viewer-dl-pill" id="ipon-iv-download"[\s\S]*?is-actual-size[\s\S]*?naturalWidth[\s\S]*?naturalHeight/);
  assert.doesNotMatch(coreJs, /id="ipon-iv-zoom"/);
  assert.match(css, /\.image-viewer-sheet\s*\{[^}]*background:\s*#05110d;/s);
  assert.match(css, /\.image-viewer-dl-pill\s*\{[^}]*border-radius:\s*999px;[^}]*background:\s*#e6c678;/s);
  assert.match(css, /\.image-viewer-header \.dialog-close\s*\{[^}]*width:\s*38px;\s*height:\s*38px;[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%/s);
  assert.match(css, /\.image-viewer-stage\.is-actual-size img\s*\{[^}]*max-width:\s*none;[^}]*max-height:\s*none;/s);
  assert.match(css, /\.msg-pinned-pill\s*\{[^}]*background:\s*var\(--thread-pin-pill-bg,\s*linear-gradient\(135deg,\s*#ecf5ef\s+0%,\s*#e1efe6\s+100%\)\);[\s\S]*?\.msg-pinned-panel\s*\{/s);
  assert.doesNotMatch(css, /\.msg-pinned-item-unpin/);
  assert.match(css, /\.msg-bubble-wrap\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*6px;/s);
  assert.match(msgJs, /function syncActivePinnedHighlight\(/);
  assert.match(msgJs, /isActivePinned\s*=\s*Boolean\(isPinned\s*&&\s*!isDeleted\s*&&\s*state\.activePinnedId\s*&&\s*m\.id\s*===\s*state\.activePinnedId\)/);
  assert.match(css, /\.msg-friends-hero\s*\{[\s\S]*?\.msg-friends-tabs\s*\{[\s\S]*?\.msg-friends-tab\.is-active::after\s*\{/s);
  assert.match(css, /\.msg-unread-sep span\s*\{[^}]*background:\s*#15533e;/s);
  assert.doesNotMatch(css, /\.msg-unread-sep[^{]*\{[^}]*#b83a2d/);
  assert.match(css, /\.msg-reply-quote\s*\{[^}]*border:\s*0;[^}]*border-radius:/s);
  assert.doesNotMatch(css, /\.msg-reply-quote\s*\{[^}]*border-left:/s);
  assert.doesNotMatch(css, /\.msg-react-quick-actions|\.msg-quick-act-btn|@keyframes\s+msgReactPop/);
  assert.doesNotMatch(msgJs, /msg-react-quick-actions|showActions/);
  assert.match(msgJs, /data-ctx-do="reply"[^>]*>Reply<\/button>/);
  assert.match(css, /\.msg-img-open-btn,\s*\.msg-img-open-btn img,\s*\.msg-video-player,\s*\.msg-att-video\s*\{[^}]*-webkit-touch-callout:\s*none;/s);
  assert.match(css, /\.msg-floating-menu\s*\{[^}]*opacity:\s*0;[^}]*transition:/s);
  assert.match(css, /\.msg-floating-menu\.is-visible\s*\{[^}]*opacity:\s*1;/s);
  assert.match(css, /\.msg-floating-menu\.is-leaving\s*\{[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;/s);
  assert.match(css, /\.msg-floating-menu\[data-placed="below"\]\s*\{/);
  assert.match(msgJs, /HOLD_EXCLUDE_SEL\s*=/);
  assert.match(msgJs, /function revealFloatingMenu\(menu\)/);
  assert.match(msgJs, /showReactionFloatingMenu\([^)]*\{\s*toggle:\s*false\s*\}/);
  assert.match(msgJs, /threadInfoView:\s*'root'/);
  assert.doesNotMatch(msgJs, /media\.slice\(-9\)|docs\.slice\(-8\)/);
  assert.match(css, /\.msg-drawer-body\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.msg-drawer-back\s*\{[^}]*aspect-ratio:\s*1 \/ 1;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.msg-drawer-nav-btn\s*\{[\s\S]*?\.msg-drawer-file-badge\s*\{/s);

  // User profile popover card & scalable multi-group drawer
  assert.match(msgJs, /function renderSharedGroupsCard\(/);
  assert.doesNotMatch(msgJs, /shared_groups\.slice\(0,\s*2\)/);
  assert.match(msgJs, /data-pop-groups-toggle/);
  assert.match(css, /\.msg-profile-popover\s*\{[^}]*border-radius:\s*22px;[^}]*background:\s*#faf7ef;/s);
  assert.match(css, /\.msg-profile-popover\s+\.msg-pop-close\s*\{[^}]*width:\s*34px\s*!important;[^}]*height:\s*34px\s*!important;/s);
  assert.match(css, /\.msg-pop-groups-card\s*\{[^}]*border-radius:\s*14px;[^}]*background:\s*#f2ede0;/s);
  assert.match(css, /\.msg-pop-groups-list\s*\{[^}]*max-height:\s*128px;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /\.msg-pop-primary-btn\s*\{[^}]*background:\s*#142620;/s);
  assert.match(css, /\.msg-pop-secondary-row\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(css, /html\[data-theme="dark"\]\s+\.msg-pop-groups-card\s*\{/);
});

test('friendlyError offline mapping, edge-to-edge pinch-zoom image viewer, native downloads, and microphone permission runtime contracts', async () => {
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');
  const css = read('css/app.css');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const infoPlist = read('ios/App/App/Info.plist');

  // CSS edge-to-edge full-screen image viewer with Messenger overlay chrome & pinch touch-action
  assert.match(css, /\.image-viewer-stage\s*\{[^}]*padding:\s*0;[^}]*touch-action:\s*none;/s);
  assert.match(css, /\.image-viewer-stage img\s*\{[^}]*width:\s*100%;\s*height:\s*100%;[^}]*border-radius:\s*0;\s*border:\s*0;[^}]*object-fit:\s*contain;/s);
  assert.match(css, /\.image-viewer-dialog\.is-chrome-hidden \.image-viewer-header\s*\{[^}]*opacity:\s*0;/s);

  // Android & iOS native mic + download contracts
  assert.match(mainActivity, /maybeRequestStartupPermissions\(/);
  assert.match(mainActivity, /Manifest\.permission\.POST_NOTIFICATIONS/);
  assert.doesNotMatch(mainActivity, /maybeRequestStartupPermissions\([\s\S]*?Manifest\.permission\.RECORD_AUDIO/);
  assert.match(mainActivity, /webView\.setDownloadListener\(/);
  assert.match(bgPlugin, /Manifest\.permission\.RECORD_AUDIO,\s*Manifest\.permission\.MODIFY_AUDIO_SETTINGS[\s\S]*?alias\s*=\s*"microphone"/);
  assert.match(bgPlugin, /hasManifestPermission\(/);
  assert.match(bgPlugin, /shouldShowRequestPermissionRationale\(/);
  assert.match(bgPlugin, /public void ensureMicrophonePermission\(PluginCall call\)/);
  assert.match(bgPlugin, /public void openAppSettings\(PluginCall call\)/);
  assert.match(bgPlugin, /public void downloadFile\(PluginCall call\)/);
  assert.match(bgPlugin, /DownloadManager\.Request/);
  assert.match(bgPlugin, /MediaStore\.Downloads\.EXTERNAL_CONTENT_URI/);
  assert.match(infoPlist, /NSMicrophoneUsageDescription/);
  assert.match(messagesJs, /ensureMicrophoneAccess\(\)[\s\S]*?showMicApkUpdateNotice\(\)[\s\S]*?offerOpenAppSettingsForMic\(\)/);
  assert.match(messagesJs, /downloadOriginalAttachment[\s\S]*?ipon\(\)\.downloadFile\(/);
  assert.match(coreJs, /touchstart[\s\S]*?touchmove[\s\S]*?touchDist[\s\S]*?applyZoom/);

  // Execute js/core.js in VM to verify friendlyError & Ipon.downloadFile runtime behavior
  const makeNode = (tag) => ({
    tagName: String(tag || 'DIV').toUpperCase(),
    dataset: {},
    style: { setProperty() { }, removeProperty() { } },
    classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
    setAttribute() { },
    removeAttribute() { },
    addEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => [],
    append() { },
    prepend() { },
    appendChild() { },
    insertAdjacentHTML() { },
    remove() { },
    click() { }
  });
  const nativeDlCalls = [];
  const webAnchors = [];
  const navState = { onLine: false };
  const docStub = {
    body: Object.assign(makeNode('body'), {
      appendChild(n) { webAnchors.push(n); return n; },
      dataset: {}
    }),
    head: makeNode('head'),
    documentElement: makeNode('html'),
    createElement: (t) => makeNode(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() { }
  };
  let blobReads = 0;
  const ctx = {
    URLSearchParams,
    URL: {
      createObjectURL: () => 'blob:mock-dl-1',
      revokeObjectURL() { }
    },
    Blob: class { constructor(parts, opts) { this.parts = parts; this.type = opts?.type || ''; } },
    FileReader: class {
      readAsDataURL() { this.result = 'data:image/jpeg;base64,QUJD'; this.onload?.(); }
    },
    CustomEvent: class { },
    Intl, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, TypeError,
    navigator: navState,
    location: { origin: 'https://myipon.example', href: 'https://myipon.example/dashboard.html', pathname: '/dashboard.html', search: '', hostname: 'myipon.example', protocol: 'https:', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    Capacitor: {
      Plugins: {
        BackgroundNotifications: {
          downloadFile: async (args) => { nativeDlCalls.push(args); return { started: true, saved: false, fileName: args.fileName }; }
        }
      }
    },
    fetch: async () => {
      blobReads += 1;
      return { ok: true, status: 200, blob: async () => ({ type: 'image/jpeg' }) };
    },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { },
    setTimeout,
    clearTimeout,
    document: docStub,
    window: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  // Offline & runtime error messages never leak TypeError: Failed to fetch
  assert.equal(ctx.window.Ipon.friendlyError(new TypeError('Failed to fetch')), 'No internet connection. Please check your connection and try again.');
  navState.onLine = true;
  assert.equal(ctx.window.Ipon.friendlyError(new TypeError('Failed to fetch')), 'Something went wrong. Please check your internet connection and try again.');
  assert.equal(ctx.window.Ipon.friendlyError({ message: 'TypeError: Failed to fetch' }), 'Something went wrong. Please check your internet connection and try again.');
  assert.equal(ctx.window.Ipon.friendlyError(new Error('Load failed')), 'Something went wrong. Please check your internet connection and try again.');
  assert.equal(ctx.window.Ipon.friendlyError({ message: "TypeError: Cannot read properties of undefined (reading 'x')" }), 'Something went wrong. Please try again.');
  assert.equal(ctx.window.Ipon.friendlyError({ message: 'Record not found.' }), 'Record not found.');

  // Native APK download path converts blob: to data: and passes safe fileName
  await ctx.window.Ipon.downloadFile('https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/sign/chat/a.jpg', 'IMG/1026.jpeg');
  assert.equal(nativeDlCalls.length, 1);
  assert.equal(nativeDlCalls[0].fileName, 'IMG-1026.jpeg');
  await ctx.window.Ipon.downloadFile('blob:https://myipon.example/123', 'preview.jpg');
  assert.equal(blobReads, 1);
  assert.equal(nativeDlCalls[1].url, 'data:image/jpeg;base64,QUJD');

  // Web browser cross-origin download uses fetch -> blob: URL so <a download> works seamlessly
  delete ctx.Capacitor.Plugins.BackgroundNotifications;
  await ctx.window.Ipon.downloadFile('https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/sign/chat/a.jpg', 'photo.jpg');
  assert.equal(blobReads, 2);
  assert.equal(webAnchors[0].href, 'blob:mock-dl-1');
  assert.equal(webAnchors[0].download, 'photo.jpg');
});

test('mobile APK background usage controls render in My account and auto-prompt new users once until granted', async () => {
  const coreJs = read('js/core.js');
  const accountHtml = read('account.html');
  const accountJs = read('js/account.js');
  const css = read('css/app.css');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');

  assert.match(accountHtml, /data-device-background-row/);
  assert.match(accountJs, /syncDevicePermissionUI/);
  assert.match(coreJs, /id="account-dialog"[\s\S]*?data-device-background-row/);
  assert.match(coreJs, /function maybePromptBackgroundUsage/);
  assert.match(coreJs, /function requestBackgroundUsageAccess/);
  assert.match(css, /\.preference-background-row\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.bg-usage-dialog/);
  assert.match(mainActivity, /public void onResume\(\)[\s\S]*?NotificationSyncService\.ensureStarted\(this\)/);
  assert.match(bgPlugin, /result\.put\("alreadyIgnored",\s*alreadyIgnored\)/);
  assert.match(bgPlugin, /ACTION_APPLICATION_DETAILS_SETTINGS/);

  const makeMockEl = (tag = 'div') => {
    const attrs = {};
    const dataset = {};
    const children = [];
    let hidden = false;
    let textContent = '';
    const el = {
      tagName: tag.toUpperCase(),
      id: '',
      className: '',
      type: '',
      open: false,
      disabled: false,
      dataset,
      style: { setProperty() { }, removeProperty() { } },
      get hidden() { return hidden; },
      set hidden(v) { hidden = Boolean(v); if (hidden) attrs.hidden = ''; else delete attrs.hidden; },
      get textContent() { return textContent; },
      set textContent(v) { textContent = String(v ?? ''); },
      set innerHTML(v) { el._html = String(v ?? ''); },
      get innerHTML() { return el._html || ''; },
      classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
      setAttribute(k, v) { attrs[k] = String(v); if (k === 'id') el.id = String(v); if (k === 'data-tone') dataset.tone = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      hasAttribute(k) { return k in attrs; },
      removeAttribute(k) { delete attrs[k]; },
      addEventListener() { },
      appendChild(child) { children.push(child); child.parentNode = el; return child; },
      append(...nodes) { nodes.forEach((n) => el.appendChild(n)); },
      prepend() { },
      insertBefore(n) { return el.appendChild(n); },
      insertAdjacentHTML() { },
      dispatchEvent() { return true; },
      showModal() { el.open = true; },
      close() { el.open = false; },
      remove() { el._removed = true; },
      querySelector(sel) {
        if (sel === '[data-device-bg-pill]') return el._pill || null;
        if (sel === '[data-device-bg-status]') return el._status || null;
        if (sel === '[data-device-bg-actions]') return el._actions || null;
        if (sel === '[data-device-bg-btn]') return el._btn || null;
        if (sel === '[data-bg-prompt-notif-badge]') return el._notifBadge || null;
        if (sel === '[data-bg-prompt-battery-badge]') return el._batBadge || null;
        if (sel === '[data-bg-prompt-allow]') return el._allowBtn || null;
        if (sel === '[data-bg-prompt-settings]') return el._settingsBtn || null;
        if (sel === '[data-bg-prompt-hint]') return el._hint || null;
        return null;
      },
      querySelectorAll(sel) {
        if (sel === '[data-device-bg-extra]') return children.filter((c) => c.hasAttribute('data-device-bg-extra') && !c._removed);
        return [];
      }
    };
    return el;
  };

  const buildBgRow = () => {
    const row = makeMockEl('div');
    row.hidden = true;
    row._pill = makeMockEl('span');
    row._status = makeMockEl('small');
    row._actions = makeMockEl('div');
    row._btn = makeMockEl('button');
    row._actions.appendChild(row._btn);
    return row;
  };

  const bgRow = buildBgRow();
  let promptDialog = null;
  const store = new Map();
  let nativePermState = { hasPermission: false, batteryOptimizationIgnored: false, instantSyncEnabled: true, instantSyncRunning: false, androidSdk: 34 };
  let capPermDisplay = 'prompt';
  let requestPermCalls = 0;
  let requestBatteryCalls = 0;
  const toasts = [];
  const loaderStub = makeMockEl('div');
  const docStub = {
    documentElement: makeMockEl('html'),
    head: makeMockEl('head'),
    body: Object.assign(makeMockEl('body'), {
      dataset: {},
      append(node) {
        if (node?.id === 'background-usage-prompt-dialog') {
          node._notifBadge = makeMockEl('span');
          node._batBadge = makeMockEl('span');
          node._allowBtn = makeMockEl('button');
          node._settingsBtn = makeMockEl('button');
          node._hint = makeMockEl('p');
          promptDialog = node;
        }
      }
    }),
    createElement: (tag) => makeMockEl(tag),
    getElementById: (id) => (
      id === 'background-usage-prompt-dialog'
        ? promptDialog
        : (id === 'page-loader' ? loaderStub : makeMockEl('div'))
    ),
    querySelector: (sel) => (sel === 'dialog[open]' && promptDialog?.open ? promptDialog : null),
    querySelectorAll: (sel) => (sel === '[data-device-background-row]' ? [bgRow] : []),
    addEventListener() { }
  };
  const navStub = {
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 myIPONApp/20',
    onLine: true,
    serviceWorker: null
  };
  const ctx = {
    window: null,
    document: docStub,
    navigator: navStub,
    location: { origin: 'https://myipon.example', href: 'https://myipon.example/dashboard.html', pathname: '/dashboard.html', search: '', hostname: 'myipon.example', protocol: 'https:', replace() { } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); }
    },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    Capacitor: {
      Plugins: {
        LocalNotifications: {
          checkPermissions: async () => ({ display: capPermDisplay }),
          requestPermissions: async () => {
            requestPermCalls += 1;
            capPermDisplay = 'granted';
            nativePermState.hasPermission = true;
            return { display: 'granted' };
          },
          createChannel: async () => { }
        },
        BackgroundNotifications: {
          getBackgroundStatus: async () => ({ ...nativePermState }),
          requestSystemPermission: async () => ({ hasPermission: true }),
          requestIgnoreBatteryOptimizations: async () => {
            requestBatteryCalls += 1;
            nativePermState.batteryOptimizationIgnored = true;
            return { launched: true, alreadyIgnored: false };
          },
          openAppSettings: async () => ({ launched: true }),
          openNotificationSettings: async () => ({ launched: true })
        }
      }
    },
    Notification: { permission: 'default' },
    CustomEvent: class { },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent(evt) { toasts.push(evt); },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  docStub.body.dataset.page = 'dashboard';

  // 1. Desktop PC hides background usage row and does not prompt
  const savedUa = navStub.userAgent;
  const savedCap = ctx.Capacitor;
  navStub.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
  ctx.Capacitor = null;
  await ctx.window.Ipon.syncDevicePermissionUI();
  assert.equal(bgRow.hidden, true);
  assert.equal(await ctx.window.Ipon.maybePromptBackgroundUsage({ id: 'u1', status: 'ACTIVE', notifications_enabled: true }, { immediate: true }), false);

  // 2. Android APK shows row in My account and opens prompt once for new user
  navStub.userAgent = savedUa;
  ctx.Capacitor = savedCap;
  await ctx.window.Ipon.syncDevicePermissionUI();
  assert.equal(bgRow.hidden, false);
  assert.equal(bgRow._pill.textContent, 'Needs access');
  assert.equal(bgRow._btn.textContent, 'Allow background usage');

  const openedFirst = await ctx.window.Ipon.maybePromptBackgroundUsage({ id: 'u-new-1', status: 'ACTIVE', notifications_enabled: true, first_name: 'Juan', last_name: 'Dela Cruz', contact_number: '09171234567' }, { immediate: true });
  assert.equal(openedFirst, true);
  assert.equal(promptDialog?.open, true);
  assert.equal(store.get('myipon_bg_prompt_seen_u-new-1'), '1');

  // Calling again does not re-open once seen
  promptDialog.open = false;
  const openedSecond = await ctx.window.Ipon.maybePromptBackgroundUsage({ id: 'u-new-1', status: 'ACTIVE', notifications_enabled: true, first_name: 'Juan', last_name: 'Dela Cruz', contact_number: '09171234567' }, { immediate: true });
  assert.equal(openedSecond, false);

  // 3. Granting both notification permission and background battery updates UI & closes prompt cleanly
  promptDialog.open = true;
  const outcome = await ctx.window.Ipon.requestBackgroundUsageAccess({ fromPrompt: true });
  assert.equal(requestPermCalls, 1);
  assert.equal(requestBatteryCalls, 1);
  assert.equal(outcome.granted, true);
  assert.equal(promptDialog.open, false);
  assert.equal(bgRow._pill.textContent, 'Active');
  assert.equal(bgRow._btn.textContent, 'Granted');
  assert.equal(bgRow._btn.disabled, true);
  assert.ok(bgRow._actions.querySelectorAll('[data-device-bg-extra]').some((b) => b.textContent === 'App settings'));

  // 4. Restricted state when notifications ON but battery restriction ON
  nativePermState.batteryOptimizationIgnored = false;
  await ctx.window.Ipon.syncDevicePermissionUI();
  assert.equal(bgRow._pill.textContent, 'Restricted');
  assert.equal(bgRow._btn.textContent, 'Allow background usage');
  assert.equal(bgRow._btn.disabled, false);
});

test('mobile back stack, receipt checkmarks (sent/delivered/seen), chat video previews, custom Pic 3 video viewer, and flicker-free reactions work end-to-end', async () => {
  const vm = await import('node:vm');
  const mainJava = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const css = read('css/app.css');
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');

  // 1. Static source & styling contracts
  assert.match(mainJava, /import androidx\.activity\.OnBackPressedCallback;/);
  assert.match(mainJava, /window\.Ipon\.handleNativeBack/);
  assert.match(mainJava, /performDefaultBack\(/);
  assert.match(mainJava, /public void onWindowFocusChanged\(boolean hasFocus\)/);
  assert.match(css, /\.msg-scroll-wrap[\s\S]*?overflow-anchor:\s*auto;/);
  assert.doesNotMatch(css, /\.msg-tick\.is-delivered,\s*\n\s*\.msg-tick\.is-read/);
  assert.match(css, /\.msg-tick\.is-delivered\s*\{\s*color:\s*#7c8a83;/);
  assert.match(css, /\.msg-tick\.is-read\s*\{\s*color:\s*#16a34a;/);
  assert.match(css, /\.msg-row\.is-mine \.msg-tick\.is-read\s*\{\s*color:\s*#5ef29d;/);
  assert.match(css, /\.msg-video-player\s*\{[\s\S]*?aspect-ratio:\s*var\(--vid-ar/);
  assert.match(css, /\.msg-att-video::-webkit-media-controls[\s\S]*?display:\s*none\s*!important;/);
  assert.match(css, /\.video-viewer-dialog \.msg-video-controls\.is-viewer-dock/);
  assert.match(css, /\.msg-video-center-play\b/);

  // 2. core.js runtime: openVideoViewer (Pic 3 dock, no native controls) & step-by-step handleNativeBack
  const idMap = new Map();
  const makeCoreEl = (tag) => {
    const cls = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    let html = '';
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      open: false,
      hidden: false,
      disabled: false,
      muted: false,
      paused: true,
      duration: 5.2,
      currentTime: 0,
      textContent: '',
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (c) => cls.add(c),
        remove: (c) => cls.delete(c),
        toggle: (c, f) => {
          if (f === undefined ? !cls.has(c) : f) cls.add(c);
          else cls.delete(c);
        },
        contains: (c) => cls.has(c)
      },
      attributes: attrs,
      children,
      appendChild(c) { children.push(c); return c; },
      append(...nodes) { children.push(...nodes); },
      prepend() { },
      insertBefore(n) { return n; },
      insertAdjacentHTML() { },
      remove() { },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
      removeAttribute(k) { attrs.delete(k); },
      hasAttribute(k) { return attrs.has(k); },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      dispatchEvent(ev) { (listeners.get(ev?.type) || []).forEach((fn) => fn(ev)); },
      showModal() { this.open = true; },
      close() { this.open = false; this.dispatchEvent({ type: 'close' }); },
      play() { this.paused = false; this.dispatchEvent({ type: 'play' }); return Promise.resolve(); },
      pause() { this.paused = true; this.dispatchEvent({ type: 'pause' }); },
      load() { },
      removeEventListener() { },
      focus() { },
      querySelector(sel) {
        const idMatch = /^#([A-Za-z0-9_-]+)$/.exec(sel);
        if (idMatch) return idMap.get(idMatch[1]) || null;
        return null;
      },
      querySelectorAll: () => []
    };
    Object.defineProperty(el, 'id', {
      get: () => attrs.get('id') || '',
      set: (v) => { attrs.set('id', String(v)); if (v) idMap.set(String(v), el); }
    });
    Object.defineProperty(el, 'className', {
      get: () => [...cls].join(' '),
      set: (v) => {
        cls.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => cls.add(c));
      }
    });
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set: (v) => {
        html = String(v ?? '');
        for (const m of html.matchAll(/<([a-z0-9-]+)([^>]*?)\bid="([^"]+)"([^>]*)>/gi)) {
          const cid = m[3];
          const child = idMap.get(cid) || makeCoreEl(m[1]);
          child.id = cid;
          const classMatch = /\bclass="([^"]+)"/i.exec(`${m[2]} ${m[4]}`);
          if (classMatch) child.className = classMatch[1];
          if (/download/i.test(m[1]) || cid === 'ipon-vv-download') child.hidden = true;
          idMap.set(cid, child);
        }
      }
    });
    return el;
  };

  let backNavPending = false;
  let locAssigned = '';
  const coreLoaderEl = makeCoreEl('div');
  const coreDoc = {
    documentElement: makeCoreEl('html'),
    head: makeCoreEl('head'),
    body: Object.assign(makeCoreEl('body'), { dataset: { page: 'contributions' } }),
    createElement: (tag) => makeCoreEl(tag),
    getElementById: (id) => (id === 'app-loader' ? coreLoaderEl : (idMap.get(id) || null)),
    querySelector: (sel) => {
      if (sel === 'dialog[open]') {
        for (const el of idMap.values()) {
          if (el.tagName === 'DIALOG' && el.open) return el;
        }
        return null;
      }
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel === 'dialog[open]') {
        return [...idMap.values()].filter((el) => el.tagName === 'DIALOG' && el.open);
      }
      return [];
    },
    addEventListener() { }
  };
  const coreCtx = {
    window: null,
    document: coreDoc,
    navigator: { userAgent: 'myIPONApp/21', onLine: true },
    location: {
      origin: 'https://myipon.example',
      href: 'https://myipon.example/contributions.html',
      pathname: '/contributions.html',
      search: '',
      replace(url) { locAssigned = url; },
      assign(url) { locAssigned = url; }
    },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    IponMessages: {
      dismissTransientMenus: () => false,
      handleBackNavigation: () => {
        if (!backNavPending) return false;
        backNavPending = false;
        return true;
      }
    },
    CustomEvent: class { },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { },
    console
  };
  coreCtx.window = coreCtx;
  vm.runInNewContext(coreJs, coreCtx, { filename: 'js/core.js' });
  assert.equal(typeof coreCtx.window.Ipon.openVideoViewer, 'function');
  assert.equal(typeof coreCtx.window.Ipon.handleNativeBack, 'function');

  coreCtx.window.Ipon.openVideoViewer('https://cdn.example/clip.mp4', 'Video', 'Shared in chat', 'clip.mp4', { aspectRatio: '16 / 9' });
  const vvDialog = idMap.get('ipon-video-viewer');
  const vvVideo = idMap.get('ipon-vv-video');
  const vvControls = idMap.get('ipon-vv-controls');
  assert.equal(vvDialog?.open, true);
  assert.equal(vvVideo?.hasAttribute('controls'), false, 'custom lightbox video must omit native browser controls bar');
  assert.ok(vvControls?.classList.contains('msg-video-controls') && vvControls?.classList.contains('is-viewer-dock'));

  // Back step 1: video viewer closes first
  assert.equal(coreCtx.window.Ipon.handleNativeBack(), 'handled');
  assert.equal(vvDialog.open, false);

  // Back step 2: message thread navigation unwinds, then workspace dialog closes, then sub-page returns to dashboard, then root exits
  const msgDialog = makeCoreEl('dialog');
  msgDialog.id = 'msg-workspace-dialog';
  msgDialog.open = true;
  backNavPending = true;
  assert.equal(coreCtx.window.Ipon.handleNativeBack(), 'handled');
  assert.equal(backNavPending, false);
  assert.equal(coreCtx.window.Ipon.handleNativeBack(), 'handled');
  assert.equal(msgDialog.open, false);
  assert.equal(coreCtx.window.Ipon.handleNativeBack(), 'handled');
  assert.equal(coreCtx.location.href, 'dashboard.html');
  coreDoc.body.dataset.page = 'dashboard';
  coreCtx.location.pathname = '/dashboard.html';
  assert.equal(coreCtx.window.Ipon.handleNativeBack(), 'exit');

  // 3. messages.js runtime: ticks (1 gray / 2 gray / 2 green), mobile visibility read guard, video preview poster & lightbox, flicker-free reactions
  const meId = '00000000-0000-0000-0000-000000000010';
  const peerId = '00000000-0000-0000-0000-000000000020';
  const convId = '00000000-0000-0000-0000-0000000000c1';
  const msgEls = new Map();
  const msgTableHandlers = new Map();
  const msgDocListeners = new Map();
  const msgRpcCalls = [];
  const videoViewerCalls = [];
  let threadHtmlWrites = 0;
  let reqFullscreenCalls = 0;

  let mockChatTheme = 'paper';
  let currentMsgs = [
    { id: 'm-sent', conversation_id: convId, sender_id: meId, body: 'Only sent', message_type: 'TEXT', created_at: '2026-11-15T10:00:00Z', delivered_at: null, read_at: null, attachments: [], reactions: [] },
    { id: 'm-deliv', conversation_id: convId, sender_id: meId, body: 'Delivered only', message_type: 'TEXT', created_at: '2026-11-15T10:01:00Z', delivered_at: '2026-11-15T10:01:02Z', read_at: null, attachments: [], reactions: [] },
    { id: 'm-seen', conversation_id: convId, sender_id: meId, body: 'Seen by peer', message_type: 'TEXT', created_at: '2026-11-15T10:02:00Z', delivered_at: '2026-11-15T10:02:02Z', read_at: '2026-11-15T10:02:05Z', attachments: [], reactions: [] },
    {
      id: 'm-vid',
      conversation_id: convId,
      sender_id: peerId,
      body: '',
      message_type: 'MEDIA',
      created_at: '2026-11-15T10:03:00Z',
      delivered_at: '2026-11-15T10:03:01Z',
      read_at: '2026-11-15T10:03:02Z',
      attachments: [{ path: `${convId}/preview-clip.mp4`, kind: 'video', name: 'preview-clip.mp4', size: 120000 }],
      reactions: []
    }
  ];

  const makeMsgEl = (id) => {
    const cls = new Set();
    const attrs = new Map();
    const elListeners = new Map();
    let html = '';
    const el = {
      id,
      hidden: false,
      open: false,
      value: '',
      scrollTop: 500,
      scrollHeight: 500,
      clientHeight: 500,
      dataset: {},
      style: { setProperty() { } },
      classList: {
        add: (c) => cls.add(c),
        remove: (c) => cls.delete(c),
        toggle: (c, f) => {
          if (f === undefined ? !cls.has(c) : f) cls.add(c);
          else cls.delete(c);
        },
        contains: (c) => cls.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      hasAttribute: (k) => attrs.has(k),
      addEventListener: (ev, fn) => {
        if (!elListeners.has(ev)) elListeners.set(ev, []);
        elListeners.get(ev).push(fn);
      },
      dispatchEvent: (ev) => { (elListeners.get(ev?.type) || []).forEach((fn) => fn(ev)); },
      focus: () => { },
      select: () => { },
      querySelectorAll: () => [],
      querySelector: () => null,
      showModal() { this.open = true; },
      close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
    };
    Object.defineProperty(el, 'innerHTML', {
      get: () => html,
      set: (v) => {
        html = String(v ?? '');
        if (id === 'msg-messages-list') threadHtmlWrites += 1;
      }
    });
    return el;
  };
  const getMsgEl = (id) => {
    if (!msgEls.has(id)) msgEls.set(id, makeMsgEl(id));
    return msgEls.get(id);
  };

  let focusedState = true;
  let mockUnreadFirstId = null;
  const msgWinListeners = new Map();
  const msgDoc = {
    documentElement: { dataset: {} },
    visibilityState: 'visible',
    hasFocus: () => focusedState,
    body: { insertAdjacentHTML() { }, appendChild() { } },
    createElement: (tag) => makeMsgEl(tag),
    getElementById: (id) => getMsgEl(id),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => {
      if (!msgDocListeners.has(ev)) msgDocListeners.set(ev, []);
      msgDocListeners.get(ev).push(fn);
    }
  };
  const msgWin = {
    innerWidth: 390,
    innerHeight: 844,
    matchMedia: (q) => {
      const m = /max-width:\s*(\d+)px/.exec(String(q || ''));
      return { matches: m ? msgWin.innerWidth <= Number(m[1]) : false };
    },
    Ipon: {
      escapeHtml: (s) => String(s ?? ''),
      initials: () => 'PU',
      isUserOnline: () => true,
      bindAvatarFallbacks: () => { },
      syncPresenceDots: () => { },
      syncMessagesBadges: () => { },
      setFieldError: () => { },
      setBusy: () => { },
      friendlyError: (e) => String(e?.message || e),
      toast: () => { },
      confirmAction: async () => true,
      openVideoViewer: (...args) => videoViewerCalls.push(args),
      invokeAccountFunction: async (payload) => (payload?.action === 'chat-view-urls'
        ? { urls: Object.fromEntries((payload.paths || []).map((p) => [p, `https://cdn.example/view/${encodeURIComponent(p)}`])) }
        : {}),
      rpc: async (name, params) => {
        msgRpcCalls.push(name);
        if (name === 'get_conversations') {
          return [{
            id: convId, status: 'ACCEPTED', initiator_id: peerId, is_incoming_request: false,
            chat_theme: mockChatTheme,
            peer: { id: peerId, full_name: 'Peer User', allow_online_status: true },
            unread_count: mockUnreadFirstId ? 1 : 0, marked_unread: false, last_message_at: '2026-11-15T10:03:00Z',
            last_message_preview: 'Video', last_message_sender_id: peerId
          }];
        }
        if (name === 'get_conversation_messages') {
          return {
            conversation: { id: convId, full_name: 'Peer User', status: 'ACCEPTED', friendship_status: 'FRIENDS', allow_online_status: true, receipts_enabled: true, chat_theme: mockChatTheme },
            has_older: false,
            unread_first_id: mockUnreadFirstId,
            pinned_messages: [],
            messages: currentMsgs
          };
        }
        if (name === 'update_conversation_member_state') {
          if (params?.p_action === 'theme' && params?.p_theme) mockChatTheme = String(params.p_theme);
          return { chat_theme: mockChatTheme };
        }
        if (name === 'mark_conversation_read') {
          mockUnreadFirstId = null;
          return { read_at: '2026-11-15T10:03:50Z', receipts_shared: true };
        }
        if (name === 'get_social_overview') {
          return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        }
        if (name === 'toggle_message_reaction') {
          const mid = params?.p_message_id;
          const emoji = params?.p_emoji;
          currentMsgs = currentMsgs.map((m) => (m.id === mid
            ? { ...m, reactions: [{ emoji, user_id: meId, user_name: 'Me' }] }
            : m));
          return { added: true };
        }
        return {};
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => ({
          on(kind, filter, cb) {
            if (kind === 'postgres_changes' && filter?.table) msgTableHandlers.set(filter.table, cb);
            return this;
          },
          subscribe() { return this; }
        })
      }
    },
    addEventListener: (ev, fn) => {
      if (!msgWinListeners.has(ev)) msgWinListeners.set(ev, []);
      msgWinListeners.get(ev).push(fn);
    },
    location: { search: '', href: 'https://myipon.example/dashboard.html' }
  };
  msgWin.window = msgWin;
  vm.runInNewContext(messagesJs, {
    window: msgWin,
    document: msgDoc,
    location: msgWin.location,
    Map, Set, URLSearchParams, navigator: {}, Math, JSON, Date, Intl,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => { } },
    CSS: { escape: (s) => String(s) },
    requestAnimationFrame: (fn) => fn(),
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => { }
  });

  await msgWin.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', chat_privacy: { show_online: true } });
  await msgWin.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  const initialThreadHtml = getMsgEl('msg-messages-list').innerHTML;

  // Sent = 1 gray check; Delivered = 2 gray checks; Seen = 2 green checks
  assert.match(initialThreadHtml, /Only sent[\s\S]*?<span class="msg-tick is-sent"[^>]*aria-label="Sent"><svg class="msg-tick-svg"[^>]*><path d="M3\.2 8\.6 6\.4 11\.8 13\.2 4\.6"\/><\/svg><\/span>/);
  assert.match(initialThreadHtml, /Delivered only[\s\S]*?<span class="msg-tick is-delivered"[^>]*aria-label="Delivered"><svg class="msg-tick-svg is-double"[\s\S]*?M7\.2 8\.6[\s\S]*?<\/svg><\/span>/);
  assert.match(initialThreadHtml, /Seen by peer[\s\S]*?<span class="msg-tick is-read"[^>]*aria-label="Seen"><svg class="msg-tick-svg is-double"[\s\S]*?M7\.2 8\.6[\s\S]*?<\/svg><\/span>/);

  // Inline video has SVG poster preview and custom center play button
  assert.match(initialThreadHtml, /class="msg-video-player"[\s\S]*?<video class="msg-att-video" preload="metadata" playsinline\s+poster="data:image\/svg\+xml/);
  assert.match(initialThreadHtml, /class="msg-video-center-play" data-vact="play"/);

  // Clicking fullscreen calls Ipon.openVideoViewer (never native requestFullscreen)
  const fsVideoEl = {
    currentSrc: 'https://cdn.example/view/clip.mp4',
    src: 'https://cdn.example/view/clip.mp4',
    videoWidth: 720,
    videoHeight: 1280,
    currentTime: 1.5,
    paused: true,
    poster: '',
    pause() { },
    requestFullscreen() { reqFullscreenCalls += 1; }
  };
  const fsPlayer = Object.assign(makeMsgEl('fs-player'), {
    dataset: { vidConv: convId, vidPath: `${convId}/preview-clip.mp4`, vidName: 'preview-clip.mp4', vidKey: `${convId}/preview-clip.mp4` },
    querySelector: (s) => (s === 'video' ? fsVideoEl : null),
    closest: () => null
  });
  const fsBtn = {
    dataset: { vact: 'fs' },
    closest: (s) => {
      if (s === '[data-vact]') return fsBtn;
      if (s === '.msg-video-player') return fsPlayer;
      return null;
    }
  };
  const clickHandlers = msgDocListeners.get('click') || [];
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: fsBtn })));
  assert.equal(reqFullscreenCalls, 0, 'video fullscreen must use custom Pic 3 viewer instead of native requestFullscreen');
  assert.equal(videoViewerCalls.length, 1);
  assert.equal(videoViewerCalls[0][0], 'https://cdn.example/view/clip.mp4');

  // Shared media drawer also opens Shared Media videos in Ipon.openVideoViewer
  await Promise.all(clickHandlers.map((fn) => fn({
    stopPropagation: () => { },
    target: { closest: (s) => (s === '#msg-thread-info-toggle' ? { dataset: {} } : null) }
  })));
  await Promise.all(clickHandlers.map((fn) => fn({
    stopPropagation: () => { },
    target: { closest: (s) => (s === '[data-drawer-view]' ? { dataset: { drawerView: 'media' } } : null) }
  })));
  const drawerMediaHtml = getMsgEl('msg-thread-drawer').innerHTML;
  assert.match(drawerMediaHtml, /data-open-vid="https:\/\/cdn\.example\/view\/[^"]*preview-clip\.mp4"[\s\S]*?poster="data:image\/svg\+xml/);
  const vidThumb = {
    dataset: { openVid: 'https://cdn.example/view/clip2.mp4', vidConv: convId, vidPath: `${convId}/clip2.mp4`, vidName: 'preview-clip.mp4' },
    closest: (s) => (s === '[data-open-vid]' ? vidThumb : null)
  };
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: vidThumb })));
  assert.equal(videoViewerCalls.length, 2);

  // In-place reaction & receipt patching does NOT rebuild #msg-messages-list.innerHTML (prevents video flicker!)
  const bubbleVidCol = makeMsgEl('col-m-vid');
  let insertedReactHtml = '';
  bubbleVidCol.querySelector = () => null;
  bubbleVidCol.insertAdjacentHTML = (_pos, html) => { insertedReactHtml = String(html || ''); };
  const vidRowNode = {
    dataset: { msgId: 'm-vid' },
    querySelector: (sel) => (sel === '.msg-bubble-col' ? bubbleVidCol : null)
  };
  getMsgEl('msg-messages-list').querySelector = (sel) => (String(sel).includes('m-vid') ? vidRowNode : null);
  const writesBeforeReact = threadHtmlWrites;
  const reactBtn = {
    dataset: { reactMsg: 'm-vid', reactEmoji: '❤️' },
    closest: (s) => (s === '[data-react-msg]' ? reactBtn : null)
  };
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: reactBtn })));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(threadHtmlWrites, writesBeforeReact, 'reacting on a video message must patch reactions in place without resetting innerHTML');
  assert.ok(insertedReactHtml.includes('❤️'), 'reactions row must update in place on existing video bubble column');

  // Mobile Back unwinds drawer first: drawer subview -> drawer root -> drawer close
  assert.equal(msgWin.IponMessages.handleBackNavigation(), true); // media -> root
  assert.match(getMsgEl('msg-thread-drawer').innerHTML, /data-drawer-screen="root"/);
  assert.equal(msgWin.IponMessages.handleBackNavigation(), true); // root -> closed
  assert.equal(getMsgEl('msg-thread-drawer').hidden, true);

  // When window is unfocused (notification shade / lockscreen wake / background window), incoming message marks Delivered ONLY, NEVER Seen
  const origRpcCallsCount = () => msgRpcCalls.filter((r) => r === 'mark_conversation_read').length;
  const deliveredCallsCount = () => msgRpcCalls.filter((r) => r === 'mark_messages_delivered').length;
  focusedState = false;
  (msgWinListeners.get('blur') || []).forEach((fn) => fn());
  const readsWhileUnfocusedBefore = origRpcCallsCount();
  const deliveredBeforeUnfocused = deliveredCallsCount();
  currentMsgs = [
    ...currentMsgs,
    { id: 'm-unfocused-notif', conversation_id: convId, sender_id: peerId, body: 'Just notifying', message_type: 'TEXT', created_at: '2026-11-15T10:03:30Z', attachments: [], reactions: [] }
  ];
  mockUnreadFirstId = 'm-unfocused-notif';
  msgTableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm-unfocused-notif', conversation_id: convId, sender_id: peerId } });
  await new Promise((r) => setTimeout(r, 340));
  assert.equal(
    deliveredCallsCount() > deliveredBeforeUnfocused,
    true,
    'unfocused window still marks incoming peer message as delivered'
  );
  assert.equal(
    origRpcCallsCount(),
    readsWhileUnfocusedBefore,
    'unfocused window (notification shade / lockscreen wake / background app) must NOT mark conversation read'
  );

  // Returning focus onto open thread marks it read once the user actually views it
  focusedState = true;
  (msgWinListeners.get('focus') || []).forEach((fn) => fn());
  await new Promise((r) => setTimeout(r, 40));
  const readsWhenFocused = origRpcCallsCount();
  assert.equal(
    readsWhenFocused > readsWhileUnfocusedBefore,
    true,
    'returning window focus onto active unread thread marks conversation read once user looks at it'
  );

  // When an overlay dialog (e.g. notification sheet) covers the open thread, incoming message must NOT mark read
  getMsgEl('notification-dialog').open = true;
  currentMsgs = [
    ...currentMsgs,
    { id: 'm-under-overlay', conversation_id: convId, sender_id: peerId, body: 'Under notif dialog', message_type: 'TEXT', created_at: '2026-11-15T10:03:45Z', attachments: [], reactions: [] }
  ];
  mockUnreadFirstId = 'm-under-overlay';
  msgTableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm-under-overlay', conversation_id: convId, sender_id: peerId } });
  await new Promise((r) => setTimeout(r, 340));
  assert.equal(
    origRpcCallsCount(),
    readsWhenFocused,
    'overlay dialog over workspace must prevent auto-marking Seen'
  );
  getMsgEl('notification-dialog').open = false;

  // Back from open conversation -> chats list
  assert.equal(msgWin.IponMessages.handleBackNavigation(), true); // convo -> chats list
  assert.equal(getMsgEl('msg-view-chats').classList.contains('is-mobile-thread'), false);

  // When back on Chats list (including 721px-820px compact viewports), incoming peer message MUST NOT auto-mark read!
  msgWin.innerWidth = 800;
  const readsBeforeIncoming = msgRpcCalls.filter((r) => r === 'mark_conversation_read').length;
  currentMsgs = [
    ...currentMsgs,
    { id: 'm-unseen-list', conversation_id: convId, sender_id: peerId, body: 'Are you there?', message_type: 'TEXT', created_at: '2026-11-15T10:04:00Z', attachments: [], reactions: [] }
  ];
  msgTableHandlers.get('messages')?.({ eventType: 'INSERT', new: { id: 'm-unseen-list', conversation_id: convId, sender_id: peerId } });
  await new Promise((r) => setTimeout(r, 340));
  assert.equal(
    msgRpcCalls.filter((r) => r === 'mark_conversation_read').length,
    readsBeforeIncoming,
    'peer message arriving while compact/mobile user is on Chats list (<= 820px) must NOT auto-mark seen'
  );
  msgWin.innerWidth = 390;
  assert.equal(msgWin.IponMessages.handleBackNavigation(), false, 'at root Chats list handleBackNavigation returns false so dashboard step unwinds next');
  getMsgEl('msg-workspace-dialog').close();
  assert.equal(getMsgEl('msg-view-chats').classList.contains('is-mobile-thread'), false);

  // Pic 1 + Pic 3: Reopen thread -> Chat Info drawer redesign + full-column theme sync (pane + stage)
  await msgWin.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  assert.equal(getMsgEl('msg-thread-pane').dataset.chatTheme, 'paper');
  assert.equal(getMsgEl('msg-thread-stage').dataset.chatTheme, 'paper');

  // Open drawer -> verify Pic 1 structure (header X, avatar, 2-col Chat Action icon cards, 5 circular Theme swatches, Media & files cards)
  await Promise.all(clickHandlers.map((fn) => fn({
    stopPropagation: () => { },
    target: { closest: (s) => (s === '#msg-thread-info-toggle' ? { dataset: {} } : null) }
  })));
  const rootDrawerHtml = getMsgEl('msg-thread-drawer').innerHTML;
  assert.match(rootDrawerHtml, /<h3>Chat Info &amp; Options<\/h3>[\s\S]*?class="dialog-close msg-drawer-close-btn" id="msg-drawer-close"/);
  assert.match(rootDrawerHtml, /class="msg-drawer-action-btn" data-conv-act="pin"[\s\S]*?<svg[^>]*>[\s\S]*?<span>Pin chat<\/span>/);
  assert.match(rootDrawerHtml, /class="msg-drawer-action-btn is-danger" data-social-action="block"[\s\S]*?<span>Block user<\/span>/);
  assert.match(rootDrawerHtml, /class="msg-theme-chip is-active" data-conv-theme="paper"[\s\S]*?class="msg-theme-swatch is-paper"[\s\S]*?class="msg-theme-label">Paper<\/span>/);
  assert.match(rootDrawerHtml, /data-conv-theme="midnight"[\s\S]*?class="msg-theme-swatch is-midnight"[\s\S]*?class="msg-theme-label">Midnight<\/span>/);
  assert.match(rootDrawerHtml, /data-drawer-view="media"[\s\S]*?Shared media[\s\S]*?<span class="msg-drawer-nav-count">1<\/span>/);
  assert.match(rootDrawerHtml, /data-drawer-view="files"[\s\S]*?Shared files[\s\S]*?<span class="msg-drawer-nav-count">0<\/span>/);

  // Switch chat theme to Midnight -> BOTH msg-thread-pane (top header + pinned + bottom composer) AND msg-thread-stage adopt midnight theme
  const midnightBtn = { dataset: { convTheme: 'midnight' }, closest: (s) => (s === '[data-conv-theme]' ? midnightBtn : null) };
  await Promise.all(clickHandlers.map((fn) => fn({ stopPropagation: () => { }, target: midnightBtn })));
  assert.equal(getMsgEl('msg-thread-pane').dataset.chatTheme, 'midnight', 'top/middle/bottom container must receive chatTheme');
  assert.equal(getMsgEl('msg-thread-stage').dataset.chatTheme, 'midnight');
  assert.match(getMsgEl('msg-thread-drawer').innerHTML, /class="msg-theme-chip is-active" data-conv-theme="midnight"/);

  // Pic 2: Open Messaging & Privacy modal -> verify form grid, bio counter, right-aligned toggle switches, dark save CTA, and blocked accounts section
  await Promise.all(clickHandlers.map((fn) => fn({
    stopPropagation: () => { },
    target: { closest: (s) => (s === '#msg-privacy-btn' ? { dataset: {} } : null) }
  })));
  const settingsDialog = getMsgEl('msg-settings-dialog');
  assert.equal(settingsDialog.open, true);
  const settingsHtml = getMsgEl('msg-settings-body').innerHTML;
  assert.match(settingsHtml, /<form id="msg-privacy-form" class="form-grid msg-privacy-form"/);
  assert.match(settingsHtml, /class="field-help msg-bio-counter" id="msg-set-bio-count">0 \/ 240 characters<\/small>/);
  assert.match(settingsHtml, /class="msg-switch-row toggle-switch-row field-wide"[\s\S]*?Show active status[\s\S]*?<input type="checkbox" class="toggle-switch-input" name="show_online"/);
  assert.match(settingsHtml, /class="msg-switch-row toggle-switch-row field-wide"[\s\S]*?Show last seen timestamp[\s\S]*?<input type="checkbox" class="toggle-switch-input" name="show_last_seen"/);
  assert.match(settingsHtml, /class="msg-switch-row toggle-switch-row field-wide"[\s\S]*?Send &amp; receive read receipts[\s\S]*?<input type="checkbox" class="toggle-switch-input" name="read_receipts"/);
  assert.match(settingsHtml, /id="msg-settings-save"[\s\S]*?Save messaging settings/);
  assert.match(settingsHtml, /class="msg-blocked-section"[\s\S]*?class="msg-blocked-count">0<\/span>[\s\S]*?class="msg-blocked-empty"[\s\S]*?You have not blocked anyone\./);
  // Closing workspace resets active theme back to paper cleanly
  settingsDialog.close();
  getMsgEl('msg-workspace-dialog').close();
  assert.equal(getMsgEl('msg-thread-pane').dataset.chatTheme, 'paper');
  assert.equal(getMsgEl('msg-thread-stage').dataset.chatTheme, 'paper');
});

test('chat drawer, messaging privacy dialog, and full-column chat themes declare cohesive light & dark CSS tokens', () => {
  const appCss = read('css/app.css');
  // Pic 3: Full-column variables cover header, pinned banner, stage, search bar, and bottom composer
  assert.match(appCss, /\.msg-thread-pane\[data-chat-theme="midnight"\],\s*html\[data-theme="dark"\] \.msg-thread-pane\[data-chat-theme="midnight"\]/);
  assert.match(appCss, /\.msg-thread-header\s*\{[^}]*background:\s*var\(--thread-chrome-bg/);
  assert.match(appCss, /\.msg-pinned-banner\s*\{[^}]*background:\s*var\(--thread-banner-bg/);
  assert.match(appCss, /\.msg-composer-wrap\s*\{[^}]*background:\s*var\(--thread-chrome-bg/);
  assert.match(appCss, /#msg-composer-input\s*\{[^}]*background:\s*var\(--thread-input-bg/);
  // Dark mode must not override swatch chips or composer theme tokens flatly
  assert.doesNotMatch(appCss, /html\[data-theme="dark"\]\s*\.msg-theme-chip\s*\{[^}]*background:\s*var\(--surface-input\)/);
  assert.doesNotMatch(appCss, /html\[data-theme="dark"\]\s*#msg-composer-input\s*\{/);
  // Pic 1 & Pic 2 key styling rules exist
  assert.match(appCss, /\.msg-theme-swatch\.is-midnight\s*\{/);
  assert.match(appCss, /\.msg-drawer-action-btn\.is-danger/);
  assert.match(appCss, /\.msg-settings-save-btn:not\(\.is-busy\)::before/);
  assert.match(appCss, /\.msg-blocked-count\s*\{/);
});

test('mobile notifications never auto-inject update alerts on push and omit Download APK buttons even on admin release announcements', async () => {
  const coreJs = read('js/core.js');
  assert.doesNotMatch(coreJs, /system-app-release-notice[\s\S]*?allRows\s*=\s*\[releaseNotice/);
  assert.doesNotMatch(coreJs, /notification-download-row|Download APK|Download Android \(\.apk\)/);

  const ids = new Map();
  const makeEl = (id) => {
    const cls = new Set();
    return {
      id,
      open: false,
      hidden: false,
      innerHTML: '',
      textContent: '',
      className: '',
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      children: [],
      classList: {
        add: (...a) => a.forEach((x) => cls.add(x)),
        remove: (...a) => a.forEach((x) => cls.delete(x)),
        toggle: (k, f) => { if (f === undefined ? !cls.has(k) : f) cls.add(k); else cls.delete(k); },
        contains: (k) => cls.has(k)
      },
      setAttribute() { },
      removeAttribute() { },
      addEventListener() { },
      appendChild(c) { this.children.push(c); return c; },
      append(...n) { this.children.push(...n); },
      prepend() { },
      insertAdjacentHTML() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { }
    };
  };
  const notifList = makeEl('notification-list');
  const markAllBtn = makeEl('mark-all-notifications');
  const notifBadge = makeEl('notification-badge');
  ids.set('app-loader', makeEl('app-loader'));
  ids.set('loader-label', makeEl('loader-label'));
  ids.set('notification-list', notifList);
  ids.set('mark-all-notifications', markAllBtn);
  ids.set('notification-badge', notifBadge);

  let dbNotifications = [];
  const rpcCalls = [];
  const localStore = new Map([
    ['myipon_latest_remote_version', '1.0.99'],
    ['myipon_latest_native_build', '99']
  ]);

  const doc = {
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: Object.assign(makeEl('body'), { dataset: { page: 'dashboard' } }),
    readyState: 'complete',
    visibilityState: 'hidden',
    getElementById: (id) => ids.get(id) || null,
    querySelector: (sel) => (sel.startsWith('#') ? ids.get(sel.slice(1)) || null : null),
    querySelectorAll: (sel) => (sel === '[data-notification-count]' ? [notifBadge] : []),
    createElement: (tag) => makeEl(tag),
    addEventListener() { }
  };

  const clientMock = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u-mem' } } }, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }) },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }),
      signOut: async () => { }
    },
    from: (table) => {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        async single() {
          if (table === 'profiles') {
            return {
              data: {
                id: 'u-mem',
                full_name: 'Juan Dela Cruz',
                first_name: 'Juan',
                last_name: 'Dela Cruz',
                contact_number: '09171234567',
                role: 'MEMBER',
                status: 'ACTIVE',
                group_id: 'grp-1',
                member_id: 'mem-1',
                notifications_enabled: false
              },
              error: null
            };
          }
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === 'notifications') return Promise.resolve({ data: dbNotifications, error: null }).then(resolve);
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
      };
      return chain;
    },
    rpc: async (name, params) => {
      rpcCalls.push([name, params]);
      if (name === 'mark_all_notifications_read') {
        dbNotifications = dbNotifications.map((r) => ({ ...r, read_at: '2026-11-16T01:30:00Z' }));
      }
      return { data: null, error: null };
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() { }
  };

  const ctx = {
    window: null,
    document: doc,
    navigator: { userAgent: 'Mozilla/5.0 myIPONApp/19', onLine: true },
    location: { origin: 'https://myipon.example', protocol: 'https:', hostname: 'myipon.example', pathname: '/dashboard.html', href: 'https://myipon.example/dashboard.html', search: '', replace() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon' },
    MYIPON_APP_VERSION: { version: '1.0.20', build: 20, nativeBuild: 20, isApp: true },
    Capacitor: { Plugins: {} },
    supabase: { createClient: () => clientMock },
    localStorage: { getItem: (k) => localStore.get(k) ?? null, setItem: (k, v) => localStore.set(k, String(v)), removeItem: (k) => localStore.delete(k) },
    sessionStorage: { getItem: (k) => (k.startsWith('ipon_member_activated:') ? '1' : null), setItem() { }, removeItem() { } },
    Notification: { permission: 'default' },
    CustomEvent: class { },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout: () => 0,
    clearTimeout() { },
    setInterval: () => 0,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { return true; },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  // 1. Mobile app with newer build/version on server shows NO synthetic Update available notification when DB has none
  const initRes = await ctx.window.Ipon.init({ allowedRoles: ['MEMBER'], skipBackgroundPrompt: true });
  assert.equal(initRes?.redirecting, undefined);
  await new Promise((r) => setTimeout(r, 20));
  assert.doesNotMatch(notifList.innerHTML, /Update available|instant live updates|Download APK/i);
  assert.match(notifList.innerHTML, /You have no notifications yet\./);
  assert.equal(notifBadge.textContent, '0');

  // 2. When Super Admin publishes a RELEASE announcement in DB, it renders cleanly without Download APK and marks read on Clear
  dbNotifications = [{
    id: 501,
    group_id: null,
    type: 'RELEASE',
    title: 'Update 1.0.20: Chat polish',
    message: 'Redesigned drawer and privacy settings.',
    link: 'dashboard.html?announcement=ann-501',
    read_at: null,
    created_at: '2026-11-16T01:22:00Z'
  }];
  await markAllBtn.onclick();
  assert.ok(rpcCalls.some(([fn]) => fn === 'mark_all_notifications_read'));
  assert.match(notifList.innerHTML, /Update 1\.0\.20: Chat polish/);
  assert.doesNotMatch(notifList.innerHTML, /Download APK|notification-download-row/i);
  assert.equal(notifBadge.textContent, '0');
});

test('presence dot size, Chat Info drawer overlay over pinned banner, inline Friend + Active now header, and native VM mic permission flow work reliably', async () => {
  const css = read('css/app.css');
  const messagesJs = read('js/messages.js');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');

  // Pic 1: Larger green online indicator across avatar sizes + header theme ring contrast
  assert.match(css, /\.presence-dot\{[^}]*width:12px;height:12px;/);
  assert.match(css, /\.sidebar-user-card \.presence-dot\{width:13\.5px;height:13\.5px;/);
  assert.match(css, /\.avatar-lg-wrap \.presence-dot\{width:15px;height:15px;/);
  assert.match(css, /\.msg-thread-header \.presence-dot\s*\{[^}]*border-color:\s*var\(--thread-chrome-bg/);

  // Pic 2: Drawer sits as direct child of #msg-thread-active (sibling of .msg-thread-main) and covers pinned banner
  assert.match(messagesJs, /<div class="msg-thread-active" id="msg-thread-active" hidden>[\s\S]*?<div class="msg-thread-main">[\s\S]*?<\/div>\s*<aside class="msg-thread-drawer" id="msg-thread-drawer" hidden/);
  assert.match(css, /\.msg-thread-active\s*\{[^}]*position:\s*relative;[^}]*display:\s*flex;[^}]*flex-direction:\s*row;/s);
  assert.match(css, /\.msg-thread-main\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(css, /@media\s*\(max-width:\s*980px\)\s*\{\s*\.msg-thread-drawer\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0 0 0 auto;[^}]*z-index:\s*30;/s);
  assert.match(css, /@media\s*\(max-width:\s*820px\)\s*\{\s*\.msg-thread-drawer\s*\{[^}]*width:\s*100%;/s);

  // Pic 3: Active now sits inline to the right of Friend badge inside .msg-thread-peer-sub
  assert.match(messagesJs, /<div class="msg-thread-peer-sub">[\s\S]*?<span class="msg-rel-chip">Friend<\/span>[\s\S]*?<small class="msg-peer-status[\s\S]*?id="msg-peer-status-text"/);
  assert.match(css, /\.msg-thread-peer-sub\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*flex-wrap:\s*wrap;/s);
  assert.match(css, /\.msg-peer-status\s*\{[^}]*display:\s*inline-flex;/s);

  // Pic 4: Native Android manifest + Java plugin + JS voice-recording permission state machine
  assert.match(manifest, /android\.permission\.RECORD_AUDIO/);
  assert.match(bgPlugin, /manifestDeclared[\s\S]*?manifestMissing/);

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    return {
      tagName: String(tag).toUpperCase(),
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      disabled: false,
      files: [],
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      addEventListener() { },
      removeEventListener() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      appendChild(n) { return n; },
      showModal() { this.open = true; },
      close() { this.open = false; }
    };
  };
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl());
    return els.get(id);
  };
  const docClicks = [];
  const docStub = {
    body: Object.assign(makeEl('body'), { dataset: { page: 'dashboard' }, classList: { toggle() { }, add() { }, remove() { }, contains: () => false } }),
    documentElement: makeEl('html'),
    getElementById: (id) => getEl(id),
    createElement: (t) => makeEl(t),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(type, fn) { if (type === 'click') docClicks.push(fn); },
    removeEventListener() { }
  };

  let micBehavior = { granted: false, canAskAgain: true, manifestMissing: false };
  let getUserMediaCalls = 0;
  let getUserMediaError = null;
  const confirmCalls = [];
  const openSettingsCalls = [];
  const toasts = [];
  let recorderStarted = 0;

  const ctx = {
    window: null,
    document: docStub,
    navigator: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 myIPONApp/20',
      onLine: true,
      mediaDevices: {
        getUserMedia: async () => {
          getUserMediaCalls += 1;
          if (getUserMediaError) throw getUserMediaError;
          return { getTracks: () => [{ stop() { } }] };
        }
      }
    },
    MediaRecorder: class {
      constructor(stream) { this.stream = stream; this.state = 'inactive'; }
      static isTypeSupported() { return true; }
      start() { this.state = 'recording'; recorderStarted += 1; }
      stop() { this.state = 'inactive'; }
    },
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: {
        BackgroundNotifications: {
          ensureMicrophonePermission: async () => ({ ...micBehavior }),
          openAppSettings: async () => { openSettingsCalls.push(true); return { launched: true }; }
        }
      }
    },
    Ipon: {
      profile: { id: 'u1', full_name: 'Juan Dela Cruz' },
      client: {
        rpc: async () => ({ data: null, error: null }),
        channel: () => ({ on() { return this; }, subscribe() { return this; }, track: async () => { }, untrack: async () => { }, send: async () => { } }),
        removeChannel() { },
        storage: { from: () => ({ upload: async () => ({ error: null }) }) }
      },
      avatarMarkup: () => '<span></span>',
      syncPresenceDots() { },
      bindAvatarFallbacks() { },
      toast: (msg, type) => toasts.push({ msg, type }),
      confirmAction: async (opts) => { confirmCalls.push(opts); return true; },
      friendlyError: (e) => String(e?.message || e)
    },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout: () => 0,
    clearTimeout() { },
    setInterval: () => 1,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    removeEventListener() { },
    console
  };
  ctx.window = ctx;
  ctx.MediaRecorder.isTypeSupported = () => true;
  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.window.IponMessages.init({ profile: ctx.Ipon.profile });

  const tapVoiceBtn = () => Promise.all(docClicks.map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-voice-btn' ? getEl('msg-voice-btn') : null) }
  })));

  // Scenario A: First deny (canAskAgain: true) does NOT kick user to Settings — leaves system prompt re-triggerable
  micBehavior = { granted: false, canAskAgain: true, manifestMissing: false };
  await tapVoiceBtn();
  assert.equal(confirmCalls.length, 0);
  assert.equal(getUserMediaCalls, 0);
  assert.match(toasts.at(-1)?.msg || '', /Allow microphone access when prompted/);

  // Scenario B: User permanently denies twice (canAskAgain: false) -> offers Open Settings cleanly
  micBehavior = { granted: false, canAskAgain: false, manifestMissing: false };
  await tapVoiceBtn();
  assert.equal(confirmCalls.length, 1);
  assert.equal(confirmCalls[0].confirmLabel, 'Open Settings');
  assert.equal(openSettingsCalls.length, 1);

  // Scenario C: Old APK without ensureMicrophonePermission on Android fails NotAllowedError -> shows APK update notice with Download APK action
  const savedBgPlugin = ctx.Capacitor.Plugins.BackgroundNotifications;
  let micUpdateDownloadCalls = 0;
  ctx.window.Ipon.openLatestApkDownload = () => { micUpdateDownloadCalls += 1; };
  ctx.Capacitor.Plugins.BackgroundNotifications = {};
  getUserMediaError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' });
  await tapVoiceBtn();
  delete ctx.window.Ipon.openLatestApkDownload;
  assert.equal(confirmCalls.length, 2);
  assert.match(confirmCalls[1].title, /App update needed/);
  assert.equal(confirmCalls[1].confirmLabel, 'Download APK');
  assert.equal(micUpdateDownloadCalls, 1);

  // Scenario D: New APK where user taps Allow in system prompt -> immediately starts recording
  ctx.Capacitor.Plugins.BackgroundNotifications = savedBgPlugin;
  getUserMediaError = null;
  micBehavior = { granted: true, canAskAgain: true, manifestDeclared: true, manifestMissing: false };
  await tapVoiceBtn();
  assert.equal(recorderStarted, 1);
  assert.equal(getEl('msg-voice-recording').hidden, false);
});

test('outdated APK detection, Android background wake locks, safety polling, and permission sync hardening stay intact', async () => {
  const vm = await import('node:vm');
  const coreJs = read('js/core.js');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const syncService = read('android/app/src/main/java/com/myipon/app/NotificationSyncService.java');
  const syncWorker = read('android/app/src/main/java/com/myipon/app/NotificationSyncWorker.java');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const swJs = read('sw.js');

  // 1. Native Android wake lock, background FGS guard, safety poll, and permission callback contracts
  assert.match(pollReceiver, /PowerManager\.PARTIAL_WAKE_LOCK/);
  assert.match(pollReceiver, /pollWithWakeLock\(/);
  assert.match(pollReceiver, /lastPollSuccessElapsedMs\s*=\s*SystemClock\.elapsedRealtime\(\)/);
  assert.match(pollReceiver, /NotificationCompat\.VISIBILITY_PRIVATE/);
  assert.match(pollReceiver, /NotificationCompat\.DEFAULT_ALL/);
  assert.match(pollReceiver, /NotificationSyncService\.canStartFromBackground\(appContext\)/);

  assert.match(syncService, /SAFETY_POLL_INTERVAL_MS\s*=\s*45_000L/);
  assert.match(syncService, /NotificationPollReceiver\.pollAsync\(appContext\)/);
  assert.match(syncService, /"phx_error"\.equals\(event\)\s*\|\|\s*"phx_close"\.equals\(event\)/);
  assert.match(syncService, /canStartFromBackground\(Context context\)/);

  assert.match(syncWorker, /NotificationSyncService\.canStartFromBackground\(appContext\)/);
  assert.match(syncWorker, /NotificationPollReceiver\.pollWithWakeLock\(appContext\)/);

  assert.match(mainActivity, /onRequestPermissionsResult\(int requestCode, String\[\] permissions, int\[\] grantResults\)/);
  assert.match(mainActivity, /NotificationSyncService\.canStartFromBackground\(this\)/);
  assert.match(mainActivity, /dispatchWindowEvent\("focus"\)/);

  assert.match(bgPlugin, /result\.put\("micManifestDeclared", micManifestDeclared\)/);
  assert.match(bgPlugin, /result\.put\("micPermissionGranted", micPermissionGranted\)/);
  assert.match(bgPlugin, /NotificationPollReceiver\.scheduleNext\(context, 20_000L\)/);

  // 2. Service worker & resync cooldown bypass contracts
  assert.match(swJs, /CACHE_NAME\s*=\s*'ipon-shell-v(?:11|12|\d+)'/);
  assert.match(coreJs, /snap\?\.nativeBgStatus\?\.instantSyncRunning === false/);
  assert.match(coreJs, /if \(!force && now - lastBgPollSyncAt < 60_000\) return;/);

  // 3. js/core.js runtime VM: outdated APK detection (micManifestDeclared: false or old plugin without requestIgnoreBatteryOptimizations)
  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const cls = new Set();
    const children = [];
    const el = {
      tagName: String(tag).toUpperCase(),
      hidden: false,
      disabled: false,
      open: false,
      textContent: '',
      innerHTML: '',
      dataset: {},
      className: '',
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (c, f) => (f === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (f ? cls.add(c) : cls.delete(c))),
        contains: (c) => cls.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      appendChild: (n) => { children.push(n); return n; },
      append: (...ns) => { children.push(...ns); },
      prepend() { },
      insertBefore: (n) => { children.push(n); return n; },
      insertAdjacentHTML() { },
      dispatchEvent: () => true,
      showModal() { el.open = true; },
      close() { el.open = false; },
      remove() { el._removed = true; },
      addEventListener() { },
      removeEventListener() { },
      closest: () => null,
      querySelector: (sel) => {
        if (sel === '[data-device-bg-pill]') return el._pill || null;
        if (sel === '[data-device-bg-status]') return el._status || null;
        if (sel === '[data-device-bg-actions]') return el._actions || null;
        if (sel === '[data-device-bg-btn]') return el._btn || null;
        return null;
      },
      querySelectorAll: () => []
    };
    return el;
  };
  const bgRow = makeEl('div');
  bgRow._pill = makeEl('span');
  bgRow._status = makeEl('small');
  bgRow._actions = makeEl('div');
  bgRow._btn = makeEl('button');

  const openedUrls = [];
  let nativeStatus = { hasPermission: true, batteryOptimizationIgnored: true, micManifestDeclared: false, instantSyncRunning: false };
  const docListeners = new Map();
  const docStub = {
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: Object.assign(makeEl('body'), {
      dataset: {},
      addEventListener(evt, fn) { docListeners.set(evt, fn); }
    }),
    createElement: (tag) => makeEl(tag),
    getElementById: () => makeEl('div'),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-device-background-row]' ? [bgRow] : []),
    addEventListener() { }
  };
  const ctx = {
    window: null,
    document: docStub,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 myIPONApp/20', onLine: true, serviceWorker: null },
    location: { origin: 'https://myipon.example', href: 'https://myipon.example/account.html', pathname: '/account.html', search: '', hostname: 'myipon.example', protocol: 'https:', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    Capacitor: {
      Plugins: {
        LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }) },
        BackgroundNotifications: {
          getBackgroundStatus: async () => ({ ...nativeStatus }),
          requestIgnoreBatteryOptimizations: async () => ({ launched: true, alreadyIgnored: true })
        }
      }
    },
    Notification: { permission: 'granted' },
    CustomEvent: class { },
    open: (url, target, rel) => { openedUrls.push({ url, target, rel }); return {}; },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  // Case A: APK missing RECORD_AUDIO (micManifestDeclared === false) shows Update APK and opens download
  await ctx.window.Ipon.syncDevicePermissionUI();
  assert.equal(bgRow._pill.textContent, 'Update APK');
  assert.equal(bgRow._btn.textContent, 'Update APK');
  assert.equal(bgRow._btn.dataset.bgAction, 'update-apk');
  const resA = await ctx.window.Ipon.requestBackgroundUsageAccess();
  assert.equal(resA.needsApkUpdate, true);
  assert.equal(openedUrls.length, 1);
  assert.match(openedUrls[0].url, /myIPON\.apk$/);

  // Case B: Older APK bridge lacking requestIgnoreBatteryOptimizations ALSO triggers Update APK
  delete ctx.Capacitor.Plugins.BackgroundNotifications.requestIgnoreBatteryOptimizations;
  nativeStatus = { hasPermission: true, batteryOptimizationIgnored: true, micManifestDeclared: true };
  await ctx.window.Ipon.syncDevicePermissionUI();
  assert.equal(bgRow._pill.textContent, 'Update APK');
  const resB = await ctx.window.Ipon.requestBackgroundUsageAccess();
  assert.equal(resB.needsApkUpdate, true);
  assert.equal(openedUrls.length, 2);

  // Case C: Shared openLatestApkDownload helper & [data-device-notif-btn] update-apk click open APK URL
  await ctx.window.Ipon.bindDeviceNotificationControls();
  const bodyClick = docListeners.get('click');
  assert.equal(typeof bodyClick, 'function');
  const fakeUpdateBtn = Object.assign(makeEl('button'), { dataset: { actionMode: 'update-apk' } });
  await bodyClick({
    target: { closest: (sel) => (sel === '[data-device-notif-btn]' ? fakeUpdateBtn : null) }
  });
  assert.equal(openedUrls.length, 3);
});

test('voice waveform fills full width, background prompt buttons avoid vertical bloat and show busy feedback, and sent voice notes render immediately with missing-URL auto-recovery', async () => {
  const vm = await import('node:vm');
  const css = read('css/app.css');
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');

  // 1. Pic 1: Waveform stretches full width with zero trailing blank space
  assert.match(css, /\.msg-voice-wave\s*\{[^}]*justify-content:\s*space-between;[^}]*gap:\s*1\.5px;[^}]*width:\s*100%;/s);
  const waveMatch = messagesJs.match(/const VOICE_WAVE_HEIGHTS\s*=\s*\[([^\]]+)\]/);
  assert.ok(waveMatch, 'VOICE_WAVE_HEIGHTS array must exist in js/messages.js');
  const waveBars = waveMatch[1].split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
  assert.ok(waveBars.length >= 34, `VOICE_WAVE_HEIGHTS should have at least 34 bars, found ${waveBars.length}`);

  // 2. Pic 2: Prompt action buttons stay compact (no 140px vertical flex stretch) & show crisp .is-busy indicator
  assert.match(css, /\.button\.is-busy:disabled\s*\{\s*opacity:\s*\.92;\s*cursor:\s*wait;\s*\}/);
  assert.match(css, /\.bg-usage-actions\s+\.button\s*\{\s*flex:\s*0 0 auto;\s*min-height:\s*44px;\s*padding:\s*10px 16px;/);
  assert.match(css, /@media \(max-width:\s*620px\)[\s\S]*?\.bg-usage-actions\s+\.button\s*\{\s*flex:\s*0 0 auto;\s*width:\s*100%;\s*min-height:\s*44px;/);

  const makeEl = (tag) => {
    const classes = new Set();
    const listeners = new Map();
    const attrs = {};
    const dataset = {};
    const children = [];
    let cls = '';
    let textContent = '';
    const el = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '',
      open: false,
      disabled: false,
      hidden: false,
      dataset,
      style: { setProperty() { }, removeProperty() { } },
      get className() { return cls; },
      set className(v) {
        cls = String(v ?? '');
        classes.clear();
        cls.split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
      },
      get textContent() { return textContent; },
      set textContent(v) { textContent = String(v ?? ''); },
      set innerHTML(v) { el._html = String(v ?? ''); },
      get innerHTML() { return el._html || ''; },
      classList: {
        contains: (c) => classes.has(c),
        add: (c) => { classes.add(c); cls = [...classes].join(' '); },
        remove: (c) => { classes.delete(c); cls = [...classes].join(' '); },
        toggle: (c, f) => {
          if (f === undefined ? !classes.has(c) : Boolean(f)) classes.add(c);
          else classes.delete(c);
          cls = [...classes].join(' ');
        }
      },
      setAttribute(k, v) { attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      hasAttribute(k) { return k in attrs; },
      removeAttribute(k) { delete attrs[k]; },
      addEventListener(ev, fn) { listeners.set(ev, fn); },
      getListener(ev) { return listeners.get(ev); },
      appendChild(c) { children.push(c); return c; },
      append(...nodes) { nodes.forEach((n) => children.push(n)); },
      prepend() { },
      insertBefore(n) { return el.appendChild(n); },
      insertAdjacentHTML() { },
      showModal() { el.open = true; },
      close() { el.open = false; },
      remove() { },
      querySelector(sel) {
        if (sel === '[data-bg-prompt-notif-badge]') return el._notifBadge || null;
        if (sel === '[data-bg-prompt-battery-badge]') return el._batBadge || null;
        if (sel === '[data-bg-prompt-allow]') return el._allowBtn || null;
        if (sel === '[data-bg-prompt-settings]') return el._settingsBtn || null;
        if (sel === '[data-bg-prompt-hint]') return el._hint || null;
        return null;
      },
      querySelectorAll: () => []
    };
    return el;
  };
  let promptDlg = null;
  let resolveBattery;
  const batPromise = new Promise((res) => { resolveBattery = res; });
  const permState = { hasPermission: true, batteryOptimizationIgnored: false, micManifestDeclared: true };
  const docCore = {
    documentElement: makeEl('html'),
    head: makeEl('head'),
    body: Object.assign(makeEl('body'), {
      dataset: {},
      append(node) {
        if (node?.id === 'background-usage-prompt-dialog') {
          node._notifBadge = makeEl('span');
          node._batBadge = makeEl('span');
          node._allowBtn = makeEl('button');
          node._allowBtn.textContent = 'Allow background usage';
          node._settingsBtn = makeEl('button');
          node._hint = makeEl('p');
          promptDlg = node;
        }
      }
    }),
    createElement: (t) => makeEl(t),
    getElementById: (id) => (id === 'background-usage-prompt-dialog' ? promptDlg : makeEl('div')),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { }
  };
  const ctxCore = {
    window: null,
    document: docCore,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 myIPONApp/20', onLine: true, serviceWorker: null },
    location: { origin: 'https://myipon.example', href: 'https://myipon.example/dashboard.html', pathname: '/dashboard.html', search: '', hostname: 'myipon.example', protocol: 'https:', replace() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    Capacitor: {
      Plugins: {
        LocalNotifications: { checkPermissions: async () => ({ display: 'granted' }) },
        BackgroundNotifications: {
          getBackgroundStatus: async () => ({ ...permState }),
          requestIgnoreBatteryOptimizations: () => batPromise,
          openAppSettings: async () => ({ launched: true }),
          openNotificationSettings: async () => ({ launched: true })
        }
      }
    },
    Notification: { permission: 'granted' },
    CustomEvent: class { },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout: (fn) => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { },
    console
  };
  ctxCore.window = ctxCore;
  vm.runInNewContext(coreJs, ctxCore, { filename: 'js/core.js' });
  docCore.body.dataset.page = 'dashboard';
  await ctxCore.window.Ipon.openBackgroundUsagePrompt({
    isMobile: true, isApp: true, needsApkUpdate: false, status: 'granted', batteryKnown: true, batteryOk: false, pushState: { supported: false, subscribed: false }, isIosBrowser: false
  });
  const allowBtn = promptDlg?._allowBtn;
  assert.ok(allowBtn, 'Prompt allow button should be wired');
  const clickFn = allowBtn.getListener('click');
  assert.equal(typeof clickFn, 'function');
  const clickTask = clickFn({ currentTarget: allowBtn });
  await Promise.resolve();
  assert.equal(allowBtn.classList.contains('is-busy'), true);
  assert.equal(allowBtn.disabled, true);
  assert.equal(allowBtn.textContent, 'Allowing…');

  // If battery stays restricted after dialog returns, label recovers cleanly without keeping 'Allowing…'
  resolveBattery({ launched: true, alreadyIgnored: false });
  await clickTask;
  assert.equal(allowBtn.classList.contains('is-busy'), false);
  assert.equal(allowBtn.disabled, false);
  assert.equal(allowBtn.textContent, 'Allow background usage');

  // 3. Pic 3: Own sent voice note uses instant blob previewUrl (0 "Loading voice note…" delay), and missed URLs auto-retry
  const msgEls = new Map();
  const getMsgEl = (id) => {
    if (!msgEls.has(id)) {
      msgEls.set(id, {
        id,
        hidden: false,
        disabled: false,
        value: '',
        innerHTML: '',
        textContent: '',
        scrollTop: 0,
        scrollHeight: 200,
        clientHeight: 200,
        dataset: {},
        style: {},
        files: null,
        classList: { contains: () => false, add() { }, remove() { }, toggle() { } },
        addEventListener() { },
        focus() { },
        setAttribute() { },
        removeAttribute() { },
        querySelector: () => null,
        querySelectorAll: () => [],
        showModal() { this.open = true; },
        close() { this.open = false; }
      });
    }
    return msgEls.get(id);
  };
  const convId = 'conv-voice-1';
  const meId = 'user-me';
  const peerId = 'user-peer';
  let viewUrlCalls = 0;
  let failViewUrlsFirst = false;
  let sentMsgs = [
    { id: 'v-peer-1', sender_id: peerId, body: '', message_type: 'VOICE', created_at: '2026-11-15T10:00:00Z', attachments: [{ path: `${convId}/peer-voice.webm`, name: 'voice.webm', kind: 'audio', duration_seconds: 3, size: 1200 }], reactions: [] }
  ];
  let uploadedPath = '';
  const winMsg = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener() { },
    removeEventListener() { },
    Ipon: {
      escapeHtml: (s) => String(s ?? ''),
      initials: () => 'U',
      isUserOnline: () => true,
      bindAvatarFallbacks: () => { },
      syncPresenceDots: () => { },
      syncMessagesBadges: () => { },
      setBusy: () => { },
      setFieldError: () => { },
      toast: () => { },
      friendlyError: (e) => String(e?.message || e),
      invokeAccountFunction: async (payload) => {
        if (payload?.action === 'chat-upload-urls') {
          uploadedPath = `${convId}/own-voice.webm`;
          return { uploads: [{ path: uploadedPath, token: 'tok-v', signedUrl: 'https://upload.test/v', name: 'voice.webm', type: 'audio/webm' }] };
        }
        if (payload?.action === 'chat-view-urls') {
          viewUrlCalls += 1;
          if (failViewUrlsFirst) {
            failViewUrlsFirst = false;
            return { urls: {} };
          }
          return { urls: Object.fromEntries((payload.paths || []).map((p) => [p, `https://cdn.example/view/${encodeURIComponent(p)}`])) };
        }
        return {};
      },
      rpc: async (name, params) => {
        if (name === 'get_conversations') {
          return [{ id: convId, status: 'ACCEPTED', initiator_id: peerId, is_incoming_request: false, peer: { id: peerId, full_name: 'Peer', allow_online_status: true }, unread_count: 0, marked_unread: false, last_message_at: '2026-11-15T10:00:00Z', last_message_preview: 'Voice' }];
        }
        if (name === 'get_conversation_messages') {
          return { conversation: { id: peerId, conversation_id: convId, full_name: 'Peer', status: 'ACCEPTED', friendship_status: 'FRIENDS', allow_online_status: true, receipts_enabled: true }, has_older: false, unread_first_id: null, pinned_messages: [], messages: sentMsgs };
        }
        if (name === 'get_social_overview') {
          return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        }
        if (name === 'mark_messages_delivered') return 0;
        if (name === 'send_chat_message') {
          const confirmed = { id: 'v-mine-1', sender_id: meId, body: '', message_type: 'VOICE', created_at: '2026-11-15T10:01:00Z', attachments: params.p_attachments || [], reactions: [] };
          sentMsgs = [...sentMsgs, confirmed];
          return confirmed;
        }
        return null;
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => ({ on() { return this; }, subscribe() { return this; }, send: async () => { } }),
        removeChannel: () => { }
      }
    }
  };
  let loadingQueryMatches = false;
  const docMsgListeners = new Map();
  const docMsg = {
    documentElement: { dataset: {} },
    visibilityState: 'visible',
    body: { insertAdjacentHTML() { }, appendChild() { } },
    createElement: () => makeEl('div'),
    getElementById: (id) => getMsgEl(id),
    querySelector: (sel) => (sel === '#msg-messages-list .msg-att-loading' && loadingQueryMatches ? {} : null),
    querySelectorAll: () => [],
    addEventListener(ev, fn) {
      if (!docMsgListeners.has(ev)) docMsgListeners.set(ev, []);
      docMsgListeners.get(ev).push(fn);
    }
  };
  winMsg.Ipon.openAudioUnlock = undefined;
  winMsg.Ipon.supabase = null;
  class FakeBlob { constructor(parts = [], opts = {}) { this.parts = parts; this.type = opts.type || 'audio/webm'; this.size = 1024; } }
  class FakeAudioFile extends FakeBlob { constructor(parts, name, opts) { super(parts, opts); this.name = name; } }
  class MockXhr {
    open() { }
    setRequestHeader() { }
    send() { this.status = 200; this.onload?.(); }
  }
  class MockURL extends URL { }
  MockURL.createObjectURL = () => 'blob:own-voice-instant';
  MockURL.revokeObjectURL = () => { };
  const msgCtx = {
    window: winMsg,
    document: docMsg,
    navigator: { userAgent: 'Mozilla/5.0' },
    location: { origin: 'https://myipon.example', search: '' },
    XMLHttpRequest: MockXhr,
    Blob: FakeBlob,
    File: FakeAudioFile,
    URL: MockURL,
    CSS: { escape: (v) => String(v) },
    URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => { },
    requestAnimationFrame: (fn) => fn(),
    console
  };
  winMsg.window = winMsg;
  vm.runInNewContext(messagesJs, msgCtx, { filename: 'js/messages.js' });
  assert.match(messagesJs, /stopVoiceRecorderStream[\s\S]*?const previewUrl\s*=\s*typeof URL\?\.createObjectURL === 'function'\s*\?\s*URL\.createObjectURL\(file \|\| blob\)\s*:\s*'';/);

  await winMsg.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Me' });

  // Open thread when chat-view-urls temporarily returns empty -> should show loading placeholder then auto-recover!
  failViewUrlsFirst = true;
  await winMsg.IponMessages.openWorkspace({ conversationId: convId });
  const listEl = getMsgEl('msg-messages-list');
  assert.match(listEl.innerHTML, /Loading voice note/);
  loadingQueryMatches = true;
  await new Promise((r) => setTimeout(r, 550));
  loadingQueryMatches = false;
  assert.match(listEl.innerHTML, /<audio class="msg-att-audio"[^>]*src="https:\/\/cdn\.example\/view\//);
  assert.doesNotMatch(listEl.innerHTML, /Loading voice note/);

  // Sending own audio attachment skips chat-view-urls completely and plays local blob URL immediately
  const callsBeforeOwnSend = viewUrlCalls;
  (docMsgListeners.get('change') || []).forEach((fn) => fn({
    target: { id: 'msg-file-input', value: 'sel', files: [new FakeAudioFile(['a'], 'voice-1.webm', { type: 'audio/webm' })] }
  }));
  await Promise.all((docMsgListeners.get('submit') || []).map((fn) => fn({
    preventDefault() { },
    target: { id: 'msg-composer-form', closest: (s) => (s === '#msg-composer-form' ? getMsgEl('msg-composer-form') : null) }
  })));
  await new Promise((r) => setTimeout(r, 120));
  assert.match(listEl.innerHTML, /src="blob:own-voice-instant"/);
  assert.doesNotMatch(listEl.innerHTML, /Loading voice note/);
  assert.equal(viewUrlCalls, callsBeforeOwnSend);
});

test('non-FCM Android background sync uses vector icon, JWT-safe REST polling, exact/restart wakeups, and multi-key Edge broadcast', () => {
  const migration079 = read('database/migrations/20261116_079_fix_background_push_dispatch.sql');
  const schema = read('database/schema.sql');
  const sendPush = read('supabase/functions/send-push/index.ts');
  const coreJs = read('js/core.js');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const statIcon = read('android/app/src/main/res/drawable/ic_stat_myipon.xml');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const syncService = read('android/app/src/main/java/com/myipon/app/NotificationSyncService.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');

  assert.match(migration079, /after insert or update of title, message, link, read_at, created_at/i);
  assert.match(migration079, /new\.created_at is not distinct from old\.created_at/i);
  assert.match(migration079, /'20261116_079'/);
  assert.match(schema, /after insert or update of title, message, link, read_at, created_at/i);
  assert.match(schema, /'20261116_079'/);

  assert.match(sendPush, /Deno\.env\.get\('SUPABASE_ANON_KEY'\)/);
  assert.match(sendPush, /apiKey\.split\('\.'\)\.length === 3/);
  assert.match(sendPush, /httpSend\('wake'/);
  assert.match(sendPush, /native_has_token:/);

  assert.match(statIcon, /<vector[^>]*android:width="24dp"/);
  assert.match(manifest, /SCHEDULE_EXACT_ALARM[^>]*maxSdkVersion="32"/);
  assert.doesNotMatch(pollReceiver, /getApplicationInfo\(\)\.icon/);
  assert.doesNotMatch(syncService, /getApplicationInfo\(\)\.icon/);
  assert.match(pollReceiver, /R\.drawable\.ic_stat_myipon/);
  assert.match(pollReceiver, /anonKey\.startsWith\("eyJ"\)/);
  assert.match(pollReceiver, /setExactAndAllowWhileIdle/);
  assert.match(pollReceiver, /scheduleServiceRestart\(/);
  assert.match(pollReceiver, /last_poll_http_code/);

  assert.match(syncService, /R\.drawable\.ic_stat_myipon/);
  assert.match(syncService, /public static void pokeOrReconnect\(/);
  assert.match(syncService, /myipon:ws-wake/);
  assert.match(syncService, /stoppedIntentionally/);

  assert.match(bgPlugin, /result\.put\("wsConnected",\s*NotificationSyncService\.isWsConnected\(\)\)/);
  assert.match(bgPlugin, /result\.put\("hasFeedConfig",\s*NotificationPollReceiver\.hasFeedConfig\(context\)\)/);
  assert.match(coreJs, /nativeBgStatus\?\.wsConnected === false/);
  assert.match(coreJs, /nativeBgStatus\?\.hasFeedConfig === false/);
});

test('mobile hides page/section descriptions only on <=720px, preserves 1-char chat previews, and queues concurrent Android wakes safely', () => {
  const migration080 = read('database/migrations/20261116_080_preserve_short_chat_notification_preview.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const syncService = read('android/app/src/main/java/com/myipon/app/NotificationSyncService.java');
  const syncWorker = read('android/app/src/main/java/com/myipon/app/NotificationSyncWorker.java');

  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.page-header p:not\(\.eyebrow\),\.panel-header > div > p:not\(#audit-count\),\.platform-overview-heading p,\.account-dialog-title p,\.account-section-heading p,\.account-session-copy p,\.settings-session-copy p,\.review-subtitle,\.msg-brand p,\.msg-friends-hero-copy p,\.msg-panel-header p:not\(\[id\]\),\.form-dialog:not\(\.bg-usage-dialog\):not\(\.recovery-dialog\) \.form-dialog-header:not\(\.bg-usage-header\) > div > p:not\(\.eyebrow\)/);
  assert.match(css, /\.page-header p:not\(\.eyebrow\)\s*\{\s*max-width:660px;/);

  assert.match(migration080, /check \(char_length\(btrim\(message\)\) between 1 and 500\)/i);
  assert.match(migration080, /if char_length\(v_clean_msg\) < 1 then/i);
  assert.match(migration080, /then 'Sent a video'/i);
  assert.match(migration080, /'20261116_080'/);
  assert.match(schema, /between 1 and 500/i);
  assert.match(schema, /if char_length\(v_clean_msg\) < 1 then/i);
  assert.match(schema, /then 'Sent a video'/i);
  assert.match(schema, /'20261116_080'/);

  assert.match(pollReceiver, /AtomicBoolean POLL_PENDING/);
  assert.match(pollReceiver, /POLL_PENDING\.set\(true\)/);
  assert.match(pollReceiver, /\.setWhen\(System\.currentTimeMillis\(\)\)/);
  assert.match(syncService, /NotificationPollReceiver\.pollAsync\(appContext, wakeLock\)/);
  assert.match(syncService, /NotificationSyncWorker\.enqueueImmediateSync\(appContext/);
  assert.match(syncWorker, /public static void enqueueImmediateSync\(/);
});

test('voice recording bar uses forest-emerald capsule, gold RECORDING label, serif timer, active mic circle, and mobile zero-overflow fit', async () => {
  const vm = await import('node:vm');
  const messagesJs = read('js/messages.js');
  const css = read('css/app.css');

  // CSS visual & mobile circle/pill contracts
  assert.match(css, /\.msg-composer-form\.is-recording\s*\{\s*align-items:\s*center;/);
  assert.match(css, /\.msg-tool-btn\s*\{[\s\S]*?aspect-ratio:\s*1\s*\/\s*1;/);
  assert.match(css, /\.msg-tool-btn\.is-recording,\s*\.msg-composer-form\.is-recording #msg-voice-btn\s*\{[\s\S]*?background:\s*#e3efe8;[\s\S]*?border-color:\s*#16533e;[\s\S]*?color:\s*#16533e;/);
  assert.match(css, /\.msg-voice-recording\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?#10241d/);
  assert.match(css, /\.msg-voice-rec-label\s*\{[\s\S]*?letter-spacing:\s*\.12em;[\s\S]*?color:\s*#e4c378;/);
  assert.match(css, /#msg-voice-timer\s*\{[\s\S]*?"IPON Serif"[\s\S]*?font-variant-numeric:\s*tabular-nums;[\s\S]*?color:\s*#f6f2e8;/);
  assert.match(css, /\.msg-voice-recording \.msg-voice-cancel\s*\{[\s\S]*?border-radius:\s*18px;/);
  assert.match(css, /\.msg-voice-recording \.msg-voice-send\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?background:\s*#e4c378;[\s\S]*?color:\s*#0e221b;/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.msg-tool-btn\s*\{\s*width:\s*34px;\s*height:\s*34px;/);
  assert.match(css, /@media\s*\(max-width:\s*380px\)[\s\S]*?\.msg-tool-btn\s*\{\s*width:\s*30px;\s*height:\s*30px;/);
  assert.match(css, /\.msg-thread-pane\[data-chat-theme="midnight"\] \.msg-voice-recording[\s\S]*?#122921/);

  // Markup keeps semantic labels, two-line "Send voice", and 0:00 timer
  assert.match(messagesJs, /id="msg-voice-recording"[^>]*>[\s\S]*?class="msg-voice-rec-label">RECORDING<[\s\S]*?id="msg-voice-timer">0:00<[\s\S]*?id="msg-voice-cancel">Cancel<[\s\S]*?id="msg-voice-send"><span>Send<\/span>\s*<span>voice<\/span></);

  // Runtime VM test: starting & cancelling toggles .is-recording, aria-pressed, and tabular clock text cleanly
  const els = new Map();
  const makeEl = () => {
    const classes = new Set();
    const attrs = new Map();
    return {
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      innerHTML: '',
      children: [],
      style: { setProperty() { } },
      dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      addEventListener() { },
      removeEventListener() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      appendChild(n) { return n; },
      showModal() { },
      close() { }
    };
  };
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl());
    return els.get(id);
  };
  const docClicks = [];
  let timerCb = null;
  let nowMs = 10_000;
  const FakeDate = class extends Date {
    static now() { return nowMs; }
  };
  const ctx = {
    window: null,
    document: {
      body: Object.assign(makeEl(), { dataset: { page: 'dashboard' }, classList: { toggle() { }, add() { }, remove() { }, contains: () => false } }),
      documentElement: makeEl(),
      getElementById: (id) => getEl(id),
      createElement: () => makeEl(),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(type, fn) { if (type === 'click') docClicks.push(fn); },
      removeEventListener() { }
    },
    navigator: {
      userAgent: 'Mozilla/5.0',
      onLine: true,
      mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { } }] }) }
    },
    MediaRecorder: class {
      constructor(stream) { this.stream = stream; this.state = 'inactive'; }
      static isTypeSupported() { return true; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; this.onstop?.(); }
    },
    Ipon: {
      profile: { id: 'u1', full_name: 'Juan Dela Cruz' },
      client: {
        rpc: async () => ({ data: null, error: null }),
        channel: () => ({ on() { return this; }, subscribe() { return this; }, track: async () => { }, untrack: async () => { }, send: async () => { } }),
        removeChannel() { },
        storage: { from: () => ({ upload: async () => ({ error: null }) }) }
      },
      avatarMarkup: () => '',
      syncPresenceDots() { },
      bindAvatarFallbacks() { },
      toast() { },
      confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e)
    },
    Date: FakeDate,
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, JSON, Promise, RegExp, Error, Intl,
    setTimeout: () => 0,
    clearTimeout() { },
    setInterval(fn) { timerCb = fn; return 77; },
    clearInterval() { timerCb = null; },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    removeEventListener() { },
    console
  };
  ctx.window = ctx;
  ctx.MediaRecorder.isTypeSupported = () => true;
  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.window.IponMessages.init({ profile: ctx.Ipon.profile });

  // Start recording
  await Promise.all(docClicks.map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-voice-btn' ? getEl('msg-voice-btn') : null) }
  })));
  assert.equal(getEl('msg-voice-recording').hidden, false);
  assert.equal(getEl('msg-composer-input').hidden, true);
  assert.equal(getEl('msg-send-btn').hidden, true);
  assert.equal(getEl('msg-composer-form').classList.contains('is-recording'), true);
  assert.equal(getEl('msg-voice-btn').classList.contains('is-recording'), true);
  assert.equal(getEl('msg-voice-btn').getAttribute('aria-pressed'), 'true');
  assert.equal(getEl('msg-voice-timer').textContent, '0:00');

  // Tick 7 seconds -> displays 0:07 without "Recording " prefix
  nowMs += 7_000;
  timerCb?.();
  assert.equal(getEl('msg-voice-timer').textContent, '0:07');

  // Cancel -> clears .is-recording, restores composer, and resets timer to 0:00
  await Promise.all(docClicks.map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-voice-cancel' ? getEl('msg-voice-cancel') : null) }
  })));
  assert.equal(getEl('msg-voice-recording').hidden, true);
  assert.equal(getEl('msg-composer-input').hidden, false);
  assert.equal(getEl('msg-send-btn').hidden, false);
  assert.equal(getEl('msg-composer-form').classList.contains('is-recording'), false);
  assert.equal(getEl('msg-voice-btn').classList.contains('is-recording'), false);
  assert.equal(getEl('msg-voice-btn').getAttribute('aria-pressed'), 'false');
  assert.equal(getEl('msg-voice-timer').textContent, '0:00');
});

test('migration 081, Edge cron, Storage media uploads, 500-char limits, annual archives, Terms/Privacy, and 14-day retention reminder work cleanly', async () => {
  const vm = await import('node:vm');
  const mig081 = read('database/migrations/20261116_081_data_retention_storage_hygiene_and_archives.sql');
  const mig082 = read('database/migrations/20261116_082_remove_admin_requests_from_retention.sql');
  const schema = read('database/schema.sql');
  const edgeFn = read('supabase/functions/manage-account/index.ts');
  const coreJs = read('js/core.js');
  const policyJs = read('js/policy.js');
  const authJs = read('js/auth.js');
  const accountHtml = read('account.html');
  const messagesJs = read('js/messages.js');
  const reportsJs = read('js/reports.js');
  const reportsHtml = read('reports.html');

  // 1. Database TTL, Storage deletion queue, pg_cron schedule, autovacuum, and annual archives (plus admin_requests removal in 082)
  assert.match(mig081, /insert into storage\.buckets[\s\S]*?'ipon-media'/i);
  assert.match(mig081, /create table if not exists public\.pending_storage_deletions/i);
  assert.match(mig081, /create or replace function public\.run_data_retention_cleanup\(/i);
  assert.match(mig081, /create or replace function public\.collect_inactive_account_candidates\(/i);
  assert.match(mig081, /create or replace function public\.purge_inactive_user_data\(/i);
  assert.match(mig081, /create table if not exists public\.financial_annual_archives/i);
  assert.match(mig081, /create or replace function public\.archive_group_year\(/i);
  assert.match(mig081, /alter table public\.audit_logs set \([\s\S]*?autovacuum_vacuum_scale_factor = 0\.05/i);
  assert.match(mig081, /'ipon-daily-retention-cleanup',\s*'0 16 \* \* \*'/);
  assert.doesNotMatch(mig082, /from public\.admin_requests/i);
  const cleanupBlock = [...schema.matchAll(/create or replace function public\.run_data_retention_cleanup[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
  assert.ok(cleanupBlock.length > 0);
  assert.doesNotMatch(cleanupBlock, /from public\.admin_requests/i);
  assert.match(schema, /'20261116_081'/);
  assert.match(schema, /'20261116_082'/);

  // 2. 500-char caps across SQL & frontend forms while preserving unlimited announcements
  assert.match(mig081, /add constraint messages_body_check check \(char_length\(body\) <= 500\)/i);
  assert.match(mig081, /add constraint record_comments_body_length_check check \(char_length\(btrim\(coalesce\(body, ''\)\)\) <= 500\)/i);
  assert.match(messagesJs, /id="msg-composer-input"[^>]*maxlength="500"/);
  assert.match(messagesJs, /Messages &amp; media older than 90 days automatically clear/);
  assert.match(coreJs, /id="record-thread-input"[^>]*maxlength="500"/);
  for (const page of ['contributions.html', 'withdrawals.html', 'expenses.html', 'user.html', 'dashboard.html', 'members.html', 'savings.html']) {
    assert.match(read(page), /name="notes"[^>]*maxlength="500"|id="(?:user|member|goal|quick)-notes"[^>]*maxlength="500"/);
  }

  // 3. Edge Function cloud media signed uploads, retention cron, & 7-day inactivity warning email
  assert.match(edgeFn, /body\.action === 'retention-cron'/);
  assert.match(edgeFn, /body\.action === 'media-upload-url'/);
  assert.match(edgeFn, /body\.action === 'super-admin-run-maintenance'/);
  assert.match(edgeFn, /sendInactivityWarningEmail/);
  assert.match(edgeFn, /drainPendingStorageDeletions/);

  // 4. Reports Annual Archive & CSV workflow + in-app retention visibility & auth policy deferral
  assert.match(reportsHtml, /id="annual-archive-panel"/);
  assert.match(reportsJs, /get_archivable_years/);
  assert.match(reportsJs, /archive_group_year/);
  assert.match(reportsJs, /Download CSV first/);
  assert.match(accountHtml, /data-retention-rules-open/);
  assert.match(coreJs, /data-retention-rules-open/);
  assert.match(authJs, /policyDialog\?\.open/);
  assert.match(authJs, /policyDialog\.addEventListener\('close'/);

  // 5. Runtime VM check for maybeShowRetentionReminder & openRetentionPolicyDialog (shows on first session, opens in-app rules modal, dismisses for 14 days, reappears after 14 days)
  let nowMs = 1_795_000_000_000;
  const FakeDate = class extends Date {
    static now() { return nowMs; }
  };
  const lsStore = new Map();
  const appendedNodes = [];
  const loaderEl = { hidden: false, setAttribute() { }, removeAttribute() { }, querySelector: () => ({ textContent: '' }) };
  const docStub = {
    head: { insertAdjacentHTML() { } },
    body: {
      dataset: { page: 'dashboard' },
      classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
      insertAdjacentHTML() { },
      appendChild(node) { node.parentNode = this; appendedNodes.push(node); return node; },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    documentElement: { dataset: {}, style: { setProperty() { } }, classList: { add() { }, remove() { }, toggle() { }, contains: () => false } },
    getElementById(id) {
      if (id === 'app-loader') return loaderEl;
      return appendedNodes.find((n) => n.id === id && !n._removed) || null;
    },
    createElement(tag) {
      const clickListeners = [];
      return {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        innerHTML: '',
        open: false,
        _removed: false,
        setAttribute() { },
        showModal() { this.open = true; },
        close() { this.open = false; },
        remove() { this._removed = true; },
        addEventListener() { },
        querySelectorAll: () => [],
        querySelector(sel) {
          if (sel === '[data-retention-ack]') {
            return { addEventListener: (ev, fn) => { if (ev === 'click') clickListeners.push(fn); } };
          }
          if (sel === '.retention-reminder-close' || sel === '[data-retention-rules-open]') return { addEventListener() { } };
          return null;
        },
        _triggerAck() { clickListeners.forEach((fn) => fn()); }
      };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
    removeEventListener() { }
  };
  const ctx = {
    window: null,
    document: docStub,
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    location: { protocol: 'https:', pathname: '/dashboard.html', search: '', href: 'https://my-ipon.vercel.app/dashboard.html' },
    localStorage: {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: (k) => lsStore.delete(k)
    },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Date: FakeDate,
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, JSON, Promise, RegExp, Error, Intl, Blob, Uint8Array, atob,
    setTimeout: () => 0,
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    requestAnimationFrame: (fn) => fn(),
    console
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  vm.runInNewContext(policyJs, ctx, { filename: 'js/policy.js' });

  const prof = { id: 'u-retention-1', full_name: 'Ana Santos', role: 'MEMBER' };
  const reminderCards = () => appendedNodes.filter((n) => n.id === 'ipon-retention-reminder');
  assert.equal(ctx.window.Ipon.maybeShowRetentionReminder(prof), true);
  assert.equal(reminderCards().length, 1);
  assert.match(reminderCards()[0].innerHTML, /90 days/);
  assert.match(reminderCards()[0].innerHTML, /6 months/);
  assert.match(reminderCards()[0].innerHTML, /7-day email notice/);
  assert.match(reminderCards()[0].innerHTML, /data-retention-rules-open/);

  assert.equal(ctx.window.Ipon.openRetentionPolicyDialog(), true);
  const policyDlg = docStub.getElementById('ipon-retention-dialog');
  assert.ok(policyDlg);
  assert.equal(policyDlg.open, true);
  assert.match(policyDlg.innerHTML, /12:00 AM PHT/);
  assert.match(policyDlg.innerHTML, /500 characters/);

  // Dismiss -> sets timestamp and prevents repeat banner inside 14-day window
  reminderCards()[0]._triggerAck();
  assert.equal(reminderCards()[0]._removed, true);
  nowMs += 5 * 24 * 60 * 60 * 1000;
  assert.equal(ctx.window.Ipon.maybeShowRetentionReminder(prof), false);

  // After 14 days -> subtle reminder appears again once
  nowMs += 10 * 24 * 60 * 60 * 1000;
  assert.equal(ctx.window.Ipon.maybeShowRetentionReminder(prof), true);
  assert.equal(reminderCards().length, 2);
});

test('migration 083, detailed Pic 1 & 2 policy dialogs, and mandatory 1x-per-account policy acceptance gate work end-to-end', async () => {
  const vm = await import('node:vm');
  const mig083 = read('database/migrations/20261116_083_policy_consent_tracking.sql');
  const schema = read('database/schema.sql');
  const loginHtml = read('login.html');
  const appCss = read('css/app.css');
  const coreJs = read('js/core.js');
  const policyJs = read('js/policy.js');
  const accountHtml = read('account.html');

  // 1. SQL migration 083 adds per-account consent columns, RPC, and suppresses noisy audit_logs entries
  assert.match(mig083, /add column if not exists policy_accepted_version text/i);
  assert.match(mig083, /add column if not exists policy_accepted_at timestamptz/i);
  assert.match(mig083, /create or replace function public\.accept_current_policy\(/i);
  assert.match(mig083, /'policy_accepted_version'/);
  assert.match(mig083, /'policy_accepted_at'/);
  assert.match(schema, /'20261116_083'/);

  // 2. Pic 1 & Pic 2 editorial styling + complete day-by-day retention breakdown in login.html & css/app.css
  assert.match(loginHtml, /\.policy-header\{[^}]*background:linear-gradient\(135deg,#0b1d18 0%,#081512 100%\)/);
  assert.match(loginHtml, /\.policy-header \.dialog-close\{[^}]*aspect-ratio:1 \/ 1;[^}]*border-radius:50%/);
  assert.match(loginHtml, /\.policy-content h3::before\{[^}]*background:#b88c3e/);
  assert.match(loginHtml, /7 days/);
  assert.match(loginHtml, /30 days/);
  assert.match(loginHtml, /90 days/);
  assert.match(loginHtml, /6 months/);
  assert.match(loginHtml, /7 days prior/);
  assert.match(loginHtml, /1\+ year/);
  assert.match(loginHtml, /500 characters/);
  assert.match(loginHtml, /12:00 AM Manila time/);
  assert.match(appCss, /\.policy-consent-dialog\s*\{/);
  assert.match(appCss, /\.policy-consent-agree-btn\s*\{/);
  assert.match(accountHtml, /data-policy-open-inapp="terms"/);
  assert.match(accountHtml, /data-policy-open-inapp="privacy"/);
  assert.match(coreJs, /select\([^)]*policy_accepted_version,policy_accepted_at/);

  // 3. Runtime VM verification: mandatory 1x-per-account consent modal + Pic 1 & 2 in-app openPolicyDialog
  const rpcCalls = [];
  const lsStore = new Map();
  const createdDialogs = [];
  const loaderEl = { hidden: false, setAttribute() { }, removeAttribute() { }, querySelector: () => ({ textContent: '' }) };
  const makeClassList = () => {
    const set = new Set();
    return {
      add: (c) => set.add(c),
      remove: (c) => set.delete(c),
      toggle: (c, force) => (force === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (force ? set.add(c) : set.delete(c))),
      contains: (c) => set.has(c)
    };
  };
  const makeStubEl = (tag) => {
    const listeners = new Map();
    const el = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: '',
      className: '',
      innerHTML: '',
      textContent: '',
      dataset: {},
      attributes: {},
      classList: makeClassList(),
      disabled: false,
      checked: false,
      hidden: false,
      open: false,
      scrollTop: 0,
      childrenMap: new Map(),
      setAttribute(k, v) { this.attributes[k] = String(v); },
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { this._removed = true; },
      focus() { this._focused = true; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      async _emit(ev, payload = {}) {
        for (const fn of listeners.get(ev) || []) await fn(payload);
      },
      _child(key) {
        if (!this.childrenMap.has(key)) {
          const child = makeStubEl('div');
          child.id = key.replace(/^#/, '');
          if (key === '#ipon-consent-agree-btn') child.disabled = true;
          this.childrenMap.set(key, child);
        }
        return this.childrenMap.get(key);
      },
      querySelector(sel) {
        if (sel === '#ipon-consent-tab-terms' || sel === '[data-consent-tab="terms"]') {
          const c = this._child('tab-terms');
          c.dataset.consentTab = 'terms';
          return c;
        }
        if (sel === '#ipon-consent-tab-privacy' || sel === '[data-consent-tab="privacy"]') {
          const c = this._child('tab-privacy');
          c.dataset.consentTab = 'privacy';
          return c;
        }
        return this._child(sel);
      },
      querySelectorAll(sel) {
        if (sel === '[data-consent-tab]') return [this.querySelector('#ipon-consent-tab-terms'), this.querySelector('#ipon-consent-tab-privacy')];
        if (sel === '[data-consent-panel]') {
          const p1 = this._child('panel-terms'); p1.dataset.consentPanel = 'terms';
          const p2 = this._child('panel-privacy'); p2.dataset.consentPanel = 'privacy';
          return [p1, p2];
        }
        if (sel === '[data-inapp-policy-section]') {
          const s1 = this._child('sec-terms'); s1.dataset.inappPolicySection = 'terms';
          const s2 = this._child('sec-privacy'); s2.dataset.inappPolicySection = 'privacy';
          return [s1, s2];
        }
        return [];
      }
    };
    return el;
  };
  const docStub = {
    head: { insertAdjacentHTML() { } },
    body: {
      dataset: { page: 'dashboard' },
      classList: makeClassList(),
      insertAdjacentHTML() { },
      appendChild(node) { createdDialogs.push(node); return node; },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    documentElement: { dataset: {}, style: { setProperty() { } }, classList: makeClassList() },
    getElementById: (id) => (id === 'app-loader' ? loaderEl : (createdDialogs.find((n) => n.id === id && !n._removed) || null)),
    createElement: (tag) => makeStubEl(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
    removeEventListener() { }
  };
  const ctx = {
    window: null,
    document: docStub,
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    location: { protocol: 'https:', pathname: '/dashboard.html', search: '', href: 'https://my-ipon.vercel.app/dashboard.html' },
    localStorage: {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: (k) => lsStore.delete(k)
    },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    supabase: {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: null } }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } })
        },
        rpc: async (fnName, args) => {
          rpcCalls.push({ fnName, args });
          return { data: { policy_accepted_version: args?.p_version || '2026-11-16', policy_accepted_at: '2026-11-16T05:00:00Z' }, error: null };
        }
      })
    },
    Date, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, JSON, Promise, RegExp, Error, Intl, Blob, Uint8Array, atob,
    setTimeout: () => 0,
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    requestAnimationFrame: (fn) => fn(),
    console
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  vm.runInNewContext(policyJs, ctx, { filename: 'js/policy.js' });

  const userProfile = { id: 'u-consent-1', full_name: 'Ana Santos', role: 'MEMBER', policy_accepted_version: null };
  assert.equal(ctx.window.Ipon.hasAcceptedCurrentPolicy(userProfile), false);

  let afterAcceptTriggered = false;
  assert.equal(ctx.window.Ipon.maybeShowPolicyConsentModal(userProfile, { onAccept: () => { afterAcceptTriggered = true; } }), true);
  const consentDlg = docStub.getElementById('ipon-policy-consent-dialog');
  assert.ok(consentDlg);
  assert.equal(consentDlg.open, true);
  assert.match(consentDlg.innerHTML, /I agree &amp; continue/);
  assert.doesNotMatch(consentDlg.innerHTML, /policy-consent-highlights|policy-consent-once-note/);
  assert.match(consentDlg.innerHTML, /90 days/);
  assert.match(consentDlg.innerHTML, /30 days/);
  assert.match(consentDlg.innerHTML, /6 months/);
  assert.match(consentDlg.innerHTML, /1\+ year/);

  const agreeBtn = consentDlg.querySelector('#ipon-consent-agree-btn');
  const checkbox = consentDlg.querySelector('#ipon-consent-checkbox');
  const errEl = consentDlg.querySelector('#ipon-consent-error');
  assert.equal(agreeBtn.disabled, true);

  // Escape cancel is blocked while unaccepted
  let cancelPrevented = false;
  await consentDlg._emit('cancel', { preventDefault: () => { cancelPrevented = true; } });
  assert.equal(cancelPrevented, true);
  assert.equal(errEl.classList.contains('is-visible'), true);

  // Switching to Privacy tab updates aria-selected and panel hidden state
  const privacyTab = consentDlg.querySelector('#ipon-consent-tab-privacy');
  await privacyTab._emit('click');
  assert.equal(privacyTab.attributes['aria-selected'], 'true');
  assert.equal(consentDlg.querySelectorAll('[data-consent-panel]')[1].hidden, false);

  // Checking the consent box unlocks I agree & continue and persists acceptance 1x per account
  checkbox.checked = true;
  await checkbox._emit('change');
  assert.equal(agreeBtn.disabled, false);

  await agreeBtn._emit('click');
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fnName, 'accept_current_policy');
  assert.equal(rpcCalls[0].args.p_version, '2026-11-16');
  assert.equal(userProfile.policy_accepted_version, '2026-11-16');
  assert.equal(consentDlg.open, false);
  assert.equal(afterAcceptTriggered, true);
  assert.equal(ctx.window.Ipon.hasAcceptedCurrentPolicy(userProfile), true);
  assert.equal(ctx.window.Ipon.maybeShowPolicyConsentModal(userProfile), false);

  // Opening standalone Pic 1 & 2 viewer dialog in-app switches cleanly between Terms & Privacy
  assert.equal(ctx.window.Ipon.openPolicyDialog('privacy'), true);
  const viewerDlg = docStub.getElementById('ipon-policy-dialog');
  assert.ok(viewerDlg);
  assert.equal(viewerDlg.open, true);
  assert.equal(viewerDlg.querySelector('#ipon-policy-title').textContent, 'Privacy policy');
});

test('migration 084, ongoing savings protection, 30-day completion bin, print border/break fix, and VM bin/batch flows work cleanly', async () => {
  const vm = await import('node:vm');
  const mig084 = read('database/migrations/20261116_084_ongoing_savings_protection_and_bin_lifecycle.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');
  const loginHtml = read('login.html');
  const policyJs = read('js/policy.js');
  const coreJs = read('js/core.js');
  const savingsHtml = read('savings.html');
  const savingsJs = read('js/savings.js');
  const settingsHtml = read('settings.html');
  const settingsJs = read('js/settings.js');
  const membersHtml = read('members.html');
  const membersJs = read('js/members.js');

  assert.match(mig084, /create table if not exists public\.savings_cycle_batches/i);
  assert.match(mig084, /create or replace function public\.complete_and_bin_savings_goal\(/i);
  assert.match(mig084, /create or replace function public\.archive_and_reset_savings_cycle\(/i);
  assert.match(mig084, /create or replace function public\.purge_bin_item_permanently\(/i);
  assert.match(mig084, /create or replace function public\.purge_bin_item_storage\(/i);
  assert.match(mig084, /ipon\.maintenance_bin_snapshot/);
  assert.match(mig084, /days_remaining/);
  assert.match(mig084, /'savings_cycle'/);
  assert.match(mig084, /'goal'/);
  assert.match(schema, /'20261116_084'/);

  const latestCleanup = [...schema.matchAll(/create or replace function public\.run_data_retention_cleanup[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
  assert.match(latestCleanup, /delete from public\.savings_goals[\s\S]*?deleted_at is not null[\s\S]*?deleted_at < v_bin_cutoff/i);
  assert.match(latestCleanup, /expired_bin_goals_deleted/);
  assert.match(latestCleanup, /expired_bin_savings_batches_deleted/);
  assert.match(latestCleanup, /purge_bin_item_storage/);

  const latestInactive = [...schema.matchAll(/create or replace function public\.collect_inactive_account_candidates[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
  assert.match(latestInactive, /from public\.savings_goals sg[\s\S]*?sg\.deleted_at is null[\s\S]*?sg\.status = 'ACTIVE'/i);

  // 2. Print fix keeps compact panels intact and restores STATUS right-column td:last-child bottom border
  const printBlock = css.match(/@media print\{[^\r\n]*/)?.[0] || '';
  assert.match(printBlock, /break-inside:avoid;page-break-inside:avoid/);
  assert.match(printBlock, /\.report-panel:has\(tbody tr:nth-child\(15\)\)\{break-inside:auto;page-break-inside:auto\}/);
  assert.match(printBlock, /\.data-table td:last-child[^}]*border-bottom:1px solid var\(--rule\)!important/);

  // 3. Detailed ongoing protection + 30-day completion bin documented in Terms & Privacy (login + in-app)
  assert.match(loginHtml, /Ongoing savings &amp; active goals are never deleted while you keep saving/i);
  assert.match(loginHtml, /30-day Recycle Bin/i);
  assert.match(policyJs, /Ongoing savings &amp; active goals are never deleted while you keep saving/i);
  assert.match(policyJs, /30-day Recycle Bin/i);
  assert.match(loginHtml, /Notifications and direct chat messages are delivered in-app only/i);
  assert.match(policyJs, /Notifications and direct chat messages are delivered in-app only/i);
  assert.match(coreJs, /<h2 id="donate-title">Support myIPON<\/h2>/);
  assert.doesNotMatch(coreJs, /Support IPON/);
  assert.doesNotMatch(coreJs, /even when myIPON is closed/);
  assert.match(coreJs, /<span>Device &amp; in-app alerts<\/span>/);
  assert.match(read('account.html'), /<span>Device &amp; in-app alerts<\/span>/);

  // 4. UI controls wired across Goals, Settings, and Members
  assert.match(savingsHtml, /id="open-savings-bin"/);
  assert.match(savingsHtml, /id="finish-savings-cycle"/);
  assert.match(savingsJs, /data-complete-goal=/);
  assert.match(savingsJs, /complete_and_bin_savings_goal/);
  assert.match(settingsHtml, /id="settings-open-bin"/);
  assert.match(settingsHtml, /id="settings-finish-cycle"/);
  assert.match(membersHtml, /option value="goal"/);
  assert.match(membersHtml, /option value="savings_cycle"/);
  assert.match(membersJs, /purge_bin_item_permanently/);

  // 5. Runtime VM test for formatBinExpiry, renderBinItemCard, openRecycleBin, and openFinishSavingsBatchDialog
  const rpcCalls = [];
  const createdDialogs = [];
  const loaderEl = { hidden: false, setAttribute() { }, removeAttribute() { }, querySelector: () => ({ textContent: '' }) };
  const makeClassList = () => {
    const set = new Set();
    return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, f) => (f ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
  };
  const makeStub = (tag) => {
    const listeners = new Map();
    const children = new Map();
    const node = {
      tagName: String(tag || 'DIV').toUpperCase(),
      id: '',
      className: '',
      _innerHTML: '',
      textContent: '',
      value: '',
      checked: true,
      disabled: false,
      hidden: false,
      open: false,
      dataset: {},
      attributes: {},
      classList: makeClassList(),
      set innerHTML(v) {
        this._innerHTML = String(v);
        if (children.has('#ipon-shared-bin-list')) children.get('#ipon-shared-bin-list').innerHTML = this._innerHTML;
      },
      get innerHTML() { return this._innerHTML; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { this._removed = true; },
      focus() { },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      async _emit(ev, payload = {}) {
        for (const fn of listeners.get(ev) || []) await fn(payload);
      },
      querySelector(sel) {
        if (!children.has(sel)) {
          const child = makeStub('div');
          if (sel === '#batch-reset-title') child.value = 'Batch 2026 — Completed Savings';
          if (sel === '#batch-reset-reason') child.value = 'Finished saving for emergency fund';
          if (sel === '#batch-reset-include-goals') child.checked = true;
          if (sel === '#ipon-shared-bin-filter') child.value = 'goal';
          children.set(sel, child);
        }
        return children.get(sel);
      },
      querySelectorAll: () => []
    };
    return node;
  };
  const docStub = {
    head: { insertAdjacentHTML() { } },
    body: {
      dataset: { page: 'savings' },
      classList: makeClassList(),
      insertAdjacentHTML() { },
      appendChild(node) { createdDialogs.push(node); return node; },
      querySelectorAll: () => [],
      querySelector: () => null
    },
    documentElement: { dataset: {}, style: { setProperty() { } }, classList: makeClassList() },
    getElementById: (id) => (id === 'app-loader' ? loaderEl : (createdDialogs.find((n) => n.id === id && !n._removed) || null)),
    createElement: (tag) => makeStub(tag),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
    removeEventListener() { }
  };
  const ctx = {
    window: null,
    document: docStub,
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    location: { protocol: 'https:', pathname: '/savings.html', search: '', href: 'https://my-ipon.vercel.app/savings.html' },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    Date, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, JSON, Promise, RegExp, Error, Intl, Blob, Uint8Array, atob,
    setTimeout: () => 0,
    clearTimeout() { },
    addEventListener() { },
    removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    requestAnimationFrame: (fn) => fn(),
    console
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  vm.runInNewContext(policyJs, ctx, { filename: 'js/policy.js' });
  ctx.window.Ipon.confirmAction = async () => true;
  ctx.window.Ipon.toast = () => { };
  ctx.window.Ipon.rpc = async (fnName, args) => {
    rpcCalls.push({ fnName, args });
    if (fnName === 'get_bin_items') {
      return [{
        item_type: 'goal',
        type_label: 'Goal',
        item_id: '00000000-0000-0000-0000-000000000101',
        title: 'Holiday Trip 2026',
        subtitle: 'Target PHP 25,000.00 · Completed',
        reason: 'Goal marked done and moved to 30-day bin',
        deleted_by_name: 'Ana Santos',
        deleted_at: '2026-11-16T04:00:00Z',
        expires_at: '2026-12-16T04:00:00Z',
        days_remaining: 5
      }];
    }
    return { batch_id: '00000000-0000-0000-0000-000000000202' };
  };

  const normalExp = ctx.window.IponPolicy.formatBinExpiry({ days_remaining: 18, expires_at: '2026-12-04T00:00:00Z' });
  assert.equal(normalExp.urgent, false);
  assert.match(normalExp.text, /18 days left/);

  const urgentExp = ctx.window.IponPolicy.formatBinExpiry({ days_remaining: 3, expires_at: '2026-11-19T00:00:00Z' });
  assert.equal(urgentExp.urgent, true);
  assert.match(urgentExp.text, /3 days left/);

  const zeroExp = ctx.window.IponPolicy.formatBinExpiry({ days_remaining: 0, expires_at: '2026-11-16T00:00:00Z' });
  assert.equal(zeroExp.urgent, true);
  assert.match(zeroExp.text, /Expires today/);

  const cardHtml = ctx.window.IponPolicy.renderBinItemCard({
    item_type: 'savings_cycle',
    type_label: 'Savings batch',
    item_id: 'batch-1',
    title: 'Batch 2026',
    subtitle: '14 records · Net PHP 50,000.00',
    reason: 'Completed cycle cleared to bin',
    deleted_by_name: 'Ana Santos',
    deleted_at: '2026-11-16T00:00:00Z',
    expires_at: '2026-11-20T00:00:00Z',
    days_remaining: 4
  });
  assert.match(cardHtml, /is-cycle/);
  assert.match(cardHtml, /is-urgent/);
  assert.match(cardHtml, /4 days left/);
  assert.match(cardHtml, /Delete forever/);

  assert.equal(ctx.window.IponPolicy.openRecycleBin({ defaultType: 'goal' }), true);
  await new Promise((r) => setImmediate(r));
  assert.equal(rpcCalls[0].fnName, 'get_bin_items');
  assert.equal(rpcCalls[0].args.p_type, 'goal');

  const binDlg = docStub.getElementById('ipon-shared-bin-dialog');
  assert.ok(binDlg);
  assert.equal(binDlg.open, true);
  assert.match(binDlg.querySelector('#ipon-shared-bin-list').innerHTML, /Holiday Trip 2026/);
  assert.match(binDlg.querySelector('#ipon-shared-bin-list').innerHTML, /5 days left/);

  // Test Finish Batch & Reset dialog submit
  assert.equal(ctx.window.IponPolicy.openFinishSavingsBatchDialog({ onDone: () => { } }), true);
  const batchDlg = docStub.getElementById('ipon-finish-batch-dialog');
  assert.ok(batchDlg);
  assert.equal(batchDlg.open, true);
  await batchDlg.querySelector('#ipon-finish-batch-form')._emit('submit', { preventDefault() { } });
  const resetCall = rpcCalls.find((c) => c.fnName === 'archive_and_reset_savings_cycle');
  assert.ok(resetCall);
  assert.equal(resetCall.args.p_title, 'Batch 2026 — Completed Savings');
  assert.equal(resetCall.args.p_include_completed_goals, true);
});
test('migration 085, 90-day & 6-month dormant savings email reminders, 30-day bin retention, and policy disclosures work cleanly', () => {
  const mig085 = read('database/migrations/20261116_085_abandoned_savings_email_reminders_and_retention.sql');
  const schema = read('database/schema.sql');
  const edgeFn = read('supabase/functions/manage-account/index.ts');
  const loginHtml = read('login.html');
  const policyJs = read('js/policy.js');
  const savingsHtml = read('savings.html');

  // 1. SQL migration 085 & schema sync cover group dormant tracking, reminders, 6-month bin transition, & suspended cleanup
  assert.match(mig085, /add column if not exists savings_inactivity_reminded_at timestamptz/i);
  assert.match(mig085, /add column if not exists savings_retention_warned_at timestamptz/i);
  assert.match(mig085, /create or replace function public\.group_last_savings_activity_at\(/i);
  assert.match(mig085, /create or replace function public\.snapshot_and_clear_group_savings_to_bin\(/i);
  assert.match(mig085, /create or replace function public\.collect_dormant_savings_groups\(/i);
  assert.match(mig085, /create or replace function public\.reset_dormant_savings_flag\(/i);
  assert.match(mig085, /create or replace function public\.move_dormant_savings_group_to_bin\(/i);
  assert.match(mig085, /'savings_inactivity_reminded_at'/);
  assert.match(mig085, /'savings_retention_warned_at'/);
  assert.match(mig085, /abandoned_suspended_groups_deleted/);
  assert.match(schema, /'20261116_085'/);

  const latestInactive = [...schema.matchAll(/create or replace function public\.collect_inactive_account_candidates[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
  assert.match(latestInactive, /group_last_savings_activity_at\(p\.group_id\)/i);

  // 2. Edge Function sends both 90-day check-in reminders and 6-month 7-day prior warnings, and bins abandoned groups after 7 days
  assert.match(edgeFn, /async function sendDormantSavingsEmail\(/);
  assert.match(edgeFn, /admin\.rpc\('collect_dormant_savings_groups'/);
  assert.match(edgeFn, /admin\.rpc\('reset_dormant_savings_flag'/);
  assert.match(edgeFn, /admin\.rpc\('move_dormant_savings_group_to_bin'/);
  assert.match(edgeFn, /dormant_savings_reminded_groups/);
  assert.match(edgeFn, /dormant_savings_warned_groups/);
  assert.match(edgeFn, /dormant_savings_binned_groups/);

  // 3. Terms of Use, Privacy Policy, in-app modals, & Goals banner clearly explain forgotten/abandoned savings reminders & retention
  assert.match(loginHtml, /Forgotten or abandoned savings policy/i);
  assert.match(loginHtml, /dormant savings check-in reminders \(90 days idle\)/i);
  assert.match(policyJs, /Forgotten or abandoned savings policy/i);
  assert.match(policyJs, /dormant savings check-in reminders \(90 days idle\)/i);
  assert.match(savingsHtml, /7-day warning at 6 months/i);
});

test('migrations 086-087 restore Member transparency + Super Admin name rules, fix retention & back-button gate, and sync realtime live', () => {
  const mig086 = read('database/migrations/20261116_086_restore_policies_fix_retention_and_realtime.sql');
  const mig087 = read('database/migrations/20261116_087_preserve_updated_at_during_retention.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const policyJs = read('js/policy.js');
  const dashboardJs = read('js/dashboard.js');
  const userJs = read('js/user.js');
  const edgeFn = read('supabase/functions/manage-account/index.ts');
  const accountHtml = read('account.html');

  // 1. Migrations 086 & 087 + schema.sql lock in Super Admin name rules, Member ledger visibility, retention fixes, & realtime publication
  assert.match(mig086, /v_is_super_admin := \(new\.role = 'SUPER_ADMIN'\)/);
  assert.match(mig086, /new\.first_name is distinct from old\.first_name/i);
  assert.match(mig086, /drop function if exists public\.create_member\(text, text, text, text, date, numeric, text\)/i);
  const latestSummary = [...schema.matchAll(/create or replace function public\.get_savings_summary\(\)[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
  assert.match(latestSummary, /'MEMBER'/);
  assert.doesNotMatch(latestSummary, /is_treasurer_or_admin/i);
  for (const policy of ['members_select', 'contribution_periods_select', 'contributions_select', 'expenses_select', 'withdrawals_select']) {
    const latestPol = [...schema.matchAll(new RegExp(`create policy ${policy}[\\s\\S]*?;`, 'gi'))].pop()?.[0] || '';
    assert.match(latestPol, /'MEMBER'/);
  }
  const latestCleanup = [...schema.matchAll(/create or replace function public\.run_data_retention_cleanup[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
  assert.match(latestCleanup, /delete from public\.call_sessions[\s\S]*?coalesce\(ended_at,\s*started_at\)\s*<\s*v_call_cutoff/i);
  assert.doesNotMatch(latestCleanup, /coalesce\(ended_at,\s*started_at,\s*created_at\)/i);
  assert.match(latestCleanup, /delete from public\.contribution_settings cs/i);
  assert.match(mig086, /v_is_backend_maintenance boolean :=[\s\S]*?auth\.uid\(\) is null/i);
  assert.match(mig086, /alter publication supabase_realtime add table public\.%I/i);
  assert.match(mig087, /create or replace function public\.set_updated_at\(\)/i);
  assert.match(mig087, /ipon\.maintenance_retention_cleanup/);
  assert.match(schema, /'20261116_086'/);
  assert.match(schema, /'20261116_087'/);

  // 2. account.html is clean single-document HTML with zero duplicate </html> or duplicated IDs
  assert.equal((accountHtml.match(/<\/html>/gi) || []).length, 1);
  assert.equal((accountHtml.match(/id="account-page-dialog"/g) || []).length, 1);

  // 3. Edge Function surfaces RPC errors cleanly and drains storage on runSqlCleanup / dormant moves
  assert.match(edgeFn, /runSqlCleanup \|\| dormantBinnedGroups > 0/);
  assert.match(edgeFn, /success: result\.errors\.length === 0/);

  // 4. Client safety: Dashboard throws instead of masking null summary as P0.00; realtime sync covers notifications + BroadcastChannel
  assert.match(dashboardJs, /Group savings summary is currently unavailable/);
  assert.match(userJs, /subscribeToChanges\('member-dashboard',[\s\S]*?'announcements'/);
  assert.match(coreJs, /notifyLiveSync\('announcements'\)/);
  assert.match(coreJs, /activeAnnouncementsController\?\.load\?\.\(\)/);
  assert.match(coreJs, /document\.getElementById\('ipon-policy-consent-dialog'\)[\s\S]*?accepted !== '1'[\s\S]*?ipon:policy-back-blocked/);
  assert.match(policyJs, /window\.addEventListener\('popstate'/);
  assert.match(policyJs, /ipon:policy-back-blocked/);

  // 5. Runtime VM verification: handleNativeBack NEVER closes unaccepted #ipon-policy-consent-dialog
  const consentDlg = { id: 'ipon-policy-consent-dialog', open: true, dataset: {}, closed: false, close() { this.open = false; this.closed = true; } };
  const dispatched = [];
  const noop = () => { };
  const dummyEl = () => ({ hidden: false, dataset: {}, innerHTML: '', textContent: '', style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, removeAttribute: noop, appendChild: noop, prepend: noop, append: noop });
  const ctx = {
    window: null,
    navigator: { onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', href: 'https://my-ipon.vercel.app/dashboard.html', replace: noop, assign: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: (ev) => dispatched.push(ev.type),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
    document: {
      documentElement: { dataset: {}, style: { setProperty: noop, removeProperty: noop } },
      body: { dataset: { page: 'dashboard' }, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, insertAdjacentHTML: noop, appendChild: noop, prepend: noop, append: noop },
      head: { insertAdjacentHTML: noop },
      createElement: () => dummyEl(),
      querySelector: () => null,
      querySelectorAll: (sel) => (sel === 'dialog[open]' ? [consentDlg] : []),
      getElementById: (id) => (id === 'ipon-policy-consent-dialog' ? consentDlg : id === 'app-loader' ? dummyEl() : null),
      addEventListener: noop,
      removeEventListener: noop
    }
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  assert.equal(ctx.window.Ipon.handleNativeBack(), 'handled');
  assert.equal(consentDlg.open, true);
  assert.equal(consentDlg.closed, false);
  assert.ok(dispatched.includes('ipon:policy-back-blocked'));
});

test('migrations 088-089 restore drifted RPCs, fix enforce_group_scope guards, expose safe member identities, and hide unauthorized forms', () => {
  const mig088 = read('database/migrations/20261116_088_restore_reverted_rpcs_and_scope_guards.sql');
  const mig089 = read('database/migrations/20261116_089_fix_enforce_group_scope_nested_if.sql');
  const schema = read('database/schema.sql');
  const dashboardJs = read('js/dashboard.js');
  const recordsJs = read('js/records.js');
  const auditJs = read('js/audit.js');
  const reportsJs = read('js/reports.js');
  const settingsJs = read('js/settings.js');
  const superAdminJs = read('js/super-admin.js');
  const withdrawalsHtml = read('withdrawals.html');
  const expensesHtml = read('expenses.html');
  const css = read('css/app.css');

  for (const fn of [
    'current_group_id()',
    'validated_name_part(',
    'record_account_activity(',
    'generate_contribution_periods(',
    'get_user_dashboard()',
    'notify_record_activity()',
    'notify_new_member()',
    'notify_profile_access()',
    'create_due_reminders()',
    'handle_new_user()',
    'admin_set_user_access(',
    'super_admin_approve_request(',
    'super_admin_reject_request(',
    'super_admin_archive_administrator(',
    'super_admin_create_group(',
    'super_admin_set_administrator_status(',
    'super_admin_update_administrator(',
    'get_group_member_identities()',
    'get_pending_review_summary()'
  ]) {
    assert.ok(mig088.includes(fn), `Migration 088 must restore or define ${fn}`);
  }
  assert.match(mig088, /account_activity[\s\S]*admin_requests[\s\S]*audit_logs[\s\S]*financial_annual_archives/);
  assert.match(mig089, /create or replace function public\.enforce_group_scope\(\)/i);
  assert.match(mig089, /ipon\.maintenance_archive_rollup/);
  assert.match(mig089, /ipon\.maintenance_bin_snapshot/);
  assert.match(mig089, /ipon\.maintenance_receipt_cleanup/);
  assert.match(mig089, /ipon\.activating_member_id/);
  assert.match(mig089, /ipon\.syncing_own_profile_user_id/);
  assert.match(mig089, /ipon\.syncing_member_profile_id/);
  assert.match(mig089, /if tg_table_name = 'members' and pg_trigger_depth\(\) <= 1 then/);
  assert.match(schema, /'20261116_088'/);
  assert.match(schema, /'20261116_089'/);

  // Client integration checks
  assert.match(dashboardJs, /get_group_member_identities/);
  assert.match(recordsJs, /get_group_member_identities/);
  assert.match(recordsJs, /archived_paid_amount/);
  assert.match(recordsJs, /Only administrators and treasurers can record/);
  assert.match(auditJs, /get_group_member_identities/);
  assert.match(reportsJs, /financial_annual_archives/);
  assert.match(settingsJs, /group_memberships/);
  assert.match(superAdminJs, /admin_requests/);
  assert.match(withdrawalsHtml, /<section class="panel sticky-panel" data-role="ADMIN,TREASURER">/);
  assert.match(expensesHtml, /<section class="panel sticky-panel" data-role="ADMIN,TREASURER">/);
  assert.match(css, /\.split-layout:has\(> \.sticky-panel\[hidden\]\)/);
});

test('confirmation dialogs match the warm-cream card, top gold rule, editorial serif heading, and equal two-column pill actions', async () => {
  const vm = await import('node:vm');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const loginHtml = read('login.html');

  // CSS styling contracts matching the "Sign out?" reference card across confirm flows
  assert.match(css, /\.confirm-dialog\s*\{[^}]*border-radius:\s*22px;[^}]*background:\s*#faf6ee;/);
  assert.match(css, /\.confirm-dialog h2::before\s*\{[^}]*width:\s*26px;\s*height:\s*2px;[^}]*background:\s*#b88c3e;/);
  assert.match(css, /\.confirm-dialog \.dialog-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.confirm-dialog \.dialog-actions \.button-primary\s*\{[^}]*background:\s*#102420;/);
  assert.match(css, /\.record-review-confirm-box\s*\{[^}]*border-radius:\s*18px;[^}]*background:\s*#faf6ee;/);
  assert.match(css, /\.record-review-confirm-box strong::before\s*\{[^}]*width:\s*26px;\s*height:\s*2px;[^}]*background:\s*#b88c3e;/);
  assert.match(css, /:is\(#record-action-step-confirm,\s*#member-delete-confirm-step\) \.form-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /#bulk-confirm-dialog\s*\{[^}]*border-radius:\s*22px;[^}]*background:\s*#faf6ee;/);
  assert.match(loginHtml, /\.request-confirm-dialog\{[^}]*border-radius:22px;background:#faf6ee/);
  assert.match(loginHtml, /\.request-confirm-dialog h2::before\{[^}]*background:#b88c3e/);

  // Runtime test: confirmAction honors acceptLabel, confirmLabel, confirmText, and cancelLabel cleanly
  const elements = {
    'confirm-dialog': {
      returnValue: '',
      dataset: {},
      listeners: {},
      showModal() {
        const closeHandlers = this.listeners.close || [];
        this.returnValue = 'confirm';
        while (closeHandlers.length) closeHandlers.shift()();
      },
      addEventListener(type, fn) {
        (this.listeners[type] ||= []).push(fn);
      },
      querySelector() {
        return elements['confirm-cancel'];
      }
    },
    'confirm-title': { textContent: '' },
    'confirm-message': { textContent: '' },
    'confirm-cancel': { textContent: 'Cancel' },
    'confirm-accept': { textContent: 'Confirm' }
  };
  const noop = () => { };
  const dummyEl = () => ({ hidden: false, dataset: {}, innerHTML: '', textContent: '', style: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, removeAttribute: noop, appendChild: noop, prepend: noop, append: noop });
  const ctx = {
    console,
    Date,
    Math,
    URL,
    Set,
    Map,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: noop,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', origin: 'https://my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/dashboard.html', replace: noop, assign: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    document: {
      documentElement: { setAttribute: noop, dataset: {}, style: { setProperty: noop, removeProperty: noop } },
      head: { insertAdjacentHTML: noop },
      body: { dataset: {}, classList: { contains: () => false, add: noop, remove: noop, toggle: noop }, insertAdjacentHTML: noop, appendChild: noop, prepend: noop, append: noop },
      createElement: () => dummyEl(),
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: (id) => elements[id] || null,
      querySelectorAll: () => [],
      querySelector: () => null
    }
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  await ctx.window.Ipon.confirmAction({
    title: 'Delete announcement',
    message: 'Delete this item?',
    confirmLabel: 'Delete'
  });
  assert.equal(elements['confirm-accept'].textContent, 'Delete');
  assert.equal(elements['confirm-cancel'].textContent, 'Cancel');

  await ctx.window.Ipon.confirmAction({
    title: 'Remove friend?',
    message: 'Remove from Friends?',
    confirmText: 'Remove',
    cancelLabel: 'Not now'
  });
  assert.equal(elements['confirm-accept'].textContent, 'Remove');
  assert.equal(elements['confirm-cancel'].textContent, 'Not now');

  await ctx.window.Ipon.confirmAction({
    title: 'Sign out?',
    message: 'You will need to sign in again to access the system.',
    acceptLabel: 'Sign out'
  });
  assert.equal(elements['confirm-accept'].textContent, 'Sign out');
  assert.equal(elements['confirm-cancel'].textContent, 'Cancel');
});

test('migration 090 grants feature_requests.allow_credit insert, drops stale overloaded RPCs, and validates feedback forms cleanly', () => {
  const mig090 = read('database/migrations/20261116_090_fix_feature_request_insert_grant_and_drop_stale_rpcs.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');

  for (const sql of [mig090, schema]) {
    assert.match(sql, /grant insert \(requester_id, title, details, allow_credit\) on public\.feature_requests to authenticated;/i);
    assert.match(sql, /grant insert \(reporter_id, title, description, attachments\) on public\.bug_reports to authenticated;/i);
    assert.match(sql, /drop function if exists public\.create_member\(text, text, text, text, date, numeric, text\);/i);
    assert.match(sql, /drop function if exists public\.update_member\(uuid, text, text, text, text, numeric, text\);/i);
    assert.match(sql, /drop function if exists public\.update_own_profile\(text, text, text, text\);/i);
    assert.match(sql, /drop function if exists public\.update_contribution\(uuid, numeric, date, text, text\);/i);
    assert.match(sql, /drop function if exists public\.update_expense\(uuid, date, numeric, text, text, text, text, text\);/i);
    assert.match(sql, /drop function if exists public\.update_withdrawal\(uuid, date, numeric, text, text, text, text, text\);/i);
    assert.match(sql, /'20261116_090'/);
  }
  assert.match(core, /Feature name must be between 3 and 120 characters\./);
  assert.match(core, /Feature description must be between 10 and 2000 characters\./);
  assert.match(core, /Bug title must be between 3 and 120 characters\./);
  assert.match(core, /Bug description must be between 10 and 2000 characters\./);
});

test('migration 091 restores reverted RPCs, 9 RLS SELECT policies, strict grants, and missing group memberships', () => {
  const mig091 = read('database/migrations/20261116_091_restore_reverted_rpcs_policies_and_memberships.sql');
  const schema = read('database/schema.sql');

  assert.match(schema, /Do NOT copy\/run partial blocks from this file on an existing or production database/i);

  for (const sql of [mig091, schema]) {
    assert.match(sql, /drop function if exists public\.create_member\(text, text, text, text, date, numeric, text\);/i);
    assert.match(sql, /create or replace function public\.get_savings_summary\(\)/i);
    assert.match(sql, /create or replace function public\.enforce_group_scope\(\)/i);
    assert.match(sql, /create policy profiles_select on public\.profiles/i);
    assert.match(sql, /create policy account_activity_select on public\.account_activity/i);
    assert.match(sql, /create policy groups_select on public\.groups/i);
    assert.match(sql, /create policy savings_goals_select on public\.savings_goals/i);
    assert.match(sql, /create policy members_select on public\.members/i);
    assert.match(sql, /create policy contribution_periods_select on public\.contribution_periods/i);
    assert.match(sql, /create policy contributions_select on public\.contributions/i);
    assert.match(sql, /create policy expenses_select on public\.expenses/i);
    assert.match(sql, /create policy withdrawals_select on public\.withdrawals/i);
    assert.match(sql, /insert into public\.group_memberships\s*\(group_id,\s*user_id,\s*role,\s*status,\s*member_id\)/i);
    assert.match(sql, /revoke all on function public\.enforce_data_quality\(\) from public, anon, authenticated;/i);
    assert.match(sql, /grant execute on function public\.get_savings_summary\(\) to authenticated;/i);
    assert.match(sql, /'20261116_091'/);
  }
});

test('migration 092 and UI fixes elevate floating utilities, clean Brainier group assignment, add Bug Report Fixed + AI release flow, and remove duplicate Super Admin headers', () => {
  const mig092 = read('database/migrations/20261116_092_bug_report_fixed_status_and_clean_unlinked_group.sql');
  const schema = read('database/schema.sql');
  const appCss = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  const saHtml = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const edgeFn = read('supabase/functions/manage-account/index.ts');

  for (const sql of [mig092, schema]) {
    assert.match(sql, /delete from public\.group_memberships[\s\S]*?'68853776-6a1b-4170-afb8-5dd93c3de90c'/i);
    assert.match(sql, /alter table public\.bug_reports[\s\S]*?status text not null default 'OPEN' check \(status in \('OPEN', 'FIXED'\)\)/i);
    assert.match(sql, /create or replace function public\.review_bug_report\(/i);
    assert.match(sql, /revoke all on function public\.review_bug_report\(uuid, text, text\) from public, anon;/i);
    assert.match(sql, /grant execute on function public\.review_bug_report\(uuid, text, text\) to authenticated;/i);
    assert.match(sql, /update public\.bug_reports[\s\S]*?set release_version = v_version[\s\S]*?where status = 'FIXED' and release_version is null/i);
    assert.match(sql, /'20261116_092'/);
  }

  // Pic 1: Message and notification triggers stay above scrolling workspace cards
  assert.match(appCss, /\.app-sidebar\s*\{[^}]*z-index:190;/);
  assert.match(appCss, /\.sidebar-utility\[data-notifications-open\]\{[^}]*z-index:192;/);
  assert.match(appCss, /\.sidebar-utility\[data-messages-open\]\s*\{[^}]*z-index:\s*192;/);
  assert.match(appCss, /\.notification-dialog\{[^}]*z-index:185;/);
  assert.match(heroCss, /\.dashboard-sidebar\s*\{[^}]*z-index:190;/);

  // Pic 2 & 3: Remove redundant page header on sub-views, add Bug Report Open/Fixed workflow & Fixed -> Release AI integration
  assert.match(saHtml, /id="platform-page-header"/);
  assert.match(saHtml, /id="bug-reports-status-tabs"/);
  assert.match(saHtml, /data-bug-status-filter="OPEN"[^>]*>Open/);
  assert.match(saHtml, /data-bug-status-filter="FIXED"[^>]*>Fixed/);
  const pageHeaderMarkup = saHtml.match(/<header[^>]*id="platform-page-header"[\s\S]*?<\/header>/)?.[0] || '';
  assert.ok(pageHeaderMarkup, 'super-admin.html must define #platform-page-header');
  assert.doesNotMatch(pageHeaderMarkup, /id="create-administrator"/);
  assert.match(saHtml, /id="administrators"[\s\S]*?id="create-administrator"/);
  assert.match(saJs, /pageHeader\.hidden = activeView !== 'overview'/);
  assert.match(saJs, /let activeBugStatusFilter = 'OPEN'/);
  assert.match(saJs, /review_bug_report/);
  assert.match(saJs, /data-bug-action="FIXED"/);
  assert.match(saJs, /targetFixedBugs\s*=\s*bugReports\.filter/);
  assert.match(saJs, /fixed_bugs:\s*targetFixedBugs\.map/);
  assert.match(edgeFn, /Verified bug reports fixed for/);
  assert.match(edgeFn, /fixedBugPromptLines/);
});

test('migration 093 and workspace UI remove global Role from Super Admin Users, add multi-group +N overflow, and add Solo vs Group saving with full retention', () => {
  const mig093 = read('database/migrations/20261116_093_solo_group_workspaces_and_restore_sync.sql');
  const schema = read('database/schema.sql');
  const saHtml = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const dashHtml = read('dashboard.html');
  const dashJs = read('js/dashboard.js');
  const coreJs = read('js/core.js');
  const recordsJs = read('js/records.js');
  const membersJs = read('js/members.js');
  const settingsJs = read('js/settings.js');
  const css = read('css/app.css');
  const edgeFn = read('supabase/functions/manage-account/index.ts');

  for (const sql of [mig093, schema]) {
    assert.match(sql, /alter table public\.groups[\s\S]*?add column if not exists workspace_mode text not null default 'GROUP'/i);
    assert.match(sql, /check \(workspace_mode in \('SOLO', 'GROUP'\)\)/i);
    assert.match(sql, /drop function if exists public\.admin_create_group\(text, text, boolean, numeric\);/i);
    assert.match(sql, /create or replace function public\.admin_create_group\([\s\S]*?p_workspace_mode text default 'GROUP'/i);
    assert.match(sql, /create or replace function public\.get_my_groups\(\)[\s\S]*?workspace_mode text/i);
    assert.match(sql, /create or replace function public\.switch_active_group\(p_group_id uuid\)[\s\S]*?'workspace_mode'/i);
    assert.match(sql, /drop function if exists public\.update_group_profile\(text, text, boolean\);/i);
    assert.match(sql, /create or replace function public\.update_group_profile\([\s\S]*?p_workspace_mode text default null/i);
    assert.match(sql, /Remove other members before switching this workspace to Solo savings\./i);
    assert.match(sql, /Solo savings workspaces do not support additional members or invites\./i);
    assert.match(sql, /Solo savings workspaces do not accept member or treasurer invitations\./i);
    assert.match(sql, /where id = p_user_id[\s\S]*?and role <> 'SUPER_ADMIN'/i);
    assert.match(sql, /'20261116_093'/);
  }

  // Solo workspaces remain standard rows in public.groups so existing retention/bin cleanup applies automatically
  assert.doesNotMatch(mig093, /where[^\n]*workspace_mode\s*<>\s*'SOLO'[^\n]*retention/i);
  assert.match(edgeFn, /targetGroup\?\.workspace_mode === 'SOLO'/);

  // Super Admin Users drops global Role filter/column and displays multi-group pills + overflow dialog
  const usersSection = saHtml.match(/<div[^>]*id="administrators"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(usersSection, 'super-admin.html must define #administrators section');
  assert.doesNotMatch(usersSection, /<th>Role<\/th>/);
  assert.match(usersSection, /<th>Groups<\/th>/);
  assert.match(saHtml, /id="user-groups-dialog"/);
  assert.match(saJs, /from\('group_memberships'\)\.select\('group_id,user_id,role,status'\)/);
  assert.match(saJs, /function getUserGroups\(/);
  assert.match(saJs, /function renderUserGroupsCell\(/);
  assert.match(saJs, /data-view-user-groups/);
  assert.match(saJs, /openUserGroupsDialog\(/);
  assert.match(css, /\.sa-group-pills\b/);
  assert.match(css, /\.sa-group-chip\.is-solo\b/);
  assert.match(css, /\.sa-group-more-btn\b/);

  // Solo vs Group creation, management hub switch, sidebar sync, and memberless flows
  assert.match(dashHtml, /id="no-group-solo-btn"/);
  assert.match(dashHtml, /id="group-workspace-mode-tabs"/);
  assert.match(dashHtml, /id="group-hub-solo-banner"/);
  assert.match(dashHtml, /href="members\.html"[^>]*data-group-only="1"/);
  assert.match(dashJs, /function syncGroupFormWorkspaceMode\(/);
  assert.match(dashJs, /p_workspace_mode:\s*workspaceMode/);
  assert.match(dashJs, /Ipon\.syncWorkspaceMode\?\./);
  assert.match(coreJs, /function syncWorkspaceMode\(/);
  assert.match(coreJs, /data-group-required-create="SOLO"/);
  assert.match(recordsJs, /state\.profile\?\.workspace_mode === 'SOLO'/);
  assert.match(membersJs, /currentGroup\?\.workspace_mode === 'SOLO'/);
  assert.match(settingsJs, /activeGroup\?\.workspace_mode === 'SOLO'/);
});

test('migration 094 and budget.html implement non-destructive Budget Allocation & Expense Tracking linked to live IPON savings', async () => {
  const mig094 = read('database/migrations/20261116_094_budget_allocation_tracker.sql');
  const schema = read('database/schema.sql');
  const budgetHtml = read('budget.html');
  const budgetJs = read('js/budget.js');
  const coreJs = read('js/core.js');
  const appCss = read('css/app.css');

  for (const sql of [mig094, schema]) {
    assert.match(sql, /'20261116_094'/);
    assert.match(sql, /create table if not exists public\.budget_configs/i);
    assert.match(sql, /create table if not exists public\.budget_items/i);
    assert.match(sql, /create table if not exists public\.budget_expenses/i);
    assert.match(sql, /create or replace function public\.get_budget_overview\(/i);
    assert.match(sql, /create or replace function public\.save_budget_allocation\(/i);
    assert.match(sql, /create or replace function public\.save_budget_item\(/i);
    assert.match(sql, /create or replace function public\.delete_budget_item\(/i);
    assert.match(sql, /create or replace function public\.save_budget_expense\(/i);
    assert.match(sql, /create or replace function public\.delete_budget_expense\(/i);
  }

  assert.match(coreJs, /\['budget',\s*'budget\.html',\s*'Budget'/);
  assert.match(budgetHtml, /class="budget-workspace-strip" id="budget-group-bar"/);
  assert.match(budgetHtml, /class="budget-hero"/);
  assert.match(budgetHtml, /id="budget-ref-balance"/);
  assert.match(budgetHtml, /id="budget-total-allocated"/);
  assert.match(budgetHtml, /id="budget-total-spent"/);
  assert.match(budgetHtml, /id="budget-total-remaining"/);
  assert.match(budgetHtml, /id="budget-categories-grid"/);
  assert.match(budgetHtml, /id="budget-expenses-body"/);
  assert.match(budgetHtml, /id="budget-item-dialog"/);
  assert.match(budgetHtml, /id="budget-expense-dialog"/);
  assert.match(budgetHtml, /id="budget-split-dialog"/);

  assert.match(appCss, /\.budget-hero::after/);
  assert.match(appCss, /\.budget-stats-grid/);
  assert.match(appCss, /\.budget-categories-grid/);
  assert.match(appCss, /\.budget-history-panel/);
  assert.match(appCss, /html\[data-theme="dark"\] \.budget-workspace/);

  // Runtime VM check for js/budget.js render and live savings recalculation
  const els = new Map();
  const makeEl = (id) => {
    const cls = new Set();
    const listeners = new Map();
    const el = {
      id,
      value: '',
      hidden: false,
      disabled: false,
      open: false,
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      validity: { badInput: false, valid: true },
      classList: {
        add: (...names) => names.forEach((n) => cls.add(n)),
        remove: (...names) => names.forEach((n) => cls.delete(n)),
        toggle: (name, force) => (force === undefined ? (cls.has(name) ? cls.delete(name) : cls.add(name)) : (force ? cls.add(name) : cls.delete(name))),
        contains: (name) => cls.has(name)
      },
      setAttribute() { },
      removeAttribute() { },
      focus() { },
      select() { },
      reset() { },
      replaceChildren() { el.innerHTML = ''; },
      showModal() { el.open = true; },
      close() { el.open = false; },
      querySelector(sel) {
        if (sel === 'span') return makeEl(`${id}:span`);
        if (sel.startsWith('[data-page=')) return makeEl(`${id}:${sel}`);
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      async _emit(type, evt = {}) {
        for (const fn of listeners.get(type) || []) {
          await fn({ target: el, preventDefault() { }, ...evt });
        }
      }
    };
    if (id) els.set(id, el);
    return el;
  };
  [
    'budget-group-bar', 'budget-group-name', 'budget-group-switcher-wrap', 'budget-group-select',
    'budget-error-slot', 'budget-no-workspace', 'budget-workspace-content', 'budget-header-actions',
    'budget-split-heading', 'budget-source-label', 'budget-ratio-needs', 'budget-ratio-wants',
    'budget-ratio-savings', 'budget-legend-needs-pct', 'budget-legend-wants-pct', 'budget-legend-savings-pct',
    'budget-legend-needs-amt', 'budget-legend-wants-amt', 'budget-legend-savings-amt',
    'budget-ref-balance', 'budget-ref-note', 'budget-total-allocated', 'budget-total-itemized',
    'budget-total-spent', 'budget-spent-pct', 'budget-total-remaining', 'budget-remaining-note',
    'budget-categories-grid', 'budget-expense-search', 'budget-expense-filter', 'budget-expenses-body',
    'budget-history-pager', 'budget-item-dialog', 'budget-item-form', 'budget-item-id',
    'budget-item-category', 'budget-item-name', 'budget-item-amount', 'budget-item-suggestions',
    'budget-item-headroom-help', 'budget-item-submit', 'budget-expense-dialog', 'budget-expense-form',
    'budget-expense-id', 'budget-expense-item', 'budget-expense-amount', 'budget-expense-date',
    'budget-expense-note', 'budget-expense-submit', 'budget-split-dialog', 'budget-split-form',
    'split-needs', 'split-wants', 'split-savings', 'split-needs-preview', 'split-wants-preview',
    'split-savings-preview', 'budget-split-total-bar', 'budget-split-sum', 'budget-split-error',
    'budget-split-submit', 'budget-item-dialog-title', 'budget-item-dialog-copy', 'budget-expense-dialog-title',
    'budget-expense-dialog-copy', 'budget-hero-tag', 'budget-mode-title', 'budget-mode-copy',
    'budget-expense-new-item-fields', 'budget-expense-new-category', 'budget-expense-new-name',
    'budget-expense-suggestions', 'budget-expense-headroom-help', 'budget-expense-deduct-wrap',
    'budget-expense-deduct', 'budget-expense-deduct-help', 'budget-expense-method-wrap', 'budget-expense-method',
    'budget-item-eyebrow', 'budget-item-bucket-label', 'budget-item-bucket-total', 'budget-item-unallocated',
    'budget-expense-eyebrow', 'split-live-needs', 'split-live-wants', 'split-live-savings',
    'budget-split-state-label', 'budget-split-status-icon'
  ].forEach(makeEl);

  const mig096 = read('database/migrations/20261116_096_budget_savings_deduction_sync.sql');
  for (const sql of [mig096, schema]) {
    assert.match(sql, /'20261116_096'/);
    assert.match(sql, /linked_expense_id uuid references public\.expenses\(id\)/i);
    assert.match(sql, /drop function if exists public\.save_budget_expense\(uuid, uuid, numeric, date, text\);/i);
    assert.match(sql, /v_ref_balance := greatest\(0\.00, v_raw_balance \+ v_deducted_confirmed\);/i);
    assert.match(sql, /insert into public\.expenses \(/i);
  }
  assert.match(budgetHtml, /id="budget-expense-deduct"/);
  assert.match(budgetHtml, /id="budget-expense-method"/);
  assert.match(budgetHtml, /id="budget-expense-new-item-fields"/);
  assert.match(budgetHtml, /class="budget-item-summary-card"/);
  assert.match(budgetHtml, /id="budget-item-unallocated"/);
  assert.match(budgetHtml, /class="budget-split-cards"/);
  assert.match(budgetHtml, /id="split-live-needs"/);
  assert.match(budgetHtml, /id="budget-split-state-label"/);
  assert.match(budgetJs, /budget-empty-history-inner/);
  assert.match(appCss, /\.budget-sync-pill\.is-deducted/);
  assert.match(appCss, /\.budget-modal-dialog[\s\S]*#faf5ec/i);
  assert.match(appCss, /\.budget-split-live-seg/);
  assert.match(appCss, /\.budget-empty-history-inner/);
  assert.match(appCss, /\.budget-categories-grid > \.panel \+ \.panel\s*\{\s*margin-top:\s*0;/);
  assert.match(appCss, /\.budget-empty-items::before\s*\{\s*display:\s*none\s*!important;/);
  assert.match(appCss, /\.budget-category-card[\s\S]*flex-direction:\s*column/);
  assert.match(appCss, /\.budget-empty-items[\s\S]*flex:\s*1 1 auto/);

  let refSavings = 10000;
  let dbExpenses = [
    { id: 'exp-1', item_id: 'item-1', item_name: 'Groceries', category: 'NEEDS', amount: 2000, expense_date: '2026-11-16', note: 'Weekly run', payment_method: 'CASH', deduct_from_savings: true, savings_sync_status: 'CONFIRMED' }
  ];
  let realtimeReload = null;
  const rpcCalls = [];
  const ctx = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Promise,
    Date,
    document: {
      getElementById: (id) => els.get(id) || makeEl(id)
    },
    Ipon: {
      init: async () => ({ failed: false, redirecting: false, configured: true, profile: { id: 'u1', group_id: 'g1', role: 'ADMIN' } }),
      money: (v) => `₱${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      dateLabel: (d) => String(d || ''),
      isoDate: () => '2026-11-16',
      escapeHtml: (s) => String(s || ''),
      setLoading() { },
      setBusy() { },
      setFieldError() { },
      toast() { },
      showInlineError() { },
      renderGroupRequiredCard() { },
      syncWorkspaceMode() { },
      populateGroupSelect() { },
      guardMoneyInput() { },
      paymentMethodOptionsHtml: () => '<option value="CASH">Cash</option><option value="GCASH">GCash</option>',
      paymentMethodMeta: (m) => ({ label: m === 'GCASH' ? 'GCash' : 'Cash' }),
      parseMoneyAmount: (raw) => ({ valid: Number.isFinite(Number(raw)), value: Number(raw || 0), error: '' }),
      subscribeToChanges: (_name, _tables, fn) => { realtimeReload = fn; },
      rpc: async (name, params) => {
        rpcCalls.push([name, params]);
        if (name === 'get_my_groups') return [{ group_id: 'g1', name: 'Test Savings', is_current: true, workspace_mode: 'GROUP' }];
        if (name === 'save_budget_expense') {
          dbExpenses.unshift({
            id: `exp-${dbExpenses.length + 1}`,
            item_id: params.p_item_id || 'item-1',
            item_name: params.p_item_name || 'Groceries',
            category: params.p_category || 'NEEDS',
            amount: Number(params.p_amount || 0),
            expense_date: params.p_expense_date || '2026-11-16',
            note: params.p_note || '',
            payment_method: params.p_payment_method || 'CASH',
            deduct_from_savings: Boolean(params.p_deduct_from_savings),
            savings_sync_status: params.p_deduct_from_savings ? 'CONFIRMED' : 'MONITORING'
          });
          return dbExpenses[0];
        }
        if (name === 'get_budget_overview') {
          const spent = dbExpenses.reduce((acc, row) => acc + row.amount, 0);
          const deductedConfirmed = dbExpenses.filter((r) => r.savings_sync_status === 'CONFIRMED').reduce((acc, row) => acc + row.amount, 0);
          const remainingSavings = refSavings - (spent - 2000);
          const grossPool = remainingSavings + deductedConfirmed;
          return {
            has_workspace: true,
            group_id: 'g1',
            group_name: 'Test Savings',
            role: 'ADMIN',
            can_deduct_savings: true,
            current_savings: remainingSavings,
            deducted_confirmed: deductedConfirmed,
            deducted_pending: 0,
            reference_balance: grossPool,
            raw_savings_balance: remainingSavings,
            config: { needs_pct: 50, wants_pct: 30, savings_pct: 20 },
            totals: { allocated: grossPool, itemized: 2500, spent, remaining: grossPool - spent },
            categories: {
              NEEDS: { pct: 50, allocated: grossPool * 0.5, itemized: 2500, spent, remaining: (grossPool * 0.5) - spent },
              WANTS: { pct: 30, allocated: grossPool * 0.3, itemized: 0, spent: 0, remaining: grossPool * 0.3 },
              SAVINGS: { pct: 20, allocated: grossPool * 0.2, itemized: 0, spent: 0, remaining: grossPool * 0.2 }
            },
            items: [{ id: 'item-1', category: 'NEEDS', name: 'Groceries', allocated_amount: 2500, spent_amount: spent, expense_count: dbExpenses.length }],
            expenses: dbExpenses
          };
        }
        return null;
      }
    }
  };
  await vm.runInNewContext(budgetJs, ctx, { filename: 'js/budget.js' });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(els.get('budget-ref-balance').textContent, '₱10,000.00');
  assert.equal(els.get('budget-legend-needs-amt').textContent, '₱6,000.00');
  assert.equal(els.get('budget-total-spent').textContent, '₱2,000.00');
  assert.equal(els.get('budget-total-remaining').textContent, '₱10,000.00');

  els.get('budget-expense-item').value = '__NEW__';
  els.get('budget-expense-new-category').value = 'NEEDS';
  els.get('budget-expense-new-name').value = 'Water bill';
  els.get('budget-expense-amount').value = '1500';
  els.get('budget-expense-deduct').checked = true;
  els.get('budget-expense-method').value = 'GCASH';
  await els.get('budget-expense-form')._emit('submit');
  assert.equal(els.get('budget-ref-balance').textContent, '₱8,500.00');
  assert.equal(els.get('budget-total-spent').textContent, '₱3,500.00');
  assert.equal(els.get('budget-total-remaining').textContent, '₱8,500.00');
  assert.equal(rpcCalls.some(([name, p]) => name === 'save_budget_expense' && p?.p_deduct_from_savings === true && p?.p_payment_method === 'GCASH'), true);

  refSavings = 15000;
  await realtimeReload();
  assert.equal(els.get('budget-ref-balance').textContent, '₱13,500.00');
  assert.equal(els.get('budget-total-spent').textContent, '₱3,500.00');
  assert.equal(els.get('budget-total-remaining').textContent, '₱13,500.00');
  assert.equal(dbExpenses.length, 2);

  els.get('budget-item-category').value = 'WANTS';
  els.get('budget-item-amount').value = '500';
  await els.get('budget-item-amount')._emit('input');
  assert.equal(els.get('budget-item-bucket-label').textContent, 'WANTS BUDGET');
  assert.equal(els.get('budget-item-bucket-total').textContent, els.get('budget-legend-wants-amt').textContent);
  assert.match(els.get('budget-item-unallocated').textContent, /^₱[1-9]/);

  els.get('split-needs').value = '50';
  els.get('split-wants').value = '30';
  els.get('split-savings').value = '20';
  await els.get('split-needs')._emit('input');
  assert.equal(els.get('budget-split-state-label').textContent, 'Ready to save');

  els.get('split-savings').value = '10';
  await els.get('split-savings')._emit('input');
  assert.equal(els.get('budget-split-state-label').textContent, '10% remaining');
});

test('Migration 095 restores reverted RPCs/policies, drops legacy overloads, and cleans unlinked groups', () => {
  const mig095 = read('database/migrations/20261116_095_restore_reverted_ddl_and_clean_unlinked_groups.sql');
  const schema = read('database/schema.sql');

  const expectedDrops = [
    /drop function if exists public\.create_member\(text, text, text, text, date, numeric, text\)/,
    /drop function if exists public\.update_member\(uuid, text, text, text, text, numeric, text\)/,
    /drop function if exists public\.update_own_profile\(text, text, text, text\)/,
    /drop function if exists public\.update_contribution\(uuid, numeric, date, text, text\)/,
    /drop function if exists public\.update_withdrawal\(uuid, date, numeric, text, text, text, text, text\)/,
    /drop function if exists public\.update_expense\(uuid, date, numeric, text, text, text, text, text\)/,
    /drop function if exists public\.set_contribution_setting\(date, numeric\)/,
    /drop function if exists public\.super_admin_reject_request\(uuid\)/
  ];
  for (const re of expectedDrops) {
    assert.match(mig095, re, `Migration 095 must match ${re}`);
  }

  for (const sql of [mig095, schema]) {
    assert.match(sql, /'20261116_095'/);
    assert.match(sql, /insert into public\.contribution_periods \(member_id, period_month, required_amount, due_date\)/);
    assert.match(sql, /when ctx\.role_name not in \('ADMIN', 'TREASURER', 'MEMBER'\) or ctx\.group_id is null then null/);
    assert.match(sql, /create policy profiles_select on public\.profiles[\s\S]*?or public\.is_super_admin\(\)/);
    assert.match(sql, /'68853776-6a1b-4170-afb8-5dd93c3de90c'::uuid/);
    assert.match(sql, /'e9181a7f-7211-47ce-b4ee-bf95e99f78d4'::uuid/);
  }
});

test('supabase-migrate.mjs refuses legacy replay or ledger fallback to an empty Set', () => {
  const migrateScript = read('scripts/supabase-migrate.mjs');
  assert.doesNotMatch(migrateScript, /fetchAppliedVersions\(\)\s*\|\|\s*new Set\(\)/);
  assert.doesNotMatch(migrateScript, /catch\s*\([^)]*\)\s*\{\s*if\s*\(!applyMode\)\s*throw[^}]*return null;/);
  assert.match(migrateScript, /function parseQueryRows\(raw\)/);
  assert.match(migrateScript, /function fetchSchemaState\(\)/);
  assert.match(migrateScript, /Refusing to run migrations: public\.profiles exists but public\.schema_migrations is empty/);
  assert.match(migrateScript, /Refusing to replay historical migration\(s\)/);
});

test('Dashboard header renders before summary failure, Solo quick-record falls back, live sync covers RPCs/local dev SW cleanup, and bug-reports columns avoid mid-word wraps', () => {
  const dashboardJs = read('js/dashboard.js');
  const coreJs = read('js/core.js');
  const swJs = read('sw.js');
  const appCss = read('css/app.css');

  const renderIdx = dashboardJs.indexOf('renderGroupHeader(normalizedGroups);');
  const unavailIdx = dashboardJs.indexOf("throw new Error('Group savings summary is currently unavailable.');");
  assert.ok(renderIdx > -1 && unavailIdx > -1 && renderIdx < unavailIdx, 'renderGroupHeader must run before summary availability check');
  assert.match(dashboardJs, /Number\.isFinite\(Number\(trackedSavings\)\)/);
  assert.match(dashboardJs, /const isSoloMode = currentGroup\?\.workspace_mode === 'SOLO';\s*const fallbackMemberId/);

  assert.match(coreJs, /liveSyncBc\.onmessage = \(\) => \{\s*dirty = true;\s*resume\(\);/);
  assert.match(coreJs, /async function rpc\(name, params\)[\s\S]*?notifyLiveSync\('data'\);/);
  assert.match(coreJs, /const isLocalDevHost = window\.location\.protocol !== 'https:'/);
  assert.match(coreJs, /fetch\(window\.location\.href,\s*\{\s*cache:\s*'reload'\s*\}\)/);
  assert.match(coreJs, /if \(!event\.persisted\) return;\s*if \(isLocalDevHost\)/);
  assert.match(read('js/config.js'), /ipon_sw_local_cleaned_v19/);
  assert.match(swJs, /const IS_LOCAL_DEV =/);
  assert.match(swJs, /if \(IS_LOCAL_DEV\) return;/);

  const htmlFiles = readdirSync(root).filter((name) => name.endsWith('.html'));
  const sharedCss = new Set();
  const sharedConfig = new Set();
  const sharedCore = new Set();
  for (const file of htmlFiles) {
    const html = read(file);
    const appCssRef = html.match(/href="(css\/app\.css\?v=[^"]+)"/)?.[1];
    const configRef = html.match(/src="(js\/config\.js\?v=[^"]+)"/)?.[1];
    const coreRef = html.match(/src="(js\/core\.js\?v=[^"]+)"/)?.[1];
    if (appCssRef) sharedCss.add(appCssRef);
    if (configRef) sharedConfig.add(configRef);
    if (coreRef) sharedCore.add(coreRef);
  }
  assert.equal(sharedCss.size, 1, `css/app.css version mismatch across HTML pages: ${[...sharedCss].join(', ')}`);
  assert.equal(sharedConfig.size, 1, `js/config.js version mismatch across HTML pages: ${[...sharedConfig].join(', ')}`);
  assert.equal(sharedCore.size, 1, `js/core.js version mismatch across HTML pages: ${[...sharedCore].join(', ')}`);

  assert.match(appCss, /#bug-reports \.data-table td:nth-child\(2\)[\s\S]*?white-space:\s*nowrap/);
  assert.match(appCss, /\.users-filters #users-search[\s\S]*?min-width:\s*256px/);
});

test('createRealtimeChannel and Realtime callers avoid adding postgres_changes or presence callbacks onto subscribed channels', () => {
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');
  assert.match(coreJs, /function createRealtimeChannel\(baseTopic, options = undefined, clientArg = null\)/);
  assert.match(coreJs, /createRealtimeChannel\(`live:\$\{name\}:/);
  assert.match(coreJs, /createRealtimeChannel\(`notifications:\$\{profile\.id\}`/);
  assert.match(coreJs, /createRealtimeChannel\(`record-thread-\$\{recordType\}-\$\{recordId\}`/);
  assert.match(coreJs, /existingPresence[\s\S]*realtime:ipon-active-presence/);
  assert.match(messagesJs, /ipon\(\)\.createRealtimeChannel/);

  const helperSrc = coreJs.match(/let rtChannelNonce = 0;[\s\S]*?return options === undefined \? client\.channel\(baseTopic\) : client\.channel\(baseTopic, options\);\s*\}/)?.[0];
  assert.ok(helperSrc, 'createRealtimeChannel helper should exist');
  const activeChannels = [];
  const removed = [];
  const fakeClient = {
    getChannels: () => activeChannels,
    removeChannel: (ch) => {
      removed.push(ch.topic);
      return Promise.resolve('ok');
    },
    channel(topic) {
      const fullTopic = `realtime:${topic}`;
      const existing = activeChannels.find((c) => c.topic === fullTopic);
      if (existing) return existing;
      const ch = {
        topic: fullTopic,
        subscribed: false,
        on(type) {
          if (ch.subscribed && type === 'postgres_changes') {
            throw new Error(`cannot add \`postgres_changes\` callbacks for ${ch.topic} after \`subscribe()\`.`);
          }
          return ch;
        },
        subscribe() {
          ch.subscribed = true;
          return ch;
        }
      };
      activeChannels.push(ch);
      return ch;
    }
  };
  const fn = new Function('getClient', `${helperSrc}; return createRealtimeChannel;`)(() => fakeClient);
  const ch1 = fn('live:budget:user-1');
  ch1.on('postgres_changes', {}).subscribe();
  const ch2 = fn('live:budget:user-1');
  assert.notEqual(ch2, ch1);
  assert.doesNotThrow(() => ch2.on('postgres_changes', {}).subscribe());
  assert.deepEqual(removed, ['realtime:live:budget:user-1']);
});

test('generateWithGemini tries all AI Studio models before Vertex and preserves free-tier diagnostics', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const edgeTs = read('supabase/functions/manage-account/index.ts');
  const coreJs = read('js/core.js');

  assert.match(edgeTs, /resolveServerGeminiKeys/);
  const blockMatch = edgeTs.match(/const GEMINI_RELEASE_MODELS = \[[\s\S]*?\nasync function generateWithGemini\([\s\S]*?\n\}(?=\r?\n\r?\nconst TECH_COMMIT_RE)/);
  assert.ok(blockMatch, 'Gemini helper block should exist in manage-account/index.ts');

  const jsCode = stripTypeScriptTypes(blockMatch[0], { mode: 'transform' });
  const buildRunner = (fakeFetch) => new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout', `
    ${jsCode}
    return { GEMINI_RELEASE_MODELS, generateWithGemini, formatGeminiApiError };
  `)(fakeFetch, AbortController, setTimeout, clearTimeout);

  // 1. Continues across AI Studio models if first model fails with 403/BILLING_DISABLED, succeeding on 2.0-flash without hitting Vertex
  const calls1 = [];
  const { generateWithGemini: gen1 } = buildRunner(async (url) => {
    calls1.push(url);
    if (url.includes('gemini-2.5-flash-lite')) {
      return new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'Quota check failed', details: [{ reason: 'BILLING_DISABLED' }] } }), { status: 403 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Update 1.1: Smoother savings"}' }] } }] }), { status: 200 });
  });
  const okRes = await gen1({ apiKey: 'AQ.fake-key', prompt: 'Draft notes' });
  assert.equal(okRes.model, 'gemini-2.0-flash');
  assert.ok(calls1.every((u) => u.includes('generativelanguage.googleapis.com')));

  // 2. Preserves SERVICE_DISABLED hint on generativelanguage.googleapis.com instead of masking behind Vertex BILLING_DISABLED
  const { generateWithGemini: gen2 } = buildRunner(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({
        error: {
          status: 'PERMISSION_DENIED',
          message: 'Generative Language API has not been used in project 123 before or it is disabled.',
          details: [{ reason: 'SERVICE_DISABLED' }]
        }
      }), { status: 403 });
    }
    return new Response(JSON.stringify({
      error: {
        status: 'PERMISSION_DENIED',
        message: 'This API method requires billing to be enabled.',
        details: [{ reason: 'BILLING_DISABLED' }]
      }
    }), { status: 403 });
  });
  await assert.rejects(
    () => gen2({ apiKey: 'AQ.fake-key', prompt: 'Draft notes' }),
    /Generative Language API is disabled.*no Cloud billing needed/i
  );

  // 3. Clearly distinguishes Vertex Express AQ. key + disabled billing vs AI Studio free-tier key
  const { generateWithGemini: gen3 } = buildRunner(async (url) => {
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(JSON.stringify({
        error: {
          status: 'UNAUTHENTICATED',
          message: 'Request is missing required authentication credential.',
          details: [{ reason: 'ACCESS_TOKEN_TYPE_UNSUPPORTED' }]
        }
      }), { status: 401 });
    }
    return new Response(JSON.stringify({
      error: {
        status: 'PERMISSION_DENIED',
        message: 'This API method requires billing to be enabled.',
        details: [{ reason: 'BILLING_DISABLED' }]
      }
    }), { status: 403 });
  });
  await assert.rejects(
    () => gen3({ apiKey: 'AQ.vertex-express-key', prompt: 'Draft notes' }),
    /Vertex AI Express key whose Cloud billing is disabled.*aistudio\.google\.com\/app\/apikey/i
  );

  // 4. js/core.js friendlyError preserves structured server diagnostics and still maps raw errors
  assert.match(coreJs, /Gemini AI failed to generate release notes:\|Generative Language API/);
});

test('draftVerifiedReleaseNotesFallback writes plain-English topics and cleanly excludes CSS specs and dev jargon', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const edgeTs = read('supabase/functions/manage-account/index.ts');
  const start = edgeTs.indexOf('const TECH_COMMIT_RE =');
  const end = edgeTs.indexOf('Deno.serve(');
  assert.ok(start !== -1 && end > start, 'Fallback helper blocks must exist in manage-account/index.ts');

  const jsCode = stripTypeScriptTypes(edgeTs.slice(start, end), { mode: 'transform' });
  const { extractCommitUpdates, canonicalizeCommitUpdates, draftVerifiedReleaseNotesFallback } = new Function('Deno', 'crypto', 'process', `
    ${jsCode}
    return { extractCommitUpdates, canonicalizeCommitUpdates, draftVerifiedReleaseNotesFallback };
  `)({ env: { get: () => '' }, serve() {} }, globalThis.crypto, process);

  const rawCommits = [
    [
      'Standardize confirmation dialogs to warm-cream card with top gold accent and equal pill actions',
      '',
      '- Update .confirm-dialog in css/app.css (22px rounded #faf6ee card, 26px #b88c3e top accent rule, bold serif heading, equal 2-column button bar with #ffffff Cancel and #102420 forest-emerald primary button, plus dark-mode and <=720px responsive tuning)'
    ].join('\n'),
    [
      'fix: strip CSS tokens, hex colors, and code jargon from Write with AI notes',
      '',
      '- Filter CSS class/ID selectors, hex colors, pixel/viewport units, broken fragments, and design-spec jargon across TECH_COMMIT_RE, CODE_TOKEN_RE, and canonicalizeClauseForParsing',
      '- Preserve parenthetical and multi-modal lists cleanly during clause splitting while fixing \'and <verb>\' splitting and stripping conventional \'fix:\' before other verbs',
      '- Improve fallback release-note topic labels and phrasing (Make ... verb rewrites and Improvements categorization)',
      '- Fix migration 084 test declarations and generateWithGemini block extraction in tests/contracts.test.mjs, and add plain-English release-note contract coverage (npm test: 157/157 passing)'
    ].join('\n'),
    [
      'fix: deduplicate prior release announcements and eliminate repetitive endings in Write with AI',
      '',
      '- Fix collectReleaseContext to select description on public.announcements, recovering latestReleaseAt, version incrementing, and prior release text.',
      '- Rewrite draftVerifiedReleaseNotesFallback to conjugate commit clauses cleanly, while updating the Gemini prompt to pass prior bullet topics and disallow repetitive tail phrases.'
    ].join('\n'),
    [
      'not finish',
      '',
      '- Add Budget Allocation & Expenses page (budget.html, js/budget.js, migration 094) with hero allocation card, 3-bucket tracking, and non-destructive history',
      '- Fix dashboard group header/tracked savings sync, Solo quick-record fallback, Super Admin table wrapping, and localhost Service Worker caching (v18 / www sync)'
    ].join('\n'),
    'Elevate floating chat/notif buttons, align Needs, Wants, and Savings category cards, and make tracked budget expenses empty row center across table columns',
    'feat: remove Super Admin user role column, add multi-group overflow & Solo/Group workspaces',
    'fix: expand budget workspace full-width and harden supabase:sync CLI parsing'
  ];

  const updates = canonicalizeCommitUpdates(rawCommits);
  const draft = draftVerifiedReleaseNotesFallback({
    version: '1.5',
    features: [],
    fixedBugs: [],
    systemUpdates: updates,
    variationSeed: 0
  });

  assert.doesNotMatch(draft.details, /\.confirm-dialog|#faf6ee|#b88c3e|#ffffff|#102420|22px|26px|button bar|top accent rule|forest-emerald|supabase:sync|CLI parsing|CSS class|viewport units|clause splitting|contract coverage|npm test|Gemini prompt|tail phrases|version incrementing|Service Worker/i);
  assert.doesNotMatch(draft.details, /Floating Chat And Notification:|• Needs:|Make tracked budget|Access checks apply strictly|While updating|Fallback/i);
  assert.match(draft.details, /New Features[\s\S]*• Budget Allocation & Expenses Page:/);
  assert.match(draft.details, /Improvements[\s\S]*• Floating Chat & Notification Buttons:/);
  assert.match(draft.details, /• Tracked Budget Expenses: Updated tracked budget expenses empty row to center across table columns\./);
  assert.match(draft.details, /Improvements[\s\S]*• Super Admin User Role: Removed Super Admin user role column\./);
  assert.match(draft.details, /Improvements[\s\S]*• Budget Workspace: Expanded budget workspace full-width\./);
  assert.match(draft.details, /New Features[\s\S]*• Multi-Group Overflow & Solo\/Group Workspaces:/);
  assert.match(draft.details, /Fixes[\s\S]*• Solo Quick-Record Saving:/);

  const needsCategoryDraft = draftVerifiedReleaseNotesFallback({
    version: '1.5',
    features: [],
    fixedBugs: [],
    systemUpdates: ['Align Needs, Wants, and Savings category cards'],
    variationSeed: 0
  });
  assert.match(needsCategoryDraft.details, /Improvements[\s\S]*• Needs, Wants, and Savings Category:/);
});

test('budget expense dialog removes single-option create dropdown when empty or typing and migration 097 cleans deleted announcement notifications', () => {
  const budgetHtml = read('budget.html');
  const budgetJs = read('js/budget.js');
  const appCss = read('css/app.css');
  const coreJs = read('js/core.js');
  const schemaSql = read('database/schema.sql');
  const mig097 = read('database/migrations/20261117_097_cleanup_deleted_announcement_notifications.sql');

  // 1. Budget expense item name textbox sits first inside #budget-expense-new-item-fields, with dropdown wrapper hidden in create mode
  assert.match(budgetHtml, /id="budget-expense-item-wrap"/);
  assert.match(budgetHtml, /id="budget-expense-switch-new"/);
  assert.match(budgetHtml, /id="budget-expense-switch-existing"/);
  assert.match(budgetHtml, /id="budget-expense-new-item-fields"[\s\S]*?id="budget-expense-new-name"[\s\S]*?id="budget-expense-new-category"/);
  assert.match(appCss, /\.budget-inline-head\s*\{/);
  assert.match(appCss, /\.budget-mode-link\b/);
  assert.match(budgetJs, /const isNew = expenseItemSelect\?\.value === '__NEW__' \|\| !hasExistingItems;/);
  assert.match(budgetJs, /if \(expenseItemWrap\) expenseItemWrap\.hidden = isNew;/);
  assert.match(budgetJs, /if \(expenseSwitchExistingBtn\) expenseSwitchExistingBtn\.hidden = !isNew \|\| !hasExistingItems;/);

  // 2. Deleted announcement notification auto-cleanup trigger + backfill + client live sync
  assert.match(mig097, /create or replace function public\.cleanup_deleted_announcement_notifications\(\)/i);
  assert.match(mig097, /after update of deleted_at or delete on public\.announcements/i);
  assert.match(mig097, /'20261117_097'/);
  assert.match(schemaSql, /cleanup_deleted_announcement_notifications/);
  assert.match(schemaSql, /'20261117_097'/);
  assert.match(coreJs, /notifyLiveSync\('notifications'\)/);
  assert.match(coreJs, /activeNotificationsReload\?\.\(\)/);
});

test('Super Admin and manage-account select and enforce feature_requests.allow_credit for release credits', () => {
  const saJs = read('js/super-admin.js');
  const edgeTs = read('supabase/functions/manage-account/index.ts');

  assert.match(saJs, /from\('feature_requests'\)\.select\('[^']*allow_credit[^']*'\)/);
  assert.match(edgeTs, /from\('feature_requests'\)[\s\S]*?\.select\('title,details,requester_id,allow_credit'\)/);
  assert.match(edgeTs, /f\.allow_credit !== false && f\.requester_name/);
  assert.match(edgeTs, /from\('profiles'\)[\s\S]*?\.select\('id,full_name'\)/);
});

test('Write with AI keeps release announcements strictly factual without AI embellishment or canned outcome padding', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const edgeTs = read('supabase/functions/manage-account/index.ts');
  const saJs = read('js/super-admin.js');
  const saHtml = read('super-admin.html');

  // 1. Gemini generation config uses low temperature for factual fidelity and prompts forbid embellishment
  assert.match(edgeTs, /temperature:\s*0\.25\b/);
  assert.match(edgeTs, /topP:\s*0\.8\b/);
  assert.match(edgeTs, /NEVER invent, exaggerate, extrapolate, or guess unmentioned mechanisms/);
  assert.doesNotMatch(edgeTs, /function pickUniqueDomainOutcome/);
  assert.match(saJs, /RELEASE_STYLE_ANGLES\s*=\s*\[[\s\S]*Strictly factual/);
  assert.doesNotMatch(saJs, /product story|high-energy|celebrating cleaner workflows/i);
  assert.match(saHtml, /js\/super-admin\.js\?v=20261118-95/);

  // 2. Fallback composer produces crisp factual sentences with zero fabricated outcome padding
  const start = edgeTs.indexOf('const TECH_COMMIT_RE =');
  const end = edgeTs.indexOf('Deno.serve(');
  const jsCode = stripTypeScriptTypes(edgeTs.slice(start, end), { mode: 'transform' });
  const { draftVerifiedReleaseNotesFallback, sanitizeReleaseDetails } = new Function('Deno', 'crypto', 'process', `
    ${jsCode}
    return { draftVerifiedReleaseNotesFallback, sanitizeReleaseDetails };
  `)({ env: { get: () => '' }, serve() {} }, globalThis.crypto, process);

  const shortFallback = draftVerifiedReleaseNotesFallback({
    version: '1.6',
    features: [{ title: 'Dark Mode Switch', description: 'Dark theme option', requester_name: 'Ana' }],
    fixedBugs: [{ title: 'Fix retention bugs', description: '' }],
    systemUpdates: ['Expand budget workspace full-width']
  });

  assert.match(shortFallback.details, /• Dark Mode Switch: Dark theme option\. \(Requested by: Ana\)/);
  assert.match(shortFallback.details, /• Fix retention bugs: Fixed retention bugs\./);
  assert.match(shortFallback.details, /• Budget Workspace: Expanded budget workspace full-width\./);
  assert.doesNotMatch(shortFallback.details, /Related actions now complete|without unexpected resets|without unintended resets|saved preferences|resulting in a more stable and dependable experience|stay protected behind verified permissions/i);

  // 3. sanitizeReleaseDetails strips empty promotional tails while keeping real facts intact
  const dirtyText = [
    'Fixes',
    '• Data Retention: Fixed retention issue. Users can now rely on consistent data storage without unexpected resets, resulting in a more stable and dependable experience.',
    '• Modal Scroll: Fixed dialog scrolling, for a smoother workflow.',
    '• History Audit: Retained 30-day audit history on deleted records.'
  ].join('\n');
  const edgeSanitized = sanitizeReleaseDetails(dirtyText);
  assert.match(edgeSanitized.text, /• Data Retention: Fixed retention issue\./);
  assert.match(edgeSanitized.text, /• Modal Scroll: Fixed dialog scrolling\./);
  assert.match(edgeSanitized.text, /• History Audit: Retained 30-day audit history on deleted records\./);
  assert.doesNotMatch(edgeSanitized.text, /without unexpected resets|more stable and dependable experience|for a smoother workflow/i);
  assert.match(saJs, /function stripReleaseFluffTails\(text\)/);
});

test('Android MainActivity clears consumed notification_link intent extra and asset caches match v22', () => {
  const mainAct = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const swJs = read('sw.js');
  const dashHtml = read('dashboard.html');
  assert.match(mainAct, /setIntent\(intent\);\s*handleNotificationIntent\(intent\);/);
  assert.match(mainAct, /intent\.removeExtra\("notification_link"\);/);
  assert.match(swJs, /ipon-shell-v(?:2[2-9]|[3-9]\d)/);
  assert.match(dashHtml, /js\/core\.js\?v=20261118-135/);
});

test('Migration 099 and Super Admin Users surface each user actual latest specific activity without exposing financial data', () => {
  const mig099 = read('database/migrations/20261117_099_specific_user_last_activity.sql');
  const schema = read('database/schema.sql');
  const saJs = read('js/super-admin.js');
  const saHtml = read('super-admin.html');

  for (const sql of [mig099, schema]) {
    assert.match(sql, /'20261117_099'/);
    assert.match(sql, /create or replace function public\.super_admin_user_last_activities\(\)/i);
    assert.match(sql, /if not public\.is_super_admin\(\) then[\s\S]*?errcode = '42501'/i);
    assert.match(sql, /from public\.audit_logs l[\s\S]*?l\.changed_by is not null/i);
    assert.match(sql, /from public\.budget_configs bc/i);
    assert.match(sql, /from public\.bug_reports br/i);
    assert.match(sql, /from public\.feature_requests fr/i);
    assert.match(sql, /from public\.messages m/i);
    assert.match(sql, /\(e\.priority >= 90\) asc,\s*e\.occurred_at desc,\s*e\.priority asc/i);
    assert.match(sql, /revoke all on function public\.super_admin_user_last_activities\(\) from public, anon;/i);
    assert.match(sql, /grant execute on function public\.super_admin_user_last_activities\(\) to authenticated;/i);
  }

  // Ensures Super Admin client never queries raw financial/message tables directly
  assert.doesNotMatch(saJs, /from\(['"](?:contributions|withdrawals|expenses|members|messages|budget_configs|budget_expenses)['"]\)/);
  assert.match(saJs, /Ipon\.client\.rpc\('super_admin_user_last_activities'\)/);
  assert.match(saJs, /function formatUserActivityLabel\(activity\)/);
  assert.match(saHtml, /js\/super-admin\.js\?v=20261118-95/);

  // Verify formatUserActivityLabel handles both new specific RPC rows and legacy fallback events
  const fnMatch = saJs.match(/function formatUserActivityLabel\(activity\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'formatUserActivityLabel helper must exist in js/super-admin.js');
  const formatUserActivityLabel = new Function(`${fnMatch[0]}; return formatUserActivityLabel;`)();
  assert.equal(formatUserActivityLabel({ activity_label: 'Recorded contribution', activity_event: 'CONTRIBUTION_ADD' }), 'Recorded contribution');
  assert.equal(formatUserActivityLabel({ activity_label: 'Submitted bug report', activity_event: 'BUG_REPORT' }), 'Submitted bug report');
  assert.equal(formatUserActivityLabel({ event: 'LOGIN' }), 'Signed in');
  assert.equal(formatUserActivityLabel({ event: 'PASSWORD_CHANGE' }), 'Changed password');
  assert.equal(formatUserActivityLabel({ event: 'PROFILE_UPDATE' }), 'Updated profile');
});

test('Super Admin Platform overview counts all registered non-super-admin users and wires functional attention & workspace badges', () => {
  const saHtml = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const css = read('css/app.css');

  // Overview uses Registered users rather than Administrators
  assert.match(saHtml, /<dt>Registered users<\/dt>[\s\S]*?id="metric-total-users"/);
  assert.match(saHtml, /<dt>Active users<\/dt>[\s\S]*?id="metric-active-users"/);
  assert.match(saHtml, /<dt>Suspended<\/dt>[\s\S]*?id="metric-suspended-users"/);
  assert.match(saHtml, /<dt>Savings groups<\/dt>[\s\S]*?id="metric-groups"/);
  assert.doesNotMatch(saHtml, /id="metric-total-admins"|Monitor administrator accounts/);
  assert.doesNotMatch(saJs, /Monitor administrator accounts/);

  // Functional shortcut badges and actionable attention items
  for (const id of ['shortcut-count-features', 'shortcut-count-bugs', 'shortcut-count-users', 'shortcut-count-activity']) {
    assert.match(saHtml, new RegExp(`id="${id}"`));
  }
  assert.match(saJs, /const registeredUsers = profiles\.filter\(\(profile\) => profile && profile\.role !== 'SUPER_ADMIN'\)/);
  assert.match(saJs, /data-overview-bug-status="OPEN"/);
  assert.match(saJs, /data-overview-feature-status="PENDING"/);
  assert.match(saJs, /data-overview-user-status="DISABLED"/);
  assert.match(saJs, /data-overview-focus-storage="1"/);

  // Runtime check of renderOverview + setShortcutBadge against mixed roles/statuses
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const cls = new Set();
      els.set(id, {
        id,
        textContent: '',
        innerHTML: '',
        classList: {
          toggle: (name, force) => (force ? cls.add(name) : cls.delete(name)),
          contains: (name) => cls.has(name)
        }
      });
    }
    return els.get(id);
  };
  const badgeBlock = saJs.match(/function setShortcutBadge\([\s\S]*?\n  \}\r?\n\r?\n  function renderOverview\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(badgeBlock, 'setShortcutBadge and renderOverview must exist in js/super-admin.js');
  const nowIso = new Date().toISOString();
  const runner = new Function(
    'document', 'Ipon', 'profiles', 'groups', 'bugReports', 'featureRequests', 'accountActivities', 'activityLogs', 'storageOverview', 'formatBytes',
    `${badgeBlock}; return renderOverview;`
  )(
    { getElementById: getEl },
    { escapeHtml: (s) => String(s || '') },
    [
      { id: 'sa', role: 'SUPER_ADMIN', status: 'ACTIVE' },
      { id: 'u1', role: 'ADMIN', status: 'ACTIVE' },
      { id: 'u2', role: 'MEMBER', status: 'ACTIVE' },
      { id: 'u3', role: 'TREASURER', status: 'DISABLED' },
      { id: 'u4', role: 'MEMBER', status: 'PENDING' }
    ],
    [
      { id: 'g1', status: 'ACTIVE', workspace_mode: 'GROUP' },
      { id: 'g2', status: 'ACTIVE', workspace_mode: 'SOLO' }
    ],
    [{ id: 'b1', status: 'OPEN' }],
    [{ id: 'f1', status: 'PENDING' }, { id: 'f2', status: 'IMPLEMENTED' }],
    [{ user_id: 'u1', occurred_at: nowIso }],
    [{ id: 'a1' }, { id: 'a2' }],
    { reclaimable_rejected_count: 2, reclaimable_rejected_bytes: 4096 },
    (n) => `${n} B`
  );
  runner();
  assert.equal(getEl('metric-total-users').textContent, 4);
  assert.equal(getEl('metric-active-users').textContent, 2);
  assert.equal(getEl('metric-suspended-users').textContent, 1);
  assert.equal(getEl('metric-suspended-card').classList.contains('has-alert'), true);
  assert.equal(getEl('metric-groups').textContent, 2);
  assert.equal(getEl('metric-groups-meta').textContent, '1 group · 1 solo');
  assert.equal(getEl('shortcut-count-users').textContent, '4 registered');
  assert.equal(getEl('shortcut-count-bugs').textContent, '1 open');
  assert.equal(getEl('shortcut-count-bugs').classList.contains('has-pending'), true);
  assert.equal(getEl('shortcut-count-features').textContent, '1 pending');
  assert.match(getEl('platform-attention').innerHTML, /1 open bug report/);
  assert.match(getEl('platform-attention').innerHTML, /1 pending feature request/);
  assert.match(getEl('platform-attention').innerHTML, /1 suspended user account/);
  assert.match(getEl('platform-attention').innerHTML, /1 pending user account/);
  assert.match(getEl('platform-attention').innerHTML, /2 old rejected receipts to purge/);

  // Premium card styling + dark mode + mobile responsiveness
  assert.match(css, /\.platform-metric-card\s*\{/);
  assert.match(css, /\.platform-shortcut-badge\.has-pending\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.platform-metric-card\s*\{/);
  assert.match(css, /@media \(max-width:720px\)[\s\S]*?\.platform-metric-card\s*\{/);
});

test('Migration 100, Invite Links / 6-Char Group Codes, Approval Queue, and QR ISO-18004 Engine work end-to-end', async () => {
  const mig100 = read('database/migrations/20261117_100_group_invite_links_and_codes.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const authJs = read('js/auth.js');
  const loginHtml = read('login.html');
  const dashHtml = read('dashboard.html');
  const dashJs = read('js/dashboard.js');
  const settingsHtml = read('settings.html');
  const settingsJs = read('js/settings.js');
  const userHtml = read('user.html');
  const userJs = read('js/user.js');
  const css = read('css/app.css');

  // 1. Database migration & schema ledger parity + strict ACL checks
  for (const sql of [mig100, schema]) {
    assert.match(sql, /'20261117_100'/);
    assert.match(sql, /create table if not exists public\.group_invite_codes/i);
    assert.match(sql, /create table if not exists public\.group_join_requests/i);
    assert.match(sql, /group_invite_codes_one_active_per_group_uidx/i);
    assert.match(sql, /group_join_requests_one_pending_uidx/i);
    assert.match(sql, /current_setting\('ipon\.joining_group_id',\s*true\)/i);
    assert.match(sql, /create or replace function public\.create_group_invite_code\(/i);
    assert.match(sql, /create or replace function public\.update_group_invite_code\(/i);
    assert.match(sql, /create or replace function public\.get_group_invite_overview\(/i);
    assert.match(sql, /create or replace function public\.preview_group_invite_code\(/i);
    assert.match(sql, /create or replace function public\.join_group_by_code\(/i);
    assert.match(sql, /create or replace function public\.review_group_join_request\(/i);
    assert.match(sql, /create or replace function public\.cancel_own_join_request\(/i);
    assert.match(sql, /grant execute on function public\.preview_group_invite_code\(text\) to anon, authenticated;/i);
    assert.match(sql, /revoke all on function public\.join_group_by_code\(text\) from public, anon;/i);
    assert.match(sql, /revoke all on function public\.create_group_invite_code\(integer, boolean, integer\) from public, anon;/i);
    assert.match(sql, /revoke all on function public\.review_group_join_request\(uuid, text, text\) from public, anon;/i);
    assert.match(sql, /revoke all on function public\._grant_group_member_via_invite\(uuid, uuid, uuid\) from public, anon, authenticated;/i);
  }

  // 2. HTML & JS wiring across Login, Dashboard, Settings, Member Portal
  assert.match(loginHtml, /id="auth-join-banner"/);
  assert.match(loginHtml, /id="auth-have-code-open"/);
  assert.match(loginHtml, /id="auth-join-code-input"/);
  assert.match(authJs, /preview_group_invite_code/);
  assert.match(authJs, /function renderAuthJoinBanner/);

  assert.match(dashHtml, /id="no-group-join-btn"/);
  assert.match(dashHtml, /id="group-mode-join-tab"/);
  assert.match(dashHtml, /id="group-create-join-mount"/);
  assert.doesNotMatch(dashHtml, /id="group-hub-join-another"/);
  assert.match(dashHtml, /id="invite-tab-link"/);
  assert.match(dashHtml, /id="invite-tab-email"/);
  assert.match(dashHtml, /id="invite-link-code-mount"/);
  assert.match(dashJs, /no-group-join-btn/);
  assert.match(dashJs, /mountJoinGroupPanel/);
  assert.match(dashJs, /mountInviteCodePanel/);
  assert.match(dashJs, /group_join_requests/);
  assert.match(css, /\.join-group-dialog(?:,\s*\.join-blocked-dialog)?\s*\{[^}]*width:\s*min\(440px/);

  assert.match(settingsHtml, /id="settings-invite-code-mount"/);
  assert.match(settingsHtml, /id="settings-join-requests-panel"/);
  assert.match(settingsHtml, /id="settings-join-group-btn"/);
  assert.match(settingsJs, /settings-invite-code-mount/);
  assert.match(settingsJs, /renderJoinRequestsQueue/);
  assert.match(settingsJs, /join_requests/);

  assert.match(userHtml, /id="user-join-group"/);
  assert.match(userJs, /user-join-group/);
  assert.match(css, /\.invite-code-active-card\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.invite-qr-card/);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*?\.invite-code-active-card/);

  // 3. Real VM execution of Core Invite Helpers & ISO-18004 QR Encoder
  const store = new Map();
  const noop = () => {};
  const dummyEl = () => ({
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    setAttribute: noop,
    removeAttribute: noop,
    addEventListener: noop,
    querySelector: () => dummyEl(),
    querySelectorAll: () => [],
    insertAdjacentHTML: noop
  });
  const ctx = {
    console, TextEncoder, URL, URLSearchParams, Intl, Math, Date, Number, String, JSON,
    Uint8Array, Array, Set, Map,
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', origin: 'https://my-ipon.vercel.app', search: '', href: 'https://my-ipon.vercel.app/dashboard.html', replace: noop, assign: noop },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { replaceState: noop },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    document: {
      documentElement: { setAttribute: noop, dataset: {}, style: { setProperty: noop, removeProperty: noop } },
      head: { insertAdjacentHTML: noop },
      body: { dataset: {}, classList: { contains: () => false, add: noop, remove: noop, toggle: noop }, insertAdjacentHTML: noop, appendChild: noop, prepend: noop, append: noop },
      createElement: () => dummyEl(),
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null
    }
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const ipon = ctx.window.Ipon;
  assert.equal(ipon.normalizeInviteCode(' k9m-4pq '), 'K9M4PQ');
  assert.equal(ipon.formatInviteCode('k9m4pq'), 'K9M-4PQ');
  assert.equal(ipon.extractInviteCode('https://my-ipon.vercel.app/login.html?join=ab2-3cd'), 'AB23CD');
  assert.equal(ipon.inviteShareUrl('k9m4pq'), 'https://my-ipon.vercel.app/login.html?join=K9M4PQ');

  ipon.setPendingJoinCode('K9M-4PQ');
  assert.equal(ipon.getPendingJoinCode(), 'K9M4PQ');
  ipon.clearPendingJoinCode();
  assert.equal(ipon.getPendingJoinCode(), '');

  assert.equal(ipon.resolveNotificationTarget({ type: 'GROUP_JOIN_REQUEST' }, 'ADMIN'), 'settings.html?join_requests=1#access');
  assert.equal(ipon.resolveNotificationTarget({ type: 'GROUP_JOIN_APPROVED', id: '42' }, 'MEMBER'), 'user.html?notice=42');

  // Verify ISO-18004 Version 4 QR matrix + finder patterns + timing strips + alignment + BCH format match
  const qrUrl = ipon.inviteShareUrl('K9M4PQ');
  const qr = ipon.generateQrMatrix(qrUrl);
  assert.equal(qr.version, 4);
  assert.equal(qr.size, 33);
  // Finder outer rings at (0,0), (0,26), (26,0)
  for (const [top, left] of [[0, 0], [0, qr.size - 7], [qr.size - 7, 0]]) {
    assert.equal(qr.modules[top][left], 1);
    assert.equal(qr.modules[top + 3][left + 3], 1);
    assert.equal(qr.modules[top + 1][left + 1], 0);
  }
  // Dark module at (size - 8, 8)
  assert.equal(qr.modules[qr.size - 8][8], 1);
  // Timing patterns alternating
  for (let i = 8; i < qr.size - 8; i += 1) {
    assert.equal(qr.modules[6][i], i % 2 === 0 ? 1 : 0);
    assert.equal(qr.modules[i][6], i % 2 === 0 ? 1 : 0);
  }
  // Primary and secondary 15-bit format strips match bit-for-bit
  const copy1 = [
    qr.modules[8][0], qr.modules[8][1], qr.modules[8][2], qr.modules[8][3], qr.modules[8][4], qr.modules[8][5],
    qr.modules[8][7], qr.modules[8][8], qr.modules[7][8],
    qr.modules[5][8], qr.modules[4][8], qr.modules[3][8], qr.modules[2][8], qr.modules[1][8], qr.modules[0][8]
  ];
  const copy2 = [
    qr.modules[qr.size - 1][8], qr.modules[qr.size - 2][8], qr.modules[qr.size - 3][8], qr.modules[qr.size - 4][8],
    qr.modules[qr.size - 5][8], qr.modules[qr.size - 6][8], qr.modules[qr.size - 7][8],
    qr.modules[8][qr.size - 8], qr.modules[8][qr.size - 7], qr.modules[8][qr.size - 6], qr.modules[8][qr.size - 5],
    qr.modules[8][qr.size - 4], qr.modules[8][qr.size - 3], qr.modules[8][qr.size - 2], qr.modules[8][qr.size - 1]
  ];
  assert.deepEqual(copy1, copy2);

  // Verify SVG output structure
  const svg = ipon.qrSvgMarkup(qrUrl);
  assert.match(svg, /^<svg class="invite-qr-svg" viewBox="0 0 41 41"/);
  assert.match(svg, /<rect width="41" height="41" fill="#ffffff"\/><path d="M/);

  // Capacitor localhost origin maps to canonical public share domain
  ctx.location.origin = 'http://localhost';
  ctx.Capacitor = {};
  assert.equal(ipon.canonicalAppOrigin(), 'https://my-ipon.vercel.app');

  // Verify mountInviteCodePanel renders initial cached overview cleanly without loading-spinner flash on refresh
  assert.match(coreJs, /inviteOverviewSignature\(stateOverview\)/);
  assert.match(coreJs, /if \(nextSig === lastRenderedSig\)|nextSig !== lastRenderedSig/);
  assert.match(coreJs, /class="status \$\{active\.require_approval \? 'status-pending' : 'status-confirmed'\}"/);
  const mountWrites = [];
  const mountBox = {
    children: [],
    get innerHTML() { return mountWrites[mountWrites.length - 1] || ''; },
    set innerHTML(v) {
      mountWrites.push(String(v));
      mountBox.children = v ? [{}] : [];
    },
    querySelector: () => dummyEl(),
    querySelectorAll: () => []
  };
  let rpcCount = 0;
  const cachedSample = {
    workspace_mode: 'GROUP',
    active_code: { id: 'c1', code: 'RLZBX3', require_approval: true, expires_at: new Date(Date.now() + 86400000).toISOString(), use_count: 0, max_uses: null },
    pending_requests: []
  };
  ctx.supabase = {
    createClient: () => ({
      rpc: async () => { rpcCount += 1; return { data: cachedSample, error: null }; },
      channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
      getChannels: () => []
    })
  };
  const ctx2 = {
    ...ctx,
    window: null
  };
  ctx2.window = ctx2;
  ctx2.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx2, { filename: 'js/core.js' });
  const ctrl = ctx2.window.Ipon.mountInviteCodePanel(mountBox, { groupName: 'Sample', initialOverview: cachedSample });
  assert.equal(mountWrites.length, 1);
  assert.doesNotMatch(mountWrites[0], /invite-code-loading/);
  assert.match(mountWrites[0], /class="status status-pending"/);
  assert.match(mountWrites[0], /class="invite-qr-card"/);
  assert.match(mountWrites[0], /class="invite-code-card"/);
  assert.match(mountWrites[0], /class="[^"]*invite-copy-link-full"/);
  assert.match(mountWrites[0], /class="invite-secondary-grid"/);
  await ctrl.refresh({ silent: true, force: true });
  assert.equal(mountWrites.length, 1, 'refresh with unchanged overview must not re-flash or replace DOM');

  // Verify Migration 101 declined-request blocking, blocked modal dialog, and Pic 2/3 styling contracts
  const mig101 = read('database/migrations/20261117_101_block_declined_join_requests.sql');
  for (const sql of [mig101, schema]) {
    assert.match(sql, /'20261117_101'/);
    assert.match(sql, /'DECLINED_BLOCKED'/);
    assert.match(sql, /'blocked',\s*true/);
    assert.match(sql, /You are blocked from joining "%" using this invite link or code because your previous request was declined\./);
  }
  assert.match(coreJs, /function showJoinBlockedDialog\(/);
  assert.match(coreJs, /id="ipon-join-blocked-dialog"/);
  assert.match(coreJs, /class="join-request-chips"/);
  assert.match(css, /\.join-blocked-dialog\s*\{/);
  assert.match(css, /\.join-panel-footer\s*\{/);
  assert.match(css, /\.invite-qr-card\s*\{/);
  assert.match(css, /\.invite-code-card\s*\{/);
  assert.match(css, /\.invite-copy-link-full\s*\{/);
});

test('Reports and member statement CSV exports and Print/Save PDF support Android WebView and mobile browsers', async () => {
  const coreJs = read('js/core.js');
  const reportsJs = read('js/reports.js');
  const userJs = read('js/user.js');
  const pluginJava = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');

  assert.match(coreJs, /async function downloadCsv\(/);
  assert.match(coreJs, /async function printPage\(/);
  assert.match(coreJs, /downloadFile, downloadCsv, printPage, openImageViewer/);
  assert.match(coreJs, /\\uFEFF/);

  assert.match(reportsJs, /Ipon\.downloadCsv\(csv,\s*`ipon-transactions-/);
  assert.match(reportsJs, /Ipon\.downloadCsv\(csv,\s*`ipon-report-/);
  assert.match(reportsJs, /Ipon\.printPage\(/);
  assert.doesNotMatch(reportsJs, /URL\.createObjectURL/);
  assert.doesNotMatch(reportsJs, /window\.print\(\)/);

  assert.match(userJs, /Ipon\.downloadCsv\(csv,\s*`my-ipon-statement-/);
  assert.match(userJs, /Ipon\.printPage\(/);
  assert.doesNotMatch(userJs, /URL\.createObjectURL/);
  assert.doesNotMatch(userJs, /window\.print\(\)/);

  assert.match(pluginJava, /@PluginMethod[\s\S]*?public void printPage\(PluginCall call\)/);
  assert.match(pluginJava, /PrintManager/);
  assert.match(pluginJava, /createPrintDocumentAdapter/);

  // Runtime VM test: old APK without bgPlugin.printPage generates valid PDF 1.4 & BOM CSV via bgPlugin.downloadFile
  const dlCalls = [];
  class MockFileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buf) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      });
    }
  }
  const makeNode = (text = '', tag = 'DIV') => ({
    tagName: tag,
    hidden: false,
    textContent: text,
    style: {},
    classList: { contains: () => false },
    children: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    setAttribute() {}, addEventListener() {}, remove() {}
  });
  const headerEl = Object.assign(makeNode('Reports', 'H1'));
  const panelEl = Object.assign(makeNode('', 'SECTION'), {
    querySelector: (sel) => (sel === '.panel-header h2' ? makeNode('Monthly report', 'H2') : null),
    querySelectorAll: (sel) => {
      if (sel === 'table.data-table tr') {
        const thRow = Object.assign(makeNode(), { children: [makeNode('Month', 'TH'), makeNode('Additions', 'TH')] });
        const trRow = Object.assign(makeNode(), { children: [makeNode('2026-11', 'TD'), makeNode('₱500.00', 'TD')] });
        return [thRow, trRow];
      }
      return [];
    }
  });
  const vmCtx = {
    window: null,
    document: {
      title: 'Reports — myIPON',
      documentElement: { dataset: {}, setAttribute() {}, removeAttribute() {} },
      body: { dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, appendChild() {} },
      createElement: () => makeNode(),
      querySelector: (sel) => (sel === '.page-header h1' ? headerEl : null),
      querySelectorAll: (sel) => (sel === '.panel, .report-panel' ? [panelEl] : []),
      getElementById: () => null,
      addEventListener() {}
    },
    navigator: { userAgent: 'Mozilla/5.0 myIPONApp/20' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Blob,
    FileReader: MockFileReader,
    URL,
    TextEncoder,
    Buffer,
    Map, Set, Date, Math, JSON, Promise, RegExp, Error, Array, Object, String, Number, Boolean,
    setTimeout, clearTimeout,
    IPON_CONFIG: { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' },
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        BackgroundNotifications: {
          downloadFile: async (args) => { dlCalls.push(args); return { saved: true, started: true, fileName: args.fileName }; }
        }
      }
    }
  };
  vmCtx.window = vmCtx;
  vmCtx.addEventListener = () => {};
  vmCtx.location = { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/reports.html' };
  vm.runInNewContext(coreJs, vmCtx, { filename: 'js/core.js' });

  await vmCtx.window.Ipon.downloadCsv('Month,Amount\n2026-11,₱500.00', 'test-report.csv');
  assert.equal(dlCalls.length, 1);
  assert.equal(dlCalls[0].fileName, 'test-report.csv');
  const decodedCsv = Buffer.from(dlCalls[0].url.split(',')[1], 'base64').toString('utf8');
  assert.equal(decodedCsv.startsWith('\uFEFFMonth,Amount'), true);

  await vmCtx.window.Ipon.printPage({ jobName: 'myIPON Report 2026' });
  assert.equal(dlCalls.length, 2);
  assert.equal(dlCalls[1].mimeType, 'application/pdf');
  assert.match(dlCalls[1].fileName, /^myIPON Report 2026-\d{4}-\d{2}-\d{2}\.pdf$/);
  const decodedPdf = Buffer.from(dlCalls[1].url.split(',')[1], 'base64').toString('latin1');
  assert.equal(decodedPdf.startsWith('%PDF-1.4\n'), true);
  assert.match(decodedPdf, /Monthly report/);
  assert.match(decodedPdf, /PHP 500\.00/);
  assert.equal(decodedPdf.endsWith('%%EOF'), true);
});
