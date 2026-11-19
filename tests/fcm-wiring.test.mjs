import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('FCM wake uses the existing per-user feed topic without exposing its token in the payload', () => {
  const plugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const service = read('android/app/src/main/java/com/myipon/app/MyIponMessagingService.java');
  const sender = read('supabase/functions/send-push/index.ts');
  assert.match(plugin, /subscribeToTopic\("notif-" \+ feedToken\)/);
  assert.match(plugin, /unsubscribeFromTopic\("notif-" \+ previousFeedToken\)/);
  assert.match(plugin, /unsubscribeFromTopic\("notif-" \+ feedToken\)/);
  assert.match(sender, /topic: `notif-\$\{feedRow\.token\}`/);
  assert.match(sender, /account\.project_id !== 'myipon-29788'/);
  assert.match(service, /NotificationPollReceiver\.pollWithWakeLock\(this\)/);
  assert.match(service, /NotificationPollReceiver\.hasNotificationPermission\(this\)/);
});
