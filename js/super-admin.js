(async function () {
  'use strict';

  const state = await Ipon.init({ allowedRoles: ['SUPER_ADMIN'] });
  if (state.failed || !state.configured || !state.profile) return;

  const requestsBody = document.getElementById('requests-body');
  const administratorsBody = document.getElementById('administrators-body');
  const activityBody = document.getElementById('activity-body');
  const approvalDialog = document.getElementById('approve-request-dialog');
  const approvalForm = document.getElementById('approve-request-form');
  const approvalId = document.getElementById('approve-request-id');
  const groupName = document.getElementById('approve-group-name');
  const approvalCopy = document.getElementById('approve-request-copy');
  const administratorDialog = document.getElementById('administrator-dialog');
  const administratorForm = document.getElementById('administrator-form');
  let profiles = [];
  let groups = [];
  let requests = [];
  let accountActivities = [];
  const views = {
    overview: ['Platform overview', 'Monitor administrator access, savings groups, and requests without exposing financial records.'],
    requests: ['Administrator requests', 'Review pending applications and create an isolated savings group when access is approved.'],
    administrators: ['Administrators', 'Create accounts and manage each administrator\'s platform access and assigned savings group.'],
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
  }

  function renderRequests() {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    requestsBody.innerHTML = requests.length ? requests.map((request) => { const profile = profileById.get(request.requester_id); return `<tr>
      <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong><small class="field-help platform-id">${Ipon.escapeHtml(profile.id)}</small></td>
      <td>${Ipon.escapeHtml(request.contact_number || 'Not provided')}<small class="field-help">${Ipon.escapeHtml(request.email)}</small></td>
      <td>${Ipon.escapeHtml(request.reason)}</td>
      <td>${Ipon.dateLabel(request.created_at)}</td>
      <td><div class="table-actions"><button class="icon-action" type="button" data-approve-request="${profile.id}">Approve</button><button class="icon-action danger-action" type="button" data-reject-request="${profile.id}">Reject</button></div></td>
    </tr>`; }).join('') : '<tr><td colspan="5" class="empty-state">No pending administrator requests.</td></tr>';
  }

  function renderAdministrators() {
    const groupByOwner = new Map(groups.map((group) => [group.owner_id, group]));
    const lastActivity = new Map();
    accountActivities.forEach((activity) => { if (!lastActivity.has(activity.user_id)) lastActivity.set(activity.user_id, activity); });
    const admins = profiles.filter((profile) => profile.role === 'ADMIN');
    administratorsBody.innerHTML = admins.length ? admins.map((profile) => {
      const group = groupByOwner.get(profile.id);
      const active = profile.status === 'ACTIVE';
      return `<tr>
        <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong></td>
        <td>${group ? Ipon.escapeHtml(group.name) : '<span class="field-help">Not assigned</span>'}</td>
        <td>${Ipon.dateLabel(profile.created_at)}</td>
        <td>${lastActivity.has(profile.id) ? `<span class="activity-kind">${Ipon.escapeHtml(lastActivity.get(profile.id).event.replaceAll('_', ' '))}</span><small class="field-help">${Ipon.dateLabel(lastActivity.get(profile.id).created_at, { dateStyle: 'medium', timeStyle: 'short' })}</small>` : '<span class="field-help">No activity recorded</span>'}</td>
        <td>${statusLabel(profile.status)}</td>
        <td><div class="table-actions"><button class="icon-action" type="button" data-edit-admin="${profile.id}">Edit</button><button class="icon-action" type="button" data-reset-admin="${profile.id}">Reset password</button><button class="icon-action ${active ? 'danger-action' : ''}" type="button" data-admin-status="${profile.id}" data-next-status="${active ? 'DISABLED' : 'ACTIVE'}">${active ? 'Suspend' : 'Reactivate'}</button><button class="icon-action danger-action" type="button" data-archive-admin="${profile.id}">Archive</button></div></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" class="empty-state">No administrator accounts.</td></tr>';
  }

  function renderActivity(logs) {
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const groupById = new Map(groups.map((group) => [group.id, group]));
    activityBody.innerHTML = logs.length ? logs.map((log) => {
      const target = log.table_name === 'groups' ? groupById.get(log.record_id)?.name : profileById.get(log.record_id)?.full_name;
      const event = `${log.action.charAt(0)}${log.action.slice(1).toLowerCase()} ${log.table_name === 'groups' ? 'group' : 'account'}`;
      return `<tr><td><strong>${Ipon.escapeHtml(event)}</strong></td><td>${Ipon.escapeHtml(target || 'Platform record')}</td><td>${Ipon.dateLabel(log.changed_at, { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>`;
    }).join('') : '<tr><td colspan="3" class="empty-state">No platform activity recorded yet.</td></tr>';
  }

  async function load() {
    const [profileResult, groupResult, requestResult, activityResult, logResult] = await Promise.all([
      Ipon.client.from('profiles').select('id,full_name,first_name,middle_name,last_name,email,role,status,group_id,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('groups').select('id,name,owner_id,status,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('admin_requests').select('id,requester_id,email,contact_number,reason,status,created_at').eq('status', 'PENDING').order('created_at', { ascending: false }),
      Ipon.client.from('account_activity').select('user_id,event,created_at').order('created_at', { ascending: false }).limit(200),
      Ipon.client.from('audit_logs').select('id,table_name,record_id,action,changed_at').in('table_name', ['profiles', 'groups']).order('changed_at', { ascending: false }).limit(12)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (groupResult.error) throw groupResult.error;
    if (requestResult.error) throw requestResult.error;
    if (activityResult.error) throw activityResult.error;
    if (logResult.error) throw logResult.error;
    profiles = profileResult.data || [];
    groups = groupResult.data || [];
    requests = requestResult.data || [];
    accountActivities = activityResult.data || [];
    renderOverview();
    renderRequests();
    renderAdministrators();
    renderActivity(logResult.data || []);
  }

  function closeApprovalDialog() {
    approvalDialog.close();
    approvalForm.reset();
  }

  requestsBody.addEventListener('click', async (event) => {
    const approve = event.target.closest('[data-approve-request]');
    const reject = event.target.closest('[data-reject-request]');
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
      administratorForm.elements.group_name.value = group?.name || '';
      document.getElementById('administrator-dialog-title').textContent = 'Edit administrator';
      administratorForm.querySelector('[type="submit"]').textContent = 'Save administrator';
      administratorDialog.showModal();
      return;
    }
    if (reset) {
      if (!profile.email) return Ipon.toast('This administrator has no saved email address.', 'error');
      const { error } = await Ipon.client.auth.resetPasswordForEmail(profile.email, { redirectTo: new URL('account.html', location.href).href });
      if (error) Ipon.toast(Ipon.friendlyError(error), 'error'); else Ipon.toast('Password recovery email sent.');
      return;
    }
    if (archive) {
      const accepted = await Ipon.confirmAction({ title: 'Archive administrator?', message: `${profile.full_name} will lose access and the group will be suspended. Records will be preserved.`, acceptLabel: 'Archive' });
      if (!accepted) return;
      try { await Ipon.rpc('super_admin_archive_administrator', { p_user_id: profile.id }); Ipon.toast('Administrator archived.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
      return;
    }
    const nextStatus = button.dataset.nextStatus;
    const accepted = await Ipon.confirmAction({
      title: `${nextStatus === 'ACTIVE' ? 'Reactivate' : 'Suspend'} administrator?`,
      message: nextStatus === 'ACTIVE' ? `${profile.full_name} will regain access to their assigned group.` : `${profile.full_name} will immediately lose access. Their group records will remain unchanged.`,
      acceptLabel: nextStatus === 'ACTIVE' ? 'Reactivate' : 'Suspend'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true, nextStatus === 'ACTIVE' ? 'Reactivating…' : 'Suspending…');
    try {
      await Ipon.rpc('super_admin_set_administrator_status', { p_user_id: profile.id, p_status: nextStatus });
      Ipon.toast(`Administrator ${nextStatus === 'ACTIVE' ? 'reactivated' : 'suspended'}.`);
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
    document.getElementById('administrator-dialog-title').textContent = 'Create administrator';
    administratorForm.querySelector('[type="submit"]').textContent = 'Create administrator';
  }

  document.getElementById('create-administrator').addEventListener('click', () => { resetAdministratorForm(); administratorDialog.showModal(); administratorForm.elements.first_name.focus(); });
  document.getElementById('administrator-dialog-close').addEventListener('click', () => administratorDialog.close());
  document.getElementById('administrator-dialog-cancel').addEventListener('click', () => administratorDialog.close());
  administratorDialog.addEventListener('close', resetAdministratorForm);
  administratorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    const values = new FormData(administratorForm);
    Ipon.setBusy(button, true);
    try {
      if (values.get('user_id')) {
        await Ipon.rpc('super_admin_update_administrator', { p_user_id: values.get('user_id'), p_first_name: values.get('first_name'), p_middle_name: values.get('middle_name') || null, p_last_name: values.get('last_name'), p_group_name: values.get('group_name') });
      } else {
        const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'ADMIN', first_name: values.get('first_name'), middle_name: values.get('middle_name') || null, last_name: values.get('last_name'), email: values.get('email'), password: values.get('password'), group_name: values.get('group_name') } });
        if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      }
      administratorDialog.close(); Ipon.toast(values.get('user_id') ? 'Administrator updated.' : 'Administrator created.'); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  document.getElementById('approve-request-close').addEventListener('click', closeApprovalDialog);
  document.getElementById('approve-request-cancel').addEventListener('click', closeApprovalDialog);
  window.addEventListener('hashchange', () => showView(true));
  showView();

  try {
    await load();
  } catch (error) {
    Ipon.showInlineError(requestsBody, error, load, 5);
    Ipon.showInlineError(administratorsBody, error, load, 6);
    Ipon.showInlineError(activityBody, error, load, 3);
  }
})();
