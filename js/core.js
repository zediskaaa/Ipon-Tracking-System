(function () {
  'use strict';

  const config = window.IPON_CONFIG || {};
  const configured = /^https:\/\/.+\.supabase\.co$/i.test(config.supabaseUrl || '')
    && config.supabaseAnonKey
    && !config.supabaseAnonKey.startsWith('YOUR_');
  const client = configured && window.supabase
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
  let currentProfile = null;
  const STARTUP_TIMEOUT_MS = 15000;

  if (document.body.dataset.page) {
    window.addEventListener('pagehide', () => { document.documentElement.style.visibility = 'hidden'; });
    window.addEventListener('pageshow', async (event) => {
      if (!event.persisted) return;
      if (!client) return document.documentElement.style.removeProperty('visibility');
      try {
        const { data: { session }, error } = await client.auth.getSession();
        if (error || !session) return window.location.replace('login.html');
        document.documentElement.style.removeProperty('visibility');
      } catch {
        window.location.replace('login.html');
      }
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
    ['members', 'members.html', 'Members', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'],
    ['reports', 'reports.html', 'Reports', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></svg>'],
    ['audit', 'audit.html', 'Audit log', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-7 4h8m-8 4h8m-8 4h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/></svg>', 'ADMIN'],
    ['settings', 'settings.html', 'Settings', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06.06 2.83 2.83-.06-.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z"/></svg>']
  ];
  const superAdminNavItems = [
    ['overview', 'super-admin.html#overview', 'Overview', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>'],
    ['requests', 'super-admin.html#requests', 'Requests', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4zM8 9h8m-8 4h5"/></svg>'],
    ['administrators', 'super-admin.html#administrators', 'Administrators', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-1 2 2 4-4"/></svg>'],
    ['activity', 'super-admin.html#activity', 'Platform activity', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h6m-7 4h8m-8 4h8m-8 4h5M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1 2-2V5a2 2 0 0 1 2-2Z"/></svg>']
  ];
  const userNavItems = [
    ['user', 'user.html', 'My savings', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>']
  ];
  const pageRoles = {
    dashboard: ['ADMIN', 'TREASURER'], members: ['ADMIN'], contributions: ['ADMIN', 'TREASURER'],
    withdrawals: ['ADMIN', 'TREASURER'], expenses: ['ADMIN', 'TREASURER'], savings: ['ADMIN'],
    reports: ['ADMIN', 'TREASURER'], audit: ['ADMIN'], settings: ['ADMIN'], user: ['MEMBER'],
    'super-admin': ['SUPER_ADMIN'], account: ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER']
  };
  const recordTabIcons = {
    'contributions.html':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/></svg>',
    'withdrawals.html':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
    'expenses.html':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/></svg>',
    'savings.html':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4m0 1h11l-2 4 2 4H5"/></svg>'
  };

  function setLoading(visible, label = 'Opening your records…') {
    let loader = document.getElementById('app-loader');
    if (!loader) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="app-loader" id="app-loader" role="status" aria-live="polite" hidden>
          <div class="loader-sheet">
            <strong class="loader-brand">IPON</strong>
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
    document.getElementById('loader-label').textContent = label;
    loader.hidden = !visible;
    loader.setAttribute('aria-busy', String(visible));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
  }

  function normalizeNamePart(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  const PASSWORD_RULE = 'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.';

  function passwordIssue(value, personalValues = []) {
    if (value.length < 12 || value.length > 128) return PASSWORD_RULE;
    if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) return PASSWORD_RULE;
    const password = value.toLocaleLowerCase();
    const personalTokens = personalValues.flatMap((item) => String(item || '').split('@')[0].split(/[^\p{L}\p{N}]+/u)).filter((item) => item.length >= 3);
    if (personalTokens.some((item) => password.includes(item.toLocaleLowerCase()))) return 'Do not include your name or email in your password.';
    return '';
  }

  function bindPasswordStrength(input, personalValues = () => []) {
    const indicator = document.createElement('div');
    indicator.className = 'password-strength';
    indicator.innerHTML = '<meter min="0" max="5" value="0" aria-label="Password strength"></meter><small aria-live="polite">Enter a new password.</small>';
    input.closest('.field')?.append(indicator);
    const update = () => {
      const value = input.value;
      const score = [value.length >= 12, /[a-z]/.test(value), /[A-Z]/.test(value), /[0-9]/.test(value), /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
      const issue = value ? passwordIssue(value, personalValues()) : '';
      indicator.querySelector('meter').value = score;
      indicator.dataset.strength = !value ? 'empty' : issue ? (score >= 4 ? 'medium' : 'weak') : 'strong';
      indicator.querySelector('small').textContent = !value ? 'Enter a new password.' : issue || 'Strong password. All requirements are met.';
    };
    input.addEventListener('input', update);
    update();
    return { element: indicator, update };
  }

  function validNamePart(value) {
    return /^[\p{L}\p{M}]+(?:[ '\u2019-][\p{L}\p{M}]+)*$/u.test(normalizeNamePart(value));
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
    <a class="app-brand brand" data-region="brand" href="dashboard.html" aria-label="IPON home">
      <svg class="brand-coins" viewBox="0 0 44 40" aria-hidden="true">
        <ellipse cx="26" cy="9" rx="11" ry="4" fill="#edd189"/>
        <path d="M15 11v4.5c0 2.2 4.9 4 11 4s11-1.8 11-4V11c0 2.2-4.9 4-11 4s-11-1.8-11-4Z" fill="#d1a650"/>
        <path d="M15 17v4.5c0 2.2 4.9 4 11 4s11-1.8 11-4V17c0 2.2-4.9 4-11 4s-11-1.8-11-4Z" fill="#e5c270"/>
        <path d="M15 23v4.5c0 2.2 4.9 4 11 4s11-1.8 11-4V23c0 2.2-4.9 4-11 4s-11-1.8-11-4Z" fill="#c99c44"/>
        <ellipse cx="14" cy="23" rx="9.5" ry="3.6" fill="#f3da99"/>
        <path d="M4.5 25v4.2c0 2 4.3 3.6 9.5 3.6s9.5-1.6 9.5-3.6V25c0 2-4.3 3.6-9.5 3.6S4.5 27 4.5 25Z" fill="#d8b05c"/>
        <path d="M4.5 30.8v4.2c0 2 4.3 3.6 9.5 3.6s9.5-1.6 9.5-3.6v-4.2c0 2-4.3 3.6-9.5 3.6s-9.5-1.6-9.5-3.6Z" fill="#eac878"/>
      </svg>
      <span class="brand-text">
        <strong>IPON</strong>
        <small>TRACKING SYSTEM</small>
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

  function mountShell(role = currentProfile?.role) {
    const host = document.getElementById('app-sidebar');
    if (host) {
      const page = document.body.dataset.page;
      const superAdminPanel = document.body.dataset.panel === 'super-admin';
      const navigation = superAdminPanel || role === 'SUPER_ADMIN' ? superAdminNavItems : role === 'MEMBER' ? userNavItems : navItems;
      const activeId = superAdminPanel ? location.hash.slice(1) || 'overview' : ['contributions', 'withdrawals', 'expenses', 'savings'].includes(page) ? 'contributions' : page;
      host.innerHTML = `
        ${brandHtml.replace('href="dashboard.html"', `href="${superAdminPanel ? 'super-admin.html' : 'dashboard.html'}"`)}
        <nav class="app-nav" aria-label="Main navigation">
          ${navigation.map(([id, href, label, icon, role]) => `<a class="${activeId === id ? 'is-active' : ''}" href="${href}" aria-label="${label}" data-nav-section="${id}"${activeId === id ? ' aria-current="page"' : ''}${role ? ` data-role="${role}"` : ''}>${icon || ''}<span>${label}</span></a>`).join('')}
        </nav>
        ${sidebarArtHtml}
        <div class="app-sidebar-footer">
          <div class="sidebar-utilities">
            <button class="sidebar-utility" data-notifications-open type="button" aria-label="Open notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg><b data-notification-count hidden>0</b></button>
            <button class="sidebar-utility" data-donate-open type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span>Donate</span></button>
          </div>
          <button class="sidebar-user-card" data-account-open type="button" aria-label="Open my account">
            <span class="sidebar-user-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>
            </span>
            <div class="sidebar-user-info" id="sidebar-user">
              <strong>Checking session…</strong>
              <small>ACCOUNT</small>
            </div>
            <svg class="sidebar-user-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <button class="sidebar-signout text-button" id="sign-out" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/></svg>
            <span>Sign out</span>
          </button>
        </div>`;
      document.getElementById('sign-out')?.addEventListener('click', signOut);
    }
    document.querySelectorAll('.record-tabs a').forEach((link) => {
      const label = link.textContent.trim();
      link.setAttribute('aria-label', label);
      link.innerHTML = `${recordTabIcons[link.getAttribute('href')] || ''}<span>${escapeHtml(label)}</span>`;
    });
    if (!document.getElementById('app-toast')) document.body.insertAdjacentHTML('beforeend', `
      <div class="toast" id="app-toast" role="status" aria-live="polite"></div>
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
      <dialog class="notification-dialog" id="notification-dialog" aria-labelledby="notification-title">
        <div class="notification-sheet"><header><div class="notification-heading"><h2 id="notification-title">Notifications</h2><span>Recent activity</span></div><div class="notification-header-actions"><button class="notification-mark-read" id="mark-all-notifications" type="button">Mark all read</button><button class="dialog-close" data-notifications-close type="button" aria-label="Close notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div></header><div class="notification-list" id="notification-list" role="feed"><p class="empty-state">Loading notifications…</p></div></div>
      </dialog>
      <dialog class="donate-dialog" id="donate-dialog" aria-labelledby="donate-title">
        <div class="donate-sheet"><button class="dialog-close" data-donate-close type="button" aria-label="Close donation information">&times;</button><h2 id="donate-title">Support IPON</h2><p>Donations are voluntary support for the system developer and are never included in group savings or reports.</p><span>GCash number</span><strong id="donate-number">09913564248</strong><button class="button button-primary" id="copy-donate-number" type="button">Copy number</button></div>
      </dialog>
      <dialog class="account-dialog" id="account-dialog" aria-labelledby="quick-account-title">
        <div class="account-dialog-sheet">
          <header class="account-dialog-header"><div class="account-dialog-title"><span class="account-header-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg></span><div><h2 id="quick-account-title">My account</h2><p>Manage your account settings and preferences.</p></div></div><button class="dialog-close" data-account-close type="button" aria-label="Close account settings"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
          <div class="account-dialog-content">
            <section class="account-card account-profile-card"><header class="account-section-heading"><span class="account-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg></span><div><h3>Profile</h3><p>Update your personal information.</p></div></header><div class="account-profile-identity"><span class="account-profile-avatar" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg></span><span><strong id="quick-account-name">Account</strong><small id="quick-account-role">ROLE</small></span></div><form id="quick-profile-form" class="form-grid form-grid-3"><div class="field"><label for="quick-first-name">First name</label><input id="quick-first-name" name="first_name" maxlength="80" required></div><div class="field"><label for="quick-middle-name">Middle name</label><input id="quick-middle-name" name="middle_name" maxlength="80"></div><div class="field"><label for="quick-last-name">Last name</label><input id="quick-last-name" name="last_name" maxlength="80" required></div><div class="field field-wide"><label for="quick-contact">Mobile number</label><input id="quick-contact" name="contact_number" type="tel" pattern="(?:09[0-9]{9}|\+639[0-9]{9})"></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Save changes</button></div></form></section>
            <div class="account-side-stack"><section class="account-card account-security-card"><header class="account-section-heading"><span class="account-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 4.5 6v5.5c0 4.8 3.2 8.1 7.5 9.5 4.3-1.4 7.5-4.7 7.5-9.5V6L12 3Z"/><path d="M9.5 12.2 11.3 14l3.5-4"/></svg></span><div><h3>Sign-in security</h3><p>Keep your account secure.</p></div></header><form id="quick-email-form" class="account-inline-form"><div class="field"><label for="quick-email">Email address</label><input id="quick-email" name="email" type="email" autocomplete="email" required></div><button class="button button-secondary" type="submit">Update email</button></form><details class="account-password-disclosure"><summary><span aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span><strong>Change password</strong><svg class="account-disclosure-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><form id="quick-password-form" class="form-grid"><div class="field"><label for="quick-password">New password</label><input id="quick-password" name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><small class="field-help">${PASSWORD_RULE}</small></div><div class="field"><label for="quick-password-confirmation">Confirm password</label><input id="quick-password-confirmation" name="password_confirmation" type="password" minlength="12" maxlength="128" autocomplete="new-password" required></div><div class="form-actions field-wide"><button class="button button-primary" type="submit">Change password</button></div></form></details></section>
            <section class="account-card account-preferences"><header class="account-section-heading"><span class="account-section-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg></span><div><h3>Notifications</h3><p>Manage your notification preferences.</p></div></header><label class="preference-row"><span><strong>In-app notifications</strong><small>Reviews, account changes, and contribution updates.</small></span><input id="quick-notifications-enabled" type="checkbox" aria-label="Enable in-app notifications"></label></section></div>
          </div>
        </div>
      </dialog>`);
    bindUtilityDialogs();
    bindAccountDialog();
  }

  function bindUtilityDialogs() {
    const notifications = document.getElementById('notification-dialog');
    const donate = document.getElementById('donate-dialog');
    const account = document.getElementById('account-dialog');
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
    document.querySelectorAll('[data-donate-open]').forEach((button) => button.onclick = () => donate?.showModal());
    document.querySelectorAll('[data-donate-close]').forEach((button) => button.onclick = () => donate?.close());
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
  }

  async function loadAccountDialog() {
    if (!client || !currentProfile) return;
    const dialog = document.getElementById('account-dialog');
    const profileForm = document.getElementById('quick-profile-form');
    const emailForm = document.getElementById('quick-email-form');
    dialog.setAttribute('aria-busy', 'true');
    try {
      const { data, error } = await client.from('profiles').select('first_name,middle_name,last_name,full_name,email,contact_number,notifications_enabled').eq('id', currentProfile.id).single();
      if (error) throw error;
      profileForm.elements.first_name.value = data.first_name || data.full_name?.split(' ')[0] || '';
      profileForm.elements.middle_name.value = data.middle_name || '';
      profileForm.elements.last_name.value = data.last_name || data.full_name?.split(' ').slice(1).join(' ') || '';
      profileForm.elements.contact_number.value = data.contact_number || '';
      emailForm.elements.email.value = data.email || '';
      document.getElementById('quick-notifications-enabled').checked = data.notifications_enabled !== false;
      document.getElementById('quick-account-name').textContent = data.full_name;
      document.getElementById('quick-account-role').textContent = currentProfile.role.replaceAll('_', ' ');
    } finally {
      dialog.removeAttribute('aria-busy');
    }
  }

  async function openAccountDialog() {
    const dialog = document.getElementById('account-dialog');
    if (!dialog || !currentProfile) return;
    dialog.showModal();
    try { await loadAccountDialog(); }
    catch (error) { toast(friendlyError(error), 'error'); }
  }

  function bindAccountDialog() {
    const profileForm = document.getElementById('quick-profile-form');
    if (!profileForm || profileForm.dataset.bound) return;
    profileForm.dataset.bound = 'true';
    const emailForm = document.getElementById('quick-email-form');
    const passwordForm = document.getElementById('quick-password-form');
    const notificationToggle = document.getElementById('quick-notifications-enabled');
    bindPasswordStrength(passwordForm.elements.password, () => [profileForm.elements.first_name.value, profileForm.elements.middle_name.value, profileForm.elements.last_name.value, emailForm.elements.email.value]);
    profileForm.addEventListener('submit', async (event) => {
      event.preventDefault();
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
        const { error } = await client.auth.updateUser({ email: emailForm.elements.email.value.trim() });
        if (error) throw error;
        toast('Check your email to confirm the change.');
      } catch (error) { toast(friendlyError(error), 'error'); }
      finally { setBusy(button, false); }
    });
    passwordForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const password = passwordForm.elements.password.value;
      if (password !== passwordForm.elements.password_confirmation.value) return toast('Passwords do not match.', 'error');
      const issue = passwordIssue(password, [profileForm.elements.first_name.value, profileForm.elements.middle_name.value, profileForm.elements.last_name.value, emailForm.elements.email.value]);
      if (issue) return toast(issue, 'error');
      const button = event.submitter;
      setBusy(button, true, 'Changing…');
      try {
        await changePassword(password);
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

  async function initNotifications(profile) {
    const list = document.getElementById('notification-list');
    if (!list || !client || !profile) return;
    const load = async () => {
      const { data, error } = await client.from('notifications').select('id,title,message,link,read_at,created_at').order('created_at', { ascending: false }).limit(40);
      if (error) { showInlineError(list, error, load); return; }
      const rows = data || [];
      const unread = rows.filter((item) => !item.read_at).length;
      document.querySelectorAll('[data-notification-count]').forEach((badge) => { badge.textContent = unread; badge.hidden = unread === 0; });
      document.getElementById('mark-all-notifications').hidden = unread === 0;
      list.innerHTML = rows.length ? rows.map((item) => `<article class="notification-item${item.read_at ? '' : ' is-unread'}" data-notification-id="${item.id}"><span class="notification-item-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg></span><div class="notification-item-copy"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${dateLabel(item.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small></div>${item.link ? `<a class="notification-item-open" href="${escapeHtml(item.link)}" aria-label="Open ${escapeHtml(item.title)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></a>` : ''}${item.read_at ? '' : '<i class="notification-unread" aria-label="Unread"></i>'}</article>`).join('') : '<p class="empty-state">You have no notifications yet.</p>';
    };
    list.onclick = async (event) => {
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
      if (body) new MutationObserver(applyLabels).observe(body, { childList:true });
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

  function showStartupFailure(error) {
    if (document.getElementById('startup-error')) return;
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
          <strong class="loader-brand">IPON</strong>
          <div class="startup-error-mark" aria-hidden="true"><i></i></div>
          <h1 id="startup-error-title">Unable to load your records</h1>
          <p>${escapeHtml(message)}</p>
          <div class="startup-error-actions">
            <button class="button button-primary" id="startup-retry" type="button">Retry</button>
            <button class="button button-secondary" id="startup-signout" type="button">Sign out</button>
          </div>
          <small>Your saved records were not changed.</small>
        </div>
      </section>`);
    const retry = document.getElementById('startup-retry');
    retry.addEventListener('click', () => window.location.reload());
    document.getElementById('startup-signout').addEventListener('click', signOut);
    retry.focus();
  }

  function homeForRole(role) {
    return role === 'SUPER_ADMIN' ? 'super-admin.html' : role === 'MEMBER' ? 'user.html' : 'dashboard.html';
  }

  async function init(options = {}) {
    mountShell();
    prepareResponsiveTables();
    applyInputDateBounds();
    setLoading(true);
    try {
      if (!configured) {
        showSetupBanner();
        const sidebarUser = document.getElementById('sidebar-user');
        if (sidebarUser) sidebarUser.innerHTML = '<strong>Offline mode</strong><small>NOT CONNECTED</small>';
        document.querySelectorAll('[data-requires-data]').forEach((element) => { element.disabled = true; });
        return { configured: false, profile: null, session: null };
      }

      const { data: { session }, error: sessionError } = await withTimeout(client.auth.getSession());
      if (sessionError) throw sessionError;
      if (!session && options.requireAuth !== false) {
        window.location.replace('login.html');
        return { configured: true, profile: null, session: null };
      }
      if (!session) return { configured: true, profile: null, session: null };

      const { data: profile, error } = await withTimeout(client.from('profiles')
        .select('id,full_name,role,status,member_id,group_id')
        .eq('id', session.user.id)
        .single());
      if (error) throw error;
      currentProfile = profile;
      if (profile.status !== 'ACTIVE' && options.allowPending !== true) {
        await client.auth.signOut();
        window.location.replace('login.html?status=pending');
        return { configured: true, profile, session };
      }
      if (session.user.app_metadata?.must_change_password && document.body.dataset.page !== 'account') {
        window.location.replace('account.html?force_password=1');
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
      document.querySelectorAll('[data-role]').forEach((element) => {
        const roles = element.dataset.role.split(',');
        element.hidden = !roles.includes(profile.role);
      });
      initNotifications(profile).catch(() => {});
      return { configured: true, profile, session };
    } catch (error) {
      showStartupFailure(error);
      return { configured, profile: null, session: null, failed: true };
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    const accepted = await confirmAction({ title: 'Sign out?', message: 'You will need to sign in again to access the system.', acceptLabel: 'Sign out' });
    if (!accepted) return;
    try {
      if (client) await withTimeout(client.auth.signOut({ scope: 'local' }));
    } finally {
      window.location.replace('login.html');
    }
  }

  function toast(message, tone = 'success') {
    const element = document.getElementById('app-toast');
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
    element.classList.add('is-visible');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => element.classList.remove('is-visible'), 3500);
  }

  function friendlyError(error) {
    const message = error?.message || 'Something went wrong. Please try again.';
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
      button.dataset.originalLabel = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
    }
  }

  function confirmAction({ title, message, acceptLabel = 'Confirm' }) {
    const dialog = document.getElementById('confirm-dialog');
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-accept').textContent = acceptLabel;
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
      dialog.showModal();
    });
  }

  async function rpc(name, params) {
    if (!client) throw new Error('Supabase is not connected.');
    const { data, error } = await client.rpc(name, params);
    if (error) throw error;
    return data;
  }

  async function changePassword(password) {
    const { error } = await client.functions.invoke('manage-account', { body: { action: 'change-password', password } });
    if (error) {
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(detail?.error || error.message);
    }
    const { error: refreshError } = await client.auth.refreshSession();
    if (refreshError) throw refreshError;
  }

  function subscribeToChanges(name, tables, refresh) {
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
    window.addEventListener('pagehide', () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', resume);
      client.removeChannel(channel);
    }, { once: true });
    return channel;
  }

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    setLoading(false);
    showStartupFailure(event.reason);
  });

  window.Ipon = {
    client, configured, init, rpc, money, dateLabel, isoDate, monthStart,
    escapeHtml, normalizeNamePart, validNamePart, passwordIssue, bindPasswordStrength, changePassword, homeForRole, signOut, toast, friendlyError, showInlineError, setBusy, setLoading, confirmAction, subscribeToChanges,
    get profile() { return currentProfile; }
  };
})();
