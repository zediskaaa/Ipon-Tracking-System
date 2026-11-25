import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('css/app.css never hides .workspace with opacity:0 during normal page loads and keeps .app-sidebar unblurred above .app-loader', () => {
  const css = read('css/app.css');

  assert.doesNotMatch(
    css,
    /body\[data-page\]:not\(\.security-page\):not\(\.is-ready\)\s+\.workspace\s*\{\s*opacity:\s*0\s*;\s*\}/,
    '.workspace must stay visible on initial paint instead of flashing a blank beige screen'
  );
  assert.doesNotMatch(
    css,
    /body\[data-page\]:not\(\.security-page\):not\(\.is-ready\)\s*>\s*:is\(\.app-layout,\.comp-frame\)\s*\{\s*pointer-events:\s*none/,
    '.app-sidebar navigation must remain clickable while workspace content is loading'
  );
  assert.match(css, /body\[data-page\]:not\(\.security-page\):not\(\.is-ready\) :is\(\.workspace,\.dashboard-workspace\)::before/);
  assert.match(css, /body\[data-page\]:not\(\.security-page\) \.app-loader \{[^}]*z-index:175;[^}]*backdrop-filter:none;[^}]*animation:ipon-loader-appear \.18s ease \.16s both/);
  assert.match(css, /body\[data-page="account"\]:not\(\.is-ready\) \.account-page-dialog:not\(\[open\]\) \{ display:block;/);
  assert.match(css, /\.loading-row td \{[^}]*animation:accountSyncShimmer/);
});

test('js/config.js pre-paints #app-sidebar on frame zero before body scripts load across all workspace pages', () => {
  const configJs = read('js/config.js');
  const sidebarHost = {
    id: 'app-sidebar',
    children: [],
    dataset: {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(val) {
      this._html = String(val);
      this.children = this._html ? [{}] : [];
    }
  };
  const storage = {
    ipon_active_role: 'ADMIN',
    ipon_shell_snapshot: JSON.stringify({ userId: 'u-1', role: 'ADMIN', fullName: 'Maria Santos', unreadCount: 3 }),
    ipon_shell_avatar: JSON.stringify({ userId: 'u-1', avatarUrl: 'https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/public/avatars/u-1.png' })
  };
  const storageApi = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };
  const doc = {
    documentElement: { dataset: {} },
    body: {
      dataset: { page: 'contributions' },
      classList: { contains: () => false }
    },
    getElementById: (id) => (id === 'app-sidebar' ? sidebarHost : null),
    addEventListener() { }
  };
  class FakeMutationObserver {
    constructor(cb) { this.cb = cb; }
    observe() { }
    disconnect() { }
  }
  const win = {
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', hash: '' }
  };
  vm.runInNewContext(configJs, {
    window: win,
    document: doc,
    location: win.location,
    navigator: {},
    localStorage: storageApi,
    sessionStorage: storageApi,
    MutationObserver: FakeMutationObserver
  }, { filename: 'js/config.js' });

  assert.match(sidebarHost.innerHTML, /class="app-brand brand"/, 'Brand must be pre-painted immediately');
  assert.match(sidebarHost.innerHTML, /href="contributions\.html"[^>]*class="is-active"|class="is-active"[^>]*href="contributions\.html"/, 'Current nav tab must be active immediately');
  assert.match(sidebarHost.innerHTML, /Maria Santos/, 'Cached user name must render immediately');
  assert.match(sidebarHost.innerHTML, /data-notification-count>3<\/b>/, 'Cached notification count must render immediately');
  assert.equal(sidebarHost.dataset.renderedRole, undefined, 'Pre-paint leaves renderedRole unset so core.js mountShell upgrades cleanly');
});

test('core.js caches verified session boot state across navigations, avoids hiding authenticated pages on pagehide, and shows inline retry when startup error is dismissed', async () => {
  const coreJs = read('js/core.js');

  assert.match(coreJs, /if \(event\.persisted && !hasStoredAuthToken\(\)\) document\.documentElement\.style\.visibility = 'hidden';/);
  assert.match(coreJs, /const SESSION_BOOT_CACHE_KEY = 'ipon_session_boot_v1';/);
  assert.match(coreJs, /id="startup-inline-error"/);

  const makeEl = (tag = 'div', id = '') => {
    const cls = new Set();
    const attrs = new Map();
    const listeners = new Map();
    return {
      tagName: tag.toUpperCase(),
      id,
      hidden: false,
      disabled: false,
      innerHTML: '',
      textContent: '',
      dataset: {},
      children: [],
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
      appendChild(child) { this.children.push(child); return child; },
      insertAdjacentHTML(_pos, html) { this.innerHTML += html; },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() { },
      remove() { }
    };
  };

  const sessionStore = {};
  const localStore = { 'sb-demo-auth-token': JSON.stringify({ access_token: 'tok_1', refresh_token: 'ref_1' }) };
  const makeStorage = (obj) => new Proxy(obj, {
    get(target, prop) {
      if (prop === 'getItem') return (k) => (Object.prototype.hasOwnProperty.call(target, k) ? target[k] : null);
      if (prop === 'setItem') return (k, v) => { target[k] = String(v); };
      if (prop === 'removeItem') return (k) => { delete target[k]; };
      return target[prop];
    }
  });

  let profileQueries = 0;
  let permRpcs = 0;
  const mockClient = {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'tok_1', user: { id: 'u-fast', email: 'ana@example.com', app_metadata: {} } } },
        error: null
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() { } } } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }),
        listFactors: async () => ({ data: { totp: [] }, error: null })
      }
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          single: async () => {
            if (table === 'profiles') profileQueries += 1;
            return {
              data: {
                id: 'u-fast',
                full_name: 'Ana Cruz',
                first_name: 'Ana',
                last_name: 'Cruz',
                contact_number: '09171234567',
                role: 'ADMIN',
                status: 'ACTIVE',
                group_id: 'g-1',
                member_id: 'm-1',
                policy_accepted_version: '2026-11',
                username: 'anacruz'
              },
              error: null
            };
          },
          maybeSingle: async () => ({ data: { workspace_mode: 'GROUP' }, error: null })
        }),
        not: () => ({ gt: async () => ({ data: [], error: null }) })
      })
    }),
    rpc: async (name) => {
      if (name === 'get_my_member_permissions') permRpcs += 1;
      if (name === 'activate_own_pending_account') return { data: null, error: null };
      return { data: null, error: null };
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch, unsubscribe() { } };
      return ch;
    },
    removeChannel() { }
  };

  const runPageBoot = async (page) => {
    const loaderEl = makeEl('div', 'app-loader');
    const sidebarEl = makeEl('aside', 'app-sidebar');
    const sidebarUserEl = makeEl('div', 'sidebar-user');
    const body = makeEl('body');
    body.dataset.page = page;
    const doc = {
      documentElement: makeEl('html'),
      body,
      head: makeEl('head'),
      getElementById: (id) => (id === 'app-loader' ? loaderEl : id === 'app-sidebar' ? sidebarEl : id === 'sidebar-user' ? sidebarUserEl : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() { },
      removeEventListener() { }
    };
    const win = {
      IPON_CONFIG: { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'anon_key' },
      supabase: { createClient: () => mockClient },
      location: { href: `https://my-ipon.vercel.app/${page}.html`, origin: 'https://my-ipon.vercel.app', pathname: `/${page}.html`, search: '', hash: '', replace() { }, assign() { }, reload() { } },
      navigator: { onLine: true, userAgent: 'Mozilla/5.0' },
      localStorage: makeStorage(localStore),
      sessionStorage: makeStorage(sessionStore),
      matchMedia: () => ({ matches: false, addEventListener() { } }),
      addEventListener() { },
      removeEventListener() { },
      setTimeout: () => 1,
      clearTimeout() { },
      setInterval: () => 1,
      clearInterval() { },
      requestAnimationFrame: (fn) => fn()
    };
    win.window = win;
    vm.runInNewContext(coreJs, {
      window: win,
      document: doc,
      location: win.location,
      navigator: win.navigator,
      localStorage: win.localStorage,
      sessionStorage: win.sessionStorage,
      URL,
      URLSearchParams,
      Promise,
      setTimeout: win.setTimeout,
      clearTimeout: win.clearTimeout,
      setInterval: win.setInterval,
      clearInterval: win.clearInterval,
      requestAnimationFrame: win.requestAnimationFrame,
      console
    }, { filename: 'js/core.js' });
    return win.Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  };

  // Cold boot fetches profile & permissions and populates session boot cache
  const firstState = await runPageBoot('dashboard');
  assert.equal(firstState.profile?.id, 'u-fast');
  assert.equal(profileQueries, 1);
  assert.equal(permRpcs, 1);
  assert.ok(sessionStore.ipon_session_boot_v1, 'First verified boot must populate sessionStorage boot cache');

  // Subsequent page navigation resolves immediately from verified session boot cache with 0 blocking queries
  const secondState = await runPageBoot('contributions');
  assert.equal(secondState.profile?.id, 'u-fast');
  assert.equal(secondState.profile?.role, 'ADMIN');
  assert.equal(profileQueries, 1, 'Second page navigation must not block on redundant profile query');
  assert.equal(permRpcs, 1, 'Second page navigation must not block on redundant permissions RPC');
});

test('sw.js precaches all HTML shells and page scripts, caches pinned CDN bundles, and falls back to cached shell on slow HTML navigation', async () => {
  const sw = read('sw.js');
  for (const asset of ['dashboard.html', 'contributions.html', 'budget.html', 'reports.html', 'members.html', 'js/dashboard.js', 'js/records.js', 'js/budget.js']) {
    assert.ok(sw.includes(`'${asset}'`), `sw.js STATIC_ASSETS must include ${asset}`);
  }
  assert.match(sw, /isPinnedCdnAsset/);

  const listeners = new Map();
  let fetchCount = 0;
  const cdnResponse = { ok: true, type: 'cors', clone() { return this; } };
  const cachedHtmlShell = { ok: true, type: 'basic', marker: 'cached-shell', clone() { return this; } };
  const timers = [];
  const ctx = {
    URL,
    Request: class { constructor(req) { Object.assign(this, typeof req === 'string' ? { url: req } : req); } },
    Promise,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
    fetch: (req) => {
      fetchCount += 1;
      if (String(req.url).includes('cdn.jsdelivr.net')) return Promise.resolve(cdnResponse);
      // Simulate stalled slow HTML network
      return new Promise(() => { });
    },
    caches: {
      match: async (req, opts) => {
        const u = typeof req === 'string' ? req : req.url;
        if (opts?.ignoreSearch && u.includes('/budget.html')) return cachedHtmlShell;
        return null;
      },
      open: async () => ({ addAll: async () => { }, put: async () => { } }),
      keys: async () => [],
      delete: async () => true
    },
    self: {
      location: { hostname: 'my-ipon.vercel.app', protocol: 'https:', origin: 'https://my-ipon.vercel.app' },
      addEventListener: (type, fn) => listeners.set(type, fn)
    }
  };
  vm.runInNewContext(sw, ctx, { filename: 'sw.js' });

  // Pinned CDN script is intercepted and cached
  let cdnRes;
  listeners.get('fetch')({
    request: { method: 'GET', url: 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.min.js' },
    respondWith(p) { cdnRes = p; }
  });
  assert.equal(await cdnRes, cdnResponse);
  assert.equal(fetchCount, 1);

  // Stalled HTML navigation resolves cached shell after 1800ms instead of hanging blank
  let htmlResPromise;
  listeners.get('fetch')({
    request: { method: 'GET', mode: 'navigate', url: 'https://my-ipon.vercel.app/budget.html' },
    respondWith(p) { htmlResPromise = p; }
  });
  await Promise.resolve();
  await Promise.resolve();
  const fallbackTimer = timers.find((t) => t.ms === 1800 && !t.cleared);
  assert.ok(fallbackTimer, 'Expected 1800ms slow-navigation HTML shell fallback timer');
  fallbackTimer.fn();
  const resolvedShell = await htmlResPromise;
  assert.equal(resolvedShell.marker, 'cached-shell');
});
