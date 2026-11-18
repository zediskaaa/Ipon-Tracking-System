import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('migration 20261118_107 exposes mutual_friends arrays securely across social RPCs and CSS defines circular 3+1 stack & popover', () => {
  const sql = read('database/migrations/20261118_107_mutual_friends_details.sql');
  const css = read('css/app.css');

  assert.match(sql, /^\s*begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /'20261118_107'/);
  assert.match(sql, /create or replace function public\.get_mutual_friends_summary\(/i);
  assert.match(sql, /revoke all on function public\.get_mutual_friends_summary\(uuid, uuid, integer\) from public, anon, authenticated;/i);

  for (const fn of [
    'get_social_user_profile',
    'search_social_users',
    'get_friend_suggestions',
    'get_social_overview'
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\(.*?to authenticated`, 'is'));
  }

  assert.equal((sql.match(/'mutual_friends'/g) || []).length >= 6, true, 'All mutual_friends payloads must include detailed arrays');

  // CSS rules for 3-avatar overlap + 4th +N circle + popover + dark mode
  assert.match(css, /\.msg-mutual-trigger\s*\{/);
  assert.match(css, /\.msg-mutual-stack\s*\{/);
  assert.match(css, /\.msg-mutual-av,\s*\.msg-mutual-more\s*\{[\s\S]*?aspect-ratio:\s*1 \/ 1;[\s\S]*?border-radius:\s*50%;/);
  assert.match(css, /\.msg-mutual-popover\s*\{/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.msg-mutual-popover/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.msg-mutual-more/);

  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, 'CSS brace depth must stay non-negative');
  }
  assert.equal(depth, 0, 'CSS braces must be balanced');

  // Migration 108 exposes friends_count & CSS unifies Friend badges across views/themes
  const sql108 = read('database/migrations/20261118_108_user_friends_count.sql');
  assert.match(sql108, /^\s*begin;/i);
  assert.match(sql108, /commit;\s*$/i);
  assert.match(sql108, /'20261118_108'/);
  assert.match(sql108, /create or replace function public\.get_user_friends_count\(/i);
  assert.match(sql108, /revoke all on function public\.get_user_friends_count\(uuid, uuid\) from public, anon, authenticated;/i);
  assert.equal((sql108.match(/'friends_count'/g) || []).length >= 6, true, 'All social payloads must expose friends_count');
  assert.match(css, /\.msg-rel-badge,\s*\.msg-rel-chip:not\(\.is-group\)\s*\{[\s\S]*?background:\s*rgba\(21,\s*108,\s*72,\s*\.12\);[\s\S]*?color:\s*#14533c;/);
  assert.match(css, /html\[data-theme="dark"\]\s*\.msg-rel-chip:not\(\.is-group\),\s*html\[data-theme="dark"\]\s*\.msg-rel-badge/);
});

test('messages UI renders max 3 avatars + 4th count badge and opens mutuals popover on hover and click', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const friendId = '22222222-2222-4222-8222-222222222222';
  const incomingId = '33333333-3333-4333-8333-333333333333';
  const searchId = '44444444-4444-4444-8444-444444444444';

  const makeMutuals = (count) => Array.from({ length: count }, (_, idx) => ({
    id: `99999999-9999-4999-8999-00000000000${idx + 1}`,
    full_name: `Mutual Person ${idx + 1}`,
    username: `mutual${idx + 1}`,
    avatar_url: idx % 2 === 0 ? `https://img.example/m${idx + 1}.jpg` : null
  }));

  const mutualsTwo = makeMutuals(2);
  const mutualsFive = makeMutuals(5);
  const mutualsFour = makeMutuals(4);

  const els = new Map();
  const docListeners = new Map();

  const makeEl = (tag = 'div', id = '') => {
    const attrs = new Map();
    const classes = new Set();
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
      getBoundingClientRect: () => ({ left: 120, right: 260, top: 180, bottom: 204, width: 140, height: 24 }),
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
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
        insertAdjacentHTML: (_pos, html) => {
          assert.match(html, /id="msg-mutual-popover"/);
        }
      }),
      getElementById: (id) => getEl(id),
      createElement: (t) => makeEl(t),
      querySelector: (sel) => (sel.includes('#msg-workspace-dialog') && els.get('msg-workspace-dialog')?.open ? els.get('msg-workspace-dialog') : null),
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
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera', chat_privacy: { show_online: true } },
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
        if (name === 'get_conversations') return [];
        if (name === 'get_social_notifications') return [];
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: {} },
            friends: [
              {
                id: friendId,
                full_name: 'Maria Santos',
                username: 'maria',
                allow_online_status: true,
                friends_count: 12,
                mutual_friends_count: 2,
                mutual_friends: mutualsTwo
              }
            ],
            incoming_requests: [
              {
                id: 'req-1',
                user_id: incomingId,
                full_name: 'Carlo Mendoza',
                username: 'carlo',
                created_at: '2026-11-18T08:00:00Z',
                friends_count: 0,
                mutual_friends_count: 5,
                mutual_friends: mutualsFive
              }
            ],
            sent_requests: [],
            blocked_users: []
          };
        }
        if (name === 'search_social_users') {
          return [
            {
              id: searchId,
              full_name: 'Dana Reyes',
              username: 'dana',
              friendship_status: 'NONE',
              friends_count: 1,
              mutual_friends_count: 4,
              mutual_friends: mutualsFour
            }
          ];
        }
        if (name === 'get_social_user_profile') {
          const isIncoming = params.p_target_id === incomingId;
          return {
            id: params.p_target_id,
            full_name: isIncoming ? 'Carlo Mendoza' : 'Mutual Person 1',
            username: isIncoming ? 'carlo' : 'mutual1',
            friendship_status: isIncoming ? 'INCOMING_REQUEST' : 'FRIENDS',
            friend_request_id: isIncoming ? 'req-1' : null,
            can_send_friend_request: false,
            can_message: true,
            bio: 'Saving together',
            shared_groups: [],
            friends_count: isIncoming ? 0 : 7,
            mutual_friends_count: 5,
            mutual_friends: mutualsFive
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

  // Seed expected workspace mount elements referenced by renderWorkspace()
  for (const id of [
    'msg-dialogs-host', 'msg-workspace-dialog', 'msg-mutual-popover', 'msg-profile-popover',
    'msg-view-chats', 'msg-view-friends', 'msg-view-alerts', 'msg-friends-list-host',
    'msg-conv-list', 'msg-list-search', 'msg-thread-empty', 'msg-thread-active'
  ]) {
    getEl(id);
  }
  getEl('msg-mutual-popover').hidden = true;
  getEl('msg-profile-popover').hidden = true;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.IponMessages.init({ session: { user: { id: meId } }, profile: ctx.Ipon.profile });
  await ctx.IponMessages.openWorkspace({ tab: 'friends', subTab: 'all' });

  // 1. Friends card with 2 mutual friends -> max 2 avatars and NO +N overflow badge, and shows non-zero friends count
  const friendsHost = getEl('msg-friends-list-host');
  assert.match(friendsHost.innerHTML, new RegExp(`data-mutual-trigger="${friendId}"`));
  assert.equal((friendsHost.innerHTML.match(/class="msg-mutual-av"/g) || []).length, 2);
  assert.doesNotMatch(friendsHost.innerHTML, /class="msg-mutual-more"/);
  assert.match(friendsHost.innerHTML, /2 mutual friends/);
  assert.match(friendsHost.innerHTML, /@maria · 12 friends/);

  // 2. Switch to incoming friend requests (5 mutuals -> 3 avatars + 4th badge "+2")
  const clickHandlers = docListeners.get('click') || [];
  const emitDocEvent = async (type, ev) => {
    for (const fn of (docListeners.get(type) || [])) {
      await fn(ev);
    }
  };
  const incomingTabBtn = {
    dataset: { friendsSub: 'incoming' },
    closest: (sel) => (sel.includes('[data-friends-sub]') ? incomingTabBtn : null)
  };
  await emitDocEvent('click', { target: incomingTabBtn, stopPropagation() { }, preventDefault() { } });

  assert.match(friendsHost.innerHTML, new RegExp(`data-mutual-trigger="${incomingId}"`));
  assert.equal((friendsHost.innerHTML.match(/class="msg-mutual-av"/g) || []).length, 3);
  assert.match(friendsHost.innerHTML, /<span class="msg-mutual-more" aria-hidden="true">\+2<\/span>/);
  assert.match(friendsHost.innerHTML, /5 mutual friends/);
  assert.doesNotMatch(friendsHost.innerHTML, /0 friends/i);

  // 3. Hover trigger opens #msg-mutual-popover with all 5 mutual friends
  const triggerAttrs = new Map();
  const triggerEl = {
    dataset: { mutualTrigger: incomingId },
    setAttribute: (k, v) => triggerAttrs.set(k, String(v)),
    getBoundingClientRect: () => ({ left: 100, right: 240, top: 220, bottom: 248, width: 140, height: 28 }),
    closest: (sel) => (sel.includes('[data-mutual-trigger]') ? triggerEl : null)
  };
  await emitDocEvent('mouseover', { target: triggerEl });
  const mutualPop = getEl('msg-mutual-popover');
  assert.equal(mutualPop.hidden, false);
  assert.equal(mutualPop.dataset.userId, incomingId);
  assert.equal(mutualPop.dataset.pinned, '0');
  assert.equal(triggerAttrs.get('aria-expanded'), 'true');
  assert.match(mutualPop.innerHTML, /5 Mutual Friends/);
  for (let i = 1; i <= 5; i++) {
    assert.match(mutualPop.innerHTML, new RegExp(`Mutual Person ${i}`));
    assert.match(mutualPop.innerHTML, new RegExp(`@mutual${i}`));
  }

  // 4. Mouseout closes unpinned popover after short hover delay
  await emitDocEvent('mouseout', { target: triggerEl, relatedTarget: null });
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(mutualPop.hidden, true);
  assert.equal(triggerAttrs.get('aria-expanded'), 'false');

  // 5. Click/Tap pins the popover open (mobile & desktop), second click toggles closed
  await emitDocEvent('click', { target: triggerEl, stopPropagation() { } });
  assert.equal(mutualPop.hidden, false);
  assert.equal(mutualPop.dataset.pinned, '1');
  await emitDocEvent('click', { target: triggerEl, stopPropagation() { } });
  assert.equal(mutualPop.hidden, true);

  // 6. Clicking a mutual friend row inside #msg-mutual-popover opens their profile popover & renders 5 mutuals as 3+1 badge
  await emitDocEvent('click', { target: triggerEl, stopPropagation() { } });
  assert.equal(mutualPop.hidden, false);
  const mutualItem = {
    dataset: { socialUserDp: '99999999-9999-4999-8999-000000000001' },
    getBoundingClientRect: () => ({ left: 140, right: 300, top: 250, bottom: 290, width: 160, height: 40 }),
    closest: (sel) => (sel.includes('[data-social-user-dp]') || sel.includes('#msg-mutual-popover') ? mutualItem : null)
  };
  await emitDocEvent('click', { target: mutualItem, stopPropagation() { } });
  assert.equal(mutualPop.hidden, true);
  const profilePop = getEl('msg-profile-popover');
  assert.equal(profilePop.hidden, false);
  assert.match(profilePop.innerHTML, /<span class="msg-mutual-more" aria-hidden="true">\+2<\/span>/);
  assert.equal((profilePop.innerHTML.match(/class="msg-mutual-av"/g) || []).length, 3);
  assert.doesNotMatch(profilePop.innerHTML, /class="msg-rel-badge"/);
  assert.doesNotMatch(profilePop.innerHTML, /<small class="msg-pop-status">Friends\b/);
  assert.match(profilePop.innerHTML, /<small class="msg-pop-status">7 friends<\/small>/);

  // 7. Inline search person rows show clean inline "1 friend · 4 mutual" text without the mutual avatar pill badge
  const chatsTabBtn = {
    dataset: { msgTab: 'chats' },
    closest: (sel) => (sel.includes('[data-msg-tab]') ? chatsTabBtn : null)
  };
  await emitDocEvent('click', { target: chatsTabBtn, stopPropagation() { }, preventDefault() { } });
  const searchInput = getEl('msg-list-search');
  searchInput.value = 'dana';
  await emitDocEvent('focusin', { target: searchInput });
  await emitDocEvent('input', { target: searchInput });
  await new Promise((r) => setTimeout(r, 260));
  const convList = getEl('msg-conv-list');
  assert.doesNotMatch(convList.innerHTML, /class="msg-mutual-trigger/);
  assert.match(convList.innerHTML, /@dana · 1 friend · 4 mutual/);
  assert.doesNotMatch(convList.innerHTML, /0 friends/i);
});
