# Keep the game URL when opening a game

- **Slug:** `issue-15-game-url`
- **Branch:** `fix/issue-15-game-url`
- **Owner:** Luna
- **Status:** in progress

## Goal

Opening or joining a game changes the browser URL to `/game/<gameid>`, and
refreshing that URL returns to the same game after authentication.

## Why

Issue #15 requests a refreshable game URL so the game view does not lose state.

## Scope

**In:** Add minimal history/path handling to the existing React screen state and
ensure lobby game openings use it.

**Out:** No router dependency, server route changes, or authentication changes.

## Reference

The screen union and lobby callback live in `packages/web/src/App.tsx` and
`packages/web/src/views/LobbyView.tsx`.

## Approach

Parse `/game/<id>` on initial load, use `history.pushState` when opening a game,
and handle browser back/popstate so the URL and screen stay synchronized.

## Claimed paths

- `packages/web/src/App.tsx`
- `packages/web/src/views/LobbyView.tsx`

## Acceptance criteria

- [ ] Joining/opening a game results in `/game/<gameid>`.
- [ ] Refreshing `/game/<gameid>` selects that game view.
- [ ] Back to games returns to the lobby URL.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

None.
