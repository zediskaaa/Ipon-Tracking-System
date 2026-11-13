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
  const passwordConfirmationToggle = document.getElementById('password-confirmation-toggle');
  const forgotButton = document.getElementById('forgot-password-open');
  const recoveryDialog = document.getElementById('recovery-dialog');
  const recoveryRequestForm = document.getElementById('recovery-request-form');
  const recoveryMessage = document.getElementById('recovery-message');
  const requestSuccessDialog = document.getElementById('request-success-dialog');
  const requestSuccessEmail = document.getElementById('request-success-email');
  const requestConfirmDialog = document.getElementById('request-confirm-dialog');
  const requestConfirmClose = document.getElementById('request-confirm-close');
  const requestConfirmEdit = document.getElementById('request-confirm-edit');
  const requestConfirmProceed = document.getElementById('request-confirm-proceed');
  const summaryFullName = document.getElementById('summary-full-name');
  const summaryContactNumber = document.getElementById('summary-contact-number');
  const summaryEmail = document.getElementById('summary-email');
  const summaryRequestReason = document.getElementById('summary-request-reason');
  const verifyDialog = document.getElementById('request-verify-dialog');
  const verifyForm = document.getElementById('request-verify-form');
  const verifySubtitle = document.getElementById('request-verify-subtitle');
  const verifyCode = document.getElementById('request-verify-code');
  const verifyError = document.getElementById('request-verify-error');
  const verifyResend = document.getElementById('request-verify-resend');
  const verifyClose = document.getElementById('request-verify-close');
  const verifyHelpBtn = document.getElementById('request-verify-help-btn');
  const verifyFallbackBox = document.getElementById('request-verify-fallback-box');
  const verifyFallbackCode = document.getElementById('request-verify-fallback-code');
  const verifyFillBtn = document.getElementById('request-verify-fill-btn');
  let currentVerificationCode = null;
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
  Ipon.setLoading(false);
  if (state.failed) return;
  if (state.session && state.profile?.status === 'ACTIVE') {
    Ipon.setLoading(true, 'Opening your records…');
    window.location.replace(Ipon.homeForRole(state.profile.role));
    return;
  }
  if (!state.configured) {
    message.textContent = 'Add your Supabase URL and anon key in js/config.js before signing in.';
    submit.disabled = true;
    forgotButton.disabled = true;
  }
  const queryParams = new URLSearchParams(location.search);
  const acceptInviteToken = queryParams.get('accept_invite');
  const acceptInviteEmail = (queryParams.get('email') || '').trim();

  if (acceptInviteToken && acceptInviteEmail) {
    try {
      history.replaceState({}, '', location.pathname);
    } catch { }
    setMode('login');
    email.value = acceptInviteEmail;
    Ipon.setLoading(true, 'Activating your invitation…');
    message.dataset.tone = 'loading';
    message.textContent = 'Activating your account…';

    try {
      const res = await Ipon.invokeAccountFunction({
        action: 'accept-email-invite',
        email: acceptInviteEmail,
        token: acceptInviteToken
      });
      Ipon.setLoading(false);
      if (res?.error) {
        message.removeAttribute('data-tone');
        message.textContent = res.error;
        Ipon.toast(res.error, 'error');
      } else {
        message.dataset.tone = 'success';
        message.textContent = res.already_active
          ? 'Your account is already active. Please sign in with your credentials.'
          : 'Invitation accepted! Your account is now active. Please sign in with your temporary password.';
        Ipon.toast('Invitation accepted! Please sign in.', 'success');
        password.focus();
      }
    } catch (err) {
      Ipon.setLoading(false);
      message.removeAttribute('data-tone');
      message.textContent = Ipon.friendlyError(err);
      Ipon.toast(Ipon.friendlyError(err), 'error');
    }
  } else if (queryParams.get('status') === 'password-reset') {
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

  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  const EYE_OFF_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.526 13.526 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61M2 2l20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function setPasswordVisibility(visible) {
    const type = visible ? 'text' : 'password';
    password.type = type;
    passwordConfirmation.type = type;
    const svg = visible ? EYE_OFF_SVG : EYE_OPEN_SVG;
    const label = `${visible ? 'Hide' : 'Show'} passwords`;
    const pressed = String(visible);
    [passwordToggle, passwordConfirmationToggle].forEach((btn) => {
      if (!btn) return;
      btn.innerHTML = svg;
      btn.setAttribute('aria-pressed', pressed);
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    });
  }

  const passwordStrength = Ipon.bindPasswordStrength(password, () => [firstName.value, middleName.value, lastName.value, email.value]);
  passwordConfirmationField?.after(passwordStrength.element);
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
      if (!requestReason.value.trim() || requestReason.value.trim().length < 10) {
        requestReason.value = 'Personal group savings account registration';
      }
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

  const loginTab = document.getElementById('show-login');
  const signupTab = document.getElementById('show-signup');
  const tabIndicator = document.getElementById('auth-tab-indicator');

  function updateTabIndicator(activeBtn) {
    if (!tabIndicator) return;
    const target = activeBtn || (mode === 'signup' ? signupTab : loginTab);
    if (!target) return;
    const left = target.offsetLeft;
    const width = target.offsetWidth;
    if (width > 0) {
      tabIndicator.style.transform = `translateX(${left}px)`;
      tabIndicator.style.width = `${width}px`;
    }
  }

  function setMode(next) {
    mode = next;
    const signup = mode === 'signup';
    document.body.classList.toggle('is-request-mode', signup);
    loginTab.classList.toggle('is-active', !signup);
    signupTab.classList.toggle('is-active', signup);
    loginTab.textContent = 'Sign in';
    signupTab.textContent = 'Create account';
    updateTabIndicator(signup ? signupTab : loginTab);
    requestAnimationFrame(() => updateTabIndicator(signup ? signupTab : loginTab));
    form.setAttribute('aria-labelledby', 'auth-title');
    firstNameField.hidden = !signup;
    middleNameField.hidden = !signup;
    lastNameField.hidden = !signup;
    contactField.hidden = !signup;
    reasonField.hidden = true;
    firstName.required = signup;
    lastName.required = signup;
    contactNumber.required = signup;
    requestReason.required = false;
    passwordConfirmationField.hidden = !signup;
    passwordConfirmation.required = signup;
    if (passwordRequirements) passwordRequirements.hidden = true;
    passwordStrength.element.hidden = !signup;
    forgotButton.hidden = signup;
    password.autocomplete = signup ? 'new-password' : 'current-password';
    if (signup) { password.minLength = 8; password.maxLength = 128; }
    else { password.removeAttribute('minlength'); password.removeAttribute('maxlength'); }
    document.getElementById('auth-title').textContent = signup ? 'Create your account' : 'Welcome back';
    document.getElementById('auth-copy').textContent = signup ? 'Sign up with myIPON to track and manage your group savings.' : 'Sign in to view your savings records.';
    submit.textContent = signup ? 'Create account' : 'Sign in';
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
  passwordToggle?.addEventListener('click', () => setPasswordVisibility(password.type === 'password'));
  passwordConfirmationToggle?.addEventListener('click', () => setPasswordVisibility(passwordConfirmation.type === 'password'));
  loginTab?.addEventListener('click', () => setMode('login'));
  signupTab?.addEventListener('click', () => setMode('signup'));
  if (new URLSearchParams(location.search).get('mode') === 'signup') setMode('signup');
  else updateTabIndicator(loginTab);
  window.addEventListener('resize', () => updateTabIndicator());
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => updateTabIndicator());
  }
  requestAnimationFrame(() => updateTabIndicator());
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
        setFieldError(email, 'This email was declined and cannot register again.');
      }
    } catch (_) { }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    delete message.dataset.tone;
    message.textContent = '';
    if (!validateForm()) return;

    Ipon.setBusy(submit, true, mode === 'signup' ? 'Creating account…' : 'Signing in...');
    try {
      if (mode === 'signup') {
        const first = Ipon.normalizeNamePart(firstName.value);
        const middle = middleName.value.trim() ? Ipon.normalizeNamePart(middleName.value) : null;
        const last = Ipon.normalizeNamePart(lastName.value);
        const full = [first, middle, last].filter(Boolean).join(' ');
        const submittedEmail = email.value.trim().toLowerCase();
        const eligibility = await Ipon.rpc('check_admin_request_eligibility', { p_email: submittedEmail });
        if (eligibility && !eligibility.eligible) {
          const fallbackMsg = eligibility.message || 'This email cannot register.';
          setFieldError(email, eligibility.reason === 'rejected' ? 'This email was declined and cannot register again.' : fallbackMsg);
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

        if (summaryFullName) summaryFullName.textContent = full;
        if (summaryContactNumber) summaryContactNumber.textContent = contactNumber.value.trim();
        if (summaryEmail) summaryEmail.textContent = submittedEmail;
        if (summaryRequestReason) summaryRequestReason.textContent = requestReason.value.trim();

        requestConfirmDialog?.showModal();
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
          throw new Error('Your account is deactivated or disabled.');
        }
        if (profile.status !== 'ACTIVE') {
          try {
            await Ipon.invokeAccountFunction({
              action: 'ensure-account-active',
              user_id: data.user.id,
              email: email.value
            });
            profile.status = 'ACTIVE';
          } catch {
            profile.status = 'ACTIVE';
          }
        }
        await Ipon.rpc('record_account_activity', { p_event: 'LOGIN' });
        try {
          sessionStorage.setItem('ipon_active_role', profile.role);
          localStorage.setItem('ipon_active_role', profile.role);
        } catch { }
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

  async function completeAdminRequestSubmission(payload) {
    if (!payload) return;
    const res = await Ipon.submitAdminRequest({
      email: payload.email,
      password: payload.password,
      first: payload.first,
      middle: payload.middle,
      last: payload.last,
      full: payload.full,
      contact: payload.contact,
      reason: payload.reason || 'Personal group savings account registration',
      direct_signup: true
    });

    if (res?.error) throw new Error(res.error);

    const submittedEmail = payload.email;
    const submittedPassword = payload.password;
    pendingSignupPayload = null;
    verifyDialog?.close();
    requestConfirmDialog?.close();

    try {
      Ipon.setLoading(true, 'Signing you in…');
      Ipon.toast('Account verified! Signing you in…');
      const { data, error: loginError } = await Ipon.client.auth.signInWithPassword({
        email: submittedEmail,
        password: submittedPassword
      });
      if (loginError) throw loginError;

      await Ipon.invokeAccountFunction({
        action: 'ensure-account-active',
        user_id: data.user.id,
        email: submittedEmail
      }).catch(() => null);

      const { data: profile } = await Ipon.client.from('profiles').select('id,role,status,first_name,last_name,contact_number').eq('id', data.user.id).single();
      const role = profile?.role || 'MEMBER';
      try {
        sessionStorage.setItem('ipon_active_role', role);
        localStorage.setItem('ipon_active_role', role);
      } catch { }
      Ipon.broadcastAuthEvent('SIGNED_IN', data.user.id);
      window.location.replace(Ipon.accountSetupUrl(profile, data.user) || Ipon.homeForRole(role));
    } catch (err) {
      console.error('Auto login error:', err);
      Ipon.setLoading(false);
      form.reset();
      setMode('login');
      email.value = submittedEmail;
      message.dataset.tone = 'success';
      message.textContent = 'Account created and verified! Please sign in with your password.';
      Ipon.toast('Account verified. Please sign in.');
      if (requestSuccessEmail) requestSuccessEmail.textContent = `Account created for ${submittedEmail}. Sign in to continue.`;
      requestSuccessDialog?.showModal();
      password.focus();
    }
  }

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

      await completeAdminRequestSubmission(pendingSignupPayload);
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
      currentVerificationCode = res?.code || currentVerificationCode;
      const verifyTimer = document.getElementById('request-verify-timer');
      if (verifyCode) {
        verifyCode.value = '';
      }
      if (verifyTimer) {
        verifyTimer.innerHTML = 'Code expires in 10 minutes. If not in inbox, please check your <strong>Spam / Junk</strong> folder.';
      }
      if (verifyFallbackCode && currentVerificationCode) {
        verifyFallbackCode.textContent = currentVerificationCode;
      }
      Ipon.toast(`Verification code resent to ${pendingSignupPayload.email}. Please check your inbox or spam folder.`);
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
  requestConfirmEdit?.addEventListener('click', () => {
    requestConfirmDialog?.close();
  });

  requestConfirmClose?.addEventListener('click', () => {
    requestConfirmDialog?.close();
  });

  requestConfirmProceed?.addEventListener('click', async () => {
    if (!pendingSignupPayload) return;
    Ipon.setBusy(requestConfirmProceed, true, 'Sending code…');
    try {
      const otpOutcome = await Ipon.sendAdminRequestVerificationCode({
        email: pendingSignupPayload.email,
        full_name: pendingSignupPayload.full
      });

      if (otpOutcome?.error) {
        throw new Error(otpOutcome.error);
      }

      currentVerificationCode = otpOutcome?.code || null;
      requestConfirmDialog?.close();

      if (verifySubtitle) {
        verifySubtitle.textContent = `Enter the 6-digit verification code sent to ${pendingSignupPayload.email}.`;
      }
      if (verifyError) {
        verifyError.hidden = true;
        verifyError.textContent = '';
      }
      const verifyTimer = document.getElementById('request-verify-timer');
      if (verifyTimer) {
        verifyTimer.innerHTML = 'Code expires in 10 minutes. If not in inbox, please check your <strong>Spam / Junk</strong> folder.';
      }
      if (verifyCode) {
        verifyCode.value = '';
      }
      if (verifyFallbackBox) {
        verifyFallbackBox.hidden = true;
      }
      if (verifyFallbackCode && currentVerificationCode) {
        verifyFallbackCode.textContent = currentVerificationCode;
      }
      verifyDialog?.showModal();
      verifyCode?.focus();
      Ipon.toast(`Verification code sent to ${pendingSignupPayload.email}. Please check your inbox or spam folder.`);
    } catch (err) {
      Ipon.toast(Ipon.friendlyError(err), 'error');
    } finally {
      Ipon.setBusy(requestConfirmProceed, false);
    }
  });

  verifyHelpBtn?.addEventListener('click', () => {
    if (!verifyFallbackBox) return;
    verifyFallbackBox.hidden = !verifyFallbackBox.hidden;
    if (!verifyFallbackBox.hidden && verifyFallbackCode && currentVerificationCode) {
      verifyFallbackCode.textContent = currentVerificationCode;
    }
  });

  verifyFillBtn?.addEventListener('click', () => {
    if (currentVerificationCode && verifyCode) {
      verifyCode.value = currentVerificationCode;
      verifyCode.focus();
      if (verifyError) {
        verifyError.hidden = true;
        verifyError.textContent = '';
      }
    }
  });

  verifyClose?.addEventListener('click', () => {
    verifyDialog?.close();
  });
})();
