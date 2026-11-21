import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(file, 'utf8');

test('CI release workflow, native Android updater, and CSS overlay are wired end-to-end', () => {
  const workflow = read('.github/workflows/build-mobile.yml');
  const plugin = read('android/app/src/main/java/com/myipon/app/BackgroundNotificationsPlugin.java');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const filePaths = read('android/app/src/main/res/xml/file_paths.xml');
  const css = read('css/app.css');

  assert.match(workflow, /Generate Android update manifest/);
  assert.match(workflow, /app-update\.json/);
  assert.match(workflow, /versionCode:\s*runNumber/);

  assert.match(manifest, /android\.permission\.REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest, /androidx\.core\.content\.FileProvider/);
  assert.match(filePaths, /<cache-path /);

  assert.match(plugin, /public void checkNativeAppUpdate\(PluginCall call\)/);
  assert.match(plugin, /public void downloadAndInstallAppUpdate\(PluginCall call\)/);
  assert.match(plugin, /public void closeAppForUpdate\(PluginCall call\)/);
  assert.match(plugin, /canRequestPackageInstalls\(\)/);
  assert.match(plugin, /ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(plugin, /getPackageArchiveInfo\(apkFile\.getAbsolutePath\(\), 0\)/);
  assert.match(plugin, /FileProvider\.getUriForFile\(ctx, ctx\.getPackageName\(\) \+ "\.fileprovider", apkFile\)/);
  assert.match(plugin, /application\/vnd\.android\.package-archive/);
  assert.match(plugin, /activity\.finishAffinity\(\)/);
  assert.match(plugin, /notifyListeners\("appUpdateProgress", payload\)/);

  assert.match(css, /\.app-updating-overlay\s*\{/);
  assert.match(css, /\.app-updating-spinner\s*\{/);
  assert.match(css, /\.app-updating-bar-fill\s*\{/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.app-updating-spinner/);
});

test('Android app auto-update shows loading indicator, streams download progress, handles install permission, and closes for install', async () => {
  const core = read('js/core.js');
  const elements = new Map();
  let progressHandler = null;
  let installCalls = [];
  let nextDownloadResult = { status: 'installing', closing: true };

  const makeEl = (id = '') => {
    const cls = new Set();
    const children = new Map();
    const el = {
      id,
      className: '',
      hidden: false,
      textContent: '',
      _html: '',
      onclick: null,
      style: {},
      dataset: {},
      classList: {
        add: (...c) => c.forEach((x) => cls.add(x)),
        remove: (...c) => c.forEach((x) => cls.delete(x)),
        toggle: (c, f) => (f === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : (f ? cls.add(c) : cls.delete(c))),
        contains: (c) => cls.has(c)
      },
      setAttribute() { },
      removeAttribute() { },
      addEventListener() { },
      appendChild(child) { if (child?.id) elements.set(child.id, child); },
      insertAdjacentHTML() { },
      querySelector(sel) {
        const cleanId = sel.startsWith('#') ? sel.slice(1) : sel;
        if (!children.has(cleanId)) children.set(cleanId, makeEl(cleanId));
        return children.get(cleanId);
      },
      querySelectorAll: () => [],
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = String(v); }
    };
    if (id) elements.set(id, el);
    return el;
  };

  const sessionStore = new Map();
  const winStub = {
    IPON_CONFIG: { supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'anon' },
    Capacitor: {
      getPlatform: () => 'android',
      isNativePlatform: () => true,
      Plugins: {
        BackgroundNotifications: {
          addListener: (name, fn) => { if (name === 'appUpdateProgress') progressHandler = fn; },
          checkNativeAppUpdate: async () => ({
            supported: true,
            updateAvailable: true,
            installedVersionCode: 100,
            remoteVersionCode: 105,
            remoteVersionName: '1.0.105',
            apkUrl: 'https://github.com/zediskaaa/Ipon-Tracking-System/releases/latest/download/myIPON.apk'
          }),
          downloadAndInstallAppUpdate: async (opts) => {
            installCalls.push(opts);
            if (progressHandler && nextDownloadResult.status === 'installing') {
              progressHandler({ phase: 'downloading', progress: 54 });
              progressHandler({ phase: 'installing', progress: 100 });
            }
            return nextDownloadResult;
          }
        }
      }
    },
    location: { origin: 'https://my-ipon.vercel.app', protocol: 'https:', hostname: 'my-ipon.vercel.app', pathname: '/dashboard.html', search: '?app=1', hash: '', href: 'https://my-ipon.vercel.app/dashboard.html?app=1', reload() { } },
    addEventListener: () => { },
    removeEventListener: () => { },
    matchMedia: () => ({ matches: false, addEventListener: () => { } })
  };
  winStub.window = winStub;

  const docStub = {
    documentElement: makeEl('html'),
    body: makeEl('body'),
    head: makeEl('head'),
    visibilityState: 'visible',
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => elements.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => { }
  };

  vm.runInNewContext(core, {
    window: winStub,
    document: docStub,
    location: winStub.location,
    navigator: { userAgent: 'Mozilla/5.0 Android myIPONApp/20', onLine: true },
    localStorage: { getItem: () => null, setItem: () => { }, removeItem: () => { } },
    sessionStorage: {
      getItem: (k) => (sessionStore.has(k) ? sessionStore.get(k) : null),
      setItem: (k, v) => sessionStore.set(k, String(v)),
      removeItem: (k) => sessionStore.delete(k)
    },
    URL,
    URLSearchParams,
    Map,
    Set,
    CustomEvent: class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } },
    setTimeout: () => 1,
    clearTimeout: () => { },
    setInterval: () => 0,
    clearInterval: () => { }
  });

  // 1. Happy path: detects newer build, displays updating overlay, downloads, closes for install
  const res = await winStub.Ipon.runNativeAppAutoUpdate({ force: false });
  assert.equal(res.status, 'installing');
  assert.equal(installCalls.length, 1);
  assert.equal(installCalls[0].closeAfterPrompt, true);
  const overlay = elements.get('app-updating-overlay');
  assert.ok(overlay, 'updating overlay must be mounted');
  assert.equal(overlay.hidden, false);
  assert.match(overlay.querySelector('#app-updating-status').textContent, /Opening installer & closing app/);
  assert.equal(overlay.querySelector('#app-updating-bar-fill').style.width, '100%');

  // 2. Permission required path: keeps pending URL and exposes Continue update action
  nextDownloadResult = { status: 'permission_required', canRequestPackageInstalls: false };
  const permRes = await winStub.Ipon.runNativeAppAutoUpdate({ force: true });
  assert.equal(permRes.status, 'permission_required');
  assert.ok(sessionStore.get('myipon_pending_native_update_url'));
  assert.equal(overlay.querySelector('#app-updating-actions').hidden, false);
  assert.match(overlay.querySelector('#app-updating-status').textContent, /Install unknown apps/);

  // 3. Browser environment skips native updater cleanly
  winStub.Capacitor = undefined;
  const webRes = await winStub.Ipon.runNativeAppAutoUpdate({ force: false });
  assert.equal(webRes.status, 'skipped');
});
