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

  const ackedAt = new Date().toISOString();
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'CREATOR_GREEN', verified_badge_expires_at: null }), 'CREATOR_GREEN');
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'BLUE', verified_badge_expires_at: future, verified_badge_acknowledged_at: null }), 'NONE');
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'BLUE', verified_badge_expires_at: future, verified_badge_acknowledged_at: null }, '', { allowPendingAck: true }), 'BLUE');
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'BLUE', verified_badge_expires_at: future, verified_badge_acknowledged_at: ackedAt }), 'BLUE');
  assert.equal(ipon.effectiveVerifiedBadgeTier({ verified_badge_tier: 'BLUE', verified_badge_expires_at: past, verified_badge_acknowledged_at: ackedAt }), 'NONE');

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

  assert.equal(ipon.verifiedBadgesHtml({ id: 'u-pending-blue', verified_badge_tier: 'BLUE', verified_badge_acknowledged_at: null }), '');
  const blueHtml = ipon.verifiedBadgesHtml({ id: 'u-blue', verified_badge_tier: 'BLUE', verified_badge_acknowledged_at: ackedAt });
  const blueSvgCount = (blueHtml.match(/<svg /g) || []).length;
  assert.equal(blueSvgCount, 1, 'Regular verified user must only get the single blue check seal');
  assert.match(blueHtml, /#1d9bf0/);
  assert.doesNotMatch(blueHtml, /verified-badge-creator-star/);

  assert.equal(ipon.verifiedBadgesHtml({ id: 'u-expired', verified_badge_tier: 'BLUE', verified_badge_expires_at: past, verified_badge_acknowledged_at: ackedAt }), '');
});

test('first-open badge celebration modal pops up once with confetti, permanent vs temp distinction, and unlocks badge after Thank you', async () => {
  const rpcCalls = [];
  const { ipon, appendedNodes } = runCoreInVm(async (fn) => {
    rpcCalls.push(fn);
    return { data: { acknowledged_at: '2026-11-18T12:00:00Z' }, error: null };
  });

  const pendingProfile = {
    id: 'u1',
    role: 'MEMBER',
    full_name: 'Sample Member',
    verified_badge_tier: 'BLUE',
    verified_badge_granted_at: '2026-11-18T08:00:00Z',
    verified_badge_expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    verified_badge_message: 'Thank you for leading your group consistently!',
    verified_badge_acknowledged_at: null
  };

  // Badge stays hidden beside name until recipient clicks Thank you
  assert.equal(ipon.verifiedBadgesHtml(pendingProfile), '');

  // Does not open if already acknowledged or NONE tier
  assert.equal(ipon.maybeShowBadgeAwardModal({ id: 'u1', role: 'MEMBER', verified_badge_tier: 'NONE', verified_badge_acknowledged_at: null }), false);
  assert.equal(ipon.maybeShowBadgeAwardModal({ id: 'u1', role: 'MEMBER', verified_badge_tier: 'BLUE', verified_badge_acknowledged_at: '2026-11-18T10:00:00Z' }), false);

  // Temporary (7-day) modal: shows Effective until and hides 2-month permanent requirement box
  const shown = ipon.maybeShowBadgeAwardModal(pendingProfile);
  assert.equal(shown, true);
  assert.equal(appendedNodes.length, 1);

  const modal = appendedNodes[0];
  assert.equal(modal.open, true);
  assert.match(modal.innerHTML, /Congratulations/);
  assert.match(modal.innerHTML, /badge-celebrate-confetti-canvas/);
  assert.match(modal.innerHTML, /Verified status unlocked/i);
  assert.match(modal.innerHTML, /Effective until/);
  assert.match(modal.innerHTML, /Message from creator/i);
  assert.match(modal.innerHTML, /Thank you for leading your group consistently!/);
  assert.doesNotMatch(modal.innerHTML, /badge-celebrate-activity-box/);
  assert.match(modal.innerHTML, /Thank you<\/button>/);

  const ackClick = modal.querySelector('#ipon-badge-award-ack').listeners.get('click');
  assert.equal(typeof ackClick, 'function');
  await ackClick();
  assert.ok(rpcCalls.includes('acknowledge_my_verified_badge'), 'Thank you button must acknowledge the award via RPC');
  assert.equal(modal.open, false);

  // Permanent badge modal: shows Status: Permanent card and revised 2-month activity requirement
  const permVm = runCoreInVm(async () => ({ data: { acknowledged_at: '2026-11-18T12:00:00Z' }, error: null }));
  const permShown = permVm.ipon.maybeShowBadgeAwardModal({
    id: 'u-perm',
    role: 'MEMBER',
    full_name: 'Permanent Member',
    verified_badge_tier: 'BLUE',
    verified_badge_granted_at: '2026-11-18T08:00:00Z',
    verified_badge_expires_at: null,
    verified_badge_message: 'Trusted co-lead!',
    verified_badge_acknowledged_at: null
  });
  assert.equal(permShown, true);
  const permModal = permVm.appendedNodes[0];
  assert.match(permModal.innerHTML, /is-permanent-card/);
  assert.match(permModal.innerHTML, />Permanent</);
  assert.match(permModal.innerHTML, /permanent verified badge/i);
  assert.doesNotMatch(permModal.innerHTML, /\bofficial\b/i);
  assert.match(permModal.innerHTML, /badge-celebrate-activity-box/);
  assert.match(permModal.innerHTML, /Permanent badges stay active while you use myIPON, and are automatically removed after <em>2 months<\/em> of inactivity\./);

  // Even a 90-day temporary badge must NEVER show the Permanent-only 2-month activity requirement box
  const longTempVm = runCoreInVm(async () => ({ data: { acknowledged_at: '2026-11-18T12:00:00Z' }, error: null }));
  const longTempShown = longTempVm.ipon.maybeShowBadgeAwardModal({
    id: 'u-90d',
    role: 'MEMBER',
    full_name: 'Temp Member',
    verified_badge_tier: 'BLUE',
    verified_badge_granted_at: '2026-11-18T08:00:00Z',
    verified_badge_expires_at: new Date(Date.now() + 90 * 86400000).toISOString(),
    verified_badge_message: 'Enjoy 90 days!',
    verified_badge_acknowledged_at: null
  });
  assert.equal(longTempShown, true);
  assert.doesNotMatch(longTempVm.appendedNodes[0].innerHTML, /badge-celebrate-activity-box|2 months/i);
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
  assert.match(superAdminJs, /badgeGrantForm\?\.addEventListener\('submit'[\s\S]*?Ipon\.confirmAction\([\s\S]*?super_admin_grant_verified_badge/);
  assert.match(superAdminJs, /badgeRemoveForm\?\.addEventListener\('submit'[\s\S]*?Ipon\.confirmAction\([\s\S]*?super_admin_remove_verified_badge/);
  assert.match(superAdminJs, /renderBadges/);

  // Messages surface integration & announcement badge exclusion
  assert.doesNotMatch(coreJs, /announcement-author[^>]*>\$\{escapeHtml\(name\)\}\$\{verifiedBadgesHtml/);
  assert.match(messagesJs, /function userBadgesHtml\(/);
  assert.match(messagesJs, /msg-conv-bottom-meta/);
  assert.match(messagesJs, /id="msg-pop-name">\$\{escapeHtml\(profile\.full_name\)\}\$\{userBadgesHtml\(profile\)\}/);
  assert.match(messagesJs, /msg-sender-name">\$\{escapeHtml\(senderUser\.full_name\)\}\$\{userBadgesHtml\(senderUser\)\}/);

  // CSS badge & celebration modal rules
  assert.match(css, /\.verified-badge-svg\s*\{[^}]*width:\s*0\.95em;[^}]*height:\s*0\.95em;[^}]*background:\s*transparent !important/);
  assert.match(css, /\.msg-conv-name\s+\.verified-badges-inline/);
  assert.match(css, /@keyframes badgeCelebrateGlow/);
  assert.match(css, /\.verified-badge-tooltip\s*\{/);
  assert.match(css, /\.badge-celebrate-confetti-canvas\s*\{/);
  assert.match(css, /\.badge-celebrate-date\.is-permanent-card\s*\{/);
  assert.match(css, /\.badge-celebrate-activity-box\s*\{/);
  assert.match(css, /\.msg-conv-bottom-meta\s*\{/);
});

test('2-month inactivity rule, Thank-you unlock, and verified-since hover tooltip work across SQL and runtime', () => {
  const mig112 = read('database/migrations/20261118_112_verified_badge_inactivity_and_since.sql');
  const mig113 = read('database/migrations/20261118_113_badge_unlock_on_thankyou.sql');
  assert.match(mig112, /effective_verified_badge_for_user\(/i);
  assert.match(mig112, /interval '2 months'/i);
  assert.match(mig112, /is_protected_retention_account\(/i);
  assert.match(mig112, /cleanup_inactive_verified_badges\(/i);
  assert.match(mig112, /granted_at timestamptz/i);
  assert.match(mig112, /'verified_badge_granted_at'/i);
  assert.match(mig112, /automatically removed after 2 months of inactivity/i);
  assert.match(mig113, /p_acknowledged_at timestamptz default null/i);
  assert.match(mig113, /p_acknowledged_at is null/i);
  assert.match(mig113, /get_active_verified_badges\(/i);
  assert.match(mig113, /get_social_user_profile\(/i);

  const { ipon, appendedNodes, docListeners } = runCoreInVm(async () => ({ data: null, error: null }));

  const threeMonthsAgo = new Date(Date.now() - 90 * 86400000).toISOString();
  const recent = new Date(Date.now() - 2 * 86400000).toISOString();

  // Regular permanent BLUE badge inactive for 3 months auto-expires
  assert.equal(ipon.effectiveVerifiedBadgeTier({
    id: 'u-inactive',
    verified_badge_tier: 'BLUE',
    verified_badge_expires_at: null,
    verified_badge_granted_at: threeMonthsAgo,
    verified_badge_acknowledged_at: threeMonthsAgo,
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

  // Acknowledged recent BLUE user emits data-verified-since without raw native <title> tags
  const html = ipon.verifiedBadgesHtml({
    id: 'u-active-blue',
    verified_badge_tier: 'BLUE',
    verified_badge_granted_at: '2026-10-05T08:00:00Z',
    verified_badge_acknowledged_at: recent,
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
  const coreJsUpdated = read('js/core.js');
  assert.doesNotMatch(coreJsUpdated, /class="announcement-view-arrow"/);
  assert.match(coreJsUpdated, /class="announcement-card-bottom-bar"/);
  assert.match(heroPlatesCss, /\.announcement-owner-dp-btn[\s\S]*?grid-row:\s*1 \/ 3;\s*align-self:\s*center;/);
  assert.match(heroPlatesCss, /\.announcement-panel \.announcement-item-meta time\s*\{[^}]*grid-column:\s*2;[^}]*white-space:\s*nowrap;/);
  assert.match(heroPlatesCss, /\.announcement-panel \.announcement-card-bottom-bar\s*\{[^}]*flex-direction:\s*column;/);
  assert.match(heroPlatesCss, /\.announcement-panel \.announcement-item-meta\s*\{[^}]*width:\s*100%;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);/);
  assert.doesNotMatch(coreJsUpdated, /announcement-role-badge/);
  assert.match(heroPlatesCss, /\.announcement-panel \.announcement-view-trigger\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*center;/);
  assert.match(heroPlatesCss, /\.announcement-panel \.announcement-avatar img\s*\{[^}]*object-fit:\s*cover;/);

  // Dismiss then hover BLUE badge -> shows "Verified since ..."
  (docListeners.get('keydown') || []).forEach((fn) => fn({ key: 'Escape' }));
  assert.equal(tip.hidden, true);

  // Hovering ANOTHER user's BLUE badge shows ONLY Verified Account + Verified since (hides retention/expiry details)
  const otherUserSpan = {
    dataset: { verifiedTier: 'BLUE', verifiedUid: 'other-u', verifiedSince: '2026-10-05T08:00:00Z', verifiedExpires: '' },
    getBoundingClientRect: () => ({ left: 200, top: 200, right: 220, bottom: 218, width: 20, height: 18 }),
    contains: () => false
  };
  (docListeners.get('mouseover') || []).forEach((fn) => fn({ target: { closest: (sel) => (sel.includes('data-verified-tier') ? otherUserSpan : null) } }));

  tip = appendedNodes.find((n) => n.id === 'ipon-verified-badge-tooltip');
  assert.ok(tip, 'Expected floating badge tooltip to mount on hover');
  assert.equal(tip.hidden, false);
  assert.match(tip.innerHTML, /Verified Account/);
  assert.match(tip.innerHTML, /Verified since Oct 5, 2026/);
  assert.doesNotMatch(tip.innerHTML, /Permanent|Auto-removes|2 months inactive|Valid until/i);

  // Hovering OWN permanent BLUE badge shows personal "Permanent · Auto-removes after 2 months inactive." note
  const badgeSpan = {
    dataset: { verifiedTier: 'BLUE', verifiedUid: 'self-u', verifiedSelf: '1', verifiedSince: '2026-10-05T08:00:00Z', verifiedExpires: '' },
    getBoundingClientRect: () => ({ left: 200, top: 200, right: 220, bottom: 218, width: 20, height: 18 }),
    contains: () => false
  };
  (docListeners.get('mouseover') || []).forEach((fn) => fn({ target: { closest: (sel) => (sel.includes('data-verified-tier') ? badgeSpan : null) } }));
  assert.match(tip.innerHTML, /Auto-removes after 2 months inactive/i);

  // Hovering OWN temporary BLUE badge shows "Valid until ..." without "2 months inactive"
  const tempBadgeSpan = {
    dataset: { verifiedTier: 'BLUE', verifiedUid: 'self-u', verifiedSelf: '1', verifiedSince: '2026-10-05T08:00:00Z', verifiedExpires: '2027-01-15T08:00:00Z' },
    getBoundingClientRect: () => ({ left: 200, top: 200, right: 220, bottom: 218, width: 20, height: 18 }),
    contains: () => false
  };
  (docListeners.get('mouseover') || []).forEach((fn) => fn({ target: { closest: (sel) => (sel.includes('data-verified-tier') ? tempBadgeSpan : null) } }));
  assert.match(tip.innerHTML, /Valid until Jan 15, 2027\./);
  assert.doesNotMatch(tip.innerHTML, /2 months inactive/i);

  const mig114 = read('database/migrations/20261118_114_permanent_only_badge_inactivity.sql');
  assert.match(mig114, /if p_expires_at is not null then/i);
  assert.match(mig114, /interval '2 months'/i);
});

test('My Account verified badge card lets members message the creator directly without error', () => {
  const coreJs = read('js/core.js');
  const messagesJs = read('js/messages.js');
  const accountHtml = read('account.html');
  const accountJs = read('js/account.js');
  const css = read('css/app.css');

  // account.html keeps balanced dialogs and unique IDs
  const openDlgs = (accountHtml.match(/<dialog\b/g) || []).length;
  const closeDlgs = (accountHtml.match(/<\/dialog>/g) || []).length;
  assert.equal(openDlgs, closeDlgs);
  const accIds = [...accountHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(accIds.length, new Set(accIds).size, 'Duplicate IDs in account.html');

  // My Account quick modal and account.html both expose creator messaging entry point
  assert.match(coreJs, /id="quick-verified-badge-row"/);
  assert.match(coreJs, /data-message-creator-badge/);
  assert.match(coreJs, /announcement_author_social_id/);
  assert.match(coreJs, /window\.IponMessages\?\.openDirectMessage/);
  assert.match(coreJs, /syncAccountBadgeSection,\s*openCreatorBadgeChat/);
  assert.match(accountHtml, /id="account-verified-badge-row"/);
  assert.match(accountJs, /syncAccountBadgeSection/);
  assert.match(messagesJs, /async function openDirectMessage\(/);
  assert.match(messagesJs, /window\.IponMessages = \{[\s\S]*openDirectMessage/);
  assert.match(css, /\.account-support-row\.account-badge-row\s*\{/);
  assert.match(css, /\.account-badge-pill\.is-available\s*\{/);
  assert.match(coreJs, /is-badge-granted[\s\S]*?badgeSealSvgMarkup\('#1d9bf0'/);
  assert.match(css, /\.notification-item-icon\.is-badge-granted/);

  // Announcement bullet parser handles "Thank you" before isOutro so release bullets keep section cards
  const bulletIdx = coreJs.indexOf("if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {");
  const outroIdx = coreJs.indexOf('if (isOutro(line) && !hasMoreStructuredContent)');
  assert.ok(bulletIdx !== -1 && outroIdx > bulletIdx, 'Bullet detection must precede outro detection');

  // Badges appear everywhere people are viewed (group picker, forward/blocked lists, workspace tables, discussions)
  assert.match(messagesJs, /msg-group-pick-copy[\s\S]*?userBadgesHtml\(u\)/);
  assert.match(messagesJs, /msg-group-chip[\s\S]*?userBadgesHtml\(u\)/);
  assert.match(messagesJs, /msg-forward-meta[\s\S]*?userBadgesHtml\(/);
  assert.match(messagesJs, /msg-blocked-row[\s\S]*?userBadgesHtml\(b\)/);
  assert.match(read('js/members.js'), /verifiedBadgesHtml\?\.\(account\?\.id \|\| member\.id\)/);
  assert.match(read('js/settings.js'), /verifiedBadgesHtml\?\.\(profile\.user_id \|\| profile\.id\)/);
  assert.match(read('js/requests.js'), /verifiedBadgesHtml\?\.\(item\.requesterId \|\| item\.requesterName\)/);
  assert.match(read('js/reports.js'), /verifiedBadgesHtml\?\.\(row\.member_id \|\| row\.member_name\)/);
  assert.match(read('js/dashboard.js'), /verifiedBadgesHtml\?\.\(person\.userId \|\| person\.memberId \|\| person\.name\)/);
  assert.match(coreJs, /record-thread-msg-meta[\s\S]*?verifiedBadgesHtml\(c\.author_id \|\| authorName\)/);

  const { ipon } = runCoreInVm(async () => ({ data: null, error: null }));
  ipon.registerVerifiedBadges([{ user_id: 'u-alias-1', verified_badge: 'BLUE', granted_at: '2026-11-18T08:00:00Z' }]);
  ipon.registerMemberAvatars([{ id: 'u-alias-1', member_id: 'mem-1', full_name: 'Alias Saver', avatar_url: null }]);
  assert.match(ipon.verifiedBadgesHtml('mem-1'), /data-verified-uid="u-alias-1"/);
  assert.match(ipon.verifiedBadgesHtml('Alias Saver'), /data-verified-uid="u-alias-1"/);

  // Self-messaging (Saved Messages) SQL + UI contracts
  const mig115 = read('database/migrations/20261118_115_self_messaging.sql');
  assert.match(mig115, /user_a <= user_b/i);
  assert.match(mig115, /start_or_open_direct_chat\(/i);
  assert.match(mig115, /send_chat_message\(/i);
  assert.match(mig115, /get_social_user_profile\(/i);
  assert.match(mig115, /search_social_users\(/i);
  assert.match(messagesJs, /function isSelfUser\(/);
  assert.match(messagesJs, /Message yourself/);
  assert.match(messagesJs, /Saved Messages/);
  assert.match(css, /\.msg-self-pill\s*\{/);

  // Empty conversation hero + deferred outgoing request banner until first message sent
  assert.match(messagesJs, /is-empty-intro/);
  assert.match(messagesJs, /msg-thread-welcome-hero/);
  assert.match(messagesJs, /!isSelfHero \? `<div class="msg-welcome-meta">/);
  assert.match(messagesJs, /isPendingReq && hasSentMessages/);
  assert.match(css, /\.msg-thread-header\.is-empty-intro\s+\.msg-thread-header-left\s+>\s+:not\(\.msg-back-mobile-btn\)/);

  // Composer hides desktop scrollbar arrows; minimal DP viewer opens only for real DPs and closes on outside click
  assert.match(messagesJs, /el\.style\.overflowY\s*=\s*el\.scrollHeight\s*>\s*140\s*\?\s*'auto'\s*:\s*'hidden'/);
  assert.match(messagesJs, /heroDpUrl[\s\S]*data-view-dp-src/);
  assert.match(messagesJs, /peerDpUrl[\s\S]*data-view-dp-src/);
  assert.match(css, /#msg-composer-input\s*\{[^}]*overflow-y:\s*hidden;[^}]*scrollbar-width:\s*none;/);
  assert.match(css, /#msg-composer-input::-webkit-scrollbar\s*\{\s*display:\s*none;\s*\}/);
  assert.match(css, /\.dp-viewer-dialog\s*\{/);
  assert.match(css, /\.dp-viewer-dialog\s+img\s*\{[^}]*border-radius:\s*0;/);
  assert.match(css, /\.sidebar-user-name\s*\{\s*display:\s*block;\s*\}/);
  assert.match(css, /#quick-account-name\s*\{\s*display:\s*block;\s*\}/);
  assert.match(css, /\.msg-welcome-name\s*\{[^}]*display:\s*block;/);
  assert.match(messagesJs, /function openDpViewer\(/);
  assert.match(coreJs, /MAX_AVATAR_BYTES\s*=\s*8\s*\*\s*1024\s*\*\s*1024/);
  assert.match(coreJs, /function prepareAvatarDataUrl[\s\S]*?skipCompressBytes:\s*MAX_AVATAR_BYTES/);
  assert.match(coreJs, /nativeCropEdge[\s\S]*?Math\.min\(2400,\s*nativeCropEdge\)/);
});
