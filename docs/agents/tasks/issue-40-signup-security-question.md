# Issue #40 — Signup security question (anti-bot)

- **Slug:** `issue-40-signup-security-question`
- **Branch:** `feat/issue-40-signup-security-question`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** in progress

## Goal

A signed-out visitor cannot complete registration without answering the old fixed
security question. The register form asks **"What is China's starting tech?"** and
the server independently refuses to create the account unless the answer is
`writing` (case-insensitive). A bot that POSTs straight to
`/api/auth/register` without the answer is rejected.

## Why

Issue #40: "The old registration form had a simple security-question gate; the
rewrite has none." The old gate lived only in the AngularJS client, so a direct
API call skipped it. The human chose the old fixed question, enforced on **both
client and server** (2026-09-20), rather than a rotating question or a captcha.

## Scope

**In:**

- `POST /api/auth/register` requires `securityAnswer` and accepts only `writing`
  (case-insensitive). Anything else — missing, empty, wrong — is rejected with
  `400` and the old client's message.
- The register form on the login screen shows the question, binds the answer and
  refuses to submit a wrong one (the old client behaviour).
- Server tests for the gate and a web test for the form.

**Out:**

- A rotating question set or a captcha. The human chose the fixed question.
- Any change to login, password reset, the admin routes or the `Repository`.
- Server-side rate limiting or a challenge token; one fixed answer is the whole
  mechanism, exactly as the old client had it.

## Reference

- Old client gate: `old-civ-web/app/scripts/controllers/RegisterController.js:37-40`
  — `if(!$scope.securityQuestion || $scope.securityQuestion.toUpperCase() !== "WRITING") { growl.error('Wrong answer to the security question'); return; }`.
  Note it compares the **raw** value to `"WRITING"` with no trimming.
- Old form: `old-civ-web/app/views/nav.html:135-147` — label
  `Security Question: What is China's starting tech?` and
  `ng-pattern="/[wW][rR][iI][tT][iI][nN][gG]/"`. The controller's exact-match
  check is the stronger of the two and is the one to port.
- Old backend: `old-civ-rest/.../resource/AuthResource.java:100-120`
  (`register`) has **no** security check. Enforcing it server-side is new, so it
  is a deliberate improvement, recorded in `decisions.md` and `README.md`.

## Approach

### Server

- `packages/server/src/auth.ts`: export

  ```ts
  export function isSecurityAnswer(answer: unknown): boolean {
    return typeof answer === 'string' && answer.toUpperCase() === 'WRITING'
  }
  ```

  with a comment pointing at the old controller and noting the deliberate
  absence of trimming (`toUpperCase()` on the raw value, as the old code did).

- `packages/server/src/routes/auth.ts`: in the `/api/auth/register` handler,
  after the password-length check and **before** the duplicate-username check,
  add

  ```ts
  if (!isSecurityAnswer(body.securityAnswer)) {
    // Old client: growl.error('Wrong answer to the security question')
    return sendError(c, 400, 'WRONG_SECURITY_ANSWER', 'Wrong answer to the security question')
  }
  ```

- Update every existing registration payload in the server tests to include
  `securityAnswer: 'writing'`, or they will now fail with 400:
  - `packages/server/test/api.test.ts` — the `register` helper (~line 33) and the
    inline duplicate-username POST (~line 198).
  - `packages/server/test/admin-user.test.ts` — the `register` helper (~line 27).
  - `packages/server/test/board-api.test.ts` — the `register` helper (~line 30).
  - `packages/server/test/notifications.test.ts` — the `register` helper (~line 62).
  - `packages/server/test/auth-password-reset.test.ts` — the `register` helper (~line 41).

- New `packages/server/test/auth-register.test.ts`:
  - a correct answer (`writing`, and a mixed-case `Writing`) creates the account
    (201);
  - a wrong answer and a missing answer both give 400 with error
    `WRONG_SECURITY_ANSWER` and create no account.

### Client

- `packages/web/src/lib/api.ts`: `register(username, password, email,
  securityAnswer)` posts `{ username, password, email, securityAnswer }`.
- `packages/web/src/views/LoginView.tsx`: add `securityAnswer` state; render a
  register-only field labelled
  `Security Question: What is China's starting tech?`; in `submit`, for the
  register mode, if `securityAnswer.toUpperCase() !== 'WRITING'` then
  `setError('Wrong answer to the security question')` and return without calling
  the API; otherwise pass the answer to `api.register`. The `autoComplete` for
  the field stays off/irrelevant; do not add one.
- `packages/web/src/views/LoginView.test.tsx`: make the mocked `api.register`
  resolve a token/player, and add a register test — a wrong answer shows the
  error and does **not** call `api.register`; a correct answer does call
  `api.register` with the answer.

### Docs

- `docs/agents/decisions.md` (append at the bottom) and the "Deliberate
  improvements" section of `README.md`: the server now enforces the answer,
  where the old backend never saw it.

## Claimed paths

- `packages/server/src/auth.ts` (`isSecurityAnswer` only)
- `packages/server/src/routes/auth.ts` (the register handler only)
- `packages/server/test/auth-register.test.ts` (new)
- `packages/server/test/api.test.ts`
- `packages/server/test/admin-user.test.ts`
- `packages/server/test/board-api.test.ts`
- `packages/server/test/notifications.test.ts`
- `packages/server/test/auth-password-reset.test.ts`
- `packages/web/src/lib/api.ts` (`register` only)
- `packages/web/src/views/LoginView.tsx`
- `packages/web/src/views/LoginView.test.tsx`
- `docs/agents/tasks/issue-40-signup-security-question.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [ ] Registering with no `securityAnswer` gives 400 and creates no account.
- [ ] Registering with the wrong answer gives 400 and creates no account.
- [ ] `writing`, `Writing` and `WRITING` are all accepted.
- [ ] The login screen's register form shows the question and blocks a wrong
      answer before calling the API.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not applicable — no projection or game state changes.
- [ ] Verified in the browser: register with a wrong answer (error shown, no
      account) and with `writing` (account created, signed in).

## Open questions

None. The owner chose the fixed question enforced on both sides on 2026-09-20.
