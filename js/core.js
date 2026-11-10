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
    ['settings', 'settings.html', 'Settings', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09A1.65 1.65 0 0 0 19.4 15Z"/></svg>']
  ];

  function setLoading(visible, label = 'Opening your records…') {
    let loader = document.getElementById('app-loader');
    if (!loader) {
      document.body.insertAdjacentHTML('beforeend', `
        <div class="app-loader" id="app-loader" role="status" aria-live="polite" hidden>
          <div class="loader-sheet">
            <strong class="loader-brand">IPON</strong>
            <span class="loader-stamp" aria-hidden="true"><i></i></span>
            <p id="loader-label">Opening your records…</p>
            <small>Checking your account and latest entries.</small>
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

  function mountShell() {
    const host = document.getElementById('app-sidebar');
    if (host) {
      const page = document.body.dataset.page;
      const activeId = ['contributions', 'withdrawals', 'expenses', 'savings'].includes(page) ? 'contributions' : page;
      host.innerHTML = `
        ${brandHtml}
        <nav class="app-nav" aria-label="Main navigation">
          ${navItems.map(([id, href, label, icon, role]) => `<a class="${activeId === id ? 'is-active' : ''}" href="${href}"${activeId === id ? ' aria-current="page"' : ''}${role ? ` data-role="${role}"` : ''}>${icon || ''}<span>${label}</span></a>`).join('')}
        </nav>
        ${sidebarArtHtml}
        <div class="app-sidebar-footer">
          <div class="sidebar-user-card">
            <span class="sidebar-user-avatar" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>
            </span>
            <div class="sidebar-user-info" id="sidebar-user">
              <strong>Checking session…</strong>
              <small>ACCOUNT</small>
            </div>
            <svg class="sidebar-user-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </div>
          <button class="sidebar-signout text-button" id="sign-out" type="button">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9"/></svg>
            <span>Sign out</span>
          </button>
        </div>`;
      document.getElementById('sign-out')?.addEventListener('click', signOut);
    }
    if (!document.getElementById('app-toast')) document.body.insertAdjacentHTML('beforeend', `
      <div class="toast" id="app-toast" role="status" aria-live="polite"></div>
      <dialog class="confirm-dialog" id="confirm-dialog">
        <form method="dialog">
          <p class="eyebrow">Please confirm</p>
          <h2 id="confirm-title">Continue?</h2>
          <p id="confirm-message"></p>
          <div class="dialog-actions">
            <button class="button button-secondary" value="cancel">Cancel</button>
            <button class="button button-primary" id="confirm-accept" value="confirm">Confirm</button>
          </div>
        </form>
      </dialog>`);
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

  async function init(options = {}) {
    mountShell();
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
        .select('id,full_name,role,status,member_id')
        .eq('id', session.user.id)
        .single());
      if (error) throw error;
      currentProfile = profile;
      if (profile.status !== 'ACTIVE' && options.allowPending !== true) {
        await client.auth.signOut();
        window.location.replace('login.html?status=pending');
        return { configured: true, profile, session };
      }
      const sidebarUser = document.getElementById('sidebar-user');
      if (sidebarUser) sidebarUser.innerHTML = `<strong>${escapeHtml(profile.full_name)}</strong><small>${escapeHtml(profile.role)}</small>`;
      document.querySelectorAll('[data-role]').forEach((element) => {
        const roles = element.dataset.role.split(',');
        element.hidden = !roles.includes(profile.role);
      });
      return { configured: true, profile, session };
    } catch (error) {
      showStartupFailure(error);
      return { configured, profile: null, session: null, failed: true };
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
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
    if (/cannot remove or disable your own administrator/i.test(message)) return 'Bawal ibaba ang iyong Admin role hangga\'t walang kapalit na Admin mula sa mga members.';
    if (/row-level security|permission denied|not allowed to|only an administrator/i.test(message)) return 'You do not have permission for that action.';
    return message;
  }

  function setBusy(button, busy, label = 'Saving…') {
    if (!button) return;
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

  window.addEventListener('unhandledrejection', (event) => {
    event.preventDefault();
    setLoading(false);
    showStartupFailure(event.reason);
  });

  window.Ipon = {
    client, configured, init, rpc, money, dateLabel, isoDate, monthStart,
    escapeHtml, normalizeNamePart, validNamePart, toast, friendlyError, setBusy, setLoading, confirmAction,
    get profile() { return currentProfile; }
  };
})();
