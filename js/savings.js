(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || state.redirecting) return;

  const list = document.getElementById('goal-list');
  const form = document.getElementById('goal-form');
  const dialog = document.getElementById('goal-dialog');
  const calcPreset = document.getElementById('calc-goal-preset');
  const calcPresetField = document.getElementById('calc-preset-field');
  const calcPlanName = document.getElementById('calc-plan-name');
  const calcSavedPlans = document.getElementById('calc-saved-plans');
  const calcTarget = document.getElementById('calc-target');
  const calcCurrent = document.getElementById('calc-current');
  const calcDate = document.getElementById('calc-date');
  const calcMembers = document.getElementById('calc-members');
  const calcSyncBtn = document.getElementById('calc-sync-balance');
  const calcResetPlanBtn = document.getElementById('calc-reset-plan');
  const calcSavePlanBtn = document.getElementById('calc-save-plan');
  const calcDeletePlanBtn = document.getElementById('calc-delete-plan');
  const calcUpdateGoalBtn = document.getElementById('calc-update-goal');
  const calcCreateGoalBtn = document.getElementById('calc-create-goal');
  const calcStartWorkspaceBtn = document.getElementById('calc-start-workspace');
  const goalDurationCount = document.getElementById('goal-duration-count');
  const goalDurationUnit = document.getElementById('goal-duration-unit');
  const goalFreqSelect = document.getElementById('goal-saving-frequency');
  const goalScheduleFields = document.getElementById('goal-schedule-fields');
  const goalScheduledAmountInput = document.getElementById('goal-scheduled-amount');
  const goalScheduleStartInput = document.getElementById('goal-schedule-start');
  const goalSuggestGrid = document.getElementById('goal-suggestion-grid');
  const goalSuggestNote = document.getElementById('goal-suggest-note');
  const goalTargetAmountInput = document.getElementById('target-amount');
  const goalTargetDateInput = document.getElementById('target-date');
  const calcPaceCards = [...document.querySelectorAll('.calc-kpi[data-calc-pace]')];

  let goals = [];
  let tracked = 0;
  let activeMemberCount = 1;
  let calcInitialized = false;
  let selectedPlanId = '';
  let selectedGoalId = '';
  let selectedCalcPace = '';
  let lastCalcSuggestions = null;
  let lastFormSuggestions = null;

  if (!state.configured || !state.profile) {
    list.innerHTML = '<div class="empty-state">Connect Supabase to load goals.</div>';
    Ipon.setLoading(false);
    return;
  }

  const plansStorageKey = `ipon:calc-plans:${state.profile.group_id || 'group'}:${state.profile.id}`;
  const preWorkspacePlansKey = `ipon:calc-plans:group:${state.profile.id}`;
  const plansMigratedKey = `${plansStorageKey}:cloud-migrated`;
  const hasWorkspace = Boolean(state.profile.group_id);
  const isSolo = state.profile.workspace_mode === 'SOLO';
  const isPersonalCopy = isSolo || !hasWorkspace;
  const isAdmin = hasWorkspace && state.profile.role === 'ADMIN';
  let cloudPlansAvailable = hasWorkspace;
  if (calcStartWorkspaceBtn) calcStartWorkspaceBtn.hidden = hasWorkspace;
  if (isPersonalCopy) {
    const sub = document.getElementById('savings-page-subtitle');
    if (sub) sub.textContent = 'Set personal savings targets against your confirmed tracked balance. Goals guide your pace; they do not reserve or move money.';
    const head = document.getElementById('savings-targets-heading');
    if (head) head.textContent = 'Savings targets';
    const calcSub = document.getElementById('calc-panel-subtitle');
    if (calcSub) calcSub.textContent = 'Simulate any custom scenario, save plans to compare later, or activate one as a live savings goal.';
    if (calcUpdateGoalBtn) calcUpdateGoalBtn.textContent = 'Update goal';
  }

  function mapPlanRow(row) {
    return {
      id: row.id,
      title: row.title,
      targetAmount: Number(row.target_amount),
      currentSavings: Number(row.current_amount || 0),
      targetDate: row.target_date || '',
      members: Math.max(1, Number(row.split_members || 1)),
      updatedAt: row.updated_at || new Date().toISOString()
    };
  }

  function readPlansFromKey(key) {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string') : [];
    } catch {
      return [];
    }
  }

  function readSavedPlans() {
    const own = readPlansFromKey(plansStorageKey);
    if (own.length || !hasWorkspace || preWorkspacePlansKey === plansStorageKey) return own;
    return readPlansFromKey(preWorkspacePlansKey);
  }

  function writeSavedPlans(plans) {
    try {
      localStorage.setItem(plansStorageKey, JSON.stringify(plans.slice(0, 20)));
    } catch {
      // Ignore storage quota errors gracefully
    }
  }

  async function syncSavedPlansFromCloud() {
    if (!state.profile.group_id) return readSavedPlans();
    const { data, error } = await Ipon.client
      .from('savings_calculator_plans')
      .select('id, title, target_amount, current_amount, target_date, split_members, updated_at')
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error) {
      cloudPlansAvailable = false;
      return readSavedPlans();
    }
    cloudPlansAvailable = true;
    let rows = data || [];
    const localLegacy = readSavedPlans();
    const alreadyMigrated = localStorage.getItem(plansMigratedKey) === '1';
    if (!alreadyMigrated && localLegacy.length && !rows.length) {
      const inserts = localLegacy.slice(0, 20).map((p) => ({
        group_id: state.profile.group_id,
        user_id: state.profile.id,
        title: String(p.title || 'Saved plan').slice(0, 150),
        target_amount: Math.max(1, Number(p.targetAmount) || 1),
        current_amount: Math.max(0, Number(p.currentSavings) || 0),
        target_date: p.targetDate || null,
        split_members: Math.min(500, Math.max(1, Math.floor(Number(p.members) || 1)))
      }));
      const { data: migrated } = await Ipon.client
        .from('savings_calculator_plans')
        .insert(inserts)
        .select('id, title, target_amount, current_amount, target_date, split_members, updated_at');
      if (migrated?.length) {
        rows = migrated;
        localStorage.setItem(plansMigratedKey, '1');
      }
    } else if (rows.length) {
      localStorage.setItem(plansMigratedKey, '1');
    }
    const mapped = rows.map(mapPlanRow);
    writeSavedPlans(mapped);
    return mapped;
  }

  let savedPlans = readSavedPlans();

  function defaultTargetDateIso() {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return Ipon.isoDate(d);
  }

  function daysUntil(dateIso) {
    if (!dateIso) return null;
    const today = new Date(`${Ipon.isoDate()}T00:00:00`);
    const end = new Date(`${dateIso}T00:00:00`);
    if (Number.isNaN(end.getTime())) return null;
    return Math.round((end - today) / 86400000);
  }

  function getCalcGoalReadiness() {
    const missing = [];
    const titleVal = String(calcPlanName?.value || '').trim();
    if (titleVal.length < 2 || titleVal.length > 150) missing.push('Plan title');

    const targetCheck = Ipon.parseMoneyAmount(calcTarget?.value, {
      min: 1,
      max: Ipon.MAX_MONEY_AMOUNT,
      required: true,
      label: 'Target amount',
      badInput: Boolean(calcTarget?.validity?.badInput)
    });
    if (!targetCheck.valid) missing.push('Target amount');

    const currentCheck = Ipon.parseMoneyAmount(calcCurrent?.value, {
      min: 0,
      max: Ipon.MAX_MONEY_AMOUNT,
      required: false,
      label: 'Current savings',
      badInput: Boolean(calcCurrent?.validity?.badInput)
    });
    if (!currentCheck.valid) missing.push('valid Current savings');

    const rawMembers = String(calcMembers?.value ?? '').trim();
    if (rawMembers && (!/^[1-9]\d*$/.test(rawMembers) || rawMembers.length > 3 || Number(rawMembers) < 1 || Number(rawMembers) > 500)) {
      missing.push('valid Split among members (1–500)');
    }

    const diffDays = daysUntil(calcDate?.value);
    if (!calcDate?.value || diffDays === null || diffDays <= 0) missing.push('future Target date');

    const pacePayload = selectedCalcSchedulePayload();
    if (!pacePayload.saving_frequency || !(Number(pacePayload.scheduled_amount) > 0)) {
      missing.push('a saving pace (Daily, Weekly, or Monthly)');
    }

    const hasRemaining = Boolean(lastCalcSuggestions && lastCalcSuggestions.remaining > 0 && lastCalcSuggestions.hasFutureDate);
    if (targetCheck.valid && calcDate?.value && diffDays > 0 && !hasRemaining) {
      missing.push('remaining amount above zero');
    }

    return {
      ready: missing.length === 0 && hasRemaining,
      missing,
      reason: missing.length ? `Complete ${missing.join(', ')} first.` : ''
    };
  }

  function updateCalculatorActions() {
    const hasSelectedPlan = Boolean(selectedPlanId && savedPlans.some((p) => p.id === selectedPlanId));
    const hasSelectedGoal = Boolean(selectedGoalId && goals.some((g) => g.id === selectedGoalId));
    const readiness = getCalcGoalReadiness();
    if (calcSavePlanBtn) calcSavePlanBtn.textContent = hasSelectedPlan ? 'Update plan' : 'Save plan';
    if (calcDeletePlanBtn) calcDeletePlanBtn.hidden = !hasSelectedPlan;
    if (calcUpdateGoalBtn) {
      calcUpdateGoalBtn.hidden = !(isAdmin && hasSelectedGoal);
      calcUpdateGoalBtn.disabled = !(readiness.ready && hasSelectedGoal);
      calcUpdateGoalBtn.title = readiness.ready ? '' : readiness.reason;
    }
    if (calcCreateGoalBtn) {
      calcCreateGoalBtn.disabled = !readiness.ready;
      calcCreateGoalBtn.title = readiness.ready ? '' : readiness.reason;
    }
    if (calcStartWorkspaceBtn) {
      calcStartWorkspaceBtn.disabled = !readiness.ready;
      calcStartWorkspaceBtn.title = readiness.ready ? '' : readiness.reason;
    }
  }

  function validateWholeNumberField(input, { min = 1, max = 500, required = false, label = 'Value' } = {}) {
    if (!input) return { valid: true, value: null, error: '' };
    const raw = String(input.value ?? '').trim();
    if (!raw) {
      const error = required ? `Enter ${label.toLowerCase()}.` : '';
      input.setCustomValidity?.(error);
      Ipon.setFieldError?.(input, error);
      return { valid: !required, value: null, error };
    }
    if (!/^[1-9]\d*$/.test(raw)) {
      const error = `Enter a whole number between ${min.toLocaleString()} and ${max.toLocaleString()} (no leading zeros or decimals).`;
      input.setCustomValidity?.(error);
      Ipon.setFieldError?.(input, error);
      return { valid: false, value: null, error };
    }
    const maxDigits = String(max).length;
    const num = Number(raw);
    if (raw.length > maxDigits || !Number.isSafeInteger(num) || num < min || num > max) {
      const error = `${label} must be between ${min.toLocaleString()} and ${max.toLocaleString()}.`;
      input.setCustomValidity?.(error);
      Ipon.setFieldError?.(input, error);
      return { valid: false, value: null, error };
    }
    input.setCustomValidity?.('');
    Ipon.setFieldError?.(input, '');
    return { valid: true, value: num, error: '' };
  }

  function guardWholeNumberInput(input, opts) {
    if (!input || input.dataset.wholeGuardBound) return;
    input.dataset.wholeGuardBound = '1';
    input.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (['e', 'E', '+', '-', '.', ','].includes(event.key)) event.preventDefault();
    });
    const run = () => validateWholeNumberField(input, opts);
    input.addEventListener('input', run);
    input.addEventListener('blur', run);
  }

  function validateTitleField(input, { required = false, label = 'Title' } = {}) {
    if (!input) return { valid: true, value: '', error: '' };
    const val = String(input.value || '').trim();
    if (!val) {
      const error = required ? `${label} is required.` : '';
      input.setCustomValidity?.(error);
      Ipon.setFieldError?.(input, error);
      return { valid: !required, value: '', error };
    }
    if (val.length < 2 || val.length > 150) {
      const error = `${label} must be between 2 and 150 characters.`;
      input.setCustomValidity?.(error);
      Ipon.setFieldError?.(input, error);
      return { valid: false, value: val, error };
    }
    input.setCustomValidity?.('');
    Ipon.setFieldError?.(input, '');
    return { valid: true, value: val, error: '' };
  }

  function validateDateField(input, { requireFuture = false, label = 'Target date' } = {}) {
    if (!input) return { valid: true, value: '', error: '' };
    const val = String(input.value || '').trim();
    if (!val) {
      input.setCustomValidity?.('');
      Ipon.setFieldError?.(input, '');
      return { valid: true, value: '', error: '' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || val < '2000-01-01' || val > '2100-12-31') {
      const error = `${label} must be between 2000-01-01 and 2100-12-31.`;
      input.setCustomValidity?.(error);
      Ipon.setFieldError?.(input, error);
      return { valid: false, value: val, error };
    }
    if (requireFuture) {
      const diff = daysUntil(val);
      if (diff === null || diff <= 0) {
        const error = `${label} must be a future date.`;
        input.setCustomValidity?.(error);
        Ipon.setFieldError?.(input, error);
        return { valid: false, value: val, error };
      }
    }
    input.setCustomValidity?.('');
    Ipon.setFieldError?.(input, '');
    return { valid: true, value: val, error: '' };
  }

  function validateCalculatorForm({ requireTarget = true } = {}) {
    const titleCheck = validateTitleField(calcPlanName, { required: false, label: 'Plan title' });
    if (!titleCheck.valid) { calcPlanName?.focus(); return { valid: false, error: titleCheck.error }; }

    const targetCheck = Ipon.parseMoneyAmount(calcTarget?.value, {
      min: 1,
      max: Ipon.MAX_MONEY_AMOUNT,
      required: requireTarget,
      label: 'Target amount',
      badInput: Boolean(calcTarget?.validity?.badInput)
    });
    Ipon.setFieldError?.(calcTarget, targetCheck.error);
    if (!targetCheck.valid) { calcTarget?.focus(); return { valid: false, error: targetCheck.error }; }

    const currentCheck = Ipon.parseMoneyAmount(calcCurrent?.value, {
      min: 0,
      max: Ipon.MAX_MONEY_AMOUNT,
      required: false,
      label: 'Current savings',
      badInput: Boolean(calcCurrent?.validity?.badInput)
    });
    Ipon.setFieldError?.(calcCurrent, currentCheck.error);
    if (!currentCheck.valid) { calcCurrent?.focus(); return { valid: false, error: currentCheck.error }; }

    const dateCheck = validateDateField(calcDate, { requireFuture: false, label: 'Target date' });
    if (!dateCheck.valid) { calcDate?.focus(); return { valid: false, error: dateCheck.error }; }

    const membersCheck = validateWholeNumberField(calcMembers, {
      min: 1,
      max: 500,
      required: false,
      label: 'Split among members'
    });
    if (!membersCheck.valid) { calcMembers?.focus(); return { valid: false, error: membersCheck.error }; }

    return {
      valid: true,
      title: titleCheck.value,
      targetAmount: targetCheck.value ?? 0,
      currentSavings: currentCheck.value ?? 0,
      targetDate: dateCheck.value,
      members: membersCheck.value ?? 1
    };
  }

  Ipon.guardMoneyInput?.(calcTarget, { min: 1, required: false, label: 'Target amount' });
  Ipon.guardMoneyInput?.(calcCurrent, { min: 0, required: false, label: 'Current savings' });
  guardWholeNumberInput(calcMembers, { min: 1, max: 500, required: false, label: 'Split among members' });
  guardWholeNumberInput(goalDurationCount, { min: 1, max: 3650, required: false, label: 'Duration' });
  calcPlanName?.addEventListener('input', () => {
    validateTitleField(calcPlanName, { required: false, label: 'Plan title' });
    updateCalculatorActions();
  });
  calcPlanName?.addEventListener('blur', () => {
    validateTitleField(calcPlanName, { required: false, label: 'Plan title' });
    updateCalculatorActions();
  });
  calcDate?.addEventListener('input', () => validateDateField(calcDate, { requireFuture: true, label: 'Target date' }));
  calcDate?.addEventListener('blur', () => validateDateField(calcDate, { requireFuture: true, label: 'Target date' }));
  form?.elements?.title?.addEventListener('input', () => validateTitleField(form.elements.title, { required: true, label: 'Goal title' }));
  form?.elements?.title?.addEventListener('blur', () => validateTitleField(form.elements.title, { required: true, label: 'Goal title' }));
  goalTargetDateInput?.addEventListener('blur', () => validateDateField(goalTargetDateInput, { requireFuture: false, label: 'Target date' }));
  goalScheduleStartInput?.addEventListener('blur', () => validateDateField(goalScheduleStartInput, { requireFuture: false, label: 'Schedule start date' }));

  function updateCalculator() {
    if (!calcTarget || !calcCurrent || !calcDate || !calcMembers) return;
    const targetParsed = Ipon.parseMoneyAmount(calcTarget.value, { min: 1, max: Ipon.MAX_MONEY_AMOUNT, required: false, label: 'Target amount', badInput: Boolean(calcTarget.validity?.badInput) });
    const currentParsed = Ipon.parseMoneyAmount(calcCurrent.value, { min: 0, max: Ipon.MAX_MONEY_AMOUNT, required: false, label: 'Current savings', badInput: Boolean(calcCurrent.validity?.badInput) });
    const membersParsed = validateWholeNumberField(calcMembers, { min: 1, max: 500, required: false, label: 'Split among members' });
    const target = targetParsed.valid ? Math.max(0, Number(targetParsed.value) || 0) : 0;
    const current = currentParsed.valid ? Math.max(0, Number(currentParsed.value) || 0) : 0;
    const members = isSolo ? 1 : (membersParsed.valid ? Math.max(1, Number(membersParsed.value) || 1) : 1);
    const remaining = Math.max(0, target - current);
    const diffDays = daysUntil(calcDate.value) ?? 0;

    const remEl = document.getElementById('calc-remaining');
    const remSub = document.getElementById('calc-remaining-sub');
    const dailyEl = document.getElementById('calc-daily');
    const dailySub = document.getElementById('calc-daily-sub');
    const weeklyEl = document.getElementById('calc-weekly');
    const weeklySub = document.getElementById('calc-weekly-sub');
    const monthlyEl = document.getElementById('calc-monthly');
    const monthlySub = document.getElementById('calc-monthly-sub');
    const noteEl = document.getElementById('calc-timeline-note');

    remEl.textContent = Ipon.money(remaining);
    remSub.textContent = members > 1 ? `${Ipon.money(remaining / members)} per member` : 'To reach target';
    updateCalculatorActions();

    if (target <= 0) {
      lastCalcSuggestions = null;
      [dailyEl, weeklyEl, monthlyEl].forEach((el) => { el.textContent = '—'; });
      [dailySub, weeklySub, monthlySub].forEach((el) => { el.textContent = 'Enter a target'; });
      noteEl.textContent = 'Enter a target amount above zero to calculate your savings pace.';
      noteEl.className = 'calc-summary-banner';
      updateCalculatorActions();
      return;
    }

    if (remaining <= 0) {
      lastCalcSuggestions = null;
      [dailyEl, weeklyEl, monthlyEl].forEach((el) => { el.textContent = Ipon.money(0); });
      [dailySub, weeklySub, monthlySub].forEach((el) => { el.textContent = 'Target already reached'; });
      noteEl.textContent = 'Your current savings already meet or exceed this target.';
      noteEl.className = 'calc-summary-banner is-success';
      updateCalculatorActions();
      return;
    }

    if (!calcDate.value || diffDays <= 0) {
      lastCalcSuggestions = null;
      [dailyEl, weeklyEl, monthlyEl].forEach((el) => { el.textContent = '—'; });
      [dailySub, weeklySub, monthlySub].forEach((el) => { el.textContent = 'Pick a future date'; });
      noteEl.textContent = 'Choose a target date in the future to calculate daily, weekly, and monthly contributions.';
      noteEl.className = 'calc-summary-banner is-warn';
      updateCalculatorActions();
      return;
    }

    const suggestions = Ipon.computeGoalScheduleSuggestions({
      targetAmount: target,
      currentSavings: current,
      targetDate: calcDate.value,
      memberCount: members
    });
    lastCalcSuggestions = suggestions;
    const perDay = suggestions.daily.amount;
    const perWeek = suggestions.weekly.amount;
    const perMonth = suggestions.monthly.amount;
    const months = suggestions.monthly.periods;

    dailyEl.textContent = Ipon.money(perDay);
    weeklyEl.textContent = Ipon.money(perWeek);
    monthlyEl.textContent = Ipon.money(perMonth);

    if (!isSolo && members > 1) {
      dailySub.textContent = `${Ipon.money(suggestions.daily.perMember)} / member`;
      weeklySub.textContent = `${Ipon.money(suggestions.weekly.perMember)} / member`;
      monthlySub.textContent = `${Ipon.money(suggestions.monthly.perMember)} / member`;
    } else {
      dailySub.textContent = 'Your deposit / day';
      weeklySub.textContent = 'Your deposit / week';
      monthlySub.textContent = 'Your deposit / month';
    }

    const chosenPayload = selectedCalcSchedulePayload();
    if (chosenPayload.saving_frequency && Number(chosenPayload.scheduled_amount) > 0) {
      const unitMap = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' };
      const labelMap = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };
      const unit = unitMap[chosenPayload.saving_frequency] || 'period';
      const label = labelMap[chosenPayload.saving_frequency] || chosenPayload.saving_frequency;
      const updateLabel = isSolo ? 'Update goal' : 'Update shared goal';
      const actionHint = isAdmin
        ? (selectedGoalId ? `Click "${updateLabel}" or "Create goal from plan" below.` : 'Click "Create goal from plan" below to apply.')
        : (!hasWorkspace ? 'Click "Activate solo tracker & goal" below to start tracking right away.' : 'Selected for simulation.');
      noteEl.textContent = `Selected: ${label} (${Ipon.money(chosenPayload.scheduled_amount)}/${unit}) · ${actionHint}`;
      noteEl.className = 'calc-summary-banner is-success';
    } else if (!isSolo && members > 1) {
      noteEl.textContent = `${diffDays} day${diffDays === 1 ? '' : 's'} left · Split across ${members} members · Tap Per day, Per week, or Per month to select`;
      noteEl.className = 'calc-summary-banner';
    } else {
      noteEl.textContent = `${diffDays} day${diffDays === 1 ? '' : 's'} left (${Math.round(months * 10) / 10} mo) to hit ${Ipon.money(target)} · Tap Per day, Per week, or Per month to select`;
      noteEl.className = 'calc-summary-banner';
    }
    syncCalcPaceSelection();
    updateCalculatorActions();
  }

  function syncCalcPaceSelection() {
    calcPaceCards.forEach((card) => {
      const active = Boolean(selectedCalcPace && card.dataset.calcPace === selectedCalcPace);
      card.classList.toggle('is-chosen', active);
      card.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function selectedCalcSchedulePayload() {
    if (!selectedCalcPace || !lastCalcSuggestions) return {};
    const key = selectedCalcPace.toLowerCase();
    const pace = lastCalcSuggestions[key];
    if (!pace || !(pace.amount > 0)) return {};
    return {
      saving_frequency: selectedCalcPace,
      scheduled_amount: pace.amount.toFixed(2)
    };
  }

  function renderSavedPlansStrip() {
    if (!calcSavedPlans) return;
    if (!savedPlans.length) {
      calcSavedPlans.hidden = true;
      calcSavedPlans.innerHTML = '';
      return;
    }
    calcSavedPlans.hidden = false;
    calcSavedPlans.innerHTML = `<div class="calc-plans-head"><span>Saved plans</span><small>${savedPlans.length} saved</small></div><div class="calc-plan-pills">${savedPlans.map((plan) => {
      const isSelected = plan.id === selectedPlanId;
      return `<div class="calc-plan-pill ${isSelected ? 'is-active' : ''}"><button class="calc-plan-load" type="button" data-load-plan="${plan.id}"><strong>${Ipon.escapeHtml(plan.title)}</strong><span>${Ipon.money(plan.targetAmount)}</span></button><button class="calc-plan-remove" type="button" data-remove-plan="${plan.id}" aria-label="Delete ${Ipon.escapeHtml(plan.title)}" title="Delete plan">×</button></div>`;
    }).join('')}</div>`;
  }

  function populateCalcPresets() {
    if (!calcPreset) return;
    const active = goals.filter((goal) => goal.status === 'ACTIVE');
    const hasOptions = savedPlans.length > 0 || active.length > 0;
    if (calcPresetField) calcPresetField.hidden = !hasOptions;
    calcPreset.innerHTML = '';
    calcPreset.appendChild(new Option('New blank plan', ''));

    if (savedPlans.length) {
      const planGroup = document.createElement('optgroup');
      planGroup.label = 'Saved custom plans';
      savedPlans.forEach((plan) => {
        planGroup.appendChild(new Option(`${plan.title} (${Ipon.money(plan.targetAmount)})`, `plan:${plan.id}`));
      });
      calcPreset.appendChild(planGroup);
    }

    if (active.length) {
      const goalGroup = document.createElement('optgroup');
      goalGroup.label = isSolo ? 'Active savings goals' : 'Shared group goals';
      active.forEach((goal) => {
        goalGroup.appendChild(new Option(`${goal.title} (${Ipon.money(goal.target_amount)})`, `goal:${goal.id}`));
      });
      calcPreset.appendChild(goalGroup);
    }

    if (selectedPlanId && savedPlans.some((p) => p.id === selectedPlanId)) {
      calcPreset.value = `plan:${selectedPlanId}`;
    } else if (selectedGoalId && active.some((g) => g.id === selectedGoalId)) {
      calcPreset.value = `goal:${selectedGoalId}`;
    } else {
      calcPreset.value = '';
    }
    renderSavedPlansStrip();
    updateCalculatorActions();
  }

  function applyGoalToCalculator(goal) {
    if (!goal) return;
    selectedPlanId = '';
    selectedGoalId = goal.id;
    selectedCalcPace = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(goal.saving_frequency || '').toUpperCase())
      ? String(goal.saving_frequency).toUpperCase()
      : '';
    if (calcPlanName) calcPlanName.value = goal.title;
    calcTarget.value = goal.target_amount;
    calcCurrent.value = tracked.toFixed(2);
    calcDate.value = goal.target_date || '';
    calcMembers.value = String(activeMemberCount);
    populateCalcPresets();
    updateCalculator();
    syncCalcPaceSelection();
  }

  function applyPlanToCalculator(plan) {
    if (!plan) return;
    selectedGoalId = '';
    selectedPlanId = plan.id;
    selectedCalcPace = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(plan.savingFrequency || '').toUpperCase())
      ? String(plan.savingFrequency).toUpperCase()
      : '';
    if (calcPlanName) calcPlanName.value = plan.title;
    calcTarget.value = plan.targetAmount;
    calcCurrent.value = Number(plan.currentSavings || 0) > 0 ? Number(plan.currentSavings).toFixed(2) : '';
    calcDate.value = plan.targetDate || '';
    calcMembers.value = Number(plan.members) > 1 ? String(Math.floor(Number(plan.members))) : '';
    populateCalcPresets();
    updateCalculator();
  }

  function resetCalculatorToCustom() {
    selectedPlanId = '';
    selectedGoalId = '';
    selectedCalcPace = '';
    if (calcPlanName) { calcPlanName.value = ''; calcPlanName.setCustomValidity?.(''); Ipon.setFieldError?.(calcPlanName, ''); }
    calcTarget.value = ''; calcTarget.setCustomValidity?.(''); Ipon.setFieldError?.(calcTarget, '');
    calcCurrent.value = ''; calcCurrent.setCustomValidity?.(''); Ipon.setFieldError?.(calcCurrent, '');
    calcDate.value = ''; calcDate.setCustomValidity?.(''); Ipon.setFieldError?.(calcDate, '');
    calcMembers.value = ''; calcMembers.setCustomValidity?.(''); Ipon.setFieldError?.(calcMembers, '');
    populateCalcPresets();
    updateCalculator();
    syncCalcPaceSelection();
  }

  async function deleteSavedPlan(planId) {
    const plan = savedPlans.find((p) => p.id === planId);
    if (!plan) return;
    const accepted = await Ipon.confirmAction({
      title: 'Delete saved plan?',
      message: `Remove "${plan.title}" (${Ipon.money(plan.targetAmount)}) from your saved plans?`,
      acceptLabel: 'Delete plan'
    });
    if (!accepted) return;
    if (cloudPlansAvailable && !planId.startsWith('plan-')) {
      const { error } = await Ipon.client.from('savings_calculator_plans').delete().eq('id', planId);
      if (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
        return;
      }
    }
    savedPlans = savedPlans.filter((p) => p.id !== planId);
    writeSavedPlans(savedPlans);
    if (selectedPlanId === planId) {
      selectedPlanId = '';
      if (calcPlanName) calcPlanName.value = '';
    }
    populateCalcPresets();
    updateCalculator();
    Ipon.toast('Saved plan deleted.');
  }

  function render() {
    const active = goals.filter((goal) => goal.status === 'ACTIVE');
    document.getElementById('tracked-savings').textContent = Ipon.money(tracked);
    document.getElementById('active-goals').textContent = active.length;
    document.getElementById('goal-targets').textContent = Ipon.money(active.reduce((sum, goal) => sum + Number(goal.target_amount), 0));
    const dates = active.map((goal) => goal.target_date).filter(Boolean).sort();
    document.getElementById('nearest-date').textContent = dates[0] ? Ipon.dateLabel(dates[0], { month: 'short', day: 'numeric' }) : 'None';

    if (!hasWorkspace) {
      Ipon.renderGroupRequiredCard(list, {
        hasGroup: false,
        onCreateGroup: (mode) => {
          if (mode === 'SOLO' && Number(calcTarget?.value) > 0) {
            activateSoloGoalFromCalculator(calcStartWorkspaceBtn);
          } else {
            window.location.href = `dashboard.html?create_group=1&workspace_mode=${mode}`;
          }
        }
      });
    } else {
      list.innerHTML = goals.length ? goals.map((goal) => {
      const target = Number(goal.target_amount) || 0;
      const pct = target > 0 ? (tracked / target) * 100 : 0;
      const pctClamped = Math.min(100, Math.max(0, pct));
      const pctFormatted = (Math.round(pct * 10) / 10).toFixed(pct % 1 === 0 ? 0 : 1) + '%';
      const remaining = Math.max(0, target - tracked);
      const isReached = target > 0 && tracked >= target;
      const diff = daysUntil(goal.target_date);
      let dateMeta = '';
      if (goal.target_date) {
        const countdown = diff === null ? '' : diff > 0 ? ` (${diff}d left)` : diff === 0 ? ' (Today)' : ' (Past due)';
        dateMeta = ` · Target date ${Ipon.dateLabel(goal.target_date)}${countdown}`;
      }
      const sched = Ipon.computeGoalScheduleStatus(goal, { trackedSavings: tracked });
      const toneClass = sched.status === 'OVERDUE_CARRYOVER'
        ? 'is-overdue'
        : sched.status === 'DUE_NOW'
          ? 'is-unpaid'
          : sched.status === 'AHEAD_CREDIT'
            ? 'is-ahead'
            : sched.status === 'REACHED'
              ? 'is-reached'
              : 'is-ontrack';
      const scheduleStripHtml = sched.enabled
        ? `<div class="goal-schedule-strip ${toneClass}">
            <div class="goal-schedule-strip-top">
              <span class="goal-schedule-pill">${Ipon.escapeHtml(sched.frequencyLabel)} · ${Ipon.money(sched.scheduledAmount)}/${Ipon.escapeHtml(sched.unitLabel)}</span>
              ${sched.isUnpaid ? '<span class="goal-schedule-flag">Unpaid</span>' : sched.status === 'AHEAD_CREDIT' ? '<span class="goal-schedule-flag">Paid ahead</span>' : ''}
            </div>
            <p class="goal-schedule-summary">${Ipon.escapeHtml(sched.summaryLabel)}</p>
          </div>`
        : '';
      const pacePill = !sched.enabled && goal.status === 'ACTIVE' && !isReached && diff && diff > 0
        ? `<div class="goal-pace-chip"><span>Suggested pace</span><strong>${Ipon.money(remaining / diff)}/day</strong><small>${!isSolo && activeMemberCount > 1 ? `${Ipon.money((remaining / diff) / activeMemberCount)}/member` : (isSolo ? 'Your pace' : 'Group pace')}</small></div>`
        : '';
      const depositHref = state.profile.role === 'MEMBER'
        ? `user.html?goal_due=${encodeURIComponent(goal.id)}`
        : `dashboard.html?record_goal=${encodeURIComponent(goal.id)}`;
      const depositActionHtml = goal.status === 'ACTIVE' && sched.enabled && !sched.isReached && sched.nextAutoFillAmount > 0
        ? `<a class="icon-action is-deposit" href="${depositHref}">+ Deposit ${Ipon.money(sched.nextAutoFillAmount)}</a>`
        : '';

      return `<article class="goal-card">
        <header>
          <div>
            <h3>${Ipon.escapeHtml(goal.title)}</h3>
            <p>Target: <strong>${Ipon.money(goal.target_amount)}</strong>${dateMeta}</p>
          </div>
          <span class="status status-${goal.status.toLowerCase()}">${goal.status}</span>
        </header>
        <div class="goal-progress-box">
          <div class="goal-progress-head"><span>${isSolo ? 'Target Progress' : 'Group Target Progress'}</span><strong>${Ipon.money(tracked)} / ${Ipon.money(goal.target_amount)} (${pctFormatted})</strong></div>
          <div class="progress" aria-label="${pctFormatted} of target reached"><span style="width:${pctClamped}%"></span></div>
          <div class="goal-progress-sub">
            <span class="goal-remaining ${isReached ? 'is-reached' : ''}">${isReached ? '✓ Target achieved!' : `${Ipon.money(remaining)} remaining`}</span>
            <span class="goal-pct">${pctFormatted} reached</span>
          </div>
          ${scheduleStripHtml}
        </div>
        ${pacePill}
        <p class="goal-note">${goal.notes ? Ipon.escapeHtml(goal.notes) : (isSolo ? 'Progress tracks against your confirmed savings balance. Funds are not locked or reserved.' : 'Progress tracks against the group’s shared confirmed balance. Funds are not locked or allocated to individual goals.')}</p>
        <div class="goal-actions">
          ${depositActionHtml}
          <button class="icon-action" type="button" data-simulate-goal="${goal.id}">Simulate</button>
          ${isAdmin ? `${goal.status === 'ACTIVE' ? `<button class="icon-action is-done" type="button" data-complete-goal="${goal.id}">Mark done</button>` : ''}<button class="icon-action" type="button" data-edit-goal="${goal.id}">Edit goal</button><button class="icon-action danger-action" type="button" data-delete-goal="${goal.id}">Move to bin</button>` : ''}
        </div>
      </article>`;
    }).join('') : `<div class="goal-empty-card">
      <div class="goal-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></div>
      <h3>${isSolo ? 'No savings targets yet' : 'No shared targets yet'}</h3>
      <p>${isSolo ? 'Create a personal savings target to track your progress, or test plans in the Goal calculator.' : 'Create a shared group target to track collective progress, or test and save custom plans in the Goal calculator.'}</p>
      ${isAdmin ? '<button class="button button-primary" type="button" data-open-add-goal>+ Create first goal</button>' : ''}
    </div>`;
    }

    if (selectedGoalId && !goals.some((g) => g.id === selectedGoalId)) selectedGoalId = '';
    populateCalcPresets();
    if (!calcInitialized) {
      calcInitialized = true;
      resetCalculatorToCustom();
    } else {
      updateCalculator();
    }
  }

  async function load() {
    const [{ data: summary, error: summaryError }, { data, error }, { count: memberCount }, syncedPlans] = await Promise.all([
      Ipon.client.rpc('get_savings_summary'),
      Ipon.client.from('savings_goals').select('*').order('created_at', { ascending: false }),
      Ipon.client.from('members').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').eq('activation_status', 'ACTIVE').is('deleted_at', null),
      syncSavedPlansFromCloud()
    ]);
    if (summaryError) throw summaryError;
    if (error) throw error;
    tracked = Number(summary?.tracked_savings || 0);
    goals = data || [];
    savedPlans = syncedPlans;
    activeMemberCount = Math.max(1, Number(memberCount || 1));
    render();
  }

  const goalDirty = Ipon.bindDirtySaveForm?.(form, form?.querySelector('[type="submit"]'), {
    getActive: () => Boolean(form?.elements?.goal_id?.value)
  });

  Ipon.guardMoneyInput?.(goalTargetAmountInput, { min: 0.01, required: true, label: 'Target amount' });
  Ipon.guardMoneyInput?.(goalScheduledAmountInput, { min: 0.01, required: false, label: 'Scheduled deposit' });

  function syncGoalScheduleVisibility() {
    const freq = String(goalFreqSelect?.value || 'NONE').toUpperCase();
    const enabled = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq);
    if (goalScheduleFields) goalScheduleFields.hidden = !enabled;
    if (goalScheduledAmountInput) {
      goalScheduledAmountInput.required = enabled;
      if (!enabled) {
        goalScheduledAmountInput.value = '';
        Ipon.setFieldError?.(goalScheduledAmountInput, '');
      }
    }
    if (goalScheduleStartInput && enabled && !goalScheduleStartInput.value) {
      goalScheduleStartInput.value = Ipon.isoDate();
    }
    goalSuggestGrid?.querySelectorAll('[data-suggest-freq]').forEach((btn) => {
      const active = enabled && btn.dataset.suggestFreq === freq;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncGoalFormSuggestions() {
    const targetVal = Number(goalTargetAmountInput?.value || 0);
    const targetDateVal = goalTargetDateInput?.value || '';
    const suggestions = Ipon.computeGoalScheduleSuggestions({
      targetAmount: targetVal,
      currentSavings: tracked,
      targetDate: targetDateVal,
      memberCount: activeMemberCount
    });
    lastFormSuggestions = suggestions;

    const dailyEl = document.getElementById('goal-suggest-daily');
    const weeklyEl = document.getElementById('goal-suggest-weekly');
    const monthlyEl = document.getElementById('goal-suggest-monthly');
    const dailySub = document.getElementById('goal-suggest-daily-sub');
    const weeklySub = document.getElementById('goal-suggest-weekly-sub');
    const monthlySub = document.getElementById('goal-suggest-monthly-sub');

    if (!(targetVal > 0)) {
      if (dailyEl) dailyEl.textContent = '—';
      if (weeklyEl) weeklyEl.textContent = '—';
      if (monthlyEl) monthlyEl.textContent = '—';
      if (dailySub) dailySub.textContent = 'Enter target';
      if (weeklySub) weeklySub.textContent = 'Enter target';
      if (monthlySub) monthlySub.textContent = 'Enter target';
      if (goalSuggestNote) goalSuggestNote.textContent = 'Enter a target amount to see suggested daily, weekly, and monthly deposits.';
      return;
    }

    if (!(suggestions.remaining > 0)) {
      if (dailyEl) dailyEl.textContent = Ipon.money(0);
      if (weeklyEl) weeklyEl.textContent = Ipon.money(0);
      if (monthlyEl) monthlyEl.textContent = Ipon.money(0);
      if (dailySub) dailySub.textContent = 'Target met';
      if (weeklySub) weeklySub.textContent = 'Target met';
      if (monthlySub) monthlySub.textContent = 'Target met';
      if (goalSuggestNote) goalSuggestNote.textContent = 'Current tracked savings already reach this target.';
      return;
    }

    if (dailyEl) dailyEl.textContent = Ipon.money(suggestions.daily.amount);
    if (weeklyEl) weeklyEl.textContent = Ipon.money(suggestions.weekly.amount);
    if (monthlyEl) monthlyEl.textContent = Ipon.money(suggestions.monthly.amount);
    if (dailySub) dailySub.textContent = activeMemberCount > 1 ? `${Ipon.money(suggestions.daily.perMember)} / member` : 'Per day';
    if (weeklySub) weeklySub.textContent = activeMemberCount > 1 ? `${Ipon.money(suggestions.weekly.perMember)} / member` : 'Per week';
    if (monthlySub) monthlySub.textContent = activeMemberCount > 1 ? `${Ipon.money(suggestions.monthly.perMember)} / member` : 'Per month';

    if (goalSuggestNote) {
      goalSuggestNote.textContent = suggestions.hasFutureDate
        ? `Based on ${Ipon.money(suggestions.remaining)} remaining over ${suggestions.effectiveDays} day${suggestions.effectiveDays === 1 ? '' : 's'}. Tap a pace to select it.`
        : `Estimated over 30 days (${Ipon.money(suggestions.remaining)} remaining). Set a timeframe or target date to refine.`;
    }
  }

  function applyDurationToTargetDate() {
    const durCheck = validateWholeNumberField(goalDurationCount, { min: 1, max: 3650, required: false, label: 'Duration' });
    if (!durCheck.valid || !(durCheck.value > 0)) return;
    const count = durCheck.value;
    const unit = String(goalDurationUnit?.value || 'DAYS').toUpperCase();
    const d = new Date();
    if (unit === 'WEEKS') d.setDate(d.getDate() + (count * 7));
    else if (unit === 'MONTHS') d.setMonth(d.getMonth() + count);
    else d.setDate(d.getDate() + count);
    if (goalTargetDateInput) {
      goalTargetDateInput.value = Ipon.isoDate(d);
    }
    syncGoalFormSuggestions();
    const activeFreq = String(goalFreqSelect?.value || 'NONE').toUpperCase();
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(activeFreq) && lastFormSuggestions?.[activeFreq.toLowerCase()]?.amount > 0 && goalScheduledAmountInput && !goalScheduledAmountInput.dataset.userEdited) {
      goalScheduledAmountInput.value = lastFormSuggestions[activeFreq.toLowerCase()].amount.toFixed(2);
    }
  }

  function resetForm() {
    form.reset();
    form.elements.goal_id.value = '';
    form.elements.status.value = 'ACTIVE';
    [form.elements.title, goalTargetAmountInput, goalDurationCount, goalTargetDateInput, goalScheduledAmountInput, goalScheduleStartInput].forEach((el) => {
      if (!el) return;
      el.setCustomValidity?.('');
      Ipon.setFieldError?.(el, '');
    });
    if (goalDurationCount) goalDurationCount.value = '';
    if (goalDurationUnit) goalDurationUnit.value = 'DAYS';
    if (goalFreqSelect) goalFreqSelect.value = 'NONE';
    if (goalScheduledAmountInput) {
      goalScheduledAmountInput.value = '';
      delete goalScheduledAmountInput.dataset.userEdited;
    }
    if (goalScheduleStartInput) goalScheduleStartInput.value = '';
    document.getElementById('goal-form-title').textContent = 'Add goal';
    document.getElementById('goal-form-copy').textContent = isSolo ? 'Create a personal savings target.' : 'Create a shared savings target.';
    syncGoalScheduleVisibility();
    syncGoalFormSuggestions();
    goalDirty?.reset();
  }

  function openGoalDialog(goal, overrides) {
    resetForm();
    if (goal) {
      form.elements.goal_id.value = goal.id;
      form.elements.title.value = goal.title;
      form.elements.target_amount.value = goal.target_amount;
      form.elements.target_date.value = goal.target_date || '';
      form.elements.status.value = goal.status;
      form.elements.notes.value = goal.notes || '';
      const freq = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(goal.saving_frequency || '').toUpperCase())
        ? String(goal.saving_frequency).toUpperCase()
        : 'NONE';
      if (goalFreqSelect) goalFreqSelect.value = freq;
      if (goalScheduledAmountInput && Number(goal.scheduled_amount) > 0) {
        goalScheduledAmountInput.value = Number(goal.scheduled_amount).toFixed(2);
      }
      if (goalScheduleStartInput) {
        goalScheduleStartInput.value = goal.schedule_start_date || Ipon.isoDate();
      }
      document.getElementById('goal-form-title').textContent = 'Edit goal';
      document.getElementById('goal-form-copy').textContent = `Update ${goal.title}.`;
    }
    if (overrides) {
      if (overrides.title) form.elements.title.value = overrides.title;
      if (Number(overrides.target_amount) > 0) form.elements.target_amount.value = overrides.target_amount;
      if (overrides.target_date) form.elements.target_date.value = overrides.target_date;
      if (overrides.saving_frequency && goalFreqSelect) {
        goalFreqSelect.value = String(overrides.saving_frequency).toUpperCase();
      }
      if (Number(overrides.scheduled_amount) > 0 && goalScheduledAmountInput) {
        goalScheduledAmountInput.value = Number(overrides.scheduled_amount).toFixed(2);
      }
    }
    syncGoalScheduleVisibility();
    syncGoalFormSuggestions();
    goalDirty?.reset();
    dialog.showModal();
    form.elements.title.focus();
  }

  goalTargetAmountInput?.addEventListener('input', syncGoalFormSuggestions);
  goalTargetDateInput?.addEventListener('input', () => {
    if (goalDurationCount) goalDurationCount.value = '';
    syncGoalFormSuggestions();
  });
  goalDurationCount?.addEventListener('input', applyDurationToTargetDate);
  goalDurationUnit?.addEventListener('change', applyDurationToTargetDate);
  goalScheduledAmountInput?.addEventListener('input', () => {
    if (goalScheduledAmountInput) goalScheduledAmountInput.dataset.userEdited = '1';
  });
  goalFreqSelect?.addEventListener('change', () => {
    syncGoalScheduleVisibility();
    const freq = String(goalFreqSelect.value || 'NONE').toUpperCase();
    const suggested = lastFormSuggestions?.[freq.toLowerCase()]?.amount || 0;
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq) && suggested > 0 && goalScheduledAmountInput && !goalScheduledAmountInput.value) {
      goalScheduledAmountInput.value = suggested.toFixed(2);
    }
  });
  goalSuggestGrid?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-suggest-freq]');
    if (!btn) return;
    const freq = String(btn.dataset.suggestFreq || '').toUpperCase();
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) return;
    if (goalFreqSelect) goalFreqSelect.value = freq;
    syncGoalFormSuggestions();
    const suggested = lastFormSuggestions?.[freq.toLowerCase()]?.amount || 0;
    if (goalScheduledAmountInput && suggested > 0) {
      goalScheduledAmountInput.value = suggested.toFixed(2);
      delete goalScheduledAmountInput.dataset.userEdited;
      Ipon.setFieldError?.(goalScheduledAmountInput, '');
    }
    syncGoalScheduleVisibility();
    goalDirty?.sync?.();
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const isEdit = Boolean(values.get('goal_id'));
    const status = String(values.get('status') || 'ACTIVE');
    const titleCheck = validateTitleField(form.elements.title, { required: true, label: 'Goal title' });
    if (!titleCheck.valid) { form.elements.title?.focus(); Ipon.toast(titleCheck.error, 'error'); return; }
    const title = titleCheck.value;
    const targetCheck = Ipon.parseMoneyAmount(values.get('target_amount'), { min: 0.01, required: true, label: 'Target amount', badInput: Boolean(goalTargetAmountInput?.validity?.badInput) });
    if (!targetCheck.valid) {
      Ipon.setFieldError?.(goalTargetAmountInput, targetCheck.error);
      goalTargetAmountInput?.focus();
      Ipon.toast(targetCheck.error, 'error');
      return;
    }
    const targetDateCheck = validateDateField(goalTargetDateInput, { requireFuture: false, label: 'Target date' });
    if (!targetDateCheck.valid) { goalTargetDateInput?.focus(); Ipon.toast(targetDateCheck.error, 'error'); return; }
    const targetAmount = targetCheck.value;
    const savingFrequency = String(values.get('saving_frequency') || 'NONE').toUpperCase();
    let scheduledAmount = null;
    let scheduleStartDate = null;
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(savingFrequency)) {
      const schedCheck = Ipon.parseMoneyAmount(values.get('scheduled_amount'), { min: 0.01, required: true, label: 'Scheduled deposit', badInput: Boolean(goalScheduledAmountInput?.validity?.badInput) });
      if (!schedCheck.valid) {
        Ipon.setFieldError?.(goalScheduledAmountInput, schedCheck.error);
        goalScheduledAmountInput?.focus();
        Ipon.toast(schedCheck.error, 'error');
        return;
      }
      const startDateCheck = validateDateField(goalScheduleStartInput, { requireFuture: false, label: 'Schedule start date' });
      if (!startDateCheck.valid) { goalScheduleStartInput?.focus(); Ipon.toast(startDateCheck.error, 'error'); return; }
      scheduledAmount = schedCheck.value;
      scheduleStartDate = startDateCheck.value || Ipon.isoDate();
    }

    const freqUnit = savingFrequency === 'DAILY' ? 'day' : savingFrequency === 'WEEKLY' ? 'week' : 'month';
    const scheduleCopy = scheduledAmount ? ` · ${savingFrequency.charAt(0) + savingFrequency.slice(1).toLowerCase()} deposit: ${Ipon.money(scheduledAmount)}/${freqUnit}` : '';

    const accepted = await Ipon.confirmAction({
      title: isEdit ? 'Save goal changes?' : 'Create savings goal?',
      message: `${isEdit ? 'Update' : 'Create'} "${title}" with target ${Ipon.money(targetAmount)} (${status})${scheduleCopy}?`,
      acceptLabel: isEdit ? 'Save goal' : 'Create goal'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('save_savings_goal', {
        p_goal_id: values.get('goal_id') || null,
        p_title: title,
        p_target_amount: targetAmount,
        p_target_date: values.get('target_date') || null,
        p_status: status,
        p_notes: values.get('notes') || null,
        p_saving_frequency: savingFrequency,
        p_scheduled_amount: scheduledAmount,
        p_schedule_start_date: scheduleStartDate
      });
      if (savingFrequency !== 'NONE') {
        Ipon.rpc('sync_my_due_reminders').catch(() => {});
      }
      Ipon.toast(isEdit ? 'Savings goal updated.' : 'Savings goal created.');
      dialog.close();
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  list.addEventListener('click', async (event) => {
    const addBtn = event.target.closest('[data-open-add-goal]');
    if (addBtn) { openGoalDialog(null); return; }

    const simBtn = event.target.closest('[data-simulate-goal]');
    if (simBtn) {
      const goal = goals.find((item) => item.id === simBtn.dataset.simulateGoal);
      if (goal) {
        applyGoalToCalculator(goal);
        calcTarget?.focus();
        Ipon.toast(`Loaded "${goal.title}" into calculator.`);
      }
      return;
    }

    const editBtn = event.target.closest('[data-edit-goal]');
    if (editBtn) {
      const goal = goals.find((item) => item.id === editBtn.dataset.editGoal);
      if (goal) openGoalDialog(goal);
      return;
    }

    const completeBtn = event.target.closest('[data-complete-goal]');
    if (completeBtn) {
      const goal = goals.find((item) => item.id === completeBtn.dataset.completeGoal);
      if (!goal) return;
      const accepted = await Ipon.confirmAction({
        title: 'Mark savings goal as done?',
        message: `Mark "${goal.title}" (${Ipon.money(goal.target_amount)}) as completed and move it into the 30-day Recycle Bin? You can still recover it for 30 days before permanent database removal.`,
        acceptLabel: 'Mark done & bin (30d)'
      });
      if (!accepted) return;
      Ipon.setBusy(completeBtn, true, 'Moving…');
      try {
        await Ipon.rpc('complete_and_bin_savings_goal', { p_goal_id: goal.id, p_move_to_bin: true });
        if (selectedGoalId === goal.id) selectedGoalId = '';
        Ipon.toast('Goal marked done and moved to the 30-day Bin.');
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(completeBtn, false);
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-delete-goal]');
    if (deleteBtn) {
      const goal = goals.find((item) => item.id === deleteBtn.dataset.deleteGoal);
      if (!goal) return;
      const accepted = await Ipon.confirmAction({
        title: 'Delete savings goal?',
        message: `Move "${goal.title}" (${Ipon.money(goal.target_amount)}) to the 30-day Recycle Bin? ${isSolo ? 'Your savings records are unaffected' : 'Group contributions are unaffected'}, and you have 30 days to recover it before automatic permanent deletion.`,
        acceptLabel: 'Move to 30d Bin'
      });
      if (!accepted) return;
      Ipon.setBusy(deleteBtn, true, 'Moving…');
      try {
        await Ipon.rpc('delete_savings_goal', { p_goal_id: goal.id });
        if (selectedGoalId === goal.id) selectedGoalId = '';
        Ipon.toast('Savings goal moved to the 30-day Bin.');
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(deleteBtn, false);
      }
    }
  });

  document.getElementById('open-savings-bin')?.addEventListener('click', () => {
    window.IponPolicy?.openRecycleBin?.({ defaultType: 'goal', onChanged: load });
  });
  document.getElementById('finish-savings-cycle')?.addEventListener('click', () => {
    window.IponPolicy?.openFinishSavingsBatchDialog?.({ onDone: load });
  });
  document.getElementById('add-goal')?.addEventListener('click', () => openGoalDialog(null));
  document.getElementById('cancel-goal-edit')?.addEventListener('click', () => dialog.close());
  document.getElementById('close-goal-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', resetForm);

  calcPreset?.addEventListener('change', () => {
    const val = calcPreset.value;
    if (!val) {
      resetCalculatorToCustom();
      return;
    }
    if (val.startsWith('plan:')) {
      const plan = savedPlans.find((item) => item.id === val.slice(5));
      if (plan) applyPlanToCalculator(plan);
      return;
    }
    if (val.startsWith('goal:')) {
      const goal = goals.find((item) => item.id === val.slice(5));
      if (goal) applyGoalToCalculator(goal);
    }
  });

  calcSavedPlans?.addEventListener('click', (event) => {
    const loadBtn = event.target.closest('[data-load-plan]');
    if (loadBtn) {
      const plan = savedPlans.find((p) => p.id === loadBtn.dataset.loadPlan);
      if (plan) applyPlanToCalculator(plan);
      return;
    }
    const removeBtn = event.target.closest('[data-remove-plan]');
    if (removeBtn) {
      deleteSavedPlan(removeBtn.dataset.removePlan);
    }
  });

  [calcTarget, calcCurrent, calcDate, calcMembers].forEach((input) => {
    input?.addEventListener('input', updateCalculator);
  });

  calcSyncBtn?.addEventListener('click', () => {
    calcCurrent.value = tracked.toFixed(2);
    calcMembers.value = String(activeMemberCount);
    updateCalculator();
  });

  calcResetPlanBtn?.addEventListener('click', () => {
    resetCalculatorToCustom();
    calcPlanName?.focus();
  });

  calcSavePlanBtn?.addEventListener('click', async () => {
    const check = validateCalculatorForm({ requireTarget: true });
    if (!check.valid) {
      Ipon.toast(check.error || 'Fix the highlighted fields before saving.', 'error');
      return;
    }
    const { targetAmount, currentSavings, members } = check;
    const existing = selectedPlanId ? savedPlans.find((p) => p.id === selectedPlanId) : null;
    const title = check.title || `Plan ${Ipon.money(targetAmount)}`;
    const accepted = await Ipon.confirmAction({
      title: existing ? 'Update saved plan?' : 'Save custom plan?',
      message: `${existing ? 'Update' : 'Save'} "${title}" with target ${Ipon.money(targetAmount)} (${members} member${members === 1 ? '' : 's'})?`,
      acceptLabel: existing ? 'Update plan' : 'Save plan'
    });
    if (!accepted) return;

    Ipon.setBusy(calcSavePlanBtn, true);
    try {
      let payload;
      if (cloudPlansAvailable && state.profile.group_id) {
        const dbRow = {
          title: title.slice(0, 150),
          target_amount: targetAmount,
          current_amount: currentSavings,
          target_date: calcDate.value || null,
          split_members: Math.min(500, members)
        };
        if (existing && !existing.id.startsWith('plan-')) {
          const { data, error } = await Ipon.client
            .from('savings_calculator_plans')
            .update(dbRow)
            .eq('id', existing.id)
            .select('id, title, target_amount, current_amount, target_date, split_members, updated_at')
            .single();
          if (error) throw error;
          payload = mapPlanRow(data);
        } else {
          const { data, error } = await Ipon.client
            .from('savings_calculator_plans')
            .insert({ ...dbRow, group_id: state.profile.group_id, user_id: state.profile.id })
            .select('id, title, target_amount, current_amount, target_date, split_members, updated_at')
            .single();
          if (error) throw error;
          payload = mapPlanRow(data);
        }
      } else {
        const paceInfo = selectedCalcSchedulePayload();
        payload = {
          id: existing ? existing.id : (crypto?.randomUUID ? crypto.randomUUID() : `plan-${Date.now()}`),
          title,
          targetAmount,
          currentSavings,
          targetDate: calcDate.value || '',
          members,
          savingFrequency: paceInfo.saving_frequency || 'NONE',
          scheduledAmount: paceInfo.scheduled_amount ? Number(paceInfo.scheduled_amount) : null,
          updatedAt: new Date().toISOString()
        };
      }

      if (existing) {
        savedPlans = savedPlans.map((p) => (p.id === existing.id ? payload : p));
        selectedPlanId = payload.id;
      } else {
        savedPlans = [payload, ...savedPlans].slice(0, 20);
        selectedPlanId = payload.id;
        selectedGoalId = '';
      }
      if (calcPlanName) calcPlanName.value = payload.title;
      writeSavedPlans(savedPlans);
      populateCalcPresets();
      updateCalculator();
      Ipon.toast(
        hasWorkspace
          ? (existing ? 'Saved plan updated.' : 'Custom plan saved.')
          : 'Simulation plan saved in calculator. Start Solo savings or a group to track it as a live goal.'
      );
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(calcSavePlanBtn, false);
    }
  });

  calcDeletePlanBtn?.addEventListener('click', () => {
    if (selectedPlanId) deleteSavedPlan(selectedPlanId);
  });

  calcPaceCards.forEach((card) => {
    card.addEventListener('click', () => {
      if (!lastCalcSuggestions || !(lastCalcSuggestions.remaining > 0)) {
        Ipon.toast('Enter a target amount and future target date first.', 'error');
        return;
      }
      const pace = String(card.dataset.calcPace || '').toUpperCase();
      selectedCalcPace = selectedCalcPace === pace ? '' : pace;
      updateCalculator();
    });
  });

  async function saveGoalFromCalculator({ existingGoal = null, triggerBtn = null } = {}) {
    const check = validateCalculatorForm({ requireTarget: true });
    if (!check.valid) {
      Ipon.toast(check.error || 'Fix the highlighted fields in the Goal calculator first.', 'error');
      return;
    }
    const titleCheck = validateTitleField(calcPlanName, { required: true, label: 'Plan title' });
    if (!titleCheck.valid) {
      calcPlanName?.focus();
      Ipon.toast(titleCheck.error, 'error');
      return;
    }
    const dateCheck = validateDateField(calcDate, { requireFuture: true, label: 'Target date' });
    if (!dateCheck.valid || !dateCheck.value) {
      calcDate?.focus();
      Ipon.toast(dateCheck.error || 'Pick a future target date first.', 'error');
      return;
    }
    const pacePayload = selectedCalcSchedulePayload();
    const savingFrequency = pacePayload.saving_frequency || '';
    const scheduledAmount = Number(pacePayload.scheduled_amount || 0);
    if (!savingFrequency || !(scheduledAmount > 0)) {
      Ipon.toast('Choose a saving pace (Per day, Per week, or Per month) first.', 'error');
      return;
    }

    const isEdit = Boolean(existingGoal?.id);
    const title = titleCheck.value.slice(0, 150);
    const unitMap = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' };
    const freqLabel = savingFrequency.charAt(0) + savingFrequency.slice(1).toLowerCase();
    const accepted = await Ipon.confirmAction({
      title: isEdit ? 'Update savings goal?' : 'Create savings goal?',
      message: `${isEdit ? 'Update' : 'Create'} "${title}" with target ${Ipon.money(check.targetAmount)} (${freqLabel} deposit: ${Ipon.money(scheduledAmount)}/${unitMap[savingFrequency] || 'period'})?`,
      acceptLabel: isEdit ? 'Update goal' : 'Create goal'
    });
    if (!accepted) return;

    if (triggerBtn) Ipon.setBusy(triggerBtn, true, isEdit ? 'Updating…' : 'Creating…');
    try {
      await Ipon.rpc('save_savings_goal', {
        p_goal_id: isEdit ? existingGoal.id : null,
        p_title: title,
        p_target_amount: check.targetAmount,
        p_target_date: dateCheck.value,
        p_status: existingGoal?.status || 'ACTIVE',
        p_notes: existingGoal?.notes || null,
        p_saving_frequency: savingFrequency,
        p_scheduled_amount: scheduledAmount,
        p_schedule_start_date: Ipon.isoDate()
      });
      Ipon.rpc('sync_my_due_reminders').catch(() => {});
      Ipon.toast(isEdit ? 'Savings goal updated.' : 'Savings goal created.');
      resetCalculatorToCustom();
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      if (triggerBtn) Ipon.setBusy(triggerBtn, false);
    }
  }

  calcUpdateGoalBtn?.addEventListener('click', () => {
    const goal = goals.find((item) => item.id === selectedGoalId);
    if (!goal) return;
    saveGoalFromCalculator({ existingGoal: goal, triggerBtn: calcUpdateGoalBtn });
  });

  async function activateSoloGoalFromCalculator(triggerBtn = null) {
    const check = validateCalculatorForm({ requireTarget: true });
    if (!check.valid) {
      Ipon.toast(check.error || 'Fix the highlighted fields in the Goal calculator first.', 'error');
      return;
    }
    const titleCheck = validateTitleField(calcPlanName, { required: true, label: 'Plan title' });
    if (!titleCheck.valid) {
      calcPlanName?.focus();
      Ipon.toast(titleCheck.error, 'error');
      return;
    }
    const dateCheck = validateDateField(calcDate, { requireFuture: true, label: 'Target date' });
    if (!dateCheck.valid || !dateCheck.value) {
      calcDate?.focus();
      Ipon.toast(dateCheck.error || 'Pick a future target date first.', 'error');
      return;
    }
    const pacePayload = selectedCalcSchedulePayload();
    const savingFrequency = pacePayload.saving_frequency || '';
    const scheduledAmount = Number(pacePayload.scheduled_amount || 0);
    if (!savingFrequency || !(scheduledAmount > 0)) {
      Ipon.toast('Choose a saving pace (Per day, Per week, or Per month) first.', 'error');
      return;
    }

    const targetAmount = check.targetAmount;
    const title = titleCheck.value.slice(0, 150);
    const targetDate = dateCheck.value;
    const unitMap = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' };
    const scheduleCopy = ` · ${savingFrequency.charAt(0) + savingFrequency.slice(1).toLowerCase()} deposit: ${Ipon.money(scheduledAmount)}/${unitMap[savingFrequency] || 'period'}`;

    const confirmed = await Ipon.confirmAction({
      title: 'Activate solo tracker & goal?',
      message: `Create your personal Solo workspace "${title}" and activate this goal (${Ipon.money(targetAmount)}${scheduleCopy}) right away?`,
      acceptLabel: 'Activate goal'
    });
    if (!confirmed) return;

    const rawMonthly = Number(lastCalcSuggestions?.monthly?.amount || scheduledAmount || targetAmount || 100);
    const monthlyBaseline = Math.min(1000000, Math.max(1, Math.round(rawMonthly * 100) / 100));

    if (triggerBtn) Ipon.setBusy(triggerBtn, true, 'Activating…');
    try {
      await Ipon.rpc('admin_create_group', {
        p_name: title,
        p_avatar_url: null,
        p_include_self: true,
        p_monthly_amount: monthlyBaseline,
        p_workspace_mode: 'SOLO'
      });
      Ipon.syncWorkspaceMode?.('SOLO');
      await Ipon.rpc('save_savings_goal', {
        p_goal_id: null,
        p_title: title,
        p_target_amount: targetAmount,
        p_target_date: targetDate,
        p_status: 'ACTIVE',
        p_notes: null,
        p_saving_frequency: savingFrequency,
        p_scheduled_amount: scheduledAmount,
        p_schedule_start_date: Ipon.isoDate()
      });
      try { localStorage.removeItem(preWorkspacePlansKey); } catch { }
      Ipon.rpc('sync_my_due_reminders').catch(() => {});
      Ipon.toast('Solo tracker and savings goal activated!');
      window.location.href = 'dashboard.html';
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      if (triggerBtn) Ipon.setBusy(triggerBtn, false);
    }
  }

  calcStartWorkspaceBtn?.addEventListener('click', () => {
    activateSoloGoalFromCalculator(calcStartWorkspaceBtn);
  });

  calcCreateGoalBtn?.addEventListener('click', () => {
    saveGoalFromCalculator({ existingGoal: null, triggerBtn: calcCreateGoalBtn });
  });

  try {
    await load();
  } catch (error) {
    Ipon.showInlineError(list, error, load);
  } finally {
    Ipon.setLoading(false);
  }
  Ipon.subscribeToChanges('savings', ['savings_goals', 'savings_calculator_plans', 'contributions', 'withdrawals', 'expenses', 'groups'], load);
})();
