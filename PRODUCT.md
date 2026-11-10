# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML5, CSS3, and modular Vanilla JavaScript, using Supabase for PostgreSQL data and authentication, Chart.js for visualizations, and Vercel for static hosting. No frontend framework and no service-role key in browser code.

## Users

- Super Administrators manage administrator requests, administrator account status, savings-group ownership, and platform activity. They cannot access savings records.
- Administrators manage only their assigned group's members, contribution settings, approvals, goals, and reports.
- Users access only their own contribution status, submissions, history, and account settings.

## Product Purpose

IPON is a shared savings record and monitoring system. It records when money is reported as added, deducted, or spent; it does not hold, transfer, or function as a virtual wallet. Success means the group can quickly understand what happened on a given day or month, what is awaiting confirmation, and what the confirmed tracked savings total is.

## Positioning

The primary mechanism is a calendar-based activity record with human confirmation: each date shows additions, deductions, expenses, and pending reviews, while only administrator-confirmed entries affect the tracked total.

## Operating Context

Members or treasurers record an amount, date, and explanation. Their entries remain pending until an administrator confirms or rejects them. Administrator-created entries require an explicit UI confirmation and are stored as confirmed. Corrections are voided with a reason rather than silently deleted. Users review activity by day and month, similar to a calendar tracker rather than a banking ledger.

## Capabilities and Constraints

- Manual tracking only; the system never moves or stores actual money.
- Confirmed additions increase tracked savings; confirmed deductions and expenses decrease it.
- Contributions support multiple payments within a month and member-specific expected amounts.
- Required states are PENDING, CONFIRMED, REJECTED, and VOIDED.
- Rejections and voids require reasons and remain in the audit history.
- Supabase RLS and database functions are the authority for access, strict group isolation, and financial calculations.
- The frontend must be responsive, mobile-friendly, accessible, and usable without mock data or localStorage as its database.
- The interface language is English throughout, with concise and unambiguous financial labels.

## Evidence on Hand

- Confirmed product requirements and workflow are recorded in the conversation.
- The production database schema is in `database/schema.sql`.
- No logo, photography, testimonials, business claims, or production data have been supplied; future work must not fabricate them.

## Product Principles

1. Make the date and status of every record immediately understandable.
2. Never imply that IPON transfers or holds money.
3. Treat confirmation, correction, and audit history as core behavior, not secondary administration.
4. Prefer calm, familiar task flows over gamification or decorative finance tropes.
5. Keep totals traceable back to individual confirmed entries.

## Accessibility & Inclusion

The interface must support keyboard navigation, visible focus states, readable contrast, semantic controls, reduced motion, responsive layouts, and status communication that does not rely on color alone.
