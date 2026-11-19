(function () {
  'use strict';

  const config = window.IPON_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(config.supabaseUrl || '')
    && config.supabaseAnonKey
    && !config.supabaseAnonKey.startsWith('YOUR_');
  let clientInstance = null;
  function getClient() {
    if (!clientInstance && configured && window.supabase) {
      clientInstance = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    }
    return clientInstance;
  }
  async function ensureClient(maxWaitMs = 2500) {
    const existing = getClient();
    if (existing) return existing;
    if (!configured) return null;
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const ready = getClient();
      if (ready) return ready;
    }
    throw new Error('Unable to initialize database client.');
  }
  let currentProfile = null;
  let cachedAccessToken = null;
  let lastSeenFlushAt = 0;
  let quickMfaController = null;
  const STARTUP_TIMEOUT_MS = 15000;
  let loaderSafetyTimer = null;
  let loaderSlowTimer = null;
  let navLoaderTimer = null;
  let activeLiveRefresh = null;

  const THEME_STORAGE_KEY = 'myipon_theme';
  const UI_SOUND_STORAGE_KEY = 'myipon_ui_sounds';
  const USERNAME_POST_SAVE_DELAY_MS = 1500;
  let uiAudioCtx = null;
  let uiNoiseBuffer = null;
  const uiSoundLastAt = Object.create(null);
  const UI_SOUND_COOLDOWN_MS = {
    type: 38,
    'msg-typing': 2200,
    'msg-receive': 240,
    'msg-send': 120
  };
  const RPC_SUCCESS_SOUNDS = {
    record_contribution: 'record-addition',
    record_contribution_with_carryover: 'record-addition',
    record_withdrawal: 'record-deduction',
    record_expense: 'record-expense',
    send_chat_message: 'msg-send'
  };

  function isUiSoundEnabled() {
    try {
      return localStorage.getItem(UI_SOUND_STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  }

  function setUiSoundEnabled(enabled) {
    const next = Boolean(enabled);
    try {
      if (next) localStorage.removeItem(UI_SOUND_STORAGE_KEY);
      else localStorage.setItem(UI_SOUND_STORAGE_KEY, '0');
    } catch { }
    return next;
  }

  function getUiAudioContext() {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!uiAudioCtx) {
      try {
        uiAudioCtx = new AudioCtx();
      } catch {
        return null;
      }
    }
    return uiAudioCtx;
  }

  function getUiNoiseBuffer(ctx) {
    if (uiNoiseBuffer && uiNoiseBuffer.sampleRate === ctx.sampleRate) return uiNoiseBuffer;
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.06));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.35));
    }
    uiNoiseBuffer = buffer;
    return buffer;
  }

  function scheduleUiTone(ctx, dest, { freq, endFreq = null, type = 'sine', start = 0, duration = 0.16, gain = 0.06, attack = 0.008 }) {
    const t0 = ctx.currentTime + start;
    const tEnd = t0 + Math.max(0.025, duration);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq && endFreq !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), tEnd);
    }
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(attack, duration * 0.4));
    amp.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    osc.connect(amp);
    amp.connect(dest);
    osc.start(t0);
    osc.stop(tEnd + 0.02);
  }

  function scheduleUiBurst(ctx, dest, { start = 0, duration = 0.024, gain = 0.04, filterFreq = 2600, q = 1.6 }) {
    const t0 = ctx.currentTime + start;
    const tEnd = t0 + Math.max(0.012, duration);
    const src = ctx.createBufferSource();
    src.buffer = getUiNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.Q.setValueAtTime(q, t0);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.linearRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, tEnd);
    src.connect(filter);
    filter.connect(amp);
    amp.connect(dest);
    src.start(t0);
    src.stop(tEnd + 0.01);
  }

  function renderUiSound(ctx, kind) {
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.9, ctx.currentTime);
    master.connect(ctx.destination);

    if (kind === 'type') {
      const jitter = 0.94 + Math.random() * 0.12;
      scheduleUiBurst(ctx, master, { duration: 0.015, gain: 0.036, filterFreq: 2150 * jitter, q: 1.8 });
      scheduleUiTone(ctx, master, { freq: 215 * jitter, endFreq: 118, type: 'sine', duration: 0.034, gain: 0.03, attack: 0.003 });
      return;
    }
    if (kind === 'chip') {
      scheduleUiTone(ctx, master, { freq: 420, endFreq: 650, type: 'sine', duration: 0.062, gain: 0.052, attack: 0.005 });
      return;
    }
    if (kind === 'available') {
      scheduleUiTone(ctx, master, { freq: 783.99, type: 'sine', start: 0, duration: 0.18, gain: 0.05 });
      scheduleUiTone(ctx, master, { freq: 1046.5, type: 'sine', start: 0.085, duration: 0.28, gain: 0.058 });
      scheduleUiTone(ctx, master, { freq: 2093.0, type: 'triangle', start: 0.085, duration: 0.22, gain: 0.014 });
      return;
    }
    if (kind === 'error') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(640, ctx.currentTime);
      lp.connect(master);
      scheduleUiTone(ctx, lp, { freq: 215, endFreq: 192, type: 'triangle', start: 0, duration: 0.095, gain: 0.058, attack: 0.005 });
      scheduleUiTone(ctx, lp, { freq: 172, endFreq: 146, type: 'triangle', start: 0.095, duration: 0.13, gain: 0.055, attack: 0.005 });
      return;
    }
    if (kind === 'success') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const start = idx * 0.072;
        scheduleUiTone(ctx, master, { freq, type: 'sine', start, duration: idx === 3 ? 0.42 : 0.24, gain: idx === 3 ? 0.068 : 0.054 });
        scheduleUiTone(ctx, master, { freq: freq * 2, type: 'triangle', start, duration: 0.18, gain: 0.012 });
      });
      return;
    }
    if (kind === 'msg-send') {
      scheduleUiTone(ctx, master, { freq: 340, endFreq: 740, type: 'sine', start: 0, duration: 0.078, gain: 0.058, attack: 0.005 });
      scheduleUiBurst(ctx, master, { start: 0.01, duration: 0.018, gain: 0.022, filterFreq: 2800, q: 1.5 });
      return;
    }
    if (kind === 'msg-typing') {
      scheduleUiTone(ctx, master, { freq: 520, endFreq: 610, type: 'sine', start: 0, duration: 0.055, gain: 0.028, attack: 0.005 });
      scheduleUiTone(ctx, master, { freq: 440, endFreq: 500, type: 'sine', start: 0.095, duration: 0.06, gain: 0.024, attack: 0.005 });
      return;
    }
    if (kind === 'msg-receive') {
      scheduleUiTone(ctx, master, { freq: 659.25, type: 'sine', start: 0, duration: 0.14, gain: 0.062, attack: 0.006 });
      scheduleUiTone(ctx, master, { freq: 880.0, type: 'sine', start: 0.075, duration: 0.24, gain: 0.068, attack: 0.006 });
      scheduleUiTone(ctx, master, { freq: 1760.0, type: 'triangle', start: 0.075, duration: 0.16, gain: 0.014, attack: 0.006 });
      return;
    }
    if (kind === 'record-addition') {
      scheduleUiTone(ctx, master, { freq: 987.77, type: 'sine', start: 0, duration: 0.14, gain: 0.062, attack: 0.004 });
      scheduleUiTone(ctx, master, { freq: 1318.51, type: 'sine', start: 0.07, duration: 0.34, gain: 0.068, attack: 0.004 });
      scheduleUiTone(ctx, master, { freq: 2637.02, type: 'triangle', start: 0.07, duration: 0.22, gain: 0.016, attack: 0.004 });
      return;
    }
    if (kind === 'record-deduction') {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1600, ctx.currentTime);
      lp.connect(master);
      scheduleUiTone(ctx, lp, { freq: 783.99, type: 'sine', start: 0, duration: 0.15, gain: 0.056, attack: 0.006 });
      scheduleUiTone(ctx, lp, { freq: 587.33, type: 'triangle', start: 0.085, duration: 0.28, gain: 0.06, attack: 0.006 });
      return;
    }
    if (kind === 'record-expense') {
      scheduleUiBurst(ctx, master, { start: 0, duration: 0.024, gain: 0.032, filterFreq: 2200, q: 1.5 });
      scheduleUiTone(ctx, master, { freq: 698.46, type: 'sine', start: 0.015, duration: 0.12, gain: 0.052, attack: 0.005 });
      scheduleUiTone(ctx, master, { freq: 880.0, type: 'triangle', start: 0.095, duration: 0.22, gain: 0.05, attack: 0.005 });
      return;
    }
    if (kind === 'confetti') {
      scheduleUiBurst(ctx, master, { start: 0, duration: 0.032, gain: 0.062, filterFreq: 3400, q: 1.3 });
      scheduleUiTone(ctx, master, { freq: 1318.51, type: 'sine', start: 0.02, duration: 0.16, gain: 0.042 });
      scheduleUiTone(ctx, master, { freq: 1567.98, type: 'sine', start: 0.085, duration: 0.24, gain: 0.046 });
      return;
    }
    if (kind === 'unlock') {
      const notes = [783.99, 987.77, 1174.66, 1567.98];
      notes.forEach((freq, idx) => {
        const start = idx * 0.06;
        scheduleUiTone(ctx, master, { freq, type: 'sine', start, duration: idx === 3 ? 0.46 : 0.24, gain: 0.058 });
        scheduleUiTone(ctx, master, { freq: freq * 1.5, type: 'triangle', start, duration: 0.16, gain: 0.012 });
      });
      return;
    }
    if (kind === 'celebration') {
      const arp = [
        [523.25, 0.0, 0.34, 0.056],
        [659.25, 0.065, 0.34, 0.058],
        [783.99, 0.13, 0.36, 0.062],
        [987.77, 0.195, 0.38, 0.058],
        [1046.5, 0.265, 0.62, 0.072],
        [1318.51, 0.345, 0.64, 0.058],
        [1567.98, 0.43, 0.72, 0.052]
      ];
      arp.forEach(([freq, start, duration, gain]) => {
        scheduleUiTone(ctx, master, { freq, type: 'sine', start, duration, gain });
        scheduleUiTone(ctx, master, { freq: freq * 2, type: 'triangle', start: start + 0.005, duration: duration * 0.55, gain: gain * 0.2 });
      });
      scheduleUiTone(ctx, master, { freq: 261.63, type: 'triangle', start: 0.26, duration: 0.75, gain: 0.036, attack: 0.03 });
      scheduleUiTone(ctx, master, { freq: 392.0, type: 'sine', start: 0.26, duration: 0.72, gain: 0.032, attack: 0.03 });
      scheduleUiBurst(ctx, master, { start: 0.03, duration: 0.03, gain: 0.045, filterFreq: 3200, q: 1.4 });
      scheduleUiBurst(ctx, master, { start: 0.24, duration: 0.036, gain: 0.052, filterFreq: 3800, q: 1.3 });
      scheduleUiBurst(ctx, master, { start: 0.44, duration: 0.032, gain: 0.042, filterFreq: 4200, q: 1.5 });
    }
  }

  function playUiSound(kind, { retryOnGestureEl = null } = {}) {
    if (!kind || !isUiSoundEnabled()) return false;
    const cooldownMs = UI_SOUND_COOLDOWN_MS[kind] || 0;
    if (cooldownMs > 0) {
      const now = Date.now();
      if (now - (uiSoundLastAt[kind] || 0) < cooldownMs) return false;
      uiSoundLastAt[kind] = now;
    }
    const ctx = getUiAudioContext();
    if (!ctx) return false;
    const trigger = () => {
      try {
        renderUiSound(ctx, kind);
        return true;
      } catch {
        return false;
      }
    };
    if (ctx.state === 'running') return trigger();
    try {
      const resumed = ctx.resume?.();
      if (resumed && typeof resumed.then === 'function') {
        resumed.then(() => {
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

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    const unlockUiAudio = () => {
      if (!isUiSoundEnabled()) return;
      const ctx = getUiAudioContext();
      if (ctx && ctx.state === 'suspended') {
        ctx.resume?.().catch(() => { });
      }
      window.removeEventListener?.('pointerdown', unlockUiAudio);
      window.removeEventListener?.('keydown', unlockUiAudio);
    };
    window.addEventListener('pointerdown', unlockUiAudio, { passive: true });
    window.addEventListener('keydown', unlockUiAudio, { passive: true });
  }
  const THEME_SUN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/></svg>';
  const THEME_MOON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"/></svg>';

  function normalizeTheme(value) {
    return String(value || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
  }

  function readStoredTheme() {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch { }
    return 'light';
  }

  function getTheme() {
    return normalizeTheme(document?.documentElement?.dataset?.theme || readStoredTheme());
  }

  function isDarkTheme() {
    return getTheme() === 'dark';
  }

  function chartThemeOptions() {
    const dark = isDarkTheme();
    return {
      isDark: dark,
      textColor: dark ? '#d2e0d9' : '#324841',
      mutedColor: dark ? '#9bb0a7' : '#5f655f',
      gridColor: dark ? 'rgba(218, 236, 227, 0.12)' : 'rgba(20, 45, 43, 0.1)',
      tooltipBg: dark ? '#0b1b16' : '#142d2b',
      tooltipBorder: dark ? 'rgba(222, 177, 82, 0.35)' : 'rgba(255, 255, 255, 0.14)',
      tooltipTitleColor: '#f5eadb',
      tooltipBodyColor: '#e5efe9',
      additionColor: dark ? '#3ea46c' : '#287a4c',
      deductionColor: dark ? '#df625b' : '#ae3934'
    };
  }

  function syncThemeControls(root = document) {
    const dark = isDarkTheme();
    const nextAction = dark ? 'Switch to light mode' : 'Switch to dark mode';
    const buttonLabel = dark ? 'Light mode' : 'Dark mode';
    root?.querySelectorAll?.('[data-theme-toggle]')?.forEach((button) => {
      button.setAttribute?.('aria-pressed', String(dark));
      button.setAttribute?.('aria-label', nextAction);
      button.setAttribute?.('title', nextAction);
      if (button.dataset) button.dataset.themeState = dark ? 'dark' : 'light';
      const iconHost = button.querySelector?.('[data-theme-icon]');
      const labelHost = button.querySelector?.('[data-theme-label]');
      if (iconHost) iconHost.innerHTML = dark ? THEME_SUN_SVG : THEME_MOON_SVG;
      else button.innerHTML = `${dark ? THEME_SUN_SVG : THEME_MOON_SVG}${button.classList?.contains?.('auth-theme-toggle') || button.classList?.contains?.('l-theme-drawer-toggle') ? `<span data-theme-label>${buttonLabel}</span>` : ''}`;
      if (labelHost) labelHost.textContent = buttonLabel;
    });
    root?.querySelectorAll?.('[data-theme-checkbox]')?.forEach((checkbox) => {
      checkbox.checked = dark;
      checkbox.setAttribute?.('aria-checked', String(dark));
    });
  }

  function mountThemeControls(root = document) {
    if (typeof document?.createElement !== 'function') return;
    const landingNavCta = root?.querySelector?.('.l-nav-cta');
    if (landingNavCta && !landingNavCta.querySelector?.('[data-theme-toggle]')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'l-btn l-btn-ghost l-theme-toggle';
      btn.setAttribute?.('data-theme-toggle', '');
      btn.innerHTML = `<span class="theme-toggle-icon" data-theme-icon aria-hidden="true">${THEME_MOON_SVG}</span>`;
      landingNavCta.prepend?.(btn);
    }

    const landingDrawerActions = root?.querySelector?.('.l-drawer-actions');
    if (landingDrawerActions && !landingDrawerActions.querySelector?.('[data-theme-toggle]')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'l-btn l-btn-ghost l-theme-drawer-toggle';
      btn.setAttribute?.('data-theme-toggle', '');
      btn.innerHTML = `<span class="theme-toggle-icon" data-theme-icon aria-hidden="true">${THEME_MOON_SVG}</span><span data-theme-label>Dark mode</span>`;
      landingDrawerActions.append?.(btn);
    }

    const authContainer = root?.querySelector?.('.login-page, body.security-page');
    if (authContainer && !document.querySelector?.('.auth-theme-toggle')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'auth-theme-toggle';
      btn.setAttribute?.('data-theme-toggle', '');
      btn.innerHTML = `<span class="theme-toggle-icon" data-theme-icon aria-hidden="true">${THEME_MOON_SVG}</span><span data-theme-label>Dark mode</span>`;
      authContainer.append?.(btn);
    }

    root?.querySelectorAll?.('#quick-notifications-enabled, #notifications-enabled')?.forEach((notifCheckbox) => {
      const notifRow = notifCheckbox.closest?.('.preference-row');
      const card = notifRow?.parentElement;
      if (!card || card.querySelector?.('.preference-theme-row') || card.querySelector?.('[data-theme-checkbox]')) return;
      const row = document.createElement('label');
      row.className = 'preference-row preference-theme-row';
      row.innerHTML = `<span><strong>Dark mode</strong><small>Switch between Warm Paper Light and Forest Dark theme.</small></span><input class="toggle-switch-input" type="checkbox" role="switch" data-theme-checkbox aria-label="Enable dark mode">`;
      card.insertBefore?.(row, notifRow);
    });

    syncThemeControls(root);
  }

  function setTheme(theme, { persist = true, notify = true } = {}) {
    const next = normalizeTheme(theme);
    const rootEl = document?.documentElement;
    if (rootEl) {
      if (rootEl.dataset) rootEl.dataset.theme = next;
      if (rootEl.style) rootEl.style.colorScheme = next;
    }
    const metaTheme = document?.querySelector?.('meta[name="theme-color"]');
    metaTheme?.setAttribute?.('content', next === 'dark' ? '#081310' : '#0b3428');
    if (persist) {
      try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch { }
    }
    syncThemeControls(document);
    if (notify && typeof window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('ipon:themechange', { detail: { theme: next } }));
    }
    return next;
  }

  function toggleTheme() {
    return setTheme(isDarkTheme() ? 'light' : 'dark');
  }

  if (!document.querySelector('link[rel="manifest"]')) {
    document.head?.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#0b3428"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="IPON"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/icon-192.png">');
  }
  setTheme(readStoredTheme(), { persist: false, notify: false });
  document.addEventListener('click', (event) => {
    const toggleBtn = event.target.closest?.('[data-theme-toggle]');
    if (!toggleBtn) return;
    toggleTheme();
  });
  document.addEventListener('change', (event) => {
    const themeCheck = event.target.closest?.('[data-theme-checkbox]');
    if (!themeCheck) return;
    setTheme(themeCheck.checked ? 'dark' : 'light');
  });
  window.addEventListener('storage', (event) => {
    if (event.key === THEME_STORAGE_KEY) {
      setTheme(event.newValue || 'light', { persist: false });
    }
  });
  const isLocalDevHost = window.location.protocol !== 'https:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  if (!window.Capacitor && 'serviceWorker' in navigator && isLocalDevHost) {
    const hadController = Boolean(navigator.serviceWorker.controller);
    (async () => {
      try {
        const regs = (await navigator.serviceWorker.getRegistrations?.()) || [];
        await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
        if (window.caches?.keys) {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((k) => window.caches.delete(k).catch(() => false)));
        }
        if ((hadController || regs.length) && !sessionStorage.getItem('ipon_sw_local_cleaned_v19')) {
          sessionStorage.setItem('ipon_sw_local_cleaned_v19', '1');
          await fetch(window.location.href, { cache: 'reload' }).catch(() => { });
          window.location.reload();
        }
      } catch { }
    })();
  } else if (!window.Capacitor && 'serviceWorker' in navigator && window.location.protocol === 'https:') {
    const hadController = Boolean(navigator.serviceWorker.controller);
    let swReloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || swReloading) return;
      if (document.querySelector('dialog[open]')) return;
      swReloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      reg.update().catch(() => { });
      const checkSw = () => reg.update().catch(() => { });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkSw(); });
      window.addEventListener('focus', checkSw);
      window.addEventListener('online', checkSw);
      setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine !== false) checkSw(); }, 5 * 60 * 1000);
    }).catch(() => { });
    navigator.serviceWorker.addEventListener('message', (event) => {
      const msg = event?.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'MYIPON_PUSH_SHOWN' && currentProfile?.id && msg.id != null) {
        const key = notifShownKey({
          id: msg.id,
          dedupe_key: msg.dedupe_key,
          created_at: msg.timestamp ? new Date(msg.timestamp).toISOString() : '',
          message: msg.message || ''
        }) || String(msg.id);
        markDeviceNotificationShown(currentProfile.id, key);
        if (!msg.dedupe_key) markDeviceNotificationShown(currentProfile.id, String(msg.id));
      } else if (msg.type === 'MYIPON_PUSH_SUBSCRIPTION_CHANGED' && currentProfile?.id) {
        syncWebPushSubscription({ force: true }).catch(() => { });
      } else if (msg.type === 'MYIPON_NOTIFICATION_CLICK' && currentProfile?.id && msg.url) {
        navigateNotificationTarget({ id: msg.id, group_id: msg.group_id, link: msg.url }).catch(() => { });
      }
    });
  }

  if (document.body.dataset.page) {
    if (!document.body.classList.contains('security-page')) setLoading(true);
    window.addEventListener('pagehide', (event) => {
      if (navLoaderTimer) { clearTimeout(navLoaderTimer); navLoaderTimer = null; }
      if (event.persisted) document.documentElement.style.visibility = 'hidden';
    });
    window.addEventListener('pageshow', async (event) => {
      if (!event.persisted) return;
      if (isLocalDevHost) {
        window.location.reload();
        return;
      }
      const client = getClient();
      if (!client) { setLoading(false); return document.documentElement.style.removeProperty('visibility'); }
      try {
        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session) return window.location.replace('login.html');
        setLoading(false);
        document.documentElement.style.removeProperty('visibility');
      } catch {
        window.location.replace('login.html');
      }
    });
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href]');
      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      const navLink = link.closest('.app-nav a, .record-tabs a');
      if (navLink) {
        navLink.closest('.app-nav, .record-tabs')?.querySelectorAll('a').forEach((item) => {
          item.classList.remove('is-active');
          item.removeAttribute('aria-current');
        });
        navLink.classList.add('is-active');
        navLink.setAttribute('aria-current', 'page');
      }
      if (navLoaderTimer) clearTimeout(navLoaderTimer);
      navLoaderTimer = window.setTimeout(() => setLoading(true), 220);
    });
  }

  function withTimeout(request, timeoutMs = STARTUP_TIMEOUT_MS) {
    let timer;
    return Promise.race([
      request,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('The connection timed out.')), timeoutMs);
      })
    ]).finally(() => window.clearTimeout(timer));
  }

  const navItems = [
    ['dashboard', 'dashboard.html', 'Calendar', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18M7 14h2m3 0h2m3 0h1M7 18h2m3 0h2m3 0h1"/></svg>'],
    ['contributions', 'contributions.html', 'Records', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>'],
    ['budget', 'budget.html', 'Budget', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12A9 9 0 1 1 12 3v9Z"/><path d="M21.2 10A9 9 0 0 0 14 2.8V10Z"/></svg>'],
    ['members', 'members.html', 'Members', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>', 'ADMIN'],
    ['reports', 'reports.html', 'Reports', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></svg>']
  ];
  const superAdminNavItems = [
    ['overview', 'super-admin.html#overview', 'Overview', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>'],
    ['feature-requests', 'super-admin.html#feature-requests', 'Feature requests', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.2 14 16 14 17h-4c0-1-.5-1.8-1.5-2.5Z"/></svg>'],
    ['bug-reports', 'super-admin.html#bug-reports', 'Bug reports', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6V5a4 4 0 0 1 8 0v1m-9 4h10a2 2 0 0 1 2 2v3a7 7 0 0 1-14 0v-3a2 2 0 0 1 2-2Zm-3 3H3m18 0h-1M6 9 4 7m14 2 2-2M6 17l-2 2m14-2 2 2"/></svg>'],
    ['administrators', 'super-admin.html#administrators', 'Users', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-1 2 2 4-4"/></svg>'],
    ['badges', 'super-admin.html#badges', 'Badges', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 14.9 4.2l3.6-.3 1.1 3.4 2.9 2-1.1 3.4 1.1 3.4-2.9 2-1.1 3.4-3.6-.3L12 22l-2.9-2.2-3.6.3-1.1-3.4-2.9-2 1.1-3.4-1.1-3.4 2.9-2 1.1-3.4 3.6.3L12 2Z"/><path d="m8.7 12.2 2.2 2.3 4.6-4.8"/></svg>'],
    ['effects', 'super-admin.html#effects', 'Profile effects', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>'],
    ['activity', 'super-admin.html#activity', 'Platform activity', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-7 4h8m-8 4h8m-8 4h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>']
  ];
  const userNavItems = [
    ['dashboard', 'dashboard.html', 'Calendar', navItems[0][3]],
    ['user', 'user.html', 'My savings', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M16 12h5m-5-2a2 2 0 1 0 0 4"/></svg>'],
    ['contributions', 'contributions.html', 'Records', navItems[1][3]],
    ['budget', 'budget.html', 'Budget', navItems[2][3]],
    ['reports', 'reports.html', 'Reports', navItems[4][3]]
  ];
  const pageRoles = {
    dashboard: ['ADMIN', 'TREASURER', 'MEMBER'], members: ['ADMIN'], contributions: ['ADMIN', 'TREASURER', 'MEMBER'],
    withdrawals: ['ADMIN', 'TREASURER', 'MEMBER'], expenses: ['ADMIN', 'TREASURER', 'MEMBER'], savings: ['ADMIN', 'TREASURER', 'MEMBER'], requests: ['ADMIN', 'TREASURER', 'MEMBER'],
    budget: ['ADMIN', 'TREASURER', 'MEMBER'], reports: ['ADMIN', 'TREASURER', 'MEMBER'], audit: ['ADMIN'], settings: ['ADMIN'], user: ['MEMBER'],
    'super-admin': ['SUPER_ADMIN'], account: ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER']
  };
  const recordTabIcons = {
    'contributions.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/></svg>',
    'withdrawals.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    'expenses.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/></svg>',
    'savings.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 1h11l-2 4 2 4H5"/></svg>',
    'requests.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  };

  function setLoading(visible, label = 'Opening your records…') {
    if (loaderSafetyTimer) {
      clearTimeout(loaderSafetyTimer);
      loaderSafetyTimer = null;
    }
    if (loaderSlowTimer) {
      clearTimeout(loaderSlowTimer);
      loaderSlowTimer = null;
    }
    let loader = document.getElementById('app-loader');
    if (!loader) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="app-loader" id="app-loader" role="status" aria-live="polite" aria-label="Loading" hidden>
          <div class="loader-sheet">
            <div class="savings-loader" aria-hidden="true">
              <span class="coin-gate"><span class="loader-coin"></span></span>
              <svg class="piggy-bank" viewBox="0 0 190 132">
                <defs>
                  <linearGradient id="ipon-pig-body-g" gradientUnits="userSpaceOnUse" x1="50" y1="28" x2="140" y2="114">
                    <stop offset="0" stop-color="#94dcb0"/>
                    <stop offset=".42" stop-color="#4fb182"/>
                    <stop offset="1" stop-color="#1f6f50"/>
                  </linearGradient>
                  <radialGradient id="ipon-pig-edge-shade" gradientUnits="userSpaceOnUse" cx="78" cy="52" r="84">
                    <stop offset=".6" stop-color="#0a3c2c" stop-opacity="0"/>
                    <stop offset="1" stop-color="#0a3c2c" stop-opacity=".34"/>
                  </radialGradient>
                  <linearGradient id="ipon-pig-belly-shade" gradientUnits="userSpaceOnUse" x1="0" y1="82" x2="0" y2="112">
                    <stop offset="0" stop-color="#05261c" stop-opacity="0"/>
                    <stop offset="1" stop-color="#05261c" stop-opacity=".22"/>
                  </linearGradient>
                  <linearGradient id="ipon-pig-ear-g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#86d8a5"/>
                    <stop offset="1" stop-color="#3b9f72"/>
                  </linearGradient>
                  <linearGradient id="ipon-pig-limb-g" gradientUnits="userSpaceOnUse" x1="0" y1="96" x2="0" y2="120">
                    <stop offset="0" stop-color="#2f9068"/>
                    <stop offset="1" stop-color="#1b6249"/>
                  </linearGradient>
                  <linearGradient id="ipon-pig-snout-side" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#6ccb9a"/>
                    <stop offset="1" stop-color="#2f9068"/>
                  </linearGradient>
                  <linearGradient id="ipon-pig-snout-face" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stop-color="#a6e6c0"/>
                    <stop offset="1" stop-color="#5cbc8d"/>
                  </linearGradient>
                  <linearGradient id="ipon-pig-slot-rim" gradientUnits="userSpaceOnUse" x1="80" y1="0" x2="113" y2="0">
                    <stop offset="0" stop-color="#d9b04a"/>
                    <stop offset="1" stop-color="#f6df8f"/>
                  </linearGradient>
                  <radialGradient id="ipon-pig-shadow-g">
                    <stop offset="0" stop-color="#0a2c24" stop-opacity=".3"/>
                    <stop offset="1" stop-color="#0a2c24" stop-opacity="0"/>
                  </radialGradient>
                </defs>
                <ellipse class="piggy-shadow" cx="96" cy="122" rx="66" ry="8" fill="url(#ipon-pig-shadow-g)"/>
                <path class="fall-line" d="M88 8v9"/>
                <path class="fall-line fall-line-b" d="M97 12v11"/>
                <path class="piggy-tail" d="M39 75C30 80 21 74 24 65c3-7 13-6 11 1-1 4-6 4-6 0"/>
                <rect x="64" y="96" width="19" height="23" rx="9.5" fill="url(#ipon-pig-limb-g)"/>
                <rect x="113" y="96" width="19" height="23" rx="9.5" fill="url(#ipon-pig-limb-g)"/>
                <path d="M96 27C128 27 157 42 157 67 158 92 134 111 100 111 66 111 36 96 36 69 36 44 62 27 96 27Z" fill="url(#ipon-pig-body-g)"/>
                <path d="M96 27C128 27 157 42 157 67 158 92 134 111 100 111 66 111 36 96 36 69 36 44 62 27 96 27Z" fill="url(#ipon-pig-edge-shade)"/>
                <path d="M96 27C128 27 157 42 157 67 158 92 134 111 100 111 66 111 36 96 36 69 36 44 62 27 96 27Z" fill="url(#ipon-pig-belly-shade)"/>
                <path class="piggy-shine" d="M49 66C50 50 61 40 78 36 70 43 63 53 61 68 57 70 52 69 49 66Z"/>
                <path d="M134 37C136 23 144 16 151 20 156 24 155 35 150 47Z" fill="url(#ipon-pig-ear-g)"/>
                <path d="M141 38C142 30 146 26 149 28 151 30 150 36 147 43Z" fill="#1f6f50" opacity=".55"/>
                <path d="M110 32C108 18 114 9 122 10 129 11 133 20 134 35Z" fill="url(#ipon-pig-ear-g)"/>
                <path d="M116 31C115 22 118 17 122 17 126 18 128 24 128 32Z" fill="#1f6f50" opacity=".55"/>
                <ellipse class="piggy-slot" cx="96.5" cy="34" rx="15" ry="4.2" stroke="url(#ipon-pig-slot-rim)"/>
                <ellipse class="piggy-slot-glow" cx="96.5" cy="34" rx="13" ry="3.2"/>
                <rect x="148" y="62" width="25" height="22" rx="10" fill="url(#ipon-pig-snout-side)"/>
                <ellipse cx="169" cy="73" rx="7.5" ry="10.5" fill="url(#ipon-pig-snout-face)"/>
                <ellipse cx="166.5" cy="73.5" rx="1.3" ry="2.5" fill="#1f6f50"/>
                <ellipse cx="171.5" cy="73.5" rx="1.3" ry="2.5" fill="#1f6f50"/>
                <ellipse cx="142" cy="58" rx="3.6" ry="4.4" fill="#073a2c"/>
                <circle cx="143.2" cy="56.5" r="1.2" fill="#fff"/>
                <path class="impact-mark" d="M164 41l5-9"/>
                <path class="impact-mark" d="M171 45l9-5"/>
              </svg>
            </div>
            <span class="sr-only" id="loader-label">Opening your records…</span>
            <div class="loader-slow-box" id="app-loader-slow-box" hidden>
              <small class="loader-slow-hint" id="app-loader-slow-hint">Slow internet detected. Still connecting to your records…</small>
              <button class="button button-secondary button-sm" id="app-loader-retry" type="button">Retry</button>
            </div>
          </div>
        </div>`);
      loader = document.getElementById('app-loader');
      document.getElementById('app-loader-retry')?.addEventListener('click', () => window.location.reload());
    }
    const slowBox = document.getElementById('app-loader-slow-box');
    const slowHint = document.getElementById('app-loader-slow-hint');
    if (slowBox) slowBox.hidden = true;
    if (!visible) document.body.classList.add('is-ready');
    const labelEl = document.getElementById('loader-label');
    if (labelEl) labelEl.textContent = label;
    loader.setAttribute('aria-label', label || 'Loading');
    loader.hidden = !visible;
    loader.setAttribute('aria-busy', String(visible));
    if (visible) {
      loaderSlowTimer = setTimeout(() => {
        if (loader && !loader.hidden && slowBox) {
          if (slowHint) {
            slowHint.textContent = navigator.onLine === false
              ? 'You appear to be offline. Reconnect to load your records.'
              : 'Your connection is slow right now. Still waiting for a response…';
          }
          slowBox.hidden = false;
        }
      }, 4500);
      loaderSafetyTimer = setTimeout(() => {
        if (loader && !loader.hidden) {
          loader.hidden = true;
          loader.setAttribute('aria-busy', 'false');
          document.body.classList.add('is-ready');
        }
      }, 8000);
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function normalizeNamePart(value) {
    return String(value || '').normalize('NFC').trim().replace(/\s+/g, ' ');
  }

  const PASSWORD_RULE = 'Use at least 8 characters with uppercase, lowercase, a number, and a symbol.';

  const SOCIAL_APPS = Object.freeze([
    {
      key: 'telegram',
      label: 'Telegram',
      placeholder: 'https://t.me/username or @username',
      hosts: ['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me', 'telegram.dog'],
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.665 3.717 2.935 10.554c-1.21.485-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"/></svg>'
    },
    {
      key: 'instagram',
      label: 'Instagram',
      placeholder: 'https://instagram.com/username or @username',
      hosts: ['instagram.com', 'www.instagram.com', 'm.instagram.com', 'instagr.am', 'www.instagr.am'],
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M7.1 1.5H16.9A5.6 5.6 0 0 1 22.5 7.1V16.9A5.6 5.6 0 0 1 16.9 22.5H7.1A5.6 5.6 0 0 1 1.5 16.9V7.1A5.6 5.6 0 0 1 7.1 1.5ZM7.1 3.6H16.9A3.5 3.5 0 0 1 20.4 7.1V16.9A3.5 3.5 0 0 1 16.9 20.4H7.1A3.5 3.5 0 0 1 3.6 16.9V7.1A3.5 3.5 0 0 1 7.1 3.6ZM12 6.8A5.2 5.2 0 1 0 12 17.2A5.2 5.2 0 1 0 12 6.8ZM12 8.9A3.1 3.1 0 1 1 12 15.1A3.1 3.1 0 1 1 12 8.9ZM17.5 5.15A1.35 1.35 0 1 0 17.5 7.85A1.35 1.35 0 1 0 17.5 5.15Z"/></svg>'
    },
    {
      key: 'facebook',
      label: 'Facebook',
      placeholder: 'https://facebook.com/username or @username',
      hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', 'web.facebook.com', 'fb.com', 'www.fb.com', 'fb.me', 'm.me'],
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M14.15 24v-8.95h3l.45-3.5h-3.45V9.32c0-1.01.28-1.7 1.73-1.7h1.85V4.48c-.32-.04-1.42-.14-2.7-.14-2.67 0-4.5 1.63-4.5 4.62v2.59H7.5v3.5h3.03V24h3.62Z"/></svg>'
    },
    {
      key: 'threads',
      label: 'Threads',
      placeholder: 'https://threads.net/@username or @username',
      hosts: ['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'],
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.86 11.17c-.08-.04-.17-.08-.25-.11-.15-2.77-1.66-4.35-4.2-4.37h-.05c-1.51 0-2.77.65-3.55 1.82l1.42.98c.59-.89 1.5-1.08 2.13-1.08h.03c.84.01 1.47.25 1.88.72.3.34.5.82.6 1.42-.74-.13-1.54-.17-2.4-.12-2.41.14-3.96 1.54-3.86 3.5.05.99.55 1.85 1.4 2.41.72.47 1.64.7 2.6.65 1.27-.07 2.26-.56 2.95-1.45.52-.68.85-1.56.99-2.66.6.36 1.04.84 1.29 1.41.41.95.44 2.51-.85 3.81-1.13 1.13-2.49 1.62-4.55 1.63-2.29-.02-4.01-.75-5.13-2.18-1.05-1.34-1.59-3.28-1.61-5.76.02-2.48.56-4.42 1.61-5.76 1.12-1.43 2.84-2.16 5.13-2.18 2.31.02 4.06.75 5.21 2.19.56.71.99 1.6 1.27 2.64l1.64-.44c-.34-1.28-.88-2.38-1.61-3.3-1.49-1.86-3.68-2.81-6.51-2.83h-.01c-2.82.02-4.98.97-6.44 2.83-1.29 1.65-1.96 3.96-1.99 6.86v.01c.03 2.9.7 5.21 1.99 6.86 1.46 1.86 3.62 2.81 6.44 2.83h.01c2.51-.02 4.29-.67 5.75-2.13 1.91-1.91 1.85-4.31 1.22-5.78-.45-1.05-1.31-1.9-2.48-2.46Zm-4.29 4.08c-1.06.06-2.17-.42-2.23-1.44-.04-.76.54-1.61 2.29-1.71.2-.01.4-.02.59-.02.63 0 1.22.06 1.76.18-.2 2.5-1.37 2.93-2.41 2.99Z"/></svg>'
    },
    {
      key: 'x',
      label: 'X (Twitter)',
      placeholder: 'https://x.com/username or @username',
      hosts: ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z"/></svg>'
    },
    {
      key: 'discord',
      label: 'Discord',
      placeholder: 'https://discord.com/users/1234567890 or discord.gg/...',
      hosts: ['discord.com', 'www.discord.com', 'discord.gg', 'www.discord.gg', 'discordapp.com', 'www.discordapp.com'],
      svg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.27 5.33A16.5 16.5 0 0 0 15.14 4a11.3 11.3 0 0 0-.52 1.07 15.2 15.2 0 0 0-5.24 0A11.3 11.3 0 0 0 8.86 4a16.5 16.5 0 0 0-4.13 1.33C2.12 9.25 1.4 13.07 1.76 16.84a16.7 16.7 0 0 0 5.06 2.57c.41-.56.77-1.15 1.08-1.78a10.8 10.8 0 0 1-1.7-.82c.14-.11.28-.22.41-.33a11.9 11.9 0 0 0 10.78 0c.13.11.27.22.41.33-.55.33-1.12.6-1.7.82.31.63.67 1.22 1.08 1.78a16.7 16.7 0 0 0 5.06-2.57c.42-4.37-.72-8.16-2.97-11.51ZM8.68 14.53c-.99 0-1.8-.91-1.8-2.02s.79-2.02 1.8-2.02 1.81.91 1.8 2.02c0 1.11-.79 2.02-1.8 2.02Zm6.64 0c-.99 0-1.8-.91-1.8-2.02s.79-2.02 1.8-2.02 1.81.91 1.8 2.02c0 1.11-.79 2.02-1.8 2.02Z"/></svg>'
    }
  ]);
  const SOCIAL_APP_MAP = new Map(SOCIAL_APPS.map((app) => [app.key, app]));
  const SOCIAL_HOST_PREFIX_RE = /^(?:www\.)?(?:t\.me|telegram\.me|telegram\.dog|instagram\.com|instagr\.am|m\.instagram\.com|facebook\.com|m\.facebook\.com|mbasic\.facebook\.com|web\.facebook\.com|fb\.com|fb\.me|m\.me|threads\.net|threads\.com|x\.com|mobile\.x\.com|twitter\.com|mobile\.twitter\.com|discord\.com|discord\.gg|discordapp\.com)(?:\/|\?|$)/i;

  function validateSocialAppInput(platform, raw, { live = false } = {}) {
    const meta = SOCIAL_APP_MAP.get(String(platform || '').toLowerCase());
    if (!meta) return { url: '', error: 'Unsupported social app.' };
    const value = String(raw || '').trim();
    if (!value) return { url: '', error: '' };
    if (value.length > 240 || /[\s<>"'`\\\u0000-\u001f\u007f]/.test(value)) {
      return { url: '', error: `Enter a valid ${meta.label} link without spaces or invalid characters.` };
    }
    if (/^(?:javascript|data|vbscript|file|blob):/i.test(value)) {
      return { url: '', error: `Enter a valid ${meta.label} link.` };
    }

    let candidate = '';
    if (/^https?:\/\//i.test(value)) {
      candidate = value.replace(/^https?:\/\//i, 'https://');
    } else if (value.startsWith('//')) {
      candidate = `https:${value}`;
    } else if (value.startsWith('@')) {
      const handle = value.slice(1);
      if (!handle && live) return { url: '', error: '' };
      if (meta.key === 'discord') {
        return { url: '', error: 'For Discord, paste a discord.com/users/... link, discord.gg/... invite, or numeric User ID.' };
      }
      if (meta.key === 'telegram') {
        if (!/^[A-Za-z0-9_]{3,32}$/.test(handle)) {
          if (live && /^[A-Za-z0-9_]{0,2}$/.test(handle)) return { url: '', error: '' };
          return { url: '', error: 'Telegram @username must be 3 to 32 letters, numbers, or underscores.' };
        }
        candidate = `https://t.me/${handle}`;
      } else if (meta.key === 'facebook') {
        if (!/^[A-Za-z0-9.]{3,50}$/.test(handle) || handle.includes('..') || handle.startsWith('.') || handle.endsWith('.')) {
          if (live && !handle.includes('..') && /^[A-Za-z0-9.]{0,50}$/.test(handle) && !handle.startsWith('.')) return { url: '', error: '' };
          return { url: '', error: 'Enter a valid Facebook @username or profile link.' };
        }
        candidate = `https://www.facebook.com/${handle}`;
      } else if (meta.key === 'x') {
        if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
          return { url: '', error: 'X (Twitter) @username must be 1 to 15 letters, numbers, or underscores.' };
        }
        candidate = `https://x.com/${handle}`;
      } else {
        if (!/^[A-Za-z0-9._]{1,30}$/.test(handle) || handle.includes('..') || handle.startsWith('.') || handle.endsWith('.')) {
          if (live && !handle.includes('..') && /^[A-Za-z0-9._]{0,30}$/.test(handle) && !handle.startsWith('.')) return { url: '', error: '' };
          return { url: '', error: `Enter a valid ${meta.label} @username or profile link.` };
        }
        candidate = meta.key === 'threads' ? `https://www.threads.net/@${handle}` : `https://www.instagram.com/${handle}`;
      }
    } else if (meta.key === 'discord' && /^[0-9]+$/.test(value)) {
      if (!/^[0-9]{15,22}$/.test(value)) {
        if (live && value.length < 15) return { url: '', error: '' };
        return { url: '', error: 'Discord User ID must be 15 to 22 digits, or paste a discord.com/users/... link.' };
      }
      candidate = `https://discord.com/users/${value}`;
    } else if (SOCIAL_HOST_PREFIX_RE.test(value)) {
      candidate = `https://${value}`;
    } else if (!/[./:?#]/.test(value)) {
      if (meta.key === 'discord') {
        if (live && /^d(?:i(?:s(?:c(?:o(?:r(?:d)?)?)?)?)?)?$/i.test(value)) return { url: '', error: '' };
        return { url: '', error: 'For Discord, paste a discord.com/users/... link, discord.gg/... invite, or numeric User ID.' };
      }
      if (meta.key === 'telegram') {
        if (!/^[A-Za-z0-9_]{3,32}$/.test(value)) {
          if (live && /^[A-Za-z0-9_]{0,2}$/.test(value)) return { url: '', error: '' };
          return { url: '', error: 'Telegram username must be 3 to 32 letters, numbers, or underscores.' };
        }
        candidate = `https://t.me/${value}`;
      } else if (meta.key === 'facebook') {
        if (!/^[A-Za-z0-9]{3,50}$/.test(value)) {
          if (live && /^[A-Za-z0-9]{0,2}$/.test(value)) return { url: '', error: '' };
          return { url: '', error: 'Enter a valid Facebook profile link or @username.' };
        }
        candidate = `https://www.facebook.com/${value}`;
      } else if (meta.key === 'x') {
        if (!/^[A-Za-z0-9_]{1,15}$/.test(value)) {
          return { url: '', error: 'X (Twitter) username must be 1 to 15 letters, numbers, or underscores.' };
        }
        candidate = `https://x.com/${value}`;
      } else {
        if (!/^[A-Za-z0-9_]{1,30}$/.test(value)) {
          return { url: '', error: `Enter a valid ${meta.label} @username or profile link.` };
        }
        candidate = meta.key === 'threads' ? `https://www.threads.net/@${value}` : `https://www.instagram.com/${value}`;
      }
    } else {
      if (live && /^(?:h(?:t(?:t(?:p(?:s?(?::(?:\/(?:\/)?)?)?)?)?)?)?|www\.|[a-z]+\.)/i.test(value) && !value.includes('/')) {
        return { url: '', error: '' };
      }
      return { url: '', error: `Enter a valid ${meta.label} link (e.g., ${meta.placeholder}).` };
    }

    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (_) {
      if (live && /^https:\/\/[a-z0-9.-]*$/i.test(candidate)) return { url: '', error: '' };
      return { url: '', error: `Enter a valid ${meta.label} URL.` };
    }
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
      return { url: '', error: `Enter a valid ${meta.label} URL.` };
    }
    if (!meta.hosts.includes(host)) {
      return { url: '', error: `Link must use an official ${meta.label} domain.` };
    }
    const cleanPath = parsed.pathname.replace(/^\/+|\/+$/g, '');
    if (!cleanPath) {
      if (live && /^https?:\/\/[^/]+\/?$/i.test(candidate)) return { url: '', error: '' };
      return { url: '', error: `Add your ${meta.label} username or path after ${host}/.` };
    }
    return { url: `https://${host}${parsed.pathname}${parsed.search}${parsed.hash}`, error: '' };
  }

  function normalizeSocialAppUrl(platform, raw) {
    return validateSocialAppInput(platform, raw, { live: false }).url;
  }

  function normalizeSocialAppOrder(rawOrder, links = null) {
    const allowed = links && typeof links === 'object'
      ? new Set(SOCIAL_APPS.map((app) => app.key).filter((key) => Boolean(normalizeSocialAppUrl(key, links[key]))))
      : null;
    const ordered = [];
    if (Array.isArray(rawOrder)) {
      for (const rawKey of rawOrder) {
        const key = String(rawKey || '').trim().toLowerCase();
        if (!SOCIAL_APP_MAP.has(key) || ordered.includes(key)) continue;
        if (allowed && !allowed.has(key)) continue;
        ordered.push(key);
      }
    }
    for (const app of SOCIAL_APPS) {
      if (allowed && !allowed.has(app.key)) continue;
      if (!ordered.includes(app.key)) ordered.push(app.key);
    }
    return ordered;
  }

  function sanitizeSocialLinks(links) {
    const clean = {};
    if (!links || typeof links !== 'object') return clean;
    const valid = {};
    for (const app of SOCIAL_APPS) {
      const url = normalizeSocialAppUrl(app.key, links[app.key]);
      if (url) valid[app.key] = url;
    }
    const order = normalizeSocialAppOrder(links._order, valid);
    for (const key of order) {
      clean[key] = valid[key];
    }
    if (order.length) {
      // Non-enumerable so Object.keys() and JSON.stringify() expose URL keys only in custom order.
      Object.defineProperty(clean, '_order', {
        value: order.slice(),
        enumerable: false,
        configurable: true
      });
    }
    return clean;
  }

  function reorderSocialAppKeys(order, dragKey, targetKey, placeAfter = false) {
    const prev = normalizeSocialAppOrder(order);
    if (!dragKey || !targetKey || dragKey === targetKey) return prev;
    const next = prev.slice();
    const fromIdx = next.indexOf(dragKey);
    if (fromIdx < 0) return prev;
    next.splice(fromIdx, 1);
    const targetIdx = next.indexOf(targetKey);
    if (targetIdx < 0) return prev;
    next.splice(placeAfter ? targetIdx + 1 : targetIdx, 0, dragKey);
    return next;
  }

  function serializeSocialLinks(links, order) {
    const clean = sanitizeSocialLinks(links);
    const ordered = normalizeSocialAppOrder(Array.isArray(order) ? order : clean._order, clean);
    const out = {};
    for (const key of ordered) {
      out[key] = clean[key];
    }
    if (ordered.length) out._order = ordered;
    return out;
  }

  function renderSocialAppLinksHtml(links, { variant = 'bio', showEmpty = false, draggable = false } = {}) {
    const clean = sanitizeSocialLinks(links);
    const items = Object.keys(clean).map((key) => SOCIAL_APP_MAP.get(key)).filter(Boolean);
    if (!items.length) {
      return showEmpty
        ? `<p class="social-apps-empty">${variant === 'summary' ? 'No apps connected yet.' : 'No connected apps yet. Paste links below to show icons in your bio.'}</p>`
        : '';
    }
    return `<div class="social-apps-strip is-${escapeHtml(variant)}${draggable ? ' is-reorderable' : ''}" role="list" aria-label="Connected social apps">${items.map((app) => (draggable
      ? `<button class="social-app-tile is-${app.key} is-draggable" type="button" role="listitem" data-drag-app="${app.key}" draggable="false" aria-label="Drag or use arrow keys to reorder ${app.label}" title="Drag to reorder ${app.label}">${app.svg}</button>`
      : `<a class="social-app-tile is-${app.key}" role="listitem" href="${escapeHtml(clean[app.key])}" target="_blank" rel="noopener noreferrer" data-social-app-link="${app.key}" aria-label="${app.label} profile (opens in a new tab)" title="${app.label}: ${escapeHtml(clean[app.key])}">${app.svg}</a>`)).join('')}</div>`;
  }

  function connectAppsFieldsMarkup() {
    return SOCIAL_APPS.map((app) => `<div class="field account-app-field"><label for="quick-app-${app.key}">${app.label}</label><div class="account-app-input-row"><span class="social-app-tile is-${app.key} is-badge" aria-hidden="true">${app.svg}</span><input id="quick-app-${app.key}" name="${app.key}" type="text" inputmode="url" maxlength="240" autocomplete="off" spellcheck="false" placeholder="${escapeHtml(app.placeholder)}" aria-describedby="quick-app-${app.key}-error"></div><small class="field-error account-app-error" id="quick-app-${app.key}-error" role="alert" hidden></small></div>`).join('');
  }

  function passwordIssue(value, personalValues = []) {
    if (value.length < 8 || value.length > 128) return PASSWORD_RULE;
    if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) return PASSWORD_RULE;
    const password = value.toLocaleLowerCase();
    const personalTokens = personalValues.flatMap((item) => String(item || '').split('@')[0].split(/[^\p{L}\p{N}]+/u)).filter((item) => item.length >= 3);
    if (personalTokens.some((item) => password.includes(item.toLocaleLowerCase()))) return 'Do not include your name or email in your password.';
    return '';
  }

  function bindPasswordStrength(input, personalValues = () => []) {
    const indicator = document.createElement('div');
    indicator.className = 'password-strength';
    indicator.innerHTML = `
      <small aria-live="polite">Enter a new password.</small>
      <ul class="password-rules-list" aria-label="Password requirements">
        <li class="password-rule-item" data-rule="length"><span class="rule-icon" aria-hidden="true">○</span><span>At least 8 characters</span></li>
        <li class="password-rule-item" data-rule="upper"><span class="rule-icon" aria-hidden="true">○</span><span>Uppercase letter (A-Z)</span></li>
        <li class="password-rule-item" data-rule="lower"><span class="rule-icon" aria-hidden="true">○</span><span>Lowercase letter (a-z)</span></li>
        <li class="password-rule-item" data-rule="number"><span class="rule-icon" aria-hidden="true">○</span><span>Number (0-9)</span></li>
        <li class="password-rule-item" data-rule="symbol"><span class="rule-icon" aria-hidden="true">○</span><span>Special symbol (!@#$…)</span></li>
      </ul>`;
    input.closest('.field')?.append(indicator);

    const ruleLength = indicator.querySelector('[data-rule="length"]');
    const ruleUpper = indicator.querySelector('[data-rule="upper"]');
    const ruleLower = indicator.querySelector('[data-rule="lower"]');
    const ruleNumber = indicator.querySelector('[data-rule="number"]');
    const ruleSymbol = indicator.querySelector('[data-rule="symbol"]');
    const summary = indicator.querySelector('small');

    const update = () => {
      const value = input.value || '';
      const lengthMet = value.length >= 8 && value.length <= 128;
      const lowerMet = /[a-z]/.test(value);
      const upperMet = /[A-Z]/.test(value);
      const numberMet = /[0-9]/.test(value);
      const symbolMet = /[^A-Za-z0-9]/.test(value);
      const score = [lengthMet, lowerMet, upperMet, numberMet, symbolMet].filter(Boolean).length;
      const issue = value ? passwordIssue(value, personalValues()) : '';

      const setRuleState = (el, isMet) => {
        if (!el) return;
        el.className = `password-rule-item ${value ? (isMet ? 'is-met' : 'is-unmet') : ''}`;
        const icon = el.querySelector('.rule-icon');
        if (icon) icon.textContent = value ? (isMet ? '✓' : '✕') : '○';
      };

      setRuleState(ruleLength, lengthMet);
      setRuleState(ruleUpper, upperMet);
      setRuleState(ruleLower, lowerMet);
      setRuleState(ruleNumber, numberMet);
      setRuleState(ruleSymbol, symbolMet);

      indicator.dataset.strength = !value ? 'empty' : issue ? (score >= 4 ? 'medium' : 'weak') : 'strong';

      if (!value) {
        if (summary) summary.textContent = 'Enter a new password.';
      } else if (!issue) {
        if (summary) summary.textContent = 'Strong password. All requirements are met.';
      } else if (issue.startsWith('Do not include')) {
        if (summary) summary.textContent = issue;
      } else {
        const missing = [];
        if (!lengthMet) missing.push(value.length < 8 ? 'at least 8 characters' : 'max 128 characters');
        if (!upperMet) missing.push('uppercase letter (A-Z)');
        if (!lowerMet) missing.push('lowercase letter (a-z)');
        if (!numberMet) missing.push('number (0-9)');
        if (!symbolMet) missing.push('special symbol (!@#$…)');
        if (summary) summary.textContent = `Missing: ${missing.join(', ')}.`;
      }
    };
    input.addEventListener('input', update);
    update();
    return { element: indicator, update };
  }

  function generateTemporaryPassword() {
    const sets = [
      'ABCDEFGHJKLMNPQRSTUVWXYZ',
      'abcdefghijkmnpqrstuvwxyz',
      '23456789',
      '!@#$%&*?'
    ];
    const all = sets.join('');
    const pick = (pool) => {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return pool[buf[0] % pool.length];
    };
    const chars = [...sets.map(pick)];
    while (chars.length < 12) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      const j = buf[0] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
  }

  function autofillTemporaryPassword(input) {
    if (!(input instanceof HTMLInputElement)) return '';
    const next = generateTemporaryPassword();
    input.value = next;
    input.type = 'text';
    const toggle = input.closest('.temp-password-box')?.querySelector('[data-temp-pw-toggle]');
    if (toggle) {
      toggle.textContent = 'Hide';
      toggle.setAttribute('aria-label', 'Hide password');
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return next;
  }

  function prepareTemporaryPassword(input) {
    if (!(input instanceof HTMLInputElement)) return;
    if (input.dataset.tempPwBound) {
      if (!input.value) autofillTemporaryPassword(input);
      return;
    }
    input.dataset.tempPwBound = 'true';
    input.setAttribute('data-temp-password', '');
    const wrap = document.createElement('div');
    wrap.className = 'temp-password-box';
    input.parentNode?.insertBefore(wrap, input);
    wrap.append(input);
    const tools = document.createElement('div');
    tools.className = 'temp-password-tools';
    tools.innerHTML = `
      <button class="temp-pw-btn" type="button" data-temp-pw-toggle aria-label="Hide password">Hide</button>
      <button class="temp-pw-btn" type="button" data-temp-pw-refresh title="Generate another recommended password" aria-label="Generate another recommended password">New</button>
    `;
    wrap.append(tools);
    const toggleBtn = tools.querySelector('[data-temp-pw-toggle]');
    const refreshBtn = tools.querySelector('[data-temp-pw-refresh]');
    toggleBtn.addEventListener('click', () => {
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      toggleBtn.textContent = hidden ? 'Hide' : 'Show';
      toggleBtn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
    });
    refreshBtn.addEventListener('click', () => autofillTemporaryPassword(input));
    if (!input.value) autofillTemporaryPassword(input);
  }

  const NAME_LOWERCASE_PARTICLES = new Set([
    'de', 'del', 'dela', 'los', 'las', 'la', 'le', 'da', 'di', 'do', 'dos', 'das',
    'van', 'von', 'den', 'der', 'ter', 'ten', 'ben', 'bin', 'binti', 'ibn', 'al'
  ]);
  const NAME_PARTICLE_LIST = [...NAME_LOWERCASE_PARTICLES];
  const NAME_ROMAN_SUFFIXES = new Set(['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']);
  const NAME_ROMAN_LIST = [...NAME_ROMAN_SUFFIXES];
  const NAME_CHAR_RULE = 'Use letters, spaces, hyphens, or apostrophes only.';
  const NAME_RULE = 'Use formal capitalization (e.g., Juan Dela Cruz). Do not use ALL CAPS or all lowercase.';
  const NAME_FIELD_META = Object.freeze({
    first_name: Object.freeze({
      label: 'first name',
      example: 'Juan',
      placeholder: 'e.g., Juan',
      requiredMsg: 'Enter a first name.'
    }),
    middle_name: Object.freeze({
      label: 'middle name',
      example: 'Santos or A',
      placeholder: 'e.g., Santos or A',
      requiredMsg: 'Enter a middle name.'
    }),
    last_name: Object.freeze({
      label: 'last name',
      example: 'Dela Cruz',
      placeholder: 'e.g., Dela Cruz',
      requiredMsg: 'Enter a last name.'
    })
  });

  function nameRuleForField(fieldName = '') {
    const meta = NAME_FIELD_META[String(fieldName || '').trim()];
    if (!meta) return { label: 'name', example: 'Juan Dela Cruz', placeholder: 'e.g., Juan Dela Cruz', requiredMsg: 'Enter this name.', ruleMsg: NAME_RULE };
    return {
      label: meta.label,
      example: meta.example,
      placeholder: meta.placeholder,
      requiredMsg: meta.requiredMsg,
      ruleMsg: `Use formal capitalization (e.g., ${meta.example}). Do not use ALL CAPS or all lowercase.`
    };
  }

  function nameWordError(word, index, totalWords, { live = false, allowSingleInitial = false, ruleMsg = NAME_RULE } = {}) {
    if (!word) return ruleMsg;
    if (index > 0) {
      if (NAME_LOWERCASE_PARTICLES.has(word)) {
        if (!live && index >= totalWords - 1) return ruleMsg;
        return '';
      }
      if (live && index === totalWords - 1 && /^\p{Ll}+$/u.test(word) && NAME_PARTICLE_LIST.some((p) => p.startsWith(word))) {
        return '';
      }
      if (index === totalWords - 1 && NAME_ROMAN_SUFFIXES.has(word)) return '';
      if (live && index === totalWords - 1 && /^\p{Lu}+$/u.test(word) && NAME_ROMAN_LIST.some((r) => r.startsWith(word))) {
        return '';
      }
    }
    const segments = word.split(/['\u2019-]/);
    for (const seg of segments) {
      if (!seg) return NAME_CHAR_RULE;
      if (!/^\p{Lu}/u.test(seg) || /\p{Lu}{2}/u.test(seg)) return ruleMsg;
      if (seg.length === 1) {
        if (segments.length > 1 || (live && totalWords === 1)) continue;
        if (!(allowSingleInitial && (totalWords === 1 || (index > 0 && index < totalWords - 1)))) return ruleMsg;
      } else {
        const segPattern = live
          ? /^\p{Lu}[\p{Ll}\p{M}]*(?:\p{Lu}[\p{Ll}\p{M}]*)*$/u
          : /^\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)*$/u;
        if (!segPattern.test(seg)) return ruleMsg;
      }
    }
    return '';
  }

  function nameValidationError(value, { allowSingleInitial = false, required = false, live = false, fieldName = '', formal = true } = {}) {
    const fieldRule = nameRuleForField(fieldName);
    const raw = String(value || '').normalize('NFC');
    const trimmedTrailingSep = live ? normalizeNamePart(raw.replace(/['\u2019-]\s*$/, '')) : normalizeNamePart(raw);
    const cleaned = normalizeNamePart(raw);
    if (!cleaned) return required && !live ? fieldRule.requiredMsg : '';
    const checkValue = live && !/['\u2019-]{2}/.test(raw.trim()) ? trimmedTrailingSep : cleaned;
    if (!checkValue) return NAME_CHAR_RULE;
    if (cleaned.length > 80) return 'Use 80 characters or fewer.';
    if (!/^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(checkValue)) return NAME_CHAR_RULE;
    const letterCount = checkValue.replace(/[^\p{L}]/gu, '').length;
    if (!live && !allowSingleInitial && letterCount < 2) {
      return !formal
        ? `Enter at least 2 letters for this ${fieldRule.label}.`
        : (fieldName
          ? `Enter at least 2 letters for this ${fieldRule.label} using formal capitalization (e.g., ${fieldRule.example}).`
          : 'Enter at least 2 letters using formal capitalization.');
    }
    if (!formal) return '';
    const words = checkValue.split(' ');
    for (let i = 0; i < words.length; i += 1) {
      const err = nameWordError(words[i], i, words.length, { live, allowSingleInitial, ruleMsg: fieldRule.ruleMsg });
      if (err) return err;
    }
    return '';
  }

  function validNamePart(value, options = {}) {
    const cleaned = normalizeNamePart(value);
    return Boolean(cleaned) && !nameValidationError(cleaned, { ...options, required: true, live: false });
  }

  function fullNameValidationError(value, { required = false, live = false } = {}) {
    const cleaned = normalizeNamePart(value);
    if (!cleaned) return required && !live ? 'Enter a full name.' : '';
    if (cleaned.length > 120) return 'Use 120 characters or fewer.';
    const basicErr = nameValidationError(value, { allowSingleInitial: true, required, live });
    if (basicErr) return basicErr;
    const words = cleaned.split(' ');
    if (!live && words.length < 2) return 'Enter first and last name (e.g., Juan Dela Cruz) or leave blank.';
    if (!live && words[words.length - 1].replace(/[^\p{L}]/gu, '').length < 2 && !NAME_ROMAN_SUFFIXES.has(words[words.length - 1])) {
      return 'Last name must have at least 2 letters using formal capitalization.';
    }
    return '';
  }

  function validFullName(value) {
    const cleaned = normalizeNamePart(value);
    return Boolean(cleaned) && !fullNameValidationError(cleaned, { required: true, live: false });
  }

  function getFieldErrorElement(control, create = false) {
    let error = (control.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => document.getElementById(id)).find((element) => element?.classList.contains('field-error'));
    const container = control.closest('.field,.decision-options');
    if (!error && container) error = container.querySelector('.field-error');
    if (!error && create && container) {
      error = document.createElement('small');
      error.className = 'field-error';
      error.setAttribute('role', 'alert');
      error.hidden = true;
      container.append(error);
    }
    return error || null;
  }

  function setFieldError(control, message) {
    control.toggleAttribute('aria-invalid', Boolean(message));
    const error = getFieldErrorElement(control, Boolean(message));
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
  }

  function getValidationMessage(control) {
    const validity = control.validity;
    if (!validity || validity.valid) return '';
    if (validity.customError) return control.validationMessage;
    const rawLabel = (control.labels?.[0]?.textContent || control.closest('.field')?.querySelector('label')?.textContent || 'This field').replace(/\s*\(optional\)\s*/i, '').trim();
    const lowerLabel = rawLabel.toLowerCase();
    if (validity.valueMissing) return control.tagName === 'SELECT' ? `Select a ${lowerLabel}.` : `${rawLabel} is required.`;
    if (validity.typeMismatch) return control.type === 'email' ? 'Enter a valid email address.' : `Enter a valid ${lowerLabel}.`;
    if (validity.badInput) return `Enter a valid ${lowerLabel}.`;
    if (validity.rangeUnderflow) {
      if (control.type === 'number' && Number(control.min) > 0 && Number(control.min) <= 1) return 'Enter an amount greater than zero.';
      if (control.type === 'date' || control.type === 'month') return `${rawLabel} cannot be earlier than ${control.min}.`;
      return `Enter a value of at least ${control.min}.`;
    }
    if (validity.rangeOverflow) {
      if (control.hasAttribute('data-max-today')) return `${rawLabel} cannot be in the future.`;
      if (control.hasAttribute('data-max-current-month')) return `${rawLabel} cannot be after the current month.`;
      return `Enter a value no greater than ${control.max}.`;
    }
    if (validity.stepMismatch) return control.step === '0.01' ? 'Enter a valid amount with up to 2 decimal places.' : `Enter a valid ${lowerLabel}.`;
    if (validity.tooShort) return `Enter at least ${control.minLength} characters.`;
    if (validity.tooLong) return `Use ${control.maxLength} characters or fewer.`;
    if (validity.patternMismatch) return control.title || `Enter a valid ${lowerLabel}.`;
    return control.validationMessage || `Enter a valid ${lowerLabel}.`;
  }

  function validateNameInput(input, { live = false } = {}) {
    const relaxed = input?.form?.dataset?.relaxedNames === 'true';
    const message = nameValidationError(input.value, {
      allowSingleInitial: input.name === 'middle_name',
      required: relaxed && input.name === 'last_name' ? false : input.required,
      live,
      fieldName: input.name || '',
      formal: !relaxed
    });
    input.setCustomValidity(message);
    setFieldError(input, message);
    return !message;
  }

  function validateNameFields(form) {
    if (!form) return true;
    const fields = ['first_name', 'middle_name', 'last_name']
      .map((name) => form.elements?.[name])
      .filter((control) => control && !control.disabled);
    let firstInvalid = null;
    for (const control of fields) {
      if (!validateNameInput(control) && !firstInvalid) firstInvalid = control;
    }
    const combinedLength = fields
      .map((control) => normalizeNamePart(control.value))
      .filter(Boolean)
      .join(' ').length;
    const lastField = form.elements?.last_name || firstInvalid;
    if (!firstInvalid && combinedLength > 150 && lastField) {
      const msg = 'Combined full name must not exceed 150 characters.';
      lastField.setCustomValidity(msg);
      setFieldError(lastField, msg);
      firstInvalid = lastField;
    }
    firstInvalid?.focus();
    return !firstInvalid;
  }

  function prepareInviteNameInput(input) {
    if (!input || input.dataset.inviteNameBound) return;
    input.dataset.inviteNameBound = 'true';
    input.title = NAME_RULE;
    const check = ({ live = false } = {}) => {
      const message = fullNameValidationError(input.value, { required: false, live });
      input.setCustomValidity(message);
      setFieldError(input, message);
      return !message;
    };
    input.addEventListener('input', () => {
      input.value = input.value.replace(/[^\p{L}\p{M} '\u2019-]/gu, '');
      if (normalizeNamePart(input.value) || input.hasAttribute('aria-invalid')) check({ live: true });
    });
    input.addEventListener('blur', () => check({ live: false }));
    input.addEventListener('invalid', () => check({ live: false }));
  }

  function prepareNameInputs() {
    document.querySelectorAll('input[name="first_name"],input[name="middle_name"],input[name="last_name"]').forEach((input) => {
      if (input.dataset.nameBound) return;
      input.dataset.nameBound = 'true';
      const fieldMeta = nameRuleForField(input.name);
      input.title = input.form?.dataset?.relaxedNames === 'true' ? NAME_CHAR_RULE : fieldMeta.ruleMsg;
      if (!input.placeholder && fieldMeta.placeholder) input.placeholder = fieldMeta.placeholder;
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^\p{L}\p{M} '\u2019-]/gu, '');
        if (normalizeNamePart(input.value) || input.hasAttribute('aria-invalid')) validateNameInput(input, { live: true });
      });
      input.addEventListener('blur', () => validateNameInput(input));
      input.addEventListener('invalid', () => validateNameInput(input));
    });
    document.querySelectorAll('input[name="invite_name"]').forEach(prepareInviteNameInput);
  }

  function syncProfileNameMode(form, allowRelaxed = false) {
    if (!form) return;
    form.dataset.relaxedNames = allowRelaxed ? 'true' : '';
    const lastInput = form.elements?.last_name;
    if (lastInput) {
      lastInput.required = !allowRelaxed;
      const label = lastInput.labels?.[0] || lastInput.closest?.('.field')?.querySelector?.('label');
      if (label) label.textContent = allowRelaxed ? 'Last name (optional)' : 'Last name';
    }
    ['first_name', 'middle_name', 'last_name'].forEach((name) => {
      const control = form.elements?.[name];
      if (!control) return;
      control.title = allowRelaxed ? NAME_CHAR_RULE : nameRuleForField(name).ruleMsg;
      if (control.hasAttribute?.('aria-invalid')) validateNameInput(control);
    });
  }

  const PHONE_RULE = 'Enter 11 digits starting with 09, or +63 followed by 10 digits starting with 9.';
  const PHONE_PARTIAL_PREFIX = /^(?:0(?:9\d{0,9})?|\+(?:6(?:3(?:9\d{0,9})?)?)?)$/;

  function validPhoneNumber(value) {
    return /^(?:09\d{9}|\+639\d{9})$/.test(String(value || '').trim());
  }

  function sanitizePhoneInput(input) {
    const startsWithPlus = input.value.trimStart().startsWith('+');
    const digits = input.value.replace(/\D/g, '').slice(0, startsWithPlus ? 12 : 11);
    input.value = startsWithPlus ? `+${digits}` : digits;
    return input.value;
  }

  function validateMobileField(input, { required = input?.required, requiredMessage = 'Enter your mobile number.', live = false } = {}) {
    const value = input.value.trim();
    let message = '';
    if (!value) {
      if (required && !live) message = requiredMessage;
    } else if (live && !input.hasAttribute('aria-invalid')) {
      if (!PHONE_PARTIAL_PREFIX.test(value)) message = PHONE_RULE;
    } else if (!validPhoneNumber(value)) {
      message = PHONE_RULE;
    }
    input.setCustomValidity(message);
    setFieldError(input, message);
    return !message;
  }

  function validatePhoneInput(input) {
    return validateMobileField(input);
  }

  function preparePhoneInputs() {
    document.querySelectorAll('input[type="tel"]').forEach((input) => {
      if (input.dataset.phoneBound) return;
      input.dataset.phoneBound = 'true';
      input.inputMode = 'tel';
      input.maxLength = 13;
      input.title = PHONE_RULE;
      input.addEventListener('input', () => {
        sanitizePhoneInput(input);
        validateMobileField(input, { live: true });
      });
      input.addEventListener('blur', () => validatePhoneInput(input));
      input.addEventListener('invalid', () => validatePhoneInput(input));
    });
  }

  const NUMERIC_ONLY_RULE = 'Use numbers only (0–9). Letters and symbols are not allowed.';

  function validNumericOnly(value) {
    return /^\d+$/.test(String(value || '').trim());
  }

  function validateNumericInput(input) {
    const raw = input.value.trim();
    const message = !raw && input.required ? 'Enter numbers only.' : raw && !validNumericOnly(raw) ? NUMERIC_ONLY_RULE : '';
    input.setCustomValidity(message);
    setFieldError(input, message);
    return !message;
  }

  const CATEGORY_PRESETS = Object.freeze({
    deduction: [
      'Member payout / cash-out',
      'Emergency use',
      'Loan / cash advance',
      'Savings distribution',
      'Bank / transfer fee',
      'Refund / adjustment'
    ],
    expense: [
      'Supplies & materials',
      'Food & refreshments',
      'Venue & events',
      'Printing & receipts',
      'Delivery & transport',
      'Bank / service fee',
      'Operations'
    ]
  });

  function renderCategorySelectOptions(select, groupKey) {
    if (!select) return;
    const list = CATEGORY_PRESETS[groupKey] || CATEGORY_PRESETS.deduction;
    select.innerHTML = [
      '<option value="">Select category</option>',
      ...list.map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`),
      '<option value="__CUSTOM__">Custom (specify)…</option>'
    ].join('');
  }

  function syncCategoryControl(input, value = input?.value) {
    if (!(input instanceof HTMLInputElement)) return;
    const controlWrap = input.closest('.category-control');
    const select = controlWrap?.querySelector('.category-preset-select');
    const isRequired = input.dataset.categoryRequired !== undefined
      ? input.dataset.categoryRequired === '1'
      : input.required;
    const groupKey = input.dataset.categoryPresets === 'expense' ? 'expense' : 'deduction';
    const presets = CATEGORY_PRESETS[groupKey] || CATEGORY_PRESETS.deduction;
    const trimmed = String(value ?? '').trim();

    if (!select) {
      input.value = trimmed;
      return;
    }

    if (!trimmed) {
      select.value = '';
      input.value = '';
      input.hidden = true;
      input.required = false;
      select.required = isRequired;
    } else {
      const matched = presets.find((item) => item.toLowerCase() === trimmed.toLowerCase());
      if (matched) {
        select.value = matched;
        input.value = matched;
        input.hidden = true;
        input.required = false;
        select.required = isRequired;
      } else {
        select.value = '__CUSTOM__';
        input.value = trimmed;
        input.hidden = false;
        input.required = isRequired;
        select.required = isRequired;
      }
    }
    select.setCustomValidity('');
    input.setCustomValidity('');
    setFieldError(select, '');
    setFieldError(input, '');
  }

  function setCategoryPresetGroup(input, groupKey, { required } = {}) {
    if (!(input instanceof HTMLInputElement)) return;
    const normalizedGroup = groupKey === 'expense' ? 'expense' : 'deduction';
    input.dataset.categoryPresets = normalizedGroup;
    if (typeof required === 'boolean') {
      input.dataset.categoryRequired = required ? '1' : '0';
    }
    const wrap = input.closest('.category-control');
    const select = wrap?.querySelector('.category-preset-select');
    if (select) renderCategorySelectOptions(select, normalizedGroup);
    syncCategoryControl(input, input.value);
  }

  function mountCategoryControls(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('input[data-category-presets]').forEach((input) => {
      if (!(input instanceof HTMLInputElement) || input.closest('.category-control')) return;
      const groupKey = input.dataset.categoryPresets === 'expense' ? 'expense' : 'deduction';
      input.dataset.categoryRequired = input.required ? '1' : '0';
      const wrap = document.createElement('div');
      wrap.className = 'category-control';
      const select = document.createElement('select');
      select.className = 'category-preset-select';
      select.setAttribute('aria-label', 'Category');
      renderCategorySelectOptions(select, groupKey);

      input.classList.add('category-custom-input');
      input.placeholder = 'Enter custom category';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(select);
      wrap.appendChild(input);

      const fieldLabel = wrap.closest('.field')?.querySelector('label[for]');
      if (fieldLabel && fieldLabel.getAttribute('for') === input.id) {
        fieldLabel.addEventListener('click', (event) => {
          if (input.hidden) {
            event.preventDefault();
            select.focus();
          }
        });
      }

      select.addEventListener('change', () => {
        const isReq = input.dataset.categoryRequired === '1';
        if (select.value === '__CUSTOM__') {
          input.hidden = false;
          input.required = isReq;
          const currentMatchesPreset = Object.values(CATEGORY_PRESETS).some((arr) => arr.includes(input.value));
          if (currentMatchesPreset) input.value = '';
          input.focus();
        } else {
          input.value = select.value;
          input.hidden = true;
          input.required = false;
        }
        select.required = isReq;
        select.setCustomValidity('');
        input.setCustomValidity('');
        setFieldError(select, '');
        setFieldError(input, '');
      });

      input.addEventListener('input', () => {
        const msg = input.required && !input.value.trim() ? 'Category is required.' : '';
        input.setCustomValidity(msg);
        setFieldError(input, '');
      });

      syncCategoryControl(input, input.value);
    });
  }

  const MAX_MONEY_AMOUNT = 999999999999.99;

  function formatPlainPesoLimit(amount) {
    return new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  function parseMoneyAmount(rawValue, { min = 0, max = MAX_MONEY_AMOUNT, required = false, label = 'Amount', badInput = false } = {}) {
    if (badInput) {
      return { valid: false, value: null, error: 'Enter a valid amount (numbers and up to 2 decimal places).' };
    }
    const raw = String(rawValue ?? '').trim();
    if (!raw) {
      return required
        ? { valid: false, value: null, error: `Enter a ${label.toLowerCase()}.` }
        : { valid: true, value: null, error: '' };
    }
    if (raw.startsWith('-') && min >= 0) {
      return { valid: false, value: null, error: `${label} cannot be negative.` };
    }
    if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) {
      return { valid: false, value: null, error: 'Use numbers only with up to 2 decimal places.' };
    }
    const [wholePart = ''] = raw.split('.');
    const maxWholeDigits = String(Math.floor(max)).length;
    if (wholePart.length > maxWholeDigits) {
      return { valid: false, value: null, error: `${label} must not exceed ${formatPlainPesoLimit(max)}.` };
    }
    const num = Number(raw);
    if (!Number.isFinite(num) || num > max) {
      return { valid: false, value: null, error: `${label} must not exceed ${formatPlainPesoLimit(max)}.` };
    }
    if (num < min) {
      return {
        valid: false,
        value: null,
        error: min > 0 ? `${label} must be at least ${formatPlainPesoLimit(min)}.` : `${label} cannot be negative.`
      };
    }
    return { valid: true, value: Math.round(num * 100) / 100, error: '' };
  }

  function validateMoneyInput(input, options = {}) {
    if (!(input instanceof HTMLInputElement)) return true;
    const min = options.min ?? (input.min !== '' && Number.isFinite(Number(input.min)) ? Number(input.min) : 0);
    const max = options.max ?? (input.max !== '' && Number.isFinite(Number(input.max)) ? Number(input.max) : MAX_MONEY_AMOUNT);
    const required = options.required ?? input.required;
    const res = parseMoneyAmount(input.value, {
      min,
      max,
      required,
      label: options.label || 'Amount',
      badInput: Boolean(input.validity?.badInput)
    });
    input.setCustomValidity(res.error);
    setFieldError(input, res.error);
    return res.valid;
  }

  function guardMoneyInput(input, options = {}) {
    if (!(input instanceof HTMLInputElement) || input.dataset.moneyGuardBound) return;
    input.dataset.moneyGuardBound = 'true';
    input.inputMode = 'decimal';
    if (input.min === '' && (options.min ?? 0) >= 0) input.min = String(options.min ?? 0);
    if (input.max === '') input.max = String(options.max ?? MAX_MONEY_AMOUNT);
    if (input.step === '') input.step = '0.01';
    input.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['e', 'E', '+', '-'].includes(event.key)) {
        event.preventDefault();
      }
    });
    if (!options.customDisplay) {
      const check = () => validateMoneyInput(input, options);
      input.addEventListener('input', () => {
        if (input.value || input.validity?.badInput || input.hasAttribute('aria-invalid')) check();
      });
      input.addEventListener('blur', check);
      input.addEventListener('invalid', check);
    }
  }

  const PESO_INPUT_SELECTOR = [
    '.field input[type="number"][name="amount"]',
    '.field input[type="number"][name="default_amount"]',
    '.field input[type="number"][name="monthly_amount"]',
    '.field input[type="number"][name="monthly_contribution_amount"]',
    '.field input[type="number"][name="target_amount"]',
    '.field input[type="number"][name="invite_amount"]',
    '#calc-target',
    '#calc-current'
  ].join(', ');

  function preparePesoInputs(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll(PESO_INPUT_SELECTOR).forEach((input) => {
      if (!(input instanceof HTMLInputElement)) return;
      guardMoneyInput(input);
      if (!input.parentNode || input.closest('.peso-input-wrap')) return;
      const wrap = document.createElement('div');
      wrap.className = 'peso-input-wrap';
      const prefix = document.createElement('span');
      prefix.className = 'peso-prefix';
      prefix.setAttribute('aria-hidden', 'true');
      prefix.textContent = '₱';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(prefix);
      wrap.appendChild(input);
    });
  }

  function prepareNumericInputs(root = document) {
    root.querySelectorAll('input[name="reference"], input[name="reference_number"], input[name="payment_account_number"], input[data-numeric-only]').forEach((input) => {
      if (input.dataset.numericBound) return;
      input.dataset.numericBound = 'true';
      input.inputMode = 'numeric';
      input.title = NUMERIC_ONLY_RULE;
      input.addEventListener('input', () => {
        const cleaned = input.value.replace(/\D/g, '');
        if (input.value !== cleaned) input.value = cleaned;
        if (input.hasAttribute('aria-invalid')) validateNumericInput(input);
      });
      input.addEventListener('blur', () => validateNumericInput(input));
      input.addEventListener('invalid', () => validateNumericInput(input));
    });
    preparePesoInputs(root);
    mountCategoryControls(root);
  }

  function prepareFormValidation() {
    if (document.documentElement.dataset.validationBound) return;
    document.documentElement.dataset.validationBound = 'true';
    const syncControl = (control) => {
      if (!(control instanceof HTMLElement) || !control.matches('input,select,textarea')) return;
      if (control.matches('input[name="first_name"],input[name="middle_name"],input[name="last_name"]')) {
        validateNameInput(control);
        return;
      }
      if (control.matches('input[type="tel"]')) {
        validatePhoneInput(control);
        return;
      }
      if (control.matches('input[name="reference"],input[name="reference_number"],input[name="payment_account_number"],input[data-numeric-only]')) {
        validateNumericInput(control);
        return;
      }
      if (control.matches(PESO_INPUT_SELECTOR)) {
        validateMoneyInput(control);
        return;
      }
      setFieldError(control, control.checkValidity() ? '' : getValidationMessage(control));
    };
    document.addEventListener('invalid', (event) => {
      const control = event.target;
      if (!(control instanceof HTMLElement) || !control.matches('input,select,textarea')) return;
      event.preventDefault();
      syncControl(control);
      const firstInvalid = control.form?.querySelector(':invalid,[aria-invalid="true"]');
      if (!firstInvalid || firstInvalid === control) control.focus();
    }, true);
    const onEdit = (event) => {
      const control = event.target;
      if (!(control instanceof HTMLElement) || !control.matches('input,select,textarea') || !control.hasAttribute('aria-invalid')) return;
      syncControl(control);
    };
    document.addEventListener('input', onEdit);
    document.addEventListener('change', onEdit);
    document.addEventListener('reset', (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      window.requestAnimationFrame(() => {
        form.querySelectorAll('input,select,textarea').forEach((control) => {
          control.setCustomValidity('');
          setFieldError(control, '');
        });
        form.querySelectorAll('[data-temp-password]').forEach((control) => autofillTemporaryPassword(control));
        form.querySelectorAll('input[data-category-presets]').forEach((control) => syncCategoryControl(control, ''));
      });
    });
    document.querySelectorAll('[data-temp-password]').forEach(prepareTemporaryPassword);
  }

  function profileNeedsSetup(profile) {
    const isSuperAdmin = profile?.role === 'SUPER_ADMIN';
    const first = normalizeNamePart(profile?.first_name);
    const middle = normalizeNamePart(profile?.middle_name);
    const last = normalizeNamePart(profile?.last_name);
    return Boolean(profile?.name_setup_required)
      || !first
      || (!isSuperAdmin && !last)
      || !validNamePart(first, { formal: !isSuperAdmin })
      || (middle ? !validNamePart(middle, { allowSingleInitial: true, formal: !isSuperAdmin }) : false)
      || (last ? !validNamePart(last, { formal: !isSuperAdmin }) : false)
      || (profile?.contact_number ? !validPhoneNumber(profile.contact_number) : false);
  }

  function accountSetupUrl(profile, user) {
    const params = new URLSearchParams();
    if (user.app_metadata?.must_change_password) params.set('force_password', '1');
    if (profileNeedsSetup(profile)) params.set('complete_profile', '1');
    return params.size ? `account.html?${params}` : '';
  }

  function money(value) {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })
      .format(Number(value || 0));
  }

  function dateLabel(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
    if (!value) return '—';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', options).format(date);
  }

  function isoDate(date = new Date()) {
    const offset = date.getTimezoneOffset();
    return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function monthStart(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
  }

  function applyInputDateBounds() {
    const today = isoDate();
    document.querySelectorAll('[data-max-today]').forEach((input) => { input.max = today; });
    document.querySelectorAll('[data-max-current-month]').forEach((input) => { input.max = today.slice(0, 7); });
  }

  const brandHtml = `
    <a class="app-brand brand" data-region="brand" href="dashboard.html" aria-label="myIPON home">
      <svg class="brand-coins" viewBox="8 10 52 46" aria-hidden="true">
        <path d="M38 28V13" fill="none" stroke="#68ba3b" stroke-width="3" stroke-linecap="round"/>
        <path d="M38 17c5-7.5 13-9.5 20-7.5-1 7.5-8.5 12-20 12Z" fill="#75c242"/>
        <path d="M38 22c-4.5-6-11-8-17-6 1 6 7 9.5 17 9.5Z" fill="#52992d"/>
        <ellipse cx="43" cy="32" rx="14" ry="5" fill="#f8dc84" stroke="#c99532" stroke-width="0.8"/>
        <text x="43" y="34.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="7.5" font-weight="900" fill="#a4721c" transform="scale(1, 0.65) translate(0, 16)">₱</text>
        <path d="M29 32v7c0 2.8 6.3 4.8 14 4.8s14-2 14-4.8v-7c0 2.8-6.3 4.8-14 4.8s-14-2-14-4.8Z" fill="#e5b44d"/>
        <path d="M33 35v4.5M38 36v4.5M43 36.5v4.5M48 36v4.5M53 35v4.5" stroke="#c49028" stroke-width="0.8" fill="none" opacity="0.7"/>
        <path d="M29 39v7c0 2.8 6.3 4.8 14 4.8s14-2 14-4.8v-7c0 2.8-6.3 4.8-14 4.8s-14-2-14-4.8Z" fill="#d8a33a"/>
        <path d="M33 42v4.5M38 43v4.5M43 43.5v4.5M48 43v4.5M53 42v4.5" stroke="#b07a1c" stroke-width="0.8" fill="none" opacity="0.7"/>
        <circle cx="20" cy="42" r="12" fill="#f8dc84" stroke="#c99532" stroke-width="1.3"/>
        <circle cx="20" cy="42" r="9.5" fill="#f1cb65"/>
        <text x="20" y="46.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="900" fill="#9e6c15">₱</text>
      </svg>
      <span class="brand-divider" aria-hidden="true"></span>
      <span class="brand-text">
        <strong><span class="brand-prefix">my</span>IPON</strong>
      </span>
    </a>`;

  const sidebarArtHtml = `
    <div class="sidebar-art" aria-hidden="true">
      <svg viewBox="0 0 180 145" fill="none">
        <path d="M0 118c42-16 84-6 180-24v51H0v-27Z" fill="rgba(255,255,255,.04)"/>
        <path d="M0 128c55-14 112 4 180-15v32H0v-17Z" fill="rgba(255,255,255,.06)"/>
        <rect x="44" y="54" width="84" height="64" rx="12" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.26)" stroke-width="1.5"/>
        <path d="M86 54V26" stroke="#62a87c" stroke-width="2.4" stroke-linecap="round"/>
        <path d="M86 38c-2-12-15-18-24-14 2 11 12 17 24 14Z" fill="#5da377"/>
        <path d="M86 31c3-13 16-20 26-16-2 12-13 19-26 16Z" fill="#7bc092"/>
        <path d="M86 45c4-9 14-12 22-9-3 9-12 12-22 9Z" fill="#4b8d64"/>
        <ellipse cx="67" cy="94" rx="14" ry="4.5" fill="#ebd089"/>
        <path d="M53 94v6c0 2.5 6.3 4.5 14 4.5s14-2 14-4.5v-6c0 2.5-6.3 4.5-14 4.5s-14-2-14-4.5Z" fill="#c89b43"/>
        <path d="M53 102v6c0 2.5 6.3 4.5 14 4.5s14-2 14-4.5v-6c0 2.5-6.3 4.5-14 4.5s-14-2-14-4.5Z" fill="#dfbe6f"/>
        <ellipse cx="101" cy="78" rx="15" ry="4.8" fill="#f1d894"/>
        <path d="M86 78v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#cfa34b"/>
        <path d="M86 86v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#e5c473"/>
        <path d="M86 94v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#c5963e"/>
        <path d="M86 102v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#dfbe6f"/>
      </svg>
    </div>`;

  const ACTIVE_ROLE_KEY = 'ipon_active_role';
  const SHELL_SNAPSHOT_KEY = 'ipon_shell_snapshot';
  const SHELL_AVATAR_KEY = 'ipon_shell_avatar';
  const VALID_SHELL_ROLES = ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER'];
  const DEFAULT_SIDEBAR_AVATAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>';

  function readShellSnapshot() {
    try {
      const raw = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SHELL_SNAPSHOT_KEY) : null)
        || (typeof localStorage !== 'undefined' ? localStorage.getItem(SHELL_SNAPSHOT_KEY) : null);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeShellSnapshot(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    try {
      const current = readShellSnapshot() || {};
      const nextUserId = patch.userId ? String(patch.userId) : (current.userId || '');
      const switchedUser = Boolean(patch.userId && current.userId && String(patch.userId) !== String(current.userId));
      const base = switchedUser ? {} : current;
      const next = {
        userId: nextUserId,
        role: VALID_SHELL_ROLES.includes(patch.role) ? patch.role : (base.role || ''),
        fullName: typeof patch.fullName === 'string' && patch.fullName.trim() ? patch.fullName.trim() : (base.fullName || ''),
        unreadCount: patch.unreadCount !== undefined && Number.isFinite(Number(patch.unreadCount))
          ? Math.max(0, Math.floor(Number(patch.unreadCount)))
          : (Number.isFinite(Number(base.unreadCount)) ? Math.max(0, Math.floor(Number(base.unreadCount))) : 0),
        unreadMessagesCount: patch.unreadMessagesCount !== undefined && Number.isFinite(Number(patch.unreadMessagesCount))
          ? Math.max(0, Math.floor(Number(patch.unreadMessagesCount)))
          : (Number.isFinite(Number(base.unreadMessagesCount)) ? Math.max(0, Math.floor(Number(base.unreadMessagesCount))) : 0)
      };
      const serialized = JSON.stringify(next);
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SHELL_SNAPSHOT_KEY, serialized);
      if (typeof localStorage !== 'undefined') localStorage.setItem(SHELL_SNAPSHOT_KEY, serialized);
    } catch { }
  }

  function isSafeImageRef(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    return raw.startsWith('data:image/') || /^https:\/\/[a-z0-9.-]+\//i.test(raw);
  }

  function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl || '');
    const match = raw.match(/^data:([^;,]+);base64,(.+)$/i);
    if (!match) throw new Error('Invalid image data format.');
    const mime = match[1] || 'image/jpeg';
    const bin = atob(match[2].replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function uploadMediaDataUrl(dataUrl, { category = 'avatars', name = 'image.jpg' } = {}) {
    const raw = typeof dataUrl === 'string' ? dataUrl.trim() : '';
    if (!raw) return null;
    if (/^https:\/\//i.test(raw)) return raw;
    const client = getClient();
    if (!client?.storage) return raw;
    const blob = dataUrlToBlob(raw);
    const meta = await invokeAccountFunction({
      action: 'media-upload-url',
      category,
      name: String(name || 'image.jpg').slice(0, 120),
      content_type: blob.type || 'image/jpeg'
    });
    if (!meta?.path || !meta?.token || !meta?.publicUrl) {
      throw new Error('Could not prepare cloud storage upload.');
    }
    const { error } = await client.storage
      .from(meta.bucket || 'ipon-media')
      .uploadToSignedUrl(meta.path, meta.token, blob, {
        contentType: blob.type || 'image/jpeg',
        upsert: true
      });
    if (error) throw error;
    return meta.publicUrl;
  }

  async function uploadAuthorizedFile(client, bucket, upload, file) {
    if (upload?.signedUrl) {
      const response = await fetch(upload.signedUrl, {
        method: 'PUT',
        headers: file.type ? { 'Content-Type': file.type } : undefined,
        body: file
      });
      if (!response.ok) throw new Error(`Cloud upload failed (${response.status}).`);
      return;
    }
    const { error } = await client.storage
      .from(bucket)
      .uploadToSignedUrl(upload.path, upload.token, file, { contentType: file.type || undefined });
    if (error) throw error;
  }

  async function optimizeUploadImage(file) {
    if (!file || file.size < 256 * 1024 || file.size > 25 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(file.type)
      || typeof createImageBitmap !== 'function' || typeof File !== 'function') return file;
    let bitmap;
    try {
      if (file.type === 'image/png') {
        const bytes = new DataView(await file.slice(0, 65536).arrayBuffer());
        let foundImageData = false;
        for (let offset = 8; offset + 12 <= bytes.byteLength;) {
          const length = bytes.getUint32(offset);
          if (length > bytes.byteLength - offset - 12) break;
          const chunk = String.fromCharCode(...new Uint8Array(bytes.buffer, offset + 4, 4));
          if (chunk === 'acTL') return file;
          if (chunk === 'IDAT') { foundImageData = true; break; }
          offset += length + 12;
        }
        if (!foundImageData) return file;
      }
      bitmap = await createImageBitmap(file);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
      if (!blob || blob.type !== 'image/webp' || blob.size >= file.size * 0.8) return file;
      const name = String(file.name || 'image').replace(/\.[^.]+$/, '') + '.webp';
      return new File([blob], name, { type: 'image/webp', lastModified: file.lastModified });
    } catch {
      return file;
    } finally {
      bitmap?.close?.();
    }
  }

  let mediaCodecPromise;
  let mediaCodecUnavailable = false;
  let mediaCodecQueue = Promise.resolve();

  async function loadMediaCodec() {
    if (mediaCodecUnavailable) return null;
    if (!mediaCodecPromise) mediaCodecPromise = (async () => {
      if (!window.FFmpegWASM?.FFmpeg) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = '/assets/ffmpeg/ffmpeg.js';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Media encoder could not be loaded.'));
          document.head.appendChild(script);
        });
      }
      const codec = new window.FFmpegWASM.FFmpeg();
      await codec.load({
        coreURL: '/assets/ffmpeg/ffmpeg-core.js',
        wasmURL: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm'
      });
      return codec;
    })().catch(() => {
      mediaCodecUnavailable = true;
      return null;
    });
    return mediaCodecPromise;
  }

  async function optimizeUploadMedia(file) {
    if (file?.type === 'image/jpeg' || file?.type === 'image/png') return optimizeUploadImage(file);
    const isVideo = file?.type === 'video/mp4' || /\.mp4$/i.test(file?.name || '');
    const isAudio = file?.type === 'audio/mpeg' || /\.mp3$/i.test(file?.name || '');
    if ((!isVideo && !isAudio) || file.size < 2 * 1024 * 1024 || file.size > 25 * 1024 * 1024 || typeof File !== 'function') return file;
    const process = async () => {
      const codec = await loadMediaCodec();
      if (!codec) return file;
      const input = `input-${crypto.randomUUID()}.${isVideo ? 'mp4' : 'mp3'}`;
      const output = `output-${crypto.randomUUID()}.${isVideo ? 'mp4' : 'mp3'}`;
      try {
        await codec.writeFile(input, new Uint8Array(await file.arrayBuffer()));
        const args = isVideo
          ? ['-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output]
          : ['-i', input, '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '128k', output];
        if (await codec.exec(args, 120000) !== 0) return file;
        const data = await codec.readFile(output);
        if (data.length < 1024 || data.length >= file.size * 0.8) return file;
        return new File([data], file.name, { type: isVideo ? 'video/mp4' : 'audio/mpeg', lastModified: file.lastModified });
      } catch {
        return file;
      } finally {
        await codec.deleteFile(input).catch(() => {});
        await codec.deleteFile(output).catch(() => {});
      }
    };
    const result = mediaCodecQueue.then(process, process);
    mediaCodecQueue = result.then(() => {}, () => {});
    return result;
  }

  function readShellAvatar(expectedUserId = '') {
    try {
      const raw = (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(SHELL_AVATAR_KEY) : null)
        || (typeof localStorage !== 'undefined' ? localStorage.getItem(SHELL_AVATAR_KEY) : null);
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      const url = typeof parsed?.avatarUrl === 'string' ? parsed.avatarUrl : '';
      if (!isSafeImageRef(url)) return '';
      if (expectedUserId && parsed?.userId && String(parsed.userId) !== String(expectedUserId)) return '';
      return url;
    } catch {
      return '';
    }
  }

  function writeShellAvatar(userId, avatarUrl) {
    try {
      if (!isSafeImageRef(avatarUrl)) {
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SHELL_AVATAR_KEY);
        if (typeof localStorage !== 'undefined') localStorage.removeItem(SHELL_AVATAR_KEY);
        return;
      }
      const serialized = JSON.stringify({ userId: userId ? String(userId) : '', avatarUrl: String(avatarUrl).trim() });
      if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(SHELL_AVATAR_KEY, serialized);
      if (typeof localStorage !== 'undefined') localStorage.setItem(SHELL_AVATAR_KEY, serialized);
    } catch { }
  }

  function syncSidebarUserInfo(fullName, role) {
    const sidebarUser = document.getElementById('sidebar-user');
    if (!sidebarUser) return;
    const label = role && VALID_SHELL_ROLES.includes(role) ? (role === 'SUPER_ADMIN' ? 'Owner' : 'My account') : 'ACCOUNT';
    const safeName = typeof fullName === 'string' && fullName.trim() ? fullName.trim() : 'Checking session…';
    sidebarUser.innerHTML = `<strong>${escapeHtml(safeName)}</strong><small>${escapeHtml(label)}</small>`;
  }

  function syncNotificationBadges(unread, { persist = true } = {}) {
    const count = Math.max(0, Math.floor(Number(unread) || 0));
    document.querySelectorAll('[data-notification-count]').forEach((badge) => {
      badge.textContent = String(count);
      badge.hidden = count === 0;
    });
    if (persist) writeShellSnapshot({ unreadCount: count });
  }

  function syncMessagesBadges(unread, { persist = true } = {}) {
    const count = Math.max(0, Math.floor(Number(unread) || 0));
    document.querySelectorAll('[data-messages-count]').forEach((badge) => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    });
    if (persist) writeShellSnapshot({ unreadMessagesCount: count });
  }

  const ACTIVE_WORKSPACE_MODE_KEY = 'ipon_workspace_mode';

  function readStoredWorkspaceMode() {
    const domMode = document?.documentElement?.dataset?.workspaceMode;
    if (domMode === 'SOLO' || domMode === 'GROUP') return domMode;
    try {
      const saved = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ACTIVE_WORKSPACE_MODE_KEY))
        || (typeof localStorage !== 'undefined' && localStorage.getItem(ACTIVE_WORKSPACE_MODE_KEY));
      if (saved === 'SOLO' || saved === 'GROUP') return saved;
    } catch { }
    return 'GROUP';
  }

  function syncWorkspaceMode(mode, { persist = true } = {}) {
    const normalized = String(mode || '').toUpperCase() === 'SOLO' ? 'SOLO' : 'GROUP';
    if (document?.documentElement?.dataset) {
      document.documentElement.dataset.workspaceMode = normalized;
    }
    if (persist) {
      try {
        sessionStorage.setItem(ACTIVE_WORKSPACE_MODE_KEY, normalized);
        localStorage.setItem(ACTIVE_WORKSPACE_MODE_KEY, normalized);
      } catch { }
    }
    const effectiveRole = resolveActiveRole();
    document.querySelectorAll('a[href="members.html"], [data-group-only]').forEach((el) => {
      const roles = el.dataset?.role ? String(el.dataset.role).split(',') : null;
      const roleHidden = roles ? !roles.includes(effectiveRole) : false;
      el.hidden = roleHidden || normalized === 'SOLO';
    });
    return normalized;
  }

  function syncShellRoleVisibility(effectiveRole) {
    if (document?.documentElement?.dataset && VALID_SHELL_ROLES.includes(effectiveRole)) {
      document.documentElement.dataset.shellRole = effectiveRole;
    }
    const workspaceMode = effectiveRole === 'SUPER_ADMIN' ? 'GROUP' : readStoredWorkspaceMode();
    document.querySelectorAll('[data-role]').forEach((element) => {
      const roles = String(element.dataset?.role || '').split(',');
      const groupOnlyHidden = workspaceMode === 'SOLO' && (element.hasAttribute('data-group-only') || element.getAttribute('href') === 'members.html');
      element.hidden = !roles.includes(effectiveRole) || groupOnlyHidden;
    });
    if (effectiveRole === 'SUPER_ADMIN') {
      document.querySelectorAll('[data-messages-open]').forEach((el) => { el.remove(); });
    }
  }

  function resolveActiveRole(passedRole) {
    if (passedRole) return passedRole;
    if (currentProfile?.role) return currentProfile.role;
    const page = document.body.dataset.page;
    if (document.body.dataset.panel === 'super-admin' || page === 'super-admin') return 'SUPER_ADMIN';
    try {
      const cached = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(ACTIVE_ROLE_KEY))
        || (typeof localStorage !== 'undefined' && localStorage.getItem(ACTIVE_ROLE_KEY));
      if (cached && VALID_SHELL_ROLES.includes(cached)) return cached;
    } catch { }
    if (page === 'user') return 'MEMBER';
    if (['members', 'audit', 'settings'].includes(page)) return 'ADMIN';
    return 'ADMIN';
  }

  function mountShell(role = currentProfile?.role) {
    const host = document.getElementById('app-sidebar');
    const effectiveRole = resolveActiveRole(role);
    const snapshot = readShellSnapshot();
    const cachedName = currentProfile?.full_name || snapshot?.fullName || '';
    const cachedRole = currentProfile?.role || snapshot?.role || effectiveRole;
    const cachedUserId = currentProfile?.id || snapshot?.userId || '';
    const cachedUnread = Number.isFinite(Number(snapshot?.unreadCount)) ? Math.max(0, Math.floor(Number(snapshot.unreadCount))) : 0;
    const cachedMsgUnread = Number.isFinite(Number(snapshot?.unreadMessagesCount)) ? Math.max(0, Math.floor(Number(snapshot.unreadMessagesCount))) : 0;
    const cachedAvatar = currentProfile?.avatar_url || readShellAvatar(cachedUserId);
    const roleLabel = cachedRole && VALID_SHELL_ROLES.includes(cachedRole)
      ? (cachedRole === 'SUPER_ADMIN' ? 'Owner' : 'My account')
      : 'ACCOUNT';
    if (host) {
      const page = document.body.dataset.page;
      const superAdminPanel = document.body.dataset.panel === 'super-admin';
      const allowMessages = !superAdminPanel && effectiveRole !== 'SUPER_ADMIN';
      const msgUtilityHtml = allowMessages
        ? `<button class="sidebar-utility" data-messages-open type="button" aria-label="Open messages and connections" title="Messages"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><b data-messages-count${cachedMsgUnread > 0 ? '' : ' hidden'}>${cachedMsgUnread > 99 ? '99+' : cachedMsgUnread}</b></button>`
        : '';
      const navigation = (superAdminPanel || effectiveRole === 'SUPER_ADMIN' ? superAdminNavItems : effectiveRole === 'MEMBER' ? userNavItems : navItems)
        .filter(([, , , , requiredRole]) => !requiredRole || requiredRole === effectiveRole);
      const activeId = superAdminPanel ? location.hash.slice(1) || 'overview' : ['contributions', 'withdrawals', 'expenses', 'savings', 'requests'].includes(page) ? 'contributions' : page === 'audit' ? 'reports' : page;
      const isAccountSubview = !superAdminPanel && ['account', 'settings'].includes(page);
      if (host.dataset.renderedRole === effectiveRole) {
        host.querySelectorAll('.app-nav a').forEach((link) => {
          const isActive = link.dataset.navSection === activeId;
          link.classList.toggle('is-active', isActive);
          if (isActive) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        });
        const accountCard = host.querySelector('[data-account-open]');
        if (accountCard) {
          accountCard.classList.toggle('is-active', isAccountSubview);
          if (isAccountSubview) accountCard.setAttribute('aria-current', 'page');
          else accountCard.removeAttribute('aria-current');
        }
      } else {
        host.dataset.renderedRole = effectiveRole;
        host.innerHTML = `
        ${brandHtml.replace('href="dashboard.html"', `href="${superAdminPanel ? 'super-admin.html' : 'dashboard.html'}"`)}
        <nav class="app-nav" aria-label="Main navigation">
          ${navigation.map(([id, href, label, icon, role]) => `<a class="${activeId === id ? 'is-active' : ''}" href="${href}" aria-label="${label}" data-nav-section="${id}"${activeId === id ? ' aria-current="page"' : ''}${role ? ` data-role="${role}"` : ''}${id === 'members' ? ' data-group-only="1"' : ''}>${icon || ''}<span>${label}</span></a>`).join('')}
        </nav>
        ${sidebarArtHtml}
        <div class="app-sidebar-footer">
          <div class="sidebar-utilities">
            ${msgUtilityHtml}<button class="sidebar-utility" data-notifications-open type="button" aria-label="Open notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg><b data-notification-count${cachedUnread > 0 ? '' : ' hidden'}>${cachedUnread}</b></button>
          </div>
          <button class="sidebar-user-card${isAccountSubview ? ' is-active' : ''}" data-account-open type="button" aria-label="Open my account"${isAccountSubview ? ' aria-current="page"' : ''}>
            <span class="avatar-presence-wrap">
              <span class="sidebar-user-avatar" aria-hidden="true">
                ${DEFAULT_SIDEBAR_AVATAR_SVG}
              </span>
              <span class="presence-dot is-online" data-presence-id="${escapeHtml(cachedUserId)}" aria-label="Active now" title="Active now"></span>
            </span>
            <div class="sidebar-user-info" id="sidebar-user">
              <strong>${escapeHtml(cachedName || 'Checking session…')}</strong>
              <small>${escapeHtml(cachedName ? roleLabel : 'ACCOUNT')}</small>
            </div>
          </button>
        </div>`;
      }
    }
    syncNotificationBadges(cachedUnread, { persist: false });
    syncMessagesBadges(cachedMsgUnread, { persist: false });
    if (cachedName) syncSidebarUserInfo(cachedName, cachedRole);
    if (cachedAvatar) {
      syncProfileAvatars({ id: cachedUserId, full_name: cachedName, role: cachedRole, avatar_url: cachedAvatar }, { persist: false });
    }
    document.querySelectorAll('.record-tabs a').forEach((link) => {
      if (effectiveRole === 'TREASURER' && link.getAttribute('href') === 'savings.html') return link.remove();
      if (link.dataset.tabBound === '1') return;
      link.dataset.tabBound = '1';
      const label = link.textContent.trim();
      const baseHref = String(link.getAttribute('href') || '').split('?')[0];
      const existingSvg = link.querySelector('svg')?.outerHTML || '';
      link.setAttribute('aria-label', label);
      link.innerHTML = `${recordTabIcons[baseHref] || existingSvg}<span>${escapeHtml(label)}</span>`;
    });
    if (!document.getElementById('app-toast')) document.body.insertAdjacentHTML('beforeend', `
      <div class="toast" id="app-toast" popover="manual" role="status" aria-live="polite"></div>
      <dialog class="confirm-dialog" id="confirm-dialog">
        <form method="dialog">
          <h2 id="confirm-title">Continue?</h2>
          <p id="confirm-message"></p>
          <div class="dialog-actions">
            <button class="button button-secondary" id="confirm-cancel" value="cancel">Cancel</button>
            <button class="button button-primary" id="confirm-accept" value="confirm">Confirm</button>
          </div>
        </form>
      </dialog>
      <dialog class="form-dialog record-review-dialog" id="record-action-dialog" aria-labelledby="record-action-title">
        <div class="form-dialog-sheet"><header class="form-dialog-header"><div><h2 id="record-action-title">Review record</h2><p id="record-action-subtitle">Verify the contributor, type, and amount before saving.</p></div><button class="dialog-close" type="button" data-record-action-close aria-label="Close review dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="record-review-body"><section class="record-review-summary" id="record-action-summary" hidden></section><form id="record-action-form" class="form-grid"><div class="record-review-step field-wide" id="record-action-step-edit"><fieldset class="decision-options field-wide"><legend>Decision</legend><div id="record-action-options"></div></fieldset><div class="field field-wide"><label id="record-action-reason-label" for="record-action-reason">Review note (optional)</label><textarea id="record-action-reason" name="reason" maxlength="500" aria-describedby="record-action-help"></textarea><small class="field-help" id="record-action-help">Optional note when confirming; required when rejecting or voiding.</small></div><div class="form-actions field-wide"><button class="button button-secondary" type="button" data-record-action-close>Cancel</button><button class="button button-primary" id="record-action-next" type="submit">Continue</button></div></div><div class="record-review-step record-review-confirm field-wide" id="record-action-step-confirm" hidden><div class="record-review-confirm-box" id="record-action-confirm-box"><strong id="record-action-confirm-heading">Confirm this decision?</strong><p id="record-action-confirm-text"></p><p class="record-review-note-preview" id="record-action-confirm-note" hidden></p></div><p class="mfa-message field-wide" id="record-action-error" role="alert" hidden></p><div class="form-actions field-wide"><button class="button button-secondary" id="record-action-back" type="button">Back</button><button class="button button-primary" id="record-action-submit" type="button">Confirm entry</button></div></div></form></div></div>
      </dialog>
      <dialog class="form-dialog record-thread-dialog" id="record-thread-dialog" aria-labelledby="record-thread-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div><h2 id="record-thread-title">Record discussion</h2><p id="record-thread-subtitle">Questions, receipt clarifications, and review replies.</p></div>
            <button class="dialog-close" type="button" data-record-thread-close aria-label="Close discussion"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="record-thread-body">
            <section class="record-review-summary" id="record-thread-summary" hidden></section>
            <div class="record-thread-messages" id="record-thread-messages" role="log" aria-live="polite"><p class="empty-state">Loading discussion…</p></div>
            <form class="record-thread-composer" id="record-thread-form" hidden>
              <label class="sr-only" for="record-thread-input">Reply message</label>
              <textarea id="record-thread-input" name="body" rows="2" maxlength="500" placeholder="Write a reply, paste a screenshot, or attach photos, videos, or files…"></textarea>
              <div class="record-thread-queued" id="record-thread-queued" hidden></div>
              <input id="record-thread-files" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.odt,.ods,.ppt,.pptx,.zip,.rar,.7z" hidden>
              <div class="record-thread-composer-bar">
                <div class="record-thread-composer-left">
                  <button class="record-thread-attach-btn" id="record-thread-attach-btn" type="button" title="Attach photos, videos, or files (max 5 files, 50 MB each)">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    <span>Attach</span>
                  </button>
                  <small class="field-help">Ctrl+Enter to send · Photos, videos &amp; files up to 50 MB</small>
                </div>
                <button class="button button-primary button-sm" type="submit">Send reply</button>
              </div>
            </form>
            <p class="field-help" id="record-thread-readonly" hidden>Only administrators, treasurers, and the contributor for this record can post replies.</p>
          </div>
        </div>
      </dialog>
      <dialog class="form-dialog record-review-dialog" id="record-detail-dialog" aria-labelledby="record-detail-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div><h2 id="record-detail-title">Record details</h2><p id="record-detail-subtitle">Review full transaction details, status, and discussion.</p></div>
            <button class="dialog-close" type="button" data-record-detail-close aria-label="Close record details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="record-review-body">
            <section class="record-review-summary" id="record-detail-summary"></section>
            <div class="record-detail-actions" id="record-detail-actions"></div>
          </div>
        </div>
      </dialog>
      <dialog class="form-dialog notice-detail-dialog" id="notice-detail-dialog" aria-labelledby="notice-detail-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div><h2 id="notice-detail-title">Notification details</h2><p id="notice-detail-subtitle">Review alert details and take action.</p></div>
            <button class="dialog-close" type="button" data-notice-detail-close aria-label="Close notification details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="notice-detail-body" id="notice-detail-body"></div>
        </div>
      </dialog>
      <dialog class="notification-dialog" id="notification-dialog" aria-labelledby="notification-title">
        <div class="notification-sheet"><header><div class="notification-heading"><h2 id="notification-title">Notifications</h2><span>Recent activity</span></div><div class="notification-header-actions"><button class="notification-mark-read" id="mark-all-notifications" type="button">Mark all read</button><button class="dialog-close" data-notifications-close type="button" aria-label="Close notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><div class="notification-permission-bar" id="notification-permission-bar" hidden></div><div class="notification-list" id="notification-list" role="feed"><p class="empty-state">Loading notifications…</p></div></div>
      </dialog>
      <dialog class="donate-dialog" id="donate-dialog" aria-labelledby="donate-title">
        <div class="donate-sheet"><button class="dialog-close" data-donate-close type="button" aria-label="Close donation information">&times;</button><img class="donate-sticker" src="assets/donate-sticker.jpg" alt="" aria-hidden="true"><h2 id="donate-title">Support myIPON</h2><p>Donations are voluntary support for the system developer and are never included in group savings or reports.</p><span>GCash number</span><strong id="donate-number">09913564248</strong><div class="donate-actions"><button class="button button-primary" id="copy-donate-number" type="button">Copy number</button><button class="button button-secondary" id="open-donate-qr" type="button">Scan me</button></div></div>
      </dialog>
      <dialog class="donate-dialog donate-qr-dialog" id="donate-qr-dialog" aria-labelledby="donate-qr-title">
        <div class="donate-sheet donate-qr-sheet"><button class="dialog-close" data-donate-qr-close type="button" aria-label="Close QR code">&times;</button><img class="donate-qr-image" src="assets/donate-qr.jpg" alt="GCash QR code"><p class="donate-qr-caption" id="donate-qr-title">Scan with GCash</p></div>
      </dialog>
      <dialog class="form-dialog feature-request-dialog" id="feature-request-dialog" aria-labelledby="feature-request-title">
        <div class="form-dialog-sheet"><header class="form-dialog-header"><div><h2 id="feature-request-title">Request a feature</h2><p>Describe an improvement that would make IPON more useful to you.</p></div><button class="dialog-close" data-feature-request-close type="button" aria-label="Close feature request form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><form id="feature-request-form" class="form-grid"><div class="field field-wide"><label for="feature-request-name">Feature name</label><input id="feature-request-name" name="title" minlength="3" maxlength="120" required></div><div class="field field-wide"><label for="feature-request-details">How should it work?</label><textarea id="feature-request-details" name="details" minlength="10" maxlength="2000" aria-describedby="feature-request-help" required></textarea><small class="field-help" id="feature-request-help">Explain the problem and the result you want. Do not include passwords or financial account details.</small></div><div class="field field-wide"><label class="credit-toggle-row"><span class="credit-toggle-copy"><strong>Credit me in release updates</strong><small>Allow my name and avatar to appear when this feature is implemented and released.</small></span><input id="feature-request-credit" name="allow_credit" type="checkbox" checked aria-label="Credit me in release updates"></label></div><p class="mfa-message field-wide" id="feature-request-message" role="status" aria-live="polite"></p><div class="form-actions field-wide"><button class="button button-secondary" data-feature-request-close type="button">Cancel</button><button class="button button-primary" type="submit">Submit request</button></div></form><div class="feature-request-success" id="feature-request-success" role="status" aria-live="polite" hidden><span class="feature-request-success-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg></span><h3>Feature request submitted</h3><p>Your suggestion <strong id="feature-request-submitted-title"></strong> has been sent to the Super Admin for review.</p><div class="form-actions"><button class="button button-secondary" id="feature-request-another" type="button">Submit another</button><button class="button button-primary" data-feature-request-close type="button">Done</button></div></div></div>
      </dialog>
      <dialog class="form-dialog feature-request-dialog bug-report-dialog" id="bug-report-dialog" aria-labelledby="bug-report-title">
        <div class="form-dialog-sheet"><header class="form-dialog-header"><div><h2 id="bug-report-title">Report a problem</h2><p>Describe the error or bug you encountered and optionally attach screenshots.</p></div><button class="dialog-close" data-bug-report-close type="button" aria-label="Close bug report form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><form id="bug-report-form" class="form-grid"><div class="field field-wide"><label for="bug-report-name">Title</label><input id="bug-report-name" name="title" minlength="3" maxlength="120" required></div><div class="field field-wide"><label for="bug-report-details">Description</label><textarea id="bug-report-details" name="description" minlength="10" maxlength="2000" aria-describedby="bug-report-help" required></textarea><small class="field-help" id="bug-report-help">Explain what happened and how to reproduce it. Do not include passwords or financial account details.</small></div><div class="field field-wide"><label for="bug-report-images">Pictures (optional, up to 5)</label><div class="bug-upload-box"><input id="bug-report-images" type="file" accept="image/*" multiple aria-describedby="bug-report-image-count"><small class="field-help" id="bug-report-image-count">0 of 5 images selected. Any picture format is accepted.</small></div><div class="bug-image-grid" id="bug-report-previews" hidden></div></div><p class="mfa-message field-wide" id="bug-report-message" role="status" aria-live="polite"></p><div class="form-actions field-wide"><button class="button button-secondary" data-bug-report-close type="button">Cancel</button><button class="button button-primary" type="submit">Submit report</button></div></form><div class="feature-request-success" id="bug-report-success" role="status" aria-live="polite" hidden><span class="feature-request-success-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m5 12 4.5 4.5L19 7"/></svg></span><h3>Bug report submitted</h3><p>Your report <strong id="bug-report-submitted-title"></strong> has been sent to the Super Admin for review.</p><div class="form-actions"><button class="button button-secondary" id="bug-report-another" type="button">Submit another</button><button class="button button-primary" data-bug-report-close type="button">Done</button></div></div></div>
      </dialog>
      <dialog class="form-dialog connect-apps-dialog" id="connect-apps-dialog" aria-labelledby="connect-apps-modal-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div><h2 id="connect-apps-modal-title">Connect your apps</h2><p>Add links or @usernames to display clickable icons in your bio.</p></div>
            <button class="dialog-close" data-connect-apps-close type="button" aria-label="Close connect apps dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="connect-apps-modal-body">
            <div class="account-connect-preview" id="connect-apps-modal-preview-wrap"><div class="account-connect-preview-meta"><span class="account-connect-preview-label">Bio preview</span><small class="account-connect-drag-hint" id="connect-apps-drag-hint" hidden>Drag icons to reorder</small></div><div class="account-connect-preview-icons" id="connect-apps-modal-preview" aria-live="polite"></div></div>
            <form id="quick-connect-apps-form" class="account-connect-apps-form">${connectAppsFieldsMarkup()}<div class="form-actions"><button class="button button-secondary" data-connect-apps-close type="button">Cancel</button><button class="button button-primary" id="quick-connect-apps-save" type="submit">Save links</button></div></form>
          </div>
        </div>
      </dialog>
      <dialog class="account-dialog" id="account-dialog" aria-label="My account">
        <div class="account-dialog-sheet">
          <div class="account-dialog-content">
            <section class="account-card account-profile-card"><button class="dialog-close account-dialog-close" data-account-close type="button" aria-label="Close account settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="account-profile-identity"><div class="account-avatar-picker"><label class="account-avatar-trigger" for="quick-avatar-input" role="button" tabindex="0" title="Change profile picture" aria-label="Change profile picture"><span class="account-avatar-preview" id="quick-avatar-preview" aria-hidden="true"></span><span class="account-avatar-cam" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></label><button class="account-avatar-remove" id="quick-avatar-remove" type="button" title="Remove photo" aria-label="Remove profile picture" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><input id="quick-avatar-input" type="file" accept="image/*" hidden></div><span><strong id="quick-account-name">Account</strong><small id="quick-account-role">ROLE</small></span></div><div class="account-card-appearance" id="quick-card-appearance" data-card-theme="emerald"><div class="account-cover-preview" id="quick-cover-preview"><img id="quick-cover-image" alt="Your profile cover" hidden><span class="account-cover-label">PROFILE COVER</span><div class="account-cover-actions"><button class="button button-secondary button-sm" id="quick-cover-change" type="button">Change cover</button><button class="button button-secondary button-sm" id="quick-cover-remove" type="button" hidden>Remove</button></div><input id="quick-cover-input" type="file" accept="image/jpeg,image/png,image/webp" hidden></div><div class="account-card-effects-row"><div class="account-card-effects-copy"><strong>Profile effects</strong><small id="quick-effect-status">Granted permanently by Super Admin</small></div><button class="button button-secondary button-sm" id="quick-effects-open" type="button">Browse effects</button></div><div class="account-card-effects-row account-card-connect-row" id="quick-connect-apps-card" aria-labelledby="quick-connect-apps-title"><div class="account-card-connect-head"><div class="account-card-effects-copy"><strong id="quick-connect-apps-title">Connected apps</strong><small>Show clickable icons in your bio</small></div><button class="button button-secondary button-sm" id="quick-connect-apps-open" type="button">Connect apps</button></div><div class="account-connect-preview-icons" id="quick-connect-apps-preview" aria-live="polite"></div></div><p class="account-card-feedback" id="quick-card-feedback" role="status" aria-live="polite"></p></div><form id="quick-profile-form" class="form-grid form-grid-3"><div class="field"><label for="quick-first-name">First name</label><input id="quick-first-name" name="first_name" maxlength="80" required></div><div class="field"><label for="quick-middle-name">Middle name (optional)</label><input id="quick-middle-name" name="middle_name" maxlength="80"></div><div class="field"><label for="quick-last-name">Last name</label><input id="quick-last-name" name="last_name" maxlength="80" required></div><div class="field field-wide"><label for="quick-username">Username handle (optional)</label><input id="quick-username" name="username" type="text" maxlength="24" autocomplete="off" spellcheck="false" placeholder="e.g. juan_delacruz" aria-describedby="quick-username-help quick-username-error"><small class="field-help account-username-help" id="quick-username-help">3–24 lowercase letters, numbers, or underscores.</small><small class="field-error account-username-help" id="quick-username-error" role="alert" hidden></small></div><div class="field field-wide"><label for="quick-bio">Short bio (optional)</label><textarea id="quick-bio" name="bio" rows="2" maxlength="58" placeholder="Share a short intro visible when people view your profile…" aria-describedby="quick-bio-count quick-bio-error"></textarea><small class="field-help account-bio-counter" id="quick-bio-count">0 / 58 characters</small><small class="field-error" id="quick-bio-error" role="alert" hidden></small></div><div class="field field-wide"><label for="quick-contact">Mobile number</label><input id="quick-contact" name="contact_number" type="tel" inputmode="tel" autocomplete="tel" maxlength="13" pattern="(?:09[0-9]{9}|\+639[0-9]{9})" aria-describedby="quick-contact-help quick-contact-error" required><small class="field-help" id="quick-contact-help">Use 09XXXXXXXXX or +639XXXXXXXXX.</small><small class="field-error" id="quick-contact-error" role="alert" hidden></small></div><div class="field field-wide" data-payout-fields data-prefix="quick"></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Save changes</button></div></form><div class="account-support" data-role="ADMIN,TREASURER,MEMBER"><div class="account-support-row account-badge-row" id="quick-verified-badge-row"><div class="account-badge-meta"><span class="account-badge-emblem" id="quick-badge-emblem" aria-hidden="true">${badgeSealSvgMarkup('#1d9bf0', 'Verified Badge')}</span><span><strong class="account-badge-heading"><span id="quick-badge-title">Verified badge</span><span class="account-badge-pill is-available" id="quick-badge-pill">Available</span></strong><small id="quick-badge-copy">Want a blue verified badge beside your name? Message the creator directly to request verification.</small></span></div><button class="button button-primary account-badge-cta" id="quick-badge-cta" data-message-creator-badge type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Message creator</span></button></div><div class="account-support-row"><span><strong>Support myIPON</strong><small>Optional donations help maintain and improve the system.</small></span><button class="button button-secondary" data-donate-open type="button">Donate me</button></div><div class="account-support-row"><span><strong>Have an idea?</strong><small>Suggest an improvement for the system.</small></span><button class="button button-secondary" data-feature-request-open type="button">Request a feature</button></div><div class="account-support-row"><span><strong>Encounter a problem, error, or bug?</strong><small>Report an issue with screenshots for review.</small></span><button class="button button-secondary" data-bug-report-open type="button">Report a bug</button></div></div></section>
            <div class="account-side-stack"><section class="account-card account-security-card"><header class="account-section-heading"><div><h3>Sign-in security</h3><p>Keep your account secure.</p></div></header><form id="quick-email-form" class="account-inline-form"><div class="field"><label for="quick-email">Email address</label><input id="quick-email" name="email" type="email" autocomplete="email" required></div><button class="button button-secondary" type="submit">Update email</button></form><details class="account-password-disclosure"><summary><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><strong>Change password</strong><svg class="account-disclosure-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><form id="quick-password-form" class="form-grid"><div class="field field-wide"><label for="quick-current-password">Current or temporary password</label><div class="password-control"><input id="quick-current-password" name="current_password" type="password" maxlength="128" autocomplete="current-password" required><button class="password-toggle" type="button" aria-controls="quick-current-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div></div><div class="field"><label for="quick-password">New password</label><div class="password-control"><input id="quick-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" aria-controls="quick-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div><small class="field-help">${PASSWORD_RULE}</small></div><div class="field"><label for="quick-password-confirmation">Confirm password</label><div class="password-control"><input id="quick-password-confirmation" name="password_confirmation" type="password" minlength="8" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" aria-controls="quick-password-confirmation" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Change password</button></div></form></details></section>
            <section class="account-card account-preferences"><header class="account-section-heading"><div><h3>Appearance &amp; notifications</h3><p>Manage display theme and alert preferences.</p></div></header><label class="preference-row preference-theme-row" for="quick-theme-dark"><span><strong>Dark mode</strong><small>Switch between Warm Paper Light and Forest Dark theme.</small></span><input id="quick-theme-dark" type="checkbox" role="switch" data-theme-checkbox aria-label="Enable dark mode"></label><label class="preference-row"><span><strong>In-app notifications</strong><small>Reviews, account changes, and contribution updates.</small></span><input id="quick-notifications-enabled" type="checkbox" role="switch" aria-label="Enable in-app notifications"></label><div class="preference-row preference-background-row" data-device-background-row hidden><span class="preference-background-copy"><strong class="preference-background-heading"><span>Device &amp; in-app alerts</span><span class="bg-access-pill" data-device-bg-pill>Checking</span></strong><small data-device-bg-status>Checking device permissions for in-app alerts.</small></span><div class="preference-device-actions" data-device-bg-actions><button class="button button-primary button-sm" type="button" data-device-bg-btn>Allow background usage</button></div></div><div class="preference-row preference-workspace-row" data-role="ADMIN"><span><strong>Workspace settings</strong><small>Monthly schedule, payment QR, access, treasurers &amp; cycle reset</small></span><a class="button button-primary button-sm" href="settings.html" data-workspace-settings-open>Manage</a></div><div class="preference-row"><span><strong>Data &amp; storage retention</strong><small>Active savings protected · 30d bin, 90d &amp; 6-month rules</small></span><button class="button button-secondary button-sm" type="button" data-retention-rules-open>View rules</button></div><div class="preference-row"><span><strong>Terms &amp; Privacy policies</strong><small>Non-custodial scope, permissions, and full retention schedule</small></span><div class="header-actions"><button class="button button-secondary button-sm" type="button" data-policy-open-inapp="terms">Terms</button><button class="button button-secondary button-sm" type="button" data-policy-open-inapp="privacy">Privacy</button></div></div></section></div>
            <section class="account-card account-session-card" aria-labelledby="quick-session-title"><div class="account-session-copy"><h3 id="quick-session-title">Account session</h3><p>Sign out of myIPON on this device.</p></div><button class="button button-secondary danger-action signout-action-btn" id="account-dialog-signout" data-sign-out type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/></svg><span>Sign out</span></button></section>
          </div>
        </div>
      </dialog>
      <dialog class="form-dialog avatar-crop-dialog" id="avatar-crop-dialog" aria-labelledby="avatar-crop-title">
        <div class="form-dialog-sheet avatar-crop-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="avatar-crop-title">Crop display picture</h2>
              <p id="avatar-crop-subtitle">Drag to reposition or adjust zoom to frame your profile picture.</p>
            </div>
            <button class="dialog-close" id="avatar-crop-close" type="button" aria-label="Close photo editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="avatar-crop-body">
            <div class="avatar-crop-viewport-wrap">
              <canvas class="avatar-crop-canvas" id="avatar-crop-canvas" width="280" height="280" aria-label="Photo crop preview"></canvas>
              <div class="avatar-crop-overlay" aria-hidden="true"><span class="avatar-crop-corner is-tl"></span><span class="avatar-crop-corner is-tr"></span><span class="avatar-crop-corner is-bl"></span><span class="avatar-crop-corner is-br"></span></div>
            </div>
            <div class="avatar-crop-controls">
              <label for="avatar-crop-zoom" class="avatar-crop-zoom-label">
                <span>Zoom</span>
                <input id="avatar-crop-zoom" type="range" min="1" max="3" step="0.01" value="1" aria-label="Zoom photo">
              </label>
              <button class="button button-secondary avatar-crop-rotate-btn" id="avatar-crop-rotate" type="button" title="Rotate 90°" aria-label="Rotate photo 90 degrees"><svg viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px;"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85 1.05 6.51 2.74L21 8m0 0V3m0 5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>Rotate</button>
              <div class="avatar-crop-preview-box">
                <small>Preview</small>
                <div class="avatar-crop-preview-circle" id="avatar-crop-preview-thumb"></div>
              </div>
            </div>
          </div>
          <div class="form-actions field-wide avatar-crop-actions">
            <button class="button button-secondary" id="avatar-crop-cancel" type="button">Cancel</button>
            <button class="button button-primary" id="avatar-crop-save" type="button">Save display picture</button>
          </div>
        </div>
      </dialog>`);
    const securityCard = document.querySelector('#account-dialog .account-security-card');
    if (securityCard && !securityCard.querySelector('[data-mfa-settings]')) securityCard.insertAdjacentHTML('beforeend', mfaSettingsMarkup());
    mountPayoutFieldsets(document.getElementById('account-dialog'));
    bindUtilityDialogs();
    bindAccountDialog();
    prepareNameInputs();
    syncProfileNameMode(document.getElementById('quick-profile-form'), role === 'SUPER_ADMIN');
    preparePhoneInputs();
    mountThemeControls(document);
    syncShellRoleVisibility(effectiveRole);
  }

  const MAX_BUG_IMAGES = 5;
  const MAX_BUG_IMAGE_BYTES = 8 * 1024 * 1024;
  const MAX_AVATAR_BYTES = 8 * 1024 * 1024;
  const PICTURE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?|jfif|apng)$/i;
  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  }

  const onlineUserIds = new Set();
  const PRESENCE_STORAGE_KEY = 'iponOnlineUsers';
  const PRESENCE_SYNC_CHANNEL = 'ipon-presence-local-sync';
  let presenceChannel = null;

  function isUserOnline(userId) {
    if (!userId) return false;
    return onlineUserIds.has(String(userId));
  }

  function syncPresenceDots(root = document) {
    root.querySelectorAll('[data-presence-id]').forEach((dot) => {
      const uid = dot.dataset.presenceId;
      if (!uid) return;
      const isOnline = isUserOnline(uid);
      dot.classList.toggle('is-online', isOnline);
      const label = isOnline ? 'Active now' : 'Offline';
      dot.setAttribute('aria-label', label);
      dot.title = label;
    });
  }

  function emitPresenceChange(leftIds = []) {
    try {
      window.dispatchEvent(new CustomEvent('ipon:presence-change', {
        detail: { onlineIds: Array.from(onlineUserIds), leftIds, at: new Date().toISOString() }
      }));
    } catch (_) { }
  }

  function flushLastSeen({ keepalive = false, force = false } = {}) {
    if (!currentProfile?.id || !presenceShowOnline || !configured) return;
    const nowMs = Date.now();
    if (!force && nowMs - lastSeenFlushAt < 1500) return;
    lastSeenFlushAt = nowMs;
    const nowIso = new Date(nowMs).toISOString();
    currentProfile.last_seen_at = nowIso;
    if (keepalive && cachedAccessToken && typeof fetch === 'function') {
      try {
        fetch(`${config.supabaseUrl}/rest/v1/rpc/touch_user_last_seen`, {
          method: 'POST',
          keepalive: true,
          headers: {
            apikey: config.supabaseAnonKey,
            Authorization: `Bearer ${cachedAccessToken}`,
            'Content-Type': 'application/json'
          },
          body: '{}'
        }).catch(() => { });
        return;
      } catch (_) { }
    }
    const client = getClient();
    if (client?.rpc) {
      (async () => { try { await client.rpc('touch_user_last_seen'); } catch (_) { } })();
    }
  }

  function broadcastLocalPresence() {
    try {
      const ids = Array.from(onlineUserIds);
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel(PRESENCE_SYNC_CHANNEL);
        bc.postMessage({ type: 'SYNC', ids, at: Date.now() });
        bc.close();
      }
      localStorage.setItem(PRESENCE_STORAGE_KEY, JSON.stringify({ ids, at: Date.now() }));
    } catch (_) { }
  }

  let presenceShowOnline = true;
  let presenceLifecycleBound = false;

  function setOnlineVisibility(showOnline) {
    presenceShowOnline = showOnline !== false;
    if (!currentProfile?.id) return;
    if (presenceShowOnline) {
      onlineUserIds.add(String(currentProfile.id));
      presenceChannel?.track?.({
        user_id: currentProfile.id,
        full_name: currentProfile.full_name,
        role: currentProfile.role,
        online_at: new Date().toISOString()
      }).catch?.(() => { });
    } else {
      onlineUserIds.delete(String(currentProfile.id));
      presenceChannel?.untrack?.().catch?.(() => { });
    }
    syncPresenceDots();
    broadcastLocalPresence();
  }

  function initPresence(profile) {
    const client = getClient();
    if (!client || !profile?.id) return;
    presenceShowOnline = profile?.chat_privacy?.show_online !== false;
    if (presenceChannel) return;

    if (presenceShowOnline) onlineUserIds.add(String(profile.id));
    else onlineUserIds.delete(String(profile.id));
    syncPresenceDots();

    try {
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel(PRESENCE_SYNC_CHANNEL);
        bc.addEventListener('message', (event) => {
          if (event.data?.ids && Array.isArray(event.data.ids)) {
            event.data.ids.forEach((id) => onlineUserIds.add(String(id)));
            if (!presenceShowOnline) onlineUserIds.delete(String(profile.id));
            syncPresenceDots();
          }
        });
      }
      window.addEventListener('storage', (event) => {
        if (event.key === PRESENCE_STORAGE_KEY && event.newValue) {
          try {
            const data = JSON.parse(event.newValue);
            if (Array.isArray(data?.ids)) {
              data.ids.forEach((id) => onlineUserIds.add(String(id)));
              if (!presenceShowOnline) onlineUserIds.delete(String(profile.id));
              syncPresenceDots();
            }
          } catch (_) { }
        }
      });
    } catch (_) { }

    try {
      const existingPresence = typeof client.getChannels === 'function'
        ? client.getChannels().find((ch) => ch?.topic === 'realtime:ipon-active-presence')
        : null;
      if (existingPresence && (existingPresence.channelAdapter?.isJoined?.() || existingPresence.channelAdapter?.isJoining?.() || existingPresence.state === 'joined' || existingPresence.state === 'joining')) {
        presenceChannel = existingPresence;
        syncPresenceDots();
        return;
      }
      if (existingPresence) {
        try { client.removeChannel?.(existingPresence)?.catch?.(() => { }); } catch { }
      }
      presenceChannel = client.channel('ipon-active-presence', {
        config: {
          presence: {
            key: String(profile.id)
          }
        }
      });

      const handleSync = () => {
        try {
          const prev = new Set(onlineUserIds);
          const state = presenceChannel.presenceState();
          onlineUserIds.clear();
          if (presenceShowOnline && document.visibilityState !== 'hidden') onlineUserIds.add(String(profile.id));
          Object.keys(state || {}).forEach((key) => {
            if (key) onlineUserIds.add(String(key));
            const presences = state[key] || [];
            presences.forEach((entry) => {
              if (entry?.user_id) onlineUserIds.add(String(entry.user_id));
            });
          });
          const leftIds = Array.from(prev).filter((id) => !onlineUserIds.has(id));
          syncPresenceDots();
          broadcastLocalPresence();
          if (leftIds.length) emitPresenceChange(leftIds);
        } catch (_) { }
      };

      presenceChannel
        .on('presence', { event: 'sync' }, handleSync)
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          if (key) onlineUserIds.add(String(key));
          (newPresences || []).forEach((p) => { if (p?.user_id) onlineUserIds.add(String(p.user_id)); });
          syncPresenceDots();
          broadcastLocalPresence();
          emitPresenceChange([]);
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          const state = presenceChannel.presenceState();
          const leftIds = [];
          if (key && !state[key] && (key !== String(profile.id) || !presenceShowOnline || document.visibilityState === 'hidden')) {
            if (onlineUserIds.delete(String(key))) leftIds.push(String(key));
          }
          (leftPresences || []).forEach((p) => {
            const uid = p?.user_id ? String(p.user_id) : '';
            if (uid && (uid !== String(profile.id) || !presenceShowOnline || document.visibilityState === 'hidden') && !state[uid]) {
              if (onlineUserIds.delete(uid)) leftIds.push(uid);
            }
          });
          syncPresenceDots();
          broadcastLocalPresence();
          if (leftIds.length) emitPresenceChange(leftIds);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && presenceShowOnline && document.visibilityState !== 'hidden') {
            try {
              await presenceChannel.track({
                user_id: profile.id,
                full_name: profile.full_name,
                role: profile.role,
                online_at: new Date().toISOString()
              });
            } catch (_) { }
          }
        });

      const handleAppAway = () => {
        const myId = String(profile.id);
        const wasOnline = onlineUserIds.delete(myId);
        try { presenceChannel?.untrack?.().catch?.(() => { }); } catch (_) { }
        syncPresenceDots();
        broadcastLocalPresence();
        emitPresenceChange(wasOnline ? [myId] : []);
        flushLastSeen({ keepalive: true });
      };
      const handleAppActive = () => {
        if (!presenceShowOnline) return;
        onlineUserIds.add(String(profile.id));
        try {
          presenceChannel?.track?.({
            user_id: profile.id,
            full_name: profile.full_name,
            role: profile.role,
            online_at: new Date().toISOString()
          }).catch?.(() => { });
        } catch (_) { }
        syncPresenceDots();
        broadcastLocalPresence();
        emitPresenceChange([]);
        flushLastSeen({ keepalive: false });
      };
      if (!presenceLifecycleBound) {
        presenceLifecycleBound = true;
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') handleAppAway();
          else if (document.visibilityState === 'visible') handleAppActive();
        });
        window.Capacitor?.Plugins?.App?.addListener?.('appStateChange', ({ isActive }) => {
          if (isActive) handleAppActive();
          else handleAppAway();
        });
      }

      window.addEventListener('pagehide', () => {
        handleAppAway();
        try {
          client.removeChannel(presenceChannel);
        } catch (_) { }
      }, { once: true });
    } catch (presenceErr) {
      console.warn('Realtime presence init:', presenceErr);
    }
  }

  const VERIFIED_BADGE_MAP = new Map();
  const BADGE_USER_ALIAS_MAP = new Map();
  let verifiedBadgesLoadedAt = 0;

  function resolveBadgeUserId(userOrId) {
    if (!userOrId) return '';
    if (typeof userOrId === 'string') {
      const s = userOrId.trim();
      if (!s) return '';
      if (VERIFIED_BADGE_MAP.has(s)) return s;
      return BADGE_USER_ALIAS_MAP.get(s) || BADGE_USER_ALIAS_MAP.get(s.toLowerCase()) || s;
    }
    if (typeof userOrId === 'object') {
      const candidates = [userOrId.user_id, userOrId.id, userOrId.member_id]
        .map((v) => String(v || '').trim())
        .filter(Boolean);
      for (const c of candidates) {
        if (VERIFIED_BADGE_MAP.has(c)) return c;
      }
      for (const c of candidates) {
        const aliased = BADGE_USER_ALIAS_MAP.get(c);
        if (aliased) return aliased;
      }
      const nameKey = String(userOrId.full_name || userOrId.name || '').trim().toLowerCase();
      if (nameKey && BADGE_USER_ALIAS_MAP.has(nameKey)) return BADGE_USER_ALIAS_MAP.get(nameKey);
      return candidates[0] || '';
    }
    return '';
  }

  const SCALLOP_SEAL_PATH = 'M8.67 3.96Q8.76 0.76 12.00 0.55Q15.24 0.76 15.33 3.96Q17.66 1.76 20.10 3.90Q22.24 6.34 20.04 8.67Q23.24 8.76 23.45 12.00Q23.24 15.24 20.04 15.33Q22.24 17.66 20.10 20.10Q17.66 22.24 15.33 20.04Q15.24 23.24 12.00 23.45Q8.76 23.24 8.67 20.04Q6.34 22.24 3.90 20.10Q1.76 17.66 3.96 15.33Q0.76 15.24 0.55 12.00Q0.76 8.76 3.96 8.67Q1.76 6.34 3.90 3.90Q6.34 1.76 8.67 3.96Z';

  function isTwoMonthsInactive(lastActiveIso, grantedAtIso) {
    const t1 = lastActiveIso ? Date.parse(lastActiveIso) : NaN;
    const t2 = grantedAtIso ? Date.parse(grantedAtIso) : NaN;
    const latest = Math.max(Number.isNaN(t1) ? -Infinity : t1, Number.isNaN(t2) ? -Infinity : t2);
    if (!Number.isFinite(latest)) return false;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 2);
    return latest <= cutoff.getTime();
  }

  function resolveVerifiedBadgeInfo(userOrId, explicitTier = '', opts = {}) {
    const uid = resolveBadgeUserId(userOrId);
    const cached = uid ? VERIFIED_BADGE_MAP.get(String(uid)) : null;
    const direct = String(explicitTier || (typeof userOrId === 'object' && userOrId ? (userOrId.verified_badge || userOrId.verified_badge_tier) : '') || '').trim().toUpperCase();
    const expiresAt = (typeof userOrId === 'object' && userOrId ? (userOrId.verified_badge_expires_at || userOrId.expires_at) : null) || cached?.expires_at || null;
    const grantedAt = (typeof userOrId === 'object' && userOrId ? (userOrId.verified_badge_granted_at || userOrId.granted_at || userOrId.created_at) : null) || cached?.granted_at || null;
    const tier = (direct === 'BLUE' || direct === 'CREATOR_GREEN') ? direct : (direct === 'NONE' ? 'NONE' : (cached?.tier || 'NONE'));

    if (tier !== 'BLUE' && tier !== 'CREATOR_GREEN') {
      return { tier: 'NONE', granted_at: null, expires_at: null };
    }
    if (
      tier !== 'CREATOR_GREEN'
      && !opts?.allowPendingAck
      && !explicitTier
      && typeof userOrId === 'object'
      && userOrId
      && Object.prototype.hasOwnProperty.call(userOrId, 'verified_badge_acknowledged_at')
      && !userOrId.verified_badge_acknowledged_at
    ) {
      return { tier: 'NONE', granted_at: null, expires_at: null };
    }
    if (expiresAt) {
      const expMs = Date.parse(expiresAt);
      if (!Number.isNaN(expMs) && expMs <= Date.now()) {
        if (uid) VERIFIED_BADGE_MAP.delete(String(uid));
        return { tier: 'NONE', granted_at: null, expires_at: null };
      }
    }
    if (tier === 'BLUE' && !expiresAt && typeof userOrId === 'object' && userOrId && (userOrId.last_seen_at || userOrId.verified_badge_granted_at)) {
      if (isTwoMonthsInactive(userOrId.last_seen_at, userOrId.verified_badge_granted_at || userOrId.created_at)) {
        if (uid) VERIFIED_BADGE_MAP.delete(String(uid));
        return { tier: 'NONE', granted_at: null, expires_at: null };
      }
    }
    return { tier, granted_at: grantedAt, expires_at: expiresAt, uid };
  }

  function effectiveVerifiedBadgeTier(userOrId, explicitTier = '', opts = {}) {
    return resolveVerifiedBadgeInfo(userOrId, explicitTier, opts).tier;
  }

  function registerVerifiedBadges(rows = []) {
    if (!Array.isArray(rows)) return;
    rows.forEach((row) => {
      const uid = row?.user_id || row?.id;
      const tier = String(row?.verified_badge || row?.verified_badge_tier || '').trim().toUpperCase();
      if (!uid || (tier !== 'BLUE' && tier !== 'CREATOR_GREEN')) return;
      VERIFIED_BADGE_MAP.set(String(uid), {
        tier,
        granted_at: row?.granted_at || row?.verified_badge_granted_at || row?.created_at || null,
        expires_at: row?.expires_at || row?.verified_badge_expires_at || null
      });
    });
  }

  function badgeSealSvgMarkup(color, title) {
    return `<svg class="verified-badge-svg" viewBox="0 0 24 24" shape-rendering="geometricPrecision" role="img" aria-label="${escapeHtml(title)}"><path fill="${color}" d="${SCALLOP_SEAL_PATH}"/><path d="M7.6 12.35l2.85 2.9 6.05-6.25" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function creatorCrownBadgeSvgMarkup(title = 'Creator badge') {
    return `<svg class="verified-badge-svg verified-badge-creator-crown" viewBox="0 0 24 24" shape-rendering="geometricPrecision" role="img" aria-label="${escapeHtml(title)}"><circle cx="12" cy="12" r="11.3" fill="#4f46e5"/><path d="M6.2 15.6L5.3 8.9L9.3 11.7L12 7.1L14.7 11.7L18.7 8.9L17.8 15.6Z" fill="#ffffff"/><rect x="6.4" y="16.65" width="11.2" height="1.55" rx="0.78" fill="#ffffff"/></svg>`;
  }

  function verifiedBadgesHtml(userOrId, opts = {}) {
    const info = resolveVerifiedBadgeInfo(userOrId, opts?.tier);
    const tier = info.tier;
    if (tier !== 'BLUE' && tier !== 'CREATOR_GREEN') return '';
    const badgeUid = info.uid || resolveBadgeUserId(userOrId);
    const isSelf = Boolean(currentProfile?.id && badgeUid && String(currentProfile.id) === String(badgeUid));
    const extraClass = opts?.showcase ? ' is-showcase' : '';
    const sinceIso = info.granted_at ? String(info.granted_at) : '';
    const expiresIso = info.expires_at ? String(info.expires_at) : '';
    const dataAttrs = `data-verified-tier="${tier}" data-verified-uid="${escapeHtml(String(badgeUid || ''))}"${isSelf ? ' data-verified-self="1"' : ''} data-verified-since="${escapeHtml(sinceIso)}" data-verified-expires="${escapeHtml(expiresIso)}" tabindex="0" role="button"`;
    if (tier === 'CREATOR_GREEN') {
      return `<span class="verified-badges-inline is-tooltip-enabled${extraClass}" ${dataAttrs} aria-label="Founder & Creator · Since November 12, 2026">${badgeSealSvgMarkup('#15a025', 'Owner green badge')}${creatorCrownBadgeSvgMarkup('Founder & Creator')}</span>`;
    }
    const sinceText = sinceIso ? `Verified since ${dateLabel(sinceIso, { dateStyle: 'medium' })}` : 'Verified account';
    return `<span class="verified-badges-inline is-tooltip-enabled${extraClass}" ${dataAttrs} aria-label="${escapeHtml(sinceText)}">${badgeSealSvgMarkup('#1d9bf0', 'Verified user')}</span>`;
  }

  let badgeTooltipEl = null;
  let badgeTooltipTarget = null;
  let badgeTooltipPinned = false;
  let badgeTooltipHideTimer = null;
  let badgeTooltipBound = false;

  function hideVerifiedBadgeTooltip({ force = true } = {}) {
    if (!force && badgeTooltipPinned) return;
    if (badgeTooltipHideTimer) {
      clearTimeout(badgeTooltipHideTimer);
      badgeTooltipHideTimer = null;
    }
    badgeTooltipTarget = null;
    badgeTooltipPinned = false;
    if (badgeTooltipEl) {
      badgeTooltipEl.hidden = true;
    }
  }

  function positionVerifiedBadgeTooltip(anchorEl, tipEl) {
    if (!anchorEl?.getBoundingClientRect || !tipEl) return;
    const rect = anchorEl.getBoundingClientRect();
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 720;
    const tipRect = tipEl.getBoundingClientRect();
    const w = tipRect.width || 240;
    const h = tipRect.height || 80;
    let left = rect.left + (rect.width / 2) - (w / 2);
    left = Math.max(10, Math.min(vw - w - 10, left));
    let top = rect.bottom + 8;
    let placeBelow = true;
    if (top + h > vh - 10) {
      top = Math.max(10, rect.top - h - 8);
      placeBelow = false;
    }
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
    tipEl.classList.toggle('is-below', placeBelow);
  }

  function showVerifiedBadgeTooltip(anchorEl, { pinned = false } = {}) {
    if (!anchorEl) return;
    const tier = String(anchorEl.dataset?.verifiedTier || '').toUpperCase();
    if (tier !== 'BLUE' && tier !== 'CREATOR_GREEN') return;
    if (badgeTooltipHideTimer) {
      clearTimeout(badgeTooltipHideTimer);
      badgeTooltipHideTimer = null;
    }
    const sinceIso = anchorEl.dataset?.verifiedSince || '';
    const expiresIso = anchorEl.dataset?.verifiedExpires || '';
    const sinceDate = sinceIso ? dateLabel(sinceIso, { dateStyle: 'medium' }) : '';
    const openDialogs = [...document.querySelectorAll('dialog[open]')];
    const host = openDialogs.length ? openDialogs[openDialogs.length - 1] : document.body;
    if (!host?.appendChild) return;

    if (!badgeTooltipEl) {
      badgeTooltipEl = document.createElement('div');
      badgeTooltipEl.id = 'ipon-verified-badge-tooltip';
      badgeTooltipEl.className = 'verified-badge-tooltip';
      badgeTooltipEl.setAttribute('role', 'tooltip');
      badgeTooltipEl.hidden = true;
    }
    if (badgeTooltipEl.parentElement !== host) host.appendChild(badgeTooltipEl);

    const isCreator = tier === 'CREATOR_GREEN';
    const iconHtml = isCreator ? creatorCrownBadgeSvgMarkup('Creator') : badgeSealSvgMarkup('#1d9bf0', 'Verified');
    const heading = isCreator ? 'Founder & Creator' : 'Verified Account';
    const subHeadline = isCreator
      ? 'Since November 12, 2026'
      : (sinceDate ? `Verified since ${sinceDate}` : 'Verified on myIPON');
    const badgeUid = String(anchorEl.dataset?.verifiedUid || '').trim();
    const isSelfBadge = currentProfile?.id
      ? Boolean(badgeUid && String(currentProfile.id) === badgeUid)
      : anchorEl.dataset?.verifiedSelf === '1';
    let subNote = '';
    if (!isCreator && isSelfBadge) {
      if (expiresIso) {
        subNote = `Valid until ${dateLabel(expiresIso, { dateStyle: 'medium' })}.`;
      } else {
        subNote = 'Permanent · Auto-removes after 2 months inactive.';
      }
    }

    badgeTooltipEl.classList.toggle('is-creator', isCreator);
    badgeTooltipEl.innerHTML = `
      <span class="verified-badge-tooltip-icon" aria-hidden="true">${iconHtml}</span>
      <span class="verified-badge-tooltip-copy">
        <strong>${escapeHtml(heading)}</strong>
        <span class="verified-badge-tooltip-date${isCreator ? ' is-creator' : ''}">${escapeHtml(subHeadline)}</span>
        ${subNote ? `<small>${escapeHtml(subNote)}</small>` : ''}
      </span>`;
    badgeTooltipTarget = anchorEl;
    badgeTooltipPinned = Boolean(pinned);
    badgeTooltipEl.hidden = false;
    positionVerifiedBadgeTooltip(anchorEl, badgeTooltipEl);
  }

  function initVerifiedBadgeTooltip() {
    if (badgeTooltipBound || typeof document?.addEventListener !== 'function') return;
    badgeTooltipBound = true;
    document.addEventListener('mouseover', (event) => {
      const target = event.target?.closest?.('.verified-badges-inline[data-verified-tier]');
      if (!target || badgeTooltipPinned) return;
      if (target !== badgeTooltipTarget) showVerifiedBadgeTooltip(target);
    });
    document.addEventListener('mouseout', (event) => {
      if (badgeTooltipPinned) return;
      const target = event.target?.closest?.('.verified-badges-inline[data-verified-tier]');
      if (!target) return;
      const related = event.relatedTarget;
      if (related && (target.contains?.(related) || badgeTooltipEl?.contains?.(related))) return;
      badgeTooltipHideTimer = setTimeout(() => hideVerifiedBadgeTooltip({ force: false }), 90);
    });
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('.verified-badges-inline[data-verified-tier]');
      if (target) {
        event.preventDefault();
        event.stopPropagation();
        if (badgeTooltipPinned && badgeTooltipTarget === target && badgeTooltipEl && !badgeTooltipEl.hidden) {
          hideVerifiedBadgeTooltip({ force: true });
        } else {
          showVerifiedBadgeTooltip(target, { pinned: true });
        }
        return;
      }
      if (badgeTooltipEl && !badgeTooltipEl.hidden && !badgeTooltipEl.contains?.(event.target)) {
        hideVerifiedBadgeTooltip({ force: true });
      }
    }, true);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        const target = event.target?.closest?.('.verified-badges-inline[data-verified-tier]');
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          showVerifiedBadgeTooltip(target, { pinned: true });
        }
      } else if (event.key === 'Escape') {
        hideVerifiedBadgeTooltip({ force: true });
      }
    });
    document.addEventListener('focusin', (event) => {
      const target = event.target?.closest?.('.verified-badges-inline[data-verified-tier]');
      if (target && !badgeTooltipPinned) showVerifiedBadgeTooltip(target);
    });
    document.addEventListener('focusout', (event) => {
      if (!badgeTooltipPinned && event.target?.closest?.('.verified-badges-inline[data-verified-tier]')) {
        hideVerifiedBadgeTooltip({ force: false });
      }
    });
    window.addEventListener('scroll', () => hideVerifiedBadgeTooltip({ force: true }), true);
    window.addEventListener('resize', () => hideVerifiedBadgeTooltip({ force: true }));
  }

  const CREATOR_ACCOUNT_EMAIL = 'breadspanish231@gmail.com';
  const hasAllEffectsAccess = (profile = currentProfile) => Boolean(
    profile?.role === 'SUPER_ADMIN'
    || String(profile?.email || '').trim().toLowerCase() === CREATOR_ACCOUNT_EMAIL
  );
  let cachedCreatorSocialId = null;

  async function resolveCreatorSocialId() {
    if (cachedCreatorSocialId) return cachedCreatorSocialId;
    try {
      const id = await rpc('announcement_author_social_id', { p_author_id: null, p_author_role: 'SUPER_ADMIN' });
      if (id && typeof id === 'string') {
        cachedCreatorSocialId = id;
        return id;
      }
    } catch (_) { }
    return null;
  }

  function applyBadgeRowState(rowEl, prefix, profile = currentProfile) {
    if (!rowEl) return;
    const titleEl = document.getElementById(`${prefix}-badge-title`);
    const pillEl = document.getElementById(`${prefix}-badge-pill`);
    const copyEl = document.getElementById(`${prefix}-badge-copy`);
    const emblemEl = document.getElementById(`${prefix}-badge-emblem`);
    const ctaBtn = document.getElementById(`${prefix}-badge-cta`);

    const rawInfo = resolveVerifiedBadgeInfo(profile, '', { allowPendingAck: true });
    const unlockedInfo = resolveVerifiedBadgeInfo(profile);
    const emailLower = String(profile?.email || '').trim().toLowerCase();
    const isCreatorSelf = rawInfo.tier === 'CREATOR_GREEN'
      || emailLower === CREATOR_ACCOUNT_EMAIL
      || (cachedCreatorSocialId && String(profile?.id || '') === String(cachedCreatorSocialId));
    const isPendingAck = !isCreatorSelf && rawInfo.tier === 'BLUE' && unlockedInfo.tier !== 'BLUE';
    const isVerifiedActive = !isCreatorSelf && unlockedInfo.tier === 'BLUE';

    rowEl.classList.remove('is-creator', 'is-awarded', 'is-active', 'is-available');
    if (pillEl) {
      pillEl.classList.remove('is-creator', 'is-awarded', 'is-active', 'is-available');
      pillEl.hidden = false;
    }

    const msgIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    const awardIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>';

    if (isCreatorSelf) {
      rowEl.classList.add('is-creator');
      if (emblemEl) emblemEl.innerHTML = badgeSealSvgMarkup('#15a025', 'Owner badge') + creatorCrownBadgeSvgMarkup('Founder & Creator');
      if (titleEl) titleEl.textContent = 'Creator & Founder';
      if (pillEl) { pillEl.textContent = ''; pillEl.hidden = true; }
      if (copyEl) copyEl.textContent = 'You are signed in on the creator account. Manage badges in Super Admin.';
      if (ctaBtn) { ctaBtn.hidden = true; }
      return;
    }

    if (emblemEl) emblemEl.innerHTML = badgeSealSvgMarkup('#1d9bf0', 'Verified Badge');

    if (isPendingAck) {
      rowEl.classList.add('is-awarded');
      if (titleEl) titleEl.textContent = 'Verified badge awarded';
      if (pillEl) { pillEl.textContent = 'Ready to claim'; pillEl.classList.add('is-awarded'); }
      if (copyEl) copyEl.textContent = 'You received a verified badge. Open your award pop-up and tap Thank you to display it.';
      if (ctaBtn) {
        ctaBtn.hidden = false;
        ctaBtn.className = 'button button-primary account-badge-cta is-claim';
        ctaBtn.removeAttribute('data-message-creator-badge');
        ctaBtn.setAttribute('data-claim-pending-badge', '1');
        ctaBtn.innerHTML = `${awardIcon}<span>Claim badge</span>`;
      }
      return;
    }

    if (isVerifiedActive) {
      rowEl.classList.add('is-active');
      if (titleEl) titleEl.textContent = 'Verified Account';
      if (pillEl) { pillEl.textContent = ''; pillEl.hidden = true; }
      const sinceText = unlockedInfo.granted_at ? `Verified since ${dateLabel(unlockedInfo.granted_at, { dateStyle: 'medium' })}` : 'Verified account';
      const tenureText = unlockedInfo.expires_at
        ? `Effective until ${dateLabel(unlockedInfo.expires_at, { dateStyle: 'medium' })}`
        : 'Permanent · Auto-removes after 2 months inactive';
      if (copyEl) copyEl.textContent = `${sinceText} · ${tenureText}`;
      if (ctaBtn) {
        ctaBtn.hidden = true;
        ctaBtn.removeAttribute('data-claim-pending-badge');
        ctaBtn.removeAttribute('data-message-creator-badge');
      }
      return;
    }

    rowEl.classList.add('is-available');
    if (titleEl) titleEl.textContent = 'Verified badge';
    if (pillEl) { pillEl.textContent = 'Available'; pillEl.classList.add('is-available'); }
    if (copyEl) copyEl.textContent = 'Want a blue verified badge beside your name? Message the creator directly to request verification.';
    if (ctaBtn) {
      ctaBtn.hidden = false;
      ctaBtn.className = 'button button-primary account-badge-cta';
      ctaBtn.removeAttribute('data-claim-pending-badge');
      ctaBtn.setAttribute('data-message-creator-badge', '1');
      ctaBtn.innerHTML = `${msgIcon}<span>Message creator</span>`;
    }
  }

  function syncAccountBadgeSection(profile = currentProfile) {
    const quickRow = document.getElementById('quick-verified-badge-row');
    if (quickRow) applyBadgeRowState(quickRow, 'quick', profile);
    const pageRow = document.getElementById('account-verified-badge-row');
    if (pageRow) applyBadgeRowState(pageRow, 'account', profile);
    const quickNameEl = document.getElementById('quick-account-name');
    if (quickNameEl && profile?.full_name) {
      quickNameEl.innerHTML = `<span>${escapeHtml(profile.full_name)}</span>${verifiedBadgesHtml(profile)}`;
    }
  }

  async function openCreatorBadgeChat(triggerButton = null) {
    if (!currentProfile || currentProfile.role === 'SUPER_ADMIN') return false;
    setBusy(triggerButton, true, 'Opening chat…');
    try {
      const creatorId = await resolveCreatorSocialId();
      if (!creatorId) {
        toast('Creator messaging is currently unavailable. Please try again later.', 'error');
        return false;
      }
      if (String(creatorId) === String(currentProfile.id || '')) {
        syncAccountBadgeSection(currentProfile);
        toast('You are signed in as the Creator account.', 'info');
        return false;
      }
      const info = resolveVerifiedBadgeInfo(currentProfile);
      const draft = info.tier === 'NONE'
        ? "Hi! I'd like to request a Verified Badge for my myIPON account."
        : '';
      const quickDlg = document.getElementById('account-dialog');
      if (quickDlg?.open) quickDlg.close();
      if (window.IponMessages?.openDirectMessage) {
        const opened = await window.IponMessages.openDirectMessage(creatorId, { draft });
        if (opened) return true;
      }
      const conv = await rpc('start_or_open_direct_chat', { p_target_id: creatorId });
      if (conv?.id) {
        location.href = `${homeForRole(currentProfile.role)}?chat=${encodeURIComponent(conv.id)}`;
        return true;
      }
      return false;
    } catch (error) {
      toast(friendlyError(error), 'error');
      return false;
    } finally {
      setBusy(triggerButton, false);
    }
  }

  function renderSidebarUser(profile = currentProfile) {
    const sidebarUser = document.getElementById('sidebar-user');
    if (!sidebarUser || !profile) return;
    sidebarUser.innerHTML = `<strong class="sidebar-user-name"><span>${escapeHtml(profile.full_name)}</span>${verifiedBadgesHtml(profile)}</strong><small>${escapeHtml(profile.role === 'SUPER_ADMIN' ? 'Owner' : 'My account')}</small>`;
  }

  async function refreshVerifiedBadgesCache({ force = false, refreshOwnProfile = false } = {}) {
    const client = getClient();
    if (!client) return VERIFIED_BADGE_MAP;
    if (!force && verifiedBadgesLoadedAt && (Date.now() - verifiedBadgesLoadedAt < 15000)) {
      return VERIFIED_BADGE_MAP;
    }
    try {
      const { data, error } = await withTimeout(client.rpc('get_active_verified_badges'), 5000);
      if (!error && Array.isArray(data)) {
        VERIFIED_BADGE_MAP.clear();
        registerVerifiedBadges(data);
        verifiedBadgesLoadedAt = Date.now();
      }
      if (refreshOwnProfile && currentProfile?.id) {
        const { data: freshProfile } = await withTimeout(
          client.from('profiles')
            .select('verified_badge_tier,verified_badge_expires_at,verified_badge_message,verified_badge_granted_at,verified_badge_acknowledged_at,last_seen_at')
            .eq('id', currentProfile.id)
            .single(),
          5000
        );
        if (freshProfile) {
          Object.assign(currentProfile, freshProfile);
          renderSidebarUser(currentProfile);
        }
      }
    } catch (_) { /* keep existing cache */ }
    return VERIFIED_BADGE_MAP;
  }

  function buildSmoothWavySealPath(lobes = 8, radius = 10.15, amplitude = 0.95) {
    const pts = [];
    for (let i = 0; i < 180; i += 1) {
      const t = (2 * Math.PI * i) / 180;
      const r = radius + amplitude * Math.cos(lobes * t);
      pts.push(`${(12 + r * Math.sin(t)).toFixed(2)} ${(12 - r * Math.cos(t)).toFixed(2)}`);
    }
    return `M${pts.join(' L')}Z`;
  }
  const MODAL_WAVY_SEAL_PATH = buildSmoothWavySealPath(8, 10.15, 0.95);

  function mountCelebrateConfetti(dialog, sheet, hero, canvas) {
    let rafId = null;
    let resizeHandler = null;
    const stopConfetti = () => {
      if (rafId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId);
      rafId = null;
      if (resizeHandler && typeof window?.removeEventListener === 'function') {
        window.removeEventListener('resize', resizeHandler);
      }
      resizeHandler = null;
    };

    const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    const ctx = (!reduceMotion && canvas && typeof canvas.getContext === 'function') ? canvas.getContext('2d') : null;
    if (ctx && sheet) {
      const palette = ['#1d9bf0', '#3ddc97', '#f0c869', '#ffffff', '#8ff0bf', '#7fb8e6', '#ff7aa2'];
      let parts = [];
      let w = 0;
      let h = 0;
      const fit = () => {
        const r = sheet.getBoundingClientRect?.() || { width: 440, height: 520 };
        const dpr = window.devicePixelRatio || 1;
        w = r.width || 440;
        h = r.height || 520;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      const burst = (count = 70) => {
        fit();
        const mr = sheet.getBoundingClientRect?.() || { left: 0, top: 0 };
        const hr = hero?.getBoundingClientRect?.() || { left: w / 2 - 48, top: 28, width: 96, height: 96 };
        const ox = hr.left + hr.width / 2 - mr.left;
        const oy = hr.top + hr.height / 2 - mr.top;
        for (let i = 0; i < count; i += 1) {
          const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
          const s = 6 + Math.random() * 11;
          parts.push({
            x: ox, y: oy, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
            w: 5 + Math.random() * 6, h: 3 + Math.random() * 5,
            rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
            tilt: Math.random() * 6.28, vt: 0.08 + Math.random() * 0.15,
            c: palette[i % palette.length], circle: Math.random() < 0.25
          });
        }
      };
      const tick = () => {
        if (!dialog.isConnected || !dialog.open) { stopConfetti(); return; }
        ctx.clearRect(0, 0, w, h);
        parts = parts.filter((p) => p.y < h + 20);
        if (Math.random() < 0.4) {
          parts.push({
            rain: true, x: Math.random() * w, y: -10,
            vy: 1.6 + Math.random() * 1.8, sw: Math.random() * 6.28,
            swv: 0.03 + Math.random() * 0.04, amp: 0.5 + Math.random() * 0.9,
            w: 5 + Math.random() * 5, h: 3 + Math.random() * 4,
            rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.2,
            tilt: Math.random() * 6.28, vt: 0.06 + Math.random() * 0.12,
            c: palette[(Math.random() * palette.length) | 0], circle: Math.random() < 0.2
          });
        }
        for (const p of parts) {
          if (p.rain) { p.sw += p.swv; p.x += Math.sin(p.sw) * p.amp; p.y += p.vy; }
          else { p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.30; p.x += p.vx; p.y += p.vy; }
          p.rot += p.vr;
          p.tilt += p.vt;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.cos(p.tilt));
          ctx.fillStyle = p.c;
          if (p.circle) { ctx.beginPath(); ctx.arc(0, 0, p.h / 1.4, 0, 6.28); ctx.fill(); }
          else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        rafId = requestAnimationFrame(tick);
      };
      fit();
      resizeHandler = fit;
      window.addEventListener?.('resize', resizeHandler);
      hero?.addEventListener('click', () => {
        burst(70);
        playUiSound('confetti');
      });
      setTimeout(() => { if (dialog.open) burst(80); }, 350);
      setTimeout(() => { if (dialog.open) burst(50); }, 850);
      rafId = requestAnimationFrame(tick);
    }
    return stopConfetti;
  }

  function maybeShowBadgeAwardModal(profile = currentProfile, opts = {}) {
    if (!profile || profile.role === 'SUPER_ADMIN') return false;
    const tier = effectiveVerifiedBadgeTier(profile, '', { allowPendingAck: true });
    if (tier !== 'BLUE' && tier !== 'CREATOR_GREEN') return false;
    if (profile.verified_badge_acknowledged_at) return false;
    if (document.getElementById('ipon-badge-award-dialog')) return false;

    const existingOpen = !opts?.force ? document.querySelector('dialog[open]:not(#notification-dialog)') : null;
    if (existingOpen) return false;

    const dialog = document.createElement('dialog');
    dialog.id = 'ipon-badge-award-dialog';
    dialog.className = 'badge-celebrate-dialog';
    dialog.setAttribute('aria-labelledby', 'ipon-badge-award-title');

    const creatorMsg = String(profile.verified_badge_message || '').trim();
    const isPermanent = !profile.verified_badge_expires_at;
    const grantedIso = profile.verified_badge_granted_at || new Date().toISOString();
    const verifiedOnText = dateLabel(grantedIso, { dateStyle: 'medium' });
    const recipientName = String(profile.full_name || 'Member').trim();

    let datesGridHtml = '';
    if (isPermanent) {
      datesGridHtml = `
        <div class="badge-celebrate-dates is-permanent">
          <div class="badge-celebrate-date"><small>Verified on</small><b>${escapeHtml(verifiedOnText)}</b></div>
          <div class="badge-celebrate-date is-permanent-card"><small>Status</small><b>Permanent</b></div>
        </div>`;
    } else {
      const expMs = Date.parse(profile.verified_badge_expires_at);
      const effectiveUntilText = Number.isNaN(expMs) ? 'Limited time' : dateLabel(new Date(expMs).toISOString(), { dateStyle: 'medium' });
      datesGridHtml = `
        <div class="badge-celebrate-dates">
          <div class="badge-celebrate-date"><small>Verified on</small><b>${escapeHtml(verifiedOnText)}</b></div>
          <div class="badge-celebrate-date"><small>Effective until</small><b>${escapeHtml(effectiveUntilText)}</b></div>
        </div>`;
    }

    const activityRequirementHtml = isPermanent
      ? `
        <div class="badge-celebrate-activity-box">
          <div class="badge-celebrate-stat"><strong>2</strong><small>MONTHS</small></div>
          <div class="badge-celebrate-activity-copy">
            <b>Activity requirement</b>
            <span>Permanent badges stay active while you use myIPON, and are automatically removed after <em>2 months</em> of inactivity.</span>
          </div>
        </div>`
      : '';

    dialog.innerHTML = `
      <div class="badge-celebrate-sheet${isPermanent ? ' is-permanent' : ''}" id="ipon-badge-award-sheet">
        <canvas class="badge-celebrate-confetti-canvas" id="ipon-badge-award-canvas" aria-hidden="true"></canvas>
        <div class="badge-celebrate-hero" id="ipon-badge-award-hero" title="Tap for confetti">
          <svg viewBox="0 0 24 24" shape-rendering="geometricPrecision" aria-hidden="true"><path fill="#1d9bf0" d="${MODAL_WAVY_SEAL_PATH}"/><path fill="none" stroke="#ffffff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" d="M7.2 12.3l3.2 3.2 6.4-6.9"/></svg>
        </div>
        <span class="badge-celebrate-eyebrow">VERIFIED STATUS UNLOCKED</span>
        <h2 id="ipon-badge-award-title">Congratulations<span class="badge-celebrate-name">${escapeHtml(recipientName)}!</span></h2>
        <p class="badge-celebrate-copy">You've been awarded a <b>${isPermanent ? 'permanent verified badge' : 'verified badge'}</b> on myIPON. Tap <b>Thank you</b> to display it beside your name across chats and community views.</p>
        ${datesGridHtml}
        ${creatorMsg ? `
          <div class="badge-celebrate-quote">
            <span class="badge-celebrate-quote-mark" aria-hidden="true">“</span>
            <div class="badge-celebrate-quote-head"><small>MESSAGE FROM CREATOR</small></div>
            <p>${escapeHtml(creatorMsg)}</p>
          </div>` : ''}
        ${activityRequirementHtml}
        <button type="button" class="badge-celebrate-btn" id="ipon-badge-award-ack">Thank you</button>
      </div>`;

    document.body.appendChild(dialog);
    const ackBtn = dialog.querySelector('#ipon-badge-award-ack');
    const sheet = dialog.querySelector('#ipon-badge-award-sheet');
    const hero = dialog.querySelector('#ipon-badge-award-hero');
    const canvas = dialog.querySelector('#ipon-badge-award-canvas');
    const stopConfetti = mountCelebrateConfetti(dialog, sheet, hero, canvas);

    const acknowledgeAndClose = async () => {
      playUiSound('unlock');
      if (ackBtn) setBusy(ackBtn, true, 'Saving…');
      try {
        const res = await rpc('acknowledge_my_verified_badge');
        if (currentProfile) {
          currentProfile.verified_badge_acknowledged_at = res?.acknowledged_at || new Date().toISOString();
        }
      } catch (_) {
        if (currentProfile) {
          currentProfile.verified_badge_acknowledged_at = new Date().toISOString();
        }
      } finally {
        stopConfetti();
        if (ackBtn) setBusy(ackBtn, false);
        try { dialog.close(); } catch { }
        dialog.remove();
        await refreshVerifiedBadgesCache({ force: true, refreshOwnProfile: true }).catch(() => { });
        renderSidebarUser(currentProfile);
        syncAccountBadgeSection(currentProfile);
        if (typeof window?.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
          window.dispatchEvent(new CustomEvent('ipon:badges-updated', { detail: { userId: currentProfile?.id } }));
        }
        maybeShowEffectAwardModal();
      }
    };

    ackBtn?.addEventListener('click', acknowledgeAndClose);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      acknowledgeAndClose();
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    playUiSound('celebration', { retryOnGestureEl: dialog });
    return true;
  }

  let ownProfileEffectsState = {
    equipped_effect: 'none',
    grants: [],
    trial_requests: [],
    trial_state: null
  };

  function syncAccountEffectsSummary() {
    const statusEl = document.getElementById('quick-effect-status');
    const openBtn = document.getElementById('quick-effects-open');
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const equippedId = api?.normalizeEffectId
      ? api.normalizeEffectId(ownProfileEffectsState?.equipped_effect)
      : (ownProfileEffectsState?.equipped_effect || 'none');
    const grants = Array.isArray(ownProfileEffectsState?.grants) ? ownProfileEffectsState.grants : [];
    const pendingCount = grants.filter((item) => !item?.acknowledged_at).length;
    const ownedCount = grants.length;
    const activeGrant = grants.find((item) => item?.effect_id === equippedId);
    const pendingTrialReq = ownProfileEffectsState?.trial_state?.pending_request || null;
    const effectMeta = api?.getEffect ? api.getEffect(equippedId) : { id: equippedId, name: equippedId };

    if (statusEl) {
      if (pendingCount > 0) {
        statusEl.textContent = `${pendingCount} new effect${pendingCount === 1 ? '' : 's'} ready to claim`;
      } else if (equippedId !== 'none') {
        statusEl.textContent = activeGrant && activeGrant.is_permanent === false && activeGrant.expires_at
          ? `${effectMeta.name} · Trial until ${dateLabel(activeGrant.expires_at, { dateStyle: 'medium' })}`
          : `${effectMeta.name} · Active`;
      } else if (ownedCount > 0) {
        statusEl.textContent = `None equipped · ${ownedCount} unlocked`;
      } else if (pendingTrialReq) {
        statusEl.textContent = 'Trial request pending Super Admin review';
      } else if (hasAllEffectsAccess(currentProfile)) {
        statusEl.textContent = 'All profile effects unlocked';
      } else {
        statusEl.textContent = 'Browse effects or request a trial';
      }
    }
    if (openBtn) {
      openBtn.textContent = pendingCount > 0 ? 'Claim & browse' : 'Browse effects';
    }
  }

  async function refreshProfileEffectsState({ checkModal = false } = {}) {
    if (!currentProfile?.id) return ownProfileEffectsState;
    try {
      const res = await rpc('get_own_profile_effects');
      if (res && typeof res === 'object') {
        ownProfileEffectsState = {
          equipped_effect: res.equipped_effect || 'none',
          grants: Array.isArray(res.grants) ? res.grants : [],
          trial_requests: Array.isArray(res.trial_requests) ? res.trial_requests : [],
          trial_state: res.trial_state && typeof res.trial_state === 'object' ? res.trial_state : null
        };
        currentProfile.equipped_profile_effect = ownProfileEffectsState.equipped_effect;
        syncAccountEffectsSummary();
        if (checkModal) maybeShowEffectAwardModal();
      }
    } catch (_) {
      syncAccountEffectsSummary();
    }
    return ownProfileEffectsState;
  }

  function maybeShowEffectAwardModal(opts = {}) {
    const targetProfile = opts?.profile || currentProfile;
    if (!targetProfile) return false;
    const sourceGrants = Array.isArray(opts?.grants) ? opts.grants : ownProfileEffectsState?.grants;
    const pendingGrants = (Array.isArray(sourceGrants) ? sourceGrants : [])
      .filter((item) => item && !item.acknowledged_at && item.effect_id && item.effect_id !== 'none');
    if (!pendingGrants.length) return false;
    if (document.getElementById('ipon-effect-award-dialog')) return false;

    const existingOpen = !opts?.force ? document.querySelector('dialog[open]:not(#notification-dialog)') : null;
    if (existingOpen) return false;

    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const rarities = api?.RARITIES || ['Common', 'Rare', 'Epic'];
    let activeIdx = 0;

    const dialog = document.createElement('dialog');
    dialog.id = 'ipon-effect-award-dialog';
    dialog.className = 'badge-celebrate-dialog effect-celebrate-dialog';
    dialog.setAttribute('aria-labelledby', 'ipon-effect-award-title');

    const recipientName = String(targetProfile.full_name || 'Member').trim();
    const firstGrant = pendingGrants[0];
    const firstEffect = api?.getEffect ? api.getEffect(firstGrant.effect_id) : { id: firstGrant.effect_id, name: firstGrant.effect_id, cat: 'Special', rare: 0 };
    const grantedIso = firstGrant.granted_at || new Date().toISOString();
    const unlockedOnText = dateLabel(grantedIso, { dateStyle: 'medium' });
    const cardTheme = ['emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono'].includes(targetProfile.card_theme)
      ? targetProfile.card_theme
      : 'emerald';

    const switchTabsHtml = pendingGrants.length > 1
      ? `<div class="effect-celebrate-tabs" role="tablist" aria-label="Unlocked profile effects">${pendingGrants.map((g, idx) => {
        const meta = api?.getEffect ? api.getEffect(g.effect_id) : { name: g.effect_id };
        return `<button type="button" class="effect-celebrate-tab" data-preview-grant-idx="${idx}" aria-selected="${idx === 0 ? 'true' : 'false'}">${escapeHtml(meta.name)}</button>`;
      }).join('')}</div>`
      : '';

    const avatarInner = isSafeImageRef(targetProfile.avatar_url)
      ? `<img src="${escapeHtml(targetProfile.avatar_url)}" alt="${escapeHtml(recipientName)}"><span>${escapeHtml(initials(recipientName))}</span>`
      : `<span>${escapeHtml(initials(recipientName))}</span>`;

    const describeGrant = (g, meta) => {
      const rt = meta.rare ? ` · ${rarities[meta.rare] || ''}` : '';
      const isTrial = g?.is_permanent === false;
      return {
        isTrial,
        eyebrow: isTrial ? 'TRIAL PROFILE EFFECT UNLOCKED' : 'PROFILE EFFECT UNLOCKED',
        copyHtml: isTrial
          ? `Your <b>${escapeHtml(meta.name)}</b> (${escapeHtml(meta.cat + rt)}) trial profile effect is now active.`
          : `You received the permanent <b>${escapeHtml(meta.name)}</b> (${escapeHtml(meta.cat + rt)}) profile effect.`,
        statusLabel: isTrial ? 'Trial expires' : 'Status',
        statusText: isTrial
          ? (g?.expires_at ? dateLabel(g.expires_at, { dateStyle: 'medium', timeStyle: 'short' }) : 'Limited trial')
          : 'Permanent'
      };
    };

    const initialMsg = String(firstGrant.grant_message || '').trim();
    const initialView = describeGrant(firstGrant, firstEffect);

    dialog.innerHTML = `
      <div class="badge-celebrate-sheet is-permanent is-effect" id="ipon-effect-award-sheet">
        <canvas class="badge-celebrate-confetti-canvas" id="ipon-effect-award-canvas" aria-hidden="true"></canvas>
        <div class="effect-celebrate-hero" id="ipon-effect-award-hero" data-card-theme="${escapeHtml(cardTheme)}" title="Tap for confetti">
          <div class="effect-celebrate-banner"></div>
          <div class="effect-celebrate-avatar avatar-circle avatar-lg">${avatarInner}</div>
        </div>
        <span class="badge-celebrate-eyebrow" id="ipon-effect-award-eyebrow">${escapeHtml(initialView.eyebrow)}</span>
        <h2 id="ipon-effect-award-title">Congratulations<span class="badge-celebrate-name">${escapeHtml(recipientName)}!</span></h2>
        ${switchTabsHtml}
        <p class="badge-celebrate-copy" id="ipon-effect-award-copy">${initialView.copyHtml}</p>
        <div class="badge-celebrate-dates is-permanent">
          <div class="badge-celebrate-date"><small>Unlocked on</small><b id="ipon-effect-award-date">${escapeHtml(unlockedOnText)}</b></div>
          <div class="badge-celebrate-date ${initialView.isTrial ? 'is-trial-card' : 'is-permanent-card'}" id="ipon-effect-award-status-card"><small id="ipon-effect-award-status-label">${escapeHtml(initialView.statusLabel)}</small><b id="ipon-effect-award-status-value">${escapeHtml(initialView.statusText)}</b></div>
        </div>
        <div class="badge-celebrate-quote" id="ipon-effect-award-quote"${initialMsg ? '' : ' hidden'}>
          <span class="badge-celebrate-quote-mark" aria-hidden="true">“</span>
          <div class="badge-celebrate-quote-head"><small>MESSAGE FROM CREATOR</small></div>
          <p id="ipon-effect-award-quote-text">${escapeHtml(initialMsg)}</p>
        </div>
        <div class="effect-celebrate-actions">
          <button type="button" class="badge-celebrate-btn" id="ipon-effect-award-equip">Equip now</button>
          <button type="button" class="effect-celebrate-secondary-btn" id="ipon-effect-award-keep">Thank you · Keep in collection</button>
        </div>
      </div>`;

    document.body.appendChild(dialog);
    bindAvatarFallbacks(dialog);

    const equipBtn = dialog.querySelector('#ipon-effect-award-equip');
    const keepBtn = dialog.querySelector('#ipon-effect-award-keep');
    const sheet = dialog.querySelector('#ipon-effect-award-sheet');
    const hero = dialog.querySelector('#ipon-effect-award-hero');
    const canvas = dialog.querySelector('#ipon-effect-award-canvas');
    const stopConfetti = mountCelebrateConfetti(dialog, sheet, hero, canvas);

    const heroStage = api?.mountStage
      ? api.mountStage(hero, {
        effectId: firstGrant.effect_id,
        geometryFn: () => ({ cx: hero.clientWidth / 2 || 132, cy: 62, ra: 32 }),
        fps: 60,
        maxDpr: 2
      })
      : null;

    const selectGrantIdx = (idx) => {
      activeIdx = Math.max(0, Math.min(pendingGrants.length - 1, idx));
      const g = pendingGrants[activeIdx];
      const meta = api?.getEffect ? api.getEffect(g.effect_id) : { id: g.effect_id, name: g.effect_id, cat: 'Special', rare: 0 };
      const view = describeGrant(g, meta);
      const eyebrowEl = dialog.querySelector('#ipon-effect-award-eyebrow');
      const copyEl = dialog.querySelector('#ipon-effect-award-copy');
      const dateEl = dialog.querySelector('#ipon-effect-award-date');
      const statusCard = dialog.querySelector('#ipon-effect-award-status-card');
      const statusLabelEl = dialog.querySelector('#ipon-effect-award-status-label');
      const statusValEl = dialog.querySelector('#ipon-effect-award-status-value');
      const quoteBox = dialog.querySelector('#ipon-effect-award-quote');
      const quoteText = dialog.querySelector('#ipon-effect-award-quote-text');
      if (eyebrowEl) eyebrowEl.textContent = view.eyebrow;
      if (copyEl) copyEl.innerHTML = view.copyHtml;
      if (dateEl) dateEl.textContent = dateLabel(g.granted_at || new Date().toISOString(), { dateStyle: 'medium' });
      if (statusLabelEl) statusLabelEl.textContent = view.statusLabel;
      if (statusValEl) statusValEl.textContent = view.statusText;
      if (statusCard) statusCard.className = `badge-celebrate-date ${view.isTrial ? 'is-trial-card' : 'is-permanent-card'}`;
      const msg = String(g.grant_message || '').trim();
      if (quoteBox && quoteText) {
        quoteBox.hidden = !msg;
        quoteText.textContent = msg;
      }
      dialog.querySelectorAll('[data-preview-grant-idx]').forEach((btn) => {
        btn.setAttribute('aria-selected', String(Number(btn.dataset.previewGrantIdx) === activeIdx));
      });
      heroStage?.setEffect(g.effect_id);
    };

    dialog.querySelectorAll('[data-preview-grant-idx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        playUiSound('chip');
        selectGrantIdx(Number(btn.dataset.previewGrantIdx));
      });
    });

    const finalize = async (shouldEquip) => {
      playUiSound('unlock');
      if (equipBtn) setBusy(equipBtn, shouldEquip, 'Equipping…');
      if (keepBtn) setBusy(keepBtn, !shouldEquip, 'Saving…');
      if (equipBtn && !shouldEquip) equipBtn.disabled = true;
      if (keepBtn && shouldEquip) keepBtn.disabled = true;
      const grantIds = pendingGrants.map((g) => g.effect_id);
      const selectedEffectId = pendingGrants[activeIdx]?.effect_id || pendingGrants[0].effect_id;
      try {
        const res = await rpc('acknowledge_my_profile_effects', {
          p_effect_ids: grantIds,
          p_equip_effect_id: shouldEquip ? selectedEffectId : null
        });
        if (res && typeof res === 'object') {
          ownProfileEffectsState = {
            equipped_effect: res.equipped_effect || ownProfileEffectsState.equipped_effect || 'none',
            grants: Array.isArray(res.grants) ? res.grants : ownProfileEffectsState.grants,
            trial_requests: Array.isArray(res.trial_requests) ? res.trial_requests : ownProfileEffectsState.trial_requests,
            trial_state: res.trial_state && typeof res.trial_state === 'object' ? res.trial_state : ownProfileEffectsState.trial_state
          };
        } else {
          const nowIso = new Date().toISOString();
          ownProfileEffectsState.grants = (ownProfileEffectsState.grants || []).map((g) => ({ ...g, acknowledged_at: g.acknowledged_at || nowIso }));
          if (shouldEquip) ownProfileEffectsState.equipped_effect = selectedEffectId;
        }
        if (currentProfile) currentProfile.equipped_profile_effect = ownProfileEffectsState.equipped_effect;
        if (targetProfile) targetProfile.equipped_profile_effect = ownProfileEffectsState.equipped_effect;
        syncAccountEffectsSummary();
        window.dispatchEvent?.(new CustomEvent('ipon:profile-updated', { detail: targetProfile }));
        if (shouldEquip) {
          const meta = api?.getEffect ? api.getEffect(selectedEffectId) : { name: 'Profile effect' };
          toast(`${meta.name} equipped to your profile.`);
        }
      } catch (err) {
        toast(friendlyError(err), 'error');
      } finally {
        stopConfetti();
        heroStage?.destroy?.();
        if (equipBtn) setBusy(equipBtn, false);
        if (keepBtn) setBusy(keepBtn, false);
        try { dialog.close(); } catch { }
        dialog.remove();
      }
    };

    equipBtn?.addEventListener('click', () => finalize(true));
    keepBtn?.addEventListener('click', () => finalize(false));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finalize(false);
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    playUiSound('celebration', { retryOnGestureEl: dialog });
    requestAnimationFrame?.(() => heroStage?.refreshGeometry?.());
    return true;
  }

  async function openProfileEffectsDialog() {
    if (!currentProfile) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    if (!api) {
      toast('Profile effects library is still loading. Please try again.', 'error');
      return;
    }
    document.getElementById('profile-effects-dialog')?.remove();

    const [effectsState, appearance, myGroups] = await Promise.all([
      refreshProfileEffectsState({ checkModal: false }),
      rpc('get_profile_card_appearance', { p_target_id: currentProfile.id }).catch(() => null),
      currentProfile.role !== 'SUPER_ADMIN'
        ? rpc('get_my_groups').catch(() => [])
        : Promise.resolve([])
    ]);

    const cardThemes = ['emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono'];
    let cardTheme = cardThemes.includes(appearance?.card_theme || currentProfile.card_theme)
      ? (appearance?.card_theme || currentProfile.card_theme)
      : 'emerald';
    const coverUrl = isSafeImageRef(appearance?.cover_url || currentProfile.cover_url)
      ? (appearance?.cover_url || currentProfile.cover_url)
      : '';
    let currentState = effectsState && typeof effectsState === 'object' ? effectsState : ownProfileEffectsState;
    const grantsById = new Map();
    const ownedSet = new Set();
    const rebuildGrants = () => {
      grantsById.clear();
      ownedSet.clear();
      if (hasAllEffectsAccess(currentProfile)) {
        api.EFFECTS.forEach((item) => ownedSet.add(item.id));
        return;
      }
      (currentState?.grants || []).forEach((item) => {
        if (!item?.effect_id) return;
        grantsById.set(item.effect_id, item);
        ownedSet.add(item.effect_id);
      });
    };
    rebuildGrants();
    let equipped = api.normalizeEffectId(currentState?.equipped_effect || currentProfile.equipped_profile_effect);
    if (equipped !== 'none' && !ownedSet.has(equipped) && !hasAllEffectsAccess(currentProfile)) equipped = 'none';
    let preview = equipped;
    let activeCategory = 'All';
    let searchQuery = '';

    const fullName = String(currentProfile.full_name || 'Member').trim();
    const cleanUsername = String(currentProfile.username || '').trim().replace(/^@+/, '');
    const bioText = String(currentProfile.bio || '').trim();
    const previewSocialLinks = sanitizeSocialLinks(
      appearance && typeof appearance === 'object' && 'social_links' in appearance
        ? appearance.social_links
        : currentProfile.social_links
    );
    const previewSocialHtml = renderSocialAppLinksHtml(previewSocialLinks, { variant: 'effects' });
    const roleText = currentProfile.role === 'SUPER_ADMIN'
      ? 'Platform Owner'
      : currentProfile.role === 'ADMIN'
        ? 'Group Admin'
        : currentProfile.role === 'TREASURER'
          ? 'Treasurer'
          : 'Member';
    const groupText = Array.isArray(myGroups) && myGroups.length
      ? myGroups.map((g) => g?.group_name || g?.name).filter(Boolean).slice(0, 2).join(' · ')
      : (currentProfile.role === 'SUPER_ADMIN' ? 'System Administrator' : 'Personal workspace');
    const avatarInner = isSafeImageRef(currentProfile.avatar_url)
      ? `<img src="${escapeHtml(currentProfile.avatar_url)}" alt="${escapeHtml(fullName)}"><span>${escapeHtml(initials(fullName))}</span>`
      : `<span>${escapeHtml(initials(fullName))}</span>`;

    const dialog = document.createElement('dialog');
    dialog.id = 'profile-effects-dialog';
    dialog.className = 'effects-gallery-dialog';
    dialog.setAttribute('aria-labelledby', 'effects-gallery-title');

    dialog.innerHTML = `
      <div class="effects-gallery-sheet">
        <header class="effects-gallery-head">
          <div>
            <h2 id="effects-gallery-title">Profile Effects</h2>
            <p>Living animations that orbit and drift around your avatar. Pick one to preview it on your profile, then equip unlocked effects or request a one-time trial.</p>
          </div>
          <button type="button" class="dialog-close effects-gallery-close" id="effects-gallery-close" aria-label="Close profile effects">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="effects-gallery-layout">
          <section class="effects-gallery-main">
            <div class="effects-motion-notice" id="effects-motion-notice" hidden>
              <span>Your device asks for reduced motion, so effects are shown as still frames.</span>
              <button type="button" id="effects-play-motion">Play animations</button>
            </div>
            <input class="effects-find" id="effects-search" type="search" placeholder="Search effects" aria-label="Search effects">
            <div class="effects-chips" id="effects-chips">${api.CATEGORIES.map((c) => `<button type="button" class="effects-chip" data-effect-cat="${escapeHtml(c)}" aria-pressed="${c === 'All' ? 'true' : 'false'}">${escapeHtml(c)}</button>`).join('')}</div>
            <div class="effects-grid" id="effects-grid"></div>
          </section>
          <aside class="effects-side">
            <div class="effects-card" id="effects-preview-card" data-theme="${escapeHtml(cardTheme)}">
              <div class="effects-banner">${coverUrl ? `<img src="${escapeHtml(coverUrl)}" alt="">` : ''}</div>
              <div class="effects-card-body">
                <div class="effects-card-avatar avatar-circle">${avatarInner}</div>
                <h3 class="effects-card-name">${escapeHtml(fullName)}${verifiedBadgesHtml(currentProfile)}</h3>
                <p class="effects-card-meta">${cleanUsername ? `@${escapeHtml(cleanUsername)} · ` : ''}${escapeHtml(roleText)}</p>
                ${bioText ? `<p class="effects-card-bio">${escapeHtml(bioText)}</p>` : ''}
                ${previewSocialHtml ? `<div class="effects-card-apps">${previewSocialHtml}</div>` : ''}
                <div class="effects-card-groups"><small>GROUPS</small><b>${escapeHtml(groupText)}</b></div>
              </div>
            </div>
            <div class="effects-panel">
              <div class="effects-status">
                <div><small id="effects-st-label">EQUIPPED</small><b id="effects-st-name">No effect</b></div>
                <span class="effects-pill off" id="effects-st-pill">NONE</span>
              </div>
              <div class="effects-pbtns" id="effects-pbtns">
                <button type="button" class="effects-btn primary" id="effects-equip-btn">Equip effect</button>
                <button type="button" class="effects-btn ghost" id="effects-cancel-btn" hidden>Cancel</button>
              </div>
              <div class="effects-trial-box" id="effects-trial-box" hidden></div>
            </div>
            <div class="effects-dock" id="effects-theme-dock" role="group" aria-label="Card theme">
              ${cardThemes.map((t) => `<button type="button" data-t="${t}" aria-label="${escapeHtml(t[0].toUpperCase() + t.slice(1))}" aria-pressed="${t === cardTheme ? 'true' : 'false'}"></button>`).join('')}
            </div>
          </aside>
        </div>
      </div>`;

    document.body.appendChild(dialog);
    bindAvatarFallbacks(dialog);

    const grid = dialog.querySelector('#effects-grid');
    const previewCard = dialog.querySelector('#effects-preview-card');
    const cardStage = api.mountStage(previewCard, { effectId: preview, fps: 60, maxDpr: 2 });
    const tileControllers = new Map();
    const tiles = new Map();

    for (const e of api.ALL_OPTIONS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'effects-tile';
      btn.dataset.id = e.id;
      btn.dataset.cat = e.cat;
      btn.setAttribute('aria-pressed', String(e.id === preview));
      const rarLabel = e.rare ? ` · ${api.RARITIES[e.rare] || ''}` : '';
      btn.innerHTML = `
        <div class="tstage">
          <div class="mav">${escapeHtml(initials(fullName))}</div>
          <span class="flag">EQUIPPED</span>
          <span class="trial-flag" hidden>TRIAL</span>
          <span class="lk">LOCKED</span>
        </div>
        <div class="tmeta">
          <div class="trow"><b>${escapeHtml(e.name)}</b><em class="cat rar${e.rare | 0}">${escapeHtml(e.cat + rarLabel)}</em></div>
          <p>${escapeHtml(e.desc)}</p>
        </div>`;
      grid.appendChild(btn);
      tiles.set(e.id, btn);
      if (e.id !== 'none') {
        const tstage = btn.querySelector('.tstage');
        tileControllers.set(e.id, api.mountStage(tstage, {
          effectId: e.id,
          geometryFn: (W, H) => ({ cx: W / 2, cy: H * 0.48, ra: Math.max(12, W * 0.115) }),
          fps: 30,
          maxDpr: 1.5
        }));
      }
      btn.addEventListener('click', () => {
        preview = e.id;
        cardStage.setEffect(preview);
        syncGalleryUi();
      });
    }

    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'effects-empty';
    emptyMsg.textContent = 'No effects match your search.';
    emptyMsg.hidden = true;
    grid.appendChild(emptyMsg);

    const isLocked = (id) => id !== 'none' && !ownedSet.has(id);

    function applyFilter() {
      let visibleCount = 0;
      for (const e of api.ALL_OPTIONS) {
        const tile = tiles.get(e.id);
        if (!tile) continue;
        const catMatch = activeCategory === 'All' || e.cat === activeCategory || (activeCategory === 'Special' && e.rare > 0);
        const noneMatch = e.id !== 'none' || activeCategory === 'All';
        const hay = `${e.name} ${e.cat} ${e.desc} ${api.RARITIES[e.rare] || ''}`.toLowerCase();
        const queryMatch = !searchQuery || hay.includes(searchQuery);
        const show = catMatch && noneMatch && queryMatch;
        tile.hidden = !show;
        if (show) {
          tile.classList.remove('in');
          tile.style.animationDelay = `${Math.min(visibleCount, 12) * 24}ms`;
          tile.classList.add('in');
          visibleCount += 1;
        }
      }
      emptyMsg.hidden = visibleCount > 0;
    }

    function openTrialRequestModal(previewMeta) {
      document.getElementById('effects-trial-request-dialog')?.remove();
      const rarities = api?.RARITIES || ['Common', 'Rare', 'Epic'];
      const rarText = previewMeta.rare ? ` · ${rarities[previewMeta.rare] || ''}` : '';
      const reqModal = document.createElement('dialog');
      reqModal.id = 'effects-trial-request-dialog';
      reqModal.className = 'form-dialog effect-trial-req-dialog';
      reqModal.setAttribute('aria-labelledby', 'effects-trial-req-title');
      reqModal.innerHTML = `
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="effects-trial-req-title">Request a trial effect</h2>
              <p>Super Admin reviews requests and sets how long your trial runs.</p>
            </div>
            <button type="button" class="dialog-close" id="effects-trial-req-close" aria-label="Close trial request dialog">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <form id="effects-trial-req-form" class="form-grid" novalidate>
            <div class="effect-trial-req-banner field-wide">
              <div>
                <strong>${escapeHtml(previewMeta.name)}</strong>
                <small>${escapeHtml(previewMeta.cat + rarText)}</small>
              </div>
              <span class="effects-trial-pill">1 TRIAL · 1M COOLDOWN</span>
            </div>
            <div class="field field-wide">
              <label for="effects-trial-modal-note">Note for Super Admin <span class="badge-optional-tag">(optional)</span></label>
              <textarea id="effects-trial-modal-note" name="note" rows="3" maxlength="200" placeholder="Add an optional note explaining why you want to try this effect…"></textarea>
              <div class="effect-trial-req-meta-row">
                <small class="field-error" id="effects-trial-modal-error" aria-live="polite"></small>
                <small class="field-help" id="effects-trial-modal-count">0 / 200</small>
              </div>
            </div>
            <div class="form-actions field-wide">
              <button type="button" class="button button-secondary" id="effects-trial-req-cancel">Cancel</button>
              <button type="submit" class="button button-primary" id="effects-trial-req-submit">Send trial request</button>
            </div>
          </form>
        </div>`;

      document.body.appendChild(reqModal);
      const form = reqModal.querySelector('#effects-trial-req-form');
      const noteEl = reqModal.querySelector('#effects-trial-modal-note');
      const countEl = reqModal.querySelector('#effects-trial-modal-count');
      const errEl = reqModal.querySelector('#effects-trial-modal-error');
      const submitBtn = reqModal.querySelector('#effects-trial-req-submit');
      const closeReqModal = () => {
        try { reqModal.close(); } catch { }
        reqModal.remove();
      };

      noteEl?.addEventListener('input', () => {
        if (errEl) errEl.textContent = '';
        if (countEl) countEl.textContent = `${noteEl.value.length} / 200`;
      });
      reqModal.querySelector('#effects-trial-req-close')?.addEventListener('click', closeReqModal);
      reqModal.querySelector('#effects-trial-req-cancel')?.addEventListener('click', closeReqModal);
      reqModal.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeReqModal();
      });

      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const noteVal = String(noteEl?.value || '').trim();
        if (errEl) errEl.textContent = '';
        setBusy(submitBtn, true, 'Sending…');
        if (noteEl) noteEl.disabled = true;
        try {
          const nextState = await rpc('submit_profile_effect_trial_request', {
            p_effect_id: previewMeta.id,
            p_note: noteVal
          });
          if (nextState && typeof nextState === 'object') {
            currentState = nextState;
            ownProfileEffectsState = nextState;
            rebuildGrants();
            syncAccountEffectsSummary();
          }
          closeReqModal();
          toast(`Trial request sent for "${previewMeta.name}".`);
          syncGalleryUi();
        } catch (error) {
          const msg = friendlyError(error);
          if (errEl) errEl.textContent = msg;
          else toast(msg, 'error');
          setBusy(submitBtn, false);
          if (noteEl) noteEl.disabled = false;
        }
      });

      if (typeof reqModal.showModal === 'function') reqModal.showModal();
    }

    function syncTrialBox(lk, previewMeta) {
      const box = dialog.querySelector('#effects-trial-box');
      if (!box) return;
      if (!lk || hasAllEffectsAccess(currentProfile)) {
        box.hidden = true;
        box.innerHTML = '';
        return;
      }
      box.hidden = false;
      const trialState = currentState?.trial_state || {};
      const usedEffects = new Set(Array.isArray(trialState.used_effects) ? trialState.used_effects : []);
      const activeTrial = trialState.active_trial || null;
      const pendingReq = trialState.pending_request || null;
      const cooldownIso = trialState.cooldown_until || null;
      const cooldownMs = cooldownIso ? Date.parse(cooldownIso) : NaN;
      const hasCooldown = Number.isFinite(cooldownMs) && cooldownMs > Date.now();

      if (pendingReq && pendingReq.effect_id === previewMeta.id) {
        box.dataset.tone = 'pending';
        box.innerHTML = `
          <div class="effects-trial-title"><span>Trial request pending (${escapeHtml(dateLabel(pendingReq.created_at, { dateStyle: 'short' }))})</span><span class="effects-trial-pill">PENDING</span></div>
          <button type="button" class="effects-trial-btn is-danger" id="effects-cancel-trial-btn">Cancel trial request</button>`;
        box.querySelector('#effects-cancel-trial-btn')?.addEventListener('click', async (event) => {
          const btnEl = event.currentTarget;
          setBusy(btnEl, true, 'Cancelling…');
          try {
            const nextState = await rpc('cancel_own_profile_effect_trial_request', { p_request_id: pendingReq.id });
            if (nextState && typeof nextState === 'object') {
              currentState = nextState;
              ownProfileEffectsState = nextState;
              rebuildGrants();
              syncAccountEffectsSummary();
            }
            toast(`Cancelled trial request for "${previewMeta.name}".`);
            syncGalleryUi();
          } catch (error) {
            toast(friendlyError(error), 'error');
            setBusy(btnEl, false);
          }
        });
        return;
      }

      if (activeTrial) {
        box.dataset.tone = 'warning';
        const activeMeta = api.getEffect(activeTrial.effect_id);
        box.innerHTML = `
          <div class="effects-trial-title"><span>Trial active: ${escapeHtml(activeMeta.name)}</span><span class="effects-trial-pill">ACTIVE</span></div>
          <p class="effects-trial-msg">Ends ${escapeHtml(dateLabel(activeTrial.expires_at, { dateStyle: 'medium', timeStyle: 'short' }))}. New trial requests unlock after trial and cooldown.</p>`;
        return;
      }

      if (pendingReq) {
        box.dataset.tone = 'pending';
        const otherMeta = api.getEffect(pendingReq.effect_id);
        box.innerHTML = `
          <div class="effects-trial-title"><span>Pending: ${escapeHtml(otherMeta.name)}</span><span class="effects-trial-pill">1 PENDING</span></div>
          <button type="button" class="effects-trial-btn is-primary" id="effects-jump-pending-btn">View "${escapeHtml(otherMeta.name)}"</button>`;
        box.querySelector('#effects-jump-pending-btn')?.addEventListener('click', () => {
          preview = pendingReq.effect_id;
          cardStage.setEffect(preview);
          syncGalleryUi();
        });
        return;
      }

      if (usedEffects.has(previewMeta.id)) {
        box.dataset.tone = 'warning';
        box.innerHTML = `
          <div class="effects-trial-title"><span>Trial already used</span><span class="effects-trial-pill">1 / 1 USED</span></div>
          <p class="effects-trial-msg">Only 1 trial per effect is allowed for "${escapeHtml(previewMeta.name)}".</p>`;
        return;
      }

      if (hasCooldown) {
        const daysLeft = Math.max(1, Math.ceil((cooldownMs - Date.now()) / 86400000));
        box.dataset.tone = 'warning';
        box.innerHTML = `
          <div class="effects-trial-title"><span>1-month cooldown active</span><span class="effects-trial-pill">${daysLeft}D LEFT</span></div>
          <p class="effects-trial-msg">Next trial opens on ${escapeHtml(dateLabel(cooldownIso, { dateStyle: 'medium' }))}.</p>`;
        return;
      }

      box.dataset.tone = 'ready';
      box.innerHTML = `<button type="button" class="effects-trial-btn is-primary" id="effects-request-trial-btn">Request a trial effect</button>`;
      box.querySelector('#effects-request-trial-btn')?.addEventListener('click', () => {
        openTrialRequestModal(previewMeta);
      });
    }

    function syncGalleryUi() {
      for (const e of api.ALL_OPTIONS) {
        const tile = tiles.get(e.id);
        if (!tile) continue;
        tile.setAttribute('aria-pressed', String(e.id === preview));
        tile.dataset.eq = String(e.id === equipped && equipped !== 'none');
        tile.dataset.lock = String(isLocked(e.id));
        const gInfo = grantsById.get(e.id);
        const trialTag = tile.querySelector('.trial-flag');
        if (trialTag) trialTag.hidden = !(gInfo && gInfo.is_permanent === false);
      }
      const pv = preview !== equipped;
      const lk = isLocked(preview);
      const pill = dialog.querySelector('#effects-st-pill');
      const btn = dialog.querySelector('#effects-equip-btn');
      const cancelBtn = dialog.querySelector('#effects-cancel-btn');
      const pbtns = dialog.querySelector('#effects-pbtns');
      const stLabel = dialog.querySelector('#effects-st-label');
      const stName = dialog.querySelector('#effects-st-name');

      const previewMeta = api.getEffect(preview);
      const equippedMeta = api.getEffect(equipped);
      const activeGrant = grantsById.get(preview);
      const isTrialOwned = Boolean(activeGrant && activeGrant.is_permanent === false);
      if (stLabel) stLabel.textContent = pv ? 'PREVIEWING' : 'EQUIPPED';
      if (stName) stName.textContent = pv ? previewMeta.name : equippedMeta.name;
      if (pill) {
        pill.className = `effects-pill ${lk ? 'lock' : isTrialOwned ? 'trial' : pv ? 'pv' : equipped === 'none' ? 'off' : 'eq'}`;
        pill.textContent = lk
          ? 'LOCKED'
          : isTrialOwned
            ? (activeGrant.expires_at ? `TRIAL · ${dateLabel(activeGrant.expires_at, { dateStyle: 'short' })}` : 'TRIAL')
            : pv ? 'NOT SAVED' : equipped === 'none' ? 'NONE' : 'ACTIVE';
      }
      if (btn) {
        btn.hidden = lk;
        btn.disabled = !pv || lk;
        btn.textContent = preview === 'none'
          ? (equipped === 'none' ? 'No effect equipped' : 'Remove effect')
          : 'Equip effect';
      }
      if (cancelBtn) {
        cancelBtn.hidden = !pv;
        cancelBtn.textContent = lk ? 'Back to equipped' : 'Cancel';
      }
      if (pbtns) {
        pbtns.hidden = lk && !pv;
        pbtns.classList.toggle('single', lk || !pv);
      }
      syncTrialBox(lk, previewMeta);
    }

    const syncMotionNotice = () => {
      const notice = dialog.querySelector('#effects-motion-notice');
      if (notice) notice.hidden = !(api.isReducedMotion() && !api.getMotionForced());
    };
    const offMotionListener = api.onMotionChange(syncMotionNotice);
    syncMotionNotice();
    dialog.querySelector('#effects-play-motion')?.addEventListener('click', () => api.setMotionForced(true));

    dialog.querySelector('#effects-chips')?.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-effect-cat]');
      if (!chip) return;
      activeCategory = chip.dataset.effectCat || 'All';
      dialog.querySelectorAll('.effects-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      applyFilter();
    });
    dialog.querySelector('#effects-search')?.addEventListener('input', (event) => {
      searchQuery = String(event.target.value || '').trim().toLowerCase();
      applyFilter();
    });
    dialog.querySelector('#effects-cancel-btn')?.addEventListener('click', () => {
      preview = equipped;
      cardStage.setEffect(preview);
      syncGalleryUi();
    });
    dialog.querySelector('#effects-equip-btn')?.addEventListener('click', async () => {
      const targetId = preview;
      if (isLocked(targetId) || targetId === equipped) return;
      const btn = dialog.querySelector('#effects-equip-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        const res = await rpc('equip_own_profile_effect', { p_effect_id: targetId });
        ownProfileEffectsState = {
          equipped_effect: res?.equipped_effect || targetId,
          grants: Array.isArray(res?.grants) ? res.grants : ownProfileEffectsState.grants,
          trial_requests: Array.isArray(res?.trial_requests) ? res.trial_requests : ownProfileEffectsState.trial_requests,
          trial_state: res?.trial_state && typeof res.trial_state === 'object' ? res.trial_state : ownProfileEffectsState.trial_state
        };
        currentState = ownProfileEffectsState;
        rebuildGrants();
        equipped = api.normalizeEffectId(ownProfileEffectsState.equipped_effect);
        preview = equipped;
        currentProfile.equipped_profile_effect = equipped;
        syncAccountEffectsSummary();
        window.dispatchEvent?.(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
        toast(equipped === 'none'
          ? 'Effect removed from your profile.'
          : `${api.getEffect(equipped).name} equipped.`);
      } catch (error) {
        toast(friendlyError(error), 'error');
      } finally {
        syncGalleryUi();
      }
    });

    dialog.querySelector('#effects-theme-dock')?.addEventListener('click', async (event) => {
      const sw = event.target.closest('[data-t]');
      if (!sw) return;
      const nextTheme = sw.dataset.t;
      if (!cardThemes.includes(nextTheme)) return;
      cardTheme = nextTheme;
      previewCard.dataset.theme = nextTheme;
      dialog.querySelectorAll('#effects-theme-dock [data-t]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.t === nextTheme));
      });
      try {
        const updated = await rpc('update_own_profile_card', { p_theme: nextTheme });
        syncProfileCardEditor(updated);
        window.dispatchEvent?.(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
      } catch (error) {
        toast(friendlyError(error), 'error');
      }
    });

    const closeGallery = () => {
      offMotionListener?.();
      cardStage?.destroy?.();
      tileControllers.forEach((ctrl) => ctrl?.destroy?.());
      tileControllers.clear();
      try { document.getElementById('effects-trial-request-dialog')?.close?.(); } catch { }
      document.getElementById('effects-trial-request-dialog')?.remove?.();
      try { dialog.close(); } catch { }
      dialog.remove();
    };
    dialog.querySelector('#effects-gallery-close')?.addEventListener('click', closeGallery);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeGallery();
    });

    applyFilter();
    syncGalleryUi();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    requestAnimationFrame?.(() => {
      cardStage.refreshGeometry();
      tileControllers.forEach((ctrl) => ctrl.refreshGeometry());
    });
  }

  initVerifiedBadgeTooltip();

  function avatarMarkup(avatarUrl, name, className = '', userId = null) {
    const safeUrl = isSafeImageRef(avatarUrl) ? String(avatarUrl).trim() : '';
    const letters = escapeHtml(initials(name));
    const cls = escapeHtml(className);
    const circle = !safeUrl
      ? `<span class="avatar-circle avatar-fallback ${cls}" title="${escapeHtml(name || '')}">${letters}</span>`
      : `<span class="avatar-circle ${cls}" title="${escapeHtml(name || '')}"><img src="${safeUrl}" alt="${escapeHtml(name || 'User picture')}" data-avatar-img><span class="avatar-fallback-inner" hidden>${letters}</span></span>`;

    if (!userId) return circle;
    const isOnline = isUserOnline(userId);
    const label = isOnline ? 'Active now' : 'Offline';
    const wrapCls = String(className || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `${escapeHtml(token)}-wrap`)
      .join(' ');
    const presenceDot = `<span class="presence-dot${isOnline ? ' is-online' : ''}" data-presence-id="${escapeHtml(userId)}" aria-label="${label}" title="${label}"></span>`;
    return `<span class="avatar-presence-wrap${wrapCls ? ` ${wrapCls}` : ''}" data-presence-user="${escapeHtml(userId)}">${circle}${presenceDot}</span>`;
  }

  function bindAvatarFallbacks(root = document) {
    root.querySelectorAll('img[data-avatar-img]').forEach((img) => {
      if (img.dataset.boundFallback) return;
      img.dataset.boundFallback = 'true';
      img.addEventListener('error', () => {
        img.hidden = true;
        const fallback = img.nextElementSibling;
        if (fallback) fallback.hidden = false;
      });
    });
  }

  function syncProfileAvatars(profile = currentProfile, { persist = true } = {}) {
    if (!profile) return;
    const safeUrl = isSafeImageRef(profile.avatar_url) ? String(profile.avatar_url).trim() : '';
    if (persist && profile.id) {
      writeShellAvatar(profile.id, safeUrl);
      writeShellSnapshot({
        userId: profile.id,
        role: profile.role,
        fullName: profile.full_name
      });
    }
    document.querySelectorAll('.sidebar-user-avatar').forEach((slot) => {
      const parentWrap = slot.closest('.avatar-presence-wrap');
      const dot = parentWrap ? parentWrap.querySelector('.presence-dot') : null;
      if (dot && profile.id) {
        dot.dataset.presenceId = profile.id;
        dot.classList.add('is-online');
      }
      const existingImg = slot.querySelector('img[data-avatar-img]');
      if (safeUrl) {
        if (existingImg && existingImg.getAttribute('src') === safeUrl && !existingImg.hidden) {
          return;
        }
        slot.innerHTML = `<img src="${safeUrl}" alt="${escapeHtml(profile.full_name || 'Profile picture')}" data-avatar-img><svg viewBox="0 0 24 24" hidden><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>`;
        const img = slot.querySelector('img');
        img?.addEventListener('error', () => {
          img.hidden = true;
          const svg = img.nextElementSibling;
          if (svg) svg.removeAttribute('hidden');
        });
      } else if (existingImg || !slot.querySelector('svg')) {
        slot.innerHTML = DEFAULT_SIDEBAR_AVATAR_SVG;
      }
    });
    const quickPreview = document.getElementById('quick-avatar-preview');
    if (quickPreview) {
      quickPreview.innerHTML = avatarMarkup(profile.avatar_url, profile.full_name, 'avatar-lg');
      bindAvatarFallbacks(quickPreview);
    }
    const quickRemove = document.getElementById('quick-avatar-remove');
    if (quickRemove) quickRemove.hidden = !safeUrl;
  }

  const memberAvatarStore = new Map();

  function registerMemberAvatars(profilesOrMembers) {
    if (!Array.isArray(profilesOrMembers)) return;
    profilesOrMembers.forEach((item) => {
      if (!item) return;
      const url = item.avatar_url || null;
      if (item.id) memberAvatarStore.set(String(item.id), url);
      if (item.member_id) memberAvatarStore.set(String(item.member_id), url);
      if (item.full_name) memberAvatarStore.set(String(item.full_name).trim().toLowerCase(), url);
      if (item.user_id) memberAvatarStore.set(String(item.user_id), url);
      const userUid = item.user_id
        ? String(item.user_id).trim()
        : (item.id && (Object.prototype.hasOwnProperty.call(item, 'member_id') || Object.prototype.hasOwnProperty.call(item, 'role') || VERIFIED_BADGE_MAP.has(String(item.id))))
          ? String(item.id).trim()
          : '';
      if (userUid) {
        if (item.member_id) BADGE_USER_ALIAS_MAP.set(String(item.member_id), userUid);
        if (item.full_name) BADGE_USER_ALIAS_MAP.set(String(item.full_name).trim().toLowerCase(), userUid);
      }
    });
  }

  function getMemberAvatar(idOrName) {
    if (!idOrName) return null;
    const raw = String(idOrName).trim();
    const key = raw.toLowerCase();
    return memberAvatarStore.get(raw) || memberAvatarStore.get(key) || null;
  }

  function allMethodsIconHtml() {
    return '<span class="pm-icon is-all" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><rect x="2.5" y="2.5" width="6" height="6" rx="1.6" fill="#e8f3ec" stroke="#17543a" stroke-width="1.5"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.6" fill="#e8f3ec" stroke="#17543a" stroke-width="1.5"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.6" fill="#e8f3ec" stroke="#17543a" stroke-width="1.5"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.6" fill="#e8f3ec" stroke="#17543a" stroke-width="1.5"/></svg></span>';
  }

  function paymentSelectIconHtml(value, labelText = '') {
    const val = String(value || '').trim();
    if (!val && /^all\b/i.test(String(labelText || '').trim())) return allMethodsIconHtml();
    if (val === 'UNTAGGED') return paymentMethodIconHtml('');
    return paymentMethodIconHtml(val);
  }

  function mountCustomSelect(selectEl, {
    wrapClass = '',
    fallbackLabel = 'Select option',
    slotClass = 'custom-select-avatar-slot',
    triggerGraphicClass = 'custom-select-trigger-avatar',
    renderGraphic,
    afterRenderMenu = null
  } = {}) {
    if (!selectEl || selectEl.dataset.customEnhanced === 'true') {
      selectEl?._customSelect?.sync();
      return selectEl?._customSelect || null;
    }

    const parent = selectEl.parentNode;
    if (!parent || typeof document?.createElement !== 'function') return null;

    selectEl.dataset.customEnhanced = 'true';

    const wrap = document.createElement('div');
    wrap.className = ['custom-member-select-wrap', wrapClass].filter(Boolean).join(' ');

    parent.insertBefore(wrap, selectEl);
    wrap.appendChild(selectEl);
    selectEl.classList.add('custom-select-native');

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    trigger.innerHTML = `
      <div class="custom-select-selection">
        <span class="${escapeHtml(triggerGraphicClass)}"></span>
        <span class="custom-select-trigger-label">${escapeHtml(fallbackLabel)}</span>
        <span class="custom-select-badge" hidden></span>
      </div>
      <svg class="custom-select-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;

    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    wrap.appendChild(trigger);
    wrap.appendChild(menu);

    const triggerGraphic = trigger.querySelector(`.${triggerGraphicClass}`);
    const triggerLabel = trigger.querySelector('.custom-select-trigger-label');
    const triggerBadge = trigger.querySelector('.custom-select-badge');

    let isOpen = false;

    function openMenu() {
      if (selectEl.disabled) return;
      document.querySelectorAll('.custom-member-select-wrap.is-open').forEach((w) => {
        if (w !== wrap && w._customSelectClose) w._customSelectClose();
      });
      isOpen = true;
      wrap.classList.add('is-open');
      menu.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
    }

    function closeMenu() {
      if (!isOpen) return;
      isOpen = false;
      wrap.classList.remove('is-open');
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }

    wrap._customSelectClose = closeMenu;

    function syncTrigger() {
      trigger.disabled = Boolean(selectEl.disabled);
      const selectedIndex = selectEl.selectedIndex;
      const opt = selectedIndex >= 0 ? selectEl.options[selectedIndex] : null;
      const val = opt ? opt.value : '';
      const text = opt ? opt.textContent.trim() : fallbackLabel;
      const badge = opt?.dataset?.badge || '';
      const isPlaceholder = !val || (opt && opt.disabled);

      triggerLabel.textContent = text;
      triggerLabel.classList.toggle('is-placeholder', isPlaceholder);
      if (triggerBadge) {
        triggerBadge.textContent = badge;
        triggerBadge.hidden = !badge || isPlaceholder;
      }
      if (triggerGraphic) {
        triggerGraphic.innerHTML = renderGraphic({ opt, val, text, isPlaceholder, inTrigger: true });
        afterRenderMenu?.(triggerGraphic);
      }
    }

    function rebuildOptions() {
      menu.replaceChildren();
      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'custom-select-options';

      Array.from(selectEl.options).forEach((opt) => {
        const val = opt.value;
        const text = opt.textContent.trim();
        const badge = opt.dataset?.badge || '';
        const isPlaceholder = !val;
        const isSelected = opt.selected;

        const optEl = document.createElement('div');
        optEl.className = `custom-select-option${isSelected ? ' is-selected' : ''}${isPlaceholder ? ' is-placeholder' : ''}`;
        optEl.setAttribute('role', 'option');
        optEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        optEl.dataset.value = val;

        const graphicHtml = renderGraphic({ opt, val, text, isPlaceholder, inTrigger: false });

        optEl.innerHTML = `
          <div class="custom-select-option-main">
            <span class="${escapeHtml(slotClass)}">${graphicHtml}</span>
            <span class="custom-select-option-name">${escapeHtml(text)}</span>
            ${badge && !isPlaceholder ? `<span class="custom-select-badge">${escapeHtml(badge)}</span>` : ''}
          </div>
          ${isSelected && !isPlaceholder ? `
            <span class="custom-select-check" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4L16 6.5" stroke="#15803d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>` : ''}
        `;

        optEl.addEventListener('click', (e) => {
          e.stopPropagation();
          selectEl.value = val;
          closeMenu();
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          syncTrigger();
          rebuildOptions();
          const active = document.activeElement;
          if (!active || active === document.body || wrap.contains(active)) trigger.focus();
        });

        optionsContainer.appendChild(optEl);
      });

      menu.appendChild(optionsContainer);
      afterRenderMenu?.(menu);
      syncTrigger();
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isOpen) closeMenu();
      else openMenu();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
    });

    const boundLabel = selectEl.id && typeof document?.querySelector === 'function'
      ? document.querySelector(`label[for="${CSS?.escape ? CSS.escape(selectEl.id) : selectEl.id}"]`)
      : null;
    boundLabel?.addEventListener('click', (e) => {
      e.preventDefault();
      trigger.focus();
      openMenu();
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) closeMenu();
    });

    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeMenu();
        trigger.focus();
      }
    });

    selectEl.addEventListener('change', () => {
      trigger.classList.remove('has-error');
      syncTrigger();
      rebuildOptions();
    });

    selectEl.addEventListener('invalid', () => {
      trigger.classList.add('has-error');
    });

    selectEl.form?.addEventListener('reset', () => {
      setTimeout(() => {
        trigger.classList.remove('has-error');
        syncTrigger();
        rebuildOptions();
      }, 0);
    });

    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(() => { rebuildOptions(); })
      : null;
    observer?.observe(selectEl, { childList: true, subtree: true });

    rebuildOptions();

    const api = {
      wrap,
      sync: () => {
        rebuildOptions();
      },
      destroy: () => {
        observer?.disconnect();
        wrap.replaceWith(selectEl);
        selectEl.classList.remove('custom-select-native');
        delete selectEl.dataset.customEnhanced;
        delete selectEl._customSelect;
      }
    };

    selectEl._customSelect = api;
    return api;
  }

  function enhanceMemberSelect(selectEl) {
    const placeholderSvg = '<span class="custom-avatar-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg></span>';
    return mountCustomSelect(selectEl, {
      fallbackLabel: 'Select member',
      slotClass: 'custom-select-avatar-slot',
      triggerGraphicClass: 'custom-select-trigger-avatar',
      renderGraphic: ({ opt, val, text, isPlaceholder }) => {
        if (isPlaceholder) return placeholderSvg;
        const avatarUrl = opt?.dataset?.avatar || getMemberAvatar(val) || getMemberAvatar(text) || null;
        return avatarMarkup(avatarUrl, text, 'custom-select-avatar');
      },
      afterRenderMenu: (root) => {
        bindAvatarFallbacks(root);
        syncPresenceDots(root);
      }
    });
  }

  function enhancePaymentSelect(selectEl, { compact = false } = {}) {
    return mountCustomSelect(selectEl, {
      wrapClass: compact ? 'custom-payment-select-wrap is-compact' : 'custom-payment-select-wrap',
      fallbackLabel: 'Not set',
      slotClass: 'custom-select-icon-slot',
      triggerGraphicClass: 'custom-select-trigger-icon',
      renderGraphic: ({ val, text }) => paymentSelectIconHtml(val, text)
    });
  }

  /** Populate a group switcher `<select>` and enhance it with avatar and role badges. */
  function populateGroupSelect(selectEl, groups = [], selectedGroupId = '') {
    if (!selectEl) return null;
    const rows = Array.isArray(groups) ? groups : [];
    selectEl.replaceChildren(...rows.map((group) => {
      const opt = new Option(group.name || 'Savings Group', group.group_id);
      opt.dataset.avatar = group.avatar_url || '';
      opt.dataset.badge = group.workspace_mode === 'SOLO' ? 'SOLO' : (group.role || '');
      return opt;
    }));
    if (selectedGroupId) selectEl.value = selectedGroupId;
    return enhanceMemberSelect(selectEl);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`Unable to read ${file.name || 'image'}.`));
      reader.readAsDataURL(file);
    });
  }

  function compressRasterDataUrl(dataUrl, maxEdge = 1440, quality = 0.82) {
    return new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const longest = Math.max(image.naturalWidth || 0, image.naturalHeight || 0);
        if (!longest) return resolve(dataUrl);
        const scale = Math.min(1, maxEdge / longest);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) return resolve(dataUrl);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed && compressed.length < dataUrl.length ? compressed : dataUrl);
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  async function prepareImageDataUrl(file, { maxEdge = 2560, skipCompressBytes = MAX_AVATAR_BYTES, maxBytes = MAX_BUG_IMAGE_BYTES, maxDataUrlLength = Math.ceil((maxBytes * 4) / 3) + 256 } = {}) {
    const ext = (file.name || '').match(PICTURE_FILE_RE)?.[1]?.toLowerCase() || '';
    const isImage = file.type.startsWith('image/') || Boolean(ext);
    if (!isImage) throw new Error(`"${file.name}" is not a picture file.`);
    let dataUrl = await readFileAsDataUrl(file);
    const type = file.type.startsWith('image/') ? file.type : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    if (!dataUrl.startsWith('data:image/') && ext) {
      dataUrl = dataUrl.replace(/^data:[^;,]*/, `data:${type}`);
    }
    if (!dataUrl.startsWith('data:image/')) throw new Error(`"${file.name}" is not a valid picture format.`);
    if (!/^image\/(gif|svg\+xml)$/i.test(type)) {
      const passes = [[maxEdge, 0.94], [Math.min(maxEdge, 2048), 0.88], [1600, 0.8], [1280, 0.72]];
      for (let i = 0; i < passes.length; i += 1) {
        const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
        if (i === 0 && file.size <= skipCompressBytes && approxBytes <= maxBytes && dataUrl.length <= maxDataUrlLength) break;
        if (approxBytes <= maxBytes && dataUrl.length <= maxDataUrlLength && i > 0) break;
        const [edge, quality] = passes[i];
        dataUrl = await compressRasterDataUrl(dataUrl, edge, quality);
      }
    }
    const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
    if (approxBytes > maxBytes || dataUrl.length > maxDataUrlLength) {
      throw new Error(`"${file.name}" exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`);
    }
    return { name: String(file.name || 'picture').slice(0, 120), type, dataUrl };
  }

  function prepareBugImage(file) {
    return prepareImageDataUrl(file, { maxEdge: 2560, skipCompressBytes: MAX_BUG_IMAGE_BYTES, maxBytes: MAX_BUG_IMAGE_BYTES });
  }

  function prepareAvatarDataUrl(file) {
    return prepareImageDataUrl(file, { maxEdge: 2560, skipCompressBytes: MAX_AVATAR_BYTES, maxBytes: MAX_AVATAR_BYTES });
  }

  function bindUtilityDialogs() {
    const notifications = document.getElementById('notification-dialog');
    const donate = document.getElementById('donate-dialog');
    const featureDialog = document.getElementById('feature-request-dialog');
    const featureForm = document.getElementById('feature-request-form');
    const featureMessage = document.getElementById('feature-request-message');
    const featureSuccess = document.getElementById('feature-request-success');
    const featureSubmittedTitle = document.getElementById('feature-request-submitted-title');
    const bugDialog = document.getElementById('bug-report-dialog');
    const bugForm = document.getElementById('bug-report-form');
    const bugMessage = document.getElementById('bug-report-message');
    const bugSuccess = document.getElementById('bug-report-success');
    const bugSubmittedTitle = document.getElementById('bug-report-submitted-title');
    const bugImageInput = document.getElementById('bug-report-images');
    const bugImageCount = document.getElementById('bug-report-image-count');
    const bugPreviews = document.getElementById('bug-report-previews');
    let bugImages = [];
    const account = document.getElementById('account-dialog');
    const setFeedbackMessage = (target, text = '', tone = '') => {
      if (!target) return;
      target.textContent = text;
      if (tone) target.dataset.tone = tone;
      else delete target.dataset.tone;
    };
    const renderBugPreviews = () => {
      if (bugImageCount) bugImageCount.textContent = `${bugImages.length} of ${MAX_BUG_IMAGES} images selected. Any picture format is accepted.`;
      if (!bugPreviews) return;
      bugPreviews.hidden = !bugImages.length;
      bugPreviews.innerHTML = bugImages.map((item, index) => `
        <div class="bug-image-card">
          <img src="${item.dataUrl}" alt="${escapeHtml(item.name)}">
          <span class="bug-image-fallback" hidden>${escapeHtml(item.name)}</span>
          <button class="bug-image-remove" type="button" data-remove-bug-image="${index}" aria-label="Remove ${escapeHtml(item.name)}">&times;</button>
          <small>${escapeHtml(item.name)}</small>
        </div>`).join('');
      bugPreviews.querySelectorAll('img').forEach((img) => {
        img.onerror = () => {
          img.hidden = true;
          const fallback = img.nextElementSibling;
          if (fallback) fallback.hidden = false;
        };
      });
    };
    const resetFeatureDialog = () => {
      featureForm?.reset();
      if (featureForm?.elements.allow_credit) featureForm.elements.allow_credit.checked = true;
      setFeedbackMessage(featureMessage);
      if (featureForm) featureForm.hidden = false;
      if (featureSuccess) featureSuccess.hidden = true;
    };
    const resetBugDialog = () => {
      bugForm?.reset();
      bugImages = [];
      renderBugPreviews();
      setFeedbackMessage(bugMessage);
      if (bugForm) bugForm.hidden = false;
      if (bugSuccess) bugSuccess.hidden = true;
    };
    document.querySelectorAll('[data-notifications-open]').forEach((button) => button.onclick = () => {
      if (!notifications) return;
      if (notifications.open) return notifications.close();
      if (currentProfile?.notifications_enabled !== false && !localStorage.getItem('myipon_device_notif_prompted')) {
        localStorage.setItem('myipon_device_notif_prompted', '1');
        requestDeviceNotificationPermission({ userInitiated: true }).catch(() => { });
      }
      const compactHeader = window.matchMedia('(max-width:720px)').matches
        || (button.closest('.dashboard-sidebar') && window.matchMedia('(max-width:860px)').matches);
      if (compactHeader) {
        const headerBottom = button.closest('.app-sidebar')?.getBoundingClientRect().bottom || 68;
        notifications.style.setProperty('--notification-top', `${Math.round(headerBottom + 8)}px`);
      } else notifications.style.removeProperty('--notification-top');
      notifications.show();
    });
    document.querySelectorAll('[data-notifications-close]').forEach((button) => button.onclick = () => notifications?.close());
    document.querySelectorAll('[data-record-detail-close]').forEach((button) => button.onclick = () => document.getElementById('record-detail-dialog')?.close());
    document.querySelectorAll('[data-notice-detail-close]').forEach((button) => button.onclick = () => document.getElementById('notice-detail-dialog')?.close());
    const donateQr = document.getElementById('donate-qr-dialog');
    document.querySelectorAll('[data-donate-open]').forEach((button) => button.onclick = () => donate?.showModal());
    document.querySelectorAll('[data-donate-close]').forEach((button) => button.onclick = () => donate?.close());
    const openDonateQr = document.getElementById('open-donate-qr');
    if (openDonateQr) openDonateQr.onclick = () => donateQr?.showModal();
    document.querySelectorAll('[data-donate-qr-close]').forEach((button) => button.onclick = () => donateQr?.close());
    document.querySelectorAll('[data-feature-request-open]').forEach((button) => button.onclick = () => { resetFeatureDialog(); featureDialog?.showModal(); featureForm?.elements.title.focus(); });
    document.querySelectorAll('[data-feature-request-close]').forEach((button) => button.onclick = () => featureDialog?.close());
    const anotherFeature = document.getElementById('feature-request-another');
    if (anotherFeature) anotherFeature.onclick = () => { resetFeatureDialog(); featureForm?.elements.title.focus(); };
    document.querySelectorAll('[data-bug-report-open]').forEach((button) => button.onclick = () => { resetBugDialog(); bugDialog?.showModal(); bugForm?.elements.title.focus(); });
    document.querySelectorAll('[data-bug-report-close]').forEach((button) => button.onclick = () => bugDialog?.close());
    const anotherBug = document.getElementById('bug-report-another');
    if (anotherBug) anotherBug.onclick = () => { resetBugDialog(); bugForm?.elements.title.focus(); };
    if (document.body?.dataset && !document.body.dataset.retentionRulesBound) {
      document.body.dataset.retentionRulesBound = '1';
      document.addEventListener?.('click', (event) => {
        if (event.target?.closest?.('[data-workspace-settings-open]')) {
          document.getElementById('account-dialog')?.close?.();
          return;
        }
        const subviewBack = event.target?.closest?.('[data-subview-back]');
        if (subviewBack) {
          try {
            if (window.history.length > 1 && document.referrer) {
              const refUrl = new URL(document.referrer);
              if (refUrl.origin === window.location.origin && refUrl.pathname !== window.location.pathname && !/(?:^\/$|\/(?:index|login|mfa|reset-password)\.html$)/i.test(refUrl.pathname)) {
                event.preventDefault();
                window.history.back();
              }
            }
          } catch {}
          return;
        }
        if (event.target?.closest?.('[data-retention-rules-open]')) {
          event.preventDefault();
          openRetentionPolicyDialog();
          return;
        }
        const claimBadgeBtn = event.target?.closest?.('[data-claim-pending-badge]');
        if (claimBadgeBtn) {
          event.preventDefault();
          const quickDlg = document.getElementById('account-dialog');
          if (quickDlg?.open) quickDlg.close();
          maybeShowBadgeAwardModal(currentProfile, { force: true });
          return;
        }
        const messageCreatorBtn = event.target?.closest?.('[data-message-creator-badge]');
        if (messageCreatorBtn) {
          event.preventDefault();
          openCreatorBadgeChat(messageCreatorBtn);
          return;
        }
        const policyTrigger = event.target?.closest?.('[data-policy-open-inapp]');
        if (policyTrigger) {
          event.preventDefault();
          openPolicyDialog(policyTrigger.dataset?.policyOpenInapp || 'terms');
        }
      });
    }
    if (bugImageInput) bugImageInput.onchange = async () => {
      const files = Array.from(bugImageInput.files || []);
      bugImageInput.value = '';
      if (!files.length) return;
      setFeedbackMessage(bugMessage);
      const remaining = MAX_BUG_IMAGES - bugImages.length;
      if (remaining <= 0) {
        const message = `You can upload up to ${MAX_BUG_IMAGES} images per report.`;
        setFeedbackMessage(bugMessage, message, 'error');
        return toast(message, 'error');
      }
      if (files.length > remaining) {
        const message = `Only ${remaining} more image${remaining === 1 ? '' : 's'} can be added (maximum ${MAX_BUG_IMAGES}).`;
        setFeedbackMessage(bugMessage, message, 'error');
        toast(message, 'error');
      }
      for (const file of files.slice(0, remaining)) {
        try {
          bugImages.push(await prepareBugImage(file));
        } catch (error) {
          const message = friendlyError(error);
          setFeedbackMessage(bugMessage, message, 'error');
          toast(message, 'error');
        }
      }
      renderBugPreviews();
    };
    if (bugPreviews) bugPreviews.onclick = (event) => {
      const removeButton = event.target.closest('[data-remove-bug-image]');
      if (!removeButton) return;
      bugImages.splice(Number(removeButton.dataset.removeBugImage), 1);
      setFeedbackMessage(bugMessage);
      renderBugPreviews();
    };
    document.querySelectorAll('[data-account-open]').forEach((button) => button.onclick = openAccountDialog);
    document.querySelectorAll('[data-account-close]').forEach((button) => button.onclick = () => account?.close());
    document.querySelectorAll('[data-sign-out]').forEach((button) => button.onclick = signOut);
    if (notifications && !notifications.dataset.bound) {
      notifications.dataset.bound = 'true';
      document.addEventListener('pointerdown', (event) => {
        if (notifications.open && !notifications.contains(event.target) && !event.target.closest('[data-notifications-open]')) notifications.close();
      });
      document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && notifications.open) notifications.close(); });
      window.addEventListener('resize', () => { if (notifications.open) notifications.close(); });
    }
    const copy = document.getElementById('copy-donate-number');
    if (copy) copy.onclick = async () => {
      try { await navigator.clipboard.writeText('09913564248'); toast('GCash number copied.'); }
      catch { toast('Copy 09913564248 manually.', 'error'); }
    };
    if (featureForm) featureForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!featureForm.reportValidity()) return;
      const button = event.submitter;
      const values = new FormData(featureForm);
      const title = String(values.get('title') || '').trim();
      const details = String(values.get('details') || '').trim();
      setFeedbackMessage(featureMessage);
      if (title.length < 3 || title.length > 120) {
        const msg = 'Feature name must be between 3 and 120 characters.';
        setFeedbackMessage(featureMessage, msg, 'error');
        featureForm.elements.title?.focus();
        return;
      }
      if (details.length < 10 || details.length > 2000) {
        const msg = 'Feature description must be between 10 and 2000 characters.';
        setFeedbackMessage(featureMessage, msg, 'error');
        featureForm.elements.details?.focus();
        return;
      }
      if (!currentProfile?.id) {
        const { data: authData } = await getClient().auth.getUser().catch(() => ({ data: {} }));
        if (authData?.user?.id) currentProfile = { ...(currentProfile || {}), id: authData.user.id };
      }
      if (!currentProfile?.id) {
        const msg = 'Your session is still loading. Please try again.';
        setFeedbackMessage(featureMessage, msg, 'error');
        return;
      }
      const accepted = await confirmAction({
        title: 'Submit feature request?',
        message: `Send "${title}" to the Super Admin for review?`,
        acceptLabel: 'Submit request'
      });
      if (!accepted) return;
      setBusy(button, true, 'Submitting…');
      try {
        const allowCredit = Boolean(featureForm.elements.allow_credit?.checked);
        const { error } = await getClient().from('feature_requests').insert({ requester_id: currentProfile.id, title: values.get('title').trim(), details, allow_credit: allowCredit });
        if (error) throw error;
        if (featureSubmittedTitle) featureSubmittedTitle.textContent = `"${title}"`;
        featureForm.hidden = true;
        if (featureSuccess) featureSuccess.hidden = false;
        featureSuccess?.querySelector('[data-feature-request-close]')?.focus();
        toast('Feature request submitted.');
      } catch (error) {
        const message = friendlyError(error);
        setFeedbackMessage(featureMessage, message, 'error');
        toast(message, 'error');
      } finally {
        setBusy(button, false);
      }
    };
    if (bugForm) bugForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!bugForm.reportValidity()) return;
      const button = event.submitter;
      const values = new FormData(bugForm);
      const title = String(values.get('title') || '').trim();
      const description = String(values.get('description') || '').trim();
      setFeedbackMessage(bugMessage);
      if (title.length < 3 || title.length > 120) {
        const msg = 'Bug title must be between 3 and 120 characters.';
        setFeedbackMessage(bugMessage, msg, 'error');
        bugForm.elements.title?.focus();
        return;
      }
      if (description.length < 10 || description.length > 2000) {
        const msg = 'Bug description must be between 10 and 2000 characters.';
        setFeedbackMessage(bugMessage, msg, 'error');
        bugForm.elements.description?.focus();
        return;
      }
      if (!currentProfile?.id) {
        const { data: authData } = await getClient().auth.getUser().catch(() => ({ data: {} }));
        if (authData?.user?.id) currentProfile = { ...(currentProfile || {}), id: authData.user.id };
      }
      if (!currentProfile?.id) {
        const msg = 'Your session is still loading. Please try again.';
        setFeedbackMessage(bugMessage, msg, 'error');
        return;
      }
      const accepted = await confirmAction({
        title: 'Submit bug report?',
        message: `Send "${title}"${bugImages.length ? ` with ${bugImages.length} attached picture${bugImages.length === 1 ? '' : 's'}` : ''} to the Super Admin?`,
        acceptLabel: 'Submit report'
      });
      if (!accepted) return;
      setBusy(button, true, 'Submitting…');
      try {
        if (bugImages.length) {
          bugImages = await Promise.all(bugImages.map(async (item) => {
            const url = item?.dataUrl ? await uploadMediaDataUrl(item.dataUrl, { category: 'bug-reports', name: item.name || 'bug.jpg' }) : item?.url;
            return { name: item.name || 'picture', type: item.type || 'image/jpeg', url };
          }));
        }
        const { error } = await getClient().from('bug_reports').insert({ reporter_id: currentProfile.id, title, description, attachments: bugImages });
        if (error) throw error;
        if (bugSubmittedTitle) bugSubmittedTitle.textContent = `"${title}"`;
        bugForm.hidden = true;
        if (bugSuccess) bugSuccess.hidden = false;
        bugSuccess?.querySelector('[data-bug-report-close]')?.focus();
        toast('Bug report submitted.');
      } catch (error) {
        const message = friendlyError(error);
        setFeedbackMessage(bugMessage, message, 'error');
        toast(message, 'error');
      } finally {
        setBusy(button, false);
      }
    };
    if (featureDialog && featureForm) featureDialog.onclose = resetFeatureDialog;
    if (bugDialog && bugForm) bugDialog.onclose = resetBugDialog;
  }

  async function loadAccountDialog() {
    const client = getClient();
    if (!client || !currentProfile) return;
    const dialog = document.getElementById('account-dialog');
    const profileForm = document.getElementById('quick-profile-form');
    const emailForm = document.getElementById('quick-email-form');
    dialog.setAttribute('aria-busy', 'true');
    try {
      const { data, error } = await client.from('profiles').select('first_name,middle_name,last_name,full_name,email,contact_number,notifications_enabled,avatar_url,member_id,payout_channel,payout_account_number,payout_account_name,name_setup_required,verified_badge_tier,verified_badge_granted_at,verified_badge_expires_at,verified_badge_acknowledged_at,verified_badge_message,username,bio,last_seen_at,social_links').eq('id', currentProfile.id).single();
      if (error) throw error;
      let payoutSource = data;
      if (!data.payout_channel && (data.member_id || currentProfile.member_id)) {
        const linkedMemberId = data.member_id || currentProfile.member_id;
        const { data: memberRow } = await client.from('members').select('payout_channel,payout_account_number,payout_account_name').eq('id', linkedMemberId).maybeSingle();
        if (memberRow?.payout_channel) payoutSource = memberRow;
      }
      currentProfile.avatar_url = data.avatar_url || null;
      syncProfileNameMode(profileForm, currentProfile.role === 'SUPER_ADMIN');
      const splitLegacy = !data.first_name && !data.last_name ? String(data.full_name || '').trim().split(/\s+/).filter(Boolean) : [];
      profileForm.elements.first_name.value = data.first_name || splitLegacy[0] || '';
      profileForm.elements.middle_name.value = data.middle_name || '';
      profileForm.elements.last_name.value = data.last_name || (splitLegacy.length > 1 ? splitLegacy.slice(1).join(' ') : '');
      const uVal = String(data.username || '').trim().toLowerCase();
      const bVal = String(data.bio || '');
      if (profileForm.elements.username) {
        profileForm.elements.username.value = uVal;
        profileForm.elements.username.setCustomValidity('');
        setFieldError(profileForm.elements.username, '');
        const uHelp = document.getElementById('quick-username-help');
        if (uHelp) uHelp.hidden = false;
      }
      if (profileForm.elements.bio) {
        profileForm.elements.bio.value = bVal;
        profileForm.elements.bio.setCustomValidity('');
        setFieldError(profileForm.elements.bio, '');
        const bioCount = document.getElementById('quick-bio-count');
        if (bioCount) bioCount.textContent = `${bVal.length} / 58 characters`;
      }
      profileForm.elements.contact_number.value = data.contact_number || '';
      setPayoutFields(profileForm, payoutSource);
      emailForm.elements.email.value = data.email || '';
      if (currentProfile) currentProfile.notifications_enabled = data.notifications_enabled !== false;
      document.getElementById('quick-notifications-enabled').checked = data.notifications_enabled !== false;
      Object.assign(currentProfile, {
        full_name: data.full_name,
        email: data.email || currentProfile.email,
        verified_badge_tier: data.verified_badge_tier,
        verified_badge_granted_at: data.verified_badge_granted_at,
        verified_badge_expires_at: data.verified_badge_expires_at,
        verified_badge_acknowledged_at: data.verified_badge_acknowledged_at,
        verified_badge_message: data.verified_badge_message,
        username: data.username ?? currentProfile.username,
        bio: data.bio ?? currentProfile.bio,
        last_seen_at: data.last_seen_at,
        social_links: sanitizeSocialLinks(data.social_links)
      });
      await resolveCreatorSocialId().catch(() => null);
      syncAccountBadgeSection(currentProfile);
      syncConnectAppsForm(currentProfile.social_links);
      document.getElementById('quick-account-role').textContent = currentProfile.role === 'SUPER_ADMIN' ? 'Owner' : (data.email || 'My account');
      syncProfileAvatars({ ...currentProfile, ...data });
      const [appearance] = await Promise.all([
        rpc('get_profile_card_appearance', { p_target_id: currentProfile.id }).catch(() => null),
        refreshProfileEffectsState({ checkModal: false }).catch(() => null)
      ]);
      syncProfileCardEditor(appearance);
      const support = dialog.querySelector('.account-support');
      if (support) support.hidden = currentProfile.role === 'SUPER_ADMIN';
      quickProfileDirty?.reset();
      quickEmailDirty?.reset();
      quickConnectAppsDirty?.reset();
    } finally {
      dialog.removeAttribute('aria-busy');
    }
  }

  async function openAccountDialog() {
    const dialog = document.getElementById('account-dialog');
    if (!dialog || !currentProfile) return;
    bindDeviceNotificationControls();
    dialog.showModal();
    try { await Promise.all([loadAccountDialog(), quickMfaController?.load(), syncDevicePermissionUI()]); }
    catch (error) { toast(friendlyError(error), 'error'); }
  }

  function openAvatarCropper(file, {
    mode = 'avatar',
    title = 'Crop display picture',
    subtitle = 'Drag to reposition or adjust zoom to frame your profile picture.',
    saveLabel = 'Save display picture',
    category = 'avatars',
    maxBytes = MAX_AVATAR_BYTES,
    onSave
  } = {}) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('avatar-crop-dialog');
      const canvas = document.getElementById('avatar-crop-canvas');
      const titleEl = document.getElementById('avatar-crop-title');
      const subtitleEl = document.getElementById('avatar-crop-subtitle');
      const zoomInput = document.getElementById('avatar-crop-zoom');
      const previewThumb = document.getElementById('avatar-crop-preview-thumb');
      const rotateBtn = document.getElementById('avatar-crop-rotate');
      const saveBtn = document.getElementById('avatar-crop-save');
      const cancelBtn = document.getElementById('avatar-crop-cancel');
      const closeBtn = document.getElementById('avatar-crop-close');
      const viewport = dialog?.querySelector('.avatar-crop-viewport-wrap');

      if (!dialog || !canvas || !viewport) return resolve(null);

      if (file instanceof File && !file.type.startsWith('image/') && !PICTURE_FILE_RE.test(file.name || '')) {
        toast('Please choose a valid picture file.', 'error');
        return resolve(null);
      }

      const isCover = mode === 'cover';
      const VIEW_W = isCover ? 360 : 280;
      const VIEW_H = isCover ? 220 : 280;
      const CROP_X = isCover ? 12 : 15;
      const CROP_Y = isCover ? 54 : 15;
      const CROP_W = isCover ? 336 : 250;
      const CROP_H = isCover ? 112 : 250;
      const CENTER_X = VIEW_W / 2;
      const CENTER_Y = VIEW_H / 2;
      const THUMB_W = isCover ? 84 : 44;
      const THUMB_H = isCover ? 28 : 44;
      const THUMB_RADIUS = isCover ? '6px' : '50%';
      const maxUploadBytes = Number(maxBytes) > 0 ? Number(maxBytes) : MAX_AVATAR_BYTES;

      dialog.classList.toggle('is-cover', isCover);
      canvas.width = VIEW_W;
      canvas.height = VIEW_H;
      if (titleEl) titleEl.textContent = title;
      if (subtitleEl) subtitleEl.textContent = subtitle;
      if (saveBtn) saveBtn.textContent = saveLabel;
      if (previewThumb) {
        previewThumb.classList.toggle('is-cover', isCover);
        previewThumb.innerHTML = `<canvas width="${THUMB_W}" height="${THUMB_H}" style="display:block;width:${THUMB_W}px;height:${THUMB_H}px;border-radius:${THUMB_RADIUS};"></canvas>`;
      }
      const thumbCanvas = previewThumb?.querySelector('canvas');
      const thumbCtx = thumbCanvas?.getContext('2d');
      const ctx = canvas.getContext('2d');

      const isBlob = typeof Blob !== 'undefined' && file instanceof Blob;
      const objectUrl = isBlob ? URL.createObjectURL(file) : String(file);
      const img = new Image();

      let minScale = 1;
      let zoom = 1;
      let scale = 1;
      let rotation = 0;
      let imgW = 0;
      let imgH = 0;
      let offsetX = 0;
      let offsetY = 0;
      let isDragging = false;
      let activePointerId = null;
      let startPointerX = 0;
      let startPointerY = 0;
      let startOffsetX = 0;
      let startOffsetY = 0;

      function getEffectiveDimensions() {
        const isRotated = rotation === 90 || rotation === 270;
        return {
          w: isRotated ? img.naturalHeight : img.naturalWidth,
          h: isRotated ? img.naturalWidth : img.naturalHeight
        };
      }

      function updateScaleAndDimensions() {
        const eff = getEffectiveDimensions();
        minScale = Math.max(CROP_W / eff.w, CROP_H / eff.h);
        scale = minScale * zoom;
        imgW = Math.max(CROP_W, Math.round(eff.w * scale));
        imgH = Math.max(CROP_H, Math.round(eff.h * scale));
      }

      function clampOffsets() {
        const minX = (CROP_X + CROP_W) - imgW;
        const maxX = CROP_X;
        const minY = (CROP_Y + CROP_H) - imgH;
        const maxY = CROP_Y;
        offsetX = Math.min(maxX, Math.max(minX, offsetX));
        offsetY = Math.min(maxY, Math.max(minY, offsetY));
      }

      function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = offsetX + imgW / 2;
        const cy = offsetY + imgH / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((rotation * Math.PI) / 180);
        const naturalW = img.naturalWidth * scale;
        const naturalH = img.naturalHeight * scale;
        ctx.drawImage(img, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
        ctx.restore();
        if (thumbCtx) {
          thumbCtx.clearRect(0, 0, THUMB_W, THUMB_H);
          thumbCtx.drawImage(canvas, CROP_X, CROP_Y, CROP_W, CROP_H, 0, 0, THUMB_W, THUMB_H);
        }
      }

      function applyZoom(newZoom) {
        newZoom = Math.min(3, Math.max(1, newZoom));
        const px = CENTER_X - offsetX;
        const py = CENTER_Y - offsetY;
        const prevScale = scale;
        zoom = newZoom;
        updateScaleAndDimensions();
        const ratio = scale / prevScale;
        offsetX = CENTER_X - px * ratio;
        offsetY = CENTER_Y - py * ratio;
        clampOffsets();
        if (zoomInput) zoomInput.value = String(zoom);
        draw();
      }

      const onRotate = () => {
        rotation = (rotation + 90) % 360;
        updateScaleAndDimensions();
        offsetX = CENTER_X - imgW / 2;
        offsetY = CENTER_Y - imgH / 2;
        clampOffsets();
        draw();
      };

      const onPointerDown = (e) => {
        if (e.button !== 0 || e.isPrimary === false) return;
        isDragging = true;
        activePointerId = e.pointerId;
        try { viewport.setPointerCapture(e.pointerId); } catch { }
        startPointerX = e.clientX;
        startPointerY = e.clientY;
        startOffsetX = offsetX;
        startOffsetY = offsetY;
      };

      const onPointerMove = (e) => {
        if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        const pointerScale = VIEW_W / Math.max(1, viewport.clientWidth || VIEW_W);
        offsetX = startOffsetX + (e.clientX - startPointerX) * pointerScale;
        offsetY = startOffsetY + (e.clientY - startPointerY) * pointerScale;
        clampOffsets();
        draw();
      };

      const onPointerUp = (e) => {
        if (!isDragging || (activePointerId !== null && e.pointerId !== activePointerId)) return;
        isDragging = false;
        activePointerId = null;
        try { viewport.releasePointerCapture(e.pointerId); } catch { }
      };

      const onWheel = (e) => {
        e.preventDefault();
        const delta = -Math.sign(e.deltaY) * 0.1;
        applyZoom(zoom + delta);
      };

      const onZoomInput = () => {
        applyZoom(Number(zoomInput.value));
      };

      function cleanup() {
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup', onPointerUp);
        viewport.removeEventListener('pointercancel', onPointerUp);
        viewport.removeEventListener('wheel', onWheel);
        zoomInput?.removeEventListener('input', onZoomInput);
        rotateBtn?.removeEventListener('click', onRotate);
        cancelBtn?.removeEventListener('click', onCancel);
        closeBtn?.removeEventListener('click', onCancel);
        saveBtn?.removeEventListener('click', onSaveClick);
        dialog.removeEventListener('cancel', onDialogCancel);
        dialog.removeEventListener('click', onBackdropClick);
        if (isBlob) URL.revokeObjectURL(objectUrl);
        dialog.classList.remove('is-cover');
        canvas.width = 280;
        canvas.height = 280;
        if (titleEl) titleEl.textContent = 'Crop display picture';
        if (subtitleEl) subtitleEl.textContent = 'Drag to reposition or adjust zoom to frame your profile picture.';
        if (saveBtn) saveBtn.textContent = 'Save display picture';
        if (previewThumb) {
          previewThumb.classList.remove('is-cover');
          previewThumb.innerHTML = '';
        }
      }

      function onCancel() {
        if (dialog.open) dialog.close();
        cleanup();
        resolve(null);
      }

      function onDialogCancel(e) {
        e.preventDefault();
        onCancel();
      }

      function onBackdropClick(e) {
        if (e.target === dialog) onCancel();
      }

      async function onSaveClick() {
        setBusy(saveBtn, true, 'Saving…');
        try {
          const srcType = file instanceof File ? String(file.type || '').toLowerCase() : '';
          const fileBase = isCover ? 'cover' : 'avatar';
          const targetAspect = CROP_W / CROP_H;
          const isUneditedExact = file instanceof File
            && file.size <= maxUploadBytes
            && /^image\/(png|jpeg|webp|gif)$/i.test(srcType)
            && (!isCover || srcType !== 'image/gif')
            && rotation === 0
            && zoom === 1
            && img.naturalWidth > 0
            && img.naturalHeight > 0
            && Math.abs((img.naturalWidth / img.naturalHeight) - targetAspect) < 0.005
            && Math.abs(offsetX - (CENTER_X - imgW / 2)) < 1
            && Math.abs(offsetY - (CENTER_Y - imgH / 2)) < 1;

          let croppedDataUrl = '';
          let uploadName = `${fileBase}.jpg`;
          if (isUneditedExact) {
            croppedDataUrl = await readFileAsDataUrl(file);
            uploadName = srcType === 'image/png' ? `${fileBase}.png`
              : srcType === 'image/webp' ? `${fileBase}.webp`
              : srcType === 'image/gif' ? `${fileBase}.gif`
              : `${fileBase}.jpg`;
          } else {
            const exportCanvas = document.createElement('canvas');
            const nativeCropEdge = Math.max(1, Math.round(CROP_H / scale));
            const exportH = isCover
              ? Math.min(800, nativeCropEdge)
              : Math.min(2400, nativeCropEdge);
            const exportW = isCover ? exportH * 3 : exportH;
            exportCanvas.width = exportW;
            exportCanvas.height = exportH;
            const exportCtx = exportCanvas.getContext('2d');
            if (!exportCtx) return onCancel();
            exportCtx.imageSmoothingEnabled = true;
            exportCtx.imageSmoothingQuality = 'high';
            if (srcType !== 'image/png' && srcType !== 'image/webp') {
              exportCtx.fillStyle = '#ffffff';
              exportCtx.fillRect(0, 0, exportW, exportH);
            }
            const outScale = exportW / CROP_W;
            const cx = (offsetX + imgW / 2 - CROP_X) * outScale;
            const cy = (offsetY + imgH / 2 - CROP_Y) * outScale;
            exportCtx.save();
            exportCtx.translate(cx, cy);
            exportCtx.rotate((rotation * Math.PI) / 180);
            const drawW = img.naturalWidth * scale * outScale;
            const drawH = img.naturalHeight * scale * outScale;
            exportCtx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            exportCtx.restore();

            if (srcType === 'image/png') {
              croppedDataUrl = exportCanvas.toDataURL('image/png');
              uploadName = `${fileBase}.png`;
              if (Math.ceil((croppedDataUrl.length * 3) / 4) > maxUploadBytes) {
                croppedDataUrl = exportCanvas.toDataURL('image/webp', 0.94);
                uploadName = `${fileBase}.webp`;
              }
            } else if (srcType === 'image/webp') {
              croppedDataUrl = exportCanvas.toDataURL('image/webp', 0.96);
              uploadName = `${fileBase}.webp`;
            } else {
              croppedDataUrl = exportCanvas.toDataURL('image/jpeg', 0.96);
              uploadName = `${fileBase}.jpg`;
            }
            if (Math.ceil((croppedDataUrl.length * 3) / 4) > maxUploadBytes) {
              croppedDataUrl = exportCanvas.toDataURL('image/jpeg', 0.88);
              uploadName = `${fileBase}.jpg`;
            }
            if (Math.ceil((croppedDataUrl.length * 3) / 4) > maxUploadBytes) {
              croppedDataUrl = exportCanvas.toDataURL('image/jpeg', 0.76);
              uploadName = `${fileBase}.jpg`;
            }
          }

          const uploadedUrl = await uploadMediaDataUrl(croppedDataUrl, { category, name: uploadName });
          if (typeof onSave === 'function') {
            await onSave(uploadedUrl);
          } else {
            await rpc('update_own_avatar', { p_avatar_url: uploadedUrl });
            currentProfile.avatar_url = uploadedUrl;
            syncProfileAvatars(currentProfile);
            window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
            toast('Profile picture updated.');
          }
          if (dialog.open) dialog.close();
          cleanup();
          resolve(uploadedUrl);
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          setBusy(saveBtn, false);
        }
      }

      img.onload = () => {
        rotation = 0;
        zoom = 1;
        updateScaleAndDimensions();
        offsetX = CENTER_X - imgW / 2;
        offsetY = CENTER_Y - imgH / 2;
        clampOffsets();

        if (zoomInput) {
          zoomInput.value = '1';
          zoomInput.addEventListener('input', onZoomInput);
        }
        viewport.addEventListener('pointerdown', onPointerDown);
        viewport.addEventListener('pointermove', onPointerMove);
        viewport.addEventListener('pointerup', onPointerUp);
        viewport.addEventListener('pointercancel', onPointerUp);
        viewport.addEventListener('wheel', onWheel, { passive: false });
        rotateBtn?.addEventListener('click', onRotate);
        cancelBtn?.addEventListener('click', onCancel);
        closeBtn?.addEventListener('click', onCancel);
        saveBtn?.addEventListener('click', onSaveClick);
        dialog.addEventListener('cancel', onDialogCancel);
        dialog.addEventListener('click', onBackdropClick);

        draw();
        dialog.showModal();
      };

      img.onerror = () => {
        cleanup();
        toast('Unable to open image for cropping.', 'error');
        resolve(null);
      };

      img.src = objectUrl;
    });
  }

  let quickProfileDirty = null;
  let quickEmailDirty = null;
  let quickConnectAppsDirty = null;
  let modalAppsOrder = SOCIAL_APPS.map((app) => app.key);

  function readConnectAppsDraft(form) {
    const raw = {};
    if (!form) return raw;
    for (const app of SOCIAL_APPS) {
      const input = form.elements[app.key];
      const url = normalizeSocialAppUrl(app.key, input?.value);
      if (url) raw[app.key] = url;
    }
    raw._order = modalAppsOrder;
    return sanitizeSocialLinks(raw);
  }

  function moveModalAppRelative(dragKey, targetKey, placeAfter) {
    const prev = normalizeSocialAppOrder(modalAppsOrder);
    const next = reorderSocialAppKeys(prev, dragKey, targetKey, placeAfter);
    if (!next.some((k, i) => k !== prev[i])) return false;
    modalAppsOrder = next;
    return true;
  }

  function bindConnectAppsPreviewDrag(modalPreview) {
    if (!modalPreview || modalPreview.dataset.dragBound) return;
    modalPreview.dataset.dragBound = 'true';

    modalPreview.addEventListener('keydown', (event) => {
      const tile = event.target?.closest?.('[data-drag-app]');
      if (!tile) return;
      const key = tile.dataset.dragApp;
      const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
      const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
      if (!forward && !backward) return;
      const tiles = Array.from(modalPreview.querySelectorAll('[data-drag-app]'));
      const idx = tiles.indexOf(tile);
      const nextIdx = forward ? idx + 1 : idx - 1;
      if (nextIdx < 0 || nextIdx >= tiles.length) return;
      event.preventDefault();
      const targetKey = tiles[nextIdx].dataset.dragApp;
      if (!moveModalAppRelative(key, targetKey, forward)) return;
      syncConnectAppsPreview(null, { modalOnly: true });
      quickConnectAppsDirty?.sync?.();
      modalPreview.querySelector(`[data-drag-app="${key}"]`)?.focus();
    });

    modalPreview.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const tile = event.target?.closest?.('[data-drag-app]');
      const strip = tile?.closest?.('.social-apps-strip');
      if (!tile || !strip) return;
      if (strip.querySelectorAll('[data-drag-app]').length < 2) return;
      event.preventDefault();

      const dragKey = tile.dataset.dragApp;
      const startX = event.clientX;
      const startY = event.clientY;
      const initRect = tile.getBoundingClientRect();
      const grabOffsetX = startX - initRect.left;
      const grabOffsetY = startY - initRect.top;
      let baseLeft = initRect.left;
      let baseTop = initRect.top;
      let activated = false;

      const onMove = (moveEv) => {
        const dx = moveEv.clientX - startX;
        const dy = moveEv.clientY - startY;
        if (!activated && Math.hypot(dx, dy) < 4) return;
        if (!activated) {
          activated = true;
          tile.classList.add('is-dragging');
        }
        const siblings = Array.from(strip.querySelectorAll('[data-drag-app]'));
        const dragIdx = siblings.indexOf(tile);
        const centerX = moveEv.clientX - grabOffsetX + initRect.width / 2;
        const centerY = moveEv.clientY - grabOffsetY + initRect.height / 2;
        let destIdx = -1;
        let placeAfter = false;

        const entries = siblings.map((el, idx) => ({ el, idx, r: el.getBoundingClientRect() }));
        let nearestMidY = entries[0].r.top + entries[0].r.height / 2;
        let bestRowDist = Infinity;
        for (const item of entries) {
          const dist = Math.abs(centerY - (item.r.top + item.r.height / 2));
          if (dist < bestRowDist) {
            bestRowDist = dist;
            nearestMidY = item.r.top + item.r.height / 2;
          }
        }
        const rowItems = entries.filter((item) => Math.abs((item.r.top + item.r.height / 2) - nearestMidY) <= item.r.height * 0.6);
        for (const item of rowItems) {
          if (item.el === tile) continue;
          const midX = item.r.left + item.r.width / 2;
          if (item.idx > dragIdx && centerX > midX) {
            destIdx = item.idx;
            placeAfter = true;
          } else if (item.idx < dragIdx && centerX < midX && (destIdx < 0 || item.idx < destIdx)) {
            destIdx = item.idx;
            placeAfter = false;
          }
        }
        if (destIdx < 0 && rowItems.length) {
          const first = rowItems[0];
          const last = rowItems[rowItems.length - 1];
          if (first.idx > dragIdx && centerX <= first.r.left + first.r.width / 2) {
            destIdx = first.idx;
            placeAfter = false;
          } else if (last.idx < dragIdx && centerX >= last.r.left + last.r.width / 2) {
            destIdx = last.idx;
            placeAfter = true;
          }
        }

        if (destIdx >= 0 && siblings[destIdx]) {
          const targetTile = siblings[destIdx];
          const targetKey = targetTile.dataset.dragApp;
          if (moveModalAppRelative(dragKey, targetKey, placeAfter)) {
            tile.style.transform = '';
            strip.insertBefore(tile, placeAfter ? targetTile.nextSibling : targetTile);
            const nextRect = tile.getBoundingClientRect();
            baseLeft = nextRect.left;
            baseTop = nextRect.top;
            quickConnectAppsDirty?.sync?.();
          }
        }

        const tx = (moveEv.clientX - grabOffsetX) - baseLeft;
        const ty = (moveEv.clientY - grabOffsetY) - baseTop;
        tile.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      };

      const finishDrag = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', finishDrag);
        window.removeEventListener('pointercancel', finishDrag);
        tile.classList.remove('is-dragging');
        tile.style.transform = '';
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', finishDrag);
      window.addEventListener('pointercancel', finishDrag);
    });
  }

  function syncConnectAppsPreview(links, { modalOnly = false } = {}) {
    const form = document.getElementById('quick-connect-apps-form');
    const draft = links && typeof links === 'object' ? sanitizeSocialLinks(links) : readConnectAppsDraft(form);
    const modalPreview = document.getElementById('connect-apps-modal-preview');
    if (modalPreview) {
      modalPreview.innerHTML = renderSocialAppLinksHtml(draft, { variant: 'preview', showEmpty: true, draggable: true });
      bindConnectAppsPreviewDrag(modalPreview);
    }
    const dragHint = document.getElementById('connect-apps-drag-hint');
    if (dragHint) dragHint.hidden = Object.keys(draft).length < 2;
    if (!modalOnly) {
      const summaryPreview = document.getElementById('quick-connect-apps-preview');
      if (summaryPreview) {
        const savedSource = links && typeof links === 'object' ? sanitizeSocialLinks(links) : sanitizeSocialLinks(currentProfile?.social_links);
        summaryPreview.innerHTML = renderSocialAppLinksHtml(savedSource, { variant: 'summary', showEmpty: true });
      }
    }
  }

  function syncConnectAppsForm(links) {
    const form = document.getElementById('quick-connect-apps-form');
    const clean = sanitizeSocialLinks(links);
    modalAppsOrder = normalizeSocialAppOrder(links?._order ?? clean._order);
    if (form) {
      for (const app of SOCIAL_APPS) {
        const input = form.elements[app.key];
        if (!input) continue;
        input.value = clean[app.key] || '';
        input.setCustomValidity('');
        setFieldError(input, '');
      }
    }
    syncConnectAppsPreview(clean);
  }

  function validateConnectAppsForm(form, { liveKey = '' } = {}) {
    let firstInvalid = null;
    const normalized = {};
    if (!form) return { valid: true, firstInvalid: null, normalized };
    for (const app of SOCIAL_APPS) {
      const input = form.elements[app.key];
      if (!input) continue;
      if (liveKey && app.key !== liveKey) continue;
      const { url, error } = validateSocialAppInput(app.key, input.value, { live: Boolean(liveKey) });
      input.setCustomValidity(error);
      setFieldError(input, error);
      if (error && !firstInvalid) firstInvalid = input;
      if (!error && url) normalized[app.key] = url;
    }
    return { valid: !firstInvalid, firstInvalid, normalized };
  }

  function syncProfileCardEditor(appearance) {
    const editor = document.getElementById('quick-card-appearance');
    if (!editor) return;
    const theme = ['emerald', 'midnight', 'rose', 'amber', 'ocean', 'mono'].includes(appearance?.card_theme) ? appearance.card_theme : 'emerald';
    const cover = isSafeImageRef(appearance?.cover_url) ? appearance.cover_url : '';
    editor.dataset.cardTheme = theme;
    editor.dataset.coverUrl = cover;
    const image = document.getElementById('quick-cover-image');
    if (image) { image.hidden = !cover; if (cover) image.src = cover; else image.removeAttribute('src'); }
    const remove = document.getElementById('quick-cover-remove');
    if (remove) { remove.hidden = !cover; remove.disabled = !appearance; }
    const change = document.getElementById('quick-cover-change');
    if (change) change.disabled = !appearance;
    const feedback = document.getElementById('quick-card-feedback');
    if (feedback) feedback.textContent = appearance ? '' : 'Profile card editing is unavailable until the database update is applied.';
    if (appearance) Object.assign(currentProfile, {
      card_theme: theme,
      cover_url: cover || null,
      equipped_profile_effect: appearance.profile_effect || currentProfile.equipped_profile_effect || 'none'
    });
    syncAccountEffectsSummary();
  }

  function bindAccountDialog() {
    const profileForm = document.getElementById('quick-profile-form');
    if (!profileForm || profileForm.dataset.bound) return;
    profileForm.dataset.bound = 'true';
    syncProfileNameMode(profileForm, currentProfile?.role === 'SUPER_ADMIN');
    const emailForm = document.getElementById('quick-email-form');
    const connectAppsForm = document.getElementById('quick-connect-apps-form');
    quickProfileDirty = bindDirtySaveForm(profileForm, profileForm.querySelector('[type="submit"]'));
    quickEmailDirty = bindDirtySaveForm(emailForm, emailForm?.querySelector('[type="submit"]'));
    quickConnectAppsDirty = bindDirtySaveForm(connectAppsForm, connectAppsForm?.querySelector('[type="submit"]'), {
      getExtraState: () => JSON.stringify(Object.keys(readConnectAppsDraft(connectAppsForm)))
    });
    const passwordForm = document.getElementById('quick-password-form');
    const notificationToggle = document.getElementById('quick-notifications-enabled');
    const avatarInput = document.getElementById('quick-avatar-input');
    const avatarTrigger = document.querySelector('.account-avatar-trigger');
    const avatarRemove = document.getElementById('quick-avatar-remove');
    const coverInput = document.getElementById('quick-cover-input');
    const coverChange = document.getElementById('quick-cover-change');
    const coverRemove = document.getElementById('quick-cover-remove');
    document.getElementById('quick-cover-image')?.addEventListener('error', (event) => { event.target.hidden = true; });
    coverChange?.addEventListener('click', () => coverInput?.click());
    coverInput?.addEventListener('change', async () => {
      const file = coverInput.files?.[0];
      coverInput.value = '';
      if (!file) return;
      const mime = String(file.type || '').trim().toLowerCase();
      const allowedCover = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(mime)
        || (!mime && /\.(jpe?g|png|webp)$/i.test(file.name || ''));
      if (!allowedCover || file.size > 25 * 1024 * 1024) {
        toast('Choose a JPEG, PNG, or WebP image under 25 MB.', 'error');
        return;
      }
      try {
        await openAvatarCropper(file, {
          mode: 'cover',
          title: 'Edit cover photo',
          subtitle: 'Drag to reposition or adjust zoom to choose which part shows as your cover.',
          saveLabel: 'Save cover photo',
          category: 'covers',
          maxBytes: 2 * 1024 * 1024,
          onSave: async (url) => {
            syncProfileCardEditor(await rpc('update_own_profile_card', { p_cover_url: url }));
            window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
            toast('Cover photo updated.');
          }
        });
      } catch (error) { toast(friendlyError(error), 'error'); }
    });
    coverRemove?.addEventListener('click', async () => {
      if (!await confirmAction({ title: 'Remove cover photo?', message: 'Your profile card will show its color theme instead.', acceptLabel: 'Remove' })) return;
      setBusy(coverRemove, true, 'Removing…');
      try {
        syncProfileCardEditor(await rpc('update_own_profile_card', { p_clear_cover: true }));
        window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
        toast('Cover photo removed.');
      } catch (error) { toast(friendlyError(error), 'error'); }
      finally { setBusy(coverRemove, false); }
    });
    document.getElementById('quick-effects-open')?.addEventListener('click', () => {
      openProfileEffectsDialog();
    });
    if (avatarTrigger && avatarInput) avatarTrigger.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      avatarInput.click();
    });
    if (avatarInput) avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files?.[0];
      avatarInput.value = '';
      if (!file) return;
      try {
        await openAvatarCropper(file);
      } catch (error) {
        toast(friendlyError(error), 'error');
      }
    });
    if (avatarRemove) avatarRemove.addEventListener('click', async () => {
      const accepted = await confirmAction({
        title: 'Remove display picture?',
        message: 'Are you sure you want to remove your display picture? Your initials will be displayed instead.',
        acceptLabel: 'Remove'
      });
      if (!accepted) return;
      avatarRemove.disabled = true;
      try {
        await rpc('update_own_avatar', { p_avatar_url: null });
        currentProfile.avatar_url = null;
        syncProfileAvatars(currentProfile);
        window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
        toast('Profile picture removed.');
      } catch (error) {
        toast(friendlyError(error), 'error');
      } finally {
        avatarRemove.disabled = false;
      }
    });
    quickMfaController = bindMfaSettings(document.querySelector('#account-dialog [data-mfa-settings]'));
    bindPasswordStrength(passwordForm.elements.password, () => [profileForm.elements.first_name.value, profileForm.elements.middle_name.value, profileForm.elements.last_name.value, emailForm.elements.email.value]);
    passwordForm?.querySelectorAll('.password-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const inputId = btn.getAttribute('aria-controls');
        const input = document.getElementById(inputId);
        if (!input) return;
        const visible = input.type === 'password';
        input.type = visible ? 'text' : 'password';
        btn.innerHTML = visible ? EYE_OFF_SVG : EYE_OPEN_SVG;
        btn.setAttribute('aria-pressed', String(visible));
        btn.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} password`);
        btn.setAttribute('title', `${visible ? 'Hide' : 'Show'} password`);
      });
    });
    const quickUsernameInput = document.getElementById('quick-username');
    const quickUsernameHelp = document.getElementById('quick-username-help');
    const quickBioInput = document.getElementById('quick-bio');
    const quickBioCounter = document.getElementById('quick-bio-count');
    const quickProfileSubmitBtn = profileForm.querySelector('[type="submit"]');
    let quickTakenUsername = '';
    let quickUsernameCheckTimer = null;
    let quickUsernameCheckSeq = 0;

    const setQuickUsernameError = (message = '') => {
      const msg = String(message || '').trim();
      if (quickUsernameHelp) quickUsernameHelp.hidden = Boolean(msg);
      if (quickUsernameInput) {
        quickUsernameInput.setCustomValidity(msg);
        setFieldError(quickUsernameInput, msg);
      }
    };

    const syncQuickProfileSaveLock = () => {
      quickProfileDirty?.sync?.();
      if (!quickProfileSubmitBtn || !quickUsernameInput) return;
      const val = quickUsernameInput.value.trim().toLowerCase();
      const formatOk = !val || /^[a-z0-9_]{3,24}$/.test(val);
      const isTaken = Boolean(val && quickTakenUsername === val);
      const bioLen = String(quickBioInput?.value || '').trim().length;
      if (!formatOk || isTaken || bioLen > 58) {
        if (quickProfileSubmitBtn.dataset) quickProfileSubmitBtn.dataset.dirtyLocked = 'true';
        if (!quickProfileSubmitBtn.classList?.contains?.('is-busy')) quickProfileSubmitBtn.disabled = true;
        quickProfileSubmitBtn.title = isTaken ? 'Choose an available username before saving.' : (!formatOk ? 'Fix the username format first.' : 'Shorten bio to 58 characters or fewer.');
      }
    };
    profileForm.addEventListener('input', syncQuickProfileSaveLock);
    profileForm.addEventListener('change', syncQuickProfileSaveLock);
    document.getElementById('account-dialog')?.addEventListener('close', () => { quickTakenUsername = ''; });

    const checkQuickUsernameAvailability = async (val, seq) => {
      const savedUsername = String(currentProfile?.username || '').trim().toLowerCase();
      if (!val || val === savedUsername || !/^[a-z0-9_]{3,24}$/.test(val)) return;
      try {
        const available = await rpc('check_username_available', { p_username: val });
        if (seq !== quickUsernameCheckSeq) return;
        const currentVal = String(quickUsernameInput?.value || '').trim().toLowerCase();
        if (currentVal !== val) return;
        if (available === false) {
          quickTakenUsername = val;
          setQuickUsernameError('That username is already taken.');
          syncQuickProfileSaveLock();
        }
      } catch {
        // Non-blocking pre-check; authoritative validation remains on submit
      }
    };

    const validateQuickUsername = ({ checkAvailability = false } = {}) => {
      if (!quickUsernameInput) return true;
      const val = quickUsernameInput.value.trim().toLowerCase();
      quickUsernameInput.value = val;
      clearTimeout(quickUsernameCheckTimer);
      if (quickTakenUsername && quickTakenUsername !== val) quickTakenUsername = '';
      const ok = !val || /^[a-z0-9_]{3,24}$/.test(val);
      const savedUsername = String(currentProfile?.username || '').trim().toLowerCase();
      if (!ok) {
        setQuickUsernameError('Use 3–24 lowercase letters, numbers, or underscores.');
      } else if (val && quickTakenUsername === val) {
        setQuickUsernameError('That username is already taken.');
      } else {
        setQuickUsernameError('');
        if (checkAvailability && val && val !== savedUsername) {
          const seq = ++quickUsernameCheckSeq;
          quickUsernameCheckTimer = setTimeout(() => checkQuickUsernameAvailability(val, seq), 260);
        } else {
          quickUsernameCheckSeq += 1;
        }
      }
      syncQuickProfileSaveLock();
      return ok && quickTakenUsername !== val;
    };

    const validateQuickBio = () => {
      if (!quickBioInput) return true;
      const rawLen = quickBioInput.value.length;
      if (quickBioCounter) quickBioCounter.textContent = `${rawLen} / 58 characters`;
      const trimmedLen = quickBioInput.value.trim().length;
      const msg = trimmedLen > 58 ? 'Bio must be 58 characters or fewer.' : '';
      quickBioInput.setCustomValidity(msg);
      setFieldError(quickBioInput, msg);
      syncQuickProfileSaveLock();
      return !msg;
    };

    quickUsernameInput?.addEventListener('input', () => {
      playUiSound('type');
      validateQuickUsername({ checkAvailability: true });
    });
    quickUsernameInput?.addEventListener('blur', () => validateQuickUsername({ checkAvailability: true }));
    quickBioInput?.addEventListener('input', validateQuickBio);
    quickBioInput?.addEventListener('blur', validateQuickBio);

    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateNameFields(profileForm)) return;
      if (!validateQuickUsername()) return quickUsernameInput?.focus();
      if (!validateQuickBio()) return quickBioInput?.focus();
      if (!validatePhoneInput(profileForm.elements.contact_number)) return profileForm.elements.contact_number.focus();
      if (!validatePayoutFields(profileForm)) return;
      const button = event.submitter || quickProfileSubmitBtn;
      const values = new FormData(profileForm);
      const payoutPayload = readPayoutPayload(profileForm);
      const nextUsername = String(values.get('username') || '').trim().toLowerCase();
      const nextBio = String(values.get('bio') || '').trim();
      const prevUsername = String(currentProfile?.username || '').trim().toLowerCase();
      const prevBio = String(currentProfile?.bio || '').trim();
      const socialChanged = nextUsername !== prevUsername || nextBio !== prevBio;
      setBusy(button, true);
      try {
        let savedSocial = null;
        if (socialChanged) {
          savedSocial = await rpc('update_own_social_identity', {
            p_username: nextUsername || null,
            p_bio: nextBio || null
          });
        }
        await rpc('update_own_profile', {
          p_first_name: values.get('first_name'),
          p_middle_name: values.get('middle_name') || null,
          p_last_name: values.get('last_name') || null,
          p_contact_number: values.get('contact_number') || null,
          ...payoutPayload
        });
        Object.assign(currentProfile, {
          first_name: normalizeNamePart(values.get('first_name')),
          middle_name: normalizeNamePart(values.get('middle_name')) || null,
          last_name: normalizeNamePart(values.get('last_name')) || null,
          ...(socialChanged ? {
            username: savedSocial?.username ?? (nextUsername || null),
            bio: savedSocial?.bio ?? (nextBio || null)
          } : {}),
          name_setup_required: false,
          payout_channel: payoutPayload.p_payout_channel,
          payout_account_number: payoutPayload.p_payout_account_number,
          payout_account_name: payoutPayload.p_payout_account_name
        });
        await loadAccountDialog();
        const computedName = [currentProfile.first_name, currentProfile.middle_name, currentProfile.last_name].filter(Boolean).join(' ');
        const name = (document.getElementById('quick-account-name')?.textContent || '').trim() || computedName;
        if (name) {
          currentProfile.full_name = name;
          document.querySelector('#sidebar-user strong')?.replaceChildren(name);
        }
        window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
        toast('Profile updated.');
      } catch (error) {
        const errMsg = friendlyError(error);
        if ((error?.code === '23505' || /username|taken/i.test(errMsg)) && quickUsernameInput) {
          const val = quickUsernameInput.value.trim().toLowerCase();
          if (/taken|already/i.test(errMsg) && val) quickTakenUsername = val;
          setQuickUsernameError(errMsg);
          syncQuickProfileSaveLock();
          quickUsernameInput.focus();
        } else {
          toast(errMsg, 'error');
        }
      }
      finally {
        setBusy(button, false);
        syncQuickProfileSaveLock();
      }
    });
    emailForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.submitter;
      setBusy(button, true, 'Updating…');
      try {
        const { error } = await getClient().auth.updateUser({ email: emailForm.elements.email.value.trim() });
        if (error) throw error;
        toast('Check your email to confirm the change.');
      } catch (error) { toast(friendlyError(error), 'error'); }
      finally { setBusy(button, false); }
    });
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = passwordForm.elements.password.value;
      if (password !== passwordForm.elements.password_confirmation.value) {
        setFieldError(passwordForm.elements.password_confirmation, 'Passwords do not match.');
        passwordForm.elements.password_confirmation.focus();
        return;
      }
      const issue = passwordIssue(password, [profileForm.elements.first_name.value, profileForm.elements.middle_name.value, profileForm.elements.last_name.value, emailForm.elements.email.value]);
      if (issue) {
        setFieldError(passwordForm.elements.password, issue);
        passwordForm.elements.password.focus();
        return;
      }
      const button = event.submitter;
      setBusy(button, true, 'Changing…');
      try {
        await changePassword(password, passwordForm.elements.current_password.value);
        await rpc('record_account_activity', { p_event: 'PASSWORD_CHANGE' });
        passwordForm.reset();
        toast('Password changed.');
      } catch (error) { toast(friendlyError(error), 'error'); }
      finally { setBusy(button, false); }
    });
    notificationToggle.addEventListener('change', async () => {
      notificationToggle.disabled = true;
      try { await setNotificationPreference(notificationToggle.checked); toast('Notification preference saved.'); }
      catch (error) { notificationToggle.checked = !notificationToggle.checked; toast(friendlyError(error), 'error'); }
      finally { notificationToggle.disabled = false; }
    });
    const connectAppsDialog = document.getElementById('connect-apps-dialog');
    const connectAppsOpenBtn = document.getElementById('quick-connect-apps-open');
    connectAppsOpenBtn?.addEventListener('click', () => {
      syncConnectAppsForm(currentProfile?.social_links);
      quickConnectAppsDirty?.reset();
      if (connectAppsDialog && typeof connectAppsDialog.showModal === 'function' && !connectAppsDialog.open) {
        connectAppsDialog.showModal();
        connectAppsDialog.querySelector('input')?.focus();
      }
    });
    document.querySelectorAll('[data-connect-apps-close]').forEach((btn) => {
      btn.addEventListener('click', () => connectAppsDialog?.close());
    });
    connectAppsDialog?.addEventListener('click', (event) => {
      if (event.target === connectAppsDialog) connectAppsDialog.close();
    });
    if (connectAppsForm) {
      for (const app of SOCIAL_APPS) {
        const input = connectAppsForm.elements[app.key];
        if (!input) continue;
        input.addEventListener('input', () => {
          validateConnectAppsForm(connectAppsForm, { liveKey: app.key });
          syncConnectAppsPreview(null, { modalOnly: true });
        });
        input.addEventListener('blur', () => {
          const { url, error } = validateSocialAppInput(app.key, input.value, { live: false });
          input.setCustomValidity(error);
          setFieldError(input, error);
          if (!error && url) {
            input.value = url;
            quickConnectAppsDirty?.sync?.();
          }
          syncConnectAppsPreview(null, { modalOnly: true });
        });
        input.addEventListener('invalid', (event) => {
          event.preventDefault();
          const { error } = validateSocialAppInput(app.key, input.value, { live: false });
          if (error) setFieldError(input, error);
        });
      }
      connectAppsForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const check = validateConnectAppsForm(connectAppsForm);
        if (!check.valid) {
          check.firstInvalid?.focus();
          return;
        }
        const button = event.submitter || document.getElementById('quick-connect-apps-save');
        setBusy(button, true, 'Saving…');
        try {
          const payload = serializeSocialLinks(check.normalized, modalAppsOrder);
          const saved = await rpc('update_own_social_links', { p_links: payload });
          const clean = sanitizeSocialLinks(saved?.social_links ?? payload);
          currentProfile.social_links = clean;
          syncConnectAppsForm(clean);
          quickConnectAppsDirty?.reset();
          connectAppsDialog?.close();
          window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
          toast('Connected apps updated.');
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          setBusy(button, false);
        }
      });
    }
  }

  function getDeviceToken() {
    const key = 'myipon_trusted_device';
    try {
      const saved = localStorage.getItem(key);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved || '')) return saved;
      const token = crypto.randomUUID();
      localStorage.setItem(key, token);
      return token;
    } catch {
      const saved = sessionStorage.getItem(key);
      if (saved) return saved;
      const token = crypto.randomUUID();
      sessionStorage.setItem(key, token);
      return token;
    }
  }

  function mfaSettingsMarkup() {
    return '<div class="mfa-settings" data-mfa-settings><label class="toggle-switch-row" for="new-device-email-otp"><span><strong>Email verification for new devices</strong><small>Send a 6-digit code when a new browser or device signs in. This browser will be remembered for 90 days.</small></span><input class="toggle-switch-input" id="new-device-email-otp" type="checkbox" role="switch" data-device-otp-toggle aria-describedby="new-device-email-otp-status"></label><p class="mfa-message" id="new-device-email-otp-status" data-device-otp-message role="status" aria-live="polite"></p><div class="mfa-status"><span><strong>Authenticator app</strong><small>Use a rotating code every time you sign in.</small></span><b data-mfa-status>Checking…</b></div><div class="mfa-factor-list" data-mfa-list></div><button class="button button-secondary" type="button" data-mfa-enroll>Set up authenticator</button><dialog class="mfa-enrollment-dialog" data-mfa-enrollment aria-label="Set up authenticator"><div class="mfa-enrollment"><h3>Set up authenticator</h3><p>Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy, or another TOTP app.</p><img data-mfa-qr alt="Authenticator setup QR code"><p class="mfa-secret-label">Manual setup key</p><code data-mfa-secret></code><form class="form-grid" data-mfa-verify-form><div class="field field-wide"><label>6-digit authenticator code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label></div><p class="mfa-message field-wide" data-mfa-enrollment-message role="status" aria-live="polite"></p><div class="form-actions field-wide"><button class="button button-secondary" type="button" data-mfa-cancel>Cancel</button><button class="button button-primary" type="submit">Enable MFA</button></div></form></div></dialog><p class="mfa-message" data-mfa-message role="status" aria-live="polite"></p></div>';
  }

  function bindMfaSettings(root) {
    if (!root) return null;
    if (root.mfaController) return root.mfaController;
    const status = root.querySelector('[data-mfa-status]');
    const list = root.querySelector('[data-mfa-list]');
    const enrollment = root.querySelector('[data-mfa-enrollment]');
    const enrollButton = root.querySelector('[data-mfa-enroll]');
    const form = root.querySelector('[data-mfa-verify-form]');
    const message = root.querySelector('[data-mfa-message]');
    const enrollmentMessage = root.querySelector('[data-mfa-enrollment-message]');
    const qr = root.querySelector('[data-mfa-qr]');
    const secret = root.querySelector('[data-mfa-secret]');
    let factorId = null;

    const say = (text, tone = '') => {
      message.textContent = text;
      if (tone) message.dataset.tone = tone;
      else delete message.dataset.tone;
    };
    const sayEnrollment = (text, tone = '') => {
      enrollmentMessage.textContent = text;
      if (tone) enrollmentMessage.dataset.tone = tone;
      else delete enrollmentMessage.dataset.tone;
    };
    const resetEnrollment = () => {
      factorId = null;
      form.reset();
      if (enrollment.open) enrollment.close();
      enrollButton.hidden = false;
      qr.removeAttribute('src');
      secret.textContent = '';
      sayEnrollment('');
    };
    const load = async () => {
      say('');
      status.textContent = 'Checking…';
      const { data, error } = await getClient().auth.mfa.listFactors();
      if (error) throw error;
      const factors = (data.totp || []).filter((factor) => factor.status === 'verified');
      status.textContent = factors.length ? `${factors.length} authenticator${factors.length === 1 ? '' : 's'} enabled` : 'Not enabled';
      enrollButton.textContent = factors.length ? 'Add another authenticator' : 'Set up authenticator';
      list.innerHTML = factors.map((factor) => `<div class="mfa-factor"><span><strong>${escapeHtml(factor.friendly_name || 'Authenticator app')}</strong><small>Verified</small></span><button class="button button-secondary" type="button" data-mfa-remove="${escapeHtml(factor.id)}">Remove</button></div>`).join('');
    };
    enrollButton.addEventListener('click', async () => {
      setBusy(enrollButton, true, 'Preparing…');
      say('');
      sayEnrollment('');
      try {
        const { data, error } = await getClient().auth.mfa.enroll({ factorType: 'totp', friendlyName: `IPON ${new Date().toISOString()}`, issuer: 'IPON' });
        if (error) throw error;
        factorId = data.id;
        qr.src = data.totp.qr_code;
        secret.textContent = data.totp.secret;
        enrollment.showModal();
        enrollButton.hidden = true;
        form.elements.code.focus();
      } catch (error) { say(friendlyError(error), 'error'); }
      finally { setBusy(enrollButton, false); }
    });
    const cancelEnrollment = async () => {
      if (factorId) await getClient().auth.mfa.unenroll({ factorId }).catch(() => { });
      resetEnrollment();
    };
    root.querySelector('[data-mfa-cancel]').addEventListener('click', cancelEnrollment);
    enrollment.addEventListener('cancel', (event) => { event.preventDefault(); cancelEnrollment(); });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const code = form.elements.code.value.trim();
      if (!/^\d{6}$/.test(code)) return sayEnrollment('Enter the 6-digit code from your authenticator app.', 'error');
      setBusy(button, true, 'Verifying…');
      try {
        const { error } = await getClient().auth.mfa.challengeAndVerify({ factorId, code });
        if (error) throw error;
        resetEnrollment();
        await load();
        say('Multi-factor authentication is enabled.', 'success');
      } catch (error) { sayEnrollment(friendlyError(error), 'error'); }
      finally { setBusy(button, false); }
    });
    list.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-mfa-remove]');
      if (!button) return;
      const accepted = await confirmAction({ title: 'Remove authenticator?', message: 'This authenticator will no longer be accepted during sign in.', acceptLabel: 'Remove' });
      if (!accepted) return;
      setBusy(button, true, 'Removing…');
      try {
        const client = getClient();
        const { error } = await client.auth.mfa.unenroll({ factorId: button.dataset.mfaRemove });
        if (error) throw error;
        await client.auth.refreshSession();
        await load();
        say('Authenticator removed.', 'success');
      } catch (error) { say(friendlyError(error), 'error'); }
      finally { setBusy(button, false); }
    });
    root.mfaController = { load };
    return root.mfaController;
  }

  function isIosDevice() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function getInstalledNativeBuild() {
    const uaMatch = navigator.userAgent.match(/myIPONApp\/(\d+)/i);
    if (uaMatch) return Number(uaMatch[1]);
    return Number(window.MYIPON_APP_VERSION?.nativeBuild || window.MYIPON_APP_VERSION?.build || 0);
  }

  function isInstalledAppUser() {
    if (isIosDevice()) return false;
    try {
      if (new URLSearchParams(window.location.search).get('app') === '1') {
        sessionStorage.setItem('myipon_is_app', '1');
      }
    } catch (_) { }
    return Boolean(window.Capacitor) ||
      document.body.classList.contains('is-app') ||
      Boolean(window.MYIPON_APP_VERSION?.isApp) ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      /myIPON/i.test(navigator.userAgent) ||
      sessionStorage.getItem('myipon_is_app') === '1';
  }

  function isMobileDeviceNotifClient() {
    return isInstalledAppUser()
      || /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || '')
      || Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
  }

  const APK_LATEST_DOWNLOAD_URL = 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk';
  let androidChannelReady = false;
  let nativeNotifListenerAttached = false;
  let lastBgPollSyncAt = 0;
  let lastWebPushSyncAt = 0;

  function openLatestApkDownload() {
    return typeof window !== 'undefined' && typeof window.open === 'function'
      ? window.open(APK_LATEST_DOWNLOAD_URL, '_blank', 'noopener')
      : null;
  }

  function getLocalNotificationsPlugin() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  }

  function getBackgroundNotificationsPlugin() {
    return window.Capacitor?.Plugins?.BackgroundNotifications || null;
  }

  function hasNativeNotificationBridge() {
    return Boolean(getLocalNotificationsPlugin() || getBackgroundNotificationsPlugin());
  }

  function apkNeedsNativeUpdate(bgPlugin = getBackgroundNotificationsPlugin(), nativeBgStatus = null) {
    if (!hasNativeNotificationBridge() || typeof bgPlugin?.requestIgnoreBatteryOptimizations !== 'function') {
      return true;
    }
    if (nativeBgStatus) {
      if (nativeBgStatus.micManifestDeclared === false) return true;
      if (typeof bgPlugin?.getBackgroundStatus === 'function' && typeof nativeBgStatus.batteryOptimizationIgnored !== 'boolean') {
        return true;
      }
    }
    return false;
  }

  function urlBase64ToUint8Array(base64String) {
    const clean = String(base64String || '').trim();
    const padding = '='.repeat((4 - (clean.length % 4)) % 4);
    const base64 = (clean + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const output = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i += 1) {
      output[i] = rawData.charCodeAt(i);
    }
    return output;
  }

  function uint8ArraysEqual(a, b) {
    if (!a || !b || a.byteLength !== b.byteLength) return false;
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    for (let i = 0; i < va.length; i += 1) {
      if (va[i] !== vb[i]) return false;
    }
    return true;
  }

  function detectPushPlatform() {
    const ua = navigator.userAgent || '';
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    if (/iphone|ipad|ipod/i.test(ua)) return standalone ? 'iOS PWA' : 'iOS Safari';
    if (/android/i.test(ua)) return standalone ? 'Android PWA' : 'Android Web';
    return standalone ? 'Desktop PWA' : 'Desktop Web';
  }

  async function getWebPushRegistration() {
    if (isInstalledAppUser() || isLocalDevHost || !('serviceWorker' in navigator)) return null;
    try {
      const existing = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null)
        || await navigator.serviceWorker.getRegistration().catch(() => null);
      if (existing?.active) return existing;
      if (existing) {
        return await Promise.race([
          navigator.serviceWorker.ready,
          new Promise((resolve) => setTimeout(() => resolve(existing), 2500))
        ]);
      }
      return await Promise.race([
        navigator.serviceWorker.register('/sw.js'),
        new Promise((resolve) => setTimeout(() => resolve(null), 2500))
      ]);
    } catch {
      return null;
    }
  }

  async function getWebPushState() {
    const supported = !isInstalledAppUser()
      && Boolean(config.vapidPublicKey)
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window;
    if (!supported) {
      return { supported: false, subscribed: false, endpoint: '' };
    }
    try {
      const reg = await getWebPushRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      return {
        supported: true,
        subscribed: Boolean(sub?.endpoint),
        endpoint: sub?.endpoint || ''
      };
    } catch {
      return { supported: true, subscribed: false, endpoint: '' };
    }
  }

  async function syncWebPushSubscription({ force = false } = {}) {
    if (!isMobileDeviceNotifClient() || isInstalledAppUser() || !configured || !currentProfile?.id) return false;
    if (!config.vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      return false;
    }
    if (currentProfile.notifications_enabled === false || (await getDeviceNotificationPermission()) !== 'granted') {
      return false;
    }
    const now = Date.now();
    const syncMarkerKey = `myipon_webpush_synced_${currentProfile.id}`;
    if (!force && now - lastWebPushSyncAt < 60_000 && localStorage.getItem(syncMarkerKey)) {
      return true;
    }
    lastWebPushSyncAt = now;
    try {
      const reg = await getWebPushRegistration();
      if (!reg?.pushManager) return false;
      const appServerKey = urlBase64ToUint8Array(config.vapidPublicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey && !uint8ArraysEqual(sub.options.applicationServerKey, appServerKey)) {
        await sub.unsubscribe().catch(() => { });
        sub = null;
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: appServerKey
        });
      }
      const subJson = sub?.toJSON?.();
      const endpoint = subJson?.endpoint || sub?.endpoint || '';
      const p256dh = subJson?.keys?.p256dh || '';
      const auth = subJson?.keys?.auth || '';
      if (!endpoint || !p256dh || !auth) return false;

      if (force || localStorage.getItem(syncMarkerKey) !== endpoint) {
        await rpc('upsert_push_subscription', {
          p_endpoint: endpoint,
          p_p256dh: p256dh,
          p_auth: auth,
          p_platform: detectPushPlatform()
        });
        try {
          localStorage.setItem(syncMarkerKey, endpoint);
          localStorage.setItem('myipon_webpush_endpoint', endpoint);
        } catch { /* ignore storage errors */ }
      }
      return true;
    } catch {
      lastWebPushSyncAt = 0;
      return false;
    }
  }

  async function removeWebPushSubscription() {
    if (isInstalledAppUser() || !configured) return;
    let endpoint = '';
    try {
      const reg = await getWebPushRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      endpoint = sub?.endpoint || localStorage.getItem('myipon_webpush_endpoint') || '';
      if (sub) await sub.unsubscribe().catch(() => { });
    } catch {
      endpoint = localStorage.getItem('myipon_webpush_endpoint') || '';
    }
    try {
      await rpc('delete_push_subscription', { p_endpoint: endpoint || null });
    } catch { /* ignore */ }
    if (currentProfile?.id) {
      try { localStorage.removeItem(`myipon_webpush_synced_${currentProfile.id}`); } catch { /* ignore */ }
    }
    try { localStorage.removeItem('myipon_webpush_endpoint'); } catch { /* ignore */ }
    lastWebPushSyncAt = 0;
  }

  async function sendBackgroundTestNotification() {
    const client = getClient();
    if (!client || !config.supabaseUrl) {
      throw new Error('Notification service is not configured.');
    }
    if (!isInstalledAppUser()) {
      await syncWebPushSubscription({ force: true });
    } else {
      lastBgPollSyncAt = 0;
      await syncBackgroundNotificationPolling(currentProfile);
    }
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Please sign in again to test alerts.');
    }
    const res = await fetch(`${config.supabaseUrl}/functions/v1/send-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({ action: 'test', delay_ms: 0 })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || 'Could not send background test alert.');
    }
    return data;
  }

  async function ensureAndroidNotificationChannel() {
    const plugin = getLocalNotificationsPlugin();
    if (!plugin || androidChannelReady) return;
    androidChannelReady = true;
    try {
      await plugin.createChannel?.({
        id: 'myipon_alerts',
        name: 'myIPON Alerts',
        description: 'Role updates, approvals, announcements, and due reminders',
        importance: 4,
        visibility: 1,
        vibration: true
      });
    } catch {
      androidChannelReady = false;
    }
  }

  let browserPermissionObserverBound = false;
  let didAutoSyncPushInSession = false;

  function normalizeNotificationPermission(value) {
    if (value === 'granted') return 'granted';
    if (value === 'denied') return 'denied';
    if (value === 'prompt' || value === 'prompt-with-rationale' || value === 'default') return 'default';
    return 'unsupported';
  }

  function bindBrowserPermissionObserver(permStatus) {
    if (!permStatus || browserPermissionObserverBound) return;
    browserPermissionObserverBound = true;
    const onChange = () => {
      const next = normalizeNotificationPermission(permStatus.state);
      if (next === 'granted' && currentProfile?.notifications_enabled !== false) {
        syncWebPushSubscription({ force: true })
          .catch(() => { })
          .finally(() => syncDevicePermissionUI().catch(() => { }));
      } else {
        syncDevicePermissionUI().catch(() => { });
      }
    };
    if (typeof permStatus.addEventListener === 'function') {
      permStatus.addEventListener('change', onChange);
    } else {
      permStatus.onchange = onChange;
    }
  }

  async function getDeviceNotificationPermission() {
    const bgPlugin = getBackgroundNotificationsPlugin();
    const plugin = getLocalNotificationsPlugin();
    if (plugin?.checkPermissions || bgPlugin?.getBackgroundStatus) {
      const [capRes, bgRes] = await Promise.all([
        plugin?.checkPermissions ? plugin.checkPermissions().catch(() => null) : null,
        bgPlugin?.getBackgroundStatus ? bgPlugin.getBackgroundStatus().catch(() => null) : null
      ]);
      if (bgRes?.hasPermission === true) return 'granted';
      const capStatus = normalizeNotificationPermission(capRes?.display);
      if (bgRes && bgRes.hasPermission === false && capStatus === 'granted') return 'denied';
      if (capStatus !== 'unsupported') return capStatus;
      return bgRes?.hasPermission === false ? 'default' : 'unsupported';
    }
    if (window.isSecureContext === false) return 'insecure';
    const notifStatus = 'Notification' in window ? normalizeNotificationPermission(Notification.permission) : 'unsupported';
    let permApiStatus = 'unsupported';
    if (navigator.permissions?.query) {
      try {
        const permStatus = await navigator.permissions.query({ name: 'notifications' });
        bindBrowserPermissionObserver(permStatus);
        permApiStatus = normalizeNotificationPermission(permStatus?.state);
      } catch { /* ignore */ }
    }
    let pushPermStatus = 'unsupported';
    if (notifStatus !== 'granted' && permApiStatus !== 'granted' && navigator.serviceWorker?.getRegistration) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const state = await reg?.pushManager?.permissionState?.({ userVisibleOnly: true });
        pushPermStatus = normalizeNotificationPermission(state);
      } catch { /* ignore */ }
    }
    if (notifStatus === 'denied' || permApiStatus === 'denied' || pushPermStatus === 'denied') return 'denied';
    if (notifStatus === 'granted' || permApiStatus === 'granted' || pushPermStatus === 'granted') return 'granted';
    return notifStatus !== 'unsupported' ? notifStatus : (permApiStatus !== 'unsupported' ? permApiStatus : pushPermStatus);
  }

  let lastBgGrantedToastAt = 0;
  let lastBgSnapshot = null;

  async function collectDeviceBackgroundSnapshot() {
    const isMobile = isMobileDeviceNotifClient();
    if (!isMobile) {
      return {
        isMobile: false,
        isApp: false,
        needsApkUpdate: false,
        status: 'unsupported',
        nativeBgStatus: null,
        batteryKnown: true,
        batteryOk: true,
        pushState: { supported: false, subscribed: false },
        isIosBrowser: false
      };
    }
    const status = await getDeviceNotificationPermission();
    const isApp = isInstalledAppUser();
    const bgPlugin = getBackgroundNotificationsPlugin();
    let nativeBgStatus = null;
    if (isApp && bgPlugin?.getBackgroundStatus) {
      nativeBgStatus = await bgPlugin.getBackgroundStatus().catch(() => null);
    }
    const needsApkUpdate = isApp && apkNeedsNativeUpdate(bgPlugin, nativeBgStatus);
    const batteryKnown = !isApp || Boolean(nativeBgStatus && typeof nativeBgStatus.batteryOptimizationIgnored === 'boolean');
    const batteryOk = !isApp || (!needsApkUpdate && (!nativeBgStatus || nativeBgStatus.batteryOptimizationIgnored !== false));
    let pushState = !isApp && status === 'granted'
      ? await getWebPushState()
      : { supported: !isApp && Boolean(config.vapidPublicKey) && 'PushManager' in window, subscribed: false };

    if (!isApp && status === 'granted' && pushState.supported && !pushState.subscribed
      && currentProfile?.notifications_enabled !== false && !didAutoSyncPushInSession) {
      didAutoSyncPushInSession = true;
      const synced = await syncWebPushSubscription({ force: false }).catch(() => false);
      if (synced) {
        pushState = await getWebPushState();
      }
    }

    const isIosBrowser = !isApp && /iphone|ipad|ipod/i.test(navigator.userAgent || '')
      && !(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);

    return {
      isMobile,
      isApp,
      needsApkUpdate,
      status,
      nativeBgStatus,
      batteryKnown,
      batteryOk,
      pushState,
      isIosBrowser
    };
  }

  function syncBackgroundRowsUI(bgRows, snap) {
    if (snap) lastBgSnapshot = snap;
    bgRows.forEach((row) => {
      if (!snap.isMobile) {
        row.hidden = true;
        return;
      }
      const pillEl = row.querySelector('[data-device-bg-pill]');
      const statusEl = row.querySelector('[data-device-bg-status]');
      const actionsEl = row.querySelector('[data-device-bg-actions]');
      const button = row.querySelector('[data-device-bg-btn]');
      if (!pillEl || !statusEl || !actionsEl || !button) return;

      const busyState = button.classList.contains('is-busy')
        ? { label: button.textContent, disabled: button.disabled, orig: button.dataset.originalLabel }
        : null;
      actionsEl.querySelectorAll('[data-device-bg-extra]').forEach((el) => el.remove());
      const addExtra = (labelText, attrs = {}) => {
        const extra = document.createElement('button');
        extra.type = 'button';
        extra.className = 'button button-secondary button-sm';
        extra.textContent = labelText;
        extra.setAttribute('data-device-bg-extra', '');
        Object.entries(attrs).forEach(([k, v]) => extra.setAttribute(k, v));
        actionsEl.appendChild(extra);
        return extra;
      };
      const setPill = (text, tone) => {
        pillEl.textContent = text;
        pillEl.dataset.tone = tone;
      };

      if (snap.isApp) {
        row.hidden = false;
        if (snap.needsApkUpdate) {
          setPill('Update APK', 'warning');
          statusEl.textContent = 'Update to the latest myIPON APK for microphone voice notes and smoother in-app notification alerts.';
          button.textContent = 'Update APK';
          button.className = 'button button-primary button-sm';
          button.dataset.bgAction = 'update-apk';
          button.disabled = false;
          button.hidden = false;
        } else if (snap.status === 'granted' && snap.batteryKnown && snap.batteryOk) {
          setPill('Active', 'success');
          statusEl.textContent = 'Device alerts are enabled while myIPON is open. Stay in the app or check myIPON regularly for new messages and alerts (in-app only, not sent via email).';
          button.textContent = 'Granted';
          button.className = 'button button-secondary button-sm';
          delete button.dataset.bgAction;
          button.disabled = true;
          button.hidden = false;
          addExtra('App settings', { 'data-bg-action': 'app-settings' });
        } else if (snap.status === 'granted' && !snap.batteryOk) {
          setPill('Restricted', 'warning');
          statusEl.textContent = 'Notifications are enabled while myIPON is open. Tap Allow background usage to reduce interruptions when switching apps.';
          button.textContent = 'Allow background usage';
          button.className = 'button button-primary button-sm';
          button.dataset.bgAction = 'allow-background';
          button.disabled = false;
          button.hidden = false;
          addExtra('App settings', { 'data-bg-action': 'app-settings' });
        } else if (snap.status === 'granted') {
          setPill('Check access', 'neutral');
          statusEl.textContent = 'Device notifications are enabled. Open myIPON directly to view new messages and in-app alerts (not sent via email).';
          button.textContent = 'App settings';
          button.className = 'button button-secondary button-sm';
          button.dataset.bgAction = 'app-settings';
          button.disabled = false;
          button.hidden = false;
          addExtra('Recheck', { 'data-bg-action': 'recheck' });
        } else if (snap.status === 'default') {
          setPill('Needs access', 'warning');
          statusEl.textContent = snap.batteryOk
            ? 'Device notifications are off. Allow alerts so banners appear while using myIPON (notifications are in-app only, not sent via email).'
            : 'Allow device alerts so message banners and updates appear while using myIPON (notifications are in-app only, not sent via email).';
          button.textContent = snap.batteryOk ? 'Turn on alerts' : 'Allow background usage';
          button.className = 'button button-primary button-sm';
          button.dataset.bgAction = 'allow-all';
          button.disabled = false;
          button.hidden = false;
          if (!snap.batteryOk) addExtra('App settings', { 'data-bg-action': 'app-settings' });
        } else {
          setPill('Blocked', 'danger');
          statusEl.textContent = !snap.batteryOk
            ? 'Device notifications are blocked in Android settings. Open App settings, turn on Notifications, then tap Recheck.'
            : 'Device notifications are blocked in Android settings. Open App settings, allow Notifications, then tap Recheck.';
          button.textContent = 'Open settings';
          button.className = 'button button-primary button-sm';
          button.dataset.bgAction = !snap.batteryOk ? 'app-settings' : 'notif-settings';
          button.disabled = false;
          button.hidden = false;
          addExtra('Recheck', { 'data-bg-action': 'recheck' });
        }
        return;
      }

      if (snap.status === 'insecure' || (!snap.pushState?.supported && !snap.isIosBrowser && snap.status === 'unsupported')) {
        row.hidden = true;
        return;
      }
      row.hidden = false;
      if (snap.isIosBrowser) {
        setPill('Add to Home', 'neutral');
        statusEl.textContent = 'On iPhone/iPad, tap Share -> Add to Home Screen, then open myIPON to view messages and in-app alerts.';
        button.hidden = true;
      } else if (snap.status === 'granted' && snap.pushState?.subscribed) {
        setPill('Active', 'success');
        statusEl.textContent = 'Browser alerts are enabled. Open myIPON to view messages and alerts (in-app only, not sent via email).';
        button.textContent = 'On';
        button.className = 'button button-secondary button-sm';
        delete button.dataset.bgAction;
        button.disabled = true;
        button.hidden = false;
      } else if (snap.status === 'granted' && snap.pushState?.supported) {
        setPill('Finish setup', 'warning');
        statusEl.textContent = 'Notifications are allowed. Tap Finish setup to sync in-app browser alerts.';
        button.textContent = 'Finish setup';
        button.className = 'button button-primary button-sm';
        button.dataset.bgAction = 'sync-push';
        button.disabled = false;
        button.hidden = false;
      } else if (snap.status === 'denied') {
        setPill('Blocked', 'danger');
        statusEl.textContent = 'Browser notifications are blocked for this site. Allow notifications in site settings, then tap Recheck.';
        button.textContent = 'How to unblock';
        button.className = 'button button-primary button-sm';
        button.dataset.bgAction = 'unblock-help';
        button.disabled = false;
        button.hidden = false;
        addExtra('Recheck', { 'data-bg-action': 'recheck' });
      } else {
        setPill('Off', 'warning');
        statusEl.textContent = 'Turn on browser notifications so banners appear while using myIPON (notifications are in-app only).';
        button.textContent = 'Turn on';
        button.className = 'button button-primary button-sm';
        button.dataset.bgAction = 'enable-notif';
        button.disabled = false;
        button.hidden = false;
      }
      if (busyState) {
        button.classList.add('is-busy');
        button.disabled = busyState.disabled;
        button.textContent = busyState.label;
        if (busyState.orig) button.dataset.originalLabel = busyState.orig;
      }
    });
  }

  function markBackgroundPromptSeen(userId) {
    if (!userId) return;
    try { localStorage.setItem(`myipon_bg_prompt_seen_${userId}`, '1'); } catch { /* ignore storage quota errors */ }
  }

  function syncBackgroundUsagePrompt(snap) {
    const dialog = document.getElementById('background-usage-prompt-dialog');
    if (snap) lastBgSnapshot = snap;
    if (!dialog || !snap) return;
    const notifBadge = dialog.querySelector('[data-bg-prompt-notif-badge]');
    const batteryBadge = dialog.querySelector('[data-bg-prompt-battery-badge]');
    const allowBtn = dialog.querySelector('[data-bg-prompt-allow]');
    const settingsBtn = dialog.querySelector('[data-bg-prompt-settings]');
    const hintEl = dialog.querySelector('[data-bg-prompt-hint]');
    if (notifBadge) {
      if (snap.status === 'granted') {
        notifBadge.textContent = 'Allowed';
        notifBadge.dataset.tone = 'success';
      } else if (snap.status === 'denied') {
        notifBadge.textContent = 'Blocked';
        notifBadge.dataset.tone = 'danger';
      } else {
        notifBadge.textContent = 'Required';
        notifBadge.dataset.tone = 'warning';
      }
    }
    if (batteryBadge) {
      if (snap.batteryOk) {
        batteryBadge.textContent = 'Unrestricted';
        batteryBadge.dataset.tone = 'success';
      } else {
        batteryBadge.textContent = 'Required';
        batteryBadge.dataset.tone = 'warning';
      }
    }
    const allDone = snap.status === 'granted' && snap.batteryOk;
    if (allowBtn && !allowBtn.classList.contains('is-busy')) {
      allowBtn.textContent = allDone
        ? 'Done'
        : (snap.status === 'denied' && snap.batteryOk
          ? 'Open notification settings'
          : (snap.status === 'denied' ? 'Open app settings' : 'Allow background usage'));
    }
    if (settingsBtn) {
      settingsBtn.hidden = !(snap.status === 'denied' || (dialog.dataset.attempted === '1' && !snap.batteryOk));
    }
    if (hintEl) {
      if (dialog.dataset.attempted === '1' && !allDone) {
        hintEl.textContent = snap.status === 'denied'
          ? 'Notifications are blocked in Android Settings. Tap Open app settings, allow Notifications, and set Battery to Unrestricted.'
          : 'If your phone did not switch battery usage automatically, tap Open app settings -> Battery -> Unrestricted.';
      } else {
        hintEl.textContent = 'You can review or change this anytime in My account -> Appearance & notifications.';
      }
    }
  }

  function ensureBackgroundUsagePromptDialog() {
    let dialog = document.getElementById('background-usage-prompt-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'background-usage-prompt-dialog';
    dialog.className = 'form-dialog bg-usage-dialog';
    dialog.setAttribute('aria-labelledby', 'bg-usage-prompt-title');
    dialog.innerHTML = `
      <div class="form-dialog-sheet bg-usage-sheet">
        <header class="form-dialog-header bg-usage-header">
          <div>
            <h2 id="bg-usage-prompt-title">Enable app alerts</h2>
            <p>Allow notification alerts on this device. Open myIPON regularly for new messages and updates (alerts are in-app only, not emailed).</p>
          </div>
          <button class="dialog-close" type="button" data-bg-prompt-close aria-label="Close alert permission prompt">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="bg-usage-body">
          <div class="bg-usage-checklist">
            <div class="bg-usage-item">
              <div>
                <strong>Device notifications</strong>
                <small>Show banners for chat messages, approvals, and payment reminders while myIPON is open.</small>
              </div>
              <span class="bg-access-pill" data-bg-prompt-notif-badge data-tone="warning">Required</span>
            </div>
            <div class="bg-usage-item">
              <div>
                <strong>App session permission</strong>
                <small>Helps reduce interruptions when switching between apps (keep myIPON open to receive real-time alerts).</small>
              </div>
              <span class="bg-access-pill" data-bg-prompt-battery-badge data-tone="warning">Required</span>
            </div>
          </div>
          <p class="bg-usage-hint" data-bg-prompt-hint>You can review or change this anytime in My account -&gt; Appearance &amp; notifications.</p>
          <div class="form-actions bg-usage-actions">
            <button class="button button-secondary" type="button" data-bg-prompt-dismiss>Maybe later</button>
            <button class="button button-secondary" type="button" data-bg-prompt-settings hidden>Open app settings</button>
            <button class="button button-primary" type="button" data-bg-prompt-allow>Allow background usage</button>
          </div>
        </div>
      </div>`;
    document.body.append(dialog);
    const closePrompt = () => {
      markBackgroundPromptSeen(currentProfile?.id);
      dialog.close?.();
    };
    dialog.querySelector('[data-bg-prompt-close]')?.addEventListener('click', closePrompt);
    dialog.querySelector('[data-bg-prompt-dismiss]')?.addEventListener('click', closePrompt);
    dialog.addEventListener('cancel', () => { markBackgroundPromptSeen(currentProfile?.id); });
    dialog.querySelector('[data-bg-prompt-settings]')?.addEventListener('click', async () => {
      markBackgroundPromptSeen(currentProfile?.id);
      dialog.dataset.attempted = '1';
      await getBackgroundNotificationsPlugin()?.openAppSettings?.().catch?.(() => null);
    });
    dialog.querySelector('[data-bg-prompt-allow]')?.addEventListener('click', async (event) => {
      const btn = event.currentTarget;
      markBackgroundPromptSeen(currentProfile?.id);
      dialog.dataset.attempted = '1';
      setBusy(btn, true, 'Allowing…');
      try {
        await requestBackgroundUsageAccess({ fromPrompt: true });
      } finally {
        setBusy(btn, false);
        if (dialog.open && lastBgSnapshot) syncBackgroundUsagePrompt(lastBgSnapshot);
      }
    });
    return dialog;
  }

  async function openBackgroundUsagePrompt(snapOverride = null) {
    bindDeviceNotificationControls();
    const snap = snapOverride || await collectDeviceBackgroundSnapshot();
    const dialog = ensureBackgroundUsagePromptDialog();
    syncBackgroundUsagePrompt(snap);
    if (!dialog.open) dialog.showModal?.();
    return dialog;
  }

  async function requestBackgroundUsageAccess({ fromPrompt = false } = {}) {
    if (!isInstalledAppUser()) {
      const status = await requestDeviceNotificationPermission({ userInitiated: true });
      return {
        notificationPermission: status,
        batteryOptimizationIgnored: true,
        granted: status === 'granted'
      };
    }
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (!hasNativeNotificationBridge() || typeof bgPlugin?.requestIgnoreBatteryOptimizations !== 'function') {
      openLatestApkDownload();
      return { notificationPermission: 'unsupported', batteryOptimizationIgnored: false, granted: false, needsApkUpdate: true };
    }
    let perm = await getDeviceNotificationPermission().catch(() => 'unsupported');
    if (perm === 'default') {
      perm = await requestDeviceNotificationPermission({ userInitiated: true }).catch(() => perm);
    }
    let bgStatus = bgPlugin?.getBackgroundStatus
      ? await bgPlugin.getBackgroundStatus().catch(() => null)
      : null;
    if (bgStatus && apkNeedsNativeUpdate(bgPlugin, bgStatus)) {
      openLatestApkDownload();
      return { notificationPermission: perm, batteryOptimizationIgnored: false, granted: false, needsApkUpdate: true };
    }
    if (bgStatus && bgStatus.batteryOptimizationIgnored === false && bgPlugin?.requestIgnoreBatteryOptimizations) {
      await new Promise((resolve) => setTimeout(resolve, perm === 'granted' ? 160 : 280));
      const batRes = await bgPlugin.requestIgnoreBatteryOptimizations().catch(() => null);
      if (!batRes?.launched && !batRes?.alreadyIgnored) {
        await bgPlugin.openAppSettings?.().catch?.(() => { });
      }
      bgStatus = bgPlugin?.getBackgroundStatus
        ? await bgPlugin.getBackgroundStatus().catch(() => bgStatus)
        : bgStatus;
    } else if (perm === 'denied') {
      const notifSettings = await bgPlugin?.openNotificationSettings?.().catch?.(() => null);
      if (!notifSettings?.launched) {
        await bgPlugin?.openAppSettings?.().catch?.(() => { });
      }
    }
    const latestSnap = await syncDevicePermissionUI().catch(() => null);
    const latestPerm = latestSnap?.status || perm;
    const batteryOk = latestSnap ? latestSnap.batteryOk : (!bgStatus || bgStatus.batteryOptimizationIgnored !== false);
    if (latestPerm === 'granted' && currentProfile) {
      lastBgPollSyncAt = 0;
      await syncBackgroundNotificationPolling(currentProfile, [], { force: true }).catch(() => { });
    }
    if (latestPerm === 'granted' && batteryOk) {
      if (fromPrompt) {
        document.getElementById('background-usage-prompt-dialog')?.close?.();
      }
      if (Date.now() - lastBgGrantedToastAt > 1200) {
        lastBgGrantedToastAt = Date.now();
        toast('Device alerts enabled while myIPON stays open (in-app only).');
      }
    }
    return {
      notificationPermission: latestPerm,
      batteryOptimizationIgnored: batteryOk,
      granted: latestPerm === 'granted' && batteryOk
    };
  }

  async function maybePromptBackgroundUsage(profile = currentProfile, { immediate = false, force = false } = {}) {
    if (!profile || profile.status !== 'ACTIVE' || profile.notifications_enabled === false) return false;
    if (!isInstalledAppUser() || !hasNativeNotificationBridge()) return false;
    if (document.body.classList.contains('security-page') || document.body.dataset.page === 'account' || profileNeedsSetup(profile)) {
      return false;
    }
    const seenKey = `myipon_bg_prompt_seen_${profile.id}`;
    if (!force && localStorage.getItem(seenKey)) return false;
    const snap = await collectDeviceBackgroundSnapshot().catch(() => null);
    if (!snap || (snap.status === 'granted' && (!snap.batteryKnown || snap.batteryOk))) return false;
    if (!immediate) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    if (document.querySelector('dialog[open]')) return false;
    markBackgroundPromptSeen(profile.id);
    await openBackgroundUsagePrompt(snap);
    return true;
  }

  async function syncDevicePermissionUI() {
    const rows = document.querySelectorAll('[data-device-notif-row]');
    const bgRows = document.querySelectorAll('[data-device-background-row]');
    const bar = document.getElementById('notification-permission-bar');
    const snap = await collectDeviceBackgroundSnapshot();
    syncBackgroundRowsUI(bgRows, snap);
    if (document.getElementById('background-usage-prompt-dialog')?.open) {
      syncBackgroundUsagePrompt(snap);
    }
    if (!snap.isMobile) {
      rows.forEach((row) => { row.hidden = true; });
      if (bar) {
        bar.hidden = true;
        bar.textContent = '';
      }
      return snap;
    }
    const { status, isApp, needsApkUpdate, nativeBgStatus, pushState, isIosBrowser } = snap;

    rows.forEach((row) => {
      row.hidden = false;
      const label = row.querySelector('[data-device-notif-status]');
      const button = row.querySelector('[data-device-notif-btn]');
      if (!label || !button) return;

      let actionsWrap = row.querySelector('.preference-device-actions');
      if (!actionsWrap) {
        actionsWrap = document.createElement('div');
        actionsWrap.className = 'preference-device-actions';
        button.parentNode.insertBefore(actionsWrap, button);
        actionsWrap.appendChild(button);
      }
      actionsWrap.querySelectorAll('[data-device-extra-btn]').forEach((el) => el.remove());

      if (needsApkUpdate) {
        label.textContent = 'Update to the latest myIPON APK for Microphone voice notes and smoother in-app notification alerts.';
        button.textContent = 'Update APK';
        button.dataset.actionMode = 'update-apk';
        button.disabled = false;
        button.hidden = false;
      } else if (status === 'granted') {
        if (isApp && nativeBgStatus && nativeBgStatus.batteryOptimizationIgnored === false) {
          label.textContent = 'Notification permission: On — keep myIPON open in recent apps to receive new messages and alerts (in-app only).';
          button.textContent = 'Allow always-on';
          button.dataset.actionMode = 'battery';
          button.disabled = false;
          button.hidden = false;
        } else if (isApp) {
          label.textContent = 'Notification permission: On — alerts arrive while myIPON is open (in-app only, not emailed).';
          button.textContent = 'On';
          delete button.dataset.actionMode;
          button.disabled = true;
          button.hidden = false;
        } else if (pushState.subscribed) {
          label.textContent = 'Notification permission: On — alerts appear while myIPON is open (not sent via email).';
          button.textContent = 'On';
          delete button.dataset.actionMode;
          button.disabled = true;
          button.hidden = false;
        } else if (pushState.supported) {
          label.textContent = 'Notification permission: On — tap Finish setup to sync in-app browser alerts.';
          button.textContent = 'Finish setup';
          button.dataset.actionMode = 'sync-push';
          button.disabled = false;
          button.hidden = false;
        } else {
          label.textContent = 'Notification permission: On — active while open (notifications are in-app only).';
          button.textContent = 'On';
          delete button.dataset.actionMode;
          button.disabled = true;
          button.hidden = false;
        }
      } else if (status === 'denied') {
        const canOpenNativeSettings = isApp && Boolean(getBackgroundNotificationsPlugin()?.openNotificationSettings);
        label.textContent = canOpenNativeSettings
          ? 'Device permission: Blocked in Android settings — open settings, turn on Notifications, then tap Recheck.'
          : 'Device permission: Blocked in browser settings — allow notifications for this site, then tap Recheck.';
        button.textContent = canOpenNativeSettings ? 'Open settings' : 'How to unblock';
        button.dataset.actionMode = canOpenNativeSettings ? 'open-settings' : 'unblock-help';
        button.disabled = false;
        button.hidden = false;
        const recheckBtn = document.createElement('button');
        recheckBtn.type = 'button';
        recheckBtn.className = 'button button-secondary button-sm';
        recheckBtn.textContent = 'Recheck';
        recheckBtn.setAttribute('data-device-recheck-btn', '');
        recheckBtn.setAttribute('data-device-extra-btn', '');
        actionsWrap.appendChild(recheckBtn);
      } else if (status === 'default') {
        label.textContent = isApp
          ? 'Device permission: Off — tap Turn on for in-app banner alerts while myIPON is open.'
          : 'Browser site permission: Off — click Turn on and choose Allow (PC settings alone keep this site Off).';
        button.textContent = 'Turn on';
        delete button.dataset.actionMode;
        button.disabled = false;
        button.hidden = false;
      } else if (status === 'insecure') {
        label.textContent = 'Site notifications require HTTPS or localhost (unavailable on plain HTTP LAN URLs).';
        button.hidden = true;
      } else if (isIosBrowser) {
        label.textContent = 'On iPhone/iPad, tap Share -> Add to Home Screen, then open myIPON directly for in-app alerts.';
        button.hidden = true;
      } else {
        label.textContent = 'Device notification drawer alerts are unavailable on this browser.';
        button.hidden = true;
      }
    });

    if (bar) {
      const bgPlugin = getBackgroundNotificationsPlugin();
      if (needsApkUpdate) {
        bar.hidden = false;
        bar.innerHTML = '<span>Update your installed APK to enable Microphone permission and smoother in-app alerts.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn data-action-mode="update-apk">Update APK</button>';
      } else if (status === 'default') {
        bar.hidden = false;
        bar.innerHTML = isApp
          ? '<span>Device notifications are off. Tap Turn on for alerts while myIPON is open (in-app only).</span><button class="button button-sm button-primary" type="button" data-device-notif-btn>Turn on</button>'
          : '<span>Browser notifications for this site are off. Click Turn on, then allow notifications for this site.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn>Turn on</button>';
      } else if (status === 'granted' && isApp && nativeBgStatus && nativeBgStatus.batteryOptimizationIgnored === false) {
        bar.hidden = false;
        bar.innerHTML = '<span>Notification permission is On — keep myIPON open in recent apps to receive new messages and alerts reliably.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn data-action-mode="battery">Allow always-on</button>';
      } else if (status === 'denied') {
        const canOpenNativeSettings = isApp && Boolean(bgPlugin?.openNotificationSettings);
        bar.hidden = false;
        bar.innerHTML = canOpenNativeSettings
          ? '<span>Device notifications are turned off in Android settings.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn data-action-mode="open-settings">Open settings</button>'
          : '<span>Device notifications are blocked by your browser. Allow notifications in site settings to receive alerts.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn data-action-mode="unblock-help">How to unblock</button>';
      } else if (isIosBrowser) {
        bar.hidden = false;
        bar.innerHTML = '<span>Add myIPON to your Home Screen from Safari Share to receive alerts while the app is closed.</span>';
      } else {
        bar.hidden = true;
        bar.textContent = '';
      }
    }
    return snap;
  }

  async function requestDeviceNotificationPermission({ userInitiated = false, nativePromptPromise = null } = {}) {
    const plugin = getLocalNotificationsPlugin();
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (nativePromptPromise) {
      try {
        await nativePromptPromise;
      } catch { /* ignore */ }
    }
    let status = await getDeviceNotificationPermission();
    if (status === 'default') {
      if (plugin?.requestPermissions) {
        await ensureAndroidNotificationChannel();
        try {
          const res = await plugin.requestPermissions();
          status = normalizeNotificationPermission(res?.display);
        } catch { /* ignore */ }
      }
      if (status === 'default' && bgPlugin?.requestSystemPermission) {
        try {
          await bgPlugin.requestSystemPermission();
          await new Promise((resolve) => setTimeout(resolve, 600));
          status = await getDeviceNotificationPermission();
        } catch { /* ignore */ }
      }
      if (!nativePromptPromise && status === 'default' && 'Notification' in window && userInitiated) {
        try {
          const res = await Notification.requestPermission();
          status = normalizeNotificationPermission(res);
        } catch { /* ignore */ }
      }
    } else if (status === 'granted' && plugin) {
      await ensureAndroidNotificationChannel();
    }
    if (status === 'granted' && currentProfile?.notifications_enabled !== false) {
      lastBgPollSyncAt = 0;
      await syncBackgroundNotificationPolling(currentProfile, [], { force: true }).catch(() => { });
      await syncWebPushSubscription({ force: true }).catch(() => { });
    }
    await syncDevicePermissionUI();
    return status;
  }

  function openNotificationUnblockGuide({ suppressedPrompt = false } = {}) {
    let dialog = document.getElementById('notification-unblock-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'notification-unblock-dialog';
      dialog.className = 'confirm-dialog';
      dialog.setAttribute('aria-labelledby', 'notif-unblock-title');
      dialog.innerHTML = `
        <form method="dialog">
          <h2 id="notif-unblock-title">Allow blocked notifications</h2>
          <p id="notif-unblock-desc"></p>
          <ul style="margin:0 0 22px;padding-left:18px;display:grid;gap:8px;font:13.5px/1.45 Arial,sans-serif;color:var(--ink-soft, #324841)">
            <li><strong>Chrome / Edge (PC or Laptop):</strong> Click the tune / site-info or bell icon beside the website address bar &rarr; change <strong>Notifications</strong> to <strong>Allow</strong>.</li>
            <li><strong>Chrome (Android browser):</strong> Tap the tune icon beside the address bar &rarr; <strong>Permissions</strong> &rarr; turn <strong>Notifications</strong> ON (or check Phone Settings &rarr; Apps &rarr; Chrome &rarr; Notifications).</li>
            <li><strong>myIPON Android App:</strong> Open Phone <strong>Settings &rarr; Apps &rarr; myIPON &rarr; Notifications</strong> &rarr; toggle <strong>Allow notifications</strong> ON.</li>
            <li><strong>Safari (Mac / iPhone):</strong> Open <strong>Safari Settings &rarr; Websites &rarr; Notifications</strong> (or iPhone Settings &rarr; myIPON) &rarr; set to <strong>Allow</strong>.</li>
          </ul>
          <div class="dialog-actions">
            <button class="button button-secondary" type="submit">Close</button>
            <button class="button button-primary" type="button" data-device-recheck-btn>Recheck permission</button>
          </div>
        </form>
      `;
      document.body.append(dialog);
    }
    const titleEl = dialog.querySelector('#notif-unblock-title');
    const descEl = dialog.querySelector('#notif-unblock-desc');
    if (titleEl) {
      titleEl.textContent = suppressedPrompt
        ? 'Allow notifications for this site'
        : 'Allow blocked notifications';
    }
    if (descEl) {
      descEl.textContent = suppressedPrompt
        ? 'Even when PC system notifications are On, your browser still needs site-level approval (or hid the popup quietly). Follow the steps below, then tap Recheck permission:'
        : 'Once blocked in browser or phone settings, only you can re-enable permission for security reasons. Follow the steps for your device, then tap Recheck permission:';
    }
    if (!dialog.open) dialog.showModal();
  }

  async function recheckDeviceNotificationPermission() {
    const status = await requestDeviceNotificationPermission({ userInitiated: true });
    if (status === 'granted') {
      document.getElementById('notification-unblock-dialog')?.close?.();
      toast('Background notification alerts enabled.');
    } else if (status === 'denied') {
      toast('Still blocked. Allow notifications for myIPON in device or browser settings, then tap Recheck.', 'error');
    } else {
      document.getElementById('notification-unblock-dialog')?.close?.();
    }
    return status;
  }

  async function handleBackgroundRowAction(button) {
    const action = button?.dataset?.bgAction;
    if (!action) return;
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (action === 'update-apk') {
      openLatestApkDownload();
      return;
    }
    const runBusyRowAction = async (busyLabel, task) => {
      const row = button.closest?.('[data-device-background-row]');
      setBusy(button, true, busyLabel);
      try {
        return await task();
      } finally {
        setBusy(button, false);
        if (row && lastBgSnapshot) syncBackgroundRowsUI([row], lastBgSnapshot);
      }
    };
    if (action === 'allow-all' || action === 'allow-background') {
      await runBusyRowAction('Allowing…', () => requestBackgroundUsageAccess());
      return;
    }
    if (action === 'app-settings') {
      const outcome = await bgPlugin?.openAppSettings?.().catch?.(() => null);
      if (!outcome?.launched) openNotificationUnblockGuide();
      return;
    }
    if (action === 'notif-settings') {
      const outcome = await bgPlugin?.openNotificationSettings?.().catch?.(() => null);
      if (!outcome?.launched) {
        const fallback = await bgPlugin?.openAppSettings?.().catch?.(() => null);
        if (!fallback?.launched) openNotificationUnblockGuide();
      }
      return;
    }
    if (action === 'recheck') {
      await runBusyRowAction('Checking…', async () => {
        const snap = await syncDevicePermissionUI();
        if (snap?.status === 'granted' && (!snap.isApp || snap.batteryOk)) {
          if (currentProfile) {
            lastBgPollSyncAt = 0;
            await syncBackgroundNotificationPolling(currentProfile).catch(() => { });
          }
          toast('Device alerts enabled while myIPON stays open (in-app only).');
        } else if (snap?.isApp && snap.status === 'granted' && !snap.batteryOk) {
          toast('Battery restriction is still active. Set Battery to Unrestricted in App settings.', 'error');
        } else {
          toast('Notifications are still off. Allow Notifications in settings, then tap Recheck.', 'error');
        }
      });
      return;
    }
    if (action === 'unblock-help') {
      openNotificationUnblockGuide();
      return;
    }
    if (action === 'sync-push') {
      button.disabled = true;
      try {
        const ok = await syncWebPushSubscription({ force: true });
        await syncDevicePermissionUI();
        if (ok) toast('Device push notifications synced for myIPON alerts.');
        else toast('Could not register background push on this browser.', 'error');
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (action === 'enable-notif') {
      const nativePromptPromise = (!hasNativeNotificationBridge() && window.isSecureContext !== false
        && 'Notification' in window && Notification.permission === 'default')
        ? Promise.resolve(Notification.requestPermission()).catch(() => Notification.permission)
        : null;
      button.disabled = true;
      const result = await requestDeviceNotificationPermission({ userInitiated: true, nativePromptPromise });
      if (result === 'granted') {
        toast('Background notification alerts enabled.');
      } else if (result === 'denied') {
        toast('Notifications are blocked in your device or browser settings.', 'error');
      } else {
        toast('Click Turn on and choose Allow when your browser asks for notifications.', 'error');
      }
    }
  }

  function bindDeviceNotificationControls() {
    if (!document.body.dataset.boundDeviceNotifDelegation) {
      document.body.dataset.boundDeviceNotifDelegation = 'true';
      const resyncOnReturn = async () => {
        if (document.visibilityState === 'hidden') return;
        const wasNotGranted = Boolean(document.querySelector(
          '[data-action-mode="unblock-help"],[data-action-mode="open-settings"],[data-device-notif-row] [data-device-notif-btn]:not([data-action-mode]):not([disabled])'
        ));
        const promptOpen = Boolean(document.getElementById('background-usage-prompt-dialog')?.open);
        const bgRowPending = Boolean(document.querySelector('[data-device-background-row]:not([hidden]) [data-device-bg-pill]:not([data-tone="success"])'));
        const snap = await syncDevicePermissionUI().catch(() => null);
        const status = snap?.status || await getDeviceNotificationPermission().catch(() => 'unsupported');
        const fullBgGranted = Boolean(snap && snap.status === 'granted' && (!snap.isApp || (snap.batteryKnown && snap.batteryOk)));
        const shouldSyncBgService = Boolean(
          currentProfile
          && currentProfile.notifications_enabled !== false
          && status === 'granted'
          && snap?.isApp
          && (
            snap?.nativeBgStatus?.instantSyncRunning === false
            || snap?.nativeBgStatus?.wsConnected === false
            || snap?.nativeBgStatus?.hasFeedConfig === false
          )
        );
        if (wasNotGranted && status === 'granted') {
          await requestDeviceNotificationPermission({ userInitiated: false }).catch(() => { });
          document.getElementById('notification-unblock-dialog')?.close?.();
        }
        if ((promptOpen || bgRowPending || wasNotGranted) && fullBgGranted) {
          if (promptOpen) {
            document.getElementById('background-usage-prompt-dialog')?.close?.();
          }
          document.getElementById('notification-unblock-dialog')?.close?.();
          if (currentProfile && currentProfile.notifications_enabled !== false) {
            lastBgPollSyncAt = 0;
            await syncBackgroundNotificationPolling(currentProfile, [], { force: true }).catch(() => { });
          }
          if (Date.now() - lastBgGrantedToastAt > 1200) {
            lastBgGrantedToastAt = Date.now();
            toast(snap?.isApp
              ? 'Device alerts enabled while myIPON stays open (in-app only).'
              : 'Device notification alerts enabled.');
          }
        } else if (shouldSyncBgService) {
          lastBgPollSyncAt = 0;
          await syncBackgroundNotificationPolling(currentProfile, [], { force: true }).catch(() => { });
        }
      };
      document.addEventListener('visibilitychange', resyncOnReturn);
      window.addEventListener('focus', resyncOnReturn);
      document.body.addEventListener('click', async (event) => {
        const bgActionBtn = event.target.closest('[data-device-bg-btn], [data-device-background-row] [data-bg-action]');
        if (bgActionBtn) {
          await handleBackgroundRowAction(bgActionBtn);
          return;
        }
        const recheckBtn = event.target.closest('[data-device-recheck-btn]');
        if (recheckBtn) {
          recheckBtn.disabled = true;
          try { await recheckDeviceNotificationPermission(); }
          finally { recheckBtn.disabled = false; }
          return;
        }
        const testBtn = event.target.closest('[data-device-test-btn]');
        if (testBtn) {
          testBtn.disabled = true;
          try {
            const result = await sendBackgroundTestNotification();
            if (isInstalledAppUser()) {
              if (result?.native_ping_sent) {
                toast('Test alert sent to your Android notification drawer.');
              } else if (result?.native_has_token === false) {
                toast('Background feed token is not registered yet. Reopen My account or sign in again.', 'error');
              } else {
                toast('Test alert requested. Check your notification drawer.');
              }
            } else if (result?.web_sent > 0) {
              toast('Test alert sent. Keep myIPON open to receive real-time alerts (in-app only).');
            } else {
              toast('Background push registered. Retry test if the banner did not appear.', 'error');
            }
          } catch (error) {
            toast(friendlyError(error), 'error');
          } finally {
            testBtn.disabled = false;
          }
          return;
        }
        const button = event.target.closest('[data-device-notif-btn]');
        if (!button) return;
        if (button.dataset.actionMode === 'update-apk' || (isInstalledAppUser() && apkNeedsNativeUpdate())) {
          openLatestApkDownload();
          return;
        }
        if (button.dataset.actionMode === 'open-settings') {
          const outcome = await getBackgroundNotificationsPlugin()?.openNotificationSettings?.().catch?.(() => null);
          if (!outcome?.launched) openNotificationUnblockGuide();
          return;
        }
        if (button.dataset.actionMode === 'unblock-help') {
          openNotificationUnblockGuide();
          return;
        }
        if (button.dataset.actionMode === 'battery') {
          await getBackgroundNotificationsPlugin()?.requestIgnoreBatteryOptimizations?.().catch?.(() => { });
          setTimeout(() => { syncDevicePermissionUI().catch(() => { }); }, 800);
          return;
        }
        if (button.dataset.actionMode === 'sync-push') {
          button.disabled = true;
          const ok = await syncWebPushSubscription({ force: true });
          await syncDevicePermissionUI();
          if (ok) toast('Device push notifications synced for myIPON alerts.');
          else toast('Could not register background push on this browser.', 'error');
          return;
        }
        const startMs = Date.now();
        const nativePromptPromise = (!hasNativeNotificationBridge() && window.isSecureContext !== false
          && 'Notification' in window && Notification.permission === 'default')
          ? Promise.resolve(Notification.requestPermission()).catch(() => Notification.permission)
          : null;
        button.disabled = true;
        const result = await requestDeviceNotificationPermission({ userInitiated: true, nativePromptPromise });
        if (result === 'granted') {
          toast('Background notification alerts enabled.');
        } else if (result === 'denied') {
          toast('Notifications are blocked in your device or browser settings.', 'error');
        } else if (result === 'default') {
          if (!hasNativeNotificationBridge() && Date.now() - startMs < 250) {
            openNotificationUnblockGuide({ suppressedPrompt: true });
          } else {
            toast('Click Turn on and choose Allow when your browser asks for notifications.', 'error');
          }
        }
      });
    }
    syncDevicePermissionUI().catch(() => { });
  }

  function safeNotificationTarget(link) {
    if (!link || typeof link !== 'string') return '';
    if (/^https:\/\//i.test(link)) return link;
    const clean = link.replace(/^\/+/, '');
    return /^[a-z0-9_-]+\.html(?:\?[a-z0-9_=&:%.-]+)?(?:#[a-z0-9_-]+)?$/i.test(clean) ? clean : '';
  }

  function attachNativeNotificationTapListener() {
    const plugin = getLocalNotificationsPlugin();
    if (!plugin?.addListener || nativeNotifListenerAttached) return;
    nativeNotifListenerAttached = true;
    plugin.addListener('localNotificationActionPerformed', (event) => {
      const target = normalizeRolePageTarget(event?.notification?.extra?.link);
      if (!target) return;
      navigateNotificationTarget(target, { closeDialog: false });
    }).catch?.(() => { });
  }

  function buildLocalNotificationId(rawId) {
    const numeric = Number(rawId);
    if (Number.isInteger(numeric) && numeric > 0 && numeric < 900000) return numeric;
    const text = String(rawId || Date.now());
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = ((hash * 31) + text.charCodeAt(i)) % 890000;
    return Math.abs(hash) + 1000;
  }

  function readShownNotificationIds(userId) {
    try {
      const raw = JSON.parse(localStorage.getItem(`myipon_shown_notifs_${userId}`) || '[]');
      return Array.isArray(raw) ? raw.map(String) : [];
    } catch {
      return [];
    }
  }

  function notifShownKey(item) {
    if (!item || item.id == null) return '';
    return item.dedupe_key ? `${item.id}:${item.created_at || item.message || ''}` : String(item.id);
  }

  function markDeviceNotificationShown(userId, id) {
    const key = String(id);
    const list = readShownNotificationIds(userId).filter((item) => item !== key);
    list.push(key);
    try {
      localStorage.setItem(`myipon_shown_notifs_${userId}`, JSON.stringify(list.slice(-80)));
    } catch { /* ignore storage quota errors */ }
    getBackgroundNotificationsPlugin()?.markShown?.({ id: key }).catch?.(() => { });
  }

  async function syncBackgroundNotificationPolling(profile, rows = [], { force = false } = {}) {
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (!bgPlugin?.configure || !configured) return;
    if (!profile || profile.notifications_enabled === false) {
      await bgPlugin.clear?.().catch?.(() => { });
      return;
    }
    const now = Date.now();
    if (!force && now - lastBgPollSyncAt < 60_000) return;
    lastBgPollSyncAt = now;
    try {
      const feedToken = await rpc('ensure_notification_feed_token');
      if (!feedToken) return;
      const shownIds = new Set(readShownNotificationIds(profile.id));
      rows.forEach((item) => {
        if (item?.id != null) {
          shownIds.add(String(item.id));
          const key = notifShownKey(item);
          if (key) shownIds.add(key);
        }
      });
      await bgPlugin.configure({
        supabaseUrl: config.supabaseUrl,
        anonKey: config.supabaseAnonKey,
        feedToken: String(feedToken),
        shownIds: [...shownIds].slice(-80)
      });
    } catch {
      lastBgPollSyncAt = 0;
    }
  }

  async function setNotificationPreference(enabled) {
    await rpc('set_notification_preferences', { p_enabled: Boolean(enabled) });
    if (currentProfile) currentProfile.notifications_enabled = Boolean(enabled);
    lastBgPollSyncAt = 0;
    lastWebPushSyncAt = 0;
    if (enabled) {
      await syncBackgroundNotificationPolling(currentProfile, [], { force: true }).catch(() => { });
      await syncWebPushSubscription({ force: true }).catch(() => { });
    } else {
      await rpc('revoke_notification_feed_token').catch(() => { });
      await getBackgroundNotificationsPlugin()?.clear?.().catch?.(() => { });
      await removeWebPushSubscription().catch(() => { });
    }
    await syncDevicePermissionUI().catch(() => { });
  }

  async function dispatchDeviceNotification(item, userId) {
    if (!isMobileDeviceNotifClient() || !item || item.read_at || currentProfile?.notifications_enabled === false) return;
    const notifKey = notifShownKey(item) || String(item.id);
    const trayKey = item.dedupe_key ? String(item.dedupe_key) : notifKey;
    if (readShownNotificationIds(userId).includes(notifKey)) return;
    const permission = await getDeviceNotificationPermission();
    if (permission !== 'granted') return;
    markDeviceNotificationShown(userId, notifKey);

    const title = item.title || 'myIPON';
    const body = item.message || '';
    const target = resolveNotificationTarget(item) || safeNotificationTarget(item.link) || 'dashboard.html';
    const plugin = getLocalNotificationsPlugin();
    if (plugin?.schedule) {
      await ensureAndroidNotificationChannel();
      try {
        await plugin.schedule({
          notifications: [{
            id: buildLocalNotificationId(trayKey),
            title,
            body,
            channelId: 'myipon_alerts',
            extra: { link: target }
          }]
        });
        return;
      } catch { /* fall through */ }
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
        if (reg?.showNotification) {
          await reg.showNotification(title, {
            body,
            icon: '/assets/icon-192.png',
            badge: '/assets/icon-192.png',
            tag: `myipon-${trayKey}`,
            renotify: Boolean(item.dedupe_key),
            vibrate: [180, 70, 180],
            data: { url: target }
          });
          return;
        }
        const n = new Notification(title, { body, icon: '/assets/icon-192.png', tag: `myipon-${trayKey}` });
        n.onclick = () => {
          window.focus();
          if (target) window.location.href = target;
          n.close();
        };
      } catch { /* ignore */ }
    }
  }

  const notificationItemsById = new Map();
  let activeAnnouncementsController = null;
  let activeNotificationsReload = null;
  const MONTH_NAMES_LOOKUP = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };

  function encodeQueryValue(value) {
    return encodeURIComponent(String(value ?? '')).replace(/[!'()*~]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  function extractMonthIsoFromText(text) {
    const match = String(text || '').match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(20\d{2})\b/i);
    if (!match) return '';
    const mm = MONTH_NAMES_LOOKUP[match[1].toLowerCase()];
    return mm ? `${match[2]}-${mm}` : '';
  }

  function normalizeRolePageTarget(rawTarget, role = currentProfile?.role || 'MEMBER') {
    const target = safeNotificationTarget(rawTarget);
    if (!target || /^https?:\/\//i.test(target)) return target;
    let parsed;
    try {
      parsed = new URL(target, 'https://ipon.local');
    } catch {
      return target;
    }
    let page = parsed.pathname.replace(/^\/+/, '');
    const params = parsed.searchParams;
    let hash = parsed.hash || '';

    if (role === 'SUPER_ADMIN') {
      if (params.has('announcement') || params.has('release') || params.has('announcement_title')) {
        page = 'super-admin.html';
        if (!hash) hash = '#announcements';
      } else if (page === 'user.html' || page === 'contributions.html' || page === 'withdrawals.html' || page === 'expenses.html' || page === 'budget.html' || page === 'members.html' || page === 'settings.html') {
        page = 'super-admin.html';
      }
    } else if (role !== 'MEMBER' && page === 'user.html') {
      if (params.has('record') || params.has('thread') || params.has('reminder') || params.has('exemption')) {
        page = 'contributions.html';
      } else {
        page = 'dashboard.html';
      }
    } else if (role === 'MEMBER') {
      if (page === 'contributions.html' && (params.has('record') || params.has('thread') || params.has('reminder') || params.has('exemption'))) {
        const ref = params.get('record') || params.get('thread') || '';
        if (!ref || ref.startsWith('contribution:')) page = 'user.html';
      }
      if ((page === 'dashboard.html' || page === 'contributions.html') && (params.has('reminder') || params.has('exemption'))) {
        page = 'user.html';
      }
    }

    const search = params.toString();
    return `${page}${search ? `?${search}` : ''}${hash}`;
  }

  function resolveNotificationTarget(item, role = currentProfile?.role || 'MEMBER') {
    if (!item || typeof item !== 'object') return safeNotificationTarget(item);
    const annPage = role === 'SUPER_ADMIN' ? 'super-admin.html' : 'dashboard.html';
    const annHash = role === 'SUPER_ADMIN' ? '#announcements' : '';
    const type = String(item.type || '').toUpperCase();
    const title = String(item.title || '');
    const message = String(item.message || '');
    const rawLink = typeof item.link === 'string' ? item.link.trim() : '';

    if (item.id === 'system-app-release-notice' || type === 'RELEASE' || /github\.com\/[^/]+\/Ipon-Tracking-System\/releases/i.test(rawLink)) {
      const normalized = normalizeRolePageTarget(rawLink, role);
      if (normalized && !/^https?:\/\//i.test(normalized) && (normalized.includes('announcement=') || normalized.includes('release='))) {
        return normalized;
      }
      const verMatch = `${title} ${message}`.match(/\b(?:version|update)\s+(v?\d+(?:\.\d+)+)/i) || title.match(/\b(v?\d+(?:\.\d+)+)\b/i);
      const ver = verMatch ? verMatch[1].replace(/^v/i, '') : 'latest';
      return `${annPage}?release=${encodeQueryValue(ver)}${annHash}`;
    }

    const safe = safeNotificationTarget(rawLink);
    if (safe && !/^https?:\/\//i.test(safe) && safe.includes('?')) {
      return normalizeRolePageTarget(safe, role);
    }

    const dedupe = String(item.dedupe_key || '');
    if (type === 'ANNOUNCEMENT_REACTION') {
      const match = dedupe.match(/^ANNOUNCEMENT_REACTION:([0-9a-f-]+):/i);
      if (match) return `${annPage}?announcement=${encodeQueryValue(match[1])}${annHash}`;
      const quoted = message.match(/to\s+"([^"]+)"\s*\.?$/i);
      if (quoted) return `${annPage}?announcement_title=${encodeQueryValue(quoted[1])}${annHash}`;
      return `${annPage}?notice=${encodeQueryValue(item.id || 'announcement-reaction')}${annHash}`;
    }

    if (type === 'ANNOUNCEMENT' || type === 'PLATFORM_ANNOUNCEMENT') {
      const stripped = title.replace(/^(?:Announcement|Platform update):\s*/i, '').trim();
      if (stripped) return `${annPage}?announcement_title=${encodeQueryValue(stripped)}${annHash}`;
      return `${annPage}${annHash}`;
    }

    if (type === 'RECORD_COMMENT') {
      const match = dedupe.match(/^RECORD_COMMENT:(contribution|withdrawal|expense):([0-9a-f-]+)$/i);
      if (match) {
        const page = match[1] === 'contribution'
          ? (role === 'MEMBER' ? 'user.html' : 'contributions.html')
          : `${match[1]}s.html`;
        return `${page}?thread=${encodeQueryValue(`${match[1]}:${match[2]}`)}`;
      }
    }

    if (type === 'CONTRIBUTION_REMINDER' || type === 'PERIOD_EXEMPTION') {
      const monthIso = extractMonthIsoFromText(`${title} ${message}`);
      const page = role === 'MEMBER' ? 'user.html' : 'contributions.html';
      const param = type === 'PERIOD_EXEMPTION' ? 'exemption' : 'reminder';
      if (monthIso) return `${page}?${param}=${encodeQueryValue(monthIso)}`;
      return `${page}?notice=${encodeQueryValue(item.id || param)}`;
    }

    if (type === 'FEATURE_REQUEST') {
      return `super-admin.html?notice=${encodeQueryValue(item.id || 'feature-request')}#feature-requests`;
    }

    if (type === 'BUG_REPORT') {
      return `super-admin.html?notice=${encodeQueryValue(item.id || 'bug-report')}#bug-reports`;
    }

    if (type === 'ADMIN_REQUEST') {
      return `super-admin.html?notice=${encodeQueryValue(item.id || 'admin-request')}#administrators`;
    }

    if (type === 'GROUP_INVITE') {
      return `dashboard.html?notice=${encodeQueryValue(item.id || 'group-invite')}`;
    }

    if (type === 'GROUP_JOIN_REQUEST') {
      return 'settings.html?join_requests=1#access';
    }

    if (type === 'GROUP_JOIN_APPROVED') {
      return `user.html?notice=${encodeQueryValue(item.id || 'join-approved')}`;
    }

    if (type === 'GROUP_JOINED_VIA_CODE') {
      return safe && !/^https?:\/\//i.test(safe) ? safe : 'settings.html#access';
    }

    if (type === 'RECORD_CHANGE_REQUESTED') {
      return safe && !/^https?:\/\//i.test(safe) ? safe : 'dashboard.html?change_request=pending';
    }

    if (type === 'RECORD_CHANGE_REVIEWED' || type === 'PERMISSION_UPDATED') {
      return safe && !/^https?:\/\//i.test(safe) ? safe : 'dashboard.html';
    }

    if (type === 'REVIEW_REQUIRED' || type === 'RECORD_UPDATED') {
      return `dashboard.html?review_notice=${encodeQueryValue(item.id || '')}`;
    }

    if (type.startsWith('SOCIAL_') && role !== 'SUPER_ADMIN') {
      const currentFile = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
      const targetPage = ['index.html', 'login.html', 'mfa.html', 'reset-password.html', 'super-admin.html'].includes(currentFile)
        ? 'dashboard.html'
        : currentFile;
      if (safe && !/^https?:\/\//i.test(safe)) {
        const qIndex = safe.indexOf('?');
        const query = qIndex >= 0 ? safe.slice(qIndex) : '?messages=inbox';
        return `${targetPage}${query}`;
      }
      return `${targetPage}?messages=inbox`;
    }

    const baseTarget = safe && !/^https?:\/\//i.test(safe)
      ? normalizeRolePageTarget(safe, role)
      : (item.id ? `${location.pathname.split('/').pop() || homeForRole(role)}?notice=${encodeQueryValue(item.id)}` : '');

    if (!baseTarget) return '';
    if (baseTarget.includes('?')) return baseTarget;
    const [pathPart, hashPart = ''] = baseTarget.split('#');
    return item.id
      ? `${pathPart}?notice=${encodeQueryValue(item.id)}${hashPart ? `#${hashPart}` : ''}`
      : baseTarget;
  }

  function highlightFocus(targetOrSelector, { block = 'center' } = {}) {
    const el = typeof targetOrSelector === 'string'
      ? document.querySelector(targetOrSelector)
      : targetOrSelector;
    if (!el) return null;
    try { el.scrollIntoView({ behavior: 'smooth', block }); } catch { /* ignore */ }
    el.classList?.remove('is-highlight-focus');
    void el.offsetWidth;
    el.classList?.add('is-highlight-focus');
    window.setTimeout(() => el.classList?.remove('is-highlight-focus'), 4500);
    return el;
  }

  async function fetchSingleRecordEntry(recordType, recordId) {
    const client = getClient();
    if (!client) throw new Error('Supabase is not connected.');
    const type = String(recordType || '').toLowerCase();
    if (!recordId || !['contribution', 'withdrawal', 'expense'].includes(type)) return null;
    const formatReviewNote = (row) => {
      const notes = [];
      if (row.review_note) notes.push(`Review note: ${row.review_note}`);
      if (row.void_reason) notes.push(`Void reason: ${row.void_reason}`);
      return notes.join(' · ');
    };
    if (type === 'contribution') {
      const { data, error } = await client
        .from('contributions')
        .select('id,amount,payment_date,transaction_reference,payment_method,notes,receipt_url,approval_status,void_reason,review_note,submitted_by,contribution_periods(period_month,members(id,full_name))')
        .eq('id', recordId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const memberName = data.contribution_periods?.members?.full_name || 'Member contribution';
      return {
        type: 'contribution',
        typeLabel: 'Savings Addition',
        id: data.id,
        title: memberName,
        authorName: memberName,
        memberName,
        amount: data.amount,
        date: data.payment_date,
        periodMonth: data.contribution_periods?.period_month || null,
        period_month: data.contribution_periods?.period_month || null,
        reference: data.transaction_reference,
        paymentMethod: data.payment_method || '',
        payment_method: data.payment_method,
        notes: data.notes,
        receiptUrl: data.receipt_url || '',
        receipt_url: data.receipt_url,
        status: data.approval_status || 'PENDING',
        approval_status: data.approval_status,
        reviewNote: formatReviewNote(data),
        review_note: data.review_note,
        void_reason: data.void_reason,
        submitted_by: data.submitted_by
      };
    }
    if (type === 'withdrawal') {
      const { data, error } = await client
        .from('withdrawals')
        .select('id,amount,transaction_date,transaction_reference,payment_method,reason,person_responsible,notes,receipt_url,approval_status,void_reason,review_note,submitted_by')
        .eq('id', recordId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const authorName = data.person_responsible || 'Group treasurer';
      return {
        type: 'withdrawal',
        typeLabel: 'Deduction',
        id: data.id,
        title: data.reason || 'Savings deduction',
        authorName,
        person_responsible: data.person_responsible,
        description: data.reason,
        amount: data.amount,
        date: data.transaction_date,
        reference: data.transaction_reference,
        paymentMethod: data.payment_method || '',
        payment_method: data.payment_method,
        notes: data.notes || data.reason,
        receiptUrl: data.receipt_url || '',
        receipt_url: data.receipt_url,
        status: data.approval_status || 'PENDING',
        approval_status: data.approval_status,
        reviewNote: formatReviewNote(data),
        review_note: data.review_note,
        void_reason: data.void_reason,
        submitted_by: data.submitted_by
      };
    }
    const { data, error } = await client
      .from('expenses')
      .select('id,amount,expense_date,category,description,person_responsible,reference_number,payment_method,notes,receipt_url,approval_status,void_reason,review_note,submitted_by')
      .eq('id', recordId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const authorName = data.person_responsible || 'Group treasurer';
    return {
      type: 'expense',
      typeLabel: 'Expense',
      id: data.id,
      title: data.category || data.description || 'Expense',
      authorName,
      category: data.category,
      description: data.description,
      amount: data.amount,
      date: data.expense_date,
      person_responsible: data.person_responsible,
      reference: data.reference_number,
      paymentMethod: data.payment_method || '',
      payment_method: data.payment_method,
      notes: data.notes,
      receiptUrl: data.receipt_url || '',
      receipt_url: data.receipt_url,
      status: data.approval_status || 'PENDING',
      approval_status: data.approval_status,
      reviewNote: formatReviewNote(data),
      review_note: data.review_note,
      void_reason: data.void_reason,
      submitted_by: data.submitted_by
    };
  }

  function renderNoticeModalContent({
    title = 'Notification details',
    subtitle = '',
    statusLabel = '',
    statusClass = 'status-confirmed',
    message = '',
    meta = [],
    actions = []
  } = {}) {
    const dialog = document.getElementById('notice-detail-dialog');
    if (!dialog) return null;
    if (!dialog.dataset?.deepLinkCleanBound && typeof dialog.addEventListener === 'function') {
      if (dialog.dataset) dialog.dataset.deepLinkCleanBound = '1';
      dialog.addEventListener('close', clearDeepLinkUrlState);
    }
    const titleEl = document.getElementById('notice-detail-title');
    const subtitleEl = document.getElementById('notice-detail-subtitle');
    const bodyEl = document.getElementById('notice-detail-body');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle || 'Alert summary';
    if (!bodyEl) return null;

    const pillHtml = statusLabel
      ? `<span class="status ${escapeHtml(statusClass)}">${escapeHtml(statusLabel)}</span>`
      : '';
    const metaHtml = meta.filter(Boolean).map((entry) => `<span>${escapeHtml(entry)}</span>`).join('');
    bodyEl.innerHTML = `
      <div class="notice-detail-card">
        ${pillHtml ? `<div class="notice-detail-top">${pillHtml}</div>` : ''}
        <p class="notice-detail-message">${escapeHtml(message || '')}</p>
        ${metaHtml ? `<div class="notice-detail-meta">${metaHtml}</div>` : ''}
      </div>
      <div class="notice-detail-actions" id="notice-detail-actions"></div>
    `;
    const actionsEl = document.getElementById('notice-detail-actions');
    const finalActions = [...actions, { label: 'Close', variant: 'secondary', onClick: () => dialog.close() }];
    finalActions.forEach((act) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `button ${act.variant === 'primary' ? 'button-primary' : act.variant === 'danger' ? 'button-danger' : 'button-secondary'}`;
      btn.textContent = act.label;
      btn.addEventListener('click', () => act.onClick?.(dialog, btn));
      actionsEl.appendChild(btn);
    });
    if (!dialog.open) dialog.showModal();
    return dialog;
  }

  async function openRecordDetails(recordType, recordId, { onResubmit = null, onUpdated = null, allowReview = false, autoOpenReview = false } = {}) {
    const dialog = document.getElementById('record-detail-dialog');
    const titleEl = document.getElementById('record-detail-title');
    const subtitleEl = document.getElementById('record-detail-subtitle');
    const summaryEl = document.getElementById('record-detail-summary');
    const actionsEl = document.getElementById('record-detail-actions');
    if (!dialog || !summaryEl || !actionsEl) return null;

    const launchReview = (entry) => {
      dialog.close();
      requestRecordAction({
        title: 'Review pending entry',
        actions: ['CONFIRM', 'REJECT'],
        entry,
        onSubmit: async ({ decision, note }) => {
          await rpc(`review_${entry.type}`, {
            [`p_${entry.type}_id`]: entry.id,
            p_decision: decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
            p_review_note: note || null
          });
          toast(decision === 'CONFIRM' ? 'Entry confirmed.' : 'Entry rejected.');
          await onUpdated?.();
        }
      });
    };

    const typeMeta = recordReviewMeta.types[recordType] || { label: 'Record' };
    if (titleEl) titleEl.textContent = `${typeMeta.label} details`;
    if (subtitleEl) subtitleEl.textContent = 'Transaction details, review status, and attached discussion.';
    summaryEl.innerHTML = '<p class="empty-state">Loading record details…</p>';
    summaryEl.hidden = false;
    actionsEl.innerHTML = '';
    if (!dialog.open) dialog.showModal();

    try {
      const entry = await fetchSingleRecordEntry(recordType, recordId);
      if (!entry) {
        summaryEl.innerHTML = '<p class="empty-state">This record is no longer available in the active savings group.</p>';
        actionsEl.innerHTML = '<div class="record-detail-actions-right"><button type="button" class="button button-secondary" data-close-record-detail>Close</button></div>';
        actionsEl.querySelector('[data-close-record-detail]')?.addEventListener('click', () => dialog.close());
        return null;
      }

      if (autoOpenReview && allowReview && entry.approval_status === 'PENDING' && currentProfile?.role === 'ADMIN') {
        launchReview(entry);
        return entry;
      }

      renderRecordSummaryInto(summaryEl, entry, { showDiscussAction: false });
      const leftGroup = document.createElement('div');
      const discussBtn = document.createElement('button');
      discussBtn.type = 'button';
      discussBtn.className = 'button button-secondary';
      discussBtn.textContent = 'Open discussion';
      discussBtn.addEventListener('click', () => {
        dialog.close();
        openRecordDiscussion(entry.type, entry.id, { onUpdated });
      });
      leftGroup.appendChild(discussBtn);
      actionsEl.appendChild(leftGroup);

      const rightGroup = document.createElement('div');
      rightGroup.className = 'record-detail-actions-right';
      if (allowReview && entry.approval_status === 'PENDING' && currentProfile?.role === 'ADMIN') {
        const reviewBtn = document.createElement('button');
        reviewBtn.type = 'button';
        reviewBtn.className = 'button button-primary';
        reviewBtn.textContent = 'Review entry';
        reviewBtn.addEventListener('click', () => launchReview(entry));
        rightGroup.appendChild(reviewBtn);
      } else if (entry.approval_status === 'REJECTED' && typeof onResubmit === 'function') {
        const resubmitBtn = document.createElement('button');
        resubmitBtn.type = 'button';
        resubmitBtn.className = 'button button-primary';
        resubmitBtn.textContent = 'Edit & resubmit';
        resubmitBtn.addEventListener('click', () => {
          dialog.close();
          onResubmit(entry);
        });
        rightGroup.appendChild(resubmitBtn);
      }
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'button button-secondary';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => dialog.close());
      rightGroup.appendChild(closeBtn);
      actionsEl.appendChild(rightGroup);
      return entry;
    } catch (error) {
      summaryEl.innerHTML = `<p class="empty-state">${escapeHtml(friendlyError(error))}</p>`;
      return null;
    }
  }

  async function openFeatureRequestDetails(requestId) {
    const client = getClient();
    if (!requestId || !client) return null;
    try {
      const { data, error } = await client
        .from('feature_requests')
        .select('id,title,details,status,release_version,created_at,reviewed_at')
        .eq('id', requestId)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        renderNoticeModalContent({
          title: 'Feature request',
          subtitle: 'Request update',
          message: 'This feature request could not be found.'
        });
        return null;
      }
      const status = String(data.status || 'PENDING').toUpperCase();
      const statusClass = status === 'IMPLEMENTED' ? 'status-confirmed' : status === 'REJECTED' ? 'status-rejected' : 'status-pending';
      const meta = [
        data.created_at ? `Submitted ${dateLabel(data.created_at)}` : '',
        data.reviewed_at ? `Reviewed ${dateLabel(data.reviewed_at)}` : '',
        data.release_version ? `Release ${data.release_version}` : ''
      ];
      const actions = [];
      if (data.release_version) {
        actions.push({
          label: 'View release notes',
          variant: 'primary',
          onClick: async (dlg) => {
            dlg.close();
            if (activeAnnouncementsController?.openMatching) {
              await activeAnnouncementsController.openMatching({ releaseVersion: data.release_version });
            } else {
              const targetPage = currentProfile?.role === 'SUPER_ADMIN' ? 'super-admin.html' : 'dashboard.html';
              location.href = `${targetPage}?release=${encodeURIComponent(data.release_version)}`;
            }
          }
        });
      }
      renderNoticeModalContent({
        title: data.title || 'Feature request update',
        subtitle: status === 'IMPLEMENTED' ? 'Implemented feature request' : 'Feature request status',
        statusLabel: status,
        statusClass,
        message: data.details || 'Your feature suggestion has been reviewed by the Super Admin.',
        meta,
        actions
      });
      return data;
    } catch (error) {
      toast(friendlyError(error), 'error');
      return null;
    }
  }

  async function openPeriodNoticeModal({ mode = 'reminder', month = '', memberId = null, onSubmitPayment = null } = {}) {
    const client = getClient();
    const monthStr = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : isoDate().slice(0, 7);
    const periodDate = `${monthStr}-01`;
    const isExemptMode = mode === 'exemption';
    const targetMemberId = memberId || currentProfile?.member_id;
    let statusRow = null;
    let periodRow = null;

    if (targetMemberId && client) {
      const [{ data: statusData }, { data: periodData }] = await Promise.all([
        client.from('v_contribution_status').select('*').eq('member_id', targetMemberId).eq('period_month', periodDate).maybeSingle(),
        client.from('contribution_periods').select('id,due_date,is_exempt,exempt_reason,required_amount').eq('member_id', targetMemberId).eq('period_month', periodDate).maybeSingle()
      ]);
      statusRow = statusData || null;
      periodRow = periodData || null;
    }

    const monthTitle = dateLabel(periodDate, { month: 'long', year: 'numeric' });
    const status = statusRow?.payment_status || (periodRow?.is_exempt ? 'EXEMPT' : 'UNPAID');
    const statusClass = status === 'PAID' ? 'status-confirmed' : status === 'EXEMPT' ? 'status-voided' : status === 'PARTIALLY PAID' ? 'status-pending' : 'status-unpaid';
    const outstanding = Number(statusRow?.outstanding_amount ?? periodRow?.required_amount ?? 0);
    const paid = Number(statusRow?.paid_amount ?? 0);
    const required = Number(statusRow?.required_amount ?? periodRow?.required_amount ?? 0);
    const dueDate = periodRow?.due_date || statusRow?.due_date || '';
    const message = isExemptMode
      ? (periodRow?.is_exempt
        ? `${monthTitle} is marked as exempt from regular contributions.${periodRow.exempt_reason ? `\nReason: ${periodRow.exempt_reason}` : ''}`
        : `${monthTitle} is active for regular contribution tracking.${dueDate ? ` Due on ${dateLabel(dueDate)}.` : ''}`)
      : (outstanding > 0 && !periodRow?.is_exempt
        ? `Your ${monthTitle} contribution has a remaining balance of ${money(outstanding)}${dueDate ? ` due on ${dateLabel(dueDate)}` : ''}.`
        : `${monthTitle} contribution status is ${status.toLowerCase()}.`);

    const meta = [
      `Month: ${monthTitle}`,
      required > 0 ? `Target: ${money(required)}` : '',
      paid > 0 ? `Paid: ${money(paid)}` : '',
      outstanding > 0 && !periodRow?.is_exempt ? `Balance: ${money(outstanding)}` : '',
      dueDate ? `Due: ${dateLabel(dueDate)}` : ''
    ];
    const actions = [];
    if (!periodRow?.is_exempt && outstanding > 0 && typeof onSubmitPayment === 'function') {
      actions.push({
        label: 'Submit contribution',
        variant: 'primary',
        onClick: (dlg) => {
          dlg.close();
          onSubmitPayment({ monthStart: periodDate, outstanding });
        }
      });
    }
    renderNoticeModalContent({
      title: isExemptMode ? `Period exemption — ${monthTitle}` : `Contribution reminder — ${monthTitle}`,
      subtitle: isExemptMode ? 'Contribution schedule exemption' : 'Contribution schedule & balance',
      statusLabel: status,
      statusClass,
      message,
      meta,
      actions
    });
  }

  async function openNoticeDetailModal(noticeOrId, opts = {}) {
    let item = typeof noticeOrId === 'object' && noticeOrId ? noticeOrId : null;
    const noticeId = item?.id || (noticeOrId ? String(noticeOrId) : '');
    if (!item && noticeId) {
      item = notificationItemsById.get(noticeId) || null;
    }
    if (!item && noticeId) {
      try {
        const cached = JSON.parse(sessionStorage.getItem('myipon_active_notice') || 'null');
        if (cached && String(cached.id) === noticeId) item = cached;
      } catch { /* ignore */ }
    }
    if (!item && noticeId && currentProfile?.id && /^\d+$/.test(noticeId)) {
      const client = getClient();
      if (client) {
        const { data } = await client
          .from('notifications')
          .select('id,group_id,type,title,message,link,read_at,created_at,dedupe_key')
          .eq('id', Number(noticeId))
          .eq('recipient_id', currentProfile.id)
          .maybeSingle();
        if (data) item = data;
      }
    }
    if (!item && !opts.title && !opts.message) return null;

    const actions = Array.isArray(opts.actions) ? [...opts.actions] : [];
    const type = String(item?.type || '').toUpperCase();
    if (type === 'GROUP_INVITE' && item?.id) {
      actions.push({
        label: 'Decline',
        variant: 'secondary',
        onClick: async (dlg, btn) => {
          setBusy(btn, true, 'Declining…');
          try {
            await rpc('decline_group_invitation', { p_notification_id: Number(item.id) });
            toast('Invitation declined.');
            dlg.close();
          } catch (error) {
            toast(friendlyError(error), 'error');
          } finally {
            setBusy(btn, false);
          }
        }
      });
      actions.push({
        label: 'Accept invitation',
        variant: 'primary',
        onClick: async (dlg, btn) => {
          setBusy(btn, true, 'Accepting…');
          try {
            const res = await rpc('accept_group_invitation', { p_notification_id: Number(item.id) });
            toast(`Joined "${res?.group_name || 'savings group'}"!`);
            dlg.close();
            if (res?.group_id) await switchActiveGroup(res.group_id);
            location.href = homeForRole(res?.role || currentProfile?.role);
          } catch (error) {
            toast(friendlyError(error), 'error');
          } finally {
            setBusy(btn, false);
          }
        }
      });
    } else if (opts.actionLabel && typeof opts.onAction === 'function') {
      actions.push({
        label: opts.actionLabel,
        variant: 'primary',
        onClick: opts.onAction
      });
    }

    const meta = [
      ...(Array.isArray(opts.meta) ? opts.meta : []),
      item?.created_at ? dateLabel(item.created_at, { dateStyle: 'medium', timeStyle: 'short' }) : ''
    ];

    return renderNoticeModalContent({
      title: opts.title || item?.title || 'Notification details',
      subtitle: opts.subtitle || (type ? type.replaceAll('_', ' ') : 'Alert'),
      statusLabel: opts.statusLabel || '',
      statusClass: opts.statusClass || 'status-confirmed',
      message: opts.message || item?.message || 'Review the latest update on your account.',
      meta,
      actions
    });
  }

  async function navigateNotificationTarget(itemOrTarget, { closeDialog = true } = {}) {
    if (closeDialog) document.getElementById('notification-dialog')?.close();
    const rawItem = itemOrTarget && typeof itemOrTarget === 'object' ? itemOrTarget : null;
    if (rawItem) {
      try {
        sessionStorage.setItem('myipon_active_notice', JSON.stringify(rawItem));
      } catch { /* ignore */ }
    }

    let didSwitchGroup = false;
    if (
      rawItem?.group_id
      && currentProfile?.group_id
      && rawItem.group_id !== currentProfile.group_id
      && currentProfile?.role !== 'SUPER_ADMIN'
      && rawItem.type !== 'GROUP_INVITE'
      && rawItem.type !== 'GROUP_DELETED'
    ) {
      try {
        await switchActiveGroup(rawItem.group_id);
        didSwitchGroup = true;
      } catch {
        return openNoticeDetailModal(rawItem);
      }
    }

    if (rawItem?.type === 'EFFECT_GRANTED') {
      await refreshProfileEffectsState({ checkModal: false });
      if (!maybeShowEffectAwardModal({ force: true })) {
        await openProfileEffectsDialog();
      }
      return null;
    }

    if (rawItem?.type === 'EFFECT_TRIAL_REJECTED') {
      await refreshProfileEffectsState({ checkModal: false });
      return openNoticeDetailModal(rawItem);
    }

    const target = rawItem
      ? resolveNotificationTarget(rawItem, currentProfile?.role || 'MEMBER')
      : normalizeRolePageTarget(itemOrTarget, currentProfile?.role || 'MEMBER');

    if (!target) {
      if (rawItem) return openNoticeDetailModal(rawItem);
      return null;
    }

    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener');
      return null;
    }

    const currentFile = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    let parsedTarget;
    try {
      parsedTarget = new URL(target, location.href);
    } catch {
      location.href = target;
      return null;
    }
    const targetFile = (parsedTarget.pathname.split('/').pop() || 'index.html').toLowerCase();

    if (rawItem?.type?.startsWith('SOCIAL_') && currentProfile?.role !== 'SUPER_ADMIN' && window.IponMessages?.openFromNotification) {
      history.replaceState(null, '', target);
      window.IponMessages.openFromNotification(rawItem, parsedTarget);
      return target;
    }

    if (currentFile === targetFile && !didSwitchGroup) {
      history.replaceState(null, '', target);
      window.dispatchEvent(new CustomEvent('ipon:deep-link', { detail: { url: target, item: rawItem } }));
      return target;
    }

    location.href = target;
    return target;
  }

  const ONE_SHOT_DEEP_LINK_PARAMS = [
    'announcement', 'release', 'announcement_title', 'notice',
    'review', 'review_notice', 'record', 'thread',
    'feature_request', 'bug_report', 'reminder', 'exemption',
    'member', 'access_user', 'create_group', 'workspace_mode',
    'join', 'join_requests'
  ];

  function clearDeepLinkUrlState() {
    try {
      const rawUrl = `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
      const current = new URL(rawUrl, location.origin || 'https://ipon.local');
      let changed = false;
      for (const key of ONE_SHOT_DEEP_LINK_PARAMS) {
        if (current.searchParams.has(key)) {
          current.searchParams.delete(key);
          changed = true;
        }
      }
      const currentFile = (current.pathname.split('/').pop() || '').toLowerCase();
      if (currentFile !== 'super-admin.html' && (current.hash === '#announcements' || current.hash === '#announcement-heading')) {
        current.hash = '';
        changed = true;
      }
      if (!changed || typeof history?.replaceState !== 'function') return;
      history.replaceState(null, '', `${current.pathname}${current.search}${current.hash}`);
    } catch { /* ignore */ }
  }

  let deepLinkHandlerRegistered = false;
  function consumeDeepLink(handler) {
    if (typeof handler !== 'function') return;
    deepLinkHandlerRegistered = true;
    const run = async (urlLike = null) => {
      try {
        const parsed = urlLike ? new URL(urlLike, location.href) : new URL(location.href);
        const handled = await handler(parsed.searchParams, parsed.hash, parsed);
        if (!handled && parsed.searchParams.has('notice')) {
          await openNoticeDetailModal(parsed.searchParams.get('notice'));
        }
        if (!urlLike && (handled || parsed.searchParams.has('notice'))) {
          clearDeepLinkUrlState();
        }
      } catch (error) {
        console.warn('Deep-link handling error:', error);
      }
    };
    run();
    window.addEventListener('ipon:deep-link', (event) => run(event?.detail?.url || location.href));
  }

  window.addEventListener('ipon:deep-link', (event) => {
    if (deepLinkHandlerRegistered) return;
    try {
      const parsed = new URL(event?.detail?.url || location.href, location.href);
      if (parsed.searchParams.has('notice')) {
        openNoticeDetailModal(event?.detail?.item || parsed.searchParams.get('notice'));
      }
    } catch { /* ignore */ }
  });

  async function scheduleNativeDueReminders(scheduleRows) {
    const plugin = getLocalNotificationsPlugin();
    if (!plugin?.schedule || currentProfile?.notifications_enabled === false) return;
    const permission = await getDeviceNotificationPermission();
    if (permission !== 'granted') return;
    await ensureAndroidNotificationChannel();

    const cancelList = [];
    for (let id = 900000; id < 900040; id += 1) cancelList.push({ id });
    try { await plugin.cancel?.({ notifications: cancelList }); } catch { /* ignore */ }

    const nowMs = Date.now();
    const notifications = [];
    let nextId = 900000;
    for (const row of Array.isArray(scheduleRows) ? scheduleRows : []) {
      if (!row?.due_date || nextId >= 900038) continue;
      const dueDay = new Date(`${row.due_date}T09:00:00+08:00`);
      if (Number.isNaN(dueDay.getTime())) continue;
      const threeDaysBefore = new Date(dueDay.getTime() - (3 * 86400000));
      const amountCopy = row.outstanding_amount ? ` (PHP ${Number(row.outstanding_amount).toFixed(2)} remaining)` : '';
      const monthIso = row.period_month ? String(row.period_month).slice(0, 7) : '';
      const link = monthIso ? `user.html?reminder=${encodeURIComponent(monthIso)}` : 'user.html';
      for (const triggerAt of [threeDaysBefore, dueDay]) {
        if (triggerAt.getTime() > nowMs + 60000 && nextId < 900040) {
          notifications.push({
            id: nextId++,
            title: 'Contribution deadline approaching',
            body: `Your ${row.period_label || 'savings'} contribution for ${row.group_name || 'your group'} is due on ${row.due_date}${amountCopy}.`,
            channelId: 'myipon_alerts',
            schedule: { at: triggerAt, allowWhileIdle: true },
            extra: { link }
          });
        }
      }
    }
    if (notifications.length) {
      await plugin.schedule({ notifications }).catch(() => { });
    }
  }

  async function initNotifications(profile) {
    const client = getClient();
    const list = document.getElementById('notification-list');
    if (!list || !client || !profile) return;
    const isApp = isInstalledAppUser();
    attachNativeNotificationTapListener();
    bindDeviceNotificationControls();

    if (isApp && hasNativeNotificationBridge() && profile.notifications_enabled !== false) {
      const promptKey = `myipon_native_notif_prompt_${profile.id}`;
      const bgPromptHandled = Boolean(localStorage.getItem(`myipon_bg_prompt_seen_${profile.id}`));
      const deferToBgPrompt = !bgPromptHandled && document.body.dataset.page !== 'account' && !profileNeedsSetup(profile);
      const perm = await getDeviceNotificationPermission();
      if (!deferToBgPrompt && perm === 'default' && !localStorage.getItem(promptKey)) {
        localStorage.setItem(promptKey, '1');
        requestDeviceNotificationPermission({ userInitiated: true }).catch(() => { });
      }
    }

    const lastSeenKey = `myipon_last_notif_seen_${profile.id}`;
    const storedLastSeen = localStorage.getItem(lastSeenKey);
    let lastSeenMs = storedLastSeen ? Number(storedLastSeen) : null;

    const load = async (realtimePayload) => {
      const { data, error } = await client.from('notifications').select('id,group_id,type,title,message,link,dedupe_key,read_at,created_at').order('created_at', { ascending: false }).limit(40);
      if (error) {
        syncBackgroundNotificationPolling(profile).catch(() => { });
        showInlineError(list, error, load);
        return;
      }
      const rows = data || [];

      if (realtimePayload?.eventType && realtimePayload.eventType !== 'DELETE' && realtimePayload?.new?.id) {
        const match = rows.find((item) => String(item.id) === String(realtimePayload.new.id)) || realtimePayload.new;
        dispatchDeviceNotification(match, profile.id).catch(() => { });
        const incomingType = String(match?.type || '').toUpperCase();
        if (['ANNOUNCEMENT', 'PLATFORM_ANNOUNCEMENT', 'RELEASE'].includes(incomingType)) {
          activeAnnouncementsController?.load?.().catch(() => { });
        }
        if (incomingType === 'BADGE_GRANTED' || incomingType === 'BADGE_REMOVED') {
          refreshVerifiedBadgesCache({ force: true, refreshOwnProfile: true }).then(() => {
            if (incomingType === 'BADGE_GRANTED' && currentProfile && !currentProfile.verified_badge_acknowledged_at) {
              maybeShowBadgeAwardModal(currentProfile);
            }
          }).catch(() => { });
        }
        if (incomingType === 'EFFECT_GRANTED' || incomingType === 'EFFECT_REMOVED' || incomingType === 'EFFECT_TRIAL_REJECTED') {
          refreshProfileEffectsState({ checkModal: incomingType === 'EFFECT_GRANTED' }).catch(() => { });
        }
        if (typeof activeLiveRefresh === 'function') {
          try { activeLiveRefresh(); } catch { }
        }
      } else if (realtimePayload?.eventType !== 'DELETE' && realtimePayload?.new?.id) {
        const match = rows.find((item) => String(item.id) === String(realtimePayload.new.id)) || realtimePayload.new;
        dispatchDeviceNotification(match, profile.id).catch(() => { });
      } else if (lastSeenMs === null) {
        const newestMs = rows.reduce((max, item) => Math.max(max, Date.parse(item.created_at || '') || 0), Date.now());
        lastSeenMs = newestMs;
        try { localStorage.setItem(lastSeenKey, String(lastSeenMs)); } catch { /* ignore */ }
      } else {
        const unseenNew = rows.filter((item) => !item.read_at && (Date.parse(item.created_at || '') || 0) > lastSeenMs);
        unseenNew.slice(0, 3).reverse().forEach((item) => {
          dispatchDeviceNotification(item, profile.id).catch(() => { });
        });
      }

      const latestMs = rows.reduce((max, item) => Math.max(max, Date.parse(item.created_at || '') || 0), lastSeenMs || 0);
      if (latestMs > (lastSeenMs || 0)) {
        lastSeenMs = latestMs;
        try { localStorage.setItem(lastSeenKey, String(lastSeenMs)); } catch { /* ignore */ }
      }
      syncBackgroundNotificationPolling(profile, rows).catch(() => { });
      if (!isApp && isMobileDeviceNotifClient() && profile.notifications_enabled !== false) {
        getDeviceNotificationPermission().then((perm) => (perm === 'granted' ? syncWebPushSubscription() : false)).then((synced) => {
          if (synced) syncDevicePermissionUI().catch(() => { });
        }).catch(() => { });
      }

      notificationItemsById.clear();

      const unread = rows.filter((item) => !item.read_at).length;
      syncNotificationBadges(unread);
      document.getElementById('mark-all-notifications').hidden = unread === 0;
      list.innerHTML = rows.length ? rows.map((item) => {
        const isInvite = item.type === 'GROUP_INVITE' && !item.read_at;
        notificationItemsById.set(String(item.id), item);
        const safeTarget = isInvite ? '' : resolveNotificationTarget(item);
        const iconPath = item.type === 'GROUP_INVITE' || item.type === 'SOCIAL_FRIEND_REQUEST' || item.type === 'SOCIAL_FRIEND_ACCEPTED'
          ? 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
          : String(item.type || '').startsWith('SOCIAL_')
            ? 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z'
            : 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4';
        const iconHtml = item.type === 'BADGE_GRANTED'
          ? `<span class="notification-item-icon is-badge-granted" aria-hidden="true">${badgeSealSvgMarkup('#1d9bf0', 'Verified badge')}</span>`
          : item.type === 'BADGE_REMOVED' || item.type === 'EFFECT_REMOVED' || item.type === 'EFFECT_TRIAL_REJECTED'
            ? `<span class="notification-item-icon is-badge-removed" aria-hidden="true"><svg class="verified-badge-svg" viewBox="0 0 24 24" shape-rendering="geometricPrecision"><path fill="#dc2626" d="${SCALLOP_SEAL_PATH}"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/></svg></span>`
            : item.type === 'EFFECT_GRANTED' || item.type === 'EFFECT_TRIAL_REQUESTED'
              ? '<span class="notification-item-icon is-effect-granted" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2Z"/></svg></span>'
              : `<span class="notification-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg></span>`;
        return `<article class="notification-item${item.read_at ? '' : ' is-unread'}" data-notification-id="${item.id}"${safeTarget ? ` data-nav-target="${escapeHtml(safeTarget)}"` : ''}>
          ${iconHtml}
          <div class="notification-item-copy">
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.message)}</p>
            <small>${dateLabel(item.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>
            ${isInvite ? `
              <div class="notification-invite-actions">
                <button class="button button-sm button-primary" type="button" data-invite-action="accept" data-notif-id="${item.id}">Accept</button>
                <button class="button button-sm button-secondary" type="button" data-invite-action="decline" data-notif-id="${item.id}">Decline</button>
              </div>
            ` : ''}
          </div>
          ${safeTarget ? `<a class="notification-item-open" href="${escapeHtml(safeTarget)}" aria-label="Open ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>` : ''}
          ${item.read_at ? '' : '<i class="notification-unread" aria-label="Unread"></i>'}
        </article>`;
      }).join('') : '<p class="empty-state">You have no notifications yet.</p>';
    };
    list.onclick = async (event) => {
      const inviteBtn = event.target.closest('[data-invite-action]');
      if (inviteBtn) {
        event.stopPropagation();
        event.preventDefault();
        const action = inviteBtn.dataset.inviteAction;
        const notifId = Number(inviteBtn.dataset.notifId);
        inviteBtn.disabled = true;
        try {
          if (action === 'accept') {
            const res = await rpc('accept_group_invitation', { p_notification_id: notifId });
            toast(`Invitation accepted! Welcome to ${res?.group_name || 'the group'}.`);
            if (res?.group_id) {
              await switchActiveGroup(res.group_id);
            }
            location.reload();
          } else {
            await rpc('decline_group_invitation', { p_notification_id: notifId });
            toast('Invitation declined.');
            await load();
          }
        } catch (err) {
          inviteBtn.disabled = false;
          toast(friendlyError(err), 'error');
        }
        return;
      }
      const item = event.target.closest('[data-notification-id]');
      if (!item) return;
      const rawItem = notificationItemsById.get(String(item?.dataset?.notificationId || '')) || null;
      const target = normalizeRolePageTarget(item.dataset.navTarget) || safeNotificationTarget(item.dataset.navTarget);
      if (target || rawItem) event.preventDefault();
      if (item.classList.contains('is-unread')) {
        try {
          await rpc('mark_notification_read', { p_notification_id: Number(item.dataset.notificationId) });
          item.classList.remove('is-unread');
          syncNotificationBadges(Math.max(0, (Number(readShellSnapshot()?.unreadCount) || 1) - 1));
          if (!target) await load();
        } catch (error) {
          toast(friendlyError(error), 'error');
        }
      }
      if (target || rawItem) {
        await navigateNotificationTarget(rawItem || target, { closeDialog: true });
      }
    };
    document.getElementById('mark-all-notifications').onclick = async () => {
      try { await rpc('mark_all_notifications_read'); await load(); } catch (error) { toast(friendlyError(error), 'error'); }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncDevicePermissionUI().catch(() => { });
        load().catch(() => { });
      }
    });
    window.addEventListener('online', () => { load().catch(() => { }); });

    activeNotificationsReload = () => load();
    await load();
    const notifChannel = createRealtimeChannel(`notifications:${profile.id}`, undefined, client);
    notifChannel
      ?.on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}` }, (payload) => load(payload))
      ?.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'announcements' }, (payload) => {
        if (payload?.new?.deleted_at) load().catch(() => { });
      })
      ?.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'announcements' }, () => load().catch(() => { }))
      ?.subscribe();
    try {
      if ('BroadcastChannel' in window) {
        const notifBc = new BroadcastChannel(LIVE_SYNC_CHANNEL);
        notifBc.onmessage = (event) => {
          const topic = String(event?.data?.topic || '');
          if (topic === 'announcements' || topic === 'notifications') {
            load().catch(() => { });
          }
        };
      }
    } catch { }

    if (profile.notifications_enabled !== false) {
      const syncKey = `myipon_due_sync_${profile.id}`;
      const lastSync = Number(localStorage.getItem(syncKey) || 0);
      if (Date.now() - lastSync > 15 * 60 * 1000) {
        localStorage.setItem(syncKey, String(Date.now()));
        rpc('sync_my_due_reminders').then((scheduleRows) => {
          scheduleNativeDueReminders(scheduleRows).catch(() => { });
          load().catch(() => { });
        }).catch(() => { });
      }
    }
  }

  function prepareResponsiveTables() {
    document.querySelectorAll('.data-table').forEach((table) => {
      const labels = [...table.querySelectorAll('thead th')].map((heading) => heading.textContent.trim());
      const applyLabels = () => table.querySelectorAll('tbody tr').forEach((row) => {
        [...row.cells].forEach((cell, index) => {
          if (!cell.hasAttribute('colspan')) cell.dataset.label = labels[index] || '';
        });
      });
      applyLabels();
      const body = table.tBodies[0];
      if (body) new MutationObserver(applyLabels).observe(body, { childList: true });
    });
  }

  function showSetupBanner() {
    if (document.body.dataset.page === 'dashboard') return;
    if (document.getElementById('setup-banner')) return;
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="setup-banner" id="setup-banner" role="status">
        Connect Supabase in <code>js/config.js</code> to load and save real records. No sample financial data is being shown.
      </div>`);
  }

  let appInitialized = false;
  let startupInProgress = false;

  function isHarmlessLockOrAbortError(error) {
    const text = `${error?.name || ''} ${error?.message || error || ''}`;
    return /NavigatorLock|LockManager|lock:sb-|AbortError|The user aborted a request/i.test(text);
  }

  function isTransientConnectionError(error) {
    if (navigator.onLine === false) return false;
    const text = `${error?.name || ''} ${error?.message || error?.code || error || ''}`;
    return /timed out|timeout|Failed to fetch|Load failed|NetworkError|fetch|502|503|504|temporarily|ECONN|NavigatorLock|LockManager/i.test(text);
  }

  function isJwtExpiredError(error) {
    const text = `${error?.status || ''} ${error?.code || ''} ${error?.message || error || ''}`;
    return /jwt|token.*expired|401|pgrst301|invalid.*token/i.test(text);
  }

  async function runWithStartupRetry(fn, { attempts = 3, timeoutMs = 10000, delayMs = 350 } = {}) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
      try {
        return await withTimeout(fn(), timeoutMs);
      } catch (err) {
        lastError = err;
        if (i === attempts - 1 || !isTransientConnectionError(err)) throw err;
        await new Promise((resolve) => setTimeout(resolve, delayMs * (i + 1)));
      }
    }
    throw lastError;
  }

  function dismissStartupFailure() {
    document.getElementById('startup-error')?.remove();
    document.querySelector('.app-layout, .comp-frame, .login-page')?.removeAttribute('inert');
  }

  function showStartupFailure(error) {
    if (appInitialized || currentProfile || document.getElementById('startup-error')) return;
    console.warn('Startup initialization failed:', error);
    const offline = navigator.onLine === false;
    const sessionProblem = /auth|jwt|refresh token|session/i.test(error?.message || '');
    const message = offline
      ? 'You appear to be offline. Reconnect to the internet, then retry.'
      : sessionProblem
        ? 'Your session could not be verified. Retry, or sign out and sign in again.'
        : 'IPON could not connect to your records. Check your connection, then retry.';
    document.querySelector('.app-layout, .comp-frame, .login-page')?.setAttribute('inert', '');
    document.body.insertAdjacentHTML('beforeend', `
      <section class="startup-error" id="startup-error" role="alert" aria-labelledby="startup-error-title">
        <div class="startup-error-sheet">
          <strong class="loader-brand"><span class="brand-prefix">my</span>IPON</strong>
          <div class="startup-error-mark" aria-hidden="true"><i></i></div>
          <h1 id="startup-error-title">Unable to load your records</h1>
          <p>${escapeHtml(message)}</p>
          <div class="startup-error-actions">
            <button class="button button-primary" id="startup-retry" type="button">Retry</button>
            <button class="button button-secondary" id="startup-dismiss" type="button">Dismiss</button>
            <button class="button button-secondary" id="startup-signout" type="button">Sign out</button>
          </div>
          <small>Your saved records were not changed.</small>
        </div>
      </section>`);
    const retry = document.getElementById('startup-retry');
    retry.addEventListener('click', () => window.location.reload());
    document.getElementById('startup-dismiss')?.addEventListener('click', dismissStartupFailure);
    document.getElementById('startup-signout').addEventListener('click', signOut);
    retry.focus();
  }

  function homeForRole(role) {
    return role === 'SUPER_ADMIN' ? 'super-admin.html' : 'dashboard.html';
  }

  async function init(options = {}) {
    startupInProgress = true;
    mountShell();
    prepareFormValidation();
    prepareNameInputs();
    preparePhoneInputs();
    prepareNumericInputs();
    prepareResponsiveTables();
    applyInputDateBounds();
    if (options.requireAuth !== false) setLoading(true);
    try {
      if (!configured) {
        showSetupBanner();
        const sidebarUser = document.getElementById('sidebar-user');
        if (sidebarUser) sidebarUser.innerHTML = '<strong>Offline mode</strong><small>NOT CONNECTED</small>';
        document.querySelectorAll('[data-requires-data]').forEach((element) => { element.disabled = true; });
        setLoading(false);
        return { configured: false, profile: null, session: null };
      }

      const client = await ensureClient();
      const { data: { session }, error: sessionError } = await runWithStartupRetry(() => client.auth.getSession());
      if (sessionError) throw sessionError;
      cachedAccessToken = session?.access_token || null;
      if (!session && options.requireAuth !== false) {
        window.location.replace('login.html');
        return { configured: true, profile: null, session: null, redirecting: true };
      }
      if (!session) {
        clearStoredAuthTokens();
        watchCrossTabAuth(client, null, { loginPage: options.requireAuth === false });
        setLoading(false);
        return { configured: true, profile: null, session: null };
      }

      const mfaPromise = document.body.dataset.page !== 'mfa'
        ? runWithStartupRetry(() => requiresMfaChallenge(), { attempts: 2, timeoutMs: 8000 }).catch((mfaErr) => {
            if (isTransientConnectionError(mfaErr) || isHarmlessLockOrAbortError(mfaErr)) return false;
            throw mfaErr;
          })
        : Promise.resolve(false);

      const fetchProfile = () => client.from('profiles')
        .select('id,full_name,first_name,middle_name,last_name,contact_number,role,status,member_id,group_id,avatar_url,name_setup_required,notifications_enabled,username,bio,chat_privacy,last_seen_at,policy_accepted_version,policy_accepted_at,verified_badge_tier,verified_badge_expires_at,verified_badge_message,verified_badge_granted_at,verified_badge_acknowledged_at,card_theme,cover_url,equipped_profile_effect,social_links')
        .eq('id', session.user.id)
        .single();
      const [needsMfa, profileResult] = await Promise.all([
        mfaPromise,
        runWithStartupRetry(fetchProfile).catch((fetchErr) => ({ data: null, error: fetchErr }))
      ]);
      if (needsMfa) {
        window.location.replace('mfa.html');
        return { configured: true, profile: null, session, redirecting: true };
      }
      let { data: profile, error } = profileResult;
      if (error && isJwtExpiredError(error)) {
        const refreshed = await withTimeout(client.auth.refreshSession(), 8000).catch(() => null);
        if (refreshed?.error && options.requireAuth !== false && !isTransientConnectionError(refreshed.error)) {
          window.location.replace('login.html');
          return { configured: true, profile: null, session: null, redirecting: true };
        }
        ({ data: profile, error } = await runWithStartupRetry(fetchProfile));
      }
      if (error) throw error;
      if (profile && profile.status !== 'DISABLED' && profile.role !== 'SUPER_ADMIN') {
        const activationKey = `ipon_member_activated:${profile.id}:${profile.group_id || ''}:${profile.member_id || ''}`;
        let alreadySynced = false;
        try { alreadySynced = sessionStorage.getItem(activationKey) === '1'; } catch { }
        if (profile.status === 'PENDING' || !alreadySynced) {
          try {
            const actRes = await withTimeout(client.rpc('activate_own_pending_account'), 6000);
            if (!actRes?.error && actRes?.data) {
              profile = { ...profile, ...actRes.data };
              try { sessionStorage.setItem(activationKey, '1'); } catch { }
            }
          } catch (_) { }
        }
      }
      if (!profile.group_id && profile.role !== 'SUPER_ADMIN' && profile.status === 'ACTIVE') {
        try {
          const { data: myGroups } = await withTimeout(client.rpc('get_my_groups'));
          if (myGroups && myGroups.length > 0) {
            const firstGroup = myGroups[0];
            await withTimeout(client.rpc('switch_active_group', { p_group_id: firstGroup.group_id }));
            profile.group_id = firstGroup.group_id;
            profile.role = firstGroup.role || profile.role;
            profile.member_id = firstGroup.member_id || profile.member_id;
            profile.workspace_mode = firstGroup.workspace_mode === 'SOLO' ? 'SOLO' : 'GROUP';
          }
        } catch (_) { }
      }
      profile.permissions = defaultPermissionsForRole(profile.role);
      await Promise.all([
        (async () => {
          if (profile.group_id && profile.role !== 'SUPER_ADMIN' && !profile.workspace_mode) {
            try {
              const { data: gModeRow } = await withTimeout(
                client.from('groups').select('workspace_mode').eq('id', profile.group_id).maybeSingle(),
                5000
              );
              profile.workspace_mode = gModeRow?.workspace_mode === 'SOLO' ? 'SOLO' : 'GROUP';
            } catch (_) {
              profile.workspace_mode = 'GROUP';
            }
          } else if (!profile.workspace_mode) {
            profile.workspace_mode = 'GROUP';
          }
        })(),
        (async () => {
          if (profile.role !== 'SUPER_ADMIN' && profile.group_id && profile.status === 'ACTIVE') {
            try {
              const permRes = await withTimeout(client.rpc('get_my_member_permissions'), 5000);
              if (!permRes?.error && permRes?.data) {
                profile.permissions = normalizePermissions(permRes.data, profile.role);
              }
            } catch (_) { }
          }
        })(),
        refreshVerifiedBadgesCache({ force: true }).catch(() => { })
      ]);
      currentProfile = profile;
      syncWorkspaceMode(profile.workspace_mode);
      try {
        sessionStorage.setItem(ACTIVE_ROLE_KEY, profile.role);
        localStorage.setItem(ACTIVE_ROLE_KEY, profile.role);
      } catch { }
      writeShellSnapshot({
        userId: profile.id,
        role: profile.role,
        fullName: profile.full_name
      });
      if (profile.status !== 'ACTIVE' && options.allowPending !== true) {
        await client.auth.signOut();
        window.location.replace('login.html?status=pending');
        return { configured: true, profile, session, redirecting: true };
      }
      const setupUrl = accountSetupUrl(profile, session.user);
      if (setupUrl && document.body.dataset.page !== 'account') {
        window.location.replace(setupUrl);
        return { configured: true, profile: null, session, redirecting: true };
      }
      if (options.requireAuth !== false) {
        const allowedRoles = options.allowedRoles || pageRoles[document.body.dataset.page] || null;
        const wrongPanel = profile.role === 'SUPER_ADMIN' && !['super-admin', 'account'].includes(document.body.dataset.page);
        if (wrongPanel || (allowedRoles && !allowedRoles.includes(profile.role))) {
          window.location.replace(homeForRole(profile.role));
          return { configured: true, profile: null, session, redirecting: true };
        }
      }
      mountShell(profile.role);
      document.querySelector('.app-brand')?.setAttribute('href', homeForRole(profile.role));
      renderSidebarUser(profile);
      syncProfileAvatars(profile);
      syncShellRoleVisibility(profile.role);
      if (options.requireAuth !== false) watchCrossTabAuth(client, profile.id);
      initNotifications(profile).catch(() => { });
      initPresence(profile);
      if (profile.role !== 'SUPER_ADMIN' && options.requireAuth !== false) {
        try { window.IponMessages?.init?.(profile); } catch (_) { }
      }
      appInitialized = true;
      dismissStartupFailure();
      if (options.requireAuth === false) setLoading(false);
      if (options.requireAuth !== false) {
        const checkRewards = () => {
          const shownBadge = maybeShowBadgeAwardModal(profile);
          refreshProfileEffectsState({ checkModal: !shownBadge }).catch(() => { });
        };
        const runSecondaryPrompts = () => {
          if (!options.skipBackgroundPrompt) {
            maybePromptBackgroundUsage(profile).catch(() => { });
          }
          if (!options.skipRetentionReminder) {
            maybeShowRetentionReminder(profile);
          }
          maybeResumePendingJoin(profile);
          checkRewards();
        };
        const runAfterPolicy = () => {
          const shownUsername = !options.skipUsernamePrompt && !setupUrl
            ? maybeShowUsernameSetupModal(profile, {
              onDone: () => {
                setTimeout(runSecondaryPrompts, USERNAME_POST_SAVE_DELAY_MS);
              }
            })
            : false;
          if (!shownUsername) runSecondaryPrompts();
        };
        const shownConsent = !options.skipPolicyConsent && !setupUrl
          ? maybeShowPolicyConsentModal(profile, { onAccept: runAfterPolicy })
          : false;
        if (!shownConsent) runAfterPolicy();
      }
      return { configured: true, profile, session };
    } catch (error) {
      setLoading(false);
      if (options.requireAuth !== false) {
        showStartupFailure(error);
      }
      return { configured, profile: null, session: null, failed: true, error };
    } finally {
      startupInProgress = false;
    }
  }

  const AUTH_CHANNEL_NAME = 'ipon-auth-sync';
  const AUTH_STORAGE_KEY = 'iponAuthEvent';

  function broadcastAuthEvent(type, userId = null) {
    const payload = { type, userId, at: Date.now() };
    try {
      const channel = 'BroadcastChannel' in window ? new BroadcastChannel(AUTH_CHANNEL_NAME) : null;
      channel?.postMessage(payload);
      channel?.close();
    } catch { }
    try {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch { }
  }

  function clearStoredAuthTokens() {
    try {
      sessionStorage.removeItem(ACTIVE_ROLE_KEY);
      localStorage.removeItem(ACTIVE_ROLE_KEY);
      sessionStorage.removeItem(SHELL_SNAPSHOT_KEY);
      localStorage.removeItem(SHELL_SNAPSHOT_KEY);
      sessionStorage.removeItem(SHELL_AVATAR_KEY);
      localStorage.removeItem(SHELL_AVATAR_KEY);
      if (document?.documentElement?.dataset) delete document.documentElement.dataset.shellRole;
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('sb-') && key.endsWith('-auth-token')) localStorage.removeItem(key);
      });
    } catch { }
  }

  function watchCrossTabAuth(client, expectedUserId, { loginPage = false } = {}) {
    if (!client || document.documentElement.dataset.crossTabAuthBound) return;
    document.documentElement.dataset.crossTabAuthBound = 'true';
    let redirecting = false;
    const redirectTo = (target) => {
      if (redirecting) return;
      redirecting = true;
      document.documentElement.style.visibility = 'hidden';
      window.location.replace(target);
    };
    const handlePayload = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (loginPage) {
        if (payload.type === 'SIGNED_IN' && payload.userId) window.location.reload();
        return;
      }
      if (payload.type === 'SIGNED_OUT') return redirectTo('login.html');
      if (payload.type === 'SIGNED_IN' && payload.userId && expectedUserId && payload.userId !== expectedUserId) {
        window.location.reload();
      }
    };
    const checkSessionConsistency = async () => {
      try {
        const { data: { session } } = await client.auth.getSession();
        if (loginPage) {
          if (session?.user?.id) {
            const { data: profile } = await client.from('profiles').select('role,status,first_name,middle_name,last_name,contact_number,name_setup_required').eq('id', session.user.id).maybeSingle();
            if (profile?.status === 'ACTIVE') redirectTo(accountSetupUrl(profile, session.user) || homeForRole(profile.role));
          }
          return;
        }
        if (!session) return redirectTo('login.html');
        if (expectedUserId && session.user.id !== expectedUserId) window.location.reload();
      } catch { }
    };
    client.auth.onAuthStateChange((event, nextSession) => {
      cachedAccessToken = nextSession?.access_token || null;
      if (loginPage || event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT' || !nextSession) return redirectTo('login.html');
      if (expectedUserId && nextSession.user?.id && nextSession.user.id !== expectedUserId) {
        window.location.reload();
      }
    });
    try {
      if ('BroadcastChannel' in window) {
        const channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
        channel.addEventListener('message', (event) => handlePayload(event.data));
        window.addEventListener('pagehide', () => channel.close(), { once: true });
      }
    } catch { }
    window.addEventListener('storage', (event) => {
      if (event.key === AUTH_STORAGE_KEY && event.newValue) {
        try { handlePayload(JSON.parse(event.newValue)); } catch { }
        return;
      }
      if (event.key && event.key.startsWith('sb-') && event.key.endsWith('-auth-token')) {
        if (!loginPage && !event.newValue) return redirectTo('login.html');
        checkSessionConsistency();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkSessionConsistency();
    });
    window.addEventListener('focus', checkSessionConsistency);
  }

  function fireKeepaliveRpc(fnName, body = {}, accessToken = cachedAccessToken) {
    const token = String(accessToken || cachedAccessToken || '').trim();
    if (!configured || !token || typeof fetch !== 'function') return false;
    try {
      fetch(`${config.supabaseUrl}/rest/v1/rpc/${encodeURIComponent(fnName)}`, {
        method: 'POST',
        keepalive: true,
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body || {})
      }).catch(() => { });
      return true;
    } catch {
      return false;
    }
  }

  async function signOut() {
    const accepted = await confirmAction({ title: 'Sign out?', message: 'You will need to sign in again to access the system.', acceptLabel: 'Sign out' });
    if (!accepted) return;
    let endpoint = '';
    try { endpoint = localStorage.getItem('myipon_webpush_endpoint') || ''; } catch { }
    // Dispatch server cleanup via keepalive so navigation happens immediately without blocking
    flushLastSeen({ keepalive: true, force: true });
    fireKeepaliveRpc('delete_push_subscription', { p_endpoint: endpoint || null });
    fireKeepaliveRpc('revoke_notification_feed_token', {});
    if (currentProfile?.id) {
      try { localStorage.removeItem(`myipon_webpush_synced_${currentProfile.id}`); } catch { }
    }
    try { localStorage.removeItem('myipon_webpush_endpoint'); } catch { }
    lastWebPushSyncAt = 0;
    try {
      if (!isInstalledAppUser() && !isLocalDevHost && 'serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration('/sw.js')
          .then((reg) => reg?.pushManager?.getSubscription?.())
          .then((sub) => sub?.unsubscribe?.())
          .catch(() => { });
      }
    } catch { }
    try { getBackgroundNotificationsPlugin()?.clear?.().catch?.(() => { }); } catch { }
    clearStoredAuthTokens();
    try { localStorage.setItem('myipon_clerk_signout', '1'); } catch { }
    broadcastAuthEvent('SIGNED_OUT');
    try { getClient()?.auth?.signOut?.({ scope: 'local' })?.catch?.(() => { }); } catch { }
    document.documentElement.style.visibility = 'hidden';
    window.location.replace('login.html');
  }

  function toast(message, tone = 'success') {
    const element = document.getElementById('app-toast');
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
    try {
      if (typeof element.showPopover === 'function') {
        if (element.matches?.(':popover-open')) element.hidePopover?.();
        element.showPopover();
      }
    } catch { }
    element.classList.add('is-visible');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      element.classList.remove('is-visible');
      try { if (element.matches?.(':popover-open')) element.hidePopover?.(); } catch { }
    }, 4000);
  }

  function friendlyError(error) {
    const raw = typeof error === 'string' ? error : (error?.message || String(error || ''));
    const message = String(raw || '').trim();
    const combined = `${error?.name || ''} ${error?.code || ''} ${message}`.trim();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'No internet connection. Please check your connection and try again.';
    }
    if (/failed to fetch|load failed|networkerror|network request failed|failed to send a request to the edge function|err_internet_disconnected|err_network_changed|err_name_not_resolved|fetcherror|functionsfetcherror|econnrefused|econnreset/i.test(combined)) {
      return 'Something went wrong. Please check your internet connection and try again.';
    }
    if (/aborterror|timed out|timeout/i.test(combined)) {
      return 'The request timed out. Please try again.';
    }
    if (/mfa_verification_failed|invalid.*totp|challenge.*expired/i.test(combined)) return 'That authenticator code is invalid or expired. Enter the latest code and try again.';
    if (/rate limit|too many requests|over_email_send_rate_limit/i.test(combined)) return 'Too many attempts. Wait a moment, then try again.';
    if (/duplicate key|unique constraint/i.test(message)) return 'That reference was already used.';
    if (/cannot remove or disable your own administrator|another active administrator/i.test(message)) return 'Assign another active administrator before changing administrator access.';
    if (/row-level security|permission denied|not allowed to|only (?:a |an )?.*administrator/i.test(message)) return 'You do not have permission for that action.';
    if (!/^(?:Gemini AI failed to generate release notes:|Generative Language API|Google AI Studio|This key is a Google Cloud|Gemini server API key|Google Cloud billing is disabled for this)/i.test(message)) {
      if (/BILLING_DISABLED|requires billing to be enabled|billing is disabled/i.test(message)) return 'Google Cloud billing is disabled for the current Google Cloud project key. Enable Cloud billing on that project, or click Configure API key to save a free-tier key from Google AI Studio.';
      if (/ACCESS_TOKEN_TYPE_UNSUPPORTED|API key not valid|API_KEY_INVALID|API key expired/i.test(message)) return 'The server Gemini API key was rejected or revoked by Google. Click Configure API key to test and save a fresh Google AI Studio key.';
    }
    if (!message || /^(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError):/i.test(message) || message === '[object Object]') {
      return 'Something went wrong. Please try again.';
    }
    return message;
  }

  function showInlineError(container, error, retry, colspan = 1, heading = 'Unable to load this section', extraAction = null) {
    if (!container) return;
    if (container.tagName !== 'TBODY') container.hidden = false;
    const hasActions = Boolean(retry || extraAction?.label);
    const actionsHtml = hasActions
      ? `<div class="inline-error-actions">${retry ? '<button class="button button-secondary" data-inline-action="retry" type="button">Retry</button>' : ''}${extraAction?.label ? `<button class="button button-primary" data-inline-action="extra" type="button">${escapeHtml(extraAction.label)}</button>` : ''}</div>`
      : '';
    const content = `<div class="inline-error" role="alert"><strong>${escapeHtml(heading)}</strong><span>${escapeHtml(friendlyError(error))}</span>${actionsHtml}</div>`;
    container.innerHTML = container.tagName === 'TBODY' ? `<tr><td colspan="${colspan}">${content}</td></tr>` : content;
    const retryBtn = container.querySelector('[data-inline-action="retry"]');
    retryBtn?.addEventListener('click', async () => {
      retryBtn.disabled = true;
      try { await retry(); } catch (nextError) { showInlineError(container, nextError, retry, colspan, heading, extraAction); }
    });
    const extraBtn = container.querySelector('[data-inline-action="extra"]');
    extraBtn?.addEventListener('click', () => extraAction?.onClick?.());
  }

  function setBusy(button, busy, label = 'Saving…') {
    if (!button) return;
    button.classList.toggle('is-busy', busy);
    if (busy) {
      if (!button.dataset.originalLabel) {
        button.dataset.originalLabel = button.textContent;
      }
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      delete button.dataset.originalLabel;
      button.disabled = button.dataset?.dirtyLocked === 'true';
    }
  }

  function readFormSnapshot(form, getExtraState) {
    const parts = [];
    const elements = form?.elements ? Array.from(form.elements) : [];
    elements.forEach((el, idx) => {
      if (!el || el.type === 'submit' || el.type === 'button' || el.type === 'reset' || el.type === 'file') return;
      const key = el.name || el.id || String(idx);
      const val = (el.type === 'checkbox' || el.type === 'radio')
        ? (el.checked ? '1' : '0')
        : String(el.value ?? '');
      parts.push([key, val]);
    });
    if (typeof getExtraState === 'function') parts.push(['__extra', getExtraState()]);
    return JSON.stringify(parts);
  }

  function bindDirtySaveForm(form, button, { getExtraState, getActive } = {}) {
    const resolveBtn = () => button || form?.querySelector?.('[type="submit"]');
    let baseline = readFormSnapshot(form, getExtraState);
    const sync = () => {
      const btn = resolveBtn();
      if (!form || !btn) return false;
      const active = typeof getActive === 'function' ? Boolean(getActive()) : true;
      if (!active) {
        if (btn.dataset) delete btn.dataset.dirtyLocked;
        if (!btn.classList?.contains?.('is-busy')) btn.disabled = false;
        if (btn.title === 'Make a change before saving.') btn.title = '';
        return true;
      }
      const dirty = readFormSnapshot(form, getExtraState) !== baseline;
      if (btn.dataset) {
        if (dirty) delete btn.dataset.dirtyLocked;
        else btn.dataset.dirtyLocked = 'true';
      }
      if (!btn.classList?.contains?.('is-busy')) btn.disabled = !dirty;
      if (dirty) {
        if (btn.title === 'Make a change before saving.') btn.title = '';
      } else if (!btn.title) {
        btn.title = 'Make a change before saving.';
      }
      return dirty;
    };
    const reset = () => {
      baseline = readFormSnapshot(form, getExtraState);
      sync();
    };
    if (form) {
      form.addEventListener('input', sync);
      form.addEventListener('change', sync);
      form.addEventListener('reset', () => setTimeout(sync, 0));
    }
    sync();
    return { sync, reset, isDirty: () => readFormSnapshot(form, getExtraState) !== baseline };
  }

  function confirmAction({ title = 'Continue?', message = '', acceptLabel, confirmLabel, confirmText, cancelLabel } = {}) {
    const dialog = document.getElementById('confirm-dialog');
    const resolvedAccept = acceptLabel || confirmLabel || confirmText || 'Confirm';
    const resolvedCancel = cancelLabel || 'Cancel';
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const cancelButton = document.getElementById('confirm-cancel') || dialog.querySelector('button[value="cancel"]');
    if (cancelButton) cancelButton.textContent = resolvedCancel;
    document.getElementById('confirm-accept').textContent = resolvedAccept;
    dialog.returnValue = '';
    if (!dialog.dataset.backdropBound) {
      dialog.dataset.backdropBound = 'true';
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close('cancel');
      });
    }
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }

  const recordReviewMeta = {
    actions: {
      CONFIRM: {
        label: 'Confirm',
        hint: 'Approve and include in group savings',
        verb: 'confirm',
        confirmTitle: 'Confirm this entry?',
        submitLabel: 'Yes, confirm entry',
        tone: 'confirm'
      },
      REJECT: {
        label: 'Reject',
        hint: 'Decline and keep out of group savings',
        verb: 'reject',
        confirmTitle: 'Reject this entry?',
        submitLabel: 'Yes, reject entry',
        tone: 'danger'
      },
      VOID: {
        label: 'Void record',
        hint: 'Cancel confirmed entry from totals',
        verb: 'void',
        confirmTitle: 'Void this record?',
        submitLabel: 'Yes, void record',
        tone: 'danger'
      }
    },
    types: {
      contribution: { label: 'Savings Addition', klass: 'is-addition' },
      withdrawal: { label: 'Deduction', klass: 'is-deduction' },
      expense: { label: 'Expense', klass: 'is-expense' }
    }
  };

  /** Derive normalized summary metadata for a financial record dialog entry. */
  function describeRecordEntry(entry) {
    if (!entry) return null;
    const entryType = recordReviewMeta.types[entry.type] || { label: entry.typeLabel || 'Financial Record', klass: 'is-addition' };
    const personName = entry.authorName || entry.memberName || 'Group member';
    const submitterName = entry.submittedByName && entry.submittedByName !== personName ? entry.submittedByName : '';
    const amountText = entry.amount !== undefined && entry.amount !== null ? money(entry.amount) : '';
    return { entryType, personName, submitterName, amountText };
  }

  function renderRecordSummaryInto(summaryBox, entry, { showDiscussAction = false } = {}) {
    if (!summaryBox) return null;
    const entryMeta = describeRecordEntry(entry);
    if (!entryMeta) {
      summaryBox.innerHTML = '';
      summaryBox.hidden = true;
      return null;
    }
    const { entryType, personName, submitterName, amountText } = entryMeta;
    const metaChips = [
      entry.date ? `Date: ${dateLabel(entry.date)}` : '',
      entry.periodMonth ? `For ${dateLabel(entry.periodMonth, { month: 'short', year: 'numeric' })}` : '',
      entry.category ? `Category: ${entry.category}` : '',
      entry.reference ? `Ref: ${entry.reference}` : ''
    ].filter(Boolean);
    const detailText = entry.reviewNote || entry.notes || entry.description || '';
    const discussBar = showDiscussAction && entry.id && entry.type
      ? `<div class="record-review-discuss-bar"><span>Need clarification before deciding?</span><button type="button" class="icon-action record-discuss-btn" id="record-review-discuss-btn">Open discussion</button></div>`
      : '';
    summaryBox.innerHTML = `
      <div class="record-review-summary-top">
        <div class="record-review-summary-pills">
          <span class="record-type-pill ${entryType.klass}">${escapeHtml(entryType.label)}</span>
          ${entry.paymentMethod ? paymentMethodBadge(entry.paymentMethod) : ''}
        </div>
        ${entry.status ? `<span class="status status-${escapeHtml(String(entry.status).toLowerCase().replace(/[^a-z0-9]+/g, '-'))}">${escapeHtml(entry.status)}</span>` : '<span class="status status-pending">PENDING</span>'}
      </div>
      <div class="record-review-summary-main">
        <div class="record-review-author">
          ${avatarMarkup(entry.avatarUrl || '', personName, 'avatar-md')}
          <div>
            <strong>${escapeHtml(personName)}${verifiedBadgesHtml(entry.authorUserId || entry.submittedBy || entry.memberId || personName)}</strong>
            ${submitterName ? `<small>Added by ${escapeHtml(submitterName)}</small>` : `<small>${escapeHtml(entryType.label)} contributor</small>`}
          </div>
        </div>
        <div class="record-review-amount">
          <small>Amount</small>
          <strong>${escapeHtml(amountText)}</strong>
        </div>
      </div>
      ${metaChips.length ? `<div class="record-review-meta">${metaChips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')}</div>` : ''}
      ${detailText ? `<p class="record-review-detail-note">${escapeHtml(detailText)}</p>` : ''}
      ${entry.receiptUrl && isSafeImageRef(entry.receiptUrl) ? `
        <button class="record-review-receipt record-review-receipt-btn" type="button" data-summary-receipt-btn>
          <img src="${entry.receiptUrl}" alt="Attached payment receipt">
          <span><strong>Attached payment receipt</strong><small>Tap to view full screenshot</small></span>
        </button>` : ''}
      ${discussBar}`;
    bindAvatarFallbacks(summaryBox);
    summaryBox.querySelector('[data-summary-receipt-btn]')?.addEventListener('click', () => {
      openImageViewer(entry.receiptUrl, `${personName} receipt`, `${amountText}${entry.date ? ` · ${dateLabel(entry.date)}` : ''}`);
    });
    if (showDiscussAction && entry.id && entry.type) {
      const discussBtn = summaryBox.querySelector('#record-review-discuss-btn');
      if (discussBtn) {
        discussBtn.dataset.recordId = entry.id;
        discussBtn.addEventListener('click', () => openRecordDiscussion(entry.type, entry.id));
        getRecordCommentCounts(entry.type, [entry.id]).then((counts) => {
          const info = counts.get(entry.id);
          const unread = typeof info === 'object' ? Number(info?.unread || 0) : Number(info || 0);
          const total = typeof info === 'object' ? Number(info?.total || 0) : unread;
          if (unread > 0) {
            discussBtn.classList.add('has-comments');
            discussBtn.innerHTML = `Discussion <span class="comment-count-pill">${unread}</span>`;
          } else if (total > 0) {
            discussBtn.classList.remove('has-comments');
            discussBtn.textContent = 'Discussion';
          }
        }).catch(() => { });
      }
    }
    summaryBox.hidden = false;
  }

  function requestRecordAction({ title = 'Review record', actions = ['CONFIRM', 'REJECT'], entry = null, onSubmit = null } = {}) {
    const dialog = document.getElementById('record-action-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(null);
    const form = document.getElementById('record-action-form');
    const summaryBox = document.getElementById('record-action-summary');
    const editStep = document.getElementById('record-action-step-edit');
    const confirmStep = document.getElementById('record-action-step-confirm');
    const options = document.getElementById('record-action-options');
    const reasonLabel = document.getElementById('record-action-reason-label');
    const reasonHelp = document.getElementById('record-action-help');
    const reason = document.getElementById('record-action-reason');
    const nextButton = document.getElementById('record-action-next');
    const backButton = document.getElementById('record-action-back');
    const submitButton = document.getElementById('record-action-submit');
    const confirmBox = document.getElementById('record-action-confirm-box');
    const confirmHeading = document.getElementById('record-action-confirm-heading');
    const confirmText = document.getElementById('record-action-confirm-text');
    const confirmNote = document.getElementById('record-action-confirm-note');
    const errorBox = document.getElementById('record-action-error');

    dialog.returnValue = '';
    document.getElementById('record-action-title').textContent = title;
    const entryMeta = describeRecordEntry(entry);
    renderRecordSummaryInto(summaryBox, entry, { showDiscussAction: true });

    options.innerHTML = actions.map((action, index) => {
      const meta = recordReviewMeta.actions[action] || {
        label: action[0] + action.slice(1).toLowerCase(),
        hint: ''
      };
      return `<label class="decision-card">
        <input type="radio" name="decision" value="${escapeHtml(action)}" ${index === 0 ? 'checked' : ''}>
        <span class="decision-card-copy">
          <strong>${escapeHtml(meta.label)}</strong>
          ${meta.hint ? `<small>${escapeHtml(meta.hint)}</small>` : ''}
        </span>
      </label>`;
    }).join('');
    reason.value = '';

    const setStep = (step) => {
      const isConfirm = step === 'confirm';
      if (editStep) editStep.hidden = isConfirm;
      if (confirmStep) confirmStep.hidden = !isConfirm;
      if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
    };

    const syncReason = () => {
      const decision = form.elements.decision.value;
      const requiresReason = decision !== 'CONFIRM';
      reason.required = requiresReason;
      if (reasonLabel) reasonLabel.textContent = decision === 'VOID' ? 'Void reason (required)' : decision === 'REJECT' ? 'Rejection reason (required)' : 'Review note (optional)';
      if (reasonHelp) reasonHelp.textContent = requiresReason ? 'Required so the contributor sees why this entry was declined or voided.' : 'Optional note for the permanent audit trail.';
      if (nextButton) nextButton.textContent = actions.length === 1 ? (recordReviewMeta.actions[decision]?.label || 'Continue') : 'Review & confirm';
    };

    options.onchange = syncReason;
    syncReason();
    setStep('edit');

    let isSubmitting = false;
    const setDialogSubmitting = (busy) => {
      isSubmitting = busy;
      setBusy(submitButton, busy);
      if (backButton) backButton.disabled = busy;
      dialog.querySelectorAll('[data-record-action-close]').forEach((btn) => { btn.disabled = busy; });
    };

    dialog.querySelectorAll('[data-record-action-close]').forEach((button) => {
      button.onclick = () => { if (!isSubmitting) dialog.close('cancel'); };
    });

    return new Promise((resolve) => {
      let pendingResult = null;

      form.onsubmit = (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        const decision = form.elements.decision.value;
        const note = reason.value.trim() || null;
        const meta = recordReviewMeta.actions[decision] || {
          label: decision,
          verb: decision.toLowerCase(),
          confirmTitle: `${decision[0] + decision.slice(1).toLowerCase()} this record?`,
          submitLabel: `Yes, ${decision.toLowerCase()}`,
          tone: decision === 'CONFIRM' ? 'confirm' : 'danger'
        };
        pendingResult = { decision, note };

        if (confirmBox) confirmBox.dataset.tone = meta.tone;
        if (confirmHeading) confirmHeading.textContent = meta.confirmTitle;
        if (confirmText) {
          const targetDesc = entryMeta
            ? `${entryMeta.amountText ? `${entryMeta.amountText} ` : ''}(${entryMeta.entryType.label}) for ${entryMeta.personName}`
            : 'this record';
          confirmText.textContent = `You are about to ${meta.verb} ${targetDesc}. Every decision is recorded in the audit trail.`;
        }
        if (confirmNote) {
          confirmNote.hidden = !note;
          confirmNote.textContent = note ? `Note: "${note}"` : '';
        }
        if (submitButton) {
          submitButton.className = `button ${meta.tone === 'danger' ? 'button-danger' : 'button-primary'}`;
          submitButton.textContent = decision === 'CONFIRM' && entryMeta?.amountText ? `Yes, confirm ${entryMeta.amountText}` : meta.submitLabel;
        }
        setStep('confirm');
        submitButton?.focus();
      };

      if (backButton) {
        backButton.onclick = () => {
          if (isSubmitting) return;
          setStep('edit');
          reason.focus();
        };
      }

      if (submitButton) {
        submitButton.onclick = async () => {
          if (isSubmitting || !pendingResult) return;
          if (typeof onSubmit === 'function') {
            setDialogSubmitting(true);
            if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
            try {
              await onSubmit(pendingResult);
              dialog.close('submit');
              resolve(pendingResult);
            } catch (error) {
              const message = friendlyError(error);
              if (errorBox) {
                errorBox.textContent = message;
                errorBox.hidden = false;
              }
              toast(message, 'error');
            } finally {
              setDialogSubmitting(false);
            }
            return;
          }
          dialog.close('submit');
          resolve(pendingResult);
        };
      }

      dialog.oncancel = (event) => {
        if (isSubmitting) event.preventDefault();
      };
      dialog.addEventListener('close', () => {
        setDialogSubmitting(false);
        if (dialog.returnValue !== 'submit') resolve(null);
      }, { once: true });
      dialog.showModal();
      options.querySelector('input')?.focus();
    });
  }

  const READ_ONLY_RPC_RE = /^(?:get_|list_|check_|preview_|super_admin_storage_overview|record_account_activity|mark_notification_read|mark_all_notifications_read)/i;

  async function rpc(name, params) {
    const client = getClient();
    if (!client) throw new Error('Supabase is not connected.');
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    const rpcName = String(name || '');
    if (!READ_ONLY_RPC_RE.test(rpcName)) {
      notifyLiveSync('data');
    }
    if (RPC_SUCCESS_SOUNDS[rpcName]) {
      playUiSound(RPC_SUCCESS_SOUNDS[rpcName]);
    }
    return data;
  }

  async function changePassword(password, currentPassword) {
    const client = getClient();
    const { data: refreshed } = await client.auth.refreshSession().catch(() => ({ data: { session: null } }));
    const headers = refreshed?.session?.access_token ? { Authorization: `Bearer ${refreshed.session.access_token}` } : undefined;
    const { error } = await client.functions.invoke('manage-account', { headers, body: { action: 'change-password', password, current_password: currentPassword } });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    const { error: refreshError } = await client.auth.refreshSession();
    if (refreshError) throw refreshError;
  }

  async function requiresMfaChallenge() {
    const client = getClient();
    if (!client) return false;
    const { data, error } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw error;
    return data.currentLevel === 'aal1' && data.nextLevel === 'aal2';
  }

  async function invokeAccountFunction(body) {
    const client = getClient();
    if (!client) throw new Error('Supabase is not connected.');
    const headers = {};
    const { data: { session } } = await client.auth.getSession().catch(() => ({ data: {} }));
    if (session?.access_token) {
      headers.Authorization = `Bearer ${session.access_token}`;
    } else if (config.supabaseAnonKey) {
      headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
    }
    const { data, error } = await client.functions.invoke('manage-account', { body, headers });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    return data || {};
  }

  const VIDEO_FILE_RE = /\.(mp4|webm|mov|m4v|avi|mkv|3gp|ogv|mpeg|mpg|flv|wmv)$/i;
  const MAX_ANNOUNCEMENT_MEDIA_BYTES = 50 * 1024 * 1024;
  const MAX_ANNOUNCEMENT_FILES = 20;

  function classifyAnnouncementFile(file) {
    const type = String(file?.type || '');
    const name = String(file?.name || '');
    const isImage = type.startsWith('image/') || PICTURE_FILE_RE.test(name);
    const isVideo = type.startsWith('video/') || VIDEO_FILE_RE.test(name);
    if (!isImage && !isVideo) throw new Error(`"${name || 'File'}" is not a supported picture or video format.`);
    if (file.size > MAX_ANNOUNCEMENT_MEDIA_BYTES) throw new Error(`"${name || 'File'}" exceeds the 50 MB size limit.`);
    return isVideo ? 'video' : 'image';
  }

  const ANNOUNCEMENT_PIN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

  function sortAnnouncementsList(list) {
    const parseMs = (val) => {
      const ms = Date.parse(val || '');
      return Number.isFinite(ms) ? ms : 0;
    };
    return (Array.isArray(list) ? list : []).slice().sort((a, b) => {
      const bPinned = Boolean(b?.is_pinned || b?.pinned_at) ? 1 : 0;
      const aPinned = Boolean(a?.is_pinned || a?.pinned_at) ? 1 : 0;
      if (bPinned !== aPinned) return bPinned - aPinned;
      if (bPinned && aPinned) {
        const pinDiff = parseMs(b.pinned_at) - parseMs(a.pinned_at);
        if (pinDiff !== 0) return pinDiff;
      }
      return parseMs(b?.created_at) - parseMs(a?.created_at);
    });
  }

  function ensureAnnouncementDialogs() {
    if (document.getElementById('announcement-viewer-dialog')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="form-dialog announcement-viewer-dialog" id="announcement-viewer-dialog" aria-labelledby="announcement-viewer-title">
        <div class="form-dialog-sheet">
          <header class="announcement-viewer-topbar">
            <div class="announcement-category-indicator">
              <span class="announcement-category-bar" aria-hidden="true"></span>
              <div class="announcement-category-meta">
                <span class="announcement-category-label">Announcement</span>
                <span class="announcement-pinned-badge announcement-viewer-pinned" id="announcement-viewer-pinned" hidden>${ANNOUNCEMENT_PIN_SVG}<span>Pinned</span></span>
              </div>
            </div>
            <button class="dialog-close announcement-modal-close" id="announcement-viewer-close" type="button" aria-label="Close announcement"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="announcement-viewer-body">
            <div id="announcement-viewer-release-banner"></div>
            <div class="announcement-item-meta" id="announcement-viewer-meta"></div>
            <h2 class="announcement-viewer-title" id="announcement-viewer-title">Announcement</h2>
            <hr class="announcement-viewer-rule" aria-hidden="true">
            <div class="announcement-viewer-description" id="announcement-viewer-description"></div>
            <div class="announcement-viewer-release-features" id="announcement-viewer-release-features"></div>
            <div class="announcement-viewer-media" id="announcement-viewer-media"></div>
          </div>
          <div class="announcement-viewer-actions">
            <div class="announcement-viewer-owner-actions">
              <button class="button button-danger" id="announcement-viewer-delete" type="button" hidden>Delete announcement</button>
              <button class="button button-secondary announcement-viewer-pin-btn" id="announcement-viewer-pin" type="button" aria-pressed="false" hidden>${ANNOUNCEMENT_PIN_SVG}<span>Pin</span></button>
            </div>
            <div class="announcement-viewer-reactions-wrap" id="announcement-viewer-reactions"></div>
            <button class="button announcement-viewer-done-btn" id="announcement-viewer-done" type="button">Close</button>
          </div>
        </div>
      </dialog>
      <dialog class="form-dialog announcement-reactions-dialog" id="announcement-reactions-dialog" aria-labelledby="announcement-reactions-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="announcement-reactions-title">Reactions</h2>
              <p id="announcement-reactions-copy">People who reacted to this announcement.</p>
            </div>
            <button class="dialog-close" id="announcement-reactions-close" type="button" aria-label="Close reactions"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="announcement-reactions-tabs-bar" id="announcement-reactions-tabs"></div>
          <div class="announcement-reactions-body" id="announcement-reactions-list">
            <p class="empty-state">Loading reactions…</p>
          </div>
          <div class="announcement-reactions-actions">
            <button class="button button-secondary" id="announcement-reactions-done" type="button">Close</button>
          </div>
        </div>
      </dialog>
      <dialog class="form-dialog announcement-compose-dialog" id="announcement-compose-dialog" aria-labelledby="announcement-compose-title">
        <div class="form-dialog-sheet">
          <header class="form-dialog-header">
            <div><h2 id="announcement-compose-title">Add announcement</h2><p>Share updates with unlimited text, pictures, or videos.</p></div>
            <button class="dialog-close" id="announcement-compose-close" type="button" aria-label="Close announcement form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <form id="announcement-compose-form" class="form-grid">
            <div class="field field-wide"><label for="announcement-title-input">Title</label><input id="announcement-title-input" name="title" placeholder="Announcement title" required></div>
            <div class="field field-wide"><label for="announcement-description-input">Description</label><textarea id="announcement-description-input" name="description" rows="6" placeholder="Write the full announcement…" required></textarea></div>
            <div class="field field-wide">
              <label for="announcement-media-input">Pictures or videos (optional)</label>
              <div class="bug-upload-box">
                <input id="announcement-media-input" type="file" accept="image/*,video/*" multiple aria-describedby="announcement-media-help">
                <small class="field-help" id="announcement-media-help">No files selected. Any picture or video format up to 50 MB each.</small>
              </div>
              <div class="bug-image-grid" id="announcement-media-previews" hidden></div>
            </div>
            <div class="form-actions field-wide">
              <button class="button button-secondary" id="announcement-compose-cancel" type="button">Cancel</button>
              <button class="button button-primary" type="submit">Publish announcement</button>
            </div>
          </form>
        </div>
      </dialog>`);
  }

  const ANNOUNCEMENT_REACTIONS = ['👍', '❤️', '😆', '😮', '😢', '😡'];
  const REACTION_LABELS = { '👍': 'Like', '❤️': 'Love', '😆': 'Haha', '😮': 'Wow', '😢': 'Sad', '😡': 'Angry' };

  function announcementAuthorMeta(item) {
    const isOwner = item.author_role === 'SUPER_ADMIN';
    const isOwnPost = currentProfile?.id && item?.author_id === currentProfile.id;
    const name = (isOwnPost && currentProfile.full_name) || item.author_name || (isOwner ? 'Owner' : 'Administrator');
    const avatarUrl = (isOwnPost && currentProfile.avatar_url !== undefined) ? currentProfile.avatar_url : item.author_avatar_url;
    const rawAvatarHtml = avatarMarkup(avatarUrl, name, `announcement-avatar${isOwner ? ' is-owner' : ''}`, item.author_id);
    const socialTargetId = (isOwner && item.author_social_user_id && currentProfile?.role !== 'SUPER_ADMIN')
      ? String(item.author_social_user_id)
      : '';
    const avatarHtml = socialTargetId
      ? `<button type="button" class="msg-dp-btn announcement-owner-dp-btn" data-social-user-dp="${escapeHtml(socialTargetId)}" data-social-hover-dp="${escapeHtml(socialTargetId)}" aria-label="View connected owner profile" title="Hover or click to view connected profile">${rawAvatarHtml}</button>`
      : rawAvatarHtml;
    const authorHtml = `<span class="announcement-author${isOwner ? ' is-owner' : ''}">${escapeHtml(name)}</span>`;
    const dateText = dateLabel(item.created_at, { dateStyle: 'medium', timeStyle: 'short' }).replace(/,\s*(\d{1,2}:\d{2}\s*(?:AM|PM))$/i, ' · $1');
    return `${avatarHtml}${authorHtml}<span class="announcement-meta-dot" aria-hidden="true">&middot;</span><time datetime="${escapeHtml(item.created_at)}">${escapeHtml(dateText)}</time>`;
  }

  function renderAnnouncementDescriptionHtml(rawText, releaseVersion) {
    if (!rawText) return '';
    const text = String(rawText).trim();
    const lines = text.split('\n');

    const classifySectionHeader = (line) => {
      const cleaned = String(line || '')
        .trim()
        .replace(/^#{1,4}\s+/, '')
        .replace(/^\*{1,2}(.+?)\*{1,2}$/, '$1')
        .replace(/:$/, '')
        .trim();
      if (!cleaned || cleaned.length > 72) return null;
      if (/^(?:features?\s+requested|community\s+(?:requested|feature\s+requests?|spotlight)|requested\s+by\s+savers|user-requested\s+features)\b/i.test(cleaned)) {
        return { kind: 'requested', label: cleaned };
      }
      if (/^(?:new\s+features?|features?|what['’]?s\s+new|key\s+highlights?|highlights?)$/i.test(cleaned)) {
        return { kind: 'features', label: 'New Features' };
      }
      if (/^(?:fixes|bug\s*fixes?|resolved\s+issues?)$/i.test(cleaned)) {
        return { kind: 'fixes', label: 'Fixes' };
      }
      if (/^(?:improvements?|enhancements?|updates?|performance(?:\s*&\s*|\s+and\s+)polish)$/i.test(cleaned)) {
        return { kind: 'improvements', label: 'Improvements' };
      }
      if (/^(?:security(?:\s+updates?|\s*&\s*privacy|\s+enhancements?|\s+fixes)?)$/i.test(cleaned)) {
        return { kind: 'security', label: 'Security Updates' };
      }
      if (/^(?:other\s+changes?|miscellaneous|other\s+updates?)$/i.test(cleaned)) {
        return { kind: 'other', label: 'Other Changes' };
      }
      if (/^(?:#{1,4}\s+|(?:\*\*[^*]+\*\*)$)/.test(String(line || '').trim()) || /:\s*$/.test(String(line || '').trim())) {
        if (!/[.!?]$/.test(cleaned) && cleaned.split(/\s+/).length <= 7) {
          return { kind: 'custom', label: cleaned };
        }
      }
      return null;
    };

    const parseBulletLine = (line) => {
      const cleanLine = String(line || '').replace(/^[•\-*]\s*/, '').trim();
      const delimMatch = cleanLine.match(/^(.*?)(:\s+|—\s*|\s+-\s+)(.*)$/);
      let titlePart = '';
      let descPart = cleanLine;
      if (delimMatch) {
        titlePart = delimMatch[1].replace(/^\*{1,2}|\*{1,2}$/g, '').trim();
        descPart = delimMatch[3].trim();
      }
      return { titlePart, descPart, raw: cleanLine };
    };

    const inferReleaseBulletKind = (textVal) => {
      if (/\b(?:security|vulnerabilit|rls|permission|auth(?:entication|orization)?|encrypt|csp|xss|csrf|hardening)\b/i.test(textVal)) {
        return 'security';
      }
      if (/\b(?:fix(?:ed|es)?|bug|error|resolve[ds]?|prevent(?:ed|s)?|deduplicate|restore[ds]?|constraint|foreign\s+key)\b/i.test(textVal)) {
        return 'fixes';
      }
      if (/\b(?:improv(?:e[ds]?|ement)|polish|compact|clutter|refactor|faster|reliab|sync(?:hroniz)?|clean(?:er|ed)?|streamline)\b/i.test(textVal)) {
        return 'improvements';
      }
      return 'features';
    };

    const isOutro = (l) => /(?:grateful|thank\s+you|happy\s+saving|enjoy\s+the\s+new\s+update)/i.test(l);

    const blocks = [];
    let currentSection = null;
    let inRequestedBox = false;
    let requestedHeading = '';
    let requestedItems = [];
    let hasExplicitSections = false;

    const flushSection = () => {
      if (currentSection && currentSection.items.length) {
        blocks.push({ type: 'section', ...currentSection });
      }
      currentSection = null;
    };

    const flushRequestedBox = () => {
      if (!inRequestedBox) return;
      blocks.push({ type: 'requested', heading: requestedHeading, items: requestedItems });
      inRequestedBox = false;
      requestedHeading = '';
      requestedItems = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (inRequestedBox && i + 1 < lines.length && isOutro(lines[i + 1])) flushRequestedBox();
        continue;
      }

      const headerInfo = classifySectionHeader(line);
      if (headerInfo) {
        flushSection();
        flushRequestedBox();
        if (headerInfo.kind === 'requested') {
          inRequestedBox = true;
          requestedHeading = headerInfo.label;
        } else {
          hasExplicitSections = true;
          currentSection = { kind: headerInfo.kind, label: headerInfo.label, items: [] };
        }
        continue;
      }

      if (inRequestedBox) {
        if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
          requestedItems.push(line.replace(/^[•\-*]\s*/, '').trim());
          continue;
        }
        if (isOutro(line)) {
          flushRequestedBox();
        } else {
          requestedItems.push(line);
          continue;
        }
      }

      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
        const parsed = parseBulletLine(line);
        if (currentSection) {
          currentSection.items.push(parsed);
        } else {
          blocks.push({ type: 'loose-bullet', item: parsed });
        }
        continue;
      }

      const hasMoreStructuredContent = lines.slice(i + 1).some((nextLine) => {
        const t = String(nextLine || '').trim();
        return t && (t.startsWith('•') || t.startsWith('-') || t.startsWith('*') || Boolean(classifySectionHeader(t)));
      });
      if (isOutro(line) && !hasMoreStructuredContent) {
        flushSection();
        flushRequestedBox();
        const restLines = lines.slice(i).map((l) => l.trim()).filter(Boolean);
        blocks.push({ type: 'outro', lines: restLines });
        break;
      }

      flushSection();
      blocks.push({ type: 'para', text: line });
    }

    flushSection();
    flushRequestedBox();

    // Auto-section unheaded release bullets into New Features / Fixes / Improvements so
    // both new and earlier release updates display clean scannable sections.
    const normalizedBlocks = [];
    if (releaseVersion && !hasExplicitSections) {
      const autoGroups = {
        features: { type: 'section', kind: 'features', label: 'New Features', items: [] },
        fixes: { type: 'section', kind: 'fixes', label: 'Fixes', items: [] },
        improvements: { type: 'section', kind: 'improvements', label: 'Improvements', items: [] },
        security: { type: 'section', kind: 'security', label: 'Security Updates', items: [] },
        other: { type: 'section', kind: 'other', label: 'Other Changes', items: [] }
      };
      let flushedAuto = false;
      const flushAutoGroups = () => {
        if (flushedAuto) return;
        ['features', 'fixes', 'improvements', 'security', 'other'].forEach((key) => {
          if (autoGroups[key].items.length) normalizedBlocks.push(autoGroups[key]);
        });
        flushedAuto = true;
      };
      blocks.forEach((b) => {
        if (b.type === 'loose-bullet') {
          const kind = inferReleaseBulletKind(b.item.raw);
          autoGroups[kind].items.push(b.item);
        } else {
          if (b.type === 'requested' || b.type === 'outro') flushAutoGroups();
          normalizedBlocks.push(b);
        }
      });
      flushAutoGroups();
    } else {
      let pendingBullets = [];
      const flushPendingBullets = () => {
        if (!pendingBullets.length) return;
        normalizedBlocks.push({ type: 'loose-bullets', items: pendingBullets });
        pendingBullets = [];
      };
      blocks.forEach((b) => {
        if (b.type === 'loose-bullet') pendingBullets.push(b.item);
        else {
          flushPendingBullets();
          normalizedBlocks.push(b);
        }
      });
      flushPendingBullets();
    }

    const renderSectionItem = (item) => {
      const creditMatch = (item.descPart || '').match(/\((Requested by:[^)]+)\)/i);
      let descHtml = escapeHtml(item.descPart || '');
      if (creditMatch) {
        const escapedCredit = escapeHtml(creditMatch[0]);
        descHtml = descHtml.replace(escapedCredit, `<em class="announcement-requester-credit">${escapedCredit}</em>`);
      }
      return `
        <li class="announcement-section-item">
          <span class="announcement-item-dot" aria-hidden="true"></span>
          <div class="announcement-item-copy">
            ${item.titlePart ? `<strong class="announcement-item-title">${escapeHtml(item.titlePart)}</strong>` : ''}
            ${descHtml ? `<p class="announcement-item-desc">${descHtml}</p>` : ''}
          </div>
        </li>`;
    };

    return normalizedBlocks.map((block) => {
      if (block.type === 'section') {
        const toneClass = block.kind === 'fixes' ? 'is-fixes' : block.kind === 'improvements' ? 'is-improvements' : block.kind === 'security' ? 'is-security' : block.kind === 'other' ? 'is-other' : block.kind === 'features' ? 'is-features' : '';
        return `
          <section class="announcement-section-block ${toneClass}">
            <div class="announcement-section-bar">
              <h3 class="announcement-section-heading-text">${escapeHtml(block.label)}</h3>
              <span class="announcement-section-count">${block.items.length}</span>
            </div>
            <ul class="announcement-section-items">
              ${block.items.map(renderSectionItem).join('')}
            </ul>
          </section>`;
      }
      if (block.type === 'requested') {
        return `
          <div class="announcement-requested-card">
            <div class="announcement-requested-accent" aria-hidden="true"></div>
            <div class="announcement-requested-inner">
              <strong class="announcement-requested-title">${escapeHtml(block.heading)}</strong>
              <div class="announcement-requested-list">
                ${block.items.map((item) => {
          const creditMatch = item.match(/\((Requested by:[^)]+)\)/i);
          let itemHtml = escapeHtml(item);
          if (creditMatch) {
            const escapedCredit = escapeHtml(creditMatch[0]);
            itemHtml = itemHtml.replace(escapedCredit, `<em class="announcement-requester-credit">${escapedCredit}</em>`);
          }
          return `
                    <div class="announcement-requested-item">
                      <span class="announcement-bullet-dot" aria-hidden="true">•</span>
                      <span>${itemHtml}</span>
                    </div>`;
        }).join('')}
              </div>
            </div>
          </div>`;
      }
      if (block.type === 'outro') {
        return `<div class="announcement-outro-block"><p>${block.lines.map((l) => escapeHtml(l)).join('<br>')}</p></div>`;
      }
      if (block.type === 'loose-bullets') {
        return block.items.map((item) => `
          <div class="announcement-feature-row">
            <span class="announcement-feature-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                <circle cx="10" cy="10" r="9" fill="#0d4a36" />
                <path d="M6 10.2l2.6 2.6L14 7.6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <div class="announcement-feature-text">
              ${item.titlePart ? `<strong class="announcement-feature-name">${escapeHtml(item.titlePart)} — </strong>` : ''}
              <span class="announcement-feature-desc">${escapeHtml(item.descPart)}</span>
            </div>
          </div>`).join('');
      }
      let paraHtml = escapeHtml(block.text || '');
      paraHtml = paraHtml.replace(/\b(myIPON\s+Update\s+[\w.\-]+|v\d+[\w.\-]*)\b/gi, (match) => {
        return `<span class="announcement-version-highlight">${match}</span>`;
      });
      return `<p class="announcement-intro-para">${paraHtml}</p>`;
    }).join('');
  }

  function bindAnnouncements({ listElement, addButton, allowPin = false, emptyTitle = 'No announcements yet', emptyNote = 'Stay tuned for updates' } = {}) {
    if (!listElement) return null;
    ensureAnnouncementDialogs();
    const viewerDialog = document.getElementById('announcement-viewer-dialog');
    const viewerReleaseBanner = document.getElementById('announcement-viewer-release-banner');
    const viewerMeta = document.getElementById('announcement-viewer-meta');
    const viewerTitle = document.getElementById('announcement-viewer-title');
    const viewerDescription = document.getElementById('announcement-viewer-description');
    const viewerMedia = document.getElementById('announcement-viewer-media');
    const viewerDelete = document.getElementById('announcement-viewer-delete');
    const viewerPinBtn = document.getElementById('announcement-viewer-pin');
    const viewerPinnedBadge = document.getElementById('announcement-viewer-pinned');
    const viewerReactions = document.getElementById('announcement-viewer-reactions');
    const reactionsDialog = document.getElementById('announcement-reactions-dialog');
    const reactionsTabs = document.getElementById('announcement-reactions-tabs');
    const reactionsList = document.getElementById('announcement-reactions-list');
    const reactionsTitle = document.getElementById('announcement-reactions-title');
    const composeDialog = document.getElementById('announcement-compose-dialog');
    const composeForm = document.getElementById('announcement-compose-form');
    const mediaInput = document.getElementById('announcement-media-input');
    const mediaHelp = document.getElementById('announcement-media-help');
    const mediaPreviews = document.getElementById('announcement-media-previews');
    let items = [];
    let reactions = [];
    let queuedMedia = [];
    let openItemId = null;
    let activePickerAnnouncementId = null;
    let currentModalAnnouncementId = null;
    let modalReactionsData = [];
    let activeReactionTab = 'all';

    const canDelete = (item) => {
      if (!item || !currentProfile) return false;
      if (currentProfile.role === 'SUPER_ADMIN') return true;
      return currentProfile.role === 'ADMIN' && item.author_role === 'ADMIN' && item.group_id === currentProfile.group_id;
    };
    const canPin = () => Boolean(allowPin && currentProfile?.role === 'SUPER_ADMIN');

    const syncViewerPinUi = (item) => {
      const pinned = Boolean(item?.is_pinned || item?.pinned_at);
      viewerDialog?.classList?.toggle?.('is-pinned', pinned);
      if (viewerPinnedBadge) viewerPinnedBadge.hidden = !pinned;
      if (viewerPinBtn) {
        viewerPinBtn.hidden = !item || !canPin();
        viewerPinBtn.classList?.toggle?.('is-pinned', pinned);
        viewerPinBtn.setAttribute?.('aria-pressed', pinned ? 'true' : 'false');
        const label = viewerPinBtn.querySelector?.('span');
        if (label) label.textContent = pinned ? 'Unpin' : 'Pin';
      }
    };

    const handlePinToggle = async (announcementId, triggerBtn = null) => {
      if (!canPin()) return;
      const target = items.find((entry) => entry.id === announcementId);
      if (!target) return;
      const nextPinned = !Boolean(target.is_pinned || target.pinned_at);
      const isViewerBtn = triggerBtn === viewerPinBtn;
      if (triggerBtn) {
        if (isViewerBtn) setBusy(triggerBtn, true, nextPinned ? 'Pinning…' : 'Unpinning…');
        else triggerBtn.disabled = true;
      }
      try {
        const res = await rpc('set_announcement_pinned', {
          p_announcement_id: target.id,
          p_pinned: nextPinned
        });
        const isNowPinned = Boolean(res?.is_pinned ?? nextPinned);
        target.is_pinned = isNowPinned;
        target.pinned_at = res?.pinned_at || (isNowPinned ? new Date().toISOString() : null);
        items = sortAnnouncementsList(items);
        renderList();
        if (viewerDialog?.open && openItemId === target.id) {
          syncViewerPinUi(target);
        }
        notifyLiveSync('announcements');
        toast(isNowPinned ? 'Announcement pinned to top.' : 'Announcement unpinned.');
      } catch (error) {
        toast(friendlyError(error), 'error');
      } finally {
        if (triggerBtn) {
          if (isViewerBtn) {
            setBusy(triggerBtn, false);
            syncViewerPinUi(target);
          } else {
            triggerBtn.disabled = false;
          }
        }
      }
    };

    const getReactionSummary = (announcementId) => {
      const list = reactions.filter((entry) => entry.announcement_id === announcementId);
      const count = list.length;
      const myReaction = currentProfile ? list.find((entry) => entry.user_id === currentProfile.id)?.reaction : null;
      const countsByEmoji = {};
      list.forEach((entry) => {
        countsByEmoji[entry.reaction] = (countsByEmoji[entry.reaction] || 0) + 1;
      });
      const topEmojis = Object.keys(countsByEmoji).sort((a, b) => {
        const diff = countsByEmoji[b] - countsByEmoji[a];
        if (diff !== 0) return diff;
        return ANNOUNCEMENT_REACTIONS.indexOf(a) - ANNOUNCEMENT_REACTIONS.indexOf(b);
      }).slice(0, 3);
      return { count, myReaction, topEmojis };
    };

    const renderReactionsBarHtml = (announcementId) => {
      const { count, myReaction, topEmojis } = getReactionSummary(announcementId);
      const isPickerOpen = activePickerAnnouncementId === announcementId;
      const pillHtml = count > 0 ? `
        <button class="announcement-reactions-pill" type="button" data-reactions-view="${escapeHtml(announcementId)}" aria-label="View reactions (${count})" title="View reactions">
          <span class="reactions-stack" aria-hidden="true">
            ${topEmojis.map((emoji) => `<span class="reaction-stack-emoji">${emoji}</span>`).join('')}
          </span>
          <span class="reactions-count">${count}</span>
        </button>` : '';

      const triggerLabel = myReaction ? `Reacted ${REACTION_LABELS[myReaction] || myReaction}` : 'React';
      const triggerHtml = `
        <div class="announcement-react-container">
... [truncated for diff preview]