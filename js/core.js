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
    ['activity', 'super-admin.html#activity', 'Platform activity', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-7 4h8m-8 4h8m-8 4h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1 2-2V5a2 2 0 0 1 2-2Z"/></svg>']
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
      <dialog class="account-dialog" id="account-dialog" aria-labelledby="quick-account-title">
        <div class="account-dialog-sheet">
          <header class="account-dialog-header"><div class="account-dialog-title"><div><h2 id="quick-account-title">My account</h2><p>Manage your account settings and preferences.</p></div></div><button class="dialog-close" data-account-close type="button" aria-label="Close account settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
          <div class="account-dialog-content">
            <section class="account-card account-profile-card"><div class="account-profile-identity"><div class="account-avatar-picker"><label class="account-avatar-trigger" for="quick-avatar-input" role="button" tabindex="0" title="Change profile picture" aria-label="Change profile picture"><span class="account-avatar-preview" id="quick-avatar-preview" aria-hidden="true"></span><span class="account-avatar-cam" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></label><button class="account-avatar-remove" id="quick-avatar-remove" type="button" title="Remove photo" aria-label="Remove profile picture" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><input id="quick-avatar-input" type="file" accept="image/*" hidden></div><span><strong id="quick-account-name">Account</strong><small id="quick-account-role">ROLE</small></span></div><form id="quick-profile-form" class="form-grid form-grid-3"><div class="field"><label for="quick-first-name">First name</label><input id="quick-first-name" name="first_name" maxlength="80" required></div><div class="field"><label for="quick-middle-name">Middle name (optional)</label><input id="quick-middle-name" name="middle_name" maxlength="80"></div><div class="field"><label for="quick-last-name">Last name</label><input id="quick-last-name" name="last_name" maxlength="80" required></div><div class="field field-wide"><label for="quick-contact">Mobile number</label><input id="quick-contact" name="contact_number" type="tel" inputmode="tel" autocomplete="tel" maxlength="13" pattern="(?:09[0-9]{9}|\+639[0-9]{9})" aria-describedby="quick-contact-help quick-contact-error" required><small class="field-help" id="quick-contact-help">Use 09XXXXXXXXX or +639XXXXXXXXX.</small><small class="field-error" id="quick-contact-error" role="alert" hidden></small></div><div class="field field-wide" data-payout-fields data-prefix="quick"></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Save changes</button></div></form><div class="account-support" data-role="ADMIN,TREASURER,MEMBER"><div class="account-support-row"><span><strong>Support myIPON</strong><small>Optional donations help maintain and improve the system.</small></span><button class="button button-secondary" data-donate-open type="button">Donate me</button></div><div class="account-support-row"><span><strong>Have an idea?</strong><small>Suggest an improvement for the system.</small></span><button class="button button-secondary" data-feature-request-open type="button">Request a feature</button></div><div class="account-support-row"><span><strong>Encounter a problem, error, or bug?</strong><small>Report an issue with screenshots for review.</small></span><button class="button button-secondary" data-bug-report-open type="button">Report a bug</button></div></div></section>
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
    syncShellRoleVisibility(effectiveRole);
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
      if (currentProfile) currentProfile.notifications_enabled = data.notifications_enabled !== false;
      document.getElementById('quick-notifications-enabled').checked = data.notifications_enabled !== false;
      document.getElementById('quick-account-name').textContent = data.full_name;
      document.getElementById('quick-account-role').textContent = currentProfile.role === 'SUPER_ADMIN' ? 'Owner' : (data.email || 'My account');
      syncProfileAvatars({ ...currentProfile, ...data });
      const support = dialog.querySelector('.account-support');
      if (support) support.hidden = currentProfile.role === 'SUPER_ADMIN';
      quickProfileDirty?.reset();
      quickEmailDirty?.reset();
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
          const uploadedUrl = await uploadMediaDataUrl(croppedDataUrl, { category: 'avatars', name: 'avatar.jpg' });
          if (typeof onSave === 'function') {
            await onSave(uploadedUrl);
          } else {
            await rpc('update_own_avatar', { p_avatar_url: uploadedUrl });
            currentProfile.avatar_url = uploadedUrl;
            syncProfileAvatars(currentProfile);
            window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: currentProfile }));
            toast('Profile picture updated.');
          }
          cleanup();
          dialog.close();
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

  let quickProfileDirty = null;
  let quickEmailDirty = null;

  function bindAccountDialog() {
    const profileForm = document.getElementById('quick-profile-form');
    if (!profileForm || profileForm.dataset.bound) return;
    profileForm.dataset.bound = 'true';
    syncProfileNameMode(profileForm, currentProfile?.role === 'SUPER_ADMIN');
    const emailForm = document.getElementById('quick-email-form');
    quickProfileDirty = bindDirtySaveForm(profileForm, profileForm.querySelector('[type="submit"]'));
    quickEmailDirty = bindDirtySaveForm(emailForm, emailForm?.querySelector('[type="submit"]'));
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
          if (currentProfile?.notifications_enabled !== false) {
            addExtra('Test alert', { 'data-device-test-btn': '' });
          }
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
        if (currentProfile?.notifications_enabled !== false) {
          addExtra('Test alert', { 'data-device-test-btn': '' });
        }
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
        return `<article class="notification-item${item.read_at ? '' : ' is-unread'}" data-notification-id="${item.id}"${safeTarget ? ` data-nav-target="${escapeHtml(safeTarget)}"` : ''}>
          <span class="notification-item-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="${iconPath}"/></svg>
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
        .select('id,full_name,first_name,middle_name,last_name,contact_number,role,status,member_id,group_id,avatar_url,name_setup_required,notifications_enabled,username,bio,chat_privacy,last_seen_at,policy_accepted_version,policy_accepted_at')
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
      profile.permissions = defaultPermissionsForRole(profile.role);
      if (profile.role !== 'SUPER_ADMIN' && profile.group_id && profile.status === 'ACTIVE') {
        try {
          const permRes = await withTimeout(client.rpc('get_my_member_permissions'), 5000);
          if (!permRes?.error && permRes?.data) {
            profile.permissions = normalizePermissions(permRes.data, profile.role);
          }
        } catch (_) { }
      }
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
      const sidebarUser = document.getElementById('sidebar-user');
      if (sidebarUser) sidebarUser.innerHTML = `<strong>${escapeHtml(profile.full_name)}</strong><small>${escapeHtml(profile.role === 'SUPER_ADMIN' ? 'Owner' : 'My account')}</small>`;
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
        const shownConsent = !options.skipPolicyConsent && !setupUrl
          ? maybeShowPolicyConsentModal(profile, {
            onAccept: () => {
              if (!options.skipBackgroundPrompt) maybePromptBackgroundUsage(profile).catch(() => { });
              maybeResumePendingJoin(profile);
            }
          })
          : false;
        if (!shownConsent) {
          if (!options.skipBackgroundPrompt) {
            maybePromptBackgroundUsage(profile).catch(() => { });
          }
          if (!options.skipRetentionReminder) {
            maybeShowRetentionReminder(profile);
          }
          maybeResumePendingJoin(profile);
        }
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
    if (!READ_ONLY_RPC_RE.test(String(name || ''))) {
      notifyLiveSync('data');
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
            <span class="announcement-release-badge">
              <svg viewBox="0 0 24 24" aria-hidden="true" class="release-star-icon"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg>
              Release update
            </span>
            ${item.release_version ? `<span class="announcement-version-chip">${escapeHtml(item.release_version)}</span>` : ''}
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
      viewerDialog.addEventListener('close', () => { stopViewerMedia(); openItemId = null; clearDeepLinkUrlState(); });

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
        activeNotificationsReload?.().catch(() => { });
        notifyLiveSync('announcements');
        notifyLiveSync('notifications');
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
            await uploadAuthorizedFile(client, 'announcements', upload, entry.file);
            uploadedPaths.push(upload.path);
            attachments.push({ path: upload.path, name: upload.name, kind: entry.kind, type: entry.type || entry.file.type || '' });
          }
        }
        await rpc('create_announcement', {
          p_id: announcementId,
          p_title: title,
          p_description: description,
          p_attachments: attachments,
          p_announcement_type: 'GENERAL',
          p_release_version: null
        });
        composeDialog.close();
        composeForm.reset();
        clearQueuedMedia();
        await load();
        notifyLiveSync('announcements');
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

    const normReleaseVer = (v) => String(v || '').trim().replace(/^v/i, '').toLowerCase();
    const openMatching = async ({ id = '', releaseVersion = '', title = '' } = {}) => {
      const client = getClient();
      if (!items.length) await load();
      let found = null;
      if (id) {
        found = items.find((entry) => String(entry.id) === String(id)) || null;
        if (!found && client) {
          const { data } = await client.from('v_announcements').select('*').eq('id', id).maybeSingle();
          if (data) {
            found = data;
            items = [data, ...items];
            renderList();
          }
        }
      } else if (releaseVersion) {
        const want = normReleaseVer(releaseVersion);
        const matchRelease = (list) => {
          if (!list.length) return null;
          if (!want || want === 'latest') {
            return list.find((entry) => entry.announcement_type === 'RELEASE') || null;
          }
          return list.find((entry) =>
            entry.announcement_type === 'RELEASE'
            && (
              normReleaseVer(entry.release_version) === want
              || normReleaseVer(entry.title).startsWith(want)
              || String(entry.title || '').toLowerCase().includes(want)
            )
          ) || list.find((entry) => entry.announcement_type === 'RELEASE') || null;
        };
        found = matchRelease(items);
        if (!found && client) {
          const { data } = await client
            .from('v_announcements')
            .select('*')
            .eq('announcement_type', 'RELEASE')
            .order('created_at', { ascending: false })
            .limit(25);
          found = matchRelease(data || []);
          if (found && !items.some((entry) => entry.id === found.id)) {
            items = [found, ...items];
            renderList();
          }
        }
      } else if (title) {
        const q = String(title || '').trim().toLowerCase();
        found = items.find((entry) => String(entry.title || '').trim().toLowerCase() === q)
          || items.find((entry) => String(entry.title || '').trim().toLowerCase().includes(q))
          || null;
      }

      if (found) {
        await openViewer(found);
        return true;
      }
      if (releaseVersion) {
        await openNoticeDetailModal({
          id: 'system-app-release-notice',
          type: 'RELEASE',
          title: releaseVersion === 'latest' ? 'App update available' : `Update available: Version ${releaseVersion}`,
          message: `Version ${releaseVersion === 'latest' ? 'latest' : releaseVersion} includes the newest platform improvements and fixes. Check Announcements for full release notes.`
        });
        return true;
      }
      return false;
    };

    const controller = {
      load,
      openMatching,
      clear: () => { items = []; reactions = []; renderList(); }
    };
    activeAnnouncementsController = controller;
    return controller;
  }

  const LIVE_SYNC_CHANNEL = 'ipon-live-sync';
  function notifyLiveSync(topic = 'data') {
    try {
      if ('BroadcastChannel' in window) {
        const bc = new BroadcastChannel(LIVE_SYNC_CHANNEL);
        bc.postMessage({ topic, at: Date.now() });
        bc.close();
      }
    } catch { }
  }

  let rtChannelNonce = 0;

  function createRealtimeChannel(baseTopic, options = undefined, clientArg = null) {
    const client = clientArg || getClient();
    if (!client?.channel) return null;
    const targetTopic = `realtime:${baseTopic}`;
    const channels = typeof client.getChannels === 'function' ? client.getChannels() : [];
    const existing = Array.isArray(channels)
      ? channels.filter((ch) => ch?.topic === targetTopic)
      : [];
    if (existing.length) {
      existing.forEach((ch) => {
        try { client.removeChannel?.(ch)?.catch?.(() => { }); } catch { }
      });
      const uniqueTopic = `${baseTopic}:${++rtChannelNonce}`;
      return options === undefined ? client.channel(uniqueTopic) : client.channel(uniqueTopic, options);
    }
    return options === undefined ? client.channel(baseTopic) : client.channel(baseTopic, options);
  }

  function subscribeToChanges(name, tables, refresh) {
    const client = getClient();
    if (!client || !tables.length) return null;
    let timer;
    let dirty = false;
    let pending = Promise.resolve();
    const run = () => {
      dirty = false;
      pending = pending.then(refresh).catch((error) => toast(friendlyError(error), 'error'));
      return pending;
    };
    activeLiveRefresh = run;
    const schedule = (delayMs = 350) => {
      dirty = true;
      clearTimeout(timer);
      timer = setTimeout(() => { if (document.visibilityState === 'visible') run(); }, delayMs);
    };
    let channel = createRealtimeChannel(`live:${name}:${currentProfile?.id || 'session'}`, undefined, client);
    tables.forEach((table) => ['INSERT', 'UPDATE'].forEach((event) => {
      channel = channel.on('postgres_changes', { event, schema: 'public', table }, () => schedule(350));
    }));
    channel.subscribe((status) => {
      if ((status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') && navigator.onLine !== false) {
        schedule(1500);
      }
    });
    const resume = () => {
      if (document.visibilityState === 'visible') {
        schedule(dirty ? 0 : 120);
      }
    };
    let liveSyncBc = null;
    try {
      if ('BroadcastChannel' in window) {
        liveSyncBc = new BroadcastChannel(LIVE_SYNC_CHANNEL);
        liveSyncBc.onmessage = () => {
          dirty = true;
          resume();
        };
      }
    } catch { }
    const autoSyncTimer = setInterval(() => {
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      if (document.querySelector('dialog[open]')) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      run();
    }, 20000);
    document.addEventListener('visibilitychange', resume);
    document.addEventListener('resume', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('resume', resume);
    window.addEventListener('pagehide', () => {
      clearTimeout(timer);
      clearInterval(autoSyncTimer);
      if (activeLiveRefresh === run) activeLiveRefresh = null;
      try { liveSyncBc?.close?.(); } catch { }
      document.removeEventListener('visibilitychange', resume);
      document.removeEventListener('resume', resume);
      window.removeEventListener('focus', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('resume', resume);
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

  function defaultPermissionsForRole(role = currentProfile?.role || 'MEMBER') {
    const r = String(role || 'MEMBER').toUpperCase();
    if (r === 'ADMIN') {
      return {
        role: 'ADMIN',
        can_edit_own_entries: true,
        require_edit_approval: false,
        require_add_approval: false,
        can_record_expenses: true,
        require_expense_approval: false,
        can_record_withdrawals: true,
        require_withdrawal_approval: false
      };
    }
    if (r === 'TREASURER') {
      return {
        role: 'TREASURER',
        can_edit_own_entries: true,
        require_edit_approval: true,
        require_add_approval: true,
        can_record_expenses: true,
        require_expense_approval: true,
        can_record_withdrawals: true,
        require_withdrawal_approval: true
      };
    }
    return {
      role: 'MEMBER',
      can_edit_own_entries: true,
      require_edit_approval: true,
      require_add_approval: true,
      can_record_expenses: false,
      require_expense_approval: true,
      can_record_withdrawals: false,
      require_withdrawal_approval: true
    };
  }

  function normalizePermissions(raw, fallbackRole = 'MEMBER') {
    const base = defaultPermissionsForRole(raw?.role || fallbackRole);
    if (!raw || typeof raw !== 'object') return base;
    return {
      role: raw.role || base.role,
      can_edit_own_entries: raw.can_edit_own_entries !== undefined ? Boolean(raw.can_edit_own_entries) : base.can_edit_own_entries,
      require_edit_approval: raw.require_edit_approval !== undefined ? Boolean(raw.require_edit_approval) : base.require_edit_approval,
      require_add_approval: raw.require_add_approval !== undefined ? Boolean(raw.require_add_approval) : base.require_add_approval,
      can_record_expenses: raw.can_record_expenses !== undefined ? Boolean(raw.can_record_expenses) : base.can_record_expenses,
      require_expense_approval: raw.require_expense_approval !== undefined ? Boolean(raw.require_expense_approval) : base.require_expense_approval,
      can_record_withdrawals: raw.can_record_withdrawals !== undefined ? Boolean(raw.can_record_withdrawals) : base.can_record_withdrawals,
      require_withdrawal_approval: raw.require_withdrawal_approval !== undefined ? Boolean(raw.require_withdrawal_approval) : base.require_withdrawal_approval
    };
  }

  async function refreshMyPermissions() {
    if (!currentProfile || currentProfile.role === 'SUPER_ADMIN' || !currentProfile.group_id) {
      const fallback = defaultPermissionsForRole(currentProfile?.role || 'MEMBER');
      if (currentProfile) currentProfile.permissions = fallback;
      return fallback;
    }
    try {
      const data = await rpc('get_my_member_permissions');
      const normalized = normalizePermissions(data, currentProfile.role);
      currentProfile.permissions = normalized;
      return normalized;
    } catch {
      const fallback = currentProfile.permissions || defaultPermissionsForRole(currentProfile.role);
      currentProfile.permissions = fallback;
      return fallback;
    }
  }

  async function switchActiveGroup(groupId) {
    const result = await rpc('switch_active_group', { p_group_id: groupId });
    clearDeepLinkUrlState();
    if (currentProfile && result) {
      currentProfile.group_id = result.group_id;
      currentProfile.role = result.role;
      currentProfile.member_id = result.member_id ?? null;
      currentProfile.workspace_mode = result.workspace_mode === 'SOLO' ? 'SOLO' : 'GROUP';
      syncWorkspaceMode(currentProfile.workspace_mode);
      await refreshMyPermissions().catch(() => { });
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
    try {
      if (sessionStorage.getItem('myipon_just_logged_in')) sessionStorage.removeItem('myipon_just_logged_in');
    } catch { }
    if (!force) return;
    const isNativeApp = isInstalledAppUser();
    const isMobile = isNativeApp || isMobileAppContext();

    if (!isMobile && !force) return;

    const installedNativeBuild = getInstalledNativeBuild();

    let remoteVersion = null;
    let remoteBuild = 0;
    let remoteNotes = '';
    let updateFound = false;

    // Check raw github version.json only when explicitly forced
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
    } else if (!isNativeApp && force) {
      showAppUpdatePrompt({
        version: 'Mobile App',
        build: 'mobile_app_prompt',
        notes: 'Download the official myIPON Android app (.apk) for the fastest, full-screen savings experience.'
      });
    }
  }

  function initAppUpdateChecker() {
    if (isInstalledAppUser()) {
      document.body.classList.add('is-app');
    }
  }

  function normalizeDownloadFileName(name, fallback = 'attachment') {
    const clean = String(name || '').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').trim();
    return clean || fallback;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Could not read file data.'));
      reader.readAsDataURL(blob);
    });
  }

  async function downloadFile(url, fileName = 'attachment', opts = {}) {
    const raw = String(url || '').trim();
    const isSafe = raw.startsWith('data:') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw);
    if (!raw || !isSafe) throw new Error('Download link unavailable.');
    const safeName = normalizeDownloadFileName(fileName, 'attachment');
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (typeof bgPlugin?.downloadFile === 'function') {
      let payloadUrl = raw;
      let mimeType = String(opts?.mimeType || '').trim();
      if (raw.startsWith('blob:')) {
        const res = await fetch(raw);
        if (!res.ok) throw new Error('Could not read attachment.');
        const blob = await res.blob();
        if (!mimeType && blob.type) mimeType = blob.type;
        payloadUrl = await blobToDataUrl(blob);
      }
      const outcome = await bgPlugin.downloadFile({ url: payloadUrl, fileName: safeName, mimeType });
      if (outcome?.started || outcome?.saved) {
        toast(outcome?.saved ? `Saved ${outcome.fileName || safeName} to Downloads.` : `Downloading ${outcome.fileName || safeName}…`);
        return outcome;
      }
    }
    const triggerAnchor = (href, openBlank = false) => {
      const a = document.createElement('a');
      a.href = href;
      a.download = safeName;
      a.rel = 'noopener';
      if (openBlank) a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      a.remove();
    };
    if (raw.startsWith('data:') || raw.startsWith('blob:')) {
      triggerAnchor(raw, false);
      return { saved: true, fileName: safeName };
    }
    try {
      const res = await fetch(raw, { mode: 'cors' });
      if (!res.ok) throw new Error(`Download failed (${res.status}).`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      triggerAnchor(blobUrl, false);
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { } }, 1500);
      return { saved: true, fileName: safeName };
    } catch {
      triggerAnchor(raw, true);
      return { started: true, fileName: safeName };
    }
  }

  async function downloadCsv(csvText, fileName = 'export.csv') {
    const safeName = normalizeDownloadFileName(fileName, 'export.csv');
    const content = `\uFEFF${String(csvText || '')}`;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (typeof bgPlugin?.downloadFile === 'function') {
      const dataUrl = await blobToDataUrl(blob);
      return await downloadFile(dataUrl, safeName, { mimeType: 'text/csv' });
    }
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await downloadFile(blobUrl, safeName, { mimeType: 'text/csv' });
    } finally {
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { } }, 2000);
    }
  }

  function pdfSafeText(value) {
    return String(value ?? '')
      .replace(/\u20B1/g, 'PHP ')
      .replace(/[\u2013\u2014]/g, '-')
      .replace(/\u2026/g, '...')
      .replace(/\u00B7/g, ' - ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[^\x20-\x7E]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function pdfEscapeLiteral(text) {
    return pdfSafeText(text)
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  function pdfCharWidthRatio(ch) {
    if (ch >= '0' && ch <= '9') return 0.556;
    if (" .,:;|!ilIjtfr'()[]-".includes(ch) || ch === '"') return 0.29;
    if ('MWm@%&'.includes(ch)) return 0.86;
    if (ch >= 'A' && ch <= 'Z') return 0.67;
    return 0.52;
  }

  function pdfTextWidth(text, size = 9, bold = false) {
    const clean = pdfSafeText(text);
    let sum = 0;
    for (let i = 0; i < clean.length; i++) sum += pdfCharWidthRatio(clean[i]);
    return sum * size * (bold ? 1.05 : 1.0);
  }

  function truncatePdfText(text, maxWidth, size = 9, bold = false) {
    const clean = pdfSafeText(text);
    if (!clean || pdfTextWidth(clean, size, bold) <= maxWidth) return clean;
    let lo = 0;
    let hi = clean.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pdfTextWidth(clean.slice(0, mid) + '...', size, bold) <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? clean.slice(0, lo).trimEnd() + '...' : '';
  }

  function wrapPdfToWidth(text, maxWidth, size = 9, bold = false) {
    const clean = pdfSafeText(text);
    if (!clean) return [];
    if (pdfTextWidth(clean, size, bold) <= maxWidth) return [clean];
    const words = clean.split(' ');
    const out = [];
    let line = '';
    for (const w of words) {
      const candidate = line ? line + ' ' + w : w;
      if (pdfTextWidth(candidate, size, bold) <= maxWidth) {
        line = candidate;
      } else if (!line) {
        out.push(truncatePdfText(w, maxWidth, size, bold));
      } else {
        out.push(line);
        line = pdfTextWidth(w, size, bold) <= maxWidth ? w : truncatePdfText(w, maxWidth, size, bold);
      }
    }
    if (line) out.push(line);
    return out;
  }

  function extractCleanNodeText(node) {
    if (!node) return '';
    if (typeof node.childNodes !== 'object' || !node.childNodes?.length) {
      return pdfSafeText(node.textContent || '');
    }
    const skipTags = new Set(['BUTTON', 'SVG', 'SCRIPT', 'STYLE']);
    const parts = [];
    const walk = (cur) => {
      if (!cur) return;
      if (cur.nodeType === 3) {
        const t = pdfSafeText(cur.textContent || '');
        if (t) parts.push(t);
        return;
      }
      if (cur.hidden) return;
      const tag = String(cur.tagName || '').toUpperCase();
      if (skipTags.has(tag)) return;
      const cls = cur.className && typeof cur.className === 'string' ? cur.className : '';
      if (/\b(info-tip-btn|payout-copy-btn|table-actions|wallet-count-error|archive-row-actions)\b/.test(cls)) return;
      if (cur.childNodes?.length) {
        for (const child of cur.childNodes) walk(child);
      } else {
        const t = pdfSafeText(cur.textContent || '');
        if (t) parts.push(t);
      }
    };
    walk(node);
    return pdfSafeText(parts.join(' '));
  }

  function extractPdfCell(cell) {
    if (!cell) return { primary: '', secondary: '' };
    const inputEl = cell.querySelector?.('input');
    if (inputEl) {
      const raw = String(inputEl.value ?? '').trim();
      const num = Number(raw);
      return { primary: raw && Number.isFinite(num) ? pdfSafeText(money(num)) : '-', secondary: '' };
    }
    if (!cell.childNodes?.length) {
      return { primary: pdfSafeText(cell.textContent || ''), secondary: '' };
    }
    const lines = [];
    const pushLine = (txt) => {
      const clean = pdfSafeText(txt);
      if (clean && lines[lines.length - 1] !== clean) lines.push(clean);
    };
    const walkCell = (node) => {
      if (!node || node.hidden) return;
      if (node.nodeType === 3) {
        pushLine(node.textContent || '');
        return;
      }
      const tag = String(node.tagName || '').toUpperCase();
      if (['BUTTON', 'SVG', 'SCRIPT', 'STYLE', 'INPUT'].includes(tag)) return;
      const cls = typeof node.className === 'string' ? node.className : '';
      if (/\b(info-tip-btn|payout-copy-btn|table-actions|wallet-count-error|archive-warn-note)\b/.test(cls)) return;
      if (tag === 'SMALL' || /\b(field-help|payout-meta|payout-line-sub)\b/.test(cls)) {
        const subText = extractCleanNodeText(node);
        if (subText) pushLine(subText);
        return;
      }
      if (['DIV', 'P', 'STRONG', 'SPAN', 'B'].includes(tag) && node.children?.length === 0) {
        pushLine(node.textContent || '');
        return;
      }
      if (['DIV', 'P'].includes(tag)) {
        const blockTxt = extractCleanNodeText(node);
        if (blockTxt) pushLine(blockTxt);
        return;
      }
      if (node.childNodes?.length) {
        for (const ch of node.childNodes) walkCell(ch);
      } else {
        pushLine(node.textContent || '');
      }
    };
    for (const child of cell.childNodes) walkCell(child);
    if (!lines.length) {
      return { primary: extractCleanNodeText(cell) || '-', secondary: '' };
    }
    return {
      primary: lines[0] || '-',
      secondary: lines.slice(1).join(' - ')
    };
  }

  function isNumericPdfCol(headerText, sampleValues) {
    const h = String(headerText || '').toLowerCase();
    if (/amount|in|out|balance|pending|count|variance|additions|deductions|expenses|net|required|confirmed|outstanding/.test(h)) {
      return true;
    }
    return sampleValues.some((v) => /^(?:[+-]?PHP\s|[+-]?[0-9]|-$)/.test(String(v || '').trim()));
  }

  function collectPrintablePdfModel(fallbackTitle) {
    const title = extractCleanNodeText(document.querySelector('.page-header h1')) || pdfSafeText(fallbackTitle || 'Reports');
    const subtitle = extractCleanNodeText(document.querySelector('.page-header p:not(.eyebrow)'));
    const workspaceName = pdfSafeText(
      document.querySelector('#dashboard-group-name, .group-bar-title, .sidebar-user-info small')?.textContent
      || currentProfile?.group_name
      || ''
    );

    const kpis = [...document.querySelectorAll('.stats-grid .stat-card')].map((card) => ({
      label: extractCleanNodeText(card.querySelector?.('span')),
      value: extractCleanNodeText(card.querySelector?.('strong'))
    })).filter((k) => k.label && k.value);

    const walletSummaryWrap = document.getElementById('wallet-summary-cards');
    const walletCards = walletSummaryWrap && !walletSummaryWrap.hidden
      ? [...walletSummaryWrap.querySelectorAll('.wallet-summary-card')].filter((c) => !c.hidden).map((c) => ({
        label: extractCleanNodeText(c.querySelector?.('.wallet-card-label')),
        share: extractCleanNodeText(c.querySelector?.('.wallet-card-top small')),
        value: extractCleanNodeText(c.querySelector?.('strong')),
        meta: extractCleanNodeText(c.querySelector?.('strong + small'))
      })).filter((w) => w.label && w.value)
      : [];

    const sections = [];
    document.querySelectorAll('.panel, .report-panel').forEach((panel) => {
      if (panel.hidden || panel.style?.display === 'none') return;
      const panelHead = panel.querySelector?.('.panel-header');
      const heading = extractCleanNodeText(panel.querySelector?.('.panel-header h2'));
      const sub = pdfSafeText(panelHead?.getAttribute?.('data-print-meta') || '') || extractCleanNodeText(panel.querySelector?.('.panel-header p'));
      const allTrs = [...(panel.querySelectorAll?.('table.data-table tr') || [])].filter((tr) => !tr.hidden);
      const hasTable = allTrs.length > 0;
      const hasCanvasOnly = !hasTable && Boolean(panel.querySelector?.('canvas'));
      if (hasCanvasOnly) return;

      if (hasTable) {
        if (!allTrs.length) return;
        let headers = [];
        const bodyRows = [];
        allTrs.forEach((tr, idx) => {
          const cells = [...(tr.children || [])].filter((c) => {
            const cls = typeof c.className === 'string' ? c.className : '';
            return !/\b(table-actions|row-actions)\b/.test(cls) && !c.querySelector?.('.table-actions');
          });
          if (!cells.length) return;
          const inHead = Boolean(tr.closest?.('thead')) || cells.every((c) => String(c.tagName || '').toUpperCase() === 'TH');
          if (inHead || (idx === 0 && !headers.length && !tr.closest?.('tbody'))) {
            headers = cells.map((c) => extractCleanNodeText(c));
          } else {
            const firstColSpan = Number(cells[0]?.getAttribute?.('colspan') || 0);
            if (cells.length === 1 && firstColSpan > 1) return;
            const parsed = cells.map((c) => extractPdfCell(c));
            const rowCls = typeof tr.className === 'string' ? tr.className : '';
            const isTotal = /\bwallet-total-row\b/.test(rowCls) || /^total$/i.test(parsed[0]?.primary || '');
            bodyRows.push({ cells: parsed, isTotal });
          }
        });
        if (headers.length || bodyRows.length) {
          sections.push({ kind: 'table', title: heading, subtitle: sub, headers, rows: bodyRows });
        }
        return;
      }

      const archiveRows = [...panel.querySelectorAll('.archive-row')].map((row) => ({
        title: extractCleanNodeText(row.querySelector?.('strong')),
        meta: extractCleanNodeText(row.querySelector?.('small'))
      })).filter((r) => r.title);
      if (archiveRows.length) {
        sections.push({ kind: 'list', title: heading, subtitle: sub, items: archiveRows });
      }
    });

    return { title, subtitle, workspaceName, kpis, walletCards, sections };
  }

  function buildStyledPdfBytes(model) {
    const pageW = 612;
    const pageH = 792;
    const marginX = 42;
    const contentW = pageW - marginX * 2; // 528
    const bottomLimit = 52;

    const pages = [[]];
    const pushOp = (op) => pages[pages.length - 1].push(op);
    let y = 758;

    const rgbFill = (r, g, b) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`;
    const rgbStroke = (r, g, b) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`;
    const drawRect = (x, rectY, w, h, fillRgb, strokeRgb = null, lineW = 0.6) => {
      let s = 'q ';
      if (fillRgb) s += rgbFill(...fillRgb) + ' ';
      if (strokeRgb) s += rgbStroke(...strokeRgb) + ` ${lineW} w `;
      s += `${x.toFixed(1)} ${rectY.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re `;
      s += fillRgb && strokeRgb ? 'B' : fillRgb ? 'f' : 'S';
      s += ' Q';
      pushOp(s);
    };
    const drawLine = (x1, y1, x2, y2, strokeRgb, lineW = 0.6) => {
      pushOp(`q ${rgbStroke(...strokeRgb)} ${lineW} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S Q`);
    };
    const drawText = (text, x, textY, { size = 9, bold = false, color = [0.078, 0.176, 0.169] } = {}) => {
      const clean = pdfSafeText(text);
      if (!clean) return;
      const font = bold ? '/F2' : '/F1';
      pushOp(`BT ${rgbFill(...color)} ${font} ${size.toFixed(1)} Tf 1 0 0 1 ${x.toFixed(1)} ${textY.toFixed(1)} Tm (${pdfEscapeLiteral(clean)}) Tj ET`);
    };
    const startNewPage = () => {
      pages.push([]);
      y = 748;
      drawText(model.title + ' (continued)', marginX, y, { size: 9.5, bold: true, color: [0.35, 0.42, 0.39] });
      const dateStr = 'Generated ' + dateLabel(isoDate(), { month: 'short', day: 'numeric', year: 'numeric' });
      drawText(dateStr, marginX + contentW - pdfTextWidth(dateStr, 8.5, false), y, { size: 8.5, color: [0.45, 0.48, 0.46] });
      y -= 8;
      drawLine(marginX, y, marginX + contentW, y, [0.84, 0.67, 0.33], 1.2);
      y -= 16;
    };
    const ensureSpace = (needed) => {
      if (y - needed < bottomLimit) {
        startNewPage();
        return true;
      }
      return false;
    };

    // Header Banner (Forest Emerald + Gold accent)
    const bannerH = 54;
    const bannerY = y - bannerH;
    drawRect(marginX, bannerY, contentW, bannerH, [0.043, 0.204, 0.157]);
    drawRect(marginX, bannerY, contentW, 2.5, [0.835, 0.671, 0.329]);
    drawText('MYIPON FINANCIAL RECORD', marginX + 16, bannerY + 36, { size: 7.5, bold: true, color: [0.91, 0.78, 0.48] });
    drawText(truncatePdfText(model.title, 330, 17, true), marginX + 16, bannerY + 14, { size: 17, bold: true, color: [1, 0.99, 0.96] });

    const rightTop = model.workspaceName ? truncatePdfText(model.workspaceName, 170, 9.5, true) : 'Official Statement';
    const rightBot = 'Generated ' + dateLabel(isoDate(), { month: 'short', day: 'numeric', year: 'numeric' });
    drawText(rightTop, marginX + contentW - 16 - pdfTextWidth(rightTop, 9.5, true), bannerY + 32, { size: 9.5, bold: true, color: [0.96, 0.92, 0.85] });
    drawText(rightBot, marginX + contentW - 16 - pdfTextWidth(rightBot, 8.5, false), bannerY + 16, { size: 8.5, color: [0.80, 0.88, 0.84] });
    y = bannerY - 12;

    if (model.subtitle) {
      wrapPdfToWidth(model.subtitle, contentW, 8.8, false).forEach((ln) => {
        drawText(ln, marginX, y, { size: 8.8, color: [0.35, 0.40, 0.38] });
        y -= 11.5;
      });
      y -= 4;
    }

    // 4-Column Summary KPI Cards
    if (model.kpis.length) {
      const gap = 8;
      const count = model.kpis.length;
      const cardW = (contentW - gap * (count - 1)) / count;
      const cardH = 42;
      ensureSpace(cardH + 10);
      const cardY = y - cardH;
      model.kpis.forEach((kpi, idx) => {
        const cx = marginX + idx * (cardW + gap);
        const isLast = idx === count - 1;
        drawRect(cx, cardY, cardW, cardH, isLast ? [0.92, 0.96, 0.935] : [0.98, 0.965, 0.933], isLast ? [0.68, 0.82, 0.74] : [0.87, 0.84, 0.78], 0.7);
        if (isLast) drawRect(cx, cardY, 2.5, cardH, [0.08, 0.33, 0.24]);
        drawText(truncatePdfText(kpi.label.toUpperCase(), cardW - 16, 7.2, true), cx + 9, cardY + 26, { size: 7.2, bold: true, color: [0.37, 0.40, 0.38] });
        drawText(truncatePdfText(kpi.value, cardW - 16, 11.5, true), cx + 9, cardY + 9, { size: 11.5, bold: true, color: isLast ? [0.043, 0.204, 0.157] : [0.078, 0.176, 0.169] });
      });
      y = cardY - 14;
    }

    // Wallet Summary Strip (optional 2-3 cards)
    if (model.walletCards.length) {
      const gap = 8;
      const count = model.walletCards.length;
      const cardW = (contentW - gap * (count - 1)) / count;
      const cardH = 40;
      ensureSpace(cardH + 10);
      const cardY = y - cardH;
      model.walletCards.forEach((wc, idx) => {
        const cx = marginX + idx * (cardW + gap);
        drawRect(cx, cardY, cardW, cardH, [0.99, 0.985, 0.97], [0.88, 0.85, 0.80], 0.6);
        drawText(truncatePdfText(wc.label, cardW - 60, 7.8, true), cx + 9, cardY + 26, { size: 7.8, bold: true, color: [0.30, 0.36, 0.34] });
        if (wc.share) {
          const st = truncatePdfText(wc.share, 56, 7, false);
          drawText(st, cx + cardW - 9 - pdfTextWidth(st, 7, false), cardY + 26, { size: 7, color: [0.10, 0.38, 0.28] });
        }
        drawText(truncatePdfText(wc.value, cardW - 18, 10.5, true), cx + 9, cardY + 10, { size: 10.5, bold: true, color: [0.078, 0.176, 0.169] });
      });
      y = cardY - 14;
    }

    // Structured Sections (Tables + Lists)
    const statusColor = (text) => {
      const u = String(text || '').trim().toUpperCase();
      if (/^(PAID|OVERPAID|CONFIRMED|APPROVED)$/.test(u)) return [0.08, 0.37, 0.26];
      if (/^(UNPAID|REJECTED|VOIDED)$/.test(u)) return [0.68, 0.22, 0.20];
      if (/^(PARTIALLY PAID|PENDING|EXEMPT)$/.test(u)) return [0.64, 0.43, 0.08];
      return [0.078, 0.176, 0.169];
    };

    model.sections.forEach((sec) => {
      if (sec.kind === 'list') {
        ensureSpace(44);
        drawRect(marginX, y - 9, 3, 11, [0.08, 0.33, 0.24]);
        drawText(sec.title || 'Summary', marginX + 8, y - 8, { size: 11, bold: true });
        y -= 18;
        sec.items.forEach((it) => {
          ensureSpace(28);
          drawRect(marginX, y - 24, contentW, 24, [0.99, 0.985, 0.97], [0.89, 0.86, 0.81], 0.5);
          drawText(truncatePdfText(it.title, contentW - 18, 9, true), marginX + 9, y - 10, { size: 9, bold: true });
          if (it.meta) drawText(truncatePdfText(it.meta, contentW - 18, 7.8, false), marginX + 9, y - 20, { size: 7.8, color: [0.38, 0.42, 0.40] });
          y -= 28;
        });
        y -= 8;
        return;
      }

      const headers = sec.headers;
      const rows = sec.rows;
      const colCount = Math.max(headers.length, rows[0]?.cells.length || 0);
      if (!colCount) return;

      ensureSpace(58);
      if (sec.title) {
        drawRect(marginX, y - 9, 3, 11, [0.08, 0.33, 0.24]);
        drawText(sec.title, marginX + 8, y - 8, { size: 11, bold: true });
        if (sec.subtitle) {
          const subT = truncatePdfText(sec.subtitle, 280, 7.8, false);
          drawText(subT, marginX + contentW - pdfTextWidth(subT, 7.8, false), y - 7.5, { size: 7.8, color: [0.42, 0.46, 0.44] });
        }
        y -= 16;
      }

      // Compute column alignments & proportional widths across 528pt
      const colMeta = Array.from({ length: colCount }, (_, cIdx) => {
        const hdr = headers[cIdx] || '';
        const samples = rows.map((r) => r.cells[cIdx]?.primary || '');
        const numeric = cIdx > 0 && isNumericPdfCol(hdr, samples);
        const isStatusCol = /status/i.test(hdr);
        const weight = cIdx === 0 ? 2.1 : isStatusCol ? 1.15 : 1.0;
        return { hdr, numeric, isStatusCol, weight };
      });
      const totalWeight = colMeta.reduce((s, m) => s + m.weight, 0);
      const colWidths = colMeta.map((m) => (m.weight / totalWeight) * contentW);
      const colXs = [];
      let curX = marginX;
      colWidths.forEach((w) => { colXs.push(curX); curX += w; });

      const drawTableHeader = () => {
        const hdrH = 20;
        drawRect(marginX, y - hdrH, contentW, hdrH, [0.945, 0.922, 0.878]);
        drawLine(marginX, y - hdrH, marginX + contentW, y - hdrH, [0.80, 0.76, 0.69], 0.8);
        colMeta.forEach((meta, cIdx) => {
          const cw = colWidths[cIdx];
          const label = truncatePdfText(meta.hdr, cw - 8, 7.8, true);
          const xPos = meta.numeric
            ? colXs[cIdx] + cw - 5 - pdfTextWidth(label, 7.8, true)
            : colXs[cIdx] + 6;
          drawText(label, xPos, y - 13, { size: 7.8, bold: true, color: [0.22, 0.28, 0.25] });
        });
        y -= hdrH;
      };

      drawTableHeader();

      rows.forEach((row, rIdx) => {
        const hasSub = row.cells.some((c) => Boolean(c.secondary));
        const rowH = hasSub ? 27 : 19;
        if (ensureSpace(rowH + 6)) {
          drawTableHeader();
        }
        const rowTop = y;
        const rowBot = y - rowH;
        if (row.isTotal) {
          drawRect(marginX, rowBot, contentW, rowH, [0.91, 0.953, 0.925]);
          drawLine(marginX, rowTop, marginX + contentW, rowTop, [0.55, 0.71, 0.62], 0.7);
        } else if (rIdx % 2 === 1) {
          drawRect(marginX, rowBot, contentW, rowH, [0.988, 0.98, 0.964]);
        } else {
          drawRect(marginX, rowBot, contentW, rowH, [1, 1, 1]);
        }
        drawLine(marginX, rowBot, marginX + contentW, rowBot, [0.90, 0.875, 0.83], 0.45);

        row.cells.forEach((cell, cIdx) => {
          const meta = colMeta[cIdx] || { numeric: false, isStatusCol: false };
          const cw = colWidths[cIdx] || 60;
          const boldCell = row.isTotal || cIdx === 0 || meta.isStatusCol;
          const color = meta.isStatusCol ? statusColor(cell.primary) : [0.078, 0.176, 0.169];
          const primary = truncatePdfText(cell.primary || '-', cw - 10, 8.6, boldCell);
          const primaryY = hasSub ? rowTop - 11.5 : rowTop - 12.5;
          const xPos = meta.numeric
            ? colXs[cIdx] + cw - 5 - pdfTextWidth(primary, 8.6, boldCell)
            : colXs[cIdx] + 6;
          drawText(primary, xPos, primaryY, { size: 8.6, bold: boldCell, color });
          if (cell.secondary) {
            const subTxt = truncatePdfText(cell.secondary, cw - 10, 7.2, false);
            const sxPos = meta.numeric
              ? colXs[cIdx] + cw - 5 - pdfTextWidth(subTxt, 7.2, false)
              : colXs[cIdx] + 6;
            drawText(subTxt, sxPos, rowTop - 21.5, { size: 7.2, color: [0.40, 0.45, 0.43] });
          }
        });
        y = rowBot;
      });
      y -= 14;
    });

    // Footer on every page
    const totalPages = pages.length;
    pages.forEach((ops, idx) => {
      const footerLine = `myIPON - Page ${idx + 1} of ${totalPages} - Verified Group Record`;
      const fx = marginX + (contentW - pdfTextWidth(footerLine, 7.6, false)) / 2;
      ops.push(`q ${rgbStroke(0.87, 0.84, 0.78)} 0.5 w ${marginX.toFixed(1)} 36.0 m ${(marginX + contentW).toFixed(1)} 36.0 l S Q`);
      ops.push(`BT ${rgbFill(0.45, 0.48, 0.46)} /F1 7.6 Tf 1 0 0 1 ${fx.toFixed(1)} 23.0 Tm (${pdfEscapeLiteral(footerLine)}) Tj ET`);
    });

    const objs = [];
    const pageObjIds = [];
    const baseObj = 5;
    pages.forEach((ops, idx) => {
      const pageId = baseObj + idx * 2;
      const contentId = pageId + 1;
      pageObjIds.push(pageId);
      const streamBody = ops.join('\n');
      objs.push({ id: pageId, body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>` });
      objs.push({ id: contentId, body: `<< /Length ${streamBody.length} >>\nstream\n${streamBody}\nendstream` });
    });

    const ordered = [
      { id: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      { id: 2, body: `<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>` },
      { id: 3, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
      { id: 4, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>' },
      ...objs
    ].sort((a, b) => a.id - b.id);

    let out = '%PDF-1.4\n';
    const offsets = [0];
    for (const o of ordered) {
      offsets[o.id] = out.length;
      out += `${o.id} 0 obj\n${o.body}\nendobj\n`;
    }
    const xrefStart = out.length;
    out += `xref\n0 ${ordered.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= ordered.length; i++) {
      out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    out += `trailer\n<< /Size ${ordered.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
    return new Uint8Array([...out].map((ch) => ch.charCodeAt(0) & 0xFF));
  }

  async function savePrintablePdf(jobName = 'myIPON-report') {
    const safeBase = normalizeDownloadFileName(jobName, 'myIPON-report').replace(/\.pdf$/i, '');
    const fileName = `${safeBase}.pdf`;
    const bytes = buildStyledPdfBytes(collectPrintablePdfModel(jobName));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (typeof bgPlugin?.downloadFile === 'function') {
      const dataUrl = await blobToDataUrl(blob);
      return await downloadFile(dataUrl, fileName, { mimeType: 'application/pdf' });
    }
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await downloadFile(blobUrl, fileName, { mimeType: 'application/pdf' });
    } finally {
      setTimeout(() => { try { URL.revokeObjectURL(blobUrl); } catch { } }, 2000);
    }
  }

  async function printPage({ jobName = document.title || 'myIPON Report' } = {}) {
    const bgPlugin = getBackgroundNotificationsPlugin();
    if (typeof bgPlugin?.printPage === 'function') {
      return await bgPlugin.printPage({
        jobName: normalizeDownloadFileName(jobName, 'myIPON Report')
      });
    }
    const isNativeShell = Boolean(window.Capacitor?.isNativePlatform?.() || /myIPONApp\/\d+|\bwv\b/i.test(navigator?.userAgent || ''));
    if (isNativeShell || typeof window.print !== 'function') {
      return await savePrintablePdf(`${jobName || 'myIPON-report'}-${isoDate()}`);
    }
    window.print();
    return { started: true };
  }

  function openImageViewer(src, title = 'Attachment', subtitle = '', downloadName = '', opts = {}) {
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
          <div class="image-viewer-title-wrap">
            <button class="dialog-close" id="ipon-iv-close" type="button" aria-label="Close image viewer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            <div class="image-viewer-meta">
              <h2 id="ipon-iv-title"></h2>
              <p id="ipon-iv-subtitle" hidden></p>
            </div>
          </div>
          <div class="image-viewer-actions">
            <a class="image-viewer-dl-pill" id="ipon-iv-download" download="myipon-attachment.jpg" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg><span>Download</span></a>
          </div>
        </header>
        <div class="image-viewer-stage" id="ipon-iv-stage"><img id="ipon-iv-img" alt="" title="Pinch or double-tap to zoom"></div>
      </div>`;
      document.body.appendChild(dialog);
      const stageEl = dialog.querySelector('#ipon-iv-stage');
      const imgEl = dialog.querySelector('#ipon-iv-img');
      const dlBtn = dialog.querySelector('#ipon-iv-download');
      const zoomState = { scale: 1, tx: 0, ty: 0 };
      dialog._zoomState = zoomState;
      const getStageOffset = (clientX, clientY) => {
        const rect = stageEl.getBoundingClientRect();
        return {
          rect,
          fx: clientX - (rect.left + rect.width / 2),
          fy: clientY - (rect.top + rect.height / 2)
        };
      };
      const applyZoom = (nextScale, nextTx, nextTy, animate = false) => {
        const rect = stageEl.getBoundingClientRect();
        const sw = rect.width || window.innerWidth || 1;
        const sh = rect.height || window.innerHeight || 1;
        const nw = imgEl.naturalWidth || sw;
        const nh = imgEl.naturalHeight || sh;
        const fit = Math.min(sw / nw, sh / nh);
        const baseW = nw * fit;
        const baseH = nh * fit;
        let s = Math.max(1, Math.min(4, Number(nextScale) || 1));
        let tx = Number(nextTx) || 0;
        let ty = Number(nextTy) || 0;
        if (s <= 1.01) {
          s = 1; tx = 0; ty = 0;
        } else {
          const maxTx = Math.max(0, (baseW * s - sw) / 2);
          const maxTy = Math.max(0, (baseH * s - sh) / 2);
          tx = Math.max(-maxTx, Math.min(maxTx, tx));
          ty = Math.max(-maxTy, Math.min(maxTy, ty));
        }
        zoomState.scale = s;
        zoomState.tx = tx;
        zoomState.ty = ty;
        imgEl.style.transition = animate ? 'transform .18s cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
        imgEl.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
        const zoomed = s > 1.02;
        stageEl.classList.toggle('is-actual-size', zoomed);
        imgEl.title = zoomed ? 'Drag to pan · Pinch or double-tap to reset' : 'Pinch or double-tap to zoom';
      };
      const zoomAtPoint = (targetScale, clientX, clientY, animate = true) => {
        const { fx, fy } = getStageOffset(clientX, clientY);
        const s = Math.max(1, Math.min(4, targetScale));
        if (s <= 1.01) {
          applyZoom(1, 0, 0, animate);
          return;
        }
        const lx = (fx - zoomState.tx) / zoomState.scale;
        const ly = (fy - zoomState.ty) / zoomState.scale;
        applyZoom(s, fx - s * lx, fy - s * ly, animate);
      };
      dialog._resetZoom = () => applyZoom(1, 0, 0, false);

      let pinchState = null;
      let panState = null;
      let lastTouchAt = 0;
      let lastTapAt = 0;
      let lastTapPos = null;
      let singleTapTimer = null;
      let dragMoved = false;

      const touchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const touchMid = (t1, t2) => ({ clientX: (t1.clientX + t2.clientX) / 2, clientY: (t1.clientY + t2.clientY) / 2 });

      stageEl.addEventListener('touchstart', (ev) => {
        lastTouchAt = Date.now();
        clearTimeout(singleTapTimer);
        if (ev.touches.length === 2) {
          ev.preventDefault();
          const mid = touchMid(ev.touches[0], ev.touches[1]);
          const off = getStageOffset(mid.clientX, mid.clientY);
          pinchState = {
            dist: Math.max(10, touchDist(ev.touches[0], ev.touches[1])),
            scale: zoomState.scale,
            tx: zoomState.tx,
            ty: zoomState.ty,
            fx: off.fx,
            fy: off.fy
          };
          panState = null;
          dragMoved = true;
        } else if (ev.touches.length === 1) {
          const t = ev.touches[0];
          const now = Date.now();
          if (lastTapPos && now - lastTapAt < 280 && Math.hypot(t.clientX - lastTapPos.x, t.clientY - lastTapPos.y) < 30) {
            ev.preventDefault();
            lastTapAt = 0;
            lastTapPos = null;
            panState = null;
            dragMoved = true;
            zoomAtPoint(zoomState.scale > 1.05 ? 1 : 2.5, t.clientX, t.clientY, true);
            return;
          }
          lastTapAt = now;
          lastTapPos = { x: t.clientX, y: t.clientY };
          dragMoved = false;
          panState = { x: t.clientX, y: t.clientY, tx: zoomState.tx, ty: zoomState.ty };
        }
      }, { passive: false });

      stageEl.addEventListener('touchmove', (ev) => {
        if (ev.touches.length === 2 && pinchState) {
          ev.preventDefault();
          dragMoved = true;
          const dist = touchDist(ev.touches[0], ev.touches[1]);
          const mid = touchMid(ev.touches[0], ev.touches[1]);
          const off = getStageOffset(mid.clientX, mid.clientY);
          const nextScale = Math.max(1, Math.min(4, pinchState.scale * (dist / pinchState.dist)));
          const lx = (pinchState.fx - pinchState.tx) / pinchState.scale;
          const ly = (pinchState.fy - pinchState.ty) / pinchState.scale;
          applyZoom(nextScale, off.fx - nextScale * lx, off.fy - nextScale * ly, false);
        } else if (ev.touches.length === 1 && panState && zoomState.scale > 1.02) {
          ev.preventDefault();
          const t = ev.touches[0];
          const dx = t.clientX - panState.x;
          const dy = t.clientY - panState.y;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragMoved = true;
          applyZoom(zoomState.scale, panState.tx + dx, panState.ty + dy, false);
        }
      }, { passive: false });

      const onTouchFinish = (ev) => {
        if (ev.touches.length === 1 && pinchState) {
          const t = ev.touches[0];
          pinchState = null;
          panState = { x: t.clientX, y: t.clientY, tx: zoomState.tx, ty: zoomState.ty };
          return;
        }
        if (ev.touches.length === 0) {
          const wasTap = !dragMoved && panState;
          pinchState = null;
          panState = null;
          if (wasTap) {
            singleTapTimer = setTimeout(() => {
              dialog.classList.toggle('is-chrome-hidden');
            }, 260);
          }
        }
      };
      stageEl.addEventListener('touchend', onTouchFinish);
      stageEl.addEventListener('touchcancel', onTouchFinish);

      stageEl.addEventListener('wheel', (ev) => {
        ev.preventDefault();
        const factor = ev.deltaY < 0 ? 1.18 : 0.85;
        zoomAtPoint(zoomState.scale * factor, ev.clientX, ev.clientY, false);
      }, { passive: false });

      let mouseDrag = null;
      stageEl.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0 || zoomState.scale <= 1.02) return;
        mouseDrag = { x: ev.clientX, y: ev.clientY, tx: zoomState.tx, ty: zoomState.ty, moved: false };
      });
      stageEl.addEventListener('mousemove', (ev) => {
        if (!mouseDrag) return;
        const dx = ev.clientX - mouseDrag.x;
        const dy = ev.clientY - mouseDrag.y;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mouseDrag.moved = true;
        applyZoom(zoomState.scale, mouseDrag.tx + dx, mouseDrag.ty + dy, false);
      });
      stageEl.addEventListener('mouseup', () => {
        if (mouseDrag?.moved) dragMoved = true;
        mouseDrag = null;
      });
      stageEl.addEventListener('mouseleave', () => { mouseDrag = null; });

      imgEl.addEventListener('click', (ev) => {
        if (Date.now() - lastTouchAt < 500 || dragMoved) {
          dragMoved = false;
          return;
        }
        zoomAtPoint(zoomState.scale > 1.05 ? 1 : 2.2, ev.clientX, ev.clientY, true);
      });

      dialog.querySelector('#ipon-iv-close').addEventListener('click', () => dialog.close());
      dlBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        if (dlBtn.dataset.busy === '1') return;
        dlBtn.dataset.busy = '1';
        dlBtn.setAttribute('aria-busy', 'true');
        try {
          if (typeof dialog._onDownload === 'function') {
            await dialog._onDownload();
          } else {
            await downloadFile(dialog._currentSrc || dlBtn.href, dlBtn.download || 'attachment');
          }
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          dlBtn.dataset.busy = '0';
          dlBtn.removeAttribute('aria-busy');
        }
      });
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    const img = dialog.querySelector('#ipon-iv-img');
    const stage = dialog.querySelector('#ipon-iv-stage');
    const titleEl = dialog.querySelector('#ipon-iv-title');
    const subEl = dialog.querySelector('#ipon-iv-subtitle');
    const dl = dialog.querySelector('#ipon-iv-download');
    const baseSub = String(subtitle || '').trim();
    dialog.classList.remove('is-chrome-hidden');
    dialog._currentSrc = raw;
    dialog._onDownload = typeof opts?.onDownload === 'function' ? opts.onDownload : null;
    if (stage) {
      stage.scrollTop = 0;
      stage.scrollLeft = 0;
    }
    dialog._resetZoom?.();
    img.title = 'Pinch or double-tap to zoom';
    img.onload = () => {
      if (!baseSub || !img.naturalWidth || !img.naturalHeight || !subEl) return;
      subEl.textContent = `${baseSub} · ${img.naturalWidth} × ${img.naturalHeight}`;
      subEl.hidden = false;
    };
    img.src = raw;
    img.alt = title;
    titleEl.textContent = title;
    subEl.textContent = baseSub;
    subEl.hidden = !baseSub;
    dl.href = raw;
    dl.removeAttribute('target');
    const cleanDl = String(downloadName || '').trim();
    dl.download = cleanDl || `${String(title || 'attachment').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`;
    if (!dialog.open) dialog.showModal();
  }

  function formatVideoTimeLabel(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  }

  function openVideoViewer(src, title = 'Video', subtitle = '', downloadName = '', opts = {}) {
    const raw = String(src || '').trim();
    const isSafeUrl = raw.startsWith('data:video/') || raw.startsWith('blob:') || /^https?:\/\//i.test(raw);
    if (!raw || !isSafeUrl) return;
    let dialog = document.getElementById('ipon-video-viewer');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'ipon-video-viewer';
      dialog.className = 'image-viewer-dialog video-viewer-dialog';
      dialog.innerHTML = `<div class="image-viewer-sheet">
        <header class="image-viewer-header">
          <div class="image-viewer-title-wrap">
            <button class="dialog-close" id="ipon-vv-close" type="button" aria-label="Close video viewer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
            <div class="image-viewer-meta">
              <h2 id="ipon-vv-title"></h2>
              <p id="ipon-vv-subtitle" hidden></p>
            </div>
          </div>
          <div class="image-viewer-actions">
            <a class="image-viewer-dl-pill" id="ipon-vv-download" download="myipon-video.mp4" rel="noopener"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg><span>Download</span></a>
          </div>
        </header>
        <div class="video-viewer-stage" id="ipon-vv-stage">
          <video class="video-viewer-el" id="ipon-vv-video" playsinline preload="auto"></video>
          <button type="button" class="video-viewer-center-btn" id="ipon-vv-center-play" aria-label="Play video">
            <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"/></svg>
          </button>
          <div class="msg-video-controls is-viewer-dock" id="ipon-vv-controls">
            <input type="range" class="msg-video-seek" id="ipon-vv-seek" min="0" max="1000" value="0" aria-label="Seek video">
            <div class="msg-video-bar-actions">
              <div class="msg-video-bar-left">
                <button type="button" class="msg-video-ctrl-btn" id="ipon-vv-play" aria-label="Play video" title="Play"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg></button>
                <button type="button" class="msg-video-ctrl-btn" id="ipon-vv-mute" aria-label="Mute audio" title="Mute"><svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg></button>
                <span class="msg-video-time" id="ipon-vv-time">0:00 / 0:00</span>
              </div>
              <div class="msg-video-bar-right">
                <button type="button" class="msg-video-ctrl-btn" id="ipon-vv-exit-fs" aria-label="Exit fullscreen" title="Exit fullscreen"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg></button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
      document.body.appendChild(dialog);

      const stageEl = dialog.querySelector('#ipon-vv-stage');
      const videoEl = dialog.querySelector('#ipon-vv-video');
      const seekEl = dialog.querySelector('#ipon-vv-seek');
      const playBtn = dialog.querySelector('#ipon-vv-play');
      const centerBtn = dialog.querySelector('#ipon-vv-center-play');
      const muteBtn = dialog.querySelector('#ipon-vv-mute');
      const timeEl = dialog.querySelector('#ipon-vv-time');
      const dlBtn = dialog.querySelector('#ipon-vv-download');
      const exitBtn = dialog.querySelector('#ipon-vv-exit-fs');
      const playSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg>';
      const pauseSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
      const volOnSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>';
      const volOffSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

      let hideChromeTimer = null;
      const scheduleChromeHide = () => {
        clearTimeout(hideChromeTimer);
        dialog.classList.remove('is-chrome-hidden');
        if (!videoEl.paused && !videoEl.ended && seekEl.dataset.seeking !== '1') {
          hideChromeTimer = setTimeout(() => {
            if (!videoEl.paused && !videoEl.ended && seekEl.dataset.seeking !== '1') {
              dialog.classList.add('is-chrome-hidden');
            }
          }, 3000);
        }
      };

      const syncUi = () => {
        const playing = !videoEl.paused && !videoEl.ended;
        const muted = Boolean(videoEl.muted || videoEl.volume === 0);
        stageEl.classList.toggle('is-playing', playing);
        playBtn.innerHTML = playing ? pauseSvg : playSvg;
        playBtn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
        playBtn.setAttribute('title', playing ? 'Pause' : 'Play');
        centerBtn.setAttribute('aria-label', playing ? 'Pause video' : 'Play video');
        muteBtn.innerHTML = muted ? volOffSvg : volOnSvg;
        muteBtn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
        muteBtn.setAttribute('title', muted ? 'Unmute' : 'Mute');
        const dur = Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0;
        const cur = Number.isFinite(videoEl.currentTime) && videoEl.currentTime > 0 ? videoEl.currentTime : 0;
        if (seekEl.dataset.seeking !== '1') {
          const pct = dur ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
          seekEl.value = String(Math.round(pct * 10));
          seekEl.style.setProperty('--seek-pct', `${pct}%`);
        }
        timeEl.textContent = `${formatVideoTimeLabel(cur)} / ${formatVideoTimeLabel(dur)}`;
      };
      dialog._syncUi = syncUi;
      dialog._scheduleChromeHide = scheduleChromeHide;

      const togglePlay = async () => {
        if (videoEl.paused || videoEl.ended) {
          try { await videoEl.play?.(); } catch { }
        } else {
          try { videoEl.pause?.(); } catch { }
        }
        syncUi();
        scheduleChromeHide();
      };

      playBtn.addEventListener('click', (ev) => { ev.stopPropagation(); togglePlay(); });
      centerBtn.addEventListener('click', (ev) => { ev.stopPropagation(); togglePlay(); });
      videoEl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (dialog.classList.contains('is-chrome-hidden')) {
          scheduleChromeHide();
        } else {
          togglePlay();
        }
      });
      muteBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        videoEl.muted = !videoEl.muted;
        syncUi();
        scheduleChromeHide();
      });
      seekEl.addEventListener('input', (ev) => {
        ev.stopPropagation();
        seekEl.dataset.seeking = '1';
        clearTimeout(hideChromeTimer);
        dialog.classList.remove('is-chrome-hidden');
        const pct = Math.min(100, Math.max(0, Number(seekEl.value || 0) / 10));
        seekEl.style.setProperty('--seek-pct', `${pct}%`);
        if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
          videoEl.currentTime = (pct / 100) * videoEl.duration;
        }
        syncUi();
      });
      seekEl.addEventListener('change', () => {
        delete seekEl.dataset.seeking;
        scheduleChromeHide();
      });

      for (const evt of ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'volumechange']) {
        videoEl.addEventListener(evt, () => {
          syncUi();
          if (evt === 'pause' || evt === 'ended') {
            clearTimeout(hideChromeTimer);
            dialog.classList.remove('is-chrome-hidden');
          } else if (evt === 'play') {
            scheduleChromeHide();
          }
        });
      }

      dialog.querySelector('#ipon-vv-close').addEventListener('click', () => dialog.close());
      exitBtn.addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
      dlBtn.addEventListener('click', async (event) => {
        event.preventDefault();
        if (dlBtn.dataset.busy === '1') return;
        dlBtn.dataset.busy = '1';
        dlBtn.setAttribute('aria-busy', 'true');
        try {
          if (typeof dialog._onDownload === 'function') {
            await dialog._onDownload();
          } else {
            await downloadFile(dialog._currentSrc || dlBtn.href, dlBtn.download || 'video.mp4');
          }
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          dlBtn.dataset.busy = '0';
          dlBtn.removeAttribute('aria-busy');
        }
      });
      dialog.addEventListener('close', () => {
        clearTimeout(hideChromeTimer);
        try { videoEl.pause?.(); } catch { }
        const onClose = dialog._onClose;
        dialog._onClose = null;
        if (typeof onClose === 'function') {
          try {
            onClose({ currentTime: Number(videoEl.currentTime || 0), muted: Boolean(videoEl.muted) });
          } catch { }
        }
      });
    }

    const videoEl = dialog.querySelector('#ipon-vv-video');
    const titleEl = dialog.querySelector('#ipon-vv-title');
    const subEl = dialog.querySelector('#ipon-vv-subtitle');
    const dl = dialog.querySelector('#ipon-vv-download');
    const baseSub = String(subtitle || '').trim();
    dialog.classList.remove('is-chrome-hidden');
    dialog._currentSrc = raw;
    dialog._onDownload = typeof opts?.onDownload === 'function' ? opts.onDownload : null;
    dialog._onClose = typeof opts?.onClose === 'function' ? opts.onClose : null;
    titleEl.textContent = title || 'Video';
    subEl.textContent = baseSub;
    subEl.hidden = !baseSub;
    dl.href = raw;
    dl.removeAttribute('target');
    const cleanDl = String(downloadName || '').trim();
    dl.download = cleanDl || `${String(title || 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`;
    if (opts?.poster) videoEl.poster = String(opts.poster);
    else videoEl.removeAttribute('poster');
    if (typeof opts?.muted === 'boolean') videoEl.muted = opts.muted;
    videoEl.src = raw;
    const seekTarget = Number(opts?.startTime || 0);
    if (seekTarget > 0) {
      const applyStart = () => {
        try {
          if (Number.isFinite(videoEl.duration) && seekTarget < videoEl.duration) {
            videoEl.currentTime = seekTarget;
          }
        } catch { }
        dialog._syncUi?.();
      };
      if (videoEl.readyState >= 1) applyStart();
      else videoEl.addEventListener('loadedmetadata', applyStart, { once: true });
    }
    dialog._syncUi?.();
    if (!dialog.open) dialog.showModal();
    if (opts?.autoplay !== false) {
      Promise.resolve(videoEl.play?.()).then(() => {
        dialog._syncUi?.();
        dialog._scheduleChromeHide?.();
      }).catch(() => {
        dialog._syncUi?.();
      });
    }
  }

  function handleNativeBack() {
    if (window.IponMessages?.dismissTransientMenus?.()) return 'handled';

    for (const id of ['ipon-video-viewer', 'ipon-image-viewer']) {
      const viewer = document.getElementById(id);
      if (viewer?.open) {
        viewer.close();
        return 'handled';
      }
    }

    for (const id of ['confirm-dialog', 'record-action-dialog', 'notif-unblock-dialog', 'msg-forward-dialog', 'msg-settings-dialog', 'account-dialog']) {
      const dlg = document.getElementById(id);
      if (dlg?.open) {
        dlg.close(id === 'confirm-dialog' || id === 'record-action-dialog' ? 'cancel' : undefined);
        return 'handled';
      }
    }

    const msgDialog = document.getElementById('msg-workspace-dialog');
    if (msgDialog?.open) {
      if (window.IponMessages?.handleBackNavigation?.()) return 'handled';
      msgDialog.close();
      return 'handled';
    }

    const consentDialog = document.getElementById('ipon-policy-consent-dialog');
    if (consentDialog?.open && consentDialog.dataset?.accepted !== '1') {
      window.dispatchEvent?.(new CustomEvent('ipon:policy-back-blocked'));
      return 'handled';
    }

    const openDialogs = Array.from(document.querySelectorAll('dialog[open]') || []);
    const extraDialog = openDialogs.reverse().find((d) => d?.id && d.id !== 'msg-workspace-dialog' && d.id !== 'ipon-policy-consent-dialog');
    if (extraDialog) {
      extraDialog.close();
      return 'handled';
    }

    const pageName = String(document.body?.dataset?.page || '').toLowerCase();
    const pathLeaf = String(window.location?.pathname || '').split('/').pop().toLowerCase();
    const isRootPage = pageName === 'dashboard' || pageName === 'super-admin' || pageName === 'login'
      || pageName === 'mfa' || pageName === 'reset-password'
      || pathLeaf === '' || pathLeaf === 'index.html' || pathLeaf === 'dashboard.html'
      || pathLeaf === 'super-admin.html' || pathLeaf === 'login.html'
      || pathLeaf === 'mfa.html' || pathLeaf === 'reset-password.html';
    if (!isRootPage) {
      if (document.referrer && document.referrer.startsWith(window.location.origin) && window.history?.length > 1) {
        window.history.back();
      } else {
        window.location.href = currentProfile ? homeForRole(currentProfile.role) : 'dashboard.html';
      }
      return 'handled';
    }

    return 'exit';
  }

  function bindReceiptPicker({ input, dropzone, preview, thumb, nameEl, clearBtn, emptyBox, onChange } = {}) {
    let dataUrl = null;
    let fileName = 'receipt.jpg';
    const sync = (nextName = '') => {
      if (nextName) fileName = nextName;
      const hasFile = Boolean(dataUrl);
      if (preview) preview.hidden = !hasFile;
      if (emptyBox) emptyBox.hidden = hasFile;
      if (thumb) {
        if (hasFile) thumb.src = dataUrl;
        else thumb.removeAttribute('src');
      }
      if (nameEl && nextName) nameEl.textContent = nextName;
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
        fileName = 'receipt.jpg';
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
      fileName = 'receipt.jpg';
      if (input) input.value = '';
      sync();
    });
    return {
      get: () => dataUrl,
      upload: async () => (dataUrl ? await uploadMediaDataUrl(dataUrl, { category: 'receipts', name: fileName }) : null),
      clear: () => { dataUrl = null; fileName = 'receipt.jpg'; if (input) input.value = ''; sync(); }
    };
  }

  const CURRENT_POLICY_VERSION = '2026-11-16';
  const openPolicyDialog = (...args) => window.IponPolicy?.openPolicyDialog?.(...args) ?? false;
  const openRetentionPolicyDialog = (...args) => window.IponPolicy?.openRetentionPolicyDialog?.(...args) ?? false;
  const maybeShowRetentionReminder = (...args) => window.IponPolicy?.maybeShowRetentionReminder?.(...args) ?? false;
  const hasAcceptedCurrentPolicy = (...args) => window.IponPolicy?.hasAcceptedCurrentPolicy?.(...args) ?? true;
  const maybeShowPolicyConsentModal = (...args) => window.IponPolicy?.maybeShowPolicyConsentModal?.(...args) ?? false;

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
    const title = hasGroup ? 'Member profile link required' : 'Start a savings workspace';
      const message = hasGroup
      ? 'Your account belongs to a group, but your member slot is not linked yet. Check your notifications or ask your group administrator to link your account.'
      : 'Start a personal Solo tracker with no invitations required, create a Group to save with others, or join via invite code.';
    const createButtons = hasGroup
      ? ''
      : '<button class="button button-primary" type="button" data-group-required-create="SOLO">Start solo savings</button><button class="button button-secondary" type="button" data-group-required-create="GROUP">+ Create savings group</button><button class="button button-secondary" type="button" data-group-required-join>Join with code</button>';
    return `
      <div class="group-required-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="group-required-copy">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
      </div>
      <div class="group-required-actions">
        ${createButtons}
        <button class="button button-secondary" type="button" data-group-required-invites>Check invitations</button>
      </div>`;
  }

  function wireGroupRequiredActions(root, { onCreateGroup = null, onClose = null } = {}) {
    root?.querySelectorAll('[data-group-required-create]')?.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.groupRequiredCreate === 'SOLO' ? 'SOLO' : 'GROUP';
        onClose?.();
        if (typeof onCreateGroup === 'function') onCreateGroup(mode);
        else window.location.href = `dashboard.html?create_group=1&workspace_mode=${mode}`;
      });
    });
    root?.querySelector('[data-group-required-join]')?.addEventListener('click', () => {
      onClose?.();
      openJoinGroupDialog();
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
      resolveAttachmentUrls().catch(() => { });
      const canReply = Boolean(payload?.can_reply);
      if (form) form.hidden = !canReply;
      if (readonlyEl) readonlyEl.hidden = canReply;
      if (canReply && input) input.focus();
    }

    const client = getClient();
    const channel = client
      ? createRealtimeChannel(`record-thread-${recordType}-${recordId}`, undefined, client)
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
          }).catch(() => { });
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
            await uploadAuthorizedFile(client, 'record-comments', upload, entry.file);
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
        if (attachments.length) resolveAttachmentUrls().catch(() => { });
        if (typeof onUpdated === 'function') {
          didNotifyUpdate = true;
          onUpdated(currentComments.length);
        }
      } catch (error) {
        if (uploadedPaths.length) {
          invokeAccountFunction({ action: 'record-comment-cleanup-media', paths: uploadedPaths }).catch(() => { });
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
      previewUrlsToRevoke.forEach((url) => { try { URL.revokeObjectURL(url); } catch { } });
      if (channel && client) client.removeChannel(channel).catch?.(() => { });
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
    amountInput.addEventListener('input', () => { sync().catch(() => { }); });
    amountInput.addEventListener('change', () => { sync().catch(() => { }); });
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
  window?.addEventListener?.('ipon:profile-updated', (event) => {
    const updated = event?.detail;
    if (!updated || typeof updated !== 'object') return;
    writeShellSnapshot({
      userId: updated.id,
      role: updated.role,
      fullName: updated.full_name
    });
    if (updated.id && 'avatar_url' in updated) {
      writeShellAvatar(updated.id, updated.avatar_url || '');
    }
  });

  const AUDIT_TABLE_LABELS = {
    profiles: 'Account',
    groups: 'Savings group',
    members: 'Member',
    contribution_settings: 'Contribution schedule',
    contribution_periods: 'Contribution period',
    contributions: 'Addition',
    withdrawals: 'Deduction',
    expenses: 'Expense',
    savings_goals: 'Savings goal',
    group_memberships: 'Member permission',
    financial_change_requests: 'Change request',
    group_invite_codes: 'Invite code',
    group_join_requests: 'Join request',
    savings_cycle_batches: 'Savings cycle'
  };

  const AUDIT_ACTION_LABELS = {
    INSERT: 'Created',
    UPDATE: 'Updated',
    DELETE: 'Deleted',
    CONFIRM: 'Confirmed',
    REJECT: 'Rejected',
    VOID: 'Voided'
  };

  const AUDIT_SKIP_FIELDS = new Set([
    'id',
    'idempotency_key',
    'created_at',
    'updated_at',
    'last_seen_at',
    'chat_privacy',
    'username',
    'bio',
    'name_setup_required',
    'previous_account_status',
    'inactivity_warned_at',
    'savings_inactivity_reminded_at',
    'savings_retention_warned_at',
    'policy_accepted_version',
    'policy_accepted_at',
    'archived_paid_amount',
    'archived_first_paid_date',
    'snapshot'
  ]);

  const AUDIT_TRANSITION_TIMESTAMPS = new Set(['reviewed_at', 'voided_at', 'deactivated_at', 'deleted_at']);
  const AUDIT_IMAGE_FIELDS = new Set(['avatar_url', 'receipt_url', 'payment_qr_url']);
  const AUDIT_MONEY_FIELDS = new Set(['amount', 'default_amount', 'required_amount', 'monthly_contribution_amount', 'target_amount', 'current_amount', 'proposed_amount', 'total_additions', 'total_deductions', 'total_expenses', 'net_savings']);
  const AUDIT_MONTH_FIELDS = new Set(['effective_month', 'period_month']);
  const AUDIT_DATE_FIELDS = new Set(['payment_date', 'transaction_date', 'date_registered', 'due_date', 'target_date', 'cycle_start_date', 'entry_date', 'period_start', 'period_end']);
  const AUDIT_DATETIME_FIELDS = new Set(['reviewed_at', 'voided_at', 'deleted_at', 'deactivated_at', 'revoked_at', 'expires_at', 'restored_at']);
  const AUDIT_ACTOR_REF_FIELDS = new Set(['owner_id', 'submitted_by', 'reviewed_by', 'voided_by', 'deleted_by', 'created_by', 'updated_by', 'requested_by', 'requester_id', 'revoked_by']);
  const AUDIT_REASON_FIELDS = new Set(['review_note', 'void_reason', 'delete_reason', 'exempt_reason', 'reason']);
  const AUDIT_ACTION_CONTEXT_FIELDS = new Set([
    ...AUDIT_REASON_FIELDS,
    'reviewed_by', 'voided_by', 'deleted_by', 'submitted_by', 'created_by', 'updated_by',
    ...AUDIT_DATETIME_FIELDS
  ]);

  const AUDIT_ENUM_VALUE_LABELS = {
    ADMIN: 'Admin',
    TREASURER: 'Treasurer',
    MEMBER: 'Member',
    SUPER_ADMIN: 'Owner',
    ACTIVE: 'Active',
    INACTIVE: 'Inactive',
    PENDING: 'Pending review',
    DISABLED: 'Disabled',
    SUSPENDED: 'Suspended',
    CONFIRMED: 'Confirmed',
    APPROVED: 'Approved',
    DECLINED: 'Declined',
    REJECTED: 'Rejected',
    VOIDED: 'Voided',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled',
    JOIN_CODE: 'Group code',
    INVITE_LINK: 'Invite link'
  };

  const AUDIT_FIELD_LABELS = {
    full_name: 'Full name',
    first_name: 'First name',
    middle_name: 'Middle name',
    last_name: 'Last name',
    name: 'Group name',
    email: 'Email address',
    contact_number: 'Contact number',
    avatar_url: 'Profile photo',
    role: 'Account role',
    status: 'Status',
    approval_status: 'Approval status',
    notifications_enabled: 'Notifications',
    group_id: 'Savings group',
    member_id: 'Member',
    owner_id: 'Group owner',
    contribution_period_id: 'Billing period',
    amount: 'Amount',
    default_amount: 'Default monthly contribution',
    required_amount: 'Required monthly amount',
    monthly_contribution_amount: 'Monthly contribution',
    allow_credit: 'Credit excess to future months',
    deadline_day: 'Monthly due day',
    effective_month: 'Effective month',
    period_month: 'Billing month',
    due_date: 'Due date',
    payment_date: 'Payment date',
    transaction_date: 'Transaction date',
    date_registered: 'Date registered',
    cycle_start_date: 'Cycle start date',
    category: 'Category',
    description: 'Description',
    person_responsible: 'Person responsible',
    transaction_reference: 'Transaction reference',
    reference_number: 'Reference number',
    payment_method: 'Payment method',
    payment_method_label: 'Group payment channel',
    payment_account_name: 'Payment account name',
    payment_account_number: 'Payment account number',
    payment_instructions: 'Payment instructions',
    payment_qr_url: 'Payment QR code',
    payout_channel: 'Payout channel',
    payout_account_number: 'Payout account number',
    payout_account_name: 'Payout account name',
    receipt_url: 'Receipt image',
    is_exempt: 'Month exemption',
    exempt_reason: 'Exemption reason',
    review_note: 'Review note',
    reviewed_by: 'Reviewed by',
    reviewed_at: 'Reviewed at',
    submitted_by: 'Submitted by',
    void_reason: 'Void reason',
    voided_by: 'Voided by',
    voided_at: 'Voided at',
    delete_reason: 'Removal reason',
    deleted_by: 'Removed by',
    deleted_at: 'Removed on',
    deactivated_at: 'Deactivated on',
    notes: 'Notes',
    title: 'Goal title',
    target_amount: 'Target amount',
    target_date: 'Target date',
    created_by: 'Created by',
    updated_by: 'Updated by',
    current_amount: 'Previous amount',
    proposed_amount: 'Requested amount',
    current_payment_method: 'Previous payment method',
    proposed_payment_method: 'Requested payment method',
    current_notes: 'Previous notes',
    proposed_notes: 'Requested notes',
    entry_date: 'Entry date',
    requested_by: 'Requested by',
    record_type: 'Entry type',
    can_edit_own_entries: 'Edit calendar entries',
    require_edit_approval: 'Edit approval required',
    require_add_approval: 'Addition approval required',
    can_record_expenses: 'Record expenses',
    require_expense_approval: 'Expense approval required',
    can_record_withdrawals: 'Record deductions',
    require_withdrawal_approval: 'Deduction approval required',
    code: 'Invite code',
    max_uses: 'Usage limit',
    uses_count: 'Uses count',
    expires_at: 'Expires on',
    revoked_at: 'Revoked on',
    revoked_by: 'Revoked by',
    requester_id: 'Requested by',
    requester_name: 'Requester name',
    requester_email: 'Requester email',
    source: 'Join method',
    period_start: 'Cycle start',
    period_end: 'Cycle end',
    total_additions: 'Total additions',
    total_deductions: 'Total deductions',
    total_expenses: 'Total expenses',
    net_savings: 'Net savings',
    records_count: 'Records archived',
    periods_count: 'Billing periods',
    goals_binned_count: 'Goals archived',
    restored_at: 'Restored on'
  };

  const AUDIT_FIELD_ORDER = [
    'full_name', 'first_name', 'middle_name', 'last_name', 'name', 'title',
    'group_id', 'member_id', 'contribution_period_id',
    'amount', 'default_amount', 'required_amount', 'monthly_contribution_amount', 'target_amount',
    'approval_status', 'status', 'role',
    'category', 'description', 'person_responsible',
    'payment_method', 'payment_method_label', 'payment_account_name', 'payment_account_number',
    'payout_channel', 'payout_account_name', 'payout_account_number',
    'transaction_reference', 'reference_number',
    'effective_month', 'period_month', 'payment_date', 'transaction_date', 'due_date', 'target_date',
    'deadline_day', 'cycle_start_date', 'date_registered',
    'is_exempt', 'exempt_reason', 'allow_credit', 'notifications_enabled',
    'email', 'contact_number', 'payment_instructions', 'notes',
    'review_note', 'reviewed_by', 'void_reason', 'voided_by', 'delete_reason', 'deleted_by',
    'submitted_by', 'owner_id', 'avatar_url', 'receipt_url', 'payment_qr_url'
  ];

  function auditTableLabel(tableName) {
    const key = String(tableName || '').trim();
    if (AUDIT_TABLE_LABELS[key]) return AUDIT_TABLE_LABELS[key];
    return key ? key.replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Record';
  }

  function auditActionLabel(action) {
    const key = String(action || '').trim().toUpperCase();
    if (AUDIT_ACTION_LABELS[key]) return AUDIT_ACTION_LABELS[key];
    return key ? `${key.charAt(0)}${key.slice(1).toLowerCase()}` : 'Updated';
  }

  function auditFieldLabel(key, tableName) {
    if (key === 'status') {
      if (tableName === 'profiles') return 'Account status';
      if (tableName === 'members') return 'Member status';
      if (tableName === 'groups') return 'Group status';
      if (tableName === 'savings_goals') return 'Goal status';
    }
    if (key === 'group_id' && tableName === 'profiles') return 'Active savings group';
    if (key === 'member_id' && tableName === 'profiles') return 'Linked member';
    if (AUDIT_FIELD_LABELS[key]) return AUDIT_FIELD_LABELS[key];
    return String(key || '').replaceAll('_', ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  }

  function isSafeAuditImageUrl(value) {
    const str = String(value || '').trim();
    return /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(str)
      || /^https:\/\/\S+$/i.test(str);
  }

  function auditValuesEqual(key, a, b) {
    const aEmpty = a == null || a === '';
    const bEmpty = b == null || b === '';
    if (aEmpty && bEmpty) return true;
    if (aEmpty !== bEmpty) return false;
    if (AUDIT_MONEY_FIELDS.has(key)) {
      const nA = Number(a);
      const nB = Number(b);
      if (Number.isFinite(nA) && Number.isFinite(nB)) return nA === nB;
    }
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return String(a) === String(b);
    }
  }

  function auditRefFallback(prefix, rawId) {
    const shortId = String(rawId || '').trim().slice(0, 8);
    return shortId ? `${prefix} (${shortId})` : prefix;
  }

  function formatAuditValue(key, rawValue, row = {}, lookups = {}) {
    const isEmpty = rawValue == null || rawValue === '';
    if (AUDIT_IMAGE_FIELDS.has(key) || (typeof rawValue === 'string' && /^data:/i.test(rawValue.trim()))) {
      if (isEmpty) {
        const emptyText = key === 'avatar_url'
          ? 'No profile photo'
          : (key === 'payment_qr_url' ? 'No QR code uploaded' : 'No receipt attached');
        return { kind: 'empty', text: emptyText, muted: true };
      }
      const str = String(rawValue).trim();
      if (isSafeAuditImageUrl(str)) {
        const text = key === 'avatar_url'
          ? 'Profile photo'
          : (key === 'payment_qr_url' ? 'Payment QR code' : 'Receipt image');
        return { kind: 'image', src: str, text, caption: text };
      }
      return { kind: 'text', text: 'Uploaded media file', muted: false };
    }

    if (isEmpty) {
      if (key === 'group_id') return { kind: 'empty', text: 'No group assigned', muted: true };
      if (key === 'member_id') return { kind: 'empty', text: 'Not linked', muted: true };
      if (AUDIT_ACTOR_REF_FIELDS.has(key)) return { kind: 'empty', text: 'Not assigned', muted: true };
      return { kind: 'empty', text: 'None', muted: true };
    }

    if (key === 'notifications_enabled') return { kind: 'text', text: rawValue ? 'Enabled' : 'Disabled' };
    if (key === 'allow_credit') return { kind: 'text', text: rawValue ? 'Allowed for future months' : 'Disabled' };
    if (key === 'is_exempt') return { kind: 'text', text: rawValue ? 'Exempted for this month' : 'Required' };
    if (typeof rawValue === 'boolean') return { kind: 'text', text: rawValue ? 'Yes' : 'No' };

    if (AUDIT_MONEY_FIELDS.has(key) && Number.isFinite(Number(rawValue))) {
      return { kind: 'text', text: money(Number(rawValue)) };
    }
    if (key === 'deadline_day' && Number.isFinite(Number(rawValue))) {
      return { kind: 'text', text: `Day ${Number(rawValue)} of each month` };
    }
    if (AUDIT_MONTH_FIELDS.has(key)) {
      return { kind: 'text', text: dateLabel(String(rawValue), { month: 'long', year: 'numeric' }) };
    }
    if (AUDIT_DATE_FIELDS.has(key)) {
      return { kind: 'text', text: dateLabel(String(rawValue), { month: 'short', day: 'numeric', year: 'numeric' }) };
    }
    if (AUDIT_DATETIME_FIELDS.has(key)) {
      return { kind: 'text', text: dateLabel(String(rawValue), { dateStyle: 'medium', timeStyle: 'short' }) };
    }

    if (key === 'payment_method' || key === 'payout_channel') {
      const normalized = normalizePaymentMethod(rawValue);
      return { kind: 'text', text: normalized ? paymentMethodMeta(normalized).label : String(rawValue) };
    }
    if (key === 'role' || key === 'status' || key === 'approval_status') {
      const mapped = AUDIT_ENUM_VALUE_LABELS[String(rawValue).trim().toUpperCase()];
      return { kind: 'text', text: mapped || String(rawValue) };
    }

    const id = String(rawValue).trim();
    if (key === 'group_id') {
      const resolved = lookups.groups?.get(id);
      return { kind: 'text', text: resolved || auditRefFallback('Savings group', id), title: id };
    }
    if (key === 'member_id') {
      const resolved = lookups.members?.get(id);
      return { kind: 'text', text: resolved || auditRefFallback('Member', id), title: id };
    }
    if (key === 'contribution_period_id') {
      const period = lookups.periods?.get(id);
      if (period) {
        const monthText = dateLabel(period.period_month, { month: 'long', year: 'numeric' });
        const memberName = period.member_id ? lookups.members?.get(period.member_id) : '';
        return { kind: 'text', text: memberName ? `${monthText} — ${memberName}` : monthText, title: id };
      }
      return { kind: 'text', text: auditRefFallback('Billing period', id), title: id };
    }
    if (AUDIT_ACTOR_REF_FIELDS.has(key)) {
      const resolved = lookups.profiles?.get(id) || lookups.actors?.get(id);
      return { kind: 'text', text: resolved || auditRefFallback('Account', id), title: id };
    }

    return { kind: 'text', text: String(rawValue) };
  }

  function collectAuditLookupsFromRows(auditRows, baseLookups = {}) {
    const groups = new Map(baseLookups.groups || []);
    const members = new Map(baseLookups.members || []);
    const profiles = new Map(baseLookups.profiles || baseLookups.actors || []);
    const periods = new Map(baseLookups.periods || []);

    for (const row of auditRows || []) {
      const snaps = [row?.old_data, row?.new_data].filter((item) => item && typeof item === 'object');
      for (const snap of snaps) {
        if (row.table_name === 'groups' && snap.id && snap.name && !groups.has(snap.id)) {
          groups.set(snap.id, snap.name);
        }
        if (row.table_name === 'members' && snap.id && snap.full_name && !members.has(snap.id)) {
          members.set(snap.id, snap.full_name);
        }
        if (row.table_name === 'profiles' && snap.id && snap.full_name && !profiles.has(snap.id)) {
          profiles.set(snap.id, snap.full_name);
        }
        if (row.table_name === 'contribution_periods' && snap.id && snap.period_month && !periods.has(snap.id)) {
          periods.set(snap.id, { period_month: snap.period_month, member_id: snap.member_id });
        }
      }
    }
    return { groups, members, profiles, actors: profiles, periods };
  }

  function auditFieldRank(key) {
    const idx = AUDIT_FIELD_ORDER.indexOf(key);
    return idx === -1 ? 999 : idx;
  }

  function auditSubjectLabel(row, lookups) {
    const table = row?.table_name || '';
    const before = row?.old_data || {};
    const after = row?.new_data || {};
    const snap = Object.keys(after).length ? after : before;

    if (table === 'profiles') return snap.full_name || lookups.profiles?.get(row.record_id) || snap.email || 'Account';
    if (table === 'members') return snap.full_name || lookups.members?.get(row.record_id) || 'Member';
    if (table === 'groups') return snap.name || lookups.groups?.get(row.record_id) || 'Savings group';
    if (table === 'savings_goals') return snap.title || 'Savings goal';
    if (table === 'contribution_settings') {
      return snap.effective_month ? `${dateLabel(snap.effective_month, { month: 'long', year: 'numeric' })} schedule` : 'Monthly schedule';
    }
    if (table === 'contribution_periods') {
      const month = snap.period_month ? dateLabel(snap.period_month, { month: 'short', year: 'numeric' }) : 'Period';
      const memberName = snap.member_id ? lookups.members?.get(snap.member_id) : '';
      return memberName ? `${month} — ${memberName}` : month;
    }
    if (table === 'contributions') {
      const period = snap.contribution_period_id ? lookups.periods?.get(snap.contribution_period_id) : null;
      const memberName = period?.member_id ? lookups.members?.get(period.member_id) : '';
      const amountText = snap.amount != null ? `${money(snap.amount)} addition` : 'Addition';
      return memberName ? `${amountText} — ${memberName}` : amountText;
    }
    if (table === 'withdrawals') {
      const amountText = snap.amount != null ? `${money(snap.amount)} deduction` : 'Deduction';
      return snap.category ? `${amountText} (${snap.category})` : amountText;
    }
    if (table === 'expenses') {
      const amountText = snap.amount != null ? `${money(snap.amount)} expense` : 'Expense';
      return snap.category ? `${amountText} (${snap.category})` : amountText;
    }
    if (table === 'group_invite_codes') return snap.code ? `Invite code ${snap.code}` : 'Invite code';
    if (table === 'group_join_requests') return snap.requester_name || lookups.profiles?.get(snap.requester_id) || 'Join request';
    if (table === 'savings_cycle_batches') return snap.title || 'Savings cycle';
    if (table === 'group_memberships') return lookups.members?.get(snap.member_id) || lookups.profiles?.get(snap.user_id) || 'Member permission';
    if (table === 'financial_change_requests') {
      const rType = String(snap.record_type || '').toUpperCase();
      const kind = rType === 'EXPENSE' ? 'expense' : (rType === 'WITHDRAWAL' ? 'deduction' : 'addition');
      return snap.proposed_amount != null ? `${kind.charAt(0).toUpperCase() + kind.slice(1)} edit (${money(snap.proposed_amount)})` : 'Change request';
    }
    return auditTableLabel(table);
  }

  function buildAuditSummary(row, changes, subject, lookups) {
    const action = String(row?.action || 'UPDATE').toUpperCase();
    const table = String(row?.table_name || '');
    const before = row?.old_data || {};
    const after = row?.new_data || {};
    const snap = Object.keys(after).length ? after : before;
    const period = snap.contribution_period_id ? lookups.periods?.get(snap.contribution_period_id) : null;
    const periodMember = period?.member_id ? lookups.members?.get(period.member_id) : '';

    if (action === 'INSERT') {
      if (table === 'profiles') return `Created account for ${snap.full_name || subject}`;
      if (table === 'members') return `Added member ${snap.full_name || subject}`;
      if (table === 'groups') return `Created savings group "${snap.name || subject}"`;
      if (table === 'contribution_settings') return `Set monthly contribution to ${money(snap.default_amount)}`;
      if (table === 'contribution_periods') return `Created ${subject}`;
      if (table === 'contributions') return `Recorded ${money(snap.amount)} addition${periodMember ? ` for ${periodMember}` : ''}`;
      if (table === 'withdrawals') return `Recorded ${money(snap.amount)} deduction${snap.category ? ` (${snap.category})` : ''}`;
      if (table === 'expenses') return `Recorded ${money(snap.amount)} expense${snap.category ? ` (${snap.category})` : ''}`;
      if (table === 'savings_goals') return `Created goal "${snap.title || 'Savings goal'}"`;
      if (table === 'group_invite_codes') return `Created invite code${snap.code ? ` ${snap.code}` : ''}`;
      if (table === 'group_join_requests') return `Submitted join request (${formatAuditValue('source', snap.source, row, lookups).text})`;
      if (table === 'savings_cycle_batches') return `Archived savings cycle "${snap.title || 'Cycle batch'}" (${money(snap.net_savings ?? 0)} net)`;
      if (table === 'financial_change_requests') {
        const rType = String(snap.record_type || '').toUpperCase();
        const entryKind = rType === 'EXPENSE' ? 'expense' : (rType === 'WITHDRAWAL' ? 'deduction' : 'addition');
        return `Requested ${entryKind} edit (${money(snap.current_amount)} → ${money(snap.proposed_amount)})`;
      }
      return `Created ${auditTableLabel(table).toLowerCase()}`;
    }

    if (action === 'DELETE') {
      if (table === 'profiles') return `Removed account for ${before.full_name || subject}`;
      if (table === 'members') return `Deleted member ${before.full_name || subject}`;
      if (table === 'groups') return `Deleted savings group "${before.name || subject}"`;
      if (table === 'contributions') return `Deleted ${money(before.amount)} addition`;
      if (table === 'withdrawals') return `Deleted ${money(before.amount)} deduction`;
      if (table === 'expenses') return `Deleted ${money(before.amount)} expense`;
      if (table === 'savings_goals') return `Deleted goal "${before.title || 'Savings goal'}"`;
      if (table === 'group_invite_codes') return `Deleted invite code${before.code ? ` ${before.code}` : ''}`;
      if (table === 'savings_cycle_batches') return `Purged savings cycle "${before.title || 'Cycle batch'}"`;
      return `Deleted ${auditTableLabel(table).toLowerCase()}`;
    }

    if (action === 'CONFIRM' || action === 'REJECT' || action === 'VOID') {
      const verb = auditActionLabel(action);
      const kind = table === 'contributions' ? 'addition' : (table === 'withdrawals' ? 'deduction' : (table === 'expenses' ? 'expense' : auditTableLabel(table).toLowerCase()));
      const amount = snap.amount != null ? `${money(snap.amount)} ` : '';
      const tail = periodMember ? ` for ${periodMember}` : (snap.category ? ` (${snap.category})` : '');
      return `${verb} ${amount}${kind}${tail}`;
    }

    const keys = new Set(changes.map((c) => c.key));
    if (!before.deleted_at && after.deleted_at) return `Moved ${subject} to recovery bin`;
    if (before.deleted_at && !after.deleted_at) return `Restored ${subject} from recovery bin`;

    if (table === 'profiles' && keys.has('full_name') && keys.size === 1 && before.full_name && after.full_name) {
      return `Renamed account from "${before.full_name}" to "${after.full_name}"`;
    }
    if (table === 'members' && keys.has('full_name') && keys.size === 1 && before.full_name && after.full_name) {
      return `Renamed member from "${before.full_name}" to "${after.full_name}"`;
    }
    if (table === 'groups' && keys.has('name') && keys.size === 1 && before.name && after.name) {
      return `Renamed group from "${before.name}" to "${after.name}"`;
    }
    if (table === 'savings_goals' && keys.has('title') && keys.size === 1 && before.title && after.title) {
      return `Renamed goal from "${before.title}" to "${after.title}"`;
    }

    if (table === 'profiles') {
      if (keys.has('group_id') && [...keys].every((k) => k === 'group_id' || k === 'member_id')) {
        const nextGroupName = after.group_id ? lookups.groups?.get(after.group_id) : '';
        if (!before.group_id && after.group_id) return nextGroupName ? `Joined "${nextGroupName}"` : 'Joined savings group';
        if (before.group_id && !after.group_id) return 'Left active savings group';
        return nextGroupName ? `Switched active group to "${nextGroupName}"` : 'Switched active savings group';
      }
      if (keys.size === 1 && keys.has('member_id')) {
        const mName = after.member_id ? lookups.members?.get(after.member_id) : '';
        return after.member_id ? (mName ? `Linked account to ${mName}` : 'Linked account to member') : 'Unlinked account from member';
      }
      if (keys.size === 1 && keys.has('avatar_url')) return after.avatar_url ? 'Updated profile photo' : 'Removed profile photo';
      if (keys.size === 1 && keys.has('role')) return `Changed role to ${formatAuditValue('role', after.role, row, lookups).text}`;
      if (keys.size === 1 && keys.has('status')) {
      }
    }

    if (table === 'financial_change_requests') {
      if (after.status === 'APPROVED' && before.status !== 'APPROVED') return 'Approved requested record edit';
      if (after.status === 'REJECTED' && before.status !== 'REJECTED') return 'Rejected requested record edit';
      if (after.status === 'CANCELLED' && before.status !== 'CANCELLED') return 'Cancelled requested record edit';
    }

    if (table === 'group_invite_codes') {
      if (!before.revoked_at && after.revoked_at) return `Revoked invite code${snap.code ? ` ${snap.code}` : ''}`;
    }

    if (table === 'group_join_requests') {
      if (after.status === 'APPROVED' && before.status !== 'APPROVED') return `Approved join request for ${subject}`;
      if (after.status === 'DECLINED' && before.status !== 'DECLINED') return `Declined join request for ${subject}`;
      if (after.status === 'CANCELLED' && before.status !== 'CANCELLED') return `Cancelled join request for ${subject}`;
    }

    if (table === 'savings_cycle_batches') {
      if (!before.restored_at && after.restored_at) return `Restored savings cycle "${snap.title || 'Cycle batch'}"`;
    }

    if (table === 'group_memberships') {
      const permKeys = ['can_edit_own_entries', 'require_edit_approval', 'require_add_approval', 'can_record_expenses', 'require_expense_approval', 'can_record_withdrawals', 'require_withdrawal_approval'];
      if ([...keys].some((k) => permKeys.includes(k))) return 'Updated member workspace permissions';
    }

    if (table === 'contribution_periods') {
      if (keys.has('is_exempt')) return after.is_exempt ? `Exempted ${subject}` : `Removed exemption for ${subject}`;
      if (keys.size === 1 && keys.has('required_amount')) return `Updated required contribution to ${money(after.required_amount)}`;
    }

    if (table === 'savings_goals') {
      if (keys.size === 1 && keys.has('status')) {
        if (after.status === 'COMPLETED') return `Completed goal "${subject}"`;
        if (after.status === 'CANCELLED') return `Cancelled goal "${subject}"`;
      }
      if (keys.size === 1 && keys.has('target_amount')) return `Updated goal target to ${money(after.target_amount)}`;
    }

    if (table === 'groups') {
      const paymentKeys = ['payment_qr_url', 'payment_method_label', 'payment_account_name', 'payment_account_number', 'payment_instructions'];
      if (changes.length && changes.every((c) => paymentKeys.includes(c.key))) {
        return keys.size === 1 && keys.has('payment_qr_url') ? 'Updated group payment QR code' : 'Updated group payment details';
      }
      if (keys.size === 1 && keys.has('deadline_day')) return `Set monthly due day to Day ${after.deadline_day}`;
      if (keys.size === 1 && keys.has('allow_credit')) return after.allow_credit ? 'Enabled excess contribution credit' : 'Disabled excess contribution credit';
    }

    if (changes.length === 1) {
      const item = changes[0];
      if (item.key === 'receipt_url') return after.receipt_url ? 'Updated receipt image' : 'Removed receipt image';
      if (AUDIT_MONEY_FIELDS.has(item.key)) return `Updated ${item.label.toLowerCase()} from ${item.before.text} to ${item.after.text}`;
      return `Updated ${item.label.toLowerCase()}`;
    }

    if (changes.length > 1) {
      const shown = changes.slice(0, 2).map((c) => c.label.toLowerCase());
      const extra = changes.length - shown.length;
      return `Updated ${shown.join(' and ')}${extra > 0 ? ` (+${extra} more)` : ''}`;
    }

    return 'Synced record metadata';
  }

  function buildAuditDiffChange(key, rawBefore, rawAfter, row, lookups) {
    const label = auditFieldLabel(key, row?.table_name);
    const before = formatAuditValue(key, rawBefore, row, lookups);
    const after = formatAuditValue(key, rawAfter, row, lookups);
    const beforeEmpty = rawBefore == null || rawBefore === '';
    const afterEmpty = rawAfter == null || rawAfter === '';

    if (AUDIT_ACTION_CONTEXT_FIELDS.has(key) && (beforeEmpty || afterEmpty)) {
      const isCleared = !beforeEmpty && afterEmpty;
      let detailTag = 'Recorded';
      let detailTone = 'neutral';
      if (isCleared) {
        detailTag = 'Previously recorded';
        detailTone = 'cleared';
      } else if (key === 'review_note') {
        detailTag = 'Review note';
        detailTone = 'reason';
      } else if (AUDIT_REASON_FIELDS.has(key)) {
        detailTag = 'Reason';
        detailTone = 'reason';
      } else if (AUDIT_ACTOR_REF_FIELDS.has(key)) {
        detailTag = 'Recorded by';
      } else if (AUDIT_DATETIME_FIELDS.has(key)) {
        detailTag = 'Recorded on';
      }
      return {
        key,
        label,
        display: 'detail',
        detailTag,
        detailTone,
        detailValue: isCleared ? before : after,
        before,
        after
      };
    }

    return {
      key,
      label,
      display: 'diff',
      before,
      after
    };
  }

  function formatAuditEntry(row, rawLookups = {}) {
    const lookups = rawLookups.groups instanceof Map ? rawLookups : collectAuditLookupsFromRows([], rawLookups);
    const action = String(row?.action || 'UPDATE').toUpperCase();
    const table = String(row?.table_name || '');
    const tableLabel = auditTableLabel(table);
    const actionLabel = auditActionLabel(action);
    const subject = auditSubjectLabel(row, lookups);
    const beforeObj = row?.old_data && typeof row.old_data === 'object' ? row.old_data : null;
    const afterObj = row?.new_data && typeof row.new_data === 'object' ? row.new_data : null;

    let mode = 'diff';
    let changes = [];

    if (action === 'INSERT') {
      mode = 'create';
      const source = afterObj || {};
      const hasFullName = Boolean(source.full_name);
      const keys = Object.keys(source).filter((key) => {
        if (AUDIT_SKIP_FIELDS.has(key)) return false;
        if (table !== 'profiles' && key === 'group_id') return false;
        if (hasFullName && (key === 'first_name' || key === 'middle_name' || key === 'last_name')) return false;
        if (source.approval_status === 'PENDING' && (key === 'reviewed_by' || key === 'reviewed_at' || key === 'review_note')) return false;
        if (source.approval_status !== 'VOIDED' && (key === 'voided_by' || key === 'voided_at' || key === 'void_reason')) return false;
        return source[key] != null && source[key] !== '';
      });
      keys.sort((a, b) => auditFieldRank(a) - auditFieldRank(b));
      changes = keys.map((key) => ({
        key,
        label: auditFieldLabel(key, table),
        before: { kind: 'empty', text: 'Not created yet', muted: true },
        after: formatAuditValue(key, source[key], row, lookups)
      }));
    } else if (action === 'DELETE') {
      mode = 'delete';
      const source = beforeObj || {};
      const hasFullName = Boolean(source.full_name);
      const keys = Object.keys(source).filter((key) => {
        if (AUDIT_SKIP_FIELDS.has(key)) return false;
        if (table !== 'profiles' && key === 'group_id') return false;
        if (hasFullName && (key === 'first_name' || key === 'middle_name' || key === 'last_name')) return false;
        return source[key] != null && source[key] !== '';
      });
      keys.sort((a, b) => auditFieldRank(a) - auditFieldRank(b));
      changes = keys.map((key) => ({
        key,
        label: auditFieldLabel(key, table),
        before: formatAuditValue(key, source[key], row, lookups),
        after: { kind: 'empty', text: 'Removed', muted: true }
      }));
    } else {
      mode = 'diff';
      const before = beforeObj || {};
      const after = afterObj || {};
      const allKeys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
      let changedKeys = allKeys.filter((key) => {
        if (AUDIT_SKIP_FIELDS.has(key)) return false;
        if (key === 'updated_by' && row?.changed_by && String(after[key] || '') === String(row.changed_by)) return false;
        return !auditValuesEqual(key, before[key], after[key]);
      });

      const changedSet = new Set(changedKeys);
      if (changedSet.has('full_name')) {
        changedKeys = changedKeys.filter((k) => k !== 'first_name' && k !== 'middle_name' && k !== 'last_name');
      }
      const hasStateTransition = changedSet.has('approval_status') || changedSet.has('status') || changedSet.has('deleted_by') || changedSet.has('deleted_at') || changedSet.has('voided_by');
      if (hasStateTransition && changedKeys.some((k) => !AUDIT_TRANSITION_TIMESTAMPS.has(k))) {
        changedKeys = changedKeys.filter((k) => !AUDIT_TRANSITION_TIMESTAMPS.has(k));
      }

      changes = changedKeys.map((key) => buildAuditDiffChange(key, before[key], after[key], row, lookups));
      changes.sort((a, b) => {
        const aGroup = a.display === 'detail' ? 1 : 0;
        const bGroup = b.display === 'detail' ? 1 : 0;
        if (aGroup !== bGroup) return aGroup - bGroup;
        return auditFieldRank(a.key) - auditFieldRank(b.key);
      });
    }

    const summary = buildAuditSummary(row, changes, subject, lookups);
    const actor = lookups.profiles?.get(row?.changed_by) || lookups.actors?.get(row?.changed_by) || 'System';
    return {
      mode,
      tableLabel,
      actionLabel,
      actor,
      subject,
      summary,
      changes
    };
  }

  // Group Invite Links, 6-Character Join Codes, & Pure-JS ISO-18004 QR Code Engine
  const PENDING_JOIN_CODE_KEY = 'myipon_pending_join_code';
  const PENDING_JOIN_TTL_MS = 2 * 60 * 60 * 1000;
  const CANONICAL_PUBLIC_ORIGIN = 'https://my-ipon.vercel.app';

  function canonicalAppOrigin() {
    try {
      const origin = String(window.location?.origin || '');
      const proto = String(window.location?.protocol || '');
      if (!origin || origin === 'null' || /^(?:capacitor|file|ionic):/i.test(proto)) {
        return CANONICAL_PUBLIC_ORIGIN;
      }
      if (/^https?:\/\/(?:localhost|127\.0\.0\.1|10\.0\.2\.2)(?::\d+)?$/i.test(origin)) {
        // Capacitor Android WebView serves assets from http://localhost or https://localhost
        if (window.Capacitor || /Android|wv\)/i.test(navigator.userAgent || '')) {
          return CANONICAL_PUBLIC_ORIGIN;
        }
      }
      return origin.replace(/\/+$/, '');
    } catch {
      return CANONICAL_PUBLIC_ORIGIN;
    }
  }

  function normalizeInviteCode(raw) {
    return String(raw || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6);
  }

  function isInviteLinkInput(raw) {
    const str = String(raw || '').trim();
    return /^(?:https?:\/\/|www\.)/i.test(str) || /[?&#]join=/i.test(str);
  }

  function extractInviteCode(raw) {
    const str = String(raw || '').trim();
    if (!str) return '';
    if (isInviteLinkInput(str)) {
      try {
        const parsed = new URL(str, CANONICAL_PUBLIC_ORIGIN);
        const qp = parsed.searchParams.get('join');
        return qp ? normalizeInviteCode(qp) : '';
      } catch {
        const match = str.match(/[?&#]join=([A-Za-z0-9-]{1,12})/i);
        return match ? normalizeInviteCode(match[1]) : '';
      }
    }
    return normalizeInviteCode(str);
  }

  function formatInviteCode(raw) {
    const clean = normalizeInviteCode(raw);
    return clean.length > 3 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
  }

  function bindInviteCodeInput(input, { onUpdate } = {}) {
    if (!input) return null;
    let lastEmitted = String(input.value || '');
    const syncValue = () => {
      const raw = String(input.value || '');
      const isUrl = isInviteLinkInput(raw);
      const code = extractInviteCode(raw);
      if (!isUrl || code.length === 6) {
        const formatted = formatInviteCode(code);
        if (input.value !== formatted) input.value = formatted;
      }
      const nextSignal = isUrl && code.length < 6 ? raw : formatInviteCode(code);
      if (nextSignal !== lastEmitted) {
        lastEmitted = nextSignal;
        onUpdate?.(input.value, code);
      }
    };

    input.addEventListener('beforeinput', (event) => {
      const type = String(event.inputType || '');
      if (!type.startsWith('insert') || type === 'insertFromPaste') return;
      const data = String(event.data || '');
      if (!data) return;
      const raw = String(input.value || '');
      if (isInviteLinkInput(raw) || isInviteLinkInput(data)) return;
      const start = typeof input.selectionStart === 'number' ? input.selectionStart : raw.length;
      const end = typeof input.selectionEnd === 'number' ? input.selectionEnd : start;
      const remaining = normalizeInviteCode(raw.slice(0, start) + raw.slice(end));
      if (remaining.length >= 6) {
        event.preventDefault();
      }
    });

    input.addEventListener('input', syncValue);
    return {
      sync() {
        lastEmitted = String(input.value || '');
      }
    };
  }

  function inviteShareUrl(code) {
    const clean = normalizeInviteCode(code);
    if (clean.length !== 6) return '';
    return `${canonicalAppOrigin()}/login.html?join=${encodeURIComponent(clean)}`;
  }

  function setPendingJoinCode(code) {
    const clean = extractInviteCode(code);
    try {
      if (clean.length === 6) {
        localStorage.setItem(PENDING_JOIN_CODE_KEY, JSON.stringify({ code: clean, at: Date.now() }));
      } else {
        localStorage.removeItem(PENDING_JOIN_CODE_KEY);
      }
    } catch { /* ignore */ }
    return clean.length === 6 ? clean : '';
  }

  function getPendingJoinCode() {
    try {
      const urlCode = extractInviteCode(new URLSearchParams(window.location.search).get('join') || '');
      if (urlCode.length === 6) {
        setPendingJoinCode(urlCode);
        return urlCode;
      }
      const stored = JSON.parse(localStorage.getItem(PENDING_JOIN_CODE_KEY) || 'null');
      if (!stored || typeof stored.code !== 'string') return '';
      if (Date.now() - Number(stored.at || 0) > PENDING_JOIN_TTL_MS) {
        localStorage.removeItem(PENDING_JOIN_CODE_KEY);
        return '';
      }
      const clean = normalizeInviteCode(stored.code);
      return clean.length === 6 ? clean : '';
    } catch {
      return '';
    }
  }

  function clearPendingJoinCode() {
    try {
      localStorage.removeItem(PENDING_JOIN_CODE_KEY);
      const parsed = new URL(window.location.href);
      if (parsed.searchParams.has('join') && typeof history?.replaceState === 'function') {
        parsed.searchParams.delete('join');
        history.replaceState(null, '', `${parsed.pathname}${parsed.search}${parsed.hash}`);
      }
    } catch { /* ignore */ }
  }

  async function copyPlainText(text, successMsg = 'Copied to clipboard.') {
    const value = String(text || '');
    if (!value) return false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        if (successMsg) toast(successMsg);
        return true;
      }
    } catch { /* fall back to textarea */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = value;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, value.length);
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok && successMsg) toast(successMsg);
      return ok;
    } catch {
      toast('Could not copy automatically. Please copy the text manually.', 'error');
      return false;
    }
  }

  // Self-contained ISO/IEC 18004 QR encoder (Versions 1-6, ECC Level M, Byte mode)
  const QR_GF_EXP = new Uint8Array(512);
  const QR_GF_LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i += 1) {
    QR_GF_EXP[i] = x;
    QR_GF_EXP[i + 255] = x;
    QR_GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }

  function qrGfMul(a, b) {
    return a && b ? QR_GF_EXP[QR_GF_LOG[a] + QR_GF_LOG[b]] : 0;
  }

  function qrRsEcBytes(data, ecCount) {
    let gen = [1];
    for (let i = 0; i < ecCount; i += 1) {
      const next = new Array(gen.length + 1).fill(0);
      const factor = QR_GF_EXP[i];
      for (let j = 0; j < gen.length; j += 1) {
        next[j] ^= gen[j];
        next[j + 1] ^= qrGfMul(gen[j], factor);
      }
      gen = next;
    }
    const rem = new Uint8Array(ecCount);
    for (let i = 0; i < data.length; i += 1) {
      const factor = data[i] ^ rem[0];
      rem.copyWithin(0, 1);
      rem[ecCount - 1] = 0;
      if (factor) {
        for (let j = 0; j < ecCount; j += 1) {
          rem[j] ^= qrGfMul(gen[j + 1], factor);
        }
      }
    }
    return rem;
  }

  const QR_VERSIONS_M = [
    { ver: 1, size: 21, dataBytes: 16, blocks: 1, blockData: 16, ecBytes: 10, align: [], remBits: 0 },
    { ver: 2, size: 25, dataBytes: 28, blocks: 1, blockData: 28, ecBytes: 16, align: [6, 18], remBits: 7 },
    { ver: 3, size: 29, dataBytes: 44, blocks: 1, blockData: 44, ecBytes: 26, align: [6, 22], remBits: 7 },
    { ver: 4, size: 33, dataBytes: 64, blocks: 2, blockData: 32, ecBytes: 18, align: [6, 26], remBits: 7 },
    { ver: 5, size: 37, dataBytes: 86, blocks: 2, blockData: 43, ecBytes: 24, align: [6, 30], remBits: 7 },
    { ver: 6, size: 41, dataBytes: 108, blocks: 4, blockData: 27, ecBytes: 16, align: [6, 34], remBits: 7 }
  ];

  function generateQrMatrix(text) {
    const bytes = new TextEncoder().encode(String(text || ''));
    const spec = QR_VERSIONS_M.find((v) => bytes.length <= v.dataBytes - 2);
    if (!spec) {
      throw new Error('QR payload exceeds supported Version 6 ECC-M capacity (106 bytes).');
    }

    const bits = [];
    const pushBits = (val, len) => {
      for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
    };
    pushBits(0b0100, 4); // Byte mode
    pushBits(bytes.length, 8);
    for (const b of bytes) pushBits(b, 8);
    const capBits = spec.dataBytes * 8;
    pushBits(0, Math.min(4, capBits - bits.length));
    while (bits.length % 8 !== 0) bits.push(0);
    const padBytes = [0xEC, 0x11];
    for (let i = 0; bits.length < capBits; i += 1) pushBits(padBytes[i % 2], 8);

    const dataCodewords = new Uint8Array(spec.dataBytes);
    for (let i = 0; i < spec.dataBytes; i += 1) {
      let byte = 0;
      for (let b = 0; b < 8; b += 1) byte = (byte << 1) | bits[i * 8 + b];
      dataCodewords[i] = byte;
    }

    const blocks = [];
    const ecs = [];
    for (let b = 0; b < spec.blocks; b += 1) {
      const slice = dataCodewords.slice(b * spec.blockData, (b + 1) * spec.blockData);
      blocks.push(slice);
      ecs.push(qrRsEcBytes(slice, spec.ecBytes));
    }

    const interleaved = [];
    for (let i = 0; i < spec.blockData; i += 1) {
      for (let b = 0; b < spec.blocks; b += 1) interleaved.push(blocks[b][i]);
    }
    for (let i = 0; i < spec.ecBytes; i += 1) {
      for (let b = 0; b < spec.blocks; b += 1) interleaved.push(ecs[b][i]);
    }

    const allBits = [];
    for (const cw of interleaved) {
      for (let b = 7; b >= 0; b -= 1) allBits.push((cw >>> b) & 1);
    }
    for (let i = 0; i < spec.remBits; i += 1) allBits.push(0);

    const size = spec.size;
    const base = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));
    const setFunc = (r, c, v) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      base[r][c] = v ? 1 : 0;
      isFunc[r][c] = 1;
    };

    const drawFinder = (top, left) => {
      for (let r = -1; r <= 7; r += 1) {
        for (let c = -1; c <= 7; c += 1) {
          const dark = r >= 0 && r <= 6 && c >= 0 && c <= 6 && (
            r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
          );
          setFunc(top + r, left + c, dark);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    for (let i = 8; i < size - 8; i += 1) {
      const dark = i % 2 === 0;
      setFunc(6, i, dark);
      setFunc(i, 6, dark);
    }

    if (spec.align.length) {
      for (const cy of spec.align) {
        for (const cx of spec.align) {
          if (isFunc[cy][cx]) continue;
          for (let dy = -2; dy <= 2; dy += 1) {
            for (let dx = -2; dx <= 2; dx += 1) {
              const dark = Math.max(Math.abs(dy), Math.abs(dx)) !== 1;
              setFunc(cy + dy, cx + dx, dark);
            }
          }
        }
      }
    }

    // Reserve Format Info strips & place fixed dark module
    for (let i = 0; i <= 8; i += 1) {
      if (!isFunc[8][i]) isFunc[8][i] = 1;
      if (!isFunc[i][8]) isFunc[i][8] = 1;
    }
    for (let i = size - 8; i < size; i += 1) {
      if (!isFunc[8][i]) isFunc[8][i] = 1;
      if (!isFunc[i][8]) isFunc[i][8] = 1;
    }
    setFunc(size - 8, 8, 1);

    // Zig-zag bit placement
    let bitIdx = 0;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right -= 1;
      for (let step = 0; step < size; step += 1) {
        const r = upward ? (size - 1 - step) : step;
        for (let dx = 0; dx < 2; dx += 1) {
          const c = right - dx;
          if (!isFunc[r][c]) {
            base[r][c] = bitIdx < allBits.length ? allBits[bitIdx] : 0;
            bitIdx += 1;
          }
        }
      }
      upward = !upward;
    }

    const maskFn = [
      (r, c) => (r + c) % 2 === 0,
      (r) => r % 2 === 0,
      (_r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
    ];

    const writeFormatBits = (grid, mask) => {
      const data = mask; // ECC M = 00 -> (0 << 3) | mask
      let rem = data << 10;
      for (let i = 14; i >= 10; i -= 1) {
        if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
      }
      const fmt = ((data << 10) | rem) ^ 0x5412;
      const bit = (idx) => (fmt >>> idx) & 1;

      // Primary copy (bits 14 down to 0)
      for (let c = 0; c <= 5; c += 1) grid[8][c] = bit(14 - c);
      grid[8][7] = bit(8);
      grid[8][8] = bit(7);
      grid[7][8] = bit(6);
      for (let r = 5; r >= 0; r -= 1) grid[r][8] = bit(r);

      // Secondary copy (bits 14..8 bottom-left col 8; bits 7..0 top-right row 8)
      for (let i = 0; i < 7; i += 1) grid[size - 1 - i][8] = bit(14 - i);
      for (let i = 0; i < 8; i += 1) grid[8][size - 8 + i] = bit(7 - i);
    };

    const penaltyScore = (grid) => {
      let score = 0;
      for (let r = 0; r < size; r += 1) {
        let runColor = -1;
        let runLen = 0;
        let patA = 0;
        for (let c = 0; c < size; c += 1) {
          const val = grid[r][c];
          if (val === runColor) {
            runLen += 1;
            if (runLen === 5) score += 3;
            else if (runLen > 5) score += 1;
          } else {
            runColor = val;
            runLen = 1;
          }
          patA = ((patA << 1) | val) & 0x7FF;
          if (c >= 10 && (patA === 0x5D0 || patA === 0x05D)) score += 40;
        }
      }
      for (let c = 0; c < size; c += 1) {
        let runColor = -1;
        let runLen = 0;
        let patA = 0;
        for (let r = 0; r < size; r += 1) {
          const val = grid[r][c];
          if (val === runColor) {
            runLen += 1;
            if (runLen === 5) score += 3;
            else if (runLen > 5) score += 1;
          } else {
            runColor = val;
            runLen = 1;
          }
          patA = ((patA << 1) | val) & 0x7FF;
          if (r >= 10 && (patA === 0x5D0 || patA === 0x05D)) score += 40;
        }
      }
      let darkCount = 0;
      for (let r = 0; r < size; r += 1) {
        for (let c = 0; c < size; c += 1) {
          darkCount += grid[r][c];
          if (r < size - 1 && c < size - 1) {
            const sum = grid[r][c] + grid[r][c + 1] + grid[r + 1][c] + grid[r + 1][c + 1];
            if (sum === 0 || sum === 4) score += 3;
          }
        }
      }
      const k = Math.floor(Math.abs(darkCount * 20 - size * size * 10) / (size * size));
      score += k * 10;
      return score;
    };

    let bestGrid = null;
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      const candidate = Array.from({ length: size }, (_, r) => {
        const row = new Uint8Array(size);
        for (let c = 0; c < size; c += 1) {
          row[c] = isFunc[r][c] ? base[r][c] : (base[r][c] ^ (maskFn[mask](r, c) ? 1 : 0));
        }
        return row;
      });
      writeFormatBits(candidate, mask);
      const sc = penaltyScore(candidate);
      if (sc < bestScore) {
        bestScore = sc;
        bestGrid = candidate;
      }
    }

    return { size, version: spec.ver, modules: bestGrid };
  }

  function qrSvgMarkup(text, { ariaLabel = 'Group invite QR code', size = 216, margin = 4, darkColor = '#0f2e24' } = {}) {
    const qr = generateQrMatrix(text);
    const total = qr.size + margin * 2;
    const cmds = [];
    for (let r = 0; r < qr.size; r += 1) {
      const row = qr.modules[r];
      let c = 0;
      while (c < qr.size) {
        if (!row[c]) { c += 1; continue; }
        let run = 1;
        while (c + run < qr.size && row[c + run]) run += 1;
        cmds.push(`M${c + margin} ${r + margin}h${run}v1h-${run}z`);
        c += run;
      }
    }
    return `<svg class="invite-qr-svg" viewBox="0 0 ${total} ${total}" width="${Number(size) || 216}" height="${Number(size) || 216}" role="img" aria-label="${escapeHtml(ariaLabel)}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#ffffff"/><path d="${cmds.join('')}" fill="${darkColor}"/></svg>`;
  }

  async function downloadInviteQrPng({ code, groupName = 'Savings group', shareUrl = '' } = {}) {
    const clean = normalizeInviteCode(code);
    const url = shareUrl || inviteShareUrl(clean);
    if (!url || clean.length !== 6) throw new Error('Valid invite code required to save QR.');
    const qr = generateQrMatrix(url);
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 780;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');

    // Warm paper outer card
    ctx.fillStyle = '#faf7f0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle outer border
    ctx.strokeStyle = '#d6d2c7';
    ctx.lineWidth = 4;
    ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

    // Header badge + group name
    ctx.fillStyle = '#0d4a36';
    ctx.font = '700 18px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MYIPON · GROUP INVITE', canvas.width / 2, 74);

    ctx.fillStyle = '#18241e';
    ctx.font = '700 30px Georgia, serif';
    const displayTitle = String(groupName || 'Savings group').trim().slice(0, 34);
    ctx.fillText(displayTitle, canvas.width / 2, 118);

    // Crisp white QR frame
    const boxSize = 460;
    const boxX = (canvas.width - boxSize) / 2;
    const boxY = 152;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(boxX, boxY, boxSize, boxSize);
    ctx.strokeStyle = '#dfe5df';
    ctx.lineWidth = 2;
    ctx.strokeRect(boxX, boxY, boxSize, boxSize);

    const pad = 34;
    const cell = Math.floor((boxSize - pad * 2) / qr.size);
    const qrPixelSize = cell * qr.size;
    const startX = Math.round((canvas.width - qrPixelSize) / 2);
    const startY = Math.round(boxY + (boxSize - qrPixelSize) / 2);
    ctx.fillStyle = '#0f2e24';
    for (let r = 0; r < qr.size; r += 1) {
      for (let c = 0; c < qr.size; c += 1) {
        if (qr.modules[r][c]) {
          ctx.fillRect(startX + c * cell, startY + r * cell, cell, cell);
        }
      }
    }

    // Bottom code + instructions
    ctx.fillStyle = '#5f6b64';
    ctx.font = '600 17px "Segoe UI", Arial, sans-serif';
    ctx.fillText('Scan QR with your phone or enter code:', canvas.width / 2, 660);

    ctx.fillStyle = '#0d4a36';
    ctx.font = '700 40px Consolas, "Courier New", monospace';
    ctx.fillText(formatInviteCode(clean), canvas.width / 2, 718);

    const dataUrl = canvas.toDataURL('image/png');
    const slug = String(groupName || 'ipon-group').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ipon-group';
    await downloadFile(dataUrl, `${slug}-invite-${clean}.png`, { mimeType: 'image/png' });
    toast('Saved invite QR card PNG.');
  }

  function inviteExpirySummary(expiresAt) {
    if (!expiresAt) return 'Expires soon';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (Number.isNaN(ms) || ms <= 0) return 'Expired';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return `Expires in ${Math.max(1, mins)}m`;
    const hours = Math.round(ms / 3600000);
    if (hours < 48) return `Expires in ${hours}h`;
    const days = Math.round(hours / 24);
    return `Expires in ${days}d (${dateLabel(expiresAt)})`;
  }

  const inviteOverviewByGroup = new Map();
  const inviteOverviewInFlight = new Map();

  async function fetchInviteOverview({ force = false } = {}) {
    const key = currentProfile?.group_id || 'default';
    if (!force && inviteOverviewByGroup.has(key)) {
      return inviteOverviewByGroup.get(key);
    }
    if (inviteOverviewInFlight.has(key)) {
      return inviteOverviewInFlight.get(key);
    }
    const req = rpc('get_group_invite_overview', {})
      .then((res) => {
        const clean = res || {};
        inviteOverviewByGroup.set(key, clean);
        return clean;
      })
      .finally(() => {
        inviteOverviewInFlight.delete(key);
      });
    inviteOverviewInFlight.set(key, req);
    return req;
  }

  function inviteOverviewSignature(ov) {
    if (!ov) return '';
    const active = ov.active_code || null;
    return JSON.stringify([
      String(ov.workspace_mode || 'GROUP').toUpperCase(),
      active ? [active.id, active.code, Boolean(active.require_approval), active.expires_at, Number(active.use_count || 0), active.max_uses ?? null] : null
    ]);
  }

  let invitePanelSeq = 0;
  function mountInviteCodePanel(container, { groupName = '', initialOverview = null, onChanged = null } = {}) {
    if (!container) return null;
    const pid = `ipon-inv-${++invitePanelSeq}`;
    const cacheKey = currentProfile?.group_id || 'default';
    let stateOverview = initialOverview || inviteOverviewByGroup.get(cacheKey) || null;
    if (initialOverview) inviteOverviewByGroup.set(cacheKey, initialOverview);
    let lastRenderedSig = '';
    let fetchSeq = 0;
    let suppressRefreshUntil = 0;

    function notifyParent(overview) {
      if (typeof onChanged === 'function') {
        Promise.resolve(onChanged(overview)).catch(() => { });
      }
    }

    function applyOverview(nextOverview, { forceRender = false } = {}) {
      stateOverview = nextOverview || {};
      inviteOverviewByGroup.set(cacheKey, stateOverview);
      const nextSig = inviteOverviewSignature(stateOverview);
      if (forceRender || nextSig !== lastRenderedSig) {
        lastRenderedSig = nextSig;
        render();
      }
      notifyParent(stateOverview);
    }

    async function loadOverview({ silent = false, force = false } = {}) {
      if (!force && silent && Date.now() < suppressRefreshUntil) return;
      const mySeq = ++fetchSeq;
      if (!stateOverview && !silent && !container.children.length) {
        container.innerHTML = '<div class="invite-code-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>Loading invite link &amp; QR code…</span></div>';
      }
      try {
        const res = await fetchInviteOverview({ force: true });
        if (mySeq !== fetchSeq) return;
        applyOverview(res || {});
      } catch (error) {
        if (mySeq !== fetchSeq) return;
        if (!stateOverview) {
          lastRenderedSig = '';
          showInlineError(container, error, () => loadOverview({ silent: false, force: true }));
        }
      }
    }

    function render() {
      const mode = String(stateOverview?.workspace_mode || 'GROUP').toUpperCase();
      if (mode === 'SOLO') {
        container.innerHTML = '<div class="empty-state"><h3>Solo savings mode</h3><p>Invite links and group codes are available when this workspace is set to Group savings.</p></div>';
        return;
      }

      const active = stateOverview?.active_code || null;
      const resolvedGroupName = groupName || currentProfile?.group_name || 'Savings group';

      if (!active) {
        container.innerHTML = `
          <div class="invite-code-empty-card">
            <div class="invite-code-empty-head">
              <span class="invite-code-empty-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 21h2M21 14v2"/></svg>
              </span>
              <div>
                <h3>Share a group link &amp; QR code</h3>
                <p>Generate a 6-character code and scannable QR so friends or family can join right from their phone—even before signing up.</p>
              </div>
            </div>
            <div class="invite-code-create-grid">
              <div class="field">
                <label for="${pid}-expiry">Expires after</label>
                <select id="${pid}-expiry" name="expires_hours">
                  <option value="24">24 hours</option>
                  <option value="168" selected>7 days (recommended)</option>
                  <option value="720">30 days</option>
                </select>
              </div>
              <div class="field">
                <label for="${pid}-max-uses">Join limit</label>
                <select id="${pid}-max-uses" name="max_uses">
                  <option value="" selected>Unlimited uses</option>
                  <option value="10">Up to 10 joins</option>
                  <option value="25">Up to 25 joins</option>
                  <option value="50">Up to 50 joins</option>
                </select>
              </div>
            </div>
            <label class="toggle-switch-row invite-approval-toggle" for="${pid}-create-approval">
              <span>
                <strong>Require admin approval before joining</strong>
                <small>When on, anyone scanning or entering the code sends a join request for your approval first.</small>
              </span>
              <input class="toggle-switch-input" id="${pid}-create-approval" type="checkbox" role="switch">
            </label>
            <div class="invite-code-empty-actions">
              <button class="button button-primary" type="button" data-invite-generate>Generate invite link &amp; QR</button>
            </div>
          </div>`;

        container.querySelector('[data-invite-generate]')?.addEventListener('click', async (event) => {
          const btn = event.currentTarget;
          const hours = Number(document.getElementById(`${pid}-expiry`)?.value || 168);
          const maxRaw = document.getElementById(`${pid}-max-uses`)?.value || '';
          const maxUses = maxRaw ? Number(maxRaw) : null;
          const requireApproval = Boolean(document.getElementById(`${pid}-create-approval`)?.checked);
          setBusy(btn, true, 'Generating…');
          try {
            suppressRefreshUntil = Date.now() + 1400;
            const created = await rpc('create_group_invite_code', {
              p_expires_hours: hours,
              p_require_approval: requireApproval,
              p_max_uses: maxUses
            });
            applyOverview({ ...(stateOverview || {}), active_code: created }, { forceRender: true });
            toast('Invite link & QR code ready to share.');
          } catch (error) {
            toast(friendlyError(error), 'error');
          } finally {
            setBusy(btn, false);
          }
        });
        return;
      }

      const rawCode = normalizeInviteCode(active.code);
      const formatted = formatInviteCode(rawCode);
      const shareUrl = inviteShareUrl(rawCode);
      const usesText = active.max_uses
        ? `${Number(active.use_count || 0)} of ${Number(active.max_uses)} used`
        : `${Number(active.use_count || 0)} joined`;
      const qrHtml = qrSvgMarkup(shareUrl, { ariaLabel: `QR code to join ${resolvedGroupName}`, size: 196 });
      const canNativeShare = typeof navigator.share === 'function';

      container.innerHTML = `
        <div class="invite-code-active-card">
          <div class="invite-qr-card">
            <div class="invite-qr-plate">${qrHtml}</div>
            <span class="invite-qr-caption">Scan with a phone camera to join</span>
          </div>
          <button class="invite-code-card" type="button" data-copy-code title="Click to copy 6-character code">
            <span class="invite-code-pill-label">GROUP CODE</span>
            <strong class="invite-code-display tabular-nums">${escapeHtml(formatted)}</strong>
            <span class="invite-code-pill-action">Copy code</span>
          </button>
          <div class="invite-meta-pills">
            <span class="status ${active.require_approval ? 'status-pending' : 'status-confirmed'}" id="${pid}-mode-badge">${active.require_approval ? 'Approval required' : 'Instant join'}</span>
            <span class="status status-unpaid">${escapeHtml(inviteExpirySummary(active.expires_at))}</span>
            <span class="status status-unpaid">${escapeHtml(usesText)}</span>
          </div>
          <div class="invite-share-link-block">
            <label class="invite-section-label" for="${pid}-share-url">Shareable invite link</label>
            <input id="${pid}-share-url" class="invite-url-readonly" type="text" readonly value="${escapeHtml(shareUrl)}" aria-label="Shareable group invite link">
            <button class="button button-primary invite-copy-link-full" type="button" data-copy-link>
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              <span>Copy link</span>
            </button>
          </div>
          <div class="invite-secondary-grid${canNativeShare ? ' has-share' : ''}">
            ${canNativeShare ? '<button class="button button-secondary" type="button" data-native-share>Share</button>' : ''}
            <button class="button button-secondary" type="button" data-download-qr>Save QR</button>
            <button class="button button-secondary" type="button" data-rotate-code>New code</button>
            <button class="button button-secondary invite-revoke-btn" type="button" data-revoke-code>Revoke</button>
          </div>
          <label class="toggle-switch-row invite-approval-card" for="${pid}-require-approval">
            <span>
              <strong>Require admin approval</strong>
              <small>On: an admin approves each request. Off: anyone with this link joins immediately.</small>
            </span>
            <input class="toggle-switch-input" id="${pid}-require-approval" type="checkbox" role="switch" ${active.require_approval ? 'checked' : ''}>
          </label>
        </div>`;

      container.querySelector(`#${pid}-share-url`)?.addEventListener('click', (event) => {
        event.currentTarget.select?.();
      });

      container.querySelector('[data-copy-code]')?.addEventListener('click', async (event) => {
        const pill = event.currentTarget;
        const ok = await copyPlainText(rawCode, `Copied code ${formatted}`);
        const badge = pill.querySelector('.invite-code-pill-action');
        if (ok && badge) {
          badge.textContent = 'Copied!';
          setTimeout(() => { if (badge.isConnected) badge.textContent = 'Copy code'; }, 1600);
        }
      });

      container.querySelector('[data-copy-link]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const ok = await copyPlainText(shareUrl, 'Invite link copied.');
        const labelEl = btn.querySelector('span');
        if (ok) {
          if (labelEl) labelEl.textContent = 'Copied!';
          else btn.textContent = 'Copied!';
          setTimeout(() => {
            if (!btn.isConnected) return;
            if (labelEl) labelEl.textContent = 'Copy link';
            else btn.textContent = 'Copy link';
          }, 1600);
        }
      });

      container.querySelector('[data-native-share]')?.addEventListener('click', async () => {
        try {
          await navigator.share({
            title: `Join "${resolvedGroupName}" on myIPON`,
            text: `Join our savings group "${resolvedGroupName}" on myIPON using code ${formatted} or tap this invite link:`,
            url: shareUrl
          });
        } catch (err) {
          if (err?.name !== 'AbortError') {
            await copyPlainText(shareUrl, 'Invite link copied.');
          }
        }
      });

      container.querySelector('[data-download-qr]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        setBusy(btn, true, 'Saving…');
        try {
          await downloadInviteQrPng({ code: rawCode, groupName: resolvedGroupName, shareUrl });
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          setBusy(btn, false);
        }
      });

      const approvalSwitch = container.querySelector(`#${pid}-require-approval`);
      approvalSwitch?.addEventListener('change', async () => {
        const nextVal = approvalSwitch.checked;
        approvalSwitch.disabled = true;
        suppressRefreshUntil = Date.now() + 1400;
        try {
          const updated = await rpc('update_group_invite_code', {
            p_code_id: active.id,
            p_require_approval: nextVal
          });
          stateOverview = { ...(stateOverview || {}), active_code: updated };
          inviteOverviewByGroup.set(cacheKey, stateOverview);
          lastRenderedSig = inviteOverviewSignature(stateOverview);
          const modeBadge = document.getElementById(`${pid}-mode-badge`);
          if (modeBadge) {
            modeBadge.className = `status ${nextVal ? 'status-pending' : 'status-confirmed'}`;
            modeBadge.textContent = nextVal ? 'Approval required' : 'Instant join';
          }
          toast(nextVal ? 'Approval required before joining.' : 'Instant join enabled for this link.');
          notifyParent(stateOverview);
        } catch (error) {
          approvalSwitch.checked = !nextVal;
          toast(friendlyError(error), 'error');
        } finally {
          approvalSwitch.disabled = false;
        }
      });

      container.querySelector('[data-rotate-code]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const ok = await confirmAction({
          title: 'Generate a new group code?',
          message: `The current code (${formatted}) and its QR link will stop working immediately once a new code is created.`,
          acceptLabel: 'Generate new code'
        });
        if (!ok) return;
        setBusy(btn, true, 'Rotating…');
        suppressRefreshUntil = Date.now() + 1400;
        try {
          const created = await rpc('create_group_invite_code', {
            p_expires_hours: 168,
            p_require_approval: Boolean(active.require_approval),
            p_max_uses: active.max_uses ?? null
          });
          applyOverview({ ...(stateOverview || {}), active_code: created }, { forceRender: true });
          toast(`New code ready: ${formatInviteCode(created.code)}`);
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          setBusy(btn, false);
        }
      });

      container.querySelector('[data-revoke-code]')?.addEventListener('click', async (event) => {
        const btn = event.currentTarget;
        const ok = await confirmAction({
          title: 'Revoke active invite link & code?',
          message: `Code ${formatted} and its QR code will stop working immediately. Existing members will not be affected.`,
          acceptLabel: 'Revoke invite'
        });
        if (!ok) return;
        setBusy(btn, true, 'Revoking…');
        suppressRefreshUntil = Date.now() + 1400;
        try {
          await rpc('update_group_invite_code', { p_code_id: active.id, p_revoke: true });
          applyOverview({ ...(stateOverview || {}), active_code: null }, { forceRender: true });
          toast('Invite link and code revoked.');
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          setBusy(btn, false);
        }
      });
    }

    if (stateOverview) {
      lastRenderedSig = inviteOverviewSignature(stateOverview);
      render();
      notifyParent(stateOverview);
      loadOverview({ silent: true, force: true });
    } else {
      loadOverview({ silent: false, force: true });
    }

    return {
      refresh: (opts = {}) => loadOverview({ silent: opts?.silent !== false, force: Boolean(opts?.force) }),
      setOverview: (ov) => applyOverview(ov),
      getOverview: () => stateOverview
    };
  }

  function renderJoinRequestsQueue(container, { requests = [], onChanged = null } = {}) {
    if (!container) return;
    if (!Array.isArray(requests) || !requests.length) {
      container.innerHTML = '<div class="empty-state"><p>No pending join requests right now.</p></div>';
      return;
    }
    container.innerHTML = `<div class="join-requests-list">${requests.map((req) => `
      <article class="join-request-item" data-join-request-id="${escapeHtml(req.id)}">
        <div class="join-request-user">
          ${avatarMarkup(req.avatar_url, req.full_name, 'avatar-md', req.user_id)}
          <div class="join-request-copy">
            <strong>${escapeHtml(req.full_name || 'User')}</strong>
            ${req.email ? `<span class="join-request-email">${escapeHtml(req.email)}</span>` : ''}
            <div class="join-request-chips">
              ${req.contact_number ? `<span class="join-request-chip">${escapeHtml(req.contact_number)}</span>` : ''}
              ${req.code ? `<span class="join-request-chip">Code ${escapeHtml(formatInviteCode(req.code))}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="join-request-divider" aria-hidden="true"></div>
        <div class="join-request-time">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <span>Requested ${escapeHtml(dateLabel(req.created_at, { dateStyle: 'medium', timeStyle: 'short' }))}</span>
        </div>
        <div class="join-request-actions">
          <button class="button button-secondary" type="button" data-decline-join="${escapeHtml(req.id)}">Decline</button>
          <button class="button button-primary" type="button" data-approve-join="${escapeHtml(req.id)}">Approve</button>
        </div>
      </article>`).join('')}</div>`;
    bindAvatarFallbacks(container);

    container.querySelectorAll('[data-approve-join], [data-decline-join]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const isApprove = Boolean(btn.dataset.approveJoin);
        const requestId = btn.dataset.approveJoin || btn.dataset.declineJoin;
        const item = requests.find((r) => r.id === requestId);
        const ok = await confirmAction({
          title: isApprove ? 'Approve join request?' : 'Decline & block this request?',
          message: isApprove
            ? `Allow ${item?.full_name || 'this user'} to join this savings group as a Member? A member profile will be created or linked automatically.`
            : `Decline ${item?.full_name || 'this user'}'s request to join this group? They will be blocked from joining again using this invite link or code.`,
          acceptLabel: isApprove ? 'Approve' : 'Decline & block'
        });
        if (!ok) return;
        setBusy(btn, true, isApprove ? 'Approving…' : 'Declining…');
        try {
          await rpc('review_group_join_request', {
            p_request_id: requestId,
            p_decision: isApprove ? 'APPROVED' : 'DECLINED'
          });
          toast(isApprove ? `${item?.full_name || 'Member'} joined the group.` : `${item?.full_name || 'User'} declined and blocked from this invite link/code.`);
          if (typeof onChanged === 'function') await onChanged();
        } catch (error) {
          toast(friendlyError(error), 'error');
        } finally {
          setBusy(btn, false);
        }
      });
    });
  }

  function showJoinBlockedDialog({ groupName = '', message = '' } = {}) {
    let dialog = document.getElementById('ipon-join-blocked-dialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="form-dialog join-blocked-dialog" id="ipon-join-blocked-dialog" aria-labelledby="ipon-blocked-title">
          <div class="form-dialog-sheet join-blocked-sheet">
            <header class="form-dialog-header">
              <div>
                <span class="dialog-eyebrow is-danger">Access blocked</span>
                <h2 id="ipon-blocked-title">Unable to join group</h2>
              </div>
              <button class="dialog-close" type="button" id="ipon-blocked-close" aria-label="Close notice">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </header>
            <div class="join-blocked-body">
              <div class="join-blocked-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 9 6 6M15 9l-6 6"/></svg>
              </div>
              <strong id="ipon-blocked-group">This invite link or code is blocked</strong>
              <p id="ipon-blocked-message">Your request was declined by an administrator, so you cannot join with this invite link or code.</p>
            </div>
            <footer class="join-panel-footer">
              <button class="button button-primary" type="button" id="ipon-blocked-ok">Understood</button>
            </footer>
          </div>
        </dialog>`);
      dialog = document.getElementById('ipon-join-blocked-dialog');
    }
    const groupEl = dialog.querySelector('#ipon-blocked-group');
    const msgEl = dialog.querySelector('#ipon-blocked-message');
    if (groupEl) {
      groupEl.textContent = groupName
        ? `Blocked from joining "${groupName}"`
        : 'Blocked from this invite link or code';
    }
    if (msgEl) {
      msgEl.textContent = message || 'Your previous request was declined by an administrator. This invite link or code can no longer be used to join.';
    }
    const closeFn = () => { if (dialog.open) dialog.close(); };
    dialog.querySelector('#ipon-blocked-close').onclick = closeFn;
    dialog.querySelector('#ipon-blocked-ok').onclick = closeFn;
    dialog.onclick = (event) => { if (event.target === dialog) closeFn(); };
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('#ipon-blocked-ok')?.focus();
  }

  let joinPanelSeq = 0;
  function mountJoinGroupPanel(container, { initialCode = '', onCancel = null, onJoined = null } = {}) {
    if (!container) return null;
    const jid = `ipon-jp-${++joinPanelSeq}`;
    container.innerHTML = `
      <form id="${jid}-form" class="join-group-panel-form" novalidate>
        <div class="join-group-panel-body">
          <div class="field field-wide">
            <label class="invite-section-label" for="${jid}-code">Group code or invite link</label>
            <input id="${jid}-code" name="invite_code" class="join-code-input" type="text" maxlength="240" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K9M-4PQ or invite link" aria-describedby="${jid}-error ${jid}-preview" required>
            <small class="field-error" id="${jid}-error" role="alert"></small>
          </div>
          <div class="join-preview-slot" id="${jid}-preview" aria-live="polite"></div>
          <div id="${jid}-pending" hidden></div>
        </div>
        <div class="join-panel-footer">
          <button class="button button-secondary" type="button" id="${jid}-cancel">Cancel</button>
          <button class="button button-primary" type="submit" id="${jid}-submit" disabled>Join group</button>
        </div>
      </form>`;

    const form = container.querySelector(`#${jid}-form`);
    const input = container.querySelector(`#${jid}-code`);
    const errorEl = container.querySelector(`#${jid}-error`);
    const previewSlot = container.querySelector(`#${jid}-preview`);
    const pendingWrap = container.querySelector(`#${jid}-pending`);
    const submitBtn = container.querySelector(`#${jid}-submit`);
    const cancelBtn = container.querySelector(`#${jid}-cancel`);

    let latestPreview = null;
    let previewSeq = 0;
    let blockedDialogShownFor = '';

    const setCodeError = (msg, { inline = true } = {}) => {
      if (!input || !errorEl) return;
      input.setCustomValidity(msg || '');
      if (msg) {
        input.setAttribute('aria-invalid', 'true');
        errorEl.textContent = inline ? msg : '';
      } else {
        input.removeAttribute('aria-invalid');
        errorEl.textContent = '';
      }
    };

    const renderEmptyPreview = () => {
      latestPreview = null;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Join group';
      }
      if (previewSlot) {
        previewSlot.innerHTML = '<div class="join-preview-placeholder"><p>Enter the 6-character code or link from your admin to preview the group.</p></div>';
      }
    };

    const renderPreviewError = (msg) => {
      latestPreview = null;
      setCodeError(msg, { inline: false });
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Join group';
      }
      if (previewSlot) {
        previewSlot.innerHTML = `<div class="join-preview-error" role="alert"><p>${escapeHtml(msg)}</p></div>`;
      }
    };

    async function loadOwnPendingJoinRequests() {
      if (!pendingWrap) return;
      try {
        const res = await rpc('get_group_invite_overview', {});
        const mine = Array.isArray(res?.my_pending_requests) ? res.my_pending_requests : [];
        if (!mine.length) {
          pendingWrap.hidden = true;
          pendingWrap.innerHTML = '';
          return;
        }
        pendingWrap.hidden = false;
        pendingWrap.innerHTML = `
          <div class="join-own-pending-box">
            <strong class="join-own-pending-title">Your pending join requests (${mine.length})</strong>
            ${mine.map((item) => `
              <div class="join-own-pending-row">
                <div>
                  <strong>${escapeHtml(item.group_name)}</strong>
                  <small>Requested ${escapeHtml(dateLabel(item.created_at, { dateStyle: 'medium' }))} · Waiting for approval</small>
                </div>
                <button class="button button-secondary button-sm" type="button" data-cancel-own-req="${escapeHtml(item.id)}">Withdraw</button>
              </div>`).join('')}
          </div>`;
        pendingWrap.querySelectorAll('[data-cancel-own-req]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const reqId = btn.dataset.cancelOwnReq;
            const ok = await confirmAction({
              title: 'Withdraw join request?',
              message: 'You can re-apply later using a valid group code or invite link.',
              acceptLabel: 'Withdraw request'
            });
            if (!ok) return;
            setBusy(btn, true, 'Withdrawing…');
            try {
              await rpc('cancel_own_join_request', { p_request_id: reqId });
              toast('Join request withdrawn.');
              await loadOwnPendingJoinRequests();
              const curCode = extractInviteCode(input?.value || '');
              if (curCode.length === 6) await runPreview(curCode);
            } catch (err) {
              toast(friendlyError(err), 'error');
            } finally {
              setBusy(btn, false);
            }
          });
        });
      } catch {
        pendingWrap.hidden = true;
      }
    }

    async function runPreview(rawVal) {
      const code = extractInviteCode(rawVal);
      if (code.length < 6) {
        setCodeError('');
        renderEmptyPreview();
        return;
      }
      const formattedCode = formatInviteCode(code);
      if (input && input.value !== formattedCode) {
        input.value = formattedCode;
      }
      const seq = ++previewSeq;
      setCodeError('');
      if (submitBtn) submitBtn.disabled = true;
      if (previewSlot) {
        previewSlot.innerHTML = '<div class="join-preview-loading"><span class="loading-spinner" aria-hidden="true"></span><span>Checking group code…</span></div>';
      }
      try {
        const res = await rpc('preview_group_invite_code', { p_code: code });
        if (seq !== previewSeq) return;
        latestPreview = res || null;
        if (!res?.valid) {
          const isBlocked = Boolean(res?.blocked || res?.reason === 'DECLINED_BLOCKED' || res?.reason === 'DISABLED');
          const errMsg = res?.message || (isBlocked ? 'You are blocked from using this invite link or code.' : 'Invite code is invalid or expired.');
          if (isBlocked) {
            setCodeError(errMsg, { inline: false });
            if (previewSlot) {
              previewSlot.innerHTML = `<div class="join-preview-card is-blocked" role="alert">
                <div class="join-preview-head">
                  ${res?.group_name ? avatarMarkup(res.group_avatar_url, res.group_name, 'avatar-md') : ''}
                  <div class="join-preview-info">
                    <strong>${escapeHtml(res?.group_name || 'Access blocked')}</strong>
                    <small>${escapeHtml(errMsg)}</small>
                  </div>
                </div>
                <div class="join-preview-badges"><span class="status status-rejected">Blocked from this link/code</span></div>
              </div>`;
              bindAvatarFallbacks(previewSlot);
            }
            if (submitBtn) {
              submitBtn.disabled = true;
              submitBtn.textContent = 'Blocked';
            }
            if (blockedDialogShownFor !== code) {
              blockedDialogShownFor = code;
              clearPendingJoinCode();
              showJoinBlockedDialog({ groupName: res?.group_name || '', message: res?.message || '' });
            }
          } else {
            renderPreviewError(errMsg);
          }
          return;
        }
        const alreadyMember = Boolean(res.already_member);
        const pendingReq = Boolean(res.pending_request);
        const countLabel = `${Number(res.member_count || 0)} ${Number(res.member_count || 0) === 1 ? 'member' : 'members'}`;
        const policyBadge = res.require_approval
          ? '<span class="status status-pending"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Admin approval required</span>'
          : '<span class="status status-confirmed"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Instant join</span>';
        const statusExtra = alreadyMember
          ? `<div class="join-preview-state"><span>You already belong to this group.</span><button class="button button-secondary button-sm" type="button" data-join-switch-existing="${escapeHtml(res.group_id)}">Open workspace</button></div>`
          : pendingReq
            ? '<div class="join-preview-state"><span>Your join request is already pending admin review.</span></div>'
            : '';

        if (previewSlot) {
          previewSlot.innerHTML = `
            <div class="join-preview-card">
              <div class="join-preview-head">
                ${avatarMarkup(res.group_avatar_url, res.group_name, 'avatar-md')}
                <div class="join-preview-info">
                  <strong>${escapeHtml(res.group_name || 'Savings group')}</strong>
                  <small>${escapeHtml(countLabel)} · ${escapeHtml(inviteExpirySummary(res.expires_at))}</small>
                </div>
              </div>
              <div class="join-preview-badges">${policyBadge}</div>
              ${statusExtra}
            </div>`;
          bindAvatarFallbacks(previewSlot);
          previewSlot.querySelector('[data-join-switch-existing]')?.addEventListener('click', async (ev) => {
            const btn = ev.currentTarget;
            setBusy(btn, true, 'Switching…');
            try {
              const switched = await switchActiveGroup(res.group_id);
              onCancel?.();
              window.location.href = homeForRole(switched?.role || res.existing_role || 'MEMBER');
            } catch (err) {
              toast(friendlyError(err), 'error');
            } finally {
              setBusy(btn, false);
            }
          });
        }
        if (submitBtn) {
          submitBtn.disabled = alreadyMember || pendingReq;
          submitBtn.textContent = res.require_approval ? 'Request to join' : 'Join savings group';
        }
      } catch (err) {
        if (seq !== previewSeq) return;
        renderPreviewError(friendlyError(err));
      }
    }

    cancelBtn?.addEventListener('click', () => {
      clearPendingJoinCode();
      onCancel?.();
    });

    const codeCtrl = bindInviteCodeInput(input, {
      onUpdate: (formattedVal) => runPreview(formattedVal)
    });
    input?.addEventListener('blur', () => {
      const code = extractInviteCode(input.value);
      if (code.length > 0) input.value = formatInviteCode(code);
      codeCtrl?.sync();
      if (code.length > 0 && code.length < 6) {
        setCodeError('Enter all 6 characters of your group code.');
      }
    });
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const code = extractInviteCode(input?.value || '');
      if (code.length !== 6) {
        setCodeError('Enter a valid 6-character group code.');
        input?.focus();
        return;
      }
      if (!latestPreview?.valid) {
        await runPreview(code);
        if (!latestPreview?.valid) return;
      }
      setBusy(submitBtn, true, latestPreview?.require_approval ? 'Sending request…' : 'Joining…');
      try {
        const result = await rpc('join_group_by_code', { p_code: code });
        clearPendingJoinCode();
        if (result?.status === 'PENDING_APPROVAL') {
          toast(result.message || 'Join request sent!');
          onCancel?.();
          if (typeof onJoined === 'function') await onJoined(result);
          return;
        }
        toast(result?.message || `Joined "${result?.group_name || 'savings group'}"!`);
        onCancel?.();
        if (typeof onJoined === 'function') {
          await onJoined(result);
          return;
        }
        window.location.href = homeForRole(result?.role || 'MEMBER');
      } catch (err) {
        const msg = friendlyError(err);
        const blockedGroupName = latestPreview?.group_name || '';
        renderPreviewError(msg);
        if (/blocked|declined|disabled/i.test(msg)) {
          clearPendingJoinCode();
          showJoinBlockedDialog({ groupName: blockedGroupName, message: msg });
        } else {
          toast(msg, 'error');
        }
      } finally {
        setBusy(submitBtn, false);
      }
    });

    const seed = extractInviteCode(initialCode);
    if (input) input.value = seed ? formatInviteCode(seed) : '';
    codeCtrl?.sync();
    setCodeError('');
    loadOwnPendingJoinRequests().catch(() => { });
    if (seed.length === 6) {
      runPreview(seed);
    } else {
      renderEmptyPreview();
    }

    return {
      focus: () => input?.focus(),
      setCode: (code) => {
        const clean = extractInviteCode(code);
        if (input) input.value = clean ? formatInviteCode(clean) : '';
        codeCtrl?.sync();
        runPreview(clean);
      }
    };
  }

  async function openJoinGroupDialog({ initialCode = '', onJoined = null } = {}) {
    if (currentProfile?.role === 'SUPER_ADMIN') {
      toast('Super administrator accounts cannot join savings groups.', 'error');
      return;
    }
    let dialog = document.getElementById('ipon-join-group-dialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="form-dialog join-group-dialog" id="ipon-join-group-dialog" aria-labelledby="ipon-join-dialog-title">
          <div class="form-dialog-sheet join-group-sheet">
            <header class="form-dialog-header">
              <div>
                <span class="dialog-eyebrow">Have a code?</span>
                <h2 id="ipon-join-dialog-title">Join savings group</h2>
                <p id="ipon-join-dialog-copy">Enter a 6-character code or paste an invite link.</p>
              </div>
              <button class="dialog-close" type="button" id="ipon-join-close" aria-label="Close join dialog">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </header>
            <div id="ipon-join-mount"></div>
          </div>
        </dialog>`);
      dialog = document.getElementById('ipon-join-group-dialog');
    }

    const handleClose = () => {
      clearPendingJoinCode();
      if (dialog.open) dialog.close();
    };
    const closeBtn = dialog.querySelector('#ipon-join-close');
    if (closeBtn) closeBtn.onclick = handleClose;
    dialog.onclick = (event) => { if (event.target === dialog) handleClose(); };

    const mountEl = dialog.querySelector('#ipon-join-mount');
    const panel = mountJoinGroupPanel(mountEl, {
      initialCode,
      onCancel: handleClose,
      onJoined
    });
    if (!dialog.open) dialog.showModal();
    if (!extractInviteCode(initialCode)) panel?.focus();
  }

  let resumedJoinOnce = false;
  function maybeResumePendingJoin(profile) {
    if (resumedJoinOnce || !profile || profile.role === 'SUPER_ADMIN') return;
    const page = String(document.body?.dataset?.page || '').toLowerCase();
    if (['login', 'mfa', 'account', 'reset-password', 'super-admin'].includes(page)) return;
    const pending = getPendingJoinCode();
    if (!pending || pending.length !== 6) return;
    resumedJoinOnce = true;
    clearPendingJoinCode();
    setTimeout(() => {
      openJoinGroupDialog({ initialCode: pending }).catch(() => { });
    }, 120);
  }

  async function openCalendarEntryEditDialog(entry, { onSaved = null } = {}) {
    if (!entry?.id || !entry?.type) return null;
    const role = String(currentProfile?.role || 'MEMBER').toUpperCase();
    const perms = currentProfile?.permissions || defaultPermissionsForRole(role);
    if (role !== 'ADMIN' && perms.can_edit_own_entries === false) {
      toast('Editing calendar entries is currently disabled for your account.', 'error');
      return null;
    }

    const typeMeta = entry.type === 'contribution'
      ? { label: 'Savings Addition', cls: 'is-addition', prefix: '+' }
      : entry.type === 'withdrawal'
        ? { label: 'Deduction', cls: 'is-deduction', prefix: '−' }
        : { label: 'Expense', cls: 'is-expense', prefix: '−' };

    const requiresApproval = role !== 'ADMIN' && perms.require_edit_approval !== false;
    const origAmount = Math.round(Number(entry.amount || 0) * 100) / 100;
    const origMethodRaw = String(entry.paymentMethod || '').trim();
    const origMethod = normalizePaymentMethod(origMethodRaw || 'CASH');
    const origNotes = String(entry.notes || '').trim();

    let dialog = document.getElementById('ipon-entry-edit-dialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="form-dialog entry-edit-dialog" id="ipon-entry-edit-dialog" aria-labelledby="ipon-entry-edit-title">
          <div class="form-dialog-sheet entry-edit-sheet">
            <header class="form-dialog-header">
              <div>
                <span class="dialog-eyebrow" id="ipon-entry-edit-eyebrow">Calendar entry</span>
                <h2 id="ipon-entry-edit-title">Edit calendar entry</h2>
                <p id="ipon-entry-edit-copy">Update the amount, payment method, and reason for changing this entry.</p>
              </div>
              <button class="dialog-close" type="button" id="ipon-entry-edit-close" aria-label="Close entry editor">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </header>
            <div class="entry-edit-body">
              <div class="entry-edit-summary" id="ipon-entry-edit-summary"></div>
              <div class="entry-edit-mode-banner" id="ipon-entry-edit-banner" role="note"></div>
              <form id="ipon-entry-edit-form" class="form-grid" novalidate>
                <div class="field">
                  <label for="ipon-entry-edit-amount">New amount</label>
                  <input id="ipon-entry-edit-amount" name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" aria-describedby="ipon-entry-edit-amount-error" required>
                  <small class="field-error" id="ipon-entry-edit-amount-error" role="alert" hidden></small>
                </div>
                <div class="field">
                  <label for="ipon-entry-edit-date-display">Entry date</label>
                  <input id="ipon-entry-edit-date-display" type="text" readonly>
                </div>
                <div class="field field-wide">
                  <span class="field-label">Payment method</span>
                  <div id="ipon-entry-edit-pm-wrap">${paymentMethodPickerHtml('payment_method', 'CASH')}</div>
                </div>
                <div class="field field-wide">
                  <label for="ipon-entry-edit-notes">Notes (optional)</label>
                  <textarea id="ipon-entry-edit-notes" name="notes" rows="2" maxlength="500" placeholder="Optional note attached to this entry"></textarea>
                </div>
                <div class="field field-wide">
                  <label for="ipon-entry-edit-reason">Reason for change <span class="entry-edit-req">(required)</span></label>
                  <textarea id="ipon-entry-edit-reason" name="reason" rows="3" minlength="3" maxlength="500" aria-describedby="ipon-entry-edit-reason-error" placeholder="Explain why the amount or payment method is being updated (e.g. Paid via Maya instead of GCash)" required></textarea>
                  <small class="field-error" id="ipon-entry-edit-reason-error" role="alert" hidden></small>
                </div>
                <div class="form-actions field-wide">
                  <button class="button button-secondary" type="button" id="ipon-entry-edit-cancel">Cancel</button>
                  <button class="button button-primary" type="submit" id="ipon-entry-edit-submit">Send change request</button>
                </div>
              </form>
            </div>
          </div>
        </dialog>`);
      dialog = document.getElementById('ipon-entry-edit-dialog');
      mountPaymentMethodPickers(dialog);
      preparePesoInputs(dialog);
      guardMoneyInput(dialog.querySelector('#ipon-entry-edit-amount'));
    }

    const summaryEl = dialog.querySelector('#ipon-entry-edit-summary');
    const bannerEl = dialog.querySelector('#ipon-entry-edit-banner');
    const form = dialog.querySelector('#ipon-entry-edit-form');
    const amountInput = dialog.querySelector('#ipon-entry-edit-amount');
    const dateInput = dialog.querySelector('#ipon-entry-edit-date-display');
    const notesInput = dialog.querySelector('#ipon-entry-edit-notes');
    const reasonInput = dialog.querySelector('#ipon-entry-edit-reason');
    const submitBtn = dialog.querySelector('#ipon-entry-edit-submit');
    const eyebrowEl = dialog.querySelector('#ipon-entry-edit-eyebrow');
    const titleEl = dialog.querySelector('#ipon-entry-edit-title');
    const copyEl = dialog.querySelector('#ipon-entry-edit-copy');

    if (eyebrowEl) eyebrowEl.textContent = requiresApproval ? 'Change request' : 'Direct edit';
    if (titleEl) titleEl.textContent = requiresApproval ? 'Request entry change' : 'Edit calendar entry';
    if (copyEl) {
      copyEl.textContent = requiresApproval
        ? 'Your change and reason will be sent to a group administrator for approval.'
        : 'Update the amount, payment method, and reason logged for this entry.';
    }
    if (submitBtn) submitBtn.textContent = requiresApproval ? 'Send change request' : 'Save changes';

    const statusLower = String(entry.status || 'CONFIRMED').toLowerCase();
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="entry-edit-summary-top">
          <span class="record-type-pill ${typeMeta.cls}">${escapeHtml(typeMeta.label)}</span>
          <span class="status status-${escapeHtml(statusLower)}">${escapeHtml(entry.status || 'CONFIRMED')}</span>
        </div>
        <div class="entry-edit-summary-main">
          <div>
            <strong>${escapeHtml(entry.subjectName || typeMeta.label)}</strong>
            <small>Current: ${escapeHtml(money(origAmount))} · ${escapeHtml(paymentMethodMeta(origMethod).label)}</small>
          </div>
          <strong class="entry-edit-current-amount">${typeMeta.prefix}${escapeHtml(money(origAmount))}</strong>
        </div>`;
    }

    if (bannerEl) {
      bannerEl.className = `entry-edit-mode-banner ${requiresApproval ? 'is-approval' : 'is-direct'}`;
      bannerEl.innerHTML = requiresApproval
        ? '<strong>Admin approval required:</strong> Savings totals stay unchanged until an administrator accepts your request.'
        : '<strong>Instant update enabled:</strong> Your edit applies immediately and records your reason in the group audit trail.';
    }

    form.reset();
    setFieldError(amountInput, '');
    setFieldError(reasonInput, '');
    amountInput.value = origAmount > 0 ? origAmount.toFixed(2) : '';
    if (dateInput) dateInput.value = entry.date ? dateLabel(entry.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
    notesInput.value = origNotes;
    reasonInput.value = '';
    setPaymentMethod(form, origMethod);

    const closeDialog = () => { if (dialog.open) dialog.close('cancel'); };
    dialog.querySelector('#ipon-entry-edit-close').onclick = closeDialog;
    dialog.querySelector('#ipon-entry-edit-cancel').onclick = closeDialog;
    dialog.onclick = (event) => { if (event.target === dialog) closeDialog(); };

    amountInput.oninput = () => setFieldError(amountInput, '');
    reasonInput.oninput = () => setFieldError(reasonInput, '');

    return new Promise((resolve) => {
      let resolvedValue = null;
      dialog.onclose = () => resolve(resolvedValue);

      form.onsubmit = async (event) => {
        event.preventDefault();
        setFieldError(amountInput, '');
        setFieldError(reasonInput, '');

        const parsedAmount = parseMoneyAmount(amountInput.value, {
          min: 0.01,
          required: true,
          badInput: Boolean(amountInput.validity?.badInput)
        });
        if (!parsedAmount.valid || parsedAmount.value == null) {
          setFieldError(amountInput, parsedAmount.error || 'Enter a valid amount greater than zero.');
          amountInput.focus();
          return;
        }
        const nextAmount = parsedAmount.value;
        const nextMethod = normalizePaymentMethod(form.elements.payment_method?.value || 'CASH');
        const nextNotes = String(notesInput.value || '').trim();
        const reasonText = String(reasonInput.value || '').trim();
        if (reasonText.length < 3 || reasonText.length > 500) {
          setFieldError(reasonInput, 'Enter a clear reason between 3 and 500 characters.');
          reasonInput.focus();
          return;
        }

        const sameAmount = Math.abs(nextAmount - origAmount) < 0.005;
        const sameMethod = Boolean(origMethodRaw) && nextMethod === origMethod;
        const sameNotes = nextNotes === origNotes;
        if (sameAmount && sameMethod && sameNotes) {
          setFieldError(amountInput, 'Update the amount, payment method, or notes before submitting.');
          amountInput.focus();
          return;
        }

        const confirmed = await confirmAction({
          title: requiresApproval ? 'Send change request?' : 'Save entry changes?',
          message: requiresApproval
            ? `Request to update this entry from ${money(origAmount)} (${paymentMethodMeta(origMethod).label}) to ${money(nextAmount)} (${paymentMethodMeta(nextMethod).label})? Your admin will review your reason.`
            : `Update this entry from ${money(origAmount)} (${paymentMethodMeta(origMethod).label}) to ${money(nextAmount)} (${paymentMethodMeta(nextMethod).label})?`,
          acceptLabel: requiresApproval ? 'Send request' : 'Save changes'
        });
        if (!confirmed) return;

        setBusy(submitBtn, true, requiresApproval ? 'Sending…' : 'Saving…');
        try {
          const res = await rpc('submit_record_change_request', {
            p_record_type: entry.type,
            p_record_id: entry.id,
            p_amount: nextAmount,
            p_payment_method: nextMethod,
            p_notes: nextNotes || null,
            p_reason: reasonText
          });
          resolvedValue = res;
          toast(res?.message || (requiresApproval ? 'Change request sent for approval.' : 'Calendar entry updated.'));
          dialog.close('saved');
          if (typeof onSaved === 'function') await onSaved(res);
        } catch (err) {
          toast(friendlyError(err), 'error');
        } finally {
          setBusy(submitBtn, false);
        }
      };

      if (!dialog.open) dialog.showModal();
      amountInput.focus();
    });
  }

  async function openChangeRequestReviewDialog(reqOrId, { allowReview = currentProfile?.role === 'ADMIN', onReviewed = null } = {}) {
    let req = typeof reqOrId === 'object' && reqOrId ? reqOrId : null;
    if (!req && reqOrId) {
      try {
        const list = await rpc('get_pending_financial_change_requests');
        req = (Array.isArray(list) ? list : []).find((item) => String(item.id) === String(reqOrId)) || null;
      } catch { /* fallback below */ }
      if (!req) {
        const client = getClient();
        if (client) {
          const { data } = await client.from('financial_change_requests').select('*').eq('id', reqOrId).maybeSingle();
          if (data) req = data;
        }
      }
    }
    if (!req) {
      toast('This change request is no longer pending or could not be found.', 'error');
      return null;
    }

    let dialog = document.getElementById('ipon-change-request-dialog');
    if (!dialog) {
      document.body.insertAdjacentHTML('beforeend', `
        <dialog class="form-dialog change-review-dialog" id="ipon-change-request-dialog" aria-labelledby="ipon-cr-title">
          <div class="form-dialog-sheet change-review-sheet">
            <header class="form-dialog-header">
              <div>
                <span class="dialog-eyebrow">Request of changes</span>
                <h2 id="ipon-cr-title">Review edit request</h2>
                <p id="ipon-cr-subtitle">Compare the original entry and requested changes before deciding.</p>
              </div>
              <button class="dialog-close" type="button" id="ipon-cr-close" aria-label="Close change request review">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
              </button>
            </header>
            <div class="change-review-body">
              <div class="change-review-requester" id="ipon-cr-requester"></div>
              <div class="change-review-diff" id="ipon-cr-diff"></div>
              <div class="change-review-reason-card" id="ipon-cr-reason"></div>
              <form id="ipon-cr-form" class="change-review-form" novalidate>
                <div class="field field-wide" id="ipon-cr-note-wrap">
                  <label for="ipon-cr-note" id="ipon-cr-note-label">Administrator note (required if rejecting)</label>
                  <textarea id="ipon-cr-note" name="review_note" rows="2" maxlength="500" aria-describedby="ipon-cr-note-error" placeholder="Optional note when accepting, or explain why you are rejecting this change"></textarea>
                  <small class="field-error" id="ipon-cr-note-error" role="alert" hidden></small>
                </div>
                <div class="change-review-actions" id="ipon-cr-actions"></div>
              </form>
            </div>
          </div>
        </dialog>`);
      dialog = document.getElementById('ipon-change-request-dialog');
    }

    const reqWrap = dialog.querySelector('#ipon-cr-requester');
    const diffWrap = dialog.querySelector('#ipon-cr-diff');
    const reasonWrap = dialog.querySelector('#ipon-cr-reason');
    const noteWrap = dialog.querySelector('#ipon-cr-note-wrap');
    const noteInput = dialog.querySelector('#ipon-cr-note');
    const actionsWrap = dialog.querySelector('#ipon-cr-actions');
    const titleEl = dialog.querySelector('#ipon-cr-title');
    const subtitleEl = dialog.querySelector('#ipon-cr-subtitle');

    const status = String(req.status || 'PENDING').toUpperCase();
    const isPending = status === 'PENDING';
    const isOwnRequest = String(req.requested_by || '') === String(currentProfile?.id || '');
    const canDecide = isPending && allowReview && currentProfile?.role === 'ADMIN';
    const typeLabel = req.entry_label || (req.record_type === 'withdrawal' ? 'Deduction' : req.record_type === 'expense' ? 'Expense' : 'Savings Addition');
    const amtChanged = Number(req.current_amount || 0) !== Number(req.proposed_amount || 0);
    const pmChanged = normalizePaymentMethod(req.current_payment_method) !== normalizePaymentMethod(req.proposed_payment_method);
    const notesChanged = String(req.current_notes || '').trim() !== String(req.proposed_notes || '').trim();
    const requesterName = req.requested_by_name || req.subject_name || 'Group member';

    if (titleEl) titleEl.textContent = isPending ? `Review ${typeLabel.toLowerCase()} change` : `Change request (${status.charAt(0) + status.slice(1).toLowerCase()})`;
    if (subtitleEl) subtitleEl.textContent = `${req.subject_name ? `${req.subject_name} · ` : ''}${req.entry_date ? dateLabel(req.entry_date, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}`;

    const editWord = req.record_type === 'withdrawal' ? 'DEDUCTION' : req.record_type === 'expense' ? 'EXPENSE' : 'ADDITION';
    const methodSummary = !pmChanged ? (paymentMethodMeta(req.current_payment_method)?.label || '') : '';

    if (reqWrap) {
      reqWrap.innerHTML = `
        ${avatarMarkup(req.avatar_url || '', requesterName, 'avatar-md')}
        <div class="change-review-requester-info">
          <strong>${escapeHtml(requesterName)}</strong>
          <small>${escapeHtml(typeLabel)}${methodSummary ? ` · ${escapeHtml(methodSummary)}` : ''}${req.created_at ? ` · ${escapeHtml(dateLabel(req.created_at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}` : ''}</small>
        </div>
        <span class="status status-${escapeHtml(status.toLowerCase())}">${escapeHtml(status)}</span>`;
      bindAvatarFallbacks(reqWrap);
    }

    if (diffWrap) {
      diffWrap.innerHTML = `
        <div class="change-summary-card">
          <div class="change-summary-edit">
            <span class="change-summary-eyebrow">${escapeHtml(editWord)} EDIT</span>
            <div class="change-summary-amt-row">
              ${amtChanged
                ? `<span class="change-summary-old-amt">${escapeHtml(money(req.current_amount))}</span><span class="change-summary-arrow" aria-hidden="true">→</span><span class="change-summary-new-amt is-changed">${escapeHtml(money(req.proposed_amount))}</span>`
                : `<span class="change-summary-new-amt">${escapeHtml(money(req.proposed_amount))}</span>`}
            </div>
            ${pmChanged || notesChanged ? `
              <div class="change-summary-deltas">
                ${pmChanged ? `<div class="change-delta-row"><span class="change-delta-k">Method</span>${paymentMethodBadge(req.current_payment_method)}<span class="change-summary-arrow" aria-hidden="true">→</span>${paymentMethodBadge(req.proposed_payment_method)}</div>` : ''}
                ${notesChanged ? `<div class="change-delta-row"><span class="change-delta-k">Notes</span><span class="change-delta-old">${escapeHtml(req.current_notes || 'None')}</span><span class="change-summary-arrow" aria-hidden="true">→</span><span class="change-delta-new">${escapeHtml(req.proposed_notes || 'None')}</span></div>` : ''}
              </div>` : ''}
          </div>
          <div class="change-summary-reason">
            <span class="change-summary-eyebrow">REASON</span>
            <p>${escapeHtml(req.reason || 'No reason provided.')}</p>
            ${req.review_note && !isPending ? `<div class="change-review-decision-note"><strong>Admin note:</strong> ${escapeHtml(req.review_note)}</div>` : ''}
          </div>
        </div>`;
    }

    if (reasonWrap) {
      reasonWrap.innerHTML = '';
      reasonWrap.hidden = true;
    }

    setFieldError(noteInput, '');
    noteInput.value = '';
    if (noteWrap) noteWrap.hidden = !canDecide;

    if (actionsWrap) {
      if (canDecide) {
        actionsWrap.innerHTML = `
          <button class="button button-danger" type="button" id="ipon-cr-reject">Reject</button>
          <button class="button button-primary" type="button" id="ipon-cr-approve">Accept &amp; apply</button>`;
      } else if (isPending && isOwnRequest) {
        actionsWrap.innerHTML = `
          <button class="button button-secondary" type="button" id="ipon-cr-dismiss">Close</button>
          <button class="button button-danger" type="button" id="ipon-cr-withdraw">Withdraw request</button>`;
      } else {
        actionsWrap.innerHTML = '<button class="button button-secondary" type="button" id="ipon-cr-dismiss">Close</button>';
      }
    }

    const closeDialog = () => { if (dialog.open) dialog.close('cancel'); };
    dialog.querySelector('#ipon-cr-close').onclick = closeDialog;
    dialog.querySelector('#ipon-cr-dismiss')?.addEventListener('click', closeDialog);
    dialog.onclick = (event) => { if (event.target === dialog) closeDialog(); };
    noteInput.oninput = () => setFieldError(noteInput, '');

    return new Promise((resolve) => {
      let result = null;
      dialog.onclose = () => resolve(result);

      const handleDecision = async (decision, triggerBtn) => {
        setFieldError(noteInput, '');
        const noteText = String(noteInput.value || '').trim();
        if (decision === 'REJECTED' && noteText.length < 2) {
          setFieldError(noteInput, 'Enter a short reason explaining why this change is rejected.');
          noteInput.focus();
          return;
        }
        const confirmed = await confirmAction({
          title: decision === 'APPROVED' ? 'Accept & apply change request?' : 'Reject change request?',
          message: decision === 'APPROVED'
            ? `Update this ${typeLabel.toLowerCase()} from ${money(req.current_amount)} (${paymentMethodMeta(req.current_payment_method).label}) to ${money(req.proposed_amount)} (${paymentMethodMeta(req.proposed_payment_method).label})?`
            : `Keep the original entry at ${money(req.current_amount)} (${paymentMethodMeta(req.current_payment_method).label}) and notify ${requesterName}?`,
          acceptLabel: decision === 'APPROVED' ? 'Accept & apply' : 'Reject request'
        });
        if (!confirmed) return;

        setBusy(triggerBtn, true, decision === 'APPROVED' ? 'Applying…' : 'Rejecting…');
        try {
          const res = await rpc('review_financial_change_request', {
            p_request_id: req.id,
            p_decision: decision,
            p_review_note: noteText || null
          });
          result = res;
          toast(res?.message || (decision === 'APPROVED' ? 'Change approved and applied.' : 'Change request rejected.'));
          dialog.close(decision.toLowerCase());
          if (typeof onReviewed === 'function') await onReviewed(res);
        } catch (err) {
          toast(friendlyError(err), 'error');
        } finally {
          setBusy(triggerBtn, false);
        }
      };

      dialog.querySelector('#ipon-cr-reject')?.addEventListener('click', (ev) => handleDecision('REJECTED', ev.currentTarget));
      dialog.querySelector('#ipon-cr-approve')?.addEventListener('click', (ev) => handleDecision('APPROVED', ev.currentTarget));
      dialog.querySelector('#ipon-cr-withdraw')?.addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        const ok = await confirmAction({
          title: 'Withdraw change request?',
          message: 'Cancel this pending change request? You can submit a new one anytime.',
          acceptLabel: 'Withdraw'
        });
        if (!ok) return;
        setBusy(btn, true, 'Withdrawing…');
        try {
          await rpc('cancel_financial_change_request', { p_request_id: req.id });
          result = { status: 'CANCELLED', request_id: req.id };
          toast('Change request withdrawn.');
          dialog.close('cancelled');
          if (typeof onReviewed === 'function') await onReviewed(result);
        } catch (err) {
          toast(friendlyError(err), 'error');
        } finally {
          setBusy(btn, false);
        }
      });

      if (!dialog.open) dialog.showModal();
    });
  }

  window.Ipon = {
    get client() { return getClient(); }, configured, init, rpc, money, dateLabel, isoDate, monthStart,
    escapeHtml, initials, avatarMarkup, bindAvatarFallbacks, prepareAvatarDataUrl, prepareImageDataUrl, isSafeImageRef, uploadMediaDataUrl, downloadFile, downloadCsv, printPage, openImageViewer, openVideoViewer, handleNativeBack, bindReceiptPicker, openAvatarCropper, openAccountDialog, normalizeNamePart, validNamePart, validFullName, nameValidationError, fullNameValidationError, nameRuleForField, NAME_RULE, validateNameInput, validateNameFields, prepareNameInputs, syncProfileNameMode, prepareInviteNameInput, validPhoneNumber, validatePhoneInput, prepareNumericInputs, preparePesoInputs, validateNumericInput, MAX_MONEY_AMOUNT, parseMoneyAmount, validateMoneyInput, guardMoneyInput, setFieldError, getValidationMessage, profileNeedsSetup, accountSetupUrl, passwordIssue, bindPasswordStrength, generateTemporaryPassword, autofillTemporaryPassword, prepareTemporaryPassword, mfaSettingsMarkup, bindMfaSettings, requiresMfaChallenge, changePassword, homeForRole, signOut, toast, broadcastAuthEvent, friendlyError, showInlineError, setBusy, setLoading, bindDirtySaveForm, confirmAction, requestRecordAction, showGroupRequiredDialog, renderGroupRequiredCard, inviteAccount, notifyAdminRequestDecision, sendAdminRequestVerificationCode, verifyAdminRequestVerificationCode, submitAdminRequest, unblockAdminRequest, showInviteSummary, switchActiveGroup, defaultPermissionsForRole, refreshMyPermissions, remindUnpaidMembers, bindAnnouncements, subscribeToChanges, isUserOnline, onlineUserIds, syncPresenceDots, getGeminiApiKey, getGeminiModel, callGemini, invokeAccountFunction, notifyAccountStatusChange, withTimeout, registerMemberAvatars, getMemberAvatar, enhanceMemberSelect, enhancePaymentSelect, populateGroupSelect, syncWorkspaceMode,
    getTheme, setTheme, toggleTheme, isDarkTheme, chartThemeOptions, mountThemeControls,
    setOnlineVisibility, syncMessagesBadges,
    updateLocalProfile(patch = {}) {
      if (currentProfile && patch && typeof patch === 'object') Object.assign(currentProfile, patch);
      return currentProfile;
    },
    PAYMENT_METHODS, normalizePaymentMethod, guessPaymentMethodFromLabel, paymentMethodMeta, paymentMethodIconHtml, paymentMethodBadge, paymentMethodPickerHtml, mountPaymentMethodPickers, setPaymentMethod, paymentMethodOptionsHtml,
    CATEGORY_PRESETS, mountCategoryControls, setCategoryPresetGroup, syncCategoryControl,
    payoutChannelOptionsHtml, payoutFieldsetMarkup, mountPayoutFieldsets, setPayoutFields, validatePayoutFields, readPayoutPayload, payoutSummaryChip, renderPayoutDestinationBox,
    computeContributionExcess, bindExcessContributionToggle,
    resolveNotificationTarget, navigateNotificationTarget, openRecordDetails, openFeatureRequestDetails, openPeriodNoticeModal, openNoticeDetailModal, highlightFocus, consumeDeepLink, openCalendarEntryEditDialog, openChangeRequestReviewDialog,
    getRecordCommentCounts, recordDiscussionButtonHtml, openRecordDiscussion,
    checkForAppUpdate, showAppUpdatePrompt, triggerManualRefresh,
    getDeviceNotificationPermission, requestDeviceNotificationPermission, bindDeviceNotificationControls, syncDevicePermissionUI, requestBackgroundUsageAccess, openBackgroundUsagePrompt, maybePromptBackgroundUsage, setNotificationPreference, openLatestApkDownload, maybeShowRetentionReminder, openRetentionPolicyDialog, CURRENT_POLICY_VERSION, openPolicyDialog, hasAcceptedCurrentPolicy, maybeShowPolicyConsentModal,
    auditTableLabel, auditActionLabel, collectAuditLookupsFromRows, formatAuditEntry, createRealtimeChannel,
    canonicalAppOrigin, normalizeInviteCode, extractInviteCode, formatInviteCode, bindInviteCodeInput, inviteShareUrl,
    setPendingJoinCode, getPendingJoinCode, clearPendingJoinCode, copyPlainText,
    generateQrMatrix, qrSvgMarkup, downloadInviteQrPng, mountJoinGroupPanel, openJoinGroupDialog, showJoinBlockedDialog, fetchInviteOverview, mountInviteCodePanel, renderJoinRequestsQueue,
    get profile() { return currentProfile; }
  };
})();
