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

  const drawerEl = { hidden: true, innerHTML: '' };
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
    'state', 'document', 'escapeHtml', 'escAttr', 'formatBytes', 'formatShortDate', 'userAvatarHtml',
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
    '', '', '', '', '', /\.(png|jpe?g|gif|webp)$/i
  );

  renderDrawer();
  assert.match(drawerEl.innerHTML, /Shared media[\s\S]*?<span class="msg-drawer-nav-count">1<\/span>/);
  assert.match(drawerEl.innerHTML, /Shared files[\s\S]*?<span class="msg-drawer-nav-count">1<\/span>/);

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
  assert.match(swJs, /ipon-shell-v(?:2[3-9]|[3-9]\d)/);
  assert.match(dashboardHtml, /js\/messages\.js\?v=20261118-35/);
});
