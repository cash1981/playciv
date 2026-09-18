# State

Where the project stands. Read this first; it is here so you do not have to
read the codebase to find out what is done.

Keep it short. One line per finished thing. Detail that is worth keeping goes
in `decisions.md`; detail that is not goes nowhere.

_Last updated: 2026-09-18_

## Health

| Check | Status |
| --- | --- |
| `pnpm -r typecheck` | passing |
| `pnpm -r test` | passing — 379 engine, 83 server, 7 web |
| `pnpm -r build` | passing |
| `main` pushed to `origin` | yes; issue #63 merged (PR #66), fix/issue-63-arena-ux awaiting review |

## Done

- **The port itself.** Deck, items, draws, reshuffle, hands, techs, social
  policy, trade, turns, undo voting, chat, game lifecycle. Every Java action
  class has a counterpart and a test file naming it.
- **Server.** Hono over the engine (one HTTP codebase for Node and Cloudflare
  Workers), scrypt passwords, HMAC bearer tokens, JSON-file repository standing
  in for MongoDB.
- **Cloudflare deploy.** A `packages/worker` Cloudflare Worker serves the built
  SPA (static assets) and proxies `/api/*` to the Node server on Render (see
  `render.yaml`), which runs the Hono API against MongoDB Atlas. The API cannot
  run on the Worker itself — the MongoDB driver's cursor queries hang on workerd.
  Local development is unchanged: `pnpm dev` runs the Node server against the
  JSON file. See `decisions.md`.
- **Client.** React and Vite: login, game list, game page, hand, draws, battle,
  techs, turn orders, log, undo votes, chat.
- **Issues #54 and #56.** Game and lobby chat show local log-format timestamps;
  the board header now reads only **Civilization Boardgame**.
- **Board.** 16 × 16 map from the PowerPoint template, free pixel placement,
  stacking by array order, seven palette categories, map tiles that place
  themselves, starting tiles in the right corner with the arrow inwards.
- **Player areas.** A band below the map, one per player, pieces tidy into rows.
- **Wonders on the board.** A `wonder` board-asset category (27 pieces, art from
  `Civilization/Moderator/wonders`) shows in the piece palette. A shared
  **Wonders** area sits at the right of the player-area band — the player areas
  shrink to make room — and every wonder drawn at game start, or drawn manually,
  is placed there and named in a public log line instead of going into a hand.
  Manual wonder draws stay turn-gated like any other draw; a `wondersDealt` flag
  (not board pieces) decides whether the start-of-game deal has run, so palette
  art never cancels it. Verified in the browser.
- **City-states on the board.** A `citystate` board-asset category (the five
  neutral city-states cs1–cs5, art from `Civilization/Moderator/city-states`,
  capped to one square) shows in the piece palette, so a city-state can be placed
  on the map like a city. Placing one does not count towards a player's city
  count (`cityCountOf` filters `category === 'city'`). Verified in the browser.
- **Board history.** Every change recorded as a semantic operation, giving exact
  undo and step-by-step replay with the log trimmed to each step.
- **Everything in English.**
- **Culture track.** A band above the map, 27 spaces in four sections, measured
  off the artwork. Leader markers are placed freely, not snapped to a space, so
  they can be nudged anywhere and can share a space; the log still names the
  nearest space. Choosing a civilization places that leader on Start. The
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
- **Issue #34.** Added a public FAQ with current virtual-board and join-flow
  guidance, replacing obsolete Google Slides instructions.
- **Issue #35.** Added the public About page with license, FFG disclaimer,
   repository links and contact information.
- **Issue #38.** Added the anonymous landing page with public games, highscore
  and lobby chat, including public-data privacy regression coverage.
  **Issue #43.** A "Player status" panel replaces the old asset spreadsheet: one
  row per player, most columns auto-derived (culture-track level, city/building
  counts, techs, policies, hand, units), plus four editable stats (coins, trade,
  culture, victory points) that any game member may edit via `setPlayerStat`
  (`POST /api/games/:id/players/:targetId/stat`), logged publicly. Building
  ownership falls back to `placedBy` since building art has no colour variant.
- **Player status details.** Replaced obsolete status columns with grouped,
  editable Units and Cards, default modifiers, and EftA/Infra/MIC/PE values;
  older saved stats are migrated with defaults and Combat supports signed
  modifiers.
- **Issue #49.** Board supplies are now finite and visible: building counts
  come from the physical reference sheet, resources have one pool per type
  sized to the player count, and Great Person board assets have three pieces
  per type. Placement is rejected at zero and removal restores supply.
- **Issue #49 correction.** Building availability now uses the physical counts
  from the reference image: Market/Bank 5, Temple/Cathedral 5,
  Barracks/Academy 5, Granary/Aqueduct 6, Library/University 6, Workshop 6,
  Harbor 10, Tradingpost 6, Shipyard 5, and Ironmine 6.
- **Issue #51.** The Opponents panel is replaced by a **Revealed and Discarded
  Items** panel: a chronological, newest-first feed of every public item — the
  card, who revealed or owns it, and whether it was revealed, discarded, or
  both. `revealedFeed` builds it from the public set (discarded items plus
  non-hidden hand items, so hidden hands and techs never appear) and enriches it
  from the log for chronology, the revealing player, and revealed-then-discarded
  (one row, both facts, keyed by item identity). The route pages it server-side
  (`?page=&size=`, default 20, capped 100) so the browser never loads the whole
  history or every image at once. The `opponents` data stays on the view for the
  turn banner, Player status and the trade dropdown. Browser-verified.

- **Issue #63.** Battle arena: initiate (attacker vs player or barbarians), drag-and-drop units from battlehand/barbarians to positional arena fronts, manual attack/health inputs per unit, kill button, advisory turn marker, per-side HP+attack summaries, `endBattleTurn` / `endBattleArena` actions, concurrent-write protection via `rev` counter (409 on mismatch), and a 30-second auto-refresh toggle (top-right, persisted in `localStorage`). No server-side turn enforcement. `battle: Battle | null` and `rev: number` added to `GameState` and `PlayerView`; migrated with `?? null` / `?? 0`. All checks pass on `feat/issue-63-battle-arena`.
- **Issue #65.** `killArenaUnit` and `endBattleTurn` now reject non-participants with `NOT_IN_THIS_BATTLE`, matching `endBattleAction`'s existing guard. The "End turn", "End battle" and per-unit "Kill" buttons are hidden client-side for non-participants. `setArenaUnitStat` stays open to any game member on purpose (see `decisions.md`).
- **Issue #63 UX pass.** Fixed three problems found testing the merged arena in the browser: the arena is now one shared bordered frame (was two separate boxes), placing a unit is immediate with no confirmation step (was easy to miss, looked broken), and arena cards are smaller with a horizontal scrollbar per side (was an ever-growing vertical stack). Also added a cosmetic Rotate button per arena unit (`ArenaUnit.rotation`, reusing the board's `Rotation`/`nextRotation`) so a card can be spun to whichever printed unit level it represents — independent of the manually-entered attack/health. Browser-verified with two live accounts.

## In progress

_Nothing._

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
