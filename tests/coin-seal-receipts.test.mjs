import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Coin Seal receipt CSS & SVG tokens define all 4 states, transitions, theme contrast, and reduced-motion safety', () => {
  const css = read('css/app.css');
  const messagesJs = read('js/messages.js');

  assert.match(messagesJs, /const COIN_SENDING_SVG = '<svg class="msg-tick-svg is-coin-sending"/);
  assert.match(messagesJs, /const COIN_SENT_SVG = '<svg class="msg-tick-svg is-coin-sent"/);
  assert.match(messagesJs, /const COIN_DELIVERED_SVG = '<svg class="msg-tick-svg is-coin-delivered"/);
  assert.match(messagesJs, /const COIN_SEEN_SVG = '<svg class="msg-tick-svg is-coin-read"/);
  const coinSvgBlock = messagesJs.slice(messagesJs.indexOf('const COIN_SENDING_SVG'), messagesJs.indexOf('const VIDEO_PLAY_SVG'));
  assert.doesNotMatch(coinSvgBlock, /<clipPath|<defs|\bid="/);
  assert.match(messagesJs, /function getReceiptStage\(m, conv\)/);
  assert.match(messagesJs, /ipon\(\)\.primeUiSound\?\.\(\);/);

  for (const kf of [
    'msgCoinSpin',
    'msgCoinLock',
    'msgCoinDeliverRim',
    'msgCoinCorePop',
    'msgCoinDeliverPulse',
    'msgCoinSealStamp',
    'msgCoinMarkDraw',
    'msgCoinSealHalo',
    'msgCoinGlint',
    'msgSeenDpFlip',
    'msgSeenDpHalo',
    'msgSeenDpSheen',
    'msgSeenReaderJoin'
  ]) {
    assert.match(css, new RegExp(`@keyframes\\s+${kf}\\s*\\{`), `Missing @keyframes ${kf}`);
  }

  assert.match(css, /\.msg-tick-svg\s*\{[^}]*width:\s*15px;[^}]*height:\s*15px;[^}]*overflow:\s*visible;/s);
  assert.match(css, /\.msg-seen-dp-coin\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*border-radius:\s*50%;/s);
  assert.match(css, /\.msg-seen-dp-coin::before,\s*\.msg-seen-dp-face::after,/);
  assert.match(css, /\.msg-row\.is-mine \.msg-tick\.is-read\s*\{\s*color:\s*#f2c14e;\s*--coin-ink:\s*#0f3a2b;/);
  assert.match(css, /\.msg-bubble-meta\.is-media-overlay \.msg-tick\.is-read\s*\{\s*color:\s*#f5c85b;\s*--coin-ink:\s*#112a21;/);
  assert.match(css, /\.msg-row\.is-mine \.msg-bubble\.has-audio-only \.msg-tick\.is-read\s*\{\s*color:\s*#c9921a;\s*--coin-ink:\s*#fffaf0;/);
  assert.match(css, /\.msg-tick\.is-read\.is-anim \.coin-mark\s*\{[\s\S]*?stroke-dashoffset:\s*0\s*!important;/);
});

test('Coin Seal receipts animate only on live state changes, render peer DP medallions, and animate joining group readers cleanly', async () => {
  const messagesJs = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const peerId = '22222222-2222-4222-8222-222222222222';
  const convId = '33333333-3333-4333-8333-333333333333';
  const msgId = '44444444-4444-4444-8444-444444444444';

  const makeEl = (id = '') => {
    const cls = new Set();
    const attrs = new Map();
    const listeners = new Map();
    let html = '';
    const el = {
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
      addEventListener: (ev, fn) => { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(fn); },
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
    return el;
  };

  const els = new Map();
  const getEl = (id) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); };
  const listEl = getEl('msg-messages-list');

  // Track live DOM tick element per message id for patchMessageReceiptsDom
  let liveTickHtml = '';
  let liveTickClasses = new Set();
  let liveTickAttrs = new Map();
  let outerHtmlWrites = 0;

  const parseTickFromHtml = (html) => {
    const startIdx = html.indexOf('<span class="msg-tick');
    if (startIdx < 0) return;
    const sub = html.slice(startIdx);
    const openM = sub.match(/^<span class="(msg-tick[^"]*)"([^>]*)>/);
    if (!openM) return;
    // Match balanced nested <span>...</span>
    let depth = 0;
    let endIdx = sub.length;
    const tagRe = /<\/?span\b[^>]*>/g;
    let tok;
    while ((tok = tagRe.exec(sub)) !== null) {
      if (tok[0].startsWith('</')) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        endIdx = tok.index + tok[0].length;
        break;
      }
    }
    liveTickHtml = sub.slice(0, endIdx);
    liveTickClasses = new Set(openM[1].split(/\s+/).filter(Boolean));
    liveTickAttrs = new Map();
    const titleM = openM[2].match(/title="([^"]*)"/);
    const ariaM = openM[2].match(/aria-label="([^"]*)"/);
    const keysM = openM[2].match(/data-seen-keys="([^"]*)"/);
    if (titleM) liveTickAttrs.set('title', titleM[1]);
    if (ariaM) liveTickAttrs.set('aria-label', ariaM[1]);
    if (keysM) liveTickAttrs.set('data-seen-keys', keysM[1]);
  };

  const origDesc = Object.getOwnPropertyDescriptor(listEl, 'innerHTML');
  Object.defineProperty(listEl, 'innerHTML', {
    get() { return origDesc.get.call(this); },
    set(v) {
      origDesc.set.call(this, v);
      parseTickFromHtml(String(v || ''));
    }
  });

  const liveTickNode = {
    classList: { contains: (c) => liveTickClasses.has(c) },
    getAttribute: (k) => (liveTickAttrs.has(k) ? liveTickAttrs.get(k) : null),
    setAttribute: (k, v) => liveTickAttrs.set(k, String(v)),
    set outerHTML(next) {
      outerHtmlWrites += 1;
      parseTickFromHtml(String(next || ''));
    },
    get outerHTML() { return liveTickHtml; }
  };

  listEl.querySelector = (sel) => {
    if (sel.includes(msgId)) {
      return {
        querySelector: (s2) => (s2 === '.msg-bubble-meta'
          ? { querySelector: (s3) => (s3 === '.msg-tick' && liveTickHtml ? liveTickNode : null), insertAdjacentHTML() { } }
          : null)
      };
    }
    return null;
  };

  const tableHandlers = new Map();
  const threadMessages = [
    {
      id: msgId,
      conversation_id: convId,
      sender_id: meId,
      sender_name: 'Me',
      body: 'Coin seal live test',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:00:00Z',
      delivered_at: null,
      read_at: null,
      attachments: [],
      reactions: []
    }
  ];

  const benId = '99999999-9999-4999-8999-999999999999';
  const carlaId = '88888888-8888-4888-8888-888888888888';
  const danId = '77777777-7777-4777-8777-777777777777';
  const conv = {
    id: convId,
    conversation_id: convId,
    kind: 'GROUP',
    title: 'Savings Circle',
    status: 'ACCEPTED',
    chat_theme: 'paper',
    receipts_enabled: true,
    members: [
      { id: meId, full_name: 'Me', role: 'MEMBER' },
      { id: peerId, full_name: 'Ana Cruz', avatar_url: 'https://cdn.example/ana.jpg', role: 'MEMBER' },
      { id: benId, full_name: 'Ben Reyes', avatar_url: '', role: 'MEMBER' },
      { id: carlaId, full_name: 'Carla Lim', avatar_url: 'https://cdn.example/carla.jpg', role: 'MEMBER' },
      { id: danId, full_name: 'Dan Tan', avatar_url: 'https://cdn.example/dan.jpg', role: 'MEMBER' }
    ]
  };
  let activeConvPayload = conv;
  let activeMsgsPayload = threadMessages;

  let primeCalls = 0;
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
        if (name === 'get_conversations') return [activeConvPayload];
        if (name === 'get_conversation_messages') return { conversation: activeConvPayload, messages: activeMsgsPayload, pinned_messages: [], has_older: false };
        if (name === 'get_social_overview') return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        if (name === 'mark_conversation_read') return { read_at: '2026-11-22T12:00:01Z', receipts_shared: true };
        if (name === 'send_chat_message') return { id: '55555555-5555-4555-8555-555555555555' };
        return [];
      },
      primeUiSound: () => { primeCalls += 1; return true; },
      playUiSound: () => true,
      escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      initials: (name) => String(name || 'U').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || 'U',
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
    querySelector: (sel) => (sel.startsWith('#') ? getEl(sel.slice(1).split(/\s/)[0]) : null),
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener() { },
    removeEventListener() { }
  };

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
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() { },
    console
  };
  vm.runInNewContext(messagesJs, sandbox);

  await win.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', chat_privacy: { show_online: true } });
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: convId });

  // 1. Initial load: Sent coin renders WITHOUT is-anim
  assert.match(liveTickHtml, /class="msg-tick is-sent"/);
  assert.match(liveTickHtml, /class="msg-tick-svg is-coin-sent"/);
  assert.doesNotMatch(liveTickHtml, /is-anim/);
  assert.equal(outerHtmlWrites, 0);

  // 2. Live Sent -> Delivered transition animates with is-anim + minted core
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgId, user_id: peerId, delivered_at: '2026-11-22T12:00:05Z', read_at: null }
  });
  assert.equal(outerHtmlWrites, 1);
  assert.match(liveTickHtml, /class="msg-tick is-delivered is-anim"/);
  assert.match(liveTickHtml, /class="msg-tick-svg is-coin-delivered"/);

  // 3. Live Delivered -> Seen transition animates with 3D coin flip (is-anim) showing Ana's real DP
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgId, user_id: peerId, delivered_at: '2026-11-22T12:00:05Z', read_at: '2026-11-22T12:00:12Z' }
  });
  assert.equal(outerHtmlWrites, 2);
  assert.match(liveTickHtml, /class="msg-tick is-read is-anim"/);
  assert.match(liveTickHtml, /class="msg-seen-dp-coin" data-seen-reader="22222222-2222-4222-8222-222222222222"/);
  assert.match(liveTickHtml, /src="https:\/\/cdn\.example\/ana\.jpg"[^>]*data-avatar-img/);
  assert.equal(liveTickAttrs.get('title'), 'Seen by Ana Cruz');

  // 4. 2nd group member (Ben, no DP -> initials BR) reads live: ONLY Ben gets is-reader-new, Ana stays steady
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgId, user_id: benId, delivered_at: '2026-11-22T12:00:05Z', read_at: '2026-11-22T12:00:15Z' }
  });
  assert.equal(outerHtmlWrites, 3);
  assert.doesNotMatch(liveTickHtml, /class="msg-tick is-read is-anim"/, 'Adding a 2nd reader should not re-flip existing readers');
  assert.match(liveTickHtml, /class="msg-seen-dp-stack is-multi"/);
  assert.match(liveTickHtml, /class="msg-seen-dp-coin" data-seen-reader="22222222-2222-4222-8222-222222222222"/);
  assert.match(liveTickHtml, /class="msg-seen-dp-coin is-reader-new" data-seen-reader="99999999-9999-4999-8999-999999999999"[\s\S]*?<span class="msg-seen-dp-fallback">BR<\/span>/);
  assert.equal(liveTickAttrs.get('title'), 'Seen by Ana Cruz, Ben Reyes');

  // 5. Duplicate read receipt for same reader does NOT rewrite DOM (preserves in-flight animation)
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgId, user_id: benId, delivered_at: '2026-11-22T12:00:05Z', read_at: '2026-11-22T12:00:16Z' }
  });
  assert.equal(outerHtmlWrites, 3, 'Duplicate read receipt for existing reader must not replace DOM');

  // 6. 4 readers in group cap at 3 overlapping DP coins + "+1" counter chip
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgId, user_id: carlaId, delivered_at: '2026-11-22T12:00:05Z', read_at: '2026-11-22T12:00:18Z' }
  });
  tableHandlers.get('message_receipts')?.({
    eventType: 'UPDATE',
    new: { message_id: msgId, user_id: danId, delivered_at: '2026-11-22T12:00:05Z', read_at: '2026-11-22T12:00:20Z' }
  });
  assert.match(liveTickHtml, /class="msg-seen-dp-more"[^>]*>\+1<\/span>/);
  assert.equal(liveTickAttrs.get('title'), 'Seen by Ana Cruz, Ben Reyes, Carla Lim, Dan Tan');

  // 7. Direct chat shows peer's actual DP inside the gold medallion; anonymous mode masks with anonymous avatar
  const directConvId = '66666666-6666-4666-8666-666666666666';
  activeConvPayload = {
    id: peerId,
    conversation_id: directConvId,
    kind: 'DIRECT',
    full_name: 'Maria Santos',
    avatar_url: 'https://cdn.example/maria.jpg',
    status: 'ACCEPTED',
    chat_theme: 'paper',
    receipts_enabled: true,
    anonymous_enabled: false
  };
  activeMsgsPayload = [
    {
      id: '55555555-5555-4555-8555-555555555555',
      conversation_id: directConvId,
      sender_id: meId,
      body: 'Direct seen test',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:05:00Z',
      delivered_at: '2026-11-22T12:05:01Z',
      read_at: '2026-11-22T12:05:04Z',
      attachments: [],
      reactions: []
    },
    {
      id: '55555555-5555-4555-8555-555555555556',
      conversation_id: directConvId,
      sender_id: meId,
      body: 'Second message in same minute',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:05:20Z',
      delivered_at: '2026-11-22T12:05:21Z',
      read_at: '2026-11-22T12:05:24Z',
      attachments: [],
      reactions: []
    },
    {
      id: '55555555-5555-4555-8555-555555555557',
      conversation_id: directConvId,
      sender_id: peerId,
      body: 'Peer reply in same minute',
      message_type: 'TEXT',
      created_at: '2026-11-22T12:05:45Z',
      delivered_at: null,
      read_at: null,
      attachments: [],
      reactions: []
    }
  ];
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: directConvId });
  assert.match(liveTickHtml, /src="https:\/\/cdn\.example\/maria\.jpg"[^>]*data-avatar-img/);
  assert.equal(liveTickAttrs.get('title'), 'Seen by Maria Santos');
  assert.equal(liveTickAttrs.get('aria-label'), 'Seen');
  const renderedTimes = listEl.innerHTML.match(/<time\b[^>]*>[^<]+<\/time>/g) || [];
  assert.equal(renderedTimes.length, 3, 'Every message including same-minute outgoing and peer replies must render a <time> label');

  // Anonymous mode must never leak real peer DP or name
  const anonConvId = '77777777-7777-4777-8777-777777777778';
  activeConvPayload = {
    ...activeConvPayload,
    conversation_id: anonConvId,
    anonymous_enabled: true
  };
  await win.IponMessages.openWorkspace({ tab: 'chats', conversationId: anonConvId });
  assert.match(liveTickHtml, /src="assets\/anonymous-avatar\.svg"/);
  assert.doesNotMatch(liveTickHtml, /maria\.jpg|Maria Santos/);
  assert.equal(liveTickAttrs.get('title'), 'Seen');
  assert.equal(primeCalls, 0);
});

test('core.js primeUiSound and self-rearming audio unlock recover from suspended contexts and boost msg-send audibility', async () => {
  const coreJs = read('js/core.js');
  const winListeners = new Map();
  const docListeners = new Map();
  let audioCtxInstance = null;
  let resumeCalls = 0;
  let allowResumeToRun = false;
  const scheduledFreqs = [];

  class MockAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
      this._stateListeners = [];
      audioCtxInstance = this;
    }
    addEventListener(ev, fn) {
      if (ev === 'statechange') this._stateListeners.push(fn);
    }
    emitStateChange(next) {
      this.state = next;
      this._stateListeners.forEach((fn) => fn());
    }
    resume() {
      resumeCalls += 1;
      if (allowResumeToRun) this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      return {
        gain: { setValueAtTime() { }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { } },
        connect() { }
      };
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime: (f) => scheduledFreqs.push(f),
          exponentialRampToValueAtTime: (f) => scheduledFreqs.push(f)
        },
        connect() { },
        start() { },
        stop() { }
      };
    }
    createBuffer(ch, len) {
      return { sampleRate: 44100, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      return { buffer: null, connect() { }, start() { }, stop() { } };
    }
    createBiquadFilter() {
      return { type: 'bandpass', frequency: { setValueAtTime() { } }, Q: { setValueAtTime() { } }, connect() { } };
    }
    createDynamicsCompressor() {
      return {
        threshold: { setValueAtTime() { } },
        knee: { setValueAtTime() { } },
        ratio: { setValueAtTime() { } },
        attack: { setValueAtTime() { } },
        release: { setValueAtTime() { } },
        connect() { }
      };
    }
  }

  const win = {
    IPON_CONFIG: {},
    AudioContext: MockAudioContext,
    addEventListener: (ev, fn) => { if (!winListeners.has(ev)) winListeners.set(ev, new Set()); winListeners.get(ev).add(fn); },
    removeEventListener: (ev, fn) => { winListeners.get(ev)?.delete(fn); },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    location: { origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '' },
    navigator: { userAgent: 'test' },
    matchMedia: () => ({ matches: false, addEventListener() { } })
  };
  const makeStubEl = () => ({
    dataset: {},
    style: {},
    className: '',
    hidden: false,
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    setAttribute() { },
    getAttribute: () => null,
    addEventListener() { },
    removeEventListener() { },
    appendChild() { },
    insertAdjacentHTML() { },
    querySelector: () => null,
    querySelectorAll: () => []
  });
  win.window = win;
  const doc = {
    readyState: 'loading',
    visibilityState: 'visible',
    body: makeStubEl(),
    head: makeStubEl(),
    documentElement: makeStubEl(),
    createElement: () => makeStubEl(),
    addEventListener: (ev, fn) => { if (!docListeners.has(ev)) docListeners.set(ev, new Set()); docListeners.get(ev).add(fn); },
    removeEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null
  };

  vm.runInNewContext(coreJs, { window: win, document: doc, location: win.location, navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage, setTimeout, clearTimeout, console });

  // Listeners are armed across pointerdown, touchend, click, and keydown
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
    assert.equal(winListeners.get(ev)?.size, 1, `Expected unlock listener on ${ev}`);
  }

  // First gesture fails to unlock (stays suspended): listeners MUST stay armed
  for (const fn of [...winListeners.get('pointerdown')]) fn();
  await Promise.resolve();
  assert.equal(audioCtxInstance.state, 'suspended');
  assert.equal(winListeners.get('touchend')?.size, 1, 'Listeners must stay armed while AudioContext is still suspended');

  // Next touchend succeeds: listeners disarm
  allowResumeToRun = true;
  for (const fn of [...winListeners.get('touchend')]) fn();
  await Promise.resolve();
  assert.equal(audioCtxInstance.state, 'running');
  assert.equal(winListeners.get('touchend')?.size, 0, 'Listeners should disarm once AudioContext is running');

  // OS suspends audio in background -> statechange re-arms listeners automatically
  audioCtxInstance.emitStateChange('suspended');
  assert.equal(winListeners.get('click')?.size, 1, 'Listeners must re-arm when AudioContext becomes suspended');

  // Explicit primeUiSound resumes context synchronously inside composer gesture
  const prevResumes = resumeCalls;
  assert.equal(win.Ipon.primeUiSound(), true);
  assert.equal(resumeCalls, prevResumes + 1);
  assert.equal(audioCtxInstance.state, 'running');

  // msg-send plays multi-harmonic crisp cue (> 1 kHz upper presence for phone speakers)
  scheduledFreqs.length = 0;
  assert.equal(win.Ipon.playUiSound('msg-send'), true);
  assert.ok(scheduledFreqs.some((f) => f >= 1100), `Expected bright phone-speaker harmonic in msg-send, got ${scheduledFreqs}`);
});
