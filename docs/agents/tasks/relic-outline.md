# Relic outline

- **Slug:** `relic-outline`
- **Branch:** `feat/relic-outline`
- **Owner:** Claude (orchestrator)
- **Status:** in review

## Goal

A relic marker on the board can be seen at a glance. Today the art is dark and
blue and disappears against the sea.

## Why

The human, after PR #228: "It is impossible to see that the relics are there.
Is there a way to easily give them a white border or something?" On the colour:
"Let's just use white, and it can turn yellow like the others when you click
it" — yellow is the selected-piece outline, so the relic frame must not be
yellow and must give way to the accent outline when selected.

## Scope

**In:**

- A `board-piece-relic` class on pieces whose category is `relic`.
- A white outline for that class in `packages/web/src/styles.css`, plus a thin
  dark ring so it also reads on snow and other light tiles.
- A selected relic shows the normal accent outline, as every other piece does.

**Out:**

- Other piece categories. Only relics, as asked.
- Changing the PNGs or `board-assets.json`. A CSS frame scales with zoom and
  needs no asset rebuild.
- Changing relic sizes.

## Reference

None; this is a presentation change with no counterpart in the old system.

## Approach

CSS class chosen in `BoardView.tsx`, rule in `styles.css` declared before
`.board-piece.selected` so the selected outline wins at equal specificity.

## Claimed paths

- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/views/BoardView.test.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [x] Relic pieces carry `board-piece-relic`; other pieces do not.
- [x] A selected relic falls back to the accent outline (rule order in CSS).
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
