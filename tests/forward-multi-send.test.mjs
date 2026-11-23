import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Forward modal renders fixed-size thumbnail link previews, deduplicates self chat, stays open for multi-send with Sent state, and updates footer count', async () => {
  const embedsJs = read('js/social-video-embeds.js');
  const messagesJs = read('js/messages.js');
  const appCss = read('css/app.css');

  // 1. CSS guarantees fixed 60x60 thumbnail box, fixed 80px preview card height, ellipsis truncation, Sent pill, and dark mode parity
  assert.match(appCss, /\.msg-forward-preview\s*\{[^}]*min-height:\s*80px;[^}]*max-height:\s*80px;/s);
  assert.match(appCss, /\.msg-forward-thumb\s*\{[^}]*width:\s*60px;[^}]*height:\s*60px;[^}]*flex:\s*0 0 60px;/s);
  assert.match(appCss, /\.msg-forward-name\s*\{[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  assert.match(appCss, /\.msg-forward-action\s*\{[^}]*min-width:\s*82px;/s);
  assert.match(appCss, /\.msg-forward-row\.is-sent \.msg-forward-action\s*\{/);
  assert.match(appCss, /html\[data-theme="dark"\] \.msg-forward-row\.is-sent \.msg-forward-action\s*\{/);

  // 2. Runtime VM test: social embed compact preview + hydration + multi-recipient Send -> Sent flow
  const listeners = new Map();
  const rpcCalls = [];
  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, f) => (f === undefined ? (set.has(c) ? (set.delete(c), false) : (set.add(c), true)) : (f ? set.add(c) : set.delete(c))),
      contains: (c) => set.has(c)
    };
  };

  let closedCount = 0;
  const fwdDialog = { id: 'msg-forward-dialog', open: false, showModal() { this.open = true; }, close() { this.open = false; closedCount += 1; } };
  const fwdStatus = { id: 'msg-forward-status', textContent: 'Tap Send to forward', classList: makeClassList() };
  const fwdBody = {
    id: 'msg-forward-body',
    dataset: {},
    innerHTML: '',
    querySelectorAll: () => []
  };

  const docStub = {
    documentElement: { dataset: {} },
    body: { insertAdjacentHTML: () => { } },
    getElementById: (id) => {
      if (id === 'msg-forward-dialog') return fwdDialog;
      if (id === 'msg-forward-body') return fwdBody;
      if (id === 'msg-forward-status') return fwdStatus;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener: () => { }
  };

  const winStub = {
    Ipon: {
      escapeHtml: (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      initials: (n) => String(n || '').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase(),
      isSafeImageRef: (u) => /^https?:\/\//i.test(String(u || '')),
      friendlyError: (e) => String(e?.message || e),
      toast: () => { },
      bindAvatarFallbacks: () => { },
      invokeSocialEmbedResolver: async () => ({
        provider: 'instagram',
        badge: 'Instagram Reel',
        title: 'Never get choked again!',
        author: '@amrghoneim_bjj',
        thumbnailUrl: 'https://scontent.cdninstagram.com/v/t51.2885-15/thumb.jpg',
        canonicalUrl: 'https://www.instagram.com/reel/DgDKxW6xGxj/'
      }),
      rpc: async (name, params) => {
        rpcCalls.push({ name, params });
        if (name === 'start_or_open_direct_chat') return { id: `conv-opened-${params.p_target_id}` };
        if (name === 'send_chat_message') return { id: `msg-sent-${rpcCalls.length}` };
        return [];
      },
      client: null
    },
    addEventListener: () => { },
    removeEventListener: () => { },
    location: { search: '', href: 'https://example.test/dashboard.html' }
  };
  winStub.window = winStub;

  const sandbox = {
    window: winStub,
    globalThis: winStub,
    document: docStub,
    location: winStub.location,
    Map,
    Set,
    URL,
    URLSearchParams,
    navigator: {},
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => { }
  };

  vm.runInNewContext(embedsJs, sandbox);
  const patchedMessages = messagesJs.replace(
    'window.IponMessages = {',
    'window.IponMessages = { __seedForwardForTest(me, convs, friends, activeConv) { initializedProfile = me; state.conversations = convs; state.overview = { me, friends, incoming_requests: [], sent_requests: [], blocked_users: [] }; state.activeConvId = activeConv.conversation_id; state.activeThread = { conversation: activeConv, messages: [], pinned_messages: [] }; }, __openForwardForTest(msg) { return openForwardDialog(msg); },'
  );
  vm.runInNewContext(patchedMessages, sandbox);

  const me = { id: 'u-me', full_name: 'Zedrick De Monteverde', avatar_url: '' };
  winStub.IponMessages.__seedForwardForTest(
    me,
    [
      { id: 'c-self', status: 'ACCEPTED', kind: 'DIRECT', anonymous_enabled: false, peer: { id: 'u-me', full_name: 'Zedrick De Monteverde', username: 'zediskaaa' } },
      { id: 'c-nhic', status: 'ACCEPTED', kind: 'DIRECT', anonymous_enabled: false, peer: { id: 'u-nhic', full_name: 'Nhicole Joy Gadia Antalan', username: '_ligaya' } }
    ],
    [
      { id: 'u-jher', full_name: 'Jherrico Dolba Viray', username: 'jherrico_ipon' }
    ],
    { conversation_id: 'c-other', block_forwarding: false, anonymous_enabled: false }
  );

  // Prime Instagram metadata in cache so renderCompactLinkPreviewHtml renders thumbnail immediately
  await winStub.IponSocialEmbeds.resolveSocialEmbed(
    'https://www.instagram.com/reel/DgDKxW6xGxj/?utm_source=ig_web_copy_link&bqrl=NTc4MTIwNjQ2YQ==',
    winStub.Ipon.invokeSocialEmbedResolver
  );

  await winStub.IponMessages.__openForwardForTest({
    id: 'm-ig-1',
    body: 'https://www.instagram.com/reel/DgDKxW6xGxj/?utm_source=ig_web_copy_link&bqrl=NTc4MTIwNjQ2YQ=='
  });

  assert.equal(fwdDialog.open, true);
  // 1) Self account must appear ONLY ONCE (duplicate self row fixed)
  const selfOccurrences = (fwdBody.innerHTML.match(/data-fwd-user="u-me"/g) || []).length;
  assert.equal(selfOccurrences, 1, 'Self account should appear exactly once in Forward list');
  // 2) Link preview includes fixed thumbnail img, Instagram Reel kicker, clean title, and query-stripped URL
  assert.match(fwdBody.innerHTML, /class="msg-forward-preview is-social is-instagram"/);
  assert.match(fwdBody.innerHTML, /class="msg-forward-thumb-img" src="https:\/\/scontent\.cdninstagram\.com\/v\/t51\.2885-15\/thumb\.jpg"/);
  assert.match(fwdBody.innerHTML, /<strong class="msg-forward-preview-title"[^>]*>Never get choked again!<\/strong>/);
  assert.match(fwdBody.innerHTML, /<small class="msg-forward-preview-sub"[^>]*>@amrghoneim_bjj · instagram\.com\/reel\/DgDKxW6xGxj<\/small>/);
  // 3) Search input and Done footer exist
  assert.match(fwdBody.innerHTML, /id="msg-forward-search"/);
  assert.match(fwdBody.innerHTML, /data-msg-forward-close>Done<\/button>/);

  // 4) Clicking Send on recipient #1 marks it Sent and keeps the modal OPEN for recipient #2
  const makeFwdRow = ({ user, conv, key, name }) => {
    const pill = { textContent: 'Send', innerHTML: 'Send' };
    const attrs = {};
    const row = {
      disabled: false,
      dataset: { fwdUser: user, fwdConv: conv, fwdKey: key, fwdName: name },
      classList: makeClassList(['msg-forward-row']),
      querySelector: (sel) => (sel === '[data-fwd-action]' ? pill : null),
      setAttribute: (k, v) => { attrs[k] = v; },
      closest: (sel) => (sel === '[data-fwd-user]' ? row : null),
      _pill: pill,
      _attrs: attrs
    };
    return row;
  };

  const emitClick = async (target) => {
    for (const fn of listeners.get('click') || []) {
      await fn({ target });
    }
  };

  const row1 = makeFwdRow({ user: 'u-nhic', conv: 'c-nhic', key: 'u:u-nhic', name: 'Nhicole' });
  const row2 = makeFwdRow({ user: 'u-jher', conv: '', key: 'u:u-jher', name: 'Jherrico' });

  await emitClick(row1);
  assert.equal(fwdDialog.open, true, 'Dialog stays open after forwarding to first user');
  assert.equal(closedCount, 0);
  assert.equal(row1.disabled, true);
  assert.equal(row1.dataset.fwdState, 'sent');
  assert.equal(row1.classList.contains('is-sent'), true);
  assert.match(row1._pill.innerHTML, />Sent<\/span>/);
  assert.equal(fwdStatus.textContent, 'Sent to 1 chat');

  // Re-clicking an already Sent row is ignored (no duplicate RPC)
  const rpcCountAfterFirst = rpcCalls.length;
  await emitClick(row1);
  assert.equal(rpcCalls.length, rpcCountAfterFirst, 'Clicking an already-Sent row does not double-send');

  // Clicking Send on recipient #2 opens direct chat and forwards to a second user seamlessly
  await emitClick(row2);
  assert.equal(fwdDialog.open, true, 'Dialog stays open after forwarding to second user');
  assert.equal(row2.dataset.fwdState, 'sent');
  assert.equal(row2.classList.contains('is-sent'), true);
  assert.match(row2._pill.innerHTML, />Sent<\/span>/);
  assert.equal(fwdStatus.textContent, 'Sent to 2 chats');
  assert.ok(rpcCalls.some((c) => c.name === 'send_chat_message' && c.params.p_conversation_id === 'c-nhic' && c.params.p_message_type === 'FORWARDED'));
  assert.ok(rpcCalls.some((c) => c.name === 'send_chat_message' && c.params.p_conversation_id === 'conv-opened-u-jher' && c.params.p_message_type === 'FORWARDED'));

  // Clicking Done closes the dialog cleanly
  const doneTarget = { closest: (sel) => (sel === '[data-msg-forward-close]' ? {} : null) };
  await emitClick(doneTarget);
  assert.equal(fwdDialog.open, false);
  assert.equal(closedCount, 1);

  // 5) Forwarded tag renders OUTSIDE .msg-bubble (upper-right on outgoing .is-mine messages) so social embeds / rounded bubbles never clip it
  assert.match(messagesJs, /<div class="msg-bubble-col">\s*\$\{senderNameHtml\}\s*\$\{replyHtml\}\s*\$\{fwdHtml\}\s*<div class="msg-bubble-wrap">/);
  assert.doesNotMatch(messagesJs, /const bubbleContent =[\s\S]{0,360}\$\{fwdHtml\}/);
  assert.match(appCss, /\.msg-row\.is-mine \.msg-forwarded-tag\s*\{[^}]*align-self:\s*flex-end;/s);
});
