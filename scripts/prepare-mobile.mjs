import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const targetDir = path.join(rootDir, 'www');

// Clean or create www directory
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

// Read existing version.json if available
let baseBuild = 19;
let nativeBuild = 19;
if (fs.existsSync(path.join(rootDir, 'version.json'))) {
  try {
    const existing = JSON.parse(fs.readFileSync(path.join(rootDir, 'version.json'), 'utf-8'));
    if (existing.build) baseBuild = parseInt(existing.build, 10);
    if (existing.nativeBuild) nativeBuild = parseInt(existing.nativeBuild, 10);
  } catch (_) { }
}

const runNumber = process.env.GITHUB_RUN_NUMBER ? parseInt(process.env.GITHUB_RUN_NUMBER, 10) : baseBuild;
const nowIso = new Date().toISOString();
const versionData = {
  version: `1.0.${runNumber}`,
  build: runNumber,
  nativeBuild,
  updated_at: nowIso,
  isApp: true
};

// Copy top-level HTML, manifest, and service worker files
const files = fs.readdirSync(rootDir);
for (const file of files) {
  if (file.endsWith('.html') || file === 'manifest.webmanifest' || file === 'sw.js') {
    fs.copyFileSync(path.join(rootDir, file), path.join(targetDir, file));
  }
}

// Copy directories: assets, css, js
const dirsToCopy = ['assets', 'css', 'js'];
for (const dir of dirsToCopy) {
  const src = path.join(rootDir, dir);
  const dest = path.join(targetDir, dir);
  if (fs.existsSync(src)) {
    fs.cpSync(src, dest, { recursive: true });
  }
}

// Write version.json files
fs.writeFileSync(path.join(rootDir, 'version.json'), JSON.stringify(versionData, null, 2), 'utf-8');
fs.writeFileSync(path.join(targetDir, 'version.json'), JSON.stringify(versionData, null, 2), 'utf-8');

// Write js/version.js
const versionJsContent = `window.MYIPON_APP_VERSION = ${JSON.stringify(versionData, null, 2)};\n`;
fs.writeFileSync(path.join(targetDir, 'js', 'version.js'), versionJsContent, 'utf-8');

function patchHtmlForMobileApp(html) {
  let patched = html;
  if (/<body[^>]*class="/i.test(patched)) {
    patched = patched.replace(/<body([^>]*)class="([^"]*)"/i, '<body$1class="$2 is-app">');
  } else {
    patched = patched.replace(/<body([^>]*)>/i, '<body$1 class="is-app">');
  }
  const versionScript = `<script>window.MYIPON_APP_VERSION = ${JSON.stringify(versionData)};</script>`;
  patched = patched.replace(/<body([^>]*)>/i, `<body$1>\n  ${versionScript}`);
  return patched;
}

// For mobile app standalone entry, index.html points straight to login screen with app mode enabled
const loginContent = fs.readFileSync(path.join(rootDir, 'login.html'), 'utf-8');
const appLoginContent = patchHtmlForMobileApp(loginContent);
fs.writeFileSync(path.join(targetDir, 'index.html'), appLoginContent, 'utf-8');
fs.writeFileSync(path.join(targetDir, 'login.html'), appLoginContent, 'utf-8');

// Patch all other html files in www (dashboard, etc.)
for (const file of files) {
  if (file.endsWith('.html') && file !== 'index.html' && file !== 'login.html') {
    const destPath = path.join(targetDir, file);
    if (fs.existsSync(destPath)) {
      const htmlContent = fs.readFileSync(destPath, 'utf-8');
      fs.writeFileSync(destPath, patchHtmlForMobileApp(htmlContent), 'utf-8');
    }
  }
}

// Create offline fallback page for live web loading mode
const offlineHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
  <title>Offline — myIPON</title>
  <link rel="icon" href="assets/favicon.svg" type="image/svg+xml">
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#0a1b17;color:#f5eee0;font-family:Arial,sans-serif;text-align:center}
    .card{max-width:360px;padding:28px 22px;border-radius:18px;background:#102922;border:1px solid rgba(245,238,224,.14);box-shadow:0 20px 50px rgba(0,0,0,.45)}
    h1{margin:12px 0 8px;font-size:22px}
    p{margin:0 0 20px;font-size:14px;line-height:1.5;color:rgba(245,238,224,.78)}
    a{display:inline-block;padding:12px 22px;border-radius:10px;background:#e4b95b;color:#0a1b17;font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <div class="card">
    <img src="assets/favicon.svg" alt="myIPON" width="48" height="48">
    <h1>You appear to be offline</h1>
    <p>Please check your internet connection so myIPON can load your latest records.</p>
    <a href="https://my-ipon.vercel.app/login.html?app=1">Try again</a>
  </div>
</body>
</html>
`;
fs.writeFileSync(path.join(targetDir, 'offline.html'), offlineHtml, 'utf-8');

console.log(`Mobile assets successfully prepared in ./www (Version 1.0.${runNumber}, Build #${runNumber})`);
