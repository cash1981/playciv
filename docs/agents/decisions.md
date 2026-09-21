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

## 2026-09-19 — Government becomes structured public bookkeeping (issue #43)

**Decision.** Add one public Government field per player and show it as a
dropdown in Player status. Any current game member may change any current
player's value, and every change is written to the public log. New and migrated
players start in Despotism; revealing Romans, Russians or Japanese selects the
documented Republic, Communism or Feudalism exception respectively. The same
panel presents the text of all eight *Wisdom and Warfare* government cards as a
public reference.

**Why.** The old backend and Angular client had no government model, route or
dedicated government UI. The only support was the old client's per-game Google
spreadsheet integration, where players maintained the value themselves. The
human explicitly authorized replacing that unstructured sheet entry with basic
in-app bookkeeping and asked that the available card information be readable.

**Consequences.** This is an intentional addition beyond the old application's
structured model, while preserving its shared manual-bookkeeping semantics.
The engine does not enforce government unlocks, the direct-change timing rule,
forced Anarchy or any printed government effect; the reference text does not
drive game logic. Those effects remain table-managed until separately specified.

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
- **Arena permissions are split on purpose (issue #65).** `killArenaUnit` and `endBattleTurn` (and `endBattleAction`) reject non-participants with `NOT_IN_THIS_BATTLE`. `setArenaUnitStat` deliberately stays open to any game member, since attack/health are manually tracked and spectators may need to correct a typo on either side's behalf. The UI mirrors this: "End turn"/"End battle" and the per-unit "Kill" button are hidden for non-participants; the attack/health inputs are not.
- **Arena unit rotation is cosmetic, not an upgrade mechanic (post-#63 UX pass).** `ArenaUnit.rotation` reuses `board.ts`'s `Rotation`/`nextRotation` (the same four-way rotation as a placed board piece) so a player can visually spin a card to whichever printed level — e.g. Archer vs Mobile Artillery on the same Artillery card — they mean. It is deliberately independent of `attack`/`health`: those stay user-entered as before. `item.ts` already models a `level` field for this (`UnitItem.level`), but its own doc comment says Java's `setLevel` was "called nowhere in old-civ-rest" — the old system never actually drove it. Rather than wiring the arena's cosmetic rotation into that dormant, disconnected field (which would silently change `revealAll`'s displayed name/stat text across the whole app, not just the arena), rotation got its own arena-scoped field. `setArenaUnitStat`'s permission model applies: any game member may rotate a unit, logged.
- **Rotate now suggests stats too, and turns left (issue #68, revises the entry above).** The human tried the cosmetic-only rotate and asked for two changes: rotating should turn counter-clockwise ("left is the upgrade direction"), and it should suggest the next tier's attack/health so the player has a number to start from, rather than just changing the card's orientation with no numeric hint. `rotateArenaUnit` now derives a 0–3 "how many presses" level directly from the stored `rotation` (`rotationLevel()`, purely a function of the angle — no extra field), and sets `attack`/`health` to the unit's pristine snapshot values (`unit.unit.attack/health`, not the currently-edited arena values) plus that level, wrapping back to the base values after a full 360°.
  Correction from the first version of this entry: the bonus progression (0, +1, +2, +3 across four presses) is *not* a new formula — it is arithmetically identical to Java's ported `level - 1` bonus over levels 1–4 in `item.ts` (`unitToString`), one press ahead of Java's level number. What is genuinely new is only that a rotate button drives it and that `UnitItem.level`/`unitLevelNames` are still not written or read — kept separate on purpose, so upgrading a unit in the arena cannot change `revealAll()`'s displayed name for that same card anywhere else in the app (hand, log, revealed feed). The rotate log line therefore shows the new numbers but not a tier name (e.g. "Archer"); showing the name too is a reasonable follow-up but not what was asked for verbatim (the human's own example kept saying "Artillery 2.2 → Artillery 3.3", not "Archer 3.3"), so it was left out rather than guessed at.
  The suggested values overwrite whatever was typed into the attack/health fields, including mid-battle damage tracked as reduced health — this matches the physical game, where rotating a card to a new printed level replaces its stats outright, not an oversight. Units with no printed levels (`aircraft`; `unitLevelNames` returns `null`) skip the stat suggestion entirely — rotation stays cosmetic-only for them, since there is no card face to justify a number. The suggestion overwrite happens regardless of who calls it — `rotateArenaUnit` has no participant guard, same as `setArenaUnitStat`.
- **Killing is a toggle, locked in only at end-battle (issue #71).** Two symptoms — "a killed unit reappeared in hand after a refresh" and "killing has no undo" — turned out to be the same missing state. `killArenaUnit` no longer removes the unit from `battle.arena` or clears `inBattle`; it flips a new `ArenaUnit.killed` flag (still a participant-only action, issue #65's guard stands — calling it again undoes the kill). `battleSummaries` excludes `killed` units from the living totals, since they are dead but still present for the undo window. Only `endBattleAction`, when the battle actually ends, makes it permanent: a unit still `killed` has its source card **discarded** (into `discardedItems`, not returned to hand); everything else clears `inBattle` as before. This is a real behaviour change from the issue-63 brief's "killed cards are NOT auto-discarded" — superseded here because the human explicitly asked for it ("it should not [reappear]"). The discard matches each source list's own convention rather than inventing a third: a barbarian card gets `ownerId: null` (like `discardBarbarians`), a player's own card gets `hidden: true` (like `discardItem`); both get a `DISCARD` log entry attributed to the card's owner, so `revealedFeed` credits the discard correctly and the owner sees it in their own log.
- **Move and return-to-hand are restricted to the unit's own side (issue #71).** Unlike `killArenaUnit`/`setArenaUnitStat` (any participant, even the opponent), `moveArenaUnit` and `returnArenaUnitToHand` require `sideForPlayer(battle, playerId) === unit.side` — the same restriction `placeUnitInArena` already has. Repositioning or withdrawing a unit is a management action for the side that placed it, not something the opponent should be able to do; killing/stat-editing are shared bookkeeping about combat outcomes, which is a different kind of action.
- **"Only log the last change" is a single-entry lookback matched on message text, never on `item` (issue #71).** `appendRollingArenaLog` (in `arena.ts`) drops the immediately preceding log entry before appending a new one, but only when a caller-supplied predicate says that entry was the same kind of adjustment — for a move, the same "moves X to" prefix; for a kill toggle, either exact direction's full message for the same card, so kill/undo/kill/undo in a row collapses to whichever was last, not one line per click. It never looks further back than one entry, and it deliberately never sets `item` on these entries. An earlier version of this helper carried the card on `item` for correlation and was caught in review: `initiateUndo`'s only gate is `entry.item !== null`, so that made "kills X"/"moves X" lines undoable, and an accepted undo would try to pull a unit's card back into hand or the deck while `battle.arena` still referenced it — corrupting the game. Matching on plain message text avoids that: arena units are already fully public, so nothing is hidden by leaving `item` null.
- **An arena card's live-stat label must never change which image is looked up (issue #71 follow-up).** The live-attack/health display (added so rotating an arena unit visibly changes what it says) was first built by cloning the unit's card with `attack`/`health` overridden and passing that clone to `ItemCard`. That broke the art: `itemImage()` builds the printed card's filename from the item's own `attack`/`health` (e.g. `Artillery1.3.png`), so any stat combination the printed deck does not actually have — which is any value reachable by rotating or hand-editing away from the base card — pointed the lookup at a file that does not exist, and the image silently went blank (`onError` only hides a broken `<img>`, it does not fall back to text). Fixed by giving `ItemCard` a `labelOverride` prop: the caption text can be overridden without touching `item`, so the image lookup always uses the pristine card. `ArenaUnitCard` now passes `item={unit.unit}` (unchanged) and `labelOverride` built from the live attack/health.
- **Arena rows face each other, like the physical table (issue #74).** The attacker's row renders on top of the shared frame and the defender's below it; each side's cards now get a base visual rotation added on top of the player-controlled `rotation` — 180° for the attacker, 0° for the defender — so the two rows read as facing one another rather than both "upright" in the same direction. This is purely a display transform computed in `ArenaUnitCard`; `ItemCard`'s `rotation` prop became a plain `number` (was the engine's `Rotation` union) since a base-plus-stored sum is not itself guaranteed to be one of the four named angles by type, only by arithmetic (it always lands on one in practice, since both terms are multiples of 90). The stored `ArenaUnit.rotation` — and the attack/health bonus it derives — is untouched.
- **A killed unit no longer blocks its own front (issue #74).** `placeUnitInArena` and `moveArenaUnit`'s occupancy checks now ignore `killed` units — a front is only "occupied" by a living one. Landing a new or moved unit on a front that still holds a killed one reinforces it: the fallen unit's card is finalized immediately (discarded, via a `discardKilledArenaUnit` helper shared with `endBattleAction`) rather than lingering. This gives a kill a second, earlier commit point beyond "the battle ends" — once a front is reinforced there is no longer a slot for that kill to be undone back into, so undoing it stops being meaningful at that moment, not just at battle-end. A killed unit can still be freely undone right up until either of those two things happens.
  Review caught that only drag-and-drop could actually reach a reinforceable front: the click-to-place fallback's `myNextPosition` always computed "one past the highest position", which counted a killed unit's position too, so clicking "Place →" only ever opened a new front. Fixed by having it offer the first front held only by a killed unit before falling back to opening a new one — matching what dragging onto that slot already did.
- **Killing does not auto-discard after all (issue #75, reverts the issue #71 entry above).** The human clarified directly: ending a battle should return a killed unit's card to hand exactly like any other unit's — inBattle cleared, nothing more — and the player discards it themselves via the normal Discard button, same as the original issue-63 decision this had overridden. `discardKilledArenaUnit` is now `returnArenaUnitCardToHand`: it no longer touches `discardedItems` or writes a `DISCARD` log entry. The `killed` flag, the kill/undo-kill toggle, the DEAD tag, and `battleSummaries` excluding killed units from totals are all unchanged: this only ever affected what happens to the card once it actually leaves the arena.
- **A unit displaced by reinforcement stays locked until the battle ends, not freed immediately (issue #75, decided explicitly).** Review raised a real tension: if reinforcing a front (issue #74) returned the fallen unit's card to hand right away, that card would become placeable again *while the battle is still running* — precisely the "unit reappears in hand mid-battle" shape of the original issue-68 complaint that issue #71 had fixed by keeping `inBattle` true until the battle actually ends. Asked directly, the human chose to keep it locked: `Battle` gained `departedUnits: readonly ArenaUnit[]`, and reinforcing a front moves the unit it displaces there instead of calling `returnArenaUnitCardToHand` on it immediately — `inBattle` stays `true`, the card stays unavailable, exactly as if the unit were still standing. `endBattleAction` is the only place that frees it, iterating `[...battle.arena, ...battle.departedUnits]` so a reinforced-away unit's card returns to hand at the same moment every other arena unit's does, never before.
- **Barbarians are drawn only automatically, never by a standalone button (issue #79).** `initiateBattle` already drew 3 barbarian units for the player to the initiator's left when it starts a battle against `opponentId: 'barbarians'`; the web UI's separate "Draw 3" button let a player draw them ahead of time (or twice) for no reason, since nothing but starting that battle ever needed them drawn. Removed the button along with its now-dead `POST /battle/barbarians` route and `api.drawBarbarians` client method — the engine's `drawBarbarians` function is untouched, still called internally by `initiateBattle`. The "Discard" button (bulk-discards the whole barbarian hand, revealing it publicly) stays: it is still how a controller declines or cleans up a barbarian hand.
- **Ending a battle now logs a winner (issue #79).** A new construct with no counterpart in the old system (confirmed by search: the old backend's `endBattle` only clears `inBattle`, and the old client's battle view has no HP display or winner concept at all) — specified directly by the human. `endBattleAction` reuses `battleSummaries` (now exported from `state.ts`, was module-private) to get each side's remaining HP (already excluding killed units) plus its combat bonus (`PlayerStats.combat`, issue #43's manually-edited signed status-board stat — always 0 for barbarians, per `battleSummaries`), and logs whichever side's total is higher as the winner, e.g. "cash1981 won with 5 HP vs 2 HP". A tie goes to the defender, per the human's explicit tie-break rule. This is purely a log message computed from already-public data; `combatBonus` itself remains bookkeeping only and still does not affect anything else the engine does.

---

## 2026-09-19 — Turn orders, private planning, and replay scope (issue #69)

**Decision.** Published turn orders are browsed through one username tab per
player. Only the signed-in player's unlocked turn is editable; every opponent
tab is read-only. The five phase fields use WYSIWYG editors but continue storing
Markdown. A final **Private log** tab reuses the existing player-private
`gamenote` field and explicit `saveNote` action.

**Why.** The owner wants published orders to be easy to scan per player while
keeping future plans invisible until deliberately published. `gamenote` already
has the required private, unlogged semantics, so it is the safe place for
free-form planning without inventing a second persistence model.

**Consequences.** Private-log saves never create public game-log entries, and
another player's note never enters the client projection. Draft orders for
future turns remain deferred until there is an explicit publish model. Global
revision storage and whole-game Back / Forward / Live replay are tracked in
GitHub issue #70 and are not part of issue #69; the existing board-only replay
controls remain unchanged.

---

## 2026-09-19 — Global revision storage and replay consistency (issue #70)

**Decision.** Store immutable full `GameState` snapshots as repository records
outside the live game, identified by the existing monotonic `rev`. Project every
historical read through the same viewer-specific helpers as live state. Private
notes and chat do not create checkpoints; note writes still advance `rev` as an
optimistic-concurrency token, so stored checkpoint numbers may have gaps.

**Why.** Full snapshots make every shared transition replayable without trying
to reconstruct state from incomplete log text or board-only history. Keeping
snapshots outside `GameState` prevents recursive history. Reusing live
projections is the strongest available guarantee that old revisions preserve
hidden hands, unrevealed technologies, social policies and private logs.

**Consequences.** All game writes use repository compare-and-set semantics, so
concurrent requests return 409 instead of silently overwriting one another.
Existing games receive one baseline at the revision first encountered. MongoDB
stores the game and checkpoint in one retryable transaction and therefore
requires a replica set or sharded cluster; standalone Mongo is no longer a
supported configuration for revisioned game storage. The global replay bar
replaces board-only replay, while live board undo remains a normal shared
transition. Chat stays live during replay and private notes are sanitized out of
every stored snapshot.

---

## 2026-09-19 — Read-only games need no account (issues #81, #82)

**Decision.** Every read-only route (the game itself, its revision history,
techs, social policies, turn orders, undo status, the revealed feed and the
board-piece catalogue) now accepts a request with no bearer token, in
addition to one from any signed-in account regardless of membership. A token
that *is* present but invalid, expired, or belongs to a disabled account still
answers 401/403 exactly as before — only a genuinely absent token is treated
as "spectator". Withdrawing from a game now navigates the client back to the
games list on success, instead of trying to reload a game the withdrawn
player can no longer act on.

**Why.** The human asked for both directly: a withdrawn player landing on an
error instead of the games list (issue #82), and no way to watch a game
without an account (issue #81, "It should be able to watch without logging
in"). The projection this relies on — `toPlayerView`/`opaque()` giving a
non-member `you: null`, opponents as counts, and public-only log entries — was
already proven safe for a non-member viewer before this change; the change
only stops routes from rejecting such a viewer before reaching it.

**Consequences.** Every game is now world-readable by its id to anyone who
has the link, signed in or not — see the "Hidden information" section of
`README.md`. The first visitor (anonymous or not) to open a game's history
before anyone else has can create its revision baseline, which then shows
"Spectator" as that entry's actor in the replay bar; harmless, but visible.
Client write attempts by a viewer with no account (dragging a board piece,
drawing, etc.) still fail server-side with 401, same as ever, but the client
no longer treats that 401 as "sign out" — since there was no session to lose,
it now just surfaces the error inline instead of bouncing an anonymous
spectator back to the lobby.

---

## 2026-09-19 — Loot remains a manual hand action (issue #78)

**Decision.** Loot is exposed in the player's own hand, matching the old My
Items UI. The acting player selects the opponent who receives one random item
from one of the three old categories: Culture Card, Huts or Villages. Culture
Card is one combined candidate pool containing Culture I, II and III; players
cannot choose a culture level. No battle timing, winner, entitlement or loot
count is enforced.

**Why.** The old AngularJS client had one Culture Card button plus separate
Huts and Villages buttons. The Java resource mapped the literal `Culture Card`
to `SheetName.CULTURE_CARD`, which is exactly Culture I/II/III, and the action
shuffled the matching items from the acting player's hand. Neither layer tied
the operation to battle state or recorded a pending loot entitlement, so adding
such checks would invent rules rather than port the old system.

**Consequences.** Battle resolution and loot stay independent. The player who
loses the item initiates the transfer manually after agreeing the result with
the other players. The HTTP route also retains the old backend compatibility:
explicit valid sheet names form singleton pools, non-lootable sheets return
406, and unknown sheets return 404.

---

## 2026-09-19 — Email notifications use Resend, and unsubscribe actually unsubscribes (issue #30)

**Decision.** Transactional email returns as a server-only subsystem behind a
`Mailer` interface, with Resend as the provider (`RESEND_API_KEY`, from
`noreply@playciv.app`, links built from `APP_ORIGIN`). Ported triggers: it is
your turn (end-turn only), new game, someone joined, chat, game ended, game
deleted and the five turn-phase updates, with Java's 30-minute
per-player-in-game and 3-hour per-account throttles. The new-game broadcast is
faithful but gated by `MAIL_BROADCAST_NEW_GAMES`, off by default. The engine
stays pure — no clock, no I/O.

**Why.** Issue #30 asks for Resend and names the turn email the priority; the
owner then chose all the old triggers, the throttles and the unsubscribe links,
and asked for the broadcast behind a switch. The old provider was SendGrid and
the rewrite had no mailer at all. The API runs on Node on Render, not on the
Cloudflare Worker (the Worker only proxies `/api/*` and never sees game state),
so the key lives on Render with the rest of the API secrets.

**Consequences.**
- Throttle state lives in the repository (`mail:player:<id>` and
  `mail:game:<gameId>:<playerId>`), not in `GameState`, so it never touches
  engine purity or the revision/compare-and-set flow. Mongo uses an
  `email_sent` collection; the JSON file persists a keyed map.
- `StoredPlayer.disableEmail` is read from the legacy `player` documents and is
  now honoured for **every** notification. Java only checked it for the
  new-game broadcast and the admin mass mail, so its "unsubscribe from ALL
  emails" link did not stop chat, join or phase mail. Two deliberate
  improvements over Java: the unsubscribe link rides on every mail (Java's
  `sendYourTurn` had none), and the setting actually applies.
- The two unsubscribe endpoints keep Java's paths and its unauthenticated
  access: `GET /api/admin/email/notification/:playerId/{stop,start}`. The only
  action is to flip the account's own flag; the player id is opaque.
- Small sends are awaited in the request; the new-game broadcast stays
  fire-and-forget like Java's raw thread. When enabled it serialises per
  account, which is slow at 553 accounts — intended for deliberate use, not a
  default.
- Out of scope, as agreed: password reset (separate issue), admin mass mail
  (`AdminAction` is deferred), player replacement and tournament mail.

---

## 2026-09-19 — Email notifications: review round two (issue #30)

**Decision.** A review of the first issue-#30 pass found three functional
gaps; they are fixed here, and every resulting difference from Java is recorded
because the project ports old behaviour deliberately.

**Why.** The reference is what the old system *did*, and three of its email
behaviours were bugs that the message text itself contradicted.

**Consequences.**
- **The author is excluded by player id, not username.** Java filtered
  recipients by `getUsername()` equality (`GameAction.addChat`,
  `TurnAction.update*`). An admin can now rename an account while the game
  keeps the username it was created with, so username equality stops holding:
  the author would receive their own mail and an unrelated player could be
  excluded. `chatPosted` / `phaseUpdated` take `authorPlayerId` and compare
  `playerId`.
- **The unsubscribe link names the recipient.** Java's turn-phase mails passed
  `playerhand.getPlayerId()` — the *author's* id — into `UNSUBSCRIBE`, so the
  link on someone else's mail unsubscribed the author. Ours carries the
  recipient's id.
- **The address is the account's current one.** Java mailed
  `Playerhand.getEmail()`, a snapshot copied at join time. We look the account
  up so an admin's email change takes effect.
- **The cooldown is atomic.** `Repository.claimEmailSlot(scope, waitMs, now)`
  decides and records in one step. Java read `Player/Playerhand.emailSent` and
  wrote it back separately; two simultaneous chat messages could both pass the
  check. The JSON repository keeps the read-and-set synchronous (no `await`
  between them); Mongo claims an expired row with a conditional `updateOne` and
  creates a missing one with a guarded upsert, so only one caller wins.
- **The Resend call has a five-second `AbortSignal` timeout.** Notifications
  are sent after the game write is committed; without a bound, an unresponsive
  provider could make the client time out on a request that had in fact
  succeeded, and a retry would act on a state the player had not seen.
- The stop/start HTML now matches Java's markup exactly, so the earlier
  wrapper difference is gone.
- Still open in production: `RESEND_API_KEY` and `MAIL_FROM` must be set on the
  host that runs `packages/server`, and the from-domain must be verified in
  Resend. Cloudflare alone proves nothing until the API itself moves there.

---

## 2026-09-19 — Site-wide footer: copyright, license and PayPal (issue #77)

**Decision.** The client carries the old site-wide footer again: the copyright
line, the Apache 2.0 license link and the old PayPal donate button, rendered
under every screen the app shell can show.

**Why.** Issue #77 — "Look at the old frontend and add copyright / apache
license and donation footer on all pages". The old AngularJS footer sat outside
`ng-view`, so it appeared on every route; the rewrite had dropped it, even
though the game-ended email already tells players the donation link is "at the
bottom of the site" (`packages/server/src/notifications.ts`). The React app has
no `ng-view`, so the footer is one component that `App.tsx` renders in each of
its branches.

**Consequences.**
- The PayPal form is the old **encrypted hosted button** (`cmd=_s-xclick` plus
  the PKCS7 `encrypted` value), copied byte-for-byte from
  `old-civ-web/app/index.html`. The human chose reusing it over a new donate
  integration, so the donation still reaches the same account.
- **Patreon is not ported.** The old footer also carried a "Become a Patron!"
  link and Patreon's `becomePatronButton.bundle.js`. The human chose PayPal
  only, so neither the link nor the third-party script comes across. This is
  the deliberate difference from the old footer.
- The copyright line is `2015–2026` (the human's choice) instead of the old
  `2015–2021`; the wording is otherwise the old one and the license link is the
  same Apache 2.0 URL the About page already uses.
- Bootstrap's `pull-right` is not available here; the footer is its own flex
  row so both the light and dark themes lay it out.

---

## 2026-09-20 — Password reset uses a signed, expiring link (issue #37)

**Decision.** `PUT /api/auth/newpassword { email, newpassword }` looks the
account up by email and mails a verification link; `GET /api/auth/verify/{token}`
applies the change and answers the old HTML confirmation. The link carries a
one-hour HMAC-signed token (`ResetTokenSigner`) with the player id and the
**scrypt hash** of the new password. Nothing is stored, Java's
`/verify/{playerId}` and its plaintext `Player.newPassword` are not ported, and
an unknown email answers 200.

**Why.** Issue #37 asks for the old forgot-password flow now that the mailer
exists (issue #30). The old link was just the player id, which is public in game
state, the log and the highscore, so anyone who knew it could complete a reset;
and the pending password sat in plaintext on the player record. The owner
approved a signed token instead.

**Consequences.**
- `ResetTokenSigner` derives its key from `TOKEN_SECRET`
  (`HMAC(secret, 'password-reset')`), *not* the session secret: `TokenSigner`
  accepts any signed body with a `playerId` and a future `expiresAt`, which this
  payload has, so sharing the key would turn a reset link into a session. A test
  proves the link is not a bearer token.
- No `Repository` change: the token is self-contained, so the branch does not
  collide with the unmerged D1 branch (#72).
- The link is idempotent rather than single-use. A replay re-installs the same
  hash, so it cannot set anything new; a stolen link is only useful until it
  expires.
- Unknown emails answer 200 (Java answered 404), so accounts cannot be
  enumerated; email lookup is case-insensitive (Java was exact); the new
  password must be at least 4 characters, matching registration.
- The reset mail is transactional: `Notifications.passwordReset` ignores
  `disableEmail` and carries no unsubscribe line, because unsubscribing from
  game mail must not lock a user out of their own account.
- The verification page is server HTML, exactly like the old route; there is no
  SPA route for it.

---

## 2026-09-20 — The signup security question is enforced server-side too (issue #40)

**Decision.** `POST /api/auth/register` now requires a `securityAnswer` field and
accepts only `writing`, case-insensitive. The register form on the login screen
shows the old fixed question — "Security Question: What is China's starting
tech?" — binds the answer, and refuses a wrong one before calling the API, the
way the old client did.

**Why.** Issue #40: the old registration form had a fixed security question, and
the rewrite had none. The gate lived only in AngularJS
(`RegisterController.js:37-40`, `if(!$scope.securityQuestion ||
$scope.securityQuestion.toUpperCase() !== "WRITING") { growl.error(...); return; }`),
so a bot that POSTed straight to the endpoint skipped it entirely. The old Java
backend (`AuthResource.java` `register`) had no check at all. The human chose the
same fixed question, enforced on **both** client and server, over a rotating
question or a captcha.

**Consequences.**
- `isSecurityAnswer` in `packages/server/src/auth.ts` compares the **raw** value
  with `toUpperCase()` and does **not** trim, so ` writing` is rejected exactly
  as the old controller rejected it. Ported as-is, not "fixed".
- Server enforcement is a deliberate improvement over Java, which never saw the
  answer; recorded here and in `README.md`.
- The question and its answer are public — this is a speed bump against trivial
  bots, not a security boundary, and there is deliberately no rate limiting,
  challenge token or rotating question set.
- Existing tests that register an account had `securityAnswer: 'writing'` added
  to their payloads.
## 2026-09-19 — Storage moves from MongoDB Atlas to Cloudflare D1 (issue #72)

**Decision.** Production storage is Cloudflare D1 (SQLite), reached through the
Worker's `DB` binding, and the API runs on the Worker itself. `D1Repository`
implements `Repository`; `MongoRepository`, the `mongodb` dependency,
`render.yaml` and the Worker's `/api/*` proxy are removed. The Node entry point
stays local-development-only on the JSON file.

**Why.** The 2026-09-18 decision had to keep the API on Render because the
MongoDB driver's cursor queries hang on workerd, which costs a 30–50 s
free-tier cold start and keeps a second host and Atlas alive. The owner chose
D1 and asked to cut Render and Mongo in one move rather than run two storage
paths. D1 is also exportable (`wrangler d1 export`), so the move is reversible.

**Consequences.**
- The schema is hybrid: flat columns for what the routes query and index
  (`player.username` case-insensitively, `game(active, winner)`,
  `game_revision(game_id, revision)`, `chat(game_id, created_at)`,
  `pbf(active, winner)`), and a JSON payload for the rest of each record. The
  `Repository` boundary reads and writes whole games, so the state is not
  normalised into per-field tables.
- D1 has no interactive transactions between `await`s. Revisioned writes use one
  `batch()` — atomic on D1 — with the game update guarded by `rev` and the
  revision insert guarded by `EXISTS (game … rev = new)`, so a lost race writes
  neither. `claimEmailSlot` is one conditional upsert. `MongoRepository`'s
  requirement that Mongo be a replica set or sharded cluster goes away with it.
- Migrated data, verified by count against the restored export: 554 players
  (552 legacy SHA-1 passwords kept, 1 admin), 310 old `pbf` games (247 with a
  winner), 87,756 chat messages (83 lobby), 66,288 `gamelog` rows and 1
  tournament, in a 64 MB database. `gamelog` and `tournament` are archival —
  the app never queries them. The old `pbf` documents are archived in the
  chunked `pbf_doc` table because one document can exceed D1's ~100 KB
  per-statement limit; `pbf` itself carries only the highscore fields.
- Local development is unchanged: `pnpm dev` is Node plus the JSON file.
  `D1Repository` is tested without a database through a `node:sqlite` adapter,
  so CI (and a Windows machine that cannot run `workerd`) still covers it.
- The old `seed:test-user` and `migrate:user-roles` scripts are removed with
  Mongo; roles now arrive with the migrated data and local accounts are created
  through the UI.

---

## 2026-09-20 — D1 storage: first review fixes (issue #72)

**Decision.** Three findings from the first review round are fixed: username
lookup is Unicode case-insensitive, the migration fails on a wrong dump path,
and the D1 tests no longer skip themselves.

**Why.** Each was a real gap between local and production behaviour, and the
branch had not shipped yet, so all three belong in it rather than later.

**Consequences.**
- The earlier entry's "case-insensitively" lookup used SQLite `COLLATE NOCASE`,
  which folds ASCII only. `player.username_lower` now stores JavaScript's
  `toLowerCase` and `findPlayerByUsername` queries it, so `Åse`/`åse` behaves the
  same against D1 as against the JSON file. The restored data includes four
  non-ASCII names (`Mały`, `Mały Farciar`, `Schnüdel`, `歐派黨民`).
  `0002_username_lower.sql` back-fills existing rows with `lower()`, which is
  exact for them because none of their characters case-fold. Not UNIQUE: the
  data already contains case-insensitive duplicates (`shogun75`, `rogerio_aa`),
  exactly as the JSON repository tolerates.
- `migrate/run.ts` validates the dump directory and the required
  `player`/`pbf`/`chat` collections before writing, writes through a temporary
  file, and refuses to emit an empty dump. A wrong `--dump` now exits non-zero
  and leaves the previous output alone instead of silently emptying it.
- The root `engines` moves to Node `>=24`, where `node:sqlite` needs no flag,
  and the `describe.skip` guards are removed. A broken D1 path now fails the
  suite loudly rather than reporting green on a runtime that skipped it.

---

## 2026-09-20 — Only the old data the app uses is migrated (issue #72)

**Decision.** The MongoDB migration carries over the `player` accounts and the
full `pbf` games, and nothing else. The old `chat` (87,756 messages), `gamelog`
(66,288 rows) and `tournament` (1 document) data is dropped; the `chat` table
stays for live chat. The D1 database was deleted and re-created for this.

**Why.** The old games are not playable (2026-09-16 decision) and the owner
confirmed nothing links into them; only the accounts and the highscore source
have value. The full `pbf` document is kept — reconsidering an earlier
"highscore fields only" plan — because it is cheap (876 chunk rows) and keeps
the option of later statistics (most-researched tech, items, social policies)
open without the mongodump. The old chat/gamelog add no product value and were
what pushed the first import over D1's free-tier daily row-write limit (466,478
rows written); the reduced import writes about 2,000.

**Consequences.** The D1 database now holds about 554 players and 310 old games
(plus their archived, chunked documents), not the full restored database; the
mongodump backup remains the only source for the dropped collections.
`gamelog`/`tournament` have no tables at all, and `chat` is not back-filled. The
migration's required collections are `player` and `pbf`.

---

## 2026-09-20 — Turn orders are revealed per phase

**Decision.** A saved turn-order phase remains private until its owner clicks
Reveal. Each of SOT, TRADE, CM, MOVEMENT and RESEARCH has an independent
reveal flag; changing a published phase makes it private again until it is
revealed again. Games saved before this hotfix are migrated with their existing
orders treated as public.

**Why.** The requested hotfix needs planning orders to stay hidden until the
player deliberately publishes them. The old Java/client system published on
save, so this is a documented product change rather than a ported rule.

**Consequences.** Public projections mask both the current text and history of
unrevealed phases. The reveal action is restricted to the owner of the turn.
## 2026-09-20 — The game list is two tabs with sortable, paged tables

**Decision.** The front page splits its single list into **Active games** and
**Finished games** tabs, each a sortable table paged at ten rows, with the old
search box and "Show my games" filter above them. `GameState` gains
`createdAt: string | null`; the server stamps it at creation and
`migrateGameState` defaults a missing one to `null`.

**Why.** `old-civ-web/app/views/list.html` had exactly this split: an Active
Games tab (`dir-paginate`, 30 per page, a search box and "Show my games") and a
Finished Games tab (an `ng-table`, 10 per page, sortable by Created / Name /
Number of players). The rewrite collapsed both into one un-paged list. The
human asked for the old behaviour back, with a sortable table on **both** tabs,
the old search + "Show my games", and 10 rows per page. `GameState.createdAt` is
needed because the rewrite never carried `PBF.created` across, so the old
Created column had nothing to read.

**Consequences.** Deliberate differences from the old client:
- "Show my games" is a real filter on membership (`youAreIn`). The old
  controller implemented it by typing the username into the free-text search
  (`GameListController.showMyGames`), which also matched a username appearing
  elsewhere in another game's text.
- Both tables default to **Name ascending** — the order the server already
  returns and the active list already showed. The old finished table's default
  sort was `totalWins desc` (`finishedGamesList`, a copy-paste from the highscore
  controller), a field that does not exist on a game, so it was a no-op.
- `#` is the row's position in the whole filtered/sorted list, not the old
  active table's page-local `$index`.
- Migrated games read back with `createdAt: null` and render an empty Created
  cell. `createdAt` is public data (like `winner`), so no projection changes and
  no hidden information is affected.
- The old client only offered Join to a signed-in user; a signed-out visitor
  keeps the existing "Sign in to join" hint instead of a button that cannot work.

---

## 2026-09-20 — The game-list search and sort span both tabs

**Decision.** The search box and "Show my games" sit above both game-list tabs
and apply to whichever is open; the search matches the game name, its type and
every player's username; **Type** is a sortable column; and a numeric column
opens descending on its first click. Signing out clears "Show my games" with the
checkbox that set it. The `Open` / `Full` actions stay as the rewrite introduced
them. The finished caption counts finished games only.

**Why.** `old-civ-web`'s `list.html` put the search and "Show my games" inside
the Active Games tab only, and its Finished Games tab (`ng-table`) sorted only
Created / Name / Number of players. The human asked for one filter row over both
tabs and a sortable table on both; the review that read the old controller
found the remaining differences below. Signing out used to leave "Show my games"
ticked while the checkbox that set it disappeared, so a filtered — often empty —
list had no visible control; `GameList` now resets that filter when the player
becomes `null`. The old caption labelled the *all games* count as "finished";
the human asked to correct it and explicitly asked for no README note about it.

**Consequences.** Deliberate differences from the old client:
- The search matches name / type / usernames only. The old active tab's search
  (`filter` in `GameListController`) matched every property on the game object.
- "Show my games" is a real membership (`youAreIn`) filter, not the old trick of
  typing the username into the search text.
- Both tabs are sortable; the old finished table sorted only Created / Name /
  Number of players, so **Type** is a new sortable column.
- A numeric column opens **descending** on the first click. The old `ng-table`
  opened every column ascending; keeping the highscore's numbers-descending rule
  on every numeric column is the human's choice.
- The `Open` / `Full` actions are inherited from the rewrite, not the old client.
- The caption counts finished games, not all games.

---

## 2026-09-20 — Lobby chat serves three months newest first and sits at the bottom

**Decision.** The front page's lobby chat is the last panel, below the highscore.
`GET /api/chat` returns the last ~3 months of messages (90 days) **newest first**
and with no message cap; the web `LobbyChat` component pages them ten at a time
through the shared `Pager`.

**Why.** The human tested the front page. The chat belongs at the bottom, and the
old route's 14-day window, 50-message cap and oldest-first order were carried
over from the old backend. With a client-side pager the cap only hides history,
so the route returns everything in the window and the pager bounds what is
displayed. Newest-first puts the latest message at the top of page 1, which is
what a chat reader expects.

**Consequences.**
- `LobbyChat.tsx` (new) owns its own message input and page state; `LandingView`
  keeps the fetched `chat` array and the `reload`. After a successful send the
  input clears and the pager returns to page 1; the page is clamped if the list
  shrinks under it.
- `PUBLIC_CHAT_MAX_AGE_MS` is `90 * 24 * 60 * 60 * 1000` and the route no longer
  slices to 50. A busy lobby therefore loads up to three months of messages in
  one request — the cap is on display, not on the query. A server test feeds 60
  recent messages to prove the cap is gone.
- The same pass fixed the table-overflow bug: the games panel is full width
  rather than one `.grid` track, `SortableTable` wraps its `<table>` in
  `.table-scroll` (`overflow-x: auto`), and `.panel` gets `min-width: 0`. A wide
  table now scrolls inside its panel instead of drawing over the chat column.

---

## 2026-09-21 - Admin email broadcast (issue #92)

**Decision.** The old `GameAction.sendMailToAll` is exposed as
`POST /api/admin/email/broadcast` (admin only) with a WYSIWYG Markdown body
rendered to HTML by `marked`, an editable subject defaulting to
"Message from cash at playciv.app", and a checkbox that also mails players who
have unsubscribed. The composer lives on the admin page (`/admin`).

**Why.** Java really had the method, but its only caller - `PUT /admin/mail` -
had the `gameAction.sendMailToAll(msg)` line commented out and always answered
204, and no old-client UI existed, so the feature was dead. Issue #92 asked for
it back as a Markdown editor on the admin page. `marked` was chosen because it
is pure JS with no Node built-ins, so it runs on Cloudflare Workers.

**Consequences.**
- The body is Markdown rendered to HTML, with the Markdown source as the
  plain-text fallback; each mail keeps Java's `Hello <username>` greeting and the
  unsubscribe footer (a real link in the HTML part).
- No sanitising of the rendered HTML: only an admin can reach the route, and an
  admin already controls every account, so the content is trusted. The
  recipient's username is escaped, because it sits outside the admin's Markdown
  and an admin may have set it to raw HTML through the user editor.
- Sends run in-request, one provider call per recipient, exactly like the old
  `sendMailToAll` and the existing game mails. A very large account list could
  hit the Worker's subrequest/CPU limits; that is a known limitation, not fixed
  here. One recipient's failure is logged and swallowed - never thrown out of
  the loop - and counts as `skipped`, so `skipped` means "not sent".
- Disabled accounts are not filtered. Java's `sendMailToAll` filtered only on
  `disableEmail`, and the game mails behave the same, so this does too.
- Deliberate differences from Java: the default subject uses the current domain
  (`playciv.app`, not `playciv.com`); and the unsubscribe link is on every mail,
  as with the other notifications.

---

## 2026-09-21 - Movement as an expression (issue #102)

**Decision.** The Movement value on the Player status board (issue #43) is
stored as literal text, not as a base/bonus pair. It accepts a base number with
zero or more `+<bonus>` parts - `2`, `3+1`, `2+1+1` - and shows exactly what
was typed. `PlayerStats.mvmt` is therefore `string` (default `'2'`), every
other stat stays `number`. The shared `isMovementValue` / `MOVEMENT_VALUE_PATTERN`
in `state.ts` is used by both the engine and the client, so the two cannot
drift. A bare number is still accepted and normalised to its string form, so
older callers and saves keep working, and `migrateGameState` converts an older
game's numeric `mvmt` to text.

**Why.** Natural religion adds one movement to an army figure, and players write
that at the table as `3+1`; the numeric cell from issue #43 refused it
(issue #102). Movement is pure bookkeeping - it is never added up or used in a
rule - so there is nothing to gain from parsing it into two numbers. The status
board and its Movement stat have no counterpart in `old-civ-rest` or
`old-civ-web`, so this deviates from nothing in the old system; it is a new,
human-specified field.

**Consequences.**
- `setPlayerStat` is generic over the stat key (`PlayerStatValue<K>`), so that
  passing a Movement expression to a numeric stat is a compile error as well as
  the existing runtime `INVALID_STAT_VALUE`.
- The `POST /api/games/:id/players/:id/stat` route accepts a string `value` for
  `mvmt` and still accepts a number or numeric string for the others. It is
  bookkeeping, not a game rule: no enforcement, no arithmetic.

---

## 2026-09-21 — Culture track artwork replaced, and re-measured to 20 spaces

**Decision.** The culture track backdrop is
`Civilization/Moderator/map/culturetrack.png`, not the older
`DoC/PBF Modding Material/culture track.png`, and the engine's measurement
follows it: 20 spaces between Start and Culture Victory instead of 27. The band
keeps the height it had (164 px at board width 1504), which drops
`CULTURE_TRACK_SCALE` from 1.7 to 1.3 because the new artwork is less wide.

**Why.** The human: the track that was implemented is the wrong one. The new
file is narrower (2572 × 216 against 3349 × 215) and carries a genuinely
shorter track of 20 spaces in three groups of 7, 7 and 6, with the same carved
pillars between them. The human chose, when asked, to follow the artwork (20
spaces) and to keep the band the same height rather than grow the board.
Neither `old-civ-rest` nor `old-civ-web` has a culture track, so there is no
old-system behaviour to contradict; the human is the authority for it.

**Consequences.**
- `CULTURE_TRACK_CELLS` is 20; `CULTURE_VICTORY_STEP` is 21.
- Only `CULTURE_TRACK_SCALE` changed to hold the printed height; the band
  height is still the artwork's aspect times that factor.
- Markers on an existing game are read back against the new, shorter track. A
  marker that sat on a space number that no longer exists reads as the nearest
  remaining space. No migration is needed: the board stores pixel positions,
  not step numbers, and history entries already written are unchanged.
- The cell spans in `board.ts` are in the artwork's own pixels, found by the
  same dark-divider measurement as before.

## Starting tile orientation

**Decision.** When a civilization is revealed, its starting tile is laid in the
player's corner turned so the printed arrow points at the middle of the board.
On the full board player 1 is north-west, 2 north-east, 3 south-east and 4
south-west. On the two-player 16 × 8 board the two players sit in opposite
corners — player 1 north-west (A1–D4), player 2 south-east (M5–P8) — and because
the board is long and short their arrows run along the long axis at each other:
the north-west tile points east (90°) and the south-east tile points west (270°).

**Why.** The human reported a four-player game where every starting tile faced
outwards, and then a two-player game where both tiles sat along the top. The
placement is new behaviour — neither `old-civ-rest` nor `old-civ-web` has a
board — so there is no old-system rule to check it against and the human is the
authority, exactly as the culture track is. The commit that introduced it
(`3092d92`) already stated the intent, "pilen inn mot midten"; the code's
assumption about the artwork was what was wrong. The human picked the final
orientation from two rendered candidates and verified the result in the browser,
and waived the review gate.

**Consequences.**
- The artwork is not touched. All sixteen starting tiles have the arrow on the
  bottom edge pointing up, so a single per-corner table fixes every
  civilization. Only `startingCorner` and its test change.
- The per-corner rotations are `[180, 180, 0, 0]` for
  `[north-west, north-east, south-east, south-west]` on a full board, and
  `[90, 270]` for `[north-west, south-east]` on the two-player board.
- `startingCorner` reads the player count off the board, not from a parameter:
  two block rows means the two-player board, and the corner list becomes
  north-west then south-east.
- Tiles already placed in saved games keep the rotation stored on the piece.
  Nothing is migrated: a stored rotation is player-owned state, and the affected
  games are pre-release and can be turned with the existing rotate control.

