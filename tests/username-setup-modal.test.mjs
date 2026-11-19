import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('post-login username setup modal uses premium editorial masthead (no welcome badge pill), live preview card, counter, and light/dark polish', () => {
  const coreJs = read('js/core.js');
  const css = read('css/app.css');

  // Editorial masthead header (no badge pill or MYIPON IDENTITY kicker on Welcome)
  assert.match(coreJs, /class="username-setup-masthead"/);
  assert.match(coreJs, /class="username-setup-welcome"/);
  assert.doesNotMatch(coreJs, /username-setup-eyebrow|username-setup-kicker|MYIPON IDENTITY|class="pill"/);

  // Headline emphasis, live counter (0/24), live preview card, editorial note, and gold save CTA
  assert.match(coreJs, /Set up your <em>username<\/em>/);
  assert.match(coreJs, /id="ipon-username-setup-count">0<\/b>\/24/);
  assert.match(coreJs, /class="username-setup-preview/);
  assert.match(coreJs, /id="ipon-username-setup-preview-handle">@username<\/span>/);
  assert.match(coreJs, /class="username-setup-note/);
  assert.match(coreJs, /class="button button-primary username-setup-save"/);
  assert.match(coreJs, /describeValidationError/);

  // CSS styling covers gold hairline bar, clean welcome header, status pill, preview card, dark theme, reduced motion, and mobile layout
  assert.match(css, /\.username-setup-dialog::before\s*\{/);
  assert.match(css, /\.username-setup-masthead\s*\{/);
  assert.match(css, /\.username-setup-welcome\s*\{/);
  assert.doesNotMatch(css, /\.username-setup-kicker\s*\{/);
  assert.match(css, /\.username-setup-preview\s*\{/);
  assert.match(css, /\.username-setup-note::before\s*\{/);
  assert.match(css, /\.username-setup-actions \.button-primary\.username-setup-save\s*\{/);
  assert.match(css, /html\[data-theme="dark"\] \.username-setup-dialog\s*\{/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.username-setup-dialog/);
  assert.match(css, /@media\s*\(max-width:\s*440px\)[\s\S]*\.username-preview-tag\s*\{\s*display:\s*none;\s*\}/);
});
