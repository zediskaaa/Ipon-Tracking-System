import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(process.cwd());
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function loadCoreHarness({ rpcImpl, getSessionImpl, refreshSessionImpl } = {}) {
  const coreJs = read('js/core.js');
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

  const fakeClient = {
    auth: {
      getSession: getSessionImpl || (async () => ({ data: { session: { access_token: 'tok-1', expires_at: Math.floor(Date.now() / 1000) + 3600 } } })),
      refreshSession: refreshSessionImpl || (async () => ({ data: { session: { access_token: 'tok-fresh', expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null }))
    },
    rpc: rpcImpl || (async () => ({ data: 'new-group-id', error: null })),
    functions: { invoke: async () => ({ data: {}, error: null }) }
  };

  const ctx = {
    window: null,
    console, TextEncoder, URL, URLSearchParams, Intl, Math, Date, Number, String, JSON,
    Uint8Array, Array, Set, Map, Promise, RegExp, Error,
    navigator: { userAgent: 'node', onLine: true },
    location: { protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', origin: 'https://my-ipon.vercel.app', search: '', href: 'https://my-ipon.vercel.app/dashboard.html', replace: noop, assign: noop },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    history: { replaceState: noop },
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    setTimeout,
    clearTimeout,
    supabase: { createClient: () => fakeClient },
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
  ctx.window.IPON_CONFIG = { supabaseUrl: 'https://woslmwokhhyszkgevnli.supabase.co', supabaseAnonKey: 'anon-key' };
  vm.runInNewContext(coreJs, ctx, { filename: 'js/core.js' });
  return ctx.window.Ipon;
}

test('Ipon.rpc refreshes expired/dropped session and retries admin_create_group instead of failing with permission error', async () => {
  let rpcCalls = 0;
  let refreshCalls = 0;

  const Ipon = loadCoreHarness({
    getSessionImpl: async () => ({ data: { session: { access_token: 'stale-tok', expires_at: Math.floor(Date.now() / 1000) + 300 } } }),
    refreshSessionImpl: async () => {
      refreshCalls += 1;
      return { data: { session: { access_token: 'fresh-tok', expires_at: Math.floor(Date.now() / 1000) + 3600 } }, error: null };
    },
    rpcImpl: async (name) => {
      rpcCalls += 1;
      if (rpcCalls === 1) {
        return { data: null, error: { code: '42501', message: `permission denied for function ${name}` } };
      }
      return { data: 'group-uuid-123', error: null };
    }
  });

  const groupId = await Ipon.rpc('admin_create_group', {
    p_name: 'My Savings',
    p_workspace_mode: 'SOLO',
    p_include_self: true,
    p_monthly_amount: 500
  });

  assert.equal(groupId, 'group-uuid-123');
  assert.equal(refreshCalls, 1, 'refreshed stale session once on transient permission denied for function');
  assert.equal(rpcCalls, 2, 'retried RPC automatically after refreshing session');
});

test('Ipon.friendlyError reports reconnect guidance for stale-session RPC errors instead of blaming permissions', () => {
  const Ipon = loadCoreHarness();

  const fnPerm = Ipon.friendlyError({ code: '42501', message: 'permission denied for function admin_create_group' });
  assert.match(fnPerm, /session|internet|try again/i);
  assert.doesNotMatch(fnPerm, /do not have permission/i);

  const jwtErr = Ipon.friendlyError({ code: 'PGRST301', message: 'JWT expired' });
  assert.match(jwtErr, /session|internet|try again/i);
  assert.doesNotMatch(jwtErr, /do not have permission/i);

  const realRls = Ipon.friendlyError({ code: '42501', message: 'new row violates row-level security policy for table expenses' });
  assert.equal(realRls, 'You do not have permission for that action.');
});

test('Migration 155, schema.sql, and dashboard validation keep workspace creation open to all active users with strict input bounds', () => {
  const mig155 = read('database/migrations/20261121_155_unrestricted_workspace_creation.sql');
  const schema = read('database/schema.sql');
  const dashJs = read('js/dashboard.js');
  const dashHtml = read('dashboard.html');

  for (const sql of [mig155, schema]) {
    assert.match(sql, /'20261121_155'/);
    assert.match(sql, /ipon\.creating_group_id/);
    assert.match(sql, /v_amount < 1 or v_amount > 1000000/i);
    assert.match(sql, /insert into public\.profiles \(id, email, full_name, role, status, group_id, member_id\)/i);
  }
  assert.doesNotMatch(mig155, /if not public\.is_admin\(\) then[\s\S]*admin_create_group/i);

  // Dashboard create buttons have no role restriction and form validates name + monthly bounds before confirming
  assert.doesNotMatch(dashHtml, /id="dashboard-create-group"[^>]*data-role=/);
  assert.doesNotMatch(dashHtml, /id="no-group-solo-btn"[^>]*data-role=/);
  assert.doesNotMatch(dashHtml, /id="no-group-create-btn"[^>]*data-role=/);
  assert.match(dashJs, /Workspace name must be between 2 and 150 characters\./);
  assert.match(dashJs, /Ipon\.guardMoneyInput\?\.\(groupMonthlyInput/);
});
