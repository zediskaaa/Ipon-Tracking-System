import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('global native select rules lock single non-repeating right-aligned arrow across light and dark themes', () => {
  const appCss = read('css/app.css');

  // Light universal select rule locks appearance, single SVG arrow with explicit dimensions, no-repeat, right position, size, padding, and ellipsis
  const lightRule = appCss.match(/select:not\(\.custom-select-native\)\{[^}]+\}/)?.[0] || '';
  assert.ok(lightRule.length > 0, 'Missing universal select:not(.custom-select-native) rule');
  assert.match(lightRule, /appearance:none!important/);
  assert.match(lightRule, /-webkit-appearance:none!important/);
  assert.match(lightRule, /-moz-appearance:none!important/);
  assert.match(lightRule, /width='20' height='20'/);
  assert.match(lightRule, /background-repeat:no-repeat!important/);
  assert.match(lightRule, /background-position:right 12px center!important/);
  assert.match(lightRule, /background-size:16px 16px!important/);
  assert.match(lightRule, /padding-right:36px!important/);
  assert.match(lightRule, /text-overflow:ellipsis/);
  assert.match(appCss, /select:not\(\.custom-select-native\)::-ms-expand\{display:none\}/);

  // Dark universal select rule keeps explicit SVG dimensions and locks no-repeat/position/size
  const darkRule = appCss.match(/html\[data-theme="dark"\] select:not\(\.custom-select-native\)\s*\{[^}]+\}/)?.[0] || '';
  assert.ok(darkRule.length > 0, 'Missing dark select:not(.custom-select-native) rule');
  assert.match(darkRule, /width='20' height='20'/);
  assert.match(darkRule, /background-repeat:\s*no-repeat !important/);
  assert.match(darkRule, /background-position:\s*right 12px center !important/);
  assert.match(darkRule, /background-size:\s*16px 16px !important/);

  // Dark form block (which targets .table-filters select, .compact-filter select, .field select, etc.) MUST NOT use background: shorthand
  const darkFormBlock = appCss.match(/html\[data-theme="dark"\] \.field input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),[\s\S]*?\}/)?.[0] || '';
  assert.ok(darkFormBlock.length > 0, 'Missing dark form inputs block');
  assert.match(darkFormBlock, /background-color:\s*var\(--surface-input\) !important/);
  assert.doesNotMatch(darkFormBlock, /(?:^|[\s;{])background\s*:/, 'Dark form select block must not use background: shorthand that resets background-repeat/position/size');
});

test('no dark-mode or post-universal select rule uses background shorthand that tiles or strips the dropdown chevron', () => {
  const sheets = ['css/app.css', 'css/hero-plates.css', 'css/cashflow-monitor.css', 'css/tutorial.css', 'css/landing.css'];
  const offenders = [];

  for (const rel of sheets) {
    const src = read(rel);
    const ruleRe = /([^{}@]+)\{([^{}]+)\}/g;
    let m;
    while ((m = ruleRe.exec(src))) {
      const sel = m[1].trim();
      const body = m[2].trim();
      const targetsNativeSelect = /(?:^|[\s>+~,])select(?=$|[\s.:#\[>+~,])/i.test(sel)
        || /\.(?:cf-compare-select|group-switcher-select|tutorial-cat-select)\b/i.test(sel);
      if (!targetsNativeSelect || /option\b|custom-select-native/i.test(sel)) continue;
      // Ignore legacy pre-universal light-mode base blocks earlier in app.css before line 1270
      const lineNo = src.slice(0, m.index).split(/\r?\n/).length;
      if (rel === 'css/app.css' && lineNo < 1270) continue;
      if (/(?:^|[\s;])background\s*:/i.test(body)) {
        offenders.push(`${rel}:${lineNo} ${sel.replace(/\s+/g, ' ')}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `Select rules must use background-color instead of background shorthand: ${offenders.join('; ')}`);
});

test('wrapper-chevron selects and custom dropdown widgets never paint a second arrow or clip selected labels', () => {
  const appCss = read('css/app.css');
  const tutorialCss = read('css/tutorial.css');

  // 1. Custom dropdown hidden native <select> cannot paint a ghost arrow or inflate flex/grid width
  const nativeHidden = appCss.match(/\.custom-select-native\{[^}]+\}/)?.[0] || '';
  assert.match(nativeHidden, /opacity:0!important/);
  assert.match(nativeHidden, /min-width:0!important/);
  assert.match(nativeHidden, /min-height:0!important/);
  assert.match(nativeHidden, /appearance:none!important/);
  assert.match(nativeHidden, /background-image:none!important/);
  assert.match(nativeHidden, /clip-path:inset\(50%\)!important/);

  // 2. Custom select label container truncates long text cleanly before the single chevron
  const selectionRule = appCss.match(/\.custom-select-selection\{[^}]+\}/)?.[0] || '';
  assert.match(selectionRule, /min-width:0/);
  assert.match(selectionRule, /overflow:hidden/);
  const triggerLabelRule = appCss.match(/\.custom-select-trigger-label\{[^}]+\}/)?.[0] || '';
  assert.match(triggerLabelRule, /min-width:0/);
  assert.match(triggerLabelRule, /text-overflow:ellipsis/);

  // 3. Profile effects category select (uses .effects-category-field::after) suppresses global bg chevron in light & dark
  assert.match(appCss, /\.effects-category-field > select:not\(\.custom-select-native\),\s*html\[data-theme="dark"\] \.effects-category-field > select:not\(\.custom-select-native\)\s*\{[^}]*background-image:\s*none !important;/s);

  // 4. Tutorial category select (uses .tutorial-cat-select-chevron SVG) suppresses global bg chevron in light & dark
  assert.match(tutorialCss, /select\.tutorial-cat-select:not\(\.custom-select-native\)\s*\{[^}]*background-image:\s*none !important;/s);
  assert.match(tutorialCss, /html\[data-theme="dark"\] select\.tutorial-cat-select:not\(\.custom-select-native\)\s*\{[^}]*background-color:\s*#13261f !important;[^}]*background-image:\s*none !important;/s);
});

test('representative dropdowns across all pages remain intact and load patched CSS assets', () => {
  const expected = [
    ['reports.html', /id="report-year"/, /id="member-report-status"/],
    ['members.html', /id="member-status-filter"/, /id="member-permissions-role-filter"/],
    ['contributions.html', /id="record-member-filter"/, /id="record-status-filter"/],
    ['budget.html', /id="cf-expense-cat-filter"/, /id="cf-compare-select"/],
    ['dashboard.html', /id="dashboard-group-select"/, /id="calendar-goal-select"/],
    ['settings.html', /css\/app\.css\?v=20261124-02/],
    ['super-admin.html', /css\/app\.css\?v=20261124-02/],
    ['audit.html', /id="audit-table-filter"/, /id="audit-action-filter"/]
  ];
  for (const [file, ...patterns] of expected) {
    const html = read(file);
    assert.match(html, /css\/app\.css\?v=20261124-02/, `${file} must load updated app.css`);
    for (const pat of patterns) {
      assert.match(html, pat, `${file} missing expected dropdown contract ${pat}`);
    }
  }
});
