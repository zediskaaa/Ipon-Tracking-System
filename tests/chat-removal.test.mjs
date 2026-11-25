import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('chat-only source files, Edge Function, assets, and sound resources are deleted', () => {
  for (const deleted of [
    'js/messages.js',
    'js/social-video-embeds.js',
    'assets/anonymous-avatar.svg',
    'android/app/src/main/res/raw/myipon_message.wav',
    'supabase/functions/resolve-social-embed/index.ts'
  ]) {
    assert.equal(exists(deleted), false, `Deleted chat file must not exist: ${deleted}`);
  }
});

test('no active HTML, JS, CSS, SW, manifest, CSP, Android, or iOS file references removed chat UI, share target, or embeds', () => {
  const htmlFiles = fs.readdirSync(root).filter((f) => f.endsWith('.html'));
  for (const file of htmlFiles) {
    const html = read(file);
    assert.doesNotMatch(html, /js\/messages\.js|js\/social-video-embeds\.js|data-messages-open|data-messages-count|data-message-creator-badge/, `${file} must not reference removed chat UI/scripts`);
    const cspMeta = html.match(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] || '';
    assert.doesNotMatch(cspMeta, /youtube-nocookie\.com|tiktok\.com|instagram\.com|platform\.twitter\.com/, `${file} CSP must not keep chat-only video embed hosts`);
  }

  const sw = read('sw.js');
  assert.match(sw, /CACHE_NAME = 'ipon-shell-v279'/);
  assert.doesNotMatch(sw, /messages\.js|social-video-embeds\.js|anonymous-avatar\.svg/);
  assert.match(sw, /startsWith\('SOCIAL_'\)/);

  const manifest = read('manifest.webmanifest');
  assert.doesNotMatch(manifest, /share_target/i);

  for (const cfg of ['vercel.json', '_headers']) {
    const txt = read(cfg);
    assert.doesNotMatch(txt, /youtube-nocookie\.com|tiktok\.com|platform\.twitter\.com/);
    assert.match(txt, /microphone=\(\)/);
  }

  const androidManifest = read('android/app/src/main/AndroidManifest.xml');
  assert.doesNotMatch(androidManifest, /ACTION_SEND|RECORD_AUDIO|MODIFY_AUDIO_SETTINGS|DETECT_SCREEN_CAPTURE|READ_MEDIA_IMAGES|READ_EXTERNAL_STORAGE|hardware\.microphone/);

  const mainJava = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  assert.doesNotMatch(mainJava, /IponNativeShare|IponNativePrivacy|IponNativePicker|handleShareIntent|PrivacyBridge|ShareBridge|PickerSourceBridge/);
  assert.match(mainJava, /IponNativeAuth/);

  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  assert.doesNotMatch(bgPlugin, /RECORD_AUDIO|setScreenshotBlocked|setScreenshotMonitoring|ensureMicrophonePermission|micManifestDeclared/);

  const pollJava = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  assert.doesNotMatch(pollJava, /MESSAGE_CHANNEL_ID|myipon_message|MessagingStyle|acknowledgeMessageDelivery|delivery_acks/);
  assert.match(pollJava, /isLegacyChatNotification/);

  const fcmJava = read('android/app/src/main/java/com/myipon/app/MyIponMessagingService.java');
  assert.match(fcmJava, /if \(NotificationPollReceiver\.isLegacyChatNotification\(notifType, dedupeKey, notifLink\)\)\s*\{\s*return;\s*\}/);
  assert.doesNotMatch(fcmJava, /isMessageNotification/);

  const infoPlist = read('ios/App/App/Info.plist');
  assert.doesNotMatch(infoPlist, /NSMicrophoneUsageDescription/);
});

test('core.js filters legacy SOCIAL_* notifications, removes chat exports, and opens Gmail compose for verified badge support', () => {
  const coreJs = read('js/core.js');
  assert.doesNotMatch(coreJs, /IponMessages|data-messages-open|syncMessagesBadges|initPresence|ipon-active-presence|invokeSocialEmbedResolver|openCreatorBadgeChat|resolveCreatorSocialId|anonymous-avatar\.svg/);
  assert.match(coreJs, /function isLegacyChatNotification\(/);
  assert.match(coreJs, /function openCreatorBadgeSupport\(/);

  const opened = [];
  const toasts = [];
  const noop = () => { };
  const stubEl = () => ({
    dataset: {}, style: { setProperty: noop, removeProperty: noop }, hidden: false, open: false, innerHTML: '', textContent: '',
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop, getAttribute: () => null, removeAttribute: noop,
    addEventListener: noop, removeEventListener: noop, querySelector: () => null, querySelectorAll: () => [],
    appendChild: (n) => n, insertAdjacentHTML: noop, close: noop
  });
  const ctx = {
    window: null,
    open: (url, target, features) => { opened.push({ url, target, features }); return {}; },
    document: {
      documentElement: stubEl(), head: stubEl(), body: stubEl(),
      getElementById: () => stubEl(), querySelector: () => null, querySelectorAll: () => [],
      createElement: () => stubEl(), addEventListener: noop, removeEventListener: noop
    },
    location: { origin: 'https://my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/account.html', pathname: '/account.html', search: '', hash: '' },
    navigator: { userAgent: 'Mozilla/5.0', onLine: true, clipboard: { writeText: async () => { } } },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    setTimeout: () => 0, clearTimeout: noop, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl, console
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  const instrumented = coreJs
    .replace("function toast(message, tone = 'success') {", "function toast(message, tone = 'success') { __captureToast(message, tone);")
    .replace("window.Ipon = {", "window.__setTestProfile = (p) => { currentProfile = p; };\n  window.Ipon = {");
  ctx.__captureToast = (m, t) => toasts.push({ m, t });
  vm.runInNewContext(instrumented, ctx, { filename: 'js/core.js' });

  assert.equal(typeof ctx.window.Ipon.openCreatorBadgeSupport, 'function');
  assert.equal(ctx.window.Ipon.openCreatorBadgeChat, undefined);
  assert.equal(ctx.window.Ipon.syncMessagesBadges, undefined);
  assert.equal(ctx.window.Ipon.invokeSocialEmbedResolver, undefined);
  assert.equal(ctx.window.Ipon.resolveNotificationTarget({ type: 'SOCIAL_NEW_MESSAGE', link: 'dashboard.html?chat=123' }, 'MEMBER'), 'dashboard.html');

  ctx.window.__setTestProfile({ id: 'u1', role: 'MEMBER', full_name: 'Ana Cruz', username: 'anacruz', email: 'ana@example.com' });
  const openedOk = ctx.window.Ipon.openCreatorBadgeSupport();
  assert.equal(openedOk, true);
  assert.equal(opened.length, 1);
  assert.match(opened[0].url, /^https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=zedrickdemonteverde1%40gmail\.com/);
  assert.match(opened[0].url, /Verified%20Badge%20Request/);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0].m, /Opening email to zedrickdemonteverde1@gmail\.com/);

  ctx.window.__setTestProfile({ id: 'u0', role: 'SUPER_ADMIN', full_name: 'Owner', username: 'owner', email: 'owner@example.com' });
  assert.equal(ctx.window.Ipon.openCreatorBadgeSupport(), false);
  assert.equal(opened.length, 1);
});

test('Edge Functions fail safely on legacy chat actions, skip SOCIAL_* push, and preserve historical chat R2 objects', () => {
  const manageAccount = read('supabase/functions/manage-account/index.ts');
  const sendPush = read('supabase/functions/send-push/index.ts');

  assert.match(manageAccount, /body\.action === 'chat-upload-urls' \|\| body\.action === 'chat-view-urls' \|\| body\.action === 'chat-cleanup-media'/);
  assert.match(manageAccount, /Chat messaging has been removed from myIPON\./);
  assert.doesNotMatch(manageAccount, /if \(bucket === 'chat-attachments'\)/);
  assert.doesNotMatch(manageAccount, /personal messages/);

  assert.match(sendPush, /if \(notifType\.startsWith\('SOCIAL_'\)\) \{[\s\S]*?reason: 'legacy_chat_removed'/);
  assert.doesNotMatch(sendPush, /\?messages=|isMessage|cleanMessageNotificationTitle/);
});

test('Migration 193 and schema.sql disable chat cleanly without dropping or deleting historical chat data', () => {
  const mig193 = read('database/migrations/20261123_193_remove_chat_system.sql').replace(/\r\n/g, '\n');
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');

  assert.ok(schema.includes(mig193.trim()), 'schema.sql must contain Migration 193 verbatim');
  assert.match(mig193, /'20261123_193'/);
  assert.match(mig193, /jobname = 'ipon-vanishing-message-purge'/);
  assert.match(mig193, /alter publication supabase_realtime drop table/);
  assert.match(mig193, /revoke all on table public\.%I from public, anon, authenticated/);

  // Stale-client zero-scan tombstones exist
  for (const fn of [
    'get_conversations',
    'get_social_overview',
    'get_conversation_messages',
    'mark_conversation_read',
    'mark_messages_delivered',
    'report_client_platform',
    'ack_message_notifications_by_token'
  ]) {
    assert.match(mig193, new RegExp(`create or replace function public\\.${fn}\\(`, 'i'), `Missing stale-client tombstone ${fn}`);
  }

  // Data safety invariant: Migration 193 must NEVER drop, truncate, or delete historical chat tables/rows or legacy SOCIAL_* notifications
  assert.doesNotMatch(mig193, /^\s*drop\s+table\b/im, 'Migration 193 must NOT drop historical chat tables');
  assert.doesNotMatch(mig193, /\btruncate\s+table\b/i, 'Migration 193 must NOT truncate historical chat tables');
  assert.doesNotMatch(mig193, /\bdelete\s+from\s+public\.(?:messages|conversations|conversation_participants|message_attachments|message_reactions|message_receipts|call_sessions|friend_requests|friendships|blocked_users)\b/i, 'Migration 193 must NOT delete historical chat rows');
  assert.match(mig193, /delete\s+from\s+public\.notifications\s+where\s+type\s+not\s+like\s+'SOCIAL_%'/i, 'Migration 193 retention cleanup must explicitly preserve historical SOCIAL_* notification rows');
  assert.doesNotMatch(mig193, /\bdelete\s+from\s+public\.notifications\s+where\s+type\s+like\s+'SOCIAL_%'/i, 'Migration 193 must NOT delete legacy SOCIAL_* notification rows');
});
