(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || state.redirecting) return;
  const list = document.getElementById('goal-list');
  const form = document.getElementById('goal-form');
  const dialog = document.getElementById('goal-dialog');
  const calcPreset = document.getElementById('calc-goal-preset');
  const calcTarget = document.getElementById('calc-target');
  const calcCurrent = document.getElementById('calc-current');
  const calcDate = document.getElementById('calc-date');
  const calcMembers = document.getElementById('calc-members');
  const calcSyncBtn = document.getElementById('calc-sync-balance');
  const calcCreateGoalBtn = document.getElementById('calc-create-goal');
  let goals = []; let tracked = 0; let activeMemberCount = 1; let calcInitialized = false;
  if (!state.configured || !state.profile) { list.innerHTML = '<div class="empty-state">Connect Supabase to load goals.</div>'; Ipon.setLoading(false); return; }

  function defaultTargetDateIso() {
    const d = new Date();
    d.setMonth(d.getMonth() + 3);
    return Ipon.isoDate(d);
  }

  function updateCalculator() {
    if (!calcTarget || !calcCurrent || !calcDate || !calcMembers) return;
    const target = Math.max(0, Number(calcTarget.value) || 0);
    const current = Math.max(0, Number(calcCurrent.value) || 0);
    const members = Math.max(1, Math.floor(Number(calcMembers.value) || 1));
    const remaining = Math.max(0, target - current);
    const today = new Date(`${Ipon.isoDate()}T00:00:00`);
    const end = calcDate.value ? new Date(`${calcDate.value}T00:00:00`) : null;
    const diffDays = end && !Number.isNaN(end.getTime()) ? Math.round((end - today) / 86400000) : 0;

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

    if (!end || diffDays <= 0) {
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

  function populateCalcPresets() {
    if (!calcPreset) return;
    const prev = calcPreset.value;
    const active = goals.filter((goal) => goal.status === 'ACTIVE');
    calcPreset.replaceChildren(
      new Option('Custom scenario', ''),
      ...active.map((goal) => new Option(`${goal.title} (${Ipon.money(goal.target_amount)})`, goal.id))
    );
    if (active.some((g) => g.id === prev)) calcPreset.value = prev;
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
      return `<article class="goal-card"><header><div><h3>${Ipon.escapeHtml(goal.title)}</h3><p>Target: <strong>${Ipon.money(goal.target_amount)}</strong>${goal.target_date ? ` · Target date ${Ipon.dateLabel(goal.target_date)}` : ''}</p></div><span class="status status-${goal.status.toLowerCase()}">${goal.status}</span></header><div class="goal-progress-box"><div class="goal-progress-head"><span>Group Target Progress</span><strong>${Ipon.money(tracked)} / ${Ipon.money(goal.target_amount)} (${pctFormatted})</strong></div><div class="progress" aria-label="${pctFormatted} of target reached"><span style="width:${pctClamped}%"></span></div><div class="goal-progress-sub"><span class="goal-remaining ${isReached ? 'is-reached' : ''}">${isReached ? '✓ Target achieved!' : `${Ipon.money(remaining)} remaining`}</span><span class="goal-pct">${pctFormatted} reached</span></div></div><p class="goal-note">${goal.notes ? Ipon.escapeHtml(goal.notes) : 'Progress tracks against the group’s shared confirmed balance. Funds are not locked or allocated to individual goals.'}</p>${state.profile.role === 'ADMIN' ? `<div class="goal-actions"><button class="icon-action" data-edit-goal="${goal.id}">Edit goal</button></div>` : ''}</article>`;
    }).join('') : '<div class="empty-state">No savings goals yet.</div>';
    populateCalcPresets();
    if (!calcInitialized) {
      calcInitialized = true;
      calcCurrent.value = tracked.toFixed(2);
      calcMembers.value = String(activeMemberCount);
      if (active[0]) {
        calcPreset.value = active[0].id;
        calcTarget.value = active[0].target_amount;
        calcDate.value = active[0].target_date || defaultTargetDateIso();
      } else {
        calcDate.value = defaultTargetDateIso();
      }
    }
    updateCalculator();
  }
  async function load() {
    const [{ data: summary, error: summaryError }, { data, error }, { count: memberCount }] = await Promise.all([
      Ipon.client.rpc('get_savings_summary'),
      Ipon.client.from('savings_goals').select('*').order('created_at', { ascending: false }),
      Ipon.client.from('members').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE').is('deleted_at', null)
    ]);
    if (summaryError) throw summaryError; if (error) throw error;
    tracked = Number(summary?.tracked_savings || 0);
    goals = data;
    activeMemberCount = Math.max(1, Number(memberCount || 1));
    render();
  }
  function resetForm() { form.reset(); form.elements.goal_id.value = ''; form.elements.status.value = 'ACTIVE'; document.getElementById('goal-form-title').textContent = 'Add goal'; document.getElementById('goal-form-copy').textContent = 'Create a shared savings target.'; }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); const values = new FormData(form);
    const isEdit = Boolean(values.get('goal_id'));
    const status = String(values.get('status') || 'ACTIVE');
    const accepted = await Ipon.confirmAction({
      title: isEdit ? 'Save goal changes?' : 'Create savings goal?',
      message: `${isEdit ? 'Update' : 'Create'} "${String(values.get('title') || '').trim()}" with target ${Ipon.money(Number(values.get('target_amount')))} (${status})?`,
      acceptLabel: isEdit ? 'Save goal' : 'Create goal'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true);
    try { await Ipon.rpc('save_savings_goal', { p_goal_id: values.get('goal_id') || null, p_title: values.get('title'), p_target_amount: Number(values.get('target_amount')), p_target_date: values.get('target_date') || null, p_status: values.get('status'), p_notes: values.get('notes') || null }); Ipon.toast('Savings goal saved.'); dialog.close(); await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  list.addEventListener('click', (event) => { const button = event.target.closest('[data-edit-goal]'); if (!button) return; const goal = goals.find((item) => item.id === button.dataset.editGoal); if (!goal) return; form.elements.goal_id.value = goal.id; form.elements.title.value = goal.title; form.elements.target_amount.value = goal.target_amount; form.elements.target_date.value = goal.target_date || ''; form.elements.status.value = goal.status; form.elements.notes.value = goal.notes || ''; document.getElementById('goal-form-title').textContent = 'Edit goal'; document.getElementById('goal-form-copy').textContent = `Update ${goal.title}.`; dialog.showModal(); form.elements.title.focus(); });
  document.getElementById('add-goal')?.addEventListener('click', () => { resetForm(); dialog.showModal(); form.elements.title.focus(); });
  document.getElementById('cancel-goal-edit')?.addEventListener('click', () => dialog.close());
  document.getElementById('close-goal-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', resetForm);
  calcPreset?.addEventListener('change', () => {
    const goal = goals.find((item) => item.id === calcPreset.value);
    if (goal) {
      calcTarget.value = goal.target_amount;
      if (goal.target_date) calcDate.value = goal.target_date;
      calcCurrent.value = tracked.toFixed(2);
    }
    updateCalculator();
  });
  [calcTarget, calcCurrent, calcDate, calcMembers].forEach((input) => {
    input?.addEventListener('input', () => {
      if (input === calcTarget || input === calcDate) calcPreset.value = '';
      updateCalculator();
    });
  });
  calcSyncBtn?.addEventListener('click', () => {
    calcCurrent.value = tracked.toFixed(2);
    calcMembers.value = String(activeMemberCount);
    updateCalculator();
  });
  calcCreateGoalBtn?.addEventListener('click', () => {
    resetForm();
    if (Number(calcTarget.value) > 0) form.elements.target_amount.value = calcTarget.value;
    if (calcDate.value) form.elements.target_date.value = calcDate.value;
    dialog.showModal();
    form.elements.title.focus();
  });
  try { await load(); } catch (error) { Ipon.showInlineError(list, error, load); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('savings', ['savings_goals', 'contributions', 'withdrawals', 'expenses'], load);
})();
