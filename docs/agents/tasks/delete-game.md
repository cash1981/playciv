# Delete a game

- **Slug:** `delete-game`
- **Branch:** `feat/delete-game`
- **Owner:** Luna
- **Status:** in progress

## Goal

The game creator or the `admin` account can permanently delete a game from the
game list; other players cannot.

## Why

The human requested deletion instead of ending a game when a game should be
removed completely.

## Scope

**In:** Add an authenticated delete-game route using the repository deletion
operation, client API method, and a UI Delete game action that returns to the
lobby after success.

**Out:** Changing the existing end-game semantics or highscore retention.

## Reference

`endGame` already authorizes the game creator or username `admin`; the new
delete route must apply the same authorization rule before `repo.deleteGame`.

## Approach

Check the stored game's `gameCreator` player or the authenticated username
`admin`, return 403 otherwise, delete through `Repository.deleteGame`, and add
creator/admin UI handling in `GameView` plus navigation callback in `App`.

## Claimed paths

- `packages/server/src/routes/games.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/lib/api.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/App.tsx`

## Acceptance criteria

- [ ] Creator can delete active or ended games.
- [ ] Username `admin` can delete any game.
- [ ] A non-creator/non-admin receives 403 and the game remains.
- [ ] UI exposes Delete game only to creator/admin and returns to lobby.
- [ ] Full typecheck, tests, and build pass.

## Open questions

None; the existing `admin` convention is used.
