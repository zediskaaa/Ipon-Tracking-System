window.IPON_CONFIG = Object.freeze({
  supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co',
  supabaseAnonKey: 'sb_publishable_4R7H8GK6Ay6l4Jv1tEt0SA_LzedpmBH',
  clerkPublishableKey: 'pk_test_c29saWQtZ2FubmV0LTIwMjEuY2xlcmsuYWNjb3VudHMuZGV2JA==',
  vapidPublicKey: 'BAmuooDoG5lqI9NV0Wx2DLFUT87v6ut4cLe4qFHd7KcEgjs8kDOe2GMguN4xeOMkFUWGt0SJdYEUjmrIEZ08sX0'
});

try {
  var root = typeof document !== 'undefined' ? document.documentElement : null;
  if (root && root.dataset) {
    var storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem('myipon_theme') : null;
    if (storedTheme === 'dark' || storedTheme === 'light') root.dataset.theme = storedTheme;
    var activeRole = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ipon_active_role')) || (typeof localStorage !== 'undefined' && localStorage.getItem('ipon_active_role'));
    if (activeRole === 'SUPER_ADMIN' || activeRole === 'ADMIN' || activeRole === 'TREASURER' || activeRole === 'MEMBER') {
      root.dataset.shellRole = activeRole;
    }
    var workspaceMode = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ipon_workspace_mode')) || (typeof localStorage !== 'undefined' && localStorage.getItem('ipon_workspace_mode'));
    if (workspaceMode === 'SOLO' || workspaceMode === 'GROUP' || workspaceMode === 'NONE') {
      root.dataset.workspaceMode = workspaceMode;
    }
  }
} catch { }

try {
  if (typeof document !== 'undefined' && typeof MutationObserver === 'function') {
    var prepaintEsc = function (val) {
      return String(val == null ? '' : val).replace(/[&<>'"]/g, function (ch) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch];
      });
    };
    var prepaintInitials = function (name) {
      var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return '';
      return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    };
    var prepaintSafeImg = function (url) {
      var s = String(url || '').trim();
      return /^https:\/\/(?:woslmwokhhyszkgevnli\.supabase\.co|4b0fc7ef59cd45a047da632eba75d8af\.r2\.cloudflarestorage\.com)\//i.test(s)
        || /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(s);
    };
    var prepaintShell = function () {
      var host = document.getElementById('app-sidebar');
      if (!host || host.children.length > 0 || host.dataset.renderedRole) return Boolean(host);
      var body = document.body;
      if (!body || !body.dataset || !body.dataset.page || body.classList.contains('security-page')) return false;
      var page = body.dataset.page;
      var superAdminPanel = body.dataset.panel === 'super-admin';
      var snap = null;
      try {
        var rawSnap = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ipon_shell_snapshot'))
          || (typeof localStorage !== 'undefined' && localStorage.getItem('ipon_shell_snapshot'));
        if (rawSnap) snap = JSON.parse(rawSnap);
      } catch { }
      var role = (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.shellRole)
        || (snap && snap.role) || 'ADMIN';
      if (role !== 'SUPER_ADMIN' && role !== 'ADMIN' && role !== 'TREASURER' && role !== 'MEMBER') role = 'ADMIN';
      var cachedName = (snap && typeof snap.fullName === 'string') ? snap.fullName.trim() : '';
      var cachedUserId = (snap && snap.userId) ? String(snap.userId) : '';
      var unread = snap && isFinite(Number(snap.unreadCount)) ? Math.max(0, Math.floor(Number(snap.unreadCount))) : 0;
      var avatarUrl = '';
      try {
        var rawAv = (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ipon_shell_avatar'))
          || (typeof localStorage !== 'undefined' && localStorage.getItem('ipon_shell_avatar'));
        if (rawAv) {
          var parsedAv = JSON.parse(rawAv);
          if (parsedAv && (!cachedUserId || !parsedAv.userId || String(parsedAv.userId) === cachedUserId) && prepaintSafeImg(parsedAv.avatarUrl)) {
            avatarUrl = parsedAv.avatarUrl;
          }
        }
      } catch { }
      var calIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18M7 14h2m3 0h2m3 0h1M7 18h2m3 0h2m3 0h1"/></svg>';
      var recIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>';
      var budIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12A9 9 0 1 1 12 3v9Z"/><path d="M21.2 10A9 9 0 0 0 14 2.8V10Z"/></svg>';
      var memIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>';
      var repIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10m6 10V4m6 16v-7m5 7H2"/></svg>';
      var items = (superAdminPanel || role === 'SUPER_ADMIN')
        ? [
          ['overview', 'super-admin.html#overview', 'Overview', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13h6V4H4v9Zm0 7h6v-4H4v4Zm10 0h6v-9h-6v9Zm0-16v4h6V4h-6Z"/></svg>'],
          ['feature-requests', 'super-admin.html#feature-requests', 'Feature requests', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6M10 22h4M8.5 14.5A7 7 0 1 1 15.5 14.5C14.5 15.2 14 16 14 17h-4c0-1-.5-1.8-1.5-2.5Z"/></svg>'],
          ['bug-reports', 'super-admin.html#bug-reports', 'Bug reports', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6V5a4 4 0 0 1 8 0v1m-9 4h10a2 2 0 0 1 2 2v3a7 7 0 0 1-14 0v-3a2 2 0 0 1 2-2Zm-3 3H3m18 0h-1M6 9 4 7m14 2 2-2M6 17l-2 2m14-2 2 2"/></svg>'],
          ['administrators', 'super-admin.html#administrators', 'Users', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-1 2 2 4-4"/></svg>'],
          ['badges', 'super-admin.html#badges', 'Badges', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 14.9 4.2l3.6-.3 1.1 3.4 2.9 2-1.1 3.4 1.1 3.4-2.9 2-1.1 3.4-3.6-.3L12 22l-2.9-2.2-3.6.3-1.1-3.4-2.9-2 1.1-3.4-1.1-3.4 2.9-2 1.1-3.4 3.6.3L12 2Z"/><path d="m8.7 12.2 2.2 2.3 4.6-4.8"/></svg>'],
          ['effects', 'super-admin.html#effects', 'Profile effects', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4L12 2Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>']
        ]
        : (role === 'MEMBER')
          ? [['dashboard', 'dashboard.html', 'Calendar', calIcon], ['user', 'user.html', 'My savings', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M16 12h5m-5-2a2 2 0 1 0 0 4"/></svg>'], ['contributions', 'contributions.html', 'Records', recIcon], ['budget', 'budget.html', 'Budget', budIcon], ['reports', 'reports.html', 'Reports', repIcon]]
          : [['dashboard', 'dashboard.html', 'Calendar', calIcon], ['contributions', 'contributions.html', 'Records', recIcon], ['budget', 'budget.html', 'Budget', budIcon]].concat(role === 'ADMIN' ? [['members', 'members.html', 'Members', memIcon, 'ADMIN']] : []).concat([['reports', 'reports.html', 'Reports', repIcon]]);
      var activeId = superAdminPanel ? ((typeof location !== 'undefined' && location.hash ? location.hash.slice(1) : '') || 'overview') : (['contributions', 'withdrawals', 'expenses', 'savings', 'requests'].indexOf(page) !== -1 ? 'contributions' : (page === 'audit' ? 'reports' : page));
      var isAccountSubview = !superAdminPanel && (page === 'account' || page === 'settings');
      var initials = prepaintInitials(cachedName);
      var avatarInner = avatarUrl
        ? '<img src="' + prepaintEsc(avatarUrl) + '" alt="" data-avatar-img>'
        : (initials ? '<span>' + prepaintEsc(initials) + '</span>' : '<svg viewBox="0 0 24 24"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.42 0-8 2.24-8 5v1h16v-1c0-2.76-3.58-5-8-5Z"/></svg>');
      var roleLabel = cachedName ? (role === 'SUPER_ADMIN' ? 'Owner' : 'My account') : 'ACCOUNT';
      host.innerHTML =
        '<a class="app-brand brand" data-region="brand" href="' + (superAdminPanel || role === 'SUPER_ADMIN' ? 'super-admin.html' : 'dashboard.html') + '" aria-label="myIPON home">' +
        '<svg class="brand-coins" viewBox="8 10 52 46" aria-hidden="true"><path d="M38 28V13" fill="none" stroke="#68ba3b" stroke-width="3" stroke-linecap="round"/><path d="M38 17c5-7.5 13-9.5 20-7.5-1 7.5-8.5 12-20 12Z" fill="#75c242"/><path d="M38 22c-4.5-6-11-8-17-6 1 6 7 9.5 17 9.5Z" fill="#52992d"/><ellipse cx="43" cy="32" rx="14" ry="5" fill="#f8dc84" stroke="#c99532" stroke-width="0.8"/><text x="43" y="34.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="7.5" font-weight="900" fill="#a4721c" transform="scale(1, 0.65) translate(0, 16)">\u20B1</text><path d="M29 32v7c0 2.8 6.3 4.8 14 4.8s14-2 14-4.8v-7c0 2.8-6.3 4.8-14 4.8s-14-2-14-4.8Z" fill="#e5b44d"/><path d="M33 35v4.5M38 36v4.5M43 36.5v4.5M48 36v4.5M53 35v4.5" stroke="#c49028" stroke-width="0.8" fill="none" opacity="0.7"/><path d="M29 39v7c0 2.8 6.3 4.8 14 4.8s14-2 14-4.8v-7c0 2.8-6.3 4.8-14 4.8s-14-2-14-4.8Z" fill="#d8a33a"/><path d="M33 42v4.5M38 43v4.5M43 43.5v4.5M48 43v4.5M53 42v4.5" stroke="#b07a1c" stroke-width="0.8" fill="none" opacity="0.7"/><circle cx="20" cy="42" r="12" fill="#f8dc84" stroke="#c99532" stroke-width="1.3"/><circle cx="20" cy="42" r="9.5" fill="#f1cb65"/><text x="20" y="46.5" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="900" fill="#9e6c15">\u20B1</text></svg>' +
        '<span class="brand-divider" aria-hidden="true"></span><span class="brand-text"><strong><span class="brand-prefix">my</span>IPON</strong></span></a>' +
        '<nav class="app-nav" aria-label="Main navigation">' +
        items.map(function (it) {
          var isAct = activeId === it[0];
          return '<a class="' + (isAct ? 'is-active' : '') + '" href="' + it[1] + '" aria-label="' + it[2] + '" data-nav-section="' + it[0] + '"' + (isAct ? ' aria-current="page"' : '') + (it[4] ? ' data-role="' + it[4] + '"' : '') + (it[0] === 'members' ? ' data-group-only="1"' : '') + '>' + it[3] + '<span>' + it[2] + '</span></a>';
        }).join('') +
        '</nav>' +
        '<div class="sidebar-art" aria-hidden="true"><svg viewBox="0 0 180 145" fill="none"><path d="M0 118c42-16 84-6 180-24v51H0v-27Z" fill="rgba(255,255,255,.04)"/><path d="M0 128c55-14 112 4 180-15v32H0v-17Z" fill="rgba(255,255,255,.06)"/><rect x="44" y="54" width="84" height="64" rx="12" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.26)" stroke-width="1.5"/><path d="M86 54V26" stroke="#62a87c" stroke-width="2.4" stroke-linecap="round"/><path d="M86 38c-2-12-15-18-24-14 2 11 12 17 24 14Z" fill="#5da377"/><path d="M86 31c3-13 16-20 26-16-2 12-13 19-26 16Z" fill="#7bc092"/><path d="M86 45c4-9 14-12 22-9-3 9-12 12-22 9Z" fill="#4b8d64"/><ellipse cx="67" cy="94" rx="14" ry="4.5" fill="#ebd089"/><path d="M53 94v6c0 2.5 6.3 4.5 14 4.5s14-2 14-4.5v-6c0 2.5-6.3 4.5-14 4.5s-14-2-14-4.5Z" fill="#c89b43"/><path d="M53 102v6c0 2.5 6.3 4.5 14 4.5s14-2 14-4.5v-6c0 2.5-6.3 4.5-14 4.5s-14-2-14-4.5Z" fill="#dfbe6f"/><ellipse cx="101" cy="78" rx="15" ry="4.8" fill="#f1d894"/><path d="M86 78v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#cfa34b"/><path d="M86 86v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#e5c473"/><path d="M86 94v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#c5963e"/><path d="M86 102v6c0 2.6 6.7 4.8 15 4.8s15-2.2 15-4.8v-6c0 2.6-6.7 4.8-15 4.8s-15-2.2-15-4.8Z" fill="#dfbe6f"/></svg></div>' +
        '<div class="app-sidebar-footer"><div class="sidebar-utilities"><button class="sidebar-utility" data-notifications-open type="button" aria-label="Open notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 13h4"/></svg><b data-notification-count' + (unread > 0 ? '' : ' hidden') + '>' + (unread > 99 ? '99+' : unread) + '</b></button></div>' +
        '<button class="sidebar-user-card' + (isAccountSubview ? ' is-active' : '') + '" data-account-open type="button" aria-label="Open my account"' + (isAccountSubview ? ' aria-current="page"' : '') + '><span class="avatar-presence-wrap"><span class="sidebar-user-avatar' + (initials && !avatarUrl ? ' has-initials' : '') + '" aria-hidden="true">' + avatarInner + '</span></span><div class="sidebar-user-info" id="sidebar-user"><strong>' + prepaintEsc(cachedName || 'Checking session\u2026') + '</strong><small>' + prepaintEsc(roleLabel) + '</small></div></button></div>';
      return true;
    };
    if (!prepaintShell() && document.documentElement) {
      var shellObserver = new MutationObserver(function () {
        if (prepaintShell()) shellObserver.disconnect();
      });
      shellObserver.observe(document.documentElement, { childList: true, subtree: true });
      document.addEventListener('DOMContentLoaded', function () {
        prepaintShell();
        shellObserver.disconnect();
      }, { once: true });
    }
  }
} catch { }

try {
  if (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !window.Capacitor &&
    window.location &&
    window.location.protocol !== 'https:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname) &&
    'serviceWorker' in navigator
  ) {
    var hadLocalSw = Boolean(navigator.serviceWorker.controller);
    (async function () {
      try {
        var regs = (await navigator.serviceWorker.getRegistrations?.()) || [];
        await Promise.all(regs.map(function (reg) { return reg.unregister().catch(function () { return false; }); }));
        if (window.caches && window.caches.keys) {
          var keys = await window.caches.keys();
          await Promise.all(keys.map(function (k) { return window.caches.delete(k).catch(function () { return false; }); }));
        }
        if ((hadLocalSw || regs.length) && !sessionStorage.getItem('ipon_sw_local_cleaned_v19')) {
          sessionStorage.setItem('ipon_sw_local_cleaned_v19', '1');
          await fetch(window.location.href, { cache: 'reload' }).catch(function () { });
          window.location.reload();
        }
      } catch { }
    })();
  }
} catch { }
