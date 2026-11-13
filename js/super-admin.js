(async function () {
  'use strict';

  const state = await Ipon.init({ allowedRoles: ['SUPER_ADMIN'] });
  if (state.failed || !state.configured || !state.profile) return;

  const requestsBody = document.getElementById('requests-body');
  const featureRequestsBody = document.getElementById('feature-requests-body');
  const bugReportsBody = document.getElementById('bug-reports-body');
  const administratorsBody = document.getElementById('administrators-body');
  const activityBody = document.getElementById('activity-body');
  const approvalDialog = document.getElementById('approve-request-dialog');
  const approvalForm = document.getElementById('approve-request-form');
  const approvalId = document.getElementById('approve-request-id');
  const groupName = document.getElementById('approve-group-name');
  const approvalCopy = document.getElementById('approve-request-copy');
  const rejectDialog = document.getElementById('reject-request-dialog');
  const rejectForm = document.getElementById('reject-request-form');
  const rejectId = document.getElementById('reject-request-id');
  const rejectPreset = document.getElementById('reject-reason-preset');
  const rejectSubject = document.getElementById('reject-email-subject');
  const rejectText = document.getElementById('reject-reason-text');
  const rejectCopy = document.getElementById('reject-request-copy');
  const administratorDialog = document.getElementById('administrator-dialog');
  const administratorForm = document.getElementById('administrator-form');
  const userPasswordDialog = document.getElementById('user-password-dialog');
  const userPasswordForm = document.getElementById('user-password-form');
  const bugViewerDialog = document.getElementById('bug-viewer-dialog');
  const overviewError = document.getElementById('overview-error');
  const releaseUpdateDialog = document.getElementById('release-update-dialog');
  const releaseUpdateForm = document.getElementById('release-update-form');
  const releaseUpdateBtn = document.getElementById('sa-add-release-update');
  const featureStatusTabs = document.getElementById('feature-requests-status-tabs');
  const featureCardsContainer = document.getElementById('feature-requests-cards');
  const featureTableWrap = document.getElementById('feature-requests-table-wrap');
  const featureViewToggle = document.getElementById('feature-requests-view-toggle');
  let featureViewMode = localStorage.getItem('ipon_feature_view_mode') || 'cards';

  function setFeatureViewMode(mode) {
    featureViewMode = mode === 'table' ? 'table' : 'cards';
    try { localStorage.setItem('ipon_feature_view_mode', featureViewMode); } catch (_) {}
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
  let requests = [];
  let featureRequests = [];
  let bugReports = [];
  let accountActivities = [];
  let activityLogs = [];
  let activeFeatureStatusFilter = 'ALL';
  const PAGE_SIZE = 10;
  const pageState = { requests: 0, 'feature-requests': 0, 'bug-reports': 0, users: 0, activity: 0 };
  Ipon.bindPasswordStrength(administratorForm.elements.password, () => [administratorForm.elements.first_name.value, administratorForm.elements.middle_name.value, administratorForm.elements.last_name.value, administratorForm.elements.email.value]);
  Ipon.bindPasswordStrength(userPasswordForm.elements.password, () => {
    const target = profiles.find((item) => item.id === userPasswordForm.elements.user_id.value);
    return target ? [target.first_name, target.middle_name, target.last_name, target.email] : [];
  });
  const views = {
    overview: ['Platform overview', 'Monitor administrator access, savings groups, and requests without exposing financial records.'],
    requests: ['Administrator requests', 'Review pending applications and create an isolated savings group when access is approved.'],
    'feature-requests': ['Feature requests', 'Review improvements suggested by active IPON users.'],
    'bug-reports': ['Bug reports', 'Review reported problems, error details, and attached screenshots from IPON users.'],
    administrators: ['Users', 'Manage administrators, group users, passwords, and assigned savings groups.'],
    activity: ['Platform activity', 'Review recent administrator and savings-group access changes recorded by the database.']
  };

  function showView(focusHeading = false) {
    const requestedView = location.hash.slice(1);
    const activeView = views[requestedView] ? requestedView : 'overview';
    if (!views[requestedView]) history.replaceState(null, '', '#overview');
    document.querySelectorAll('[data-platform-view]').forEach((section) => { section.hidden = section.dataset.platformView !== activeView; });
    document.getElementById('platform-view-title').textContent = views[activeView][0];
    document.getElementById('platform-view-description').textContent = views[activeView][1];
    document.getElementById('create-administrator').hidden = activeView !== 'administrators';
    document.querySelectorAll('[data-nav-section]').forEach((link) => {
      const current = link.dataset.navSection === activeView;
      link.classList.toggle('is-active', current);
      if (current) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    if (focusHeading) {
      const heading = document.getElementById('platform-view-title');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function statusLabel(status) {
    return `<span class="status status-${String(status).toLowerCase()}">${Ipon.escapeHtml(status)}</span>`;
  }

  function renderOverview() {
    const admins = profiles.filter((profile) => profile.role === 'ADMIN');
    const pending = profiles.filter((profile) => profile.role === 'MEMBER' && profile.status === 'PENDING' && !profile.group_id);
    document.getElementById('metric-total-admins').textContent = admins.length;
    document.getElementById('metric-active-admins').textContent = admins.filter((profile) => profile.status === 'ACTIVE').length;
    document.getElementById('metric-suspended-admins').textContent = admins.filter((profile) => profile.status === 'DISABLED').length;
    document.getElementById('metric-pending-requests').textContent = pending.length;
    document.getElementById('metric-groups').textContent = groups.length;
    document.getElementById('platform-status').innerHTML = '<span aria-hidden="true"></span>Database access verified';
    const suspended = admins.filter((profile) => profile.status === 'DISABLED');
    const attention = [];
    const pendingRequests = requests.filter((request) => request.status === 'PENDING');
    if (pendingRequests.length) attention.push(`<a href="super-admin.html#requests"><strong>${pendingRequests.length} administrator request${pendingRequests.length === 1 ? '' : 's'} awaiting review</strong><span>Approve or reject access before an account can manage a savings group.</span></a>`);
    if (suspended.length) attention.push(`<a href="super-admin.html#administrators"><strong>${suspended.length} suspended administrator${suspended.length === 1 ? '' : 's'}</strong><span>Review disabled accounts and reactivate them only when access should be restored.</span></a>`);
    document.getElementById('platform-attention').innerHTML = attention.length ? attention.join('') : '<div class="platform-clear"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span><strong>No urgent platform work</strong><small>Administrator access and requests are currently up to date.</small></span></div>';
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

  function renderRequests() {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const query = filterValue('requests-search');
    const status = filterValue('requests-status-filter');
    const filtered = requests.filter((request) => {
      const profile = profileById.get(request.requester_id);
      if (!profile) return false;
      if (status && request.status !== status) return false;
      return matchesQuery(query, [profile.full_name, request.email, request.contact_number, request.reason, request.status]);
    });
    const visible = paginateRows('requests', filtered);
    requestsBody.innerHTML = visible.length ? visible.map((request) => {
      const profile = profileById.get(request.requester_id);
      const pending = request.status === 'PENDING';
      const name = profile?.full_name || 'Requester';
      return `<tr>
      <td>
        <div class="table-user-cell">
          ${Ipon.avatarMarkup(profile?.avatar_url, name, 'table-user-avatar', profile?.id)}
          <div>
            <strong>${Ipon.escapeHtml(name)}</strong>
            <small class="field-help platform-id">${Ipon.escapeHtml(profile?.id || '')}</small>
          </div>
        </div>
      </td>
      <td>${Ipon.escapeHtml(request.contact_number || 'Not provided')}<small class="field-help">${Ipon.escapeHtml(request.email)}</small></td>
      <td>${Ipon.escapeHtml(request.reason)}${request.status === 'REJECTED' && request.review_note ? `<small class="field-help" style="color:var(--red);display:block;margin-top:4px;">Declined reason: ${Ipon.escapeHtml(request.review_note)}</small>` : ''}</td>
      <td>${Ipon.dateLabel(request.created_at)}</td><td>${statusLabel(request.status)}</td>
      <td><div class="table-actions">${pending ? `<button class="icon-action" type="button" data-approve-request="${profile.id}">Approve</button><button class="icon-action danger-action" type="button" data-reject-request="${profile.id}">Reject</button>` : request.status === 'REJECTED' ? `<button class="icon-action" type="button" data-reopen-request="${profile.id}">Reopen</button><button class="icon-action danger-action" type="button" data-unblock-request="${profile.id}">Unblock email</button>` : ''}</div></td>
    </tr>`; }).join('') : `<tr><td colspan="6" class="empty-state">${query || status ? 'No matching administrator requests.' : 'No administrator requests.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(requestsBody);
    Ipon.syncPresenceDots(requestsBody);
  }

  const ROLE_LABELS = { ADMIN: 'Administrator', TREASURER: 'Treasurer', MEMBER: 'Member' };

  function renderUsers() {
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const groupByOwner = new Map(groups.map((group) => [group.owner_id, group]));
    const lastActivity = new Map();
    accountActivities.forEach((activity) => { if (!lastActivity.has(activity.user_id)) lastActivity.set(activity.user_id, activity); });
    const query = filterValue('users-search');
    const role = filterValue('users-role-filter');
    const status = filterValue('users-status-filter');
    const users = profiles.filter((profile) => {
      if (!ROLE_LABELS[profile.role]) return false;
      if (role && profile.role !== role) return false;
      if (status && profile.status !== status) return false;
      const group = (profile.group_id ? groupById.get(profile.group_id) : null) || groupByOwner.get(profile.id);
      return matchesQuery(query, [profile.full_name, profile.email, profile.role, ROLE_LABELS[profile.role], group?.name, profile.status]);
    });
    const visible = paginateRows('users', users);
    administratorsBody.innerHTML = visible.length ? visible.map((profile) => {
      const group = (profile.group_id ? groupById.get(profile.group_id) : null) || groupByOwner.get(profile.id);
      const active = profile.status === 'ACTIVE';
      const actions = `<button class="icon-action" type="button" data-edit-admin="${profile.id}">Edit</button><button class="icon-action" type="button" data-set-password="${profile.id}">Change password</button><button class="icon-action" type="button" data-reset-admin="${profile.id}">Reset password</button><button class="icon-action ${active ? 'danger-action' : ''}" type="button" data-admin-status="${profile.id}" data-next-status="${active ? 'DISABLED' : 'ACTIVE'}">${active ? 'Suspend' : 'Reactivate'}</button><button class="icon-action danger-action" type="button" data-archive-admin="${profile.id}">Archive</button>`;
      return `<tr>
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile.avatar_url, profile.full_name, 'table-user-avatar', profile.id)}
            <div>
              <strong>${Ipon.escapeHtml(profile.full_name)}</strong>
              ${profile.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td><span class="role-badge role-${profile.role.toLowerCase()}">${Ipon.escapeHtml(ROLE_LABELS[profile.role])}</span></td>
        <td>${group ? Ipon.escapeHtml(group.name) : '<span class="field-help">Unassigned</span>'}</td>
        <td>${Ipon.dateLabel(profile.created_at)}</td>
        <td>${lastActivity.has(profile.id) ? `<span class="activity-kind">${Ipon.escapeHtml(lastActivity.get(profile.id).event.replaceAll('_', ' '))}</span><small class="field-help">${Ipon.dateLabel(lastActivity.get(profile.id).created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>` : '<span class="field-help">No activity</span>'}</td>
        <td>${statusLabel(profile.status)}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">${query || role || status ? 'No matching user accounts.' : 'No user accounts.'}</td></tr>`;
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

      return `<tr>
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

  function renderBugReports() {
    if (!bugReportsBody) return;
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const query = filterValue('bug-reports-search');
    const filtered = bugReports.filter((report) => {
      const profile = profileById.get(report.reporter_id);
      return matchesQuery(query, [profile?.full_name, profile?.email, profile?.role, report.title, report.description]);
    });
    const visible = paginateRows('bug-reports', filtered);
    bugReportsBody.innerHTML = visible.length ? visible.map((report) => {
      const profile = profileById.get(report.reporter_id);
      const reporterName = profile?.full_name || 'Former user';
      const count = Number(report.image_count || 0);
      return `<tr>
        <td>
          <div class="table-user-cell">
            ${Ipon.avatarMarkup(profile?.avatar_url, reporterName, 'table-user-avatar', report.reporter_id)}
            <div>
              <strong>${Ipon.escapeHtml(reporterName)}</strong>
              ${profile?.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}
            </div>
          </div>
        </td>
        <td>${Ipon.escapeHtml(profile?.role?.replaceAll('_', ' ') || 'Unavailable')}</td>
        <td><strong>${Ipon.escapeHtml(report.title)}</strong></td>
        <td><span class="feature-request-details">${Ipon.escapeHtml(report.description)}</span></td>
        <td>${count ? `<button class="icon-action" type="button" data-view-bug="${report.id}">View ${count} picture${count === 1 ? '' : 's'}</button>` : '<span class="field-help">None</span>'}</td>
        <td>${Ipon.dateLabel(report.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-state">${query ? 'No matching bug reports.' : 'No bug reports yet.'}</td></tr>`;
    Ipon.bindAvatarFallbacks(bugReportsBody);
    Ipon.syncPresenceDots(bugReportsBody);
  }

  function renderActivity(logs = activityLogs) {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    const query = filterValue('activity-search');
    const mapped = logs.map((log) => ({
      event: `${log.action.charAt(0)}${log.action.slice(1).toLowerCase()} ${log.table_name === 'groups' ? 'group' : 'account'}`,
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
    const [profileResult, groupResult, requestResult, featureRequestResult, bugReportResult, activityResult, logResult] = await Promise.all([
      Ipon.client.from('profiles').select('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,avatar_url,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('groups').select('id,name,owner_id,status,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('admin_requests').select('id,requester_id,email,contact_number,reason,status,review_note,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('feature_requests').select('id,requester_id,title,details,status,reviewed_at,reviewed_by,release_version,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('bug_reports').select('id,reporter_id,title,description,image_count,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('account_activity').select('user_id,event,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('audit_logs').select('id,table_name,record_id,action,changed_at').in('table_name', ['profiles', 'groups']).order('changed_at', { ascending: false }).limit(200),
      announcements ? announcements.load() : Promise.resolve()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (groupResult.error) throw groupResult.error;
    if (requestResult.error) throw requestResult.error;
    if (featureRequestResult.error) throw featureRequestResult.error;
    if (bugReportResult.error) throw bugReportResult.error;
    if (activityResult.error) throw activityResult.error;
    if (logResult.error) throw logResult.error;
    profiles = profileResult.data || [];
    groups = groupResult.data || [];
    requests = requestResult.data || [];
    featureRequests = featureRequestResult.data || [];
    bugReports = bugReportResult.data || [];
    accountActivities = activityResult.data || [];
    activityLogs = logResult.data || [];
    renderOverview();
    renderRequests();
    renderFeatureRequests();
    renderBugReports();
    renderUsers();
    renderActivity();
  }

  function closeApprovalDialog() {
    approvalDialog.close();
    approvalForm.reset();
  }

  function closeRejectDialog() {
    rejectDialog?.close();
    rejectForm?.reset();
  }

  rejectPreset?.addEventListener('change', () => {
    if (rejectPreset.value === 'custom') {
      rejectText.value = '';
      rejectText.placeholder = 'Compose email explaining why this request is declined…';
      rejectText.focus();
    } else {
      rejectText.value = rejectPreset.value;
    }
  });

  rejectText?.addEventListener('input', () => {
    const matched = [...rejectPreset.options].some((option) => option.value !== 'custom' && option.value === rejectText.value);
    if (!matched && rejectPreset.value !== 'custom') rejectPreset.value = 'custom';
  });

  async function sendDecisionNotice(payload, baseSuccess) {
    try {
      const result = await Ipon.notifyAdminRequestDecision(payload);
      if (result?.email_sent) {
        Ipon.toast(`${baseSuccess} Email update sent.`);
      } else {
        Ipon.toast(`${baseSuccess}${result?.email_error ? ` (Email not sent: ${result.email_error})` : ''}`, 'warning');
      }
    } catch (emailErr) {
      Ipon.toast(`${baseSuccess} (Email failed: ${Ipon.friendlyError(emailErr)})`, 'warning');
    }
  }

  requestsBody.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-approve-request]');
    const reject = event.target.closest('[data-reject-request]');
    const reopen = event.target.closest('[data-reopen-request]');
    const unblock = event.target.closest('[data-unblock-request]');
    if (unblock) {
      const profile = profiles.find((item) => item.id === unblock.dataset.unblockRequest);
      const req = requests.find((item) => item.requester_id === unblock.dataset.unblockRequest);
      if (!profile) return;
      const targetEmail = req?.email || profile.email;
      const accepted = await Ipon.confirmAction({
        title: 'Unblock email address?',
        message: `Clear rejected status and purge bogus record for ${profile.full_name} (${targetEmail})? This frees up the email so the legitimate applicant can submit a fresh request.`,
        acceptLabel: 'Unblock email'
      });
      if (!accepted) return;
      Ipon.setBusy(unblock, true, 'Unblocking…');
      try {
        await Ipon.unblockAdminRequest({ user_id: profile.id });
        Ipon.toast(`Email ${targetEmail} unblocked. The legitimate owner can now apply.`);
        await load();
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(unblock, false);
      }
      return;
    }
    if (reopen) {
      const profile = profiles.find((item) => item.id === reopen.dataset.reopenRequest);
      if (!profile) return;
      const accepted = await Ipon.confirmAction({ title: 'Reopen administrator request?', message: `${profile.full_name} can be reviewed again.`, acceptLabel: 'Reopen request' });
      if (!accepted) return;
      Ipon.setBusy(reopen, true, 'Reopening…');
      try { await Ipon.rpc('super_admin_reopen_request', { p_user_id: profile.id }); Ipon.toast('Administrator request reopened.'); await load(); }
      catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
      finally { Ipon.setBusy(reopen, false); }
      return;
    }
    if (approve) {
      const profile = profiles.find((item) => item.id === approve.dataset.approveRequest);
      if (!profile) return;
      approvalId.value = profile.id;
      groupName.value = `${profile.full_name} Savings Group`.slice(0, 150);
      approvalCopy.textContent = `Approve ${profile.full_name} and create an isolated savings group.`;
      approvalDialog.showModal();
      groupName.focus();
      groupName.select();
      return;
    }
    if (!reject) return;
    const profile = profiles.find((item) => item.id === reject.dataset.rejectRequest);
    if (!profile) return;
    rejectId.value = profile.id;
    rejectCopy.textContent = profile.email
      ? `Decline administrator request for ${profile.full_name} (${profile.email}).`
      : `Decline administrator request for ${profile.full_name}.`;
    if (rejectSubject) rejectSubject.value = "We're sorry, your administrator request on IPON was declined";
    rejectPreset.value = 'Duplicate or unverified administrator request';
    rejectText.value = 'Duplicate or unverified administrator request';
    rejectDialog.showModal();
    rejectText.focus();
  });

  rejectForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const targetUserId = rejectId.value;
    const profile = profiles.find((item) => item.id === targetUserId);
    const req = requests.find((item) => item.requester_id === targetUserId);
    const targetEmail = req?.email || profile?.email || '';
    const note = rejectText.value.trim();
    const subject = rejectSubject?.value.trim() || "We're sorry, your administrator request on IPON was declined";
    if (!profile || note.length < 5) {
      Ipon.setFieldError(rejectText, 'Enter at least 5 characters explaining why the request is rejected.');
      rejectText.focus();
      return;
    }
    const confirmed = await Ipon.confirmAction({
      title: 'Reject administrator request?',
      message: `Decline ${profile.full_name}'s administrator request? Once rejected, this email cannot submit another request.`,
      acceptLabel: 'Reject request'
    });
    if (!confirmed) return;

    const button = rejectForm.querySelector('[type="submit"]');
    Ipon.setBusy(button, true, 'Rejecting…');
    try {
      await Ipon.rpc('super_admin_reject_request', { p_user_id: targetUserId, p_review_note: note });
      closeRejectDialog();
      await sendDecisionNotice({
        user_id: targetUserId,
        email: targetEmail,
        decision: 'REJECTED',
        review_note: note,
        subject
      }, 'Administrator request rejected.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  approvalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const targetUserId = approvalId.value;
    const profile = profiles.find((item) => item.id === targetUserId);
    const req = requests.find((item) => item.requester_id === targetUserId);
    const targetEmail = req?.email || profile?.email || '';
    const approvedGroupName = groupName.value.trim();
    if (!approvedGroupName) return;

    const confirmed = await Ipon.confirmAction({
      title: 'Approve administrator request?',
      message: `Approve ${profile?.full_name || 'this applicant'} as an administrator and create savings group "${approvedGroupName}"?`,
      acceptLabel: 'Approve and create group'
    });
    if (!confirmed) return;

    const button = approvalForm.querySelector('[type="submit"]');
    Ipon.setBusy(button, true, 'Approving…');
    try {
      await Ipon.rpc('super_admin_approve_request', { p_user_id: targetUserId, p_group_name: approvedGroupName });
      closeApprovalDialog();
      await sendDecisionNotice({
        user_id: targetUserId,
        email: targetEmail,
        decision: 'APPROVED',
        group_name: approvedGroupName
      }, 'Administrator approved and group created.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  administratorsBody.addEventListener('click', async (event) => {
    const edit = event.target.closest('[data-edit-admin]');
    const reset = event.target.closest('[data-reset-admin]');
    const archive = event.target.closest('[data-archive-admin]');
    const button = event.target.closest('[data-admin-status]');
    const id = edit?.dataset.editAdmin || reset?.dataset.resetAdmin || archive?.dataset.archiveAdmin || button?.dataset.adminStatus;
    if (!id) return;
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    const roleLabel = ROLE_LABELS[profile.role].toLowerCase();
    const isAdmin = profile.role === 'ADMIN';
    if (edit) {
      const group = groups.find((item) => item.owner_id === profile.id);
      administratorForm.elements.user_id.value = profile.id;
      administratorForm.elements.first_name.value = profile.first_name || '';
      administratorForm.elements.middle_name.value = profile.middle_name || '';
      administratorForm.elements.last_name.value = profile.last_name || '';
      administratorForm.elements.email.value = profile.email || '';
      administratorForm.elements.email.disabled = true;
      administratorForm.elements.password.closest('.field').hidden = true;
      administratorForm.elements.password.required = false;
      administratorForm.elements.group_name.closest('.field').hidden = !isAdmin;
      administratorForm.elements.group_name.required = isAdmin;
      administratorForm.elements.group_name.value = group?.name || '';
      document.getElementById('administrator-dialog-title').textContent = `Edit ${roleLabel}`;
      administratorForm.querySelector('[type="submit"]').textContent = 'Save changes';
      administratorDialog.showModal();
      return;
    }
    if (reset) {
      if (!profile.email) return Ipon.toast(`This ${roleLabel} has no saved email address.`, 'error');
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
    if (archive) {
      const accepted = await Ipon.confirmAction({
        title: `Archive ${roleLabel}?`,
        message: isAdmin ? `${profile.full_name} will lose access and the group will be suspended. Records will be preserved.` : `${profile.full_name} will lose access to IPON. Existing group records will be preserved.`,
        acceptLabel: 'Archive'
      });
      if (!accepted) return;
      try { await Ipon.rpc('super_admin_archive_administrator', { p_user_id: profile.id }); Ipon.toast(`${ROLE_LABELS[profile.role]} archived.`); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
      return;
    }
    const nextStatus = button.dataset.nextStatus;
    const accepted = await Ipon.confirmAction({
      title: `${nextStatus === 'ACTIVE' ? 'Reactivate' : 'Suspend'} ${roleLabel}?`,
      message: isAdmin
        ? (nextStatus === 'ACTIVE' ? `${profile.full_name} will regain access to their assigned group.` : `${profile.full_name} will immediately lose access. Their group records will remain unchanged.`)
        : (nextStatus === 'ACTIVE' ? `${profile.full_name} will regain access to IPON.` : `${profile.full_name} will immediately lose access. Group records will remain unchanged.`),
      acceptLabel: nextStatus === 'ACTIVE' ? 'Reactivate' : 'Suspend'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true, nextStatus === 'ACTIVE' ? 'Reactivating…' : 'Suspending…');
    try {
      await Ipon.rpc('super_admin_set_administrator_status', { p_user_id: profile.id, p_status: nextStatus });
      Ipon.toast(`${ROLE_LABELS[profile.role]} ${nextStatus === 'ACTIVE' ? 'reactivated' : 'suspended'}.`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
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
    document.getElementById('user-password-copy').textContent = `Set a new password for ${target.full_name} (${target.role.toLowerCase()}).`;
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
    const button = event.submitter;
    const values = new FormData(administratorForm);
    Ipon.setBusy(button, true);
    try {
      if (values.get('user_id')) {
        await Ipon.rpc('super_admin_update_administrator', { p_user_id: values.get('user_id'), p_first_name: values.get('first_name'), p_middle_name: values.get('middle_name') || null, p_last_name: values.get('last_name'), p_group_name: values.get('group_name') || '' });
      } else {
        const passwordIssue = Ipon.passwordIssue(values.get('password'), [values.get('first_name'), values.get('middle_name'), values.get('last_name'), values.get('email')]);
        if (passwordIssue) { Ipon.setFieldError(administratorForm.elements.password, passwordIssue); administratorForm.elements.password.focus(); return; }
        const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'ADMIN', first_name: values.get('first_name'), middle_name: values.get('middle_name') || null, last_name: values.get('last_name'), email: values.get('email'), password: values.get('password'), group_name: values.get('group_name') } });
        if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      }
      administratorDialog.close(); Ipon.toast(values.get('user_id') ? 'Account updated.' : 'Administrator created.'); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  document.getElementById('approve-request-close').addEventListener('click', closeApprovalDialog);
  document.getElementById('approve-request-cancel').addEventListener('click', closeApprovalDialog);
  document.getElementById('reject-request-close')?.addEventListener('click', closeRejectDialog);
  document.getElementById('reject-request-cancel')?.addEventListener('click', closeRejectDialog);
  document.getElementById('bug-viewer-close')?.addEventListener('click', () => bugViewerDialog?.close());
  bugReportsBody?.addEventListener('click', async (event) => {
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
      const images = (Array.isArray(data?.attachments) ? data.attachments : []).filter((item) => String(item?.dataUrl || '').startsWith('data:image/'));
      container.innerHTML = images.length ? images.map((item) => `
        <figure class="bug-viewer-item">
          <img src="${item.dataUrl}" alt="${Ipon.escapeHtml(item.name || 'Attached screenshot')}">
          <figcaption><span>${Ipon.escapeHtml(item.name || 'Picture')}</span><a class="icon-action" href="${item.dataUrl}" download="${Ipon.escapeHtml(item.name || 'bug-picture')}">Download</a></figcaption>
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

  const RELEASE_INTROS = [
    (ver) => `Welcome to System ${ver}! We've packed this release with fresh features, community-requested improvements, and refined performance across IPON:`,
    (ver) => `Big news for our saving community! System ${ver} is officially live, delivering our latest upgrades, community suggestions, and smoother tracking tools:`,
    (ver) => `Introducing System ${ver}! Designed with your feedback in mind, this update rolls out powerful enhancements, modern controls, and brand new capabilities:`,
    (ver) => `System ${ver} has arrived! Explore the newest features, workflow refinements, and user-requested updates built to elevate your daily saving journey:`,
    (ver) => `We are thrilled to launch System ${ver}! Check out what's new, what's improved, and the latest community-driven additions now ready across the platform:`,
    (ver) => `Fresh off the press: System ${ver} is here! Discover the newest improvements, upgraded tools, and community-requested features in this milestone release:`,
    (ver) => `Say hello to System ${ver}! Here is a breakdown of the new capabilities, system refinements, and user requests implemented in this rollout:`,
    (ver) => `Another major step forward: System ${ver} is ready! We've listened to your feedback and brought a fresh wave of features and enhancements to IPON:`,
    (ver) => `What an exciting release! System ${ver} brings key quality-of-life updates, community feature implementations, and system-wide performance polishes:`,
    (ver) => `Here is what is new in System ${ver}! Packed with user-inspired updates, visual upgrades, and exciting new tools for your daily group tracking:`
  ];

  const RELEASE_TITLES = [
    (ver) => `System ${ver} Released`,
    (ver) => `System ${ver} is Now Live!`,
    (ver) => `What's New in System ${ver}`,
    (ver) => `Introducing System ${ver}`,
    (ver) => `System ${ver} Feature Update`,
    (ver) => `System ${ver}: Community & Performance Rollout`,
    (ver) => `Official Rollout: System ${ver}`,
    (ver) => `System ${ver} Milestone Update`
  ];

  const RELEASE_OUTROS = [
    () => `Thank you for contributing, testing, and helping us make IPON better with every update! Enjoy saving together.`,
    () => `We're grateful for your continued support and feedback. Enjoy the new update and happy saving!`,
    () => `Your ideas drive IPON forward! Keep submitting your suggestions, and let us know what you think of this release.`,
    () => `Special thanks to our active community for shaping these improvements. More exciting updates are on the way!`,
    () => `As always, thank you for being an essential part of the IPON journey. Enjoy the upgraded experience!`,
    () => `Built with care for our savers. Thank you for your suggestions, and stay tuned for what's coming next!`,
    () => `We couldn't do this without your feedback and support. Here's to smarter, simpler savings together!`,
    () => `Huge thanks to everyone who shared ideas and reported issues. Together, we keep improving IPON every day!`
  ];

  const FEATURE_VARIATIONS = {
    presence: [
      'Live Active Now Presence: See who is currently active across your savings group in real time with Facebook-style green indicators on profile avatars.',
      'Real-Time Savers Pulse: Instantly spot online group members with subtle active-now presence dots on user avatars.',
      'Active Member Indicators: Stay connected with your savings group through real-time online status indicators on profile pictures.'
    ],
    avatar: [
      'Interactive Avatar Studio: Crop, rotate 90 degrees, and preview display pictures with an intuitive touch-friendly cropper.',
      'Custom Profile Picture Suite: Built-in crop and rotation tools allow savers to frame their avatar before saving.',
      'Profile Picture Editor: Fine-tune your display picture with interactive circular framing, instant rotation, and deletion confirmation.'
    ],
    reactions: [
      'Messenger-Style Reactions: Express yourself on group announcements with Heart, Thumbs up, Haha, Sad, and Angry reactions, complete with a who-reacted modal list.',
      'Interactive Post Reactions: Tap to react with expressive emojis and click the reaction pill counter to see who celebrated across your group.',
      'Announcement Emoji Picker: Engage with admin announcements using animated reaction icons and transparent member reaction breakdown lists.'
    ],
    quickRecord: [
      'Quick Record Entry Modal: Convenient calendar dashboard shortcut to record contributions, deductions, and expenses without switching pages.',
      'One-Click Transaction Logger: Rapidly log new deposits, withdrawals, and shared expenses right from the monthly calendar view.',
      'Instant Financial Entry: Record group transactions on the fly using the new calendar quick-entry dialog.'
    ],
    spotlight: [
      'Member Financial Spotlight: Filter records by saver to highlight individual contribution graphs, monthly activity, and pledge totals.',
      'Personal Savings Analytics: Examine individual member savings momentum and monthly deposit trends on dedicated spotlight cards.',
      'Dynamic Record Spotlight & Charts: Isolate individual member contributions with interactive activity graphs and transparent totals.'
    ],
    pledge: [
      'Admin Contribution Pledge Setup: Group administrators can configure and update their monthly savings pledge directly, synced into member rosters and reports.',
      'Synchronized Group Pledges: Configure administrator monthly contribution targets that automatically reflect across audit reports.',
      'Pledge Tracking Integration: Maintain transparent savings expectations with automated group-wide monthly pledge synchronization.'
    ]
  };

  let currentReleaseIntroIdx = -1;
  let currentReleaseOutroIdx = -1;
  let currentReleaseTitleIdx = -1;

  function pickDifferentIndex(len, prev) {
    if (len <= 1) return 0;
    let next;
    do {
      next = Math.floor(Math.random() * len);
    } while (next === prev);
    return next;
  }

  function composeReleaseNotes(ver, targetImpl = []) {
    currentReleaseIntroIdx = pickDifferentIndex(RELEASE_INTROS.length, currentReleaseIntroIdx);
    currentReleaseOutroIdx = pickDifferentIndex(RELEASE_OUTROS.length, currentReleaseOutroIdx);
    currentReleaseTitleIdx = pickDifferentIndex(RELEASE_TITLES.length, currentReleaseTitleIdx);

    const title = RELEASE_TITLES[currentReleaseTitleIdx](ver);
    const intro = RELEASE_INTROS[currentReleaseIntroIdx](ver);
    const outro = RELEASE_OUTROS[currentReleaseOutroIdx]();

    // Pick a random variation for each core feature and shuffle the list:
    const pickedFeatures = Object.values(FEATURE_VARIATIONS).map((pool) => {
      return pool[Math.floor(Math.random() * pool.length)];
    });
    // Shuffle features for distinct presentation
    for (let i = pickedFeatures.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pickedFeatures[i], pickedFeatures[j]] = [pickedFeatures[j], pickedFeatures[i]];
    }

    let body = `${intro}\n\n`;
    pickedFeatures.forEach((feat) => {
      body += `• ${feat}\n`;
    });

    if (targetImpl.length > 0) {
      const profileById = new Map(profiles.map((p) => [p.id, p]));
      const sectionHeaders = [
        '\nCommunity Feature Requests Implemented in this Release:',
        '\nFeatures Requested by Savers & Shipped in this Update:',
        '\nCommunity Spotlight (Features You Asked For):'
      ];
      body += `${sectionHeaders[Math.floor(Math.random() * sectionHeaders.length)]}\n`;
      targetImpl.forEach((req) => {
        const prof = profileById.get(req.requester_id);
        const credit = req.allow_credit !== false && prof?.full_name ? ` (Requested by: ${prof.full_name})` : '';
        body += `• ${req.title}: ${req.details || 'Feature improvement'}${credit}\n`;
      });
    }

    body += `\n${outro}`;
    return { title, body };
  }

  async function openReleaseUpdateDialog() {
    if (!releaseUpdateDialog || !releaseUpdateForm) return;

    let existingVersions = new Set();
    try {
      const { data } = await Ipon.client.from('announcements')
        .select('release_version')
        .not('release_version', 'is', null)
        .is('deleted_at', null);
      (data || []).forEach((row) => {
        if (row.release_version) existingVersions.add(row.release_version.trim().toLowerCase());
      });
    } catch (_) {}

    let nextVersion = 'Update 1.0';
    let major = 1;
    let minor = 0;
    if (existingVersions.size > 0) {
      existingVersions.forEach((ver) => {
        const match = ver.match(/(\d+)(?:\.(\d+))?/);
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

    // Collect ONLY implemented feature requests that have not yet been released.
    // Once released in an update, they will never appear in subsequent update drafts.
    const targetImplemented = featureRequests.filter(
      (req) => req.status === 'IMPLEMENTED' && !req.release_version
    );

    const todayIso = new Date().toISOString().slice(0, 10);
    const versionInput = document.getElementById('release-update-version');
    const dateInput = document.getElementById('release-update-date');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');

    const { title, body } = composeReleaseNotes(nextVersion, targetImplemented);

    if (versionInput) versionInput.value = nextVersion;
    if (dateInput) dateInput.value = todayIso;
    if (titleInput) titleInput.value = title;
    if (detailsInput) detailsInput.value = body;
    releaseUpdateDialog.showModal();
    if (versionInput) versionInput.focus();
  }

  document.getElementById('release-update-shuffle')?.addEventListener('click', () => {
    const versionInput = document.getElementById('release-update-version');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');
    const ver = (versionInput?.value || 'Update 1.0').trim();
    const targetImplemented = featureRequests.filter(
      (req) => req.status === 'IMPLEMENTED' && !req.release_version
    );
    const { title, body } = composeReleaseNotes(ver, targetImplemented);
    if (titleInput) titleInput.value = title;
    if (detailsInput) detailsInput.value = body;
    Ipon.toast('Shuffled release intro and outro greeting.');
  });

  const releaseAiBtn = document.getElementById('release-update-ai-btn');
  const releaseAiStatus = document.getElementById('release-update-ai-status');
  const releaseAiStatusText = document.getElementById('release-update-ai-status-text');
  const geminiKeyDialog = document.getElementById('gemini-key-dialog');
  const geminiKeyForm = document.getElementById('gemini-key-form');
  const geminiKeyInput = document.getElementById('gemini-api-key-input');
  const geminiKeyStatus = document.getElementById('gemini-key-status');
  const geminiKeyClose = document.getElementById('gemini-key-close');
  const geminiKeyClear = document.getElementById('gemini-key-clear');
  const geminiKeyTest = document.getElementById('gemini-key-test');
  const releaseKeyBtn = document.getElementById('release-update-key-btn');
  const geminiModelSelect = document.getElementById('gemini-model-select');

  function getStoredGeminiKey() {
    return (localStorage.getItem('ipon_gemini_api_key') || '').trim() || (window.IPON_CONFIG?.geminiApiKey || '').trim();
  }

  function getStoredGeminiModel() {
    return (localStorage.getItem('ipon_gemini_model') || '').trim() || 'gemini-1.5-flash';
  }

  function updateGeminiStatusBadge() {
    if (!geminiKeyStatus) return;
    const key = getStoredGeminiKey();
    if (key) {
      const masked = key.slice(0, 6) + '••••••••' + key.slice(-4);
      geminiKeyStatus.textContent = `Key ready (${masked}) · Auto model`;
      geminiKeyStatus.className = 'gemini-status-badge is-connected';
    } else {
      geminiKeyStatus.textContent = 'No API key set (Enter API key above)';
      geminiKeyStatus.className = 'gemini-status-badge';
    }
  }

  releaseKeyBtn?.addEventListener('click', () => {
    if (!geminiKeyDialog) return;
    if (geminiKeyInput) geminiKeyInput.value = (localStorage.getItem('ipon_gemini_api_key') || window.IPON_CONFIG?.geminiApiKey || '').trim();
    updateGeminiStatusBadge();
    geminiKeyDialog.showModal();
    if (geminiKeyInput) geminiKeyInput.focus();
  });

  geminiKeyClose?.addEventListener('click', () => geminiKeyDialog?.close());

  geminiKeyForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const val = (geminiKeyInput?.value || '').trim();
    if (val) {
      localStorage.setItem('ipon_gemini_api_key', val);
      Ipon.toast('Gemini API key saved in browser.');
    } else {
      localStorage.removeItem('ipon_gemini_api_key');
      Ipon.toast('Gemini API key cleared from browser.');
    }
    updateGeminiStatusBadge();
    geminiKeyDialog?.close();
  });

  geminiKeyClear?.addEventListener('click', () => {
    localStorage.removeItem('ipon_gemini_api_key');
    if (geminiKeyInput) geminiKeyInput.value = '';
    updateGeminiStatusBadge();
    Ipon.toast('Gemini API key removed from browser.');
  });

  geminiKeyTest?.addEventListener('click', async () => {
    const key = (geminiKeyInput?.value || '').trim() || getStoredGeminiKey();
    if (!key) {
      Ipon.toast('Please enter a Gemini API key first.', 'error');
      geminiKeyInput?.focus();
      return;
    }
    try {
      Ipon.setBusy(geminiKeyTest, true);
      const res = await Ipon.callGemini({
        apiKey: key,
        prompt: 'Return a JSON object: {"status": "ok", "message": "Connection verified successfully"}',
        systemInstruction: 'Respond in JSON only.'
      });
      Ipon.toast(`Connected successfully to Google Gemini (${res.model})!`);
      if (geminiKeyStatus) {
        geminiKeyStatus.textContent = `Connected & Active (${res.model})`;
        geminiKeyStatus.className = 'gemini-status-badge is-verified';
      }
    } catch (err) {
      Ipon.toast(`Gemini error: ${err.message || 'Verification failed'}`, 'error');
    } finally {
      Ipon.setBusy(geminiKeyTest, false);
    }
  });

  releaseAiBtn?.addEventListener('click', async () => {
    const versionInput = document.getElementById('release-update-version');
    const dateInput = document.getElementById('release-update-date');
    const titleInput = document.getElementById('release-update-heading');
    const detailsInput = document.getElementById('release-update-details');
    const ver = (versionInput?.value || 'Update 1.0').trim();
    const relDate = (dateInput?.value || new Date().toISOString().slice(0, 10)).trim();

    const targetImplemented = featureRequests.filter(
      (req) => req.status === 'IMPLEMENTED' && !req.release_version
    );
    const profileById = new Map(profiles.map((p) => [p.id, p]));
    const featuresList = targetImplemented.map((req) => {
      const prof = profileById.get(req.requester_id);
      const credit = req.allow_credit !== false && prof?.full_name ? ` (Requested by: ${prof.full_name})` : '';
      return `- "${req.title}": ${req.details || 'Feature improvement'}${credit}`;
    }).join('\n') || '- General performance improvements, responsive layout refinements, and stability enhancements.';

    const apiKey = Ipon.getGeminiApiKey ? Ipon.getGeminiApiKey() : '';
    if (!apiKey) {
      Ipon.toast('Please add your Gemini API key in js/config.js (geminiApiKey).', 'error');
      return;
    }

    const prompt = `You are the product communications writer for IPON (Group Savings and Financial Tracker) ${ver}.
Release Date: ${relDate}

Implemented community-requested features:
${featuresList}

Key system updates included in this rollout:
- Live Active Now presence indicators on member profile avatars
- Interactive profile picture cropper, 90-degree rotation, and avatar controls
- Messenger-style announcement reactions (Heart, Thumbs up, Haha, Sad, Angry) with who-reacted modal
- Quick financial record entry shortcut modal on the calendar dashboard
- Financial records member spotlight card with personal contribution graph and totals
- Group administrator monthly pledge synchronization across member rosters and reports

Generate a JSON object with this exact structure:
{
  "title": "A punchy, attractive announcement title mentioning ${ver}",
  "intro": "A 1-2 paragraph engaging, fresh intro celebrating this milestone and thanking savers",
  "highlights": [
    "A concise, punchy bullet point describing a key feature or community request with user credits if applicable",
    "Another concise bullet point describing an update",
    "Additional bullet points covering the remaining improvements"
  ],
  "outro": "A warm, inspiring 1-paragraph closing message encouraging saving consistency"
}`;

    try {
      Ipon.setBusy(releaseAiBtn, true);
      if (releaseAiStatus) {
        releaseAiStatus.hidden = false;
        if (releaseAiStatusText) releaseAiStatusText.textContent = 'Google Gemini AI is writing your announcement…';
      }

      // Action: ai-generate-release-notes (Direct client fetch to Gemini API with fallback)
      const res = await Ipon.callGemini({
        prompt,
        systemInstruction: 'You are an expert product communicator. Write authentic, polished, encouraging release copy in English. Output strictly valid JSON.',
        jsonResponse: true
      });

      const parsed = res.parsed;
      if (!parsed || (!parsed.title && !parsed.intro)) {
        throw new Error('Gemini did not return valid release content.');
      }

      const title = String(parsed.title || `System ${ver} Released`).trim();
      const intro = String(parsed.intro || '').trim();
      const outro = String(parsed.outro || '').trim();
      const highlights = Array.isArray(parsed.highlights)
        ? parsed.highlights.map((h) => `• ${String(h).replace(/^[•\s*-]+/, '').trim()}`).join('\n')
        : '';

      const details = [intro, highlights, outro].filter(Boolean).join('\n\n');

      if (titleInput && title) titleInput.value = title;
      if (detailsInput && details) detailsInput.value = details;

      Ipon.toast(`✨ Real announcement generated by Google Gemini AI (${res.model})!`);
    } catch (err) {
      // Real AI only - report genuine Gemini status, no silent fake substitution
      Ipon.toast(`Gemini AI: ${err.message || 'Generation failed'}.`, 'error');
    } finally {
      Ipon.setBusy(releaseAiBtn, false);
      if (releaseAiStatus) releaseAiStatus.hidden = true;
    }
  });

  releaseUpdateBtn?.addEventListener('click', openReleaseUpdateDialog);
  document.getElementById('release-update-close')?.addEventListener('click', () => releaseUpdateDialog?.close());
  document.getElementById('release-update-cancel')?.addEventListener('click', () => releaseUpdateDialog?.close());
  releaseUpdateDialog?.addEventListener('close', () => releaseUpdateForm?.reset());

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
      message: `Publish "${title}" as a system release announcement to all users?`,
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
      // Mark all currently unreleased implemented requests locally with this version
      featureRequests.forEach((req) => {
        if (req.status === 'IMPLEMENTED' && !req.release_version) {
          req.release_version = version;
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
    ['requests', ['requests-search', 'requests-status-filter'], renderRequests],
    ['feature-requests', ['feature-requests-search'], renderFeatureRequests],
    ['bug-reports', ['bug-reports-search'], renderBugReports],
    ['users', ['users-search', 'users-role-filter', 'users-status-filter'], renderUsers],
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
      Ipon.showInlineError(requestsBody, error, refresh, 5);
      Ipon.showInlineError(featureRequestsBody, error, refresh, 5);
      if (bugReportsBody) Ipon.showInlineError(bugReportsBody, error, refresh, 6);
      Ipon.showInlineError(administratorsBody, error, refresh, 7);
      Ipon.showInlineError(activityBody, error, refresh, 3);
    }
  }

  try { await refresh(); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges('super-admin', ['profiles', 'groups', 'admin_requests', 'feature_requests', 'bug_reports', 'account_activity', 'audit_logs', 'announcements', 'announcement_reactions'], refresh);
})();
