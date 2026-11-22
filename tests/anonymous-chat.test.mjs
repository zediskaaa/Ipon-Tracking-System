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

test('anonymous activation notices are removed and no longer expose names', () => {
  const migration = read('database/migrations/20261122_167_remove_anonymous_chat_notice.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /drop trigger if exists conversations_announce_anonymous_enabled/);
  assert.match(migration, /delete from public\.messages[\s\S]*metadata ->> 'event' = 'anonymous_enabled'/);
  assert.doesNotMatch(messages, /turned on anonymous chat/);
  assert.match(messages, /Hide names and DPs for \$\{isGrp/);
});

test('anonymous system notices, chat previews, and linked alerts hide real names', () => {
  const migration = read('database/migrations/20261122_168_anonymous_notice_privacy.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  const core = read('js/core.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /new\.message_type in \('SYSTEM', 'CALL_EVENT'\)[\s\S]*new\.body := 'Conversation update'/);
  assert.match(migration, /'\{last_message_preview\}'[\s\S]*'SYSTEM', 'CALL_EVENT'/);
  assert.match(migration, /'body', case when m ->> 'message_type' in \('SYSTEM', 'CALL_EVENT'\)/);
  assert.match(migration, /create trigger conversations_mask_anonymous_notifications/);
  assert.match(migration, /update public\.notifications n[\s\S]*c\.anonymous_session_id is not null/);
  assert.match(messages, /if \(conv\.anonymous_enabled\) \{\s*return `\$\{dateDivider\}\$\{unreadDivider\}<div class="msg-system-event"/);
  assert.match(messages, /const safeLastPreview = conv\.anonymous_enabled/);
  assert.doesNotMatch(messages, /id="msg-alerts-btn"|id="msg-view-alerts"/);
  assert.match(core, /anonymousChatNotice[\s\S]*assets\/anonymous-avatar\.svg/);
});

test('anonymous vanishing-message previews never include the sender name', () => {
  const migration = read('database/migrations/20261122_169_anonymous_vanishing_preview.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /last_message_preview' ~ ' set a message\\\.\$'/);
  assert.match(migration, /to_jsonb\('Vanishing message'::text\)/);
  assert.match(messages, /conv\.anonymous_enabled && \/ set a message\\\.\$\/\.test/);
});

test('group anonymous mode uses admin permission and masks member identities', () => {
  const migration = read('database/migrations/20261122_170_anonymous_group_chats.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /v_conv\.kind not in \('DIRECT', 'GROUP'\)/);
  assert.match(migration, /role in \('OWNER', 'ADMIN'\)/);
  assert.match(migration, /delete from public\.messages\s+where conversation_id = v_conv\.id and anonymous_session_id = v_conv\.anonymous_session_id/);
  assert.ok(migration.includes("jsonb_set(item, '{members_preview}', '[]'::jsonb)"));
  assert.match(migration, /'members', '\[\]'::jsonb/);
  assert.match(migration, /'seen_by', '\[\]'::jsonb/);
  assert.match(messages, /if \(conv\.anonymous_enabled\) return userAvatarHtml\(\{ anonymous_enabled: true \}/);
  assert.match(messages, /const membersSectionHtml = isGrp && !conv\.anonymous_enabled/);
  assert.match(messages, /conv\.anonymous_enabled \? 'You' : \(initializedProfile\?\.full_name/);
});

test('anonymous mode preserves null reply_preview without rendering ghost User Attachment quotes', () => {
  const migration = read('database/migrations/20261122_172_fix_anonymous_null_reply_preview.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /'reply_preview', case when jsonb_typeof\(m -> 'reply_preview'\) = 'object' then/);
  assert.doesNotMatch(migration, /m -> 'reply_preview' is not null/);
  assert.match(messages, /const hasReplyPreview = Boolean\(m\.reply_preview && typeof m\.reply_preview === 'object' && !Array\.isArray\(m\.reply_preview\) && m\.reply_preview\.id\);/);
});
