import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('migration 103 completes governance audit coverage, audit_logs immutability, and audit UI filters', () => {
  const mig103 = read('database/migrations/20261117_103_audit_governance_and_anti_cheat.sql');
  const auditHtml = read('audit.html');
  const coreJs = read('js/core.js');

  assert.match(mig103, /'20261117_103'/);
  assert.match(mig103, /when tg_table_name = 'groups' then v_record_id/i);
  assert.match(mig103, /'snapshot'/);
  assert.match(mig103, /create trigger savings_cycle_batches_audit[\s\S]*?on public\.savings_cycle_batches/i);
  assert.match(mig103, /revoke insert, update, delete on public\.audit_logs from public, anon, authenticated/i);

  for (const tableOpt of [
    'financial_change_requests',
    'group_memberships',
    'group_join_requests',
    'group_invite_codes',
    'savings_cycle_batches'
  ]) {
    assert.match(auditHtml, new RegExp(`<option value="${tableOpt}">`));
  }

  const noop = () => {};
  const dummyEl = () => ({
    style: { setProperty: noop, removeProperty: noop },
    dataset: {},
    classList: { contains: () => false, add: noop, remove: noop, toggle: noop },
    setAttribute: noop,
    appendChild: noop,
    addEventListener: noop,
    querySelector: () => dummyEl(),
    querySelectorAll: () => [],
    insertAdjacentHTML: noop
  });
  const ctx = {
    window: null,
    console, TextEncoder, URL, URLSearchParams, Intl, Math, Date, Number, String, JSON,
    Uint8Array, Array, Set, Map,
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/audit.html', origin: 'https://my-ipon.vercel.app', search: '', href: 'https://my-ipon.vercel.app/audit.html', replace: noop, assign: noop },
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
    }
  };
  ctx.window = ctx;
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'test' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  const { formatAuditEntry } = ctx.window.Ipon;

  const crEntry = formatAuditEntry({
    table_name: 'financial_change_requests',
    action: 'INSERT',
    changed_by: 'u1',
    new_data: { record_type: 'expense', current_amount: 100, proposed_amount: 150, status: 'PENDING' }
  }, { profiles: new Map([['u1', 'Paulo Garcia']]) });
  assert.equal(crEntry.actor, 'Paulo Garcia');
  assert.equal(crEntry.summary, 'Requested expense edit (₱100.00 → ₱150.00)');

  const batchEntry = formatAuditEntry({
    table_name: 'savings_cycle_batches',
    action: 'INSERT',
    changed_by: 'u2',
    new_data: { title: 'Year-End 2026', net_savings: 15000, snapshot: { huge: true } }
  }, { profiles: new Map([['u2', 'Zedrick De Monteverde']]) });
  assert.equal(batchEntry.summary, 'Archived savings cycle "Year-End 2026" (₱15,000.00 net)');
  assert.ok(!batchEntry.changes.some((c) => c.key === 'snapshot'));

  const joinEntry = formatAuditEntry({
    table_name: 'group_join_requests',
    action: 'UPDATE',
    changed_by: 'u2',
    old_data: { requester_name: 'Jessa Dizon', status: 'PENDING' },
    new_data: { requester_name: 'Jessa Dizon', status: 'APPROVED' }
  }, { profiles: new Map([['u2', 'Zedrick De Monteverde']]) });
  assert.equal(joinEntry.summary, 'Approved join request for Jessa Dizon');

  const mig104 = read('database/migrations/20261117_104_purge_metadata_audit_noise.sql');
  assert.match(mig104, /'20261117_104'/);
  assert.match(mig104, /delete from public\.audit_logs/i);
  assert.match(mig104, /'inactivity_warned_at'/);
  assert.match(mig104, /'policy_accepted_at'/);
  assert.match(mig104, /\(v_old - array\['updated_by'\]\) = \(v_new - array\['updated_by'\]\)/i);
  assert.match(coreJs, /'inactivity_warned_at'/);
  assert.match(coreJs, /'policy_accepted_at'/);
});
