# Issue #37 — Forgot password / password reset

- **Slug:** `issue-37-password-reset`
- **Branch:** `feat/issue-37-password-reset`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); verification by a second agent
- **Status:** in review — implemented, awaiting review

## Goal

A signed-out user can request a password reset by email and complete it by
opening the verification link. It mirrors the old flow: enter the account email
and the wanted new password, receive a link, and the link applies the change.

## Why

The old app had `/api/auth/newpassword`, `/api/auth/verify/{playerId}` and a
"Forgot password" modal. The rewrite omitted them on purpose because it had no
mail service (the header of `packages/server/src/routes/auth.ts` says so). The
mailer now exists (issue #30, `Mailer` + Resend), so the feature can be ported.

## Scope

**In:**

- `PUT /api/auth/newpassword` with `{ email, newpassword }`, and
  `GET /api/auth/verify/{token}` — the old paths and method.
- The verification email (old subject and body) built on the existing `Mailer`.
- A signed-out "Forgot password" form on the login screen and the API method.
- Server tests for the happy path, an unknown email, an invalid token, an
  expired token and an idempotent replay.

**Out:**

- Changing the mail provider or its configuration; that is issue #30.
- A separate React route/page for the verification link. The old link pointed
  at the API and answered with an HTML page; it still does, so no SPA route is
  needed.
- Enforcing single-use server-side. The link is stateless and idempotent: a
  replay applies the same hashed password again, so it cannot set anything new
  (see "Deviations").
- Any `Repository` change. The design stores nothing, which also keeps this
  branch independent of the unmerged D1 branch (#72).

## Reference

- Java: `AuthResource.newPassword` / `verifyPassword`
  (`old-civ-rest/.../resource/AuthResource.java:147-171`) and
  `PlayerAction.newPassword(ForgotpassDTO)` / `verifyPassword`
  (`.../action/PlayerAction.java:619-653`).
- Mail: `SendEmail.sendMessage` (`.../email/SendEmail.java:62-80`) — subject
  "Please verify your email", body "Your password was requested to be changed.
  If you want to change your password then please press this link: <url>".
- Client: `old-civ-web/app/scripts/services/basicauth.js:74-94` `forgotpass`,
  `.../controllers/NavController.js:106-120` `openForgotPassword`, and the modal
  in `.../views/nav.html:195-236`.
- The old test: `AuthResourceTest.verifyPassword` (`.../AuthResourceTest.java:87-108`).

## Approach

### Signed reset token (`packages/server/src/auth.ts`)

The old link was `verify/{playerId}`, and a player id is public (game state, log,
highscore), so anyone who knew it could complete a reset. Instead the email
carries a token bound to the intended change:

- `ResetTokenSigner(secret, ttlMs = 1 hour)`, `sign({ playerId, passwordHash })`
  and `verify(token)`. The payload is base64url JSON plus an HMAC-SHA256
  signature over it, exactly like the existing `TokenSigner`.
- It uses a **key derived from `TOKEN_SECRET`** (`HMAC(TOKEN_SECRET,
  'password-reset')`), not the session key, so a reset link can never be replayed
  as a bearer token: the session verifier would otherwise accept any signed
  payload carrying `playerId` and `expiresAt`.
- The payload carries the **scrypt hash** of the new password, computed at
  request time, never the plaintext. The link expires after an hour.

### Endpoints (`packages/server/src/routes/auth.ts`)

- `PUT /api/auth/newpassword` `{ email, newpassword }`:
  - Validate both fields; email must look like an address, password at least 4
    characters (the same minimum as registration).
  - Look the account up by email, case-insensitively.
  - If found, hash the new password and email the link. **Always answer 200**,
    whether or not the address is registered, so the endpoint cannot be used to
    enumerate accounts.
- `GET /api/auth/verify/{token}`:
  - Verify the signature and expiry. On success, write the carried hash with
    `Repository.updatePlayerPassword` and answer the old HTML page ("Your
    password was correctly changed. Try to login again").
  - On an invalid or expired token, answer 404 with an HTML body.

### Mail (`packages/server/src/notifications.ts`)

A new `passwordReset(email, link)` on `Notifications`. Unlike the game mails it
does **not** check `disableEmail` and does **not** append the unsubscribe line:
a reset is transactional, and honouring "unsubscribe from ALL emails" would lock
the user out of their own account. The subject and body are the old ones.

### Client (`packages/web`)

`api.forgotPassword(email, newPassword)` and a third mode on `LoginView`
("Forgot password?") with the old two fields, a Send button and the
"Email verification is sent." confirmation. The verification page is server
HTML, matching the old client.

### Deviations from the old system (recorded in `decisions.md` and `README.md`)

1. The link is a signed, expiring token, not the guessable `playerId`.
2. The pending password is never stored in plaintext (the old wrote
   `Player.newPassword`); only its scrypt hash rides in the signed link.
3. An unknown email answers 200, not 404, so accounts cannot be enumerated.
4. The reset mail ignores `disableEmail` and carries no unsubscribe link.
5. Email lookup is case-insensitive; the password minimum is 4 characters.
6. The token is idempotent rather than single-use (see Scope).

## Claimed paths

- `packages/server/src/auth.ts`
- `packages/server/src/context.ts`
- `packages/server/src/app.ts`
- `packages/server/src/notifications.ts`
- `packages/server/src/routes/auth.ts`
- `packages/server/test/auth-password-reset.test.ts` (new)
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/LoginView.tsx`
- `packages/web/src/views/LoginView.test.tsx` (new)
- `docs/agents/tasks/issue-37-password-reset.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [x] `PUT /api/auth/newpassword` mails a link for a known email and answers
      200 for an unknown one, with no mail sent.
- [x] `GET /api/auth/verify/{token}` sets the password for a valid, unexpired
      token, and rejects a tampered or expired one with 404.
- [x] The new password logs in; the old one no longer does.
- [x] A reset link cannot be used as a bearer token.
- [x] The reset mail is sent even when the account has `disableEmail`, and has
      no unsubscribe line.
- [x] Server tests cover the happy path, unknown email, invalid token, expired
      token and replay.
- [x] The web test covers the forgot-password form calling the API.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

- None blocking. The owner approved the signed-token link and the two-step flow
  on 2026-09-20.
