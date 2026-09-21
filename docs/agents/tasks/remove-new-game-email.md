# Never email every account when a game is created

- **Slug:** `remove-new-game-email`
- **Branch:** `feat/remove-new-game-email`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** draft

## Goal

Creating a game must never send email to anyone. Turn, join, chat, phase-update,
game-ended and game-deleted notifications stay exactly as they are; only the
new-game blast goes away.

## Why

The owner asked directly: "Kan du fikse implementasjonen slik at det aldri blir
sendt ut epost når det lages nye kamper. Det er helt greit at man får epost når
det er sin tur eller noe oppdatering skjer, men ikke når det blir nye kamper som
blir laget."

Today the blast already defaults off, but it is re-enabled by setting
`MAIL_BROADCAST_NEW_GAMES=true`. "Never" has to mean the code path is gone, not
merely dormant behind a flag an operator can flip by accident or habit.

## Reference

Java `GameAction.createNewGame` called `sendMailToAll(...)` ("A new game by the
name X was just created!"). Issue #30 ported it behind `MAIL_BROADCAST_NEW_GAMES`
(off by default); `docs/agents/decisions.md` (2026-09-19) records that gating.
The admin broadcast (issue #92, `sendMailToAll` from the admin page) is a separate,
manual action and is **not** affected.

## Scope

**In:**

- Delete the new-game notification: the `gameCreated` method on the
  `Notifications` service, its trigger in the create-game route, the
  `broadcastNewGames` config/option and the `MAIL_BROADCAST_NEW_GAMES`
  environment variable.
- Drop the now-unused `GLOBAL_COOLDOWN_MS` and `globalScope` helper (only the
  new-game blast used them), and `runInBackground` with its `BackgroundRunner`
  type (`packages/server/src/context.ts`), whose only production caller it was.
- Remove the new-game-broadcast tests and the environment-variable
  documentation (`.env.example`, `wrangler.jsonc` comment, `README.md`, the Node
  entry docblock), and add a route-level test proving create-game sends nothing.
- Record the retirement in `decisions.md` and `state.md`.

**Out:**

- The other five notification triggers, the 30-minute per-player-in-game
  cooldown, the unsubscribe links and `disableEmail` handling — untouched.
- The admin mass mail (`POST /api/admin/email/broadcast`) — untouched.
- The historical task brief `docs/agents/tasks/issue-30-email-notifications.md`
  — a record, not edited.

## Approach

Remove the method from the `Notifications` interface and its implementation in
`packages/server/src/notifications.ts`, plus its private helpers. Thread the
removal out through `app.ts` (`CreateAppOptions.broadcastNewGames`),
`packages/server/src/index.ts` and `packages/worker/src/index.ts` (Env field and
`buildApp`), and delete the `runInBackground(c, context.notifications.gameCreated(
stamped))` call (and the now-unused `runInBackground` import) in
`packages/server/src/routes/games.ts`. Delete `runInBackground` itself, since
nothing else calls it. Delete the `new-game broadcast` and `background tasks`
blocks in `packages/server/test/notifications.test.ts` and their now-unused
imports, and add a route-level test proving `POST /api/games` sends no mail.

## Claimed paths

- `packages/server/src/notifications.ts`
- `packages/server/src/app.ts`
- `packages/server/src/index.ts`
- `packages/server/src/context.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/test/notifications.test.ts`
- `packages/worker/src/index.ts`
- `packages/server/.env.example`
- `wrangler.jsonc`
- `README.md`
- `docs/agents/tasks/remove-new-game-email.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] No code path sends email from `POST /api/games`; creating a game with a
      mailer that records sends produces none (route-level test).
- [ ] `broadcastNewGames` / `MAIL_BROADCAST_NEW_GAMES` no longer exist in code
      or live configuration (historical docs and the issue #30 brief still name
      them, as records).
- [ ] The remaining notification triggers and their tests are unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not applicable — this removes a send, adds no field and
      touches no projection.

## Open questions

None. The owner's instruction is unambiguous: never send on game creation.
