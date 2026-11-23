import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function extractBreakdownRuntime(dashboardJs) {
  const start = dashboardJs.indexOf('  function formatBreakdownValue(');
  const end = dashboardJs.indexOf('  function renderGroupHeader(');
  assert.ok(start > 0 && end > start, 'Expected breakdown helper block in js/dashboard.js');
  return dashboardJs.slice(start, end);
}

function createMockElement(tag, attrs = {}) {
  const classes = new Set();
  const attributes = new Map(Object.entries(attrs));
  const styleProps = new Map();
  const el = {
    tagName: tag.toUpperCase(),
    hidden: false,
    dataset: {},
    textContent: '',
    innerHTML: '',
    children: [],
    classList: {
      add: (...list) => list.forEach((c) => classes.add(c)),
      remove: (...list) => list.forEach((c) => classes.delete(c)),
      toggle: (c, force) => (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : (force ? classes.add(c) : classes.delete(c))),
      contains: (c) => classes.has(c)
    },
    style: {
      setProperty: (k, v) => styleProps.set(k, String(v)),
      getPropertyValue: (k) => styleProps.get(k) || ''
    },
    setAttribute: (k, v) => attributes.set(k, String(v)),
    getAttribute: (k) => attributes.get(k) ?? null,
    removeAttribute: (k) => {
      attributes.delete(k);
      if (k === 'data-val-len') delete el.dataset.valLen;
    },
    querySelector: () => null
  };
  return el;
}

function createBreakdownHarness() {
  const dashboardJs = read('js/dashboard.js');
  const snippet = extractBreakdownRuntime(dashboardJs);
  const summaryBreakdownEl = createMockElement('dl');
  const summaryTileEls = {};
  for (const key of ['additions', 'deductions', 'expenses', 'pending']) {
    const tile = createMockElement('div', { 'data-summary-tile': key });
    const dd = createMockElement('dd');
    const barB = createMockElement('b');
    const meta = createMockElement('div');
    tile.querySelector = (sel) => {
      if (sel === 'dd') return dd;
      if (sel === '.breakdown-tile-bar b') return barB;
      if (sel === '.breakdown-tile-meta') return meta;
      return null;
    };
    tile._dd = dd;
    tile._bar = barB;
    tile._meta = meta;
    summaryTileEls[key] = tile;
  }

  const sandbox = {
    summaryBreakdownEl,
    summaryTileEls,
    lastSummaryBreakdownSnapshot: null,
    Number,
    Math,
    Boolean,
    String
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${snippet}\nthis.api = { formatBreakdownValue, formatBreakdownEntryMeta, syncSummaryBreakdownMode, renderSummaryBreakdown };`,
    sandbox
  );
  return { ...sandbox.api, summaryBreakdownEl, summaryTileEls };
}

test('dashboard .summary-breakdown markup, scoped CSS, and light/dark tokens match reference without external fonts or Filipino copy', () => {
  const html = read('dashboard.html');
  const css = read('css/hero-plates.css');
  const breakdownHtml = html.match(/<dl class="summary-breakdown"[\s\S]*?<\/dl>/)?.[0] || '';

  assert.ok(breakdownHtml.length > 0, 'dashboard.html must contain .summary-breakdown');
  for (const key of ['additions', 'deductions', 'expenses', 'pending']) {
    assert.match(breakdownHtml, new RegExp(`data-summary-tile="${key}"`), `Missing tile ${key}`);
  }
  assert.match(breakdownHtml, /<dt>Additions <span>confirmed<\/span><\/dt>/);
  assert.match(breakdownHtml, /<dt>Deductions <span>confirmed<\/span><\/dt>/);
  assert.match(breakdownHtml, /<dt>Expenses<\/dt>/);
  assert.match(breakdownHtml, /<dt>Pending <span>for review<\/span><\/dt>/);
  assert.match(breakdownHtml, /class="breakdown-tile-bar"/);
  assert.match(breakdownHtml, /class="breakdown-tile-meta">Loading…<\/div>/);
  assert.match(breakdownHtml, /data-no-cents-format="1"/);

  // English-only copy and zero external Google Fonts
  assert.doesNotMatch(html, /fonts\.googleapis\.com|Walang entry|Palitan ang mga value/i);
  assert.doesNotMatch(css, /fonts\.googleapis\.com|Fraunces|DM Sans/i);

  // Reference visual tokens and layout rules scoped strictly to .summary-breakdown
  assert.match(css, /\.summary-breakdown\s*\{[^}]*--sc-card:#fffdf9;[^}]*--sc-line:#ece4d8;[^}]*--sc-green:#14543f;[^}]*--sc-red:#b3322b;[^}]*--sc-amber:#9a6a14;/s);
  assert.match(css, /html\[data-theme="dark"\] \.summary-breakdown\s*\{[^}]*--sc-card:#1c352d;[^}]*--sc-line:rgba\(164,218,192,\.22\);[^}]*--sc-green:#7fe0ad;[^}]*--sc-red:#f59c95;[^}]*--sc-amber:#f2c86f;/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile\s*\{[^}]*padding:20px 20px 18px;[^}]*border-radius:22px;/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile::before\s*\{[^}]*radial-gradient\(120% 90% at 0% 0%,var\(--sc-tint\),transparent 60%\)/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile\.is-zero::before\s*\{[^}]*opacity:\.45;/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile\.is-zero dd\s*\{[^}]*opacity:\.38;/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile \.status-icon\s*\{[^}]*width:46px;\s*height:46px;[^}]*box-shadow:0 0 0 5px color-mix/s);
  assert.match(css, /\.summary-breakdown dd\s*\{[^}]*font-variant-numeric:tabular-nums lining-nums;/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile-bar\s*\{[^}]*height:5px;/s);
  assert.match(css, /\.summary-breakdown \.breakdown-tile-bar b\s*\{[^}]*width:var\(--w,0%\);[^}]*linear-gradient\(90deg,/s);
  assert.match(css, /\.summary-breakdown dt span\s*\{[^}]*display:block;/);

  // Deliberate Solo 3-card layout with zero blank fourth slot
  assert.match(css, /\.summary-breakdown\.is-solo \[data-summary-tile="expenses"\][^}]*display:none;/s);
  assert.match(css, /\.summary-breakdown\.is-solo \[data-summary-tile="pending"\]\s*\{\s*grid-column:1 \/ -1;\s*\}/);
  assert.match(css, /@container \(min-width:560px\)\s*\{[\s\S]*?\.summary-breakdown\.is-solo\s*\{\s*grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/);

  // Mobile and reduced-motion rules
  assert.match(css, /@media \(max-width:520px\)\s*\{[\s\S]*?\.summary-breakdown \.breakdown-tile\s*\{\s*padding:15px 14px;\s*border-radius:18px;\s*\}/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\s*\{[\s\S]*?\.summary-breakdown \.breakdown-tile[^}]*transition:none;[\s\S]*?\.summary-breakdown \.breakdown-tile:hover\s*\{\s*transform:none;\s*\}/);
});

test('migration 197 extends get_savings_summary with real entry counts without extra client RPCs or financial formula changes', () => {
  const mig197 = read('database/migrations/20261123_197_savings_summary_entry_counts.sql');
  const schema = read('database/schema.sql');
  const dashboardJs = read('js/dashboard.js');

  for (const sql of [mig197, schema]) {
    const fn = [...sql.matchAll(/create or replace function public\.get_savings_summary\(\)[\s\S]*?\$\$;/gi)].pop()?.[0] || '';
    assert.ok(fn.length > 0, 'Missing get_savings_summary definition');
    assert.match(fn, /'additions_count',\s*ct\.additions_count/);
    assert.match(fn, /'deductions_count',\s*ct\.deductions_count/);
    assert.match(fn, /'expenses_count',\s*ct\.expenses_count/);
    assert.match(fn, /'has_archived_additions',\s*ct\.has_archived_additions/);
    assert.match(fn, /'tracked_savings',\s*ct\.total_additions - ct\.total_deductions - ct\.total_expenses/);
    assert.match(fn, /'MEMBER'/);
    assert.doesNotMatch(fn, /cascade/i);
  }
  assert.match(mig197, /grant execute on function public\.get_savings_summary\(\) to authenticated;/i);
  assert.match(mig197, /values \('20261123_197', 'savings_summary_entry_counts'\)/);

  // Dashboard uses only the existing get_savings_summary and get_pending_review_summary RPCs
  const summaryRpcCalls = dashboardJs.match(/\.rpc\('get_savings_summary'\)/g) || [];
  const pendingRpcCalls = dashboardJs.match(/\.rpc\('get_pending_review_summary'\)/g) || [];
  assert.equal(summaryRpcCalls.length, 1);
  assert.equal(pendingRpcCalls.length, 1);
  assert.doesNotMatch(dashboardJs, /get_summary_counts|get_breakdown_counts/);
});

test('breakdown runtime renders Group 4-card, Solo 3-card, instant workspace switches, zero/large amounts, and error states cleanly', () => {
  const h = createBreakdownHarness();

  // 1. Group workspace: all 4 cards visible, proportional progress bars, real entry counts
  const groupSummary = {
    total_additions: 15000,
    total_deductions: 2000,
    total_expenses: 1500,
    additions_count: 5,
    deductions_count: 1,
    expenses_count: 2,
    tracked_savings: 11500
  };
  const groupPending = { amount: 1500, count: 1 };
  h.renderSummaryBreakdown({ summary: groupSummary, pending: groupPending, isSolo: false });

  assert.equal(h.summaryBreakdownEl.classList.contains('is-solo'), false);
  assert.equal(h.summaryTileEls.additions.hidden, false);
  assert.equal(h.summaryTileEls.deductions.hidden, false);
  assert.equal(h.summaryTileEls.expenses.hidden, false);
  assert.equal(h.summaryTileEls.pending.hidden, false);
  assert.equal(h.summaryTileEls.additions._bar.style.getPropertyValue('--w'), '75%');
  assert.equal(h.summaryTileEls.deductions._bar.style.getPropertyValue('--w'), '10%');
  assert.equal(h.summaryTileEls.expenses._bar.style.getPropertyValue('--w'), '8%');
  assert.equal(h.summaryTileEls.pending._bar.style.getPropertyValue('--w'), '8%');
  assert.equal(h.summaryTileEls.additions._meta.textContent, '5 entries');
  assert.equal(h.summaryTileEls.deductions._meta.textContent, '1 entry');
  assert.equal(h.summaryTileEls.expenses._meta.textContent, '2 entries');
  assert.equal(h.summaryTileEls.pending._meta.textContent, '1 entry');
  assert.equal(h.summaryTileEls.additions._dd.dataset.valLen, 'md');
  assert.match(h.summaryTileEls.additions._dd.innerHTML, /<i>₱<\/i><span class="breakdown-val-num">15,000<\/span><span class="breakdown-val-cents">\.00<\/span>/);

  // 2. Immediate switch to Solo mode: hides Expenses completely, recomputes 3-card shares, preserves historical expenses untouched
  h.syncSummaryBreakdownMode(true);
  assert.equal(h.summaryBreakdownEl.classList.contains('is-solo'), true);
  assert.equal(h.summaryTileEls.expenses.hidden, true);
  assert.equal(h.summaryTileEls.additions.hidden, false);
  assert.equal(h.summaryTileEls.deductions.hidden, false);
  assert.equal(h.summaryTileEls.pending.hidden, false);
  // Visible total = 15000 + 2000 + 1500 = 18500 -> Additions 81%, Deductions 11%, Pending 8%
  assert.equal(h.summaryTileEls.additions._bar.style.getPropertyValue('--w'), '81%');
  assert.equal(h.summaryTileEls.deductions._bar.style.getPropertyValue('--w'), '11%');
  assert.equal(h.summaryTileEls.pending._bar.style.getPropertyValue('--w'), '8%');
  // Historical expense data object was NOT mutated or erased
  assert.equal(groupSummary.total_expenses, 1500);
  assert.equal(groupSummary.tracked_savings, 11500);

  // 3. Immediate switch back to Group mode restores all 4 cards and original proportions
  h.syncSummaryBreakdownMode(false);
  assert.equal(h.summaryBreakdownEl.classList.contains('is-solo'), false);
  assert.equal(h.summaryTileEls.expenses.hidden, false);
  assert.equal(h.summaryTileEls.additions._bar.style.getPropertyValue('--w'), '75%');

  // 4. Zero state, archived-only fallback, omitted-count fallback, and huge peso scaling
  h.renderSummaryBreakdown({
    summary: {
      total_additions: 999999999999.99,
      total_deductions: 0,
      total_expenses: 500,
      additions_count: 12,
      deductions_count: 0,
      expenses_count: 0,
      has_archived_expenses: true
    },
    pending: { amount: 0, count: 0 },
    isSolo: false
  });
  assert.equal(h.summaryTileEls.additions._dd.dataset.valLen, 'xl');
  assert.match(h.summaryTileEls.additions._dd.innerHTML, /999,999,999,999<\/span><span class="breakdown-val-cents">\.99<\/span>/);
  assert.equal(h.summaryTileEls.deductions.classList.contains('is-zero'), true);
  assert.equal(h.summaryTileEls.deductions._meta.textContent, 'No entries');
  assert.equal(h.summaryTileEls.deductions._bar.style.getPropertyValue('--w'), '0%');
  assert.equal(h.summaryTileEls.expenses._meta.textContent, 'Archived entries');
  assert.equal(h.summaryTileEls.expenses._bar.style.getPropertyValue('--w'), '4%'); // minimum visible bar for non-zero value
  assert.equal(h.summaryTileEls.pending.classList.contains('is-zero'), true);
  assert.equal(h.summaryTileEls.pending._meta.textContent, 'No entries');

  // Legacy response omitting count never invents a fake count
  assert.equal(h.formatBreakdownEntryMeta(undefined, { amount: 250 }), 'Confirmed total');
  assert.equal(h.formatBreakdownEntryMeta(undefined, { amount: 0 }), 'No entries');
  assert.equal(h.formatBreakdownEntryMeta(undefined, { amount: 100, pending: true }), 'Pending review');

  // 5. Error state clears numeric values cleanly
  h.renderSummaryBreakdown({ isSolo: true, error: true });
  assert.equal(h.summaryTileEls.additions._dd.textContent, '—');
  assert.equal(h.summaryTileEls.additions._meta.textContent, 'Unavailable');
  assert.equal(h.summaryTileEls.additions._bar.style.getPropertyValue('--w'), '0%');
  assert.equal(h.summaryTileEls.expenses.hidden, true);
});
