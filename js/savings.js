(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed || state.redirecting) return;
  const list = document.getElementById('goal-list');
  const form = document.getElementById('goal-form');
  const dialog = document.getElementById('goal-dialog');
  let goals = []; let tracked = 0;
  if (!state.configured || !state.profile) { list.innerHTML = '<div class="empty-state">Connect Supabase to load goals.</div>'; Ipon.setLoading(false); return; }

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
  }
  async function load() {
    const [{ data: summary, error: summaryError }, { data, error }] = await Promise.all([Ipon.client.rpc('get_savings_summary'), Ipon.client.from('savings_goals').select('*').order('created_at', { ascending: false })]);
    if (summaryError) throw summaryError; if (error) throw error; tracked = Number(summary?.tracked_savings || 0); goals = data; render();
  }
  function resetForm() { form.reset(); form.elements.goal_id.value = ''; form.elements.status.value = 'ACTIVE'; document.getElementById('goal-form-title').textContent = 'Add goal'; document.getElementById('goal-form-copy').textContent = 'Create a shared savings target.'; }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); const values = new FormData(form); Ipon.setBusy(button, true);
    try { await Ipon.rpc('save_savings_goal', { p_goal_id: values.get('goal_id') || null, p_title: values.get('title'), p_target_amount: Number(values.get('target_amount')), p_target_date: values.get('target_date') || null, p_status: values.get('status'), p_notes: values.get('notes') || null }); Ipon.toast('Savings goal saved.'); dialog.close(); await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  list.addEventListener('click', (event) => { const button = event.target.closest('[data-edit-goal]'); if (!button) return; const goal = goals.find((item) => item.id === button.dataset.editGoal); if (!goal) return; form.elements.goal_id.value = goal.id; form.elements.title.value = goal.title; form.elements.target_amount.value = goal.target_amount; form.elements.target_date.value = goal.target_date || ''; form.elements.status.value = goal.status; form.elements.notes.value = goal.notes || ''; document.getElementById('goal-form-title').textContent = 'Edit goal'; document.getElementById('goal-form-copy').textContent = `Update ${goal.title}.`; dialog.showModal(); form.elements.title.focus(); });
  document.getElementById('add-goal')?.addEventListener('click', () => { resetForm(); dialog.showModal(); form.elements.title.focus(); });
  document.getElementById('cancel-goal-edit')?.addEventListener('click', () => dialog.close());
  document.getElementById('close-goal-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', resetForm);
  try { await load(); } catch (error) { Ipon.showInlineError(list, error, load); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('savings', ['savings_goals', 'contributions', 'withdrawals', 'expenses'], load);
})();
