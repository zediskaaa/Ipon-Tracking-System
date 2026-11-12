(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['ADMIN'] });
  if (state.failed) return;
  const tbody = document.getElementById('members-body');
  const form = document.getElementById('member-form');
  const dialog = document.getElementById('member-dialog');
  const accountDialog = document.getElementById('member-account-dialog');
  const accountForm = document.getElementById('member-account-form');
  const historyDialog = document.getElementById('member-history-dialog');
  const historyBody = document.getElementById('member-history-body');
  const search = document.getElementById('member-search');
  const statusFilter = document.getElementById('member-status-filter');
  const pager = document.getElementById('member-pager');
  const firstName = document.getElementById('first-name');
  const middleName = document.getElementById('middle-name');
  const lastName = document.getElementById('last-name');
  const nameMigrationHelp = document.getElementById('name-migration-help');
  const contactInput = document.getElementById('contact-number');
  const contactError = document.getElementById('contact-number-error');
  const dateRegistered = document.getElementById('date-registered');
  const dateRegisteredHelp = document.getElementById('date-registered-help');
  const monthlyAmount = document.getElementById('monthly-amount');
  const monthlyAmountHelp = document.getElementById('monthly-amount-help');
  const emailField = document.getElementById('member-email-field');
  const passwordField = document.getElementById('member-password-field');
  const emailInput = document.getElementById('member-email');
  const passwordInput = document.getElementById('member-password');
  const deleteDialog = document.getElementById('member-delete-dialog');
  const deleteForm = document.getElementById('member-delete-form');
  const deleteSummary = document.getElementById('member-delete-summary');
  const deleteReasonSelect = document.getElementById('member-delete-reason-select');
  const deleteCustomWrap = document.getElementById('member-delete-custom-wrap');
  const deleteCustomReason = document.getElementById('member-delete-custom-reason');
  const deleteConfirmStep = document.getElementById('member-delete-confirm-step');
  const deleteConfirmCopy = document.getElementById('member-delete-confirm-copy');
  const deleteReasonPreview = document.getElementById('member-delete-reason-preview');
  const deleteBackBtn = document.getElementById('member-delete-back');
  const deleteConfirmBtn = document.getElementById('member-delete-confirm-btn');
  const binDialog = document.getElementById('bin-dialog');
  const binTypeFilter = document.getElementById('bin-type-filter');
  const binCount = document.getElementById('bin-count');
  const binList = document.getElementById('bin-list');
  const contactErrorMessage = 'Enter 11 digits starting with 09, or +63 followed by 10 digits starting with 9.';
  const nameErrorMessage = "Use letters, spaces, hyphens, or apostrophes only.";
  const nameFields = [
    [firstName, document.getElementById('first-name-error'), true],
    [middleName, document.getElementById('middle-name-error'), false],
    [lastName, document.getElementById('last-name-error'), true]
  ];
  let members = [];
  let accountsByMember = new Map();
  let membersWithContributions = new Set();
  let contributionSettings = [];
  let pendingDeleteMember = null;
  let pendingDeleteReason = '';
  let monthlyAmountTouched = false;
  const pageSize = 25;
  let memberPage = 0;
  let searchTimer;
  Ipon.bindPasswordStrength(passwordInput, () => [firstName.value, middleName.value, lastName.value, emailInput.value]);
  Ipon.bindPasswordStrength(accountForm.elements.password, () => {
    const member = members.find((item) => item.id === accountForm.elements.member_id.value);
    return [member?.first_name, member?.middle_name, member?.last_name, accountForm.elements.email.value];
  });
  dateRegistered.value = Ipon.isoDate();
  if (!state.configured || !state.profile) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Connect Supabase to load members.</td></tr>'; Ipon.setLoading(false); return; }

  function findApplicableContributionDefault(settings, registrationDate) {
    const registrationMonth = `${registrationDate.slice(0, 7)}-01`;
    return settings.find((item) => item.effective_month <= registrationMonth);
  }

  function applyContributionDefault() {
    if (form.elements.member_id.value || monthlyAmountTouched) return;
    const setting = findApplicableContributionDefault(contributionSettings, dateRegistered.value);
    monthlyAmount.value = setting?.default_amount ?? '';
    monthlyAmountHelp.textContent = setting
      ? `Prefilled from the default effective ${setting.effective_month.slice(0, 7)}. You can change it before saving.`
      : 'No default applies to this registration month. Enter a monthly amount.';
  }

  async function loadContributionSettings() {
    const { data, error } = await Ipon.client.from('contribution_settings')
      .select('effective_month,default_amount')
      .order('effective_month', { ascending: false });
    if (error) throw error;
    contributionSettings = data;
    applyContributionDefault();
  }

  function render() {
    tbody.innerHTML = members.length ? members.map((member) => { const account = accountsByMember.get(member.id); const canDelete = !membersWithContributions.has(member.id); return `<tr>
      <td><strong>${Ipon.escapeHtml(member.full_name)}</strong></td><td>${Ipon.escapeHtml(member.contact_number || '—')}</td><td>${Ipon.dateLabel(member.date_registered)}</td>
      <td>${Ipon.money(member.monthly_contribution_amount)}</td><td><span class="status status-${member.status.toLowerCase()}">${member.status}</span></td>
      <td>${account ? `<span class="status status-${account.status.toLowerCase()}">${account.status}</span><small class="field-help">${Ipon.escapeHtml(account.email || '')}</small>` : '<span class="field-help">No sign-in</span>'}</td>
      <td><div class="table-actions"><button class="icon-action" data-action="history" data-id="${member.id}">History</button><button class="icon-action" data-action="edit" data-id="${member.id}">Edit</button>${!account && member.status === 'ACTIVE' && member.first_name && member.last_name ? `<button class="icon-action" data-action="account" data-id="${member.id}">Create account</button>` : ''}${account?.email ? `<button class="icon-action" data-action="reset" data-id="${member.id}">Reset password</button>` : ''}<button class="icon-action" data-action="${member.status === 'ACTIVE' ? 'deactivate' : 'reactivate'}" data-id="${member.id}">${member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>${canDelete ? `<button class="icon-action icon-action-danger" data-action="delete" data-id="${member.id}">Delete</button>` : ''}</div></td></tr>`; }).join('') : '<tr><td colspan="7" class="empty-state">No matching members.</td></tr>';
  }
  async function load() {
    let query = Ipon.client.from('members').select('*', { count: 'exact' });
    const term = search.value.trim().replace(/[%_]/g, '');
    if (term) query = query.ilike('full_name', `%${term}%`);
    if (statusFilter.value) query = query.eq('status', statusFilter.value);
    const [{ data, count, error }, accessRows] = await Promise.all([
      query.order('full_name').range(memberPage * pageSize, (memberPage + 1) * pageSize - 1),
      Ipon.rpc('get_group_access_list')
    ]);
    if (error) throw error;
    const memberIds = (data || []).map((member) => member.id);
    const contribResult = memberIds.length
      ? await Ipon.client.from('contribution_periods').select('member_id,contributions!inner(id)').in('member_id', memberIds)
      : { data: [], error: null };
    if (contribResult.error) throw contribResult.error;
    members = data;
    accountsByMember = new Map((Array.isArray(accessRows) ? accessRows : []).filter((row) => row.member_id).map((row) => [row.member_id, { id: row.user_id, email: row.email, status: row.status, member_id: row.member_id }]));
    membersWithContributions = new Set((contribResult.data || []).map((row) => row.member_id));
    const pages = Math.max(1, Math.ceil(count / pageSize));
    document.getElementById('member-count').textContent = `${count} member${count === 1 ? '' : 's'}`;
    pager.querySelector('span').textContent = `Page ${memberPage + 1} of ${pages}`;
    pager.querySelector('[data-page="previous"]').disabled = memberPage === 0;
    pager.querySelector('[data-page="next"]').disabled = memberPage >= pages - 1;
    render();
  }
  async function refresh() {
    try { await load(); } catch (error) { Ipon.showInlineError(tbody, error, refresh, 7); }
  }
  function resetForm() {
    form.reset(); form.elements.member_id.value = ''; dateRegistered.value = Ipon.isoDate(); monthlyAmountTouched = false; applyContributionDefault();
    dateRegistered.disabled = false; dateRegisteredHelp.hidden = true;
    emailField.hidden = false; emailInput.required = true;
    passwordField.hidden = false; passwordInput.required = true;
    nameMigrationHelp.hidden = true; nameMigrationHelp.textContent = '';
    nameFields.forEach(([input, error]) => setNameError(input, error, ''));
    setContactError('');
    document.getElementById('member-form-title').textContent = 'Add member';
    document.getElementById('member-form-copy').textContent = 'Create a tracking profile and sign-in account for a contributor.';
  }
  function normalizeContactNumber(value) {
    const number = String(value || '').trim();
    if (!number) return '';
    if (/^09[0-9]{9}$/.test(number)) return number;
    if (/^\+639[0-9]{9}$/.test(number)) return `0${number.slice(3)}`;
    return null;
  }
  function setContactError(message) {
    contactError.hidden = !message;
    contactInput.setCustomValidity(message);
    if (message) contactInput.setAttribute('aria-invalid', 'true'); else contactInput.removeAttribute('aria-invalid');
  }
  function setNameError(input, error, message) {
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    error.textContent = message;
    error.hidden = !message;
  }
  function validateNames() {
    let firstInvalid = null;
    nameFields.forEach(([input, error, required]) => {
      const value = input.value.trim();
      const valid = !value ? !required : Ipon.validNamePart(value);
      const message = valid ? '' : (!value ? 'This name is required.' : nameErrorMessage);
      setNameError(input, error, message);
      if (!valid && !firstInvalid) firstInvalid = input;
    });
    if (!firstInvalid && nameFields.map(([input]) => Ipon.normalizeNamePart(input.value)).filter(Boolean).join(' ').length > 150) {
      const error = document.getElementById('last-name-error');
      setNameError(lastName, error, 'Combined full name must not exceed 150 characters.');
      firstInvalid = lastName;
    }
    firstInvalid?.focus();
    return !firstInvalid;
  }
  nameFields.forEach(([input, error]) => input.addEventListener('input', () => setNameError(input, error, '')));
  contactInput.addEventListener('input', () => setContactError(''));
  monthlyAmount.addEventListener('input', () => {
    monthlyAmountTouched = true;
    monthlyAmountHelp.textContent = 'Custom amount entered. This amount will be used when generating new periods.';
  });
  dateRegistered.addEventListener('change', applyContributionDefault);
  contactInput.addEventListener('invalid', (event) => { event.preventDefault(); setContactError(contactErrorMessage); contactInput.focus(); });
  contactInput.addEventListener('blur', () => {
    const normalized = normalizeContactNumber(contactInput.value);
    if (normalized === null) setContactError(contactErrorMessage);
    else { contactInput.value = normalized; setContactError(''); }
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); const values = new FormData(form); const contactNumber = normalizeContactNumber(values.get('contact_number'));
    if (!validateNames()) return;
    if (contactNumber === null) { setContactError(contactErrorMessage); contactInput.focus(); return; }
    const creatingAccount = !emailField.hidden;
    const name = { p_first_name: Ipon.normalizeNamePart(values.get('first_name')), p_middle_name: values.get('middle_name').trim() ? Ipon.normalizeNamePart(values.get('middle_name')) : null, p_last_name: Ipon.normalizeNamePart(values.get('last_name')) };
    if (creatingAccount) {
      if (!emailInput.checkValidity()) { Ipon.setFieldError(emailInput, Ipon.getValidationMessage(emailInput)); emailInput.focus(); return; }
      const passwordIssue = Ipon.passwordIssue(passwordInput.value, [name.p_first_name, name.p_middle_name, name.p_last_name, emailInput.value]);
      if (passwordIssue) { Ipon.setFieldError(passwordInput, passwordIssue); passwordInput.focus(); return; }
    }
    Ipon.setBusy(button, true);
    try {
      let memberId = values.get('member_id');
      if (memberId) await Ipon.rpc('update_member', { p_member_id: memberId, ...name, p_contact_number: contactNumber, p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null });
      else {
        memberId = await Ipon.rpc('create_member', { ...name, p_contact_number: contactNumber, p_date_registered: values.get('date_registered'), p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null });
        form.elements.member_id.value = memberId;
      }
      if (creatingAccount) {
        const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'MEMBER', member_id: memberId, first_name: name.p_first_name, middle_name: name.p_middle_name, last_name: name.p_last_name, contact_number: contactNumber || null, email: emailInput.value.trim(), password: passwordInput.value } });
        if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      }
      Ipon.toast(creatingAccount ? 'Member and account created.' : 'Member updated.'); dialog.close(); await load();
    } catch (error) { await load().catch(() => {}); Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return; const member = members.find((item) => item.id === button.dataset.id); if (!member) return;
    if (button.dataset.action === 'history') {
      document.getElementById('member-history-title').textContent = `${member.full_name} — contribution history`;
      historyBody.innerHTML = '<tr><td colspan="5">Loading history…</td></tr>'; historyDialog.showModal();
      const { data, error } = await Ipon.client.from('contributions').select('amount,payment_date,approval_status,review_note,void_reason,contribution_periods!inner(period_month,member_id)').eq('contribution_periods.member_id', member.id).order('payment_date', { ascending: false }).limit(100);
      historyBody.innerHTML = error ? `<tr><td colspan="5" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>` : data.length ? data.map((row) => `<tr><td>${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.dateLabel(row.payment_date)}</td><td>${Ipon.money(row.amount)}</td><td><span class="status status-${row.approval_status.toLowerCase()}">${row.approval_status}</span></td><td>${Ipon.escapeHtml(row.review_note || row.void_reason || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No contribution history yet.</td></tr>';
    } else if (button.dataset.action === 'edit') {
      form.elements.member_id.value = member.id; form.elements.first_name.value = member.first_name || ''; form.elements.middle_name.value = member.middle_name || ''; form.elements.last_name.value = member.last_name || ''; form.elements.contact_number.value = member.contact_number || '';
      emailField.hidden = true; emailInput.required = false;
      passwordField.hidden = true; passwordInput.required = false;
      nameFields.forEach(([input, error]) => setNameError(input, error, ''));
      nameMigrationHelp.hidden = Boolean(member.first_name && member.last_name);
      nameMigrationHelp.textContent = nameMigrationHelp.hidden ? '' : `Legacy name kept as “${member.full_name}”. Enter its structured name parts before saving.`;
      setContactError('');
      form.elements.date_registered.value = member.date_registered; form.elements.monthly_contribution_amount.value = member.monthly_contribution_amount; form.elements.notes.value = member.notes || '';
      dateRegistered.disabled = true; dateRegisteredHelp.hidden = false;
      monthlyAmountTouched = true; monthlyAmountHelp.textContent = 'This member\'s saved amount is used when generating new periods.';
      document.getElementById('member-form-title').textContent = 'Edit member'; document.getElementById('member-form-copy').textContent = `Update ${member.full_name}'s profile.`; dialog.showModal(); firstName.focus();
    } else if (button.dataset.action === 'account') {
      accountForm.reset(); accountForm.elements.member_id.value = member.id;
      document.getElementById('member-account-copy').textContent = `Create a secure sign-in for ${member.full_name}.`;
      accountDialog.showModal(); accountForm.elements.email.focus();
    } else if (button.dataset.action === 'reset') {
      const account = accountsByMember.get(member.id); if (!account?.email) return;
      const accepted = await Ipon.confirmAction({ title: 'Send password recovery email?', message: `A password recovery link will be sent to ${account.email}.`, acceptLabel: 'Send email' });
      if (!accepted) return;
      Ipon.setBusy(button, true, 'Sending…');
      try {
        const { error } = await Ipon.client.auth.resetPasswordForEmail(account.email, { redirectTo: new URL('account.html', location.href).href });
        if (error) throw error;
        Ipon.toast('Password recovery email sent.');
      } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
      finally { Ipon.setBusy(button, false); }
    } else if (button.dataset.action === 'deactivate') {
      const accepted = await Ipon.confirmAction({ title: 'Deactivate member?', message: `${member.full_name} will stop receiving new contribution periods. Existing records remain available.`, acceptLabel: 'Deactivate' });
      if (!accepted) return;
      try { await Ipon.rpc('deactivate_member', { p_member_id: member.id }); Ipon.toast('Member deactivated.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    } else if (button.dataset.action === 'reactivate') {
      const accepted = await Ipon.confirmAction({ title: 'Reactivate member?', message: `${member.full_name} will be included when new contribution periods are generated.`, acceptLabel: 'Reactivate' });
      if (!accepted) return;
      try { await Ipon.rpc('reactivate_member', { p_member_id: member.id }); Ipon.toast('Member reactivated.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    } else if (button.dataset.action === 'delete') {
      openDeleteDialog(member);
    }
  });
  function resetDeleteDialog() {
    pendingDeleteMember = null;
    pendingDeleteReason = '';
    deleteForm.reset();
    deleteForm.hidden = false;
    deleteConfirmStep.hidden = true;
    deleteCustomWrap.hidden = true;
    deleteCustomReason.required = false;
    Ipon.setFieldError(deleteCustomReason, '');
    Ipon.setFieldError(deleteReasonSelect, '');
  }
  function openDeleteDialog(member) {
    if (!member || membersWithContributions.has(member.id)) return;
    resetDeleteDialog();
    pendingDeleteMember = member;
    deleteForm.elements.member_id.value = member.id;
    const account = accountsByMember.get(member.id);
    deleteSummary.innerHTML = `<div class="record-review-summary-top"><span class="record-type-pill is-expense">Delete member</span><span class="status status-${member.status.toLowerCase()}">${Ipon.escapeHtml(member.status)}</span></div><div class="record-review-summary-main"><div class="record-review-author"><div><strong>${Ipon.escapeHtml(member.full_name)}</strong><small>${Ipon.escapeHtml(account?.email || member.contact_number || 'No sign-in account')}</small></div></div><div class="record-review-amount"><small>Monthly target</small><strong>${Ipon.money(member.monthly_contribution_amount)}</strong></div></div><div class="record-review-meta"><span>Registered ${Ipon.escapeHtml(Ipon.dateLabel(member.date_registered))}</span><span>0 recorded contributions</span></div>`;
    deleteDialog.showModal();
    deleteReasonSelect.focus();
  }
  function resolveDeleteReason() {
    if (deleteReasonSelect.value === 'OTHERS') return deleteCustomReason.value.trim();
    return deleteReasonSelect.value.trim();
  }
  deleteReasonSelect.addEventListener('change', () => {
    const isOther = deleteReasonSelect.value === 'OTHERS';
    deleteCustomWrap.hidden = !isOther;
    deleteCustomReason.required = isOther;
    Ipon.setFieldError(deleteReasonSelect, '');
    Ipon.setFieldError(deleteCustomReason, '');
    if (isOther) deleteCustomReason.focus();
  });
  deleteCustomReason.addEventListener('input', () => Ipon.setFieldError(deleteCustomReason, ''));
  deleteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingDeleteMember) return;
    if (!deleteReasonSelect.value) {
      Ipon.setFieldError(deleteReasonSelect, 'Select a deletion reason.');
      deleteReasonSelect.focus();
      return;
    }
    const reason = resolveDeleteReason();
    if (reason.length < 3 || reason.length > 500) {
      Ipon.setFieldError(deleteCustomReason, 'Enter a reason between 3 and 500 characters.');
      deleteCustomReason.focus();
      return;
    }
    pendingDeleteReason = reason;
    const linkedAccount = accountsByMember.get(pendingDeleteMember.id);
    deleteConfirmCopy.textContent = `${pendingDeleteMember.full_name} will be moved to the recycle bin for 1 month${linkedAccount ? ' and their sign-in account will be temporarily disabled until recovered' : ''}.`;
    deleteReasonPreview.textContent = `Reason: "${reason}"`;
    deleteForm.hidden = true;
    deleteConfirmStep.hidden = false;
    deleteConfirmBtn.focus();
  });
  deleteBackBtn.addEventListener('click', () => {
    deleteConfirmStep.hidden = true;
    deleteForm.hidden = false;
    deleteReasonSelect.focus();
  });
  deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteMember || !pendingDeleteReason) return;
    Ipon.setBusy(deleteConfirmBtn, true, 'Deleting…');
    try {
      await Ipon.rpc('delete_member', { p_member_id: pendingDeleteMember.id, p_reason: pendingDeleteReason });
      deleteDialog.close();
      Ipon.toast('Member moved to recycle bin.');
      await load();
      if (binDialog.open) await loadBin();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(deleteConfirmBtn, false);
    }
  });
  document.getElementById('close-member-delete-dialog')?.addEventListener('click', () => deleteDialog.close());
  document.getElementById('cancel-member-delete')?.addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('close', resetDeleteDialog);

  function binDaysLeftLabel(expiresAt) {
    const remainingMs = new Date(expiresAt).getTime() - Date.now();
    const days = Math.max(0, Math.ceil(remainingMs / 86400000));
    if (days <= 0) return 'Expires today';
    return `${days} day${days === 1 ? '' : 's'} left to recover`;
  }
  async function loadBin() {
    binCount.textContent = 'Loading deleted items…';
    binList.innerHTML = '<p class="empty-state">Loading deleted items…</p>';
    try {
      const result = await Ipon.rpc('get_bin_items', { p_type: binTypeFilter.value || null });
      const items = Array.isArray(result) ? result : [];
      binCount.textContent = `${items.length} recoverable item${items.length === 1 ? '' : 's'}`;
      binList.innerHTML = items.length ? items.map((item) => {
        const typeClass = item.item_type === 'announcement' ? 'is-deduction' : 'is-addition';
        return `<article class="bin-item"><div class="bin-item-main"><div class="bin-item-top"><span class="record-type-pill ${typeClass}">${Ipon.escapeHtml(item.type_label || item.item_type)}</span><span class="bin-item-expiry">${Ipon.escapeHtml(binDaysLeftLabel(item.expires_at))}</span></div><strong>${Ipon.escapeHtml(item.title)}</strong>${item.subtitle ? `<p class="bin-item-subtitle">${Ipon.escapeHtml(item.subtitle)}</p>` : ''}<p class="bin-item-reason">Reason: ${Ipon.escapeHtml(item.reason || 'No reason provided')}</p><p class="bin-item-meta">Deleted by ${Ipon.escapeHtml(item.deleted_by_name || 'Group Administrator')} on ${Ipon.escapeHtml(Ipon.dateLabel(item.deleted_at))}</p></div><button class="button button-secondary" type="button" data-recover-type="${Ipon.escapeHtml(item.item_type)}" data-recover-id="${Ipon.escapeHtml(item.item_id)}" data-recover-label="${Ipon.escapeHtml(item.type_label || item.item_type)}" data-recover-title="${Ipon.escapeHtml(item.title)}">Recover</button></article>`;
      }).join('') : '<p class="empty-state">No deleted items found within the 1-month recovery window.</p>';
    } catch (error) {
      binCount.textContent = 'Unable to load bin';
      binList.innerHTML = `<p class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</p>`;
    }
  }
  document.getElementById('see-bin')?.addEventListener('click', () => {
    binTypeFilter.value = '';
    binDialog.showModal();
    loadBin();
  });
  document.getElementById('close-bin-dialog')?.addEventListener('click', () => binDialog.close());
  binTypeFilter.addEventListener('change', loadBin);
  binList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-recover-id]');
    if (!button) return;
    const itemType = button.dataset.recoverType;
    const itemId = button.dataset.recoverId;
    const itemLabel = button.dataset.recoverLabel || 'Item';
    const itemTitle = button.dataset.recoverTitle || 'this item';
    const accepted = await Ipon.confirmAction({
      title: `Recover ${itemLabel.toLowerCase()}?`,
      message: `"${itemTitle}" will be restored to active records.`,
      acceptLabel: 'Recover'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true, 'Recovering…');
    try {
      await Ipon.rpc('recover_bin_item', { p_item_type: itemType, p_item_id: itemId });
      Ipon.toast(`${itemLabel} recovered.`);
      await Promise.all([loadBin(), load()]);
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });
  document.getElementById('add-member')?.addEventListener('click', () => { resetForm(); dialog.showModal(); firstName.focus(); });
  document.getElementById('cancel-edit')?.addEventListener('click', () => dialog.close());
  document.getElementById('close-member-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', resetForm);
  document.getElementById('close-member-account-dialog').addEventListener('click', () => accountDialog.close());
  document.getElementById('cancel-member-account').addEventListener('click', () => accountDialog.close());
  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter; const member = members.find((item) => item.id === accountForm.elements.member_id.value); if (!member) return;
    const passwordIssue = Ipon.passwordIssue(accountForm.elements.password.value, [member.first_name, member.middle_name, member.last_name, accountForm.elements.email.value]);
    if (passwordIssue) { Ipon.setFieldError(accountForm.elements.password, passwordIssue); accountForm.elements.password.focus(); return; }
    Ipon.setBusy(button, true);
    try {
      const email = accountForm.elements.email.value.trim();
      const res = await Ipon.inviteAccount({ role: 'MEMBER', member_id: member.id, first_name: member.first_name, middle_name: member.middle_name || null, last_name: member.last_name, contact_number: member.contact_number || null, email, password: accountForm.elements.password.value });
      accountDialog.close();
      Ipon.toast(res.email_sent ? 'Member account created and invite email sent.' : 'Member account created.');
      if (!res.email_sent) Ipon.showInviteSummary({ title: 'Member sign-in credentials', results: [{ ok: true, email, ...res }] });
      await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  document.getElementById('close-member-history-dialog').addEventListener('click', () => historyDialog.close());
  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { memberPage = 0; refresh(); }, 250); });
  statusFilter.addEventListener('change', () => { memberPage = 0; refresh(); });
  pager.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    memberPage += button.dataset.page === 'next' ? 1 : -1;
    refresh();
  });
  try { await Promise.all([loadContributionSettings(), load()]); } catch (error) { Ipon.showInlineError(tbody, error, () => Promise.all([loadContributionSettings(), load()]), 7); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('members', ['members', 'profiles', 'contribution_settings', 'contributions', 'announcements'], () => Promise.all([loadContributionSettings(), refresh(), ...(binDialog.open ? [loadBin()] : [])]));
})();
