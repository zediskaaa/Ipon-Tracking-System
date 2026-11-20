(async function () {
  'use strict';
  const page = document.body.dataset.page;
  const form = document.getElementById('record-form');
  const tbody = document.getElementById('records-body');
  const contributionEntriesBody = document.getElementById('contribution-entries-body');
  const statusFilter = document.getElementById('record-status-filter');
  const methodFilter = document.getElementById('record-method-filter');
  const memberFilter = document.getElementById('record-member-filter');
  const spotlightCard = document.getElementById('member-spotlight');
  const spotlightClear = document.getElementById('member-spotlight-clear');
  const pager = document.getElementById('record-pager');
  const pageSize = 25;
  let historyPage = 0;
  let selectedMemberId = new URLSearchParams(window.location.search).get('member') || '';
  let selectedMemberName = '';
  let spotlightChart = null;
  window.addEventListener('ipon:themechange', () => {
    if (!spotlightChart) return;
    const themeOpts = Ipon.chartThemeOptions?.();
    if (!themeOpts) return;
    if (spotlightChart.data?.datasets?.[0]) spotlightChart.data.datasets[0].backgroundColor = themeOpts.additionColor;
    if (spotlightChart.data?.datasets?.[1]) spotlightChart.data.datasets[1].backgroundColor = themeOpts.deductionColor;
    if (spotlightChart.options?.scales?.x?.ticks) spotlightChart.options.scales.x.ticks.color = themeOpts.textColor;
    if (spotlightChart.options?.scales?.y) {
      spotlightChart.options.scales.y.grid.color = themeOpts.gridColor;
      spotlightChart.options.scales.y.border.color = themeOpts.gridColor;
      spotlightChart.options.scales.y.ticks.color = themeOpts.textColor;
    }
    if (spotlightChart.options?.plugins?.tooltip) {
      Object.assign(spotlightChart.options.plugins.tooltip, {
        backgroundColor: themeOpts.tooltipBg,
        borderColor: themeOpts.tooltipBorder,
        titleColor: themeOpts.tooltipTitleColor,
        bodyColor: themeOpts.tooltipBodyColor
      });
    }
    spotlightChart.update('none');
  });
  let commentCounts = new Map();
  const receiptPicker = Ipon.bindReceiptPicker({
    input: document.getElementById('record-receipt-input'),
    dropzone: document.getElementById('record-receipt-dropzone'),
    emptyBox: document.getElementById('record-receipt-empty'),
    preview: document.getElementById('record-receipt-preview'),
    thumb: document.getElementById('record-receipt-thumb'),
    nameEl: document.getElementById('record-receipt-name'),
    clearBtn: document.getElementById('record-receipt-clear')
  });

  const state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || state.redirecting) return;
  if (!state.configured || !state.profile) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state">Connect Supabase to load records.</td></tr>`;
    setDefaults();
    Ipon.setLoading(false);
    return;
  }
  const perms = state.profile.permissions || Ipon.defaultPermissionsForRole(state.profile.role);
  const canRecordExpenses = state.profile.role === 'ADMIN' || perms.can_record_expenses === true;
  const canRecordWithdrawals = state.profile.role === 'ADMIN' || perms.can_record_withdrawals === true;
  const formPanel = form?.closest('.panel');
  formPanel?.removeAttribute('data-role');
  if (!state.profile.group_id) {
    Ipon.renderGroupRequiredCard(formPanel, { hasGroup: false });
  } else if (page === 'expenses' && !canRecordExpenses) {
    if (formPanel) {
      formPanel.hidden = false;
      formPanel.innerHTML = `<div class="empty-state">${state.profile.role === 'TREASURER'
        ? 'Your administrator has restricted expense recording for your account. You can still review the group expense history here.'
        : 'Only administrators and treasurers can record expenses unless granted permission by your admin. You can review the group history here.'}</div>`;
    }
  } else if (page === 'withdrawals' && !canRecordWithdrawals) {
    if (formPanel) {
      formPanel.hidden = false;
      formPanel.innerHTML = `<div class="empty-state">${state.profile.role === 'TREASURER'
        ? 'Your administrator has restricted deduction recording for your account. You can still review the group deduction history here.'
        : 'Only administrators and treasurers can record deductions unless granted permission by your admin. You can review the group history here.'}</div>`;
    }
  } else if ((page === 'expenses' || page === 'withdrawals') && formPanel) {
    formPanel.hidden = false;
  } else if (page === 'contributions' && state.profile.role === 'MEMBER' && !state.profile.member_id) {
    Ipon.renderGroupRequiredCard(formPanel, { hasGroup: true });
  }
  setDefaults();

  function setDefaults() {
    const today = Ipon.isoDate();
    document.querySelectorAll('input[type="date"]').forEach((input) => { if (!input.value) input.value = today; });
    const monthInput = document.getElementById('contribution-month');
    if (monthInput && !monthInput.value) monthInput.value = today.slice(0, 7);
  }

  let membersList = [];
  const profilesByUserId = new Map();
  const profilesByMemberId = new Map();
  const profilesByName = new Map();
  const statusRowsByMonth = new Map();
  let pendingSubmissionKey = null;
  let recordRows = [];

  if (methodFilter) {
    methodFilter.innerHTML = Ipon.paymentMethodOptionsHtml({ includeAll: true, includeUntagged: true });
    Ipon.enhancePaymentSelect?.(methodFilter, { compact: true });
  }
  document.body.insertAdjacentHTML('beforeend', `<dialog class="form-dialog" id="record-edit-dialog" aria-labelledby="record-edit-title"><div class="form-dialog-sheet"><header class="form-dialog-header"><div><h2 id="record-edit-title">Edit pending record</h2><p>Only pending records can be corrected. Confirmed records must be voided and replaced.</p></div><button class="dialog-close" id="record-edit-close" type="button" aria-label="Close edit form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><form id="record-edit-form" class="form-grid"><input type="hidden" name="record_id"><div class="field"><label for="edit-date">Date</label><input id="edit-date" name="date" type="date" min="2000-01-01" data-max-today required></div><div class="field"><label for="edit-amount">Amount</label><input id="edit-amount" name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" required></div><div class="field transaction-edit-field"><label for="edit-category">Category</label><input id="edit-category" name="category" maxlength="80" data-category-presets="${page === 'withdrawals' ? 'deduction' : 'expense'}"></div><div class="field transaction-edit-field"><label for="edit-responsible">Person responsible</label><select id="edit-responsible" name="person_responsible"><option value="">Select member</option></select></div><div class="field field-wide transaction-edit-field"><label for="edit-description">Description</label><textarea id="edit-description" name="description" maxlength="500"></textarea></div><div class="field"><label for="edit-payment-method">${page === 'contributions' ? 'Payment method' : 'Paid from wallet'}</label><select id="edit-payment-method" name="payment_method"><option value="">Untagged (legacy)</option>${Ipon.paymentMethodOptionsHtml()}</select></div><div class="field"><label for="edit-reference">Reference</label><input id="edit-reference" name="reference" maxlength="100"></div><div class="field field-wide"><label for="edit-notes">Notes</label><textarea id="edit-notes" name="notes" maxlength="1000"></textarea></div><div class="form-actions field-wide"><button class="button button-secondary" id="record-edit-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save correction</button></div></form></div></dialog>`);
  document.body.insertAdjacentHTML('beforeend', `<dialog class="form-dialog compact-detail-dialog" id="record-detail-dialog" aria-labelledby="record-detail-title"><div class="form-dialog-sheet"><header class="form-dialog-header"><div><span class="compact-detail-eyebrow">Record history</span><h2 id="record-detail-title">Record details</h2><p id="record-detail-subtitle"></p></div><button class="dialog-close" id="record-detail-close" type="button" aria-label="Close record details"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><dl class="compact-detail-grid" id="record-detail-fields"></dl><div class="compact-detail-actions" id="record-detail-actions"></div></div></dialog>`);
  const editDialog = document.getElementById('record-edit-dialog');
  const detailDialog = document.getElementById('record-detail-dialog');
  const detailFields = document.getElementById('record-detail-fields');
  const detailActions = document.getElementById('record-detail-actions');
  const editForm = document.getElementById('record-edit-form');
  Ipon.enhancePaymentSelect?.(editForm?.elements?.payment_method);
  Ipon.prepareNumericInputs();
  editDialog.querySelectorAll('.transaction-edit-field').forEach((field) => { field.hidden = page === 'contributions'; field.querySelector('input,select,textarea').required = page !== 'contributions'; });
  Ipon.setCategoryPresetGroup(editForm.elements.category, page === 'withdrawals' ? 'deduction' : 'expense', { required: page !== 'contributions' });
  const editDirty = Ipon.bindDirtySaveForm?.(editForm, editForm?.querySelector('[type="submit"]'));

  function statusBadge(status) {
    const statusClass = String(status).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `<span class="status status-${statusClass}">${Ipon.escapeHtml(status)}</span>`;
  }

  function reasonNoteHtml(row) {
    const text = row.void_reason || row.review_note;
    if (!text) return '';
    const label = row.approval_status === 'VOIDED'
      ? 'Void reason'
      : row.approval_status === 'REJECTED'
        ? 'Rejection reason'
        : 'Review note';
    const tone = row.approval_status === 'CONFIRMED' ? ' is-confirmed' : ' is-rejected';
    return `<small class="record-reason-note${tone}">${label}: ${Ipon.escapeHtml(text)}</small>`;
  }

  function updatePager(count = 0) {
    if (!pager) return;
    const pages = Math.max(1, Math.ceil(count / pageSize));
    pager.querySelector('span').textContent = `Page ${historyPage + 1} of ${pages} · ${count} record${count === 1 ? '' : 's'}`;
    pager.querySelector('[data-page="previous"]').disabled = historyPage === 0;
    pager.querySelector('[data-page="next"]').disabled = historyPage >= pages - 1;
  }

  function updateTabLinksWithMember() {
    const tabs = document.querySelectorAll('.record-tabs a');
    tabs.forEach((tab) => {
      const href = tab.getAttribute('href');
      if (!href) return;
      const targetBase = href.split('?')[0];
      tab.setAttribute('href', selectedMemberId ? `${targetBase}?member=${encodeURIComponent(selectedMemberId)}` : targetBase);
    });
    const currentUrl = new URL(window.location.href);
    if (selectedMemberId) currentUrl.searchParams.set('member', selectedMemberId);
    else currentUrl.searchParams.delete('member');
    window.history.replaceState(null, '', currentUrl.toString());
  }

  async function resolveMemberMonthStatus(memberId, monthValue) {
    if (!memberId || !monthValue) return { statusRow: null, fallbackMonthlyAmount: 0 };
    const periodMonth = `${monthValue}-01`;
    const cacheKey = `${memberId}:${periodMonth}`;
    let statusRow = statusRowsByMonth.get(cacheKey);
    if (statusRow === undefined) {
      const { data, error } = await Ipon.client
        .from('v_contribution_status')
        .select('member_id,period_month,required_amount,paid_amount,outstanding_amount,payment_status,is_exempt')
        .eq('member_id', memberId)
        .eq('period_month', periodMonth)
        .maybeSingle();
      statusRow = !error && data ? data : null;
      statusRowsByMonth.set(cacheKey, statusRow);
    }
    const member = membersList.find((m) => m.id === memberId);
    return { statusRow, fallbackMonthlyAmount: Number(member?.monthly_contribution_amount || 0) };
  }

  const syncExcessToggle = page === 'contributions'
    ? Ipon.bindExcessContributionToggle({
      amountInput: document.getElementById('amount'),
      checkbox: document.getElementById('allocate-excess'),
      field: document.getElementById('allocate-excess-field'),
      getContext: () => resolveMemberMonthStatus(
        document.getElementById('member-id')?.value,
        document.getElementById('contribution-month')?.value
      )
    })
    : async () => {};

  async function syncSuggestedAmount() {
    if (page !== 'contributions') return;
    const memberSelect = document.getElementById('member-id');
    const monthInput = document.getElementById('contribution-month');
    const amountInput = document.getElementById('amount');
    if (!memberSelect || !monthInput || !amountInput) return;

    const { statusRow, fallbackMonthlyAmount } = await resolveMemberMonthStatus(memberSelect.value, monthInput.value);
    if (statusRow) {
      const outstanding = Number(statusRow.outstanding_amount || 0);
      amountInput.value = outstanding > 0 && statusRow.payment_status !== 'PAID' && statusRow.payment_status !== 'OVERPAID'
        ? outstanding.toFixed(2)
        : '';
    } else if (memberSelect.value && monthInput.value) {
      amountInput.value = fallbackMonthlyAmount > 0 ? fallbackMonthlyAmount.toFixed(2) : '';
    } else {
      amountInput.value = '';
    }
    await syncExcessToggle();
  }

  function syncResponsiblePayoutBox(syncMethod = true) {
    const destBox = document.getElementById('record-payout-destination');
    const responsibleSelect = document.getElementById('responsible');
    if (!destBox || page !== 'withdrawals') return;
    const selectedName = responsibleSelect?.value || '';
    const member = selectedName ? membersList.find((item) => item.full_name === selectedName) : null;
    Ipon.renderPayoutDestinationBox(destBox, member, { autoSyncMethodForm: syncMethod ? form : null });
  }

  function populateResponsibleSelect(select, selectedName = '') {
    if (!select) return;
    const names = membersList.map((member) => member.full_name).filter(Boolean);
    if (selectedName && !names.includes(selectedName)) names.unshift(selectedName);
    select.innerHTML = names.length
      ? `<option value="">Select member</option>${names.map((name) => {
        const avatarUrl = Ipon.getMemberAvatar(name) || '';
        return `<option value="${Ipon.escapeHtml(name)}" data-avatar="${Ipon.escapeHtml(avatarUrl)}" ${selectedName === name ? 'selected' : ''}>${Ipon.escapeHtml(name)}</option>`;
      }).join('')}`
      : '<option value="">No active member profile found</option>';
  }

  async function loadMembers() {
    const select = document.getElementById('member-id');
    const responsibleSelect = document.getElementById('responsible');
    const editResponsibleSelect = document.getElementById('edit-responsible');
    if (!select && !responsibleSelect && !editResponsibleSelect && !memberFilter) return;
    const { data, error } = await Ipon.client.from('members').select('id,full_name,monthly_contribution_amount,payout_channel,payout_account_number,payout_account_name').eq('status', 'ACTIVE').eq('activation_status', 'ACTIVE').is('deleted_at', null).order('full_name');
    if (error) throw error;
    membersList = data || [];

    let identRes = null;
    try {
      identRes = await Ipon.client.rpc('get_group_member_identities');
    } catch (_) { }
    const { data: groupProfiles } = (identRes && !identRes.error && Array.isArray(identRes.data))
      ? identRes
      : await Ipon.client.from('profiles').select('id,member_id,full_name,avatar_url').eq('status', 'ACTIVE');
    profilesByUserId.clear();
    profilesByMemberId.clear();
    profilesByName.clear();
    (groupProfiles || []).forEach((profile) => {
      profilesByUserId.set(profile.id, profile);
      if (profile.member_id) profilesByMemberId.set(profile.member_id, profile);
      if (profile.full_name) profilesByName.set(profile.full_name.trim().toLowerCase(), profile);
    });
    Ipon.registerMemberAvatars(groupProfiles || []);
    membersList.forEach((m) => {
      const prof = profilesByMemberId.get(m.id) || profilesByName.get((m.full_name || '').trim().toLowerCase());
      if (prof?.avatar_url) m.avatar_url = prof.avatar_url;
      if (prof?.id) m.user_id = prof.id;
    });
    Ipon.registerMemberAvatars(membersList);

    if (memberFilter) {
      const matched = membersList.find((m) => m.id === selectedMemberId || m.full_name === selectedMemberId);
      if (matched) {
        selectedMemberId = matched.id;
        selectedMemberName = matched.full_name;
      } else {
        selectedMemberId = '';
        selectedMemberName = '';
      }
      memberFilter.innerHTML = `<option value="">All members</option>${membersList.map((m) => `<option value="${m.id}" data-avatar="${Ipon.escapeHtml(m.avatar_url || '')}" ${selectedMemberId === m.id ? 'selected' : ''}>${Ipon.escapeHtml(m.full_name)}</option>`).join('')}`;
      updateTabLinksWithMember();
      Ipon.enhanceMemberSelect(memberFilter);
    }

    const isSoloMode = state.profile?.workspace_mode === 'SOLO';
    if (select) {
      const currentSelection = select.value;
      const ownId = state.profile.member_id || (isSoloMode ? (membersList[0]?.id || '') : '');
      const selectedId = currentSelection || (selectedMemberId && membersList.some((m) => m.id === selectedMemberId) ? selectedMemberId : ownId || '');
      select.innerHTML = membersList.length
        ? `<option value="">Select member</option>${membersList.map((member) => `<option value="${member.id}" data-avatar="${Ipon.escapeHtml(member.avatar_url || '')}" ${selectedId === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}`
        : '<option value="">No active member profile found</option>';
      if (state.profile.role === 'MEMBER' || (isSoloMode && selectedId)) {
        select.closest('.field').hidden = true;
        select.required = false;
      }
      Ipon.enhanceMemberSelect(select);
    }
    if (responsibleSelect) {
      const ownMember = membersList.find((member) => member.id === state.profile.member_id) || (isSoloMode ? membersList[0] : null);
      const defaultResponsible = responsibleSelect.value || (selectedMemberName || ownMember?.full_name || '');
      populateResponsibleSelect(responsibleSelect, defaultResponsible);
      if (state.profile.role === 'MEMBER' || (isSoloMode && ownMember)) {
        responsibleSelect.closest('.field').hidden = true;
        responsibleSelect.required = false;
      }
      Ipon.enhanceMemberSelect(responsibleSelect);
      syncResponsiblePayoutBox(false);
    }
    if (editResponsibleSelect) {
      populateResponsibleSelect(editResponsibleSelect, editResponsibleSelect.value);
      Ipon.enhanceMemberSelect(editResponsibleSelect);
    }
  }

  async function renderMemberSpotlight() {
    if (!spotlightCard) return;
    if (!selectedMemberId && !selectedMemberName) {
      spotlightCard.hidden = true;
      if (spotlightChart) {
        spotlightChart.destroy();
        spotlightChart = null;
      }
      return;
    }
    const member = membersList.find((m) => m.id === selectedMemberId || m.full_name === selectedMemberName) || { id: selectedMemberId, full_name: selectedMemberName };
    const safeName = member.full_name || 'Member';
    const safeMemberId = member.id || '';

    let avatarUrl = profilesByMemberId.get(safeMemberId)?.avatar_url
      || profilesByName.get(safeName.trim().toLowerCase())?.avatar_url
      || '';
    if (!avatarUrl && safeMemberId) {
      try {
        const { data: rpcAvatar } = await Ipon.rpc('group_member_avatar', { p_member_id: safeMemberId });
        if (rpcAvatar) avatarUrl = rpcAvatar;
      } catch (_) {}
    }

    const memberUserId = profilesByMemberId.get(safeMemberId)?.id
      || profilesByName.get(safeName.trim().toLowerCase())?.id
      || null;

    const avatarEl = document.getElementById('member-spotlight-avatar');
    if (avatarEl) {
      avatarEl.innerHTML = Ipon.avatarMarkup(avatarUrl, safeName, 'avatar-lg', memberUserId);
      Ipon.bindAvatarFallbacks(avatarEl);
      Ipon.syncPresenceDots(avatarEl);
    }
    const nameEl = document.getElementById('member-spotlight-name');
    if (nameEl) nameEl.textContent = safeName;
    const badgeEl = document.getElementById('member-spotlight-badge');
    if (badgeEl) {
      const pledge = Number(member.monthly_contribution_amount || 0);
      badgeEl.textContent = pledge > 0 ? `Pledge: ${Ipon.money(pledge)}/mo` : 'Active member';
    }
    const badgesWrap = badgeEl?.parentElement;
    if (badgesWrap) {
      let payoutWrap = document.getElementById('member-spotlight-payout');
      if (!payoutWrap) {
        payoutWrap = document.createElement('div');
        payoutWrap.id = 'member-spotlight-payout';
        payoutWrap.className = 'member-spotlight-payout';
        badgesWrap.appendChild(payoutWrap);
      }
      const payoutHtml = Ipon.payoutSummaryChip(member, { compact: true, showCopy: true });
      payoutWrap.innerHTML = payoutHtml;
      payoutWrap.hidden = !payoutHtml;
    }

    let totalAdditions = 0;
    let totalDeductions = 0;
    let totalExpenses = 0;
    const monthlyStats = new Map();

    try {
      const [contribRes, archivedRes, withRes, expRes] = await Promise.all([
        safeMemberId
          ? Ipon.client.from('contributions')
              .select('amount,payment_date,approval_status,contribution_periods!inner(period_month,member_id)')
              .eq('approval_status', 'CONFIRMED')
              .eq('contribution_periods.member_id', safeMemberId)
          : Promise.resolve({ data: [] }),
        safeMemberId
          ? Ipon.client.from('contribution_periods')
              .select('period_month,archived_paid_amount')
              .eq('member_id', safeMemberId)
              .gt('archived_paid_amount', 0)
          : Promise.resolve({ data: [] }),
        Ipon.client.from('withdrawals')
          .select('amount,transaction_date,approval_status')
          .eq('approval_status', 'CONFIRMED')
          .eq('person_responsible', safeName),
        Ipon.client.from('expenses')
          .select('amount,transaction_date,approval_status')
          .eq('approval_status', 'CONFIRMED')
          .eq('person_responsible', safeName)
      ]);

      (contribRes.data || []).forEach((c) => {
        const amt = Number(c.amount || 0);
        totalAdditions += amt;
        const month = (c.contribution_periods?.period_month || c.payment_date || '').slice(0, 7);
        if (month) {
          const prev = monthlyStats.get(month) || { additions: 0, deductions: 0 };
          prev.additions += amt;
          monthlyStats.set(month, prev);
        }
      });

      (archivedRes.data || []).forEach((cp) => {
        const amt = Number(cp.archived_paid_amount || 0);
        if (!(amt > 0)) return;
        totalAdditions += amt;
        const month = (cp.period_month || '').slice(0, 7);
        if (month) {
          const prev = monthlyStats.get(month) || { additions: 0, deductions: 0 };
          prev.additions += amt;
          monthlyStats.set(month, prev);
        }
      });

      (withRes.data || []).forEach((w) => {
        const amt = Number(w.amount || 0);
        totalDeductions += amt;
        const month = (w.transaction_date || '').slice(0, 7);
        if (month) {
          const prev = monthlyStats.get(month) || { additions: 0, deductions: 0 };
          prev.deductions += amt;
          monthlyStats.set(month, prev);
        }
      });

      (expRes.data || []).forEach((e) => {
        const amt = Number(e.amount || 0);
        totalExpenses += amt;
        const month = (e.transaction_date || '').slice(0, 7);
        if (month) {
          const prev = monthlyStats.get(month) || { additions: 0, deductions: 0 };
          prev.deductions += amt;
          monthlyStats.set(month, prev);
        }
      });
    } catch (_) {}

    const netStanding = totalAdditions - totalDeductions - totalExpenses;

    const statAdd = document.getElementById('member-stat-contributed');
    if (statAdd) statAdd.textContent = Ipon.money(totalAdditions);
    const statWith = document.getElementById('member-stat-deductions');
    if (statWith) statWith.textContent = Ipon.money(totalDeductions);
    const statExp = document.getElementById('member-stat-expenses');
    if (statExp) statExp.textContent = Ipon.money(totalExpenses);
    const statNet = document.getElementById('member-stat-net');
    if (statNet) statNet.textContent = Ipon.money(netStanding);

    const canvas = document.getElementById('member-spotlight-chart');
    const emptyBox = document.getElementById('member-spotlight-chart-empty');
    if (spotlightChart) {
      spotlightChart.destroy();
      spotlightChart = null;
    }

    const months = [...monthlyStats.keys()].sort();
    if (canvas && emptyBox) {
      if (!months.length) {
        canvas.hidden = true;
        emptyBox.hidden = false;
      } else {
        canvas.hidden = false;
        emptyBox.hidden = true;
        if (window.Chart) {
          const labels = months.map((m) => Ipon.dateLabel(`${m}-01`, { month: 'short', year: 'numeric' }));
          const addData = months.map((m) => monthlyStats.get(m).additions);
          const dedData = months.map((m) => monthlyStats.get(m).deductions);
          const themeOpts = Ipon.chartThemeOptions?.() || {
            additionColor: '#287a4c',
            deductionColor: '#ae3934',
            textColor: '#324841',
            gridColor: 'rgba(20, 45, 43, 0.1)',
            tooltipBg: '#142d2b',
            tooltipBorder: 'rgba(255, 255, 255, 0.14)',
            tooltipTitleColor: '#f5eadb',
            tooltipBodyColor: '#e5efe9'
          };
          spotlightChart = new window.Chart(canvas, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                {
                  label: 'Additions',
                  data: addData,
                  backgroundColor: themeOpts.additionColor,
                  borderRadius: 5,
                  maxBarThickness: 32
                },
                {
                  label: 'Deductions & Expenses',
                  data: dedData,
                  backgroundColor: themeOpts.deductionColor,
                  borderRadius: 5,
                  maxBarThickness: 32
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: {
                  backgroundColor: themeOpts.tooltipBg,
                  borderColor: themeOpts.tooltipBorder,
                  borderWidth: 1,
                  titleColor: themeOpts.tooltipTitleColor,
                  bodyColor: themeOpts.tooltipBodyColor,
                  callbacks: {
                    label: (context) => ` ${context.dataset.label}: ${Ipon.money(context.raw)}`
                  }
                }
              },
              scales: {
                x: {
                  grid: { display: false },
                  ticks: { color: themeOpts.textColor }
                },
                y: {
                  beginAtZero: true,
                  grid: { color: themeOpts.gridColor },
                  border: { color: themeOpts.gridColor },
                  ticks: {
                    color: themeOpts.textColor,
                    precision: 0,
                    callback: (val) => `₱${Number(val).toLocaleString('en-PH')}`
                  }
                }
              }
            }
          });
        }
      }
    }

    spotlightCard.hidden = false;
  }

  async function loadContributions(preserveAmount = false) {
    const month = document.getElementById('status-month');
    if (!month.options.length) {
      const now = new Date();
      for (let offset = -5; offset <= 1; offset += 1) {
        const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const value = Ipon.monthStart(date);
        month.insertAdjacentHTML('beforeend', `<option value="${value}" ${offset === 0 ? 'selected' : ''}>${Ipon.dateLabel(value, { month: 'long', year: 'numeric' })}</option>`);
      }
      month.addEventListener('change', () => load());
    }
    statusRowsByMonth.clear();
    let statusQuery = Ipon.client.from('v_contribution_status').select('*').eq('period_month', month.value);
    if (selectedMemberId) statusQuery = statusQuery.eq('member_id', selectedMemberId);
    const { data, error } = await statusQuery.order('member_name');
    if (error) throw error;
    (data || []).forEach((row) => {
      statusRowsByMonth.set(`${row.member_id}:${row.period_month}`, row);
    });
    tbody.innerHTML = data.length ? data.map((row) => {
      const canToggleExempt = state.profile.role === 'ADMIN' && ['UNPAID', 'PARTIALLY PAID', 'EXEMPT'].includes(row.payment_status);
      const exemptBtn = canToggleExempt
        ? ` <button class="icon-action" type="button" data-exempt-member="${row.member_id}" data-exempt-month="${row.period_month}" data-exempt-state="${row.is_exempt ? '1' : '0'}" title="${Ipon.escapeHtml(row.exempt_reason || 'Toggle exemption for this month')}">${row.is_exempt ? 'Remove exempt' : 'Exempt'}</button>`
        : '';
      return `<tr><td>${Ipon.escapeHtml(row.member_name)}${Ipon.verifiedBadgesHtml?.(row.member_id || row.member_name) || ''}</td><td>${Ipon.dateLabel(row.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.required_amount)}</td><td>${Ipon.money(row.paid_amount)}</td><td>${Ipon.money(row.outstanding_amount)}</td><td>${statusBadge(row.payment_status)}${exemptBtn}</td></tr>`;
    }).join('') : `<tr><td colspan="6" class="empty-state">${selectedMemberName ? `No contribution status found for ${Ipon.escapeHtml(selectedMemberName)} in this month.` : 'No contribution periods for this month.'}</td></tr>`;

    let entriesQuery = Ipon.client.from('contributions')
      .select('id,amount,payment_date,transaction_reference,payment_method,notes,receipt_url,approval_status,void_reason,review_note,submitted_by,contribution_periods!inner(period_month,members!inner(id,full_name))', { count: 'exact' });
    if (statusFilter?.value) entriesQuery = entriesQuery.eq('approval_status', statusFilter.value);
    if (methodFilter?.value === 'UNTAGGED') entriesQuery = entriesQuery.is('payment_method', null);
    else if (methodFilter?.value) entriesQuery = entriesQuery.eq('payment_method', methodFilter.value);
    if (selectedMemberId) entriesQuery = entriesQuery.eq('contribution_periods.member_id', selectedMemberId);
    const { data: entries, count, error: entriesError } = await entriesQuery
      .order('payment_date', { ascending: false }).range(historyPage * pageSize, (historyPage + 1) * pageSize - 1);
    if (entriesError) throw entriesError;
    recordRows = entries || [];
    commentCounts = await Ipon.getRecordCommentCounts('contribution', recordRows.map((entry) => entry.id));
    updatePager(count);
    const isAdmin = state.profile.role === 'ADMIN';
    const hasPending = isAdmin && entries.some((entry) => entry.approval_status === 'PENDING');
    const bulkBar = document.getElementById('bulk-confirm-bar');
    const bulkSelectAll = document.getElementById('bulk-select-all');
    if (bulkBar) bulkBar.hidden = !hasPending;
    if (bulkSelectAll) bulkSelectAll.checked = false;
    contributionEntriesBody.innerHTML = entries.length ? entries.map((entry) => {
      const isCancelled = entry.approval_status === 'VOIDED' || entry.approval_status === 'REJECTED';
      const bulkBox = isAdmin && entry.approval_status === 'PENDING'
        ? `<input type="checkbox" class="bulk-entry-check" value="${entry.id}" aria-label="Select pending addition"> `
        : '';
      return `<tr class="compact-history-row ${isCancelled ? 'row-voided' : ''}"><td>${bulkBox}${Ipon.dateLabel(entry.payment_date)}</td><td>${Ipon.escapeHtml(entry.contribution_periods.members.full_name)}${Ipon.verifiedBadgesHtml?.(entry.contribution_periods.members.id || entry.contribution_periods.members.full_name) || ''}${reasonNoteHtml(entry)}</td><td>${Ipon.dateLabel(entry.contribution_periods.period_month, { month: 'short', year: 'numeric' })}</td><td>${Ipon.paymentMethodBadge(entry.payment_method)}</td><td class="amount-cell">${Ipon.money(entry.amount)}</td><td>${statusBadge(entry.approval_status)}</td><td>${actionButtons(entry)}</td><td class="compact-row-summary"><div class="compact-summary-head"><strong>${Ipon.escapeHtml(entry.contribution_periods.members.full_name)}${Ipon.verifiedBadgesHtml?.(entry.contribution_periods.members.id || entry.contribution_periods.members.full_name) || ''}</strong><b>${Ipon.money(entry.amount)}</b></div><div class="compact-summary-meta"><span>${Ipon.dateLabel(entry.payment_date)} · ${Ipon.dateLabel(entry.contribution_periods.period_month, { month: 'short', year: 'numeric' })}</span>${statusBadge(entry.approval_status)}</div><div class="compact-summary-footer">${bulkBox ? `<button class="compact-bulk-toggle" type="button" data-bulk-toggle="${entry.id}" aria-pressed="false">Select for review</button>` : ''}<button class="compact-detail-trigger" type="button" data-action="details" data-id="${entry.id}" aria-label="View addition details for ${Ipon.escapeHtml(entry.contribution_periods.members.full_name)}">View details <span aria-hidden="true">↗</span></button></div></td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty-state">${selectedMemberName ? `No additions found for ${Ipon.escapeHtml(selectedMemberName)}.` : 'No additions matching this filter yet.'}</td></tr>`;
    updateBulkSelectionUi();
    if (!preserveAmount) await syncSuggestedAmount();
    else await syncExcessToggle();
  }

  function updateBulkSelectionUi() {
    const checkboxes = [...(contributionEntriesBody?.querySelectorAll('.bulk-entry-check') || [])];
    const selected = checkboxes.filter((box) => box.checked);
    const countEl = document.getElementById('bulk-selected-count');
    const confirmBtn = document.getElementById('bulk-confirm-selected');
    const selectAll = document.getElementById('bulk-select-all');
    if (countEl) countEl.textContent = String(selected.length);
    if (confirmBtn) confirmBtn.disabled = selected.length === 0;
    if (selectAll) selectAll.checked = checkboxes.length > 0 && selected.length === checkboxes.length;
    contributionEntriesBody?.querySelectorAll('[data-bulk-toggle]').forEach((button) => {
      const checked = checkboxes.some((box) => box.value === button.dataset.bulkToggle && box.checked);
      button.setAttribute('aria-pressed', String(checked));
      button.textContent = checked ? 'Selected for review' : 'Select for review';
    });
  }

  function openRecordDetails(button) {
    const cells = [...button.closest('tr').querySelectorAll('td:not(.compact-row-summary)')];
    const record = recordRows.find((item) => String(item.id) === button.dataset.id);
    const labels = page === 'contributions'
      ? ['Date', 'Member', 'Month', 'Method', 'Amount', 'Status']
      : ['Date', 'Category', 'Description', 'Person responsible', 'Method', 'Amount', 'Status'];
    detailFields.innerHTML = labels.map((label, index) => {
      const cell = cells[index].cloneNode(true);
      cell.querySelectorAll('input[type="checkbox"]').forEach((input) => input.remove());
      return `<div class="compact-detail-field"><dt>${label}</dt><dd>${cell.innerHTML}</dd></div>`;
    }).join('')
      + (record?.transaction_reference || record?.reference_number ? `<div class="compact-detail-field"><dt>Reference</dt><dd>${Ipon.escapeHtml(record.transaction_reference || record.reference_number)}</dd></div>` : '')
      + (record?.notes ? `<div class="compact-detail-field"><dt>Notes</dt><dd>${Ipon.escapeHtml(record.notes)}</dd></div>` : '');
    detailActions.innerHTML = cells.at(-1).querySelector('.table-actions')?.innerHTML || '';
    detailActions.hidden = !detailActions.innerHTML;
    document.getElementById('record-detail-title').textContent = page === 'contributions' ? 'Addition details' : page === 'withdrawals' ? 'Deduction details' : 'Expense details';
    document.getElementById('record-detail-subtitle').textContent = cells[1].textContent.trim();
    detailDialog.showModal();
  }

  function actionButtons(row) {
    const receiptBtn = row.receipt_url ? `<button class="icon-action receipt-pill-btn" data-action="receipt" data-id="${row.id}">Receipt</button>` : '';
    const discussBtn = Ipon.recordDiscussionButtonHtml(row, commentCounts.get(row.id) || 0);
    if (state.profile.role !== 'ADMIN') {
      return (receiptBtn || discussBtn) ? `<div class="table-actions">${receiptBtn}${discussBtn}</div>` : '';
    }
    if (row.approval_status === 'PENDING') return `<div class="table-actions">${receiptBtn}${discussBtn}<button class="icon-action" data-action="edit" data-id="${row.id}">Edit</button><button class="icon-action" data-action="confirm" data-id="${row.id}">Confirm</button><button class="icon-action" data-action="reject" data-id="${row.id}">Reject</button></div>`;
    if (row.approval_status === 'CONFIRMED') return `<div class="table-actions">${receiptBtn}${discussBtn}<button class="icon-action" data-action="void" data-id="${row.id}">Void</button></div>`;
    return (receiptBtn || discussBtn) ? `<div class="table-actions">${receiptBtn}${discussBtn}</div>` : '';
  }

  async function loadTransactions() {
    let query = Ipon.client.from(page).select('*', { count: 'exact' });
    if (statusFilter?.value) query = query.eq('approval_status', statusFilter.value);
    if (methodFilter?.value === 'UNTAGGED') query = query.is('payment_method', null);
    else if (methodFilter?.value) query = query.eq('payment_method', methodFilter.value);
    if (selectedMemberName) query = query.eq('person_responsible', selectedMemberName);
    const { data, count, error } = await query.order('transaction_date', { ascending: false }).range(historyPage * pageSize, (historyPage + 1) * pageSize - 1);
    if (error) throw error;
    recordRows = data || [];
    const txType = page === 'withdrawals' ? 'withdrawal' : 'expense';
    commentCounts = await Ipon.getRecordCommentCounts(txType, recordRows.map((row) => row.id));
    updatePager(count);
    tbody.innerHTML = data.length ? data.map((row) => {
      const isCancelled = row.approval_status === 'VOIDED' || row.approval_status === 'REJECTED';
      return `<tr class="compact-history-row ${isCancelled ? 'row-voided' : ''}"><td>${Ipon.dateLabel(row.transaction_date)}</td><td>${Ipon.escapeHtml(row.category)}</td><td>${Ipon.escapeHtml(row.description)}${reasonNoteHtml(row)}</td><td>${Ipon.escapeHtml(row.person_responsible)}${Ipon.verifiedBadgesHtml?.(row.person_responsible) || ''}</td><td>${Ipon.paymentMethodBadge(row.payment_method)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${statusBadge(row.approval_status)}</td><td>${actionButtons(row)}</td><td class="compact-row-summary"><div class="compact-summary-head"><strong>${Ipon.escapeHtml(row.category)}</strong><b>${Ipon.money(row.amount)}</b></div><div class="compact-summary-meta"><span>${Ipon.dateLabel(row.transaction_date)} · ${Ipon.escapeHtml(row.person_responsible)}</span>${statusBadge(row.approval_status)}</div><button class="compact-detail-trigger" type="button" data-action="details" data-id="${row.id}" aria-label="View ${page === 'withdrawals' ? 'deduction' : 'expense'} details for ${Ipon.escapeHtml(row.category)}">View details <span aria-hidden="true">↗</span></button></td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty-state">${selectedMemberName ? `No ${page} found for ${Ipon.escapeHtml(selectedMemberName)}.` : `No ${page} recorded yet.`}</td></tr>`;
  }

  async function load(preserveAmount = false) {
    try {
      await loadMembers();
      await renderMemberSpotlight();
      if (page === 'contributions') await loadContributions(preserveAmount);
      else await loadTransactions();
    } catch (error) {
      Ipon.showInlineError(tbody, error, load, page === 'contributions' ? 6 : 8);
      if (contributionEntriesBody) Ipon.showInlineError(contributionEntriesBody, error, load, 7);
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const curPerms = state.profile.permissions || Ipon.defaultPermissionsForRole(state.profile.role);
    const allowedExpense = state.profile.role === 'ADMIN' || curPerms.can_record_expenses === true;
    const allowedWithdrawal = state.profile.role === 'ADMIN' || curPerms.can_record_withdrawals === true;
    if ((page === 'expenses' && !allowedExpense) || (page === 'withdrawals' && !allowedWithdrawal)) {
      Ipon.toast(`You do not currently have permission to record ${page}.`, 'error');
      return;
    }
    if (page === 'contributions' && state.profile.role === 'MEMBER' && (!state.profile.group_id || !state.profile.member_id)) {
      Ipon.showGroupRequiredDialog({ hasGroup: Boolean(state.profile.group_id) });
      return;
    }
    const button = form.querySelector('[type="submit"]');
    const refInput = form.elements.reference || form.elements.reference_number;
    if (refInput && !Ipon.validateNumericInput(refInput)) { refInput.focus(); return; }
    const values = new FormData(form);
    const amount = Number(values.get('amount'));
    if (!(amount > 0)) { Ipon.setFieldError(form.elements.amount, 'Enter an amount greater than zero.'); form.elements.amount.focus(); return; }
    const typeLabel = page === 'contributions' ? 'addition' : page.slice(0, -1);
    const isAdmin = state.profile.role === 'ADMIN';
    const needsApproval = !isAdmin && (page === 'contributions'
      ? curPerms.require_add_approval !== false
      : page === 'withdrawals'
        ? curPerms.require_withdrawal_approval !== false
        : curPerms.require_expense_approval !== false);
    const confirmed = await Ipon.confirmAction({
      title: needsApproval ? `Submit ${typeLabel} for review?` : `Confirm ${typeLabel}?`,
      message: needsApproval
        ? `${Ipon.money(amount)} will be submitted as pending until an administrator confirms it.`
        : `${Ipon.money(amount)} will be immediately confirmed and included in tracked savings.`,
      acceptLabel: needsApproval ? 'Submit for review' : 'Confirm and save'
    });
    if (!confirmed) return;
    pendingSubmissionKey ||= crypto.randomUUID();
    Ipon.setBusy(button, true);
    try {
      if (page === 'contributions') {
        const allocateExcess = Boolean(form.elements.allocate_excess?.checked);
        const rpcName = allocateExcess ? 'record_contribution_with_carryover' : 'record_contribution';
        const uploadedReceiptUrl = await receiptPicker.upload();
        const ownMemberId = state.profile.member_id || (state.profile?.workspace_mode === 'SOLO' ? membersList[0]?.id : '') || '';
        const rpcPayload = {
          p_member_id: state.profile.role === 'MEMBER' ? state.profile.member_id : (values.get('member_id') || ownMemberId),
          p_contribution_month: `${values.get('contribution_month')}-01`,
          p_amount: amount, p_payment_date: values.get('payment_date'),
          p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey,
          p_receipt_url: uploadedReceiptUrl,
          p_payment_method: values.get('payment_method') || 'CASH'
        };
        if (allocateExcess) rpcPayload.p_allocate_excess = true;
        const result = await Ipon.rpc(rpcName, rpcPayload);
        pendingSubmissionKey = null;
        receiptPicker.clear();
        const coveredMonths = Number(result?.months_covered || result?.allocated_months || 0);
        if (allocateExcess && coveredMonths > 1) {
          Ipon.toast(needsApproval
            ? `Submitted across ${coveredMonths} months for admin review.`
            : `Confirmed and allocated across ${coveredMonths} months.`);
        } else {
          Ipon.toast(needsApproval ? 'Record submitted for admin review.' : 'Confirmed record saved.');
        }
        form.reset(); setDefaults(); await load();
        return;
      } else {
        const ownResponsible = membersList.find((member) => member.id === state.profile.member_id)?.full_name || state.profile.full_name;
        const uploadedReceiptUrl = page === 'expenses' ? await receiptPicker.upload() : null;
        const payload = {
          p_transaction_date: values.get('transaction_date'), p_amount: amount,
          p_category: values.get('category'), p_description: values.get('description'),
          p_person_responsible: state.profile.role === 'MEMBER' ? ownResponsible : values.get('person_responsible'),
          p_reference_number: values.get('reference_number') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey,
          p_payment_method: values.get('payment_method') || 'CASH'
        };
        if (page === 'expenses') payload.p_receipt_url = uploadedReceiptUrl;
        await Ipon.rpc(page === 'withdrawals' ? 'record_withdrawal' : 'record_expense', payload);
      }
      pendingSubmissionKey = null;
      receiptPicker.clear();
      Ipon.toast(needsApproval ? 'Record submitted for admin review.' : 'Confirmed record saved.');
      form.reset(); setDefaults(); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  form?.addEventListener('input', () => { pendingSubmissionKey = null; });

  async function handleRecordAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'details') {
      openRecordDetails(button);
      return;
    }
    if (action === 'discuss') {
      const discussType = page === 'contributions' ? 'contribution' : page === 'withdrawals' ? 'withdrawal' : 'expense';
      Ipon.openRecordDiscussion(discussType, button.dataset.id, { onUpdated: () => load(true) });
      return;
    }
    if (action === 'receipt') {
      const row = recordRows.find((item) => item.id === button.dataset.id);
      if (row?.receipt_url) {
        const who = row.contribution_periods?.members?.full_name || row.person_responsible || 'Record';
        Ipon.openImageViewer(row.receipt_url, `${who} receipt`, `${Ipon.money(row.amount)} · ${Ipon.dateLabel(row.payment_date || row.transaction_date)}`);
      }
      return;
    }
    if (action === 'edit') {
      const row = recordRows.find((item) => item.id === button.dataset.id); if (!row) return;
      populateResponsibleSelect(editForm.elements.person_responsible, row.person_responsible || '');
      editForm.elements.record_id.value = row.id; editForm.elements.date.value = row.payment_date || row.transaction_date; editForm.elements.amount.value = row.amount; Ipon.syncCategoryControl(editForm.elements.category, row.category || ''); editForm.elements.description.value = row.description || ''; editForm.elements.person_responsible.value = row.person_responsible || ''; editForm.elements.payment_method.value = row.payment_method || ''; editForm.elements.payment_method._customSelect?.sync(); editForm.elements.reference.value = row.transaction_reference || row.reference_number || ''; editForm.elements.notes.value = row.notes || '';
      editDirty?.reset();
      editDialog.showModal(); editForm.elements.amount.focus(); return;
    }
    const row = recordRows.find((item) => item.id === button.dataset.id);
    const recordType = page === 'contributions' ? 'contribution' : page === 'withdrawals' ? 'withdrawal' : 'expense';
    const typeLabel = recordType === 'contribution' ? 'Savings Addition' : recordType === 'withdrawal' ? 'Deduction' : 'Expense';
    const submitterProfile = row?.submitted_by ? profilesByUserId.get(row.submitted_by) : null;
    const memberInfo = row?.contribution_periods?.members;
    const memberProfile = memberInfo
      ? (profilesByMemberId.get(memberInfo.id) || profilesByName.get((memberInfo.full_name || '').trim().toLowerCase()))
      : profilesByName.get((row?.person_responsible || '').trim().toLowerCase());
    const entry = row ? {
      id: row.id,
      type: recordType,
      typeLabel,
      authorUserId: memberInfo?.id || '',
        memberId: row?.member_id || row?.contribution_periods?.members?.id || '',
        authorName: memberInfo?.full_name || row.person_responsible || 'Group member',
      submittedByName: submitterProfile?.full_name || '',
      avatarUrl: memberProfile?.avatar_url || submitterProfile?.avatar_url || '',
      amount: row.amount,
      date: row.payment_date || row.transaction_date,
      periodMonth: row.contribution_periods?.period_month || '',
      category: row.category || '',
      paymentMethod: row.payment_method || '',
      reference: row.transaction_reference || row.reference_number || '',
      notes: row.notes || '',
      description: row.description || '',
      receiptUrl: row.receipt_url || '',
      status: row.approval_status || ''
    } : null;
    await Ipon.requestRecordAction({
      title: `${action[0].toUpperCase()}${action.slice(1)} record`,
      actions: [action.toUpperCase()],
      entry,
      onSubmit: async ({ note }) => {
        if (action === 'void') await Ipon.rpc(`void_${recordType}`, { [`p_${recordType}_id`]: button.dataset.id, p_reason: note });
        else await Ipon.rpc(`review_${recordType}`, { [`p_${recordType}_id`]: button.dataset.id, p_decision: action === 'confirm' ? 'CONFIRMED' : 'REJECTED', p_review_note: note });
        Ipon.toast(`${typeLabel} ${action === 'void' ? 'voided' : action === 'confirm' ? 'confirmed' : 'rejected'}.`);
        await load();
      }
    });
  }
  document.getElementById('record-edit-close').addEventListener('click', () => editDialog.close());
  document.getElementById('record-detail-close').addEventListener('click', () => detailDialog.close());
  detailActions.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const source = page === 'contributions' ? contributionEntriesBody : tbody;
    const original = [...source.querySelectorAll('button[data-action]')].find((item) => item.dataset.action === button.dataset.action && item.dataset.id === button.dataset.id);
    detailDialog.close();
    original?.click();
  });
  document.getElementById('record-edit-cancel').addEventListener('click', () => editDialog.close());
  editForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (editForm.elements.reference && !Ipon.validateNumericInput(editForm.elements.reference)) { editForm.elements.reference.focus(); return; }
    const values = new FormData(editForm);
    const confirmed = await Ipon.confirmAction({
      title: 'Save record changes?',
      message: `Update this pending entry to ${Ipon.money(Number(values.get('amount') || 0))}?`,
      acceptLabel: 'Save changes'
    });
    if (!confirmed) return;
    const button = event.submitter; Ipon.setBusy(button, true);
    try {
      if (page === 'contributions') await Ipon.rpc('update_contribution', { p_contribution_id: values.get('record_id'), p_amount: Number(values.get('amount')), p_payment_date: values.get('date'), p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null, p_payment_method: values.get('payment_method') || null });
      else { const type = page === 'withdrawals' ? 'withdrawal' : 'expense'; await Ipon.rpc(`update_${type}`, { [`p_${type}_id`]: values.get('record_id'), p_transaction_date: values.get('date'), p_amount: Number(values.get('amount')), p_category: values.get('category'), p_description: values.get('description'), p_person_responsible: values.get('person_responsible'), p_reference_number: values.get('reference') || null, p_notes: values.get('notes') || null, p_payment_method: values.get('payment_method') || null }); }
      editDialog.close(); Ipon.toast('Pending record updated.'); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });
  document.getElementById('member-id')?.addEventListener('change', syncSuggestedAmount);
  document.getElementById('contribution-month')?.addEventListener('change', syncSuggestedAmount);
  tbody.addEventListener('click', async (event) => {
    const exemptBtn = event.target.closest('[data-exempt-member]');
    if (exemptBtn) {
      const currentlyExempt = exemptBtn.dataset.exemptState === '1';
      const accepted = await Ipon.confirmAction({
        title: currentlyExempt ? 'Remove period exemption?' : 'Exempt member for this month?',
        message: currentlyExempt
          ? 'Restore regular required tracking for this member and month?'
          : 'Mark this month as exempt so the member is not counted as unpaid?',
        acceptLabel: currentlyExempt ? 'Remove exemption' : 'Mark exempt'
      });
      if (!accepted) return;
      Ipon.setBusy(exemptBtn, true);
      try {
        await Ipon.rpc('set_period_exemption', {
          p_member_id: exemptBtn.dataset.exemptMember,
          p_period_month: exemptBtn.dataset.exemptMonth,
          p_exempt: !currentlyExempt,
          p_reason: currentlyExempt ? null : 'Marked exempt by admin'
        });
        Ipon.toast(currentlyExempt ? 'Period exemption removed.' : 'Member marked exempt for this month.');
        await load(true);
      } catch (error) {
        Ipon.toast(Ipon.friendlyError(error), 'error');
      } finally {
        Ipon.setBusy(exemptBtn, false);
      }
      return;
    }
    handleRecordAction(event);
  });
  contributionEntriesBody?.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-bulk-toggle]');
    if (toggle) {
      const checkbox = [...contributionEntriesBody.querySelectorAll('.bulk-entry-check')].find((item) => item.value === toggle.dataset.bulkToggle);
      if (checkbox) checkbox.checked = !checkbox.checked;
      updateBulkSelectionUi();
      return;
    }
    handleRecordAction(event);
  });
  contributionEntriesBody?.addEventListener('change', (event) => {
    if (event.target.classList.contains('bulk-entry-check')) updateBulkSelectionUi();
  });
  document.getElementById('bulk-select-all')?.addEventListener('change', (event) => {
    const checked = event.target.checked;
    contributionEntriesBody?.querySelectorAll('.bulk-entry-check').forEach((box) => { box.checked = checked; });
    updateBulkSelectionUi();
  });
  document.getElementById('bulk-confirm-selected')?.addEventListener('click', async (event) => {
    const btn = event.currentTarget;
    const ids = [...(contributionEntriesBody?.querySelectorAll('.bulk-entry-check:checked') || [])].map((box) => box.value);
    if (!ids.length) return;
    const accepted = await Ipon.confirmAction({
      title: `Confirm ${ids.length} pending addition${ids.length === 1 ? '' : 's'}?`,
      message: 'All selected pending additions will be confirmed and included in tracked savings.',
      acceptLabel: 'Confirm selected'
    });
    if (!accepted) return;
    Ipon.setBusy(btn, true, 'Confirming…');
    try {
      const result = await Ipon.rpc('bulk_confirm_contributions', { p_contribution_ids: ids });
      Ipon.toast(`Confirmed ${Number(result?.confirmed_count || ids.length)} addition(s).`);
      await load();
    } catch (error) {
      Ipon.toast(Ipon.friendlyError(error), 'error');
    } finally {
      Ipon.setBusy(btn, false);
    }
  });
  statusFilter?.addEventListener('change', () => { historyPage = 0; load(true); });
  methodFilter?.addEventListener('change', () => { historyPage = 0; load(true); });
  document.getElementById('responsible')?.addEventListener('change', () => syncResponsiblePayoutBox(true));
  memberFilter?.addEventListener('change', async () => {
    selectedMemberId = memberFilter.value;
    const selected = membersList.find((m) => m.id === selectedMemberId);
    selectedMemberName = selected ? selected.full_name : '';
    historyPage = 0;
    updateTabLinksWithMember();
    await renderMemberSpotlight();
    await (page === 'contributions' ? loadContributions(true) : loadTransactions());
  });
  spotlightClear?.addEventListener('click', async () => {
    if (memberFilter) memberFilter.value = '';
    selectedMemberId = '';
    selectedMemberName = '';
    historyPage = 0;
    updateTabLinksWithMember();
    await renderMemberSpotlight();
    await (page === 'contributions' ? loadContributions(true) : loadTransactions());
  });
  pager?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled) return;
    historyPage += button.dataset.page === 'next' ? 1 : -1;
    load();
  });

  function openRequestedThreadFromUrl() {
    const raw = new URLSearchParams(window.location.search).get('thread') || '';
    const [type, id] = raw.split(':');
    if (type && id && ['contribution', 'withdrawal', 'expense'].includes(type)) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('thread');
      window.history.replaceState(null, '', cleanUrl.toString());
      Ipon.openRecordDiscussion(type, id, { onUpdated: () => load(true) });
    }
  }

  const parseTypedRef = (val) => {
    const raw = String(val || '').trim();
    const idx = raw.indexOf(':');
    return idx > 0 ? { type: raw.slice(0, idx), id: raw.slice(idx + 1) } : null;
  };
  const focusRecordRow = async (recordId) => {
    const safeId = CSS.escape ? CSS.escape(recordId) : recordId;
    const findRow = () => tbody?.querySelector(`[data-id="${safeId}"]`)?.closest('tr')
      || contributionEntriesBody?.querySelector(`[data-id="${safeId}"]`)?.closest('tr')
      || null;
    let rowEl = findRow();
    if (!rowEl && ((statusFilter && statusFilter.value) || (methodFilter && methodFilter.value) || (page === 'contributions' && memberFilter && memberFilter.value))) {
      if (statusFilter) statusFilter.value = '';
      if (methodFilter) methodFilter.value = '';
      if (page === 'contributions' && memberFilter && memberFilter.value) {
        selectedMemberId = '';
        memberFilter.value = '';
        updateTabLinksWithMember();
      }
      historyPage = 0;
      await load(true);
      rowEl = findRow();
    }
    if (rowEl) Ipon.highlightFocus(rowEl);
    return rowEl;
  };
  try { await load(); } finally { Ipon.setLoading(false); }
  Ipon.consumeDeepLink(async (params) => {
    const threadRef = parseTypedRef(params.get('thread'));
    if (threadRef) {
      await focusRecordRow(threadRef.id);
      Ipon.openRecordDiscussion(threadRef.type, threadRef.id, { onUpdated: () => load(true) });
      return true;
    }
    const recordRef = parseTypedRef(params.get('record'));
    if (recordRef) {
      await focusRecordRow(recordRef.id);
      await Ipon.openRecordDetails(recordRef.type, recordRef.id, {
        allowReview: state.profile?.role === 'ADMIN',
        onUpdated: () => load(true)
      });
      return true;
    }
    const reviewRef = parseTypedRef(params.get('review'));
    if (reviewRef) {
      await focusRecordRow(reviewRef.id);
      await Ipon.openRecordDetails(reviewRef.type, reviewRef.id, {
        allowReview: state.profile?.role === 'ADMIN',
        autoOpenReview: state.profile?.role === 'ADMIN',
        onUpdated: () => load(true)
      });
      return true;
    }
    const reminderMonth = params.get('reminder') || '';
    const exemptionMonth = params.get('exemption') || '';
    if (reminderMonth || exemptionMonth) {
      const monthInput = document.getElementById('contribution-month');
      const amountInput = document.getElementById('amount');
      await Ipon.openPeriodNoticeModal({
        mode: exemptionMonth ? 'exemption' : 'reminder',
        month: exemptionMonth || reminderMonth,
        memberId: selectedMemberId || state.profile?.member_id || null,
        onSubmitPayment: page === 'contributions' && monthInput ? ({ monthStart, outstanding }) => {
          monthInput.value = monthStart.slice(0, 7);
          monthInput.dispatchEvent(new Event('change', { bubbles: true }));
          if (amountInput && outstanding > 0) {
            amountInput.value = Number(outstanding).toFixed(2);
            amountInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          amountInput?.focus();
        } : null
      });
      return true;
    }
    return false;
  });
  Ipon.subscribeToChanges(page, ['members', 'group_memberships', 'financial_change_requests', 'contribution_periods', 'contributions', 'withdrawals', 'expenses', 'record_comments'], async () => {
    await Ipon.refreshMyPermissions?.().catch(() => { });
    return load(true);
  });
})();
