---
name: stable-input-ui
description: >-
  Enforce complete premium UI, UX, and reliability standards across the project:
  zero-layout-shift textboxes, live input validation, confirmation dialogs,
  responsive desktop/mobile layouts, empty/loading/error states, English-only
  copy, and zero-error verification. Use whenever creating or editing HTML,
  CSS, JS forms, tables, modals, notifications, media uploads, or interactive
  components.
---

# Premium, Stable, Zero-Error UI Guide

Follow every standard below when building or modifying any UI surface so components look cohesive and premium, feel responsive on every screen size, stay visually rock-solid while typing, and ship without console or test errors.

## 1. Zero-Layout-Shift Inputs & Tables
- **Anchored textboxes:** Inputs (`<input>`, `<select>`, `<textarea>`) must never shift horizontally or vertically while typing, validating, or clearing values.
- **Tables with inline inputs:** Use `table-layout: fixed; width: 100%;` with explicit percentage column widths on desktop (`@media (min-width: 961px)`), `vertical-align: top` on body `<td>` cells holding inputs, and fixed `max-width` / `box-sizing: border-box` on input wrappers.
- **Dynamic pills & numbers:** Always set `font-variant-numeric: tabular-nums` and cap dynamic badges/pills inside tables with `max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`.
- **Non-jumping error slots:** Inside tables/dense rows, reserve a compact 1-line height (`min-height: 14px; line-height: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`) and toggle `visibility: hidden` ↔ `.is-visible { visibility: visible; }` + `aria-hidden` instead of toggling `hidden` (`display: none`). Put full text in `title` on hover. On narrow stacked mobile cards (`<= 960px`), collapse inactive slots (`display: none`) while keeping input containers `width: 100%`.

## 2. Live Validation & Input Bounds
- Validate live (`input`, `blur`, `invalid`) using clear inline `.field-error`, `setCustomValidity()`, and `aria-invalid`—never wait only for form submit or fail silently.
- **Formal names:** Use `Ipon.validateNameInput`, `Ipon.prepareNameInputs`, and `Ipon.prepareInviteNameInput` (reject ALL CAPS, all lowercase, gibberish/digits).
- **Phone & numeric fields:** Use `Ipon.preparePhoneInputs` / `Ipon.prepareNumericInputs` for `09XXXXXXXXX` / `+639XXXXXXXXX` and digit-only fields.
- **Money & counts:** Bound every numeric/peso field with `min`, `max` (`999999999999.99` matching `numeric(14,2)` unless stricter), `step="0.01"`, `Ipon.guardMoneyInput()`, and `Ipon.parseMoneyAmount()` so `e`/`E`, signs, >2 decimals, or precision overflows are cleanly caught.
- Always enforce matching validation in backend Supabase RPCs / Edge Functions too.

## 3. Clean, Premium Visual Language
- Match the myIPON warm paper & forest emerald system (`#fffdf9`, `#0b3428`, subtle `rgba(20, 45, 43, .12)` borders, balanced spacing, pill badges, accessible contrast). Avoid clutter, redundant decorative bars, or jarring native browser popups.
- Keep **all user-facing copy English-only**, concise, and unambiguous (`contracts.test.mjs` enforces this).
- **Circular `X` close & remove buttons (fixed standard):** Every close/remove `X` icon button (`.dialog-close`, `.announcement-modal-close`, `.notification-sheet .dialog-close`, `.calendar-jump-close`, `.login-card-close`, `.account-avatar-remove`, `.bug-image-remove`, `.invite-row-remove`, `.record-thread-queued-remove`, `.calc-plan-remove`, `.day-detail-panel header button`) MUST be a true circle (`border-radius: 50%`, `aspect-ratio: 1 / 1`, `padding: 0`) with equal `width`, `height`, and `flex: 0 0 <size>` so it never stretches or squishes into an oblong oval.
- Scope contextual pills accurately (e.g., show group `ADMIN` badges strictly inside group contexts, never on global profile cards or reaction lists).
- Keep uploaded photos, receipts, avatars, and videos crisp and lossless with clean aspect-ratio previews and full-size viewer support.

## 4. Complete Interactive States (Fully Functional)
Every panel, list, table, and flow must handle all four states:
- **Empty state:** Render a styled `.empty-state` explaining what belongs there and any available next step—never a blank white box.
- **Loading & busy states:** Show `Ipon.setLoading()` for panels and `Ipon.setBusy(button, true, ...)` on submits/actions to prevent double clicks; always restore state inside `finally`.
- **Error recovery:** Use `Ipon.showInlineError(target, error, retryFn)` with `Ipon.friendlyError(error)` and a working Retry action; never mix stale totals with cleared panels.
- **Unread & live sync hygiene:** Clear unread badges/counts as soon as content is opened and read, and keep device/platform-specific features scoped properly (e.g., hide mobile phone-drawer alerts on PC browsers).

## 5. Confirmation Dialogs & Safe Actions
- Never use native `window.confirm()`, `window.alert()`, or `window.prompt()`.
- Route financial confirmations, voids/rejections, deletions, group ownership actions, and destructive flows through the accessible shared dialogs (`Ipon.confirmAction`, `Ipon.requestRecordAction`) with clear action details, reason inputs where required, Cancel/Back/Confirm buttons, and `Escape` handling.

## 6. Responsive Desktop & Mobile Architecture
- Guarantee **zero horizontal overflow** across desktop, tablet (`<= 960px`), and mobile (`<= 720px`) breakpoints.
- Ensure `<dialog>` sheets fit within `calc(100dvh - 32px)` with scrollable bodies, sticky headers, single-column mobile form fallbacks, and clean stacked mobile table rows.

## 7. Zero-Error Verification Checklist
1. Verify HTML IDs remain unique, `<dialog>` tags are balanced, and CSP rules are honored (no inline `on*` handlers).
2. Confirm any shared helper called as `Ipon.<fn>()` is exported on `window.Ipon` in `js/core.js`.
3. Add or update contract tests in `tests/contracts.test.mjs` covering new UI states, validation rules, and layout guards.
4. Run `npm test` after final edits and verify **100% pass, 0 failures, 0 skipped**.
