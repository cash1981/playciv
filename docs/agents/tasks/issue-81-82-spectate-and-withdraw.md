# Spectate without an account, and withdraw without breaking the page

- **Slug:** `issue-81-82-spectate-and-withdraw`
- **Branch:** `feat/issue-81-82-spectate-and-withdraw`
- **Owner:** Claude (Sonnet 5)
- **Status:** done

## Goal

Two related fixes. First, withdrawing from a game takes the player back to the
games list instead of leaving them on a page that immediately errors. Second,
anyone — including someone with no account — can open a game from the list
and watch it, the same read-only way a signed-in non-member already could in
places the code half-supported.

## Why

The human, verbatim:

> Bug: When user withdraws from game, you should be moved to the main page.
> Now you get error message "User is not player of this game", but logs say
> you have withdrawn.
>
> Another bug is issue 81, there is no link to view the games if you are not a
> player. I would like the game names to have a href link to be able to enter
> it and view instead of pushing the open button. I guess we can have both.

Issue #81 on GitHub: "When you are not one of the players of a game, there is
no way to enter a game in readonly mode to see it. It should be able to watch
without logging in." Issue #82 filed for the withdraw bug during this session.

## Scope

**In:**

- After a successful withdraw, the client navigates back to the games list
  instead of trying to reload a game it can no longer act on.
- `GET /api/games/:gameId`, `/revisions`, `/revisions/:revision`, `/revealed`,
  `/log/public`, `/log/private`, `/techs/available`, `/techs/revealed`,
  `/socialpolicies`, `/turns/public`, `/turns/mine`, `/undo/pending`,
  `/undo/mine`, and `/api/board/assets` accept an absent or non-member bearer
  token instead of requiring membership or a token at all.
- `App.tsx` renders the game screen for a signed-out visitor too, instead of
  showing only the lobby.
- `GameView` accepts `player: PlayerDto | null`, and hides the write controls
  (End turn, Take the turn, Withdraw, Delete game, Chat) when the viewer is
  not a player in the game (`you === null`), rather than disabling them or
  crashing.
- The game list (`LandingView`) makes the game's name itself an `<a href>` to
  `/game/:id`, alongside the existing Open/Join buttons, so a game can be
  opened in read-only mode (ctrl/cmd-click, middle-click, "open in new tab")
  regardless of membership or active/ended state.

**Out:**

- Per-game chat for a fully anonymous spectator. `ChatPanel` still requires a
  signed-in `player`; a spectator with no account simply does not see it. A
  signed-in non-member already could, unchanged.
- `GET /api/games/:gameId/chat` and `/state` stay membership-agnostic but
  still require *some* account (unchanged) — not part of what was asked, and
  chat is not itself a game-rules concern.
- Hiding board-editing controls (drag pieces, draw, etc.) for a non-member
  viewer beyond the top action row. Those calls already fail safely server
  side with `NO_ACCESS`; only the four most visible action buttons were
  changed. A full read-only board UI is a larger follow-up if wanted.

## Reference

Both are new, client-side/server-plumbing behaviour with no old-system
counterpart — `old-civ-web` had no anonymous viewing and no SPA navigation
guard to race with. The hidden-information projection this leans on
(`toPlayerView`, `opaque()`) already existed and was already proven safe for
a non-member viewer by `test/hidden-info.test.ts` and the existing "the
projection treats a non-member the same as an opponent" pattern in
`api.test.ts`; this task only removes the membership *gate* in front of it,
it does not change what the projection reveals.

## Approach

- `packages/server/src/context.ts`: new `authenticateOptionallyWith` — sets
  `c.get('player')` when a valid bearer token is present, otherwise runs the
  route anyway. `createGameRevision`'s `actor` parameter narrowed to
  `Pick<StoredPlayer, 'id' | 'username'>` so a spectator (no `StoredPlayer`)
  can still be passed a placeholder actor for the revision-baseline write.
- `packages/server/src/routes/games.ts`: the routes listed above switch from
  `authenticateWith` to the new optional middleware; the two revisions routes
  drop `requireMembership` and use `c.get('player')?.id ?? ''` as the viewer
  id, with a `SPECTATOR` placeholder actor for baseline creation.
- `packages/server/src/routes/play.ts` and `routes/board.ts`: same swap for
  their read-only routes. `undo/pending` and `undo/mine` answer `[]` for a
  spectator rather than using a non-existent `currentPlayer(c)`.
- `packages/web/src/App.tsx`: the `game` screen is rendered before the
  `player === null` branch, so it works whether or not anyone is signed in.
- `packages/web/src/views/GameView.tsx`: `player` is now `PlayerDto | null`;
  the withdraw button calls the API directly (not through the `run` helper,
  to avoid an extra reload right before navigating away) and calls the new
  `onWithdrawn` prop on success; `onWithdrawn`/`onDeleted` are wired to
  `backToGames` in `App.tsx`.
- `packages/web/src/views/LandingView.tsx`: game name wrapped in an `<a>`
  with a real `href`, `preventDefault`-ing a plain left-click to keep SPA
  navigation, letting a modified click or "open in new tab" behave normally.

## Claimed paths

- `packages/server/src/context.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/src/routes/play.ts`
- `packages/server/src/routes/board.ts`
- `packages/server/test/api.test.ts`
- `packages/web/src/App.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/LandingView.tsx`

## Acceptance criteria

- [x] Withdrawing as a non-creator member navigates back to the games list;
      the game page no longer shows "User is not player of this game" for a
      withdrawn or non-member viewer.
- [x] A signed-out visitor can open any game from the list (active or ended)
      and see the board, log, techs, turn orders and status board read-only.
- [x] The four write-only action buttons (End turn, Take the turn, Withdraw,
      Delete game) are hidden, not just disabled, for a non-member viewer.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: unchanged projection, re-asserted by the rewritten
      end of "authorizes against current membership and projects each
      historical viewer separately" (now also covers an anonymous read) and
      the new "lets an anonymous visitor read a game and its history, but not
      act on it" / "lets a withdrawn player keep viewing the game, read-only"
      tests in `packages/server/test/api.test.ts`.
- [x] Verified in the browser: registered two accounts, joined a real game as
      the non-creator, withdrew, and confirmed the game becomes a read-only
      "Watching (not a player)" view with no error, and that an incognito
      (no-token) request to the same game's read routes returns 200 with
      `you: null`. Confirmed the game name in the lobby list renders as a
      real `<a href="/game/:id">`.

## Open questions

None — the two behaviours were specified directly by the human in chat, and
issue #81's "watch without logging in" is unambiguous once the existing
non-member projection was confirmed already safe.
