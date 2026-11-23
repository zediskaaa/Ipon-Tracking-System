import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function createCoreVm(fakeClient) {
  const listeners = { window: new Map(), document: new Map() };
  const addListener = (bucket, type, fn, opts) => {
    if (!bucket.has(type)) bucket.set(type, new Set());
    bucket.get(type).add({ fn, once: Boolean(opts?.once) });
  };
  const removeListener = (bucket, type, fn) => {
    const set = bucket.get(type);
    if (!set) return;
    for (const item of set) {
      if (item.fn === fn) set.delete(item);
    }
  };
  const dispatch = (bucket, type, event = { type }) => {
    const set = bucket.get(type);
    if (!set) return;
    for (const item of [...set]) {
      if (item.once) set.delete(item);
      item.fn(event);
    }
  };

  let fakeNow = 1_000_000;
  let nextTimerId = 1;
  const timers = new Map();
  const fakeSetTimeout = (fn, delay = 0) => {
    const id = nextTimerId++;
    timers.set(id, { fn, delay });
    return id;
  };
  const fakeClearTimeout = (id) => { timers.delete(id); };
  const flushTimers = () => {
    const batch = [...timers.entries()];
    timers.clear();
    for (const [, entry] of batch) entry.fn();
  };

  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      toggle: (c, force) => (force === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (force ? set.add(c) : set.delete(c))),
      add: (...cs) => cs.forEach((c) => set.add(c)),
      remove: (...cs) => cs.forEach((c) => set.delete(c)),
      contains: (c) => set.has(c)
    };
  };
  const makeEl = (tag = 'div') => ({
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    dataset: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: makeClassList(),
    setAttribute() {},
    removeAttribute() {},
    getAttribute: () => null,
    appendChild(child) { return child; },
    remove() {},
    insertAdjacentHTML() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  });
  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: makeClassList() },
    body: {
      dataset: { page: 'dashboard' },
      classList: makeClassList(['security-page']),
      insertAdjacentHTML() {},
      appendChild(child) { return child; },
      prepend(child) { return child; }
    },
    activeElement: null,
    hasFocus: () => true,
    createElement: (tag) => makeEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn, opts) => addListener(listeners.document, type, fn, opts),
    removeEventListener: (type, fn) => removeListener(listeners.document, type, fn)
  };

  const sandbox = {
    window: null,
    document: doc,
    navigator: { onLine: true, userAgent: 'Mozilla/5.0' },
    location: { href: 'https://my-ipon.vercel.app/dashboard.html', origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console,
    URL,
    URLSearchParams,
    Date: class FakeDate extends Date {
      constructor(...args) { super(...(args.length ? args : [fakeNow])); }
      static now() { return fakeNow; }
    },
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'eyJfake-anon-key-for-tests' },
    supabase: { createClient: () => fakeClient }
  };
  sandbox.window = sandbox;
  sandbox.addEventListener = (type, fn, opts) => addListener(listeners.window, type, fn, opts);
  sandbox.removeEventListener = (type, fn) => removeListener(listeners.window, type, fn);
  sandbox.globalThis = sandbox;

  vm.runInNewContext(read('js/core.js'), sandbox, { filename: 'js/core.js' });
  return {
    Ipon: sandbox.Ipon,
    doc,
    advanceTime: (ms) => { fakeNow += ms; },
    flushTimers,
    pendingTimers: () => timers.size,
    dispatchWindow: (type, event = { type }) => dispatch(listeners.window, type, event),
    dispatchDoc: (type, event = { type }) => dispatch(listeners.document, type, event)
  };
}

test('subscribeToChanges registers one event:* listener per deduplicated table, ignores DELETE, throttles clean resume, and cleans up on pagehide', async () => {
  const registered = [];
  const removed = [];
  const channel = {
    topic: 'realtime:live:dashboard:session',
    on(kind, filter, cb) {
      registered.push({ kind, filter, cb });
      return channel;
    },
    subscribe() { return channel; }
  };
  const fakeClient = {
    getChannels: () => [],
    channel: () => channel,
    removeChannel: async (ch) => { removed.push(ch); }
  };

  const env = createCoreVm(fakeClient);
  let refreshCount = 0;
  env.Ipon.subscribeToChanges('dashboard', ['contributions', 'contributions', 'expenses', 'announcements'], async () => {
    refreshCount += 1;
  });

  // Deduplicated 3 unique tables -> 3 single event:'*' subscriptions (not 6 or 8)
  assert.equal(registered.length, 3);
  assert.deepEqual(registered.map((r) => ({ event: r.filter.event, schema: r.filter.schema, table: r.filter.table })), [
    { event: '*', schema: 'public', table: 'contributions' },
    { event: '*', schema: 'public', table: 'expenses' },
    { event: '*', schema: 'public', table: 'announcements' }
  ]);

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  // DELETE payload is ignored in JS without triggering refresh
  registered[0].cb({ eventType: 'DELETE' });
  assert.equal(env.pendingTimers(), 0);
  env.flushTimers();
  await settle();
  assert.equal(refreshCount, 0);

  // INSERT payload triggers refresh
  registered[0].cb({ eventType: 'INSERT' });
  assert.equal(env.pendingTimers(), 1);
  env.flushTimers();
  await settle();
  assert.equal(refreshCount, 1);

  // Clean focus event within 30s cooldown does NOT trigger a redundant reload
  env.advanceTime(5_000);
  env.dispatchWindow('focus', { type: 'focus' });
  assert.equal(env.pendingTimers(), 0);

  // Explicit 'online' recovery bypasses cooldown immediately
  env.dispatchWindow('online', { type: 'online' });
  assert.equal(env.pendingTimers(), 1);
  env.flushTimers();
  await settle();
  assert.equal(refreshCount, 2);

  // Clean focus after >= 30s refreshes again
  env.advanceTime(31_000);
  env.dispatchWindow('focus', { type: 'focus' });
  assert.equal(env.pendingTimers(), 1);
  env.flushTimers();
  await settle();
  assert.equal(refreshCount, 3);

  // pagehide tears down channel cleanly
  env.dispatchWindow('pagehide', { type: 'pagehide' });
  assert.equal(removed.length, 1);
  assert.equal(removed[0], channel);
});

test('bindNotifications uses single announcements listener, 250ms burst debounce, 15s resume cooldown, and pagehide channel cleanup', () => {
  const coreJs = read('js/core.js');
  const start = coreJs.indexOf('let lastNotifResumeLoadAt = Date.now();');
  const end = coreJs.indexOf('function prepareResponsiveTables()', start);
  assert.ok(start > 0 && end > start, 'Expected optimized notification subscription block in js/core.js');
  const block = coreJs.slice(start, end);

  assert.match(block, /const scheduleNotifLoad = \(payload = null\) =>/);
  assert.match(block, /setTimeout\([\s\S]*?250\)/);
  assert.match(block, /Date\.now\(\) - lastNotifResumeLoadAt >= 15_000/);
  const annBindings = block.match(/table:\s*'announcements'/g) || [];
  assert.equal(annBindings.length, 1, 'notifChannel must bind announcements only once (event: *)');
  assert.match(block, /event:\s*'\*',\s*schema:\s*'public',\s*table:\s*'announcements'/);
  assert.match(block, /window\.addEventListener\('pagehide'[\s\S]*?client\.removeChannel\?\.\(notifChannel\)/);
  assert.match(block, /notifBc\?\.close\?\.\(\)/);
});

test('Android background sync backs off to 5 minutes on healthy WebSocket and eliminates duplicate alarm polls while keeping degraded fallback', () => {
  const syncService = read('android/app/src/main/java/com/myipon/app/NotificationSyncService.java');
  const pollReceiver = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');

  assert.match(syncService, /SAFETY_POLL_INTERVAL_MS\s*=\s*45_000L/);
  assert.match(syncService, /HEALTHY_WS_SAFETY_POLL_INTERVAL_MS\s*=\s*300_000L/);
  assert.match(syncService, /boolean healthyWs = wsConnected && socket != null && lastWsActivityElapsedMs > 0L && \(now - lastWsActivityElapsedMs\) < 60_000L;/);
  assert.match(syncService, /long safetyIntervalMs = healthyWs \? HEALTHY_WS_SAFETY_POLL_INTERVAL_MS : SAFETY_POLL_INTERVAL_MS;/);
  assert.match(syncService, /public static void pokeOrReconnect\(Context context, boolean triggerPollWhenHealthy\)/);

  assert.match(pollReceiver, /POLL_INTERVAL_MS\s*=\s*60_000L/);
  assert.match(pollReceiver, /HEALTHY_WS_POLL_INTERVAL_MS\s*=\s*300_000L/);
  assert.match(pollReceiver, /if \(NotificationSyncService\.isWsConnected\(\)\)\s*\{\s*return HEALTHY_WS_POLL_INTERVAL_MS;\s*\}/);
  assert.match(pollReceiver, /NotificationSyncService\.pokeOrReconnect\(appContext, false\)/);
  assert.match(pollReceiver, /if \(POLL_IN_FLIGHT\.get\(\) \|\| \(lastPoll > 0L && \(now - lastPoll\) < MIN_ALARM_POLL_GAP_MS\)\)/);
});

test('no active frontend or Android runtime callers invoke retired touch_user_last_seen RPC', () => {
  const runtimeFiles = [
    ...fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => path.join('js', f)),
    'sw.js',
    ...fs.readdirSync(path.join(root, 'android/app/src/main/java/com/myipon/app'))
      .filter((f) => f.endsWith('.java'))
      .map((f) => path.join('android/app/src/main/java/com/myipon/app', f))
  ];
  for (const rel of runtimeFiles) {
    const src = read(rel);
    assert.doesNotMatch(src, /touch_user_last_seen/, `Unexpected touch_user_last_seen reference in ${rel}`);
  }
});
