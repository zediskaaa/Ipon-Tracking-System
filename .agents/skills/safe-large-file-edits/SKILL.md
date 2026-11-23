---
name: safe-large-file-edits
description: >-
  Prevent IDE diff-preview truncation ("... [truncated for diff preview]") and accidental tail
  deletion when editing, verifying, or restoring large source files (>= 5,000 lines or >= 250 KB,
  such as js/core.js, css/app.css, tests/contracts.test.mjs, and
  database/schema.sql). Use before making any edit to a large file or recovering a truncated file.
---

# Safe Large-File Edits

Large files in this workspace exceed the IDE's diff-preview cap (~9,964 lines / ~450-500 KB). When an agent edits them with `edit_file` or `write_file`, the IDE opens a Review Changes diff buffer ending in `... [truncated for diff preview]`. If the user clicks Accept or saves that open tab, the truncated buffer overwrites the real file on disk and deletes thousands of lines.

## Protected Threshold & Known Large Files

Treat **any** source file with **`>= 5,000` lines or `>= 250 KB`** as a **Large Protected File**. Current files over this threshold:

- `database/schema.sql` (~35,500+ lines)
- `css/app.css` (~22,000+ lines)
- `js/core.js` (~16,700+ lines)
- `tests/contracts.test.mjs` (~12,400+ lines)

## Mandatory Rules

1. **Never use `edit_file` or `write_file` on a Large Protected File.**
   - Before editing a file whose size you are unsure of, check its line count first (`(Get-Content <file>).Count` or `wc -l`).
   - Writing through `run_command` bypasses the IDE's truncated Review Changes diff tab so the user cannot accidentally Accept a truncated preview.
2. **Apply edits via [patch-large-file.mjs](./scripts/patch-large-file.mjs) through `run_command`.**
   - Pass a JSON patch spec on stdin (or `--spec <tmp-json>`):
     ```powershell
     @'
     {
       "file": "js/core.js",
       "replacements": [
         {
           "target": "exact unique block to replace",
           "replacement": "exact replacement block"
         }
       ]
     }
     '@ | node .agents/skills/safe-large-file-edits/scripts/patch-large-file.mjs
     ```
   - The script automatically:
     - Matches line endings (`\r\n` vs `\n`) to preserve the file's original EOL.
     - Replaces literally (no regex `$1`/`$&` corruption) and aborts if a target matches `0` times or `> 1` time (unless `"allowMultiple": true`).
     - Refuses to write if the output contains `... [truncated for diff preview]`.
     - Blocks unexpected `> 25%` line drops on files `>= 5,000` lines (unless `"allowLargeDelete": true`).
     - Writes atomically and runs `node --check` on `.js`/`.mjs`/`.cjs` files, automatically rolling back on syntax error.
3. **Prefer modular files for new work when practical.**
   - Add new contract/runtime tests in a focused `tests/<feature>.test.mjs` instead of growing `tests/contracts.test.mjs`.
   - Keep large shared files clean and avoid unnecessary bloat.
4. **Always run [verify-integrity.mjs](./scripts/verify-integrity.mjs) after editing or restoring.**
   ```powershell
   node .agents/skills/safe-large-file-edits/scripts/verify-integrity.mjs
   ```
   Confirm exit code `0` and inspect the reported line counts before running `npm test` and `npm run mobile:sync`.
5. **Warn the user if a Large Protected File is currently open in their editor.**
   - If `Active Document` or `Other open documents` includes a Large Protected File you just patched, remind the user **not** to press `Ctrl+S` on a stale tab or Accept any diff preview showing `... [truncated for diff preview]` — close the tab (Don't Save) if prompted.

## Recovery Runbook (If a File Was Already Truncated)

1. Never restore a Large Protected File with `write_file`.
2. Locate the newest intact copy:
   - Check `www/<path>` first (`(Get-Content www/js/core.js).Count`, `node --check www/js/core.js`).
   - Otherwise check git history (`git log -n 5 --oneline -- <path>` and inspect `(git show <sha>:<path>).Count`).
3. Restore strictly via shell (`Copy-Item -Path www/<path> -Destination <path> -Force` or `git checkout <good-sha> -- <path>`).
4. Re-apply any missing post-commit edits using [patch-large-file.mjs](./scripts/patch-large-file.mjs).
5. Run [verify-integrity.mjs](./scripts/verify-integrity.mjs) and `npm test`, then tell the user to close any stale editor tab without saving before committing/amending.
