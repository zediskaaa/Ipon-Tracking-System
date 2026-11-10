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
  let profiles = [];
  let groups = [];

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
    const requests = profiles.filter((profile) => profile.role === 'MEMBER' && profile.status === 'PENDING' && !profile.group_id);
    requestsBody.innerHTML = requests.length ? requests.map((profile) => `<tr>
      <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong><small class="field-help platform-id">${Ipon.escapeHtml(profile.id)}</small></td>
      <td>${Ipon.dateLabel(profile.created_at)}</td>
      <td><div class="table-actions"><button class="icon-action" type="button" data-approve-request="${profile.id}">Approve</button><button class="icon-action danger-action" type="button" data-reject-request="${profile.id}">Reject</button></div></td>
    </tr>`).join('') : '<tr><td colspan="3" class="empty-state">No pending administrator requests.</td></tr>';
  }

  function renderAdministrators() {
    const groupByOwner = new Map(groups.map((group) => [group.owner_id, group]));
    const admins = profiles.filter((profile) => profile.role === 'ADMIN');
    administratorsBody.innerHTML = admins.length ? admins.map((profile) => {
      const group = groupByOwner.get(profile.id);
      const active = profile.status === 'ACTIVE';
      return `<tr>
        <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong></td>
        <td>${group ? Ipon.escapeHtml(group.name) : '<span class="field-help">Not assigned</span>'}</td>
        <td>${Ipon.dateLabel(profile.created_at)}</td>
        <td>${statusLabel(profile.status)}</td>
        <td><button class="icon-action ${active ? 'danger-action' : ''}" type="button" data-admin-status="${profile.id}" data-next-status="${active ? 'DISABLED' : 'ACTIVE'}">${active ? 'Suspend' : 'Reactivate'}</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-state">No administrator accounts.</td></tr>';
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
    const [profileResult, groupResult, logResult] = await Promise.all([
      Ipon.client.from('profiles').select('id,full_name,role,status,group_id,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('groups').select('id,name,owner_id,status,created_at').order('created_at', { ascending: false }),
      Ipon.client.from('audit_logs').select('id,table_name,record_id,action,changed_at').in('table_name', ['profiles', 'groups']).order('changed_at', { ascending: false }).limit(12)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (groupResult.error) throw groupResult.error;
    if (logResult.error) throw logResult.error;
    profiles = profileResult.data || [];
    groups = groupResult.data || [];
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
      await Ipon.rpc('super_admin_reject_request', { p_user_id: profile.id });
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
    const button = event.target.closest('[data-admin-status]');
    if (!button) return;
    const profile = profiles.find((item) => item.id === button.dataset.adminStatus);
    if (!profile) return;
    const nextStatus = button.dataset.nextStatus;
    const accepted = await Ipon.confirmAction({
      title: `${nextStatus === 'ACTIVE' ? 'Reactivate' : 'Suspend'} administrator?`,
      message: nextStatus === 'ACTIVE' ? `${profile.full_name} will regain access to their assigned group.` : `${profile.full_name} will immediately lose access. Their group records will remain unchanged.`,
      acceptLabel: nextStatus === 'ACTIVE' ? 'Reactivate' : 'Suspend'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true, nextStatus === 'ACTIVE' ? 'Reactivating…' : 'Suspending…');
    try {
      await Ipon.rpc('admin_set_user_access', { p_user_id: profile.id, p_role: 'ADMIN', p_status: nextStatus, p_member_id: null });
      Ipon.toast(`Administrator ${nextStatus === 'ACTIVE' ? 'reactivated' : 'suspended'}.`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  document.getElementById('approve-request-close').addEventListener('click', closeApprovalDialog);
  document.getElementById('approve-request-cancel').addEventListener('click', closeApprovalDialog);

  try {
    await load();
  } catch (error) {
    Ipon.showInlineError(requestsBody, error, load, 3);
    Ipon.showInlineError(administratorsBody, error, load, 5);
    Ipon.showInlineError(activityBody, error, load, 3);
  }
})();
