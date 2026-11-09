(async function () {
  'use strict';
  const visualFixture = new URLSearchParams(location.search).get('visual') === 'approved'
    && ['localhost', '127.0.0.1'].includes(location.hostname);
  if (visualFixture) {
    document.querySelector('.visual-fixture-label').hidden = false;
    return;
  }
  let cursor = new Date(); cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let state;
  let currentActivities = [];
  const weeks = [...document.querySelectorAll('.calendar-week')];
  const summaryValues = [...document.querySelectorAll('.summary-breakdown dd')];
  const heroMoney = (value) => Number(value || 0) === 0 ? '₱00,000.00' : Ipon.money(value);
  document.getElementById('dashboard-signout').addEventListener('click', async () => { if (Ipon.client) await Ipon.client.auth.signOut(); location.replace('login.html'); });

  function monthIso(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`; }
  function statusClass(activity) {
    if (activity.approval_status === 'PENDING') return ['pending-event', 'Pending'];
    if (activity.activity_type === 'DEDUCTION') return ['deduction-event', 'Bawas'];
    if (activity.activity_type === 'EXPENSE') return ['expense-event', 'Expense'];
    return ['addition', 'Dagdag'];
  }
  function calendarCells(activities) {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); const days = new Date(year, month + 1, 0).getDate();
    const count = Math.ceil((firstDay + days) / 7) * 7; const byDate = new Map();
    activities.forEach((activity) => { if (!byDate.has(activity.activity_date)) byDate.set(activity.activity_date, []); byDate.get(activity.activity_date).push(activity); });
    return Array.from({ length: count }, (_, index) => {
      const day = index - firstDay + 1; if (day < 1 || day > days) return { empty: true };
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return { day, date, activities: byDate.get(date) || [] };
    });
  }
  function renderCalendar(activities) {
    currentActivities = activities;
    const monthName = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(cursor);
    document.getElementById('calendar-month').textContent = monthName;
    document.getElementById('mobile-calendar-month').textContent = monthName;
    const cells = calendarCells(activities); let allWeeks = [...weeks];
    let extra = document.querySelector('.dynamic-week-6');
    if (cells.length === 42 && !extra) { extra = document.createElement('div'); extra.className = 'calendar-week dynamic-week-6'; document.querySelector('.calendar-legend').before(extra); }
    if (extra) extra.hidden = cells.length !== 42; if (cells.length === 42) allWeeks.push(extra);
    allWeeks.forEach((week, weekIndex) => {
      if (cells.length === 42) { week.style.top = `${40 + weekIndex * (50 / 6)}%`; week.style.height = `${50 / 6}%`; week.style.left = '13.5%'; week.style.width = '64.1%'; week.style.position = 'absolute'; }
      else if (!week.classList.contains('dynamic-week-6')) { week.style.top = ''; week.style.height = ''; }
      const row = cells.slice(weekIndex * 7, weekIndex * 7 + 7);
      week.innerHTML = row.map((cell, column) => {
        if (!cell || cell.empty) return '<span class="day is-empty"></span>';
        const activity = cell.activities[0]; let activityHtml = '';
        if (activity) { const [klass, label] = statusClass(activity); activityHtml = `<span class="event ${klass}">${label}</span><em>${Ipon.money(activity.amount)}</em>${cell.activities.length > 1 ? `<small class="more-count">+${cell.activities.length - 1}</small>` : ''}`; }
        return `<button class="day ${column === 0 ? 'sunday' : ''}" type="button" data-date="${cell.date}"><b>${cell.day}</b>${activityHtml}</button>`;
      }).join('');
    });
  }
  function renderPending(items) {
    const buttons = [...document.querySelectorAll('.review-item')];
    buttons.forEach((button, index) => {
      const item = items[index];
      button.hidden = false;
      button.classList.toggle('is-empty-review', !item);
      if (!item) {
        button.disabled = true; button.removeAttribute('data-id'); button.removeAttribute('data-type');
        button.querySelector('b').textContent = 'No pending entry'; button.querySelector('small').textContent = 'All caught up'; button.querySelector('strong').textContent = '—';
        return;
      }
      button.dataset.id = item.id; button.dataset.type = item.type; button.disabled = state.profile?.role !== 'ADMIN';
      button.querySelector('b').textContent = Ipon.dateLabel(item.date);
      button.querySelector('small').textContent = item.type === 'contribution' ? 'Dagdag' : item.type === 'withdrawal' ? 'Bawas' : 'Expense';
      button.querySelector('strong').textContent = Ipon.money(item.amount);
    });
    const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
    const summary = document.querySelector('.review-summary'); summary.querySelector('em').textContent = `${items.length} item${items.length === 1 ? '' : 's'} for review`; summary.querySelector('strong').textContent = Ipon.money(total);
  }
  async function getPending() {
    if (state.profile.role === 'MEMBER') return [];
    const [contributions, withdrawals, expenses] = await Promise.all([
      Ipon.client.from('contributions').select('id,amount,payment_date,created_at').eq('approval_status','PENDING'),
      Ipon.client.from('withdrawals').select('id,amount,transaction_date,created_at').eq('approval_status','PENDING'),
      Ipon.client.from('expenses').select('id,amount,transaction_date,created_at').eq('approval_status','PENDING')
    ]);
    for (const result of [contributions, withdrawals, expenses]) if (result.error) throw result.error;
    return [
      ...contributions.data.map((item) => ({ ...item, type:'contribution', date:item.payment_date })),
      ...withdrawals.data.map((item) => ({ ...item, type:'withdrawal', date:item.transaction_date })),
      ...expenses.data.map((item) => ({ ...item, type:'expense', date:item.transaction_date }))
    ].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  }
  async function load() {
    const start = monthIso(cursor), end = monthIso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    if (!state.configured || !state.profile) { const total = document.querySelector('.tracked-total'); total.textContent = heroMoney(0); total.classList.add('is-zero'); summaryValues.forEach((node) => { node.textContent = Ipon.money(0); }); renderCalendar([]); renderPending([]); return; }
    try {
      const [summaryResult, calendarResult, pending] = await Promise.all([Ipon.client.rpc('get_savings_summary'), Ipon.client.from('v_savings_calendar').select('*').gte('activity_date', start).lt('activity_date', end).order('activity_date'), getPending()]);
      if (summaryResult.error) throw summaryResult.error; if (calendarResult.error) throw calendarResult.error;
      const summary = summaryResult.data || {}; const total = document.querySelector('.tracked-total'); total.textContent = heroMoney(summary.tracked_savings); total.classList.toggle('is-zero', Number(summary.tracked_savings || 0) === 0);
      [summary.total_additions, summary.total_deductions, summary.total_expenses, pending.reduce((sum,item)=>sum+Number(item.amount),0)].forEach((value,index) => { summaryValues[index].textContent = Ipon.money(value); });
      renderCalendar(calendarResult.data || []); renderPending(pending.slice(0,3));
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); renderCalendar([]); renderPending([]); }
  }
  document.querySelector('[data-region="month-previous"]').addEventListener('click', async () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); await load(); });
  document.querySelector('[data-region="month-next"]').addEventListener('click', async () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); await load(); });
  document.querySelector('[data-mobile-month="previous"]').addEventListener('click', async () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); await load(); });
  document.querySelector('[data-mobile-month="next"]').addEventListener('click', async () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); await load(); });
  document.querySelectorAll('.review-item').forEach((button) => button.addEventListener('click', async () => {
    if (state.profile?.role !== 'ADMIN' || !button.dataset.id) return;
    const decision = window.prompt('Type CONFIRM or REJECT for this entry:')?.trim().toUpperCase(); if (!['CONFIRM','REJECT'].includes(decision)) return;
    const note = decision === 'REJECT' ? window.prompt('Rejection reason:')?.trim() : null; if (decision === 'REJECT' && !note) return;
    const accepted = await Ipon.confirmAction({ title: `${decision === 'CONFIRM' ? 'Confirm' : 'Reject'} entry?`, message: decision === 'CONFIRM' ? 'The amount will affect tracked savings.' : 'The rejection and reason will remain in the audit trail.', acceptLabel: decision === 'CONFIRM' ? 'Confirm' : 'Reject' }); if (!accepted) return;
    const prefix = button.dataset.type; const functionName = `review_${prefix}`; const idKey = `p_${prefix}_id`;
    try { await Ipon.rpc(functionName, { [idKey]:button.dataset.id, p_decision:decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED', p_review_note:note }); Ipon.toast(`Entry ${decision.toLowerCase()}ed.`); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
  }));
  document.querySelector('.comp-frame').addEventListener('click', (event) => {
    const day = event.target.closest('.day[data-date]');
    if (!day) return;
    const items = currentActivities.filter((activity) => activity.activity_date === day.dataset.date);
    document.getElementById('day-detail-title').textContent = Ipon.dateLabel(day.dataset.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    document.getElementById('day-detail-list').innerHTML = items.length
      ? items.map((activity) => { const [, label] = statusClass(activity); return `<article><span><b>${Ipon.escapeHtml(label)}</b><small>${Ipon.escapeHtml(activity.approval_status)}</small></span><strong>${Ipon.money(activity.amount)}</strong>${activity.notes ? `<p>${Ipon.escapeHtml(activity.notes)}</p>` : ''}</article>`; }).join('')
      : '<p class="empty-state">No recorded activity for this day.</p>';
    document.getElementById('day-detail-panel').hidden = false;
  });
  document.getElementById('day-detail-close').addEventListener('click', () => { document.getElementById('day-detail-panel').hidden = true; });
  state = await Ipon.init(); await load();
})();
