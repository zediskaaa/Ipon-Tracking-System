# Project UI/UX & Reliability Standards

Before designing, building, modifying, or reviewing any UI/UX surface (HTML, CSS, JS components, forms, tables, modals, notifications, media views, or design tokens) in this repository, you MUST activate and follow the workspace skills below:

1. **Always-required UI stability & reliability rules:** Read `.agents/skills/stable-input-ui/SKILL.md` and enforce every requirement:
   - Zero layout shift on textboxes and inline table inputs (`table-layout: fixed`, `vertical-align: top`, `tabular-nums`, non-collapsing reserved error lines, bounded badges).
   - Live input validation (`input`, `blur`, `invalid`) backed by matching server/RPC validation (formal names, strict phones/IDs, bounded currency up to `999999999999.99` via `Ipon.guardMoneyInput` / `Ipon.parseMoneyAmount`).
   - Clean, premium warm-paper and forest-emerald polish, English-only UI copy, properly scoped role badges, crisp lossless media previews, and mobile/desktop responsive layouts with zero horizontal overflow.
   - **Opt-in Navigation Bar Style Preset:** Replicate the mobile navigation bar style (floating pill dock `border-radius: 26px`, `#FBF8F0` light / `#132820` dark with `rgba(242, 193, 78, .18)` gold border, `20px`-radius active emerald pill, and `#F2C14E` gold active icon/text) **ONLY when the user explicitly requests it** (e.g., *"parang sa navigation bar ang style"*). When not explicitly requested, do NOT use the navigation bar style on other components.
   - Complete interactive states on every panel/flow: styled `.empty-state`, loading/busy states (`Ipon.setLoading`, `Ipon.setBusy`), retryable inline error states (`Ipon.showInlineError`), live read-state badge updates, and accessible confirmation dialogs (`Ipon.confirmAction`, `Ipon.requestRecordAction` — never native `alert`/`confirm`/`prompt`).
2. **UI/UX Pro Max design intelligence:** Read `.agents/skills/ui-ux-pro-max/SKILL.md` (and sibling skills under `.agents/skills/` such as `ui-styling`, `design-system`, `design`, `brand`, `banner-design`, and `slides` when relevant).
   - When querying design/UX guidance via the CLI on Windows in this workspace, run `python .agents/skills/ui-ux-pro-max/scripts/search.py ...` (use `python`, not `python3`).
3. **Zero-error verification:** Confirm unique HTML IDs, balanced `<dialog>` tags, CSP compliance, `window.Ipon` exports, matching checks in `tests/contracts.test.mjs`, and pass `npm test` after final edits with zero failures.
4. **Large-file diff-truncation protection:** Before editing, verifying, or restoring any source file with `>= 5,000` lines or `>= 250 KB` (`database/schema.sql`, `css/app.css`, `js/core.js`, `tests/contracts.test.mjs`), you MUST read and follow `.agents/skills/safe-large-file-edits/SKILL.md`:
   - NEVER call `edit_file` or `write_file` on a Large Protected File (that opens a truncated IDE diff preview ending in `... [truncated for diff preview]` which overwrites and deletes the file tail if accepted/saved).
   - ALWAYS patch Large Protected Files through `run_command` using `node .agents/skills/safe-large-file-edits/scripts/patch-large-file.mjs`, and verify with `node .agents/skills/safe-large-file-edits/scripts/verify-integrity.mjs` before reporting completion.
5. **Always include Git Title & Description after changes:** Every time you make code, CSS, HTML, SQL, or configuration changes, always include a ready-to-copy **Git Title & Description** block at the end of your response without waiting to be asked. Keep it strictly specific to the current changes only (never include already-committed or past changes).


