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
  if (!state.profile.group_id) {
    Ipon.renderGroupRequiredCard(form.closest('.panel'), { hasGroup: false });
  } else if ((page === 'expenses' || page === 'withdrawals') && state.profile.role === 'MEMBER') {
    form.closest('.panel').innerHTML = `<div class="empty-state">Only administrators and treasurers can record ${page === 'expenses' ? 'expenses' : 'deductions'}. You can review the group history here.</div>`;
  } else if (page === 'contributions' && state.profile.role === 'MEMBER' && !state.profile.member_id) {
    Ipon.renderGroupRequiredCard(form.closest('.panel'), { hasGroup: true });
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
  }
  document.body.insertAdjacentHTML('beforeend', `<dialog class="form-dialog" id="record-edit-dialog" aria-labelledby="record-edit-title"><div class="form-dialog-sheet"><header class="form-dialog-header"><div><h2 id="record-edit-title">Edit pending record</h2><p>Only pending records can be corrected. Confirmed records must be voided and replaced.</p></div><button class="dialog-close" id="record-edit-close" type="button" aria-label="Close edit form"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><form id="record-edit-form" class="form-grid"><input type="hidden" name="record_id"><div class="field"><label for="edit-date">Date</label><input id="edit-date" name="date" type="date" min="2000-01-01" data-max-today required></div><div class="field"><label for="edit-amount">Amount</label><input id="edit-amount" name="amount" type="number" min="0.01" max="999999999999.99" step="0.01" required></div><div class="field transaction-edit-field"><label for="edit-category">Category</label><input id="edit-category" name="category" maxlength="80" data-category-presets="${page === 'withdrawals' ? 'deduction' : 'expense'}"></div><div class="field transaction-edit-field"><label for="edit-responsible">Person responsible</label><select id="edit-responsible" name="person_responsible"><option value="">Select member</option></select></div><div class="field field-wide transaction-edit-field"><label for="edit-description">Description</label><textarea id="edit-description" name="description" maxlength="500"></textarea></div><div class="field"><label for="edit-payment-method">${page === 'contributions' ? 'Payment method' : 'Paid from wallet'}</label><select id="edit-payment-method" name="payment_method"><option value="">Untagged (legacy)</option>${Ipon.paymentMethodOptionsHtml()}</select></div><div class="field"><label for="edit-reference">Reference</label><input id="edit-reference" name="reference" maxlength="100"></div><div class="field field-wide"><label for="edit-notes">Notes</label><textarea id="edit-notes" name="notes" maxlength="1000"></textarea></div><div class="form-actions field-wide"><button class="button button-secondary" id="record-edit-cancel" type="button">Cancel</button><button class="button button-primary" type="submit">Save correction</button></div></form></div></dialog>`);
  const editDialog = document.getElementById('record-edit-dialog');
  const editForm = document.getElementById('record-edit-form');
  Ipon.prepareNumericInputs();
  editDialog.querySelectorAll('.transaction-edit-field').forEach((field) => { field.hidden = page === 'contributions'; field.querySelector('input,select,textarea').required = page !== 'contributions'; });
  Ipon.setCategoryPresetGroup(editForm.elements.category, page === 'withdrawals' ? 'deduction' : 'expense', { required: page !== 'contributions' });

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
    const { data, error } = await Ipon.client.from('members').select('id,full_name,monthly_contribution_amount,payout_channel,payout_account_number,payout_account_name').eq('status', 'ACTIVE').order('full_name');
    if (error) throw error;
    membersList = data || [];

    const { data: groupProfiles } = await Ipon.client.from('profiles').select('id,member_id,full_name,avatar_url').eq('status', 'ACTIVE');
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

    if (select) {
      const currentSelection = select.value;
      const selectedId = currentSelection || (selectedMemberId && membersList.some((m) => m.id === selectedMemberId) ? selectedMemberId : state.profile.member_id || '');
      select.innerHTML = membersList.length
        ? `<option value="">Select member</option>${membersList.map((member) => `<option value="${member.id}" data-avatar="${Ipon.escapeHtml(member.avatar_url || '')}" ${selectedId === member.id ? 'selected' : ''}>${Ipon.escapeHtml(member.full_name)}</option>`).join('')}`
        : '<option value="">No active member profile found</option>';
      if (state.profile.role === 'MEMBER') {
        select.closest('.field').hidden = true;
        select.required = false;
      }
      Ipon.enhanceMemberSelect(select);
    }
    if (responsibleSelect) {
      const ownMember = membersList.find((member) => member.id === state.profile.member_id);
      const defaultResponsible = responsibleSelect.value || (selectedMemberName || ownMember?.full_name || '');
      populateResponsibleSelect(responsibleSelect, defaultResponsible);
      if (state.profile.role === 'MEMBER') {
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
      const [contribRes, withRes, expRes] = await Promise.all([
        safeMemberId
          ? Ipon.client.from('contributions')
              .select('amount,payment_date,approval_status,contribution_periods!inner(period_month,member_id)')
              .eq('approval_status', 'CONFIRMED')
              .eq('contribution_periods.member_id', safeMemberId)
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
          spotlightChart = new window.Chart(canvas, {
            type: 'bar',
            data: {
              labels,
              datasets: [
                {
                  label: 'Additions',
                  data: addData,
                  backgroundColor: '#287a4c',
                  borderRadius: 5,
                  maxBarThickness: 32
                },
                {
                  label: 'Deductions & Expenses',
                  data: dedData,
                  backgroundColor: '#ae3934',
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
                  callbacks: {
                    label: (context) => ` ${context.dataset.label}: ${Ipon.money(context.raw)}`
                  }
                }
              },
              scales: {
                x: {
                  grid: { display: false }
                },
                y: {
                  beginAtZero: true,
                  ticks: {
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
      return `<tr><td>${Ipon.escapeHtml(row.member_name)}</td><td>${Ipon.dateLabel(row.period_month, { month: 'long', year: 'numeric' })}</td><td>${Ipon.money(row.required_amount)}</td><td>${Ipon.money(row.paid_amount)}</td><td>${Ipon.money(row.outstanding_amount)}</td><td>${statusBadge(row.payment_status)}${exemptBtn}</td></tr>`;
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
      return `<tr class="${isCancelled ? 'row-voided' : ''}"><td>${bulkBox}${Ipon.dateLabel(entry.payment_date)}</td><td>${Ipon.escapeHtml(entry.contribution_periods.members.full_name)}${reasonNoteHtml(entry)}</td><td>${Ipon.dateLabel(entry.contribution_periods.period_month, { month: 'short', year: 'numeric' })}</td><td>${Ipon.paymentMethodBadge(entry.payment_method)}</td><td class="amount-cell">${Ipon.money(entry.amount)}</td><td>${statusBadge(entry.approval_status)}</td><td>${actionButtons(entry)}</td></tr>`;
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
      return `<tr class="${isCancelled ? 'row-voided' : ''}"><td>${Ipon.dateLabel(row.transaction_date)}</td><td>${Ipon.escapeHtml(row.category)}</td><td>${Ipon.escapeHtml(row.description)}${reasonNoteHtml(row)}</td><td>${Ipon.escapeHtml(row.person_responsible)}</td><td>${Ipon.paymentMethodBadge(row.payment_method)}</td><td class="amount-cell">${Ipon.money(row.amount)}</td><td>${statusBadge(row.approval_status)}</td><td>${actionButtons(row)}</td></tr>`;
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
    const button = form.querySelector('[type="submit"]');
    const refInput = form.elements.reference || form.elements.reference_number;
    if (refInput && !Ipon.validateNumericInput(refInput)) { refInput.focus(); return; }
    const values = new FormData(form);
    const amount = Number(values.get('amount'));
    if (!(amount > 0)) { Ipon.setFieldError(form.elements.amount, 'Enter an amount greater than zero.'); form.elements.amount.focus(); return; }
    const typeLabel = page === 'contributions' ? 'addition' : page.slice(0, -1);
    const isAdmin = state.profile.role === 'ADMIN';
    const confirmed = await Ipon.confirmAction({
      title: isAdmin ? `Confirm ${typeLabel}?` : `Submit ${typeLabel} for review?`,
      message: isAdmin
        ? `${Ipon.money(amount)} will be immediately confirmed and included in tracked savings.`
        : `${Ipon.money(amount)} will be submitted as pending until an administrator confirms it.`,
      acceptLabel: isAdmin ? 'Confirm and save' : 'Submit for review'
    });
    if (!confirmed) return;
    pendingSubmissionKey ||= crypto.randomUUID();
    Ipon.setBusy(button, true);
    try {
      if (page === 'contributions') {
        const allocateExcess = Boolean(form.elements.allocate_excess?.checked);
        const rpcName = allocateExcess ? 'record_contribution_with_carryover' : 'record_contribution';
        const rpcPayload = {
          p_member_id: state.profile.role === 'MEMBER' ? state.profile.member_id : values.get('member_id'),
          p_contribution_month: `${values.get('contribution_month')}-01`,
          p_amount: amount, p_payment_date: values.get('payment_date'),
          p_transaction_reference: values.get('reference') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey,
          p_receipt_url: receiptPicker.get(),
          p_payment_method: values.get('payment_method') || 'CASH'
        };
        if (allocateExcess) rpcPayload.p_allocate_excess = true;
        const result = await Ipon.rpc(rpcName, rpcPayload);
        pendingSubmissionKey = null;
        receiptPicker.clear();
        const coveredMonths = Number(result?.months_covered || result?.allocated_months || 0);
        if (allocateExcess && coveredMonths > 1) {
          Ipon.toast(state.profile.role === 'ADMIN'
            ? `Confirmed and allocated across ${coveredMonths} months.`
            : `Submitted across ${coveredMonths} months for admin review.`);
        } else {
          Ipon.toast(state.profile.role === 'ADMIN' ? 'Confirmed record saved.' : 'Record submitted for admin review.');
        }
        form.reset(); setDefaults(); await load();
        return;
      } else {
        const ownResponsible = membersList.find((member) => member.id === state.profile.member_id)?.full_name || state.profile.full_name;
        const payload = {
          p_transaction_date: values.get('transaction_date'), p_amount: amount,
          p_category: values.get('category'), p_description: values.get('description'),
          p_person_responsible: state.profile.role === 'MEMBER' ? ownResponsible : values.get('person_responsible'),
          p_reference_number: values.get('reference_number') || null, p_notes: values.get('notes') || null,
          p_idempotency_key: pendingSubmissionKey,
          p_payment_method: values.get('payment_method') || 'CASH'
        };
        if (page === 'expenses') payload.p_receipt_url = receiptPicker.get();
        await Ipon.rpc(page === 'withdrawals' ? 'record_withdrawal' : 'record_expense', payload);
      }
      pendingSubmissionKey = null;
      receiptPicker.clear();
      Ipon.toast(state.profile.role === 'ADMIN' ? 'Confirmed record saved.' : 'Record submitted for admin review.');
      form.reset(); setDefaults(); await load();
    } catch (error) { Ipon.toast(Ipon.friendlyError(error), 'error'); }
    finally { Ipon.setBusy(button, false); }
  });

  form?.addEventListener('input', () => { pendingSubmissionKey = null; });

  async function handleRecordAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
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
      editForm.elements.record_id.value = row.id; editForm.elements.date.value = row.payment_date || row.transaction_date; editForm.elements.amount.value = row.amount; Ipon.syncCategoryControl(editForm.elements.category, row.category || ''); editForm.elements.description.value = row.description || ''; editForm.elements.person_responsible.value = row.person_responsible || ''; editForm.elements.payment_method.value = row.payment_method || ''; editForm.elements.reference.value = row.transaction_reference || row.reference_number || ''; editForm.elements.notes.value = row.notes || '';
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
  contributionEntriesBody?.addEventListener('click', handleRecordAction);
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

  try { await load(); openRequestedThreadFromUrl(); } finally { Ipon.setLoading(false); }
  Ipon.subscribeToChanges(page, ['members', 'contribution_periods', 'contributions', 'withdrawals', 'expenses', 'record_comments'], () => load(true));
})();
