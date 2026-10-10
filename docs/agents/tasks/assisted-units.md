# Assisted Build: army and scout figures, and military units

- **Slug:** `assisted-units`
- **Branch:** `feat/assisted-units`, branched from `feat/assisted-build` (part 2, Build for buildings)
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in progress
- **Issue:** [#264](https://github.com/cash1981/playciv/issues/264), parts 3 and 4 of the Build work

This branch is merged into `feat/assisted-play-contract` (PR #271), after `feat/assisted-build`, only when the human says it is ready. Read `tasks/assisted-build.md` and the "Assisted build" decisions first: this brief extends that action, it does not replace it.

## Goal

The same Build button also produces an army figure, a scout figure, or a military unit. A figure is placed on a highlighted square of the city's outskirts exactly like a building. A unit is a private card: one click, no placement, the card goes to the player's hand and only the type is public. Payment, the Building Program marker, undo and the log work as for buildings.

## Why

#264: "Offer buildings, scouts, army figures and military units ...", "Military units select an eligible type/rank and draw the correct private card directly, without board-figure placement. Distinguish units from army/scout figures clearly." The human's answers: all of the issue; trade rush included; unit cost follows the player's level (no rank choice): army 4, scout 6.

## Rules (source in brackets; do not add others)

- Costs (base rules p. 15 to 17): army figure 4, scout figure 6. A unit costs by the player's level for that type: level 1 costs 5, level 2 costs 7, level 3 costs 9, level 4 costs 11; aircraft always cost 12 and need the revealed tech Flight. The level is `stats.infantry`, `stats.artillery` or `stats.mounted` (1 to 4, edited by hand today; read it, do not enforce or change it).
- The same production, rush and Building Program rules as for buildings. A Building Program marker is used up by any build, a figure or a unit too (W&W p. 7).
- A figure is placed in the city's outskirts (base rules p. 15). A water square only when a revealed tech lets figures end their movement in water: Sailing, Steam Power or Flight (base rules p. 15; the tech text in `techText.ts`). Not on a city centre.
- Several friendly figures may share a square, but the total figures there (armies and scouts together) must not exceed the player's stacking limit `stats.stacking` (base rules p. 15, 19; default 2).
- Supply: 6 armies and 2 scouts per colour (`figureLimit` in `board.ts`; the white army is Russia only and not built here). The count includes figures anywhere on the board.
- Blockade (base rules p. 27): a scout cannot be placed in a blockaded square. An army may be placed in one, but that immediately starts a battle with the blockader as defender. Battles are not automated: allow it, say so in the choice ("starts a battle, start it by hand") and in the confirm bar.
- Huts and villages (base rules p. 15, 19): scouts cannot enter squares with a hut or village marker. The rulebook does not say what an army placed on one does, so do not offer a square with a hut or village marker to any figure, say so in the reason, and leave placing by hand as the way. This is a deliberate gap for the human to confirm.
- A unit card is drawn at random from the deck of that type (infantry, artillery, mounted, aircraft); if the deck has none, reshuffle the discards of that type as the Draw button does; if there is still none, the unit is not offered ("no unit cards left"). The card goes into the player's hand, hidden. The public log line names the type only ("a mounted unit"), never the card's numbers; the private line may show the card as the Draw button does. Undo puts the card back (reuse `restoreDrawnCards`, `shuffleDeckTwice`, `drawCandidates` from `assisted.ts`; see how the Great Person draw and its reversal work, and why those draws write no item log line).
- No chance to redraw: an undone unit puts the same card back, and the deck order is restored, like the Great Person cards.
- Out of scope rules: Leonardo's Workshop (units cost at most 5), Plastics, Hanging Gardens, Navy (placing in a city with a shipyard), Great Person abilities. Name them in the reasons only if the player owns the wonder or tech (not required).

## Scope

**In:**

- Engine: extend `BuildItem` (`build-options.ts`) with `{kind:'army'}`, `{kind:'scout'}` and `{kind:'unit', unitType:'infantry'|'artillery'|'mounted'|'aircraft'}`. `buildOptionsOf` offers them per city as `choices` (figures with squares like buildings, units with no squares and a `placement: 'square' | 'none'` marker the web can read), and lists the others in `unavailable` with reasons (supply used up, no legal square and why, aircraft need Flight, no unit cards left, cost above production). A choice is legal only when the player can pay (production or trade rush).
- The `build` action handles the new items: figures place a figure piece centred on the chosen square through the board history (asset `figures/<colour>army` and `figures/<colour>scout`, colour from `player.color` lower case), units draw a card with no square. All other steps are shared with buildings: recompute from fresh state, pay trade, use up the Building Program marker, one public log line with `assistedActionId`, a record that stores what `reverse` needs. `reverse` removes the figure (refusing when it moved off its square) or returns the card, refunds the trade and restores the marker.
- `isAssistedBoardChange` also covers the placed figure (the unit has no board change).
- Projection and route: the payload parser accepts the new item shapes; nothing new is public except the log line; hidden information tests (the drawn card never appears in another viewer's projection, the public log line or the public record).
- Web: the picker lists figures and units with clear labels and a heading that separates "Figures (placed on the map)" from "Units (private card)" and "Buildings". A figure enters square picking as buildings do. A unit has no square: choosing it shows the confirm bar at once (item, city, cost, trade) and Confirm builds it. The Cities panel keeps working. FAQ and README sentences.
- Tests at engine, server and web level.

**Out, and why:**

- Flipping basic buildings, City Walls, wonders, overbuilding, harvest, devote to the arts and the Building Program start: later explicit actions.
- Battle start when an army is placed in a blockaded square: allowed and flagged, not automated.
- Enforcing or changing unit levels and the stacking limit: read only here.

## Reference

`engine/src/build-options.ts`, `assisted.ts` (the `build` action, `drawCandidates`, `restoreDrawnCards`, `shuffleDeckTwice`, `takeGreatPersonMarker`), `actions/board.ts` (`placeUnchecked`, `removePiece`, `isAssistedBoardChange`), `actions/draw.ts`, `item.ts` (unit kinds, `itemName`, `revealPublic`), `board.ts` (`figureLimit`, `remainingBoardAssetCount`), `terrain.ts`, `blockade.ts`, `web/src/views/BuildPicker.tsx`, `buildFlow.ts`, `BoardView.tsx` (pick mode), `techText.ts` (water techs: Sailing, Steam Power, Flight).

## Claimed paths

- `packages/engine/src/build-options.ts`, `building-data.ts`, `assisted.ts`, `state.ts`, `errors.ts`, `index.ts`, `actions/board.ts`
- `packages/engine/test/assisted-units*.test.ts`, `hidden-info.test.ts`
- `packages/server/src/routes/play.ts`, `packages/server/test/assisted-units*.test.ts`
- `packages/web/src/lib/api.ts`, `views/BuildPicker.tsx`, `buildFlow.ts`, `CitiesPanel.tsx`, their css and tests, `FaqView.tsx`
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Acceptance criteria

- [ ] An army (4) and a scout (6) are built on a highlighted square: the figure piece appears centred there, the log names it, one vote undo removes it.
- [ ] Water squares only with a revealed Sailing, Steam Power or Flight; a city centre, a square over the stacking limit and a hut or village square are never offered, each with a reason; a scout is not offered a blockaded square, an army is, flagged as starting a battle.
- [ ] Army and scout supply (6 and 2) is respected, anywhere on the board.
- [ ] A unit costs by the player's level (5, 7, 9, 11) and aircraft 12 with Flight; an empty deck gives a reason; the card goes to the hand hidden; the public line names the type only; undo returns the same card.
- [ ] Rush, the Building Program marker and the hand set production work as for buildings, for figures and units too.
- [ ] Hidden information: the drawn card never reaches another viewer, the public log line or the public record; another player's projection is identical before and after.
- [ ] Stale and duplicate requests do not build twice; wrong phase, spectators and replay cannot build.
- [ ] The picker separates buildings, figures and units clearly; works on a phone.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, suites one at a time.
- [ ] Verified in the browser: an army on land, a scout, a unit with a private card, undo of each, a rush.

## Open questions

- Huts and villages: what an army placed on one does (see Rules). Handled by not offering the square; the human confirms.
- Placing an army in a blockaded square starts a battle: flagged, not automated.

## Handover

(to be filled in when done)
