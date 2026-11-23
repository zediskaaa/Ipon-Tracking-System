import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Android MainActivity shows connecting state and slow/offline dialog instead of blank screen on weak internet', async () => {
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const prepareMobile = read('scripts/prepare-mobile.mjs');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const serviceWorker = read('sw.js');

  // Native overlay setup & cleanup in MainActivity.java
  assert.match(mainActivity, /setupStartupConnectionOverlay\(webView\)/);
  assert.match(mainActivity, /connectionMonitorHandler\.removeCallbacksAndMessages\(null\)/);
  assert.match(mainActivity, /"Connecting to myIPON"/);
  assert.match(mainActivity, /"Slow or unstable internet"/);
  assert.match(mainActivity, /"No internet connection"/);
  assert.match(mainActivity, /"Keep waiting"/);
  assert.match(mainActivity, /"Try again"/);
  assert.match(mainActivity, /reloadAfterConnectionIssue\(webView\)/);
  assert.match(mainActivity, /hasInternetConnection\(\)/);

  // Offline fallback copy explains offline & slow connection clearly
  assert.match(prepareMobile, /<h1>You appear to be offline<\/h1>/);
  assert.match(prepareMobile, /offline or too slow to reach myIPON/i);

  // In-app loader surfaces slow connection hint & Retry action
  assert.match(coreJs, /id="app-loader-slow-box"/);
  assert.match(coreJs, /id="app-loader-retry"/);
  assert.match(coreJs, /Your connection is slow right now\. Still waiting for a response/);
  assert.match(css, /\.loader-slow-box\s*\{/);
  assert.match(css, /\.loader-slow-hint\s*\{/);

  // Repeat visits use cached static assets, while navigations still check the network.
  assert.match(serviceWorker, /const isStaticAsset = \/\\\.\(\?:css\|js\|json/);
  assert.match(serviceWorker, /isStaticAsset \? caches\.match\(request\) : Promise\.resolve\(null\)/);
  assert.match(serviceWorker, /isHtmlRequest \? new Request\(request, \{ cache: 'no-store' \}\) : request/);

  const listeners = new Map();
  let fetchCalls = 0;
  const response = { ok: true, type: 'basic', clone() { return this; } };
  const context = {
    URL,
    Request: class { constructor(request) { Object.assign(this, request); } },
    Promise,
    fetch: async () => { fetchCalls += 1; return response; },
    caches: {
      match: async (request) => request.url.includes('/js/core.js') ? response : null,
      open: async () => ({ addAll: async () => { }, put: async () => { } }),
      keys: async () => [], delete: async () => true
    },
    self: {
      location: { hostname: 'my-ipon.vercel.app', protocol: 'https:', origin: 'https://my-ipon.vercel.app' },
      addEventListener(type, handler) { listeners.set(type, handler); }
    }
  };
  vm.runInNewContext(serviceWorker, context, { filename: 'sw.js' });
  const runFetch = async (url) => {
    let result;
    listeners.get('fetch')({ request: { method: 'GET', url }, respondWith(value) { result = value; } });
    await result;
  };
  await runFetch('https://my-ipon.vercel.app/js/core.js?v=1');
  assert.equal(fetchCalls, 0, 'cached static assets must not wait for the network');
  await runFetch('https://my-ipon.vercel.app/dashboard.html');
  assert.equal(fetchCalls, 1, 'HTML navigations must still check the network');
});

test('slow or offline startup with a saved session keeps splash retry screen instead of flashing Sign In, and core.js never kicks to login on transient network errors', async () => {
  const loginHtml = read('login.html');
  const authJs = read('js/auth.js');
  const coreJs = read('js/core.js');

  assert.match(loginHtml, /id="app-splash-status"[^>]*hidden/);
  assert.match(loginHtml, /id="app-splash-retry"[^>]*>Try again</);
  assert.match(loginHtml, /id="app-splash-signin"[^>]*>Use Sign In</);
  assert.match(coreJs, /function hasStoredAuthToken\(\)/);
  assert.match(coreJs, /if \(error && \(navigator\.onLine === false \|\| isTransientConnectionError\(error\)\)\) return;/);
  assert.match(coreJs, /refreshed\?\.error && options\.requireAuth !== false && navigator\.onLine !== false && !isTransientConnectionError\(refreshed\.error\)/);

  // Runtime test of login.html splash retention & recovery when a saved Supabase token exists
  const makeEl = (id = '') => {
    const cls = new Set();
    const attrs = new Map();
    const listeners = new Map();
    return {
      id,
      hidden: id === 'app-splash-status' || id === 'app-splash-actions',
      disabled: false,
      open: false,
      value: '',
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (x, f) => (f === undefined ? (cls.has(x) ? cls.delete(x) : cls.add(x)) : (f ? cls.add(x) : cls.delete(x))),
        contains: (x) => cls.has(x)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      addEventListener: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
      removeEventListener() { },
      _emit: (ev) => Promise.all((listeners.get(ev) || []).map((fn) => fn({ preventDefault() { } }))),
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() { },
      reset() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { els.delete(id); },
      after() { },
      setCustomValidity() { }
    };
  };

  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  for (const id of ['app-splash', 'app-splash-status', 'app-splash-status-text', 'app-splash-actions', 'app-splash-retry', 'app-splash-signin', 'auth-form', 'auth-message', 'auth-submit']) {
    getEl(id);
  }

  let initCall = 0;
  let resolveFirstInit;
  const redirects = [];
  const winListeners = new Map();
  const timers = [];
  const storage = { 'sb-demo-auth-token': JSON.stringify({ refresh_token: 'rt_valid_123', access_token: 'at_123' }) };

  const win = {
    location: { href: 'https://my-ipon.vercel.app/login.html?app=1', search: '?app=1', pathname: '/login.html', hash: '', replace: (u) => redirects.push(u) },
    navigator: { onLine: true, standalone: true, userAgent: 'Android' },
    localStorage: new Proxy(storage, {
      get: (target, prop) => {
        if (prop === 'getItem') return (k) => (Object.prototype.hasOwnProperty.call(target, k) ? target[k] : null);
        if (prop === 'setItem') return (k, v) => { target[k] = String(v); };
        if (prop === 'removeItem') return (k) => { delete target[k]; };
        return target[prop];
      }
    }),
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    matchMedia: () => ({ matches: true, addEventListener() { } }),
    addEventListener: (ev, fn) => { if (!winListeners.has(ev)) winListeners.set(ev, []); winListeners.get(ev).push(fn); },
    removeEventListener() { },
    Ipon: {
      init: () => {
        initCall += 1;
        if (initCall === 1) return new Promise((resolve) => { resolveFirstInit = resolve; });
        return Promise.resolve({
          configured: true,
          session: { user: { id: 'u1', email: 'member@example.com' } },
          profile: { id: 'u1', role: 'MEMBER', status: 'ACTIVE', first_name: 'Ana', last_name: 'Cruz' }
        });
      },
      setLoading() { },
      setBusy() { },
      homeForRole: (r) => (r === 'SUPER_ADMIN' ? 'super-admin.html' : 'dashboard.html'),
      accountSetupUrl: () => '',
      friendlyError: (e) => e?.message || 'Error',
      getDeviceToken: () => 'dev_1',
      toast() { },
      bindPasswordStrength: () => ({ element: makeEl('pw-strength'), update() { } }),
      setFieldError() { },
      getValidationMessage: () => '',
      nameRuleForField: () => ({}),
      normalizeNamePart: (s) => String(s || '').trim()
    }
  };
  win.window = win;

  const doc = {
    body: makeEl('body'),
    documentElement: makeEl('html'),
    getElementById: (id) => (els.has(id) ? els.get(id) : (id === 'app-splash' ? null : getEl(id))),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() { },
    removeEventListener() { }
  };

  vm.runInNewContext(authJs, {
    window: win, Ipon: win.Ipon, document: doc, location: win.location, navigator: win.navigator,
    localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    URL, URLSearchParams,
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    setInterval: () => 0, clearInterval() { }, console
  });

  // 1. After 5s slow network, splash stays visible (not hidden!) and shows slow-connection message instead of Sign In page
  const safetyTimer = timers.find((t) => t.ms === 5000 && !t.cleared);
  assert.ok(safetyTimer, 'Expected 5s splash safety timer');
  safetyTimer.fn();
  assert.equal(getEl('app-splash').classList.contains('is-hidden'), false, 'Splash must NOT reveal Sign In page while saved session exists');
  assert.equal(getEl('app-splash-status').hidden, false);
  assert.match(getEl('app-splash-status-text').textContent, /Connection is slow/i);

  // 2. If startup init fails due to timeout/network error, splash STILL stays visible with saved-session notice + Try again
  resolveFirstInit({ failed: true, configured: true, error: new Error('The connection timed out.') });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(getEl('app-splash').classList.contains('is-hidden'), false, 'Failed startup with saved session must keep splash visible');
  assert.equal(getEl('app-splash-actions').hidden, false);
  assert.match(getEl('app-splash-status-text').textContent, /session is still saved/i);
  assert.equal(redirects.length, 0);

  // 3. Clicking Try again retries init and redirects straight into dashboard.html without showing Sign In
  await getEl('app-splash-retry')._emit('click');
  await new Promise((r) => setTimeout(r, 10));
  const waitTimers = timers.filter((t) => !t.cleared && t.ms > 0 && t.ms <= 300);
  for (const t of waitTimers) { t.cleared = true; t.fn(); }
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(redirects, ['dashboard.html']);
});

test('My Profile modal pre-fills instantly from cached profile, syncs in parallel, and stays fully visible and clickable while syncing', () => {
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  assert.doesNotMatch(css, /\.account-dialog\[aria-busy="true"\]\s+\.account-dialog-content\s*\{[^}]*pointer-events:\s*none/, 'Account modal must not freeze clicks or dim content while syncing');
  assert.match(css, /\.account-dialog\[aria-busy="true"\]::after\s*\{[^}]*pointer-events:\s*none;[^}]*animation:\s*accountSyncShimmer/, 'Account modal should show a non-blocking top shimmer bar while syncing');
  assert.match(coreJs, /function hydrateAccountDialogFields\(data, payoutSource = data, \{ preserveDirty = false \} = \{\}\)/);
  assert.match(coreJs, /async function openAccountDialog\(\)\s*\{[\s\S]*?hydrateAccountDialogFields\(currentProfile, currentProfile, \{ preserveDirty: false \}\);[\s\S]*?dialog\.showModal\(\);[\s\S]*?loadAccountDialog\(\{ preserveDirty: true \}\)/);
  assert.match(coreJs, /const \[profileRes, appearance\] = await Promise\.all\(\[/, 'loadAccountDialog must parallelize profile, appearance, and effects requests');
});
