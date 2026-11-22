import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('anonymous sessions serialize sends with shutdown and delete session records for both people', () => {
  const migration = read('database/migrations/20261122_165_anonymous_chat.sql');
  const schema = read('database/schema.sql');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')), 'Schema baseline must include the migration');
  assert.match(migration, /where id = new\.conversation_id for share/);
  assert.match(migration, /where id = p_conversation_id for update/);
  assert.match(migration, /delete from public\.messages\s+where conversation_id = v_conv\.id and anonymous_session_id = v_conv\.anonymous_session_id/);
  assert.match(migration, /delete from public\.notifications n using public\.messages m/);
  assert.match(migration, /new\.actor_id := null/);
  assert.match(migration, /get_conversation_messages_unmasked/);
  assert.match(migration, /search_conversation_messages_unmasked/);
});

test('anonymous identity and theme are shared across chat and preview surfaces', () => {
  const messages = read('js/messages.js');
  const css = read('css/app.css');
  const avatar = read('assets/anonymous-avatar.svg');
  assert.match(messages, /set_anonymous_chat/);
  assert.match(messages, /End anonymous mode\?/);
  assert.match(messages, /conv\.anonymous_enabled \? 'anonymous'/);
  assert.match(messages, /assets\/anonymous-avatar\.svg/);
  assert.match(messages, /conv\.anonymous_enabled \? '' : userBadgesHtml\(conv\)/);
  assert.match(css, /data-chat-theme="anonymous"/);
  assert.match(avatar, /<svg[\s\S]*Anonymous profile/);
});

test('anonymous activation notices are removed and no longer expose names', () => {
  const migration = read('database/migrations/20261122_167_remove_anonymous_chat_notice.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /drop trigger if exists conversations_announce_anonymous_enabled/);
  assert.match(migration, /delete from public\.messages[\s\S]*metadata ->> 'event' = 'anonymous_enabled'/);
  assert.doesNotMatch(messages, /turned on anonymous chat/);
  assert.match(messages, /Hide names and DPs for \$\{isGrp/);
});

test('anonymous system notices, chat previews, and linked alerts hide real names', () => {
  const migration = read('database/migrations/20261122_168_anonymous_notice_privacy.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  const core = read('js/core.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /new\.message_type in \('SYSTEM', 'CALL_EVENT'\)[\s\S]*new\.body := 'Conversation update'/);
  assert.match(migration, /'\{last_message_preview\}'[\s\S]*'SYSTEM', 'CALL_EVENT'/);
  assert.match(migration, /'body', case when m ->> 'message_type' in \('SYSTEM', 'CALL_EVENT'\)/);
  assert.match(migration, /create trigger conversations_mask_anonymous_notifications/);
  assert.match(migration, /update public\.notifications n[\s\S]*c\.anonymous_session_id is not null/);
  assert.match(messages, /if \(conv\.anonymous_enabled\) \{\s*return `\$\{dateDivider\}\$\{unreadDivider\}<div class="msg-system-event\$\{enterCls\}"/);
  assert.match(messages, /const safeLastPreview = conv\.anonymous_enabled/);
  assert.doesNotMatch(messages, /id="msg-alerts-btn"|id="msg-view-alerts"/);
  assert.match(core, /anonymousChatNotice[\s\S]*assets\/anonymous-avatar\.svg/);
});

test('anonymous vanishing-message previews never include the sender name', () => {
  const migration = read('database/migrations/20261122_169_anonymous_vanishing_preview.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /last_message_preview' ~ ' set a message\\\.\$'/);
  assert.match(migration, /to_jsonb\('Vanishing message'::text\)/);
  assert.match(messages, /conv\.anonymous_enabled && \/ set a message\\\.\$\/\.test/);
});

test('group anonymous mode uses admin permission and masks member identities', () => {
  const migration = read('database/migrations/20261122_170_anonymous_group_chats.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /v_conv\.kind not in \('DIRECT', 'GROUP'\)/);
  assert.match(migration, /role in \('OWNER', 'ADMIN'\)/);
  assert.match(migration, /delete from public\.messages\s+where conversation_id = v_conv\.id and anonymous_session_id = v_conv\.anonymous_session_id/);
  assert.ok(migration.includes("jsonb_set(item, '{members_preview}', '[]'::jsonb)"));
  assert.match(migration, /'members', '\[\]'::jsonb/);
  assert.match(migration, /'seen_by', '\[\]'::jsonb/);
  assert.match(messages, /if \(conv\.anonymous_enabled\) return userAvatarHtml\(\{ anonymous_enabled: true \}/);
  assert.match(messages, /const membersSectionHtml = isGrp && !conv\.anonymous_enabled/);
  assert.match(messages, /conv\.anonymous_enabled \? 'You' : \(initializedProfile\?\.full_name/);
});

test('anonymous mode preserves null reply_preview without rendering ghost User Attachment quotes', () => {
  const migration = read('database/migrations/20261122_172_fix_anonymous_null_reply_preview.sql');
  const schema = read('database/schema.sql');
  const messages = read('js/messages.js');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.match(migration, /'reply_preview', case when jsonb_typeof\(m -> 'reply_preview'\) = 'object' then/);
  assert.doesNotMatch(migration, /m -> 'reply_preview' is not null/);
  assert.match(messages, /const hasReplyPreview = Boolean\(m\.reply_preview && typeof m\.reply_preview === 'object' && !Array\.isArray\(m\.reply_preview\) && m\.reply_preview\.id\);/);
});

test('anonymous group chat seen receipts expose privacy-safe hashed reader keys and blurred count styling', () => {
  const migration = read('database/migrations/20261122_179_anonymous_gc_seen_count.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(migration.trim().replace(/\r\n/g, '\n')), 'Schema baseline must include Migration 179');
  assert.match(migration, /'seen_by', '\[\]'::jsonb/);
  assert.match(migration, /'seen_count', case/);
  assert.match(migration, /'anon_seen_keys', case/);
  assert.match(migration, /md5\(v_session_id::text \|\| ':' \|\|/);
  assert.match(css, /\.msg-seen-dp-coin\.is-anon-count \.msg-seen-dp-img\s*\{[^}]*filter:\s*blur\(/s);
  assert.match(css, /\.msg-seen-dp-anon-count\s*\{[^}]*font-variant-numeric:\s*tabular-nums;/s);
  assert.match(css, /\.msg-seen-dp-coin\.is-anon-count-wide \.msg-seen-dp-anon-count\s*\{/);
  assert.match(css, /@keyframes msgSeenAnonBump\s*\{/);
  const mig180 = read('database/migrations/20261122_180_fix_group_receipts_and_creator_eligibility.sql');
  assert.ok(schema.replace(/\r\n/g, '\n').includes(mig180.trim().replace(/\r\n/g, '\n')), 'Schema baseline must include Migration 180');
  assert.match(mig180, /create or replace function public\.mark_conversation_read\(p_conversation_id uuid\)/);
  assert.match(mig180, /insert into public\.message_receipts[\s\S]*on conflict \(message_id, user_id\) do update/);
});

test('anonymous group chat renders 1 crisp anonymous DP first, then blurs DP with exact seen count (2, 3, 4...) live without leaking identities', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const convId = '33333333-3333-4333-8333-333333333333';
  const msg1Id = '44444444-4444-4444-8444-444444444441';
  const msg2Id = '44444444-4444-4444-8444-444444444442';
  const memberA = 'aaaa1111-1111-4111-8111-111111111111';
  const memberB = 'bbbb2222-2222-4222-8222-222222222222';
  const memberC = 'cccc3333-3333-4333-8333-333333333333';
  const memberD = 'dddd4444-4444-4444-8444-444444444444';

  const makeEl = (id = '') => {
    const cls = new Set();
    const attrs = new Map();
    let html = '';
    return {
      id,
      open: false,
      hidden: false,
      disabled: false,
      value: '',
      scrollTop: 0,
      scrollHeight: 200,
      clientHeight: 200,
      dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (x, f) => (f === undefined ? (cls.has(x) ? cls.delete(x) : cls.add(x)) : (f ? cls.add(x) : cls.delete(x))),
        contains: (x) => cls.has(x),
        replace: (a, b) => { cls.delete(a); cls.add(b); }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      addEventListener() { },
      removeEventListener() { },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() { },
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      insertAdjacentHTML() { },
      get innerHTML() { return html; },
      set innerHTML(v) { html = String(v || ''); },
      get textContent() { return html; },
      set textContent(v) { html = String(v || ''); }
    };
  };

  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const listEl = getEl('msg-messages-list');

  const extractBalancedTick = (fragment) => {
    const startIdx = fragment.indexOf('<span class="msg-tick');
    if (startIdx < 0) return '';
    const sub = fragment.slice(startIdx);
    let depth = 0;
    const tagRe = /<\/?span\b[^>]*>/g;
    let tok;
    while ((tok = tagRe.exec(sub)) !== null) {
      if (tok[0].startsWith('</')) depth -= 1;
      else depth += 1;
      if (depth === 0) return sub.slice(0, tok.index + tok[0].length);
    }
    return sub;
  };

  const rowTicks = new Map();
  const setRowTick = (msgId, tickHtml) => {
    const html = String(tickHtml || '');
    const openM = html.match(/^<span class="(msg-tick[^"]*)"([^>]*)>/);
    const clsSet = new Set((openM?.[1] || '').split(/\s+/).filter(Boolean));
    const attrs = new Map();
    for (const attr of ['title', 'aria-label', 'data-seen-keys']) {
      const m = openM?.[2]?.match(new RegExp(`${attr}="([^"]*)"`));
      if (m) attrs.set(attr, m[1]);
    }
    const entry = {
      html,
      attrs,
      node: html ? {
        classList: { contains: (c) => clsSet.has(c) },
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        setAttribute: (k, v) => attrs.set(k, String(v)),
        remove: () => setRowTick(msgId, ''),
        set outerHTML(next) { setRowTick(msgId, next); },
        get outerHTML() { return rowTicks.get(msgId)?.html || ''; }
      } : null
    };
    rowTicks.set(msgId, entry);
  };

  const origDesc = Object.getOwnPropertyDescriptor(listEl, 'innerHTML');
  Object.defineProperty(listEl, 'innerHTML', {
    get() { return origDesc.get.call(this); },
    set(v) {
      const s = String(v || '');
      origDesc.set.call(this, s);
      rowTicks.clear();
      const rowRe = /<article class="msg-row[^"]*"[^>]*data-msg-id="([^"]+)"/g;
      const matches = [...s.matchAll(rowRe)];
      for (let i = 0; i < matches.length; i += 1) {
        const mId = matches[i][1];
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        setRowTick(mId, extractBalancedTick(s.slice(start, end)));
      }
    }
  });

  listEl.querySelector = (sel) => {
    for (const [mId] of rowTicks.entries()) {
      if (sel.includes(mId)) {
        return {
          querySelector: (s2) => (s2 === '.msg-bubble-meta'
            ? {
                querySelector: (s3) => (s3 === '.msg-tick' ? rowTicks.get(mId)?.node || null : null),
                insertAdjacentHTML: (_pos, h) => setRowTick(mId, h)
              }
            : null)
        };
      }
    }
    return null;
  };

  const tableHandlers = new Map();
  const anonGroupConv = {
    id: convId,
    conversation_id: convId,
    kind: 'GROUP',
    title: 'Secret Circle',
    status: 'ACCEPTED',
    chat_theme: 'anonymous',
    receipts_enabled: true,
    anonymous_enabled: true,
    members: []
  };

  let activeMsgsPayload = [
    {
      id: msg1Id,
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'Hello anonymous GC',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:00:00Z',
      delivered_at: '2026-11-22T12:00:01Z',
      read_at: null,
      seen_by: [],
      seen_count: 0,
      anon_seen_keys: [],
      attachments: [],
      reactions: []
    }
  ];

  const fakeChannel = {
    on(_type, filter, fn) {
      if (filter?.table) tableHandlers.set(filter.table, fn);
      return fakeChannel;
    },
    subscribe() { return fakeChannel; }
  };

  const win = {
    Ipon: {
      client: {
        channel: () => fakeChannel,
        removeChannel: () => Promise.resolve(),
        from: () => {
          const q = {
            select: () => q, eq: () => q, in: () => q, like: () => q, or: () => q, order: () => q,
            limit: async () => ({ data: [], error: null }),
            then: (res) => Promise.resolve({ data: [], error: null }).then(res)
          };
          return q;
        }
      },
      rpc: async (name) => {
        if (name === 'get_conversations') return [anonGroupConv];
        if (name === 'get_conversation_messages') {
          return {
            conversation: anonGroupConv,
            messages: activeMsgsPayload.map((m) => ({ ...m })),
            pinned_messages: [],
            has_older: false,
            anonymous_enabled: true
          };
        }
        if (name === 'get_social_overview') return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        if (name === 'mark_conversation_read') return { read_at: '2026-11-22T12:00:02Z', receipts_shared: true };
        return [];
      },
      primeUiSound: () => true,
      playUiSound: () => true,
      escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      initials: (name) => String(name || 'U').slice(0, 1).toUpperCase(),
      avatarMarkup: () => '<span>AV</span>',
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      syncMessagesBadges() { },
      isUserOnline: () => false,
      friendlyError: (e) => e?.message || 'Error',
      toast() { },
      verifiedBadgesHtml: () => '',
      fitVerifiedNameLines() { },
      registerVerifiedBadges() { },
      registerMemberAvatars() { },
      getClientPlatform: () => 'web',
      supportsNativeScreenshotProtection: () => false
    },
    addEventListener() { },
    removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    location: { origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '' },
    navigator: { userAgent: 'test' },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } }
  };
  win.window = win;

  const doc = {
    visibilityState: 'visible',
    body: makeEl('body'),
    documentElement: makeEl('html'),
    getElementById: getEl,
    querySelector: (sel) => (sel.startsWith('#') && !sel.includes(' ') ? getEl(sel.slice(1)) : null),
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener() { },
    removeEventListener() { }
  };

  const timers = [];
  const sandbox = {
    window: win,
    document: doc,
    location: win.location,
    navigator: win.navigator,
    localStorage: win.localStorage,
    sessionStorage: win.sessionStorage,
    CSS: { escape: (s) => String(s) },
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() { } },
    URLSearchParams,
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    setInterval: () => 0,
    clearInterval() { },
    console
  };
  vm.runInNewContext(messagesJs, sandbox);

  await win.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', chat_privacy: { show_online: true } });
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });

  // 1st member sees the message live -> 1 crisp unblurred anonymous DP (no number overlay)
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msg1Id, user_id: memberA, delivered_at: '2026-11-22T12:00:01Z', read_at: '2026-11-22T12:00:05Z' }
  });
  let tick1 = rowTicks.get(msg1Id);
  assert.match(tick1.html, /src="assets\/anonymous-avatar\.svg"/);
  assert.doesNotMatch(tick1.html, /is-anon-count|msg-seen-dp-anon-count|msg-seen-dp-more|is-multi/);
  assert.equal((tick1.html.match(/msg-seen-dp-coin/g) || []).length, 1);
  assert.equal(tick1.attrs.get('title'), 'Seen');
  assert.doesNotMatch(tick1.html, new RegExp(memberA), 'Must never leak raw reader UUID in DOM');

  // Duplicate receipt from same 1st member must NOT increment to blurred count
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msg1Id, user_id: memberA, delivered_at: '2026-11-22T12:00:01Z', read_at: '2026-11-22T12:00:06Z' }
  });
  tick1 = rowTicks.get(msg1Id);
  assert.doesNotMatch(tick1.html, /is-anon-count|msg-seen-dp-anon-count/);

  // 2nd member sees the message -> single blurred anonymous DP with visible "2" centered on top
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msg1Id, user_id: memberB, delivered_at: '2026-11-22T12:00:01Z', read_at: '2026-11-22T12:00:08Z' }
  });
  tick1 = rowTicks.get(msg1Id);
  assert.equal((tick1.html.match(/msg-seen-dp-coin/g) || []).length, 1, 'Must stay a single collapsed anonymous DP');
  assert.match(tick1.html, /class="msg-seen-dp-coin is-anon-count is-anon-bump"/);
  assert.match(tick1.html, /data-anon-seen-count="2"/);
  assert.match(tick1.html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">2<\/span>/);
  assert.doesNotMatch(tick1.html, /msg-seen-dp-more|is-multi/);
  assert.equal(tick1.attrs.get('title'), 'Seen by 2');
  assert.equal(tick1.attrs.get('aria-label'), 'Seen by 2');
  assert.doesNotMatch(tick1.html, new RegExp(`${memberA}|${memberB}`));

  // 3rd and 4th members see the message -> overlaid number increments 3, then 4
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msg1Id, user_id: memberC, delivered_at: '2026-11-22T12:00:01Z', read_at: '2026-11-22T12:00:10Z' }
  });
  tick1 = rowTicks.get(msg1Id);
  assert.match(tick1.html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">3<\/span>/);
  assert.equal(tick1.attrs.get('title'), 'Seen by 3');

  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msg1Id, user_id: memberD, delivered_at: '2026-11-22T12:00:01Z', read_at: '2026-11-22T12:00:12Z' }
  });
  tick1 = rowTicks.get(msg1Id);
  assert.match(tick1.html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">4<\/span>/);
  assert.equal(tick1.attrs.get('title'), 'Seen by 4');

  // Flush any previously queued debounce timers from the initial realtime receipts before testing server-keyed progression
  for (const t of timers.splice(0)) {
    if (!t.cleared) {
      t.cleared = true;
      await t.fn();
    }
  }

  // Multi-message progression with server-hashed anon_seen_keys + 2-digit wide class check
  activeMsgsPayload = [
    {
      id: msg1Id,
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'Earlier anonymous message',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:00:00Z',
      delivered_at: '2026-11-22T12:00:01Z',
      read_at: '2026-11-22T12:00:05Z',
      seen_by: [],
      seen_count: 3,
      anon_seen_keys: ['anon_h1', 'anon_h2', 'anon_h3'],
      attachments: [],
      reactions: []
    },
    {
      id: msg2Id,
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'Latest anonymous message',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:01:00Z',
      delivered_at: '2026-11-22T12:01:01Z',
      read_at: '2026-11-22T12:01:05Z',
      seen_by: [],
      seen_count: 1,
      anon_seen_keys: ['anon_h1'],
      attachments: [],
      reactions: []
    }
  ];
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  // Msg 1 still has 2 readers (anon_h2, anon_h3) -> blurred DP with "2"; Msg 2 has 1 reader (anon_h1) -> crisp DP
  const m1Tick = rowTicks.get(msg1Id);
  const m2Tick = rowTicks.get(msg2Id);
  assert.match(m1Tick.html, /is-anon-count/);
  assert.match(m1Tick.html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">2<\/span>/);
  assert.equal(m1Tick.attrs.get('title'), 'Seen by 2');
  assert.match(m2Tick.html, /src="assets\/anonymous-avatar\.svg"/);
  assert.doesNotMatch(m2Tick.html, /is-anon-count|msg-seen-dp-anon-count/);
  assert.equal(m2Tick.attrs.get('title'), 'Seen');

  // Realtime receipt on server-keyed Msg 2 triggers immediate background sync and patches both rows in-place
  timers.length = 0;
  activeMsgsPayload = [
    activeMsgsPayload[0],
    {
      ...activeMsgsPayload[1],
      seen_count: 2,
      anon_seen_keys: ['anon_h1', 'anon_h2']
    }
  ];
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msg2Id, user_id: memberB, delivered_at: '2026-11-22T12:01:01Z', read_at: '2026-11-22T12:01:09Z' }
  });
  const pendingRefreshTimers = timers.filter((t) => !t.cleared);
  assert.ok(pendingRefreshTimers.length > 0, 'Anonymous GC receipt update must schedule immediate server sync');
  for (const t of pendingRefreshTimers) {
    t.cleared = true;
    await t.fn();
  }
  const m1After = rowTicks.get(msg1Id);
  const m2After = rowTicks.get(msg2Id);
  assert.match(m1After.html, /src="assets\/anonymous-avatar\.svg"/);
  assert.doesNotMatch(m1After.html, /is-anon-count|msg-seen-dp-anon-count/, 'Msg 1 drops back to 1 crisp anonymous DP once 2nd reader advances to Msg 2');
  assert.equal(m1After.attrs.get('title'), 'Seen');
  assert.match(m2After.html, /is-anon-count is-anon-bump/);
  assert.match(m2After.html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">2<\/span>/);
  assert.equal(m2After.attrs.get('title'), 'Seen by 2');

  // 12 readers on Msg 2 -> shows "12" with is-anon-count-wide for tight fit
  activeMsgsPayload = [
    {
      ...activeMsgsPayload[1],
      seen_count: 12,
      anon_seen_keys: Array.from({ length: 12 }, (_, i) => `anon_k${i + 1}`)
    }
  ];
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  const wideTick = rowTicks.get(msg2Id);
  assert.match(wideTick.html, /is-anon-count is-anon-count-wide/);
  assert.match(wideTick.html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">12<\/span>/);
  assert.equal(wideTick.attrs.get('title'), 'Seen by 12');

  // Consecutive outgoing messages sent >2 minutes apart on the same day must NOT repeat "You"
  activeMsgsPayload = [
    {
      id: '44444444-4444-4444-8444-444444444451',
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'oh',
      message_type: 'TEXT',
      created_at: '2026-11-22T10:02:00Z',
      delivered_at: '2026-11-22T10:02:01Z',
      read_at: null,
      seen_by: [],
      attachments: [],
      reactions: []
    },
    {
      id: '44444444-4444-4444-8444-444444444452',
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'heyyy',
      message_type: 'TEXT',
      created_at: '2026-11-22T10:18:00Z',
      delivered_at: '2026-11-22T10:18:01Z',
      read_at: null,
      seen_by: [],
      attachments: [],
      reactions: []
    },
    {
      id: '44444444-4444-4444-8444-444444444453',
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'fggf',
      message_type: 'TEXT',
      created_at: '2026-11-22T10:34:00Z',
      delivered_at: '2026-11-22T10:34:01Z',
      read_at: null,
      seen_by: [],
      attachments: [],
      reactions: []
    },
    {
      id: '44444444-4444-4444-8444-444444444454',
      conversation_id: convId,
      sender_id: memberA,
      sender_name: 'Anonymous',
      body: 'hi there',
      message_type: 'TEXT',
      created_at: '2026-11-22T10:35:00Z',
      delivered_at: null,
      read_at: null,
      seen_by: [],
      attachments: [],
      reactions: []
    },
    {
      id: '44444444-4444-4444-8444-444444444455',
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Anonymous',
      body: 'reply after peer',
      message_type: 'TEXT',
      created_at: '2026-11-22T10:36:00Z',
      delivered_at: '2026-11-22T10:36:01Z',
      read_at: null,
      seen_by: [],
      attachments: [],
      reactions: []
    }
  ];
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  const youLabels = listEl.innerHTML.match(/<span class="msg-sender-name is-mine">You<\/span>/g) || [];
  assert.equal(youLabels.length, 2, 'Expected "You" once for the initial 3-message run (6:02/6:18/6:34) and once again after peer reply');

  // Consecutive messages from the SAME anonymous peer across >2 minute gaps show ONE "Anonymous" label at top and ONE DP at bottom,
  // then show a fresh "Anonymous" label + DP when a DIFFERENT anonymous peer replies
  activeMsgsPayload = [
    { id: '44444444-4444-4444-8444-444444444471', conversation_id: convId, sender_id: memberA, sender_name: 'Anonymous', body: 'oh', message_type: 'TEXT', created_at: '2026-11-22T10:02:00Z', delivered_at: null, read_at: null, seen_by: [], attachments: [], reactions: [] },
    { id: '44444444-4444-4444-8444-444444444472', conversation_id: convId, sender_id: memberA, sender_name: 'Anonymous', body: 'heyyy', message_type: 'TEXT', created_at: '2026-11-22T10:18:00Z', delivered_at: null, read_at: null, seen_by: [], attachments: [], reactions: [] },
    { id: '44444444-4444-4444-8444-444444444473', conversation_id: convId, sender_id: memberA, sender_name: 'Anonymous', body: 'dfsf', message_type: 'TEXT', created_at: '2026-11-22T10:34:00Z', delivered_at: null, read_at: null, seen_by: [], attachments: [], reactions: [] },
    { id: '44444444-4444-4444-8444-444444444474', conversation_id: convId, sender_id: memberB, sender_name: 'Anonymous', body: 'another speaker', message_type: 'TEXT', created_at: '2026-11-22T10:35:00Z', delivered_at: null, read_at: null, seen_by: [], attachments: [], reactions: [] }
  ];
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });
  const anonLabels = listEl.innerHTML.match(/<span class="msg-sender-name">Anonymous<\/span>/g) || [];
  const anonAvatarSlots = listEl.innerHTML.match(/<div class="msg-row-avatar">(?!<\/div>)/g) || [];
  assert.equal(anonLabels.length, 2, 'Expected 1 "Anonymous" label for memberA (6:02/6:18/6:34) and 1 for memberB');
  assert.equal(anonAvatarSlots.length, 2, 'Expected 1 bottom DP for memberA run and 1 DP for memberB');
});

test('anonymous group chat hydrates seen counts from message_receipts fallback and never flashes or jumps DP upward during multi-row reads', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const convId = '33333333-3333-4333-8333-333333333334';
  const msgTopId = '44444444-4444-4444-8444-444444444461';
  const msgMidId = '44444444-4444-4444-8444-444444444462';
  const msgBotId = '44444444-4444-4444-8444-444444444463';
  const memberA = 'aaaa1111-1111-4111-8111-111111111111';
  const memberB = 'bbbb2222-2222-4222-8222-222222222222';

  const makeEl = (id = '') => {
    const cls = new Set();
    const attrs = new Map();
    let html = '';
    return {
      id, open: false, hidden: false, disabled: false, value: '',
      scrollTop: 0, scrollHeight: 200, clientHeight: 200, dataset: {},
      style: { setProperty() { }, removeProperty() { } },
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (x, f) => (f === undefined ? (cls.has(x) ? cls.delete(x) : cls.add(x)) : (f ? cls.add(x) : cls.delete(x))),
        contains: (x) => cls.has(x),
        replace: (a, b) => { cls.delete(a); cls.add(b); }
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
      removeAttribute: (k) => attrs.delete(k),
      addEventListener() { }, removeEventListener() { },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() { },
      closest: () => null, querySelector: () => null, querySelectorAll: () => [],
      insertAdjacentHTML() { },
      get innerHTML() { return html; }, set innerHTML(v) { html = String(v || ''); },
      get textContent() { return html; }, set textContent(v) { html = String(v || ''); }
    };
  };

  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const listEl = getEl('msg-messages-list');
  const flyers = [];
  listEl.appendChild = (node) => { flyers.push(node); return node; };

  const extractBalancedTick = (fragment) => {
    const startIdx = fragment.indexOf('<span class="msg-tick');
    if (startIdx < 0) return '';
    const sub = fragment.slice(startIdx);
    let depth = 0;
    const tagRe = /<\/?span\b[^>]*>/g;
    let tok;
    while ((tok = tagRe.exec(sub)) !== null) {
      if (tok[0].startsWith('</')) depth -= 1;
      else depth += 1;
      if (depth === 0) return sub.slice(0, tok.index + tok[0].length);
    }
    return sub;
  };

  const rowTicks = new Map();
  const setRowTick = (msgId, tickHtml) => {
    const html = String(tickHtml || '');
    const openM = html.match(/^<span class="(msg-tick[^"]*)"([^>]*)>/);
    const clsSet = new Set((openM?.[1] || '').split(/\s+/).filter(Boolean));
    const attrs = new Map();
    for (const attr of ['title', 'aria-label', 'data-seen-keys']) {
      const m = openM?.[2]?.match(new RegExp(`${attr}="([^"]*)"`));
      if (m) attrs.set(attr, m[1]);
    }
    rowTicks.set(msgId, {
      html,
      attrs,
      node: html ? {
        classList: { contains: (c) => clsSet.has(c) },
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        setAttribute: (k, v) => attrs.set(k, String(v)),
        remove: () => setRowTick(msgId, ''),
        set outerHTML(next) { setRowTick(msgId, next); },
        get outerHTML() { return rowTicks.get(msgId)?.html || ''; }
      } : null
    });
  };

  const origDesc = Object.getOwnPropertyDescriptor(listEl, 'innerHTML');
  Object.defineProperty(listEl, 'innerHTML', {
    get() { return origDesc.get.call(this); },
    set(v) {
      const s = String(v || '');
      origDesc.set.call(this, s);
      rowTicks.clear();
      const matches = [...s.matchAll(/<article class="msg-row[^"]*"[^>]*data-msg-id="([^"]+)"/g)];
      for (let i = 0; i < matches.length; i += 1) {
        const mId = matches[i][1];
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : s.length;
        setRowTick(mId, extractBalancedTick(s.slice(start, end)));
      }
    }
  });
  listEl.querySelector = (sel) => {
    for (const [mId] of rowTicks.entries()) {
      if (sel.includes(mId)) {
        return {
          querySelector: (s2) => (s2 === '.msg-bubble-meta'
            ? {
                querySelector: (s3) => (s3 === '.msg-tick' ? rowTicks.get(mId)?.node || null : null),
                insertAdjacentHTML: (_pos, h) => setRowTick(mId, h)
              }
            : null)
        };
      }
    }
    return null;
  };

  const tableHandlers = new Map();
  const anonGroupConv = {
    id: convId,
    conversation_id: convId,
    kind: 'GROUP',
    title: 'Anonymous GC',
    status: 'ACCEPTED',
    chat_theme: 'anonymous',
    receipts_enabled: true,
    anonymous_enabled: true,
    members: []
  };

  // Simulate a Supabase backend where Migration 179 has NOT been run yet (seen_by: [], NO anon_seen_keys field)
  // while message_receipts table holds Member A's read receipts on all 3 messages.
  const dbReceiptRows = [
    { message_id: msgTopId, user_id: memberA, read_at: '2026-11-22T10:18:05Z' },
    { message_id: msgMidId, user_id: memberA, read_at: '2026-11-22T10:18:05Z' },
    { message_id: msgBotId, user_id: memberA, read_at: '2026-11-22T10:18:05Z' }
  ];
  const baseMsgs = [
    { id: msgTopId, conversation_id: convId, sender_id: meId, sender_name: 'Anonymous', body: 'heyyy', message_type: 'TEXT', created_at: '2026-11-22T10:18:00Z', delivered_at: '2026-11-22T10:18:01Z', read_at: '2026-11-22T10:18:05Z', seen_by: [], attachments: [], reactions: [] },
    { id: msgMidId, conversation_id: convId, sender_id: meId, sender_name: 'Anonymous', body: 'fggf', message_type: 'TEXT', created_at: '2026-11-22T10:34:00Z', delivered_at: '2026-11-22T10:34:01Z', read_at: '2026-11-22T10:34:05Z', seen_by: [], attachments: [], reactions: [] },
    { id: msgBotId, conversation_id: convId, sender_id: meId, sender_name: 'Anonymous', body: 'dfsf', message_type: 'TEXT', created_at: '2026-11-22T10:34:10Z', delivered_at: '2026-11-22T10:34:11Z', read_at: '2026-11-22T10:34:15Z', seen_by: [], attachments: [], reactions: [] }
  ];

  const fakeChannel = {
    on(_t, f, fn) { if (f?.table) tableHandlers.set(f.table, fn); return fakeChannel; },
    subscribe() { return fakeChannel; }
  };

  const win = {
    Ipon: {
      client: {
        channel: () => fakeChannel,
        removeChannel: () => Promise.resolve(),
        from: (table) => {
          const q = {
            select: () => q, eq: () => q, in: () => q, not: () => q, like: () => q, or: () => q, order: () => q,
            limit: async () => ({ data: table === 'message_receipts' ? dbReceiptRows.slice() : [], error: null }),
            then: (res) => Promise.resolve({ data: table === 'message_receipts' ? dbReceiptRows.slice() : [], error: null }).then(res)
          };
          return q;
        }
      },
      rpc: async (name) => {
        if (name === 'get_conversations') return [anonGroupConv];
        if (name === 'get_conversation_messages') {
          return { conversation: { ...anonGroupConv }, messages: baseMsgs.map((m) => ({ ...m })), pinned_messages: [], has_older: false, anonymous_enabled: true };
        }
        if (name === 'get_social_overview') return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        if (name === 'mark_conversation_read') return { read_at: '2026-11-22T10:34:16Z', receipts_shared: true };
        return [];
      },
      primeUiSound: () => true, playUiSound: () => true,
      escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      initials: (n) => String(n || 'U').slice(0, 1).toUpperCase(),
      avatarMarkup: () => '<span>AV</span>',
      bindAvatarFallbacks() { }, syncPresenceDots() { }, syncMessagesBadges() { },
      isUserOnline: () => false, friendlyError: (e) => e?.message || 'Error', toast() { },
      verifiedBadgesHtml: () => '', fitVerifiedNameLines() { }, registerVerifiedBadges() { },
      registerMemberAvatars() { }, getClientPlatform: () => 'web', supportsNativeScreenshotProtection: () => false
    },
    addEventListener() { }, removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    location: { origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '' },
    navigator: { userAgent: 'test' },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } }
  };
  win.window = win;

  const doc = {
    visibilityState: 'visible', body: makeEl('body'), documentElement: makeEl('html'),
    getElementById: getEl,
    querySelector: (sel) => (sel.startsWith('#') && !sel.includes(' ') ? getEl(sel.slice(1)) : null),
    querySelectorAll: () => [], createElement: (tag) => makeEl(tag),
    addEventListener() { }, removeEventListener() { }
  };

  const timers = [];
  vm.runInNewContext(messagesJs, {
    window: win, document: doc, location: win.location, navigator: win.navigator,
    localStorage: win.localStorage, sessionStorage: win.sessionStorage,
    CSS: { escape: (s) => String(s) }, URL: { createObjectURL: () => 'blob:mock', revokeObjectURL() { } },
    URLSearchParams, requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn, ms) => { const id = timers.length + 1; timers.push({ id, fn, ms, cleared: false }); return id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    setInterval: () => 0, clearInterval() { }, console
  });

  await win.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', chat_privacy: { show_online: true } });
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });

  // Initially 1 crisp DP on bottom message only (top/mid have no seen DP)
  assert.equal(rowTicks.get(msgTopId).html, '');
  assert.equal(rowTicks.get(msgMidId).html, '');
  assert.match(rowTicks.get(msgBotId).html, /src="assets\/anonymous-avatar\.svg"/);
  assert.doesNotMatch(rowTicks.get(msgBotId).html, /is-anon-count/);

  // Member B opens the GC -> Postgres streams message_receipts TOP-TO-BOTTOM (msgTop, msgMid, then msgBot)
  dbReceiptRows.push(
    { message_id: msgTopId, user_id: memberB, read_at: '2026-11-22T10:35:00Z' },
    { message_id: msgMidId, user_id: memberB, read_at: '2026-11-22T10:35:00Z' },
    { message_id: msgBotId, user_id: memberB, read_at: '2026-11-22T10:35:00Z' }
  );

  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgTopId, user_id: memberB, delivered_at: '2026-11-22T10:18:01Z', read_at: '2026-11-22T10:35:00Z' }
  });
  // Top message MUST NOT flash an anonymous DP upward while the rest of the burst is arriving!
  assert.equal(rowTicks.get(msgTopId).html, '', 'Top message must not prematurely flash an anonymous DP upward');

  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgMidId, user_id: memberB, delivered_at: '2026-11-22T10:34:01Z', read_at: '2026-11-22T10:35:00Z' }
  });
  assert.equal(rowTicks.get(msgMidId).html, '', 'Middle message must not prematurely flash an anonymous DP upward');

  // Bottom message receipt lands -> flushes immediately in-place as blurred anonymous DP with "2" and ZERO upward flyers
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgBotId, user_id: memberB, delivered_at: '2026-11-22T10:34:11Z', read_at: '2026-11-22T10:35:00Z' }
  });
  assert.equal(rowTicks.get(msgTopId).html, '');
  assert.equal(rowTicks.get(msgMidId).html, '');
  assert.match(rowTicks.get(msgBotId).html, /is-anon-count/);
  assert.match(rowTicks.get(msgBotId).html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">2<\/span>/);
  assert.equal(rowTicks.get(msgBotId).attrs.get('title'), 'Seen by 2');
  assert.equal(flyers.length, 0, 'No upward or spurious glide flyer should launch when staying on the bottom message');
  assert.doesNotMatch(rowTicks.get(msgBotId).html, new RegExp(`${memberA}|${memberB}`));

  // Flush the scheduled background refresh (still pre-Migration 179 RPC response!) -> fallback hydration MUST keep blurred "2"!
  for (const t of timers.splice(0)) {
    if (!t.cleared) { t.cleared = true; await t.fn(); }
  }
  assert.match(rowTicks.get(msgBotId).html, /is-anon-count/);
  assert.match(rowTicks.get(msgBotId).html, /<span class="msg-seen-dp-anon-count" aria-hidden="true">2<\/span>/);
  assert.equal(rowTicks.get(msgBotId).attrs.get('title'), 'Seen by 2');
});
