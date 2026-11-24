# Setup phase for start-of-game civilization effects (#374)

- **Slug:** `setup-374` · **Branch:** `feat/civ-abilities-romans-chinese-spain` (human's choice, it holds #368) · **Owner:** orchestrator · **Status:** in progress

## Goal

A one-time **setup per player** that guides the player through what must be done before turn 1, in any order the player
likes. The human's words (issue #374, with the answers in the issue):

> Du må velge capital / metropolis plassering. Du må velge en army figur og en scout som skal plasseres i outskirts
> (Russland har en ekstra army figur, Spania en ekstra scout). Du velger social policy. America får great person.
> Du teller trade rundt byen og får dette i setup. Du velger governmenten (forced by the civ).

Setup is a **Setup tab first in "Your actions"** until the player is done. It is not a `TurnPhase` (`TURN_PHASES` drives
`turnStatus`) and not part of Start of Turn.

## Scope

**In (the steps):**

1. **Capital.** Pick one of the **four central squares** of the player's starting tile (not water, no other city on it).
   Chinese get `capitalwalled2`, Indians `metropolis2`, others `capital2` (asset `cities/<colour><suffix>`). Indians' metropolis
   covers two squares, follow how Agriculture grows a capital (`metropolis.ts`: `growableCapital`, `metropolisAssetIdOf`),
   restricted to the central squares. The player may **move the capital to another central square** until setup is over;
   moving resets the steps that depend on it (trade count undone, figures and Egypt's wonder lifted back to the area).
   If a civ marker for that colour already sits in the player's area (a game revealed before this change), reuse that piece
   instead of creating a second one.
2. **Figures.** One colour **army** and one colour **scout**, placed on a legal square in the capital's **outskirts**.
   Russians also place their **white army**, Spanish their **white scout** (both are already in the player's area from the
   reveal, `placeWhiteFigure`: move that piece with `movePieceUnchecked`; the colour figures are created with the supply
   limit from `remainingBoardAssetCount`). Legal square: on the map, not water, no city, within `stackingLimitOf`, no foreign
   figure for a scout (template: `metropolisFigureTargets` in `metropolis.ts`). One figure per action.
3. **Social policy.** The existing `chooseSocialPolicy` (flipside rule unchanged). Done when the player has at least one.
   **No French extra policy and no cap: that is #378.**
4. **Great person (Americans only).** A random draw like Philosophy (`assisted-tech-abilities.ts` Philosophy: `rewardDrawCount`
   then `gainGreatPerson`, effect with `drawn/rejected/kept/marker`): the card stays in the hand, the player gets the great person
   marker in their area (`takeGreatPersonMarker`) and places it by hand. With a revealed Organized Religion two are drawn, one is
   kept through the existing `chooseReward`, the other is discarded **public**. Extend `takesMarker` and `withKeptCard` in
   `assisted-culture.ts` for the new effect kind, register it in `isAssistedBoardChange` and the undo floor list. Implement it as
   an assisted action `setupGreatPerson` (`phase: 'ANY'`, not tied to Start of Turn), so undo is the normal vote (a solo undo of
   a random draw would allow re-rolling). **Requires the player's policy to be revealed first** (`rewardDrawCount` counts only a
   revealed policy and a public draw count must not leak a hidden policy): blocked with that reason until revealed.
5. **Starting trade.** Count the trade icons in the capital's outskirts the way the Trade phase does (`tradeAroundCitiesOf` in
   `trade-collection.ts`, capped by `tradeCeilingOf`) and add it to `stats.trade`, recording the amount so a solo undo takes
   back exactly it (floor 0). It does **not** touch turn 1's `tradeCollected`: the normal Trade collection in turn 1 still adds
   more (human). Needs the capital.
6. **Government.** Forced by the civilization, shown as an automatic row, no action. Fix `startingGovernmentFor`: **Greeks start
   with Democracy** (#368 table; today Despotism). Check that nothing breaks with Democracy's coin counters. Forward only, no
   migration of existing Greek players.
7. **Egypt's wonder.** The free ancient wonder is dealt into Egypt's own area at reveal (`drawStartingItems`). Setup lets the
   Egyptians place that piece (on an empty legal square in the capital's outskirts, as a wonder is normally built; find how
   building a wonder picks and places the piece). Needs the capital.

**Gate.** `setup.required` is set when a civilization is revealed in a **new** game. Marking Start of Turn done
(`markPhasesDone`, also reached through `upToPhase` TRADE..RESEARCH) is refused with a new `SETUP_INCOMPLETE` error (409) until
steps 1, 2, 3, 5 (and 4 for Americans, 7 for Egyptians) are done. When the gate lets it through, record that setup is finished so
a later manual board edit cannot re-close it. Reopening Start of Turn is unchanged. Players that are done are not held back by
others.

**Out:** French extra policy and policy cap (#378); Japan's remaining abilities (stay in #368); a tech discount; moving
starting techs, starting unit cards or Arab resources into setup; migrating games that are already under way (a save without a
`setup` record has no setup, no gate and no Setup tab; mention in limitations).

## Reference

- `docs/agents/decisions.md` lines about `civSetup` (~520-536), Chinese walls (~1457), Indians and Americans (~1470-1478),
  Spanish movement; `limitations.md` ("Civilization abilities not automated", Egypt legacy).
- Code map (file:line from the research): `capitalOf` (`sot.ts:370`), `cityFootprintsOf` (`blockade.ts:339`, has `outskirts`),
  `foundCityCheck` (`city-founding.ts:105`, takes a figure piece to locate the cell; a synthetic piece works),
  `placePiece`/`placeUnchecked`/`movePieceUnchecked` (`actions/board.ts:172,221,345`), `squareCentre` (`build-options.ts:196`),
  `terrainAt` (`terrain.ts:148`), `board.startSlots`, `startingCorner` (`board.ts:1146`), `mapTop`, `isMapCell`,
  `placeStartingTile`/`placeWhiteFigure`/`placeCivCityMarker`/`CIV_CITY_MARKER`/`drawStartingItems` in `actions/player.ts`,
  `undoCivReveal` and `canInitiateUndo` in `actions/undo.ts`, `markPhasesDone` in `actions/turn.ts:102`,
  `toPlayerView`/`PlayerViewSelf` in `state.ts`, `migrateGameState`/`withPlayerDefaults` in `migrate.ts`,
  `isAssistedBoardChange` (`actions/board.ts:1111`).
- Server: `routes/play.ts`, `routes/board.ts`, `errors.ts` (`statusFor` is an exhaustive switch), `E/errors.ts` `describeError`.
- Web: `views/PhaseTabs.tsx` (tabs are `TURN_PHASES`; a `'SETUP'` pseudo tab goes first), `views/mapPick.ts`
  (`useMapPicker().begin({title, cells})`), `SotPanel.tsx` `FreeBuildPicker` (the pattern), `EndTurn.tsx:162` and
  `ChatOrdersPanel.tsx:698` (both call `api.markDone`; both must show the gate reason), `lib/api.ts`.
- Rulebooks are not on this machine. The human's answers in #374 are the rules: capital on one of the four central squares,
  not on water, movable until setup is done; trade counted like the Trade phase, extra in normal Trade; government forced by
  the civ; Russian white army and Spanish white scout are placed in setup.

## Approach

Stages, in order (shared files, so one writer at a time):

- **Stage 1, engine and server** (this brief's first coder): `packages/engine/src/setup.ts` (new): pure reducers returning
  `Result<GameState, EngineError>`, one per action, plus `setupViewOf(state, player)`.
  State: `Playerhand.setup?: PlayerSetup` with only what cannot be derived: `required`, `finished`, the counted trade amount,
  which figures were placed by setup. Prefer **deriving** step status from the board (`capitalOf` on the map, own figures on the
  map by count, `socialPolicies.length`, the great person record, Egypt's wonder on the map) so manual board edits cannot desync.
  Solo undo per step for capital, figure, trade and wonder (a single player acting alone, like the board Undo), refused while a
  later step that needs it is still done, except that **moving the capital resets its dependents automatically**. Setup pieces
  are listed in `isAssistedBoardChange` so the board Undo does not half-undo them. Public `SETUP` log lines for every do/undo;
  the great person line says only that a great person was drawn.
  Engine changes: stop `placeCivCityMarker` in `revealCivilization`, set `setup.required`; `undoCivReveal` is refused (reuse
  `CIV_REVEAL_NOT_UNDOABLE` or a new error with a clear text) while the player has setup progress; Greek government;
  `markPhasesDone` gate; migration tolerant of the missing field; `toPlayerView` gets `you.setup` (private) with, per step:
  `id`, `label`, `status` (`done|todo|blocked|auto`), `reason`, `squares` for the map picker, `canUndo`; plus a
  `blocksTurn` reason for the End turn buttons. Hidden info: opponents and spectators see only the public log.
  Server: one route `POST /api/games/:id/setup` (strict arg parser, requestId and rev as the neighbouring routes do), error
  mapping, `setupGreatPerson` through the existing actions route (parser in `assisted-args.ts`).
- **Stage 2, web**: `SetupPanel` as the first tab, map picks via `useMapPicker`, the policy chooser reused from the existing
  social policy panel, the great person step using the existing `PendingRewardSection`, End turn buttons disabled with the reason,
  `hasActionsPanel` extended, `api.ts` functions.
- **Stage 3, docs and clean up**: `decisions.md` new "Setup phase" topic and updated Chinese/Indian/American/Greek lines,
  `limitations.md` (remove "until a proper setup phase exists" wording, legacy saves, trade is not a complete count),
  `state.md` one line, issue #368 boxes.

## Claimed paths

See `task-board.md` (`setup-374`).

## Acceptance criteria

- [ ] Every step works in any order allowed by its dependencies, with the tests listed below.
- [ ] Capital: only the four central squares of the player's own tile, never water or an occupied square; Chinese walled,
      Indian metropolis (two squares), others plain; move works and resets dependents; legacy area marker is reused.
- [ ] Figures: colour army and scout from supply, white army (Russians) and white scout (Spanish) moved from the area, all in
      the capital's outskirts on legal squares; stacking limit respected; undo returns supply.
- [ ] Policy: nothing changes in `chooseSocialPolicy`; setup shows done at one policy.
- [ ] American great person: draws 1 (2 with a revealed Organized Religion), keep/discard through `chooseReward`, discard public,
      marker in the area, undo by vote restores the deck; blocked until the policy is revealed.
- [ ] Trade: amount equals `tradeAroundCitiesOf`, capped by `tradeCeilingOf`, undo restores; turn 1 Trade still adds its own.
- [ ] Greeks get Democracy; Romans, Russians, Japanese unchanged; others Despotism.
- [ ] Egypt's wonder placeable in setup; no wonder step for others.
- [ ] Gate refuses Start of Turn done (including via `upToPhase`) until setup is complete, per player; saves without a setup
      record are unaffected; reveal undo refused after setup progress.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: `toPlayerView` for an opponent and a spectator carries no `you.setup`, no drawn card names, no
      rejected card names before the public discard; the public log of a great person draw names no card. Test for each.
- [ ] Browser check: the Setup tab through all steps for a Chinese, an Indian, a Spanish and an American player, the gate
      message on End turn, and the tab disappearing once turn 1 has started.

## Open questions

None blocking. Rulebook text could not be read; the human's answers in the issue stand in for it.
