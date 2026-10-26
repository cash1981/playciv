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

Needs Node 24 or newer and pnpm 11.24.0, as pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
pnpm --filter @civ/engine build
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
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

See [AGENTS.md](AGENTS.md) for agent workflow and
[current decisions](docs/agents/decisions.md) for enduring constraints.
[Historical documentation](docs/history/README.md) is reference material, not an active backlog.

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

The engine separates state and projections (`src/state.ts`), game data, board
geometry and action reducers. Legacy Java sources explain unchanged behavior;
current decisions and tests document deliberate differences.

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
`toPlayerView(state, you)`. Routes must preserve this projection boundary;
privacy tests cover public and historical responses.


### `packages/web`

React and Vite. 

The client imports its types from `@civ/engine`, so it cannot drift out of step
with what the server actually sends.
