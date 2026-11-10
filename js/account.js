(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['SUPER_ADMIN', 'ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || !state.configured || !state.profile) return;
  const profileForm = document.getElementById('profile-form');
  const emailForm = document.getElementById('email-form');
  const passwordForm = document.getElementById('password-form');
  const activityBody = document.getElementById('account-activity-body');
  const notificationToggle = document.getElementById('notifications-enabled');
  const forcePasswordChange = new URLSearchParams(location.search).get('force_password') === '1' || state.session.user.user_metadata?.must_change_password;
  document.getElementById('temporary-password-notice').hidden = !forcePasswordChange;

  async function load() {
    const [profileResult, activityResult] = await Promise.all([
      Ipon.client.from('profiles').select('first_name,middle_name,last_name,full_name,email,contact_number,notifications_enabled').eq('id', state.profile.id).single(),
      Ipon.client.from('account_activity').select('id,event,created_at').order('created_at', { ascending: false }).limit(20)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (activityResult.error) throw activityResult.error;
    const profile = profileResult.data;
    profileForm.elements.first_name.value = profile.first_name || profile.full_name?.split(' ')[0] || '';
    profileForm.elements.middle_name.value = profile.middle_name || '';
    profileForm.elements.last_name.value = profile.last_name || profile.full_name?.split(' ').slice(1).join(' ') || '';
    profileForm.elements.contact_number.value = profile.contact_number || '';
    emailForm.elements.email.value = profile.email || state.session.user.email || '';
    notificationToggle.checked = profile.notifications_enabled !== false;
    const activities = activityResult.data || [];
    activityBody.innerHTML = activities.length ? activities.map((row) => `<tr><td>${Ipon.escapeHtml(row.event.replaceAll('_', ' ').toLowerCase().replace(/^./, (character) => character.toUpperCase()))}</td><td>${Ipon.dateLabel(row.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>`).join('') : '<tr><td colspan="2" class="empty-state">No account activity recorded yet.</td></tr>';
  }

  profileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const values = new FormData(profileForm);
    Ipon.setBusy(button, true);
    try { await Ipon.rpc('update_own_profile', { p_first_name: values.get('first_name'), p_middle_name: values.get('middle_name') || null, p_last_name: values.get('last_name'), p_contact_number: values.get('contact_number') || null }); Ipon.toast('Profile updated.'); await load(); }
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
    if (password !== passwordForm.elements.password_confirmation.value) { Ipon.toast('Passwords do not match.', 'error'); return; }
    if (!(password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) { Ipon.toast('Use at least 8 characters with uppercase, lowercase, and a number.', 'error'); return; }
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Changing…');
    try { const { error } = await Ipon.client.auth.updateUser({ password, data: { must_change_password: false } }); if (error) throw error; await Ipon.rpc('record_account_activity', { p_event: 'PASSWORD_CHANGE' }); passwordForm.reset(); Ipon.toast('Password changed.'); if (forcePasswordChange) location.replace(Ipon.homeForRole(state.profile.role)); else await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  notificationToggle.addEventListener('change', async () => {
    notificationToggle.disabled = true;
    try { await Ipon.rpc('set_notification_preferences', { p_enabled: notificationToggle.checked }); Ipon.toast('Notification preference saved.'); }
    catch (error) { notificationToggle.checked = !notificationToggle.checked; Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { notificationToggle.disabled = false; }
  });

  try { await load(); } catch (error) { Ipon.showInlineError(activityBody, error, load, 2); }
})();
