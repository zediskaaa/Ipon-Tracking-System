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
    clip: noop,
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

test('profile effects engine exports all 62 effects and renders every effect cleanly without errors', () => {
  const code = read('js/profile-effects.js');
  const exclusiveCode = read('js/profile-effects-exclusive.js');
  const divineCode = read('js/profile-effects-divine.js');
  const deluxeCode = read('js/profile-effects-deluxe.js');
  const canvases = [];
  const noop = () => { };
  const numericErrors = [];
  let saveDepth = 0;
  const checkNums = (fn, args) => {
    for (const v of args) {
      if (typeof v === 'number' && !Number.isFinite(v)) {
        numericErrors.push(`${fn}(${args.join(',')})`);
      }
    }
  };
  const makeStrictCtx = () => {
    const base = makeStubCanvasContext();
    const wrap = (name) => (...args) => {
      checkNums(name, args);
      return base[name](...args);
    };
    return {
      ...base,
      save: () => { saveDepth += 1; },
      restore: () => { saveDepth -= 1; },
      moveTo: wrap('moveTo'),
      lineTo: wrap('lineTo'),
      quadraticCurveTo: wrap('quadraticCurveTo'),
      bezierCurveTo: wrap('bezierCurveTo'),
      arc: wrap('arc'),
      ellipse: wrap('ellipse'),
      translate: wrap('translate'),
      rotate: wrap('rotate'),
      scale: wrap('scale'),
      createLinearGradient: wrap('createLinearGradient'),
      createRadialGradient: wrap('createRadialGradient')
    };
  };
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
    getContext: () => makeStrictCtx(),
    remove: noop
  });

  const rafQueue = [];
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
    performance: { now: () => 1000 },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
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
  vm.runInNewContext(exclusiveCode, sandbox, { filename: 'js/profile-effects-exclusive.js' });
  vm.runInNewContext(divineCode, sandbox, { filename: 'js/profile-effects-divine.js' });
  vm.runInNewContext(deluxeCode, sandbox, { filename: 'js/profile-effects-deluxe.js' });

  const api = sandbox.window.IponProfileEffects;
  assert.ok(api);
  assert.equal(api.EFFECTS.length, 62);
  assert.equal(api.ALL_OPTIONS.length, 63);
  assert.deepEqual(
    [...api.EFFECTS.map((e) => e.id)],
    [
      'stardust', 'orbit', 'butterflies', 'koi', 'robots', 'drones',
      'holo', 'glitch', 'fireflies', 'petals', 'singularity', 'warp',
      'jelly', 'astro', 'constellation', 'sigil',
      'laurel', 'scholar', 'circuit', 'neural',
      'blueprint', 'atelier', 'vetpulse', 'sanctuary',
      'iponcoins', 'iponsprout', 'iponvault',
      'orrery', 'diploma', 'cybergrid', 'fibercloud',
      'stainedglass', 'cantilever', 'biolumfauna', 'botanicvet',
      'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
      'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
      'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune', 'ex_early_user',
      'divine_meridian', 'divine_boreal', 'divine_opal', 'divine_imperial', 'divine_hellebore',
      'deluxe_aureate', 'deluxe_parure', 'deluxe_nocturne',
      'deluxe_nacre', 'deluxe_malachite', 'deluxe_argent', 'deluxe_calibre'
    ]
  );
  assert.equal(api.CATEGORIES[1], 'Divine');
  assert.equal(api.CATEGORIES[2], 'Deluxe');
  assert.equal(api.EFFECTS.filter((e) => e.cat === 'Deluxe' && e.rare === 3 && e.fullCard).length, 7);
  assert.equal(api.EFFECTS.filter((e) => e.cat === 'Divine').length, 5);
  assert.ok(api.CATEGORIES.includes('Exclusive'), 'Missing category Exclusive');
  assert.equal(api.RARITIES[3], 'Mythic');
  const exclusives = api.EFFECTS.filter((e) => e.cat === 'Exclusive');
  assert.equal(exclusives.length, 15, 'Category Exclusive must include the 14 cinematic effects and founding recognition');
  assert.equal(exclusives.every((e) => e.rare === 3 && e.fullCard === true), true, 'Every Exclusive effect must be Mythic (rare: 3) and fullCard: true');
  assert.ok(api.CATEGORIES.includes('myIPON'), 'Missing category myIPON');
  assert.equal(api.EFFECTS.filter((e) => e.cat === 'myIPON').length, 3, 'Category myIPON must have 3 distinct effects');
  for (const cat of ['Education', 'Information Technology', 'Architecture', 'Veterinary Medicine']) {
    assert.ok(api.CATEGORIES.includes(cat), `Missing category ${cat}`);
    assert.equal(api.EFFECTS.filter((e) => e.cat === cat).length, 4, `Category ${cat} must have 4 distinct effects`);
  }
  assert.equal(api.normalizeEffectId(' SIGIL '), 'sigil');
  assert.equal(api.normalizeEffectId(' SANCTUARY '), 'sanctuary');
  assert.equal(api.normalizeEffectId(' IPONCOINS '), 'iponcoins');
  assert.equal(api.normalizeEffectId(' EX_SOVEREIGN '), 'ex_sovereign');
  assert.equal(api.normalizeEffectId('unknown'), 'none');
  assert.equal(api.getEffect('singularity').rare, 2);
  assert.equal(api.getEffect('ex_phoenix').rare, 3);
  assert.equal(api.getEffect('ex_phoenix').cat, 'Exclusive');
  assert.equal(api.getEffect('iponcoins').cat, 'myIPON');
  assert.equal(api.getEffect('iponcoins').fullCard, true);
  assert.equal(api.getEffect('stardust').fullCard, true);
  assert.equal(api.EFFECTS.every((e) => e.fullCard === true), true, 'Every profile effect must support full-profile coverage');
  assert.equal(api.NONE_EFFECT.fullCard ?? false, false);
  assert.equal(api.getEffect('laurel').cat, 'Education');
  assert.equal(api.getEffect('circuit').cat, 'Information Technology');
  assert.equal(api.getEffect('blueprint').cat, 'Architecture');
  assert.equal(api.getEffect('vetpulse').cat, 'Veterinary Medicine');

  const fxb = fakeCanvas();
  const fxf = fakeCanvas();
  const host = {
    dataset: {},
    classList: { contains: (c) => c === 'effects-card' },
    querySelector(sel) {
      if (sel === 'canvas.fxb') return fxb;
      if (sel === 'canvas.fxf') return fxf;
      return null;
    },
    prepend: noop,
    appendChild: noop
  };
  for (const [dim, geom] of [
    [[340, 380], () => ({ cx: 60, cy: 102, ra: 36 })],
    [[220, 147], () => ({ cx: 110, cy: 71, ra: 25 })]
  ]) {
    fxb.clientWidth = fxb.offsetWidth = fxf.clientWidth = fxf.offsetWidth = dim[0];
    fxb.clientHeight = fxb.offsetHeight = fxf.clientHeight = fxf.offsetHeight = dim[1];
    const stage = api.mountStage(host, {
      effectId: 'stardust',
      geometryFn: geom,
      fps: 60
    });
    let simNow = 1000;
    for (const effect of api.ALL_OPTIONS) {
      saveDepth = 0;
      assert.doesNotThrow(() => stage.setEffect(effect.id), `Failed rendering ${effect.id}`);
      assert.equal(host.dataset.effectScope, effect.fullCard ? 'full' : undefined, `Unexpected effectScope for ${effect.id}`);
      const cinematic = ['Divine', 'Deluxe'].includes(effect.cat);
      assert.equal(host.dataset.effectFamily, cinematic ? effect.cat.toLowerCase() : undefined);
      const tick = rafQueue[rafQueue.length - 1];
      if (tick) {
        // Exclusive effects run 4 distinct ~6.2s scenes (24.8s full loop); step monotonically by 50ms (dt cap)
        const steps = cinematic ? 500 : effect.cat === 'Exclusive' && dim[0] === 340 ? 520 : 12;
        for (let i = 0; i < steps; i += 1) {
          simNow += 50;
          tick(simNow);
        }
      }
      assert.equal(saveDepth, 0, `Unbalanced canvas save/restore in ${effect.id}`);
    }
    stage.destroy();
    assert.equal(host.dataset.effectScope, undefined, 'destroy() must clear data-effect-scope');
    assert.equal(host.dataset.effectFamily, undefined, 'destroy() must clear data-effect-family');
  }
  assert.deepEqual(numericErrors, [], `Non-finite canvas coordinates detected: ${numericErrors.slice(0, 5).join(', ')}`);

  const exitAnimations = [];
  fxb.animate = fxf.animate = (keyframes) => {
    assert.deepEqual([...keyframes].map(({ opacity }) => opacity), [1, 0]);
    const animation = { cancel() { this.cancelled = true; } };
    exitAnimations.push(animation);
    return animation;
  };
  const transition = api.mountStage(host, { effectId: 'divine_meridian', geometryFn: () => ({ cx: 110, cy: 71, ra: 25 }) });
  transition.setEffect('divine_opal');
  transition.setEffect('none');
  assert.equal(exitAnimations.length, 2, 'Rapid clicks must share the outgoing effect fade');
  assert.equal(host.dataset.effectScope, 'full', 'Do not clear the outgoing effect before the fade');
  exitAnimations[1].onfinish();
  assert.equal(host.dataset.effectScope, undefined, 'Use the latest selection when the fade finishes');
  assert.equal(exitAnimations.every((effect) => effect.cancelled), true);
  transition.setEffect('deluxe_argent');
  transition.setEffect('divine_opal');
  assert.equal(exitAnimations.length, 4, 'Leaving Deluxe must also fade both canvases');
  transition.destroy();
  assert.equal(exitAnimations.every((effect) => effect.cancelled), true, 'Destroy must release unfinished fades');
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
  assert.doesNotMatch(core, /account-card-colors|data-card-color/);
  assert.match(core, /dialog\.querySelector\('#effects-theme-dock'\)\?\.addEventListener\('click'/);
  assert.match(css, /\.effects-dock button:focus-visible/);

  // Balanced <dialog> tags & unique IDs in super-admin.html + Effects tab
  const opens = (superAdminHtml.match(/<dialog\b/g) || []).length;
  const closes = (superAdminHtml.match(/<\/dialog>/g) || []).length;
  assert.equal(opens, closes, 'Unbalanced <dialog> tags in super-admin.html');
  const ids = [...superAdminHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs in super-admin.html');

  assert.match(core, /\['effects',\s*'super-admin\.html#effects',\s*'Profile effects'/);
  assert.match(superAdminHtml, /id="effects"[^>]*data-platform-view="effects"/);
  assert.match(superAdminHtml, /id="effect-grant-dialog"/);
  assert.match(superAdminHtml, /id="effect-duration-preset"/);
  assert.match(superAdminHtml, /id="effect-custom-expiry"/);
  assert.match(superAdminHtml, /id="effect-remove-dialog"/);
  assert.match(superAdminJs, /super_admin_list_profile_effects/);
  assert.match(superAdminJs, /super_admin_grant_profile_effects/);
  assert.match(superAdminJs, /super_admin_revoke_profile_effect/);

  // Celebration modal & Gallery & Popover runtime
  assert.match(core, /function maybeShowEffectAwardModal\(/);
  assert.match(core, /PROFILE EFFECT UNLOCKED/);
  assert.match(core, /TRIAL PROFILE EFFECT UNLOCKED/);
  assert.doesNotMatch(core, /Never expires|zero retention expiry|Locked · not unlocked yet/i);
  assert.doesNotMatch(superAdminJs, /Awaiting claim' : ' · Never expires'|Effects never expire/);
  assert.doesNotMatch(superAdminHtml, /Never expire|no inactivity retention/i);
  assert.match(core, /function openProfileEffectsDialog\(/);
  assert.match(core, /function openTrialRequestModal\(/);
  assert.match(core, /effects-trial-request-dialog/);
  assert.match(core, /Request a trial effect/);
  assert.doesNotMatch(core, /<span>Try "/);
  assert.match(core, /submit_profile_effect_trial_request/);
  assert.match(core, /cancel_own_profile_effect_trial_request/);
  assert.match(core, /equip_own_profile_effect/);
  assert.match(css, /@media \(max-width: 900px\)\s*\{[\s\S]*?\.effects-side\s*\{\s*display:\s*contents;/);
  assert.match(css, /\.effect-trial-req-dialog\s*\{/);
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
  assert.match(modal.innerHTML, /TRIAL PROFILE EFFECT UNLOCKED/);
  assert.match(modal.innerHTML, /Trial expires/);
  assert.match(modal.innerHTML, /Hyperdrive/);
  assert.match(modal.innerHTML, /Enjoy your 7-day trial!/);
  assert.doesNotMatch(modal.innerHTML, /Never expires|zero retention/i);

  const mig119 = read('database/migrations/20261118_119_effect_grant_trials.sql');
  const mig120 = read('database/migrations/20261118_120_breadspanish_all_effects.sql');
  const mig121 = read('database/migrations/20261118_121_restrict_creator_all_effects.sql');
  const saJs = read('js/super-admin.js');
  const msgJs = read('js/messages.js');
  const appCss = read('css/app.css');
  assert.match(mig119, /super_admin_grant_profile_effects\([^)]*p_duration_days integer default null,\s*p_expires_at timestamptz default null/i);
  assert.match(mig119, /'is_permanent',\s*v_is_permanent/);
  assert.match(mig120, /'sigil'/);
  assert.match(mig121, /create or replace function public\.is_creator_owner_account\(/i);
  assert.doesNotMatch(mig121, /is_protected_retention_account/);
  assert.match(mig121, /delete from public\.profile_effect_grants g/i);
  assert.match(saJs, /effectDurationPreset/);
  assert.match(saJs, /p_duration_days:\s*duration\.durationDays,\s*p_expires_at:\s*duration\.expiresAt/);
  assert.match(coreJs, /const hasAllEffectsAccess =/);
  assert.doesNotMatch(coreJs, /<dialog class="account-dialog" id="account-dialog"[\s\S]*?<header class="account-dialog-header">/);
  assert.match(coreJs, /<section class="account-card account-profile-card"><button class="dialog-close account-dialog-close" data-account-close/);
  assert.match(appCss, /\.account-profile-card>\.account-dialog-close\{[^}]*width:28px;height:28px;flex:0 0 28px;aspect-ratio:1 \/ 1;[^}]*border-radius:50%/);
  assert.match(appCss, /\.account-profile-identity strong\{[^}]*white-space:normal;/);
  assert.match(appCss, /\.msg-welcome-avatar \.presence-dot\s*\{[^}]*width:\s*20px;\s*height:\s*20px;/);
  assert.match(msgJs, /avatar-presence-wrap msg-avatar-wrap\$\{wrapCls/);
});

test('Migration 122-124, Connect Apps X (Twitter) + drag reorder UI, uniform SVG logos, and bio redirect links validate safely', () => {
  const mig122 = read('database/migrations/20261118_122_social_app_links.sql');
  const mig123 = read('database/migrations/20261118_123_social_app_order.sql');
  const mig124 = read('database/migrations/20261118_124_social_app_x.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const msgJs = read('js/messages.js');
  const appCss = read('css/app.css');
  const effectsJs = read('js/profile-effects.js');

  // 1. SQL schema & RPC contracts
  assert.match(schema, /add column if not exists social_links jsonb not null default '\{\}'::jsonb/i);
  assert.match(schema, /profiles_social_links_object_check/i);
  assert.match(mig122, /create or replace function public\.sanitize_social_app_links\(/i);
  assert.match(mig122, /create or replace function public\.update_own_social_links\(/i);
  assert.match(mig122, /'social_links',\s*case\s+when v_profile\.id <> auth\.uid\(\) and public\.is_user_blocked_between\(auth\.uid\(\), v_profile\.id\) then '\{\}'::jsonb/i);
  assert.match(mig122, /'social_links',\s*case\s+when v_blocked_me then '\{\}'::jsonb else public\.sanitize_social_app_links\(v_target\.social_links, false\) end/i);
  assert.match(mig122, /grant execute on function public\.update_own_social_links\(jsonb\) to authenticated/i);
  assert.match(mig123, /create or replace function public\.sanitize_social_app_links\(/i);
  assert.match(mig123, /p_links \? '_order'/i);
  assert.match(mig123, /jsonb_build_object\('_order',\s*to_jsonb\(v_clean_order\)\)/i);
  assert.match(mig124, /array\['telegram', 'instagram', 'facebook', 'threads', 'x', 'discord'\]/i);
  assert.match(mig124, /when 'x' then v_host in \('x\.com', 'www\.x\.com', 'mobile\.x\.com', 'twitter\.com', 'www\.twitter\.com', 'mobile\.twitter\.com'\)/i);

  // 2. UI markup, drag preview, messaging bio slots & uniform squircle CSS
  assert.match(coreJs, /id="quick-effects-open"[^>]*>Browse effects<\/button><\/div><div class="account-card-effects-row account-card-connect-row" id="quick-connect-apps-card"[\s\S]*?<form id="quick-profile-form"/);
  assert.match(coreJs, /id="quick-connect-apps-card"/);
  assert.match(coreJs, /id="quick-connect-apps-open"/);
  assert.match(coreJs, /id="connect-apps-dialog"/);
  assert.match(coreJs, /id="connect-apps-modal-preview"/);
  assert.match(coreJs, /id="connect-apps-drag-hint"/);
  assert.match(coreJs, /id="quick-connect-apps-form"/);
  assert.match(coreJs, /id="quick-connect-apps-preview"/);
  assert.match(coreJs, /class="effects-card-bio"/);
  assert.match(coreJs, /class="effects-card-apps"/);
  assert.match(coreJs, /renderSocialAppLinksHtml\(previewSocialLinks,\s*\{\s*variant:\s*'effects'\s*\}\)/);
  assert.match(coreJs, /id="quick-app-\$\{app\.key\}"/);
  for (const key of ['telegram', 'instagram', 'facebook', 'threads', 'x', 'discord']) {
    assert.match(coreJs, new RegExp(`key:\\s*'${key}'`));
  }
  assert.match(coreJs, /bindConnectAppsPreviewDrag/);
  assert.match(coreJs, /serializeSocialLinks\(check\.normalized,\s*modalAppsOrder\)/);
  assert.match(coreJs, /rpc\('update_own_social_links',\s*\{\s*p_links:\s*payload\s*\}/);
  assert.match(msgJs, /class="msg-pop-apps-slot"/);
  assert.match(msgJs, /renderSocialAppLinksHtml\?\.\(conv\.social_links,\s*\{\s*variant:\s*'welcome'\s*\}\)/);
  assert.match(msgJs, /renderSocialAppLinksHtml\?\.\(conv\.social_links,\s*\{\s*variant:\s*'drawer'\s*\}\)/);
  assert.match(appCss, /\.social-apps-strip\s*\{[^}]*display:\s*flex;/);
  assert.match(appCss, /\.social-app-tile\s*\{[^}]*width:\s*24px;\s*height:\s*24px;[^}]*border-radius:\s*7px;/);
  assert.match(appCss, /button\.social-app-tile\.is-draggable\s*\{[^}]*touch-action:\s*none;/);
  assert.match(appCss, /button\.social-app-tile\.is-draggable\.is-dragging\s*\{[^}]*cursor:\s*grabbing;/);
  assert.match(appCss, /\.account-connect-drag-hint\s*\{/);
  assert.match(appCss, /\.account-card-effects-row\.account-card-connect-row\s*\{/);
  assert.match(appCss, /\.social-app-tile\.is-telegram\s*\{/);
  assert.match(appCss, /\.social-app-tile\.is-instagram\s*\{/);
  assert.match(appCss, /\.social-app-tile\.is-facebook\s*\{/);
  assert.match(appCss, /\.social-app-tile\.is-threads\s*\{/);
  assert.match(appCss, /\.social-app-tile\.is-x\s*\{/);
  assert.match(appCss, /\.social-app-tile\.is-discord\s*\{/);
  assert.doesNotMatch(appCss, /a\.social-app-tile:hover/);
  assert.match(appCss, /\.account-app-field \.account-app-error\s*\{[^}]*min-height:\s*16px;[^}]*visibility:\s*hidden;/);
  assert.doesNotMatch(appCss, /truncated for diff preview/i);
  assert.match(appCss, /\.budget-category-card\s*\{[^}]*border-radius:\s*22px;[^}]*box-shadow:\s*var\(--budget-shadow\);/s);
  assert.match(appCss, /\.budget-category-card::before\s*\{[^}]*height:\s*4px;/s);
  assert.match(appCss, /\.budget-cat-pct-pill\s*\{[^}]*border-radius:\s*999px;/s);
  assert.match(appCss, /\.budget-add-btn\s*\{[^}]*border-radius:\s*999px;\s*border:\s*1px solid var\(--budget-line\);/s);

  // 3. Runtime VM verification of URL validation, security blocking & HTML rendering
  const noop = () => {};
  const makeNode = (tag = 'div') => ({
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    innerHTML: '',
    textContent: '',
    hidden: false,
    dataset: {},
    style: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    setAttribute: noop,
    getAttribute: () => null,
    addEventListener: noop,
    removeEventListener: noop,
    appendChild: (c) => c,
    querySelector: () => null,
    querySelectorAll: () => []
  });
  const loaderEl = makeNode('div');
  const ctx = {
    window: null,
    URL,
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
      createElement: (tag) => makeNode(tag),
      body: {
        dataset: { page: 'dashboard' },
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        appendChild: (n) => n,
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

  const ipon = ctx.window.Ipon;
  assert.equal(ipon.normalizeSocialAppUrl('telegram', '@zediskaaa'), 'https://t.me/zediskaaa');
  assert.equal(ipon.normalizeSocialAppUrl('instagram', 'http://instagram.com/zediskaaa'), 'https://instagram.com/zediskaaa');
  assert.equal(ipon.normalizeSocialAppUrl('facebook', 'fb.com/zediskaaa'), 'https://fb.com/zediskaaa');
  assert.equal(ipon.normalizeSocialAppUrl('threads', '@zed.monteverde'), 'https://www.threads.net/@zed.monteverde');
  assert.equal(ipon.normalizeSocialAppUrl('x', '@zediskaaa'), 'https://x.com/zediskaaa');
  assert.equal(ipon.normalizeSocialAppUrl('x', 'zediskaaa'), 'https://x.com/zediskaaa');
  assert.equal(ipon.normalizeSocialAppUrl('x', 'twitter.com/zediskaaa'), 'https://twitter.com/zediskaaa');
  assert.equal(ipon.normalizeSocialAppUrl('discord', '123456789012345678'), 'https://discord.com/users/123456789012345678');
  assert.equal(ipon.normalizeSocialAppUrl('discord', 'https://discord.gg/iponcommunity'), 'https://discord.gg/iponcommunity');

  // Security rejections
  assert.equal(ipon.normalizeSocialAppUrl('telegram', 'javascript:alert(1)'), '');
  assert.equal(ipon.normalizeSocialAppUrl('instagram', 'https://evil.example/zediskaaa'), '');
  assert.equal(ipon.normalizeSocialAppUrl('facebook', 'https://facebook.com/'), '');
  assert.ok(ipon.validateSocialAppInput('x', '@handle_too_long_16').error, 'x handle over 15 chars returns error');
  assert.ok(ipon.validateSocialAppInput('x', 'https://evil.com/user').error, 'foreign x domain returns error');
  assert.ok(ipon.validateSocialAppInput('discord', '@handleonly').error, 'discord handle-only input returns helpful error');
  assert.ok(ipon.validateSocialAppInput('threads', 'https://evil.com/user').error, 'foreign domain returns error');

  const clean = ipon.sanitizeSocialLinks({
    telegram: '@zediskaaa',
    instagram: 'https://www.instagram.com/zediskaaa',
    facebook: 'https://www.facebook.com/zediskaaa',
    threads: '@zediskaaa',
    x: 'https://x.com/zediskaaa',
    discord: 'https://discord.gg/myipon',
    ignored: 'https://evil.com/phish'
  });
  assert.deepEqual(Object.keys(clean), ['telegram', 'instagram', 'facebook', 'threads', 'x', 'discord']);

  const html = ipon.renderSocialAppLinksHtml(clean, { variant: 'popover' });
  assert.match(html, /class="social-apps-strip is-popover"/);
  for (const key of ['telegram', 'instagram', 'facebook', 'threads', 'x', 'discord']) {
    assert.match(html, new RegExp(`<a class="social-app-tile is-${key}"[^>]*target="_blank" rel="noopener noreferrer"`));
    assert.match(html, new RegExp(`data-social-app-link="${key}"`));
  }
  assert.equal((html.match(/<a class="social-app-tile /g) || []).length, 6);
  assert.equal((html.match(/<svg viewBox="0 0 24 24"/g) || []).length, 6);
  assert.equal(ipon.renderSocialAppLinksHtml({}, { variant: 'popover' }), '');
  assert.match(ipon.renderSocialAppLinksHtml({}, { variant: 'preview', showEmpty: true }), /social-apps-empty/);

  // 4. Custom order normalization, drag-reorder helpers, serialization & ordered HTML reflection
  assert.deepEqual(
    Array.from(ipon.normalizeSocialAppOrder(['discord', 'x', 'threads', 'invalid', 'discord'], clean)),
    ['discord', 'x', 'threads', 'telegram', 'instagram', 'facebook']
  );

  // Reordering works cleanly even when inactive apps sit between active slots
  const reorderedForward = Array.from(ipon.reorderSocialAppKeys(
    ['telegram', 'instagram', 'facebook', 'threads', 'x', 'discord'],
    'telegram',
    'discord',
    true
  ));
  assert.deepEqual(reorderedForward, ['instagram', 'facebook', 'threads', 'x', 'discord', 'telegram']);
  const reorderedBack = Array.from(ipon.reorderSocialAppKeys(reorderedForward, 'x', 'instagram', false));
  assert.deepEqual(reorderedBack, ['x', 'instagram', 'facebook', 'threads', 'discord', 'telegram']);

  // Sanitization preserves explicit _order while keeping _order non-enumerable in Object.keys & JSON
  const customClean = ipon.sanitizeSocialLinks({
    threads: '@zediskaaa',
    x: '@zediskaaa',
    discord: 'https://discord.gg/myipon',
    telegram: '@zediskaaa',
    _order: ['x', 'discord', 'telegram']
  });
  assert.deepEqual(Object.keys(customClean), ['x', 'discord', 'telegram', 'threads']);
  assert.deepEqual(Object.keys(ipon.sanitizeSocialLinks(customClean)), ['x', 'discord', 'telegram', 'threads']);
  assert.equal('_order' in JSON.parse(JSON.stringify(customClean)), false);

  // Legacy DB objects without _order stay in canonical SOCIAL_APPS order instead of Postgres jsonb sort order
  const legacyClean = ipon.sanitizeSocialLinks({
    threads: 'https://www.threads.net/@zediskaaa',
    x: 'https://x.com/zediskaaa',
    discord: 'https://discord.gg/myipon',
    telegram: 'https://t.me/zediskaaa'
  });
  assert.deepEqual(Object.keys(legacyClean), ['telegram', 'threads', 'x', 'discord']);

  // Serialize includes validated _order array for Postgres persistence
  const serialized = ipon.serializeSocialLinks(clean, ['x', 'threads', 'discord', 'telegram', 'instagram', 'facebook']);
  assert.deepEqual(Array.from(serialized._order), ['x', 'threads', 'discord', 'telegram', 'instagram', 'facebook']);

  // Draggable modal preview renders button handles in custom order; profile popover reflects exact same order as links
  const serializedClean = ipon.sanitizeSocialLinks(serialized);
  const previewHtml = ipon.renderSocialAppLinksHtml(serializedClean, { variant: 'preview', draggable: true });
  assert.doesNotMatch(previewHtml, /<a\b/);
  const previewOrder = Array.from(previewHtml.matchAll(/data-drag-app="([^"]+)"/g), (m) => m[1]);
  assert.deepEqual(previewOrder, ['x', 'threads', 'discord', 'telegram', 'instagram', 'facebook']);

  const popoverHtml = ipon.renderSocialAppLinksHtml(serializedClean, { variant: 'popover' });
  const popoverOrder = Array.from(popoverHtml.matchAll(/data-social-app-link="([^"]+)"/g), (m) => m[1]);
  assert.deepEqual(popoverOrder, ['x', 'threads', 'discord', 'telegram', 'instagram', 'facebook']);
});

test('Profile Effects gallery tiles and award/admin previews display actual user DP with hidden initials fallback', () => {
  const coreJs = read('js/core.js');
  const appCss = read('css/app.css');
  const superAdminJs = read('js/super-admin.js');

  assert.match(coreJs, /<div class="mav">\$\{avatarInner\}<\/div>/);
  assert.match(coreJs, /galleryAvatarUrl[\s\S]*data-avatar-img><span class="avatar-fallback-inner" hidden>/);
  assert.match(coreJs, /awardAvatarUrl[\s\S]*data-avatar-img><span class="avatar-fallback-inner" hidden>/);
  assert.match(coreJs, /<div class="mav">\$\{avatarInner\}<\/div>[\s\S]*bindAvatarFallbacks\(dialog\);/);
  assert.match(appCss, /\.effects-tile \.tstage \.mav\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(appCss, /\.effects-tile \.tstage \.mav img\s*\{[^}]*object-fit:\s*cover;/s);
  assert.match(superAdminJs, /effectGrantPreviewAvatar\.innerHTML[\s\S]*data-avatar-img><span class="avatar-fallback-inner" hidden>/);
  assert.match(superAdminJs, /effectTrialPreviewAvatar\.innerHTML[\s\S]*data-avatar-img><span class="avatar-fallback-inner" hidden>/);
});

test('Migration 160, schema.sql, full-profile CSS scope, and HTML cache-busters wire all 19 themed profile effects end to end', () => {
  const mig160 = read('database/migrations/20261122_160_full_profile_myipon_and_themed_effects.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');
  const sw = read('sw.js');

  const themedIds = [
    'laurel', 'scholar', 'orrery', 'diploma',
    'circuit', 'neural', 'cybergrid', 'fibercloud',
    'blueprint', 'atelier', 'stainedglass', 'cantilever',
    'vetpulse', 'sanctuary', 'biolumfauna', 'botanicvet',
    'iponcoins', 'iponsprout', 'iponvault'
  ];
  for (const sql of [mig160, schema]) {
    assert.match(sql, /'20261122_160'/);
    assert.match(sql, /create or replace function public\.is_valid_profile_effect_id\(p_effect_id text\)/i);
    assert.match(sql, /create or replace function public\.profile_effect_label\(p_effect_id text\)/i);
    assert.match(sql, /create or replace function public\.get_own_profile_effects\(\)/i);
    assert.match(sql, /create or replace function public\.equip_own_profile_effect\(p_effect_id text\)/i);
    assert.match(sql, /create or replace function public\.acknowledge_my_profile_effects\(/i);
    assert.match(sql, /create or replace function public\.submit_profile_effect_trial_request\(/i);
    assert.match(sql, /create or replace function public\.super_admin_grant_profile_effects\(/i);
    for (const id of themedIds) {
      assert.match(sql, new RegExp(`'${id}'`), `SQL missing profile effect id "${id}"`);
    }
  }
  assert.match(css, /\.effects-tile \.cat\s*\{[^}]*white-space:\s*normal;[^}]*max-width:\s*100%;/);
  assert.match(css, /\.effects-card\[data-effect-scope="full"\]\s*>\s*canvas\s*\{[^}]*height:\s*100%\s*!important;[^}]*mask-image:\s*none;/s);
  assert.match(css, /\.msg-profile-popover\[data-effect-scope="full"\]\s*>\s*canvas\.fxb,\s*\.msg-profile-popover\[data-effect-scope="full"\]\s*>\s*canvas\.fxf\s*\{[^}]*height:\s*100%\s*!important;/s);
  assert.match(css, /\.msg-profile-popover \.msg-pop-apps-slot,/);
  assert.match(sw, /ipon-shell-v188/);
  assert.match(sw, /'js\/profile-effects-exclusive\.js'/);
  for (const file of ['dashboard.html', 'account.html', 'super-admin.html', 'settings.html']) {
    const html = read(file);
    assert.match(html, /js\/profile-effects\.js\?v=20261122-07/);
    assert.match(html, /js\/profile-effects-exclusive\.js\?v=20261122-07/);
    assert.match(html, /css\/app\.css\?v=20261122-11/);
  }
});

test('Migration 161, schema.sql, Exclusive/Mythic CSS badges, and super-admin pills wire all 14 Exclusive 4-scene looping effects', () => {
  const mig161 = read('database/migrations/20261122_161_exclusive_profile_effects.sql');
  const schema = read('database/schema.sql');
  const css = read('css/app.css');
  const saJs = read('js/super-admin.js');
  const exJs = read('js/profile-effects-exclusive.js');
  const exclusiveIds = [
    'ex_phoenix', 'ex_dragon', 'ex_eclipse', 'ex_tempest', 'ex_blossom',
    'ex_frost', 'ex_sovereign', 'ex_cybermech', 'ex_prism', 'ex_abyss',
    'ex_valkyrie', 'ex_leviathan', 'ex_chronos', 'ex_kitsune'
  ];
  for (const sql of [mig161, schema]) {
    assert.match(sql, /'20261122_161'/);
    for (const id of exclusiveIds) {
      assert.match(sql, new RegExp(`'${id}'`), `SQL missing Exclusive effect id "${id}"`);
    }
  }
  for (const banned of ['drawShockRings', 'drawGatherWisps', 'drawWaveSweep', 'drawMeteorRain', 'drawWingPlume', 'drawRuneRing', 'drawHelixVortex', 'cardFrameMetrics', 'drawCardCorners']) {
    assert.equal(exJs.includes(banned), false, `Exclusive effects must not reuse generic template helper "${banned}"`);
  }
  assert.match(exJs, /function castShadow\(/);
  assert.match(exJs, /function drawBevelRing\(/);
  assert.match(exJs, /function drawStruckCoin\(/);
  assert.match(css, /\.effects-tile \.rar3\s*\{/);
  assert.match(css, /\.effect-table-pill\.is-mythic\s*\{/);
  assert.match(saJs, /meta\.rare === 3 \? ' is-mythic'/);
});

test('founding effect is grant-only and recognized by the gallery and database', () => {
  const migration = read('database/migrations/20261122_162_early_user_profile_effect.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');
  const art = read('js/profile-effects-exclusive.js');
  for (const sql of [migration, schema]) {
    assert.match(sql, /'ex_early_user'/);
    assert.match(sql, /profile_effect_grants_early_user_permanent_check/);
    assert.match(sql, /Founders'' Grove/);
  }
  assert.match(core, /previewMeta\.id === 'ex_early_user'/);
  assert.match(art, /drawSculptedLeaf\(f/);
  assert.match(art, /drawStruckCoin\(f/);
});

test('Exclusive profile effects cannot request trials in UI or database', () => {
  const mig174 = read('database/migrations/20261122_174_block_exclusive_effect_trials.sql');
  const schema = read('database/schema.sql');
  const core = read('js/core.js');

  assert.match(mig174, /'20261122_174'/);
  assert.ok(schema.replace(/\r\n/g, '\n').includes(mig174.trim().replace(/\r\n/g, '\n')), 'schema.sql must include Migration 174');
  assert.match(mig174, /if v_effect like 'ex\\_\%' escape '\\' then[\s\S]*?Exclusive profile effects are not eligible for trial requests\./);
  assert.match(core, /effect\.cat !== 'Exclusive'/);
  assert.match(core, /function openTrialRequestModal\(previewMeta\) \{\s*if \(!canRequestTrial\(previewMeta\)\) return;/);
  assert.match(core, /if \(!canRequestTrial\(previewMeta\)\) \{\s*box\.hidden = true;\s*box\.innerHTML = '';\s*return;\s*\}/);
});

test('Divine effects can be equipped but cannot create a trial request or notify Super Admin', () => {
  const migration = read('database/migrations/20261122_175_divine_profile_effects.sql');
  const expanded = read('database/migrations/20261122_176_expand_divine_profile_effects.sql');
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');
  const core = read('js/core.js');
  const ids = migration.split('create or replace function public.profile_effect_label')[0];
  assert.ok(schema.includes(migration.trim().replace(/\r\n/g, '\n')));
  assert.ok(schema.includes(expanded.trim().replace(/\r\n/g, '\n')));
  for (const [id, label] of [
    ['divine_meridian', 'Meridian Observatory'], ['divine_boreal', 'Boreal Veil'], ['divine_opal', 'Opal Sanctum']
  ]) {
    assert.ok(ids.includes(`'${id}'`), `Database must recognize ${id}`);
    assert.ok(migration.includes(`when '${id}' then '${label}'`));
  }
  assert.match(migration, /check \(left\(lower\(btrim\(effect_id\)\), 7\) <> 'divine_'\)/);
  assert.match(migration, /if left\(v_effect, 7\) = 'divine_' then\s*raise exception[^;]+;\s*end if;[\s\S]*?insert into public\.profile_effect_trial_requests[\s\S]*?insert into public\.notifications/);
  const predicate = core.match(/const canRequestTrial = ([\s\S]*?);/)[1];
  const canRequestTrial = vm.runInNewContext(predicate);
  assert.equal(canRequestTrial({ id: 'divine_opal', cat: 'Divine' }), false);
  assert.equal(canRequestTrial({ id: 'divine_future', cat: 'Special' }), false);
  for (const [id, label] of [['divine_imperial', 'Imperial Reliquary'], ['divine_hellebore', 'Gilded Hellebore']]) {
    assert.ok(expanded.split('create or replace function public.profile_effect_label')[0].includes(`'${id}'`));
    assert.ok(expanded.includes(`when '${id}' then '${label}'`));
    assert.equal(canRequestTrial({ id, cat: 'Divine' }), false);
  }
  assert.equal(canRequestTrial({ id: 'ex_phoenix', cat: 'Exclusive' }), false);
  assert.equal(canRequestTrial({ id: 'stardust', cat: 'Cosmic' }), true);
  for (const file of fs.readdirSync(root).filter((entry) => entry.endsWith('.html'))) {
    const html = read(file);
    if (!html.includes('js/profile-effects-exclusive.js')) continue;
    assert.match(html, /js\/profile-effects-exclusive\.js[^<]*<\/script>\s*<script src="js\/profile-effects-divine\.js\?v=20261122-02"><\/script>\s*<script src="js\/profile-effects-deluxe\.js\?v=20261122-01"><\/script>\s*<script src="js\/core\.js/);
  }
  assert.match(read('sw.js'), /'js\/profile-effects-divine\.js'/);
});

test('all seven Deluxe scenes use three motion tracks, have award labels and reject member trials', () => {
  const migration = read('database/migrations/20261122_177_deluxe_profile_effects.sql').replace(/\r\n/g, '\n').trim();
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');
  assert.ok(schema.includes(migration));
  assert.doesNotMatch(schema, /^(?:as \$|\$;)$/m, 'SQL function bodies must use paired dollar delimiters');
  const art = read('js/profile-effects-deluxe.js');
  const scenes = art.split(/\n  register\('/).slice(1);
  assert.equal(scenes.length, 7);
  const eligible = vm.runInNewContext(read('js/core.js').match(/const canRequestTrial = ([\s\S]*?);/)[1]);
  for (const scene of scenes) {
    const [, suffix, name] = scene.match(/^([^']+)', '([^']+)'/);
    const id = 'deluxe_' + suffix;
    assert.equal([...scene.matchAll(/^\s{6}function \w+\(/gm)].length, 3, name);
    assert.ok(migration.split('create or replace function public.profile_effect_label')[0].includes("'" + id + "'"));
    assert.ok(migration.includes("when '" + id + "' then '" + name + "'"));
    assert.equal(eligible({ id, cat: 'Deluxe' }), false);
    assert.equal(eligible({ id, cat: 'Special' }), false);
  }
  assert.match(migration, /check \(left\(lower\(btrim\(effect_id\)\), 7\) <> 'deluxe_'\)/);
  assert.match(migration, /if left\(v_effect, 7\) = 'deluxe_' then\s*raise exception[^;]+;\s*end if;[\s\S]*?insert into public\.profile_effect_trial_requests[\s\S]*?insert into public\.notifications/);
  assert.match(read('sw.js'), /'js\/profile-effects-deluxe\.js'/);
});

test('profile effect categories use one compact accessible dropdown', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');
  assert.match(core, /<label class="effects-category-field" for="effects-category">[\s\S]*?<select id="effects-category" name="effects-category">/);
  assert.match(core, /api\.CATEGORIES\.map\(\(c\) => [^<]*<option value=/);
  assert.match(core, /querySelector\('#effects-category'\)\?\.addEventListener\('change'/);
  assert.doesNotMatch(core, /id="effects-chips"/);
  assert.match(css, /\.effects-filter-bar\s*\{[^}]*display:\s*flex;[^}]*margin-bottom:\s*16px;/);
  assert.match(css, /\.effects-category-field\s*\{[^}]*height:\s*44px;/);
  assert.match(css, /\.effects-category-field:focus-within\s*\{[^}]*outline:\s*2px solid #8ff0bf;/);
  assert.doesNotMatch(css, /\.effects-chip(?:\[|\s|\{|:)/);
});
