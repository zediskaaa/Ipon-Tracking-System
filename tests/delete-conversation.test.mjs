import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Migration 182 and schema.sql extend update_conversation_member_state with delete_for_everyone, media purge, notification cleanup, and group role guard', () => {
  const mig = read('database/migrations/20261123_182_delete_conversation_for_everyone.sql');
  const schema = read('database/schema.sql');

  for (const sql of [mig, schema]) {
    assert.match(sql, /'20261123_182'/);
    assert.match(sql, /elsif v_act = 'delete_for_everyone' then/i);
    assert.match(sql, /Only group owners or admins can delete a group conversation for everyone\./i);
    assert.match(sql, /insert into public\.pending_storage_deletions \(bucket_id, object_path\)/i);
    assert.match(sql, /delete from public\.messages where conversation_id = v_conv\.id;/i);
    assert.match(sql, /set deleted_before_at = v_now,\s*hidden_at = v_now,[\s\S]*?where conversation_id = v_conv\.id;/i);
    assert.match(sql, /'removed_paths',\s*coalesce\(v_own_paths,\s*'\[\\?\]'::jsonb\)/i);
  }
});

test('css/app.css defines premium Delete conversation modal and full-width drawer danger styling in light and dark mode', () => {
  const css = read('css/app.css');
  assert.match(css, /\.msg-drawer-actions \.msg-drawer-action-btn\.is-danger\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
  assert.match(css, /dialog\.msg-delete-conv-modal\s*\{/);
  assert.match(css, /\.msg-delete-conv-option\[aria-checked="true"\]\s*\{/);
  assert.match(css, /\.msg-delete-conv-option\.is-everyone\[aria-checked="true"\]\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.msg-delete-conv-option/);
});

test('Delete conversation modal offers for you vs for everyone, deletes for both participants, cleans media, and closes peer thread on realtime hide', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const peerId = '22222222-2222-4222-8222-222222222222';
  const convId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const groupId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const els = new Map();
  const makeEl = (tag = 'div', id = '') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    let _html = '';
    const el = {
      id,
      tagName: String(tag).toUpperCase(),
      dataset: {},
      style: {},
      value: '',
      hidden: false,
      disabled: false,
      open: false,
      textContent: '',
      get innerHTML() { return _html; },
      set innerHTML(v) {
        _html = String(v ?? '');
        this.textContent = _html.replace(/<[^>]+>/g, '');
      },
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        toggle: (n, force) => (force === undefined ? (classes.has(n) ? (classes.delete(n), false) : (classes.add(n), true)) : (force ? (classes.add(n), true) : (classes.delete(n), false))),
        contains: (n) => classes.has(n)
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener() { },
      showModal() { el.open = true; },
      close() { el.open = false; },
      focus() { },
      remove() { },
      closest() { return null; },
      querySelector(sel) {
        const idMatch = sel.match(/#([a-z0-9_-]+)/i);
        if (idMatch) return getEl(idMatch[1]);
        return null;
      },
      querySelectorAll() { return []; },
      appendChild(child) { return child; },
      insertAdjacentHTML(_pos, html) {
        for (const m of String(html || '').matchAll(/\bid="([^"]+)"/g)) {
          getEl(m[1]);
        }
      }
    };
    if (id) els.set(id, el);
    return el;
  };
  const getEl = (id) => els.get(id) || makeEl('div', id);

  const docListeners = new Map();
  const tableHandlers = new Map();
  const rpcCalls = [];
  const fnCalls = [];
  const toasts = [];
  let convList = [
    {
      id: convId,
      kind: 'DIRECT',
      status: 'ACCEPTED',
      peer: { id: peerId, full_name: 'Maria Santos', username: 'maria', allow_online_status: true },
      unread_count: 0,
      last_message_at: '2026-11-23T00:10:00Z',
      last_message_preview: 'See you tomorrow!'
    },
    {
      id: groupId,
      kind: 'GROUP',
      title: 'Team Savings',
      my_role: 'MEMBER',
      status: 'ACCEPTED',
      member_count: 3,
      unread_count: 0,
      last_message_at: '2026-11-23T00:05:00Z',
      last_message_preview: 'Hello group'
    }
  ];

  const ctx = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Date,
    RegExp,
    JSON,
    setTimeout: () => 1,
    clearTimeout() { },
    setInterval: () => 1,
    clearInterval() { },
    URL,
    URLSearchParams,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    cancelAnimationFrame() { },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    navigator: { userAgent: 'Chrome', onLine: true },
    location: { href: 'https://my-ipon.vercel.app/dashboard.html', origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '' },
    document: {
      visibilityState: 'visible',
      documentElement: { dataset: {} },
      body: makeEl('body'),
      hasFocus: () => true,
      getElementById: (id) => getEl(id),
      querySelector: (sel) => {
        const idMatch = sel.match(/#([a-z0-9_-]+)/i);
        if (idMatch) return getEl(idMatch[1]);
        return null;
      },
      querySelectorAll: () => [],
      createElement: (tag) => makeEl(tag),
      addEventListener(type, fn) {
        if (!docListeners.has(type)) docListeners.set(type, []);
        docListeners.get(type).push(fn);
      },
      removeEventListener() { }
    },
    Ipon: {
      profile: { id: meId, full_name: 'Juan Dela Cruz', role: 'MEMBER', status: 'ACTIVE', chat_privacy: {} },
      escapeHtml: (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      initials: (s) => String(s || 'U').slice(0, 2).toUpperCase(),
      isUserOnline: () => false,
      formatLastSeen: () => '',
      dateLabel: (d) => String(d || ''),
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      fitVerifiedNameLines() { },
      verifiedBadgesHtml: () => '',
      renderSocialAppLinksHtml: () => '',
      refreshUnreadMessageCount: async () => 0,
      playUiSound() { },
      toast: (msg, tone) => toasts.push({ msg, tone }),
      friendlyError: (e) => String(e?.message || e),
      rpc: async (name, params = {}) => {
        rpcCalls.push({ name, params });
        if (name === 'get_conversations') return convList;
        if (name === 'get_social_overview') {
          return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        }
        if (name === 'get_conversation_messages') {
          const cid = params.p_conversation_id;
          if (cid === groupId) {
            return {
              conversation: {
                id: groupId,
                conversation_id: groupId,
                kind: 'GROUP',
                title: 'Team Savings',
                my_role: 'MEMBER',
                status: 'ACCEPTED',
                members: [{ user_id: meId, full_name: 'Juan Dela Cruz', role: 'MEMBER' }]
              },
              messages: [{ id: 'm-g1', conversation_id: groupId, sender_id: meId, body: 'Hi', created_at: '2026-11-23T00:05:00Z' }]
            };
          }
          return {
            conversation: {
              id: peerId,
              conversation_id: convId,
              kind: 'DIRECT',
              full_name: 'Maria Santos',
              username: 'maria',
              status: 'ACCEPTED',
              friendship_status: 'FRIENDS'
            },
            messages: [{ id: 'm-1', conversation_id: convId, sender_id: meId, body: 'See you tomorrow!', created_at: '2026-11-23T00:10:00Z' }]
          };
        }
        if (name === 'update_conversation_member_state') {
          if (params.p_action === 'delete_for_everyone' || params.p_action === 'delete_for_me') {
            convList = convList.filter((c) => c.id !== params.p_conversation_id);
          }
          return {
            ok: true,
            conversation_id: params.p_conversation_id,
            action: params.p_action,
            removed_paths: params.p_action === 'delete_for_everyone' ? [`${convId}/${meId}/r2/photo.webp`] : []
          };
        }
        return {};
      },
      invokeAccountFunction: async (payload) => {
        fnCalls.push(payload);
        return { removed: 1 };
      },
      client: {
        from: () => ({ select: () => ({ like: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        channel: () => ({
          on(kind, filter, cb) {
            if (kind === 'postgres_changes' && filter?.table) tableHandlers.set(filter.table, cb);
            return this;
          },
          subscribe() { return this; },
          send: async () => 'ok'
        }),
        removeChannel: async () => {}
      }
    }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.addEventListener = () => {};
  ctx.removeEventListener = () => {};

  vm.runInNewContext(messagesJs, ctx, { filename: 'js/messages.js' });
  await ctx.window.IponMessages.init(ctx.Ipon.profile);

  // Open workspace, direct chat & render drawer
  getEl('msg-workspace-dialog').open = true;
  const openBtn = makeEl('button');
  openBtn.dataset = { openConv: convId };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-open-conv]' ? openBtn : null) }
  })));
  const infoBtn = getEl('msg-thread-info-toggle');
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '#msg-thread-info-toggle' ? infoBtn : null) }
  })));

  // 1. Drawer shows "Delete conversation" (not "Delete for me")
  const drawerHtml = getEl('msg-thread-drawer').innerHTML;
  assert.match(drawerHtml, /data-conv-act="delete_conversation"[^>]*>[\s\S]*Delete conversation/);
  assert.doesNotMatch(drawerHtml, /<span>Delete for me<\/span>/);

  // 2. Clicking "Delete conversation" opens choice modal with both "Delete for you" & "Delete for everyone"
  const delConvBtn = makeEl('button');
  delConvBtn.dataset = { convAct: 'delete_conversation' };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-conv-act]' ? delConvBtn : null) }
  })));

  const delDlg = getEl('msg-delete-conv-dialog');
  const delBody = getEl('msg-delete-conv-body');
  assert.equal(delDlg.open, true, 'Delete conversation modal must open');
  assert.match(delBody.innerHTML, /data-delete-conv-scope="delete_for_me"/);
  assert.match(delBody.innerHTML, /data-delete-conv-scope="delete_for_everyone"/);
  assert.match(delBody.innerHTML, /Delete for you/);
  assert.match(delBody.innerHTML, /Delete for everyone/);

  // 3. Selecting "Delete for everyone" and confirming invokes delete_for_everyone + media cleanup + closes modal
  const everyoneOpt = makeEl('button');
  everyoneOpt.dataset = { deleteConvScope: 'delete_for_everyone' };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-delete-conv-scope]' ? everyoneOpt : null) }
  })));
  assert.match(delBody.innerHTML, /data-delete-conv-scope="delete_for_everyone"[^>]*aria-checked="true"/);

  const confirmBtn = makeEl('button');
  confirmBtn.dataset = { deleteConvConfirm: '1' };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-delete-conv-confirm]' ? confirmBtn : null) }
  })));

  const delRpc = rpcCalls.find((c) => c.name === 'update_conversation_member_state' && c.params.p_action === 'delete_for_everyone');
  assert.ok(delRpc, 'Must call update_conversation_member_state with delete_for_everyone');
  assert.equal(delRpc.params.p_conversation_id, convId);
  assert.equal(delDlg.open, false, 'Modal must close after successful deletion');
  assert.ok(fnCalls.some((f) => f.action === 'chat-cleanup-media' && f.paths.includes(`${convId}/${meId}/r2/photo.webp`)), 'Must clean up own media paths');
  assert.ok(toasts.some((t) => /deleted for everyone/i.test(t.msg)));

  // 4. Non-admin member in a group chat sees ONLY "Delete for you" (cannot delete group chat for everyone)
  const openGrpBtn = makeEl('button');
  openGrpBtn.dataset = { openConv: groupId };
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-open-conv]' ? openGrpBtn : null) }
  })));
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-conv-act]' ? delConvBtn : null) }
  })));
  assert.equal(delDlg.open, true);
  assert.match(delBody.innerHTML, /data-delete-conv-scope="delete_for_me"/);
  assert.doesNotMatch(delBody.innerHTML, /data-delete-conv-scope="delete_for_everyone"/);

  // Close modal
  const closeBtn = makeEl('button');
  await Promise.all((docListeners.get('click') || []).map((fn) => fn({
    target: { closest: (sel) => (sel === '[data-delete-conv-close]' ? closeBtn : null) }
  })));
  assert.equal(delDlg.open, false);

  // 5. Realtime conversation_participants UPDATE with hidden_at closes the peer's active thread immediately
  const cpHandler = tableHandlers.get('conversation_participants');
  assert.equal(typeof cpHandler, 'function', 'Must subscribe to conversation_participants realtime updates');
  getEl('msg-thread-active').hidden = false;
  getEl('msg-thread-empty').hidden = true;
  cpHandler({
    eventType: 'UPDATE',
    new: { conversation_id: groupId, user_id: meId, hidden_at: '2026-11-23T00:12:00Z', deleted_before_at: '2026-11-23T00:12:00Z' }
  });
  assert.equal(getEl('msg-thread-active').hidden, true, 'Active thread must immediately close when partner deletes conversation for everyone');
  assert.equal(getEl('msg-thread-empty').hidden, false, 'Empty inbox pane must show after peer deletes conversation for everyone');
});
