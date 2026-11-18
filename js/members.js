(async function () {
  'use strict';
  const state = await Ipon.init({ allowedRoles: ['ADMIN'] });
  if (state.failed) return;
  const tbody = document.getElementById('members-body');
  const form = document.getElementById('member-form');
  const dialog = document.getElementById('member-dialog');
  const accountDialog = document.getElementById('member-account-dialog');
  const accountForm = document.getElementById('member-account-form');
  const historyDialog = document.getElementById('member-history-dialog');
  const historyBody = document.getElementById('member-history-body');
  const search = document.getElementById('member-search');
  const statusFilter = document.getElementById('member-status-filter');
  const pager = document.getElementById('member-pager');
  const firstName = document.getElementById('first-name');
  const middleName = document.getElementById('middle-name');
  const lastName = document.getElementById('last-name');
  const nameMigrationHelp = document.getElementById('name-migration-help');
  const contactInput = document.getElementById('contact-number');
  const contactError = document.getElementById('contact-number-error');
  const dateRegistered = document.getElementById('date-registered');
  const dateRegisteredHelp = document.getElementById('date-registered-help');
  const monthlyAmount = document.getElementById('monthly-amount');
  const monthlyAmountHelp = document.getElementById('monthly-amount-help');
  const emailField = document.getElementById('member-email-field');
  const passwordField = document.getElementById('member-password-field');
  const emailInput = document.getElementById('member-email');
  const passwordInput = document.getElementById('member-password');
  const deleteDialog = document.getElementById('member-delete-dialog');
  const deleteForm = document.getElementById('member-delete-form');
  const deleteSummary = document.getElementById('member-delete-summary');
  const deleteReasonSelect = document.getElementById('member-delete-reason-select');
  const deleteCustomWrap = document.getElementById('member-delete-custom-wrap');
  const deleteCustomReason = document.getElementById('member-delete-custom-reason');
  const deleteConfirmStep = document.getElementById('member-delete-confirm-step');
  const deleteConfirmCopy = document.getElementById('member-delete-confirm-copy');
  const deleteReasonPreview = document.getElementById('member-delete-reason-preview');
  const deleteBackBtn = document.getElementById('member-delete-back');
  const deleteConfirmBtn = document.getElementById('member-delete-confirm-btn');
  const binDialog = document.getElementById('bin-dialog');
  const binTypeFilter = document.getElementById('bin-type-filter');
  const binCount = document.getElementById('bin-count');
  const binList = document.getElementById('bin-list');
  const groupBarEl = document.getElementById('members-group-bar');
  const groupSwitcherWrap = document.getElementById('members-group-switcher-wrap');
  const groupSelect = document.getElementById('members-group-select');
  const permissionsPanel = document.getElementById('member-permissions-panel');
  const permissionsCount = document.getElementById('member-permissions-count');
  const permissionsList = document.getElementById('member-permissions-list');
  const permissionsPager = document.getElementById('member-permissions-pager');
  const permissionsSearch = document.getElementById('member-permissions-search');
  const permissionsRoleFilter = document.getElementById('member-permissions-role-filter');
  const permDialog = document.getElementById('member-permissions-dialog');
  const permForm = document.getElementById('member-perm-form');
  const permIdentity = document.getElementById('member-perm-modal-identity');
  const permPresetsWrap = document.getElementById('member-perm-modal-presets');
  const permGroupsWrap = document.getElementById('member-perm-modal-groups');
  const permSaveBtn = document.getElementById('save-member-perm-btn');
  const contactErrorMessage = 'Enter 11 digits starting with 09, or +63 followed by 10 digits starting with 9.';
  const nameFields = [
    [firstName, document.getElementById('first-name-error'), true],
    [middleName, document.getElementById('middle-name-error'), false],
    [lastName, document.getElementById('last-name-error'), true]
  ];
  let members = [];
  let accountsByMember = new Map();
  let membersWithContributions = new Set();
  let memberPermissions = [];
  let contributionSettings = [];
  let pendingDeleteMember = null;
  let pendingDeleteReason = '';
  let monthlyAmountTouched = false;
  let currentGroupId = state.profile?.group_id || '';
  const pageSize = 25;
  const permPageSize = 10;
  let memberPage = 0;
  let permPage = 0;
  let activePermUserId = '';
  let activePermDraft = null;
  let searchTimer;
  Ipon.bindPasswordStrength(passwordInput, () => [firstName.value, middleName.value, lastName.value, emailInput.value]);
  Ipon.bindPasswordStrength(accountForm.elements.password, () => {
    const member = members.find((item) => item.id === accountForm.elements.member_id.value);
    return [member?.first_name, member?.middle_name, member?.last_name, accountForm.elements.email.value];
  });
  dateRegistered.value = Ipon.isoDate();
  if (!state.configured || !state.profile) { tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Connect Supabase to load members.</td></tr>'; Ipon.setLoading(false); return; }

  function findApplicableContributionDefault(settings, registrationDate) {
    const registrationMonth = `${registrationDate.slice(0, 7)}-01`;
    return settings.find((item) => item.effective_month <= registrationMonth);
  }

  function applyContributionDefault() {
    if (form.elements.member_id.value || monthlyAmountTouched) return;
    const setting = findApplicableContributionDefault(contributionSettings, dateRegistered.value);
    monthlyAmount.value = setting?.default_amount ?? '';
    monthlyAmountHelp.textContent = setting
      ? `Prefilled from the default effective ${setting.effective_month.slice(0, 7)}. You can change it before saving.`
      : 'No default applies to this registration month. Enter a monthly amount.';
  }

  async function loadContributionSettings() {
    const { data, error } = await Ipon.client.from('contribution_settings')
      .select('effective_month,default_amount')
      .order('effective_month', { ascending: false });
    if (error) throw error;
    contributionSettings = data;
    applyContributionDefault();
  }

  function renderGroupContext(groups) {
    const list = Array.isArray(groups) ? groups : [];
    const current = list.find((item) => item.is_current) || list[0] || null;
    currentGroupId = current?.group_id || state.profile?.group_id || '';
    const isSolo = current?.workspace_mode === 'SOLO';
    Ipon.syncWorkspaceMode?.(isSolo ? 'SOLO' : 'GROUP');
    const addMemberBtn = document.getElementById('add-member');
    if (addMemberBtn) addMemberBtn.hidden = isSolo;
    if (permissionsPanel) permissionsPanel.hidden = isSolo;
    const hasMultipleGroups = list.length > 1;
    if (groupBarEl) groupBarEl.hidden = !hasMultipleGroups;
    if (groupSwitcherWrap && groupSelect) {
      groupSwitcherWrap.hidden = !hasMultipleGroups;
      Ipon.populateGroupSelect(groupSelect, list, current?.group_id);
    }
    return current;
  }

  function memberStatusMeta(member) {
    if (member.status === 'INACTIVE') {
      return {
        tone: 'inactive',
        label: 'INACTIVE',
        hint: member.deactivated_at ? `Paused ${Ipon.dateLabel(member.deactivated_at)}` : 'Paused from tracking'
      };
    }
    if (member.activation_status !== 'ACTIVE') {
      return {
        tone: 'pending',
        label: 'PENDING LOGIN',
        hint: 'Log in to activate'
      };
    }
    return {
      tone: 'active',
      label: 'OFFICIAL ACTIVE',
      hint: member.activated_at ? `Activated ${Ipon.dateLabel(member.activated_at)}` : 'Signed in & verified'
    };
  }

  function render() {
    tbody.innerHTML = members.length ? members.map((member) => {
      const account = accountsByMember.get(member.id);
      const canDelete = !membersWithContributions.has(member.id);
      const statusMeta = memberStatusMeta(member);
      const accountMarkup = account
        ? `<div class="member-state-stack"><span class="status status-${account.status.toLowerCase()}">${account.status}</span><small class="field-help">${Ipon.escapeHtml(account.email || '')}</small></div>`
        : '<div class="member-state-stack"><span class="field-help">No sign-in</span></div>';
      return `<tr>
      <td><strong>${Ipon.escapeHtml(member.full_name)}${Ipon.verifiedBadgesHtml?.(account?.id || member.id) || ''}</strong></td><td>${Ipon.escapeHtml(member.contact_number || '—')}</td><td>${Ipon.payoutSummaryChip(member, { compact: true, emptyText: 'Not set' })}</td><td>${Ipon.dateLabel(member.date_registered)}</td>
      <td class="amount-cell">${Ipon.money(member.monthly_contribution_amount)}</td><td><div class="member-state-stack"><span class="status status-${statusMeta.tone}">${statusMeta.label}</span><small class="field-help">${Ipon.escapeHtml(statusMeta.hint)}</small></div></td>
      <td>${accountMarkup}</td>
      <td><div class="table-actions"><button class="icon-action" data-action="history" data-id="${member.id}">History</button><button class="icon-action" data-action="edit" data-id="${member.id}">Edit</button>${account?.id && account.role !== 'ADMIN' ? `<button class="icon-action" data-action="permissions" data-id="${member.id}">Permissions</button>` : ''}${!account && member.status === 'ACTIVE' && member.first_name && member.last_name ? `<button class="icon-action" data-action="account" data-id="${member.id}">Create account</button>` : ''}${account?.email ? `<button class="icon-action" data-action="reset" data-id="${member.id}">Reset password</button>` : ''}<button class="icon-action" data-action="${member.status === 'ACTIVE' ? 'deactivate' : 'reactivate'}" data-id="${member.id}">${member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</button>${canDelete ? `<button class="icon-action icon-action-danger" data-action="delete" data-id="${member.id}">Delete</button>` : ''}</div></td></tr>`;
    }).join('') : '<tr><td colspan="8" class="empty-state">No matching members.</td></tr>';
  }

  function permissionPresetMatch(u) {
    const isStd = u.can_edit_own_entries
      && u.require_edit_approval
      && u.require_add_approval
      && u.can_record_expenses === (u.role === 'TREASURER')
      && u.require_expense_approval
      && u.can_record_withdrawals === (u.role === 'TREASURER')
      && u.require_withdrawal_approval;
    if (isStd) return 'standard';
    const isTrusted = u.can_edit_own_entries
      && !u.require_edit_approval
      && !u.require_add_approval
      && (!u.can_record_expenses || !u.require_expense_approval)
      && (!u.can_record_withdrawals || !u.require_withdrawal_approval);
    if (isTrusted) return 'trusted';
    if (!u.can_edit_own_entries && u.require_add_approval && !u.can_record_expenses && !u.can_record_withdrawals) {
      return 'restricted';
    }
    return 'custom';
  }

  function buildPresetPayload(mode, target) {
    const isTreasurer = String(target?.role || '').toUpperCase() === 'TREASURER';
    if (mode === 'trusted') {
      return {
        can_edit_own_entries: true,
        require_edit_approval: false,
        require_add_approval: false,
        can_record_expenses: Boolean(target?.can_record_expenses || isTreasurer),
        require_expense_approval: false,
        can_record_withdrawals: Boolean(target?.can_record_withdrawals || isTreasurer),
        require_withdrawal_approval: false
      };
    }
    if (mode === 'restricted') {
      return {
        can_edit_own_entries: false,
        require_edit_approval: true,
        require_add_approval: true,
        can_record_expenses: false,
        require_expense_approval: true,
        can_record_withdrawals: false,
        require_withdrawal_approval: true
      };
    }
    return {
      can_edit_own_entries: true,
      require_edit_approval: true,
      require_add_approval: true,
      can_record_expenses: isTreasurer,
      require_expense_approval: true,
      can_record_withdrawals: isTreasurer,
      require_withdrawal_approval: true
    };
  }

  function permissionProfileMeta(preset) {
    if (preset === 'trusted') return { label: 'Trusted (Instant)', tone: 'active' };
    if (preset === 'restricted') return { label: 'Restricted', tone: 'inactive' };
    if (preset === 'custom') return { label: 'Custom', tone: 'pending' };
    return { label: 'Standard', tone: 'confirmed' };
  }

  function renderPermissionRuleChips(u) {
    const chips = [
      !u.can_edit_own_entries
        ? { text: 'Calendar: Locked', tone: 'is-off' }
        : (u.require_edit_approval ? { text: 'Calendar: Approval', tone: 'is-approval' } : { text: 'Calendar: Instant', tone: 'is-direct' }),
      u.require_add_approval
        ? { text: 'Additions: Approval', tone: 'is-approval' }
        : { text: 'Additions: Instant', tone: 'is-direct' },
      !u.can_record_expenses
        ? { text: 'Expenses: Off', tone: 'is-off' }
        : (u.require_expense_approval ? { text: 'Expenses: Approval', tone: 'is-approval' } : { text: 'Expenses: Instant', tone: 'is-direct' }),
      !u.can_record_withdrawals
        ? { text: 'Deductions: Off', tone: 'is-off' }
        : (u.require_withdrawal_approval ? { text: 'Deductions: Approval', tone: 'is-approval' } : { text: 'Deductions: Instant', tone: 'is-direct' })
    ];
    return `<div class="member-perm-rule-chips">${chips.map((c) => `<span class="member-perm-chip ${c.tone}">${Ipon.escapeHtml(c.text)}</span>`).join('')}</div>`;
  }

  function permSwitchMarkup(userId, key, checked, label, hint, { disabled = false } = {}) {
    const id = `perm-modal-${userId}-${key}`;
    return `
      <label class="member-perm-switch ${disabled ? 'is-disabled' : ''}" for="${id}">
        <span class="member-perm-switch-copy">
          <strong>${Ipon.escapeHtml(label)}</strong>
          <small>${Ipon.escapeHtml(hint)}</small>
        </span>
        <input class="toggle-switch-input" id="${id}" type="checkbox" role="switch" data-perm-toggle="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      </label>`;
  }

  let permInitialSnapshot = '';

  function permSnapshot(draft) {
    if (!draft) return '';
    return JSON.stringify([
      Boolean(draft.can_edit_own_entries),
      Boolean(draft.require_edit_approval),
      Boolean(draft.require_add_approval),
      Boolean(draft.can_record_expenses),
      Boolean(draft.require_expense_approval),
      Boolean(draft.can_record_withdrawals),
      Boolean(draft.require_withdrawal_approval)
    ]);
  }

  function renderPermissionModalControls() {
    if (!activePermDraft || !permPresetsWrap || !permGroupsWrap) return;
    const preset = permissionPresetMatch(activePermDraft);
    permPresetsWrap.querySelectorAll('[data-perm-preset]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.permPreset === preset ? 'true' : 'false');
    });
    const uid = activePermDraft.user_id || activePermUserId || 'member';
    permGroupsWrap.innerHTML = `
      <div class="member-perm-group">
        <span class="member-perm-group-title">Calendar &amp; Additions</span>
        ${permSwitchMarkup(uid, 'can_edit_own_entries', activePermDraft.can_edit_own_entries, 'Edit calendar entries', 'Allow editing own entries & submitting change reasons')}
        ${permSwitchMarkup(uid, 'require_edit_approval', activePermDraft.require_edit_approval, 'Edits require approval', activePermDraft.can_edit_own_entries ? 'Off = calendar edits apply immediately' : 'Enable calendar editing first', { disabled: !activePermDraft.can_edit_own_entries })}
        ${permSwitchMarkup(uid, 'require_add_approval', activePermDraft.require_add_approval, 'Additions require approval', 'Off = new savings additions confirm right away')}
      </div>
      <div class="member-perm-group">
        <span class="member-perm-group-title">Expenses &amp; Deductions</span>
        ${permSwitchMarkup(uid, 'can_record_expenses', activePermDraft.can_record_expenses, 'Allow recording expenses', 'Can open and submit workspace expense entries')}
        ${permSwitchMarkup(uid, 'require_expense_approval', activePermDraft.require_expense_approval, 'Expenses require approval', activePermDraft.can_record_expenses ? 'Off = expenses confirm immediately' : 'Enable recording expenses first', { disabled: !activePermDraft.can_record_expenses })}
        ${permSwitchMarkup(uid, 'can_record_withdrawals', activePermDraft.can_record_withdrawals, 'Allow recording deductions', 'Can open and submit fund deduction entries')}
        ${permSwitchMarkup(uid, 'require_withdrawal_approval', activePermDraft.require_withdrawal_approval, 'Deductions require approval', activePermDraft.can_record_withdrawals ? 'Off = deductions confirm immediately' : 'Enable recording deductions first', { disabled: !activePermDraft.can_record_withdrawals })}
      </div>`;
    if (permSaveBtn) {
      const permDirty = permSnapshot(activePermDraft) !== permInitialSnapshot;
      if (permSaveBtn.dataset) {
        if (permDirty) delete permSaveBtn.dataset.dirtyLocked;
        else permSaveBtn.dataset.dirtyLocked = 'true';
      }
      if (!permSaveBtn.classList.contains('is-busy')) permSaveBtn.disabled = !permDirty;
      permSaveBtn.title = permDirty ? '' : 'Change a permission before saving.';
    }
  }

  function openMemberPermissionsModal(userId) {
    if (!permDialog || !permForm) return;
    const target = memberPermissions.find((item) => String(item.user_id) === String(userId));
    if (!target) {
      Ipon.toast('Permissions are available once the member has a sign-in account in this group.', 'error');
      return;
    }
    activePermUserId = String(target.user_id);
    activePermDraft = { ...target };
    permInitialSnapshot = permSnapshot(activePermDraft);
    permForm.elements.user_id.value = activePermUserId;
    const roleCls = target.role === 'TREASURER' ? 'status-pending' : 'status-confirmed';
    if (permIdentity) {
      permIdentity.innerHTML = `
        <div class="member-perm-identity">
          ${Ipon.avatarMarkup(target.avatar_url || '', target.full_name || 'Member', 'avatar-md')}
          <div class="member-perm-identity-copy">
            <div class="member-perm-name-row">
              <strong>${Ipon.escapeHtml(target.full_name || 'Member')}${Ipon.verifiedBadgesHtml?.(target.user_id || target.id) || ''}</strong>
              <span class="status ${roleCls}">${Ipon.escapeHtml(target.role)}</span>
            </div>
            <small>${Ipon.escapeHtml(target.email || '')}${target.status === 'PENDING' ? ' · Pending login' : ''}</small>
          </div>
        </div>`;
      Ipon.bindAvatarFallbacks(permIdentity);
    }
    renderPermissionModalControls();
    if (!permDialog.open) permDialog.showModal();
    document.getElementById('close-member-perm-dialog')?.focus();
  }

  function renderPermissions() {
    if (!permissionsList || !permissionsCount) return;
    const configurable = (memberPermissions || []).filter((u) => String(u.role || '').toUpperCase() !== 'ADMIN');
    const q = String(permissionsSearch?.value || '').trim().toLowerCase();
    const roleFilter = String(permissionsRoleFilter?.value || '').trim().toUpperCase();
    const filtered = configurable.filter((u) => {
      if (roleFilter && String(u.role || '').toUpperCase() !== roleFilter) return false;
      if (!q) return true;
      return `${u.full_name || ''} ${u.email || ''}`.toLowerCase().includes(q);
    });
    const instantCount = configurable.filter((u) => !u.require_add_approval || (u.can_edit_own_entries && !u.require_edit_approval)).length;
    permissionsCount.textContent = configurable.length
      ? `${configurable.length} account${configurable.length === 1 ? '' : 's'} · ${instantCount} instant-approved · Click Edit permissions on any row to adjust.`
      : 'No Member or Treasurer accounts linked yet. Create or invite an account above to configure permissions.';
    if (!filtered.length) {
      if (permissionsPager) permissionsPager.hidden = true;
      permissionsList.innerHTML = configurable.length
        ? '<tr><td colspan="5" class="empty-state">No member permissions match that search or role filter.</td></tr>'
        : '<tr><td colspan="5" class="empty-state">Create a sign-in account for a member or invite via group link/QR to customize permissions here.</td></tr>';
      return;
    }
    const totalPages = Math.max(1, Math.ceil(filtered.length / permPageSize));
    if (permPage >= totalPages) permPage = totalPages - 1;
    if (permPage < 0) permPage = 0;
    const slice = filtered.slice(permPage * permPageSize, (permPage + 1) * permPageSize);
    permissionsList.innerHTML = slice.map((u) => {
      const preset = permissionPresetMatch(u);
      const profileMeta = permissionProfileMeta(preset);
      const roleCls = u.role === 'TREASURER' ? 'status-pending' : 'status-confirmed';
      return `
        <tr data-perm-user="${Ipon.escapeHtml(u.user_id)}">
          <td data-label="Member">
            <div class="member-perm-user-cell">
              ${Ipon.avatarMarkup(u.avatar_url || '', u.full_name || 'Member', 'avatar-sm')}
              <div class="member-perm-user-meta">
                <strong>${Ipon.escapeHtml(u.full_name || 'Member')}${Ipon.verifiedBadgesHtml?.(u.user_id || u.id) || ''}</strong>
                <small class="field-help">${Ipon.escapeHtml(u.email || '')}${u.status === 'PENDING' ? ' · Pending login' : ''}</small>
              </div>
            </div>
          </td>
          <td data-label="Role"><span class="status ${roleCls}">${Ipon.escapeHtml(u.role)}</span></td>
          <td data-label="Profile"><span class="status status-${profileMeta.tone}">${Ipon.escapeHtml(profileMeta.label)}</span></td>
          <td data-label="Active rules">${renderPermissionRuleChips(u)}</td>
          <td data-label="Actions">
            <div class="table-actions">
              <button class="icon-action" type="button" data-action="edit-permissions" data-user-id="${Ipon.escapeHtml(u.user_id)}">Edit permissions</button>
            </div>
          </td>
        </tr>`;
    }).join('');
    Ipon.bindAvatarFallbacks(permissionsList);
    if (permissionsPager) {
      permissionsPager.hidden = totalPages <= 1;
      const prevBtn = permissionsPager.querySelector('[data-page="previous"]');
      const nextBtn = permissionsPager.querySelector('[data-page="next"]');
      const labelEl = permissionsPager.querySelector('span');
      if (prevBtn) prevBtn.disabled = permPage <= 0;
      if (nextBtn) nextBtn.disabled = permPage + 1 >= totalPages;
      if (labelEl) labelEl.textContent = `Page ${permPage + 1} of ${totalPages}`;
    }
  }

  async function saveUserPermissions(userId, nextPatch, busyBtn) {
    const existing = memberPermissions.find((item) => String(item.user_id) === String(userId));
    if (!existing) return false;
    const merged = { ...existing, ...nextPatch };
    if (busyBtn) Ipon.setBusy(busyBtn, true, 'Saving…');
    try {
      const updated = await Ipon.rpc('update_member_permissions', {
        p_user_id: userId,
        p_can_edit_own_entries: Boolean(merged.can_edit_own_entries),
        p_require_edit_approval: Boolean(merged.require_edit_approval),
        p_require_add_approval: Boolean(merged.require_add_approval),
        p_can_record_expenses: Boolean(merged.can_record_expenses),
        p_require_expense_approval: Boolean(merged.require_expense_approval),
        p_can_record_withdrawals: Boolean(merged.can_record_withdrawals),
        p_require_withdrawal_approval: Boolean(merged.require_withdrawal_approval)
      });
      memberPermissions = memberPermissions.map((item) => (
        String(item.user_id) === String(userId) ? { ...item, ...merged, ...(updated || {}) } : item
      ));
      renderPermissions();
      Ipon.toast(`Permissions updated for ${existing.full_name || 'member'}.`);
      return true;
    } catch (error) {
      renderPermissions();
      Ipon.toast(Ipon.friendlyError(error), 'error');
      return false;
    } finally {
      if (busyBtn) Ipon.setBusy(busyBtn, false);
    }
  }
  async function load() {
    let query = Ipon.client.from('members').select('*', { count: 'exact' }).is('deleted_at', null);
    const term = search.value.trim().replace(/[%_]/g, '');
    if (term) query = query.ilike('full_name', `%${term}%`);
    if (statusFilter.value === 'ACTIVE') {
      query = query.eq('status', 'ACTIVE').eq('activation_status', 'ACTIVE');
    } else if (statusFilter.value === 'PENDING') {
      query = query.eq('status', 'ACTIVE').eq('activation_status', 'PENDING');
    } else if (statusFilter.value === 'INACTIVE') {
      query = query.eq('status', 'INACTIVE');
    }
    const [{ data, count, error }, summaryRes, accessRows, groups, permRows] = await Promise.all([
      query.order('full_name').range(memberPage * pageSize, (memberPage + 1) * pageSize - 1),
      Ipon.client.from('members').select('status,activation_status').is('deleted_at', null),
      Ipon.rpc('get_group_access_list'),
      Ipon.rpc('get_my_groups'),
      Ipon.rpc('get_member_permissions_list').catch(() => [])
    ]);
    if (error) throw error;
    if (summaryRes.error) throw summaryRes.error;
    const currentGroup = renderGroupContext(groups);
    if (currentGroup?.workspace_mode === 'SOLO') {
      members = [];
      accountsByMember = new Map();
      membersWithContributions = new Set();
      memberPermissions = [];
      document.getElementById('member-count').textContent = 'Solo tracker (personal savings)';
      pager.querySelector('span').textContent = 'Page 1 of 1';
      pager.querySelector('[data-page="previous"]').disabled = true;
      pager.querySelector('[data-page="next"]').disabled = true;
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Solo savings trackers do not use member rosters or invitations. Switch to a Group workspace above or edit this workspace on the <a href="dashboard.html">Dashboard</a>.</td></tr>';
      return;
    }
    const memberIds = (data || []).map((member) => member.id);
    const contribResult = memberIds.length
      ? await Ipon.client.from('contribution_periods').select('member_id,contributions!inner(id)').in('member_id', memberIds)
      : { data: [], error: null };
    if (contribResult.error) throw contribResult.error;
    members = data || [];
    memberPermissions = Array.isArray(permRows) ? permRows : [];
    Ipon.registerMemberAvatars?.(Array.isArray(accessRows) ? accessRows : []);
    accountsByMember = new Map((Array.isArray(accessRows) ? accessRows : []).filter((row) => row.member_id).map((row) => [row.member_id, { id: row.user_id, email: row.email, role: row.role, status: row.status, member_id: row.member_id }]));
    membersWithContributions = new Set((contribResult.data || []).map((row) => row.member_id));
    const summaryRows = summaryRes.data || [];
    const officialActiveCount = summaryRows.filter((row) => row.status === 'ACTIVE' && row.activation_status === 'ACTIVE').length;
    const pendingLoginCount = summaryRows.filter((row) => row.status === 'ACTIVE' && row.activation_status !== 'ACTIVE').length;
    const inactiveCount = summaryRows.filter((row) => row.status === 'INACTIVE').length;
    const filteredCount = Number(count || 0);
    const countParts = [`${officialActiveCount} official active`];
    if (pendingLoginCount > 0) countParts.push(`${pendingLoginCount} pending login`);
    if (inactiveCount > 0) countParts.push(`${inactiveCount} inactive`);
    if (term || statusFilter.value) countParts.push(`${filteredCount} shown`);
    document.getElementById('member-count').textContent = countParts.join(' · ');
    const pages = Math.max(1, Math.ceil(filteredCount / pageSize));
    if (memberPage >= pages) memberPage = Math.max(0, pages - 1);
    pager.querySelector('span').textContent = `Page ${memberPage + 1} of ${pages}`;
    pager.querySelector('[data-page="previous"]').disabled = memberPage === 0;
    pager.querySelector('[data-page="next"]').disabled = memberPage >= pages - 1;
    render();
    renderPermissions();
  }
  async function refresh() {
    try { await load(); } catch (error) { Ipon.showInlineError(tbody, error, refresh, 8); }
  }
  function resetForm() {
    form.reset(); form.elements.member_id.value = ''; dateRegistered.value = Ipon.isoDate(); monthlyAmountTouched = false; applyContributionDefault();
    dateRegistered.disabled = false; dateRegisteredHelp.hidden = true;
    emailField.hidden = false; emailInput.required = true;
    passwordField.hidden = false; passwordInput.required = true;
    nameMigrationHelp.hidden = true; nameMigrationHelp.textContent = '';
    nameFields.forEach(([input, error]) => setNameError(input, error, ''));
    setContactError('');
    Ipon.setPayoutFields(form, null);
    document.getElementById('member-form-title').textContent = 'Add member';
    document.getElementById('member-form-copy').textContent = 'Create a tracking profile and sign-in account for a contributor.';
    memberDirty?.reset();
  }
  const memberDirty = Ipon.bindDirtySaveForm?.(form, form?.querySelector('[type="submit"]'), {
    getActive: () => Boolean(form?.elements?.member_id?.value)
  });
  function normalizeContactNumber(value) {
    const number = String(value || '').trim();
    if (!number) return '';
    if (/^09[0-9]{9}$/.test(number)) return number;
    if (/^\+639[0-9]{9}$/.test(number)) return `0${number.slice(3)}`;
    return null;
  }
  function setContactError(message) {
    contactError.hidden = !message;
    contactInput.setCustomValidity(message);
    if (message) contactInput.setAttribute('aria-invalid', 'true'); else contactInput.removeAttribute('aria-invalid');
  }
  function setNameError(input, error, message) {
    input.setCustomValidity(message);
    if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    error.textContent = message;
    error.hidden = !message;
  }
  function validateNames() {
    return Ipon.validateNameFields(form);
  }
  contactInput.addEventListener('input', () => setContactError(''));
  monthlyAmount.addEventListener('input', () => {
    monthlyAmountTouched = true;
    monthlyAmountHelp.textContent = 'Custom amount entered. This amount will be used when generating new periods.';
  });
  dateRegistered.addEventListener('change', applyContributionDefault);
  contactInput.addEventListener('invalid', (event) => { event.preventDefault(); setContactError(contactErrorMessage); contactInput.focus(); });
  contactInput.addEventListener('blur', () => {
    const normalized = normalizeContactNumber(contactInput.value);
    if (normalized === null) setContactError(contactErrorMessage);
    else { contactInput.value = normalized; setContactError(''); }
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]'); const values = new FormData(form); const contactNumber = normalizeContactNumber(values.get('contact_number'));
    if (!validateNames()) return;
    if (contactNumber === null) { setContactError(contactErrorMessage); contactInput.focus(); return; }
    if (!Ipon.validatePayoutFields(form)) return;
    const creatingAccount = !emailField.hidden;
    const payoutPayload = Ipon.readPayoutPayload(form);
    const name = { p_first_name: Ipon.normalizeNamePart(values.get('first_name')), p_middle_name: values.get('middle_name').trim() ? Ipon.normalizeNamePart(values.get('middle_name')) : null, p_last_name: Ipon.normalizeNamePart(values.get('last_name')) };
    if (creatingAccount) {
      if (!emailInput.checkValidity()) { Ipon.setFieldError(emailInput, Ipon.getValidationMessage(emailInput)); emailInput.focus(); return; }
      const passwordIssue = Ipon.passwordIssue(passwordInput.value, [name.p_first_name, name.p_middle_name, name.p_last_name, emailInput.value]);
      if (passwordIssue) { Ipon.setFieldError(passwordInput, passwordIssue); passwordInput.focus(); return; }
    }
    const existingMemberId = values.get('member_id');
    const fullName = [name.p_first_name, name.p_middle_name, name.p_last_name].filter(Boolean).join(' ');
    const accepted = await Ipon.confirmAction({
      title: existingMemberId ? 'Save member changes?' : creatingAccount ? 'Add member & create login?' : 'Add member?',
      message: existingMemberId
        ? `Update member profile for ${fullName}?`
        : creatingAccount
          ? `Create member "${fullName}" and send a sign-in invitation to ${emailInput.value.trim()}? They will become an official active member after signing in.`
          : `Add "${fullName}" (${Ipon.money(Number(values.get('monthly_contribution_amount')))}/month)? They will remain Pending Login until linked to an account and signed in.`,
      acceptLabel: existingMemberId ? 'Save changes' : 'Add member'
    });
    if (!accepted) return;
    Ipon.setBusy(button, true);
    try {
      let memberId = values.get('member_id');
      if (memberId) await Ipon.rpc('update_member', { p_member_id: memberId, ...name, p_contact_number: contactNumber, p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null, ...payoutPayload });
      else {
        memberId = await Ipon.rpc('create_member', { ...name, p_contact_number: contactNumber, p_date_registered: values.get('date_registered'), p_monthly_contribution_amount: Number(values.get('monthly_contribution_amount')), p_notes: values.get('notes') || null, ...payoutPayload });
        form.elements.member_id.value = memberId;
      }
      if (creatingAccount) {
        const { error } = await Ipon.client.functions.invoke('manage-account', { body: { role: 'MEMBER', member_id: memberId, first_name: name.p_first_name, middle_name: name.p_middle_name, last_name: name.p_last_name, contact_number: contactNumber || null, email: emailInput.value.trim(), password: passwordInput.value } });
        if (error) { const detail = await error.context?.json?.().catch(() => null); throw new Error(detail?.error || error.message); }
      }
      Ipon.toast(creatingAccount ? 'Member and account created.' : 'Member updated.'); dialog.close(); await load();
    } catch (error) { await load().catch(() => {}); Ipon.toast(Ipon.friendlyError(error), 'error'); } finally { Ipon.setBusy(button, false); }
  });
  tbody.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return; const member = members.find((item) => item.id === button.dataset.id); if (!member) return;
    if (button.dataset.action === 'history') {
      document.getElementById('member-history-title').textContent = `${member.full_name} — contribution history`;
      historyBody.innerHTML = '<tr><td colspan="5">Loading history…</td></tr>'; historyDialog.showModal();
      const { data, error } = await Ipon.client.from('contributions').select('amount,payment_date,approval_status,review_note,void_reason,contribution_periods!inner(period_month,member_id)').eq('contribution_periods.member_id', member.id).order('payment_date', { ascending: false }).limit(100);
      historyBody.innerHTML = error ? `<tr><td colspan="5" class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</td></tr>` : data.length ? data.map((row) => `<tr><td>${Ipon.dateLabel(row.contribution_periods.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.dateLabel(row.payment_date)}</td><td>${Ipon.money(row.amount)}</td><td><span class="status status-${row.approval_status.toLowerCase()}">${row.approval_status}</span></td><td>${Ipon.escapeHtml(row.review_note || row.void_reason || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty-state">No contribution history yet.</td></tr>';
    } else if (button.dataset.action === 'edit') {
      form.elements.member_id.value = member.id; form.elements.first_name.value = member.first_name || ''; form.elements.middle_name.value = member.middle_name || ''; form.elements.last_name.value = member.last_name || ''; form.elements.contact_number.value = member.contact_number || '';
      emailField.hidden = true; emailInput.required = false;
      passwordField.hidden = true; passwordInput.required = false;
      nameFields.forEach(([input, error]) => setNameError(input, error, ''));
      nameMigrationHelp.hidden = Boolean(member.first_name && member.last_name);
      nameMigrationHelp.textContent = nameMigrationHelp.hidden ? '' : `Legacy name kept as “${member.full_name}”. Enter its structured name parts before saving.`;
      setContactError('');
      form.elements.date_registered.value = member.date_registered; form.elements.monthly_contribution_amount.value = member.monthly_contribution_amount; form.elements.notes.value = member.notes || '';
      Ipon.setPayoutFields(form, member);
      dateRegistered.disabled = true; dateRegisteredHelp.hidden = false;
      monthlyAmountTouched = true; monthlyAmountHelp.textContent = 'This member\'s saved amount is used when generating new periods.';
      document.getElementById('member-form-title').textContent = 'Edit member'; document.getElementById('member-form-copy').textContent = `Update ${member.full_name}'s profile.`;
      memberDirty?.reset();
      dialog.showModal(); firstName.focus();
    } else if (button.dataset.action === 'account') {
      accountForm.reset(); accountForm.elements.member_id.value = member.id;
      document.getElementById('member-account-copy').textContent = `Create a secure sign-in for ${member.full_name}.`;
      accountDialog.showModal(); accountForm.elements.email.focus();
    } else if (button.dataset.action === 'reset') {
      const account = accountsByMember.get(member.id); if (!account?.email) return;
      const accepted = await Ipon.confirmAction({ title: 'Send password recovery email?', message: `A password recovery link will be sent to ${account.email}.`, acceptLabel: 'Send email' });
      if (!accepted) return;
      Ipon.setBusy(button, true, 'Sending…');
      try {
        const { error } = await Ipon.client.auth.resetPasswordForEmail(account.email, { redirectTo: new URL('account.html', location.href).href });
        if (error) throw error;
        Ipon.toast('Password recovery email sent.');
      } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
      finally { Ipon.setBusy(button, false); }
    } else if (button.dataset.action === 'deactivate') {
      const accepted = await Ipon.confirmAction({ title: 'Deactivate member?', message: `${member.full_name} will stop receiving new contribution periods. Existing records remain available.`, acceptLabel: 'Deactivate' });
      if (!accepted) return;
      try { await Ipon.rpc('deactivate_member', { p_member_id: member.id }); Ipon.toast('Member deactivated.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    } else if (button.dataset.action === 'reactivate') {
      const accepted = await Ipon.confirmAction({ title: 'Reactivate member?', message: `${member.full_name} will be included when new contribution periods are generated.`, acceptLabel: 'Reactivate' });
      if (!accepted) return;
      try { await Ipon.rpc('reactivate_member', { p_member_id: member.id }); Ipon.toast('Member reactivated.'); await load(); } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    } else if (button.dataset.action === 'permissions') {
      const account = accountsByMember.get(member.id);
      if (!account?.id) return;
      openMemberPermissionsModal(account.id);
    } else if (button.dataset.action === 'delete') {
      openDeleteDialog(member);
    }
  });
  function resetDeleteDialog() {
    pendingDeleteMember = null;
    pendingDeleteReason = '';
    deleteForm.reset();
    deleteForm.hidden = false;
    deleteConfirmStep.hidden = true;
    deleteCustomWrap.hidden = true;
    deleteCustomReason.required = false;
    Ipon.setFieldError(deleteCustomReason, '');
    Ipon.setFieldError(deleteReasonSelect, '');
  }
  function openDeleteDialog(member) {
    if (!member || membersWithContributions.has(member.id)) return;
    resetDeleteDialog();
    pendingDeleteMember = member;
    deleteForm.elements.member_id.value = member.id;
    const account = accountsByMember.get(member.id);
    const statusMeta = memberStatusMeta(member);
    deleteSummary.innerHTML = `<div class="record-review-summary-top"><span class="record-type-pill is-expense">Delete member</span><span class="status status-${statusMeta.tone}">${Ipon.escapeHtml(statusMeta.label)}</span></div><div class="record-review-summary-main"><div class="record-review-author"><div><strong>${Ipon.escapeHtml(member.full_name)}${Ipon.verifiedBadgesHtml?.(account?.id || member.id) || ''}</strong><small>${Ipon.escapeHtml(account?.email || member.contact_number || 'No sign-in account')}</small></div></div><div class="record-review-amount"><small>Monthly target</small><strong>${Ipon.money(member.monthly_contribution_amount)}</strong></div></div><div class="record-review-meta"><span>Registered ${Ipon.escapeHtml(Ipon.dateLabel(member.date_registered))}</span><span>0 recorded contributions</span></div>`;
    deleteDialog.showModal();
    deleteReasonSelect.focus();
  }
  function resolveDeleteReason() {
    if (deleteReasonSelect.value === 'OTHERS') return deleteCustomReason.value.trim();
    return deleteReasonSelect.value.trim();
  }
  deleteReasonSelect.addEventListener('change', () => {
    const isOther = deleteReasonSelect.value === 'OTHERS';
    deleteCustomWrap.hidden = !isOther;
    deleteCustomReason.required = isOther;
    Ipon.setFieldError(deleteReasonSelect, '');
    Ipon.setFieldError(deleteCustomReason, '');
    if (isOther) deleteCustomReason.focus();
  });
  deleteCustomReason.addEventListener('input', () => Ipon.setFieldError(deleteCustomReason, ''));
  deleteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pendingDeleteMember) return;
    if (!deleteReasonSelect.value) {
      Ipon.setFieldError(deleteReasonSelect, 'Select a deletion reason.');
      deleteReasonSelect.focus();
      return;
    }
    const reason = resolveDeleteReason();
    if (reason.length < 3 || reason.length > 500) {
      Ipon.setFieldError(deleteCustomReason, 'Enter a reason between 3 and 500 characters.');
      deleteCustomReason.focus();
      return;
    }
    pendingDeleteReason = reason;
    const linkedAccount = accountsByMember.get(pendingDeleteMember.id);
    deleteConfirmCopy.textContent = `${pendingDeleteMember.full_name} will be moved to the recycle bin for 1 month${linkedAccount ? ' and their sign-in account will be temporarily disabled until recovered' : ''}.`;
    deleteReasonPreview.textContent = `Reason: "${reason}"`;
    deleteForm.hidden = true;
    deleteConfirmStep.hidden = false;
    deleteConfirmBtn.focus();
  });
  deleteBackBtn.addEventListener('click', () => {
    deleteConfirmStep.hidden = true;
    deleteForm.hidden = false;
    deleteReasonSelect.focus();
  });
  deleteConfirmBtn.addEventListener('click', async () => {
    if (!pendingDeleteMember || !pendingDeleteReason) return;
    Ipon.setBusy(deleteConfirmBtn, true, 'Deleting…');
    try {
      await Ipon.rpc('delete_member', { p_member_id: pendingDeleteMember.id, p_reason: pendingDeleteReason });
      deleteDialog.close();
      Ipon.toast('Member moved to recycle bin.');
      await load();
      if (binDialog.open) await loadBin();
    } catch (error) {
      await load().catch(() => {});
      if (/not found/i.test(String(error?.message || ''))) deleteDialog.close();
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(deleteConfirmBtn, false);
    }
  });
  document.getElementById('close-member-delete-dialog')?.addEventListener('click', () => deleteDialog.close());
  document.getElementById('cancel-member-delete')?.addEventListener('click', () => deleteDialog.close());
  deleteDialog.addEventListener('close', resetDeleteDialog);

  function binDaysLeftLabel(expiresAt) {
    if (typeof window.IponPolicy?.formatBinExpiry === 'function') return window.IponPolicy.formatBinExpiry(expiresAt).text;
    const remainingMs = new Date(expiresAt).getTime() - Date.now();
    const days = Math.max(0, Math.ceil(remainingMs / 86400000));
    if (days <= 0) return 'Expires today';
    return `${days} day${days === 1 ? '' : 's'} left to recover`;
  }
  async function loadBin() {
    binCount.textContent = 'Loading deleted items…';
    binList.innerHTML = '<p class="empty-state">Loading deleted items…</p>';
    try {
      const result = await Ipon.rpc('get_bin_items', { p_type: binTypeFilter.value || null });
      const items = Array.isArray(result) ? result : [];
      binCount.textContent = `${items.length} recoverable item${items.length === 1 ? '' : 's'}`;
      binList.innerHTML = items.length ? items.map((item) => {
        if (typeof window.IponPolicy?.renderBinItemCard === 'function') return window.IponPolicy.renderBinItemCard(item, { canPurge: true });
        const typeClass = item.item_type === 'announcement' ? 'is-deduction' : 'is-addition';
        return `<article class="bin-item"><div class="bin-item-main"><div class="bin-item-top"><span class="record-type-pill ${typeClass}">${Ipon.escapeHtml(item.type_label || item.item_type)}</span><span class="bin-item-expiry">${Ipon.escapeHtml(binDaysLeftLabel(item.expires_at))}</span></div><strong>${Ipon.escapeHtml(item.title)}</strong>${item.subtitle ? `<p class="bin-item-subtitle">${Ipon.escapeHtml(item.subtitle)}</p>` : ''}<p class="bin-item-reason">Reason: ${Ipon.escapeHtml(item.reason || 'No reason provided')}</p><p class="bin-item-meta">Deleted by ${Ipon.escapeHtml(item.deleted_by_name || 'Group Administrator')} on ${Ipon.escapeHtml(Ipon.dateLabel(item.deleted_at))}</p></div><button class="button button-secondary" type="button" data-recover-type="${Ipon.escapeHtml(item.item_type)}" data-recover-id="${Ipon.escapeHtml(item.item_id)}" data-recover-label="${Ipon.escapeHtml(item.type_label || item.item_type)}" data-recover-title="${Ipon.escapeHtml(item.title)}">Recover</button></article>`;
      }).join('') : '<p class="empty-state">No binned items found within the 30-day recovery window.</p>';
    } catch (error) {
      binCount.textContent = 'Unable to load bin';
      binList.innerHTML = `<p class="empty-state">${Ipon.escapeHtml(Ipon.friendlyError(error))}</p>`;
    }
  }
  document.getElementById('see-bin')?.addEventListener('click', () => {
    binTypeFilter.value = '';
    binDialog.showModal();
    loadBin();
  });
  document.getElementById('close-bin-dialog')?.addEventListener('click', () => binDialog.close());
  binTypeFilter.addEventListener('change', loadBin);
  binList.addEventListener('click', async (event) => {
    const recoverBtn = event.target.closest('[data-recover-id]');
    if (recoverBtn) {
      const itemType = recoverBtn.dataset.recoverType;
      const itemId = recoverBtn.dataset.recoverId;
      const itemLabel = recoverBtn.dataset.recoverLabel || 'Item';
      const itemTitle = recoverBtn.dataset.recoverTitle || 'this item';
      const accepted = await Ipon.confirmAction({
        title: `Recover ${itemLabel.toLowerCase()}?`,
        message: itemType === 'savings_cycle'
          ? `"${itemTitle}" will restore all records, receipts, comments, and periods back into the active workspace.`
          : `"${itemTitle}" will be restored to active records.`,
        acceptLabel: 'Recover'
      });
      if (!accepted) return;
      Ipon.setBusy(recoverBtn, true, 'Recovering…');
      try {
        await Ipon.rpc('recover_bin_item', { p_item_type: itemType, p_item_id: itemId });
        Ipon.toast(`${itemLabel} recovered.`);
        await Promise.all([loadBin(), load()]);
      } catch (error) {
        await loadBin().catch(() => {});
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(recoverBtn, false);
      }
      return;
    }

    const purgeBtn = event.target.closest('[data-purge-id]');
    if (!purgeBtn) return;
    const itemType = purgeBtn.dataset.purgeType;
    const itemId = purgeBtn.dataset.purgeId;
    const itemLabel = purgeBtn.dataset.purgeLabel || 'Item';
    const itemTitle = purgeBtn.dataset.purgeTitle || 'this item';
    const accepted = await Ipon.confirmAction({
      title: `Permanently delete ${itemLabel.toLowerCase()}?`,
      message: `Delete "${itemTitle}" permanently from the database and cloud storage? This cannot be undone.`,
      acceptLabel: 'Delete forever'
    });
    if (!accepted) return;
    Ipon.setBusy(purgeBtn, true, 'Deleting…');
    try {
      await Ipon.rpc('purge_bin_item_permanently', { p_item_type: itemType, p_item_id: itemId });
      Ipon.toast(`${itemLabel} permanently deleted.`);
      await Promise.all([loadBin(), load()]);
    } catch (error) {
      await loadBin().catch(() => {});
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(purgeBtn, false);
    }
  });
  document.getElementById('add-member')?.addEventListener('click', () => { resetForm(); dialog.showModal(); firstName.focus(); });
  document.getElementById('cancel-edit')?.addEventListener('click', () => dialog.close());
  document.getElementById('close-member-dialog')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', resetForm);
  document.getElementById('close-member-account-dialog').addEventListener('click', () => accountDialog.close());
  document.getElementById('cancel-member-account').addEventListener('click', () => accountDialog.close());
  accountForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter; const member = members.find((item) => item.id === accountForm.elements.member_id.value); if (!member) return;
    const passwordIssue = Ipon.passwordIssue(accountForm.elements.password.value, [member.first_name, member.middle_name, member.last_name, accountForm.elements.email.value]);
    if (passwordIssue) { Ipon.setFieldError(accountForm.elements.password, passwordIssue); accountForm.elements.password.focus(); return; }
    const email = accountForm.elements.email.value.trim();
    const confirmed = await Ipon.confirmAction({
      title: 'Send member invitation?',
      message: `Are you sure you want to create an account and send an invitation email to ${email} for ${member.full_name}?`,
      acceptLabel: 'Send invitation'
    });
    if (!confirmed) return;
    Ipon.setBusy(button, true);
    try {
      const res = await Ipon.inviteAccount({ role: 'MEMBER', member_id: member.id, first_name: member.first_name, middle_name: member.middle_name || null, last_name: member.last_name, contact_number: member.contact_number || null, email, password: accountForm.elements.password.value });
      accountDialog.close();
      Ipon.toast(res.email_sent ? 'Member account created and invite email sent.' : 'Member account created.');
      if (!res.email_sent) Ipon.showInviteSummary({ title: 'Member sign-in credentials', results: [{ ok: true, email, ...res }] });
      await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  document.getElementById('close-member-history-dialog').addEventListener('click', () => historyDialog.close());
  permissionsSearch?.addEventListener('input', () => { permPage = 0; renderPermissions(); });
  permissionsRoleFilter?.addEventListener('change', () => { permPage = 0; renderPermissions(); });
  permissionsPager?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    permPage += button.dataset.page === 'next' ? 1 : -1;
    renderPermissions();
  });
  permissionsList?.addEventListener('click', (event) => {
    const editBtn = event.target.closest('[data-action="edit-permissions"]');
    if (!editBtn) return;
    openMemberPermissionsModal(editBtn.dataset.userId);
  });
  permGroupsWrap?.addEventListener('change', (event) => {
    const toggle = event.target.closest('[data-perm-toggle]');
    if (!toggle || !activePermDraft) return;
    activePermDraft = { ...activePermDraft, [toggle.dataset.permToggle]: toggle.checked };
    renderPermissionModalControls();
  });
  permPresetsWrap?.addEventListener('click', (event) => {
    const presetBtn = event.target.closest('[data-perm-preset]');
    if (!presetBtn || !activePermDraft) return;
    const mode = presetBtn.dataset.permPreset;
    activePermDraft = { ...activePermDraft, ...buildPresetPayload(mode, activePermDraft) };
    renderPermissionModalControls();
  });
  permForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!activePermUserId || !activePermDraft) return;
    const ok = await saveUserPermissions(activePermUserId, activePermDraft, permSaveBtn);
    if (ok) permDialog?.close();
  });
  document.getElementById('close-member-perm-dialog')?.addEventListener('click', () => permDialog?.close());
  document.getElementById('cancel-member-perm-dialog')?.addEventListener('click', () => permDialog?.close());
  permDialog?.addEventListener('click', (event) => {
    if (event.target === permDialog) permDialog.close();
  });
  permDialog?.addEventListener('close', () => {
    activePermUserId = '';
    activePermDraft = null;
  });

  search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { memberPage = 0; refresh(); }, 250); });
  statusFilter.addEventListener('change', () => { memberPage = 0; refresh(); });
  groupSelect?.addEventListener('change', async () => {
    const nextGroupId = groupSelect.value;
    if (!nextGroupId || nextGroupId === currentGroupId) return;
    groupSelect.disabled = true;
    try {
      await Ipon.switchActiveGroup(nextGroupId);
      memberPage = 0;
      permPage = 0;
      await Promise.all([loadContributionSettings(), load(), ...(binDialog.open ? [loadBin()] : [])]);
      Ipon.toast('Switched active savings group.');
    } catch (error) {
      groupSelect.value = currentGroupId;
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      groupSelect.disabled = false;
    }
  });
  pager.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    memberPage += button.dataset.page === 'next' ? 1 : -1;
    refresh();
  });
  try { await Promise.all([loadContributionSettings(), load()]); } catch (error) { Ipon.showInlineError(tbody, error, () => Promise.all([loadContributionSettings(), load()]), 8); } finally { Ipon.setLoading(false); }
  Ipon.consumeDeepLink(async (params) => {
    const memberId = params.get('member') || '';
    if (!memberId) return false;
    const safeId = CSS.escape ? CSS.escape(memberId) : memberId;
    let rowEl = tbody.querySelector(`[data-id="${safeId}"]`)?.closest('tr') || null;
    if (!rowEl && (search.value || statusFilter.value)) {
      search.value = '';
      statusFilter.value = '';
      memberPage = 0;
      await load();
      rowEl = tbody.querySelector(`[data-id="${safeId}"]`)?.closest('tr') || null;
    }
    if (!rowEl) {
      const { data: ordered } = await Ipon.client.from('members').select('id').is('deleted_at', null).order('full_name');
      const idx = (ordered || []).findIndex((m) => String(m.id) === String(memberId));
      if (idx >= 0) {
        memberPage = Math.floor(idx / pageSize);
        await load();
        rowEl = tbody.querySelector(`[data-id="${safeId}"]`)?.closest('tr') || null;
      }
    }
    if (rowEl) {
      Ipon.highlightFocus(rowEl);
      return true;
    }
    return false;
  });
  Ipon.subscribeToChanges('members', ['members', 'profiles', 'groups', 'group_memberships', 'contribution_settings', 'contributions', 'announcements'], () => Promise.all([loadContributionSettings(), refresh(), ...(binDialog.open ? [loadBin()] : [])]));
})();
