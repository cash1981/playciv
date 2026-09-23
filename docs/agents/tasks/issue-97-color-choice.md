# Issue #97: choose player colors

- **Slug:** `issue-97-color-choice`
- **Branch:** `feat/issue-97-color-choice`
- **Owner:** Codex
- **Status:** in progress

## Goal

Players choose one of the five board colors when creating a game and when joining an open game. A chosen color is shown before submission and survives in the new player's game state.

## Why

GitHub issue #97: “Let players choose colors when they create and join game”. The API already accepts a `color` field, but the client never sends it and the engine does not validate it.

## Scope

**In:** A color selector in the active landing page's create and join flows; public availability information; engine validation of supported, untaken colors; tests for the visible flows and rejected requests.

**Out:** Changing a seated player's color. A replacement player inherits the withdrawn player's hand and its existing color, preserving the old system's takeover behavior and board state.

## Reference

The old client's `old-civ-web/app/views/list.html` create form has a required color picker with Blue, Red, Purple, Yellow and Green. `GameService.js` sends that color on create but joins without a color. Java `GameAction.joinGame` accepts the creator's requested color, assigns a free color to a fresh join, and keeps the withdrawn hand (including its color) for a replacement. This issue extends the join UI beyond the old client, while preserving takeover behavior.

## Approach

Use the existing `PLAYER_COLORS` as the engine authority. Expose the selectable colors with the public game summary, using the withdrawn hand's retained color for a replacement seat. The client sends the selected color in the existing create and join request bodies. Validate requests in the engine so stale lists or direct API calls cannot duplicate or invent colors. Keep color state out of private projections.

## Claimed paths

- `packages/engine/src/actions/game.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/test/game-action.test.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/src/errors.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/LandingView.tsx`
- `packages/web/src/views/GameList.tsx`
- `packages/web/src/views/GameList.test.tsx`
- `packages/web/src/views/LandingView.test.tsx`

## Acceptance criteria

- [ ] Creating a game lets the creator choose any of the five colors and stores it.
- [ ] Joining shows only colors actually available for that seat and stores the chosen one.
- [ ] A replacement inherits the withdrawn hand's color; a different requested color is rejected.
- [ ] Invalid or already occupied colors are rejected without persisting a game change.
- [ ] Existing requests without a color retain automatic assignment for compatibility.
- [ ] The public summary exposes no private hand information; tests cover its color choices.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser check of create and join selectors when a local browser is available.

## Open questions

None. The issue and old code establish the five colors; takeover must retain its existing color to preserve the hand and board pieces.
