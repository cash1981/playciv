# Board: snap map tiles to the grid when moved

- **Slug:** `board-tile-snap`
- **Branch:** `feat/game-fixes`
- **Owner:** coder, orchestrated by Opus
- **Status:** in progress

## Goal

A map tile (an exploration tile or a civilization starting tile) dropped
anywhere on the map snaps to the nearest 4×4 block, so it lines up with the grid
instead of sitting half a cell off. Placement already snaps; moving must too.

## Why

The human reported (bug #6): "When choosing Arabs and taking their tile and
putting on the map, you can see it's not aligning perfectly. It is between 4–5
and L & M." Terra confirmed: `movePiece` snaps for the culture track and player
areas, but a piece dropped on the map keeps its raw drop coordinates
(`board.ts:219`, the `return { x: input.x, y: input.y }` fallback). Auto-placed
tiles are aligned; a tile the player drags is not.

## Scope

**In:**
- In `movePiece`, when the moved piece is a map tile (`category === 'tile'` or
  `'civtile'`) and it is dropped on the **map** (not the culture band, not a
  player area), snap its position to the nearest 4×4 block origin — the same
  grid `blockOrigin` / `firstFreeBlock` / `startingCorner` already use.

**Out:**
- Snapping ordinary pieces (figures, resources, cities, buildings, markers).
  The board is free pixel placement by design; only 4×4 map tiles align to
  blocks. Leave everything else exactly as it is.
- The culture-track and player-area snapping (already correct).

## Reference / what I traced

- `packages/engine/src/actions/board.ts` — `movePiece`. The map-drop branch is
  the final `return { x: input.x, y: input.y }`.
- `packages/engine/src/board.ts` — `blockOrigin(board, blockColumn, blockRow)`
  returns the pixel top-left of a 4×4 slot (it already adds `mapTop`).
  `blockColumns(board)` / `blockRows(board)` give the slot counts. A tile is
  `TILE_SQUARES * squareSize` on a side.
- Nearest block from a pixel drop: `col = clamp(round(x / (TILE_SQUARES*squareSize)), 0, blockColumns-1)`,
  `row = clamp(round((y - mapTop) / (TILE_SQUARES*squareSize)), 0, blockRows-1)`,
  then `blockOrigin(board, col, row)`. Add a small helper (e.g. `nearestBlock`)
  next to `blockOrigin` rather than inlining, and export it if the reducer needs
  it.

## Approach

Add `nearestBlock(board, x, y)` to `board.ts` returning the snapped
`[x, y]`. In `movePiece`, in the branch that currently returns the raw drop for
a map drop, check the piece category: if it is `tile` or `civtile`, return
`nearestBlock(...)`; otherwise keep the raw coordinates. Keep the
culture-band and player-area branches ahead of it unchanged.

The move is still recorded in board history as a normal `move` op with the
snapped `to` coordinates, so undo/replay stay exact.

## Claimed paths

- `packages/engine/src/board.ts` (nearestBlock helper)
- `packages/engine/src/actions/board.ts` (movePiece)
- `packages/engine/test/board.test.ts` or `board-tiles.test.ts` (test)

## Acceptance criteria

- [ ] Moving a `civtile`/`tile` to an off-grid pixel on the map lands it exactly
      on a `blockOrigin` (aligned to the 4×4 grid). Engine test with an
      off-grid target asserting the snapped result.
- [ ] Moving an ordinary piece (e.g. a figure) to an off-grid pixel keeps its
      exact coordinates (no snapping). Engine test.
- [ ] Dropping a tile in a player area or on the culture track still behaves as
      before (area tidy / culture snap take precedence).
- [ ] Board history records the move with the snapped `to`, and undo restores
      the original position. Engine test or existing history tests still pass.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass. Report real output.

## Out of scope (separate briefs)

- Zoom panning / scrollbars (task 3).
- Tech-tree overlap, collapsible panels, tech pyramid overflow, log timestamp
  display format (client-visual bundle).
- Civ-tile auto-placement — already works and matches the human's 4-player
  coordinates (verified); no change needed there.
