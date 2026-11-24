(async function () {
  'use strict';
  const visualFixture = new URLSearchParams(location.search).get('visual') === 'approved'
    && ['localhost', '127.0.0.1'].includes(location.hostname);
  let cursor = new Date(); cursor = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  let state;
  let currentActivities = [];
  let pendingItemsById = new Map();
  let currentChangeRequests = [];
  let pendingChangesByRecord = new Map();
  let groupProfileByMemberId = new Map();
  let groupProfileById = new Map();
  let activeDate = null;
  let openModalDate = null;
  let hasSnapshot = false;
  const dataStatus = document.getElementById('dashboard-data-status');
  const detailPanel = document.getElementById('day-detail-panel');
  const dayModal = document.getElementById('day-contributors-dialog');
  const dayModalTitle = document.getElementById('day-modal-title');
  const dayModalSubtitle = document.getElementById('day-modal-subtitle');
  const dayModalBody = document.getElementById('day-modal-body');
  const changeRequestsWrap = document.getElementById('dashboard-change-requests');
  const calendarCard = document.querySelector('.calendar-card');
  const jumpDialog = document.getElementById('calendar-jump-dialog');
  const jumpMonth = document.getElementById('calendar-jump-month');
  const jumpYear = document.getElementById('calendar-jump-year');
  const weeks = [...document.querySelectorAll('.calendar-week')];
  const summaryBreakdownEl = document.querySelector('.summary-breakdown');
  const summaryTileEls = {
    additions: summaryBreakdownEl?.querySelector('[data-summary-tile="additions"]') || null,
    deductions: summaryBreakdownEl?.querySelector('[data-summary-tile="deductions"]') || null,
    expenses: summaryBreakdownEl?.querySelector('[data-summary-tile="expenses"]') || null,
    pending: summaryBreakdownEl?.querySelector('[data-summary-tile="pending"]') || null
  };
  let lastSummaryBreakdownSnapshot = null;
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
  const quickPaymentMethodLabel = document.getElementById('quick-payment-method-label');
  const quickFieldDescription = document.getElementById('quick-field-description');
  const quickDescLabel = document.getElementById('quick-desc-label');
  const quickDescriptionInput = document.getElementById('quick-description');
  const quickFieldNotes = document.getElementById('quick-field-notes');
  const quickNotesInput = document.getElementById('quick-notes');
  const quickSubmitBtn = document.getElementById('quick-record-submit');
  const dashboardRecordEntryBtn = document.getElementById('dashboard-record-entry');
  const cycleBadge = document.getElementById('dashboard-cycle-badge');
  const remindUnpaidBtn = document.getElementById('dashboard-remind-unpaid-btn');
  const bulkConfirmBtn = document.getElementById('dashboard-bulk-confirm-btn');
  const bulkConfirmDialog = document.getElementById('bulk-confirm-dialog');
  const bulkConfirmList = document.getElementById('bulk-confirm-list');
  const bulkConfirmSelectAll = document.getElementById('bulk-confirm-select-all');
  const bulkConfirmSubmit = document.getElementById('bulk-confirm-submit');
  const walletStrip = document.getElementById('dashboard-wallet-strip');
  const walletCashEl = document.getElementById('dashboard-wallet-cash');
  const walletDigitalEl = document.getElementById('dashboard-wallet-digital');
  const walletUntaggedWrap = document.getElementById('dashboard-wallet-untagged-wrap');
  const walletUntaggedEl = document.getElementById('dashboard-wallet-untagged');

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
  function renderHeroMoneyEl(el, value, { smallTag = 'i' } = {}) {
    if (!el) return;
    const raw = Number(value);
    const safe = Number.isFinite(raw) ? raw : 0;
    const negative = safe < 0;
    const abs = Math.abs(safe);
    const [whole, cents] = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split('.');
    const digitCount = whole.replace(/,/g, '').length;
    const lenTier = digitCount <= 4 ? 'sm' : digitCount <= 7 ? 'md' : digitCount <= 10 ? 'lg' : 'xl';
    if (el.dataset) el.dataset.valLen = lenTier;
    const tag = smallTag === 'small' ? 'small' : 'i';
    const prefix = negative ? '−₱' : '₱';
    el.innerHTML = `<${tag}>${prefix}</${tag}><span class="hero-val-num">${whole}</span><span class="hero-val-cents">.${cents}</span>`;
  }
  const groupAvatarEl = document.getElementById('dashboard-group-avatar');
  const groupNameEl = document.getElementById('dashboard-group-name');
  const groupModeEl = document.getElementById('dashboard-group-mode');
  const groupRoleEl = document.getElementById('dashboard-group-role');
  const groupMetaEl = document.getElementById('dashboard-group-meta');
  const groupSelect = document.getElementById('dashboard-group-select');
  const groupSwitcherWrap = document.getElementById('dashboard-group-switcher-wrap');
  const groupIdentityEl = document.querySelector('#dashboard-group-bar .group-bar-identity');
  const groupActionsEl = document.getElementById('dashboard-group-actions');
  const groupHubDialog = document.getElementById('group-manage-hub-dialog');
  const groupHubAvatar = document.getElementById('group-hub-avatar');
  const groupHubTitle = document.getElementById('group-hub-title');
  const groupHubMode = document.getElementById('group-hub-mode');
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
  const groupSelfWrap = document.getElementById('group-self-contributor-wrap');
  const groupMonthlyWrap = document.getElementById('group-monthly-wrap');
  const groupMonthlyLabel = document.getElementById('group-monthly-label');
  const groupMonthlyInput = document.getElementById('group-default-amount');
  const groupInviteSection = document.getElementById('group-invite-section');
  const groupInviteRows = document.getElementById('group-invite-rows');
  const groupWorkspaceModeInput = document.getElementById('group-workspace-mode-input');
  const groupWorkspaceModeTabs = document.getElementById('group-workspace-mode-tabs');
  const groupWorkspaceModeHelp = document.getElementById('group-workspace-mode-help');
  const groupDpLabel = document.getElementById('group-dp-label');
  const groupNameLabel = document.getElementById('group-name-label');
  const groupNameHelp = document.getElementById('group-name-help');
  const groupHubEyebrow = document.getElementById('group-hub-eyebrow');
  const groupHubSoloBanner = document.getElementById('group-hub-solo-banner');
  const groupHubContributorSection = document.getElementById('group-hub-contributor-section');
  const groupHubMembersLink = document.getElementById('group-hub-members-link');
  const groupHubInviteBtn = document.getElementById('dashboard-invite-member');
  const groupHubEditTitle = document.getElementById('group-hub-edit-title');
  const groupHubEditCopy = document.getElementById('group-hub-edit-copy');
  const groupHubSettingsCopy = document.getElementById('group-hub-settings-copy');
  const groupHubDeleteBtn = document.getElementById('group-hub-delete-btn');
  const groupDeleteDialog = document.getElementById('group-delete-dialog');
  const groupDeleteForm = document.getElementById('group-delete-form');
  const groupDeleteNameEl = document.getElementById('group-delete-group-name');
  const groupDeleteExpectedNameEl = document.getElementById('group-delete-expected-name');
  const groupTransferPanel = document.getElementById('group-transfer-panel');
  const groupTransferMemberSelect = document.getElementById('group-transfer-member');
  const groupTransferEmpty = document.getElementById('group-transfer-empty');
  const groupDeletePanel = document.getElementById('group-delete-panel');
  const groupDeleteConfirmInput = document.getElementById('group-delete-confirm-name');
  const groupDeleteSubmitBtn = document.getElementById('submit-group-delete-dialog');
  const inviteDialog = document.getElementById('group-invite-dialog');
  const inviteForm = document.getElementById('group-invite-form');
  const inviteOnlyRows = document.getElementById('invite-only-rows');

  function syncGroupHub() {
    if (!currentGroup) return;
    const isSolo = currentGroup.workspace_mode === 'SOLO';
    const safeName = currentGroup.name || (isSolo ? 'Solo Savings' : 'Savings Group');
    if (groupHubAvatar) {
      groupHubAvatar.innerHTML = Ipon.avatarMarkup(currentGroup.avatar_url, safeName, 'avatar-lg');
      Ipon.bindAvatarFallbacks(groupHubAvatar);
    }
    if (groupHubEyebrow) groupHubEyebrow.textContent = isSolo ? 'Solo workspace' : 'Group workspace';
    if (groupHubTitle) groupHubTitle.textContent = safeName;
    if (groupHubMode) {
      groupHubMode.hidden = false;
      groupHubMode.textContent = isSolo ? 'SOLO' : 'GROUP';
      groupHubMode.classList.toggle('is-solo', isSolo);
      groupHubMode.classList.toggle('is-group', !isSolo);
    }
    if (groupHubRole) {
      groupHubRole.hidden = isSolo;
      groupHubRole.textContent = currentGroup.role || state?.profile?.role || 'ADMIN';
      groupHubRole.classList.remove('is-solo');
    }
    const contributorCount = Number(currentGroup.active_member_count || 0);
    if (groupHubMeta) {
      groupHubMeta.textContent = isSolo
        ? 'Personal savings tracker · No invitations needed'
        : `${contributorCount} active contributor${contributorCount === 1 ? '' : 's'} · ${currentGroup.is_contributor ? 'You are participating' : 'Manager view only'}`;
    }
    if (groupHubSoloBanner) groupHubSoloBanner.hidden = !isSolo;
    if (groupHubInviteBtn) groupHubInviteBtn.hidden = isSolo;
    if (groupHubContributorSection) groupHubContributorSection.hidden = isSolo;
    if (groupHubMembersLink) groupHubMembersLink.hidden = isSolo;
    if (groupHubEditTitle) groupHubEditTitle.textContent = isSolo ? 'Edit tracker & mode' : 'Edit group & picture';
    if (groupHubEditCopy) {
      groupHubEditCopy.textContent = isSolo
        ? 'Rename tracker, upload picture, or switch to Group savings.'
        : 'Rename workspace, upload picture, or switch saving mode.';
    }
    if (groupHubSettingsCopy) {
      groupHubSettingsCopy.textContent = isSolo
        ? 'Configure monthly savings schedules for this tracker'
        : 'Configure monthly schedules and workspace settings';
    }
    if (groupHubDeleteBtn) groupHubDeleteBtn.textContent = isSolo ? 'Delete tracker' : 'Delete group';
    if (groupHubSwitcherWrap && groupHubSelect) {
      groupHubSwitcherWrap.hidden = myGroups.length <= 1;
      Ipon.populateGroupSelect(groupHubSelect, myGroups, currentGroup.group_id);
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

  function formatBreakdownValue(value) {
    const raw = Number(value);
    const safe = Number.isFinite(raw) ? raw : 0;
    const negative = safe < 0;
    const abs = Math.abs(safe);
    const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const [whole, cents] = formatted.split('.');
    const digitCount = whole.replace(/,/g, '').length;
    const lenTier = digitCount <= 4 ? 'sm' : digitCount <= 7 ? 'md' : digitCount <= 10 ? 'lg' : 'xl';
    const text = `${negative ? '-' : ''}₱${whole}.${cents}`;
    const html = `${negative ? '<span class="breakdown-val-sign">-</span>' : ''}<i>₱</i><span class="breakdown-val-num">${whole}</span><span class="breakdown-val-cents">.${cents}</span>`;
    return { amount: safe, isZero: safe === 0, lenTier, text, html };
  }

  function formatBreakdownEntryMeta(count, { hasArchived = false, amount = 0, pending = false } = {}) {
    if (count !== undefined && count !== null && count !== '' && Number.isFinite(Number(count))) {
      const n = Math.max(0, Math.trunc(Number(count)));
      if (n === 0 && hasArchived) return 'Archived entries';
      if (n === 0) return 'No entries';
      const base = `${n.toLocaleString('en-US')} ${n === 1 ? 'entry' : 'entries'}`;
      return hasArchived ? `${base} + archived` : base;
    }
    if (Math.abs(Number(amount || 0)) > 0) return pending ? 'Pending review' : 'Confirmed total';
    return 'No entries';
  }

  function syncSummaryBreakdownMode(isSolo) {
    const solo = Boolean(isSolo);
    if (summaryBreakdownEl) summaryBreakdownEl.classList.toggle('is-solo', solo);
    if (summaryTileEls.expenses) summaryTileEls.expenses.hidden = solo;
    if (summaryTileEls.pending) summaryTileEls.pending.hidden = solo;
    if (lastSummaryBreakdownSnapshot && lastSummaryBreakdownSnapshot.isSolo !== solo) {
      renderSummaryBreakdown({ ...lastSummaryBreakdownSnapshot, isSolo: solo });
    }
  }

  function renderSummaryBreakdown({ summary = null, pending = null, isSolo = false, error = false } = {}) {
    const solo = Boolean(isSolo);
    if (summaryBreakdownEl) summaryBreakdownEl.classList.toggle('is-solo', solo);
    if (summaryTileEls.expenses) summaryTileEls.expenses.hidden = solo;
    if (summaryTileEls.pending) summaryTileEls.pending.hidden = solo;
    lastSummaryBreakdownSnapshot = { summary, pending, isSolo: solo, error: Boolean(error) };

    const safeSummary = summary || {};
    const safePending = pending || {};
    const tiles = [
      {
        key: 'additions',
        label: 'Additions (confirmed)',
        amount: Number(safeSummary.total_additions || 0),
        count: safeSummary.additions_count,
        hasArchived: Boolean(safeSummary.has_archived_additions),
        visible: true
      },
      {
        key: 'deductions',
        label: 'Deductions (confirmed)',
        amount: Number(safeSummary.total_deductions || 0),
        count: safeSummary.deductions_count,
        hasArchived: Boolean(safeSummary.has_archived_deductions),
        visible: true
      },
      {
        key: 'expenses',
        label: 'Expenses',
        amount: Number(safeSummary.total_expenses || 0),
        count: safeSummary.expenses_count,
        hasArchived: Boolean(safeSummary.has_archived_expenses),
        visible: !solo
      },
      {
        key: 'pending',
        label: 'Pending (for review)',
        amount: Number(safePending.amount || 0),
        count: safePending.count,
        hasArchived: false,
        pending: true,
        visible: !solo
      }
    ];

    const visibleTotal = error
      ? 0
      : tiles.reduce((sum, tile) => sum + (tile.visible ? Math.max(0, Number.isFinite(tile.amount) ? tile.amount : 0) : 0), 0);

    tiles.forEach((tile) => {
      const el = summaryTileEls[tile.key];
      if (!el) return;
      el.hidden = !tile.visible;
      const valEl = el.querySelector('dd');
      const barEl = el.querySelector('.breakdown-tile-bar b');
      const metaEl = el.querySelector('.breakdown-tile-meta');

      if (error) {
        el.classList.add('is-zero');
        el.setAttribute('aria-label', `${tile.label}: Unavailable`);
        if (valEl) {
          valEl.removeAttribute('data-val-len');
          valEl.textContent = '—';
        }
        if (barEl) barEl.style.setProperty('--w', '0%');
        if (metaEl) metaEl.textContent = 'Unavailable';
        return;
      }

      const fmt = formatBreakdownValue(tile.amount);
      const pct = visibleTotal > 0 && fmt.amount > 0
        ? Math.max(4, Math.min(100, Math.round((fmt.amount / visibleTotal) * 100)))
        : 0;
      const metaText = formatBreakdownEntryMeta(tile.count, {
        hasArchived: tile.hasArchived,
        amount: fmt.amount,
        pending: Boolean(tile.pending)
      });

      el.classList.toggle('is-zero', fmt.isZero);
      el.setAttribute('aria-label', `${tile.label}: ${fmt.text}, ${metaText}`);
      if (valEl) {
        valEl.dataset.valLen = fmt.lenTier;
        valEl.innerHTML = fmt.html;
      }
      if (barEl) barEl.style.setProperty('--w', `${pct}%`);
      if (metaEl) metaEl.textContent = metaText;
    });
  }

  function renderGroupHeader(groups) {
    myGroups = Array.isArray(groups) ? groups : [];
    currentGroup = myGroups.find((group) => group.is_current) || myGroups[0] || null;
    Ipon.syncWorkspaceMode?.(currentGroup ? (currentGroup.workspace_mode || 'GROUP') : 'NONE');
    syncSummaryBreakdownMode(currentGroup?.workspace_mode === 'SOLO');
    const noGroupCard = document.getElementById('dashboard-no-group-card');
    if (noGroupCard) noGroupCard.hidden = Boolean(currentGroup);
    const summaryCard = document.querySelector('.summary-card');
    if (summaryCard) summaryCard.classList.toggle('is-empty-group', !currentGroup);
    const manageBtn = document.getElementById('dashboard-manage-group');
    if (manageBtn) manageBtn.hidden = !(currentGroup && currentGroup.role === 'ADMIN');
    if (!currentGroup) {
      if (groupNameEl) groupNameEl.textContent = 'No workspace selected';
      if (groupModeEl) {
        groupModeEl.hidden = true;
        groupModeEl.classList.remove('is-solo', 'is-group');
      }
      if (groupRoleEl) {
        groupRoleEl.hidden = false;
        groupRoleEl.textContent = state?.profile?.role || '—';
        groupRoleEl.classList.remove('is-solo');
      }
      if (groupHubMode) {
        groupHubMode.hidden = true;
        groupHubMode.classList.remove('is-solo', 'is-group');
      }
      if (groupMetaEl) groupMetaEl.textContent = 'Start solo savings or create a savings group';
      if (groupSwitcherWrap) groupSwitcherWrap.hidden = true;
      groupIdentityEl?.classList.remove('is-switchable');
      return;
    }
    const isSolo = currentGroup.workspace_mode === 'SOLO';
    const safeName = currentGroup.name || (isSolo ? 'Solo Savings' : 'Savings Group');
    if (groupAvatarEl) {
      groupAvatarEl.innerHTML = Ipon.avatarMarkup(currentGroup.avatar_url, safeName, 'avatar-md');
      Ipon.bindAvatarFallbacks(groupAvatarEl);
    }
    if (groupNameEl) groupNameEl.textContent = safeName;
    if (groupModeEl) {
      groupModeEl.hidden = false;
      groupModeEl.textContent = isSolo ? 'SOLO' : 'GROUP';
      groupModeEl.classList.toggle('is-solo', isSolo);
      groupModeEl.classList.toggle('is-group', !isSolo);
    }
    if (groupRoleEl) {
      groupRoleEl.hidden = isSolo;
      groupRoleEl.textContent = currentGroup.role || state?.profile?.role || 'MEMBER';
      groupRoleEl.classList.remove('is-solo');
    }
    const contributorCount = Number(currentGroup.active_member_count || 0);
    const metaParts = isSolo
      ? ['Solo savings', 'Personal tracker']
      : [`${contributorCount} contributor${contributorCount === 1 ? '' : 's'}`];
    if (!isSolo && currentGroup.role === 'ADMIN') metaParts.push(currentGroup.is_contributor ? 'Included as contributor' : 'Manager only');
    if (groupMetaEl) groupMetaEl.textContent = metaParts.join(' · ');
    const canSwitchGroup = myGroups.length > 1;
    groupIdentityEl?.classList.toggle('is-switchable', canSwitchGroup);
    if (groupSelect && groupSwitcherWrap) {
      groupSwitcherWrap.hidden = !canSwitchGroup;
      Ipon.populateGroupSelect(groupSelect, myGroups, currentGroup.group_id);
    }
    if (groupActionsEl) groupActionsEl.hidden = false;
    syncGroupHub();
    if (currentGroup.role === 'ADMIN' && currentGroup.workspace_mode !== 'SOLO' && typeof Ipon.fetchInviteOverview === 'function') {
      Ipon.fetchInviteOverview().catch(() => { });
    }
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
    if (container === groupInviteRows) {
      const addBtn = document.getElementById('group-add-invite-row');
      if (addBtn) addBtn.textContent = rows.length ? '+ Add another' : '+ Add member';
    }
  }

  function setInviteRowCommitted(row, committed, summary = null) {
    if (!row) return;
    const isCommitted = Boolean(committed);
    row.classList.toggle('is-committed', isCommitted);
    row.dataset.committed = isCommitted ? 'true' : 'false';
    const grid = row.querySelector('.invite-row-grid');
    const actions = row.querySelector('.invite-row-actions');
    const summaryEl = row.querySelector('.invite-row-summary');
    const editBtn = row.querySelector('.invite-row-edit');
    const stateEl = row.querySelector('.invite-row-state');
    const commitBtn = row.querySelector('.invite-row-commit');
    if (grid) grid.hidden = isCommitted;
    if (actions) actions.hidden = isCommitted;
    if (summaryEl) summaryEl.hidden = !isCommitted;
    if (editBtn) editBtn.hidden = !isCommitted;
    if (stateEl) stateEl.hidden = !isCommitted;
    if (commitBtn) commitBtn.textContent = isCommitted || row.dataset.everCommitted === 'true' ? 'Done' : 'Add';
    if (isCommitted) {
      row.dataset.everCommitted = 'true';
      if (summaryEl && summary) {
        const emailOut = summaryEl.querySelector('.invite-row-summary-email');
        const metaOut = summaryEl.querySelector('.invite-row-summary-meta');
        if (emailOut) emailOut.textContent = summary.email;
        if (metaOut) {
          const amountText = typeof Ipon.money === 'function'
            ? Ipon.money(summary.monthly_contribution_amount)
            : `₱${Number(summary.monthly_contribution_amount || 0).toFixed(2)}`;
          const parts = [];
          if (summary.displayName) parts.push(summary.displayName);
          parts.push(`${amountText}/mo`);
          parts.push('Ready to invite');
          metaOut.textContent = parts.join(' · ');
        }
      }
    }
  }

  function validateInviteRow(row, { container = null, allowEmpty = false, seenEmails = null } = {}) {
    const emailEl = row.querySelector('[name="invite_email"]');
    const nameEl = row.querySelector('[name="invite_name"]');
    const amountEl = row.querySelector('[name="invite_amount"]');
    const passEl = row.querySelector('[name="invite_password"]');
    const email = emailEl.value.trim().toLowerCase();
    const name = nameEl.value.trim();
    const password = passEl.value;
    Ipon.setFieldError(emailEl, '');
    Ipon.setFieldError(nameEl, '');
    Ipon.setFieldError(amountEl, '');
    Ipon.setFieldError(passEl, '');
    if (allowEmpty && !email && !name) return { skip: true };
    const revealIfCollapsed = () => {
      if (row.classList.contains('is-committed')) setInviteRowCommitted(row, false);
    };
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      revealIfCollapsed();
      Ipon.setFieldError(emailEl, 'Enter a valid email address.');
      emailEl.focus();
      return { error: true };
    }
    const isDuplicate = seenEmails
      ? seenEmails.has(email)
      : Boolean(container && [...container.querySelectorAll('.invite-row-card')].some((other) => (
        other !== row && (other.querySelector('[name="invite_email"]')?.value || '').trim().toLowerCase() === email
      )));
    if (isDuplicate) {
      revealIfCollapsed();
      Ipon.setFieldError(emailEl, 'This email is already added to the invite list.');
      emailEl.focus();
      return { error: true };
    }
    const nameIssue = Ipon.fullNameValidationError(name, { required: false, live: false });
    if (nameIssue) {
      revealIfCollapsed();
      Ipon.setFieldError(nameEl, nameIssue);
      nameEl.focus();
      return { error: true };
    }
    const amountCheck = typeof Ipon.parseMoneyAmount === 'function'
      ? Ipon.parseMoneyAmount(amountEl.value, { min: 1, max: 1000000, required: true, label: 'Monthly share', badInput: Boolean(amountEl.validity?.badInput) })
      : { valid: Number(amountEl.value) >= 1 && Number(amountEl.value) <= 1000000, value: Number(amountEl.value), error: 'Enter a valid monthly share (₱1 to ₱1,000,000).' };
    if (!amountCheck.valid) {
      revealIfCollapsed();
      Ipon.setFieldError(amountEl, amountCheck.error || 'Enter a valid monthly share.');
      amountEl.focus();
      return { error: true };
    }
    const monthlyAmount = Number(amountCheck.value) > 0 ? Number(amountCheck.value) : 100;
    const pwIssue = Ipon.passwordIssue(password, [name, email.split('@')[0]]);
    if (pwIssue) {
      revealIfCollapsed();
      Ipon.setFieldError(passEl, pwIssue);
      passEl.focus();
      return { error: true };
    }
    if (seenEmails) seenEmails.add(email);
    const normalizedInviteName = Ipon.normalizeNamePart(name);
    const nameOptional = !normalizedInviteName;
    const parsed = nameOptional
      ? { first_name: null, middle_name: null, last_name: null }
      : parseFullNameParts(normalizedInviteName, email);
    return {
      skip: false,
      displayName: normalizedInviteName,
      payload: {
        role: 'MEMBER',
        create_member: true,
        name_optional: nameOptional,
        ...parsed,
        email,
        password,
        monthly_contribution_amount: monthlyAmount
      }
    };
  }

  function appendInviteRow(container, { defaultAmount = 100, required = false } = {}) {
    if (!container) return null;
    const row = document.createElement('div');
    row.className = 'invite-row-card';
    row.dataset.committed = 'false';
    row.innerHTML = `
      <div class="invite-row-head">
        <div class="invite-row-head-title">
          <span class="invite-row-badge">Member invite</span>
          <span class="invite-row-state" hidden>Added</span>
        </div>
        <div class="invite-row-head-actions">
          <button class="invite-row-edit" type="button" hidden>Edit</button>
          <button class="invite-row-remove" type="button" title="Remove member" aria-label="Remove invite row">&times;</button>
        </div>
      </div>
      <div class="invite-row-summary" hidden>
        <strong class="invite-row-summary-email"></strong>
        <small class="invite-row-summary-meta"></small>
      </div>
      <div class="invite-row-grid">
        <div class="field"><label>Email</label><input name="invite_email" type="email" autocomplete="off" maxlength="254" placeholder="member@example.com"${required ? ' required' : ''}></div>
        <div class="field"><label>Full name (optional)</label><input name="invite_name" type="text" maxlength="120" placeholder="e.g., Juan Dela Cruz"></div>
        <div class="field"><label>Monthly share</label><input name="invite_amount" type="number" min="1" max="1000000" step="0.01" value="${Ipon.escapeHtml(String(defaultAmount))}"></div>
        <div class="field"><label>Temporary password</label><input name="invite_password" type="password" minlength="8" maxlength="128" autocomplete="new-password" data-temp-password placeholder="Recommended or custom password"${required ? ' required' : ''}></div>
      </div>
      <div class="invite-row-actions">
        <button class="button button-primary invite-row-commit" type="button">Add</button>
      </div>
    `;
    const emailInput = row.querySelector('[name="invite_email"]');
    const passInput = row.querySelector('[name="invite_password"]');
    Ipon.prepareTemporaryPassword(passInput);
    Ipon.prepareInviteNameInput(row.querySelector('[name="invite_name"]'));
    Ipon.preparePesoInputs(row);
    emailInput?.addEventListener('input', () => {
      if (emailInput.hasAttribute('aria-invalid')) Ipon.setFieldError(emailInput, '');
    });
    passInput?.addEventListener('input', () => {
      if (passInput.hasAttribute('aria-invalid')) Ipon.setFieldError(passInput, '');
    });
    row.querySelector('.invite-row-commit').addEventListener('click', () => {
      const result = validateInviteRow(row, { container, allowEmpty: false });
      if (!result || result.error || result.skip) return;
      setInviteRowCommitted(row, true, { ...result.payload, displayName: result.displayName });
    });
    row.querySelector('.invite-row-edit').addEventListener('click', () => {
      setInviteRowCommitted(row, false);
      emailInput?.focus();
    });
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
    const seenEmails = new Set();
    const rows = [...(container?.querySelectorAll('.invite-row-card') || [])];
    for (const row of rows) {
      const result = validateInviteRow(row, { container, allowEmpty: allowEmptyRows, seenEmails });
      if (result.error) return null;
      if (result.skip) continue;
      entries.push(result.payload);
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

  function goalPrefStorageKey(groupId) {
    return groupId ? `myipon_dashboard_goal_${groupId}` : '';
  }
  function readSavedGoalPref(groupId) {
    const key = goalPrefStorageKey(groupId);
    if (!key) return null;
    try { return localStorage.getItem(key); } catch { return null; }
  }
  function writeSavedGoalPref(groupId, value) {
    const key = goalPrefStorageKey(groupId);
    if (!key) return;
    try { localStorage.setItem(key, String(value || '')); } catch { }
  }
  function monthIso(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`; }
  function renderGoalOptions(goals) {
    const goalOptions = (Array.isArray(goals) ? goals : []).map((goal) => ({
      id: goal.id,
      title: goal.title?.trim() || 'Untitled goal'
    }));
    const options = goalOptions.length
      ? [...goalOptions, { id: '', title: 'General savings' }]
      : [{ id: '', title: 'General savings' }];
    const activeGroupId = String(currentGroup?.group_id || state?.profile?.group_id || '');
    const savedPref = readSavedGoalPref(activeGroupId);
    if (savedPref !== null && options.some((goal) => goal.id === savedPref)) {
      selectedGoalId = savedPref;
    } else if (goalOptions.length && !options.some((goal) => goal.id === selectedGoalId && selectedGoalId)) {
      selectedGoalId = goalOptions[0].id;
    } else if (!options.some((goal) => goal.id === selectedGoalId)) {
      selectedGoalId = goalOptions[0]?.id || '';
    }
    goalSelects.forEach((select) => {
      if (!select) return;
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
  /** Collect unique status icons per day in consistent order so additions, deductions, expenses, and pending items appear side by side. */
  function dayEventStatuses(activities) {
    if (!activities.length) return [];
    const byClass = new Map();
    activities.forEach((activity) => {
      const [klass, label] = statusClass(activity);
      if (!byClass.has(klass)) byClass.set(klass, label);
    });
    const order = ['addition', 'deduction-event', 'expense-event', 'pending-event'];
    return order.filter((klass) => byClass.has(klass)).map((klass) => [klass, byClass.get(klass)]);
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
  function formatCalendarTileAmount(value) {
    const num = Math.abs(Number(value || 0));
    if (!Number.isFinite(num)) return Ipon.money(0);
    const whole = Math.round(num * 100) % 100 === 0;
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
  }
  function summarizeDayActivities(activities) {
    const list = Array.isArray(activities) ? activities : [];
    const dayEvents = dayEventStatuses(list);
    let confirmedAdd = 0;
    let confirmedDed = 0;
    let confirmedExp = 0;
    let pendingTotal = 0;
    let hasConfirmed = false;
    let hasPending = false;
    list.forEach((activity) => {
      const amt = Number(activity?.amount || 0);
      if (activity?.approval_status === 'PENDING') {
        hasPending = true;
        pendingTotal += amt;
        return;
      }
      if (activity?.approval_status === 'CONFIRMED') {
        hasConfirmed = true;
        if (activity.activity_type === 'DEDUCTION') confirmedDed += amt;
        else if (activity.activity_type === 'EXPENSE') confirmedExp += amt;
        else confirmedAdd += amt;
      }
    });
    const confirmedNet = confirmedAdd - confirmedDed - confirmedExp;
    const isMixed = dayEvents.length > 1;
    let toneClass = '';
    if (isMixed) {
      toneClass = 'is-mixed';
    } else if (dayEvents.length === 1) {
      const only = dayEvents[0][0];
      toneClass = only === 'addition'
        ? 'is-addition'
        : only === 'deduction-event'
          ? 'is-deduction'
          : only === 'expense-event'
            ? 'is-expense'
            : 'is-pending';
    }
    const sign = hasConfirmed ? (confirmedNet < 0 ? '−' : '+') : '';
    const amountClass = hasConfirmed
      ? (confirmedNet < 0 ? 'is-neg' : 'is-pos')
      : (hasPending ? 'is-pending' : '');
    const displayAmount = hasConfirmed ? Math.abs(confirmedNet) : pendingTotal;
    const segments = isMixed
      ? [
        { tone: 'addition', amount: confirmedAdd },
        { tone: 'deduction', amount: confirmedDed },
        { tone: 'expense', amount: confirmedExp },
        { tone: 'pending', amount: pendingTotal }
      ].filter((seg) => seg.amount > 0)
      : [];
    return {
      dayEvents,
      toneClass,
      isMixed,
      hasConfirmed,
      hasPending,
      confirmedAdd,
      confirmedDed,
      confirmedExp,
      confirmedNet,
      pendingTotal,
      sign,
      amountClass,
      displayAmount,
      segments
    };
  }
  function aggregateDayContributors(activities) {
    const byContributor = new Map();
    activities.filter((activity) => activity.activity_type === 'ADDITION').forEach((activity) => {
      const memberId = activity.subject_member_id ? String(activity.subject_member_id) : '';
      const linkedProfile = memberId ? groupProfileByMemberId.get(memberId) : null;
      const userId = linkedProfile?.id ? String(linkedProfile.id) : '';
      const name = activity.subject_name || linkedProfile?.full_name || 'Group member';
      const key = userId || memberId || name;
      if (!byContributor.has(key)) {
        byContributor.set(key, {
          key,
          userId,
          memberId,
          name,
          avatarUrl: linkedProfile?.avatar_url || activity.subject_avatar_url || '',
          totalAmount: 0,
          confirmedAmount: 0,
          pendingAmount: 0,
          count: 0,
          statuses: new Set(),
          paymentMethods: new Set(),
          notes: [],
          reviewNotes: [],
          entries: []
        });
      }
      const entry = byContributor.get(key);
      if (!entry.userId && userId) entry.userId = userId;
      if (!entry.memberId && memberId) entry.memberId = memberId;
      if (!entry.avatarUrl && (linkedProfile?.avatar_url || activity.subject_avatar_url)) {
        entry.avatarUrl = linkedProfile?.avatar_url || activity.subject_avatar_url;
      }
      const amt = Number(activity.amount || 0);
      entry.totalAmount += amt;
      if (activity.approval_status === 'PENDING') entry.pendingAmount += amt;
      else entry.confirmedAmount += amt;
      entry.count += 1;
      if (activity.approval_status) entry.statuses.add(activity.approval_status);
      entry.paymentMethods.add(Ipon.normalizePaymentMethod(activity.payment_method));
      if (activity.notes) entry.notes.push(activity.notes);
      if (activity.review_note) entry.reviewNotes.push(activity.review_note);
      entry.entries.push(activity);
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
        if (!cell || cell.empty) return '<span class="day is-empty" aria-hidden="true"></span>';
        const hasActivity = cell.activities.length > 0;
        const summary = summarizeDayActivities(cell.activities);
        const contributors = aggregateDayContributors(cell.activities);
        let avatarsHtml = '';
        if (contributors.length) {
          const visibleLimit = contributors.length > 3 ? 2 : 3;
          const shown = contributors.slice(0, visibleLimit).map((person) => {
            const safeName = Ipon.escapeHtml(person.name);
            const safeUid = Ipon.escapeHtml(person.userId || '');
            const safeAvatar = Ipon.escapeHtml(person.avatarUrl || '');
            const profileLabel = person.userId
              ? `View ${person.name}'s profile`
              : `${person.name} (no linked user profile)`;
            return `<button class="day-avatar-btn" type="button" data-profile-user-id="${safeUid}" data-profile-name="${safeName}" data-profile-avatar="${safeAvatar}" title="${safeName}" aria-label="${Ipon.escapeHtml(profileLabel)}">${Ipon.avatarMarkup(person.avatarUrl, person.name, 'day-avatar')}</button>`;
          }).join('');
          const overflowCount = contributors.length - visibleLimit;
          const overflow = overflowCount > 0
            ? `<span class="day-avatar day-avatar-more" title="${overflowCount} more contributor${overflowCount === 1 ? '' : 's'}">+${overflowCount}</span>`
            : '';
          avatarsHtml = `<span class="day-avatars">${shown}${overflow}</span>`;
        }
        let activityHtml = '';
        const dayEvents = hasActivity ? summary.dayEvents : [];
        if (hasActivity) {
          const eventsMarkup = dayEvents.map(([klass, label]) => `<span class="event ${klass}" title="${Ipon.escapeHtml(label)}" aria-label="${Ipon.escapeHtml(label)}">${eventIconMarkup(klass)}</span>`).join('');
          const moreCount = !contributors.length && cell.activities.length > 1 ? `<small class="more-count">+${cell.activities.length - 1}</small>` : '';
          const segsHtml = summary.segments.length > 1
            ? `<span class="day-segs" aria-hidden="true">${summary.segments.map((seg) => `<i class="seg-${seg.tone}" style="flex:${Math.max(1, Math.round(seg.amount))}"></i>`).join('')}</span>`
            : '';
          const amountMarkup = `<em class="day-amount ${summary.amountClass}">${summary.sign ? `<i>${summary.sign}</i>` : ''}${formatCalendarTileAmount(summary.displayAmount)}</em>`;
          activityHtml = `<span class="day-events${summary.isMixed ? ' is-mixed' : ''}">${eventsMarkup}</span>${avatarsHtml}${moreCount}${amountMarkup}${segsHtml}`;
        }
        const statusSummary = dayEvents.length ? `: ${dayEvents.map(([, label]) => label).join(', ')}` : '';
        const amountSummary = hasActivity
          ? (summary.hasConfirmed
            ? `, confirmed net ${summary.sign}${Ipon.money(summary.displayAmount)}${summary.hasPending ? `, pending ${Ipon.money(summary.pendingTotal)}` : ''}`
            : `, pending ${Ipon.money(summary.pendingTotal)}`)
          : '';
        const activityLabel = cell.activities.length
          ? `, ${cell.activities.length} recorded ${cell.activities.length === 1 ? 'activity' : 'activities'}${statusSummary}${amountSummary}`
          : ', no recorded activity';
        const isToday = cell.day === today.getDate() && cursor.getMonth() === today.getMonth() && cursor.getFullYear() === today.getFullYear();
        const classes = [
          'day',
          column === 0 ? 'sunday' : '',
          isToday ? 'is-today' : '',
          hasActivity ? 'has-activity' : '',
          summary.toneClass,
          contributors.length ? 'has-avatars' : ''
        ].filter(Boolean).join(' ');
        return `<div class="${classes}" role="button" tabindex="0" data-date="${cell.date}"${isToday ? ' aria-current="date"' : ''} aria-label="${Ipon.escapeHtml(`${monthName} ${cell.day}${isToday ? ', today' : ''}${activityLabel}`)}"><b>${cell.day}</b>${activityHtml}</div>`;
      }).join('');
    });
    Ipon.bindAvatarFallbacks(calendarCard);
  }
  function renderPending(items, count = items.length, total = items.reduce((sum, item) => sum + Number(item.amount), 0), changeRequests = []) {
    pendingItemsById = new Map((items || []).filter((item) => item?.id).map((item) => [item.id, item]));
    currentChangeRequests = Array.isArray(changeRequests) ? changeRequests : [];
    pendingChangesByRecord = new Map(currentChangeRequests.map((cr) => [`${cr.record_type}:${cr.record_id}`, cr]));
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
    if (changeRequestsWrap) {
      changeRequestsWrap.hidden = currentChangeRequests.length === 0;
      if (currentChangeRequests.length) {
        const canReviewCr = state?.profile?.role === 'ADMIN';
        changeRequestsWrap.innerHTML = `
          <div class="review-cr-head">
            <strong>Edit requests</strong>
            <span class="status status-pending">${currentChangeRequests.length} pending</span>
          </div>
          <div class="review-cr-list">
            ${currentChangeRequests.slice(0, 4).map((cr) => {
              const typeShort = cr.record_type === 'withdrawal' ? 'Deduct' : cr.record_type === 'expense' ? 'Expense' : 'Add';
              const isOwn = String(cr.requested_by || '') === String(state?.profile?.id || '');
              const disabled = !(canReviewCr || isOwn);
              return `
                <button class="review-cr-item" type="button" data-open-cr="${Ipon.escapeHtml(cr.id)}" ${disabled ? 'disabled' : ''}>
                  <span class="review-cr-copy">
                    <b>${Ipon.escapeHtml(cr.requested_by_name || cr.subject_name || 'Member')} · ${Ipon.escapeHtml(typeShort)}</b>
                    <small>${Ipon.escapeHtml(Ipon.money(cr.current_amount))} → ${Ipon.escapeHtml(Ipon.money(cr.proposed_amount))} · ${Ipon.escapeHtml(Ipon.paymentMethodMeta(cr.proposed_payment_method).label)}</small>
                    <small class="review-cr-reason">“${Ipon.escapeHtml(cr.reason || '')}”</small>
                  </span>
                  <span class="review-cr-cta">${canReviewCr ? 'Review' : isOwn ? 'Open' : 'Pending'}</span>
                </button>`;
            }).join('')}
          </div>`;
      } else {
        changeRequestsWrap.replaceChildren();
      }
    }
    const summary = document.querySelector('.review-summary');
    const crCount = currentChangeRequests.length;
    summary.querySelector('em').textContent = crCount > 0
      ? `${count} entry · ${crCount} edit request${crCount === 1 ? '' : 's'}`
      : `${count} item${count === 1 ? '' : 's'} for review`;
    summary.querySelector('strong').textContent = Ipon.money(total);
    if (bulkConfirmBtn) {
      const canBulk = state?.profile?.role === 'ADMIN' && ((items || []).some((item) => item.type === 'contribution') || count > (items || []).length);
      bulkConfirmBtn.hidden = !canBulk;
    }
  }
  async function getPending() {
    const { data, error } = await Ipon.client.rpc('get_pending_review_summary');
    if (error) throw error;
    return data || { count: 0, amount: 0, items: [], change_requests: [] };
  }
  function renderEmptySnapshot() {
    const total = document.querySelector('.tracked-total');
    renderHeroMoneyEl(total, 0, { smallTag: 'i' });
    total.classList.add('is-zero');
    renderSummaryBreakdown({
      summary: {
        total_additions: 0,
        total_deductions: 0,
        total_expenses: 0,
        additions_count: 0,
        deductions_count: 0,
        expenses_count: 0
      },
      pending: { amount: 0, count: 0 },
      isSolo: currentGroup?.workspace_mode === 'SOLO'
    });
    ['dashboard-members', 'dashboard-paid', 'dashboard-unpaid'].forEach((id) => { document.getElementById(id).textContent = '0'; });
    document.getElementById('dashboard-month-collected').textContent = Ipon.money(0);
    activeGoalsList = [];
    updateDashboardGoalProgress(0);
    renderGoalOptions([]);
    renderCalendar([]);
    renderPending([], 0, 0, []);
    if (walletStrip) walletStrip.hidden = true;
    announcements?.clear();
  }
  function renderWalletStrip(wallet) {
    if (!walletStrip) return;
    if (!wallet || !currentGroup || !state.profile?.group_id) {
      walletStrip.hidden = true;
      return;
    }
    walletStrip.hidden = false;
    renderHeroMoneyEl(walletCashEl, wallet.physical_cash_balance || 0, { smallTag: 'small' });
    renderHeroMoneyEl(walletDigitalEl, wallet.digital_wallet_balance || 0, { smallTag: 'small' });
    const otherAndUntagged = Number(wallet.other_balance || 0) + Number(wallet.untagged_balance || 0);
    if (walletUntaggedWrap && walletUntaggedEl) {
      walletUntaggedWrap.hidden = !wallet.has_untagged && otherAndUntagged === 0;
      renderHeroMoneyEl(walletUntaggedEl, otherAndUntagged, { smallTag: 'small' });
    }
  }
  function updateDashboardGoalProgress(trackedSavings) {
    const box = document.getElementById('dashboard-goal-box');
    if (!box) return;
    if (trackedSavings !== undefined && trackedSavings !== null && trackedSavings !== '' && Number.isFinite(Number(trackedSavings))) {
      lastTrackedSavings = Number(trackedSavings);
    }
    const tracked = Number(lastTrackedSavings || 0);
    let targetGoal = null;
    if (selectedGoalId) {
      targetGoal = activeGoalsList.find((g) => g.id === selectedGoalId);
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

    document.getElementById('dashboard-goal-label').textContent = targetGoal.title || 'Savings Goal';
    document.getElementById('dashboard-goal-fraction').textContent = `${Ipon.money(tracked)} / ${Ipon.money(target)} (${pctFormatted})`;
    document.getElementById('dashboard-goal-fill').style.width = `${pctClamped}%`;
    const remEl = document.getElementById('dashboard-goal-remaining');
    remEl.textContent = isReached ? '✓ Target achieved!' : `${Ipon.money(remaining)} remaining`;
    remEl.classList.toggle('is-reached', isReached);
    document.getElementById('dashboard-goal-pct').textContent = `${pctFormatted} reached`;

    const schedEl = document.getElementById('dashboard-goal-schedule');
    if (schedEl && typeof Ipon.computeGoalScheduleStatus === 'function') {
      const sched = Ipon.computeGoalScheduleStatus(targetGoal, { trackedSavings: tracked });
      if (sched.enabled) {
        const tone = sched.status === 'OVERDUE_CARRYOVER'
          ? 'is-overdue'
          : sched.status === 'DUE_NOW'
            ? 'is-unpaid'
            : sched.status === 'AHEAD_CREDIT'
              ? 'is-ahead'
              : sched.status === 'REACHED'
                ? 'is-reached'
                : 'is-ontrack';
        schedEl.className = `goal-schedule-strip dashboard-goal-schedule ${tone}`;
        const flagHtml = sched.isUnpaid
          ? '<span class="goal-schedule-flag">Unpaid</span>'
          : sched.status === 'AHEAD_CREDIT'
            ? '<span class="goal-schedule-flag">Paid ahead</span>'
            : '';
        const actionHtml = !sched.isReached && sched.nextAutoFillAmount > 0
          ? `<button class="icon-action is-deposit" type="button" data-record-goal-due="${Ipon.escapeHtml(targetGoal.id)}">+ Deposit ${Ipon.money(sched.nextAutoFillAmount)}</button>`
          : '';
        schedEl.innerHTML = `<div class="goal-schedule-strip-top"><span class="goal-schedule-pill">${Ipon.escapeHtml(sched.frequencyLabel)} · ${Ipon.money(sched.scheduledAmount)}/${Ipon.escapeHtml(sched.unitLabel)}</span>${flagHtml}${actionHtml}</div><p class="goal-schedule-summary">${Ipon.escapeHtml(sched.summaryLabel)}</p>`;
        schedEl.hidden = false;
      } else {
        schedEl.hidden = true;
        schedEl.innerHTML = '';
      }
    }
  }
  let initialLoadCompleted = false;
  let dashboardLoadPromise = null;
  let dashboardLoadQueued = false;
  async function load() {
    if (dashboardLoadPromise) {
      dashboardLoadQueued = true;
      return dashboardLoadPromise;
    }
    const run = (async () => {
    const start = monthIso(cursor), end = monthIso(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
    if (!state.configured || !state.profile) { renderEmptySnapshot(); return; }
    try {
      const shouldRefreshPerms = initialLoadCompleted && typeof Ipon.refreshMyPermissions === 'function';
      if (announcements) {
        announcements.load().catch((err) => console.warn('Announcement load error:', err));
      }
      const [summaryResult, calendarResult, pending, memberResult, progressResult, groupsResult, groupProfilesResult, allGoalsResult, walletResult, refreshedPerms] = await Promise.all([
        Ipon.client.rpc('get_savings_summary'),
        Ipon.client.from('v_savings_calendar').select('*').in('approval_status', ['CONFIRMED', 'PENDING']).gte('activity_date', start).lt('activity_date', end).order('activity_date'),
        getPending(),
        Ipon.client.from('members').select('id,full_name,monthly_contribution_amount,payout_channel,payout_account_number,payout_account_name', { count: 'exact' }).eq('status', 'ACTIVE').eq('activation_status', 'ACTIVE').is('deleted_at', null).order('full_name'),
        Ipon.client.from('v_contribution_status').select('member_id,payment_status,paid_amount').eq('period_month', start),
        Ipon.rpc('get_my_groups'),
        Ipon.client.rpc('get_group_member_identities').then(async (res) => (
          !res.error && Array.isArray(res.data)
            ? res
            : await Ipon.client.from('profiles').select('id,member_id,full_name,avatar_url').eq('status', 'ACTIVE')
        )),
        Ipon.client.from('savings_goals').select('id,title,target_amount,target_date,saving_frequency,scheduled_amount,schedule_start_date,schedule_baseline_amount,created_at').eq('status', 'ACTIVE').order('created_at', { ascending: false }),
        Ipon.client.rpc('get_wallet_reconciliation'),
        shouldRefreshPerms ? Ipon.refreshMyPermissions().catch(() => null) : Promise.resolve(null)
      ]);
      initialLoadCompleted = true;
      const normalizedGroups = Array.isArray(groupsResult) ? groupsResult : [];
      renderGroupHeader(normalizedGroups);
      if (currentGroup) {
        state.profile.group_id = currentGroup.group_id || state.profile.group_id;
        state.profile.role = currentGroup.role || state.profile.role;
        state.profile.member_id = currentGroup.member_id ?? null;
        state.profile.workspace_mode = currentGroup.workspace_mode || state.profile.workspace_mode;
      } else if (Array.isArray(groupsResult)) {
        state.profile.group_id = null;
        state.profile.member_id = null;
        state.profile.workspace_mode = null;
      }
      if (refreshedPerms) state.profile.permissions = refreshedPerms;
      if (summaryResult.error) throw summaryResult.error; if (calendarResult.error) throw calendarResult.error; if (memberResult.error) throw memberResult.error; if (progressResult.error) throw progressResult.error; if (allGoalsResult.error) throw allGoalsResult.error;
      if (!summaryResult.data && (state.profile?.group_id || currentGroup)) {
        throw new Error('Group savings summary is currently unavailable.');
      }
      const profilesList = groupProfilesResult?.data || [];
      Ipon.registerMemberAvatars(profilesList);
      groupProfileByMemberId = new Map(profilesList.filter((p) => p?.member_id && p?.id).map((p) => [String(p.member_id), p]));
      groupProfileById = new Map(profilesList.filter((p) => p?.id).map((p) => [String(p.id), p]));
      (memberResult.data || []).forEach((m) => {
        const prof = groupProfileByMemberId.get(String(m.id));
        if (prof?.avatar_url) m.avatar_url = prof.avatar_url;
        if (prof?.id) m.user_id = prof.id;
      });
      Ipon.registerMemberAvatars(memberResult.data || []);
      activeGoalsList = allGoalsResult?.data || [];
      const adminMember = (memberResult.data || []).find((m) => m.id === currentGroup?.member_id || m.id === state?.profile?.member_id);
      if (adminMember && Number(adminMember.monthly_contribution_amount) > 0) {
        currentAdminMonthlyAmount = Number(adminMember.monthly_contribution_amount);
        syncGroupHub();
      }
      const summary = summaryResult.data || {}; const total = document.querySelector('.tracked-total'); renderHeroMoneyEl(total, summary.tracked_savings, { smallTag: 'i' }); total.classList.toggle('is-zero', Number(summary.tracked_savings || 0) === 0);
      if (cycleBadge) {
        cycleBadge.hidden = !summary.cycle_start_date;
        if (summary.cycle_start_date) {
          cycleBadge.textContent = `Active cycle since ${Ipon.dateLabel(summary.cycle_start_date, { month: 'short', year: 'numeric' })}`;
        }
      }
      renderSummaryBreakdown({
        summary,
        pending,
        isSolo: currentGroup?.workspace_mode === 'SOLO'
      });
      const activeIds = new Set((memberResult.data || []).map((m) => m.id));
      const progress = (progressResult.data || []).filter((item) => activeIds.has(item.member_id) || Number(item.paid_amount || 0) > 0);
      const paid = progress.filter((item) => ['PAID', 'OVERPAID'].includes(item.payment_status)).length; const unpaid = progress.filter((item) => ['UNPAID', 'PARTIALLY PAID'].includes(item.payment_status)).length;
      const monthCollected = progress.reduce((sum, item) => sum + Number(item.paid_amount || 0), 0);
      document.getElementById('dashboard-members').textContent = memberResult.count ?? (memberResult.data?.length || 0); document.getElementById('dashboard-month-collected').textContent = Ipon.money(monthCollected); document.getElementById('dashboard-paid').textContent = paid; document.getElementById('dashboard-unpaid').textContent = unpaid;
      renderGoalOptions(activeGoalsList);
      if (remindUnpaidBtn) remindUnpaidBtn.hidden = !(unpaid > 0 && ['ADMIN', 'TREASURER'].includes(state.profile?.role));
      populateQuickRecordMembers(memberResult.data || []);
      updateDashboardGoalProgress(summary.tracked_savings ?? 0);
      renderWalletStrip(walletResult?.error ? null : walletResult?.data);
      renderCalendar(calendarResult.data || []);
      renderPending(pending.items || [], Number(pending.count || 0), Number(pending.amount || 0), pending.change_requests || []);
      if (dayModal?.open && openModalDate) {
        openDayModal(openModalDate);
      }
      hasSnapshot = true; dataStatus.hidden = true;
    } catch (error) {
      if (!hasSnapshot) {
        renderEmptySnapshot();
        renderSummaryBreakdown({ isSolo: currentGroup?.workspace_mode === 'SOLO', error: true });
        dataStatus.textContent = 'Dashboard data is unavailable. No financial snapshot could be loaded.';
        dataStatus.hidden = false;
      } else {
        dataStatus.textContent = '';
        dataStatus.hidden = true;
      }
      Ipon.toast(Ipon.friendlyError(error), 'error');
    }
    })().finally(() => {
      dashboardLoadPromise = null;
      if (dashboardLoadQueued) {
        dashboardLoadQueued = false;
        load();
      }
    });
    dashboardLoadPromise = run;
    return run;
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
    renderHeroMoneyEl(total, fixture.summary.tracked_savings, { smallTag: 'i' });
    const fixtureActivities = Array.isArray(fixture.activities) ? fixture.activities : [];
    const fixturePending = Array.isArray(fixture.pending) ? fixture.pending : [];
    renderSummaryBreakdown({
      summary: {
        ...fixture.summary,
        additions_count: fixtureActivities.filter((a) => a.activity_type === 'ADDITION' && a.approval_status === 'CONFIRMED').length,
        deductions_count: fixtureActivities.filter((a) => a.activity_type === 'DEDUCTION' && a.approval_status === 'CONFIRMED').length,
        expenses_count: fixtureActivities.filter((a) => a.activity_type === 'EXPENSE' && a.approval_status === 'CONFIRMED').length
      },
      pending: {
        amount: fixturePending.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        count: fixturePending.length
      },
      isSolo: false
    });
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
      id: item.id,
      type: item.type,
      typeLabel: item.entry_label || typeLabel,
      authorName: item.member_name || 'Group member',
      submittedByName: item.submitted_by_name || '',
      avatarUrl: item.avatar_url || '',
      amount: item.amount,
      date: item.date,
      periodMonth: item.period_month || '',
      category: item.category || '',
      paymentMethod: item.payment_method || '',
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
        ? items.map((activity) => { const [, label] = statusClass(activity); const detailText = [activity.notes, activity.review_note ? `Review note: ${activity.review_note}` : ''].filter(Boolean).join(' · '); return `<article><span><b>${Ipon.escapeHtml(label)}</b><small>${Ipon.escapeHtml([activity.subject_name, activity.approval_status].filter(Boolean).join(' · '))}</small><div class="day-detail-badges">${Ipon.paymentMethodBadge(activity.payment_method)}</div></span><strong>${Ipon.money(activity.amount)}</strong>${detailText ? `<p>${Ipon.escapeHtml(detailText)}</p>` : ''}</article>`; }).join('')
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

  function activityRecordType(activity) {
    if (activity?.activity_type === 'DEDUCTION') return 'withdrawal';
    if (activity?.activity_type === 'EXPENSE') return 'expense';
    return 'contribution';
  }

  function canEditCalendarEntry(activity) {
    if (!activity || !['CONFIRMED', 'PENDING'].includes(activity.approval_status)) return false;
    const role = String(state?.profile?.role || 'MEMBER').toUpperCase();
    if (role === 'ADMIN') return true;
    const perms = state?.profile?.permissions || Ipon.defaultPermissionsForRole(role);
    if (perms.can_edit_own_entries === false) return false;
    const actType = activityRecordType(activity);
    const uid = String(state?.profile?.id || '');
    const ownMemberId = String(state?.profile?.member_id || '');
    if (uid && String(activity.submitted_by || '') === uid) return true;
    if (actType === 'contribution' && ownMemberId && String(activity.subject_member_id || '') === ownMemberId) return true;
    return false;
  }

  function pendingEditChipMarkup(activity) {
    const recType = activityRecordType(activity);
    const cr = pendingChangesByRecord.get(`${recType}:${activity.id}`);
    if (!cr) return '';
    const isAdmin = String(state?.profile?.role || '').toUpperCase() === 'ADMIN';
    const isOwn = String(cr.requested_by || '') === String(state?.profile?.id || '');
    const methodLabel = Ipon.paymentMethodMeta(cr.proposed_payment_method).label;
    const btn = isAdmin
      ? `<button class="button button-primary button-xs" type="button" data-review-cr="${Ipon.escapeHtml(cr.id)}">Review change</button>`
      : isOwn
        ? `<button class="button button-secondary button-xs" type="button" data-review-cr="${Ipon.escapeHtml(cr.id)}">View / Withdraw</button>`
        : '<span class="status status-pending">Change requested</span>';
    return `
      <div class="day-entry-pending-strip">
        <div class="day-entry-pending-copy">
          <strong>Change requested: ${Ipon.escapeHtml(Ipon.money(cr.current_amount))} → ${Ipon.escapeHtml(Ipon.money(cr.proposed_amount))} · ${Ipon.escapeHtml(methodLabel)}</strong>
          <small>Reason: “${Ipon.escapeHtml(cr.reason || '')}”</small>
        </div>
        ${btn}
      </div>`;
  }

  function editEntryButtonMarkup(activity) {
    const recType = activityRecordType(activity);
    if (pendingChangesByRecord.has(`${recType}:${activity.id}`) || !canEditCalendarEntry(activity)) return '';
    return `<button class="day-entry-edit-btn" type="button" data-edit-record-type="${recType}" data-edit-record-id="${Ipon.escapeHtml(activity.id)}" aria-label="Edit entry amount or payment method"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"/></svg><span>Edit</span></button>`;
  }

  function openDayModal(date) {
    if (!dayModal) return;
    detailPanel.hidden = true;
    activeDate = null;
    openModalDate = date;
    const items = currentActivities.filter((activity) => activity.activity_date === date);
    const contributors = aggregateDayContributors(items);
    const others = items.filter((activity) => activity.activity_type !== 'ADDITION');
    const contributionTotal = contributors.reduce((sum, person) => sum + person.totalAmount, 0);
    dayModalTitle.textContent = Ipon.dateLabel(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const summaryParts = [];
    if (contributors.length) {
      summaryParts.push(`${contributors.length} contributor${contributors.length === 1 ? '' : 's'} · ${Ipon.money(contributionTotal)} total contributions`);
    }
    if (others.length) {
      const otherTotal = others.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      summaryParts.push(`${others.length} other entr${others.length === 1 ? 'y' : 'ies'} (−${Ipon.money(otherTotal)})`);
    }
    dayModalSubtitle.textContent = summaryParts.length
      ? summaryParts.join(' · ')
      : 'No recorded contributions on this day.';
    const contributorsHtml = contributors.length ? `
      <section class="day-modal-section">
        <h3>Contributors (${contributors.length})</h3>
        <div class="day-contributor-list">
          ${contributors.map((person) => {
            const entries = Array.isArray(person.entries) ? person.entries : [];
            const singleEntry = entries.length === 1 ? entries[0] : null;
            const statuses = [...person.statuses].map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(', ');
            const isPendingOnly = person.statuses.size > 0 && [...person.statuses].every((s) => s === 'PENDING');
            const methodBadges = [...person.paymentMethods].map((pm) => Ipon.paymentMethodBadge(pm)).join('');
            const notes = person.notes.length ? `<p class="day-contributor-notes">${Ipon.escapeHtml(person.notes.join(' · '))}</p>` : '';
            const reviewNotes = person.reviewNotes.length ? `<small class="record-reason-note is-confirmed">Review note: ${Ipon.escapeHtml(person.reviewNotes.join(' · '))}</small>` : '';
            const singleEditBtn = singleEntry ? editEntryButtonMarkup(singleEntry) : '';
            const singlePendingStrip = singleEntry ? pendingEditChipMarkup(singleEntry) : '';
            const verifiedHtml = person.userId ? (Ipon.verifiedBadgesHtml?.(person.userId) || '') : '';
            const avatarBtnLabel = person.userId
              ? `View ${person.name}'s profile`
              : `${person.name} (no linked user profile)`;
            const multiListHtml = !singleEntry && entries.length > 1 ? `
              <div class="day-entry-sublist">
                ${entries.map((entry) => {
                  const stLabel = entry.approval_status ? (entry.approval_status.charAt(0) + entry.approval_status.slice(1).toLowerCase()) : 'Confirmed';
                  const subPendingOnly = entry.approval_status === 'PENDING';
                  const subEdit = editEntryButtonMarkup(entry);
                  const subPending = pendingEditChipMarkup(entry);
                  return `<div class="day-entry-subrow">
                    <div class="day-entry-subrow-main">
                      <div class="day-entry-subrow-meta">
                        ${Ipon.paymentMethodBadge(entry.payment_method)}
                        <small>${Ipon.escapeHtml(stLabel)}</small>
                        ${entry.notes ? `<small class="day-entry-subrow-note">· ${Ipon.escapeHtml(entry.notes)}</small>` : ''}
                      </div>
                      <div class="day-entry-subrow-right">
                        <strong class="day-entry-subrow-amt${subPendingOnly ? ' is-pending' : ''}">${subPendingOnly ? '' : '+'}${Ipon.money(entry.amount)}</strong>
                        ${subEdit}
                      </div>
                    </div>
                    ${subPending}
                  </div>`;
                }).join('')}
              </div>` : '';
            return `<article class="day-contributor-row">
              <button class="day-modal-avatar-btn" type="button" data-profile-user-id="${Ipon.escapeHtml(person.userId || '')}" data-profile-name="${Ipon.escapeHtml(person.name)}" data-profile-avatar="${Ipon.escapeHtml(person.avatarUrl || '')}" aria-label="${Ipon.escapeHtml(avatarBtnLabel)}" title="${Ipon.escapeHtml(person.name)}">${Ipon.avatarMarkup(person.avatarUrl, person.name, 'avatar-md')}</button>
              <div class="day-contributor-info">
                <strong>${Ipon.escapeHtml(person.name)}${verifiedHtml}</strong>
                <small>${person.count} contribution${person.count === 1 ? '' : 's'} · ${Ipon.escapeHtml(statuses)}</small>
                ${singleEntry ? `<div class="day-contributor-badges">${methodBadges}</div>${notes}${reviewNotes}` : ''}
              </div>
              <div class="day-contributor-side">
                <strong class="day-contributor-amount${isPendingOnly ? ' is-pending' : ''}">${isPendingOnly ? '' : '+'}${Ipon.money(person.totalAmount)}</strong>
                ${singleEditBtn}
              </div>
              ${singlePendingStrip ? `<div class="day-contributor-extra">${singlePendingStrip}</div>` : ''}
              ${multiListHtml ? `<div class="day-contributor-extra">${multiListHtml}</div>` : ''}
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
            const isPending = activity.approval_status === 'PENDING';
            const editBtn = editEntryButtonMarkup(activity);
            const pendingStrip = pendingEditChipMarkup(activity);
            return `<article class="day-contributor-row">
              ${Ipon.avatarMarkup('', activity.subject_name || label, 'avatar-md')}
              <div class="day-contributor-info">
                <strong>${Ipon.escapeHtml(activity.subject_name || label)}</strong>
                <small>${Ipon.escapeHtml([label, activity.approval_status].filter(Boolean).join(' · '))}</small>
                <div class="day-contributor-badges">${Ipon.paymentMethodBadge(activity.payment_method)}</div>
                ${activity.notes ? `<p class="day-contributor-notes">${Ipon.escapeHtml(activity.notes)}</p>` : ''}
                ${activity.review_note ? `<small class="record-reason-note is-confirmed">Review note: ${Ipon.escapeHtml(activity.review_note)}</small>` : ''}
              </div>
              <div class="day-contributor-side">
                <strong class="day-contributor-amount ${isPending ? 'is-pending' : 'is-deduction'}">${isPending ? '' : '−'}${Ipon.money(activity.amount)}</strong>
                ${editBtn}
              </div>
              ${pendingStrip ? `<div class="day-contributor-extra">${pendingStrip}</div>` : ''}
            </article>`;
          }).join('')}
        </div>
      </section>` : '';
    const hasActiveGroup = Boolean(currentGroup && state?.profile?.group_id);
    dayModalBody.innerHTML = items.length
      ? `${contributorsHtml}${othersHtml}`
      : hasActiveGroup
        ? '<div class="day-modal-empty"><p>No contributions or activity recorded for this day.</p><button class="button button-primary" type="button" data-action="quick-record-day">+ Record entry</button></div>'
        : '<div class="day-modal-empty"><p>Join or create a savings group before recording entries for this day.</p><button class="button button-primary" type="button" data-action="create-group-from-day">+ Create savings group</button></div>';
    Ipon.bindAvatarFallbacks(dayModalBody);
    if (!dayModal.open) dayModal.showModal();
  }

  changeRequestsWrap?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-open-cr]');
    if (!btn) return;
    const cr = currentChangeRequests.find((item) => String(item.id) === String(btn.dataset.openCr));
    if (!cr) return;
    Ipon.openChangeRequestReviewDialog(cr, {
      allowReview: state?.profile?.role === 'ADMIN',
      onReviewed: load
    });
  });

  const board = document.querySelector('.calendar-board') || document.querySelector('.comp-frame');
  board.addEventListener('pointermove', (event) => {
    if (dayModal?.open) return;
    if (event.target.closest('.day-avatar-btn')) {
      detailPanel.hidden = true;
      activeDate = null;
      return;
    }
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
    if (event.target.closest('.day-avatar-btn')) {
      detailPanel.hidden = true;
      activeDate = null;
      return;
    }
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
    const avatarBtn = event.target.closest('.day-avatar-btn');
    if (avatarBtn) {
      event.preventDefault();
      event.stopPropagation();
      detailPanel.hidden = true;
      activeDate = null;
      Ipon.openMemberProfileDialog?.(avatarBtn.dataset.profileUserId || '', {
        fullName: avatarBtn.dataset.profileName || '',
        avatarUrl: avatarBtn.dataset.profileAvatar || '',
        triggerEl: avatarBtn
      });
      return;
    }
    const day = event.target.closest('.day[data-date]');
    if (!day) return;
    openDayModal(day.dataset.date);
  });
  board.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('.day-avatar-btn')) return;
    const day = event.target.closest('.day[data-date]');
    if (!day) return;
    event.preventDefault();
    openDayModal(day.dataset.date);
  });
  document.getElementById('day-modal-close')?.addEventListener('click', () => { openModalDate = null; dayModal?.close(); });
  dayModal?.addEventListener('click', (event) => { if (event.target === dayModal) { openModalDate = null; dayModal.close(); } });
  dayModal?.addEventListener('close', () => { openModalDate = null; });
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
  groupIdentityEl?.addEventListener('click', (e) => {
    if (!groupIdentityEl.classList.contains('is-switchable') || !groupSwitcherWrap || groupSwitcherWrap.hidden) return;
    if (e.target.closest('#dashboard-group-switcher-wrap')) return;
    const trigger = groupSwitcherWrap.querySelector('.custom-select-trigger');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger.click();
  });
  groupHubSelect?.addEventListener('change', () => handleGroupSwitch(groupHubSelect));
  document.getElementById('dashboard-manage-group')?.addEventListener('click', () => {
    syncGroupHub();
    groupHubDialog?.showModal();
    if (currentGroup?.role === 'ADMIN' && currentGroup?.workspace_mode !== 'SOLO') {
      const fetchFn = typeof Ipon.fetchInviteOverview === 'function'
        ? () => Ipon.fetchInviteOverview({ force: true })
        : () => Ipon.rpc('get_group_invite_overview', {});
      fetchFn().then((res) => {
        const badgeEl = document.getElementById('group-hub-requests-badge');
        const count = Array.isArray(res?.pending_requests) ? res.pending_requests.length : 0;
        if (badgeEl) {
          badgeEl.hidden = count === 0;
          badgeEl.textContent = `${count} pending`;
        }
      }).catch(() => { });
    }
  });
  document.getElementById('close-group-hub-dialog')?.addEventListener('click', () => groupHubDialog?.close());
  document.getElementById('done-group-hub-dialog')?.addEventListener('click', () => groupHubDialog?.close());
  document.getElementById('group-hub-create-another')?.addEventListener('click', () => {
    groupHubDialog?.close();
    openGroupDialog('create');
  });

  function selectedGroupDeleteMode() {
    return groupDeleteForm?.querySelector('input[name="group_delete_mode"]:checked')?.value === 'delete'
      ? 'delete'
      : 'transfer';
  }

  function syncGroupDeleteMode() {
    const mode = selectedGroupDeleteMode();
    const isDelete = mode === 'delete';
    if (groupTransferPanel) groupTransferPanel.hidden = isDelete;
    if (groupDeletePanel) groupDeletePanel.hidden = !isDelete;
    if (groupTransferMemberSelect) groupTransferMemberSelect.disabled = isDelete || !groupTransferMemberSelect.options.length;
    if (groupDeleteConfirmInput) groupDeleteConfirmInput.required = isDelete;
    if (groupDeleteSubmitBtn) {
      groupDeleteSubmitBtn.textContent = isDelete ? 'Delete group permanently' : 'Transfer & leave group';
      groupDeleteSubmitBtn.classList.toggle('button-danger', isDelete);
      groupDeleteSubmitBtn.classList.toggle('button-primary', !isDelete);
      groupDeleteSubmitBtn.disabled = !isDelete && (!groupTransferMemberSelect || !groupTransferMemberSelect.options.length);
    }
    Ipon.setFieldError(groupTransferMemberSelect, '');
    Ipon.setFieldError(groupDeleteConfirmInput, '');
  }

  async function openGroupDeleteDialog() {
    if (!groupDeleteDialog || !groupDeleteForm || !currentGroup) return;
    groupHubDialog?.close();
    const safeName = currentGroup.name || 'this group';
    if (groupDeleteNameEl) groupDeleteNameEl.textContent = safeName;
    if (groupDeleteExpectedNameEl) groupDeleteExpectedNameEl.textContent = safeName;
    if (groupDeleteConfirmInput) {
      groupDeleteConfirmInput.value = '';
      groupDeleteConfirmInput.placeholder = safeName;
    }
    const transferRadio = groupDeleteForm.querySelector('input[name="group_delete_mode"][value="transfer"]');
    if (transferRadio) transferRadio.checked = true;
    if (groupTransferMemberSelect) {
      groupTransferMemberSelect.innerHTML = '';
      groupTransferMemberSelect.disabled = true;
    }
    if (groupTransferEmpty) groupTransferEmpty.hidden = true;
    syncGroupDeleteMode();
    groupDeleteDialog.showModal();

    try {
      const accounts = await Ipon.rpc('get_group_access_list');
      const candidates = (accounts || []).filter((acc) => acc.user_id !== state?.profile?.id && acc.status === 'ACTIVE');
      if (groupTransferMemberSelect) {
        groupTransferMemberSelect.replaceChildren();
        candidates.forEach((acc) => {
          const opt = document.createElement('option');
          opt.value = acc.user_id;
          const labelName = acc.full_name || acc.member_name || acc.email || 'Group member';
          opt.textContent = `${labelName} · ${acc.role}${acc.email ? ` (${acc.email})` : ''}`;
          opt.dataset.displayName = labelName;
          groupTransferMemberSelect.append(opt);
        });
      }
      if (groupTransferEmpty) groupTransferEmpty.hidden = candidates.length > 0;
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      syncGroupDeleteMode();
    }
  }

  document.getElementById('group-hub-delete-btn')?.addEventListener('click', openGroupDeleteDialog);
  document.getElementById('close-group-delete-dialog')?.addEventListener('click', () => groupDeleteDialog?.close());
  document.getElementById('cancel-group-delete-dialog')?.addEventListener('click', () => groupDeleteDialog?.close());
  groupDeleteForm?.addEventListener('change', (event) => {
    if (event.target?.name === 'group_delete_mode') syncGroupDeleteMode();
  });
  groupDeleteConfirmInput?.addEventListener('input', () => Ipon.setFieldError(groupDeleteConfirmInput, ''));

  groupDeleteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentGroup) return;
    const mode = selectedGroupDeleteMode();
    const safeName = currentGroup.name || 'this group';
    const button = groupDeleteSubmitBtn || event.submitter;

    if (mode === 'transfer') {
      const targetUserId = groupTransferMemberSelect?.value || '';
      if (!targetUserId) {
        Ipon.setFieldError(groupTransferMemberSelect, 'Select an active member to receive administrator ownership.');
        groupTransferMemberSelect?.focus();
        return;
      }
      const selectedOption = groupTransferMemberSelect.selectedOptions?.[0];
      const targetName = selectedOption?.dataset?.displayName || selectedOption?.textContent || 'the selected member';
      const confirmed = await Ipon.confirmAction({
        title: 'Transfer admin role & leave group?',
        message: `${targetName} will become administrator of "${safeName}", and your access to this group will be removed.`,
        acceptLabel: 'Transfer & leave'
      });
      if (!confirmed) return;

      Ipon.setBusy(button, true, 'Transferring…');
      try {
        await Ipon.rpc('admin_transfer_and_leave_group', {
          p_group_id: currentGroup.group_id,
          p_new_admin_user_id: targetUserId
        });
        groupDeleteDialog?.close();
        Ipon.toast(`Ownership of "${safeName}" transferred to ${targetName}.`);
        location.reload();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(button, false);
      }
      return;
    }

    const typedName = String(groupDeleteConfirmInput?.value || '').trim();
    if (typedName.toLowerCase() !== safeName.trim().toLowerCase()) {
      Ipon.setFieldError(groupDeleteConfirmInput, `Type "${safeName}" to confirm permanent deletion.`);
      groupDeleteConfirmInput?.focus();
      return;
    }

    const confirmed = await Ipon.confirmAction({
      title: `Permanently delete "${safeName}"?`,
      message: 'This will permanently erase the group along with all members, contributions, deductions, expenses, goals, and announcements. This cannot be undone.',
      acceptLabel: 'Delete permanently'
    });
    if (!confirmed) return;

    Ipon.setBusy(button, true, 'Deleting…');
    try {
      await Ipon.rpc('admin_delete_group', {
        p_group_id: currentGroup.group_id,
        p_confirm_name: typedName
      });
      groupDeleteDialog?.close();
      Ipon.toast(`"${safeName}" has been permanently deleted.`);
      location.reload();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
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

  const groupCreateJoinMount = document.getElementById('group-create-join-mount');
  const groupModeJoinTab = document.getElementById('group-mode-join-tab');
  const groupModeLabelEl = document.getElementById('group-workspace-mode-label');

  function syncGroupFormWorkspaceMode(nextMode, isCreate) {
    const mode = nextMode === 'JOIN' && isCreate
      ? 'JOIN'
      : (nextMode === 'SOLO' ? 'SOLO' : 'GROUP');
    const isJoin = mode === 'JOIN';
    const isSolo = mode === 'SOLO';
    if (groupModeJoinTab) groupModeJoinTab.hidden = !isCreate;
    if (groupWorkspaceModeTabs) groupWorkspaceModeTabs.classList.toggle('is-three', isCreate);
    if (groupModeLabelEl) groupModeLabelEl.textContent = isCreate ? 'Workspace option' : 'Saving mode';
    if (groupWorkspaceModeInput && !isJoin) groupWorkspaceModeInput.value = mode;
    groupWorkspaceModeTabs?.querySelectorAll('[data-workspace-mode]').forEach((btn) => {
      const active = btn.dataset.workspaceMode === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (groupWorkspaceModeHelp) {
      groupWorkspaceModeHelp.textContent = isJoin
        ? 'Join an existing savings group using a 6-character code or invite link shared by its admin.'
        : (isSolo
          ? 'Personal savings tracker — no invitations needed. Standard 90-day reminder and 6-month inactivity retention applies.'
          : 'Save together with invited members and treasurers. Standard 90-day reminder and 6-month inactivity retention applies.');
    }
    const formTitle = document.getElementById('group-form-title');
    const formCopy = document.getElementById('group-form-copy');
    if (isJoin) {
      if (formTitle) formTitle.textContent = 'Join savings group';
      if (formCopy) formCopy.textContent = 'Enter a 6-character code or paste an invite link.';
      if (groupForm) groupForm.hidden = true;
      if (groupCreateJoinMount) {
        groupCreateJoinMount.hidden = false;
        const panel = Ipon.mountJoinGroupPanel?.(groupCreateJoinMount, {
          onCancel: () => groupDialog?.close(),
          onJoined: async (res) => {
            if (res?.status === 'JOINED') {
              window.location.href = Ipon.homeForRole(res.role || 'MEMBER');
            } else {
              await load();
            }
          }
        });
        panel?.focus?.();
      }
      return;
    }
    if (groupCreateJoinMount) {
      groupCreateJoinMount.hidden = true;
      groupCreateJoinMount.replaceChildren();
    }
    if (groupForm) groupForm.hidden = false;
    const submitBtn = document.getElementById('save-group-dialog');
    if (formTitle) {
      formTitle.textContent = isCreate
        ? (isSolo ? 'Create solo savings tracker' : 'Create savings group')
        : (isSolo ? 'Edit solo tracker' : 'Edit group');
    }
    if (formCopy) {
      formCopy.textContent = isCreate
        ? (isSolo
          ? 'Name your personal tracker, add an optional icon, and set your monthly target. No invitations needed.'
          : 'Set a group name, optional group picture, your contributor preference, and optional member invites.')
        : 'Update your workspace name, picture, saving mode, and contributor settings.';
    }
    if (submitBtn) {
      submitBtn.textContent = isCreate ? (isSolo ? 'Create solo tracker' : 'Create group') : 'Save changes';
    }
    if (groupDpLabel) groupDpLabel.textContent = isSolo ? 'Tracker picture (optional)' : 'Group picture (optional)';
    if (groupNameLabel) groupNameLabel.textContent = isSolo ? 'Tracker name' : 'Group name';
    if (groupForm?.elements?.name) {
      groupForm.elements.name.placeholder = isSolo ? 'e.g., My Emergency Fund' : 'e.g., Family Savings Fund';
    }
    if (groupNameHelp) {
      groupNameHelp.textContent = isSolo
        ? 'Displayed at the top of your personal savings dashboard.'
        : 'Displayed at the top of this workspace and in invite emails.';
    }
    if (groupMonthlyLabel) groupMonthlyLabel.textContent = isSolo ? 'Monthly savings goal (₱)' : 'Monthly contribution amount';
    if (groupSelfWrap) groupSelfWrap.hidden = isSolo;
    if (isSolo) {
      if (groupSelfToggle) groupSelfToggle.checked = true;
      if (groupMonthlyWrap) groupMonthlyWrap.hidden = false;
      if (groupMonthlyInput) groupMonthlyInput.required = true;
      if (groupInviteSection) groupInviteSection.hidden = true;
    } else {
      const includeOn = Boolean(groupSelfToggle?.checked);
      if (groupMonthlyWrap) groupMonthlyWrap.hidden = !includeOn;
      if (groupMonthlyInput) groupMonthlyInput.required = includeOn;
      if (groupInviteSection) groupInviteSection.hidden = !isCreate;
    }
  }

  const groupDirty = Ipon.bindDirtySaveForm?.(groupForm, document.getElementById('save-group-dialog'), {
    getActive: () => groupForm?.elements?.mode?.value !== 'create',
    getExtraState: () => ({ pendingGroupAvatarUrl: pendingGroupAvatarUrl || '', pendingGroupClearAvatar: Boolean(pendingGroupClearAvatar) })
  });

  groupWorkspaceModeTabs?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-workspace-mode]');
    if (!btn || !groupForm) return;
    const isCreate = groupForm.elements.mode.value === 'create';
    syncGroupFormWorkspaceMode(btn.dataset.workspaceMode, isCreate);
    groupDirty?.sync();
  });

  function readPreWorkspaceCalculatorPlan() {
    if (!state?.profile?.id || state.profile.group_id) return null;
    try {
      const raw = localStorage.getItem(`ipon:calc-plans:group:${state.profile.id}`);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed) || !parsed.length) return null;
      const first = parsed[0];
      if (!first || !(Number(first.targetAmount) > 0)) return null;
      return first;
    } catch {
      return null;
    }
  }

  function openGroupDialog(mode, presetWorkspaceMode = null) {
    if (!groupDialog || !groupForm) return;
    groupForm.reset();
    groupForm.elements.mode.value = mode;
    Ipon.setFieldError?.(groupForm.elements.name, '');
    Ipon.setFieldError?.(groupMonthlyInput, '');
    const isCreate = mode === 'create';
    const initialWorkspaceMode = isCreate
      ? (presetWorkspaceMode === 'JOIN' ? 'JOIN' : (presetWorkspaceMode === 'SOLO' ? 'SOLO' : 'GROUP'))
      : (currentGroup?.workspace_mode === 'SOLO' ? 'SOLO' : 'GROUP');
    pendingGroupAvatarUrl = isCreate ? null : (currentGroup?.avatar_url || null);
    pendingGroupClearAvatar = false;
    groupForm.elements.name.value = isCreate ? '' : (currentGroup?.name || '');
    const initialIncludeSelf = isCreate || initialWorkspaceMode === 'SOLO' ? true : Boolean(currentGroup?.is_contributor);
    groupSelfToggle.checked = initialIncludeSelf;
    groupMonthlyInput.value = isCreate ? '' : String(currentAdminMonthlyAmount || '');
    groupInviteRows.replaceChildren();
    if (isCreate) syncInviteRemoveButtons(groupInviteRows, false);
    syncGroupFormWorkspaceMode(initialWorkspaceMode, isCreate);
    renderGroupDpPreview(pendingGroupAvatarUrl, groupForm.elements.name.value || (isCreate ? 'New Workspace' : currentGroup?.name));
    groupDirty?.reset();
    groupDialog.showModal();
    if (initialWorkspaceMode !== 'JOIN') groupForm.elements.name.focus();
  }
  Ipon.guardMoneyInput?.(groupMonthlyInput, { min: 1, max: 1000000, required: false, label: 'Monthly contribution amount' });
  groupForm?.elements?.name?.addEventListener('input', () => {
    const el = groupForm.elements.name;
    const val = String(el.value || '').trim();
    const err = val && (val.length < 2 || val.length > 150) ? 'Workspace name must be between 2 and 150 characters.' : '';
    el.setCustomValidity?.(err);
    Ipon.setFieldError?.(el, err);
  });
  groupSelfToggle?.addEventListener('change', () => {
    if (groupWorkspaceModeInput?.value === 'SOLO') {
      groupSelfToggle.checked = true;
      groupMonthlyWrap.hidden = false;
      groupMonthlyInput.required = true;
      return;
    }
    const on = groupSelfToggle.checked;
    groupMonthlyWrap.hidden = !on;
    groupMonthlyInput.required = on;
    if (!on) Ipon.setFieldError?.(groupMonthlyInput, '');
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
          groupDirty?.sync();
        }
      });
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    }
  });
  groupDpRemove?.addEventListener('click', async () => {
    if (!pendingGroupAvatarUrl) return;
    const accepted = await Ipon.confirmAction({
      title: 'Remove workspace picture?',
      message: 'Are you sure you want to remove the workspace display picture?',
      acceptLabel: 'Remove'
    });
    if (!accepted) return;
    pendingGroupAvatarUrl = null;
    pendingGroupClearAvatar = true;
    renderGroupDpPreview(null, groupForm.elements.name.value || 'Workspace');
    groupDirty?.sync();
  });
  document.getElementById('group-add-invite-row')?.addEventListener('click', () => {
    const row = appendInviteRow(groupInviteRows, { defaultAmount: Number(groupMonthlyInput.value) > 0 ? Number(groupMonthlyInput.value) : 100, required: false });
    row?.querySelector('[name="invite_email"]')?.focus();
  });
  document.getElementById('dashboard-edit-group')?.addEventListener('click', () => {
    groupHubDialog?.close();
    openGroupDialog('edit');
  });
  document.getElementById('dashboard-create-group')?.addEventListener('click', () => openGroupDialog('create', 'GROUP'));
  document.getElementById('no-group-solo-btn')?.addEventListener('click', () => openGroupDialog('create', 'SOLO'));
  document.getElementById('no-group-create-btn')?.addEventListener('click', () => openGroupDialog('create', 'GROUP'));
  const dashGoalDialog = document.getElementById('dashboard-create-goal-dialog');
  const dashGoalForm = document.getElementById('dashboard-create-goal-form');
  const dashGoalTitleInput = document.getElementById('dash-goal-title');
  const dashGoalTargetInput = document.getElementById('dash-goal-target');
  const dashGoalDurationCount = document.getElementById('dash-goal-duration-count');
  const dashGoalDurationUnit = document.getElementById('dash-goal-duration-unit');
  const dashGoalDateInput = document.getElementById('dash-goal-date');
  const dashGoalFreqSelect = document.getElementById('dash-goal-frequency');
  const dashGoalSuggestGrid = document.getElementById('dash-goal-suggestion-grid');
  const dashGoalSuggestNote = document.getElementById('dash-goal-suggest-note');
  const dashGoalSchedFields = document.getElementById('dash-goal-schedule-fields');
  const dashGoalSchedAmount = document.getElementById('dash-goal-scheduled-amount');
  const dashGoalSchedStart = document.getElementById('dash-goal-schedule-start');
  let dashGoalSuggestions = null;

  Ipon.guardMoneyInput?.(dashGoalTargetInput, { min: 0.01, required: true, label: 'Target amount' });
  Ipon.guardMoneyInput?.(dashGoalSchedAmount, { min: 0.01, required: false, label: 'Scheduled deposit' });

  function validateDashGoalDuration() {
    if (!dashGoalDurationCount) return { valid: true, value: null, error: '' };
    const raw = String(dashGoalDurationCount.value ?? '').trim();
    if (!raw) { dashGoalDurationCount.setCustomValidity?.(''); Ipon.setFieldError?.(dashGoalDurationCount, ''); return { valid: true, value: null, error: '' }; }
    if (!/^[1-9]\d*$/.test(raw) || raw.length > 4 || Number(raw) < 1 || Number(raw) > 3650) {
      const error = 'Enter a whole number between 1 and 3,650 (no leading zeros).';
      dashGoalDurationCount.setCustomValidity?.(error);
      Ipon.setFieldError?.(dashGoalDurationCount, error);
      return { valid: false, value: null, error };
    }
    dashGoalDurationCount.setCustomValidity?.('');
    Ipon.setFieldError?.(dashGoalDurationCount, '');
    return { valid: true, value: Number(raw), error: '' };
  }

  dashGoalDurationCount?.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (['e', 'E', '+', '-', '.', ','].includes(event.key)) event.preventDefault();
  });

  function syncDashGoalScheduleVisibility() {
    const freq = String(dashGoalFreqSelect?.value || 'NONE').toUpperCase();
    const enabled = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq);
    if (dashGoalSchedFields) dashGoalSchedFields.hidden = !enabled;
    if (dashGoalSchedAmount) {
      dashGoalSchedAmount.required = enabled;
      if (!enabled) {
        dashGoalSchedAmount.value = '';
        Ipon.setFieldError?.(dashGoalSchedAmount, '');
      }
    }
    dashGoalSuggestGrid?.querySelectorAll('[data-dash-suggest-freq]').forEach((btn) => {
      const active = enabled && btn.dataset.dashSuggestFreq === freq;
      btn.classList.toggle('is-selected', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function syncDashGoalSuggestions() {
    const parsed = Ipon.parseMoneyAmount(dashGoalTargetInput?.value, { min: 0.01, required: false, label: 'Target amount', badInput: Boolean(dashGoalTargetInput?.validity?.badInput) });
    const targetVal = parsed.valid ? Number(parsed.value || 0) : 0;
    const targetDateVal = dashGoalDateInput?.value || '';
    const suggestions = Ipon.computeGoalScheduleSuggestions({
      targetAmount: targetVal,
      currentSavings: currentGroup ? Number(lastTrackedSavings || 0) : 0,
      targetDate: targetDateVal,
      memberCount: 1
    });
    dashGoalSuggestions = suggestions;
    const dEl = document.getElementById('dash-goal-suggest-daily');
    const wEl = document.getElementById('dash-goal-suggest-weekly');
    const mEl = document.getElementById('dash-goal-suggest-monthly');
    if (!(targetVal > 0)) {
      if (dEl) dEl.textContent = '—';
      if (wEl) wEl.textContent = '—';
      if (mEl) mEl.textContent = '—';
      if (dashGoalSuggestNote) dashGoalSuggestNote.textContent = 'Enter a target amount to see suggested daily, weekly, and monthly deposits.';
      return;
    }
    if (dEl) dEl.textContent = Ipon.money(suggestions.daily.amount);
    if (wEl) wEl.textContent = Ipon.money(suggestions.weekly.amount);
    if (mEl) mEl.textContent = Ipon.money(suggestions.monthly.amount);
    if (dashGoalSuggestNote) {
      dashGoalSuggestNote.textContent = suggestions.hasFutureDate
        ? `Based on ${Ipon.money(suggestions.remaining)} over ${suggestions.effectiveDays} day${suggestions.effectiveDays === 1 ? '' : 's'}. Tap a pace to select it.`
        : `Estimated over 30 days (${Ipon.money(suggestions.remaining)}). Set a timeframe or target date to refine.`;
    }
  }

  function applyDashGoalDuration() {
    const dur = validateDashGoalDuration();
    if (!dur.valid || !(dur.value > 0)) return;
    const unit = String(dashGoalDurationUnit?.value || 'DAYS').toUpperCase();
    const d = new Date();
    if (unit === 'WEEKS') d.setDate(d.getDate() + (dur.value * 7));
    else if (unit === 'MONTHS') d.setMonth(d.getMonth() + dur.value);
    else d.setDate(d.getDate() + dur.value);
    if (dashGoalDateInput) dashGoalDateInput.value = Ipon.isoDate(d);
    syncDashGoalSuggestions();
    const activeFreq = String(dashGoalFreqSelect?.value || 'NONE').toUpperCase();
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(activeFreq) && dashGoalSuggestions?.[activeFreq.toLowerCase()]?.amount > 0 && dashGoalSchedAmount && !dashGoalSchedAmount.dataset.userEdited) {
      dashGoalSchedAmount.value = dashGoalSuggestions[activeFreq.toLowerCase()].amount.toFixed(2);
    }
  }

  function openDashboardCreateGoalDialog() {
    if (!dashGoalDialog || !dashGoalForm) return;
    dashGoalForm.reset();
    [dashGoalTitleInput, dashGoalTargetInput, dashGoalDurationCount, dashGoalDateInput, dashGoalSchedAmount, dashGoalSchedStart].forEach((el) => {
      if (!el) return;
      el.value = '';
      el.setCustomValidity?.('');
      Ipon.setFieldError?.(el, '');
    });
    if (dashGoalDurationUnit) dashGoalDurationUnit.value = 'DAYS';
    if (dashGoalFreqSelect) dashGoalFreqSelect.value = 'NONE';
    if (dashGoalSchedAmount) delete dashGoalSchedAmount.dataset.userEdited;
    syncDashGoalScheduleVisibility();
    syncDashGoalSuggestions();
    dashGoalDialog.showModal();
    dashGoalTitleInput?.focus();
  }

  dashGoalTitleInput?.addEventListener('input', () => {
    const val = String(dashGoalTitleInput.value || '').trim();
    const err = val && (val.length < 2 || val.length > 150) ? 'Goal title must be between 2 and 150 characters.' : '';
    dashGoalTitleInput.setCustomValidity?.(err);
    Ipon.setFieldError?.(dashGoalTitleInput, err);
  });
  dashGoalTargetInput?.addEventListener('input', syncDashGoalSuggestions);
  dashGoalDurationCount?.addEventListener('input', applyDashGoalDuration);
  dashGoalDurationUnit?.addEventListener('change', applyDashGoalDuration);
  dashGoalDateInput?.addEventListener('input', () => {
    if (dashGoalDurationCount) { dashGoalDurationCount.value = ''; Ipon.setFieldError?.(dashGoalDurationCount, ''); }
    syncDashGoalSuggestions();
  });
  dashGoalSchedAmount?.addEventListener('input', () => { if (dashGoalSchedAmount) dashGoalSchedAmount.dataset.userEdited = '1'; });
  dashGoalFreqSelect?.addEventListener('change', () => {
    syncDashGoalScheduleVisibility();
    const freq = String(dashGoalFreqSelect.value || 'NONE').toUpperCase();
    const suggested = dashGoalSuggestions?.[freq.toLowerCase()]?.amount || 0;
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq) && suggested > 0 && dashGoalSchedAmount && !dashGoalSchedAmount.value) {
      dashGoalSchedAmount.value = suggested.toFixed(2);
    }
  });
  dashGoalSuggestGrid?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-dash-suggest-freq]');
    if (!btn) return;
    const freq = String(btn.dataset.dashSuggestFreq || '').toUpperCase();
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(freq)) return;
    if (dashGoalFreqSelect) dashGoalFreqSelect.value = freq;
    syncDashGoalSuggestions();
    const suggested = dashGoalSuggestions?.[freq.toLowerCase()]?.amount || 0;
    if (dashGoalSchedAmount && suggested > 0) {
      dashGoalSchedAmount.value = suggested.toFixed(2);
      delete dashGoalSchedAmount.dataset.userEdited;
      Ipon.setFieldError?.(dashGoalSchedAmount, '');
    }
    syncDashGoalScheduleVisibility();
  });
  document.getElementById('close-dash-goal-dialog')?.addEventListener('click', () => dashGoalDialog?.close());
  document.getElementById('cancel-dash-goal-dialog')?.addEventListener('click', () => dashGoalDialog?.close());
  dashGoalDialog?.addEventListener('click', (event) => { if (event.target === dashGoalDialog) dashGoalDialog.close(); });
  dashGoalForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const title = String(dashGoalTitleInput?.value || '').trim();
    if (title.length < 2 || title.length > 150) {
      Ipon.setFieldError?.(dashGoalTitleInput, 'Goal title must be between 2 and 150 characters.');
      dashGoalTitleInput?.focus();
      Ipon.toast('Goal title must be between 2 and 150 characters.', 'error');
      return;
    }
    const targetCheck = Ipon.parseMoneyAmount(dashGoalTargetInput?.value, { min: 0.01, required: true, label: 'Target amount', badInput: Boolean(dashGoalTargetInput?.validity?.badInput) });
    if (!targetCheck.valid) {
      Ipon.setFieldError?.(dashGoalTargetInput, targetCheck.error);
      dashGoalTargetInput?.focus();
      Ipon.toast(targetCheck.error, 'error');
      return;
    }
    const durCheck = validateDashGoalDuration();
    if (!durCheck.valid) { dashGoalDurationCount?.focus(); Ipon.toast(durCheck.error, 'error'); return; }
    const targetDate = String(dashGoalDateInput?.value || '').trim() || null;
    if (targetDate && (targetDate < '2000-01-01' || targetDate > '2100-12-31')) {
      Ipon.setFieldError?.(dashGoalDateInput, 'Target date must be between 2000-01-01 and 2100-12-31.');
      dashGoalDateInput?.focus();
      return;
    }
    const savingFrequency = String(dashGoalFreqSelect?.value || 'NONE').toUpperCase();
    let scheduledAmount = null;
    let scheduleStartDate = null;
    if (['DAILY', 'WEEKLY', 'MONTHLY'].includes(savingFrequency)) {
      const schedCheck = Ipon.parseMoneyAmount(dashGoalSchedAmount?.value, { min: 0.01, required: true, label: 'Scheduled deposit', badInput: Boolean(dashGoalSchedAmount?.validity?.badInput) });
      if (!schedCheck.valid) {
        Ipon.setFieldError?.(dashGoalSchedAmount, schedCheck.error);
        dashGoalSchedAmount?.focus();
        Ipon.toast(schedCheck.error, 'error');
        return;
      }
      scheduledAmount = schedCheck.value;
      scheduleStartDate = String(dashGoalSchedStart?.value || '').trim() || Ipon.isoDate();
    }
    const notes = String(dashGoalForm.elements.notes?.value || '').trim() || null;
    const needsSolo = !currentGroup && !state.profile?.group_id;
    const unitMap = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month' };
    const scheduleCopy = scheduledAmount ? ` · ${savingFrequency.charAt(0) + savingFrequency.slice(1).toLowerCase()} deposit: ${Ipon.money(scheduledAmount)}/${unitMap[savingFrequency] || 'period'}` : '';
    const confirmed = await Ipon.confirmAction({
      title: needsSolo ? 'Create solo tracker & savings goal?' : 'Create savings goal?',
      message: needsSolo
        ? `Create your personal Solo tracker "${title}" and activate this goal (${Ipon.money(targetCheck.value)}${scheduleCopy})?`
        : `Create "${title}" with target ${Ipon.money(targetCheck.value)}${scheduleCopy}?`,
      acceptLabel: 'Create goal'
    });
    if (!confirmed) return;

    const saveBtn = document.getElementById('save-dash-goal-dialog');
    Ipon.setBusy(saveBtn, true, 'Creating…');
    try {
      if (needsSolo) {
        const rawMonthly = Number(dashGoalSuggestions?.monthly?.amount || scheduledAmount || targetCheck.value || 100);
        const monthlyBaseline = Math.min(1000000, Math.max(1, Math.round(rawMonthly * 100) / 100));
        await Ipon.rpc('admin_create_group', {
          p_name: title,
          p_avatar_url: null,
          p_include_self: true,
          p_monthly_amount: monthlyBaseline,
          p_workspace_mode: 'SOLO'
        });
        Ipon.syncWorkspaceMode?.('SOLO');
      }
      await Ipon.rpc('save_savings_goal', {
        p_goal_id: null,
        p_title: title,
        p_target_amount: targetCheck.value,
        p_target_date: targetDate,
        p_status: 'ACTIVE',
        p_notes: notes,
        p_saving_frequency: savingFrequency,
        p_scheduled_amount: scheduledAmount,
        p_schedule_start_date: scheduleStartDate
      });
      if (savingFrequency !== 'NONE') Ipon.rpc('sync_my_due_reminders').catch(() => {});
      dashGoalDialog.close();
      Ipon.toast(needsSolo ? 'Solo tracker and savings goal created.' : 'Savings goal created.');
      if (needsSolo) location.reload();
      else await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(saveBtn, false);
    }
  });

  document.getElementById('no-group-create-goal-btn')?.addEventListener('click', () => {
    openDashboardCreateGoalDialog();
  });
  document.getElementById('close-group-dialog')?.addEventListener('click', () => groupDialog?.close());
  document.getElementById('cancel-group-dialog')?.addEventListener('click', () => groupDialog?.close());
  groupForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const isCreate = groupForm.elements.mode.value === 'create';
    const workspaceMode = groupWorkspaceModeInput?.value === 'SOLO' ? 'SOLO' : 'GROUP';
    const isSolo = workspaceMode === 'SOLO';
    const nameEl = groupForm.elements.name;
    const name = String(nameEl?.value || '').trim();
    Ipon.setFieldError?.(nameEl, '');
    Ipon.setFieldError?.(groupMonthlyInput, '');
    if (name.length < 2 || name.length > 150) {
      Ipon.setFieldError?.(nameEl, 'Workspace name must be between 2 and 150 characters.');
      nameEl?.focus();
      return;
    }
    const includeSelf = isSolo ? true : groupSelfToggle.checked;
    let monthlyAmount = 100;
    if (isSolo || includeSelf) {
      const amountLabel = isSolo ? 'Monthly savings goal' : 'Monthly contribution amount';
      const amountCheck = typeof Ipon.parseMoneyAmount === 'function'
        ? Ipon.parseMoneyAmount(groupMonthlyInput?.value, {
          min: 1,
          max: 1000000,
          required: true,
          label: amountLabel,
          badInput: Boolean(groupMonthlyInput?.validity?.badInput)
        })
        : { valid: Number(groupMonthlyInput?.value) >= 1 && Number(groupMonthlyInput?.value) <= 1000000, value: Number(groupMonthlyInput?.value), error: `${amountLabel} must be between ₱1 and ₱1,000,000.` };
      if (!amountCheck.valid) {
        Ipon.setFieldError?.(groupMonthlyInput, amountCheck.error || `${amountLabel} must be between ₱1 and ₱1,000,000.`);
        groupMonthlyInput?.focus();
        return;
      }
      monthlyAmount = Number(amountCheck.value);
    }
    const invitePayloads = isCreate && !isSolo ? collectInvitePayloads(groupInviteRows, { allowEmptyRows: true }) : [];
    if (isCreate && !isSolo && invitePayloads === null) return;
    const removingSelf = !isCreate && !isSolo && !includeSelf && Boolean(currentGroup?.is_contributor);
    const confirmed = await Ipon.confirmAction(removingSelf ? {
      title: 'Save group & remove contributor?',
      message: `Save changes to "${name}" and remove yourself as a contributor from this group?`,
      acceptLabel: 'Save & remove contributor'
    } : {
      title: isCreate
        ? (isSolo ? 'Create solo savings tracker?' : 'Create savings group?')
        : (isSolo ? 'Save solo tracker changes?' : 'Save group changes?'),
      message: isCreate
        ? (isSolo
          ? `Create personal solo savings tracker "${name}" with ${Ipon.money(monthlyAmount)} monthly goal?`
          : `Create "${name}"${invitePayloads.length ? ` and send ${invitePayloads.length} member invitation${invitePayloads.length === 1 ? '' : 's'}` : ''}?`)
        : `Save updated settings for "${name}"?`,
      acceptLabel: isCreate ? (isSolo ? 'Create solo tracker' : 'Create group') : 'Save changes'
    });
    if (!confirmed) {
      if (removingSelf) groupSelfToggle.checked = true;
      return;
    }
    const button = document.getElementById('save-group-dialog');
    Ipon.setBusy(button, true, isCreate ? 'Creating…' : 'Saving…');
    try {
      const resolvedGroupAvatarUrl = (!pendingGroupClearAvatar && pendingGroupAvatarUrl && pendingGroupAvatarUrl.startsWith('data:'))
        ? await Ipon.uploadMediaDataUrl(pendingGroupAvatarUrl, { category: 'group-avatars', name: 'group-avatar.jpg' })
        : pendingGroupAvatarUrl;
      if (isCreate) {
        const pendingCalcPlan = isSolo ? readPreWorkspaceCalculatorPlan() : null;
        await Ipon.rpc('admin_create_group', {
          p_name: name,
          p_avatar_url: resolvedGroupAvatarUrl,
          p_include_self: includeSelf,
          p_monthly_amount: monthlyAmount,
          p_workspace_mode: workspaceMode
        });
        Ipon.syncWorkspaceMode?.(workspaceMode);
        if (pendingCalcPlan && Number(pendingCalcPlan.targetAmount) > 0) {
          const goalTitle = String(pendingCalcPlan.title || name || 'Savings Goal').trim().slice(0, 150);
          const planFreq = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(String(pendingCalcPlan.savingFrequency || '').toUpperCase())
            ? String(pendingCalcPlan.savingFrequency).toUpperCase()
            : 'NONE';
          const planSchedAmt = planFreq !== 'NONE' && Number(pendingCalcPlan.scheduledAmount) > 0
            ? Number(pendingCalcPlan.scheduledAmount)
            : null;
          try {
            await Ipon.rpc('save_savings_goal', {
              p_goal_id: null,
              p_title: goalTitle.length >= 2 ? goalTitle : name,
              p_target_amount: Number(pendingCalcPlan.targetAmount),
              p_target_date: pendingCalcPlan.targetDate || null,
              p_status: 'ACTIVE',
              p_notes: null,
              p_saving_frequency: planFreq,
              p_scheduled_amount: planSchedAmt,
              p_schedule_start_date: planFreq !== 'NONE' ? Ipon.isoDate() : null
            });
            try { localStorage.removeItem(`ipon:calc-plans:group:${state.profile.id}`); } catch { }
            if (planFreq !== 'NONE') Ipon.rpc('sync_my_due_reminders').catch(() => {});
          } catch { /* non-blocking if goal creation needs manual follow-up */ }
        }
        const inviteResults = invitePayloads.length ? await dispatchInvites(invitePayloads) : [];
        groupDialog.close();
        Ipon.toast(isSolo ? 'Solo savings tracker created.' : 'Savings group created.');
        if (inviteResults.length) {
          Ipon.showInviteSummary({ title: `Invites for ${name}`, results: inviteResults });
          document.getElementById('invite-summary-dialog')?.addEventListener('close', () => location.reload(), { once: true });
        } else {
          location.reload();
        }
      } else {
        await Ipon.rpc('update_group_profile', {
          p_name: name,
          p_avatar_url: resolvedGroupAvatarUrl,
          p_clear_avatar: pendingGroupClearAvatar,
          p_workspace_mode: workspaceMode
        });
        Ipon.syncWorkspaceMode?.(workspaceMode);
        if (includeSelf !== Boolean(currentGroup?.is_contributor) || (includeSelf && monthlyAmount !== Number(currentAdminMonthlyAmount || 0))) {
          await Ipon.rpc('set_admin_contributor', {
            p_enabled: includeSelf,
            p_monthly_amount: includeSelf ? monthlyAmount : null
          });
          if (includeSelf) currentAdminMonthlyAmount = monthlyAmount;
        }
        groupDialog.close();
        Ipon.toast(isSolo ? 'Solo tracker updated.' : 'Workspace updated.');
        await load();
      }
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });
  const inviteTabLink = document.getElementById('invite-tab-link');
  const inviteTabEmail = document.getElementById('invite-tab-email');
  const inviteLinkPanel = document.getElementById('invite-link-panel');
  const inviteLinkCodeMount = document.getElementById('invite-link-code-mount');
  const inviteDialogRequestsWrap = document.getElementById('invite-dialog-requests-wrap');
  const inviteDialogRequestsList = document.getElementById('invite-dialog-requests-list');
  let dashInvitePanelCtrl = null;

  function renderDialogPendingRequests(requests) {
    if (!inviteDialogRequestsWrap || !inviteDialogRequestsList) return;
    const list = Array.isArray(requests) ? requests : [];
    const countEl = document.getElementById('invite-dialog-requests-count');
    if (countEl) {
      countEl.hidden = list.length === 0;
      countEl.textContent = `${list.length} pending`;
    }
    inviteDialogRequestsWrap.hidden = list.length === 0;
    if (!list.length) {
      inviteDialogRequestsList.replaceChildren();
      return;
    }
    Ipon.renderJoinRequestsQueue(inviteDialogRequestsList, {
      requests: list,
      onChanged: async () => {
        await dashInvitePanelCtrl?.refresh();
        await load();
      }
    });
  }

  function setInviteTab(tab) {
    const isLink = tab !== 'email';
    inviteTabLink?.classList.toggle('is-active', isLink);
    inviteTabEmail?.classList.toggle('is-active', !isLink);
    inviteTabLink?.setAttribute('aria-selected', String(isLink));
    inviteTabEmail?.setAttribute('aria-selected', String(!isLink));
    if (inviteLinkPanel) inviteLinkPanel.hidden = !isLink;
    if (inviteForm) inviteForm.hidden = isLink;
    if (!isLink && inviteOnlyRows && !inviteOnlyRows.children.length) {
      appendInviteRow(inviteOnlyRows, { defaultAmount: 100, required: true });
    }
  }

  inviteTabLink?.addEventListener('click', () => setInviteTab('link'));
  inviteTabEmail?.addEventListener('click', () => setInviteTab('email'));

  document.getElementById('dashboard-invite-member')?.addEventListener('click', () => {
    if (!inviteDialog) return;
    groupHubDialog?.close();
    setInviteTab('link');
    if (inviteLinkCodeMount) {
      dashInvitePanelCtrl = Ipon.mountInviteCodePanel(inviteLinkCodeMount, {
        groupName: currentGroup?.name || '',
        onChanged: (overview) => {
          renderDialogPendingRequests(overview?.pending_requests);
          const badgeEl = document.getElementById('group-hub-requests-badge');
          if (badgeEl) {
            const count = Array.isArray(overview?.pending_requests) ? overview.pending_requests.length : 0;
            badgeEl.hidden = count === 0;
            badgeEl.textContent = `${count} pending`;
          }
        }
      });
    }
    if (inviteOnlyRows) {
      inviteOnlyRows.replaceChildren();
      appendInviteRow(inviteOnlyRows, { defaultAmount: 100, required: true });
    }
    inviteDialog.showModal();
  });
  document.getElementById('invite-add-row')?.addEventListener('click', () => {
    const row = appendInviteRow(inviteOnlyRows, { defaultAmount: 100, required: true });
    row?.querySelector('[name="invite_email"]')?.focus();
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
    const isSoloMode = currentGroup?.workspace_mode === 'SOLO';
    const ownMemberId = state.profile?.member_id || (isSoloMode ? (cachedMembers[0]?.id || '') : '');
    if (quickMemberSelect) {
      const cur = quickMemberSelect.value;
      quickMemberSelect.innerHTML = `<option value="">Select member</option>${cachedMembers.map((m) => `<option value="${m.id}" data-avatar="${Ipon.escapeHtml(m.avatar_url || '')}" ${cur === m.id ? 'selected' : ''}>${Ipon.escapeHtml(m.full_name)}</option>`).join('')}`;
      if ((state.profile?.role === 'MEMBER' || isSoloMode) && ownMemberId) {
        quickMemberSelect.value = ownMemberId;
      }
      Ipon.enhanceMemberSelect(quickMemberSelect);
    }
    if (quickResponsibleSelect) {
      const cur = quickResponsibleSelect.value;
      const ownName = cachedMembers.find((m) => m.id === ownMemberId)?.full_name || state.profile?.full_name || '';
      quickResponsibleSelect.innerHTML = `<option value="">Select member</option>${cachedMembers.map((m) => `<option value="${Ipon.escapeHtml(m.full_name)}" data-avatar="${Ipon.escapeHtml(m.avatar_url || '')}" ${(cur || ownName) === m.full_name ? 'selected' : ''}>${Ipon.escapeHtml(m.full_name)}</option>`).join('')}`;
      Ipon.enhanceMemberSelect(quickResponsibleSelect);
      syncQuickPayoutDestination(false);
    }
  }

  function syncQuickPayoutDestination(syncMethod = true) {
    const box = document.getElementById('quick-payout-destination');
    if (!box) return;
    if (currentQuickType !== 'deduction') {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    const chosenName = quickResponsibleSelect?.value || '';
    const chosen = chosenName ? cachedMembers.find((m) => m.full_name === chosenName) : null;
    Ipon.renderPayoutDestinationBox(box, chosen, { autoSyncMethodForm: syncMethod ? quickRecordForm : null });
  }

  function setQuickRecordType(type) {
    currentQuickType = type;
    const isAddition = type === 'addition';
    const isDeduction = type === 'deduction';
    const isExpense = type === 'expense';
    const isMemberRole = state.profile?.role === 'MEMBER';
    const isSoloSelf = currentGroup?.workspace_mode === 'SOLO' && Boolean(state.profile?.member_id || cachedMembers[0]?.id);
    const autoSelectMember = isMemberRole || isSoloSelf;

    quickTabAddition?.classList.toggle('is-active', isAddition);
    quickTabAddition?.setAttribute('aria-selected', isAddition ? 'true' : 'false');
    quickTabDeduction?.classList.toggle('is-active', isDeduction);
    quickTabDeduction?.setAttribute('aria-selected', isDeduction ? 'true' : 'false');
    quickTabExpense?.classList.toggle('is-active', isExpense);
    quickTabExpense?.setAttribute('aria-selected', isExpense ? 'true' : 'false');

    if (quickEntryTypeInput) quickEntryTypeInput.value = type;

    if (isAddition) {
      if (quickTitle) quickTitle.textContent = isMemberRole ? 'Record addition' : 'Record savings addition';
      if (quickSubtitle) quickSubtitle.textContent = currentGroup?.workspace_mode === 'SOLO' ? 'Record money added to your personal savings tracker.' : 'Record money added to the group savings fund.';
      if (quickSubmitBtn) quickSubmitBtn.textContent = 'Save addition';
      if (quickDateLabel) quickDateLabel.textContent = 'Date added';
      if (quickPaymentMethodLabel) quickPaymentMethodLabel.textContent = 'Payment method';
    } else if (isDeduction) {
      if (quickTitle) quickTitle.textContent = 'Record deduction';
      if (quickSubtitle) quickSubtitle.textContent = 'Track money deducted or withdrawn from the savings fund.';
      if (quickSubmitBtn) quickSubmitBtn.textContent = 'Save deduction';
      if (quickDateLabel) quickDateLabel.textContent = 'Date deducted';
      if (quickPaymentMethodLabel) quickPaymentMethodLabel.textContent = 'Paid from wallet';
      if (quickDescLabel) quickDescLabel.textContent = 'Reason / description';
    } else {
      if (quickTitle) quickTitle.textContent = 'Record expense';
      if (quickSubtitle) quickSubtitle.textContent = 'Track workspace expenses separately from deductions.';
      if (quickSubmitBtn) quickSubmitBtn.textContent = 'Save expense';
      if (quickDateLabel) quickDateLabel.textContent = 'Date incurred';
      if (quickPaymentMethodLabel) quickPaymentMethodLabel.textContent = 'Paid from wallet';
      if (quickDescLabel) quickDescLabel.textContent = 'Description';
    }

    if (quickFieldMember) quickFieldMember.hidden = !isAddition || autoSelectMember;
    if (quickMemberSelect) quickMemberSelect.required = isAddition && !autoSelectMember;

    if (quickMemberAuto) {
      quickMemberAuto.hidden = !isAddition || !autoSelectMember;
      if (quickMemberAutoName) quickMemberAutoName.textContent = state.profile?.full_name || cachedMembers[0]?.full_name || 'Member';
    }

    if (quickFieldResponsible) quickFieldResponsible.hidden = isAddition;
    if (quickResponsibleSelect) quickResponsibleSelect.required = !isAddition;

    if (quickFieldMonth) quickFieldMonth.hidden = !isAddition;
    if (quickMonthInput) quickMonthInput.required = isAddition;

    if (quickFieldCategory) quickFieldCategory.hidden = isAddition;
    if (quickCategoryInput) {
      Ipon.setCategoryPresetGroup(quickCategoryInput, isDeduction ? 'deduction' : 'expense', { required: !isAddition });
    }

    if (quickFieldDescription) quickFieldDescription.hidden = isAddition;
    if (quickDescriptionInput) quickDescriptionInput.required = !isAddition;
    syncQuickPayoutDestination(false);
    if (isAddition) {
      applyQuickGoalAutofill(quickPreferredGoalId, { force: false });
    } else {
      const hintEl = document.getElementById('quick-goal-autofill-hint');
      if (hintEl) {
        hintEl.hidden = true;
        hintEl.textContent = '';
      }
    }
  }

  let quickPreferredGoalId = '';

  function applyQuickGoalAutofill(preferredGoalId = '', { force = false } = {}) {
    const hintEl = document.getElementById('quick-goal-autofill-hint');
    if (!quickAmountInput) return;
    const isAddition = (quickEntryTypeInput?.value || 'addition') === 'addition';
    if (!isAddition || typeof Ipon.pickActiveScheduledGoal !== 'function') {
      if (hintEl) { hintEl.hidden = true; hintEl.textContent = ''; }
      return;
    }
    const picked = Ipon.pickActiveScheduledGoal(activeGoalsList, {
      preferredGoalId: preferredGoalId || selectedGoalId,
      trackedSavings: lastTrackedSavings
    });
    if (!picked || !(picked.status.nextAutoFillAmount > 0)) {
      if (hintEl) { hintEl.hidden = true; hintEl.textContent = ''; }
      return;
    }
    const { status } = picked;
    if (force || (!quickAmountInput.dataset.userEdited && !quickAmountInput.value)) {
      quickAmountInput.value = status.nextAutoFillAmount.toFixed(2);
    }
    if (hintEl) {
      const tone = status.status === 'OVERDUE_CARRYOVER'
        ? 'is-overdue'
        : status.status === 'DUE_NOW'
          ? 'is-unpaid'
          : status.status === 'AHEAD_CREDIT'
            ? 'is-ahead'
            : 'is-ontrack';
      hintEl.className = `goal-autofill-hint ${tone}`;
      hintEl.textContent = status.autofillHint;
      hintEl.hidden = !status.autofillHint;
    }
  }

  function openQuickRecordDialog(presetDate = null, presetType = 'addition', options = {}) {
    if (!quickRecordDialog) return;
    const hasGroup = Boolean(currentGroup && state.profile?.group_id);
    if (!hasGroup || (state.profile?.role === 'MEMBER' && !state.profile?.member_id)) {
      Ipon.showGroupRequiredDialog({ hasGroup, onCreateGroup: (mode) => openGroupDialog('create', mode) });
      return;
    }
    quickPendingKey = null;
    quickPreferredGoalId = options?.goalId || '';
    quickRecordForm.reset();
    if (quickAmountInput) delete quickAmountInput.dataset.userEdited;
    Ipon.syncCategoryControl(quickCategoryInput, '');
    Ipon.setPaymentMethod(quickRecordForm, 'CASH');

    const today = Ipon.isoDate();
    const dateVal = presetDate || today;
    if (quickDateInput) quickDateInput.value = dateVal;
    if (quickMonthInput) quickMonthInput.value = dateVal.slice(0, 7);

    const perms = state.profile?.permissions || Ipon.defaultPermissionsForRole(state.profile?.role);
    const isMemberRole = state.profile?.role === 'MEMBER';
    const isSoloMode = currentGroup?.workspace_mode === 'SOLO';
    const isSoloSelf = isSoloMode && Boolean(state.profile?.member_id || cachedMembers[0]?.id);
    const canDeduction = state.profile?.role === 'ADMIN' || perms.can_record_withdrawals === true;
    const canExpense = !isSoloMode && (state.profile?.role === 'ADMIN' || perms.can_record_expenses === true);
    if (quickTabDeduction) quickTabDeduction.hidden = !canDeduction;
    if (quickTabExpense) quickTabExpense.hidden = !canExpense;
    if (quickRecordTypeTabs) quickRecordTypeTabs.hidden = !(canDeduction || canExpense);

    const initialType = (presetType === 'deduction' && canDeduction) || (presetType === 'expense' && canExpense)
      ? presetType
      : 'addition';
    setQuickRecordType(initialType);

    if (isMemberRole || isSoloSelf) {
      const ownId = state.profile?.member_id || cachedMembers[0]?.id || '';
      if (quickMemberSelect) quickMemberSelect.value = ownId;
      if (quickMemberAutoName) quickMemberAutoName.textContent = state.profile?.full_name || cachedMembers[0]?.full_name || 'Member';
      if (quickResponsibleSelect && !quickResponsibleSelect.value) {
        const ownName = cachedMembers.find((m) => m.id === ownId)?.full_name || state.profile?.full_name || '';
        if (ownName) quickResponsibleSelect.value = ownName;
      }
    }

    if (initialType === 'addition') {
      applyQuickGoalAutofill(quickPreferredGoalId, { force: true });
    }

    quickRecordDialog.showModal();
    quickAmountInput?.focus();
  }

  document.getElementById('dashboard-goal-box')?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-record-goal-due]');
    if (!btn) return;
    openQuickRecordDialog(null, 'addition', { goalId: btn.dataset.recordGoalDue || '' });
  });

  quickAmountInput?.addEventListener('input', () => {
    if (quickAmountInput) quickAmountInput.dataset.userEdited = '1';
  });

  dashboardRecordEntryBtn?.addEventListener('click', () => {
    openQuickRecordDialog();
  });

  dayModalBody?.addEventListener('click', (event) => {
    const profileBtn = event.target.closest('.day-modal-avatar-btn[data-profile-user-id]');
    if (profileBtn) {
      event.preventDefault();
      event.stopPropagation();
      Ipon.openMemberProfileDialog?.(profileBtn.dataset.profileUserId || '', {
        fullName: profileBtn.dataset.profileName || '',
        avatarUrl: profileBtn.dataset.profileAvatar || '',
        triggerEl: profileBtn
      });
      return;
    }
    const editBtn = event.target.closest('[data-edit-record-id]');
    if (editBtn) {
      const recId = editBtn.dataset.editRecordId;
      const recType = editBtn.dataset.editRecordType || 'contribution';
      const activity = currentActivities.find((item) => String(item.id) === String(recId) && activityRecordType(item) === recType);
      if (activity) {
        Ipon.openCalendarEntryEditDialog({
          id: activity.id,
          type: recType,
          subjectName: activity.subject_name || 'Entry',
          amount: activity.amount,
          paymentMethod: activity.payment_method,
          date: activity.activity_date,
          notes: activity.notes || '',
          status: activity.approval_status || 'CONFIRMED'
        }, {
          onSaved: async () => {
            await load();
            if (openModalDate && dayModal?.open) openDayModal(openModalDate);
          }
        });
      }
      return;
    }
    const reviewCrBtn = event.target.closest('[data-review-cr]');
    if (reviewCrBtn) {
      const crId = reviewCrBtn.dataset.reviewCr;
      const cr = currentChangeRequests.find((item) => String(item.id) === String(crId)) || crId;
      Ipon.openChangeRequestReviewDialog(cr, {
        allowReview: state?.profile?.role === 'ADMIN',
        onReviewed: async () => {
          await load();
          if (openModalDate && dayModal?.open) openDayModal(openModalDate);
        }
      });
      return;
    }
    const createGroupBtn = event.target.closest('[data-action="create-group-from-day"]');
    if (createGroupBtn) {
      openModalDate = null;
      dayModal.close();
      openGroupDialog('create');
      return;
    }
    const quickBtn = event.target.closest('[data-action="quick-record-day"]');
    if (quickBtn) {
      const targetDate = openModalDate || activeDate || null;
      openModalDate = null;
      dayModal.close();
      openQuickRecordDialog(targetDate, 'addition');
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
  quickResponsibleSelect?.addEventListener('change', () => syncQuickPayoutDestination(true));

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

    const hasGroup = Boolean(currentGroup && state.profile?.group_id);
    if (!hasGroup || (isAddition && isMemberRole && !state.profile.member_id)) {
      quickRecordDialog.close();
      Ipon.showGroupRequiredDialog({ hasGroup, onCreateGroup: () => openGroupDialog('create') });
      return;
    }

    if (quickRecordForm.elements.reference && !Ipon.validateNumericInput(quickRecordForm.elements.reference)) {
      quickRecordForm.elements.reference.focus();
      return;
    }
    const typeLabel = isAddition ? 'addition' : isDeduction ? 'deduction' : 'expense';
    const isAdmin = state.profile?.role === 'ADMIN';
    const perms = state.profile?.permissions || Ipon.defaultPermissionsForRole(state.profile?.role);
    const needsApproval = !isAdmin && (isAddition
      ? perms.require_add_approval !== false
      : isDeduction
        ? perms.require_withdrawal_approval !== false
        : perms.require_expense_approval !== false);
    const confirmed = await Ipon.confirmAction({
      title: needsApproval ? `Submit ${typeLabel} for review?` : `Confirm ${typeLabel}?`,
      message: needsApproval
        ? `${Ipon.money(amount)} will be submitted as pending until an administrator confirms it.`
        : `${Ipon.money(amount)} will be immediately confirmed and included in tracked savings.`,
      acceptLabel: needsApproval ? 'Submit for review' : 'Confirm and save'
    });
    if (!confirmed) return;

    quickPendingKey ||= crypto.randomUUID();
    Ipon.setBusy(quickSubmitBtn, true);

    try {
      const isSoloMode = currentGroup?.workspace_mode === 'SOLO';
      const fallbackMemberId = state.profile?.member_id || currentGroup?.member_id || cachedMembers[0]?.id || values.get('member_id');
      if (isAddition) {
        await Ipon.rpc('record_contribution', {
          p_member_id: (isMemberRole || isSoloMode) ? fallbackMemberId : values.get('member_id'),
          p_contribution_month: `${values.get('contribution_month')}-01`,
          p_amount: amount,
          p_payment_date: values.get('date'),
          p_transaction_reference: values.get('reference') || null,
          p_notes: values.get('notes') || null,
          p_idempotency_key: quickPendingKey,
          p_payment_method: values.get('payment_method') || 'CASH'
        });
      } else {
        const ownResponsible = cachedMembers.find((m) => m.id === (state.profile?.member_id || currentGroup?.member_id))?.full_name || cachedMembers[0]?.full_name || state.profile?.full_name;
        await Ipon.rpc(isDeduction ? 'record_withdrawal' : 'record_expense', {
          p_transaction_date: values.get('date'),
          p_amount: amount,
          p_category: values.get('category'),
          p_description: values.get('description'),
          p_person_responsible: (isMemberRole || isSoloMode) ? (values.get('person_responsible') || ownResponsible) : values.get('person_responsible'),
          p_reference_number: values.get('reference') || null,
          p_notes: values.get('notes') || null,
          p_idempotency_key: quickPendingKey,
          p_payment_method: values.get('payment_method') || 'CASH'
        });
      }

      quickPendingKey = null;
      Ipon.toast(needsApproval ? 'Record submitted for admin review.' : 'Confirmed record saved.');
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
    const activeGroupId = String(currentGroup?.group_id || state?.profile?.group_id || '');
    writeSavedGoalPref(activeGroupId, selectedGoalId);
    goalSelects.forEach((other) => { if (other) other.value = selectedGoalId; });
    updateDashboardGoalProgress();
  }));

  remindUnpaidBtn?.addEventListener('click', () => {
    Ipon.remindUnpaidMembers(monthIso(cursor).slice(0, 7), remindUnpaidBtn);
  });

  function syncBulkConfirmDialogState() {
    if (!bulkConfirmList || !bulkConfirmSubmit) return;
    const boxes = [...bulkConfirmList.querySelectorAll('.bulk-dialog-check')];
    const checked = boxes.filter((b) => b.checked);
    bulkConfirmSubmit.disabled = checked.length === 0;
    bulkConfirmSubmit.textContent = checked.length ? `Confirm selected (${checked.length})` : 'Confirm selected';
    if (bulkConfirmSelectAll) bulkConfirmSelectAll.checked = boxes.length > 0 && checked.length === boxes.length;
  }

  bulkConfirmBtn?.addEventListener('click', async () => {
    if (!bulkConfirmDialog || !bulkConfirmList) return;
    bulkConfirmList.innerHTML = '<p class="empty-state">Loading pending additions…</p>';
    bulkConfirmSubmit.disabled = true;
    bulkConfirmDialog.showModal();
    try {
      const { data, error } = await Ipon.client
        .from('contributions')
        .select('id, amount, payment_date, contribution_periods!inner(period_month, members!inner(full_name))')
        .eq('approval_status', 'PENDING')
        .order('payment_date', { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) {
        bulkConfirmList.innerHTML = '<p class="empty-state">No pending member additions to confirm.</p>';
        return;
      }
      bulkConfirmList.innerHTML = rows.map((row) => `
        <label class="bulk-review-row">
          <input type="checkbox" class="bulk-dialog-check" value="${row.id}" checked>
          <span><strong>${Ipon.escapeHtml(row.contribution_periods.members.full_name)}${Ipon.verifiedBadgesHtml?.(row.contribution_periods.members.full_name) || ''}</strong><small>${Ipon.dateLabel(row.payment_date)} · ${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'short', year: 'numeric' })}</small></span>
          <strong>${Ipon.money(row.amount)}</strong>
        </label>
      `).join('');
      syncBulkConfirmDialogState();
    } catch (error) {
      bulkConfirmList.innerHTML = `<p class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</p>`;
    }
  });
  bulkConfirmList?.addEventListener('change', (event) => {
    if (event.target.classList.contains('bulk-dialog-check')) syncBulkConfirmDialogState();
  });
  bulkConfirmSelectAll?.addEventListener('change', () => {
    const checked = bulkConfirmSelectAll.checked;
    bulkConfirmList?.querySelectorAll('.bulk-dialog-check').forEach((box) => { box.checked = checked; });
    syncBulkConfirmDialogState();
  });
  document.getElementById('close-bulk-confirm-dialog')?.addEventListener('click', () => bulkConfirmDialog?.close());
  document.getElementById('bulk-confirm-cancel')?.addEventListener('click', () => bulkConfirmDialog?.close());
  bulkConfirmSubmit?.addEventListener('click', async () => {
    const ids = [...(bulkConfirmList?.querySelectorAll('.bulk-dialog-check:checked') || [])].map((box) => box.value);
    if (!ids.length) return;
    Ipon.setBusy(bulkConfirmSubmit, true, 'Confirming…');
    try {
      const result = await Ipon.rpc('bulk_confirm_contributions', { p_contribution_ids: ids });
      bulkConfirmDialog.close();
      Ipon.toast(`Confirmed ${Number(result?.confirmed_count || ids.length)} addition(s).`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(bulkConfirmSubmit, false);
    }
  });
  renderCalendar([]);
  state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || state.redirecting) return;
  syncSummaryBreakdownMode(state.profile?.workspace_mode === 'SOLO');
  if (state.profile?.role !== 'ADMIN') document.querySelectorAll('a[href="members.html"],a[href="settings.html"],a[href="audit.html"]').forEach((link) => link.remove());
  if (state.profile?.role !== 'MEMBER') document.querySelectorAll('a[href="user.html"]').forEach((link) => link.remove());
  if (addAnnouncementButton) addAnnouncementButton.hidden = state.profile?.role !== 'ADMIN';
  try { await load(); } finally { Ipon.setLoading(false); }
  const parseTypedRef = (val) => {
    const raw = String(val || '').trim();
    const idx = raw.indexOf(':');
    return idx > 0 ? { type: raw.slice(0, idx), id: raw.slice(idx + 1) } : null;
  };
  Ipon.consumeDeepLink(async (params, hash) => {
    const recordGoalId = params.get('record_goal') || '';
    if (recordGoalId) {
      if (activeGoalsList.some((g) => String(g.id) === String(recordGoalId))) {
        selectedGoalId = recordGoalId;
        renderGoalOptions(activeGoalsList);
        updateDashboardGoalProgress(lastTrackedSavings);
      }
      openQuickRecordDialog(null, 'addition', { goalId: recordGoalId });
      return true;
    }
    if (params.get('create_group') === '1') {
      const presetMode = params.get('workspace_mode') === 'SOLO' ? 'SOLO' : 'GROUP';
      try { history.replaceState({}, '', location.pathname); } catch { }
      openGroupDialog('create', presetMode);
      return true;
    }
    const annId = params.get('announcement') || '';
    const releaseVer = params.get('release') || '';
    const annTitle = params.get('announcement_title') || '';
    if (annId || releaseVer || annTitle) {
      if (announcements?.openMatching) {
        const opened = await announcements.openMatching({ id: annId, releaseVersion: releaseVer, title: annTitle });
        if (opened) return true;
      }
    }
    const crParam = params.get('change_request');
    if (crParam) {
      Ipon.highlightFocus('[data-region="review-ground"]');
      if (crParam === 'pending') {
        const firstCr = currentChangeRequests[0];
        if (firstCr) {
          await Ipon.openChangeRequestReviewDialog(firstCr, { allowReview: state.profile?.role === 'ADMIN', onReviewed: load });
        }
      } else {
        await Ipon.openChangeRequestReviewDialog(crParam, { allowReview: state.profile?.role === 'ADMIN', onReviewed: load });
      }
      return true;
    }
    const dayParam = params.get('day');
    if (dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)) {
      const targetMonth = new Date(`${dayParam}T00:00:00`);
      if (!Number.isNaN(targetMonth.getTime())
          && (targetMonth.getFullYear() !== cursor.getFullYear() || targetMonth.getMonth() !== cursor.getMonth())) {
        await navigateTo(new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1));
      }
      openDayModal(dayParam);
      return true;
    }
    const reviewRef = parseTypedRef(params.get('review'));
    if (reviewRef) {
      Ipon.highlightFocus('[data-region="review-ground"]');
      await Ipon.openRecordDetails(reviewRef.type, reviewRef.id, {
        allowReview: state.profile?.role === 'ADMIN',
        autoOpenReview: state.profile?.role === 'ADMIN',
        onUpdated: load
      });
      return true;
    }
    if (params.has('review_notice')) {
      Ipon.highlightFocus('[data-region="review-ground"]');
      return !params.has('notice');
    }
    const recordRef = parseTypedRef(params.get('record'));
    if (recordRef) {
      await Ipon.openRecordDetails(recordRef.type, recordRef.id, {
        allowReview: state.profile?.role === 'ADMIN',
        onUpdated: load
      });
      return true;
    }
    const threadRef = parseTypedRef(params.get('thread'));
    if (threadRef) {
      await Ipon.openRecordDiscussion(threadRef.type, threadRef.id, { onUpdated: load });
      return true;
    }
    const featureId = params.get('feature_request') || '';
    if (featureId) {
      await Ipon.openFeatureRequestDetails(featureId);
      return true;
    }
    const reminderMonth = params.get('reminder') || '';
    const exemptionMonth = params.get('exemption') || '';
    if (reminderMonth || exemptionMonth) {
      await Ipon.openPeriodNoticeModal({
        mode: exemptionMonth ? 'exemption' : 'reminder',
        month: exemptionMonth || reminderMonth
      });
      return true;
    }
    if (hash === '#announcements' || hash === '#announcement-heading') {
      Ipon.highlightFocus('#announcement-heading');
      return true;
    }
    return false;
  });
  Ipon.subscribeToChanges('dashboard', ['members', 'profiles', 'groups', 'group_memberships', 'group_invite_codes', 'group_join_requests', 'financial_change_requests', 'contribution_periods', 'contributions', 'withdrawals', 'expenses', 'savings_goals', 'savings_cycle_batches', 'announcements', 'announcement_reactions'], () => {
    if (inviteDialog?.open && dashInvitePanelCtrl) {
      dashInvitePanelCtrl.refresh({ silent: true }).catch(() => { });
    }
    return load();
  });
})();
