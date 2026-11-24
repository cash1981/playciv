# Reposition a built figure; movement overlay only in Movement

- **Slug:** `reposition-built-figure` · **Branch:** `fix/reposition-built-figure` · **Owner:** Claude (orchestrator) · **Status:** in progress

## Goal

The human, testing Build in City Management: "If I regret where the figure was placed I must press
Undo, which is aggressive", and the green movement-range overlay already shows after a Build, "but
figures only move by movement in the Movement phase".

1. A figure (army or scout) that a Build placed this turn can be put on another legal build square
   of the same city while that City Management is still open, without Undo, paying or refunding.
2. The movement-range overlay on the board shows only while the viewer's current phase is Movement.

## Scope

**In:** a new engine action `repositionBuiltFigure` plus the legal squares in the own `PlayerView`;
a board route; a "Place here" overlay in the web board for such a figure; the overlay phase gate.

**Out:** buildings, wonders, units and walls (not movable figures); a phase check inside the
`travel` route (the human asked for the overlay only).

## Reference

`openBuildOf` / `takeBackOpenBuild` in `assisted.ts` (the same "open build" boundary: applied build,
owner, current turn, City Management not marked done). `buildSquareRefusal` and `figureCellsOf` in
`build-options.ts` (the placement rules). `isAssistedBoardChange` in `actions/board.ts`: a build's
board entries are sealed against the board Undo, so only the build's undo vote removes the figure.
No new FFG rule: the rules of the original placement are reused.

## Approach

- `engine/src/build-reposition.ts`: finds the open build record of a figure; refuses when the
  figure is not on its recorded square or has travelled (`movement` set); checks the target with the
  build's own square rules on a board without the figure; moves the figure with a board history entry
  and rewrites the record's `square`/`position` so the build's undo still finds the figure. Logs a
  public line. `repositionableFiguresOf` feeds `you.repositionableFigures` (own view only).
- `build-options.ts`: one appended export, `figureSquaresFor`.
- Server: `POST /api/games/:gameId/board/pieces/:pieceId/reposition`.
- Web: BoardView takes `repositionOptions`; GameView passes them. Overlay gated on phase.

## Claimed paths

- `packages/engine/src/build-reposition.ts`, `packages/engine/src/build-options.ts` (append only),
  `packages/engine/src/state.ts` (own view field), `packages/engine/src/index.ts`
- `packages/server/src/routes/board.ts`
- `packages/web/src/views/BoardView.tsx`, `packages/web/src/views/GameView.tsx`, `packages/web/src/lib/api.ts`
- tests in the three packages, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Reposition works in the open City Management, refused afterwards, for a travelled figure, for
      another player's figure, for an illegal or full square, for a unit/building piece
- [ ] Undo of the build after a reposition removes the figure from its new square, refund intact
- [ ] Board Undo after a reposition does not bring the figure back to the old square
- [ ] Overlay absent outside Movement, unchanged in Movement
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: the new view field lists only public board facts, own view only; test
- [ ] Browser check
