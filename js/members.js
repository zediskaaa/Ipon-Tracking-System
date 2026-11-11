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
  const contactErrorMessage = 'Enter 11 digits starting with 09, or +63 followed by 10 digits starting with 9.';
  const nameErrorMessage = "Use letters, spaces, hyphens, or apostrophes only.";
  const nameFields = [
    [firstName, document.getElementById('first-name-error'), true],
    [middleName, document.getElementById('middle-name-error'), false],
    [lastName, document.getElementById('last-name-error'), true]
  ];
  let members = [];
  let accountsByMember = new Map();
  let contributionSettings = [];
  let monthlyAmountTouched = false;
  const pageSize = 25;
  let memberPage = 0;
  let searchTimer;
  Ipon.bindPasswordStrength(accountForm.elements.password, () => {
    const member = members.find((item) => item.id === accountForm.elements.member_id.value);
    return [member?.first_name, member?.middle_name, member?.last_name, accountForm.elements.email.value];
  });
  dateRegistered.value = Ipon.isoDate();
  if (!state.configured || !state.profile) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Connect Supabase to load members.</td></tr>'; return; }

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
    tbody.innerHTML = members.length ? members.map((member) => { const account = accountsByMember.get(member.id); return `<tr>
      <td><strong>${Ipon.escapeHtml(member.full_name)}</strong></td><td>${Ipon.escapeHtml(member.contact_number || '—')}</td><td>${Ipon.dateLabel(member.date_registered)}</td>
      <td>${Ipon.money(member.monthly_contribution_amount)}</td><td><span class="status status-${member.status.toLowerCase()}">${member.status}</span></td>
      <td>${account ? `<span class="status status-${account.status.toLowerCase()}">${account.status}</span><small class="field-help">${Ipon.escapeHtml(account.email || '')}</small>` : '<span class="field-help">No sign-in</span>'}</td>
      <td><div class="table-actions"><button class="icon-action" data-action="history" data-id="${member.id}">History</button><button class="icon-action" data-action="edit" data-id="${member.id}">Edit</button>${!account && member.status === 'ACTIVE' && member.first_name && member.last_name ? `<button class="icon-action" data-action="account" data-id="${member.id}">Create account</button>` : ''}${account?.email ? `<button class="icon-action" data-action="reset" data-id="${member.id}">Reset password</button>` : ''}${member.status === 'ACTIVE' ? `<button class="icon-action" data-action="deactivate" data-id="${member.id}">Deactivate</button>` : ''}</div></td></tr>`; }).join('') : '<tr><td colspan="7" class="empty-state">No matching members.</td></tr>';
  }
  async function load() {
    let query = Ipon.client.from('members').select('*', { count: 'exact' });
    const term = search.value.trim().replace(/[%_]/g, '');
    if (term) query = query.ilike('full_name', `%${term}%`);
    if (statusFilter.value) query = query.eq('status', statusFilter.value);
    const [{ data, count, error }, accountResult] = await Promise.all([query.order('full_name').range(memberPage * pageSize, (memberPage + 1) * pageSize - 1), Ipon.client.from('profiles').select('id,email,status,member_id').eq('role', 'MEMBER').not('member_id', 'is', null)]);
    if (error) throw error;
    if (accountResult.error) throw accountResult.error;
    members = data;
    accountsByMember = new Map((accountResult.data || []).map((account) => [account.member_id, account]));
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
    nameMigrationHelp.hidden = true; nameMigrationHelp.textContent = '';
    nameFields.forEach(([input, error]) => setNameError(input, error, ''));
    setContactError('');
    document.getElementById('member-form-title').textContent = 'Add member';
    document.getElementById('member-form-copy').textContent = 'Create a tracking profile for a contributor.';
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
    Ipon.setBusy(button, true);
    try {
      const name = { p_first_name: Ipon.normalizeNamePart(values.get('first_name')), p_middle_name: values.get('middle_name').trim() ? Ipon.normalizeNamePart(values.get('middle_name')) : null, p_last_name: Ipon.normalizeNamePart(values.get('last_name')) };
      if (values.get('member_id')) await Ipon.rpc('update_member', { p_member_id: values.get('member_id'), ...name, p_contact_number: contactNumber, p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null });
      else await Ipon.rpc('create_member', { ...name, p_contact_number: contactNumber, p_date_registered: values.get('date_registered'), p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null });
      Ipon.toast(values.get('member_id') ? 'Member updated.' : 'Member added.'); dialog.close(); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return; const member = members.find((item) => item.id === button.dataset.id); if (!member) return;
    if (button.dataset.action === 'history') {
      document.getElementById('member-history-title').textContent = `${member.full_name} — contribution history`;
      historyBody.innerHTML = '<tr><td colspan="4">Loading history…</td></tr>'; historyDialog.showModal();
      const { data, error } = await Ipon.client.from('contributions').select('amount,payment_date,approval_status,contribution_periods!inner(period_month,member_id)').eq('contribution_periods.member_id', member.id).order('payment_date', { ascending: false }).limit(100);
      historyBody.innerHTML = error ? `<tr><td colspan="4" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>` : data.length ? data.map((row) => `<tr><td>${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.dateLabel(row.payment_date)}</td><td>${Ipon.money(row.amount)}</td><td><span class="status status-${row.approval_status.toLowerCase()}">${row.approval_status}</span></td></tr>`).join('') : '<tr><td colspan="4" class="empty-state">No contribution history yet.</td></tr>';
    } else if (button.dataset.action === 'edit') {
      form.elements.member_id.value = member.id; form.elements.first_name.value = member.first_name || ''; form.elements.middle_name.value = member.middle_name || ''; form.elements.last_name.value = member.last_name || ''; form.elements.contact_number.value = member.contact_number || '';
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
    } else {
      const accepted = await Ipon.confirmAction({ title: 'Deactivate member?', message: `${member.full_name} will stop receiving new contribution periods. Existing records remain available.`, acceptLabel: 'Deactivate' });
      if (!accepted) return;
      try { await Ipon.rpc('deactivate_member', { p_member_id: member.id }); Ipon.toast('Member deactivated.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
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
    if (passwordIssue) return Ipon.toast(passwordIssue, 'error');
    Ipon.setBusy(button, true);
    try {
      const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'MEMBER', member_id: member.id, first_name: member.first_name, middle_name: member.middle_name || null, last_name: member.last_name, email: accountForm.elements.email.value.trim(), password: accountForm.elements.password.value } });
      if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      accountDialog.close(); Ipon.toast('Member account created.'); await load();
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
  try { await Promise.all([loadContributionSettings(), load()]); } catch (error) { Ipon.showInlineError(tbody, error, () => Promise.all([loadContributionSettings(), load()]), 7); }
})();
