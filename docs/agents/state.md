# State

Where the project stands. Read this first; it is here so you do not have to
read the codebase to find out what is done.

Keep it short. One line per finished thing. Detail that is worth keeping goes
in `decisions.md`; detail that is not goes nowhere.

_Last updated: 2026-09-17_

## Health

| Check | Status |
| --- | --- |
| `pnpm -r typecheck` | passing |
| `pnpm -r test` | passing — 310 engine, 62 server (on `feat/issue-20-theme-switch`) |
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
  cover each other. Choosing a civilization places that leader on Start. The
  band is drawn `CULTURE_TRACK_SCALE` (1.7×) taller than its bare aspect so it
  reads well at any zoom (issue #22).
- **Card artwork.** 346 of 347 items have a picture; only Space Flight does
  not, because it is added in code rather than read from the spreadsheet. The
  hand renders as cards.
- **MongoDB storage.** `MongoRepository` runs against the restored `playciv`
  database, chosen by `MONGO_URL` with the JSON file as fallback. Reuses the
  `player` and `chat` collections, reads old `pbf` games for highscore, stores
  new games in `game_state`. Old SHA-1 logins verify and upgrade to scrypt.
  `GET /api/highscore` ports Java's highscore. Verified against the live
  database (Andrius 39/68, cash 36/58; legacy login upgrades end-to-end).
- **Highscore UI.** A public `/highscore` page (branch `feat/highscore-page`)
  porting `old-civ-web`'s: two-level Player/Civilization tabs over Total and
  2/3/4/5-player sub-tabs, sortable and paginated (10/page, default `totalWins`
  desc), reading `GET /api/highscore`. See `tasks/highscore-page.md`.
- **Tech tree.** The AngularJS pyramid, private and public: your own techs
  (hidden ones badged) and one public pyramid per player from
  `revealedTechsForAllPlayers`. Verified in the browser; the hidden-info test
  is proven load-bearing.
- **Issue #13.** Hidden technologies retain their yellow border without the
  cropped "only you" badge in the tech pyramid.
- **Issue #14.** The destructive "Clear board" action is gone end to end: the
  UI control, the `clearBoard` reducer, the `POST /board/clear` route and the
  `api.clearBoard` method are all removed. Undo and replay remain, and the
  `{ kind: 'clear' }` history variant is kept so older cleared games still
  replay.
- **Issue #15.** Opening or joining a game uses `/game/<gameid>`, restores on
  refresh, and synchronizes browser back navigation.
- **Issue #16.** Players can remove their own social policies; the action is
  logged and exposed through the UI/API.
- **Board size.** Two-player games use a 16 × 8 board (A–P, 1–8); three- to
  five-player games use the full 16 × 16 board (A–P, 1–16). (Issue #17 asked for
  a smaller two-player map; the size was settled with the owner as 16 × 8, after
  a brief detour through 8 × 8 and full 16 × 16. See `decisions.md`.)
- **Delete game.** Game creators and enabled admins can permanently delete
  active or ended games; other players are denied.
- **Typecheck build order.** Engine declarations are rebuilt automatically
  before recursive typecheck, so clean checkouts do not use stale `dist` files.
- **Admin user management.** Accounts persist `role` and `disabled`, disabled
  accounts are rejected server-side, admins can manage users without password
  hashes in API responses, and the protected web admin page uses role lookup
  from storage rather than token claims.
- **Issue #21.** Joining a game now opens that game immediately after the join
  request succeeds.
- **Issue #23.** Social-policy choose, reveal and removal logs now retain one
  player-specific item number, while a reselected policy gets a fresh number.
- **Issue #20.** Added a persisted light theme, white board surroundings and
  `tileback.png` fog of war for empty map slots; dark remains the default.
- **Issue #19.** The admin user page pages 10 at a time in the browser, filters
  by username or email, and edits a username or email inline. The PATCH route and
  both repositories now accept a `username` change, rejected with `USERNAME_TAKEN`
  when another account already uses that name (case-insensitive).
- **Issue #26.** The white army figure is removed from the board palette: gone
  from the manifest and the public art, and excluded in `tools/board-assets.ps1`
  so a regeneration keeps it out.
- **Issue #33.** Added the responsive navigation menu and bundled rule/help
  resources, with links to FAQ, About and Highscore.
- **Issue #43.** A "Player status" panel replaces the old asset spreadsheet: one
  row per player, most columns auto-derived (culture-track level, city/building
  counts, techs, policies, hand, units), plus four editable stats (coins, trade,
  culture, victory points) that any game member may edit via `setPlayerStat`
  (`POST /api/games/:id/players/:targetId/stat`), logged publicly. Building
  ownership falls back to `placedBy` since building art has no colour variant.

## In progress

_Nothing. Issue #20 is ready for the human to merge from `feat/issue-20-theme-switch`._

## Next, in order

1. **`public-landing`** — a landing page with active games, highscore and an
   open chat. Builds on `GET /api/highscore` from `mongodb-storage`.
2. **`anonymous-readonly`** — browse everything public without an account, and
   the security pass that goes with it.

## Known problems and loose ends

- **Game fixes done on `feat/game-fixes`** (off `feat/mongodb-storage`), each
  through the review gate: membership on endturn/taketurn (403 for non-members),
  `GAME_NOT_STARTED` (409) instead of a misleading "Couldn't find player",
  log timestamp stamping on game creation, deterministic newest-first log sort,
  map tiles snap to the grid on move (bug #6), and the duplicate
  `startplayer_100_100` marker removed. Client-visual: board zoom now pans with
  scrollbars (task 3) and the tech pyramid no longer clips its left edge or
  overlaps the turn orders — both browser-verified. Civ-tile auto-placement,
  the `dd.MM.yyyy hh:mm:ss` log format, log sorting and collapsible panels were
  already in place (Luna) and confirmed working. 297 engine + 51 server tests
  pass. Branch pushed; PR still to open.

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

Migrating old `pbf` games to playable form · tournament collection · email
notification · `AdminAction` · websockets for live updates.
