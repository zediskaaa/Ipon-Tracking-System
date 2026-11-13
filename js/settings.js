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
  const settingsContributorDetails = document.getElementById('settings-contributor-details');
  const settingsPledgeVal = document.getElementById('settings-pledge-val');
  const settingsEditPledge = document.getElementById('settings-edit-pledge');
  const settingsContributorDialog = document.getElementById('settings-contributor-dialog');
  const settingsContributorForm = document.getElementById('settings-contributor-form');
  const settingsContributorAmount = document.getElementById('settings-contributor-amount');
  let currentSettingsAdminAmount = 100;
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
      Ipon.client.from('members').select('id,full_name,monthly_contribution_amount').eq('status', 'ACTIVE').order('full_name'),
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
    const adminMember = members.find((m) => m.id === activeGroup?.member_id || m.id === state?.profile?.member_id);
    if (adminMember && Number(adminMember.monthly_contribution_amount) > 0) {
      currentSettingsAdminAmount = Number(adminMember.monthly_contribution_amount);
    }
    if (adminContributorToggle) {
      const isContributor = Boolean(activeGroup?.is_contributor);
      adminContributorToggle.checked = isContributor;
      if (settingsContributorDetails) {
        settingsContributorDetails.hidden = !isContributor;
        if (settingsPledgeVal) settingsPledgeVal.textContent = Ipon.money(currentSettingsAdminAmount || 100);
      }
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

  function openSettingsContributorDialog(action = 'enable') {
    if (!settingsContributorDialog || !settingsContributorForm) return;
    const isEdit = action === 'edit';
    document.getElementById('settings-contributor-title').textContent = isEdit ? 'Update contributor amount' : 'Include yourself as a contributor?';
    document.getElementById('settings-contributor-copy').textContent = isEdit
      ? 'Adjust your monthly contribution amount for this group.'
      : 'Set your monthly contribution amount to participate in this group.';
    document.getElementById('save-settings-contributor').textContent = isEdit ? 'Save amount' : 'Confirm & join';
    settingsContributorAmount.value = String(currentSettingsAdminAmount || 100);
    settingsContributorDialog.showModal();
    settingsContributorAmount.focus();
    settingsContributorAmount.select();
  }

  adminContributorToggle?.addEventListener('change', async () => {
    const wantEnable = adminContributorToggle.checked;
    if (wantEnable) {
      adminContributorToggle.checked = false;
      openSettingsContributorDialog('enable');
    } else {
      adminContributorToggle.checked = true;
      const confirmed = await Ipon.confirmAction({
        title: 'Remove yourself as a contributor?',
        message: 'Are you sure you want to remove yourself as a contributor? You will no longer be included in monthly contribution periods or active rosters for this group.',
        acceptLabel: 'Remove contributor'
      });
      if (!confirmed) return;
      adminContributorToggle.checked = false;
      adminContributorToggle.disabled = true;
      try {
        await Ipon.rpc('set_admin_contributor', { p_enabled: false });
        Ipon.toast('You have been removed from active contributors.');
        await loadAccess();
      } catch (error) {
        adminContributorToggle.checked = true;
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        adminContributorToggle.disabled = false;
      }
    }
  });

  settingsEditPledge?.addEventListener('click', () => {
    openSettingsContributorDialog('edit');
  });

  document.getElementById('close-settings-contributor-dialog')?.addEventListener('click', () => settingsContributorDialog?.close());
  document.getElementById('cancel-settings-contributor-dialog')?.addEventListener('click', () => settingsContributorDialog?.close());

  settingsContributorForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(settingsContributorAmount.value);
    if (!amount || amount <= 0 || amount > 1000000) {
      Ipon.setFieldError(settingsContributorAmount, 'Please enter a valid monthly amount between ₱1 and ₱1,000,000.');
      settingsContributorAmount.focus();
      return;
    }
    const button = document.getElementById('save-settings-contributor');
    Ipon.setBusy(button, true, 'Saving…');
    try {
      await Ipon.rpc('set_admin_contributor', { p_enabled: true, p_monthly_amount: amount });
      currentSettingsAdminAmount = amount;
      settingsContributorDialog.close();
      Ipon.toast(`Contributor settings saved with ${Ipon.money(amount)} monthly contribution.`);
      await loadAccess();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
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
    const email = String(values.get('email')).trim();
    const confirmed = await Ipon.confirmAction({
      title: 'Send treasurer invitation?',
      message: `Are you sure you want to create an account and send an invitation email to ${email} as Treasurer?`,
      acceptLabel: 'Send invitation'
    });
    if (!confirmed) return;
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Creating…');
    try {
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

  const paymentForm = document.getElementById('payment-info-form');
  const paymentQrFile = document.getElementById('payment-qr-file');
  const settingsQrPreview = document.getElementById('settings-qr-preview');
  const clearPaymentQrBtn = document.getElementById('clear-payment-qr');
  let pendingQrDataUrl = null;
  let savedQrDataUrl = null;
  let clearQrFlag = false;

  function renderSettingsQrPreview() {
    if (!settingsQrPreview) return;
    const activeSrc = clearQrFlag ? null : (pendingQrDataUrl || savedQrDataUrl);
    if (activeSrc) {
      settingsQrPreview.innerHTML = `<img src="${activeSrc}" alt="Group payment QR code">`;
      settingsQrPreview.classList.add('has-qr');
      if (clearPaymentQrBtn) clearPaymentQrBtn.hidden = false;
    } else {
      settingsQrPreview.innerHTML = '<span class="payment-qr-placeholder">No QR uploaded</span>';
      settingsQrPreview.classList.remove('has-qr');
      if (clearPaymentQrBtn) clearPaymentQrBtn.hidden = true;
    }
  }

  async function loadPaymentInfo() {
    if (!paymentForm) return;
    const info = await Ipon.rpc('get_group_payment_info');
    savedQrDataUrl = info?.payment_qr_url || null;
    pendingQrDataUrl = null;
    clearQrFlag = false;
    paymentForm.elements.payment_method_label.value = info?.payment_method_label || '';
    paymentForm.elements.payment_account_name.value = info?.payment_account_name || '';
    paymentForm.elements.payment_account_number.value = info?.payment_account_number || '';
    paymentForm.elements.payment_instructions.value = info?.payment_instructions || '';
    renderSettingsQrPreview();
  }

  paymentQrFile?.addEventListener('change', async () => {
    const file = paymentQrFile.files?.[0];
    if (!file) return;
    try {
      const prepared = await Ipon.prepareImageDataUrl(file, { maxEdge: 1200, skipCompressBytes: 180 * 1024, maxBytes: 440 * 1024 });
      pendingQrDataUrl = prepared.dataUrl;
      clearQrFlag = false;
      renderSettingsQrPreview();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      paymentQrFile.value = '';
    }
  });

  clearPaymentQrBtn?.addEventListener('click', () => {
    pendingQrDataUrl = null;
    clearQrFlag = true;
    renderSettingsQrPreview();
  });

  settingsQrPreview?.addEventListener('click', () => {
    const activeSrc = clearQrFlag ? null : (pendingQrDataUrl || savedQrDataUrl);
    if (activeSrc) Ipon.openImageViewer(activeSrc, 'Group payment QR', paymentForm?.elements.payment_method_label.value || '');
  });

  paymentForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = paymentForm.querySelector('[type="submit"]');
    const values = new FormData(paymentForm);
    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('update_group_payment_info', {
        p_payment_qr_url: pendingQrDataUrl,
        p_clear_qr: clearQrFlag,
        p_payment_method_label: values.get('payment_method_label') || null,
        p_payment_account_name: values.get('payment_account_name') || null,
        p_payment_account_number: values.get('payment_account_number') || null,
        p_payment_instructions: values.get('payment_instructions') || null
      });
      Ipon.toast('Group payment details saved.');
      await loadPaymentInfo();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  effectiveMonth.addEventListener('change', async () => {
    try { await loadContributionDefault(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
  });

  try {
    await Promise.all([loadContributionDefault(), loadAccess(), loadPaymentInfo()]);
  } catch (error) {
    Ipon.showInlineError(accessBody, error, () => Promise.all([loadContributionDefault(), loadAccess(), loadPaymentInfo()]), 4);
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
