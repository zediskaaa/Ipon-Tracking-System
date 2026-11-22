(() => {
  'use strict';

  // =========================================================================
  // HOLLYWOOD CINEMATIC PROCEDURAL WEB AUDIO ENGINE FOR PROFILE EFFECTS
  // Zero ordinary UI beeps: stereo algorithmic hall reverb, long pink/brown
  // noise buffers for atmospheric whooshes & stardust air, soft saturation,
  // dynamics compression, and 60ms smooth anti-overlap voice crossfade.
  // =========================================================================

  let audioCtx = null;
  let outputBus = null;
  let dryBus = null;
  let wetBus = null;
  let reverbNode = null;
  let noiseLongBuf = null;
  let pinkNoiseBuf = null;
  let activeVoice = null;
  const lastPlayedAt = Object.create(null);

  const COOLDOWN_MS = Object.freeze({
    'pfx-shake': 220,
    'pfx-pulse': 260,
    'pfx-burst': 300,
    'pfx-awakening': 400,
    'pfx-entrance': 400
  });

  function getContext() {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) {
      try {
        audioCtx = new Ctor();
      } catch {
        return null;
      }
    }
    return audioCtx;
  }

  function buildReverbImpulse(ctx, seconds = 2.6, decay = 2.75) {
    const rate = ctx.sampleRate || 44100;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i += 1) {
        const k = i / len;
        const env = Math.pow(1 - k, decay) * Math.min(1, i / (rate * 0.018));
        const white = Math.random() * 2 - 1;
        // Progressive high-frequency air damping so reverb sounds velvety & spacious
        lp = lp * (0.58 + 0.34 * k) + white * (0.42 - 0.34 * k);
        data[i] = lp * env;
      }
    }
    return buf;
  }

  function getWhiteNoiseBuffer(ctx) {
    if (noiseLongBuf && noiseLongBuf.sampleRate === ctx.sampleRate) return noiseLongBuf;
    const len = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 2.8));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate || 44100);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    }
    noiseLongBuf = buf;
    return buf;
  }

  function getPinkNoiseBuffer(ctx) {
    if (pinkNoiseBuf && pinkNoiseBuf.sampleRate === ctx.sampleRate) return pinkNoiseBuf;
    const len = Math.max(1, Math.floor((ctx.sampleRate || 44100) * 3.0));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate || 44100);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i += 1) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520;
        b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    pinkNoiseBuf = buf;
    return buf;
  }

  function ensureRouting(ctx) {
    if (outputBus && dryBus && wetBus) return { dry: dryBus, wet: wetBus };
    const t = ctx.currentTime || 0;
    let masterOut = ctx.destination;

    if (typeof ctx.createDynamicsCompressor === 'function') {
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-10, t);
        comp.knee.setValueAtTime(14, t);
        comp.ratio.setValueAtTime(6, t);
        comp.attack.setValueAtTime(0.004, t);
        comp.release.setValueAtTime(0.18, t);
        comp.connect(ctx.destination);
        masterOut = comp;
      } catch { }
    }

    outputBus = ctx.createGain();
    outputBus.gain.setValueAtTime(0.46, t);
    outputBus.connect(masterOut);

    dryBus = ctx.createGain();
    dryBus.gain.setValueAtTime(0.86, t);
    dryBus.connect(outputBus);

    wetBus = ctx.createGain();
    wetBus.gain.setValueAtTime(0.42, t);
    if (typeof ctx.createConvolver === 'function') {
      try {
        reverbNode = ctx.createConvolver();
        reverbNode.buffer = buildReverbImpulse(ctx, 2.6, 2.75);
        wetBus.connect(reverbNode);
        reverbNode.connect(outputBus);
      } catch {
        wetBus.connect(outputBus);
      }
    } else {
      wetBus.connect(outputBus);
    }
    return { dry: dryBus, wet: wetBus };
  }

  function createVoiceBus(ctx, wetSend = 0.45) {
    const buses = ensureRouting(ctx);
    const t = ctx.currentTime || 0;
    // Smooth 60ms crossfade out of previous cinematic voice so rapid triggers never clash
    if (activeVoice) {
      try {
        activeVoice.gain.cancelScheduledValues(t);
        activeVoice.gain.setValueAtTime(Math.max(0.0002, activeVoice.gain.value || 0.8), t);
        activeVoice.gain.linearRampToValueAtTime(0.0001, t + 0.06);
      } catch { }
    }
    const voice = ctx.createGain();
    voice.gain.setValueAtTime(1.0, t);
    voice.connect(buses.dry);

    const send = ctx.createGain();
    send.gain.setValueAtTime(wetSend, t);
    voice.connect(send);
    send.connect(buses.wet);

    activeVoice = voice;
    return voice;
  }

  function connectPan(ctx, node, dest, pan = 0) {
    if (pan && typeof ctx.createStereoPanner === 'function') {
      try {
        const p = ctx.createStereoPanner();
        p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), ctx.currentTime || 0);
        node.connect(p);
        p.connect(dest);
        return;
      } catch { }
    }
    node.connect(dest);
  }

  function tone(ctx, dest, {
    freq,
    endFreq = null,
    midFreq = null,
    midAt = 0.5,
    type = 'sine',
    detune = 0,
    start = 0,
    duration = 0.5,
    gain = 0.14,
    attack = 0.02,
    pan = 0
  }) {
    const t0 = (ctx.currentTime || 0) + start;
    const dur = Math.max(0.04, duration);
    const tEnd = t0 + dur;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    if (detune && osc.detune) osc.detune.setValueAtTime(detune, t0);
    osc.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (midFreq && midFreq > 20) {
      osc.frequency.exponentialRampToValueAtTime(midFreq, t0 + dur * midAt);
    }
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), tEnd);
    }
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(attack, dur * 0.45));
    amp.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    osc.connect(amp);
    connectPan(ctx, amp, dest, pan);
    osc.start(t0);
    osc.stop(tEnd + 0.04);
  }

  function subImpact(ctx, dest, { start = 0, freq = 108, endFreq = 30, duration = 0.72, gain = 0.34 }) {
    tone(ctx, dest, { freq, endFreq, type: 'sine', start, duration, gain, attack: 0.008 });
    tone(ctx, dest, { freq: freq * 1.5, endFreq: endFreq * 1.4, type: 'triangle', start, duration: duration * 0.65, gain: gain * 0.28, attack: 0.006 });
  }

  function noiseSweep(ctx, dest, {
    pink = true,
    filterType = 'bandpass',
    freqStart = 280,
    freqMid = null,
    freqEnd = 2200,
    q = 1.6,
    start = 0,
    duration = 0.6,
    gain = 0.14,
    attack = 0.12,
    pan = 0
  }) {
    const t0 = (ctx.currentTime || 0) + start;
    const dur = Math.max(0.05, duration);
    const tEnd = t0 + dur;
    const src = ctx.createBufferSource();
    src.buffer = pink ? getPinkNoiseBuffer(ctx) : getWhiteNoiseBuffer(ctx);
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(q, t0);
    filter.frequency.setValueAtTime(Math.max(30, freqStart), t0);
    if (freqMid && freqMid > 30) {
      filter.frequency.exponentialRampToValueAtTime(freqMid, t0 + dur * 0.45);
    }
    filter.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), tEnd);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(attack, dur * 0.45));
    amp.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    src.connect(filter);
    filter.connect(amp);
    connectPan(ctx, amp, dest, pan);
    src.start(t0);
    src.stop(tEnd + 0.04);
  }

  function brassPadChord(ctx, dest, freqs, {
    start = 0,
    duration = 2.4,
    gain = 0.06,
    attack = 0.35,
    cutoffStart = 320,
    cutoffPeak = 2100,
    cutoffEnd = 520
  }) {
    const t0 = (ctx.currentTime || 0) + start;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.setValueAtTime(1.2, t0);
    lp.frequency.setValueAtTime(cutoffStart, t0);
    lp.frequency.exponentialRampToValueAtTime(cutoffPeak, t0 + duration * 0.34);
    lp.frequency.exponentialRampToValueAtTime(cutoffEnd, t0 + duration);
    lp.connect(dest);

    freqs.forEach((f, idx) => {
      const pan = freqs.length > 1 ? ((idx / (freqs.length - 1)) * 2 - 1) * 0.58 : 0;
      const g = gain / Math.sqrt(freqs.length);
      tone(ctx, lp, { freq: f, type: 'sawtooth', detune: -7, start, duration, gain: g * 0.65, attack, pan });
      tone(ctx, lp, { freq: f, type: 'sawtooth', detune: 7, start, duration, gain: g * 0.65, attack, pan: -pan * 0.5 });
      tone(ctx, lp, { freq: f, type: 'triangle', start, duration, gain: g * 0.5, attack, pan: 0 });
    });
  }

  function renderCue(ctx, kind) {
    // -----------------------------------------------------------------------
    // 1. KINETIC RESONANCE SHAKE (~2.1s)
    //    Magnetic wind-up whoosh -> heavy controlled sub-drop -> titanium
    //    chassis resonance + stereo plasma crackle tail
    // -----------------------------------------------------------------------
    if (kind === 'pfx-shake') {
      const v = createVoiceBus(ctx, 0.52);
      // 0.00 -> 0.28s: Inward gravitational wind-up suction + low sub-riser
      noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 220, freqEnd: 1650, q: 2.2, start: 0, duration: 0.3, gain: 0.14, attack: 0.18 });
      tone(ctx, v, { freq: 54, endFreq: 98, type: 'sine', start: 0, duration: 0.28, gain: 0.18, attack: 0.14 });
      // 0.28s: Deep cinematic bass impact + kinetic punch
      subImpact(ctx, v, { start: 0.27, freq: 118, endFreq: 32, duration: 0.85, gain: 0.36 });
      noiseSweep(ctx, v, { pink: false, filterType: 'bandpass', freqStart: 1450, freqEnd: 260, q: 1.2, start: 0.27, duration: 0.42, gain: 0.16, attack: 0.015 });
      // 0.29 -> 1.75s: Brushed titanium harmonic tremor & stereo plasma arcs
      brassPadChord(ctx, v, [98.0, 146.83, 196.0], { start: 0.28, duration: 1.35, gain: 0.13, attack: 0.04, cutoffStart: 950, cutoffPeak: 1850, cutoffEnd: 280 });
      noiseSweep(ctx, v, { pink: false, filterType: 'bandpass', freqStart: 3200, freqEnd: 1200, q: 3.5, start: 0.32, duration: 0.68, gain: 0.075, attack: 0.04, pan: -0.65 });
      noiseSweep(ctx, v, { pink: false, filterType: 'bandpass', freqStart: 2800, freqEnd: 950, q: 3.5, start: 0.38, duration: 0.72, gain: 0.075, attack: 0.05, pan: 0.65 });
      tone(ctx, v, { freq: 587.33, endFreq: 554.37, type: 'sine', start: 0.34, duration: 0.95, gain: 0.042, attack: 0.06, pan: -0.35 });
      tone(ctx, v, { freq: 880.0, endFreq: 783.99, type: 'triangle', start: 0.44, duration: 1.05, gain: 0.026, attack: 0.08, pan: 0.35 });
      return;
    }

    // -----------------------------------------------------------------------
    // 2. DYNAMIC SOVEREIGN PULSE (~3.0s)
    //    Ethereal cinematic C-sus2 brass/pad swell + 3 stereo optical breath
    //    wavefronts + shimmering celestial harmonic halo
    // -----------------------------------------------------------------------
    if (kind === 'pfx-pulse') {
      const v = createVoiceBus(ctx, 0.72);
      // Warm sub-bass heart breath
      tone(ctx, v, { freq: 65.41, endFreq: 61.74, type: 'sine', start: 0, duration: 2.35, gain: 0.24, attack: 0.38 });
      // Lush wide cinematic pad swell
      brassPadChord(ctx, v, [130.81, 196.0, 293.66, 392.0], {
        start: 0.04, duration: 2.55, gain: 0.15, attack: 0.42, cutoffStart: 260, cutoffPeak: 2200, cutoffEnd: 420
      });
      // Three synchronized stereo breath-whoosh wavefronts + luminous crystal harmonics
      const waves = [
        [0.24, 523.25, -0.55, 0.068],
        [0.56, 659.25, 0.55, 0.062],
        [0.9,  783.99, 0.0, 0.058]
      ];
      waves.forEach(([st, f, pan, g]) => {
        noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 420, freqMid: 2100, freqEnd: 680, q: 1.8, start: st - 0.08, duration: 0.72, gain: 0.085, attack: 0.18, pan });
        tone(ctx, v, { freq: f, type: 'sine', start: st, duration: 1.35, gain: g, attack: 0.09, pan });
        tone(ctx, v, { freq: f * 2, type: 'triangle', start: st + 0.04, duration: 1.15, gain: g * 0.28, attack: 0.12, pan: -pan });
      });
      return;
    }

    // -----------------------------------------------------------------------
    // 3. QUANTUM SUPERNOVA BURST (~3.6s)
    //    High-tension singularity pull -> deep chest-felt supernova boom +
    //    wide stereo shock blast -> shimmering stardust particle cascade
    // -----------------------------------------------------------------------
    if (kind === 'pfx-burst') {
      const v = createVoiceBus(ctx, 0.68);
      // 0.00 -> 0.52s: Rising magnetic singularity suction whoosh + sub-tension
      noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 160, freqEnd: 2900, q: 2.4, start: 0, duration: 0.54, gain: 0.19, attack: 0.36 });
      tone(ctx, v, { freq: 52, endFreq: 112, type: 'sine', start: 0, duration: 0.52, gain: 0.22, attack: 0.28 });
      tone(ctx, v, { freq: 220, endFreq: 523.25, type: 'triangle', start: 0.06, duration: 0.46, gain: 0.075, attack: 0.22 });
      // 0.52s: Monumental controlled supernova detonation boom + stereo air shockwave
      subImpact(ctx, v, { start: 0.51, freq: 102, endFreq: 27, duration: 1.15, gain: 0.4 });
      noiseSweep(ctx, v, { pink: false, filterType: 'lowpass', freqStart: 4200, freqEnd: 260, q: 0.9, start: 0.51, duration: 0.92, gain: 0.22, attack: 0.014 });
      brassPadChord(ctx, v, [130.81, 196.0, 261.63, 329.63], {
        start: 0.52, duration: 2.2, gain: 0.16, attack: 0.08, cutoffStart: 1800, cutoffPeak: 2800, cutoffEnd: 380
      });
      // 0.62 -> 3.3s: Stereo cascading crystalline stardust & shimmering fairy-air
      noiseSweep(ctx, v, { pink: false, filterType: 'highpass', freqStart: 3600, freqEnd: 5800, q: 1.2, start: 0.58, duration: 1.6, gain: 0.055, attack: 0.14 });
      const sparks = [
        [659.25, 0.58, -0.72, 0.058],
        [783.99, 0.7,   0.68, 0.054],
        [987.77, 0.84, -0.45, 0.05],
        [1174.66, 0.98, 0.48, 0.044],
        [1318.51, 1.14, -0.25, 0.04],
        [1567.98, 1.32, 0.25, 0.034]
      ];
      sparks.forEach(([f, st, pan, g]) => {
        tone(ctx, v, { freq: f, type: 'sine', start: st, duration: 1.25, gain: g, attack: 0.03, pan });
        tone(ctx, v, { freq: f * 2, type: 'triangle', start: st + 0.03, duration: 0.85, gain: g * 0.24, attack: 0.04, pan: -pan });
      });
      return;
    }

    // -----------------------------------------------------------------------
    // 4. FULL-SCREEN CINEMATIC A: ENERGY AWAKENING (~4.8s)
    //    Cosmic reactor drone -> massive stereo expanding whoosh -> majestic
    //    G-maj9 brass-pad awakening -> climax sub-drop -> celestial afterglow
    // -----------------------------------------------------------------------
    if (kind === 'pfx-awakening') {
      const v = createVoiceBus(ctx, 0.8);
      // 0.00 -> 1.15s: Deep cosmic reactor ignition drone + stereo swirling vortex wind
      tone(ctx, v, { freq: 49.0, endFreq: 73.42, type: 'sine', start: 0, duration: 1.45, gain: 0.28, attack: 0.42 });
      noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 140, freqMid: 1100, freqEnd: 2800, q: 1.7, start: 0.05, duration: 1.45, gain: 0.18, attack: 0.5, pan: -0.5 });
      noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 180, freqMid: 1350, freqEnd: 3200, q: 1.7, start: 0.12, duration: 1.4, gain: 0.18, attack: 0.5, pan: 0.5 });
      // 0.95 -> 3.8s: Majestic expanding sci-fi G-add9 orchestral synth brass
      brassPadChord(ctx, v, [98.0, 146.83, 196.0, 220.0, 246.94, 293.66], {
        start: 0.85, duration: 3.4, gain: 0.2, attack: 0.58, cutoffStart: 280, cutoffPeak: 3100, cutoffEnd: 460
      });
      // 1.10s & 1.85s: Monumental full-screen plasma shockwaves
      subImpact(ctx, v, { start: 1.05, freq: 98, endFreq: 31, duration: 1.25, gain: 0.38 });
      noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 2400, freqEnd: 280, q: 1.1, start: 1.05, duration: 1.35, gain: 0.2, attack: 0.04 });
      subImpact(ctx, v, { start: 1.82, freq: 110, endFreq: 28, duration: 1.4, gain: 0.4 });
      // 1.90 -> 4.6s: Radiant crystalline choir-shimmer bloom
      const choir = [
        [587.33, 1.84, -0.65, 0.052],
        [739.99, 1.98,  0.65, 0.048],
        [880.0,  2.14, -0.35, 0.046],
        [1174.66, 2.34, 0.35, 0.042],
        [1479.98, 2.58, 0.0,  0.032]
      ];
      choir.forEach(([f, st, pan, g]) => {
        tone(ctx, v, { freq: f, type: 'sine', start: st, duration: 1.95, gain: g, attack: 0.18, pan });
        tone(ctx, v, { freq: f * 1.5, type: 'triangle', start: st + 0.06, duration: 1.45, gain: g * 0.22, attack: 0.2, pan: -pan });
      });
      return;
    }

    // -----------------------------------------------------------------------
    // 5. FULL-SCREEN CINEMATIC B: LEGENDARY ENTRANCE (~5.2s)
    //    Dimensional rift rumble + prism wind -> rising orchestral fifth
    //    trailer crescendo -> epic D-maj9 sovereign reveal impact -> golden
    //    anamorphic starlight cascade
    // -----------------------------------------------------------------------
    if (kind === 'pfx-entrance') {
      const v = createVoiceBus(ctx, 0.85);
      // 0.00 -> 1.55s: Void horizon rift opening + rising orchestral crescendo
      tone(ctx, v, { freq: 36.71, endFreq: 73.42, type: 'sine', start: 0, duration: 1.6, gain: 0.26, attack: 0.45 });
      noiseSweep(ctx, v, { pink: true, filterType: 'bandpass', freqStart: 220, freqMid: 1400, freqEnd: 4400, q: 2.1, start: 0, duration: 1.55, gain: 0.2, attack: 0.72 });
      tone(ctx, v, { freq: 146.83, endFreq: 293.66, type: 'sawtooth', detune: -5, start: 0.25, duration: 1.32, gain: 0.068, attack: 0.65, pan: -0.45 });
      tone(ctx, v, { freq: 220.0, endFreq: 440.0, type: 'sawtooth', detune: 5, start: 0.32, duration: 1.25, gain: 0.062, attack: 0.6, pan: 0.45 });
      // 1.52s: Heroic Hollywood Trailer Reveal Impact (deep sub-boom + golden brass chord!)
      subImpact(ctx, v, { start: 1.5, freq: 92, endFreq: 25, duration: 1.65, gain: 0.42 });
      noiseSweep(ctx, v, { pink: false, filterType: 'lowpass', freqStart: 5200, freqEnd: 320, q: 0.85, start: 1.5, duration: 1.35, gain: 0.22, attack: 0.015 });
      brassPadChord(ctx, v, [73.42, 146.83, 220.0, 277.18, 329.63, 369.99, 440.0], {
        start: 1.52, duration: 3.4, gain: 0.22, attack: 0.14, cutoffStart: 2200, cutoffPeak: 3600, cutoffEnd: 420
      });
      // 1.65 -> 4.9s: Golden anamorphic prism shimmer & starlight rain
      noiseSweep(ctx, v, { pink: false, filterType: 'highpass', freqStart: 3800, freqEnd: 6200, q: 1.1, start: 1.6, duration: 2.4, gain: 0.052, attack: 0.22 });
      const rain = [
        [587.33, 1.62, -0.75, 0.056],
        [739.99, 1.78,  0.72, 0.052],
        [880.0,  1.96, -0.5,  0.048],
        [1108.73, 2.15, 0.5,  0.044],
        [1318.51, 2.36, -0.25, 0.04],
        [1479.98, 2.6,  0.25, 0.036],
        [1760.0,  2.88, 0.0,  0.028]
      ];
      rain.forEach(([f, st, pan, g]) => {
        tone(ctx, v, { freq: f, type: 'sine', start: st, duration: 1.8, gain: g, attack: 0.04, pan });
        tone(ctx, v, { freq: f * 2, type: 'triangle', start: st + 0.03, duration: 1.15, gain: g * 0.22, attack: 0.05, pan: -pan });
      });
    }
  }

  function stopAll() {
    if (!audioCtx || !activeVoice) return;
    try {
      const t = audioCtx.currentTime || 0;
      activeVoice.gain.cancelScheduledValues(t);
      activeVoice.gain.setValueAtTime(Math.max(0.0002, activeVoice.gain.value || 0.8), t);
      activeVoice.gain.linearRampToValueAtTime(0.0001, t + 0.06);
    } catch { }
    activeVoice = null;
  }

  function play(kind, { retryOnGestureEl = null } = {}) {
    if (!kind || !COOLDOWN_MS[kind]) return false;
    const now = Date.now();
    if (now - (lastPlayedAt[kind] || 0) < COOLDOWN_MS[kind]) return false;
    lastPlayedAt[kind] = now;

    const ctx = getContext();
    if (!ctx) return false;
    const trigger = () => {
      try {
        renderCue(ctx, kind);
        return true;
      } catch {
        return false;
      }
    };
    if (ctx.state === 'running') return trigger();
    try {
      const res = ctx.resume?.();
      if (res && typeof res.then === 'function') {
        res.then(() => {
          if (ctx.state === 'running') trigger();
          else if (retryOnGestureEl && retryOnGestureEl.isConnected !== false) {
            const replay = () => {
              retryOnGestureEl.removeEventListener?.('pointerdown', replay);
              retryOnGestureEl.removeEventListener?.('keydown', replay);
              if (retryOnGestureEl.open === false || retryOnGestureEl.isConnected === false) return;
              ctx.resume?.().then(() => { if (ctx.state === 'running') trigger(); }).catch(() => { });
            };
            retryOnGestureEl.addEventListener?.('pointerdown', replay, { once: true });
            retryOnGestureEl.addEventListener?.('keydown', replay, { once: true });
          }
        }).catch(() => { });
      }
      return true;
    } catch {
      return false;
    }
  }

  function prime() {
    const ctx = getContext();
    if (!ctx) return false;
    if (ctx.state === 'running') return true;
    try {
      const res = ctx.resume?.();
      if (res && typeof res.catch === 'function') res.catch(() => { });
      return true;
    } catch {
      return false;
    }
  }

  const api = Object.freeze({
    CUES: Object.freeze(Object.keys(COOLDOWN_MS)),
    play,
    stopAll,
    prime
  });

  if (typeof window !== 'undefined') window.IponProfileEffectsSfx = api;
  if (typeof globalThis !== 'undefined') globalThis.IponProfileEffectsSfx = api;
})();
