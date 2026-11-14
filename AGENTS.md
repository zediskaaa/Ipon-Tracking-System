# Project UI/UX & Reliability Standards

Before designing, building, modifying, or reviewing any UI/UX surface (HTML, CSS, JS components, forms, tables, modals, notifications, media views, or design tokens) in this repository, you MUST activate and follow the workspace skills below:

1. **Always-required UI stability & reliability rules:** Read `.agents/skills/stable-input-ui/SKILL.md` and enforce every requirement:
   - Zero layout shift on textboxes and inline table inputs (`table-layout: fixed`, `vertical-align: top`, `tabular-nums`, non-collapsing reserved error lines, bounded badges).
   - Live input validation (`input`, `blur`, `invalid`) backed by matching server/RPC validation (formal names, strict phones/IDs, bounded currency up to `999999999999.99` via `Ipon.guardMoneyInput` / `Ipon.parseMoneyAmount`).
   - Clean, premium warm-paper and forest-emerald polish, English-only UI copy, properly scoped role badges, crisp lossless media previews, and mobile/desktop responsive layouts with zero horizontal overflow.
   - Complete interactive states on every panel/flow: styled `.empty-state`, loading/busy states (`Ipon.setLoading`, `Ipon.setBusy`), retryable inline error states (`Ipon.showInlineError`), live read-state badge updates, and accessible confirmation dialogs (`Ipon.confirmAction`, `Ipon.requestRecordAction` — never native `alert`/`confirm`/`prompt`).
2. **UI/UX Pro Max design intelligence:** Read `.agents/skills/ui-ux-pro-max/SKILL.md` (and sibling skills under `.agents/skills/` such as `ui-styling`, `design-system`, `design`, `brand`, `banner-design`, and `slides` when relevant).
   - When querying design/UX guidance via the CLI on Windows in this workspace, run `python .agents/skills/ui-ux-pro-max/scripts/search.py ...` (use `python`, not `python3`).
3. **Zero-error verification:** Confirm unique HTML IDs, balanced `<dialog>` tags, CSP compliance, `window.Ipon` exports, matching checks in `tests/contracts.test.mjs`, and pass `npm test` after final edits with zero failures.

