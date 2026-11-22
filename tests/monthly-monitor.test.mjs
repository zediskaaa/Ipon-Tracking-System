import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Migration 181 and schema.sql define Monthly Income & Expense Monitoring tables, RLS, constraints, and RPCs', () => {
  const mig181 = read('database/migrations/20261122_181_monthly_income_expense_monitoring.sql');
  const schema = read('database/schema.sql');

  for (const sql of [mig181, schema]) {
    assert.match(sql, /'20261122_181'/);
    assert.match(sql, /create table if not exists public\.monthly_monitor_settings/i);
    assert.match(sql, /create table if not exists public\.monthly_monitor_entries/i);
    assert.match(sql, /mandatory_savings_pct numeric\(5,2\) not null default 20\.00/i);
    assert.match(sql, /entry_type text not null check \(entry_type in \('INCOME', 'EXPENSE'\)\)/i);
    assert.match(sql, /extract\(year from entry_date\)::smallint = monitor_year/i);
    assert.match(sql, /extract\(month from entry_date\)::smallint = monitor_month/i);
    assert.match(sql, /alter table public\.monthly_monitor_settings enable row level security/i);
    assert.match(sql, /alter table public\.monthly_monitor_entries enable row level security/i);
    assert.match(sql, /create policy mfa_verified_for_opted_in on public\.monthly_monitor_entries/i);
    assert.match(sql, /create or replace function public\.get_monthly_monitor\(/i);
    assert.match(sql, /create or replace function public\.save_monthly_monitor_entry\(/i);
    assert.match(sql, /create or replace function public\.delete_monthly_monitor_entry\(/i);
    assert.match(sql, /create or replace function public\.save_monthly_monitor_settings\(/i);
  }
});

test('budget.html exposes unique IDs, balanced dialogs, mode tabs, and segmented Income/Expense views without inline handlers', () => {
  const html = read('budget.html');
  const css = read('css/cashflow-monitor.css');

  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'budget.html must have strictly unique HTML IDs');

  const openDialogs = (html.match(/<dialog\b/g) || []).length;
  const closeDialogs = (html.match(/<\/dialog>/g) || []).length;
  assert.equal(openDialogs, closeDialogs, 'budget.html <dialog> tags must stay balanced');
  assert.ok(openDialogs >= 6, 'budget.html must include existing 4 dialogs plus cf-entry-dialog and cf-rate-dialog');

  assert.doesNotMatch(html, /\son[a-z]+\s*=/i, 'budget.html must comply with CSP (no inline event handlers)');
  assert.match(html, /id="budget-tab-monitor"/);
  assert.match(html, /id="budget-tab-allocation"/);
  assert.match(html, /id="cf-seg-income"/);
  assert.match(html, /id="cf-seg-expense"/);
  assert.match(html, /id="cf-entry-dialog"/);
  assert.match(html, /id="cf-rate-dialog"/);
  assert.match(html, /css\/cashflow-monitor\.css\?v=20261122-01/);
  assert.match(html, /js\/cashflow-monitor\.js\?v=20261122-01/);
  assert.match(css, /html\[data-theme="dark"\] \.cf-segmented/);
  assert.match(css, /@media \(max-width: 780px\)/);
});

test('js/cashflow-monitor.js accurately calculates 20% mandatory savings, net income, negative deficit, view switches, CRUD, and month isolation', async () => {
  const js = read('js/cashflow-monitor.js');
  const els = new Map();
  const makeEl = (id, tag = 'DIV') => {
    const cls = new Set();
    const listeners = new Map();
    const attrs = new Map();
    const el = {
      id,
      tagName: tag,
      value: '',
      min: '',
      max: '',
      hidden: false,
      disabled: false,
      open: false,
      textContent: '',
      innerHTML: '',
      dataset: {},
      style: {},
      validity: { badInput: false, valid: true },
      classList: {
        add: (...names) => names.forEach((n) => cls.add(n)),
        remove: (...names) => names.forEach((n) => cls.delete(n)),
        toggle: (name, force) => (force === undefined ? (cls.has(name) ? (cls.delete(name), false) : (cls.add(name), true)) : (force ? (cls.add(name), true) : (cls.delete(name), false))),
        contains: (name) => cls.has(name)
      },
      setAttribute(k, v) { attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      focus() { },
      select() { },
      reset() { },
      replaceChildren() { el.innerHTML = ''; },
      showModal() { el.open = true; },
      close() { el.open = false; },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      async _emit(type, evt = {}) {
        for (const fn of listeners.get(type) || []) {
          await fn({ target: el, preventDefault() { }, ...evt });
        }
      }
    };
    if (id) els.set(id, el);
    return el;
  };

  const tabMonitor = makeEl('budget-tab-monitor', 'BUTTON');
  tabMonitor.dataset.budgetModeTab = 'monitor';
  const tabAlloc = makeEl('budget-tab-allocation', 'BUTTON');
  tabAlloc.dataset.budgetModeTab = 'allocation';

  [
    'cf-monitor-section', 'budget-allocation-section', 'budget-page-title', 'budget-page-desc', 'budget-header-actions',
    'cf-error-slot', 'cf-month-prev', 'cf-month-next', 'cf-month-input', 'cf-month-today', 'cf-rate-display', 'cf-rate-open-btn',
    'cf-hero-card', 'cf-health-badge', 'cf-health-text', 'cf-hero-net', 'cf-hero-formula', 'cf-meter-pct', 'cf-meter-track', 'cf-meter-fill', 'cf-meter-caption',
    'cf-hero-gross', 'cf-hero-mandatory', 'cf-hero-mandatory-label',
    'cf-kpi-available', 'cf-kpi-available-sub', 'cf-kpi-expenses', 'cf-kpi-expenses-sub', 'cf-kpi-net', 'cf-kpi-net-sub',
    'cf-seg-income', 'cf-seg-expense', 'cf-seg-income-total', 'cf-seg-expense-total',
    'cf-income-panel', 'cf-expense-panel',
    'cf-inc-gross', 'cf-inc-gross-sub', 'cf-inc-savings-label', 'cf-inc-savings', 'cf-inc-savings-sub', 'cf-inc-savings-edit', 'cf-inc-available',
    'cf-income-search', 'cf-add-income-btn', 'cf-income-body',
    'cf-exp-total', 'cf-exp-total-sub', 'cf-exp-count', 'cf-exp-count-sub', 'cf-exp-remaining', 'cf-exp-remaining-sub',
    'cf-expense-search', 'cf-expense-cat-filter', 'cf-add-expense-btn', 'cf-expense-body', 'cf-breakdown-wrap', 'cf-breakdown-list',
    'cf-chart-bars', 'cf-history-list',
    'cf-entry-dialog', 'cf-entry-form', 'cf-entry-id', 'cf-entry-type', 'cf-entry-eyebrow', 'cf-entry-title', 'cf-entry-copy',
    'cf-entry-category-label', 'cf-entry-category', 'cf-entry-presets', 'cf-entry-description', 'cf-entry-amount', 'cf-entry-date',
    'cf-impact-primary-label', 'cf-impact-primary-val', 'cf-impact-net-val', 'cf-entry-submit', 'cf-entry-close', 'cf-entry-cancel',
    'cf-rate-dialog', 'cf-rate-form', 'cf-rate-input', 'cf-rate-presets', 'cf-rate-preview-gross', 'cf-rate-preview-deduct', 'cf-rate-preview-avail', 'cf-rate-submit', 'cf-rate-close', 'cf-rate-cancel', 'cf-rate-reset'
  ].forEach((id) => makeEl(id));

  // In-memory store separated strictly by year-month
  const dbSettings = new Map();
  let dbEntries = [
    { id: 'inc-1', entry_type: 'INCOME', monitor_year: 2026, monitor_month: 11, category: 'Salary', description: 'Main salary', amount: 25000, entry_date: '2026-11-05' },
    { id: 'inc-2', entry_type: 'INCOME', monitor_year: 2026, monitor_month: 11, category: 'Freelance', description: 'UI design gig', amount: 5000, entry_date: '2026-11-12' },
    { id: 'exp-1', entry_type: 'EXPENSE', monitor_year: 2026, monitor_month: 11, category: 'Food', description: 'Groceries', amount: 9000, entry_date: '2026-11-08' },
    { id: 'exp-2', entry_type: 'EXPENSE', monitor_year: 2026, monitor_month: 11, category: 'Bills', description: 'Electric & Fiber', amount: 6000, entry_date: '2026-11-10' },
    // Different month (October) must never mix into November!
    { id: 'inc-oct', entry_type: 'INCOME', monitor_year: 2026, monitor_month: 10, category: 'Salary', description: 'Oct salary', amount: 40000, entry_date: '2026-10-15' }
  ];

  const buildPayload = (yr, mo) => {
    const pct = dbSettings.has(`${yr}-${mo}`) ? dbSettings.get(`${yr}-${mo}`) : 20;
    const incomes = dbEntries.filter((r) => r.monitor_year === yr && r.monitor_month === mo && r.entry_type === 'INCOME');
    const expenses = dbEntries.filter((r) => r.monitor_year === yr && r.monitor_month === mo && r.entry_type === 'EXPENSE');
    const gross = Math.round(incomes.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const mandatory = Math.round(gross * pct) / 100;
    const avail = Math.round((gross - mandatory) * 100) / 100;
    const expTotal = Math.round(expenses.reduce((s, r) => s + r.amount, 0) * 100) / 100;
    const net = Math.round((avail - expTotal) * 100) / 100;
    const ratio = avail > 0 ? Math.round((expTotal / avail) * 1000) / 10 : (expTotal > 0 ? 100 : 0);
    const byCat = new Map();
    for (const e of expenses) {
      const cur = byCat.get(e.category) || { category: e.category, total: 0, count: 0 };
      cur.total += e.amount;
      cur.count += 1;
      byCat.set(e.category, cur);
    }
    const breakdown = [...byCat.values()].sort((a, b) => b.total - a.total).map((b) => ({
      ...b,
      share_pct: expTotal > 0 ? Math.round((b.total / expTotal) * 1000) / 10 : 0
    }));
    return {
      year: yr,
      month: mo,
      mandatory_savings_pct: pct,
      is_custom_pct: dbSettings.has(`${yr}-${mo}`),
      totals: {
        gross_income: gross,
        mandatory_savings: mandatory,
        available_income: avail,
        total_expenses: expTotal,
        net_income: net,
        income_count: incomes.length,
        expense_count: expenses.length,
        spent_ratio_pct: ratio,
        is_over_budget: net < 0
      },
      incomes,
      expenses,
      expense_breakdown: breakdown,
      comparison_trend: [{ year: yr, month: mo, mandatory_savings_pct: pct, gross_income: gross, mandatory_savings: mandatory, available_income: avail, total_expenses: expTotal, net_income: net }],
      monthly_history: [{ year: yr, month: mo, mandatory_savings_pct: pct, gross_income: gross, mandatory_savings: mandatory, available_income: avail, total_expenses: expTotal, net_income: net, income_count: incomes.length, expense_count: expenses.length }]
    };
  };

  const sessionMap = new Map();
  const fieldErrors = new Map();
  const bodyEl = { dataset: { page: 'budget' } };
  const ctx = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    Promise,
    Date,
    URLSearchParams,
    sessionStorage: {
      getItem: (k) => (sessionMap.has(k) ? sessionMap.get(k) : null),
      setItem: (k, v) => sessionMap.set(k, String(v))
    },
    window: null,
    document: {
      body: bodyEl,
      getElementById: (id) => els.get(id) || makeEl(id),
      querySelectorAll: (sel) => (sel === '[data-budget-mode-tab]' ? [tabMonitor, tabAlloc] : [])
    },
    Ipon: {
      money: (v) => `₱${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      dateLabel: (d) => String(d || ''),
      isoDate: () => '2026-11-22',
      escapeHtml: (s) => String(s || ''),
      setBusy() { },
      setFieldError(el, msg) { fieldErrors.set(el?.id, msg || ''); },
      toast() { },
      showInlineError() { },
      guardMoneyInput() { },
      confirmAction: async () => true,
      subscribeToChanges() { },
      parseMoneyAmount: (raw, opts = {}) => {
        const num = Number(raw);
        if (raw === '' || raw === null || raw === undefined || !Number.isFinite(num)) return { valid: false, value: 0, error: 'Enter a valid amount.' };
        if (opts.min !== undefined && num < opts.min) return { valid: false, value: num, error: `Amount must be at least ${opts.min}.` };
        if (opts.max !== undefined && num > opts.max) return { valid: false, value: num, error: `Amount must not exceed ${opts.max}.` };
        return { valid: true, value: Math.round(num * 100) / 100, error: '' };
      },
      rpc: async (fn, params = {}) => {
        if (fn === 'get_monthly_monitor') return buildPayload(params.p_year, params.p_month);
        if (fn === 'save_monthly_monitor_entry') {
          if (params.p_entry_id) {
            dbEntries = dbEntries.map((r) => (r.id === params.p_entry_id ? { ...r, category: params.p_category, description: params.p_description || '', amount: params.p_amount, entry_date: params.p_entry_date } : r));
            return dbEntries.find((r) => r.id === params.p_entry_id);
          }
          const created = {
            id: `row-${dbEntries.length + 1}`,
            entry_type: params.p_entry_type,
            monitor_year: params.p_year,
            monitor_month: params.p_month,
            category: params.p_category,
            description: params.p_description || '',
            amount: params.p_amount,
            entry_date: params.p_entry_date
          };
          dbEntries.unshift(created);
          return created;
        }
        if (fn === 'delete_monthly_monitor_entry') {
          dbEntries = dbEntries.filter((r) => r.id !== params.p_entry_id);
          return null;
        }
        if (fn === 'save_monthly_monitor_settings') {
          dbSettings.set(`${params.p_year}-${params.p_month}`, params.p_mandatory_savings_pct);
          return buildPayload(params.p_year, params.p_month);
        }
        return null;
      }
    }
  };
  ctx.window = ctx;
  ctx.location = { hash: '', search: '' };
  ctx.addEventListener = () => { };

  vm.runInNewContext(js, ctx, { filename: 'js/cashflow-monitor.js' });
  await ctx.window.IponCashflowMonitor.mount({ failed: false, redirecting: false, configured: true, profile: { id: 'u1', role: 'MEMBER' } });

  // 1. Exact prompt example verification: ₱30,000 gross -> 20% = ₱6,000 -> ₱24,000 avail -> ₱15,000 exp -> ₱9,000 net (Oct ₱40,000 NOT mixed in!)
  assert.equal(els.get('cf-inc-gross').textContent, '₱30,000.00');
  assert.equal(els.get('cf-inc-savings').textContent, '−₱6,000.00');
  assert.equal(els.get('cf-inc-available').textContent, '₱24,000.00');
  assert.equal(els.get('cf-kpi-available').textContent, '₱24,000.00');
  assert.equal(els.get('cf-kpi-expenses').textContent, '₱15,000.00');
  assert.equal(els.get('cf-kpi-net').textContent, '₱9,000.00');
  assert.equal(els.get('cf-hero-net').textContent, '₱9,000.00');
  assert.equal(els.get('cf-seg-income-total').textContent, '₱24,000.00');
  assert.equal(els.get('cf-seg-expense-total').textContent, '₱15,000.00');
  assert.equal(els.get('cf-hero-card').classList.contains('is-deficit'), false);
  assert.equal(els.get('cf-meter-pct').textContent, '62.5%');

  // 2. Switching between Income and Expense views immediately displays corresponding totals
  assert.equal(els.get('cf-income-panel').hidden, false);
  assert.equal(els.get('cf-expense-panel').hidden, true);
  await els.get('cf-seg-expense')._emit('click');
  assert.equal(els.get('cf-income-panel').hidden, true);
  assert.equal(els.get('cf-expense-panel').hidden, false);
  assert.equal(els.get('cf-exp-total').textContent, '₱15,000.00');
  assert.equal(els.get('cf-exp-count').textContent, '2 expenses');

  // 3. Adding a large expense that exceeds available income triggers negative balance & deficit indicator
  await els.get('cf-add-expense-btn')._emit('click');
  els.get('cf-entry-category').value = 'Education';
  els.get('cf-entry-description').value = 'Tuition installment';
  els.get('cf-entry-amount').value = '12000';
  els.get('cf-entry-date').value = '2026-11-18';
  await els.get('cf-entry-form')._emit('submit');

  assert.equal(els.get('cf-kpi-expenses').textContent, '₱27,000.00');
  assert.equal(els.get('cf-hero-net').textContent, '−₱3,000.00');
  assert.equal(els.get('cf-kpi-net').textContent, '−₱3,000.00');
  assert.equal(els.get('cf-hero-card').classList.contains('is-deficit'), true);
  assert.match(els.get('cf-health-text').textContent, /Over available income by ₱3,000\.00/);

  // 4. Rejects invalid/negative monetary input cleanly without saving
  const prevLen = dbEntries.length;
  await els.get('cf-add-expense-btn')._emit('click');
  els.get('cf-entry-category').value = 'Shopping';
  els.get('cf-entry-amount').value = '-500';
  await els.get('cf-entry-form')._emit('submit');
  assert.equal(dbEntries.length, prevLen, 'Negative amounts must be rejected');
  assert.ok(fieldErrors.get('cf-entry-amount'));

  // 5. Configuring mandatory savings % immediately recalculates available & net income
  await els.get('cf-rate-open-btn')._emit('click');
  els.get('cf-rate-input').value = '10';
  await els.get('cf-rate-form')._emit('submit');
  // 10% of ₱30,000 = ₱3,000 -> ₱27,000 available -> ₱27,000 - ₱27,000 = ₱0.00
  assert.equal(els.get('cf-inc-savings').textContent, '−₱3,000.00');
  assert.equal(els.get('cf-inc-available').textContent, '₱27,000.00');
  assert.equal(els.get('cf-hero-net').textContent, '₱0.00');
  assert.equal(els.get('cf-hero-card').classList.contains('is-deficit'), false);

  // 6. Switching to previous month (October 2026) isolates records strictly to October
  await els.get('cf-month-prev')._emit('click');
  assert.equal(els.get('cf-inc-gross').textContent, '₱40,000.00');
  assert.equal(els.get('cf-inc-savings').textContent, '−₱8,000.00');
  assert.equal(els.get('cf-inc-available').textContent, '₱32,000.00');
  assert.equal(els.get('cf-kpi-expenses').textContent, '₱0.00');
  assert.equal(els.get('cf-hero-net').textContent, '₱32,000.00');
});
