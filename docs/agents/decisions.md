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
