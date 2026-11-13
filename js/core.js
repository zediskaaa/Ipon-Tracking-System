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
  let currentProfile = null;
  let quickMfaController = null;
  const STARTUP_TIMEOUT_MS = 15000;
  let loaderSafetyTimer = null;

  if (!document.querySelector('link[rel="manifest"]')) {
    document.head.insertAdjacentHTML('beforeend', '<meta name="theme-color" content="#0b3428"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="IPON"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/assets/icon-192.png">');
  }
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => { });
  }

  if (document.body.dataset.page) {
    if (!document.body.classList.contains('security-page')) setLoading(true);
    window.addEventListener('pagehide', () => { document.documentElement.style.visibility = 'hidden'; });
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
      setLoading(true);
    });
  }

  function withTimeout(request) {
    let timer;
    return Promise.race([
      request,
      new Promise((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('The connection timed out.')), STARTUP_TIMEOUT_MS);
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
    return String(value || '').trim().replace(/\s+/g, ' ');
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

  function validNamePart(value) {
    return /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(normalizeNamePart(value));
  }

  const NAME_RULE = 'Use letters, spaces, hyphens, or apostrophes only.';

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

  function validateNameInput(input) {
    const value = normalizeNamePart(input.value);
    const message = !value && input.required ? 'Enter this name.' : value && !validNamePart(value) ? NAME_RULE : '';
    input.setCustomValidity(message);
    setFieldError(input, message);
    return !message;
  }

  function prepareNameInputs() {
    document.querySelectorAll('input[name="first_name"],input[name="middle_name"],input[name="last_name"]').forEach((input) => {
      if (input.dataset.nameBound) return;
      input.dataset.nameBound = 'true';
      input.title = NAME_RULE;
      input.addEventListener('input', () => {
        input.value = input.value.replace(/[^\p{L}\p{M} '\u2019-]/gu, '');
        if (input.hasAttribute('aria-invalid')) validateNameInput(input);
      });
      input.addEventListener('blur', () => validateNameInput(input));
      input.addEventListener('invalid', () => validateNameInput(input));
    });
  }

  const PHONE_RULE = 'Enter 11 digits starting with 09, or +63 followed by 10 digits starting with 9.';

  function validPhoneNumber(value) {
    return /^(?:09\d{9}|\+639\d{9})$/.test(String(value || '').trim());
  }

  function validatePhoneInput(input) {
    const value = input.value.trim();
    const message = !value && input.required ? 'Enter your mobile number.' : value && !validPhoneNumber(value) ? PHONE_RULE : '';
    input.setCustomValidity(message);
    setFieldError(input, message);
    return !message;
  }

  function preparePhoneInputs() {
    document.querySelectorAll('input[type="tel"]').forEach((input) => {
      if (input.dataset.phoneBound) return;
      input.dataset.phoneBound = 'true';
      input.inputMode = 'tel';
      input.maxLength = 13;
      input.title = PHONE_RULE;
      input.addEventListener('input', () => {
        const startsWithPlus = input.value.trimStart().startsWith('+');
        const digits = input.value.replace(/\D/g, '').slice(0, startsWithPlus ? 12 : 11);
        input.value = startsWithPlus ? `+${digits}` : digits;
        if (input.hasAttribute('aria-invalid')) validatePhoneInput(input);
      });
      input.addEventListener('blur', () => validatePhoneInput(input));
      input.addEventListener('invalid', () => validatePhoneInput(input));
    });
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
      });
    });
    document.querySelectorAll('[data-temp-password]').forEach(prepareTemporaryPassword);
  }

  function profileNeedsSetup(profile) {
    return !profile?.first_name?.trim() || !profile?.last_name?.trim() || (profile?.contact_number ? !/^09\d{9}$/.test(profile.contact_number) : false);
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
      <dialog class="notification-dialog" id="notification-dialog" aria-labelledby="notification-title">
        <div class="notification-sheet"><header><div class="notification-heading"><h2 id="notification-title">Notifications</h2><span>Recent activity</span></div><div class="notification-header-actions"><button class="notification-mark-read" id="mark-all-notifications" type="button">Mark all read</button><button class="dialog-close" data-notifications-close type="button" aria-label="Close notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><div class="notification-list" id="notification-list" role="feed"><p class="empty-state">Loading notifications…</p></div></div>
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
            <section class="account-card account-profile-card"><div class="account-profile-identity"><div class="account-avatar-picker"><label class="account-avatar-trigger" for="quick-avatar-input" role="button" tabindex="0" title="Change profile picture" aria-label="Change profile picture"><span class="account-avatar-preview" id="quick-avatar-preview" aria-hidden="true"></span><span class="account-avatar-cam" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span></label><button class="account-avatar-remove" id="quick-avatar-remove" type="button" title="Remove photo" aria-label="Remove profile picture" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><input id="quick-avatar-input" type="file" accept="image/*" hidden></div><span><strong id="quick-account-name">Account</strong><small id="quick-account-role">ROLE</small></span></div><form id="quick-profile-form" class="form-grid form-grid-3"><div class="field"><label for="quick-first-name">First name</label><input id="quick-first-name" name="first_name" maxlength="80" required></div><div class="field"><label for="quick-middle-name">Middle name (optional)</label><input id="quick-middle-name" name="middle_name" maxlength="80"></div><div class="field"><label for="quick-last-name">Last name</label><input id="quick-last-name" name="last_name" maxlength="80" required></div><div class="field field-wide"><label for="quick-contact">Mobile number</label><input id="quick-contact" name="contact_number" type="tel" inputmode="tel" autocomplete="tel" maxlength="13" pattern="(?:09[0-9]{9}|\+639[0-9]{9})" aria-describedby="quick-contact-help quick-contact-error" required><small class="field-help" id="quick-contact-help">Use 09XXXXXXXXX or +639XXXXXXXXX.</small><small class="field-error" id="quick-contact-error" role="alert" hidden></small></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Save changes</button></div></form><div class="account-support" data-role="ADMIN,TREASURER,MEMBER"><div class="account-support-row"><span><strong>Support IPON</strong><small>Optional donations help maintain and improve the system.</small></span><button class="button button-secondary" data-donate-open type="button">Donate me</button></div><div class="account-support-row"><span><strong>Have an idea?</strong><small>Suggest an improvement for the system.</small></span><button class="button button-secondary" data-feature-request-open type="button">Request a feature</button></div><div class="account-support-row"><span><strong>Encounter a problem, error, or bug?</strong><small>Report an issue with screenshots for review.</small></span><button class="button button-secondary" data-bug-report-open type="button">Report a bug</button></div></div></section>
            <div class="account-side-stack"><section class="account-card account-security-card"><header class="account-section-heading"><span class="account-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.8 3.2 8.1 7.5 9.5 4.3-1.4 7.5-4.7 7.5-9.5V6L12 3Z"/><path d="M9.5 12.2 11.3 14l3.5-4"/></svg></span><div><h3>Sign-in security</h3><p>Keep your account secure.</p></div></header><form id="quick-email-form" class="account-inline-form"><div class="field"><label for="quick-email">Email address</label><input id="quick-email" name="email" type="email" autocomplete="email" required></div><button class="button button-secondary" type="submit">Update email</button></form><details class="account-password-disclosure"><summary><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><strong>Change password</strong><svg class="account-disclosure-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><form id="quick-password-form" class="form-grid"><div class="field field-wide"><label for="quick-current-password">Current or temporary password</label><div class="password-control"><input id="quick-current-password" name="current_password" type="password" maxlength="128" autocomplete="current-password" required><button class="password-toggle" type="button" aria-controls="quick-current-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div></div><div class="field"><label for="quick-password">New password</label><div class="password-control"><input id="quick-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" aria-controls="quick-password" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div><small class="field-help">${PASSWORD_RULE}</small></div><div class="field"><label for="quick-password-confirmation">Confirm password</label><div class="password-control"><input id="quick-password-confirmation" name="password_confirmation" type="password" minlength="8" maxlength="128" autocomplete="new-password" required><button class="password-toggle" type="button" aria-controls="quick-password-confirmation" aria-pressed="false" aria-label="Show password" title="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg></button></div></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Change password</button></div></form></details></section>
            <section class="account-card account-preferences"><header class="account-section-heading"><span class="account-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg></span><div><h3>Notifications</h3><p>Manage your notification preferences.</p></div></header><label class="preference-row"><span><strong>In-app notifications</strong><small>Reviews, account changes, and contribution updates.</small></span><input id="quick-notifications-enabled" type="checkbox" aria-label="Enable in-app notifications"></label></section></div>
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
    bindUtilityDialogs();
    bindAccountDialog();
    prepareNameInputs();
    preparePhoneInputs();
  }

  const MAX_BUG_IMAGES = 5;
  const MAX_BUG_IMAGE_BYTES = 2 * 1024 * 1024;
  const MAX_AVATAR_BYTES = 450 * 1024;
  const PICTURE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif|ico|tiff?|jfif|apng)$/i;
  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
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
    const presenceDot = `<span class="presence-dot${isOnline ? ' is-online' : ''}" data-presence-id="${escapeHtml(userId)}" aria-label="${label}" title="${label}"></span>`;
    return `<span class="avatar-presence-wrap ${cls ? `${cls}-wrap` : ''}" data-presence-user="${escapeHtml(userId)}">${circle}${presenceDot}</span>`;
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

  function enhanceMemberSelect(selectEl) {
    if (!selectEl || selectEl.dataset.customEnhanced === 'true') {
      selectEl?._customSelect?.sync();
      return selectEl?._customSelect || null;
    }

    const parent = selectEl.parentNode;
    if (!parent) return null;

    selectEl.dataset.customEnhanced = 'true';

    const wrap = document.createElement('div');
    wrap.className = 'custom-member-select-wrap';

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
        <span class="custom-select-trigger-avatar"></span>
        <span class="custom-select-trigger-label">Select member</span>
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

    const triggerAvatar = trigger.querySelector('.custom-select-trigger-avatar');
    const triggerLabel = trigger.querySelector('.custom-select-trigger-label');

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
      const selectedIndex = selectEl.selectedIndex;
      const opt = selectedIndex >= 0 ? selectEl.options[selectedIndex] : null;
      const val = opt ? opt.value : '';
      const text = opt ? opt.textContent.trim() : 'Select member';
      const isPlaceholder = !val || (opt && opt.disabled);

      triggerLabel.textContent = text;
      triggerLabel.classList.toggle('is-placeholder', isPlaceholder);

      if (isPlaceholder) {
        triggerAvatar.innerHTML = `<span class="custom-avatar-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg></span>`;
      } else {
        const avatarUrl = opt.dataset.avatar || getMemberAvatar(val) || getMemberAvatar(text) || null;
        triggerAvatar.innerHTML = avatarMarkup(avatarUrl, text, 'custom-select-avatar');
        bindAvatarFallbacks(triggerAvatar);
        syncPresenceDots(triggerAvatar);
      }
    }

    function rebuildOptions() {
      menu.replaceChildren();
      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'custom-select-options';

      Array.from(selectEl.options).forEach((opt) => {
        const val = opt.value;
        const text = opt.textContent.trim();
        const isPlaceholder = !val;
        const isSelected = opt.selected;

        const optEl = document.createElement('div');
        optEl.className = `custom-select-option${isSelected ? ' is-selected' : ''}${isPlaceholder ? ' is-placeholder' : ''}`;
        optEl.setAttribute('role', 'option');
        optEl.setAttribute('aria-selected', isSelected ? 'true' : 'false');
        optEl.dataset.value = val;

        const avatarUrl = opt.dataset.avatar || getMemberAvatar(val) || getMemberAvatar(text) || null;
        const avatarHtml = isPlaceholder
          ? `<span class="custom-avatar-placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/></svg></span>`
          : avatarMarkup(avatarUrl, text, 'custom-select-avatar');

        optEl.innerHTML = `
          <div class="custom-select-option-main">
            <span class="custom-select-avatar-slot">${avatarHtml}</span>
            <span class="custom-select-option-name">${escapeHtml(text)}</span>
          </div>
          ${isSelected && !isPlaceholder ? `
            <span class="custom-select-check" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none"><path d="M4 10.5l4 4L16 6.5" stroke="#15803d" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>` : ''}
        `;

        optEl.addEventListener('click', (e) => {
          e.stopPropagation();
          selectEl.value = val;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          selectEl.dispatchEvent(new Event('input', { bubbles: true }));
          syncTrigger();
          rebuildOptions();
          closeMenu();
          trigger.focus();
        });

        optionsContainer.appendChild(optEl);
      });

      menu.appendChild(optionsContainer);
      bindAvatarFallbacks(menu);
      syncPresenceDots(menu);
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

    const observer = new MutationObserver(() => {
      rebuildOptions();
    });
    observer.observe(selectEl, { childList: true, subtree: true });

    rebuildOptions();

    const api = {
      wrap,
      sync: () => {
        rebuildOptions();
      },
      destroy: () => {
        observer.disconnect();
        wrap.replaceWith(selectEl);
        selectEl.classList.remove('custom-select-native');
        delete selectEl.dataset.customEnhanced;
        delete selectEl._customSelect;
      }
    };

    selectEl._customSelect = api;
    return api;
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
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed && compressed.length < dataUrl.length ? compressed : dataUrl);
      };
      image.onerror = () => resolve(dataUrl);
      image.src = dataUrl;
    });
  }

  async function prepareImageDataUrl(file, { maxEdge = 1440, skipCompressBytes = 350 * 1024, maxBytes = MAX_BUG_IMAGE_BYTES } = {}) {
    const ext = (file.name || '').match(PICTURE_FILE_RE)?.[1]?.toLowerCase() || '';
    const isImage = file.type.startsWith('image/') || Boolean(ext);
    if (!isImage) throw new Error(`"${file.name}" is not a picture file.`);
    let dataUrl = await readFileAsDataUrl(file);
    const type = file.type.startsWith('image/') ? file.type : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    if (!dataUrl.startsWith('data:image/') && ext) {
      dataUrl = dataUrl.replace(/^data:[^;,]*/, `data:${type}`);
    }
    if (!dataUrl.startsWith('data:image/')) throw new Error(`"${file.name}" is not a valid picture format.`);
    if (file.size > skipCompressBytes && !/^image\/(gif|svg\+xml)$/i.test(type)) {
      dataUrl = await compressRasterDataUrl(dataUrl, maxEdge, 0.84);
    }
    const approxBytes = Math.ceil((dataUrl.length * 3) / 4);
    if (approxBytes > maxBytes) throw new Error(`"${file.name}" is too large even after compression.`);
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
      const { data, error } = await client.from('profiles').select('first_name,middle_name,last_name,full_name,email,contact_number,notifications_enabled,avatar_url').eq('id', currentProfile.id).single();
      if (error) throw error;
      currentProfile.avatar_url = data.avatar_url || null;
      profileForm.elements.first_name.value = data.first_name || data.full_name?.split(' ')[0] || '';
      profileForm.elements.middle_name.value = data.middle_name || '';
      profileForm.elements.last_name.value = data.last_name || data.full_name?.split(' ').slice(1).join(' ') || '';
      profileForm.elements.contact_number.value = data.contact_number || '';
      emailForm.elements.email.value = data.email || '';
      document.getElementById('quick-notifications-enabled').checked = data.notifications_enabled !== false;
      document.getElementById('quick-account-name').textContent = data.full_name;
      document.getElementById('quick-account-role').textContent = currentProfile.role.replaceAll('_', ' ');
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
      if (!validatePhoneInput(profileForm.elements.contact_number)) return profileForm.elements.contact_number.focus();
      const button = event.submitter;
      const values = new FormData(profileForm);
      setBusy(button, true);
      try {
        await rpc('update_own_profile', { p_first_name: values.get('first_name'), p_middle_name: values.get('middle_name') || null, p_last_name: values.get('last_name'), p_contact_number: values.get('contact_number') || null });
        await loadAccountDialog();
        const name = document.getElementById('quick-account-name').textContent;
        currentProfile.full_name = name;
        document.querySelector('#sidebar-user strong')?.replaceChildren(name);
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
      try { await rpc('set_notification_preferences', { p_enabled: notificationToggle.checked }); toast('Notification preference saved.'); }
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

  async function initNotifications(profile) {
    const client = getClient();
    const list = document.getElementById('notification-list');
    if (!list || !client || !profile) return;
    const load = async () => {
      const { data, error } = await client.from('notifications').select('id,group_id,type,title,message,link,read_at,created_at').order('created_at', { ascending: false }).limit(40);
      if (error) { showInlineError(list, error, load); return; }
      const rows = data || [];
      const unread = rows.filter((item) => !item.read_at).length;
      document.querySelectorAll('[data-notification-count]').forEach((badge) => { badge.textContent = unread; badge.hidden = unread === 0; });
      document.getElementById('mark-all-notifications').hidden = unread === 0;
      list.innerHTML = rows.length ? rows.map((item) => {
        const isInvite = item.type === 'GROUP_INVITE' && !item.read_at;
        return `<article class="notification-item${item.read_at ? '' : ' is-unread'}" data-notification-id="${item.id}">
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
          </div>
          ${item.link && !isInvite ? `<a class="notification-item-open" href="${escapeHtml(item.link)}" aria-label="Open ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>` : ''}
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
      if (!item || !item.classList.contains('is-unread')) return;
      try { await rpc('mark_notification_read', { p_notification_id: Number(item.dataset.notificationId) }); item.classList.remove('is-unread'); await load(); } catch (error) { toast(friendlyError(error), 'error'); }
    };
    document.getElementById('mark-all-notifications').onclick = async () => { try { await rpc('mark_all_notifications_read'); await load(); } catch (error) { toast(friendlyError(error), 'error'); } };
    await load();
    client.channel(`notifications:${profile.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}` }, load).subscribe();
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

  function dismissStartupFailure() {
    document.getElementById('startup-error')?.remove();
    document.querySelector('.app-layout, .comp-frame, .login-page')?.removeAttribute('inert');
  }

  function showStartupFailure(error) {
    if (appInitialized || currentProfile || document.getElementById('startup-error')) return;
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
    mountShell();
    prepareFormValidation();
    prepareNameInputs();
    preparePhoneInputs();
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

      const client = getClient();
      const { data: { session }, error: sessionError } = await withTimeout(client.auth.getSession());
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

      if (document.body.dataset.page !== 'mfa' && await requiresMfaChallenge()) {
        window.location.replace('mfa.html');
        return { configured: true, profile: null, session, redirecting: true };
      }

      const { data: profile, error } = await withTimeout(client.from('profiles')
        .select('id,full_name,first_name,middle_name,last_name,contact_number,role,status,member_id,group_id,avatar_url')
        .eq('id', session.user.id)
        .single());
      if (error) throw error;
      if (!profile.group_id && profile.role !== 'SUPER_ADMIN' && profile.status === 'ACTIVE') {
        const { data: myGroups } = await client.rpc('get_my_groups').catch(() => ({ data: null }));
        if (myGroups && myGroups.length > 0) {
          const firstGroup = myGroups[0];
          await client.rpc('switch_active_group', { p_group_id: firstGroup.group_id }).catch(() => null);
          profile.group_id = firstGroup.group_id;
          profile.role = firstGroup.role || profile.role;
          profile.member_id = firstGroup.member_id || profile.member_id;
        }
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
      if (sidebarUser) sidebarUser.innerHTML = `<strong>${escapeHtml(profile.full_name)}</strong><small>${escapeHtml(profile.role)}</small>`;
      syncProfileAvatars(profile);
      document.querySelectorAll('[data-role]').forEach((element) => {
        const roles = element.dataset.role.split(',');
        element.hidden = !roles.includes(profile.role);
      });
      if (options.requireAuth !== false) watchCrossTabAuth(client, profile.id);
      initNotifications(profile).catch(() => { });
      initPresence(profile);
      appInitialized = true;
      if (options.requireAuth === false) setLoading(false);
      return { configured: true, profile, session };
    } catch (error) {
      setLoading(false);
      if (options.requireAuth !== false) {
        showStartupFailure(error);
      }
      return { configured, profile: null, session: null, failed: true, error };
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
            const { data: profile } = await client.from('profiles').select('role,status').eq('id', session.user.id).maybeSingle();
            if (profile?.status === 'ACTIVE') redirectTo(homeForRole(profile.role));
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
      if (client) await withTimeout(client.auth.signOut({ scope: 'local' }));
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
    return message;
  }

  function showInlineError(container, error, retry, colspan = 1) {
    if (!container) return;
    const content = `<div class="inline-error" role="alert"><strong>Unable to load this section</strong><span>${escapeHtml(friendlyError(error))}</span>${retry ? '<button class="button button-secondary" type="button">Retry</button>' : ''}</div>`;
    container.innerHTML = container.tagName === 'TBODY' ? `<tr><td colspan="${colspan}">${content}</td></tr>` : content;
    const button = container.querySelector('button');
    button?.addEventListener('click', async () => {
      button.disabled = true;
      try { await retry(); } catch (nextError) { showInlineError(container, nextError, retry, colspan); }
    });
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

    const entryType = recordReviewMeta.types[entry?.type] || { label: entry?.typeLabel || 'Financial Record', klass: 'is-addition' };
    const personName = entry?.authorName || entry?.memberName || 'Group member';
    const submitterName = entry?.submittedByName && entry.submittedByName !== personName ? entry.submittedByName : '';
    const amountText = entry && entry.amount !== undefined && entry.amount !== null ? money(entry.amount) : '';

    if (summaryBox) {
      if (entry) {
        const metaChips = [
          entry.date ? `Date: ${dateLabel(entry.date)}` : '',
          entry.periodMonth ? `For ${dateLabel(entry.periodMonth, { month: 'short', year: 'numeric' })}` : '',
          entry.category ? `Category: ${entry.category}` : '',
          entry.reference ? `Ref: ${entry.reference}` : ''
        ].filter(Boolean);
        const detailText = entry.notes || entry.description || '';
        summaryBox.innerHTML = `
          <div class="record-review-summary-top">
            <span class="record-type-pill ${entryType.klass}">${escapeHtml(entryType.label)}</span>
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
          ${detailText ? `<p class="record-review-detail-note">${escapeHtml(detailText)}</p>` : ''}`;
        bindAvatarFallbacks(summaryBox);
        summaryBox.hidden = false;
      } else {
        summaryBox.innerHTML = '';
        summaryBox.hidden = true;
      }
    }

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
          const targetDesc = entry
            ? `${amountText ? `${amountText} ` : ''}(${entryType.label}) for ${personName}`
            : 'this record';
          confirmText.textContent = `You are about to ${meta.verb} ${targetDesc}. Every decision is recorded in the audit trail.`;
        }
        if (confirmNote) {
          confirmNote.hidden = !note;
          confirmNote.textContent = note ? `Note: "${note}"` : '';
        }
        if (submitButton) {
          submitButton.className = `button ${meta.tone === 'danger' ? 'button-danger' : 'button-primary'}`;
          submitButton.textContent = decision === 'CONFIRM' && amountText ? `Yes, confirm ${amountText}` : meta.submitLabel;
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
    const name = item.author_name || (isOwner ? 'Owner' : 'Administrator');
    const avatarHtml = avatarMarkup(item.author_avatar_url, name, `announcement-avatar${isOwner ? ' is-owner' : ''}`, item.author_id);
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

    let html = '';
    let inRequestedBox = false;
    let requestedBoxItems = [];
    let requestedBoxHeading = '';

    const flushRequestedBox = () => {
      if (!inRequestedBox) return;
      html += `
        <div class="announcement-requested-card">
          <div class="announcement-requested-accent" aria-hidden="true"></div>
          <div class="announcement-requested-inner">
            <strong class="announcement-requested-title">${escapeHtml(requestedBoxHeading)}</strong>
            <div class="announcement-requested-list">
              ${requestedBoxItems.map((item) => {
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
      inRequestedBox = false;
      requestedBoxItems = [];
      requestedBoxHeading = '';
    };

    const isRequestedHeader = (l) => {
      const trimmed = (l || '').trim();
      return /^(?:features?\s+requested|community\s+requested|requested\s+by\s+savers|community\s+spotlight|user-requested\s+features)\b/i.test(trimmed) && trimmed.endsWith(':');
    };

    const isOutro = (l) => {
      return /(?:grateful|thank\s+you|happy\s+saving|enjoy\s+the\s+new\s+update)/i.test(l);
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        if (inRequestedBox && i + 1 < lines.length && isOutro(lines[i + 1])) {
          flushRequestedBox();
        }
        continue;
      }

      if (isRequestedHeader(line)) {
        flushRequestedBox();
        inRequestedBox = true;
        requestedBoxHeading = line;
        continue;
      }

      if (inRequestedBox) {
        if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
          const itemText = line.replace(/^[•\-*]\s*/, '').trim();
          requestedBoxItems.push(itemText);
          continue;
        } else if (isOutro(line)) {
          flushRequestedBox();
        } else {
          requestedBoxItems.push(line);
          continue;
        }
      }

      if (isOutro(line)) {
        flushRequestedBox();
        const restLines = lines.slice(i).map((l) => l.trim()).filter(Boolean);
        html += `<div class="announcement-outro-block"><p>${restLines.map((l) => escapeHtml(l)).join('<br>')}</p></div>`;
        break;
      }

      if (line.startsWith('•') || line.startsWith('-') || line.startsWith('*')) {
        const cleanLine = line.replace(/^[•\-*]\s*/, '').trim();
        let titlePart = '';
        let descPart = cleanLine;

        const delimMatch = cleanLine.match(/^(.*?)(:\s+|—\s*|\s+-\s+)(.*)$/);
        if (delimMatch) {
          titlePart = delimMatch[1].trim();
          descPart = delimMatch[3].trim();
        }

        html += `
          <div class="announcement-feature-row">
            <span class="announcement-feature-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none" width="18" height="18">
                <circle cx="10" cy="10" r="9" fill="#0d4a36" />
                <path d="M6 10.2l2.6 2.6L14 7.6" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <div class="announcement-feature-text">
              ${titlePart ? `<strong class="announcement-feature-name">${escapeHtml(titlePart)} — </strong>` : ''}
              <span class="announcement-feature-desc">${escapeHtml(descPart)}</span>
            </div>
          </div>`;
        continue;
      }

      let paraHtml = escapeHtml(line);
      paraHtml = paraHtml.replace(/\b(myIPON\s+Update\s+[\w\.\-]+|v\d+[\w\.\-]*)\b/gi, (match) => {
        return `<span class="announcement-version-highlight">${match}</span>`;
      });

      html += `<p class="announcement-intro-para">${paraHtml}</p>`;
    }

    flushRequestedBox();
    return html;
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
        const role = entry.role || 'MEMBER';
        const isOwner = role === 'SUPER_ADMIN';
        const isAdmin = role === 'ADMIN';
        const isTreasurer = role === 'TREASURER';
        const roleClass = isOwner ? 'is-owner' : isAdmin ? 'is-admin' : isTreasurer ? 'is-treasurer' : 'is-member';
        const roleLabel = isOwner ? 'Owner' : isAdmin ? 'Admin' : isTreasurer ? 'Treasurer' : 'Member';
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
              <span class="reaction-user-role-badge ${roleClass}">${roleLabel}</span>
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
        const descHasRequested = /(?:features\s+requested|community\s+feature|community\s+spotlight)/i.test(item.description || '');
        if (descHasRequested) return;
        try {
          const { data: relFeats } = await getClient().rpc('get_release_features', {
            p_release_version: item.release_version
          });
          if (openItemId !== item.id || !viewerDialog.open || !Array.isArray(relFeats) || !relFeats.length) return;
          viewerReleaseFeatures.innerHTML = `
            <section class="announcement-release-section" aria-label="Features requested by users">
              <div class="announcement-section-heading">
                <span class="announcement-section-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor"/></svg>
                </span>
                <div>
                  <h3 class="announcement-section-title">Features requested by users</h3>
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
                            <span class="release-credit-label">Requested by</span>
                            <span class="presence-avatar-wrap">
                              <span class="avatar-cell release-credit-thumb" data-user-id="${escapeHtml(feat.requester_id || '')}">${avatarHtml}</span>
                            </span>
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
                      <p class="release-feature-details">${escapeHtml(feat.details)}</p>
                    </div>`;
          }).join('')}
              </div>
            </section>`;
          bindAvatarFallbacks(viewerReleaseFeatures);
          syncPresenceDots(viewerReleaseFeatures);
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
    const run = () => { pending = pending.then(refresh).catch((error) => toast(friendlyError(error), 'error')); };
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
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    window.addEventListener('pagehide', () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      client.removeChannel(channel);
    }, { once: true });
    return channel;
  }

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    setLoading(false);
    console.warn('Unhandled rejection:', event.reason);
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
    'gemini-flash-lite-latest',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-flash-latest',
    'gemini-1.5-flash',
    'gemini-2.5-flash'
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
        timer = setTimeout(() => ctrl.abort(), 3500);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(curModel)}:generateContent?key=${encodeURIComponent(key)}`;
        const body = {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 1000
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
        if (!/404|503|429|unavailable|high demand/i.test(err.message)) {
          throw err;
        }
      }
    }
    throw lastError || new Error('Could not connect to Google Gemini API.');
  }

  if (document.body.dataset.page && !document.body.classList.contains('security-page')) mountShell();
  prepareFormValidation();

  window.Ipon = {
    get client() { return getClient(); }, configured, init, rpc, money, dateLabel, isoDate, monthStart,
    escapeHtml, initials, avatarMarkup, bindAvatarFallbacks, prepareAvatarDataUrl, openAvatarCropper, normalizeNamePart, validNamePart, validateNameInput, validPhoneNumber, validatePhoneInput, setFieldError, getValidationMessage, profileNeedsSetup, accountSetupUrl, passwordIssue, bindPasswordStrength, generateTemporaryPassword, autofillTemporaryPassword, prepareTemporaryPassword, mfaSettingsMarkup, bindMfaSettings, requiresMfaChallenge, changePassword, homeForRole, signOut, toast, broadcastAuthEvent, friendlyError, showInlineError, setBusy, setLoading, confirmAction, requestRecordAction, inviteAccount, notifyAdminRequestDecision, sendAdminRequestVerificationCode, verifyAdminRequestVerificationCode, submitAdminRequest, unblockAdminRequest, showInviteSummary, switchActiveGroup, bindAnnouncements, subscribeToChanges, isUserOnline, onlineUserIds, syncPresenceDots, getGeminiApiKey, getGeminiModel, callGemini, invokeAccountFunction, notifyAccountStatusChange, withTimeout, registerMemberAvatars, getMemberAvatar, enhanceMemberSelect,
    get profile() { return currentProfile; }
  };
})();
