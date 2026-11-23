import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const latestMigration = fs.readFileSync('database/migrations/20261124_199_protect_myipon_update_announcement.sql', 'utf8').replaceAll('\r\n', '\n');
const previousMigration = fs.readFileSync('database/migrations/20261123_195_finalize_chat_and_friends_cleanup.sql', 'utf8').replaceAll('\r\n', '\n');
const schema = fs.readFileSync('database/schema.sql', 'utf8').replaceAll('\r\n', '\n');
const cleanupDefinition = (sql) => {
  const start = sql.lastIndexOf('create or replace function public.run_data_retention_cleanup(');
  const end = sql.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start);
  return sql.slice(start, end + 3);
};

test('the named announcement remains active and is excluded from automatic Bin cleanup', () => {
  assert.match(latestMigration, /add column if not exists retention_exempt boolean not null default false/);
  assert.match(latestMigration, /where id = 'e879dd4c-c83a-4534-9a91-86ad8b9e4476'::uuid\s+and title = 'myIPON Update: Focusing on What Matters'\s+and group_id is null/);

  const guarded = cleanupDefinition(latestMigration);
  const original = cleanupDefinition(previousMigration);
  assert.match(guarded, /from public\.announcements\s+where deleted_at is not null\s+and deleted_at < v_bin_cutoff\s+and retention_exempt = false/);
  assert.equal(guarded.replace('\n      and retention_exempt = false', ''), original);
  assert.equal(cleanupDefinition(schema), guarded);
  assert.match(latestMigration, /values \('20261124_199', 'protect myIPON update announcement from automatic cleanup'\)/);
});
