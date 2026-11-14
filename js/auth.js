(function () {
  'use strict';
  const form = document.getElementById('auth-form');
  const message = document.getElementById('auth-message');
  const submit = document.getElementById('auth-submit');
  const securityNotice = document.getElementById('auth-security-notice');
  const securityTitle = document.getElementById('auth-security-title');
  const securityDetail = document.getElementById('auth-security-detail');
  const securityTimer = document.getElementById('auth-security-timer');
  const securityBarWrap = document.getElementById('auth-security-bar-wrap');
  const securityBar = document.getElementById('auth-security-bar');
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
  const inviteSuccessDialog = document.getElementById('invite-success-dialog');
  const inviteSuccessMessage = document.getElementById('invite-success-message');
  const inviteSuccessGroupHint = document.getElementById('invite-success-group-hint');
  const inviteSuccessEmail = document.getElementById('invite-success-email');
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
  [firstName, middleName, lastName].forEach((input) => {
    if (!input || !Ipon.nameRuleForField) return;
    const meta = Ipon.nameRuleForField(input.name);
    input.title = meta.ruleMsg;
    if (!input.placeholder && meta.placeholder) input.placeholder = meta.placeholder;
  });
  let mode = 'login';
  const LOGIN_THROTTLE_STORAGE_KEY = 'myipon_login_throttle_v1';
  const LOGIN_MAX_ATTEMPTS = 5;
  const LOGIN_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
  let lockCountdownTimer = null;

  function computeLockoutSeconds(failedAttempts) {
    if (failedAttempts < LOGIN_MAX_ATTEMPTS) return 0;
    const step = failedAttempts - LOGIN_MAX_ATTEMPTS;
    if (step === 0) return 180;
    if (step === 1) return 600;
    if (step === 2) return 1800;
    if (step === 3) return 3600;
    return Math.min(86400, 3600 * Math.pow(2, Math.min(5, step - 3)));
  }

  function formatLockCountdown(totalSeconds) {
    const secs = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const rem = secs % 60;
    if (hrs > 0) return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function formatLockDurationText(seconds) {
    const secs = Math.max(1, Math.round(Number(seconds) || 0));
    if (secs < 60) return `${secs} second${secs === 1 ? '' : 's'}`;
    if (secs % 3600 === 0) {
      const hrs = secs / 3600;
      return `${hrs} hour${hrs === 1 ? '' : 's'}`;
    }
    const mins = Math.ceil(secs / 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }

  function readThrottleMap() {
    try {
      const raw = localStorage.getItem(LOGIN_THROTTLE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeThrottleMap(map) {
    try {
      const entries = Object.entries(map || {});
      if (!entries.length) localStorage.removeItem(LOGIN_THROTTLE_STORAGE_KEY);
      else localStorage.setItem(LOGIN_THROTTLE_STORAGE_KEY, JSON.stringify(map));
    } catch { }
  }

  function normalizeThrottleEmail(rawEmail) {
    return String(rawEmail || '').trim().toLowerCase();
  }

  function pruneThrottleEntry(entry, nowMs) {
    if (!entry || typeof entry !== 'object') return null;
    const lockedUntilMs = Number(entry.lockedUntilMs || 0);
    const lastFailedAt = Number(entry.lastFailedAt || 0);
    const isLocked = lockedUntilMs > nowMs;
    if (!isLocked && lastFailedAt > 0 && nowMs - lastFailedAt > LOGIN_STALE_WINDOW_MS) {
      return null;
    }
    return {
      failedAttempts: Math.max(0, Number(entry.failedAttempts || 0)),
      lockedUntilMs,
      lockDurationSeconds: Math.max(0, Number(entry.lockDurationSeconds || 0)),
      nextLockDurationSeconds: Math.max(180, Number(entry.nextLockDurationSeconds || 180)),
      lastFailedAt,
      scope: entry.scope || 'EMAIL',
      cooldownCompletedShown: Boolean(entry.cooldownCompletedShown)
    };
  }

  function getActiveThrottleState(rawEmail) {
    const nowMs = Date.now();
    const map = readThrottleMap();
    let changed = false;
    const clean = {};
    for (const [key, value] of Object.entries(map)) {
      const pruned = pruneThrottleEntry(value, nowMs);
      if (pruned) clean[key] = pruned;
      else changed = true;
    }
    if (changed) writeThrottleMap(clean);

    const normEmail = normalizeThrottleEmail(rawEmail);
    const emailEntry = normEmail ? clean[`email:${normEmail}`] || null : null;
    const ipEntry = clean['__ip__'] || null;
    const emailRem = emailEntry && emailEntry.lockedUntilMs > nowMs ? emailEntry.lockedUntilMs - nowMs : 0;
    const ipRem = ipEntry && ipEntry.lockedUntilMs > nowMs ? ipEntry.lockedUntilMs - nowMs : 0;

    if (ipRem > emailRem && ipRem > 0) return { key: '__ip__', entry: ipEntry };
    if (emailRem > 0) return { key: `email:${normEmail}`, entry: emailEntry };
    if (emailEntry) return { key: `email:${normEmail}`, entry: emailEntry };
    if (ipEntry && ipEntry.lockedUntilMs > nowMs) return { key: '__ip__', entry: ipEntry };
    return { key: normEmail ? `email:${normEmail}` : '', entry: null };
  }

  function syncThrottleFromServer(rawEmail, throttle) {
    if (!throttle || typeof throttle !== 'object') return;
    const nowMs = Date.now();
    const normEmail = normalizeThrottleEmail(rawEmail);
    const map = readThrottleMap();
    const retrySec = Math.max(0, Number(throttle.retry_after_seconds || 0));
    const failedAttempts = Math.max(0, Number(throttle.failed_attempts || 0));
    const locked = Boolean(throttle.locked) && retrySec > 0;
    const key = throttle.scope === 'IP' ? '__ip__' : (normEmail ? `email:${normEmail}` : '');
    if (!key) return;

    if (!locked && failedAttempts === 0) {
      delete map[key];
      writeThrottleMap(map);
      return;
    }

    const lockDur = Math.max(
      retrySec,
      Number(throttle.lock_duration_seconds || computeLockoutSeconds(failedAttempts) || (locked ? 180 : 0))
    );
    const nextDur = Math.max(
      180,
      Number(throttle.next_lock_duration_seconds || computeLockoutSeconds(Math.max(LOGIN_MAX_ATTEMPTS, failedAttempts + 1)))
    );

    map[key] = {
      failedAttempts,
      lockedUntilMs: locked ? nowMs + retrySec * 1000 : 0,
      lockDurationSeconds: lockDur,
      nextLockDurationSeconds: nextDur,
      lastFailedAt: nowMs,
      scope: throttle.scope === 'IP' ? 'IP' : 'EMAIL',
      cooldownCompletedShown: false
    };
    writeThrottleMap(map);
  }

  function recordLocalFailedAttempt(rawEmail) {
    const normEmail = normalizeThrottleEmail(rawEmail);
    if (!normEmail) return;
    const nowMs = Date.now();
    const map = readThrottleMap();
    const key = `email:${normEmail}`;
    const existing = pruneThrottleEntry(map[key], nowMs);
    if (existing && existing.lockedUntilMs > nowMs) return;

    const failedAttempts = (existing?.failedAttempts || 0) + 1;
    const lockDurationSeconds = computeLockoutSeconds(failedAttempts);
    const nextLockDurationSeconds = computeLockoutSeconds(Math.max(LOGIN_MAX_ATTEMPTS, failedAttempts + 1));
    map[key] = {
      failedAttempts,
      lockedUntilMs: lockDurationSeconds > 0 ? nowMs + lockDurationSeconds * 1000 : 0,
      lockDurationSeconds,
      nextLockDurationSeconds,
      lastFailedAt: nowMs,
      scope: 'EMAIL',
      cooldownCompletedShown: false
    };
    writeThrottleMap(map);
  }

  function clearLocalThrottle(rawEmail) {
    const normEmail = normalizeThrottleEmail(rawEmail);
    const map = readThrottleMap();
    let changed = false;
    if (normEmail && map[`email:${normEmail}`]) {
      delete map[`email:${normEmail}`];
      changed = true;
    }
    if (map['__ip__'] && Number(map['__ip__'].lockedUntilMs || 0) <= Date.now()) {
      delete map['__ip__'];
      changed = true;
    }
    if (changed) writeThrottleMap(map);
  }

  function refreshSubmitLockState() {
    if (!submit) return false;
    if (mode !== 'login') {
      submit.classList.remove('is-locked');
      if (!submit.classList.contains('is-busy')) {
        submit.disabled = false;
        submit.textContent = 'Create account';
      }
      return false;
    }
    const { entry } = getActiveThrottleState(email?.value);
    const nowMs = Date.now();
    if (entry && entry.lockedUntilMs > nowMs) {
      const remSec = Math.max(1, Math.ceil((entry.lockedUntilMs - nowMs) / 1000));
      submit.disabled = true;
      submit.classList.add('is-locked');
      submit.textContent = `Wait ${formatLockCountdown(remSec)}`;
      return true;
    }
    submit.classList.remove('is-locked');
    if (!submit.classList.contains('is-busy')) {
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
    return false;
  }

  function renderSecurityNotice() {
    if (!securityNotice) return;
    if (lockCountdownTimer) {
      clearInterval(lockCountdownTimer);
      lockCountdownTimer = null;
    }
    if (mode !== 'login') {
      securityNotice.hidden = true;
      delete securityNotice.dataset.state;
      if (securityTimer) securityTimer.hidden = true;
      if (securityBarWrap) securityBarWrap.hidden = true;
      refreshSubmitLockState();
      return;
    }

    const active = getActiveThrottleState(email?.value);
    const entry = active.entry;
    const nowMs = Date.now();

    if (entry && entry.lockedUntilMs > nowMs) {
      const updateTick = () => {
        const currentNow = Date.now();
        const remMs = entry.lockedUntilMs - currentNow;
        if (remMs <= 0) {
          if (lockCountdownTimer) {
            clearInterval(lockCountdownTimer);
            lockCountdownTimer = null;
          }
          const map = readThrottleMap();
          if (active.key && map[active.key]) {
            map[active.key].lockedUntilMs = 0;
            map[active.key].cooldownCompletedShown = true;
            writeThrottleMap(map);
          }
          securityNotice.hidden = false;
          securityNotice.dataset.state = 'ready';
          if (securityTitle) securityTitle.textContent = 'Cooldown complete';
          if (securityDetail) securityDetail.textContent = 'You can try signing in again now. Forgot your password? Reset it below.';
          if (securityTimer) securityTimer.hidden = true;
          if (securityBarWrap) securityBarWrap.hidden = true;
          refreshSubmitLockState();
          return;
        }
        const remSec = Math.max(1, Math.ceil(remMs / 1000));
        const totalSec = Math.max(remSec, entry.lockDurationSeconds || 180);
        const pct = Math.max(2, Math.min(100, Math.round((remSec / totalSec) * 100)));
        const nextText = formatLockDurationText(entry.nextLockDurationSeconds || 600);
        securityNotice.hidden = false;
        securityNotice.dataset.state = 'locked';
        if (securityTitle) securityTitle.textContent = 'Too many failed sign-in attempts';
        if (securityDetail) securityDetail.textContent = `For security, wait before retrying. Another wrong password raises the wait to ${nextText}.`;
        if (securityTimer) {
          securityTimer.hidden = false;
          securityTimer.textContent = formatLockCountdown(remSec);
        }
        if (securityBarWrap) securityBarWrap.hidden = false;
        if (securityBar) securityBar.style.width = `${pct}%`;
        refreshSubmitLockState();
      };
      updateTick();
      lockCountdownTimer = setInterval(updateTick, 1000);
      return;
    }

    if (entry && entry.failedAttempts >= 3 && entry.failedAttempts < LOGIN_MAX_ATTEMPTS) {
      const left = LOGIN_MAX_ATTEMPTS - entry.failedAttempts;
      securityNotice.hidden = false;
      securityNotice.dataset.state = 'warn';
      if (securityTitle) securityTitle.textContent = 'Security notice';
      if (securityDetail) securityDetail.textContent = `${left} attempt${left === 1 ? '' : 's'} left before a 3-minute sign-in cooldown.`;
      if (securityTimer) securityTimer.hidden = true;
      if (securityBarWrap) securityBarWrap.hidden = true;
      refreshSubmitLockState();
      return;
    }

    if (entry && entry.cooldownCompletedShown) {
      securityNotice.hidden = false;
      securityNotice.dataset.state = 'ready';
      if (securityTitle) securityTitle.textContent = 'Cooldown complete';
      if (securityDetail) securityDetail.textContent = 'You can try signing in again now. Forgot your password? Reset it below.';
      if (securityTimer) securityTimer.hidden = true;
      if (securityBarWrap) securityBarWrap.hidden = true;
      refreshSubmitLockState();
      return;
    }

    securityNotice.hidden = true;
    delete securityNotice.dataset.state;
    if (securityTimer) securityTimer.hidden = true;
    if (securityBarWrap) securityBarWrap.hidden = true;
    refreshSubmitLockState();
  }

  async function syncServerThrottleStatus(rawEmail) {
    if (mode !== 'login') return;
    const normEmail = normalizeThrottleEmail(rawEmail);
    if (!normEmail || !normEmail.includes('@')) return;
    try {
      await ensureInitReady();
      const res = await Ipon.invokeAccountFunction({
        action: 'login-throttle-status',
        email: normEmail
      });
      if (res?.ok && res.locked && Number(res.retry_after_seconds || 0) > 0) {
        syncThrottleFromServer(normEmail, res);
        if (normalizeThrottleEmail(email?.value) === normEmail) renderSecurityNotice();
      }
    } catch { }
  }

  if (window.Capacitor !== undefined || window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
    document.body.classList.add('is-app');
  }

  const queryParams = new URLSearchParams(location.search);
  const acceptInviteToken = queryParams.get('accept_invite');
  const acceptInviteEmail = (queryParams.get('email') || '').trim();
  const statusParam = queryParams.get('status');
  const isAppLaunch = document.body.classList.contains('is-app') || queryParams.has('app');
  const splashStartedAt = Date.now();
  const splashMinUntil = splashStartedAt + (isAppLaunch ? 950 : 450);

  const dismissSplash = () => {
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('is-hidden');
    setTimeout(() => { try { splash.remove(); } catch (_) { } }, 450);
  };
  const splashSafetyTimer = setTimeout(dismissSplash, 5000);

  // Start init immediately without delaying synchronous form/tab listener attachment
  const initPromise = Ipon.init({ requireAuth: false, allowPending: true }).catch((error) => ({ failed: true, configured: false, error }));

  async function resolveActiveProfile(user, fallbackEmail) {
    const profileCols = 'id,first_name,middle_name,last_name,contact_number,role,status,name_setup_required';
    const loadProfile = () => Ipon.client.from('profiles').select(profileCols).eq('id', user.id).maybeSingle();
    let { data: profile, error: profileError } = await loadProfile();
    if (profileError) throw profileError;

    if (profile?.status === 'DISABLED') {
      await Ipon.client.auth.signOut().catch(() => null);
      throw new Error('Your account is deactivated or disabled.');
    }

    if (!profile || profile.status !== 'ACTIVE') {
      // Try direct DB RPC first (no Edge Function cold start or deployment skew dependency), then Edge Function fallback
      await Ipon.rpc('activate_own_pending_account').catch(() => null);
      ({ data: profile, error: profileError } = await loadProfile());
      if (profileError) throw profileError;

      if (!profile || profile.status !== 'ACTIVE') {
        await Ipon.invokeAccountFunction({
          action: 'ensure-account-active',
          user_id: user.id,
          email: fallbackEmail || user.email || ''
        }).catch(() => null);
        ({ data: profile, error: profileError } = await loadProfile());
        if (profileError) throw profileError;
      }
    }

    if (profile?.status === 'DISABLED') {
      await Ipon.client.auth.signOut().catch(() => null);
      throw new Error('Your account is deactivated or disabled.');
    }
    if (!profile || profile.status !== 'ACTIVE') {
      await Ipon.client.auth.signOut().catch(() => null);
      throw new Error('Your account is still pending activation. Please try signing in again or ask your administrator to check your account status.');
    }
    return profile;
  }

  function completeLoginSession(data, profile) {
    const role = profile?.role || 'MEMBER';
    try {
      sessionStorage.setItem('ipon_active_role', role);
      localStorage.setItem('ipon_active_role', role);
      sessionStorage.setItem('myipon_just_logged_in', '1');
    } catch { }
    Ipon.broadcastAuthEvent('SIGNED_IN', data.user.id);
    window.location.replace(Ipon.accountSetupUrl(profile, data.user) || Ipon.homeForRole(role));
  }

  async function ensureInitReady() {
    const state = await initPromise;
    if (state?.failed) throw state.error || new Error('Connection failed. Please reload and try again.');
    if (!state?.configured || !Ipon.client) throw new Error('Account service is not configured yet.');
    return state;
  }

  void (async () => {
    const state = await initPromise;
    Ipon.setLoading(false);
    if (state.failed) {
      clearTimeout(splashSafetyTimer);
      dismissSplash();
      return;
    }
    if (state.session && state.profile?.status === 'ACTIVE') {
      clearTimeout(splashSafetyTimer);
      const waitMs = isAppLaunch ? Math.max(0, splashMinUntil - Date.now()) : 0;
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (!document.getElementById('app-splash')) Ipon.setLoading(true, 'Opening your records…');
      window.location.replace(Ipon.accountSetupUrl(state.profile, state.session.user) || Ipon.homeForRole(state.profile.role));
      return;
    }
    clearTimeout(splashSafetyTimer);
    setTimeout(dismissSplash, Math.max(350, splashMinUntil - Date.now()));
    if (!state.configured) {
      message.textContent = 'Add your Supabase URL and anon key in js/config.js before signing in.';
      submit.disabled = true;
      forgotButton.disabled = true;
      return;
    }
    renderSecurityNotice();
    if (email?.value) syncServerThrottleStatus(email.value);

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
            : 'Account activation successful! Log in to your account using the provided credentials.';
          Ipon.toast('Account activated! Please sign in.', 'success');

          if (inviteSuccessDialog) {
            if (inviteSuccessEmail) inviteSuccessEmail.textContent = acceptInviteEmail;
            if (inviteSuccessMessage) {
              inviteSuccessMessage.textContent = res.group_name
                ? `Account activation successful! Log in to your account using the provided credentials to access "${res.group_name}".`
                : 'Account activation successful! Log in to your account using the provided credentials.';
            }
            if (inviteSuccessGroupHint) {
              inviteSuccessGroupHint.textContent = res.group_name
                ? `Your savings group workspace "${res.group_name}" is ready and linked to your account.`
                : 'Your savings group workspace has been linked and will open automatically after sign in.';
            }
            inviteSuccessDialog.showModal();
          }
          password.focus();
        }
      } catch (err) {
        Ipon.setLoading(false);
        message.removeAttribute('data-tone');
        message.textContent = Ipon.friendlyError(err);
        Ipon.toast(Ipon.friendlyError(err), 'error');
      }
    } else if (statusParam === 'password-reset') {
      message.dataset.tone = 'success';
      message.textContent = 'Password changed. Sign in with your new password.';
    } else if (statusParam === 'pending') {
      message.dataset.tone = 'error';
      message.textContent = 'Your account activation was still pending. Please sign in again to finish activating your access, or contact your administrator.';
    } else if (statusParam === 'disabled') {
      message.dataset.tone = 'error';
      message.textContent = 'Your account is deactivated or disabled. Please contact your administrator.';
    }
  })();

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

  const EYE_OPEN_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c3-5.5 6.5-7 10-7s7 1.5 10 7c-3 5.5-6.5 7-10 7s-7-1.5-10-7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
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
      const firstErr = !firstName.value.trim()
        ? 'Enter your first name.'
        : Ipon.nameValidationError(firstName.value, { required: true, fieldName: 'first_name' });
      if (firstErr) setFieldError(firstName, firstErr);
      const middleErr = middleName.value.trim()
        ? Ipon.nameValidationError(middleName.value, { allowSingleInitial: true, required: false, fieldName: 'middle_name' })
        : '';
      if (middleErr) setFieldError(middleName, middleErr);
      const lastErr = !lastName.value.trim()
        ? 'Enter your last name or surname.'
        : Ipon.nameValidationError(lastName.value, { required: true, fieldName: 'last_name' });
      if (lastErr) setFieldError(lastName, lastErr);
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
    renderSecurityNotice();
  }

  fieldErrors.forEach((_, input) => input.addEventListener('input', () => clearFieldError(input)));
  const clearCredentialError = () => {
    if (mode !== 'login' || message.textContent !== 'Incorrect email or password.') return;
    [email, password].forEach((input) => input.removeAttribute('aria-invalid'));
    message.textContent = '';
  };
  email.addEventListener('input', () => {
    clearCredentialError();
    if (mode === 'login') renderSecurityNotice();
  });
  password.addEventListener('input', clearCredentialError);
  email.addEventListener('blur', () => {
    email.value = email.value.trim();
    if (mode === 'login') {
      renderSecurityNotice();
      syncServerThrottleStatus(email.value);
    }
  });
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
      await ensureInitReady();
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
  function openPolicyModal(policyName) {
    const policy = policyName === 'privacy' ? 'privacy' : 'terms';
    if (!policyDialog) return;
    document.getElementById('policy-title').textContent = policy === 'privacy' ? 'Privacy policy' : 'Terms of use';
    policyDialog.querySelectorAll('[data-policy-content]').forEach((section) => { section.hidden = section.dataset.policyContent !== policy; });
    if (!policyDialog.open) policyDialog.showModal();
  }
  document.querySelectorAll('[data-policy-open]').forEach((button) => button.addEventListener('click', () => openPolicyModal(button.dataset.policyOpen)));
  const requestedPolicy = new URLSearchParams(location.search).get('policy');
  if (requestedPolicy === 'terms' || requestedPolicy === 'privacy') {
    openPolicyModal(requestedPolicy);
    if (history.replaceState) {
      const cleanUrl = new URL(location.href);
      cleanUrl.searchParams.delete('policy');
      history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    }
  }

  document.querySelectorAll('[data-request-success-close]').forEach((btn) => btn.addEventListener('click', () => {
    requestSuccessDialog?.close();
    password.focus();
  }));

  document.querySelectorAll('[data-invite-success-close]').forEach((btn) => btn.addEventListener('click', () => {
    inviteSuccessDialog?.close();
    password.focus();
  }));

  email.addEventListener('blur', async () => {
    if (mode !== 'signup' || !email.value || !email.validity.valid) return;
    try {
      await ensureInitReady();
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
      await ensureInitReady();
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
        const submittedEmail = email.value.trim().toLowerCase();
        email.value = submittedEmail;
        const activeLock = getActiveThrottleState(submittedEmail).entry;
        if (activeLock && activeLock.lockedUntilMs > Date.now()) {
          renderSecurityNotice();
          message.dataset.tone = 'error';
          message.textContent = 'Too many incorrect sign-in attempts. Please wait for the countdown to finish.';
          return;
        }
        let edgeRes = null;
        let edgeFallback = false;
        try {
          edgeRes = await Ipon.invokeAccountFunction({
            action: 'login-attempt',
            email: submittedEmail,
            password: password.value
          });
        } catch (edgeError) {
          const edgeMsg = String(edgeError?.message || '');
          if (navigator.onLine === false || /failed to fetch|network|timeout|aborted|load failed/i.test(edgeMsg)) {
            throw edgeError;
          }
          edgeFallback = true;
        }

        let data;
        if (!edgeFallback && edgeRes && typeof edgeRes === 'object' && ('ok' in edgeRes || 'locked' in edgeRes || 'error' in edgeRes)) {
          if (edgeRes.ok && edgeRes.session?.access_token && edgeRes.session?.refresh_token) {
            const { data: sessionData, error: sessionError } = await Ipon.client.auth.setSession({
              access_token: edgeRes.session.access_token,
              refresh_token: edgeRes.session.refresh_token
            });
            if (sessionError) throw sessionError;
            clearLocalThrottle(submittedEmail);
            renderSecurityNotice();
            data = sessionData?.user ? sessionData : { user: edgeRes.user, session: edgeRes.session };
          } else if (edgeRes.error?.code === 'login_locked') {
            if (edgeRes.throttle) syncThrottleFromServer(submittedEmail, edgeRes.throttle);
            throw Object.assign(new Error(edgeRes.error.message || 'Too many incorrect sign-in attempts. Please wait before trying again.'), {
              code: 'login_locked',
              throttle: edgeRes.throttle || null
            });
          } else if (edgeRes.error?.code === 'email_not_confirmed') {
            throw Object.assign(new Error(edgeRes.error.message || 'Email not confirmed.'), { code: 'email_not_confirmed' });
          } else {
            if (edgeRes.throttle) syncThrottleFromServer(submittedEmail, edgeRes.throttle);
            throw Object.assign(new Error(edgeRes.error?.message || 'Incorrect email or password.'), {
              code: edgeRes.error?.code || 'invalid_credentials',
              throttle: edgeRes.throttle || null
            });
          }
        } else {
          const signInRes = await Ipon.client.auth.signInWithPassword({ email: submittedEmail, password: password.value });
          if (signInRes.error) throw signInRes.error;
          clearLocalThrottle(submittedEmail);
          renderSecurityNotice();
          data = signInRes.data;
        }

        if (await Ipon.requiresMfaChallenge()) {
          window.location.replace('mfa.html');
          return;
        }
        const profile = await resolveActiveProfile(data.user, submittedEmail);
        await Ipon.rpc('record_account_activity', { p_event: 'LOGIN' }).catch(() => null);
        completeLoginSession(data, profile);
      }
    } catch (error) {
      message.dataset.tone = 'error';
      if (mode === 'login' && error?.code === 'login_locked') {
        if (error?.throttle) syncThrottleFromServer(email.value.trim().toLowerCase(), error.throttle);
        renderSecurityNotice();
        message.textContent = 'Too many incorrect sign-in attempts. Please wait for the countdown to finish.';
      } else if (mode === 'login' && (error?.code === 'invalid_credentials' || /invalid login credentials/i.test(error?.message || ''))) {
        const failedEmail = email.value.trim().toLowerCase();
        [email, password].forEach((input) => input.setAttribute('aria-invalid', 'true'));
        message.textContent = 'Incorrect email or password.';
        if (error?.throttle) syncThrottleFromServer(failedEmail, error.throttle);
        else recordLocalFailedAttempt(failedEmail);
        renderSecurityNotice();
        const lockEntry = getActiveThrottleState(failedEmail).entry;
        if (!lockEntry || lockEntry.lockedUntilMs <= Date.now()) password.focus();
      } else if (mode === 'login' && (error?.code === 'email_not_confirmed' || /email not confirmed/i.test(error?.message || ''))) {
        message.textContent = 'Your email address is not confirmed yet. Please open your activation email or ask your administrator to update your password.';
        email.focus();
      } else if (mode === 'signup' && (error?.code === 'weak_password' || /weak password/i.test(error?.message || ''))) {
        setFieldError(password, passwordRule);
        password.focus();
      } else {
        message.textContent = Ipon.friendlyError(error);
      }
    } finally {
      Ipon.setBusy(submit, false);
      refreshSubmitLockState();
    }
  });

  async function completeAdminRequestSubmission(payload) {
    if (!payload) return;
    await ensureInitReady();
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

    const submittedEmail = String(payload.email || '').trim().toLowerCase();
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
      const profile = await resolveActiveProfile(data.user, submittedEmail);
      await Ipon.rpc('record_account_activity', { p_event: 'LOGIN' }).catch(() => null);
      completeLoginSession(data, profile);
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
        verifySubtitle.textContent = `Enter the 6-digit verification code sent to ${pendingSignupPayload.email}. If not in your inbox, check your Spam folder.`;
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
