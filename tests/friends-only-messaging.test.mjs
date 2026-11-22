import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('migration 20261122_164 and schema.sql enforce FRIENDS_ONLY on direct messages, file uploads, and conversation state', () => {
  const mig = read('database/migrations/20261122_164_enforce_friends_only_direct_messaging.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');

  assert.match(mig, /'20261122_164'/);
  assert.match(schema, /'20261122_164'/);

  // can_send_to_conversation enforces FRIENDS_ONLY for non-friend direct chats (used by chat-upload-urls)
  const canSendMatch = mig.match(/create or replace function public\.can_send_to_conversation[\s\S]*?\$\$;/i);
  assert.ok(canSendMatch, 'Expected can_send_to_conversation in migration 164');
  assert.match(canSendMatch[0], /if v_peer_id = v_uid then\s+return true;/i);
  assert.match(canSendMatch[0], /not public\.are_friends\(v_uid, v_peer_id\)[\s\S]*?allow_message_requests',\s*'FRIENDS_ONLY'\)\s*=\s*'FRIENDS_ONLY'[\s\S]*?return false;/i);

  // send_chat_message enforces FRIENDS_ONLY unconditionally on non-friend direct chats (before status branches)
  const sendMatch = mig.match(/create or replace function public\.send_chat_message[\s\S]*?\$\$;/i);
  assert.ok(sendMatch, 'Expected send_chat_message in migration 164');
  const directGuardIdx = sendMatch[0].indexOf("raise exception 'This user only accepts messages from friends.'");
  const declinedIdx = sendMatch[0].indexOf("if v_conv.status = 'DECLINED'");
  assert.ok(directGuardIdx > 0 && declinedIdx > 0 && directGuardIdx < declinedIdx,
    'FRIENDS_ONLY guard must run for all non-friend direct chats before the DECLINED branch');

  // get_conversations exposes can_message and friends_only_locked on direct peers
  const getConvsMatch = mig.match(/create or replace function public\.get_conversations[\s\S]*?\$\$;/i);
  assert.ok(getConvsMatch, 'Expected get_conversations in migration 164');
  assert.match(getConvsMatch[0], /'can_message'/);
  assert.match(getConvsMatch[0], /'friends_only_locked'/);

  // Grants & revokes preserved
  assert.match(mig, /revoke all on function public\.can_send_to_conversation\(uuid\), public\.send_chat_message\(uuid,text,text,uuid,uuid,jsonb,jsonb\), public\.get_conversations\(\) from public, anon;/i);
  assert.match(mig, /grant execute on function public\.can_send_to_conversation\(uuid\), public\.send_chat_message\(uuid,text,text,uuid,uuid,jsonb,jsonb\), public\.get_conversations\(\) to authenticated;/i);

  // Premium, simple CSS rules in light, dark, midnight, and mobile
  assert.match(css, /\.msg-blocked-banner\.is-friends-only\s*\{/);
  assert.match(css, /\.msg-friends-only-lead\s*\{/);
  assert.match(css, /\.msg-friends-only-icon\s*\{/);
  assert.match(css, /\.msg-friends-only-copy\s*\{/);
  assert.match(css, /\.msg-friends-only-action\s*\{/);
  assert.match(css, /\.msg-friends-only-pill\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.msg-blocked-banner\.is-friends-only\s*\{/);
  assert.match(css, /\.msg-thread-pane\[data-chat-theme="midnight"\] \.msg-blocked-banner\.is-friends-only\s*\{/);
});

test('runtime direct thread enforces Friends-only composer lock, blocks sends/files/voice/forwards, and renders clean bottom bar states', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const mariaId = '22222222-2222-4222-8222-222222222222';
  const juanId = '33333333-3333-4333-8333-333333333333';
  const mariaConvId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const juanConvId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const reqId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      id: '',
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      disabled: false,
      open: false,
      title: '',
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
      focus() { },
      select() { },
      click() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      appendChild(n) { return n; },
      insertAdjacentHTML() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest(sel) {
        if (sel === `#${this.id}`) return this;
        return null;
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener() { },
      async _emit(ev, evObj = {}) {
        for (const fn of (listeners.get(ev) || [])) {
          await fn(evObj);
        }
      }
    };
    return el;
  };

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const el = makeEl(id.includes('dialog') ? 'dialog' : id.includes('form') ? 'form' : 'div');
      el.id = id;
      els.set(id, el);
    }
    return els.get(id);
  };

  const docListeners = new Map();
  const emitDoc = async (ev, evObj = {}) => {
    for (const fn of (docListeners.get(ev) || [])) {
      await fn(evObj);
    }
  };

  const rpcCalls = [];
  const toasts = [];
  let mariaThreadState = {
    id: mariaId,
    conversation_id: mariaConvId,
    kind: 'DIRECT',
    full_name: 'Maria Santos',
    username: 'maria',
    status: 'ACCEPTED',
    friendship_status: 'NONE',
    friend_request_id: null,
    can_message: false,
    friends_only_locked: true,
    can_send_friend_request: true,
    chat_theme: 'paper',
    receipts_enabled: true
  };

  const ctx = {
    window: null,
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      documentElement: makeEl('html'),
      body: Object.assign(makeEl('body'), { dataset: { page: 'dashboard' } }),
      getElementById: (id) => getEl(id),
      createElement: (t) => makeEl(t),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener(ev, fn) {
        if (!docListeners.has(ev)) docListeners.set(ev, []);
        docListeners.get(ev).push(fn);
      },
      removeEventListener() { }
    },
    navigator: {
      userAgent: 'Mozilla/5.0',
      mediaDevices: { getUserMedia: async () => { throw new Error('Should never request mic when locked'); } }
    },
    MediaRecorder: class { static isTypeSupported() { return true; } },
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
      toast: (msg, type) => toasts.push({ msg, type }),
      confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e || 'Error'),
      dateLabel: (d) => String(d || ''),
      rpc: async (name, params = {}) => {
        rpcCalls.push({ name, params });
        if (name === 'get_conversations') {
          return [
            {
              id: mariaConvId,
              kind: 'DIRECT',
              status: 'ACCEPTED',
              peer: {
                id: mariaId,
                full_name: 'Maria Santos',
                username: 'maria',
                is_friend: mariaThreadState.friendship_status === 'FRIENDS',
                is_blocked: false,
                can_message: mariaThreadState.can_message,
                friends_only_locked: !mariaThreadState.can_message
              },
              last_message_at: '2026-11-22T01:00:00Z',
              last_message_preview: 'Old message',
              unread_count: 0
            },
            {
              id: juanConvId,
              kind: 'DIRECT',
              status: 'ACCEPTED',
              peer: {
                id: juanId,
                full_name: 'Juan Reyes',
                username: 'juan',
                is_friend: true,
                is_blocked: false,
                can_message: true,
                friends_only_locked: false
              },
              last_message_at: '2026-11-22T01:05:00Z',
              last_message_preview: 'Hey friend!',
              unread_count: 0
            }
          ];
        }
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: { allow_message_requests: 'FRIENDS_ONLY' } },
            friends: [{ id: juanId, full_name: 'Juan Reyes', username: 'juan' }],
            incoming_requests: [],
            sent_requests: [],
            blocked_users: []
          };
        }
        if (name === 'get_conversation_messages') {
          return {
            conversation: { ...mariaThreadState },
            has_older: false,
            unread_first_id: null,
            pinned_messages: [],
            messages: [
              {
                id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                conversation_id: mariaConvId,
                sender_id: mariaId,
                sender_name: 'Maria Santos',
                body: 'Hello from before!',
                message_type: 'TEXT',
                created_at: '2026-11-22T01:00:00Z',
                attachments: [],
                reactions: []
              }
            ]
          };
        }
        if (name === 'mark_conversation_read' || name === 'mark_messages_delivered' || name === 'get_social_notifications') {
          return name === 'get_social_notifications' ? { items: [], unread_count: 0 } : true;
        }
        return {};
      },
      client: {
        from: () => {
          const res = Promise.resolve({ data: [], error: null });
          const chain = new Proxy({}, {
            get(_, prop) {
              if (prop === 'then' || prop === 'catch' || prop === 'finally') return res[prop].bind(res);
              return () => chain;
            }
          });
          return chain;
        },
        channel: () => ({
          on() { return this; },
          subscribe() { return this; },
          send: async () => ({})
        }),
        removeChannel() { }
      }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js', timeout: 5000 });
  await ctx.IponMessages.init(ctx.Ipon.profile);
  await ctx.IponMessages.openWorkspace({ conversationId: mariaConvId });

  const composerForm = getEl('msg-composer-form');
  const blockedBanner = getEl('msg-blocked-banner');
  const composerInput = getEl('msg-composer-input');
  const messagesList = getEl('msg-messages-list');

  // 1. NONE + can_send_friend_request -> hides composer, shows premium Friends only bar with Add friend CTA
  assert.equal(composerForm.hidden, true, 'Composer must be hidden when peer is Friends only');
  assert.equal(blockedBanner.hidden, false, 'Bottom notice bar must be visible');
  assert.equal(blockedBanner.classList.contains('is-friends-only'), true, 'Bottom notice must use .is-friends-only style');
  assert.match(blockedBanner.innerHTML, /<strong>Friends only<\/strong>/);
  assert.match(blockedBanner.innerHTML, /Add Maria as a friend to send messages or files\./);
  assert.match(blockedBanner.innerHTML, /data-social-action="add_friend"[^>]*>Add friend<\/button>/);
  assert.doesNotMatch(messagesList.innerHTML, /data-msg-act="react"/, 'React hover button hidden when locked');
  assert.doesNotMatch(messagesList.innerHTML, /data-msg-act="reply"/, 'Reply hover button hidden when locked');

  // 2. Trying to submit text, attach files, or start voice recording is blocked
  composerInput.value = 'Should not send';
  await emitDoc('submit', { target: composerForm, preventDefault() { } });
  assert.equal(rpcCalls.some((c) => c.name === 'send_chat_message'), false, 'Text send must be blocked');
  assert.ok(toasts.some((t) => /only accepts messages from friends/i.test(t.msg) && t.type === 'error'));

  toasts.length = 0;
  const uploadQueue = getEl('msg-upload-queue');
  uploadQueue.hidden = true;
  const fileInput = getEl('msg-file-input');
  fileInput.files = [{ name: 'receipt.pdf', type: 'application/pdf', size: 1024 }];
  await emitDoc('change', { target: fileInput });
  assert.ok(toasts.some((t) => /only accepts messages and files from friends/i.test(t.msg) && t.type === 'error'));
  assert.equal(uploadQueue.hidden, true, 'Upload queue must remain hidden when locked');
  assert.equal(uploadQueue.innerHTML, '', 'Upload queue must remain empty when locked');

  toasts.length = 0;
  const voiceBtn = getEl('msg-voice-btn');
  await emitDoc('click', { target: voiceBtn });
  assert.ok(toasts.some((t) => /only accepts voice messages from friends/i.test(t.msg) && t.type === 'error'));

  // 3. Forward dialog excludes non-friend Friends-only peer (Maria) while keeping friend (Juan)
  const fakeForwardBtn = makeEl('button');
  fakeForwardBtn.dataset = { ctxDo: 'forward', msgId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
  fakeForwardBtn.closest = (sel) => (sel === '[data-ctx-do]' ? fakeForwardBtn : null);
  await emitDoc('click', { target: fakeForwardBtn });
  const fwdBody = getEl('msg-forward-body');
  assert.match(fwdBody.innerHTML, /Juan Reyes/, 'Friend should appear as forward target');
  assert.doesNotMatch(fwdBody.innerHTML, /Maria Santos/, 'Friends-only non-friend must be excluded from forward targets');

  // 4. OUTGOING_REQUEST renders Request sent pill
  mariaThreadState = { ...mariaThreadState, friendship_status: 'OUTGOING_REQUEST' };
  await ctx.IponMessages.openWorkspace({ conversationId: mariaConvId });
  assert.equal(composerForm.hidden, true);
  assert.match(blockedBanner.innerHTML, /Request sent/);
  assert.match(blockedBanner.innerHTML, /Messaging unlocks once Maria accepts\./);

  // 5. INCOMING_REQUEST renders Accept button with data-req-id
  mariaThreadState = { ...mariaThreadState, friendship_status: 'INCOMING_REQUEST', friend_request_id: reqId };
  await ctx.IponMessages.openWorkspace({ conversationId: mariaConvId });
  assert.equal(composerForm.hidden, true);
  assert.match(blockedBanner.innerHTML, /data-req-decision="ACCEPT"/);
  assert.match(blockedBanner.innerHTML, new RegExp(`data-req-id="${reqId}"`));

  // 6. can_send_friend_request = false renders notice with no Add friend button
  mariaThreadState = { ...mariaThreadState, friendship_status: 'NONE', friend_request_id: null, can_send_friend_request: false };
  await ctx.IponMessages.openWorkspace({ conversationId: mariaConvId });
  assert.equal(composerForm.hidden, true);
  assert.match(blockedBanner.innerHTML, /Maria only accepts messages and files from friends\./);
  assert.doesNotMatch(blockedBanner.innerHTML, /Add friend/);

  // 7. Once FRIENDS (can_message: true), composer unlocks and notice hides cleanly
  mariaThreadState = { ...mariaThreadState, friendship_status: 'FRIENDS', can_message: true, friends_only_locked: false };
  await ctx.IponMessages.openWorkspace({ conversationId: mariaConvId });
  assert.equal(composerForm.hidden, false, 'Composer unlocks once friends');
  assert.equal(blockedBanner.hidden, true, 'Notice bar hides once friends');
  assert.equal(blockedBanner.classList.contains('is-friends-only'), false);
});

test('group member picker hides non-friends with Friends-only messaging privacy and Migration 173 enforces FRIENDS_ONLY default', async () => {
  const mig173 = read('database/migrations/20261122_173_group_picker_exclude_friends_only.sql');
  const schema = read('database/schema.sql');
  const messagesJs = read('js/messages.js');

  assert.match(mig173, /'20261122_173'/);
  assert.ok(schema.replace(/\r\n/g, '\n').includes(mig173.trim().replace(/\r\n/g, '\n')), 'schema.sql must include Migration 173');
  assert.match(mig173, /'can_add_to_group',\s*\(\s*c\.is_friend\s+or coalesce\(c\.chat_privacy ->> 'allow_message_requests',\s*'FRIENDS_ONLY'\)\s*<>\s*'FRIENDS_ONLY'\s*\)/i);

  for (const fn of ['create_group_chat', 'add_group_chat_members']) {
    const fnMatch = mig173.match(new RegExp(`create or replace function public\\.${fn}[\\s\\S]*?\\$\\$;`, 'i'));
    assert.ok(fnMatch, `Expected ${fn} in Migration 173`);
    assert.match(fnMatch[0], /coalesce\(v_target\.chat_privacy ->> 'allow_message_requests',\s*'FRIENDS_ONLY'\)\s*=\s*'FRIENDS_ONLY'/i);
  }

  // Runtime check: open New Group Chat modal and verify non-friends with Friends-only privacy do not appear at all
  const meId = '11111111-1111-4111-8111-111111111111';
  const friendId = '22222222-2222-4222-8222-222222222222';
  const everyonePeerId = '33333333-3333-4333-8333-333333333333';
  const lockedNonFriendId = '44444444-4444-4444-8444-444444444444';
  const creatorViewLockedId = '55555555-5555-4555-8555-555555555555';

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    return {
      tagName: String(tag).toUpperCase(),
      id: '',
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      disabled: false,
      open: false,
      title: '',
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
      focus() { },
      select() { },
      click() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      appendChild(n) { return n; },
      insertAdjacentHTML() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest(sel) { return sel === `#${this.id}` ? this : null; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener() { }
    };
  };

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const el = makeEl(id.includes('dialog') ? 'dialog' : id.includes('form') ? 'form' : 'div');
      el.id = id;
      els.set(id, el);
    }
    return els.get(id);
  };
  const docListeners = new Map();

  const ctx = {
    window: null,
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      documentElement: makeEl('html'),
      body: Object.assign(makeEl('body'), { dataset: { page: 'dashboard' } }),
      getElementById: (id) => getEl(id),
      createElement: (t) => makeEl(t),
      querySelector: () => null,
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
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { }, removeEventListener() { },
    console,
    Ipon: {
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera', chat_privacy: { show_online: true } },
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''),
      isUserOnline: () => false,
      bindAvatarFallbacks() { }, syncPresenceDots() { }, syncMessagesBadges() { }, setBusy() { },
      toast() { }, confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e || 'Error'),
      dateLabel: (d) => String(d || ''),
      rpc: async (name) => {
        if (name === 'get_conversations') return [];
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: { allow_message_requests: 'FRIENDS_ONLY' } },
            friends: [{ id: friendId, full_name: 'Juan Friend', username: 'juanf' }],
            incoming_requests: [], sent_requests: [], blocked_users: []
          };
        }
        if (name === 'search_social_users') {
          return [
            { id: friendId, full_name: 'Juan Friend', username: 'juanf', friendship_status: 'FRIENDS', can_message: true, can_add_to_group: true },
            { id: everyonePeerId, full_name: 'Clara Open', username: 'clara', friendship_status: 'NONE', can_message: true, can_add_to_group: true },
            { id: lockedNonFriendId, full_name: 'Adam Private', username: 'adam', friendship_status: 'NONE', can_message: false, can_add_to_group: false },
            // Even if direct can_message is true (e.g. creator account), Friends-only non-friends must stay hidden in group picker
            { id: creatorViewLockedId, full_name: 'Guille Private', username: 'guille', friendship_status: 'NONE', can_message: true, can_add_to_group: false }
          ];
        }
        return {};
      },
      client: {
        from: () => {
          const res = Promise.resolve({ data: [], error: null });
          const chain = new Proxy({}, {
            get(_, prop) {
              if (prop === 'then' || prop === 'catch' || prop === 'finally') return res[prop].bind(res);
              return () => chain;
            }
          });
          return chain;
        },
        channel: () => ({ on() { return this; }, subscribe() { return this; }, send: async () => ({}) }),
        removeChannel() { }
      }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js', timeout: 5000 });
  await ctx.IponMessages.init(ctx.Ipon.profile);
  await ctx.IponMessages.openWorkspace({ tab: 'chats' });

  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-new-group-btn' ? getEl('msg-new-group-btn') : null) }
  })));

  const listHtml = getEl('msg-group-member-list').innerHTML;
  assert.match(listHtml, /Juan Friend/, 'Friends must appear in group member picker');
  assert.match(listHtml, /Clara Open/, 'Non-friends who allow Everyone messaging may appear in group member picker');
  assert.doesNotMatch(listHtml, /Adam Private/, 'Non-friends with Friends-only messaging privacy must not appear');
  assert.doesNotMatch(listHtml, /Guille Private/, 'Friends-only non-friends must stay hidden even when direct can_message is true');
  assert.doesNotMatch(listHtml, /Friends only privacy/, 'No disabled Friends-only placeholder rows should render');
});
