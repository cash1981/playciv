# Assisted play: the shared action contract, with Chivalry

- **Slug:** `assisted-play-contract`
- **Branch:** `feat/assisted-play-contract`
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** draft
- **Issue:** [#260](https://github.com/cash1981/playciv/issues/260), children #261, #262, #266

## Goal

A player in City Management with Chivalry revealed and an incense token to
spend presses one button. The incense is spent and returns to the stock, the
player gains 5 culture, the log says so, and the same press from a retry,
refresh or second tab cannot do it twice. Any player can ask to undo it with
the vote the game already has. The way this action is built is the contract
the next assisted actions (Currency, Wheat, Silk, culture advance, building)
will use, so it is written once and reused rather than copied.

## Why

The human on the first slice: "Delt kontrakt først", one PR, and "behold de
samme undo regler som spillet har i dag ... spillet skal hjelpe deg med
handlinger og automatisere litt". So nothing the game does today is taken
away: chat, free-form orders, manual counters, the board's own undo and the
item-undo vote all stay. Assisted actions are added beside them.

On resources, the human: "Hvis de har incense via hut så brukes denne, ellers
så kan den som ligger i player area tilhørende spilleren. Da kan den brukes og
overføres tilbake til stock automatisk. Dette gjelder alle type ressurser."

## Scope

**In:**

- **Action registry in the engine.** One table of assisted actions, each with
  an `availability(state, playerId)` that returns `ready`, `used`,
  `needs-resource`, `wrong-phase`, `not-owned` or `unavailable`, plus a reason
  string, and an `apply`. The server route and both UI entry points use it, so
  availability is computed once.
- **Chivalry** as the first registered action: tech revealed, own City
  Management phase open (same predicate `purchaseCoin` uses), one resource
  token available. Effect: +5 culture (`stats.culture`).
- **Resource spending, for every resource kind, not only incense.** A generic
  `spendResource(state, playerId, resourceName)` finds the token to use, hut
  first, then the board piece:
  1. an unspent hut item of that name in the player's hand: the hut goes to
     `discardedItems` like `discardItem` does;
  2. otherwise a `resources/<name>` piece whose centre lies in the player's
     own area (`areaAt`, the same way `startMarkerOf` decides an owner): the
     piece is removed from the board, which is "back to stock" because supply
     is counted from pieces on the board.
  Neither found: `needs-resource`. The result says which one was used so undo
  can put exactly that one back.
- **Purchase actions on the same contract.** `purchaseCoin` (Democracy,
  Printing Press) is re-expressed as two registry entries. Its route,
  behaviour, error kinds and tests stay as they are; the route becomes a thin
  call into the registry.
- **Action identity and audit.** `GameState.assistedActions`: one record per
  applied action with `id` (the client's `requestId`), `kind`, `playerId`,
  `turnNumber`, `phase`, `usageKey`, `at`, `logId`, `status`
  (`applied` or `undone`) and `effect` (what was spent and gained, enough to
  reverse it). A second request with a `requestId` that is already recorded
  returns the current state unchanged (idempotent). A new `requestId` for an
  action that is out of uses fails with `ALREADY_USED`.
- **One server operation:** `POST /api/games/:gameId/actions` with
  `{ action, requestId, rev }`. `rev` goes to `applyToGame` as `clientRev`, so
  a stale tab gets the existing 409 instead of a double effect. The projection
  is returned like every other write.
- **Projection:** `PlayerView.you.availableActions` (own player only) and a
  public `assistedActions` list holding `kind`, actor, round, phase, status
  and the public summary. No hand contents, no hidden hut names beyond what the
  log line already shows.
- **Undo with the existing vote.** A log entry written by an assisted action
  carries `assistedActionId`. `initiateUndo` and `vote` accept it (today they
  need `entry.item`), keeping unanimity, "one no refuses" and the public
  request/vote lines. When the vote passes the reversal runs: culture and
  resource back, usage key removed, record `undone`, and a **new** log line
  says what was reversed. The original line stays. An undone action can be done
  again with a new `requestId`.
- **Web, two entry points, one component.** An `AssistedActionButton` (state
  from `availableActions`, disabled with the reason as visible text, a fresh
  `requestId` per press that is kept until the request settles) used in a small
  "Your actions" panel in the game page and in the tech detail dialog for the
  same tech. Undo on the log line uses the existing control.
- Tests at engine, server and web level, including the hidden-information
  test for the new projection fields.
- `decisions.md` entry, README "Known differences / deliberate improvements"
  line, `state.md`.

**Out, and why:**

- **Paid culture advance and its private reward.** The engine has no culture
  cost table, no tier or Great Person reward rule and no draw/keep logic
  (#248, #252 not landed). The rulebooks are not in this checkout and rule 2
  forbids guessing them. It is the next slice and uses this contract.
- **Layout work (#261):** full-width board, Your cards under it, shortcuts. The
  panel here sits where Draw sits now; moving it is #261.
- **Reopen phase and dependent corrections (#266 slice A and B).** Reopening
  needs its own permission rules. The contract keeps `phase` and `turnNumber`
  on every record so it can be added without migrating.
- **Build, offers (#264, #265)** and the other tech effects.
- **No change to the item-undo or board-undo rules.** Only the set of log
  entries the vote can target grows.

## Reference

- `packages/engine/src/actions/player.ts`: `purchaseCoin`, `usedActions`, the
  City Management predicate; `discardItem`.
- `packages/engine/src/actions/undo.ts`, `undo.ts`: the vote.
- `packages/engine/src/turn.ts`: `turnStatus`, `done` flags, `usedActions`.
- `packages/engine/src/board.ts`: `areaAt`, `playerAreas`, `boardAssetLimit`
  (resource supply is `min(5, players)`).
- `packages/web/src/views/techText.ts`: "Chivalry: Incense, City Management:
  gain 5 culture". Currency (3), the 7-culture tech and Wheat/Silk are not
  touched here.
- `decisions.md`: the 2026-09-30 undo privacy entries; the #253 purchase entry.
- No old-system counterpart: assisted actions are new.

## Approach

- `packages/engine/src/assisted.ts` (new): action definitions, availability,
  `performAssistedAction(state, input)`, `spendResource`, reversal. Pure; time
  arrives as `at`, no randomness.
- `state.ts`: `assistedActions` on `GameState` (default `[]`), `assistedActionId`
  on `GameLogEntry`, `PlayerView` fields. `migrate.ts` adds the empty list.
- `actions/undo.ts`: the target check is `entry.item !== null ||
  entry.assistedActionId !== undefined`; on acceptance an assisted entry runs
  its reversal instead of `putItemBack`.
- `actions/player.ts`: `purchaseCoin` delegates; error kinds unchanged.
- `server/src/routes/play.ts`: the new route; `errors.ts` maps new kinds.
- `web/src/lib/api.ts`: `performAction`. `web/src/views/AssistedActions.tsx`
  (new), `GameView.tsx`, `TechPanel.tsx`, `LogPanel.tsx` (undo target).

## Claimed paths

- `packages/engine/src/assisted.ts`, `state.ts`, `migrate.ts`, `index.ts`,
  `errors.ts`, `log.ts`, `actions/player.ts`, `actions/undo.ts`
- `packages/engine/test/assisted*.test.ts`
- `packages/server/src/routes/play.ts`, `errors.ts`, `packages/server/test/assisted*.test.ts`
- `packages/web/src/lib/api.ts`, `packages/web/src/views/AssistedActions.tsx`,
  `GameView.tsx`, `TechPanel.tsx`, `StatusPanel.tsx`, `LogPanel.tsx` and tests
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Acceptance criteria

- [ ] With Chivalry revealed, CM open and one incense in the player's area, the
      action succeeds once: +5 culture, the piece is gone from the board, one
      public log line, one `assistedActions` record.
- [ ] With an Incense hut in hand and a piece in the area, the hut is used and
      the piece stays. With only the piece, the piece goes. With neither:
      `needs-resource`, nothing changes.
- [ ] Same `requestId` twice, or two parallel requests: one effect. A second
      press with a new `requestId` uses the next token, or fails when none is left.
- [ ] A stale `rev` gives 409 and changes nothing.
- [ ] Wrong phase (CM done, SOT or Trade open), tech unrevealed, another
      player's tech: refused with a readable reason, no partial state.
- [ ] Democracy and Printing Press purchases behave exactly as before; their
      existing tests pass unchanged.
- [ ] Undo: request and votes are public and keep today's privacy; unanimous yes
      reverses culture and the exact resource that was spent (hut back in hand
      or piece back in place), frees the usage, writes a new line, keeps the
      old one; one no changes nothing. Undoing twice is refused.
- [ ] The Chivalry button works from the "Your actions" panel and from the tech
      dialog, shows the same state in both, and shows why when disabled.
- [ ] Item undo, board undo/redo, manual counters and chat orders are unchanged
      (their tests pass untouched).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: a spectator and another player receive no
      `availableActions`, no hut names and no resource identity beyond the
      public log line; test at engine and server level.
- [ ] Verified in the browser: a two-player game, Chivalry from both entry
      points, double-click, undo vote with the second player.

## Open questions

Answered by the human:

- Where the resource comes from: hut first, then the piece in the player's own
  area, back to stock automatically, for every resource kind.
- Ownership of a resource piece: the player area its centre lies in.
- Undo: the existing vote.

Still open, none blocks starting:

1. **Several incense at once.** Each token spent is one use of Chivalry (so two
   tokens, two uses), because the token is what limits it. If the rulebook caps
   Chivalry at one use per turn, the usage key becomes once per turn. The
   rulebooks are not in this checkout. Please confirm.
2. **A resource piece in two players' areas** cannot happen by centre, but a
   piece outside every area is ignored, never taken.
3. **Hut resources and the Hut tile name.** The hut names are `Incense`,
   `Iron`, `Silk`, `Wheat`, `Uranium`; matching is by name, case-insensitive.
