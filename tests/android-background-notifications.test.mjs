import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../android/app/src/main/java/com/myipon/app/NotificationSyncService.java', import.meta.url), 'utf8');
const section = (start, end) => service.slice(service.indexOf(start), service.indexOf(end, service.indexOf(start)));

test('background safety polling survives socket failure and reconnect', () => {
  const startup = section('public int onStartCommand', 'public void onTaskRemoved');
  assert.match(startup, /renewSyncWakeLock\(\);/);
  assert.match(startup, /handler\.postDelayed\(heartbeatRunnable, HEARTBEAT_INTERVAL_MS\)/);
  const heartbeat = section('private final Runnable heartbeatRunnable', 'private final Runnable reconnectRunnable');
  assert.match(heartbeat, /shouldRunInstantSync\(appContext\)/);
  assert.match(heartbeat, /renewSyncWakeLock\(\)/);
  assert.match(heartbeat, /NotificationPollReceiver\.pollAsync\(appContext\)/);
  assert.match(heartbeat, /handler\.postDelayed\(this, HEARTBEAT_INTERVAL_MS\)/);
  const socketLifecycle = section('private void connectSocket', 'private void registerNetworkObserver');
  assert.doesNotMatch(socketLifecycle, /(?:removeCallbacks|postDelayed)\(heartbeatRunnable/);
});

test('screen-off wake lock respects background permission, expires, and releases on shutdown', () => {
  const wake = section('private void renewSyncWakeLock', 'public void onCreate');
  assert.match(wake, /if \(!NotificationPollReceiver\.isBatteryOptimizationIgnored\(this\)\)\s*\{[\s\S]*?syncWakeLock\.release\(\);[\s\S]*?return;/);
  assert.match(wake, /PowerManager\.PARTIAL_WAKE_LOCK/);
  assert.match(wake, /setReferenceCounted\(false\)/);
  assert.match(wake, /syncWakeLock\.acquire\(90_000L\)/);
  const shutdown = section('public void onDestroy', 'public IBinder onBind');
  assert.match(shutdown, /removeCallbacks\(heartbeatRunnable\)/);
  assert.match(shutdown, /syncWakeLock != null && syncWakeLock\.isHeld\(\)\) syncWakeLock\.release\(\)/);
});

test('superseded socket callbacks cannot disable the replacement connection', () => {
  for (const callback of ['onOpen', 'onMessage', 'onFailure', 'onClosed']) {
    assert.match(service, new RegExp(`public void ${callback}\\([^\\n]+\\) \\{\\s*if \\(destroyed \\|\\| activeSocket != webSocket\\)`));
  }
  const closed = section('public void onClosed', 'private void registerNetworkObserver');
  assert.match(closed, /scheduleReconnect\(\)/);
  assert.doesNotMatch(closed, /code != 1000/);
});
