import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function runCoreInVm(mockRpc) {
  const coreJs = read('js/core.js');
  const appendedNodes = [];
  const noop = () => {};
  const makeEl = (tag = 'div') => {
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      hidden: false,
      disabled: false,
      open: false,
      innerHTML: '',
      textContent: '',
      dataset: {},
      style: { setProperty: noop, removeProperty: noop },
      classList: { contains: () => false, add: noop, remove: noop, toggle: noop },
      setAttribute: noop,
      removeAttribute: noop,
      querySelector(sel) {
        if (sel === '#ipon-badge-award-ack') {
          if (!el._ackBtn) {
            el._ackBtn = makeEl('button');
            el._ackBtn.id = 'ipon-badge-award-ack';
          }
          return el._ackBtn;
        }
        return makeEl();
      },
      querySelectorAll: () => [],
      addEventListener(type, fn) {
        listeners.set(type, fn);
      },
      removeEventListener: noop,
      showModal() { el.open = true; },
      close() { el.open = false; },
      remove: noop,
      getBoundingClientRect: () => ({ left: 100, top: 100, right: 130, bottom: 118, width: 30, height: 18 }),
      listeners
    };
    return el;
  };

  const docListeners = new Map();
  const storage = new Map();
  const ctx = {
    console,
    Date,
    Math,
    URL,
    URLSearchParams,
    Intl,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    Promise,
    JSON,
    RegExp,
    CustomEvent: class CustomEvent { constructor(t, d) { this.type = t; this.detail = d?.detail; } },
    setTimeout,
    clearTimeout,
    location: { href: 'https://my-ipon.vercel.app/dashboard.html', pathname: '/dashboard.html', search: '', hash: '', origin: 'https://my-ipon.vercel.app' },
    history: { replaceState: noop },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    navigator: {},
    requestAnimationFrame: (fn) => fn(),
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    document: {
      documentElement: { setAttribute: noop, dataset: {}, style: { setProperty: noop, removeProperty: noop } },
      head: { insertAdjacentHTML: noop },
      body: {
        dataset: {},
        classList: { contains: () => false, add: noop, remove: noop, toggle: noop },
        insertAdjacentHTML: noop,
        appendChild(node) { appendedNodes.push(node); return node; },
        prepend: noop,
        append: noop
      },
      createElement: (tag) => makeEl(tag),
      addEventListener(evt, fn) {
        if (!docListeners.has(evt)) docListeners.set(evt, []);
        docListeners.get(evt).push(fn);
      },
      removeEventListener: noop,
      getElementById: (id) => appendedNodes.find((n) => n.id === id) || null,
      querySelectorAll: () => [],
      querySelector: () => null
    },
    supabase: {
      createClient: () => ({
        rpc: mockRpc,
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null }) }) }) }),
        auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }) },
        channel: () => ({ on() { return this; }, subscribe: noop })
      })
    }
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  return { ipon: ctx.window.Ipon, appendedNodes, docListeners };
}

test('verified badges migration configures schema, permanent creator badges, RPCs, and silent removal', () => {
  const sql = read('database/migrations/20261118_111_verified_badges.sql');
  assert.match(sql, /add column if not exists verified_badge_tier text not null default 'NONE'/i);
  assert.match(sql, /add column if not exists verified_badge_expires_at timestamptz/i);
  assert.match(sql, /add column if not exists verified_badge_message text/i);
  assert.match(sql, /add column if not exists verified_badge_acknowledged_at timestamptz/i);
  assert.match(sql, /create or replace function public\.effective_verified_badge\(/i);
  assert.match(sql, /breadspanish231@gmail\.com/);
  assert.match(sql, /verified_badge_tier = 'CREATOR_GREEN'/);
  assert.match(sql, /create or replace function public\.get_active_verified_badges\(/i);
  assert.match(sql, /create or replace function public\.super_admin_grant_verified_badge\(/i);
  assert.match(sql, /create or replace function public\.super_admin_remove_verified_badge\(/i);
  assert.match(sql, /create or replace function public\.acknowledge_my_verified_badge\(/i);
  assert.match(sql, /verified_badge_acknowledged_at = null/);
  assert.match(sql, /verified_badge_acknowledged_at = now\(\)/);
  assert.match(sql, /'BADGE_GRANTED'/);
  assert.match(sql, /'BADGE_REMOVED'/);
  assert.match(sql, /create or replace function public\.get_social_user_profile\(p_target_id uuid\)/i);
  assert.match(sql, /'verified_badge',\s*public\.effective_verified_badge\(/);
});

test('verified badge SVGs distinguish Creator dual green from regular Blue seal with transparent backgrounds', () => {
  const { ipon } = runCoreInVm(async () => ({ data: null, error: null }));

  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'CREATOR_GREEN', verified_badge_expires_at: null }), 'CREATOR_GREEN');
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'BLUE', verified_badge_expires_at: future }), 'BLUE');
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'BLUE', verified_badge_expires_at: past }), 'NONE');

  const creatorHtml = ipon.verifiedBadgesHtml({ id: 'u-creator', verified_badge_tier: 'CREATOR_GREEN' });
  const creatorSvgCount = (creatorHtml.match(/<svg /g) || []).length;
  assert.equal(creatorSvgCount, 2, 'Creator badge pair must include Green white-check seal and Minimalist Crown SVGs');
  assert.match(creatorHtml, /#15a025/);
  assert.match(creatorHtml, /#4f46e5/);
  assert.match(creatorHtml, /stroke="#ffffff"/);
  assert.doesNotMatch(creatorHtml, /#fbbf24|#fde047|#141821/i, 'Creator badges must not be yellow or black-centered');
  assert.match(creatorHtml, /shape-rendering="geometricPrecision"/);
  assert.match(creatorHtml, /data-verified-tier="CREATOR_GREEN"/, 'Creator badge must support interactive hover & click info');
  assert.doesNotMatch(creatorHtml, /aria-label="[^"]*Verified/i, 'Creator badge label must not call it Verified');
  assert.doesNotMatch(creatorHtml, /<rect[^>]*width="24"/i, 'Badge SVGs must have zero white square background rects');

  const blueHtml = ipon.verifiedBadgesHtml({ id: 'u-blue', verified_badge_tier: 'BLUE' });
  const blueSvgCount = (blueHtml.match(/<svg /g) || []).length;
  assert.equal(blueSvgCount, 1, 'Regular verified user must only get the single blue check seal');
  assert.match(blueHtml, /#1d9bf0/);
  assert.doesNotMatch(blueHtml, /verified-badge-creator-star/);

  assert.equal(ipon.verifiedBadgesHtml({ id: 'u-expired', verified_badge_tier: 'BLUE', verified_badge_expires_at: past }), '');
});

test('first-open badge celebration modal pops up once with confetti, creator message, and Thank you button', async () => {
  const rpcCalls = [];
  const { ipon, appendedNodes } = runCoreInVm(async (fn) => {
    rpcCalls.push(fn);
    return { data: { acknowledged_at: '2026-11-18T12:00:00Z' }, error: null };
  });

  // Does not open if already acknowledged or NONE tier
  assert.equal(ipon.maybeShowBadgeAwardModal({ id: 'u1', role: 'MEMBER', verified_badge_tier: 'NONE', verified_badge_acknowledged_at: null }), false);
  assert.equal(ipon.maybeShowBadgeAwardModal({ id: 'u1', role: 'MEMBER', verified_badge_tier: 'BLUE', verified_badge_acknowledged_at: '2026-11-18T10:00:00Z' }), false);

  // Opens once for active unacknowledged recipient
  const shown = ipon.maybeShowBadgeAwardModal({
    id: 'u1',
    role: 'MEMBER',
    full_name: 'Sample Member',
    verified_badge_tier: 'BLUE',
    verified_badge_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    verified_badge_message: 'Thank you for leading your group consistently!',
    verified_badge_acknowledged_at: null
  });
  assert.equal(shown, true);
  assert.equal(appendedNodes.length, 1);

  const modal = appendedNodes[0];
  assert.equal(modal.open, true);
  assert.match(modal.innerHTML, /Congratulations!/);
  assert.match(modal.innerHTML, /badge-confetti-stage/);
  assert.match(modal.innerHTML, /Message from creator/);
  assert.match(modal.innerHTML, /Thank you for leading your group consistently!/);
  assert.match(modal.innerHTML, /automatically removed if your account stays inactive for 2 months/i);
  assert.match(modal.innerHTML, /Thank you<\/button>/);

  const ackClick = modal.querySelector('#ipon-badge-award-ack').listeners.get('click');
  assert.equal(typeof ackClick, 'function');
  await ackClick();
  assert.ok(rpcCalls.includes('acknowledge_my_verified_badge'), 'Thank you button must acknowledge the award via RPC');
  assert.equal(modal.open, false);
});

test('Super Admin Badges tab, messages integration, and CSS contracts are complete and balanced', () => {
  const html = read('super-admin.html');
  const superAdminJs = read('js/super-admin.js');
  const messagesJs = read('js/messages.js');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  // Balanced <dialog> tags & unique IDs in super-admin.html
  const openDialogs = (html.match(/<dialog\b/g) || []).length;
  const closeDialogs = (html.match(/<\/dialog>/g) || []).length;
  assert.equal(openDialogs, closeDialogs);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs found in super-admin.html');

  assert.match(coreJs, /\['badges',\s*'super-admin\.html#badges',\s*'Badges'/);
  assert.match(html, /id="badges"[^>]*data-platform-view="badges"/);
  assert.match(html, /id="badge-grant-dialog"/);
  assert.match(html, /id="badge-remove-dialog"/);
  assert.match(superAdminJs, /super_admin_grant_verified_badge/);
  assert.match(superAdminJs, /super_admin_remove_verified_badge/);
  assert.match(superAdminJs, /renderBadges/);

  // Messages surface integration & announcement badge exclusion
  assert.doesNotMatch(coreJs, /announcement-author[^>]*>\$\{escapeHtml\(name\)\}\$\{verifiedBadgesHtml/);
  assert.match(messagesJs, /function userBadgesHtml\(/);
  assert.match(messagesJs, /msg-conv-bottom-meta/);
  assert.match(messagesJs, /id="msg-pop-name">\$\{escapeHtml\(profile\.full_name\)\}\$\{userBadgesHtml\(profile\)\}/);
  assert.match(messagesJs, /msg-sender-name">\$\{escapeHtml\(senderUser\.full_name\)\}\$\{userBadgesHtml\(senderUser\)\}/);

  // CSS badge & confetti rules
  assert.match(css, /\.verified-badge-svg\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;[^}]*background:\s*transparent !important/);
  assert.match(css, /@keyframes badgeConfettiFall/);
  assert.match(css, /\.verified-badge-tooltip\s*\{/);
  assert.match(css, /\.badge-celebrate-policy-note\s*\{/);
  assert.match(css, /\.msg-conv-bottom-meta\s*\{/);
});

test('2-month inactivity rule and verified-since hover tooltip work across SQL and runtime', () => {
  const mig112 = read('database/migrations/20261118_112_verified_badge_inactivity_and_since.sql');
  assert.match(mig112, /effective_verified_badge_for_user\(/i);
  assert.match(mig112, /interval '2 months'/i);
  assert.match(mig112, /is_protected_retention_account\(/i);
  assert.match(mig112, /cleanup_inactive_verified_badges\(/i);
  assert.match(mig112, /granted_at timestamptz/i);
  assert.match(mig112, /'verified_badge_granted_at'/i);
  assert.match(mig112, /automatically removed after 2 months of inactivity/i);

  const { ipon, appendedNodes, docListeners } = runCoreInVm(async () => ({ data: null, error: null }));

  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const recent = new Date(Date.now() - 2 * 86400000).toISOString();

  // Regular permanent BLUE badge inactive for 3 months auto-expires
  assert.equal(ipon.effectiveVerifiedBadgeTier({
    id: 'u-inactive',
    verified_badge_tier: 'BLUE',
    verified_badge_expires_at: null,
    verified_badge_granted_at: threeMonthsAgo,
    last_seen_at: threeMonthsAgo
  }), 'NONE');

  // Protected Creator Green stays active even if dates are old
  assert.equal(ipon.effectiveVerifiedBadgeTier({
    id: 'u-creator',
    verified_badge_tier: 'CREATOR_GREEN',
    verified_badge_expires_at: null,
    verified_badge_granted_at: threeMonthsAgo,
    last_seen_at: threeMonthsAgo
  }), 'CREATOR_GREEN');

  // Recent BLUE user emits data-verified-since without raw native <title> tags
  const html = ipon.verifiedBadgesHtml({
    id: 'u-active-blue',
    verified_badge_tier: 'BLUE',
    verified_badge_granted_at: '2026-10-05T08:00:00Z',
    last_seen_at: recent
  });
  assert.match(html, /data-verified-since="2026-10-05T08:00:00Z"/);
  assert.doesNotMatch(html, /<title>/i);

  // Clicking Creator badge shows Creator-specific info without "Verified" wording
  const creatorSpan = {
    dataset: { verifiedTier: 'CREATOR_GREEN', verifiedSince: '2026-10-01T08:00:00Z', verifiedExpires: '' },
    getBoundingClientRect: () => ({ left: 100, top: 100, right: 140, bottom: 118, width: 40, height: 18 }),
    contains: () => false
  };
  (docListeners.get('click') || []).forEach((fn) => fn({
    target: { closest: (sel) => (sel.includes('data-verified-tier') ? creatorSpan : null) },
    preventDefault() {},
    stopPropagation() {}
  }));
  let tip = appendedNodes.find((n) => n.id === 'ipon-verified-badge-tooltip');
  assert.ok(tip, 'Expected Creator badge click to open tooltip');
  assert.equal(tip.hidden, false);
  assert.match(tip.innerHTML, /Founder &amp; Creator/);
  assert.match(tip.innerHTML, />Since November 12, 2026</);
  assert.doesNotMatch(tip.innerHTML, /Official|Platform owner|lead developer|Creator of myIPON|Verified since/i);

  const heroPlatesCss = read('css/hero-plates.css');
  assert.match(heroPlatesCss, /\.announcement-owner-dp-btn[\s\S]*?grid-row:\s*1 \/ 3;\s*align-self:\s*center;/);
  assert.match(heroPlatesCss, /\.announcement-panel \.announcement-item-meta time\s*\{[^}]*grid-column:\s*2 \/ 4;[^}]*white-space:\s*nowrap;/);

  // Dismiss then hover BLUE badge -> shows "Verified since ..."
  (docListeners.get('keydown') || []).forEach((fn) => fn({ key: 'Escape' }));
  assert.equal(tip.hidden, true);

  const badgeSpan = {
    dataset: { verifiedTier: 'BLUE', verifiedSince: '2026-10-05T08:00:00Z', verifiedExpires: '' },
    getBoundingClientRect: () => ({ left: 200, top: 200, right: 220, bottom: 218, width: 20, height: 18 }),
    contains: () => false
  };
  const fakeEvent = { target: { closest: (sel) => (sel.includes('data-verified-tier') ? badgeSpan : null) } };
  (docListeners.get('mouseover') || []).forEach((fn) => fn(fakeEvent));

  tip = appendedNodes.find((n) => n.id === 'ipon-verified-badge-tooltip');
  assert.ok(tip, 'Expected floating badge tooltip to mount on hover');
  assert.equal(tip.hidden, false);
  assert.match(tip.innerHTML, /Verified Account/);
  assert.match(tip.innerHTML, /Verified since Oct 5, 2026/);
  assert.match(tip.innerHTML, /Auto-removes after 2 months inactive/i);
});
