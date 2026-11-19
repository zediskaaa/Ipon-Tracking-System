import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Migration 102 adds per-member workspace permissions and calendar change-request approval workflow end-to-end', async () => {
  const mig102 = read('database/migrations/20261117_102_member_permissions_and_change_requests.sql');
  const schema = read('database/schema.sql');
  const coreJs = read('js/core.js');
  const dashHtml = read('dashboard.html');
  const dashJs = read('js/dashboard.js');
  const membersHtml = read('members.html');
  const membersJs = read('js/members.js');
  const recordsJs = read('js/records.js');
  const userJs = read('js/user.js');
  const authJs = read('js/auth.js');
  const css = read('css/app.css');

  // 1. SQL schema & RPC contracts
  for (const sql of [mig102, schema]) {
    for (const col of [
      'can_edit_own_entries',
      'require_edit_approval',
      'require_add_approval',
      'can_record_expenses',
      'require_expense_approval',
      'can_record_withdrawals',
      'require_withdrawal_approval'
    ]) {
      assert.match(sql, new RegExp(`add column if not exists ${col} boolean not null`, 'i'));
    }
    assert.match(sql, /create table if not exists public\.financial_change_requests/i);
    assert.match(sql, /financial_change_requests_one_pending_idx/i);
    assert.match(sql, /alter table public\.financial_change_requests enable row level security/i);
    assert.match(sql, /create or replace function public\.get_my_member_permissions\(\)/i);
    assert.match(sql, /create or replace function public\.get_member_permissions_list\(\)/i);
    assert.match(sql, /create or replace function public\.update_member_permissions\(/i);
    assert.match(sql, /create or replace function public\.submit_record_change_request\(/i);
    assert.match(sql, /create or replace function public\.review_financial_change_request\(/i);
    assert.match(sql, /create or replace function public\.cancel_financial_change_request\(/i);
    assert.match(sql, /create or replace function public\.get_pending_financial_change_requests\(\)/i);
    assert.match(sql, /'20261117_102'/);
  }

  // 2. Frontend dialogs, permissions enforcement & notification routing
  assert.match(coreJs, /function defaultPermissionsForRole\(/);
  assert.match(coreJs, /function refreshMyPermissions\(/);
  assert.match(coreJs, /function openCalendarEntryEditDialog\(/);
  assert.match(coreJs, /function openChangeRequestReviewDialog\(/);
  assert.doesNotMatch(coreJs, /parsedAmount\.amount\b/);
  assert.match(coreJs, /RECORD_CHANGE_REQUESTED/);
  assert.match(coreJs, /RECORD_CHANGE_REVIEWED/);
  assert.match(coreJs, /PERMISSION_UPDATED/);

  assert.match(dashHtml, /id="dashboard-change-requests"/);
  assert.match(dashJs, /openCalendarEntryEditDialog\(/);
  assert.match(dashJs, /openChangeRequestReviewDialog\(/);
  assert.match(dashJs, /canEditCalendarEntry\(/);
  assert.match(dashJs, /changeRequestsWrap/);
  assert.match(dashJs, /canDeduction/);
  assert.match(dashJs, /canExpense/);

  assert.match(membersHtml, /id="member-permissions-panel"/);
  assert.match(membersHtml, /id="member-permissions-list"/);
  assert.match(membersHtml, /id="member-permissions-dialog"/);
  assert.match(membersJs, /get_member_permissions_list/);
  assert.match(membersJs, /update_member_permissions/);
  assert.match(membersJs, /openMemberPermissionsModal/);
  assert.match(membersJs, /saveUserPermissions/);

  assert.match(recordsJs, /canRecordExpenses/);
  assert.match(recordsJs, /canRecordWithdrawals/);
  assert.match(userJs, /require_add_approval/);

  // 3. Responsive CSS + HTML ID uniqueness & dialog balance
  for (const selector of [
    /\.day-entry-edit-btn\s*\{/,
    /\.day-entry-pending-strip\s*\{/,
    /\.entry-edit-dialog[\s\S]*?\{/,
    /\.change-review-dialog[\s\S]*?\{/,
    /\.member-perm-rule-chips\s*\{/,
    /\.member-perm-dialog\s*\{/,
    /\.member-perm-groups\s*\{/,
    /html\[data-theme="dark"\]\s+\.member-perm-sheet\s*\{/
  ]) {
    assert.match(css, selector);
  }
  for (const [name, html] of [['dashboard.html', dashHtml], ['members.html', membersHtml]]) {
    const opens = (html.match(/<dialog\b/g) || []).length;
    const closes = (html.match(/<\/dialog>/g) || []).length;
    assert.equal(opens, closes, `${name} has unbalanced <dialog> tags`);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${name} has duplicate IDs`);
  }

  // 4. Runtime VM verification: permissions exports, 6-char code typing cap, single error rendering & edit RPC payload
  const noop = () => {};
  const rpcCalls = [];
  const domById = new Map();
  const makeCtrl = (id = '') => {
    const attrs = {};
    const listeners = {};
    const clsSet = new Set();
    const el = {
      id,
      attrs,
      dataset: {},
      listeners,
      classList: {
        add: (...c) => c.forEach((x) => clsSet.add(x)),
        remove: (...c) => c.forEach((x) => clsSet.delete(x)),
        toggle: (x, f) => (f ? clsSet.add(x) : clsSet.delete(x)),
        contains: (x) => clsSet.has(x)
      },
      style: {},
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      hidden: false,
      open: false,
      validity: { badInput: false },
      elements: {},
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; },
      toggleAttribute(k, f) { if (f) attrs[k] = ''; else delete attrs[k]; },
      hasAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k); },
      setCustomValidity(m) { this.validityMsg = m; },
      addEventListener(ev, fn, opts) { (listeners[ev] ||= []).push({ fn, once: Boolean(opts?.once) }); },
      closest: () => null,
      focus: noop,
      reset() { this.value = ''; },
      showModal() { this.open = true; },
      close(rv = '') { this.open = false; this.returnValue = rv; this.onclose?.(); const list = listeners.close || []; listeners.close = list.filter((item) => { item.fn(); return !item.once; }); },
      querySelector(sel) {
        const m = sel.match(/^#([a-zA-Z0-9_-]+)$/);
        if (m && domById.has(m[1])) return domById.get(m[1]);
        return dummyEl();
      },
      querySelectorAll: () => [],
      insertAdjacentHTML: noop
    };
    if (id) domById.set(id, el);
    return el;
  };
  const dummyEl = () => makeCtrl('');
  const ensureDialogNodes = () => {
    const formEl = makeCtrl('ipon-entry-edit-form');
    const pmCtrl = makeCtrl('ipon-entry-edit-pm');
    pmCtrl.value = 'MAYA';
    formEl.elements = { payment_method: pmCtrl };
    makeCtrl('ipon-entry-edit-summary');
    makeCtrl('ipon-entry-edit-banner');
    makeCtrl('ipon-entry-edit-amount');
    makeCtrl('ipon-entry-edit-amount-error');
    makeCtrl('ipon-entry-edit-date-display');
    makeCtrl('ipon-entry-edit-notes');
    makeCtrl('ipon-entry-edit-reason');
    makeCtrl('ipon-entry-edit-reason-error');
    makeCtrl('ipon-entry-edit-submit');
    makeCtrl('ipon-entry-edit-eyebrow');
    makeCtrl('ipon-entry-edit-title');
    makeCtrl('ipon-entry-edit-copy');
    makeCtrl('ipon-entry-edit-close');
    makeCtrl('ipon-entry-edit-cancel');
    makeCtrl('confirm-title');
    makeCtrl('confirm-message');
    makeCtrl('confirm-cancel');
    makeCtrl('confirm-accept');
    makeCtrl('confirm-dialog');
    return makeCtrl('ipon-entry-edit-dialog');
  };
  const ctx = {
    console, TextEncoder, URL, URLSearchParams, Intl, Math, Date, Number, String, JSON,
    Uint8Array, Array, Set, Map,
    HTMLInputElement: class HTMLInputElement {},
    HTMLElement: class HTMLElement {},
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', origin: 'https://my-ipon.vercel.app', search: '', href: 'https://my-ipon.vercel.app/dashboard.html', replace: noop, assign: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { replaceState: noop },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    window: null,
    document: {
      documentElement: { setAttribute: noop, dataset: {}, style: { setProperty: noop, removeProperty: noop } },
      head: { insertAdjacentHTML: noop },
      body: {
        dataset: {},
        classList: { contains: () => false, add: noop, remove: noop, toggle: noop },
        insertAdjacentHTML(_pos, html) { if (String(html).includes('ipon-entry-edit-dialog')) ensureDialogNodes(); },
        appendChild: noop, prepend: noop, append: noop
      },
      createElement: () => dummyEl(),
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: (id) => domById.get(id) || null,
      querySelectorAll: () => [],
      querySelector: () => null
    },
    supabase: {
      createClient: () => ({
        rpc: async (fn, params) => {
          rpcCalls.push({ fn, params });
          if (fn === 'preview_group_invite_code') {
            return { data: { valid: false, message: 'Group invite code not found. Double-check the 6-character code or ask your admin for a new link.' }, error: null };
          }
          if (fn === 'submit_record_change_request') {
            return { data: { status: 'PENDING_APPROVAL', request_id: 'cr-1', message: 'Change request sent to your administrator for approval.' }, error: null };
          }
          return { data: {}, error: null };
        },
        channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
        getChannels: () => []
      })
    }
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });

  const ipon = ctx.window.Ipon;
  assert.equal(typeof ipon.defaultPermissionsForRole, 'function');
  assert.equal(typeof ipon.refreshMyPermissions, 'function');
  assert.equal(typeof ipon.openCalendarEntryEditDialog, 'function');
  assert.equal(typeof ipon.openChangeRequestReviewDialog, 'function');
  assert.equal(typeof ipon.bindInviteCodeInput, 'function');
  assert.equal(ipon.defaultPermissionsForRole('MEMBER').can_edit_own_entries, true);
  assert.equal(ipon.defaultPermissionsForRole('MEMBER').can_record_expenses, false);
  assert.equal(ipon.defaultPermissionsForRole('TREASURER').can_record_expenses, true);
  assert.equal(ipon.extractInviteCode('https://my-ipon.vercel.app/login.html'), '');
  assert.match(authJs, /preview_group_invite_code/);

  // Submit calendar entry edit dialog and verify exact p_amount & RPC payload
  const editPromise = ipon.openCalendarEntryEditDialog({
    id: '11111111-1111-1111-1111-111111111111',
    type: 'contribution',
    subjectName: 'Zedrick De Monteverde',
    amount: 100,
    paymentMethod: 'GCASH',
    date: '2026-11-14',
    notes: '',
    status: 'CONFIRMED'
  });
  await new Promise((r) => setTimeout(r, 5));
  domById.get('ipon-entry-edit-amount').value = '250';
  domById.get('ipon-entry-edit-form').elements.payment_method.value = 'MAYA';
  domById.get('ipon-entry-edit-notes').value = 'Updated receipt ref';
  domById.get('ipon-entry-edit-reason').value = 'Paid via Maya instead of GCash';
  const submitExec = domById.get('ipon-entry-edit-form').onsubmit({ preventDefault: noop });
  await new Promise((r) => setTimeout(r, 15));
  domById.get('confirm-dialog').close('confirm');
  await submitExec;
  const editResult = await editPromise;
  assert.equal(editResult?.status, 'PENDING_APPROVAL');
  const submitCall = rpcCalls.find((c) => c.fn === 'submit_record_change_request');
  assert.ok(submitCall, 'submit_record_change_request RPC must be called');
  assert.equal(typeof submitCall.params.p_amount, 'number');
  assert.equal(submitCall.params.p_amount, 250);
  assert.equal(submitCall.params.p_payment_method, 'MAYA');
  assert.equal(submitCall.params.p_notes, 'Updated receipt ref');
  assert.equal(submitCall.params.p_reason, 'Paid via Maya instead of GCash');

  const makeJoinNode = () => {
    const attrs = {};
    const listeners = {};
    return {
      attrs,
      listeners,
      value: '',
      textContent: '',
      innerHTML: '',
      disabled: false,
      hidden: false,
      validityMsg: '',
      selectionStart: 0,
      selectionEnd: 0,
      setCustomValidity(m) { this.validityMsg = m; },
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; },
      addEventListener(ev, fn) { (listeners[ev] ||= []).push(fn); },
      querySelector: () => dummyEl(),
      querySelectorAll: () => [],
      focus: noop
    };
  };
  const joinNodes = {};
  const joinContainer = {
    innerHTML: '',
    querySelector: (sel) => {
      const m = sel.match(/#ipon-jp-\d+-(form|code|error|preview|pending|submit|cancel)/);
      if (!m) return dummyEl();
      return (joinNodes[m[1]] ||= makeJoinNode());
    }
  };
  ipon.mountJoinGroupPanel(joinContainer, { initialCode: 'K9M4PQ' });
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(joinNodes.error.textContent, '');
  assert.equal(joinNodes.code.attrs['aria-invalid'], 'true');
  assert.match(joinNodes.preview.innerHTML, /class="join-preview-error" role="alert"/);

  joinNodes.code.value = 'SDA-SDF';
  joinNodes.code.selectionStart = 7;
  joinNodes.code.selectionEnd = 7;
  let prevented7th = false;
  for (const fn of (joinNodes.code.listeners.beforeinput || [])) {
    fn({ inputType: 'insertText', data: '3', preventDefault() { prevented7th = true; } });
  }
  assert.equal(prevented7th, true);
  joinNodes.code.value = 'SDA-SDF322';
  for (const fn of (joinNodes.code.listeners.input || [])) fn();
  assert.equal(joinNodes.code.value, 'SDA-SDF');
});
