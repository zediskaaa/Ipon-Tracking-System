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
  let quickMfaController = null;
  const STARTUP_TIMEOUT_MS = 15000;
  let loaderSafetyTimer = null;
  let navLoaderTimer = null;
  let activeLiveRefresh = null;

  const THEME_STORAGE_KEY = 'myipon_theme';
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
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#0b3428"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="IPON"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/icon-192.png">');
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
  if (!window.Capacitor && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
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
      window.addEventListener('online', checkSw);
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
    ['members', 'members.html', 'Members', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>', 'ADMIN'],
    ['reports', 'reports.html', 'Reports', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></svg>'],
    ['audit', 'audit.html', 'Audit log', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-7 4h8m-8 4h8m-8 4h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>', 'ADMIN'],
    ['settings', 'settings.html', 'Settings', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06.06 2.83 2.83-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z"/></svg>', 'ADMIN']
  ];
  const superAdminNavItems = [
    ['overview', 'super-admin.html#overview', 'Overview', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>'],
    ['requests', 'super-admin.html#requests', 'Requests', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8m-8 4h5"/></svg>'],
    ['feature-requests', 'super-admin.html#feature-requests', 'Feature requests', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.2 14 16 14 17h-4c0-1-.5-1.8-1.5-2.5Z"/></svg>'],
    ['bug-reports', 'super-admin.html#bug-reports', 'Bug reports', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6V5a4 4 0 0 1 8 0v1m-9 4h10a2 2 0 0 1 2 2v3a7 7 0 0 1-14 0v-3a2 2 0 0 1 2-2Zm-3 3H3m18 0h-1M6 9 4 7m14 2 2-2M6 17l-2 2m14-2 2 2"/></svg>'],
    ['administrators', 'super-admin.html#administrators', 'Users', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-1 2 2 4-4"/></svg>'],
    ['activity', 'super-admin.html#activity', 'Platform activity', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-7 4h8m-8 4h8m-8 4h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1 2-2V5a2 2 0 0 1 2-2Z"/></svg>']
  ];
  const userNavItems = [
    ['dashboard', 'dashboard.html', 'Calendar', navItems[0][3]],
    ['user', 'user.html', 'My savings', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M16 12h5m-5-2a2 2 0 1 0 0 4"/></svg>'],
    ['contributions', 'contributions.html', 'Records', navItems[1][3]],
    ['reports', 'reports.html', 'Reports', navItems[3][3]]
  ];
  const pageRoles = {
    dashboard: ['ADMIN', 'TREASURER', 'MEMBER'], members: ['ADMIN'], contributions: ['ADMIN', 'TREASURER', 'MEMBER'],
    withdrawals: ['ADMIN', 'TREASURER', 'MEMBER'], expenses: ['ADMIN', 'TREASURER', 'MEMBER'], savings: ['ADMIN', 'TREASURER', 'MEMBER'],
    reports: ['ADMIN', 'TREASURER', 'MEMBER'], audit: ['ADMIN'], settings: ['ADMIN'], user: ['MEMBER'],
    'super-admin': ['SUPER_ADMIN'], account: ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER']
  };
  const recordTabIcons = {
    'contributions.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/></svg>',
    'withdrawals.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    'expenses.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/></svg>',
    'savings.html': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 1h11l-2 4 2 4H5"/></svg>'
  };

  function setLoading(visible, label = 'Opening your records…') {
    if (loaderSafetyTimer) {
      clearTimeout(loaderSafetyTimer);
      loaderSafetyTimer = null;
    }
    let loader = document.getElementById('app-loader');
    if (!loader) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="app-loader" id="app-loader" role="status" aria-live="polite" hidden>
          <div class="loader-sheet">
            <strong class="loader-brand"><span class="brand-prefix">my</span>IPON</strong>
            <div class="savings-loader" aria-hidden="true">
              <span class="loader-coin"><b>₱</b></span>
              <svg class="piggy-bank" viewBox="0 0 190 132">
                <defs>
                  <linearGradient id="piggy-green" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0" stop-color="#4fa778"/>
                    <stop offset=".55" stop-color="#287552"/>
                    <stop offset="1" stop-color="#164b3d"/>
                  </linearGradient>
                  <linearGradient id="snout-green" x1="0" y1="0" x2="0" y2="1">
                    <stop stop-color="#68bc8e"/>
                    <stop offset="1" stop-color="#31805c"/>
                  </linearGradient>
                </defs>
                <ellipse class="piggy-shadow" cx="96" cy="123" rx="61" ry="7"/>
                <path class="piggy-tail" d="M39 72c-20 1-22-20-9-23 10-2 14 11 6 16"/>
                <path class="piggy-ear" d="M66 38c-1-17 7-27 22-10"/>
                <path class="piggy-body" d="M40 74c0-31 24-49 62-49 24 0 42 10 51 27l15 3c7 1 10 8 6 14l-10 14c-5 16-20 27-40 31l-3 12h-19l-3-10H74l-4 10H51l-1-20c-10-8-15-19-15-32Z"/>
                <path class="piggy-shine" d="M58 61c8-15 23-23 44-24"/>
                <ellipse class="piggy-slot" cx="96.5" cy="34" rx="16" ry="5"/>
                <ellipse class="piggy-snout" cx="158" cy="69" rx="13" ry="11"/>
                <circle class="piggy-eye" cx="139" cy="57" r="4"/>
                <circle class="piggy-eye-glint" cx="140" cy="56" r="1.3"/>
                <circle class="piggy-nostril" cx="154" cy="69" r="2"/>
                <circle class="piggy-nostril" cx="162" cy="69" r="2"/>
              </svg>
            </div>
            <p id="loader-label">Opening your records…</p>
            <small>Counting your latest savings activity.</small>
          </div>
        </div>`);
      loader = document.getElementById('app-loader');
    }
    if (!visible) document.body.classList.add('is-ready');
    const labelEl = document.getElementById('loader-label');
    if (labelEl) labelEl.textContent = label;
    loader.hidden = !visible;
    loader.setAttribute('aria-busy', String(visible));
    if (visible) {
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

  function resolveActiveRole(passedRole) {
    if (passedRole) return passedRole;
    if (currentProfile?.role) return currentProfile.role;
    const page = document.body.dataset.page;
    if (document.body.dataset.panel === 'super-admin' || page === 'super-admin') return 'SUPER_ADMIN';
    try {
      const cached = sessionStorage.getItem(ACTIVE_ROLE_KEY) || localStorage.getItem(ACTIVE_ROLE_KEY);
      if (cached && ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER'].includes(cached)) return cached;
    } catch { }
    if (page === 'user') return 'MEMBER';
    if (['members', 'audit', 'settings'].includes(page)) return 'ADMIN';
    return 'ADMIN';
  }

  function mountShell(role = currentProfile?.role) {
    const host = document.getElementById('app-sidebar');
    const effectiveRole = resolveActiveRole(role);
    if (host) {
      const page = document.body.dataset.page;
      const superAdminPanel = document.body.dataset.panel === 'super-admin';
      const navigation = (superAdminPanel || effectiveRole === 'SUPER_ADMIN' ? superAdminNavItems : effectiveRole === 'MEMBER' ? userNavItems : navItems)
        .filter(([, , , , requiredRole]) => !requiredRole || requiredRole === effectiveRole);
      const activeId = superAdminPanel ? location.hash.slice(1) || 'overview' : ['contributions', 'withdrawals', 'expenses', 'savings'].includes(page) ? 'contributions' : page;
      if (host.dataset.renderedRole === effectiveRole) {
        host.querySelectorAll('.app-nav a').forEach((link) => {
          const isActive = link.dataset.navSection === activeId;
          link.classList.toggle('is-active', isActive);
          if (isActive) link.setAttribute('aria-current', 'page');
          else link.removeAttribute('aria-current');
        });
      } else {
        host.dataset.renderedRole = effectiveRole;
        host.innerHTML = `
        ${brandHtml.replace('href="dashboard.html"', `href="${superAdminPanel ? 'super-admin.html' : 'dashboard.html'}"`)}
        <nav class="app-nav" aria-label="Main navigation">
          ${navigation.map(([id, href, label, icon, role]) => `<a class="${activeId === id ? 'is-active' : ''}" href="${href}" aria-label="${label}" data-nav-section="${id}"${activeId === id ? ' aria-current="page"' : ''}${role ? ` data-role="${role}"` : ''}>${icon || ''}<span>${label}</span></a>`).join('')}
        </nav>
        ${sidebarArtHtml}
        <div class="app-sidebar-footer">
          <div class="sidebar-utilities">
            <button class="sidebar-utility" data-notifications-open type="button" aria-label="Open notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg><b data-notification-count hidden>0</b></button>
          </div>
          <button class="sidebar-user-card" data-account-open type="button" aria-label="Open my account">
            <span class="avatar-presence-wrap">
              <span class="sidebar-user-avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>
              </span>
              <span class="presence-dot is-online" data-presence-id="${currentProfile?.id || ''}" aria-label="Active now" title="Active now"></span>
            </span>
            <div class="sidebar-user-info" id="sidebar-user">
              <strong>Checking session…</strong>
              <small>ACCOUNT</small>
            </div>
          </button>
          <button class="sidebar-signout text-button" id="sign-out" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/></svg>
            <span>Sign out</span>
          </button>
        </div>`;
        document.getElementById('sign-out')?.addEventListener('click', signOut);
      }
    }
    document.querySelectorAll('.record-tabs a').forEach((link) => {
      if (effectiveRole === 'TREASURER' && link.getAttribute('href') === 'savings.html') return link.remove();
      if (link.dataset.tabBound === '1') return;
      link.dataset.tabBound = '1';
      const label = link.textContent.trim();
      link.setAttribute('aria-label', label);
      link.innerHTML = `${recordTabIcons[link.getAttribute('href')] || ''}<span>${escapeHtml(label)}</span>`;
    });
    if (!document.getElementById('app-toast')) document.body.insertAdjacentHTML('beforeend', `
      <div class="toast" id="app-toast" popover="manual" role="status" aria-live="polite"></div>
      <dialog class="confirm-dialog" id="confirm-dialog">
        <form method="dialog">
          <h2 id="confirm-title">Continue?</h2>
          <p id="confirm-message"></p>
          <div class="dialog-actions">
            <button class="button button-secondary" value="cancel">Cancel</button>
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
              <textarea id="record-thread-input" name="body" rows="2" maxlength="1000" placeholder="Write a reply, paste a screenshot, or attach photos, videos, or files…"></textarea>
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
      <dialog class="notification-dialog" id="notification-dialog" aria-labelledby="notification-title">
        <div class="notification-sheet"><header><div class="notification-heading"><h2 id="notification-title">Notifications</h2><span>Recent activity</span></div><div class="notification-header-actions"><button class="notification-mark-read" id="mark-all-notifications" type="button">Mark all read</button><button class="dialog-close" data-notifications-close type="button" aria-label="Close notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><div class="notification-permission-bar" id="notification-permission-bar" hidden></div><div class="notification-list" id="notification-list" role="feed"><p class="empty-state">Loading notifications…</p></div></div>
      </dialog>
      <dialog class="donate-dialog" id="donate-dialog" aria-labelledby="donate-title">
        <div class="donate-sheet"><button class="dialog-close" data-donate-close type="button" aria-label="Close donation information">&times;</button><img class="donate-sticker" src="assets/donate-sticker.jpg" alt="" aria-hidden="true"><h2 id="donate-title">Support IPON</h2><p>Donations are voluntary support for the system developer and are never included in group savings or reports.</p><span>GCash number</span><strong id="donate-number">09913564248</strong><div class="donate-actions"><button class="button button-primary" id="copy-donate-number" type="button">Copy number</button><button class="button button-secondary" id="open-donate-qr" type="button">Scan me</button></div></div>
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
      <dialog class="account-dialog" id="account-dialog" aria-labelledby="quick-account-title">
        <div class="account-dialog-sheet">
          <header class="account-dialog-header"><div class="account-dialog-title"><div><h2 id="quick-account-title">My account</h2><p>Manage your account settings and preferences.</p></div></div><button class="dialog-close" data-account-close type="button" aria-label="Close account settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
          <div class="account-dialog-content">
            <section class="account-card account-profile-card"><div class="account-profile-identity"><div class="account-avatar-picker"><label class="account-avatar-trigger" for="quick-avatar-input" role="button" tabindex="0" title="Change profile picture" aria-label="Change profile picture"><span class="account-avatar-preview" id="quick-avatar-preview" aria-hidden="true"></span><span class="account-avatar-cam" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></label><button class="account-avatar-remove" id="quick-avatar-remove" type="button" title="Remove photo" aria-label="Remove profile picture" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><input id="quick-avatar-input" type="file" accept="image/*" hidden></div><span><strong id="quick-account-name">Account</strong><small id="quick-account-role">ROLE</small></span></div><form id="quick-profile-form" class="form-grid form-grid-3"><div class="field"><label for="quick-first-name">First name</label><input id="quick-first-name" name="first_name" maxlength="80" required></div><div class="field"><label for="quick-middle-name">Middle name (optional)</label><input id="quick-middle-name" name="middle_name" maxlength="80"></div><div class="field"><label for="quick-last-name">Last name</label><input id="quick-last-name" name="last_name" maxlength="80" required></div><div class="field field-wide"><label for="quick-contact">Mobile number</label><input id="quick-contact" name="contact_number" type="tel" inputmode="tel" autocomplete="tel" maxlength="13" pattern="(?:09[0-9]{9}|\+639[0-9]{9})" aria-describedby="quick-contact-help quick-contact-error" required><small class="field-help" id="quick-contact-help">Use 09XXXXXXXXX or +639XXXXXXXXX.</small><small class="field-error" id="quick-contact-error" role="alert" hidden></small></div><div class="field field-wide" data-payout-fields data-prefix="quick"></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Save changes</button></div></form><div class="account-support" data-role="ADMIN,TREASURER,MEMBER"><div class="account-support-row"><span><strong>Support IPON</strong><small>Optional donations help maintain and improve the system.</small></span><button class="button button-secondary" data-donate-open type="button">Donate me</button></div><div class="account-support-row"><span><strong>Have an idea?</strong><small>Suggest an improvement for the system.</small></span><button class="button button-secondary" data-feature-request-open type="button">Request a feature</button></div><div class="account-support-row"><span><strong>Encounter a problem, error, or bug?</strong><small>Report an issue with screenshots for review.</small></span><button class="button button-secondary" data-bug-report-open type="button">Report a bug</button></div></div></section>
            <div class="account-side-stack"><section class="account-card account-security-card"><header class="account-section-heading"><div><h3>Sign-in security</h3><p>Keep your account secure.</p></div></header><form id="quick-email-form" class="account-inline-form"><div class="field"><label for="quick-email">Email address</label><input id="quick-email" name="email" type="email" autocomplete="email" required></div><button class="button button-secondary" type="submit">Update email</button></form><details class="account-password-disclosure"><summary><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><strong>Change password</strong><svg class="account-disclosure-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><form id="quick-password-form" class="form-grid"><div class="field field-wide"><label for="quick-current-password">Current or temporary password</label><div class="password-control"><input id="quick-current-password" name="current_password" type="password" maxlength="128" autocomplete="current-password" required><button class="password-toggle" type="button" aria-controls="quick-current-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div></div><div class="field"><label for="quick-password">New password</label><div class="password-control"><input id="quick-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" aria-controls="quick-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div><small class="field-help">${PASSWORD_RULE}</small></div><div class="field"><label for="quick-password-confirmation">Confirm password</label><div class="password-control"><input id="quick-password-confirmation" name="password_confirmation" type="password" minlength="8" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" aria-controls="quick-password-confirmation" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Change password</button></div></form></details></section>
            <section class="account-card account-preferences"><header class="account-section-heading"><div><h3>Appearance &amp; notifications</h3><p>Manage display theme and alert preferences.</p></div></header><label class="preference-row preference-theme-row" for="quick-theme-dark"><span><strong>Dark mode</strong><small>Switch between Warm Paper Light and Forest Dark theme.</small></span><input id="quick-theme-dark" type="checkbox" role="switch" data-theme-checkbox aria-label="Enable dark mode"></label><label class="preference-row"><span><strong>In-app notifications</strong><small>Reviews, account changes, and contribution updates.</small></span><input id="quick-notifications-enabled" type="checkbox" role="switch" aria-label="Enable in-app notifications"></label><div class="preference-row preference-device-row" data-device-notif-row hidden><span><strong>Phone &amp; drawer alerts</strong><small data-device-notif-status>Checking device permission…</small></span><button class="button button-secondary button-sm" type="button" data-device-notif-btn disabled>Checking…</button></div></section></div>
          </div>
        </div>
      </dialog>
      <dialog class="form-dialog avatar-crop-dialog" id="avatar-crop-dialog" aria-labelledby="avatar-crop-title">
        <div class="form-dialog-sheet avatar-crop-sheet">
          <header class="form-dialog-header">
            <div>
              <h2 id="avatar-crop-title">Crop display picture</h2>
              <p>Drag to reposition or adjust zoom to frame your profile picture.</p>
            </div>
            <button class="dialog-close" id="avatar-crop-close" type="button" aria-label="Close photo editor"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </header>
          <div class="avatar-crop-body">
            <div class="avatar-crop-viewport-wrap">
              <canvas class="avatar-crop-canvas" id="avatar-crop-canvas" width="280" height="280" aria-label="Photo crop preview"></canvas>
              <div class="avatar-crop-overlay" aria-hidden="true"></div>
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
  }

  const MAX_BUG_IMAGES = 5;
  const MAX_BUG_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_AVATAR_BYTES = 450 * 1024;
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

  function initPresence(profile) {
    const client = getClient();
    if (!client || !profile?.id) return;
    if (presenceChannel) return;

    onlineUserIds.add(String(profile.id));
    syncPresenceDots();

    try {
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel(PRESENCE_SYNC_CHANNEL);
        bc.addEventListener('message', (event) => {
          if (event.data?.ids && Array.isArray(event.data.ids)) {
            event.data.ids.forEach((id) => onlineUserIds.add(String(id)));
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
              syncPresenceDots();
            }
          } catch (_) { }
        }
      });
    } catch (_) { }

    try {
      presenceChannel = client.channel('ipon-active-presence', {
        config: {
          presence: {
            key: String(profile.id)
          }
        }
      });

      const handleSync = () => {
        try {
          const state = presenceChannel.presenceState();
          onlineUserIds.clear();
          onlineUserIds.add(String(profile.id));
          Object.keys(state || {}).forEach((key) => {
            if (key) onlineUserIds.add(String(key));
            const presences = state[key] || [];
            presences.forEach((entry) => {
              if (entry?.user_id) onlineUserIds.add(String(entry.user_id));
            });
          });
          syncPresenceDots();
          broadcastLocalPresence();
        } catch (_) { }
      };

      presenceChannel
        .on('presence', { event: 'sync' }, handleSync)
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
          if (key) onlineUserIds.add(String(key));
          (newPresences || []).forEach((p) => { if (p?.user_id) onlineUserIds.add(String(p.user_id)); });
          syncPresenceDots();
          broadcastLocalPresence();
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
          const state = presenceChannel.presenceState();
          if (!state[key] && key !== String(profile.id)) {
            onlineUserIds.delete(String(key));
          }
          (leftPresences || []).forEach((p) => {
            if (p?.user_id && p.user_id !== String(profile.id) && !state[p.user_id]) {
              onlineUserIds.delete(String(p.user_id));
            }
          });
          syncPresenceDots();
          broadcastLocalPresence();
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
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

      window.addEventListener('pagehide', () => {
        try {
          presenceChannel?.untrack();
          client.removeChannel(presenceChannel);
        } catch (_) { }
      }, { once: true });
    } catch (presenceErr) {
      console.warn('Realtime presence init:', presenceErr);
    }
  }

  function avatarMarkup(avatarUrl, name, className = '', userId = null) {
    const safeUrl = typeof avatarUrl === 'string' && avatarUrl.startsWith('data:image/') ? avatarUrl : '';
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

  function syncProfileAvatars(profile = currentProfile) {
    if (!profile) return;
    const safeUrl = typeof profile.avatar_url === 'string' && profile.avatar_url.startsWith('data:image/') ? profile.avatar_url : '';
    document.querySelectorAll('.sidebar-user-avatar').forEach((slot) => {
      const parentWrap = slot.closest('.avatar-presence-wrap');
      const dot = parentWrap ? parentWrap.querySelector('.presence-dot') : null;
      if (dot) {
        dot.dataset.presenceId = profile.id;
        dot.classList.add('is-online');
      }
      if (safeUrl) {
        slot.innerHTML = `<img src="${safeUrl}" alt="${escapeHtml(profile.full_name || 'Profile picture')}" data-avatar-img><svg viewBox="0 0 24 24" hidden><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>`;
        const img = slot.querySelector('img');
        img?.addEventListener('error', () => {
          img.hidden = true;
          const svg = img.nextElementSibling;
          if (svg) svg.removeAttribute('hidden');
        });
      } else {
        slot.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>';
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
      opt.dataset.badge = group.role || '';
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

  async function prepareImageDataUrl(file, { maxEdge = 1440, skipCompressBytes = 350 * 1024, maxBytes = MAX_BUG_IMAGE_BYTES, maxDataUrlLength = 585000 } = {}) {
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
      const passes = [[maxEdge, 0.84], [Math.min(maxEdge, 1000), 0.72], [820, 0.6], [660, 0.5]];
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
      throw new Error(`"${file.name}" is still too large after compression. Please use a clearer screenshot.`);
    }
    return { name: String(file.name || 'picture').slice(0, 120), type, dataUrl };
  }

  function prepareBugImage(file) {
    return prepareImageDataUrl(file, { maxEdge: 1440, skipCompressBytes: 350 * 1024, maxBytes: MAX_BUG_IMAGE_BYTES });
  }

  function prepareAvatarDataUrl(file) {
    return prepareImageDataUrl(file, { maxEdge: 256, skipCompressBytes: 60 * 1024, maxBytes: MAX_AVATAR_BYTES });
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
      const title = values.get('title').trim();
      const details = values.get('details').trim();
      setFeedbackMessage(featureMessage);
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
      const title = values.get('title').trim();
      const description = values.get('description').trim();
      setFeedbackMessage(bugMessage);
      const accepted = await confirmAction({
        title: 'Submit bug report?',
        message: `Send "${title}"${bugImages.length ? ` with ${bugImages.length} attached picture${bugImages.length === 1 ? '' : 's'}` : ''} to the Super Admin?`,
        acceptLabel: 'Submit report'
      });
      if (!accepted) return;
      setBusy(button, true, 'Submitting…');
      try {
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
      const { data, error } = await client.from('profiles').select('first_name,middle_name,last_name,full_name,email,contact_number,notifications_enabled,avatar_url,member_id,payout_channel,payout_account_number,payout_account_name,name_setup_required').eq('id', currentProfile.id).single();
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
      profileForm.elements.contact_number.value = data.contact_number || '';
      setPayoutFields(profileForm, payoutSource);
      emailForm.elements.email.value = data.email || '';
      document.getElementById('quick-notifications-enabled').checked = data.notifications_enabled !== false;
      document.getElementById('quick-account-name').textContent = data.full_name;
      document.getElementById('quick-account-role').textContent = currentProfile.role === 'SUPER_ADMIN' ? 'Owner' : (data.email || 'My account');
      syncProfileAvatars({ ...currentProfile, ...data });
      const support = dialog.querySelector('.account-support');
      if (support) support.hidden = currentProfile.role === 'SUPER_ADMIN';
    } finally {
      dialog.removeAttribute('aria-busy');
    }
  }

  async function openAccountDialog() {
    const dialog = document.getElementById('account-dialog');
    if (!dialog || !currentProfile) return;
    dialog.showModal();
    try { await Promise.all([loadAccountDialog(), quickMfaController?.load()]); }
    catch (error) { toast(friendlyError(error), 'error'); }
  }

  function openAvatarCropper(file, { title = 'Crop display picture', onSave } = {}) {
    return new Promise((resolve) => {
      const dialog = document.getElementById('avatar-crop-dialog');
      const canvas = document.getElementById('avatar-crop-canvas');
      const titleEl = document.getElementById('avatar-crop-title');
      const zoomInput = document.getElementById('avatar-crop-zoom');
      const previewThumb = document.getElementById('avatar-crop-preview-thumb');
      const rotateBtn = document.getElementById('avatar-crop-rotate');
      const saveBtn = document.getElementById('avatar-crop-save');
      const cancelBtn = document.getElementById('avatar-crop-cancel');
      const closeBtn = document.getElementById('avatar-crop-close');
      const viewport = dialog?.querySelector('.avatar-crop-viewport-wrap');

      if (!dialog || !canvas || !viewport) return resolve(null);
      if (titleEl) titleEl.textContent = title;

      if (file instanceof File && !file.type.startsWith('image/') && !PICTURE_FILE_RE.test(file.name || '')) {
        toast('Please choose a valid picture file.', 'error');
        return resolve(null);
      }

      const CROP_X = 15;
      const CROP_Y = 15;
      const CROP_SIZE = 250;
      const CENTER = 140;

      let thumbCanvas = previewThumb?.querySelector('canvas');
      if (!thumbCanvas && previewThumb) {
        previewThumb.innerHTML = '<canvas width="44" height="44" style="display:block;width:44px;height:44px;border-radius:50%;"></canvas>';
        thumbCanvas = previewThumb.querySelector('canvas');
      }
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
        minScale = Math.max(CROP_SIZE / eff.w, CROP_SIZE / eff.h);
        scale = minScale * zoom;
        imgW = Math.round(eff.w * scale);
        imgH = Math.round(eff.h * scale);
      }

      function clampOffsets() {
        const minX = (CROP_X + CROP_SIZE) - imgW;
        const maxX = CROP_X;
        const minY = (CROP_Y + CROP_SIZE) - imgH;
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
          thumbCtx.clearRect(0, 0, 44, 44);
          thumbCtx.drawImage(canvas, CROP_X, CROP_Y, CROP_SIZE, CROP_SIZE, 0, 0, 44, 44);
        }
      }

      function applyZoom(newZoom) {
        newZoom = Math.min(3, Math.max(1, newZoom));
        const px = CENTER - offsetX;
        const py = CENTER - offsetY;
        const prevScale = scale;
        zoom = newZoom;
        updateScaleAndDimensions();
        const ratio = scale / prevScale;
        offsetX = CENTER - px * ratio;
        offsetY = CENTER - py * ratio;
        clampOffsets();
        if (zoomInput) zoomInput.value = String(zoom);
        draw();
      }

      const onRotate = () => {
        rotation = (rotation + 90) % 360;
        updateScaleAndDimensions();
        offsetX = CENTER - imgW / 2;
        offsetY = CENTER - imgH / 2;
        clampOffsets();
        draw();
      };

      const onPointerDown = (e) => {
        if (e.button !== 0) return;
        isDragging = true;
        try { viewport.setPointerCapture(e.pointerId); } catch { }
        startPointerX = e.clientX;
        startPointerY = e.clientY;
        startOffsetX = offsetX;
        startOffsetY = offsetY;
      };

      const onPointerMove = (e) => {
        if (!isDragging) return;
        offsetX = startOffsetX + (e.clientX - startPointerX);
        offsetY = startOffsetY + (e.clientY - startPointerY);
        clampOffsets();
        draw();
      };

      const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
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
      }

      function onCancel() {
        cleanup();
        dialog.close();
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
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = 256;
        exportCanvas.height = 256;
        const exportCtx = exportCanvas.getContext('2d');
        if (!exportCtx) return onCancel();
        exportCtx.imageSmoothingEnabled = true;
        exportCtx.imageSmoothingQuality = 'high';
        exportCtx.drawImage(canvas, CROP_X, CROP_Y, CROP_SIZE, CROP_SIZE, 0, 0, 256, 256);
        const croppedDataUrl = exportCanvas.toDataURL('image/jpeg', 0.88);

        setBusy(saveBtn, true, 'Saving…');
        try {
          if (typeof onSave === 'function') {
            await onSave(croppedDataUrl);
          } else {
            await rpc('update_own_avatar', { p_avatar_url: croppedDataUrl });
            currentProfile.avatar_url = croppedDataUrl;
            syncProfileAvatars(currentProfile);
            window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
            toast('Profile picture updated.');
          }
          cleanup();
          dialog.close();
          resolve(croppedDataUrl);
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
        offsetX = CENTER - imgW / 2;
        offsetY = CENTER - imgH / 2;
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

  function bindAccountDialog() {
    const profileForm = document.getElementById('quick-profile-form');
    if (!profileForm || profileForm.dataset.bound) return;
    profileForm.dataset.bound = 'true';
    syncProfileNameMode(profileForm, currentProfile?.role === 'SUPER_ADMIN');
    const emailForm = document.getElementById('quick-email-form');
    const passwordForm = document.getElementById('quick-password-form');
    const notificationToggle = document.getElementById('quick-notifications-enabled');
    const avatarInput = document.getElementById('quick-avatar-input');
    const avatarTrigger = document.querySelector('.account-avatar-trigger');
    const avatarRemove = document.getElementById('quick-avatar-remove');
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
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!validateNameFields(profileForm)) return;
      if (!validatePhoneInput(profileForm.elements.contact_number)) return profileForm.elements.contact_number.focus();
      if (!validatePayoutFields(profileForm)) return;
      const button = event.submitter;
      const values = new FormData(profileForm);
      const payoutPayload = readPayoutPayload(profileForm);
      setBusy(button, true);
      try {
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
      } catch (error) { toast(friendlyError(error), 'error'); }
      finally { setBusy(button, false); }
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
  }

  function mfaSettingsMarkup() {
    return '<div class="mfa-settings" data-mfa-settings><div class="mfa-status"><span><strong>Authenticator app</strong><small>Use a rotating code when you sign in.</small></span><b data-mfa-status>Checking…</b></div><div class="mfa-factor-list" data-mfa-list></div><button class="button button-secondary" type="button" data-mfa-enroll>Set up authenticator</button><dialog class="mfa-enrollment-dialog" data-mfa-enrollment aria-label="Set up authenticator"><div class="mfa-enrollment"><h3>Set up authenticator</h3><p>Scan this QR code with Google Authenticator, Microsoft Authenticator, Authy, or another TOTP app.</p><img data-mfa-qr alt="Authenticator setup QR code"><p class="mfa-secret-label">Manual setup key</p><code data-mfa-secret></code><form class="form-grid" data-mfa-verify-form><div class="field field-wide"><label>6-digit authenticator code<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></label></div><p class="mfa-message field-wide" data-mfa-enrollment-message role="status" aria-live="polite"></p><div class="form-actions field-wide"><button class="button button-secondary" type="button" data-mfa-cancel>Cancel</button><button class="button button-primary" type="submit">Enable MFA</button></div></form></div></dialog><p class="mfa-message" data-mfa-message role="status" aria-live="polite"></p></div>';
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

  function getLocalNotificationsPlugin() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
  }

  function getBackgroundNotificationsPlugin() {
    return window.Capacitor?.Plugins?.BackgroundNotifications || null;
  }

  function hasNativeNotificationBridge() {
    return Boolean(getLocalNotificationsPlugin() || getBackgroundNotificationsPlugin());
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
    if (isInstalledAppUser() || !('serviceWorker' in navigator)) return null;
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

  async function syncDevicePermissionUI() {
    const rows = document.querySelectorAll('[data-device-notif-row]');
    const bar = document.getElementById('notification-permission-bar');
    if (!isMobileDeviceNotifClient()) {
      rows.forEach((row) => { row.hidden = true; });
      if (bar) {
        bar.hidden = true;
        bar.textContent = '';
      }
      return;
    }
    const status = await getDeviceNotificationPermission();
    const isApp = isInstalledAppUser();
    const needsApkUpdate = isApp && !hasNativeNotificationBridge();
    const bgPlugin = getBackgroundNotificationsPlugin();
    let nativeBgStatus = null;
    if (isApp && bgPlugin?.getBackgroundStatus) {
      nativeBgStatus = await bgPlugin.getBackgroundStatus().catch(() => null);
    }
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
        label.textContent = 'Update to the latest myIPON APK to enable closed-app background alerts.';
        button.textContent = 'Update APK';
        button.disabled = false;
        button.hidden = false;
      } else if (status === 'granted') {
        if (isApp && nativeBgStatus && nativeBgStatus.batteryOptimizationIgnored === false) {
          label.textContent = 'Notification permission: On — turn off battery restriction so alerts arrive when myIPON is closed.';
          button.textContent = 'Allow always-on';
          button.dataset.actionMode = 'battery';
          button.disabled = false;
          button.hidden = false;
        } else if (isApp) {
          label.textContent = 'Notification permission: On — instant background alerts stay active even when myIPON is closed.';
          button.textContent = 'On';
          delete button.dataset.actionMode;
          button.disabled = true;
          button.hidden = false;
        } else if (pushState.subscribed) {
          label.textContent = 'Notification permission: On — background push active even when this tab or browser is closed.';
          button.textContent = 'On';
          delete button.dataset.actionMode;
          button.disabled = true;
          button.hidden = false;
        } else if (pushState.supported) {
          label.textContent = 'Notification permission: On — tap Finish setup to sync background push for closed tabs.';
          button.textContent = 'Finish setup';
          button.dataset.actionMode = 'sync-push';
          button.disabled = false;
          button.hidden = false;
        } else {
          label.textContent = 'Notification permission: On — active while open. Open in Chrome, Edge, or installed PWA for closed-app push.';
          button.textContent = 'On';
          delete button.dataset.actionMode;
          button.disabled = true;
          button.hidden = false;
        }
        if ((isApp || pushState.subscribed) && currentProfile?.notifications_enabled !== false) {
          const testBtn = document.createElement('button');
          testBtn.type = 'button';
          testBtn.className = 'button button-secondary button-sm';
          testBtn.textContent = 'Test alert';
          testBtn.setAttribute('data-device-test-btn', '');
          testBtn.setAttribute('data-device-extra-btn', '');
          actionsWrap.appendChild(testBtn);
        }
      } else if (status === 'denied') {
        const canOpenNativeSettings = isApp && Boolean(bgPlugin?.openNotificationSettings);
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
          ? 'Device permission: Off — tap Turn on so alerts arrive on your phone even when myIPON is closed.'
          : 'Browser site permission: Off — click Turn on and choose Allow (PC settings alone keep this site Off).';
        button.textContent = 'Turn on';
        delete button.dataset.actionMode;
        button.disabled = false;
        button.hidden = false;
      } else if (status === 'insecure') {
        label.textContent = 'Site notifications require HTTPS or localhost (unavailable on plain HTTP LAN URLs).';
        button.hidden = true;
      } else if (isIosBrowser) {
        label.textContent = 'On iPhone/iPad, tap Share -> Add to Home Screen, then open myIPON to enable background alerts.';
        button.hidden = true;
      } else {
        label.textContent = 'Device notification drawer alerts are unavailable on this browser.';
        button.hidden = true;
      }
    });

    if (bar) {
      if (needsApkUpdate) {
        bar.hidden = false;
        bar.innerHTML = '<span>Update your installed APK to enable closed-app background alerts.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn>Update APK</button>';
      } else if (status === 'default') {
        bar.hidden = false;
        bar.innerHTML = isApp
          ? '<span>Device notifications are off. Tap Turn on so alerts arrive even when myIPON is closed.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn>Turn on</button>'
          : '<span>Browser notifications for this site are off. Click Turn on, then allow notifications for this site.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn>Turn on</button>';
      } else if (status === 'granted' && isApp && nativeBgStatus && nativeBgStatus.batteryOptimizationIgnored === false) {
        bar.hidden = false;
        bar.innerHTML = '<span>Notification permission is On — allow unrestricted battery so alerts stay active after closing myIPON.</span><button class="button button-sm button-primary" type="button" data-device-notif-btn data-action-mode="battery">Allow always-on</button>';
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
      await syncBackgroundNotificationPolling(currentProfile).catch(() => { });
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

  function bindDeviceNotificationControls() {
    if (!document.body.dataset.boundDeviceNotifDelegation) {
      document.body.dataset.boundDeviceNotifDelegation = 'true';
      const resyncOnReturn = async () => {
        if (document.visibilityState === 'hidden') return;
        const wasNotGranted = Boolean(document.querySelector(
          '[data-action-mode="unblock-help"],[data-action-mode="open-settings"],[data-device-notif-row] [data-device-notif-btn]:not([data-action-mode]):not([disabled])'
        ));
        const status = await getDeviceNotificationPermission().catch(() => 'unsupported');
        if (wasNotGranted && status === 'granted') {
          await requestDeviceNotificationPermission({ userInitiated: false }).catch(() => { });
          document.getElementById('notification-unblock-dialog')?.close?.();
          toast('Background notification alerts enabled.');
        } else {
          await syncDevicePermissionUI().catch(() => { });
        }
      };
      document.addEventListener('visibilitychange', resyncOnReturn);
      window.addEventListener('focus', resyncOnReturn);
      document.body.addEventListener('click', async (event) => {
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
              toast(result?.native_ping_sent
                ? 'Test alert sent to your Android notification drawer.'
                : 'Test alert requested. Check your notification drawer.');
            } else if (result?.web_sent > 0) {
              toast('Background push test sent. Alerts now work even when myIPON is closed.');
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
        if (isInstalledAppUser() && !hasNativeNotificationBridge()) {
          window.open(APK_LATEST_DOWNLOAD_URL, '_blank', 'noopener');
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
          if (ok) toast('Background push notifications enabled for closed tabs.');
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
      const target = safeNotificationTarget(event?.notification?.extra?.link);
      if (!target) return;
      if (/^https:\/\//i.test(target)) {
        window.open(target, '_blank', 'noopener');
      } else {
        window.location.href = target;
      }
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

  async function syncBackgroundNotificationPolling(profile, rows = []) {
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (!bgPlugin?.configure || !configured) return;
    if (!profile || profile.notifications_enabled === false) {
      await bgPlugin.clear?.().catch?.(() => { });
      return;
    }
    const now = Date.now();
    if (now - lastBgPollSyncAt < 60_000) return;
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
      await syncBackgroundNotificationPolling(currentProfile).catch(() => { });
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
    const target = safeNotificationTarget(item.link) || 'dashboard.html';
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
      for (const triggerAt of [threeDaysBefore, dueDay]) {
        if (triggerAt.getTime() > nowMs + 60000 && nextId < 900040) {
          notifications.push({
            id: nextId++,
            title: 'Contribution deadline approaching',
            body: `Your ${row.period_label || 'savings'} contribution for ${row.group_name || 'your group'} is due on ${row.due_date}${amountCopy}.`,
            channelId: 'myipon_alerts',
            schedule: { at: triggerAt, allowWhileIdle: true },
            extra: { link: 'user.html' }
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
      const perm = await getDeviceNotificationPermission();
      if (perm === 'default' && !localStorage.getItem(promptKey)) {
        localStorage.setItem(promptKey, '1');
        requestDeviceNotificationPermission({ userInitiated: true }).catch(() => { });
      }
    }

    const lastSeenKey = `myipon_last_notif_seen_${profile.id}`;
    const storedLastSeen = localStorage.getItem(lastSeenKey);
    let lastSeenMs = storedLastSeen ? Number(storedLastSeen) : null;

    const load = async (realtimePayload) => {
      const { data, error } = await client.from('notifications').select('id,group_id,type,title,message,link,dedupe_key,read_at,created_at').order('created_at', { ascending: false }).limit(40);
      if (error) { showInlineError(list, error, load); return; }
      const rows = data || [];
      let allRows = rows;

      if (realtimePayload?.eventType !== 'DELETE' && realtimePayload?.new?.id) {
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

      const safeNotificationTarget = (link) => {
        const raw = String(link || '').trim();
        if (!raw) return '';
        if (/^(?:[a-zA-Z0-9_-]+\.html(?:\?[a-zA-Z0-9_=&:.-]+)?(?:#[a-zA-Z0-9_-]+)?|#[a-zA-Z0-9_-]+)$/.test(raw)) return raw;
        try {
          const url = new URL(raw, location.href);
          if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
        } catch { }
        return '';
      };

      if (isApp) {
        const latestVersion = localStorage.getItem('myipon_latest_remote_version') || window.MYIPON_APP_VERSION?.version || '1.0.20';
        const installedNativeBuild = getInstalledNativeBuild();
        const remoteNativeBuild = Number(localStorage.getItem('myipon_latest_native_build') || window.MYIPON_APP_VERSION?.nativeBuild || window.MYIPON_APP_VERSION?.build || 20);
        const hasPendingUpdate = remoteNativeBuild > installedNativeBuild;

        if (hasPendingUpdate) {
          const isReleaseRead = Boolean(localStorage.getItem(`myipon_read_release_notice_${remoteNativeBuild}`));
          const releaseNotice = {
            id: 'system-app-release-notice',
            type: 'RELEASE',
            title: `Update available: Version ${latestVersion}`,
            message: `A new version of myIPON (${latestVersion}) is ready with instant live updates. Tap Download APK below to install.`,
            link: 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest',
            read_at: isReleaseRead ? 'read' : null,
            created_at: new Date().toISOString()
          };
          allRows = [releaseNotice, ...rows];
        }
      }

      const unread = allRows.filter((item) => !item.read_at).length;
      document.querySelectorAll('[data-notification-count]').forEach((badge) => { badge.textContent = unread; badge.hidden = unread === 0; });
      document.getElementById('mark-all-notifications').hidden = unread === 0;
      list.innerHTML = allRows.length ? allRows.map((item) => {
        const isInvite = item.type === 'GROUP_INVITE' && !item.read_at;
        const isReleaseNotif = item.type === 'RELEASE' || (item.title && /release|version|app update/i.test(item.title));
        const safeTarget = isInvite ? '' : safeNotificationTarget(item.link);
        return `<article class="notification-item${item.read_at ? '' : ' is-unread'}" data-notification-id="${item.id}"${safeTarget ? ` data-nav-target="${escapeHtml(safeTarget)}"` : ''}>
          <span class="notification-item-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="${item.type === 'GROUP_INVITE' ? 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' : 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4'}"/></svg>
          </span>
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
            ${isReleaseNotif ? `
              <div class="notification-download-row" style="margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap;">
                <a class="button button-sm button-primary" href="https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk" download="myIPON.apk" target="_blank" rel="noopener" style="padding: 3px 8px; font-size: 11px; text-decoration: none;">Download APK</a>
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
      if (event.target.closest('.notification-download-row a')) return;
      const item = event.target.closest('[data-notification-id]');
      if (!item) return;
      const target = safeNotificationTarget(item.dataset.navTarget);
      if (target) event.preventDefault();
      if (item.classList.contains('is-unread')) {
        if (item.dataset.notificationId === 'system-app-release-notice') {
          const remoteBuild = localStorage.getItem('myipon_latest_native_build') || String(window.MYIPON_APP_VERSION?.nativeBuild || window.MYIPON_APP_VERSION?.build || 20);
          localStorage.setItem(`myipon_read_release_notice_${remoteBuild}`, 'true');
          item.classList.remove('is-unread');
          if (!target) await load();
        } else {
          try {
            await rpc('mark_notification_read', { p_notification_id: Number(item.dataset.notificationId) });
            item.classList.remove('is-unread');
            if (!target) await load();
          } catch (error) {
            toast(friendlyError(error), 'error');
          }
        }
      }
      if (target) {
        document.getElementById('notifications-dialog')?.close();
        if (/^https?:\/\//i.test(target)) window.open(target, '_blank', 'noopener');
        else location.href = target;
      }
    };
    document.getElementById('mark-all-notifications').onclick = async () => {
      const remoteBuild = localStorage.getItem('myipon_latest_native_build') || String(window.MYIPON_APP_VERSION?.nativeBuild || window.MYIPON_APP_VERSION?.build || 20);
      localStorage.setItem(`myipon_read_release_notice_${remoteBuild}`, 'true');
      try { await rpc('mark_all_notifications_read'); await load(); } catch (error) { toast(friendlyError(error), 'error'); }
    };
    window.addEventListener('myipon_update_available', () => { load(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        syncDevicePermissionUI().catch(() => { });
        load().catch(() => { });
      }
    });
    window.addEventListener('online', () => { load().catch(() => { }); });

    await load();
    client.channel(`notifications:${profile.id}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}` }, (payload) => load(payload)).subscribe();

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

      if (document.body.dataset.page !== 'mfa') {
        const needsMfa = await runWithStartupRetry(() => requiresMfaChallenge(), { attempts: 2, timeoutMs: 8000 }).catch((mfaErr) => {
          if (isTransientConnectionError(mfaErr) || isHarmlessLockOrAbortError(mfaErr)) return false;
          throw mfaErr;
        });
        if (needsMfa) {
          window.location.replace('mfa.html');
          return { configured: true, profile: null, session, redirecting: true };
        }
      }

      const fetchProfile = () => client.from('profiles')
        .select('id,full_name,first_name,middle_name,last_name,contact_number,role,status,member_id,group_id,avatar_url,name_setup_required')
        .eq('id', session.user.id)
        .single();
      let { data: profile, error } = await runWithStartupRetry(fetchProfile);
      if (error && isJwtExpiredError(error)) {
        const refreshed = await withTimeout(client.auth.refreshSession(), 8000).catch(() => null);
        if (refreshed?.error && options.requireAuth !== false && !isTransientConnectionError(refreshed.error)) {
          window.location.replace('login.html');
          return { configured: true, profile: null, session: null, redirecting: true };
        }
        ({ data: profile, error } = await runWithStartupRetry(fetchProfile));
      }
      if (error) throw error;
      if (!profile.group_id && profile.role !== 'SUPER_ADMIN' && profile.status === 'ACTIVE') {
        try {
          const { data: myGroups } = await withTimeout(client.rpc('get_my_groups'));
          if (myGroups && myGroups.length > 0) {
            const firstGroup = myGroups[0];
            await withTimeout(client.rpc('switch_active_group', { p_group_id: firstGroup.group_id }));
            profile.group_id = firstGroup.group_id;
            profile.role = firstGroup.role || profile.role;
            profile.member_id = firstGroup.member_id || profile.member_id;
          }
        } catch (_) { }
      }
      currentProfile = profile;
      try {
        sessionStorage.setItem(ACTIVE_ROLE_KEY, profile.role);
        localStorage.setItem(ACTIVE_ROLE_KEY, profile.role);
      } catch { }
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
      const sidebarUser = document.getElementById('sidebar-user');
      if (sidebarUser) sidebarUser.innerHTML = `<strong>${escapeHtml(profile.full_name)}</strong><small>${escapeHtml(profile.role === 'SUPER_ADMIN' ? 'Owner' : 'My account')}</small>`;
      syncProfileAvatars(profile);
      document.querySelectorAll('[data-role]').forEach((element) => {
        const roles = element.dataset.role.split(',');
        element.hidden = !roles.includes(profile.role);
      });
      if (options.requireAuth !== false) watchCrossTabAuth(client, profile.id);
      initNotifications(profile).catch(() => { });
      initPresence(profile);
      appInitialized = true;
      dismissStartupFailure();
      if (options.requireAuth === false) setLoading(false);
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

  async function signOut() {
    const accepted = await confirmAction({ title: 'Sign out?', message: 'You will need to sign in again to access the system.', acceptLabel: 'Sign out' });
    if (!accepted) return;
    try {
      const client = getClient();
      if (client) {
        await withTimeout(removeWebPushSubscription()).catch(() => { });
        await withTimeout(rpc('revoke_notification_feed_token')).catch(() => { });
        await getBackgroundNotificationsPlugin()?.clear?.().catch?.(() => { });
        await withTimeout(client.auth.signOut({ scope: 'local' }));
      }
    } finally {
      clearStoredAuthTokens();
      broadcastAuthEvent('SIGNED_OUT');
      window.location.replace('login.html');
    }
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
    const message = error?.message || 'Something went wrong. Please try again.';
    if (/mfa_verification_failed|invalid.*totp|challenge.*expired/i.test(`${error?.code || ''} ${message}`)) return 'That authenticator code is invalid or expired. Enter the latest code and try again.';
    if (/rate limit|too many requests|over_email_send_rate_limit/i.test(`${error?.code || ''} ${message}`)) return 'Too many attempts. Wait a moment, then try again.';
    if (/duplicate key|unique constraint/i.test(message)) return 'That reference was already used.';
    if (/cannot remove or disable your own administrator|another active administrator/i.test(message)) return 'Assign another active administrator before changing administrator access.';
    if (/row-level security|permission denied|not allowed to|only (?:a |an )?.*administrator/i.test(message)) return 'You do not have permission for that action.';
    if (/BILLING_DISABLED|requires billing to be enabled|billing is disabled/i.test(message)) return 'Google Cloud billing is disabled for the current Google Cloud project key. Enable Cloud billing on that project, or click Configure API key to save a free-tier key from Google AI Studio.';
    if (/ACCESS_TOKEN_TYPE_UNSUPPORTED|API key not valid|API_KEY_INVALID|API key expired/i.test(message)) return 'The server Gemini API key was rejected or revoked by Google. Click Configure API key to test and save a fresh Google AI Studio key.';
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
      button.disabled = false;
    }
  }

  function confirmAction({ title, message, acceptLabel = 'Confirm' }) {
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-accept').textContent = acceptLabel;
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
            <strong>${escapeHtml(personName)}</strong>
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
      ${entry.receiptUrl && String(entry.receiptUrl).startsWith('data:image/') ? `
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
        }).catch(() => {});
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

  async function rpc(name, params) {
    const client = getClient();
    if (!client) throw new Error('Supabase is not connected.');
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
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

  function ensureAnnouncementDialogs() {
    if (document.getElementById('announcement-viewer-dialog')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <dialog class="form-dialog announcement-viewer-dialog" id="announcement-viewer-dialog" aria-labelledby="announcement-viewer-title">
        <div class="form-dialog-sheet">
          <header class="announcement-viewer-topbar">
            <div class="announcement-category-indicator">
              <span class="announcement-category-bar" aria-hidden="true"></span>
              <span class="announcement-category-label">Announcement</span>
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
            <button class="button button-danger" id="announcement-viewer-delete" type="button" hidden>Delete announcement</button>
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
    const avatarHtml = avatarMarkup(avatarUrl, name, `announcement-avatar${isOwner ? ' is-owner' : ''}`, item.author_id);
    const roleBadge = isOwner
      ? '<span class="announcement-role-badge is-owner">Owner</span>'
      : '<span class="announcement-role-badge is-admin">Admin</span>';
    const authorHtml = `<span class="announcement-author${isOwner ? ' is-owner' : ''}">${escapeHtml(name)}</span>`;
    const dateText = dateLabel(item.created_at, { dateStyle: 'medium', timeStyle: 'short' });
    return `${avatarHtml}${roleBadge}${authorHtml}<span class="announcement-meta-dot" aria-hidden="true">&middot;</span><time datetime="${escapeHtml(item.created_at)}">${escapeHtml(dateText)}</time>`;
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

      if (isOutro(line)) {
        flushSection();
        flushRequestedBox();
        const restLines = lines.slice(i).map((l) => l.trim()).filter(Boolean);
        blocks.push({ type: 'outro', lines: restLines });
        break;
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

  function bindAnnouncements({ listElement, addButton, emptyTitle = 'No announcements yet', emptyNote = 'Stay tuned for updates' } = {}) {
    if (!listElement) return null;
    ensureAnnouncementDialogs();
    const viewerDialog = document.getElementById('announcement-viewer-dialog');
    const viewerReleaseBanner = document.getElementById('announcement-viewer-release-banner');
    const viewerMeta = document.getElementById('announcement-viewer-meta');
    const viewerTitle = document.getElementById('announcement-viewer-title');
    const viewerDescription = document.getElementById('announcement-viewer-description');
    const viewerMedia = document.getElementById('announcement-viewer-media');
    const viewerDelete = document.getElementById('announcement-viewer-delete');
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
          <button class="announcement-react-btn${myReaction ? ' is-active' : ''}" type="button" data-react-trigger="${escapeHtml(announcementId)}" aria-label="${escapeHtml(triggerLabel)}" aria-haspopup="dialog" aria-expanded="${isPickerOpen ? 'true' : 'false'}" title="${escapeHtml(triggerLabel)}">
            ${myReaction
          ? `<span class="my-reaction-emoji" aria-hidden="true">${myReaction}</span><span class="react-btn-label">${escapeHtml(REACTION_LABELS[myReaction] || myReaction)}</span>`
          : `<svg class="react-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm-3.5-9a1.5 1.5 0 1 0-1.5-1.5A1.5 1.5 0 0 0 8.5 11zm7 0a1.5 1.5 0 1 0-1.5-1.5A1.5 1.5 0 0 0 15.5 11zm-7 3.5a4.5 4.5 0 0 0 7 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span class="react-btn-label">React</span>`}
          </button>
          ${isPickerOpen ? `
            <div class="announcement-reaction-picker" role="menu" aria-label="Choose reaction">
              ${ANNOUNCEMENT_REACTIONS.map((emoji) => `
                <button class="reaction-choice-btn${emoji === myReaction ? ' is-selected' : ''}" type="button" data-react-choice="${emoji}" data-announcement-id="${escapeHtml(announcementId)}" aria-label="${escapeHtml(REACTION_LABELS[emoji] || emoji)}" title="${escapeHtml(REACTION_LABELS[emoji] || emoji)}">
                  <span class="reaction-emoji-symbol" aria-hidden="true">${emoji}</span>
                </button>`).join('')}
            </div>` : ''}
        </div>`;

      return `
        <div class="announcement-reactions-bar">
          ${pillHtml}
          ${triggerHtml}
        </div>`;
    };

    const renderReactionsModalContent = () => {
      if (!reactionsTabs || !reactionsList) return;
      const total = modalReactionsData.length;
      if (reactionsTitle) {
        reactionsTitle.textContent = total ? `Reactions (${total})` : 'Reactions';
      }
      const counts = {};
      modalReactionsData.forEach((entry) => {
        counts[entry.reaction] = (counts[entry.reaction] || 0) + 1;
      });

      const availableEmojis = ANNOUNCEMENT_REACTIONS.filter((emoji) => counts[emoji] > 0);
      if (activeReactionTab !== 'all' && !counts[activeReactionTab]) {
        activeReactionTab = 'all';
      }

      const tabs = [
        { id: 'all', label: `All ${total}` },
        ...availableEmojis.map((emoji) => ({ id: emoji, label: `${emoji} ${counts[emoji]}` }))
      ];

      reactionsTabs.innerHTML = tabs.map((tab) => `
        <button class="reaction-tab-btn${tab.id === activeReactionTab ? ' is-active' : ''}" type="button" data-reaction-tab="${escapeHtml(tab.id)}">
          ${escapeHtml(tab.label)}
        </button>`).join('');

      const filtered = activeReactionTab === 'all'
        ? modalReactionsData
        : modalReactionsData.filter((entry) => entry.reaction === activeReactionTab);

      if (!filtered.length) {
        reactionsList.innerHTML = '<p class="empty-state">No reactions yet.</p>';
        return;
      }

      reactionsList.innerHTML = filtered.map((entry) => {
        const isOwner = entry.role === 'SUPER_ADMIN';
        const name = entry.full_name || 'Member';
        const avatarHtml = avatarMarkup(entry.avatar_url, name, 'reaction-user-avatar');

        return `
          <div class="reaction-user-item">
            <div class="reaction-user-avatar-wrap">
              ${avatarHtml}
              <span class="reaction-user-emoji-badge" aria-label="${escapeHtml(REACTION_LABELS[entry.reaction] || entry.reaction)}">${entry.reaction}</span>
            </div>
            <div class="reaction-user-info">
              <strong class="reaction-user-name">${escapeHtml(name)}</strong>
              ${isOwner ? '<span class="reaction-user-role-badge is-owner">Owner</span>' : ''}
            </div>
          </div>`;
      }).join('');
      bindAvatarFallbacks(reactionsList);
    };

    const openReactionsModal = async (announcementId) => {
      if (!reactionsDialog) return;
      currentModalAnnouncementId = announcementId;
      activeReactionTab = 'all';
      if (reactionsTabs) reactionsTabs.replaceChildren();
      if (reactionsList) reactionsList.innerHTML = '<p class="empty-state">Loading reactions…</p>';
      reactionsDialog.showModal();

      try {
        const result = await rpc('get_announcement_reactions', { p_announcement_id: announcementId });
        if (currentModalAnnouncementId !== announcementId || !reactionsDialog.open) return;
        modalReactionsData = Array.isArray(result) ? result : [];
        renderReactionsModalContent();
      } catch (error) {
        if (reactionsList) reactionsList.innerHTML = `<p class="empty-state">${escapeHtml(friendlyError(error))}</p>`;
      }
    };

    const handleReactionToggle = async (announcementId, chosenEmoji) => {
      if (!currentProfile) return;
      activePickerAnnouncementId = null;
      const existingIdx = reactions.findIndex(
        (entry) => entry.announcement_id === announcementId && entry.user_id === currentProfile.id
      );
      const prevEmoji = existingIdx >= 0 ? reactions[existingIdx].reaction : null;

      if (prevEmoji === chosenEmoji) {
        reactions.splice(existingIdx, 1);
      } else if (prevEmoji) {
        reactions[existingIdx].reaction = chosenEmoji;
      } else {
        reactions.push({ announcement_id: announcementId, user_id: currentProfile.id, reaction: chosenEmoji });
      }

      renderList();
      if (viewerDialog?.open && openItemId === announcementId) {
        if (viewerReactions) viewerReactions.innerHTML = renderReactionsBarHtml(announcementId);
      }
      if (reactionsDialog?.open && currentModalAnnouncementId === announcementId) {
        openReactionsModal(announcementId);
      }

      try {
        await rpc('toggle_announcement_reaction', { p_announcement_id: announcementId, p_reaction: chosenEmoji });
      } catch (error) {
        if (prevEmoji === chosenEmoji) {
          reactions.push({ announcement_id: announcementId, user_id: currentProfile.id, reaction: prevEmoji });
        } else if (prevEmoji) {
          reactions[existingIdx].reaction = prevEmoji;
        } else {
          const idx = reactions.findIndex((entry) => entry.announcement_id === announcementId && entry.user_id === currentProfile.id);
          if (idx >= 0) reactions.splice(idx, 1);
        }
        renderList();
        if (viewerDialog?.open && openItemId === announcementId) {
          if (viewerReactions) viewerReactions.innerHTML = renderReactionsBarHtml(announcementId);
        }
        toast(friendlyError(error), 'error');
      }
    };

    const clearQueuedMedia = () => {
      queuedMedia.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
      queuedMedia = [];
      if (mediaInput) mediaInput.value = '';
      renderQueuedMedia();
    };

    const renderQueuedMedia = () => {
      if (mediaHelp) {
        mediaHelp.textContent = queuedMedia.length
          ? `${queuedMedia.length} file${queuedMedia.length === 1 ? '' : 's'} ready to upload (pictures or videos up to 50 MB each).`
          : 'No files selected. Any picture or video format up to 50 MB each.';
      }
      if (!mediaPreviews) return;
      if (!queuedMedia.length) {
        mediaPreviews.hidden = true;
        mediaPreviews.replaceChildren();
        return;
      }
      mediaPreviews.hidden = false;
      mediaPreviews.innerHTML = queuedMedia.map((entry, index) => `
        <figure class="bug-image-card announcement-preview-card">
          ${entry.kind === 'video'
          ? `<video src="${escapeHtml(entry.previewUrl)}" muted playsinline preload="metadata"></video>`
          : `<img src="${escapeHtml(entry.previewUrl)}" alt="${escapeHtml(entry.file.name)}">`}
          <button class="bug-image-remove" type="button" data-remove-announcement-media="${index}" aria-label="Remove ${escapeHtml(entry.file.name)}">&times;</button>
        </figure>`).join('');
    };

    const renderList = () => {
      if (!items.length) {
        listElement.innerHTML = `
          <div class="announcement-empty-state">
            <span class="announcement-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.6 5.4A1 1 0 0 0 11 19v-5l8.4 3.2A1 1 0 0 0 21 16.3V7.7a1 1 0 0 0-1.6-.9L11 10H4a1 1 0 0 0-1 1Z"/></svg>
            </span>
            <b>${escapeHtml(emptyTitle)}</b>
            <small>${escapeHtml(emptyNote)}</small>
          </div>`;
        return;
      }
      listElement.innerHTML = items.map((item) => {
        const isOwner = item.author_role === 'SUPER_ADMIN';
        const isRelease = item.announcement_type === 'RELEASE' || Boolean(item.release_version);
        const media = Array.isArray(item.attachments) ? item.attachments : [];
        return `
          <article class="announcement-item${isOwner ? ' is-owner' : ''}${isRelease ? ' is-release-update' : ''}" data-announcement-id="${escapeHtml(item.id)}">
            <div class="announcement-item-content" role="button" tabindex="0" aria-label="Open announcement ${escapeHtml(item.title)}">
              ${isRelease ? `
                <div class="announcement-release-banner">
                  <span class="announcement-release-badge">
                    <svg viewBox="0 0 24 24" aria-hidden="true" class="release-star-icon"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg>
                    Release update
                  </span>
                  ${item.release_version ? `<span class="announcement-version-chip">${escapeHtml(item.release_version)}</span>` : ''}
                </div>` : ''}
              <div class="announcement-item-head">
                <strong class="announcement-item-title">${escapeHtml(item.title)}</strong>
                ${media.length ? `<span class="announcement-media-chip">${media.length} ${media.length === 1 ? 'file' : 'files'}</span>` : ''}
              </div>
              <div class="announcement-card-action">
                <button class="announcement-view-trigger" type="button" aria-label="View full announcement details">
                  <span>View details</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="announcement-view-arrow"><path d="M5 12h14M12 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              <div class="announcement-item-meta">${announcementAuthorMeta(item)}</div>
            </div>
            <div class="announcement-card-footer">
              ${renderReactionsBarHtml(item.id)}
            </div>
          </article>`;
      }).join('');
      bindAvatarFallbacks(listElement);
      syncPresenceDots(listElement);
    };

    const stopViewerMedia = () => {
      viewerMedia?.querySelectorAll('video').forEach((video) => video.pause());
    };

    const openViewer = async (item) => {
      if (!item || !viewerDialog) return;
      openItemId = item.id;
      const isRelease = item.announcement_type === 'RELEASE' || Boolean(item.release_version);
      if (viewerReleaseBanner) {
        viewerReleaseBanner.innerHTML = isRelease ? `
          <div class="announcement-release-banner announcement-viewer-release">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; width: 100%;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="announcement-release-badge">
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="release-star-icon"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg>
                  Release update
                </span>
                ${item.release_version ? `<span class="announcement-version-chip">${escapeHtml(item.release_version)}</span>` : ''}
              </div>
              <div style="display: inline-flex; gap: 8px; flex-wrap: wrap;">
                <a class="button button-sm button-primary" href="https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk" download="myIPON.apk" target="_blank" rel="noopener" style="padding: 4px 10px; font-size: 12px; text-decoration: none;">Download Android (.apk)</a>
              </div>
            </div>
          </div>` : '';
      }
      viewerMeta.innerHTML = announcementAuthorMeta(item);
      bindAvatarFallbacks(viewerMeta);
      syncPresenceDots(viewerMeta);
      const titleParts = (item.title || '').split(/:\s+/);
      if (titleParts.length > 1) {
        viewerTitle.innerHTML = `<span class="announcement-hero-headline">${escapeHtml(titleParts[0])}:</span><span class="announcement-hero-subhead">${escapeHtml(titleParts.slice(1).join(': '))}</span>`;
      } else {
        viewerTitle.innerHTML = `<span class="announcement-hero-headline">${escapeHtml(item.title || '')}</span>`;
      }
      viewerDescription.innerHTML = renderAnnouncementDescriptionHtml(item.description, item.release_version);
      viewerDelete.hidden = !canDelete(item);
      if (viewerReactions) viewerReactions.innerHTML = renderReactionsBarHtml(item.id);
      const viewerReleaseFeatures = document.getElementById('announcement-viewer-release-features');
      if (viewerReleaseFeatures) viewerReleaseFeatures.replaceChildren();
      const loadReleaseFeatures = async () => {
        if (!viewerReleaseFeatures || !isRelease || !item.release_version) return;
        try {
          const { data: relFeats } = await getClient().rpc('get_release_features', {
            p_release_version: item.release_version
          });
          if (openItemId !== item.id || !viewerDialog.open || !Array.isArray(relFeats) || !relFeats.length) return;
          const releaseMarkup = `
            <section class="announcement-release-section" aria-label="Features requested by users">
              <div class="announcement-section-heading">
                <span class="announcement-section-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg>
                </span>
                <div>
                  <h3 class="announcement-section-title">Features Requested by Savers &amp; Shipped in this Update</h3>
                  <p class="announcement-section-subtitle">Community suggestions implemented in this release</p>
                </div>
              </div>
              <div class="release-features-grid">
                ${relFeats.map((feat) => {
            const hasCredit = feat.allow_credit && feat.requester_name;
            const avatarHtml = renderAvatarCell({
              full_name: feat.requester_name,
              avatar_url: feat.requester_avatar_url
            });
            return `
                    <div class="release-feature-card">
                      <div class="release-feature-head">
                        <strong class="release-feature-title">${escapeHtml(feat.title)}</strong>
                        ${hasCredit ? `
                          <div class="release-credit-pill" tabindex="0" role="button" aria-label="Feature requested by ${escapeHtml(feat.requester_name)}">
                            <span class="presence-avatar-wrap">
                              <span class="avatar-cell release-credit-thumb" data-user-id="${escapeHtml(feat.requester_id || '')}">${avatarHtml}</span>
                            </span>
                            <span class="release-credit-label">Requested by</span>
                            <strong class="release-credit-name">${escapeHtml(feat.requester_name)}</strong>
                            <div class="release-credit-tooltip" role="tooltip">
                              <div class="release-credit-tooltip-content">
                                <span class="presence-avatar-wrap">
                                  <span class="avatar-cell release-credit-tooltip-avatar" data-user-id="${escapeHtml(feat.requester_id || '')}">${avatarHtml}</span>
                                </span>
                                <div class="release-credit-tooltip-text">
                                  <small>Feature requested by:</small>
                                  <strong>${escapeHtml(feat.requester_name)}</strong>
                                </div>
                              </div>
                            </div>
                          </div>` : `
                          <span class="release-credit-anonymous" title="The requester chose not to be credited">
                            <svg viewBox="0 0 24 24" aria-hidden="true" class="credit-anon-icon"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Z"/><path d="M12 6a3.5 3.5 0 0 0-3.5 3.5h2A1.5 1.5 0 1 1 12 11c-.8 0-1.5.7-1.5 1.5V14h2v-1.1c1.2-.5 2-1.6 2-2.9A3.5 3.5 0 0 0 12 6Zm-1 10h2v2h-2Z"/></svg>
                            Community suggestion
                          </span>`}
                      </div>
                      ${feat.details ? `<p class="release-feature-details">${escapeHtml(feat.details)}</p>` : ''}
                    </div>`;
          }).join('')}
              </div>
            </section>`;
          // Replace the inline plain-text box when present so avatar cards sit in natural flow without duplication
          const inlineRequested = Array.from(viewerDescription?.querySelectorAll('.announcement-requested-card') || []);
          let host = viewerReleaseFeatures;
          if (inlineRequested.length > 0) {
            const temp = document.createElement('div');
            temp.innerHTML = releaseMarkup;
            const sectionNode = temp.firstElementChild;
            if (sectionNode) {
              inlineRequested[0].replaceWith(sectionNode);
              inlineRequested.slice(1).forEach((dup) => dup.remove());
              host = viewerDescription;
            }
          } else {
            viewerReleaseFeatures.innerHTML = releaseMarkup;
          }
          bindAvatarFallbacks(host);
          syncPresenceDots(host);
        } catch (_) { }
      };
      loadReleaseFeatures();
      const attachments = Array.isArray(item.attachments) ? item.attachments : [];
      if (!attachments.length) {
        viewerMedia.hidden = true;
        viewerMedia.replaceChildren();
        viewerDialog.showModal();
        return;
      }
      viewerMedia.hidden = false;
      viewerMedia.innerHTML = '<p class="empty-state">Loading media…</p>';
      viewerDialog.showModal();
      try {
        const { urls = {} } = await invokeAccountFunction({ action: 'announcement-view-urls', announcement_id: item.id });
        if (openItemId !== item.id || !viewerDialog.open) return;
        const rendered = attachments.map((media) => {
          const url = urls[media.path] || '';
          const safeName = escapeHtml(media.name || (media.kind === 'video' ? 'video' : 'picture'));
          if (!url) return '';
          if (media.kind === 'video') {
            return `<figure class="announcement-media-item is-video"><video controls playsinline preload="metadata" src="${escapeHtml(url)}"></video><figcaption><span>${safeName}</span><a class="icon-action" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a></figcaption></figure>`;
          }
          return `<figure class="announcement-media-item"><img src="${escapeHtml(url)}" alt="${safeName}"><figcaption><span>${safeName}</span><a class="icon-action" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open</a></figcaption></figure>`;
        }).filter(Boolean).join('');
        viewerMedia.innerHTML = rendered || '<p class="empty-state">Attachments unavailable.</p>';
      } catch (error) {
        viewerMedia.innerHTML = `<p class="empty-state">${escapeHtml(friendlyError(error))}</p>`;
      }
    };

    const load = async () => {
      const client = getClient();
      if (!client || !currentProfile) { items = []; reactions = []; renderList(); return []; }
      const [announcementsRes, reactionsRes] = await Promise.all([
        client
          .from('v_announcements')
          .select('id,group_id,author_id,author_name,author_role,author_avatar_url,title,description,attachments,created_at,announcement_type,release_version')
          .order('created_at', { ascending: false })
          .limit(200),
        client
          .from('announcement_reactions')
          .select('announcement_id,user_id,reaction')
      ]);
      if (announcementsRes.error) throw announcementsRes.error;
      items = announcementsRes.data || [];
      reactions = (!reactionsRes.error && Array.isArray(reactionsRes.data)) ? reactionsRes.data : [];
      renderList();
      if (viewerDialog?.open && openItemId) {
        if (!items.some((entry) => entry.id === openItemId)) {
          stopViewerMedia();
          viewerDialog.close();
          openItemId = null;
          toast('This announcement was removed.');
        } else if (viewerReactions) {
          viewerReactions.innerHTML = renderReactionsBarHtml(openItemId);
        }
      }
      return items;
    };

    if (!listElement.dataset.boundAnnouncements) {
      listElement.dataset.boundAnnouncements = 'true';
      listElement.addEventListener('click', (event) => {
        const choiceBtn = event.target.closest('[data-react-choice]');
        if (choiceBtn) {
          const announcementId = choiceBtn.dataset.announcementId;
          const emoji = choiceBtn.dataset.reactChoice;
          if (announcementId && emoji) handleReactionToggle(announcementId, emoji);
          return;
        }
        const triggerBtn = event.target.closest('[data-react-trigger]');
        if (triggerBtn) {
          const announcementId = triggerBtn.dataset.reactTrigger;
          activePickerAnnouncementId = activePickerAnnouncementId === announcementId ? null : announcementId;
          renderList();
          return;
        }
        const viewPill = event.target.closest('[data-reactions-view]');
        if (viewPill) {
          const announcementId = viewPill.dataset.reactionsView;
          if (announcementId) openReactionsModal(announcementId);
          return;
        }
        if (event.target.closest('.announcement-reactions-bar')) return;
        const trigger = event.target.closest('[data-announcement-id]');
        if (!trigger) return;
        const target = items.find((entry) => entry.id === trigger.dataset.announcementId);
        if (target) openViewer(target);
      });

      listElement.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          const content = event.target.closest('.announcement-item-content, .announcement-view-trigger');
          if (content) {
            const card = content.closest('[data-announcement-id]');
            const target = items.find((entry) => entry.id === card?.dataset.announcementId);
            if (target) {
              event.preventDefault();
              openViewer(target);
            }
          }
        }
      });
    }

    if (viewerReactions && !viewerReactions.dataset.bound) {
      viewerReactions.dataset.bound = 'true';
      viewerReactions.addEventListener('click', (event) => {
        const choiceBtn = event.target.closest('[data-react-choice]');
        if (choiceBtn) {
          const announcementId = choiceBtn.dataset.announcementId || openItemId;
          const emoji = choiceBtn.dataset.reactChoice;
          if (announcementId && emoji) handleReactionToggle(announcementId, emoji);
          return;
        }
        const triggerBtn = event.target.closest('[data-react-trigger]');
        if (triggerBtn) {
          const announcementId = triggerBtn.dataset.reactTrigger || openItemId;
          activePickerAnnouncementId = activePickerAnnouncementId === announcementId ? null : announcementId;
          viewerReactions.innerHTML = renderReactionsBarHtml(announcementId);
          return;
        }
        const viewPill = event.target.closest('[data-reactions-view]');
        if (viewPill) {
          const announcementId = viewPill.dataset.reactionsView || openItemId;
          if (announcementId) openReactionsModal(announcementId);
          return;
        }
      });
    }

    if (reactionsDialog && !reactionsDialog.dataset.bound) {
      reactionsDialog.dataset.bound = 'true';
      const closeReactions = () => {
        reactionsDialog.close();
        currentModalAnnouncementId = null;
      };
      document.getElementById('announcement-reactions-close')?.addEventListener('click', closeReactions);
      document.getElementById('announcement-reactions-done')?.addEventListener('click', closeReactions);
      reactionsDialog.addEventListener('click', (event) => {
        if (event.target === reactionsDialog) closeReactions();
      });
      reactionsTabs?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-reaction-tab]');
        if (!btn) return;
        activeReactionTab = btn.dataset.reactionTab;
        renderReactionsModalContent();
      });
    }

    if (!document.body.dataset.boundAnnouncementPicker) {
      document.body.dataset.boundAnnouncementPicker = 'true';
      document.addEventListener('click', (event) => {
        if (activePickerAnnouncementId && !event.target.closest('.announcement-react-container')) {
          activePickerAnnouncementId = null;
          renderList();
          if (viewerDialog?.open && openItemId && viewerReactions) {
            viewerReactions.innerHTML = renderReactionsBarHtml(openItemId);
          }
        }
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && activePickerAnnouncementId) {
          activePickerAnnouncementId = null;
          renderList();
          if (viewerDialog?.open && openItemId && viewerReactions) {
            viewerReactions.innerHTML = renderReactionsBarHtml(openItemId);
          }
        }
      });
    }

    if (addButton && !addButton.dataset.boundAnnouncements) {
      addButton.dataset.boundAnnouncements = 'true';
      addButton.addEventListener('click', () => {
        composeForm.reset();
        clearQueuedMedia();
        composeDialog.showModal();
        document.getElementById('announcement-title-input')?.focus();
      });
    }

    if (!composeDialog.dataset.bound) {
      composeDialog.dataset.bound = 'true';
      const closeCompose = () => { composeDialog.close(); clearQueuedMedia(); };
      document.getElementById('announcement-compose-close')?.addEventListener('click', closeCompose);
      document.getElementById('announcement-compose-cancel')?.addEventListener('click', closeCompose);
      composeDialog.addEventListener('click', (event) => { if (event.target === composeDialog) closeCompose(); });
      document.getElementById('announcement-viewer-close')?.addEventListener('click', () => viewerDialog.close());
      document.getElementById('announcement-viewer-done')?.addEventListener('click', () => viewerDialog.close());
      viewerDialog.addEventListener('click', (event) => { if (event.target === viewerDialog) viewerDialog.close(); });
      viewerDialog.addEventListener('close', () => { stopViewerMedia(); openItemId = null; });

      mediaInput?.addEventListener('change', () => {
        const chosen = [...(mediaInput.files || [])];
        mediaInput.value = '';
        for (const file of chosen) {
          if (queuedMedia.length >= MAX_ANNOUNCEMENT_FILES) {
            toast(`You can attach up to ${MAX_ANNOUNCEMENT_FILES} files per announcement.`, 'error');
            break;
          }
          try {
            const kind = classifyAnnouncementFile(file);
            queuedMedia.push({ file, kind, previewUrl: URL.createObjectURL(file) });
          } catch (error) {
            toast(friendlyError(error), 'error');
          }
        }
        renderQueuedMedia();
      });

      mediaPreviews?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-remove-announcement-media]');
        if (!button) return;
        const index = Number(button.dataset.removeAnnouncementMedia);
        const [removed] = queuedMedia.splice(index, 1);
        if (removed) URL.revokeObjectURL(removed.previewUrl);
        renderQueuedMedia();
      });
    }

    viewerDelete.onclick = async () => {
      const target = items.find((entry) => entry.id === openItemId);
      if (!target || !canDelete(target)) return;
      const confirmed = await confirmAction({
        title: 'Delete announcement',
        message: 'This announcement will be deleted for all users right away.',
        confirmLabel: 'Delete'
      });
      if (!confirmed) return;
      setBusy(viewerDelete, true, 'Deleting…');
      try {
        await rpc('delete_announcement', { p_announcement_id: target.id });
        // Retain announcement attachments while deleted items remain recoverable for 1 month.
        openItemId = null;
        viewerDialog.close();
        await load();
        toast('Announcement moved to bin.');
      } catch (error) {
        toast(friendlyError(error), 'error');
      } finally {
        setBusy(viewerDelete, false);
      }
    };

    composeForm.onsubmit = async (event) => {
      event.preventDefault();
      if (!composeForm.reportValidity()) return;
      const title = document.getElementById('announcement-title-input')?.value.trim() || '';
      const description = document.getElementById('announcement-description-input')?.value.trim() || '';
      if (!title || !description) return;
      const button = composeForm.querySelector('button[type="submit"]');
      const client = getClient();
      const announcementId = crypto.randomUUID();
      const uploadedPaths = [];
      setBusy(button, true, 'Publishing…');
      try {
        const attachments = [];
        if (queuedMedia.length) {
          const { uploads = [] } = await invokeAccountFunction({
            action: 'announcement-upload-urls',
            announcement_id: announcementId,
            files: queuedMedia.map((entry) => ({ name: entry.file.name, kind: entry.kind, type: entry.file.type }))
          });
          for (let i = 0; i < queuedMedia.length; i += 1) {
            const entry = queuedMedia[i];
            const upload = uploads[i];
            if (!upload?.path || !upload?.token) throw new Error('Upload authorization missing.');
            const { error: uploadError } = await client.storage
              .from('announcements')
              .uploadToSignedUrl(upload.path, upload.token, entry.file, { contentType: entry.file.type || undefined });
            if (uploadError) throw uploadError;
            uploadedPaths.push(upload.path);
            attachments.push({ path: upload.path, name: upload.name, kind: entry.kind, type: entry.type || entry.file.type || '' });
          }
        }
        await rpc('create_announcement', {
          p_id: announcementId,
          p_title: title,
          p_description: description,
          p_attachments: attachments
        });
        composeDialog.close();
        composeForm.reset();
        clearQueuedMedia();
        await load();
        toast('Announcement published.');
      } catch (error) {
        if (uploadedPaths.length) invokeAccountFunction({ action: 'announcement-cleanup-media', paths: uploadedPaths }).catch(() => { });
        toast(friendlyError(error), 'error');
      } finally {
        setBusy(button, false);
      }
    };

    if (!listElement.dataset.profileSyncBound) {
      listElement.dataset.profileSyncBound = 'true';
      window.addEventListener('ipon:profile-updated', (event) => {
        const updated = event?.detail;
        if (!updated?.id) return;
        let changed = false;
        items.forEach((entry) => {
          if (entry.author_id === updated.id) {
            if (updated.full_name) entry.author_name = updated.full_name;
            if (updated.avatar_url !== undefined) entry.author_avatar_url = updated.avatar_url;
            changed = true;
          }
        });
        if (changed) {
          renderList();
          if (viewerDialog?.open && openItemId && viewerMeta) {
            const activeEntry = items.find((entry) => entry.id === openItemId);
            if (activeEntry) viewerMeta.innerHTML = announcementAuthorMeta(activeEntry);
          }
        }
      });
    }

    return {
      load,
      clear: () => { items = []; reactions = []; renderList(); }
    };
  }

  function subscribeToChanges(name, tables, refresh) {
    const client = getClient();
    if (!client || !tables.length) return null;
    let timer;
    let pending = Promise.resolve();
    const run = () => {
      pending = pending.then(refresh).catch((error) => toast(friendlyError(error), 'error'));
      return pending;
    };
    activeLiveRefresh = run;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.visibilityState === 'visible') run(); }, 350);
    };
    let channel = client.channel(`live:${name}:${currentProfile?.id || 'session'}`);
    tables.forEach((table) => ['INSERT', 'UPDATE'].forEach((event) => {
      channel = channel.on('postgres_changes', { event, schema: 'public', table }, schedule);
    }));
    channel.subscribe();
    const resume = () => { if (document.visibilityState === 'visible') schedule(); };
    const autoSyncTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (document.querySelector('dialog[open]')) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      run();
    }, 45000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pagehide', () => {
      clearTimeout(timer);
      clearInterval(autoSyncTimer);
      if (activeLiveRefresh === run) activeLiveRefresh = null;
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      client.removeChannel(channel);
    }, { once: true });
    return channel;
  }

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    console.warn('Unhandled rejection:', event.reason);
    if (isHarmlessLockOrAbortError(event.reason)) return;
    if (startupInProgress) return;
    setLoading(false);
    if (appInitialized || currentProfile || !document.body.dataset.page) {
      if (currentProfile) {
        toast(friendlyError(event.reason), 'error');
      }
      return;
    }
    showStartupFailure(event.reason);
  });

  async function inviteAccount(payload) {
    return invokeAccountFunction({
      ...payload,
      login_url: new URL('login.html', location.href).href
    });
  }

  async function notifyAdminRequestDecision(payload) {
    return invokeAccountFunction({
      action: 'admin-request-decision-email',
      ...payload,
      login_url: new URL('login.html', location.href).href
    });
  }

  async function sendAdminRequestVerificationCode(payload) {
    const email = (payload?.email || '').trim().toLowerCase();
    const fullName = payload?.full_name || payload?.full || '';

    const edgeRes = await invokeAccountFunction({
      action: 'send-verification-otp',
      email,
      full_name: fullName
    });

    if (edgeRes?.error) {
      throw new Error(edgeRes.error);
    }

    return {
      success: true,
      email_sent: edgeRes?.email_sent ?? true,
      code: edgeRes?.code || null
    };
  }

  async function verifyAdminRequestVerificationCode(payload) {
    const { email, code } = payload || {};
    return rpc('verify_admin_email_verification', {
      p_email: email,
      p_code: code
    });
  }

  async function unblockAdminRequest(payload) {
    return invokeAccountFunction({
      action: 'unblock-admin-request',
      ...payload
    });
  }

  async function submitAdminRequest(payload) {
    return invokeAccountFunction({
      action: 'submit-admin-request',
      ...payload
    });
  }

  async function notifyAccountStatusChange(payload) {
    return invokeAccountFunction({
      action: 'super-admin-account-action',
      ...payload
    });
  }

  async function switchActiveGroup(groupId) {
    const result = await rpc('switch_active_group', { p_group_id: groupId });
    if (currentProfile && result) {
      currentProfile.group_id = result.group_id;
      currentProfile.role = result.role;
      currentProfile.member_id = result.member_id ?? null;
    }
    return result;
  }

  function showInviteSummary({ title = 'Member invites', results = [] } = {}) {
    if (!results.length) return;
    let dialog = document.getElementById('invite-summary-dialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="form-dialog invite-summary-dialog" id="invite-summary-dialog" aria-labelledby="invite-summary-title">
          <div class="form-dialog-sheet">
            <header class="form-dialog-header">
              <div><h2 id="invite-summary-title">Member invites</h2><p id="invite-summary-subtitle">Review invitation delivery status and copy sign-in credentials if needed.</p></div>
              <button class="dialog-close" type="button" data-invite-summary-close aria-label="Close invite summary"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            </header>
            <div class="invite-summary-list" id="invite-summary-list"></div>
            <div class="form-actions"><button class="button button-primary" type="button" data-invite-summary-close>Done</button></div>
          </div>
        </dialog>`);
      dialog = document.getElementById('invite-summary-dialog');
      dialog.querySelectorAll('[data-invite-summary-close]').forEach((btn) => btn.addEventListener('click', () => dialog.close()));
      dialog.addEventListener('click', async (event) => {
        const copyBtn = event.target.closest('[data-copy-invite]');
        if (!copyBtn) return;
        const text = copyBtn.dataset.copyInvite || '';
        try {
          await navigator.clipboard.writeText(text);
          toast('Invite credentials copied.');
        } catch {
          toast('Copy failed. Select the text below manually.', 'error');
        }
      });
    }
    document.getElementById('invite-summary-title').textContent = title;
    const list = document.getElementById('invite-summary-list');
    list.innerHTML = results.map((item) => {
      const ok = Boolean(item.ok);
      const sent = Boolean(item.email_sent);
      const badge = !ok
        ? '<span class="status status-disabled">Failed</span>'
        : sent
          ? '<span class="status status-active">Email sent</span>'
          : '<span class="status status-pending">Share manually</span>';
      const detail = !ok
        ? `<p class="invite-summary-note is-error">${escapeHtml(item.error || 'Could not create invite.')}</p>`
        : sent
          ? `<p class="invite-summary-note">An invitation email was sent to ${escapeHtml(item.email)}. Their account will activate once they accept the invite. If they do not see it in their Inbox, please ask them to check their <strong>Spam</strong> or <strong>Junk</strong> folder.</p>`
          : `<p class="invite-summary-note">${escapeHtml(item.email_error || 'Email service is not configured yet.')} Share these details with them:</p><pre class="invite-summary-preview">${escapeHtml(item.invite_message || '')}</pre><button class="button button-secondary" type="button" data-copy-invite="${escapeHtml(item.invite_message || '')}">Copy credentials</button>`;
      return `<article class="invite-summary-item"><div class="invite-summary-head"><strong>${escapeHtml(item.email)}</strong>${badge}</div>${detail}</article>`;
    }).join('');
    dialog.showModal();
  }

  const STABLE_GEMINI_MODELS = [
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-flash-latest',
    'gemini-1.5-flash'
  ];

  let cachedWorkingGeminiModel = null;

  function getGeminiApiKey() {
    let configKey = (window.IPON_CONFIG?.geminiApiKey || '').trim();
    if (configKey.startsWith('base64:')) {
      try { configKey = atob(configKey.slice(7)).trim(); } catch (_) { }
    }
    if (configKey && !configKey.startsWith('AQ.')) {
      return configKey;
    }

    let storageKey = (localStorage.getItem('ipon_gemini_api_key') || '').trim();
    if (storageKey.startsWith('base64:')) {
      try { storageKey = atob(storageKey.slice(7)).trim(); } catch (_) { }
    }
    if (storageKey.startsWith('AQ.')) {
      try { localStorage.removeItem('ipon_gemini_api_key'); } catch (_) { }
      return '';
    }
    return storageKey;
  }

  function getGeminiModel() {
    return cachedWorkingGeminiModel || 'gemini-1.5-flash';
  }

  async function callGemini({ prompt, systemInstruction, apiKey, model, jsonResponse = true }) {
    const key = (apiKey || getGeminiApiKey()).trim();
    if (!key) {
      throw new Error('No Gemini API key found. Please save your API key in the configuration dialog or define geminiApiKey in js/config.js.');
    }
    if (key.startsWith('AQ.')) {
      try { localStorage.removeItem('ipon_gemini_api_key'); } catch (_) { }
      throw new Error('API key is a Google Cloud service account token (AQ.) which is not supported by Gemini API. Please generate a fresh key starting with AIzaSy from Google AI Studio (aistudio.google.com/app/apikey).');
    }

    // Fast candidate resolution: at most 3 models with quick 3s timeout per model
    let candidateModels = STABLE_GEMINI_MODELS;
    if (cachedWorkingGeminiModel) {
      candidateModels = [cachedWorkingGeminiModel, ...STABLE_GEMINI_MODELS.filter((m) => m !== cachedWorkingGeminiModel)];
    } else if (model && STABLE_GEMINI_MODELS.includes(model)) {
      candidateModels = [model, ...STABLE_GEMINI_MODELS.filter((m) => m !== model)];
    }

    let lastError = null;
    for (const curModel of candidateModels) {
      let timer = null;
      try {
        const ctrl = new AbortController();
        timer = setTimeout(() => ctrl.abort(), 25000);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(curModel)}:generateContent?key=${encodeURIComponent(key)}`;
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.92,
            topP: 0.95,
            maxOutputTokens: 8192
          }
        };
        if (jsonResponse) {
          body.generationConfig.responseMimeType = 'application/json';
        }
        if (systemInstruction) {
          body.systemInstruction = { parts: [{ text: systemInstruction }] };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key
          },
          body: JSON.stringify(body),
          signal: ctrl.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          let errMsg = errData?.error?.message || `HTTP ${res.status} (${res.statusText})`;
          const errReason = errData?.error?.details?.[0]?.reason;
          if (errReason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED' || res.status === 401) {
            try { localStorage.removeItem('ipon_gemini_api_key'); } catch (_) { }
            throw new Error('API key is revoked or invalid (ACCESS_TOKEN_TYPE_UNSUPPORTED). Please generate a fresh key from Google AI Studio (aistudio.google.com/app/apikey).');
          }
          if (res.status === 404 || res.status === 503 || res.status === 429) {
            lastError = new Error(`Model ${curModel} (${res.status}): ${errMsg}`);
            continue;
          }
          throw new Error(errMsg);
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = new Error(`No content from ${curModel}`);
          continue;
        }

        let parsed = null;
        if (jsonResponse) {
          try {
            parsed = JSON.parse(text);
          } catch (_) {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) parsed = JSON.parse(match[0]);
            else throw new Error('Could not parse JSON from Gemini response.');
          }
        }

        cachedWorkingGeminiModel = curModel;
        return {
          text,
          parsed,
          model: curModel,
          success: true
        };
      } catch (err) {
        if (timer) clearTimeout(timer);
        lastError = err;
        if (/aborted/i.test(err.message)) {
          lastError = new Error(`Model ${curModel} timed out.`);
          continue;
        }
        if (/failed to fetch/i.test(err.message)) {
          throw new Error('Connection blocked (Failed to fetch). Check your internet connection or ad-blocker for generativelanguage.googleapis.com.');
        }
        if (/revoked|ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(err.message)) {
          throw err;
        }
        if (!/404|503|429|unavailable|high demand|parse JSON|Unterminated|Unexpected token/i.test(err.message)) {
          throw err;
        }
      }
    }
    throw lastError || new Error('Could not connect to Google Gemini API.');
  }

  function isMobileAppContext() {
    return Boolean(window.Capacitor) ||
      document.body.classList.contains('is-app') ||
      Boolean(window.MYIPON_APP_VERSION?.isApp) ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      /myIPON/i.test(navigator.userAgent) ||
      /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (window.innerWidth <= 768 && 'ontouchstart' in window);
  }

  function showAppUpdatePrompt({ version = 'Latest', build = 0, notes = '' } = {}) {
    let dialog = document.getElementById('app-update-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'app-update-dialog';
      dialog.className = 'form-dialog app-update-dialog';
      dialog.setAttribute('aria-labelledby', 'app-update-title');
      dialog.style.cssText = 'width: min(440px, calc(100vw - 32px)); border-radius: 16px; margin: auto; z-index: 999999;';
      dialog.innerHTML = `
        <div class="form-dialog-sheet">
          <header class="form-dialog-header" style="align-items: center;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <span style="display: inline-grid; place-items: center; width: 42px; height: 42px; border-radius: 12px; background: rgba(40, 122, 76, 0.14); color: var(--green, #1f6a43); flex-shrink: 0;">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
              </span>
              <div>
                <h2 id="app-update-title" style="font-size: 20px; font-weight: 800; line-height: 1.15; margin: 0;">Update available</h2>
                <p id="app-update-subtitle" style="margin: 3px 0 0; font-size: 13px; color: var(--muted, #5c6863);">New version of myIPON is ready</p>
              </div>
            </div>
            <button class="dialog-close" type="button" id="app-update-close" aria-label="Close update prompt">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </header>
          <div style="padding: 20px 22px 22px; display: grid; gap: 14px;">
            <p id="app-update-copy" style="margin: 0; font-size: 14px; line-height: 1.55; color: var(--ink-soft, #354741);">
              A new version of myIPON is available. Update now to install the latest features and updates.
            </p>
            <div style="background: rgba(40, 122, 76, 0.1); border: 1px solid rgba(40, 122, 76, 0.24); border-radius: 10px; padding: 10px 14px; font-size: 12.5px; color: var(--green, #1f6a43); line-height: 1.45;">
              ✓ Your existing records and account session will be kept safe.
            </div>
            <div class="form-actions" style="margin-top: 6px; display: flex; justify-content: flex-end; gap: 10px;">
              <button class="button button-secondary" type="button" id="app-update-later">Later</button>
              <a class="button button-primary" id="app-update-now" href="https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk" download="myIPON.apk" target="_blank" rel="noopener" style="text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Update now
              </a>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(dialog);

      const closeBtn = dialog.querySelector('#app-update-close');
      const laterBtn = dialog.querySelector('#app-update-later');
      const updateBtn = dialog.querySelector('#app-update-now');

      const dismiss = () => {
        try { dialog.close(); } catch (_) { dialog.removeAttribute('open'); }
        if (build) sessionStorage.setItem(`dismissed_update_${build}`, '1');
      };

      closeBtn.addEventListener('click', dismiss);
      laterBtn.addEventListener('click', dismiss);

      updateBtn.addEventListener('click', () => {
        const downloadUrl = 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk';
        updateBtn.href = downloadUrl;
        updateBtn.setAttribute('download', 'myIPON.apk');
        if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
          try { window.open(downloadUrl, '_system'); } catch (_) { }
        }
        toast('Downloading latest update... Please open the file to install.', 'success');
        dismiss();
      });
    }

    if (version) {
      const subtitle = dialog.querySelector('#app-update-subtitle');
      if (subtitle) subtitle.textContent = `Version ${version} is ready`;
    }
    if (notes) {
      const copy = dialog.querySelector('#app-update-copy');
      if (copy) copy.textContent = notes;
    }

    try {
      if (!dialog.open) dialog.showModal();
    } catch (_) {
      dialog.setAttribute('open', '');
    }
  }

  async function checkForAppUpdate({ force = false } = {}) {
    if (isIosDevice()) return;
    const isNativeApp = isInstalledAppUser();
    const isMobile = isNativeApp || isMobileAppContext();

    const justLoggedIn = sessionStorage.getItem('myipon_just_logged_in');
    if (justLoggedIn) {
      sessionStorage.removeItem('myipon_just_logged_in');
    }

    if (!isMobile && !force && !justLoggedIn) return;

    const installedNativeBuild = getInstalledNativeBuild();

    let remoteVersion = null;
    let remoteBuild = 0;
    let remoteNotes = '';
    let updateFound = false;

    // Check raw github version.json; only prompt APK reinstall when nativeBuild increases
    try {
      const res = await fetch('https://raw.githubusercontent.com/zediskaaa/Ipon-Tracking-System/main/version.json?_t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const remote = await res.json();
        remoteVersion = remote.version;
        remoteBuild = Number(remote.nativeBuild || remote.build || 0);
        if (remoteVersion) localStorage.setItem('myipon_latest_remote_version', remoteVersion);
        if (remoteBuild) localStorage.setItem('myipon_latest_native_build', String(remoteBuild));
        if (isNativeApp && remoteBuild > installedNativeBuild) {
          updateFound = true;
          remoteNotes = `A new version (${remoteVersion || 'Latest'}) of myIPON is ready with automatic live updates. Tap Update now to download and install.`;
        }
      }
    } catch (_) { }

    if (updateFound) {
      window.dispatchEvent(new CustomEvent('myipon_update_available', { detail: { version: remoteVersion, build: remoteBuild } }));
      if (!force && remoteBuild && sessionStorage.getItem(`dismissed_update_${remoteBuild}`)) return;
      showAppUpdatePrompt({
        version: remoteVersion || 'Latest',
        build: remoteBuild,
        notes: remoteNotes
      });
    } else if (!isNativeApp && (justLoggedIn || force)) {
      // Mobile user who just signed in on mobile browser: prompt to install the native app
      if (!sessionStorage.getItem('dismissed_mobile_app_prompt')) {
        showAppUpdatePrompt({
          version: 'Mobile App',
          build: 'mobile_app_prompt',
          notes: 'Download the official myIPON Android app (.apk) for the fastest, full-screen savings experience.'
        });
      }
    }
  }

  function initAppUpdateChecker() {
    if (isInstalledAppUser()) {
      document.body.classList.add('is-app');
    }
    setTimeout(() => {
      checkForAppUpdate();
    }, 200);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForAppUpdate();
    });
  }

  function openImageViewer(src, title = 'Attachment', subtitle = '', downloadName = '') {
    const raw = String(src || '').trim();
    const isSafeUrl = raw.startsWith('data:image/') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw);
    if (!raw || !isSafeUrl) return;
    let dialog = document.getElementById('ipon-image-viewer');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ipon-image-viewer';
      dialog.className = 'image-viewer-dialog';
      dialog.innerHTML = `<div class="image-viewer-sheet">
        <header class="image-viewer-header">
          <div><h2 id="ipon-iv-title"></h2><p id="ipon-iv-subtitle"></p></div>
          <div class="image-viewer-actions">
            <a class="button button-secondary button-sm" id="ipon-iv-download" download="myipon-attachment.jpg" target="_blank" rel="noopener">Download</a>
            <button class="dialog-close" id="ipon-iv-close" type="button" aria-label="Close image viewer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </div>
        </header>
        <div class="image-viewer-stage"><img id="ipon-iv-img" alt=""></div>
      </div>`;
      document.body.appendChild(dialog);
      dialog.querySelector('#ipon-iv-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    const img = dialog.querySelector('#ipon-iv-img');
    const titleEl = dialog.querySelector('#ipon-iv-title');
    const subEl = dialog.querySelector('#ipon-iv-subtitle');
    const dl = dialog.querySelector('#ipon-iv-download');
    img.src = raw;
    img.alt = title;
    titleEl.textContent = title;
    subEl.textContent = subtitle || '';
    subEl.hidden = !subtitle;
    dl.href = raw;
    const cleanDl = String(downloadName || '').trim();
    dl.download = cleanDl || `${String(title || 'attachment').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
    if (!dialog.open) dialog.showModal();
  }

  function bindReceiptPicker({ input, dropzone, preview, thumb, nameEl, clearBtn, emptyBox, onChange } = {}) {
    let dataUrl = null;
    const sync = (fileName = '') => {
      const hasFile = Boolean(dataUrl);
      if (preview) preview.hidden = !hasFile;
      if (emptyBox) emptyBox.hidden = hasFile;
      if (thumb) {
        if (hasFile) thumb.src = dataUrl;
        else thumb.removeAttribute('src');
      }
      if (nameEl && fileName) nameEl.textContent = fileName;
      onChange?.(dataUrl);
    };
    const handleFile = async (file) => {
      if (!file) return;
      try {
        const prepared = await prepareImageDataUrl(file, { maxEdge: 1200, skipCompressBytes: 120 * 1024, maxBytes: 420 * 1024 });
        dataUrl = prepared.dataUrl;
        sync(prepared.name);
      } catch (error) {
        dataUrl = null;
        if (input) input.value = '';
        sync();
        toast(friendlyError(error), 'error');
      }
    };
    input?.addEventListener('change', () => handleFile(input.files?.[0]));
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('is-dragover'); }));
      ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('is-dragover'); }));
      dropzone.addEventListener('drop', (e) => {
        const file = e.dataTransfer?.files?.[0];
        if (file) handleFile(file);
      });
    }
    thumb?.addEventListener('click', (e) => {
      e.preventDefault();
      if (dataUrl) openImageViewer(dataUrl, 'Receipt preview', nameEl?.textContent || '');
    });
    clearBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dataUrl = null;
      if (input) input.value = '';
      sync();
    });
    return {
      get: () => dataUrl,
      clear: () => { dataUrl = null; if (input) input.value = ''; sync(); }
    };
  }

  async function triggerManualRefresh() {
    if ('serviceWorker' in navigator && !window.Capacitor) {
      navigator.serviceWorker.getRegistration?.().then((reg) => reg?.update().catch(() => { })).catch(() => { });
    }
    if (typeof activeLiveRefresh === 'function') {
      await activeLiveRefresh();
      return true;
    }
    window.location.reload();
    return false;
  }

  function initPullToRefresh() {
    if (document.getElementById('ptr-indicator')) return;
    const indicator = document.createElement('div');
    indicator.id = 'ptr-indicator';
    indicator.className = 'ptr-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.innerHTML = '<svg class="ptr-spinner" viewBox="0 0 24 24"><circle class="ptr-track" cx="12" cy="12" r="9"/><circle class="ptr-arc" cx="12" cy="12" r="9"/></svg>';
    document.body.appendChild(indicator);

    const THRESHOLD = 58;
    const MAX_PULL = 94;
    let tracking = false;
    let refreshing = false;
    let startX = 0;
    let startY = 0;
    let currentPull = 0;

    function hasScrolledAncestor(node) {
      let el = node && node.nodeType === 1 ? node : null;
      while (el && el !== document.body && el !== document.documentElement) {
        if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) return true;
        el = el.parentElement;
      }
      return false;
    }

    function setPullState(pull) {
      currentPull = pull;
      const clamped = Math.max(0, Math.min(MAX_PULL, pull));
      const progress = Math.min(1, clamped / THRESHOLD);
      indicator.style.setProperty('--ptr-y', `${Math.round(clamped - 44)}px`);
      indicator.style.setProperty('--ptr-progress', progress.toFixed(3));
      indicator.classList.toggle('is-pulling', clamped > 0);
      indicator.classList.toggle('is-ready', clamped >= THRESHOLD);
    }

    document.addEventListener('touchstart', (event) => {
      if (refreshing || event.touches.length !== 1) return;
      if (document.querySelector('dialog[open]')) return;
      if ((window.scrollY || document.documentElement.scrollTop || 0) > 1) return;
      const target = event.target;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'OPTION') return;
      if (hasScrolledAncestor(target)) return;
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      tracking = true;
      currentPull = 0;
    }, { passive: true });

    document.addEventListener('touchmove', (event) => {
      if (!tracking || refreshing || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0 || (window.scrollY || document.documentElement.scrollTop || 0) > 1) {
        if (currentPull > 0) setPullState(0);
        tracking = false;
        return;
      }
      if (currentPull === 0 && Math.abs(dx) > Math.abs(dy)) {
        tracking = false;
        return;
      }
      if (dy < 12) return;
      const eased = Math.min(MAX_PULL, (dy - 12) * 0.48);
      setPullState(eased);
    }, { passive: true });

    async function finishTouch() {
      if (!tracking) return;
      tracking = false;
      const shouldRefresh = currentPull >= THRESHOLD;
      if (!shouldRefresh) {
        setPullState(0);
        return;
      }
      refreshing = true;
      indicator.classList.remove('is-pulling', 'is-ready');
      indicator.classList.add('is-refreshing');
      indicator.style.setProperty('--ptr-y', '12px');
      try {
        await Promise.all([
          triggerManualRefresh().catch(() => { }),
          new Promise((resolve) => setTimeout(resolve, 550))
        ]);
      } finally {
        indicator.classList.remove('is-refreshing');
        setPullState(0);
        refreshing = false;
      }
    }

    document.addEventListener('touchend', finishTouch, { passive: true });
    document.addEventListener('touchcancel', finishTouch, { passive: true });
  }

  /** Send batch payment reminders to unpaid/partial members for a month with shared confirmation and summary toast. */
  async function remindUnpaidMembers(monthIsoValue, button = null) {
    const targetMonth = String(monthIsoValue || monthStart()).slice(0, 7) + '-01';
    const monthText = dateLabel(targetMonth, { month: 'long', year: 'numeric' });
    const confirmed = await confirmAction({
      title: 'Remind unpaid members?',
      message: `Send in-app and mobile notifications to active members with unpaid or partial balances for ${monthText}? Recent reminders within 6 hours will be skipped automatically.`,
      acceptLabel: 'Send reminders'
    });
    if (!confirmed) return null;
    if (button) setBusy(button, true, 'Sending…');
    try {
      const res = await rpc('remind_unpaid_members', { p_period_month: targetMonth });
      const sent = Number(res?.sent || 0);
      const skipped = Number(res?.skipped_recent || 0);
      const unlinked = Number(res?.unlinked || 0);
      const unpaidTotal = Number(res?.unpaid_total || 0);
      if (unpaidTotal === 0) toast(`No unpaid members found for ${monthText}.`);
      else if (sent > 0) {
        const notes = [];
        if (skipped) notes.push(`${skipped} recently reminded`);
        if (unlinked) notes.push(`${unlinked} without linked login`);
        toast(`Sent ${sent} reminder${sent === 1 ? '' : 's'} for ${monthText}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
      } else {
        toast(`0 reminders sent (${skipped} recently notified, ${unlinked} without linked login).`);
      }
      return res;
    } catch (error) {
      toast(friendlyError(error), 'error');
      return null;
    } finally {
      if (button) setBusy(button, false);
    }
  }

  function initConnectivityBanner() {
    if (window.__iponConnectivityBound) return;
    window.__iponConnectivityBound = true;
    const syncState = () => {
      const offline = navigator.onLine === false;
      document.body.classList.toggle('is-offline', offline);
      let banner = document.getElementById('offline-status-banner');
      if (offline && !banner) {
        banner = document.createElement('div');
        banner.id = 'offline-status-banner';
        banner.className = 'offline-status-banner';
        banner.setAttribute('role', 'status');
        banner.textContent = 'Offline mode — showing cached view. Reconnect to save or submit updates.';
        document.body.prepend(banner);
      }
      if (banner) banner.hidden = !offline;
      document.querySelectorAll('[data-requires-data]').forEach((el) => {
        if (offline) {
          el.dataset.wasDisabledOffline = el.disabled ? '1' : '0';
          el.disabled = true;
        } else if (el.dataset.wasDisabledOffline === '0') {
          el.disabled = false;
          delete el.dataset.wasDisabledOffline;
        }
      });
    };
    window.addEventListener('offline', syncState);
    window.addEventListener('online', () => {
      syncState();
      toast('Back online.');
    });
    syncState();
  }

  function initInfoTips() {
    if (window.__iponInfoTipsBound) return;
    window.__iponInfoTipsBound = true;
    const popover = document.createElement('div');
    popover.id = 'ipon-info-popover';
    popover.className = 'info-tip-popover';
    popover.setAttribute('role', 'tooltip');
    popover.hidden = true;
    let activeTrigger = null;
    let hoverTimer = null;

    const closeTip = () => {
      clearTimeout(hoverTimer);
      if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
      activeTrigger = null;
      popover.hidden = true;
    };

    const openTip = (trigger) => {
      clearTimeout(hoverTimer);
      const message = trigger?.getAttribute('data-info-tip')?.trim();
      if (!message) return;
      if (activeTrigger && activeTrigger !== trigger) activeTrigger.setAttribute('aria-expanded', 'false');
      activeTrigger = trigger;
      trigger.setAttribute('aria-expanded', 'true');
      const host = trigger.closest('dialog[open]') || document.body;
      if (popover.parentElement !== host) host.appendChild(popover);
      popover.textContent = message;
      popover.hidden = false;

      const rect = trigger.getBoundingClientRect();
      const popRect = popover.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 12;
      const gap = 8;

      let left = rect.left + (rect.width / 2) - (popRect.width / 2);
      left = Math.max(margin, Math.min(left, vw - popRect.width - margin));

      let top = rect.bottom + gap;
      if (top + popRect.height > vh - margin && rect.top - gap - popRect.height >= margin) {
        top = rect.top - popRect.height - gap;
      } else {
        top = Math.max(margin, Math.min(top, vh - popRect.height - margin));
      }

      popover.style.left = `${Math.round(left)}px`;
      popover.style.top = `${Math.round(top)}px`;
    };

    document.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-info-tip]');
      if (btn) {
        event.preventDefault();
        event.stopPropagation();
        if (activeTrigger === btn && !popover.hidden) closeTip();
        else openTip(btn);
        return;
      }
      if (!event.target.closest('#ipon-info-popover')) closeTip();
    });

    document.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
      const btn = event.target.closest('[data-info-tip]');
      if (btn) openTip(btn);
    }, true);

    document.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch' || !(event.target instanceof Element)) return;
      const btn = event.target.closest('[data-info-tip]');
      if (btn && activeTrigger === btn) {
        hoverTimer = setTimeout(closeTip, 180);
      }
    }, true);

    document.addEventListener('focusin', (event) => {
      if (!(event.target instanceof Element)) return;
      const btn = event.target.closest('[data-info-tip]');
      if (btn) openTip(btn);
    });

    document.addEventListener('focusout', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-info-tip]')) {
        hoverTimer = setTimeout(closeTip, 120);
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !popover.hidden) closeTip();
    });
    window.addEventListener('scroll', () => { if (!popover.hidden) closeTip(); }, { passive: true, capture: true });
    window.addEventListener('resize', () => { if (!popover.hidden) closeTip(); }, { passive: true });
  }

  function groupRequiredContent({ hasGroup = false } = {}) {
    const title = hasGroup ? 'Member profile link required' : 'Join or create a savings group';
    const message = hasGroup
      ? 'Your account belongs to a group, but your member slot is not linked yet. Check your notifications or ask your group administrator to link your account.'
      : 'You need to belong to an active savings group before you can record entries. Create your own group now or accept a group invitation from your notifications.';
    const createButton = hasGroup
      ? ''
      : '<button class="button button-primary" type="button" data-group-required-create>+ Create savings group</button>';
    return `
      <div class="group-required-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="group-required-copy">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="group-required-actions">
        ${createButton}
        <button class="button button-secondary" type="button" data-group-required-invites>Check invitations</button>
      </div>`;
  }

  function wireGroupRequiredActions(root, { onCreateGroup = null, onClose = null } = {}) {
    root?.querySelector('[data-group-required-create]')?.addEventListener('click', () => {
      onClose?.();
      if (typeof onCreateGroup === 'function') onCreateGroup();
      else window.location.href = 'dashboard.html?create_group=1';
    });
    root?.querySelector('[data-group-required-invites]')?.addEventListener('click', () => {
      onClose?.();
      const notifTrigger = document.getElementById('open-notifications') || document.getElementById('mobile-open-notifications');
      if (notifTrigger) notifTrigger.click();
      else window.location.href = 'dashboard.html';
    });
  }

  function showGroupRequiredDialog({ hasGroup = false, onCreateGroup = null } = {}) {
    let dialog = document.getElementById('ipon-group-required-dialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="form-dialog group-required-dialog" id="ipon-group-required-dialog" aria-labelledby="ipon-group-required-title">
          <div class="form-dialog-sheet group-required-sheet">
            <header class="form-dialog-header">
              <div>
                <h2 id="ipon-group-required-title">Group access needed</h2>
                <p>Savings records are saved inside an active group workspace.</p>
              </div>
              <button class="dialog-close" type="button" data-group-required-close aria-label="Close">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </header>
            <div class="group-required-body" id="ipon-group-required-body"></div>
          </div>
        </dialog>`);
      dialog = document.getElementById('ipon-group-required-dialog');
      dialog?.querySelector('[data-group-required-close]')?.addEventListener('click', () => dialog.close());
      dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }
    const bodyEl = dialog.querySelector('#ipon-group-required-body');
    if (bodyEl) {
      bodyEl.innerHTML = groupRequiredContent({ hasGroup });
      wireGroupRequiredActions(bodyEl, { onCreateGroup, onClose: () => dialog.close() });
    }
    if (!dialog.open) dialog.showModal();
  }

  function renderGroupRequiredCard(container, options = {}) {
    if (!container) return;
    container.innerHTML = `<div class="group-required-card">${groupRequiredContent(options)}</div>`;
    wireGroupRequiredActions(container, options);
  }

  const PAYMENT_METHODS = Object.freeze([
    Object.freeze({ value: 'CASH', label: 'Cash', shortLabel: 'Cash', cssClass: 'pm-cash', group: 'physical' }),
    Object.freeze({ value: 'GCASH', label: 'GCash', shortLabel: 'GCash', cssClass: 'pm-gcash', group: 'digital' }),
    Object.freeze({ value: 'MAYA', label: 'Maya', shortLabel: 'Maya', cssClass: 'pm-maya', group: 'digital' }),
    Object.freeze({ value: 'BANK_TRANSFER', label: 'Bank transfer', shortLabel: 'Bank', cssClass: 'pm-bank', group: 'digital' }),
    Object.freeze({ value: 'OTHER', label: 'Other', shortLabel: 'Other', cssClass: 'pm-other', group: 'other' })
  ]);
  const PAYMENT_METHOD_MAP = new Map(PAYMENT_METHODS.map((item) => [item.value, item]));

  function normalizePaymentMethod(raw) {
    const clean = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
    if (!clean) return '';
    if (clean === 'BANK' || clean === 'INSTAPAY' || clean === 'PESONET') return 'BANK_TRANSFER';
    return PAYMENT_METHOD_MAP.has(clean) ? clean : '';
  }

  function guessPaymentMethodFromLabel(label, fallback = 'CASH') {
    const text = String(label || '').trim().toLowerCase();
    if (!text) return fallback;
    if (text.includes('gcash')) return 'GCASH';
    if (text.includes('maya')) return 'MAYA';
    if (text.includes('cash')) return 'CASH';
    if (/(bank|bpi|bdo|metrobank|unionbank|landbank|rcbc|chinabank|pnb|instapay|pesonet|seabank|gotyme|cimb)/.test(text)) {
      return 'BANK_TRANSFER';
    }
    return fallback;
  }

  function paymentMethodMeta(value) {
    const key = normalizePaymentMethod(value);
    return PAYMENT_METHOD_MAP.get(key) || {
      value: '',
      label: 'Untagged',
      shortLabel: 'Untagged',
      cssClass: 'pm-untagged',
      group: 'untagged'
    };
  }

  function paymentMethodIconHtml(value) {
    const key = normalizePaymentMethod(value);
    if (key === 'GCASH') {
      return '<span class="pm-icon is-gcash" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="5" fill="#007DFE"/><path d="M12.7 7.3a4 4 0 1 0 1.1 3.5H10.2v-1.7h5.2v.6A5.5 5.5 0 1 1 14 5.9l-1.3 1.4Z" fill="#fff"/></svg></span>';
    }
    if (key === 'MAYA') {
      return '<span class="pm-icon is-maya" aria-hidden="true"><svg viewBox="0 0 20 20"><rect x="1" y="1" width="18" height="18" rx="5" fill="#01B468"/><path d="M4.6 13.5V8.6c0-1.4 1-2.3 2.3-2.3.8 0 1.5.4 1.9 1 .4-.6 1.1-1 1.9-1 1.3 0 2.3.9 2.3 2.3v4.9h-1.8V8.8c0-.6-.4-1-1-1s-1 .4-1 1v4.7H7.4V8.8c0-.6-.4-1-1-1s-1 .4-1 1v4.7H4.6Z" fill="#fff"/></svg></span>';
    }
    if (key === 'CASH') {
      return '<span class="pm-icon is-cash" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><rect x="1.5" y="4.5" width="17" height="11" rx="2.2" fill="#dcfce7" stroke="#15803d" stroke-width="1.5"/><circle cx="10" cy="10" r="2.3" stroke="#15803d" stroke-width="1.5"/><path d="M4.3 7.5v5m11.4-5v5" stroke="#15803d" stroke-width="1.4" stroke-linecap="round"/></svg></span>';
    }
    if (key === 'BANK_TRANSFER') {
      return '<span class="pm-icon is-bank" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><path d="M2.5 7.5L10 3l7.5 4.5H2.5Z" fill="#dbeafe" stroke="#2f4b8f" stroke-width="1.4" stroke-linejoin="round"/><path d="M5 9.5v5M10 9.5v5M15 9.5v5M3 16.5h14" stroke="#2f4b8f" stroke-width="1.5" stroke-linecap="round"/></svg></span>';
    }
    if (key === 'OTHER') {
      return '<span class="pm-icon is-other" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><rect x="2" y="4.5" width="16" height="11" rx="2.2" fill="#fef3c7" stroke="#b27214" stroke-width="1.4"/><path d="M2.5 8.5h15M5.5 12h4" stroke="#b27214" stroke-width="1.4" stroke-linecap="round"/></svg></span>';
    }
    return '<span class="pm-icon is-untagged" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="#64748b" stroke-width="1.5"/><path d="M7 10h6" stroke="#64748b" stroke-width="1.5" stroke-linecap="round"/></svg></span>';
  }

  function paymentMethodBadge(value) {
    const meta = paymentMethodMeta(value);
    return `<span class="pm-badge ${meta.cssClass}">${paymentMethodIconHtml(meta.value)}${escapeHtml(meta.label)}</span>`;
  }

  function paymentMethodPickerHtml(name = 'payment_method', selected = 'CASH') {
    const target = normalizePaymentMethod(selected) || 'CASH';
    return PAYMENT_METHODS.map((item) => {
      const checked = item.value === target ? ' checked' : '';
      return `<label class="pm-pill ${item.cssClass}"><input type="radio" name="${escapeHtml(name)}" value="${item.value}"${checked}><span>${paymentMethodIconHtml(item.value)}${escapeHtml(item.label)}</span></label>`;
    }).join('');
  }

  function mountPaymentMethodPickers(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-pm-picker]').forEach((el) => {
      const name = el.dataset.name || 'payment_method';
      const def = normalizePaymentMethod(el.dataset.default) || 'CASH';
      el.classList.add('pm-picker');
      if (!el.getAttribute('role')) el.setAttribute('role', 'radiogroup');
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Payment method');
      el.innerHTML = paymentMethodPickerHtml(name, def);
    });
  }

  function setPaymentMethod(containerOrForm, value) {
    if (!containerOrForm) return;
    const normalized = normalizePaymentMethod(value);
    const radios = [...containerOrForm.querySelectorAll('input[type="radio"][name="payment_method"]')];
    if (radios.length) {
      const target = normalized || 'CASH';
      radios.forEach((input) => { input.checked = input.value === target; });
      return;
    }
    const select = containerOrForm.elements?.payment_method || containerOrForm.querySelector('select[name="payment_method"]');
    if (select) select.value = normalized;
  }

  function paymentMethodOptionsHtml({ includeAll = false, includeUntagged = false } = {}) {
    return [
      includeAll ? '<option value="">All methods</option>' : '',
      ...PAYMENT_METHODS.map((item) => `<option value="${item.value}">${escapeHtml(item.label)}</option>`),
      includeUntagged ? '<option value="UNTAGGED">Untagged (legacy)</option>' : ''
    ].filter(Boolean).join('');
  }

  async function getRecordCommentCounts(recordType, recordIds) {
    const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).filter(Boolean))];
    const map = new Map();
    if (!ids.length) return map;
    try {
      const rows = await rpc('get_record_comment_counts', { p_record_type: recordType, p_record_ids: ids });
      (Array.isArray(rows) ? rows : []).forEach((row) => {
        if (row?.record_id) {
          map.set(row.record_id, {
            total: Number(row.comment_count || 0),
            unread: Number(row.unread_count ?? row.comment_count ?? 0)
          });
        }
      });
    } catch { /* fallback quietly to zero counts */ }
    return map;
  }

  function recordDiscussionButtonHtml(row, count = 0) {
    if (!row?.id) return '';
    const info = count && typeof count === 'object' ? count : { total: Number(count || 0), unread: Number(count || 0) };
    const unread = Number(info.unread || 0);
    return `<button class="icon-action record-discuss-btn${unread > 0 ? ' has-comments' : ''}" type="button" data-action="discuss" data-id="${escapeHtml(row.id)}">${unread > 0 ? `Discuss <span class="comment-count-pill">${unread}</span>` : 'Discuss'}</button>`;
  }

  function clearDiscussionUnreadBadge(recordId) {
    if (!recordId) return;
    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(recordId)
      : String(recordId).replace(/"/g, '\\"');
    document.querySelectorAll?.(`[data-action="discuss"][data-id="${escapedId}"]`)?.forEach((btn) => {
      btn.classList?.remove('has-comments');
      btn.textContent = 'Discuss';
    });
    const reviewBtn = document.getElementById('record-review-discuss-btn');
    if (reviewBtn && reviewBtn.dataset?.recordId === recordId) {
      reviewBtn.classList?.remove('has-comments');
      reviewBtn.textContent = 'Discussion';
    }
  }

  const BLOCKED_DISCUSSION_EXT_RE = /\.(exe|msi|bat|cmd|com|pif|scr|vbs|vbe|js|mjs|cjs|jse|wsf|wsh|ps1|psm1|sh|bash|html|htm|xhtml|svg|php|asp|aspx|jsp|jar|dll|sys|drv|reg|hta|cpl)$/i;
  const BLOCKED_DISCUSSION_MIMES = new Set(['text/html', 'application/javascript', 'text/javascript', 'image/svg+xml', 'application/x-msdownload', 'application/x-msdos-program']);
  const MAX_DISCUSSION_FILES = 5;
  const MAX_DISCUSSION_FILE_BYTES = 50 * 1024 * 1024;

  function classifyDiscussionFile(file) {
    const name = String(file?.name || 'attachment').trim() || 'attachment';
    const type = String(file?.type || '').trim().toLowerCase();
    if (BLOCKED_DISCUSSION_EXT_RE.test(name) || BLOCKED_DISCUSSION_MIMES.has(type)) {
      throw new Error(`"${name}" cannot be attached for security reasons.`);
    }
    if (Number(file?.size || 0) > MAX_DISCUSSION_FILE_BYTES) {
      throw new Error(`"${name}" exceeds the 50 MB size limit.`);
    }
    const isVideo = type.startsWith('video/') || VIDEO_FILE_RE.test(name);
    const isImage = type.startsWith('image/') || PICTURE_FILE_RE.test(name);
    return {
      name: name.slice(0, 120),
      type: type.slice(0, 120),
      size: Math.max(0, Math.round(Number(file?.size || 0))),
      kind: isVideo ? 'video' : (isImage ? 'image' : 'file')
    };
  }

  function formatAttachmentBytes(bytes) {
    const size = Number(bytes || 0);
    if (!Number.isFinite(size) || size <= 0) return '';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function discussionFileBadge(name, mimeType) {
    const match = /\.([a-z0-9]{1,6})$/i.exec(String(name || '').trim());
    if (match) return match[1].toUpperCase();
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('pdf')) return 'PDF';
    if (mime.startsWith('audio/')) return 'AUDIO';
    if (mime.startsWith('video/')) return 'VIDEO';
    if (mime.startsWith('image/')) return 'IMG';
    return 'FILE';
  }

  let activeThreadCleanup = null;
  async function openRecordDiscussion(recordType, recordId, { onUpdated = null } = {}) {
    const dialog = document.getElementById('record-thread-dialog');
    if (!dialog || !recordType || !recordId) return;
    if (typeof activeThreadCleanup === 'function') activeThreadCleanup();

    const summaryBox = document.getElementById('record-thread-summary');
    const messagesEl = document.getElementById('record-thread-messages');
    const form = document.getElementById('record-thread-form');
    const input = document.getElementById('record-thread-input');
    const queuedEl = document.getElementById('record-thread-queued');
    const fileInput = document.getElementById('record-thread-files');
    const attachBtn = document.getElementById('record-thread-attach-btn');
    const readonlyEl = document.getElementById('record-thread-readonly');
    const titleEl = document.getElementById('record-thread-title');
    const subtitleEl = document.getElementById('record-thread-subtitle');

    const typeMeta = recordReviewMeta.types[recordType] || { label: 'Record' };
    if (titleEl) titleEl.textContent = `${typeMeta.label} discussion`;
    if (subtitleEl) subtitleEl.textContent = 'Questions, photos, videos, files, and replies stay attached to this record.';
    if (summaryBox) { summaryBox.innerHTML = ''; summaryBox.hidden = true; }
    if (messagesEl) messagesEl.innerHTML = '<p class="empty-state">Loading discussion…</p>';
    if (form) { form.hidden = true; form.reset(); form.classList?.remove('is-dragover'); }
    if (queuedEl) { queuedEl.innerHTML = ''; queuedEl.hidden = true; }
    if (fileInput) fileInput.value = '';
    if (readonlyEl) readonlyEl.hidden = true;

    let isCancelled = false;
    let markedReadOnOpen = false;
    let didNotifyUpdate = false;
    let currentComments = [];
    const queuedFiles = [];
    const previewUrlsToRevoke = [];
    const signedUrlCache = new Map();

    function renderQueuedFiles() {
      if (!queuedEl) return;
      if (!queuedFiles.length) {
        queuedEl.innerHTML = '';
        queuedEl.hidden = true;
        return;
      }
      queuedEl.hidden = false;
      queuedEl.innerHTML = queuedFiles.map((entry, idx) => {
        const sizeLabel = formatAttachmentBytes(entry.size);
        const badge = discussionFileBadge(entry.name, entry.type);
        const thumbHtml = entry.kind === 'image' && entry.previewUrl
          ? `<img class="record-thread-queued-thumb" src="${escapeHtml(entry.previewUrl)}" alt="" onerror="this.hidden=true">`
          : entry.kind === 'video'
            ? '<span class="record-thread-queued-icon" aria-hidden="true">VIDEO</span>'
            : `<span class="record-thread-queued-icon" aria-hidden="true">${escapeHtml(badge)}</span>`;
        return `<div class="record-thread-queued-item">
          ${thumbHtml}
          <div class="record-thread-queued-meta">
            <strong title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong>
            ${sizeLabel ? `<small>${escapeHtml(sizeLabel)}</small>` : ''}
          </div>
          <button type="button" class="record-thread-queued-remove" data-remove-thread-file="${idx}" aria-label="Remove ${escapeHtml(entry.name)}">×</button>
        </div>`;
      }).join('');
    }

    function queuePickedFiles(fileList) {
      const incoming = [...(fileList || [])];
      if (!incoming.length) return;
      let addedCount = 0;
      for (const file of incoming) {
        if (queuedFiles.length >= MAX_DISCUSSION_FILES) {
          toast(`You can attach up to ${MAX_DISCUSSION_FILES} files per reply.`, 'error');
          break;
        }
        try {
          const meta = classifyDiscussionFile(file);
          const duplicate = queuedFiles.some((item) => item.name === meta.name && item.size === meta.size);
          if (duplicate) continue;
          const previewUrl = typeof URL?.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
          if (previewUrl) previewUrlsToRevoke.push(previewUrl);
          queuedFiles.push({ file, previewUrl, ...meta });
          addedCount += 1;
        } catch (err) {
          toast(friendlyError(err), 'error');
        }
      }
      if (fileInput) fileInput.value = '';
      if (addedCount > 0) renderQueuedFiles();
    }

    function renderAttachmentMarkup(att, authorName, whenLabel) {
      const safeName = escapeHtml(att?.name || 'Attachment');
      const safeUrl = att?.path ? (signedUrlCache.get(att.path) || '') : '';
      const sizeLabel = formatAttachmentBytes(att?.size);
      const badge = escapeHtml(discussionFileBadge(att?.name, att?.type));
      if (!safeUrl) {
        return `<div class="record-thread-att-file is-loading">
          <span class="record-thread-att-badge">${badge}</span>
          <div class="record-thread-att-file-meta"><strong>${safeName}</strong><small>${sizeLabel ? `${escapeHtml(sizeLabel)} · ` : ''}Loading…</small></div>
        </div>`;
      }
      if (att.kind === 'image') {
        const sub = `${authorName || 'Member'}${whenLabel ? ` · ${whenLabel}` : ''}${sizeLabel ? ` · ${sizeLabel}` : ''}`;
        return `<figure class="record-thread-att-photo">
          <button type="button" class="record-thread-att-photo-btn" data-thread-image-url="${escapeHtml(safeUrl)}" data-thread-image-title="${safeName}" data-thread-image-subtitle="${escapeHtml(sub)}" aria-label="View ${safeName} full size">
            <img src="${escapeHtml(safeUrl)}" alt="${safeName}" loading="lazy" onerror="this.closest('.record-thread-att-photo').classList.add('is-fallback');this.hidden=true;">
            <span class="record-thread-att-file is-inline-fallback">
              <span class="record-thread-att-badge">${badge}</span>
              <span class="record-thread-att-file-meta"><strong>${safeName}</strong><small>${escapeHtml(sizeLabel || 'Image file')} · Tap Download</small></span>
            </span>
          </button>
          <figcaption><span>${safeName}</span><a href="${escapeHtml(safeUrl)}" download="${safeName}" target="_blank" rel="noopener">Download</a></figcaption>
        </figure>`;
      }
      if (att.kind === 'video') {
        return `<figure class="record-thread-att-video">
          <video controls playsinline preload="metadata" src="${escapeHtml(safeUrl)}"></video>
          <figcaption><span>${safeName}${sizeLabel ? ` · ${escapeHtml(sizeLabel)}` : ''}</span><a href="${escapeHtml(safeUrl)}" download="${safeName}" target="_blank" rel="noopener">Open</a></figcaption>
        </figure>`;
      }
      return `<a class="record-thread-att-file" href="${escapeHtml(safeUrl)}" download="${safeName}" target="_blank" rel="noopener">
        <span class="record-thread-att-badge">${badge}</span>
        <span class="record-thread-att-file-meta"><strong>${safeName}</strong><small>${escapeHtml(sizeLabel || 'File attachment')} · Open / Download</small></span>
      </a>`;
    }

    function renderMessages() {
      if (!messagesEl) return;
      if (!currentComments.length) {
        messagesEl.innerHTML = '<div class="record-thread-empty"><strong>No replies yet</strong><small>Start a thread here to ask about a blurry receipt, share original photos, videos, or documents, or clarify a reference number.</small></div>';
        return;
      }
      messagesEl.innerHTML = currentComments.map((c) => {
        const own = Boolean(c.is_own || (currentProfile?.id && c.author_id === currentProfile.id));
        const authorName = c.author_name || 'Member';
        const roleLabel = String(c.author_role || 'MEMBER').toLowerCase().replace(/^./, (ch) => ch.toUpperCase());
        const when = dateLabel(c.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const bodyText = String(c.body || '').trim();
        const atts = Array.isArray(c.attachments) ? c.attachments : [];
        return `<article class="record-thread-msg${own ? ' is-own' : ''}">
          <div class="record-thread-msg-avatar">${avatarMarkup(c.author_avatar_url || '', authorName, 'avatar-sm')}</div>
          <div class="record-thread-msg-bubble">
            <header class="record-thread-msg-meta">
              <strong>${escapeHtml(own ? `${c.author_name || 'You'} (You)` : authorName)}</strong>
              <span class="record-thread-role role-${escapeHtml(String(c.author_role || 'MEMBER').toLowerCase())}">${escapeHtml(roleLabel)}</span>
              <time datetime="${escapeHtml(c.created_at || '')}">${escapeHtml(when)}</time>
            </header>
            ${bodyText ? `<p class="record-thread-msg-body">${escapeHtml(bodyText)}</p>` : ''}
            ${atts.length ? `<div class="record-thread-msg-attachments">${atts.map((att) => renderAttachmentMarkup(att, authorName, when)).join('')}</div>` : ''}
          </div>
        </article>`;
      }).join('');
      bindAvatarFallbacks(messagesEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function resolveAttachmentUrls() {
      const missing = currentComments.some((c) =>
        Array.isArray(c.attachments) && c.attachments.some((att) => att?.path && !signedUrlCache.has(att.path))
      );
      if (!missing) return;
      try {
        const { urls = {} } = await invokeAccountFunction({
          action: 'record-comment-view-urls',
          record_type: recordType,
          record_id: recordId
        });
        if (isCancelled) return;
        Object.entries(urls).forEach(([path, url]) => {
          if (path && url) signedUrlCache.set(path, url);
        });
        renderMessages();
      } catch { /* leave loading state unobtrusive if transient */ }
    }

    async function loadThread() {
      const payload = await rpc('get_record_comments', { p_record_type: recordType, p_record_id: recordId });
      if (isCancelled) return;
      if (payload?.record) {
        renderRecordSummaryInto(summaryBox, payload.record, { showDiscussAction: false });
      }
      currentComments = Array.isArray(payload?.comments) ? payload.comments : [];
      renderMessages();
      clearDiscussionUnreadBadge(recordId);
      if (currentComments.length) markedReadOnOpen = true;
      resolveAttachmentUrls().catch(() => {});
      const canReply = Boolean(payload?.can_reply);
      if (form) form.hidden = !canReply;
      if (readonlyEl) readonlyEl.hidden = canReply;
      if (canReply && input) input.focus();
    }

    const client = getClient();
    const channel = client
      ? client.channel(`record-thread-${recordType}-${recordId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'record_comments',
          filter: `record_id=eq.${recordId}`
        }, () => {
          loadThread().then(() => {
            if (typeof onUpdated === 'function') {
              didNotifyUpdate = true;
              onUpdated();
            }
          }).catch(() => {});
        })
        .subscribe()
      : null;

    const closeBtnList = [...dialog.querySelectorAll('[data-record-thread-close]')];
    const onCloseClick = () => dialog.close();
    closeBtnList.forEach((btn) => btn.addEventListener('click', onCloseClick));
    const onBackdropClick = (event) => { if (event.target === dialog) dialog.close(); };
    dialog.addEventListener('click', onBackdropClick);

    const onMessagesClick = (event) => {
      const photoBtn = event.target.closest?.('[data-thread-image-url]');
      if (!photoBtn) return;
      const src = photoBtn.getAttribute('data-thread-image-url') || '';
      const img = photoBtn.querySelector?.('img');
      if (img?.hidden) return;
      const title = photoBtn.getAttribute('data-thread-image-title') || 'Attachment';
      const subtitle = photoBtn.getAttribute('data-thread-image-subtitle') || '';
      openImageViewer(src, title, subtitle, title);
    };
    messagesEl?.addEventListener('click', onMessagesClick);

    const onAttachClick = () => fileInput?.click();
    attachBtn?.addEventListener('click', onAttachClick);
    const onFileChange = () => queuePickedFiles(fileInput?.files);
    fileInput?.addEventListener('change', onFileChange);

    const onQueuedClick = (event) => {
      const btn = event.target.closest?.('[data-remove-thread-file]');
      if (!btn) return;
      const idx = Number(btn.getAttribute('data-remove-thread-file'));
      if (Number.isInteger(idx) && idx >= 0 && idx < queuedFiles.length) {
        queuedFiles.splice(idx, 1);
        renderQueuedFiles();
      }
    };
    queuedEl?.addEventListener('click', onQueuedClick);

    const onPaste = (event) => {
      const files = [...(event.clipboardData?.files || [])];
      if (files.length) {
        event.preventDefault();
        queuePickedFiles(files);
      }
    };
    input?.addEventListener('paste', onPaste);

    const onDragOver = (event) => {
      if (!event.dataTransfer?.types?.includes?.('Files')) return;
      event.preventDefault();
      form?.classList?.add('is-dragover');
    };
    const onDragLeave = () => form?.classList?.remove('is-dragover');
    const onDrop = (event) => {
      form?.classList?.remove('is-dragover');
      if (event.dataTransfer?.files?.length) {
        event.preventDefault();
        queuePickedFiles(event.dataTransfer.files);
      }
    };
    form?.addEventListener('dragover', onDragOver);
    form?.addEventListener('dragleave', onDragLeave);
    form?.addEventListener('drop', onDrop);

    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && form && !form.hidden) {
        event.preventDefault();
        form.requestSubmit();
      }
    };
    input?.addEventListener('keydown', onKeyDown);

    const onSubmit = async (event) => {
      event.preventDefault();
      const body = String(input?.value || '').trim();
      if (!body && !queuedFiles.length) { input?.focus(); return; }
      const submitBtn = form.querySelector('[type="submit"]');
      const pendingUploads = [...queuedFiles];
      const uploadedPaths = [];
      setBusy(submitBtn, true, pendingUploads.length ? 'Uploading…' : 'Sending…');
      try {
        const attachments = [];
        if (pendingUploads.length) {
          const { uploads = [] } = await invokeAccountFunction({
            action: 'record-comment-upload-urls',
            record_type: recordType,
            record_id: recordId,
            files: pendingUploads.map((entry) => ({ name: entry.name, kind: entry.kind, type: entry.type, size: entry.size }))
          });
          for (let i = 0; i < pendingUploads.length; i += 1) {
            const entry = pendingUploads[i];
            const upload = uploads[i];
            if (!upload?.path || !upload?.token) throw new Error('Upload authorization missing.');
            const { error: uploadError } = await client.storage
              .from('record-comments')
              .uploadToSignedUrl(upload.path, upload.token, entry.file, { contentType: entry.file.type || undefined });
            if (uploadError) throw uploadError;
            uploadedPaths.push(upload.path);
            if (entry.previewUrl) signedUrlCache.set(upload.path, entry.previewUrl);
            attachments.push({ path: upload.path, name: upload.name, kind: entry.kind, type: upload.type || entry.file.type || '', size: entry.size });
          }
        }
        const added = await rpc('add_record_comment', {
          p_record_type: recordType,
          p_record_id: recordId,
          p_body: body,
          p_attachments: attachments
        });
        if (input) input.value = '';
        queuedFiles.length = 0;
        renderQueuedFiles();
        if (added && !currentComments.some((c) => c.id === added.id)) {
          currentComments.push(added);
          renderMessages();
        } else {
          await loadThread();
        }
        if (attachments.length) resolveAttachmentUrls().catch(() => {});
        if (typeof onUpdated === 'function') {
          didNotifyUpdate = true;
          onUpdated(currentComments.length);
        }
      } catch (error) {
        if (uploadedPaths.length) {
          invokeAccountFunction({ action: 'record-comment-cleanup-media', paths: uploadedPaths }).catch(() => {});
        }
        toast(friendlyError(error), 'error');
      } finally {
        setBusy(submitBtn, false);
        input?.focus();
      }
    };
    if (form) form.onsubmit = onSubmit;

    const cleanup = () => {
      isCancelled = true;
      closeBtnList.forEach((btn) => btn.removeEventListener('click', onCloseClick));
      dialog.removeEventListener('click', onBackdropClick);
      messagesEl?.removeEventListener('click', onMessagesClick);
      attachBtn?.removeEventListener('click', onAttachClick);
      fileInput?.removeEventListener('change', onFileChange);
      queuedEl?.removeEventListener('click', onQueuedClick);
      input?.removeEventListener('paste', onPaste);
      form?.removeEventListener('dragover', onDragOver);
      form?.removeEventListener('dragleave', onDragLeave);
      form?.removeEventListener('drop', onDrop);
      input?.removeEventListener('keydown', onKeyDown);
      if (form) form.onsubmit = null;
      messagesEl?.querySelectorAll?.('video')?.forEach((video) => video.pause?.());
      previewUrlsToRevoke.forEach((url) => { try { URL.revokeObjectURL(url); } catch {} });
      if (channel && client) client.removeChannel(channel).catch?.(() => {});
      activeThreadCleanup = null;
      if (markedReadOnOpen && !didNotifyUpdate && typeof onUpdated === 'function') {
        didNotifyUpdate = true;
        onUpdated(currentComments.length);
      }
    };
    activeThreadCleanup = cleanup;
    dialog.addEventListener('close', cleanup, { once: true });

    dialog.showModal();
    try {
      await loadThread();
    } catch (error) {
      if (!isCancelled && messagesEl) {
        messagesEl.innerHTML = `<p class="empty-state">${escapeHtml(friendlyError(error))}</p>`;
      }
    }
  }

  document.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest?.('[data-copy-text]');
    if (!copyBtn) return;
    const text = copyBtn.getAttribute('data-copy-text');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied: ${text}`);
    } catch {
      toast('Unable to copy automatically. Select and copy the account details.', 'error');
    }
  });

  function payoutChannelOptionsHtml() {
    return [
      '<option value="">Not set</option>',
      '<option value="GCASH">GCash</option>',
      '<option value="MAYA">Maya</option>',
      '<option value="BANK_TRANSFER">Bank Transfer</option>',
      '<option value="CASH">Cash pickup</option>',
      '<option value="OTHER">Other e-wallet / bank</option>'
    ].join('');
  }

  function payoutFieldsetMarkup(prefix = 'payout') {
    const safePrefix = escapeHtml(String(prefix || 'payout').replace(/[^a-z0-9_-]/gi, ''));
    return `<div class="payout-fieldset">
      <div class="payout-fieldset-head">
        <strong>Payout / cashout account (optional)</strong>
        <small>Where this member receives cashouts, deductions, or rotation payouts.</small>
      </div>
      <div class="payout-fieldset-grid">
        <div class="field">
          <label for="${safePrefix}-payout-channel">Payout channel</label>
          <select id="${safePrefix}-payout-channel" name="payout_channel">${payoutChannelOptionsHtml()}</select>
        </div>
        <div class="field payout-detail-field" hidden>
          <div class="field-label-row">
            <label for="${safePrefix}-payout-number" data-payout-num-label>Account / mobile number</label>
            <button type="button" class="link-action payout-use-mobile-btn" data-payout-use-mobile hidden>Use mobile #</button>
          </div>
          <input id="${safePrefix}-payout-number" name="payout_account_number" maxlength="80" autocomplete="off" placeholder="0917 123 4567">
          <small class="field-error" id="${safePrefix}-payout-number-error" role="alert" hidden></small>
        </div>
        <div class="field payout-detail-field" hidden>
          <label for="${safePrefix}-payout-name" data-payout-name-label>Account name / bank</label>
          <input id="${safePrefix}-payout-name" name="payout_account_name" maxlength="120" autocomplete="off" placeholder="Registered account name">
          <small class="field-error" id="${safePrefix}-payout-name-error" role="alert" hidden></small>
        </div>
      </div>
    </div>`;
  }

  const PAYOUT_NUMBER_REQUIRED_MSG = 'Enter an account or mobile number for this payout channel.';

  function isMobileWalletChannel(channel) {
    const normalized = normalizePaymentMethod(channel) || '';
    return normalized === 'GCASH' || normalized === 'MAYA';
  }

  function syncPayoutFieldUi(container) {
    if (!container) return;
    const channelSel = container.querySelector('select[name="payout_channel"]');
    const numInput = container.querySelector('input[name="payout_account_number"]');
    const nameInput = container.querySelector('input[name="payout_account_name"]');
    const numLabel = container.querySelector('[data-payout-num-label]');
    const nameLabel = container.querySelector('[data-payout-name-label]');
    const useMobileBtn = container.querySelector('[data-payout-use-mobile]');
    const detailFields = container.querySelectorAll('.payout-detail-field');
    if (!channelSel) return;

    const channel = normalizePaymentMethod(channelSel.value) || '';
    const hasChannel = Boolean(channel);
    detailFields.forEach((field) => { field.hidden = !hasChannel; });

    const form = container.closest('form');
    const contactInput = form?.elements?.contact_number;
    const hasContact = Boolean(String(contactInput?.value || '').trim());
    const isMobileWallet = isMobileWalletChannel(channel);

    if (useMobileBtn) {
      useMobileBtn.hidden = !isMobileWallet || !hasContact;
    }

    if (numInput) {
      numInput.inputMode = isMobileWallet ? 'tel' : 'text';
      numInput.maxLength = isMobileWallet ? 13 : 80;
      numInput.title = isMobileWallet ? PHONE_RULE : '';
      if (!isMobileWallet) numInput.setCustomValidity('');
    }

    if (isMobileWallet) {
      if (numLabel) numLabel.textContent = `${channel === 'GCASH' ? 'GCash' : 'Maya'} mobile number`;
      if (numInput) numInput.placeholder = '09171234567';
      if (nameLabel) nameLabel.textContent = 'Registered account name';
      if (nameInput) nameInput.placeholder = 'e.g. Juan Dela Cruz';
    } else if (channel === 'BANK_TRANSFER') {
      if (numLabel) numLabel.textContent = 'Bank & account number';
      if (numInput) numInput.placeholder = 'e.g. BPI · 1234-5678-90';
      if (nameLabel) nameLabel.textContent = 'Account holder name';
      if (nameInput) nameInput.placeholder = 'e.g. Juan Dela Cruz';
    } else if (channel === 'CASH') {
      if (numLabel) numLabel.textContent = 'Pickup note (optional)';
      if (numInput) numInput.placeholder = 'e.g. Cash pickup in person';
      if (nameLabel) nameLabel.textContent = 'Recipient note (optional)';
      if (nameInput) nameInput.placeholder = 'Optional instructions';
    } else if (channel === 'OTHER') {
      if (numLabel) numLabel.textContent = 'Account / wallet details';
      if (numInput) numInput.placeholder = 'e.g. SeaBank 1234-5678-901';
      if (nameLabel) nameLabel.textContent = 'Account holder name';
      if (nameInput) nameInput.placeholder = 'e.g. Juan Dela Cruz';
    }

    if (numInput && !hasChannel) {
      numInput.setCustomValidity('');
      setFieldError(numInput, '');
    }
    if (nameInput && !hasChannel) setFieldError(nameInput, '');
  }

  function mountPayoutFieldsets(root = document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-payout-fields]').forEach((container) => {
      if (!container.dataset.mounted) {
        container.dataset.mounted = 'true';
        container.innerHTML = payoutFieldsetMarkup(container.dataset.prefix || 'payout');
      }
      if (!container.dataset.bound) {
        container.dataset.bound = 'true';
        const channelSel = container.querySelector('select[name="payout_channel"]');
        const numInput = container.querySelector('input[name="payout_account_number"]');
        const nameInput = container.querySelector('input[name="payout_account_name"]');
        const useMobileBtn = container.querySelector('[data-payout-use-mobile]');
        const form = container.closest('form');
        const contactInput = form?.elements?.contact_number;

        channelSel?.addEventListener('change', () => {
          if (numInput) {
            numInput.setCustomValidity('');
            setFieldError(numInput, '');
            if (isMobileWalletChannel(channelSel.value) && /^[+\d\s().-]+$/.test(numInput.value.trim())) {
              sanitizePhoneInput(numInput);
            }
          }
          syncPayoutFieldUi(container);
          if (numInput && isMobileWalletChannel(channelSel.value) && numInput.value.trim()) {
            validateMobileField(numInput, { required: true, requiredMessage: PAYOUT_NUMBER_REQUIRED_MSG, live: true });
          }
          if (channelSel.value && numInput && !numInput.value.trim()) numInput.focus();
        });
        enhancePaymentSelect(channelSel);
        numInput?.addEventListener('input', () => {
          if (isMobileWalletChannel(channelSel?.value)) {
            sanitizePhoneInput(numInput);
            validateMobileField(numInput, { required: true, requiredMessage: PAYOUT_NUMBER_REQUIRED_MSG, live: true });
          } else {
            numInput.setCustomValidity('');
            setFieldError(numInput, '');
          }
        });
        numInput?.addEventListener('blur', () => {
          if (isMobileWalletChannel(channelSel?.value)) {
            validateMobileField(numInput, { required: false, requiredMessage: PAYOUT_NUMBER_REQUIRED_MSG });
          }
        });
        numInput?.addEventListener('invalid', () => {
          if (isMobileWalletChannel(channelSel?.value)) {
            validateMobileField(numInput, { required: true, requiredMessage: PAYOUT_NUMBER_REQUIRED_MSG });
          }
        });
        nameInput?.addEventListener('input', () => setFieldError(nameInput, ''));
        contactInput?.addEventListener('input', () => syncPayoutFieldUi(container));
        useMobileBtn?.addEventListener('click', () => {
          if (!numInput || !contactInput) return;
          const mobile = String(contactInput.value || '').trim();
          if (!mobile) return;
          numInput.value = mobile;
          sanitizePhoneInput(numInput);
          if (isMobileWalletChannel(channelSel?.value)) {
            validateMobileField(numInput, { required: true, requiredMessage: PAYOUT_NUMBER_REQUIRED_MSG });
          } else {
            numInput.setCustomValidity('');
            setFieldError(numInput, '');
          }
          numInput.focus();
        });
      }
      const channelSel = container.querySelector('select[name="payout_channel"]');
      if (channelSel && !channelSel.dataset.customEnhanced) enhancePaymentSelect(channelSel);
      syncPayoutFieldUi(container);
    });
  }

  function setPayoutFields(formOrContainer, record = null) {
    if (!formOrContainer) return;
    const container = formOrContainer.matches?.('[data-payout-fields]')
      ? formOrContainer
      : formOrContainer.querySelector('[data-payout-fields]');
    if (!container) return;
    if (!container.dataset.mounted) mountPayoutFieldsets(container.parentElement || document);
    const channelSel = container.querySelector('select[name="payout_channel"]');
    const numInput = container.querySelector('input[name="payout_account_number"]');
    const nameInput = container.querySelector('input[name="payout_account_name"]');
    const normalizedChannel = normalizePaymentMethod(record?.payout_channel) || '';
    if (channelSel) {
      channelSel.value = normalizedChannel;
      channelSel._customSelect?.sync();
    }
    if (numInput) {
      numInput.value = record?.payout_account_number || '';
      numInput.setCustomValidity('');
      setFieldError(numInput, '');
    }
    if (nameInput) {
      nameInput.value = record?.payout_account_name || '';
      setFieldError(nameInput, '');
    }
    syncPayoutFieldUi(container);
  }

  function validatePayoutFields(formOrContainer) {
    const container = formOrContainer?.matches?.('[data-payout-fields]')
      ? formOrContainer
      : formOrContainer?.querySelector('[data-payout-fields]');
    if (!container) return true;
    const channelSel = container.querySelector('select[name="payout_channel"]');
    const numInput = container.querySelector('input[name="payout_account_number"]');
    if (!channelSel || !numInput) return true;
    const channel = normalizePaymentMethod(channelSel.value) || '';
    const number = String(numInput.value || '').trim();
    if (isMobileWalletChannel(channel)) {
      syncPayoutFieldUi(container);
      if (!validateMobileField(numInput, { required: true, requiredMessage: PAYOUT_NUMBER_REQUIRED_MSG })) {
        numInput.focus();
        return false;
      }
      return true;
    }
    if (channel === 'BANK_TRANSFER' && !number) {
      syncPayoutFieldUi(container);
      numInput.setCustomValidity(PAYOUT_NUMBER_REQUIRED_MSG);
      setFieldError(numInput, PAYOUT_NUMBER_REQUIRED_MSG);
      numInput.focus();
      return false;
    }
    numInput.setCustomValidity('');
    setFieldError(numInput, '');
    return true;
  }

  function readPayoutPayload(formOrContainer) {
    const container = formOrContainer?.matches?.('[data-payout-fields]')
      ? formOrContainer
      : formOrContainer?.querySelector('[data-payout-fields]');
    if (!container) {
      return { p_payout_channel: null, p_payout_account_number: null, p_payout_account_name: null };
    }
    const channel = normalizePaymentMethod(container.querySelector('select[name="payout_channel"]')?.value) || null;
    if (!channel) {
      return { p_payout_channel: null, p_payout_account_number: null, p_payout_account_name: null };
    }
    const number = String(container.querySelector('input[name="payout_account_number"]')?.value || '').trim() || null;
    const name = String(container.querySelector('input[name="payout_account_name"]')?.value || '').trim() || null;
    return {
      p_payout_channel: channel,
      p_payout_account_number: number,
      p_payout_account_name: name
    };
  }

  function payoutSummaryChip(record, { compact = false, showCopy = true, emptyText = '' } = {}) {
    const channel = normalizePaymentMethod(record?.payout_channel);
    const number = String(record?.payout_account_number || '').trim();
    const accountName = String(record?.payout_account_name || '').trim();
    if (!channel && !number && !accountName) {
      return emptyText ? `<span class="field-help">${escapeHtml(emptyText)}</span>` : '';
    }
    const meta = paymentMethodMeta(channel || 'OTHER');
    const copyValue = number || accountName;
    const detailParts = [];
    if (number) detailParts.push(`<strong class="payout-chip-number">${escapeHtml(number)}</strong>`);
    if (accountName) detailParts.push(`<small class="payout-chip-name">${escapeHtml(accountName)}</small>`);
    if (!detailParts.length) detailParts.push(`<small class="payout-chip-name">${escapeHtml(channel === 'CASH' ? 'Cash pickup' : meta.label)}</small>`);
    const copyBtn = showCopy && copyValue
      ? `<button type="button" class="icon-action payout-copy-btn" data-copy-text="${escapeHtml(copyValue)}" aria-label="Copy payout account number" title="Copy ${escapeHtml(copyValue)}">Copy</button>`
      : '';
    return `<div class="payout-chip${compact ? ' is-compact' : ''}">${paymentMethodBadge(meta.value)}<span class="payout-chip-detail">${detailParts.join('')}</span>${copyBtn}</div>`;
  }

  function renderPayoutDestinationBox(container, member, { autoSyncMethodForm = null } = {}) {
    if (!container) return;
    if (!member) {
      container.hidden = true;
      container.innerHTML = '';
      return;
    }
    const channel = normalizePaymentMethod(member.payout_channel);
    const hasInfo = Boolean(channel || member.payout_account_number || member.payout_account_name);
    container.hidden = false;
    container.classList.toggle('is-empty', !hasInfo);
    if (hasInfo) {
      container.innerHTML = `<div class="payout-dest-head"><span class="payout-dest-eyebrow">Send cashout to</span><small>${escapeHtml(member.full_name || 'Member')}</small></div>${payoutSummaryChip(member, { showCopy: true })}`;
      if (autoSyncMethodForm && channel) setPaymentMethod(autoSyncMethodForm, channel);
    } else {
      container.innerHTML = `<div class="payout-dest-empty"><strong>No saved payout account for ${escapeHtml(member.full_name || 'this member')}</strong><small>They can add GCash, Maya, or bank details in My Account (or select Cash pickup).</small></div>`;
    }
  }

  function computeContributionExcess({ amount = 0, statusRow = null, fallbackMonthlyAmount = 0 } = {}) {
    const cleanAmount = Math.round(Number(amount || 0) * 100);
    if (!(cleanAmount > 0)) return { show: false, excess: 0, remainingDue: 0 };
    if (statusRow) {
      const due = Math.round(Math.max(Number(statusRow.outstanding_amount || 0), 0) * 100);
      const req = Math.round(Math.max(Number(statusRow.required_amount || 0), 0) * 100);
      if (due > 0) {
        return cleanAmount > due
          ? { show: true, excess: (cleanAmount - due) / 100, remainingDue: due / 100 }
          : { show: false, excess: 0, remainingDue: due / 100 };
      }
      if (due === 0 && (req > 0 || Boolean(statusRow.is_exempt))) {
        return { show: true, excess: cleanAmount / 100, remainingDue: 0 };
      }
      return { show: false, excess: 0, remainingDue: 0 };
    }
    const pledge = Math.round(Math.max(Number(fallbackMonthlyAmount || 0), 0) * 100);
    if (pledge > 0 && cleanAmount > pledge) {
      return { show: true, excess: (cleanAmount - pledge) / 100, remainingDue: pledge / 100 };
    }
    return { show: false, excess: 0, remainingDue: pledge / 100 };
  }

  function bindExcessContributionToggle({ amountInput, checkbox, field = null, getContext, onSync = null } = {}) {
    const wrapper = field || checkbox?.closest?.('.field');
    if (!amountInput || !checkbox || !wrapper) return async () => ({ show: false, excess: 0, remainingDue: 0 });
    wrapper.classList?.add('excess-carryover-field');
    const labelSpan = checkbox.closest?.('label')?.querySelector?.('span') || checkbox.closest?.('label');
    let hintEl = wrapper.querySelector?.('.excess-carryover-meta');
    if (!hintEl && labelSpan?.appendChild) {
      hintEl = document.createElement('small');
      hintEl.className = 'excess-carryover-meta';
      hintEl.hidden = true;
      labelSpan.appendChild(hintEl);
    }
    let syncToken = 0;
    const sync = async () => {
      const token = ++syncToken;
      let ctx = {};
      try {
        ctx = typeof getContext === 'function' ? (await getContext()) || {} : {};
      } catch {
        ctx = {};
      }
      if (token !== syncToken) return { show: false, excess: 0, remainingDue: 0 };
      const state = computeContributionExcess({
        amount: amountInput.value,
        statusRow: ctx.statusRow || null,
        fallbackMonthlyAmount: ctx.fallbackMonthlyAmount || 0
      });
      wrapper.hidden = !state.show;
      wrapper.classList?.toggle?.('is-visible', state.show);
      if (!state.show) {
        checkbox.checked = false;
        if (hintEl) {
          hintEl.hidden = true;
          hintEl.textContent = '';
        }
      } else if (hintEl) {
        hintEl.hidden = false;
        hintEl.textContent = state.remainingDue > 0
          ? `${money(state.excess)} excess above ${money(state.remainingDue)} due`
          : `${money(state.excess)} excess (month already covered)`;
      }
      if (typeof onSync === 'function') onSync(state);
      return state;
    };
    amountInput.addEventListener('input', () => { sync().catch(() => {}); });
    amountInput.addEventListener('change', () => { sync().catch(() => {}); });
    wrapper.hidden = true;
    return sync;
  }

  document.addEventListener('click', async (event) => {
    const copyBtn = event.target.closest?.('[data-copy-text]');
    if (!copyBtn) return;
    const text = copyBtn.getAttribute('data-copy-text');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied: ${text}`);
    } catch {
      toast('Unable to copy automatically. Select and copy the account details.', 'error');
    }
  });

  if (document.body.dataset.page && !document.body.classList.contains('security-page')) mountShell();
  if (document.body.dataset.page) initPullToRefresh();
  initConnectivityBanner();
  initInfoTips();
  prepareFormValidation();
  prepareNumericInputs();
  mountPaymentMethodPickers(document);
  mountPayoutFieldsets(document);
  mountCategoryControls(document);
  preparePesoInputs(document);
  mountThemeControls(document);
  initAppUpdateChecker();

  window.Ipon = {
    get client() { return getClient(); }, configured, init, rpc, money, dateLabel, isoDate, monthStart,
    escapeHtml, initials, avatarMarkup, bindAvatarFallbacks, prepareAvatarDataUrl, prepareImageDataUrl, openImageViewer, bindReceiptPicker, openAvatarCropper, openAccountDialog, normalizeNamePart, validNamePart, validFullName, nameValidationError, fullNameValidationError, nameRuleForField, NAME_RULE, validateNameInput, validateNameFields, prepareNameInputs, syncProfileNameMode, prepareInviteNameInput, validPhoneNumber, validatePhoneInput, prepareNumericInputs, preparePesoInputs, validateNumericInput, MAX_MONEY_AMOUNT, parseMoneyAmount, validateMoneyInput, guardMoneyInput, setFieldError, getValidationMessage, profileNeedsSetup, accountSetupUrl, passwordIssue, bindPasswordStrength, generateTemporaryPassword, autofillTemporaryPassword, prepareTemporaryPassword, mfaSettingsMarkup, bindMfaSettings, requiresMfaChallenge, changePassword, homeForRole, signOut, toast, broadcastAuthEvent, friendlyError, showInlineError, setBusy, setLoading, confirmAction, requestRecordAction, showGroupRequiredDialog, renderGroupRequiredCard, inviteAccount, notifyAdminRequestDecision, sendAdminRequestVerificationCode, verifyAdminRequestVerificationCode, submitAdminRequest, unblockAdminRequest, showInviteSummary, switchActiveGroup, remindUnpaidMembers, bindAnnouncements, subscribeToChanges, isUserOnline, onlineUserIds, syncPresenceDots, getGeminiApiKey, getGeminiModel, callGemini, invokeAccountFunction, notifyAccountStatusChange, withTimeout, registerMemberAvatars, getMemberAvatar, enhanceMemberSelect, enhancePaymentSelect, populateGroupSelect,
    getTheme, setTheme, toggleTheme, isDarkTheme, chartThemeOptions, mountThemeControls,
    PAYMENT_METHODS, normalizePaymentMethod, guessPaymentMethodFromLabel, paymentMethodMeta, paymentMethodIconHtml, paymentMethodBadge, paymentMethodPickerHtml, mountPaymentMethodPickers, setPaymentMethod, paymentMethodOptionsHtml,
    CATEGORY_PRESETS, mountCategoryControls, setCategoryPresetGroup, syncCategoryControl,
    payoutChannelOptionsHtml, payoutFieldsetMarkup, mountPayoutFieldsets, setPayoutFields, validatePayoutFields, readPayoutPayload, payoutSummaryChip, renderPayoutDestinationBox,
    computeContributionExcess, bindExcessContributionToggle,
    getRecordCommentCounts, recordDiscussionButtonHtml, openRecordDiscussion,
    checkForAppUpdate, showAppUpdatePrompt, triggerManualRefresh,
    getDeviceNotificationPermission, requestDeviceNotificationPermission, bindDeviceNotificationControls, setNotificationPreference,
    get profile() { return currentProfile; }
  };
})();
