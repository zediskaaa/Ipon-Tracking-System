(async function () {
  'use strict';
  const form = document.getElementById('auth-form');
  const message = document.getElementById('auth-message');
  const submit = document.getElementById('auth-submit');
  const firstNameField = document.getElementById('first-name-field');
  const middleNameField = document.getElementById('middle-name-field');
  const lastNameField = document.getElementById('last-name-field');
  const firstName = document.getElementById('first-name');
  const middleName = document.getElementById('middle-name');
  const lastName = document.getElementById('last-name');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const passwordConfirmationField = document.getElementById('password-confirmation-field');
  const passwordConfirmation = document.getElementById('password-confirmation');
  const passwordRequirements = document.getElementById('password-requirements');
  const passwordToggle = document.getElementById('password-toggle');
  const nameInputs = [firstName, middleName, lastName];
  const fieldErrors = new Map([
    [firstName, document.getElementById('first-name-error')],
    [middleName, document.getElementById('middle-name-error')],
    [lastName, document.getElementById('last-name-error')],
    [email, document.getElementById('email-error')],
    [password, document.getElementById('password-error')],
    [passwordConfirmation, document.getElementById('password-confirmation-error')]
  ]);
  const passwordRule = 'Use at least 8 characters with uppercase, lowercase, and a number.';
  const nameRule = "Use letters, spaces, hyphens, or apostrophes only.";
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

  function setFieldError(input, errorMessage) {
    const error = fieldErrors.get(input);
    input.setCustomValidity(errorMessage);
    input.setAttribute('aria-invalid', 'true');
    error.textContent = errorMessage;
    error.hidden = false;
  }

  function clearFieldError(input) {
    const error = fieldErrors.get(input);
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    error.textContent = '';
    error.hidden = true;
  }

  function clearFieldErrors() {
    fieldErrors.forEach((_, input) => clearFieldError(input));
  }

  function setPasswordVisibility(visible) {
    const type = visible ? 'text' : 'password';
    password.type = type;
    passwordConfirmation.type = type;
    passwordToggle.textContent = visible ? 'Hide' : 'Show';
    passwordToggle.setAttribute('aria-pressed', String(visible));
    passwordToggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} passwords`);
  }

  function passwordIsStrong(value) {
    return value.length >= 8 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
  }

  function validateForm() {
    const signup = mode === 'signup';
    clearFieldErrors();
    email.value = email.value.trim();

    if (signup) {
      if (!firstName.value.trim()) setFieldError(firstName, 'Enter your first name.');
      else if (!Ipon.validNamePart(firstName.value)) setFieldError(firstName, nameRule);
      if (middleName.value.trim() && !Ipon.validNamePart(middleName.value)) setFieldError(middleName, nameRule);
      if (!lastName.value.trim()) setFieldError(lastName, 'Enter your last name or surname.');
      else if (!Ipon.validNamePart(lastName.value)) setFieldError(lastName, nameRule);
      if (nameInputs.map((input) => Ipon.normalizeNamePart(input.value)).filter(Boolean).join(' ').length > 150) {
        setFieldError(lastName, 'Combined full name must not exceed 150 characters.');
      }
    }
    if (!email.value) setFieldError(email, 'Enter your email address.');
    else if (!email.validity.valid) setFieldError(email, 'Enter a valid email address.');
    if (!password.value) setFieldError(password, 'Enter your password.');
    else if (signup && !passwordIsStrong(password.value)) setFieldError(password, passwordRule);
    if (signup && !passwordConfirmation.value) setFieldError(passwordConfirmation, 'Confirm your password.');
    else if (signup && passwordConfirmation.value !== password.value) setFieldError(passwordConfirmation, 'Passwords do not match.');

    const inputs = signup ? [...nameInputs, email, password, passwordConfirmation] : [email, password];
    const firstInvalid = inputs.find((input) => !input.checkValidity());
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    const loginTab = document.getElementById('show-login');
    const signupTab = document.getElementById('show-signup');
    loginTab.classList.toggle('is-active', !signup);
    signupTab.classList.toggle('is-active', signup);
    loginTab.setAttribute('aria-selected', String(!signup));
    signupTab.setAttribute('aria-selected', String(signup));
    loginTab.tabIndex = signup ? -1 : 0;
    signupTab.tabIndex = signup ? 0 : -1;
    form.setAttribute('aria-labelledby', signup ? 'show-signup' : 'show-login');
    firstNameField.hidden = !signup;
    middleNameField.hidden = !signup;
    lastNameField.hidden = !signup;
    firstName.required = signup;
    lastName.required = signup;
    passwordConfirmationField.hidden = !signup;
    passwordConfirmation.required = signup;
    passwordRequirements.hidden = !signup;
    password.autocomplete = signup ? 'new-password' : 'current-password';
    document.getElementById('auth-title').textContent = signup ? 'Request an account' : 'Welcome back';
    document.getElementById('auth-copy').textContent = signup ? 'An administrator must activate new accounts.' : 'Sign in to view your savings records.';
    submit.textContent = signup ? 'Submit request' : 'Sign in';
    clearFieldErrors();
    setPasswordVisibility(false);
    delete message.dataset.tone;
    message.textContent = '';
  }

  fieldErrors.forEach((_, input) => input.addEventListener('input', () => clearFieldError(input)));
  email.addEventListener('blur', () => { email.value = email.value.trim(); });
  passwordToggle.addEventListener('click', () => setPasswordVisibility(password.type === 'password'));
  document.getElementById('show-login').addEventListener('click', () => setMode('login'));
  document.getElementById('show-signup').addEventListener('click', () => setMode('signup'));
  document.querySelector('.auth-tabs').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextMode = event.key === 'ArrowLeft' || event.key === 'Home' ? 'login' : 'signup';
    setMode(nextMode);
    document.getElementById(nextMode === 'login' ? 'show-login' : 'show-signup').focus();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    delete message.dataset.tone;
    message.textContent = '';
    if (!validateForm()) return;

    Ipon.setBusy(submit, true, mode === 'signup' ? 'Submitting...' : 'Signing in...');
    try {
      if (mode === 'signup') {
        const first = Ipon.normalizeNamePart(firstName.value);
        const middle = middleName.value.trim() ? Ipon.normalizeNamePart(middleName.value) : null;
        const last = Ipon.normalizeNamePart(lastName.value);
        const full = [first, middle, last].filter(Boolean).join(' ');
        const { error } = await Ipon.client.auth.signUp({
          email: email.value,
          password: password.value,
          options: { data: { first_name: first, middle_name: middle, last_name: last, full_name: full } }
        });
        if (error) throw error;
        await Ipon.client.auth.signOut();
        form.reset();
        clearFieldErrors();
        setPasswordVisibility(false);
        message.dataset.tone = 'success';
        message.textContent = 'Request submitted. Wait for an administrator to activate your account.';
      } else {
        const { data, error } = await Ipon.client.auth.signInWithPassword({ email: email.value, password: password.value });
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
      if (mode === 'signup' && (error?.code === 'weak_password' || /weak password/i.test(error?.message || ''))) {
        setFieldError(password, passwordRule);
        password.focus();
      } else {
        message.textContent = Ipon.friendlyError(error);
      }
    } finally {
      Ipon.setBusy(submit, false);
    }
  });
})();
