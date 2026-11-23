import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(p, 'utf8');

test('migration 191 optimizes get_conversations and get_conversation_messages without per-row definer fan-out', () => {
  const mig = read('database/migrations/20261123_191_optimize_chat_rpcs_performance.sql');
  const schema = read('database/schema.sql');

  for (const sql of [mig, schema]) {
    assert.match(sql, /'20261123_191'/);
    assert.match(sql, /create or replace function public\.get_conversations_unmasked\(\)/i);
    assert.match(sql, /create or replace function public\.get_conversations\(\)/i);
    assert.match(sql, /create or replace function public\.get_conversation_messages_unmasked\(/i);
  }

  const unmaskedConvs = mig.match(/create or replace function public\.get_conversations_unmasked\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(unmaskedConvs, /with my_friends as/i);
  assert.match(unmaskedConvs, /my_blocks as/i);
  assert.match(unmaskedConvs, /unread_counts as/i);
  assert.doesNotMatch(unmaskedConvs, /public\.are_friends\(/i, 'get_conversations_unmasked must use my_friends CTE instead of per-row are_friends');
  assert.doesNotMatch(unmaskedConvs, /public\.is_user_blocked_between\(/i, 'get_conversations_unmasked must use my_blocks CTE instead of per-row is_user_blocked_between');

  const convsWrapper = mig.match(/create or replace function public\.get_conversations\(\)[\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(convsWrapper, /v_creator_id uuid/);
  assert.doesNotMatch(convsWrapper, /public\.is_creator_messaging_account\(/i, 'get_conversations must resolve creator id once instead of per-row');
  assert.doesNotMatch(convsWrapper, /public\.is_user_blocked_between\(/i, 'get_conversations must reuse peer.is_blocked instead of re-querying blocked_users per row');

  const unmaskedMsgs = mig.match(/create or replace function public\.get_conversation_messages_unmasked\([\s\S]*?\$\$;/i)?.[0] || '';
  assert.match(unmaskedMsgs, /sender_meta as/i);
  assert.match(unmaskedMsgs, /replies_map as/i);
  assert.match(unmaskedMsgs, /receipts_agg as/i);
  assert.match(unmaskedMsgs, /attachments_agg as/i);
  assert.match(unmaskedMsgs, /reactions_agg as/i);

  // Permissions preserved
  assert.match(mig, /revoke all on function public\.get_conversations_unmasked\(\) from public, anon, authenticated;/i);
  assert.match(mig, /revoke all on function public\.get_conversation_messages_unmasked\(uuid, timestamptz, integer, uuid\) from public, anon, authenticated;/i);
  assert.match(mig, /grant execute on function public\.get_conversations\(\) to authenticated;/i);
});

test('messages.js stops Realtime CLOSED reconnect storms, coalesces overlapping RPCs, and throttles foreground sync', async () => {
  const src = read('js/messages.js');
  const meId = '11111111-1111-4111-8111-111111111111';
  const convId = '22222222-2222-4222-8222-222222222222';

  // Source guards
  assert.match(src, /const staleChannel = realtimeChannel;\s*realtimeChannel = null;\s*try \{ client\.removeChannel\(staleChannel\)/);
  assert.match(src, /if \(ch !== realtimeChannel\) return;/);
  assert.match(src, /let refreshConversationsInFlight = null;/);
  assert.match(src, /const silentOpenInFlight = new Map\(\);/);
  assert.match(src, /if \(!force && nowMs - lastForegroundSyncAt < 2500\) return;/);

  // Runtime harness verifying removeChannel -> CLOSED does NOT loop and concurrent calls coalesce
  const channels = [];
  const docListeners = new Map();
  const winListeners = new Map();
  const timers = [];
  let nowMs = 10_000;
  let getConvsCount = 0;
  let getMsgsCount = 0;
  let markDeliveredCount = 0;
  let resolveConvsPending = null;
  let resolveMsgsPending = null;

  const makeEl = (id = '') => ({
    id,
    open: id === 'msg-workspace-dialog',
    hidden: false,
    value: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    style: { setProperty() { }, removeProperty() { } },
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    setAttribute() { },
    getAttribute: () => null,
    removeAttribute() { },
    addEventListener() { },
    removeEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus() { },
    showModal() { this.open = true; },
    close() { this.open = false; },
    replaceChildren() { },
    insertAdjacentHTML() { },
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 }),
    scrollHeight: 100,
    clientHeight: 100,
    scrollTop: 0
  });
  const els = new Map([['msg-workspace-dialog', makeEl('msg-workspace-dialog')]]);

  const fakeClient = {
    getChannels: () => channels.slice(),
    channel(topic) {
      const ch = {
        topic: `realtime:${topic}`,
        state: 'joining',
        statusCb: null,
        on() { return this; },
        subscribe(cb) {
          this.statusCb = cb;
          this.state = 'joined';
          cb?.('SUBSCRIBED');
          return this;
        },
        send: async () => 'ok',
        untrack: async () => { },
        track: async () => { }
      };
      channels.push(ch);
      return ch;
    },
    removeChannel(ch) {
      const idx = channels.indexOf(ch);
      if (idx >= 0) channels.splice(idx, 1);
      ch.state = 'closed';
      // Simulate real Supabase client emitting CLOSED when a channel is removed!
      ch.statusCb?.('CLOSED');
      return Promise.resolve('ok');
    }
  };

  const doc = {
    visibilityState: 'visible',
    body: makeEl('body'),
    documentElement: makeEl('html'),
    activeElement: null,
    hasFocus: () => true,
    getElementById: (id) => els.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag),
    addEventListener(ev, fn) {
      if (!docListeners.has(ev)) docListeners.set(ev, []);
      docListeners.get(ev).push(fn);
    },
    removeEventListener() { }
  };

  const win = {
    location: { href: 'https://my-ipon.vercel.app/dashboard.html', search: '', pathname: '/dashboard.html', hash: '' },
    navigator: { onLine: true, userAgent: 'TestAgent' },
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener(ev, fn) {
      if (!winListeners.has(ev)) winListeners.set(ev, []);
      winListeners.get(ev).push(fn);
    },
    removeEventListener() { },
    matchMedia: () => ({ matches: false, addEventListener() { } }),
    Ipon: {
      client: fakeClient,
      profile: { id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Tester' },
      escapeHtml: (s) => String(s ?? ''),
      avatarMarkup: () => '',
      bindAvatarFallbacks() { },
      syncMessagesBadges() { },
      friendlyError: (e) => e?.message || 'Error',
      toast() { },
      async rpc(name) {
        if (name === 'get_conversations') {
          getConvsCount += 1;
          if (resolveConvsPending) return new Promise((r) => { resolveConvsPending.push(() => r([])); });
          return [];
        }
        if (name === 'get_social_overview') {
          return { me: { id: meId, chat_privacy: {} }, friends: [], incoming_requests: [], sent_requests: [], blocked_users: [] };
        }
        if (name === 'get_conversation_messages') {
          getMsgsCount += 1;
          if (resolveMsgsPending) return new Promise((r) => { resolveMsgsPending.push(() => r({ conversation: { conversation_id: convId, kind: 'DIRECT' }, messages: [], pinned_messages: [], has_older: false })); });
          return { conversation: { conversation_id: convId, kind: 'DIRECT' }, messages: [], pinned_messages: [], has_older: false };
        }
        if (name === 'mark_messages_delivered') {
          markDeliveredCount += 1;
          return 0;
        }
        return null;
      }
    }
  };
  win.window = win;

  const FakeDate = class extends Date {
    static now() { return nowMs; }
  };

  vm.runInNewContext(src, {
    window: win, document: doc, location: win.location, navigator: win.navigator,
    Ipon: win.Ipon, Date: FakeDate, URL, URLSearchParams, Map, Set, Promise, console,
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    requestAnimationFrame: (fn) => fn(),
    cancelAnimationFrame() { },
    setTimeout(fn, ms) {
      const entry = { id: timers.length + 1, fn, ms, cleared: false };
      timers.push(entry);
      return entry.id;
    },
    clearTimeout(id) {
      const t = timers.find((x) => x.id === id);
      if (t) t.cleared = true;
    },
    setInterval: () => 0,
    clearInterval() { }
  }, { filename: 'js/messages.js' });

  await win.IponMessages.init({ id: meId, role: 'MEMBER', status: 'ACTIVE', full_name: 'Tester' });
  assert.equal(channels.length, 1, 'init creates exactly one realtime channel');
  const firstChannel = channels[0];
  const initialConvs = getConvsCount;

  // Simulate ONE network drop on the active channel -> schedules ONE reconnect timer
  firstChannel.statusCb('TIMED_OUT');
  const pendingReconnect = timers.filter((t) => !t.cleared && t.ms >= 2000);
  assert.equal(pendingReconnect.length, 1, 'TIMED_OUT should schedule exactly one reconnect timer');

  // Run the reconnect timer: removeChannel(firstChannel) emits CLOSED synchronously!
  // With the bug, CLOSED on firstChannel scheduled ANOTHER reconnect timer infinitely.
  // With the fix, CLOSED on stale firstChannel MUST be ignored and schedule ZERO reconnect timers.
  pendingReconnect[0].cleared = true;
  pendingReconnect[0].fn();

  const loopTimers = timers.filter((t) => !t.cleared && t.ms >= 2000);
  assert.equal(loopTimers.length, 0, 'removing the previous channel must NOT schedule another reconnect loop');
  assert.equal(channels.length, 1, 'old channel must be removed and replaced cleanly');

  // Verify rapid focus + visibilitychange + resume events within 2.5s only fire ONE foreground sync
  nowMs += 5000;
  const deliveredBefore = markDeliveredCount;
  (docListeners.get('resume') || []).forEach((fn) => fn());
  (docListeners.get('visibilitychange') || []).forEach((fn) => fn());
  (winListeners.get('focus') || []).forEach((fn) => fn());
  assert.equal(markDeliveredCount - deliveredBefore, 1, 'rapid resume+visibility+focus must throttle to 1 sync');
  await new Promise((r) => setTimeout(r, 0));

  // Verify concurrent refreshWorkspace calls coalesce overlapping get_conversations calls
  resolveConvsPending = [];
  const beforeCoalesce = getConvsCount;
  const p1 = win.IponMessages.refreshWorkspace();
  const p2 = win.IponMessages.refreshWorkspace();
  assert.equal(getConvsCount - beforeCoalesce, 1, 'concurrent get_conversations calls must coalesce into 1 RPC');
  resolveConvsPending.forEach((r) => r());
  resolveConvsPending = null;
  await Promise.all([p1, p2]);
  assert.ok(initialConvs >= 1);
  assert.equal(getMsgsCount, 0);
});

test('core.js stages background boot tasks behind setLoading(false) and cleans nonced realtime topics; dashboard.js deduplicates boot permissions and overlapping loads', () => {
  const core = read('js/core.js');
  const dash = read('js/dashboard.js');

  assert.match(core, /function schedulePostReadyBoot\(task, fallbackMs = 1200\)/);
  assert.match(core, /function flushPostReadyBootTasks\(\)/);
  assert.match(core, /schedulePostReadyBoot\(startShellBackgroundServices, 1200\)/);
  assert.match(core, /startsWith\(`\$\{targetTopic\}:`\)/, 'createRealtimeChannel must clean previously nonced channels');

  assert.match(dash, /let initialLoadCompleted = false;/);
  assert.match(dash, /let dashboardLoadPromise = null;/);
  assert.match(dash, /const shouldRefreshPerms = initialLoadCompleted && typeof Ipon\.refreshMyPermissions === 'function';/);
});
