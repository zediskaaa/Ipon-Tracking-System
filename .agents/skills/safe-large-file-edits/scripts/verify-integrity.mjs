#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const TRUNCATION_LINE_RE = /^\s*\.\.\.\s*\[truncated for diff preview\]\s*$/im;
const LARGE_LINE_THRESHOLD = 5000;
const LARGE_BYTE_THRESHOLD = 250 * 1024;
const ALLOWED_EXTS = new Set(['.html', '.js', '.mjs', '.cjs', '.css', '.ts', '.sql']);
const SCAN_DIRS = ['js', 'css', 'tests', 'database', 'supabase/functions', 'supabase/migrations'];

function collectFiles() {
  const files = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === '.html' || entry.name === 'sw.js') {
      files.push(path.join(ROOT, entry.name));
    }
  }
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && ALLOWED_EXTS.has(path.extname(entry.name).toLowerCase())) {
        files.push(full);
      }
    }
  };
  for (const rel of SCAN_DIRS) {
    walk(path.join(ROOT, rel));
  }
  return files;
}

function checkCssBraceBalance(css) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inComment = false;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    const next = css[i + 1];
    if (inComment) {
      if (ch === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '\'') inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (ch === '\'') { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth < 0) return { ok: false, reason: 'unexpected closing "}"' };
    }
  }
  if (inComment) return { ok: false, reason: 'unclosed CSS comment' };
  if (inSingle || inDouble) return { ok: false, reason: 'unclosed CSS string' };
  if (depth !== 0) return { ok: false, reason: `unbalanced CSS braces (remaining depth ${depth})` };
  return { ok: true };
}

function getHeadLineCount(relPosix) {
  try {
    const out = execFileSync('git', ['show', `HEAD:${relPosix}`], {
      cwd: ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (TRUNCATION_LINE_RE.test(out)) return null;
    return out.split(/\r\n|\r|\n/).length;
  } catch {
    return null;
  }
}

function main() {
  const files = collectFiles();
  const failures = [];
  const largeSummary = [];

  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const stat = fs.statSync(abs);
    const text = fs.readFileSync(abs, 'utf8');
    const lines = text.split(/\r\n|\r|\n/).length;

    if (TRUNCATION_LINE_RE.test(text)) {
      failures.push(`${rel}: contains "... [truncated for diff preview]" marker (${lines} lines)`);
    }

    const isLarge = lines >= LARGE_LINE_THRESHOLD || stat.size >= LARGE_BYTE_THRESHOLD;
    if (isLarge) {
      largeSummary.push({ rel, lines, kb: (stat.size / 1024).toFixed(1) });
      const headLines = getHeadLineCount(rel);
      if (headLines && headLines >= LARGE_LINE_THRESHOLD && lines < Math.floor(headLines * 0.8)) {
        failures.push(`${rel}: dropped sharply vs HEAD (${headLines} -> ${lines} lines)`);
      }
      const ext = path.extname(abs).toLowerCase();
      if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
        try {
          execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
        } catch (err) {
          const msg = err?.stderr ? String(err.stderr).trim().split('\n')[0] : 'syntax check failed';
          failures.push(`${rel}: ${msg}`);
        }
      }
      if (ext === '.css') {
        const balance = checkCssBraceBalance(text);
        if (!balance.ok) {
          failures.push(`${rel}: ${balance.reason}`);
        }
      }
    }
  }

  largeSummary.sort((a, b) => b.lines - a.lines);
  console.log(`Scanned ${files.length} source files. Large Protected Files (>= ${LARGE_LINE_THRESHOLD} lines or >= ${LARGE_BYTE_THRESHOLD / 1024} KB):`);
  for (const item of largeSummary) {
    console.log(`  - ${item.rel}: ${item.lines} lines (${item.kb} KB)`);
  }

  if (failures.length > 0) {
    console.error('\nIntegrity check FAILED:');
    for (const f of failures) console.error(`  x ${f}`);
    process.exit(1);
  }
  console.log('All source files passed large-file integrity verification.');
}

main();
