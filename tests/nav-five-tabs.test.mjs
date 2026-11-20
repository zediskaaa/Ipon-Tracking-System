import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function extractHtmlIds(html) {
  const ids = [];
  for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
    ids.push(match[1]);
  }
  return ids;
}

function makeClassList(initial = '') {
  const set = new Set(String(initial).split(/\s+/).filter(Boolean));
  return {
    add: (...names) => names.forEach((n) => set.add(n)),
    remove: (...names) => names.forEach((n) => set.delete(n)),
    toggle: (name, force) => {
      if (force === undefined) {
        if (set.has(name)) { set.delete(name); return false; }
        set.add(name);
        return true;
      }
      if (force) set.add(name);
      else set.delete(name);
      return Boolean(force);
    },
    contains: (name) => set.has(name),
    toString: () => [...set].join(' ')
  };
}

function makeStubNode(tag = 'div') {
  return {
    tagName: tag.toUpperCase(),
    dataset: {},
    style: { setProperty() { }, removeProperty() { } },
    classList: makeClassList(),
    attributes: {},
    hidden: false,
    textContent: '',
    innerHTML: '',
    children: [],
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    removeAttribute(k) { delete this.attributes[k]; },
    hasAttribute(k) { return k in this.attributes; },
    addEventListener() { },
    removeEventListener() { },
    append() { },
    appendChild() { },
    insertAdjacentHTML() { },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    remove() { }
  };
}

function runCoreShell({ page = 'dashboard', role = 'ADMIN', workspaceMode = 'GROUP', renderedRole = '', compactViewport = false } = {}) {
  const coreJs = read('js/core.js');
  const rootEl = { dataset: {}, classList: makeClassList(), style: { setProperty() { } }, scrollTop: 0 };
  const bodyStyleProps = {};
  const bodyEl = {
    dataset: { page },
    classList: makeClassList(),
    scrollTop: 0,
    style: {
      setProperty(k, v) { bodyStyleProps[k] = String(v); },
      removeProperty(k) { delete bodyStyleProps[k]; },
      getPropertyValue(k) { return bodyStyleProps[k] || ''; }
    },
    insertAdjacentHTML(_pos, html) {
      if (String(html).includes('id="app-loader"')) {
        appLoaderEl = makeStubNode('div');
        appLoaderEl.querySelector = () => makeStubNode('span');
      }
    },
    prepend() { },
    append() { },
    appendChild() { }
  };
  const storage = {
    store: new Map([
      ['ipon_active_role', role],
      ['ipon_workspace_mode', workspaceMode]
    ]),
    getItem(k) { return this.store.has(k) ? this.store.get(k) : null; },
    setItem(k, v) { this.store.set(k, String(v)); },
    removeItem(k) { this.store.delete(k); }
  };

  let navLinks = [];
  let accountBtn = null;
  let workspacePrefRow = {
    dataset: { role: 'ADMIN' },
    hidden: false,
    hasAttribute: () => false,
    getAttribute: () => null
  };
  let accountDialogCloseCount = 0;
  const clickHandlers = [];
  const docEventHandlers = { touchstart: [], touchmove: [], touchend: [] };
  const clickHandler = (ev) => { for (const fn of clickHandlers) fn(ev); };
  let appLoaderEl = null;

  const hostStyleProps = {};
  const hostEl = {
    offsetHeight: 136,
    style: {
      setProperty(k, v) { hostStyleProps[k] = String(v); },
      removeProperty(k) { delete hostStyleProps[k]; },
      getPropertyValue(k) { return hostStyleProps[k] || ''; }
    },
    classList: makeClassList('app-sidebar'),
    dataset: renderedRole ? { renderedRole } : {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(val) {
      this._html = String(val);
      navLinks = [...this._html.matchAll(/<a class="([^"]*)" href="([^"]+)" aria-label="([^"]+)" data-nav-section="([^"]+)"([^>]*)>/g)].map((m) => ({
        href: m[2],
        label: m[3],
        dataset: { navSection: m[4] },
        classList: makeClassList(m[1]),
        attributes: m[5].includes('aria-current="page"') ? { 'aria-current': 'page' } : {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        removeAttribute(k) { delete this.attributes[k]; }
      }));
      const cardMatch = this._html.match(/<button class="([^"]*sidebar-user-card[^"]*)" data-account-open([^>]*)>/);
      accountBtn = cardMatch ? {
        classList: makeClassList(cardMatch[1]),
        attributes: cardMatch[2].includes('aria-current="page"') ? { 'aria-current': 'page' } : {},
        setAttribute(k, v) { this.attributes[k] = String(v); },
        removeAttribute(k) { delete this.attributes[k]; }
      } : null;
    },
    querySelectorAll(sel) {
      if (sel === '.app-nav a') return navLinks;
      return [];
    },
    querySelector(sel) {
      if (sel === '[data-account-open]') return accountBtn;
      return null;
    }
  };

  if (renderedRole) {
    hostEl.innerHTML = `<nav class="app-nav">${['dashboard', 'contributions', 'budget', 'members', 'reports'].map((id) => `<a class="${id === 'dashboard' ? 'is-active' : ''}" href="${id}.html" aria-label="${id}" data-nav-section="${id}"></a>`).join('')}</nav><button class="sidebar-user-card" data-account-open></button>`;
  }

  const doc = {
    body: bodyEl,
    head: { insertAdjacentHTML() { }, append() { } },
    documentElement: rootEl,
    referrer: '',
    createElement: (tag) => makeStubNode(tag),
    querySelector: (sel) => (sel === 'link[rel="manifest"]' ? {} : null),
    querySelectorAll: (sel) => (sel === '[data-role]' ? [workspacePrefRow] : []),
    getElementById: (id) => {
      if (id === 'app-loader') return appLoaderEl;
      if (id === 'app-sidebar') return hostEl;
      if (id === 'account-dialog') return { close() { accountDialogCloseCount += 1; } };
      return null;
    },
    addEventListener(type, fn) {
      if (type === 'click' && typeof fn === 'function') clickHandlers.push(fn);
      if (docEventHandlers[type] && typeof fn === 'function') docEventHandlers[type].push(fn);
    }
  };

  const historyCalls = [];
  const windowScrollHandlers = [];
  const ctx = {
    URL,
    URLSearchParams,
    CustomEvent: class { },
    Intl,
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
    sessionStorage: storage,
    localStorage: storage,
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    setTimeout: () => 1,
    clearTimeout() { },
    scrollY: 0,
    pageYOffset: 0,
    history: {
      length: 3,
      back() { historyCalls.push('back'); }
    },
    location: {
      protocol: 'https:',
      hostname: 'my-ipon.vercel.app',
      origin: 'https://my-ipon.vercel.app',
      href: `https://my-ipon.vercel.app/${page}.html`,
      pathname: `/${page}.html`,
      search: '',
      hash: ''
    },
    matchMedia: (q) => ({ matches: Boolean(compactViewport && /max-width:(?:720|860)px/.test(q)), addEventListener() { } }),
    addEventListener(type, fn) {
      if (type === 'scroll' && typeof fn === 'function') windowScrollHandlers.push(fn);
    },
    document: doc,
    window: null,
    console
  };
  ctx.window = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  return {
    ctx,
    doc,
    hostEl,
    getNavLinks: () => navLinks,
    getAccountBtn: () => accountBtn,
    workspacePrefRow,
    getAccountDialogCloseCount: () => accountDialogCloseCount,
    getClickHandler: () => clickHandler,
    fireScroll: (y) => {
      ctx.scrollY = y;
      ctx.pageYOffset = y;
      for (const fn of windowScrollHandlers) fn();
    },
    fireDocTouch: (type, clientY, clientX = 120) => {
      const ev = {
        touches: type === 'touchend' ? [] : [{ clientX, clientY }],
        target: { tagName: 'DIV', nodeType: 1, scrollTop: 0, scrollHeight: 100, clientHeight: 100, parentElement: bodyEl }
      };
      for (const fn of (docEventHandlers[type] || [])) fn(ev);
    },
    bodyStyleProps,
    hostStyleProps,
    historyCalls
  };
}

test('primary navigation stays at 5 tabs across all roles while moving Settings into My account and Audit log into Reports', () => {
  const coreJs = read('js/core.js');
  const dashHtml = read('dashboard.html');
  const reportsHtml = read('reports.html');
  const auditHtml = read('audit.html');
  const settingsHtml = read('settings.html');
  const accountHtml = read('account.html');
  const css = read('css/app.css');
  const heroPlatesCss = read('css/hero-plates.css');
  const swJs = read('sw.js');

  // 1. Static dashboard fallback nav exposes strictly <=5 primary links per role (no Audit log or Settings)
  const dashNav = dashHtml.match(/<nav class="app-nav[\s\S]*?<\/nav>/)?.[0] || '';
  const rawDashLinks = [...dashNav.matchAll(/<a\b([^>]*)>/g)].map((m) => ({
    href: m[1].match(/href="([^"]+)"/)?.[1] || '',
    role: m[1].match(/data-role="([^"]+)"/)?.[1] || ''
  }));
  assert.doesNotMatch(dashNav, /audit\.html|settings\.html/);
  assert.deepEqual(rawDashLinks.filter((l) => !l.role || l.role === 'ADMIN').map((l) => l.href), ['dashboard.html', 'contributions.html', 'budget.html', 'members.html', 'reports.html']);
  assert.deepEqual(rawDashLinks.filter((l) => !l.role || l.role === 'MEMBER').map((l) => l.href), ['dashboard.html', 'user.html', 'contributions.html', 'budget.html', 'reports.html']);

  // 2. Dynamic nav arrays in js/core.js each define strictly 5 entries
  const adminNav = runCoreShell({ page: 'dashboard', role: 'ADMIN' });
  assert.deepEqual(adminNav.getNavLinks().map((l) => l.dataset.navSection), ['dashboard', 'contributions', 'budget', 'members', 'reports']);
  assert.match(coreJs, /const userNavItems = \[\s*\['dashboard'[\s\S]*?'reports', 'reports\.html'/);
  assert.equal(adminNav.workspacePrefRow.hidden, false);

  const memberNav = runCoreShell({ page: 'user', role: 'MEMBER' });
  assert.deepEqual(memberNav.getNavLinks().map((l) => l.dataset.navSection), ['dashboard', 'user', 'contributions', 'budget', 'reports']);
  assert.equal(memberNav.workspacePrefRow.hidden, true);

  const treasurerNav = runCoreShell({ page: 'dashboard', role: 'TREASURER' });
  assert.deepEqual(treasurerNav.getNavLinks().map((l) => l.dataset.navSection), ['dashboard', 'contributions', 'budget', 'reports']);
  assert.equal(treasurerNav.workspacePrefRow.hidden, true);

  const soloAdmin = runCoreShell({ page: 'dashboard', role: 'ADMIN', workspaceMode: 'SOLO' });
  assert.equal(soloAdmin.workspacePrefRow.hidden, false);

  // 3. Secondary subviews preserve clear entry points and Back navigation
  assert.match(coreJs, /class="preference-row preference-workspace-row" data-role="ADMIN"[\s\S]*?href="settings\.html" data-workspace-settings-open>Manage<\/a>/);
  assert.match(accountHtml, /class="preference-row preference-workspace-row" data-role="ADMIN"[\s\S]*?href="settings\.html" data-workspace-settings-open>Manage<\/a>/);
  assert.match(reportsHtml, /<a[^>]+href="audit\.html"[^>]+data-role="ADMIN"[^>]+id="reports-open-audit"[\s\S]*?<span>Audit log<\/span>/);
  assert.match(dashHtml, /<a class="group-hub-link" href="settings\.html">[\s\S]*?<a class="group-hub-link" href="audit\.html" data-role="ADMIN">/);
  assert.match(auditHtml, /<div class="subview-back-bar"><a class="subview-back-link" href="reports\.html">[\s\S]*?<span>Back to Reports<\/span><\/a><\/div>/);
  assert.match(settingsHtml, /<div class="subview-back-bar"><a class="subview-back-link" href="dashboard\.html" data-subview-back="dashboard\.html">[\s\S]*?<span>Back to workspace<\/span><\/a><\/div>/);
  assert.match(settingsHtml, /<span class="calc-eyebrow">My account · Workspace<\/span>/);

  // 4. CSS + Service Worker + HTML dialog/ID integrity
  assert.match(css, /\.subview-back-link\s*\{/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.subview-back-link\s*\{/);
  assert.match(css, /\.sidebar-user-card\.is-active\s*\{/);
  assert.match(css, /\.preference-workspace-row\s*\{/);
  assert.match(css, /\/\* Mobile Curved Emerald Header & Floating Pill Navigation Dock \*\/[\s\S]*?\.app-sidebar::before\s*\{[\s\S]*?border-radius:\s*0 0 32px 32px/);
  assert.match(css, /\/\* Mobile Curved Emerald Header & Floating Pill Navigation Dock \*\/[\s\S]*?\.app-sidebar\.is-scroll-hidden[\s\S]*?transform:\s*translate3d\(0,\s*calc\(-100% - 18px\),\s*0\)/);
  assert.match(css, /\/\* Mobile Curved Emerald Header & Floating Pill Navigation Dock \*\/[\s\S]*?\.app-nav\s*\{[\s\S]*?border-radius:\s*26px[\s\S]*?background:\s*#FBF8F0/);
  assert.match(css, /\/\* Mobile Curved Emerald Header & Floating Pill Navigation Dock \*\/[\s\S]*?\.app-nav a\.is-active\s*\{[\s\S]*?color:\s*#F2C14E/);
  assert.match(css, /\/\* Messages & Connections — Navigation Bar Style Preset & Pull-to-Refresh \*\/[\s\S]*?\.msg-tabs\s*\{[\s\S]*?border-radius:\s*26px[\s\S]*?background:\s*#FBF8F0/);
  assert.match(css, /\/\* Messages & Connections — Navigation Bar Style Preset & Pull-to-Refresh \*\/[\s\S]*?\.msg-tab\.is-active\s*\{[\s\S]*?color:\s*#F2C14E/);
  assert.match(css, /\/\* Messages & Connections — Navigation Bar Style Preset & Pull-to-Refresh \*\/[\s\S]*?\.msg-topbar::before\s*\{[\s\S]*?border-radius:\s*0 0 32px 32px/);
  assert.match(read('js/messages.js'), /async function refreshWorkspace\(\)[\s\S]*?window\.IponMessages = \{[\s\S]*?refreshWorkspace,/);
  assert.match(read('database/migrations/20261119_133_message_notification_sender_avatar_and_title.sql'), /actor_avatar_url text[\s\S]*?v_notif_title := coalesce\(nullif\(btrim\(v_sender\.full_name\), ''\), 'User'\)/);
  assert.match(read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java'), /cleanMessageNotificationTitle[\s\S]*?loadCircularAvatarBitmap[\s\S]*?IconCompat\.createWithBitmap\(avatarBitmap\)[\s\S]*?NotificationCompat\.MessagingStyle/);
  assert.match(coreJs, /function formatNotificationTitle\(item\)[\s\S]*?function resolveNotificationAvatarUrl\(item\)/);
  assert.match(heroPlatesCss, /@media \(max-width:860px\)[\s\S]*?\.dashboard-sidebar::before\s*\{[\s\S]*?border-radius:\s*0 0 32px 32px/);
  assert.match(heroPlatesCss, /@media \(max-width:860px\)[\s\S]*?\.dashboard-sidebar\.is-scroll-hidden[\s\S]*?transform:\s*translate3d\(0,calc\(-100% - 18px\),0\)/);
  assert.match(heroPlatesCss, /@media \(max-width:860px\)[\s\S]*?\.dashboard-sidebar \.sidebar-nav\s*\{[\s\S]*?border-radius:\s*26px[\s\S]*?background:\s*#FBF8F0/);
  assert.match(dashHtml, /<svg class="brand-coins"[\s\S]*?<span class="brand-divider"[\s\S]*?<span class="brand-text">\s*<strong><span class="brand-prefix">my<\/span>IPON<\/strong>\s*<\/span>/);
  assert.match(adminNav.hostEl.innerHTML, /<svg class="brand-coins"[\s\S]*?<span class="brand-divider"[\s\S]*?<span class="brand-text">\s*<strong><span class="brand-prefix">my<\/span>IPON<\/strong>\s*<\/span>/);
  assert.match(swJs, /ipon-shell-v(?:2[4-9]|[3-9]\d)/);

  for (const file of ['dashboard.html', 'reports.html', 'audit.html', 'settings.html', 'account.html']) {
    const html = read(file);
    assert.match(html, /css\/app\.css\?v=20261120-06/);
    assert.match(html, /js\/core\.js\?v=20261120-161/);
    const opens = (html.match(/<dialog\b/g) || []).length;
    const closes = (html.match(/<\/dialog>/g) || []).length;
    assert.equal(opens, closes, `${file} has unbalanced <dialog> tags`);
    const ids = extractHtmlIds(html);
    assert.equal(new Set(ids).size, ids.length, `${file} has duplicate HTML IDs`);
  }
});

test('audit highlights Reports, settings/account highlight My account, and subview back handler behaves safely', () => {
  // Audit subview highlights Reports
  const auditShell = runCoreShell({ page: 'audit', role: 'ADMIN' });
  const reportsLink = auditShell.getNavLinks().find((l) => l.dataset.navSection === 'reports');
  assert.equal(reportsLink.classList.contains('is-active'), true);
  assert.equal(reportsLink.attributes['aria-current'], 'page');
  assert.equal(auditShell.getAccountBtn().classList.contains('is-active'), false);

  // Settings & Account subviews highlight My account (both initial and incremental mountShell)
  for (const subPage of ['settings', 'account']) {
    const fresh = runCoreShell({ page: subPage, role: 'ADMIN' });
    assert.equal(fresh.getAccountBtn().classList.contains('is-active'), true, `${subPage} initial mount`);
    assert.equal(fresh.getAccountBtn().attributes['aria-current'], 'page');
    assert.equal(fresh.getNavLinks().some((l) => l.classList.contains('is-active')), false);

    const reused = runCoreShell({ page: subPage, role: 'ADMIN', renderedRole: 'ADMIN' });
    assert.equal(reused.getAccountBtn().classList.contains('is-active'), true, `${subPage} incremental mount`);
    assert.equal(reused.getAccountBtn().attributes['aria-current'], 'page');
    assert.equal(reused.getNavLinks().some((l) => l.classList.contains('is-active')), false);
  }

  // Click delegation closes #account-dialog on Workspace settings CTA and uses history.back() only for valid same-origin referrer
  const handlerShell = runCoreShell({ page: 'settings', role: 'ADMIN' });
  const click = handlerShell.getClickHandler();
  assert.equal(typeof click, 'function');

  click({
    target: { closest: (sel) => (sel === '[data-workspace-settings-open]' ? {} : null) },
    preventDefault() { throw new Error('workspace settings link should still navigate'); }
  });
  assert.equal(handlerShell.getAccountDialogCloseCount(), 1);

  handlerShell.doc.referrer = 'https://my-ipon.vercel.app/reports.html';
  let prevented = false;
  click({
    target: { closest: (sel) => (sel === '[data-subview-back]' ? {} : null) },
    preventDefault() { prevented = true; }
  });
  assert.equal(prevented, true);
  assert.deepEqual(handlerShell.historyCalls, ['back']);

  // Login or cross-origin referrers must fall back cleanly to href (do not call history.back)
  for (const ref of ['', 'https://my-ipon.vercel.app/login.html', 'https://my-ipon.vercel.app/settings.html', 'https://evil.example/dashboard.html']) {
    handlerShell.doc.referrer = ref;
    let blocked = false;
    const before = handlerShell.historyCalls.length;
    click({
      target: { closest: (sel) => (sel === '[data-subview-back]' ? {} : null) },
      preventDefault() { blocked = true; }
    });
    assert.equal(blocked, false, `referrer "${ref}" should fall back to href`);
    assert.equal(handlerShell.historyCalls.length, before);
  }

  // Mobile sticky header tracks user scroll 1:1 (--header-scroll-y) without auto-snapping and stays fixed during pull-to-refresh
  const mobileShell = runCoreShell({ page: 'contributions', role: 'ADMIN', compactViewport: true });
  assert.equal(mobileShell.hostEl.classList.contains('is-scroll-hidden'), false);
  mobileShell.fireScroll(40);
  assert.equal(mobileShell.hostStyleProps['--header-scroll-y'], '40px', 'tracks 40px downward scroll 1:1 without auto-hiding');
  assert.equal(mobileShell.hostEl.classList.contains('is-scroll-hidden'), false, 'does not auto-hide when only partially scrolled');
  mobileShell.fireScroll(180);
  assert.equal(mobileShell.hostStyleProps['--header-scroll-y'], '154px', 'clamps to full header height when scrolled all the way down');
  assert.equal(mobileShell.hostEl.classList.contains('is-scroll-hidden'), true);
  mobileShell.fireScroll(150);
  assert.equal(mobileShell.hostStyleProps['--header-scroll-y'], '124px', 'moves back down 1:1 by 30px when user scrolls up 30px');
  assert.equal(mobileShell.hostEl.classList.contains('is-scroll-hidden'), false);
  mobileShell.fireScroll(0);
  assert.equal(mobileShell.hostStyleProps['--header-scroll-y'], '0px');
  assert.equal(mobileShell.hostEl.classList.contains('is-scroll-hidden'), false, 'fully visible at top of page');

  // Swipe-down pull-to-refresh keeps header/nav bar fixed (0px) and translates only the workspace below the nav bar
  mobileShell.fireDocTouch('touchstart', 20);
  mobileShell.fireDocTouch('touchmove', 110);
  assert.equal(mobileShell.doc.body.classList.contains('is-ptr-pulling'), true);
  assert.ok(parseInt(mobileShell.bodyStyleProps['--ptr-pull'] || '0', 10) > 15, 'translates workspace below nav bar during swipe-down refresh');
  assert.equal(mobileShell.hostStyleProps['--header-scroll-y'], '0px', 'header and navigation bar remain locked at 0px');
  assert.equal(mobileShell.hostEl.classList.contains('is-scroll-hidden'), false, 'header and navigation bar stay fixed at the top');
  mobileShell.fireDocTouch('touchend', 110);
});
