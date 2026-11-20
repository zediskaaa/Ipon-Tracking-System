import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');

test('conversation privacy is shared, role guarded, and forwarding is rejected at the database', () => {
  const sql = read('database/migrations/20261121_143_conversation_capture_and_forwarding.sql');
  const schema = read('database/schema.sql');
  for (const source of [sql, schema]) {
    assert.match(source, /block_screenshots boolean not null default false/);
    assert.match(source, /block_forwarding boolean not null default false/);
    assert.match(source, /public\.is_conversation_member\(v_conv\.id, v_uid\)/);
    assert.match(source, /role in \('OWNER', 'ADMIN'\)/);
    assert.match(source, /source\.id = new\.forwarded_from_id and c\.block_forwarding/);
    assert.match(source, /' took a screenshot\.', 'SYSTEM'/);
    assert.match(source, /notify pgrst, 'reload schema'/);
  }
});

test('Android capture callback and secure flag are scoped to the active chat', () => {
  const activity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const chat = read('js/messages.js');
  assert.match(manifest, /android\.permission\.DETECT_SCREEN_CAPTURE/);
  assert.match(activity, /Build\.VERSION\.SDK_INT >= 34[\s\S]*registerScreenCaptureCallback/);
  assert.match(activity, /unregisterScreenCaptureCallback\(screenCaptureCallback\)/);
  assert.match(activity, /WindowManager\.LayoutParams\.FLAG_SECURE/);
  assert.match(chat, /record_conversation_screenshot/);
  assert.match(chat, /data-chat-protection="screenshots"/);
  assert.match(chat, /data-chat-protection="forwarding"/);
  assert.match(chat, /state\.activeThread\?\.conversation\?\.block_forwarding/);
  assert.match(chat, /error\?\.code === 'PGRST202'[\s\S]*return null/);
  assert.match(chat, /data\.conversation\.protection_unavailable = !protection/);
  assert.match(chat, /!conv\.protection_unavailable && !state\.savingProtection && \(!isGrp \|\| canManageGroup\)/);
  assert.match(chat, /role="switch" data-chat-protection="screenshots" aria-checked=/);
  assert.match(chat, /role="switch" data-chat-protection="forwarding" aria-checked=/);
  assert.match(chat, /data-chat-protection-retry/);
  assert.match(chat, /<div class="msg-privacy-head"><h4 id="msg-privacy-title">Chat privacy<\/h4><\/div>/);
  assert.match(chat, /previousScrollTop[\s\S]*drawer\.dataset\.conversationId = conv\.conversation_id;[\s\S]*\.scrollTop = previousScrollTop/);
  assert.match(chat, /data-chat-protection="\$\{setting\}"\]`\)\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(chat, /state\.savingProtection = true;[\s\S]*set_conversation_protection[\s\S]*finally \{[\s\S]*state\.savingProtection = false/);
  const css = read('css/app.css');
  assert.match(css, /\.msg-privacy-card \{/);
  assert.match(css, /html\[data-theme="dark"\] \.msg-privacy-card \{/);
  assert.match(css, /\.msg-privacy-switch:focus-visible/);
});
