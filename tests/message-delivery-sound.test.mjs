import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android message display acknowledges only the matching recipient and conversation', () => {
  const sql = read('database/migrations/20261120_135_message_notification_delivery_ack.sql');
  const schema = read('database/schema.sql');
  const receiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  assert.match(sql, /ft\.user_id = n\.recipient_id and ft\.token = p_token/);
  assert.match(sql, /mr\.user_id = ft\.user_id/);
  assert.match(sql, /m\.conversation_id::text = substring\(n\.link from/);
  assert.match(sql, /m\.created_at <= n\.created_at/);
  assert.match(sql, /mr\.delivered_at is null/);
  assert.match(schema, /create or replace function public\.ack_message_notifications_by_token\(/);
  assert.match(receiver, /showDirectNotification\(appContext, id, dedupeKey, type, title, body, link, avatarUrl\)/);
  assert.match(receiver, /acknowledgeMessageDelivery\(supabaseUrl, anonKey, feedToken, ackIds\)/);
  assert.match(receiver, /channel\.getImportance\(\) == NotificationManager\.IMPORTANCE_NONE\) continue/);
});

test('message alerts use a custom audible channel, typing cue echoes with fading tail over 2s, and typing indicator stays docked visible', () => {
  const receiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const activity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const core = read('js/core.js');
  const messages = read('js/messages.js');
  const css = read('css/app.css');
  const wav = readFileSync(new URL('../android/app/src/main/res/raw/myipon_message.wav', import.meta.url));
  assert.match(receiver, /MESSAGE_CHANNEL_ID = "myipon_messages_v2"/);
  assert.match(receiver, /messageChannel\.setSound\(messageSoundUri\(context\)/);
  assert.match(activity, /setMediaPlaybackRequiresUserGesture\(false\)/);
  assert.match(core, /kind === 'msg-typing'[\s\S]*?lp\.frequency\.exponentialRampToValueAtTime\(860,\s*ctx\.currentTime \+ 2\.05\)[\s\S]*?start: 0\.39, duration: 0\.34[\s\S]*?start: 1\.60, duration: 0\.48, gain: 0\.009/);
  const typingBlock = core.match(/if \(kind === 'msg-typing'\) \{[\s\S]*?return;\s*\}/)?.[0] || '';
  const gains = [...typingBlock.matchAll(/gain:\s*(0\.\d+)/g)].map((m) => Number(m[1]));
  assert.ok(gains.length >= 6, `Expected multi-tap echo sequence, got ${gains.length} taps`);
  for (let i = 1; i < gains.length; i += 1) {
    assert.ok(gains[i] < gains[i - 1], `Expected fading echo gains (index ${i}: ${gains[i]} < ${gains[i - 1]})`);
  }
  assert.match(messages, /<div class="msg-messages-list" id="msg-messages-list"[^>]*><\/div>\s*<\/div>\s*<div class="msg-typing-live" id="msg-typing-live"[\s\S]*?<div class="msg-typing-live-row">/);
  assert.match(messages, /typingScrollRafId = requestAnimationFrame\(step\)/);
  assert.match(css, /\.msg-thread-stage\s*\{[^}]*--msg-gutter-x:\s*18px;[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+auto;/s);
  assert.match(css, /\.msg-row-avatar\s*\{[^}]*width:\s*30px;[^}]*display:\s*flex;[^}]*align-items:\s*flex-end;/s);
  assert.match(css, /\.msg-typing-live-row\s*\{[^}]*gap:\s*8px;[^}]*padding:\s*4px var\(--msg-gutter-x,\s*18px\) 8px;[^}]*transform:\s*translate3d\(0,\s*12px,\s*0\);/s);
  assert.match(css, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.msg-thread-stage\s*\{\s*--msg-gutter-x:\s*14px;\s*\}/);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.ok((wav.length - 44) / (wav.readUInt32LE(28)) > 0.6);
  assert.ok(wav.subarray(44).some((sample) => sample !== 0));
});
