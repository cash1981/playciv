# Assisted city actions: start a Building Program, upgrade buildings

- **Slug:** `assisted-city-actions`
- **Branch:** `feat/assisted-city-actions`, branched from `feat/assisted-units` (which contains `feat/assisted-build`)
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in progress
- **Issue:** [#264](https://github.com/cash1981/playciv/issues/264) (other city actions) and [#250](https://github.com/cash1981/playciv/issues/250) slice C (the explicit upgrade action)

Merged into `feat/assisted-play-contract` (PR #271), after the two branches it is built on, only when the human says it is ready. Read `tasks/assisted-build.md`, `tasks/assisted-units.md` and the "Assisted build" decisions first. The human chose no automatic "city action used" marker, so neither action here marks a city as used.

## Goal

Two more things a player does with a city, as buttons, with the same undo vote as every other assisted action:

1. **Start a Building Program** (Wisdom and Warfare p. 7): put the Building Program marker on the city centre, so the next build in that city doubles its outskirts production. Today the player drags the marker by hand.
2. **Upgrade buildings** (base rules p. 22): when a player has the tech of an upgraded building form, all the basic buildings of that family they have built in their cities flip to the upgraded form at once. Today the player swaps the pieces by hand.

## Rules (source in brackets; do not add others)

- Building Program (W&W p. 7): starting one is a city action. A city cannot have more than one marker at a time. The marker stays on the city until the city produces (the build action already removes it). It goes on the city centre; a metropolis has two centre squares, use the anchor square (`cityFootprintsOf` centres, the first one), and treat a marker on either centre as "has one" (`city-production.ts` already reads it that way). Available only in the player's open City Management phase (`openCityManagementTurn`), like the other actions. No cost.
- Upgrade (base rules p. 22): "When a player learns a tech unlocking an upgraded building, they immediately flip over any of the corresponding basic buildings that they've already produced in their cities." Basic and upgraded forms: granary to aqueduct, library to university, market to bank, temple to cathedral, barracks to academy, workshop to iron mine, shipyard to military dock (`BUILDING_UPGRADES` in `building-data.ts`; the tech to building table is `BUILDING_TECH_UNLOCKS`, revealed techs only). The player's buildings are the ones inside the outskirts of the player's own cities (use `cityFootprintsOf` for the player's colour and the pieces on those squares; do not use `placedBy`). A flipped building keeps its square. The supply pool is shared by both forms (`buildingSupplyGroup`), so a flip never changes the count. Flipping is not a build: it uses no production, no city action, no trade, and no Building Program marker; it is allowed in any phase of the player's turn (the tech may be learned in Research), but not by spectators or during replay. It is not an obligation the engine enforces; the button is there so the player does not move pieces by hand.
- Terrain (base rules p. 16): a flipped building keeps its square, so no terrain check.
- A building that belongs to no city of the player (placed outside every outskirts, or in someone else's) is not flipped.

## Scope

**In:**

- Engine, `build-options.ts` (or a sibling `city-actions.ts`): a derived own-view list `cityActions` per city (`startBuildingProgram` availability with status and reason; whether a marker is already there) and a player level `upgradeOptions` (for each family whose upgraded tech is revealed and that has at least one basic building in the player's cities: the families, the count and the squares). Own view only, blanked for replayed revisions like `buildOptions`.
- Two assisted actions (`button: false`, payloads `{ cityPieceId }` and `{ family }` or no payload for "all families"): `startBuildingProgram` places the marker through the board history (`placeUnchecked`, centred on the anchor centre square; asset `markers/Building Program`, size from the asset) and logs one public line with `assistedActionId`; `upgradeBuildings` replaces each basic piece with the upgraded piece on the same square through the board history (remove and place, in a stable order) and logs one public line naming the families and squares. Both recompute from the fresh state, are idempotent by `requestId`, refuse stale or illegal requests with a plain reason, and reverse by vote: the marker is removed (refusing when it moved off the centre or is gone), or each flipped piece is replaced by the basic one again (refusing when one moved or is gone). The plain board Undo must not undo any of those board changes alone (`isAssistedBoardChange`).
- Projection and route: the payloads are parsed strictly in `POST /api/games/:gameId/actions`; nothing private is added (the marker and the buildings are public board pieces). Hidden information tests: another viewer gets no `cityActions` or `upgradeOptions`, and an unrevealed tech unlocks nothing in any projection.
- Web: in the Cities panel each own city card gets a "Start Building Program" button (disabled with the reason as text; a city that already has the marker says so), and a small "Upgrades" block (above or below the cities) listing what can be upgraded with a button "Upgrade Granary to Aqueduct (3)" per family, or one "Upgrade all". Use `pressOnce` with a key that includes the action and payload. FAQ and README sentences. Tests at engine, server and web level.

**Out, and why:**

- A "used this turn" marker, harvest and devote to the arts (their icon data is not in the map data).
- Overbuilding, City Walls, wonders, Plastics and other free builds.
- Automatically flipping when a tech is revealed (the human wants buttons; flipping by hand stays possible).

## Reference

`engine/src/build-options.ts`, `building-data.ts` (BUILDING_UPGRADES, BUILDING_TECH_UNLOCKS), `city-production.ts` (the marker and `BUILDING_PROGRAM_ASSET_ID`), `blockade.ts` (`cityFootprintsOf`, `mapCellOf`), `assisted.ts` (the `build` action as the pattern for a placed piece, its record, `reverse`, `countLinesIn`, `markerUndoBlock`), `actions/board.ts` (`placeUnchecked`, `removePiece`, `isAssistedBoardChange`), `board.ts` (`buildingSupplyGroup`, `findBoardAsset`), `server/src/routes/play.ts` (`parseBuildPayload`), `routes/games.ts` (`projectedRevision`), `web/src/views/CitiesPanel.tsx`, `AssistedActions.tsx` (`pressOnce`), `BuildPicker.tsx`.

## Claimed paths

- `packages/engine/src/build-options.ts`, `city-actions.ts` (new, optional), `assisted.ts`, `state.ts`, `index.ts`, `actions/board.ts`
- `packages/engine/test/assisted-city-actions*.test.ts`, `hidden-info.test.ts`
- `packages/server/src/routes/play.ts`, `routes/games.ts`, `packages/server/test/assisted-city-actions*.test.ts`
- `packages/web/src/lib/api.ts`, `views/CitiesPanel.tsx`, `CitiesPanel.css`, `CityActions.tsx` (new) and tests, `FaqView.tsx`
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Acceptance criteria

- [ ] "Start Building Program" puts the marker on the city centre, logs one public line, and one vote undo removes it; a city that already has one cannot start another; a metropolis counts a marker on either centre; wrong phase, spectators and replay cannot.
- [ ] The next build in that city uses the doubled figure and removes the marker (the existing build behaviour), and undoing the start after that is refused or handled sanely (the marker is gone: refuse with the vote open).
- [ ] "Upgrade" lists only families whose upgraded tech is revealed and that have basic buildings in the player's own cities; it flips exactly those pieces, keeping squares, the supply count unchanged; buildings outside the player's cities and other players' buildings are untouched.
- [ ] One vote undo restores the basic buildings; refused when one moved or is gone; the board Undo cannot undo either action alone.
- [ ] Stale and duplicate requests do nothing twice; an unrevealed tech unlocks nothing; other viewers get nothing.
- [ ] Works on a phone at 390 and 320 px.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, suites one at a time.
- [ ] Verified in the browser: start a program then build with it, upgrade a Granary to an Aqueduct, undo of each.

## Open questions

- None blocking.

## Handover

(to be filled in when done)
