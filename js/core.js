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

  const navItems = [
    ['dashboard', 'dashboard.html', 'Calendar'],
    ['contributions', 'contributions.html', 'Records'],
    ['members', 'members.html', 'Members'],
    ['reports', 'reports.html', 'Reports'],
    ['settings', 'settings.html', 'Settings']
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

  function mountShell() {
    const host = document.getElementById('app-sidebar');
    if (host) {
      const page = document.body.dataset.page;
      host.innerHTML = `
        <a class="app-brand" href="dashboard.html">IPON</a>
        <nav class="app-nav" aria-label="Main navigation">
          ${navItems.map(([id, href, label]) => `<a class="${page === id ? 'is-active' : ''}" href="${href}">${label}</a>`).join('')}
        </nav>
        <div class="app-sidebar-footer">
          <p id="sidebar-user">Checking session…</p>
          <button class="text-button" id="sign-out" type="button">Sign out</button>
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

  async function init(options = {}) {
    mountShell();
    setLoading(true);
    try {
      if (!configured) {
        showSetupBanner();
        document.getElementById('sidebar-user')?.replaceChildren(document.createTextNode('Supabase not connected'));
        document.querySelectorAll('[data-requires-data]').forEach((element) => { element.disabled = true; });
        return { configured: false, profile: null, session: null };
      }

      const { data: { session }, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (!session && options.requireAuth !== false) {
        window.location.replace('login.html');
        return { configured: true, profile: null, session: null };
      }
      if (!session) return { configured: true, profile: null, session: null };

      const { data: profile, error } = await client.from('profiles')
        .select('id,full_name,role,status,member_id')
        .eq('id', session.user.id)
        .single();
      if (error) throw error;
      currentProfile = profile;
      if (profile.status !== 'ACTIVE' && options.allowPending !== true) {
        await client.auth.signOut();
        window.location.replace('login.html?status=pending');
        return { configured: true, profile, session };
      }
      const sidebarUser = document.getElementById('sidebar-user');
      if (sidebarUser) sidebarUser.textContent = `${profile.full_name} · ${profile.role}`;
      document.querySelectorAll('[data-role]').forEach((element) => {
        const roles = element.dataset.role.split(',');
        element.hidden = !roles.includes(profile.role);
      });
      return { configured: true, profile, session };
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    window.location.replace('login.html');
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
    if (/row-level security|permission|not allowed|administrator/i.test(message)) return 'You do not have permission for that action.';
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

  window.Ipon = {
    client, configured, init, rpc, money, dateLabel, isoDate, monthStart,
    escapeHtml, toast, friendlyError, setBusy, setLoading, confirmAction,
    get profile() { return currentProfile; }
  };
})();
