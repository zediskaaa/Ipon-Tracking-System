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

console.log('Mobile assets successfully prepared in ./www');

