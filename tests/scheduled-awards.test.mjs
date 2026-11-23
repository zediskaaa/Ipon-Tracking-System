import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Migration 178, schema.sql, Super Admin Set Award modal, and core auto-delivery wire scheduled Verified Badges & Profile Effects end to end', () => {
  const mig = read('database/migrations/20261122_178_scheduled_awards.sql').replace(/\r\n/g, '\n').trim();
  const schema = read('database/schema.sql').replace(/\r\n/g, '\n');
  const html = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  // SQL migration & schema parity + partial unique index safety
  assert.ok(schema.includes(mig), 'database/schema.sql must include Migration 178 identically');
  assert.match(mig, /create table if not exists public\.scheduled_awards/);
  assert.match(mig, /create or replace function public\.process_due_scheduled_awards\(/);
  assert.match(mig, /if v_caller is null then\s+raise exception 'Authentication required to process scheduled awards\.' using errcode = '42501';/);
  assert.match(mig, /if not public\.is_super_admin\(\) then\s+v_scope_user_id := v_caller;/);
  assert.match(mig, /revoke all on function public\.process_due_scheduled_awards\(uuid\) from public, anon;\s+grant execute on function public\.process_due_scheduled_awards\(uuid\) to authenticated;/);
  assert.match(mig, /create or replace function public\.super_admin_create_scheduled_awards\(/);
  assert.match(mig, /create or replace function public\.super_admin_list_scheduled_awards\(/);
  assert.match(mig, /create or replace function public\.super_admin_update_scheduled_award\(/);
  assert.match(mig, /create or replace function public\.super_admin_cancel_scheduled_award\(/);
  assert.match(mig, /on conflict \(recipient_id, dedupe_key\) where dedupe_key is not null do nothing;/);
  assert.match(mig, /values \('20261122_178',/);

  // Balanced <dialog> tags and unique IDs in super-admin.html
  const opens = (html.match(/<dialog\b/g) || []).length;
  const closes = (html.match(/<\/dialog>/g) || []).length;
  assert.equal(opens, closes, 'Unbalanced <dialog> tags in super-admin.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate element IDs in super-admin.html');

  // Set award buttons + Scheduled subtab + modal controls
  assert.ok((html.match(/data-open-set-award=/g) || []).length >= 4, 'Expected Set award / Award multiple users buttons across Users, Badges, and Profile effects');
  assert.match(html, /id="effects-award-multiple-btn"[^>]*data-open-set-award="effects-now"/);
  assert.match(html, /data-set-award-quick="now"/);
  assert.match(saJs, /releaseNow:\s*false/);
  assert.match(saJs, /startImmediate = preset === 'effects-now' \|\| preset === 'badge-now'/);
  for (const id of [
    'effects-tab-scheduled',
    'effects-scheduled-badge',
    'effects-scheduled-wrap',
    'scheduled-awards-body',
    'set-award-dialog',
    'set-award-form',
    'set-award-badge-check',
    'set-award-effects-check',
    'set-award-users-list',
    'set-award-same-dt-btn',
    'set-award-shared-datetime',
    'set-award-apply-same-btn',
    'set-award-per-user-list',
    'set-award-submit',
    'scheduled-award-edit-dialog'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `Missing HTML element id="${id}"`);
  }

  // Runtime logic: multi-user + same date/time toggle + apply-same button + RPC wiring
  assert.match(saJs, /function openSetAwardDialog\(preset = 'all'\)/);
  assert.match(saJs, /setAwardSameDtBtn\?\.addEventListener\('click'/);
  assert.match(saJs, /setAwardApplySameBtn\?\.addEventListener\('click'/);
  assert.match(saJs, /super_admin_create_scheduled_awards/);
  assert.match(saJs, /super_admin_list_scheduled_awards/);
  assert.match(saJs, /super_admin_update_scheduled_award/);
  assert.match(saJs, /super_admin_cancel_scheduled_award/);
  assert.doesNotMatch(saJs, /scheduleNextScheduledAwardTick\(\)/);
  assert.match(coreJs, /rpc\('process_due_scheduled_awards',\s*\{\s*p_user_id:\s*profile\.id\s*\}\)/);

  // Responsive CSS styles
  assert.match(css, /\.set-award-dialog\s*\{\s*width:\s*min\(780px,\s*calc\(100vw - 24px\)\);\s*\}/);
  assert.match(css, /\.set-award-same-btn\[aria-pressed="true"\]/);
  assert.match(css, /\.scheduled-status-pill\.is-pending/);
});
