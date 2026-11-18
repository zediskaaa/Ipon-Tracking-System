import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('js/core.js flushes keepalive touch_user_last_seen on hidden/pagehide and emits presence leave events', () => {
  const coreJs = read('js/core.js');
  assert.match(coreJs, /function emitPresenceChange\(/);
  assert.match(coreJs, /window\.dispatchEvent\(new CustomEvent\('ipon:presence-change'/);
  assert.match(coreJs, /function flushLastSeen\(\{ keepalive = false, force = false \} = \{\}\)/);
  assert.match(coreJs, /\/rest\/v1\/rpc\/touch_user_last_seen/);
  assert.match(coreJs, /keepalive:\s*true/);
  assert.match(coreJs, /if \(document\.visibilityState === 'hidden'\) handleAppAway\(\);/);
  assert.match(coreJs, /window\.addEventListener\('pagehide',[\s\S]*?handleAppAway\(\);/);
});

test('js/messages.js formats exact same-day and previous-day last seen timestamps and updates live on presence leave', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const sameDayFriendId = '22222222-2222-4222-8222-222222222222';
  const prevDayFriendId = '33333333-3333-4333-8333-333333333333';
  const prevYearFriendId = '44444444-4444-4444-8444-444444444444';

  const now = new Date();
  const sameDayTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 5, 0);
  const sameDayClock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(sameDayTarget);

  const prevDayTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 7, 28, 0);
  const prevDayMm = String(prevDayTarget.getMonth() + 1).padStart(2, '0');
  const prevDayDd = String(prevDayTarget.getDate()).padStart(2, '0');
  const prevDayDatePart = prevDayTarget.getFullYear() === now.getFullYear()
    ? `${prevDayMm}/${prevDayDd}`
    : `${prevDayMm}/${prevDayDd}/${prevDayTarget.getFullYear()}`;
  const prevDayClock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(prevDayTarget);

  const prevYearTarget = new Date(now.getFullYear() - 1, 10, 9, 7, 28, 0);
  const prevYearClock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(prevYearTarget);

  const onlineIds = new Set([sameDayFriendId]);
  const els = new Map();
  const winListeners = new Map();

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
    setInterval: () => 0,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    },
    removeEventListener() { },
    console,
    Ipon: {
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera', chat_privacy: { show_online: true } },
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''),
      isUserOnline: (id) => onlineIds.has(String(id)),
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      syncMessagesBadges() { },
      setBusy() { },
      toast() { },
      confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e || 'Error'),
      dateLabel: (d) => String(d || ''),
      rpc: async (name) => {
        if (name === 'get_conversations') return [];
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: {} },
            friends: [
              {
                id: sameDayFriendId,
                full_name: 'Same Day Friend',
                username: 'sameday',
                allow_online_status: true,
                last_seen_at: sameDayTarget.toISOString()
              },
              {
                id: prevDayFriendId,
                full_name: 'Previous Day Friend',
                username: 'prevday',
                allow_online_status: true,
                last_seen_at: prevDayTarget.toISOString()
              },
              {
                id: prevYearFriendId,
                full_name: 'Previous Year Friend',
                username: 'prevyear',
                allow_online_status: true,
                last_seen_at: prevYearTarget.toISOString()
              }
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
    'msg-thread-active', 'msg-peer-status-text'
  ]) {
    getEl(id);
  }

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init(ctx.Ipon.profile);
  await ctx.IponMessages.openWorkspace({ tab: 'friends', subTab: 'all' });

  const friendsHost = getEl('msg-friends-list-host');
  assert.match(friendsHost.innerHTML, /Active now/);
  assert.match(friendsHost.innerHTML, new RegExp(`Offline since ${prevDayDatePart.replace('/', '\\/')} · ${prevDayClock}`));
  assert.match(friendsHost.innerHTML, new RegExp(`Offline since 11\\/09\\/${now.getFullYear() - 1} · ${prevYearClock}`));
  assert.doesNotMatch(friendsHost.innerHTML, /moments ago|\dm ago|\dh ago/i);

  // Now simulate sameDayFriend going offline at an exact leave time (same day)
  onlineIds.delete(sameDayFriendId);
  const leaveAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 12, 0);
  const leaveClock = new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit' }).format(leaveAt);
  for (const fn of (winListeners.get('ipon:presence-change') || [])) {
    fn({ detail: { onlineIds: [], leftIds: [sameDayFriendId], at: leaveAt.toISOString() } });
  }

  assert.match(friendsHost.innerHTML, new RegExp(`Offline since ${leaveClock}`));
  assert.doesNotMatch(friendsHost.innerHTML, /Active now/);

  // Same-day initial timestamp sanity check (if clock had shifted backward, newer timestamp wins; verify no relative ago)
  assert.doesNotMatch(friendsHost.innerHTML, new RegExp(`Offline since ${sameDayClock}`));
});
