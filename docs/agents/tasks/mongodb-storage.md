# MongoDB storage

- **Slug:** `mongodb-storage`
- **Branch:** `feat/mongodb-storage`
- **Owner:** coder (Sonnet), orchestrated by Opus
- **Status:** in progress

## Goal

The server can run against the human's restored `playciv` MongoDB instead of the
JSON file. It reuses the existing `player` collection (so old accounts still log
in), reuses the old finished games as a highscore source, and stores new games
in their own collection without touching the old `pbf` documents. The JSON file
remains the default when no Mongo URL is configured.

## Why

The human restored the old `playciv` database locally — 553 players, 310
finished/active games, 87k chat messages — and asked to point the app at it,
reusing the player collection and the game history so highscore works. All three
design choices were confirmed:

- **Old games:** highscore + read-only, **not** migrated to playable form.
- **Config:** `MONGO_URL` selects Mongo; JSON file is the fallback.
- **Passwords:** support the old unsalted SHA-1 and upgrade to scrypt on login.

## What the old data looks like (already inspected)

Database `playciv`, collections that matter:

- **`player`** (553 docs). Shape:
  `{ _id: ObjectId, username: string, email: string, disableEmail: bool, password: string(40 hex SHA-1), emailSent: number[7], gameIds: string[] }`.
  Every password is unsalted SHA-1 (`DigestUtils.sha1Hex`), 40 hex chars, no
  colon. The human's own account is `username: "cash"`, not "cash1981".
- **`pbf`** (310 docs, all `type: "WAW"`; 294 finished, 247 with a winner).
  This is Java's `PBF` — a completely different shape from our `GameState`. Do
  not try to read it as a `GameState`. For highscore only these fields are
  needed: `{ name, numOfPlayers, active, winner, players: [{ username, civilization: { name } }] }`.
  `winner` is a username string. The winner's civilization is found in
  `players[]` where `username === winner`, at `civilization.name`.
- **`chat`** (87k docs). Shape:
  `{ _id: ObjectId, pbfId: string | null, username, message, created: number[7] }`.
  `created` is a Jackson-serialised LocalDateTime as a 7-element array
  `[year, month, day, hour, minute, second, nano]`. `pbfId: null` is lobby chat.

## Scope

**In:**

- `MongoRepository` implementing the existing `Repository` interface.
- SHA-1 password verification with upgrade-to-scrypt on successful login.
- `MONGO_URL` / `MONGO_DB` config in the server entry point, JSON fallback.
- New games in a new collection (`game_state`); old `pbf` left untouched.
- Reuse `player` and `chat` collections.
- Highscore: a pure engine function over finished-game summaries, a
  `Repository` method that supplies them (old `pbf` + new games in Mongo; new
  games only in JSON), and a public `GET /api/highscore` endpoint so the result
  is verifiable.
- A seed script that creates a known test user if it does not exist.

**Out:**

- Migrating old `pbf` games to playable `GameState`. Explicitly rejected.
- The highscore **UI** (tables, tabs) — that stays in `public-landing`. This
  task delivers the data and the endpoint, not the page.
- Tournament collection. Deferred.
- Any write to the old `pbf` collection. It is read-only, always.

## Reference

- **Java hashing:** `old-civ-rest/.../action/PlayerAction.java:601` —
  `DigestUtils.sha1Hex(decodedPassword)`. And
  `application/CivAuthenticator.java:51` — login compares
  `player.getPassword().equals(DigestUtils.sha1Hex(credentials.getPassword()))`.
  So the stored value is `sha1Hex(password)`, plain hex, no salt.
- **Java highscore:** `old-civ-rest/.../action/GameAction.java` —
  `getPlayerHighScore` and `getCivHighscore`. The DTOs are in `dto/`:
  `WinnerDTO { username, totalWins, attempts, percentWin }`, `CivWinnerDTO`.
  - Only finished games (`!active`) with a non-empty winner count.
  - `percentWin = round(totalWins / attempts * 100, 2)` with a trailing `" %"`;
    `"0 %"` when either is zero. `attempts` for a player is how many finished
    games they were **in**; for a civ, how many finished games it was **played
    in**.
  - Sorted by `totalWins` desc, then username. `WinnerDTO.compareTo` uses
    `username.compareTo` — UTF-16 order. Use `compareJavaStrings` from
    `packages/engine/src/turn.ts`.
  - Broken down into a total plus per player-count (2, 3, 4, 5), both for
    players and for civilizations. Plus `totalNumberOfPlayers`,
    `totalNumberOfGames`.
- **The `Repository` interface:** `packages/server/src/store/types.ts`.
- **The JSON implementation to mirror:** `packages/server/src/store/json-file.ts`.

## Approach

### 1. Auth (`packages/server/src/auth.ts`)

- `verifyPassword` must accept both formats. Detect legacy by shape: a stored
  value that is 40 hex chars with no `:` is SHA-1; otherwise scrypt. For SHA-1,
  compare `createHash('sha1').update(password, 'utf8').digest('hex')` to the
  stored value with `timingSafeEqual`. Keep the existing scrypt path.
- Add `needsUpgrade(stored): boolean` — true for the legacy shape.
- Keep `verifyPassword` returning `boolean` so existing tests and the
  timing-safe placeholder path in the login route keep working.

### 2. Login upgrade (`packages/server/src/routes/auth.ts`)

- After a successful login, if `needsUpgrade(player.passwordHash)`, compute a
  fresh scrypt hash and persist it. Never block or fail the login on the
  upgrade — wrap it so a write error is logged, not thrown to the user.
- Add `updatePlayerPassword(id, passwordHash)` to the `Repository` interface and
  both implementations.

### 3. `MongoRepository` (`packages/server/src/store/mongo.ts`)

Implements `Repository`. Constructor takes a connected `Db` (or a URL + db name
and connects in an async factory `MongoRepository.connect(url, dbName)`).

- **player** collection, reused:
  - Mongo → `StoredPlayer`:
    `{ id: _id.toString(), username, email: email ?? null, passwordHash: password, createdAt: <ISO from createdAt field, else _id.getTimestamp()> }`.
  - `createPlayer`: write `{ _id: player.id, username, email, password: passwordHash, createdAt }`.
    New ids are our UUIDs, stored as string `_id`. Old ids are ObjectIds.
  - `findPlayerById(id)`: match string `_id === id` OR, when `ObjectId.isValid(id)`,
    ObjectId `_id`. A `$or` query handles both. Old `players[].playerId` in pbf
    is the ObjectId hex string, so string lookups must work against ObjectId
    docs — hence the dual match.
  - `updatePlayerPassword`: set the `password` field.
- **game_state** collection, new — holds our `GameState` documents:
  - `saveGame`: upsert `{ _id: game.id, ...game }`.
  - `findGame`, `allGames`, `deleteGame`: against `game_state` only.
  - **Never** read or write `pbf` here.
- **chat** collection, reused:
  - `appendChat`: `{ _id: message.id, pbfId: message.gameId, username, message, createdAt: message.createdAt }`.
    Write our ISO `createdAt` as a new field; do not try to reproduce the 7-array.
  - `chatFor(gameId)`: read docs where `pbfId === gameId` (null for lobby),
    sorted oldest first. Map each defensively — `createdAt` may be our ISO
    string (new) or `created` may be the 7-element array (old); convert the
    array `[y, mo, d, h, mi, s, nano]` to an ISO string. `id` is `_id.toString()`.
- **highscore source:** `finishedGamesForHighscore(): Promise<readonly FinishedGameSummary[]>`
  reads finished-with-winner games from **both** `pbf` (old) and `game_state`
  (new) and maps each to `{ numOfPlayers, winner, winnerCiv }`.
- `flush()` is a no-op. `load()` is not on the interface; Mongo connects in the
  factory.

### 4. Highscore in the engine

Java (`GameAction.getPlayerHighScore` / `getCivHighscore`) needs the **whole
roster** of every finished game, not just the winner — `attempts` counts how
many finished games each player (or civ) took part in, win or lose. So the
summary carries the players:

```ts
interface FinishedGame {
  readonly numOfPlayers: number
  readonly winner: string                                    // username
  readonly players: readonly {
    readonly username: string
    readonly civName: string | null
  }[]
}
```

`highscore(games: readonly FinishedGame[], allUsernames?: readonly string[]): HighscoreResult`,
pure, matching Java behaviour by behaviour:

- **`totalNumberOfGames`**: `games.length` for the player tables; for the civ
  tables, the count **after** the civ filter below. Java keeps these separate
  (two DTOs), so `HighscoreResult` has a `players` table set and a `civs` table
  set, each with its own `totalNumberOfGames`.
- **`totalNumberOfPlayers`**: `allUsernames?.length` when supplied (Java's
  registered-account count), else the distinct participants in `games`.
- **Player total winners** (`getAllWinners`): `attempts` per user = participations
  across all `games`; winners get their win count; and when `allUsernames` is
  supplied, every registered user **not** among the winners is included with 0
  wins and their participation count. Sorted `totalWins` desc, then username
  desc.
- **Player per-count N** (`getWinners`): every distinct participant of an
  N-player game, with wins and attempts counted within N-player games — losers
  included. Same sort.
- **Civ tables** (`getCivHighscore`): first keep only games where **every**
  player has a civ (`players.every(p => p.civName !== null)`). Then the same
  shape as the player tables, keyed on the winner's civ name.
- **`percentWin`**: `Math.round(wins / attempts * 100 * 100) / 100 + " %"`, and
  the literal `"0 %"` when wins or attempts is 0. Note Java prints `"100.0 %"`,
  with the `.0`.
- Ties break on **descending** username (Java sorts ascending then reverses, so
  `Comparator.reverseOrder()` flips both keys). Use `compareJavaStrings` from
  `packages/engine/src/turn.ts`, reversed.

Export the function and its types from `packages/engine/src/index.ts`.

Add `finishedGamesForHighscore(): Promise<readonly FinishedGame[]>` to
`Repository` and implement it in **both** repos, returning the full roster:

- JSON: `allGames()` filtered to `!active && winner`, mapping each player to
  `{ username, civName: civilization?.name ?? null }`.
- Mongo: the same over **both** `pbf` (old) and `game_state` (new). Old `pbf`
  players are at `players[].username` and `players[].civilization?.name`.

The `GET /api/highscore` route passes the registry:
`highscore(await repo.finishedGamesForHighscore(), (await repo.allPlayers()).map(p => p.username))`.

### 5. Config (`packages/server/src/index.ts`)

- If `process.env.MONGO_URL` is set: `repo = await MongoRepository.connect(url, process.env.MONGO_DB ?? 'playciv')`.
  Otherwise the existing `JsonFileRepository`. Log which one is active.
- Close the Mongo client on shutdown alongside the existing flush.

### 6. Public highscore endpoint

- `GET /api/highscore`, no auth, returns `highscore(await repo.finishedGamesForHighscore())`.
- Put it in `routes/games.ts` or a small `routes/public.ts`; if you add
  `public.ts`, register it in `app.ts`.

### 7. Seed script

- `packages/server/src/seed-test-user.ts` (run via a `seed:test-user` script):
  connect to Mongo, create user `test` with password `test1234` (scrypt) and
  email `test@example.com` if no such username exists. Print what it did. Idempotent.

## Claimed paths

- `packages/server/src/auth.ts`
- `packages/server/src/routes/auth.ts`
- `packages/server/src/store/types.ts`
- `packages/server/src/store/json-file.ts`
- `packages/server/src/store/mongo.ts` (new)
- `packages/server/src/routes/public.ts` (new) or `routes/games.ts`
- `packages/server/src/app.ts`
- `packages/server/src/index.ts`
- `packages/server/src/seed-test-user.ts` (new)
- `packages/server/package.json` (add `mongodb` dep + `seed:test-user` script)
- `packages/engine/src/highscore.ts` (new)
- `packages/engine/src/index.ts`
- `packages/engine/test/highscore.test.ts` (new)
- `packages/server/test/auth-legacy.test.ts` (new)

## Acceptance criteria

- [ ] With no `MONGO_URL`, the server behaves exactly as today (JSON file), and
      the whole existing test suite still passes unchanged.
- [ ] `verifyPassword('p', sha1Hex('p'))` is true; `verifyPassword('p', scrypt('p'))`
      is true; a wrong password is false for both. `needsUpgrade` is true for the
      SHA-1 shape and false for scrypt. Tested as pure functions in
      `auth-legacy.test.ts` — **no Mongo required**.
- [ ] Login with a legacy SHA-1 user rewrites the stored hash to scrypt, and the
      next login still succeeds. (Testable against `JsonFileRepository` by
      seeding a player whose `passwordHash` is a raw SHA-1 hex string.)
- [ ] `highscore()` matches Java: `attempts` counts participations in finished
      games (so a player who lost every game shows a real attempt count and a
      `percentWin` below 100); non-winners from `allUsernames` appear with 0
      wins; civ tables include only games where every player has a civ;
      `percentWin` formatted identically including `"0 %"` and `"100.0 %"`; ties
      broken by descending username; per-player-count and per-civ breakdowns
      present with their own game totals. Tested pure in `highscore.test.ts`
      with hand-built rosters, including a loser and a never-won registered
      user.
- [ ] `MongoRepository` implements every `Repository` method. It never writes to
      `pbf`. New games go to `game_state`.
- [ ] `GET /api/highscore` needs no token and returns the computed result.
- [ ] The seed script is idempotent and creates `test` / `test1234` only when
      absent.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass. Report the
      real output.

## Not your job to run

`MongoRepository` cannot be unit-tested without a live Mongo, and CI has none.
Do **not** add a test that needs a database — it would break the suite. The
orchestrator verifies the Mongo path manually against the human's running
instance. Keep every automated test Mongo-free: the JSON repo covers the shared
logic, and the pure functions (auth, highscore) cover the rest.

## Open questions

- None blocking. The three design forks are decided (see Why).
