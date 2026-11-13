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
  const quickRecordDialog = document.getElementById('quick-record-dialog');
  const quickRecordForm = document.getElementById('quick-record-form');
  const quickRecordTypeTabs = document.getElementById('quick-record-type-tabs');
  const quickTabAddition = document.getElementById('quick-tab-addition');
  const quickTabDeduction = document.getElementById('quick-tab-deduction');
  const quickTabExpense = document.getElementById('quick-tab-expense');
  const quickTitle = document.getElementById('quick-record-title');
  const quickSubtitle = document.getElementById('quick-record-subtitle');
  const quickEntryTypeInput = document.getElementById('quick-entry-type');
  const quickFieldMember = document.getElementById('quick-field-member');
  const quickMemberSelect = document.getElementById('quick-member-id');
  const quickMemberAuto = document.getElementById('quick-member-auto');
  const quickMemberAutoName = document.getElementById('quick-member-auto-name');
  const quickFieldResponsible = document.getElementById('quick-field-responsible');
  const quickResponsibleSelect = document.getElementById('quick-responsible');
  const quickFieldMonth = document.getElementById('quick-field-month');
  const quickMonthInput = document.getElementById('quick-month');
  const quickFieldDate = document.getElementById('quick-field-date');
  const quickDateLabel = document.getElementById('quick-date-label');
  const quickDateInput = document.getElementById('quick-date');
  const quickFieldAmount = document.getElementById('quick-field-amount');
  const quickAmountInput = document.getElementById('quick-amount');
  const quickFieldCategory = document.getElementById('quick-field-category');
  const quickCategoryInput = document.getElementById('quick-category');
  const quickFieldReference = document.getElementById('quick-field-reference');
  const quickReferenceInput = document.getElementById('quick-reference');
  const quickFieldDescription = document.getElementById('quick-field-description');
  const quickDescLabel = document.getElementById('quick-desc-label');
  const quickDescriptionInput = document.getElementById('quick-description');
  const quickFieldNotes = document.getElementById('quick-field-notes');
  const quickNotesInput = document.getElementById('quick-notes');
  const quickSubmitBtn = document.getElementById('quick-record-submit');
  const dashboardRecordEntryBtn = document.getElementById('dashboard-record-entry');

  let cachedMembers = [];
  let currentQuickType = 'addition';
  let quickPendingKey = null;
  const announcements = Ipon.bindAnnouncements({
    listElement: document.getElementById('dashboard-announcement-list'),
    addButton: addAnnouncementButton
  });
  let selectedGoalId = '';
  let activeGoalsList = [];
  let lastTrackedSavings = 0;
  let myGroups = [];
  let currentGroup = null;
  let pendingGroupAvatarUrl = null;
  let pendingGroupClearAvatar = false;
  const heroMoney = (value) => Ipon.money(value);
  const groupAvatarEl = document.getElementById('dashboard-group-avatar');
  const groupNameEl = document.getElementById('dashboard-group-name');
  const groupRoleEl = document.getElementById('dashboard-group-role');
  const groupMetaEl = document.getElementById('dashboard-group-meta');
  const groupSelect = document.getElementById('dashboard-group-select');
  const groupSwitcherWrap = document.getElementById('dashboard-group-switcher-wrap');
  const groupActionsEl = document.getElementById('dashboard-group-actions');
  const groupHubDialog = document.getElementById('group-manage-hub-dialog');
  const groupHubAvatar = document.getElementById('group-hub-avatar');
  const groupHubTitle = document.getElementById('group-hub-title');
  const groupHubRole = document.getElementById('group-hub-role');
  const groupHubMeta = document.getElementById('group-hub-meta');
  const groupHubSwitcherWrap = document.getElementById('group-hub-switcher-wrap');
  const groupHubSelect = document.getElementById('group-hub-select');
  const groupHubSelfToggle = document.getElementById('manage-hub-self-toggle');
  const groupHubContributorDetails = document.getElementById('group-hub-contributor-details');
  const groupHubPledgeVal = document.getElementById('group-hub-pledge-val');
  const groupHubEditPledge = document.getElementById('group-hub-edit-pledge');
  const adminContributorDialog = document.getElementById('admin-contributor-dialog');
  const adminContributorForm = document.getElementById('admin-contributor-form');
  const adminContributorAmount = document.getElementById('admin-contributor-amount');
  let currentAdminMonthlyAmount = 100;
  const groupDialog = document.getElementById('group-form-dialog');
  const groupForm = document.getElementById('group-form');
  const groupDpPreview = document.getElementById('group-dp-preview');
  const groupDpInput = document.getElementById('group-dp-input');
  const groupDpRemove = document.getElementById('group-dp-remove');
  const groupSelfToggle = document.getElementById('group-self-contributor');
  const groupMonthlyWrap = document.getElementById('group-monthly-wrap');
  const groupMonthlyInput = document.getElementById('group-default-amount');
  const groupInviteSection = document.getElementById('group-invite-section');
  const groupInviteRows = document.getElementById('group-invite-rows');
  const inviteDialog = document.getElementById('group-invite-dialog');
  const inviteForm = document.getElementById('group-invite-form');
  const inviteOnlyRows = document.getElementById('invite-only-rows');
  document.getElementById('dashboard-signout').addEventListener('click', Ipon.signOut);

  function syncGroupHub() {
    if (!currentGroup) return;
    const safeName = currentGroup.name || 'Savings Group';
    if (groupHubAvatar) {
      groupHubAvatar.innerHTML = Ipon.avatarMarkup(currentGroup.avatar_url, safeName, 'avatar-lg');
      Ipon.bindAvatarFallbacks(groupHubAvatar);
    }
    if (groupHubTitle) groupHubTitle.textContent = safeName;
    if (groupHubRole) groupHubRole.textContent = currentGroup.role || state?.profile?.role || 'ADMIN';
    const contributorCount = Number(currentGroup.active_member_count || 0);
    if (groupHubMeta) {
      groupHubMeta.textContent = `${contributorCount} active contributor${contributorCount === 1 ? '' : 's'} · ${currentGroup.is_contributor ? 'You are participating' : 'Manager view only'}`;
    }
    if (groupHubSwitcherWrap && groupHubSelect) {
      groupHubSwitcherWrap.hidden = myGroups.length <= 1;
      groupHubSelect.replaceChildren(...myGroups.map((group) => new Option(`${group.name} (${group.role})`, group.group_id)));
      groupHubSelect.value = currentGroup.group_id;
    }
    if (groupHubSelfToggle) {
      const isContributor = Boolean(currentGroup.is_contributor);
      groupHubSelfToggle.checked = isContributor;
      if (groupHubContributorDetails) {
        groupHubContributorDetails.hidden = !isContributor;
        if (groupHubPledgeVal) groupHubPledgeVal.textContent = Ipon.money(currentAdminMonthlyAmount || 100);
      }
    }
  }

  function renderGroupHeader(groups) {
    myGroups = Array.isArray(groups) ? groups : [];
    currentGroup = myGroups.find((group) => group.is_current) || myGroups[0] || null;
    const noGroupCard = document.getElementById('dashboard-no-group-card');
    if (noGroupCard) noGroupCard.hidden = Boolean(currentGroup);
    const manageBtn = document.getElementById('dashboard-manage-group');
    if (manageBtn) manageBtn.hidden = !(currentGroup && currentGroup.role === 'ADMIN');
    if (!currentGroup) {
      if (groupNameEl) groupNameEl.textContent = 'No group selected';
      if (groupRoleEl) groupRoleEl.textContent = state?.profile?.role || '—';
      if (groupMetaEl) groupMetaEl.textContent = 'Create or join a savings group';
      if (groupSwitcherWrap) groupSwitcherWrap.hidden = true;
      return;
    }
    const safeName = currentGroup.name || 'Savings Group';
    if (groupAvatarEl) {
      groupAvatarEl.innerHTML = Ipon.avatarMarkup(currentGroup.avatar_url, safeName, 'avatar-md');
      Ipon.bindAvatarFallbacks(groupAvatarEl);
    }
    if (groupNameEl) groupNameEl.textContent = safeName;
    if (groupRoleEl) groupRoleEl.textContent = currentGroup.role || state?.profile?.role || 'MEMBER';
    const contributorCount = Number(currentGroup.active_member_count || 0);
    const metaParts = [`${contributorCount} contributor${contributorCount === 1 ? '' : 's'}`];
    if (currentGroup.role === 'ADMIN') metaParts.push(currentGroup.is_contributor ? 'Included as contributor' : 'Manager only');
    if (groupMetaEl) groupMetaEl.textContent = metaParts.join(' · ');
    if (groupSelect && groupSwitcherWrap) {
      groupSwitcherWrap.hidden = myGroups.length <= 1;
      groupSelect.replaceChildren(...myGroups.map((group) => new Option(`${group.name} (${group.role})`, group.group_id)));
      groupSelect.value = currentGroup.group_id;
    }
    if (groupActionsEl) groupActionsEl.hidden = state?.profile?.role !== 'ADMIN';
    syncGroupHub();
  }

  function renderGroupDpPreview(avatarUrl, name) {
    if (!groupDpPreview) return;
    groupDpPreview.innerHTML = Ipon.avatarMarkup(avatarUrl, name || 'Group', 'avatar-lg');
    Ipon.bindAvatarFallbacks(groupDpPreview);
    if (groupDpRemove) groupDpRemove.hidden = !avatarUrl;
  }

  function syncInviteRemoveButtons(container, required) {
    if (!container) return;
    const rows = [...container.querySelectorAll('.invite-row-card')];
    const hideOnlyRow = required && rows.length <= 1;
    rows.forEach((item) => {
      const btn = item.querySelector('.invite-row-remove');
      if (btn) btn.hidden = hideOnlyRow;
    });
  }

  function appendInviteRow(container, { defaultAmount = 100, required = false } = {}) {
    if (!container) return null;
    const row = document.createElement('div');
    row.className = 'invite-row-card';
    row.innerHTML = `
      <div class="invite-row-head">
        <span class="invite-row-badge">Member invite</span>
        <button class="invite-row-remove" type="button" title="Remove member" aria-label="Remove invite row">&times;</button>
      </div>
      <div class="invite-row-grid">
        <div class="field"><label>Email</label><input name="invite_email" type="email" autocomplete="off" maxlength="254" placeholder="member@example.com"${required ? ' required' : ''}></div>
        <div class="field"><label>Full name (optional)</label><input name="invite_name" type="text" maxlength="120" placeholder="e.g., Juan Dela Cruz"></div>
        <div class="field"><label>Monthly share</label><input name="invite_amount" type="number" min="1" max="1000000" step="0.01" value="${Ipon.escapeHtml(String(defaultAmount))}"></div>
        <div class="field"><label>Temporary password</label><input name="invite_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" data-temp-password placeholder="Recommended or custom password"${required ? ' required' : ''}></div>
      </div>
    `;
    Ipon.prepareTemporaryPassword(row.querySelector('[name="invite_password"]'));
    row.querySelector('.invite-row-remove').addEventListener('click', () => {
      if (required && container.querySelectorAll('.invite-row-card').length <= 1) return;
      row.remove();
      syncInviteRemoveButtons(container, required);
    });
    container.append(row);
    syncInviteRemoveButtons(container, required);
    return row;
  }

  function parseFullNameParts(fullName, email) {
    const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
    if (!cleaned) {
      const local = String(email || '').split('@')[0] || 'Member';
      const tokens = local.replace(/[^a-zA-Z\s._-]/g, ' ').split(/[._\s-]+/).map((v) => v.trim()).filter((v) => /^[a-zA-Z]{2,}$/.test(v));
      const cap = (v) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
      return {
        first_name: tokens[0] ? cap(tokens[0]).slice(0, 40) : 'Group',
        middle_name: null,
        last_name: tokens[1] ? cap(tokens.slice(1).join(' ')).slice(0, 40) : 'Member'
      };
    }
    const parts = cleaned.split(' ');
    if (parts.length === 1) return { first_name: parts[0], middle_name: null, last_name: 'Member' };
    if (parts.length === 2) return { first_name: parts[0], middle_name: null, last_name: parts[1] };
    return { first_name: parts[0], middle_name: parts.slice(1, -1).join(' '), last_name: parts[parts.length - 1] };
  }

  function collectInvitePayloads(container, { allowEmptyRows = true } = {}) {
    const entries = [];
    const rows = [...(container?.querySelectorAll('.invite-row-card') || [])];
    for (const row of rows) {
      const emailEl = row.querySelector('[name="invite_email"]');
      const nameEl = row.querySelector('[name="invite_name"]');
      const amountEl = row.querySelector('[name="invite_amount"]');
      const passEl = row.querySelector('[name="invite_password"]');
      const email = emailEl.value.trim().toLowerCase();
      const name = nameEl.value.trim();
      const password = passEl.value;
      const monthlyAmount = Number(amountEl.value) > 0 ? Number(amountEl.value) : 100;
      Ipon.setFieldError(emailEl, '');
      Ipon.setFieldError(passEl, '');
      if (allowEmptyRows && !email && !name) continue;
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        Ipon.setFieldError(emailEl, 'Enter a valid email address.');
        emailEl.focus();
        return null;
      }
      const pwIssue = Ipon.passwordIssue(password, [name, email.split('@')[0]]);
      if (pwIssue) {
        Ipon.setFieldError(passEl, pwIssue);
        passEl.focus();
        return null;
      }
      const parsed = parseFullNameParts(name, email);
      entries.push({
        role: 'MEMBER',
        create_member: true,
        ...parsed,
        email,
        password,
        monthly_contribution_amount: monthlyAmount
      });
    }
    return entries;
  }

  async function dispatchInvites(payloads) {
    const results = [];
    for (const payload of payloads) {
      try {
        const res = await Ipon.inviteAccount(payload);
        results.push({ ok: true, email: payload.email, ...res });
      } catch (error) {
        results.push({ ok: false, email: payload.email, error: Ipon.friendlyError(error) });
      }
    }
    return results;
  }

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
    activeGoalsList = [];
    updateDashboardGoalProgress(0);
    renderGoalOptions([]);
    renderCalendar([]);
    renderPending([]);
    announcements?.clear();
  }
  function updateDashboardGoalProgress(trackedSavings) {
    const box = document.getElementById('dashboard-goal-box');
    if (!box) return;
    if (typeof trackedSavings === 'number') lastTrackedSavings = trackedSavings;
    const tracked = Number(lastTrackedSavings || 0);
    let targetGoal = null;
    if (selectedGoalId) {
      targetGoal = activeGoalsList.find((g) => g.id === selectedGoalId);
    } else if (activeGoalsList.length > 0) {
      targetGoal = activeGoalsList[0];
    }
    if (!targetGoal) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const target = Number(targetGoal.target_amount) || 0;
    const pct = target > 0 ? (tracked / target) * 100 : 0;
    const pctClamped = Math.min(100, Math.max(0, pct));
    const pctFormatted = (Math.round(pct * 10) / 10).toFixed(pct % 1 === 0 ? 0 : 1) + '%';
    const remaining = Math.max(0, target - tracked);
    const isReached = target > 0 && tracked >= target;

    document.getElementById('dashboard-goal-label').textContent = `${targetGoal.title} · Target Progress`;
    document.getElementById('dashboard-goal-fraction').textContent = `${Ipon.money(tracked)} / ${Ipon.money(target)} (${pctFormatted})`;
    document.getElementById('dashboard-goal-fill').style.width = `${pctClamped}%`;
    const remEl = document.getElementById('dashboard-goal-remaining');
    remEl.textContent = isReached ? '✓ Target achieved!' : `${Ipon.money(remaining)} remaining`;
    remEl.classList.toggle('is-reached', isReached);
    document.getElementById('dashboard-goal-pct').textContent = `${pctFormatted} reached`;
  }
  async function load() {
    const start = monthIso(cursor), end = monthIso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    if (!state.configured || !state.profile) { renderEmptySnapshot(); return; }
    try {
      const [summaryResult, calendarResult, pending, memberResult, progressResult, goalResult, groupsResult, groupProfilesResult, allGoalsResult] = await Promise.all([
        Ipon.client.rpc('get_savings_summary'),
        Ipon.client.from('v_savings_calendar').select('*').in('approval_status', ['CONFIRMED', 'PENDING']).gte('activity_date', start).lt('activity_date', end).order('activity_date'),
        getPending(),
        Ipon.client.from('members').select('id,full_name,monthly_contribution_amount', { count: 'exact' }).eq('status', 'ACTIVE').order('full_name'),
        Ipon.client.from('v_contribution_status').select('member_id,payment_status,paid_amount').eq('period_month', start),
        Ipon.client.from('savings_goals').select('id,title').eq('status', 'ACTIVE').order('created_at', { ascending: false }),
        Ipon.rpc('get_my_groups'),
        Ipon.client.from('profiles').select('id,member_id,full_name,avatar_url').eq('status', 'ACTIVE'),
        Ipon.client.from('savings_goals').select('id,title,target_amount,target_date').eq('status', 'ACTIVE').order('created_at', { ascending: false }),
        announcements ? announcements.load().catch((err) => console.warn('Announcement load error:', err)) : Promise.resolve()
      ]);
      if (summaryResult.error) throw summaryResult.error; if (calendarResult.error) throw calendarResult.error; if (memberResult.error) throw memberResult.error; if (progressResult.error) throw progressResult.error; if (goalResult.error) throw goalResult.error;
      const profilesList = groupProfilesResult?.data || [];
      Ipon.registerMemberAvatars(profilesList);
      const profileByMemberId = new Map(profilesList.filter((p) => p.member_id).map((p) => [p.member_id, p]));
      const profileByName = new Map(profilesList.map((p) => [(p.full_name || '').trim().toLowerCase(), p]));
      (memberResult.data || []).forEach((m) => {
        const prof = profileByMemberId.get(m.id) || profileByName.get((m.full_name || '').trim().toLowerCase());
        if (prof?.avatar_url) m.avatar_url = prof.avatar_url;
        if (prof?.id) m.user_id = prof.id;
      });
      Ipon.registerMemberAvatars(memberResult.data || []);
      activeGoalsList = allGoalsResult?.data || [];
      renderGroupHeader(groupsResult || []);
      const adminMember = (memberResult.data || []).find((m) => m.id === currentGroup?.member_id || m.id === state?.profile?.member_id);
      if (adminMember && Number(adminMember.monthly_contribution_amount) > 0) {
        currentAdminMonthlyAmount = Number(adminMember.monthly_contribution_amount);
        syncGroupHub();
      }
      const summary = summaryResult.data || {}; const total = document.querySelector('.tracked-total'); total.textContent = heroMoney(summary.tracked_savings); total.classList.toggle('is-zero', Number(summary.tracked_savings || 0) === 0);
      [summary.total_additions, summary.total_deductions, summary.total_expenses, pending.amount].forEach((value,index) => { summaryValues[index].textContent = Ipon.money(value); });
      const activeIds = new Set((memberResult.data || []).map((m) => m.id));
      const progress = (progressResult.data || []).filter((item) => activeIds.has(item.member_id) || Number(item.paid_amount || 0) > 0);
      const paid = progress.filter((item) => ['PAID', 'OVERPAID'].includes(item.payment_status)).length; const unpaid = progress.filter((item) => ['UNPAID', 'PARTIALLY PAID'].includes(item.payment_status)).length;
      document.getElementById('dashboard-members').textContent = memberResult.count ?? (memberResult.data?.length || 0); document.getElementById('dashboard-month-collected').textContent = Ipon.money(progress.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0)); document.getElementById('dashboard-paid').textContent = paid; document.getElementById('dashboard-unpaid').textContent = unpaid; renderGoalOptions(goalResult.data || []);
      populateQuickRecordMembers(memberResult.data || []);
      updateDashboardGoalProgress(summary.tracked_savings);
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
    renderGroupHeader([{ group_id: 'fixture', name: 'Primary Savings Group', role: 'ADMIN', is_current: true, is_contributor: true, active_member_count: 2 }]);
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
      receiptUrl: item.receipt_url || '',
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
      : '<div class="day-modal-empty"><p>No contributions or activity recorded for this day.</p><button class="button button-primary" type="button" data-action="quick-record-day">+ Record entry</button></div>';
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
  async function handleGroupSwitch(selectEl) {
    const targetId = selectEl.value;
    if (!targetId || targetId === currentGroup?.group_id) return;
    selectEl.disabled = true;
    try {
      await Ipon.switchActiveGroup(targetId);
      location.reload();
    } catch (error) {
      selectEl.value = currentGroup?.group_id || '';
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      selectEl.disabled = false;
    }
  }
  groupSelect?.addEventListener('change', () => handleGroupSwitch(groupSelect));
  groupHubSelect?.addEventListener('change', () => handleGroupSwitch(groupHubSelect));
  document.getElementById('dashboard-manage-group')?.addEventListener('click', () => {
    syncGroupHub();
    groupHubDialog?.showModal();
  });
  document.getElementById('close-group-hub-dialog')?.addEventListener('click', () => groupHubDialog?.close());
  document.getElementById('done-group-hub-dialog')?.addEventListener('click', () => groupHubDialog?.close());
  document.getElementById('group-hub-create-another')?.addEventListener('click', () => {
    groupHubDialog?.close();
    openGroupDialog('create');
  });
  function openAdminContributorDialog(action = 'enable') {
    if (!adminContributorDialog || !adminContributorForm) return;
    const isEdit = action === 'edit';
    document.getElementById('admin-contributor-title').textContent = isEdit ? 'Update contributor amount' : 'Include yourself as a contributor?';
    document.getElementById('admin-contributor-copy').textContent = isEdit
      ? 'Adjust your monthly contribution amount for this group.'
      : 'Set your monthly contribution amount to participate in this group.';
    document.getElementById('save-admin-contributor').textContent = isEdit ? 'Save amount' : 'Confirm & join';
    adminContributorAmount.value = String(currentAdminMonthlyAmount || 100);
    adminContributorDialog.showModal();
    adminContributorAmount.focus();
    adminContributorAmount.select();
  }

  groupHubSelfToggle?.addEventListener('change', async () => {
    const wantEnable = groupHubSelfToggle.checked;
    if (wantEnable) {
      groupHubSelfToggle.checked = false;
      openAdminContributorDialog('enable');
    } else {
      groupHubSelfToggle.checked = true;
      const confirmed = await Ipon.confirmAction({
        title: 'Remove yourself as a contributor?',
        message: 'Are you sure you want to remove yourself as a contributor? You will no longer be included in monthly contribution periods or active rosters for this group.',
        acceptLabel: 'Remove contributor'
      });
      if (!confirmed) return;
      groupHubSelfToggle.checked = false;
      groupHubSelfToggle.disabled = true;
      try {
        await Ipon.rpc('set_admin_contributor', { p_enabled: false });
        Ipon.toast('You have been removed from active contributors.');
        await load();
      } catch (error) {
        groupHubSelfToggle.checked = true;
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        groupHubSelfToggle.disabled = false;
      }
    }
  });

  groupHubEditPledge?.addEventListener('click', () => {
    openAdminContributorDialog('edit');
  });

  document.getElementById('close-admin-contributor-dialog')?.addEventListener('click', () => adminContributorDialog?.close());
  document.getElementById('cancel-admin-contributor-dialog')?.addEventListener('click', () => adminContributorDialog?.close());

  adminContributorForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const amount = Number(adminContributorAmount.value);
    if (!amount || amount <= 0 || amount > 1000000) {
      Ipon.setFieldError(adminContributorAmount, 'Please enter a valid monthly amount between ₱1 and ₱1,000,000.');
      adminContributorAmount.focus();
      return;
    }
    const button = document.getElementById('save-admin-contributor');
    Ipon.setBusy(button, true, 'Saving…');
    try {
      await Ipon.rpc('set_admin_contributor', { p_enabled: true, p_monthly_amount: amount });
      currentAdminMonthlyAmount = amount;
      adminContributorDialog.close();
      Ipon.toast(`Contributor settings saved with ${Ipon.money(amount)} monthly contribution.`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  function openGroupDialog(mode) {
    if (!groupDialog || !groupForm) return;
    groupForm.reset();
    groupForm.elements.mode.value = mode;
    const isCreate = mode === 'create';
    document.getElementById('group-form-title').textContent = isCreate ? 'Create savings group' : 'Edit group';
    document.getElementById('group-form-copy').textContent = isCreate
      ? 'Set a group name, optional group picture, your contributor preference, and optional member invites.'
      : 'Update your group name, picture, and whether you participate as a contributor.';
    document.getElementById('save-group-dialog').textContent = isCreate ? 'Create group' : 'Save changes';
    pendingGroupAvatarUrl = isCreate ? null : (currentGroup?.avatar_url || null);
    pendingGroupClearAvatar = false;
    groupForm.elements.name.value = isCreate ? '' : (currentGroup?.name || '');
    const initialIncludeSelf = isCreate ? true : Boolean(currentGroup?.is_contributor);
    groupSelfToggle.checked = initialIncludeSelf;
    groupMonthlyInput.value = String(currentAdminMonthlyAmount || 100);
    groupMonthlyWrap.hidden = !initialIncludeSelf;
    groupMonthlyInput.required = initialIncludeSelf;
    groupInviteSection.hidden = !isCreate;
    groupInviteRows.replaceChildren();
    if (isCreate) appendInviteRow(groupInviteRows, { defaultAmount: 100, required: false });
    renderGroupDpPreview(pendingGroupAvatarUrl, groupForm.elements.name.value || (isCreate ? 'New Group' : currentGroup?.name));
    groupDialog.showModal();
    groupForm.elements.name.focus();
  }
  groupSelfToggle?.addEventListener('change', () => {
    const on = groupSelfToggle.checked;
    groupMonthlyWrap.hidden = !on;
    groupMonthlyInput.required = on;
  });
  groupDpInput?.addEventListener('change', async () => {
    const file = groupDpInput.files?.[0];
    groupDpInput.value = '';
    if (!file) return;
    try {
      await Ipon.openAvatarCropper(file, {
        title: 'Crop group display picture',
        onSave: (croppedDataUrl) => {
          pendingGroupAvatarUrl = croppedDataUrl;
          pendingGroupClearAvatar = false;
          renderGroupDpPreview(pendingGroupAvatarUrl, groupForm.elements.name.value);
        }
      });
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    }
  });
  groupDpRemove?.addEventListener('click', async () => {
    if (!pendingGroupAvatarUrl) return;
    const accepted = await Ipon.confirmAction({
      title: 'Remove group picture?',
      message: 'Are you sure you want to remove the group display picture?',
      acceptLabel: 'Remove'
    });
    if (!accepted) return;
    pendingGroupAvatarUrl = null;
    pendingGroupClearAvatar = true;
    renderGroupDpPreview(null, groupForm.elements.name.value || 'Group');
  });
  document.getElementById('group-add-invite-row')?.addEventListener('click', () => {
    appendInviteRow(groupInviteRows, { defaultAmount: Number(groupMonthlyInput.value) > 0 ? Number(groupMonthlyInput.value) : 100, required: false });
  });
  document.getElementById('dashboard-edit-group')?.addEventListener('click', () => {
    groupHubDialog?.close();
    openGroupDialog('edit');
  });
  document.getElementById('dashboard-create-group')?.addEventListener('click', () => openGroupDialog('create'));
  document.getElementById('no-group-create-btn')?.addEventListener('click', () => openGroupDialog('create'));
  document.getElementById('close-group-dialog')?.addEventListener('click', () => groupDialog?.close());
  document.getElementById('cancel-group-dialog')?.addEventListener('click', () => groupDialog?.close());
  groupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const isCreate = groupForm.elements.mode.value === 'create';
    const name = groupForm.elements.name.value.trim();
    const includeSelf = groupSelfToggle.checked;
    const monthlyAmount = Number(groupMonthlyInput.value) > 0 ? Number(groupMonthlyInput.value) : 100;
    const invitePayloads = isCreate ? collectInvitePayloads(groupInviteRows, { allowEmptyRows: true }) : [];
    if (isCreate && invitePayloads === null) return;
    const removingSelf = !isCreate && !includeSelf && Boolean(currentGroup?.is_contributor);
    const confirmed = await Ipon.confirmAction(removingSelf ? {
      title: 'Save group & remove contributor?',
      message: `Save changes to "${name}" and remove yourself as a contributor from this group?`,
      acceptLabel: 'Save & remove contributor'
    } : {
      title: isCreate ? 'Create savings group?' : 'Save group changes?',
      message: isCreate
        ? `Create "${name}"${invitePayloads.length ? ` and send ${invitePayloads.length} member invitation${invitePayloads.length === 1 ? '' : 's'}` : ''}?`
        : `Save updated settings for "${name}"?`,
      acceptLabel: isCreate ? 'Create group' : 'Save changes'
    });
    if (!confirmed) {
      if (removingSelf) groupSelfToggle.checked = true;
      return;
    }
    const button = document.getElementById('save-group-dialog');
    Ipon.setBusy(button, true, isCreate ? 'Creating…' : 'Saving…');
    try {
      if (isCreate) {
        await Ipon.rpc('admin_create_group', {
          p_name: name,
          p_avatar_url: pendingGroupAvatarUrl,
          p_include_self: includeSelf,
          p_monthly_amount: monthlyAmount
        });
        const inviteResults = invitePayloads.length ? await dispatchInvites(invitePayloads) : [];
        groupDialog.close();
        Ipon.toast('Savings group created.');
        if (inviteResults.length) {
          Ipon.showInviteSummary({ title: `Invites for ${name}`, results: inviteResults });
          document.getElementById('invite-summary-dialog')?.addEventListener('close', () => location.reload(), { once: true });
        } else {
          location.reload();
        }
      } else {
        await Ipon.rpc('update_group_profile', {
          p_name: name,
          p_avatar_url: pendingGroupAvatarUrl,
          p_clear_avatar: pendingGroupClearAvatar
        });
        if (includeSelf !== Boolean(currentGroup?.is_contributor) || (includeSelf && monthlyAmount)) {
          await Ipon.rpc('set_admin_contributor', {
            p_enabled: includeSelf,
            p_monthly_amount: includeSelf ? monthlyAmount : null
          });
          if (includeSelf) currentAdminMonthlyAmount = monthlyAmount;
        }
        groupDialog.close();
        Ipon.toast('Group updated.');
        await load();
      }
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });
  document.getElementById('dashboard-invite-member')?.addEventListener('click', () => {
    if (!inviteDialog || !inviteOnlyRows) return;
    groupHubDialog?.close();
    inviteOnlyRows.replaceChildren();
    appendInviteRow(inviteOnlyRows, { defaultAmount: 100, required: true });
    inviteDialog.showModal();
    inviteOnlyRows.querySelector('[name="invite_email"]')?.focus();
  });
  document.getElementById('invite-add-row')?.addEventListener('click', () => {
    appendInviteRow(inviteOnlyRows, { defaultAmount: 100, required: true });
  });
  document.getElementById('close-invite-dialog')?.addEventListener('click', () => inviteDialog?.close());
  document.getElementById('cancel-invite-dialog')?.addEventListener('click', () => inviteDialog?.close());
  inviteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payloads = collectInvitePayloads(inviteOnlyRows, { allowEmptyRows: false });
    if (!payloads || !payloads.length) return;

    const count = payloads.length;
    const emails = payloads.map((p) => p.email).join(', ');
    const confirmed = await Ipon.confirmAction({
      title: count === 1 ? 'Send member invitation?' : `Send ${count} member invitations?`,
      message: count === 1
        ? `Are you sure you want to invite ${payloads[0].full_name ? `${payloads[0].full_name} (${payloads[0].email})` : payloads[0].email} to "${currentGroup?.name || 'this group'}"? An invitation email will be sent automatically.`
        : `Are you sure you want to send invitations to ${count} members (${emails}) in "${currentGroup?.name || 'this group'}"? Invitation emails will be sent automatically.`,
      acceptLabel: count === 1 ? 'Send invitation' : 'Send invitations'
    });
    if (!confirmed) return;

    const button = event.submitter;
    Ipon.setBusy(button, true, 'Sending…');
    try {
      const results = await dispatchInvites(payloads);
      inviteDialog.close();
      await load();
      Ipon.showInviteSummary({ title: `Invites for ${currentGroup?.name || 'group'}`, results });
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });
  function populateQuickRecordMembers(members) {
    cachedMembers = members || [];
    Ipon.registerMemberAvatars(cachedMembers);
    if (quickMemberSelect) {
      const cur = quickMemberSelect.value;
      quickMemberSelect.innerHTML = `<option value="">Select member</option>${cachedMembers.map((m) => `<option value="${m.id}" data-avatar="${Ipon.escapeHtml(m.avatar_url || '')}" ${cur === m.id ? 'selected' : ''}>${Ipon.escapeHtml(m.full_name)}</option>`).join('')}`;
      if (state.profile?.role === 'MEMBER' && state.profile.member_id) {
        quickMemberSelect.value = state.profile.member_id;
      }
      Ipon.enhanceMemberSelect(quickMemberSelect);
    }
    if (quickResponsibleSelect) {
      const cur = quickResponsibleSelect.value;
      const ownName = cachedMembers.find((m) => m.id === state.profile?.member_id)?.full_name || state.profile?.full_name || '';
      quickResponsibleSelect.innerHTML = `<option value="">Select member</option>${cachedMembers.map((m) => `<option value="${Ipon.escapeHtml(m.full_name)}" data-avatar="${Ipon.escapeHtml(m.avatar_url || '')}" ${(cur || ownName) === m.full_name ? 'selected' : ''}>${Ipon.escapeHtml(m.full_name)}</option>`).join('')}`;
      Ipon.enhanceMemberSelect(quickResponsibleSelect);
    }
  }

  function setQuickRecordType(type) {
    currentQuickType = type;
    const isAddition = type === 'addition';
    const isDeduction = type === 'deduction';
    const isExpense = type === 'expense';
    const isMemberRole = state.profile?.role === 'MEMBER';

    quickTabAddition?.classList.toggle('is-active', isAddition);
    quickTabAddition?.setAttribute('aria-selected', isAddition ? 'true' : 'false');
    quickTabDeduction?.classList.toggle('is-active', isDeduction);
    quickTabDeduction?.setAttribute('aria-selected', isDeduction ? 'true' : 'false');
    quickTabExpense?.classList.toggle('is-active', isExpense);
    quickTabExpense?.setAttribute('aria-selected', isExpense ? 'true' : 'false');

    if (quickEntryTypeInput) quickEntryTypeInput.value = type;

    if (isAddition) {
      if (quickTitle) quickTitle.textContent = isMemberRole ? 'Record addition' : 'Record savings addition';
      if (quickSubtitle) quickSubtitle.textContent = 'Record money added to the group savings fund.';
      if (quickSubmitBtn) quickSubmitBtn.textContent = 'Save addition';
      if (quickDateLabel) quickDateLabel.textContent = 'Date added';
    } else if (isDeduction) {
      if (quickTitle) quickTitle.textContent = 'Record deduction';
      if (quickSubtitle) quickSubtitle.textContent = 'Track money deducted or withdrawn from the savings fund.';
      if (quickSubmitBtn) quickSubmitBtn.textContent = 'Save deduction';
      if (quickDateLabel) quickDateLabel.textContent = 'Date deducted';
      if (quickDescLabel) quickDescLabel.textContent = 'Reason / description';
      if (quickCategoryInput) quickCategoryInput.placeholder = 'e.g. Emergency use, Loan repayment';
    } else {
      if (quickTitle) quickTitle.textContent = 'Record expense';
      if (quickSubtitle) quickSubtitle.textContent = 'Track group expenses separately from deductions.';
      if (quickSubmitBtn) quickSubmitBtn.textContent = 'Save expense';
      if (quickDateLabel) quickDateLabel.textContent = 'Date incurred';
      if (quickDescLabel) quickDescLabel.textContent = 'Description';
      if (quickCategoryInput) quickCategoryInput.placeholder = 'e.g. Supplies, Office, Operations';
    }

    if (quickFieldMember) quickFieldMember.hidden = !isAddition || isMemberRole;
    if (quickMemberSelect) quickMemberSelect.required = isAddition && !isMemberRole;

    if (quickMemberAuto) {
      quickMemberAuto.hidden = !isAddition || !isMemberRole;
      if (quickMemberAutoName) quickMemberAutoName.textContent = state.profile?.full_name || 'Member';
    }

    if (quickFieldResponsible) quickFieldResponsible.hidden = isAddition;
    if (quickResponsibleSelect) quickResponsibleSelect.required = !isAddition;

    if (quickFieldMonth) quickFieldMonth.hidden = !isAddition;
    if (quickMonthInput) quickMonthInput.required = isAddition;

    if (quickFieldCategory) quickFieldCategory.hidden = isAddition;
    if (quickCategoryInput) quickCategoryInput.required = !isAddition;

    if (quickFieldDescription) quickFieldDescription.hidden = isAddition;
    if (quickDescriptionInput) quickDescriptionInput.required = !isAddition;
  }

  function openQuickRecordDialog(presetDate = null, presetType = 'addition') {
    if (!quickRecordDialog) return;
    quickPendingKey = null;
    quickRecordForm.reset();

    const today = Ipon.isoDate();
    const dateVal = presetDate || today;
    if (quickDateInput) quickDateInput.value = dateVal;
    if (quickMonthInput) quickMonthInput.value = dateVal.slice(0, 7);

    const isMemberRole = state.profile?.role === 'MEMBER';
    if (quickRecordTypeTabs) quickRecordTypeTabs.hidden = isMemberRole;

    setQuickRecordType(isMemberRole ? 'addition' : presetType);

    if (isMemberRole) {
      if (quickMemberSelect) quickMemberSelect.value = state.profile.member_id || '';
      if (quickMemberAutoName) quickMemberAutoName.textContent = state.profile.full_name || 'Member';
    }

    quickRecordDialog.showModal();
    quickAmountInput?.focus();
  }

  dashboardRecordEntryBtn?.addEventListener('click', () => {
    openQuickRecordDialog();
  });

  dayModalBody?.addEventListener('click', (event) => {
    const quickBtn = event.target.closest('[data-action="quick-record-day"]');
    if (quickBtn) {
      dayModal.close();
      openQuickRecordDialog(activeDate || null, 'addition');
    }
  });

  quickTabAddition?.addEventListener('click', () => setQuickRecordType('addition'));
  quickTabDeduction?.addEventListener('click', () => setQuickRecordType('deduction'));
  quickTabExpense?.addEventListener('click', () => setQuickRecordType('expense'));

  quickMemberSelect?.addEventListener('change', () => {
    const chosen = cachedMembers.find((m) => m.id === quickMemberSelect.value);
    if (chosen && chosen.monthly_contribution_amount > 0 && !quickAmountInput.value) {
      quickAmountInput.value = chosen.monthly_contribution_amount;
    }
  });

  document.getElementById('quick-record-close')?.addEventListener('click', () => quickRecordDialog?.close());
  document.getElementById('quick-record-cancel')?.addEventListener('click', () => quickRecordDialog?.close());
  quickRecordDialog?.addEventListener('click', (event) => {
    if (event.target === quickRecordDialog) quickRecordDialog.close();
  });

  quickRecordForm?.addEventListener('input', () => { quickPendingKey = null; });
  quickRecordForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!quickRecordForm.reportValidity()) return;
    const values = new FormData(quickRecordForm);
    const amount = Number(values.get('amount'));
    if (!(amount > 0)) {
      Ipon.setFieldError(quickAmountInput, 'Enter an amount greater than zero.');
      quickAmountInput.focus();
      return;
    }

    const type = currentQuickType;
    const isAddition = type === 'addition';
    const isDeduction = type === 'deduction';
    const isMemberRole = state.profile?.role === 'MEMBER';

    if (isAddition && isMemberRole && !state.profile.member_id) {
      Ipon.toast('Your account is not linked to a member profile. Ask your group administrator to link your account.', 'error');
      return;
    }

    if (quickRecordForm.elements.reference && !Ipon.validateNumericInput(quickRecordForm.elements.reference)) {
      quickRecordForm.elements.reference.focus();
      return;
    }
    const typeLabel = isAddition ? 'addition' : isDeduction ? 'deduction' : 'expense';
    const isAdmin = state.profile?.role === 'ADMIN';
    const confirmed = await Ipon.confirmAction({
      title: isAdmin ? `Confirm ${typeLabel}?` : `Submit ${typeLabel} for review?`,
      message: isAdmin
        ? `${Ipon.money(amount)} will be immediately confirmed and included in tracked savings.`
        : `${Ipon.money(amount)} will be submitted as pending until an administrator confirms it.`,
      acceptLabel: isAdmin ? 'Confirm and save' : 'Submit for review'
    });
    if (!confirmed) return;

    quickPendingKey ||= crypto.randomUUID();
    Ipon.setBusy(quickSubmitBtn, true);

    try {
      if (isAddition) {
        await Ipon.rpc('record_contribution', {
          p_member_id: isMemberRole ? state.profile.member_id : values.get('member_id'),
          p_contribution_month: `${values.get('contribution_month')}-01`,
          p_amount: amount,
          p_payment_date: values.get('date'),
          p_transaction_reference: values.get('reference') || null,
          p_notes: values.get('notes') || null,
          p_idempotency_key: quickPendingKey
        });
      } else {
        const ownResponsible = cachedMembers.find((m) => m.id === state.profile?.member_id)?.full_name || state.profile?.full_name;
        await Ipon.rpc(isDeduction ? 'record_withdrawal' : 'record_expense', {
          p_transaction_date: values.get('date'),
          p_amount: amount,
          p_category: values.get('category'),
          p_description: values.get('description'),
          p_person_responsible: isMemberRole ? ownResponsible : values.get('person_responsible'),
          p_reference_number: values.get('reference') || null,
          p_notes: values.get('notes') || null,
          p_idempotency_key: quickPendingKey
        });
      }

      quickPendingKey = null;
      Ipon.toast(state.profile?.role === 'ADMIN' ? 'Confirmed record saved.' : 'Record submitted for admin review.');
      quickRecordDialog.close();
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(quickSubmitBtn, false);
    }
  });

  goalSelects.forEach((select) => select.addEventListener('change', () => {
    selectedGoalId = select.value;
    goalSelects.forEach((other) => { other.value = selectedGoalId; });
    updateDashboardGoalProgress();
  }));

  const aiInsightsDialog = document.getElementById('ai-insights-dialog');
  const aiInsightsBtn = document.getElementById('dashboard-ai-insights-btn');
  const aiInsightsClose = document.getElementById('ai-insights-close');
  const aiInsightsDone = document.getElementById('ai-insights-done');
  const aiInsightsRefresh = document.getElementById('ai-insights-refresh');
  const aiForecastText = document.getElementById('ai-forecast-text');
  const aiTipText = document.getElementById('ai-tip-text');
  const aiMotivationText = document.getElementById('ai-motivation-text');
  const aiGoalNameEl = document.getElementById('ai-insights-goal-name');
  const aiGoalMetaEl = document.getElementById('ai-insights-goal-meta');

  async function fetchAndRenderAiInsights() {
    let targetGoal = null;
    if (selectedGoalId) {
      targetGoal = activeGoalsList.find((g) => g.id === selectedGoalId);
    } else if (activeGoalsList.length > 0) {
      targetGoal = activeGoalsList[0];
    }
    const goalTitle = targetGoal?.title || 'General Savings';
    const targetAmt = Number(targetGoal?.target_amount || 0);
    const tracked = Number(lastTrackedSavings || 0);
    const targetDate = targetGoal?.target_date || '';

    let monthlyPledge = 0;
    try {
      const { data: setRow } = await Ipon.client.from('contribution_settings').select('amount').limit(1).maybeSingle();
      monthlyPledge = Number(setRow?.amount || 0);
    } catch (_) {}

    const pct = targetAmt > 0 ? Math.min(100, Math.round((tracked / targetAmt) * 100)) : 0;
    if (aiGoalNameEl) aiGoalNameEl.textContent = goalTitle;
    if (aiGoalMetaEl) aiGoalMetaEl.textContent = `${Ipon.money(tracked)} / ${Ipon.money(targetAmt)} (${pct}%)`;

    if (aiForecastText) aiForecastText.textContent = 'Generating intelligent forecast with Gemini AI…';
    if (aiTipText) aiTipText.textContent = 'Analyzing savings habits and micro-optimizations…';
    if (aiMotivationText) aiMotivationText.textContent = 'Consulting financial streak…';

    try {
      const apiKey = Ipon.getGeminiApiKey ? Ipon.getGeminiApiKey() : '';
      const prompt = `You are an expert, encouraging personal finance coach for myIPON (Group Savings and Financial Tracker) in the Philippines. The system is named "myIPON". Analyze this savings progress:
- Goal: "${goalTitle}"
- Target Amount: ₱${targetAmt}
- Saved So Far: ₱${tracked} (${pct}% complete)
- Monthly Pledge: ₱${monthlyPledge}
- Target Date: ${targetDate || 'Not specified'}

Generate helpful financial guidance. Return a valid JSON object with EXACTLY these three keys:
{
  "forecast": "1-2 concise sentences on realistic timeline/completion based on monthly pledge and remaining balance",
  "smart_tip": "1 actionable, practical micro-saving or budget optimization tip tailored to this goal",
  "motivation": "1 inspiring, encouraging sentence celebrating their progress and momentum on myIPON"
}`;

      if (apiKey) {
        const res = await Ipon.callGemini({
          prompt,
          systemInstruction: 'You are an intelligent, encouraging personal financial assistant for myIPON savers. The platform name is strictly "myIPON". Respond strictly in English and valid JSON format.',
          jsonResponse: true
        });

        const data = res?.parsed || {};
        if (aiForecastText) aiForecastText.textContent = data.forecast || 'Keep contributing steadily to stay on track.';
        if (aiTipText) aiTipText.textContent = data.smart_tip || 'Regular deposits create long-term compound savings.';
        if (aiMotivationText) aiMotivationText.textContent = data.motivation || 'Consistency beats intensity every time!';

        Ipon.toast(`✨ AI Insights generated with Gemini (${res.model})!`);
        return;
      }

      // Action: ai-savings-insights (uses backend GEMINI_API_KEY in Supabase)
      try {
        const backendRes = await Ipon.invokeAccountFunction('manage-account', {
          action: 'ai-savings-insights',
          goal_name: goalTitle,
          target_amount: targetAmt,
          tracked_amount: tracked,
          monthly_pledge: monthlyPledge,
          target_date: targetDate
        });
        if (backendRes?.forecast) {
          if (aiForecastText) aiForecastText.textContent = backendRes.forecast;
          if (aiTipText) aiTipText.textContent = backendRes.smart_tip || 'Regular deposits create long-term compound savings.';
          if (aiMotivationText) aiMotivationText.textContent = backendRes.motivation || 'Consistency beats intensity every time!';
          Ipon.toast('✨ AI Insights generated with Gemini AI!');
          return;
        }
      } catch (_) { }
    } catch (err) {
      const remaining = Math.max(0, targetAmt - tracked);
      const monthsNeeded = monthlyPledge > 0 ? Math.ceil(remaining / monthlyPledge) : 0;
      if (aiForecastText) {
        aiForecastText.textContent = monthlyPledge > 0
          ? `At your current monthly pledge of ${Ipon.money(monthlyPledge)}, you are projected to reach your goal in ~${monthsNeeded} month${monthsNeeded === 1 ? '' : 's'}.`
          : `Set a monthly contribution pledge to calculate your exact projected completion date.`;
      }
      if (aiTipText) {
        aiTipText.textContent = remaining > 0
          ? `Adding just ${Ipon.money(Math.max(100, Math.round(remaining / 52)))} extra each week will significantly speed up your completion.`
          : `Congratulations on reaching 100% of your target! Time to set your next financial milestone.`;
      }
      if (aiMotivationText) {
        aiMotivationText.textContent = pct >= 100
          ? `Goal accomplished! Your financial discipline sets a wonderful example.`
          : `You are making steady progress! Every single peso saved builds your future financial peace of mind.`;
      }
    }
  }

  aiInsightsBtn?.addEventListener('click', () => {
    if (!aiInsightsDialog) return;
    aiInsightsDialog.showModal();
    fetchAndRenderAiInsights();
  });

  aiInsightsClose?.addEventListener('click', () => aiInsightsDialog?.close());
  aiInsightsDone?.addEventListener('click', () => aiInsightsDialog?.close());
  aiInsightsRefresh?.addEventListener('click', () => {
    Ipon.setBusy(aiInsightsRefresh, true);
    fetchAndRenderAiInsights().finally(() => Ipon.setBusy(aiInsightsRefresh, false));
  });
  renderCalendar([]);
  state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || state.redirecting) return;
  if (state.profile?.role !== 'ADMIN') document.querySelectorAll('a[href="members.html"],a[href="settings.html"],a[href="audit.html"]').forEach((link) => link.remove());
  if (state.profile?.role !== 'MEMBER') document.querySelectorAll('a[href="user.html"]').forEach((link) => link.remove());
  if (addAnnouncementButton) addAnnouncementButton.hidden = state.profile?.role !== 'ADMIN';
  try { await load(); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('dashboard', ['members', 'profiles', 'groups', 'group_memberships', 'contribution_periods', 'contributions', 'withdrawals', 'expenses', 'savings_goals', 'announcements', 'announcement_reactions'], load);
})();
