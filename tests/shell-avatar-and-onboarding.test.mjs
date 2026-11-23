import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('notification panel extends to the bottom edge cleanly on desktop and mobile', () => {
  const css = read('css/app.css');
  const heroCss = read('css/hero-plates.css');
  assert.match(css, /\.notification-dialog\{[^}]*inset:68px 16px 0 auto;[^}]*height:calc\(100dvh - 68px\);[^}]*border-radius:16px 16px 0 0/);
  assert.match(css, /\.notification-dialog\s*\{[^}]*inset:\s*var\(--notification-top,\s*70px\)[^}]*\s0\s[^}]*height:\s*auto;[^}]*max-height:\s*none;/s);
  assert.match(heroCss, /\.notification-dialog\s*\{[^}]*inset:var\(--notification-top,70px\)[^}]*\s0\s[^}]*height:auto;[^}]*max-height:none;/s);
  assert.doesNotMatch(heroCss, /\.notification-dialog\s*\{[^}]*height:min\(560px/s);
});

test('navbar avatar renders user initials matching avatar-circle when user has no DP', () => {
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const heroCss = read('css/hero-plates.css');

  assert.match(coreJs, /function sidebarAvatarFallbackHtml\(name/);
  assert.match(css, /\.sidebar-user-avatar \.sidebar-user-initials\s*\{[^}]*color:#f5eadb;/);
  assert.match(css, /\.sidebar-user-card \.sidebar-user-avatar\.has-initials\s*\{[^}]*background:\s*#1e5a44;[^}]*color:\s*#f5eadb;/s);
  assert.match(css, /\.sidebar-user-card \.avatar-presence-wrap\s*\{[^}]*grid-template-columns:\s*100%;[^}]*grid-template-rows:\s*100%;/s);
  assert.match(heroCss, /\.dashboard-sidebar \.sidebar-user-card \.sidebar-user-avatar\.has-initials\s*\{[^}]*background:#1e5a44;[^}]*color:#f5eadb;/s);
  assert.match(heroCss, /\.dashboard-sidebar \.sidebar-user-card \.avatar-presence-wrap\s*\{[^}]*grid-template-columns:100%;[^}]*grid-template-rows:100%;/s);

  const classes = new Set();
  const avatarSlot = {
    innerHTML: '<svg></svg>',
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, f) => (f ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c)
    },
    closest: () => ({ querySelector: () => ({ dataset: {}, classList: { add() { } } }) }),
    querySelector: () => null
  };
  const storageMap = new Map([
    ['ipon_shell_snapshot', JSON.stringify({ userId: 'u-edna', role: 'MEMBER', fullName: 'Edna Fruto', unreadCount: 0 })]
  ]);
  const storage = {
    getItem: (k) => storageMap.get(k) ?? null,
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k)
  };
  const loaderStub = { hidden: false, setAttribute() { }, dataset: {} };
  const stubEl = () => ({ dataset: {}, style: {}, classList: { add() { }, remove() { }, toggle() { }, contains: () => false }, setAttribute() { }, addEventListener() { }, querySelector: () => null, querySelectorAll: () => [] });
  const doc = {
    body: { dataset: { page: 'dashboard' }, classList: { contains: () => false, add() { }, remove() { }, toggle() { } }, insertAdjacentHTML() { }, prepend() { }, append() { }, appendChild() { } },
    head: { insertAdjacentHTML() { }, append() { } },
    documentElement: { dataset: { shellRole: 'MEMBER' }, style: { setProperty() { }, removeProperty() { } } },
    createElement: stubEl,
    querySelector: (sel) => (sel === 'link[rel="manifest"]' ? {} : null),
    querySelectorAll: (sel) => (sel === '.sidebar-user-avatar' ? [avatarSlot] : []),
    getElementById: (id) => (id === 'app-loader' ? loaderStub : null),
    addEventListener() { }
  };
  const ctx = {
    URL, URLSearchParams, CustomEvent: class { }, Intl, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    sessionStorage: storage,
    localStorage: storage,
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    setTimeout: () => 1,
    clearTimeout() { },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', href: 'https://my-ipon.vercel.app/dashboard.html', pathname: '/dashboard.html', search: '', hash: '' },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    addEventListener() { },
    document: doc,
    window: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  assert.equal(avatarSlot.innerHTML, '<span class="sidebar-user-initials">EF</span>');
  assert.equal(avatarSlot.classList.contains('has-initials'), true);
});

test('account onboarding notice banner uses step pill, clean uniform border, and omits icon badge and left accent bar', () => {
  const accountHtml = read('account.html');
  const accountJs = read('js/account.js');
  const css = read('css/app.css');

  assert.match(accountHtml, /class="inline-notice onboarding-notice" id="profile-setup-notice"/);
  assert.doesNotMatch(accountHtml, /class="onboarding-notice-icon"/);
  assert.match(accountHtml, /class="onboarding-notice-eyebrow">Action required</);
  assert.match(accountHtml, /id="profile-setup-step">Step 1 of 2</);
  assert.match(accountJs, /getElementById\('profile-setup-copy'\)/);
  assert.match(accountJs, /getElementById\('profile-setup-step'\)/);
  assert.match(css, /\.inline-notice\.onboarding-notice\{[^}]*border:1px solid #d9b86c;border-radius:16px;/);
  assert.doesNotMatch(css, /\.inline-notice\.onboarding-notice[^}]*border-left:/);
  assert.doesNotMatch(css, /\.onboarding-notice-icon/);
  assert.match(css, /@media \(max-width:620px\)\{\.inline-notice\.onboarding-notice\{flex-wrap:nowrap;align-items:flex-start;gap:14px;padding:16px\}\.onboarding-notice-body\{flex:1 1 auto\}\.onboarding-notice-step\{display:none\}\}/);
  assert.match(css, /html\[data-theme="dark"\] \.inline-notice\.onboarding-notice\s*\{/);
});
