#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TRUNCATION_LINE_RE = /^\s*\.\.\.\s*\[truncated for diff preview\]\s*$/im;
const JS_EXTS = new Set(['.js', '.mjs', '.cjs']);

function readSpec() {
  const specIdx = process.argv.indexOf('--spec');
  if (specIdx !== -1) {
    const specPath = process.argv[specIdx + 1];
    if (!specPath) throw new Error('Missing path after --spec');
    return JSON.parse(fs.readFileSync(specPath, 'utf8'));
  }
  const positionalPath = process.argv[2];
  if (positionalPath && positionalPath !== '-' && !positionalPath.startsWith('-')) {
    return JSON.parse(fs.readFileSync(positionalPath, 'utf8'));
  }
  const raw = fs.readFileSync(0, 'utf8').trim();
  if (!raw) {
    throw new Error('Provide JSON spec via stdin or --spec <path>');
  }
  return JSON.parse(raw);
}

function detectEol(text) {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function toEol(text, eol) {
  return String(text).replace(/\r\n|\r|\n/g, eol);
}

function countLines(text) {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function main() {
  const spec = readSpec();
  if (!spec || typeof spec.file !== 'string' || !spec.file.trim()) {
    throw new Error('Spec requires a non-empty "file" string.');
  }
  const replacements = Array.isArray(spec.replacements) ? spec.replacements : (Array.isArray(spec.patches) ? spec.patches : null);
  if (!replacements || replacements.length === 0) {
    throw new Error('Spec requires a non-empty "replacements" array.');
  }

  const filePath = path.resolve(process.cwd(), spec.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Target file does not exist: ${spec.file}`);
  }

  const original = fs.readFileSync(filePath, 'utf8');
  if (TRUNCATION_LINE_RE.test(original)) {
    throw new Error(`Refusing to patch already-truncated file: ${spec.file}. Restore it first.`);
  }

  const eol = detectEol(original);
  const beforeLines = countLines(original);
  let next = original;
  let totalApplied = 0;

  replacements.forEach((item, idx) => {
    if (!item || typeof item.target !== 'string' || item.target.length === 0) {
      throw new Error(`Replacement #${idx + 1} requires a non-empty "target" string.`);
    }
    if (typeof item.replacement !== 'string') {
      throw new Error(`Replacement #${idx + 1} requires a string "replacement".`);
    }
    const target = toEol(item.target, eol);
    const replacement = toEol(item.replacement, eol);
    const parts = next.split(target);
    const occurrences = parts.length - 1;
    if (occurrences === 0) {
      throw new Error(`Replacement #${idx + 1} target not found in ${spec.file}.`);
    }
    if (occurrences > 1 && !item.allowMultiple) {
      throw new Error(`Replacement #${idx + 1} target matched ${occurrences} times in ${spec.file}; set allowMultiple: true or use a more specific target.`);
    }
    next = parts.join(replacement);
    totalApplied += occurrences;
  });

  if (TRUNCATION_LINE_RE.test(next)) {
    throw new Error(`Refusing to write truncation sentinel into ${spec.file}.`);
  }

  const afterLines = countLines(next);
  if (beforeLines >= 5000 && !spec.allowLargeDelete && afterLines < Math.floor(beforeLines * 0.75)) {
    throw new Error(`Blocked suspicious shrink on ${spec.file}: ${beforeLines} -> ${afterLines} lines. Set allowLargeDelete: true only if intentional.`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, path.extname(filePath));
  const tmpPath = path.join(path.dirname(filePath), `.${baseName}.patchtmp.${process.pid}${path.extname(filePath)}`);
  fs.writeFileSync(tmpPath, next, 'utf8');

  try {
    if (JS_EXTS.has(ext)) {
      execFileSync(process.execPath, ['--check', tmpPath], { stdio: 'pipe' });
    }
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore cleanup error */ }
    const detail = err?.stderr ? String(err.stderr).trim() : (err?.message || String(err));
    throw new Error(`Patch aborted and rolled back for ${spec.file}: ${detail}`);
  }

  const delta = afterLines - beforeLines;
  const sign = delta >= 0 ? `+${delta}` : String(delta);
  console.log(`Patched ${spec.file}: ${beforeLines} -> ${afterLines} lines (${sign}), ${totalApplied} replacement(s) applied.`);
}

try {
  main();
} catch (err) {
  console.error(err?.message || String(err));
  process.exit(1);
}
