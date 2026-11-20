import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('migration 139 defines secure update_announcement RPC with version cascade and storage path validation', () => {
  const migration = read('database/migrations/20261120_139_update_announcement_rpc.sql');
  const schema = read('database/schema.sql');

  for (const sql of [migration, schema]) {
    assert.match(sql, /create or replace function public\.update_announcement\(/i);
    assert.match(sql, /if not public\.mfa_access_allowed\(\)/i);
    assert.match(sql, /if v_profile\.role <> 'SUPER_ADMIN' then[\s\S]*?group_id is distinct from v_profile\.group_id/i);
    assert.match(sql, /update public\.feature_requests[\s\S]*?set release_version = v_next_version/i);
    assert.match(sql, /update public\.bug_reports[\s\S]*?set release_version = v_next_version/i);
    assert.match(sql, /grant execute on function public\.update_announcement\(uuid, text, text, jsonb, text\) to authenticated;/i);
    assert.match(sql, /'20261120_139'/);
  }
});

test('Release Update modal supports picture/video uploads and Edit mode alongside regular announcements', () => {
  const saHtml = read('super-admin.html');
  const saJs = read('js/super-admin.js');
  const coreJs = read('js/core.js');
  const appCss = read('css/app.css');

  // super-admin.html release form media picker
  assert.match(saHtml, /id="release-update-media-input"[^>]*accept="image\/\*,video\/\*"[^>]*multiple/);
  assert.match(saHtml, /id="release-update-media-previews"/);
  assert.match(saHtml, /id="release-update-submit"/);

  // core.js shared media uploader & announcement Edit button + edit mode
  assert.match(coreJs, /async function uploadAnnouncementAttachments\(/);
  assert.match(coreJs, /id="announcement-viewer-edit"/);
  assert.match(coreJs, /data-announcement-edit=/);
  assert.match(coreJs, /onEditRelease = null/);
  assert.match(coreJs, /await rpc\('update_announcement',/);
  assert.match(coreJs, /classifyAnnouncementFile, uploadAnnouncementAttachments, MAX_ANNOUNCEMENT_FILES/);

  // super-admin.js release media attachment + create/edit submission + cleanup
  assert.match(saJs, /onEditRelease:\s*\(item\) => openEditReleaseUpdateDialog\(item\)/);
  assert.match(saJs, /async function openEditReleaseUpdateDialog\(item\)/);
  assert.match(saJs, /Ipon\.uploadAnnouncementAttachments\(announcementId, releaseQueuedMedia/);
  assert.match(saJs, /Ipon\.rpc\('update_announcement',[\s\S]*?p_release_version:\s*version/);
  assert.match(saJs, /Ipon\.rpc\('create_announcement',[\s\S]*?p_attachments:\s*uploaded\.attachments/);
  assert.match(saJs, /action:\s*'announcement-cleanup-media'/);

  // CSS styles for edit button & card icon group
  assert.match(appCss, /\.announcement-card-icon-actions\{/);
  assert.match(appCss, /\.announcement-viewer-edit-btn\{/);
});
