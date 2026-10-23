# Build polish and wonders

- **Slug:** `build-polish-wonders`
- **Branch:** `feat/assisted-play-contract` (the human chose this branch; same PR #271)
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in review

After trying the assisted Build the human asked for a list of changes. Web, engine and
server; one new data file.

## What changes

1. **No panel for the opponents' cities.** `CitiesPanel.tsx` is deleted, for players and
   spectators; the board shows every city. The projection is unchanged.
2. **Your actions sits under the board**, directly before Your hand. The confirm bar stays
   above the board.
3. **"Why not the others" is a link that opens a popup** (`ReferenceDialog`, as the production
   count does) instead of a folded list.
4. **Noise out of the picker:** the Units heading is "Units"; "Draws a card in secret" and the
   count of squares ("6 squares") are gone for every item.
5. **A figure is placed by the tap on its square, with no Confirm.** A square with an enemy note
   keeps the note and Confirm; Confirm also shows after a refusal. Buildings, wonders and units
   keep Confirm.
6. **Removing a built piece before End turn takes the build back** (`takeBackOpenBuild`, called by
   the board remove route): the same reversal as the undo vote, a new System line ending "It was
   removed before End turn.", the old line kept (the human said to add a line if deleting one was
   too much work). The piece may have been moved. After End turn, or for a phase of an older turn, it
   is a plain removal. Covers a building, a wonder, a figure and a started Building Program; not
   upgrades or units. It closes an undo vote open on the line and sets `board.undoFloor`, so the
   owner's board Undo cannot bring the piece back (review finding).
7. **Wonders** from the market are built like a building (`wonder-data.ts`, `marketWondersOf`, item
   `{ kind: "wonder", assetId }`): any terrain but water, one wonder per city. The cost (the printed
   one, or the discount with the tech on the card) is shown and **not enforced**: no check against
   production, no trade. The market piece moves onto the square and the player becomes its owner.
8. **The next wonder is drawn into the market** by the build: four wonders of each era, ancient first,
   then medieval, then modern. The vote undo and the take-back return the drawn card to its deck.
   Rules in "Build polish and wonders" in `decisions.md`.

## Not changed

- Replacing buildings or wonders, Hanging Gardens and the other wonder abilities. Costs of buildings,
  figures and units are still checked against production, as decided earlier.
- The vote undo, the board Undo guard (it also covers the new owner entry), the Order tab.

## Decided with the human

- The build draws the next wonder, four of each era in the order ancient, medieval, modern.
- Angkor Wat is 15 with Theology (the sheet has 10; corrected in `wonder-data.ts`); the United Nations
  is right at 20 with no discount.
- The cost of a wonder is only told for now.

## Files

- Engine: `build-item.ts`, `build-options.ts`, `wonder-data.ts` (new), `assisted.ts`, `state.ts`,
  `actions/board.ts`, `terrain.ts`, `index.ts`; tests `assisted-build.test.ts`, `assisted-wonders.test.ts`
  (new), `wonder-data.test.ts` (new).
- Server: `routes/board.ts`, `routes/play.ts`; test `assisted-build-api.test.ts`.
- Web: `BuildPicker.tsx`, `.css`, `buildFlow.ts`, `GameView.tsx`, `CityCard.tsx`, `FaqView.tsx`, and the
  tests of those; `CitiesPanel.tsx` and its test are removed.
- `decisions.md`, `state.md`, `README.md`, `task-board.md`.

## Added later: replacing, Great People and City Walls

After trying Build the human asked for: a second wonder in a city (it replaces the first), building
over any of one's own buildings or wonders (the old piece is removed), City Walls as a Build choice
(Masonry), and upgrades replacing the building (already the Upgrade block). He first described a Great
Person as only disabling the building under it; the rulebook (p. 18) says it replaces it, a replaced
Great Person goes back to the player's area, and the human chose the rulebook. The rules, the choices
made and what is not built are in "Replacing, Great People and City Walls" in `decisions.md`. Rulebook
text read from `Civilization/civilization-rules.pdf` p. 17 and 18.
