# Add disasters to the board pieces palette

- **Slug:** `disasters`
- **Branch:** `feat/disasters`
- **Owner:** Codex
- **Status:** done

## Goal

Players can find the four disaster markers in the board's Pieces palette and drag them onto the board like other pieces.

## Why

The moderator artwork already exists in `Moderator/disasters`, but disasters are absent from the generated board asset manifest and UI.

## Scope

**In:**

- Generate and include the four disaster images and manifest entries.
- Add a Disasters category in the Pieces palette.
- Render and drag the assets using the existing generic board-piece behavior.

**Out:**

- Disaster rules or effects; this request is only about placing their artwork on the board.
- New supply limits; disasters are not buildings in the engine's supply accounting.

## Reference

The assets are `drought.png`, `forest.png`, `grassland.png`, and `water.png` in the local `Moderator/disasters` reference folder. Generic board placement already handles any asset in the manifest; category-specific rules only apply to explicitly listed kinds such as buildings and relics.

## Approach

Add a `disaster` asset category, map `Moderator/disasters` in `tools/board-assets.ps1`, size the markers to fit a board square, and add the category label/order to `BoardView.tsx`. Generate the manifest and web artwork from the local reference folder.

## Claimed paths

- `tools/board-assets.ps1`
- `packages/engine/src/board.ts`
- `packages/engine/data/board-assets.json`
- `packages/web/src/views/BoardView.tsx`
- `packages/engine/test/board.test.ts`
- `packages/web/src/views/BoardView.test.tsx`
- `packages/web/public/board/disasters/`
- `docs/agents/tasks/disasters.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`
- `docs/agents/decisions.md`

## Acceptance criteria

- [x] All four disasters appear in a Disasters category under Pieces.
- [x] Palette and generic placement behavior are covered by the view tests.
- [x] No hidden information or game-rule behavior is added.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser-verified in the Pieces palette and on the board. (Local app had no game in its store; see `decisions.md`.)

## Open questions

None.
