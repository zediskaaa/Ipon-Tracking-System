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
  let historyRowsById = new Map();
  function badge(status) { return `<span class="status status-${String(status).toLowerCase().replaceAll(' ', '-')}">${Ipon.escapeHtml(status)}</span>`; }

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
      body.innerHTML = '<tr><td colspan="6" class="empty-state">No member profile is linked to this account.</td></tr>';
      return;
    }
    const [summaryResult, historyResult, paymentInfo] = await Promise.all([
      Ipon.client.rpc('get_user_dashboard'),
      (() => { let query = Ipon.client.from('contributions').select('id,amount,payment_date,approval_status,review_note,void_reason,receipt_url,contribution_periods!inner(period_month,member_id)').eq('contribution_periods.member_id', state.profile.member_id).order('payment_date', { ascending: false }); if (statusFilter.value) query = query.eq('approval_status', statusFilter.value); return query.limit(100); })(),
      Ipon.rpc('get_group_payment_info').catch(() => null)
    ]);
    if (summaryResult.error) throw summaryResult.error;
    if (historyResult.error) throw historyResult.error;
    renderPaymentCard(paymentInfo);
    const summary = summaryResult.data || {};
    document.getElementById('user-total').textContent = Ipon.money(summary.total_contributed);
    document.getElementById('user-paid-months').textContent = summary.months_paid || 0;
    document.getElementById('user-unpaid-months').textContent = summary.months_unpaid || 0;
    document.getElementById('user-pending').textContent = summary.pending_submissions || 0;
    const period = summary.current_period;
    document.getElementById('current-payment-status').innerHTML = period ? badge(period.payment_status) : badge('NOT SCHEDULED');
    document.getElementById('current-payment-detail').textContent = period ? `${Ipon.money(period.paid_amount)} of ${Ipon.money(period.required_amount)} confirmed. Due ${Ipon.dateLabel(period.due_date)}.` : 'Your administrator has not generated this month’s period yet.';
    const rows = historyResult.data || [];
    historyRowsById = new Map(rows.map((row) => [row.id, row]));
    body.innerHTML = rows.length ? rows.map((row) => `<tr><td>${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.dateLabel(row.payment_date)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${badge(row.approval_status)}</td><td>${row.receipt_url ? `<button class="icon-action receipt-pill-btn" type="button" data-view-receipt="${row.id}">View receipt</button>` : '<span class="field-help">—</span>'}</td><td>${Ipon.escapeHtml(row.review_note || row.void_reason || '—')}</td></tr>`).join('') : '<tr><td colspan="6" class="empty-state">No contribution records match this filter.</td></tr>';
  }

  async function refresh() {
    const { data, error } = await Ipon.client.from('profiles').select('member_id').eq('id', state.profile.id).single();
    if (error) throw error;
    state.profile.member_id = data.member_id;
    document.getElementById('submit-contribution').disabled = !data.member_id;
    await load();
  }

  document.getElementById('submit-contribution').addEventListener('click', () => { form.reset(); receiptPicker.clear(); form.elements.contribution_month.value = Ipon.monthStart().slice(0, 7); form.elements.payment_date.value = Ipon.isoDate(); dialog.showModal(); form.elements.amount.focus(); });
  document.getElementById('close-contribution-dialog').addEventListener('click', () => dialog.close());
  document.getElementById('cancel-contribution').addEventListener('click', () => dialog.close());
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
    const btn = event.target.closest('[data-view-receipt]');
    if (!btn) return;
    const row = historyRowsById.get(btn.dataset.viewReceipt);
    if (row?.receipt_url) Ipon.openImageViewer(row.receipt_url, 'Contribution receipt', `${Ipon.money(row.amount)} · ${Ipon.dateLabel(row.payment_date)}`);
  });
  statusFilter.addEventListener('change', () => load().catch((error) => Ipon.showInlineError(body, error, load, 6)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const values = new FormData(form);
    Ipon.setBusy(button, true, 'Submitting…');
    try { await Ipon.rpc('record_contribution', { p_member_id: state.profile.member_id, p_contribution_month: `${values.get('contribution_month')}-01`, p_amount: Number(values.get('amount')), p_payment_date: values.get('payment_date'), p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null, p_idempotency_key: crypto.randomUUID(), p_receipt_url: receiptPicker.get() }); receiptPicker.clear(); dialog.close(); Ipon.toast('Contribution submitted for review.'); await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  try { await refresh(); } catch (error) { Ipon.showInlineError(body, error, refresh, 6); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('member-dashboard', ['profiles', 'members', 'contribution_periods', 'contributions'], refresh);
})();
