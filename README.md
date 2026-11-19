# Civilization: The Board Game — version 2

A rewrite of Sid Meier's Civilization: The Board Game (Fantasy Flight Games), with the *Fame and Fortune* and *Wisdom and
Warfare* expansions.

Live at https://playciv.app.

## Running locally

Needs Node 24 or newer and the pnpm version pinned in `package.json`.

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

Set `TOKEN_SECRET` before starting the server if logins should survive a
restart. Without it a random secret is made on every start.

## Verifying

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

## Packages

### `packages/engine`

Pure domain logic. No HTTP, no database, no UI. Every reducer is a pure
function:

```ts
(state: GameState, action: DrawInput) => Result<GameState, EngineError>
```

Nothing throws: errors are values, and the HTTP mapping belongs to the server
package.

Randomness lives in the state as a seed (`state.rng`), so a game can be
reproduced and replayed.

### `packages/server`

Hono on top of the engine, so the same HTTP code runs on Node (local
development, JSON-file storage) and on Cloudflare Workers (production, D1).

The server holds no game rules. Every route loads the state, calls one pure
function from the engine, saves the result and answers with
`toPlayerView(state, you)`. Routes must preserve this projection boundary;
privacy tests cover public and historical responses.

### `packages/web`

React and Vite. The client imports its types from `@civ/engine`, so it cannot
drift out of step with what the server actually sends.

## More

- [Repo map](docs/agents/repo-map.md) — where things live, file by file.
- [Current decisions](docs/agents/decisions.md) — rules and behavior choices.
- [AGENTS.md](AGENTS.md) — agent workflow.
- [Historical documentation](docs/history/README.md) is reference material, not an active backlog.
