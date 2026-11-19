import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const SKILL_DIR = path.join(ROOT, '.agents', 'skills', 'safe-large-file-edits');
const VERIFY_SCRIPT = path.join(SKILL_DIR, 'scripts', 'verify-integrity.mjs');
const PATCH_SCRIPT = path.join(SKILL_DIR, 'scripts', 'patch-large-file.mjs');

test('safe-large-file-edits skill and AGENTS.md guard are wired and repo passes integrity verification', () => {
  const skillMd = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
  const agentsMd = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');

  assert.match(skillMd, /^name:\s*safe-large-file-edits$/m);
  assert.match(skillMd, /patch-large-file\.mjs/);
  assert.match(skillMd, /verify-integrity\.mjs/);
  assert.match(agentsMd, /\.agents\/skills\/safe-large-file-edits\/SKILL\.md/);

  const output = execFileSync(process.execPath, [VERIFY_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8'
  });
  assert.match(output, /js\/core\.js:/);
  assert.match(output, /css\/app\.css:/);
  assert.match(output, /All source files passed large-file integrity verification\./);
});

test('patch-large-file.mjs preserves CRLF, replaces literally, blocks truncation markers, and rolls back syntax errors', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipon-large-patch-'));
  const sampleJs = path.join(tmpDir, 'sample.js');
  const runPatch = (spec) => execFileSync(process.execPath, [PATCH_SCRIPT], {
    cwd: ROOT,
    input: JSON.stringify(spec),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  try {
    // 1. Preserves CRLF and performs literal replacement (including $1 / $& safely)
    fs.writeFileSync(sampleJs, 'const a = 1;\r\nconst b = 2;\r\n', 'utf8');
    const okOut = runPatch({
      file: sampleJs,
      replacements: [{ target: 'const b = 2;', replacement: 'const b = "$1 $& ok";' }]
    });
    assert.match(okOut, /1 replacement\(s\) applied/);
    const afterOk = fs.readFileSync(sampleJs, 'utf8');
    assert.equal(afterOk, 'const a = 1;\r\nconst b = "$1 $& ok";\r\n');

    // 2. Rejects missing target without modifying file
    assert.throws(() => runPatch({
      file: sampleJs,
      replacements: [{ target: 'const missing = true;', replacement: 'const x = 1;' }]
    }), /target not found/i);

    // 3. Rejects ambiguous target unless allowMultiple is true
    fs.writeFileSync(sampleJs, 'const dup = 1;\nconst dup = 1;\n', 'utf8');
    assert.throws(() => runPatch({
      file: sampleJs,
      replacements: [{ target: 'const dup = 1;', replacement: 'const dup = 2;' }]
    }), /matched 2 times/i);

    // 4. Rejects writing truncation sentinel
    assert.throws(() => runPatch({
      file: sampleJs,
      replacements: [{ target: 'const dup = 1;', replacement: '... [truncated for diff preview]', allowMultiple: true }]
    }), /truncation sentinel/i);

    // 5. Rolls back on JS syntax error
    const beforeBroken = 'const ok = 42;\n';
    fs.writeFileSync(sampleJs, beforeBroken, 'utf8');
    assert.throws(() => runPatch({
      file: sampleJs,
      replacements: [{ target: 'const ok = 42;', replacement: 'const ok = (;' }]
    }), /rolled back/i);
    assert.equal(fs.readFileSync(sampleJs, 'utf8'), beforeBroken);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
