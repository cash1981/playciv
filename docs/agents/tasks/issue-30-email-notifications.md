# Email notifications (issue #30)

- **Slug:** `issue-30-email-notifications`
- **Branch:** `feat/issue-30-email-notifications`
- **Owner:** OpenCode (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The app sends transactional email again. The priority is **"It is your turn"** to
the next player when a turn ends; the rest of the old system's triggers follow
behind the same mailer. A player can unsubscribe, and unsubscribing actually
stops the mail.

## Why

Issue #30: the rewrite has no mailer, scheduler or notification code at all.
The old app used SendGrid; the owner has a Resend account and wants Resend.
Password reset (separate issue) depends on this. The owner asked for **all** the
old triggers, the 30-minute / 3-hour throttles, and the unsubscribe links.

## Scope

**In** — every trigger the old system sent, except the ones explicitly out of
scope:

- **It is your turn** — end-turn only, to the next player. (Java:
  `PlayerAction.endTurn` → `SendEmail.sendYourTurn`.)
- **New Civilization game created** — to all registered, opted-in players, 3 h
  global throttle. **Behind `MAIL_BROADCAST_NEW_GAMES`, off by default**
  (owner's decision: faithful, but the key can be turned on when ready).
- **Game update** (someone joined) — to the other players.
- **New Chat** — to the other players, 30 min per-player-in-game throttle.
- **Game ended** — to every player.
- **Game deleted** — to every player (creator or admin delete).
- **Turn-phase updated** (SOT / Trade / City management / Movement / Research) —
  to the other players, 30 min per-player-in-game throttle.
- `disableEmail` on the account, the stop/start HTML endpoints, and the
  unsubscribe link on every mail.

**Out** — and why:

- Password reset / verify mail — issue #30 says it is a separate issue.
- Admin mass mail (`sendMailToAll`) — `AdminAction` is deferred; no route exists.
- Player replacement mail — the rewrite has no replace-player feature.
- Tournament mail — tournaments are deferred.
- A settings UI toggle — the old app had none; unsubscribe is the emailed link.

## Reference

`old-civ-rest/src/main/java/no/asgari/civilization/server/`:

- `email/SendEmail.java` — subjects, bodies, from, unsubscribe text.
- `misc/CivUtil.java` — `shouldSendEmailInGame` (30 min) and `shouldSendEmail`
  (3 h); `timeToWait < |last - now|`.
- `action/PlayerAction.java:151-196` — `endTurn` → sendYourTurn (next player).
- `action/GameAction.java:174-184,216-227,426-436,465-498,568-588,614-636`.
- `action/TurnAction.java:33-139` — the five phase mails.

Exact strings are in this brief's triggers below and are pinned by tests.

## Approach

**The mailer is server infrastructure, never the engine.** The engine stays
pure; the server owns I/O and the clock.

- `packages/server/src/mail.ts` (new) — `Mailer` interface plus a Resend
  implementation calling `POST https://api.resend.com/emails` (the REST API the
  `resend` SDK wraps, so no new dependency). `noopMailer` when no key is set.
- `packages/server/src/notifications.ts` (new) — builds the six messages, looks
  up authoritative `StoredPlayer.email`, honours `disableEmail`, applies the
  two throttles, appends the unsubscribe link, and never throws.
- `Repository` gains `findEmailSentAt(scope)` / `saveEmailSentAt(scope, at)` for
  throttle state, in both the JSON and Mongo implementations. Scope keys:
  `mail:player:<id>` (global 3 h) and `mail:game:<gameId>:<playerId>` (30 min).
- `StoredPlayer` gains `disableEmail?`, and `PlayerUpdate` can set it. Mongo
  reads the legacy `disableEmail` already present on the old `player` documents.
- `AppContext` gains `notifications`. `applyToGame` gains an optional `after`
  hook (best-effort, never fails the write) for the turn/join/end triggers.
- `POST /api/games` and the delete and chat routes call the service directly.
- `routes/notifications.ts` (new) registers the unauthenticated
  `GET /api/admin/email/notification/:playerId/{stop,start}` HTML endpoints,
  same paths as Java.
- Config: `RESEND_API_KEY`, `MAIL_FROM` (default `noreply@playciv.app`),
  `APP_ORIGIN` (default `https://playciv.app`),
  `MAIL_BROADCAST_NEW_GAMES` (default off).

**Links.** `gamelink(id)` becomes `APP_ORIGIN + /game/<id>` (the new route, not
Java's `#/game/`). The unsubscribe link becomes
`APP_ORIGIN + /api/admin/email/notification/<playerId>/stop`.

**Deliberate differences from Java, recorded in `decisions.md` and
`README.md`:**

- The unsubscribe link is on **every** mail; Java's `sendYourTurn` had none.
- `disableEmail` is honoured for **all** notifications; Java checked it only for
  the new-game broadcast and the admin mass mail, so its "unsubscribe from ALL
  emails" link did not actually stop most mail.
- Small sends are awaited rather than run on a raw thread; the new-game
  broadcast stays fire-and-forget, like Java.
- Resend instead of SendGrid; `noreply@playciv.app` instead of
  `noreply@playciv.com`.

## Claimed paths

- `packages/server/src/mail.ts` (new)
- `packages/server/src/notifications.ts` (new)
- `packages/server/src/routes/notifications.ts` (new)
- `packages/server/src/context.ts`
- `packages/server/src/app.ts`
- `packages/server/src/lib.ts`
- `packages/server/src/index.ts`
- `packages/server/src/routes/auth.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/src/store/types.ts`
- `packages/server/src/store/json-file.ts`
- `packages/server/src/store/mongo.ts`
- `packages/server/test/notifications.test.ts` (new)
- `packages/server/.env.example`
- `render.yaml`
- `README.md` (the two difference sections only)
- `docs/agents/decisions.md` (append only)
- `docs/agents/state.md`
- `docs/agents/task-board.md` (own claim block only)

## Acceptance criteria

- [ ] Ending a turn emails the next player, subject `It is your turn`, body
      `It's your turn to play in <name>!\n\nGo to <APP_ORIGIN>/game/<id> to start your turn`.
- [ ] `taketurn` sends no mail (Java sent on end-turn only).
- [ ] Joining emails the other players, subject `Game update`; the joiner is not
      emailed.
- [ ] Chat emails the other players, subject `New Chat`, at most once per
      player per game per 30 minutes.
- [ ] Turn-phase updates email the other players with Java's five subjects,
      bodies and 30-minute throttle, and the actor is excluded.
- [ ] Ending a game emails every player, subject `Game ended`; deleting one
      emails every player, subject `Game deleted`.
- [ ] The new-game broadcast is off unless `MAIL_BROADCAST_NEW_GAMES` is on, then
      emails opted-in players at most once per 3 hours each.
- [ ] A player with `disableEmail` gets no notification, however triggered.
- [ ] The stop link sets `disableEmail`, the start link clears it, both return
      the old HTML, and both work without a token.
- [ ] Every outgoing mail carries the unsubscribe link.
- [ ] A missing or failing mailer never fails the game request.
- [ ] No `Date.now()`/`Math.random()`/I/O added to `packages/engine`.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

None outstanding — all four scope questions were answered by the owner.
