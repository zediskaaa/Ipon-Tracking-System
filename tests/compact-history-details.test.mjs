import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function detailsFunction(source, name, next) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(`  function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test('mobile member details retain all fields and actions', () => {
  const html = read('members.html');
  const js = read('js/members.js');
  const css = read('css/app.css');
  assert.match(html, /<dialog[^>]*id="member-detail-dialog"/);
  assert.match(js, /class="compact-history-row"/);
  assert.match(css, /tr\.compact-history-row > td:not\(\.compact-row-summary\) \{ display: none; \}/);
  assert.match(css, /\.compact-summary-head,\s*\.compact-summary-meta \{\s*width: 100%;\s*justify-self: stretch;/);
  const fields = { innerHTML: '' };
  const actions = { innerHTML: '' };
  const title = { textContent: '' };
  let opened = false;
  const cells = ['Ava', '09123456789', 'GCash', 'Nov 1', '₱100', 'Active', 'ava@example.com', 'actions']
    .map((innerHTML, index) => ({ innerHTML, querySelector: () => index === 7 ? { innerHTML: '<button data-action="edit">Edit</button>' } : null }));
  const fn = runInNewContext(`${detailsFunction(js, 'openMemberDetails', 'permissionPresetMatch')} openMemberDetails`, {
    detailFields: fields, detailActions: actions, detailDialog: { querySelector: () => ({ textContent: '' }), showModal() { opened = true; } },
    document: { getElementById: () => title }, Ipon: { escapeHtml: (value) => value }
  });
  fn({ closest: () => ({ querySelectorAll: () => cells }) }, { full_name: 'Ava', notes: 'Prefers GCash' });
  assert.ok(opened);
  assert.match(fields.innerHTML, /<dt>Payout account<\/dt><dd>GCash<\/dd>/);
  assert.match(fields.innerHTML, /ava@example\.com/);
  assert.match(fields.innerHTML, /Prefers GCash/);
  assert.match(actions.innerHTML, /data-action="edit"/);
  assert.equal(title.textContent, 'Ava');
});

test('mobile permission details show role, rules, and edit action', () => {
  const js = read('js/members.js');
  const fields = { innerHTML: '' };
  const actions = { innerHTML: '' };
  const eyebrow = { textContent: '' };
  const title = { textContent: '' };
  let opened = false;
  const cells = ['Ava', 'MEMBER', 'Trusted', 'Calendar: Instant', 'actions']
    .map((innerHTML, index) => ({ innerHTML, querySelector: () => index === 4 ? { innerHTML: '<button data-action="edit-permissions">Edit permissions</button>' } : null }));
  const fn = runInNewContext(`${detailsFunction(js, 'openPermissionDetails', 'permissionPresetMatch')} openPermissionDetails`, {
    detailFields: fields, detailActions: actions,
    detailDialog: { querySelector: () => eyebrow, showModal() { opened = true; } },
    document: { getElementById: () => title }
  });
  fn({ dataset: { name: 'Ava' }, closest: () => ({ querySelectorAll: () => cells }) });
  assert.ok(opened);
  assert.match(fields.innerHTML, /<dt>Active rules<\/dt><dd>Calendar: Instant<\/dd>/);
  assert.match(actions.innerHTML, /edit-permissions/);
  assert.equal(eyebrow.textContent, 'Workspace permissions');
  assert.equal(title.textContent, 'Ava');
});

test('personal and budget histories have compact mobile details with original actions', () => {
  for (const [html, js, dialog, trigger, action] of [
    ['user.html', 'js/user.js', 'user-history-detail-dialog', 'data-history-details', 'data-view-receipt'],
    ['budget.html', 'js/budget.js', 'budget-history-detail-dialog', 'data-budget-details', 'data-budget-edit-expense']
  ]) {
    assert.match(read(html), new RegExp(`id="${dialog}"`));
    assert.match(read(js), /class="compact-history-row"/);
    assert.ok(read(js).includes(trigger));
    assert.ok(read(js).includes(action));
  }
});

test('personal history details open when receipt and review actions are absent', () => {
  const js = read('js/user.js');
  const start = js.indexOf('  function openUserHistoryDetails(');
  const end = js.indexOf("  body.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const fields = { innerHTML: '' };
  const actions = { innerHTML: '', hidden: false };
  const title = { textContent: '' };
  let opened = false;
  const cells = ['Nov 2026', 'Nov 20', 'Cash', '₱100', 'Confirmed', '—', '—']
    .map((innerHTML) => ({ innerHTML, querySelector: () => null, querySelectorAll: () => [] }));
  const fn = runInNewContext(`${js.slice(start, end)} openUserHistoryDetails`, {
    historyRowsById: new Map([['1', { contribution_periods: { period_month: '2026-11-01' }, approval_status: 'CONFIRMED' }]]),
    historyDetailFields: fields, historyDetailActions: actions,
    historyDetailDialog: { showModal() { opened = true; } },
    document: { getElementById: () => title },
    Ipon: { escapeHtml: (value) => value, dateLabel: () => 'November 2026' }
  });
  fn({ dataset: { historyDetails: '1' }, closest: () => ({ querySelectorAll: () => cells }) });
  assert.ok(opened);
  assert.equal(actions.hidden, true);
  assert.match(fields.innerHTML, /Review note/);
  assert.equal(title.textContent, 'November 2026');
});

test('mobile record details keep review actions and exclude bulk checkbox', () => {
  const js = read('js/records.js');
  const fields = { innerHTML: '' };
  const actions = { innerHTML: '', hidden: false };
  const labels = new Map([['record-detail-title', { textContent: '' }], ['record-detail-subtitle', { textContent: '' }]]);
  let opened = false;
  const cells = ['<input type="checkbox">Nov 19', 'Ava', 'Nov 2026', 'Cash', '₱100', 'Pending', 'actions']
    .map((html, index) => ({
      textContent: index === 1 ? 'Ava' : html,
      cloneNode: () => {
        const clone = { innerHTML: html };
        clone.querySelectorAll = () => index === 0 ? [{ remove() { clone.innerHTML = clone.innerHTML.replace('<input type="checkbox">', ''); } }] : [];
        return clone;
      },
      querySelector: () => index === 6 ? { innerHTML: '<button data-action="confirm">Confirm</button>' } : null
    }));
  const fn = runInNewContext(`${detailsFunction(js, 'openRecordDetails', 'actionButtons')} openRecordDetails`, {
    page: 'contributions', detailFields: fields, detailActions: actions,
    detailDialog: { showModal() { opened = true; } },
    document: { getElementById: (id) => labels.get(id) },
    recordRows: [{ id: '1', transaction_reference: '987654', notes: 'Paid in person' }],
    Ipon: { escapeHtml: (value) => value }
  });
  fn({ dataset: { id: '1' }, closest: () => ({ querySelectorAll: () => cells }) });
  assert.ok(opened);
  assert.match(fields.innerHTML, /<dt>Amount<\/dt><dd>₱100<\/dd>/);
  assert.match(fields.innerHTML, /<dt>Reference<\/dt><dd>987654<\/dd>/);
  assert.doesNotMatch(fields.innerHTML, /<input/);
  assert.match(actions.innerHTML, /data-action="confirm"/);
  assert.equal(labels.get('record-detail-title').textContent, 'Addition details');
});
