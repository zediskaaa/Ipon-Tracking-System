(async function () {
  'use strict';
  const form = document.getElementById('auth-form');
  const message = document.getElementById('auth-message');
  const submit = document.getElementById('auth-submit');
  let mode = 'login';

  const state = await Ipon.init({ requireAuth: false, allowPending: true });
  if (state.failed) return;
  if (state.session && state.profile?.status === 'ACTIVE') window.location.replace('dashboard.html');
  if (!state.configured) {
    message.textContent = 'Add your Supabase URL and anon key in js/config.js before signing in.';
    submit.disabled = true;
  }
  if (new URLSearchParams(location.search).get('status') === 'pending') {
    message.textContent = 'Your account is waiting for administrator approval.';
  }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    document.getElementById('show-login').classList.toggle('is-active', !signup);
    document.getElementById('show-signup').classList.toggle('is-active', signup);
    document.getElementById('full-name-field').hidden = !signup;
    document.getElementById('full-name').required = signup;
    document.getElementById('auth-title').textContent = signup ? 'Request an account' : 'Welcome back';
    document.getElementById('auth-copy').textContent = signup ? 'An administrator must activate new accounts.' : 'Sign in to view your savings records.';
    submit.textContent = signup ? 'Submit request' : 'Sign in';
    message.textContent = '';
  }
  document.getElementById('show-login').addEventListener('click', () => setMode('login'));
  document.getElementById('show-signup').addEventListener('click', () => setMode('signup'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    message.textContent = '';
    Ipon.setBusy(submit, true, mode === 'signup' ? 'Submitting…' : 'Signing in…');
    const values = new FormData(form);
    try {
      if (mode === 'signup') {
        const { error } = await Ipon.client.auth.signUp({
          email: values.get('email'), password: values.get('password'),
          options: { data: { full_name: values.get('full_name').trim() } }
        });
        if (error) throw error;
        await Ipon.client.auth.signOut();
        form.reset();
        message.style.color = 'var(--green)';
        message.textContent = 'Request submitted. Wait for an administrator to activate your account.';
      } else {
        const { data, error } = await Ipon.client.auth.signInWithPassword({ email: values.get('email'), password: values.get('password') });
        if (error) throw error;
        const { data: profile, error: profileError } = await Ipon.client.from('profiles').select('status').eq('id', data.user.id).single();
        if (profileError) throw profileError;
        if (profile.status !== 'ACTIVE') {
          await Ipon.client.auth.signOut();
          throw new Error('Your account is waiting for administrator approval.');
        }
        window.location.replace('dashboard.html');
      }
    } catch (error) {
      message.style.color = 'var(--red)';
      message.textContent = Ipon.friendlyError(error);
    } finally { Ipon.setBusy(submit, false); }
  });
})();
