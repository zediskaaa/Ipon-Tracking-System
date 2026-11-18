import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function makeStubCanvasContext() {
  const noop = () => { };
  const grad = () => ({ addColorStop: noop });
  return {
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineDashOffset: 0,
    font: '',
    clearRect: noop,
    fillRect: noop,
    strokeRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    bezierCurveTo: noop,
    arc: noop,
    arcTo: noop,
    ellipse: noop,
    fill: noop,
    stroke: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,
    setLineDash: noop,
    drawImage: noop,
    fillText: noop,
    createLinearGradient: grad,
    createRadialGradient: grad
  };
}

test('profile effects engine exports all 16 effects and renders every effect cleanly without errors', () => {
  const code = read('js/profile-effects.js');
  const canvases = [];
  const noop = () => { };
  const fakeCanvas = () => ({
    className: '',
    width: 300,
    height: 180,
    clientWidth: 300,
    clientHeight: 180,
    offsetWidth: 300,
    offsetHeight: 180,
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getContext: () => makeStubCanvasContext(),
    remove: noop
  });

  const sandbox = {
    window: {
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: false, addEventListener: noop })
    },
    document: {
      hidden: false,
      createElement(tag) {
        if (tag === 'canvas') {
          const c = fakeCanvas();
          canvases.push(c);
          return c;
        }
        return { attributes: {}, setAttribute: noop, remove: noop };
      }
    },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: noop,
    Math,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    console
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'js/profile-effects.js' });

  const api = sandbox.window.IponProfileEffects;
  assert.ok(api);
  assert.equal(api.EFFECTS.length, 16);
  assert.equal(api.ALL_OPTIONS.length, 17);
  assert.deepEqual(
    [...api.EFFECTS.map((e) => e.id)],
    [
      'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
      'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp',
      'jelly', 'astro', 'constellation', 'sigil'
    ]
  );
  assert.equal(api.normalizeEffectId(' SIGIL '), 'sigil');
  assert.equal(api.normalizeEffectId('unknown'), 'none');
  assert.equal(api.getEffect('singularity').rare, 2);

  const fxb = fakeCanvas();
  const fxf = fakeCanvas();
  const host = {
    querySelector(sel) {
      if (sel === 'canvas.fxb') return fxb;
      if (sel === 'canvas.fxf') return fxf;
      return null;
    },
    prepend: noop,
    appendChild: noop
  };
  const stage = api.mountStage(host, {
    effectId: 'stardust',
    geometryFn: () => ({ cx: 60, cy: 96, ra: 36 }),
    fps: 60
  });
  for (const effect of api.ALL_OPTIONS) {
    assert.doesNotThrow(() => stage.setEffect(effect.id), `Failed rendering ${effect.id}`);
  }
  stage.destroy();
});

test('migration 117 enforces permanent Super Admin grants with zero retention expiry and strict RLS', () => {
  const sql = read('database/migrations/20261118_117_profile_effects.sql');
  assert.match(sql, /create table if not exists public\.profile_effect_grants/i);
  assert.doesNotMatch(sql, /expires_at/i);
  assert.doesNotMatch(sql, /interval\s+'2 months'/i);
  assert.match(sql, /alter table public\.profile_effect_grants enable row level security/i);
  assert.match(sql, /using \(user_id = auth\.uid\(\) or public\.is_super_admin\(\)\)/i);
  assert.match(sql, /create or replace function public\.super_admin_grant_profile_effects/i);
  assert.match(sql, /'EFFECT_GRANTED'/);
  assert.match(sql, /create or replace function public\.super_admin_revoke_profile_effect/i);
  assert.match(sql, /'EFFECT_REMOVED'/);
  assert.match(sql, /create or replace function public\.equip_own_profile_effect/i);
  assert.match(sql, /create or replace function public\.acknowledge_my_profile_effects/i);
  assert.match(sql, /'profile_effect', coalesce\(v_profile\.equipped_profile_effect, 'none'\)/);
});

test('profile card swatch fix, cover upload hardening, Super Admin effects tab, celebration modal, and popover integration are complete', () => {
  const core = read('js/core.js');
  const messages = read('js/messages.js');
  const superAdminJs = read('js/super-admin.js');
  const superAdminHtml = read('super-admin.html');
  const css = read('css/app.css');
  const edge = read('supabase/functions/manage-account/index.ts');

  // Pic 1 & Pic 2 bug fixes
  assert.match(edge, /'avatars', 'covers', 'group-avatars'/);
  assert.match(core, /\['image\/jpeg', 'image\/jpg', 'image\/png', 'image\/webp'\]\.includes\(mime\)/);
  assert.match(core, /colorSwatches\.forEach\(\(button\) => button\.addEventListener\('click', async \(\) => \{/);
  assert.doesNotMatch(core, /#quick-card-appearance \[data-card-color\][^}]*setBusy\(button, true\)/);
  assert.match(core, /feedback\.textContent = 'Saving color…'/);
  assert.match(css, /\.account-card-swatches button\.is-saving\b/);

  // Balanced <dialog> tags & unique IDs in super-admin.html + Effects tab
  const opens = (superAdminHtml.match(/<dialog\b/g) || []).length;
  const closes = (superAdminHtml.match(/<\/dialog>/g) || []).length;
  assert.equal(opens, closes, 'Unbalanced <dialog> tags in super-admin.html');
  const ids = [...superAdminHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs in super-admin.html');

  assert.match(core, /\['effects',\s*'super-admin\.html#effects',\s*'Profile effects'/);
  assert.match(superAdminHtml, /id="effects"[^>]*data-platform-view="effects"/);
  assert.match(superAdminHtml, /id="effect-grant-dialog"/);
  assert.match(superAdminHtml, /id="effect-remove-dialog"/);
  assert.match(superAdminJs, /super_admin_list_profile_effects/);
  assert.match(superAdminJs, /super_admin_grant_profile_effects/);
  assert.match(superAdminJs, /super_admin_revoke_profile_effect/);

  // Celebration modal & Gallery & Popover runtime
  assert.match(core, /function maybeShowEffectAwardModal\(/);
  assert.match(core, /PROFILE EFFECT UNLOCKED/);
  assert.match(core, /TRIAL PROFILE EFFECT APPROVED/);
  assert.doesNotMatch(core, /Never expires|zero retention expiry|Locked · not unlocked yet/i);
  assert.doesNotMatch(superAdminJs, /Awaiting claim' : ' · Never expires'|Effects never expire/);
  assert.doesNotMatch(superAdminHtml, /Never expire|no inactivity retention/i);
  assert.match(core, /function openProfileEffectsDialog\(/);
  assert.match(core, /Request a trial effect/);
  assert.match(core, /submit_profile_effect_trial_request/);
  assert.match(core, /cancel_own_profile_effect_trial_request/);
  assert.match(core, /equip_own_profile_effect/);
  assert.match(messages, /window\.IponProfileEffects/);
  assert.match(messages, /profileEffectStage\?\.destroy/);
  assert.match(messages, /profileAppearanceCache/);
  assert.match(messages, /function applyProfileCardAppearance\(/);
  assert.match(messages, /Promise\.all\(\[\s*ipon\(\)\.rpc\('get_social_user_profile'/);
  assert.match(css, /\.effects-gallery-dialog\s*\{/);
  assert.match(css, /\.effect-celebrate-hero\s*\{/);
  assert.match(css, /\.msg-profile-popover\[data-card-theme="midnight"\]/);
  assert.match(css, /\.msg-profile-popover\[data-card-theme\],\s*html\[data-theme="dark"\]\s+\.msg-profile-popover\[data-card-theme\]\s*\{/);
  assert.match(superAdminHtml, /id="effects-subtabs"/);
  assert.match(superAdminHtml, /id="effect-trial-approve-dialog"/);
  assert.match(superAdminHtml, /id="effect-trial-reject-dialog"/);
  assert.match(superAdminJs, /super_admin_list_effect_trial_requests/);
  assert.match(superAdminJs, /super_admin_review_effect_trial_request/);

  // Balanced braces across css/app.css
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  assert.equal(depth, 0, 'Unbalanced CSS braces in css/app.css');
});

test('runtime profile effect celebration modal shows permanent award, live preview, creator quote, zero retention, and acknowledges with equip', async () => {
  const coreJs = read('js/core.js');
  const effectsJs = read('js/profile-effects.js');
  const rpcCalls = [];
  const appendedNodes = [];

  const makeEl = (tag = 'div') => {
    const listeners = new Map();
    const attrs = {};
    const cls = new Set();
    let html = '';
    const el = {
      tagName: String(tag).toUpperCase(),
      id: '',
      className: '',
      hidden: false,
      disabled: false,
      open: false,
      dataset: {},
      style: {},
      textContent: '',
      clientWidth: 264,
      clientHeight: 122,
      width: 264,
      height: 122,
      isConnected: true,
      classList: {
        add: (...names) => names.forEach((n) => cls.add(n)),
        remove: (...names) => names.forEach((n) => cls.delete(n)),
        toggle: (n, f) => (f === undefined ? (cls.has(n) ? (cls.delete(n), false) : (cls.add(n), true)) : (f ? cls.add(n) : cls.delete(n), Boolean(f))),
        contains: (n) => cls.has(n)
      },
      listeners,
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] ?? null; },
      removeAttribute(k) { delete attrs[k]; },
      hasAttribute(k) { return k in attrs; },
      addEventListener(type, fn) { listeners.set(type, fn); },
      removeEventListener(type) { listeners.delete(type); },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 264, height: 122 }),
      getContext: () => makeStubCanvasContext(),
      prepend() { },
      insertAdjacentElement() { },
      appendChild(child) { return child; },
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { this.isConnected = false; },
      set innerHTML(v) { html = String(v); },
      get innerHTML() { return html; },
      querySelector(sel) {
        if (sel === '#ipon-effect-award-equip') return equipBtn;
        if (sel === '#ipon-effect-award-keep') return keepBtn;
        if (sel === '#ipon-effect-award-sheet') return sheet;
        if (sel === '#ipon-effect-award-hero') return hero;
        if (sel === '#ipon-effect-award-canvas') return confettiCanvas;
        if (sel === 'canvas.fxb') return fxb;
        if (sel === 'canvas.fxf') return fxf;
        return null;
      },
      querySelectorAll() { return []; },
      closest() { return null; }
    };
    return el;
  };

  const equipBtn = makeEl('button');
  const keepBtn = makeEl('button');
  const sheet = makeEl('div');
  const hero = makeEl('div');
  const confettiCanvas = makeEl('canvas');
  const fxb = makeEl('canvas');
  const fxf = makeEl('canvas');
  const appLoader = makeEl('div');

  const doc = {
    documentElement: { dataset: {}, style: { setProperty() { }, removeProperty() { } }, classList: { add() { }, remove() { }, toggle() { } } },
    body: {
      dataset: { page: 'dashboard' },
      classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } },
      appendChild(node) { appendedNodes.push(node); return node; },
      insertAdjacentHTML() { },
      querySelector() { return null; }
    },
    hidden: false,
    addEventListener() { },
    removeEventListener() { },
    getElementById: (id) => {
      if (id === 'app-loader') return appLoader;
      if (id === 'ipon-effect-award-dialog') return appendedNodes.find((n) => n.id === id) || null;
      return null;
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeEl(tag)
  };

  const client = {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    rpc: async (fn, params) => {
      rpcCalls.push({ fn, params });
      if (fn === 'get_own_profile_effects') {
        return {
          data: {
            equipped_effect: 'none',
            grants: [{
              effect_id: 'singularity',
              granted_at: '2026-11-18T12:00:00Z',
              grant_message: 'Earned by top saver!',
              acknowledged_at: null
            }]
          },
          error: null
        };
      }
      if (fn === 'acknowledge_my_profile_effects') {
        return {
          data: {
            equipped_effect: params?.p_equip_effect_id || 'none',
            grants: [{
              effect_id: 'singularity',
              granted_at: '2026-11-18T12:00:00Z',
              grant_message: 'Earned by top saver!',
              acknowledged_at: '2026-11-18T12:05:00Z'
            }]
          },
          error: null
        };
      }
      return { data: null, error: null };
    }
  };

  const noop = () => { };
  const ctx = {
    window: null,
    document: doc,
    location: { href: 'http://localhost/dashboard.html', pathname: '/dashboard.html', origin: 'http://localhost', search: '', replace: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: {},
    supabase: { createClient: () => client },
    URL,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: noop,
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: noop,
    setTimeout,
    clearTimeout,
    console,
    Date,
    Math,
    JSON,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Promise
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };

  vm.runInNewContext(effectsJs, ctx, { filename: 'js/profile-effects.js' });
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  const ipon = ctx.window.Ipon;

  // Should not open if no unacknowledged grants exist
  assert.equal(ipon.maybeShowEffectAwardModal({
    profile: { id: 'u1', role: 'MEMBER', full_name: 'Sample Saver' },
    grants: [{ effect_id: 'singularity', acknowledged_at: '2026-11-18T11:00:00Z' }]
  }), false);

  const shown = ipon.maybeShowEffectAwardModal({
    profile: { id: 'u1', role: 'MEMBER', full_name: 'Sample Saver', card_theme: 'midnight' },
    grants: [
      { effect_id: 'singularity', granted_at: '2026-11-18T12:00:00Z', grant_message: 'Earned by top saver!', acknowledged_at: null },
      { effect_id: 'sigil', granted_at: '2026-11-18T12:00:00Z', grant_message: 'Bonus rune!', acknowledged_at: null }
    ]
  });
  assert.equal(shown, true);
  const effectModals = appendedNodes.filter((n) => n.id === 'ipon-effect-award-dialog');
  assert.equal(effectModals.length, 1);

  const modal = effectModals[0];
  assert.equal(modal.open, true);
  assert.match(modal.innerHTML, /Congratulations/);
  assert.match(modal.innerHTML, /Sample Saver!/);
  assert.match(modal.innerHTML, /PROFILE EFFECT UNLOCKED/);
  assert.match(modal.innerHTML, /Singularity/);
  assert.match(modal.innerHTML, />Permanent<\/b>/);
  assert.doesNotMatch(modal.innerHTML, /Never expires|zero retention expiry|badge-celebrate-activity-box|2 months/i);
  assert.match(modal.innerHTML, /Earned by top saver!/);

  const equipClick = equipBtn.listeners.get('click');
  assert.equal(typeof equipClick, 'function');
  await equipClick();
  const ackCall = rpcCalls.find((c) => c.fn === 'acknowledge_my_profile_effects');
  assert.ok(ackCall, 'Equip now button must call acknowledge_my_profile_effects');
  assert.deepEqual(ackCall.params.p_effect_ids, ['singularity', 'sigil']);
  assert.equal(ackCall.params.p_equip_effect_id, 'singularity');
  assert.equal(modal.open, false);
});

test('cover photo cropper opens X-style 3:1 editor with corner brackets, no grid, and clean cleanup', async () => {
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  // Corner L-brackets exist cleanly without rule-of-thirds grid lines
  assert.match(coreJs, /class="avatar-crop-overlay"[^>]*><span class="avatar-crop-corner is-tl"><\/span><span class="avatar-crop-corner is-tr"><\/span><span class="avatar-crop-corner is-bl"><\/span><span class="avatar-crop-corner is-br"><\/span>/);
  assert.doesNotMatch(coreJs, /avatar-crop-grid|rule-of-thirds/i);
  assert.match(css, /\.avatar-crop-dialog\.is-cover\s+\.avatar-crop-overlay\{[^}]*box-shadow:0 0 0 9999px rgba\(/);
  assert.doesNotMatch(css, /\.avatar-crop-dialog\.is-cover[\s\S]*?(?:avatar-crop-grid|repeating-linear-gradient)/);

  const elements = new Map();
  const makeEl = (id, tag = 'div') => {
    const classes = new Set();
    const listeners = new Map();
    const ctxCalls = [];
    const el = {
      id,
      tagName: tag.toUpperCase(),
      width: 280,
      height: 280,
      clientWidth: id === 'avatar-crop-viewport' ? 360 : 280,
      value: '1',
      textContent: '',
      open: false,
      disabled: false,
      style: {},
      dataset: {},
      classList: {
        add: (...names) => names.forEach((n) => classes.add(n)),
        remove: (...names) => names.forEach((n) => classes.delete(n)),
        toggle: (n, force) => (force === undefined ? (classes.has(n) ? (classes.delete(n), false) : (classes.add(n), true)) : (force ? (classes.add(n), true) : (classes.delete(n), false))),
        contains: (n) => classes.has(n)
      },
      addEventListener: (type, fn) => listeners.set(type, fn),
      removeEventListener: (type) => listeners.delete(type),
      setAttribute: () => {},
      removeAttribute: () => {},
      showModal() { this.open = true; },
      close() { this.open = false; },
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      getContext: () => ({
        clearRect: () => {},
        save: () => {},
        restore: () => {},
        translate: () => {},
        rotate: () => {},
        drawImage: (...args) => ctxCalls.push(args),
        fillRect: () => {}
      }),
      toDataURL: () => 'data:image/jpeg;base64,ZmFrZWNvdmVy',
      querySelector: (sel) => (sel === '.avatar-crop-viewport-wrap' ? elements.get('viewport') : (sel === 'canvas' ? el._thumbCanvas || null : null)),
      _innerHTML: '',
      get innerHTML() { return this._innerHTML; },
      set innerHTML(val) {
        this._innerHTML = String(val || '');
        const match = this._innerHTML.match(/width="(\d+)" height="(\d+)"/);
        this._thumbCanvas = match ? { width: Number(match[1]), height: Number(match[2]), getContext: () => makeEl('thumb-canvas', 'canvas').getContext() } : null;
      },
      _ctxCalls: ctxCalls,
      _listeners: listeners
    };
    if (id) elements.set(id, el);
    return el;
  };

  makeEl('app-loader', 'div');
  const dialog = makeEl('avatar-crop-dialog', 'dialog');
  const canvas = makeEl('avatar-crop-canvas', 'canvas');
  const titleEl = makeEl('avatar-crop-title', 'h2');
  const subtitleEl = makeEl('avatar-crop-subtitle', 'p');
  const zoomInput = makeEl('avatar-crop-zoom', 'input');
  const previewThumb = makeEl('avatar-crop-preview-thumb', 'div');
  const rotateBtn = makeEl('avatar-crop-rotate', 'button');
  const saveBtn = makeEl('avatar-crop-save', 'button');
  const cancelBtn = makeEl('avatar-crop-cancel', 'button');
  const closeBtn = makeEl('avatar-crop-close', 'button');
  const viewport = makeEl('viewport', 'div');
  viewport.clientWidth = 360;

  let lastImage = null;
  class FakeImage {
    constructor() {
      this.naturalWidth = 1200;
      this.naturalHeight = 1600;
      lastImage = this;
    }
    set src(_val) {
      queueMicrotask(() => this.onload && this.onload());
    }
  }

  const noop = () => {};
  const ctx = {
    window: null,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      getElementById: (id) => elements.get(id) || null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      removeEventListener: noop,
      createElement: (tag) => makeEl('', tag),
      hidden: false,
      body: {
        dataset: { page: 'account' },
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild: (node) => node,
        insertAdjacentHTML: noop,
        querySelector: () => null
      },
      documentElement: {
        dataset: {},
        style: { setProperty: noop, removeProperty: noop },
        classList: { add: noop, remove: noop, toggle: noop }
      }
    },
    Image: FakeImage,
    Blob,
    File: class FakeFile extends Blob { constructor(parts, name, opts) { super(parts, opts); this.name = name; } },
    URL: { createObjectURL: () => 'blob:mock-cover', revokeObjectURL: noop },
    location: { href: 'http://localhost/account.html', pathname: '/account.html', origin: 'http://localhost', search: '', replace: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: {},
    supabase: { createClient: () => ({ storage: null }) },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    dispatchEvent: noop,
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: noop,
    setTimeout,
    clearTimeout,
    console,
    Date,
    Math,
    JSON,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Promise
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };

  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  const fakeFile = new ctx.File(['x'], 'portrait.jpg', { type: 'image/jpeg' });
  let savedPayload = null;
  const cropPromise = ctx.window.Ipon.openAvatarCropper(fakeFile, {
    mode: 'cover',
    title: 'Edit cover photo',
    subtitle: 'Drag to reposition or adjust zoom to choose which part shows as your cover.',
    saveLabel: 'Save cover photo',
    category: 'covers',
    maxBytes: 2 * 1024 * 1024,
    onSave: async (url) => { savedPayload = url; }
  });

  await new Promise((r) => setTimeout(r, 15));
  assert.ok(lastImage);
  assert.equal(dialog.open, true);
  assert.equal(dialog.classList.contains('is-cover'), true);
  assert.equal(previewThumb.classList.contains('is-cover'), true);
  assert.equal(canvas.width, 360);
  assert.equal(canvas.height, 220);
  assert.equal(previewThumb._thumbCanvas.width, 84);
  assert.equal(previewThumb._thumbCanvas.height, 28);
  assert.equal(titleEl.textContent, 'Edit cover photo');
  assert.equal(saveBtn.textContent, 'Save cover photo');

  // Cancel restores shared dialog back to square avatar defaults
  cancelBtn._listeners.get('click')();
  assert.equal(await cropPromise, null);
  assert.equal(savedPayload, null);
  assert.equal(dialog.open, false);
  assert.equal(dialog.classList.contains('is-cover'), false);
  assert.equal(previewThumb.classList.contains('is-cover'), false);
  assert.equal(canvas.width, 280);
  assert.equal(canvas.height, 280);
  assert.equal(titleEl.textContent, 'Crop display picture');
  assert.equal(saveBtn.textContent, 'Save display picture');

  // Re-open in cover mode, pan + rotate + save, verify 3:1 export & cleanup
  let exportWidth = 0;
  let exportHeight = 0;
  const origCreateElement = ctx.document.createElement;
  ctx.document.createElement = (tag) => {
    const el = origCreateElement(tag);
    if (tag === 'canvas') {
      return new Proxy(el, {
        set(target, prop, value) {
          target[prop] = value;
          if (prop === 'width') exportWidth = value;
          if (prop === 'height') exportHeight = value;
          return true;
        }
      });
    }
    return el;
  };
  const savePromise = ctx.window.Ipon.openAvatarCropper(fakeFile, {
    mode: 'cover',
    title: 'Edit cover photo',
    saveLabel: 'Save cover photo',
    category: 'covers',
    maxBytes: 2 * 1024 * 1024,
    onSave: async (url) => { savedPayload = url; }
  });
  await new Promise((r) => setTimeout(r, 15));
  viewport._listeners.get('pointerdown')({ button: 0, isPrimary: true, pointerId: 1, clientX: 100, clientY: 120 });
  viewport._listeners.get('pointermove')({ pointerId: 1, clientX: 100, clientY: 80 });
  viewport._listeners.get('pointerup')({ pointerId: 1 });
  rotateBtn._listeners.get('click')();
  await saveBtn._listeners.get('click')();
  const resolvedUrl = await savePromise;
  assert.equal(resolvedUrl, 'data:image/jpeg;base64,ZmFrZWNvdmVy');
  assert.equal(savedPayload, 'data:image/jpeg;base64,ZmFrZWNvdmVy');
  assert.ok(exportWidth > 0 && exportHeight > 0 && exportWidth === exportHeight * 3, `expected exact 3:1 cover export, got ${exportWidth}x${exportHeight}`);
  assert.equal(dialog.open, false);
  assert.equal(dialog.classList.contains('is-cover'), false);
});

test('migration 118 and runtime enforce 1-per-effect trials, 1-month cooldown, and trial approval congrats modal', async () => {
  const mig118 = read('database/migrations/20261118_118_profile_effect_trials.sql');
  const schema = read('database/schema.sql');

  for (const sql of [mig118, schema]) {
    assert.match(sql, /create table if not exists public\.profile_effect_trial_requests/i);
    assert.match(sql, /idx_effect_trial_one_pending_per_user/i);
    assert.match(sql, /idx_effect_trial_one_approved_per_effect/i);
    assert.match(sql, /alter table public\.profile_effect_trial_requests enable row level security/i);
  }
  assert.match(mig118, /create or replace function public\.cleanup_expired_profile_effect_trials/i);
  assert.match(mig118, /create or replace function public\.submit_profile_effect_trial_request/i);
  assert.match(mig118, /create or replace function public\.cancel_own_profile_effect_trial_request/i);
  assert.match(mig118, /create or replace function public\.super_admin_list_effect_trial_requests/i);
  assert.match(mig118, /create or replace function public\.super_admin_review_effect_trial_request/i);
  assert.match(mig118, /interval\s+'1 month'/i);
  assert.match(mig118, /'EFFECT_TRIAL_REQUESTED'/);
  assert.match(mig118, /'EFFECT_TRIAL_REJECTED'/);

  // Runtime test for approved trial congrats modal (is_permanent: false)
  const coreJs = read('js/core.js');
  const effectsJs = read('js/profile-effects.js');
  const appendedNodes = [];
  const createNode = (tag) => {
    const attrs = new Map();
    const listeners = new Map();
    const classSet = new Set();
    const children = [];
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      id: '',
      className: '',
      innerHTML: '',
      textContent: '',
      hidden: false,
      disabled: false,
      open: false,
      dataset: {},
      style: {},
      clientWidth: 260,
      clientHeight: 120,
      children,
      classList: {
        add: (...c) => c.forEach((x) => classSet.add(x)),
        remove: (...c) => c.forEach((x) => classSet.delete(x)),
        toggle: (x, f) => (f === undefined ? !classSet.delete(x) && Boolean(classSet.add(x)) : (f ? classSet.add(x) : classSet.delete(x))),
        contains: (x) => classSet.has(x)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      addEventListener: (ev, fn) => listeners.set(ev, fn),
      removeEventListener: (ev) => listeners.delete(ev),
      appendChild: (ch) => { children.push(ch); return ch; },
      prepend: noop,
      querySelector: (sel) => {
        if (!sel.startsWith('#')) return null;
        const targetId = sel.slice(1);
        const match = node.innerHTML.includes(`id="${targetId}"`);
        if (!match) return null;
        const found = createNode('button');
        found.id = targetId;
        return found;
      },
      querySelectorAll: () => [],
      showModal() { this.open = true; },
      close() { this.open = false; },
      remove() { this.removed = true; },
      listeners
    };
    return node;
  };
  const noop = () => {};
  const loaderEl = createNode('div');
  const ctx = {
    window: null,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    document: {
      hidden: false,
      getElementById: (id) => (id === 'app-loader' ? loaderEl : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: noop,
      removeEventListener: noop,
      createElement: (tag) => createNode(tag),
      body: {
        dataset: { page: 'dashboard' },
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild: (n) => { appendedNodes.push(n); return n; },
        insertAdjacentHTML: noop,
        querySelector: () => null
      },
      documentElement: {
        dataset: {},
        style: { setProperty: noop, removeProperty: noop },
        classList: { add: noop, remove: noop, toggle: noop }
      }
    },
    location: { href: 'http://localhost/dashboard.html', pathname: '/dashboard.html', origin: 'http://localhost', search: '', replace: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: {},
    supabase: { createClient: () => ({ storage: null }) },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Event: class Event { constructor(type) { this.type = type; } },
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    setTimeout,
    clearTimeout,
    console
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.runInNewContext(`${effectsJs}\n${coreJs}`, ctx, { timeout: 5000 });

  const futureIso = new Date(Date.now() + 7 * 86400000).toISOString();
  const shown = ctx.window.Ipon.maybeShowEffectAwardModal({
    profile: { id: 'u1', full_name: 'Trial Saver', role: 'MEMBER', card_theme: 'midnight' },
    grants: [
      { effect_id: 'warp', is_permanent: false, expires_at: futureIso, granted_at: new Date().toISOString(), grant_message: 'Enjoy your 7-day trial!', acknowledged_at: null }
    ]
  });
  assert.equal(shown, true);
  const modal = appendedNodes.find((n) => n.id === 'ipon-effect-award-dialog');
  assert.ok(modal, 'trial approval should mount same celebration modal');
  assert.match(modal.innerHTML, /Congratulations/);
  assert.match(modal.innerHTML, /TRIAL PROFILE EFFECT APPROVED/);
  assert.match(modal.innerHTML, /Trial expires/);
  assert.match(modal.innerHTML, /Hyperdrive/);
  assert.match(modal.innerHTML, /Enjoy your 7-day trial!/);
  assert.doesNotMatch(modal.innerHTML, /Never expires|zero retention/i);
});
