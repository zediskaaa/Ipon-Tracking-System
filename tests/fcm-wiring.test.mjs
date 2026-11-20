import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android registers direct FCM tokens and sends visible alerts with topic fallback', () => {
  const plugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const service = read('android/app/src/main/java/com/myipon/app/MyIponMessagingService.java');
  const poll = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const core = read('js/core.js');
  const migration = read('database/migrations/20261120_134_fcm_device_tokens.sql');
  const sender = read('supabase/functions/send-push/index.ts');
  assert.match(plugin, /FirebaseMessaging\.getInstance\(\)\.getToken\(\)/);
  assert.match(plugin, /call\.reject\(error != null/);
  assert.match(core, /rpc\('register_notification_device_token'/);
  assert.match(core, /if \(!native\?\.fcmToken\) throw new Error/);
  assert.match(core, /if \(!registered\) throw new Error/);
  assert.match(migration, /references public\.notification_feed_tokens\(token\) on delete cascade/);
  assert.match(migration, /where user_id = auth\.uid\(\)/);
  assert.match(sender, /\.from\('notification_device_tokens'\)/);
  assert.match(sender, /deviceTokens\.map\(\(token\) => sendFcm\(\{ token \}\)\)/);
  assert.match(sender, /if \(!fcmSent\) fcmSent = await sendFcm\(\{ topic: `notif-\$\{feedRow\.token\}` \}\)/);
  assert.match(sender, /const isMessage = \['SOCIAL_NEW_MESSAGE', 'SOCIAL_MESSAGE_REPLY', 'SOCIAL_MESSAGE_REQUEST'\]\.includes\(notifType\)/);
  assert.match(sender, /\.\.\.\(isMessage \? \{\} : \{ notification: \{/);
  assert.match(sender, /notification: \{ channel_id: 'myipon_alerts', icon: 'ic_stat_myipon', tag: notificationTag \}/);
  assert.match(sender, /\.\.\.\(isMessage \? \{\} : \{ notification: \{ channel_id: 'myipon_alerts'/);
  assert.match(poll, /row\.optString\("actor_avatar_url", ""\)/);
  assert.match(poll, /builder\.setLargeIcon\(avatarBitmap\)/);
  assert.match(service, /message\.getNotification\(\)/);
  assert.match(poll, /notify\(tag, 0, builder\.build\(\)\)/);
  assert.match(plugin, /subscribeToTopic\("notif-" \+ feedToken\)/);
  assert.match(plugin, /unsubscribeFromTopic\("notif-" \+ previousFeedToken\)/);
  assert.match(plugin, /unsubscribeFromTopic\("notif-" \+ feedToken\)/);
  assert.match(sender, /account\.project_id !== 'myipon-29788'/);
  assert.match(service, /NotificationPollReceiver\.pollWithWakeLock\(this\)/);
  assert.match(service, /NotificationPollReceiver\.hasNotificationPermission\(this\)/);
});
