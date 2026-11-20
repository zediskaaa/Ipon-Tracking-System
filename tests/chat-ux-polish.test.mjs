import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('migration 140 exposes savings workspace roles for group chat members and message senders', () => {
  const mig = read('database/migrations/20261120_140_group_chat_member_roles.sql');
  const schema = read('database/schema.sql');
  for (const sql of [mig, schema]) {
    assert.match(sql, /'20261120_140'/);
    assert.match(sql, /'app_role',\s*coalesce\(/i);
    assert.match(sql, /'sender_app_role',\s*case/i);
    assert.match(sql, /select chat_privacy, group_id into v_me_privacy, v_viewer_group_id/i);
  }
});

test('CSS aligns voice bar height to composer input, maximizes group modal space, extends notification panel to bottom, and styles compact role badges', () => {
  const css = read('css/app.css');
  // Voice recording pill matches 40px single-row composer input height
  assert.match(css, /\.msg-voice-recording\s*\{[^}]*height:\s*40px;[^}]*min-height:\s*40px;[^}]*max-height:\s*40px;/s);
  assert.match(css, /\.msg-voice-recording \.msg-voice-send\s*\{[^}]*flex-direction:\s*row;/s);
  // New Group Chat dialog overrides UA max-width/max-height to maximize space
  assert.match(css, /\.msg-group-dialog\s*\{[^}]*width:\s*min\(520px,\s*calc\(100vw - 20px\)\);[^}]*max-width:\s*calc\(100vw - 20px\);/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)\s*\{\s*\.msg-group-dialog\s*\{[^}]*width:\s*calc\(100vw - 12px\);[^}]*max-width:\s*calc\(100vw - 12px\);/s);
  assert.match(css, /\.msg-group-form\s*\{[^}]*gap:\s*8px;/s);
  assert.match(css, /\.msg-group-picker-block\s*\{[^}]*gap:\s*6px;/s);
  assert.match(css, /\.msg-group-form-actions\s*\{[^}]*padding:\s*6px 0 10px;/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.msg-group-form-actions\s*\{[^}]*padding:\s*4px 0 8px;/s);
  // Notification panel reaches bottom edge cleanly on desktop and mobile (both app.css & hero-plates.css)
  const heroCss = read('css/hero-plates.css');
  assert.match(css, /\.notification-dialog\{[^}]*inset:68px 16px 0 auto;[^}]*height:calc\(100dvh - 68px\);[^}]*border-radius:16px 16px 0 0/);
  assert.match(css, /\.notification-dialog\s*\{[^}]*inset:\s*var\(--notification-top,\s*70px\)[^}]*\s0\s[^}]*height:\s*auto;[^}]*max-height:\s*none;/s);
  assert.match(heroCss, /\.notification-dialog\s*\{[^}]*inset:var\(--notification-top,70px\)[^}]*\s0\s[^}]*height:auto;[^}]*max-height:none;/s);
  assert.doesNotMatch(heroCss, /\.notification-dialog\s*\{[^}]*height:min\(560px/s);
  // Compact Admin / Treasurer group chat sender badges
  assert.match(css, /\.msg-sender-role\s*\{[^}]*border-radius:\s*999px;[^}]*font-size:\s*9\.5px;/s);
  assert.match(css, /\.msg-sender-role\.is-admin\s*\{/);
  assert.match(css, /\.msg-sender-role\.is-treasurer\s*\{/);
});

test('conversation intro stays in the thread, header status excludes typing, and empty threads cannot ghost-scroll', () => {
  const messagesJs = read('js/messages.js');
  const css = read('css/app.css');

  assert.match(messagesJs, /list\.innerHTML = `\$\{welcomeHtml\}\$\{html\}\$\{pendingHtml\}`/);
  assert.match(messagesJs, /scrollWrap\?\.classList\.toggle\('is-empty-thread', isEmpty\)/);
  assert.match(messagesJs, /const peerStatus = formatStatusLine\(conv\);/);
  assert.doesNotMatch(messagesJs, /msg-peer-status\$\{isTyping/);
  assert.match(css, /\.msg-scroll-wrap\.is-empty-thread\s*\{[^}]*overflow-y:\s*hidden;[^}]*overscroll-behavior-y:\s*none;/s);
  assert.match(css, /\.msg-scroll-wrap\.is-no-scroll\s*\{[^}]*overflow-y:\s*hidden;[^}]*overscroll-behavior-y:\s*none;[^}]*scrollbar-width:\s*none;/s);
  assert.match(css, /html:has\(\.msg-dialog\[open\]\),\s*body:has\(\.msg-dialog\[open\]\)\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /@media \(max-width: 820px\)\s*\{\s*\.msg-dialog\[open\]\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*margin:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.msg-typing-live\s*\{[^}]*overflow:\s*hidden;[^}]*visibility:\s*hidden;/s);
  assert.match(messagesJs, /function syncThreadScrollLock\(\)/);
  assert.match(messagesJs, /wrap\.classList\?\.toggle\('is-no-scroll', !needsScroll\)/);
  assert.doesNotMatch(messagesJs, /<span class="msg-self-pill">You<\/span>/);
  assert.doesNotMatch(messagesJs, /<span class="msg-rel-chip">Saved Messages<\/span>/);
  assert.doesNotMatch(messagesJs, /Message yourself · Personal notes/);
  assert.match(css, /\.msg-thread-welcome-hero\s*\{[^}]*margin:\s*0 auto 12px;[^}]*padding:\s*14px 10px 12px;/s);
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
    ['ipon_shell_snapshot', JSON.stringify({ userId: 'u-edna', role: 'MEMBER', fullName: 'Edna Fruto', unreadCount: 0, unreadMessagesCount: 0 })]
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

test('runtime typing sound plays once per typing appearance, voice recording plays start/cancel sounds, unread divider stays anchored, and group chats show Admin & Treasurer badges', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const adminId = '22222222-2222-4222-8222-222222222222';
  const treasId = '33333333-3333-4333-8333-333333333333';
  const memberId = '44444444-4444-4444-8444-444444444444';
  const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const playedSounds = [];
  const typingHandlers = [];
  const els = new Map();
  const makeEl = (id = '') => {
    const classes = new Set();
    const attrs = new Map();
    const el = {
      id,
      tagName: 'DIV',
      open: false,
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      innerHTML: '',
      scrollTop: 900,
      scrollHeight: 920,
      clientHeight: 20,
      style: {},
      dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, force) => {
          const on = force === undefined ? !classes.has(c) : Boolean(force);
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      addEventListener() { },
      removeEventListener() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() { },
      showModal() { this.open = true; },
      close() { this.open = false; }
    };
    return el;
  };
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };

  let serverMessages = [
    { id: 'm1', conversation_id: convId, sender_id: adminId, sender_name: 'Maria Santos', sender_app_role: 'ADMIN', body: 'Hello group', message_type: 'TEXT', created_at: '2026-11-20T09:00:00Z', attachments: [], reactions: [] },
    { id: 'm2', conversation_id: convId, sender_id: treasId, sender_name: 'Ana Cruz', sender_app_role: 'TREASURER', body: 'Funds updated', message_type: 'TEXT', created_at: '2026-11-20T09:05:00Z', attachments: [], reactions: [] },
    { id: 'm3', conversation_id: convId, sender_id: memberId, sender_name: 'Juan Reyes', sender_app_role: 'MEMBER', body: 'Noted thanks!', message_type: 'TEXT', created_at: '2026-11-20T09:10:00Z', attachments: [], reactions: [] }
  ];
  let serverUnreadFirstId = 'm2';

  const makeChannel = () => {
    const ch = {
      on(_type, filter, cb) {
        if (filter?.event === 'typing') typingHandlers.push(cb);
        return ch;
      },
      subscribe() { return ch; },
      send: async () => 'ok'
    };
    return ch;
  };

  const doc = {
    visibilityState: 'visible',
    documentElement: { dataset: {}, style: { setProperty() { } } },
    body: { insertAdjacentHTML() { }, classList: makeEl().classList },
    getElementById: getEl,
    querySelector: (sel) => (sel.startsWith('#') ? getEl(sel.slice(1)) : null),
    querySelectorAll: () => [],
    addEventListener() { },
    removeEventListener() { }
  };

  let recorderStopped = false;
  class FakeMediaRecorder {
    static isTypeSupported() { return true; }
    constructor(stream) { this.stream = stream; this.mimeType = 'audio/webm'; }
    start() { }
    stop() { recorderStopped = true; this.onstop?.(); }
  }

  const ctx = {
    console,
    Date,
    Math,
    Map,
    Set,
    JSON,
    Promise,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() { } },
    URLSearchParams,
    location: { search: '', pathname: '/dashboard.html', hash: '' },
    Blob: class FakeBlob { constructor(parts, opts) { this.size = 10; this.type = opts?.type || 'audio/webm'; } },
    File: class FakeFile { constructor(parts, name, opts) { this.name = name; this.size = 10; this.type = opts?.type || 'audio/webm'; } },
    MediaRecorder: FakeMediaRecorder,
    navigator: {
      userAgent: 'Mozilla/5.0',
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop() { } }] })
      }
    },
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    matchMedia: () => ({ matches: false }),
    innerWidth: 1200,
    document: doc,
    addEventListener() { },
    removeEventListener() { },
    Ipon: {
      profile: { id: meId, role: 'ADMIN', status: 'ACTIVE', full_name: 'Alex Rivera', chat_privacy: { show_online: true } },
      client: {
        channel: makeChannel,
        removeChannel() { },
        from: () => {
          const q = new Proxy({}, {
            get(_t, prop) {
              if (prop === 'then') return (res) => Promise.resolve({ data: [], error: null }).then(res);
              return () => q;
            }
          });
          return q;
        }
      },
      escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || 'U').slice(0, 2).toUpperCase(),
      isUserOnline: () => false,
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      verifiedBadgesHtml: () => '',
      toast() { },
      friendlyError: (e) => String(e?.message || e),
      playUiSound: (kind) => { playedSounds.push(kind); return true; },
      rpc: async (name) => {
        if (name === 'get_social_overview') return { me: { id: meId }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        if (name === 'get_conversations') {
          return [{
            id: convId,
            kind: 'GROUP',
            title: 'Savings Group',
            member_count: 4,
            unread_count: 2,
            last_message_at: '2026-11-20T09:10:00Z'
          }];
        }
        if (name === 'get_social_notifications') return [];
        if (name === 'get_conversation_messages') {
          return {
            conversation: {
              id: convId,
              conversation_id: convId,
              kind: 'GROUP',
              title: 'Savings Group',
              my_role: 'OWNER',
              member_count: 4,
              members: [
                { id: meId, full_name: 'Alex Rivera', role: 'OWNER', app_role: 'ADMIN' },
                { id: adminId, full_name: 'Maria Santos', role: 'ADMIN', app_role: 'ADMIN' },
                { id: treasId, full_name: 'Ana Cruz', role: 'MEMBER', app_role: 'TREASURER' },
                { id: memberId, full_name: 'Juan Reyes', role: 'MEMBER', app_role: 'MEMBER' }
              ],
              receipts_enabled: true
            },
            has_older: false,
            unread_first_id: serverUnreadFirstId,
            pinned_messages: [],
            messages: serverMessages.map((m) => ({ ...m }))
          };
        }
        return {};
      }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init(ctx.Ipon.profile);
  await ctx.IponMessages.openWorkspace({ conversationId: convId });

  // 1. Group chat shows sender names + compact Admin / Treasurer role badges (and none for plain Member)
  const listHtml = getEl('msg-messages-list').innerHTML;
  assert.match(listHtml, /class="msg-sender-name">Maria Santos<span class="msg-sender-role is-admin">Admin<\/span><\/span>/);
  assert.match(listHtml, /class="msg-sender-name">Ana Cruz<span class="msg-sender-role is-treasurer">Treasurer<\/span><\/span>/);
  assert.match(listHtml, /class="msg-sender-name">Juan Reyes<\/span>/);

  // 2. Unread divider anchors on m2 when opening convo and STAYS on m2 even when m4 arrives live
  const sepIdx1 = listHtml.indexOf('id="msg-unread-sep"');
  const m2Idx1 = listHtml.indexOf('data-msg-id="m2"');
  const m3Idx1 = listHtml.indexOf('data-msg-id="m3"');
  assert.ok(sepIdx1 > 0 && sepIdx1 < m2Idx1 && m2Idx1 < m3Idx1, 'Expected Unread divider right above m2 on initial open');

  serverMessages.push({
    id: 'm4', conversation_id: convId, sender_id: memberId, sender_name: 'Juan Reyes', sender_app_role: 'MEMBER',
    body: 'Another message while in convo', message_type: 'TEXT', created_at: '2026-11-20T09:11:00Z', attachments: [], reactions: []
  });
  serverUnreadFirstId = 'm4';
  await ctx.IponMessages.openWorkspace({ conversationId: convId });

  const listHtmlAfter = getEl('msg-messages-list').innerHTML;
  const sepIdx2 = listHtmlAfter.indexOf('id="msg-unread-sep"');
  const m2Idx2 = listHtmlAfter.indexOf('data-msg-id="m2"');
  const m4Idx2 = listHtmlAfter.indexOf('data-msg-id="m4"');
  assert.ok(sepIdx2 > 0 && sepIdx2 < m2Idx2 && m2Idx2 < m4Idx2, 'Expected Unread divider to remain anchored at m2 instead of moving to m4');

  // 3. Typing sound plays ONLY ONCE while peer keeps typing, and plays again only after typing clears
  assert.ok(typingHandlers.length > 0);
  const onTyping = typingHandlers.at(-1);
  playedSounds.length = 0;
  onTyping({ payload: { user_id: adminId, user_name: 'Maria Santos', typing: true } });
  onTyping({ payload: { user_id: adminId, user_name: 'Maria Santos', typing: true } });
  onTyping({ payload: { user_id: adminId, user_name: 'Maria Santos', typing: true } });
  assert.deepEqual(playedSounds, ['msg-typing'], 'Expected typing sound to play only once while already typing');

  onTyping({ payload: { user_id: adminId, user_name: 'Maria Santos', typing: false } });
  onTyping({ payload: { user_id: adminId, user_name: 'Maria Santos', typing: true } });
  assert.deepEqual(playedSounds, ['msg-typing', 'msg-typing'], 'Expected typing sound to play again once typing restarts after stopping');

  // 4. Voice recording plays msg-voice-start on start and msg-voice-cancel on cancel
  assert.match(messagesJs, /ipon\(\)\.playUiSound\?\.\('msg-voice-start'\);\s*rec\.start\(\);/);
  assert.match(messagesJs, /if \(!send\) ipon\(\)\.playUiSound\?\.\('msg-voice-cancel'\);/);
  assert.equal(recorderStopped, false);
});

test('in-conversation DP ripple activates only when peer is actively in the same convo and clears immediately on leave or blur', async () => {
  const messagesJs = read('js/messages.js');
  const css = read('css/app.css');

  assert.match(css, /\.msg-thread-header \.msg-avatar-wrap\.is-in-convo-ripple::before/);
  assert.match(css, /@keyframes msgConvoAvatarRipple/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?is-in-convo-ripple::before/);

  const meId = '11111111-1111-4111-8111-111111111111';
  const peerId = '22222222-2222-4222-8222-222222222222';
  const convId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  let presenceStateObj = {};
  let presenceSyncCb = null;
  let subscribeCb = null;
  const trackCalls = [];
  let untrackCount = 0;
  const winListeners = new Map();

  const makeEl = (id = '') => {
    const classes = new Set();
    const attrs = new Map();
    const childAvatarWrap = {
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => {
          const on = f === undefined ? !classes.has(c) : Boolean(f);
          if (on) classes.add(c); else classes.delete(c);
          return on;
        },
        contains: (c) => classes.has(c)
      }
    };
    return {
      id,
      tagName: 'DIV',
      open: false,
      hidden: false,
      disabled: false,
      value: '',
      textContent: '',
      innerHTML: '',
      scrollTop: 0,
      scrollHeight: 200,
      clientHeight: 500,
      style: {},
      dataset: {},
      _avatarWrap: childAvatarWrap,
      classList: {
        add() { },
        remove() { },
        toggle() { return false; },
        contains: () => false
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      addEventListener() { },
      removeEventListener() { },
      querySelector: (sel) => (sel.includes('.msg-avatar-wrap') ? childAvatarWrap : null),
      querySelectorAll: () => [],
      closest: () => null,
      focus() { },
      showModal() { this.open = true; },
      close() { this.open = false; }
    };
  };
  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  const docListeners = new Map();
  const doc = {
    visibilityState: 'visible',
    hasFocus: () => true,
    documentElement: { dataset: {}, style: { setProperty() { } } },
    body: { insertAdjacentHTML() { }, classList: makeEl().classList },
    getElementById: getEl,
    querySelector: (sel) => (sel.startsWith('#') ? getEl(sel.slice(1)) : null),
    querySelectorAll: () => [],
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener() { }
  };

  const makeChannel = (chanName = '') => {
    const isTypingChan = String(chanName).startsWith('chat-typing:');
    const ch = {
      on(type, filter, cb) {
        if (isTypingChan && type === 'presence' && filter?.event === 'sync') presenceSyncCb = cb;
        return ch;
      },
      presenceState: () => presenceStateObj,
      track: async (payload) => { trackCalls.push(payload); return 'ok'; },
      untrack: async () => { untrackCount++; return 'ok'; },
      subscribe(cb) { if (isTypingChan && typeof cb === 'function') subscribeCb = cb; return ch; },
      send: async () => 'ok'
    };
    return ch;
  };

  const ctx = {
    console, Date, Math, Map, Set, Array, Object, Promise, JSON, URL, URLSearchParams,
    setTimeout: () => 1,
    clearTimeout() { },
    setInterval: () => 1,
    clearInterval() { },
    requestAnimationFrame: (fn) => { fn(); return 1; },
    matchMedia: () => ({ matches: false }),
    innerWidth: 1200,
    document: doc,
    location: { search: '', href: 'https://example.test/dashboard.html', pathname: '/dashboard.html', origin: 'https://example.test' },
    navigator: { userAgent: 'Mozilla/5.0' },
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    },
    removeEventListener() { },
    Ipon: {
      profile: { id: meId, full_name: 'Edna Fruto', role: 'MEMBER', status: 'ACTIVE', chat_privacy: { show_online: true } },
      escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      initials: (n) => String(n || 'U').slice(0, 2).toUpperCase(),
      avatarMarkup: () => '<span class="avatar-circle">ZM</span>',
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      syncMessagesBadges() { },
      isUserOnline: () => true,
      verifiedBadgesHtml: () => '',
      renderSocialAppLinksHtml: () => '',
      playUiSound() { },
      toast() { },
      friendlyError: (e) => String(e?.message || e || ''),
      client: {
        channel: (name) => makeChannel(name),
        removeChannel() { },
        from: () => {
          const q = new Proxy({}, {
            get(_t, prop) {
              if (prop === 'then') return (res) => Promise.resolve({ data: [], error: null }).then(res);
              return () => q;
            }
          });
          return q;
        }
      },
      rpc: async (name) => {
        if (name === 'get_conversations') {
          return [{ id: convId, kind: 'DIRECT', peer: { id: peerId, full_name: 'Zedrick De Monteverde', username: 'zediskaaa', allow_online_status: true }, last_message_at: '2026-11-20T12:00:00Z', unread_count: 0 }];
        }
        if (name === 'get_social_overview') return { me: { id: meId, full_name: 'Edna Fruto' }, friends: [], incoming_requests: [], outgoing_requests: [], blocked: [] };
        if (name === 'get_social_notifications') return [];
        if (name === 'get_conversation_messages') {
          return {
            conversation: { id: peerId, conversation_id: convId, kind: 'DIRECT', full_name: 'Zedrick De Monteverde', username: 'zediskaaa', allow_online_status: true, profile_visible: true, friendship_status: 'FRIENDS' },
            has_older: false,
            unread_first_id: null,
            pinned_messages: [],
            messages: []
          };
        }
        return {};
      }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init(ctx.Ipon.profile);
  await ctx.IponMessages.openWorkspace({ conversationId: convId });

  const headerWrap = getEl('msg-thread-header')._avatarWrap;
  const heroWrap = getEl('msg-messages-list')._avatarWrap;

  // Initially no peer in convo -> ripple OFF
  assert.equal(headerWrap.classList.contains('is-in-convo-ripple'), false);
  assert.equal(heroWrap.classList.contains('is-in-convo-ripple'), false);

  // Channel subscribes -> tracks own in_convo presence
  assert.equal(typeof subscribeCb, 'function');
  subscribeCb('SUBSCRIBED');
  assert.equal(trackCalls.length, 1);
  assert.equal(trackCalls[0].user_id, meId);
  assert.equal(trackCalls[0].in_convo, true);

  // Peer enters the exact same conversation -> ripple ON smoothly on header & intro DP
  presenceStateObj = { [peerId]: [{ user_id: peerId, in_convo: true }] };
  presenceSyncCb();
  assert.equal(headerWrap.classList.contains('is-in-convo-ripple'), true);
  assert.equal(heroWrap.classList.contains('is-in-convo-ripple'), true);

  // Peer leaves convo (switches convo or exits Messages) -> ripple OFF immediately
  presenceStateObj = {};
  presenceSyncCb();
  assert.equal(headerWrap.classList.contains('is-in-convo-ripple'), false);
  assert.equal(heroWrap.classList.contains('is-in-convo-ripple'), false);

  // Side-by-side window blur (tab still visible) keeps presence active
  (winListeners.get('blur') || []).forEach((fn) => fn());
  assert.equal(untrackCount, 0);

  // Switching tab or minimizing app (visibilityState = hidden) untracks own presence immediately
  doc.visibilityState = 'hidden';
  (docListeners.get('visibilitychange') || []).forEach((fn) => fn());
  assert.equal(untrackCount, 1);
});
