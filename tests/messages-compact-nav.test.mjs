import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (...cls) => cls.forEach((c) => set.add(c)),
    remove: (...cls) => cls.forEach((c) => set.delete(c)),
    toggle: (c, force) => {
      const next = force === undefined ? !set.has(c) : Boolean(force);
      if (next) set.add(c);
      else set.delete(c);
      return next;
    },
    contains: (c) => set.has(c)
  };
}

function makeEl(id, { dataset = {}, attrs = {}, classes = [] } = {}) {
  const listeners = new Map();
  const attrMap = new Map(Object.entries(attrs));
  return {
    id,
    open: false,
    hidden: false,
    disabled: false,
    value: '',
    innerHTML: '',
    textContent: '',
    style: {},
    dataset: { ...dataset },
    classList: makeClassList(classes),
    showModal() { this.open = true; },
    close() { this.open = false; },
    focus() {},
    select() {},
    setAttribute(k, v) { attrMap.set(k, String(v)); },
    getAttribute(k) { return attrMap.has(k) ? attrMap.get(k) : null; },
    removeAttribute(k) { attrMap.delete(k); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(ev) {
      (listeners.get(ev.type) || []).forEach((fn) => fn(ev));
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest(sel) {
      if (sel === '[data-msg-tab]' && this.dataset.msgTab) return this;
      if (sel === '[data-msg-filter]' && this.dataset.msgFilter) return this;
      if (sel === '[data-open-conv]' && this.dataset.openConv) return this;
      return null;
    }
  };
}

test('Option 1 compact Messages header, 4-option filter pills, Requests badge, and Friends navigation work end-to-end', async () => {
  const messagesJs = read('js/messages.js');
  const appCss = read('css/app.css');

  // 1. Static markup & responsive CSS contracts
  assert.match(messagesJs, /<h2 id="msg-workspace-title">Messages<\/h2>/);
  assert.match(messagesJs, /id="msg-friends-btn"[^>]*data-msg-tab="friends"[\s\S]*?id="msg-tab-friends-badge"/);
  assert.match(messagesJs, /id="msg-filter-pills"[^>]*role="tablist"[\s\S]*?data-msg-filter="inbox"[\s\S]*?data-msg-filter="unread"[\s\S]*?data-msg-filter="requests"[\s\S]*?id="msg-tab-req-badge"[\s\S]*?data-msg-filter="archived"/);
  assert.match(messagesJs, /id="msg-friends-back-btn"[^>]*data-msg-tab="chats"/);
  assert.doesNotMatch(messagesJs, /class="msg-tabs"|id="msg-tab-chats-badge"|id="msg-workspace-subtitle"/);

  assert.match(appCss, /\.msg-topbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/s);
  assert.match(appCss, /\.msg-topbar-actions\s+\.msg-icon-btn:hover:not\(:disabled\),[\s\S]*?color:\s*#fff;/);
  assert.match(appCss, /\.msg-topbar-actions\s+\.msg-icon-btn\.is-active:hover:not\(:disabled\),[\s\S]*?color:\s*#F2C14E;/);
  assert.match(appCss, /\.msg-filter-pills\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);/s);
  assert.match(appCss, /\.msg-pill-badge\s*\{[^}]*background:\s*#e53935;/s);
  assert.match(appCss, /\.msg-friends-back-btn\s*\{/);
  assert.doesNotMatch(appCss, /\.msg-topbar::before\s*\{|\.msg-tabs\s*\{/);

  // 2. Runtime behavior in sandboxed VM
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };

  const friendsBtn = makeEl('msg-friends-btn', { dataset: { msgTab: 'friends' }, attrs: { 'aria-pressed': 'false' } });
  const friendsBackBtn = makeEl('msg-friends-back-btn', { dataset: { msgTab: 'chats' } });
  elements.set('msg-friends-btn', friendsBtn);
  elements.set('msg-friends-back-btn', friendsBackBtn);

  const filterButtons = ['inbox', 'unread', 'requests', 'archived'].map((name) => makeEl(`pill-${name}`, {
    dataset: { msgFilter: name },
    attrs: { role: 'tab', 'aria-selected': name === 'inbox' ? 'true' : 'false' },
    classes: name === 'inbox' ? ['msg-pill', 'is-active'] : ['msg-pill']
  }));
  const filterPills = getEl('msg-filter-pills');
  filterPills.querySelectorAll = (sel) => (sel === '[data-msg-filter]' ? filterButtons : []);

  let mountedHtml = '';
  const docListeners = new Map();
  const doc = {
    visibilityState: 'visible',
    documentElement: { dataset: {} },
    body: {
      insertAdjacentHTML(_pos, html) { mountedHtml += html; },
      addEventListener() {},
      classList: makeClassList()
    },
    getElementById: (id) => getEl(id),
    querySelector: () => null,
    querySelectorAll: (sel) => {
      if (sel === '[data-msg-tab]') return [friendsBtn, friendsBackBtn];
      if (sel === '[data-msg-filter]') return filterButtons;
      return [];
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener() {}
  };

  const conversations = [
    {
      id: 'conv-inbox',
      is_incoming_request: false,
      is_archived: false,
      is_muted: false,
      unread_count: 0,
      marked_unread: false,
      last_message_preview: 'See you tomorrow',
      last_message_at: '2026-11-22T05:00:00Z',
      peer: { id: 'u-ana', full_name: 'Ana Santos', username: 'ana', avatar_url: '' }
    },
    {
      id: 'conv-unread',
      is_incoming_request: false,
      is_archived: false,
      is_muted: false,
      unread_count: 2,
      marked_unread: false,
      last_message_preview: 'Did you deposit?',
      last_message_at: '2026-11-22T06:00:00Z',
      peer: { id: 'u-ben', full_name: 'Ben Cruz', username: 'ben', avatar_url: '' }
    },
    {
      id: 'conv-req-1',
      is_incoming_request: true,
      is_archived: false,
      is_muted: false,
      unread_count: 1,
      marked_unread: false,
      last_message_preview: 'Hi, can we connect?',
      last_message_at: '2026-11-22T07:00:00Z',
      peer: { id: 'u-cara', full_name: 'Cara Reyes', username: 'cara', avatar_url: '' }
    },
    {
      id: 'conv-arch',
      is_incoming_request: false,
      is_archived: true,
      is_muted: false,
      unread_count: 0,
      marked_unread: false,
      last_message_preview: 'Old note',
      last_message_at: '2026-11-10T07:00:00Z',
      peer: { id: 'u-dan', full_name: 'Dan Lim', username: 'dan', avatar_url: '' }
    }
  ];

  const overview = {
    me: { id: 'u-me', full_name: 'Edna Fruto', username: 'edna', chat_privacy: 'EVERYONE' },
    friends: [{ user_id: 'u-ana', full_name: 'Ana Santos', username: 'ana', avatar_url: '' }],
    incoming_requests: [
      { id: 'fr-1', user_id: 'u-eli', full_name: 'Eli Gomez', username: 'eli', created_at: '2026-11-22T05:00:00Z' },
      { id: 'fr-2', user_id: 'u-faye', full_name: 'Faye Tan', username: 'faye', created_at: '2026-11-22T05:30:00Z' }
    ],
    sent_requests: []
  };

  let syncedTotalBadge = -1;
  const win = {
    location: { href: 'https://myipon.app/dashboard.html', origin: 'https://myipon.app', pathname: '/dashboard.html', search: '' },
    innerWidth: 390,
    innerHeight: 844,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    Ipon: {
      profile: { id: 'u-me', role: 'MEMBER', status: 'ACTIVE', full_name: 'Edna Fruto' },
      client: null,
      escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (name) => String(name || 'U').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || 'U',
      isUserOnline: () => false,
      avatarHtml: () => '<span class="avatar-circle"></span>',
      bindAvatarFallbacks() {},
      syncPresenceDots() {},
      fitVerifiedNameLines() {},
      syncMessagesBadges(n) { syncedTotalBadge = n; },
      toast() {},
      friendlyError: (e) => String(e?.message || e || 'Error'),
      async rpc(name, params = {}) {
        if (name === 'get_conversations') return conversations;
        if (name === 'get_social_overview') return overview;
        if (name === 'get_conversation_messages') {
          const found = conversations.find((c) => c.id === params.p_conversation_id) || conversations[0];
          return {
            conversation: {
              conversation_id: found.id,
              kind: 'DIRECT',
              is_incoming_request: found.is_incoming_request,
              peer: found.peer
            },
            messages: [],
            has_older: false,
            pinned_messages: []
          };
        }
        return [];
      }
    }
  };
  win.window = win;

  vm.runInNewContext(messagesJs, {
    window: win,
    document: doc,
    location: win.location,
    URL,
    URLSearchParams,
    Event: class Event { constructor(type) { this.type = type; } },
    CustomEvent: class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: (fn) => fn(),
    console
  });

  await win.IponMessages.init(win.Ipon.profile);
  await win.IponMessages.openWorkspace();

  const workspaceDlg = getEl('msg-workspace-dialog');
  const dispatchClick = async (targetEl) => {
    const ev = { type: 'click', target: targetEl, preventDefault() {}, stopPropagation() {} };
    workspaceDlg.dispatchEvent(ev);
    for (const fn of (docListeners.get('click') || [])) {
      await fn(ev);
    }
    await new Promise((r) => setTimeout(r, 15));
  };

  // Mounted HTML is compact and excludes the old floating tab bar
  assert.match(mountedHtml, /<h2 id="msg-workspace-title">Messages<\/h2>/);
  assert.doesNotMatch(mountedHtml, /class="msg-tabs"/);

  // Badges sync cleanly: 1 incoming message request, 2 incoming friend requests
  assert.equal(getEl('msg-tab-req-badge').textContent, '1');
  assert.equal(getEl('msg-tab-req-badge').hidden, false);
  assert.equal(getEl('msg-tab-friends-badge').textContent, '2');
  assert.equal(getEl('msg-tab-friends-badge').hidden, false);
  assert.equal(syncedTotalBadge, 5); // 2 unread + 1 msg request + 2 friend requests

  // Default Inbox shows non-archived regular chats and keeps Inbox pill active
  const listEl = getEl('msg-conv-list');
  assert.equal(filterPills.hidden, false);
  assert.equal(filterButtons[0].classList.contains('is-active'), true);
  assert.match(listEl.innerHTML, /Ana Santos/);
  assert.match(listEl.innerHTML, /Ben Cruz/);
  assert.doesNotMatch(listEl.innerHTML, /Cara Reyes|Dan Lim/);

  // Clicking Requests filter pill switches to Message Requests while keeping all 4 filter pills visible
  await dispatchClick(filterButtons[2]);
  assert.equal(filterPills.hidden, false, '4-option filter strip must remain visible on Requests');
  assert.equal(filterButtons[2].classList.contains('is-active'), true);
  assert.equal(filterButtons[2].getAttribute('aria-selected'), 'true');
  assert.equal(filterButtons[0].classList.contains('is-active'), false);
  assert.match(listEl.innerHTML, /Cara Reyes/);
  assert.doesNotMatch(listEl.innerHTML, /Ana Santos|Ben Cruz|Dan Lim/);

  // Clicking Unread directly from Requests returns to Chats with Unread filter applied
  await dispatchClick(filterButtons[1]);
  assert.equal(filterButtons[1].classList.contains('is-active'), true);
  assert.match(listEl.innerHTML, /Ben Cruz/);
  assert.doesNotMatch(listEl.innerHTML, /Ana Santos|Cara Reyes|Dan Lim/);

  // Clicking Archived shows archived chats cleanly
  await dispatchClick(filterButtons[3]);
  assert.equal(filterButtons[3].classList.contains('is-active'), true);
  assert.match(listEl.innerHTML, /Dan Lim/);
  assert.doesNotMatch(listEl.innerHTML, /Ana Santos|Ben Cruz|Cara Reyes/);

  // Clicking top-right Friends icon opens Friends view with active pressed state and Back-to-chats button
  await dispatchClick(friendsBtn);
  assert.equal(getEl('msg-view-friends').hidden, false);
  assert.equal(getEl('msg-view-chats').hidden, true);
  assert.equal(friendsBtn.classList.contains('is-active'), true);
  assert.equal(friendsBtn.getAttribute('aria-pressed'), 'true');
  assert.match(getEl('msg-view-friends').innerHTML, /id="msg-friends-back-btn"[^>]*data-msg-tab="chats"[\s\S]*?Back to chats/);

  // Clicking Friends icon again while on Friends toggles back to Chats
  await dispatchClick(friendsBtn);
  assert.equal(getEl('msg-view-friends').hidden, true);
  assert.equal(getEl('msg-view-chats').hidden, false);
  assert.equal(friendsBtn.classList.contains('is-active'), false);
  assert.equal(friendsBtn.getAttribute('aria-pressed'), 'false');

  // Opening Friends and clicking Back to chats returns cleanly to Chats
  await dispatchClick(friendsBtn);
  assert.equal(getEl('msg-view-friends').hidden, false);
  await dispatchClick(friendsBackBtn);
  assert.equal(getEl('msg-view-friends').hidden, true);
  assert.equal(getEl('msg-view-chats').hidden, false);

  // Opening Friends and triggering hardware back navigation returns cleanly to Chats
  await dispatchClick(friendsBtn);
  assert.equal(getEl('msg-view-friends').hidden, false);
  assert.equal(win.IponMessages.handleBackNavigation(), true);
  assert.equal(getEl('msg-view-friends').hidden, true);
  assert.equal(getEl('msg-view-chats').hidden, false);

  // Notification deep-link to message request lands on Requests pill active; default openWorkspace resets to Inbox
  await win.IponMessages.openFromNotification({ type: 'SOCIAL_MESSAGE_REQUEST', link: 'dashboard.html?messages=requests' });
  assert.equal(filterButtons[2].classList.contains('is-active'), true);
  assert.match(listEl.innerHTML, /Cara Reyes/);

  await win.IponMessages.openWorkspace();
  assert.equal(filterButtons[0].classList.contains('is-active'), true, 'default openWorkspace must reset filter back to Inbox');
  assert.match(listEl.innerHTML, /Ana Santos/);
});
