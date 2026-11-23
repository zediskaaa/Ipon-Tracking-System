import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const html = fs.readFileSync('index.html', 'utf8');
const source = fs.readFileSync('js/index.js', 'utf8');
const sessionCheck = source.slice(source.indexOf('  let hasStoredSession = false;'), source.lastIndexOf('})();'));

async function runSessionCheck(localStorage) {
  const scripts = [];
  const redirects = [];
  const warnings = [];
  const context = {
    localStorage,
    document: {
      createElement: () => ({}),
      body: { append(script) { scripts.push(script); script.onload(); } }
    },
    Ipon: {
      init: async () => ({ session: {}, profile: { role: 'MEMBER', status: 'ACTIVE' } }),
      homeForRole: () => 'dashboard.html'
    },
    location: { replace: (url) => redirects.push(url) },
    console: { warn: (...args) => warnings.push(args) }
  };
  await vm.runInNewContext(`(async () => {${sessionCheck}})()`, context);
  return { scripts, redirects, warnings };
}

test('logged-out landing page does not load application or auth bundles', async () => {
  assert.doesNotMatch(html, /<script[^>]+src="(?:js\/(?:core|policy)\.js|https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase)/);
  const result = await runSessionCheck({});
  assert.equal(result.scripts.length, 0);
  assert.equal(result.redirects.length, 0);
  assert.equal(result.warnings.length, 0);
});

test('returning-user session check loads its dependencies and retains the redirect', async () => {
  const result = await runSessionCheck({ 'sb-project-auth-token': '{}' });
  assert.deepEqual(result.scripts.map((script) => script.src), [
    'js/core.js?v=20261124-01',
    'js/policy.js?v=20261123-02',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/dist/umd/supabase.min.js'
  ]);
  assert.equal(result.scripts[2].crossOrigin, 'anonymous');
  assert.match(result.scripts[2].integrity, /^sha384-/);
  assert.deepEqual(result.redirects, ['dashboard.html']);
  assert.equal(result.warnings.length, 0);
});
