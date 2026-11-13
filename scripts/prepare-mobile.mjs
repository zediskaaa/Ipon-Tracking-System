import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const targetDir = path.join(rootDir, 'www');

// Clean or create www directory
if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

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

// For mobile app standalone entry, index.html points straight to login screen with app mode enabled
const loginContent = fs.readFileSync(path.join(rootDir, 'login.html'), 'utf-8');
const appLoginContent = loginContent.replace(
  '<body>',
  '<body class="is-app">'
);
fs.writeFileSync(path.join(targetDir, 'index.html'), appLoginContent, 'utf-8');
fs.writeFileSync(path.join(targetDir, 'login.html'), appLoginContent, 'utf-8');

console.log('Mobile assets successfully prepared in ./www (App entry points directly to login screen)');

