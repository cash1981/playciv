# Civilization: The Board Game — version 2

A rewrite of Sid Meier's Civilization: The Board Game (Fantasy Flight Games), with the *Fame and Fortune* and *Wisdom and
Warfare* expansions.

It replaces two old repositories:

| Old | Stack | Replaced by |
| --- | --- | --- |
| `old-civ-rest` | Java 8, Dropwizard 0.8, MongoDB/MongoJack, Apache POI | `packages/engine` + `packages/server` |
| `old-civ-web` | AngularJS 1, Bootstrap, Grunt/Bower | `packages/web` |

The old solution ran on playciv.com and showed the board through a Google
Presentation and a Google Spreadsheet in an iframe (`mapLink` / `assetLink`).
That is gone and has not been ported; the board now lives in this codebase.

## Running the app

Needs Node 20 or newer, and pnpm.

```bash
pnpm install
```

Start the API in one terminal:

```bash
pnpm --filter @civ/server dev
```

And the client in another:

```bash
pnpm --filter @civ/web dev
```

The client is on http://localhost:5173 and proxies `/api` to the server on port
8787. Register a user, create a game, and let the other players join — the game
starts by itself once the last seat is filled.

Choose a board color when creating or joining a game. The join list offers only
colors available for that seat. If you replace a player who withdrew, you take
over their hand and its existing color. The server rejects invalid or occupied
color choices; older requests that omit a color still get an automatic choice.

Set `TOKEN_SECRET` before starting the server if logins should survive a
restart. Without it a random secret is made on every start.

```bash
pnpm -r test
```

## Packages

### `packages/engine`

Pure domain logic. No HTTP, no database, no UI. Every reducer is a pure
function:

```ts
(state: GameState, action: DrawInput) => Result<GameState, EngineError>
```

Nothing throws. The old Java actions threw `WebApplicationException` with an
HTTP status straight from the domain logic; here errors are values, and the HTTP
mapping belongs to the server package.

Randomness lives in the state as a seed (`state.rng`), so a game can be
reproduced and replayed. Java used `Collections.shuffle` against a global
source.

| File | Ported from |
| --- | --- |
| `src/sheet-name.ts` | `SheetName.java` |
| `src/item.ts` | `Item` and the subtypes `Civ`, `Unit`, `Tech`, `Wonder`, `Hut`, `Village`, … |
| `src/state.ts` | `PBF.java`, `Playerhand.java` |
| `src/log.ts` | `GameLog.java`, `GameLogAction.java` |
| `src/gamedata.ts` | `excel/ItemReader.java`, without Apache POI |
| `src/create-game.ts` | `PBFTestAction.createNewGame` |
| `src/turn.ts` | `PlayerTurn.java` (and `TurnKey.java`, which never worked) |
| `src/undo.ts` | `Undo.java` |
| `src/actions/draw.ts` | `action/DrawAction.java` |
| `src/actions/player.ts` | `action/PlayerAction.java` |
| `src/actions/undo.ts` | `action/UndoAction.java` |
| `src/actions/turn.ts` | `action/TurnAction.java` |
| `src/actions/game.ts` | the game part of `action/GameAction.java` |
| `src/board.ts` + `src/actions/board.ts` | new — replaces the Google slide behind `mapLink` |
| `src/random.ts` | replaces `Collections.shuffle` and `RandomUtils` |

### `packages/server`

Hono on top of the engine, so the same HTTP code runs on Node (local
development, JSON-file storage) and on Cloudflare Workers (production, D1).
Java counterpart: `resource/*` and `application/*` under Dropwizard.

| File | Responsibility |
| --- | --- |
| `src/routes/auth.ts` | `AuthResource` — registration, login and password reset |
| `src/routes/games.ts` | `GameResource` — create, list, join, withdraw, end, log, chat |
| `src/routes/play.ts` | `DrawResource` + `PlayerResource` — draws, battle, tech, reveals, trade, turns, undo |
| `src/errors.ts` | `EngineError` → HTTP status |
| `src/auth.ts` | scrypt passwords, HMAC-signed bearer tokens and the reset-link signer |
| `src/routes/board.ts` | the board — place, move, rotate, front, back, remove, undo, redo, history |
| `src/routes/arena.ts` | battle arena — initiate, place units, move, return to hand, set stats, rotate, kill, end turn, end battle |
| `src/store/` | the storage interface, `D1Repository` (production) and `JsonFileRepository` (local dev) |
| `src/migrate/` | the one-off mapping from the old Mongo export to D1 rows |

The server holds no game rules. Every route loads the state, calls one pure
function from the engine, saves the result and answers with
`toPlayerView(state, you)`. A route therefore cannot leak someone else's hand
even if it wanted to.

Environment variables: `PORT` (8787), `HOST`, `DATA_FILE`, `TOKEN_SECRET`,
`CORS_ORIGIN`. The Node server always uses the JSON file; production's D1 and
mail secrets live in the Cloudflare dashboard (see [Storage](#storage-d1-in-production-a-json-file-locally)).

### `packages/web`

React and Vite. Replaces the AngularJS app in `old-civ-web`. Deliberately plain
— the artwork comes later. It covers login, the game list, and the game page
with hand, draws, battle, technology, social policy, the chat and orders
timeline, log and undo voting.

The client imports its types from `@civ/engine`, so it cannot drift out of step
with what the server actually sends.

Every page also carries the old site-wide footer: the copyright line, the
Apache 2.0 license link, the PayPal donate button (issue #77) and a Buy Me a
Coffee button beside it.

## The board

At the top of the game page sits an interactive board that replaces the Google
Presentation slide `PBF.mapLink` used to point at.

The geometry comes from `Civilization/Moderator/4v4 Map Template.pptx`: 16 × 16
squares labelled A–P and 1–16, made of 4 × 4 map tiles of 375 × 375 pixels. That
gives a square of 94 pixels, which is exactly the size of the city, building and
city-state pieces in the same folder.

Pieces are placed at **free pixel coordinates**, not locked to squares. That is
how the PowerPoint template was used, and it is what makes it possible to stack
several pieces in one square. The order of `board.pieces` **is** the z-order, so
"to front" is simply a move to the end of the list — no z-index to keep track
of. The board still shows which square a piece stands in, worked out from its
centre.

Every player sees and can move every piece, as at a physical table. With a
piece selected, the arrow keys nudge it a small step in that direction — the
step is a constant number of screen pixels, converted by the current zoom
level, so it looks the same size at any zoom (issue #193).

The palette has twelve categories, generated from the images on disk. Buildings
and resources use finite physical supplies: the physical building counts are
read from the reference sheet, wheat, iron, silk and incense are each limited by
the player count, and each Great Person type has three board pieces. Each colour
has six armies and two scouts; Russia also has one white army, which only the
Russian player can place (issue #204). Huts and
Villages are **unlimited** — they are picked up during play rather than dealt
from a setup supply, so the player-count cap does not apply to them (issue
#116). Each of the five relics (Ark of the Covenant, Atlantis, Attila's Village,
School of Confucius, Seven Cities of Gold) exists once per game: placing it
uses it up, and removing it from the board puts it back (issue #227). The
separate Great Person card deck remains a hand/draw mechanic.

| Category | Count | From |
| --- | --- | --- |
| Figures | 11 | army and scout in five colours, plus Russia's white army |
| Resources | 6 | hut, village, wheat, iron, silk, incense |
| Markers | 7 | coin, culture, caravan, fortification, wound, first player, building program |
| Cities | 30 | capital/city/metropolis, with and without walls, per colour |
| City-states | 5 | the five neutral city-states (cs1–cs5) |
| Buildings | 15 | market, temple, library, … |
| Relics | 5 | the five relic markers, one of each per game |
| Great People | 6 | artist, builder, general, humanitarian, merchant, scientist |
| Starting tiles | 16 | one per civilization |
| Map tiles | 28 | exploration tiles 1–27, plus the back |
| Leaders | 80 | culture-track markers, per civilization and colour |
| Wonders | 27 | the 27 wonders, placed in the shared Wonders area |

### Player areas

Below the map, separated by one square of empty space, sits a band with one
area per player — the tabletop in front of each seat. Each area carries a name strip in
the colour of that player and is the same drag surface as the map, so anything
can be dropped there: a hut a scout just picked up, the buildings you have
bought but not placed, wounded units, coins.

The band is derived from the player list, so it works for two to five players,
and every player's area is visible to everyone. A shared **Wonders** area sits
at the right of the band — the player areas shrink to make room — and holds the
wonders. Dropping a piece into an area **tidies it into the next free slot**,
filling left to right and wrapping onto a new row, so an area never turns into a
heap. Dropping on the map leaves the piece exactly where it was let go. Nudging
a piece with the arrow keys is the one exception to both: it always moves the
piece by exactly the requested step, whether that piece sits in an area or on a
map tile slot, rather than being tidied or re-snapped (issue #193) — only a
pointer drag tidies or snaps.

Wonders are the one card kind that never enters a hand. The wonders drawn at the
start of a game (and any drawn later from the draw menu) are placed in the
Wonders area and named in the public log, rather than kept secret in a hand —
they were never giftable or hidden bookkeeping the way ordinary cards are. Once
every seat's civilization is revealed, the game deals 4 ancient wonders into
the Wonders area — 3 ancient and 1 medieval instead, if Egypt is in the game,
since Egypt's own starting wonder is placed directly in Egypt's own player
area rather than the Wonders area, and is owned by Egypt from the moment it is
placed (issue #172).

Areas are geometry, not state: the server computes them in `toPlayerView` and
sends them along as `boardAreas`, so client and server cannot disagree about
where an area is.

### Map tiles

A map tile covers 4 × 4 squares. The source images are 375 × 375, one pixel too
narrow, and are scaled to 376 so they line up with the grid.

Tiles go to the **bottom** of the stack, otherwise they would cover the pieces
standing on them. They can be turned in four directions — the arrow on the tile
shows which way up it belongs.

Two things happen on their own:

**The starting tile of a civilization** is laid out when the player reveals
their civ card. Player 1 gets the top left slot (A1–D4), 2 the top right, 3 the
bottom right and 4 the bottom left, and the tile is turned so the arrow points
inwards. In the image files the arrow points down — checked against `japan.jpg`
and `germany.png` — so the rotations are 0°, 90°, 180° and 270° around the edge.

**A drawn exploration tile** lands in the first free 4 × 4 slot. The system does
not know which area the player is exploring, so this is a convenience and not a
game rule; the tile is dragged and turned into place from there.

```bash
pnpm --filter @civ/engine board-assets
```

`tools/board-assets.ps1` copies the PNGs to `packages/web/public/board/` and
writes `packages/engine/data/board-assets.json` with the real image sizes. The
manifest lives in the **engine**, not the client, because the server has to be
able to refuse a piece pointing at an unknown file — without it a client could
send any string at all as an image reference.

### History, undo and replay

Every change to the board is recorded. Dragging a piece, placing one from the
palette, rotating it, bringing it to front or sending it to back, removing it,
clearing the board — each becomes one entry in `board.history` with who did it,
when, a readable description ("cash1981 moved Red army from E4 to H8") and the
semantic operation itself.

Recording the operation rather than a snapshot is what makes the rest work:

- **Undo** reverts the last entry exactly, but only your own: it works while
  your change is still the most recent one, and refuses once someone else has
  acted since (issue #174). The entry moves onto a redo stack rather than
  being dropped.
- **Redo** brings back the change an undo just took away. Anyone may redo, the
  same way anyone may move a piece — it is only undo that is scoped to its
  author. Any further change to the board, by anyone, clears the redo stack.
- **Replay** rebuilds the board at any step by applying the entries from the
  start, so the back and forward arrows walk through the whole game from the
  first placement to the present. While replaying, the board is read-only and
  the log is trimmed to what was known at that step — each entry remembers the
  length of the game log at the time it last became current (a change brought
  back by redo gets this refreshed, since it is current again only once redone).
  That is how you can watch what an opponent
  did while it was not your turn.

Board moves are deliberately **not** written to the game log. A turn consists of
many small adjustments and the log would drown; the board history is the record,
and it is shown as its own list next to the board where each entry can be
clicked to jump there.

Games saved before the history existed get one synthetic `place` entry per piece
at load time (`src/migrate.ts`), so replay is exact for them too.

## Storage: D1 in production, a JSON file locally

`packages/server/src/store/types.ts` defines a `Repository` with two
implementations. Local development (`pnpm dev`) always uses the JSON file;
production runs on the Cloudflare Worker against D1 (issue #72).

**`JsonFileRepository`** keeps everything in `Map`s in memory and mirrors it to
`packages/server/data/civ.json` after each change — debounced, and atomically
through a temporary file that is swapped in. Enough to play locally, and games
survive a restart. Delete the file to reset everything.

**`D1Repository`** runs against Cloudflare D1 (SQLite) through the Worker's `DB`
binding. The schema is hybrid: flat columns for the fields the app queries and
indexes, and a JSON payload for the rest of each document — the `Repository`
boundary always reads and writes a whole game, so the state itself is not
normalised. `packages/worker/migrations/0001_initial.sql` is the single source
of truth; the repository tests apply that same file to an in-memory SQLite
database through Node's `node:sqlite`, so no live database is needed.

D1 has no interactive transactions, so the compare-and-set writes are single
guarded statements or one `batch()`, which D1 runs atomically:

- `saveGameWithRevision` updates the live game only while `rev` is unchanged
  and inserts the checkpoint guarded by `EXISTS (game … rev = new)`, so a lost
  race writes neither.
- `claimGameEmail` is one conditional upsert.
- A revision in `game_revision` is a keyframe or a delta (`kind`, `base_revision`,
  migration `0006_revision_delta.sql`); `saveGameWithRevision` takes the previous
  state from the caller, writes a delta only after checking that it gives the new
  state back, and the update that wins the compare-and-set also checks that the
  chain it was computed for is intact. `JsonFileRepository` keeps the same rows.

Tables: `player`, `game`, `game_revision`, `chat` (`game_id IS NULL` is lobby,
live from now on), `game_mail` (when each player was last emailed about a
game and last opened it), `broadcast` + `broadcast_recipient` (the admin
broadcast queue, migration `0005_broadcast_queue.sql`), server-only activity and
reminder columns on `game` (migration `0007_turn_reminders.sql`), `email_sent` (imported, no longer read), and `pbf` + `pbf_doc` (the old games,
read-only: a highscore source plus the full document, chunked because one
document can exceed D1's ~100 KB per-statement limit, kept for future
statistics such as the most-researched tech). The old `chat`, `gamelog` and
`tournament` data is deliberately not migrated — the mongodump backup keeps it.

`player.username_lower` stores the username folded with JavaScript's
Unicode-aware `toLowerCase`, and that is the column the login lookup queries —
SQLite's `COLLATE NOCASE` folds ASCII only, which would make `Åse`/`åse` behave
differently in production than locally.

The old accounts keep their passwords: Java's unsalted SHA-1
(`DigestUtils.sha1Hex`) verifies and, on a successful login, is rewritten to
salted scrypt. Old ids are `ObjectId` strings, new ones UUIDs.

### Migrating the old data

The restored `playciv` MongoDB export lives outside git in
`Civilization/database backup/mongo`. It becomes SQL with:

```bash
pnpm --filter @civ/server migrate:d1 -- --dump "<dump dir>"   # writes packages/server/dump.sql
wrangler d1 migrations apply playciv --remote
wrangler d1 execute playciv --remote --file=packages/server/dump.sql
```

The script never touches a database; the mapping is pure and unit-tested, and
each generated statement stays under D1's per-statement limit. A missing dump
directory or a missing `player`/`pbf` file fails the run and leaves any
previous output untouched — it never writes an empty dump. The old `pbf` games
stay read-only — Java's `PBF` shape is nothing like our `GameState`, so they are
not migrated to playable form, exactly as before.

Issue #87 has a separate, one-time rating backfill for databases already
migrated to D1. After applying migration `0003_rating.sql`, run:

```bash
pnpm --filter @civ/server migrate:rating "<dump dir>/playciv.pbf.json" "<rating.sql>"
wrangler d1 execute playciv --remote --file="<rating.sql>"
```

The script reads the original private export locally and writes only game IDs,
an ordering key and player placements. Keep the generated SQL outside git. Its
upserts make a rerun safe; changing any result invalidates the stored highscore
response. It does not make the old games playable.

There is no database integration test in CI; the shared repository logic is
covered by the JSON implementation and by the `node:sqlite` adapter. The
repository tests and the migration need Node 24 or newer (`node:sqlite` without
a flag), which the root `engines` field requires.

### Highscore

`GET /api/highscore` needs no token. Its wins, attempts and efficiency tables
retain Java's `getPlayerHighScore` / `getCivHighscore` behavior, including the
`percentWin` formatting and descending-username tiebreak. Player rating uses
the open-source OpenSkill library on results from both old and new finished
games. Old games use only evidence in the archive: known techs, owned culture
cards (including owned discards), and provable printed coins. The winner is
first; uncertain nonwinners share a placement. Nine old wins have just one
recorded participant and count toward wins but cannot update a multiplayer
rating. New games use each player's culture marker position at the finish and
the coin total from the player's status counters; culture cards are not used
to infer their progress. The complete public response is stored in
`highscore_cache` and rebuilt only when source data changes. The Highscore page
can sort players by rating and shows the conservative OpenSkill value as a
rounded integer multiplied by 100; this value can be negative.

## Game data

`packages/engine/data/gamedata-faf-waw.json` is generated from
`old-civ-rest/src/main/resources/assets/gamedata-faf-waw.xlsx`:

```bash
pnpm --filter @civ/engine gamedata
```

`tools/xlsx-to-json.ps1` reads the xlsx directly as zip and XML through .NET,
without Apache POI. The JSON is a raw cell dump, not interpreted game data, and
reproduces POI's `Cell.toString()` on purpose — including numeric cells becoming
`"12.0"` and formula cells becoming `"RAND()"`. Those quirks are exactly what
`ItemReader.java` filtered on, so a faithful port needs them.

Regenerate the JSON if the spreadsheet changes. Do not edit it by hand.

## Hidden information

The old system stored the whole drawn card on the log document in Mongo and let
the resource layer filter it. `todo.txt` in old-civ-rest calls that a security
hole, and the fix there was piecemeal.

Here the split is in the types:

- `GameLogEntry.item` and `.privateLog` hold the full information.
- `toPublicLog(entry)` gives a `PublicLogEntry` without them.
- `toPlayerView(state, viewerId)` gives your own hand in the clear, opponents'
  hands as counts, the deck as a count, and other people's log entries in public
  form only.

Covered by `packages/engine/test/hidden-info.test.ts`.

Every game is world-readable by its id: a signed-out visitor, or a signed-in
player who is not one of its members, gets exactly this same non-member
projection — `you: null`, opponents as counts, log entries in public form only
(issue #81, "watch without logging in"). No account is required to read a
game, only to act in one.

## Known differences from Java

The old tests are the reference. Wherever Java and an expectation disagreed,
Java won.

**Reshuffle does not collect from the players' hands.**
`DrawAction.reshuffleItems` only puts back what is in `pbf.discardedItems`, and
only for the kinds in `SHUFFLABLE_ITEMS`: units, great person, culture cards
I–III and civ. Huts, villages, tiles, city states and wonders cannot be
reshuffled at all — Java threw `IllegalArgumentException`, the engine gives
`NOT_SHUFFLABLE`. `ItemReader.redrawableItems` was built to collect from hands
but was never used anywhere. See `sheet-name.test.ts` and `draw-action.test.ts`.

**Units are always level 0.** `setLevel` is called nowhere in old-civ-rest. The
level tables (Spearmen, Pikemen, Riflemen, Modern Infantry and the counterparts
for Artillery and Mounted) are ported because `revealPublic` and `revealAll`
branch on them, but they have no effect until unit upgrades are implemented.

**Column A and only column A.** `columnIndexZeroPredicate` means the unit sheets
are read from the first column only. Columns B to D hold stats for upgraded
levels and are never read.

**Inconsistent image filenames are kept.** `Civ` does not strip spaces while
everything else does, culture cards strip exclamation marks, great persons are
prefixed with `klein`, and city states use `description` rather than `name`. The
filenames on disk under `Civilization/Moderator/` follow those rules, so they
have not been tidied.

**Social policy images are lower-cased.** Java's `SocialPolicy.getImage()` kept
the name's case; here they are lower-cased to match the *Wisdom and Warfare*
artwork under `Civilization/WaW/`, which is all lower case. See
`docs/agents/decisions.md`. The `Expansionsim` spreadsheet typo is kept in the
data; only the on-disk file is aliased.

**One social policy flipside is corrected, unlike the `Expansionsim` typo
above.** The sheet had `Military Tradition` pointing at `Patronage` instead of
back at `Pacifism` — the only one of the four flipside pairs that wasn't
symmetric, and unlike `Expansionsim` this typo changed rejection behaviour
(issue #175: `Military Tradition` stayed choosable after `Pacifism`, when the
two are opposite sides of one physical card). Corrected in `gamedata.ts` at
parse time, plus a migration for games saved with the old value. See
`docs/agents/decisions.md`, 2026-09-25.

**Double spaces in the log are kept.** Java wrote
`username + " drew " + " - " + …`. The texts are comparable data and the old
tests match on them.

**Players can draw their own barbarians.** The Battle panel's "Draw barbarians"
button lets any game member draw their own three-unit barbarian hand before
an arena starts, without waiting for the attacker to select Barbarians.
Starting a barbarian battle reuses the left-side controller's existing hand;
when that hand is empty it still draws automatically. Existing hands, active
arenas and stale revisions prevent another manual draw. Hidden cards remain
private until played or discarded. This restores manual drawing at the human's
request; see `docs/agents/decisions.md`, 2026-10-07.

**A unit revealed "from their battlehand" now actually shows as public.**
`DrawAction.revealAndDiscardBattlehand`'s `revealUnitConsumer` only built the
log message (`" reveals " + names + " from their battlehand"`); it never
called anything like `setHidden(false)` on the actual units. That is a bug
Java itself had, not a design choice — visible through
`GameAction.getAllRevealedItems`, the direct ancestor of this engine's
`revealedFeed`/`allRevealedItems` (issue #51), whose own `!isHidden()` filter
is correct as written but could only ever see what `revealUnitConsumer` left
unhidden. The log line already declared those exact units public, but the
structured "what's publicly known" view never agreed, in Java or in the first
port of this action. Corrected here by revealing the exact battlehand item
instances (matched by `id`) alongside emptying the battlehand, so the log and
the panel agree. Forward-only, per the human: a game already holding a unit
stuck in this state from before the fix keeps it hidden, because only the old
log's free-text unit names survive for it, not a reliable item reference, and
guessing from a name risked revealing a *different*, never-actually-named
card of the same type — an unacceptable trade for retrofitting old data. See
`docs/agents/decisions.md`, 2026-09-25.

## Deliberate improvements

**A battle can be un-ended.** Ending a battle used to be final, so a mis-click
threw the arena away. Now the player who pressed End battle gets an Undo button
where the arena was, which brings back the same arena, turn and units and locks
the unit cards again. No vote: only the player who ended it may undo, and the
button stays until a new battle is started. Nothing new is revealed when a
battle ends; the arena was already public and the end writes no unit names to
the log. See `docs/agents/decisions.md`, 2026-10-08.

**The hand has no heading per kind.** The hand keeps the old client's order
(civilizations, items, great persons, units, tiles, culture cards, huts,
villages), but the cards flow in one grid instead of one section per kind, so
short groups do not leave empty space. `useritems.html` rendered a heading per
kind. See `docs/agents/decisions.md`, 2026-09-29.

**Cards can be used with a button.** A player with Chivalry, Democracy or
Printing Press sees a "Your actions" panel, and the same button in the card's
detail dialog, that does the bookkeeping for the card: Chivalry spends an
incense (a hut in hand first, otherwise the piece in the player's own area,
back to the stock) and adds 5 culture; the two coin cards pay and add a coin.
Every card is once per turn. The press is recorded, shown in the log, and can be
taken back with the same everyone-votes undo the game already has. Typing the
same thing in chat or editing the counters by hand still works. See
`docs/agents/decisions.md`, 2026-10-09.

**Opponents' public hands show face-down cards.** Issue #142 adds one generic
card back for each culture card, hut, village, great person and unit in another
player's hand, grouped by player and category. Spectators see the same counts.
The server projects category totals only; it sends no item identity or card
artwork through this view. Java and the old client showed only the owner's own
hand, so this is a requested extension rather than a ported display. See
`docs/agents/decisions.md`.

**Social policies are revealed like technologies.** Java stored a chosen policy
in the player's hand hidden and never revealed it; the port adds
`revealSocialPolicy` (issue #6) and shows every player's revealed policies on
their own tab of the Social policy panel (issue #140), the same way
`revealedTechsForAllPlayers` has always shown technologies. A hidden policy
stays private — only its count is public — and a revealed one is also named in
the public log. The Techs and Social policy panels each have one tab per player,
labelled with the username and the player's colour. See `docs/agents/decisions.md`.

**The password reset link is a signed, expiring token.** Java emailed
`/api/auth/verify/{playerId}` and stored the pending password in plaintext on
the player record, so anyone who knew a public player id could complete a reset.
Here the email carries a one-hour HMAC token holding the id and the scrypt hash
of the new password: nothing is stored, the plaintext is never persisted, and an
unknown email answers 200 so accounts cannot be enumerated. The reset mail also
ignores the unsubscribe flag and carries no unsubscribe link, because
unsubscribing from game mail must not lock a user out of their own account. See
`docs/agents/decisions.md`.

**A player status board instead of a shared spreadsheet.** The old app embedded
a per-game Google Sheet that players kept by hand. That is now an in-app "Player
status" panel: shared bookkeeping includes trade, culture, unit counts,
movement/combat/stacking values, a Combat hand size note and EftA/Infra/MIC/PE
modifiers. Every value except Combat and Culture hand size is editable by any
member of the game, with every edit written to the public log. Combat is
calculated automatically from buildings, generals, MIC investments, government,
civilization and the Statue of Zeus. Culture hand size starts at 2 and is
calculated from Pottery, Civil Service and Theology (+1 each), Computers (+1 per
5 coins), Valmiki (+2 while revealed and usable, suppressed when all tracked
Artist or Thinker tokens are blockaded, gone again when discarded), the first
Endowment for the Arts investment (+1) and owning Cristo Redentor (+4). A hidden
tech or Great Person counts for nobody until it is revealed; the wonder needs no
reveal, since the board is public. Combat hand size is free text, such as `+1`.
New games start with the standard unit and modifier defaults.
The panel's **Coins** section tracks one row per source — Code of Laws, Pottery,
Civil Service, Democracy, Printing Press, Bureaucracy, Railroad, Computers,
Education, Bank, Adam Smith, Democracy (Govt), Great People, Terrain, Panama
Canal, Organized Religion and Sheet — and the status table's Coins column shows
the read-only total. Coin-token techs hold up to four coins (six with an active
Internet); static card sources hold one. Bank, Adam Smith, Great People, Sheet
and Panama Canal have no shared cap. Bank coins are derived per unblocked Bank
in a uniquely owned city footprint, including the ten outskirts around a
metropolis in either orientation; Sheet remains the manual path for scout
transfers. Adam Smith adds one separate coin while revealed and
usable, in addition to Merchant token coins.

Coin-token techs, Organized Religion, Democracy (Govt) and Panama Canal appear
when their source is available. Bank, Adam Smith, Great People, Terrain and
Sheet rows are always visible; keeping Adam Smith visible at zero avoids
revealing a hidden card through the presence of a row. A counter that still
holds coins stays visible until it is lowered. Removing a tech, policy or
government source clears its counter. The player assigned to *The Internet* can
hold up to two extra coins on Code of Laws, Pottery, Democracy, Printing Press
and Education. Revealing a card that prints a flat "1 coin" sets its counter
to 1 at once: Organized Religion, Civil Service, Bureaucracy, Railroad and
Computers; moving to the Democracy government does the same for Democracy
(Govt). The player can still lower them to 0. Anarchy sets Organized Religion
to 0, and leaving Anarchy restores 1 for a revealed policy. The "up to 4" tech
counters remain editable for correction. During a player's open City Management
phase, the Democracy and Printing Press buttons spend 6 trade or 5 culture for
one coin each, once per turn. Wonders in play are listed with an
assignable owner wherever the piece currently sits on the board, until it is
removed entirely — not only while it sits in the shared Wonders area, which
still governs *The Internet*'s and the Panama Canal's coin allowances above.
A game saved with the old single coin number loses it: the human
chose that the counters replace it. Movement is the one value written as an
expression rather than a plain integer:
natural religion adds one movement to an army figure, so it is recorded as
`3+1`. It is still pure bookkeeping, never added up or used in a rule.

**Government is structured public bookkeeping.** The old app had no government
field, endpoint or dedicated UI; players recorded it only through the embedded
Google spreadsheet. The rewrite stores each player's government as a public
field in game state. Any game member may change any player's government from
the status panel, and each change is written to the public log. New and migrated
players default to Despotism; choosing Romans, Russians or Japanese sets the
documented Republic, Communism or Feudalism starting exception respectively.
The panel also shows the text of all eight *Wisdom and Warfare* government cards
as a reference. Their effects are not enforced by the engine: unlocks, Anarchy,
change timing and card effects remain table-managed rules.

**A stable `id` per item instance.** Java identified items by value equality
(`@EqualsAndHashCode` on name/description/type), which meant two identical
`Infantry 1.3` were "equal" and `discardedItems.remove(item)` could remove the
wrong instance. Every item now has an opaque id. `itemNumber` is kept for log
compatibility, and its starting offset is still random per game so the number
does not give the card away (techs and social policies are the exception, since
their numbers are in the public catalogue; their log lines use a keyed number
instead, see `decisions.md`, 2026-09-30). `itemValueEquals` is still there where the Java
semantics are needed.

**Space Flight is not a singleton.** Java had `Tech.SPACE_FLIGHT` as a static
field — mutable state shared between every game in the same JVM.

**Undo dispatches on `logType`, not on substrings of the log text.**
`UndoAction.putDrawnItemBackInPBF` decided what to do by looking for
`"discarded"`, `"drew"` and `"barbarian"` in the log line. The log entry carries
a `logType` with the same information. The Java barbarian branch was dead code
anyway: it required `"drew"`, but barbarian logs write `"has drawn"`, and they
carry no item either, so an undo could never be started for them.

**Undo lines do not name hidden items.** Java wrote the full item in the undo
request, the votes and the result for every player, so asking to undo a hidden
tech, a social policy or a drawn card published it. Here those lines name an item
no more than its original log line did; only the owner sees the full text.
A tech or social policy carries a per-player number keyed with a secret per game,
not the catalogue number, so it cannot be matched to the tech list without the
key. The history
bar shows the public description only.

**Reads no longer mutate.** `getRemaingTechsForPlayer` did `techs.removeAll(...)`
on the list from Mongo, and `getAllPublicTurns` stripped history by changing the
stored objects. Both were pure projections in the port, and `getAllPublicTurns` is
gone with the old Turn orders panel.

**`addNewTurn` saves.** Java forgot `pbfCollection.updateById`, so the new turn
disappeared on the next read.

**Social-policy choices get fresh log numbers.** Java built a new object with
only name and flipside, which gave `itemNumber` 0. Each choice now receives a
fresh number from the game's counter; its choose, reveal and removal logs use
the same player-specific number, while choosing the policy again after removal
gets a new number.

**Colour choice is deterministic.** `chooseColorForPlayer` took the first
element out of a `HashSet`, in unspecified order. It now follows Green, Yellow,
Purple, Red, Blue.

**Transactional email is Resend, and unsubscribing works.** The old app sent
through SendGrid (`SENDGRID_USERNAME`/`SENDGRID_PASSWORD`); the rewrite uses
Resend (`RESEND_API_KEY`, from `noreply@playciv.app`). Every trigger the old
system had is back except the new-game broadcast — it-is-your-turn, someone
joined, chat, game ended and game deleted. The five turn-phase updates are gone with
the old Turn orders panel; a posted order is mailed like a chat message.
Several old behaviours were corrected on purpose:

- **One game email per player until they open the game** (issue #217). After a
  chat, order, it-is-your-turn or someone-joined mail, that player gets
  no further such mail about the same game until they load the game while signed
  in. A player who has never opened the game falls back to Java's 30-minute
  wait. It is per player and per game. The game-ended and game-deleted mails are
  final and always go out, battle turn mails are not held, and spectators or
  admins opening a game do not count. D1 needs migration `0004_game_mail.sql`.

- **Daily idle-turn reminders.** A separate daily Worker cron at 16:00 UTC
  (`0 16 * * *`) reminds the current turn holder after more than 72 hours
  without a saved game change. Opening the game does not reset the wait;
  any saved change, including a private note or an admin change, does.
  One reminder is allowed per unchanged state, independently of the
  game-open mail hold. Finished games and tables that have not started are
  skipped, and disabled accounts, unsubscribe preferences and missing addresses
  are respected. Old games with no activity timestamp start their wait when
  first observed. Deploy migration `0007_turn_reminders.sql` before deploying
  the Worker. The separate invocation keeps reminders out of the broadcast
  job's query and provider budget.
  Each run checks at most nine due games and rotates past ineligible accounts.
  Provider rejections are retried on a later day; ambiguous network failures
  keep the claim because the email may already have arrived.

- The unsubscribe link rides on **every** mail (Java's it-is-your-turn mail
  carried none), and it points at the **recipient's** id — Java passed the
  author's id on its game mails, so the recipient's link unsubscribed the
  wrong account.
- `disableEmail` stops **all** notifications (Java checked it only for the
  new-game broadcast and the admin mass mail, so its "unsubscribe from ALL
  emails" link did not actually stop most mail).
- The author of a chat message or order is excluded by their stable
  player id, not by username (Java compared usernames, which stops matching
  after an admin renames the account), and the mail goes to the account's
  current email address rather than the address snapshotted into the game at
  join time.
- The mail slot is claimed in one atomic step, so two simultaneous actions
  cannot both slip a mail past the hold.
- **New: a battle turn mail.** Ending a battle turn in the arena mails whoever
  now holds the battle turn ("It is your turn to play a unit in the battle
  arena"), straight away. There is no cooldown, unsubscribe is respected, and
  the player who pressed the button is never mailed. `old-civ-rest` has no
  arena, so there is no Java counterpart.

The new-game broadcast to every account is gone: creating a game sends no email
at all. Java mailed every account ("A new game by the name X was just
created!"); issue #30 ported it behind `MAIL_BROADCAST_NEW_GAMES`, and the owner
retired it outright, so no switch can bring it back. The remaining sends are
still bounded by a five-second timeout so a slow provider cannot hold up an
already-committed game action. See `docs/agents/decisions.md`.

**The footer carries PayPal and Buy Me a Coffee.** Issue #77 restored the old
site-wide footer — the copyright line, the Apache 2.0 link and the exact
encrypted PayPal hosted button from `old-civ-web`, on every page. A later,
owner-supplied addition puts a Buy Me a Coffee button beside the PayPal one; it
is a plain image link to the owner's page, not Buy Me a Coffee's JavaScript
widget, and it has no counterpart in the old footer. The old footer also carried
a Patreon button and its `becomePatronButton.bundle.js` script; those are
dropped on purpose (the owner's decision), so no Patreon code runs on the page.
See `docs/agents/decisions.md`.

**The signup security question is enforced on the server too.** The old
registration form's fixed question — "What is China's starting tech?", answered
`writing` — lived only in the AngularJS controller
(`RegisterController.js:37-40`), so a direct POST to `/api/auth/register` skipped
it; the Java backend had no check at all. Issue #40 restores the question in the
register form and enforces the same answer server-side, so a bot cannot register
without it. The comparison is the old one — `toUpperCase()` on the raw value, no
trimming — and it is a speed bump, not a security boundary: no captcha, rate
limit or rotating question. See `docs/agents/decisions.md`.

**The game-list search and sort span both tabs.** `old-civ-web`'s `list.html`
put the search box and "Show my games" inside the Active Games tab only, and its
Finished Games tab (`ng-table`) sorted only Created / Name / Number of players.
Here both controls sit above the tabs and apply to whichever is open:
"Show my games" is a real membership filter, and the search matches the game
name, its type and any player's username (`filter` in AngularJS matched every
property on the game). Both tabs are sortable, so **Type** is a new sortable
column, and a numeric column opens **descending** on the first click where
`ng-table` opened every column ascending. The **Open** and **Full** actions come
from the rewrite, not the old client, and the Active games table now puts its
**Action** column first so the buttons are reachable on a narrow screen without
scrolling sideways (the old client had Action last; the Finished table has no
Action column). See `docs/agents/decisions.md`.

**The admin broadcast is reachable, with a Markdown body.** The old
`GameAction.sendMailToAll` existed but was dead: its only endpoint,
`PUT /admin/mail`, had the call commented out and always answered 204, and no
old-client UI ever used it. Issue #92 exposes it as
`POST /api/admin/email/broadcast` (admin only), with an editable subject
defaulting to "Message from cash at playciv.app", a WYSIWYG Markdown editor
whose body is rendered to HTML by `marked` (the Markdown source stays as the
plain-text fallback), and a checkbox to also mail players who have unsubscribed.
Each mail keeps the `Hello <username>` greeting and the unsubscribe link. The
rendered HTML is not sanitised: only an admin can reach the route and an admin
already controls every account, so the content is trusted. The mails go out
through Resend's batch endpoint, 100 per request and at most 40 requests per
broadcast, so a Worker's 50-subrequest limit is no longer reached (the first
version, one request per recipient, delivered 49 of 555). The result lists what
was sent, skipped by reason, failed with the provider's message, and deferred,
plus why the run stopped if it did. A "Skip these addresses" box and a "Send to at
most" field let the admin run in pieces by pasting the previous run's sent
addresses back in; Resend's free plan allows only 100 mails a day, shared with the
game mails. So there is also a queue ("Send over several days"): the message and
its recipients are stored once, and a daily Worker cron at 17:00 UTC
(`0 17 * * *` in `wrangler.jsonc`) sends the next 50 pending recipients until
everyone has had it. The admin page shows sent, pending, failed and stuck counts,
and has "Send next batch now" and "Cancel". Only one queue is active at a time,
a recipient who unsubscribes after queueing is skipped at send time, and a
recipient a crashed or timed-out run left in `sending` is never resent by itself,
because the mail may have been delivered; such rows keep the queue open until the
owner releases them (after checking Resend's log) or cancels. **Deploy order for the queue:** apply migration
`0005` to D1 (`wrangler d1 migrations apply playciv --remote`), then deploy the
Worker; the cron only exists after a deploy, and its first run should be watched in the
Worker's logs. See `docs/agents/decisions.md`.

**The admin page can clean up finished games.** The database keeps a full saved
state after every move, only so a game can be replayed step by step, and that is
most of its size. "Clean up finished games" shows, as a dry run, which finished
games have such states and how many MB would go, and removes all of them except the
newest, one game at a time or 12 at a time with "Clean up all" (press it
again while it says games are left). When the newest state is itself stored as a
difference (see below) it is written back as a full state in the same step. The final board, the log, the chat, the
highscore and the ratings stay as they were; running games are never touched. A
cleaned game's history bar has a single entry. D1 may not report a smaller database
at once, because freed pages are reused, so the size in `wrangler d1 info` might not
drop. D1's free plan also has a daily limit on rows written, so a very large backlog may need to be cleaned over several days if a press fails partway; each game's delete is independent, so nothing is left half done. There is no undo in the app: restore with D1 Time Travel
(`wrangler d1 time-travel info playciv`). See `docs/agents/decisions.md`.

**Game history is stored as differences, and the admin page can compact the old
history.** A move used to save a complete copy of the game, 200 to 420 KB, which
filled D1's 500 MB (issue #238). A saved state is now either a keyframe (the full
state) or a delta, only what changed since the state before it; a keyframe comes first
in each game, after any change that is not a move (an admin setting) and after every 24
deltas. Reading a state still gives the full game, so replay, the history bar and every
projection are unchanged, and no route ever returns a stored delta. Measured on a game
played through the engine, a game's history is about 22 times smaller. "Compact revision
history" on the admin page converts the old full copies the same way, game by game: it
shows a dry run (how many full states each game still has and roughly what would be
freed), then rebuilds every state from the new form and compares it with the original
before replacing anything; a game that fails the check is left as it was and reported.
Running games are compacted too, except their newest state. A request does a limited
amount, so the page keeps pressing until nothing is left. **Deploy order:** apply
migration `0006` to D1 (`wrangler d1 migrations apply playciv --remote`), deploy the
Worker, take a D1 Time Travel bookmark (`wrangler d1 time-travel info playciv`), read the
dry run, compact one game and look at its history, then "Compact all". Old rows stay valid
without any conversion, so the migration and the deploy are safe on their own provided no
non-note admin change is made between applying `0006`
and deploying the Worker; right after the deploy, run the sealing statement of the
migration once more (it is idempotent): `wrangler d1 execute playciv --remote --command
"UPDATE game_revision SET sealed = 1 WHERE revision = (SELECT MAX(r.revision) FROM game_revision r WHERE r.game_id = game_revision.game_id);"`. Run it before anyone plays: a move made between the deploy and the statement is not repaired by it. The first move of each game after the deploy is a keyframe. Rolling the Worker back is only
possible before a game has written its second state after the deploy (the old code cannot
read a delta); after that, roll forward or restore the Time Travel bookmark. The old
stop-gap SQL that deletes the oldest states of a game would break a delta chain, and a
single revision row deleted or edited by hand can make a chain rebuild wrong without any
error: never touch revision rows outside the app; use the admin cleanup instead. See `docs/agents/decisions.md`.

**Only Tradable cards can be given away.** The hand's "Give" control was drawn
on every card, but `tradeToPlayer` only ever accepted Java's `Tradable` set
(Culture I/II/III, Hut, Village); every other kind came back `ITEM_NOT_FOUND`.
The control is now shown only for the Tradable cards, so Great Person, Civ,
City-state, units, wonders, tiles, techs and social policies no longer offer a
button that cannot work. The old AngularJS client likewise drew "Send to Player"
only on the Tradable cards. See `docs/agents/decisions.md`.

**The board palette enforces finite physical supplies.** The old system tracked
board pieces in a Google Sheet and enforced no limits; issue #49 asked for the
physical supplies to be visible and enforced, so the palette now shows a
remaining count and refuses an exhausted piece. Building counts come from the
reference sheet (upgrade families share one pool), wheat, iron, silk and incense
are capped at the player count, and each Great Person type has three board
pieces. Huts and Villages are deliberately **not** capped: they are collected
during play, not dealt at setup, so the player-count limit does not apply to
them (issue #116). See `docs/agents/decisions.md`.

**A player may remove any of their own techs, at any time.** The old backend's
`removeTech` only worked on a hidden tech, and never on the starting tech. Here
a hidden, a revealed and the starting tech can all be removed from the tech's
detail dialog, and the tech can then be chosen again (a re-chosen tech is hidden
until revealed). The coin counter the tech fed is reset. The log line names a
revealed tech publicly and says only "a hidden technology" for a hidden one;
both keep the item number. See `docs/agents/decisions.md`.

**A player may freely reposition their own tech pyramid.** Neither the old
backend nor the old client had any notion of this — it exists so a player can
reflect what Nikola Tesla's and Sir Isaac Newton's printed cards do (move a
learned tech to a lower pyramid row; place Newton face-down as a blank
occupant of a row), without the engine implementing either card's effect or
its trigger condition. The player manages both entirely themselves: nothing
is validated beyond ownership, and neither a move nor a placement is logged.
A placed Great Person's identity stays private to its owner — only the row it
occupies is public, matching the printed "facedown... blank tech card" text.
See `docs/agents/decisions.md`.

**A discarded barbarian unit shows "Barbarians" rather than no owner at all.**
`DrawAction.discardBarbarians` deliberately nulls a barbarian unit's owner
before adding it to `discardedItems` (it is not owned by any player), and the
port matches. Neither Java nor the old client ever showed an owner for
anything on this view (`old-civ-web`'s `revealed.html` renders no
attribution at all, for any category), so leaving it blank was already
faithful — but the new Revealed/Discarded panel (issue #51) shows a "by
&lt;username&gt;" tag for every other row, so a barbarian's row stood out as
looking broken rather than intentionally unowned. `revealedFeed` now labels
it `'Barbarians'`; `playerId` itself stays `null` — no player identity is
invented. See `docs/agents/decisions.md`, 2026-09-25.

**One chat and orders timeline, for every game (issue #215).** New, with no
old-system counterpart, and the only view: there is no switch and no separate
Turn orders or Chat panel. A game, running or finished, has one timeline. A
message is chat or an order tagged with a turn and a phase, orders are public the
moment they are sent, and a player ends a turn from the Order tab, which marks the
chosen phase done (and can take it back). There is no baton to pass: anyone can
write at any time, and Draw only asks for a confirmation when it is not your turn.
The title says whose turn it is and which phase they are on, and a strip under it
shows what each player is missing; a finished game is titled with its winner
instead, and its replay bar shows only who won. The start player is derived from
the Start player marker on the board (the player whose area holds it), and the
turn starts by itself when the last player has finished Research: the marker moves
one seat clockwise as a normal, undoable board change and the timeline gets a turn
divider. The new turn holder is mailed, and an order is mailed like a chat message.
The private log is a Private tab and is only its owner's.

Games that were saved with the old Turn orders panel open as a single chat. The
game itself is adopted when it is loaded, and the admin page moves the database
rows (see below), so the public orders of the old panel appear in the timeline and
an unpublished draft is added to its owner's private log. See
`docs/agents/decisions.md`, 2026-09-29, 2026-10-01 and 2026-10-03, and
`docs/agents/tasks/chat-orders.md` and `docs/agents/tasks/single-chat.md`.

**The admin tool that moved old games to the single chat is gone.** Every game has been moved, so the panel, its two routes and the code behind them were removed. A classic game that somehow turns up is still adopted when it is loaded. See `docs/agents/decisions.md`, 2026-10-09.

## Deferred

- **Card artwork.** The hand is shown as text. `itemImage()` in the engine
  already gives the filenames under `Civilization/Moderator/`.
- **Tournaments** — `TournamentAction` still needs a proper data layer.
- **`AdminAction`** — swap a user in a game, delete games.
- **Real time.** The client refetches after every action; there is no websocket.
  `todo.txt` in old-civ-rest wanted one for chat.

### Security

Authentication is at development level: scrypt-hashed passwords and HMAC-signed
bearer tokens that cannot be revoked before they expire. Java used unsalted SHA-1
and HTTP Basic, so this is an improvement, but it has not been reviewed for
production.

### Needs a decision

`revealItem` for a civilization draws starting units through `DrawAction.draw`,
which requires that it is the turn of that player. The consequence in Java is
that only the player whose turn it is can reveal a civilization — the other
three get 403 during setup. It looks like a bug, but is ported as is because
Java is the reference and no old test covers it. Documented in
`test/player-action.test.ts`, the test "a player whose turn it is not cannot
reveal a civilization".

Reference material — rulebooks, maps in ODP/PPTX, card artwork and a copy of the
Mongo database — lives in `Civilization/`, which is outside git.

**Board geometry is new.** The old Java system stored a Google Presentation link instead of board dimensions, so ours is a fresh choice. Two-player games use a 16 × 8 board (A–P, 1–8) — full width, half height; three- to five-player games use the full 16 × 16 board (A–P, 1–16). (Issue #17 originally asked for a smaller two-player map; the exact size was settled with the product owner as 16 × 8.)
