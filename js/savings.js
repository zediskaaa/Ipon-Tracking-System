(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || state.redirecting) return;

  const list = document.getElementById('goal-list');
  const form = document.getElementById('goal-form');
  const dialog = document.getElementById('goal-dialog');
  const calcPreset = document.getElementById('calc-goal-preset');
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

  let goals = [];
  let tracked = 0;
  let activeMemberCount = 1;
  let calcInitialized = false;
  let selectedPlanId = '';
  let selectedGoalId = '';

  if (!state.configured || !state.profile) {
    list.innerHTML = '<div class="empty-state">Connect Supabase to load goals.</div>';
    Ipon.setLoading(false);
    return;
  }

  const plansStorageKey = `ipon:calc-plans:${state.profile.group_id || 'group'}:${state.profile.id}`;
  const isAdmin = state.profile.role === 'ADMIN';

  function readSavedPlans() {
    try {
      const raw = localStorage.getItem(plansStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.id === 'string' && typeof p.title === 'string') : [];
    } catch {
      return [];
    }
  }

  function writeSavedPlans(plans) {
    try {
      localStorage.setItem(plansStorageKey, JSON.stringify(plans.slice(0, 20)));
    } catch {
      // Ignore storage quota errors gracefully
    }
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

  function updateCalculatorActions() {
    const hasSelectedPlan = Boolean(selectedPlanId && savedPlans.some((p) => p.id === selectedPlanId));
    const hasSelectedGoal = Boolean(selectedGoalId && goals.some((g) => g.id === selectedGoalId));
    if (calcSavePlanBtn) calcSavePlanBtn.textContent = hasSelectedPlan ? 'Update plan' : 'Save plan';
    if (calcDeletePlanBtn) calcDeletePlanBtn.hidden = !hasSelectedPlan;
    if (calcUpdateGoalBtn) calcUpdateGoalBtn.hidden = !(isAdmin && hasSelectedGoal);
  }

  function updateCalculator() {
    if (!calcTarget || !calcCurrent || !calcDate || !calcMembers) return;
    const target = Math.max(0, Number(calcTarget.value) || 0);
    const current = Math.max(0, Number(calcCurrent.value) || 0);
    const members = Math.max(1, Math.floor(Number(calcMembers.value) || 1));
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
      [dailyEl, weeklyEl, monthlyEl].forEach((el) => { el.textContent = '—'; });
      [dailySub, weeklySub, monthlySub].forEach((el) => { el.textContent = 'Enter a target'; });
      noteEl.textContent = 'Enter a target amount above zero to calculate your savings pace.';
      noteEl.className = 'calc-summary-banner';
      return;
    }

    if (remaining <= 0) {
      [dailyEl, weeklyEl, monthlyEl].forEach((el) => { el.textContent = Ipon.money(0); });
      [dailySub, weeklySub, monthlySub].forEach((el) => { el.textContent = 'Target already reached'; });
      noteEl.textContent = 'Your current savings already meet or exceed this target.';
      noteEl.className = 'calc-summary-banner is-success';
      return;
    }

    if (!calcDate.value || diffDays <= 0) {
      [dailyEl, weeklyEl, monthlyEl].forEach((el) => { el.textContent = '—'; });
      [dailySub, weeklySub, monthlySub].forEach((el) => { el.textContent = 'Pick a future date'; });
      noteEl.textContent = 'Choose a target date in the future to calculate daily, weekly, and monthly contributions.';
      noteEl.className = 'calc-summary-banner is-warn';
      return;
    }

    const weeks = Math.max(1, diffDays / 7);
    const months = Math.max(1, diffDays / 30.4375);
    const perDay = remaining / diffDays;
    const perWeek = remaining / weeks;
    const perMonth = remaining / months;

    dailyEl.textContent = Ipon.money(perDay);
    weeklyEl.textContent = Ipon.money(perWeek);
    monthlyEl.textContent = Ipon.money(perMonth);

    if (members > 1) {
      dailySub.textContent = `${Ipon.money(perDay / members)} / member`;
      weeklySub.textContent = `${Ipon.money(perWeek / members)} / member`;
      monthlySub.textContent = `${Ipon.money(perMonth / members)} / member`;
      noteEl.textContent = `${diffDays} day${diffDays === 1 ? '' : 's'} left · Split across ${members} members`;
    } else {
      dailySub.textContent = 'Group total / day';
      weeklySub.textContent = 'Group total / week';
      monthlySub.textContent = 'Group total / month';
      noteEl.textContent = `${diffDays} day${diffDays === 1 ? '' : 's'} left (${Math.round(months * 10) / 10} mo) to hit ${Ipon.money(target)}.`;
    }
    noteEl.className = 'calc-summary-banner';
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
    calcPreset.innerHTML = '';
    calcPreset.appendChild(new Option('Custom plan (edit fields below)', ''));

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
      goalGroup.label = 'Shared group goals';
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
    if (calcPlanName) calcPlanName.value = goal.title;
    calcTarget.value = goal.target_amount;
    calcCurrent.value = tracked.toFixed(2);
    calcDate.value = goal.target_date || defaultTargetDateIso();
    calcMembers.value = String(activeMemberCount);
    populateCalcPresets();
    updateCalculator();
  }

  function applyPlanToCalculator(plan) {
    if (!plan) return;
    selectedGoalId = '';
    selectedPlanId = plan.id;
    if (calcPlanName) calcPlanName.value = plan.title;
    calcTarget.value = plan.targetAmount;
    calcCurrent.value = Number(plan.currentSavings ?? tracked).toFixed(2);
    calcDate.value = plan.targetDate || defaultTargetDateIso();
    calcMembers.value = String(Math.max(1, Number(plan.members || activeMemberCount)));
    populateCalcPresets();
    updateCalculator();
  }

  function resetCalculatorToCustom() {
    selectedPlanId = '';
    selectedGoalId = '';
    if (calcPlanName) calcPlanName.value = '';
    calcTarget.value = '50000';
    calcCurrent.value = tracked.toFixed(2);
    calcDate.value = defaultTargetDateIso();
    calcMembers.value = String(activeMemberCount);
    populateCalcPresets();
    updateCalculator();
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
      const pacePill = goal.status === 'ACTIVE' && !isReached && diff && diff > 0
        ? `<div class="goal-pace-chip"><span>Suggested pace</span><strong>${Ipon.money(remaining / diff)}/day</strong><small>${activeMemberCount > 1 ? `${Ipon.money((remaining / diff) / activeMemberCount)}/member` : 'Group pace'}</small></div>`
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
          <div class="goal-progress-head"><span>Group Target Progress</span><strong>${Ipon.money(tracked)} / ${Ipon.money(goal.target_amount)} (${pctFormatted})</strong></div>
          <div class="progress" aria-label="${pctFormatted} of target reached"><span style="width:${pctClamped}%"></span></div>
          <div class="goal-progress-sub">
            <span class="goal-remaining ${isReached ? 'is-reached' : ''}">${isReached ? '✓ Target achieved!' : `${Ipon.money(remaining)} remaining`}</span>
            <span class="goal-pct">${pctFormatted} reached</span>
          </div>
        </div>
        ${pacePill}
        <p class="goal-note">${goal.notes ? Ipon.escapeHtml(goal.notes) : 'Progress tracks against the group’s shared confirmed balance. Funds are not locked or allocated to individual goals.'}</p>
        <div class="goal-actions">
          <button class="icon-action" type="button" data-simulate-goal="${goal.id}">Simulate</button>
          ${isAdmin ? `<button class="icon-action" type="button" data-edit-goal="${goal.id}">Edit goal</button><button class="icon-action danger-action" type="button" data-delete-goal="${goal.id}">Delete</button>` : ''}
        </div>
      </article>`;
    }).join('') : `<div class="goal-empty-card">
      <div class="goal-empty-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg></div>
      <h3>No shared targets yet</h3>
      <p>Create a shared group target to track collective progress, or test and save custom plans in the Goal calculator.</p>
      ${isAdmin ? '<button class="button button-primary" type="button" data-open-add-goal>+ Create first goal</button>' : ''}
    </div>`;

    if (selectedGoalId && !goals.some((g) => g.id === selectedGoalId)) selectedGoalId = '';
    populateCalcPresets();
    if (!calcInitialized) {
      calcInitialized = true;
      calcCurrent.value = tracked.toFixed(2);
      calcMembers.value = String(activeMemberCount);
      if (active[0]) {
        applyGoalToCalculator(active[0]);
      } else if (savedPlans[0]) {
        applyPlanToCalculator(savedPlans[0]);
      } else {
        calcDate.value = defaultTargetDateIso();
        updateCalculator();
      }
    } else {
      updateCalculator();
    }
  }

  async function load() {
    const [{ data: summary, error: summaryError }, { data, error }, { count: memberCount }] = await Promise.all([
      Ipon.client.rpc('get_savings_summary'),
      Ipon.client.from('savings_goals').select('*').order('created_at', { ascending: false }),
      Ipon.client.from('members').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').is('deleted_at', null)
    ]);
    if (summaryError) throw summaryError;
    if (error) throw error;
    tracked = Number(summary?.tracked_savings || 0);
    goals = data || [];
    activeMemberCount = Math.max(1, Number(memberCount || 1));
    render();
  }

  function resetForm() {
    form.reset();
    form.elements.goal_id.value = '';
    form.elements.status.value = 'ACTIVE';
    document.getElementById('goal-form-title').textContent = 'Add goal';
    document.getElementById('goal-form-copy').textContent = 'Create a shared savings target.';
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
      document.getElementById('goal-form-title').textContent = 'Edit goal';
      document.getElementById('goal-form-copy').textContent = `Update ${goal.title}.`;
    }
    if (overrides) {
      if (overrides.title) form.elements.title.value = overrides.title;
      if (Number(overrides.target_amount) > 0) form.elements.target_amount.value = overrides.target_amount;
      if (overrides.target_date) form.elements.target_date.value = overrides.target_date;
    }
    dialog.showModal();
    form.elements.title.focus();
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const values = new FormData(form);
    const isEdit = Boolean(values.get('goal_id'));
    const status = String(values.get('status') || 'ACTIVE');
    const title = String(values.get('title') || '').trim();
    const targetAmount = Number(values.get('target_amount'));
    if (title.length < 2) { Ipon.toast('Goal title must be at least 2 characters.', 'error'); return; }
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) { Ipon.toast('Enter a valid target amount.', 'error'); return; }

    const accepted = await Ipon.confirmAction({
      title: isEdit ? 'Save goal changes?' : 'Create savings goal?',
      message: `${isEdit ? 'Update' : 'Create'} "${title}" with target ${Ipon.money(targetAmount)} (${status})?`,
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
        p_notes: values.get('notes') || null
      });
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

    const deleteBtn = event.target.closest('[data-delete-goal]');
    if (deleteBtn) {
      const goal = goals.find((item) => item.id === deleteBtn.dataset.deleteGoal);
      if (!goal) return;
      const accepted = await Ipon.confirmAction({
        title: 'Delete savings goal?',
        message: `Delete "${goal.title}" (${Ipon.money(goal.target_amount)})? Group contributions are unaffected, and this removal is recorded in the audit log.`,
        acceptLabel: 'Delete goal'
      });
      if (!accepted) return;
      Ipon.setBusy(deleteBtn, true);
      try {
        await Ipon.rpc('delete_savings_goal', { p_goal_id: goal.id });
        if (selectedGoalId === goal.id) selectedGoalId = '';
        Ipon.toast('Savings goal deleted.');
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(deleteBtn, false);
      }
    }
  });

  document.getElementById('add-goal')?.addEventListener('click', () => openGoalDialog(null));
  document.getElementById('cancel-goal-edit')?.addEventListener('click', () => dialog.close());
  document.getElementById('close-goal-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', resetForm);

  calcPreset?.addEventListener('change', () => {
    const val = calcPreset.value;
    if (!val) {
      selectedPlanId = '';
      selectedGoalId = '';
      populateCalcPresets();
      updateCalculator();
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
    const targetAmount = Number(calcTarget.value);
    const currentSavings = Math.max(0, Number(calcCurrent.value) || 0);
    const members = Math.max(1, Math.floor(Number(calcMembers.value) || 1));
    if (!Number.isFinite(targetAmount) || targetAmount <= 0) {
      Ipon.toast('Enter a valid target amount above zero before saving.', 'error');
      calcTarget?.focus();
      return;
    }
    const existing = selectedPlanId ? savedPlans.find((p) => p.id === selectedPlanId) : null;
    const rawTitle = (calcPlanName?.value || '').trim();
    const title = rawTitle || `Plan ${Ipon.money(targetAmount)}`;
    if (title.length < 2) {
      Ipon.toast('Plan title must be at least 2 characters.', 'error');
      calcPlanName?.focus();
      return;
    }
    const accepted = await Ipon.confirmAction({
      title: existing ? 'Update saved plan?' : 'Save custom plan?',
      message: `${existing ? 'Update' : 'Save'} "${title}" with target ${Ipon.money(targetAmount)} (${members} member${members === 1 ? '' : 's'})?`,
      acceptLabel: existing ? 'Update plan' : 'Save plan'
    });
    if (!accepted) return;

    const payload = {
      id: existing ? existing.id : (crypto?.randomUUID ? crypto.randomUUID() : `plan-${Date.now()}`),
      title,
      targetAmount,
      currentSavings,
      targetDate: calcDate.value || '',
      members,
      updatedAt: new Date().toISOString()
    };
    if (existing) {
      savedPlans = savedPlans.map((p) => (p.id === existing.id ? payload : p));
    } else {
      savedPlans = [payload, ...savedPlans].slice(0, 20);
      selectedPlanId = payload.id;
      selectedGoalId = '';
    }
    if (calcPlanName) calcPlanName.value = title;
    writeSavedPlans(savedPlans);
    populateCalcPresets();
    updateCalculator();
    Ipon.toast(existing ? 'Saved plan updated.' : 'Custom plan saved.');
  });

  calcDeletePlanBtn?.addEventListener('click', () => {
    if (selectedPlanId) deleteSavedPlan(selectedPlanId);
  });

  calcUpdateGoalBtn?.addEventListener('click', () => {
    const goal = goals.find((item) => item.id === selectedGoalId);
    if (!goal) return;
    openGoalDialog(goal, {
      title: (calcPlanName?.value || '').trim() || goal.title,
      target_amount: Number(calcTarget.value) > 0 ? calcTarget.value : goal.target_amount,
      target_date: calcDate.value || goal.target_date || ''
    });
  });

  calcCreateGoalBtn?.addEventListener('click', () => {
    openGoalDialog(null, {
      title: (calcPlanName?.value || '').trim(),
      target_amount: calcTarget.value,
      target_date: calcDate.value
    });
  });

  try {
    await load();
  } catch (error) {
    Ipon.showInlineError(list, error, load);
  } finally {
    Ipon.setLoading(false);
  }
  Ipon.subscribeToChanges('savings', ['savings_goals', 'contributions', 'withdrawals', 'expenses'], load);
})();
