import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('migrations 20261118_109 and 110 permanently exempt protected accounts from inactivity retention while chat avatar hooks are removed', () => {
  const sql = read('database/migrations/20261118_109_owner_social_alias_and_retention_exemption.sql');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /'20261118_109'/);
  assert.match(sql, /create or replace function public\.is_protected_retention_account\(/i);
  assert.match(sql, /'breadspanish231@gmail\.com'/);
  assert.match(sql, /revoke all on function public\.is_protected_retention_account\(text\) from public, anon, authenticated;/i);

  assert.match(sql, /create or replace function public\.collect_inactive_account_candidates\([\s\S]*?not public\.is_protected_retention_account\(/i);
  assert.match(sql, /create or replace function public\.purge_inactive_user_data\([\s\S]*?if public\.is_protected_retention_account\([\s\S]*?return false;/i);
  assert.match(sql, /grant select on public\.v_announcements to authenticated;/i);

  assert.doesNotMatch(coreJs, /author_social_user_id|data-social-hover-dp=|announcement-owner-dp-btn/);
  assert.doesNotMatch(css, /\.announcement-owner-dp-btn\s*\{/);

  const sql110 = read('database/migrations/20261118_110_exempt_additional_protected_account.sql');
  assert.match(sql110, /^\s*begin;/i);
  assert.match(sql110, /commit;\s*$/i);
  assert.match(sql110, /'20261118_110'/);
  assert.match(sql110, /'breadspanish231@gmail\.com'/);
  assert.match(sql110, /'antalannhicolejoy19@gmail\.com'/);
});

test('migration 20261118_125 allows Super Admin to pin announcements with premium styling and pinned-first sorting', async () => {
  const sql = read('database/migrations/20261118_125_pin_announcements.sql');
  const coreJs = read('js/core.js');
  const saJs = read('js/super-admin.js');
  const css = read('css/app.css');

  // 1. SQL schema, view & RPC contracts
  assert.match(sql, /(?:^|\n)\s*begin;/i);
  assert.match(sql, /\ncommit;\s*$/i);
  assert.match(sql, /'20261118_125'/);
  assert.match(sql, /add column if not exists pinned_at timestamptz/i);
  assert.match(sql, /announcements_pinned_created_idx/i);
  assert.match(sql, /create or replace view public\.v_announcements[\s\S]*\(a\.pinned_at is not null\) as is_pinned,\s*a\.pinned_at/i);
  assert.match(sql, /create or replace function public\.set_announcement_pinned\(/i);
  assert.match(sql, /if not public\.is_super_admin\(\) then/i);
  assert.match(sql, /grant execute on function public\.set_announcement_pinned\(uuid, boolean\) to authenticated;/i);

  // 2. Super Admin panel & CSS contracts
  assert.match(saJs, /Ipon\.bindAnnouncements\(\{[\s\S]*?listElement:\s*document\.getElementById\('sa-announcement-list'\),[\s\S]*?allowPin:\s*true[\s\S]*?\}\)/);
  assert.match(coreJs, /const canPin = \(\) => Boolean\(allowPin && currentProfile\?\.role === 'SUPER_ADMIN'\)/);
  assert.match(css, /\.announcement-item\.is-pinned\s*\{/);
  assert.match(css, /\.announcement-item\.is-pinned::before\s*\{/);
  assert.match(css, /\.announcement-pinned-badge\s*\{/);
  assert.match(css, /\.announcement-pin-btn\.is-pinned\s*\{/);
  assert.match(css, /\.announcement-viewer-dialog\.is-pinned \.announcement-category-bar\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.announcement-item\.is-pinned\s*\{/);

  // 3. Runtime VM verification: Super Admin pin/unpin + sorting + viewer sync vs non-Super-Admin read-only
  const els = new Map();
  const makeEl = (tag = 'div', id = '') => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      id,
      tagName: String(tag).toUpperCase(),
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      disabled: false,
      open: false,
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      removeAttribute: (k) => attrs.delete(k),
      getAttribute: (k) => attrs.get(k) ?? null,
      addEventListener: (t, fn) => {
        if (!listeners.has(t)) listeners.set(t, []);
        listeners.get(t).push(fn);
      },
      removeEventListener() { },
      dispatchEvent: (ev) => {
        for (const fn of (listeners.get(ev.type) || [])) fn(ev);
        return true;
      },
      querySelector: () => makeEl('span'),
      querySelectorAll: () => [],
      replaceChildren() { el.innerHTML = ''; },
      closest: () => null,
      showModal() { el.open = true; },
      close() { el.open = false; },
      focus() { }
    };
    if (id) els.set(id, el);
    return el;
  };
  const getEl = (id) => (els.has(id) ? els.get(id) : makeEl(id.includes('dialog') ? 'dialog' : 'div', id));

  [
    'app-loader', 'announcement-viewer-dialog', 'announcement-viewer-title', 'announcement-viewer-release-banner',
    'announcement-viewer-meta', 'announcement-viewer-description', 'announcement-viewer-release-features',
    'announcement-viewer-media', 'announcement-viewer-delete', 'announcement-viewer-pin', 'announcement-viewer-pinned',
    'announcement-viewer-reactions', 'announcement-viewer-done', 'announcement-viewer-close',
    'announcement-reactions-dialog', 'announcement-reactions-tabs', 'announcement-reactions-list',
    'announcement-reactions-title', 'announcement-reactions-close', 'announcement-reactions-done',
    'announcement-compose-dialog', 'announcement-compose-form', 'announcement-compose-close',
    'announcement-compose-cancel', 'announcement-media-input', 'announcement-media-help',
    'announcement-media-previews', 'sa-announcement-list', 'dashboard-announcement-list'
  ].forEach((id) => getEl(id));

  const sampleItems = [
    {
      id: 'ann-new',
      author_id: 'u-sa',
      author_name: 'Zedrick Owner',
      author_role: 'SUPER_ADMIN',
      title: 'Regular New Update',
      description: 'Fresh announcement body',
      attachments: [],
      created_at: '2026-11-18T12:00:00Z',
      announcement_type: 'GENERAL',
      release_version: null,
      is_pinned: false,
      pinned_at: null
    },
    {
      id: 'ann-pinned',
      author_id: 'u-sa',
      author_name: 'Zedrick Owner',
      author_role: 'SUPER_ADMIN',
      title: 'Important Rules',
      description: 'Always read pinned rules',
      attachments: [],
      created_at: '2026-11-10T08:00:00Z',
      announcement_type: 'GENERAL',
      release_version: null,
      is_pinned: true,
      pinned_at: '2026-11-12T08:00:00Z'
    }
  ];

  const rpcCalls = [];
  const makeQueryChain = (table) => {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({
        data: table === 'profiles'
          ? { id: 'u-sa', full_name: 'Zedrick Owner', role: 'SUPER_ADMIN', status: 'ACTIVE', name_setup_required: false }
          : null,
        error: null
      }),
      then(resolve) {
        if (table === 'v_announcements') return Promise.resolve({ data: sampleItems, error: null }).then(resolve);
        return Promise.resolve({ data: [], error: null }).then(resolve);
      }
    };
    return chain;
  };

  const ctx = {
    window: null,
    globalThis: null,
    document: {
      hidden: false,
      readyState: 'complete',
      body: {
        dataset: { page: 'super-admin' },
        classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
        insertAdjacentHTML() { },
        appendChild() { },
        querySelector: () => null,
        querySelectorAll: () => []
      },
      documentElement: { dataset: {}, style: { setProperty() { }, removeProperty() { } }, classList: { add() { }, remove() { }, toggle() { } } },
      head: { appendChild() { }, insertAdjacentHTML() { } },
      getElementById: (id) => els.get(id) || null,
      querySelector: (sel) => (sel.startsWith('#') ? els.get(sel.slice(1)) || null : null),
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener() { },
      removeEventListener() { }
    },
    location: { href: 'http://localhost/super-admin.html', origin: 'http://localhost', pathname: '/super-admin.html', search: '', hash: '', replace() { } },
    history: { replaceState() { } },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    navigator: {},
    Notification: { permission: 'default' },
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon-key' },
    supabase: {
      createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: { user: { id: 'u-sa' }, access_token: 'tok' } } }),
          onAuthStateChange() { },
          mfa: {
            getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null }),
            listFactors: async () => ({ data: { totp: [] }, error: null })
          }
        },
        from: (t) => makeQueryChain(t),
        rpc: async (fn, params) => {
          rpcCalls.push({ fn, params });
          if (fn === 'get_group_member_profile') {
            return {
              data: {
                profile_visible: true,
                id: 'f58acf43-a3ec-4c31-a4fa-9def23c838f1',
                full_name: 'Creator Profile',
                equipped_profile_effect: 'creator_astral_sovereign',
                card_theme: 'emerald',
                social_links: {}
              },
              error: null
            };
          }
          if (fn === 'set_announcement_pinned') {
            return {
              data: {
                id: params.p_announcement_id,
                is_pinned: params.p_pinned,
                pinned_at: params.p_pinned ? '2026-11-19T02:00:00Z' : null
              },
              error: null
            };
          }
          return { data: null, error: null };
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: async () => { }
      })
    },
    URL, URLSearchParams, Map, Set, Intl, Promise, Error, RegExp, Date, Math, JSON, Array, Object, String, Number, Boolean,
    CustomEvent: class CustomEvent { constructor(t, i = {}) { this.type = t; this.detail = i.detail; } },
    Event: class Event { constructor(t) { this.type = t; } },
    matchMedia: () => ({ matches: false, addEventListener() { }, removeEventListener() { } }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    MutationObserver: class { observe() { } },
    CSS: { escape: (v) => String(v) },
    addEventListener() { },
    removeEventListener() { },
    dispatchEvent() { return true; },
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() { },
    console
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js', timeout: 5000 });

  await ctx.window.Ipon.init({ requireAuth: true });
  const saListEl = getEl('sa-announcement-list');
  const saCtrl = ctx.window.Ipon.bindAnnouncements({ listElement: saListEl, allowPin: true });
  await saCtrl.load();

  // Pinned item renders first even though created earlier, with card pin toggle visible to Super Admin
  const idxPinnedBefore = saListEl.innerHTML.indexOf('Important Rules');
  const idxUnpinnedBefore = saListEl.innerHTML.indexOf('Regular New Update');
  assert.ok(idxPinnedBefore >= 0 && idxUnpinnedBefore > idxPinnedBefore, 'pinned item renders before unpinned');
  assert.match(saListEl.innerHTML, /class="announcement-pinned-badge"/);
  assert.match(saListEl.innerHTML, /data-announcement-pin="ann-new"/);
  assert.match(saListEl.innerHTML, /data-announcement-profile-item="ann-new"/);

  const authorDp = makeEl('button');
  authorDp.dataset.announcementProfileItem = 'ann-new';
  authorDp.closest = (sel) => (sel.includes('[data-announcement-profile-item]') ? authorDp : null);
  saListEl.dispatchEvent({ type: 'click', target: authorDp, stopPropagation() { } });
  await new Promise((r) => setTimeout(r, 15));
  assert.ok(rpcCalls.some((c) => c.fn === 'get_group_member_profile' && c.params.p_target_id === 'f58acf43-a3ec-4c31-a4fa-9def23c838f1'));
  assert.equal(authorDp.disabled, false);
  assert.equal(getEl('announcement-viewer-dialog').open, false, 'DP click must open the profile, not the announcement viewer');

  // Clicking card pin button pins ann-new via RPC and promotes it above earlier-pinned item
  const pinCardBtn = {
    disabled: false,
    dataset: { announcementPin: 'ann-new' },
    closest: (sel) => (sel.includes('[data-announcement-pin]') ? pinCardBtn : null)
  };
  saListEl.dispatchEvent({ type: 'click', target: pinCardBtn, stopPropagation() { } });
  await new Promise((r) => setTimeout(r, 15));

  assert.ok(rpcCalls.some((c) => c.fn === 'set_announcement_pinned' && c.params.p_announcement_id === 'ann-new' && c.params.p_pinned === true));
  const idxNewlyPinned = saListEl.innerHTML.indexOf('Regular New Update');
  const idxOlderPinned = saListEl.innerHTML.indexOf('Important Rules');
  assert.ok(idxNewlyPinned >= 0 && idxOlderPinned > idxNewlyPinned, 'newly pinned announcement floats to very top');

  // Opening viewer shows pinned badge & Unpin button for Super Admin, and clicking Unpin toggles off
  await saCtrl.openMatching({ id: 'ann-new' });
  const viewerDlg = getEl('announcement-viewer-dialog');
  const viewerDp = makeEl('button');
  viewerDp.dataset.announcementProfileItem = 'ann-new';
  viewerDp.closest = (sel) => (sel.includes('[data-announcement-profile-item]') ? viewerDp : null);
  getEl('announcement-viewer-meta').dispatchEvent({ type: 'click', target: viewerDp });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(rpcCalls.filter((c) => c.fn === 'get_group_member_profile').length, 1, 'the second open reuses the existing profile cache');
  const viewerPinned = getEl('announcement-viewer-pinned');
  const viewerPinBtn = getEl('announcement-viewer-pin');
  assert.equal(viewerDlg.classList.contains('is-pinned'), true);
  assert.equal(viewerPinned.hidden, false);
  assert.equal(viewerPinBtn.hidden, false);
  assert.equal(viewerPinBtn.getAttribute('aria-pressed'), 'true');

  await viewerPinBtn.onclick();
  assert.ok(rpcCalls.some((c) => c.fn === 'set_announcement_pinned' && c.params.p_announcement_id === 'ann-new' && c.params.p_pinned === false));
  assert.equal(viewerDlg.classList.contains('is-pinned'), false);
  assert.equal(viewerPinned.hidden, true);

  // Group dashboard (allowPin: false, Member/Admin) sees pinned styling & badge, but NO pin toggle buttons
  const dashListEl = getEl('dashboard-announcement-list');
  const dashCtrl = ctx.window.Ipon.bindAnnouncements({ listElement: dashListEl, allowPin: false });
  await dashCtrl.load();
  assert.match(dashListEl.innerHTML, /class="announcement-item is-owner is-pinned"/);
  assert.doesNotMatch(dashListEl.innerHTML, /data-announcement-pin=/);
  await dashCtrl.openMatching({ id: 'ann-pinned' });
  assert.equal(getEl('announcement-viewer-pinned').hidden, false);
  assert.equal(getEl('announcement-viewer-pin').hidden, true);
});
