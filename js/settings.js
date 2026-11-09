(async function () {
  'use strict';
  const state = await Ipon.init();
  if (state.failed) return;
  const accessBody = document.getElementById('access-body');
  let profiles = [];
  let members = [];

  document.getElementById('effective-month').value = Ipon.isoDate().slice(0, 7);
  if (!state.configured || !state.profile) {
    if (accessBody) accessBody.innerHTML = '<tr><td colspan="5" class="empty-state">Connect Supabase to manage access.</td></tr>';
    return;
  }

  document.getElementById('my-name').textContent = state.profile.full_name;
  document.getElementById('my-role').textContent = state.profile.role;
  document.getElementById('my-status').textContent = state.profile.status;
  if (state.profile.role !== 'ADMIN') return;

  function getAdminContext(targetId) {
    const otherActiveAdmins = profiles.filter((p) => p.id !== targetId && p.role === 'ADMIN' && p.status === 'ACTIVE');
    const replacementCandidates = profiles.filter((p) => p.id !== targetId && p.status !== 'DISABLED');
    return {
      otherActiveAdmins,
      replacementCandidates,
      needsReplacement: otherActiveAdmins.length === 0,
      hasMembersToReplace: replacementCandidates.length > 0
    };
  }

  async function loadAccess() {
    const [profileResult, memberResult] = await Promise.all([
      Ipon.client.from('profiles').select('id,full_name,role,status,member_id,created_at').order('created_at'),
      Ipon.client.from('members').select('id,full_name').eq('status', 'ACTIVE').order('full_name')
    ]);
    if (profileResult.error) throw profileResult.error;
    if (memberResult.error) throw memberResult.error;
    profiles = profileResult.data;
    members = memberResult.data;

    accessBody.innerHTML = profiles.length ? profiles.map((profile, index) => {
      const isSelf = profile.id === state.profile.id;
      const isFirstAdmin = index === 0 && profile.role === 'ADMIN';
      const ctx = getAdminContext(profile.id);
      const lockDowngrade = isSelf && profile.role === 'ADMIN' && ctx.needsReplacement && !ctx.hasMembersToReplace;

      return `<tr>
        <td>
          <strong>${Ipon.escapeHtml(profile.full_name)}</strong>
          ${isSelf ? `<small class="field-help" style="display:block">${isFirstAdmin ? 'Unang Admin • Ikaw' : 'Ikaw (Kasalukuyang Admin)'}</small>` : ''}
        </td>
        <td>
          <select data-field="role" data-id="${profile.id}">
            <option value="ADMIN" ${profile.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
            <option value="TREASURER" ${profile.role === 'TREASURER' ? 'selected' : ''} ${lockDowngrade ? 'disabled' : ''}>TREASURER</option>
            <option value="MEMBER" ${profile.role === 'MEMBER' ? 'selected' : ''} ${lockDowngrade ? 'disabled' : ''}>MEMBER</option>
          </select>
          ${lockDowngrade ? '<small class="role-lock-note">Bawal pang ibaba ang role — wala pang members na kapalit bilang Admin.</small>' : ''}
          ${isSelf && profile.role === 'ADMIN' && ctx.needsReplacement && ctx.hasMembersToReplace ? `
            <div class="replacement-picker" data-replacement-wrap="${profile.id}" hidden>
              <label for="replacement-${profile.id}">Pumili ng kapalit na Admin sa mga members:</label>
              <select id="replacement-${profile.id}" data-field="replacement" data-id="${profile.id}">
                <option value="">— Pumili ng member —</option>
                ${ctx.replacementCandidates.map((candidate) => `<option value="${candidate.id}">${Ipon.escapeHtml(candidate.full_name)} (${candidate.role})</option>`).join('')}
              </select>
            </div>` : ''}
        </td>
        <td>
          <select data-field="status" data-id="${profile.id}" ${isSelf ? 'disabled title="Hindi puwedeng i-disable ang sariling Admin account"' : ''}>
            <option value="PENDING" ${profile.status === 'PENDING' ? 'selected' : ''}>PENDING</option>
            <option value="ACTIVE" ${profile.status === 'ACTIVE' ? 'selected' : ''}>ACTIVE</option>
            <option value="DISABLED" ${profile.status === 'DISABLED' ? 'selected' : ''}>DISABLED</option>
          </select>
        </td>
        <td>
          <select data-field="member" data-id="${profile.id}">
            <option value="">Not linked</option>
            ${members.map((member) => `<option value="${member.id}" ${profile.member_id === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}
          </select>
        </td>
        <td><button class="icon-action" data-save-access="${profile.id}">Save</button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-state">No account profiles.</td></tr>';
  }

  accessBody.addEventListener('change', (event) => {
    const select = event.target.closest('[data-field="role"]');
    if (!select) return;
    const id = select.dataset.id;
    if (id !== state.profile.id) return;

    const ctx = getAdminContext(id);
    const wrap = accessBody.querySelector(`[data-replacement-wrap="${id}"]`);

    if (select.value !== 'ADMIN' && ctx.needsReplacement) {
      if (!ctx.hasMembersToReplace) {
        select.value = 'ADMIN';
        Ipon.toast('Bawal pang ibaba ang iyong Admin role dahil wala pang members na puwedeng pumalit bilang Admin.', 'error');
        return;
      }
      if (wrap) {
        wrap.hidden = false;
        wrap.querySelector('select')?.focus();
      }
    } else if (wrap) {
      wrap.hidden = true;
      const replacementSelect = wrap.querySelector('select');
      if (replacementSelect) replacementSelect.value = '';
    }
  });

  accessBody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-save-access]');
    if (!button) return;
    const id = button.dataset.saveAccess;
    const isSelf = id === state.profile.id;
    const role = accessBody.querySelector(`[data-field="role"][data-id="${id}"]`).value;
    const status = accessBody.querySelector(`[data-field="status"][data-id="${id}"]`).value;
    const memberId = accessBody.querySelector(`[data-field="member"][data-id="${id}"]`).value || null;
    const targetProfile = profiles.find((p) => p.id === id);

    if (isSelf && status !== 'ACTIVE') {
      Ipon.toast('Hindi puwedeng gawing pending o disabled ang sarili mong Admin account.', 'error');
      return;
    }

    if (targetProfile?.role === 'ADMIN' && (role !== 'ADMIN' || status !== 'ACTIVE')) {
      const ctx = getAdminContext(id);
      if (ctx.needsReplacement) {
        if (!ctx.hasMembersToReplace) {
          Ipon.toast('Bawal pang ibaba ang iyong Admin role dahil wala pang members na puwedeng pumalit bilang Admin.', 'error');
          return;
        }
        const replacementSelect = accessBody.querySelector(`[data-field="replacement"][data-id="${id}"]`);
        const replacementId = replacementSelect?.value || '';
        if (!replacementId) {
          const wrap = accessBody.querySelector(`[data-replacement-wrap="${id}"]`);
          if (wrap) wrap.hidden = false;
          replacementSelect?.focus();
          Ipon.toast('Kailangan munang pumili sa mga members ng kapalit na Admin bago ibaba ang iyong role.', 'error');
          return;
        }
        const replacementProfile = profiles.find((p) => p.id === replacementId);
        const accepted = await Ipon.confirmAction({
          title: 'Ipasa ang Admin role?',
          message: `Si ${replacementProfile.full_name} ang magiging bagong ADMIN bilang kapalit mo, at magiging ${role} na ang iyong role.`,
          acceptLabel: 'Ipasa ang Admin at i-save'
        });
        if (!accepted) return;

        Ipon.setBusy(button, true);
        try {
          await Ipon.rpc('admin_set_user_access', {
            p_user_id: replacementProfile.id,
            p_role: 'ADMIN',
            p_status: 'ACTIVE',
            p_member_id: replacementProfile.member_id || null
          });
          await Ipon.rpc('admin_set_user_access', {
            p_user_id: id,
            p_role: role,
            p_status: 'ACTIVE',
            p_member_id: memberId
          });
          Ipon.toast(`Naipasa na ang Admin role kay ${replacementProfile.full_name}.`);
          window.location.reload();
        } catch (error) {
          Ipon.toast(Ipon.friendlyError(error), 'error');
        } finally {
          Ipon.setBusy(button, false);
        }
        return;
      }
    }

    const accepted = await Ipon.confirmAction({
      title: 'Update account access?',
      message: `This user will be ${status.toLowerCase()} with the ${role.toLowerCase()} role.`,
      acceptLabel: 'Update access'
    });
    if (!accepted) return;

    Ipon.setBusy(button, true);
    try {
      await Ipon.rpc('admin_set_user_access', { p_user_id: id, p_role: role, p_status: status, p_member_id: memberId });
      Ipon.toast('Account access updated.');
      if (isSelf && role !== 'ADMIN') {
        window.location.reload();
        return;
      }
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
      await Ipon.rpc('set_contribution_setting', {
        p_effective_month: `${values.get('effective_month')}-01`,
        p_default_amount: Number(values.get('default_amount'))
      });
      Ipon.toast('Contribution default saved.');
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(button, false);
    }
  });

  document.getElementById('generate-periods').addEventListener('click', async (event) => {
    const month = document.getElementById('effective-month').value;
    const accepted = await Ipon.confirmAction({
      title: 'Generate contribution periods?',
      message: `Create missing member contribution periods for ${month}. Existing periods will not be changed.`,
      acceptLabel: 'Generate'
    });
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

  try {
    await loadAccess();
  } catch (error) {
    accessBody.innerHTML = `<tr><td colspan="5" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>`;
  }
})();
