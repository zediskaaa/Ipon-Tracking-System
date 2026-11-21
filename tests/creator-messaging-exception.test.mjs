import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('database/migrations/20261122_171_creator_messaging_exception.sql', 'utf8');
const schema = readFileSync('database/schema.sql', 'utf8');
const messages = readFileSync('js/messages.js', 'utf8');

function definition(sql, name) {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} must be defined`);
  const end = sql.indexOf('$$;', sql.indexOf('as $$', start));
  assert.ok(end > start, `${name} must have a complete body`);
  return sql.slice(start, end + 3).replaceAll('\r\n', '\n');
}

test('creator identity is verified from auth email and cannot be blocked', () => {
  assert.match(definition(migration, 'is_creator_messaging_account'), /auth\.users u[\s\S]*?lower\(btrim\(u\.email\)\) = 'breadspanish231@gmail\.com'/);
  assert.match(migration, /revoke all on function public\.is_creator_messaging_account\(uuid\) from public, anon, authenticated/);
  assert.match(migration, /delete from public\.blocked_users b[\s\S]*?b\.blocked_id = u\.id/);
  assert.match(migration, /update public\.conversations c[\s\S]*?c\.initiator_id = u\.id[\s\S]*?c\.status = 'PENDING_REQUEST'/);
  assert.match(definition(migration, 'block_social_user'), /is_creator_messaging_account\(p_target_id\)[\s\S]*?cannot be blocked/);
});

test('creator direct chats bypass friends-only at each server gate while other users keep the guard', () => {
  for (const name of ['start_or_open_direct_chat', 'can_send_to_conversation', 'send_chat_message']) {
    const sql = definition(migration, name);
    assert.match(sql, /is_creator_messaging_account\(v_uid\)/, `${name} must recognize the creator sender`);
    assert.match(sql, /are_friends|v_is_friend/, `${name} must retain ordinary friend checks`);
    assert.match(sql, /allow_message_requests/, `${name} must retain peer privacy checks`);
    assert.equal(definition(schema, name), sql, `${name} must match the cumulative schema`);
  }
  assert.match(definition(migration, 'start_or_open_direct_chat'), /v_next_status := case when[\s\S]*?is_creator_messaging_account\(v_uid\) then 'ACCEPTED'/);
  assert.match(definition(migration, 'can_send_to_conversation'), /v_conv\.status = 'ACCEPTED' and public\.is_creator_messaging_account\(v_conv\.initiator_id\)/);
  assert.match(definition(migration, 'send_chat_message'), /v_conv\.status = 'ACCEPTED' and public\.is_creator_messaging_account\(v_conv\.initiator_id\)/);
});

test('chat discovery and UI expose messaging but hide block controls for the creator', () => {
  for (const name of ['get_social_user_profile', 'search_social_users', 'get_social_overview', 'get_conversations', 'get_conversation_messages']) {
    assert.equal(definition(schema, name), definition(migration, name), `${name} must match the cumulative schema`);
  }
  assert.match(definition(migration, 'get_social_user_profile'), /'can_block', not public\.is_creator_messaging_account\(p_target_id\)/);
  assert.match(definition(migration, 'search_social_users'), /'can_message',[\s\S]*?is_creator_messaging_account\(v_uid\)/);
  assert.match(definition(migration, 'get_conversations'), /'friends_only_locked', false/);
  assert.match(definition(migration, 'get_conversation_messages'), /'can_block', false, 'anonymous_enabled', true/);
  assert.match(messages, /conv\.anonymous_enabled \|\| conv\.can_block === false/);
  assert.match(messages, /r\.can_block === false/);
  assert.match(messages, /f\.can_block === false/);
  assert.match(messages, /const canBlock = profile\.can_block !== false/);
});
