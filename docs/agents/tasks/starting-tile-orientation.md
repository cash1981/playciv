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
- Update `packages/engine/test/board-tiles.test.ts` to assert the new values.

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
`corner.rotation` unchanged, so nothing else moves. The test file asserts the
four values and the player-1 reveal, both of which flip.

## Claimed paths

- `packages/engine/src/board.ts` (`startingCorner` and its comment only)
- `packages/engine/test/board-tiles.test.ts`
- `docs/agents/tasks/starting-tile-orientation.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] All four corners return the arrow-inwards rotation (180/180/0/0).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not touched — no projection changes, no new
      projection test needed.
- [ ] Verified in the browser: a live 4-player game, all four civilizations
      revealed, all four starting tiles pointing inward; screenshot shown to the
      human.
- [ ] `decisions.md` records that saved games are not re-oriented.

## Open questions

_None._ The human confirmed the target orientation directly.
