(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed) return;
  const list = document.getElementById('goal-list');
  const form = document.getElementById('goal-form');
  let goals = []; let tracked = 0;
  if (!state.configured || !state.profile) { list.innerHTML = '<div class="empty-state">Connect Supabase to load goals.</div>'; return; }

  function render() {
    const active = goals.filter((goal) => goal.status === 'ACTIVE');
    document.getElementById('tracked-savings').textContent = Ipon.money(tracked);
    document.getElementById('active-goals').textContent = active.length;
    document.getElementById('goal-targets').textContent = Ipon.money(active.reduce((sum, goal) => sum + Number(goal.target_amount), 0));
    const dates = active.map((goal) => goal.target_date).filter(Boolean).sort();
    document.getElementById('nearest-date').textContent = dates[0] ? Ipon.dateLabel(dates[0], { month: 'short', day: 'numeric' }) : 'None';
    list.innerHTML = goals.length ? goals.map((goal) => {
      const progress = Math.min(100, Math.max(0, tracked / Number(goal.target_amount) * 100));
      return `<article class="goal-card"><header><div><h3>${Ipon.escapeHtml(goal.title)}</h3><p>${Ipon.money(goal.target_amount)}${goal.target_date ? ` · target ${Ipon.dateLabel(goal.target_date)}` : ''}</p></div><span class="status status-${goal.status.toLowerCase()}">${goal.status}</span></header><div class="progress" aria-label="${Math.round(progress)} percent"><span style="width:${progress}%"></span></div><p>${Math.round(progress)}% of target based on confirmed tracked savings.</p>${state.profile.role === 'ADMIN' ? `<button class="icon-action" data-edit-goal="${goal.id}">Edit goal</button>` : ''}</article>`;
    }).join('') : '<div class="empty-state">No savings goals yet.</div>';
  }
  async function load() {
    const [{ data: summary, error: summaryError }, { data, error }] = await Promise.all([Ipon.client.rpc('get_savings_summary'), Ipon.client.from('savings_goals').select('*').order('created_at', { ascending: false })]);
    if (summaryError) throw summaryError; if (error) throw error; tracked = Number(summary?.tracked_savings || 0); goals = data; render();
  }
  function resetForm() { form.reset(); form.elements.goal_id.value = ''; form.elements.status.value = 'ACTIVE'; document.getElementById('goal-form-title').textContent = 'Add goal'; document.getElementById('cancel-goal-edit').hidden = true; }
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); const values = new FormData(form); Ipon.setBusy(button, true);
    try { await Ipon.rpc('save_savings_goal', { p_goal_id: values.get('goal_id') || null, p_title: values.get('title'), p_target_amount: Number(values.get('target_amount')), p_target_date: values.get('target_date') || null, p_status: values.get('status'), p_notes: values.get('notes') || null }); Ipon.toast('Savings goal saved.'); resetForm(); await load(); }
    catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  list.addEventListener('click', (event) => { const button = event.target.closest('[data-edit-goal]'); if (!button) return; const goal = goals.find((item) => item.id === button.dataset.editGoal); if (!goal) return; form.elements.goal_id.value = goal.id; form.elements.title.value = goal.title; form.elements.target_amount.value = goal.target_amount; form.elements.target_date.value = goal.target_date || ''; form.elements.status.value = goal.status; form.elements.notes.value = goal.notes || ''; document.getElementById('goal-form-title').textContent = 'Edit goal'; document.getElementById('cancel-goal-edit').hidden = false; form.scrollIntoView({ behavior: 'smooth' }); });
  document.getElementById('cancel-goal-edit')?.addEventListener('click', resetForm);
  try { await load(); } catch (error) { Ipon.showInlineError(list, error, load); }
})();
