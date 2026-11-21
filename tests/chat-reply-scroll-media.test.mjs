import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('replying to scrolled-up media or messages preserves scroll position across focus, keyboard resize, and send sync', () => {
  const js = read('js/messages.js');

  const helperNear = js.match(/  function isThreadNearBottom\([^)]*\) \{[\s\S]*?\n  \}/)?.[0];
  const helperAuto = js.match(/  function shouldAutoScrollOnComposer\(\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(helperNear, 'expected isThreadNearBottom helper');
  assert.ok(helperAuto, 'expected shouldAutoScrollOnComposer helper');

  // At bottom -> auto-scroll allowed (even during keyboard resize while sticky)
  const runAuto = (stateObj, wrapObj) => new Function(
    'state', 'document',
    `${helperNear}\n${helperAuto}\nreturn shouldAutoScrollOnComposer();`
  )(stateObj, { getElementById: (id) => (id === 'msg-scroll-wrap' ? wrapObj : null) });

  assert.equal(
    runAuto({ threadStickyBottom: true, replyToMsg: null, editingMsg: null }, { scrollHeight: 2000, scrollTop: 1550, clientHeight: 450 }),
    true
  );
  // Scrolled up on older media -> auto-scroll blocked
  assert.equal(
    runAuto({ threadStickyBottom: false, replyToMsg: { id: 'm-photo' }, editingMsg: null }, { scrollHeight: 2000, scrollTop: 320, clientHeight: 450 }),
    false
  );
  // Replying to an older message even if sticky flag wasn't cleared yet -> auto-scroll blocked
  assert.equal(
    runAuto({ threadStickyBottom: true, replyToMsg: { id: 'm-photo' }, editingMsg: null }, { scrollHeight: 2000, scrollTop: 320, clientHeight: 450 }),
    false
  );

  // startReplyToMessage locks scrollTop and uses preventScroll focus
  assert.match(js, /function startReplyToMessage\(msgObj\)[\s\S]*?const wasNearBottom = isThreadNearBottom\(wrap\);[\s\S]*?focus\(\{ preventScroll: true \}\)/);
  assert.match(js, /function startReplyToMessage\(msgObj\)[\s\S]*?if \(!wasNearBottom && wrap && typeof lockedScrollTop === 'number'\)/);

  // Sending a reply while scrolled up keeps scroll position through pending render and post-send sync
  assert.match(js, /const keepScroll = Boolean\(preserveScroll \|\| \(replyToMsg && \(state\.threadStickyBottom === false \|\| !isThreadNearBottom\(wrap\)\)\)\);/);
  assert.match(js, /const keepScroll = sentItems\.some\(\(item\) => item\.preserveScroll\) \|\| state\.threadStickyBottom === false;/);
  assert.match(js, /openConversation\(convId, \{ markRead: false, silent: true, scrollToBottom: !keepScroll \}\)/);
});

test('chat media renders immediately with eager preloading, signed URL TTL/retry recovery, and smooth blur-up reveal', () => {
  const js = read('js/messages.js');
  const css = read('css/app.css');

  // No lazy loading on chat images so scrolled-up photos start loading right away
  assert.doesNotMatch(js, /<img src="\$\{escAttr\(url\)\}" alt="\$\{safeName\}" loading="lazy">/);
  assert.doesNotMatch(js, /<img src="\$\{escAttr\(item\.previewUrl\)\}" alt="\$\{safeName\}" loading="lazy">/);

  // Eager image preloading, TTL cache check, and in-place hydration/retry
  assert.match(js, /SIGNED_URL_TTL_MS/);
  assert.match(js, /function getCachedSignedUrl\(path\)/);
  assert.match(js, /function preloadSignedImageUrls\(urls = \[\]\)/);
  assert.match(js, /function hydrateThreadMediaElements\(container, conversationId\)/);
  assert.match(js, /msg-att-image\$\{isReady \? ' is-img-loaded' : ' is-img-loading'\}/);
  assert.match(js, /class="msg-video-player" data-vid-state="\$\{hasPoster \? 'ready' : 'loading'\}"/);
  assert.match(js, /hydrateThreadMediaElements\(list, conv\.conversation_id\);/);

  // Smooth blur-to-clear CSS transitions for both images and videos (light & dark themes)
  assert.match(css, /\.msg-att-image\.is-img-loading::before\s*\{[\s\S]*?filter:\s*blur\(18px\)/);
  assert.match(css, /\.msg-att-image\.is-img-loading img\s*\{[\s\S]*?filter:\s*blur\(18px\)/);
  assert.match(css, /\.msg-att-image\.is-img-loaded img\s*\{[\s\S]*?filter:\s*blur\(0\)/);
  assert.match(css, /\.msg-video-player\[data-vid-state="loading"\] \.msg-att-video\s*\{[\s\S]*?filter:\s*blur\(14px\)/);
  assert.match(css, /\.msg-video-player\[data-vid-state="ready"\] \.msg-att-video\s*\{[\s\S]*?filter:\s*blur\(0\)/);
});
