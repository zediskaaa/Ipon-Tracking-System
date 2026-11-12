(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['ADMIN'] });
  if (state.failed) return;
  const accessBody = document.getElementById('access-body');
  const effectiveMonth = document.getElementById('effective-month');
  const defaultAmount = document.getElementById('default-amount');
  const deadlineDay = document.getElementById('deadline-day');
  const treasurerForm = document.getElementById('treasurer-account-form');
  let members = [];
  Ipon.bindPasswordStrength(treasurerForm.elements.password, () => [treasurerForm.elements.first_name.value, treasurerForm.elements.middle_name.value, treasurerForm.elements.last_name.value, treasurerForm.elements.email.value]);

  effectiveMonth.value = Ipon.isoDate().slice(0, 7);
  if (!state.configured || !state.profile) {
    if (accessBody) accessBody.innerHTML = '<tr><td colspan="4" class="empty-state">Connect Supabase to manage access.</td></tr>';
    Ipon.setLoading(false);
    return;
  }

  document.getElementById('my-name').textContent = state.profile.full_name;
  document.getElementById('my-role').textContent = state.profile.role;
  document.getElementById('my-status').textContent = state.profile.status;
  if (state.profile.role !== 'ADMIN') { Ipon.setLoading(false); return; }

  async function loadContributionDefault() {
    const month = effectiveMonth.value;
    const { data, error } = await Ipon.client.from('contribution_settings').select('default_amount,deadline_day').eq('effective_month', `${month}-01`).maybeSingle();
    if (error) throw error;
    if (effectiveMonth.value === month) { defaultAmount.value = data?.default_amount ?? ''; deadlineDay.value = data?.deadline_day ?? 28; }
  }

  async function loadAccess() {
    const [profileResult, memberResult] = await Promise.all([
      Ipon.client.from('profiles').select('id,full_name,role,status,member_id,created_at').in('role', ['MEMBER', 'TREASURER']).order('created_at'),
      Ipon.client.from('members').select('id,full_name').eq('status', 'ACTIVE').order('full_name')
    ]);
    if (profileResult.error) throw profileResult.error;
    if (memberResult.error) throw memberResult.error;
    members = memberResult.data || [];
    const profiles = profileResult.data || [];

    accessBody.innerHTML = profiles.length ? profiles.map((profile) => `<tr>
      <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong></td>
      <td><select data-field="role" data-id="${profile.id}"><option value="MEMBER" ${profile.role === 'MEMBER' ? 'selected' : ''}>MEMBER</option><option value="TREASURER" ${profile.role === 'TREASURER' ? 'selected' : ''}>TREASURER</option></select></td>
      <td><select data-field="status" data-id="${profile.id}"><option value="PENDING" ${profile.status === 'PENDING' ? 'selected' : ''}>PENDING</option><option value="ACTIVE" ${profile.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option><option value="DISABLED" ${profile.status === 'DISABLED' ? 'selected' : ''}>DISABLED</option></select></td>
      <td><select data-field="member" data-id="${profile.id}"><option value="">Not linked</option>${members.map((member) => `<option value="${member.id}" ${profile.member_id === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}</select></td>
      <td><button class="icon-action" type="button" data-save-access="${profile.id}">Save</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No member or treasurer login accounts in this group.</td></tr>';
  }

  accessBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-save-access]');
    if (!button) return;
    const id = button.dataset.saveAccess;
    const role = accessBody.querySelector(`[data-field="role"][data-id="${id}"]`).value;
    const status = accessBody.querySelector(`[data-field="status"][data-id="${id}"]`).value;
    const memberSelect = accessBody.querySelector(`[data-field="member"][data-id="${id}"]`);
    const memberId = role === 'MEMBER' ? memberSelect.value || null : null;
    if (role === 'MEMBER' && status === 'ACTIVE' && !memberId) {
      Ipon.setFieldError(memberSelect, 'Link an active login to a member before activation.');
      memberSelect.focus();
      Ipon.toast('Link an active login to a member before activation.', 'error');
      return;
    }
    const accepted = await Ipon.confirmAction({ title: 'Update member access?', message: `This member login will be ${status.toLowerCase()}.`, acceptLabel: 'Update access' });
    if (!accepted) return;
    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('admin_set_user_access', { p_user_id: id, p_role: role, p_status: status, p_member_id: memberId });
      Ipon.toast('Account access updated.');
      await loadAccess();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  treasurerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(treasurerForm);
    const password = String(values.get('password'));
    const personal = [values.get('first_name'), values.get('middle_name'), values.get('last_name'), values.get('email')];
    const issue = Ipon.passwordIssue(password, personal);
    if (issue) { Ipon.setFieldError(treasurerForm.elements.password, issue); treasurerForm.elements.password.focus(); return; }
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Creating…');
    try {
      const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'TREASURER', first_name: values.get('first_name'), middle_name: values.get('middle_name') || null, last_name: values.get('last_name'), email: values.get('email'), password } });
      if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      treasurerForm.reset();
      Ipon.toast('Treasurer account created.');
      await loadAccess();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  document.getElementById('contribution-setting-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    const values = new FormData(event.target);
    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('set_contribution_setting', { p_effective_month: `${values.get('effective_month')}-01`, p_default_amount: Number(values.get('default_amount')), p_deadline_day: Number(values.get('deadline_day')) });
      Ipon.toast('Contribution schedule saved.');
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  document.getElementById('generate-periods').addEventListener('click', async (event) => {
    const month = effectiveMonth.value;
    const accepted = await Ipon.confirmAction({ title: 'Generate contribution periods?', message: `Create missing periods for ${month}. Existing periods will not change.`, acceptLabel: 'Generate' });
    if (!accepted) return;
    Ipon.setBusy(event.currentTarget, true, 'Generating…');
    try {
      const count = await Ipon.rpc('generate_contribution_periods', { p_month: `${month}-01` });
      Ipon.toast(`${count} contribution period${count === 1 ? '' : 's'} created.`);
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(event.currentTarget, false);
    }
  });

  effectiveMonth.addEventListener('change', async () => {
    try { await loadContributionDefault(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
  });

  try {
    await Promise.all([loadContributionDefault(), loadAccess()]);
  } catch (error) {
    Ipon.showInlineError(accessBody, error, () => Promise.all([loadContributionDefault(), loadAccess()]), 4);
  } finally {
    Ipon.setLoading(false);
  }
  Ipon.subscribeToChanges('settings', ['profiles', 'members', 'contribution_settings'], async () => {
    const tasks = [];
    if (document.activeElement !== defaultAmount && document.activeElement !== deadlineDay && document.activeElement !== effectiveMonth) tasks.push(loadContributionDefault());
    if (!document.activeElement?.closest('#access-body')) tasks.push(loadAccess());
    await Promise.all(tasks);
  });
})();
