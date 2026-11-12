(async function () {
  'use strict';
  const visualFixture = new URLSearchParams(location.search).get('visual') === 'approved'
    && ['localhost', '127.0.0.1'].includes(location.hostname);
  let cursor = new Date(); cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let state;
  let currentActivities = [];
  let pendingItemsById = new Map();
  let activeDate = null;
  let hasSnapshot = false;
  const dataStatus = document.getElementById('dashboard-data-status');
  const detailPanel = document.getElementById('day-detail-panel');
  const dayModal = document.getElementById('day-contributors-dialog');
  const dayModalTitle = document.getElementById('day-modal-title');
  const dayModalSubtitle = document.getElementById('day-modal-subtitle');
  const dayModalBody = document.getElementById('day-modal-body');
  const calendarCard = document.querySelector('.calendar-card');
  const jumpDialog = document.getElementById('calendar-jump-dialog');
  const jumpMonth = document.getElementById('calendar-jump-month');
  const jumpYear = document.getElementById('calendar-jump-year');
  const weeks = [...document.querySelectorAll('.calendar-week')];
  const summaryValues = [...document.querySelectorAll('.summary-breakdown dd')];
  const goalSelects = [document.getElementById('calendar-goal-select'), document.getElementById('mobile-calendar-goal-select')];
  const addAnnouncementButton = document.getElementById('dashboard-add-announcement');
  const announcements = Ipon.bindAnnouncements({
    listElement: document.getElementById('dashboard-announcement-list'),
    addButton: addAnnouncementButton
  });
  let selectedGoalId = '';
  const heroMoney = (value) => Ipon.money(value);
  document.getElementById('dashboard-signout').addEventListener('click', Ipon.signOut);

  function monthIso(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`; }
  function renderGoalOptions(goals) {
    const options = [{ id:'', title:'General savings' }, ...goals.map((goal) => ({ id:goal.id, title:goal.title?.trim() || 'Untitled goal' }))];
    if (!options.some((goal) => goal.id === selectedGoalId)) selectedGoalId = '';
    goalSelects.forEach((select) => {
      select.replaceChildren(...options.map((goal) => new Option(goal.title, goal.id)));
      select.value = selectedGoalId;
    });
  }
  function statusClass(activity) {
    if (activity.approval_status === 'PENDING') return ['pending-event', 'Pending'];
    if (activity.activity_type === 'DEDUCTION') return ['deduction-event', 'Deduction'];
    if (activity.activity_type === 'EXPENSE') return ['expense-event', 'Expense'];
    return ['addition', 'Addition'];
  }
  function eventIconMarkup(klass) {
    const meta = {
      'pending-event': ['pending', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'],
      'deduction-event': ['deduction', '<path d="M7 12h10"/>'],
      'expense-event': ['expense', '<path d="m6 6 12 12M18 6 6 18"/>'],
      addition: ['confirmed', '<path d="m7 12 3 3 7-7"/>']
    };
    const [iconClass, paths] = meta[klass] || meta.addition;
    return `<i class="status-icon ${iconClass}"><svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg></i>`;
  }
  function calendarCells(activities) {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const firstDay = new Date(year, month, 1).getDay(); const days = new Date(year, month + 1, 0).getDate();
    const count = Math.ceil((firstDay + days) / 7) * 7; const byDate = new Map();
    activities
      .filter((activity) => activity.approval_status === 'CONFIRMED' || activity.approval_status === 'PENDING')
      .forEach((activity) => {
        if (!byDate.has(activity.activity_date)) byDate.set(activity.activity_date, []);
        byDate.get(activity.activity_date).push(activity);
      });
    return Array.from({ length: count }, (_, index) => {
      const day = index - firstDay + 1; if (day < 1 || day > days) return { empty: true };
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`; return { day, date, activities: byDate.get(date) || [] };
    });
  }
  function aggregateDayContributors(activities) {
    const byContributor = new Map();
    activities.filter((activity) => activity.activity_type === 'ADDITION').forEach((activity) => {
      const name = activity.subject_name || 'Group member';
      const key = activity.subject_member_id || name;
      if (!byContributor.has(key)) {
        byContributor.set(key, {
          key,
          name,
          avatarUrl: activity.subject_avatar_url || '',
          totalAmount: 0,
          count: 0,
          statuses: new Set(),
          notes: [],
          reviewNotes: []
        });
      }
      const entry = byContributor.get(key);
      if (!entry.avatarUrl && activity.subject_avatar_url) entry.avatarUrl = activity.subject_avatar_url;
      entry.totalAmount += Number(activity.amount || 0);
      entry.count += 1;
      if (activity.approval_status) entry.statuses.add(activity.approval_status);
      if (activity.notes) entry.notes.push(activity.notes);
      if (activity.review_note) entry.reviewNotes.push(activity.review_note);
    });
    return [...byContributor.values()].sort((a, b) => b.totalAmount - a.totalAmount);
  }
  function renderCalendar(activities) {
    currentActivities = activities.filter((activity) => activity.approval_status === 'CONFIRMED' || activity.approval_status === 'PENDING');
    activeDate = null;
    if (detailPanel) detailPanel.hidden = true;
    const monthName = new Intl.DateTimeFormat('en-PH', { month: 'long', year: 'numeric' }).format(cursor);
    document.getElementById('calendar-month').textContent = monthName;
    document.getElementById('mobile-calendar-month').textContent = monthName;
    const cells = calendarCells(activities); const today = new Date(); let allWeeks = [...weeks];
    let extra = document.querySelector('.dynamic-week-6');
    if (cells.length === 42 && !extra) { extra = document.createElement('div'); extra.className = 'calendar-week dynamic-week-6'; document.getElementById('day-detail-panel').before(extra); }
    if (extra) extra.hidden = cells.length !== 42; if (cells.length === 42) allWeeks.push(extra);
    allWeeks.forEach((week, weekIndex) => {
      const row = cells.slice(weekIndex * 7, weekIndex * 7 + 7);
      week.innerHTML = row.map((cell, column) => {
        if (!cell || cell.empty) return '<span class="day is-empty"></span>';
        const activity = cell.activities[0];
        const contributors = aggregateDayContributors(cell.activities);
        let avatarsHtml = '';
        if (contributors.length) {
          const shown = contributors.slice(0, 4).map((person) => Ipon.avatarMarkup(person.avatarUrl, person.name, 'day-avatar')).join('');
          const overflow = contributors.length > 4 ? `<span class="day-avatar day-avatar-more" title="${contributors.length - 4} more contributor${contributors.length - 4 === 1 ? '' : 's'}">&bull;&bull;&bull;</span>` : '';
          avatarsHtml = `<span class="day-avatars" aria-hidden="true">${shown}${overflow}</span>`;
        }
        let activityHtml = '';
        if (activity) {
          const [klass, label] = statusClass(activity);
          const dayAmount = contributors.length ? contributors.reduce((sum, person) => sum + person.totalAmount, 0) : Number(activity.amount);
          const moreCount = !contributors.length && cell.activities.length > 1 ? `<small class="more-count">+${cell.activities.length - 1}</small>` : '';
          activityHtml = `<span class="event ${klass}" title="${Ipon.escapeHtml(label)}" aria-label="${Ipon.escapeHtml(label)}">${eventIconMarkup(klass)}</span><em>${Ipon.money(dayAmount)}</em>${avatarsHtml}${moreCount}`;
        }
        const activityLabel = cell.activities.length ? `, ${cell.activities.length} recorded ${cell.activities.length === 1 ? 'activity' : 'activities'}` : ', no recorded activity';
        const isToday = cell.day === today.getDate() && cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();
        return `<button class="day ${column === 0 ? 'sunday' : ''}${isToday ? ' is-today' : ''}${contributors.length ? ' has-avatars' : ''}" type="button" data-date="${cell.date}"${isToday ? ' aria-current="date"' : ''} aria-label="${monthName} ${cell.day}${isToday ? ', today' : ''}${activityLabel}"><b>${cell.day}</b>${activityHtml}</button>`;
      }).join('');
    });
    Ipon.bindAvatarFallbacks(calendarCard);
  }
  function renderPending(items, count = items.length, total = items.reduce((sum, item) => sum + Number(item.amount), 0)) {
    pendingItemsById = new Map((items || []).filter((item) => item?.id).map((item) => [item.id, item]));
    const buttons = [...document.querySelectorAll('.review-item')];
    buttons.forEach((button, index) => {
      const item = items[index];
      button.hidden = !item && (items.length > 0 || index > 0);
      button.classList.toggle('is-empty-review', !item);
      if (!item) {
        button.disabled = true; button.removeAttribute('data-id'); button.removeAttribute('data-type');
        button.querySelector('b').textContent = 'No pending entries'; button.querySelector('small').textContent = 'All caught up'; button.querySelector('strong').textContent = '';
        return;
      }
      button.dataset.id = item.id; button.dataset.type = item.type; button.disabled = state.profile?.role !== 'ADMIN';
      button.querySelector('b').textContent = Ipon.dateLabel(item.date);
      button.querySelector('small').textContent = item.type === 'contribution' ? 'Addition' : item.type === 'withdrawal' ? 'Deduction' : 'Expense';
      button.querySelector('strong').textContent = Ipon.money(item.amount);
    });
    const summary = document.querySelector('.review-summary'); summary.querySelector('em').textContent = `${count} item${count === 1 ? '' : 's'} for review`; summary.querySelector('strong').textContent = Ipon.money(total);
  }
  async function getPending() {
    const { data, error } = await Ipon.client.rpc('get_pending_review_summary');
    if (error) throw error;
    return data || { count: 0, amount: 0, items: [] };
  }
  function renderEmptySnapshot() {
    const total = document.querySelector('.tracked-total');
    total.textContent = heroMoney(0);
    total.classList.add('is-zero');
    summaryValues.forEach((node) => { node.textContent = Ipon.money(0); });
    ['dashboard-members', 'dashboard-paid', 'dashboard-unpaid'].forEach((id) => { document.getElementById(id).textContent = '0'; });
    document.getElementById('dashboard-month-collected').textContent = Ipon.money(0);
    renderGoalOptions([]);
    renderCalendar([]);
    renderPending([]);
    announcements?.clear();
  }
  async function load() {
    const start = monthIso(cursor), end = monthIso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    if (!state.configured || !state.profile) { renderEmptySnapshot(); return; }
    try {
      const [summaryResult, calendarResult, pending, memberResult, progressResult, goalResult] = await Promise.all([Ipon.client.rpc('get_savings_summary'), Ipon.client.from('v_savings_calendar').select('*').in('approval_status', ['CONFIRMED', 'PENDING']).gte('activity_date', start).lt('activity_date', end).order('activity_date'), getPending(), Ipon.client.from('members').select('id', { count: 'exact', head: true }).eq('status', 'ACTIVE'), Ipon.client.from('v_contribution_status').select('payment_status,paid_amount').eq('period_month', start), Ipon.client.from('savings_goals').select('id,title').eq('status', 'ACTIVE').order('created_at', { ascending: false }), announcements ? announcements.load() : Promise.resolve()]);
      if (summaryResult.error) throw summaryResult.error; if (calendarResult.error) throw calendarResult.error; if (memberResult.error) throw memberResult.error; if (progressResult.error) throw progressResult.error; if (goalResult.error) throw goalResult.error;
      const summary = summaryResult.data || {}; const total = document.querySelector('.tracked-total'); total.textContent = heroMoney(summary.tracked_savings); total.classList.toggle('is-zero', Number(summary.tracked_savings || 0) === 0);
      [summary.total_additions, summary.total_deductions, summary.total_expenses, pending.amount].forEach((value,index) => { summaryValues[index].textContent = Ipon.money(value); });
      const progress = progressResult.data || []; const paid = progress.filter((item) => ['PAID', 'OVERPAID'].includes(item.payment_status)).length; const unpaid = progress.filter((item) => ['UNPAID', 'PARTIALLY PAID'].includes(item.payment_status)).length;
      document.getElementById('dashboard-members').textContent = memberResult.count || 0; document.getElementById('dashboard-month-collected').textContent = Ipon.money(progress.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0)); document.getElementById('dashboard-paid').textContent = paid; document.getElementById('dashboard-unpaid').textContent = unpaid; renderGoalOptions(goalResult.data || []);
      renderCalendar(calendarResult.data || []); renderPending(pending.items || [], Number(pending.count || 0), Number(pending.amount || 0));
      hasSnapshot = true; dataStatus.hidden = true;
    } catch (error) {
      if (!hasSnapshot) renderEmptySnapshot();
      dataStatus.textContent = hasSnapshot ? 'Refresh failed. The previous complete snapshot remains visible and may be outdated.' : 'Dashboard data is unavailable. No financial snapshot could be loaded.';
      dataStatus.hidden = false;
      Ipon.toast(Ipon.friendlyError(error), 'error');
    }
  }
  async function navigateTo(date) {
    cursor = new Date(date.getFullYear(), date.getMonth(), 1);
    calendarCard.setAttribute('aria-busy', 'true');
    try { await load(); } finally { calendarCard.removeAttribute('aria-busy'); }
  }
  function openJumpDialog() {
    jumpMonth.value = String(cursor.getMonth());
    jumpYear.value = String(cursor.getFullYear());
    jumpDialog.showModal();
    jumpMonth.focus();
  }
  async function loadVisualFixture() {
    const response = await fetch('tests/fixtures/dashboard.json');
    if (!response.ok) throw new Error('Dashboard visual fixture could not be loaded.');
    const fixture = await response.json();
    cursor = new Date(`${fixture.month}T00:00:00`);
    state = { profile: { role: 'ADMIN' } };
    const label = document.createElement('span');
    label.className = 'visual-fixture-label';
    label.textContent = 'Synthetic sample amounts';
    document.querySelector('.summary-hero').append(label);
    const total = document.querySelector('.tracked-total');
    total.textContent = heroMoney(fixture.summary.tracked_savings);
    [fixture.summary.total_additions, fixture.summary.total_deductions, fixture.summary.total_expenses, fixture.pending.reduce((sum, item) => sum + Number(item.amount), 0)].forEach((value, index) => { summaryValues[index].textContent = Ipon.money(value); });
    renderCalendar(fixture.activities);
    renderPending(fixture.pending.slice(0, 3));
  }
  if (visualFixture) { try { await loadVisualFixture(); } finally { Ipon.setLoading(false); } return; }
  document.querySelector('[data-region="month-previous"]').addEventListener('click', () => navigateTo(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)));
  document.querySelector('[data-region="month-next"]').addEventListener('click', () => navigateTo(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)));
  document.querySelector('[data-mobile-month="previous"]').addEventListener('click', () => navigateTo(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)));
  document.querySelector('[data-mobile-month="next"]').addEventListener('click', () => navigateTo(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)));
  document.querySelectorAll('[data-calendar-jump]').forEach((button) => button.addEventListener('click', openJumpDialog));
  document.querySelector('.calendar-jump-close').addEventListener('click', () => jumpDialog.close());
  document.getElementById('calendar-jump-today').addEventListener('click', async () => { jumpDialog.close(); await navigateTo(new Date()); });
  document.getElementById('calendar-jump-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    jumpDialog.close();
    await navigateTo(new Date(Number(jumpYear.value), Number(jumpMonth.value), 1));
  });
  document.querySelectorAll('.review-item').forEach((button) => button.addEventListener('click', async () => {
    if (state.profile?.role !== 'ADMIN' || !button.dataset.id) return;
    const item = pendingItemsById.get(button.dataset.id);
    const prefix = button.dataset.type;
    const typeLabel = prefix === 'contribution' ? 'Savings Addition' : prefix === 'withdrawal' ? 'Deduction' : 'Expense';
    const entry = item ? {
      type: item.type,
      typeLabel: item.entry_label || typeLabel,
      authorName: item.member_name || 'Group member',
      submittedByName: item.submitted_by_name || '',
      avatarUrl: item.avatar_url || '',
      amount: item.amount,
      date: item.date,
      periodMonth: item.period_month || '',
      category: item.category || '',
      reference: item.reference || '',
      notes: item.notes || '',
      description: item.description || '',
      status: 'PENDING'
    } : {
      type: prefix,
      typeLabel,
      authorName: 'Group member',
      amount: null,
      date: '',
      status: 'PENDING'
    };
    const review = await Ipon.requestRecordAction({
      title: 'Review pending entry',
      actions: ['CONFIRM', 'REJECT'],
      entry,
      onSubmit: async ({ decision, note }) => {
        const functionName = `review_${prefix}`;
        const idKey = `p_${prefix}_id`;
        await Ipon.rpc(functionName, {
          [idKey]: button.dataset.id,
          p_decision: decision === 'CONFIRM' ? 'CONFIRMED' : 'REJECTED',
          p_review_note: note
        });
        Ipon.toast(`${typeLabel} ${decision === 'CONFIRM' ? 'confirmed' : 'rejected'}.`);
        await load();
      }
    });
    if (!review) return;
  }));
  function showDayTooltip(day, clientX, clientY) {
    const date = day.dataset.date;
    if (!date) return;
    if (activeDate !== date) {
      activeDate = date;
      const items = currentActivities.filter((activity) => activity.activity_date === date);
      document.getElementById('day-detail-title').textContent = Ipon.dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      document.getElementById('day-detail-list').innerHTML = items.length
        ? items.map((activity) => { const [, label] = statusClass(activity); const detailText = [activity.notes, activity.review_note ? `Review note: ${activity.review_note}` : ''].filter(Boolean).join(' · '); return `<article><span><b>${Ipon.escapeHtml(label)}</b><small>${Ipon.escapeHtml([activity.subject_name, activity.approval_status].filter(Boolean).join(' · '))}</small></span><strong>${Ipon.money(activity.amount)}</strong>${detailText ? `<p>${Ipon.escapeHtml(detailText)}</p>` : ''}</article>`; }).join('')
        : '<p class="empty-state">No recorded activity for this day.</p>';
    }
    detailPanel.hidden = false;
    const rect = detailPanel.getBoundingClientRect();
    const offset = 14;
    let x = clientX + offset;
    let y = clientY + offset;
    if (x + rect.width > window.innerWidth - 12) x = clientX - rect.width - offset;
    if (y + rect.height > window.innerHeight - 12) y = clientY - rect.height - offset;
    detailPanel.style.left = `${Math.max(12, x)}px`;
    detailPanel.style.top = `${Math.max(12, y)}px`;
  }

  function openDayModal(date) {
    if (!dayModal) return;
    detailPanel.hidden = true;
    activeDate = null;
    const items = currentActivities.filter((activity) => activity.activity_date === date);
    const contributors = aggregateDayContributors(items);
    const others = items.filter((activity) => activity.activity_type !== 'ADDITION');
    const contributionTotal = contributors.reduce((sum, person) => sum + person.totalAmount, 0);
    dayModalTitle.textContent = Ipon.dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    dayModalSubtitle.textContent = contributors.length
      ? `${contributors.length} contributor${contributors.length === 1 ? '' : 's'} · ${Ipon.money(contributionTotal)} total contributions`
      : items.length
        ? `${items.length} recorded entr${items.length === 1 ? 'y' : 'ies'}`
        : 'No recorded contributions on this day.';
    const contributorsHtml = contributors.length ? `
      <section class="day-modal-section">
        <h3>Contributors (${contributors.length})</h3>
        <div class="day-contributor-list">
          ${contributors.map((person) => {
            const statuses = [...person.statuses].map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(', ');
            const notes = person.notes.length ? `<p class="day-contributor-notes">${Ipon.escapeHtml(person.notes.join(' · '))}</p>` : '';
            const reviewNotes = person.reviewNotes.length ? `<small class="record-reason-note is-confirmed">Review note: ${Ipon.escapeHtml(person.reviewNotes.join(' · '))}</small>` : '';
            return `<article class="day-contributor-row">
              ${Ipon.avatarMarkup(person.avatarUrl, person.name, 'avatar-md')}
              <div class="day-contributor-info">
                <strong>${Ipon.escapeHtml(person.name)}</strong>
                <small>${person.count} contribution${person.count === 1 ? '' : 's'} · ${Ipon.escapeHtml(statuses)}</small>
                ${notes}
                ${reviewNotes}
              </div>
              <strong class="day-contributor-amount">+${Ipon.money(person.totalAmount)}</strong>
            </article>`;
          }).join('')}
        </div>
      </section>` : '';
    const othersHtml = others.length ? `
      <section class="day-modal-section">
        <h3>Other activity (${others.length})</h3>
        <div class="day-contributor-list">
          ${others.map((activity) => {
            const [, label] = statusClass(activity);
            return `<article class="day-contributor-row">
              ${Ipon.avatarMarkup('', activity.subject_name || label, 'avatar-md')}
              <div class="day-contributor-info">
                <strong>${Ipon.escapeHtml(activity.subject_name || label)}</strong>
                <small>${Ipon.escapeHtml([label, activity.approval_status].filter(Boolean).join(' · '))}</small>
                ${activity.notes ? `<p class="day-contributor-notes">${Ipon.escapeHtml(activity.notes)}</p>` : ''}
                ${activity.review_note ? `<small class="record-reason-note is-confirmed">Review note: ${Ipon.escapeHtml(activity.review_note)}</small>` : ''}
              </div>
              <strong class="day-contributor-amount is-deduction">−${Ipon.money(activity.amount)}</strong>
            </article>`;
          }).join('')}
        </div>
      </section>` : '';
    dayModalBody.innerHTML = items.length
      ? `${contributorsHtml}${othersHtml}`
      : '<div class="day-modal-empty"><p>No contributions or activity recorded for this day.</p><a class="button button-primary" href="contributions.html">+ Record entry</a></div>';
    Ipon.bindAvatarFallbacks(dayModalBody);
    dayModal.showModal();
  }

  const board = document.querySelector('.calendar-board') || document.querySelector('.comp-frame');
  board.addEventListener('pointermove', (event) => {
    if (dayModal?.open) return;
    const day = event.target.closest('.day[data-date]');
    if (!day) {
      detailPanel.hidden = true;
      activeDate = null;
      return;
    }
    showDayTooltip(day, event.clientX, event.clientY);
  });
  board.addEventListener('pointerleave', () => {
    detailPanel.hidden = true;
    activeDate = null;
  });
  board.addEventListener('focusin', (event) => {
    const day = event.target.closest('.day[data-date]');
    if (!day) return;
    const box = day.getBoundingClientRect();
    showDayTooltip(day, box.left + box.width / 2, box.top + box.height / 2);
  });
  board.addEventListener('focusout', (event) => {
    if (!board.contains(event.relatedTarget)) {
      detailPanel.hidden = true;
      activeDate = null;
    }
  });
  board.addEventListener('click', (event) => {
    const day = event.target.closest('.day[data-date]');
    if (!day) return;
    openDayModal(day.dataset.date);
  });
  document.getElementById('day-modal-close')?.addEventListener('click', () => dayModal?.close());
  dayModal?.addEventListener('click', (event) => { if (event.target === dayModal) dayModal.close(); });
  document.getElementById('day-detail-close')?.addEventListener('click', () => {
    detailPanel.hidden = true;
    activeDate = null;
  });
  window.addEventListener('ipon:profile-updated', load);
  goalSelects.forEach((select) => select.addEventListener('change', () => {
    selectedGoalId = select.value;
    goalSelects.forEach((other) => { other.value = selectedGoalId; });
  }));
  renderCalendar([]);
  state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || state.redirecting) return;
  if (state.profile?.role !== 'ADMIN') document.querySelectorAll('a[href="members.html"],a[href="settings.html"],a[href="audit.html"]').forEach((link) => link.remove());
  if (state.profile?.role !== 'MEMBER') document.querySelectorAll('a[href="user.html"]').forEach((link) => link.remove());
  if (addAnnouncementButton) addAnnouncementButton.hidden = state.profile?.role !== 'ADMIN';
  try { await load(); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('dashboard', ['members', 'profiles', 'contribution_periods', 'contributions', 'withdrawals', 'expenses', 'savings_goals', 'announcements'], load);
})();
