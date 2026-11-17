import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function makeElement(tag = 'div') {
  const listeners = new Map();
  return {
    tagName: String(tag).toUpperCase(),
    value: '',
    textContent: '',
    innerHTML: '',
    hidden: false,
    checked: false,
    disabled: false,
    dataset: {},
    elements: new Proxy({}, {
      get: (target, prop) => {
        if (!(prop in target)) target[prop] = makeElement('input');
        return target[prop];
      }
    }),
    classList: {
      add() { },
      remove() { },
      toggle() { },
      contains: () => false
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    async trigger(type, event = {}) {
      for (const fn of listeners.get(type) || []) {
        await fn(event);
      }
    },
    querySelector() { return makeElement(); },
    querySelectorAll() { return []; },
    closest() { return null; }
  };
}

test('Account access removes redundant editable Linked member dropdown and locks member binding cleanly', async () => {
  const settingsHtml = read('settings.html');
  const settingsJs = read('js/settings.js');
  const css = read('css/app.css');
  const mig098 = read('database/migrations/20261117_098_lock_account_member_link.sql');
  const schemaSql = read('database/schema.sql');

  // 1. HTML structure: strictly 4 columns (User, Role, Status, Actions) — no Linked member column/select
  assert.match(settingsHtml, /<thead><tr><th>User<\/th><th>Role<\/th><th>Status<\/th><th>Actions<\/th><\/tr><\/thead><tbody id="access-body"><tr class="loading-row"><td colspan="4">Loading accounts…<\/td><\/tr><\/tbody>/);
  assert.doesNotMatch(settingsHtml, /<th>Linked member<\/th>/);
  assert.doesNotMatch(settingsJs, /data-field="member"|Not linked|<option[^>]*>\$\{[^}]*member\.full_name/);

  // 2. Desktop fixed column sizing in css/app.css
  assert.match(css, /\.settings-panel-access \.data-table\s*\{[^}]*table-layout:\s*fixed/);
  assert.match(css, /\.settings-panel-access \.data-table th:nth-child\(4\)/);

  // 3. Migration 098 & schema.sql enforce immutable member link & auto-link unlinked promotions
  assert.match(mig098, /A linked member login cannot be reassigned to a different member profile\./);
  assert.match(mig098, /Member profile created from account access/);
  assert.match(mig098, /'20261117_098'/);
  assert.match(schemaSql, /'20261117_098'/);
  assert.match(schemaSql, /A linked member login cannot be reassigned to a different member profile\./);

  // 4. Runtime execution of js/settings.js
  const rpcCalls = [];
  const confirmCalls = [];
  const toastCalls = [];
  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };

  let roleFieldValues = new Map([['u-member', 'MEMBER'], ['u-treasurer', 'TREASURER']]);
  let statusFieldValues = new Map([['u-member', 'ACTIVE'], ['u-treasurer', 'PENDING']]);

  const accessBody = getEl('access-body');
  accessBody.querySelector = (sel) => {
    const roleMatch = sel.match(/\[data-field="role"\]\[data-id="([^"]+)"\]/);
    if (roleMatch) return { get value() { return roleFieldValues.get(roleMatch[1]); } };
    const statusMatch = sel.match(/\[data-field="status"\]\[data-id="([^"]+)"\]/);
    if (statusMatch) return { get value() { return statusFieldValues.get(statusMatch[1]); } };
    return null;
  };

  const accessRows = [
    {
      user_id: 'u-member',
      full_name: 'Nhicole Joy Gadia Antalan',
      email: 'antalannhicolejoy19@gmail.com',
      role: 'MEMBER',
      status: 'ACTIVE',
      member_id: 'm-nhicole',
      member_name: 'Nhicole Joy Gadia Antalan'
    },
    {
      user_id: 'u-treasurer',
      full_name: 'Rosa Treasurer',
      email: 'rosa@example.com',
      role: 'TREASURER',
      status: 'PENDING',
      member_id: null,
      member_name: null
    }
  ];

  const sandbox = {
    URL,
    Date,
    Intl,
    Map,
    Set,
    Promise,
    CSS: { escape: (v) => String(v) },
    FormData: class { constructor() { } get() { return ''; } },
    document: {
      activeElement: null,
      getElementById: (id) => getEl(id),
      querySelectorAll: () => []
    },
    location: { reload() { } },
    Ipon: {
      isoDate: () => '2026-11-17',
      money: (v) => `₱${Number(v || 0).toFixed(2)}`,
      dateLabel: (d) => String(d),
      escapeHtml: (s) => String(s ?? ''),
      bindPasswordStrength() { },
      syncWorkspaceMode() { },
      populateGroupSelect() { },
      setLoading() { },
      setBusy() { },
      consumeDeepLink() { },
      subscribeToChanges() { },
      friendlyError: (e) => String(e?.message || e),
      toast: (msg, type = 'info') => toastCalls.push({ msg, type }),
      confirmAction: async (opts) => { confirmCalls.push(opts); return true; },
      init: async () => ({
        failed: false,
        configured: true,
        profile: { id: 'u-admin', full_name: 'Group Admin', role: 'ADMIN', status: 'ACTIVE', group_id: 'g-1', member_id: null }
      }),
      rpc: async (fn, args) => {
        rpcCalls.push({ fn, args });
        if (fn === 'get_group_access_list') return accessRows;
        if (fn === 'get_my_groups') return [{ group_id: 'g-1', workspace_mode: 'GROUP', is_current: true, is_contributor: false }];
        return null;
      },
      client: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: {}, error: null }),
              is: () => ({ order: async () => ({ data: [{ id: 'm-nhicole', full_name: 'Nhicole Joy Gadia Antalan', activation_status: 'ACTIVE', monthly_contribution_amount: 100 }], error: null }) })
            })
          })
        })
      }
    }
  };
  sandbox.window = sandbox;

  vm.runInNewContext(settingsJs, sandbox, { filename: 'js/settings.js' });
  await new Promise((r) => setTimeout(r, 20));

  // Verify rendered HTML omits any Linked member column or dropdown
  assert.doesNotMatch(accessBody.innerHTML, /data-field="member"|Linked member|Member profile: Nhicole/);
  assert.match(accessBody.innerHTML, /<td data-label="User"><strong>Nhicole Joy Gadia Antalan<\/strong>/);
  assert.match(accessBody.innerHTML, /<td data-label="Role"><select data-field="role" data-id="u-member"/);
  assert.match(accessBody.innerHTML, /<td data-label="Status"><select data-field="status" data-id="u-member"/);
  assert.match(accessBody.innerHTML, /<td data-label="Actions"><button class="icon-action" type="button" data-save-access="u-member">Save<\/button><\/td>/);

  // Unchanged row click does not confirm or call admin_set_user_access
  rpcCalls.length = 0;
  confirmCalls.length = 0;
  toastCalls.length = 0;
  await accessBody.trigger('click', {
    target: { closest: () => ({ dataset: { saveAccess: 'u-member' } }) }
  });
  assert.equal(confirmCalls.length, 0);
  assert.equal(rpcCalls.length, 0);
  assert.equal(toastCalls[0]?.msg, 'No access changes to save.');

  // Changing Member status preserves locked member_id ('m-nhicole')
  statusFieldValues.set('u-member', 'DISABLED');
  await accessBody.trigger('click', {
    target: { closest: () => ({ dataset: { saveAccess: 'u-member' } }) }
  });
  assert.equal(confirmCalls.length, 1);
  assert.equal(rpcCalls[0].fn, 'admin_set_user_access');
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0].args)), {
    p_user_id: 'u-member',
    p_role: 'MEMBER',
    p_status: 'DISABLED',
    p_member_id: 'm-nhicole'
  });

  // Changing Treasurer -> Member (ACTIVE) informs Admin about automatic linking & sends p_member_id: null
  rpcCalls.length = 0;
  confirmCalls.length = 0;
  roleFieldValues.set('u-treasurer', 'MEMBER');
  statusFieldValues.set('u-treasurer', 'ACTIVE');
  await accessBody.trigger('click', {
    target: { closest: () => ({ dataset: { saveAccess: 'u-treasurer' } }) }
  });
  assert.match(confirmCalls[0].message, /member profile will be linked automatically/i);
  assert.equal(rpcCalls[0].fn, 'admin_set_user_access');
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0].args)), {
    p_user_id: 'u-treasurer',
    p_role: 'MEMBER',
    p_status: 'ACTIVE',
    p_member_id: null
  });
});
