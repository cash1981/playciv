# Issue #109: stepped three-player map and five-player map with a hole

- **Slug:** `issue-109-board-shapes`
- **Branch:** `feat/issue-109-board-shapes`
- **Owner:** opencode (deepseek-flash)
- **Status:** in progress

## Goal

A three-player game gets the stepped map from the base rulebook: ten tiles laid
as a pyramid, `4 + 3 + 2 + 1`, with the starting tiles at the top (arrow down),
bottom left (arrow right) and bottom right (arrow left). A five-player game gets
the bigger map from the Fame and Fortune rulebook: twenty-two tiles with a hole
in the middle and five starting tiles around the edge. In both games the map is
no longer the full rectangle: the hole and the outside get no grid, no fog, no
tile snapping and no square name, and no two starting tiles land on top of each
other.

## Why

The issue asks for exactly this, from the rulebook diagrams:

> **3 spillere:** trappet brett. Startbrikke i toppen med pil nedover, og
> startbrikker nederst til venstre (pil mot høyre) og nederst til høyre (pil mot
> venstre).

> **5 spillere:** større brett med et hull i midten. Hullet kan ikke beveges
> gjennom, og regnes som tilstøtende den *indre* kanten av brettet (regelbokens
> eksempel: Galileo kan ikke flytte brikker ved hullet). Fem startbrikker: topp
> (pil ned), venstre (pil høyre), høyre (pil venstre), nederst til venstre (pil
> opp), nederst til høyre (pil opp).

Observed today (from the issue): three players get a full 16 × 16 with starts
in NW, NE, SE; five players get a full 16 × 16 where player 5 inherits player
1's corner, so two starting tiles stack at `(0, 258, 180)`.

## Reference

There is no old-system reference for this — Java stored a link to a Google
slide and the board is new in this port. The rulebook diagrams are the source,
measured off the PDFs in `packages/web/public/help/` (rendered at 8× with
PDFKit while preparing this brief):

- Base rulebook, printed page 9, "MAP SETUP BY NUMBER OF PLAYERS": the
  **THREE PLAYERS** diagram. `civilization-rules.pdf`, page 9.
- Fame and Fortune rulebook, printed page 6, "FIVE-PLAYER MAP SETUP": the
  diagram plus the note about the hole and Galileo.
  `civ-fame-and-fortune-rules.pdf`, page 5. The index that points at it is on
  printed page 15 (PDF page 14).

Both diagrams show tiles that are 4 × 4 squares and may sit at half-tile
offsets — that is, slot origins are multiples of 2 squares, not of 4. Measured
positions (squares of 94 px, `x` right, `y` down from the top of the map):

**Three players** (bounding box 16 × 16 = four block rows, ten tiles):

| row `y` | slot `x` |
| --- | --- |
| 0 | 6 |
| 4 | 4, 8 |
| 8 | 2, 6, 10 |
| 12 | 0, 4, 8, 12 |

Starts: `(6, 0)` arrow down = 180°, `(0, 12)` arrow right = 90°, `(12, 12)`
arrow left = 270°.

**Five players** (bounding box 28 × 18, twenty-two tiles, hole at
`x 12..16, y 8..14`):

| slot | position | kind |
| --- | --- | --- |
| A | (12, 0) | brown |
| B | (8, 2) | brown |
| F | (12, 4) | START, arrow down = 180° |
| G | (16, 2) | brown |
| D | (0, 6) | START, arrow right = 90° |
| C | (4, 6) | brown |
| E | (8, 6) | brown |
| H | (16, 6) | brown |
| I | (20, 6) | brown |
| J | (24, 6) | START, arrow left = 270° |
| K | (0, 10) | brown |
| L | (4, 10) | brown |
| M | (8, 10) | brown |
| N | (16, 10) | brown |
| O | (20, 10) | brown |
| P | (24, 10) | brown |
| Q | (2, 14) | brown |
| R | (6, 14) | START, arrow up = 0° |
| S | (10, 14) | brown |
| T | (14, 14) | brown |
| U | (18, 14) | START, arrow up = 0° |
| V | (22, 14) | brown |

The hole is one tile wide and one and a half tiles tall. It is closed at the
bottom by the upper halves of S and T, so it is an inside gap, not a bay. The
rulebook says it cannot be moved through in any way and counts as adjacent to
the inside edge of the map.

## Scope

**In:**

- A board shape that is a list of playable 4 × 4 slots instead of every block of
  a rectangle, on the board itself so the client and the engine agree.
- Starting slots per player count, replacing the "corner" table.
- The client drawing grid, mat and fog only on the playable slots.
- Tile snapping to playable slots only; no square name and no "on the map"
  reading inside the hole or outside the shape.

**Out:**

- One and four players, and the two-player 16 × 8 board: unchanged. The rulebook
  two-player diagram is the same map rotated a quarter turn; presentational, not
  part of this issue.
- Migration of saved three- and five-player games. The human has confirmed there
  are no such games, so nothing is re-seated. Saved two- and four-player games
  must keep loading and looking exactly as before; they only gain the new
  rectangle slot list, which is a no-op.
- Pathfinding or movement rules around the hole. The engine has no movement
  model — `mvmt` is a status number and pieces are dragged freely — so there is
  nothing to enforce beyond geometry: no playable slot and no square label in
  the hole or outside the shape (human-confirmed).
- Artwork for the map edges and the outline question for rectangles.
- The 4 × 4 block grid for rectangular boards: unchanged, including the single
  green mat with its outline.

## Approach

**Shape on the board** (`packages/engine/src/board.ts`). `Board` gains three
fields, all public board data that flow to the client through `PlayerView` with
no projection change:

- `slots`: every playable 4 × 4 slot, as top-left corners in squares from the
  map's own top-left, in reading order. `createBoard()` fills in all blocks of
  the rectangle, so rectangles keep working.
- `slotStep`: the placement grid in squares — 4 normally, 2 on the stepped
  maps, whose slots sit at half-tile offsets.
- `startSlots`: one entry per player in playernumber order, each with position
  and rotation, replacing the corner table inside `startingCorner`. The arrows
  keep their meaning (0 = up, 90 = right, 180 = down, 270 = left).

`createBoardForPlayers(numOfPlayers)` picks the board: 2 → `createBoard(16, 8)`,
3 → the pyramid literal, 5 → the hole literal, otherwise `createBoard()`.
`create-game.ts` calls it instead of choosing a rectangle itself. The literals
carry a comment citing the rulebook page they were measured from.

**Starting order** (human-approved): clockwise from the top. Three players —
1 top, 2 bottom right, 3 bottom left. Five players — 1 top, 2 right, 3 bottom
right, 4 bottom left, 5 left. `startSlots` lists them in that order and
`startingCorner` wraps by playernumber, as it already does.

**Slot-aware geometry.** `nearestBlockOrigin` becomes `nearestSlotOrigin`
(snap to the `slotStep` lattice, accept only a playable slot, otherwise
`undefined` — exactly today's "off the map" behaviour for rectangles);
`firstFreeBlock` becomes `firstFreeSlot` and reads the `slots` list; `squareOf`
returns `null` unless the square is covered by a slot; column labels extend past
Z for the 28-square board (`columnLabel(index)`: A…Z, AA, AB). `blockOrigin`,
`blockColumns` and `blockRows` are removed if nothing uses them any more.

**Client** (`packages/web/src/views/BoardView.tsx`, `styles.css`). Fog loops
over `board.slots` instead of every block: a slot without a tile is fogged, so
the hole and the outside are simply not drawn. Rectangular boards
(`slotStep === 4`) keep the single green mat and its outline; shaped boards get
one small mat per slot, with the grid background positioned so the lines line up
globally, because there is no rectangle to outline any more. The scroll surface
keeps its size from `boardWidth`/`boardHeight`, which now follow the shaped
bounding box.

**Saved games** (`packages/engine/src/migrate.ts`). A board saved before the
shape existed gains the full rectangle for its own `columns`/`rows` and the old
corner starts — a pure fit of the new required fields, no behaviour change for
one-, two- and four-player games.

**Tests.** Engine: shape and start tables for 2/3/4/5 players; snapping accepts
slots, rejects the hole and the outside; `firstFreeSlot` skips the hole;
`squareOf`/`locationOf` say nothing is on the map in the hole; an old rectangle
save gains the rectangle shape and keeps its pieces. Web: the board draws
exactly one fog per playable slot and none over the hole. Hidden information:
the board is entirely public — the new fields are geometry, and `PlayerView`
keeps sending the same board object, so there is nothing new to hide;
`hidden-info.test.ts` must keep passing untouched.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/src/create-game.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/src/actions/board.ts`
- `packages/engine/src/actions/draw.ts`
- `packages/engine/src/index.ts` (only if a new symbol needs exporting)
- `packages/engine/test/board-tiles.test.ts`
- `packages/engine/test/board.test.ts`
- `packages/engine/test/create-game.test.ts`
- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- `packages/web/src/styles.css`

Shared resources: none. `state.ts` (`PlayerView`) and `web/src/lib/api.ts` need
no edit — both carry `Board` through as a type, so the new fields ride along.

## Acceptance criteria

- [ ] Three players: board is the ten-slot pyramid, starts at the rulebook
      slots and rotations, no fog or grid outside the shape.
- [ ] Five players: board is the twenty-two-slot map with the hole, five starts
      around the edge, no fog, grid or snap target in the hole.
- [ ] A tile dropped over the hole or outside the shape does not snap into it;
      `squareOf` reports nothing on the map there.
- [ ] One-, two- and four-player boards are unchanged; existing tests keep
      passing and an old-save board gains the rectangle shape without moving a
      piece.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: no projection change; the board is already public and
      `hidden-info.test.ts` is untouched and passing.
- [ ] Verified in the browser: a three-player game shows the stepped fog, a
      five-player game shows the hole, both with starts in the right places;
      dragging a tile over the hole leaves it unsnapped.

## Open questions

None — all four were answered by the human before starting: clockwise starting
order; no shape migration (no such games exist); two- and four-player games
untouched; geometry-only handling of the hole.
