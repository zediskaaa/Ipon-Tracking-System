import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('js/auth.js', 'utf8');
const classifier = source.match(/function isTransientLoginNetworkError\(error\)\s*\{[\s\S]*?\n  \}/)?.[0];
const retry = source.match(/async function retryTransientLoginRequest\(request\)\s*\{[\s\S]*?\n  \}/)?.[0];

test('password sign-in retries a transient post-auth network failure once without retrying invalid credentials', async () => {
  assert.ok(classifier && retry);
  const run = new Function('setTimeout', `${classifier}; ${retry}; return retryTransientLoginRequest;`)((fn) => fn());
  let attempts = 0;
  const result = await run(async () => {
    attempts++;
    if (attempts === 1) throw new TypeError('Failed to fetch');
    return { user: 'signed-in' };
  });
  assert.deepEqual(result, { user: 'signed-in' });
  assert.equal(attempts, 2);
  attempts = 0;
  await assert.rejects(run(async () => { attempts++; throw new Error('Invalid login credentials'); }), /Invalid login credentials/);
  assert.equal(attempts, 1);
  assert.match(source, /credentialsAccepted = true;[\s\S]*?retryTransientLoginRequest\(async \(\) => \{[\s\S]*?auth\.setSession/);
  assert.match(source, /retryTransientLoginRequest\(\(\) => Ipon\.requiresMfaChallenge\(\)\)/);
  assert.match(source, /retryTransientLoginRequest\(\(\) => resolveActiveProfile\(data\.user, resolvedEmail\)\)/);
});

test('manual login returns its session without waiting for Clerk password synchronization', () => {
  const edge = fs.readFileSync('supabase/functions/manage-account/index.ts', 'utf8');
  assert.equal((edge.match(/EdgeRuntime\.waitUntil\(provisionClerkUser\(admin, authData\.user, password\)\.catch\(\(\) => false\)\)/g) || []).length, 2);
  assert.equal((edge.match(/await Promise\.resolve\(admin\.rpc\('clear_login_throttle'/g) || []).length, 2);
  assert.doesNotMatch(edge, /await admin\.rpc\('clear_login_throttle'[^;]*\.catch\(/);
  assert.doesNotMatch(edge, /await provisionClerkUser\(admin, authData\.user, password\)/);
  assert.match(source, /if \(existingSession\) \{\s*await Ipon\.client\.auth\.signOut\(\)/);
  assert.doesNotMatch(source, /syncClerkSession/);
});

test('sign-in validates identifiers live without recursive invalid events or shifting fields', () => {
  const core = fs.readFileSync('js/core.js', 'utf8');
  const html = fs.readFileSync('login.html', 'utf8');
  const validation = core.match(/function prepareFormValidation\(\)\s*\{[\s\S]*?document\.addEventListener\('invalid'/)?.[0];
  assert.ok(validation);
  assert.match(validation, /control\.validity\.valid \? '' : getValidationMessage\(control\)/);
  assert.doesNotMatch(validation, /control\.checkValidity\(\)/);
  assert.match(source, /email\.addEventListener\('input',[\s\S]*?validateEmailLive\(\)/);
  assert.match(source, /email\.addEventListener\('invalid', \(\) => validateEmailLive\(true\)\)/);
  assert.match(source, /email\.addEventListener\('blur',[\s\S]*?validateEmailLive\(true\)/);
  assert.match(html, /#email-error\[hidden\][^}]*visibility:hidden/);
  assert.match(html, /\.auth-message:empty\{visibility:hidden\}/);
});
