(async function () {
  'use strict';

  const INCOME_PRESETS = Object.freeze([
    'Salary',
    'Freelance',
    'Business',
    'Side Hustle',
    'Allowance',
    'Commission',
    'Investments',
    'Bonus',
    'Others'
  ]);

  const EXPENSE_PRESETS = Object.freeze([
    'Food',
    'Transportation',
    'Bills',
    'Education',
    'Healthcare',
    'Shopping',
    'Others'
  ]);

  const RATE_PRESETS = Object.freeze([10, 15, 20, 25, 30]);
  const MONTH_NAMES = Object.freeze([
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]);
  const MONTH_SHORT = Object.freeze([
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ]);
  const TAB_STORAGE_KEY = 'ipon_budget_active_tab';
  const VIEW_STORAGE_KEY = 'ipon_cf_active_view';

  const modeTabs = [...document.querySelectorAll('[data-budget-mode-tab]')];
  const monitorSection = document.getElementById('cf-monitor-section');
  const allocationSection = document.getElementById('budget-allocation-section');
  const pageTitleEl = document.getElementById('budget-page-title');
  const pageDescEl = document.getElementById('budget-page-desc');
  const headerActionsEl = document.getElementById('budget-header-actions');

  if (!monitorSection) return;

  const errorSlot = document.getElementById('cf-error-slot');
  const prevMonthBtn = document.getElementById('cf-month-prev');
  const nextMonthBtn = document.getElementById('cf-month-next');
  const monthInput = document.getElementById('cf-month-input');
  const todayMonthBtn = document.getElementById('cf-month-today');
  const rateDisplayEl = document.getElementById('cf-rate-display');
  const rateOpenBtn = document.getElementById('cf-rate-open-btn');

  const heroCard = document.getElementById('cf-hero-card');
  const healthBadge = document.getElementById('cf-health-badge');
  const healthText = document.getElementById('cf-health-text');
  const heroNetEl = document.getElementById('cf-hero-net');
  const heroFormulaEl = document.getElementById('cf-hero-formula');
  const meterPctEl = document.getElementById('cf-meter-pct');
  const meterTrackEl = document.getElementById('cf-meter-track');
  const meterFillEl = document.getElementById('cf-meter-fill');
  const meterCaptionEl = document.getElementById('cf-meter-caption');
  const heroGrossEl = document.getElementById('cf-hero-gross');
  const heroMandatoryEl = document.getElementById('cf-hero-mandatory');
  const heroMandatoryLabelEl = document.getElementById('cf-hero-mandatory-label');

  const kpiAvailableEl = document.getElementById('cf-kpi-available');
  const kpiAvailableSubEl = document.getElementById('cf-kpi-available-sub');
  const kpiExpensesEl = document.getElementById('cf-kpi-expenses');
  const kpiExpensesSubEl = document.getElementById('cf-kpi-expenses-sub');
  const kpiNetEl = document.getElementById('cf-kpi-net');
  const kpiNetSubEl = document.getElementById('cf-kpi-net-sub');

  const segIncomeBtn = document.getElementById('cf-seg-income');
  const segExpenseBtn = document.getElementById('cf-seg-expense');
  const segIncomeTotalEl = document.getElementById('cf-seg-income-total');
  const segExpenseTotalEl = document.getElementById('cf-seg-expense-total');

  const incomePanel = document.getElementById('cf-income-panel');
  const expensePanel = document.getElementById('cf-expense-panel');

  const incGrossEl = document.getElementById('cf-inc-gross');
  const incGrossSubEl = document.getElementById('cf-inc-gross-sub');
  const incSavingsLabelEl = document.getElementById('cf-inc-savings-label');
  const incSavingsEl = document.getElementById('cf-inc-savings');
  const incSavingsSubEl = document.getElementById('cf-inc-savings-sub');
  const incSavingsEditBtn = document.getElementById('cf-inc-savings-edit');
  const incAvailableEl = document.getElementById('cf-inc-available');
  const incSearchInput = document.getElementById('cf-income-search');
  const addIncomeBtn = document.getElementById('cf-add-income-btn');
  const incomeBody = document.getElementById('cf-income-body');

  const expTotalEl = document.getElementById('cf-exp-total');
  const expTotalSubEl = document.getElementById('cf-exp-total-sub');
  const expCountEl = document.getElementById('cf-exp-count');
  const expCountSubEl = document.getElementById('cf-exp-count-sub');
  const expRemainingEl = document.getElementById('cf-exp-remaining');
  const expRemainingSubEl = document.getElementById('cf-exp-remaining-sub');
  const expSearchInput = document.getElementById('cf-expense-search');
  const expCatFilter = document.getElementById('cf-expense-cat-filter');
  const addExpenseBtn = document.getElementById('cf-add-expense-btn');
  const expenseBody = document.getElementById('cf-expense-body');
  const breakdownWrap = document.getElementById('cf-breakdown-wrap');
  const breakdownList = document.getElementById('cf-breakdown-list');

  const chartTitleEl = document.getElementById('cf-chart-title');
  const chartBarsWrap = document.getElementById('cf-chart-bars');
  const chartPrevBtn = document.getElementById('cf-chart-prev');
  const chartNextBtn = document.getElementById('cf-chart-next');
  const chartRangeEl = document.getElementById('cf-chart-range');
  const compareToggleBtn = document.getElementById('cf-compare-toggle');
  const compareLegendEl = document.getElementById('cf-compare-legend');
  const chartHintEl = document.getElementById('cf-chart-hint');
  const comparePanelEl = document.getElementById('cf-compare-panel');
  const comparePrimaryLabelEl = document.getElementById('cf-compare-primary-label');
  const compareSelectEl = document.getElementById('cf-compare-select');
  const comparePrevBtn = document.getElementById('cf-compare-prev-btn');
  const compareCloseBtn = document.getElementById('cf-compare-close-btn');
  const compareGridEl = document.getElementById('cf-compare-grid');
  const historyListEl = document.getElementById('cf-history-list');

  const entryDialog = document.getElementById('cf-entry-dialog');
  const entryForm = document.getElementById('cf-entry-form');
  const entryIdInput = document.getElementById('cf-entry-id');
  const entryTypeInput = document.getElementById('cf-entry-type');
  const entryEyebrowEl = document.getElementById('cf-entry-eyebrow');
  const entryTitleEl = document.getElementById('cf-entry-title');
  const entryCopyEl = document.getElementById('cf-entry-copy');
  const entryCatLabelEl = document.getElementById('cf-entry-category-label');
  const entryCatInput = document.getElementById('cf-entry-category');
  const entryCatPresetsEl = document.getElementById('cf-entry-presets');
  const entryDescInput = document.getElementById('cf-entry-description');
  const entryAmountInput = document.getElementById('cf-entry-amount');
  const entryDateInput = document.getElementById('cf-entry-date');
  const entryImpactPrimaryLabel = document.getElementById('cf-impact-primary-label');
  const entryImpactPrimaryVal = document.getElementById('cf-impact-primary-val');
  const entryImpactNetVal = document.getElementById('cf-impact-net-val');
  const entrySubmitBtn = document.getElementById('cf-entry-submit');

  const rateDialog = document.getElementById('cf-rate-dialog');
  const rateForm = document.getElementById('cf-rate-form');
  const rateInput = document.getElementById('cf-rate-input');
  const ratePresetsEl = document.getElementById('cf-rate-presets');
  const ratePreviewGross = document.getElementById('cf-rate-preview-gross');
  const ratePreviewDeduct = document.getElementById('cf-rate-preview-deduct');
  const ratePreviewAvail = document.getElementById('cf-rate-preview-avail');
  const rateSubmitBtn = document.getElementById('cf-rate-submit');

  function roundCentavos(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function formatPct(value) {
    const num = roundCentavos(value);
    return `${Number.isInteger(num) ? num : num.toFixed(2).replace(/\.?0+$/, '')}%`;
  }

  function formatSignedMoney(value) {
    const num = roundCentavos(value);
    if (num < 0) return `−${Ipon.money(Math.abs(num))}`;
    return Ipon.money(num);
  }

  function formatMoneyWithSmallCentsHtml(formattedText) {
    const text = String(formattedText || '');
    const idx = text.lastIndexOf('.');
    if (idx < 0 || idx !== text.length - 3) return Ipon.escapeHtml(text);
    const whole = Ipon.escapeHtml(text.slice(0, idx));
    const cents = Ipon.escapeHtml(text.slice(idx));
    return `${whole}<span class="cf-cents">${cents}</span>`;
  }

  function setMoneyDisplay(el, formattedText) {
    if (!el) return;
    const text = String(formattedText || '');
    el.innerHTML = formatMoneyWithSmallCentsHtml(text);
  }

  function formatCompactPeso(value) {
    const num = roundCentavos(value);
    const abs = Math.abs(num);
    const sign = num < 0 ? '−' : '';
    if (abs >= 1_000_000_000) {
      const b = abs / 1_000_000_000;
      return `${sign}₱${(b >= 100 ? Math.round(b) : b.toFixed(1).replace(/\.0$/, ''))}B`;
    }
    if (abs >= 1_000_000) {
      const m = abs / 1_000_000;
      return `${sign}₱${(m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, ''))}M`;
    }
    if (abs >= 1_000) {
      const k = abs / 1_000;
      return `${sign}₱${(k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, ''))}k`;
    }
    return `${sign}₱${Math.round(abs)}`;
  }

  function currentManilaYearMonth() {
    const iso = typeof Ipon?.isoDate === 'function' ? Ipon.isoDate() : new Date().toISOString().slice(0, 10);
    const [y, m] = String(iso).split('-').map(Number);
    return {
      year: Number.isFinite(y) && y >= 2000 ? y : new Date().getFullYear(),
      month: Number.isFinite(m) && m >= 1 && m <= 12 ? m : new Date().getMonth() + 1
    };
  }

  function ymString(year, month) {
    return `${year}-${String(month).padStart(2, '0')}`;
  }

  function monthLabel(year, month) {
    return `${MONTH_NAMES[(month - 1) % 12] || 'Month'} ${year}`;
  }

  function monthBounds(year, month) {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      min: `${ymString(year, month)}-01`,
      max: `${ymString(year, month)}-${String(lastDay).padStart(2, '0')}`
    };
  }

  function categoryToneClass(category, entryType) {
    if (entryType !== 'EXPENSE') return '';
    const key = String(category || '').trim().toLowerCase();
    if (key.includes('food') || key.includes('grocer') || key.includes('dining')) return 'is-food';
    if (key.includes('transport') || key.includes('commute') || key.includes('fuel')) return 'is-transport';
    if (key.includes('bill') || key.includes('utilit') || key.includes('rent') || key.includes('electric') || key.includes('water') || key.includes('internet')) return 'is-bills';
    if (key.includes('educ') || key.includes('tuition') || key.includes('school')) return 'is-education';
    if (key.includes('health') || key.includes('medic') || key.includes('clinic')) return 'is-health';
    if (key.includes('shop') || key.includes('cloth')) return 'is-shopping';
    if (key === 'others' || key === 'other') return 'is-others';
    return 'is-expense';
  }

  function computeTotals(incomes, expenses, pct) {
    const grossIncome = roundCentavos((incomes || []).reduce((acc, row) => acc + Number(row.amount || 0), 0));
    const rate = Math.min(100, Math.max(0, roundCentavos(pct ?? 20)));
    const mandatorySavings = roundCentavos((grossIncome * rate) / 100);
    const availableIncome = roundCentavos(grossIncome - mandatorySavings);
    const totalExpenses = roundCentavos((expenses || []).reduce((acc, row) => acc + Number(row.amount || 0), 0));
    const netIncome = roundCentavos(availableIncome - totalExpenses);
    const spentRatioPct = availableIncome > 0
      ? Math.min(9999.9, Math.round((totalExpenses / availableIncome) * 1000) / 10)
      : (totalExpenses > 0 ? 100 : 0);
    return {
      gross_income: grossIncome,
      mandatory_savings_pct: rate,
      mandatory_savings: mandatorySavings,
      available_income: availableIncome,
      total_expenses: totalExpenses,
      net_income: netIncome,
      income_count: (incomes || []).length,
      expense_count: (expenses || []).length,
      spent_ratio_pct: spentRatioPct,
      is_over_budget: netIncome < 0
    };
  }

  function resolveInitialMode() {
    const hash = String(window.location?.hash || '').toLowerCase();
    const params = new URLSearchParams(window.location?.search || '');
    const tabParam = String(params.get('tab') || '').toLowerCase();
    if (hash === '#allocation' || tabParam === 'allocation') return 'allocation';
    if (hash === '#monitor' || tabParam === 'monitor') return 'monitor';
    try {
      const saved = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (saved === 'allocation' || saved === 'monitor') return saved;
    } catch { }
    return 'monitor';
  }

  function resolveInitialView() {
    const params = new URLSearchParams(window.location?.search || '');
    const viewParam = String(params.get('view') || '').toLowerCase();
    if (viewParam === 'expense' || viewParam === 'income') return viewParam;
    try {
      const saved = sessionStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'expense' || saved === 'income') return saved;
    } catch { }
    return 'income';
  }

  const nowYm = currentManilaYearMonth();
  let activeMode = resolveInitialMode();
  let activeView = resolveInitialView();
  let selectedYear = nowYm.year;
  let selectedMonth = nowYm.month;
  let compareMode = false;
  let compareTargetKey = '';
  let monitorData = null;
  let loadSeq = 0;

  function applyPageMode(mode, { persist = true } = {}) {
    activeMode = mode === 'allocation' ? 'allocation' : 'monitor';
    if (document.body?.dataset) document.body.dataset.budgetMode = activeMode;
    modeTabs.forEach((btn) => {
      const isCurrent = btn.dataset.budgetModeTab === activeMode;
      btn.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    });
    if (monitorSection) monitorSection.hidden = activeMode !== 'monitor';
    if (allocationSection) allocationSection.hidden = activeMode !== 'allocation';
    if (pageTitleEl) {
      pageTitleEl.textContent = activeMode === 'monitor'
        ? 'Monthly income & expense monitor'
        : 'Budget allocation & expenses';
    }
    if (pageDescEl) {
      pageDescEl.textContent = activeMode === 'monitor'
        ? 'Track monthly income sources, automatically set aside mandatory savings, monitor expenses, and see your real net monthly income.'
        : 'Plan your Needs, Wants, and Savings from your live IPON balance, with optional direct deductions synced back to savings.';
    }
    if (persist) {
      try { sessionStorage.setItem(TAB_STORAGE_KEY, activeMode); } catch { }
    }
  }

  function applySubView(view, { persist = true } = {}) {
    activeView = view === 'expense' ? 'expense' : 'income';
    if (segIncomeBtn) segIncomeBtn.setAttribute('aria-selected', activeView === 'income' ? 'true' : 'false');
    if (segExpenseBtn) segExpenseBtn.setAttribute('aria-selected', activeView === 'expense' ? 'true' : 'false');
    if (incomePanel) incomePanel.hidden = activeView !== 'income';
    if (expensePanel) expensePanel.hidden = activeView !== 'expense';
    if (persist) {
      try { sessionStorage.setItem(VIEW_STORAGE_KEY, activeView); } catch { }
    }
  }

  function syncMonthControls() {
    if (monthInput) monthInput.value = ymString(selectedYear, selectedMonth);
    const cur = currentManilaYearMonth();
    const isCurrentMonth = selectedYear === cur.year && selectedMonth === cur.month;
    if (todayMonthBtn) todayMonthBtn.hidden = isCurrentMonth;
  }

  function shiftMonth(delta) {
    const dt = new Date(Date.UTC(selectedYear, selectedMonth - 1 + delta, 1));
    const nextYear = dt.getUTCFullYear();
    const nextMonth = dt.getUTCMonth() + 1;
    if (nextYear < 2000 || nextYear > 2100) return Promise.resolve();
    selectedYear = nextYear;
    selectedMonth = nextMonth;
    if (expCatFilter) expCatFilter.value = '';
    syncMonthControls();
    return loadMonitor();
  }

  function renderSummary(data) {
    const pct = Number(data?.mandatory_savings_pct ?? 20);
    const pctLabel = formatPct(pct);
    const t = data?.totals || computeTotals(data?.incomes, data?.expenses, pct);
    const gross = Number(t.gross_income || 0);
    const mandatory = Number(t.mandatory_savings || 0);
    const available = Number(t.available_income || 0);
    const expenses = Number(t.total_expenses || 0);
    const net = Number(t.net_income || 0);
    const ratio = Number(t.spent_ratio_pct || 0);
    const isDeficit = net < 0;
    const isWarn = !isDeficit && available > 0 && ratio >= 80;

    if (rateDisplayEl) rateDisplayEl.textContent = pctLabel;
    if (heroMandatoryLabelEl) heroMandatoryLabelEl.textContent = `Mandatory savings (${pctLabel})`;
    setMoneyDisplay(heroGrossEl, Ipon.money(gross));
    setMoneyDisplay(heroMandatoryEl, `−${Ipon.money(mandatory)}`);

    if (heroCard) heroCard.classList.toggle('is-deficit', isDeficit);
    if (healthBadge) {
      healthBadge.classList.toggle('is-deficit', isDeficit);
      healthBadge.classList.toggle('is-warn', isWarn);
    }
    if (healthText) {
      if (isDeficit) healthText.textContent = `Over available income by ${Ipon.money(Math.abs(net))}`;
      else if (gross <= 0 && expenses <= 0) healthText.textContent = `Ready to track ${monthLabel(selectedYear, selectedMonth)}`;
      else if (isWarn) healthText.textContent = `Nearing spending limit (${ratio}% used)`;
      else healthText.textContent = 'Spending within available income';
    }

    setMoneyDisplay(heroNetEl, formatSignedMoney(net));
    if (heroFormulaEl) {
      heroFormulaEl.textContent = `Available Income (${Ipon.money(available)}) − Expenses (${Ipon.money(expenses)})`;
    }

    const fillWidth = Math.min(100, Math.max(0, ratio));
    if (meterPctEl) meterPctEl.textContent = `${ratio}%`;
    if (meterTrackEl) meterTrackEl.setAttribute('aria-valuenow', String(Math.round(fillWidth)));
    if (meterFillEl) {
      meterFillEl.style.width = `${fillWidth}%`;
      meterFillEl.classList.toggle('is-deficit', isDeficit);
      meterFillEl.classList.toggle('is-warn', isWarn);
    }
    if (meterCaptionEl) {
      if (available <= 0 && expenses <= 0) {
        meterCaptionEl.textContent = `Add your monthly income sources first — ${pctLabel} is set aside automatically for savings.`;
      } else if (isDeficit) {
        meterCaptionEl.textContent = `Monthly expenses exceed your available income by ${Ipon.money(Math.abs(net))}. Review non-essential categories below.`;
      } else {
        meterCaptionEl.textContent = `You have spent ${Ipon.money(expenses)} of ${Ipon.money(available)} available, leaving ${Ipon.money(net)} net income.`;
      }
    }

    setMoneyDisplay(kpiAvailableEl, Ipon.money(available));
    if (kpiAvailableSubEl) kpiAvailableSubEl.textContent = `Gross ${Ipon.money(gross)} − ${pctLabel} savings (${Ipon.money(mandatory)})`;
    setMoneyDisplay(kpiExpensesEl, Ipon.money(expenses));
    if (kpiExpensesSubEl) {
      const count = Number(t.expense_count || 0);
      kpiExpensesSubEl.textContent = `${count} recorded expense${count === 1 ? '' : 's'} · ${ratio}% of available`;
    }
    if (kpiNetEl) {
      setMoneyDisplay(kpiNetEl, formatSignedMoney(net));
      kpiNetEl.classList.toggle('is-negative', isDeficit);
      kpiNetEl.classList.toggle('is-positive', net > 0);
    }
    if (kpiNetSubEl) {
      kpiNetSubEl.textContent = isDeficit
        ? `Deficit of ${Ipon.money(Math.abs(net))} beyond available income`
        : 'Available monthly income minus expenses';
    }

    // Immediate visible totals directly inside the switcher & active view summaries
    setMoneyDisplay(segIncomeTotalEl, Ipon.money(available));
    setMoneyDisplay(segExpenseTotalEl, Ipon.money(expenses));

    setMoneyDisplay(incGrossEl, Ipon.money(gross));
    if (incGrossSubEl) {
      const c = Number(t.income_count || 0);
      incGrossSubEl.textContent = `${c} income source${c === 1 ? '' : 's'} in ${monthLabel(selectedYear, selectedMonth)}`;
    }
    if (incSavingsLabelEl) incSavingsLabelEl.textContent = `Less: Mandatory Savings (${pctLabel})`;
    setMoneyDisplay(incSavingsEl, `−${Ipon.money(mandatory)}`);
    if (incSavingsSubEl) incSavingsSubEl.textContent = `Automatically deducted (${pctLabel} of gross income)`;
    setMoneyDisplay(incAvailableEl, Ipon.money(available));

    setMoneyDisplay(expTotalEl, Ipon.money(expenses));
    if (expTotalSubEl) expTotalSubEl.textContent = `${ratio}% of ${Ipon.money(available)} available income`;
    if (expCountEl) {
      const c = Number(t.expense_count || 0);
      expCountEl.textContent = `${c} ${c === 1 ? 'expense' : 'expenses'}`;
    }
    const topCat = Array.isArray(data?.expense_breakdown) && data.expense_breakdown.length ? data.expense_breakdown[0] : null;
    if (expCountSubEl) {
      expCountSubEl.textContent = topCat
        ? `Top: ${topCat.category} (${Ipon.money(topCat.total)})`
        : `No expenses logged for ${monthLabel(selectedYear, selectedMonth)}`;
    }
    if (expRemainingEl) {
      setMoneyDisplay(expRemainingEl, formatSignedMoney(net));
      expRemainingEl.classList.toggle('is-negative', isDeficit);
      expRemainingEl.classList.toggle('is-positive', net > 0);
    }
    if (expRemainingSubEl) {
      expRemainingSubEl.textContent = isDeficit
        ? `Over available income by ${Ipon.money(Math.abs(net))}`
        : 'Net monthly income remaining';
    }
  }

  function renderIncomeList(data) {
    if (!incomeBody) return;
    const rows = Array.isArray(data?.incomes) ? data.incomes : [];
    const query = String(incSearchInput?.value || '').trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (!query) return true;
      return String(row.category || '').toLowerCase().includes(query)
        || String(row.description || '').toLowerCase().includes(query);
    });

    if (!filtered.length) {
      incomeBody.innerHTML = `<tr class="cf-empty-tr"><td colspan="6"><div class="empty-state cf-empty-box"><strong>${query ? 'No matching income sources' : `No income recorded for ${Ipon.escapeHtml(monthLabel(selectedYear, selectedMonth))}`}</strong><small>${query ? 'Try a different search keyword.' : 'Add your salary, business, freelance, or other monthly income sources. Mandatory savings will deduct automatically.'}</small>${query ? '' : '<button class="button button-primary button-sm" type="button" data-cf-empty-add="INCOME">+ Add income source</button>'}</div></td></tr>`;
      return;
    }

    incomeBody.innerHTML = filtered.map((row, idx) => `
      <tr data-cf-entry-id="${Ipon.escapeHtml(row.id)}">
        <td class="cf-col-index"><span class="cf-row-num tabular-nums">${idx + 1}</span></td>
        <td class="cf-col-cat"><span class="cf-cat-pill" title="${Ipon.escapeHtml(row.category)}">${Ipon.escapeHtml(row.category)}</span></td>
        <td class="cf-col-desc"><span class="cf-desc-text" title="${Ipon.escapeHtml(row.description || '')}">${row.description ? Ipon.escapeHtml(row.description) : '<span class="field-help">—</span>'}</span></td>
        <td class="cf-col-date">${Ipon.dateLabel(row.entry_date)}</td>
        <td class="cf-col-amount cf-amount-cell is-income tabular-nums">${formatMoneyWithSmallCentsHtml(Ipon.money(row.amount))}</td>
        <td class="cf-col-actions cf-actions-cell">
          <div class="table-actions">
            <button class="icon-action" type="button" data-cf-edit-income="${Ipon.escapeHtml(row.id)}">Edit</button>
            <button class="icon-action danger-action" type="button" data-cf-delete-entry="${Ipon.escapeHtml(row.id)}" data-cf-delete-type="INCOME">Delete</button>
          </div>
        </td>
      </tr>`).join('');
  }

  function syncExpenseFilterOptions(data) {
    if (!expCatFilter) return;
    const prev = expCatFilter.value || '';
    const seen = new Map();
    EXPENSE_PRESETS.forEach((cat) => seen.set(cat.toLowerCase(), cat));
    (data?.expenses || []).forEach((row) => {
      const clean = String(row.category || '').trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    });
    expCatFilter.innerHTML = `<option value="">All categories</option>${[...seen.values()].map((c) => `<option value="${Ipon.escapeHtml(c)}">${Ipon.escapeHtml(c)}</option>`).join('')}`;
    if (prev && [...seen.values()].some((c) => c.toLowerCase() === prev.toLowerCase())) {
      const exact = [...seen.values()].find((c) => c.toLowerCase() === prev.toLowerCase());
      expCatFilter.value = exact || '';
    } else {
      expCatFilter.value = '';
    }
  }

  function renderExpenseListAndBreakdown(data) {
    const rows = Array.isArray(data?.expenses) ? data.expenses : [];
    const breakdown = Array.isArray(data?.expense_breakdown) ? data.expense_breakdown : [];
    const query = String(expSearchInput?.value || '').trim().toLowerCase();
    const activeCat = String(expCatFilter?.value || '').trim().toLowerCase();

    const filtered = rows.filter((row) => {
      if (activeCat && String(row.category || '').trim().toLowerCase() !== activeCat) return false;
      if (!query) return true;
      return String(row.category || '').toLowerCase().includes(query)
        || String(row.description || '').toLowerCase().includes(query);
    });

    if (expenseBody) {
      if (!filtered.length) {
        expenseBody.innerHTML = `<tr class="cf-empty-tr"><td colspan="6"><div class="empty-state cf-empty-box"><strong>${query || activeCat ? 'No matching monthly expenses' : `No expenses recorded for ${Ipon.escapeHtml(monthLabel(selectedYear, selectedMonth))}`}</strong><small>${query || activeCat ? 'Clear your search or category filter to view all entries.' : 'Record your food, bills, transportation, and other monthly expenses to see your real net monthly income.'}</small>${query || activeCat ? '' : '<button class="button button-primary button-sm" type="button" data-cf-empty-add="EXPENSE">+ Add monthly expense</button>'}</div></td></tr>`;
      } else {
        expenseBody.innerHTML = filtered.map((row, idx) => `
          <tr data-cf-entry-id="${Ipon.escapeHtml(row.id)}">
            <td class="cf-col-index"><span class="cf-row-num tabular-nums">${idx + 1}</span></td>
            <td class="cf-col-cat"><span class="cf-cat-pill ${categoryToneClass(row.category, 'EXPENSE')}" title="${Ipon.escapeHtml(row.category)}">${Ipon.escapeHtml(row.category)}</span></td>
            <td class="cf-col-desc"><span class="cf-desc-text" title="${Ipon.escapeHtml(row.description || '')}">${row.description ? Ipon.escapeHtml(row.description) : '<span class="field-help">—</span>'}</span></td>
            <td class="cf-col-date">${Ipon.dateLabel(row.entry_date)}</td>
            <td class="cf-col-amount cf-amount-cell is-expense tabular-nums">${formatMoneyWithSmallCentsHtml(Ipon.money(row.amount))}</td>
            <td class="cf-col-actions cf-actions-cell">
              <div class="table-actions">
                <button class="icon-action" type="button" data-cf-edit-expense="${Ipon.escapeHtml(row.id)}">Edit</button>
                <button class="icon-action danger-action" type="button" data-cf-delete-entry="${Ipon.escapeHtml(row.id)}" data-cf-delete-type="EXPENSE">Delete</button>
              </div>
            </td>
          </tr>`).join('');
      }
    }

    if (breakdownWrap && breakdownList) {
      breakdownWrap.hidden = !breakdown.length;
      breakdownList.innerHTML = breakdown.map((item) => {
        const pct = Math.min(100, Math.max(0, Number(item.share_pct || 0)));
        const selected = activeCat && String(item.category || '').toLowerCase() === activeCat;
        return `
          <button class="cf-breakdown-item${selected ? ' is-active' : ''}" type="button" data-cf-breakdown-cat="${Ipon.escapeHtml(item.category)}" aria-pressed="${selected ? 'true' : 'false'}">
            <div class="cf-breakdown-row">
              <span class="cf-breakdown-name">${Ipon.escapeHtml(item.category)}</span>
              <span class="cf-breakdown-val tabular-nums">${formatMoneyWithSmallCentsHtml(Ipon.money(item.total))}</span>
            </div>
            <div class="cf-breakdown-bar" aria-hidden="true"><span style="width:${pct}%"></span></div>
            <div class="cf-breakdown-meta tabular-nums">
              <span>${item.count} entr${item.count === 1 ? 'y' : 'ies'}</span>
              <span>${pct}% of expenses</span>
            </div>
          </button>`;
      }).join('');
    }
  }

  function buildComparableMonthsMap(data) {
    const map = new Map();
    const trend = Array.isArray(data?.comparison_trend) ? data.comparison_trend : [];
    const history = Array.isArray(data?.monthly_history) ? data.monthly_history : [];
    [...trend, ...history].forEach((pt) => {
      const yr = Number(pt.year);
      const mo = Number(pt.month);
      if (!Number.isFinite(yr) || !Number.isFinite(mo)) return;
      map.set(`${yr}-${mo}`, {
        year: yr,
        month: mo,
        available_income: roundCentavos(pt.available_income || 0),
        total_expenses: roundCentavos(pt.total_expenses || 0),
        net_income: roundCentavos(pt.net_income || 0),
        gross_income: roundCentavos(pt.gross_income || 0),
        mandatory_savings: roundCentavos(pt.mandatory_savings || 0)
      });
    });
    const activeKey = `${selectedYear}-${selectedMonth}`;
    if (data?.totals) {
      map.set(activeKey, {
        year: selectedYear,
        month: selectedMonth,
        available_income: roundCentavos(data.totals.available_income || 0),
        total_expenses: roundCentavos(data.totals.total_expenses || 0),
        net_income: roundCentavos(data.totals.net_income || 0),
        gross_income: roundCentavos(data.totals.gross_income || 0),
        mandatory_savings: roundCentavos(data.totals.mandatory_savings || 0)
      });
    }
    return map;
  }

  function prevMonthKey(year, month) {
    const dt = new Date(Date.UTC(year, month - 2, 1));
    return `${dt.getUTCFullYear()}-${dt.getUTCMonth() + 1}`;
  }

  function renderComparisonPanel(data) {
    if (chartTitleEl) {
      chartTitleEl.textContent = compareMode ? 'Comparing 2 months' : 'Income vs. expenses (6 months)';
    }
    if (compareToggleBtn) compareToggleBtn.setAttribute('aria-pressed', compareMode ? 'true' : 'false');
    if (compareLegendEl) compareLegendEl.hidden = !compareMode;
    if (chartHintEl) {
      chartHintEl.textContent = compareMode
        ? 'Showing only your 2 compared months'
        : 'Tap a month bar to inspect';
    }
    if (!comparePanelEl) return;
    comparePanelEl.hidden = !compareMode;
    if (!compareMode) return;

    const map = buildComparableMonthsMap(data);
    const activeKey = `${selectedYear}-${selectedMonth}`;
    const defaultPrevKey = prevMonthKey(selectedYear, selectedMonth);
    const options = [...map.entries()]
      .filter(([key]) => key !== activeKey)
      .sort((a, b) => (b[1].year - a[1].year) || (b[1].month - a[1].month));

    if (!compareTargetKey || compareTargetKey === activeKey || !map.has(compareTargetKey)) {
      compareTargetKey = map.has(defaultPrevKey) ? defaultPrevKey : (options[0]?.[0] || '');
    }

    if (comparePrimaryLabelEl) comparePrimaryLabelEl.textContent = monthLabel(selectedYear, selectedMonth);
    if (compareSelectEl) {
      compareSelectEl.innerHTML = options.length
        ? options.map(([key, item]) => `<option value="${key}">${Ipon.escapeHtml(monthLabel(item.year, item.month))}</option>`).join('')
        : '<option value="">No other month</option>';
      if (compareTargetKey) compareSelectEl.value = compareTargetKey;
    }

    const current = map.get(activeKey) || { available_income: 0, total_expenses: 0, net_income: 0 };
    const other = map.get(compareTargetKey) || { year: selectedYear, month: selectedMonth, available_income: 0, total_expenses: 0, net_income: 0 };
    const otherShort = other.year ? `${MONTH_SHORT[(other.month - 1) % 12]} ${String(other.year).slice(-2)}` : 'Prev';

    const formatDelta = (diff, higherIsBetter) => {
      const val = roundCentavos(diff);
      if (val === 0) return { text: 'Same', cls: '' };
      const sign = val > 0 ? '+' : '−';
      const cls = (val > 0 ? higherIsBetter : !higherIsBetter) ? 'is-good' : 'is-bad';
      return { text: `${sign}${Ipon.money(Math.abs(val))}`, cls };
    };

    const availDelta = formatDelta(current.available_income - other.available_income, true);
    const expDelta = formatDelta(current.total_expenses - other.total_expenses, false);
    const netDelta = formatDelta(current.net_income - other.net_income, true);

    if (compareGridEl) {
      const cards = [
        { label: 'Available income', cur: Ipon.money(current.available_income), prev: Ipon.money(other.available_income), delta: availDelta },
        { label: 'Monthly expenses', cur: Ipon.money(current.total_expenses), prev: Ipon.money(other.total_expenses), delta: expDelta },
        { label: 'Net income', cur: formatSignedMoney(current.net_income), prev: formatSignedMoney(other.net_income), delta: netDelta }
      ];
      compareGridEl.innerHTML = cards.map((card) => `
        <div class="cf-compare-metric">
          <span class="cf-compare-metric-label">${Ipon.escapeHtml(card.label)}</span>
          <strong class="cf-compare-main-val">${formatMoneyWithSmallCentsHtml(card.cur)}</strong>
          <div class="cf-compare-sub-row">
            <span>${Ipon.escapeHtml(otherShort)}: ${Ipon.escapeHtml(card.prev)}</span>
            <span class="cf-delta-pill ${card.delta.cls}">${Ipon.escapeHtml(card.delta.text)}</span>
          </div>
        </div>`).join('');
    }
  }

  function renderInsights(data) {
    const trend = Array.isArray(data?.comparison_trend) ? data.comparison_trend : [];
    const history = Array.isArray(data?.monthly_history) ? data.monthly_history : [];

    if (chartRangeEl && trend.length) {
      const first = trend[0];
      const last = trend[trend.length - 1];
      const firstLbl = `${MONTH_SHORT[(Number(first.month) - 1) % 12]} ${String(first.year).slice(-2)}`;
      const lastLbl = `${MONTH_SHORT[(Number(last.month) - 1) % 12]} ${String(last.year).slice(-2)}`;
      chartRangeEl.textContent = `${firstLbl} – ${lastLbl}`;
    }

    renderComparisonPanel(data);

    if (chartBarsWrap) {
      const compMap = buildComparableMonthsMap(data);
      const activeKey = `${selectedYear}-${selectedMonth}`;
      let pointsToRender = trend;
      if (compareMode) {
        const primaryPt = compMap.get(activeKey) || {
          year: selectedYear,
          month: selectedMonth,
          available_income: Number(data?.totals?.available_income || 0),
          total_expenses: Number(data?.totals?.total_expenses || 0),
          net_income: Number(data?.totals?.net_income || 0)
        };
        const comparePt = compareTargetKey && compareTargetKey !== activeKey ? compMap.get(compareTargetKey) : null;
        pointsToRender = comparePt ? [primaryPt, comparePt] : [primaryPt];
      }
      chartBarsWrap.classList.toggle('is-compare-only', compareMode);

      if (!pointsToRender.length) {
        chartBarsWrap.innerHTML = '<div class="empty-state cf-empty-box" style="grid-column:1/-1"><strong>No monthly trend data yet</strong><small>Record income or expenses to compare monthly performance.</small></div>';
      } else {
        const maxVal = Math.max(
          1,
          ...pointsToRender.map((pt) => Math.max(Number(pt.available_income || 0), Number(pt.total_expenses || 0)))
        );
        chartBarsWrap.innerHTML = pointsToRender.map((pt) => {
          const yr = Number(pt.year);
          const mo = Number(pt.month);
          const key = `${yr}-${mo}`;
          const avail = Number(pt.available_income || 0);
          const exp = Number(pt.total_expenses || 0);
          const net = Number(pt.net_income || 0);
          const availH = avail > 0 ? Math.max(8, Math.round((avail / maxVal) * 100)) : 3;
          const expH = exp > 0 ? Math.max(8, Math.round((exp / maxVal) * 100)) : 3;
          const isSelected = yr === selectedYear && mo === selectedMonth;
          const isCompared = compareMode && !isSelected && compareTargetKey === key;
          const label = compareMode
            ? monthLabel(yr, mo)
            : `${MONTH_SHORT[(mo - 1) % 12]} ${String(yr).slice(-2)}`;
          const tip = `${monthLabel(yr, mo)} — Available: ${Ipon.money(avail)}, Expenses: ${Ipon.money(exp)}, Net: ${formatSignedMoney(net)}`;
          const tagHtml = compareMode
            ? (isSelected ? '<span class="cf-bar-tag is-primary">Current</span>' : '<span class="cf-bar-tag">VS</span>')
            : '';
          const compareMetaHtml = compareMode
            ? `<div class="cf-bar-compare-meta tabular-nums"><span class="is-avail">Avail ${formatCompactPeso(avail)}</span><span class="is-exp">Exp ${formatCompactPeso(exp)}</span></div>`
            : '';
          return `
            <button class="cf-bar-col${isSelected ? ' is-selected' : ''}${isCompared ? ' is-compare' : ''}" type="button" data-cf-chart-ym="${key}" title="${Ipon.escapeHtml(tip)}" aria-label="${Ipon.escapeHtml(tip)}">
              ${tagHtml}
              <div class="cf-bar-pair" aria-hidden="true">
                <span class="cf-bar is-avail" style="height:${availH}%"></span>
                <span class="cf-bar is-exp" style="height:${expH}%"></span>
              </div>
              <span class="cf-bar-month">${Ipon.escapeHtml(label)}</span>
              <span class="cf-bar-net tabular-nums${net < 0 ? ' is-negative' : ''}">${compareMode ? `Net ${formatCompactPeso(net)}` : formatCompactPeso(net)}</span>
              ${compareMetaHtml}
            </button>`;
        }).join('');

        if (compareMode) {
          if ('scrollLeft' in chartBarsWrap) chartBarsWrap.scrollLeft = 0;
        } else if (Number(chartBarsWrap.scrollWidth) > Number(chartBarsWrap.clientWidth)) {
          const activeCol = typeof chartBarsWrap.querySelector === 'function'
            ? chartBarsWrap.querySelector('.cf-bar-col.is-selected')
            : null;
          if (activeCol && typeof activeCol.offsetLeft === 'number') {
            const targetLeft = activeCol.offsetLeft - Math.max(0, (chartBarsWrap.clientWidth - activeCol.offsetWidth) / 2);
            chartBarsWrap.scrollLeft = Math.max(0, targetLeft);
          }
        }
      }
    }

    if (historyListEl) {
      if (!history.length) {
        historyListEl.innerHTML = '<div class="empty-state cf-empty-box"><strong>No saved months yet</strong><small>Each month you record appears here so you can switch back anytime without mixing months.</small></div>';
      } else {
        historyListEl.innerHTML = history.map((item) => {
          const yr = Number(item.year);
          const mo = Number(item.month);
          const avail = Number(item.available_income || 0);
          const exp = Number(item.total_expenses || 0);
          const net = Number(item.net_income || 0);
          const isSelected = yr === selectedYear && mo === selectedMonth;
          const isNeg = net < 0;
          return `
            <button class="cf-history-row${isSelected ? ' is-selected' : ''}" type="button" data-cf-jump-ym="${yr}-${mo}">
              <div class="cf-history-left">
                <strong>${Ipon.escapeHtml(monthLabel(yr, mo))}</strong>
                <small class="tabular-nums">Avail ${Ipon.money(avail)} · Exp ${Ipon.money(exp)} · ${formatPct(item.mandatory_savings_pct)} saved</small>
              </div>
              <div class="cf-history-right tabular-nums">
                <span class="cf-history-net${isNeg ? ' is-negative' : ''}">${formatMoneyWithSmallCentsHtml(formatSignedMoney(net))}</span>
                <span class="cf-history-status${isNeg ? ' is-negative' : ''}">${isNeg ? 'Deficit' : 'Surplus'}</span>
              </div>
            </button>`;
        }).join('');
      }
    }
  }

  function renderAll(data) {
    renderSummary(data);
    renderIncomeList(data);
    syncExpenseFilterOptions(data);
    renderExpenseListAndBreakdown(data);
    renderInsights(data);
  }

  function renderEntryPresets(entryType) {
    if (!entryCatPresetsEl) return;
    const list = entryType === 'EXPENSE' ? EXPENSE_PRESETS : INCOME_PRESETS;
    const current = String(entryCatInput?.value || '').trim().toLowerCase();
    entryCatPresetsEl.innerHTML = list.map((label) => {
      const selected = current === label.toLowerCase();
      return `<button class="cf-preset-chip${selected ? ' is-selected' : ''}" type="button" data-cf-preset="${Ipon.escapeHtml(label)}">${Ipon.escapeHtml(label)}</button>`;
    }).join('');
  }

  function syncEntryImpactPreview() {
    const type = entryTypeInput?.value === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
    const editingId = entryIdInput?.value || '';
    const pct = Number(monitorData?.mandatory_savings_pct ?? 20);
    const incomes = [...(monitorData?.incomes || [])];
    const expenses = [...(monitorData?.expenses || [])];
    const raw = String(entryAmountInput?.value ?? '').trim();
    const parsed = raw ? Ipon.parseMoneyAmount(raw, { min: 0.01, max: 999999999999.99, required: true, label: 'Amount', badInput: entryAmountInput?.validity?.badInput }) : { valid: false, value: 0 };
    const nextAmt = parsed.valid ? parsed.value : 0;

    const list = type === 'INCOME' ? incomes : expenses;
    const idx = editingId ? list.findIndex((r) => r.id === editingId) : -1;
    if (idx >= 0) list[idx] = { ...list[idx], amount: nextAmt };
    else if (nextAmt > 0) list.push({ id: '__preview__', amount: nextAmt });

    const preview = computeTotals(incomes, expenses, pct);
    if (entryImpactPrimaryLabel) {
      entryImpactPrimaryLabel.textContent = type === 'INCOME'
        ? `Projected Available (after ${formatPct(pct)})`
        : 'Projected Total Expenses';
    }
    if (entryImpactPrimaryVal) {
      setMoneyDisplay(entryImpactPrimaryVal, type === 'INCOME'
        ? Ipon.money(preview.available_income)
        : Ipon.money(preview.total_expenses));
    }
    if (entryImpactNetVal) {
      setMoneyDisplay(entryImpactNetVal, formatSignedMoney(preview.net_income));
      entryImpactNetVal.classList.toggle('is-negative', preview.net_income < 0);
      entryImpactNetVal.classList.toggle('is-positive', preview.net_income > 0);
    }
  }

  function validateEntryCategoryLive() {
    if (!entryCatInput) return false;
    const clean = entryCatInput.value.trim().replace(/\s+/g, ' ');
    if (!clean) {
      Ipon.setFieldError(entryCatInput, entryTypeInput?.value === 'EXPENSE' ? 'Enter or pick an expense category.' : 'Enter or pick an income source.');
      return false;
    }
    if (clean.length > 80) {
      Ipon.setFieldError(entryCatInput, 'Maximum of 80 characters allowed.');
      return false;
    }
    Ipon.setFieldError(entryCatInput, '');
    return true;
  }

  function validateEntryAmountLive() {
    if (!entryAmountInput) return false;
    const check = Ipon.parseMoneyAmount(entryAmountInput.value, {
      min: 0.01,
      max: 999999999999.99,
      required: true,
      label: 'Amount',
      badInput: entryAmountInput.validity?.badInput
    });
    if (!check.valid) {
      Ipon.setFieldError(entryAmountInput, check.error);
      return false;
    }
    Ipon.setFieldError(entryAmountInput, '');
    return true;
  }

  function openEntryDialog({ type = 'INCOME', entry = null } = {}) {
    if (!entryDialog || !entryForm) return;
    const cleanType = type === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
    entryForm.reset();
    if (entryIdInput) entryIdInput.value = entry?.id || '';
    if (entryTypeInput) entryTypeInput.value = cleanType;

    const isEdit = Boolean(entry?.id);
    if (entryEyebrowEl) entryEyebrowEl.textContent = isEdit ? (cleanType === 'EXPENSE' ? 'EDIT EXPENSE' : 'EDIT INCOME') : (cleanType === 'EXPENSE' ? 'NEW EXPENSE' : 'NEW INCOME');
    if (entryTitleEl) entryTitleEl.textContent = isEdit ? (cleanType === 'EXPENSE' ? 'Edit monthly expense' : 'Edit income source') : (cleanType === 'EXPENSE' ? 'Add monthly expense' : 'Add income source');
    if (entryCopyEl) {
      entryCopyEl.textContent = cleanType === 'EXPENSE'
        ? `Recorded strictly under ${monthLabel(selectedYear, selectedMonth)}. Updates total expenses and net income immediately.`
        : `Recorded strictly under ${monthLabel(selectedYear, selectedMonth)}. Mandatory savings (${formatPct(monitorData?.mandatory_savings_pct ?? 20)}) deducts automatically.`;
    }
    if (entryCatLabelEl) entryCatLabelEl.textContent = cleanType === 'EXPENSE' ? 'Expense category (or custom)' : 'Income source / category';
    if (entryCatInput) {
      entryCatInput.placeholder = cleanType === 'EXPENSE' ? 'e.g., Food, Bills, or custom category' : 'e.g., Salary, Freelance, Business';
      entryCatInput.value = entry?.category || '';
      Ipon.setFieldError(entryCatInput, '');
    }
    if (entryDescInput) {
      entryDescInput.placeholder = cleanType === 'EXPENSE' ? 'e.g., Weekly groceries or electricity bill' : 'e.g., Bi-monthly paycheck or client project';
      entryDescInput.value = entry?.description || '';
    }
    if (entryAmountInput) {
      entryAmountInput.value = entry ? String(entry.amount) : '';
      Ipon.setFieldError(entryAmountInput, '');
    }
    const bounds = monthBounds(selectedYear, selectedMonth);
    if (entryDateInput) {
      entryDateInput.min = bounds.min;
      entryDateInput.max = bounds.max;
      const todayIso = typeof Ipon.isoDate === 'function' ? Ipon.isoDate() : bounds.min;
      const defaultDate = (todayIso >= bounds.min && todayIso <= bounds.max) ? todayIso : bounds.min;
      entryDateInput.value = entry?.entry_date || defaultDate;
      Ipon.setFieldError(entryDateInput, '');
    }
    if (entrySubmitBtn) {
      entrySubmitBtn.textContent = isEdit ? 'Save changes' : (cleanType === 'EXPENSE' ? '+ Add expense' : '+ Add income');
    }

    renderEntryPresets(cleanType);
    syncEntryImpactPreview();
    entryDialog.showModal();
    entryCatInput?.focus();
  }

  function renderRatePresets() {
    if (!ratePresetsEl) return;
    const current = roundCentavos(rateInput?.value ?? 20);
    ratePresetsEl.innerHTML = RATE_PRESETS.map((pct) => {
      const active = Math.abs(current - pct) < 0.005;
      return `<button class="cf-preset-chip${active ? ' is-selected' : ''}" type="button" data-cf-rate-preset="${pct}">${pct}%${pct === 20 ? ' (Default)' : ''}</button>`;
    }).join('');
  }

  function syncRatePreview() {
    const check = Ipon.parseMoneyAmount(rateInput?.value, {
      min: 0,
      max: 100,
      required: true,
      label: 'Mandatory savings %',
      badInput: rateInput?.validity?.badInput
    });
    const pct = check.valid ? check.value : 0;
    const gross = Number(monitorData?.totals?.gross_income || 0);
    const deduct = roundCentavos((gross * pct) / 100);
    const avail = roundCentavos(gross - deduct);

    setMoneyDisplay(ratePreviewGross, Ipon.money(gross));
    setMoneyDisplay(ratePreviewDeduct, `−${Ipon.money(deduct)}`);
    setMoneyDisplay(ratePreviewAvail, Ipon.money(avail));
    if (rateInput) Ipon.setFieldError(rateInput, check.valid ? '' : check.error);
    if (rateSubmitBtn) rateSubmitBtn.disabled = !check.valid;
    renderRatePresets();
    return check.valid;
  }

  function openRateDialog() {
    if (!rateDialog || !rateForm) return;
    if (rateInput) rateInput.value = String(monitorData?.mandatory_savings_pct ?? 20);
    syncRatePreview();
    rateDialog.showModal();
    rateInput?.focus();
    rateInput?.select();
  }

  async function loadMonitor() {
    const seq = ++loadSeq;
    if (errorSlot) {
      errorSlot.hidden = true;
      errorSlot.replaceChildren();
    }
    try {
      const data = await Ipon.rpc('get_monthly_monitor', {
        p_year: selectedYear,
        p_month: selectedMonth
      });
      if (seq !== loadSeq) return;
      monitorData = data || {
        year: selectedYear,
        month: selectedMonth,
        mandatory_savings_pct: 20,
        totals: computeTotals([], [], 20),
        incomes: [],
        expenses: [],
        expense_breakdown: [],
        comparison_trend: [],
        monthly_history: []
      };
      renderAll(monitorData);
    } catch (error) {
      if (seq !== loadSeq) return;
      Ipon.showInlineError(errorSlot, error, loadMonitor);
    }
  }

  // Bind top Budget mode switcher & sub-view switcher
  modeTabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      applyPageMode(btn.dataset.budgetModeTab || 'monitor');
    });
  });

  // Auto-switch to Allocation tab if the interactive tutorial opens a spotlight targeting Allocation elements
  window.addEventListener('ipon:budget-mode', (event) => {
    const nextMode = event?.detail?.mode;
    if (nextMode === 'monitor' || nextMode === 'allocation') {
      applyPageMode(nextMode);
    }
  });

  segIncomeBtn?.addEventListener('click', () => applySubView('income'));
  segExpenseBtn?.addEventListener('click', () => applySubView('expense'));

  prevMonthBtn?.addEventListener('click', () => shiftMonth(-1));
  nextMonthBtn?.addEventListener('click', () => shiftMonth(1));
  todayMonthBtn?.addEventListener('click', () => {
    const cur = currentManilaYearMonth();
    selectedYear = cur.year;
    selectedMonth = cur.month;
    if (expCatFilter) expCatFilter.value = '';
    syncMonthControls();
    return loadMonitor();
  });
  monthInput?.addEventListener('change', () => {
    const [y, m] = String(monthInput.value || '').split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || y < 2000 || y > 2100 || m < 1 || m > 12) {
      syncMonthControls();
      return;
    }
    selectedYear = y;
    selectedMonth = m;
    if (expCatFilter) expCatFilter.value = '';
    syncMonthControls();
    return loadMonitor();
  });

  rateOpenBtn?.addEventListener('click', openRateDialog);
  incSavingsEditBtn?.addEventListener('click', openRateDialog);
  addIncomeBtn?.addEventListener('click', () => openEntryDialog({ type: 'INCOME' }));
  addExpenseBtn?.addEventListener('click', () => openEntryDialog({ type: 'EXPENSE' }));

  document.getElementById('cf-entry-close')?.addEventListener('click', () => entryDialog?.close());
  document.getElementById('cf-entry-cancel')?.addEventListener('click', () => entryDialog?.close());
  document.getElementById('cf-rate-close')?.addEventListener('click', () => rateDialog?.close());
  document.getElementById('cf-rate-cancel')?.addEventListener('click', () => rateDialog?.close());
  document.getElementById('cf-rate-reset')?.addEventListener('click', () => {
    if (rateInput) rateInput.value = '20';
    syncRatePreview();
  });

  // Live validation & input guards
  Ipon.guardMoneyInput(entryAmountInput, { min: 0.01, max: 999999999999.99, required: true, label: 'Amount', customDisplay: true });
  Ipon.guardMoneyInput(rateInput, { min: 0, max: 100, required: true, label: 'Mandatory savings %', customDisplay: true });

  entryCatInput?.addEventListener('input', () => {
    validateEntryCategoryLive();
    renderEntryPresets(entryTypeInput?.value || 'INCOME');
  });
  entryCatInput?.addEventListener('blur', validateEntryCategoryLive);
  entryAmountInput?.addEventListener('input', () => {
    validateEntryAmountLive();
    syncEntryImpactPreview();
  });
  entryAmountInput?.addEventListener('blur', () => {
    validateEntryAmountLive();
    syncEntryImpactPreview();
  });
  entryCatPresetsEl?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-cf-preset]');
    if (!chip || !entryCatInput) return;
    entryCatInput.value = chip.dataset.cfPreset || '';
    validateEntryCategoryLive();
    renderEntryPresets(entryTypeInput?.value || 'INCOME');
    if (entryDescInput && !entryDescInput.value) entryDescInput.focus();
    else entryAmountInput?.focus();
  });

  rateInput?.addEventListener('input', syncRatePreview);
  rateInput?.addEventListener('blur', syncRatePreview);
  ratePresetsEl?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-cf-rate-preset]');
    if (!chip || !rateInput) return;
    rateInput.value = chip.dataset.cfRatePreset || '20';
    syncRatePreview();
  });

  incSearchInput?.addEventListener('input', () => {
    if (monitorData) renderIncomeList(monitorData);
  });
  expSearchInput?.addEventListener('input', () => {
    if (monitorData) renderExpenseListAndBreakdown(monitorData);
  });
  expCatFilter?.addEventListener('change', () => {
    if (monitorData) renderExpenseListAndBreakdown(monitorData);
  });
  breakdownList?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-cf-breakdown-cat]');
    if (!btn || !expCatFilter) return;
    const cat = btn.dataset.cfBreakdownCat || '';
    expCatFilter.value = expCatFilter.value.toLowerCase() === cat.toLowerCase() ? '' : cat;
    if (monitorData) renderExpenseListAndBreakdown(monitorData);
  });

  async function handleTableClick(event) {
    const emptyAdd = event.target.closest('[data-cf-empty-add]');
    if (emptyAdd) {
      openEntryDialog({ type: emptyAdd.dataset.cfEmptyAdd || 'INCOME' });
      return;
    }
    const editInc = event.target.closest('[data-cf-edit-income]');
    if (editInc) {
      const target = (monitorData?.incomes || []).find((r) => r.id === editInc.dataset.cfEditIncome);
      if (target) openEntryDialog({ type: 'INCOME', entry: target });
      return;
    }
    const editExp = event.target.closest('[data-cf-edit-expense]');
    if (editExp) {
      const target = (monitorData?.expenses || []).find((r) => r.id === editExp.dataset.cfEditExpense);
      if (target) openEntryDialog({ type: 'EXPENSE', entry: target });
      return;
    }
    const delBtn = event.target.closest('[data-cf-delete-entry]');
    if (!delBtn) return;
    const id = delBtn.dataset.cfDeleteEntry;
    const delType = delBtn.dataset.cfDeleteType === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
    const list = delType === 'EXPENSE' ? (monitorData?.expenses || []) : (monitorData?.incomes || []);
    const target = list.find((r) => r.id === id);
    if (!target) return;
    const ok = await Ipon.confirmAction({
      title: delType === 'EXPENSE' ? 'Delete expense entry?' : 'Delete income source?',
      message: `Remove "${target.category}" (${Ipon.money(target.amount)}) from ${monthLabel(selectedYear, selectedMonth)}? All monthly totals and net income will recalculate immediately.`,
      acceptLabel: 'Delete'
    });
    if (!ok) return;
    Ipon.setBusy(delBtn, true, 'Deleting…');
    try {
      await Ipon.rpc('delete_monthly_monitor_entry', { p_entry_id: target.id });
      Ipon.toast(delType === 'EXPENSE' ? 'Expense deleted.' : 'Income source deleted.');
      await loadMonitor();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(delBtn, false);
    }
  }

  incomeBody?.addEventListener('click', handleTableClick);
  expenseBody?.addEventListener('click', handleTableClick);

  chartPrevBtn?.addEventListener('click', () => shiftMonth(-1));
  chartNextBtn?.addEventListener('click', () => shiftMonth(1));
  compareToggleBtn?.addEventListener('click', () => {
    compareMode = !compareMode;
    if (compareMode && (!compareTargetKey || compareTargetKey === `${selectedYear}-${selectedMonth}`)) {
      compareTargetKey = prevMonthKey(selectedYear, selectedMonth);
    }
    if (monitorData) renderInsights(monitorData);
  });
  compareSelectEl?.addEventListener('change', () => {
    compareTargetKey = compareSelectEl.value || '';
    if (monitorData) renderInsights(monitorData);
  });
  comparePrevBtn?.addEventListener('click', () => {
    compareTargetKey = prevMonthKey(selectedYear, selectedMonth);
    if (monitorData) renderInsights(monitorData);
  });
  compareCloseBtn?.addEventListener('click', () => {
    compareMode = false;
    if (monitorData) renderInsights(monitorData);
  });

  function handleChartBarClick(event) {
    const btn = event.target.closest('[data-cf-chart-ym]');
    if (!btn) return;
    const key = String(btn.dataset.cfChartYm || '');
    const [y, m] = key.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    if (compareMode) {
      if (y === selectedYear && m === selectedMonth) return;
      if (compareTargetKey === `${y}-${m}`) {
        compareSelectEl?.focus();
        return;
      }
      compareTargetKey = `${y}-${m}`;
      if (monitorData) renderInsights(monitorData);
      return;
    }
    selectedYear = y;
    selectedMonth = m;
    if (expCatFilter) expCatFilter.value = '';
    syncMonthControls();
    return loadMonitor();
  }

  function handleJumpMonth(event) {
    const btn = event.target.closest('[data-cf-jump-ym]');
    if (!btn) return;
    const [y, m] = String(btn.dataset.cfJumpYm || '').split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    selectedYear = y;
    selectedMonth = m;
    if (expCatFilter) expCatFilter.value = '';
    syncMonthControls();
    return loadMonitor();
  }
  chartBarsWrap?.addEventListener('click', handleChartBarClick);
  historyListEl?.addEventListener('click', handleJumpMonth);

  entryForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateEntryCategoryLive()) {
      entryCatInput?.focus();
      return;
    }
    if (!validateEntryAmountLive()) {
      entryAmountInput?.focus();
      return;
    }
    const amtCheck = Ipon.parseMoneyAmount(entryAmountInput?.value, {
      min: 0.01,
      max: 999999999999.99,
      required: true,
      label: 'Amount',
      badInput: entryAmountInput?.validity?.badInput
    });
    const bounds = monthBounds(selectedYear, selectedMonth);
    const chosenDate = entryDateInput?.value || bounds.min;
    if (chosenDate < bounds.min || chosenDate > bounds.max) {
      Ipon.setFieldError(entryDateInput, `Date must be inside ${monthLabel(selectedYear, selectedMonth)}.`);
      entryDateInput?.focus();
      return;
    }
    Ipon.setFieldError(entryDateInput, '');
    const type = entryTypeInput?.value === 'EXPENSE' ? 'EXPENSE' : 'INCOME';
    const isEdit = Boolean(entryIdInput?.value);

    Ipon.setBusy(entrySubmitBtn, true, 'Saving…');
    try {
      await Ipon.rpc('save_monthly_monitor_entry', {
        p_entry_id: entryIdInput?.value || null,
        p_entry_type: type,
        p_year: selectedYear,
        p_month: selectedMonth,
        p_category: entryCatInput.value.trim(),
        p_description: entryDescInput?.value?.trim() || null,
        p_amount: amtCheck.value,
        p_entry_date: chosenDate
      });
      entryDialog?.close();
      Ipon.toast(isEdit
        ? (type === 'EXPENSE' ? 'Expense updated.' : 'Income updated.')
        : (type === 'EXPENSE' ? 'Expense recorded.' : 'Income source added.'));
      await loadMonitor();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(entrySubmitBtn, false);
    }
  });

  rateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!syncRatePreview()) {
      rateInput?.focus();
      return;
    }
    const pct = roundCentavos(rateInput.value);
    Ipon.setBusy(rateSubmitBtn, true, 'Saving…');
    try {
      const updated = await Ipon.rpc('save_monthly_monitor_settings', {
        p_year: selectedYear,
        p_month: selectedMonth,
        p_mandatory_savings_pct: pct
      });
      rateDialog?.close();
      Ipon.toast(`Mandatory savings set to ${formatPct(pct)} for ${monthLabel(selectedYear, selectedMonth)}.`);
      if (updated && updated.totals) {
        monitorData = updated;
        renderAll(monitorData);
      } else {
        await loadMonitor();
      }
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(rateSubmitBtn, false);
    }
  });

  let mounted = false;

  async function mount(initState) {
    if (mounted) return;
    mounted = true;
    if (!initState || initState.failed || initState.redirecting || !initState.configured || !initState.profile) return;
    await loadMonitor();
    Ipon.subscribeToChanges(
      'cashflow-monitor',
      ['monthly_monitor_entries', 'monthly_monitor_settings'],
      loadMonitor
    );
  }

  applyPageMode(activeMode, { persist: false });
  applySubView(activeView, { persist: false });
  syncMonthControls();

  window.IponCashflowMonitor = {
    mount,
    reload: loadMonitor,
    computeTotals,
    applyPageMode,
    applySubView
  };
})();
