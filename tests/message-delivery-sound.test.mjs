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

test('message alerts use a custom audible channel and typing cue lasts over half a second', () => {
  const receiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const activity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const core = read('js/core.js');
  const wav = readFileSync(new URL('../android/app/src/main/res/raw/myipon_message.wav', import.meta.url));
  assert.match(receiver, /MESSAGE_CHANNEL_ID = "myipon_messages_v2"/);
  assert.match(receiver, /messageChannel\.setSound\(messageSoundUri\(context\)/);
  assert.match(activity, /setMediaPlaybackRequiresUserGesture\(false\)/);
  assert.match(core, /kind === 'msg-typing'[\s\S]*?start: 0\.39, duration: 0\.34/);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.ok((wav.length - 44) / (wav.readUInt32LE(28)) > 0.6);
  assert.ok(wav.subarray(44).some((sample) => sample !== 0));
});
