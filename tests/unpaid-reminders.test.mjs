import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Migration 156 and schema.sql automatically create daily in-app reminders for all unpaid, partial, and overdue members', () => {
  const mig156 = read('database/migrations/20261121_156_automatic_inapp_unpaid_reminders.sql');
  const schema = read('database/schema.sql');

  for (const sql of [mig156, schema]) {
    assert.match(sql, /'20261121_156'/);
    assert.match(sql, /ipon\.sync_due_periods/);
    assert.match(sql, /Unpaid contribution overdue/);
    assert.match(sql, /Contribution deadline approaching/);
    assert.match(sql, /Unpaid monthly contribution/);
    assert.match(sql, /cp\.period_month <= v_current_month/);
    assert.match(sql, /not cp\.is_exempt/);
    assert.match(sql, /up\.pending_amount < up\.outstanding_amount/);
    assert.match(sql, /'CONTRIBUTION_REMINDER:' \|\| up\.period_id::text \|\| ':' \|\| to_char\(current_date, 'YYYY-MM-DD'\)/);
    assert.match(sql, /'GOAL_REMINDER'/);
  }
  // Strictly app notifications (public.notifications), never sending email from unpaid reminders
  assert.doesNotMatch(mig156, /deliverEmail|sendInviteEmail|BREVO|RESEND/i);
});

test('js/core.js automatically syncs unpaid in-app reminders on load, resume, reconnect, and workspace switch without locking out failed syncs', () => {
  const coreJs = read('js/core.js');

  assert.match(coreJs, /const syncDueReminders = \(force = false\) =>/);
  assert.match(coreJs, /const manilaDay = isoDate\(\);/);
  assert.match(coreJs, /rpc\('sync_my_due_reminders'\)\.then\(\(scheduleRows\) => \{[\s\S]*localStorage\.setItem\(syncKey/);
  assert.match(coreJs, /document\.addEventListener\('visibilitychange'[\s\S]*syncDueReminders\(\)/);
  assert.match(coreJs, /window\.addEventListener\('online'[\s\S]*syncDueReminders\(\)/);
  assert.match(coreJs, /rpc\('sync_my_due_reminders'\)\.catch\(\(\) => \{ \}\)/);
});
