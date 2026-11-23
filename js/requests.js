(async function () {
  'use strict';

  const TYPE_META = {
    CHANGE: { label: 'Change request', badgeClass: 'is-change', recordType: null },
    ADDITION: { label: 'Addition request', badgeClass: 'is-addition', recordType: 'contribution' },
    DEDUCTION: { label: 'Deduction request', badgeClass: 'is-deduction', recordType: 'withdrawal' },
    EXPENSE: { label: 'Expense request', badgeClass: 'is-expense', recordType: 'expense' }
  };

  const mainPanel = document.getElementById('requests-main-panel');
  const tbody = document.getElementById('requests-body');
  const summaryEl = document.getElementById('req-result-summary');
  const typePillsEl = document.getElementById('req-type-pills');
  const kpiBtns = [...document.querySelectorAll('[data-req-kpi]')];
  const searchInput = document.getElementById('req-search-input');
  const statusFilter = document.getElementById('req-status-filter');
  const memberFilter = document.getElementById('req-member-filter');
  const methodFilter = document.getElementById('req-method-filter');
  const dateFromInput = document.getElementById('req-date-from');
  const dateToInput = document.getElementById('req-date-to');
  const resetBtn = document.getElementById('req-reset-filters');
  const pager = document.getElementById('req-pager');

  const urlParams = new URLSearchParams(window.location.search);
  const initialType = String(urlParams.get('type') || 'ALL').toUpperCase();
  const initialStatus = String(urlParams.get('status') || 'ALL').toUpperCase();
  let activeType = ['ALL', 'CHANGE', 'ADDITION', 'DEDUCTION', 'EXPENSE'].includes(initialType) ? initialType : 'ALL';
  let selectedMemberKey = String(urlParams.get('member') || '').trim();
  let pageIndex = 0;
  const pageSize = 20;
  let searchDebounce = null;

  let allRequests = [];
  let filteredRequests = [];
  let changeRequestsById = new Map();
  let entriesByKey = new Map();
  let membersList = [];
  const profilesByUserId = new Map();
  const profilesByMemberId = new Map();
  const profilesByName = new Map();
  const commentCountsByKey = new Map();

  const state = await Ipon.init({ allowedRoles: ['ADMIN', 'TREASURER', 'MEMBER'] });
  if (state.failed || state.redirecting) return;

  if (!state.configured || !state.profile) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Connect Supabase to view user requests.</td></tr>';
    if (summaryEl) summaryEl.textContent = 'Unavailable offline';
    Ipon.setLoading(false);
    return;
  }

  if (!state.profile.group_id) {
    document.querySelector('.requests-kpi-grid')?.setAttribute('hidden', 'hidden');
    Ipon.renderGroupRequiredCard(mainPanel, { hasGroup: false });
    Ipon.setLoading(false);
    return;
  }
  if (state.profile.workspace_mode === 'SOLO') {
    window.location.replace('contributions.html');
    return;
  }

  const isAdmin = state.profile.role === 'ADMIN';
  const myUserId = String(state.profile.id || '');

  if (statusFilter && [...statusFilter.options].some((o) => o.value === initialStatus)) {
    statusFilter.value = initialStatus;
  }
  if (methodFilter) {
    methodFilter.innerHTML = Ipon.paymentMethodOptionsHtml({ includeAll: true, includeUntagged: true });
    Ipon.enhancePaymentSelect?.(methodFilter, { compact: true });
  }

  function syncTabLinksWithMember() {
    const memberObj = membersList.find((m) => String(m.id) === selectedMemberKey || String(m.user_id || '') === selectedMemberKey);
    const paramVal = memberObj ? String(memberObj.id) : '';
    document.querySelectorAll('.record-tabs a').forEach((tab) => {
      const href = tab.getAttribute('href');
      if (!href) return;
      const base = href.split('?')[0];
      tab.setAttribute('href', paramVal ? `${base}?member=${encodeURIComponent(paramVal)}` : base);
    });
  }

  function resolveProfile(userId, fallbackName = '') {
    if (userId && profilesByUserId.has(String(userId))) return profilesByUserId.get(String(userId));
    const clean = String(fallbackName || '').trim().toLowerCase();
    if (clean && profilesByName.has(clean)) return profilesByName.get(clean);
    return null;
  }

  function formatStatusBadge(status) {
    const clean = String(status || 'PENDING').toUpperCase();
    const labelMap = {
      PENDING: 'Pending',
      APPROVED: 'Approved',
      CONFIRMED: 'Confirmed',
      REJECTED: 'Rejected',
      CANCELLED: 'Withdrawn',
      VOIDED: 'Voided'
    };
    const cls = clean === 'APPROVED' || clean === 'CONFIRMED'
      ? 'status-confirmed'
      : (clean === 'REJECTED' || clean === 'VOIDED' || clean === 'CANCELLED')
        ? (clean === 'REJECTED' ? 'status-rejected' : 'status-voided')
        : 'status-pending';
    return `<span class="status req-status-pill ${cls}"><i class="req-status-dot" aria-hidden="true"></i>${Ipon.escapeHtml(labelMap[clean] || clean)}</span>`;
  }

  function statusMatchesFilter(status, filterValue) {
    const s = String(status || 'PENDING').toUpperCase();
    if (!filterValue || filterValue === 'ALL') return true;
    if (filterValue === 'PENDING') return s === 'PENDING';
    if (filterValue === 'APPROVED_CONFIRMED') return s === 'APPROVED' || s === 'CONFIRMED';
    if (filterValue === 'REJECTED') return s === 'REJECTED';
    if (filterValue === 'VOIDED_CANCELLED') return s === 'VOIDED' || s === 'CANCELLED';
    return s === filterValue;
  }

  function shouldIncludeEntryRequest(row, requesterProfile) {
    const status = String(row?.approval_status || '').toUpperCase();
    if (status === 'PENDING' || status === 'REJECTED' || status === 'VOIDED') return true;
    if (row?.review_note || row?.void_reason) return true;
    const role = String(requesterProfile?.role || '').toUpperCase();
    return Boolean(row?.submitted_by && role && role !== 'ADMIN');
  }

  const NOTE_ICON_SVG = '<svg class="req-note-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

  function buildChangeSummaryHtml(item) {
    const cr = item.raw;
    const amtChanged = Number(cr.current_amount || 0) !== Number(cr.proposed_amount || 0);
    const curMethod = Ipon.normalizePaymentMethod?.(cr.current_payment_method) || '';
    const nextMethod = Ipon.normalizePaymentMethod?.(cr.proposed_payment_method) || '';
    const methodChanged = curMethod !== nextMethod;
    const curNotes = String(cr.current_notes || '').trim();
    const nextNotes = String(cr.proposed_notes || '').trim();
    const notesChanged = curNotes !== nextNotes;
    const recWord = cr.record_type === 'withdrawal' ? 'Deduction' : cr.record_type === 'expense' ? 'Expense' : 'Addition';

    const innerParts = [
      `<div class="req-diff-block">
        <span class="req-mobile-eyebrow">${Ipon.escapeHtml(recWord.toUpperCase())} EDIT</span>
        <div class="req-diff-line"><span class="req-diff-prefix">${Ipon.escapeHtml(recWord)} edit</span><strong class="req-old-amt">${Ipon.escapeHtml(Ipon.money(cr.current_amount))}</strong> <span class="req-diff-arrow" aria-hidden="true">→</span> <strong class="req-new-amt${amtChanged ? ' is-changed' : ''}">${Ipon.escapeHtml(Ipon.money(cr.proposed_amount))}</strong></div>
      </div>`
    ];
    if (methodChanged) {
      innerParts.push(`<div class="req-diff-sub">Method: ${Ipon.escapeHtml(Ipon.paymentMethodMeta?.(curMethod)?.label || curMethod || 'Untagged')} → <strong>${Ipon.escapeHtml(Ipon.paymentMethodMeta?.(nextMethod)?.label || nextMethod || 'Untagged')}</strong></div>`);
    }
    if (notesChanged) {
      innerParts.push(`<div class="req-diff-sub">Notes: "${Ipon.escapeHtml(nextNotes || 'None')}"</div>`);
    }
    if (cr.reason) {
      innerParts.push(`<div class="req-reason-block"><span class="req-mobile-eyebrow">REASON</span><small class="req-reason-note"><span class="req-inline-k">Reason: </span>${Ipon.escapeHtml(cr.reason)}</small></div>`);
    }

    let noteBox = '';
    if (cr.review_note && item.status !== 'PENDING') {
      const tone = item.status === 'APPROVED' ? 'is-confirmed' : 'is-rejected';
      noteBox = `<div class="req-note-callout ${tone}">${NOTE_ICON_SVG}<div class="req-note-callout-copy"><span class="req-mobile-eyebrow">ADMIN NOTE</span><small class="req-decision-note ${tone}"><span class="req-inline-k">Admin note: </span>${Ipon.escapeHtml(cr.review_note)}</small></div></div>`;
    }
    return `<div class="req-summary-stack"><div class="req-details-card">${innerParts.join('')}</div>${noteBox}</div>`;
  }

  function buildEntrySummaryHtml(item) {
    const r = item.raw;
    const isClosed = ['REJECTED', 'VOIDED', 'CANCELLED'].includes(item.status);
    const amtHtml = `<div class="req-mobile-entry-amt${isClosed ? ' is-closed' : ''}">${Ipon.escapeHtml(Ipon.money(item.amount))}</div>`;
    const innerParts = [];
    if (item.kind === 'ADDITION') {
      const monthLabel = item.periodMonth ? Ipon.dateLabel(item.periodMonth, { month: 'short', year: 'numeric' }) : '';
      innerParts.push(`<div class="req-diff-block"><span class="req-mobile-eyebrow">SAVINGS ADDITION${monthLabel ? ` · ${Ipon.escapeHtml(monthLabel.toUpperCase())}` : ''}</span>${amtHtml}<div class="req-primary-detail">${Ipon.escapeHtml(item.subjectName || 'Group member')}${monthLabel ? ` · <span>${Ipon.escapeHtml(monthLabel)}</span>` : ''}</div></div>`);
    } else {
      const kindWord = item.kind === 'DEDUCTION' ? 'DEDUCTION' : 'EXPENSE';
      innerParts.push(`<div class="req-diff-block"><span class="req-mobile-eyebrow">${kindWord}${r.category ? ` · ${Ipon.escapeHtml(String(r.category).toUpperCase())}` : ''}</span>${amtHtml}<div class="req-primary-detail">${Ipon.escapeHtml(r.category || 'General')}${r.description ? ` — ${Ipon.escapeHtml(r.description)}` : ''}</div></div>`);
      if (item.subjectName && item.subjectName !== item.requesterName) {
        innerParts.push(`<div class="req-diff-sub">Member / Responsible: ${Ipon.escapeHtml(item.subjectName)}</div>`);
      }
    }
    if (r.notes) {
      innerParts.push(`<div class="req-reason-block"><span class="req-mobile-eyebrow">NOTE</span><small class="req-reason-note"><span class="req-inline-k">Note: </span>${Ipon.escapeHtml(r.notes)}</small></div>`);
    }
    const ref = r.transaction_reference || r.reference_number;
    if (ref) {
      innerParts.push(`<div class="req-diff-sub">Ref: ${Ipon.escapeHtml(ref)}</div>`);
    }
    let noteBox = '';
    if (r.void_reason) {
      noteBox = `<div class="req-note-callout is-rejected">${NOTE_ICON_SVG}<div class="req-note-callout-copy"><span class="req-mobile-eyebrow">VOID REASON</span><small class="req-decision-note is-rejected"><span class="req-inline-k">Void reason: </span>${Ipon.escapeHtml(r.void_reason)}</small></div></div>`;
    } else if (r.review_note) {
      const tone = item.status === 'CONFIRMED' ? 'is-confirmed' : 'is-rejected';
      noteBox = `<div class="req-note-callout ${tone}">${NOTE_ICON_SVG}<div class="req-note-callout-copy"><span class="req-mobile-eyebrow">REVIEW NOTE</span><small class="req-decision-note ${tone}"><span class="req-inline-k">Review note: </span>${Ipon.escapeHtml(r.review_note)}</small></div></div>`;
    }
    return `<div class="req-summary-stack"><div class="req-details-card">${innerParts.join('')}</div>${noteBox}</div>`;
  }

  function populateMemberFilter() {
    if (!memberFilter) return;
    const prevVal = selectedMemberKey || memberFilter.value || '';
    const peopleMap = new Map();
    membersList.forEach((m) => {
      const prof = profilesByMemberId.get(m.id) || profilesByName.get(String(m.full_name || '').trim().toLowerCase());
      peopleMap.set(`name:${String(m.full_name || '').trim().toLowerCase()}`, {
        value: String(m.id),
        memberId: String(m.id),
        userId: prof?.id ? String(prof.id) : '',
        name: m.full_name,
        avatar_url: prof?.avatar_url || m.avatar_url || ''
      });
    });
    allRequests.forEach((item) => {
      const cleanName = String(item.requesterName || '').trim();
      const key = `name:${cleanName.toLowerCase()}`;
      if (cleanName && !peopleMap.has(key)) {
        peopleMap.set(key, {
          value: item.requesterId ? `user:${item.requesterId}` : key,
          memberId: item.subjectMemberId || '',
          userId: item.requesterId || '',
          name: cleanName,
          avatar_url: item.requesterAvatar || ''
        });
      }
    });
    const options = [...peopleMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    memberFilter.innerHTML = `<option value="">All people</option>${options.map((p) => (
      `<option value="${Ipon.escapeHtml(p.value)}" data-avatar="${Ipon.escapeHtml(p.avatar_url)}" ${prevVal === p.value || prevVal === p.memberId || prevVal === p.userId ? 'selected' : ''}>${Ipon.escapeHtml(p.name)}</option>`
    )).join('')}`;
    selectedMemberKey = memberFilter.value || '';
    syncTabLinksWithMember();
    Ipon.enhanceMemberSelect?.(memberFilter);
  }

  function updateSummaryCounters() {
    const counts = {
      ALL: allRequests.length,
      PENDING: allRequests.filter((x) => x.status === 'PENDING').length,
      CHANGE: allRequests.filter((x) => x.kind === 'CHANGE').length,
      CHANGE_PENDING: allRequests.filter((x) => x.kind === 'CHANGE' && x.status === 'PENDING').length,
      ADDITION: allRequests.filter((x) => x.kind === 'ADDITION').length,
      ADDITION_PENDING: allRequests.filter((x) => x.kind === 'ADDITION' && x.status === 'PENDING').length,
      DEDUCTION: allRequests.filter((x) => x.kind === 'DEDUCTION').length,
      DEDUCTION_PENDING: allRequests.filter((x) => x.kind === 'DEDUCTION' && x.status === 'PENDING').length,
      EXPENSE: allRequests.filter((x) => x.kind === 'EXPENSE').length,
      EXPENSE_PENDING: allRequests.filter((x) => x.kind === 'EXPENSE' && x.status === 'PENDING').length
    };

    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    setTxt('req-kpi-pending', counts.PENDING);
    setTxt('req-kpi-change', counts.CHANGE_PENDING);
    setTxt('req-kpi-change-sub', `${counts.CHANGE} total change request${counts.CHANGE === 1 ? '' : 's'}`);
    setTxt('req-kpi-addition', counts.ADDITION_PENDING);
    setTxt('req-kpi-addition-sub', `${counts.ADDITION} total addition request${counts.ADDITION === 1 ? '' : 's'}`);
    setTxt('req-kpi-deduction', counts.DEDUCTION_PENDING);
    setTxt('req-kpi-deduction-sub', `${counts.DEDUCTION} total deduction request${counts.DEDUCTION === 1 ? '' : 's'}`);

    setTxt('req-pill-all-count', counts.ALL);
    setTxt('req-pill-change-count', counts.CHANGE);
    setTxt('req-pill-addition-count', counts.ADDITION);
    setTxt('req-pill-deduction-count', counts.DEDUCTION);
    setTxt('req-pill-expense-count', counts.EXPENSE);

    typePillsEl?.querySelectorAll('[data-req-type]').forEach((btn) => {
      const act = btn.dataset.reqType === activeType;
      btn.classList.toggle('is-active', act);
      btn.setAttribute('aria-selected', act ? 'true' : 'false');
    });

    kpiBtns.forEach((btn) => {
      const kpi = btn.dataset.reqKpi;
      const isPendingAll = kpi === 'PENDING_ALL' && activeType === 'ALL' && statusFilter?.value === 'PENDING';
      const isTypeMatch = kpi !== 'PENDING_ALL' && activeType === kpi;
      btn.classList.toggle('is-active', isPendingAll || isTypeMatch);
    });
  }

  function applyFiltersAndRender() {
    const statusVal = String(statusFilter?.value || 'ALL').toUpperCase();
    const memberVal = String(memberFilter?.value || '').trim();
    const methodVal = String(methodFilter?.value || '').trim();
    const fromVal = String(dateFromInput?.value || '').trim();
    const toVal = String(dateToInput?.value || '').trim();
    const q = String(searchInput?.value || '').trim().toLowerCase();

    const selectedMemberObj = memberVal
      ? membersList.find((m) => String(m.id) === memberVal)
      : null;
    const targetUserId = memberVal.startsWith('user:')
      ? memberVal.slice(5)
      : (selectedMemberObj?.user_id ? String(selectedMemberObj.user_id) : '');
    const targetNameLower = selectedMemberObj
      ? String(selectedMemberObj.full_name || '').trim().toLowerCase()
      : (memberVal.startsWith('name:') ? memberVal.slice(5) : '');

    filteredRequests = allRequests.filter((item) => {
      if (activeType !== 'ALL' && item.kind !== activeType) return false;
      if (!statusMatchesFilter(item.status, statusVal)) return false;
      if (memberVal) {
        const matchesId = Boolean(
          (selectedMemberObj && item.subjectMemberId && String(item.subjectMemberId) === String(selectedMemberObj.id))
          || (targetUserId && item.requesterId && String(item.requesterId) === targetUserId)
        );
        const matchesName = Boolean(targetNameLower && (
          String(item.requesterName || '').trim().toLowerCase() === targetNameLower
          || String(item.subjectName || '').trim().toLowerCase() === targetNameLower
        ));
        if (!matchesId && !matchesName) return false;
      }
      if (methodVal === 'UNTAGGED') {
        if (Ipon.normalizePaymentMethod?.(item.paymentMethod)) return false;
      } else if (methodVal) {
        if (Ipon.normalizePaymentMethod?.(item.paymentMethod) !== methodVal) return false;
      }
      if (fromVal && item.dateIso && item.dateIso < fromVal) return false;
      if (toVal && item.dateIso && item.dateIso > toVal) return false;
      if (q && !item.searchBlob.includes(q)) return false;
      return true;
    });

    const total = filteredRequests.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    if (pageIndex >= totalPages) pageIndex = totalPages - 1;
    if (pageIndex < 0) pageIndex = 0;

    if (summaryEl) {
      const pendingFiltered = filteredRequests.filter((x) => x.status === 'PENDING').length;
      summaryEl.textContent = total
        ? `Showing ${total} request${total === 1 ? '' : 's'} (${pendingFiltered} pending review)`
        : 'No matching requests for these filters';
    }

    if (pager) {
      pager.hidden = total <= pageSize;
      const span = pager.querySelector('span');
      const prevBtn = pager.querySelector('[data-page="previous"]');
      const nextBtn = pager.querySelector('[data-page="next"]');
      if (span) span.textContent = `Page ${pageIndex + 1} of ${totalPages}`;
      if (prevBtn) prevBtn.disabled = pageIndex <= 0;
      if (nextBtn) nextBtn.disabled = pageIndex + 1 >= totalPages;
    }

    updateSummaryCounters();
    renderTableSlice();
  }

  function buildRowActionsHtml(item) {
    if (item.kind === 'CHANGE') {
      const canWithdraw = item.status === 'PENDING' && item.requesterId === myUserId;
      const btnLabel = isAdmin && item.status === 'PENDING'
        ? 'Review'
        : (canWithdraw ? 'View / Withdraw' : 'Details');
      const btnCls = isAdmin && item.status === 'PENDING' ? 'icon-action is-review-cta' : 'icon-action is-primary-detail-cta';
      return `<div class="table-actions"><button type="button" class="${btnCls}" data-req-action="review-change" data-req-id="${Ipon.escapeHtml(item.id)}">${btnLabel}</button></div>`;
    }

    const r = item.raw;
    const recType = item.recordType;
    const key = `${recType}:${r.id}`;
    const cInfo = commentCountsByKey.get(key);
    const unreadCount = cInfo && typeof cInfo === 'object' ? Number(cInfo.unread || 0) : Number(cInfo || 0);
    const btns = [];
    if (r.receipt_url) {
      btns.push(`<button type="button" class="icon-action receipt-pill-btn req-card-hide-mobile" data-req-action="receipt" data-rec-type="${recType}" data-rec-id="${Ipon.escapeHtml(r.id)}">Receipt</button>`);
    }
    if (typeof Ipon.recordDiscussionButtonHtml === 'function') {
      btns.push(`<button type="button" class="icon-action record-discuss-btn req-card-hide-mobile${unreadCount > 0 ? ' has-comments' : ''}" data-action="discuss" data-id="${Ipon.escapeHtml(r.id)}" data-req-action="discuss" data-rec-type="${recType}" data-rec-id="${Ipon.escapeHtml(r.id)}">${unreadCount > 0 ? `Discuss <span class="comment-count-pill">${unreadCount}</span>` : 'Discuss'}</button>`);
    }
    if (isAdmin && item.status === 'PENDING') {
      btns.push(`<button type="button" class="icon-action is-confirm-cta" data-req-action="confirm" data-rec-type="${recType}" data-rec-id="${Ipon.escapeHtml(r.id)}">Confirm</button>`);
      btns.push(`<button type="button" class="icon-action is-reject-cta" data-req-action="reject" data-rec-type="${recType}" data-rec-id="${Ipon.escapeHtml(r.id)}">Reject</button>`);
    } else if (isAdmin && item.status === 'CONFIRMED') {
      btns.push(`<button type="button" class="icon-action req-card-hide-mobile" data-req-action="void" data-rec-type="${recType}" data-rec-id="${Ipon.escapeHtml(r.id)}">Void</button>`);
    }
    btns.push(`<button type="button" class="icon-action is-primary-detail-cta" data-req-action="details" data-rec-type="${recType}" data-rec-id="${Ipon.escapeHtml(r.id)}">Details</button>`);
    return `<div class="table-actions">${btns.join('')}</div>`;
  }

  function renderTableSlice() {
    if (!tbody) return;
    const slice = filteredRequests.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
    if (!slice.length) {
      const hasAny = allRequests.length > 0;
      tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${hasAny
        ? 'No user requests match the active filters. Try clearing filters or switching request type.'
        : 'No user change, addition, or deduction requests recorded in this workspace yet.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = slice.map((item) => {
      const meta = TYPE_META[item.kind] || TYPE_META.ADDITION;
      const roleCls = item.requesterRole === 'ADMIN' ? 'is-admin' : item.requesterRole === 'TREASURER' ? 'is-treasurer' : 'is-member';
      const roleLabel = item.requesterRole ? (item.requesterRole.charAt(0) + item.requesterRole.slice(1).toLowerCase()) : 'Member';
      const createdText = item.createdAt ? Ipon.dateLabel(item.createdAt, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : (item.dateIso ? Ipon.dateLabel(item.dateIso) : '');
      const isClosed = ['REJECTED', 'VOIDED', 'CANCELLED'].includes(item.status);
      return `<tr class="${isClosed ? 'row-voided' : ''}">
        <td data-label="Type"><span class="req-type-pill ${meta.badgeClass}">${Ipon.escapeHtml(meta.label)}</span></td>
        <td data-label="Requested by">
          <div class="req-requester-cell">
            ${Ipon.avatarMarkup(item.requesterAvatar || '', item.requesterName || 'Member', 'avatar-sm', item.requesterId || '')}
            <div class="req-requester-copy">
              <strong>${Ipon.escapeHtml(item.requesterName || 'Group member')}${Ipon.verifiedBadgesHtml?.(item.requesterId || item.requesterName) || ''}</strong>
              <small><span class="req-role-tag ${roleCls}">${Ipon.escapeHtml(roleLabel)}</span>${createdText ? ` · ${Ipon.escapeHtml(createdText)}` : ''}</small>
            </div>
          </div>
        </td>
        <td data-label="Details &amp; reason" class="req-details-cell">${item.summaryHtml}</td>
        <td data-label="Method">${Ipon.paymentMethodBadge(item.paymentMethod)}</td>
        <td data-label="Amount" class="amount-cell">${Ipon.money(item.amount)}</td>
        <td data-label="Status">${formatStatusBadge(item.status)}</td>
        <td data-label="Actions" class="row-actions">${buildRowActionsHtml(item)}</td>
      </tr>`;
    }).join('');

    Ipon.bindAvatarFallbacks?.(tbody);
    Ipon.prepareResponsiveTables?.();
  }

  async function load({ silent = false } = {}) {
    if (!silent && tbody && !allRequests.length) {
      tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Loading user requests…</td></tr>';
    }
    try {
      const [
        membersRes,
        identRes,
        crRes,
        contribRes,
        withdrawRes,
        expenseRes
      ] = await Promise.all([
        Ipon.client.from('members').select('id,full_name').eq('status', 'ACTIVE').eq('activation_status', 'ACTIVE').is('deleted_at', null).order('full_name'),
        (async () => {
          try {
            return await Ipon.client.rpc('get_group_member_identities');
          } catch (_) {
            return { data: null, error: true };
          }
        })(),
        Ipon.client.from('financial_change_requests').select('*').order('created_at', { ascending: false }).limit(200),
        Ipon.client.from('contributions').select('id,amount,payment_date,transaction_reference,payment_method,notes,receipt_url,approval_status,void_reason,review_note,submitted_by,created_at,contribution_periods!inner(period_month,members!inner(id,full_name))').order('created_at', { ascending: false }).limit(200),
        Ipon.client.from('withdrawals').select('*').order('created_at', { ascending: false }).limit(200),
        Ipon.client.from('expenses').select('*').order('created_at', { ascending: false }).limit(200)
      ]);

      if (membersRes.error) throw membersRes.error;
      if (crRes.error) throw crRes.error;
      if (contribRes.error) throw contribRes.error;
      if (withdrawRes.error) throw withdrawRes.error;
      if (expenseRes.error) throw expenseRes.error;

      membersList = membersRes.data || [];
      let groupProfiles = (!identRes?.error && Array.isArray(identRes?.data)) ? identRes.data : null;
      if (!groupProfiles) {
        const { data: fallbackProfs } = await Ipon.client.from('profiles').select('id,member_id,full_name,avatar_url,role').eq('status', 'ACTIVE');
        groupProfiles = fallbackProfs || [];
      }

      profilesByUserId.clear();
      profilesByMemberId.clear();
      profilesByName.clear();
      groupProfiles.forEach((p) => {
        if (p?.id) profilesByUserId.set(String(p.id), p);
        if (p?.member_id) profilesByMemberId.set(String(p.member_id), p);
        if (p?.full_name) profilesByName.set(String(p.full_name).trim().toLowerCase(), p);
      });
      Ipon.registerMemberAvatars?.(groupProfiles);

      membersList.forEach((m) => {
        const prof = profilesByMemberId.get(String(m.id)) || profilesByName.get(String(m.full_name || '').trim().toLowerCase());
        if (prof?.avatar_url) m.avatar_url = prof.avatar_url;
        if (prof?.id) m.user_id = prof.id;
      });

      const contribRows = contribRes.data || [];
      const withdrawalRows = withdrawRes.data || [];
      const expenseRows = expenseRes.data || [];
      const changeRows = crRes.data || [];

      const recordSubjectLookup = new Map();
      contribRows.forEach((c) => {
        const subjectName = c.contribution_periods?.members?.full_name || '';
        const subjectMemberId = c.contribution_periods?.members?.id || '';
        recordSubjectLookup.set(`contribution:${c.id}`, { subjectName, subjectMemberId });
      });
      withdrawalRows.forEach((w) => {
        recordSubjectLookup.set(`withdrawal:${w.id}`, { subjectName: w.person_responsible || '', subjectMemberId: '' });
      });
      expenseRows.forEach((e) => {
        recordSubjectLookup.set(`expense:${e.id}`, { subjectName: e.person_responsible || '', subjectMemberId: '' });
      });

      const [cCounts, wCounts, eCounts] = await Promise.all([
        Ipon.getRecordCommentCounts?.('contribution', contribRows.map((x) => x.id)) || Promise.resolve(new Map()),
        Ipon.getRecordCommentCounts?.('withdrawal', withdrawalRows.map((x) => x.id)) || Promise.resolve(new Map()),
        Ipon.getRecordCommentCounts?.('expense', expenseRows.map((x) => x.id)) || Promise.resolve(new Map())
      ]);
      commentCountsByKey.clear();
      cCounts.forEach((v, k) => commentCountsByKey.set(`contribution:${k}`, v));
      wCounts.forEach((v, k) => commentCountsByKey.set(`withdrawal:${k}`, v));
      eCounts.forEach((v, k) => commentCountsByKey.set(`expense:${k}`, v));

      changeRequestsById.clear();
      entriesByKey.clear();

      const normalized = [];

      changeRows.forEach((cr) => {
        const reqProf = resolveProfile(cr.requested_by);
        const linked = recordSubjectLookup.get(`${cr.record_type}:${cr.record_id}`) || {};
        const requesterName = reqProf?.full_name || linked.subjectName || 'Group member';
        const requesterRole = String(reqProf?.role || 'MEMBER').toUpperCase();
        const subjectName = linked.subjectName || requesterName;
        const enrichedRaw = {
          ...cr,
          entry_label: cr.record_type === 'withdrawal' ? 'Deduction' : cr.record_type === 'expense' ? 'Expense' : 'Savings Addition',
          requested_by_name: requesterName,
          requested_by_role: requesterRole,
          avatar_url: reqProf?.avatar_url || null,
          subject_name: subjectName
        };
        changeRequestsById.set(String(cr.id), enrichedRaw);
        const item = {
          id: String(cr.id),
          kind: 'CHANGE',
          recordType: cr.record_type,
          requesterId: cr.requested_by ? String(cr.requested_by) : '',
          requesterName,
          requesterAvatar: reqProf?.avatar_url || '',
          requesterRole,
          subjectMemberId: linked.subjectMemberId ? String(linked.subjectMemberId) : '',
          subjectName,
          paymentMethod: cr.proposed_payment_method || cr.current_payment_method || '',
          amount: Number(cr.proposed_amount || 0),
          dateIso: String(cr.entry_date || cr.created_at || '').slice(0, 10),
          createdAt: cr.created_at || cr.entry_date || '',
          status: String(cr.status || 'PENDING').toUpperCase(),
          raw: enrichedRaw
        };
        item.summaryHtml = buildChangeSummaryHtml(item);
        item.searchBlob = [
          'change request', item.recordType, requesterName, subjectName,
          cr.reason, cr.current_notes, cr.proposed_notes, cr.review_note,
          cr.proposed_amount, cr.current_amount, item.paymentMethod, item.status
        ].filter(Boolean).join(' ').toLowerCase();
        normalized.push(item);
      });

      contribRows.forEach((c) => {
        const memberName = c.contribution_periods?.members?.full_name || 'Group member';
        const memberId = c.contribution_periods?.members?.id ? String(c.contribution_periods.members.id) : '';
        const reqProf = resolveProfile(c.submitted_by, memberName);
        if (!shouldIncludeEntryRequest(c, reqProf)) return;
        const requesterName = reqProf?.full_name || memberName;
        const requesterRole = String(reqProf?.role || 'MEMBER').toUpperCase();
        const item = {
          id: String(c.id),
          kind: 'ADDITION',
          recordType: 'contribution',
          requesterId: c.submitted_by ? String(c.submitted_by) : (reqProf?.id ? String(reqProf.id) : ''),
          requesterName,
          requesterAvatar: reqProf?.avatar_url || '',
          requesterRole,
          subjectMemberId: memberId,
          subjectName: memberName,
          periodMonth: c.contribution_periods?.period_month || '',
          paymentMethod: c.payment_method || '',
          amount: Number(c.amount || 0),
          dateIso: String(c.payment_date || '').slice(0, 10),
          createdAt: c.created_at || c.payment_date || '',
          status: String(c.approval_status || 'PENDING').toUpperCase(),
          raw: c
        };
        entriesByKey.set(`contribution:${c.id}`, item);
        item.summaryHtml = buildEntrySummaryHtml(item);
        item.searchBlob = [
          'addition request', requesterName, memberName, c.notes, c.review_note,
          c.void_reason, c.transaction_reference, c.amount, item.paymentMethod, item.status
        ].filter(Boolean).join(' ').toLowerCase();
        normalized.push(item);
      });

      withdrawalRows.forEach((w) => {
        const reqProf = resolveProfile(w.submitted_by, w.person_responsible);
        if (!shouldIncludeEntryRequest(w, reqProf)) return;
        const requesterName = reqProf?.full_name || w.person_responsible || 'Group member';
        const requesterRole = String(reqProf?.role || 'MEMBER').toUpperCase();
        const item = {
          id: String(w.id),
          kind: 'DEDUCTION',
          recordType: 'withdrawal',
          requesterId: w.submitted_by ? String(w.submitted_by) : (reqProf?.id ? String(reqProf.id) : ''),
          requesterName,
          requesterAvatar: reqProf?.avatar_url || '',
          requesterRole,
          subjectMemberId: reqProf?.member_id ? String(reqProf.member_id) : '',
          subjectName: w.person_responsible || requesterName,
          paymentMethod: w.payment_method || '',
          amount: Number(w.amount || 0),
          dateIso: String(w.transaction_date || '').slice(0, 10),
          createdAt: w.created_at || w.transaction_date || '',
          status: String(w.approval_status || 'PENDING').toUpperCase(),
          raw: w
        };
        entriesByKey.set(`withdrawal:${w.id}`, item);
        item.summaryHtml = buildEntrySummaryHtml(item);
        item.searchBlob = [
          'deduction request', requesterName, w.person_responsible, w.category, w.description,
          w.notes, w.review_note, w.void_reason, w.reference_number, w.transaction_reference,
          w.amount, item.paymentMethod, item.status
        ].filter(Boolean).join(' ').toLowerCase();
        normalized.push(item);
      });

      expenseRows.forEach((e) => {
        const reqProf = resolveProfile(e.submitted_by, e.person_responsible);
        if (!shouldIncludeEntryRequest(e, reqProf)) return;
        const requesterName = reqProf?.full_name || e.person_responsible || 'Group member';
        const requesterRole = String(reqProf?.role || 'MEMBER').toUpperCase();
        const item = {
          id: String(e.id),
          kind: 'EXPENSE',
          recordType: 'expense',
          requesterId: e.submitted_by ? String(e.submitted_by) : (reqProf?.id ? String(reqProf.id) : ''),
          requesterName,
          requesterAvatar: reqProf?.avatar_url || '',
          requesterRole,
          subjectMemberId: reqProf?.member_id ? String(reqProf.member_id) : '',
          subjectName: e.person_responsible || requesterName,
          paymentMethod: e.payment_method || '',
          amount: Number(e.amount || 0),
          dateIso: String(e.transaction_date || '').slice(0, 10),
          createdAt: e.created_at || e.transaction_date || '',
          status: String(e.approval_status || 'PENDING').toUpperCase(),
          raw: e
        };
        entriesByKey.set(`expense:${e.id}`, item);
        item.summaryHtml = buildEntrySummaryHtml(item);
        item.searchBlob = [
          'expense request', requesterName, e.person_responsible, e.category, e.description,
          e.notes, e.review_note, e.void_reason, e.reference_number, e.transaction_reference,
          e.amount, item.paymentMethod, item.status
        ].filter(Boolean).join(' ').toLowerCase();
        normalized.push(item);
      });

      normalized.sort((a, b) => {
        const ap = a.status === 'PENDING' ? 0 : 1;
        const bp = b.status === 'PENDING' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });

      allRequests = normalized;
      populateMemberFilter();
      applyFiltersAndRender();
    } catch (error) {
      if (summaryEl) summaryEl.textContent = 'Unable to load requests';
      Ipon.showInlineError(tbody, error, () => load(), 7);
    }
  }

  typePillsEl?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-req-type]');
    if (!btn) return;
    activeType = btn.dataset.reqType || 'ALL';
    pageIndex = 0;
    applyFiltersAndRender();
  });

  kpiBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const kpi = btn.dataset.reqKpi;
      if (kpi === 'PENDING_ALL') {
        activeType = 'ALL';
        if (statusFilter) statusFilter.value = 'PENDING';
      } else if (kpi) {
        activeType = kpi;
        if (statusFilter) statusFilter.value = 'ALL';
      }
      pageIndex = 0;
      applyFiltersAndRender();
    });
  });

  [statusFilter, memberFilter, methodFilter].forEach((sel) => {
    sel?.addEventListener('change', () => {
      if (sel === memberFilter) {
        selectedMemberKey = memberFilter.value || '';
        syncTabLinksWithMember();
      }
      pageIndex = 0;
      applyFiltersAndRender();
    });
  });

  const initialDateMax = dateFromInput?.getAttribute?.('max') || dateToInput?.getAttribute?.('max') || '';

  function formatFilterDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
    try {
      return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
        .format(new Date(`${iso}T00:00:00+08:00`));
    } catch {
      return iso;
    }
  }

  function syncDateFilterChips(changedInput = null) {
    if (dateFromInput?.value && dateToInput?.value && dateFromInput.value > dateToInput.value) {
      if (changedInput === dateFromInput) dateToInput.value = dateFromInput.value;
      else if (changedInput === dateToInput) dateFromInput.value = dateToInput.value;
      else {
        const tmp = dateFromInput.value;
        dateFromInput.value = dateToInput.value;
        dateToInput.value = tmp;
      }
    }
    if (dateFromInput) dateFromInput.max = dateToInput?.value || initialDateMax;
    if (dateToInput) dateToInput.min = dateFromInput?.value || '2000-01-01';

    [
      { input: dateFromInput, placeholder: 'Start date', labelEl: document.getElementById('req-date-from-label') },
      { input: dateToInput, placeholder: 'End date', labelEl: document.getElementById('req-date-to-label') }
    ].forEach(({ input, placeholder, labelEl }) => {
      if (!input) return;
      const val = input.value || '';
      const chip = document.querySelector?.(`[data-date-chip="${input.id}"]`);
      const clearBtn = document.querySelector?.(`[data-clear-date="${input.id}"]`);
      if (chip) {
        if (chip.dataset) chip.dataset.empty = val ? 'false' : 'true';
        chip.classList?.toggle('is-filled', Boolean(val));
      }
      if (labelEl) labelEl.textContent = val ? formatFilterDate(val) : placeholder;
      if (clearBtn) clearBtn.hidden = !val;
    });
  }

  syncDateFilterChips();

  [dateFromInput, dateToInput].forEach((inp) => {
    inp?.addEventListener('change', (ev) => {
      syncDateFilterChips(ev.target);
      pageIndex = 0;
      applyFiltersAndRender();
    });
  });

  document.querySelectorAll?.('[data-date-chip]')?.forEach((chip) => {
    chip.addEventListener?.('click', (event) => {
      if (event.target?.closest?.('[data-clear-date]')) return;
      const inp = document.getElementById(chip.dataset?.dateChip);
      try { inp?.showPicker?.(); } catch {}
    });
  });

  document.querySelectorAll?.('[data-clear-date]')?.forEach((btn) => {
    btn.addEventListener?.('click', (event) => {
      event.preventDefault?.();
      event.stopPropagation?.();
      const inp = document.getElementById(btn.dataset?.clearDate);
      if (inp) inp.value = '';
      syncDateFilterChips();
      pageIndex = 0;
      applyFiltersAndRender();
    });
  });

  searchInput?.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      pageIndex = 0;
      applyFiltersAndRender();
    }, 150);
  });

  resetBtn?.addEventListener('click', () => {
    activeType = 'ALL';
    if (searchInput) searchInput.value = '';
    if (statusFilter) statusFilter.value = 'ALL';
    if (memberFilter) {
      memberFilter.value = '';
      memberFilter._customSelect?.sync?.();
    }
    selectedMemberKey = '';
    syncTabLinksWithMember();
    if (methodFilter) {
      methodFilter.value = '';
      methodFilter._customSelect?.sync?.();
    }
    if (dateFromInput) dateFromInput.value = '';
    if (dateToInput) dateToInput.value = '';
    syncDateFilterChips();
    pageIndex = 0;
    applyFiltersAndRender();
  });

  pager?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    pageIndex += btn.dataset.page === 'next' ? 1 : -1;
    applyFiltersAndRender();
  });

  tbody?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-req-action]');
    if (!btn) return;
    const action = btn.dataset.reqAction;

    if (action === 'review-change') {
      const cr = changeRequestsById.get(String(btn.dataset.reqId || ''));
      if (!cr) return;
      await Ipon.openChangeRequestReviewDialog?.(cr, {
        allowReview: isAdmin,
        onReviewed: () => load({ silent: true })
      });
      return;
    }

    const recType = btn.dataset.recType;
    const recId = btn.dataset.recId;
    const item = entriesByKey.get(`${recType}:${recId}`);
    if (!item) return;
    const r = item.raw;

    if (action === 'receipt') {
      if (r.receipt_url) {
        Ipon.openImageViewer?.(r.receipt_url, `${item.subjectName || item.requesterName} receipt`, `${Ipon.money(item.amount)} · ${Ipon.dateLabel(item.dateIso)}`);
      }
      return;
    }

    if (action === 'discuss') {
      await Ipon.openRecordDiscussion?.(recType, r.id, { onUpdated: () => load({ silent: true }) });
      return;
    }

    if (action === 'details') {
      await Ipon.openRecordDetails?.(recType, r.id, { allowReview: isAdmin, onUpdated: () => load({ silent: true }) });
      return;
    }

    if (action === 'confirm' || action === 'reject' || action === 'void') {
      const typeLabel = recType === 'contribution' ? 'Savings Addition' : recType === 'withdrawal' ? 'Deduction' : 'Expense';
      const entry = {
        id: r.id,
        type: recType,
        typeLabel,
        authorName: item.subjectName || item.requesterName || 'Group member',
        submittedByName: item.requesterName || '',
        avatarUrl: item.requesterAvatar || '',
        amount: item.amount,
        date: item.dateIso,
        periodMonth: item.periodMonth || '',
        category: r.category || '',
        paymentMethod: item.paymentMethod || '',
        reference: r.transaction_reference || r.reference_number || '',
        notes: r.notes || '',
        description: r.description || '',
        receiptUrl: r.receipt_url || '',
        status: item.status
      };
      await Ipon.requestRecordAction?.({
        title: `${action.charAt(0).toUpperCase()}${action.slice(1)} ${typeLabel.toLowerCase()}`,
        actions: [action.toUpperCase()],
        entry,
        onSubmit: async ({ note }) => {
          if (action === 'void') {
            await Ipon.rpc(`void_${recType}`, { [`p_${recType}_id`]: r.id, p_reason: note });
          } else {
            await Ipon.rpc(`review_${recType}`, {
              [`p_${recType}_id`]: r.id,
              p_decision: action === 'confirm' ? 'CONFIRMED' : 'REJECTED',
              p_review_note: note
            });
          }
          Ipon.toast(`${typeLabel} ${action === 'void' ? 'voided' : action === 'confirm' ? 'confirmed' : 'rejected'}.`);
          await load({ silent: true });
        }
      });
    }
  });

  try {
    await load();
  } finally {
    Ipon.setLoading(false);
  }

  Ipon.subscribeToChanges?.('requests', ['financial_change_requests', 'contributions', 'withdrawals', 'expenses', 'record_comments'], () => {
    load({ silent: true }).catch(() => { });
  });
})();
