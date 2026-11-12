(async function () {
  'use strict';
  const page = document.body.dataset.page;
  const form = document.getElementById('record-form');
  const tbody = document.getElementById('records-body');
  const contributionEntriesBody = document.getElementById('contribution-entries-body');
  const statusFilter = document.getElementById('record-status-filter');
  const pager = document.getElementById('record-pager');
  const pageSize = 25;
  let historyPage = 0;
  const state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER'] });
  if (state.failed || state.redirecting) return;
  if (!state.configured || !state.profile) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Connect Supabase to load records.</td></tr>`;
    setDefaults();
    Ipon.setLoading(false);
    return;
  }
  if (page === 'expenses' && state.profile.role === 'MEMBER') {
    form.closest('.panel').innerHTML = '<div class="empty-state">Only administrators and treasurers can record expenses.</div>';
  }
  setDefaults();

  function setDefaults() {
    const today = Ipon.isoDate();
    document.querySelectorAll('input[type="date"]').forEach((input) => { if (!input.value) input.value = today; });
    const monthInput = document.getElementById('contribution-month');
    if (monthInput && !monthInput.value) monthInput.value = today.slice(0, 7);
  }

  let membersList = [];
  const statusRowsByMonth = new Map();
  let pendingSubmissionKey = null;
  let recordRows = [];

  document.body.insertAdjacentHTML('beforeend', `<dialog class="form-dialog" id="record-edit-dialog" aria-labelledby="record-edit-title"><div class="form-dialog-sheet"><header class="form-dialog-header"><div><h2 id="record-edit-title">Edit pending record</h2><p>Only pending records can be corrected. Confirmed records must be voided and replaced.</p></div><button class="dialog-close" id="record-edit-close" type="button" aria-label="Close edit form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><form id="record-edit-form" class="form-grid"><input type="hidden" name="record_id"><div class="field"><label for="edit-date">Date</label><input id="edit-date" name="date" type="date" min="2000-01-01" data-max-today required></div><div class="field"><label for="edit-amount">Amount</label><input id="edit-amount" name="amount" type="number" min="0.01" step="0.01" required></div><div class="field transaction-edit-field"><label for="edit-category">Category</label><input id="edit-category" name="category" maxlength="80"></div><div class="field transaction-edit-field"><label for="edit-responsible">Person responsible</label><select id="edit-responsible" name="person_responsible"><option value="">Select member</option></select></div><div class="field field-wide transaction-edit-field"><label for="edit-description">Description</label><textarea id="edit-description" name="description" maxlength="500"></textarea></div><div class="field"><label for="edit-reference">Reference</label><input id="edit-reference" name="reference" maxlength="100"></div><div class="field field-wide"><label for="edit-notes">Notes</label><textarea id="edit-notes" name="notes" maxlength="1000"></textarea></div><div class="form-actions field-wide"><button class="button button-secondary" id="record-edit-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save correction</button></div></form></div></dialog>`);
  const editDialog = document.getElementById('record-edit-dialog');
  const editForm = document.getElementById('record-edit-form');
  editDialog.querySelectorAll('.transaction-edit-field').forEach((field) => { field.hidden = page === 'contributions'; field.querySelector('input,select,textarea').required = page !== 'contributions'; });

  function statusBadge(status) {
    const statusClass = String(status).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<span class="status status-${statusClass}">${Ipon.escapeHtml(status)}</span>`;
  }

  function updatePager(count = 0) {
    if (!pager) return;
    const pages = Math.max(1, Math.ceil(count / pageSize));
    pager.querySelector('span').textContent = `Page ${historyPage + 1} of ${pages} · ${count} record${count === 1 ? '' : 's'}`;
    pager.querySelector('[data-page="previous"]').disabled = historyPage === 0;
    pager.querySelector('[data-page="next"]').disabled = historyPage >= pages - 1;
  }

  async function syncSuggestedAmount() {
    if (page !== 'contributions') return;
    const memberSelect = document.getElementById('member-id');
    const monthInput = document.getElementById('contribution-month');
    const amountInput = document.getElementById('amount');
    if (!memberSelect || !monthInput || !amountInput) return;

    const memberId = memberSelect.value;
    const monthValue = monthInput.value;
    if (!memberId || !monthValue) {
      amountInput.value = '';
      return;
    }

    const periodMonth = `${monthValue}-01`;
    const cacheKey = `${memberId}:${periodMonth}`;
    let statusRow = statusRowsByMonth.get(cacheKey);

    if (statusRow === undefined) {
      const { data, error } = await Ipon.client
        .from('v_contribution_status')
        .select('member_id,period_month,required_amount,paid_amount,outstanding_amount,payment_status')
        .eq('member_id', memberId)
        .eq('period_month', periodMonth)
        .maybeSingle();
      statusRow = !error && data ? data : null;
      statusRowsByMonth.set(cacheKey, statusRow);
    }

    if (statusRow) {
      const outstanding = Number(statusRow.outstanding_amount || 0);
      if (outstanding > 0 && statusRow.payment_status !== 'PAID' && statusRow.payment_status !== 'OVERPAID') {
        amountInput.value = outstanding.toFixed(2);
      } else {
        amountInput.value = '';
      }
      return;
    }

    const member = membersList.find((m) => m.id === memberId);
    const fallbackAmount = Number(member?.monthly_contribution_amount || 0);
    amountInput.value = fallbackAmount > 0 ? fallbackAmount.toFixed(2) : '';
  }

  function populateResponsibleSelect(select, selectedName = '') {
    if (!select) return;
    const names = membersList.map((member) => member.full_name).filter(Boolean);
    if (selectedName && !names.includes(selectedName)) names.unshift(selectedName);
    select.innerHTML = names.length
      ? `<option value="">Select member</option>${names.map((name) => `<option value="${Ipon.escapeHtml(name)}" ${selectedName === name ? 'selected' : ''}>${Ipon.escapeHtml(name)}</option>`).join('')}`
      : '<option value="">No active member profile found</option>';
  }

  async function loadMembers() {
    const select = document.getElementById('member-id');
    const responsibleSelect = document.getElementById('responsible');
    const editResponsibleSelect = document.getElementById('edit-responsible');
    if (!select && !responsibleSelect && !editResponsibleSelect) return;
    const { data, error } = await Ipon.client.from('members').select('id,full_name,monthly_contribution_amount').eq('status', 'ACTIVE').order('full_name');
    if (error) throw error;
    membersList = data || [];
    if (select) {
      const currentSelection = select.value;
      const selectedId = currentSelection || state.profile.member_id || '';
      select.innerHTML = membersList.length
        ? `<option value="">Select member</option>${membersList.map((member) => `<option value="${member.id}" ${selectedId === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}`
        : '<option value="">No active member profile found</option>';
      if (state.profile.role === 'MEMBER') {
        select.closest('.field').hidden = true;
        select.required = false;
      }
    }
    if (responsibleSelect) {
      const ownMember = membersList.find((member) => member.id === state.profile.member_id);
      const defaultResponsible = responsibleSelect.value || ownMember?.full_name || '';
      populateResponsibleSelect(responsibleSelect, defaultResponsible);
      if (state.profile.role === 'MEMBER') {
        responsibleSelect.closest('.field').hidden = true;
        responsibleSelect.required = false;
      }
    }
    if (editResponsibleSelect) {
      populateResponsibleSelect(editResponsibleSelect, editResponsibleSelect.value);
    }
  }

  async function loadContributions() {
    const month = document.getElementById('status-month');
    if (!month.options.length) {
      const now = new Date();
      for (let offset = -5; offset <= 1; offset += 1) {
        const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const value = Ipon.monthStart(date);
        month.insertAdjacentHTML('beforeend', `<option value="${value}" ${offset === 0 ? 'selected' : ''}>${Ipon.dateLabel(value, { month: 'long', year: 'numeric' })}</option>`);
      }
      month.addEventListener('change', load);
    }
    statusRowsByMonth.clear();
    const { data, error } = await Ipon.client.from('v_contribution_status').select('*').eq('period_month', month.value).order('member_name');
    if (error) throw error;
    (data || []).forEach((row) => {
      statusRowsByMonth.set(`${row.member_id}:${row.period_month}`, row);
    });
    tbody.innerHTML = data.length ? data.map((row) => `<tr><td>${Ipon.escapeHtml(row.member_name)}</td><td>${Ipon.dateLabel(row.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.required_amount)}</td><td>${Ipon.money(row.paid_amount)}</td><td>${Ipon.money(row.outstanding_amount)}</td><td>${statusBadge(row.payment_status)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No contribution periods for this month.</td></tr>';

    let entriesQuery = Ipon.client.from('contributions')
      .select('id,amount,payment_date,transaction_reference,notes,approval_status,void_reason,review_note,contribution_periods!inner(period_month,members!inner(full_name))', { count: 'exact' });
    if (statusFilter?.value) entriesQuery = entriesQuery.eq('approval_status', statusFilter.value);
    const { data: entries, count, error: entriesError } = await entriesQuery
      .order('payment_date', { ascending: false }).range(historyPage * pageSize, (historyPage + 1) * pageSize - 1);
    if (entriesError) throw entriesError;
    recordRows = entries || [];
    updatePager(count);
    contributionEntriesBody.innerHTML = entries.length ? entries.map((entry) => {
      const isCancelled = entry.approval_status === 'VOIDED' || entry.approval_status === 'REJECTED';
      const reason = entry.void_reason || entry.review_note;
      return `<tr class="${isCancelled ? 'row-voided' : ''}"><td>${Ipon.dateLabel(entry.payment_date)}</td><td>${Ipon.escapeHtml(entry.contribution_periods.members.full_name)}${reason ? `<small class="field-help" style="display:block">${Ipon.escapeHtml(reason)}</small>` : ''}</td><td>${Ipon.dateLabel(entry.contribution_periods.period_month, { month: 'short', year: 'numeric' })}</td><td class="amount-cell">${Ipon.money(entry.amount)}</td><td>${statusBadge(entry.approval_status)}</td><td>${actionButtons(entry)}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-state">No additions recorded yet.</td></tr>';
    await syncSuggestedAmount();
  }

  function actionButtons(row) {
    if (state.profile.role !== 'ADMIN') return '';
    if (row.approval_status === 'PENDING') return `<div class="table-actions"><button class="icon-action" data-action="edit" data-id="${row.id}">Edit</button><button class="icon-action" data-action="confirm" data-id="${row.id}">Confirm</button><button class="icon-action" data-action="reject" data-id="${row.id}">Reject</button></div>`;
    if (row.approval_status === 'CONFIRMED') return `<button class="icon-action" data-action="void" data-id="${row.id}">Void</button>`;
    return '';
  }

  async function loadTransactions() {
    let query = Ipon.client.from(page).select('*', { count: 'exact' });
    if (statusFilter?.value) query = query.eq('approval_status', statusFilter.value);
    const { data, count, error } = await query.order('transaction_date', { ascending: false }).range(historyPage * pageSize, (historyPage + 1) * pageSize - 1);
    if (error) throw error;
    recordRows = data || [];
    updatePager(count);
    tbody.innerHTML = data.length ? data.map((row) => {
      const isCancelled = row.approval_status === 'VOIDED' || row.approval_status === 'REJECTED';
      const reason = row.void_reason || row.review_note;
      return `<tr class="${isCancelled ? 'row-voided' : ''}"><td>${Ipon.dateLabel(row.transaction_date)}</td><td>${Ipon.escapeHtml(row.category)}</td><td>${Ipon.escapeHtml(row.description)}${reason ? `<small class="field-help" style="display:block">${Ipon.escapeHtml(reason)}</small>` : ''}</td><td>${Ipon.escapeHtml(row.person_responsible)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${statusBadge(row.approval_status)}</td><td>${actionButtons(row)}</td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">No ${page} recorded yet.</td></tr>`;
  }

  async function load() {
    try {
      await loadMembers();
      if (page === 'contributions') await loadContributions();
      else await loadTransactions();
    } catch (error) {
      Ipon.showInlineError(tbody, error, load, page === 'contributions' ? 6 : 7);
      if (contributionEntriesBody) Ipon.showInlineError(contributionEntriesBody, error, load, 6);
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const amount = Number(values.get('amount'));
    if (!(amount > 0)) { Ipon.setFieldError(form.elements.amount, 'Enter an amount greater than zero.'); form.elements.amount.focus(); return; }
    if (state.profile.role === 'ADMIN') {
      const confirmed = await Ipon.confirmAction({ title: `Confirm ${page === 'contributions' ? 'addition' : page.slice(0, -1)}`, message: `${Ipon.money(amount)} will be immediately confirmed and included in tracked savings.`, acceptLabel: 'Confirm and save' });
      if (!confirmed) return;
    }
    pendingSubmissionKey ||= crypto.randomUUID();
    Ipon.setBusy(button, true);
    try {
      if (page === 'contributions') {
        await Ipon.rpc('record_contribution', {
          p_member_id: state.profile.role === 'MEMBER' ? state.profile.member_id : values.get('member_id'),
          p_contribution_month: `${values.get('contribution_month')}-01`,
          p_amount: amount, p_payment_date: values.get('payment_date'),
          p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey
        });
      } else {
        const ownResponsible = membersList.find((member) => member.id === state.profile.member_id)?.full_name || state.profile.full_name;
        await Ipon.rpc(page === 'withdrawals' ? 'record_withdrawal' : 'record_expense', {
          p_transaction_date: values.get('transaction_date'), p_amount: amount,
          p_category: values.get('category'), p_description: values.get('description'),
          p_person_responsible: state.profile.role === 'MEMBER' ? ownResponsible : values.get('person_responsible'),
          p_reference_number: values.get('reference_number') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey
        });
      }
      pendingSubmissionKey = null;
      Ipon.toast(state.profile.role === 'ADMIN' ? 'Confirmed record saved.' : 'Record submitted for admin review.');
      form.reset(); setDefaults(); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  form?.addEventListener('input', () => { pendingSubmissionKey = null; });

  async function handleRecordAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'edit') {
      const row = recordRows.find((item) => item.id === button.dataset.id); if (!row) return;
      populateResponsibleSelect(editForm.elements.person_responsible, row.person_responsible || '');
      editForm.elements.record_id.value = row.id; editForm.elements.date.value = row.payment_date || row.transaction_date; editForm.elements.amount.value = row.amount; editForm.elements.category.value = row.category || ''; editForm.elements.description.value = row.description || ''; editForm.elements.person_responsible.value = row.person_responsible || ''; editForm.elements.reference.value = row.transaction_reference || row.reference_number || ''; editForm.elements.notes.value = row.notes || '';
      editDialog.showModal(); editForm.elements.amount.focus(); return;
    }
    const review = await Ipon.requestRecordAction({ title: `${action[0].toUpperCase()}${action.slice(1)} record`, actions: [action.toUpperCase()] });
    if (!review) return;
    const note = review.note;
    try {
      const recordType = page === 'contributions' ? 'contribution' : page === 'withdrawals' ? 'withdrawal' : 'expense';
      if (action === 'void') await Ipon.rpc(`void_${recordType}`, { [`p_${recordType}_id`]: button.dataset.id, p_reason: note });
      else await Ipon.rpc(`review_${recordType}`, { [`p_${recordType}_id`]: button.dataset.id, p_decision: action === 'confirm' ? 'CONFIRMED' : 'REJECTED', p_review_note: note });
      Ipon.toast(`Record ${action}ed.`); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
  }
  document.getElementById('record-edit-close').addEventListener('click', () => editDialog.close());
  document.getElementById('record-edit-cancel').addEventListener('click', () => editDialog.close());
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault(); const values = new FormData(editForm); const button = event.submitter; Ipon.setBusy(button, true);
    try {
      if (page === 'contributions') await Ipon.rpc('update_contribution', { p_contribution_id: values.get('record_id'), p_amount: Number(values.get('amount')), p_payment_date: values.get('date'), p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null });
      else { const type = page === 'withdrawals' ? 'withdrawal' : 'expense'; await Ipon.rpc(`update_${type}`, { [`p_${type}_id`]: values.get('record_id'), p_transaction_date: values.get('date'), p_amount: Number(values.get('amount')), p_category: values.get('category'), p_description: values.get('description'), p_person_responsible: values.get('person_responsible'), p_reference_number: values.get('reference') || null, p_notes: values.get('notes') || null }); }
      editDialog.close(); Ipon.toast('Pending record updated.'); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  document.getElementById('member-id')?.addEventListener('change', syncSuggestedAmount);
  document.getElementById('contribution-month')?.addEventListener('change', syncSuggestedAmount);
  tbody.addEventListener('click', handleRecordAction);
  contributionEntriesBody?.addEventListener('click', handleRecordAction);
  statusFilter?.addEventListener('change', () => { historyPage = 0; load(); });
  pager?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    historyPage += button.dataset.page === 'next' ? 1 : -1;
    load();
  });

  try { await load(); } finally { Ipon.setLoading(false); }
})();
