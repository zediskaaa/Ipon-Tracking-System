(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['MEMBER'] });
  if (state.failed || !state.configured || !state.profile) return;
  const body = document.getElementById('user-history-body');
  const statusFilter = document.getElementById('user-history-status');
  const dialog = document.getElementById('contribution-dialog');
  const form = document.getElementById('user-contribution-form');
  function badge(status) { return `<span class="status status-${String(status).toLowerCase().replaceAll(' ', '-')}">${Ipon.escapeHtml(status)}</span>`; }

  async function load() {
    if (!state.profile.member_id) {
      document.getElementById('submit-contribution').disabled = true;
      document.getElementById('current-payment-status').textContent = 'ACCOUNT NOT LINKED';
      document.getElementById('current-payment-detail').textContent = 'Ask your group administrator to link this login to your member profile.';
      ['user-total', 'user-paid-months', 'user-unpaid-months', 'user-pending'].forEach((id, index) => { document.getElementById(id).textContent = index === 0 ? Ipon.money(0) : '0'; });
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No member profile is linked to this account.</td></tr>';
      return;
    }
    const [summaryResult, historyResult] = await Promise.all([
      Ipon.client.rpc('get_user_dashboard'),
      (() => { let query = Ipon.client.from('contributions').select('id,amount,payment_date,approval_status,review_note,void_reason,contribution_periods!inner(period_month,member_id)').eq('contribution_periods.member_id', state.profile.member_id).order('payment_date', { ascending: false }); if (statusFilter.value) query = query.eq('approval_status', statusFilter.value); return query.limit(100); })()
    ]);
    if (summaryResult.error) throw summaryResult.error;
    if (historyResult.error) throw historyResult.error;
    const summary = summaryResult.data || {};
    document.getElementById('user-total').textContent = Ipon.money(summary.total_contributed);
    document.getElementById('user-paid-months').textContent = summary.months_paid || 0;
    document.getElementById('user-unpaid-months').textContent = summary.months_unpaid || 0;
    document.getElementById('user-pending').textContent = summary.pending_submissions || 0;
    const period = summary.current_period;
    document.getElementById('current-payment-status').innerHTML = period ? badge(period.payment_status) : badge('NOT SCHEDULED');
    document.getElementById('current-payment-detail').textContent = period ? `${Ipon.money(period.paid_amount)} of ${Ipon.money(period.required_amount)} confirmed. Due ${Ipon.dateLabel(period.due_date)}.` : 'Your administrator has not generated this month’s period yet.';
    const rows = historyResult.data || [];
    body.innerHTML = rows.length ? rows.map((row) => `<tr><td>${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.dateLabel(row.payment_date)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${badge(row.approval_status)}</td><td>${Ipon.escapeHtml(row.review_note || row.void_reason || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No contribution records match this filter.</td></tr>';
  }

  async function refresh() {
    const { data, error } = await Ipon.client.from('profiles').select('member_id').eq('id', state.profile.id).single();
    if (error) throw error;
    state.profile.member_id = data.member_id;
    document.getElementById('submit-contribution').disabled = !data.member_id;
    await load();
  }

  document.getElementById('submit-contribution').addEventListener('click', () => { form.reset(); form.elements.contribution_month.value = Ipon.monthStart().slice(0, 7); form.elements.payment_date.value = Ipon.isoDate(); dialog.showModal(); form.elements.amount.focus(); });
  document.getElementById('close-contribution-dialog').addEventListener('click', () => dialog.close());
  document.getElementById('cancel-contribution').addEventListener('click', () => dialog.close());
  statusFilter.addEventListener('change', () => load().catch((error) => Ipon.showInlineError(body, error, load, 5)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const values = new FormData(form);
    Ipon.setBusy(button, true, 'Submitting…');
    try { await Ipon.rpc('record_contribution', { p_member_id: state.profile.member_id, p_contribution_month: `${values.get('contribution_month')}-01`, p_amount: Number(values.get('amount')), p_payment_date: values.get('payment_date'), p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null, p_idempotency_key: crypto.randomUUID() }); dialog.close(); Ipon.toast('Contribution submitted for review.'); await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  try { await refresh(); } catch (error) { Ipon.showInlineError(body, error, refresh, 5); }
  Ipon.subscribeToChanges('member-dashboard', ['profiles', 'contribution_periods', 'contributions'], refresh);
})();
