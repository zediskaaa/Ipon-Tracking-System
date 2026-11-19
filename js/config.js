window.IPON_CONFIG = Object.freeze({
  supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co',
  supabaseAnonKey: 'sb_publishable_4R7H8GK6Ay6l4Jv1tEt0SA_LzedpmBH',
  clerkPublishableKey: 'pk_test_c29saWQtZ2FubmV0LTIwMjEuY2xlcmsuYWNjb3VudHMuZGV2JA==',
  vapidPublicKey: 'BAmuooDoG5lqI9NV0Wx2DLFUT87v6ut4cLe4qFHd7KcEgjs8kDOe2GMguN4xeOMkFUWGt0SJdYEUjmrIEZ08sX0',
  geminiApiKey: ''
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
