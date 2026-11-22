import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('notification drawer and messaging alerts use uniform compact single-line 3-row density', () => {
  const css = read('css/app.css');
  const core = read('js/core.js');
  const messages = read('js/messages.js');

  // Uniform 78px compact card with strictly single-line title, summary, and timestamp
  assert.match(css, /\.notification-item\{[^}]*min-height:78px;height:78px;[^}]*border:1px solid rgba\(20,45,43,\.06\)/);
  assert.match(css, /\.notification-item:has\(\.notification-invite-actions\)\{height:auto;min-height:78px;overflow:visible\}/);
  assert.match(css, /\.notification-item-copy strong\{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;/);
  assert.match(css, /\.notification-item p\{[^}]*display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);
  assert.match(css, /\.notification-item small\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis\}/);

  // Dark mode uniform surface borders
  assert.match(css, /html\[data-theme="dark"\] \.notification-item\s*\{[^}]*border-color:/);

  // Redundant notification bell & alerts panel removed from Messages & Connections modal
  assert.doesNotMatch(messages, /id="msg-alerts-btn"|id="msg-alerts-badge"|id="msg-view-alerts"|function renderAlertsView|function refreshSocialNotifications/);
  assert.doesNotMatch(css, /\.msg-alerts-list|\.msg-alert-row|\.msg-alert-copy|\.msg-alert-avatar/);

  // Multi-line notifications flatten cleanly to single-line summaries with hover tooltips
  assert.match(core, /function formatNotificationPreview\(item\)/);
  assert.match(core, /<strong title="\$\{escapeHtml\(displayTitle\)\}">\$\{escapeHtml\(displayTitle\)\}<\/strong>/);
  assert.match(core, /<p title="\$\{escapeHtml\(displayMessage\)\}">\$\{escapeHtml\(displayMessage\)\}<\/p>/);
});
