# Civilization: The Board Game — V2

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
development, JSON-file storage) and on Cloudflare Workers (production, MongoDB).
Java counterpart: `resource/*` and `application/*` under Dropwizard.

| File | Responsibility |
| --- | --- |
| `src/routes/auth.ts` | `AuthResource` — registration and login |
| `src/routes/games.ts` | `GameResource` — create, list, join, withdraw, end, log, chat |
| `src/routes/play.ts` | `DrawResource` + `PlayerResource` — draws, battle, tech, reveals, trade, turns, undo |
| `src/errors.ts` | `EngineError` → HTTP status |
| `src/auth.ts` | scrypt passwords and HMAC-signed bearer tokens |
| `src/routes/board.ts` | the board — place, move, rotate, front, back, remove, undo, history |
| `src/routes/arena.ts` | battle arena — initiate, place units, set stats, kill, end turn, end battle |
| `src/store/` | the storage interface and the JSON file implementation |

The server holds no game rules. Every route loads the state, calls one pure
function from the engine, saves the result and answers with
`toPlayerView(state, you)`. A route therefore cannot leak someone else's hand
even if it wanted to.

Environment variables: `PORT` (8787), `HOST`, `DATA_FILE`, `TOKEN_SECRET`,
`CORS_ORIGIN`, and `MONGO_URL` / `MONGO_DB` to run against MongoDB instead of
the JSON file (see [Storage](#storage-a-json-file-or-mongodb)).

### `packages/web`

React and Vite. Replaces the AngularJS app in `old-civ-web`. Deliberately plain
— the artwork comes later. It covers login, the game list, and the game page
with hand, draws, battle, technology, social policy, turn orders, log, undo
voting and chat.

The client imports its types from `@civ/engine`, so it cannot drift out of step
with what the server actually sends.

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

Every player sees and can move every piece, as at a physical table.

The palette has ten categories, generated from the images on disk. Buildings
and resources use finite physical supplies: the physical building counts are
read from the reference sheet, each resource type is limited by the player
count, and each Great Person type has three board pieces. The separate Great
Person card deck remains a hand/draw mechanic.

| Category | Count | From |
| --- | --- | --- |
| Figures | 10 | army and scout in five colours |
| Resources | 6 | hut, village, wheat, iron, silk, incense |
| Markers | 11 | coin, culture, caravan, fortification, wound, first player |
| Cities | 30 | capital/city/metropolis, with and without walls, per colour |
| City-states | 5 | the five neutral city-states (cs1–cs5) |
| Buildings | 15 | market, temple, library, … |
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
heap. Dropping on the map leaves the piece exactly where it was let go.

Wonders are the one card kind that never enters a hand. The wonders drawn at the
start of a game (and any drawn later from the draw menu) are placed in the
Wonders area and named in the public log, rather than kept secret in a hand —
they were never giftable or hidden bookkeeping the way ordinary cards are.

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

- **Undo** reverts the last entry exactly and pops it off the history. Anyone
  may undo, the same way anyone may move a piece.
- **Replay** rebuilds the board at any step by applying the entries from the
  start, so the back and forward arrows walk through the whole game from the
  first placement to the present. While replaying, the board is read-only and
  the log is trimmed to what was known at that step — each entry remembers the
  length of the game log at the time. That is how you can watch what an opponent
  did while it was not your turn.

Board moves are deliberately **not** written to the game log. A turn consists of
many small adjustments and the log would drown; the board history is the record,
and it is shown as its own list next to the board where each entry can be
clicked to jump there.

Games saved before the history existed get one synthetic `place` entry per piece
at load time (`src/migrate.ts`), so replay is exact for them too.

## Storage: a JSON file or MongoDB

`packages/server/src/store/types.ts` defines a `Repository`. There are two
implementations, chosen at startup by whether `MONGO_URL` is set.

**`JsonFileRepository`** (the default) keeps everything in `Map`s in memory and
mirrors it to `packages/server/data/civ.json` after each change — debounced, and
atomically through a temporary file that is swapped in. Enough to play locally,
and games survive a restart. Delete the file to reset everything.

**`MongoRepository`** runs against the old `playciv` database restored from
production. Point at it with:

```bash
MONGO_URL=mongodb://127.0.0.1:27017 MONGO_DB=playciv pnpm --filter @civ/server dev
```

It reuses the existing collections rather than starting fresh:

- **`player`** — old accounts log in unchanged. Their passwords are Java's
  unsalted SHA-1 (`DigestUtils.sha1Hex`); `verifyPassword` accepts that and, on
  a successful login, rewrites the stored hash to salted scrypt. Old ids are
  `ObjectId`s, new ones are UUID strings; lookups match both.
- **`chat`** — old lobby and game chat is read back.
- **`pbf`** — the old finished games, **read-only**, used only as a highscore
  source. Java's `PBF` shape is nothing like our `GameState`, so old games are
  not migrated to playable form.
- **`game_state`** — a new collection holding new games in the engine's shape.
  The old `pbf` documents are never written to.

There is no automated test for `MongoRepository` — CI has no database — so it is
verified by hand against the live instance. The shared repository logic is
covered by the JSON implementation, and the pure functions (password
verification, highscore) have their own tests.

Seed a known test account with:

```bash
MONGO_URL=mongodb://127.0.0.1:27017 pnpm --filter @civ/server seed:test-user
```

### Highscore

`GET /api/highscore` needs no token and returns wins by player and by
civilization, broken down by player count, computed by the pure
`highscore()` function in the engine over every finished game — the old `pbf`
games and any new ones together. It is a faithful port of Java's
`getPlayerHighScore` / `getCivHighscore`, down to the `percentWin` formatting
and the descending-username tiebreak. The tables themselves are drawn by the
landing page (see the `public-landing` task).

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

**Double spaces in the log are kept.** Java wrote
`username + " drew " + " - " + …`. The texts are comparable data and the old
tests match on them.

## Deliberate improvements

**A player status board instead of a shared spreadsheet.** The old app embedded
a per-game Google Sheet that players kept by hand. That is now an in-app "Player
status" panel: shared bookkeeping includes coins, trade, culture, unit counts,
movement/combat/stacking values, hand size and EftA/Infra/MIC/PE modifiers.
Every value is editable by any member of the game, with every edit written to
the public log; new games start with the standard unit and modifier defaults.

**A stable `id` per item instance.** Java identified items by value equality
(`@EqualsAndHashCode` on name/description/type), which meant two identical
`Infantry 1.3` were "equal" and `discardedItems.remove(item)` could remove the
wrong instance. Every item now has an opaque id. `itemNumber` is kept for log
compatibility, and its starting offset is still random per game so the number
does not give the card away. `itemValueEquals` is still there where the Java
semantics are needed.

**Space Flight is not a singleton.** Java had `Tech.SPACE_FLIGHT` as a static
field — mutable state shared between every game in the same JVM.

**Undo dispatches on `logType`, not on substrings of the log text.**
`UndoAction.putDrawnItemBackInPBF` decided what to do by looking for
`"discarded"`, `"drew"` and `"barbarian"` in the log line. The log entry carries
a `logType` with the same information. The Java barbarian branch was dead code
anyway: it required `"drew"`, but barbarian logs write `"has drawn"`, and they
carry no item either, so an undo could never be started for them.

**Five turn-phase methods became one.** `updateSOT`, `updateTrade`, `updateCM`,
`updateMovement` and `updateResearch` differed only in the email text and the
log type. The phase was already in the DTO, so `updateSOT` with `phase: "trade"`
wrote to the trade phase but logged SOT. `updateTurn` takes the phase as an
argument.

**Reads no longer mutate.** `getRemaingTechsForPlayer` did `techs.removeAll(...)`
on the list from Mongo, and `getAllPublicTurns` stripped history by changing the
stored objects. Both are pure projections now.

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

**`endTurn` still lets anyone end the turn.** Java found the player whose turn
it is and passed it on without looking at the caller. The engine still does
this; membership is now enforced at the server route (`endturn`/`taketurn`
reject a non-member with 403), which is where the authorization always belonged.

**`endTurn` returns `GAME_NOT_STARTED` (409) when no one holds the turn.** Java
either advanced by array index (its legacy pre-2015 branch) or threw
`NoSuchElementException` → HTTP 500 (its numbered branch). Neither is useful for
an unstarted game, and the legacy games that branch served are never loaded, so
the engine returns a clear error instead. See `docs/agents/decisions.md`.

## Deferred

- **Real MongoDB.** Replaced by a JSON file behind `Repository`, see above.
- **Card artwork.** The hand is shown as text. `itemImage()` in the engine
  already gives the filenames under `Civilization/Moderator/`.
- **Highscores and tournaments** — `GameAction.getCivHighscore`,
  `getPlayerHighScore`, `TournamentAction`. They query across games and need a
  proper data layer.
- **Email notification** — `email/SendEmail`, plus `/newpassword` and
  `/verify/{playerId}` in `AuthResource`. Java started a raw `new Thread(...)`
  per notification.
- **`AdminAction`** — swap a user in a game, delete games, bulk mail.
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
