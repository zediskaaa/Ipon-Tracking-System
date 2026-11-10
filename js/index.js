(async function () {
  'use strict';
  const state = await Ipon.init({ requireAuth: false, allowPending: true });
  if (!state.failed) location.replace(state.session ? Ipon.homeForRole(state.profile?.role) : 'login.html');
})();
