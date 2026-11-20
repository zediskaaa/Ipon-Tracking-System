import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('migration 20261118_109 permanently exempts breadspanish231@gmail.com from inactivity retention and links SUPER_ADMIN announcement avatar', () => {
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
  assert.match(sql, /create or replace function public\.announcement_author_social_id\(/i);
  assert.match(sql, /create or replace view public\.v_announcements[\s\S]*?as author_social_user_id/i);
  assert.match(sql, /grant select on public\.v_announcements to authenticated;/i);

  assert.match(coreJs, /author_social_user_id/);
  assert.match(coreJs, /data-social-hover-dp=/);
  assert.match(coreJs, /announcement-owner-dp-btn/);
  assert.match(coreJs, /event\.target\.closest\('\.announcement-reactions-bar, \[data-social-user-dp\](?:, \[data-announcement-pin\])?(?:, \[data-announcement-edit\])?'\)/);
  assert.match(css, /\.announcement-owner-dp-btn\s*\{/);

  const sql110 = read('database/migrations/20261118_110_exempt_additional_protected_account.sql');
  assert.match(sql110, /^\s*begin;/i);
  assert.match(sql110, /commit;\s*$/i);
  assert.match(sql110, /'20261118_110'/);
  assert.match(sql110, /'breadspanish231@gmail\.com'/);
  assert.match(sql110, /'antalannhicolejoy19@gmail\.com'/);
  assert.match(sql110, /create or replace function public\.announcement_author_social_id[\s\S]*?'breadspanish231@gmail\.com'/i);
});

test('hovering SUPER_ADMIN announcement DP opens linked profile popover and Message action opens workspace chat', async () => {
  const messagesJs = read('js/messages.js');
  const viewerId = '11111111-1111-4111-8111-111111111111';
  const linkedOwnerSocialId = '77777777-7777-4777-8777-777777777777';
  const convId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const els = new Map();
  const docListeners = new Map();
  const rpcCalls = [];

  const makeEl = (tag = 'div', id = '') => {
    const classes = new Set();
    const attrs = new Map();
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
      children: [],
      parentElement: null,
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      appendChild(child) {
        child.parentElement = el;
        el.children.push(child);
        return child;
      },
      contains: () => false,
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() { },
      showModal() { el.open = true; },
      close() { el.open = false; },
      getBoundingClientRect: () => ({ left: 120, right: 148, top: 180, bottom: 208, width: 28, height: 28 }),
      addEventListener() { },
      dispatchEvent() { return true; }
    };
    if (id) els.set(id, el);
    return el;
  };
  const getEl = (id) => {
    if (!els.has(id)) makeEl(id.includes('dialog') || id === 'announcement-viewer' ? 'dialog' : 'div', id);
    return els.get(id);
  };

  const makeChannelClient = () => ({
    from: () => ({
      select: () => ({
        like: () => ({
          order: () => ({
            limit: async () => ({ data: [], error: null })
          })
        })
      })
    }),
    channel: () => ({
      on() { return this; },
      subscribe() { return this; },
      async send() { },
      unsubscribe() { }
    }),
    removeChannel() { }
  });

  const ctx = {
    window: null,
    innerWidth: 1024,
    innerHeight: 768,
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      documentElement: makeEl('html'),
      body: Object.assign(makeEl('body'), {
        dataset: { page: 'dashboard' },
        insertAdjacentHTML() { }
      }),
      getElementById: (id) => getEl(id),
      createElement: (t) => makeEl(t),
      querySelector: (sel) => (sel.includes('dialog[open]') && els.get('announcement-viewer')?.open ? els.get('announcement-viewer') : null),
      querySelectorAll: () => [],
      addEventListener(ev, fn) {
        if (!docListeners.has(ev)) docListeners.set(ev, []);
        docListeners.get(ev).push(fn);
      },
      removeEventListener() { }
    },
    navigator: { userAgent: 'Mozilla/5.0' },
    location: { origin: 'https://myipon.example', search: '' },
    CSS: { escape: (v) => String(v) },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    removeEventListener() { },
    console,
    Ipon: {
      profile: { id: viewerId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Member Viewer', chat_privacy: { show_online: true } },
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''),
      isUserOnline: () => false,
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      syncMessagesBadges() { },
      setBusy() { },
      toast() { },
      confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e || 'Error'),
      dateLabel: (d) => String(d || ''),
      rpc: async (name, params = {}) => {
        rpcCalls.push({ name, params });
        if (name === 'get_conversations') {
          return [{
            id: convId,
            kind: 'DIRECT',
            status: 'ACCEPTED',
            initiator_id: viewerId,
            peer: { id: linkedOwnerSocialId, full_name: 'Zedrick De Monteverde', allow_online_status: true },
            last_message_at: '2026-11-18T00:07:00Z'
          }];
        }
        if (name === 'get_social_user_profile') {
          assert.equal(params.p_target_id, linkedOwnerSocialId);
          return {
            id: linkedOwnerSocialId,
            full_name: 'Zedrick De Monteverde',
            username: 'zedrick',
            friendship_status: 'FRIENDS',
            can_send_friend_request: false,
            can_message: true,
            bio: 'System builder',
            shared_groups: ['Main Group'],
            friends_count: 2,
            mutual_friends_count: 0,
            mutual_friends: []
          };
        }
        if (name === 'start_or_open_direct_chat') {
          return { id: convId, status: 'ACCEPTED', initiator_id: viewerId };
        }
        if (name === 'get_conversation_messages') {
          return {
            conversation: {
              id: linkedOwnerSocialId,
              conversation_id: convId,
              kind: 'DIRECT',
              full_name: 'Zedrick De Monteverde',
              friendship_status: 'FRIENDS',
              allow_online_status: true
            },
            messages: [],
            pinned_messages: [],
            has_older: false
          };
        }
        return [];
      },
      client: makeChannelClient(),
      sb: makeChannelClient
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  for (const id of [
    'msg-profile-popover', 'msg-mutual-popover', 'msg-workspace-dialog', 'announcement-viewer',
    'msg-view-chats', 'msg-view-friends', 'msg-view-alerts', 'msg-conv-list', 'msg-list-search',
    'msg-thread-empty', 'msg-thread-active', 'msg-thread-header', 'msg-messages-list', 'msg-composer-input'
  ]) {
    getEl(id);
  }
  getEl('msg-profile-popover').hidden = true;
  getEl('msg-mutual-popover').hidden = true;
  getEl('announcement-viewer').open = true;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init(ctx.Ipon.profile);

  const emitDoc = async (type, ev) => {
    for (const fn of (docListeners.get(type) || [])) {
      await fn(ev);
    }
  };

  const hoverBtn = {
    dataset: { socialHoverDp: linkedOwnerSocialId, socialUserDp: linkedOwnerSocialId },
    getBoundingClientRect: () => ({ left: 100, right: 128, top: 150, bottom: 178, width: 28, height: 28 }),
    closest: (sel) => (sel.includes('[data-social-hover-dp]') || sel.includes('[data-social-user-dp]') ? hoverBtn : null)
  };

  await emitDoc('mouseover', { target: hoverBtn });
  await new Promise((r) => setTimeout(r, 150));

  const profPop = getEl('msg-profile-popover');
  assert.equal(profPop.hidden, false);
  assert.equal(profPop.dataset.pinned, '0');
  assert.match(profPop.innerHTML, /Zedrick De Monteverde/);
  assert.doesNotMatch(profPop.innerHTML, /class="msg-rel-badge"/);
  assert.doesNotMatch(profPop.innerHTML, /<small class="msg-pop-status">Friends\b/);
  assert.match(profPop.innerHTML, /<small class="msg-pop-status">@zedrick · 2 friends<\/small>/);

  // Mouseout closes unpinned hover popover after delay
  await emitDoc('mouseout', { target: hoverBtn, relatedTarget: null });
  await new Promise((r) => setTimeout(r, 240));
  assert.equal(profPop.hidden, true);

  // Clicking pins popover and clicking Message opens workspace dialog and closes announcement viewer
  await emitDoc('click', { target: hoverBtn, stopPropagation() { } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(profPop.hidden, false);
  assert.equal(profPop.dataset.pinned, '1');

  const msgBtn = {
    dataset: { socialAction: 'message', targetId: linkedOwnerSocialId },
    closest: (sel) => (sel.includes('[data-social-action]') ? msgBtn : null)
  };
  await emitDoc('click', { target: msgBtn, stopPropagation() { } });
  assert.equal(getEl('announcement-viewer').open, false);
  assert.equal(getEl('msg-workspace-dialog').open, true);
  assert.ok(rpcCalls.some((c) => c.name === 'start_or_open_direct_chat' && c.params.p_target_id === linkedOwnerSocialId));
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
