import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Requests tab sits cleanly beside Additions, Deductions, Expenses, and Goals across all record pages and maps sidebar nav cleanly', () => {
  const pages = ['contributions.html', 'withdrawals.html', 'expenses.html', 'savings.html', 'requests.html'];
  for (const page of pages) {
    const html = read(page);
    const tabsMatch = html.match(/<nav class="record-tabs"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(tabsMatch, `${page} must render .record-tabs`);
    assert.match(tabsMatch[1], /href="contributions\.html"[\s\S]*?Additions/);
    assert.match(tabsMatch[1], /href="withdrawals\.html"[\s\S]*?Deductions/);
    assert.match(tabsMatch[1], /href="expenses\.html"[\s\S]*?Expenses/);
    assert.match(tabsMatch[1], /href="savings\.html"[\s\S]*?Goals/);
    assert.match(tabsMatch[1], /href="requests\.html"[\s\S]*?Requests/);
  }

  const reqHtml = read('requests.html');
  assert.match(reqHtml, /<body data-page="requests">/);
  assert.match(reqHtml, /<a class="is-active" href="requests\.html">/);
  assert.match(reqHtml, /js\/requests\.js/);

  const coreJs = read('js/core.js');
  assert.match(coreJs, /'requests\.html':\s*'<svg/);
  assert.match(coreJs, /requests:\s*\['ADMIN', 'TREASURER', 'MEMBER'\]/);
  assert.match(coreJs, /\['contributions', 'withdrawals', 'expenses', 'savings', 'requests'\]\.includes\(page\)/);

  const css = read('css/app.css');
  assert.match(css, /\.requests-type-pills\s*\{/);
  assert.match(css, /\.requests-filters\s*\{/);
  assert.match(css, /\.req-type-pill\.is-change\s*\{/);
});

test('js/requests.js loads, filters by type/status/member/method/search, and invokes change & entry review flows without error', async () => {
  const requestsJs = read('js/requests.js');
  const meAdminId = '11111111-1111-4111-8111-111111111111';
  const memberUserId = '22222222-2222-4222-8222-222222222222';
  const memberId = '33333333-3333-4333-8333-333333333333';

  const makeEl = (tag = 'div') => {
    const attrs = new Map();
    const classes = new Set();
    const listeners = new Map();
    return {
      tagName: String(tag).toUpperCase(),
      innerHTML: '',
      textContent: '',
      value: '',
      options: [{ value: 'ALL' }, { value: 'PENDING' }, { value: 'APPROVED_CONFIRMED' }, { value: 'REJECTED' }, { value: 'VOIDED_CANCELLED' }],
      hidden: false,
      disabled: false,
      dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => classes.add(x)),
        remove: (...c) => c.forEach((x) => classes.delete(x)),
        toggle: (c, f) => (f === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (f ? classes.add(c) : classes.delete(c))),
        contains: (c) => classes.has(c)
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: (k) => attrs.get(k) ?? null,
      removeAttribute: (k) => attrs.delete(k),
      querySelector: () => null,
      querySelectorAll: () => [],
      closest: () => null,
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      async _emit(ev, evObj = {}) {
        for (const fn of (listeners.get(ev) || [])) {
          await fn(evObj);
        }
      }
    };
  };

  const els = new Map();
  const getEl = (id) => {
    if (!els.has(id)) els.set(id, makeEl(id.includes('filter') ? 'select' : 'div'));
    return els.get(id);
  };

  const statusSel = getEl('req-status-filter');
  statusSel.value = 'ALL';
  const pillAll = Object.assign(makeEl('button'), { dataset: { reqType: 'ALL' } });
  const pillChange = Object.assign(makeEl('button'), { dataset: { reqType: 'CHANGE' } });
  const pillAddition = Object.assign(makeEl('button'), { dataset: { reqType: 'ADDITION' } });
  const pillDeduction = Object.assign(makeEl('button'), { dataset: { reqType: 'DEDUCTION' } });
  const pillsHost = getEl('req-type-pills');
  pillsHost.querySelectorAll = () => [pillAll, pillChange, pillAddition, pillDeduction];

  const reviewCalls = [];
  const rpcCalls = [];
  const dialogCalls = [];

  const mockTables = {
    members: [{ id: memberId, full_name: 'Maria Santos' }],
    financial_change_requests: [
      {
        id: 'cr-1',
        record_type: 'contribution',
        record_id: 'c-confirmed',
        requested_by: memberUserId,
        status: 'PENDING',
        current_amount: 200,
        proposed_amount: 350,
        current_payment_method: 'CASH',
        proposed_payment_method: 'GCASH',
        current_notes: 'Old note',
        proposed_notes: 'Adjusted after GCash receipt',
        reason: 'Wrong amount entered earlier',
        entry_date: '2026-11-15',
        created_at: '2026-11-17T09:00:00Z'
      }
    ],
    contributions: [
      {
        id: 'add-pending-1',
        amount: 500,
        payment_date: '2026-11-16',
        payment_method: 'GCASH',
        notes: 'November share',
        approval_status: 'PENDING',
        submitted_by: memberUserId,
        created_at: '2026-11-17T08:00:00Z',
        contribution_periods: { period_month: '2026-11-01', members: { id: memberId, full_name: 'Maria Santos' } }
      },
      {
        id: 'add-admin-direct',
        amount: 200,
        payment_date: '2026-11-10',
        payment_method: 'CASH',
        notes: 'Direct admin entry',
        approval_status: 'CONFIRMED',
        submitted_by: meAdminId,
        created_at: '2026-11-10T08:00:00Z',
        contribution_periods: { period_month: '2026-11-01', members: { id: memberId, full_name: 'Maria Santos' } }
      }
    ],
    withdrawals: [
      {
        id: 'wd-rejected-1',
        amount: 150,
        category: 'Emergency',
        description: 'Pharmacy reimbursement',
        person_responsible: 'Maria Santos',
        payment_method: 'CASH',
        transaction_date: '2026-11-14',
        approval_status: 'REJECTED',
        review_note: 'Need official receipt first',
        submitted_by: memberUserId,
        created_at: '2026-11-17T07:00:00Z'
      }
    ],
    expenses: []
  };

  const makeQuery = (table) => {
    const q = {
      select() { return q; },
      eq() { return q; },
      is() { return q; },
      order() { return q; },
      limit: async () => ({ data: mockTables[table] || [], error: null })
    };
    return q;
  };

  const ctx = {
    window: null,
    URLSearchParams,
    Map, Set, Object, Array, String, Number, Boolean, Math, Date, JSON, Promise, RegExp, Error, Intl,
    setTimeout, clearTimeout,
    console,
    document: {
      body: Object.assign(makeEl('body'), { dataset: { page: 'requests' } }),
      getElementById: (id) => getEl(id),
      querySelector: () => null,
      querySelectorAll: () => []
    },
    location: { href: 'https://myipon.example/requests.html', search: '' },
    Ipon: {
      init: async () => ({ failed: false, redirecting: false, configured: true, profile: { id: meAdminId, role: 'ADMIN', group_id: 'grp-1' } }),
      setLoading() { },
      escapeHtml: (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
      money: (n) => `₱${Number(n || 0).toFixed(2)}`,
      dateLabel: (d) => String(d || ''),
      avatarMarkup: () => '<span class="avatar-circle avatar-sm">MS</span>',
      normalizePaymentMethod: (m) => String(m || '').toUpperCase(),
      paymentMethodMeta: (m) => ({ label: m || 'Untagged' }),
      paymentMethodBadge: (m) => `<span class="pm-badge">${m || 'Untagged'}</span>`,
      paymentMethodOptionsHtml: () => '<option value="">All methods</option><option value="GCASH">GCash</option>',
      recordDiscussionButtonHtml: () => '<button type="button">Discuss</button>',
      openChangeRequestReviewDialog: async (req, opts) => { reviewCalls.push({ req, opts }); },
      requestRecordAction: async ({ onSubmit, entry, actions }) => {
        dialogCalls.push({ entry, actions });
        await onSubmit({ note: 'Verified receipt' });
      },
      rpc: async (name, params) => { rpcCalls.push({ name, params }); },
      toast() { },
      subscribeToChanges() { },
      bindAvatarFallbacks() { },
      syncPresenceDots() { },
      prepareResponsiveTables() { },
      registerMemberAvatars() { },
      enhanceMemberSelect() { },
      enhancePaymentSelect() { },
      getRecordCommentCounts: async (type) => {
        if (type === 'contribution') return new Map([['add-pending-1', { total: 3, unread: 2 }]]);
        if (type === 'withdrawal') return new Map([['wd-rejected-1', { total: 1, unread: 0 }]]);
        return new Map();
      },
      showInlineError(el, err) { el.textContent = String(err?.message || err); },
      client: {
        from: (t) => makeQuery(t),
        rpc: async (fn) => {
          if (fn === 'get_group_member_identities') {
            return {
              data: [
                { id: meAdminId, full_name: 'Admin User', role: 'ADMIN', avatar_url: null },
                { id: memberUserId, member_id: memberId, full_name: 'Maria Santos', role: 'MEMBER', avatar_url: null }
              ],
              error: null
            };
          }
          return { data: [], error: null };
        }
      }
    }
  };
  ctx.window = ctx;
  ctx.window.location = ctx.location;

  await vm.runInNewContext(requestsJs, ctx);

  // Admin direct CONFIRMED entry excluded; member change + pending addition + rejected deduction shown (3 total, 2 pending)
  assert.equal(getEl('req-kpi-pending').textContent, '2');
  assert.equal(getEl('req-kpi-change').textContent, '1');
  assert.equal(getEl('req-kpi-addition').textContent, '1');
  assert.equal(getEl('req-kpi-deduction').textContent, '0');
  assert.equal(getEl('req-pill-all-count').textContent, '3');

  const initialHtml = getEl('requests-body').innerHTML;
  assert.match(initialHtml, /Change request/);
  assert.match(initialHtml, /Addition request/);
  assert.match(initialHtml, /Deduction request/);
  assert.match(initialHtml, /Wrong amount entered earlier/);
  assert.match(initialHtml, /req-details-card/);
  assert.match(initialHtml, /req-mobile-entry-amt/);
  assert.match(initialHtml, /req-card-hide-mobile/);
  assert.match(initialHtml, /req-status-dot/);
  assert.doesNotMatch(initialHtml, /req-btn-chevron/);
  assert.match(initialHtml, /Discuss <span class="comment-count-pill">2<\/span>/);
  assert.doesNotMatch(initialHtml, /\[object Object\]/);
  assert.doesNotMatch(initialHtml, /Direct admin entry/);

  const cssSrc = read('css/app.css');
  assert.doesNotMatch(cssSrc, /d5ab54|c89b44/i);
  assert.match(cssSrc, /grid-template-areas:\s*"type status"/);
  assert.match(cssSrc, /^\.date-filter-chip input\[type="date"\]/m);
  assert.match(cssSrc, /\.form-dialog\s+\.change-review-body\s+form\.change-review-form\s*\{[^}]*padding:\s*0/);
  assert.match(cssSrc, /\.change-review-actions[\s\S]*grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(cssSrc, /\.change-summary-card\s*\{/);
  assert.match(read('js/core.js'), /class="change-summary-card"/);

  const reqHtml = read('requests.html');
  assert.match(reqHtml, /data-date-chip="req-date-from"/);
  assert.match(reqHtml, /data-date-chip="req-date-to"/);
  assert.match(reqHtml, /id="req-date-from-label">Start date</);
  assert.match(reqHtml, /id="req-date-to-label">End date</);

  // Filter by CHANGE pill
  await pillsHost._emit('click', { target: { closest: () => pillChange } });
  const changeOnlyHtml = getEl('requests-body').innerHTML;
  assert.match(changeOnlyHtml, /Change request/);
  assert.doesNotMatch(changeOnlyHtml, /Addition request/);

  // Reset filters shows all 3 again
  await getEl('req-reset-filters')._emit('click');
  assert.match(getEl('requests-body').innerHTML, /Deduction request/);

  // Click Review on Change Request
  await getEl('requests-body')._emit('click', {
    target: { closest: () => ({ dataset: { reqAction: 'review-change', reqId: 'cr-1' } }) }
  });
  assert.equal(reviewCalls.length, 1);
  assert.equal(reviewCalls[0].req.id, 'cr-1');
  assert.equal(reviewCalls[0].opts.allowReview, true);

  // Click Confirm on pending Addition Request
  await getEl('requests-body')._emit('click', {
    target: { closest: () => ({ dataset: { reqAction: 'confirm', recType: 'contribution', recId: 'add-pending-1' } }) }
  });
  assert.equal(dialogCalls[0]?.actions?.[0], 'CONFIRM');
  assert.equal(rpcCalls[0]?.name, 'review_contribution');
  assert.equal(rpcCalls[0]?.params?.p_decision, 'CONFIRMED');
});
