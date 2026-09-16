# Anonymous read-only access

- **Slug:** `anonymous-readonly`
- **Branch:** `feat/anonymous-readonly`
- **Owner:** unclaimed
- **Status:** ready — **depends on `public-landing`**

## Goal

Anyone can open a game and watch it without an account: the board, the culture
track, the player areas, the public log, published turn orders, revealed items.
They can change nothing. Only the players in a game may move pieces or act.

## Why

The human asked for it, and set the boundary in the same breath:

> "Men skal være mulig å gå inn og se på alle spille uten å være innlogget og da
> skal det ikke være mulig å gjøre noe."
>
> "Husk at spillet må være sikkert. Det er kun den innloggede spilleren som kan
> se sine private ting. Det er kun spillerne som kan dra rundt på brettet."

When asked what "see everything" covers, they answered: "De skal kunne se alt,
bare ikke gjøre noe. Readonly på alt."

**Read that as everything that is public.** It cannot mean hands and private
logs, because the same message demands those stay private. A spectator sees
exactly what a non-participant sees today — `toPlayerView(state, <nobody>)` —
and no buttons.

## Scope

**In:**

- A public game endpoint returning the spectator projection.
- The client renders a game with no token, read-only.
- Board interaction gated on being a player in *that* game, enforced on the
  server, not only hidden in the UI.
- A security pass over every route: who may read it, who may write it.

**Out:**

- Accounts, roles, permissions beyond "player in this game".
- Rate limiting and abuse prevention. Worth doing, not this task.

## Reference

None — Java required authentication everywhere. This is new, so the rules come
from the human's message above and nowhere else.

Existing machinery to build on:

- `toPlayerView(state, viewerId)` already handles a viewer who is not in the
  game: `you` is null, opponents are counts, other people's log entries come
  through `toPublicLog`. Covered by "an onlooker who is not in the game sees no
  hand" in `packages/engine/test/hidden-info.test.ts`.
- `hasUserAccess(state, playerId)` is the existing membership check. Board
  reducers already call it through `requireAccess`.

## Approach

The projection is already right for a spectator, so the work is in the server
and the client, not the engine.

**Server.** A public game route with no `auth` that calls
`toPlayerView(state, '')`. Every mutating route keeps `auth` **and** the
membership check. Go through `routes/` and confirm each one — `board.ts` in
particular, since "everyone may move everything" was written when everyone
meant every player.

**Client.** The game page must work with no token: hide every action, show a
sign-in prompt, make the board non-draggable. Hiding is presentation; the
server refusal is the security.

## Claimed paths

- `packages/server/src/routes/public.ts`
- `packages/server/src/routes/board.ts`
- `packages/server/src/routes/games.ts`
- `packages/server/src/context.ts`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/BoardView.tsx`
- `packages/web/src/lib/api.ts` — **shared, claim it explicitly**

## Acceptance criteria

- [ ] A game page loads with no token and renders board, track, areas, public
      log and published turn orders.
- [ ] With no token the response contains no hand, no private log, no
      unrevealed tech, no unrevealed item, and no email address.
- [ ] Every mutating route returns 401 without a token and 403 for a token
      belonging to someone not in that game. **One test per mutating route** —
      a table-driven test over the route list, so a new route that forgets the
      check fails the suite.
- [ ] Dragging, undo, clear and rotate are unavailable and unreachable without
      being a player in that game.
- [ ] A signed-in player in game A cannot move a piece in game B.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser in a private window with no session.

## Open questions

- Should a spectator see the *board history* list, which names who moved what?
  It leaks no card contents, so probably yes. Confirm with the human.
- Should finished games be public for ever, or only active ones? Assume all,
  which is what the landing page already lists.
