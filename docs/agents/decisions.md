# Decisions

Why things are the way they are. **Append at the bottom. Never reword what is
already here** — that keeps merges trivial and the record honest.

One block per decision:

```markdown
## <date> — <short title>

**Decision.** What was decided.
**Why.** The reasoning, including what was rejected.
**Consequences.** What this now constrains.
```

---

## 2026-09-01 — The old Java tests are the reference

**Decision.** Where `old-civ-rest` and an expectation disagree, Java wins. Port
the behaviour as it is and write the disagreement down.

**Why.** The port has no other specification. The games it has to keep working
were played under Java's rules, bugs included.

**Consequences.** Several ported oddities are load-bearing: `endTurn` lets
anyone end the turn, units are always level 0, reshuffle never collects from
players' hands, and log lines have double spaces. All are listed in `README.md`
under "Known differences from Java".

---

## 2026-09-01 — Stable id per item instance

**Decision.** Every item carries an opaque `id`. `itemNumber` is kept for log
compatibility, with a random starting offset per game.

**Why.** Java identified items by value equality, so two identical `Infantry
1.3` were "equal" and removing one from the discard pile could remove the
wrong instance. The human asked that `itemNumber` stay unguessable.

**Consequences.** `itemValueEquals` still exists where Java's semantics are
needed. The offset is `RandomUtils.nextInt(1, 20)`, so only 19 values exist —
do not write a test that assumes two seeds give different offsets.

---

## 2026-09-05 — A JSON file instead of MongoDB

**Decision.** `Repository` is an interface; the only implementation keeps
everything in memory and mirrors it to a JSON file, debounced, written
atomically through a temporary file.

**Why.** Enough to play locally and survive a restart, without standing up a
database for a rewrite that is not finished.

**Consequences.** No indexes, no concurrency control, no queries across games —
which is why highscore and tournaments are deferred. A Mongo implementation can
be added alongside without touching the routes.

---

## 2026-09-12 — Board history as semantic operations

**Decision.** Record each board change as an operation (`place`, `move`,
`rotate`, `reorder`, `remove`, `clear`) rather than a snapshot or a generic
diff. Board moves are not written to the game log.

**Why.** Operations give exact undo and exact replay from an empty board,
compactly. A turn is made of many small adjustments and the game log would
drown in them; the board history is the record instead.

**Consequences.** Every new kind of board change needs a matching entry in
`applyChange` and `revertChange`, and a test that forwards and backwards agree.
Games saved before the history existed get one synthetic `place` per piece at
load time.

---

## 2026-09-15 — The culture track is a marker only

**Decision.** The track is a band above the map with 27 spaces. Markers snap to
a space when dropped. The engine enforces nothing about what advancing costs or
what happens at a threshold.

**Why.** Neither the Java source nor the AngularJS client had a culture track or
any notion of leaders, so there is no reference behaviour to port — and
inventing FFG rules is forbidden. The human chose the marker-only option
explicitly.

**Consequences.** The 27 spaces and their four sections were measured off
`culture track.png` by finding the dark divider columns; the section spans are
in `board.ts`. Adding rules later means asking the human for them first.

---

## 2026-09-15 — The map no longer starts at the origin

**Decision.** The culture track occupies the top of the board surface, so the
map begins at `mapTop(board)`, not at `y = 0`.

**Why.** The track had to go somewhere, and the top is where it sits on the
physical board.

**Consequences.** Anything converting between pixels and squares must go through
`mapTop`. Tests must express map coordinates as `mapTop(board) + n` rather than
absolute numbers, or they break the next time the layout changes.

---

## 2026-09-15 — Wonders get artwork, unlike in Java

**Decision.** `itemImage()` returns a file name for wonders. Java's `Wonder`
never implemented `Image`.

**Why.** The artwork exists under `Moderator/wonders` and all 27 names map onto
it cleanly. The old client showed wonders as text only because of a gap in
Java, not a decision.

**Consequences.** A deliberate difference from the reference, so it is listed in
`README.md`. The mapping is: lower case, drop a leading "The", remove spaces and
hyphens, keep apostrophes.

---

## 2026-09-15 — FFG artwork is committed to a public repository

**Decision.** Piece and card artwork is committed and pushed to
`github.com/cash1981/playciv`, which is public.

**Why.** The risk was put to the human — that publishing redistributes Fantasy
Flight's copyrighted artwork — and they chose to proceed anyway.

**Consequences.** Roughly 40 MB of artwork in git history. If this is ever
reconsidered, removing it means rewriting history, not just deleting files.

---

## 2026-09-15 — The game creator joins their own game

**Decision.** `POST /api/games` creates an empty game and then calls `joinGame`
for the creator, rather than seating them directly.

**Why.** Java ended `createNewGame` with `joinGame(..., gameCreator = true)`,
and that call is what assigns a colour. Seating the creator directly left them
with `color: null`, which the culture track exposed: a player without a colour
has no leader marker.

**Consequences.** `JoinGameInput` carries a `gameCreator` flag. A test pins the
creator's colour to Green so the regression cannot come back.

---

## 2026-09-15 — Cheap coder, expensive read-only reviewer

**Decision.** Code is written by an agent on a cheaper model and checked by an
agent on a stronger model that has no write tools. Only the orchestrator
approves, and work continues only after approval.

**Why.** The human asked to spend fewer tokens without giving up correctness.
Most of a feature is mechanical; judging whether it is right is not. A reviewer
that can edit fixes what it finds instead of reporting it, which hides the
finding from the approver and teaches the cheap model nothing.

**Consequences.** Reviewers get `Read`, `Grep` and `Glob` only — not even
`Bash`, since a shell can write. The orchestrator runs the tests and hands the
reviewer the real output along with a diff written outside the repo.

---

## 2026-09-16 — MongoDB beside the JSON file, old games read-only

**Decision.** The server can run against the restored `playciv` Mongo when
`MONGO_URL` is set, otherwise the JSON file as before. A `MongoRepository`
implements the existing `Repository` interface. It reuses the old `player` and
`chat` collections, reads the old `pbf` games for highscore, and stores new
games in a fresh `game_state` collection. The old `pbf` documents are never
written to.

**Why.** The human restored the real database — 553 players, 310 games, 87k
chat — and wanted the app to reuse it: the player accounts, the chat history,
and the finished games for highscore. Java's `PBF` shape is nothing like our
`GameState` (no board, no seed, no publicTurns, a different item model), so
migrating the 310 old games to playable form would mean inventing the missing
fields — forbidden by rule 2, and risky for hidden information. Highscore needs
only each finished game's roster and winner, which the old `pbf` does carry, so
the history is reused without migration.

**Consequences.** New games live in `game_state`; anyone querying game history
must read both collections, as `finishedGamesForHighscore` does. Old games are
not openable in the new UI. `MongoRepository` has no automated test — CI has no
database — so it is verified manually against the live instance; the shared
logic is covered by the JSON repo and the pure functions.

---

## 2026-09-16 — Old SHA-1 passwords verified, then upgraded to scrypt

**Decision.** `verifyPassword` accepts both the old unsalted SHA-1 hashes (40
lowercase hex, no colon) and the new scrypt hashes. On a successful login with
a legacy hash, the stored value is rewritten to scrypt. The upgrade never
blocks or fails the login.

**Why.** All 553 restored accounts store `DigestUtils.sha1Hex(password)`. To let
the human and everyone else log in with their existing passwords — rule: reuse
the player collection — the old hash must verify. Upgrading on login moves each
account to salted scrypt the first time it is used, without a mass reset.

**Consequences.** The SHA-1 comparison is kept byte-for-byte identical to Java's
case-sensitive `String.equals` (lowercase-only regex, no case folding), so no
hash Java would reject is accepted here. Verified end-to-end against the live
database: a legacy login returns a token and the stored hash becomes
`salt:hash`.

---

## 2026-09-16 — Highscore matches Java, including its quirks

**Decision.** `highscore(games, allUsernames?)` in the engine is a faithful port
of `GameAction.getPlayerHighScore` / `getCivHighscore`. `attempts` counts
participation in every finished game; non-winning registered players appear with
0 wins; the civ tables count only games where every player has a civ; per-count
player tables roster every participant while the civ tables roster only winning
civs; `percentWin` is formatted as Java's `double + " %"` (with the trailing
`.0`); ties break on descending username.

**Why.** Rule 1 — Java is the reference. The first draft of the brief carried
only the winner per finished game, which made `attempts` equal `totalWins` and
every `percentWin` 100 %. The coder flagged the gap rather than inventing a fix;
the summary was widened to the full roster. The player/civ roster asymmetry is a
real Java quirk (`getWinners` flatMaps the roster, `getCivWinners` maps games),
re-verified against the source and reproduced rather than smoothed over.

**Consequences.** `Repository.finishedGamesForHighscore` returns the full roster
of each finished game. `GET /api/highscore` is public and passes the registry so
non-winners appear. Confirmed against the live database: Andrius 39/68 = 57.35 %,
cash 36/58 = 62.07 %, civ tables filtered from 247 to 235 games.

---

## 2026-09-16 — endTurn returns GAME_NOT_STARTED instead of crashing

**Decision.** When `endTurn` is called and no player holds the turn (an
unstarted game, all `playernumber: 0`), the engine returns a distinct
`GAME_NOT_STARTED` error, which the server maps to HTTP 409. The zero-
`playernumber` branch returns it too, rather than advancing the turn by array
index.

**Why.** Java diverged two ways here, neither good: its legacy `else` branch
(`PlayerAction.endTurn`, for pre-2015 games) advanced by array index on the
caller's username, and its numbered branch did `filter(isYourTurn).findFirst()
.get()`, which throws `NoSuchElementException` → HTTP 500 when nobody holds the
turn. The previous port already diverged (it returned `PLAYER_NOT_FOUND`, shown
to the user as the misleading "Couldn't find player"). The old `pbf` games that
the legacy branch existed for are never loaded as `GameState` (they are read-only
— see the 2026-09-16 MongoDB decision), so there is no real data the index
fallback serves. A clear 409 is better than a 500 or a misleading 404.

**Consequences.** A deliberate difference from Java, recorded here and in
`README.md`. The started-game rotation (advance to the next `playernumber`,
wrapping to 1) is unchanged and still matches Java. Membership is enforced at
the server route (`requireMembership` on `endturn`/`taketurn`), which is where
`decisions.md` (2026-09-01) always said it belonged.

---

## 2026-09-16 — revealSocialPolicy has no Java counterpart

**Decision.** `revealSocialPolicy` mirrors the in-repo `revealTech` (find the
chosen item, set `hidden: false`, append a `REVEAL` log) rather than a Java
method, because `PlayerAction` never had one — social policies were never
revealable in Java.

**Why.** Issue #6 asks for reveal parity with techs and items. `revealTech` is
the closest in-repo pattern and the shapes match: both are items chosen into
the player's hand with a `hidden` flag.

**Consequences.** No Java test exists to port for this action; its engine test
is original, not a port.

---

## 2026-09-16 — Social policy images are lower-cased for the WaW artwork

**Decision.** `itemImage()` for a social policy returns the name lower-cased with
spaces removed (`Military Tradition` → `militarytradition.png`). Java's
`SocialPolicy.getImage()` kept the name's case (`name + ".png"` with spaces
removed → `MilitaryTradition.png`).

**Why.** Issue #6 asks to use the artwork under `Civilization/WaW`, and those
files are all lower case (`patronage.png`, `naturalreligion.png`, …). Matching
them is what makes the cards show. The previous code (socialpolicy shared the
hut/village/tech case) matched Java's case exactly but pointed at files that do
not exist in this repo, so the policies had no image.

**Consequences.** A deliberate difference from Java's `getImage`, recorded here
and in `README.md`. The spreadsheet name keeps its `Expansionsim` typo (the data
still matches Java); only the on-disk file is aliased (`expansionsim.png` copied
from `expansionism.png`). `revealSocialPolicy` itself was requested by the human
in issue #6, so it is an authorised new feature, not an invented rule — the
"ask the human first" bar is met by the issue.
---

## 2026-09-16 — Two-player games use an 8 × 8 board

**Decision.** New two-player games use an 8 × 8 board labelled A–H and 1–8;
three- to five-player games retain the 16 × 16 board.

**Why.** GitHub issue #17 explicitly requests the smaller two-player map. The
old Java system stored a Google Presentation link rather than board geometry,
so this is a deliberate new-board policy, not a Java port.

**Consequences.** Board dimensions are selected during `createGame`; all board
geometry and projections consume the stored dimensions.

---

## 2026-09-16 — Roles are database-backed and enabled admins cannot lock themselves out

**Decision.** Player records carry `role: user | admin` and `disabled`, with
legacy records defaulting to an enabled user. Bearer tokens continue to carry
only the player id; authorization reads the current stored player on every
request. An admin cannot disable, demote or delete itself, and the last enabled
admin cannot be removed.

**Why.** This keeps account authorization compatible with a future OIDC/OAuth
identity provider and guarantees that an administrator can recover access.
The Mongo migration defaults `ADMIN_USERNAME` to `cash`, sets only missing
access fields, and promotes that account without touching its password.

**Consequences.** The old engine end-game reducer still exposes Java's
username-shaped escape hatch because engine paths were not part of this task's
claim; the server authorizes from the persisted role and supplies that legacy
compatibility input only after the role check.

---

## 2026-09-17 — Two-player games use the full 16 × 16 board (reverses the 8 × 8 policy)

**Decision.** Every game, two players included, uses the full 16 × 16 board
labelled A–P and 1–16. This reverses the 2026-09-16 decision above that gave
two-player games an 8 × 8 board.

**Why.** The human product owner asked for it: a two-player game should have the
same full-size map as a normal game, with coordinates running to P16. As the
superseded entry records, board size here is a product choice rather than a Java
port — Java stored only a Google Presentation link, no board geometry — so this
is the owner's call to make, and no Java reference is contradicted.

**Consequences.** `createGame` no longer special-cases `numOfPlayers === 2`; it
always calls `createBoard()` with the 16 × 16 default. Board geometry and every
projection already read the stored dimensions, so nothing else changed.

---

## 2026-09-17 — Two-player board is 16 × 8, not full 16 × 16 (corrects the entry above)

**Decision.** Two-player games use a 16 × 8 board (columns A–P, rows 1–8) —
full width, half height. Three- to five-player games keep the full 16 × 16.
This corrects the entry directly above: the owner did want a smaller two-player
map after all, just not the 8 × 8 of issue #17. The "full 16 × 16 for everyone"
step was based on a misstatement in the issue, which the owner then corrected.

**Why.** The owner clarified the intent: issue #17's goal (a smaller two-player
map) stands, but the size is 16 × 8, not 8 × 8. Board size is a product choice,
not a port, so this is the owner's call.

**Consequences.** `createGame` special-cases `numOfPlayers === 2` again, now
with `createBoard(16, 8)`. Everything else reads the stored dimensions, so the
column labels run to P and the rows stop at 8 without further change.

---

## 2026-09-17 — Social-policy selections receive fresh item numbers

**Decision.** A social policy selection gets a fresh number from the game's
`itemCounter`. The selected policy keeps that number through its choose, reveal
and removal logs; selecting the same policy again after removal gets another
number. Reveal logs use the player-specific `uniqueItemNumber` format for
social policies, as they already do for technologies.

**Why.** Issue #23 exposed two problems: the reveal log used the policy's base
number instead of the selection's player-specific number, and reselecting a
removed policy reused the old reference. Java's constructor left selected
social policies at item number 0, so the requested behaviour is an intentional
correction of that legacy bug.

**Consequences.** `chooseSocialPolicy` advances the pure game-state counter
when it creates a selection. The public projection and hidden-policy rules are
unchanged; existing hidden-information tests continue to prove that a hidden
policy name is not exposed before reveal.

---

## 2026-09-17 — Culture track band is stretched taller than its aspect (issue #22)

**Decision.** The culture track band is drawn `CULTURE_TRACK_SCALE` (1.7×)
taller than the height its own aspect ratio would give at full board width.

**Why.** The artwork is very wide and short (3349 × 215), so scaled to the full
board width its natural height is only about one square, which reads as a thin
strip even at 100% zoom (issue #22). The client paints the image with
`background-size: 100% 100%`, so stretching the band simply grows the image with
it — nothing is clipped or re-tiled — and cell centres stay at `trackHeight / 2`,
so marker positions and zoom are unaffected. Neither the old backend nor the old
client had a culture track, so there is no reference to contradict; this is a
presentation choice.

**Consequences.** `cultureTrackHeight` multiplies by `CULTURE_TRACK_SCALE`, so
`mapTop` and the whole board are that much taller. Every geometry consumer reads
`mapTop`/`cultureTrackHeight` rather than a hard-coded number, so only the band
height changed.

---

## 2026-09-17 — Clear-board action removed, its history kind kept (issue #14)

**Decision.** The clear-board action is gone: the `clearBoard` engine reducer,
the `POST /board/clear` route and the `api.clearBoard` client method are
deleted, along with their tests. The `{ kind: 'clear' }` `BoardChange` variant
and its `applyChange`/`revertChange` cases stay.

**Why.** Issue #14 says there is no situation where clearing the whole board is
warranted. The user-facing button was already removed earlier; this finishes the
job by removing the now-unreachable action end to end. The history variant is
kept because games cleared before this change still carry a clear entry in their
board history, and replay and undo must keep reproducing it. No code produces a
new one.

**Consequences.** Nothing can clear a board any more. The retained clear cases
are compatibility-only and no longer exercised by a test, since nothing can
produce the entry to feed them.

---

## 2026-09-17 — Player status board replaces the old asset spreadsheet (issue #43)

**Decision.** Each game has an in-app player status board (a "Status" panel in
the game view) instead of the old embedded Google Sheet. Most columns are
derived from the game state; four stats — coins, trade, culture, victory points
— are editable, and **any member of the game may edit any player's stats**. Each
edit is written to the public game log. A new pure engine reducer `setPlayerStat`
owns the change; the server route `POST /api/games/:id/players/:targetId/stat`
authorizes membership (via the reducer) and validates the stat and value.

**Why.** The old app tracked this in a manually maintained shared spreadsheet
because play is asynchronous. The rewrite already models most of it (techs,
policies, hand, units, board pieces, culture-track marker), so we auto-derive
what we can and keep a few shared editable numbers for the rest, on-platform.
The owner asked for the hybrid approach and for edits to be open to all players
(shared bookkeeping, like the old sheet).

**Consequences.**
- `Playerhand` gains `stats: PlayerStats` (coins/trade/culture/victoryPoints),
  defaulted to zero and back-filled by `migrate.ts` for older games. Stats are
  public in every projection.
- Read-only derived fields exposed per player: `cultureMarkerLevel` (from the
  culture-track marker), `cityCount`, `buildingCount`.
- **City ownership is inferred from the piece colour** (`cities/<colour>...`).
  **Buildings have no per-colour artwork**, so `buildingCountOf` falls back to
  `piece.placedBy`; since anyone may move any piece, a building's count can be
  wrong if it changes hands after placement. The derived `cityCount`/
  `buildingCount` are advisory and have no editable override, so a misattributed
  building can only be corrected by removing and re-placing the piece, not from
  the status board. Acceptable for a bookkeeping aid.

---

## 2026-09-17 — Player status uses grouped shared bookkeeping fields

**Decision.** The status board now presents grouped columns for Coins/Trade/
Culture, Units and Cards, default modifiers, and Technology & Infrastructure.
The old Barbarians, Hand, Policies, Techs, Battlehand, VP, and other derived
count columns are removed from this panel. The new fields are stored in the
existing public `PlayerStats` object so they remain editable by any game member.
Existing games receive missing fields from the same defaults used for new games.

**Why.** The human requested a compact status view matching the physical
bookkeeping sheet, rather than duplicating values that are already available in
the hand, battle, tech, and policy panels.

**Consequences.** Combat is a signed modifier and accepts negative values;
other status values remain non-negative integers. This is bookkeeping only and
does not make the values affect engine rules.

---

## 2026-09-17 — Issue #49 uses finite supplies for public board assets

**Decision.** The board palette enforces the physical building supplies from
the reference sheet: Market/Bank 5, Temple/Cathedral 5, Barracks/Academy 5,
Granary/Aqueduct 6, Library/University 6, Workshop 6, Harbor 10,
Tradingpost 6, Shipyard 5, and Ironmine 6. Upgrade pairs share their family
pool. Each resource asset has a supply equal to the number of players, and
each Great Person board asset has three pieces. Placement consumes availability
and removal restores it. The separate Great Person card deck remains
independent.

**Why.** The human requested the same availability mechanic as physical
buildings for resources and Great Persons. The old system had no board-piece
inventory to port, so this is an explicit product rule rather than a silent
correction of legacy Java behavior.

---

## 2026-09-17 — Wonders live on the board, not in a hand

**Decision.** Wonders are a `wonder` board-asset category with their own art
(the 27 images in `Civilization/Moderator/wonders`, ~85 px, near-square) and a
palette entry, and they are placed on a shared **Wonders** area at the right of
the player-area band. Every wonder that used to be drawn into a hand — the four
ancient wonders dealt once all civilizations are chosen, Egypt's starting
wonder, and any wonder drawn from the draw menu — is instead taken off the deck,
placed in the Wonders area, and named in a **public** log line. No wonder ever
enters a player's hand. The player areas shrink in width (the Wonders area is
`WONDERS_AREA_SQUARES = 3` squares wide) to make room.

**Why.** The owner asked for it: wonders were never really giftable or hidden
bookkeeping the way ordinary cards are (the old system marked them non-`Tradable`
and rendered them as text-only cards with no art), and tracking them openly on
the board matches how the physical game lays wonders out. This deliberately
deviates from the old behaviour, which put drawn wonders in the hidden hand.

**Consequences.**
- New engine surface: `wonder` in `BoardAssetCategory`; `wonderAssetId(name)`
  (same normalisation as `itemImage`); `wondersArea` / `boardAreas` /
  `WONDERS_AREA_ID`; `drawWonderToBoard` (low-level, no turn check) and
  `drawWonder` (turn-gated wrapper). `playerAreas` now reserves the Wonders
  area's width, so `boardAreas` (players + Wonders) spans the map, not
  `playerAreas` alone. `boardAreas` is what the view and piece-placement use.
- Wonders on the board are **public** — that is the point. Because wonders no
  longer reach any hand, the hand projection is unchanged and nothing new can
  leak; hidden-info tests are unaffected.
- The pure `draw` reducer is left as the faithful Java port (a wonder drawn
  through it would still go to the hand). The redirect to the board is done at
  the **server draw route** for wonder sheets, via `drawWonder`. A manual wonder
  draw is **still turn-gated** like any other draw; only the destination differs
  (board, not hand). The start-of-game deal calls `drawWonderToBoard` directly,
  since revealing a civilization is not a turn action.
- `shouldDrawWonders` gates on a new `wondersDealt` state flag, **not** on a
  wonder piece being on the board. A moderator may place wonder art from the
  palette, and that must not cancel the deal. The flag is set when the bulk
  four-wonder draw runs, and when Egypt's starting wonder is drawn — so Egypt
  still suppresses the bulk draw, as in Java. `migrate.ts` back-fills the flag
  for older saved games (true when setup is complete or a wonder already exists
  anywhere, so the deal never re-fires mid-game).
- **Undo of a wonder placement removes the wonder from the game.** The wonder is
  taken off the deck when placed, and the deck removal is not part of the board
  history; board undo reverts only the placement, so the piece disappears with
  nothing put back in the deck. Wonders are not reshuffleable anyway, so this is
  accepted — re-add wonder art from the palette if needed.
- The Wonders area is a 3×3 grid (`WONDERS_AREA_SQUARES = 3`, nine slots). A
  tenth wonder falls back to the first slot; a moderator can drag wonders out
  across the board. Enough for the four ancient wonders dealt at start.
- Not done here: hiding the "Give" button on non-giftable cards (already blocked
  server-side by `isTradable`) is a separate follow-up.

---

## 2026-09-17 — Culture-track markers are placed freely, not snapped

**Decision.** Dropping a leader marker on the culture track no longer snaps it to
the nearest space or steps it into a lane. Markers are placed freely, at the
exact drop position, like every other piece on the board. This reverses the
"markers snap to a space when dropped" part of the 2026-09-15 decision above;
everything else there still stands.

**Why.** The owner found the snapping made markers hard to position — they could
not put a marker exactly where they wanted, and the lane-stepping sometimes left
markers partly on top of each other. Free placement is also what the board does
everywhere else (`board.ts`: "Pieces sit at free pixel coordinates rather than
snapping"), so the snap was the odd one out. There is no ported rule that
requires snapping; the track is a marker aid, and the player decides the exact
spot, including whether two markers share a space.

**Consequences.** The `cultureSlot` helper is removed and the culture-band branch
in `movePiece` is gone. `cultureStepOf` and `locationOf` still read the nearest
space from a marker's position, so the log still says "moved … to culture 7".
Markers can now overlap if dropped on the same spot — that is the player's
choice. The one exception is the *automatic* placement of a leader on START when
a civilization is revealed (`placeLeaderMarker`): it still fans markers out into
lanes so two players choosing at once are not hidden under each other. That is
only a default starting spot; either marker can then be moved freely.

## 2026-09-18 — Hono for the HTTP layer, and Cloudflare Workers hosting

**Decision.** Replace Fastify with Hono in `packages/server`, and deploy the app
as a single Cloudflare Worker (`packages/worker`) that serves the built SPA as
static assets and runs the API against MongoDB Atlas. Local development and the
Node entry point stay, running the same Hono app through `@hono/node-server`
against the JSON-file repository.

**Why.** The owner chose to host the whole app on Cloudflare against Atlas.
Cloudflare Workers do not offer Node's listening-server model, so Fastify (built
on `node:http`) cannot run there. Hono is written against the web-standard
`Request`/`Response`, so the same code runs on Workers and, via an adapter, on
Node — one codebase instead of two. A spike proved the platform first: the
`mongodb` driver reaches Atlas from workerd under `nodejs_compat`, `node:crypto`
scrypt runs there, and the engine bundles. Keeping Fastify and hosting the API
on a separate Node box was the rejected alternative; it was simpler but split
hosting across two providers, which the owner did not want.

**Consequences.** The HTTP framework is Hono everywhere. Route handlers use
`c.req`/`c.json`; server tests use `app.request` via `test/helpers.ts`. On
Workers, secrets (`MONGO_URL`, `TOKEN_SECRET`) must be set as *runtime* secrets
and the Worker fails closed if either is missing. A 304 (`ITEM_ALREADY_REVEALED`)
is answered with an empty body because the Fetch spec forbids a body on that
status. Malformed JSON is rejected with 400 by middleware, and unmatched routes
and unhandled throws return the `{ error, message }` shape via `notFound`/
`onError`.

## 2026-09-18 — Cloudflare hosting: SPA on the Worker, API on a Node host

**Decision.** Supersedes the hosting part of the previous entry. The API does
NOT run on Cloudflare Workers. The Worker serves the built SPA as static assets
and proxies `/api/*` to the Node server (`packages/server`) running on Render
against MongoDB Atlas. `playciv.app` stays one origin. Local development is
unchanged (`pnpm dev`, JSON file).

**Why.** A deploy proved the MongoDB driver cannot run real queries on workerd:
`client.connect()`, `db.command({ping})` and `estimatedDocumentCount()` work,
but `find().toArray()` (which every real route uses) hangs and the Workers
runtime cancels the request. The same `MongoRepository` code answers instantly
on Node against the same Atlas cluster (verified: highscore returns the real
`pbf` data, `public/games` returns `[]`), so it is a workerd limitation, not
Atlas. The Atlas Data API (the old HTTP path off the driver) is discontinued and
Hyperdrive does not support MongoDB. Moving storage to Cloudflare D1 was the
all-Cloudflare alternative but means rewriting the whole repository and migrating
the restored data, which the owner declined for now.

**Consequences.** The Hono migration still stands and is not wasted: Hono runs
on Node, and keeping it leaves the door open to an all-Workers backend later if
Mongo is dropped. The Worker holds no database code or secrets — only `API_ORIGIN`
(the Node server URL). `MONGO_URL`/`TOKEN_SECRET` live on Render. The spike was
too shallow to catch this: it tested a connection and a trivial command, not a
cursor query. Future platform spikes must exercise a real `find().toArray()`.

---

## Battle arena (issue #63)

- **Advisory turn only.** `battle.turn` shows whose turn it is but is not enforced server-side. Players are trusted to follow the order; the marker is informational only.
- **`killed` is not set on kill.** The Kill button removes a unit from the arena and clears `inBattle`, but does not set `killed: true`. Players manage their own cards (discard, reveal, keep) after a kill. This was an explicit decision to keep the engine simple and give players control.
- **`rev` counter is game-global.** Every write to the game state increments `rev`, not just arena writes. This means a 409 can occur on arena actions even when the arena itself has not changed. The client reloads the view on 409 and shows an error; the user retries.
- **Barbarians + existing barbarian hand.** If the player to the attacker's left already holds undiscarded barbarians, `initiateBattle` with `opponentId: 'barbarians'` will return `BARBARIANS_NOT_DISCARDED`. Known limitation — the initiating player must coordinate with the barbarian controller. Not an error in the old system (the feature was never implemented).
