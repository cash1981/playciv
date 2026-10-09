# Assisted play: the shared action contract, with Chivalry

- **Slug:** `assisted-play-contract`
- **Branch:** `feat/assisted-play-contract`
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in progress
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
      press with a new `requestId` in the same turn is refused (`ALREADY_USED`) and spends
      nothing, because every card is once per turn.
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
- Use limit: "Alle kort kan kun brukes en gang per tur bortsett fra healing som
  vi ikke har støtte for nå." One use per card per turn.
- The culture ladder (recorded for the next slice, not built here): steps 1-2
  Level 1 culture event, 3 Great Person, 4-6 Level 1, 7 Great Person, 8-11
  Level 2, 12 Great Person, 13-14 Level 2, 15-17 Level 3, 18 Great Person, 19-21
  Level 3 where step 21, the Culture Victory panel, wins the game. Matches
  `CULTURE_VICTORY_STEP = 21`. The cost per step and the draw/keep modifiers are
  still unknown.

Still open, none blocks starting:

1. ~~Several incense at once.~~ Answered: every card can be used once per turn
   (healing excepted, not supported). The usage key is `card:<tech>` per turn, so
   one incense is spent per turn however many the player holds.
2. **A resource piece in two players' areas** cannot happen by centre, but a
   piece outside every area is ignored, never taken.
3. **Hut resources and the Hut tile name.** The hut names are `Incense`,
   `Iron`, `Silk`, `Wheat`, `Uranium`; matching is by name, case-insensitive.


## Part 2b: the culture advance

The human's rules (2026-10-09), recorded here because this is what the reviewer
checks against:

- The marker is already on the board and its step is known
  (`cultureMarkerLevelOf`, 0 is Start, 1 to 21, 21 is the Culture Victory panel).
  The button moves it one step, to the space after the one it is on.
- The track is three sections of seven spaces: steps 1 to 7 are level 1, 8 to 14
  level 2, 15 to 21 level 3. Four of the 21 are Great Person spaces (3, 7, 12,
  18); every other space is a culture event of the section's level.
- Cost, by the level of the space moved to (a Great Person space costs what its
  section costs): level 1 is 3 culture; level 2 is 5 culture and 3 trade; level 3
  is 7 culture and 6 trade. Endowment for the Arts (`stats.efta` is the number of
  investments): 2 or more investments take 1 off the culture cost, 4 or more take
  2 off, at every level, never below 0. Ecology (printed in `techText.ts`: 1 less
  trade for every 3 coins you possess, `totalCoins`) takes trade off, never below 0.
  The Ecology line comes from the printed card text, not from the human: say so in
  `decisions.md`.
- Reward by destination, never chosen by the player. Culture event space: draw from
  the deck of that level (`CULTURE_1`, `CULTURE_2`, `CULTURE_3`), 1 card plus 1 extra
  with Mysticism revealed, keep one, discard the rest. Great Person space: draw
  Great Person cards the way the existing Draw button does (`draw` takes the first of
  the sheet and reshuffles the discards when the deck is empty), 1 card plus 1 extra
  for Organized Religion (a revealed social policy) plus 1 extra for the Greeks
  civilization; they stack; keep one, discard the rest. The Great Person token and
  reserve handling is #252 and is not built: the kept card goes to the hand like a
  normal draw, and the UI says the token step is still manual.
- The advance can be repeated in a turn (it is not once per turn); each press needs
  its own requestId. A new advance is refused while a reward choice is pending.
- Step 21 draws a level 3 culture card like any other event space. Reaching it
  writes a public line saying the player has reached the Culture Victory space. It
  does not end the game and does not set a winner: the human says the round can be
  finished and someone may still win on points; the existing End game stays the way
  to end the game.
- Phase: City Management, like the other culture spending. This is an assumption the
  human has not confirmed; say so in `decisions.md`.
- Every drawn candidate is private. The choice is stored, so a refresh resumes it
  and never draws again.
- Undo is the existing vote on the advance's one public line. A passed vote moves the
  marker back, gives back culture and trade, and puts the cards back: the kept card
  from the hand and the discarded candidates from the discard pile go to the deck,
  which is shuffled the way an item undo does today. If a kept card has left the
  hand (traded, discarded), the reversal fails the way a missing hut does and the
  vote stays open.
- Out: map tile 16a (human: later), free advances (Arabs, Romans), hand limit
  enforcement (show nothing, enforce nothing), Great Person tokens (#252).
