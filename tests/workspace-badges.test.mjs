import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('dashboard header and manage hub expose dedicated mode, role, and goal badges', () => {
  const html = read('dashboard.html');
  assert.match(
    html,
    /id="dashboard-group-mode"[^>]*>GROUP<\/span>\s*<span class="group-bar-badge" id="dashboard-group-role">[^<]*<\/span>\s*<span class="group-bar-badge is-goal" id="dashboard-group-goal-badge" hidden>GOAL<\/span>/
  );
  assert.match(
    html,
    /id="group-hub-mode"[^>]*>GROUP<\/span>\s*<span class="group-hub-role" id="group-hub-role">ADMIN<\/span>\s*<span class="group-hub-role is-goal" id="group-hub-goal-badge" hidden>GOAL<\/span>/
  );
});

test('dashboard.js syncs SOLO, GROUP + role, and active GOAL badges cleanly', () => {
  const js = read('js/dashboard.js');
  assert.match(js, /function syncWorkspaceGoalBadges\(\)/);
  assert.match(js, /groupModeEl\.textContent = isSolo \? 'SOLO' : 'GROUP';/);
  assert.match(js, /groupModeEl\.classList\.toggle\('is-solo', isSolo\);/);
  assert.match(js, /groupModeEl\.classList\.toggle\('is-group', !isSolo\);/);
  assert.match(js, /groupRoleEl\.hidden = isSolo;/);
  assert.match(js, /groupHubMode\.textContent = isSolo \? 'SOLO' : 'GROUP';/);
  assert.match(js, /groupHubRole\.hidden = isSolo;/);
  assert.match(js, /\[groupGoalBadgeEl, groupHubGoalBadge\]\.forEach\(/);
  assert.match(js, /activeGoalsList = allGoalsResult\?\.data \|\| \[\];\r?\n\s*syncWorkspaceGoalBadges\(\);/);
});

test('workspace switcher dropdown labels GROUP workspaces alongside role and applies consistent SOLO/GROUP badge variants', () => {
  const core = read('js/core.js');
  assert.match(
    core,
    /opt\.dataset\.badge = group\.workspace_mode === 'SOLO' \? 'SOLO' : \(group\.role \? `GROUP · \$\{group\.role\}` : 'GROUP'\);/
  );
  assert.match(
    core,
    /opt\.dataset\.badgeVariant = group\.workspace_mode === 'SOLO' \? 'solo' : 'group';/
  );
  assert.match(
    core,
    /triggerBadge\.className = `custom-select-badge\$\{badgeVariant \? ` is-\$\{badgeVariant\}` : ''\}`;/
  );
  assert.match(
    core,
    /<span class="custom-select-badge\$\{badgeVariant \? ` is-\$\{escapeHtml\(badgeVariant\)\}` : ''\}">\$\{escapeHtml\(badge\)\}<\/span>/
  );
  assert.match(
    core,
    /stroke="currentColor" stroke-width="2\.2"/
  );
});

test('SOLO, GROUP, and GOAL badge pills keep consistent light/dark styles across header and switcher dropdown', () => {
  const heroCss = read('css/hero-plates.css');
  const appCss = read('css/app.css');
  assert.match(heroCss, /\.group-bar-badge\s*\{[^}]*white-space:nowrap;[^}]*flex-shrink:0;/s);
  assert.match(heroCss, /\.group-bar-badge\.is-solo\s*\{[^}]*background:linear-gradient\(180deg,#cda54c 0%,#b38933 100%\);[^}]*color:#ffffff;/s);
  assert.match(heroCss, /\.group-bar-badge\.is-group\s*\{[^}]*background:#dceee1;[^}]*color:#0e4b33;/s);
  assert.match(heroCss, /\.group-bar-badge\.is-goal\s*\{[^}]*background:linear-gradient\(180deg,#4384aa 0%,#316c91 100%\);[^}]*color:#ffffff;/s);
  assert.match(heroCss, /html\[data-theme="dark"\] \.group-bar-badge\s*\{[^}]*background:#145c41;[^}]*color:#ffffff;/s);
  assert.match(heroCss, /html\[data-theme="dark"\] \.group-bar-badge\.is-solo\s*\{[^}]*background:linear-gradient\(180deg,#cda54c 0%,#b38933 100%\);[^}]*color:#ffffff;/s);
  assert.match(heroCss, /html\[data-theme="dark"\] \.group-bar-badge\.is-group\s*\{[^}]*background:#dceee1;[^}]*color:#0e4b33;/s);
  assert.match(heroCss, /html\[data-theme="dark"\] \.group-bar-badge\.is-goal\s*\{[^}]*background:linear-gradient\(180deg,#4384aa 0%,#316c91 100%\);[^}]*color:#ffffff;/s);
  assert.match(appCss, /\.group-hub-role\.is-solo\s*\{/);
  assert.match(appCss, /\.group-hub-role\.is-group\s*\{/);
  assert.match(appCss, /\.group-hub-role\.is-goal\s*\{/);
  assert.match(appCss, /\.custom-select-badge\.is-solo[^{]*\{[^}]*background:linear-gradient\(180deg,#cda54c 0%,#b38933 100%\);[^}]*color:#ffffff;?/s);
  assert.match(appCss, /\.custom-select-badge\.is-group[^{]*\{[^}]*background:#dceee1;[^}]*color:#0e4b33;?/s);
  assert.match(appCss, /html\[data-theme="dark"\] \.custom-select-option\.is-selected \.custom-select-badge\s*\{[^}]*color:\s*#d8fbe6;/s);
  assert.match(appCss, /html\[data-theme="dark"\] \.custom-select-option\.is-selected \.custom-select-badge\.is-solo\s*\{[^}]*color:\s*#ffffff;/s);
  assert.match(appCss, /html\[data-theme="dark"\] \.custom-select-option\.is-selected \.custom-select-badge\.is-group\s*\{[^}]*background:\s*#dceee1;[^}]*color:\s*#0e4b33;/s);
});
