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
  // Voice recording pill and composer tool cluster lock to exact 40px single-row height so tool buttons never shift
  assert.match(css, /\.msg-composer-form\s*\{[^}]*min-height:\s*40px;/s);
  assert.match(css, /\.msg-composer-tools\s*\{[^}]*align-items:\s*center;[^}]*align-self:\s*flex-end;[^}]*height:\s*40px;[^}]*min-height:\s*40px;/s);
  assert.match(css, /#msg-composer-input\s*\{[^}]*height:\s*40px;[^}]*min-height:\s*40px;[^}]*font-family:\s*inherit;[^}]*font-size:\s*14px;[^}]*line-height:\s*20px;/s);
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
  assert.doesNotMatch(messagesJs, /<span class="msg-rel-chip">Friend<\/span>/);
  assert.doesNotMatch(messagesJs, /<span class="msg-rel-chip">Saved Messages<\/span>/);
  assert.doesNotMatch(messagesJs, /Message yourself · Personal notes/);
  assert.match(css, /\.msg-thread-welcome-hero\s*\{[^}]*margin:\s*0 auto 12px;[^}]*padding:\s*14px 10px 12px;/s);
});

test('composer focus and keyboard resize keep the latest chat visible; typing preserves bottom position', () => {
  const source = read('js/messages.js');
  const helper = source.match(/  function scrollActiveThreadToBottom\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helper);
  let scrollTop = 240;
  const wrap = { scrollHeight: 900, classList: { contains: () => false }, get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = value; } };
  const scroll = new Function('state', 'document', 'requestAnimationFrame', 'syncThreadScrollLock', `${helper}; return scrollActiveThreadToBottom;`)(
    { activeConvId: 'chat-1' },
    { getElementById: (id) => id === 'msg-workspace-dialog' ? { open: true } : wrap },
    (callback) => callback(),
    () => {}
  );
  scroll();
  assert.equal(scrollTop, 900);
  assert.match(source, /focusin[\s\S]*?msg-composer-input'\) scrollActiveThreadToBottom\(\)/);
  assert.match(source, /visualViewport\?\.addEventListener\?\.\('resize'[\s\S]*?activeElement\?\.id === 'msg-composer-input'\) scrollActiveThreadToBottom\(\)/);
  assert.match(source, /const wasNearBottom = wrap && wrap\.scrollHeight - wrap\.scrollTop - wrap\.clientHeight < 140;/);
  assert.match(source, /if \(wasNearBottom && wrap && !wrap\.classList\?\.contains\('is-no-scroll'\)\)/);
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
  assert.doesNotMatch(css, /\.msg-welcome-avatar \.msg-avatar-wrap\.is-in-convo-ripple/);
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

  // Peer enters the exact same conversation -> ripple ON smoothly on header DP only (not redundant intro hero DP)
  presenceStateObj = { [peerId]: [{ user_id: peerId, in_convo: true }] };
  presenceSyncCb();
  assert.equal(headerWrap.classList.contains('is-in-convo-ripple'), true);
  assert.equal(heroWrap.classList.contains('is-in-convo-ripple'), false);

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

test('editing a chat message clears the composer input and draft immediately without leaking edit text back', async () => {
  const src = read('js/messages.js');
  assert.match(src, /if \(prevInput && !state\.editingMsg\) state\.draftsByConv\.set\(state\.activeConvId, prevInput\.value\);/);
  assert.match(src, /if \(state\.activeConvId && !state\.editingMsg\) state\.draftsByConv\.set\(state\.activeConvId, ev\.target\.value\);/);
  assert.match(src, /function restoreDraftAfterEdit\(\)[\s\S]*?state\.draftsByConv\.get\(state\.activeConvId\)/);
  assert.match(src, /function startReplyToMessage\(msgObj\)[\s\S]*?if \(wasEditing\) restoreDraftAfterEdit\(\);/);
  assert.match(src, /#msg-cancel-context[\s\S]*?if \(wasEditing\) restoreDraftAfterEdit\(\);/);

  const submitSrc = src.match(/async function submitComposer\(event\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(submitSrc, 'submitComposer must exist');

  const inputEl = { value: 'edited message text', style: {}, scrollHeight: 40 };
  const sendBtn = { disabled: false, classList: { add() {}, remove() {} } };
  const state = {
    activeConvId: 'conv-1',
    editingMsg: { id: 'msg-1', body: 'old text' },
    draftsByConv: new Map([['conv-1', 'stale edited text']]),
    uploadQueue: [],
    replyToMsg: null
  };
  let rpcArgs = null;
  let counterVal = -1;
  let contextRenders = 0;

  const submitComposer = new Function(
    'state', 'document', 'isEligible', 'ipon', 'sendTypingBroadcast',
    'autoResizeTextarea', 'syncComposerCharCounter', 'renderContextBar',
    'openConversation', 'refreshConversations', 'clearUploadQueue', 'enqueuePendingMessage', 'MAX_ATTACHMENTS_PER_MSG',
    `${submitSrc}; return submitComposer;`
  )(
    state,
    { getElementById: (id) => (id === 'msg-composer-input' ? inputEl : (id === 'msg-send-btn' ? sendBtn : null)) },
    () => true,
    () => ({
      rpc: async (name, args) => { rpcArgs = { name, args }; return { id: args.p_message_id, body: args.p_body }; },
      toast: () => {},
      friendlyError: (e) => String(e)
    }),
    () => {},
    (el) => { el.style.height = '40px'; },
    (n) => { counterVal = n; },
    () => { contextRenders += 1; },
    async () => {},
    async () => {},
    () => {},
    () => {},
    5
  );

  await submitComposer({ preventDefault() {} });
  assert.equal(rpcArgs.name, 'edit_chat_message');
  assert.equal(rpcArgs.args.p_message_id, 'msg-1');
  assert.equal(rpcArgs.args.p_body, 'edited message text');
  assert.equal(state.editingMsg, null);
  assert.equal(inputEl.value, '');
  assert.equal(inputEl.style.height, '40px');
  assert.equal(counterVal, 0);
  assert.equal(state.draftsByConv.has('conv-1'), false);
  assert.equal(contextRenders, 1);
  assert.equal(sendBtn.disabled, false);
});

test('chat conversation list rows never shrink vertically or clip previews on small phone viewports', () => {
  const css = read('css/app.css');
  const messagesJs = read('js/messages.js');

  assert.match(css, /\.msg-conv-list\s*>\s*\*,\s*\.msg-drawer-body\s*>\s*\*,\s*\.msg-panel-view\s*>\s*\*,\s*\.msg-messages-list\s*>\s*\*\s*\{\s*flex-shrink:\s*0;\s*\}/);
  assert.match(css, /\.msg-conv-row\s*\{[^}]*flex:\s*0 0 auto;[^}]*overflow:\s*hidden;/);
  assert.match(css, /\.msg-conv-list\s*\{[^}]*env\(safe-area-inset-bottom/);
  assert.match(messagesJs, /placeholder="Search chats or people…"/);
});

test('friend request notifications route strictly to Friends > Friend Requests while message requests route to Message Requests', async () => {
  const mig153 = read('database/migrations/20261121_153_friend_request_notification_link.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');
  const androidPoll = read('android/app/src/main/java/com/myipon/app/NotificationPollReceiver.java');
  const sendPush = read('supabase/functions/send-push/index.ts');

  assert.match(mig153, /'SOCIAL_FRIEND_REQUEST'[\s\S]*?'dashboard\.html\?messages=friend_requests'/);
  assert.match(mig153, /update public\.notifications[\s\S]*?set link = 'dashboard\.html\?messages=friend_requests'[\s\S]*?where type = 'SOCIAL_FRIEND_REQUEST'/i);
  assert.match(schema, /'SOCIAL_FRIEND_REQUEST'[\s\S]*?'dashboard\.html\?messages=friend_requests'/);
  assert.match(androidPoll, /"SOCIAL_FRIEND_REQUEST"\.equals\(upperType\)[\s\S]*?dashboard\.html\?messages=friend_requests/);
  assert.match(sendPush, /notif\.type === 'SOCIAL_FRIEND_REQUEST'[\s\S]*?dashboard\.html\?messages=friend_requests/);
  assert.match(coreJs, /if \(type === 'SOCIAL_FRIEND_REQUEST'\) return `\$\{targetPage\}\?messages=friend_requests`;/);

  // Runtime check of core.js resolveNotificationTarget
  const noop = () => {};
  const coreCtx = {
    console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, URL, URLSearchParams, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    location: { pathname: '/dashboard.html', href: 'https://myipon.app/dashboard.html', origin: 'https://myipon.app', search: '', hash: '' },
    navigator: { userAgent: 'Mozilla/5.0', onLine: true },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { replaceState: noop },
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    document: {
      documentElement: { setAttribute: noop, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false } },
      body: { dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, appendChild: noop, insertAdjacentHTML: noop },
      head: { appendChild: noop, insertAdjacentHTML: noop },
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false }, setAttribute: noop, appendChild: noop, addEventListener: noop })
    },
    supabase: { createClient: () => ({ rpc: async () => ({ data: null }), from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }) }, channel: () => ({ on() { return this; }, subscribe: noop }) }) }
  };
  coreCtx.window = coreCtx;
  coreCtx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, coreCtx, { filename: 'js/core.js' });

  const resolveTarget = coreCtx.window.Ipon.resolveNotificationTarget;
  assert.equal(resolveTarget({ type: 'SOCIAL_FRIEND_REQUEST', link: 'dashboard.html?messages=requests' }, 'MEMBER'), 'dashboard.html?messages=friend_requests');
  assert.equal(resolveTarget({ type: 'SOCIAL_FRIEND_REQUEST', link: '' }, 'MEMBER'), 'dashboard.html?messages=friend_requests');
  assert.equal(resolveTarget({ type: 'SOCIAL_FRIEND_ACCEPTED', link: 'dashboard.html?messages=requests' }, 'MEMBER'), 'dashboard.html?messages=friends');
  assert.equal(resolveTarget({ type: 'SOCIAL_MESSAGE_REQUEST', link: 'dashboard.html?messages=requests&chat=conv-req-1' }, 'MEMBER'), 'dashboard.html?messages=requests&chat=conv-req-1');
  assert.equal(resolveTarget({ type: 'SOCIAL_NEW_MESSAGE', link: 'dashboard.html?chat=conv-1&msg=m-9' }, 'MEMBER'), 'dashboard.html?chat=conv-1&msg=m-9');

  // Runtime check of messages.js openFromNotification routing
  const fnMatch = messagesJs.match(/async function openFromNotification\([\s\S]*?\n  \}/);
  assert.ok(fnMatch, 'openFromNotification must exist in js/messages.js');
  const calls = [];
  const state = { friendsSubTab: 'all' };
  const route = new Function(
    'isEligible', 'location', 'URL', 'state', 'openWorkspace',
    `${fnMatch[0]}\nreturn openFromNotification;`
  )(
    () => true,
    { href: 'https://myipon.app/dashboard.html' },
    URL,
    state,
    async (opts) => { calls.push({ ...opts, friendsSubTab: state.friendsSubTab }); }
  );

  // 1) Friend request via URL-only (e.g. Android native push tap)
  await route({ link: 'dashboard.html?messages=friend_requests' });
  assert.deepEqual(calls.at(-1), { tab: 'friends', subTab: 'incoming', friendsSubTab: 'incoming' });

  // 2) Legacy friend request row with stale ?messages=requests link
  await route({ type: 'SOCIAL_FRIEND_REQUEST', link: 'dashboard.html?messages=requests' });
  assert.deepEqual(calls.at(-1), { tab: 'friends', subTab: 'incoming', friendsSubTab: 'incoming' });

  // 3) Friend accepted -> Friends > My Friends
  await route({ type: 'SOCIAL_FRIEND_ACCEPTED', link: 'dashboard.html?messages=friends' });
  assert.deepEqual(calls.at(-1), { tab: 'friends', subTab: 'all', friendsSubTab: 'all' });

  // 4) Message request -> Requests (Message Requests) with conversationId
  await route({ type: 'SOCIAL_MESSAGE_REQUEST', link: 'dashboard.html?messages=requests&chat=conv-req-1' });
  assert.deepEqual(calls.at(-1), { tab: 'requests', conversationId: 'conv-req-1', messageId: null, friendsSubTab: 'all' });

  // 5) URL-only message request -> Requests (Message Requests)
  await route({ link: 'dashboard.html?messages=requests&chat=conv-req-2' });
  assert.deepEqual(calls.at(-1), { tab: 'requests', conversationId: 'conv-req-2', messageId: null, friendsSubTab: 'all' });

  // 6) Regular chat message -> Chats with conversationId & messageId
  await route({ type: 'SOCIAL_NEW_MESSAGE', link: 'dashboard.html?chat=conv-9&msg=msg-77' });
  assert.deepEqual(calls.at(-1), { tab: 'chats', conversationId: 'conv-9', messageId: 'msg-77', friendsSubTab: 'all' });
});

test('double-tap heart react, double long-press text copy unlock, and 3-dots menu toggle/outside-tap dismissal work end-to-end', async () => {
  const css = read('css/app.css');
  const messagesJs = read('js/messages.js');

  // CSS guards for text-select lock + unlock + double-tap heart burst
  assert.match(css, /\.msg-bubble\s*\{[^}]*user-select:\s*none;[^}]*-webkit-touch-callout:\s*none;/);
  assert.match(css, /#msg-messages-list \.msg-bubble\.is-text-selectable,\s*#msg-messages-list \.msg-bubble\.is-text-selectable \.msg-text\s*\{[^}]*user-select:\s*text;/);
  assert.match(css, /\.msg-double-tap-heart\s*\{/);
  assert.match(messagesJs, /getElementById\('msg-conv-list'\)\?\.addEventListener\('scroll',\s*closeFloatingMenus/);

  const convId = 'conv-gestures-1';
  const meId = 'u-me-1';
  const peerId = 'u-peer-1';
  const msgId = 'msg-gest-1';
  const docListeners = new Map();
  const reactionRpcCalls = [];
  let createdMenus = [];
  let selectedRanges = [];
  let trackedTriggers = [];

  const makeCls = (initial = '') => {
    const set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
    return {
      add: (...a) => a.forEach((c) => set.add(c)),
      remove: (...a) => a.forEach((c) => set.delete(c)),
      toggle: (c, f) => (f === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (f ? set.add(c) : set.delete(c))),
      contains: (c) => set.has(c),
      toString: () => [...set].join(' ')
    };
  };
  const makeEl = (id = '', className = '') => {
    const attrs = {};
    const el = {
      id,
      classList: makeCls(className),
      get className() { return this.classList.toString(); },
      set className(v) { this.classList = makeCls(v); },
      dataset: {},
      style: { setProperty: () => {}, removeProperty: () => {} },
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      open: false,
      children: [],
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() {},
      contains(target) { return target === this || this.children.includes(target); },
      getAttribute(k) { return attrs[k] ?? null; },
      setAttribute(k, v) { attrs[k] = String(v); },
      removeAttribute(k) { delete attrs[k]; },
      appendChild(node) {
        this.children.push(node);
        if (String(node.className || '').includes('msg-floating-menu')) createdMenus.push(node);
        return node;
      },
      remove() {
        createdMenus = createdMenus.filter((n) => n !== this);
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      addEventListener() {},
      getBoundingClientRect: () => ({ left: 20, right: 220, top: 100, bottom: 140, width: 200, height: 40 })
    };
    return el;
  };

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };
  ['msg-workspace-dialog', 'msg-conv-list', 'msg-messages-list', 'msg-scroll-wrap', 'msg-thread-header', 'msg-thread-active', 'msg-thread-empty', 'msg-composer-input'].forEach(getEl);

  const rangeMock = {
    selectedNode: null,
    selectNodeContents(n) { this.selectedNode = n; }
  };
  const selectionMock = {
    removeAllRanges() { selectedRanges = []; },
    addRange(r) { selectedRanges.push(r); },
    toString() { return selectedRanges.length ? 'Hello selectable text' : ''; }
  };

  const doc = {
    visibilityState: 'visible',
    documentElement: { dataset: {}, classList: makeCls() },
    body: { dataset: {}, classList: makeCls(), appendChild: () => {}, insertAdjacentHTML: () => {} },
    hasFocus: () => true,
    getElementById: (id) => getEl(id),
    createElement: (tag) => makeEl('', ''),
    createRange: () => rangeMock,
    querySelector: (sel) => {
      if (sel.includes('msg-floating-menu')) return createdMenus[0] || null;
      return null;
    },
    querySelectorAll: (sel) => {
      if (sel.includes('msg-floating-menu')) return [...createdMenus];
      if (sel.includes('aria-expanded="true"')) return trackedTriggers.filter((t) => t.getAttribute('aria-expanded') === 'true');
      return [];
    },
    addEventListener(ev, fn, capture) {
      const key = `${ev}:${capture ? 'cap' : 'bub'}`;
      if (!docListeners.has(key)) docListeners.set(key, []);
      docListeners.get(key).push(fn);
    }
  };
  const fireDoc = async (evName, eventObj) => {
    const ev = {
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...eventObj
    };
    for (const fn of (docListeners.get(`${evName}:cap`) || [])) {
      await fn(ev);
      if (ev.propagationStopped) return ev;
    }
    for (const fn of (docListeners.get(`${evName}:bub`) || [])) {
      await fn(ev);
      if (ev.propagationStopped) return ev;
    }
    return ev;
  };

  const ctx = {
    console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, URL, URLSearchParams,
    CSS: { escape: (s) => String(s) },
    navigator: { userAgent: 'Android', vibrate: () => true },
    location: { href: 'https://myipon.app/dashboard.html', search: '', pathname: '/dashboard.html' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    history: { replaceState: () => {} },
    innerWidth: 390,
    innerHeight: 844,
    getSelection: () => selectionMock,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    addEventListener: () => {},
    document: doc,
    Ipon: {
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Zedrick De Monteverde' },
      escapeHtml: (s) => String(s ?? ''),
      initials: () => 'ZD',
      avatarMarkup: () => '',
      verifiedBadgesHtml: () => '',
      renderSocialAppLinksHtml: () => '',
      bindAvatarFallbacks: () => {},
      syncPresenceDots: () => {},
      syncMessagesBadges: () => {},
      fitVerifiedNameLines: () => {},
      playUiSound: () => {},
      isUserOnline: () => true,
      toast: () => {},
      friendlyError: (e) => String(e),
      createRealtimeChannel: () => ({ on() { return this; }, subscribe: () => {} }),
      client: {
        channel: () => ({ on() { return this; }, subscribe: () => {}, track: async () => {}, untrack: async () => {}, presenceState: () => ({}) }),
        removeChannel: () => {},
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
      rpc: async (name, args) => {
        if (name === 'get_conversations') {
          return [{ id: convId, kind: 'DIRECT', peer: { id: peerId, full_name: 'Frank Lawrenze Ulog Talipan' }, last_message_at: '2026-11-21T05:00:00Z', unread_count: 0 }];
        }
        if (name === 'get_social_overview') return { me: { id: meId, full_name: 'Zedrick De Monteverde' }, friends: [], incoming_requests: [], sent_requests: [], blocked: [] };
        if (name === 'get_social_notifications') return [];
        if (name === 'get_conversation_messages') {
          return {
            conversation: { id: peerId, conversation_id: convId, kind: 'DIRECT', full_name: 'Frank Lawrenze Ulog Talipan', status: 'ACCEPTED', friendship_status: 'FRIENDS' },
            has_older: false,
            unread_first_id: null,
            pinned_messages: [],
            messages: [{ id: msgId, conversation_id: convId, sender_id: peerId, body: 'Hello selectable text', created_at: '2026-11-21T05:00:00Z', reactions: [], attachments: [] }]
          };
        }
        if (name === 'toggle_message_reaction') {
          reactionRpcCalls.push(args);
          return { ok: true };
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

  // --- 1) Double-tap message bubble -> automatic default heart ❤️ reaction ---
  const rowEl = makeEl('row-1', 'msg-row is-peer');
  rowEl.dataset.msgId = msgId;
  const wrapEl = makeEl('wrap-1', 'msg-bubble-wrap');
  const textEl = makeEl('text-1', 'msg-text');
  textEl.textContent = 'Hello selectable text';
  const bubbleEl = makeEl('bubble-1', 'msg-bubble');
  bubbleEl.children.push(textEl);
  bubbleEl.querySelector = (s) => (s === '.msg-text' ? textEl : null);
  bubbleEl.closest = (s) => {
    if (s === '#msg-messages-list .msg-bubble:not(.is-deleted)') return bubbleEl;
    if (s === '.msg-row' || s === '[data-msg-id]' || s === `[data-msg-id="${msgId}"]`) return rowEl;
    if (s === '.msg-bubble-wrap') return wrapEl;
    return null;
  };
  textEl.closest = (s) => (s === '.msg-text' ? textEl : bubbleEl.closest(s));

  // Single tap -> no reaction yet
  await fireDoc('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 120, target: textEl });
  await fireDoc('pointerup', { pointerType: 'touch', clientX: 60, clientY: 120, target: textEl });
  assert.equal(reactionRpcCalls.length, 0, 'single tap should not trigger heart reaction');

  // Second tap within 320ms -> automatic ❤️ reaction
  await fireDoc('pointerdown', { pointerType: 'touch', clientX: 62, clientY: 121, target: textEl });
  await fireDoc('pointerup', { pointerType: 'touch', clientX: 62, clientY: 121, target: textEl });
  assert.equal(reactionRpcCalls.length, 1, 'double tap triggers toggle_message_reaction');
  assert.equal(reactionRpcCalls[0].p_message_id, msgId);
  assert.equal(reactionRpcCalls[0].p_emoji, '❤️');

  // --- 2) First long-press -> reactions ONLY (no text select); Second long-press -> unlocks text select ---
  createdMenus = [];
  selectedRanges = [];
  await fireDoc('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 120, target: textEl });
  await new Promise((r) => setTimeout(r, 410));
  await fireDoc('pointerup', { pointerType: 'touch', clientX: 60, clientY: 120, target: textEl });
  assert.equal(bubbleEl.classList.contains('is-text-selectable'), false, 'first long-press must NOT unlock text selection');
  assert.equal(selectedRanges.length, 0, 'first long-press keeps selection empty');
  assert.ok(createdMenus.some((m) => m.classList.contains('msg-react-menu') && !m.classList.contains('is-leaving')), 'first long-press opens reaction strip');

  // Double long-press on the same text bubble -> unlocks text selection & selects text
  await fireDoc('pointerdown', { pointerType: 'touch', clientX: 60, clientY: 120, target: textEl });
  await new Promise((r) => setTimeout(r, 410));
  await fireDoc('pointerup', { pointerType: 'touch', clientX: 60, clientY: 120, target: textEl });
  assert.equal(bubbleEl.classList.contains('is-text-selectable'), true, 'double long-press unlocks text selection for copy');
  assert.equal(selectedRanges.length, 1, 'double long-press selects message text');
  assert.equal(rangeMock.selectedNode, textEl);

  // Tapping outside re-locks text selection
  const outsideEl = makeEl('outside-blank');
  await fireDoc('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 10, target: outsideEl });
  assert.equal(bubbleEl.classList.contains('is-text-selectable'), false, 'tapping outside re-locks message text selection');

  // --- 3) 3-dots conversation menu: toggles closed on 2nd tap & closes on ANY outside tap ---
  createdMenus = [];
  const threeDotsBtn = makeEl('conv-dots-btn', 'msg-conv-more-btn');
  threeDotsBtn.dataset.convMenuToggle = convId;
  threeDotsBtn.closest = (s) => (s.includes('[data-conv-menu-toggle]') ? threeDotsBtn : null);
  trackedTriggers.push(threeDotsBtn);

  // 1st click on 3-dots -> opens menu
  await fireDoc('pointerdown', { pointerType: 'touch', target: threeDotsBtn });
  await fireDoc('click', { target: threeDotsBtn });
  const convMenu = createdMenus.find((m) => m.getAttribute('data-menu-kind') === 'conv' && !m.classList.contains('is-leaving'));
  assert.ok(convMenu, 'first tap on 3-dots opens conversation options menu');
  assert.equal(threeDotsBtn.getAttribute('aria-expanded'), 'true');

  // 2nd click on the same 3-dots -> closes menu
  await fireDoc('pointerdown', { pointerType: 'touch', target: threeDotsBtn });
  await fireDoc('click', { target: threeDotsBtn });
  assert.equal(convMenu.classList.contains('is-leaving'), true, 'second tap on 3-dots toggles menu closed');
  assert.equal(threeDotsBtn.getAttribute('aria-expanded'), 'false');

  // Re-open, then tap ANYWHERE outside on screen -> closes immediately & suppresses underlying row click
  await new Promise((r) => setTimeout(r, 230));
  createdMenus = [];
  await fireDoc('pointerdown', { pointerType: 'touch', target: threeDotsBtn });
  await fireDoc('click', { target: threeDotsBtn });
  const convMenu2 = createdMenus.find((m) => m.getAttribute('data-menu-kind') === 'conv' && !m.classList.contains('is-leaving'));
  assert.ok(convMenu2, 'menu re-opens cleanly');
  await fireDoc('pointerdown', { pointerType: 'touch', target: outsideEl });
  assert.equal(convMenu2.classList.contains('is-leaving'), true, 'tapping anywhere outside immediately closes 3-dots menu');
  const trailingClick = await fireDoc('click', { target: outsideEl });
  assert.equal(trailingClick.propagationStopped, true, 'outside dismiss tap suppresses accidental click on underlying chat row');
});

test('scrolling up automatically loads older messages with scroll anchoring, deduplication, and no manual button', async () => {
  const messagesJs = read('js/messages.js');
  const css = read('css/app.css');

  assert.match(css, /\.msg-load-older-status\s*\{/);
  assert.match(css, /\.msg-load-older-spinner\s*\{/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.msg-load-older-status\s*\{/);
  assert.doesNotMatch(messagesJs, />Load older messages</);

  const meId = '11111111-1111-4111-8111-111111111111';
  const peerId = '22222222-2222-4222-8222-222222222222';
  const convId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const els = new Map();
  const makeEl = (id = '') => {
    const classes = new Set();
    const listeners = new Map();
    const attrs = new Map();
    return {
      id,
      tagName: 'DIV',
      open: false,
      hidden: false,
      value: '',
      textContent: '',
      innerHTML: '',
      scrollTop: 0,
      scrollHeight: 1600,
      clientHeight: 500,
      offsetHeight: 1600,
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
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() {},
      dispatch(type, ev = {}) {
        for (const fn of listeners.get(type) || []) fn(ev);
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() {},
      showModal() { this.open = true; },
      close() { this.open = false; }
    };
  };
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id));
    return els.get(id);
  };

  const scrollWrap = getEl('msg-scroll-wrap');
  const listEl = getEl('msg-messages-list');
  // Simulate DOM growth whenever listEl.innerHTML receives more rendered message rows
  let listHtml = '';
  Object.defineProperty(listEl, 'innerHTML', {
    get() { return listHtml; },
    set(val) {
      listHtml = String(val || '');
      const count = (listHtml.match(/class="msg-row(?=["\s])/g) || []).length;
      const nextH = Math.max(500, count * 120);
      listEl.offsetHeight = nextH;
      scrollWrap.scrollHeight = nextH;
    }
  });

  const rpcCalls = [];
  let releaseOlderFetch = null;
  const page1Msgs = Array.from({ length: 12 }, (_, i) => ({
    id: `m-new-${i + 1}`,
    conversation_id: convId,
    sender_id: peerId,
    sender_name: 'Peer User',
    body: `Recent message ${i + 1}`,
    message_type: 'TEXT',
    created_at: `2026-11-21T10:${String(i + 10).padStart(2, '0')}:00Z`,
    attachments: [],
    reactions: []
  }));
  const page2Msgs = Array.from({ length: 8 }, (_, i) => ({
    id: `m-old-${i + 1}`,
    conversation_id: convId,
    sender_id: peerId,
    sender_name: 'Peer User',
    body: `Older message ${i + 1}`,
    message_type: 'TEXT',
    created_at: `2026-11-21T09:${String(i + 10).padStart(2, '0')}:00Z`,
    attachments: [],
    reactions: []
  }));

  const makeChannel = () => {
    const ch = { on() { return ch; }, subscribe() { return ch; }, send: async () => 'ok' };
    return ch;
  };
  const doc = {
    visibilityState: 'visible',
    documentElement: { dataset: {}, style: { setProperty() {} } },
    body: { insertAdjacentHTML() {}, classList: makeEl().classList },
    getElementById: getEl,
    querySelector: (sel) => (sel.startsWith('#') ? getEl(sel.slice(1)) : null),
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };
  const ctx = {
    console, Date, Math, Map, Set, JSON, Promise, URLSearchParams,
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() {} },
    location: { search: '', pathname: '/dashboard.html', hash: '' },
    navigator: { userAgent: 'Mozilla/5.0' },
    setTimeout, clearTimeout,
    setInterval: () => 1,
    clearInterval() {},
    requestAnimationFrame: (fn) => fn(),
    matchMedia: () => ({ matches: false }),
    innerWidth: 1200,
    document: doc,
    addEventListener() {},
    removeEventListener() {},
    Ipon: {
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Me User', chat_privacy: { show_online: true } },
      client: {
        channel: makeChannel,
        removeChannel() {},
        from: () => new Proxy({}, {
          get(_t, prop) {
            if (prop === 'then') return (res) => Promise.resolve({ data: [], error: null }).then(res);
            return () => new Proxy({}, this);
          }
        })
      },
      escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: () => 'ME',
      isUserOnline: () => false,
      bindAvatarFallbacks() {},
      syncPresenceDots() {},
      verifiedBadgesHtml: () => '',
      toast() {},
      friendlyError: (e) => String(e?.message || e),
      rpc: async (name, params) => {
        if (name === 'get_social_overview') return { me: { id: meId }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        if (name === 'get_conversations') {
          return [{ id: convId, kind: 'DIRECT', peer: { id: peerId, full_name: 'Peer User' }, last_message_at: '2026-11-21T10:21:00Z', unread_count: 0 }];
        }
        if (name === 'get_social_notifications') return [];
        if (name === 'get_conversation_protection') return { block_screenshots: false, block_forwarding: false, vanish_after_seconds: null };
        if (name === 'mark_conversation_read') return true;
        if (name === 'get_conversation_messages') {
          rpcCalls.push(params);
          if (!params.p_before) {
            return {
              conversation: { id: convId, kind: 'DIRECT', full_name: 'Peer User', peer: { id: peerId, full_name: 'Peer User' }, can_interact: true },
              messages: page1Msgs,
              has_older: true
            };
          }
          await new Promise((resolve) => { releaseOlderFetch = resolve; });
          return {
            conversation: { id: convId, kind: 'DIRECT', full_name: 'Peer User' },
            messages: [...page2Msgs, page1Msgs[0]], // include overlap to verify deduplication
            has_older: false
          };
        }
        return null;
      }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init(ctx.Ipon.profile);
  await ctx.IponMessages.openWorkspace({ conversationId: convId });

  // Initial load: stays scrolled to bottom, manual button & wrap stay hidden, no premature older fetch
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].p_before, null);
  assert.equal(getEl('msg-load-older-wrap').hidden, true);
  assert.equal(getEl('msg-load-older-btn').hidden, true);
  assert.equal(scrollWrap.scrollTop, scrollWrap.scrollHeight);

  // User scrolls up near top -> automatically fetches older messages and shows loading indicator
  scrollWrap.scrollTop = 120;
  scrollWrap.dispatch('scroll');
  scrollWrap.scrollTop = 60;
  scrollWrap.dispatch('scroll'); // duplicate scroll while loading must be ignored
  assert.equal(rpcCalls.length, 2, 'scrolling up triggers a single automatic older-messages RPC');
  assert.equal(rpcCalls[1].p_before, page1Msgs[0].created_at);
  assert.equal(getEl('msg-load-older-wrap').hidden, false, 'loading indicator wrapper shows while fetching');
  assert.equal(getEl('msg-load-older-status').hidden, false, 'loading spinner status shows while fetching');
  assert.equal(getEl('msg-load-older-btn').hidden, true, 'retry button remains hidden during normal auto-load');

  const heightBeforePrepend = scrollWrap.scrollHeight;
  const topBeforePrepend = scrollWrap.scrollTop;
  releaseOlderFetch();
  await new Promise((r) => setTimeout(r, 20));

  // Older messages prepended without duplicates, indicator hidden, scroll position preserved exactly
  const renderedCount = (listEl.innerHTML.match(/class="msg-row(?=["\s])/g) || []).length;
  assert.equal(renderedCount, 20, '8 older + 12 recent messages rendered with overlap deduplicated');
  assert.equal(getEl('msg-load-older-wrap').hidden, true, 'loading indicator hides after older messages load');
  const expectedDelta = scrollWrap.scrollHeight - heightBeforePrepend;
  assert.equal(scrollWrap.scrollTop, topBeforePrepend + expectedDelta, 'scrollTop stays anchored to the message being read');

  // Scrolling to top again once has_older is false does not fire extra RPCs
  scrollWrap.scrollTop = 0;
  scrollWrap.dispatch('scroll');
  assert.equal(rpcCalls.length, 2, 'no further RPCs once all older messages are loaded');
});
