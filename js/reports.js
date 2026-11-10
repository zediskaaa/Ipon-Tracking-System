(async function () {
  'use strict';
  const state = await Ipon.init(); const tbody = document.getElementById('reports-body'); let rows = [];
  if (state.failed) return;
  if (!state.configured || !state.profile) { if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Connect Supabase to load reports.</td></tr>'; return; }
  try {
    const { data: summary, error: summaryError } = await Ipon.client.rpc('get_savings_summary'); if (summaryError) throw summaryError;
    document.getElementById('report-additions').textContent = Ipon.money(summary.total_additions);
    document.getElementById('report-deductions').textContent = Ipon.money(summary.total_deductions);
    document.getElementById('report-expenses').textContent = Ipon.money(summary.total_expenses);
    document.getElementById('report-tracked').textContent = Ipon.money(summary.tracked_savings);
    if (state.profile.role === 'MEMBER') return;
    const { data, error } = await Ipon.client.from('v_monthly_financial_summary').select('*').order('month'); if (error) throw error; rows = data;
    tbody.innerHTML = rows.length ? [...rows].reverse().map((row) => `<tr><td>${Ipon.dateLabel(row.month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.total_additions)}</td><td>${Ipon.money(row.total_deductions)}</td><td>${Ipon.money(row.total_expenses)}</td><td><strong>${Ipon.money(row.net_change)}</strong></td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No confirmed monthly activity yet.</td></tr>';
    if (rows.length && window.Chart) new Chart(document.getElementById('monthly-chart'), { type: 'bar', data: { labels: rows.map((row) => Ipon.dateLabel(row.month, { month: 'short', year: '2-digit' })), datasets: [{ label: 'Additions', data: rows.map((row) => row.total_additions), backgroundColor: '#287a4c' }, { label: 'Deductions + expenses', data: rows.map((row) => Number(row.total_deductions) + Number(row.total_expenses)), backgroundColor: '#ae3934' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#142d2b', font: { family: 'Arial' } } } }, scales: { x: { stacked: false, grid: { color: 'rgba(20,45,43,.08)' } }, y: { beginAtZero: true, grid: { color: 'rgba(20,45,43,.1)' } } } } });
  } catch (error) { Ipon.showInlineError(tbody, error, () => location.reload(), 5); }
  document.getElementById('print-report')?.addEventListener('click', () => window.print());
  document.getElementById('export-csv')?.addEventListener('click', () => {
    const lines = [['Month','Additions','Deductions','Expenses','Net change'], ...rows.map((row) => [row.month,row.total_additions,row.total_deductions,row.total_expenses,row.net_change])];
    const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `ipon-monthly-report-${Ipon.isoDate()}.csv`; anchor.click(); URL.revokeObjectURL(url);
  });
})();
