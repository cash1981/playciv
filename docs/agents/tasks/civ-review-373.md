# Civ abilities: Copilot review of PR #373

- **Slug:** `civ-review-373` · **Branch:** `feat/civ-abilities-romans-chinese-spain` · **Owner:** orchestrator + three coders (Claude Sonnet 5.5) · **Status:** in progress

## Goal

Fix what the automated review of PR #373 (issue #368) found. Each item has a regression test. Three work packages that touch
different files; the orchestrator writes `decisions.md` and `limitations.md` at the end, so the coders leave the docs alone
and report the rationale in their final message.

Undo policy to keep in mind (see `decisions.md`, "Civilization abilities (#368)"): vote-based take-backs clamp. A
*unilateral* undo that can bring back a reward the player already spent would let one player farm it, so it is refused
(`BOARD_UNDO_TOKEN_CULTURE_SPENT` for the Chinese hut is the precedent: errors in `engine/src/errors.ts`, status in
`server/src/errors.ts`).

## Package A: battle and server (`arena.ts`, errors, server arena route, web battle panel)

1. **Aztec reward and End battle undo** (`undoEndBattle`, `actions/arena.ts`): the ender can undo alone, so when the Aztec
   gain (`ended.aztecs`) is no longer fully there (trade or culture of the Aztec player is below what was gained) refuse with a
   new error (409 on the server) and change nothing, instead of the clamped take-back. When the full gain is there it is taken
   back as now (amounts and new totals in the log). Replace the clamp tests with refusal tests and keep a full take-back test.
2. **Trade ceiling**: the Aztec win trade is clamped to the room left under `tradeCeilingOf(civ)` (`limits.ts`; 27 trade for most civs).
   Record the gain that really happened in `ended.aztecs.trade`, say it in the log (`gains 1 (27) trade ...`; nothing
   about trade when the room is 0), and make undo take back exactly that.
3. **Chinese save source card**: a killed Chinese unit whose card has left the hand (discarded, removed) before End battle
   cannot be saved: refuse the choice with `CHINESE_SAVE_INVALID`, and such a unit is not a candidate for
   `CHINESE_SAVE_PENDING` or for the "saves no unit" line. Find how an arena unit points to its source card (see
   `lockArenaUnitCard`). The web picker (`BattlePanel` in `GameView.tsx`) should offer only units that can be saved if the
   view has the data; otherwise leave it and let the server refuse with its message.
4. **Server route** (`server/src/routes/arena.ts`): a `chineseSave` that is present but not a non-empty string (number,
   `null`, empty string) is a 400 `BAD_REQUEST`, never "save none". Absent still means none. Test in `server/test/api.test.ts`.

## Package B: tech reveal abilities (`tech-reveal-abilities.ts`, `actions/player.ts` removeTech)

1. **Greek culture must not leak a hidden research choice**: count only what is public, the other players who have the tech
   *revealed* (`!tech.hidden`). A hidden choice does not count (the Greeks may get one more than the card says when the
   other player chose the same tech and has not revealed it). Update the comment and tests (the old test that a hidden
   choice counts becomes: it does not, and the result is the same whether the other player has a hidden choice or none).
2. **Remove and reveal again must not pay twice** (`undoTechRevealAbilities`, called by `removeTech`): when the take-back is
   not complete (culture spent so less than `effect.culture` could be taken, or a unit card could not be returned), keep a
   record `{ playerId, techName, culture: 0, units: [], paid: true }` (field already added to `TechRevealEffect` in
   `state.ts`). `applyTechRevealAbilities` does nothing, and says so in one public line, when a `paid` record exists for
   that player and tech; the record stays (it is not removed by a later removal). A complete take-back leaves no record, so
   the next reveal pays again. Tests: Greek with spent culture, German with a unit that left the hand, complete take-back.
3. **Battle lock on the returned unit**: a unit card returned to its deck must have `inBattle: false` (a free German unit
   that was placed in the arena before the tech was taken back). Test that a card returned with `inBattle: true` comes back
   clean and can be drawn and placed again.

## Package C: assisted actions, resources, markers, movement (`assisted.ts`, `assisted-cards.ts`, `assisted-resources.ts`, `assisted-city.ts`, `state.ts` cityCountOf, `city-founding.ts`, `migrate.ts`, `movement.ts`, `actions/player.ts` reveal)

1. **Seal the board Undo after reversals that write their own reverse moves** (`reverseAssistedAction`, `assisted.ts`
   around the `undoFloor` list): the Zulu city that explored huts (its undo moves the hut tokens back; the board Undo must
   not undo those moves while the cards stay in the deck) and the Roman free advance of a wonder or a city (the vote undo
   moves the marker back; the board Undo must not step into the forward move again, also when no replacement wonder was
   drawn). Check every effect whose reverse writes board moves of its own and seal it the same way (`redo: []`,
   `undoFloor: history.length`). Tests: after the vote undo the board Undo cannot walk past the reversal.
2. **Roman wonder take-back** (`takeBackOpenBuild`): dry-run `reverseAdvanceEffect` (and any other reversal that can
   refuse for a marker that left the area or missing reward cards) and return `undefined` on any refusal, so the board route
   removes the wonder as an ordinary piece. Test: the advance placed a Great Person marker that has left the player area.
3. **City markers are not cities**: `cityCountOf` (`state.ts`) and `ownCityPieces` (`city-founding.ts`) count only city pieces
   that are not lying in a player area (the walled capital and metropolis markers wait there until the player places them).
   Use `areaAt(playerAreas(...))` with the piece centre, as `locationOf` does. Check other users of both functions
   (combat bonus, city production, projection) still behave. Tests: a Chinese or Indian player with an ordinary capital and an
   unplaced marker can still found their second city and counts one city.
4. **Arab culture on a resource card played from the hand** (`playCard`, `assisted-cards.ts`, around "as ${resource}"): when
   the played card has a `resource` and the player is Arabs, apply the same `ARAB_RESOURCE_CULTURE` (reuse the code in
   `assisted-resources.ts`; export a small helper rather than copy it), log it with the new total, store the amount on the
   play's effect record, and take it back (clamped, as `returnResource` does) when that play is undone. Test play, log
   and undo; a non-Arab gets nothing.
5. **Spanish movement in existing saves** (`migrate.ts`): a Spanish player whose civilization was revealed before the
   reveal set `2+1` and whose `stats.mvmt` is still the default `2` (and whose `civSetup` has no `mvmt` entry yet) gets
   `2+1` once: set the stat and record `civSetup.mvmt = { before: '2', set: '2+1' }` so the migration does not run again and
   undoing the reveal restores `2`. Never touch another value (`3`, `2+1`, `3+1`, a typed adjustment) and never touch other
   civilizations. Reuse the constants of `actions/player.ts` (`SPANISH_MVMT`, `DEFAULT_PLAYER_STATS`). If a Spanish player has
   no `civSetup` at all, set only the stat. Tests in `migrate`'s test file or `movement.test.ts`.

## Scope

In: the items above with tests. Out: new abilities, UI changes beyond the picker filter, the setup phase.

## Rules for the coders

- Work only in `/Users/shervin.asgari/privat/git/civ-review-373` (a worktree). Other coders edit other files in the same
  worktree at the same moment: touch only your package's files; if typecheck or a test fails in a file you did not touch,
  wait a minute and run again, never fix another package's file.
- Do not commit, push or touch `docs/`. Report in your final message: what changed, the test names, and the one-line
  rationale for each decision.
- English in code, comments and tests. Follow `docs/agents/conventions.md`. Log lines state amount and new total in
  parentheses.

## Acceptance criteria

- [ ] Each item has a regression test
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass (orchestrator runs the full set at the end)
- [ ] No hidden information in new projections
- [ ] Browser check: not available; disclose
