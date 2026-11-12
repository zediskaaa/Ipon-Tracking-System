(async function () {
  'use strict';
  const form = document.getElementById('reset-password-form');
  const message = document.getElementById('reset-password-message');
  const password = form.elements.password;
  Ipon.bindPasswordStrength(password);

  const recoveryLink = new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery'
    || new URLSearchParams(window.location.search).get('type') === 'recovery';
  if (recoveryLink) sessionStorage.setItem('iponPasswordRecovery', '1');
  if (!Ipon.configured || sessionStorage.getItem('iponPasswordRecovery') !== '1') return window.location.replace('login.html');
  const { data: { session }, error } = await Ipon.client.auth.getSession();
  if (error || !session) {
    sessionStorage.removeItem('iponPasswordRecovery');
    return window.location.replace('login.html');
  }
  if (await Ipon.requiresMfaChallenge()) {
    sessionStorage.setItem('iponMfaNext', 'reset-password.html');
    return window.location.replace('mfa.html');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    if (password.value !== form.elements.password_confirmation.value) {
      message.textContent = 'Passwords do not match.';
      return form.elements.password_confirmation.focus();
    }
    const issue = Ipon.passwordIssue(password.value, [session.user.email]);
    if (issue) {
      message.textContent = issue;
      return password.focus();
    }
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Saving…');
    try {
      const { error: updateError } = await Ipon.client.auth.updateUser({ password: password.value });
      if (updateError) throw updateError;
      await Ipon.rpc('record_account_activity', { p_event: 'PASSWORD_CHANGE' }).catch(() => {});
      sessionStorage.removeItem('iponPasswordRecovery');
      await Ipon.client.auth.signOut({ scope: 'global' });
      Ipon.broadcastAuthEvent('SIGNED_OUT');
      window.location.replace('login.html?status=password-reset');
    } catch (submitError) { message.textContent = Ipon.friendlyError(submitError); }
    finally { Ipon.setBusy(button, false); }
  });
})();
