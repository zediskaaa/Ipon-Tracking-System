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
