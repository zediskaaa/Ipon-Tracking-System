import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('core.js primeUiSound and self-rearming audio unlock recover from suspended contexts and play crisp UI sounds', async () => {
  const coreJs = read('js/core.js');
  const winListeners = new Map();
  const docListeners = new Map();
  let audioCtxInstance = null;
  let resumeCalls = 0;
  let allowResumeToRun = false;
  const scheduledFreqs = [];

  class MockAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
      this._stateListeners = [];
      audioCtxInstance = this;
    }
    addEventListener(ev, fn) {
      if (ev === 'statechange') this._stateListeners.push(fn);
    }
    emitStateChange(next) {
      this.state = next;
      this._stateListeners.forEach((fn) => fn());
    }
    resume() {
      resumeCalls += 1;
      if (allowResumeToRun) this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      return {
        gain: { setValueAtTime() { }, linearRampToValueAtTime() { }, exponentialRampToValueAtTime() { } },
        connect() { }
      };
    }
    createOscillator() {
      return {
        type: 'sine',
        frequency: {
          setValueAtTime: (f) => scheduledFreqs.push(f),
          exponentialRampToValueAtTime: (f) => scheduledFreqs.push(f)
        },
        connect() { },
        start() { },
        stop() { }
      };
    }
    createBuffer(ch, len) {
      return { sampleRate: 44100, getChannelData: () => new Float32Array(len) };
    }
    createBufferSource() {
      return { buffer: null, connect() { }, start() { }, stop() { } };
    }
    createBiquadFilter() {
      return { type: 'bandpass', frequency: { setValueAtTime() { } }, Q: { setValueAtTime() { } }, connect() { } };
    }
    createDynamicsCompressor() {
      return {
        threshold: { setValueAtTime() { } },
        knee: { setValueAtTime() { } },
        ratio: { setValueAtTime() { } },
        attack: { setValueAtTime() { } },
        release: { setValueAtTime() { } },
        connect() { }
      };
    }
  }

  const win = {
    IPON_CONFIG: {},
    AudioContext: MockAudioContext,
    addEventListener: (ev, fn) => { if (!winListeners.has(ev)) winListeners.set(ev, new Set()); winListeners.get(ev).add(fn); },
    removeEventListener: (ev, fn) => { winListeners.get(ev)?.delete(fn); },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    sessionStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    location: { origin: 'https://my-ipon.vercel.app', pathname: '/dashboard.html', search: '', hash: '' },
    navigator: { userAgent: 'test' },
    matchMedia: () => ({ matches: false, addEventListener() { } })
  };
  const makeStubEl = () => ({
    dataset: {},
    style: {},
    className: '',
    hidden: false,
    classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    setAttribute() { },
    getAttribute: () => null,
    addEventListener() { },
    removeEventListener() { },
    appendChild() { },
    insertAdjacentHTML() { },
    querySelector: () => null,
    querySelectorAll: () => []
  });
  win.window = win;
  const doc = {
    readyState: 'loading',
    visibilityState: 'visible',
    body: makeStubEl(),
    head: makeStubEl(),
    documentElement: makeStubEl(),
    createElement: () => makeStubEl(),
    addEventListener: (ev, fn) => { if (!docListeners.has(ev)) docListeners.set(ev, new Set()); docListeners.get(ev).add(fn); },
    removeEventListener() { },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null
  };

  vm.runInNewContext(coreJs, { window: win, document: doc, location: win.location, navigator: win.navigator, localStorage: win.localStorage, sessionStorage: win.sessionStorage, setTimeout, clearTimeout, console });

  // Listeners are armed across pointerdown, touchend, click, and keydown
  for (const ev of ['pointerdown', 'touchend', 'click', 'keydown']) {
    assert.equal(winListeners.get(ev)?.size, 1, `Expected unlock listener on ${ev}`);
  }

  // First gesture fails to unlock (stays suspended): listeners MUST stay armed
  for (const fn of [...winListeners.get('pointerdown')]) fn();
  await Promise.resolve();
  assert.equal(audioCtxInstance.state, 'suspended');
  assert.equal(winListeners.get('touchend')?.size, 1, 'Listeners must stay armed while AudioContext is still suspended');

  // Next touchend succeeds: listeners disarm
  allowResumeToRun = true;
  for (const fn of [...winListeners.get('touchend')]) fn();
  await Promise.resolve();
  assert.equal(audioCtxInstance.state, 'running');
  assert.equal(winListeners.get('touchend')?.size, 0, 'Listeners should disarm once AudioContext is running');

  // OS suspends audio in background -> statechange re-arms listeners automatically
  audioCtxInstance.emitStateChange('suspended');
  assert.equal(winListeners.get('click')?.size, 1, 'Listeners must re-arm when AudioContext becomes suspended');

  // Explicit primeUiSound resumes context synchronously inside user gesture
  const prevResumes = resumeCalls;
  assert.equal(win.Ipon.primeUiSound(), true);
  assert.equal(resumeCalls, prevResumes + 1);
  assert.equal(audioCtxInstance.state, 'running');

  // Non-chat financial cues play harmonic tones cleanly
  scheduledFreqs.length = 0;
  assert.equal(win.Ipon.playUiSound('record-addition'), true);
  assert.ok(scheduledFreqs.length > 0, 'Expected scheduled oscillator frequencies for record-addition');
});
