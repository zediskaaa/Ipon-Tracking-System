import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('dashboard .summary-hero markup and scoped CSS match Tracked Savings reference without Google Fonts or Filipino copy', () => {
  const html = read('dashboard.html');
  const css = read('css/hero-plates.css');
  const heroHtml = html.match(/<div class="summary-hero"[\s\S]*?<dl class="summary-breakdown"/)?.[0] || '';

  assert.ok(heroHtml.length > 0, 'dashboard.html must contain .summary-hero');
  assert.match(heroHtml, /id="tracked-heading"/);
  assert.match(heroHtml, /class="info-tip-btn"/);
  assert.match(heroHtml, /class="tracked-total"[^>]*data-no-cents-format="1"/);
  assert.match(heroHtml, /id="dashboard-cycle-badge"/);
  assert.match(heroHtml, /id="dashboard-record-entry"[^>]*><svg[^>]*>[\s\S]*?<span>Record entry<\/span>/);
  assert.match(heroHtml, /class="dashboard-wallet-pill is-cash"[\s\S]*?class="wallet-pill-ico"[\s\S]*?id="dashboard-wallet-cash"[\s\S]*?class="wallet-pill-wm"/);
  assert.match(heroHtml, /class="dashboard-wallet-pill is-digital"[\s\S]*?class="wallet-pill-ico"[\s\S]*?id="dashboard-wallet-digital"[\s\S]*?class="wallet-pill-wm"/);
  assert.match(heroHtml, /id="dashboard-wallet-untagged-wrap"[^>]*hidden/);
  assert.match(heroHtml, /class="dashboard-wallet-link" href="reports\.html#wallet-reconciliation"><svg[\s\S]*?<span>Reconcile<\/span>/);
  assert.doesNotMatch(heroHtml, /Ano ang tracked savings|Kabuuan ng cash|fonts\.googleapis\.com/i);

  // Scoped Tracked Savings visual tokens & key styling rules
  assert.match(css, /\.summary-hero\s*\{[^}]*--th-d1:#0c231c;[^}]*--th-d2:#143b2e;[^}]*--th-gold:#e3c27a;[^}]*--th-gold2:#b8944d;[^}]*border-radius:26px;/s);
  assert.match(css, /\.summary-hero::after\s*\{[^}]*linear-gradient\(90deg,transparent,var\(--th-gold\),transparent\)/s);
  assert.match(css, /\.tracked-total i,[\s\S]*?background:linear-gradient\(180deg,#f3dc9f,var\(--th-gold\) 55%,var\(--th-gold2\)\);/);
  assert.match(css, /\.record-entry-action\s*\{[^}]*border-radius:99px;[^}]*linear-gradient\(180deg,#f0d690,var\(--th-gold\) 60%,#d3ac5e\)/s);
  assert.match(css, /\.dashboard-wallet-pills\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/s);
  assert.match(css, /\.summary-card \.dashboard-wallet-pill\s*\{[^}]*border-radius:18px;[^}]*radial-gradient\(120% 100% at 0% 0%,var\(--th-tn/s);
  assert.match(css, /\.summary-card \.dashboard-wallet-pill > \.wallet-pill-wm\s*\{[^}]*width:92px;\s*height:92px;[^}]*opacity:\.08;/s);
  assert.match(css, /\.summary-card \.dashboard-wallet-link\s*\{[^}]*border-radius:16px;/s);
  assert.match(css, /html\[data-theme="dark"\]\s+\.summary-card\s+\.dashboard-wallet-strip\s*\{[^}]*background:transparent;/s);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\s*\{[\s\S]*?\.record-entry-action,\.summary-card \.dashboard-wallet-link/);
});

test('renderHeroMoneyEl formats hero total and wallet sub-cards with superscript peso, small centavos, negative sign, and auto-scaling tiers', () => {
  const js = read('js/dashboard.js');
  const start = js.indexOf('  function renderHeroMoneyEl(');
  const end = js.indexOf('  const groupAvatarEl =', start);
  assert.ok(start > 0 && end > start, 'Expected renderHeroMoneyEl in js/dashboard.js');

  const sandbox = { Number, Math, String };
  vm.createContext(sandbox);
  vm.runInContext(`${js.slice(start, end)}\nthis.renderHeroMoneyEl = renderHeroMoneyEl;`, sandbox);

  const makeEl = () => {
    let _html = '';
    return {
      dataset: {},
      textContent: '',
      get innerHTML() { return _html; },
      set innerHTML(v) {
        _html = String(v);
        this.textContent = _html.replace(/<[^>]+>/g, '');
      }
    };
  };

  const tot = makeEl();
  sandbox.renderHeroMoneyEl(tot, 12500.5, { smallTag: 'i' });
  assert.equal(tot.textContent, '₱12,500.50');
  assert.equal(tot.dataset.valLen, 'md');
  assert.match(tot.innerHTML, /^<i>₱<\/i><span class="hero-val-num">12,500<\/span><span class="hero-val-cents">\.50<\/span>$/);

  const cash = makeEl();
  sandbox.renderHeroMoneyEl(cash, 8, { smallTag: 'small' });
  assert.equal(cash.textContent, '₱8.00');
  assert.equal(cash.dataset.valLen, 'sm');
  assert.match(cash.innerHTML, /^<small>₱<\/small><span class="hero-val-num">8<\/span><span class="hero-val-cents">\.00<\/span>$/);

  const huge = makeEl();
  sandbox.renderHeroMoneyEl(huge, 999999999999.99, { smallTag: 'i' });
  assert.equal(huge.textContent, '₱999,999,999,999.99');
  assert.equal(huge.dataset.valLen, 'xl');

  const neg = makeEl();
  sandbox.renderHeroMoneyEl(neg, -250.25, { smallTag: 'i' });
  assert.equal(neg.textContent, '−₱250.25');
  assert.match(neg.innerHTML, /^<i>−₱<\/i>/);
});
