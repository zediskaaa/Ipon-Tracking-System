import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('1. Super Admin removes Realtime/polling refreshes while preserving manual refresh, panel-open loads, and non-Super-Admin live sync', () => {
  const saHtml = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const dashboardJs = read('js/dashboard.js');
  const recordsJs = read('js/records.js');
  const coreJs = read('js/core.js');

  // Super Admin has zero Realtime subscriptions and zero auto-polling timers
  assert.doesNotMatch(saJs, /subscribeToChanges\(/);
  assert.doesNotMatch(saJs, /\bsetInterval\s*\(/);
  assert.doesNotMatch(saJs, /scheduledAwardAutoTimer|scheduleNextScheduledAwardTick/);
  assert.doesNotMatch(coreJs, /initPresence|ipon-active-presence/);

  // Super Admin loads on initial open, panel switch (hashchange), action success, and explicit Refresh button click
  assert.match(saJs, /window\.addEventListener\('hashchange',\s*async \(\) => \{\s*showView\(true\);\s*await refresh\(\{ showGlobalLoader: true \}\);\s*\}\);/);
  assert.match(saJs, /try \{ await refresh\(\); \} finally \{ Ipon\.setLoading\(false\); \}/);
  assert.match(saJs, /refreshButtons\.forEach\(\(btn\) => \{\s*btn\.addEventListener\('click', \(\) => refresh\(\{ triggerButton: btn \}\)\);\s*\}\);/);

  // Explicit Refresh buttons exist on Overview and every Super Admin workspace panel
  for (const id of ['overview', 'feature-requests', 'bug-reports', 'administrators', 'badges', 'effects']) {
    const sectionRe = new RegExp(`data-platform-view="${id}"[\\s\\S]*?data-sa-refresh`);
    assert.match(saHtml, sectionRe, `Super Admin panel ${id} must expose a manual Refresh button`);
  }

  // Clear loading, error, and retry states across panels
  assert.match(saJs, /Refreshing platform data…/);
  assert.match(saJs, /Platform data unavailable/);
  assert.match(saJs, /Ipon\.showInlineError\(overviewError,\s*error,\s*retryRefresh\)/);
  assert.match(saJs, /if \(featureCardsContainer\) Ipon\.showInlineError\(featureCardsContainer,\s*error,\s*retryRefresh\)/);
  assert.match(saJs, /if \(featureRequestResult\.error\)/);
  assert.match(saJs, /if \(bugReportResult\.error\)/);

  // Other roles' live Realtime updates remain intact
  assert.match(dashboardJs, /Ipon\.subscribeToChanges\('dashboard'/);
  assert.match(recordsJs, /Ipon\.subscribeToChanges\(/);
});

test('2. R2 ipon-media uploads, 302 redirect serving, and Migration 186 URL/cleanup validation work without temporary migration routes', () => {
  const edgeTs = read('supabase/functions/manage-account/index.ts');
  const coreJs = read('js/core.js');
  const mig186 = read('database/migrations/20261123_186_r2_media_urls_and_gemini_cleanup.sql');
  const schema = read('database/schema.sql');

  // Edge Function serves public ipon-media R2 objects via 302 redirect and signs direct R2 PUTs on media-upload-url
  assert.match(edgeTs, /const PUBLIC_MEDIA_R2_PATH_RE = \/\^\(avatars\|covers\|group-avatars\|group-qr\|receipts\|bug-reports\)\\\/\[0-9a-f-\]\{36\}\\\/r2\\\/\[a-zA-Z0-9\._-\]\+\$\/;/);
  assert.match(edgeTs, /reqUrl\.searchParams\.get\('media'\)/);
  assert.match(edgeTs, /signR2Object\('ipon-media',\s*mediaPath,\s*'GET'\)/);
  assert.match(edgeTs, /status:\s*302/);
  assert.match(edgeTs, /publicUrl:\s*`\$\{url\}\/functions\/v1\/manage-account\?media=\$\{objectPath\}`/);
  assert.doesNotMatch(edgeTs, /migrate-legacy-storage-object/, 'Temporary storage migration endpoint must be removed after migration');

  // Client uploadMediaDataUrl performs direct R2 PUT when token === "r2"
  assert.match(coreJs, /if \(meta\.token === 'r2' && meta\.signedUrl\) \{[\s\S]*?method:\s*'PUT'[\s\S]*?'Content-Type':\s*contentType/);

  // Migration 186 and schema.sql accept R2 ?media= URLs in validation, cleanup extraction, and profile cover RPC
  for (const sql of [mig186, schema]) {
    assert.match(sql, /'20261123_186'/);
    assert.match(sql, /extract_ipon_media_path[\s\S]*?functions\/v1\/manage-account\\\?media=\(avatars\|covers\|group-avatars\|group-qr\|receipts\|bug-reports\)/);
    assert.match(sql, /is_valid_media_reference[\s\S]*?functions\/v1\/manage-account\\\?media=\(avatars\|covers\|group-avatars\|group-qr\|receipts\|bug-reports\)/);
    assert.match(sql, /update_own_profile_card[\s\S]*?functions\/v1\/manage-account\\\?media=covers\//);
    assert.match(sql, /delete from public\.internal_webhook_config\s+where key = 'gemini_api_key';/i);
  }
});

test('3. Gemini AI integration is completely removed across UI, client, Edge Function, CSP, and scripts while manual release notes stay functional', () => {
  const filesToCheck = [
    'super-admin.html',
    'dashboard.html',
    'js/super-admin.js',
    'js/core.js',
    'js/config.js',
    'css/app.css',
    'vercel.json',
    '_headers',
    'supabase/functions/manage-account/index.ts',
    'scripts/supabase-migrate.mjs'
  ];
  for (const rel of filesToCheck) {
    const content = read(rel);
    assert.doesNotMatch(content, /generativelanguage\.googleapis\.com/i, `${rel} must not reference Gemini API host`);
    assert.doesNotMatch(content, /ai-generate-release-notes|gemini-key-status|save-gemini-key|test-gemini-key|GEMINI_API_KEY|geminiApiKey|callGemini|getGeminiApiKey|getGeminiModel|release-update-ai-btn|gemini-key-dialog|button-ai-trigger|gemini-status-badge/i, `${rel} must not contain Gemini code, UI, or config`);
  }
  assert.equal(fs.existsSync(path.join(process.cwd(), 'js', 'release-commits.json')), false, 'Gemini-only release-commits.json must be removed');

  // Manual release update dialog & publishing path remain fully intact
  const saHtml = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  assert.match(saHtml, /id="sa-add-release-update"/);
  assert.match(saHtml, /id="release-update-dialog"/);
  assert.match(saHtml, /id="release-update-form"/);
  assert.match(saHtml, /id="release-update-version"/);
  assert.match(saHtml, /id="release-update-heading"/);
  assert.match(saHtml, /id="release-update-details"/);
  assert.match(saJs, /openReleaseUpdateDialog/);
  assert.match(saJs, /p_announcement_type:\s*'RELEASE'/);

  // Unrelated Google/Clerk auth stays intact
  const edgeTs = read('supabase/functions/manage-account/index.ts');
  assert.match(edgeTs, /CLERK_ISSUER/);
  assert.match(read('login.html'), /clerk/i);
});

test('4. Online/Last Seen heartbeat, presence indicators, and chat system are removed while Migration 185 remains intact', () => {
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const heroPlates = read('css/hero-plates.css');
  const recordsJs = read('js/records.js');
  const requestsJs = read('js/requests.js');

  for (const [label, txt] of [
    ['js/core.js', coreJs],
    ['js/records.js', recordsJs],
    ['js/requests.js', requestsJs],
    ['css/app.css', css],
    ['css/hero-plates.css', heroPlates]
  ]) {
    assert.doesNotMatch(txt, /touch_user_last_seen|presence-dot|syncPresenceDots|isUserOnline|onlineUserIds|setOnlineVisibility/, `${label} must not contain heartbeat or presence-dot code`);
  }

  assert.equal(fs.existsSync(path.join(process.cwd(), 'js', 'messages.js')), false, 'js/messages.js must be removed');
  assert.doesNotMatch(coreJs, /hasLiveBrowserSession|refreshPeerClientPlatforms|initPresence/);

  // Migration 185 remains untouched in migrations and schema.sql
  assert.equal(fs.existsSync(path.join(process.cwd(), 'database', 'migrations', '20261123_185_avoid_redundant_creator_effect_writes.sql')), true);
  assert.match(read('database/schema.sql'), /'20261123_185'/);
});
