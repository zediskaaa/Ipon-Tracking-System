import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('rapid chat sends keep request order and refresh once after the burst', async () => {
  const source = fs.readFileSync('js/messages.js', 'utf8').replace(/\r\n/g, '\n');
  const queueSource = source.match(/  function queuePendingMessage\(pending\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(queueSource, 'chat send queue exists');

  const pending = [1, 2, 3].map((n) => ({ localId: String(n), conversationId: 'chat-1', status: 'queued' }));
  const inFlight = new Map();
  const started = [];
  let threadRefreshes = 0;
  let listRefreshes = 0;
  const queue = new Function(
    'sendTailByConv', 'findPendingItem', 'processPendingMessage', 'getPendingList',
    'state', 'openConversation', 'refreshConversations',
    `${queueSource}; return queuePendingMessage;`
  )(
    new Map(),
    (_, id) => pending.find((item) => item.localId === id),
    (item) => {
      started.push(item.localId);
      return new Promise((resolve) => inFlight.set(item.localId, () => { item.status = 'sent'; resolve(); }));
    },
    () => pending,
    { activeConvId: 'chat-1' },
    async () => { threadRefreshes += 1; },
    async () => { listRefreshes += 1; }
  );

  pending.forEach(queue);
  await Promise.resolve();
  assert.deepEqual(started, ['1']);
  inFlight.get('1')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['1', '2']);
  inFlight.get('2')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ['1', '2', '3']);
  assert.equal(threadRefreshes, 0);
  inFlight.get('3')();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(threadRefreshes, 1);
  assert.equal(listRefreshes, 1);
});

test('incoming message bursts cannot postpone realtime refresh indefinitely', () => {
  const source = fs.readFileSync('js/messages.js', 'utf8').replace(/\r\n/g, '\n');
  assert.match(source, /const flushRefresh = async \(\) => \{\s*refreshTimer = null;/);
  const scheduleSource = source.match(/    const scheduleRefresh = \(opts = \{\}\) => \{[\s\S]*?\n    \};/)?.[0];
  assert.ok(scheduleSource, 'realtime refresh scheduler exists');

  let timer = null;
  let refreshes = 0;
  const schedule = new Function(
    'setTimeout', 'refreshTimerRef', 'pendingRefresh', 'flushRefresh',
    `let refreshTimer = refreshTimerRef.value; ${scheduleSource}; return (opts) => { scheduleRefresh(opts); refreshTimerRef.value = refreshTimer; };`
  )(
    (callback, delay) => { timer = { callback, delay }; return timer; },
    { value: null },
    { convs: false, thread: false, markRead: false, forceMarkRead: false, overview: false, alerts: false },
    () => { refreshes += 1; }
  );

  schedule({ thread: true });
  const firstTimer = timer;
  schedule({ thread: true });
  schedule({ thread: true });
  assert.equal(timer, firstTimer, 'new messages must keep the first refresh deadline');
  assert.equal(timer.delay, 240);
  timer.callback();
  assert.equal(refreshes, 1);
});

test('confirmed bursts clear pending bubbles even when older sends fall outside the 60-message page', () => {
  const source = fs.readFileSync('js/messages.js', 'utf8').replace(/\r\n/g, '\n');
  const pruneSource = source.match(/    \/\/ Prune any pending message[\s\S]*?    const pendingList = getPendingList\(conv\.conversation_id\);/)?.[0];
  assert.ok(pruneSource, 'pending reconciliation exists');

  const conversationId = 'chat-1';
  const pendingByConv = new Map([[conversationId, [
    ...Array.from({ length: 65 }, (_, index) => ({
      localId: `local-${index}`,
      serverMessageId: `sent-${index}`,
      status: 'sent'
    })),
    { localId: 'retry', status: 'failed' }
  ]]]);
  const reconcile = new Function('state', 'conv', 'msgs', 'getPendingList', `${pruneSource};`);
  reconcile(
    { pendingByConv },
    { conversation_id: conversationId },
    Array.from({ length: 60 }, (_, index) => ({ id: `sent-${index + 5}` })),
    (id) => pendingByConv.get(id) || []
  );
  assert.deepEqual(pendingByConv.get(conversationId).map((item) => item.localId), ['retry']);
});

test('chat sends avoid dashboard reloads, silent refreshes skip redundant protection roundtrips, and chat notifications sync the active thread', () => {
  const core = fs.readFileSync('js/core.js', 'utf8');
  const messages = fs.readFileSync('js/messages.js', 'utf8');

  // Chat/social RPCs must not trigger full dashboard BroadcastChannel reloads
  assert.match(core, /READ_ONLY_RPC_RE\s*=.*send_chat_message.*mark_conversation_read.*mark_messages_delivered/);
  // Incoming SOCIAL_* notifications route straight to IponMessages instead of reloading the dashboard
  assert.match(core, /incomingType\.startsWith\('SOCIAL_'\)[\s\S]*?IponMessages\?\.onIncomingSocialNotification\?\.\(match\)/);
  // Background dashboard errors must not show timeout toasts over an open Messages dialog
  assert.match(core, /if \(document\.getElementById\('msg-workspace-dialog'\)\?\.open\) return;/);

  // Silent same-thread refreshes skip redundant reportClientPlatform + get_conversation_protection calls
  assert.match(messages, /const shouldFetchProtection = refreshProtection !== null/);
  // Realtime flush refreshes active thread in parallel with sidebar and heals on channel errors
  assert.match(messages, /function onIncomingSocialNotification\(notif\)/);
  assert.match(messages, /status === 'CHANNEL_ERROR' \|\| status === 'TIMED_OUT' \|\| status === 'CLOSED'/);
  assert.match(messages, /window\.IponMessages = \{[\s\S]*?onIncomingSocialNotification,/);

  // Smooth bottom-to-top entrance animation triggers only for fresh live messages (no double-bounce on pending confirmation)
  const css = fs.readFileSync('css/app.css', 'utf8');
  assert.match(messages, /prePrunePendingServerIds[\s\S]*?const isFreshLiveMsg = \(m\) => Boolean\([\s\S]*?!prePrunePendingServerIds\.has\(String\(m\.id\)\)/);
  assert.match(messages, /renderPendingRowHtml\(pending, \{ animateEnter: true \}\)/);
  assert.match(css, /\.msg-row\.is-msg-enter,\s*\.msg-system-event\.is-msg-enter\s*\{[^}]*animation:\s*msgRowRiseIn/s);
  assert.match(css, /@keyframes\s+msgRowRiseIn\s*\{[\s\S]*?translate3d\(0,\s*18px,\s*0\)/);
  assert.match(css, /@keyframes\s+msgBubbleRisePop\s*\{/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.msg-row\.is-msg-enter,/);
});
