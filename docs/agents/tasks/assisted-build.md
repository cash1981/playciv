# Assisted Build: a city builds a building

- **Slug:** `assisted-build`
- **Branch:** `feat/assisted-build`, branched from `feat/assisted-play-contract` (PR #271)
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in review (ready for the human to test)
- **Issue:** [#264](https://github.com/cash1981/playciv/issues/264), part 2 of the Build work (part 1 was city production)

This branch is merged into `feat/assisted-play-contract`, and pushed there, only when the human says it is ready. Parts 3 and 4 (figures, military units) extend this one; design the payload and the effect so they can reuse it.

## Goal

A city can build a building from a Build button. The player picks a city, picks one of the buildings the game knows are legal and affordable, taps one of the highlighted squares around the city, and confirms. The piece is placed, any trade paid, a Building Program marker used up, and the log written in one atomic step that the everyone votes undo can reverse. Cancelling changes nothing.

## Why

#264: "Choose Build from a city summary, choose an eligible item, then click the highlighted surrounding square." The human's answers: all of #264 in the end; production first (done, the Cities panel); only legal choices in the main list, with a separate explanation for the rest and the hand set production as the way out when the estimate is too low; trade rush is part of Build; the cost of units and figures follows the player's level. Also: no automatic "city action used" marker, the player presses End when done, because techs, culture cards and Great Persons allow several actions.

## Rules (source in brackets; do not add others)

- Phase: only in the player's open City Management phase, as the other assisted actions (`openCityManagementTurn`).
- A building must be unlocked by a revealed tech (`techsChosen`, `!hidden`). The tech to building table is the human's tech sheet, as written in `web/src/views/techText.ts`: Code of Laws: Trading Post. Currency: Market. Metalworking: Barracks. Navigation: Harbor. Philosophy: Temple. Pottery: Granary. Writing: Library. Navy: Shipyard. Construction: Workshop. Engineering: Aqueduct. Printing Press: University. Banking: Bank. Military Science: Military Dock and Academy. Railroad: Iron Mine. Theology: Cathedral. Put it in the engine as a typed table (the web text stays prose).
- Basic and upgraded forms (base rules p. 22): granary to aqueduct, library to university, market to bank, temple to cathedral, barracks to academy, workshop to iron mine, shipyard to military dock. Once the upgraded form is unlocked the basic form can no longer be built, only the upgraded one. Knowing the tech of the upgraded form is enough, the basic form's tech is not needed. Harbor and Trading Post have one form. (Flipping already built basic buildings when the upgrade tech is learned is a separate later action, not here.)
- Cost: `building-data.ts` (`cost`). The production the city has: the hand set number if there is one, otherwise the estimate; with a Building Program marker on the city centre and no hand set number, the `withBuildingProgram` figure. See `city-production.ts`.
- Rush with trade (base rules p. 15): every 3 trade lowers the shortfall by 1 production. The Americans (civilization "Americans") get 2 production per 3 trade. Pay in whole steps of 3 trade, never more than needed (Americans: 3 trade per 2 production, rounded up to whole steps). The trade comes off `stats.trade`.
- Building Program (Wisdom and Warfare p. 7): a city with the marker must use it when it produces, so the marker piece is removed (through the board history, restorable by undo) whenever the city builds, whatever production number was used.
- Where: a square in the city's outskirts (never a city centre), on the map (`isMapCell`), whose terrain is known and is the one in `BUILDING_TERRAIN` (`terrain.ts`: harbor, shipyard and military dock on water, trading post desert, workshop and iron mine mountain, library, university, granary, aqueduct grassland, the six others any square but water), with no building, wonder or great person already on it, and no enemy figure (`hasEnemyFigureAt`; base rules p. 27: buildings cannot be placed in a blockaded square). A square that is also in another of the player's own cities' outskirts is allowed.
- One limited building per city (base rules p. 16 to 17): Market or Bank, Temple or Cathedral, Barracks or Academy are limited; a city may have only one limited building in total in its outskirts. A building already on a square of this city's outskirts counts, whoever's it is.
- Supply: `remainingBoardAssetCount` for the asset (the shared pools in `board.ts`) must be above 0.
- A walled city, a capital and a metropolis build the same way. A metropolis has ten outskirts squares and both orientations are covered by `cityFootprintsOf`.

## Scope

**In:**

- Engine `build-options.ts` (new): `buildOptionsOf(state, player)` returns one entry per city on the map: `cityPieceId`, `label`, `status` (`ready` or `wrong-phase` with the reason), the production figure used and where it came from (hand set, estimate, building program), and `choices`: each building the player may build in this city with the cost, `tradeToPay` (0 when the production is enough), the list of legal squares (cell and label), and `unavailable`: every other known building with a plain reason (not unlocked, replaced by its upgrade, supply used up, the city already has a limited building, no legal square with the reason, cost above production and not enough trade with the shortfall and the hint to set the production by hand). A building with no legal square or too little production is in `unavailable`, never in `choices`.
- A new assisted action `build` (`button: false`, `usageKey: null`, a payload `{ cityPieceId, item: { kind: 'building', assetId }, target: { column, row }, rush?: boolean }` that parts 3 and 4 extend with other item kinds). `apply` recomputes everything from the fresh state and refuses with a useful reason when anything changed since the player looked (square taken, supply gone, trade spent, phase over); it places the piece centred on the square through the board history (`placeUnchecked`; centre is `((column + 0.5) * squareSize, mapTop + (row + 0.5) * squareSize)` minus half the piece size), pays the trade, removes the Building Program marker, and writes the public log line (the building, the city label, the square, the trade paid; no hidden information) carrying `assistedActionId`. The record stores everything `reverse` needs: the placed piece id, asset, position and history id, the city piece id, the trade paid, and the removed marker (piece and position).
- `reverse`: refuses (vote stays open) when the placed piece is gone or no longer on its square, otherwise removes it, refunds the trade, puts the marker back at its old position, and writes the System line, like the culture advance. `isAssistedBoardChange` (`actions/board.ts`) must treat the placed piece and the marker removal as assisted so the plain board Undo refuses them (`BOARD_UNDO_ASSISTED`).
- Idempotence and revision: the same route and rules as the other actions (`requestId`, `rev`).
- Projection: `buildOptions` on the own view only (`PlayerViewSelf`), blanked for replayed revisions in `projectedRevision` like `availableActions`. Opponents and spectators never get it (it depends on unrevealed techs). Hidden information tests.
- Server route: `POST /api/games/:gameId/actions` accepts the `build` payload, validates the shape (ids, integers, a boolean) and rejects payload fields on other actions as it does today.
- Web: a "Build" button on each of the viewer's cities in the Cities panel (disabled with the reason when `status` is not ready). It opens a picker: the choices with name, cost and "pay N trade" when it rushes, and a collapsed "Why not the others" list with the reasons. Picking a choice enters a square picking mode on the board: the legal squares are highlighted (cell overlays inside the board surface, tap or click selects, keyboard reachable), the page scrolls and moves focus to the board (smooth scroll off with reduced motion), and a bar shows the item, the city, the cost, the square and Confirm and Cancel. Cancel and Escape leave everything unchanged. Confirm sends the action through `pressOnce` with a key that includes the payload, then clears the mode. After a rejection, say what changed and return to the picker with fresh data. Drag and drop and tap then tap of pieces keep working as today.
- Tests at engine, server and web level; the FAQ sentence; `decisions.md` ("Assisted build"); README sentence.

**Out, and why:**

- Figures (army 4, scout 6) and military units (private card draw): parts 3 and 4.
- Flipping built basic buildings to the upgrade when the tech is learned, City Walls (Masonry), overbuilding or replacing an existing building, wonders and their market, Plastics and other free builds, Hanging Gardens: later explicit actions.
- A per city "used this turn" marker (the human decided against it) and the other city actions (building program start, harvest, devote to the arts): later.
- Production icons that are not in the map data: the estimate may be low; the hand set production is the way out and is named in the reasons.

## Reference

`engine/src/assisted.ts` (registry, `performAssistedAction`, `cultureAdvance` and the Great Person marker code as the patterns for a placed piece, its record, `markerUndoBlock`, `reverse`, `countLinesIn`), `actions/board.ts` (`placeUnchecked`, `removePiece`, `isAssistedBoardChange`), `city-production.ts`, `building-data.ts`, `terrain.ts`, `blockade.ts` (`cityFootprintsOf`, `mapCellOf`), `board.ts` (`remainingBoardAssetCount`, `isMapCell`, `mapTop`), `server/src/routes/play.ts` (the `/actions` route), `server/src/routes/games.ts` (`projectedRevision`), `web/src/views/AssistedActions.tsx` (`pressOnce`, `RewardChoice`), `CitiesPanel.tsx`, `BoardView.tsx` (`toBoard`, `onSurfacePointerUp`, the overlay layers), `GameView.tsx` (state shared by the panel and the board).

## Claimed paths

- `packages/engine/src/build-options.ts` (new), `building-data.ts`, `assisted.ts`, `state.ts`, `errors.ts`, `index.ts`, `actions/board.ts`
- `packages/engine/test/assisted-build*.test.ts`, `hidden-info.test.ts`
- `packages/server/src/routes/play.ts`, `routes/games.ts`, `errors.ts`, `packages/server/test/assisted-build*.test.ts`
- `packages/web/src/lib/api.ts`, `views/CitiesPanel.tsx`, `BuildPicker.tsx` (new) and its css and tests, `BoardView.tsx`, `GameView.tsx`, `styles.css`, `FaqView.tsx`
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Acceptance criteria

- [ ] A city with the unlocked tech, a legal square and enough production builds: the piece appears centred on the chosen square, the log names building, city and square, and one vote undo removes it again.
- [ ] Missing unlock, an upgraded form that replaces the basic one, exhausted supply, a city that already has a limited building, no legal square (wrong terrain, occupied, blockaded, a centre, off the map, unknown terrain) and a cost above production each keep the building out of the choices and give a reason.
- [ ] Rush: a shortfall is paid in steps of 3 trade (Americans 2 production per 3 trade) and only when the trade is there; undo refunds it.
- [ ] A Building Program marker is used up by the build and restored by undo; a hand set production wins over the estimate and the doubled figure.
- [ ] Both metropolis orientations and a walled city offer the right squares.
- [ ] A stale or duplicate request does not build twice; a square taken in between is refused with a useful reason.
- [ ] Wrong phase and a spectator or replay cannot build; opponents and spectators never receive `buildOptions`.
- [ ] The board Undo cannot undo the placed piece or the marker removal alone.
- [ ] Cancel and Escape in square picking leave state unchanged; works on a phone (tap) at 390 and 320 px.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, suites one at a time.
- [ ] Verified in the browser: build a Library on grassland, a Harbor on water and a rush build, undo by vote, a rejected stale square.

## Open questions

- None blocking. The terrain data was read by eye, so a legal square may be missing; the player can still place a piece by hand (a logged correction, unchanged).

## Handover

(to be filled in when done)
