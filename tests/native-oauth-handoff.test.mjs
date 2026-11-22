import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function createAuthVmHarness({
  search = '?app=1',
  nativeAuth = null,
  capacitor = null,
  existingSession = null,
  initialProfile = { id: 'u-old', role: 'MEMBER', status: 'ACTIVE' },
  clerkToken = 'clerk.jwt.test-token',
  clerkSession = null,
  clerkRedirectError = null,
  clerkRedirectNavigates = false,
  clerkCallbackNoSession = false,
  clerkSessionAtLoad = false
} = {}) {
  const listeners = new Map();
  const docListeners = new Map();
  const storage = new Map();
  const sessionStore = new Map();
  const calls = {
    clerkLoadOpts: [],
    signInRedirect: [],
    signUpRedirect: [],
    handleRedirectCallback: [],
    accountFn: [],
    verifyOtp: [],
    locationReplace: [],
    locationAssign: [],
    openAuthBrowser: [],
    supabaseSignOut: []
  };
  if (capacitor && (nativeAuth || capacitor.Plugins?.BackgroundNotifications)) {
    const bg = capacitor.Plugins?.BackgroundNotifications || {};
    capacitor = {
      ...capacitor,
      Plugins: {
        ...capacitor.Plugins,
        BackgroundNotifications: {
          ...bg,
          openAuthBrowser: bg.openAuthBrowser || (async (opts) => { calls.openAuthBrowser.push(opts); })
        }
      }
    };
  }

  const makeEl = (id = '', tag = 'div') => {
    const elListeners = new Map();
    const classes = new Set();
    const attrs = new Map();
    const el = {
      id,
      tagName: tag.toUpperCase(),
      hidden: false,
      disabled: false,
      open: false,
      value: '',
      href: '',
      textContent: '',
      innerHTML: '',
      type: 'text',
      name: '',
      dataset: {},
      style: {},
      elements: {},
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      addEventListener: (ev, fn) => {
        if (!elListeners.has(ev)) elListeners.set(ev, []);
        elListeners.get(ev).push(fn);
      },
      dispatchEvent: (ev) => {
        (elListeners.get(ev?.type) || []).forEach((fn) => fn(ev));
      },
      click() {
        (elListeners.get('click') || []).forEach((fn) => fn({ currentTarget: el, preventDefault() { } }));
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      setCustomValidity() { },
      checkValidity: () => true,
      reportValidity: () => true,
      focus() { },
      select() { },
      after() { },
      reset() { },
      remove() { },
      showModal() { el.open = true; },
      close() { el.open = false; }
    };
    return el;
  };

  const els = new Map();
  const getEl = (id, tag = 'div') => {
    if (!els.has(id)) els.set(id, makeEl(id, tag));
    return els.get(id);
  };

  const googleBtn = getEl('signup-google-btn', 'button');
  googleBtn.dataset.clerkOauth = 'oauth_google';
  const googleLabel = makeEl('', 'span');
  googleLabel.textContent = 'Continue with Google';
  googleBtn.querySelector = (sel) => (sel === '.social-signup-label' ? googleLabel : null);

  const recoveryForm = getEl('recovery-request-form', 'form');
  recoveryForm.elements = { email: makeEl('recovery-email', 'input') };

  const doc = {
    visibilityState: 'visible',
    body: makeEl('body', 'body'),
    fonts: { ready: Promise.resolve() },
    getElementById: (id) => getEl(id),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '[data-clerk-oauth]' ? [googleBtn] : []),
    addEventListener: (ev, fn) => {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    }
  };

  const clerkListeners = [];
  const activeSession = clerkSession || {
    id: 'sess_123',
    getToken: async () => clerkToken
  };

  const clerkMock = {
    session: clerkSessionAtLoad ? activeSession : null,
    client: {
      signIn: {
        authenticateWithRedirect: async (opts) => {
          calls.signInRedirect.push(opts);
        }
      },
      signUp: {
        missingFields: [],
        authenticateWithRedirect: async (opts) => {
          calls.signUpRedirect.push(opts);
        }
      }
    },
    load: async (opts) => { calls.clerkLoadOpts.push(opts); return clerkMock; },
    signOut: async () => { clerkMock.session = null; },
    addListener: (fn) => { clerkListeners.push(fn); },
    handleRedirectCallback: async (opts) => {
      calls.handleRedirectCallback.push(opts);
      if (clerkRedirectError) throw clerkRedirectError;
      if (clerkRedirectNavigates) {
        calls.clerkLoadOpts[0].routerReplace(opts.signInForceRedirectUrl);
        return;
      }
      if (clerkCallbackNoSession) return;
      clerkMock.session = activeSession;
    }
  };

  const ctx = {
    window: null,
    document: doc,
    navigator: { standalone: false, userAgent: nativeAuth ? 'myIPONApp/20' : 'Chrome/130' },
    location: {
      href: `https://my-ipon.vercel.app/login.html${search}`,
      origin: 'https://my-ipon.vercel.app',
      pathname: '/login.html',
      search,
      hash: '',
      replace: (u) => calls.locationReplace.push(String(u)),
      assign: (u) => calls.locationAssign.push(String(u))
    },
    history: { replaceState() { } },
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k)
    },
    sessionStorage: {
      getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: (k) => sessionStore.delete(k)
    },
    matchMedia: () => ({ matches: false }),
    requestAnimationFrame: (fn) => { if (typeof fn === 'function') fn(); return 1; },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() { },
    crypto: globalThis.crypto,
    URL,
    URLSearchParams,
    Map,
    Set,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Math,
    Date,
    JSON,
    Promise,
    RegExp,
    Error,
    Event: class { constructor(type) { this.type = type; } },
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener() { },
    dispatchWindowEvent: (type, evObj = {}) => {
      const ev = { type, ...evObj };
      (listeners.get(type) || []).forEach((fn) => fn(ev));
    },
    dispatchDocEvent: (type, evObj = {}) => {
      const ev = { type, ...evObj };
      (docListeners.get(type) || []).forEach((fn) => fn(ev));
    },
    Clerk: clerkMock,
    IponNativeAuth: nativeAuth,
    Capacitor: capacitor,
    Ipon: {
      init: async () => ({
        configured: true,
        session: existingSession,
          profile: existingSession ? initialProfile : null
      }),
      client: {
        auth: {
          getSession: async () => ({ data: { session: existingSession } }),
          verifyOtp: async (opts) => {
            calls.verifyOtp.push(opts);
            return { data: { user: { id: 'u-new', email: 'user@example.com' }, session: { access_token: 'sb-tok' } }, error: null };
          },
          signOut: async () => { calls.supabaseSignOut.push(true); return {}; }
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'u-new', first_name: 'Juan', last_name: 'Cruz', role: 'MEMBER', status: 'ACTIVE', name_setup_required: false },
                error: null
              })
            })
          })
        })
      },
      setLoading() { },
      setBusy() { },
      toast() { },
      rpc: async () => ({}),
      fireKeepaliveRpc: () => true,
      broadcastAuthEvent() { },
      getDeviceToken: () => 'dev-tok-12345678901234567890',
      requiresMfaChallenge: async () => false,
      accountSetupUrl: () => '',
      homeForRole: () => 'dashboard.html',
      friendlyError: (e) => String(e?.message || e || 'Error'),
      bindPasswordStrength: () => ({ element: makeEl('pw-str', 'div') }),
      nameRuleForField: () => ({ ruleMsg: '', placeholder: '' }),
      nameValidationError: () => '',
      normalizeNamePart: (s) => String(s || '').trim(),
      passwordIssue: () => '',
      invokeAccountFunction: async (payload) => {
        calls.accountFn.push(payload);
        if (payload?.action === 'clerk-session-exchange') {
          return { ok: true, token_hash: 'sb-hash-123', email: 'user@example.com' };
        }
        return { ok: true };
      }
    },
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(read('js/auth.js'), ctx, { filename: 'js/auth.js' });
  return { ctx, doc, els, googleBtn, googleLabel, calls, storage, clerkMock };
}

test('Android native Google OAuth deep-link handoff contracts stay intact across Manifest, Java, HTML, and auth.js', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const bgPlugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const loginHtml = read('login.html');

  assert.match(manifest, /android:scheme="myipon"\s+android:host="auth-callback"/);
  assert.match(manifest, /android\.intent\.category\.BROWSABLE/);
  assert.match(bgPlugin, /public Boolean shouldOverrideLoad\(Uri url\)/);
  assert.match(bgPlugin, /android\.support\.customtabs\.extra\.SESSION/);
  assert.match(bgPlugin, /accounts\.google\.com/);
  assert.match(mainActivity, /addJavascriptInterface\(new AuthCallbackBridge\(\), "IponNativeAuth"\)/);
  assert.match(mainActivity, /public synchronized String consumePendingAuthCallback\(\)/);
  assert.match(bgPlugin, /public void consumeAuthCallback\(PluginCall call\)/);
  assert.match(bgPlugin, /public void openAuthBrowser\(PluginCall call\)/);
  assert.match(mainActivity, /handleAuthCallbackIntent\(getIntent\(\)\)/);
  assert.match(mainActivity, /handleAuthCallbackIntent\(intent\)/);
  assert.match(mainActivity, /dispatchWindowEvent\("myipon:native-resume"\)/);
  assert.match(mainActivity, /myipon:native-oauth-callback/);
  assert.match(mainActivity, /pendingAuthCallbackJson != null\) dispatchWindowEvent\("myipon:native-oauth-callback"\)/);
  assert.match(loginHtml, /id="clerk-app-handoff"/);
  assert.match(loginHtml, /id="clerk-app-handoff-btn"/);
  assert.match(loginHtml, /js\/auth\.js\?v=20261122-30/);
});

test('Android app Google login resets Connecting state when user backs out without finishing OAuth', async () => {
  let pendingCallback = '';
  const harness = createAuthVmHarness({
    search: '?app=1',
    nativeAuth: {
      isSupported: () => true,
      consumePendingCallback: () => {
        const val = pendingCallback;
        pendingCallback = '';
        return val;
      }
    },
    capacitor: { isNativePlatform: () => true }
  });

  harness.googleBtn.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.googleBtn.disabled, true);
  assert.equal(harness.googleLabel.textContent, 'Connecting…');
  assert.equal(harness.calls.openAuthBrowser.length, 1);
  assert.equal(harness.calls.signInRedirect.length, 0);
  assert.equal(harness.calls.clerkLoadOpts[0].signInForceRedirectUrl, undefined);
  assert.equal(harness.calls.clerkLoadOpts[0].signUpForceRedirectUrl, undefined);
  assert.match(harness.calls.openAuthBrowser[0].appState, /^[a-f0-9]{32}$/);
  assert.equal(harness.calls.openAuthBrowser[0].signup, false);

  // Simulate Android launching Custom Tab (blur/hidden), then user pressing Back (native-resume + visible + focus)
  harness.ctx.dispatchWindowEvent('blur');
  harness.doc.visibilityState = 'hidden';
  harness.ctx.dispatchDocEvent('visibilitychange');
  harness.doc.visibilityState = 'visible';
  harness.ctx.dispatchWindowEvent('myipon:native-resume');
  harness.ctx.dispatchDocEvent('visibilitychange');
  harness.ctx.dispatchWindowEvent('focus');

  await new Promise((r) => setTimeout(r, 320));
  assert.equal(harness.googleBtn.disabled, false, 'Google button must re-enable after returning via Back');
  assert.equal(harness.googleLabel.textContent, 'Continue with Google');
});

test('Android Google sign-in waits for the native callback bridge instead of signing into Chrome', async () => {
  const app = createAuthVmHarness({ capacitor: { isNativePlatform: () => true } });
  app.googleBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.calls.signInRedirect.length, 0);
  assert.match(app.els.get('social-signup-message').textContent, /App sign-in is still loading/);
  assert.equal(app.googleBtn.disabled, false);
});

test('External browser starts Google sign-in with the app handoff state', async () => {
  const browser = createAuthVmHarness({
    search: '?app=1&app_handoff=1&app_state=0123456789abcdef0123456789abcdef&start_google=1'
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(browser.calls.signInRedirect.length, 1);
  const callbackUrl = new URL(browser.calls.signInRedirect[0].redirectUrl);
  assert.equal(callbackUrl.searchParams.get('app_handoff'), '1');
  assert.equal(callbackUrl.searchParams.get('app_state'), '0123456789abcdef0123456789abcdef');
  assert.equal(callbackUrl.searchParams.get('start_google'), null);
});

test('Capacitor OAuth bridge completes Google login when WebView JavaScript interface is unavailable', async () => {
  let pendingCallback = '';
  const app = createAuthVmHarness({
    capacitor: {
      isNativePlatform: () => true,
      Plugins: {
        BackgroundNotifications: {
          consumeAuthCallback: async () => {
            const payload = pendingCallback;
            pendingCallback = '';
            return { payload };
          }
        }
      }
    }
  });
  app.googleBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(app.calls.openAuthBrowser.length, 1);
  const state = app.calls.openAuthBrowser[0].appState;
  pendingCallback = JSON.stringify({ clerk_token: 'clerk.jwt.google', app_state: state });
  app.ctx.dispatchWindowEvent('myipon:native-oauth-callback');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(app.calls.accountFn[0].clerk_token, 'clerk.jwt.google');
  assert.deepEqual(app.calls.locationReplace, ['dashboard.html']);
});

test('Create with Google in Android app hands off from phone browser back to app and signs in inside the app', async () => {
  let pendingCallback = '';
  const appHarness = createAuthVmHarness({
    search: '?app=1',
    nativeAuth: {
      isSupported: () => true,
      consumePendingCallback: () => {
        const val = pendingCallback;
        pendingCallback = '';
        return val;
      }
    },
    capacitor: { isNativePlatform: () => true }
  });

  // Switch to Create account tab (mode = 'signup') and tap Create with Google
  appHarness.els.get('show-signup').click();
  assert.equal(appHarness.googleLabel.textContent, 'Create with Google');
  appHarness.googleBtn.click();
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(appHarness.calls.openAuthBrowser.length, 1);
  const appState = appHarness.calls.openAuthBrowser[0].appState;
  assert.equal(appHarness.calls.openAuthBrowser[0].signup, true);
  const startSearch = `?app=1&app_handoff=1&app_state=${appState}&start_google=1&mode=signup`;
  const browserStart = createAuthVmHarness({ search: startSearch });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(browserStart.calls.signUpRedirect.length, 1);
  const ssoUrl = new URL(browserStart.calls.signUpRedirect[0].redirectUrl);
  assert.equal(ssoUrl.searchParams.get('app_handoff'), '1');
  assert.equal(ssoUrl.searchParams.get('app_state'), appState);
  assert.equal(ssoUrl.searchParams.get('start_google'), null);

  // Now simulate Chrome Custom Tab completing OAuth (even if Chrome had an old Supabase session!)
  const browserHarness = createAuthVmHarness({
    search: ssoUrl.search,
    nativeAuth: null,
    capacitor: null,
    existingSession: { user: { id: 'u-old-chrome' } },
    clerkToken: 'clerk.jwt.fresh-google-signup'
  });
  await new Promise((r) => setTimeout(r, 40));

  // Browser MUST NOT log into web dashboard or call Supabase exchange/verifyOtp
  assert.equal(browserHarness.calls.accountFn.length, 0, 'Phone browser must NOT exchange Clerk token in browser');
  assert.equal(new URL(browserHarness.calls.handleRedirectCallback[0].signInForceRedirectUrl).searchParams.get('app_handoff'), '1');
  assert.equal(browserHarness.calls.verifyOtp.length, 0, 'Phone browser must NOT sign in via verifyOtp in browser');
  assert.equal(browserHarness.calls.locationReplace.length, 1);
  const deepLink = browserHarness.calls.locationReplace[0];
  assert.ok(deepLink.startsWith('myipon://auth-callback#'), `Expected myipon:// deep link, got ${deepLink}`);
  assert.equal(browserHarness.els.get('clerk-app-handoff').hidden, false);
  assert.equal(browserHarness.els.get('clerk-app-handoff-btn').href, deepLink);

  const hashParams = new URLSearchParams(deepLink.split('#')[1] || '');
  assert.equal(hashParams.get('clerk_token'), 'clerk.jwt.fresh-google-signup');
  assert.equal(hashParams.get('app_state'), appState);

  // Deliver deep link back to the Android app (which is STILL on Create account tab!)
  pendingCallback = JSON.stringify({
    clerk_token: hashParams.get('clerk_token'),
    app_state: hashParams.get('app_state'),
    error: ''
  });
  appHarness.ctx.dispatchWindowEvent('myipon:native-oauth-callback');
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(appHarness.calls.accountFn.length, 1);
  assert.equal(appHarness.calls.accountFn[0].action, 'clerk-session-exchange');
  assert.equal(appHarness.calls.accountFn[0].clerk_token, 'clerk.jwt.fresh-google-signup');
  assert.equal(appHarness.calls.verifyOtp.length, 1);
  assert.equal(appHarness.calls.verifyOtp[0].token_hash, 'sb-hash-123');
  assert.deepEqual(appHarness.calls.locationReplace, ['dashboard.html']);
});

test('Clerk OAuth callback navigates to app handoff instead of reporting a false cancellation', async () => {
  const browser = createAuthVmHarness({
    search: '?app=1&app_handoff=1&app_state=abc123&clerk_sso_callback=1',
    clerkRedirectNavigates: true
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(browser.calls.locationReplace.length, 1);
  const returnUrl = browser.calls.locationReplace[0];
  assert.equal(new URL(returnUrl).searchParams.get('app_handoff'), '1');
  assert.equal(new URL(returnUrl).searchParams.get('clerk_sso_callback'), null);
  assert.equal(browser.els.get('clerk-app-handoff').hidden, true);

  const returned = createAuthVmHarness({
    search: new URL(returnUrl).search,
    clerkSessionAtLoad: true
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(returned.calls.locationReplace.length, 1);
  assert.match(returned.calls.locationReplace[0], /^myipon:\/\/auth-callback#/);
});

test('Browser refreshes handoff after Clerk callback if session activation is deferred', async () => {
  const browser = createAuthVmHarness({
    search: '?app=1&app_handoff=1&app_state=abc123&clerk_sso_callback=1',
    clerkCallbackNoSession: true
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(browser.calls.locationReplace.length, 1);
  const url = new URL(browser.calls.locationReplace[0]);
  assert.equal(url.searchParams.get('app_handoff'), '1');
  assert.equal(url.searchParams.get('clerk_sso_callback'), null);
  assert.equal(browser.els.get('clerk-app-handoff').hidden, true);
});

test('Native OAuth callback rejects mismatched or replayed app_state tokens', async () => {
  let pendingCallback = '';
  const appHarness = createAuthVmHarness({
    search: '?app=1',
    nativeAuth: {
      isSupported: () => true,
      consumePendingCallback: () => {
        const val = pendingCallback;
        pendingCallback = '';
        return val;
      }
    },
    capacitor: { isNativePlatform: () => true }
  });

  appHarness.googleBtn.click();
  await new Promise((r) => setTimeout(r, 20));

  pendingCallback = JSON.stringify({
    clerk_token: 'clerk.jwt.spoofed',
    app_state: 'wrong-state-value',
    error: ''
  });
  appHarness.ctx.dispatchWindowEvent('myipon:native-oauth-callback');
  await new Promise((r) => setTimeout(r, 40));

  assert.equal(appHarness.calls.accountFn.length, 0);
  assert.equal(appHarness.calls.verifyOtp.length, 0);
  assert.match(appHarness.els.get('clerk-signin-message').textContent, /expired or did not match/i);
});

test('Android resume consumes a pending Google callback and opens the app dashboard', async () => {
  let pendingCallback = '';
  const app = createAuthVmHarness({
    nativeAuth: {
      isSupported: () => true,
      consumePendingCallback: () => {
        const value = pendingCallback;
        pendingCallback = '';
        return value;
      }
    },
    capacitor: { isNativePlatform: () => true }
  });
  app.googleBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const state = app.calls.openAuthBrowser[0].appState;
  pendingCallback = JSON.stringify({ clerk_token: 'clerk.jwt.google', app_state: state });
  app.ctx.dispatchWindowEvent('myipon:native-resume');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(app.calls.accountFn[0].action, 'clerk-session-exchange');
  assert.deepEqual(app.calls.locationReplace, ['dashboard.html']);
});

test('Google sign-in replaces a stale app session before opening the selected account', async () => {
  let pendingCallback = '';
  const app = createAuthVmHarness({
    existingSession: { user: { id: 'u-old' }, access_token: 'old-token' },
    initialProfile: null,
    nativeAuth: {
      isSupported: () => true,
      consumePendingCallback: () => {
        const value = pendingCallback;
        pendingCallback = '';
        return value;
      }
    },
    capacitor: { isNativePlatform: () => true }
  });
  app.googleBtn.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const state = app.calls.openAuthBrowser[0].appState;
  pendingCallback = JSON.stringify({ clerk_token: 'clerk.jwt.new-google', app_state: state });
  app.ctx.dispatchWindowEvent('myipon:native-oauth-callback');
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(app.calls.supabaseSignOut.length, 1);
  assert.equal(app.calls.accountFn[0].clerk_token, 'clerk.jwt.new-google');
  assert.deepEqual(app.calls.locationReplace, ['dashboard.html']);
});
