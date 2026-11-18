import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (rel) => fs.readFileSync(rel, 'utf8');

test('Android MainActivity shows connecting state and slow/offline dialog instead of blank screen on weak internet', () => {
  const mainActivity = read('android/app/src/main/java/com/myipon/app/MainActivity.java');
  const prepareMobile = read('scripts/prepare-mobile.mjs');
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

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
});
