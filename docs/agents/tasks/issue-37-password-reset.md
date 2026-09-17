# Issue #37 — Forgot password / password reset

- **Slug:** `issue-37-password-reset`
- **Branch:** `feat/issue-37-password-reset`
- **Owner:** Codex (GPT-5)
- **Status:** blocked

## Goal

A user can request a password reset by email and complete it through a
single-use verification link.

## Why

The old app had `/api/auth/newpassword`, `/api/auth/verify/{playerId}` and a
forgot-password modal. The rewrite deliberately omitted them because it has no
mail service.

## Scope

**In:**

- Add request-reset and verify-reset API behavior.
- Add the signed-out forgot-password UI and reset form.
- Store only a safe, expiring, single-use reset representation.

**Out:**

- Choosing or implementing the mail provider; that belongs to issue #30.
- Sending real mail before the provider and delivery configuration are settled.

## Reference

Use the old endpoints and `old-civ-web/app/views/nav.html` as behavioral
reference. The current auth route explicitly documents the missing mail flow.

## Approach

This branch is prepared but intentionally paused until issue #30 selects and
provides mailer infrastructure. Do not invent provider credentials or silently
implement an insecure reset-token delivery path.

## Claimed paths

- `packages/server/src/routes/auth.ts`
- `packages/server/src/store/`
- `packages/server/test/`
- `packages/web/src/App.tsx`
- `packages/web/src/views/PasswordResetView.tsx`
- `packages/web/src/lib/api.ts`
- `docs/agents/tasks/issue-37-password-reset.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] Mail provider and reset-token storage design are approved.
- [ ] Request and verify endpoints are authenticated against the correct user flow.
- [ ] Tokens expire, are single-use and are not logged or returned in ordinary responses.
- [ ] Server tests cover invalid, expired, reused and successful tokens.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

- [ ] Should issue #30 use SendGrid as in the old app, or another provider?
- [ ] Should reset requests reveal whether an email address exists?
