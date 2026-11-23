import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(p, 'utf8');

test('migration 191 optimizes get_conversations and get_conversation_messages without per-row definer fan-out', () => {
  const mig = read('database/migrations/20261123_191_optimize_chat_rpcs_performance.sql');
  const schema = read('database/schema.sql');

  for (const sql of [mig, schema]) {
    assert.match(sql, /'20261123_191'/);
    assert.match(sql, /create or replace function public\.get_conversations_unmasked\(\)/i);
    assert.match(sql, /create or replace function public\.get_conversations\(\)/i);
    assert.match(sql, /create or replace function public\.get_conversation_messages_unmasked\(/i);
  }

  const unmaskedConvs = mig.match(/create or replace function public\.get_conversations_unmasked\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(unmaskedConvs, /with my_friends as/i);
  assert.match(unmaskedConvs, /my_blocks as/i);
  assert.match(unmaskedConvs, /unread_counts as/i);
  assert.doesNotMatch(unmaskedConvs, /public\.are_friends\(/i, 'get_conversations_unmasked must use my_friends CTE instead of per-row are_friends');
  assert.doesNotMatch(unmaskedConvs, /public\.is_user_blocked_between\(/i, 'get_conversations_unmasked must use my_blocks CTE instead of per-row is_user_blocked_between');

  const convsWrapper = mig.match(/create or replace function public\.get_conversations\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(convsWrapper, /v_creator_id uuid/);
  assert.doesNotMatch(convsWrapper, /public\.is_creator_messaging_account\(/i, 'get_conversations must resolve creator id once instead of per-row');
  assert.doesNotMatch(convsWrapper, /public\.is_user_blocked_between\(/i, 'get_conversations must reuse peer.is_blocked instead of re-querying blocked_users per row');

  const unmaskedMsgs = mig.match(/create or replace function public\.get_conversation_messages_unmasked\([\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(unmaskedMsgs, /sender_meta as/i);
  assert.match(unmaskedMsgs, /replies_map as/i);
  assert.match(unmaskedMsgs, /receipts_agg as/i);
  assert.match(unmaskedMsgs, /attachments_agg as/i);
  assert.match(unmaskedMsgs, /reactions_agg as/i);

  // Permissions preserved
  assert.match(mig, /revoke all on function public\.get_conversations_unmasked\(\) from public, anon, authenticated;/i);
  assert.match(mig, /revoke all on function public\.get_conversation_messages_unmasked\(uuid, timestamptz, integer, uuid\) from public, anon, authenticated;/i);
  assert.match(mig, /grant execute on function public\.get_conversations\(\) to authenticated;/i);
});

test('core.js stages background boot tasks behind setLoading(false) and cleans nonced realtime topics; dashboard.js deduplicates boot permissions and overlapping loads', () => {
  const core = read('js/core.js');
  const dash = read('js/dashboard.js');

  assert.match(core, /function schedulePostReadyBoot\(task, fallbackMs = 1200\)/);
  assert.match(core, /function flushPostReadyBootTasks\(\)/);
  assert.match(core, /schedulePostReadyBoot\(\(\) => \{ checkRewards\(\)\.catch\(\(\) => \{ \}\); \}, 1500\)/);
  assert.match(core, /startsWith\(`\$\{targetTopic\}:`\)/, 'createRealtimeChannel must clean previously nonced channels');

  assert.match(dash, /let initialLoadCompleted = false;/);
  assert.match(dash, /let dashboardLoadPromise = null;/);
  assert.match(dash, /const shouldRefreshPerms = initialLoadCompleted && typeof Ipon\.refreshMyPermissions === 'function';/);
});

test('migration 192 adds per-user chat RPC concurrency guard and lightweight direct peer header; core.js retries Supabase 504/PGRST003 error payloads', () => {
  const mig192 = read('database/migrations/20261123_192_chat_rpc_concurrency_guard_and_light_peer.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const sa = read('js/super-admin.js');

  for (const sql of [mig192, schema]) {
    assert.match(sql, /'20261123_192'/);
    assert.match(sql, /pg_try_advisory_xact_lock\(hashtext\('ipon_chat_convs'\)/);
    assert.match(sql, /pg_try_advisory_xact_lock\(hashtext\('ipon_chat_msgs'\)/);
    assert.match(sql, /errcode = '53300'/);
  }
  const unmaskedMsgs192 = mig192.match(/create or replace function public\.get_conversation_messages_unmasked\([\s\S]*?\$\$;/i)?.[0] || '';
  assert.doesNotMatch(unmaskedMsgs192, /get_social_user_profile\(/i, 'get_conversation_messages_unmasked must avoid heavy profile-popover queries on every thread refresh');

  assert.match(core, /PGRST003\|57014\|53300\|connection pool/);
  assert.match(core, /result && typeof result === 'object' && result\.error && i < attempts - 1 && isTransientConnectionError\(result\.error\)/);
  assert.match(sa, /if \(state\.failed\) \{[\s\S]*?Connection interrupted[\s\S]*?Ipon\.showInlineError\(overviewErrEl/);
});
