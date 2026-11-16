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
  const historyPager = document.getElementById('budget-history-pager');

  const itemDialog = document.getElementById('budget-item-dialog');
  const itemForm = document.getElementById('budget-item-form');
  const itemIdInput = document.getElementById('budget-item-id');
  const itemCategorySelect = document.getElementById('budget-item-category');
  const itemNameInput = document.getElementById('budget-item-name');
  const itemAmountInput = document.getElementById('budget-item-amount');
  const itemSuggestions = document.getElementById('budget-item-suggestions');
  const itemHeadroomHelp = document.getElementById('budget-item-headroom-help');
  const itemSubmitBtn = document.getElementById('budget-item-submit');

  const expenseDialog = document.getElementById('budget-expense-dialog');
  const expenseForm = document.getElementById('budget-expense-form');
  const expenseIdInput = document.getElementById('budget-expense-id');
  const expenseItemSelect = document.getElementById('budget-expense-item');
  const expenseAmountInput = document.getElementById('budget-expense-amount');
  const expenseDateInput = document.getElementById('budget-expense-date');
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
  const splitTotalBar = document.getElementById('budget-split-total-bar');
  const splitSumEl = document.getElementById('budget-split-sum');
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
    if (data.balance_source === 'SOLO_TRACKER') {
      return `Automatically pulled from your Solo tracker "${name}". Any change in tracked savings recalculates category allocations without affecting expense history.`;
    }
    if (data.balance_source === 'MEMBER_CONFIRMED') {
      return `Automatically pulled from your confirmed member savings in "${name}". Expenses tracked here do not deduct from your contributions.`;
    }
    return `Automatically pulled from confirmed tracked savings in "${name}". Category budgets recalculate automatically as savings grow.`;
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
    const rawBalance = Number(data.raw_savings_balance ?? refBalance);
    const spent = Number(totals.spent || 0);
    const remaining = Number(totals.remaining || 0);
    const fallbackAmounts = computeSplitAmounts(refBalance, cfg.needs_pct, cfg.wants_pct, cfg.savings_pct);
    const pctText = `${formatPct(cfg.needs_pct).replace('%', '')} / ${formatPct(cfg.wants_pct).replace('%', '')} / ${formatPct(cfg.savings_pct).replace('%', '')}`;

    if (splitHeadingEl) splitHeadingEl.textContent = pctText;
    if (sourceLabelEl) sourceLabelEl.textContent = getBalanceSourceCopy(data);

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

    if (refBalanceEl) refBalanceEl.textContent = Ipon.money(refBalance);
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
    if (spentPctEl) spentPctEl.textContent = `${usedRatio}% of allocated budget`;

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

    expensesBody.innerHTML = visible.length ? visible.map((row) => {
      const meta = CATEGORY_META[row.category] || CATEGORY_META.NEEDS;
      return `
        <tr data-expense-id="${row.id}">
          <td data-label="Date">${Ipon.dateLabel(row.expense_date)}</td>
          <td data-label="Category"><span class="budget-history-chip ${meta.tone}">${meta.label}</span></td>
          <td data-label="Budget item"><strong>${Ipon.escapeHtml(row.item_name)}</strong></td>
          <td data-label="Amount" class="amount-cell budget-history-amount tabular-nums">${Ipon.money(row.amount)}</td>
          <td data-label="Note">${row.note ? Ipon.escapeHtml(row.note) : '<span class="field-help">—</span>'}</td>
          <td data-label="Actions" class="budget-history-actions-cell">
            <div class="table-actions">
              <button class="icon-action" type="button" data-budget-edit-expense="${row.id}">Edit</button>
              <button class="icon-action danger-action" type="button" data-budget-delete-expense="${row.id}">Delete</button>
            </div>
          </td>
        </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-state budget-empty-history">${BUDGET_COIN_SVG}<strong>${term || catFilter ? 'No matching expenses' : 'No budget expenses recorded yet'}</strong><small>${term || catFilter ? 'Try a different search or category.' : 'Click + Add expense to start monitoring.'}</small></td></tr>`;
  }

  function populateExpenseItemSelect(selectedItemId = '') {
    if (!expenseItemSelect) return false;
    const items = Array.isArray(overview?.items) ? overview.items : [];
    if (!items.length) {
      expenseItemSelect.innerHTML = '<option value="">No budget items available</option>';
      return false;
    }
    const groupsHtml = CATEGORY_ORDER.map((catKey) => {
      const catItems = items.filter((item) => item.category === catKey);
      if (!catItems.length) return '';
      const meta = CATEGORY_META[catKey];
      return `<optgroup label="${meta.label}">${catItems.map((item) => `<option value="${item.id}">${Ipon.escapeHtml(item.name)}</option>`).join('')}</optgroup>`;
    }).filter(Boolean).join('');
    expenseItemSelect.innerHTML = groupsHtml;
    if (selectedItemId && items.some((i) => i.id === selectedItemId)) {
      expenseItemSelect.value = selectedItemId;
    } else if (items[0]) {
      expenseItemSelect.value = items[0].id;
    }
    return true;
  }

  function renderItemSuggestions(category) {
    if (!itemSuggestions) return;
    const meta = CATEGORY_META[category] || CATEGORY_META.NEEDS;
    itemSuggestions.innerHTML = meta.examples.map((label) => (
      `<button class="budget-suggestion-chip" type="button" data-budget-suggest="${Ipon.escapeHtml(label)}">${Ipon.escapeHtml(label)}</button>`
    )).join('');
  }

  function syncItemHeadroomHelp() {
    if (!itemHeadroomHelp || !overview) return;
    const catKey = itemCategorySelect?.value || 'NEEDS';
    const meta = CATEGORY_META[catKey] || CATEGORY_META.NEEDS;
    const bucket = overview.categories?.[catKey];
    if (!bucket) return;
    const editingId = itemIdInput?.value || '';
    const existingItem = editingId ? (overview.items || []).find((i) => i.id === editingId) : null;
    const currentItemized = Number(bucket.itemized || 0) - (existingItem && existingItem.category === catKey ? Number(existingItem.allocated_amount || 0) : 0);
    const unallocated = Math.max(0, roundCentavos(Number(bucket.allocated || 0) - currentItemized));
    itemHeadroomHelp.textContent = `${meta.label} budget: ${Ipon.money(bucket.allocated)} total · ${Ipon.money(unallocated)} currently unallocated. Enter 0 if you prefer open tracking.`;
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
    if (itemSubmitBtn) itemSubmitBtn.textContent = item ? 'Save changes' : 'Add item';
    renderItemSuggestions(targetCat);
    syncItemHeadroomHelp();
    itemDialog.showModal();
    itemNameInput?.focus();
  }

  function openExpenseDialog({ itemId = '', expense = null } = {}) {
    if (!expenseDialog || !expenseForm) return;
    const items = Array.isArray(overview?.items) ? overview.items : [];
    if (!items.length && !expense) {
      Ipon.toast('Add at least one budget item first before recording an expense.', 'info');
      openItemDialog({ category: 'NEEDS' });
      return;
    }
    expenseForm.reset();
    if (expenseIdInput) expenseIdInput.value = expense?.id || '';
    populateExpenseItemSelect(expense?.item_id || itemId || '');
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
    document.getElementById('budget-expense-dialog-title').textContent = expense ? 'Edit budget expense' : 'Record budget expense';
    if (expenseSubmitBtn) expenseSubmitBtn.textContent = expense ? 'Save changes' : 'Save expense';
    expenseDialog.showModal();
    expenseAmountInput?.focus();
  }

  function syncSplitPreview() {
    if (!splitForm) return false;
    const ref = Number(overview?.reference_balance || 0);
    const nRes = Ipon.parseMoneyAmount(splitNeedsInput?.value, { min: 0, max: 100, required: true, label: 'Needs %', badInput: splitNeedsInput?.validity?.badInput });
    const wRes = Ipon.parseMoneyAmount(splitWantsInput?.value, { min: 0, max: 100, required: true, label: 'Wants %', badInput: splitWantsInput?.validity?.badInput });
    const sRes = Ipon.parseMoneyAmount(splitSavingsInput?.value, { min: 0, max: 100, required: true, label: 'Savings %', badInput: splitSavingsInput?.validity?.badInput });

    const needsVal = nRes.valid ? Number(nRes.value ?? 0) : 0;
    const wantsVal = wRes.valid ? Number(wRes.value ?? 0) : 0;
    const savingsVal = sRes.valid ? Number(sRes.value ?? 0) : 0;
    const total = roundCentavos(needsVal + wantsVal + savingsVal);
    const preview = computeSplitAmounts(ref, needsVal, wantsVal, savingsVal);

    if (splitNeedsPreview) splitNeedsPreview.textContent = Ipon.money(preview.NEEDS);
    if (splitWantsPreview) splitWantsPreview.textContent = Ipon.money(preview.WANTS);
    if (splitSavingsPreview) splitSavingsPreview.textContent = Ipon.money(preview.SAVINGS);
    if (splitSumEl) splitSumEl.textContent = formatPct(total);

    const exactHundred = nRes.valid && wRes.valid && sRes.valid && Math.abs(total - 100) < 0.005;
    if (splitTotalBar) {
      splitTotalBar.classList.toggle('is-valid', exactHundred);
      splitTotalBar.classList.toggle('is-invalid', !exactHundred);
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
    if (splitSubmitBtn) splitSubmitBtn.disabled = !exactHundred;
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
  Ipon.guardMoneyInput(expenseAmountInput, { min: 0.01, max: 999999999999.99, required: true, label: 'Expense amount' });
  [splitNeedsInput, splitWantsInput, splitSavingsInput].forEach((input) => {
    Ipon.guardMoneyInput(input, { min: 0, max: 100, required: true, label: 'Percentage', customDisplay: true });
    input?.addEventListener('input', syncSplitPreview);
    input?.addEventListener('blur', syncSplitPreview);
  });

  itemNameInput?.addEventListener('input', validateItemNameLive);
  itemNameInput?.addEventListener('blur', validateItemNameLive);
  itemCategorySelect?.addEventListener('change', () => {
    renderItemSuggestions(itemCategorySelect.value);
    syncItemHeadroomHelp();
    validateItemNameLive();
  });
  itemSuggestions?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-budget-suggest]');
    if (!chip || !itemNameInput) return;
    itemNameInput.value = chip.dataset.budgetSuggest || '';
    validateItemNameLive();
    itemAmountInput?.focus();
    itemAmountInput?.select();
  });

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
      const expCount = Number(target.expense_count || 0);
      const confirmed = await Ipon.confirmAction({
        title: 'Delete budget item?',
        message: expCount > 0
          ? `Delete "${target.name}" and its ${expCount} tracked expense entr${expCount === 1 ? 'y' : 'ies'}? Your real IPON savings will not be affected.`
          : `Remove "${target.name}" from your budget planner? Your real IPON savings will not be affected.`,
        acceptLabel: 'Delete item'
      });
      if (!confirmed) return;
      Ipon.setBusy(deleteItemBtn, true, 'Deleting…');
      try {
        await Ipon.rpc('delete_budget_item', { p_item_id: target.id });
        Ipon.toast(`Deleted "${target.name}".`);
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(deleteItemBtn, false);
      }
    }
  });

  expensesBody?.addEventListener('click', async (event) => {
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
      const confirmed = await Ipon.confirmAction({
        title: 'Delete budget expense?',
        message: `Remove ${Ipon.money(target.amount)} spent on "${target.item_name}" (${Ipon.dateLabel(target.expense_date)})? This updates remaining budget and never changes your IPON savings.`,
        acceptLabel: 'Delete expense'
      });
      if (!confirmed) return;
      Ipon.setBusy(deleteBtn, true, 'Deleting…');
      try {
        await Ipon.rpc('delete_budget_expense', { p_expense_id: target.id });
        Ipon.toast('Budget expense deleted.');
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(deleteBtn, false);
      }
    }
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
    const amtCheck = Ipon.parseMoneyAmount(expenseAmountInput?.value, { min: 0.01, max: 999999999999.99, required: true, label: 'Expense amount', badInput: expenseAmountInput?.validity?.badInput });
    if (!amtCheck.valid) {
      Ipon.setFieldError(expenseAmountInput, amtCheck.error);
      expenseAmountInput?.focus();
      return;
    }
    Ipon.setFieldError(expenseAmountInput, '');
    if (!expenseItemSelect?.value) {
      Ipon.toast('Select a budget item first.', 'error');
      expenseItemSelect?.focus();
      return;
    }
    Ipon.setBusy(expenseSubmitBtn, true, 'Saving…');
    try {
      await Ipon.rpc('save_budget_expense', {
        p_expense_id: expenseIdInput?.value || null,
        p_item_id: expenseItemSelect.value,
        p_amount: amtCheck.value,
        p_expense_date: expenseDateInput?.value || Ipon.isoDate(),
        p_note: expenseNoteInput?.value?.trim() || null
      });
      expenseDialog?.close();
      Ipon.toast(expenseIdInput?.value ? 'Budget expense updated.' : 'Budget expense recorded.');
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
