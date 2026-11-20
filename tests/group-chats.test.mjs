import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('migration 20261117_105 adds group chats, preserves 90-day retention & security guards, and updates policy/sw', () => {
  const sql = read('database/migrations/20261117_105_group_chats.sql');
  const css = read('css/app.css');
  const policyJs = read('js/policy.js');
  const loginHtml = read('login.html');
  const sw = read('sw.js');

  assert.match(sql, /'20261117_105'/);
  assert.match(sql, /check \(kind in \('DIRECT', 'GROUP'\)\)/i);
  assert.match(sql, /check \(role in \('OWNER', 'ADMIN', 'MEMBER'\)\)/i);
  assert.match(sql, /create or replace function public\.is_conversation_member\(/i);

  for (const fn of [
    'create_group_chat',
    'update_group_chat_info',
    'add_group_chat_members',
    'update_group_chat_member_role',
    'remove_group_chat_member',
    'can_send_to_conversation',
    'get_conversation_attachment_paths',
    'send_chat_message',
    'delete_chat_message',
    'toggle_message_reaction',
    'pin_chat_message',
    'mark_messages_delivered',
    'mark_conversation_read',
    'update_conversation_member_state',
    'get_conversations',
    'get_conversation_messages',
    'search_conversation_messages',
    'run_data_retention_cleanup',
    'purge_inactive_user_data'
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`, 'i'));
  }

  // Same 90-day retention + orphan cleanup + inactive user ownership transfer
  assert.match(sql, /delete from public\.messages\s+where created_at < v_msg_cutoff/i);
  assert.match(sql, /delete from public\.conversations c\s+where c\.kind = 'GROUP'\s+and not exists/i);
  assert.match(sql, /revoke execute on function public\.run_data_retention_cleanup/i);
  assert.match(sql, /revoke execute on function public\.purge_inactive_user_data/i);
  assert.match(sql, /grant execute on function[\s\S]*?public\.create_group_chat\([\s\S]*?to authenticated/i);

  // CSS rules for stacked avatars, sender names, drawer member list & stable modal errors
  assert.match(css, /\.msg-group-avatar\s*\{/);
  assert.match(css, /\.msg-sender-name\s*\{/);
  assert.match(css, /\.msg-group-members-list\s*\{/);
  assert.match(css, /\.msg-group-dialog\s*\{/);
  assert.match(css, /\.msg-group-dialog-body \.msg-stable-error\.is-visible/);

  // Policy copy & service worker cache bump
  assert.match(policyJs, /Direct &amp; group messages, chat files/i);
  assert.match(loginHtml, /Direct &amp; group messages, chat files/i);
  assert.match(sw, /ipon-shell-v88/);
});

test('group chats runtime renders composite avatars, multi-sender bubbles, typing sender, drawer, forward & creation VM flow', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const mariaId = '22222222-2222-4222-8222-222222222222';
  const juanId = '33333333-3333-4333-8333-333333333333';
  const anaId = '44444444-4444-4444-8444-444444444444';
  const grpConvId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const newGrpId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
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
      setCustomValidity(m) { this._validity = String(m || ''); },
      focus() { },
      select() { },
      click() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      appendChild(n) { return n; },
      insertAdjacentHTML() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
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
      const el = makeEl(id.includes('dialog') ? 'dialog' : 'div');
      el.id = id;
      els.set(id, el);
    }
    return els.get(id);
  };

  const docListeners = new Map();
  const rpcCalls = [];
  const toasts = [];
  const typingHandlers = [];

  const convRowData = {
    id: grpConvId,
    kind: 'GROUP',
    title: 'Barkada Boracay Fund',
    description: 'Summer 2027 trip savings',
    status: 'ACCEPTED',
    my_role: 'OWNER',
    member_count: 3,
    members_preview: [
      { id: mariaId, full_name: 'Maria Santos', avatar_url: null, allow_online_status: true },
      { id: juanId, full_name: 'Juan Reyes', avatar_url: null, allow_online_status: true }
    ],
    is_pinned: false,
    is_muted: false,
    is_archived: false,
    marked_unread: false,
    chat_theme: 'paper',
    last_message_at: '2026-11-17T10:05:00Z',
    last_message_type: 'TEXT',
    last_message_preview: 'See you all tomorrow!',
    last_message_sender_id: mariaId,
    last_message_sender_name: 'Maria Santos',
    unread_count: 1
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
      isUserOnline: (id) => String(id) === mariaId,
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
        if (name === 'get_conversations') return [convRowData];
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: {} },
            friends: [
              { id: mariaId, full_name: 'Maria Santos', username: 'maria', allow_online_status: true },
              { id: anaId, full_name: 'Ana Cruz', username: 'ana', allow_online_status: true }
            ],
            incoming_requests: [],
            sent_requests: [],
            blocked_users: []
          };
        }
        if (name === 'search_social_users') {
          return [
            { id: mariaId, full_name: 'Maria Santos', username: 'maria', friendship_status: 'FRIENDS', can_message: true },
            { id: anaId, full_name: 'Ana Cruz', username: 'ana', friendship_status: 'FRIENDS', can_message: true }
          ];
        }
        if (name === 'get_conversation_messages') {
          const cid = params.p_conversation_id;
          return {
            conversation: {
              id: cid,
              conversation_id: cid,
              kind: 'GROUP',
              title: cid === newGrpId ? 'Study Pool' : 'Barkada Boracay Fund',
              full_name: cid === newGrpId ? 'Study Pool' : 'Barkada Boracay Fund',
              description: 'Summer 2027 trip savings',
              status: 'ACCEPTED',
              my_role: 'OWNER',
              member_count: 3,
              chat_theme: 'paper',
              receipts_enabled: true,
              members: [
                { id: meId, full_name: 'Alex Rivera', username: 'alex', role: 'OWNER', allow_online_status: true },
                { id: mariaId, full_name: 'Maria Santos', username: 'maria', role: 'ADMIN', is_friend: true, allow_online_status: true },
                { id: juanId, full_name: 'Juan Reyes', username: 'juan', role: 'MEMBER', is_friend: false, allow_online_status: false }
              ]
            },
            has_older: false,
            unread_first_id: null,
            pinned_messages: [],
            messages: [
              {
                id: 'msg-sys-1',
                conversation_id: cid,
                sender_id: meId,
                sender_name: 'Alex Rivera',
                body: 'Alex Rivera created the group "Barkada Boracay Fund"',
                message_type: 'SYSTEM',
                created_at: '2026-11-17T09:50:00Z'
              },
              {
                id: 'msg-maria-1',
                conversation_id: cid,
                sender_id: mariaId,
                sender_name: 'Maria Santos',
                body: 'See you all tomorrow!',
                message_type: 'TEXT',
                created_at: '2026-11-17T10:05:00Z',
                reactions: [],
                attachments: []
              },
              {
                id: 'msg-mine-1',
                conversation_id: cid,
                sender_id: meId,
                sender_name: 'Alex Rivera',
                body: 'Copy that!',
                message_type: 'TEXT',
                delivered_at: '2026-11-17T10:06:00Z',
                read_at: '2026-11-17T10:06:10Z',
                seen_by: [{ id: mariaId, full_name: 'Maria Santos', read_at: '2026-11-17T10:06:10Z' }],
                created_at: '2026-11-17T10:06:00Z',
                reactions: [],
                attachments: []
              }
            ]
          };
        }
        if (name === 'create_group_chat') {
          return { id: newGrpId, kind: 'GROUP', title: params.p_title, status: 'ACCEPTED', member_count: 2 };
        }
        return {};
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => ({
          on(type, opts, cb) {
            if (type === 'broadcast' && opts?.event === 'typing') typingHandlers.push(cb);
            return this;
          },
          subscribe() { return this; },
          send: async () => { }
        }),
        removeChannel() { }
      }
    }
  };
  ctx.window = ctx;

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.window.IponMessages.init(ctx.Ipon.profile);
  await ctx.window.IponMessages.openWorkspace({ tab: 'chats', conversationId: grpConvId });

  // 1. Conversation list renders stacked group avatar, count pill & sender-prefixed preview
  const convListHtml = getEl('msg-conv-list').innerHTML;
  assert.match(convListHtml, /msg-group-avatar/);
  assert.match(convListHtml, /msg-conv-group-pill[^>]*>3</);
  assert.match(convListHtml, /Maria: See you all tomorrow!/);

  // 2. Thread header, sender dropdown & multi-sender bubbles + seen tooltip
  const headerHtml = getEl('msg-thread-header').innerHTML;
  assert.match(headerHtml, /Barkada Boracay Fund/);
  assert.match(headerHtml, /msg-rel-chip is-group/);
  assert.match(headerHtml, /3 members · 1 active now/);

  const msgsHtml = getEl('msg-messages-list').innerHTML;
  assert.match(msgsHtml, /msg-system-event[^>]*><span>Alex Rivera created the group/);
  assert.match(msgsHtml, /class="msg-sender-name">Maria Santos</);
  assert.match(msgsHtml, /title="Seen by Maria Santos"/);

  const senderOpts = getEl('msg-thread-search-sender').innerHTML;
  assert.match(senderOpts, /Maria Santos/);
  assert.match(senderOpts, /Juan Reyes/);

  // 3. Typing broadcast updates live typing sender label for groups
  assert.ok(typingHandlers.length > 0);
  typingHandlers.at(-1)({ payload: { user_id: mariaId, user_name: 'Maria Santos', typing: true } });
  assert.equal(getEl('msg-typing-sender').hidden, false);
  assert.equal(getEl('msg-typing-sender').textContent, 'Maria');
  assert.equal(getEl('msg-peer-status-text').textContent, 'Maria is typing…');

  // 4. Thread info drawer displays Group Info, edit link, Add members, Leave group & Members list
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-thread-info-toggle' ? getEl('msg-thread-info-toggle') : null) }
  })));
  const drawerHtml = getEl('msg-thread-drawer').innerHTML;
  assert.match(drawerHtml, /Group Info &amp; Options/);
  assert.match(drawerHtml, /id="msg-group-edit-toggle"/);
  assert.match(drawerHtml, /data-group-add-members/);
  assert.match(drawerHtml, /data-group-leave/);
  assert.match(drawerHtml, /<h4>Members \(3\)<\/h4>/);
  assert.match(drawerHtml, /msg-group-role-badge is-owner">Owner</);
  assert.match(drawerHtml, /msg-group-role-badge is-admin">Admin</);

  // 5. Create Group Chat dialog validates empty name and calls create_group_chat RPC cleanly
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-new-group-btn' ? getEl('msg-new-group-btn') : null) }
  })));
  assert.equal(getEl('msg-group-dialog').open, true);

  // Submit invalid blank title -> blocked before RPC
  getEl('msg-group-title-input').value = ' ';
  await getEl('msg-group-form')._emit('submit', { preventDefault() { } });
  assert.equal(rpcCalls.filter((c) => c.name === 'create_group_chat').length, 0);
  assert.match(getEl('msg-group-title-error').textContent, /Enter a group name/);

  // Pick Ana via delegated click inside #msg-group-body and submit valid title
  getEl('msg-group-title-input').value = 'Study Pool';
  getEl('msg-group-desc-input').value = 'Weekly exam ipon';
  const pickAnaBtn = makeEl('button');
  pickAnaBtn.dataset = { groupPick: anaId };
  getEl('msg-group-body')._emit('click', {
    target: { closest: (sel) => (sel === '[data-group-pick]' ? pickAnaBtn : null) }
  });
  await getEl('msg-group-form')._emit('submit', { preventDefault() { } });

  const createCall = rpcCalls.find((c) => c.name === 'create_group_chat');
  assert.ok(createCall, 'create_group_chat RPC must be invoked');
  assert.equal(createCall.params.p_title, 'Study Pool');
  assert.deepEqual([...createCall.params.p_member_ids], [anaId]);
  assert.equal(createCall.params.p_description, 'Weekly exam ipon');
  assert.equal(createCall.params.p_avatar_url, null);
  assert.equal(getEl('msg-group-dialog').open, false);
  assert.match(toasts.at(-1)?.msg || '', /Study Pool/);
});

test('migration 20261117_106 adds group chat display picture support & storage cleanup trigger', () => {
  const sql = read('database/migrations/20261117_106_group_chat_avatar_and_cleanup.sql');
  const css = read('css/app.css');
  const messagesJs = read('js/messages.js');

  assert.match(sql, /'20261117_106'/);
  assert.match(sql, /add constraint conversations_avatar_url_check[\s\S]*is_valid_media_reference\(avatar_url\)/i);
  assert.match(sql, /tg_table_name = 'conversations'/i);
  assert.match(sql, /create trigger conversations_queue_media_cleanup[\s\S]*after update or delete on public\.conversations/i);
  assert.match(sql, /drop function if exists public\.create_group_chat\(text, uuid\[\], text\);/i);
  assert.match(sql, /drop function if exists public\.update_group_chat_info\(uuid, text, text\);/i);
  assert.match(sql, /create or replace function public\.create_group_chat\([\s\S]*p_avatar_url text default null/i);
  assert.match(sql, /create or replace function public\.update_group_chat_info\([\s\S]*p_avatar_url text default null[\s\S]*p_clear_avatar boolean default false/i);
  assert.match(sql, /updated the group photo/i);
  assert.match(sql, /removed the group photo/i);

  // Preserve attachment compression guard in contracts.test.mjs
  assert.doesNotMatch(messagesJs, /prepareImageDataUrl|canvas\.toBlob/);

  // CSS styles for avatar picker, quick camera badge & circular remove button
  assert.match(css, /\.msg-drawer-avatar-edit-btn\s*\{/);
  assert.match(css, /\.msg-group-avatar-picker\s*\{/);
  assert.match(css, /\.msg-group-avatar-remove\s*\{[^}]*border-radius:\s*50%/);
});

test('group chat avatar upload, preview, replace & clear work end-to-end in create dialog and group info drawer', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const anaId = '44444444-4444-4444-8444-444444444444';
  const grpConvId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const newGrpId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    return {
      tagName: String(tag).toUpperCase(),
      innerHTML: '',
      textContent: '',
      value: '',
      files: [],
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
      setCustomValidity(m) { this._validity = String(m || ''); },
      focus() { },
      select() { },
      click() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      appendChild(n) { return n; },
      insertAdjacentHTML() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
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
  };

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) {
      const el = makeEl(id.includes('dialog') ? 'dialog' : 'div');
      el.id = id;
      els.set(id, el);
    }
    return els.get(id);
  };

  const docListeners = new Map();
  const rpcCalls = [];
  const uploadCalls = [];
  const toasts = [];
  let serverGroupAvatar = null;

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
    setTimeout, clearTimeout,
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
      prepareAvatarDataUrl: async () => ({
        name: 'gc-pic.jpg',
        type: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
      }),
      uploadMediaDataUrl: async (dataUrl, opts) => {
        uploadCalls.push({ dataUrl, opts });
        return 'https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/public/ipon-media/group-avatars/mock-pic.jpg';
      },
      rpc: async (name, params = {}) => {
        rpcCalls.push({ name, params });
        if (name === 'get_conversations') {
          return [{
            id: grpConvId,
            kind: 'GROUP',
            title: 'Travel Savers',
            description: '2027 trip',
            avatar_url: serverGroupAvatar,
            status: 'ACCEPTED',
            my_role: 'OWNER',
            member_count: 2,
            members_preview: [{ id: anaId, full_name: 'Ana Cruz', avatar_url: null }],
            last_message_at: '2026-11-17T10:05:00Z',
            last_message_type: 'TEXT',
            last_message_preview: 'Hi!',
            unread_count: 0
          }];
        }
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', chat_privacy: {} },
            friends: [{ id: anaId, full_name: 'Ana Cruz', username: 'ana', allow_online_status: true }],
            incoming_requests: [],
            sent_requests: [],
            blocked_users: []
          };
        }
        if (name === 'search_social_users') {
          return [{ id: anaId, full_name: 'Ana Cruz', username: 'ana', friendship_status: 'FRIENDS', can_message: true }];
        }
        if (name === 'get_conversation_messages') {
          const cid = params.p_conversation_id;
          return {
            conversation: {
              id: cid,
              conversation_id: cid,
              kind: 'GROUP',
              title: cid === newGrpId ? 'Photo Club' : 'Travel Savers',
              full_name: cid === newGrpId ? 'Photo Club' : 'Travel Savers',
              avatar_url: serverGroupAvatar,
              my_role: 'OWNER',
              member_count: 2,
              members: [
                { id: meId, full_name: 'Alex Rivera', role: 'OWNER' },
                { id: anaId, full_name: 'Ana Cruz', role: 'MEMBER' }
              ]
            },
            messages: [],
            pinned_messages: [],
            has_older: false
          };
        }
        if (name === 'create_group_chat') {
          serverGroupAvatar = params.p_avatar_url || null;
          return { id: newGrpId, kind: 'GROUP', title: params.p_title, avatar_url: serverGroupAvatar, status: 'ACCEPTED', member_count: 2 };
        }
        if (name === 'update_group_chat_info') {
          if (params.p_clear_avatar) serverGroupAvatar = null;
          else if (params.p_avatar_url) serverGroupAvatar = params.p_avatar_url;
          return { id: grpConvId, title: params.p_title, description: params.p_description, avatar_url: serverGroupAvatar };
        }
        return {};
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => ({
          on() { return this; },
          subscribe() { return this; },
          send: async () => 'ok'
        }),
        removeChannel() { }
      }
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(messagesJs, ctx);
  await ctx.window.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera' });

  // 1. Create Group Chat with photo selected
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-new-group-btn' ? getEl('msg-new-group-btn') : null) }
  })));
  const createPicInput = getEl('msg-group-create-pic-input');
  createPicInput.files = [{ name: 'gc.jpg', type: 'image/jpeg', size: 12000 }];
  await createPicInput._emit('change');
  assert.match(getEl('msg-group-create-pic-preview').innerHTML, /data:image\/jpeg;base64/);
  assert.equal(getEl('msg-group-create-pic-remove').hidden, false);

  getEl('msg-group-title-input').value = 'Photo Club';
  const pickAnaBtn = makeEl('button');
  pickAnaBtn.dataset = { groupPick: anaId };
  await getEl('msg-group-body')._emit('click', {
    target: { closest: (sel) => (sel === '[data-group-pick]' ? pickAnaBtn : null) }
  });
  await getEl('msg-group-form')._emit('submit', { preventDefault() { } });

  assert.equal(uploadCalls[0]?.opts?.category, 'group-avatars');
  const createCall = rpcCalls.find((c) => c.name === 'create_group_chat');
  assert.equal(createCall.params.p_avatar_url, 'https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/public/ipon-media/group-avatars/mock-pic.jpg');

  // 2. Open existing group, open Group Info Drawer, edit photo & remove photo
  const rowEl = makeEl('button');
  rowEl.dataset = { convId: grpConvId };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-conv-id]' ? rowEl : null) }
  })));
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-thread-info-toggle' ? getEl('msg-thread-info-toggle') : null) }
  })));
  assert.match(getEl('msg-thread-drawer').innerHTML, /id="msg-group-avatar-quick-btn"/);
  assert.match(getEl('msg-thread-drawer').innerHTML, /id="msg-group-edit-pic-input"/);

  // Pick new photo in drawer & save
  const editPicInput = getEl('msg-group-edit-pic-input');
  editPicInput.id = 'msg-group-edit-pic-input';
  editPicInput.files = [{ name: 'gc2.jpg', type: 'image/jpeg', size: 15000 }];
  await Promise.all((docListeners.get('change') || []).map((fn) => fn({ target: editPicInput })));
  assert.match(getEl('msg-group-drawer-avatar-slot').innerHTML, /data:image\/jpeg;base64/);

  getEl('msg-group-edit-title').value = 'Travel Savers';
  getEl('msg-group-edit-desc').value = '2027 trip';
  await Promise.all((docListeners.get('submit') || []).map((fn) => fn({
    target: getEl('msg-group-edit-form'),
    preventDefault() { }
  })));

  const updateWithPicCall = rpcCalls.filter((c) => c.name === 'update_group_chat_info').at(-1);
  assert.equal(updateWithPicCall.params.p_avatar_url, 'https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/public/ipon-media/group-avatars/mock-pic.jpg');
  assert.equal(updateWithPicCall.params.p_clear_avatar, false);

  // Clear saved photo & save
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-group-edit-pic-remove' ? getEl('msg-group-edit-pic-remove') : null) }
  })));
  await Promise.all((docListeners.get('submit') || []).map((fn) => fn({
    target: getEl('msg-group-edit-form'),
    preventDefault() { }
  })));

  const clearPicCall = rpcCalls.filter((c) => c.name === 'update_group_chat_info').at(-1);
  assert.equal(clearPicCall.params.p_avatar_url, null);
  assert.equal(clearPicCall.params.p_clear_avatar, true);
  assert.equal(serverGroupAvatar, null);

  // 3. Mute / Unmute updates drawer button and toast immediately & syncs cleanly
  const muteBtn = makeEl('button');
  muteBtn.dataset = { convAct: 'mute' };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-conv-act]' ? muteBtn : null) }
  })));
  assert.equal(rpcCalls.at(-2)?.name === 'update_conversation_member_state' || rpcCalls.some((c) => c.name === 'update_conversation_member_state' && c.params.p_action === 'mute'), true);
  assert.match(getEl('msg-thread-drawer').innerHTML, /data-conv-act="unmute"[^>]*>[\s\S]*Unmute/);
  assert.ok(toasts.some((t) => /Chat muted/i.test(t.msg)));

  // Overflow protection checks in CSS
  const css = read('css/app.css');
  assert.match(css, /\.msg-sidebar\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /\.msg-scroll-wrap\s*\{[^}]*min-width:\s*0;[^}]*overflow-x:\s*hidden;/s);
  assert.match(css, /\.msg-messages-list\s*\{[^}]*flex:\s*0 0 auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s);
  assert.match(css, /\.msg-typing-live\s*\{[^}]*flex-shrink:\s*0;/s);
  assert.match(css, /\.msg-typing-live-inner\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*0;/s);
  assert.match(css, /\.msg-text,\s*\.msg-deleted-note\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  assert.match(css, /\.msg-conv-preview\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
});

test('messaging privacy form excludes moved handle/bio fields & save button stays disabled until modified', async () => {
  const messagesJs = read('js/messages.js');
  const coreJs = read('js/core.js');
  const meId = '11111111-1111-4111-8111-111111111111';

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      innerHTML: '',
      textContent: '',
      value: '',
      checked: false,
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
      toggleAttribute: (k, force) => {
        if (force === undefined) { if (attrs.has(k)) attrs.delete(k); else attrs.set(k, ''); }
        else if (force) attrs.set(k, '');
        else attrs.delete(k);
      },
      hasAttribute: (k) => attrs.has(k),
      setCustomValidity(m) { this._validity = String(m || ''); },
      focus() { },
      select() { },
      click() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      appendChild(n) { return n; },
      insertAdjacentHTML() { },
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
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
      const el = makeEl(id.includes('dialog') ? 'dialog' : 'div');
      el.id = id;
      els.set(id, el);
    }
    return els.get(id);
  };
  const docListeners = new Map();
  const rpcCalls = [];
  let localPatch = null;

  const friendReq = getEl('msg-set-friend-req');
  friendReq.value = 'EVERYONE';
  const msgReq = getEl('msg-set-msg-req');
  msgReq.value = 'EVERYONE';
  const profileVis = getEl('msg-set-profile-vis');
  profileVis.value = 'EVERYONE';
  const showOnline = makeEl('input'); showOnline.checked = true;
  const showLastSeen = makeEl('input'); showLastSeen.checked = true;
  const readReceipts = makeEl('input'); readReceipts.checked = true;
  const privacyForm = getEl('msg-privacy-form');
  privacyForm.elements = {
    allow_friend_requests: friendReq,
    allow_message_requests: msgReq,
    profile_visibility: profileVis,
    show_online: showOnline,
    show_last_seen: showLastSeen,
    read_receipts: readReceipts
  };
  const saveBtn = getEl('msg-settings-save');
  saveBtn.disabled = true;

  const ctx = {
    window: null,
    FormData: class {
      get(k) { return privacyForm.elements[k]?.value ?? ''; }
    },
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
    setTimeout, clearTimeout,
    setInterval: () => 0,
    clearInterval() { },
    requestAnimationFrame: (fn) => fn(),
    addEventListener() { },
    removeEventListener() { },
    console,
    Ipon: {
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera', username: 'alex_r', chat_privacy: { show_online: true } },
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || 'U').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join(''),
      isUserOnline: () => false,
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      syncMessagesBadges() { },
      updateLocalProfile(patch) { localPatch = patch; },
      setOnlineVisibility() { },
      setBusy(btn, busy) {
        if (!btn) return;
        btn.classList.toggle('is-busy', Boolean(busy));
        btn.disabled = busy ? true : btn.dataset?.dirtyLocked === 'true';
      },
      toast() { },
      confirmAction: async () => true,
      friendlyError: (e) => String(e?.message || e || 'Error'),
      dateLabel: (d) => String(d || ''),
      rpc: async (name, args) => {
        rpcCalls.push({ name, args });
        if (name === 'get_conversations') return [];
        if (name === 'get_social_overview') {
          return {
            me: { id: meId, full_name: 'Alex Rivera', username: 'alex_r', bio: 'Saver', chat_privacy: { show_online: true, show_last_seen: true, read_receipts: true } },
            friends: [],
            incoming_requests: [],
            sent_requests: [],
            blocked_users: []
          };
        }
        if (name === 'update_social_profile_and_privacy') {
          return { username: 'alex_r', bio: 'Saver', chat_privacy: args.p_chat_privacy };
        }
        return {};
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => ({ on() { return this; }, subscribe() { return this; }, send: async () => 'ok' }),
        removeChannel() { }
      }
    }
  };
  ctx.window = ctx;
  vm.runInNewContext(messagesJs, ctx);
  await ctx.window.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Alex Rivera' });

  // Open privacy settings modal -> username & bio are absent; Save button starts disabled
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-privacy-btn' ? getEl('msg-privacy-btn') : null) }
  })));
  assert.doesNotMatch(getEl('msg-settings-body').innerHTML, /msg-set-username|msg-set-bio/);
  assert.equal(saveBtn.disabled, true, 'Save messaging settings button must be disabled when nothing changed');
  assert.match(getEl('msg-settings-body').innerHTML, /id="msg-settings-save"[^>]*disabled/);

  // Toggling a privacy switch enables Save; reverting disables Save again
  showOnline.checked = false;
  await privacyForm._emit('change');
  assert.equal(saveBtn.disabled, false, 'Save button enables when privacy setting changes');
  showOnline.checked = true;
  await privacyForm._emit('change');
  assert.equal(saveBtn.disabled, true, 'Save button disables again when reverted');

  // Submitting sends only p_chat_privacy (including Friends & connections / Friends of friends / No one) cleanly
  friendReq.value = 'MUTUAL_GROUPS';
  profileVis.value = 'FRIENDS_AND_CONNECTIONS';
  await privacyForm._emit('change');
  await privacyForm.onsubmit({ preventDefault() { }, submitter: saveBtn });
  const privCall = rpcCalls.find((c) => c.name === 'update_social_profile_and_privacy');
  assert.ok(privCall, 'Expected update_social_profile_and_privacy RPC call');
  assert.equal('p_username' in (privCall.args || {}), false);
  assert.equal('p_bio' in (privCall.args || {}), false);
  assert.equal(privCall.args.p_chat_privacy.allow_friend_requests, 'MUTUAL_GROUPS');
  assert.equal(privCall.args.p_chat_privacy.profile_visibility, 'FRIENDS_AND_CONNECTIONS');
  assert.equal(localPatch?.chat_privacy?.allow_friend_requests, 'MUTUAL_GROUPS');
  assert.equal(localPatch?.chat_privacy?.profile_visibility, 'FRIENDS_AND_CONNECTIONS');
  assert.match(coreJs, /function bindDirtySaveForm\(/);

  // Opening a peer profile popover with profile_visible=false hides bio/username/apps/mutuals/theme & shows private note
  const popEl = getEl('msg-profile-popover');
  popEl.getBoundingClientRect = () => ({ width: 340, height: 220, left: 0, right: 340, top: 0, bottom: 220 });
  const dpTrigger = makeEl('button');
  dpTrigger.dataset = { socialUserDp: '55555555-5555-4555-8555-555555555555' };
  dpTrigger.getBoundingClientRect = () => ({ left: 40, right: 80, top: 60, bottom: 100 });
  dpTrigger.closest = (sel) => (sel.includes('[data-social-user-dp]') ? dpTrigger : null);

  ctx.Ipon.rpc = async (name) => {
    if (name === 'get_social_user_profile') {
      return {
        id: '55555555-5555-4555-8555-555555555555',
        is_self: false,
        profile_visible: false,
        profile_visibility: 'FRIENDS_OF_FRIENDS',
        full_name: 'Ana Reyes',
        username: null,
        bio: null,
        social_links: {},
        avatar_url: 'https://cdn.example/secret-dp.jpg',
        verified_badge: 'NONE',
        friendship_status: 'NONE',
        can_message: true,
        can_send_friend_request: true,
        allow_online_status: false,
        last_seen_at: null,
        shared_groups: [],
        friends_count: 0,
        mutual_friends_count: 0,
        mutual_friends: []
      };
    }
    if (name === 'get_profile_card_appearance') {
      return {
        profile_visible: false,
        card_theme: 'emerald',
        cover_url: null,
        profile_effect: 'none',
        social_links: {}
      };
    }
    return {};
  };

  await Promise.all((docListeners.get('click') || []).map((fn) => fn({ target: dpTrigger, stopPropagation() { } })));
  assert.equal(popEl.hidden, false);
  assert.match(popEl.innerHTML, /class="msg-pop-private-note"[\s\S]*?Only friends and friends of friends can view full profile details\./);
  assert.match(popEl.innerHTML, /<span class="avatar-circle avatar-fallback avatar-lg"[^>]*>AR<\/span>/);
  assert.doesNotMatch(popEl.innerHTML, /secret-dp\.jpg|msg-pop-cover|msg-pop-bio|msg-dp-preview-trigger|msg-mutual-wrap|msg-pop-groups-card/);
  assert.match(popEl.innerHTML, /data-social-action="add_friend"/);
  assert.match(popEl.innerHTML, /data-social-action="message"/);
  assert.equal(popEl.dataset.cardTheme, undefined);
});

test('My Account profile form validates username availability and bio live for all roles including Super Admin', async () => {
  const coreJs = read('js/core.js');
  const noop = () => {};
  const els = new Map();
  const makeEl = (tag = 'div', props = {}) => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      type: props.type || '',
      name: props.name || '',
      id: props.id || '',
      value: props.value || '',
      textContent: props.textContent || '',
      innerHTML: '',
      title: '',
      hidden: Boolean(props.hidden),
      disabled: Boolean(props.disabled),
      required: Boolean(props.required),
      readOnly: Boolean(props.readOnly),
      dataset: {},
      style: { setProperty: noop, removeProperty: noop },
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      toggleAttribute: (k, force) => {
        if (force === undefined) { if (attrs.has(k)) attrs.delete(k); else attrs.set(k, ''); }
        else if (force) attrs.set(k, '');
        else attrs.delete(k);
      },
      hasAttribute: (k) => attrs.has(k),
      setCustomValidity(m) { this._validity = String(m || ''); },
      checkValidity() { return !this._validity; },
      focus: noop,
      select: noop,
      showModal() { this.open = true; },
      close() { this.open = false; },
      matches: () => false,
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      insertAdjacentElement(_pos, node) { return node; },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener: noop,
      async _emit(ev, evObj = {}) {
        const event = { target: el, preventDefault: noop, submitter: saveBtn, ...evObj };
        for (const fn of (listeners.get(ev) || [])) await fn(event);
      }
    };
    el.elements = new Proxy([], {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && !Number.isInteger(Number(prop))) {
          target[prop] = makeEl('input');
          target.push(target[prop]);
          return target[prop];
        }
        return target[prop];
      }
    });
    if (props.id) els.set(props.id, el);
    return el;
  };
  const getEl = (id) => {
    if (!els.has(id)) makeEl(id.includes('dialog') ? 'dialog' : 'div', { id });
    return els.get(id);
  };

  const firstName = makeEl('input', { id: 'quick-first-name', name: 'first_name', value: 'Zedrick' });
  const middleName = makeEl('input', { id: 'quick-middle-name', name: 'middle_name', value: '' });
  const lastName = makeEl('input', { id: 'quick-last-name', name: 'last_name', value: '' });
  const usernameInput = makeEl('input', { id: 'quick-username', name: 'username', value: '' });
  const usernameHelp = makeEl('small', { id: 'quick-username-help', textContent: '3–24 lowercase letters, numbers, or underscores.' });
  const usernameError = makeEl('small', { id: 'quick-username-error', hidden: true });
  const bioInput = makeEl('textarea', { id: 'quick-bio', name: 'bio', value: '' });
  const bioCounter = makeEl('small', { id: 'quick-bio-count', textContent: '0 / 58 characters' });
  const bioError = makeEl('small', { id: 'quick-bio-error', hidden: true });
  const contactInput = makeEl('input', { id: 'quick-contact', name: 'contact_number', value: '09171234567' });
  const saveBtn = makeEl('button', { id: 'quick-profile-save', type: 'submit', textContent: 'Save changes' });

  const attachErrorEl = (input, errEl) => {
    errEl.classList.add('field-error');
    input.closest = (sel) => (String(sel || '').includes('.field')
      ? { querySelector: (q) => (q === '.field-error' ? errEl : (String(q || '').includes('label') ? makeEl('label') : null)), appendChild: (n) => n, append: noop }
      : null);
  };
  attachErrorEl(usernameInput, usernameError);
  attachErrorEl(bioInput, bioError);

  const profileForm = makeEl('form', { id: 'quick-profile-form' });
  profileForm.elements = Object.assign(
    [firstName, middleName, lastName, usernameInput, bioInput, contactInput],
    { first_name: firstName, middle_name: middleName, last_name: lastName, username: usernameInput, bio: bioInput, contact_number: contactInput }
  );
  profileForm.querySelector = (sel) => (sel === '[type="submit"]' ? saveBtn : null);
  profileForm.querySelectorAll = (sel) => (sel.includes('first_name') ? [firstName, middleName, lastName] : []);

  const appLoader = makeEl('div', { id: 'app-loader' });
  const superAdmin = {
    id: '99999999-9999-4999-8999-999999999999',
    role: 'SUPER_ADMIN',
    status: 'ACTIVE',
    first_name: 'Zedrick',
    middle_name: null,
    last_name: null,
    full_name: 'Zedrick',
    contact_number: '09171234567',
    username: null,
    bio: null,
    email: 'owner@myipon.example',
    notifications_enabled: true,
    social_links: {}
  };
  const rpcCalls = [];
  const toasts = [];
  let rejectTakenNext = true;

  const clientMock = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      if (name === 'check_username_available') {
        return { data: String(args?.p_username || '').toLowerCase() !== 'taken_handle', error: null };
      }
      if (name === 'update_own_social_identity') {
        if (args?.p_username === 'taken_handle' && rejectTakenNext) {
          return { data: null, error: { code: '23505', message: 'That username is already taken.' } };
        }
        superAdmin.username = args?.p_username ?? null;
        superAdmin.bio = args?.p_bio ?? null;
        return { data: { username: superAdmin.username, bio: superAdmin.bio }, error: null };
      }
      if (name === 'update_own_profile') {
        return { data: null, error: null };
      }
      if (name === 'get_profile_card_appearance') {
        return { data: { card_theme: 'emerald', cover_url: null, profile_effect: 'none' }, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { ...superAdmin }, error: null })
        })
      })
    }),
    storage: null,
    channel: () => ({ on() { return this; }, subscribe: () => ({}) }),
    getChannels: () => [],
    removeChannel: noop
  };

  const ctx = {
    window: null,
    FormData: class {
      constructor(form) { this._form = form; }
      get(k) { return this._form?.elements?.[k]?.value ?? ''; }
    },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    document: {
      hidden: false,
      getElementById: (id) => (id === 'app-loader' ? appLoader : getEl(id)),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: (t) => makeEl(t),
      addEventListener: noop,
      removeEventListener: noop,
      body: Object.assign(makeEl('body'), { dataset: {} }),
      documentElement: makeEl('html')
    },
    location: { href: 'http://localhost/super-admin.html', pathname: '/super-admin.html', origin: 'http://localhost', search: '', replace: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: {},
    supabase: { createClient: () => clientMock },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    dispatchEvent: noop,
    addEventListener: noop,
    removeEventListener: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout, console
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };

  const patchedCore = coreJs.replace(
    '  window.Ipon = {',
    `  window.__testMountAccount = async (profile) => {
    currentProfile = profile;
    ensureClient();
    bindAccountDialog();
    await loadAccountDialog();
  };
  window.__testToasts = [];
  window.Ipon = {`
  ).replace(
    '  function toast(message, tone = \'success\') {',
    '  function toast(message, tone = \'success\') { toastsPush(message, tone);'
  );
  ctx.toastsPush = (m, t) => toasts.push({ m, t });

  vm.runInNewContext(patchedCore, ctx, { filename: 'js/core.js', timeout: 5000 });
  await ctx.window.__testMountAccount({ ...superAdmin });

  assert.equal(saveBtn.disabled, true, 'Profile Save button starts disabled until a field changes');

  // Invalid handle locks Save and renders inline error
  usernameInput.value = 'ab';
  await usernameInput._emit('input');
  await profileForm._emit('input');
  assert.equal(usernameError.hidden, false);
  assert.match(usernameError.textContent, /3–24 lowercase/);
  assert.equal(usernameHelp.hidden, true);
  assert.equal(saveBtn.disabled, true);

  // Submitting a colliding handle catches 23505 inline under #quick-username & locks Save
  usernameInput.value = 'taken_handle';
  await usernameInput._emit('input');
  await profileForm._emit('input');
  await profileForm._emit('submit');
  assert.equal(usernameError.hidden, false);
  assert.equal(usernameError.textContent, 'That username is already taken.');
  assert.equal(saveBtn.disabled, true);

  // Bio over 58 chars shows inline error and locks Save; <= 58 chars unlocks Save & updates counter
  bioInput.value = 'A'.repeat(59);
  await bioInput._emit('input');
  await profileForm._emit('input');
  assert.equal(bioCounter.textContent, '59 / 58 characters');
  assert.equal(bioError.hidden, false);
  assert.match(bioError.textContent, /58 characters/);
  assert.equal(saveBtn.disabled, true);

  // Typing available handle + bio updates counter and Super Admin saves cleanly via update_own_social_identity
  usernameInput.value = 'zedrick_owner';
  await usernameInput._emit('input');
  bioInput.value = 'Building My Ipon Group';
  await bioInput._emit('input');
  await profileForm._emit('input');
  assert.equal(bioCounter.textContent, '22 / 58 characters');
  assert.equal(saveBtn.disabled, false);

  await profileForm._emit('submit');
  const socialSave = rpcCalls.find((c) => c.name === 'update_own_social_identity' && c.args.p_username === 'zedrick_owner');
  assert.ok(socialSave, 'Expected update_own_social_identity RPC call');
  assert.equal(socialSave.args.p_bio, 'Building My Ipon Group');
  assert.equal(ctx.window.Ipon.profile.username, 'zedrick_owner');
  assert.equal(ctx.window.Ipon.profile.bio, 'Building My Ipon Group');
  assert.ok(toasts.some((x) => x.m === 'Profile updated.'));
});
