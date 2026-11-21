import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('anonymous sessions serialize sends with shutdown and delete session records for both people', () => {
  const migration = read('database/migrations/20261122_165_anonymous_chat.sql');
  const schema = read('database/schema.sql');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')), 'Schema baseline must include the migration');
  assert.match(migration, /where id = new\.conversation_id for share/);
  assert.match(migration, /where id = p_conversation_id for update/);
  assert.match(migration, /delete from public\.messages\s+where conversation_id = v_conv\.id and anonymous_session_id = v_conv\.anonymous_session_id/);
  assert.match(migration, /delete from public\.notifications n using public\.messages m/);
  assert.match(migration, /new\.actor_id := null/);
  assert.match(migration, /get_conversation_messages_unmasked/);
  assert.match(migration, /search_conversation_messages_unmasked/);
});

test('anonymous identity and theme are shared across chat and preview surfaces', () => {
  const messages = read('js/messages.js');
  const css = read('css/app.css');
  const avatar = read('assets/anonymous-avatar.svg');
  assert.match(messages, /set_anonymous_chat/);
  assert.match(messages, /End anonymous mode\?/);
  assert.match(messages, /conv\.anonymous_enabled \? 'anonymous'/);
  assert.match(messages, /assets\/anonymous-avatar\.svg/);
  assert.match(messages, /conv\.anonymous_enabled \? '' : userBadgesHtml\(conv\)/);
  assert.match(css, /data-chat-theme="anonymous"/);
  assert.match(avatar, /<svg[\s\S]*Anonymous profile/);
});
