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
  const contactField = document.getElementById('contact-number-field');
  const contactNumber = document.getElementById('contact-number');
  const reasonField = document.getElementById('request-reason-field');
  const requestReason = document.getElementById('request-reason');
  const password = document.getElementById('password');
  const passwordConfirmationField = document.getElementById('password-confirmation-field');
  const passwordConfirmation = document.getElementById('password-confirmation');
  const passwordRequirements = document.getElementById('password-requirements');
  const passwordToggle = document.getElementById('password-toggle');
  const forgotButton = document.getElementById('forgot-password-open');
  const recoveryDialog = document.getElementById('recovery-dialog');
  const recoveryRequestForm = document.getElementById('recovery-request-form');
  const recoveryMessage = document.getElementById('recovery-message');
  const requestSuccessDialog = document.getElementById('request-success-dialog');
  const requestSuccessEmail = document.getElementById('request-success-email');
  const verifyDialog = document.getElementById('request-verify-dialog');
  const verifyForm = document.getElementById('request-verify-form');
  const verifySubtitle = document.getElementById('request-verify-subtitle');
  const verifyCode = document.getElementById('request-verify-code');
  const verifyError = document.getElementById('request-verify-error');
  const verifyResend = document.getElementById('request-verify-resend');
  const verifyClose = document.getElementById('request-verify-close');
  let pendingSignupPayload = null;
  const nameInputs = [firstName, middleName, lastName];
  const fieldErrors = new Map([
    [firstName, document.getElementById('first-name-error')],
    [middleName, document.getElementById('middle-name-error')],
    [lastName, document.getElementById('last-name-error')],
    [email, document.getElementById('email-error')],
    [contactNumber, document.getElementById('contact-number-error')],
    [requestReason, document.getElementById('request-reason-error')],
    [password, document.getElementById('password-error')],
    [passwordConfirmation, document.getElementById('password-confirmation-error')]
  ]);
  const passwordRule = 'Use at least 8 characters with uppercase, lowercase, a number, and a symbol.';
  const nameRule = "Use letters, spaces, hyphens, or apostrophes only.";
  let mode = 'login';

  const state = await Ipon.init({ requireAuth: false, allowPending: true });
  if (state.failed) return;
  if (state.session && state.profile?.status === 'ACTIVE') window.location.replace(Ipon.homeForRole(state.profile.role));
  if (!state.configured) {
    message.textContent = 'Add your Supabase URL and anon key in js/config.js before signing in.';
    submit.disabled = true;
    forgotButton.disabled = true;
  }
  if (new URLSearchParams(location.search).get('status') === 'pending') {
    message.textContent = 'Your account is waiting for administrator approval.';
  }
  if (new URLSearchParams(location.search).get('status') === 'password-reset') {
    message.dataset.tone = 'success';
    message.textContent = 'Password changed. Sign in with your new password.';
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

  const passwordStrength = Ipon.bindPasswordStrength(password, () => [firstName.value, middleName.value, lastName.value, email.value]);
  passwordStrength.element.hidden = true;

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
      if (!/^(?:09\d{9}|\+639\d{9})$/.test(contactNumber.value.trim())) setFieldError(contactNumber, 'Enter 09XXXXXXXXX or +639XXXXXXXXX.');
      if (requestReason.value.trim().length < 10) setFieldError(requestReason, 'Explain your request using at least 10 characters.');
    }
    if (!email.value) setFieldError(email, 'Enter your email address.');
    else if (!email.validity.valid) setFieldError(email, 'Enter a valid email address.');
    if (!password.value) setFieldError(password, 'Enter your password.');
    else if (signup && Ipon.passwordIssue(password.value, [firstName.value, middleName.value, lastName.value, email.value])) setFieldError(password, Ipon.passwordIssue(password.value, [firstName.value, middleName.value, lastName.value, email.value]));
    if (signup && !passwordConfirmation.value) setFieldError(passwordConfirmation, 'Confirm your password.');
    else if (signup && passwordConfirmation.value !== password.value) setFieldError(passwordConfirmation, 'Passwords do not match.');

    const inputs = signup ? [...nameInputs, contactNumber, requestReason, email, password, passwordConfirmation] : [email, password];
    const firstInvalid = inputs.find((input) => !input.checkValidity());
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    document.body.classList.toggle('is-request-mode', signup);
    const loginTab = document.getElementById('show-login');
    const signupTab = document.getElementById('show-signup');
    loginTab.classList.toggle('is-active', !signup);
    signupTab.classList.toggle('is-active', signup);
    loginTab.textContent = signup ? 'Back to sign in' : 'Sign in';
    form.setAttribute('aria-labelledby', 'auth-title');
    firstNameField.hidden = !signup;
    middleNameField.hidden = !signup;
    lastNameField.hidden = !signup;
    contactField.hidden = !signup;
    reasonField.hidden = !signup;
    firstName.required = signup;
    lastName.required = signup;
    contactNumber.required = signup;
    requestReason.required = signup;
    passwordConfirmationField.hidden = !signup;
    passwordConfirmation.required = signup;
    passwordRequirements.hidden = !signup;
    passwordStrength.element.hidden = !signup;
    forgotButton.hidden = signup;
    password.autocomplete = signup ? 'new-password' : 'current-password';
    if (signup) { password.minLength = 8; password.maxLength = 128; }
    else { password.removeAttribute('minlength'); password.removeAttribute('maxlength'); }
    document.getElementById('auth-title').textContent = signup ? 'Request administrator access' : 'Welcome back';
    document.getElementById('auth-copy').textContent = signup ? 'The Super Admin reviews administrator access requests.' : 'Sign in to view your savings records.';
    submit.textContent = signup ? 'Request administrator access' : 'Sign in';
    clearFieldErrors();
    setPasswordVisibility(false);
    delete message.dataset.tone;
    message.textContent = '';
  }

  fieldErrors.forEach((_, input) => input.addEventListener('input', () => clearFieldError(input)));
  const clearCredentialError = () => {
    if (mode !== 'login' || message.textContent !== 'Incorrect email or password.') return;
    [email, password].forEach((input) => input.removeAttribute('aria-invalid'));
    message.textContent = '';
  };
  email.addEventListener('input', clearCredentialError);
  password.addEventListener('input', clearCredentialError);
  email.addEventListener('blur', () => { email.value = email.value.trim(); });
  passwordToggle.addEventListener('click', () => setPasswordVisibility(password.type === 'password'));
  document.getElementById('show-login').addEventListener('click', () => setMode('login'));
  document.getElementById('show-signup').addEventListener('click', () => setMode('signup'));
  if (new URLSearchParams(location.search).get('mode') === 'signup') setMode('signup');
  const resetRecoveryDialog = () => {
    recoveryRequestForm.reset();
    recoveryMessage.textContent = '';
    delete recoveryMessage.dataset.tone;
  };
  const sendRecoveryLink = async (button) => {
    const recoveryEmail = recoveryRequestForm.elements.email.value.trim().toLowerCase();
    recoveryRequestForm.elements.email.value = recoveryEmail;
    if (!recoveryRequestForm.reportValidity()) return;
    Ipon.setBusy(button, true, 'Sending…');
    recoveryMessage.textContent = '';
    try {
      const redirectTo = new URL('reset-password.html', window.location.href).href;
      const { error } = await Ipon.client.auth.resetPasswordForEmail(recoveryEmail, { redirectTo });
      if (error) throw error;
      recoveryMessage.dataset.tone = 'success';
      recoveryMessage.textContent = `If an account exists for ${recoveryEmail}, a secure reset link was sent.`;
    } catch (error) { recoveryMessage.textContent = Ipon.friendlyError(error); recoveryMessage.dataset.tone = 'error'; }
    finally { Ipon.setBusy(button, false); }
  };
  forgotButton.addEventListener('click', () => {
    resetRecoveryDialog();
    recoveryRequestForm.elements.email.value = email.value.trim();
    recoveryDialog.showModal();
    recoveryRequestForm.elements.email.focus();
  });
  document.querySelectorAll('[data-recovery-close]').forEach((button) => button.addEventListener('click', () => recoveryDialog.close()));
  recoveryDialog.addEventListener('close', resetRecoveryDialog);
  recoveryRequestForm.addEventListener('submit', (event) => { event.preventDefault(); sendRecoveryLink(event.submitter); });
  const policyDialog = document.getElementById('policy-dialog');
  document.querySelectorAll('[data-policy-open]').forEach((button) => button.addEventListener('click', () => {
    const policy = button.dataset.policyOpen;
    document.getElementById('policy-title').textContent = policy === 'privacy' ? 'Privacy policy' : 'Terms of use';
    policyDialog.querySelectorAll('[data-policy-content]').forEach((section) => { section.hidden = section.dataset.policyContent !== policy; });
    policyDialog.showModal();
  }));

  document.querySelectorAll('[data-request-success-close]').forEach((btn) => btn.addEventListener('click', () => {
    requestSuccessDialog?.close();
    password.focus();
  }));

  email.addEventListener('blur', async () => {
    if (mode !== 'signup' || !email.value || !email.validity.valid) return;
    try {
      const eligibility = await Ipon.rpc('check_admin_request_eligibility', { p_email: email.value.trim().toLowerCase() });
      if (eligibility?.reason === 'rejected') {
        setFieldError(email, 'This email was declined for administrator access and cannot request again.');
      }
    } catch (_) {}
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    delete message.dataset.tone;
    message.textContent = '';
    if (!validateForm()) return;

    Ipon.setBusy(submit, true, mode === 'signup' ? 'Submitting administrator access…' : 'Signing in...');
    try {
      if (mode === 'signup') {
        const first = Ipon.normalizeNamePart(firstName.value);
        const middle = middleName.value.trim() ? Ipon.normalizeNamePart(middleName.value) : null;
        const last = Ipon.normalizeNamePart(lastName.value);
        const full = [first, middle, last].filter(Boolean).join(' ');
        const submittedEmail = email.value.trim().toLowerCase();
        const eligibility = await Ipon.rpc('check_admin_request_eligibility', { p_email: submittedEmail });
        if (eligibility && !eligibility.eligible) {
          const fallbackMsg = eligibility.message || 'This email cannot submit an administrator request.';
          setFieldError(email, eligibility.reason === 'rejected' ? 'This email was declined for administrator access and cannot request again.' : fallbackMsg);
          message.textContent = fallbackMsg;
          email.focus();
          return;
        }
        pendingSignupPayload = {
          email: submittedEmail,
          password: password.value,
          first,
          middle,
          last,
          full,
          contact: contactNumber.value.trim(),
          reason: requestReason.value.trim()
        };

        Ipon.setBusy(submit, true, 'Submitting administrator access…');
        const otpOutcome = await Ipon.sendAdminRequestVerificationCode({
          email: submittedEmail,
          full_name: full
        });

        if (otpOutcome?.error) {
          throw new Error(otpOutcome.error);
        }

        if (verifySubtitle) {
          verifySubtitle.textContent = `Enter the 6-digit verification code sent to ${submittedEmail}.`;
        }
        if (verifyError) {
          verifyError.hidden = true;
          verifyError.textContent = '';
        }
        if (verifyCode) {
          verifyCode.value = '';
        }
        verifyDialog?.showModal();
        verifyCode?.focus();
        Ipon.toast(`Verification code sent to ${submittedEmail}.`);
        return;
      } else {
        const { data, error } = await Ipon.client.auth.signInWithPassword({ email: email.value, password: password.value });
        if (error) throw error;
        if (await Ipon.requiresMfaChallenge()) {
          window.location.replace('mfa.html');
          return;
        }
        const { data: profile, error: profileError } = await Ipon.client.from('profiles').select('first_name,last_name,contact_number,role,status').eq('id', data.user.id).single();
        if (profileError) throw profileError;
        if (profile.status === 'DISABLED') {
          await Ipon.client.auth.signOut();
          throw new Error('Your administrator request was declined or your account is disabled.');
        }
        if (profile.status !== 'ACTIVE') {
          await Ipon.client.auth.signOut();
          throw new Error('Your account is waiting for administrator approval.');
        }
        await Ipon.rpc('record_account_activity', { p_event: 'LOGIN' });
        try {
          sessionStorage.setItem('ipon_active_role', profile.role);
          localStorage.setItem('ipon_active_role', profile.role);
        } catch {}
        Ipon.broadcastAuthEvent('SIGNED_IN', data.user.id);
        window.location.replace(Ipon.accountSetupUrl(profile, data.user) || Ipon.homeForRole(profile.role));
      }
    } catch (error) {
      if (mode === 'login' && (error?.code === 'invalid_credentials' || /invalid login credentials/i.test(error?.message || ''))) {
        [email, password].forEach((input) => input.setAttribute('aria-invalid', 'true'));
        message.textContent = 'Incorrect email or password.';
        password.focus();
      } else if (mode === 'signup' && (error?.code === 'weak_password' || /weak password/i.test(error?.message || ''))) {
        setFieldError(password, passwordRule);
        password.focus();
      } else {
        message.textContent = Ipon.friendlyError(error);
      }
    } finally {
      Ipon.setBusy(submit, false);
    }
  });

  verifyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!pendingSignupPayload) return;
    const code = String(verifyCode?.value || '').trim();
    if (!/^[0-9]{6}$/.test(code)) {
      if (verifyError) {
        verifyError.hidden = false;
        verifyError.textContent = 'Please enter a valid 6-digit numeric verification code.';
      }
      verifyCode?.focus();
      return;
    }

    const verifySubmitBtn = verifyForm.querySelector('[type="submit"]');
    Ipon.setBusy(verifySubmitBtn, true, 'Verifying code…');
    if (verifyError) {
      verifyError.hidden = true;
      verifyError.textContent = '';
    }

    try {
      const verifyRes = await Ipon.verifyAdminRequestVerificationCode({
        email: pendingSignupPayload.email,
        code
      });

      if (!verifyRes?.success) {
        throw new Error(verifyRes?.message || 'Invalid or expired verification code.');
      }

      const { data: signUpData, error } = await Ipon.client.auth.signUp({
        email: pendingSignupPayload.email,
        password: pendingSignupPayload.password,
        options: {
          data: {
            first_name: pendingSignupPayload.first,
            middle_name: pendingSignupPayload.middle,
            last_name: pendingSignupPayload.last,
            full_name: pendingSignupPayload.full,
            contact_number: pendingSignupPayload.contact,
            request_reason: pendingSignupPayload.reason,
            account_kind: 'ADMIN_REQUEST'
          }
        }
      });

      if (error) throw error;
      if (signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        throw new Error('An account or administrator request with this email already exists.');
      }

      await Ipon.client.auth.signOut();
      const submittedEmail = pendingSignupPayload.email;
      pendingSignupPayload = null;
      verifyDialog?.close();
      form.reset();
      setMode('login');
      email.value = submittedEmail;
      message.dataset.tone = 'success';
      message.textContent = 'Request submitted. Wait for an email update on your approval, then sign in once approved.';
      Ipon.toast('Administrator request submitted. Check your email for the decision.');
      if (requestSuccessEmail) requestSuccessEmail.textContent = `Updates will be sent to ${submittedEmail}`;
      requestSuccessDialog?.showModal();
    } catch (err) {
      if (verifyError) {
        verifyError.hidden = false;
        verifyError.textContent = Ipon.friendlyError(err);
      }
      verifyCode?.focus();
    } finally {
      Ipon.setBusy(verifySubmitBtn, false);
    }
  });

  verifyResend?.addEventListener('click', async () => {
    if (!pendingSignupPayload) return;
    Ipon.setBusy(verifyResend, true, 'Resending…');
    if (verifyError) {
      verifyError.hidden = true;
      verifyError.textContent = '';
    }
    try {
      const res = await Ipon.sendAdminRequestVerificationCode({
        email: pendingSignupPayload.email,
        full_name: pendingSignupPayload.full
      });
      if (res?.error) throw new Error(res.error);
      Ipon.toast(`Verification code resent to ${pendingSignupPayload.email}.`);
      verifyCode?.focus();
    } catch (err) {
      if (verifyError) {
        verifyError.hidden = false;
        verifyError.textContent = Ipon.friendlyError(err);
      }
    } finally {
      Ipon.setBusy(verifyResend, false);
    }
  });

  verifyClose?.addEventListener('click', () => {
    verifyDialog?.close();
  });
})();
