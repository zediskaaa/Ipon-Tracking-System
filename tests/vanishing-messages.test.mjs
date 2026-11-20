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
  assert.doesNotMatch(source, /1\?3600|1\?\$\{max\}/);
  assert.match(css, /@property --vanish-angle/);
  assert.match(css, /#4aaeff/);
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
