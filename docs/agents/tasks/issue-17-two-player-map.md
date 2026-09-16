# Use the two-player map size

- **Slug:** `issue-17-two-player-map`
- **Branch:** `fix/issue-17-two-player-map`
- **Owner:** Luna
- **Status:** in progress

## Goal

A two-player game displays an 8 by 8 board labelled A–H and 1–8 instead of the
four-player 16 by 16 map.

## Why

Issue #17 requests the smaller two-player map.

## Scope

**In:** Select board geometry when creating a game and cover it with tests.

**Out:** Existing board editing/replay behavior and other player counts.

## Reference

`createGame` currently always calls `createBoard()`; board geometry is defined
in `packages/engine/src/board.ts`.

## Approach

Create an 8x8 board for `numOfPlayers === 2`, retain the 16x16 default for all
other supported counts, and verify dimensions/labels through engine tests.

## Claimed paths

- `packages/engine/src/create-game.ts`
- `packages/engine/test/game-action.test.ts`

## Acceptance criteria

- [ ] Two-player games have 8 columns and 8 rows.
- [ ] Two-player labels stop at H and 8.
- [ ] Other game sizes retain the existing 16x16 board.
- [ ] Full typecheck, test, and build pass.

## Open questions

None.
