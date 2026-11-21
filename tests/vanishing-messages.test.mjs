import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('vanishing messages start only after every recipient reads, stay hidden after expiry, and preserve privacy/self-chat fields', () => {
  const migration = read('database/migrations/20261121_144_vanishing_messages.sql');
  const schema = read('database/schema.sql');
  assert.doesNotMatch(migration, /^\+drop policy/m);
  for (const sql of [migration, schema]) {
    assert.match(sql, /vanish_after_seconds integer[\s\S]*between 1 and 3600/);
    assert.match(sql, /snapshot_message_vanish_duration[\s\S]*before insert on public\.messages/);
    assert.match(sql, /start_seen_message_vanish[\s\S]*pg_advisory_xact_lock/);
    assert.match(sql, /not exists \([\s\S]*from public\.message_receipts mr[\s\S]*join public\.conversation_participants cp[\s\S]*cp\.last_read_at < m\.created_at/);
    assert.match(sql, /vanish_at = v_started_at \+ make_interval\(secs => m\.vanish_after_seconds\)/);
    assert.match(sql, /ipon-vanishing-message-purge/);
    assert.match(sql, /purge_expired_vanishing_messages/);
    assert.match(sql, /m\.vanish_at is null or m\.vanish_at > now\(\)/);
    assert.match(sql, /create policy messages_select[\s\S]*vanish_at is null or vanish_at > now\(\)/);
    assert.match(sql, /create policy message_attachments_select[\s\S]*m\.vanish_at is null or m\.vanish_at > now\(\)/);
    assert.match(sql, /role in \('OWNER', 'ADMIN'\)/);
    // Regression guard: get_conversations() preserves migration 115/122/128/130 self-chat, social links, and profile visibility
    assert.match(sql, /'is_self', \(peer\.id = v_uid\)[\s\S]*'profile_visible', peer_vis\.can_view[\s\S]*'social_links'/);
    assert.match(sql, /Personal notes & saved messages/);
  }
});

test('message ring starts at full blue outline, shrinks with time, uses premium toggle + modal UI, and disappears at expiry', () => {
  const source = read('js/messages.js');
  const css = read('css/app.css');
  const duration = source.match(/function formatVanishDuration\(seconds\)\s*\{[\s\S]*?\n  \}/)?.[0];
  const shortFmt = source.match(/function formatVanishShort\(seconds\)\s*\{[\s\S]*?\n  \}/)?.[0];
  const ring = source.match(/function vanishBubbleStyle\(message, now = Date\.now\(\)\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(duration && shortFmt && ring);
  const { formatVanishDuration, formatVanishShort, vanishBubbleStyle } = new Function(
    `${duration}; ${shortFmt}; ${ring}; return { formatVanishDuration, formatVanishShort, vanishBubbleStyle };`
  )();
  const message = { vanish_after_seconds: 10, vanish_at: '2026-11-21T10:00:10.000Z' };
  const start = Date.parse('2026-11-21T10:00:00.000Z');
  assert.match(vanishBubbleStyle(message, start), /--vanish-angle:360\.00deg;--vanish-remaining:10000ms/);
  assert.match(vanishBubbleStyle(message, start + 7500), /--vanish-angle:90\.00deg;--vanish-remaining:2500ms/);
  assert.equal(vanishBubbleStyle(message, start + 10000), '');
  assert.equal(vanishBubbleStyle({ vanish_after_seconds: 10, vanish_at: null }, start), '');
  assert.equal(formatVanishDuration(60), '1 minute');
  assert.equal(formatVanishShort(300), '5 min');
  assert.equal(formatVanishShort(3600), '60 min');
  assert.equal(formatVanishShort(10), '10 sec');
  assert.match(source, /scheduleVanishExpiry\(\)/);
  assert.match(source, /set_conversation_vanish/);
  assert.match(source, /validateVanishCustomInput/);
  assert.match(source, /id="msg-vanish-dialog"/);
  assert.match(source, /Set vanish timer/);
  assert.match(source, /data-vanish-switch/);
  assert.match(source, /data-vanish-open-modal/);
  assert.match(source, /data-vanish-preset=/);
  assert.match(source, /data-vanish-unit="seconds"/);
  assert.match(source, /data-vanish-unit="minutes"/);
  assert.match(source, /hasPendingIncomingVanish/);
  assert.match(source, /function restoreDrawerScrollInstant\(scrollTop\)/);
  assert.match(source, /focus\?\.\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.doesNotMatch(source, /1\?3600|1\?\$\{max\}/);
  assert.match(css, /@property --vanish-angle/);
  assert.match(css, /#4aaeff/);
  assert.match(css, /\.msg-drawer-body\s*\{[^}]*scroll-behavior:\s*auto;/s);
  assert.match(css, /mask:\s*linear-gradient\(#000 0 0\) content-box,\s*linear-gradient\(#000 0 0\);/);
  assert.match(css, /dialog\.msg-vanish-modal\s*\{/);
  assert.match(css, /\.msg-vanish-modal \.msg-vanish-close\s*\{[^}]*border-radius:\s*50%;/s);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('active conversation removes an expired bubble after its exit animation', () => {
  const source = read('js/messages.js');
  const schedulerSource = source.match(/function scheduleVanishExpiry\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(schedulerSource);
  let now = Date.parse('2026-11-21T10:00:00.000Z');
  const pending = [];
  const marked = [];
  let renders = 0;
  const state = {
    activeConvId: 'conversation-1',
    activeThread: { messages: [{ id: 'message-1', vanish_at: new Date(now + 10000).toISOString() }] }
  };
  const list = { querySelector: () => ({ classList: { add: (name) => marked.push(name) } }) };
  const wrap = { scrollTop: 50, scrollHeight: 500, clientHeight: 200 };
  const schedule = new Function(
    'state', 'document', 'Date', 'setTimeout', 'clearTimeout', 'renderMessagesList',
    `let vanishUiTimer = null; ${schedulerSource}; return scheduleVanishExpiry;`
  )(
    state,
    { getElementById: (id) => id === 'msg-messages-list' ? list : wrap },
    { now: () => now, parse: Date.parse },
    (fn, delay) => { pending.push({ fn, delay }); return pending.length; },
    () => {},
    () => { renders += 1; }
  );
  schedule();
  assert.equal(pending.shift().delay, 10000);
  now += 10000;
  // Run the scheduled expiry using the same callback captured above.
  schedule();
  const expiry = pending.shift();
  expiry.fn();
  assert.deepEqual(marked, ['is-vanish-exit']);
  assert.equal(state.activeThread.messages.length, 0);
  assert.equal(pending.shift().delay, 360);
  assert.equal(renders, 0);
});

test('vanishing messages hide notification and list previews while the ring and exit move from the requested corners', () => {
  const migration = read('database/migrations/20261121_149_vanishing_message_private_notification.sql');
  const css = read('css/app.css');
  assert.match(migration, /when v_msg\.vanish_after_seconds is not null then coalesce\(nullif\(btrim\(v_sender\.full_name\), ''\), 'Someone'\) \|\| ' set a message\.'/);
  assert.match(migration, /last_message_preview = v_notification_preview/);
  assert.equal((migration.match(/v_notif_type, v_notif_title, v_notification_preview/g) || []).length, 2);
  assert.match(migration, /coalesce\(v_conv\.title, 'Group Chat'\),\s*v_notification_preview/);
  assert.match(migration, /when latest\.vanish_after_seconds is not null then coalesce\(sender_p\.full_name, 'Someone'\) \|\| ' set a message\.'/);
  assert.match(css, /\.msg-bubble\.is-vanishing::after\s*\{[^}]*from var\(--vanish-start, 225deg\)/s);
  assert.match(css, /\.msg-row\.is-mine \.msg-bubble\.is-vanishing\s*\{ --vanish-start: 135deg; \}/);
  assert.match(css, /@keyframes msgVanishExit\s*\{[\s\S]*?100% \{ opacity: 0; transform: translateY\(18px\)/);
});

test('vanishing setting changes leave a named system notice in the conversation', () => {
  const migration = read('database/migrations/20261121_151_vanish_setting_events.sql');
  const schema = read('database/schema.sql');
  for (const sql of [migration, schema]) {
    assert.match(sql, /v_conv\.vanish_after_seconds is distinct from p_seconds/);
    assert.match(sql, /v_name \|\| case v_event[\s\S]*turned on vanishing messages for/);
    assert.match(sql, /when 'vanish_disabled' then ' turned off vanishing messages\.'/);
    assert.match(sql, /'SYSTEM', jsonb_build_object\('event', v_event\)/);
  }
  const chat = read('js/messages.js');
  assert.match(chat, /await openConversation\(conversationId, \{ markRead: false, silent: true, scrollToBottom: true \}\)/);
  assert.match(chat, /\['vanish_enabled', 'vanish_disabled', 'vanish_updated'\]\.includes\(m\.metadata\?\.event\)/);
  assert.match(chat, /vanishNotice \? ' is-vanish'/);
  assert.match(read('css/app.css'), /\.msg-system-event\.is-vanish span/);
});

test('vanish countdown starts at the actual lower bubble corner at different aspect ratios', () => {
  const source = read('js/messages.js');
  const fn = source.match(/function positionVanishRing\(bubble, width = bubble\.offsetWidth, height = bubble\.offsetHeight\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn);
  const positionVanishRing = new Function(`${fn}; return positionVanishRing;`)();
  for (const [mine, expected] of [[false, '255.96deg'], [true, '104.04deg']]) {
    let actual;
    const bubble = {
      offsetWidth: 200,
      offsetHeight: 50,
      closest: () => mine,
      style: { setProperty: (name, value) => { assert.equal(name, '--vanish-start'); actual = value; } }
    };
    positionVanishRing(bubble);
    assert.equal(actual, expected);
  }
  assert.match(source, /vanishRingObserver\?\.disconnect\(\);[\s\S]*?vanishRingObserver\?\.observe\(bubble\)/);
});

test('vanishing media uses constant-speed SVG border, protects maximized video until closed, and supports swipeable multi-image viewer', async () => {
  const messagesJs = read('js/messages.js');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  // 1) Constant-speed SVG perimeter ring for text, pictures, and videos
  assert.match(css, /\.msg-vanish-ring\s*\{[^}]*z-index:\s*6;[^}]*pointer-events:\s*none;/);
  assert.match(css, /\.msg-vanish-progress\s*\{[^}]*stroke-dasharray:\s*100 100;[^}]*animation:\s*msgVanishStroke var\(--vanish-remaining\) linear forwards;/);
  assert.match(css, /@keyframes msgVanishStroke\s*\{[\s\S]*?to\s*\{\s*stroke-dashoffset:\s*100;\s*\}/);
  assert.match(css, /\.msg-bubble\.has-top-media\.is-vanishing \.msg-vanish-progress\s*\{\s*stroke-width:\s*3;\s*\}/);
  assert.match(messagesJs, /function buildVanishRectPath\(/);
  assert.match(messagesJs, /--vanish-dash-start:/);

  const pathFn = messagesJs.match(/function buildVanishRectPath\([\s\S]*?\n  \}/)?.[0];
  const styleFn = messagesJs.match(/function vanishBubbleStyle\(message, now = Date\.now\(\)\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(pathFn && styleFn);
  const { buildVanishRectPath, vanishBubbleStyle } = new Function(`${pathFn}; ${styleFn}; return { buildVanishRectPath, vanishBubbleStyle };`)();
  const peerPath = buildVanishRectPath(220, 220, { mine: false, inset: 1.5 });
  const minePath = buildVanishRectPath(260, 150, { mine: true, inset: 1.5 });
  assert.match(peerPath, /^M 1\.5 /);
  assert.match(minePath, /^M 242\.5 148\.5 /);
  const t0 = Date.parse('2026-11-21T10:00:00.000Z');
  assert.match(vanishBubbleStyle({ vanish_after_seconds: 20, vanish_at: '2026-11-21T10:00:20.000Z' }, t0 + 5000), /--vanish-dash-start:25\.00/);

  // 2) Maximized vanishing video is NOT interrupted while #ipon-video-viewer is open, and vanishes immediately on close
  const schedulerSource = messagesJs.match(/function scheduleVanishExpiry\(\)\s*\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(schedulerSource);
  let now = Date.parse('2026-11-21T10:00:00.000Z');
  const pending = [];
  const marked = [];
  const videoViewerDialog = { open: true };
  const state = {
    activeConvId: 'conv-vid-1',
    activeVideoViewerMsgId: 'vid-msg-1',
    activeThread: {
      messages: [
        { id: 'vid-msg-1', vanish_at: new Date(now + 5000).toISOString() },
        { id: 'txt-msg-2', vanish_at: new Date(now + 5000).toISOString() }
      ]
    }
  };
  const list = { querySelector: (sel) => ({ classList: { add: (name) => marked.push(`${sel}:${name}`) } }) };
  const wrap = { scrollTop: 0, scrollHeight: 400, clientHeight: 200 };
  const schedule = new Function(
    'state', 'document', 'Date', 'setTimeout', 'clearTimeout', 'renderMessagesList',
    `let vanishUiTimer = null; ${schedulerSource}; return scheduleVanishExpiry;`
  )(
    state,
    {
      getElementById: (id) => {
        if (id === 'msg-messages-list') return list;
        if (id === 'ipon-video-viewer') return videoViewerDialog;
        return wrap;
      }
    },
    { now: () => now, parse: Date.parse },
    (fn, delay) => { pending.push({ fn, delay }); return pending.length; },
    () => {},
    () => {}
  );

  // While video is maximized, txt-msg-2 vanishes at 5s but vid-msg-1 stays untouched
  schedule();
  now += 5000;
  pending.shift().fn();
  assert.deepEqual(state.activeThread.messages.map((m) => m.id), ['vid-msg-1'], 'maximized vanishing video must remain while viewer is open');
  assert.deepEqual(marked, ['[data-msg-id="txt-msg-2"]:is-vanish-exit']);

  // User backs out of maximized video viewer -> video vanishes immediately
  pending.length = 0;
  videoViewerDialog.open = false;
  state.activeVideoViewerMsgId = null;
  schedule();
  const deferred = pending.shift();
  assert.equal(deferred.delay, 0, 'expired video schedules immediate vanish upon closing viewer');
  deferred.fn();
  assert.equal(state.activeThread.messages.length, 0, 'expired video is removed once user backs out of viewer');
  assert.ok(marked.includes('[data-msg-id="vid-msg-1"]:is-vanish-exit'));

  // 3) Multi-image swipeable gallery inside openImageViewer
  assert.match(messagesJs, /const galleryHost = imgBtn\.closest\?\.\('\.msg-bubble, \.msg-drawer-media-grid, \.msg-upload-queue'\)/);
  assert.match(css, /\.image-viewer-nav\.is-prev\s*\{/);
  assert.match(css, /\.image-viewer-counter\s*\{/);

  const vm = await import('node:vm');
  const noop = () => {};
  let viewerDialog = null;
  const makeCls = () => {
    const s = new Set();
    return { add: (...a) => a.forEach((c) => s.add(c)), remove: (...a) => a.forEach((c) => s.delete(c)), toggle: (c, f) => (f === undefined ? (s.has(c) ? s.delete(c) : s.add(c)) : (f ? s.add(c) : s.delete(c))), contains: (c) => s.has(c) };
  };
  const makeNode = (id = '') => {
    const listeners = new Map();
    return {
      id,
      className: '',
      classList: makeCls(),
      dataset: {},
      style: {},
      hidden: false,
      disabled: false,
      open: false,
      textContent: '',
      src: '',
      alt: '',
      href: '',
      download: '',
      naturalWidth: 800,
      naturalHeight: 600,
      showModal() { this.open = true; },
      close() { this.open = false; },
      setAttribute: noop,
      removeAttribute: noop,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 700 }),
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      _emit(ev, obj = {}) {
        (listeners.get(ev) || []).forEach((fn) => fn({ preventDefault: noop, stopPropagation: noop, ...obj }));
      }
    };
  };
  const subNodes = {
    '#ipon-iv-stage': makeNode('ipon-iv-stage'),
    '#ipon-iv-img': makeNode('ipon-iv-img'),
    '#ipon-iv-title': makeNode('ipon-iv-title'),
    '#ipon-iv-subtitle': makeNode('ipon-iv-subtitle'),
    '#ipon-iv-download': makeNode('ipon-iv-download'),
    '#ipon-iv-close': makeNode('ipon-iv-close'),
    '#ipon-iv-prev': makeNode('ipon-iv-prev'),
    '#ipon-iv-next': makeNode('ipon-iv-next'),
    '#ipon-iv-counter': makeNode('ipon-iv-counter')
  };
  const coreCtx = {
    console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, URL, URLSearchParams,
    requestAnimationFrame: (cb) => { cb(); return 1; },
    location: { pathname: '/dashboard.html', href: 'https://myipon.app/dashboard.html', origin: 'https://myipon.app', search: '', hash: '' },
    navigator: { userAgent: 'Android', onLine: true },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { replaceState: noop },
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    document: {
      documentElement: { setAttribute: noop, dataset: {}, classList: makeCls() },
      body: { dataset: {}, classList: makeCls(), appendChild: (el) => { viewerDialog = el; return el; }, insertAdjacentHTML: noop },
      head: { appendChild: noop, insertAdjacentHTML: noop },
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: (id) => (id === 'ipon-image-viewer' ? viewerDialog : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => {
        const el = makeNode('ipon-image-viewer');
        el.querySelector = (sel) => subNodes[sel] || null;
        return el;
      }
    },
    supabase: { createClient: () => ({ rpc: async () => ({ data: null }), from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }), auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }) }, channel: () => ({ on() { return this; }, subscribe: noop }) }) }
  };
  coreCtx.window = coreCtx;
  coreCtx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, coreCtx, { filename: 'js/core.js' });

  const gallery = [
    { src: 'https://cdn.example/p1.jpg', title: 'Photo 1', downloadName: 'p1.jpg' },
    { src: 'https://cdn.example/p2.jpg', title: 'Photo 2', downloadName: 'p2.jpg' },
    { src: 'https://cdn.example/p3.jpg', title: 'Photo 3', downloadName: 'p3.jpg' }
  ];
  coreCtx.window.Ipon.openImageViewer(gallery[0].src, gallery[0].title, '', gallery[0].downloadName, { gallery, index: 0 });
  assert.equal(subNodes['#ipon-iv-img'].src, 'https://cdn.example/p1.jpg');
  assert.equal(subNodes['#ipon-iv-counter'].textContent, '1 / 3');
  assert.equal(subNodes['#ipon-iv-counter'].hidden, false);
  assert.equal(subNodes['#ipon-iv-prev'].disabled, true);
  assert.equal(subNodes['#ipon-iv-next'].disabled, false);

  // Swipe left on stage -> moves to Photo 2
  const stage = subNodes['#ipon-iv-stage'];
  stage._emit('touchstart', { target: stage, touches: [{ clientX: 280, clientY: 300 }] });
  stage._emit('touchmove', { target: stage, touches: [{ clientX: 160, clientY: 305 }] });
  stage._emit('touchend', { target: stage, touches: [] });
  assert.equal(subNodes['#ipon-iv-img'].src, 'https://cdn.example/p2.jpg');
  assert.equal(subNodes['#ipon-iv-counter'].textContent, '2 / 3');
  assert.equal(subNodes['#ipon-iv-title'].textContent, 'Photo 2');

  // Swipe right on stage -> moves back to Photo 1
  stage._emit('touchstart', { target: stage, touches: [{ clientX: 100, clientY: 300 }] });
  stage._emit('touchmove', { target: stage, touches: [{ clientX: 220, clientY: 302 }] });
  stage._emit('touchend', { target: stage, touches: [] });
  assert.equal(subNodes['#ipon-iv-img'].src, 'https://cdn.example/p1.jpg');
  assert.equal(subNodes['#ipon-iv-counter'].textContent, '1 / 3');

  // Next arrow button -> moves to Photo 2
  subNodes['#ipon-iv-next']._emit('click');
  assert.equal(subNodes['#ipon-iv-img'].src, 'https://cdn.example/p2.jpg');
  assert.equal(subNodes['#ipon-iv-counter'].textContent, '2 / 3');
});
