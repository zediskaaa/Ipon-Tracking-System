import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function extractBlock(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Expected marker ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Expected end marker ${endMarker}`);
  return source.slice(start, end);
}

function makeFakeElement(tag = 'div') {
  const listeners = new Map();
  const classes = new Set();
  const attrs = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    dataset: {},
    hidden: false,
    value: '',
    textContent: '',
    children: [],
    parentNode: null,
    focused: false,
    validity: { badInput: false },
    classList: {
      add: (...names) => names.forEach((n) => classes.add(n)),
      remove: (...names) => names.forEach((n) => classes.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name);
          return true;
        }
        if (force) classes.add(name);
        else classes.delete(name);
        return Boolean(force);
      },
      contains: (name) => classes.has(name)
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    click() {
      for (const fn of listeners.get('click') || []) fn({ target: el, preventDefault() {} });
    },
    dispatchInput() {
      for (const fn of listeners.get('input') || []) fn({ target: el });
    },
    focus() { el.focused = true; },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    removeAttribute(k) { attrs.delete(k); },
    hasAttribute(k) { return attrs.has(k); },
    getAttribute(k) { return attrs.get(k) ?? null; },
    append(...nodes) {
      for (const n of nodes) {
        n.parentNode = el;
        el.children.push(n);
      }
    },
    remove() {
      if (!el.parentNode) return;
      el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      el.parentNode = null;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const results = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (matchesSelector(child, sel)) results.push(child);
          visit(child);
        }
      };
      visit(el);
      return results;
    }
  };
  return el;
}

function matchesSelector(node, sel) {
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return node.classList.contains(cls) || String(node.className || '').split(/\s+/).includes(cls);
  }
  const attrMatch = sel.match(/^\[name="([^"]+)"\]$/);
  if (attrMatch) return node.name === attrMatch[1];
  return false;
}

function buildInviteRowElement() {
  const row = makeFakeElement('div');
  const buildChild = (tag, cls, { name = '', hidden = false, value = '' } = {}) => {
    const c = makeFakeElement(tag);
    c.className = cls;
    cls.split(/\s+/).filter(Boolean).forEach((n) => c.classList.add(n));
    if (name) c.name = name;
    c.hidden = hidden;
    c.value = value;
    return c;
  };
  Object.defineProperty(row, 'innerHTML', {
    set(html) {
      row.children = [];
      const amountMatch = String(html).match(/name="invite_amount"[^>]*value="([^"]+)"/);
      const defaultAmt = amountMatch ? amountMatch[1] : '100';
      const head = buildChild('div', 'invite-row-head');
      const headTitle = buildChild('div', 'invite-row-head-title');
      headTitle.append(
        buildChild('span', 'invite-row-badge'),
        buildChild('span', 'invite-row-state', { hidden: true })
      );
      const headActions = buildChild('div', 'invite-row-head-actions');
      headActions.append(
        buildChild('button', 'invite-row-edit', { hidden: true }),
        buildChild('button', 'invite-row-remove')
      );
      head.append(headTitle, headActions);

      const summary = buildChild('div', 'invite-row-summary', { hidden: true });
      summary.append(
        buildChild('strong', 'invite-row-summary-email'),
        buildChild('small', 'invite-row-summary-meta')
      );

      const grid = buildChild('div', 'invite-row-grid');
      grid.append(
        buildChild('input', '', { name: 'invite_email' }),
        buildChild('input', '', { name: 'invite_name' }),
        buildChild('input', '', { name: 'invite_amount', value: defaultAmt }),
        buildChild('input', '', { name: 'invite_password' })
      );

      const actions = buildChild('div', 'invite-row-actions');
      const commitBtn = buildChild('button', 'button button-primary invite-row-commit');
      commitBtn.textContent = 'Add';
      actions.append(commitBtn);

      row.append(head, summary, grid, actions);
    }
  });
  return row;
}

test('member invite card commits into compact summary on Add, supports Edit/Done, blocks duplicates, and collects payloads', () => {
  const dashJs = read('js/dashboard.js');
  const inviteHelpersSrc = extractBlock(dashJs, 'function syncInviteRemoveButtons(', 'async function dispatchInvites(');

  const errors = new Map();
  const groupInviteRows = makeFakeElement('div');
  const addTopBtn = makeFakeElement('button');
  addTopBtn.textContent = '+ Add member';

  const documentMock = {
    createElement: () => buildInviteRowElement(),
    getElementById: (id) => (id === 'group-add-invite-row' ? addTopBtn : null)
  };
  const IponMock = {
    escapeHtml: (s) => String(s),
    money: (n) => `₱${Number(n).toFixed(2)}`,
    prepareTemporaryPassword: (input) => { if (!input.value) input.value = 'cwDvxhs$M5sW'; },
    prepareInviteNameInput: () => {},
    preparePesoInputs: () => {},
    setFieldError: (el, msg) => {
      errors.set(el, msg);
      if (msg) el.setAttribute('aria-invalid', 'true');
      else el.removeAttribute('aria-invalid');
    },
    fullNameValidationError: (name) => (name && /^[A-Z\s]+$/.test(name) ? 'Do not use ALL CAPS.' : ''),
    parseMoneyAmount: (val, { min = 1, max = 1000000 } = {}) => {
      const n = Number(val);
      if (!Number.isFinite(n) || n < min || n > max) return { valid: false, error: 'Enter a valid monthly share.' };
      return { valid: true, value: n };
    },
    passwordIssue: (pw) => (String(pw || '').length < 8 ? 'Password must be at least 8 characters.' : ''),
    normalizeNamePart: (v) => String(v || '').trim().replace(/\s+/g, ' ')
  };

  const factory = new Function(
    'document',
    'Ipon',
    'groupInviteRows',
    `${inviteHelpersSrc}\nreturn { appendInviteRow, collectInvitePayloads };`
  );
  const { appendInviteRow, collectInvitePayloads } = factory(documentMock, IponMock, groupInviteRows);

  const row1 = appendInviteRow(groupInviteRows, { defaultAmount: 100, required: false });
  assert.equal(addTopBtn.textContent, '+ Add another');

  // Clicking Add with blank email keeps form open and shows inline error
  row1.querySelector('.invite-row-commit').click();
  assert.equal(row1.dataset.committed, 'false');
  assert.equal(row1.querySelector('.invite-row-grid').hidden, false);
  assert.match(errors.get(row1.querySelector('[name="invite_email"]')), /valid email/i);

  // Fill valid email & click Add -> form collapses into summary card
  row1.querySelector('[name="invite_email"]').value = 'ZedrickDeMonteverde06@gmail.com';
  row1.querySelector('[name="invite_name"]').value = 'Juan Dela Cruz';
  row1.querySelector('.invite-row-commit').click();
  assert.equal(row1.dataset.committed, 'true');
  assert.equal(row1.classList.contains('is-committed'), true);
  assert.equal(row1.querySelector('.invite-row-grid').hidden, true);
  assert.equal(row1.querySelector('.invite-row-actions').hidden, true);
  assert.equal(row1.querySelector('.invite-row-summary').hidden, false);
  assert.equal(row1.querySelector('.invite-row-edit').hidden, false);
  assert.equal(row1.querySelector('.invite-row-state').hidden, false);
  assert.equal(row1.querySelector('.invite-row-summary-email').textContent, 'zedrickdemonteverde06@gmail.com');
  assert.equal(row1.querySelector('.invite-row-summary-meta').textContent, 'Juan Dela Cruz · ₱100.00/mo · Ready to invite');

  // Edit re-opens form with Done button label, then Done collapses with updated amount
  row1.querySelector('.invite-row-edit').click();
  assert.equal(row1.dataset.committed, 'false');
  assert.equal(row1.querySelector('.invite-row-grid').hidden, false);
  assert.equal(row1.querySelector('.invite-row-commit').textContent, 'Done');
  row1.querySelector('[name="invite_amount"]').value = '250';
  row1.querySelector('.invite-row-commit').click();
  assert.equal(row1.dataset.committed, 'true');
  assert.equal(row1.querySelector('.invite-row-summary-meta').textContent, 'Juan Dela Cruz · ₱250.00/mo · Ready to invite');

  // Adding a second row with duplicate email is rejected inline
  const row2 = appendInviteRow(groupInviteRows, { defaultAmount: 100, required: false });
  row2.querySelector('[name="invite_email"]').value = 'zedrickdemonteverde06@gmail.com';
  row2.querySelector('.invite-row-commit').click();
  assert.equal(row2.dataset.committed, 'false');
  assert.match(errors.get(row2.querySelector('[name="invite_email"]')), /already added/i);

  // Updating row2 to a distinct email and submitting without clicking Add still collects both rows
  row2.querySelector('[name="invite_email"]').value = 'maria.santos@gmail.com';
  const payloads = collectInvitePayloads(groupInviteRows, { allowEmptyRows: true });
  assert.equal(payloads.length, 2);
  assert.equal(payloads[0].email, 'zedrickdemonteverde06@gmail.com');
  assert.equal(payloads[0].monthly_contribution_amount, 250);
  assert.equal(payloads[1].email, 'maria.santos@gmail.com');
  assert.equal(payloads[1].monthly_contribution_amount, 100);
});

test('invite summary dialog and invite row cards enforce responsive zero-overflow wrapping', () => {
  const css = read('css/app.css');

  // Root dialog header shrinking & title wrapping
  assert.match(css, /\.form-dialog-header\s*>\s*div\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto/);
  assert.match(css, /\.invite-summary-dialog\s+\.form-dialog-header\s+h2\s*\{[^}]*overflow-wrap:\s*anywhere/);

  // Invite summary container, card grid track, and long email wrapping
  assert.match(css, /\.invite-summary-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*overflow-x:\s*hidden/);
  assert.match(css, /\.invite-summary-item\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*max-width:\s*100%[^}]*overflow:\s*hidden/);
  assert.match(css, /\.invite-summary-head\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%/);
  assert.match(css, /\.invite-summary-head\s+strong\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.invite-summary-note\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /@media\s*\(max-width:\s*620px\)\s*\{[^\r\n]*\.invite-summary-head\s*\{[^}]*flex-direction:\s*column/);

  // Committed member invite card and circular remove button remain intact in light and dark mode
  assert.match(css, /\.invite-row-card\.is-committed\s*\{/);
  assert.match(css, /\.invite-row-summary-email\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.invite-row-actions\s*\{[^}]*justify-content:\s*flex-end/);
  assert.match(css, /html\[data-theme="dark"\]\s+\.invite-row-card\.is-committed\s*\{/);
  assert.match(css, /\.invite-row-remove\s*\{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*border-radius:\s*50%/);
});
