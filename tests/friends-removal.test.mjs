import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Migration 194 removes Friend Requests and Friends cleanly without CASCADE and syncs schema.sql', () => {
  const mig193 = read('database/migrations/20261123_193_remove_chat_system.sql').replace(/\r\n/g, '\n');
  const mig194 = read('database/migrations/20261123_194_remove_friends_system.sql').replace(/\r\n/g, '\n');
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');

  // Prior migration 193 remains preserved and unmodified in schema.sql
  assert.ok(schema.includes(mig193.trim()), 'schema.sql must keep Migration 193 verbatim');
  assert.ok(schema.includes(mig194.trim()), 'schema.sql must include Migration 194 verbatim');

  // Transactional & recorded
  assert.match(mig194, /^\s*begin;/im);
  assert.match(mig194, /^\s*commit;\s*$/im);
  assert.match(mig194, /insert into public\.schema_migrations \(version, name\)\s+values \('20261123_194', 'remove_friends_system'\)/i);

  // Strictly NO CASCADE anywhere in executable SQL
  const mig194Sql = mig194.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(mig194Sql, /\bcascade\b/i, 'Migration 194 must never use CASCADE');

  // Explicit cleanup of Realtime, triggers, policies, indexes, functions, and both tables
  assert.match(mig194, /alter publication supabase_realtime drop table public\.%I/i);
  assert.match(mig194, /drop trigger if exists friend_requests_updated_at on public\.friend_requests;/i);
  assert.match(mig194, /drop index if exists public\.friend_requests_active_pair_uidx;/i);
  assert.match(mig194, /drop index if exists public\.friend_requests_receiver_idx;/i);
  assert.match(mig194, /drop index if exists public\.friend_requests_sender_idx;/i);
  assert.match(mig194, /drop index if exists public\.friendships_user_a_idx;/i);
  assert.match(mig194, /drop index if exists public\.friendships_user_b_idx;/i);

  for (const fnSig of [
    'public.are_friends(uuid, uuid)',
    'public.send_friend_request(uuid)',
    'public.respond_friend_request(uuid, text)',
    'public.cancel_friend_request(uuid)',
    'public.remove_friend(uuid)',
    'public.get_friend_suggestions(integer)',
    'public.get_mutual_friends_summary(uuid, uuid, integer)',
    'public.get_user_friends_count(uuid, uuid)',
    'public.can_view_social_profile(uuid, uuid, text)',
    'public.get_social_user_profile(uuid)',
    'public.search_social_users(text, integer)',
    'public.update_social_profile_and_privacy(text, text, jsonb)',
    'public.canonical_pair_key(uuid, uuid)'
  ]) {
    const escaped = fnSig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(mig194, new RegExp(`drop function if exists ${escaped};`, 'i'), `Missing explicit drop for ${fnSig}`);
  }

  assert.match(mig194, /drop table if exists public\.friend_requests;/i);
  assert.match(mig194, /drop table if exists public\.friendships;/i);

  // Stale-client zero-scan tombstone kept on get_social_overview()
  assert.match(mig194, /create or replace function public\.get_social_overview\(\)[\s\S]*?'friends_disabled',\s*true/i);

  // Profile friend-privacy settings stripped while keeping chat_privacy column as '{}' for stale APK boot safety
  assert.match(mig194, /alter table public\.profiles\s+alter column chat_privacy set default '\{\}'::jsonb;/i);
  assert.match(mig194, /-\s*array\['allow_friend_requests',\s*'profile_visibility',\s*'allow_message_requests'\]/i);
  assert.doesNotMatch(mig194, /\bdrop\s+column\b/i, 'Migration 194 must keep empty-default chat_privacy column so un-updated APKs do not hit HTTP 400');

  // Deletes ONLY friend-only notification types; never touches shared/unrelated tables or social_links
  assert.match(mig194, /delete from public\.notifications\s+where type in \('SOCIAL_FRIEND_REQUEST', 'SOCIAL_FRIEND_ACCEPTED'\);/i);
  assert.doesNotMatch(mig194, /delete from public\.(?!notifications\b)/i, 'Migration 194 must not delete rows from any table other than friend-only notifications');
  assert.doesNotMatch(mig194, /drop table if exists public\.(?!friend_requests\b|friendships\b)/i, 'Migration 194 must only drop friend_requests and friendships');
  assert.doesNotMatch(mig194, /\b(?:social_links|group_invite_codes|group_join_requests|verified_badge|profile_effect|contributions|withdrawals|expenses|savings_goals)\b/i, 'Migration 194 must not modify shared accounts, invites, badges, effects, bio social_links, or financial objects');
});

test('no active web, Edge, Service Worker, Android, or iOS file retains friend requests, friends list, suggestions, mutual friends, or friend privacy controls', () => {
  const activeDirs = ['js', 'css', 'supabase/functions', 'android/app/src/main/java/com/myipon/app'];
  const activeFiles = [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.html')),
    'sw.js',
    'manifest.webmanifest',
    'vercel.json',
    '_headers',
    'android/app/src/main/AndroidManifest.xml',
    'ios/App/App/Info.plist'
  ];

  for (const dir of activeDirs) {
    const absDir = path.join(root, dir);
    if (!fs.existsSync(absDir)) continue;
    const walk = (current, relBase) => {
      for (const ent of fs.readdirSync(current, { withFileTypes: true })) {
        const rel = `${relBase}/${ent.name}`;
        if (ent.isDirectory()) walk(path.join(current, ent.name), rel);
        else if (/\.(js|css|ts|java|xml|plist)$/i.test(ent.name)) activeFiles.push(rel);
      }
    };
    walk(absDir, dir);
  }

  const forbidden = /\b(?:friend_requests|friendships|send_friend_request|respond_friend_request|cancel_friend_request|remove_friend|get_friend_suggestions|get_mutual_friends_summary|get_user_friends_count|allow_friend_requests|profile_visibility|update_social_profile_and_privacy|can_view_social_profile|get_social_user_profile|search_social_users|are_friends)\b/i;

  for (const rel of activeFiles) {
    const text = read(rel);
    assert.doesNotMatch(text, forbidden, `Active file must not retain friend feature code or RPCs: ${rel}`);
  }

  // Confirm shared bio social links and group invite codes remain intact
  const coreJs = read('js/core.js');
  assert.match(coreJs, /update_own_social_links/);
  assert.match(coreJs, /update_own_social_identity/);
  assert.match(coreJs, /mountInviteCodePanel/);
  assert.match(coreJs, /mountJoinGroupPanel/);
});

test('core.js, sw.js, send-push, and Android NotificationPollReceiver filter friend notifications while preserving announcements and account alerts', () => {
  const coreJs = read('js/core.js');
  const swJs = read('sw.js');
  const sendPush = read('supabase/functions/send-push/index.ts');
  const pollJava = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');

  assert.match(coreJs, /dedupe\.startsWith\('SOCIAL_'\) \|\| dedupe\.startsWith\('FRIEND_'\)/);
  assert.match(swJs, /notifType\.startsWith\('SOCIAL_'\) \|\| notifDedupe\.startsWith\('SOCIAL_'\) \|\| notifDedupe\.startsWith\('FRIEND_'\)/);
  assert.match(sendPush, /notifType\.startsWith\('SOCIAL_'\)/);
  assert.match(pollJava, /upperDedupe\.startsWith\("SOCIAL_"\) \|\| upperDedupe\.startsWith\("FRIEND_"\)/);

  // Runtime VM check on js/core.js notification routing
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
    document: {
      documentElement: stubEl(), head: stubEl(), body: stubEl(),
      getElementById: () => stubEl(), querySelector: () => null, querySelectorAll: () => [],
      createElement: () => stubEl(), addEventListener: noop, removeEventListener: noop
    },
    location: { origin: 'https://my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/dashboard.html', pathname: '/dashboard.html', search: '', hash: '' },
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    addEventListener: noop, removeEventListener: noop, dispatchEvent: noop,
    setTimeout: () => 0, clearTimeout: noop, URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl, console
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  const instrumented = coreJs.replace('window.Ipon = {', 'window.__isLegacyChatNotif = isLegacyChatNotification;\n  window.Ipon = {');
  vm.runInNewContext(instrumented, ctx, { filename: 'js/core.js' });

  // Friend notifications are filtered and safely neutralized to home page
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'SOCIAL_FRIEND_REQUEST', link: 'dashboard.html?messages=friend_requests' }), true);
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'SOCIAL_FRIEND_ACCEPTED', link: 'dashboard.html?messages=friends' }), true);
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'NOTICE', dedupe_key: 'FRIEND_REQ:123', link: 'dashboard.html' }), true);
  assert.equal(ctx.window.Ipon.resolveNotificationTarget({ type: 'SOCIAL_FRIEND_REQUEST', link: 'dashboard.html?messages=friend_requests' }, 'MEMBER'), 'dashboard.html');
  assert.equal(ctx.window.Ipon.resolveNotificationTarget({ type: 'SOCIAL_FRIEND_ACCEPTED', link: 'dashboard.html?messages=friends' }, 'ADMIN'), 'dashboard.html');

  // Unrelated announcements, account, badge, effect, and financial notifications stay intact
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'PLATFORM_ANNOUNCEMENT', link: 'dashboard.html?announcement=abc' }), false);
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'ACCOUNT_READY', link: 'dashboard.html' }), false);
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'CONTRIBUTION_REMINDER', link: 'user.html' }), false);
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'BADGE_GRANTED', link: 'account.html' }), false);
  assert.equal(ctx.window.__isLegacyChatNotif({ type: 'GROUP_INVITE', link: 'dashboard.html' }), false);
  assert.equal(ctx.window.Ipon.resolveNotificationTarget({ type: 'PLATFORM_ANNOUNCEMENT', link: 'dashboard.html?announcement=abc' }, 'MEMBER'), 'dashboard.html?announcement=abc');
});
