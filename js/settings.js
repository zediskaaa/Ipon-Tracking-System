(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['ADMIN'] });
  if (state.failed) return;
  const accessBody = document.getElementById('access-body');
  const effectiveMonth = document.getElementById('effective-month');
  const defaultAmount = document.getElementById('default-amount');
  const deadlineDay = document.getElementById('deadline-day');
  const treasurerForm = document.getElementById('treasurer-account-form');
  const groupSelect = document.getElementById('settings-group-select');
  const adminContributorToggle = document.getElementById('settings-admin-contributor');
  let members = [];
  let currentGroupId = '';
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
    const [accessRows, memberResult, myGroups] = await Promise.all([
      Ipon.rpc('get_group_access_list'),
      Ipon.client.from('members').select('id,full_name').eq('status', 'ACTIVE').order('full_name'),
      Ipon.rpc('get_my_groups')
    ]);
    if (memberResult.error) throw memberResult.error;
    members = memberResult.data || [];
    const groups = Array.isArray(myGroups) ? myGroups : [];
    const activeGroup = groups.find((g) => g.is_current) || groups[0] || null;
    currentGroupId = activeGroup?.group_id || '';
    if (groupSelect) {
      groupSelect.replaceChildren(...groups.map((g) => new Option(`${g.name} (${g.role})`, g.group_id)));
      groupSelect.value = currentGroupId;
      groupSelect.disabled = groups.length <= 1;
    }
    if (adminContributorToggle) {
      adminContributorToggle.checked = Boolean(activeGroup?.is_contributor);
    }
    const profiles = (Array.isArray(accessRows) ? accessRows : []).filter((row) => ['MEMBER', 'TREASURER'].includes(row.role));

    accessBody.innerHTML = profiles.length ? profiles.map((profile) => `<tr>
      <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong><br><small class="field-help">${Ipon.escapeHtml(profile.email || '')}</small></td>
      <td><select data-field="role" data-id="${profile.user_id}"><option value="MEMBER" ${profile.role === 'MEMBER' ? 'selected' : ''}>MEMBER</option><option value="TREASURER" ${profile.role === 'TREASURER' ? 'selected' : ''}>TREASURER</option></select></td>
      <td><select data-field="status" data-id="${profile.user_id}"><option value="PENDING" ${profile.status === 'PENDING' ? 'selected' : ''}>PENDING</option><option value="ACTIVE" ${profile.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option><option value="DISABLED" ${profile.status === 'DISABLED' ? 'selected' : ''}>DISABLED</option></select></td>
      <td><select data-field="member" data-id="${profile.user_id}"><option value="">Not linked</option>${members.map((member) => `<option value="${member.id}" ${profile.member_id === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}</select></td>
      <td><button class="icon-action" type="button" data-save-access="${profile.user_id}">Save</button></td>
    </tr>`).join('') : '<tr><td colspan="5" class="empty-state">No member or treasurer login accounts in this group.</td></tr>';
  }

  groupSelect?.addEventListener('change', async () => {
    const nextGroupId = groupSelect.value;
    if (!nextGroupId || nextGroupId === currentGroupId) return;
    groupSelect.disabled = true;
    try {
      await Ipon.switchActiveGroup(nextGroupId);
      location.reload();
    } catch (error) {
      groupSelect.value = currentGroupId;
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      groupSelect.disabled = false;
    }
  });

  adminContributorToggle?.addEventListener('change', async () => {
    const enabled = adminContributorToggle.checked;
    adminContributorToggle.disabled = true;
    try {
      await Ipon.rpc('set_admin_contributor', { p_enabled: enabled });
      Ipon.toast(enabled ? 'You are now included as a contributor.' : 'You have been removed from active contributors.');
      await loadAccess();
    } catch (error) {
      adminContributorToggle.checked = !enabled;
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      adminContributorToggle.disabled = false;
    }
  });

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
      const email = String(values.get('email')).trim();
      const res = await Ipon.inviteAccount({ role: 'TREASURER', first_name: values.get('first_name'), middle_name: values.get('middle_name') || null, last_name: values.get('last_name'), email, password });
      treasurerForm.reset();
      Ipon.toast(res.email_sent ? 'Treasurer account created and invite email sent.' : 'Treasurer account created.');
      if (!res.email_sent) Ipon.showInviteSummary({ title: 'Treasurer credentials', results: [{ ok: true, email, ...res }] });
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
