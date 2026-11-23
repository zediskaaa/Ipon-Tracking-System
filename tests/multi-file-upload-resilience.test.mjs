import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Shared core.js uploader and manage-account signed Content-Type stay aligned while legacy chat uploads return 410', () => {
  const coreJs = read('js/core.js');
  const manageAccount = read('supabase/functions/manage-account/index.ts');

  assert.match(coreJs, /async function detachPickedFile\(file,/);
  assert.match(coreJs, /window\.Ipon = \{[\s\S]*?detachPickedFile,/);
  assert.match(coreJs, /async function uploadAuthorizedFile\(client, bucket, upload, file\)[\s\S]*?normalizeUploadContentType\(upload\?\.type \|\| file\?\.type \|\| ''\)/);
  assert.match(coreJs, /detachPickedFile\(file, \{ maxBytes: MAX_DETACH_FILE_BYTES \}\)/);

  // Every active R2 upload action returns the exact normalized rawType signed in signR2Object
  assert.match(manageAccount, /signR2Object\(ANNOUNCEMENTS_BUCKET, path, 'PUT', rawType\)[\s\S]*?type: rawType/);
  assert.match(manageAccount, /signR2Object\(RECORD_COMMENTS_BUCKET, path, 'PUT', rawType\)[\s\S]*?type: rawType/);
  assert.match(manageAccount, /'chat-upload-urls'[\s\S]*?410/);
});
