import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

test('hidden user blocks enforce mutual blocking while staying hidden from blocker UI and unblock RPC', () => {
  const migration = read('database/migrations/20261121_145_hidden_user_blocks.sql');
  const schema = read('database/schema.sql');
  for (const sql of [migration, schema]) {
    assert.match(sql, /add column if not exists hidden_from_blocker boolean not null default false/i);
    assert.match(sql, /create policy blocked_users_select on public\.blocked_users for select to authenticated\s+using \(blocker_id = auth\.uid\(\) and not hidden_from_blocker\)/i);
    assert.match(sql, /create or replace function public\.unblock_social_user[\s\S]*?and not hidden_from_blocker;/i);
    assert.match(sql, /where b\.blocker_id = v_uid\s+and not b\.hidden_from_blocker\s+and p\.role in \('ADMIN', 'TREASURER', 'MEMBER'\)/i);
    assert.match(sql, /v_blocked_by_me := exists \(select 1 from public\.blocked_users b where b\.blocker_id = v_uid and b\.blocked_id = p_target_id and not b\.hidden_from_blocker\);/i);
    assert.match(sql, /'blocked_by_me', \(peer\.id <> v_uid and exists \(select 1 from public\.blocked_users b where b\.blocker_id = v_uid and b\.blocked_id = peer\.id and not b\.hidden_from_blocker\)\)/i);
    assert.match(sql, /'20261121_145'/);
  }
});
