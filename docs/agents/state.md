# State

Where the project stands. Read this first; it is here so you do not have to
read the codebase to find out what is done.

Keep it short. One line per finished thing. Detail that is worth keeping goes
in `decisions.md`; detail that is not goes nowhere.

_Last updated: 2026-09-15_

## Health

| Check | Status |
| --- | --- |
| `pnpm -r typecheck` | passing |
| `pnpm -r test` | passing — 280 engine, 37 server |
| `pnpm -r build` | passing |
| `main` pushed to `origin` | yes |

## Done

- **The port itself.** Deck, items, draws, reshuffle, hands, techs, social
  policy, trade, turns, undo voting, chat, game lifecycle. Every Java action
  class has a counterpart and a test file naming it.
- **Server.** Fastify over the engine, scrypt passwords, HMAC bearer tokens,
  JSON-file repository standing in for MongoDB.
- **Client.** React and Vite: login, game list, game page, hand, draws, battle,
  techs, turn orders, log, undo votes, chat.
- **Board.** 16 × 16 map from the PowerPoint template, free pixel placement,
  stacking by array order, seven palette categories, map tiles that place
  themselves, starting tiles in the right corner with the arrow inwards.
- **Player areas.** A band below the map, one per player, pieces tidy into rows.
- **Board history.** Every change recorded as a semantic operation, giving exact
  undo and step-by-step replay with the log trimmed to each step.
- **Everything in English.**
- **Culture track.** A band above the map, 27 spaces in four sections, measured
  off the artwork. Leader markers snap to a space and step aside rather than
  cover each other. Choosing a civilization places that leader on Start.
- **Card artwork.** 346 of 347 items have a picture; only Space Flight does
  not, because it is added in code rather than read from the spreadsheet. The
  hand renders as cards.

## In progress

_Nothing. See the queue on the task board._

## Next, in order

1. **`tech-tree`** — the pyramid view from the AngularJS app, private and
   public versions.
2. **`public-landing`** — a landing page with active games, highscore and an
   open chat.
3. **`anonymous-readonly`** — browse everything public without an account, and
   the security pass that goes with it.

## Known problems and loose ends

- **`gh` is not installed**, so pull requests are opened through the compare
  link rather than the CLI. SSH push works.
- **Space Flight has no artwork.** Nothing to fix; there is no such card.
- **Card images are large** — up to 1 MB each, straight from the old client.
  Fine locally, wasteful over a network. Nobody has decided to optimise them.
- **Authentication is development grade.** scrypt and signed bearer tokens that
  cannot be revoked before they expire. Better than the Java original's
  unsalted SHA-1 over HTTP Basic, not reviewed for production.
- **FFG artwork is committed to a public repository.** The human decided this
  deliberately; see `decisions.md`.
- **Browser screenshots in the Claude preview pane fail** when the window is in
  the background. DOM inspection through `javascript_tool` works and is the
  reliable way to verify the client.

## Deferred on purpose

Real MongoDB · highscore and tournament queries across games · email
notification · `AdminAction` · websockets for live updates.
