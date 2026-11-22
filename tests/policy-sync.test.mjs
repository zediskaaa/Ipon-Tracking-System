import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Terms, Privacy, Data Deletion, login policy dialog, and js/policy.js stay synced with live system features', () => {
  const terms = read('terms.html');
  const privacy = read('privacy.html');
  const deletion = read('data-deletion.html');
  const policyJs = read('js/policy.js');
  const loginHtml = read('login.html');

  // 1. Unified effective date, version & zero non-existent features across all 5 legal surfaces
  for (const [name, doc] of [
    ['terms.html', terms],
    ['privacy.html', privacy],
    ['data-deletion.html', deletion],
    ['js/policy.js', policyJs],
    ['login.html', loginHtml]
  ]) {
    assert.match(doc, /November 22, 2026/, `${name} must carry the current November 22, 2026 effective date`);
    assert.doesNotMatch(doc, /pg_cron|autovacuum/i, `${name} must not expose internal Postgres maintenance jargon`);
    assert.doesNotMatch(doc, /Activity notifications are <strong>not sent via email<\/strong>/i, `${name} must not contradict milestone unpaid reminder emails`);
    assert.doesNotMatch(doc, /Facebook Login|Facebook Sign-In|Google &amp; Facebook|Google\/Facebook|Apps and Websites/i, `${name} must not advertise non-existent Facebook authentication`);
    assert.doesNotMatch(doc, /call_sessions|Voice\/video call|Call logs/i, `${name} must not advertise non-existent voice/video calling`);
    assert.doesNotMatch(doc, /\bsearchability\b|connection visibility/i, `${name} must not list non-existent privacy setting labels`);
  }
  assert.match(policyJs, /const CURRENT_POLICY_VERSION = '2026-11-22';/);
  assert.match(policyJs, /Effective Nov 22, 2026/);

  // 2. Terms surfaces cover solo/budget/monthly monitor tracking, chat privacy, badges, FCM push, and milestone unpaid reminder emails
  for (const [name, doc] of [
    ['terms.html', terms],
    ['js/policy.js', policyJs],
    ['login.html', loginHtml]
  ]) {
    assert.match(doc, /group and solo savings activity/i, `${name} must cover solo savings workspaces`);
    assert.match(doc, /personal 50\/30\/20 budget allocations and Monthly Income &amp; Expense Monitoring/i, `${name} must cover budget allocations & Monthly Income & Expense Monitoring`);
    assert.match(doc, /@username/i, `${name} must disclose username sign-in/handles`);
    assert.match(doc, /new-device login OTP codes/i, `${name} must disclose new-device email OTP`);
    assert.match(doc, /Vanishing Messages/i, `${name} must disclose Vanishing Messages`);
    assert.match(doc, /Anonymous Chat Mode/i, `${name} must disclose Anonymous Chat Mode`);
    assert.match(doc, /2 months of account inactivity/i, `${name} must disclose the 2-month permanent verified badge inactivity rule`);
    assert.match(doc, /Firebase Cloud Messaging \(FCM\)/i, `${name} must disclose Android FCM push delivery`);
    assert.match(doc, /milestone unpaid contribution/i, `${name} must disclose automated milestone unpaid reminder emails`);
    assert.match(doc, /58 characters/i, `${name} must disclose the 58-character bio limit`);
  }

  // 3. Privacy surfaces cover Google Sign-In, Cloudflare R2, FCM, Monthly Monitor, exact privacy settings, and retention windows
  for (const [name, doc] of [
    ['privacy.html', privacy],
    ['js/policy.js', policyJs],
    ['login.html', loginHtml]
  ]) {
    assert.match(doc, /Google Sign-In \(OAuth\)/i, `${name} must include Google Sign-In (Clerk OAuth) disclosure`);
    assert.match(doc, /Monthly Income &amp; Expense Monitoring/i, `${name} must disclose Monthly Income & Expense Monitoring`);
    assert.match(doc, /monthly_monitor_entries/i, `${name} must include monthly monitor tables under Ongoing protection`);
    assert.match(doc, /friend request and non-friend message request controls/i, `${name} must list accurate messaging privacy controls`);
    assert.match(doc, /Cloudflare R2/i, `${name} must disclose Cloudflare R2 private attachment storage`);
    assert.match(doc, /Supabase Storage/i, `${name} must disclose Supabase Storage public media bucket`);
    assert.match(doc, /android_app/i, `${name} must disclose client platform tracking for native screenshot protection`);
    assert.match(doc, /account_trusted_devices/i, `${name} must disclose 90-day trusted-device OTP token retention`);
    assert.match(doc, /data-deletion\.html/i, `${name} must link to User Data Deletion Instructions`);
  }

  // 4. Data Deletion covers Google Sign-In, Cloudflare R2, FCM/trusted-device tokens, solo/budget/monthly monitor, and ephemeral chats
  assert.match(deletion, /Revoke Google Sign-In access/i);
  assert.match(deletion, /Monthly Income &amp; Expense Monitoring/i);
  assert.match(deletion, /Cloudflare R2/i);
  assert.match(deletion, /Android FCM notification tokens/i);
  assert.match(deletion, /trusted-device OTP tokens/i);
  assert.match(deletion, /Anonymous Chat Mode/i);
  assert.match(deletion, /@username/i);
});
