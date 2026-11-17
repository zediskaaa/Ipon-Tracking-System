(async function () {
  'use strict';

  const state = await Ipon.init({ allowedRoles: ['SUPER_ADMIN'] });
  if (state.failed || !state.configured || !state.profile) return;

  const featureRequestsBody = document.getElementById('feature-requests-body');
  const bugReportsBody = document.getElementById('bug-reports-body');
  const administratorsBody = document.getElementById('administrators-body');
  const activityBody = document.getElementById('activity-body');
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
    addButton: document.getElementById('sa-add-announcement')
  });
  let profiles = [];
  let groups = [];
  let groupMemberships = [];
  let featureRequests = [];
  let bugReports = [];
  let accountActivities = [];
  let activityLogs = [];
  let activeFeatureStatusFilter = 'ALL';
  let activeBugStatusFilter = 'OPEN';
  const PAGE_SIZE = 10;
  const pageState = { 'feature-requests': 0, 'bug-reports': 0, users: 0, activity: 0 };
  Ipon.bindPasswordStrength(administratorForm.elements.password, () => [administratorForm.elements.first_name.value, administratorForm.elements.middle_name.value, administratorForm.elements.last_name.value, administratorForm.elements.email.value]);
  Ipon.bindPasswordStrength(userPasswordForm.elements.password, () => {
    const target = profiles.find((item) => item.id === userPasswordForm.elements.user_id.value);
    return target ? [target.first_name, target.middle_name, target.last_name, target.email] : [];
  });
  const views = {
    overview: ['Platform overview', 'Monitor administrator accounts, savings groups, and user feedback without exposing financial records.'],
    'feature-requests': ['Feature requests', 'Review improvements suggested by active IPON users.'],
    'bug-reports': ['Bug reports', 'Review reported problems, error details, and attached screenshots from IPON users.'],
    administrators: ['Users', 'Manage administrators, group users, passwords, and assigned savings groups.'],
    activity: ['Platform activity', 'Review recent administrator and savings-group access changes recorded by the database.']
  };

  const viewFocusHeadings = {
    overview: 'platform-view-title',
    'feature-requests': 'feature-requests-title',
    'bug-reports': 'bug-reports-title',
    administrators: 'users-title',
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

  function renderOverview() {
    const admins = profiles.filter((profile) => profile.role === 'ADMIN');
    document.getElementById('metric-total-admins').textContent = admins.length;
    document.getElementById('metric-active-admins').textContent = admins.filter((profile) => profile.status === 'ACTIVE').length;
    document.getElementById('metric-suspended-admins').textContent = admins.filter((profile) => profile.status === 'DISABLED').length;
    document.getElementById('metric-groups').textContent = groups.length;
    document.getElementById('platform-status').innerHTML = '<span aria-hidden="true"></span>Database access verified';
    const suspended = admins.filter((profile) => profile.status === 'DISABLED');
    const attention = [];
    if (suspended.length) attention.push(`<a href="super-admin.html#administrators"><strong>${suspended.length} suspended administrator${suspended.length === 1 ? '' : 's'}</strong><span>Review disabled accounts and reactivate them only when access should be restored.</span></a>`);
    document.getElementById('platform-attention').innerHTML = attention.length ? attention.join('') : '<div class="platform-clear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span><strong>No urgent platform work</strong><small>Administrator accounts, groups, and feedback queues are currently up to date.</small></span></div>';
  }

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
              <strong>${Ipon.escapeHtml(profile.full_name)}</strong>
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
    const safeQuery = (query) => (Ipon.withTimeout ? Ipon.withTimeout(query) : Promise.resolve(query)).catch((err) => ({ data: [], error: err }));
    const [profileResult, groupResult, membershipResult, featureRequestResult, bugReportResult, activityResult, logResult, storageResult] = await Promise.all([
      safeQuery(Ipon.client.from('profiles').select('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,avatar_url,created_at').order('created_at', { ascending: false })),
      safeQuery(Ipon.client.from('groups').select('id,name,owner_id,status,workspace_mode,created_at').order('created_at', { ascending: false })),
      safeQuery(Ipon.client.from('group_memberships').select('group_id,user_id,role,status')),
      safeQuery(Ipon.client.from('feature_requests').select('id,requester_id,allow_credit,title,details,status,reviewed_at,reviewed_by,release_version,created_at').order('created_at', { ascending: false }).limit(200)),
      safeQuery(Ipon.client.from('bug_reports').select('id,reporter_id,title,description,image_count,status,reviewed_at,release_version,created_at').order('created_at', { ascending: false }).limit(200)),
      safeQuery(Ipon.client.rpc('super_admin_user_last_activities')),
      safeQuery(Ipon.client.from('audit_logs').select('id,table_name,record_id,action,changed_at').in('table_name', ['profiles', 'groups']).order('changed_at', { ascending: false }).limit(200)),
      safeQuery(Ipon.client.rpc('super_admin_storage_overview')),
      announcements ? safeQuery(announcements.load()) : Promise.resolve()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (groupResult.error) throw groupResult.error;
    profiles = profileResult.data || [];
    groups = groupResult.data || [];
    groupMemberships = membershipResult.data || [];
    featureRequests = featureRequestResult.data || [];
    bugReports = bugReportResult.data || [];
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
    renderOverview();
    renderStorageOverview();
    renderFeatureRequests();
    renderBugReports();
    renderUsers();
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

  document.getElementById('create-administrator').addEventListener('click', () => { resetAdministratorForm(); administratorDialog.showModal(); administratorForm.elements.first_name.focus(); });
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

  async function openReleaseUpdateDialog() {
    if (!releaseUpdateDialog || !releaseUpdateForm) return;

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

    const confirmed = await Ipon.confirmAction({
      title: 'Publish release update?',
      message: `Publish "${title}" as a system release announcement to all users ? `,
      acceptLabel: 'Publish update'
    });
    if (!confirmed) return;

    const button = releaseUpdateForm.querySelector('[type="submit"]');
    Ipon.setBusy(button, true, 'Publishing…');
    try {
      await Ipon.rpc('create_announcement', {
        p_title: title,
        p_description: details,
        p_attachments: [],
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
      releaseUpdateDialog.close();
      releaseUpdateForm.reset();
      Ipon.toast('Release update published successfully.');
      await load();
    } catch (error) {
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
      switchPlatformView(hash);
      return !params.has('notice');
    }
    return false;
  });
  Ipon.subscribeToChanges('super-admin', ['profiles', 'groups', 'group_memberships', 'admin_requests', 'feature_requests', 'bug_reports', 'account_activity', 'audit_logs', 'announcements', 'announcement_reactions'], refresh);
})();
