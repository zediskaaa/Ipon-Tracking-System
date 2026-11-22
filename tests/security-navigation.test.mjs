import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function loadFunction(text, start, end, context) {
  const beginning = text.indexOf(start);
  assert.notEqual(beginning, -1);
  const finish = text.indexOf(end, beginning);
  assert.notEqual(finish, -1);
  return vm.runInNewContext(`${text.slice(beginning, finish)}; ${start.match(/function\s+(\w+)/)[1]}`, context);
}

test('account emails use a server-owned login URL for both invitation and approval', () => {
  const account = source('supabase/functions/manage-account/index.ts');
  assert.match(account, /const APP_LOGIN_URL = 'https:\/\/my-ipon\.vercel\.app\/login\.html'/);
  assert.equal((account.match(/const originUrl = APP_LOGIN_URL;/g) || []).length, 2);
  assert.doesNotMatch(account, /body\.login_url/);
});

test('password recovery links use the trusted reset handler from every entry point', () => {
  const auth = source('js/auth.js');
  const members = source('js/members.js');
  const superAdmin = source('js/super-admin.js');
  assert.match(auth, /const redirectTo = 'https:\/\/my-ipon\.vercel\.app\/reset-password\.html'/);
  for (const entry of [members, superAdmin]) {
    assert.match(entry, /resetPasswordForEmail\([^\n]+redirectTo: 'https:\/\/my-ipon\.vercel\.app\/reset-password\.html'/);
    assert.doesNotMatch(entry, /resetPasswordForEmail\([^\n]+account\.html/);
  }
});

test('public username lookup does not disclose username and email matches', () => {
  const account = source('supabase/functions/manage-account/index.ts');
  const start = account.indexOf("if (body.action === 'check-signup-username')");
  const end = account.indexOf("if (body.action === 'login-throttle-status')", start);
  assert.ok(start !== -1 && end > start);
  const lookup = account.slice(start, end);
  assert.match(lookup, /\.select\('id'\)/);
  assert.match(lookup, /available: !existing/);
  assert.doesNotMatch(lookup, /body\.email|existing\.email/);
});

test('push notification clicks stay on first-party HTML pages', () => {
  const normalize = loadFunction(source('sw.js'), 'function normalizeNotificationPath(', "self.addEventListener('push'", {
    URL,
    self: { location: { origin: 'https://my-ipon.vercel.app' } }
  });
  assert.equal(normalize('dashboard.html?chat=123'), '/dashboard.html?chat=123');
  assert.equal(normalize('https://my-ipon.vercel.app/user.html#profile'), '/user.html#profile');
  for (const unsafe of ['https://evil.example/login.html', '//evil.example/login.html', 'javascript:alert(1)', '/../../evil.html', '/api/delete']) {
    assert.equal(normalize(unsafe), '/dashboard.html', unsafe);
  }
});

test('in-app notification targets reject external origins', () => {
  const safeTarget = loadFunction(source('js/core.js'), 'function safeNotificationTarget(', 'function attachNativeNotificationTapListener(', {
    URL,
    location: { origin: 'https://my-ipon.vercel.app' }
  });
  assert.equal(safeTarget('dashboard.html?chat=123'), 'dashboard.html?chat=123');
  assert.equal(safeTarget('https://my-ipon.vercel.app/user.html'), 'user.html');
  for (const unsafe of ['https://evil.example/login.html', '//evil.example/login.html', 'javascript:alert(1)', '../login.html']) {
    assert.equal(safeTarget(unsafe), '', unsafe);
  }
});
