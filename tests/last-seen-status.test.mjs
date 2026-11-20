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
  assert.match(friendsHost.innerHTML, /presence-dot is-online/);
  assert.doesNotMatch(friendsHost.innerHTML, /<small>Active now<\/small>/);
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
  assert.doesNotMatch(friendsHost.innerHTML, /presence-dot is-online/);
  assert.doesNotMatch(friendsHost.innerHTML, /<small>Active now<\/small>/);

  // Same-day initial timestamp sanity check (if clock had shifted backward, newer timestamp wins; verify no relative ago)
  assert.doesNotMatch(friendsHost.innerHTML, new RegExp(`Offline since ${sameDayClock}`));
});

test('active thread clears header and intro green presence dots immediately when peer goes offline, and core presence never resurrects offline peers', async () => {
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');

  assert.match(coreJs, /const applyLocalPresenceSnapshot = \(data\) => \{[\s\S]*?if \(data\.userId && String\(data\.userId\) !== String\(profile\.id\)\) return;[\s\S]*?onlineUserIds\.clear\(\);[\s\S]*?if \(leftIds\.length \|\| joinedIds\.length\) emitPresenceChange\(leftIds\);/);
  assert.match(coreJs, /const hasActivePresence = \(stateObj, uid\) =>/);
  assert.match(coreJs, /if \(!Array\.isArray\(presences\) \|\| !presences\.length\) return;/);
  assert.match(coreJs, /if \(leftIds\.length \|\| joinedIds\.length\) emitPresenceChange\(leftIds\);/);

  const meId = '11111111-1111-4111-8111-111111111111';
  const peerId = '22222222-2222-4222-8222-222222222222';
  const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const onlineIds = new Set([meId, peerId]);
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

  const headerDot = makeEl('span');
  headerDot.classList.add('presence-dot', 'is-online');
  headerDot.dataset.presenceId = peerId;
  const heroDot = makeEl('span');
  heroDot.classList.add('presence-dot', 'is-online');
  heroDot.dataset.presenceId = peerId;

  getEl('msg-thread-header').querySelector = (sel) => (sel === '.presence-dot' ? headerDot : null);
  getEl('msg-messages-list').querySelector = (sel) => (sel === '.msg-welcome-avatar .presence-dot' ? heroDot : null);

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
    id: peerId,
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
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Edna Fruto', chat_privacy: { show_online: true } },
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
        if (name === 'get_conversations') return [{ id: convId, kind: 'DIRECT', peer: peerConv, unread_count: 0 }];
        if (name === 'get_conversation_messages') return { conversation: { ...peerConv }, messages: [], has_older: false, pinned_messages: [] };
        if (name === 'get_social_overview') return { me: { id: meId, full_name: 'Edna Fruto', chat_privacy: {} }, friends: [peerConv], incoming_requests: [], sent_requests: [], blocked_users: [] };
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
  await ctx.IponMessages.openWorkspace({ conversationId: convId });

  assert.equal(headerDot.classList.contains('is-online'), true);
  assert.equal(heroDot.classList.contains('is-online'), true);

  // Peer goes offline -> header shows "Offline since ..." AND both green dots clear immediately
  onlineIds.delete(peerId);
  const leaveAt = new Date();
  for (const fn of (winListeners.get('ipon:presence-change') || [])) {
    fn({ detail: { onlineIds: [meId], leftIds: [peerId], at: leaveAt.toISOString() } });
  }

  assert.match(getEl('msg-peer-status-text').textContent, /^Offline since /);
  assert.equal(getEl('msg-peer-status-text').hidden, false);
  assert.equal(headerDot.classList.contains('is-online'), false);
  assert.equal(heroDot.classList.contains('is-online'), false);
  assert.equal(headerDot.getAttribute('aria-label'), 'Offline');
  assert.equal(heroDot.getAttribute('aria-label'), 'Offline');

  // Peer comes back online -> "Offline since ..." clears AND both green dots turn back on
  onlineIds.add(peerId);
  for (const fn of (winListeners.get('ipon:presence-change') || [])) {
    fn({ detail: { onlineIds: [meId, peerId], leftIds: [], at: new Date().toISOString() } });
  }

  assert.equal(getEl('msg-peer-status-text').textContent, '');
  assert.equal(getEl('msg-peer-status-text').hidden, true);
  assert.equal(headerDot.classList.contains('is-online'), true);
  assert.equal(heroDot.classList.contains('is-online'), true);
});
