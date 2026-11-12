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
  const administratorDialog = document.getElementById('administrator-dialog');
  const administratorForm = document.getElementById('administrator-form');
  const userPasswordDialog = document.getElementById('user-password-dialog');
  const userPasswordForm = document.getElementById('user-password-form');
  const bugViewerDialog = document.getElementById('bug-viewer-dialog');
  const overviewError = document.getElementById('overview-error');
  let profiles = [];
  let groups = [];
  let requests = [];
  let featureRequests = [];
  let bugReports = [];
  let accountActivities = [];
  let activityLogs = [];
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
    requestsBody.innerHTML = visible.length ? visible.map((request) => { const profile = profileById.get(request.requester_id); const pending = request.status === 'PENDING'; return `<tr>
      <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong><small class="field-help platform-id">${Ipon.escapeHtml(profile.id)}</small></td>
      <td>${Ipon.escapeHtml(request.contact_number || 'Not provided')}<small class="field-help">${Ipon.escapeHtml(request.email)}</small></td>
      <td>${Ipon.escapeHtml(request.reason)}</td>
      <td>${Ipon.dateLabel(request.created_at)}</td><td>${statusLabel(request.status)}</td>
      <td><div class="table-actions">${pending ? `<button class="icon-action" type="button" data-approve-request="${profile.id}">Approve</button><button class="icon-action danger-action" type="button" data-reject-request="${profile.id}">Reject</button>` : request.status === 'REJECTED' ? `<button class="icon-action" type="button" data-reopen-request="${profile.id}">Reopen</button>` : ''}</div></td>
    </tr>`; }).join('') : `<tr><td colspan="6" class="empty-state">${query || status ? 'No matching administrator requests.' : 'No administrator requests.'}</td></tr>`;
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
        <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong>${profile.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}</td>
        <td><span class="role-badge role-${profile.role.toLowerCase()}">${Ipon.escapeHtml(ROLE_LABELS[profile.role])}</span></td>
        <td>${group ? Ipon.escapeHtml(group.name) : '<span class="field-help">Unassigned</span>'}</td>
        <td>${Ipon.dateLabel(profile.created_at)}</td>
        <td>${lastActivity.has(profile.id) ? `<span class="activity-kind">${Ipon.escapeHtml(lastActivity.get(profile.id).event.replaceAll('_', ' '))}</span><small class="field-help">${Ipon.dateLabel(lastActivity.get(profile.id).created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>` : '<span class="field-help">No activity</span>'}</td>
        <td>${statusLabel(profile.status)}</td>
        <td><div class="table-actions">${actions}</div></td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">${query || role || status ? 'No matching user accounts.' : 'No user accounts.'}</td></tr>`;
  }

  function renderFeatureRequests() {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const query = filterValue('feature-requests-search');
    const filtered = featureRequests.filter((request) => {
      const profile = profileById.get(request.requester_id);
      return matchesQuery(query, [profile?.full_name, profile?.email, profile?.role, request.title, request.details]);
    });
    const visible = paginateRows('feature-requests', filtered);
    featureRequestsBody.innerHTML = visible.length ? visible.map((request) => {
      const profile = profileById.get(request.requester_id);
      return `<tr>
        <td><strong>${Ipon.escapeHtml(profile?.full_name || 'Former user')}</strong>${profile?.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}</td>
        <td>${Ipon.escapeHtml(profile?.role?.replaceAll('_', ' ') || 'Unavailable')}</td>
        <td><strong>${Ipon.escapeHtml(request.title)}</strong></td>
        <td><span class="feature-request-details">${Ipon.escapeHtml(request.details)}</span></td>
        <td>${Ipon.dateLabel(request.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="5" class="empty-state">${query ? 'No matching feature requests.' : 'No feature requests yet.'}</td></tr>`;
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
      const count = Number(report.image_count || 0);
      return `<tr>
        <td><strong>${Ipon.escapeHtml(profile?.full_name || 'Former user')}</strong>${profile?.email ? `<small class="field-help">${Ipon.escapeHtml(profile.email)}</small>` : ''}</td>
        <td>${Ipon.escapeHtml(profile?.role?.replaceAll('_', ' ') || 'Unavailable')}</td>
        <td><strong>${Ipon.escapeHtml(report.title)}</strong></td>
        <td><span class="feature-request-details">${Ipon.escapeHtml(report.description)}</span></td>
        <td>${count ? `<button class="icon-action" type="button" data-view-bug="${report.id}">View ${count} picture${count === 1 ? '' : 's'}</button>` : '<span class="field-help">None</span>'}</td>
        <td>${Ipon.dateLabel(report.created_at, { dateStyle: 'medium', timeStyle: 'short' })}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-state">${query ? 'No matching bug reports.' : 'No bug reports yet.'}</td></tr>`;
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
      Ipon.client.from('profiles').select('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('groups').select('id,name,owner_id,status,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('admin_requests').select('id,requester_id,email,contact_number,reason,status,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('feature_requests').select('id,requester_id,title,details,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('bug_reports').select('id,reporter_id,title,description,image_count,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('account_activity').select('user_id,event,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('audit_logs').select('id,table_name,record_id,action,changed_at').in('table_name', ['profiles', 'groups']).order('changed_at', { ascending: false }).limit(200)
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

  requestsBody.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-approve-request]');
    const reject = event.target.closest('[data-reject-request]');
    const reopen = event.target.closest('[data-reopen-request]');
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
    const accepted = await Ipon.confirmAction({ title: 'Reject administrator request?', message: `${profile.full_name} will not receive administrator access.`, acceptLabel: 'Reject request' });
    if (!accepted) return;
    Ipon.setBusy(reject, true, 'Rejecting…');
    try {
      await Ipon.rpc('super_admin_reject_request', { p_user_id: profile.id, p_review_note: null });
      Ipon.toast('Administrator request rejected.');
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(reject, false);
    }
  });

  approvalForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = approvalForm.querySelector('[type="submit"]');
    Ipon.setBusy(button, true, 'Approving…');
    try {
      await Ipon.rpc('super_admin_approve_request', { p_user_id: approvalId.value, p_group_name: groupName.value.trim() });
      closeApprovalDialog();
      Ipon.toast('Administrator approved and group created.');
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
  Ipon.subscribeToChanges('super-admin', ['profiles', 'groups', 'admin_requests', 'feature_requests', 'bug_reports', 'account_activity', 'audit_logs'], refresh);
})();
