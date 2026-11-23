import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function createDomStub(initialPage = 'dashboard') {
  const byId = new Map();
  const docListeners = new Map();
  const winListeners = new Map();

  const makeClassList = (initial = []) => {
    const set = new Set(initial);
    return {
      add: (...cls) => cls.forEach((c) => set.add(c)),
      remove: (...cls) => cls.forEach((c) => set.delete(c)),
      toggle: (c, force) => (force === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : (force ? set.add(c) : set.delete(c))),
      contains: (c) => set.has(c)
    };
  };

  function makeEl(tag = 'div') {
    const listeners = new Map();
    let _id = '';
    const el = {
      tagName: String(tag).toUpperCase(),
      get id() { return _id; },
      set id(v) {
        if (_id) byId.delete(_id);
        _id = String(v || '');
        if (_id) byId.set(_id, el);
      },
      className: '',
      innerHTML: '',
      textContent: '',
      hidden: false,
      disabled: false,
      open: false,
      isConnected: true,
      dataset: {},
      attributes: {},
      style: { setProperty() {}, removeProperty() {} },
      classList: makeClassList(),
      children: [],
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      removeAttribute(k) { delete this.attributes[k]; },
      appendChild(child) {
        this.children.push(child);
        if (child?.id) byId.set(child.id, child);
        return child;
      },
      prepend(child) {
        this.children.unshift(child);
        if (child?.id) byId.set(child.id, child);
        return child;
      },
      remove() {
        this.isConnected = false;
        this.open = false;
        if (this.id) byId.delete(this.id);
      },
      showModal() { this.open = true; },
      close() {
        this.open = false;
        this._emit('close');
      },
      focus() {},
      insertAdjacentHTML() {},
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
      _emit(type, ev = { type, target: el, preventDefault() {}, stopPropagation() {} }) {
        for (const fn of [...(listeners.get(type) || [])]) fn(ev);
      },
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const targetId = sel.slice(1);
          if (byId.has(targetId)) return byId.get(targetId);
          if (this.innerHTML.includes(`id="${targetId}"`)) {
            const stub = makeEl('div');
            stub.id = targetId;
            return stub;
          }
        }
        return null;
      },
      querySelectorAll() { return []; }
    };
    return el;
  }

  let openDialogQuery = null;
  let busyQuery = null;

  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    activeElement: null,
    documentElement: { dataset: {}, style: { setProperty() {}, removeProperty() {} }, classList: makeClassList() },
    body: {
      dataset: { page: initialPage },
      classList: makeClassList(['security-page']),
      children: [],
      insertAdjacentHTML() {},
      appendChild(child) {
        this.children.push(child);
        if (child?.id) byId.set(child.id, child);
        return child;
      },
      prepend(child) {
        this.children.unshift(child);
        if (child?.id) byId.set(child.id, child);
        return child;
      }
    },
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => {
      if (sel === 'dialog[open]') return openDialogQuery;
      if (sel.includes('aria-busy')) return busyQuery;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { docListeners.get(type)?.delete(fn); },
    _emit(type, ev = { type }) {
      for (const fn of [...(docListeners.get(type) || [])]) fn(ev);
    },
    _setOpenDialog(val) { openDialogQuery = val; },
    _setBusy(val) { busyQuery = val; }
  };

  return {
    doc,
    byId,
    winListeners,
    emitWin(type, ev = { type }) {
      for (const fn of [...(winListeners.get(type) || [])]) fn(ev);
    }
  };
}

function createCoreAndPolicyVm({ initialNowMs, rpcHandler, effectsApi = null } = {}) {
  let fakeNow = initialNowMs ?? Date.parse('2026-11-23T22:15:00+08:00');
  const timers = new Map();
  let nextTimerId = 1;
  const lsStore = new Map();
  const dom = createDomStub('dashboard');

  const fakeClient = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    rpc: async (fnName, args) => {
      if (typeof rpcHandler === 'function') return rpcHandler(fnName, args);
      return { data: null, error: null };
    }
  };

  const sandbox = {
    window: null,
    document: dom.doc,
    navigator: { onLine: true, userAgent: 'Mozilla/5.0' },
    location: { protocol: 'https:', origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '', href: 'https://my-ipon.vercel.app/dashboard.html' },
    localStorage: {
      getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
      setItem: (k, v) => lsStore.set(k, String(v)),
      removeItem: (k) => lsStore.delete(k)
    },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date: class FakeDate extends Date {
      constructor(...args) { super(...(args.length ? args : [fakeNow])); }
      static now() { return fakeNow; }
      static parse(v) { return Date.parse(v); }
    },
    URL, URLSearchParams, Map, Set, Object, Array, String, Number, Boolean, Math, JSON, Promise, RegExp, Error, Intl, Blob, Uint8Array, atob,
    setTimeout: (fn, delay = 0) => {
      const id = nextTimerId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: () => 1,
    clearInterval: () => {},
    requestAnimationFrame: (fn) => fn(),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    addEventListener(type, fn) {
      if (!dom.winListeners.has(type)) dom.winListeners.set(type, new Set());
      dom.winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { dom.winListeners.get(type)?.delete(fn); },
    IPON_CONFIG: { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'eyJtest-anon-key' },
    supabase: { createClient: () => fakeClient },
    IponProfileEffects: effectsApi,
    console
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  vm.runInNewContext(read('js/core.js'), sandbox, { filename: 'js/core.js' });
  vm.runInNewContext(read('js/policy.js'), sandbox, { filename: 'js/policy.js' });

  return {
    Ipon: sandbox.Ipon,
    IponPolicy: sandbox.IponPolicy,
    dom,
    lsStore,
    setNow: (ms) => { fakeNow = ms; },
    flushTimers: () => {
      const batch = [...timers.entries()];
      timers.clear();
      for (const [, entry] of batch) entry.fn();
    },
    timerCount: () => timers.size
  };
}

test('policy deferral suppresses popup for existing users throughout Nov 23, 2026 Asia/Manila, expires automatically at midnight Nov 24, never writes fake acceptance, and preserves mandatory first-time consent', () => {
  const rpcCalls = [];
  const env = createCoreAndPolicyVm({
    initialNowMs: Date.parse('2026-11-23T23:59:59+08:00'),
    rpcHandler: async (fnName, args) => {
      rpcCalls.push({ fnName, args });
      return { data: null, error: null };
    }
  });

  // 1. Existing user who previously accepted 2026-11-16 -> deferred on Nov 23 PHT
  const existingUser = {
    id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Maria Clara',
    role: 'MEMBER',
    policy_accepted_version: '2026-11-16',
    policy_accepted_at: '2026-11-16T08:00:00Z'
  };

  assert.equal(env.IponPolicy.hasAcceptedCurrentPolicy(existingUser), false, 'Must NOT mark current policy accepted during deferral');
  assert.equal(env.IponPolicy.isPolicyConsentDeferredNow(existingUser, Date.parse('2026-11-23T00:00:00+08:00')), true);
  assert.equal(env.IponPolicy.isPolicyConsentDeferredNow(existingUser, Date.parse('2026-11-23T23:59:59+08:00')), true);
  assert.equal(env.IponPolicy.maybeShowPolicyConsentModal(existingUser), false, 'Popup must be deferred on Nov 23 PHT');
  assert.equal(env.dom.doc.getElementById('ipon-policy-consent-dialog'), null);
  assert.equal(existingUser.policy_accepted_version, '2026-11-16', 'Must NEVER write false policy_accepted_version');
  assert.equal(env.lsStore.get(`ipon_policy_accepted_${existingUser.id}`), undefined, 'Must NEVER write fake localStorage acceptance');
  assert.equal(rpcCalls.length, 0, 'Must NEVER call accept_current_policy automatically');

  // Voluntary policy dialog remains available during deferral
  assert.equal(env.IponPolicy.openPolicyDialog('privacy'), true);
  assert.ok(env.dom.doc.getElementById('ipon-policy-dialog'));
  env.dom.doc.getElementById('ipon-policy-dialog').close();

  // 2. Exact midnight Nov 24, 2026 00:00:00+08:00 -> expires automatically, but waits if form/dialog is busy
  env.setNow(Date.parse('2026-11-24T00:00:00+08:00'));
  assert.equal(env.IponPolicy.isPolicyConsentDeferredNow(existingUser), false, 'Deferral must expire at 12:00 a.m. Nov 24 Asia/Manila');

  // Simulate user typing in an active input -> must NOT interrupt
  env.dom.doc.activeElement = { tagName: 'INPUT' };
  env.flushTimers();
  assert.equal(env.dom.doc.getElementById('ipon-policy-consent-dialog'), null, 'Must not interrupt active input');

  // Simulate another open dialog -> must NOT interrupt
  env.dom.doc.activeElement = null;
  env.dom.doc._setOpenDialog({ open: true });
  env.flushTimers();
  assert.equal(env.dom.doc.getElementById('ipon-policy-consent-dialog'), null, 'Must not interrupt open dialog');

  // Simulate busy financial action / upload -> must NOT interrupt
  env.dom.doc._setOpenDialog(null);
  env.dom.doc._setBusy({ tagName: 'BUTTON' });
  env.flushTimers();
  assert.equal(env.dom.doc.getElementById('ipon-policy-consent-dialog'), null, 'Must not interrupt busy submit/upload');

  // Safe opportunity arrives -> deferred consent prompt appears automatically without reload
  env.dom.doc._setBusy(null);
  env.flushTimers();
  const shownDlg = env.dom.doc.getElementById('ipon-policy-consent-dialog');
  assert.ok(shownDlg, 'Consent modal must appear at next safe opportunity after midnight Nov 24 PHT');
  assert.equal(shownDlg.open, true);
  shownDlg.remove();

  // 3. Brand-new user with NO prior acceptance -> first-time consent is NEVER bypassed even on Nov 23 PHT
  env.setNow(Date.parse('2026-11-23T14:00:00+08:00'));
  const brandNewUser = {
    id: '22222222-2222-4222-8222-222222222222',
    full_name: 'Jose Rizal',
    role: 'MEMBER',
    policy_accepted_version: null,
    policy_accepted_at: null
  };
  assert.equal(env.IponPolicy.isPolicyConsentDeferredNow(brandNewUser), false, 'First-time consent user must NOT be deferred');
  assert.equal(env.IponPolicy.maybeShowPolicyConsentModal(brandNewUser), true, 'First-time consent modal must still show on Nov 23 PHT');
  assert.ok(env.dom.doc.getElementById('ipon-policy-consent-dialog'));
});

test('openMemberProfileDialog loads by stable user ID with 60s caching, renders equipped profile effect without duplicate loops, and handles unlinked/restricted/expired cases cleanly', async () => {
  const rpcCalls = [];
  const mountedStages = [];
  let destroyedCount = 0;

  const fakeEffectsApi = {
    normalizeEffectId: (id) => {
      const clean = String(id || '').trim();
      return ['aurora_pulse', 'none'].includes(clean) ? clean : 'none';
    },
    getEffect: (id) => (id === 'aurora_pulse' ? { id: 'aurora_pulse', name: 'Aurora Pulse' } : null),
    mountStage: (hostEl, opts) => {
      const rec = { hostEl, effectId: opts.effectId, refreshed: 0, destroyed: false };
      mountedStages.push(rec);
      return {
        refreshGeometry() { rec.refreshed += 1; },
        destroy() { rec.destroyed = true; destroyedCount += 1; }
      };
    },
    stopEffectSfx() {}
  };

  const targetUserId = '33333333-3333-4333-8333-333333333333';
  const hiddenUserId = '44444444-4444-4444-8444-444444444444';
  const expiredEffectUserId = '55555555-5555-4555-8555-555555555555';

  const env = createCoreAndPolicyVm({
    effectsApi: fakeEffectsApi,
    rpcHandler: async (fnName, args) => {
      rpcCalls.push({ fnName, args });
      if (fnName === 'get_group_member_profile') {
        if (args.p_target_id === targetUserId) {
          return {
            data: {
              profile_visible: true,
              id: targetUserId,
              full_name: 'Elena Reyes',
              username: 'elena_r',
              bio: 'Saving steadily every month.',
              avatar_url: 'https://woslmwokhhyszkgevnli.supabase.co/storage/v1/object/public/avatars/elena.webp',
              group_role: 'MEMBER',
              group_name: 'Family Ipon',
              card_theme: 'ocean',
              cover_url: null,
              equipped_profile_effect: 'aurora_pulse',
              verified_badge_tier: 'BLUE',
              verified_badge_granted_at: '2026-11-10T00:00:00Z',
              social_links: {}
            },
            error: null
          };
        }
        if (args.p_target_id === hiddenUserId) {
          return { data: { profile_visible: false }, error: null };
        }
        if (args.p_target_id === expiredEffectUserId) {
          return {
            data: {
              profile_visible: true,
              id: expiredEffectUserId,
              full_name: 'Carlos Mendoza',
              username: 'carlos_m',
              bio: '',
              avatar_url: null,
              group_role: 'TREASURER',
              group_name: 'Family Ipon',
              card_theme: 'emerald',
              cover_url: null,
              equipped_profile_effect: 'unknown_expired_fx',
              verified_badge_tier: 'NONE',
              social_links: {}
            },
            error: null
          };
        }
      }
      return { data: null, error: null };
    }
  });

  // 1. Contributor WITHOUT associated user profile -> zero RPC calls, graceful notice
  await env.Ipon.openMemberProfileDialog('', { fullName: 'Manual Member', avatarUrl: '' });
  assert.equal(rpcCalls.length, 0, 'Unlinked contributor must not call RPC');
  const unlinkedHost = env.dom.doc.getElementById('member-profile-stage-host');
  assert.match(unlinkedHost.innerHTML, /does not have a linked myIPON user profile yet/i);
  assert.equal(mountedStages.length, 0);

  // 2. Linked contributor with active equipped effect -> 1 RPC call, mounts single stage
  await env.Ipon.openMemberProfileDialog(targetUserId, { fullName: 'Elena Reyes' });
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].fnName, 'get_group_member_profile');
  assert.equal(rpcCalls[0].args.p_target_id, targetUserId);
  assert.equal(mountedStages.length, 1);
  assert.equal(mountedStages[0].effectId, 'aurora_pulse');
  const hostEl = env.dom.doc.getElementById('member-profile-stage-host');
  assert.match(hostEl.innerHTML, /Elena Reyes/);
  assert.match(hostEl.innerHTML, /@elena_r/);
  assert.match(hostEl.innerHTML, /Aurora Pulse/);

  // 3. Re-opening same profile within 60s uses cache (no duplicate RPC) and destroys previous stage cleanly
  await env.Ipon.openMemberProfileDialog(targetUserId, { fullName: 'Elena Reyes' });
  assert.equal(rpcCalls.length, 1, 'Cached profile must not trigger duplicate RPC within 60s');
  assert.equal(mountedStages[0].destroyed, true, 'Previous stage must be destroyed before mounting replacement');
  assert.equal(mountedStages.length, 2);

  // 4. Restricted / out-of-group profile -> graceful notice, no effect mounted
  await env.Ipon.openMemberProfileDialog(hiddenUserId, { fullName: 'Other User' });
  assert.equal(rpcCalls.length, 2);
  assert.equal(mountedStages[1].destroyed, true);
  assert.equal(mountedStages.length, 2, 'Restricted profile must not mount any effect');
  assert.match(env.dom.doc.getElementById('member-profile-stage-host').innerHTML, /not visible in your current workspace/i);

  // 5. Missing photo + unavailable/expired effect -> initials fallback, zero effect stage mounted
  await env.Ipon.openMemberProfileDialog(expiredEffectUserId, { fullName: 'Carlos Mendoza' });
  assert.equal(rpcCalls.length, 3);
  assert.equal(mountedStages.length, 2, 'Unavailable/expired effect must fall back cleanly to none');
  assert.match(env.dom.doc.getElementById('member-profile-stage-host').innerHTML, /<span>CM<\/span>/);
  assert.ok(destroyedCount >= 2);
});

test('calendar and day-details use real contributor data, English copy, mobile-visible clickable avatars, mixed status bars, and group-scoped SQL migration 196', () => {
  const dashboardJs = read('js/dashboard.js');
  const dashboardHtml = read('dashboard.html');
  const heroCss = read('css/hero-plates.css');
  const appCss = read('css/app.css');
  const mig196 = read('database/migrations/20261123_196_group_member_readonly_profile.sql');
  const schema = read('database/schema.sql');

  // No demo/reference leakage (Filipino labels, Google Fonts, demo DATA)
  for (const text of [dashboardJs, dashboardHtml, heroCss]) {
    assert.doesNotMatch(text, /Nobyembre|Halo-halong|fonts\.googleapis\.com|Linggo|Miyerkules/i);
  }

  // Stable UUID link for contributor profiles (never name-matched for userId)
  assert.match(dashboardJs, /groupProfileByMemberId = new Map/);
  assert.match(dashboardJs, /function summarizeDayActivities\(activities\)/);
  assert.match(dashboardJs, /class="day-avatar-btn"/);
  assert.match(dashboardJs, /class="day-modal-avatar-btn"/);
  assert.match(dashboardJs, /event\.stopPropagation\(\)/);
  assert.match(dashboardJs, /Ipon\.openMemberProfileDialog\?\./);
  assert.match(dashboardJs, /class="day-segs"/);
  assert.match(dashboardJs, /person\.userId \? \(Ipon\.verifiedBadgesHtml\?\.\(person\.userId\) \|\| ''\) : ''/);

  // No nested <button> inside <button> on calendar days
  assert.match(dashboardJs, /<div class="\$\{classes\}" role="button" tabindex="0" data-date="/);

  // Mobile keeps .day-avatars visible (never display:none)
  const mobileBlock = heroCss.slice(heroCss.indexOf('@media (max-width:860px)'));
  assert.doesNotMatch(mobileBlock, /\.day-avatars\s*\{[^}]*display\s*:\s*none/);
  assert.match(mobileBlock, /\.day-avatars\s*\{[^}]*grid-column:\s*1 \/ -1;/);
  assert.match(heroCss, /html\[data-theme="dark"\] \.calendar-board\s*\{/);
  assert.match(appCss, /\.member-profile-close\s*\{[\s\S]*?border-radius:\s*50%;/);

  // Migration 196 + schema.sql security & least-privilege contracts
  for (const sql of [mig196, schema]) {
    assert.match(sql, /create or replace function public\.get_group_member_profile\(p_target_id uuid\)/i);
    assert.match(sql, /'20261123_196'/);
    assert.match(sql, /is_valid_profile_effect_id\(v_effect\)/i);
    assert.match(sql, /effective_verified_badge_for_user\(/i);
    assert.match(sql, /revoke all on function public\.get_group_member_profile\(uuid\) from public, anon;/i);
    assert.match(sql, /grant execute on function public\.get_group_member_profile\(uuid\) to authenticated;/i);
  }
  const mig196NoComments = mig196.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(mig196NoComments, /\bCASCADE\b/i);
  assert.doesNotMatch(mig196NoComments, /'email'|'contact_number'|'payout_account_number'|'policy_accepted_/);
});

test('calendar day status summarization handles confirmed net, mixed statuses, pending-only days, and negative deductions accurately', () => {
  const dashboardJs = read('js/dashboard.js');
  const extractFn = (name) => {
    const start = dashboardJs.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    let depth = 0;
    let bodyStart = dashboardJs.indexOf('{', start);
    for (let i = bodyStart; i < dashboardJs.length; i += 1) {
      if (dashboardJs[i] === '{') depth += 1;
      else if (dashboardJs[i] === '}') {
        depth -= 1;
        if (depth === 0) return dashboardJs.slice(start, i + 1);
      }
    }
    throw new Error(`Unclosed ${name}`);
  };

  const sandbox = { Ipon: { money: (v) => `₱${Number(v || 0).toFixed(2)}` } };
  vm.runInNewContext([
    extractFn('statusClass'),
    extractFn('dayEventStatuses'),
    extractFn('formatCalendarTileAmount'),
    extractFn('summarizeDayActivities'),
    'this.out = { summarizeDayActivities, formatCalendarTileAmount };'
  ].join('\n'), sandbox);

  const { summarizeDayActivities, formatCalendarTileAmount } = sandbox.out;

  // Mixed day: confirmed +500, confirmed deduction -150, pending 300 -> confirmed net +350, pending NOT added to confirmed net
  const mixed = summarizeDayActivities([
    { activity_type: 'ADDITION', approval_status: 'CONFIRMED', amount: 500 },
    { activity_type: 'DEDUCTION', approval_status: 'CONFIRMED', amount: 150 },
    { activity_type: 'ADDITION', approval_status: 'PENDING', amount: 300 }
  ]);
  assert.equal(mixed.toneClass, 'is-mixed');
  assert.equal(mixed.sign, '+');
  assert.equal(mixed.amountClass, 'is-pos');
  assert.equal(mixed.displayAmount, 350);
  assert.equal(mixed.pendingTotal, 300);
  assert.equal(mixed.segments.length, 3);
  assert.equal(formatCalendarTileAmount(mixed.displayAmount), '₱350');

  // Pure deduction day -> negative sign & red tone
  const ded = summarizeDayActivities([
    { activity_type: 'DEDUCTION', approval_status: 'CONFIRMED', amount: 50 }
  ]);
  assert.equal(ded.toneClass, 'is-deduction');
  assert.equal(ded.sign, '−');
  assert.equal(ded.amountClass, 'is-neg');
  assert.equal(ded.displayAmount, 50);

  // Pure expense day with centavos -> preserves centavos
  const exp = summarizeDayActivities([
    { activity_type: 'EXPENSE', approval_status: 'CONFIRMED', amount: 150.75 }
  ]);
  assert.equal(exp.toneClass, 'is-expense');
  assert.equal(exp.sign, '−');
  assert.equal(formatCalendarTileAmount(exp.displayAmount), '₱150.75');

  // Pending-only day -> unsigned amber amount (never falsely marks as confirmed +)
  const pen = summarizeDayActivities([
    { activity_type: 'ADDITION', approval_status: 'PENDING', amount: 300 }
  ]);
  assert.equal(pen.toneClass, 'is-pending');
  assert.equal(pen.sign, '');
  assert.equal(pen.amountClass, 'is-pending');
  assert.equal(pen.displayAmount, 300);
});
