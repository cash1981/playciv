# Public landing page

- **Slug:** `public-landing`
- **Branch:** `feat/issue-38-public-landing`
- **Owner:** Codex (GPT-5)
- **Status:** done — review gate approved; ready for human merge

## Goal

A front page anyone can open without an account: every active game, the
highscore tables, and an open chat. Signing in is what lets you create a game,
join one, or post.

## Why

The human asked for it:

> "Jeg ønsker en startside der det vises alle aktive spill, med highscore
> visning akkurat sånn som jeg hadde det, og en åpen chat. Så kan man logge inn
> for å lage spill, joine og chatte."

Highscore was deferred during the port because the JSON store cannot query
across games. It can be computed by reading every game, which is fine at this
scale.

## Scope

**In:**

- Landing page: active and finished games, highscore, lobby chat.
- Highscore in the engine, computed from finished games.
- Public endpoints for the game list, the highscore and reading lobby chat.
- Signed out: everything is read-only, with sign-in prompts where the actions
  would be.

**Out:**

- The read-only *game* view for anonymous visitors — that is
  `anonymous-readonly`, and it depends on this landing page existing.
- Tournaments. Still deferred.
- Pagination and sorting controls. The old client used `ng-table`; a plain
  sorted table is enough.

## Reference

`old-civ-rest/src/main/java/no/asgari/civilization/server/action/GameAction.java`
— `getPlayerHighScore` and `getCivHighscore`. The DTOs are in `dto/`:
`PlayerHighscoreDTO`, `CivHighscoreDTO`, `WinnerDTO`, `CivWinnerDTO`.

What Java computed:

- Only games that are **finished** and have a **winner** count.
- `WinnerDTO` is `{ username, totalWins, attempts, percentWin }`.
  `percentWin` is `totalWins / attempts * 100`, rounded to two decimals, with a
  trailing `" %"`. Zero wins or zero attempts gives the string `"0 %"`.
- Sorted by `totalWins`, then username. `WinnerDTO.compareTo` compares wins
  first, then `username.compareTo` — which is UTF-16 order, not locale order.
  Use `compareJavaStrings` from `packages/engine/src/turn.ts`.
- Broken down by player count: a total, then 2, 3, 4 and 5 player games
  separately. Plus the totals `totalNumberOfPlayers` and `totalNumberOfGames`.
- The same again by civilization rather than by player.

The old view is `old-civ-web/app/views/highscore.html`: two tabs, "Player
highscore" and "Civilization highscore", each with sub-tabs for total / 2 / 3 /
4 / 5 players.

## Approach

**Engine.** A pure `highscore(games)` over an array of finished `GameState`s,
returning the two DTO shapes. Pure input to pure output, so it tests cleanly
against hand-built games.

**Server.** `GET /api/highscore` and `GET /api/public/games`, both without
`auth`. Reading lobby chat becomes public; posting stays authenticated.

Be careful: the existing game list returns a summary shaped for a logged-in
viewer. The public one must not carry anything viewer-specific.

**Client.** A landing route shown when signed out, and reachable when signed
in. Reuse the existing chat component in read-only mode.

## Claimed paths

- `packages/engine/src/highscore.ts` (new)
- `packages/engine/test/highscore.test.ts` (new)
- `packages/engine/src/index.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/src/routes/public.ts` (new)
- `packages/web/src/views/LandingView.tsx` (new)
- `packages/web/src/views/HighscoreView.tsx` (new)
- `packages/web/src/App.tsx`
- `packages/web/src/lib/api.ts` — **shared, claim it explicitly**
- `packages/web/src/styles.css`

## Acceptance criteria

- [x] The landing page loads with no token and shows games, highscore and chat.
- [x] Highscore matches Java: only finished games with a winner; `percentWin`
      formatted the same way, including `"0 %"`; ties broken by UTF-16 username
      order.
- [x] Both breakdowns are present: by player and by civilization, each split by
      player count.
- [x] A signed-out visitor sees no button that would fail, and no private data
      anywhere in the payloads.
- [x] A test builds finished games by hand and pins the computed table.
- [x] A server test calls the public endpoints **with no Authorization header**
      and asserts 200, then asserts no hand, private log or unrevealed item
      appears in the body.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.

## Open questions

- Lobby chat currently has no retention or rate limit. An open chat that anyone
  can read and any account can post to is a small abuse surface. Worth raising
  with the human, but not a blocker.
