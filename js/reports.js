(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER'] });
  if (state.failed || !state.configured || !state.profile) return;
  const monthlyBody = document.getElementById('reports-body');
  const memberBody = document.getElementById('member-report-body');
  const yearFilter = document.getElementById('report-year');
  const monthFilter = document.getElementById('member-report-month');
  const statusFilter = document.getElementById('member-report-status');
  let monthlyRows = [], memberRows = [], chart;

  function renderMonthly() {
    yearFilter.closest('.panel-header')?.setAttribute('data-print-meta', `Year: ${yearFilter.value}`);
    const rows = monthlyRows.filter((row) => row.month.startsWith(yearFilter.value));
    monthlyBody.innerHTML = rows.length ? rows.map((row) => `<tr><td>${Ipon.dateLabel(row.month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.total_additions)}</td><td>${Ipon.money(row.total_deductions)}</td><td>${Ipon.money(row.total_expenses)}</td><td>${Ipon.money(row.net_change)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No confirmed activity for this year.</td></tr>';
    chart?.destroy();
    const chartCanvas = document.getElementById('monthly-chart');
    const chartEmpty = document.getElementById('monthly-chart-empty');
    if (chartCanvas) chartCanvas.hidden = !rows.length;
    if (chartEmpty) chartEmpty.hidden = Boolean(rows.length);
    const baselineMax = Math.max(1000, memberRows.reduce((sum, row) => sum + (Number(row.required_amount) || 0), 0));
    if (rows.length && window.Chart) chart = new Chart(chartCanvas, { type: 'bar', data: { labels: rows.map((row) => Ipon.dateLabel(row.month, { month: 'short' })), datasets: [{ label: 'Additions', data: rows.map((row) => row.total_additions), backgroundColor: '#287a4c', maxBarThickness: 42 }, { label: 'Deductions + expenses', data: rows.map((row) => Number(row.total_deductions) + Number(row.total_expenses)), backgroundColor: '#ae3934', maxBarThickness: 42 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, suggestedMax: baselineMax, ticks: { maxTicksLimit: 6, precision: 0, callback: (value) => `₱${Number(value).toLocaleString('en-PH')}` } } } } });
  }

  async function loadMembers() {
    const monthText = monthFilter.value ? Ipon.dateLabel(`${monthFilter.value}-01`, { month: 'long', year: 'numeric' }) : '';
    const statusText = statusFilter.options[statusFilter.selectedIndex]?.text || 'All statuses';
    monthFilter.closest('.panel-header')?.setAttribute('data-print-meta', [monthText, statusText].filter(Boolean).join(' · '));
    let query = Ipon.client.from('v_contribution_status').select('*').eq('period_month', `${monthFilter.value}-01`).order('member_name');
    if (statusFilter.value) query = query.eq('payment_status', statusFilter.value);
    const { data, error } = await query; if (error) throw error; memberRows = data || [];
    memberBody.innerHTML = memberRows.length ? memberRows.map((row) => `<tr><td>${Ipon.escapeHtml(row.member_name)}</td><td>${Ipon.money(row.required_amount)}</td><td>${Ipon.money(row.paid_amount)}</td><td>${Ipon.money(row.outstanding_amount)}</td><td><span class="status status-${row.payment_status.toLowerCase().replaceAll(' ', '-')}">${Ipon.escapeHtml(row.payment_status)}</span></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No member periods match this report.</td></tr>';
  }

  async function load() {
    const selectedYear = yearFilter.value;
    const selectedMonth = monthFilter.value;
    const [{ data: summary, error: summaryError }, { data, error }] = await Promise.all([Ipon.client.rpc('get_savings_summary'), Ipon.client.from('v_monthly_financial_summary').select('*').order('month')]);
    if (summaryError) throw summaryError; if (error) throw error;
    ['additions', 'deductions', 'expenses'].forEach((key) => { document.getElementById(`report-${key}`).textContent = Ipon.money(summary?.[`total_${key}`]); });
    document.getElementById('report-tracked').textContent = Ipon.money(summary?.tracked_savings); monthlyRows = data || [];
    const years = [...new Set([String(new Date().getFullYear()), ...monthlyRows.map((row) => row.month.slice(0, 4))])].sort().reverse();
    yearFilter.innerHTML = years.map((year) => `<option>${year}</option>`).join('');
    yearFilter.value = years.includes(selectedYear) ? selectedYear : years[0];
    monthFilter.value = selectedMonth || Ipon.monthStart().slice(0, 7);
    await loadMembers(); renderMonthly();
  }

  yearFilter.addEventListener('change', renderMonthly);
  [monthFilter, statusFilter].forEach((filter) => filter.addEventListener('change', () => loadMembers().catch((error) => Ipon.showInlineError(memberBody, error, loadMembers, 5))));
  window.addEventListener('beforeprint', () => chart?.resize(720, 120));
  window.addEventListener('afterprint', () => chart?.resize());
  document.getElementById('print-report').addEventListener('click', () => { chart?.resize(720, 120); window.print(); setTimeout(() => chart?.resize(), 300); });
  document.getElementById('export-csv').addEventListener('click', () => {
    const monthly = monthlyRows.filter((row) => row.month.startsWith(yearFilter.value)).map((row) => ['Monthly', row.month, row.total_additions, row.total_deductions, row.total_expenses, row.net_change]);
    const members = memberRows.map((row) => ['Member', row.member_name, row.required_amount, row.paid_amount, row.outstanding_amount, row.payment_status]);
    const csv = [['Report type', 'Subject', 'Required/Additions', 'Confirmed/Deductions', 'Outstanding/Expenses', 'Status/Net'], ...monthly, ...members].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `ipon-report-${Ipon.isoDate()}.csv`; link.click(); URL.revokeObjectURL(link.href);
  });
  document.getElementById('export-transactions').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    Ipon.setBusy(button, true, 'Exporting…');
    try {
      const [contributions, withdrawals, expenses] = await Promise.all([
        Ipon.client.from('contributions').select('payment_date,amount,transaction_reference,approval_status,review_note,void_reason,created_at,contribution_periods!inner(period_month,members!inner(full_name))').order('payment_date'),
        Ipon.client.from('withdrawals').select('transaction_date,amount,category,description,person_responsible,reference_number,approval_status,review_note,void_reason,created_at').order('transaction_date'),
        Ipon.client.from('expenses').select('transaction_date,amount,category,description,person_responsible,reference_number,approval_status,review_note,void_reason,created_at').order('transaction_date')
      ]);
      for (const result of [contributions, withdrawals, expenses]) if (result.error) throw result.error;
      const rows = [
        ...contributions.data.map((row) => ['Contribution', row.payment_date, row.contribution_periods.members.full_name, row.amount, '', '', row.transaction_reference, row.approval_status, row.review_note || row.void_reason || '', row.created_at]),
        ...withdrawals.data.map((row) => ['Withdrawal', row.transaction_date, row.person_responsible, row.amount, row.category, row.description, row.reference_number, row.approval_status, row.review_note || row.void_reason || '', row.created_at]),
        ...expenses.data.map((row) => ['Expense', row.transaction_date, row.person_responsible, row.amount, row.category, row.description, row.reference_number, row.approval_status, row.review_note || row.void_reason || '', row.created_at])
      ].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      const csv = [['Type', 'Activity date', 'Member or responsible person', 'Amount', 'Category', 'Description', 'Reference', 'Status', 'Review or void reason', 'Recorded at'], ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `ipon-transactions-${Ipon.isoDate()}.csv`; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  try { await load(); } catch (error) { Ipon.showInlineError(monthlyBody, error, load, 5); Ipon.showInlineError(memberBody, error, load, 5); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('reports', ['contributions', 'withdrawals', 'expenses', 'contribution_periods', 'members'], load);
})();
