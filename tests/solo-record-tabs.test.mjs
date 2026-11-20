import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Solo savings hides Expenses and Requests record tabs, balances mobile 3-column grid, and hides Quick Record Expense tab', () => {
  const pages = ['contributions.html', 'withdrawals.html', 'expenses.html', 'savings.html', 'requests.html'];
  for (const page of pages) {
    const html = read(page);
    const tabsMatch = html.match(/<nav class="record-tabs"[^>]*>([\s\S]*?)<\/nav>/);
    assert.ok(tabsMatch, `${page} must render .record-tabs`);
    assert.match(tabsMatch[1], /<a[^>]*href="expenses\.html"[^>]*data-group-only="1"/, `${page} Expenses tab must be group-only`);
    assert.match(tabsMatch[1], /<a[^>]*href="requests\.html"[^>]*data-group-only="1"/, `${page} Requests tab must be group-only`);
  }

  const css = read('css/app.css');
  assert.match(css, /html\[data-workspace-mode="SOLO"\] \.record-tabs a\[data-group-only\]\s*\{\s*display:\s*none\s*!important;/);
  assert.match(css, /html\[data-workspace-mode="SOLO"\] \.record-tabs\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(css, /\.quick-record-type-tabs\{display:grid;grid-auto-flow:column;grid-auto-columns:minmax\(0,1fr\);/);
  assert.match(css, /\.quick-record-type-tabs\[hidden\],\.quick-type-tab\[hidden\]\{display:none!important\}/);

  const configJs = read('js/config.js');
  assert.match(configJs, /root\.dataset\.workspaceMode = workspaceMode;/);

  const dashboardJs = read('js/dashboard.js');
  assert.match(dashboardJs, /const isSoloMode = currentGroup\?\.workspace_mode === 'SOLO';[\s\S]*?const canExpense = !isSoloMode && \(state\.profile\?\.role === 'ADMIN' \|\| perms\.can_record_expenses === true\);/);

  const recordsJs = read('js/records.js');
  assert.match(recordsJs, /if \(page === 'expenses' && state\.profile\.workspace_mode === 'SOLO'\)\s*\{\s*window\.location\.replace\('withdrawals\.html'\);\s*return;\s*\}/);

  const requestsJs = read('js/requests.js');
  assert.match(requestsJs, /if \(state\.profile\.workspace_mode === 'SOLO'\)\s*\{\s*window\.location\.replace\('contributions\.html'\);\s*return;\s*\}/);
});
