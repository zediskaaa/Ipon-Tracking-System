window.IPON_CONFIG = Object.freeze({
  supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co',
  supabaseAnonKey: 'sb_publishable_4R7H8GK6Ay6l4Jv1tEt0SA_LzedpmBH',
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
