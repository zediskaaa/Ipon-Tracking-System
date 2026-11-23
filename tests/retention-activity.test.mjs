import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync('database/migrations/20261123_187_session_and_account_activity_retention.sql', 'utf8');
const badgeFix = fs.readFileSync('database/migrations/20261123_188_protect_active_badges_during_cleanup.sql', 'utf8');
const finalGuard = fs.readFileSync('database/migrations/20261123_189_recheck_inactive_account_purge.sql', 'utf8');
const fn = (name) => sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'))?.[0] || '';

test('retention uses refreshed sessions and recorded account activity with null-safe precedence', () => {
  const helper = fn('latest_retention_activity_at');
  assert.match(helper, /max\(s\.updated_at\).*auth\.sessions s where s\.user_id = p_user_id/s);
  assert.match(helper, /max\(a\.created_at\).*account_activity a where a\.user_id = p_user_id/s);
  assert.match(helper, /'LOGIN', 'PROFILE_UPDATE', 'PASSWORD_CHANGE'/);
  assert.equal((helper.match(/'-infinity'::timestamptz/g) || []).length, 2);
  assert.match(sql, /revoke all on function public\.latest_retention_activity_at\(uuid\) from public, anon, authenticated/);
});

test('warning reset, warning, purge, badge cleanup and badge display share recent activity', () => {
  assert.equal((fn('collect_inactive_account_candidates').match(/latest_retention_activity_at\(p\.id\)/g) || []).length, 4);
  assert.equal((fn('get_active_verified_badges').match(/latest_retention_activity_at\(p\.id\)/g) || []).length, 2);
  const cleanup = badgeFix.match(/create or replace function public\.cleanup_inactive_verified_badges\(\)[\s\S]*?\$\$;/)?.[0] || '';
  const removalPredicate = cleanup.match(/where p\.verified_badge_tier <> 'NONE'[\s\S]*?= 'NONE'/)?.[0] || '';
  assert.match(removalPredicate, /greatest\(p\.last_seen_at, public\.latest_retention_activity_at\(p\.id\)\)/);
  assert.ok(fs.readFileSync('database/schema.sql', 'utf8').replaceAll('\r\n', '\n').includes(cleanup.replaceAll('\r\n', '\n')));
  assert.equal((fn('get_social_user_profile').match(/latest_retention_activity_at\(v_target\.id\)/g) || []).length, 1);
  assert.match(fn('cleanup_inactive_verified_badges'), /verified_badge_expires_at is not null and v_row\.verified_badge_expires_at <= now\(\)/);
});

test('recent login, recent activity, old activity, absent timestamps and inactive account policy', () => {
  const now = Date.UTC(2026, 10, 23);
  const day = 86400000;
  const activity = (...timestamps) => Math.max(...timestamps.filter(Number.isFinite), -Infinity);
  const warnCutoff = now - 6 * 30 * day + 7 * day;
  const purgeCutoff = now - 7 * day;
  assert.ok(activity(now - day, now - 240 * day) > warnCutoff, 'recent session refresh protects a user');
  assert.ok(activity(now - 2 * day, now - 240 * day) > warnCutoff, 'recent account activity protects a user');
  assert.ok(activity(now - 240 * day) <= warnCutoff, 'old activity remains eligible for warning');
  assert.equal(activity(null, undefined), -Infinity, 'missing timestamps are not treated as recent');
  assert.ok(activity(now - 240 * day) <= purgeCutoff, 'a warned user without recent activity remains eligible after grace');
});

test('messages, contributions, and active savings clear stale warnings and block last-second purge', () => {
  const reset = finalGuard.split('select coalesce(')[0];
  assert.match(reset, /c\.submitted_by = p\.id/);
  assert.match(reset, /m\.sender_id = p\.id/);
  assert.match(reset, /group_last_savings_activity_at\(p\.group_id\) > p\.inactivity_warned_at/);
  const purge = finalGuard.match(/create or replace function public\.purge_inactive_user_data\([\s\S]*?\$\$;/)?.[0] || '';
  assert.match(purge, /inactivity_warned_at is null[\s\S]*?interval '7 days'/);
  assert.match(purge, /latest_retention_activity_at\(p_user_id\)/);
  assert.match(purge, /m\.sender_id = p_user_id/);
  assert.match(purge, /group_last_savings_activity_at\(v_prof\.group_id\)/);
  assert.ok(fs.readFileSync('database/schema.sql', 'utf8').replaceAll('\r\n', '\n').includes(purge));
});

test('queue-only maintenance is authenticated and keeps failed deletions retryable', () => {
  const edge = fs.readFileSync('supabase/functions/manage-account/index.ts', 'utf8');
  const branch = edge.indexOf("if (body.action === 'retention-cron')");
  const secretCheck = edge.indexOf('timingSafeSecretEqual(providedSecret, expectedSecret)', branch);
  const queueOnly = edge.indexOf('if (body.queue_only === true)', branch);
  assert.ok(secretCheck > branch && queueOnly > secretCheck);
  assert.match(edge, /if \(links\?\.length\) \{ referenced \+= 1; continue; \}/);
  assert.match(edge, /if \(deleteError\) throw deleteError/);
  assert.match(edge, /catch \(err\) \{\s*failed \+= slice\.length/);
  assert.equal((edge.match(/const CHAT_ATTACHMENTS_BUCKET = 'chat-attachments'/g) || []).length, 1);
});

test('web and Android updates defer reloads during active work', () => {
  const core = fs.readFileSync('js/core.js', 'utf8');
  const sw = fs.readFileSync('sw.js', 'utf8');
  assert.match(core, /function hasPendingUpdateWork\(\)/);
  assert.match(core, /if \(hasPendingUpdateWork\(\)\) return;/);
  assert.match(core, /liveTag !== initialWebShellTag && !hasPendingUpdateWork\(\)/);
  assert.match(core, /if \(!force && hasPendingUpdateWork\(\)\) return \{ status: 'deferred' \};/);
  assert.match(core, /#msg-upload-queue:not\(\[hidden\]\)/);
  assert.doesNotMatch(sw, /skipWaiting\(\)/);
});
