import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));

test('Migration 195 drops all 8 remaining chat tables, enqueues R2 chat media, removes legacy chat notifications, and uses zero CASCADE', () => {
  const mig193 = read('database/migrations/20261123_193_remove_chat_system.sql').replace(/\r\n/g, '\n');
  const mig194 = read('database/migrations/20261123_194_remove_friends_system.sql').replace(/\r\n/g, '\n');
  const mig195 = read('database/migrations/20261123_195_finalize_chat_and_friends_cleanup.sql').replace(/\r\n/g, '\n');
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');

  assert.ok(schema.includes(mig193.trim()), 'Migration 193 must remain verbatim in schema.sql');
  assert.ok(schema.includes(mig194.trim()), 'Migration 194 must remain verbatim in schema.sql');
  assert.ok(schema.includes(mig195.trim()), 'Migration 195 must be appended verbatim to schema.sql');

  // Transactional, recorded, and strictly zero CASCADE in executable SQL
  assert.match(mig195, /^\s*begin;/im);
  assert.match(mig195, /^\s*commit;\s*$/im);
  assert.match(mig195, /insert into public\.schema_migrations \(version, name\)\s+values \('20261123_195', 'finalize_chat_and_friends_cleanup'\)/i);
  const execSql = mig195.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(execSql, /\bcascade\b/i, 'Migration 195 must never use CASCADE');

  // Enqueues message_attachments paths BEFORE dropping message_attachments
  const enqueueIdx = execSql.indexOf('insert into public.pending_storage_deletions');
  const dropAttIdx = execSql.indexOf('drop table if exists public.message_attachments;');
  assert.ok(enqueueIdx !== -1 && dropAttIdx !== -1 && enqueueIdx < dropAttIdx, 'message_attachments paths must be queued before dropping the table');

  // Strict child-to-parent drop order for all 8 remaining chat tables
  const dropOrder = [
    'message_receipts',
    'message_reactions',
    'message_attachments',
    'messages',
    'call_sessions',
    'conversation_participants',
    'conversations',
    'blocked_users'
  ];
  let prevIdx = -1;
  for (const tbl of dropOrder) {
    const idx = execSql.indexOf(`drop table if exists public.${tbl};`);
    assert.ok(idx > prevIdx, `Expected drop table for ${tbl} in child-to-parent order`);
    prevIdx = idx;
  }

  // Deletes ONLY the 4 remaining legacy chat notification types
  assert.match(execSql, /delete from public\.notifications\s+where type in \(\s*'SOCIAL_NEW_MESSAGE',\s*'SOCIAL_MESSAGE_REQUEST',\s*'SOCIAL_MESSAGE_ACCEPTED',\s*'SOCIAL_CALL_INCOMING'\s*\);/i);

  // Drops obsolete client platform columns and unreachable tombstones cleanly
  assert.match(execSql, /drop constraint if exists profiles_last_client_platform_check;/i);
  assert.match(execSql, /drop column if exists last_client_platform,\s*drop column if exists last_client_platform_at;/i);
  assert.match(execSql, /drop function if exists public\.get_conversation_messages\(uuid, timestamptz, integer, uuid\);/i);
  assert.match(execSql, /drop function if exists public\.mark_conversation_read\(uuid\);/i);
  assert.match(execSql, /drop function if exists public\.ack_message_notifications_by_token\(uuid, bigint\[\]\);/i);

  // Explicit 2026-11-30 retirement cutoff documented on remaining boot shims
  assert.match(mig195, /comment on function public\.get_conversations\(\) is[\s\S]*?2026-11-30/i);
  assert.match(mig195, /comment on column public\.profiles\.chat_privacy is[\s\S]*?2026-11-30/i);
  assert.match(mig195, /comment on column public\.v_announcements\.author_social_user_id is[\s\S]*?2026-11-30/i);

  // Preserves profiles.last_seen_at and all core product features untouched
  assert.doesNotMatch(execSql, /drop column if exists last_seen_at/i, 'profiles.last_seen_at must remain intact while auth.sessions is volatile and account_activity prunes at 90d');
  assert.doesNotMatch(execSql, /\b(?:social_links|group_invite_codes|group_join_requests|record_comments|verified_badge|profile_effect)\b/i);

  // Dead placeholder counters removed from super_admin_storage_overview & run_data_retention_cleanup
  const overviewFn = execSql.match(/create or replace function public\.super_admin_storage_overview\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.doesNotMatch(overviewFn, /messages_count/i);
  const cleanupFn = execSql.match(/create or replace function public\.run_data_retention_cleanup\([\s\S]*?\$\$;/i)?.[0] || '';
  assert.doesNotMatch(cleanupFn, /messages_deleted|calls_deleted/i);
});

test('verified badge copy and dead chat promo banner are cleaned cleanly across web and Edge Functions', () => {
  const coreJs = read('js/core.js');
  const manageAccount = read('supabase/functions/manage-account/index.ts');

  assert.doesNotMatch(coreJs, /across chats/i);
  assert.match(coreJs, /display it beside your name across your profile, group workspaces, and community views\./);
  assert.equal(exists('assets/banners/myipon-update-1-12/myipon-update-1-12.html'), false, 'Dead Update 1.12 chat promo banner must be deleted');
  assert.doesNotMatch(manageAccount, /if \(bucket === 'chat-attachments'\)/, 'manage-account must drain queued chat-attachments R2 objects cleanly');
  assert.match(manageAccount, /2026-11-30[\s\S]*?chat-upload-urls/);
});
