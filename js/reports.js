(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || !state.configured || !state.profile) return;
  const monthlyBody = document.getElementById('reports-body');
  const memberBody = document.getElementById('member-report-body');
  const yearFilter = document.getElementById('report-year');
  const monthFilter = document.getElementById('member-report-month');
  const statusFilter = document.getElementById('member-report-status');
  const remindBtn = document.getElementById('remind-unpaid-btn');
  const walletBody = document.getElementById('wallet-reconciliation-body');
  const walletClearBtn = document.getElementById('wallet-clear-counts');
  let monthlyRows = [], memberRows = [], latestWallet = null, chart;

  const walletStorageKey = () => `ipon_wallet_counts_${state.profile?.group_id || 'default'}`;
  function readSavedCounts() {
    try { return JSON.parse(localStorage.getItem(walletStorageKey()) || '{}') || {}; }
    catch { return {}; }
  }
  function saveCount(method, rawValue) {
    const counts = readSavedCounts();
    if (rawValue === '' || rawValue === null || rawValue === undefined) delete counts[method];
    else counts[method] = String(rawValue);
    try { localStorage.setItem(walletStorageKey(), JSON.stringify(counts)); } catch {}
    return counts;
  }

  function varianceHtml(expected, rawActual, badInput = false) {
    const parsed = Ipon.parseMoneyAmount(rawActual, {
      min: 0,
      max: Ipon.MAX_MONEY_AMOUNT,
      required: false,
      label: 'Actual count',
      badInput
    });
    if (!parsed.valid) return '<span class="wallet-variance-pill is-invalid">Invalid amount</span>';
    if (parsed.value === null) return '<span class="wallet-variance-pill is-empty">—</span>';
    const diff = Math.round((parsed.value - Number(expected || 0)) * 100) / 100;
    if (Math.abs(diff) < 0.005) {
      return '<span class="wallet-variance-pill is-matched">Matched ✓</span>';
    }
    if (diff > 0) {
      return `<span class="wallet-variance-pill is-over">+${Ipon.money(diff)} over</span>`;
    }
    return `<span class="wallet-variance-pill is-short">-${Ipon.money(Math.abs(diff))} short</span>`;
  }

  function syncWalletTotals() {
    if (!walletBody || !latestWallet) return;
    const channels = Array.isArray(latestWallet.channels) ? latestWallet.channels : [];
    const counts = readSavedCounts();
    let totalActual = 0;
    let totalExpectedCounted = 0;
    let countedRows = 0;
    let hasInvalid = false;
    channels.forEach((ch) => {
      const input = walletBody.querySelector(`[data-wallet-count="${ch.method}"]`);
      const errorEl = walletBody.querySelector(`[data-wallet-error="${ch.method}"]`);
      const raw = input ? input.value : counts[ch.method];
      const badInput = Boolean(input?.validity?.badInput);
      const parsed = Ipon.parseMoneyAmount(raw, {
        min: 0,
        max: Ipon.MAX_MONEY_AMOUNT,
        required: false,
        label: 'Actual count',
        badInput
      });
      if (input) {
        input.classList.toggle('is-invalid', !parsed.valid);
        if (!parsed.valid) input.setAttribute('aria-invalid', 'true');
        else input.removeAttribute('aria-invalid');
        input.setCustomValidity(parsed.error);
      }
      if (errorEl) {
        errorEl.textContent = parsed.error;
        errorEl.title = parsed.error;
        errorEl.classList.toggle('is-visible', !parsed.valid);
        errorEl.setAttribute('aria-hidden', parsed.valid ? 'true' : 'false');
      }
      const cell = walletBody.querySelector(`[data-wallet-variance="${ch.method}"]`);
      if (cell) cell.innerHTML = varianceHtml(ch.net_balance, raw, badInput);
      if (!parsed.valid) {
        hasInvalid = true;
      } else if (parsed.value !== null) {
        totalActual += parsed.value;
        totalExpectedCounted += Number(ch.net_balance || 0);
        countedRows += 1;
      }
    });
    const totalActualCell = walletBody.querySelector('[data-wallet-total-actual]');
    const totalVarianceCell = walletBody.querySelector('[data-wallet-total-variance]');
    if (totalActualCell) totalActualCell.textContent = countedRows > 0 ? Ipon.money(totalActual) : '—';
    if (totalVarianceCell) {
      totalVarianceCell.innerHTML = hasInvalid
        ? '<span class="wallet-variance-pill is-invalid">Fix invalid count</span>'
        : countedRows > 0
          ? varianceHtml(totalExpectedCounted, totalActual)
          : '<span class="wallet-variance-pill is-empty">—</span>';
    }
    if (walletClearBtn) walletClearBtn.disabled = countedRows === 0 && !hasInvalid;
  }

  function renderWalletReconciliation(wallet) {
    latestWallet = wallet || null;
    if (!walletBody) return;
    if (!wallet) {
      walletBody.innerHTML = '<tr><td colspan="7" class="empty-state">Wallet breakdown unavailable.</td></tr>';
      return;
    }
    const tracked = Number(wallet.tracked_savings || 0);
    const cash = Number(wallet.physical_cash_balance || 0);
    const digital = Number(wallet.digital_wallet_balance || 0);
    const other = Number(wallet.other_balance || 0);
    const untagged = Number(wallet.untagged_balance || 0);
    const otherCombined = other + untagged;
    const shareText = (val) => {
      if (tracked <= 0) return '0% of savings';
      const pct = Math.max(0, Math.round((Number(val || 0) / tracked) * 1000) / 10);
      return `${pct}% of savings`;
    };
    const cashEl = document.getElementById('wallet-cash-balance');
    const cashShareEl = document.getElementById('wallet-cash-share');
    const digitalEl = document.getElementById('wallet-digital-balance');
    const digitalShareEl = document.getElementById('wallet-digital-share');
    const otherCard = document.getElementById('wallet-other-card');
    const otherEl = document.getElementById('wallet-other-balance');
    const otherShareEl = document.getElementById('wallet-other-share');
    const otherBadge = document.getElementById('wallet-other-badge');
    const otherMeta = document.getElementById('wallet-other-meta');
    const subtitleEl = document.getElementById('wallet-reconciliation-subtitle');

    if (cashEl) cashEl.textContent = Ipon.money(cash);
    if (cashShareEl) cashShareEl.textContent = shareText(cash);
    if (digitalEl) digitalEl.textContent = Ipon.money(digital);
    if (digitalShareEl) digitalShareEl.textContent = shareText(digital);
    if (otherCard) {
      const showOther = Boolean(wallet.has_untagged) || otherCombined !== 0;
      otherCard.hidden = !showOther;
      if (otherEl) otherEl.textContent = Ipon.money(otherCombined);
      if (otherShareEl) otherShareEl.textContent = shareText(otherCombined);
      if (otherBadge) {
        otherBadge.textContent = wallet.has_untagged && other === 0 ? 'Untagged (legacy)' : 'Other / untagged';
      }
      if (otherMeta) {
        otherMeta.textContent = wallet.has_untagged && other === 0
          ? 'Entries recorded before channel tagging'
          : 'Other channels and legacy entries';
      }
    }
    if (subtitleEl) {
      subtitleEl.textContent = wallet.cycle_start_date
        ? `Expected channel balances for active cycle starting ${Ipon.dateLabel(wallet.cycle_start_date, { month: 'short', year: 'numeric' })}.`
        : 'Physical cash on hand versus e-wallets and bank accounts across confirmed entries.';
    }

    const channels = Array.isArray(wallet.channels) ? wallet.channels : [];
    const channelSum = channels.reduce((sum, ch) => sum + Number(ch.net_balance || 0), 0);
    const savedCounts = readSavedCounts();
    let totalIn = 0;
    let totalOut = 0;
    let totalPendingIn = 0;
    let totalPendingOut = 0;
    const rowsHtml = channels.map((ch) => {
      const inflows = Number(ch.additions || 0);
      const outflows = Number(ch.deductions || 0) + Number(ch.expenses || 0);
      const net = Number(ch.net_balance || 0);
      const pIn = Number(ch.pending_inflow || 0);
      const pOut = Number(ch.pending_outflow || 0);
      totalIn += inflows;
      totalOut += outflows;
      totalPendingIn += pIn;
      totalPendingOut += pOut;
      const pendingParts = [];
      if (pIn > 0) pendingParts.push(`<span class="wallet-pending-in">+${Ipon.money(pIn)}</span>`);
      if (pOut > 0) pendingParts.push(`<span class="wallet-pending-out">-${Ipon.money(pOut)}</span>`);
      const pendingText = pendingParts.length ? pendingParts.join(' · ') : '<span class="field-help">—</span>';
      const meta = Ipon.paymentMethodMeta(ch.method === 'UNTAGGED' ? '' : ch.method);
      const rawSaved = savedCounts[ch.method] ?? '';
      const savedParsed = Ipon.parseMoneyAmount(rawSaved, { min: 0, max: Ipon.MAX_MONEY_AMOUNT, required: false, label: 'Actual count' });
      const savedVal = savedParsed.valid ? rawSaved : '';
      return `<tr>
        <td>${Ipon.paymentMethodBadge(ch.method === 'UNTAGGED' ? '' : ch.method)}<small class="field-help">${Number(ch.entry_count || 0)} confirmed</small></td>
        <td>${Ipon.money(inflows)}</td>
        <td>${Ipon.money(outflows)}</td>
        <td class="amount-cell"><strong>${Ipon.money(net)}</strong></td>
        <td>${pendingText}</td>
        <td><div class="wallet-count-cell"><input class="wallet-count-input" type="number" min="0" max="${Ipon.MAX_MONEY_AMOUNT}" step="0.01" inputmode="decimal" data-wallet-count="${Ipon.escapeHtml(ch.method)}" value="${Ipon.escapeHtml(savedVal)}" placeholder="0.00" aria-label="Actual count for ${Ipon.escapeHtml(meta.label)}"><small class="wallet-count-error" data-wallet-error="${Ipon.escapeHtml(ch.method)}" role="alert" aria-hidden="true"></small></div></td>
        <td data-wallet-variance="${Ipon.escapeHtml(ch.method)}">${varianceHtml(net, savedVal)}</td>
      </tr>`;
    }).join('');

    const totalPendingParts = [];
    if (totalPendingIn > 0) totalPendingParts.push(`<span class="wallet-pending-in">+${Ipon.money(totalPendingIn)}</span>`);
    if (totalPendingOut > 0) totalPendingParts.push(`<span class="wallet-pending-out">-${Ipon.money(totalPendingOut)}</span>`);
    const totalPendingHtml = totalPendingParts.length ? totalPendingParts.join(' · ') : '<span class="field-help">—</span>';

    walletBody.innerHTML = channels.length
      ? `${rowsHtml}<tr class="wallet-total-row">
          <td><strong>Total</strong></td>
          <td><strong>${Ipon.money(totalIn)}</strong></td>
          <td><strong>${Ipon.money(totalOut)}</strong></td>
          <td class="amount-cell"><strong>${Ipon.money(channelSum)}</strong></td>
          <td>${totalPendingHtml}</td>
          <td data-wallet-total-actual>—</td>
          <td data-wallet-total-variance><span class="wallet-variance-pill is-empty">—</span></td>
        </tr>`
      : '<tr><td colspan="7" class="empty-state">No wallet activity recorded yet.</td></tr>';

    walletBody.querySelectorAll('[data-wallet-count]').forEach((input) => {
      Ipon.guardMoneyInput(input, { customDisplay: true, min: 0, max: Ipon.MAX_MONEY_AMOUNT, label: 'Actual count' });
    });
    syncWalletTotals();
  }

  function renderMonthly() {
    const selectedYear = yearFilter.value;
    yearFilter.closest('.panel-header')?.setAttribute('data-print-meta', selectedYear === 'ALL' ? 'All years' : `Year: ${selectedYear}`);
    const rows = selectedYear === 'ALL' ? monthlyRows : monthlyRows.filter((row) => row.month.startsWith(selectedYear));
    monthlyBody.innerHTML = rows.length ? rows.map((row) => `<tr><td>${Ipon.dateLabel(row.month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.total_additions)}</td><td>${Ipon.money(row.total_deductions)}</td><td>${Ipon.money(row.total_expenses)}</td><td>${Ipon.money(row.net_change)}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No confirmed activity for this year.</td></tr>';
    chart?.destroy();
    const chartCanvas = document.getElementById('monthly-chart');
    const chartEmpty = document.getElementById('monthly-chart-empty');
    if (chartCanvas) chartCanvas.hidden = !rows.length;
    if (chartEmpty) chartEmpty.hidden = Boolean(rows.length);
    const baselineMax = Math.max(1000, memberRows.reduce((sum, row) => sum + (Number(row.required_amount) || 0), 0));
    if (rows.length && window.Chart) chart = new Chart(chartCanvas, { type: 'bar', data: { labels: rows.map((row) => Ipon.dateLabel(row.month, selectedYear === 'ALL' ? { month: 'short', year: '2-digit' } : { month: 'short' })), datasets: [{ label: 'Additions', data: rows.map((row) => row.total_additions), backgroundColor: '#287a4c', maxBarThickness: 42 }, { label: 'Deductions + expenses', data: rows.map((row) => Number(row.total_deductions) + Number(row.total_expenses)), backgroundColor: '#ae3934', maxBarThickness: 42 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, suggestedMax: baselineMax, ticks: { maxTicksLimit: 6, precision: 0, callback: (value) => `₱${Number(value).toLocaleString('en-PH')}` } } } } });
  }

  async function loadMembers() {
    const monthText = monthFilter.value ? Ipon.dateLabel(`${monthFilter.value}-01`, { month: 'long', year: 'numeric' }) : '';
    const statusText = statusFilter.options[statusFilter.selectedIndex]?.text || 'All statuses';
    monthFilter.closest('.panel-header')?.setAttribute('data-print-meta', [monthText, statusText].filter(Boolean).join(' · '));
    const [{ data, error }, { data: activeMembers, error: membersError }] = await Promise.all([
      Ipon.client.from('v_contribution_status').select('*').eq('period_month', `${monthFilter.value}-01`).order('member_name'),
      Ipon.client.from('members').select('id,payout_channel,payout_account_number,payout_account_name').eq('status', 'ACTIVE')
    ]);
    if (error) throw error;
    if (membersError) throw membersError;
    const activeById = new Map((activeMembers || []).map((m) => [m.id, m]));
    memberRows = (data || []).filter((row) => activeById.has(row.member_id) || Number(row.paid_amount || 0) > 0);
    if (statusFilter.value) memberRows = memberRows.filter((row) => row.payment_status === statusFilter.value);
    memberBody.innerHTML = memberRows.length ? memberRows.map((row) => {
      const payoutChip = Ipon.payoutSummaryChip(activeById.get(row.member_id), { compact: true, showCopy: true });
      return `<tr><td><strong>${Ipon.escapeHtml(row.member_name)}</strong>${payoutChip ? `<div class="report-member-payout">${payoutChip}</div>` : ''}</td><td>${Ipon.money(row.required_amount)}</td><td>${Ipon.money(row.paid_amount)}</td><td>${Ipon.money(row.outstanding_amount)}</td><td><span class="status status-${row.payment_status.toLowerCase().replaceAll(' ', '-')}">${Ipon.escapeHtml(row.payment_status)}</span></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-state">No member periods match this report.</td></tr>';
  }

  async function load() {
    const selectedYear = yearFilter.value;
    const selectedMonth = monthFilter.value;
    const [{ data: summary, error: summaryError }, { data, error }, { data: walletData, error: walletError }] = await Promise.all([
      Ipon.client.rpc('get_savings_summary'),
      Ipon.client.from('v_monthly_financial_summary').select('*').order('month'),
      Ipon.client.rpc('get_wallet_reconciliation')
    ]);
    if (summaryError) throw summaryError; if (error) throw error;
    ['additions', 'deductions', 'expenses'].forEach((key) => { document.getElementById(`report-${key}`).textContent = Ipon.money(summary?.[`total_${key}`]); });
    document.getElementById('report-tracked').textContent = Ipon.money(summary?.tracked_savings); monthlyRows = data || [];
    renderWalletReconciliation(walletError ? null : walletData);
    const years = [...new Set([String(new Date().getFullYear()), ...monthlyRows.map((row) => row.month.slice(0, 4))])].sort().reverse();
    yearFilter.innerHTML = [...years.map((year) => `<option value="${year}">${year}</option>`), '<option value="ALL">All years</option>'].join('');
    yearFilter.value = selectedYear === 'ALL' || years.includes(selectedYear) ? selectedYear : years[0];
    monthFilter.value = selectedMonth || Ipon.monthStart().slice(0, 7);
    await loadMembers(); renderMonthly();
  }

  yearFilter.addEventListener('change', renderMonthly);
  [monthFilter, statusFilter].forEach((filter) => filter.addEventListener('change', () => loadMembers().catch((error) => Ipon.showInlineError(memberBody, error, loadMembers, 5))));
  remindBtn?.addEventListener('click', () => Ipon.remindUnpaidMembers(monthFilter.value, remindBtn));
  walletBody?.addEventListener('input', (event) => {
    const input = event.target.closest('[data-wallet-count]');
    if (!input) return;
    const parsed = Ipon.parseMoneyAmount(input.value, {
      min: 0,
      max: Ipon.MAX_MONEY_AMOUNT,
      required: false,
      label: 'Actual count',
      badInput: Boolean(input.validity?.badInput)
    });
    saveCount(input.dataset.walletCount, parsed.valid ? input.value.trim() : '');
    syncWalletTotals();
  });
  walletClearBtn?.addEventListener('click', () => {
    try { localStorage.removeItem(walletStorageKey()); } catch {}
    walletBody?.querySelectorAll('[data-wallet-count]').forEach((input) => { input.value = ''; });
    syncWalletTotals();
  });
  window.addEventListener('beforeprint', () => chart?.resize(720, 120));
  window.addEventListener('afterprint', () => chart?.resize());
  document.getElementById('print-report').addEventListener('click', () => { chart?.resize(720, 120); window.print(); setTimeout(() => chart?.resize(), 300); });
  document.getElementById('export-csv').addEventListener('click', () => {
    const selectedYear = yearFilter.value;
    const monthly = (selectedYear === 'ALL' ? monthlyRows : monthlyRows.filter((row) => row.month.startsWith(selectedYear))).map((row) => ['Monthly', row.month, row.total_additions, row.total_deductions, row.total_expenses, row.net_change]);
    const members = memberRows.map((row) => ['Member', row.member_name, row.required_amount, row.paid_amount, row.outstanding_amount, row.payment_status]);
    const csv = [['Report type', 'Subject', 'Required/Additions', 'Confirmed/Deductions', 'Outstanding/Expenses', 'Status/Net'], ...monthly, ...members].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `ipon-report-${selectedYear === 'ALL' ? 'all' : selectedYear}-${Ipon.isoDate()}.csv`; link.click(); URL.revokeObjectURL(link.href);
  });
  document.getElementById('export-transactions').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    Ipon.setBusy(button, true, 'Exporting…');
    try {
      const selectedYear = yearFilter.value;
      const filterByYear = (query, col) => (/^\d{4}$/.test(selectedYear) ? query.gte(col, `${selectedYear}-01-01`).lte(col, `${selectedYear}-12-31`) : query);
      const [contributions, withdrawals, expenses] = await Promise.all([
        filterByYear(Ipon.client.from('contributions').select('payment_date,amount,payment_method,transaction_reference,approval_status,review_note,void_reason,created_at,contribution_periods!inner(period_month,members!inner(full_name))').order('payment_date'), 'payment_date'),
        filterByYear(Ipon.client.from('withdrawals').select('transaction_date,amount,category,description,person_responsible,payment_method,reference_number,approval_status,review_note,void_reason,created_at').order('transaction_date'), 'transaction_date'),
        filterByYear(Ipon.client.from('expenses').select('transaction_date,amount,category,description,person_responsible,payment_method,reference_number,approval_status,review_note,void_reason,created_at').order('transaction_date'), 'transaction_date')
      ]);
      for (const result of [contributions, withdrawals, expenses]) if (result.error) throw result.error;
      const rows = [
        ...contributions.data.map((row) => ['Contribution', row.payment_date, row.contribution_periods.members.full_name, Ipon.paymentMethodMeta(row.payment_method).label, row.amount, '', '', row.transaction_reference, row.approval_status, row.review_note || row.void_reason || '', row.created_at]),
        ...withdrawals.data.map((row) => ['Withdrawal', row.transaction_date, row.person_responsible, Ipon.paymentMethodMeta(row.payment_method).label, row.amount, row.category, row.description, row.reference_number, row.approval_status, row.review_note || row.void_reason || '', row.created_at]),
        ...expenses.data.map((row) => ['Expense', row.transaction_date, row.person_responsible, Ipon.paymentMethodMeta(row.payment_method).label, row.amount, row.category, row.description, row.reference_number, row.approval_status, row.review_note || row.void_reason || '', row.created_at])
      ].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
      const csv = [['Type', 'Activity date', 'Member or responsible person', 'Payment method', 'Amount', 'Category', 'Description', 'Reference', 'Status', 'Review or void reason', 'Recorded at'], ...rows].map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
      const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `ipon-transactions-${selectedYear === 'ALL' ? 'all' : selectedYear}-${Ipon.isoDate()}.csv`; link.click(); URL.revokeObjectURL(link.href);
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  try { await load(); } catch (error) { Ipon.showInlineError(monthlyBody, error, load, 5); Ipon.showInlineError(memberBody, error, load, 5); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('reports', ['contributions', 'withdrawals', 'expenses', 'contribution_periods', 'members'], load);
})();
