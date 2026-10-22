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
   `{ kind: "wonder", assetId }`): printed cost or the discount with the tech on the card, one wonder
   per city, any terrain but water. The market piece moves onto the square and the player becomes its
   owner. Rules in "Build polish and wonders" in `decisions.md`.

## Not changed

- Replacing buildings or wonders, drawing the next wonder into the market (the Draw panel does
  that), Hanging Gardens and the other wonder abilities.
- The vote undo, the board Undo guard (it also covers the new owner entry), the Order tab.

## Open question for the human

- After a wonder is produced the rules draw the next one from the deck into the market. The app
  keeps no deck order, so the player still draws it. Should the build draw it, and from which era?
- The sheet has Angkor Wat at 20 (10 with Theology) and the United Nations at 20 with no discount,
  unlike the other wonders of their era. Used as written.

## Files

- Engine: `build-item.ts`, `build-options.ts`, `wonder-data.ts` (new), `assisted.ts`, `state.ts`,
  `actions/board.ts`, `terrain.ts`, `index.ts`; tests `assisted-build.test.ts`, `assisted-wonders.test.ts`
  (new), `wonder-data.test.ts` (new).
- Server: `routes/board.ts`, `routes/play.ts`; test `assisted-build-api.test.ts`.
- Web: `BuildPicker.tsx`, `.css`, `buildFlow.ts`, `GameView.tsx`, `CityCard.tsx`, `FaqView.tsx`, and the
  tests of those; `CitiesPanel.tsx` and its test are removed.
- `decisions.md`, `state.md`, `README.md`, `task-board.md`.
