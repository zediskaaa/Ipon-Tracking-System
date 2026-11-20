import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('notification and message badges float outside top-right corners in coral-red pill style and cap at 99+', () => {
  const appCss = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  const coreJs = read('js/core.js');

  // Dashboard desktop message & notification buttons position <b> outside top-right corner (never inside)
  assert.match(heroCss, /\.group-bar-notify-btn\s*\{[^}]*overflow:\s*visible/);
  assert.match(heroCss, /\.group-bar-notify-btn b\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-7px;[^}]*right:\s*-7px;[^}]*background:\s*#e53935;[^}]*color:\s*#ffffff/);
  assert.match(heroCss, /\.group-bar-msg-btn\s*\{[^}]*overflow:\s*visible/);
  assert.match(heroCss, /\.group-bar-msg-btn b,\s*\.group-bar-msg-btn \.notification-badge\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-7px;[^}]*right:\s*-7px;[^}]*background:\s*#e53935;[^}]*color:\s*#ffffff/);
  assert.match(heroCss, /\.dashboard-sidebar \.sidebar-utility b\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-6px;[^}]*right:\s*-6px;[^}]*background:\s*#e53935;[^}]*color:\s*#ffffff/);

  // Shared app.css desktop, mobile, and Messages modal badges float outside top-right in coral-red
  assert.match(appCss, /\.sidebar-utility\s*\{[^}]*overflow:\s*visible/);
  assert.match(appCss, /\.sidebar-utility b\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-7px;[^}]*right:\s*-7px;[^}]*background:\s*#e53935;[^}]*color:\s*#ffffff/);
  assert.match(appCss, /\.sidebar-utility\[data-messages-open\] b,\s*\.sidebar-utility\[data-messages-open\] \.notification-badge\s*\{[^}]*top:\s*-7px;[^}]*right:\s*-7px;[^}]*background:\s*#e53935/);
  assert.match(appCss, /\.msg-icon-btn\s*\{[^}]*overflow:\s*visible/);
  assert.match(appCss, /\.msg-icon-btn b\s*\{[^}]*position:\s*absolute;[^}]*top:\s*-6px;[^}]*right:\s*-6px;[^}]*background:\s*#e53935;[^}]*color:\s*#ffffff/);

  // Both notification and message badge counts cap at 99+
  assert.match(coreJs, /function syncNotificationBadges[\s\S]*?badge\.textContent = count > 99 \? '99\+' : String\(count\)/);
  assert.match(coreJs, /data-notification-count\$\{cachedUnread > 0 \? '' : ' hidden'\}>\$\{cachedUnread > 99 \? '99\+' : cachedUnread\}/);
});

test('Android chat notifications never emit app-logo LocalNotifications duplicates and always render circular sender DP via native pipeline', () => {
  const coreJs = read('js/core.js');
  const pollJava = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const pluginJava = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const fcmService = read('android/app/src/main/java/com/myipon/app/MyIponMessagingService.java');
  const sendPush = read('supabase/functions/send-push/index.ts');

  // core.js prefers BackgroundNotifications.showNotification and never falls back to LocalNotifications.schedule for chat messages on Android
  const dispatchBlock = coreJs.match(/async function dispatchDeviceNotification[\s\S]*?^  \}/m)?.[0] || '';
  assert.ok(dispatchBlock, 'Expected dispatchDeviceNotification in js/core.js');
  assert.match(dispatchBlock, /if \(bgPlugin\?\.showNotification\)/);
  assert.match(dispatchBlock, /markDeviceNotificationShown\(userId, notifKey, \{ syncNative: false \}\)/);
  assert.match(dispatchBlock, /await bgPlugin\.showNotification\(\{/);
  assert.match(dispatchBlock, /if \(isMsgNotif && hasNativeNotificationBridge\(\)\)\s*\{[\s\S]*?return;/);

  // Native Java serializes direct alerts with pollSync on POLL_EXECUTOR and routes FCM message alerts through sender avatar pipeline
  assert.match(pollJava, /public static boolean isMessageNotification\(/);
  assert.match(pollJava, /public static void showDirectNotificationAsync\(/);
  assert.match(pluginJava, /public void showNotification\(PluginCall call\)/);
  assert.match(pluginJava, /NotificationPollReceiver\.showDirectNotificationAsync\(/);
  assert.match(fcmService, /if \(NotificationPollReceiver\.isMessageNotification\(notifType, dedupeKey, title\)\)\s*\{\s*NotificationPollReceiver\.pollWithWakeLock\(this\);/);
  assert.match(sendPush, /notification_type:\s*notifType/);
  assert.match(sendPush, /actor_avatar_url:\s*actorAvatarUrl \|\| ''/);
});
