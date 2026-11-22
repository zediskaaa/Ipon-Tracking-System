(function () {
  'use strict';
  const form = document.getElementById('auth-form');
  const message = document.getElementById('auth-message');
  const submit = document.getElementById('auth-submit');
  const authTitle = document.getElementById('auth-title');
  const authCopy = document.getElementById('auth-copy');
  const clerkSignInShell = document.getElementById('clerk-signin-shell');
  const clerkSignInLoading = document.getElementById('clerk-signin-loading');
  const clerkAppHandoff = document.getElementById('clerk-app-handoff');
  const clerkAppHandoffTitle = document.getElementById('clerk-app-handoff-title');
  const clerkAppHandoffCopy = document.getElementById('clerk-app-handoff-copy');
  const clerkAppHandoffBtn = document.getElementById('clerk-app-handoff-btn');
  const clerkSignInMessage = document.getElementById('clerk-signin-message');
  const socialSignupBlock = document.getElementById('social-signup-block');
  const socialSignupMessage = document.getElementById('social-signup-message');
  const socialSignupButtons = Array.from(document.querySelectorAll('[data-clerk-oauth]'));
  const signupStepHead = document.getElementById('signup-step-head');
  const signupMethodBackBtn = document.getElementById('signup-method-back');
  const emailChipText = document.getElementById('email-chip-text');
  const emailField = document.getElementById('email-field');
  const emailLabel = document.getElementById('email-label');
  const passwordField = document.getElementById('password-field');
  const initialUrlParams = new URLSearchParams(window.location.search);
  const isClerkSsoCallback = initialUrlParams.get('clerk_sso_callback') === '1';
  const isNativeAuthApp = () => Boolean(
    typeof window !== 'undefined'
    && (typeof window.IponNativeAuth?.consumePendingCallback === 'function'
      || (window.Capacitor?.isNativePlatform?.()
        && typeof window.Capacitor?.Plugins?.BackgroundNotifications?.consumeAuthCallback === 'function'))
  );
  const isCapacitorNativeApp = () => Boolean(
    typeof window !== 'undefined'
    && (
      isNativeAuthApp()
      || window.Capacitor?.isNativePlatform?.()
      || window.Capacitor?.Plugins?.BackgroundNotifications
    )
  );
  const appHandoffState = String(initialUrlParams.get('app_state') || '').trim();
  const isAppHandoff = initialUrlParams.get('app_handoff') === '1' && !isCapacitorNativeApp();
  const isExternalGoogleStart = isAppHandoff && initialUrlParams.get('start_google') === '1';
  const NATIVE_OAUTH_STATE_KEY = 'myipon_app_oauth_state_v1';
  const NATIVE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
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
  const usernameField = document.getElementById('username-field');
  const usernameInput = document.getElementById('username');
  const usernameStatus = document.getElementById('username-status');
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
  const deviceOtpDialog = document.getElementById('device-otp-dialog');
  const deviceOtpForm = document.getElementById('device-otp-form');
  const deviceOtpCode = document.getElementById('device-otp-code');
  const deviceOtpCopy = document.getElementById('device-otp-copy');
  const deviceOtpMessage = document.getElementById('device-otp-message');
  const deviceOtpResend = document.getElementById('device-otp-resend');
  const deviceOtpCancel = document.getElementById('device-otp-cancel');
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
  const summaryUsername = document.getElementById('summary-username');
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
    ...(usernameInput ? [[usernameInput, document.getElementById('username-error')]] : []),
    [email, document.getElementById('email-error')],
    [contactNumber, document.getElementById('contact-number-error')],
    [requestReason, document.getElementById('request-reason-error')],
    [password, document.getElementById('password-error')],
    [passwordConfirmation, document.getElementById('password-confirmation-error')]
  ]);
  const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const USERNAME_RULE = 'Use 3–24 lowercase letters, numbers, or underscores.';
  let signupUsernameCheckTimer = null;
  let signupUsernameCheckSeq = 0;
  let takenSignupUsername = '';
  let availableSignupUsername = '';
  const normalizeSignupUsername = (raw) => String(raw || '').trim().replace(/^@+/, '').toLowerCase();
  const normalizeLoginIdentifier = (raw) => {
    const trimmed = String(raw || '').trim().toLowerCase();
    if (!trimmed) return '';
    if (trimmed.includes('@') && !trimmed.startsWith('@')) return trimmed;
    return trimmed.replace(/^@+/, '');
  };
  const isValidLoginIdentifier = (raw) => {
    const trimmed = String(raw || '').trim().toLowerCase();
    if (!trimmed || trimmed.length > 254) return false;
    if (trimmed.includes('@') && !trimmed.startsWith('@')) return EMAIL_RE.test(trimmed);
    return USERNAME_RE.test(trimmed.replace(/^@+/, ''));
  };
  const passwordRule = 'Use at least 8 characters with uppercase, lowercase, a number, and a symbol.';
  [firstName, middleName, lastName].forEach((input) => {
    if (!input || !Ipon.nameRuleForField) return;
    const meta = Ipon.nameRuleForField(input.name);
    input.title = meta.ruleMsg;
    if (!input.placeholder && meta.placeholder) input.placeholder = meta.placeholder;
  });
  let mode = 'login';
  let signupStep = 'choice';
  let clerkLoadPromise = null;
  let clerkExchangeSessionId = '';
  let clerkExchangeInFlight = false;
  let socialOAuthInFlight = false;
  let socialOAuthLeftPage = false;
  let socialOAuthStartedAt = 0;
  let socialOAuthResetTimer = null;
  let socialOAuthSafetyTimer = null;
  let appHandoffStarted = false;
  let appHandoffRefreshTimer = null;
  let clerkOAuthRedirecting = false;
  let pendingDeviceOtp = null;
  const LOGIN_THROTTLE_STORAGE_KEY = 'myipon_login_throttle_v1';
  const LOGIN_MAX_ATTEMPTS = 5;
  const LOGIN_STALE_WINDOW_MS = 24 * 60 * 60 * 1000;
  let lockCountdownTimer = null;

  function setClerkSignInLoading(visible) {
    const active = Boolean(visible);
    if (clerkSignInShell) clerkSignInShell.hidden = !active;
    if (clerkSignInLoading) clerkSignInLoading.hidden = !active;
    if (clerkAppHandoff) clerkAppHandoff.hidden = true;
    if (form) form.hidden = active;
  }

  function setClerkSignInMessage(text = '', tone = 'error') {
    const clean = String(text || '').trim();
    if (clerkSignInMessage) {
      clerkSignInMessage.textContent = clean;
      if (clean && tone) clerkSignInMessage.dataset.tone = tone;
      else delete clerkSignInMessage.dataset.tone;
    }
    if (socialSignupMessage) {
      socialSignupMessage.textContent = tone === 'error' ? clean : '';
    }
    if (clean && tone === 'success' && message) {
      message.dataset.tone = 'success';
      message.textContent = clean;
    }
  }

  function createNativeOAuthState() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(NATIVE_OAUTH_STATE_KEY, JSON.stringify({ state, createdAt: Date.now() }));
    return state;
  }

  function verifyAndConsumeNativeOAuthState(receivedState) {
    let raw = null;
    try {
      raw = localStorage.getItem(NATIVE_OAUTH_STATE_KEY);
      localStorage.removeItem(NATIVE_OAUTH_STATE_KEY);
    } catch { }
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      const expected = String(parsed?.state || '');
      const createdAt = Number(parsed?.createdAt || 0);
      if (!expected || !receivedState || expected !== String(receivedState)) return false;
      if (createdAt > 0 && Date.now() - createdAt > NATIVE_OAUTH_STATE_TTL_MS) return false;
      return true;
    } catch {
      return false;
    }
  }

  function getClerkLoginReturnUrl() {
    try {
      const url = new URL('login.html', window.location.href);
      const cur = new URLSearchParams(window.location.search);
      for (const key of ['app', 'join', 'next', 'app_handoff', 'app_state']) {
        const val = cur.get(key);
        if (val !== null && val !== '') url.searchParams.set(key, val);
      }
      return url.toString();
    } catch {
      return 'login.html';
    }
  }

  function setSocialSignupMessage(text = '') {
    if (!socialSignupMessage) return;
    socialSignupMessage.textContent = String(text || '').trim();
  }

  function getClerkSsoCallbackUrl() {
    try {
      const url = new URL(getClerkLoginReturnUrl(), window.location.href);
      url.searchParams.set('clerk_sso_callback', '1');
      return url.toString();
    } catch {
      return 'login.html?clerk_sso_callback=1';
    }
  }

  function clearClerkSsoCallbackFromUrl() {
    try {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('clerk_sso_callback') && !url.hash) return;
      url.searchParams.delete('clerk_sso_callback');
      url.hash = '';
      history.replaceState(null, '', url.pathname + url.search);
    } catch { }
  }

  function syncSocialAuthLabels() {
    const prefix = mode === 'signup' ? 'Create with' : 'Continue with';
    socialSignupButtons.forEach((btn) => {
      const label = btn.querySelector('.social-signup-label');
      if (!label) return;
      const provider = btn.dataset.clerkOauth === 'oauth_facebook' ? 'Facebook' : 'Google';
      const text = `${prefix} ${provider}`;
      if (btn.classList.contains('is-busy')) btn.dataset.originalLabel = text;
      else label.textContent = text;
    });
  }

  function setSocialSignupBusy(triggerButton, busy) {
    socialSignupButtons.forEach((btn) => {
      btn.disabled = Boolean(busy);
      btn.classList.toggle('is-busy', Boolean(busy) && btn === triggerButton);
      const label = btn.querySelector('.social-signup-label');
      if (!label) return;
      if (busy && btn === triggerButton) {
        if (!btn.dataset.originalLabel) btn.dataset.originalLabel = label.textContent;
        label.textContent = 'Connecting…';
      } else if (btn.dataset.originalLabel) {
        label.textContent = btn.dataset.originalLabel;
        delete btn.dataset.originalLabel;
      }
    });
  }

  function clearSocialOAuthBusy() {
    clearTimeout(socialOAuthResetTimer);
    clearTimeout(socialOAuthSafetyTimer);
    socialOAuthResetTimer = null;
    socialOAuthSafetyTimer = null;
    socialOAuthInFlight = false;
    socialOAuthLeftPage = false;
    socialOAuthStartedAt = 0;
    setSocialSignupBusy(null, false);
    syncSocialAuthLabels();
  }

  async function scheduleResetSocialOAuthBusy() {
    if (!socialOAuthInFlight) return;
    if (await consumeNativeOAuthCallback()) return;
    clearTimeout(socialOAuthResetTimer);
    const elapsed = Date.now() - socialOAuthStartedAt;
    if (!socialOAuthLeftPage && elapsed < 1200) return;
    socialOAuthResetTimer = setTimeout(async () => {
      if (await consumeNativeOAuthCallback()) return;
      if (!clerkExchangeInFlight && socialOAuthInFlight) {
        clearSocialOAuthBusy();
      }
    }, 250);
  }

  function buildNativeAuthDeepLink(params) {
    const parts = [];
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    });
    return `myipon://auth-callback${parts.length ? `#${parts.join('&')}` : ''}`;
  }

  function showAppHandoffCard({ title, copy, href, buttonLabel = 'Open myIPON App', tone = '' }) {
    if (clerkSignInShell) clerkSignInShell.hidden = false;
    if (clerkSignInLoading) clerkSignInLoading.hidden = true;
    if (form) form.hidden = true;
    if (clerkAppHandoff) clerkAppHandoff.hidden = false;
    if (clerkAppHandoffTitle) clerkAppHandoffTitle.textContent = title || 'Returning to myIPON…';
    if (clerkAppHandoffCopy) {
      clerkAppHandoffCopy.textContent = copy || '';
      if (tone) clerkAppHandoffCopy.dataset.tone = tone;
      else delete clerkAppHandoffCopy.dataset.tone;
    }
    if (clerkAppHandoffBtn) {
      clerkAppHandoffBtn.href = href || 'myipon://auth-callback';
      clerkAppHandoffBtn.textContent = buttonLabel;
    }
  }

  function handoffErrorToNativeApp(errorMessage) {
    clearInterval(appHandoffRefreshTimer);
    appHandoffRefreshTimer = null;
    const cleanError = String(errorMessage || 'Google sign-in could not be completed. Please try again.').trim();
    const deepLink = buildNativeAuthDeepLink({ error: cleanError, app_state: appHandoffState });
    showAppHandoffCard({
      title: 'Sign-in could not finish',
      copy: cleanError,
      href: deepLink,
      buttonLabel: 'Return to myIPON App',
      tone: 'error'
    });
    try {
      window.location.replace(deepLink);
    } catch { }
  }

  async function handoffClerkSessionToNativeApp(clerk) {
    if (!clerk?.session || appHandoffStarted) return;
    appHandoffStarted = true;
    setClerkSignInMessage('');
    setClerkSignInLoading(true);
    try {
      const token = await clerk.session.getToken({ skipCache: true });
      if (!token) throw new Error('Your Google sign-in session could not be verified.');
      const deepLink = buildNativeAuthDeepLink({ clerk_token: token, app_state: appHandoffState });
      showAppHandoffCard({
        title: 'Returning to myIPON…',
        copy: 'Your Google account is verified. If the app did not open automatically, tap below to finish signing in.',
        href: deepLink,
        buttonLabel: 'Open myIPON App'
      });
      clearInterval(appHandoffRefreshTimer);
      let refreshCount = 0;
      appHandoffRefreshTimer = setInterval(async () => {
        refreshCount += 1;
        if (refreshCount > 4 || document.visibilityState === 'hidden') {
          clearInterval(appHandoffRefreshTimer);
          appHandoffRefreshTimer = null;
          return;
        }
        try {
          const freshToken = await clerk.session?.getToken?.({ skipCache: true });
          if (freshToken && clerkAppHandoffBtn) {
            clerkAppHandoffBtn.href = buildNativeAuthDeepLink({ clerk_token: freshToken, app_state: appHandoffState });
          }
        } catch { }
      }, 30000);
      window.addEventListener('pagehide', () => {
        clearInterval(appHandoffRefreshTimer);
        appHandoffRefreshTimer = null;
      }, { once: true });
      window.location.replace(deepLink);
    } catch (error) {
      appHandoffStarted = false;
      handoffErrorToNativeApp(Ipon.friendlyError(error));
    }
  }

  async function startClerkOAuth(strategy, triggerButton) {
    if (!strategy) return;
    setSocialSignupMessage('');
    setSocialSignupBusy(triggerButton, true);
    socialOAuthInFlight = true;
    socialOAuthLeftPage = false;
    socialOAuthStartedAt = Date.now();
    clearTimeout(socialOAuthSafetyTimer);
    socialOAuthSafetyTimer = setTimeout(() => {
      if (socialOAuthInFlight && !socialOAuthLeftPage && !clerkExchangeInFlight) {
        clearSocialOAuthBusy();
      }
    }, 8000);
    try {
      if (isCapacitorNativeApp() && !isNativeAuthApp()) {
        throw new Error('App sign-in is still loading. Reopen myIPON and try Google again.');
      }
      if (isNativeAuthApp()) {
        const openBrowser = window.Capacitor?.Plugins?.BackgroundNotifications?.openAuthBrowser;
        if (!openBrowser) throw new Error('Update myIPON to the latest APK to use Google sign-in.');
        await openBrowser({ appState: createNativeOAuthState(), signup: mode === 'signup' });
        return;
      }
      const clerk = await loadClerk();
      const resource = mode === 'login'
        ? (clerk?.client?.signIn || clerk?.client?.signUp)
        : (clerk?.client?.signUp || clerk?.client?.signIn);
      if (!resource?.authenticateWithRedirect) {
        throw new Error('Google sign-in is temporarily unavailable. Reload the page or continue with email below.');
      }
      if (clerk.session) {
        await clerk.signOut().catch(() => null);
      }
      await resource.authenticateWithRedirect({
        strategy,
        redirectUrl: getClerkSsoCallbackUrl(),
        redirectUrlComplete: getClerkLoginReturnUrl()
      });
    } catch (error) {
      clearSocialOAuthBusy();
      setSocialSignupMessage(Ipon.friendlyError(error));
    }
  }

  socialSignupButtons.forEach((btn) => {
    btn.addEventListener('click', () => startClerkOAuth(btn.dataset.clerkOauth, btn));
  });

  window.addEventListener('blur', () => {
    if (socialOAuthInFlight) socialOAuthLeftPage = true;
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (socialOAuthInFlight) socialOAuthLeftPage = true;
    } else if (document.visibilityState === 'visible') {
      scheduleResetSocialOAuthBusy();
    }
  });

  window.addEventListener('focus', () => {
    scheduleResetSocialOAuthBusy();
  });

  window.addEventListener('myipon:native-resume', () => {
    if (socialOAuthInFlight) socialOAuthLeftPage = true;
    scheduleResetSocialOAuthBusy();
  });

  window.addEventListener('pageshow', () => {
    if (!clerkExchangeInFlight) clearSocialOAuthBusy();
  });

  function handleClerkRouterNav(to, { windowNavigate } = {}) {
    try {
      const target = new URL(to, window.location.href);
      if (target.origin === window.location.origin) {
        if (/\/login(?:\.html)?$/i.test(target.pathname)) {
          if (isClerkSsoCallback && (target.search !== window.location.search || target.hash !== window.location.hash)) {
            clerkOAuthRedirecting = true;
            window.location.replace(target.href);
            return;
          }
          if (target.searchParams.get('mode') === 'signup') setMode('signup');
          return;
        }
        if (target.pathname === '/' || /\/index(?:\.html)?$/i.test(target.pathname)) {
          return;
        }
      }
    } catch { }
    if (typeof windowNavigate === 'function') windowNavigate(to);
    else window.location.assign(to);
  }

  function loadClerk() {
    if (!window.Clerk) return Promise.resolve(null);
    const returnUrl = getClerkLoginReturnUrl();
    const loadOpts = {
      signInFallbackRedirectUrl: returnUrl,
      signUpFallbackRedirectUrl: returnUrl,
      routerPush: handleClerkRouterNav,
      routerReplace: handleClerkRouterNav
    };
    if (window.__internal_ClerkUICtor) loadOpts.ui = { ClerkUI: window.__internal_ClerkUICtor };
    clerkLoadPromise ||= window.Clerk.load(loadOpts).then(() => window.Clerk).catch((error) => {
      console.error('Clerk initialization failed:', error);
      return null;
    });
    return clerkLoadPromise;
  }

  async function exchangeClerkToken(rawToken, { clerk = null, sessionKey = '' } = {}) {
    const token = String(rawToken || '').trim();
    const key = String(sessionKey || token.slice(-24));
    if (!token || !key || clerkExchangeSessionId === key) return;
    clerkExchangeSessionId = key;
    clerkExchangeInFlight = true;
    clearSocialOAuthBusy();
    setClerkSignInMessage('');
    setClerkSignInLoading(true);
    try {
      await ensureInitReady();
      const { data: { session: existingSession } } = await Ipon.client.auth.getSession();
      if (existingSession) {
        await Ipon.client.auth.signOut();
      }
      const exchange = await Ipon.invokeAccountFunction({ action: 'clerk-session-exchange', clerk_token: token, device_token: Ipon.getDeviceToken() });
      if (exchange.requires_device_otp) {
        clerkExchangeInFlight = false;
        setClerkSignInLoading(false);
        openDeviceOtpChallenge(exchange, { auth_method: 'clerk', clerk_token: token, clerk });
        return;
      }
      const { data, error } = await Ipon.client.auth.verifyOtp({ token_hash: exchange.token_hash, type: 'email' });
      if (error || !data?.user) throw error || new Error('The myIPON session could not be created.');
      if (await Ipon.requiresMfaChallenge()) {
        window.location.replace('mfa.html');
        return;
      }
      const profile = await resolveActiveProfile(data.user, exchange.email);
      recordLoginActivity(data);
      completeLoginSession(data, profile);
    } catch (error) {
      clerkExchangeInFlight = false;
      clerkExchangeSessionId = '';
      setClerkSignInLoading(false);
      setClerkSignInMessage(Ipon.friendlyError(error), 'error');
      if (clerk?.signOut) await clerk.signOut().catch(() => null);
    }
  }

  async function exchangeClerkSession(clerk) {
    if (!clerk?.session) return;
    if (isAppHandoff) {
      await handoffClerkSessionToNativeApp(clerk);
      return;
    }
    if (mode !== 'login') return;
    const sessionId = String(clerk.session.id || '');
    if (!sessionId || clerkExchangeSessionId === sessionId) return;
    setClerkSignInMessage('');
    setClerkSignInLoading(true);
    try {
      const token = await clerk.session.getToken({ skipCache: true });
      if (!token) throw new Error('Your Clerk sign-in session is unavailable.');
      await exchangeClerkToken(token, { clerk, sessionKey: sessionId });
    } catch (error) {
      clerkExchangeInFlight = false;
      clerkExchangeSessionId = '';
      setClerkSignInLoading(false);
      setClerkSignInMessage(Ipon.friendlyError(error), 'error');
      await clerk.signOut().catch(() => null);
    }
  }

  async function consumeNativeOAuthCallback() {
    if (!isNativeAuthApp()) return false;
    let raw = '';
    try {
      raw = String(window.IponNativeAuth?.consumePendingCallback?.() || '').trim();
      if (!raw) {
        const result = await window.Capacitor?.Plugins?.BackgroundNotifications?.consumeAuthCallback?.();
        raw = String(result?.payload || '').trim();
      }
    } catch {
      return false;
    }
    if (!raw) return false;
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      return false;
    }
    clearSocialOAuthBusy();
    const errText = String(payload?.error || '').trim();
    const clerkToken = String(payload?.clerk_token || '').trim();
    const returnedState = String(payload?.app_state || '').trim();
    if (errText) {
      verifyAndConsumeNativeOAuthState(returnedState);
      setClerkSignInLoading(false);
      setClerkSignInMessage(errText, 'error');
      return true;
    }
    if (!clerkToken) return false;
    if (!verifyAndConsumeNativeOAuthState(returnedState)) {
      setClerkSignInLoading(false);
      setClerkSignInMessage('Your Google sign-in session expired or did not match this request. Please tap Continue with Google again.', 'error');
      return true;
    }
    void exchangeClerkToken(clerkToken, { sessionKey: `native:${returnedState}` });
    return true;
  }

  window.addEventListener('myipon:native-oauth-callback', () => {
    void consumeNativeOAuthCallback();
  });

  if (isClerkSsoCallback || isAppHandoff) setClerkSignInLoading(true);
  let handledNativeCallbackAtBoot = false;

  loadClerk().then(async (clerk) => {
    handledNativeCallbackAtBoot = await bootNativeCallbackPromise;
    let shouldSignOut = false;
    try {
      shouldSignOut = localStorage.getItem('myipon_clerk_signout') === '1';
      if (shouldSignOut) localStorage.removeItem('myipon_clerk_signout');
    } catch { }
    const blockedStatus = ['disabled', 'pending', 'password-reset'].includes(new URLSearchParams(window.location.search).get('status') || '');
    if ((shouldSignOut || blockedStatus) && !isClerkSsoCallback && !isAppHandoff && clerk?.session) {
      await clerk.signOut().catch(() => null);
    }
    if (!clerk) {
      if (isAppHandoff) {
        handoffErrorToNativeApp('Social sign-in is temporarily unavailable. Please try again in the myIPON app.');
      } else if (isClerkSsoCallback) {
        setClerkSignInLoading(false);
        setClerkSignInMessage('Social sign-in is temporarily unavailable. Please try again or sign in with email.', 'error');
      }
      return;
    }
    if (isExternalGoogleStart) {
      if (initialUrlParams.get('mode') === 'signup') setMode('signup');
      await startClerkOAuth('oauth_google', document.getElementById('signup-google-btn'));
      return;
    }
    if (isClerkSsoCallback) {
      setMode('login');
      setClerkSignInLoading(true);
      const returnUrl = getClerkLoginReturnUrl();
      try {
        await clerk.handleRedirectCallback({
          signInUrl: returnUrl,
          signUpUrl: returnUrl,
          signInForceRedirectUrl: returnUrl,
          signUpForceRedirectUrl: returnUrl,
          signInFallbackRedirectUrl: returnUrl,
          signUpFallbackRedirectUrl: returnUrl,
          continueSignUpUrl: returnUrl,
          verifyEmailAddressUrl: returnUrl
        });
      } catch (error) {
        if (isAppHandoff) {
          handoffErrorToNativeApp(Ipon.friendlyError(error));
          return;
        }
        setClerkSignInLoading(false);
        setClerkSignInMessage(Ipon.friendlyError(error), 'error');
      } finally {
        clearClerkSsoCallbackFromUrl();
      }
    }
    if (clerkOAuthRedirecting) return;
    if (isAppHandoff && isClerkSsoCallback && !clerk.session
      && !(clerk.client?.signUp?.missingFields || []).length) {
      window.location.replace(getClerkLoginReturnUrl());
      return;
    }
    clerk.addListener(() => {
      if (!clerk.session) return;
      if (isAppHandoff) {
        void handoffClerkSessionToNativeApp(clerk);
        return;
      }
      if (!clerkExchangeInFlight && mode === 'login') exchangeClerkSession(clerk);
    });
    if (clerk.session && (isAppHandoff || isClerkSsoCallback || (!shouldSignOut && !blockedStatus && !handledNativeCallbackAtBoot))) {
      await exchangeClerkSession(clerk);
    } else {
      const missing = clerk.client?.signUp?.missingFields || [];
      if (isAppHandoff) {
        const errMsg = missing.includes('email_address')
          ? 'Your Google account did not share a verified email address. Allow email access or create an account with email.'
          : 'Google sign-in was cancelled or could not be completed. Please try again in myIPON.';
        handoffErrorToNativeApp(errMsg);
        return;
      }
      if (isClerkSsoCallback && !socialSignupMessage?.textContent) {
        if (missing.includes('email_address')) {
          setClerkSignInMessage('Your Google account did not share a verified email address. Allow email access or create an account with email.', 'error');
        }
      }
      if (!handledNativeCallbackAtBoot && !clerkExchangeInFlight) setClerkSignInLoading(false);
    }
  });

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
    return normalizeLoginIdentifier(rawEmail);
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
        submit.textContent = signupStep === 'email' ? 'Create account' : 'Continue';
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
    if (!normEmail || !isValidLoginIdentifier(normEmail)) return;
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
  const splashMinUntil = splashStartedAt + (isAppLaunch ? 300 : 0);

  const dismissSplash = () => {
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('is-hidden');
    setTimeout(() => { try { splash.remove(); } catch (_) { } }, 240);
  };
  const splashSafetyTimer = setTimeout(dismissSplash, 5000);

  function recordLoginActivity(sessionData) {
    const token = sessionData?.session?.access_token || '';
    if (typeof Ipon.fireKeepaliveRpc === 'function' && Ipon.fireKeepaliveRpc('record_account_activity', { p_event: 'LOGIN' }, token)) {
      return;
    }
    Ipon.rpc('record_account_activity', { p_event: 'LOGIN' }).catch(() => null);
  }

  // Start init immediately without delaying synchronous form/tab listener attachment
  const initPromise = Ipon.init({ requireAuth: false, allowPending: true }).catch((error) => ({ failed: true, configured: false, error }));
  const bootNativeCallbackPromise = consumeNativeOAuthCallback();

  async function resolveActiveProfile(user, fallbackEmail) {
    const profileCols = 'id,first_name,middle_name,last_name,contact_number,role,status,name_setup_required';
    const loadProfile = () => Ipon.client.from('profiles').select(profileCols).eq('id', user.id).maybeSingle();
    let { data: profile, error: profileError } = await loadProfile();
    if (profileError) throw profileError;

    if (profile?.status === 'DISABLED') {
      await Ipon.client.auth.signOut().catch(() => null);
      throw new Error('Your account is deactivated or disabled.');
    }

    if (profile?.role !== 'SUPER_ADMIN') {
      // Activate both pending account access and linked member records on sign-in.
      await Ipon.rpc('activate_own_pending_account').catch(() => null);
      ({ data: profile, error: profileError } = await loadProfile());
      if (profileError) throw profileError;
    }

    if (!profile || profile.status !== 'ACTIVE') {
      await Ipon.invokeAccountFunction({
        action: 'ensure-account-active',
        user_id: user.id,
        email: fallbackEmail || user.email || ''
      }).catch(() => null);
      ({ data: profile, error: profileError } = await loadProfile());
      if (profileError) throw profileError;
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

  function openDeviceOtpChallenge(outcome, context) {
    pendingDeviceOtp = { ...context, challenge_id: outcome.challenge_id };
    deviceOtpForm.reset();
    deviceOtpMessage.textContent = '';
    deviceOtpCopy.textContent = `Enter the 6-digit code sent to ${outcome.email_hint || 'your email address'}.`;
    if (!deviceOtpDialog.open) deviceOtpDialog.showModal();
    requestAnimationFrame(() => deviceOtpCode.focus());
  }

  async function requestPendingDeviceOtp() {
    if (!pendingDeviceOtp) throw new Error('Start signing in again to request a new code.');
    const base = { device_token: Ipon.getDeviceToken() };
    const outcome = pendingDeviceOtp.auth_method === 'clerk'
      ? await Ipon.invokeAccountFunction({ action: 'clerk-session-exchange', clerk_token: pendingDeviceOtp.clerk_token, ...base })
      : await Ipon.invokeAccountFunction({ action: 'login-attempt', email: pendingDeviceOtp.email, password: pendingDeviceOtp.password, ...base });
    if (!outcome?.requires_device_otp) throw new Error('New-device verification is no longer required. Sign in again.');
    pendingDeviceOtp.challenge_id = outcome.challenge_id;
    deviceOtpCopy.textContent = `Enter the 6-digit code sent to ${outcome.email_hint || 'your email address'}.`;
  }

  async function finishDeviceOtpSignIn(outcome) {
    let data;
    const accountEmail = outcome.resolved_email || outcome.email || pendingDeviceOtp.email;
    if (pendingDeviceOtp.auth_method === 'clerk') {
      const result = await Ipon.client.auth.verifyOtp({ token_hash: outcome.token_hash, type: 'email' });
      if (result.error || !result.data?.user) throw result.error || new Error('The myIPON session could not be created.');
      data = result.data;
    } else {
      const result = await Ipon.client.auth.setSession({
        access_token: outcome.session?.access_token,
        refresh_token: outcome.session?.refresh_token
      });
      if (result.error || !result.data?.user) throw result.error || new Error('The myIPON session could not be created.');
      data = result.data;
    }
    if (await Ipon.requiresMfaChallenge()) {
      deviceOtpDialog.close();
      pendingDeviceOtp = null;
      window.location.replace('mfa.html');
      return;
    }
    const profile = await resolveActiveProfile(data.user, accountEmail);
    recordLoginActivity(data);
    deviceOtpDialog.close();
    pendingDeviceOtp = null;
    completeLoginSession(data, profile);
  }

  deviceOtpCode.addEventListener('input', () => {
    deviceOtpCode.value = deviceOtpCode.value.replace(/\D/g, '').slice(0, 6);
    deviceOtpCode.setCustomValidity('');
    deviceOtpMessage.textContent = '';
  });
  deviceOtpForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = deviceOtpCode.value.trim();
    if (!/^\d{6}$/.test(code)) {
      deviceOtpCode.setCustomValidity('Enter the 6-digit code sent to your email.');
      deviceOtpMessage.textContent = deviceOtpCode.validationMessage;
      return deviceOtpCode.focus();
    }
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Verifying…');
    deviceOtpMessage.textContent = '';
    try {
      const outcome = await Ipon.invokeAccountFunction({
        action: 'verify-device-otp',
        challenge_id: pendingDeviceOtp?.challenge_id,
        code,
        device_token: Ipon.getDeviceToken(),
        auth_method: pendingDeviceOtp?.auth_method,
        email: pendingDeviceOtp?.email,
        password: pendingDeviceOtp?.password,
        clerk_token: pendingDeviceOtp?.clerk_token
      });
      await finishDeviceOtpSignIn(outcome);
    } catch (error) {
      deviceOtpMessage.textContent = Ipon.friendlyError(error);
      deviceOtpCode.select();
    } finally { Ipon.setBusy(button, false); }
  });
  deviceOtpResend.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    Ipon.setBusy(button, true, 'Sending…');
    deviceOtpMessage.textContent = '';
    try {
      await requestPendingDeviceOtp();
      deviceOtpMessage.textContent = 'Check your email for the latest code.';
      deviceOtpCode.focus();
    } catch (error) { deviceOtpMessage.textContent = Ipon.friendlyError(error); }
    finally { Ipon.setBusy(button, false); }
  });
  const cancelDeviceOtp = async () => {
    const method = pendingDeviceOtp?.auth_method;
    const clerk = pendingDeviceOtp?.clerk;
    pendingDeviceOtp = null;
    deviceOtpDialog.close();
    if (clerk || method === 'clerk') {
      clerkExchangeInFlight = false;
      clerkExchangeSessionId = '';
      setClerkSignInLoading(false);
      await clerk?.signOut?.().catch(() => null);
    }
  };
  deviceOtpCancel.addEventListener('click', cancelDeviceOtp);
  deviceOtpDialog.addEventListener('cancel', (event) => { event.preventDefault(); cancelDeviceOtp(); });

  async function ensureInitReady() {
    const state = await initPromise;
    if (state?.failed) throw state.error || new Error('Connection failed. Please reload and try again.');
    if (!state?.configured || !Ipon.client) throw new Error('Account service is not configured yet.');
    return state;
  }

  function isTransientLoginNetworkError(error) {
    return /failed to fetch|fetch failed|load failed|networkerror|network request failed|failed to send a request to the edge function|functionsfetcherror|econnreset|err_network_changed/i.test(`${error?.name || ''} ${error?.message || ''}`);
  }

  async function retryTransientLoginRequest(request) {
    try { return await request(); }
    catch (error) {
      if (!isTransientLoginNetworkError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return request();
    }
  }

  const normJoinCode = (raw) => (typeof Ipon.normalizeInviteCode === 'function'
    ? Ipon.normalizeInviteCode(raw)
    : String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  const extractJoinCode = (raw) => (typeof Ipon.extractInviteCode === 'function'
    ? Ipon.extractInviteCode(raw)
    : normJoinCode(String(raw || '').replace(/.*join=([A-Za-z0-9-]+).*/i, '$1')));
  const fmtJoinCode = (raw) => (typeof Ipon.formatInviteCode === 'function'
    ? Ipon.formatInviteCode(raw)
    : (() => { const c = normJoinCode(raw); return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c; })());
  const setStoredJoinCode = (code) => Ipon.setPendingJoinCode?.(code) || '';
  const getStoredJoinCode = () => Ipon.getPendingJoinCode?.() || '';
  const clearStoredJoinCode = () => Ipon.clearPendingJoinCode?.();

  const rawSearchParams = new URLSearchParams(location.search);
  const urlJoinCode = extractJoinCode(rawSearchParams.get('join') || '');
  if (urlJoinCode.length === 6) setStoredJoinCode(urlJoinCode);
  let activeJoinPreview = null;

  const authJoinBanner = document.getElementById('auth-join-banner');

  function syncJoinCopy() {
    const authCopyEl = document.getElementById('auth-copy');
    if (!authCopyEl) return;
    const signup = mode === 'signup';
    authCopyEl.textContent = activeJoinPreview?.valid
      ? (signup ? `Create an account to join "${activeJoinPreview.group_name}".` : `Sign in to join "${activeJoinPreview.group_name}".`)
      : (signup ? 'Sign up with myIPON to track and manage your group savings.' : 'Sign in to myIPON to track and manage your group savings.');
  }

  function renderAuthJoinBanner(preview, code) {
    if (!authJoinBanner) return;
    if (!code) {
      activeJoinPreview = null;
      authJoinBanner.hidden = true;
      authJoinBanner.innerHTML = '';
      syncJoinCopy();
      return;
    }
    if (!preview?.valid) {
      activeJoinPreview = null;
      clearStoredJoinCode();
      authJoinBanner.hidden = false;
      authJoinBanner.dataset.state = 'invalid';
      authJoinBanner.innerHTML = `
        <div class="auth-join-banner-body">
          <strong>Invite code unavailable</strong>
          <small>${Ipon.escapeHtml(preview?.message || 'This invite link or code has expired or is no longer active.')}</small>
        </div>
        <button class="auth-join-clear-btn" type="button" data-auth-join-clear>Dismiss</button>`;
      authJoinBanner.querySelector('[data-auth-join-clear]')?.addEventListener('click', () => renderAuthJoinBanner(null, ''));
      syncJoinCopy();
      return;
    }

    activeJoinPreview = preview;
    setStoredJoinCode(code);
    const countLabel = `${Number(preview.member_count || 0)} ${Number(preview.member_count || 0) === 1 ? 'member' : 'members'}`;
    const approvalText = preview.require_approval ? 'Admin approval required' : 'Instant join';
    const avatarHtml = typeof Ipon.avatarMarkup === 'function'
      ? Ipon.avatarMarkup(preview.group_avatar_url, preview.group_name, 'avatar-md')
      : '';
    authJoinBanner.hidden = false;
    authJoinBanner.dataset.state = 'valid';
    authJoinBanner.innerHTML = `
      <div class="auth-join-banner-head">
        ${avatarHtml}
        <div class="auth-join-banner-body">
          <span class="auth-join-eyebrow">Group invite · Code ${Ipon.escapeHtml(fmtJoinCode(code))}</span>
          <strong>${Ipon.escapeHtml(preview.group_name)}</strong>
          <small>${Ipon.escapeHtml(countLabel)} · ${Ipon.escapeHtml(approvalText)}</small>
        </div>
        <button class="auth-join-clear-btn" type="button" data-auth-join-clear aria-label="Remove group invite">Clear</button>
      </div>`;
    Ipon.bindAvatarFallbacks?.(authJoinBanner);
    authJoinBanner.querySelector('[data-auth-join-clear]')?.addEventListener('click', () => renderAuthJoinBanner(null, ''));
    syncJoinCopy();
  }

  async function loadLoginJoinPreview(rawCode) {
    const code = extractJoinCode(rawCode);
    if (code.length !== 6) return;
    try {
      await ensureInitReady();
      const preview = await Ipon.rpc('preview_group_invite_code', { p_code: code });
      renderAuthJoinBanner(preview, code);
    } catch (err) {
      renderAuthJoinBanner({ valid: false, message: Ipon.friendlyError(err) }, code);
    }
  }

  void (async () => {
    const state = await initPromise;
    if (!clerkExchangeInFlight) Ipon.setLoading(false);
    if (state.failed) {
      clearTimeout(splashSafetyTimer);
      dismissSplash();
      return;
    }
    if (state.session && state.profile?.status === 'ACTIVE' && !isAppHandoff && !isClerkSsoCallback) {
      if ((requestedPolicy === 'terms' || requestedPolicy === 'privacy') && policyDialog?.open) {
        clearTimeout(splashSafetyTimer);
        dismissSplash();
        policyDialog.addEventListener('close', () => {
          Ipon.setLoading(true, 'Opening your records…');
          window.location.replace(Ipon.accountSetupUrl(state.profile, state.session.user) || Ipon.homeForRole(state.profile.role));
        }, { once: true });
        return;
      }
      clearTimeout(splashSafetyTimer);
      const waitMs = isAppLaunch ? Math.max(0, splashMinUntil - Date.now()) : 0;
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      if (!document.getElementById('app-splash')) Ipon.setLoading(true, 'Opening your records…');
      window.location.replace(Ipon.accountSetupUrl(state.profile, state.session.user) || Ipon.homeForRole(state.profile.role));
      return;
    }
    clearTimeout(splashSafetyTimer);
    const splashWaitMs = isAppLaunch ? Math.max(0, splashMinUntil - Date.now()) : 0;
    if (splashWaitMs > 0) setTimeout(dismissSplash, splashWaitMs);
    else dismissSplash();
    if (!state.configured) {
      message.textContent = 'Add your Supabase URL and anon key in js/config.js before signing in.';
      submit.disabled = true;
      forgotButton.disabled = true;
      return;
    }
    renderSecurityNotice();
    if (email?.value) syncServerThrottleStatus(email.value);
    const initialJoin = getStoredJoinCode();
    if (initialJoin) loadLoginJoinPreview(initialJoin).catch(() => { });

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
            ? 'Your invitation is verified. Sign in with your credentials to continue.'
            : res.already_verified
              ? 'Your email invitation is already verified. Sign in with your credentials to activate your official membership.'
              : 'Invitation verified! Sign in with your credentials to activate your official membership.';
          Ipon.toast('Invitation verified. Sign in to activate membership.', 'success');

          if (inviteSuccessDialog) {
            if (inviteSuccessEmail) inviteSuccessEmail.textContent = acceptInviteEmail;
            if (inviteSuccessMessage) {
              inviteSuccessMessage.textContent = res.group_name
                ? `Email verified! Sign in to your account using the provided credentials to activate your official membership in "${res.group_name}".`
                : 'Email verified! Sign in to your account using the provided credentials to activate your official membership.';
            }
            if (inviteSuccessGroupHint) {
              inviteSuccessGroupHint.textContent = res.group_name
                ? `Once you log in, you will appear as an official active member in "${res.group_name}".`
                : 'Once you log in, your savings group workspace and official membership will activate automatically.';
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

  function setSignupUsernameStatus(text = '3–24 lowercase letters, numbers, or underscores.', state = '') {
    if (!usernameStatus) return;
    usernameStatus.textContent = text;
    if (state) usernameStatus.dataset.state = state;
    else delete usernameStatus.dataset.state;
  }

  function setFieldError(input, errorMessage) {
    const error = fieldErrors.get(input);
    input.setCustomValidity(errorMessage);
    input.setAttribute('aria-invalid', 'true');
    if (error) {
      error.textContent = errorMessage;
      error.hidden = false;
    }
    if (input === usernameInput && usernameStatus) usernameStatus.hidden = true;
  }

  function clearFieldError(input) {
    const error = fieldErrors.get(input);
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    if (error) {
      error.textContent = '';
      error.hidden = true;
    }
    if (input === usernameInput && usernameStatus) usernameStatus.hidden = false;
  }

  function clearFieldErrors() {
    fieldErrors.forEach((_, input) => clearFieldError(input));
  }

  async function verifySignupUsernameAvailability(rawVal, seq) {
    const clean = normalizeSignupUsername(rawVal);
    if (!clean || !USERNAME_RE.test(clean)) return null;
    try {
      await ensureInitReady();
      const res = await Ipon.invokeAccountFunction({
        action: 'check-signup-username',
        username: clean,
        email: email.value.trim().toLowerCase()
      });
      if (seq !== signupUsernameCheckSeq) return null;
      if (normalizeSignupUsername(usernameInput?.value) !== clean) return null;
      if (res?.available === false) {
        takenSignupUsername = clean;
        availableSignupUsername = '';
        setFieldError(usernameInput, 'That username is already taken.');
        Ipon.playUiSound?.('error');
        return false;
      }
      if (res?.available === true) {
        takenSignupUsername = '';
        availableSignupUsername = clean;
        clearFieldError(usernameInput);
        setSignupUsernameStatus(`@${clean} is available.`, 'available');
        Ipon.playUiSound?.('available');
        return true;
      }
    } catch {
      if (seq === signupUsernameCheckSeq && normalizeSignupUsername(usernameInput?.value) === clean) {
        setSignupUsernameStatus('3–24 lowercase letters, numbers, or underscores.');
      }
    }
    return null;
  }

  function validateSignupUsernameInput({ checkAvailability = false, immediate = false } = {}) {
    if (!usernameInput || mode !== 'signup' || signupStep !== 'email') return true;
    const raw = String(usernameInput.value || '');
    const normalized = raw.replace(/^@+/, '').toLowerCase();
    if (normalized !== raw) usernameInput.value = normalized;
    const clean = normalized.trim();
    clearTimeout(signupUsernameCheckTimer);
    if (takenSignupUsername && takenSignupUsername !== clean) takenSignupUsername = '';
    if (availableSignupUsername && availableSignupUsername !== clean) availableSignupUsername = '';
    if (!clean) {
      if (immediate) setFieldError(usernameInput, 'Enter a username.');
      else {
        clearFieldError(usernameInput);
        setSignupUsernameStatus('3–24 lowercase letters, numbers, or underscores.');
      }
      return false;
    }
    if (!USERNAME_RE.test(clean)) {
      setFieldError(usernameInput, USERNAME_RULE);
      return false;
    }
    if (takenSignupUsername === clean) {
      setFieldError(usernameInput, 'That username is already taken.');
      return false;
    }
    clearFieldError(usernameInput);
    if (availableSignupUsername === clean) {
      setSignupUsernameStatus(`@${clean} is available.`, 'available');
      return true;
    }
    if (checkAvailability) {
      setSignupUsernameStatus('Checking availability…', 'checking');
      const seq = ++signupUsernameCheckSeq;
      if (immediate) {
        void verifySignupUsernameAvailability(clean, seq);
      } else {
        signupUsernameCheckTimer = setTimeout(() => {
          void verifySignupUsernameAvailability(clean, seq);
        }, 320);
      }
    } else {
      setSignupUsernameStatus('3–24 lowercase letters, numbers, or underscores.');
    }
    return true;
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

  const passwordStrength = Ipon.bindPasswordStrength(password, () => [firstName.value, middleName.value, lastName.value, email.value, usernameInput?.value || '']);
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
      if (usernameInput) {
        const cleanUsername = normalizeSignupUsername(usernameInput.value);
        usernameInput.value = cleanUsername;
        if (!cleanUsername) setFieldError(usernameInput, 'Enter a username.');
        else if (!USERNAME_RE.test(cleanUsername)) setFieldError(usernameInput, USERNAME_RULE);
        else if (takenSignupUsername === cleanUsername) setFieldError(usernameInput, 'That username is already taken.');
      }
      if (!requestReason.value.trim() || requestReason.value.trim().length < 10) {
        requestReason.value = 'Personal group savings account registration';
      }
      if (!email.value) setFieldError(email, 'Enter your email address.');
      else if (!EMAIL_RE.test(email.value)) setFieldError(email, 'Enter a valid email address.');
    } else {
      if (!email.value) setFieldError(email, 'Enter your email address or username.');
      else if (!isValidLoginIdentifier(email.value)) setFieldError(email, 'Enter a valid email address or username.');
    }
    if (!password.value) setFieldError(password, 'Enter your password.');
    else if (signup && Ipon.passwordIssue(password.value, [firstName.value, middleName.value, lastName.value, email.value, usernameInput?.value || ''])) {
      setFieldError(password, Ipon.passwordIssue(password.value, [firstName.value, middleName.value, lastName.value, email.value, usernameInput?.value || '']));
    }
    if (signup && !passwordConfirmation.value) setFieldError(passwordConfirmation, 'Confirm your password.');
    else if (signup && passwordConfirmation.value !== password.value) setFieldError(passwordConfirmation, 'Passwords do not match.');

    const inputs = signup
      ? [...nameInputs, contactNumber, ...(usernameInput ? [usernameInput] : []), requestReason, email, password, passwordConfirmation]
      : [email, password];
    const firstInvalid = inputs.find((input) => !input.checkValidity());
    if (firstInvalid) {
      if (signup && firstInvalid === email) setSignupStep('choice', { focusEmail: true });
      else firstInvalid.focus();
    }
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

  function setSignupStep(step, { focusFirst = false, focusEmail = false } = {}) {
    signupStep = step === 'email' ? 'email' : 'choice';
    const signup = mode === 'signup';
    const inEmailSignup = signup && signupStep === 'email';
    document.body.classList.toggle('is-email-signup', inEmailSignup);
    if (socialSignupBlock) socialSignupBlock.hidden = inEmailSignup;
    if (signupStepHead) signupStepHead.hidden = !inEmailSignup;
    if (emailField) emailField.hidden = inEmailSignup;
    if (passwordField) passwordField.hidden = signup && !inEmailSignup;
    password.required = !signup || inEmailSignup;
    firstNameField.hidden = !inEmailSignup;
    middleNameField.hidden = !inEmailSignup;
    lastNameField.hidden = !inEmailSignup;
    contactField.hidden = !inEmailSignup;
    if (usernameField) usernameField.hidden = !inEmailSignup;
    reasonField.hidden = true;
    firstName.required = inEmailSignup;
    lastName.required = inEmailSignup;
    contactNumber.required = inEmailSignup;
    if (usernameInput) usernameInput.required = inEmailSignup;
    passwordConfirmationField.hidden = !inEmailSignup;
    passwordConfirmation.required = inEmailSignup;
    passwordStrength.element.hidden = !inEmailSignup;
    if (forgotButton) forgotButton.hidden = signup;
    if (emailChipText) emailChipText.textContent = email.value.trim() || 'you@example.com';
    if (!inEmailSignup) {
      clearTimeout(signupUsernameCheckTimer);
      setSignupUsernameStatus('3–24 lowercase letters, numbers, or underscores.');
    }
    submit.textContent = !signup ? 'Sign in' : (inEmailSignup ? 'Create account' : 'Continue');
    setSocialSignupMessage('');
    if (inEmailSignup && focusFirst) {
      requestAnimationFrame(() => firstName?.focus());
    } else if (!inEmailSignup && focusEmail && signup) {
      requestAnimationFrame(() => email?.focus());
    }
    requestAnimationFrame(() => updateTabIndicator());
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
    if (!clerkExchangeInFlight && !isAppHandoff) {
      if (socialOAuthInFlight) clearSocialOAuthBusy();
      if (clerkSignInShell) clerkSignInShell.hidden = true;
      form.hidden = false;
    }
    authTitle.hidden = false;
    authCopy.hidden = false;
    requestReason.required = false;
    if (passwordRequirements) passwordRequirements.hidden = true;
    if (emailLabel) emailLabel.textContent = signup ? 'Email' : 'Email or username';
    email.type = signup ? 'email' : 'text';
    email.inputMode = signup ? 'email' : 'text';
    email.autocomplete = signup ? 'email' : 'username';
    email.placeholder = signup ? 'you@example.com' : 'you@example.com or username';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    if (signup) { password.minLength = 8; password.maxLength = 128; }
    else { password.removeAttribute('minlength'); password.removeAttribute('maxlength'); }
    authTitle.textContent = signup ? 'Create your account' : 'Welcome back';
    authCopy.textContent = activeJoinPreview?.valid
      ? (signup ? `Create an account to join "${activeJoinPreview.group_name}".` : `Sign in to join "${activeJoinPreview.group_name}".`)
      : (signup ? 'Sign up with myIPON to track and manage your group savings.' : 'Sign in to myIPON to track and manage your group savings.');
    syncSocialAuthLabels();
    setSignupStep('choice');
    clearFieldErrors();
    setPasswordVisibility(false);
    delete message.dataset.tone;
    message.textContent = '';
    renderSecurityNotice();
  }

  fieldErrors.forEach((_, input) => {
    if (input === usernameInput) return;
    input.addEventListener('input', () => clearFieldError(input));
  });
  usernameInput?.addEventListener('input', () => {
    Ipon.playUiSound?.('type');
    validateSignupUsernameInput({ checkAvailability: true, immediate: false });
  });
  usernameInput?.addEventListener('blur', () => {
    validateSignupUsernameInput({ checkAvailability: true, immediate: true });
  });
  const clearCredentialError = () => {
    if (mode !== 'login' || message.textContent !== 'Incorrect email, username, or password.') return;
    [email, password].forEach((input) => input.removeAttribute('aria-invalid'));
    message.textContent = '';
  };
  const validateEmailLive = (required = false) => {
    const value = email.value.trim();
    if (!value && !required) {
      clearFieldError(email);
      return;
    }
    const error = mode === 'signup'
      ? (!value ? 'Enter your email address.' : !EMAIL_RE.test(value) ? 'Enter a valid email address.' : '')
      : (!value ? 'Enter your email address or username.' : !isValidLoginIdentifier(value) ? 'Enter a valid email address or username.' : '');
    if (error) setFieldError(email, error);
    else clearFieldError(email);
  };
  email.addEventListener('input', () => {
    clearCredentialError();
    validateEmailLive();
    if (mode === 'login') renderSecurityNotice();
  });
  email.addEventListener('invalid', () => validateEmailLive(true));
  password.addEventListener('input', clearCredentialError);
  email.addEventListener('blur', () => {
    email.value = email.value.trim();
    validateEmailLive(true);
    if (mode === 'login') {
      renderSecurityNotice();
      syncServerThrottleStatus(email.value);
    }
  });
  passwordToggle?.addEventListener('click', () => setPasswordVisibility(password.type === 'password'));
  passwordConfirmationToggle?.addEventListener('click', () => setPasswordVisibility(passwordConfirmation.type === 'password'));
  loginTab?.addEventListener('click', () => {
    setMode('login');
  });
  signupTab?.addEventListener('click', () => {
    setMode('signup');
  });
  signupMethodBackBtn?.addEventListener('click', () => {
    clearFieldErrors();
    delete message.dataset.tone;
    message.textContent = '';
    setSignupStep('choice', { focusEmail: true });
  });
  if (isClerkSsoCallback || isAppHandoff) {
    setMode('login');
    setClerkSignInLoading(true);
  } else if (new URLSearchParams(location.search).get('mode') === 'signup') {
    setMode('signup');
  } else {
    updateTabIndicator(loginTab);
  }
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
    const candidate = email.value.trim();
    recoveryRequestForm.elements.email.value = EMAIL_RE.test(candidate) ? candidate : '';
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
    if (mode === 'signup' && signupStep === 'choice') {
      clearFieldError(email);
      const candidate = email.value.trim();
      email.value = candidate;
      if (!candidate) {
        setFieldError(email, 'Enter your email address.');
        email.focus();
        return;
      }
      if (!email.validity.valid || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
        setFieldError(email, 'Enter a valid email address.');
        email.focus();
        return;
      }
      Ipon.setBusy(submit, true, 'Checking…');
      try {
        await ensureInitReady();
        const eligibility = await Ipon.rpc('check_admin_request_eligibility', { p_email: candidate.toLowerCase() });
        if (eligibility && !eligibility.eligible) {
          const fallbackMsg = eligibility.message || 'This email cannot register.';
          setFieldError(email, eligibility.reason === 'rejected' ? 'This email was declined and cannot register again.' : fallbackMsg);
          email.focus();
          return;
        }
      } catch (_) { }
      finally {
        Ipon.setBusy(submit, false);
      }
      setSignupStep('email', { focusFirst: true });
      return;
    }
    if (!validateForm()) return;

    Ipon.setBusy(submit, true, mode === 'signup' ? 'Creating account…' : 'Signing in...');
    let credentialsAccepted = false;
    try {
      await ensureInitReady();
      if (mode === 'signup') {
        const first = Ipon.normalizeNamePart(firstName.value);
        const middle = middleName.value.trim() ? Ipon.normalizeNamePart(middleName.value) : null;
        const last = Ipon.normalizeNamePart(lastName.value);
        const full = [first, middle, last].filter(Boolean).join(' ');
        const submittedEmail = email.value.trim().toLowerCase();
        const submittedUsername = normalizeSignupUsername(usernameInput?.value);
        if (usernameInput && availableSignupUsername !== submittedUsername) {
          const checkRes = await Ipon.invokeAccountFunction({
            action: 'check-signup-username',
            username: submittedUsername,
            email: submittedEmail
          }).catch(() => null);
          if (checkRes?.available === false) {
            takenSignupUsername = submittedUsername;
            availableSignupUsername = '';
            setFieldError(usernameInput, 'That username is already taken.');
            usernameInput.focus();
            return;
          }
          if (checkRes?.available === true) {
            takenSignupUsername = '';
            availableSignupUsername = submittedUsername;
            setSignupUsernameStatus(`@${submittedUsername} is available.`, 'available');
          }
        }
        const eligibility = await Ipon.rpc('check_admin_request_eligibility', { p_email: submittedEmail });
        if (eligibility && !eligibility.eligible) {
          const fallbackMsg = eligibility.message || 'This email cannot register.';
          setSignupStep('choice', { focusEmail: true });
          setFieldError(email, eligibility.reason === 'rejected' ? 'This email was declined and cannot register again.' : fallbackMsg);
          return;
        }
        pendingSignupPayload = {
          email: submittedEmail,
          username: submittedUsername,
          password: password.value,
          first,
          middle,
          last,
          full,
          contact: contactNumber.value.trim(),
          reason: requestReason.value.trim()
        };

        if (summaryFullName) summaryFullName.textContent = full;
        if (summaryUsername) summaryUsername.textContent = submittedUsername ? `@${submittedUsername}` : '—';
        if (summaryContactNumber) summaryContactNumber.textContent = contactNumber.value.trim();
        if (summaryEmail) summaryEmail.textContent = submittedEmail;
        if (summaryRequestReason) summaryRequestReason.textContent = requestReason.value.trim();

        requestConfirmDialog?.showModal();
        return;
      } else {
        const submittedIdentifier = normalizeLoginIdentifier(email.value);
        email.value = submittedIdentifier;
        const activeLock = getActiveThrottleState(submittedIdentifier).entry;
        if (activeLock && activeLock.lockedUntilMs > Date.now()) {
          renderSecurityNotice();
          message.dataset.tone = 'error';
          message.textContent = 'Too many incorrect sign-in attempts. Please wait for the countdown to finish.';
          return;
        }
        let edgeRes = null;
        try {
          edgeRes = await Ipon.invokeAccountFunction({
            action: 'login-attempt',
            email: submittedIdentifier,
            password: password.value,
            device_token: Ipon.getDeviceToken()
          });
        } catch (edgeError) {
          throw edgeError;
        }

        let data;
        if (edgeRes?.requires_device_otp) {
          openDeviceOtpChallenge(edgeRes, {
            auth_method: 'password',
            email: submittedIdentifier,
            password: password.value
          });
          return;
        }
        if (edgeRes && typeof edgeRes === 'object' && ('ok' in edgeRes || 'locked' in edgeRes || 'error' in edgeRes)) {
          if (edgeRes.ok && edgeRes.session?.access_token && edgeRes.session?.refresh_token) {
            credentialsAccepted = true;
            const sessionData = await retryTransientLoginRequest(async () => {
              const { data, error } = await Ipon.client.auth.setSession({
                access_token: edgeRes.session.access_token,
                refresh_token: edgeRes.session.refresh_token
              });
              if (error) throw error;
              return data;
            });
            clearLocalThrottle(submittedIdentifier);
            renderSecurityNotice();
            data = sessionData?.user ? sessionData : { user: edgeRes.user, session: edgeRes.session };
          } else if (edgeRes.error?.code === 'login_locked') {
            if (edgeRes.throttle) syncThrottleFromServer(submittedIdentifier, edgeRes.throttle);
            throw Object.assign(new Error(edgeRes.error.message || 'Too many incorrect sign-in attempts. Please wait before trying again.'), {
              code: 'login_locked',
              throttle: edgeRes.throttle || null
            });
          } else if (edgeRes.error?.code === 'email_not_confirmed') {
            throw Object.assign(new Error(edgeRes.error.message || 'Email not confirmed.'), { code: 'email_not_confirmed' });
          } else {
            if (edgeRes.throttle) syncThrottleFromServer(submittedIdentifier, edgeRes.throttle);
            throw Object.assign(new Error(edgeRes.error?.message || 'Incorrect email, username, or password.'), {
              code: edgeRes.error?.code || 'invalid_credentials',
              throttle: edgeRes.throttle || null
            });
          }
        } else throw new Error('Secure sign-in is temporarily unavailable. Please try again.');

        const resolvedEmail = String(edgeRes.resolved_email || data.user?.email || submittedIdentifier).trim().toLowerCase();
        if (await retryTransientLoginRequest(() => Ipon.requiresMfaChallenge())) {
          window.location.replace('mfa.html');
          return;
        }
        const profile = await retryTransientLoginRequest(() => resolveActiveProfile(data.user, resolvedEmail));
        recordLoginActivity(data);
        completeLoginSession(data, profile);
      }
    } catch (error) {
      message.dataset.tone = 'error';
      if (mode === 'login' && credentialsAccepted && isTransientLoginNetworkError(error)) {
        message.textContent = 'Your password was accepted, but the connection was interrupted while opening your account. Please try again.';
      } else if (mode === 'login' && error?.code === 'login_locked') {
        if (error?.throttle) syncThrottleFromServer(normalizeLoginIdentifier(email.value), error.throttle);
        renderSecurityNotice();
        message.textContent = 'Too many incorrect sign-in attempts. Please wait for the countdown to finish.';
      } else if (mode === 'login' && (error?.code === 'invalid_credentials' || /invalid login credentials/i.test(error?.message || ''))) {
        const failedIdentifier = normalizeLoginIdentifier(email.value);
        [email, password].forEach((input) => input.setAttribute('aria-invalid', 'true'));
        message.textContent = 'Incorrect email, username, or password.';
        if (error?.throttle) syncThrottleFromServer(failedIdentifier, error.throttle);
        else recordLocalFailedAttempt(failedIdentifier);
        renderSecurityNotice();
        const lockEntry = getActiveThrottleState(failedIdentifier).entry;
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
      username: payload.username,
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
      const edgeRes = await Ipon.invokeAccountFunction({
        action: 'login-attempt',
        email: submittedEmail,
        password: submittedPassword
      });
      if (!edgeRes?.ok || !edgeRes.session?.access_token || !edgeRes.session?.refresh_token) {
        throw new Error(edgeRes?.error?.message || 'Your account was created, but automatic sign in failed.');
      }
      const { data, error: loginError } = await Ipon.client.auth.setSession({
        access_token: edgeRes.session.access_token,
        refresh_token: edgeRes.session.refresh_token
      });
      if (loginError) throw loginError;
      const profile = await resolveActiveProfile(data.user, submittedEmail);
      recordLoginActivity(data);
      completeLoginSession(data, profile);
    } catch (err) {
      console.error('Auto login error:', err);
      Ipon.setLoading(false);
      form.reset();
      setMode('login');
      setClerkSignInMessage('Account created and verified. Sign in with Google, your email, or your username.', 'success');
      Ipon.toast('Account verified. Sign in to continue.');
      if (requestSuccessEmail) requestSuccessEmail.textContent = `Account created for ${submittedEmail}. Sign in to continue.`;
      requestSuccessDialog?.showModal();
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
