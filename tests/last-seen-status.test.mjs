import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('js/core.js and js/messages.js stop touch_user_last_seen heartbeats and remove Online/Last Seen indicators', () => {
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');

  assert.doesNotMatch(coreJs, /touch_user_last_seen|flushLastSeen|lastSeenFlushAt|isUserOnline|onlineUserIds|syncPresenceDots|setOnlineVisibility|presence-dot/);
  assert.doesNotMatch(messagesJs, /touch_user_last_seen|pingLastSeen|lastSeenTimer|liveLastSeenMap|recordLastSeen|formatLastSeenTime|visibleLastSeenAt|personIsOnline|presence-dot|Offline since/);

  // Platform tracking for screenshot protection stays intact for non-SUPER_ADMIN roles
  assert.match(coreJs, /if \(!client \|\| !profile\?\.id \|\| profile\.role === 'SUPER_ADMIN'\) return;/);
  assert.match(coreJs, /function emitPresenceChange\(/);
  assert.match(coreJs, /function hasLiveBrowserSession\(/);
});

test('js/messages.js makes zero touch_user_last_seen RPC calls and omits Online/Last Seen text while preserving typing, delivery/read receipts, and blocked notices', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const friendId = '22222222-2222-4222-8222-222222222222';
  const blockedId = '33333333-3333-4333-8333-333333333333';
  const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  const els = new Map();
  const rpcCalls = [];
  const intervalCalls = [];

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
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      appendChild: (c) => c,
      contains: () => false,
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      focus() { },
      showModal() { el.open = true; },
      close() { el.open = false; },
      getBoundingClientRect: () => ({ left: 100, right: 200, top: 100, bottom: 130, width: 100, height: 30 }),
      addEventListener() { },
      dispatchEvent() { return true; }
    };
    if (id) els.set(id, el);
    return el;
  };
  const getEl = (id) => {
    if (!els.has(id)) makeEl(id.includes('dialog') ? 'dialog' : 'div', id);
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
      presenceState: () => ({}),
      async track() { },
      async untrack() { },
      async send() { },
      unsubscribe() { }
    }),
    removeChannel() { }
  });

  const peerConv = {
    id: friendId,
    conversation_id: convId,
    kind: 'DIRECT',
    full_name: 'Zedrick De Monteverde',
    username: 'zediskaaa',
    allow_online_status: true,
    profile_visible: true,
    friendship_status: 'FRIENDS',
    last_seen_at: new Date().toISOString()
  };

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
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() { },
      removeEventListener() { }
    },
    navigator: { userAgent: 'Mozilla/5.0' },
    location: { origin: 'https://myipon.example', search: '' },
    CSS: { escape: (v) => String(v) },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout,
    clearTimeout,
    setInterval: (fn, ms) => { intervalCalls.push(ms); return 0; },
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    removeEventListener() { },
    console,
    Ipon: {
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera', chat_privacy: { read_receipts: true } },
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''),
      bindAvatarFallbacks() { },
      syncMessagesBadges() { },
      setBusy() { },
      toast() { },
      confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e || 'Error'),
      dateLabel: (d) => String(d || ''),
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'get_conversations') return [{ id: convId, kind: 'DIRECT', peer: peerConv, unread_count: 0 }];
        if (name === 'get_conversation_messages') return { conversation: { ...peerConv }, messages: [], has_older: false, pinned_messages: [] };
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: { read_receipts: true } },
            friends: [
              peerConv,
              { id: blockedId, full_name: 'Blocked Peer', username: 'blocked', friendship_status: 'BLOCKED_BY_ME', is_blocked: true }
            ],
            incoming_requests: [],
            sent_requests: [],
            blocked_users: []
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
    'msg-workspace-dialog', 'msg-view-chats', 'msg-view-friends', 'msg-view-alerts',
    'msg-friends-list-host', 'msg-conv-list', 'msg-list-search', 'msg-thread-empty',
    'msg-thread-active', 'msg-thread-header', 'msg-messages-list', 'msg-scroll-wrap',
    'msg-peer-status-text', 'msg-welcome-status-text', 'msg-welcome-meta',
    'msg-composer-form', 'msg-composer-input', 'msg-blocked-banner', 'msg-request-banner',
    'msg-load-older-wrap', 'msg-typing-live'
  ]) {
    getEl(id);
  }

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init(ctx.Ipon.profile);

  // Delivery receipts still run, but touch_user_last_seen and 60s heartbeat timers never fire
  assert.ok(rpcCalls.some((c) => c.name === 'mark_messages_delivered'), 'Delivery receipts must remain active');
  assert.equal(rpcCalls.some((c) => c.name === 'touch_user_last_seen'), false, 'touch_user_last_seen must never be called');
  assert.equal(intervalCalls.includes(60000), false, '60-second heartbeat interval must not be scheduled');

  await ctx.IponMessages.openWorkspace({ tab: 'friends', subTab: 'all' });
  const friendsHost = getEl('msg-friends-list-host');
  assert.doesNotMatch(friendsHost.innerHTML, /presence-dot|Active now|Offline since|Privacy mode/);
  assert.match(friendsHost.innerHTML, /Messaging restricted/);

  await ctx.IponMessages.openWorkspace({ conversationId: convId });
  const headerHtml = getEl('msg-thread-header').innerHTML;
  assert.match(headerHtml, /id="msg-peer-status-text"[^>]*hidden><\/small>/);
  assert.doesNotMatch(headerHtml, /presence-dot|Active now|Offline since/);
});
