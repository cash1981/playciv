# Game UI bug fixes and responsive panels

- **Slug:** `game-ui-bugfixes`
- **Branch:** `feat/mongodb-storage`
- **Owner:** Luna
- **Status:** in progress

## Goal

Players can finish turns reliably, inspect a correctly laid-out board and tech
tree, read a reverse chronological timestamped log, and collapse secondary
panels so the game page remains usable at the current viewport size.

## Why

The human reported a second player being visible while ending the first turn
fails with "Could not find player", the log lacks timestamps and is oldest
first, the tech tree overlaps turn orders, panels cannot be collapsed, and an
Arabia starting tile is offset by one pixel/square boundary.

## Scope

**In:**

- Investigate and fix the end-turn player lookup on the MongoDB-backed path.
- Add `dd.MM.yyyy hh:mm:ss` display timestamps and newest-first ordering to log views.
- Make the tech tree float within its panel/layout without overlapping turn orders.
- Add clickable collapsible sections for draw, hand, battle, tech, turns,
  opponents, and log panels, preserving useful open/closed state.
- Correct starting-tile placement/alignment while preserving the board geometry
  from the template.
- Add focused regression tests and use the old Angular client as presentation
  reference; do not invent game rules or expose private data.

**Out:**

- New MongoDB schema or authentication model.
- A new canvas/hex-board implementation.

## Reference

- `old-civ-rest` is authoritative for turn behaviour and projections.
- `old-civ-web` is the presentation reference for logs, collapsible panels and
  the tech pyramid.
- `packages/engine/src/board.ts` defines the current board geometry.

## Approach

Keep engine changes pure and limited to geometry/projection fixes if needed.
Keep formatting and panel state in the web layer. Fix request identity or
Mongo player mapping at the server boundary if the failing end-turn path is
caused by stored player identifiers. Add tests at the narrowest layer that
proves each regression and retain hidden-information assertions.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/src/state.ts`
- `packages/engine/test/`
- `packages/server/src/routes/`
- `packages/server/src/store/`
- `packages/server/test/`
- `packages/web/src/views/`
- `packages/web/src/styles.css`
- `packages/web/test/`

## Acceptance criteria

- [ ] A second joined player remains addressable and the current player can end
      a turn on the MongoDB-backed path.
- [ ] Logs display `dd.MM.yyyy hh:mm:ss` and newest entries appear first.
- [ ] The tech tree remains entirely visible and does not overlap turn orders.
- [ ] The main game sections are independently clickable/collapsible.
- [ ] Arabia and other starting tiles align with the intended 4x4 grid origin.
- [ ] Private hands and unrevealed information remain private, with tests.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser verification covers the reported failures and responsive layout.

## Open questions

None. Preserve existing behaviour where the old Java/client is explicit.
