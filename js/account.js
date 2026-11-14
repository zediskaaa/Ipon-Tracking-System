(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || !state.configured || !state.profile) return;
  const profileForm = document.getElementById('profile-form');
  const emailForm = document.getElementById('email-form');
  const passwordForm = document.getElementById('password-form');
  passwordForm.closest('.panel').insertAdjacentHTML('beforeend', Ipon.mfaSettingsMarkup());
  const mfaController = Ipon.bindMfaSettings(passwordForm.closest('.panel').querySelector('[data-mfa-settings]'));
  const activityBody = document.getElementById('account-activity-body');
  const notificationToggle = document.getElementById('notifications-enabled');
  const pageDialog = document.getElementById('account-page-dialog');
  const closeButton = document.getElementById('account-page-close');
  Ipon.bindPasswordStrength(passwordForm.elements.password, () => [profileForm.elements.first_name.value, profileForm.elements.middle_name.value, profileForm.elements.last_name.value, emailForm.elements.email.value]);
  const params = new URLSearchParams(location.search);
  let onboarding = params.get('force_password') === '1' || params.get('complete_profile') === '1';
  let passwordChangeRequired = params.get('force_password') === '1' || state.session.user.app_metadata?.must_change_password;
  let profileComplete = false;
  document.getElementById('temporary-password-notice').hidden = !passwordChangeRequired;

  function updateDialogMode() {
    document.body.classList.toggle('account-onboarding', onboarding);
    closeButton.hidden = onboarding;
    document.getElementById('account-page-title').textContent = onboarding ? 'Complete your account' : 'My account';
    document.getElementById('account-page-copy').textContent = onboarding ? 'Add the required profile details and secure your sign-in before continuing.' : 'Manage your profile, sign-in security, and preferences.';
  }

  function closeAccount() {
    if (!onboarding) location.replace(Ipon.homeForRole(state.profile.role));
  }

  closeButton.addEventListener('click', closeAccount);
  pageDialog.addEventListener('cancel', (event) => { event.preventDefault(); closeAccount(); });
  updateDialogMode();

  function finishSetupIfReady() {
    if (onboarding && profileComplete && !passwordChangeRequired) location.replace(Ipon.homeForRole(state.profile.role));
  }

  async function load() {
    const [profileResult, activityResult] = await Promise.all([
      Ipon.client.from('profiles').select('role,first_name,middle_name,last_name,full_name,email,contact_number,notifications_enabled,member_id,payout_channel,payout_account_number,payout_account_name,name_setup_required').eq('id', state.profile.id).single(),
      Ipon.client.from('account_activity').select('id,event,created_at').order('created_at', { ascending: false }).limit(20)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (activityResult.error) throw activityResult.error;
    const profile = profileResult.data;
    const isSuperAdmin = (profile.role || state.profile?.role) === 'SUPER_ADMIN';
    Ipon.syncProfileNameMode?.(profileForm, isSuperAdmin);
    let payoutSource = profile;
    if (!profile.payout_channel && (profile.member_id || state.profile.member_id)) {
      const { data: memberRow } = await Ipon.client.from('members').select('payout_channel,payout_account_number,payout_account_name').eq('id', profile.member_id || state.profile.member_id).maybeSingle();
      if (memberRow?.payout_channel) payoutSource = memberRow;
    }
    const mustCompleteName = Boolean(profile.name_setup_required);
    profileForm.elements.first_name.value = mustCompleteName ? '' : (profile.first_name || '');
    profileForm.elements.middle_name.value = mustCompleteName ? '' : (profile.middle_name || '');
    profileForm.elements.last_name.value = mustCompleteName ? '' : (profile.last_name || '');
    profileForm.elements.contact_number.value = profile.contact_number || '';
    Ipon.setPayoutFields(profileForm, payoutSource);
    const hasInvalidExistingName = !mustCompleteName && (
      (profile.first_name && !Ipon.validNamePart(profile.first_name, { formal: !isSuperAdmin }))
      || (profile.middle_name && !Ipon.validNamePart(profile.middle_name, { allowSingleInitial: true, formal: !isSuperAdmin }))
      || (profile.last_name && !Ipon.validNamePart(profile.last_name, { formal: !isSuperAdmin }))
    );
    if (hasInvalidExistingName) {
      Ipon.validateNameInput(profileForm.elements.first_name);
      Ipon.validateNameInput(profileForm.elements.middle_name);
      Ipon.validateNameInput(profileForm.elements.last_name);
    }
    profileComplete = !Ipon.profileNeedsSetup({ role: state.profile?.role, ...profile });
    if (!profileComplete || passwordChangeRequired) onboarding = true;
    else if (params.get('force_password') !== '1' && params.get('complete_profile') !== '1') onboarding = false;
    updateDialogMode();
    const setupNotice = document.getElementById('profile-setup-notice');
    setupNotice.hidden = profileComplete;
    const setupNoticeCopy = setupNotice.querySelector('span');
    if (setupNoticeCopy) {
      setupNoticeCopy.textContent = mustCompleteName
        ? (isSuperAdmin
          ? 'Enter your first name and mobile number before continuing to your panel.'
          : 'Enter your real formal first name, last name, and mobile number before continuing to your panel.')
        : hasInvalidExistingName
          ? (isSuperAdmin
            ? 'Please enter a valid name using letters before continuing to your panel.'
            : 'Please update your name using formal capitalization (no ALL CAPS or all lowercase) before continuing to your panel.')
          : (isSuperAdmin
            ? 'Add your first name and mobile number before continuing to your panel.'
            : 'Add your first name, last name, and mobile number before continuing to your panel.');
    }
    emailForm.elements.email.value = profile.email || state.session.user.email || '';
    notificationToggle.checked = profile.notifications_enabled !== false;
    const activities = activityResult.data || [];
    activityBody.innerHTML = activities.length ? activities.map((row) => `<tr><td>${Ipon.escapeHtml(row.event.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => character.toUpperCase()))}</td><td>${Ipon.dateLabel(row.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>`).join('') : '<tr><td colspan="2" class="empty-state">No account activity recorded yet.</td></tr>';
    if (onboarding) {
      const nextField = !profileComplete
        ? (!Ipon.validNamePart(profileForm.elements.first_name.value, { formal: !isSuperAdmin })
            ? profileForm.elements.first_name
            : (profileForm.elements.middle_name.value && !Ipon.validNamePart(profileForm.elements.middle_name.value, { allowSingleInitial: true, formal: !isSuperAdmin })
                ? profileForm.elements.middle_name
                : (((!isSuperAdmin && !profileForm.elements.last_name.value) || (profileForm.elements.last_name.value && !Ipon.validNamePart(profileForm.elements.last_name.value, { formal: !isSuperAdmin })))
                    ? profileForm.elements.last_name
                    : profileForm.elements.contact_number)))
        : (passwordChangeRequired ? (passwordForm.elements.current_password || passwordForm.elements.password) : null);
      nextField?.focus();
    }
  }

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!Ipon.validateNameFields(profileForm)) return;
    if (!Ipon.validatePhoneInput(profileForm.elements.contact_number)) return profileForm.elements.contact_number.focus();
    if (!Ipon.validatePayoutFields(profileForm)) return;
    const button = event.submitter;
    const values = new FormData(profileForm);
    const payoutPayload = Ipon.readPayoutPayload(profileForm);
    Ipon.setBusy(button, true);
    try {
      const wasOnboarding = onboarding;
      await Ipon.rpc('update_own_profile', { p_first_name: values.get('first_name'), p_middle_name: values.get('middle_name') || null, p_last_name: values.get('last_name') || null, p_contact_number: values.get('contact_number'), ...payoutPayload });
      const first = Ipon.normalizeNamePart(values.get('first_name'));
      const middle = Ipon.normalizeNamePart(values.get('middle_name')) || null;
      const last = Ipon.normalizeNamePart(values.get('last_name')) || null;
      const computedFull = [first, middle, last].filter(Boolean).join(' ');
      if (state.profile) {
        Object.assign(state.profile, { first_name: first, middle_name: middle, last_name: last, ...(computedFull ? { full_name: computedFull } : {}), name_setup_required: false });
        if (computedFull) document.querySelector('#sidebar-user strong')?.replaceChildren(computedFull);
        window.dispatchEvent(new CustomEvent('ipon:profile-updated', { detail: state.profile }));
      }
      Ipon.toast('Profile updated.');
      await load();
      if (wasOnboarding) onboarding = true;
      finishSetupIfReady();
    }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Updating…');
    try { const { error } = await Ipon.client.auth.updateUser({ email: emailForm.elements.email.value.trim() }); if (error) throw error; Ipon.toast('Check your email to confirm the change.'); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = passwordForm.elements.password.value;
    if (password !== passwordForm.elements.password_confirmation.value) { Ipon.setFieldError(passwordForm.elements.password_confirmation, 'Passwords do not match.'); passwordForm.elements.password_confirmation.focus(); return; }
    const issue = Ipon.passwordIssue(password, [profileForm.elements.first_name.value, profileForm.elements.middle_name.value, profileForm.elements.last_name.value, emailForm.elements.email.value]);
    if (issue) { Ipon.setFieldError(passwordForm.elements.password, issue); passwordForm.elements.password.focus(); return; }
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Changing…');
    try { await Ipon.changePassword(password, passwordForm.elements.current_password.value); await Ipon.rpc('record_account_activity', { p_event: 'PASSWORD_CHANGE' }); passwordForm.reset(); passwordChangeRequired = false; document.getElementById('temporary-password-notice').hidden = true; Ipon.toast('Password changed.'); finishSetupIfReady(); if (!onboarding) await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  notificationToggle.addEventListener('change', async () => {
    notificationToggle.disabled = true;
    try { await Ipon.setNotificationPreference(notificationToggle.checked); Ipon.toast('Notification preference saved.'); }
    catch (error) { notificationToggle.checked = !notificationToggle.checked; Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { notificationToggle.disabled = false; }
  });

  pageDialog.showModal();
  Ipon.bindDeviceNotificationControls();
  try { await Promise.all([load(), mfaController.load()]); } catch (error) { Ipon.showInlineError(activityBody, error, load, 2); } finally { Ipon.setLoading(false); }
})();
