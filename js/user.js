(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['MEMBER'] });
  if (state.failed || !state.configured || !state.profile) return;
  const body = document.getElementById('user-history-body');
  const statusFilter = document.getElementById('user-history-status');
  const dialog = document.getElementById('contribution-dialog');
  const form = document.getElementById('user-contribution-form');
  const paymentCard = document.getElementById('member-payment-card');
  const paymentQrBtn = document.getElementById('member-payment-qr-btn');
  const paymentQrImg = document.getElementById('member-payment-qr-img');
  const paymentChannelEl = document.getElementById('member-payment-channel');
  const paymentDetailsEl = document.getElementById('member-payment-details');
  const paymentNotesEl = document.getElementById('member-payment-instructions');
  const receiptPicker = Ipon.bindReceiptPicker({
    input: document.getElementById('user-receipt-input'),
    dropzone: document.getElementById('user-receipt-dropzone'),
    emptyBox: document.getElementById('user-receipt-empty'),
    preview: document.getElementById('user-receipt-preview'),
    thumb: document.getElementById('user-receipt-thumb'),
    nameEl: document.getElementById('user-receipt-name'),
    clearBtn: document.getElementById('user-receipt-clear')
  });
  let groupPaymentInfo = null;
  let ownMonthlyAmount = 0;
  const statusRowsByMonth = new Map();
  let historyRowsById = new Map();
  let commentCounts = new Map();
  const pageSize = 25;
  let historyPage = 0;
  const pager = document.getElementById('user-history-pager');
  const streakEl = document.getElementById('user-streak');
  const exportStatementBtn = document.getElementById('user-export-statement');
  const printStatementBtn = document.getElementById('user-print-statement');

  async function resolveOwnMonthStatus(monthValue) {
    if (!state.profile.member_id || !monthValue) return { statusRow: null, fallbackMonthlyAmount: ownMonthlyAmount };
    const periodMonth = `${monthValue}-01`;
    let statusRow = statusRowsByMonth.get(periodMonth);
    if (statusRow === undefined) {
      const { data, error } = await Ipon.client
        .from('v_contribution_status')
        .select('member_id,period_month,required_amount,paid_amount,outstanding_amount,payment_status,is_exempt')
        .eq('member_id', state.profile.member_id)
        .eq('period_month', periodMonth)
        .maybeSingle();
      statusRow = !error && data ? data : null;
      statusRowsByMonth.set(periodMonth, statusRow);
    }
    return { statusRow, fallbackMonthlyAmount: ownMonthlyAmount };
  }

  const syncUserExcessToggle = Ipon.bindExcessContributionToggle({
    amountInput: form?.elements.amount,
    checkbox: document.getElementById('user-allocate-excess'),
    field: document.getElementById('user-allocate-excess-field'),
    getContext: () => resolveOwnMonthStatus(form?.elements.contribution_month?.value)
  });
  form?.elements.contribution_month?.addEventListener('change', () => { syncUserExcessToggle().catch(() => {}); });
  function badge(status) { return `<span class="status status-${String(status).toLowerCase().replaceAll(' ', '-')}">${Ipon.escapeHtml(status)}</span>`; }

  function updatePager(count = 0) {
    if (!pager) return;
    const pages = Math.max(1, Math.ceil(count / pageSize));
    historyPage = Math.min(historyPage, pages - 1);
    pager.querySelector('span').textContent = `Page ${historyPage + 1} of ${pages} · ${count} record${count === 1 ? '' : 's'}`;
    pager.querySelector('[data-page="previous"]').disabled = historyPage === 0;
    pager.querySelector('[data-page="next"]').disabled = historyPage >= pages - 1;
  }

  function renderOwnPayoutStrip(record) {
    const strip = document.getElementById('user-payout-strip');
    if (!strip) return;
    strip.hidden = false;
    const chipHtml = Ipon.payoutSummaryChip(record, { compact: true, showCopy: false });
    if (chipHtml) {
      strip.innerHTML = `<span class="user-payout-label">Cashout account</span>${chipHtml}<button type="button" class="link-action" data-open-payout-profile>Edit</button>`;
    } else {
      strip.innerHTML = `<span class="user-payout-label">Cashout account</span><span class="field-help">Not set</span><button type="button" class="link-action" data-open-payout-profile>Add GCash, Maya, or bank</button>`;
    }
  }

  function renderPaymentCard(info) {
    groupPaymentInfo = info || null;
    if (!paymentCard) return;
    const hasContent = Boolean(info && (info.payment_qr_url || info.payment_method_label || info.payment_account_name || info.payment_account_number || info.payment_instructions));
    paymentCard.hidden = !hasContent;
    if (!hasContent) return;
    if (info.payment_qr_url) {
      paymentQrImg.src = info.payment_qr_url;
      paymentQrBtn.hidden = false;
    } else {
      paymentQrBtn.hidden = true;
    }
    paymentChannelEl.textContent = info.payment_method_label || 'Group payment channel';
    const items = [];
    if (info.payment_account_name) items.push(`<div><dt>Account name</dt><dd>${Ipon.escapeHtml(info.payment_account_name)}</dd></div>`);
    if (info.payment_account_number) {
      items.push(`<div><dt>Account / mobile no.</dt><dd class="copyable-dd"><span>${Ipon.escapeHtml(info.payment_account_number)}</span><button class="icon-action" type="button" data-copy-account="${Ipon.escapeHtml(info.payment_account_number)}">Copy</button></dd></div>`);
    }
    paymentDetailsEl.innerHTML = items.join('');
    paymentNotesEl.textContent = info.payment_instructions || '';
    paymentNotesEl.hidden = !info.payment_instructions;
  }

  async function load() {
    if (!state.profile.member_id) {
      document.getElementById('submit-contribution').disabled = true;
      document.getElementById('current-payment-status').textContent = 'ACCOUNT NOT LINKED';
      document.getElementById('current-payment-detail').textContent = 'Ask your group administrator to link this login to your member profile.';
      ['user-total', 'user-paid-months', 'user-unpaid-months', 'user-pending'].forEach((id, index) => { document.getElementById(id).textContent = index === 0 ? Ipon.money(0) : '0'; });
      body.innerHTML = '<tr><td colspan="7" class="empty-state">No member profile is linked to this account.</td></tr>';
      return;
    }
    const [summaryResult, historyResult, paymentInfo, ownMemberResult] = await Promise.all([
      Ipon.client.rpc('get_user_dashboard'),
      (() => { let query = Ipon.client.from('contributions').select('id,amount,payment_date,transaction_reference,payment_method,notes,approval_status,review_note,void_reason,receipt_url,contribution_periods!inner(period_month,member_id)', { count: 'exact' }).eq('contribution_periods.member_id', state.profile.member_id).order('payment_date', { ascending: false }); if (statusFilter.value) query = query.eq('approval_status', statusFilter.value); return query.range(historyPage * pageSize, (historyPage + 1) * pageSize - 1); })(),
      Ipon.rpc('get_group_payment_info').catch(() => null),
      Ipon.client.from('members').select('monthly_contribution_amount,payout_channel,payout_account_number,payout_account_name').eq('id', state.profile.member_id).maybeSingle()
    ]);
    if (summaryResult.error) throw summaryResult.error;
    if (historyResult.error) throw historyResult.error;
    ownMonthlyAmount = Number(ownMemberResult?.data?.monthly_contribution_amount || 0);
    statusRowsByMonth.clear();
    renderPaymentCard(paymentInfo);
    renderOwnPayoutStrip(ownMemberResult?.data || state.profile);
    const summary = summaryResult.data || {};
    document.getElementById('user-total').textContent = Ipon.money(summary.total_contributed);
    document.getElementById('user-paid-months').textContent = summary.months_paid || 0;
    document.getElementById('user-unpaid-months').textContent = summary.months_unpaid || 0;
    document.getElementById('user-pending').textContent = summary.pending_submissions || 0;
    if (streakEl) {
      const paidStreak = Number(summary.payment_streak || 0);
      const onTimeStreak = Number(summary.on_time_streak || 0);
      if (paidStreak > 0) {
        streakEl.hidden = false;
        streakEl.textContent = onTimeStreak >= paidStreak && onTimeStreak > 0
          ? `${onTimeStreak}-month on-time streak`
          : `${paidStreak}-month payment streak`;
      } else {
        streakEl.hidden = true;
      }
    }
    const period = summary.current_period;
    document.getElementById('current-payment-status').innerHTML = period ? badge(period.payment_status) : badge('NOT SCHEDULED');
    document.getElementById('current-payment-detail').textContent = period
      ? (period.is_exempt
        ? `This month is marked exempt${period.exempt_reason ? `: ${period.exempt_reason}` : '.'}`
        : `${Ipon.money(period.paid_amount)} of ${Ipon.money(period.required_amount)} confirmed. Due ${Ipon.dateLabel(period.due_date)}.`)
      : 'Your administrator has not generated this month’s period yet.';
    const rows = historyResult.data || [];
    updatePager(historyResult.count || 0);
    historyRowsById = new Map(rows.map((row) => [row.id, row]));
    commentCounts = await Ipon.getRecordCommentCounts('contribution', rows.map((row) => row.id));
    body.innerHTML = rows.length ? rows.map((row) => {
      const noteText = row.review_note || row.void_reason || '—';
      const discussBtn = Ipon.recordDiscussionButtonHtml(row, commentCounts.get(row.id) || 0);
      const resubmitBtn = row.approval_status === 'REJECTED'
        ? ` <button class="icon-action" type="button" data-resubmit="${row.id}">Resubmit</button>`
        : '';
      return `<tr><td>${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.dateLabel(row.payment_date)}</td><td>${Ipon.paymentMethodBadge(row.payment_method)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${badge(row.approval_status)}</td><td>${row.receipt_url ? `<button class="icon-action receipt-pill-btn" type="button" data-view-receipt="${row.id}">View receipt</button>` : '<span class="field-help">—</span>'}</td><td><div class="user-note-actions"><span>${Ipon.escapeHtml(noteText)}</span>${discussBtn ? ` ${discussBtn}` : ''}${resubmitBtn}</div></td></tr>`;
    }).join('') : '<tr><td colspan="7" class="empty-state">No contribution records match this filter.</td></tr>';
  }

  async function refresh() {
    const { data, error } = await Ipon.client.from('profiles').select('group_id,member_id').eq('id', state.profile.id).single();
    if (error) throw error;
    state.profile.group_id = data.group_id;
    state.profile.member_id = data.member_id;
    await load();
  }

  document.getElementById('submit-contribution').addEventListener('click', () => {
    if (!state.profile.group_id || !state.profile.member_id) {
      Ipon.showGroupRequiredDialog({ hasGroup: Boolean(state.profile.group_id) });
      return;
    }
    form.reset(); receiptPicker.clear(); form.elements.contribution_month.value = Ipon.monthStart().slice(0, 7); form.elements.payment_date.value = Ipon.isoDate();
    Ipon.setPaymentMethod(form, Ipon.guessPaymentMethodFromLabel(groupPaymentInfo?.payment_method_label, 'CASH'));
    syncUserExcessToggle().catch(() => {});
    dialog.showModal(); form.elements.amount.focus();
  });
  document.getElementById('close-contribution-dialog').addEventListener('click', () => dialog.close());
  document.getElementById('cancel-contribution').addEventListener('click', () => dialog.close());
  document.getElementById('user-payout-strip')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-payout-profile]')) {
      Ipon.openAccountDialog();
    }
  });
  window.addEventListener('ipon:profile-updated', (event) => {
    renderOwnPayoutStrip(event.detail || state.profile);
  });
  paymentQrBtn?.addEventListener('click', () => {
    if (groupPaymentInfo?.payment_qr_url) Ipon.openImageViewer(groupPaymentInfo.payment_qr_url, groupPaymentInfo.payment_method_label || 'Group payment QR', groupPaymentInfo.payment_account_name || '');
  });
  paymentDetailsEl?.addEventListener('click', async (event) => {
    const btn = event.target.closest('[data-copy-account]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copyAccount || ''); Ipon.toast('Account number copied.'); }
    catch { Ipon.toast('Unable to copy automatically.', 'error'); }
  });
  body.addEventListener('click', (event) => {
    const discussBtn = event.target.closest('[data-action="discuss"]');
    if (discussBtn) {
      Ipon.openRecordDiscussion('contribution', discussBtn.dataset.id, { onUpdated: () => load() });
      return;
    }
    const receiptBtn = event.target.closest('[data-view-receipt]');
    if (receiptBtn) {
      const row = historyRowsById.get(receiptBtn.dataset.viewReceipt);
      if (row?.receipt_url) Ipon.openImageViewer(row.receipt_url, 'Contribution receipt', `${Ipon.money(row.amount)} · ${Ipon.dateLabel(row.payment_date)}`);
      return;
    }
    const resubmitBtn = event.target.closest('[data-resubmit]');
    if (resubmitBtn) {
      const row = historyRowsById.get(resubmitBtn.dataset.resubmit);
      if (!row) return;
      form.reset();
      receiptPicker.clear();
      form.elements.contribution_month.value = String(row.contribution_periods?.period_month || Ipon.monthStart()).slice(0, 7);
      form.elements.payment_date.value = Ipon.isoDate();
      form.elements.amount.value = Number(row.amount || 0).toFixed(2);
      form.elements.reference.value = row.transaction_reference || '';
      form.elements.notes.value = row.notes || '';
      Ipon.setPaymentMethod(form, row.payment_method || Ipon.guessPaymentMethodFromLabel(groupPaymentInfo?.payment_method_label, 'CASH'));
      syncUserExcessToggle().catch(() => {});
      dialog.showModal();
      form.elements.amount.focus();
    }
  });
  statusFilter.addEventListener('change', () => { historyPage = 0; load().catch((error) => Ipon.showInlineError(body, error, load, 7)); });
  pager?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    historyPage += button.dataset.page === 'next' ? 1 : -1;
    load().catch((error) => Ipon.showInlineError(body, error, load, 7));
  });
  printStatementBtn?.addEventListener('click', () => window.print());
  exportStatementBtn?.addEventListener('click', async () => {
    if (!state.profile.member_id) return;
    Ipon.setBusy(exportStatementBtn, true, 'Exporting…');
    try {
      let query = Ipon.client.from('contributions')
        .select('payment_date,amount,transaction_reference,payment_method,notes,approval_status,review_note,void_reason,contribution_periods!inner(period_month,member_id)')
        .eq('contribution_periods.member_id', state.profile.member_id)
        .order('payment_date', { ascending: false });
      if (statusFilter.value) query = query.eq('approval_status', statusFilter.value);
      const { data, error } = await query;
      if (error) throw error;
      const csvRows = (data || []).map((row) => [
        String(row.contribution_periods?.period_month || '').slice(0, 7),
        row.payment_date,
        Ipon.paymentMethodMeta(row.payment_method).label,
        row.amount,
        row.approval_status,
        row.transaction_reference || '',
        row.notes || '',
        row.review_note || row.void_reason || ''
      ]);
      const csv = [['For month', 'Date contributed', 'Payment method', 'Amount', 'Status', 'Reference', 'Notes', 'Review / void note'], ...csvRows]
        .map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','))
        .join('\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      link.download = `my-ipon-statement-${Ipon.isoDate()}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(exportStatementBtn, false);
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.profile.group_id || !state.profile.member_id) {
      dialog.close();
      Ipon.showGroupRequiredDialog({ hasGroup: Boolean(state.profile.group_id) });
      return;
    }
    if (form.elements.reference && !Ipon.validateNumericInput(form.elements.reference)) {
      form.elements.reference.focus();
      return;
    }
    const button = event.submitter;
    const values = new FormData(form);
    const amount = Number(values.get('amount'));
    if (!(amount > 0)) { Ipon.setFieldError(form.elements.amount, 'Enter an amount greater than zero.'); form.elements.amount.focus(); return; }
    const allocateExcess = Boolean(form.elements.allocate_excess?.checked);
    const confirmed = await Ipon.confirmAction({
      title: 'Submit contribution?',
      message: allocateExcess
        ? `Submit ${Ipon.money(amount)} and carry excess over to upcoming unpaid months once confirmed?`
        : `Submit ${Ipon.money(amount)} for administrator review? It will count toward group totals once confirmed.`,
      acceptLabel: 'Submit contribution'
    });
    if (!confirmed) return;
    Ipon.setBusy(button, true, 'Submitting…');
    try {
      const result = await Ipon.rpc(allocateExcess ? 'record_contribution_with_carryover' : 'record_contribution', {
        p_member_id: state.profile.member_id,
        p_contribution_month: `${values.get('contribution_month')}-01`,
        p_amount: amount,
        p_payment_date: values.get('payment_date'),
        p_transaction_reference: values.get('reference') || null,
        p_notes: values.get('notes') || null,
        p_idempotency_key: crypto.randomUUID(),
        p_receipt_url: receiptPicker.get(),
        p_payment_method: values.get('payment_method') || 'CASH',
        ...(allocateExcess ? { p_allocate_excess: true } : {})
      });
      receiptPicker.clear();
      dialog.close();
      const monthsCovered = Number(result?.months_covered || 1);
      Ipon.toast(allocateExcess && monthsCovered > 1 ? `Contribution split across ${monthsCovered} months for review.` : 'Contribution submitted for review.');
      await load();
    }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  function openRequestedThreadFromUrl() {
    const raw = new URLSearchParams(window.location.search).get('thread') || '';
    const [type, id] = raw.split(':');
    if (type && id && ['contribution', 'withdrawal', 'expense'].includes(type)) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('thread');
      window.history.replaceState(null, '', cleanUrl.toString());
      Ipon.openRecordDiscussion(type, id, { onUpdated: () => load() });
    }
  }

  try { await refresh(); openRequestedThreadFromUrl(); } catch (error) { Ipon.showInlineError(body, error, refresh, 7); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('member-dashboard', ['profiles', 'members', 'contribution_periods', 'contributions', 'groups', 'savings_goals', 'record_comments'], refresh);
})();
