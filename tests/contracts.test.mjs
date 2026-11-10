import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('all browser scripts pass syntax validation', () => {
  const directory = fileURLToPath(new URL('../js/', import.meta.url));
  for (const file of readdirSync(directory).filter((name) => name.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', join(directory, file)]);
  }
});

test('database keeps financial writes behind RLS and reviewed RPCs', () => {
  const schema = read('database/schema.sql');
  for (const table of ['profiles', 'members', 'contributions', 'expenses', 'withdrawals', 'audit_logs']) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'));
  }
  assert.match(schema, /create policy audit_logs_select[\s\S]*?using \(public\.is_admin\(\)\)/i);
  assert.match(schema, /revoke all on public\.profiles,[\s\S]*?public\.audit_logs[\s\S]*?from authenticated/i);
  assert.match(schema, /grant select on public\.profiles,[\s\S]*?public\.audit_logs to authenticated/i);
  assert.match(read('database/migrations/20261110_001_lock_confirmed_financial_records.sql'), /Only pending contributions can be edited/i);
});

test('every versioned migration is transactional and recorded', () => {
  const directory = new URL('../database/migrations/', import.meta.url);
  const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  assert.ok(migrations.length >= 3);
  for (const file of migrations) {
    const sql = readFileSync(new URL(file, directory), 'utf8');
    assert.match(sql, /^begin;/im, `${file} must begin a transaction`);
    assert.match(sql, /^commit;/im, `${file} must commit its transaction`);
    assert.match(sql, /schema_migrations/i, `${file} must update the migration ledger`);
  }
});

test('pages keep baseline security and accessible table headings', () => {
  const pages = readdirSync(root).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length >= 10);
  for (const file of pages) {
    const html = read(file);
    assert.match(html, /Content-Security-Policy/i, `${file} must declare a CSP`);
    assert.doesNotMatch(html, /<th>\s*<\/th>/i, `${file} has an unlabeled table column`);
  }
  assert.match(read('login.html'), /role="tab"/);
  assert.match(read('login.html'), /role="tabpanel"/);
});

test('large record lists use server-side counts, filters, and ranges', () => {
  const records = read('js/records.js');
  const members = read('js/members.js');
  assert.match(records, /count: 'exact'/);
  assert.match(records, /\.eq\('approval_status'/);
  assert.match(records, /\.range\(/);
  assert.doesNotMatch(records, /\.limit\(200\)/);
  assert.match(members, /\.ilike\('full_name'/);
  assert.match(members, /\.eq\('status'/);
  assert.match(members, /\.range\(/);
});
