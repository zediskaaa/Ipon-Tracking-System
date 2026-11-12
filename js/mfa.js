(async function () {
  'use strict';
  const form = document.getElementById('mfa-form');
  const message = document.getElementById('mfa-message');
  const factorSelect = document.getElementById('mfa-factor');
  const factorField = document.getElementById('mfa-factor-field');

  if (!Ipon.configured) {
    message.textContent = 'Connect Supabase before signing in.';
    form.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  const { data: { session }, error: sessionError } = await Ipon.client.auth.getSession();
  if (sessionError || !session) return window.location.replace('login.html');

  async function continueToSystem() {
    const next = sessionStorage.getItem('iponMfaNext');
    sessionStorage.removeItem('iponMfaNext');
    if (next === 'reset-password.html') return window.location.replace(next);
    const { data: profile, error } = await Ipon.client.from('profiles').select('role,status').eq('id', session.user.id).single();
    if (error) throw error;
    if (profile.status !== 'ACTIVE') {
      await Ipon.client.auth.signOut({ scope: 'local' });
      return window.location.replace('login.html?status=pending');
    }
    await Ipon.rpc('record_account_activity', { p_event: 'LOGIN' }).catch(() => {});
    Ipon.broadcastAuthEvent('SIGNED_IN', session.user.id);
    window.location.replace(Ipon.homeForRole(profile.role));
  }

  try {
    if (!await Ipon.requiresMfaChallenge()) return await continueToSystem();
    const { data, error } = await Ipon.client.auth.mfa.listFactors();
    if (error) throw error;
    const factors = (data.totp || []).filter((factor) => factor.status === 'verified');
    if (!factors.length) throw new Error('No verified authenticator is available for this account.');
    factorSelect.innerHTML = factors.map((factor) => `<option value="${Ipon.escapeHtml(factor.id)}">${Ipon.escapeHtml(factor.friendly_name || 'Authenticator app')}</option>`).join('');
    factorField.hidden = factors.length === 1;
  } catch (error) { message.textContent = Ipon.friendlyError(error); }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = form.elements.code.value.trim();
    if (!/^\d{6}$/.test(code)) {
      message.textContent = 'Enter the 6-digit code from your authenticator app.';
      return form.elements.code.focus();
    }
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Verifying…');
    message.textContent = '';
    try {
      const { error } = await Ipon.client.auth.mfa.challengeAndVerify({ factorId: factorSelect.value, code });
      if (error) throw error;
      await continueToSystem();
    } catch (error) {
      message.textContent = Ipon.friendlyError(error);
      form.elements.code.select();
    } finally { Ipon.setBusy(button, false); }
  });

  document.getElementById('mfa-signout').addEventListener('click', async () => {
    sessionStorage.removeItem('iponMfaNext');
    sessionStorage.removeItem('iponPasswordRecovery');
    await Ipon.client.auth.signOut({ scope: 'local' });
    Ipon.broadcastAuthEvent('SIGNED_OUT');
    window.location.replace('login.html');
  });
})();
