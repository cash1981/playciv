# Coin trackers per player

- **Slug:** `coin-tab`
- **Branch:** `feat/coin-tab`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

Player status gets a second tab, **Coins**. Opening it replaces the status
table with one coin table: every coin source from the FFG reference sheet is a
row, every player is a column, and each cell has a `−` / `+` counter capped at
that source's printed limit. The status table's Coins cell stops being an
editable number and becomes the read-only sum of that player's sources — for
every player in the game, and editable by any member of the game, exactly like
the rest of the shared status board.

## Why

The human asked for it, concretely:

> In player stats, så splitter vi opp taben. Innfør en ny som heter Coins,
> denne kan man trykke på. Da vil hele statusen tabellen bli erstattet med en
> ny tabell der man kan føre inn alle disse verdiene: Alle har default 0,
> behold navnet som f.eks Code of Law, Pottery men, lag hjelpetext på det som
> står i kolonne 2. Legg også til en som heter Sheet — med hjelpetekst at dette
> er coins du får fra enten kultur kort, loot eller village etc. Deretter har vi
> en enkel + - der man kan øke antall coins på hver item. Så programmerer du inn
> maks 4 og maks 1 der det skal være og gjør nødvendige endringer i modellen for
> å tilfredstille dette. Husk at det da skal være mulig å gjøre dette for hver
> spiller. Så til slutt teller du opp antall coins totalt og viser totalen på
> hovedsiden der det idag står Coins idag. Denne tenker jeg da ikke bør være
> redigerbar siden den skal telle antallet fra den andre sheeten.

The coin sources are the human's reference image `Civ_Tech_FF-WW.-1.jpg`; the
counters replace players summing these by hand (the old chat logs are full of
"3 coins on CoL", "coins on leaders, Org. Rel., Civil Service…").

## Scope

**In:**

- The coin-source model, one counter per source per player, with the printed
  limits, the `setCoinSource` reducer, error kinds and migration.
- The **Coins** tab in Player status, its `+` / `−` controls, and the
  read-only total in the status table.
- The server route and the client API method.
- Tests for all of the above.

**Out:**

- **The Internet** (`+2` on each tech's maximum). The human chose to defer it:
  issue #145 tracks the wonder-ownership view this needs, and the follow-up
  work on these counters once that exists. Every tech source is capped at 4 for
  now.
- Coins placed on individual *card instances*. The counters are per source per
  player, which is what the players used to write on the sheet; the engine does
  not model which physical copy of Code of Laws holds which token.
- Enforcing any card effect. This is bookkeeping, like the rest of the status
  board — no rule is applied automatically.
- Editing from a spectator or replay view; the controls follow the existing
  `readOnly` behaviour.

## Reference

There is **no old-system counterpart**: neither `old-civ-rest` nor
`old-civ-web` modelled coin sources. The status board itself is new in this
port (issue #43), and its `PlayerStats.coins` was a single editable number. The
specification is therefore the human's reference sheet, reproduced here:

| Source | Helper text | Limit |
| --- | --- | --- |
| Code of Laws (I) | Up to 4 for winning battles | 4 |
| Pottery (I) | Up to 4 for any 2 resource tokens each | 4 |
| Civil Service (II) | 1 coin | 1 |
| Democracy (II) | Up to 4 for spending 6 trade during City Management | 4 |
| Printing Press (II) | Up to 4 for spending 5 culture during City Management | 4 |
| Bureaucracy (II) | 1 coin | 1 |
| Railroad (III) | 1 coin | 1 |
| Computers (IV) | 1 coin | 1 |
| Bank (Building) | 1 coin | 1 |
| Democracy (Govt) | 1 coin | 1 |
| Great People | 50% chance of providing 1 coin | 1 |
| Terrain | Some terrain spots provide 1 coin | 1 |
| Panama Canal | Start of Turn: Add 1 coin to this wonder | unlimited |
| Organized Religion | 1 coin | 1 |
| Sheet | Coins from culture cards, loot or village etc. | unlimited |

Panama Canal is unlimited per the human's correction: *"Det er ingen grenser på
coins på panama canal wonder."*

## Approach

**Engine**

- New `packages/engine/src/coins.ts`: `CoinSource` (key, label, help, max where
  `null` is unlimited), the `COIN_SOURCES` table, `CoinSourceKey`, `CoinSources`
  (`Readonly<Record<CoinSourceKey, number>>`), `EMPTY_COIN_SOURCES`,
  `findCoinSource(key)` and `totalCoins(sources)`.
- `PlayerStats.coins: number` is replaced by `coinSources: CoinSources`. The
  human chose that the legacy number is replaced by the new model rather than
  carried over, so migration drops it and every source starts at 0.
- `setPlayerStat` loses `'coins'` — it is no longer a stat. A new
  `setCoinSource({ editorPlayerId, targetPlayerId, source, value, at })`
  mirrors it: any member may edit any player, unknown sources and
  non-integer/negative/over-limit values are `EngineError`s, and the change is
  logged publicly (`set their Code of Laws coins to 3`).
- Two new errors: `UNKNOWN_COIN_SOURCE`, `INVALID_COIN_VALUE`.

**Server**

- `POST /api/games/:gameId/players/:targetPlayerId/coin` with `{ source,
  value }`, parallel to the existing `/stat` route, through `applyToGame`.
- Both new error kinds answer 400.

**Web**

- `api.setPlayerCoin(gameId, playerId, source, value)`.
- `StatusPanel` gains a tab bar above its content. It reuses `PlayerTabs`
  (already merged) with two entries and no colour. The status table is the
  first tab; the coin table is the second. Each row shows the source label and
  its helper text; each player column shows `− value +`, disabled at 0 / at the
  limit and when `busy` or `readOnly`. The status table's Coins cell renders
  `totalCoins(stats.coinSources)` as plain text.
- New CSS for the coin table; the tab styling comes from `PlayerTabs.css`.

## Claimed paths

- `packages/engine/src/coins.ts` (new)
- `packages/engine/src/state.ts` (`PlayerStats`, `DEFAULT_PLAYER_STATS`)
- `packages/engine/src/actions/player.ts` (`STAT_KEYS`, `STAT_LABEL`,
  `setPlayerStat` and the new `setCoinSource`)
- `packages/engine/src/errors.ts` (the two new kinds)
- `packages/engine/src/index.ts` (the new export)
- `packages/engine/src/migrate.ts` (`normalizeStats`)
- `packages/engine/test/player-stats.test.ts`
- `packages/engine/test/coin-sources.test.ts` (new)
- `packages/server/src/routes/play.ts` (the new route only)
- `packages/server/src/errors.ts` (the two new kinds)
- `packages/server/test/api.test.ts` (the status-board cases)
- `packages/web/src/lib/api.ts` (`setPlayerCoin` and the `CoinSources` re-export)
- `packages/web/src/views/StatusPanel.tsx`, `StatusPanel.test.tsx`
- `packages/web/src/views/PlayerTabs.tsx` (doc comment only — it now also serves
  the status tabs)
- `packages/web/src/styles.css`
- `docs/agents/tasks/coin-tab.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`

## Acceptance criteria

- [ ] Every player has a counter for each of the fifteen sources; all start at 0.
- [ ] `+` is refused at the printed limit (4 or 1) and `−` at 0, in the engine
      and in the UI; Sheet and Panama Canal have no limit.
- [ ] Any member of the game can change any player's counters; the change is
      logged publicly with the source's label.
- [ ] The status table's Coins cell is not editable and equals the sum of that
      player's sources; changing a counter changes the total.
- [ ] A game saved with the old `coins` number migrates without error and shows
      the new, zeroed counters.
- [ ] Hidden information: the counters live on the already-public `PlayerStats`,
      so no new data is exposed; the existing hidden-info tests still pass.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: the Coins tab opens, counters move the total in
      the status table, limits disable `+`, and a spectator/replay sees the
      table without controls.

## Open questions

None. The three that existed were answered by the human before the work
started: layout is one column per player; The Internet is deferred to issue
#145; the legacy `coins` number is replaced by the new model.
