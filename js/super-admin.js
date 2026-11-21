(async function () {
  'use strict';

  const state = await Ipon.init({ allowedRoles: ['SUPER_ADMIN'] });
  if (state.failed || !state.configured || !state.profile) return;

  const featureRequestsBody = document.getElementById('feature-requests-body');
  const bugReportsBody = document.getElementById('bug-reports-body');
  const administratorsBody = document.getElementById('administrators-body');
  const badgesBody = document.getElementById('badges-body');
  const effectsBody = document.getElementById('effects-body');
  const activityBody = document.getElementById('activity-body');
  const badgeGrantDialog = document.getElementById('badge-grant-dialog');
  const badgeGrantForm = document.getElementById('badge-grant-form');
  const badgeGrantTitle = document.getElementById('badge-grant-title');
  const badgeGrantCopy = document.getElementById('badge-grant-copy');
  const badgeGrantPreview = document.getElementById('badge-grant-preview');
  const badgeDurationPreset = document.getElementById('badge-duration-preset');
  const badgeCustomExpiryWrap = document.getElementById('badge-custom-expiry-wrap');
  const badgeCustomExpiry = document.getElementById('badge-custom-expiry');
  const badgeCreatorMessage = document.getElementById('badge-creator-message');
  const badgeGrantSubmit = document.getElementById('badge-grant-submit');
  const badgeRemoveDialog = document.getElementById('badge-remove-dialog');
  const badgeRemoveForm = document.getElementById('badge-remove-form');
  const badgeRemoveCopy = document.getElementById('badge-remove-copy');
  const badgeRemoveReason = document.getElementById('badge-remove-reason');
  const badgeRemoveSubmit = document.getElementById('badge-remove-submit');
  const effectGrantDialog = document.getElementById('effect-grant-dialog');
  const effectGrantForm = document.getElementById('effect-grant-form');
  const effectGrantCopy = document.getElementById('effect-grant-copy');
  const effectGrantPreviewStage = document.getElementById('effect-grant-preview-stage');
  const effectGrantPreviewAvatar = document.getElementById('effect-grant-preview-avatar');
  const effectGrantPreviewName = document.getElementById('effect-grant-preview-name');
  const effectGrantPreviewSub = document.getElementById('effect-grant-preview-sub');
  const effectGrantPolicyText = document.getElementById('effect-grant-policy-text');
  const effectDurationPreset = document.getElementById('effect-duration-preset');
  const effectCustomExpiryWrap = document.getElementById('effect-custom-expiry-wrap');
  const effectCustomExpiry = document.getElementById('effect-custom-expiry');
  const effectGrantGrid = document.getElementById('effect-grant-grid');
  const effectGrantCount = document.getElementById('effect-grant-count');
  const effectGrantError = document.getElementById('effect-grant-error');
  const effectCreatorMessage = document.getElementById('effect-creator-message');
  const effectGrantSubmit = document.getElementById('effect-grant-submit');
  const effectRemoveDialog = document.getElementById('effect-remove-dialog');
  const effectRemoveForm = document.getElementById('effect-remove-form');
  const effectRemoveCopy = document.getElementById('effect-remove-copy');
  const effectRemoveSelect = document.getElementById('effect-remove-select');
  const effectRemoveReason = document.getElementById('effect-remove-reason');
  const effectRemoveSubmit = document.getElementById('effect-remove-submit');
  const effectsSubtabs = document.getElementById('effects-subtabs');
  const effectsTabRequests = document.getElementById('effects-tab-requests');
  const effectsTabRewards = document.getElementById('effects-tab-rewards');
  const effectsReqBadge = document.getElementById('effects-req-badge');
  const effectsRequestsWrap = document.getElementById('effects-requests-wrap');
  const effectsRewardsWrap = document.getElementById('effects-rewards-wrap');
  const effectRequestsBody = document.getElementById('effect-requests-body');
  const effectTrialApproveDialog = document.getElementById('effect-trial-approve-dialog');
  const effectTrialApproveForm = document.getElementById('effect-trial-approve-form');
  const effectTrialApproveCopy = document.getElementById('effect-trial-approve-copy');
  const effectTrialPreviewStage = document.getElementById('effect-trial-preview-stage');
  const effectTrialPreviewAvatar = document.getElementById('effect-trial-preview-avatar');
  const effectTrialPreviewName = document.getElementById('effect-trial-preview-name');
  const effectTrialPreviewSub = document.getElementById('effect-trial-preview-sub');
  const effectTrialReqNote = document.getElementById('effect-trial-req-note');
  const effectTrialReqNoteText = document.getElementById('effect-trial-req-note-text');
  const effectTrialDurationPreset = document.getElementById('effect-trial-duration-preset');
  const effectTrialCustomWrap = document.getElementById('effect-trial-custom-wrap');
  const effectTrialCustomExpiry = document.getElementById('effect-trial-custom-expiry');
  const effectTrialCreatorMessage = document.getElementById('effect-trial-creator-message');
  const effectTrialApproveSubmit = document.getElementById('effect-trial-approve-submit');
  const effectTrialRejectDialog = document.getElementById('effect-trial-reject-dialog');
  const effectTrialRejectForm = document.getElementById('effect-trial-reject-form');
  const effectTrialRejectCopy = document.getElementById('effect-trial-reject-copy');
  const effectTrialRejectReason = document.getElementById('effect-trial-reject-reason');
  const effectTrialRejectSubmit = document.getElementById('effect-trial-reject-submit');
  const administratorDialog = document.getElementById('administrator-dialog');
  const administratorForm = document.getElementById('administrator-form');
  const userGroupsDialog = document.getElementById('user-groups-dialog');
  const userGroupsTitle = document.getElementById('user-groups-title');
  const userGroupsSubtitle = document.getElementById('user-groups-subtitle');
  const userGroupsList = document.getElementById('user-groups-list');
  const userPasswordDialog = document.getElementById('user-password-dialog');
  const userPasswordForm = document.getElementById('user-password-form');
  const bugViewerDialog = document.getElementById('bug-viewer-dialog');
  const overviewError = document.getElementById('overview-error');
  const releaseUpdateDialog = document.getElementById('release-update-dialog');
  const releaseUpdateForm = document.getElementById('release-update-form');
  const releaseUpdateBtn = document.getElementById('sa-add-release-update');
  const accountActionDialog = document.getElementById('account-action-dialog');
  const accountActionForm = document.getElementById('account-action-form');
  const accountActionUserId = document.getElementById('account-action-user-id');
  const accountActionType = document.getElementById('account-action-type');
  const accountActionTitle = document.getElementById('account-action-title');
  const accountActionSubtitle = document.getElementById('account-action-subtitle');
  const accountActionUserName = document.getElementById('account-action-user-name');
  const accountActionUserEmail = document.getElementById('account-action-user-email');
  const accountActionReason = document.getElementById('account-action-reason');
  const accountActionReasonLabel = document.getElementById('account-action-reason-label');
  const accountActionError = document.getElementById('account-action-error');
  const accountActionSubmit = document.getElementById('account-action-submit');
  const accountActionClose = document.getElementById('account-action-close');
  const storageGrid = document.getElementById('sa-storage-grid');
  const cleanupReceiptsBtn = document.getElementById('sa-cleanup-receipts-btn');
  const runRetentionBtn = document.getElementById('sa-run-retention-btn');
  let storageOverview = null;

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function renderStorageOverview() {
    if (!storageGrid) return;
    const s = storageOverview;
    if (!s) {
      storageGrid.innerHTML = '<div class="super-admin-storage-stat"><span>Storage telemetry</span><strong>Unavailable</strong><small>Run latest database migration</small></div>';
      if (cleanupReceiptsBtn) cleanupReceiptsBtn.disabled = true;
      return;
    }
    const reclaimCount = Number(s.reclaimable_rejected_count || 0);
    const reclaimBytes = Number(s.reclaimable_rejected_bytes || 0);
    const annBytes = Number(s.announcements_media_bytes || 0) + Number(s.bug_reports_media_bytes || 0);
    const cloudBytes = Number(s.storage_bucket_bytes || 0);
    const cloudObjs = Number(s.storage_bucket_objects || 0);
    const auditBytes = Number(s.audit_logs_bytes || 0);
    storageGrid.innerHTML = [
      `<div class="super-admin-storage-stat"><span>Cloud Storage buckets</span><strong>${formatBytes(cloudBytes)}</strong><small>${cloudObjs} stored object${cloudObjs === 1 ? '' : 's'} · ${Number(s.pending_storage_deletions || 0)} queued cleanup</small></div>`,
      `<div class="super-admin-storage-stat"><span>Receipts &amp; inline media</span><strong>${formatBytes(Number(s.contribution_receipts_bytes || 0) + Number(s.expense_receipts_bytes || 0) + annBytes)}</strong><small>${Number(s.contribution_receipts_count || 0)} contrib + ${Number(s.expense_receipts_count || 0)} expense · ${reclaimCount} old (${formatBytes(reclaimBytes)})</small></div>`,
      `<div class="super-admin-storage-stat"><span>Audit &amp; message tables</span><strong>${formatBytes(auditBytes)}</strong><small>${Number(s.audit_logs_count || 0)} audit logs · ${Number(s.messages_count || 0)} active chats (90d TTL)</small></div>`,
      `<div class="super-admin-storage-stat"><span>Avatars, QR &amp; archives</span><strong>${formatBytes(s.avatars_and_qr_bytes)}</strong><small>${Number(s.annual_archives_count || 0)} annual financial roll-up${Number(s.annual_archives_count || 0) === 1 ? '' : 's'}</small></div>`
    ].join('');
    if (cleanupReceiptsBtn) {
      cleanupReceiptsBtn.disabled = reclaimCount === 0;
      cleanupReceiptsBtn.textContent = reclaimCount > 0 ? `Clean ${reclaimCount} old receipt${reclaimCount === 1 ? '' : 's'}` : 'No old receipts to clean';
    }
  }
  const accountActionCancel = document.getElementById('account-action-cancel');
  const featureStatusTabs = document.getElementById('feature-requests-status-tabs');
  const bugStatusTabs = document.getElementById('bug-reports-status-tabs');
  const featureCardsContainer = document.getElementById('feature-requests-cards');
  const featureTableWrap = document.getElementById('feature-requests-table-wrap');
  const featureViewToggle = document.getElementById('feature-requests-view-toggle');
  let featureViewMode = localStorage.getItem('ipon_feature_view_mode') || 'cards';

  function setFeatureViewMode(mode) {
    featureViewMode = mode === 'table' ? 'table' : 'cards';
    try { localStorage.setItem('ipon_feature_view_mode', featureViewMode); } catch (_) { }
    featureViewToggle?.querySelectorAll('.view-mode-btn').forEach((btn) => {
      const active = btn.dataset.viewMode === featureViewMode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (featureCardsContainer) featureCardsContainer.hidden = featureViewMode !== 'cards';
    if (featureTableWrap) featureTableWrap.hidden = featureViewMode !== 'table';
  }
  setFeatureViewMode(featureViewMode);
  featureViewToggle?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-view-mode]');
    if (btn) setFeatureViewMode(btn.dataset.viewMode);
  });
  const announcements = Ipon.bindAnnouncements({
    listElement: document.getElementById('sa-announcement-list'),
    addButton: document.getElementById('sa-add-announcement'),
    allowPin: true,
    onEditRelease: (item) => openEditReleaseUpdateDialog(item)
  });
  let profiles = [];
  let groups = [];
  let groupMemberships = [];
  let featureRequests = [];
  let bugReports = [];
  let accountActivities = [];
  let activityLogs = [];
  let profileEffectGrants = [];
  let profileEffectTrialRequests = [];
  let effectPreviewStageCtrl = null;
  let effectTrialPreviewStageCtrl = null;
  let activeEffectsSubtab = null;
  let activeFeatureStatusFilter = 'ALL';
  let activeBugStatusFilter = 'OPEN';
  const PAGE_SIZE = 10;
  const pageState = { 'feature-requests': 0, 'bug-reports': 0, users: 0, badges: 0, effects: 0, 'effect-requests': 0, activity: 0 };
  Ipon.bindPasswordStrength(administratorForm.elements.password, () => [administratorForm.elements.first_name.value, administratorForm.elements.middle_name.value, administratorForm.elements.last_name.value, administratorForm.elements.email.value]);
  Ipon.bindPasswordStrength(userPasswordForm.elements.password, () => {
    const target = profiles.find((item) => item.id === userPasswordForm.elements.user_id.value);
    return target ? [target.first_name, target.middle_name, target.last_name, target.email] : [];
  });
  const views = {
    overview: ['Platform overview', 'Monitor registered users, savings groups, and feedback without exposing financial records.'],
    'feature-requests': ['Feature requests', 'Review improvements suggested by active IPON users.'],
    'bug-reports': ['Bug reports', 'Review reported problems, error details, and attached screenshots from IPON users.'],
    administrators: ['Users', 'Manage registered users, passwords, and assigned savings groups.'],
    badges: ['Verified badges', 'Assign blue verified badges, set temporary or permanent durations, and send a creator note.'],
    effects: ['Profile effects', 'Award permanent profile effects or review trial requests with custom expiration durations.'],
    activity: ['Platform activity', 'Review recent user and savings-group access changes recorded by the database.']
  };

  const viewFocusHeadings = {
    overview: 'platform-view-title',
    'feature-requests': 'feature-requests-title',
    'bug-reports': 'bug-reports-title',
    administrators: 'users-title',
    badges: 'badges-title',
    effects: 'effects-title',
    activity: 'activity-title'
  };

  function showView(focusHeading = false) {
    const requestedView = location.hash.slice(1);
    const isAnnouncementsAnchor = requestedView === 'announcements';
    const targetView = isAnnouncementsAnchor ? 'overview' : requestedView;
    const activeView = views[targetView] ? targetView : 'overview';
    if (!views[targetView] && !isAnnouncementsAnchor) history.replaceState(null, '', '#overview');
    document.querySelectorAll('[data-platform-view]').forEach((section) => { section.hidden = section.dataset.platformView !== activeView; });
    const pageHeader = document.getElementById('platform-page-header');
    if (pageHeader) pageHeader.hidden = activeView !== 'overview';
    document.getElementById('platform-view-title').textContent = views[activeView][0];
    document.getElementById('platform-view-description').textContent = views[activeView][1];
    document.querySelectorAll('[data-nav-section]').forEach((link) => {
      const current = link.dataset.navSection === activeView;
      link.classList.toggle('is-active', current);
      if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    const announcementsEl = document.querySelector('.super-admin-announcements');
    if (isAnnouncementsAnchor && announcementsEl) {
      requestAnimationFrame(() => {
        announcementsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        announcementsEl.classList.remove('is-highlight-focus');
        void announcementsEl.offsetWidth;
        announcementsEl.classList.add('is-highlight-focus');
        setTimeout(() => announcementsEl.classList.remove('is-highlight-focus'), 2200);
      });
    } else if (focusHeading) {
      const heading = document.getElementById(viewFocusHeadings[activeView] || 'platform-view-title');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
  }

  function statusLabel(status) {
    return `<span class="status status-${String(status).toLowerCase()}">${Ipon.escapeHtml(status)}</span>`;
  }

  function setShortcutBadge(id, text, highlight = false) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('has-pending', Boolean(highlight));
  }

  function renderOverview() {
    const registeredUsers = profiles.filter((profile) => profile && profile.role !== 'SUPER_ADMIN');
    const activeUsers = registeredUsers.filter((profile) => profile.status === 'ACTIVE');
    const suspendedUsers = registeredUsers.filter((profile) => profile.status === 'DISABLED');
    const pendingUsers = registeredUsers.filter((profile) => profile.status === 'PENDING');

    const nowMs = Date.now();
    const recent24hCount = activeUsers.filter((profile) => {
      if (Ipon.isUserOnline?.(profile.id)) return true;
      const act = accountActivities.find((item) => item?.user_id === profile.id);
      const latestMs = Math.max(
        Date.parse(act?.occurred_at || act?.created_at || '') || 0,
        Date.parse(act?.last_seen_at || profile.last_seen_at || '') || 0
      );
      return latestMs > 0 && (nowMs - latestMs) <= 86400000;
    }).length;

    const soloCount = groups.filter((group) => group?.workspace_mode === 'SOLO').length;
    const groupModeCount = Math.max(0, groups.length - soloCount);
    const activeGroupsCount = groups.filter((group) => group?.status === 'ACTIVE').length;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText('metric-total-users', registeredUsers.length);
    setText('metric-total-users-meta', pendingUsers.length
      ? `${activeUsers.length} active · ${pendingUsers.length} pending`
      : 'Total registered accounts');
    setText('metric-active-users', recent24hCount);
    setText('metric-active-users-meta', `${recent24hCount} active in last 24h`);
    setText('metric-suspended-users', suspendedUsers.length);
    setText('metric-suspended-users-meta', suspendedUsers.length
      ? `${suspendedUsers.length} deactivated account${suspendedUsers.length === 1 ? '' : 's'}`
      : 'No deactivated accounts');
    document.getElementById('metric-suspended-card')?.classList.toggle('has-alert', suspendedUsers.length > 0);
    setText('metric-groups', groups.length);
    setText('metric-groups-meta', groups.length
      ? `${groupModeCount} group · ${soloCount} solo${activeGroupsCount < groups.length ? ` (${groups.length - activeGroupsCount} paused)` : ''}`
      : 'No workspaces created yet');

    document.getElementById('platform-status').innerHTML = '<span aria-hidden="true"></span>Database access verified';

    const openBugs = bugReports.filter((report) => (report?.status || 'OPEN') === 'OPEN');
    const pendingFeatures = featureRequests.filter((request) => (request?.status || 'PENDING') === 'PENDING');
    const reclaimableReceipts = Number(storageOverview?.reclaimable_rejected_count || 0);

    const verifiedUsersCount = registeredUsers.filter((p) => {
      const tier = Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(p, '', { allowPendingAck: true }) : 'NONE';
      return tier !== 'NONE';
    }).length;

    setShortcutBadge('shortcut-count-features', pendingFeatures.length ? `${pendingFeatures.length} pending` : 'All reviewed', pendingFeatures.length > 0);
    setShortcutBadge('shortcut-count-bugs', openBugs.length ? `${openBugs.length} open` : '0 open', openBugs.length > 0);
    setShortcutBadge('shortcut-count-users', `${registeredUsers.length} registered`, false);
    setShortcutBadge('shortcut-count-badges', `${verifiedUsersCount} verified`, false);
    const grantsList = typeof profileEffectGrants !== 'undefined' && Array.isArray(profileEffectGrants) ? profileEffectGrants : [];
    const trialReqsList = typeof profileEffectTrialRequests !== 'undefined' && Array.isArray(profileEffectTrialRequests) ? profileEffectTrialRequests : [];
    const pendingTrialReqs = trialReqsList.filter((item) => item?.status === 'PENDING');
    const unlockedUserCount = new Set(grantsList.map((item) => item?.user_id).filter(Boolean)).size;
    setShortcutBadge(
      'shortcut-count-effects',
      pendingTrialReqs.length ? `${pendingTrialReqs.length} trial pending` : `${unlockedUserCount} unlocked`,
      pendingTrialReqs.length > 0
    );
    setShortcutBadge('shortcut-count-activity', `${activityLogs.length} events`, false);

    const attention = [];
    if (pendingTrialReqs.length) {
      attention.push(`<a href="super-admin.html#effects" data-overview-effect-requests="1">
        <span class="platform-attention-copy"><strong>${pendingTrialReqs.length} profile effect trial request${pendingTrialReqs.length === 1 ? '' : 's'}</strong><small>Review requests and set trial expiration durations.</small></span>
        <span class="platform-attention-end"><em class="platform-attention-pill is-warn">Pending</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </a>`);
    }
    if (openBugs.length) {
      attention.push(`<a href="super-admin.html#bug-reports" data-overview-bug-status="OPEN">
        <span class="platform-attention-copy"><strong>${openBugs.length} open bug report${openBugs.length === 1 ? '' : 's'}</strong><small>Inspect user-reported issues and attached screenshots.</small></span>
        <span class="platform-attention-end"><em class="platform-attention-pill is-danger">Review</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </a>`);
    }
    if (pendingFeatures.length) {
      attention.push(`<a href="super-admin.html#feature-requests" data-overview-feature-status="PENDING">
        <span class="platform-attention-copy"><strong>${pendingFeatures.length} pending feature request${pendingFeatures.length === 1 ? '' : 's'}</strong><small>Review incoming suggestions or mark completed items implemented.</small></span>
        <span class="platform-attention-end"><em class="platform-attention-pill is-warn">Pending</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </a>`);
    }
    if (suspendedUsers.length) {
      attention.push(`<a href="super-admin.html#administrators" data-overview-user-status="DISABLED">
        <span class="platform-attention-copy"><strong>${suspendedUsers.length} suspended user account${suspendedUsers.length === 1 ? '' : 's'}</strong><small>Review disabled accounts and restore access only when verified.</small></span>
        <span class="platform-attention-end"><em class="platform-attention-pill is-danger">Disabled</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </a>`);
    }
    if (pendingUsers.length) {
      attention.push(`<a href="super-admin.html#administrators" data-overview-user-status="PENDING">
        <span class="platform-attention-copy"><strong>${pendingUsers.length} pending user account${pendingUsers.length === 1 ? '' : 's'}</strong><small>Accounts awaiting initial sign-in or activation completion.</small></span>
        <span class="platform-attention-end"><em class="platform-attention-pill is-info">Pending</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </a>`);
    }
    if (reclaimableReceipts > 0) {
      attention.push(`<button type="button" data-overview-focus-storage="1">
        <span class="platform-attention-copy"><strong>${reclaimableReceipts} old rejected receipt${reclaimableReceipts === 1 ? '' : 's'} to purge</strong><small>Reclaim ${Ipon.escapeHtml(formatBytes(storageOverview?.reclaimable_rejected_bytes))} from expired 90-day attachments.</small></span>
        <span class="platform-attention-end"><em class="platform-attention-pill is-info">Clean up</em><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></span>
      </button>`);
    }
    document.getElementById('platform-attention').innerHTML = attention.length
      ? attention.join('')
      : '<div class="platform-clear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span><strong>No urgent platform work</strong><small>Registered users, savings groups, bug reports, and feature requests are up to date.</small></span></div>';
  }

  document.getElementById('platform-attention')?.addEventListener('click', (event) => {
    const effectTrigger = event.target.closest('[data-overview-effect-requests]');
    if (effectTrigger) {
      activeEffectsSubtab = 'requests';
      const reqFilter = document.getElementById('effect-requests-status-filter');
      if (reqFilter) reqFilter.value = 'PENDING';
      pageState['effect-requests'] = 0;
      renderEffects();
      return;
    }
    const bugTrigger = event.target.closest('[data-overview-bug-status]');
    if (bugTrigger) {
      activeBugStatusFilter = bugTrigger.dataset.overviewBugStatus || 'OPEN';
      bugStatusTabs?.querySelectorAll('[data-bug-status-filter]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.bugStatusFilter === activeBugStatusFilter);
      });
      pageState['bug-reports'] = 0;
      renderBugReports();
      return;
    }
    const featureTrigger = event.target.closest('[data-overview-feature-status]');
    if (featureTrigger) {
      activeFeatureStatusFilter = featureTrigger.dataset.overviewFeatureStatus || 'PENDING';
      featureStatusTabs?.querySelectorAll('[data-status-filter]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.statusFilter === activeFeatureStatusFilter);
      });
      pageState['feature-requests'] = 0;
      renderFeatureRequests();
      return;
    }
    const userTrigger = event.target.closest('[data-overview-user-status]');
    if (userTrigger) {
      const statusSelect = document.getElementById('users-status-filter');
      const searchInput = document.getElementById('users-search');
      if (statusSelect) statusSelect.value = userTrigger.dataset.overviewUserStatus || '';
      if (searchInput) searchInput.value = '';
      pageState.users = 0;
      renderUsers();
      return;
    }
    const storageTrigger = event.target.closest('[data-overview-focus-storage]');
    if (storageTrigger) {
      const target = document.querySelector('.super-admin-storage');
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      Ipon.highlightFocus?.(target);
      cleanupReceiptsBtn?.focus({ preventScroll: true });
    }
  });

  function filterValue(id) {
    return (document.getElementById(id)?.value || '').trim();
  }

  function matchesQuery(query, fields) {
    if (!query) return true;
    const term = query.toLocaleLowerCase();
    return fields.some((field) => String(field || '').toLocaleLowerCase().includes(term));
  }

  function paginateRows(key, items) {
    const pager = document.getElementById(`${key}-pager`);
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    pageState[key] = Math.min(Math.max(0, pageState[key]), pages - 1);
    const start = pageState[key] * PAGE_SIZE;
    if (pager) {
      pager.querySelector('span').textContent = `Page ${pageState[key] + 1} of ${pages}`;
      pager.querySelector('[data-page="previous"]').disabled = pageState[key] === 0;
      pager.querySelector('[data-page="next"]').disabled = pageState[key] >= pages - 1;
    }
    return items.slice(start, start + PAGE_SIZE);
  }

  const ROLE_LABELS = { ADMIN: 'Administrator', TREASURER: 'Treasurer', MEMBER: 'Member' };

  function getUserGroups(profile, groupById) {
    if (!profile) return [];
    const seen = new Map();
    const disabledGroupIds = new Set(
      groupMemberships
        .filter((gm) => gm.user_id === profile.id && gm.status === 'DISABLED')
        .map((gm) => gm.group_id)
    );

    const addGroup = (group, membershipStatus = 'ACTIVE', isOwner = false) => {
      if (!group || group.status !== 'ACTIVE' || seen.has(group.id)) return;
      seen.set(group.id, {
        id: group.id,
        name: group.name || 'Savings workspace',
        workspace_mode: group.workspace_mode === 'SOLO' ? 'SOLO' : 'GROUP',
        status: membershipStatus || 'ACTIVE',
        isOwner
      });
    };

    groupMemberships
      .filter((gm) => gm.user_id === profile.id && gm.status !== 'DISABLED')
      .forEach((gm) => addGroup(groupById.get(gm.group_id), gm.status, false));

    groups
      .filter((group) => group.owner_id === profile.id && group.status === 'ACTIVE')
      .forEach((group) => {
        if (seen.has(group.id)) seen.get(group.id).isOwner = true;
        else addGroup(group, 'ACTIVE', true);
      });

    if (profile.group_id && !disabledGroupIds.has(profile.group_id)) {
      addGroup(groupById.get(profile.group_id), 'ACTIVE', false);
    }

    return Array.from(seen.values());
  }

  function renderUserGroupsCell(userGroups, userId) {
    if (!userGroups.length) return '<span class="field-help">No groups yet</span>';
    const preview = userGroups.slice(0, 2);
    const overflow = userGroups.length - preview.length;
    const pills = preview.map((group) => `
      <span class="sa-group-chip${group.workspace_mode === 'SOLO' ? ' is-solo' : ''}" title="${Ipon.escapeHtml(group.name)}${group.workspace_mode === 'SOLO' ? ' (Solo savings)' : ''}">
        <span class="sa-group-name">${Ipon.escapeHtml(group.name)}</span>${group.workspace_mode === 'SOLO' ? '<em class="sa-group-mode">Solo</em>' : ''}
      </span>`).join('');
    const moreBtn = overflow > 0
      ? `<button class="sa-group-more-btn" type="button" data-view-user-groups="${userId}" title="View all ${userGroups.length} workspaces">+${overflow} more</button>`
      : '';
    return `<div class="sa-group-pills">${pills}${moreBtn}</div>`;
  }

  function openUserGroupsDialog(profile) {
    if (!userGroupsDialog || !userGroupsList || !profile) return;
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const userGroups = getUserGroups(profile, groupById);
    if (userGroupsTitle) userGroupsTitle.textContent = `${profile.full_name || 'User'}'s workspaces`;
    if (userGroupsSubtitle) {
      userGroupsSubtitle.textContent = `${userGroups.length} active workspace${userGroups.length === 1 ? '' : 's'} linked to ${profile.email || 'this account'}.`;
    }
    userGroupsList.innerHTML = userGroups.length ? userGroups.map((group) => `
      <div class="user-groups-item">
        <div class="user-groups-item-copy">
          <strong>${Ipon.escapeHtml(group.name)}</strong>
          <small class="field-help">${group.isOwner ? 'Created by user' : 'Joined workspace'}</small>
        </div>
        <div class="user-groups-item-badges">
          <span class="sa-group-chip${group.workspace_mode === 'SOLO' ? ' is-solo' : ''}">${group.workspace_mode === 'SOLO' ? 'Solo savings' : 'Group savings'}</span>
          ${statusLabel(group.status)}
        </div>
      </div>`).join('') : '<p class="empty-state">No groups linked to this account yet.</p>';
    if (!userGroupsDialog.open) userGroupsDialog.showModal();
  }

  document.getElementById('user-groups-close')?.addEventListener('click', () => userGroupsDialog?.close());
  document.getElementById('user-groups-done')?.addEventListener('click', () => userGroupsDialog?.close());

  function formatUserActivityLabel(activity) {
    if (!activity) return '';
    if (activity.activity_label) return String(activity.activity_label);
    const event = String(activity.activity_event || activity.event || '').trim().toUpperCase();
    const labels = {
      LOGIN: 'Signed in',
      PROFILE_UPDATE: 'Updated profile',
      PASSWORD_CHANGE: 'Changed password'
    };
    if (labels[event]) return labels[event];
    const words = event.replaceAll('_', ' ').trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Active';
  }

  function renderUsers() {
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const lastActivity = new Map();
    accountActivities.forEach((activity) => {
      if (activity?.user_id && !lastActivity.has(activity.user_id)) lastActivity.set(activity.user_id, activity);
    });
    const query = filterValue('users-search');
    const status = filterValue('users-status-filter');
    const users = profiles.filter((profile) => {
      if (!profile || profile.role === 'SUPER_ADMIN') return false;
      if (status && profile.status !== status) return false;
      const userGroups = getUserGroups(profile, groupById);
      const activityText = formatUserActivityLabel(lastActivity.get(profile.id));
      return matchesQuery(query, [profile.full_name, profile.email, ...userGroups.map((group) => group.name), profile.status, activityText]);
    });
    const visible = paginateRows('users', users);
    administratorsBody.innerHTML = visible.length ? visible.map((profile) => {
      const userGroups = getUserGroups(profile, groupById);
      const active = profile.status === 'ACTIVE';
      const activity = lastActivity.get(profile.id);
      const activityLabel = formatUserActivityLabel(activity);
      const activityAt = activity?.occurred_at || activity?.created_at || '';
      const lastSeenAt = activity?.last_seen_at || profile.last_seen_at || '';
      const showLastSeenTitle = lastSeenAt && activityAt && (Date.parse(lastSeenAt) - Date.parse(activityAt) > 120000);
      const activityTitle = showLastSeenTitle
        ? ` title="Last seen in app: ${Ipon.escapeHtml(Ipon.dateLabel(lastSeenAt, { dateStyle: 'medium', timeStyle: 'short' }))}"`
        : '';
      const actions = `<button class="icon-action" type="button" data-edit-admin="${profile.id}">Edit</button><button class="icon-action" type="button" data-set-password="${profile.id}">Change password</button><button class="icon-action" type="button" data-reset-admin="${profile.id}">Reset password</button><button class="icon-action ${active ? 'danger-action' : ''}" type="button" data-admin-status="${profile.id}" data-next-status="${active ? 'DISABLED' : 'ACTIVE'}">${active ? 'Deactivate' : 'Reactivate'}</button><button class="icon-action danger-action" type="button" data-delete-user="${profile.id}" data-archive-admin="${profile.id}">Delete</button>`;
      return `<tr data-user-id="${profile.id}">
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile.avatar_url, profile.full_name, 'table-user-avatar', profile.id)}
            <div>
              <strong>${Ipon.escapeHtml(profile.full_name)}${Ipon.verifiedBadgesHtml ? Ipon.verifiedBadgesHtml(profile) : ''}</strong>
              ${profile.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>${renderUserGroupsCell(userGroups, profile.id)}</td>
        <td>${Ipon.dateLabel(profile.created_at)}</td>
        <td${activityTitle}>${activityLabel && activityAt ? `<strong>${Ipon.escapeHtml(activityLabel)}</strong><small class="field-help">${Ipon.dateLabel(activityAt, { dateStyle: 'medium', timeStyle: 'short' })}</small>` : '<span class="field-help">No activity</span>'}</td>
        <td>${statusLabel(profile.status)}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-state">${query || status ? 'No matching user accounts.' : 'No user accounts.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(administratorsBody);
    Ipon.syncPresenceDots(administratorsBody);
  }

  function formatBadgeDurationCell(profile, tier) {
    if (tier === 'NONE') return '<span class="field-help">No active badge</span>';
    if (!profile.verified_badge_expires_at) {
      const sub = tier === 'CREATOR_GREEN' ? 'Lifetime · Never expires' : 'Auto-removes if inactive 2 months';
      return `<span class="badge-duration-pill is-permanent">Permanent</span><small class="field-help">${sub}</small>`;
    }
    const expMs = Date.parse(profile.verified_badge_expires_at);
    const daysLeft = Number.isNaN(expMs) ? 0 : Math.max(0, Math.ceil((expMs - Date.now()) / 86400000));
    const dateStr = Ipon.dateLabel(profile.verified_badge_expires_at, { dateStyle: 'medium', timeStyle: 'short' });
    return `<strong>${Ipon.escapeHtml(dateStr)}</strong><small class="field-help">${daysLeft} day${daysLeft === 1 ? '' : 's'} remaining</small>`;
  }

  function renderBadges() {
    if (!badgesBody) return;
    const query = filterValue('badges-search');
    const filter = filterValue('badges-status-filter');
    const tierOrder = { CREATOR_GREEN: 0, BLUE: 1, NONE: 2 };
    const candidates = profiles
      .filter((profile) => {
        if (!profile || profile.role === 'SUPER_ADMIN') return false;
        const tier = Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(profile, '', { allowPendingAck: true }) : 'NONE';
        if (filter === 'VERIFIED' && tier === 'NONE') return false;
        if (filter === 'CREATOR_GREEN' && tier !== 'CREATOR_GREEN') return false;
        if (filter === 'NONE' && tier !== 'NONE') return false;
        return matchesQuery(query, [profile.full_name, profile.email, tier, profile.verified_badge_message, profile.status]);
      })
      .sort((a, b) => {
        const ta = Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(a, '', { allowPendingAck: true }) : 'NONE';
        const tb = Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(b, '', { allowPendingAck: true }) : 'NONE';
        const diff = (tierOrder[ta] ?? 2) - (tierOrder[tb] ?? 2);
        if (diff !== 0) return diff;
        return String(a.full_name || '').localeCompare(String(b.full_name || ''));
      });
    const visible = paginateRows('badges', candidates);
    badgesBody.innerHTML = visible.length ? visible.map((profile) => {
      const tier = Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(profile, '', { allowPendingAck: true }) : 'NONE';
      const active = profile.status === 'ACTIVE';
      const tierPill = tier === 'CREATOR_GREEN'
        ? '<span class="badge-tier-pill is-creator">Creator &amp; verified</span>'
        : (tier === 'BLUE'
          ? '<span class="badge-tier-pill is-blue">Verified blue</span>'
          : '<span class="badge-tier-pill is-none">Unverified</span>');
      const sinceIso = profile.verified_badge_granted_at || profile.created_at;
      const sinceLine = tier !== 'NONE'
        ? (!profile.verified_badge_acknowledged_at && tier !== 'CREATOR_GREEN'
          ? '<small class="field-help">Awaiting user Thank you</small>'
          : (sinceIso ? `<small class="field-help">Since ${Ipon.escapeHtml(Ipon.dateLabel(sinceIso, { dateStyle: 'medium' }))}</small>` : ''))
        : '';
      const creatorNote = profile.verified_badge_message
        ? `<span class="badge-note-preview">${Ipon.escapeHtml(profile.verified_badge_message)}</span>`
        : '<span class="field-help">No message</span>';
      let actions = '';
      if (tier !== 'NONE') {
        actions = `<button class="icon-action" type="button" data-badge-grant="${profile.id}">Edit</button><button class="icon-action danger-action" type="button" data-badge-remove="${profile.id}">Remove</button>`;
      } else if (active) {
        actions = `<button class="icon-action" type="button" data-badge-grant="${profile.id}">Award badge</button>`;
      } else {
        actions = `<span class="field-help">${Ipon.escapeHtml(statusLabel(profile.status))} account</span>`;
      }
      return `<tr data-badge-user-id="${profile.id}">
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile.avatar_url, profile.full_name, 'table-user-avatar', profile.id)}
            <div>
              <strong>${Ipon.escapeHtml(profile.full_name)}${Ipon.verifiedBadgesHtml ? Ipon.verifiedBadgesHtml(profile) : ''}</strong>
              ${profile.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>${tierPill}${sinceLine}</td>
        <td>${formatBadgeDurationCell(profile, tier)}</td>
        <td>${creatorNote}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="empty-state">${query || filter ? 'No matching users.' : 'No user accounts available.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(badgesBody);
    Ipon.syncPresenceDots(badgesBody);
  }

  function toDatetimeLocalValue(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function syncBadgeCustomExpiryVisibility() {
    const isCustom = badgeDurationPreset?.value === 'custom';
    if (badgeCustomExpiryWrap) badgeCustomExpiryWrap.hidden = !isCustom;
    if (badgeCustomExpiry) {
      badgeCustomExpiry.required = Boolean(isCustom);
      Ipon.setFieldError(badgeCustomExpiry, '');
      if (isCustom && !badgeCustomExpiry.value) {
        badgeCustomExpiry.value = toDatetimeLocalValue(new Date(Date.now() + 7 * 86400000).toISOString());
      }
    }
  }

  function openBadgeGrantDialog(profile) {
    if (!profile || !badgeGrantDialog || !badgeGrantForm) return;
    const targetEmail = String(profile.email || '').trim().toLowerCase();
    const targetTier = targetEmail === 'breadspanish231@gmail.com' ? 'CREATOR_GREEN' : 'BLUE';
    const currentTier = Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(profile, '', { allowPendingAck: true }) : 'NONE';
    badgeGrantForm.reset();
    badgeGrantForm.elements.user_id.value = profile.id;
    if (badgeGrantTitle) {
      badgeGrantTitle.textContent = currentTier !== 'NONE' ? 'Update verified badge' : 'Award verified badge';
    }
    if (badgeGrantCopy) {
      badgeGrantCopy.innerHTML = `Assign ${targetTier === 'CREATOR_GREEN' ? 'the creator &amp; green badges' : 'the blue verified badge'} to <strong>${Ipon.escapeHtml(profile.full_name)}</strong>${profile.email ? ` (${Ipon.escapeHtml(profile.email)})` : ''}.`;
    }
    if (badgeGrantPreview) {
      const previewSvg = Ipon.verifiedBadgesHtml ? Ipon.verifiedBadgesHtml(profile, { tier: targetTier }) : '';
      badgeGrantPreview.innerHTML = `<span class="badge-preview-name">${Ipon.escapeHtml(profile.full_name)}${previewSvg}</span><small class="field-help">${targetTier === 'CREATOR_GREEN' ? 'Green seal &amp; crown' : 'Blue seal'}</small>`;
    }
    const isCreatorTarget = targetTier === 'CREATOR_GREEN';
    const permOpt = badgeDurationPreset?.querySelector('option[value="permanent"]');
    if (permOpt) {
      permOpt.textContent = isCreatorTarget
        ? 'Permanent (Lifetime · Exempt from inactivity)'
        : 'Permanent (until 2 months inactive)';
    }
    const policyHintEl = badgeGrantDialog.querySelector('.badge-grant-policy-hint span');
    if (policyHintEl) {
      policyHintEl.textContent = isCreatorTarget
        ? 'Creator badges are lifetime permanent and exempt from inactivity removal.'
        : 'Only Permanent badges require activity (auto-removed after 2 months inactive).';
    }
    if (badgeDurationPreset) {
      if (isCreatorTarget) {
        badgeDurationPreset.value = 'permanent';
      } else if (currentTier !== 'NONE' && !profile.verified_badge_expires_at) {
        badgeDurationPreset.value = 'permanent';
      } else if (profile.verified_badge_expires_at) {
        badgeDurationPreset.value = 'custom';
        if (badgeCustomExpiry) badgeCustomExpiry.value = toDatetimeLocalValue(profile.verified_badge_expires_at);
      } else {
        badgeDurationPreset.value = '30';
      }
    }
    if (badgeCreatorMessage) {
      badgeCreatorMessage.value = profile.verified_badge_message || '';
      Ipon.setFieldError(badgeCreatorMessage, '');
    }
    if (badgeGrantSubmit) {
      badgeGrantSubmit.textContent = currentTier !== 'NONE' ? 'Save badge' : 'Award badge';
    }
    syncBadgeCustomExpiryVisibility();
    badgeGrantDialog.showModal();
  }

  function openBadgeRemoveDialog(profile) {
    if (!profile || !badgeRemoveDialog || !badgeRemoveForm) return;
    badgeRemoveForm.reset();
    badgeRemoveForm.elements.user_id.value = profile.id;
    if (badgeRemoveCopy) {
      badgeRemoveCopy.textContent = `Remove ${profile.full_name}'s verified badge. They will receive a silent notification with your reason.`;
    }
    if (badgeRemoveReason) Ipon.setFieldError(badgeRemoveReason, '');
    badgeRemoveDialog.showModal();
    badgeRemoveReason?.focus();
  }

  badgeDurationPreset?.addEventListener('change', syncBadgeCustomExpiryVisibility);
  document.getElementById('badge-grant-close')?.addEventListener('click', () => badgeGrantDialog?.close());
  document.getElementById('badge-grant-cancel')?.addEventListener('click', () => badgeGrantDialog?.close());
  document.getElementById('badge-remove-close')?.addEventListener('click', () => badgeRemoveDialog?.close());
  document.getElementById('badge-remove-cancel')?.addEventListener('click', () => badgeRemoveDialog?.close());

  badgesBody?.addEventListener('click', (event) => {
    const grantBtn = event.target.closest('[data-badge-grant]');
    const removeBtn = event.target.closest('[data-badge-remove]');
    const id = grantBtn?.dataset.badgeGrant || removeBtn?.dataset.badgeRemove;
    if (!id) return;
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    if (grantBtn) openBadgeGrantDialog(profile);
    else if (removeBtn) openBadgeRemoveDialog(profile);
  });

  badgeGrantForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = badgeGrantForm.elements.user_id.value;
    const preset = badgeDurationPreset?.value || 'permanent';
    let durationDays = null;
    let expiresAt = null;
    if (preset === 'custom') {
      const raw = String(badgeCustomExpiry?.value || '').trim();
      const dt = raw ? new Date(raw) : null;
      if (!dt || Number.isNaN(dt.getTime()) || dt.getTime() <= Date.now() + 60000) {
        Ipon.setFieldError(badgeCustomExpiry, 'Select an expiration date and time at least 1 minute in the future.');
        badgeCustomExpiry?.focus();
        return;
      }
      expiresAt = dt.toISOString();
    } else if (preset !== 'permanent') {
      durationDays = Number(preset);
    }
    const creatorMsg = String(badgeCreatorMessage?.value || '').trim();
    const targetProfile = profiles.find((item) => item.id === userId);
    const recipientLabel = targetProfile
      ? `${targetProfile.full_name}${targetProfile.email ? ` (${targetProfile.email})` : ''}`
      : 'this user';
    const currentTier = targetProfile
      ? (Ipon.effectiveVerifiedBadgeTier ? Ipon.effectiveVerifiedBadgeTier(targetProfile, '', { allowPendingAck: true }) : 'NONE')
      : 'NONE';
    const isUpdate = currentTier !== 'NONE';
    const isCreatorTarget = String(targetProfile?.email || '').trim().toLowerCase() === 'breadspanish231@gmail.com';
    const durationSummary = preset === 'permanent'
      ? (isCreatorTarget ? 'Permanent — lifetime, exempt from inactivity' : 'Permanent — auto-removes after 2 months inactive')
      : (preset === 'custom'
        ? `Until ${Ipon.dateLabel(expiresAt, { dateStyle: 'medium', timeStyle: 'short' })}`
        : `${durationDays} days`);
    const accepted = await Ipon.confirmAction({
      title: isUpdate ? 'Save verified badge changes?' : 'Award verified badge?',
      message: `${isUpdate ? 'Update' : 'Award'} the verified badge for ${recipientLabel} (${durationSummary})?${creatorMsg ? ' Your creator message will be shown in their celebration pop-up.' : ''}`,
      acceptLabel: isUpdate ? 'Save badge' : 'Award badge'
    });
    if (!accepted) return;
    Ipon.setBusy(badgeGrantSubmit, true, 'Saving…');
    try {
      await Ipon.rpc('super_admin_grant_verified_badge', {
        p_user_id: userId,
        p_duration_days: durationDays,
        p_expires_at: expiresAt,
        p_creator_message: creatorMsg
      });
      await Ipon.refreshVerifiedBadgesCache?.({ force: true });
      badgeGrantDialog?.close();
      Ipon.toast('Verified badge saved and recipient notified.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(badgeGrantSubmit, false);
    }
  });

  badgeRemoveForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = badgeRemoveForm.elements.user_id.value;
    const reason = String(badgeRemoveReason?.value || '').trim();
    if (reason.length < 2) {
      Ipon.setFieldError(badgeRemoveReason, 'Enter a reason explaining why the verified badge is being removed.');
      badgeRemoveReason?.focus();
      return;
    }
    const targetProfile = profiles.find((item) => item.id === userId);
    const recipientLabel = targetProfile
      ? `${targetProfile.full_name}${targetProfile.email ? ` (${targetProfile.email})` : ''}`
      : 'this user';
    const accepted = await Ipon.confirmAction({
      title: 'Remove verified badge?',
      message: `Remove the verified badge from ${recipientLabel}? They will receive a silent notification with your reason.`,
      acceptLabel: 'Remove badge'
    });
    if (!accepted) return;
    Ipon.setBusy(badgeRemoveSubmit, true, 'Removing…');
    try {
      await Ipon.rpc('super_admin_remove_verified_badge', {
        p_user_id: userId,
        p_reason: reason
      });
      await Ipon.refreshVerifiedBadgesCache?.({ force: true });
      badgeRemoveDialog?.close();
      Ipon.toast('Verified badge removed. User notified.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(badgeRemoveSubmit, false);
    }
  });

  function userEffectGrants(userId) {
    return profileEffectGrants.filter((row) => String(row?.user_id || '') === String(userId || ''));
  }

  function syncEffectsSubtabUi() {
    const pendingCount = profileEffectTrialRequests.filter((row) => row?.status === 'PENDING').length;
    const resolvedTab = activeEffectsSubtab || (pendingCount > 0 ? 'requests' : 'rewards');
    if (effectsReqBadge) {
      effectsReqBadge.textContent = String(pendingCount);
      effectsReqBadge.hidden = false;
    }
    if (effectsTabRequests) effectsTabRequests.setAttribute('aria-selected', String(resolvedTab === 'requests'));
    if (effectsTabRewards) effectsTabRewards.setAttribute('aria-selected', String(resolvedTab === 'rewards'));
    if (effectsRequestsWrap) effectsRequestsWrap.hidden = resolvedTab !== 'requests';
    if (effectsRewardsWrap) effectsRewardsWrap.hidden = resolvedTab !== 'rewards';
  }

  function renderEffectTrialRequests() {
    if (!effectRequestsBody) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const query = filterValue('effect-requests-search');
    const filter = filterValue('effect-requests-status-filter') || 'PENDING';
    const candidates = profileEffectTrialRequests
      .filter((req) => {
        if (!req) return false;
        const status = String(req.status || 'PENDING').toUpperCase();
        if (filter !== 'ALL' && status !== filter) return false;
        const meta = api?.getEffect ? api.getEffect(req.effect_id) : { name: req.effect_id, cat: '' };
        return matchesQuery(query, [req.full_name, req.email, meta.name, meta.cat, req.request_note, req.review_note, status]);
      })
      .sort((a, b) => {
        const rank = (s) => (s === 'PENDING' ? 0 : s === 'APPROVED' ? 1 : 2);
        const ra = rank(String(a.status || 'PENDING').toUpperCase());
        const rb = rank(String(b.status || 'PENDING').toUpperCase());
        if (ra !== rb) return ra - rb;
        return Date.parse(b.created_at || '') - Date.parse(a.created_at || '');
      });
    const visible = paginateRows('effect-requests', candidates);
    effectRequestsBody.innerHTML = visible.length ? visible.map((req) => {
      const status = String(req.status || 'PENDING').toUpperCase();
      const meta = api?.getEffect ? api.getEffect(req.effect_id) : { name: req.effect_id, cat: 'Special', rare: 0 };
      const rarLabel = meta.rare && api?.RARITIES?.[meta.rare] ? ` · ${api.RARITIES[meta.rare]}` : '';
      const statusHtml = status === 'PENDING'
        ? `<span class="effect-trial-status-pill is-pending">Pending review</span><small class="field-help">Requested ${Ipon.dateLabel(req.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>`
        : status === 'APPROVED'
          ? `<span class="effect-trial-status-pill is-approved">Approved trial</span><small class="field-help">${req.trial_expires_at ? `Expires ${Ipon.dateLabel(req.trial_expires_at, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Approved'}</small>`
          : status === 'REJECTED'
            ? `<span class="effect-trial-status-pill is-rejected">Declined</span><small class="field-help">${req.review_note ? Ipon.escapeHtml(req.review_note) : 'Declined by Super Admin'}</small>`
            : `<span class="effect-trial-status-pill is-cancelled">Cancelled</span><small class="field-help">Withdrawn by user</small>`;
      const actionsHtml = status === 'PENDING'
        ? `<button class="icon-action" type="button" data-trial-approve="${Ipon.escapeHtml(req.id)}">Approve</button><button class="icon-action danger-action" type="button" data-trial-reject="${Ipon.escapeHtml(req.id)}">Decline</button>`
        : `<span class="field-help">${req.reviewed_at ? `Reviewed ${Ipon.dateLabel(req.reviewed_at, { dateStyle: 'medium' })}` : 'Processed'}</span>`;
      return `<tr data-trial-req-id="${Ipon.escapeHtml(req.id)}">
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(req.avatar_url, req.full_name || 'User', 'table-user-avatar', req.user_id)}
            <div>
              <strong>${Ipon.escapeHtml(req.full_name || 'User')}</strong>
              ${req.email ? `<small class="field-help">${Ipon.escapeHtml(req.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>
          <span class="effect-table-pill${meta.rare === 3 ? ' is-mythic' : meta.rare === 2 ? ' is-epic' : meta.rare === 1 ? ' is-rare' : ''}">${Ipon.escapeHtml(meta.name)}</span>
          <small class="field-help">${Ipon.escapeHtml(meta.cat + rarLabel)}</small>
        </td>
        <td>${req.request_note ? `<span class="effect-trial-note-preview">${Ipon.escapeHtml(req.request_note)}</span>` : '<span class="field-help">No note attached</span>'}</td>
        <td>${statusHtml}</td>
        <td><div class="table-actions">${actionsHtml}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="empty-state">${query || filter !== 'PENDING' ? 'No matching trial requests.' : 'No pending profile effect trial requests.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(effectRequestsBody);
    Ipon.syncPresenceDots(effectRequestsBody);
  }

  function renderEffects() {
    syncEffectsSubtabUi();
    renderEffectTrialRequests();
    if (!effectsBody) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const query = filterValue('effects-search');
    const filter = filterValue('effects-status-filter');
    const candidates = profiles
      .filter((profile) => {
        if (!profile || profile.role === 'SUPER_ADMIN') return false;
        const grants = userEffectGrants(profile.id);
        const equipped = api?.normalizeEffectId ? api.normalizeEffectId(profile.equipped_profile_effect) : (profile.equipped_profile_effect || 'none');
        if (filter === 'UNLOCKED' && !grants.length) return false;
        if (filter === 'EQUIPPED' && equipped === 'none') return false;
        if (filter === 'TRIAL' && !grants.some((g) => g.is_permanent === false)) return false;
        if (filter === 'NONE' && grants.length > 0) return false;
        const effectNames = grants.map((g) => api?.getEffect ? api.getEffect(g.effect_id).name : g.effect_id).join(' ');
        const latestNote = grants[0]?.grant_message || '';
        return matchesQuery(query, [profile.full_name, profile.email, effectNames, equipped, latestNote, profile.status]);
      })
      .sort((a, b) => {
        const ga = userEffectGrants(a.id).length;
        const gb = userEffectGrants(b.id).length;
        if (gb !== ga) return gb - ga;
        return String(a.full_name || '').localeCompare(String(b.full_name || ''));
      });
    const visible = paginateRows('effects', candidates);
    effectsBody.innerHTML = visible.length ? visible.map((profile) => {
      const grants = userEffectGrants(profile.id);
      const active = profile.status === 'ACTIVE';
      const equippedId = api?.normalizeEffectId ? api.normalizeEffectId(profile.equipped_profile_effect) : (profile.equipped_profile_effect || 'none');
      const equippedMeta = equippedId !== 'none' && api?.getEffect ? api.getEffect(equippedId) : null;
      const permCount = grants.filter((g) => g.is_permanent !== false).length;
      const trialCount = grants.filter((g) => g.is_permanent === false).length;
      const unlockedHtml = grants.length
        ? `<div class="effect-table-pills">${grants.map((g) => {
          const meta = api?.getEffect ? api.getEffect(g.effect_id) : { name: g.effect_id, rare: 0 };
          const isEq = equippedId === g.effect_id;
          const isTrial = g.is_permanent === false;
          const label = isTrial && g.expires_at
            ? `${meta.name} (Trial · ${Ipon.dateLabel(g.expires_at, { dateStyle: 'short' })})`
            : isTrial ? `${meta.name} (Trial)` : meta.name;
          return `<span class="effect-table-pill${isEq ? ' is-equipped' : ''}${isTrial ? ' is-trial' : meta.rare === 3 ? ' is-mythic' : meta.rare === 2 ? ' is-epic' : meta.rare === 1 ? ' is-rare' : ''}">${Ipon.escapeHtml(label)}</span>`;
        }).join('')}</div><small class="field-help">${[
          permCount ? `${permCount} permanent` : '',
          trialCount ? `${trialCount} active trial` : '',
          grants.some((g) => !g.acknowledged_at) ? 'Awaiting claim' : ''
        ].filter(Boolean).join(' · ')}</small>`
        : '<span class="badge-tier-pill is-none">No effects</span>';
      const activeHtml = equippedMeta
        ? `<span class="badge-duration-pill is-permanent">${Ipon.escapeHtml(equippedMeta.name)}</span><small class="field-help">Active on profile</small>`
        : '<span class="field-help">No effect equipped</span>';
      const latestNote = grants.find((g) => g.grant_message)?.grant_message;
      const noteHtml = latestNote
        ? `<span class="badge-note-preview">${Ipon.escapeHtml(latestNote)}</span>`
        : '<span class="field-help">No message</span>';
      let actions = '';
      if (active) {
        actions += `<button class="icon-action" type="button" data-effect-grant="${profile.id}">${grants.length ? 'Award more' : 'Award effect'}</button>`;
      } else {
        actions += `<span class="field-help">${Ipon.escapeHtml(statusLabel(profile.status))} account</span>`;
      }
      if (grants.length) {
        actions += `<button class="icon-action danger-action" type="button" data-effect-remove="${profile.id}">Remove</button>`;
      }
      return `<tr data-effect-user-id="${profile.id}">
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile.avatar_url, profile.full_name, 'table-user-avatar', profile.id)}
            <div>
              <strong>${Ipon.escapeHtml(profile.full_name)}${Ipon.verifiedBadgesHtml ? Ipon.verifiedBadgesHtml(profile) : ''}</strong>
              ${profile.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>${unlockedHtml}</td>
        <td>${activeHtml}</td>
        <td>${noteHtml}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="empty-state">${query || filter ? 'No matching users.' : 'No user accounts available.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(effectsBody);
    Ipon.syncPresenceDots(effectsBody);
  }

  function syncCustomExpiryControl(presetEl, wrapEl, inputEl, defaultDays = 7) {
    const isCustom = presetEl?.value === 'custom';
    if (wrapEl) wrapEl.hidden = !isCustom;
    if (inputEl) {
      inputEl.required = Boolean(isCustom);
      Ipon.setFieldError(inputEl, '');
      if (isCustom && !inputEl.value) {
        inputEl.value = toDatetimeLocalValue(new Date(Date.now() + defaultDays * 86400000).toISOString());
      }
    }
  }

  function readEffectDurationInput(presetEl, inputEl, { defaultPreset = 'permanent' } = {}) {
    const preset = String(presetEl?.value || defaultPreset);
    if (preset === 'permanent') {
      return { valid: true, isPermanent: true, durationDays: null, expiresAt: null, label: 'Permanent' };
    }
    if (preset === 'custom') {
      const raw = String(inputEl?.value || '').trim();
      const parsedMs = raw ? new Date(raw).getTime() : NaN;
      if (!raw || !Number.isFinite(parsedMs) || parsedMs <= Date.now() + 5 * 60000) {
        Ipon.setFieldError(inputEl, 'Select an expiration date and time at least 5 minutes in the future.');
        inputEl?.focus();
        return { valid: false };
      }
      Ipon.setFieldError(inputEl, '');
      const iso = new Date(parsedMs).toISOString();
      return {
        valid: true,
        isPermanent: false,
        durationDays: null,
        expiresAt: iso,
        label: `until ${Ipon.dateLabel(iso, { dateStyle: 'medium', timeStyle: 'short' })}`
      };
    }
    const days = Number.parseInt(preset, 10) || 7;
    return {
      valid: true,
      isPermanent: false,
      durationDays: days,
      expiresAt: null,
      label: `${days} day${days === 1 ? '' : 's'}`
    };
  }

  function syncEffectGrantDurationUi() {
    syncCustomExpiryControl(effectDurationPreset, effectCustomExpiryWrap, effectCustomExpiry, 7);
    const isPerm = (effectDurationPreset?.value || 'permanent') === 'permanent';
    if (effectGrantPolicyText) {
      effectGrantPolicyText.textContent = isPerm
        ? 'Permanent reward · Grants the selected profile effect(s) permanently to this user.'
        : 'Trial card · Active until expiration, then automatically removed from this user.';
    }
    if (effectGrantSubmit) {
      effectGrantSubmit.textContent = isPerm ? 'Award effect' : 'Award trial card';
    }
    const curSub = effectGrantPreviewSub?.textContent || '';
    if (effectGrantPreviewSub && curSub.includes(' · ')) {
      const base = curSub.replace(/\s·\s(Permanent|Trial.*)$/, '');
      effectGrantPreviewSub.textContent = `${base} · ${isPerm ? 'Permanent' : 'Trial card'}`;
    }
  }

  function closeEffectGrantDialog() {
    effectPreviewStageCtrl?.destroy?.();
    effectPreviewStageCtrl = null;
    effectGrantDialog?.close?.();
  }

  function openEffectGrantDialog(profile) {
    if (!profile || !effectGrantDialog || !effectGrantForm) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const allEffects = api?.EFFECTS || [];
    const rarities = api?.RARITIES || ['Common', 'Rare', 'Epic', 'Mythic'];
    const grants = userEffectGrants(profile.id);
    const ownedIds = new Set(grants.filter((g) => g.is_permanent !== false).map((g) => g.effect_id));
    const trialIds = new Set(grants.filter((g) => g.is_permanent === false).map((g) => g.effect_id));
    effectGrantForm.reset();
    effectGrantForm.elements.user_id.value = profile.id;
    if (effectDurationPreset) effectDurationPreset.value = 'permanent';
    if (effectGrantError) effectGrantError.textContent = '';
    if (effectGrantCopy) {
      effectGrantCopy.innerHTML = `Grant permanent effects or a limited-time trial card to <strong>${Ipon.escapeHtml(profile.full_name)}</strong>${profile.email ? ` (${Ipon.escapeHtml(profile.email)})` : ''}.`;
    }
    if (effectGrantPreviewAvatar) {
      effectGrantPreviewAvatar.innerHTML = Ipon.isSafeImageRef?.(profile.avatar_url)
        ? `<img src="${Ipon.escapeHtml(profile.avatar_url)}" alt="${Ipon.escapeHtml(profile.full_name)}" data-avatar-img><span class="avatar-fallback-inner" hidden>${Ipon.escapeHtml(Ipon.initials(profile.full_name))}</span>`
        : `<span>${Ipon.escapeHtml(Ipon.initials(profile.full_name))}</span>`;
      Ipon.bindAvatarFallbacks(effectGrantPreviewAvatar);
    }

    const firstUnowned = allEffects.find((item) => !ownedIds.has(item.id)) || allEffects[0];
    let previewId = firstUnowned?.id || 'stardust';
    if (effectGrantGrid) {
      effectGrantGrid.innerHTML = allEffects.map((e) => {
        const isOwned = ownedIds.has(e.id);
        const isTrial = !isOwned && trialIds.has(e.id);
        const rarText = e.rare ? ` · ${rarities[e.rare] || ''}` : '';
        return `<label class="effect-grant-option${isOwned ? ' is-owned' : ''}" data-preview-option="${Ipon.escapeHtml(e.id)}">
          <input type="checkbox" name="effect_ids" value="${Ipon.escapeHtml(e.id)}"${isOwned ? ' disabled' : ''}>
          <span class="effect-grant-option-meta">
            <strong>${Ipon.escapeHtml(e.name)}</strong>
            <small class="rar${e.rare | 0}">${Ipon.escapeHtml(e.cat + rarText)}</small>
          </span>
          ${isOwned ? '<span class="effect-grant-owned-pill">Owned</span>' : isTrial ? '<span class="effect-table-pill is-trial">Trial</span>' : ''}
        </label>`;
      }).join('');
    }

    const syncSelectedSummary = () => {
      const checked = Array.from(effectGrantGrid?.querySelectorAll('input[name="effect_ids"]:checked') || []);
      if (effectGrantCount) effectGrantCount.textContent = `${checked.length} new selected (${ownedIds.size} already owned)`;
      if (effectGrantSubmit) effectGrantSubmit.disabled = ownedIds.size >= allEffects.length;
    };
    const updatePreview = (id) => {
      previewId = id || 'none';
      const meta = api?.getEffect ? api.getEffect(previewId) : { name: previewId, cat: 'Effect', rare: 0 };
      const rarText = meta.rare ? ` · ${rarities[meta.rare] || ''}` : '';
      const isPerm = (effectDurationPreset?.value || 'permanent') === 'permanent';
      if (effectGrantPreviewName) effectGrantPreviewName.textContent = meta.name;
      if (effectGrantPreviewSub) effectGrantPreviewSub.textContent = `${meta.cat}${rarText} · ${isPerm ? 'Permanent' : 'Trial card'}`;
      effectGrantGrid?.querySelectorAll('[data-preview-option]').forEach((el) => {
        el.classList.toggle('is-previewing', el.dataset.previewOption === previewId);
      });
      effectPreviewStageCtrl?.setEffect(previewId);
    };

    effectGrantGrid?.querySelectorAll('[data-preview-option]').forEach((opt) => {
      opt.addEventListener('click', () => updatePreview(opt.dataset.previewOption));
      opt.querySelector('input')?.addEventListener('change', (ev) => {
        if (effectGrantError) effectGrantError.textContent = '';
        if (ev.target.checked) updatePreview(ev.target.value);
        syncSelectedSummary();
      });
    });

    effectPreviewStageCtrl?.destroy?.();
    effectPreviewStageCtrl = null;
    if (effectGrantPreviewStage && api?.mountStage) {
      effectPreviewStageCtrl = api.mountStage(effectGrantPreviewStage, {
        effectId: previewId,
        geometryFn: (_W, H) => ({ cx: 44, cy: Math.round(H / 2), ra: 26 }),
        fps: 60,
        maxDpr: 2
      });
    }
    syncEffectGrantDurationUi();
    updatePreview(previewId);
    syncSelectedSummary();
    effectGrantDialog.showModal();
    requestAnimationFrame?.(() => effectPreviewStageCtrl?.refreshGeometry?.());
  }

  function openEffectRemoveDialog(profile) {
    if (!profile || !effectRemoveDialog || !effectRemoveForm) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const grants = userEffectGrants(profile.id);
    if (!grants.length) return;
    effectRemoveForm.reset();
    effectRemoveForm.elements.user_id.value = profile.id;
    Ipon.setFieldError(effectRemoveReason, '');
    if (effectRemoveCopy) {
      effectRemoveCopy.innerHTML = `Remove an unlocked profile effect from <strong>${Ipon.escapeHtml(profile.full_name)}</strong>${profile.email ? ` (${Ipon.escapeHtml(profile.email)})` : ''}.`;
    }
    if (effectRemoveSelect) {
      effectRemoveSelect.innerHTML = grants.map((g) => {
        const meta = api?.getEffect ? api.getEffect(g.effect_id) : { name: g.effect_id };
        const isEq = profile.equipped_profile_effect === g.effect_id;
        const kind = g.is_permanent === false ? ' · Trial' : '';
        return `<option value="${Ipon.escapeHtml(g.effect_id)}">${Ipon.escapeHtml(meta.name + kind)}${isEq ? ' (Currently equipped)' : ''}</option>`;
      }).join('');
    }
    effectRemoveDialog.showModal();
  }

  effectDurationPreset?.addEventListener('change', syncEffectGrantDurationUi);
  document.getElementById('effect-grant-close')?.addEventListener('click', closeEffectGrantDialog);
  document.getElementById('effect-grant-cancel')?.addEventListener('click', closeEffectGrantDialog);
  effectGrantDialog?.addEventListener('cancel', () => { closeEffectGrantDialog(); });
  document.getElementById('effect-remove-close')?.addEventListener('click', () => effectRemoveDialog?.close());
  document.getElementById('effect-remove-cancel')?.addEventListener('click', () => effectRemoveDialog?.close());

  effectsBody?.addEventListener('click', (event) => {
    const grantBtn = event.target.closest('[data-effect-grant]');
    const removeBtn = event.target.closest('[data-effect-remove]');
    const id = grantBtn?.dataset.effectGrant || removeBtn?.dataset.effectRemove;
    if (!id) return;
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    if (grantBtn) openEffectGrantDialog(profile);
    else if (removeBtn) openEffectRemoveDialog(profile);
  });

  effectGrantForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = effectGrantForm.elements.user_id.value;
    const selectedIds = Array.from(effectGrantGrid?.querySelectorAll('input[name="effect_ids"]:checked') || []).map((el) => el.value);
    if (!selectedIds.length) {
      if (effectGrantError) effectGrantError.textContent = 'Select at least one new profile effect to award.';
      return;
    }
    const duration = readEffectDurationInput(effectDurationPreset, effectCustomExpiry, { defaultPreset: 'permanent' });
    if (!duration.valid) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const selectedNames = selectedIds.map((id) => (api?.getEffect ? api.getEffect(id).name : id)).join(', ');
    const creatorMsg = String(effectCreatorMessage?.value || '').trim();
    const targetProfile = profiles.find((item) => item.id === userId);
    const recipientLabel = targetProfile
      ? `${targetProfile.full_name}${targetProfile.email ? ` (${targetProfile.email})` : ''}`
      : 'this user';
    const noteSuffix = creatorMsg ? ' Your creator note will be shown in their celebration pop-up.' : '';
    const accepted = await Ipon.confirmAction({
      title: duration.isPermanent
        ? `Award permanent profile effect${selectedIds.length > 1 ? 's' : ''}?`
        : `Award trial card${selectedIds.length > 1 ? 's' : ''}?`,
      message: duration.isPermanent
        ? `Grant ${selectedNames} permanently to ${recipientLabel}?${noteSuffix}`
        : `Grant a trial (${duration.label}) of ${selectedNames} to ${recipientLabel}?${noteSuffix}`,
      acceptLabel: duration.isPermanent
        ? `Award effect${selectedIds.length > 1 ? 's' : ''}`
        : `Award trial card${selectedIds.length > 1 ? 's' : ''}`
    });
    if (!accepted) return;
    Ipon.setBusy(effectGrantSubmit, true, 'Saving…');
    try {
      await Ipon.rpc('super_admin_grant_profile_effects', {
        p_user_id: userId,
        p_effect_ids: selectedIds,
        p_creator_message: creatorMsg,
        p_duration_days: duration.durationDays,
        p_expires_at: duration.expiresAt
      });
      closeEffectGrantDialog();
      Ipon.toast(duration.isPermanent
        ? 'Permanent profile effect(s) awarded and user notified.'
        : `Trial profile effect(s) (${duration.label}) awarded and user notified.`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(effectGrantSubmit, false);
    }
  });

  effectRemoveForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = effectRemoveForm.elements.user_id.value;
    const effectId = String(effectRemoveSelect?.value || '').trim();
    const reason = String(effectRemoveReason?.value || '').trim();
    if (reason.length < 2) {
      Ipon.setFieldError(effectRemoveReason, 'Enter a brief reason explaining why this effect is being removed.');
      effectRemoveReason?.focus();
      return;
    }
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const effectName = api?.getEffect ? api.getEffect(effectId).name : effectId;
    const targetProfile = profiles.find((item) => item.id === userId);
    const recipientLabel = targetProfile
      ? `${targetProfile.full_name}${targetProfile.email ? ` (${targetProfile.email})` : ''}`
      : 'this user';
    const accepted = await Ipon.confirmAction({
      title: `Remove "${effectName}"?`,
      message: `Remove profile effect "${effectName}" from ${recipientLabel}? They will receive a silent notification with your reason.`,
      acceptLabel: 'Remove effect'
    });
    if (!accepted) return;
    Ipon.setBusy(effectRemoveSubmit, true, 'Removing…');
    try {
      await Ipon.rpc('super_admin_revoke_profile_effect', {
        p_user_id: userId,
        p_effect_id: effectId,
        p_reason: reason
      });
      effectRemoveDialog?.close();
      Ipon.toast('Profile effect removed. User notified.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(effectRemoveSubmit, false);
    }
  });

  function closeEffectTrialApproveDialog() {
    effectTrialPreviewStageCtrl?.destroy?.();
    effectTrialPreviewStageCtrl = null;
    effectTrialApproveDialog?.close?.();
  }

  function syncEffectTrialCustomVisibility() {
    syncCustomExpiryControl(effectTrialDurationPreset, effectTrialCustomWrap, effectTrialCustomExpiry, 7);
  }

  function openEffectTrialApproveDialog(req) {
    if (!req || !effectTrialApproveDialog || !effectTrialApproveForm) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const meta = api?.getEffect ? api.getEffect(req.effect_id) : { id: req.effect_id, name: req.effect_id, cat: 'Special', rare: 0 };
    const rarities = api?.RARITIES || ['Common', 'Rare', 'Epic', 'Mythic'];
    const rarText = meta.rare ? ` · ${rarities[meta.rare] || ''}` : '';
    effectTrialApproveForm.reset();
    effectTrialApproveForm.elements.request_id.value = req.id;
    if (effectTrialDurationPreset) effectTrialDurationPreset.value = '7';
    syncEffectTrialCustomVisibility();
    if (effectTrialApproveCopy) {
      effectTrialApproveCopy.innerHTML = `Set a trial duration for <strong>${Ipon.escapeHtml(req.full_name || 'User')}</strong>${req.email ? ` (${Ipon.escapeHtml(req.email)})` : ''}.`;
    }
    if (effectTrialPreviewAvatar) {
      effectTrialPreviewAvatar.innerHTML = Ipon.isSafeImageRef?.(req.avatar_url)
        ? `<img src="${Ipon.escapeHtml(req.avatar_url)}" alt="${Ipon.escapeHtml(req.full_name || 'User')}" data-avatar-img><span class="avatar-fallback-inner" hidden>${Ipon.escapeHtml(Ipon.initials(req.full_name || 'User'))}</span>`
        : `<span>${Ipon.escapeHtml(Ipon.initials(req.full_name || 'User'))}</span>`;
      Ipon.bindAvatarFallbacks(effectTrialPreviewAvatar);
    }
    if (effectTrialPreviewName) effectTrialPreviewName.textContent = meta.name;
    if (effectTrialPreviewSub) effectTrialPreviewSub.textContent = `${meta.cat}${rarText} · Trial Preview`;
    if (effectTrialReqNote && effectTrialReqNoteText) {
      const note = String(req.request_note || '').trim();
      effectTrialReqNote.hidden = !note;
      effectTrialReqNoteText.textContent = note ? `User note: "${note}"` : '';
    }
    effectTrialPreviewStageCtrl?.destroy?.();
    effectTrialPreviewStageCtrl = null;
    if (effectTrialPreviewStage && api?.mountStage) {
      effectTrialPreviewStageCtrl = api.mountStage(effectTrialPreviewStage, {
        effectId: req.effect_id,
        geometryFn: (_W, H) => ({ cx: 44, cy: Math.round(H / 2), ra: 26 }),
        fps: 60,
        maxDpr: 2
      });
    }
    effectTrialApproveDialog.showModal();
    requestAnimationFrame?.(() => effectTrialPreviewStageCtrl?.refreshGeometry?.());
  }

  function openEffectTrialRejectDialog(req) {
    if (!req || !effectTrialRejectDialog || !effectTrialRejectForm) return;
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const meta = api?.getEffect ? api.getEffect(req.effect_id) : { name: req.effect_id };
    effectTrialRejectForm.reset();
    effectTrialRejectForm.elements.request_id.value = req.id;
    Ipon.setFieldError(effectTrialRejectReason, '');
    if (effectTrialRejectCopy) {
      effectTrialRejectCopy.innerHTML = `Decline the <strong>${Ipon.escapeHtml(meta.name)}</strong> trial request from <strong>${Ipon.escapeHtml(req.full_name || 'User')}</strong>.`;
    }
    effectTrialRejectDialog.showModal();
  }

  effectsSubtabs?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-effects-tab]');
    if (!btn) return;
    activeEffectsSubtab = btn.dataset.effectsTab === 'requests' ? 'requests' : 'rewards';
    syncEffectsSubtabUi();
  });

  effectRequestsBody?.addEventListener('click', (event) => {
    const approveBtn = event.target.closest('[data-trial-approve]');
    const rejectBtn = event.target.closest('[data-trial-reject]');
    const id = approveBtn?.dataset.trialApprove || rejectBtn?.dataset.trialReject;
    if (!id) return;
    const req = profileEffectTrialRequests.find((row) => String(row.id) === String(id));
    if (!req) return;
    if (approveBtn) openEffectTrialApproveDialog(req);
    else if (rejectBtn) openEffectTrialRejectDialog(req);
  });

  effectTrialDurationPreset?.addEventListener('change', syncEffectTrialCustomVisibility);
  document.getElementById('effect-trial-approve-close')?.addEventListener('click', closeEffectTrialApproveDialog);
  document.getElementById('effect-trial-approve-cancel')?.addEventListener('click', closeEffectTrialApproveDialog);
  effectTrialApproveDialog?.addEventListener('cancel', () => closeEffectTrialApproveDialog());
  document.getElementById('effect-trial-reject-close')?.addEventListener('click', () => effectTrialRejectDialog?.close());
  document.getElementById('effect-trial-reject-cancel')?.addEventListener('click', () => effectTrialRejectDialog?.close());

  effectTrialApproveForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const requestId = effectTrialApproveForm.elements.request_id.value;
    const req = profileEffectTrialRequests.find((row) => String(row.id) === String(requestId));
    const api = typeof window !== 'undefined' ? window.IponProfileEffects : null;
    const effectName = req ? (api?.getEffect ? api.getEffect(req.effect_id).name : req.effect_id) : 'this profile effect';
    const duration = readEffectDurationInput(effectTrialDurationPreset, effectTrialCustomExpiry, { defaultPreset: '7' });
    if (!duration.valid) return;
    const creatorMsg = String(effectTrialCreatorMessage?.value || '').trim();
    const recipientLabel = req ? `${req.full_name || 'User'}${req.email ? ` (${req.email})` : ''}` : 'this user';
    const accepted = await Ipon.confirmAction({
      title: `Approve "${effectName}" trial?`,
      message: `Start a trial (${duration.label}) of "${effectName}" for ${recipientLabel}? They will see the celebration pop-up and begin a 1-month cooldown.`,
      acceptLabel: 'Approve trial'
    });
    if (!accepted) return;
    Ipon.setBusy(effectTrialApproveSubmit, true, 'Approving…');
    try {
      await Ipon.rpc('super_admin_review_effect_trial_request', {
        p_request_id: requestId,
        p_decision: 'APPROVE',
        p_duration_days: duration.durationDays,
        p_expires_at: duration.expiresAt,
        p_creator_message: creatorMsg
      });
      closeEffectTrialApproveDialog();
      Ipon.toast(`Trial approved for "${effectName}" (${duration.label}).`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(effectTrialApproveSubmit, false);
    }
  });

  effectTrialRejectForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const requestId = effectTrialRejectForm.elements.request_id.value;
    const reason = String(effectTrialRejectReason?.value || '').trim();
    if (reason.length < 2) {
      Ipon.setFieldError(effectTrialRejectReason, 'Enter a brief reason explaining why this trial request was declined.');
      effectTrialRejectReason?.focus();
      return;
    }
    Ipon.setFieldError(effectTrialRejectReason, '');
    const req = profileEffectTrialRequests.find((row) => String(row.id) === String(requestId));
    const accepted = await Ipon.confirmAction({
      title: 'Decline trial request?',
      message: `Decline this trial request from ${req?.full_name || 'this user'}? They can still submit another trial request later.`,
      acceptLabel: 'Decline request'
    });
    if (!accepted) return;
    Ipon.setBusy(effectTrialRejectSubmit, true, 'Declining…');
    try {
      await Ipon.rpc('super_admin_review_effect_trial_request', {
        p_request_id: requestId,
        p_decision: 'REJECT',
        p_duration_days: null,
        p_expires_at: null,
        p_creator_message: reason
      });
      effectTrialRejectDialog?.close();
      Ipon.toast('Trial request declined and user notified.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(effectTrialRejectSubmit, false);
    }
  });

  function updateFeatureCounts() {
    const counts = { ALL: featureRequests.length, PENDING: 0, IMPLEMENTED: 0, REJECTED: 0 };
    featureRequests.forEach((req) => {
      const st = req.status || 'PENDING';
      if (counts[st] !== undefined) counts[st]++;
    });
    const allEl = document.getElementById('count-feat-all');
    const pendEl = document.getElementById('count-feat-pending');
    const implEl = document.getElementById('count-feat-implemented');
    const rejEl = document.getElementById('count-feat-rejected');
    if (allEl) allEl.textContent = counts.ALL;
    if (pendEl) pendEl.textContent = counts.PENDING;
    if (implEl) implEl.textContent = counts.IMPLEMENTED;
    if (rejEl) rejEl.textContent = counts.REJECTED;
  }

  function renderFeatureRequests() {
    updateFeatureCounts();
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const query = filterValue('feature-requests-search');
    const filtered = featureRequests.filter((request) => {
      const status = request.status || 'PENDING';
      if (activeFeatureStatusFilter !== 'ALL' && status !== activeFeatureStatusFilter) return false;
      const profile = profileById.get(request.requester_id);
      return matchesQuery(query, [profile?.full_name, profile?.email, profile?.role, request.title, request.details, status, request.release_version]);
    });
    const visible = paginateRows('feature-requests', filtered);

    if (featureCardsContainer) {
      featureCardsContainer.innerHTML = visible.length ? visible.map((request) => {
        const profile = profileById.get(request.requester_id);
        const requesterName = profile?.full_name || 'Former user';
        const status = request.status || 'PENDING';
        const creditBadge = request.allow_credit !== false
          ? '<span class="credit-consent-badge is-allowed" title="User consented to credit in release updates">Credit OK</span>'
          : '<span class="credit-consent-badge is-denied" title="User opted out of credit attribution">No credit</span>';
        const statusPill = status === 'IMPLEMENTED'
          ? `<span class="status-pill status-implemented">Implemented</span>${request.release_version ? `<br><small class="version-tag">${Ipon.escapeHtml(request.release_version)}</small>` : ''}`
          : status === 'REJECTED'
            ? '<span class="status-pill status-rejected">Rejected</span>'
            : '<span class="status-pill status-pending">Pending</span>';

        let actions = '';
        if (status !== 'IMPLEMENTED') {
          actions += `<button class="icon-action action-implement" type="button" data-feat-action="IMPLEMENTED" data-feat-id="${request.id}">Mark implemented</button>`;
        }
        if (status !== 'REJECTED') {
          actions += `<button class="icon-action danger-action" type="button" data-feat-action="REJECTED" data-feat-id="${request.id}">Reject</button>`;
        }
        if (status !== 'PENDING') {
          actions += `<button class="icon-action" type="button" data-feat-action="PENDING" data-feat-id="${request.id}">Reset to pending</button>`;
        }

        return `<article class="feature-card feature-card-${status.toLowerCase()}" data-feature-id="${request.id}">
          <header class="feature-card-header">
            <div class="feature-card-user">
              ${Ipon.avatarMarkup(profile?.avatar_url, requesterName, 'feature-card-avatar', request.requester_id)}
              <div class="feature-card-user-meta">
                <strong class="feature-card-user-name">${Ipon.escapeHtml(requesterName)}</strong>
                <div class="feature-card-user-sub">
                  <span class="role-badge role-${(profile?.role || 'member').toLowerCase()}">${Ipon.escapeHtml(ROLE_LABELS[profile?.role] || profile?.role || 'Member')}</span>
                  ${creditBadge}
                  ${profile?.email ? `<span class="feature-card-email">${Ipon.escapeHtml(profile.email)}</span>` : ''}
                </div>
              </div>
            </div>
            <div class="feature-card-status-wrap">
              ${statusPill}
            </div>
          </header>
          <div class="feature-card-body">
            <h3 class="feature-card-title">
              <svg class="feature-card-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7ZM9 21a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-1H9v1Z"/></svg>
              <span>${Ipon.escapeHtml(request.title)}</span>
            </h3>
            <p class="feature-card-details">${Ipon.escapeHtml(request.details)}</p>
          </div>
          <footer class="feature-card-footer">
            <time class="feature-card-time" datetime="${request.created_at}">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7v5l3 3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              <span>${Ipon.dateLabel(request.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</span>
            </time>
            <div class="feature-card-actions">${actions}</div>
          </footer>
        </article>`;
      }).join('') : `<div class="empty-state feature-cards-empty">${query || activeFeatureStatusFilter !== 'ALL' ? 'No matching feature requests.' : 'No feature requests yet.'}</div>`;
      Ipon.bindAvatarFallbacks(featureCardsContainer);
      Ipon.syncPresenceDots(featureCardsContainer);
    }

    featureRequestsBody.innerHTML = visible.length ? visible.map((request) => {
      const profile = profileById.get(request.requester_id);
      const requesterName = profile?.full_name || 'Former user';
      const status = request.status || 'PENDING';
      const creditBadge = request.allow_credit !== false
        ? '<span class="credit-consent-badge is-allowed" title="User consented to credit in release updates">Credit OK</span>'
        : '<span class="credit-consent-badge is-denied" title="User opted out of credit attribution">No credit</span>';
      const statusPill = status === 'IMPLEMENTED'
        ? `<span class="status-pill status-implemented">Implemented</span>${request.release_version ? `<br><small class="version-tag">${Ipon.escapeHtml(request.release_version)}</small>` : ''}`
        : status === 'REJECTED'
          ? '<span class="status-pill status-rejected">Rejected</span>'
          : '<span class="status-pill status-pending">Pending</span>';

      let actions = '';
      if (status !== 'IMPLEMENTED') {
        actions += `<button class="icon-action action-implement" type="button" data-feat-action="IMPLEMENTED" data-feat-id="${request.id}">Mark implemented</button>`;
      }
      if (status !== 'REJECTED') {
        actions += `<button class="icon-action danger-action" type="button" data-feat-action="REJECTED" data-feat-id="${request.id}">Reject</button>`;
      }
      if (status !== 'PENDING') {
        actions += `<button class="icon-action" type="button" data-feat-action="PENDING" data-feat-id="${request.id}">Reset to pending</button>`;
      }

      return `<tr data-feature-id="${request.id}">
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile?.avatar_url, requesterName, 'table-user-avatar', request.requester_id)}
            <div>
              <strong>${Ipon.escapeHtml(requesterName)}</strong>
              <div class="table-user-sub">${creditBadge}${profile?.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}</div>
            </div>
          </div>
        </td>
        <td><span class="role-badge role-${(profile?.role || 'member').toLowerCase()}">${Ipon.escapeHtml(ROLE_LABELS[profile?.role] || profile?.role || 'Member')}</span></td>
        <td><strong>${Ipon.escapeHtml(request.title)}</strong></td>
        <td><span class="feature-request-details">${Ipon.escapeHtml(request.details)}</span></td>
        <td>${statusPill}</td>
        <td>${Ipon.dateLabel(request.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">${query || activeFeatureStatusFilter !== 'ALL' ? 'No matching feature requests.' : 'No feature requests yet.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(featureRequestsBody);
    Ipon.syncPresenceDots(featureRequestsBody);
  }

  function updateBugReportCounts() {
    const counts = { ALL: bugReports.length, OPEN: 0, FIXED: 0 };
    bugReports.forEach((report) => {
      const st = (report.status || 'OPEN').toUpperCase();
      if (counts[st] !== undefined) counts[st]++;
    });
    const openEl = document.getElementById('count-bug-open');
    const fixedEl = document.getElementById('count-bug-fixed');
    const allEl = document.getElementById('count-bug-all');
    if (openEl) openEl.textContent = counts.OPEN;
    if (fixedEl) fixedEl.textContent = counts.FIXED;
    if (allEl) allEl.textContent = counts.ALL;
  }

  function renderBugReports() {
    if (!bugReportsBody) return;
    updateBugReportCounts();
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const query = filterValue('bug-reports-search');
    const filtered = bugReports.filter((report) => {
      const status = (report.status || 'OPEN').toUpperCase();
      if (activeBugStatusFilter !== 'ALL' && status !== activeBugStatusFilter) return false;
      const profile = profileById.get(report.reporter_id);
      return matchesQuery(query, [profile?.full_name, profile?.email, profile?.role, ROLE_LABELS[profile?.role], report.title, report.description, status, report.release_version]);
    });
    const visible = paginateRows('bug-reports', filtered);
    bugReportsBody.innerHTML = visible.length ? visible.map((report) => {
      const profile = profileById.get(report.reporter_id);
      const reporterName = profile?.full_name || 'Former user';
      const status = (report.status || 'OPEN').toUpperCase();
      const count = Number(report.image_count || 0);
      const roleCell = profile?.role
        ? `<span class="role-badge role-${profile.role.toLowerCase()}">${Ipon.escapeHtml(ROLE_LABELS[profile.role] || profile.role.replaceAll('_', ' '))}</span>`
        : '<span class="field-help">Unavailable</span>';
      const statusPill = status === 'FIXED'
        ? `<span class="status-pill status-fixed">Fixed</span>${report.release_version ? `<br><small class="version-tag">${Ipon.escapeHtml(report.release_version)}</small>` : '<br><small class="field-help">Queued for release</small>'}`
        : '<span class="status-pill status-open">Open</span>';
      const actionBtn = status === 'FIXED'
        ? `<button class="icon-action" type="button" data-bug-action="OPEN" data-bug-id="${report.id}">Reopen</button>`
        : `<button class="icon-action action-fix-bug" type="button" data-bug-action="FIXED" data-bug-id="${report.id}">Fixed</button>`;
      return `<tr data-bug-id="${report.id}">
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile?.avatar_url, reporterName, 'table-user-avatar', report.reporter_id)}
            <div>
              <strong>${Ipon.escapeHtml(reporterName)}</strong>
              ${profile?.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>${roleCell}</td>
        <td><strong>${Ipon.escapeHtml(report.title)}</strong></td>
        <td><span class="feature-request-details">${Ipon.escapeHtml(report.description)}</span></td>
        <td>${count ? `<button class="icon-action" type="button" data-view-bug="${report.id}">View ${count} picture${count === 1 ? '' : 's'}</button>` : '<span class="field-help">None</span>'}</td>
        <td>${statusPill}</td>
        <td>${Ipon.dateLabel(report.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
        <td><div class="table-actions">${actionBtn}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="8" class="empty-state">${query ? 'No matching bug reports.' : activeBugStatusFilter === 'FIXED' ? 'No fixed bug reports yet.' : activeBugStatusFilter === 'OPEN' ? 'No open bug reports right now.' : 'No bug reports yet.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(bugReportsBody);
    Ipon.syncPresenceDots(bugReportsBody);
  }

  function renderActivity(logs = activityLogs) {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const query = filterValue('activity-search');
    const mapped = logs.map((log) => ({
      event: `${Ipon.auditActionLabel ? Ipon.auditActionLabel(log.action) : `${log.action.charAt(0)}${log.action.slice(1).toLowerCase()}`} ${log.table_name === 'groups' ? 'group' : 'account'}`,
      target: (log.table_name === 'groups' ? groupById.get(log.record_id)?.name : profileById.get(log.record_id)?.full_name) || 'Platform record',
      changedAt: log.changed_at
    }));
    const filtered = mapped.filter((row) => matchesQuery(query, [row.event, row.target]));
    const visible = paginateRows('activity', filtered);
    activityBody.innerHTML = visible.length ? visible.map((row) => `<tr><td><strong>${Ipon.escapeHtml(row.event)}</strong></td><td>${Ipon.escapeHtml(row.target)}</td><td>${Ipon.dateLabel(row.changedAt, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>`).join('') : `<tr><td colspan="3" class="empty-state">${query ? 'No matching platform activity.' : 'No platform activity recorded yet.'}</td></tr>`;
  }

  async function load() {
    overviewError.hidden = true;
    overviewError.replaceChildren();
    await Ipon.rpc('cleanup_inactive_verified_badges').catch(() => {});
    const safeQuery = (query) => (Ipon.withTimeout ? Ipon.withTimeout(query) : Promise.resolve(query)).catch((err) => ({ data: [], error: err }));
    const [profileResult, groupResult, membershipResult, featureRequestResult, bugReportResult, activityResult, logResult, storageResult, effectsResult, effectTrialReqResult] = await Promise.all([
      safeQuery(Ipon.client.from('profiles').select('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,avatar_url,created_at,verified_badge_tier,verified_badge_expires_at,verified_badge_message,verified_badge_granted_at,verified_badge_acknowledged_at,last_seen_at,equipped_profile_effect').order('created_at', { ascending: false })),
      safeQuery(Ipon.client.from('groups').select('id,name,owner_id,status,workspace_mode,created_at').order('created_at', { ascending: false })),
      safeQuery(Ipon.client.from('group_memberships').select('group_id,user_id,role,status')),
      safeQuery(Ipon.client.from('feature_requests').select('id,requester_id,allow_credit,title,details,status,reviewed_at,reviewed_by,release_version,created_at').order('created_at', { ascending: false }).limit(200)),
      safeQuery(Ipon.client.from('bug_reports').select('id,reporter_id,title,description,image_count,status,reviewed_at,release_version,created_at').order('created_at', { ascending: false }).limit(200)),
      safeQuery(Ipon.client.rpc('super_admin_user_last_activities')),
      safeQuery(Ipon.client.from('audit_logs').select('id,table_name,record_id,action,changed_at').in('table_name', ['profiles', 'groups']).order('changed_at', { ascending: false }).limit(200)),
      safeQuery(Ipon.client.rpc('super_admin_storage_overview')),
      safeQuery(Ipon.client.rpc('super_admin_list_profile_effects')),
      safeQuery(Ipon.client.rpc('super_admin_list_effect_trial_requests')),
      announcements ? safeQuery(announcements.load()) : Promise.resolve()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (groupResult.error) throw groupResult.error;
    profiles = profileResult.data || [];
    groups = groupResult.data || [];
    groupMemberships = membershipResult.data || [];
    featureRequests = featureRequestResult.data || [];
    bugReports = bugReportResult.data || [];
    profileEffectGrants = !effectsResult?.error && Array.isArray(effectsResult?.data) ? effectsResult.data : [];
    profileEffectTrialRequests = !effectTrialReqResult?.error && Array.isArray(effectTrialReqResult?.data) ? effectTrialReqResult.data : [];
    if (activityResult?.error) {
      const legacyActivity = await safeQuery(
        Ipon.client.from('account_activity').select('user_id,event,created_at').order('created_at', { ascending: false }).limit(200)
      );
      accountActivities = legacyActivity.data || [];
    } else {
      accountActivities = activityResult.data || [];
    }
    activityLogs = logResult.data || [];
    storageOverview = storageResult?.error ? null : (storageResult?.data || null);
    Ipon.registerVerifiedBadges?.(profiles.filter((p) => p && (p.verified_badge_tier === 'CREATOR_GREEN' || p.verified_badge_acknowledged_at)));
    renderOverview();
    renderStorageOverview();
    renderFeatureRequests();
    renderBugReports();
    renderUsers();
    renderBadges();
    renderEffects();
    renderActivity();
  }

  cleanupReceiptsBtn?.addEventListener('click', async () => {
    const count = Number(storageOverview?.reclaimable_rejected_count || 0);
    if (!count) return;
    const accepted = await Ipon.confirmAction({
      title: `Purge ${count} old rejected/voided receipt${count === 1 ? '' : 's'}?`,
      message: `This removes receipt image attachments from rejected or voided records older than 90 days (${formatBytes(storageOverview?.reclaimable_rejected_bytes)}). Financial amounts, notes, and audit logs remain intact.`,
      acceptLabel: 'Purge old receipts'
    });
    if (!accepted) return;
    Ipon.setBusy(cleanupReceiptsBtn, true, 'Cleaning…');
    try {
      const cleaned = await Ipon.rpc('super_admin_cleanup_rejected_receipts', { p_older_than_days: 90 });
      Ipon.toast(`Removed ${Number(cleaned || 0)} archived receipt image(s).`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(cleanupReceiptsBtn, false);
    }
  });

  runRetentionBtn?.addEventListener('click', async () => {
    const accepted = await Ipon.confirmAction({
      title: 'Run retention & storage cleanup now?',
      message: 'Runs the nightly retention pass immediately: clears 90+ day chat messages/files, expired logs & notifications, drains Storage deletions, and processes 6-month inactive account warnings (7-day email notice before purge).',
      acceptLabel: 'Run retention sweep'
    });
    if (!accepted) return;
    Ipon.setBusy(runRetentionBtn, true, 'Running…');
    try {
      const res = await Ipon.invokeAccountFunction({ action: 'super-admin-run-maintenance' });
      const msgCount = Number(res?.sql_summary?.messages_deleted || 0);
      const storageCount = Number(res?.storage_files_removed || 0);
      const warned = Number(res?.inactive_warned_emails || 0);
      const purged = Number(res?.inactive_users_purged || 0);
      Ipon.toast(`Sweep done: ${msgCount} messages, ${storageCount} storage files, ${warned} warned, ${purged} purged.`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(runRetentionBtn, false);
    }
  });

  function openAccountActionDialog(targetProfile, actionType) {
    if (!accountActionDialog || !accountActionForm) return;
    accountActionForm.reset();
    accountActionUserId.value = targetProfile.id;
    accountActionType.value = actionType;
    accountActionUserName.textContent = targetProfile.full_name || 'User';
    accountActionUserEmail.textContent = targetProfile.email || 'No email address';

    const isDelete = actionType === 'DELETE';
    const isDeact = actionType === 'DEACTIVATE';

    accountActionTitle.textContent = isDelete
      ? 'Delete user account'
      : isDeact
      ? 'Deactivate account'
      : 'Reactivate account';

    accountActionSubtitle.textContent = isDelete
      ? 'Permanently delete this account. An email notification with the reason will be sent to the user.'
      : isDeact
      ? 'Deactivate this account and suspend access. An email notification with the reason will be sent to the user.'
      : 'Reactivate this account so the user can sign in again.';

    accountActionReasonLabel.textContent = isDelete
      ? 'Reason for account deletion'
      : isDeact
      ? 'Reason for deactivation'
      : 'Note (optional)';

    accountActionReason.placeholder = isDelete
      ? 'Explain why this account is being deleted...'
      : isDeact
      ? 'Explain why this account is being deactivated...'
      : 'Optional note regarding reactivation...';

    accountActionReason.required = isDelete || isDeact;
    accountActionSubmit.textContent = isDelete
      ? 'Delete account'
      : isDeact
      ? 'Deactivate account'
      : 'Reactivate account';

    accountActionSubmit.className = isDelete || isDeact
      ? 'button button-danger'
      : 'button button-primary';

    if (accountActionError) accountActionError.hidden = true;
    accountActionDialog.showModal();
    accountActionReason.focus();
  }

  accountActionClose?.addEventListener('click', () => accountActionDialog?.close());
  accountActionCancel?.addEventListener('click', () => accountActionDialog?.close());

  accountActionForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const userId = accountActionUserId.value;
    const actionType = accountActionType.value;
    const reason = accountActionReason.value.trim();

    if ((actionType === 'DELETE' || actionType === 'DEACTIVATE') && reason.length < 3) {
      if (accountActionError) {
        accountActionError.textContent = 'Please enter a reason of at least 3 characters.';
        accountActionError.hidden = false;
      }
      accountActionReason?.focus();
      return;
    }
    if (accountActionError) accountActionError.hidden = true;

    Ipon.setBusy(accountActionSubmit, true, 'Processing…');
    try {
      try {
        await Ipon.notifyAccountStatusChange({
          user_id: userId,
          action_type: actionType,
          reason
        });
      } catch (_) {
        if (actionType === 'DELETE') {
          try {
            await Ipon.rpc('super_admin_delete_user', { p_user_id: userId });
          } catch (_) {
            try {
              await Ipon.rpc('super_admin_set_administrator_status', {
                p_user_id: userId,
                p_status: 'DISABLED'
              });
            } catch (_) {}
            try {
              await Ipon.client.from('groups').update({ status: 'SUSPENDED', owner_id: null }).eq('owner_id', userId);
            } catch (_) {}
            try {
              await Ipon.client.from('group_memberships').delete().eq('user_id', userId);
            } catch (_) {}
            try {
              await Ipon.client.from('profiles').delete().eq('id', userId);
            } catch (_) {}
          }
        } else {
          await Ipon.rpc('super_admin_set_administrator_status', {
            p_user_id: userId,
            p_status: actionType === 'DEACTIVATE' ? 'DISABLED' : 'ACTIVE'
          });
        }
      }

      accountActionDialog.close();
      const actionPast = actionType === 'DELETE' ? 'deleted' : actionType === 'DEACTIVATE' ? 'deactivated' : 'reactivated';
      Ipon.toast(`Account successfully ${actionPast}. User notified by email.`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(accountActionSubmit, false);
    }
  });

  administratorsBody.addEventListener('click', async (event) => {
    const viewGroupsBtn = event.target.closest('[data-view-user-groups]');
    if (viewGroupsBtn) {
      const targetProfile = profiles.find((item) => item.id === viewGroupsBtn.dataset.viewUserGroups);
      if (targetProfile) openUserGroupsDialog(targetProfile);
      return;
    }
    const edit = event.target.closest('[data-edit-admin]');
    const reset = event.target.closest('[data-reset-admin]');
    const deleteBtn = event.target.closest('[data-delete-user]') || event.target.closest('[data-archive-admin]');
    const button = event.target.closest('[data-admin-status]');
    const id = edit?.dataset.editAdmin || reset?.dataset.resetAdmin || deleteBtn?.dataset.deleteUser || deleteBtn?.dataset.archiveAdmin || button?.dataset.adminStatus;
    if (!id) return;
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    if (edit) {
      const ownedGroup = groups.find((item) => item.owner_id === profile.id && item.status === 'ACTIVE');
      administratorForm.elements.user_id.value = profile.id;
      administratorForm.elements.first_name.value = profile.first_name || '';
      administratorForm.elements.middle_name.value = profile.middle_name || '';
      administratorForm.elements.last_name.value = profile.last_name || '';
      administratorForm.elements.email.value = profile.email || '';
      administratorForm.elements.email.disabled = true;
      administratorForm.elements.password.closest('.field').hidden = true;
      administratorForm.elements.password.required = false;
      administratorForm.elements.group_name.closest('.field').hidden = !ownedGroup;
      administratorForm.elements.group_name.required = Boolean(ownedGroup);
      administratorForm.elements.group_name.value = ownedGroup?.name || '';
      document.getElementById('administrator-dialog-title').textContent = 'Edit user';
      administratorForm.querySelector('[type="submit"]').textContent = 'Save changes';
      adminFormDirty?.reset();
      administratorDialog.showModal();
      return;
    }
    if (reset) {
      if (!profile.email) return Ipon.toast('This user account has no saved email address.', 'error');
      const accepted = await Ipon.confirmAction({ title: 'Send password recovery email?', message: `A password recovery link will be sent to ${profile.email}.`, acceptLabel: 'Send email' });
      if (!accepted) return;
      Ipon.setBusy(reset, true, 'Sending…');
      try {
        const { error } = await Ipon.client.auth.resetPasswordForEmail(profile.email, { redirectTo: new URL('account.html', location.href).href });
        if (error) throw error;
        Ipon.toast('Password recovery email sent.');
      } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
      finally { Ipon.setBusy(reset, false); }
      return;
    }
    if (deleteBtn) {
      openAccountActionDialog(profile, 'DELETE');
      return;
    }
    if (button) {
      const nextStatus = button.dataset.nextStatus;
      openAccountActionDialog(profile, nextStatus === 'ACTIVE' ? 'REACTIVATE' : 'DEACTIVATE');
      return;
    }
  });

  function resetAdministratorForm() {
    administratorForm.reset();
    administratorForm.elements.user_id.value = '';
    administratorForm.elements.email.disabled = false;
    administratorForm.elements.password.closest('.field').hidden = false;
    administratorForm.elements.password.required = true;
    administratorForm.elements.group_name.closest('.field').hidden = false;
    administratorForm.elements.group_name.required = true;
    document.getElementById('administrator-dialog-title').textContent = 'Create administrator';
    administratorForm.querySelector('[type="submit"]').textContent = 'Create administrator';
  }

  function openPasswordDialog(userId) {
    const target = profiles.find((item) => item.id === userId);
    if (!target) return;
    userPasswordForm.reset();
    userPasswordForm.elements.user_id.value = target.id;
    document.getElementById('user-password-copy').textContent = `Set a new password for ${target.full_name}${target.email ? ` (${target.email})` : ''}.`;
    userPasswordDialog.showModal();
    userPasswordForm.elements.password.focus();
  }

  const adminFormDirty = Ipon.bindDirtySaveForm?.(administratorForm, administratorForm?.querySelector('[type="submit"]'), {
    getActive: () => Boolean(administratorForm?.elements?.user_id?.value)
  });

  document.getElementById('create-administrator').addEventListener('click', () => { resetAdministratorForm(); adminFormDirty?.reset(); administratorDialog.showModal(); administratorForm.elements.first_name.focus(); });
  document.getElementById('administrator-dialog-close').addEventListener('click', () => administratorDialog.close());
  document.getElementById('administrator-dialog-cancel').addEventListener('click', () => administratorDialog.close());
  administratorDialog.addEventListener('close', resetAdministratorForm);
  document.getElementById('administrators').addEventListener('click', (event) => {
    const button = event.target.closest('[data-set-password]');
    if (button) openPasswordDialog(button.dataset.setPassword);
  });
  document.getElementById('user-password-close').addEventListener('click', () => userPasswordDialog.close());
  document.getElementById('user-password-cancel').addEventListener('click', () => userPasswordDialog.close());
  userPasswordDialog.addEventListener('close', () => userPasswordForm.reset());
  userPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = profiles.find((item) => item.id === userPasswordForm.elements.user_id.value);
    if (!target) return;
    const password = userPasswordForm.elements.password.value;
    if (password !== userPasswordForm.elements.password_confirmation.value) {
      Ipon.setFieldError(userPasswordForm.elements.password_confirmation, 'Passwords do not match.');
      userPasswordForm.elements.password_confirmation.focus();
      return;
    }
    const issue = Ipon.passwordIssue(password, [target.first_name, target.middle_name, target.last_name, target.email]);
    if (issue) {
      Ipon.setFieldError(userPasswordForm.elements.password, issue);
      userPasswordForm.elements.password.focus();
      return;
    }
    const accepted = await Ipon.confirmAction({
      title: 'Update user password?',
      message: `Set a new temporary password for ${target.full_name}? They will need to use this new password on their next sign-in.`,
      acceptLabel: 'Update password'
    });
    if (!accepted) return;
    const button = event.submitter;
    Ipon.setBusy(button, true, 'Saving…');
    try {
      const { error } = await Ipon.client.functions.invoke('manage-account', { body: { action: 'admin-set-password', user_id: target.id, password } });
      if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      userPasswordDialog.close();
      Ipon.toast(`Password updated for ${target.full_name}.`);
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  administratorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!Ipon.validateNameFields(administratorForm)) return;
    const button = event.submitter;
    const values = new FormData(administratorForm);
    const isEdit = Boolean(values.get('user_id'));
    if (!isEdit) {
      const passwordIssue = Ipon.passwordIssue(values.get('password'), [values.get('first_name'), values.get('middle_name'), values.get('last_name'), values.get('email')]);
      if (passwordIssue) { Ipon.setFieldError(administratorForm.elements.password, passwordIssue); administratorForm.elements.password.focus(); return; }
    }
    const fullName = [values.get('first_name'), values.get('middle_name'), values.get('last_name')].filter(Boolean).join(' ').trim();
    const accepted = await Ipon.confirmAction({
      title: isEdit ? 'Save user changes?' : 'Create administrator account?',
      message: isEdit
        ? `Update account details for ${fullName}?`
        : `Create administrator "${fullName}" for group "${values.get('group_name')}"?`,
      acceptLabel: isEdit ? 'Save changes' : 'Create administrator'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true);
    try {
      if (isEdit) {
        const groupNameField = administratorForm.elements.group_name?.closest('.field');
        const groupNameVal = groupNameField?.hidden ? null : (values.get('group_name') || null);
        await Ipon.rpc('super_admin_update_administrator', {
          p_user_id: values.get('user_id'),
          p_first_name: values.get('first_name'),
          p_middle_name: values.get('middle_name') || null,
          p_last_name: values.get('last_name'),
          p_group_name: groupNameVal
        });
      } else {
        const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'ADMIN', first_name: values.get('first_name'), middle_name: values.get('middle_name') || null, last_name: values.get('last_name'), email: values.get('email'), password: values.get('password'), group_name: values.get('group_name') } });
        if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      }
      administratorDialog.close(); Ipon.toast(values.get('user_id') ? 'Account updated.' : 'Administrator created.'); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  document.getElementById('bug-viewer-close')?.addEventListener('click', () => bugViewerDialog?.close());
  bugStatusTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-bug-status-filter]');
    if (!button) return;
    activeBugStatusFilter = button.dataset.bugStatusFilter;
    bugStatusTabs.querySelectorAll('.segmented-control-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn === button);
    });
    pageState['bug-reports'] = 0;
    renderBugReports();
  });
  bugReportsBody?.addEventListener('click', async (event) => {
    const actionBtn = event.target.closest('[data-bug-action]');
    if (actionBtn) {
      const id = actionBtn.dataset.bugId;
      const nextStatus = actionBtn.dataset.bugAction;
      const report = bugReports.find((item) => item.id === id);
      if (!report) return;
      const confirmed = await Ipon.confirmAction(nextStatus === 'FIXED' ? {
        title: 'Mark bug report as fixed?',
        message: `Mark "${report.title}" as fixed? It will leave the Open list and be included in your next release update with Write with AI.`,
        acceptLabel: 'Mark fixed'
      } : {
        title: 'Reopen bug report?',
        message: `Move "${report.title}" back to the Open bug reports list?`,
        acceptLabel: 'Reopen report'
      });
      if (!confirmed) return;
      Ipon.setBusy(actionBtn, true, nextStatus === 'FIXED' ? 'Marking…' : 'Reopening…');
      try {
        await Ipon.rpc('review_bug_report', { p_report_id: id, p_status: nextStatus });
        report.status = nextStatus;
        if (nextStatus === 'OPEN') {
          report.reviewed_at = null;
          report.release_version = null;
        } else {
          report.reviewed_at = new Date().toISOString();
        }
        renderBugReports();
        Ipon.toast(nextStatus === 'FIXED'
          ? 'Bug report marked as fixed and queued for the next release update.'
          : 'Bug report moved back to Open.');
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(actionBtn, false);
      }
      return;
    }
    const button = event.target.closest('[data-view-bug]');
    if (!button || !bugViewerDialog) return;
    const report = bugReports.find((item) => item.id === button.dataset.viewBug);
    if (!report) return;
    const profile = profiles.find((item) => item.id === report.reporter_id);
    document.getElementById('bug-viewer-title').textContent = report.title;
    document.getElementById('bug-viewer-meta').textContent = `${profile?.full_name || 'Former user'} • ${Ipon.dateLabel(report.created_at, { dateStyle: 'medium', timeStyle: 'short' })}`;
    document.getElementById('bug-viewer-description').textContent = report.description;
    const container = document.getElementById('bug-viewer-images');
    container.innerHTML = '<p class="empty-state">Loading pictures…</p>';
    bugViewerDialog.showModal();
    Ipon.setBusy(button, true, 'Loading…');
    try {
      const { data, error } = await Ipon.client.from('bug_reports').select('attachments').eq('id', report.id).single();
      if (error) throw error;
      const images = (Array.isArray(data?.attachments) ? data.attachments : [])
        .map((item) => ({ name: item?.name || 'Picture', src: String(item?.url || item?.dataUrl || '').trim() }))
        .filter((item) => Ipon.isSafeImageRef(item.src));
      container.innerHTML = images.length ? images.map((item) => `
        <figure class="bug-viewer-item">
          <img src="${Ipon.escapeHtml(item.src)}" alt="${Ipon.escapeHtml(item.name || 'Attached screenshot')}">
          <figcaption><span>${Ipon.escapeHtml(item.name || 'Picture')}</span><a class="icon-action" href="${Ipon.escapeHtml(item.src)}" download="${Ipon.escapeHtml(item.name || 'bug-picture')}" target="_blank" rel="noopener">Download</a></figcaption>
        </figure>`).join('') : '<p class="empty-state">No attached pictures.</p>';
      container.querySelectorAll('img').forEach((img) => {
        img.onerror = () => { img.replaceWith(Object.assign(document.createElement('p'), { className: 'empty-state', textContent: 'Preview unavailable in this browser. Use Download below.' })); };
      });
    } catch (error) {
      container.innerHTML = `<p class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</p>`;
    } finally {
      Ipon.setBusy(button, false);
    }
  });
  featureStatusTabs?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-status-filter]');
    if (!button) return;
    activeFeatureStatusFilter = button.dataset.statusFilter;
    featureStatusTabs.querySelectorAll('.segmented-control-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn === button);
    });
    pageState['feature-requests'] = 0;
    renderFeatureRequests();
  });

  document.getElementById('feature-requests')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-feat-action]');
    if (!button) return;
    const id = button.dataset.featId;
    const nextStatus = button.dataset.featAction;
    const request = featureRequests.find((item) => item.id === id);
    if (!request) return;

    if (nextStatus === 'IMPLEMENTED') {
      const confirmed = await Ipon.confirmAction({
        title: 'Mark feature as implemented?',
        message: `Mark "${request.title}" as implemented? It will be ready to include in the next release update.`,
        acceptLabel: 'Mark implemented'
      });
      if (!confirmed) return;
    } else if (nextStatus === 'REJECTED') {
      const confirmed = await Ipon.confirmAction({
        title: 'Reject feature request?',
        message: `Mark "${request.title}" as rejected?`,
        acceptLabel: 'Reject request'
      });
      if (!confirmed) return;
    } else if (nextStatus === 'PENDING') {
      const confirmed = await Ipon.confirmAction({
        title: 'Reset feature request?',
        message: `Reset "${request.title}" back to pending status?`,
        acceptLabel: 'Reset to pending'
      });
      if (!confirmed) return;
    }

    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('review_feature_request', { p_request_id: id, p_status: nextStatus });
      request.status = nextStatus;
      if (nextStatus === 'PENDING') {
        request.reviewed_at = null;
        request.release_version = null;
      } else {
        request.reviewed_at = new Date().toISOString();
      }
      renderFeatureRequests();
      const message = nextStatus === 'IMPLEMENTED'
        ? 'Feature request marked as implemented.'
        : nextStatus === 'REJECTED'
          ? 'Feature request marked as rejected.'
          : 'Feature request reset to pending.';
      Ipon.toast(message);
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  const GENERIC_RELEASE_TITLE_RE = /^(?:released|is\s+now\s+live|feature\s+update|milestone\s+update|official\s+rollout|introducing|what'?s\s+new|rollout|update|system\s+update|smarter\s+tracking\s*&\s*community\s+features|new\s+tools\s*&\s*community\s+requests|enhanced\s+experience\s+for\s+every\s+saver|elevating\s+your\s+daily\s+savings\s+journey|built\s+with\s+community\s+feedback|community\s*&\s*performance\s+rollout)!?$/i;

  function formatReleaseVersionPrefix(ver) {
    const clean = String(ver || 'Update 1.0').replace(/^(?:myipon|system)\s+/i, '').trim() || 'Update 1.0';
    if (/^update\b/i.test(clean)) return `myIPON Update${clean.slice(6)}`;
    if (/^\d/.test(clean)) return `myIPON Update ${clean}`;
    return `myIPON ${clean}`;
  }

  function extractReleaseTopicLabels(items = []) {
    const seen = new Set();
    const labels = [];
    const list = Array.isArray(items) ? items : String(items || '').split(/\r?\n/);
    for (const raw of list) {
      const line = String(raw || '').replace(/^[•\-*]\s*/, '').trim();
      if (!line || line.length < 4) continue;
      if (/^(?:New Features|Fixes|Improvements|Security Updates|Other Changes|Features Requested by Users:?|Welcome to\b|Big news\b|Introducing\b|Say hello\b|Thank you\b|We(?:'re| are)\b|Your ideas\b|Special thanks\b|As always\b|Built with\b|Huge thanks\b)/i.test(line)) {
        continue;
      }
      if (TECH_COMMIT_RE.test(line) || CODE_TOKEN_RE.test(line)) continue;
      const head = line.includes(':') ? line.split(':')[0].trim() : line.replace(/\s*\(Requested by:[^)]*\)\s*/gi, '').trim();
      const shortHead = head.split(/\s+/).slice(0, 5).join(' ').replace(/[.,;:—–-]+$/, '').trim();
      if (!shortHead || shortHead.length < 3 || GENERIC_RELEASE_TITLE_RE.test(shortHead)) continue;
      const key = shortHead.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(shortHead);
      if (labels.length >= 4) break;
    }
    return labels;
  }

  function formatReleaseTitle(ver, candidateTitle = '', contentItems = [], variant = 0) {
    const prefix = formatReleaseVersionPrefix(ver);
    const v = Math.abs(Number(variant) || 0) % 3;
    const raw = String(candidateTitle || '').trim();
    let topic = raw
      .replace(/\b(?:myipon|system)\b/gi, ' ')
      .replace(/\bupdate\s*\d+(?:\.\d+)*(?:[a-z0-9.-]*)?/gi, ' ')
      .replace(/\bv?\d+\.\d+(?:\.\d+)*\b/gi, ' ')
      .replace(/\b(?:in|for|with|on|from)\s*$/i, '')
      .replace(/^[\s:|\-–—]+|[\s:|\-–—]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!topic || topic.length < 4 || GENERIC_RELEASE_TITLE_RE.test(topic) || TECH_COMMIT_RE.test(topic) || CODE_TOKEN_RE.test(topic)) {
      const labels = extractReleaseTopicLabels(contentItems);
      if (labels.length >= 3) {
        topic = [
          `${labels[0]}, ${labels[1]} & ${labels[2]}`,
          `${labels[0]}, ${labels[1]} & More`,
          `Upgraded ${labels[0]} & ${labels[1]}`
        ][v];
      } else if (labels.length === 2) {
        topic = [
          `${labels[0]} & ${labels[1]}`,
          `${labels[0]} + ${labels[1]} Upgrades`,
          `Better ${labels[0]} & ${labels[1]}`
        ][v];
      } else if (labels.length === 1) {
        topic = [
          `${labels[0]} Highlights`,
          `New ${labels[0]} Upgrades`,
          `Smoother ${labels[0]} Experience`
        ][v];
      } else {
        topic = ['Community & Tracking Upgrades', 'Smoother Saving & Group Tools', 'Fresh Group & Tracking Polish'][v];
      }
    }
    const full = `${prefix}: ${topic}`;
    return full.length > 140 ? `${full.slice(0, 137).replace(/[\s,&+-]+$/, '')}...` : full;
  }

  const REPO_COMMITS_URL = 'https://api.github.com/repos/zediskaaa/Ipon-Tracking-System/commits';
  const releaseCommitCache = new Map();
  let latestReleaseContext = null;

  const TECH_COMMIT_RE = /\b(?:supabase|migrations?|edge\s+functions?|rpc\s+functions?|database\s+functions?|deno|postgres(?:ql)?|postgrest?|rls|sql|triggers?|foreign\s+keys?|jsonb|cli|ide|vscode|antigravity|github|git\s+commits?|repo\s+commits?|live\s+commits?|repo(?:sitory)?|contracts?\.test|contract\s+coverage|unit\s+tests?|test\s+suite|npm\s+test|vitest|jest|lint(?:ing)?|eslint|prettier|package\.json|lockfile|node_modules|html\s+csp|csp\s+headers?|deployment|deploy(?:ed|ing)?|auto-?sync|automate|release\s+ai|ai\s+release\s+(?:notes|flow)|release[-\s]?notes?|release\s+announcements?|auto-?fallback|ai\s+and\s+composer|composer\s+formatting|smart\s+composer|procedural\s+composer|prior\s+releases?|prior\s+bullet\s+topics?|repetitive\s+(?:endings?|tail\s+phrases?)|invite\s+rows?|database\s+rows?|name\s+pills?|ui\/ux\s+skills?|workspace\s+skills?|audit_logs|enforce_group_scope|admin_create_group|old\.amount|group_id|member_id|requester_id|codebase|refactor(?:ing)?|tdz|iife|vm\.run|playwright|puppeteer|cdp|edge\s+function\s+cache|asset\s+cache|cache\s+version|api\s+endpoints?|webhooks?|descendant\s+selector|selector\s+leak|selectors?|class\/id|css(?:\s+tokens?)?|code\s+(?:tokens?|jargon)|design\s+tokens?|design-?spec|jargon|hex\s+(?:colors?|codes?)|pixel\/viewport|pixels?|viewport\s+units?|broken\s+fragments?|parenthetical|multi-modal|clause\s+(?:splitting|parsing)|verb\s+rewrites?|topic\s+labels?|categorization|block\s+extraction|declarations?|version\s+incrementing|vertex\s+ai|ai\s+studio|ai\s+coach|savings\s+coach|gemini(?:\s+prompt)?|prompt|write\s+with\s+ai|invokeaccountfunction|window\.ipon|populategroupselect|openretentionpolicydialog|z-index|max-width|min-height|ledger\s+entries|outer\s+page\s+headers?|card\s+header\s+controls?|static\s+asset|capacitor|contract\s+tests?|profiles_select|group_memberships|review_bug_report|create_announcement|super\s+admin\s+ui|overloaded\s+rpcs?|drifted\s+rpcs?|unlinked\s+groups?|reverted\s+(?:live\s+)?rpcs?|live\s+rpcs?|multi-role\s+audit|system-wide\s+db|build\s*#?\d+|pic\s*\d+|stdout|stderr|localhost|service\s+worker|www\s+sync|broadcastchannel|websocket|popstate|handlenativeback|fail\s+loudly|null\s+summary\s+responses|session\s+profile\s+id|trimmed\s+length\s+validation|role\s+data\/ui\s+gaps?|drop\s+stale|missing\s+memberships?|top\s+accent\s+rules?|accent\s+rules?|button\s+bars?|equal\s+2-column|2-column\s+button|forest-emerald|theme\s+isolation|serif\s+heading|warm-cream|warm\s+parchment|update\s+verify|\d+\/\d+\s+tests?)\b/i;
  const CODE_TOKEN_RE = /(?:(?:^|[\s(,\[])\.[a-z_-][a-z0-9_-]{1,}\b|\[[a-z0-9_-]+(?:=[^\]]*)?\]|#[a-z_-][a-z0-9_-]*-[a-z0-9_-]*\b|#[0-9a-f]{3,8}\b|\b[a-z_][a-z0-9_]{1,}\.[a-z_][a-z0-9_]{1,}\b|_[a-z]|(?:\b(?:js|css|supabase|database|scripts|tests|android|\.agents)\/[a-z0-9_./-]+|[a-z0-9_-]+\/[a-z0-9_.-]+\.[a-z]{2,4}\b)|`|\(\)|[A-Z][a-z]+Error\b|\b\d+(?:\.\d+)?(?:px|rem|em|vw|vh|ms)\b|[<>]=?\s*\d+px\b)/i;
  const NOISE_CLAUSE_RE = /^(?:ui\s+(?:polish|refinements?|tweaks?)|minor\s+ui\s+(?:polish|tweaks?)|visual\s+polish|code\s+cleanup|polish|refinements?|fixes|all updates are covered.*)$/i;
  const COMMIT_VERB_RE = /^(Add|Fix|Keep|Allow|Show|Support|Enable|Improve|Make|Update|Upgrade|Block|Prevent|Deduplicate|Streamline|Polish|Implement|Restore|Resolve|Guard|Remove|Restrict|Align|Clarify|Start|Notify|Enforce|Hide|Extend|Harden|Move|Stack|Center|Style|Customize|Standardize|Elevate|Reduce|Expand|Clean|Sync|Drop|Strip|Filter)\b/i;
  const COMMIT_STOP_WORDS = new Set(['with', 'from', 'into', 'that', 'this', 'when', 'while', 'across', 'inside', 'under', 'after', 'before', 'their', 'users', 'user', 'added', 'fixed', 'updated', 'keep', 'make', 'allow', 'show', 'support', 'enable', 'improve', 'upgrade', 'remove', 'restrict', 'align', 'enforce', 'ensure', 'resolved', 'issues', 'involving', 'smoother', 'experience', 'workflow', 'workflows', 'feature', 'features', 'system', 'myipon', 'group', 'groups', 'member', 'members', 'admin', 'admins', 'savers', 'treasurer', 'treasurers', 'also', 'plus', 'more', 'less', 'only', 'every', 'each', 'both', 'clear', 'clean', 'cleaner', 'direct', 'directly', 'immediately', 'strictly']);

  function canonicalizeClauseForParsing(rawLine) {
    return String(rawLine || '')
      .replace(/^(?:feat|perf|ui|ux|style)(?:\([^)]*\))?:\s*/i, '')
      .replace(/^fix(?:\([^)]*\))?:\s*(?=(?:add|fix|keep|allow|show|support|enable|improve|make|update|upgrade|block|prevent|deduplicate|streamline|polish|implement|restore|resolve|guard|remove|restrict|align|clarify|start|notify|enforce|hide|extend|harden|move|stack|center|style|customize|standardize|elevate|reduce|expand|clean|sync|drop|strip|filter)\b)/i, '')
      .replace(/^fix(?:\([^)]*\))?:\s*/i, 'Fix ')
      .replace(/^client\s*(?:&|and)\s*ui\s+fixes\s*:\s*/i, '')
      .replace(/\s*\([^)]*(?:migrations?|js\/|css\/|\.html|tests\/|manage-account|AGENTS\.md|parseMoneyAmount|validateMoneyInput|guardMoneyInput|z-index|build\s*#?\d+|ledger\s+entries|0\s+pending|pic\s*\d+(?:\s*&\s*\d+)?|\.[a-z_-]{2,}|\[data-|#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?px\b|forest-emerald|button\s+bar|top\s+accent\s+rule|\bpantay\b|handleNativeBack|v\d+\s*\/\s*www\s+sync)[^)]*\)/gi, ' ')
      .replace(/\bchat\/notif(?:ication)?\b/gi, 'chat and notification')
      .replace(/\bsolo\/group\b/gi, 'Solo and Group')
      .replace(/\bheader\/tracked\b/gi, 'header and tracked')
      .replace(/\bheadroom\/unallocated\b/gi, 'unallocated')
      .replace(/\bacross\s+viewports?\b/gi, 'across all screen sizes')
      .replace(/\bdashed\s+empty-state\s+containers?\b/gi, 'empty category sections')
      .replace(/\bempty\s+state\b/gi, 'empty notice')
      .replace(/\bhero\s+allocation\s+card\b/gi, 'main savings overview')
      .replace(/\b3-bucket\s+tracking\b/gi, 'Needs, Wants, and Savings tracking')
      .replace(/\bnon-destructive\s+history\b/gi, 'protected expense history')
      .replace(/\binline\s+new-item\s+fields\b/gi, 'quick new-item entry')
      .replace(/\bquick-record\s+fallback\b/gi, 'quick-record saving')
      .replace(/\bmodals?\b/gi, (m) => (m.endsWith('s') ? 'dialogs' : 'dialog'))
      .replace(/\bnotif\b/gi, 'notification')
      .replace(/\bvia\s+shared\s+helpers(?:\s+in\s+[a-z0-9._/-]+)?/gi, '')
      .replace(/\bthrough\s+VAPID\s+Web\s+Push\s+delivery[^.;]*/gi, 'for in-app web and mobile alerts')
      .replace(/\b(?:in|under)\s+(?:[a-z0-9._-]+\/[a-z0-9._/-]+|AGENTS\.md|account\.html|super-admin\.html)\b(?:\s+and\s+[a-z0-9._/-]+)?/gi, '')
      .replace(/\bAdditional\s+UI\s+refinements\s+/gi, '')
      .replace(/\s+,/g, ',')
      .replace(/,\s*\./g, '.')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractCommitUpdates(rawMessage) {
    const rawLines = String(rawMessage || '').split(/\r?\n/);
    if (!rawLines.length) return [];
    const results = [];
    let abortInternalCommit = false;
    rawLines.forEach((origLine, lineIdx) => {
      if (abortInternalCommit) return;
      const isBulletOrSubject = lineIdx === 0 || /^[•\-*]\s+/.test(origLine.trim());
      const rawStripped = origLine.trim().replace(/^[•\-*]\s*/, '').trim();
      const line = canonicalizeClauseForParsing(rawStripped);
      if (!line) return;
      if (/^(?:merge\b|wip\b|bump\b|prepare\s+mobile\b|revert\b|export\b|(?:chore|ci|build|test|docs|refactor)(?:\([^)]*\))?:)/i.test(line)) {
        if (lineIdx === 0) abortInternalCommit = true;
        return;
      }

      if (!isBulletOrSubject) {
        if (TECH_COMMIT_RE.test(line) || CODE_TOKEN_RE.test(line)) return;
        const sentences = line
          .split(/(?<=[.!?])\s+/)
          .map((s) => s.trim().replace(/[,.;]+$/, '').trim())
          .filter(Boolean);
        for (const sentence of sentences) {
          if (sentence.length < 18 || NOISE_CLAUSE_RE.test(sentence)) continue;
          if (/^[\d)\],.:;-]/.test(sentence)) continue;
          if (/^(?:while|when|if|because|since|although|unless|where|which)\b/i.test(sentence)) continue;
          if ((sentence.match(/\(/g) || []).length !== (sentence.match(/\)/g) || []).length) continue;
          if (TECH_COMMIT_RE.test(sentence) || CODE_TOKEN_RE.test(sentence)) continue;
          results.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
        }
        return;
      }

      const leadMatch = line.match(/^(Add|Fix|Keep|Allow|Show|Support|Enable|Improve|Make|Update|Upgrade|Block|Prevent|Deduplicate|Streamline|Polish|Implement|Restore|Resolve|Guard|Remove|Restrict|Align|Clarify|Start|Notify|Enforce|Hide|Extend|Harden|Move|Stack|Center|Style|Customize|Standardize|Elevate|Reduce|Expand|Clean|Sync|Drop|Strip|Filter)\s+(.+)$/i);
      const defaultVerb = leadMatch ? (leadMatch[1].charAt(0).toUpperCase() + leadMatch[1].slice(1).toLowerCase()) : '';
      const remainder = leadMatch ? leadMatch[2] : line;
      const masked = remainder
        .replace(/(\d),(?=\d)/g, '$1\u0001')
        .replace(/\bNeeds,\s*Wants,\s*(?:and\s+)?Savings\b/gi, (seg) => seg.replace(/,/g, '\u0001'))
        .replace(/\([^)]*\)/g, (seg) => seg.replace(/,/g, '\u0001'))
        .replace(/^([^.;]+?\b(?:modals?|dialogs?)\b)/i, (seg) => seg.replace(/,/g, '\u0001').replace(/\band(?=\s)/gi, '\u0002'))
        .replace(/\b(?:on|for|with|across|including|such\s+as|among|between)\s+[^.;]+?(?=(?:,\s*(?:and\s+)?(?:add|fix|keep|allow|show|support|enable|improve|make|update|upgrade|block|prevent|deduplicate|streamline|polish|implement|restore|resolve|guard|remove|restrict|align|clarify|start|notify|enforce|hide|extend|harden|move|stack|center|style|customize|standardize|elevate|reduce|expand|clean|sync|drop|strip|filter)\b|[.;]|$))/gi, (seg) => seg.replace(/,/g, '\u0001'));
      const candidateClauses = masked
        .split(/(?:\s*,\s*(?:and\s+)?|\s*;\s*|\s+(?:and(?=\s+(?:add|fix|keep|allow|show|support|enable|improve|make|update|upgrade|block|prevent|deduplicate|streamline|polish|implement|restore|resolve|guard|remove|restrict|align|clarify|start|notify|enforce|hide|extend|harden|move|stack|center|style|customize|standardize|elevate|reduce|expand|clean|sync|drop|strip|filter)\b)|plus)\s+)/i)
        .map((part) => part.replace(/\u0001/g, ',').replace(/\u0002/g, 'and').trim().replace(/[,.;]+$/, '').trim())
        .filter(Boolean);
      const hasSingleWordFragment = candidateClauses.length > 1 && candidateClauses.some((part) => !/\s/.test(part));
      const rawClauses = hasSingleWordFragment
        ? [remainder.trim().replace(/[,.;]+$/, '').trim()]
        : candidateClauses;
      if (lineIdx > 0 && rawClauses.length > 0 && (TECH_COMMIT_RE.test(rawClauses[0]) || CODE_TOKEN_RE.test(rawClauses[0]))) {
        return;
      }
      let addedOnLine = 0;
      for (let idx = 0; idx < rawClauses.length; idx++) {
        const rawClause = rawClauses[idx];
        if (rawClause.length < 10) continue;
        if (/^[\d)\],.:;-]/.test(rawClause)) continue;
        if (/^(?:while|when|if|because|since|although|unless|where|which)\b/i.test(rawClause)) continue;
        if ((rawClause.match(/\(/g) || []).length !== (rawClause.match(/\)/g) || []).length) continue;
        if ((rawClause.match(/\b[a-z]{3,}\b/gi) || []).length < 2) continue;
        if (NOISE_CLAUSE_RE.test(rawClause)) continue;
        if (TECH_COMMIT_RE.test(rawClause) || CODE_TOKEN_RE.test(rawClause)) continue;
        if (/\b(?:without|with|for|and|or|to|on|in|from|into)$/i.test(rawClause)) continue;
        const hasOwnVerb = idx > 0 && COMMIT_VERB_RE.test(rawClause);
        const item = hasOwnVerb ? rawClause : (defaultVerb ? `${defaultVerb} ${rawClause}` : rawClause);
        if (item.length < 12) continue;
        results.push(item.charAt(0).toUpperCase() + item.slice(1));
        addedOnLine += 1;
      }
      if (lineIdx === 0 && addedOnLine === 0 && /\b(?:release[-\s]?notes?|write\s+with\s+ai|ai\s+composer|prior\s+release|gemini|supabase|migrations?|unit\s+tests?|contract\s+tests?|css\s+tokens?|code\s+jargon|refactor(?:ing)?|linter)\b/i.test(rawStripped)) {
        abortInternalCommit = true;
      }
    });
    return results;
  }

  function cleanCommitSummary(rawMessage) {
    return extractCommitUpdates(rawMessage).join(', ');
  }

  function extractCommitStems(text) {
    const words = String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9/\s-]/g, ' ')
      .split(/[\s/-]+/)
      .filter((w) => w.length >= 4 && !COMMIT_STOP_WORDS.has(w) && !/^\d+$/.test(w));
    const stems = [];
    const seen = new Set();
    for (const w of words) {
      const stem = w
        .replace(/(?:ation|ition|ments?|ings?|ers?|ions?|ies|ed|es|s)$/, '')
        .slice(0, 7);
      if (stem.length < 3 || seen.has(stem)) continue;
      seen.add(stem);
      stems.push(stem);
    }
    return stems;
  }

  function clausesOverlapTopic(a, b) {
    const stemsA = extractCommitStems(a);
    const stemsB = extractCommitStems(b);
    if (!stemsA.length || !stemsB.length) return a.toLowerCase() === b.toLowerCase();
    const setB = new Set(stemsB);
    const shared = stemsA.filter((s) => setB.has(s));
    const minLen = Math.min(stemsA.length, stemsB.length);
    if (minLen <= 2) return shared.length >= minLen;
    return shared.length >= 2 && (shared.length / minLen) >= 0.55;
  }

  function canonicalizeCommitUpdates(rawItems = [], excludedText = '') {
    const out = [];
    const excludedStems = new Set(extractCommitStems(excludedText));
    const excludedLineStems = String(excludedText || '')
      .split(/\r?\n/)
      .map((line) => extractCommitStems(line))
      .filter((lineStems) => lineStems.length >= 2);
    const matchesPriorLine = (stems) => {
      if (!stems.length) return false;
      return excludedLineStems.some((lineStems) => {
        const lineSet = new Set(lineStems);
        let hits = 0;
        for (const s of stems) {
          const prefix = s.slice(0, 5);
          if (lineSet.has(s) || lineStems.some((ls) => ls.slice(0, 5) === prefix)) hits += 1;
        }
        const req = stems.length <= 2 ? stems.length : Math.max(2, Math.ceil(stems.length * 0.5));
        return hits >= req;
      });
    };
    for (const raw of (Array.isArray(rawItems) ? rawItems : [])) {
      for (const item of extractCommitUpdates(raw)) {
        const stems = extractCommitStems(item);
        if (matchesPriorLine(stems)) continue;
        if (excludedStems.size > 0 && stems.length >= 2) {
          const hitCount = stems.filter((s) => excludedStems.has(s)).length;
          if (hitCount / stems.length >= 0.65) continue;
        }
        const matchIdx = out.findIndex((existing) => clausesOverlapTopic(existing, item));
        if (matchIdx !== -1) {
          if (item.length > out[matchIdx].length + 12) {
            out[matchIdx] = item;
          }
          continue;
        }
        out.push(item);
        if (out.length >= 60) return out;
      }
    }
    return out;
  }

  function findMissingReleaseItems(buckets, expectedRawItems = []) {
    const allBullets = [
      ...(Array.isArray(buckets?.newFeatures) ? buckets.newFeatures : []),
      ...(Array.isArray(buckets?.fixes) ? buckets.fixes : []),
      ...(Array.isArray(buckets?.improvements) ? buckets.improvements : []),
      ...(Array.isArray(buckets?.requestedFeatures) ? buckets.requestedFeatures : []),
      ...(Array.isArray(buckets?.securityUpdates) ? buckets.securityUpdates : []),
      ...(Array.isArray(buckets?.otherChanges) ? buckets.otherChanges : [])
    ];
    const bulletStemSets = allBullets.map((b) => new Set(extractCommitStems(b)));
    const canonicalExpected = canonicalizeCommitUpdates(expectedRawItems);
    const missing = [];
    canonicalExpected.forEach((raw) => {
      const stems = extractCommitStems(raw);
      const requiredHits = stems.length <= 2 ? stems.length : Math.min(3, Math.max(2, Math.ceil(stems.length * 0.35)));
      const alreadyCovered = stems.length > 0 && bulletStemSets.some((bSet) => {
        let hits = 0;
        for (const s of stems) {
          if (bSet.has(s) || [...bSet].some((bs) => bs.slice(0, 4) === s.slice(0, 4))) hits += 1;
        }
        return hits >= requiredHits;
      });
      if (!alreadyCovered) missing.push(raw);
    });
    return missing;
  }

  async function fetchRecentSystemUpdates(sinceIso = null, priorText = '') {
    const cacheKey = `${sinceIso || '__latest__'}::${priorText.slice(0, 60)}`;
    if (releaseCommitCache.has(cacheKey)) return releaseCommitCache.get(cacheKey);

    const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
    const collectEntries = (entries, respectSince = true, excluded = '') => {
      const filteredMsgs = [];
      for (const entry of (Array.isArray(entries) ? entries : [])) {
        const msg = entry?.commit?.message ?? entry?.message ?? '';
        const dtStr = entry?.commit?.committer?.date || entry?.commit?.author?.date || entry?.date || '';
        const dtMs = dtStr ? Date.parse(dtStr) : NaN;
        if (respectSince && Number.isFinite(sinceMs) && Number.isFinite(dtMs) && dtMs <= sinceMs) continue;
        if (msg) filteredMsgs.push(msg);
      }
      return canonicalizeCommitUpdates(filteredMsgs, excluded);
    };

    const fetchLocalFeed = async () => {
      try {
        const res = await fetch(`js/release-commits.json?v=${Date.now()}`, { cache: 'no-store' });
        return res.ok ? await res.json() : [];
      } catch {
        return [];
      }
    };

    const fetchGitHub = async (sinceParam) => {
      const qs = new URLSearchParams({ per_page: '100' });
      if (sinceParam) qs.set('since', sinceParam);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), 4500) : null;
      try {
        const res = await fetch(`${REPO_COMMITS_URL}?${qs.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller?.signal
        });
        return res.ok ? await res.json() : [];
      } catch {
        return [];
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const [localEntries, ghEntries] = await Promise.all([fetchLocalFeed(), fetchGitHub(sinceIso)]);
    const mergedRaw = [...(Array.isArray(localEntries) ? localEntries : []), ...(Array.isArray(ghEntries) ? ghEntries : [])];
    let updates = collectEntries(mergedRaw, Boolean(sinceIso), priorText);
    if (!sinceIso && updates.length < 6) {
      const ghAll = ghEntries.length >= 20 ? ghEntries : await fetchGitHub(null);
      updates = collectEntries([...(Array.isArray(localEntries) ? localEntries : []), ...(Array.isArray(ghAll) ? ghAll : [])], false, priorText);
    }
    releaseCommitCache.set(cacheKey, updates);
    return updates;
  }

  async function collectReleaseContext() {
    let releaseRows = [];
    try {
      const { data, error } = await Ipon.client.from('announcements')
        .select('release_version,title,description,created_at')
        .not('release_version', 'is', null)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!error) {
        releaseRows = Array.isArray(data) ? data : [];
      }
    } catch (_) { }

    let nextVersion = 'Update 1.0';
    let major = 1;
    let minor = 0;
    if (releaseRows.length > 0) {
      releaseRows.forEach((row) => {
        const match = String(row.release_version || '').trim().match(/(\d+)(?:\.(\d+))?/);
        if (match) {
          const maj = parseInt(match[1], 10);
          const min = match[2] !== undefined ? parseInt(match[2], 10) : 0;
          if (maj > major || (maj === major && min >= minor)) {
            major = maj;
            minor = min + 1;
          }
        }
      });
      nextVersion = `Update ${major}.${minor}`;
    }

    const latestReleaseAt = releaseRows[0]?.created_at || null;
    const latestReleaseVersion = releaseRows[0]?.release_version || null;
    const previousReleases = releaseRows
      .slice(0, 6)
      .map((row) => [row.release_version, row.title].filter(Boolean).join(': '))
      .filter(Boolean);
    const previousReleaseDetails = releaseRows
      .slice(0, 5)
      .map((row) => String(row.description || '').trim())
      .filter(Boolean);
    const priorText = releaseRows
      .map((row) => [row.title, row.description].filter(Boolean).join('\n'))
      .join('\n');

    const targetImplemented = featureRequests.filter(
      (req) => req.status === 'IMPLEMENTED' && !req.release_version
    );
    const targetFixedBugs = bugReports.filter(
      (bug) => (bug.status || 'OPEN') === 'FIXED' && !bug.release_version
    );
    const systemUpdates = await fetchRecentSystemUpdates(latestReleaseAt, priorText);
    const hasNewChanges = systemUpdates.length > 0 || targetImplemented.length > 0 || targetFixedBugs.length > 0;

    latestReleaseContext = { nextVersion, latestReleaseAt, latestReleaseVersion, previousReleases, previousReleaseDetails, targetImplemented, targetFixedBugs, systemUpdates, hasNewChanges };
    return latestReleaseContext;
  }

  function bucketizeReleaseUpdates(items = []) {
    const newFeatures = [];
    const fixes = [];
    const improvements = [];
    const securityUpdates = [];
    items.forEach((raw) => {
      const clean = String(raw || '').replace(/^[•\-*]\s*/, '').trim();
      if (!clean || TECH_COMMIT_RE.test(clean) || CODE_TOKEN_RE.test(clean)) return;
      if (/\b(?:security|vulnerabilit|rls|permission|auth(?:entication|orization)?|encrypt|csp|xss|csrf|hardening)\b/i.test(clean)) {
        securityUpdates.push(clean);
      } else if (/^(?:fix(?:ed|es)?|resolve[ds]?|prevent|restore|deduplicate|guard|block)\b|\b(?:error|constraint|foreign\s+key|bug)\b/i.test(clean)) {
        fixes.push(clean);
      } else if (/^(?:improv|polish|clean|compact|sync|update|refactor|streamline|keep|align|refine|enhance|make\b.*\b(?:compact|clean|responsive|faster|clearer|visible))\b|\b(?:faster|cleaner|compact|reliable|visibility|clarity)\b/i.test(clean)) {
        improvements.push(clean);
      } else {
        newFeatures.push(clean);
      }
    });
    return { newFeatures, fixes, improvements, securityUpdates };
  }

  function stripReleaseFluffTails(text) {
    const out = String(text || '').trim();
    if (!out) return '';
    return out
      .replace(/\.\s+(?:Users|You)\s+can\s+now\s+(?:rely on|enjoy|expect)\s+(?:a\s+)?(?:more\s+)?(?:consistent|seamless|smooth(?:er)?|stable|dependable|reliable)[^.]*\b(?:experience|workflow|dependability)\.?$/i, '.')
      .replace(/,\s*(?:resulting in|leading to|providing|delivering|creating|offering|ensuring|giving users)\s+(?:a|an)\s+(?:more\s+)?(?:stable|dependable|reliable|smooth(?:er)?|seamless|consistent|streamlined|intuitive|polished|enjoyable|hassle-free|responsive)(?:\s+(?:and|,)\s+(?:more\s+)?(?:stable|dependable|reliable|smooth(?:er)?|seamless|consistent|streamlined|intuitive|polished|enjoyable|hassle-free|responsive))*\s+(?:user\s+|overall\s+|app\s+|tracking\s+)?(?:experience|workflow|process|journey|performance)\.?$/i, '.')
      .replace(/(?:,\s*|\s+)(?:for|to ensure|to deliver|to provide)\s+(?:a|an)\s+(?:more\s+)?(?:stable|dependable|reliable|smooth(?:er)?|seamless|consistent|streamlined|intuitive|polished|enjoyable|hassle-free|responsive)(?:\s+(?:and|,)\s+(?:more\s+)?(?:stable|dependable|reliable|smooth(?:er)?|seamless|consistent|streamlined|intuitive|polished|enjoyable|hassle-free|responsive))*\s+(?:user\s+|overall\s+|app\s+|tracking\s+)?(?:experience|workflow|process|journey)\.?$/i, '.')
      .replace(/\s+\./g, '.')
      .replace(/\.\.+/g, '.')
      .trim();
  }

  function sanitizeReleaseDetails(rawDetails) {
    const text = String(rawDetails || '').trim();
    if (!text) return { text: '', bulletCount: 0, strippedCount: 0 };
    const OBJECT_STR_RE = /\[object\s+[^\]]+\]/i;
    let bulletCount = 0;
    let strippedCount = 0;
    const cleanedBlocks = text.split(/\n{2,}/).map((block) => {
      const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return '';
      const hasBullets = lines.some((line) => /^[•\-*]\s+/.test(line));
      if (!hasBullets) {
        return OBJECT_STR_RE.test(block) || TECH_COMMIT_RE.test(block) || CODE_TOKEN_RE.test(block) ? '' : block.trim();
      }
      const header = !/^[•\-*]\s+/.test(lines[0]) ? lines[0] : '';
      const bullets = (header ? lines.slice(1) : lines).map((line) => {
        const prefix = line.match(/^([•\-*]\s+)/)?.[1] || '• ';
        const clean = stripReleaseFluffTails(line.replace(/^[•\-*]\s+/, '').trim());
        if (!clean || OBJECT_STR_RE.test(clean) || TECH_COMMIT_RE.test(clean) || CODE_TOKEN_RE.test(clean)) {
          strippedCount += 1;
          return '';
        }
        bulletCount += 1;
        return `${prefix}${clean}`;
      }).filter(Boolean);
      if (!bullets.length) return '';
      return header ? `${header}\n${bullets.join('\n')}` : bullets.join('\n');
    }).filter(Boolean);
    return { text: cleanedBlocks.join('\n\n'), bulletCount, strippedCount };
  }

  function coerceReleaseBulletText(raw) {
    if (raw == null) return '';
    if (typeof raw === 'string') {
      const clean = stripReleaseFluffTails(raw.replace(/^[•\s*-]+/, '').trim());
      return /\[object\s+[^\]]+\]/i.test(clean) ? '' : clean;
    }
    if (Array.isArray(raw)) return raw.map(coerceReleaseBulletText).filter(Boolean).join(' ').trim();
    if (typeof raw === 'object') {
      const title = raw.title || raw.name || raw.feature || raw.feature_name || raw.change_name || raw.heading || raw.topic || '';
      const rest = ['summary', 'description', 'details', 'explanation', 'what_changed', 'how_it_works', 'expect', 'impact', 'benefit', 'text', 'message']
        .map((k) => coerceReleaseBulletText(raw[k]))
        .filter(Boolean)
        .join(' ');
      const head = coerceReleaseBulletText(title).replace(/[:.\s]+$/, '');
      if (head && rest) return `${head}: ${rest}`;
      return head || rest;
    }
    return String(raw).trim();
  }

  function formatSectionedReleaseBody({ intro, newFeatures = [], fixes = [], improvements = [], requestedFeatures = [], securityUpdates = [], otherChanges = [], highlights = [], outro }) {
    const keepUserLine = (v) => {
      const clean = coerceReleaseBulletText(v);
      if (clean.length <= 2 || /\[object\s+[^\]]+\]/i.test(clean) || TECH_COMMIT_RE.test(clean) || CODE_TOKEN_RE.test(clean)) return '';
      return `• ${clean}`;
    };
    const parts = [];
    if (intro) parts.push(intro.trim());
    const pushSection = (heading, items) => {
      const list = (items || []).map(keepUserLine).filter(Boolean);
      if (list.length) parts.push(`${heading}\n${list.join('\n')}`);
    };
    const nf = newFeatures.filter((v) => keepUserLine(v));
    const fx = fixes.filter((v) => keepUserLine(v));
    const im = improvements.filter((v) => keepUserLine(v));
    const su = securityUpdates.filter((v) => keepUserLine(v));
    const oc = otherChanges.filter((v) => keepUserLine(v));
    if (nf.length || fx.length || im.length || su.length || oc.length) {
      pushSection('New Features', nf);
      pushSection('Fixes', fx);
      pushSection('Improvements', im);
      pushSection('Security Updates', su);
      pushSection('Other Changes', oc);
    } else if (highlights.length) {
      const buckets = bucketizeReleaseUpdates(highlights);
      pushSection('New Features', buckets.newFeatures);
      pushSection('Fixes', buckets.fixes);
      pushSection('Improvements', buckets.improvements);
      pushSection('Security Updates', buckets.securityUpdates);
    }
    if (requestedFeatures.length) {
      pushSection('Features Requested by Users:', requestedFeatures);
    }
    if (outro) parts.push(outro.trim());
    return parts.filter(Boolean).join('\n\n');
  }

  const RELEASE_STYLE_ANGLES = [
    'Strictly factual, direct plain-English summary sticking closely to the verified changes',
    'Concise, plainspoken changelog stating what changed on screen with zero promotional filler',
    'Clear, objective release notes written for savers and group admins without exaggerated claims',
    'Matter-of-fact product update highlighting exact additions and fixes without embellishment'
  ];
  let currentReleaseBulletVariant = 0;
  let hasAiDraftInEditor = false;

  function updateReleaseChangeNotice(context) {
    const notice = document.getElementById('release-update-change-notice');
    const noticeText = document.getElementById('release-update-change-notice-text');
    if (!notice || !noticeText) return;
    if (!context) {
      notice.hidden = true;
      return;
    }
    const updateCount = Array.isArray(context.systemUpdates) ? context.systemUpdates.length : 0;
    const reqCount = Array.isArray(context.targetImplemented) ? context.targetImplemented.length : 0;
    const bugCount = Array.isArray(context.targetFixedBugs) ? context.targetFixedBugs.length : 0;
    const sinceLabel = context.latestReleaseVersion ? ` since ${context.latestReleaseVersion}` : '';
    notice.hidden = false;
    if (context.hasNewChanges) {
      const parts = [`${updateCount} system update(s)`];
      if (reqCount) parts.push(`${reqCount} implemented request(s)`);
      if (bugCount) parts.push(`${bugCount} fixed bug report(s)`);
      notice.classList.remove('is-empty');
      noticeText.textContent = `Detected ${parts.join(', ')}${sinceLabel}. Click Write with AI to analyze and draft every item dynamically.`;
    } else {
      notice.classList.add('is-empty');
      noticeText.textContent = `No new system changes, fixed bug reports, or implemented feature requests detected${sinceLabel}. Wait for new updates before generating release notes, or write manually if needed.`;
    }
  }

  const releaseMediaInput = document.getElementById('release-update-media-input');
  const releaseMediaHelp = document.getElementById('release-update-media-help');
  const releaseMediaPreviews = document.getElementById('release-update-media-previews');
  const releaseDialogTitleEl = document.getElementById('release-update-title');
  const releaseDialogCopyEl = document.getElementById('release-update-copy');
  const releaseSubmitBtn = document.getElementById('release-update-submit');
  let editingReleaseAnnouncement = null;
  let releaseQueuedMedia = [];
  let releaseExistingAttachments = [];
  let releaseExistingPreviewUrls = {};
  let releaseRemovedPaths = [];

  function renderReleaseMediaPreviews() {
    const totalCount = releaseExistingAttachments.length + releaseQueuedMedia.length;
    if (releaseMediaHelp) {
      releaseMediaHelp.textContent = totalCount
        ? `${totalCount} file${totalCount === 1 ? '' : 's'} attached${releaseQueuedMedia.length ? ` (${releaseQueuedMedia.length} new to upload)` : ''} — pictures or videos up to 50 MB each.`
        : 'No files selected. Any picture or video format up to 50 MB each.';
    }
    if (!releaseMediaPreviews) return;
    if (!totalCount) {
      releaseMediaPreviews.hidden = true;
      releaseMediaPreviews.replaceChildren();
      return;
    }
    releaseMediaPreviews.hidden = false;
    const existingHtml = releaseExistingAttachments.map((media, index) => {
      const url = releaseExistingPreviewUrls[media.path] || '';
      const label = Ipon.escapeHtml(media.name || (media.kind === 'video' ? 'video' : 'picture'));
      const preview = url
        ? (media.kind === 'video'
          ? `<video src="${Ipon.escapeHtml(url)}" muted playsinline preload="metadata"></video>`
          : `<img src="${Ipon.escapeHtml(url)}" alt="${label}">`)
        : `<div class="announcement-preview-placeholder">${label}</div>`;
      return `
        <figure class="bug-image-card announcement-preview-card">
          ${preview}
          <button class="bug-image-remove" type="button" data-remove-release-existing="${index}" aria-label="Remove ${label}">&times;</button>
        </figure>`;
    }).join('');
    const queuedHtml = releaseQueuedMedia.map((entry, index) => `
      <figure class="bug-image-card announcement-preview-card">
        ${entry.kind === 'video'
        ? `<video src="${Ipon.escapeHtml(entry.previewUrl)}" muted playsinline preload="metadata"></video>`
        : `<img src="${Ipon.escapeHtml(entry.previewUrl)}" alt="${Ipon.escapeHtml(entry.file.name)}">`}
        <button class="bug-image-remove" type="button" data-remove-release-queued="${index}" aria-label="Remove ${Ipon.escapeHtml(entry.file.name)}">&times;</button>
      </figure>`).join('');
    releaseMediaPreviews.innerHTML = `${existingHtml}${queuedHtml}`;
  }

  function resetReleaseMediaState() {
    releaseQueuedMedia.forEach((entry) => URL.revokeObjectURL(entry.previewUrl));
    releaseQueuedMedia = [];
    releaseExistingAttachments = [];
    releaseExistingPreviewUrls = {};
    releaseRemovedPaths = [];
    editingReleaseAnnouncement = null;
    if (releaseMediaInput) releaseMediaInput.value = '';
    if (releaseDialogTitleEl) releaseDialogTitleEl.textContent = 'Publish release update';
    if (releaseDialogCopyEl) releaseDialogCopyEl.textContent = 'Announce a new system version and automatically link implemented requests.';
    if (releaseSubmitBtn) releaseSubmitBtn.textContent = 'Publish release update';
    renderReleaseMediaPreviews();
  }

  releaseMediaInput?.addEventListener('change', () => {
    const maxFiles = Ipon.MAX_ANNOUNCEMENT_FILES || 20;
    const chosen = [...(releaseMediaInput.files || [])];
    releaseMediaInput.value = '';
    for (const file of chosen) {
      if (releaseExistingAttachments.length + releaseQueuedMedia.length >= maxFiles) {
        Ipon.toast(`You can attach up to ${maxFiles} files per release update.`, 'error');
        break;
      }
      try {
        const kind = Ipon.classifyAnnouncementFile(file);
        releaseQueuedMedia.push({ file, kind, previewUrl: URL.createObjectURL(file) });
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      }
    }
    renderReleaseMediaPreviews();
  });

  releaseMediaPreviews?.addEventListener('click', (event) => {
    const existingBtn = event.target.closest('[data-remove-release-existing]');
    if (existingBtn) {
      const idx = Number(existingBtn.dataset.removeReleaseExisting);
      const [removed] = releaseExistingAttachments.splice(idx, 1);
      if (removed?.path) releaseRemovedPaths.push(removed.path);
      renderReleaseMediaPreviews();
      return;
    }
    const queuedBtn = event.target.closest('[data-remove-release-queued]');
    if (queuedBtn) {
      const idx = Number(queuedBtn.dataset.removeReleaseQueued);
      const [removed] = releaseQueuedMedia.splice(idx, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      renderReleaseMediaPreviews();
    }
  });

  async function openEditReleaseUpdateDialog(item) {
    if (!item || !releaseUpdateDialog || !releaseUpdateForm) return;
    releaseUpdateForm.reset();
    resetReleaseMediaState();
    editingReleaseAnnouncement = item;
    releaseExistingAttachments = Array.isArray(item.attachments) ? item.attachments.map((entry) => ({ ...entry })) : [];

    const notice = document.getElementById('release-update-change-notice');
    if (notice) notice.hidden = true;
    const aiErrorEl = document.getElementById('release-update-ai-error');
    if (aiErrorEl) {
      aiErrorEl.hidden = true;
      aiErrorEl.replaceChildren();
    }
    if (releaseDialogTitleEl) releaseDialogTitleEl.textContent = 'Edit release update';
    if (releaseDialogCopyEl) releaseDialogCopyEl.textContent = 'Update the release version, announcement text, or attached pictures and videos.';
    if (releaseSubmitBtn) releaseSubmitBtn.textContent = 'Save changes';

    const versionInput = document.getElementById('release-update-version');
    const dateInput = document.getElementById('release-update-date');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');

    hasAiDraftInEditor = false;
    if (versionInput) versionInput.value = item.release_version || '';
    if (dateInput) dateInput.value = String(item.created_at || new Date().toISOString()).slice(0, 10);
    if (titleInput) titleInput.value = item.title || '';
    if (detailsInput) detailsInput.value = item.description || '';
    renderReleaseMediaPreviews();
    releaseUpdateDialog.showModal();
    titleInput?.focus();

    if (releaseExistingAttachments.length) {
      try {
        const { urls = {} } = await Ipon.invokeAccountFunction({ action: 'announcement-view-urls', announcement_id: item.id });
        if (editingReleaseAnnouncement?.id === item.id && releaseUpdateDialog.open) {
          releaseExistingPreviewUrls = urls;
          renderReleaseMediaPreviews();
        }
      } catch (_) { }
    }
  }

  async function openReleaseUpdateDialog() {
    if (!releaseUpdateDialog || !releaseUpdateForm) return;
    resetReleaseMediaState();

    const aiErrorEl = document.getElementById('release-update-ai-error');
    if (aiErrorEl) {
      aiErrorEl.hidden = true;
      aiErrorEl.replaceChildren();
    }

    const context = await collectReleaseContext();
    const todayIso = new Date().toISOString().slice(0, 10);
    const versionInput = document.getElementById('release-update-version');
    const dateInput = document.getElementById('release-update-date');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');

    updateReleaseChangeNotice(context);
    hasAiDraftInEditor = false;
    if (titleInput) titleInput.value = `${formatReleaseVersionPrefix(context.nextVersion)}: `;
    if (detailsInput) detailsInput.value = '';

    if (versionInput) versionInput.value = context.nextVersion;
    if (dateInput) dateInput.value = todayIso;
    releaseUpdateDialog.showModal();
    if (versionInput) versionInput.focus();
  }

  const releaseAiBtn = document.getElementById('release-update-ai-btn');
  const releaseAiStatus = document.getElementById('release-update-ai-status');
  const releaseAiStatusText = document.getElementById('release-update-ai-status-text');
  const releaseAiError = document.getElementById('release-update-ai-error');
  const geminiKeyDialog = document.getElementById('gemini-key-dialog');
  const geminiKeyForm = document.getElementById('gemini-key-form');
  const geminiKeyInput = document.getElementById('gemini-api-key-input');
  const geminiKeyStatus = document.getElementById('gemini-key-status');
  const geminiKeyClose = document.getElementById('gemini-key-close');
  const geminiKeyClear = document.getElementById('gemini-key-clear');
  const geminiKeyTest = document.getElementById('gemini-key-test');
  const releaseKeyBtn = document.getElementById('release-update-key-btn');
  const geminiKeySave = geminiKeyForm?.querySelector('[type="submit"]');

  function renderGeminiStatusBadge(status) {
    if (!geminiKeyStatus) return;
    if (!status) {
      geminiKeyStatus.textContent = 'Checking server key status…';
      geminiKeyStatus.className = 'gemini-status-badge';
      return;
    }
    if (status.error) {
      geminiKeyStatus.textContent = status.error;
      geminiKeyStatus.className = 'gemini-status-badge is-error';
      return;
    }
    if (status.configured) {
      const sourceLabel = status.source === 'saved' ? 'Server override active' : 'Supabase secret active';
      geminiKeyStatus.textContent = `${sourceLabel} (${status.masked || 'configured'})`;
      geminiKeyStatus.className = 'gemini-status-badge is-connected';
    } else {
      geminiKeyStatus.textContent = 'No Gemini API key configured on server yet';
      geminiKeyStatus.className = 'gemini-status-badge';
    }
  }

  async function refreshServerGeminiStatus() {
    renderGeminiStatusBadge(null);
    try {
      const status = await Ipon.invokeAccountFunction({ action: 'gemini-key-status' });
      renderGeminiStatusBadge(status);
      return status;
    } catch (err) {
      renderGeminiStatusBadge({ error: Ipon.friendlyError ? Ipon.friendlyError(err) : (err?.message || 'Unable to load server status.') });
      return null;
    }
  }

  async function openGeminiKeyDialog() {
    if (!geminiKeyDialog) return;
    if (geminiKeyInput) geminiKeyInput.value = '';
    geminiKeyDialog.showModal();
    if (geminiKeyInput) geminiKeyInput.focus();
    await refreshServerGeminiStatus();
  }

  releaseKeyBtn?.addEventListener('click', openGeminiKeyDialog);

  geminiKeyClose?.addEventListener('click', () => geminiKeyDialog?.close());

  geminiKeyForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const val = (geminiKeyInput?.value || '').trim();
    if (!val) {
      Ipon.toast('Enter a Google AI Studio or billing-enabled Gemini API key to verify and save.', 'error');
      geminiKeyInput?.focus();
      return;
    }
    try {
      Ipon.setBusy(geminiKeySave, true, 'Verifying & saving…');
      const res = await Ipon.invokeAccountFunction({
        action: 'save-gemini-key',
        api_key: val
      });
      localStorage.removeItem('ipon_gemini_api_key');
      if (geminiKeyInput) geminiKeyInput.value = '';
      if (geminiKeyStatus) {
        geminiKeyStatus.textContent = `Verified & saved on server (${res.masked || 'ready'}${res.model ? ` · ${res.model}` : ''})`;
        geminiKeyStatus.className = 'gemini-status-badge is-verified';
      }
      if (releaseAiError) {
        releaseAiError.hidden = true;
        releaseAiError.replaceChildren();
      }
      Ipon.toast(`Gemini API key verified and saved securely on server${res.model ? ` (${res.model})` : ''}.`);
      geminiKeyDialog?.close();
      const detailsInput = document.getElementById('release-update-details');
      if (releaseUpdateDialog?.open && detailsInput && !detailsInput.value.trim()) {
        releaseAiBtn?.click();
      }
    } catch (err) {
      const msg = Ipon.friendlyError ? Ipon.friendlyError(err) : (err?.message || 'Verification failed.');
      renderGeminiStatusBadge({ error: msg });
      Ipon.toast(msg, 'error');
    } finally {
      Ipon.setBusy(geminiKeySave, false);
    }
  });

  geminiKeyClear?.addEventListener('click', async () => {
    const confirmed = await Ipon.confirmAction({
      title: 'Reset custom server API key?',
      message: 'Remove the saved Super Admin API key override and revert to the Supabase secret default?',
      acceptLabel: 'Reset key'
    });
    if (!confirmed) return;
    try {
      Ipon.setBusy(geminiKeyClear, true, 'Resetting…');
      const res = await Ipon.invokeAccountFunction({ action: 'save-gemini-key', api_key: '' });
      localStorage.removeItem('ipon_gemini_api_key');
      if (geminiKeyInput) geminiKeyInput.value = '';
      renderGeminiStatusBadge(res);
      Ipon.toast('Custom server API key cleared.');
    } catch (err) {
      Ipon.toast(Ipon.friendlyError ? Ipon.friendlyError(err) : (err?.message || 'Could not clear key.'), 'error');
    } finally {
      Ipon.setBusy(geminiKeyClear, false);
    }
  });

  geminiKeyTest?.addEventListener('click', async () => {
    const key = (geminiKeyInput?.value || '').trim();
    try {
      Ipon.setBusy(geminiKeyTest, true, 'Testing…');
      const res = await Ipon.invokeAccountFunction({
        action: 'test-gemini-key',
        ...(key ? { api_key: key } : {})
      });
      Ipon.toast(res.message || `Connected to Google Gemini${res.model ? ` (${res.model})` : ''}!`);
      if (geminiKeyStatus) {
        geminiKeyStatus.textContent = `Connected & active${res.model ? ` (${res.model})` : ''}`;
        geminiKeyStatus.className = 'gemini-status-badge is-verified';
      }
    } catch (err) {
      const msg = Ipon.friendlyError ? Ipon.friendlyError(err) : (err?.message || 'Verification failed.');
      renderGeminiStatusBadge({ error: msg });
      Ipon.toast(msg, 'error');
    } finally {
      Ipon.setBusy(geminiKeyTest, false);
    }
  });

  releaseAiBtn?.addEventListener('click', async () => {
    const versionInput = document.getElementById('release-update-version');
    const dateInput = document.getElementById('release-update-date');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');
    const relDate = (dateInput?.value || new Date().toISOString().slice(0, 10)).trim();

    if (releaseAiError) {
      releaseAiError.hidden = true;
      releaseAiError.replaceChildren();
    }

    releaseCommitCache.clear();
    const context = await collectReleaseContext();
    updateReleaseChangeNotice(context);
    if (!context.hasNewChanges) {
      await Ipon.confirmAction({
        title: 'No new system changes yet',
        message: `All detected system updates, fixed bug reports, and implemented feature requests were already covered in ${context.latestReleaseVersion || 'the latest release'}. Write with AI will generate itemized release notes once new changes land in the system.`,
        acceptLabel: 'OK'
      });
      return;
    }

    const ver = (versionInput?.value || context.nextVersion || 'Update 1.0').trim();
    const targetImplemented = context.targetImplemented;
    const targetFixedBugs = context.targetFixedBugs || [];
    const systemUpdates = context.systemUpdates;
    const previousReleases = context.previousReleases;

    const prevTitle = titleInput?.value?.trim() || '';
    const prevDetails = detailsInput?.value?.trim() || '';
    const currentDraft = hasAiDraftInEditor ? sanitizeReleaseDetails(prevDetails).text : '';
    currentReleaseBulletVariant = (currentReleaseBulletVariant + 1) % 6;
    const styleAngle = RELEASE_STYLE_ANGLES[currentReleaseBulletVariant % RELEASE_STYLE_ANGLES.length];
    const nextSeed = currentReleaseBulletVariant;
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    try {
      Ipon.setBusy(releaseAiBtn, true);
      if (releaseAiStatus) {
        releaseAiStatus.hidden = false;
        if (releaseAiStatusText) releaseAiStatusText.textContent = 'Analyzing system changes with Gemini AI…';
      }

      const backendRes = await Ipon.invokeAccountFunction({
        action: 'ai-generate-release-notes',
        version: ver,
        release_date: relDate,
        latest_release_at: context.latestReleaseAt || null,
        previous_releases: previousReleases,
        previous_release_details: context.previousReleaseDetails || [],
        previous_title: prevTitle,
        current_draft: currentDraft,
        style_angle: styleAngle,
        variation_seed: nextSeed,
        system_updates: systemUpdates,
        fixed_bugs: targetFixedBugs.map((bug) => ({
          title: bug.title,
          description: bug.description
        })),
        features: targetImplemented.map((req) => {
          const prof = profileById.get(req.requester_id);
          return {
            title: req.title,
            description: req.details,
            requester_name: req.allow_credit !== false && prof?.full_name ? prof.full_name : null
          };
        })
      });

      if (backendRes?.no_new_changes) {
        await Ipon.confirmAction({
          title: 'No new system changes yet',
          message: backendRes.message || `All detected system updates and implemented feature requests were already covered in ${context.latestReleaseVersion || 'the latest release'}.`,
          acceptLabel: 'OK'
        });
        return;
      }

      const hasDraft = Boolean(backendRes?.title && backendRes?.details && (backendRes?.ai_powered || backendRes?.fallback_used));
      if (!hasDraft) {
        throw new Error(backendRes?.gemini_error || backendRes?.error || 'Gemini AI did not return release notes. Please try again.');
      }

      const sanitized = sanitizeReleaseDetails(backendRes.details);
      if (sanitized.bulletCount <= 0 || !sanitized.text) {
        throw new Error('Gemini AI returned no valid user-facing release notes. Please try again.');
      }

      const details = sanitized.text;
      let title = formatReleaseTitle(ver, backendRes.title, details, nextSeed);
      if (prevTitle && title === prevTitle) {
        title = formatReleaseTitle(ver, '', details, nextSeed + 1);
      }

      if (titleInput) titleInput.value = title;
      if (detailsInput) detailsInput.value = details;
      hasAiDraftInEditor = true;
      Ipon.toast(
        backendRes.ai_powered
          ? `Release announcement generated with Gemini AI${backendRes.model ? ` (${backendRes.model})` : ''}.`
          : 'Release notes drafted from verified system updates (Gemini AI unavailable on current key).'
      );
    } catch (err) {
      const msg = Ipon.friendlyError ? Ipon.friendlyError(err) : (err?.message || 'Generation failed');
      const isKeyError = /BILLING_DISABLED|billing is disabled|API key|GEMINI_API_KEY|revoked|rejected|not configured|401|403/i.test(`${err?.message || ''} ${msg}`);
      if (releaseAiError && Ipon.showInlineError) {
        Ipon.showInlineError(
          releaseAiError,
          err,
          () => releaseAiBtn?.click(),
          1,
          'Gemini AI generation failed',
          isKeyError ? { label: 'Configure API key', onClick: openGeminiKeyDialog } : null
        );
      }
      Ipon.toast(msg, 'error');
    } finally {
      Ipon.setBusy(releaseAiBtn, false);
      if (releaseAiStatus) releaseAiStatus.hidden = true;
    }
  });

  releaseUpdateBtn?.addEventListener('click', openReleaseUpdateDialog);
  document.getElementById('release-update-close')?.addEventListener('click', () => releaseUpdateDialog?.close());
  document.getElementById('release-update-cancel')?.addEventListener('click', () => releaseUpdateDialog?.close());
  releaseUpdateDialog?.addEventListener('close', () => {
    releaseUpdateForm?.reset();
    resetReleaseMediaState();
    hasAiDraftInEditor = false;
    const notice = document.getElementById('release-update-change-notice');
    if (notice) notice.hidden = true;
    if (releaseAiStatus) releaseAiStatus.hidden = true;
    if (releaseAiError) {
      releaseAiError.hidden = true;
      releaseAiError.replaceChildren();
    }
    ['release-update-version', 'release-update-heading', 'release-update-details'].forEach((id) => {
      const el = document.getElementById(id);
      if (el && Ipon.setFieldError) Ipon.setFieldError(el, '');
    });
  });

  releaseUpdateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const versionInput = document.getElementById('release-update-version');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');

    const version = (versionInput?.value || '').trim();
    const title = (titleInput?.value || '').trim();
    const details = (detailsInput?.value || '').trim();

    if (!version) {
      Ipon.setFieldError(versionInput, 'Please specify a release version.');
      versionInput.focus();
      return;
    }
    if (!title) {
      Ipon.setFieldError(titleInput, 'Please enter an announcement title.');
      titleInput.focus();
      return;
    }
    if (!details) {
      Ipon.setFieldError(detailsInput, 'Please enter release notes and changes.');
      detailsInput.focus();
      return;
    }

    const isEditing = Boolean(editingReleaseAnnouncement?.id);
    const confirmed = await Ipon.confirmAction({
      title: isEditing ? 'Save release update changes?' : 'Publish release update?',
      message: isEditing
        ? `Save your edits to "${title}"?`
        : `Publish "${title}" as a system release announcement to all users?`,
      acceptLabel: isEditing ? 'Save changes' : 'Publish update'
    });
    if (!confirmed) return;

    const button = releaseSubmitBtn || releaseUpdateForm.querySelector('[type="submit"]');
    const announcementId = isEditing ? editingReleaseAnnouncement.id : crypto.randomUUID();
    const pendingRemovals = isEditing ? [...releaseRemovedPaths] : [];
    let uploadedPaths = [];
    Ipon.setBusy(button, true, isEditing ? 'Saving…' : 'Publishing…');
    try {
      const uploaded = await Ipon.uploadAnnouncementAttachments(announcementId, releaseQueuedMedia, {
        onStatus: (label) => Ipon.setBusy(button, true, label)
      });
      uploadedPaths = uploaded.uploadedPaths;
      if (isEditing) {
        const previousVersion = editingReleaseAnnouncement.release_version;
        await Ipon.rpc('update_announcement', {
          p_announcement_id: announcementId,
          p_title: title,
          p_description: details,
          p_attachments: [...releaseExistingAttachments, ...uploaded.attachments],
          p_release_version: version
        });
        if (pendingRemovals.length) {
          Ipon.invokeAccountFunction({ action: 'announcement-cleanup-media', paths: pendingRemovals }).catch(() => { });
        }
        if (previousVersion && previousVersion !== version) {
          featureRequests.forEach((req) => {
            if (req.release_version === previousVersion) req.release_version = version;
          });
          bugReports.forEach((bug) => {
            if (bug.release_version === previousVersion) bug.release_version = version;
          });
        }
      } else {
        await Ipon.rpc('create_announcement', {
          p_id: announcementId,
          p_title: title,
          p_description: details,
          p_attachments: uploaded.attachments,
          p_announcement_type: 'RELEASE',
          p_release_version: version
        });
        // Mark all currently unreleased implemented requests & fixed bugs locally with this version
        featureRequests.forEach((req) => {
          if (req.status === 'IMPLEMENTED' && !req.release_version) {
            req.release_version = version;
          }
        });
        bugReports.forEach((bug) => {
          if ((bug.status || 'OPEN') === 'FIXED' && !bug.release_version) {
            bug.release_version = version;
          }
        });
      }
      releaseUpdateDialog.close();
      releaseUpdateForm.reset();
      resetReleaseMediaState();
      Ipon.toast(isEditing ? 'Release update saved.' : 'Release update published successfully.');
      await load();
    } catch (error) {
      if (uploadedPaths.length) {
        Ipon.invokeAccountFunction({ action: 'announcement-cleanup-media', paths: uploadedPaths }).catch(() => { });
      }
      if (String(error?.message || '').toLowerCase().includes('already been published')) {
        Ipon.setFieldError(versionInput, 'Release version already exists. Please choose a unique version.');
        versionInput.focus();
      } else {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      }
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  [
    ['feature-requests', ['feature-requests-search'], renderFeatureRequests],
    ['bug-reports', ['bug-reports-search'], renderBugReports],
    ['users', ['users-search', 'users-status-filter'], renderUsers],
    ['badges', ['badges-search', 'badges-status-filter'], renderBadges],
    ['effects', ['effects-search', 'effects-status-filter'], renderEffects],
    ['effect-requests', ['effect-requests-search', 'effect-requests-status-filter'], renderEffectTrialRequests],
    ['activity', ['activity-search'], renderActivity]
  ].forEach(([key, controlIds, render]) => {
    controlIds.forEach((id) => {
      const control = document.getElementById(id);
      control?.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => { pageState[key] = 0; render(); });
    });
    document.getElementById(`${key}-pager`)?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page]');
      if (!button || button.disabled) return;
      pageState[key] += button.dataset.page === 'next' ? 1 : -1;
      render();
    });
  });
  window.addEventListener('hashchange', async () => {
    showView(true);
    Ipon.setLoading(true);
    try { await refresh(); } finally { Ipon.setLoading(false); }
  });
  showView();

  async function refresh() {
    try {
      await load();
    } catch (error) {
      document.getElementById('platform-status').textContent = 'Platform data unavailable';
      document.getElementById('platform-attention').innerHTML = '<p>Resolve the loading error below, then retry to restore the platform summary.</p>';
      overviewError.hidden = false;
      Ipon.showInlineError(overviewError, error, refresh);
      Ipon.showInlineError(featureRequestsBody, error, refresh, 5);
      if (bugReportsBody) Ipon.showInlineError(bugReportsBody, error, refresh, 8);
      Ipon.showInlineError(administratorsBody, error, refresh, 6);
      if (badgesBody) Ipon.showInlineError(badgesBody, error, refresh, 5);
      if (effectsBody) Ipon.showInlineError(effectsBody, error, refresh, 5);
      if (effectRequestsBody) Ipon.showInlineError(effectRequestsBody, error, refresh, 5);
      Ipon.showInlineError(activityBody, error, refresh, 3);
    }
  }

  const switchPlatformView = (targetHash) => {
    if (targetHash && location.hash !== targetHash) {
      try { history.replaceState(null, '', `${location.pathname}${location.search}${targetHash}`); } catch { location.hash = targetHash; }
    }
    showView(false);
  };
  try { await refresh(); } finally { Ipon.setLoading(false); }
  Ipon.consumeDeepLink(async (params, hash) => {
    const annId = params.get('announcement') || '';
    const releaseVer = params.get('release') || '';
    const annTitle = params.get('announcement_title') || '';
    if (annId || releaseVer || annTitle) {
      switchPlatformView('#announcements');
      if (announcements?.openMatching) {
        const opened = await announcements.openMatching({ id: annId, releaseVersion: releaseVer, title: annTitle });
        if (opened) return true;
      }
      return !params.has('notice');
    }

    const frId = params.get('feature_request') || '';
    if (frId) {
      const frSearch = document.getElementById('feature-requests-search');
      if (frSearch) frSearch.value = '';
      activeFeatureStatusFilter = 'ALL';
      featureStatusTabs?.querySelectorAll('[data-status-filter]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.statusFilter === 'ALL');
      });
      const idx = featureRequests.findIndex((item) => String(item.id) === String(frId));
      if (idx >= 0) pageState['feature-requests'] = Math.floor(idx / PAGE_SIZE);
      renderFeatureRequests();
      switchPlatformView('#feature-requests');
      const safeId = CSS.escape ? CSS.escape(frId) : frId;
      const cardEl = featureCardsContainer?.querySelector(`[data-feature-id="${safeId}"]`) || null;
      const rowEl = idx >= 0 ? (featureRequestsBody?.querySelectorAll('tr')[idx % PAGE_SIZE] || null) : null;
      if (cardEl) Ipon.highlightFocus(cardEl);
      else if (rowEl) Ipon.highlightFocus(rowEl);
      await Ipon.openFeatureRequestDetails(frId);
      return true;
    }

    const bugId = params.get('bug_report') || '';
    if (bugId) {
      const bugSearch = document.getElementById('bug-reports-search');
      if (bugSearch) bugSearch.value = '';
      const matchedBug = bugReports.find((item) => String(item.id) === String(bugId));
      activeBugStatusFilter = matchedBug ? (matchedBug.status || 'OPEN').toUpperCase() : 'ALL';
      bugStatusTabs?.querySelectorAll('[data-bug-status-filter]').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.bugStatusFilter === activeBugStatusFilter);
      });
      const visibleBugs = bugReports.filter((item) => activeBugStatusFilter === 'ALL' || (item.status || 'OPEN').toUpperCase() === activeBugStatusFilter);
      const idx = visibleBugs.findIndex((item) => String(item.id) === String(bugId));
      if (idx >= 0) pageState['bug-reports'] = Math.floor(idx / PAGE_SIZE);
      renderBugReports();
      switchPlatformView('#bug-reports');
      const rowEl = idx >= 0 ? (bugReportsBody?.querySelectorAll('tr')[idx % PAGE_SIZE] || null) : null;
      if (rowEl) Ipon.highlightFocus(rowEl);
      const safeId = CSS.escape ? CSS.escape(bugId) : bugId;
      const viewBtn = bugReportsBody?.querySelector(`[data-view-bug="${safeId}"]`);
      if (viewBtn) {
        viewBtn.click();
        return true;
      }
      const report = idx >= 0 ? bugReports[idx] : null;
      if (report && bugViewerDialog) {
        const submitter = profiles.find((p) => String(p.id) === String(report.reporter_id));
        const titleEl = document.getElementById('bug-viewer-title');
        const metaEl = document.getElementById('bug-viewer-meta');
        const descEl = document.getElementById('bug-viewer-description');
        const imagesEl = document.getElementById('bug-viewer-images');
        if (titleEl) titleEl.textContent = report.title || 'Bug report';
        if (metaEl) metaEl.textContent = `${submitter?.full_name || 'Former user'} · ${Ipon.dateLabel(report.created_at)}`;
        if (descEl) descEl.textContent = report.description || '';
        if (imagesEl) imagesEl.innerHTML = '<p class="empty-state">No screenshots attached.</p>';
        if (!bugViewerDialog.open) bugViewerDialog.showModal();
        return true;
      }
      return !params.has('notice');
    }

    const userId = params.get('admin_user') || '';
    if (userId) {
      const userSearch = document.getElementById('users-search');
      const statusFilter = document.getElementById('users-status-filter');
      if (userSearch) userSearch.value = '';
      if (statusFilter) statusFilter.value = '';
      const safeId = CSS.escape ? CSS.escape(userId) : userId;
      const totalPages = Math.max(1, Math.ceil(profiles.length / PAGE_SIZE));
      let rowEl = null;
      for (let p = 0; p < totalPages; p += 1) {
        pageState.users = p;
        renderUsers();
        rowEl = administratorsBody?.querySelector(`tr[data-user-id="${safeId}"]`) || null;
        if (rowEl) break;
      }
      switchPlatformView('#administrators');
      if (rowEl) {
        Ipon.highlightFocus(rowEl);
        return true;
      }
      return !params.has('notice');
    }

    if (hash) {
      if (hash === '#effects' && profileEffectTrialRequests.some((r) => r?.status === 'PENDING')) {
        activeEffectsSubtab = 'requests';
        syncEffectsSubtabUi();
      }
      switchPlatformView(hash);
      return !params.has('notice');
    }
    return false;
  });
  Ipon.subscribeToChanges('super-admin', ['profiles', 'profile_effect_grants', 'profile_effect_trial_requests', 'groups', 'group_memberships', 'admin_requests', 'feature_requests', 'bug_reports', 'account_activity', 'audit_logs', 'announcements', 'announcement_reactions'], refresh);
})();
