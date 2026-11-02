# Zheng He follow-up: choose among every hut and village piece on the board

- **Slug:** `zheng-he-all-tokens` · **Branch:** `wt/zheng-he-all`, pushed to `feat/zheng-he` (PR #330) · **Owner:** Claude Code (Sonnet 5.5) · **Status:** in progress

## Goal

The human found "A token already taken off the map" confusing: "Do you have to have the choice 'A token I already moved'? Cannot you just locate all the hut / village markers?"

## Scope

**In:** the Draw Hut/Village picker lists every hut or village piece on the board: a map square by its label, a piece elsewhere (a player's area) by that area ("cash1981's area"). Choosing one gives the item under it and the piece stays. The "already taken off" button goes. `notFromToken` is dropped: a draw with no `fromPieceId` never gives an item under a piece that is still on the board, and gives the item of a piece that was deleted from the board. The public line says "from the token on J6" or "from a token in <player>'s area".

**Out:** Zheng He's look itself still reads map squares only (the card says "on the map").

## Claimed paths

`packages/engine/src/zheng-he.ts`, `actions/draw.ts`, `index.ts`; `packages/server/src/routes/play.ts`; `packages/web/src/lib/api.ts`, `views/GameView.tsx`; tests; docs.

## Acceptance criteria

- [ ] A bound piece moved into an area is listed and gives its item; a deleted piece's item is released by a plain draw.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass; browser check of the picker.
