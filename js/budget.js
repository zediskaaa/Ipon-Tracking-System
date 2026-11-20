(async function () {
  'use strict';

  const CATEGORY_META = Object.freeze({
    NEEDS: {
      key: 'NEEDS',
      label: 'Needs',
      tone: 'is-needs',
      defaultPct: 50,
      summaryNote: 'Essentials like housing, utilities, groceries, transport, and insurance.',
      examples: ['Rent / Housing', 'Electricity & Water', 'Groceries', 'Transportation', 'Insurance']
    },
    WANTS: {
      key: 'WANTS',
      label: 'Wants',
      tone: 'is-wants',
      defaultPct: 30,
      summaryNote: 'Lifestyle, dining, shopping, entertainment, subscriptions, and travel.',
      examples: ['Dining Out', 'Entertainment', 'Shopping', 'Subscriptions', 'Travel']
    },
    SAVINGS: {
      key: 'SAVINGS',
      label: 'Savings',
      tone: 'is-savings',
      defaultPct: 20,
      summaryNote: 'Planned reserve allocation only (non-transfer): emergency, retirement, goals.',
      examples: ['Emergency Fund', 'Future Goals', 'Retirement', 'Investments', 'Additional Savings']
    }
  });

  const CATEGORY_ORDER = ['NEEDS', 'WANTS', 'SAVINGS'];
  const PAGE_SIZE = 15;
  const BUDGET_COIN_SVG = '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true"><rect width="44" height="44" rx="12" fill="var(--budget-hero-start, #0D3326)"/><ellipse cx="22" cy="29" rx="10" ry="4.5" fill="#E9C882"/><ellipse cx="22" cy="25" rx="10" ry="4.5" fill="#F6DFA6"/><path d="M22 20c0-5 2-8 7-9-.5 5-3 8-7 9Z" fill="#6CCB9A"/></svg>';

  const state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || state.redirecting) return;

  const groupBar = document.getElementById('budget-group-bar');
  const groupNameEl = document.getElementById('budget-group-name');
  const groupSwitcherWrap = document.getElementById('budget-group-switcher-wrap');
  const groupSelect = document.getElementById('budget-group-select');
  const errorSlot = document.getElementById('budget-error-slot');
  const noWorkspaceEl = document.getElementById('budget-no-workspace');
  const workspaceContent = document.getElementById('budget-workspace-content');
  const headerActions = document.getElementById('budget-header-actions');

  const splitHeadingEl = document.getElementById('budget-split-heading');
  const heroTagEl = document.getElementById('budget-hero-tag');
  const modeTitleEl = document.getElementById('budget-mode-title');
  const modeCopyEl = document.getElementById('budget-mode-copy');
  const sourceLabelEl = document.getElementById('budget-source-label');
  const ratioNeedsEl = document.getElementById('budget-ratio-needs');
  const ratioWantsEl = document.getElementById('budget-ratio-wants');
  const ratioSavingsEl = document.getElementById('budget-ratio-savings');
  const legendNeedsPct = document.getElementById('budget-legend-needs-pct');
  const legendWantsPct = document.getElementById('budget-legend-wants-pct');
  const legendSavingsPct = document.getElementById('budget-legend-savings-pct');
  const legendNeedsAmt = document.getElementById('budget-legend-needs-amt');
  const legendWantsAmt = document.getElementById('budget-legend-wants-amt');
  const legendSavingsAmt = document.getElementById('budget-legend-savings-amt');

  const refBalanceEl = document.getElementById('budget-ref-balance');
  const refNoteEl = document.getElementById('budget-ref-note');
  const totalAllocatedEl = document.getElementById('budget-total-allocated');
  const totalItemizedEl = document.getElementById('budget-total-itemized');
  const totalSpentEl = document.getElementById('budget-total-spent');
  const spentPctEl = document.getElementById('budget-spent-pct');
  const totalRemainingEl = document.getElementById('budget-total-remaining');
  const remainingNoteEl = document.getElementById('budget-remaining-note');
  const categoriesGrid = document.getElementById('budget-categories-grid');

  const expenseSearchInput = document.getElementById('budget-expense-search');
  const expenseFilterSelect = document.getElementById('budget-expense-filter');
  const expensesBody = document.getElementById('budget-expenses-body');
  const expenseDetailDialog = document.getElementById('budget-history-detail-dialog');
  const expenseDetailFields = document.getElementById('budget-history-detail-fields');
  const expenseDetailActions = document.getElementById('budget-history-detail-actions');
  const historyPager = document.getElementById('budget-history-pager');

  const itemDialog = document.getElementById('budget-item-dialog');
  const itemForm = document.getElementById('budget-item-form');
  const itemIdInput = document.getElementById('budget-item-id');
  const itemEyebrowEl = document.getElementById('budget-item-eyebrow');
  const itemCategorySelect = document.getElementById('budget-item-category');
  const itemNameInput = document.getElementById('budget-item-name');
  const itemAmountInput = document.getElementById('budget-item-amount');
  const itemSuggestions = document.getElementById('budget-item-suggestions');
  const itemBucketLabelEl = document.getElementById('budget-item-bucket-label');
  const itemBucketTotalEl = document.getElementById('budget-item-bucket-total');
  const itemUnallocatedEl = document.getElementById('budget-item-unallocated');
  const itemHeadroomHelp = document.getElementById('budget-item-headroom-help');
  const itemSubmitBtn = document.getElementById('budget-item-submit');

  const expenseDialog = document.getElementById('budget-expense-dialog');
  const expenseForm = document.getElementById('budget-expense-form');
  const expenseIdInput = document.getElementById('budget-expense-id');
  const expenseEyebrowEl = document.getElementById('budget-expense-eyebrow');
  const expenseItemWrap = document.getElementById('budget-expense-item-wrap');
  const expenseItemSelect = document.getElementById('budget-expense-item');
  const expenseSwitchNewBtn = document.getElementById('budget-expense-switch-new');
  const expenseSwitchExistingBtn = document.getElementById('budget-expense-switch-existing');
  const expenseNewItemFields = document.getElementById('budget-expense-new-item-fields');
  const expenseNewCategorySelect = document.getElementById('budget-expense-new-category');
  const expenseNewNameInput = document.getElementById('budget-expense-new-name');
  const expenseSuggestions = document.getElementById('budget-expense-suggestions');
  const expenseAmountInput = document.getElementById('budget-expense-amount');
  const expenseHeadroomHelp = document.getElementById('budget-expense-headroom-help');
  const expenseDateInput = document.getElementById('budget-expense-date');
  const expenseDeductWrap = document.getElementById('budget-expense-deduct-wrap');
  const expenseDeductInput = document.getElementById('budget-expense-deduct');
  const expenseDeductHelp = document.getElementById('budget-expense-deduct-help');
  const expenseMethodWrap = document.getElementById('budget-expense-method-wrap');
  const expenseMethodSelect = document.getElementById('budget-expense-method');
  const expenseNoteInput = document.getElementById('budget-expense-note');
  const expenseSubmitBtn = document.getElementById('budget-expense-submit');

  const splitDialog = document.getElementById('budget-split-dialog');
  const splitForm = document.getElementById('budget-split-form');
  const splitNeedsInput = document.getElementById('split-needs');
  const splitWantsInput = document.getElementById('split-wants');
  const splitSavingsInput = document.getElementById('split-savings');
  const splitNeedsPreview = document.getElementById('split-needs-preview');
  const splitWantsPreview = document.getElementById('split-wants-preview');
  const splitSavingsPreview = document.getElementById('split-savings-preview');
  const splitLiveNeedsEl = document.getElementById('split-live-needs');
  const splitLiveWantsEl = document.getElementById('split-live-wants');
  const splitLiveSavingsEl = document.getElementById('split-live-savings');
  const splitTotalBar = document.getElementById('budget-split-total-bar');
  const splitSumEl = document.getElementById('budget-split-sum');
  const splitStateLabelEl = document.getElementById('budget-split-state-label');
  const splitStatusIconEl = document.getElementById('budget-split-status-icon');
  const splitErrorEl = document.getElementById('budget-split-error');
  const splitSubmitBtn = document.getElementById('budget-split-submit');

  let overview = null;
  let myGroups = [];
  let expensePage = 0;

  if (!state.configured || !state.profile) {
    if (errorSlot) {
      Ipon.showInlineError(errorSlot, new Error('Connect Supabase to use Budget Allocation & Expense Tracking.'));
    }
    Ipon.setLoading(false);
    return;
  }

  function formatPct(value) {
    const num = Math.round((Number(value) || 0) * 100) / 100;
    return `${Number.isInteger(num) ? num : num.toFixed(2).replace(/\.?0+$/, '')}%`;
  }

  function roundCentavos(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
  }

  function computeSplitAmounts(balance, needsPct, wantsPct, savingsPct) {
    const ref = Math.max(0, roundCentavos(balance));
    let needs = roundCentavos((ref * needsPct) / 100);
    let wants = roundCentavos((ref * wantsPct) / 100);
    let savings = roundCentavos((ref * savingsPct) / 100);
    const diff = roundCentavos(ref - (needs + wants + savings));
    if (diff !== 0) {
      if (savingsPct > 0) savings = roundCentavos(savings + diff);
      else if (wantsPct > 0) wants = roundCentavos(wants + diff);
      else needs = roundCentavos(needs + diff);
    }
    return { NEEDS: needs, WANTS: wants, SAVINGS: savings };
  }

  function getBalanceSourceCopy(data) {
    const name = data.group_name || 'Active workspace';
    const pool = Number(data.reference_balance || 0);
    const deductedConfirmed = Number(data.deducted_confirmed || 0);
    if (deductedConfirmed > 0) {
      return `Live balance in "${name}" (${Ipon.money(pool)} starting pool minus ${Ipon.money(deductedConfirmed)} deducted from savings).`;
    }
    if (data.balance_source === 'SOLO_TRACKER') {
      return `Synced live with your Solo tracker "${name}". Expenses deducted here reduce tracked savings immediately.`;
    }
    if (data.balance_source === 'MEMBER_CONFIRMED') {
      return `Automatically pulled from your confirmed savings in "${name}". Planning expenses track your allocation without changing shared group funds.`;
    }
    return `Pulled from confirmed tracked savings in "${name}". Category budgets recalculate automatically as savings grow or deduct.`;
  }

  function formatPaymentMethodShort(method) {
    if (typeof Ipon.paymentMethodMeta === 'function') {
      return Ipon.paymentMethodMeta(method).label || 'Cash';
    }
    const clean = String(method || 'CASH').toUpperCase();
    return clean === 'BANK_TRANSFER' ? 'Bank transfer' : clean === 'GCASH' ? 'GCash' : clean === 'MAYA' ? 'Maya' : clean === 'OTHER' ? 'Other' : 'Cash';
  }

  function renderWorkspaceContext(groups, fallbackName = '') {
    myGroups = Array.isArray(groups) ? groups : [];
    const current = myGroups.find((g) => g.is_current) || myGroups[0] || null;
    if (current?.workspace_mode) Ipon.syncWorkspaceMode?.(current.workspace_mode);
    if (!groupBar) return;
    const activeName = current?.name || fallbackName || '';
    if (!activeName) {
      groupBar.hidden = true;
      return;
    }
    groupBar.hidden = false;
    if (groupNameEl) groupNameEl.textContent = activeName;
    if (groupSwitcherWrap && groupSelect) {
      if (myGroups.length > 1) {
        groupSwitcherWrap.hidden = false;
        Ipon.populateGroupSelect(groupSelect, myGroups, current?.group_id || state.profile.group_id || '');
      } else {
        groupSwitcherWrap.hidden = true;
      }
    }
  }

  function renderSummarySection(data) {
    const cfg = data.config || { needs_pct: 50, wants_pct: 30, savings_pct: 20 };
    const totals = data.totals || { allocated: 0, itemized: 0, spent: 0, remaining: 0 };
    const cats = data.categories || {};
    const refBalance = Number(data.reference_balance || 0);
    const currentSavings = Number(data.current_savings ?? refBalance);
    const rawBalance = Number(data.raw_savings_balance ?? currentSavings);
    const deductedConfirmed = Number(data.deducted_confirmed || 0);
    const deductedPending = Number(data.deducted_pending || 0);
    const spent = Number(totals.spent || 0);
    const remaining = Number(totals.remaining || 0);
    const fallbackAmounts = computeSplitAmounts(refBalance, cfg.needs_pct, cfg.wants_pct, cfg.savings_pct);
    const pctText = `${formatPct(cfg.needs_pct).replace('%', '')} / ${formatPct(cfg.wants_pct).replace('%', '')} / ${formatPct(cfg.savings_pct).replace('%', '')}`;

    if (splitHeadingEl) splitHeadingEl.textContent = pctText;
    if (sourceLabelEl) sourceLabelEl.textContent = getBalanceSourceCopy(data);

    const canDeduct = Boolean(data.can_deduct_savings);
    const heroTagSpan = heroTagEl?.querySelector?.('span');
    if (heroTagSpan) {
      heroTagSpan.textContent = canDeduct ? 'Synced with live IPON savings' : 'Auto-linked to existing IPON savings';
    }
    if (modeTitleEl && modeCopyEl) {
      if (canDeduct && data.role === 'ADMIN') {
        modeTitleEl.textContent = 'Live savings deduction enabled';
        modeCopyEl.textContent = 'Expenses with deduction enabled update your workspace Expenses and IPON Tracked Savings immediately.';
      } else if (canDeduct) {
        modeTitleEl.textContent = 'Treasurer deduction review mode';
        modeCopyEl.textContent = 'Deducted expenses submit for administrator approval before reducing group IPON savings.';
      } else {
        modeTitleEl.textContent = 'Personal monitoring mode';
        modeCopyEl.textContent = 'Group member plans monitor personal shares without deducting shared funds. Create a Solo workspace to deduct from personal savings.';
      }
    }

    [
      [ratioNeedsEl, cfg.needs_pct],
      [ratioWantsEl, cfg.wants_pct],
      [ratioSavingsEl, cfg.savings_pct]
    ].forEach(([segEl, rawPct]) => {
      if (!segEl) return;
      const pctVal = Math.max(0, Number(rawPct || 0));
      segEl.hidden = pctVal <= 0;
      segEl.style.flex = `${pctVal} 1 0`;
      segEl.style.width = `${pctVal}%`;
    });
    if (legendNeedsPct) legendNeedsPct.textContent = formatPct(cfg.needs_pct);
    if (legendWantsPct) legendWantsPct.textContent = formatPct(cfg.wants_pct);
    if (legendSavingsPct) legendSavingsPct.textContent = formatPct(cfg.savings_pct);
    if (legendNeedsAmt) legendNeedsAmt.textContent = Ipon.money(cats.NEEDS?.allocated ?? fallbackAmounts.NEEDS);
    if (legendWantsAmt) legendWantsAmt.textContent = Ipon.money(cats.WANTS?.allocated ?? fallbackAmounts.WANTS);
    if (legendSavingsAmt) legendSavingsAmt.textContent = Ipon.money(cats.SAVINGS?.allocated ?? fallbackAmounts.SAVINGS);

    if (refBalanceEl) refBalanceEl.textContent = Ipon.money(currentSavings);
    if (refNoteEl) {
      refNoteEl.hidden = rawBalance >= 0;
      refNoteEl.textContent = rawBalance < 0
        ? `Ledger balance ${Ipon.money(rawBalance)} (clamped to ₱0.00 for allocation)`
        : '';
    }

    if (totalAllocatedEl) totalAllocatedEl.textContent = Ipon.money(totals.allocated);
    if (totalItemizedEl) totalItemizedEl.textContent = `Itemized plan: ${Ipon.money(totals.itemized)}`;
    if (totalSpentEl) totalSpentEl.textContent = Ipon.money(spent);
    const usedRatio = refBalance > 0 ? Math.round((spent / refBalance) * 1000) / 10 : (spent > 0 ? 100 : 0);
    if (spentPctEl) {
      const parts = [`${usedRatio}% of allocated budget`];
      if (deductedConfirmed > 0) parts.push(`${Ipon.money(deductedConfirmed)} deducted`);
      else if (deductedPending > 0) parts.push(`${Ipon.money(deductedPending)} pending`);
      spentPctEl.textContent = parts.join(' · ');
    }

    if (totalRemainingEl) {
      totalRemainingEl.textContent = Ipon.money(remaining);
      totalRemainingEl.classList.toggle('is-over', remaining < 0);
    }
    if (remainingNoteEl) {
      remainingNoteEl.textContent = remaining < 0
        ? `Over overall budget by ${Ipon.money(Math.abs(remaining))}`
        : 'Allocated minus total expenses';
    }
  }

  function renderCategoryCards(data) {
    if (!categoriesGrid) return;
    const cats = data.categories || {};
    const items = Array.isArray(data.items) ? data.items : [];

    categoriesGrid.innerHTML = CATEGORY_ORDER.map((catKey) => {
      const meta = CATEGORY_META[catKey];
      const bucket = cats[catKey] || { pct: meta.defaultPct, allocated: 0, itemized: 0, spent: 0, remaining: 0 };
      const allocated = Number(bucket.allocated || 0);
      const itemized = Number(bucket.itemized || 0);
      const spent = Number(bucket.spent || 0);
      const remaining = Number(bucket.remaining || 0);
      const isOver = remaining < 0;
      const spentRatio = allocated > 0 ? (spent / allocated) * 100 : (spent > 0 ? 100 : 0);
      const fillPct = Math.min(100, Math.max(0, spentRatio));
      const fillTone = spentRatio > 100 ? 'is-over' : spentRatio >= 80 ? 'is-warn' : 'is-safe';
      const usedLabel = `${Math.round(spentRatio * 10) / 10}% used`;
      const overItemized = itemized > allocated && allocated > 0;
      const catItems = items.filter((item) => item.category === catKey);

      const itemsMarkup = catItems.length ? catItems.map((item) => {
        const planned = Number(item.allocated_amount || 0);
        const itemSpent = Number(item.spent_amount || 0);
        const itemRemaining = roundCentavos(planned - itemSpent);
        const itemOver = planned > 0 && itemRemaining < 0;
        const itemRatio = planned > 0 ? (itemSpent / planned) * 100 : 0;
        const itemFillTone = itemRatio > 100 ? 'is-over' : itemRatio >= 80 ? 'is-warn' : 'is-safe';
        return `
          <article class="budget-item-row" data-item-id="${item.id}">
            <div class="budget-item-top">
              <strong class="budget-item-name">${Ipon.escapeHtml(item.name)}</strong>
              <div class="budget-item-actions">
                <button class="icon-action budget-item-spend-btn" type="button" data-budget-add-expense="${item.id}" aria-label="Record expense for ${Ipon.escapeHtml(item.name)}">+ Spend</button>
                <button class="icon-action" type="button" data-budget-edit-item="${item.id}" aria-label="Edit ${Ipon.escapeHtml(item.name)}">Edit</button>
                <button class="icon-action danger-action" type="button" data-budget-delete-item="${item.id}" aria-label="Delete ${Ipon.escapeHtml(item.name)}">Delete</button>
              </div>
            </div>
            <div class="budget-item-numbers tabular-nums">
              ${planned > 0
                ? `<span>Planned <strong>${Ipon.money(planned)}</strong></span><span>Spent <strong>${Ipon.money(itemSpent)}</strong></span><span class="${itemOver ? 'is-over' : ''}">${itemOver ? `Over ${Ipon.money(Math.abs(itemRemaining))}` : `${Ipon.money(itemRemaining)} left`}</span>`
                : `<span>No fixed cap</span><span>Spent <strong>${Ipon.money(itemSpent)}</strong></span><span>${Number(item.expense_count || 0)} entr${Number(item.expense_count || 0) === 1 ? 'y' : 'ies'}</span>`}
            </div>
            ${planned > 0 ? `
              <div class="budget-mini-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(itemRatio))}" aria-label="${Ipon.escapeHtml(item.name)} spending progress">
                <span class="budget-progress-fill ${itemFillTone}" data-fill-pct="${Math.min(100, Math.max(0, itemRatio))}"></span>
              </div>` : ''}
          </article>`;
      }).join('') : `
        <div class="empty-state budget-empty-items">
          ${BUDGET_COIN_SVG}
          <strong>No custom ${meta.label.toLowerCase()} items yet</strong>
          <small>Examples: ${Ipon.escapeHtml(meta.examples.slice(0, 4).join(', '))}.<br>Click + Add item to customize.</small>
        </div>`;

      return `
        <section class="panel budget-category-card ${meta.tone}" data-category="${catKey}" aria-labelledby="budget-cat-title-${catKey}">
          <header class="budget-cat-header">
            <div class="budget-cat-title-wrap">
              <div class="budget-cat-heading-row">
                <h3 id="budget-cat-title-${catKey}" class="budget-cat-heading">${meta.label}</h3>
                <span class="budget-cat-pct-pill tabular-nums">${formatPct(bucket.pct)}</span>
              </div>
              <p class="budget-cat-summary">${Ipon.escapeHtml(meta.summaryNote)}</p>
            </div>
            <button class="budget-add-btn" type="button" data-budget-add-item="${catKey}" aria-label="Add item to ${meta.label}">
              + Add item
            </button>
          </header>

          <dl class="budget-bucket-metrics tabular-nums">
            <div>
              <dt>Allocated</dt>
              <dd>${Ipon.money(allocated)}</dd>
            </div>
            <div>
              <dt>Expenses</dt>
              <dd>${Ipon.money(spent)}</dd>
            </div>
            <div>
              <dt>Remaining</dt>
              <dd class="${isOver ? 'is-over' : 'is-positive'}">${Ipon.money(remaining)}</dd>
            </div>
          </dl>

          <div class="budget-progress-block">
            <div class="budget-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.round(spentRatio))}" aria-label="${meta.label} budget usage">
              <span class="budget-progress-fill ${fillTone}" data-fill-pct="${fillPct}"></span>
            </div>
            <div class="budget-progress-labels tabular-nums">
              <span>${usedLabel}</span>
              <span>Itemized: ${Ipon.money(itemized)}</span>
            </div>
            ${overItemized ? `<small class="budget-itemized-warn">Planned items (${Ipon.money(itemized)}) exceed the ${Ipon.money(allocated)} ${meta.label.toLowerCase()} allocation.</small>` : ''}
          </div>

          <div class="budget-items-list">${itemsMarkup}</div>
        </section>`;
    }).join('');

    categoriesGrid.querySelectorAll('.budget-progress-fill[data-fill-pct]').forEach((el) => {
      el.style.width = `${Number(el.dataset.fillPct || 0)}%`;
    });
  }

  function renderExpensesHistory(data) {
    if (!expensesBody) return;
    const allExpenses = Array.isArray(data?.expenses) ? data.expenses : [];
    const term = (expenseSearchInput?.value || '').trim().toLocaleLowerCase();
    const catFilter = expenseFilterSelect?.value || '';

    const filtered = allExpenses.filter((row) => {
      if (catFilter && row.category !== catFilter) return false;
      if (!term) return true;
      return String(row.item_name || '').toLocaleLowerCase().includes(term)
        || String(row.note || '').toLocaleLowerCase().includes(term);
    });

    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    expensePage = Math.min(Math.max(0, expensePage), pages - 1);
    const start = expensePage * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);

    if (historyPager) {
      historyPager.querySelector('span').textContent = `Page ${expensePage + 1} of ${pages} · ${filtered.length} entr${filtered.length === 1 ? 'y' : 'ies'}`;
      historyPager.querySelector('[data-page="previous"]').disabled = expensePage === 0;
      historyPager.querySelector('[data-page="next"]').disabled = expensePage >= pages - 1;
    }

    const renderSyncPill = (row) => {
      const syncStatus = String(row.savings_sync_status || (row.deduct_from_savings ? 'CONFIRMED' : 'MONITORING')).toUpperCase();
      const methodLabel = formatPaymentMethodShort(row.payment_method);
      if (syncStatus === 'CONFIRMED') return `<span class="budget-sync-pill is-deducted">Deducted · ${Ipon.escapeHtml(methodLabel)}</span>`;
      if (syncStatus === 'PENDING') return `<span class="budget-sync-pill is-pending">Pending review · ${Ipon.escapeHtml(methodLabel)}</span>`;
      if (syncStatus === 'VOIDED' || syncStatus === 'REJECTED') {
        return `<span class="budget-sync-pill is-voided">${syncStatus === 'REJECTED' ? 'Rejected' : 'Voided'}</span>`;
      }
      return '<span class="budget-sync-pill is-monitoring">Planning only</span>';
    };

    expensesBody.innerHTML = visible.length ? visible.map((row) => {
      const meta = CATEGORY_META[row.category] || CATEGORY_META.NEEDS;
      const syncStatus = String(row.savings_sync_status || '').toUpperCase();
      const lockedForTreasurer = data?.role !== 'ADMIN' && syncStatus === 'CONFIRMED';
      return `
        <tr class="compact-history-row" data-expense-id="${row.id}">
          <td data-label="Date">${Ipon.dateLabel(row.expense_date)}</td>
          <td data-label="Category"><span class="budget-history-chip ${meta.tone}">${meta.label}</span></td>
          <td data-label="Budget item"><strong>${Ipon.escapeHtml(row.item_name)}</strong></td>
          <td data-label="Amount" class="amount-cell budget-history-amount tabular-nums">${Ipon.money(row.amount)}</td>
          <td data-label="Savings impact">${renderSyncPill(row)}</td>
          <td data-label="Note">${row.note ? Ipon.escapeHtml(row.note) : '<span class="field-help">—</span>'}</td>
          <td data-label="Actions" class="budget-history-actions-cell">
            <div class="table-actions">
              <button class="icon-action" type="button" data-budget-edit-expense="${row.id}" ${lockedForTreasurer ? 'disabled title="Confirmed deductions can only be edited by an administrator"' : ''}>Edit</button>
              <button class="icon-action danger-action" type="button" data-budget-delete-expense="${row.id}" ${lockedForTreasurer ? 'disabled title="Confirmed deductions can only be voided by an administrator"' : ''}>Delete</button>
            </div>
          </td>
          <td class="compact-row-summary"><div class="compact-summary-head"><strong>${Ipon.escapeHtml(row.item_name)}</strong><b>${Ipon.money(row.amount)}</b></div><div class="compact-summary-meta"><span>${Ipon.dateLabel(row.expense_date)} · ${Ipon.escapeHtml(meta.label)}</span>${renderSyncPill(row)}</div><button class="compact-detail-trigger" type="button" data-budget-details="${row.id}" aria-label="View budget expense details for ${Ipon.escapeHtml(row.item_name)}">View details <span aria-hidden="true">↗</span></button></td>
        </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state budget-empty-history"><div class="budget-empty-history-inner">${BUDGET_COIN_SVG}<strong>${term || catFilter ? 'No matching expenses' : 'No budget expenses recorded yet'}</strong><small>${term || catFilter ? 'Try a different search or category.' : 'Click + Add expense to start monitoring or deducting from IPON savings.'}</small></div></td></tr>`;
  }

  function populateExpenseItemSelect(selectedItemId = '') {
    if (!expenseItemSelect) return false;
    const items = Array.isArray(overview?.items) ? overview.items : [];
    const groupsHtml = CATEGORY_ORDER.map((catKey) => {
      const catItems = items.filter((item) => item.category === catKey);
      if (!catItems.length) return '';
      const meta = CATEGORY_META[catKey];
      return `<optgroup label="${meta.label}">${catItems.map((item) => `<option value="${item.id}">${Ipon.escapeHtml(item.name)}</option>`).join('')}</optgroup>`;
    }).filter(Boolean).join('');
    expenseItemSelect.innerHTML = `${groupsHtml}<option value="__NEW__">+ Create new budget item…</option>`;
    if (selectedItemId && selectedItemId !== '__NEW__' && items.some((i) => i.id === selectedItemId)) {
      expenseItemSelect.value = selectedItemId;
    } else if (!selectedItemId && items.length > 0) {
      expenseItemSelect.value = items[0].id;
    } else {
      expenseItemSelect.value = '__NEW__';
    }
    return true;
  }

  function renderExpenseSuggestions(category) {
    if (!expenseSuggestions) return;
    const meta = CATEGORY_META[category] || CATEGORY_META.NEEDS;
    const current = (expenseNewNameInput?.value || '').trim().toLowerCase();
    expenseSuggestions.innerHTML = meta.examples.map((label) => {
      const active = current === label.toLowerCase();
      return `<button class="budget-suggestion-chip${active ? ' is-selected' : ''}" type="button" data-budget-exp-suggest="${Ipon.escapeHtml(label)}">${Ipon.escapeHtml(label)}</button>`;
    }).join('');
  }

  function getExpenseAvailableHeadroom() {
    const baseSavings = Math.max(0, Number(overview?.current_savings ?? overview?.raw_savings_balance ?? 0));
    const editingId = expenseIdInput?.value || '';
    if (!editingId) return baseSavings;
    const existing = (overview?.expenses || []).find((e) => e.id === editingId);
    if (existing && String(existing.savings_sync_status || '').toUpperCase() === 'CONFIRMED') {
      return roundCentavos(baseSavings + Number(existing.amount || 0));
    }
    return baseSavings;
  }

  function validateExpenseNewNameLive() {
    if (!expenseNewNameInput) return true;
    if (expenseItemSelect?.value !== '__NEW__') {
      Ipon.setFieldError(expenseNewNameInput, '');
      return true;
    }
    const clean = expenseNewNameInput.value.trim().replace(/\s+/g, ' ');
    if (!clean) {
      Ipon.setFieldError(expenseNewNameInput, 'Enter a budget item name.');
      return false;
    }
    Ipon.setFieldError(expenseNewNameInput, '');
    return true;
  }

  function validateExpenseAmountLive() {
    if (!expenseAmountInput) return false;
    const raw = String(expenseAmountInput.value ?? '').trim();
    if (!raw) {
      Ipon.setFieldError(expenseAmountInput, '');
      return false;
    }
    const amtCheck = Ipon.parseMoneyAmount(raw, {
      min: 0.01,
      max: 999999999999.99,
      required: true,
      label: 'Expense amount',
      badInput: expenseAmountInput.validity?.badInput
    });
    if (!amtCheck.valid) {
      Ipon.setFieldError(expenseAmountInput, amtCheck.error);
      return false;
    }
    const deductOn = Boolean(expenseDeductInput?.checked && !expenseDeductInput?.disabled);
    const headroom = getExpenseAvailableHeadroom();
    if (deductOn && amtCheck.value > headroom) {
      Ipon.setFieldError(
        expenseAmountInput,
        `Exceeds available IPON savings (${Ipon.money(headroom)}). Turn off deduction to log as planning only.`
      );
      return false;
    }
    Ipon.setFieldError(expenseAmountInput, '');
    return true;
  }

  function syncExpenseDialogFields() {
    const items = Array.isArray(overview?.items) ? overview.items : [];
    const hasExistingItems = items.length > 0;
    const isNew = expenseItemSelect?.value === '__NEW__' || !hasExistingItems;
    if (isNew && expenseItemSelect && expenseItemSelect.value !== '__NEW__') {
      expenseItemSelect.value = '__NEW__';
    }
    if (expenseItemWrap) expenseItemWrap.hidden = isNew;
    if (expenseItemSelect) expenseItemSelect.required = !isNew && hasExistingItems;
    if (expenseSwitchNewBtn) expenseSwitchNewBtn.hidden = isNew || !hasExistingItems;
    if (expenseSwitchExistingBtn) expenseSwitchExistingBtn.hidden = !isNew || !hasExistingItems;
    if (expenseNewItemFields) expenseNewItemFields.hidden = !isNew;
    if (expenseNewNameInput) expenseNewNameInput.required = isNew;
    if (isNew) {
      renderExpenseSuggestions(expenseNewCategorySelect?.value || 'NEEDS');
    } else if (expenseNewNameInput) {
      Ipon.setFieldError(expenseNewNameInput, '');
    }

    const canDeduct = Boolean(overview?.can_deduct_savings);
    const headroom = getExpenseAvailableHeadroom();
    if (expenseDeductInput) {
      expenseDeductInput.disabled = !canDeduct;
      if (!canDeduct) expenseDeductInput.checked = false;
    }
    if (expenseDeductHelp) {
      expenseDeductHelp.textContent = !canDeduct
        ? 'Group members record planning expenses here. Switch to a Solo savings workspace to deduct from personal savings.'
        : (overview?.role === 'ADMIN'
          ? 'Automatically deducts from workspace IPON savings and records a confirmed entry in Expenses.'
          : 'Submits a pending deduction for administrator approval so group savings stay accurate.');
    }
    const showMethod = Boolean(canDeduct && expenseDeductInput?.checked);
    if (expenseMethodWrap) expenseMethodWrap.hidden = !showMethod;
    if (expenseHeadroomHelp) {
      expenseHeadroomHelp.textContent = canDeduct
        ? `Available IPON savings: ${Ipon.money(headroom)}`
        : 'Planning monitor only · does not modify shared group savings';
    }
    validateExpenseAmountLive();
  }

  function renderItemSuggestions(category) {
    if (!itemSuggestions) return;
    const meta = CATEGORY_META[category] || CATEGORY_META.NEEDS;
    const activeName = (itemNameInput?.value || '').trim().toLowerCase();
    itemSuggestions.innerHTML = meta.examples.map((label) => {
      const isSelected = activeName && activeName === label.toLowerCase();
      return `<button class="budget-suggestion-chip${isSelected ? ' is-active' : ''}" type="button" data-budget-suggest="${Ipon.escapeHtml(label)}">${Ipon.escapeHtml(label)}</button>`;
    }).join('');
  }

  function syncItemHeadroomHelp() {
    if (!overview) return;
    const catKey = itemCategorySelect?.value || 'NEEDS';
    const meta = CATEGORY_META[catKey] || CATEGORY_META.NEEDS;
    const bucket = overview.categories?.[catKey];
    if (!bucket) return;
    const editingId = itemIdInput?.value || '';
    const existingItem = editingId ? (overview.items || []).find((i) => i.id === editingId) : null;
    const bucketTotal = Number(bucket.allocated || 0);
    const otherItemized = Number(bucket.itemized || 0) - (existingItem && existingItem.category === catKey ? Number(existingItem.allocated_amount || 0) : 0);
    const typedAmt = Math.max(0, Number(itemAmountInput?.value || 0) || 0);
    const remainingBefore = roundCentavos(bucketTotal - otherItemized);
    const remainingAfter = roundCentavos(remainingBefore - typedAmt);
    const displayUnallocated = Math.max(0, remainingAfter);

    if (itemBucketLabelEl) itemBucketLabelEl.textContent = `${meta.label.toUpperCase()} BUDGET`;
    if (itemBucketTotalEl) itemBucketTotalEl.textContent = Ipon.money(bucketTotal);
    if (itemUnallocatedEl) {
      itemUnallocatedEl.textContent = Ipon.money(displayUnallocated);
      itemUnallocatedEl.classList.toggle('is-over', remainingAfter < 0);
    }
    if (itemHeadroomHelp) {
      itemHeadroomHelp.textContent = remainingAfter < 0
        ? `Exceeds ${meta.label.toLowerCase()} remaining budget by ${Ipon.money(Math.abs(remainingAfter))}. It will still save as your custom target.`
        : 'Enter 0 if you prefer open tracking, with no fixed limit.';
    }
  }

  function validateItemNameLive() {
    if (!itemNameInput) return false;
    const name = itemNameInput.value.trim().replace(/\s+/g, ' ');
    if (!name) {
      Ipon.setFieldError(itemNameInput, 'Enter an item name.');
      return false;
    }
    const catKey = itemCategorySelect?.value || 'NEEDS';
    const editId = itemIdInput?.value || '';
    const dup = (overview?.items || []).some((item) => (
      item.category === catKey
      && item.name.trim().toLowerCase() === name.toLowerCase()
      && item.id !== editId
    ));
    if (dup) {
      Ipon.setFieldError(itemNameInput, `"${name}" already exists in ${(CATEGORY_META[catKey] || CATEGORY_META.NEEDS).label}.`);
      return false;
    }
    Ipon.setFieldError(itemNameInput, '');
    return true;
  }

  function openItemDialog({ category = 'NEEDS', item = null } = {}) {
    if (!itemDialog || !itemForm) return;
    itemForm.reset();
    const targetCat = item?.category || category || 'NEEDS';
    if (itemIdInput) itemIdInput.value = item?.id || '';
    if (itemEyebrowEl) itemEyebrowEl.textContent = item ? 'EDIT ENTRY' : 'NEW ENTRY';
    if (itemCategorySelect) itemCategorySelect.value = targetCat;
    if (itemNameInput) {
      itemNameInput.value = item?.name || '';
      Ipon.setFieldError(itemNameInput, '');
    }
    if (itemAmountInput) {
      itemAmountInput.value = item ? String(item.allocated_amount ?? 0) : '0';
      Ipon.setFieldError(itemAmountInput, '');
    }
    document.getElementById('budget-item-dialog-title').textContent = item ? 'Edit budget item' : 'Add budget item';
    document.getElementById('budget-item-dialog-copy').textContent = item
      ? 'Rename this item, adjust its planned cap, or move it between Needs, Wants, and Savings.'
      : 'Add any custom budget or expense item to organize this category.';
    if (itemSubmitBtn) itemSubmitBtn.textContent = item ? 'Save changes' : '+ Add item';
    renderItemSuggestions(targetCat);
    syncItemHeadroomHelp();
    itemDialog.showModal();
    itemNameInput?.focus();
  }

  function openExpenseDialog({ itemId = '', category = '', expense = null } = {}) {
    if (!expenseDialog || !expenseForm) return;
    expenseForm.reset();
    if (expenseIdInput) expenseIdInput.value = expense?.id || '';
    if (expenseEyebrowEl) expenseEyebrowEl.textContent = expense ? 'EDIT EXPENSE' : 'NEW EXPENSE';
    if (expenseMethodSelect) {
      if (!expenseMethodSelect.options?.length) {
        expenseMethodSelect.innerHTML = typeof Ipon.paymentMethodOptionsHtml === 'function'
          ? Ipon.paymentMethodOptionsHtml()
          : '<option value="CASH">Cash</option><option value="GCASH">GCash</option><option value="MAYA">Maya</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option>';
      }
      expenseMethodSelect.value = expense?.payment_method || 'CASH';
    }
    populateExpenseItemSelect(expense?.item_id || itemId || '');
    if (!expense && !itemId && category && expenseItemSelect?.value === '__NEW__' && expenseNewCategorySelect) {
      expenseNewCategorySelect.value = category;
    }
    if (expenseNewNameInput) {
      expenseNewNameInput.value = '';
      Ipon.setFieldError(expenseNewNameInput, '');
    }
    if (expenseAmountInput) {
      expenseAmountInput.value = expense ? String(expense.amount) : '';
      Ipon.setFieldError(expenseAmountInput, '');
    }
    if (expenseDateInput) {
      expenseDateInput.value = expense?.expense_date || Ipon.isoDate();
    }
    if (expenseNoteInput) {
      expenseNoteInput.value = expense?.note || '';
    }
    if (expenseDeductInput) {
      const canDeduct = Boolean(overview?.can_deduct_savings);
      expenseDeductInput.checked = expense ? Boolean(expense.deduct_from_savings && canDeduct) : canDeduct;
    }
    document.getElementById('budget-expense-dialog-title').textContent = expense ? 'Edit budget expense' : 'Record budget expense';
    const copyEl = document.getElementById('budget-expense-dialog-copy');
    if (copyEl) {
      copyEl.textContent = overview?.can_deduct_savings
        ? 'Deduct from your live IPON savings or turn off deduction to log as planning only.'
        : 'Track spending against a budget item for your personal allocation monitor.';
    }
    if (expenseSubmitBtn) expenseSubmitBtn.textContent = expense ? 'Save changes' : 'Save expense';
    syncExpenseDialogFields();
    expenseDialog.showModal();
    if (expenseItemSelect?.value === '__NEW__' && expenseNewNameInput) {
      expenseNewNameInput.focus();
    } else {
      expenseAmountInput?.focus();
    }
  }

  function syncSplitPreview() {
    if (!splitForm) return false;
    const ref = Number(overview?.reference_balance || 0);
    const nRes = Ipon.parseMoneyAmount(splitNeedsInput?.value, { min: 0, max: 100, required: true, label: 'Needs %', badInput: splitNeedsInput?.validity?.badInput });
    const wRes = Ipon.parseMoneyAmount(splitWantsInput?.value, { min: 0, max: 100, required: true, label: 'Wants %', badInput: splitWantsInput?.validity?.badInput });
    const sRes = Ipon.parseMoneyAmount(splitSavingsInput?.value, { min: 0, max: 100, required: true, label: 'Savings %', badInput: splitSavingsInput?.validity?.badInput });

    const needsVal = nRes.valid ? Math.max(0, Number(nRes.value ?? 0)) : 0;
    const wantsVal = wRes.valid ? Math.max(0, Number(wRes.value ?? 0)) : 0;
    const savingsVal = sRes.valid ? Math.max(0, Number(sRes.value ?? 0)) : 0;
    const total = roundCentavos(needsVal + wantsVal + savingsVal);
    const preview = computeSplitAmounts(ref, needsVal, wantsVal, savingsVal);

    if (splitNeedsPreview) splitNeedsPreview.textContent = Ipon.money(preview.NEEDS);
    if (splitWantsPreview) splitWantsPreview.textContent = Ipon.money(preview.WANTS);
    if (splitSavingsPreview) splitSavingsPreview.textContent = Ipon.money(preview.SAVINGS);
    if (splitSumEl) splitSumEl.textContent = formatPct(total);

    [
      [splitLiveNeedsEl, needsVal],
      [splitLiveWantsEl, wantsVal],
      [splitLiveSavingsEl, savingsVal]
    ].forEach(([segEl, pct]) => {
      if (!segEl) return;
      segEl.hidden = pct <= 0;
      segEl.style.flex = `${pct} 1 0`;
      segEl.style.width = `${pct}%`;
    });

    const exactHundred = nRes.valid && wRes.valid && sRes.valid && Math.abs(total - 100) < 0.005;
    if (splitTotalBar) {
      splitTotalBar.classList.toggle('is-valid', exactHundred);
      splitTotalBar.classList.toggle('is-invalid', !exactHundred);
    }
    if (splitStateLabelEl) {
      const diff = roundCentavos(100 - total);
      splitStateLabelEl.textContent = exactHundred
        ? 'Ready to save'
        : diff > 0
          ? `${formatPct(diff)} remaining`
          : `${formatPct(Math.abs(diff))} over`;
    }
    if (splitStatusIconEl) {
      splitStatusIconEl.innerHTML = exactHundred
        ? '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.8-5"/>'
        : '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 15.8h.01"/>';
    }
    if (splitErrorEl) {
      const errMsg = !nRes.valid ? nRes.error
        : !wRes.valid ? wRes.error
          : !sRes.valid ? sRes.error
            : (!exactHundred ? `Total must equal 100% (currently ${formatPct(total)}).` : '');
      splitErrorEl.textContent = errMsg;
      splitErrorEl.hidden = !errMsg;
      splitErrorEl.setAttribute('aria-hidden', errMsg ? 'false' : 'true');
    }
    const cfg = overview?.config || { needs_pct: 50, wants_pct: 30, savings_pct: 20 };
    const splitDirty = exactHundred && (
      Math.abs(needsVal - Number(cfg.needs_pct ?? 50)) >= 0.005 ||
      Math.abs(wantsVal - Number(cfg.wants_pct ?? 30)) >= 0.005 ||
      Math.abs(savingsVal - Number(cfg.savings_pct ?? 20)) >= 0.005
    );
    if (splitSubmitBtn) {
      splitSubmitBtn.disabled = !splitDirty;
      splitSubmitBtn.title = !exactHundred ? '' : (splitDirty ? '' : 'Change a percentage before saving.');
    }
    return exactHundred;
  }

  function openSplitDialog() {
    if (!splitDialog || !splitForm) return;
    const cfg = overview?.config || { needs_pct: 50, wants_pct: 30, savings_pct: 20 };
    if (splitNeedsInput) splitNeedsInput.value = String(cfg.needs_pct ?? 50);
    if (splitWantsInput) splitWantsInput.value = String(cfg.wants_pct ?? 30);
    if (splitSavingsInput) splitSavingsInput.value = String(cfg.savings_pct ?? 20);
    syncSplitPreview();
    splitDialog.showModal();
    splitNeedsInput?.focus();
    splitNeedsInput?.select();
  }

  async function load() {
    if (errorSlot) {
      errorSlot.hidden = true;
      errorSlot.replaceChildren();
    }
    try {
      const [overviewRes, groups] = await Promise.all([
        Ipon.rpc('get_budget_overview'),
        Ipon.rpc('get_my_groups').catch(() => [])
      ]);
      overview = overviewRes || { has_workspace: false };
      renderWorkspaceContext(groups, overview.has_workspace ? (overview.group_name || '') : '');

      if (!overview.has_workspace) {
        if (groupBar) groupBar.hidden = true;
        if (workspaceContent) workspaceContent.hidden = true;
        if (headerActions) headerActions.hidden = true;
        if (noWorkspaceEl) {
          noWorkspaceEl.hidden = false;
          Ipon.renderGroupRequiredCard(noWorkspaceEl, { hasGroup: false });
        }
        return;
      }

      if (noWorkspaceEl) noWorkspaceEl.hidden = true;
      if (headerActions) headerActions.hidden = false;
      if (workspaceContent) workspaceContent.hidden = false;

      renderSummarySection(overview);
      renderCategoryCards(overview);
      renderExpensesHistory(overview);
    } catch (error) {
      if (!overview?.has_workspace) {
        if (workspaceContent) workspaceContent.hidden = true;
        if (noWorkspaceEl) noWorkspaceEl.hidden = true;
      }
      Ipon.showInlineError(errorSlot, error, load);
    }
  }

  // Bind stable money guards and live validation
  Ipon.guardMoneyInput(itemAmountInput, { min: 0, max: 999999999999.99, required: true, label: 'Planned amount' });
  Ipon.guardMoneyInput(expenseAmountInput, { min: 0.01, max: 999999999999.99, required: true, label: 'Expense amount', customDisplay: true });
  [splitNeedsInput, splitWantsInput, splitSavingsInput].forEach((input) => {
    Ipon.guardMoneyInput(input, { min: 0, max: 100, required: true, label: 'Percentage', customDisplay: true });
    input?.addEventListener('input', syncSplitPreview);
    input?.addEventListener('blur', syncSplitPreview);
  });

  itemNameInput?.addEventListener('input', () => {
    validateItemNameLive();
    renderItemSuggestions(itemCategorySelect?.value || 'NEEDS');
  });
  itemNameInput?.addEventListener('blur', validateItemNameLive);
  itemAmountInput?.addEventListener('input', syncItemHeadroomHelp);
  itemAmountInput?.addEventListener('blur', syncItemHeadroomHelp);
  itemCategorySelect?.addEventListener('change', () => {
    renderItemSuggestions(itemCategorySelect.value);
    syncItemHeadroomHelp();
    validateItemNameLive();
  });
  itemSuggestions?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-budget-suggest]');
    if (!chip || !itemNameInput) return;
    itemNameInput.value = chip.dataset.budgetSuggest || '';
    renderItemSuggestions(itemCategorySelect?.value || 'NEEDS');
    validateItemNameLive();
    itemAmountInput?.focus();
    itemAmountInput?.select();
  });

  expenseItemSelect?.addEventListener('change', () => {
    syncExpenseDialogFields();
    if (expenseItemSelect.value === '__NEW__') {
      expenseNewNameInput?.focus();
    }
  });
  expenseSwitchNewBtn?.addEventListener('click', () => {
    if (expenseItemSelect) expenseItemSelect.value = '__NEW__';
    syncExpenseDialogFields();
    expenseNewNameInput?.focus();
  });
  expenseSwitchExistingBtn?.addEventListener('click', () => {
    const firstId = overview?.items?.[0]?.id || '';
    if (expenseItemSelect && firstId) expenseItemSelect.value = firstId;
    syncExpenseDialogFields();
    expenseItemSelect?.focus();
  });
  expenseNewCategorySelect?.addEventListener('change', () => {
    renderExpenseSuggestions(expenseNewCategorySelect.value || 'NEEDS');
    if (expenseNewNameInput?.value.trim()) validateExpenseNewNameLive();
  });
  expenseNewNameInput?.addEventListener('input', () => {
    validateExpenseNewNameLive();
    renderExpenseSuggestions(expenseNewCategorySelect?.value || 'NEEDS');
  });
  expenseNewNameInput?.addEventListener('blur', (event) => {
    if (expenseNewItemFields?.contains(event?.relatedTarget)) return;
    validateExpenseNewNameLive();
  });
  expenseSuggestions?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-budget-exp-suggest]');
    if (!chip || !expenseNewNameInput) return;
    expenseNewNameInput.value = chip.dataset.budgetExpSuggest || '';
    renderExpenseSuggestions(expenseNewCategorySelect?.value || 'NEEDS');
    validateExpenseNewNameLive();
    expenseAmountInput?.focus();
    expenseAmountInput?.select();
  });
  expenseAmountInput?.addEventListener('input', validateExpenseAmountLive);
  expenseAmountInput?.addEventListener('blur', validateExpenseAmountLive);
  expenseDeductInput?.addEventListener('change', syncExpenseDialogFields);

  document.getElementById('budget-edit-split-btn')?.addEventListener('click', openSplitDialog);
  document.getElementById('budget-quick-expense-btn')?.addEventListener('click', () => openExpenseDialog());
  document.getElementById('budget-history-add-expense')?.addEventListener('click', () => openExpenseDialog());
  document.getElementById('budget-item-close')?.addEventListener('click', () => itemDialog?.close());
  document.getElementById('budget-item-cancel')?.addEventListener('click', () => itemDialog?.close());
  document.getElementById('budget-expense-close')?.addEventListener('click', () => expenseDialog?.close());
  document.getElementById('budget-expense-cancel')?.addEventListener('click', () => expenseDialog?.close());
  document.getElementById('budget-split-close')?.addEventListener('click', () => splitDialog?.close());
  document.getElementById('budget-split-cancel')?.addEventListener('click', () => splitDialog?.close());
  document.getElementById('split-reset-default')?.addEventListener('click', () => {
    if (splitNeedsInput) splitNeedsInput.value = '50';
    if (splitWantsInput) splitWantsInput.value = '30';
    if (splitSavingsInput) splitSavingsInput.value = '20';
    syncSplitPreview();
  });

  groupSelect?.addEventListener('change', async () => {
    const nextGroupId = groupSelect.value;
    if (!nextGroupId || nextGroupId === overview?.group_id) return;
    groupSelect.disabled = true;
    try {
      await Ipon.switchActiveGroup(nextGroupId);
      expensePage = 0;
      await load();
    } catch (error) {
      groupSelect.value = overview?.group_id || '';
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      groupSelect.disabled = false;
    }
  });

  categoriesGrid?.addEventListener('click', async (event) => {
    const addItemBtn = event.target.closest('[data-budget-add-item]');
    if (addItemBtn) {
      openItemDialog({ category: addItemBtn.dataset.budgetAddItem || 'NEEDS' });
      return;
    }

    const addExpBtn = event.target.closest('[data-budget-add-expense]');
    if (addExpBtn) {
      openExpenseDialog({ itemId: addExpBtn.dataset.budgetAddExpense || '' });
      return;
    }

    const editItemBtn = event.target.closest('[data-budget-edit-item]');
    if (editItemBtn) {
      const target = (overview?.items || []).find((i) => i.id === editItemBtn.dataset.budgetEditItem);
      if (target) openItemDialog({ item: target });
      return;
    }

    const deleteItemBtn = event.target.closest('[data-budget-delete-item]');
    if (deleteItemBtn) {
      const target = (overview?.items || []).find((i) => i.id === deleteItemBtn.dataset.budgetDeleteItem);
      if (!target) return;
      const linkedConfirmedSum = (overview?.expenses || [])
        .filter((e) => e.item_id === target.id && String(e.savings_sync_status || '').toUpperCase() === 'CONFIRMED')
        .reduce((acc, e) => acc + Number(e.amount || 0), 0);
      const expCount = Number(target.expense_count || 0);
      const confirmed = await Ipon.confirmAction({
        title: 'Delete budget item?',
        message: linkedConfirmedSum > 0
          ? `Delete "${target.name}" and its ${expCount} expense entr${expCount === 1 ? 'y' : 'ies'}? Linked confirmed deductions (${Ipon.money(linkedConfirmedSum)}) will be voided in your ledger and restored to IPON savings.`
          : expCount > 0
            ? `Delete "${target.name}" and its ${expCount} tracked expense entr${expCount === 1 ? 'y' : 'ies'}?`
            : `Remove "${target.name}" from your budget planner?`,
        acceptLabel: 'Delete item'
      });
      if (!confirmed) return;
      Ipon.setBusy(deleteItemBtn, true, 'Deleting…');
      try {
        await Ipon.rpc('delete_budget_item', { p_item_id: target.id });
        Ipon.toast(linkedConfirmedSum > 0 ? `Deleted "${target.name}" and restored ${Ipon.money(linkedConfirmedSum)} to IPON savings.` : `Deleted "${target.name}".`);
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(deleteItemBtn, false);
      }
    }
  });

  expensesBody?.addEventListener('click', async (event) => {
    const detailBtn = event.target.closest('[data-budget-details]');
    if (detailBtn) {
      const cells = [...detailBtn.closest('tr').querySelectorAll('td:not(.compact-row-summary)')];
      const labels = ['Date', 'Category', 'Budget item', 'Amount', 'Savings impact', 'Note'];
      expenseDetailFields.innerHTML = labels.map((label, index) => `<div class="compact-detail-field"><dt>${label}</dt><dd>${cells[index].innerHTML}</dd></div>`).join('');
      expenseDetailActions.innerHTML = cells[6].querySelector('.table-actions')?.innerHTML || '';
      document.getElementById('budget-history-detail-title').textContent = cells[2].textContent;
      expenseDetailDialog.showModal();
      return;
    }
    const editBtn = event.target.closest('[data-budget-edit-expense]');
    if (editBtn) {
      const target = (overview?.expenses || []).find((e) => e.id === editBtn.dataset.budgetEditExpense);
      if (target) openExpenseDialog({ expense: target });
      return;
    }

    const deleteBtn = event.target.closest('[data-budget-delete-expense]');
    if (deleteBtn) {
      const target = (overview?.expenses || []).find((e) => e.id === deleteBtn.dataset.budgetDeleteExpense);
      if (!target) return;
      const syncStatus = String(target.savings_sync_status || '').toUpperCase();
      const confirmedMsg = syncStatus === 'CONFIRMED'
        ? `Delete ${Ipon.money(target.amount)} spent on "${target.item_name}" (${Ipon.dateLabel(target.expense_date)})? This voids the linked ledger expense and restores ${Ipon.money(target.amount)} back into your IPON savings.`
        : syncStatus === 'PENDING'
          ? `Cancel and delete pending ${Ipon.money(target.amount)} spent on "${target.item_name}" (${Ipon.dateLabel(target.expense_date)})?`
          : `Remove ${Ipon.money(target.amount)} spent on "${target.item_name}" (${Ipon.dateLabel(target.expense_date)}) from your budget planner?`;
      const confirmed = await Ipon.confirmAction({
        title: 'Delete budget expense?',
        message: confirmedMsg,
        acceptLabel: 'Delete expense'
      });
      if (!confirmed) return;
      Ipon.setBusy(deleteBtn, true, 'Deleting…');
      try {
        await Ipon.rpc('delete_budget_expense', { p_expense_id: target.id });
        Ipon.toast(syncStatus === 'CONFIRMED' ? `Deleted expense and restored ${Ipon.money(target.amount)} to IPON savings.` : 'Budget expense deleted.');
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(deleteBtn, false);
      }
    }
  });
  document.getElementById('close-budget-history-detail')?.addEventListener('click', () => expenseDetailDialog.close());
  expenseDetailActions?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const id = button.dataset.budgetEditExpense || button.dataset.budgetDeleteExpense;
    const selector = button.hasAttribute('data-budget-edit-expense') ? '[data-budget-edit-expense]' : '[data-budget-delete-expense]';
    const original = [...expensesBody.querySelectorAll(selector)].find((item) => (item.dataset.budgetEditExpense || item.dataset.budgetDeleteExpense) === id);
    expenseDetailDialog.close();
    original?.click();
  });

  itemForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateItemNameLive()) {
      itemNameInput?.focus();
      return;
    }
    const amtCheck = Ipon.parseMoneyAmount(itemAmountInput?.value, { min: 0, max: 999999999999.99, required: true, label: 'Planned amount', badInput: itemAmountInput?.validity?.badInput });
    if (!amtCheck.valid) {
      Ipon.setFieldError(itemAmountInput, amtCheck.error);
      itemAmountInput?.focus();
      return;
    }
    Ipon.setFieldError(itemAmountInput, '');
    Ipon.setBusy(itemSubmitBtn, true, 'Saving…');
    try {
      await Ipon.rpc('save_budget_item', {
        p_item_id: itemIdInput?.value || null,
        p_category: itemCategorySelect?.value || 'NEEDS',
        p_name: itemNameInput.value.trim(),
        p_allocated_amount: amtCheck.value
      });
      itemDialog?.close();
      Ipon.toast(itemIdInput?.value ? 'Budget item updated.' : 'Budget item added.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(itemSubmitBtn, false);
    }
  });

  expenseForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validateExpenseNewNameLive()) {
      expenseNewNameInput?.focus();
      return;
    }
    const amtCheck = Ipon.parseMoneyAmount(expenseAmountInput?.value, { min: 0.01, max: 999999999999.99, required: true, label: 'Expense amount', badInput: expenseAmountInput?.validity?.badInput });
    if (!amtCheck.valid) {
      Ipon.setFieldError(expenseAmountInput, amtCheck.error);
      expenseAmountInput?.focus();
      return;
    }
    const deductOn = Boolean(overview?.can_deduct_savings && expenseDeductInput?.checked);
    const headroom = getExpenseAvailableHeadroom();
    if (deductOn && amtCheck.value > headroom) {
      Ipon.setFieldError(
        expenseAmountInput,
        `Exceeds available IPON savings (${Ipon.money(headroom)}). Turn off deduction to log as planning only.`
      );
      expenseAmountInput?.focus();
      return;
    }
    Ipon.setFieldError(expenseAmountInput, '');
    const isNew = expenseItemSelect?.value === '__NEW__';
    if (!expenseItemSelect?.value) {
      Ipon.toast('Select or create a budget item first.', 'error');
      expenseItemSelect?.focus();
      return;
    }
    Ipon.setBusy(expenseSubmitBtn, true, 'Saving…');
    try {
      await Ipon.rpc('save_budget_expense', {
        p_expense_id: expenseIdInput?.value || null,
        p_item_id: isNew ? null : expenseItemSelect.value,
        p_amount: amtCheck.value,
        p_expense_date: expenseDateInput?.value || Ipon.isoDate(),
        p_note: expenseNoteInput?.value?.trim() || null,
        p_category: isNew ? (expenseNewCategorySelect?.value || 'NEEDS') : null,
        p_item_name: isNew ? expenseNewNameInput.value.trim() : null,
        p_deduct_from_savings: deductOn,
        p_payment_method: deductOn ? (expenseMethodSelect?.value || 'CASH') : 'CASH'
      });
      expenseDialog?.close();
      Ipon.toast(
        deductOn
          ? (overview?.role === 'ADMIN'
            ? `Saved & deducted ${Ipon.money(amtCheck.value)} from IPON savings.`
            : 'Expense submitted for admin approval to deduct from group savings.')
          : (expenseIdInput?.value ? 'Planning expense updated.' : 'Planning expense recorded.')
      );
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(expenseSubmitBtn, false);
    }
  });

  splitForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!syncSplitPreview()) return;
    Ipon.setBusy(splitSubmitBtn, true, 'Saving…');
    try {
      await Ipon.rpc('save_budget_allocation', {
        p_needs_pct: roundCentavos(splitNeedsInput.value),
        p_wants_pct: roundCentavos(splitWantsInput.value),
        p_savings_pct: roundCentavos(splitSavingsInput.value)
      });
      splitDialog?.close();
      Ipon.toast('Budget allocation percentages updated.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(splitSubmitBtn, false);
    }
  });

  expenseSearchInput?.addEventListener('input', () => {
    expensePage = 0;
    if (overview?.has_workspace) renderExpensesHistory(overview);
  });
  expenseFilterSelect?.addEventListener('change', () => {
    expensePage = 0;
    if (overview?.has_workspace) renderExpensesHistory(overview);
  });
  historyPager?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    expensePage += btn.dataset.page === 'next' ? 1 : -1;
    if (overview?.has_workspace) renderExpensesHistory(overview);
  });

  try {
    await load();
  } finally {
    Ipon.setLoading(false);
  }

  Ipon.subscribeToChanges(
    'budget',
    ['budget_configs', 'budget_items', 'budget_expenses', 'contributions', 'withdrawals', 'expenses', 'financial_annual_archives', 'groups', 'members'],
    load
  );
})();
