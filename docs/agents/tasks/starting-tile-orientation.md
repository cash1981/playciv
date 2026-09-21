# Starting tile orientation

- **Slug:** `starting-tile-orientation`
- **Branch:** `fix/starting-tile-orientation`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

When a civilization is revealed, its starting tile is laid in the player's
corner with the printed arrow pointing in towards the board, at every player
count. Today every starting tile points outward instead, so a four-player game
has all four corners facing the wrong way.

Second fix, asked for in the same breath: on the two-player board the two
starting tiles must sit in opposite corners — player 1 north-west (A1–D4) and
player 2 south-east (M5–P8) — not both along the top. Today player 2 takes the
top-right corner, which is right for three or more players but wrong for two.

The human's wording (4-player game, corners A1–D4 America, top-right Arabia,
bottom-right Spain, bottom-left Mongolia):

> De to øverste, altså A1 - A4 (America) burde vært snudd 180 grader med pil
> pekende innover mot brettet, Arabia har startet med pil på vest, men skulle
> vært nord, så den må snus, mongolia nederst til venstre må også snus, og
> spania må snus 180 grader.

Confirmed target (the human picked this of two candidates, and will verify in
the browser in place of the review gate):

| Player | Corner | Rotation today | Rotation after |
| --- | --- | --- | --- |
| 1 | top-left | 0° | **180°** |
| 2 | top-right | 90° | **180°** |
| 3 | bottom-right | 180° | **0°** |
| 4 | bottom-left | 270° | **0°** |

Both top tiles end pointing south, both bottom tiles pointing north — i.e. the
arrow points towards the horizontal middle of the board.

The human also sent a two-player screenshot and asked for the corners to be
opposite: player 1 north-west, player 2 south-east, with the arrows along the
long axis pointing at each other. The two-player board is 16 × 8 (two block
rows), so `startingCorner` reads that from the board, gives player 2 the
south-east corner (M5–P8) instead of the top-right, and turns the north-west
tile 90° (arrow east) and the south-east tile 270° (arrow west).

| Player | Corner | Rotation |
| --- | --- | --- |
| 1 | top-left (A1–D4) | 90° |
| 2 | bottom-right (M5–P8) | 270° |

## Why

The starting tile's arrow is the board's only cue for which way a civilization
expands. Laid the wrong way round every game, it misleads the table from setup.
The human asked whether this is a per-tile defect or a code defect; the answer
is code, and this change proves it by fixing all 16 civilizations at once.

## Reference

`old-civ-rest` and `old-civ-web` have no board and no tile orientation — the
old client only showed the civilization's picture, never a placed map tile. The
starting-tile placement is new client/engine behaviour, introduced in commit
`3092d92` ("Map-tiles på brettet med rotasjon og automatisk plassering"), whose
message states the intent: «Startbrettet legges i spillerens hjørne med pilen
inn mot midten». That intent is right; the assumption about the artwork that
encoded it is wrong.

The artwork is uniform: all 16 `packages/web/public/board/tiles/*` starting
tiles (and the physical tile photographed in `Civilization/Civs/america.jpg`)
carry the arrow on the bottom edge pointing up. `startingCorner` assumed it
points down, and its per-corner table compounded the error.

## Scope

**In:**

- Correct the per-corner rotation table in `startingCorner`.
- Correct the comment above it, which documents the wrong arrow direction.
- Give the two-player board opposite corners (player 2 south-east) instead of
  the top two.
- Update `packages/engine/test/board-tiles.test.ts` to assert the new values.
- Touch up the matching comment in `placeStartingTile`.

**Out:**

- Editing or re-exporting any tile image — the artwork is correct, the code is
  not, and changing the images would break `tools/board-assets.ps1`.
- Re-orienting tiles already placed in saved games. A stored rotation is
  player-owned state; affected games are pre-release and can be re-snapped with
  the existing rotate controls. Called out in `decisions.md`.
- A general "rotate a piece on placement" feature. Out of scope.

## Approach

`startingCorner(board, playernumber)` in `packages/engine/src/board.ts` builds
a four-element `corners` array `[top-left, top-right, bottom-right, bottom-left]`
with rotations `[0, 90, 180, 270]`. Change the rotations to `[180, 180, 0, 0]`
and rewrite the comment to say the arrow points up at 0°, so the top corners
turn 180° to point the arrow down and the bottom corners stay at 0° to point it
up.

`revealItem` in `packages/engine/src/actions/player.ts` already consumes
`corner.rotation` unchanged, so nothing else moves.

For the two-player diagonal, `startingCorner` needs the player count. It does
not take one, and the board already encodes it: the two-player board is 16 × 8
(two block rows) while three or more players use the full 16 × 16. When
`blockRows(board) === 2` the function returns only the two corners the players
use — north-west then south-east — with rotations 90° and 270° so the arrows run
along the long axis at each other. Every bigger board keeps the four corners in
clockwise order with rotations 180/180/0/0. The test file asserts the four
values, the player-1 reveal, and the two-player corners, all of which change.

## Claimed paths

- `packages/engine/src/board.ts` (`startingCorner` and its comment only)
- `packages/engine/test/board-tiles.test.ts`
- `docs/agents/tasks/starting-tile-orientation.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] All four corners return the arrow-inwards rotation (180/180/0/0).
- [ ] A two-player board puts player 1 top-left (90°) and player 2 bottom-right
      (270°), arrows along the long axis.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not touched — no projection changes, no new
      projection test needed.
- [ ] Verified in the browser: a live 4-player game with all four civilizations
      revealed, and a live 2-player game with both revealed; screenshots shown to
      the human.
- [ ] `decisions.md` records that saved games are not re-oriented.

## Open questions

_None._ The human confirmed the target orientation directly.
