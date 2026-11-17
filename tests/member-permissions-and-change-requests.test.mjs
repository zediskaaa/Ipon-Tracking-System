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

  // 4. Runtime VM verification: permissions exports, 6-char code typing cap & single error rendering
  const noop = () => {};
  const dummyEl = () => ({
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    style: {},
    setAttribute: noop,
    removeAttribute: noop,
    addEventListener: noop,
    querySelector: () => dummyEl(),
    querySelectorAll: () => [],
    insertAdjacentHTML: noop
  });
  const ctx = {
    console, TextEncoder, URL, URLSearchParams, Intl, Math, Date, Number, String, JSON,
    Uint8Array, Array, Set, Map,
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', origin: 'https://my-ipon.vercel.app', search: '', href: 'https://my-ipon.vercel.app/dashboard.html', replace: noop, assign: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { replaceState: noop },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    document: {
      documentElement: { setAttribute: noop, dataset: {}, style: { setProperty: noop, removeProperty: noop } },
      head: { insertAdjacentHTML: noop },
      body: { dataset: {}, classList: { contains: () => false, add: noop, remove: noop, toggle: noop }, insertAdjacentHTML: noop, appendChild: noop, prepend: noop, append: noop },
      createElement: () => dummyEl(),
      addEventListener: noop,
      removeEventListener: noop,
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null
    },
    supabase: {
      createClient: () => ({
        rpc: async (fn) => {
          if (fn === 'preview_group_invite_code') {
            return { data: { valid: false, message: 'Group invite code not found. Double-check the 6-character code or ask your admin for a new link.' }, error: null };
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
  assert.match(authJs, /bindInviteCodeInput/);

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
