(async function () {
  'use strict';
  const page = document.body.dataset.page;
  const form = document.getElementById('record-form');
  const tbody = document.getElementById('records-body');
  const contributionEntriesBody = document.getElementById('contribution-entries-body');
  const state = await Ipon.init();
  if (state.failed) return;
  if (!state.configured || !state.profile) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Connect Supabase to load records.</td></tr>`;
    setDefaults();
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

  function statusBadge(status) {
    const statusClass = String(status).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<span class="status status-${statusClass}">${Ipon.escapeHtml(status)}</span>`;
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

  async function loadMembers() {
    const select = document.getElementById('member-id');
    if (!select) return;
    const currentSelection = select.value;
    const { data, error } = await Ipon.client.from('members').select('id,full_name,monthly_contribution_amount').eq('status', 'ACTIVE').order('full_name');
    if (error) throw error;
    membersList = data || [];
    const selectedId = currentSelection || state.profile.member_id || '';
    select.innerHTML = membersList.length
      ? `<option value="">Select member</option>${membersList.map((member) => `<option value="${member.id}" ${selectedId === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}`
      : '<option value="">No active member profile found</option>';
    if (state.profile.role === 'MEMBER') select.setAttribute('aria-readonly', 'true');
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
      month.addEventListener('change', loadContributions);
    }
    statusRowsByMonth.clear();
    const { data, error } = await Ipon.client.from('v_contribution_status').select('*').eq('period_month', month.value).order('member_name');
    if (error) throw error;
    (data || []).forEach((row) => {
      statusRowsByMonth.set(`${row.member_id}:${row.period_month}`, row);
    });
    tbody.innerHTML = data.length ? data.map((row) => `<tr><td>${Ipon.escapeHtml(row.member_name)}</td><td>${Ipon.dateLabel(row.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.required_amount)}</td><td>${Ipon.money(row.paid_amount)}</td><td>${Ipon.money(row.outstanding_amount)}</td><td>${statusBadge(row.payment_status)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No contribution periods for this month.</td></tr>';

    const { data: entries, error: entriesError } = await Ipon.client.from('contributions')
      .select('id,amount,payment_date,approval_status,void_reason,review_note,contribution_periods!inner(period_month,members!inner(full_name))')
      .order('payment_date', { ascending: false }).limit(200);
    if (entriesError) throw entriesError;
    contributionEntriesBody.innerHTML = entries.length ? entries.map((entry) => {
      const isCancelled = entry.approval_status === 'VOIDED' || entry.approval_status === 'REJECTED';
      const reason = entry.void_reason || entry.review_note;
      return `<tr class="${isCancelled ? 'row-voided' : ''}"><td>${Ipon.dateLabel(entry.payment_date)}</td><td>${Ipon.escapeHtml(entry.contribution_periods.members.full_name)}${reason ? `<small class="field-help" style="display:block">${Ipon.escapeHtml(reason)}</small>` : ''}</td><td>${Ipon.dateLabel(entry.contribution_periods.period_month, { month: 'short', year: 'numeric' })}</td><td class="amount-cell">${Ipon.money(entry.amount)}</td><td>${statusBadge(entry.approval_status)}</td><td>${actionButtons(entry)}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-state">No additions recorded yet.</td></tr>';
    await syncSuggestedAmount();
  }

  function actionButtons(row) {
    if (state.profile.role !== 'ADMIN') return '';
    if (row.approval_status === 'PENDING') return `<div class="table-actions"><button class="icon-action" data-action="confirm" data-id="${row.id}">Confirm</button><button class="icon-action" data-action="reject" data-id="${row.id}">Reject</button></div>`;
    if (row.approval_status === 'CONFIRMED') return `<button class="icon-action" data-action="void" data-id="${row.id}">Void</button>`;
    return '';
  }

  async function loadTransactions() {
    const { data, error } = await Ipon.client.from(page).select('*').order('transaction_date', { ascending: false }).limit(200);
    if (error) throw error;
    tbody.innerHTML = data.length ? data.map((row) => {
      const isCancelled = row.approval_status === 'VOIDED' || row.approval_status === 'REJECTED';
      const reason = row.void_reason || row.review_note;
      return `<tr class="${isCancelled ? 'row-voided' : ''}"><td>${Ipon.dateLabel(row.transaction_date)}</td><td>${Ipon.escapeHtml(row.category)}</td><td>${Ipon.escapeHtml(row.description)}${reason ? `<small class="field-help" style="display:block">${Ipon.escapeHtml(reason)}</small>` : ''}</td><td>${Ipon.escapeHtml(row.person_responsible)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${statusBadge(row.approval_status)}</td><td>${actionButtons(row)}</td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">No ${page} recorded yet.</td></tr>`;
  }

  async function load() {
    try {
      if (page === 'contributions') { await loadMembers(); await loadContributions(); }
      else await loadTransactions();
    } catch (error) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>`;
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const amount = Number(values.get('amount'));
    if (!(amount > 0)) return Ipon.toast('Enter an amount greater than zero.', 'error');
    if (state.profile.role === 'ADMIN') {
      const confirmed = await Ipon.confirmAction({ title: `Confirm ${page === 'contributions' ? 'addition' : page.slice(0, -1)}`, message: `${Ipon.money(amount)} will be immediately confirmed and included in tracked savings.`, acceptLabel: 'Confirm and save' });
      if (!confirmed) return;
    }
    pendingSubmissionKey ||= crypto.randomUUID();
    Ipon.setBusy(button, true);
    try {
      if (page === 'contributions') {
        await Ipon.rpc('record_contribution', {
          p_member_id: values.get('member_id'), p_contribution_month: `${values.get('contribution_month')}-01`,
          p_amount: amount, p_payment_date: values.get('payment_date'),
          p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey
        });
      } else {
        await Ipon.rpc(page === 'withdrawals' ? 'record_withdrawal' : 'record_expense', {
          p_transaction_date: values.get('transaction_date'), p_amount: amount,
          p_category: values.get('category'), p_description: values.get('description'),
          p_person_responsible: values.get('person_responsible'),
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
    let note = null;
    if (action === 'reject') { note = window.prompt('Reason for rejection:'); if (!note?.trim()) return; }
    if (action === 'void') { note = window.prompt('Reason for voiding this confirmed record:'); if (!note?.trim()) return; }
    const accepted = await Ipon.confirmAction({ title: `${action[0].toUpperCase()}${action.slice(1)} record?`, message: action === 'confirm' ? 'This amount will affect tracked savings.' : 'The audit log will preserve this action.', acceptLabel: action === 'confirm' ? 'Confirm' : action === 'reject' ? 'Reject' : 'Void' });
    if (!accepted) return;
    try {
      const recordType = page === 'contributions' ? 'contribution' : page === 'withdrawals' ? 'withdrawal' : 'expense';
      if (action === 'void') await Ipon.rpc(`void_${recordType}`, { [`p_${recordType}_id`]: button.dataset.id, p_reason: note });
      else await Ipon.rpc(`review_${recordType}`, { [`p_${recordType}_id`]: button.dataset.id, p_decision: action === 'confirm' ? 'CONFIRMED' : 'REJECTED', p_review_note: note });
      Ipon.toast(`Record ${action}ed.`); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
  }
  document.getElementById('member-id')?.addEventListener('change', syncSuggestedAmount);
  document.getElementById('contribution-month')?.addEventListener('change', syncSuggestedAmount);
  tbody.addEventListener('click', handleRecordAction);
  contributionEntriesBody?.addEventListener('click', handleRecordAction);

  await load();
})();
