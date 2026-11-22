import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Super Admin Users shows real-time online/offline DP presence indicators and opens a modal when a user has more than 1 group', () => {
  const html = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const css = read('css/app.css');

  // Balanced <dialog> tags and unique IDs in super-admin.html
  const opens = (html.match(/<dialog\b/g) || []).length;
  const closes = (html.match(/<\/dialog>/g) || []).length;
  assert.equal(opens, closes, 'Unbalanced <dialog> tags in super-admin.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs in super-admin.html');

  // Real-time presence dot on Super Admin user DPs + live online counter
  assert.match(html, /<body[^>]*data-page="super-admin"/);
  assert.match(html, /id="users-online-pill"[\s\S]*?id="users-online-count"/);
  assert.match(saJs, /function syncSuperAdminPresenceUi\(\)/);
  assert.match(saJs, /window\.addEventListener\('ipon:presence-change',\s*syncSuperAdminPresenceUi\)/);
  assert.match(saJs, /Ipon\.isUserOnline\?\.\(p\.id\)/);
  assert.match(css, /body\[data-page="super-admin"\] \.table-user-avatar-wrap \.presence-dot[\s\S]*?opacity:\s*1;[\s\S]*?background:\s*#9ca3af;/);
  assert.match(css, /body\[data-page="super-admin"\] \.table-user-avatar-wrap \.presence-dot\.is-online[\s\S]*?background:\s*#22c55e;/);

  // Groups cell: 1 group renders inline chip, >1 groups renders modal trigger button
  assert.match(saJs, /function renderUserGroupsCell\(userGroups,\s*userId\)\s*\{[\s\S]*?if \(userGroups\.length === 1\)[\s\S]*?data-view-user-groups="\$\{userId\}"[\s\S]*?<strong>\$\{groupCount\}<\/strong> groups/);
  assert.doesNotMatch(saJs, /userGroups\.slice\(0,\s*2\)/);
  assert.match(html, /id="user-groups-dialog"[\s\S]*?class="user-groups-body"/);
  assert.match(css, /\.user-groups-body\s*\{[^}]*padding:\s*18px 22px 22px;/s);
});
