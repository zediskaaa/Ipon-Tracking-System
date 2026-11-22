import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Migration 184 and schema.sql strictly restrict creator_astral_sovereign and all creator_* effects to breadspanish231@gmail.com', () => {
  const mig = read('database/migrations/20261123_184_creator_astral_sovereign_effect.sql').replace(/\r\n/g, '\n');
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');

  assert.ok(schema.includes(mig.trim()), 'schema.sql must include Migration 184 verbatim');
  for (const sql of [mig, schema]) {
    assert.match(sql, /'20261123_184'/);
    assert.match(sql, /'creator_astral_sovereign'/);
    assert.match(sql, /when 'creator_astral_sovereign' then 'Astral Sovereign'/);
    assert.match(sql, /profile_effect_trial_requests_no_creator/);
    assert.match(sql, /check \(left\(lower\(btrim\(effect_id\)\), 8\) <> 'creator_'\)/);
    assert.match(sql, /create trigger profile_effect_grants_creator_only/i);
    assert.match(sql, /create trigger profiles_creator_only_equipped_effect/i);
    assert.match(sql, /set equipped_profile_effect = 'creator_astral_sovereign'/);
  }
});

test('Astral Sovereign delivers zero-teleport dt-integrated 360° effects, 3 card animations, 2 full-screen cinematics, and clean teardown', () => {
  const baseCode = read('js/profile-effects.js');
  const creatorCode = read('js/profile-effects-creator.js');
  const noop = () => { };
  const grad = () => ({ addColorStop: noop });
  const numericErrors = [];
  let saveDepth = 0;
  let arcCalls = 0;

  const makeCtx = () => {
    const check = (name) => (...args) => {
      if (name === 'arc') arcCalls += 1;
      for (const v of args) {
        if (typeof v === 'number' && !Number.isFinite(v)) numericErrors.push(`${name}(${args.join(',')})`);
      }
    };
    return {
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      clearRect: noop,
      fillRect: noop,
      strokeRect: noop,
      beginPath: noop,
      closePath: noop,
      clip: noop,
      fill: noop,
      stroke: noop,
      setTransform: noop,
      setLineDash: noop,
      drawImage: noop,
      save: () => { saveDepth += 1; },
      restore: () => { saveDepth -= 1; },
      moveTo: check('moveTo'),
      lineTo: check('lineTo'),
      quadraticCurveTo: check('quadraticCurveTo'),
      bezierCurveTo: check('bezierCurveTo'),
      arc: check('arc'),
      arcTo: check('arcTo'),
      ellipse: check('ellipse'),
      translate: check('translate'),
      rotate: check('rotate'),
      scale: check('scale'),
      createLinearGradient: (...args) => { check('createLinearGradient')(...args); return grad(); },
      createRadialGradient: (...args) => { check('createRadialGradient')(...args); return grad(); }
    };
  };

  const createdCanvases = [];
  const makeCanvas = (w, h) => {
    const c = {
      className: '',
      width: w,
      height: h,
      clientWidth: w,
      clientHeight: h,
      offsetWidth: w,
      offsetHeight: h,
      removed: false,
      setAttribute: noop,
      getContext: () => makeCtx(),
      remove() { this.removed = true; }
    };
    createdCanvases.push(c);
    return c;
  };

  const rafQueue = [];
  const playedSounds = [];
  let stoppedCount = 0;
  const store = new Map();
  const appendedToBody = [];
  const sandbox = {
    window: {
      innerWidth: 1280,
      innerHeight: 720,
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: false, addEventListener: noop }),
      Ipon: { isUiSoundEnabled: () => true },
      IponProfileEffectsSfx: {
        play: (kind) => { playedSounds.push(kind); return true; },
        stopAll: () => { stoppedCount += 1; }
      }
    },
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    document: {
      hidden: false,
      body: { appendChild: (n) => { appendedToBody.push(n); return n; } },
      createElement: () => makeCanvas(64, 64)
    },
    performance: { now: () => 1000 },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame: noop,
    Math, Date, Set, Map, Array, Object, String, Number, Boolean, console
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(baseCode, sandbox, { filename: 'js/profile-effects.js' });
  vm.runInNewContext(creatorCode, sandbox, { filename: 'js/profile-effects-creator.js' });

  const api = sandbox.window.IponProfileEffects;
  const meta = api.getEffect('creator_astral_sovereign');
  assert.equal(meta.id, 'creator_astral_sovereign');
  assert.equal(meta.cat, 'Creator');
  assert.deepEqual([...api.CREATOR_ANIM_MODES], ['auto', 'shake', 'pulse', 'burst', 'awakening', 'entrance']);

  // Verify 360° cohesive coverage pools (sides + top + bottom) and zero time-dilation teleport formulas
  assert.match(creatorCode, /const flankOrbCount = full \? 68 : 26;/);
  assert.match(creatorCode, /const topOrbCount = full \? 28 : 10;/);
  assert.match(creatorCode, /const bottomEmberCount = full \? 30 : 10;/);
  assert.doesNotMatch(creatorCode, /t \* (?:st\.rate|o\.speed) \* \(1 \+ surge/, 'Must integrate velocity via dt instead of multiplying raw t by changing surge');
  assert.match(baseCode, /stage\.build\(\{ preserveTime: true \}\)/, 'ResizeObserver must preserve animation time');

  const cssVars = new Map();
  const fxb = makeCanvas(340, 390);
  const fxf = makeCanvas(340, 390);
  const host = {
    dataset: { theme: 'mono' },
    style: {
      setProperty: (k, v) => cssVars.set(k, String(v)),
      removeProperty: (k) => cssVars.delete(k)
    },
    classList: { contains: (c) => c === 'effects-card' },
    closest: () => null,
    getBoundingClientRect: () => ({ left: 400, top: 120, width: 340, height: 390 }),
    querySelector: (sel) => {
      if (sel === 'canvas.fxb') return fxb;
      if (sel === 'canvas.fxf') return fxf;
      return null;
    },
    prepend: noop,
    appendChild: noop
  };

  const stage = api.mountStage(host, {
    effectId: 'creator_astral_sovereign',
    geometryFn: () => ({ cx: 56, cy: 100, ra: 36 }),
    fps: 60
  });
  const tick = rafQueue[rafQueue.length - 1];
  let simNow = 1000;
  const stepFrames = (count) => {
    for (let i = 0; i < count; i += 1) {
      saveDepth = 0;
      simNow += 50;
      tick(simNow);
      assert.equal(saveDepth, 0, 'Unbalanced canvas save/restore');
    }
  };

  // 1. Card Animations: Kinetic Shake, Dynamic Pulse, Quantum Burst
  api.setCreatorAnimMode('shake');
  assert.ok(playedSounds.includes('pfx-shake'));
  let sawShake = false;
  for (let i = 0; i < 36; i += 1) {
    stepFrames(1);
    if (Math.abs(parseFloat(cssVars.get('--holo-shake-x') || '0')) > 0.4) sawShake = true;
  }
  assert.equal(sawShake, true, 'Kinetic shake must animate dual-axis damped motion');

  api.setCreatorAnimMode('pulse');
  assert.ok(playedSounds.includes('pfx-pulse'));
  let sawPulse = false;
  for (let i = 0; i < 36; i += 1) {
    stepFrames(1);
    if (parseFloat(cssVars.get('--holo-pulse-scale') || '1') > 1.005) sawPulse = true;
  }
  assert.equal(sawPulse, true, 'Dynamic pulse must smoothly elevate scale');

  api.setCreatorAnimMode('burst');
  assert.ok(playedSounds.includes('pfx-burst'));
  stepFrames(40);

  // 2. Full-Screen Cinematic A: Energy Awakening
  api.setCreatorAnimMode('awakening');
  assert.ok(playedSounds.includes('pfx-awakening'));
  const awakeCanvas = appendedToBody.find((c) => c.className === 'pfx-cinema-canvas');
  assert.ok(awakeCanvas, 'Energy Awakening must mount full-screen .pfx-cinema-canvas');
  assert.equal(awakeCanvas.removed, false);
  stepFrames(105); // 5.25s -> finishes 5.0s animation cleanly and auto-unmounts
  assert.equal(awakeCanvas.removed, true, 'Energy Awakening overlay must auto-remove cleanly after finishing');

  // 3. Full-Screen Cinematic B: Legendary Entrance
  const beforeLen = appendedToBody.length;
  api.setCreatorAnimMode('entrance');
  assert.ok(playedSounds.includes('pfx-entrance'));
  const entranceCanvas = appendedToBody[beforeLen];
  assert.ok(entranceCanvas && entranceCanvas.className === 'pfx-cinema-canvas', 'Legendary Entrance must mount full-screen overlay');
  stepFrames(40); // mid-flight

  // 4. SFX Mute Toggle suppresses sound and stops active voice
  api.setEffectSfxEnabled(false);
  assert.equal(api.isEffectSfxEnabled(), false);
  const prevSfx = playedSounds.length;
  api.triggerCreatorAnimation('shake');
  assert.equal(playedSounds.length, prevSfx);

  // 5. Destroy cleans up mid-flight full-screen overlay, stops SFX, and removes CSS vars
  stage.destroy();
  assert.equal(entranceCanvas.removed, true, 'destroy() must remove active full-screen cinema canvas');
  assert.ok(stoppedCount >= 1, 'destroy() must stop active cinematic SFX');
  assert.equal(cssVars.size, 0);
  assert.ok(arcCalls > 800, 'Abundant 360° particles must render smoothly');
  assert.deepEqual(numericErrors, [], `Non-finite canvas args: ${numericErrors.slice(0, 5).join(', ')}`);
});

test('Hollywood SFX engine builds stereo hall reverb, pink/white noise sweeps, and synthesizes all 5 cues with anti-overlap voice crossfade', () => {
  const sfxCode = read('js/profile-effects-sfx.js');
  let convolverCreated = 0;
  let oscStarts = 0;
  let noiseStarts = 0;
  let voiceCrossfades = 0;

  const makeParam = () => ({
    value: 0.8,
    setValueAtTime: () => {},
    linearRampToValueAtTime: (v) => { if (v <= 0.0002) voiceCrossfades += 1; },
    exponentialRampToValueAtTime: () => {},
    cancelScheduledValues: () => {}
  });

  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.sampleRate = 44100;
      this.currentTime = 1.0;
      this.destination = { connect: () => {} };
    }
    createGain() { return { gain: makeParam(), connect: () => {} }; }
    createDynamicsCompressor() {
      return { threshold: makeParam(), knee: makeParam(), ratio: makeParam(), attack: makeParam(), release: makeParam(), connect: () => {} };
    }
    createConvolver() { convolverCreated += 1; return { buffer: null, connect: () => {} }; }
    createStereoPanner() { return { pan: makeParam(), connect: () => {} }; }
    createBiquadFilter() { return { type: 'lowpass', frequency: makeParam(), Q: makeParam(), connect: () => {} }; }
    createOscillator() {
      return { type: 'sine', frequency: makeParam(), detune: makeParam(), connect: () => {}, start: () => { oscStarts += 1; }, stop: () => {} };
    }
    createBuffer(_ch, len, rate) {
      return { sampleRate: rate, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      return { buffer: null, loop: false, connect: () => {}, start: () => { noiseStarts += 1; }, stop: () => {} };
    }
  }

  const sandbox = {
    window: { AudioContext: FakeAudioContext },
    Math, Date, Object, Array, Float32Array
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(sfxCode, sandbox, { filename: 'js/profile-effects-sfx.js' });

  const sfx = sandbox.window.IponProfileEffectsSfx;
  assert.deepEqual([...sfx.CUES], ['pfx-shake', 'pfx-pulse', 'pfx-burst', 'pfx-awakening', 'pfx-entrance']);
  for (const cue of sfx.CUES) {
    assert.equal(sfx.play(cue), true, `Must synthesize ${cue}`);
  }
  assert.equal(convolverCreated, 1, 'Must initialize cached stereo hall ConvolverNode reverb once');
  assert.ok(oscStarts >= 40, `Expected rich multi-layered oscillators across 5 cues, got ${oscStarts}`);
  assert.ok(noiseStarts >= 10, `Expected rich pink/white noise whooshes & air layers, got ${noiseStarts}`);
  assert.ok(voiceCrossfades >= 4, 'Re-triggering must smoothly crossfade out previous voice');
  sfx.stopAll();
});

test('DP cover-clipping root cause is eliminated (zero mask-image on card body/popover), controls expose all 5 animations, and Creator locking holds', () => {
  const core = read('js/core.js');
  const css = read('css/app.css');

  // 1. Root-cause fix: NO mask-image clipping on creator card children, explicit z-index & overflow: visible so entire DP is visible!
  const creatorCssBlock = css.slice(css.indexOf('/* Creator-Exclusive Sci-Fi Holographic Profile Effect'));
  assert.doesNotMatch(creatorCssBlock, /mask-image\s*:/, 'Creator CSS must NOT apply mask-image to card body (that clips negative-margin DP)');
  assert.match(creatorCssBlock, /:is\(\.effects-card, \.msg-profile-popover\)\[data-effect-family="creator"\] > :is\(\.effects-banner, \.msg-pop-cover\)\s*\{[^}]*position:\s*relative;\s*z-index:\s*0;/s);
  assert.match(creatorCssBlock, /:is\(\.effects-card, \.msg-profile-popover\)\[data-effect-family="creator"\] > :not\(canvas\):not\(\.effects-banner\):not\(\.msg-pop-cover\):not\(\.msg-pop-close\)\s*\{[^}]*position:\s*relative;\s*z-index:\s*3;\s*overflow:\s*visible;/s);
  assert.match(creatorCssBlock, /\.effects-card\[data-effect-family="creator"\] \.effects-card-avatar\s*\{[^}]*position:\s*relative;\s*z-index:\s*4;/s);
  assert.match(creatorCssBlock, /\.pfx-cinema-canvas\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*pointer-events:\s*none;/s);

  // 2. Gallery controls expose all 5 animations + SFX toggle + stop SFX on close
  for (const attr of [
    'data-creator-anim="auto"',
    'data-creator-anim="shake"',
    'data-creator-anim="pulse"',
    'data-creator-anim="burst"',
    'data-creator-anim="awakening"',
    'data-creator-anim="entrance"',
    'id="effects-creator-sfx-btn"'
  ]) {
    assert.ok(core.includes(attr), `js/core.js missing ${attr}`);
  }
  assert.match(core, /api\.stopEffectSfx\?\.\(\);/);
});

test('Astral Sovereign gimbal border tracks the live DP center relative to canvas origin (compensating host border and CSS transforms)', () => {
  const baseCode = read('js/profile-effects.js');
  const creatorCode = read('js/profile-effects-creator.js');
  const noop = () => { };
  const grad = () => ({ addColorStop: noop });
  const frontArcs = [];
  const makeCtx = (capture) => ({
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt',
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop, clip: noop, fill: noop, stroke: noop,
    setTransform: noop, setLineDash: noop, drawImage: noop, save: noop, restore: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arcTo: noop, ellipse: noop, translate: noop, rotate: noop, scale: noop,
    createLinearGradient: grad, createRadialGradient: grad,
    arc(x, y, r) { if (capture) frontArcs.push({ x, y, r }); }
  });

  // Host sits at (400, 120) with 1px border -> canvas padding-box sits at (401, 121)
  const canvasRect = { left: 401, top: 121, width: 338, height: 390 };
  const avatarRect = { left: 425, top: 187, width: 72, height: 72 };
  const fxb = { className: 'fxb', width: 338, height: 390, clientWidth: 338, clientHeight: 390, getBoundingClientRect: () => canvasRect, getContext: () => makeCtx(false) };
  const fxf = { className: 'fxf', width: 338, height: 390, clientWidth: 338, clientHeight: 390, getBoundingClientRect: () => canvasRect, getContext: () => makeCtx(true) };
  const avEl = { getBoundingClientRect: () => avatarRect };
  const host = {
    dataset: { theme: 'mono' },
    style: { setProperty: noop, removeProperty: noop },
    classList: { contains: (c) => c === 'effects-card' },
    closest: () => null,
    getBoundingClientRect: () => ({ left: 400, top: 120, width: 340, height: 392 }),
    querySelector: (sel) => {
      if (sel === 'canvas.fxb') return fxb;
      if (sel === 'canvas.fxf') return fxf;
      if (sel.includes('.effects-card-avatar') || sel.includes('.avatar-circle')) return avEl;
      return null;
    },
    prepend: noop, appendChild: noop
  };

  const rafQueue = [];
  const sandbox = {
    window: { innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { hidden: false, body: { appendChild: noop }, createElement: () => fxf },
    performance: { now: () => 1000 },
    requestAnimationFrame: (cb) => { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame: noop,
    Math, Date, Set, Map, Array, Object, String, Number, Boolean, console
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(baseCode, sandbox);
  vm.runInNewContext(creatorCode, sandbox);

  const stage = sandbox.window.IponProfileEffects.mountStage(host, { effectId: 'creator_astral_sovereign', fps: 60 });
  // Expected live DP center in canvas coords: (425 - 401) + 36 = 60, (187 - 121) + 36 = 102
  const outerRingArcs = frontArcs.filter((a) => a.r > 40 && a.r < 60);
  assert.ok(outerRingArcs.length >= 3, 'Expected gimbal outer ring arcs');
  for (const arc of outerRingArcs) {
    assert.ok(Math.abs(arc.x - 60) < 0.01, `Expected gimbal x=60, got ${arc.x}`);
    assert.ok(Math.abs(arc.y - 102) < 0.01, `Expected gimbal y=102, got ${arc.y}`);
  }

  // Simulate CSS pulse/shake moving the avatar live to (422.5, 184) -> canvas center (57.5, 99)
  frontArcs.length = 0;
  avatarRect.left = 422.5;
  avatarRect.top = 184;
  rafQueue[rafQueue.length - 1](1050);
  const shiftedRingArcs = frontArcs.filter((a) => a.r > 40 && a.r < 60);
  assert.ok(shiftedRingArcs.length >= 3);
  for (const arc of shiftedRingArcs) {
    assert.ok(Math.abs(arc.x - 57.5) < 0.01, `Expected shifted gimbal x=57.5, got ${arc.x}`);
    assert.ok(Math.abs(arc.y - 99) < 0.01, `Expected shifted gimbal y=99, got ${arc.y}`);
  }
  stage.destroy();
});
