(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed) return;
  const accessBody = document.getElementById('access-body');
  const effectiveMonth = document.getElementById('effective-month');
  const defaultAmount = document.getElementById('default-amount');
  let members = [];

  effectiveMonth.value = Ipon.isoDate().slice(0, 7);
  if (!state.configured || !state.profile) {
    if (accessBody) accessBody.innerHTML = '<tr><td colspan="4" class="empty-state">Connect Supabase to manage access.</td></tr>';
    return;
  }

  document.getElementById('my-name').textContent = state.profile.full_name;
  document.getElementById('my-role').textContent = state.profile.role;
  document.getElementById('my-status').textContent = state.profile.status;
  if (state.profile.role !== 'ADMIN') return;

  async function loadContributionDefault() {
    const month = effectiveMonth.value;
    const { data, error } = await Ipon.client.from('contribution_settings').select('default_amount').eq('effective_month', `${month}-01`).maybeSingle();
    if (error) throw error;
    if (effectiveMonth.value === month) defaultAmount.value = data?.default_amount ?? '';
  }

  async function loadAccess() {
    const [profileResult, memberResult] = await Promise.all([
      Ipon.client.from('profiles').select('id,full_name,status,member_id,created_at').eq('role', 'MEMBER').order('created_at'),
      Ipon.client.from('members').select('id,full_name').eq('status', 'ACTIVE').order('full_name')
    ]);
    if (profileResult.error) throw profileResult.error;
    if (memberResult.error) throw memberResult.error;
    members = memberResult.data || [];
    const profiles = profileResult.data || [];

    accessBody.innerHTML = profiles.length ? profiles.map((profile) => `<tr>
      <td><strong>${Ipon.escapeHtml(profile.full_name)}</strong></td>
      <td><select data-field="status" data-id="${profile.id}"><option value="PENDING" ${profile.status === 'PENDING' ? 'selected' : ''}>PENDING</option><option value="ACTIVE" ${profile.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option><option value="DISABLED" ${profile.status === 'DISABLED' ? 'selected' : ''}>DISABLED</option></select></td>
      <td><select data-field="member" data-id="${profile.id}"><option value="">Not linked</option>${members.map((member) => `<option value="${member.id}" ${profile.member_id === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}</select></td>
      <td><button class="icon-action" type="button" data-save-access="${profile.id}">Save</button></td>
    </tr>`).join('') : '<tr><td colspan="4" class="empty-state">No member login accounts in this group.</td></tr>';
  }

  accessBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-save-access]');
    if (!button) return;
    const id = button.dataset.saveAccess;
    const status = accessBody.querySelector(`[data-field="status"][data-id="${id}"]`).value;
    const memberId = accessBody.querySelector(`[data-field="member"][data-id="${id}"]`).value || null;
    if (status === 'ACTIVE' && !memberId) {
      Ipon.toast('Link an active login to a member before activation.', 'error');
      return;
    }
    const accepted = await Ipon.confirmAction({ title: 'Update member access?', message: `This member login will be ${status.toLowerCase()}.`, acceptLabel: 'Update access' });
    if (!accepted) return;
    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('admin_set_user_access', { p_user_id: id, p_role: 'MEMBER', p_status: status, p_member_id: memberId });
      Ipon.toast('Member account access updated.');
      await loadAccess();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  document.getElementById('contribution-setting-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('[type="submit"]');
    const values = new FormData(event.target);
    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('set_contribution_setting', { p_effective_month: `${values.get('effective_month')}-01`, p_default_amount: Number(values.get('default_amount')) });
      Ipon.toast('Contribution default saved.');
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  document.getElementById('generate-periods').addEventListener('click', async (event) => {
    const month = effectiveMonth.value;
    const accepted = await Ipon.confirmAction({ title: 'Generate contribution periods?', message: `Create missing periods for ${month}. Existing periods will not change.`, acceptLabel: 'Generate' });
    if (!accepted) return;
    Ipon.setBusy(event.currentTarget, true, 'Generating…');
    try {
      const count = await Ipon.rpc('generate_contribution_periods', { p_month: `${month}-01` });
      Ipon.toast(`${count} contribution period${count === 1 ? '' : 's'} created.`);
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(event.currentTarget, false);
    }
  });

  effectiveMonth.addEventListener('change', async () => {
    try { await loadContributionDefault(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
  });

  try {
    await Promise.all([loadContributionDefault(), loadAccess()]);
  } catch (error) {
    Ipon.showInlineError(accessBody, error, () => Promise.all([loadContributionDefault(), loadAccess()]), 4);
  }
})();
