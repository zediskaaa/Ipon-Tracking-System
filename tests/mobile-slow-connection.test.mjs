import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Android MainActivity shows connecting state and slow/offline dialog instead of blank screen on weak internet', async () => {
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const prepareMobile = read('scripts/prepare-mobile.mjs');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');
  const serviceWorker = read('sw.js');

  // Native overlay setup & cleanup in MainActivity.java
  assert.match(mainActivity, /setupStartupConnectionOverlay\(webView\)/);
  assert.match(mainActivity, /connectionMonitorHandler\.removeCallbacksAndMessages\(null\)/);
  assert.match(mainActivity, /"Connecting to myIPON"/);
  assert.match(mainActivity, /"Slow or unstable internet"/);
  assert.match(mainActivity, /"No internet connection"/);
  assert.match(mainActivity, /"Keep waiting"/);
  assert.match(mainActivity, /"Try again"/);
  assert.match(mainActivity, /reloadAfterConnectionIssue\(webView\)/);
  assert.match(mainActivity, /hasInternetConnection\(\)/);

  // Offline fallback copy explains offline & slow connection clearly
  assert.match(prepareMobile, /<h1>You appear to be offline<\/h1>/);
  assert.match(prepareMobile, /offline or too slow to reach myIPON/i);

  // In-app loader surfaces slow connection hint & Retry action
  assert.match(coreJs, /id="app-loader-slow-box"/);
  assert.match(coreJs, /id="app-loader-retry"/);
  assert.match(coreJs, /Your connection is slow right now\. Still waiting for a response/);
  assert.match(css, /\.loader-slow-box\s*\{/);
  assert.match(css, /\.loader-slow-hint\s*\{/);

  // Repeat visits use cached static assets, while navigations still check the network.
  assert.match(serviceWorker, /const isStaticAsset = \/\\\.\(\?:css\|js\|json/);
  assert.match(serviceWorker, /isStaticAsset \? caches\.match\(request\) : Promise\.resolve\(null\)/);
  assert.match(serviceWorker, /isHtmlRequest \? new Request\(request, \{ cache: 'no-store' \}\) : request/);

  const listeners = new Map();
  let fetchCalls = 0;
  const response = { ok: true, type: 'basic', clone() { return this; } };
  const context = {
    URL,
    Request: class { constructor(request) { Object.assign(this, request); } },
    Promise,
    fetch: async () => { fetchCalls += 1; return response; },
    caches: {
      match: async (request) => request.url.includes('/js/core.js') ? response : null,
      open: async () => ({ addAll: async () => { }, put: async () => { } }),
      keys: async () => [], delete: async () => true
    },
    self: {
      location: { hostname: 'my-ipon.vercel.app', protocol: 'https:', origin: 'https://my-ipon.vercel.app' },
      addEventListener(type, handler) { listeners.set(type, handler); }
    }
  };
  vm.runInNewContext(serviceWorker, context, { filename: 'sw.js' });
  const runFetch = async (url) => {
    let result;
    listeners.get('fetch')({ request: { method: 'GET', url }, respondWith(value) { result = value; } });
    await result;
  };
  await runFetch('https://my-ipon.vercel.app/js/core.js?v=1');
  assert.equal(fetchCalls, 0, 'cached static assets must not wait for the network');
  await runFetch('https://my-ipon.vercel.app/dashboard.html');
  assert.equal(fetchCalls, 1, 'HTML navigations must still check the network');
});
