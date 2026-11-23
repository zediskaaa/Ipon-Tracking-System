import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Super Admin uses explicit manual refresh without presence dots or Realtime polling and keeps multi-group modal', () => {
  const html = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const css = read('css/app.css');

  // Balanced <dialog> tags and unique IDs in super-admin.html
  const opens = (html.match(/<dialog\b/g) || []).length;
  const closes = (html.match(/<\/dialog>/g) || []).length;
  assert.equal(opens, closes, 'Unbalanced <dialog> tags in super-admin.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs in super-admin.html');

  // Online/Last Seen presence UI and Realtime/polling full-panel refreshes are removed from Super Admin
  assert.match(html, /<body[^>]*data-page="super-admin"/);
  assert.doesNotMatch(html, /id="users-online-pill"|id="users-online-count"/);
  assert.doesNotMatch(saJs, /syncSuperAdminPresenceUi|Ipon\.isUserOnline|subscribeToChanges\('super-admin'|scheduledAwardAutoTimer/);
  assert.doesNotMatch(css, /\.sa-online-pill|\.presence-dot/);

  // Explicit Refresh controls + loading/error/retry handling across Super Admin panels
  const refreshMatches = html.match(/data-sa-refresh/g) || [];
  assert.ok(refreshMatches.length >= 6, `Expected Refresh buttons on all 6 Super Admin panels, found ${refreshMatches.length}`);
  assert.match(saJs, /async function refresh\(\{ triggerButton = null, showGlobalLoader = false \} = \{\}\)/);
  assert.match(saJs, /Ipon\.showInlineError\(overviewError/);
  assert.match(saJs, /Ipon\.showInlineError\(featureCardsContainer/);
  assert.match(css, /\.sa-refresh-btn\s*\{/);

  // Groups cell: 1 group renders inline chip, >1 groups renders modal trigger button
  assert.match(saJs, /function renderUserGroupsCell\(userGroups,\s*userId\)\s*\{[\s\S]*?if \(userGroups\.length === 1\)[\s\S]*?data-view-user-groups="\$\{userId\}"[\s\S]*?<strong>\$\{groupCount\}<\/strong> groups/);
  assert.doesNotMatch(saJs, /userGroups\.slice\(0,\s*2\)/);
  assert.match(html, /id="user-groups-dialog"[\s\S]*?class="user-groups-body"/);
  assert.match(css, /\.user-groups-body\s*\{[^}]*padding:\s*18px 22px 22px;/s);
});
