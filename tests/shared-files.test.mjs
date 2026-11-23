import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Shared files excludes voice notes and voice messages while counting and listing real documents', () => {
  const messagesJs = read('js/messages.js');
  const swJs = read('sw.js');
  const dashboardHtml = read('dashboard.html');

  // 1. detectAttachmentKind treats voice-note-* files (even without MIME) and .opus/.webm audio as 'audio'
  const winStub = {
    Ipon: { escapeHtml: (s) => String(s ?? ''), rpc: async () => [], client: null },
    addEventListener: () => { },
    location: { search: '', href: 'https://example.test/dashboard.html' }
  };
  winStub.window = winStub;
  vm.runInNewContext(messagesJs, {
    window: winStub,
    document: { documentElement: { dataset: {} }, body: {}, getElementById: () => null, querySelectorAll: () => [], addEventListener: () => { } },
    location: winStub.location,
    Map,
    Set,
    URLSearchParams,
    navigator: {},
    setInterval: () => 0,
    clearInterval: () => { }
  });
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'voice-note-179475601.webm', type: '' }), 'audio');
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'voice-note-179475602.webm', type: 'audio/webm' }), 'audio');
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'memo.opus', type: '' }), 'audio');
  assert.equal(winStub.IponMessages.detectAttachmentKind({ name: 'clip.webm', type: 'video/webm' }), 'video');

  // 2. renderThreadInfoDrawer excludes voice notes / audio messages from Shared files counts & list
  const isVoiceMatch = messagesJs.match(/function isVoiceAttachment\(att, msg = null\)\s*\{[\s\S]*?\n  \}/);
  const badgeMatch = messagesJs.match(/function formatBadgeLabel\(att\)\s*\{[\s\S]*?\n  \}/);
  const drawerMatch = messagesJs.match(/function renderThreadInfoDrawer\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(isVoiceMatch && badgeMatch && drawerMatch);

  const bodyEl = { scrollTop: 0 };
  const drawerEl = {
    hidden: true,
    dataset: {},
    _html: '',
    get innerHTML() { return this._html; },
    set innerHTML(value) { this._html = value; bodyEl.scrollTop = 0; },
    querySelector(selector) {
      return selector === '.msg-drawer-body.is-root' && this._html.includes('data-drawer-screen="root"') ? bodyEl : null;
    }
  };
  const state = {
    showThreadInfo: true,
    threadInfoView: 'root',
    activeConvId: 'c1',
    signedUrlCache: new Map(),
    activeThread: {
      conversation: { conversation_id: 'c1', id: 'u2', full_name: 'Friend', chat_theme: 'paper' },
      messages: [
        { id: 'm1', deleted_for_everyone_at: null, message_type: 'VOICE', created_at: '2026-11-15T10:00:00Z', attachments: [{ path: 'c1/vn1.webm', name: 'voice-note-179475601.webm', kind: 'audio', size: 84200, duration_seconds: 5 }] },
        { id: 'm2', deleted_for_everyone_at: null, message_type: 'TEXT', created_at: '2026-11-15T10:01:00Z', attachments: [{ path: 'c1/vn2.webm', name: 'voice-note-179475602.webm', kind: 'file', size: 195800 }] },
        { id: 'm3', deleted_for_everyone_at: null, message_type: 'VOICE', created_at: '2026-11-15T10:02:00Z', attachments: [{ path: 'c1/vn3.webm', name: 'clip-audio.mp3', kind: 'audio', type: 'audio/mpeg', size: 102700 }] },
        { id: 'm4', deleted_for_everyone_at: null, message_type: 'MEDIA', created_at: '2026-11-15T10:03:00Z', attachments: [{ path: 'c1/p1.jpg', name: 'receipt.jpg', kind: 'image', size: 42000 }, { path: 'c1/d1.pdf', name: 'budget-plan.pdf', kind: 'document', size: 64000 }] }
      ]
    }
  };
  const renderDrawer = new Function(
    'state', 'document', 'escapeHtml', 'escAttr', 'formatBytes', 'formatShortDate', 'userAvatarHtml', 'formatVanishDuration', 'isSelfUser',
    'MSG_CLOSE_X_SVG', 'MSG_PIN_SVG', 'BACK_ARROW_ICON_SVG', 'VIDEO_PLAY_SVG', 'VIDEO_POSTER_FALLBACK', 'IMAGE_EXT_RE',
    `${isVoiceMatch[0]}; ${badgeMatch[0]}; ${drawerMatch[0]}; return renderThreadInfoDrawer;`
  )(
    state,
    { getElementById: (id) => (id === 'msg-thread-drawer' ? drawerEl : null) },
    (s) => String(s ?? ''),
    (s) => String(s ?? ''),
    (b) => `${b} B`,
    () => 'Nov 15',
    () => '<div>avatar</div>',
    (seconds) => seconds ? `${seconds} seconds` : 'Off',
    () => false,
    '', '', '', '', '', /\.(png|jpe?g|gif|webp)$/i
  );

  renderDrawer();
  assert.match(drawerEl.innerHTML, /Shared media[\s\S]*?<span class="msg-drawer-nav-count">1<\/span>/);
  assert.match(drawerEl.innerHTML, /Shared files[\s\S]*?<span class="msg-drawer-nav-count">1<\/span>/);
  bodyEl.scrollTop = 240;
  renderDrawer();
  assert.equal(bodyEl.scrollTop, 240, 'refreshing the same conversation keeps the details scroll position');

  state.threadInfoView = 'files';
  renderDrawer();
  assert.match(drawerEl.innerHTML, /<h3>Shared files<\/h3>[\s\S]*?<span class="msg-drawer-head-count">1<\/span>/);
  assert.match(drawerEl.innerHTML, /budget-plan\.pdf/);
  assert.doesNotMatch(drawerEl.innerHTML, /voice-note-|clip-audio\.mp3/);

  // Only voice notes in thread -> Shared files shows 0 & empty state
  state.activeThread.messages = state.activeThread.messages.slice(0, 3);
  state.threadInfoView = 'root';
  renderDrawer();
  assert.match(drawerEl.innerHTML, /Shared files[\s\S]*?<span class="msg-drawer-nav-count">0<\/span>/);
  state.threadInfoView = 'files';
  renderDrawer();
  assert.match(drawerEl.innerHTML, /No shared files yet/);
  assert.match(swJs, /ipon-shell-v(?:2[3-9]|[3-9]\d|[1-9]\d{2,})/);
  assert.match(dashboardHtml, /js\/messages\.js\?v=20261123-20/);
});

test('Swipe-right-to-reply gesture and attachment source menu (Gallery, File Manager, Google Drive) work end-to-end', async () => {
  const messagesJs = read('js/messages.js');
  const appCss = read('css/app.css');
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const androidManifest = read('android/app/src/main/AndroidManifest.xml');

  // 1. Markup, CSS & Android contracts
  assert.match(messagesJs, /id="msg-attach-menu"[^>]*aria-label="Choose attachment source"/);
  assert.match(messagesJs, /data-attach-source="gallery"[\s\S]*Phone Gallery/);
  assert.match(messagesJs, /data-attach-source="files"[\s\S]*File Manager/);
  assert.match(messagesJs, /data-attach-source="gdrive"[\s\S]*Google Drive/);
  assert.match(messagesJs, /id="msg-gallery-input"[^>]*accept="image\/\*,video\/\*"/);
  assert.match(messagesJs, /id="msg-drive-input"[^>]*accept="\*\/\*"/);
  assert.match(messagesJs, /id="msg-gdrive-dialog"[\s\S]*href="https:\/\/drive\.google\.com\/drive\/my-drive"/);
  assert.doesNotMatch(messagesJs, /msg-gdrive-link-form|msg-gdrive-link-input|msg-gdrive-link-error/);
  assert.match(messagesJs, /class="msg-swipe-reply-badge"/);
  assert.match(appCss, /\.msg-row\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.match(appCss, /\.msg-swipe-reply-badge\s*\{/);
  assert.match(appCss, /\.msg-attach-menu\s*\{/);
  assert.match(appCss, /\.msg-gdrive-dialog\s*\{/);
  assert.match(androidManifest, /<queries>[\s\S]*com\.google\.android\.apps\.docs[\s\S]*com\.google\.android\.apps\.docs\.storage[\s\S]*<\/queries>/);
  assert.match(mainActivity, /addJavascriptInterface\(new PickerSourceBridge\(\),\s*"IponNativePicker"\)/);
  assert.match(mainActivity, /class PickerSourceBridge[\s\S]*@JavascriptInterface[\s\S]*public void setSource/);
  assert.match(mainActivity, /MediaStore\.ACTION_PICK_IMAGES/);
  assert.match(mainActivity, /com\.google\.android\.apps\.docs/);
  assert.match(mainActivity, /DocumentsContract\.EXTRA_INITIAL_URI/);
  assert.match(mainActivity, /com\.android\.externalstorage\.documents/);
  assert.match(mainActivity, /Intent\.ACTION_OPEN_DOCUMENT/);

  // 2. Live VM runtime flow for attachment menu & swipe-right-to-reply
  const listeners = new Map();
  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (...c) => c.forEach((x) => set.add(x)),
      remove: (...c) => c.forEach((x) => set.delete(x)),
      toggle: (c, f) => (f === undefined ? (set.has(c) ? (set.delete(c), false) : (set.add(c), true)) : (f ? set.add(c) : set.delete(c))),
      contains: (c) => set.has(c),
      _set: set
    };
  };
  const clickedInputs = [];
  const nativeSources = [];
  const openedImages = [];
  const styleProps = new Map();
  const msgRowEl = {
    dataset: { msgId: 'm-peer-1' },
    classList: makeClassList(['msg-row', 'is-peer']),
    style: {
      setProperty: (k, v) => styleProps.set(k, v),
      removeProperty: (k) => styleProps.delete(k)
    },
    closest: (sel) => (sel.includes('.msg-row') ? msgRowEl : null),
    querySelector: () => null
  };
  const attachMenuEl = { hidden: true, querySelector: () => null };
  const attachBtnEl = { dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, closest: (sel) => (sel === '#msg-attach-btn' ? attachBtnEl : null) };
  const emojiPopEl = { dataset: {}, hidden: true };
  const galleryInputEl = { id: 'msg-gallery-input', value: '', click: () => clickedInputs.push('msg-gallery-input') };
  const fileInputEl = { id: 'msg-file-input', value: '', click: () => clickedInputs.push('msg-file-input') };
  const driveInputEl = { id: 'msg-drive-input', value: '', click: () => clickedInputs.push('msg-drive-input') };
  const contextBarEl = { dataset: {}, hidden: true, innerHTML: '' };
  const uploadQueueEl = { dataset: {}, hidden: true, innerHTML: '', scrollWidth: 0, scrollLeft: 0 };
  const composerInputEl = { dataset: {}, focused: false, value: '', focus() { this.focused = true; }, style: {} };
  const msgListEl = { innerHTML: '', scrollTop: 0, scrollHeight: 0, clientHeight: 400 };
  const gdriveOpenWebEl = { focused: false, focus() { this.focused = true; } };
  const gdriveDlgEl = { id: 'msg-gdrive-dialog', open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const elements = {
    'msg-attach-menu': attachMenuEl,
    'msg-attach-btn': attachBtnEl,
    'msg-emoji-popover': emojiPopEl,
    'msg-gallery-input': galleryInputEl,
    'msg-file-input': fileInputEl,
    'msg-drive-input': driveInputEl,
    'msg-gdrive-dialog': gdriveDlgEl,
    'msg-gdrive-open-web': gdriveOpenWebEl,
    'msg-context-bar': contextBarEl,
    'msg-upload-queue': uploadQueueEl,
    'msg-composer-input': composerInputEl,
    'msg-messages-list': msgListEl,
    'msg-workspace-dialog': null
  };

  const toasts = [];
  const winStub = {
    Ipon: {
      escapeHtml: (s) => String(s ?? ''),
      friendlyError: (e) => String(e?.message || e),
      toast: (msg) => toasts.push(msg),
      bindAvatarFallbacks: () => { },
      syncPresenceDots: () => { },
      openImageViewer: (url) => openedImages.push(url),
      isUserOnline: () => false,
      rpc: async () => [],
      client: null
    },
    IponNativePicker: { setSource: (s) => nativeSources.push(s) },
    Capacitor: { isNativePlatform: () => true },
    addEventListener: () => { },
    removeEventListener: () => { },
    innerWidth: 390,
    innerHeight: 844,
    location: { search: '', href: 'https://example.test/dashboard.html' }
  };
  winStub.window = winStub;

  const docStub = {
    documentElement: { dataset: {} },
    body: { insertAdjacentHTML: () => { } },
    getElementById: (id) => elements[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    removeEventListener: () => { }
  };
  const emitDoc = async (evName, eventObj) => {
    for (const fn of listeners.get(evName) || []) {
      await fn(eventObj);
    }
  };

  // Inject test hook at tail of messagesJs IIFE only in sandbox to seed activeThread cleanly
  const patchedMessages = messagesJs.replace(
    'window.IponMessages = {',
    'window.IponMessages = { __setStateForTest(c, ms) { state.activeConvId = c.conversation_id; state.activeThread = { conversation: c, messages: ms, pinned_messages: [] }; initializedProfile = { id: "u-me", full_name: "Me" }; }, __getStateForTest() { return { replyToMsg: state.replyToMsg, queueLen: state.uploadQueue.length }; },'
  );
  const HostURL = URL;
  vm.runInNewContext(patchedMessages, {
    window: winStub,
    document: docStub,
    location: winStub.location,
    Map,
    Set,
    URLSearchParams,
    URL: class extends HostURL {
      static createObjectURL() { return 'blob:mock'; }
      static revokeObjectURL() { }
    },
    CSS: { escape: (x) => String(x) },
    navigator: {},
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => { }
  });

  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-peer-1', sender_id: 'u2', sender_name: 'Alice', body: 'Hello swipe test!', message_type: 'TEXT', created_at: '2026-11-18T10:00:00Z' }]
  );

  // Attachment menu flow: toggle open -> select Gallery -> File Manager -> Google Drive
  await emitDoc('click', {
    target: { closest: (sel) => (sel.includes('#msg-attach-btn') ? attachBtnEl : null) }
  });
  assert.equal(attachMenuEl.hidden, false);
  assert.equal(attachBtnEl.attrs['aria-expanded'], 'true');

  for (const [source, expectedInput] of [['gallery', 'msg-gallery-input'], ['files', 'msg-file-input'], ['gdrive', 'msg-drive-input']]) {
    attachMenuEl.hidden = false;
    const optNode = { dataset: { attachSource: source }, closest: (sel) => (sel.includes('[data-attach-source]') ? optNode : (sel.includes('#msg-attach-menu') ? attachMenuEl : null)) };
    await emitDoc('click', { target: optNode });
    assert.equal(attachMenuEl.hidden, true);
    assert.equal(nativeSources.at(-1), source);
    assert.equal(clickedInputs.at(-1), expectedInput);
  }

  // Selecting files from #msg-gallery-input queues into uploadQueue cleanly
  await emitDoc('change', {
    target: { id: 'msg-gallery-input', value: 'picked', files: [{ name: 'photo.jpg', type: 'image/jpeg', size: 12000 }] }
  });
  assert.equal(winStub.IponMessages.__getStateForTest().queueLen, 1);

  // Swipe right past threshold triggers startReplyToMessage and updates context bar
  const rowTarget = {
    closest: (sel) => (sel.includes('.msg-row') ? msgRowEl : null)
  };
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 80, clientY: 200, target: rowTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 136, clientY: 204, target: rowTarget });
  assert.equal(msgRowEl.classList.contains('is-swiping'), true);
  assert.equal(msgRowEl.classList.contains('is-swipe-ready'), true);
  assert.ok(parseFloat(styleProps.get('--swipe-x')) > 44);
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 1, clientX: 136, clientY: 204 });

  assert.equal(msgRowEl.classList.contains('is-swiping'), false);
  assert.equal(msgRowEl.classList.contains('is-swipe-ready'), false);
  assert.equal(winStub.IponMessages.__getStateForTest().replyToMsg?.id, 'm-peer-1');
  assert.equal(contextBarEl.hidden, false);
  assert.match(contextBarEl.innerHTML, /Replying to Alice/);
  assert.match(contextBarEl.innerHTML, /Hello swipe test!/);
  assert.equal(composerInputEl.focused, true);

  // A photo button and the video play surface also start the existing reply gesture.
  const imageButton = { dataset: { openImg: 'https://example.test/photo.jpg', imgName: 'photo.jpg' } };
  const imageTarget = { closest: (sel) => {
    if (sel.includes('.msg-row')) return msgRowEl;
    if (sel.includes('.msg-img-open-btn')) return imageButton;
    if (sel.startsWith('button, a')) return imageButton;
    if (sel.startsWith('[data-msg-id=')) return msgRowEl;
    if (sel === '[data-open-img]') return imageButton;
    return null;
  } };
  msgRowEl.dataset.msgId = 'm-photo';
  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-photo', sender_id: 'u2', sender_name: 'Alice', body: '', message_type: 'IMAGE', attachments: [{ kind: 'image' }] }]
  );
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 3, clientX: 80, clientY: 200, target: imageTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 3, clientX: 136, clientY: 204, target: imageTarget });
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 3, clientX: 136, clientY: 204 });
  assert.equal(winStub.IponMessages.__getStateForTest().replyToMsg?.id, 'm-photo');
  await emitDoc('click', { target: imageTarget });
  assert.equal(openedImages.length, 0, 'a swipe does not open the photo');
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 4, clientX: 80, clientY: 200, target: imageTarget });
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 4, clientX: 80, clientY: 200 });
  await emitDoc('click', { target: imageTarget });
  assert.equal(openedImages.at(-1), 'https://example.test/photo.jpg', 'a tap still opens the photo');

  // Multi-picture carousel (.msg-attachments.is-carousel):
  // 0) CSS enforces touch-action: pan-y so Chromium/WebView cannot steal horizontal swipes
  assert.match(appCss, /\.msg-attachments\.is-carousel\s*\{[^}]*touch-action:\s*pan-y;/s);
  assert.match(appCss, /\.msg-attachments\.is-carousel\.is-dragging\s*\{[^}]*scroll-snap-type:\s*none;/s);

  // 1) At scrollLeft = 0, swiping RIGHT immediately replies and suppresses ghost photo click
  const snappedTo = [];
  const carouselEl = {
    scrollLeft: 0,
    scrollWidth: 660,
    clientWidth: 260,
    clientHeight: 220,
    classList: makeClassList(['msg-attachments', 'is-carousel']),
    children: [{ offsetLeft: 0 }, { offsetLeft: 210 }, { offsetLeft: 420 }],
    scrollTo: (opts) => { snappedTo.push(opts?.left); carouselEl.scrollLeft = opts?.left ?? carouselEl.scrollLeft; }
  };
  const carouselPhotoTarget = { closest: (sel) => {
    if (sel.includes('.msg-attachments.is-carousel')) return carouselEl;
    if (sel.includes('.msg-row')) return msgRowEl;
    if (sel.includes('.msg-img-open-btn')) return imageButton;
    if (sel.startsWith('button, a')) return imageButton;
    if (sel.startsWith('[data-msg-id=')) return msgRowEl;
    if (sel === '[data-open-img]') return imageButton;
    return null;
  } };
  msgRowEl.dataset.msgId = 'm-multi-photo';
  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-multi-photo', sender_id: 'u2', sender_name: 'Alice', body: '', message_type: 'MEDIA', attachments: [{ kind: 'image' }, { kind: 'image' }, { kind: 'image' }] }]
  );
  let preventedCount = 0;
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 10, clientX: 80, clientY: 200, target: carouselPhotoTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 10, clientX: 140, clientY: 202, target: carouselPhotoTarget });
  await emitDoc('touchmove', { cancelable: true, preventDefault() { preventedCount += 1; }, touches: [{ identifier: 10, clientX: 140, clientY: 202 }], target: carouselPhotoTarget });
  assert.ok(preventedCount >= 1, 'touchmove prevents native horizontal overscroll during carousel reply swipe');
  assert.equal(msgRowEl.classList.contains('is-swipe-ready'), true, 'carousel rightward swipe locks into reply mode');
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 10, clientX: 140, clientY: 202 });
  assert.equal(winStub.IponMessages.__getStateForTest().replyToMsg?.id, 'm-multi-photo');
  const openedBeforeSwipeClick = openedImages.length;
  await emitDoc('click', { target: carouselPhotoTarget });
  assert.equal(openedImages.length, openedBeforeSwipeClick, 'carousel swipe suppresses ghost photo click');

  // 2) At scrollLeft = 0, swiping LEFT scrolls the carousel smoothly to next photos & snaps on release
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 11, clientX: 240, clientY: 200, target: carouselPhotoTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 11, clientX: 100, clientY: 200, target: carouselPhotoTarget });
  assert.equal(carouselEl.classList.contains('is-dragging'), true);
  assert.equal(carouselEl.scrollLeft, 140, 'leftward drag moves carousel scrollLeft 1:1 with finger');
  assert.equal(msgRowEl.classList.contains('is-swipe-ready'), false);
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 11, clientX: 100, clientY: 200 });
  assert.equal(carouselEl.classList.contains('is-dragging'), false);
  assert.equal(snappedTo.at(-1), 210, 'carousel snaps cleanly to picture 2');

  // 3) When scrolled mid-carousel (scrollLeft = 180), swiping RIGHT scrolls back to photo 1 and pulling past photo 1 seamlessly triggers reply
  carouselEl.scrollLeft = 180;
  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-multi-photo', sender_id: 'u2', sender_name: 'Alice', body: '', message_type: 'MEDIA', attachments: [{ kind: 'image' }, { kind: 'image' }, { kind: 'image' }] }]
  );
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 12, clientX: 60, clientY: 200, target: carouselPhotoTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 12, clientX: 160, clientY: 200, target: carouselPhotoTarget });
  assert.equal(carouselEl.scrollLeft, 80, 'rightward drag from photo 2 scrolls smoothly back toward photo 1');
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 12, clientX: 300, clientY: 200, target: carouselPhotoTarget });
  assert.equal(carouselEl.scrollLeft, 0, 'continuing right past photo 1 clamps scrollLeft at 0');
  assert.equal(msgRowEl.classList.contains('is-swipe-ready'), true, 'continuing right past photo 1 transitions into reply swipe');
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 12, clientX: 300, clientY: 200 });
  assert.equal(winStub.IponMessages.__getStateForTest().replyToMsg?.id, 'm-multi-photo');
  carouselEl.scrollLeft = 0;

  // 4) Document card (.msg-att-doc-btn) also supports swipe-right-to-reply
  const docBtn = {};
  const docTarget = { closest: (sel) => {
    if (sel.includes('.msg-row')) return msgRowEl;
    if (sel.includes('.msg-att-doc-btn')) return docBtn;
    if (sel.startsWith('button, a')) return docBtn;
    return null;
  } };
  msgRowEl.dataset.msgId = 'm-doc';
  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-doc', sender_id: 'u2', sender_name: 'Alice', body: '', message_type: 'FILE', attachments: [{ kind: 'file', name: 'budget.pdf' }] }]
  );
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 13, clientX: 80, clientY: 200, target: docTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 13, clientX: 140, clientY: 202, target: docTarget });
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 13, clientX: 140, clientY: 202 });
  assert.equal(winStub.IponMessages.__getStateForTest().replyToMsg?.id, 'm-doc');

  const videoControl = {};
  const videoTarget = { closest: (sel) => {
    if (sel.includes('.msg-row')) return msgRowEl;
    if (sel.includes('.msg-video-center-play')) return videoControl;
    if (sel.startsWith('button, a')) return videoControl;
    return null;
  } };
  msgRowEl.dataset.msgId = 'm-video';
  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-video', sender_id: 'u2', sender_name: 'Alice', body: '', message_type: 'VIDEO', attachments: [{ kind: 'video' }] }]
  );
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 5, clientX: 80, clientY: 200, target: videoTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 5, clientX: 136, clientY: 204, target: videoTarget });
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 5, clientX: 136, clientY: 204 });
  assert.equal(winStub.IponMessages.__getStateForTest().replyToMsg?.id, 'm-video');
  const seekTarget = { closest: (sel) => sel.includes('.msg-row') ? msgRowEl : (sel.startsWith('button, a') ? videoControl : null) };
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 6, clientX: 80, clientY: 200, target: seekTarget });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 6, clientX: 136, clientY: 204, target: seekTarget });
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 6, clientX: 136, clientY: 204 });
  assert.equal(msgRowEl.classList.contains('is-swipe-ready'), false, 'video controls stay dedicated to playback');

  // Small jitter / vertical scroll does NOT change replyToMsg
  winStub.IponMessages.__setStateForTest(
    { conversation_id: 'c1', id: 'u2', full_name: 'Alice', kind: 'DIRECT', status: 'ACCEPTED', is_blocked: false },
    [{ id: 'm-peer-2', sender_id: 'u2', sender_name: 'Alice', body: 'Second message', message_type: 'TEXT', created_at: '2026-11-18T10:01:00Z' }]
  );
  const row2 = {
    dataset: { msgId: 'm-peer-2' },
    classList: makeClassList(['msg-row', 'is-peer']),
    style: { setProperty: () => { }, removeProperty: () => { } },
    closest: () => row2,
    querySelector: () => null
  };
  await emitDoc('pointerdown', { pointerType: 'touch', pointerId: 2, clientX: 80, clientY: 200, target: { closest: (s) => (s.includes('.msg-row') ? row2 : null) } });
  await emitDoc('pointermove', { pointerType: 'touch', pointerId: 2, clientX: 86, clientY: 245, target: row2 });
  await emitDoc('pointerup', { pointerType: 'touch', pointerId: 2, clientX: 86, clientY: 245 });
  assert.equal(row2.classList.contains('is-swipe-ready'), false);

  // Web/Desktop Google Drive option (without IponNativePicker) opens #msg-gdrive-dialog cleanly
  delete winStub.IponNativePicker;
  const clicksBeforeWebDrive = clickedInputs.length;
  attachMenuEl.hidden = false;
  const webDriveOpt = {
    dataset: { attachSource: 'gdrive' },
    closest: (sel) => (sel.includes('[data-attach-source]') ? webDriveOpt : (sel.includes('#msg-attach-menu') ? attachMenuEl : null))
  };
  await emitDoc('click', { target: webDriveOpt });
  assert.equal(gdriveDlgEl.open, true);
  assert.equal(gdriveOpenWebEl.focused, true);
  assert.equal(clickedInputs.length, clicksBeforeWebDrive, 'Web gdrive option opens chooser dialog instead of generic file picker');

  // Browse device inside dialog falls back to #msg-drive-input cleanly
  gdriveDlgEl.open = true;
  await emitDoc('click', { target: { closest: (sel) => (sel.includes('#msg-gdrive-browse-local') ? {} : null) } });
  assert.equal(gdriveDlgEl.open, false);
  assert.equal(clickedInputs.at(-1), 'msg-drive-input');
});
