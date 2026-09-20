# Active and finished games: tabs, sortable tables and pagination

- **Slug:** `games-list-tabs`
- **Branch:** `feat/games-list-tabs`
- **Owner:** orchestrator (DeepSeek V4.1 Flash); implementation by the `coder` role
- **Status:** in review — the first review round's follow-up and Follow-up 2
  (front-page layout and lobby chat) are folded in

## Goal

The front page splits its single "Active and finished games" list into two tabs,
**Active games** and **Finished games**, each a sortable, paged table. The
pagination and sortable table are the ones already on the front page
(`SortableTable`, used by the highscore); the tab control is the one from
`HighscoreView`. The old search box and "Show my games" filter come along.

## Why

Old-civ-web's `app/views/list.html` had a `uib-tabset` with an **Active Games**
tab (`dir-paginate`, 30 per page, a search box and a "Show my games"
checkbox) and a **Finished Games** tab (an `ng-table`, 10 per page, sortable by
Created / Name / Number of players). The rewrite collapsed both into one list
with no tabs and no paging. The human asked for the old behaviour back, with a
sortable table on **both** tabs, the old search + "Show my games", and 10 rows
per page.

## Reference

- `old-civ-web/app/views/list.html` — the tabset, the active table (`#`,
  Created, Name, Type, Number of players, Players, Action) and the finished
  table (the same columns, no Action), the search box and "Show my games".
- `old-civ-web/app/scripts/controllers/GameListController.js` — splits the
  loaded games into `games` (active) and `finishedGames` (inactive),
  `totalNumberOfGames`, and the "show my games" behaviour (it set the search
  text to the username).
- The finished table sorted by `created`, `name` and `numOfPlayers`.

Deliberate differences from the old client, to record in `decisions.md`:

- The old "Show my games" reused the free-text filter (it typed the username
  into it). Here it is a real filter on membership (`youAreIn`), which is what
  the old behaviour meant and does not accidentally match a username inside
  another game's text.
- The old finished table's default sort was `totalWins desc` (a
  copy-paste from the highscore controller that never matched a game field, so
  it was a no-op). Both tables here default to **Name ascending**, which is the
  order the server already returns and the active list already showed.
- The `#` column is the row's position in the whole filtered/sorted list, not
  the page-local index (the old active table used the page-local `$index`).
- `GameState.createdAt` is new (see below); the old `PBF.created` was not
  carried across by the rewrite. Migrated games show an empty Created cell.

## Scope

**In:**

- `GameState.createdAt` (`string | null`), stamped by the server when a game is
  created and defaulted to `null` by `migrateGameState` for games saved before
  it existed, so the old "Created" column has a source.
- The two game summaries (`GameSummary`, `PublicGameSummary`) expose `createdAt`.
- A generalised `SortableTable<T>` with a `Pager` and a shared `Tabs`
  component, and a new `GameList` panel that renders the two tabs.
- `LandingView` renders `GameList` in place of its current single list, and a
  small "Beta" sticker after the *Play Civilization* heading.
- Web tests for the new behaviour.

**Out:**

- Server-side pagination — the lobby already loads every game, exactly like the
  old client (`dir-paginate`/`ng-table` are client-side).
- `LobbyView.tsx`, which is unused dead code (nothing imports it); leave it.
- Any change to `delete-game`, the highscore, or the game page.

## Approach

### Engine

- `packages/engine/src/state.ts`: add `readonly createdAt: string | null` to
  `GameState`, next to `name`/`gameType` (public data, like `winner`).
- `packages/engine/src/create-game.ts`: add `readonly createdAt?: string | null`
  to `CreateGameOptions` and set `createdAt: options.createdAt ?? null` in the
  returned state. The engine stays pure — the server passes the timestamp.
- `packages/engine/src/migrate.ts`: add `'createdAt'` to the `MaybeOlder` `Omit`
  and `Partial` lists and default it with `createdAt: older.createdAt ?? null`.
- Any test that builds a `GameState` literal needs the new field; the compiler
  finds them.

### Server

- `packages/server/src/routes/games.ts`: add `createdAt: string | null` to
  `GameSummary` and `PublicGameSummary` and set it in `toSummary` /
  `toPublicSummary` from `game.createdAt`. In the create handler, pass
  `createdAt: new Date().toISOString()` into `createGame`.

### Web

- `packages/web/src/lib/api.ts`: add `readonly createdAt: string | null` to
  `GameSummary` and `PublicGameSummary`.
- `packages/web/src/views/Pager.tsx` (new): the Prev / "Page X of Y" / Next
  markup, lifted verbatim out of `SortableTable` so both it and the games
  tables share one implementation.
- `packages/web/src/views/Tabs.tsx` (new): the `Tabs` component currently local
  to `HighscoreView` (`div.tabs` + `aria-pressed` buttons), moved out unchanged.
- `packages/web/src/views/SortableTable.tsx`: generalise to
  `SortableTable<T>` with a column list and a page size:

  ```ts
  interface SortableColumn<T> {
    readonly key: string
    readonly header: string
    /** Omit to make the column unsortable. */
    readonly sortValue?: (row: T) => string | number
    readonly render: (row: T, index: number) => React.ReactNode
    /** Direction when this column is first selected; defaults to ascending. */
    readonly initialDirection?: 'asc' | 'desc'
  }
  interface Props<T> {
    readonly rows: readonly T[]
    readonly columns: readonly SortableColumn<T>[]
    readonly rowKey: (row: T, index: number) => string
    readonly initialSortKey: string
    readonly emptyMessage: string
    readonly pageSize?: number
  }
  ```

  `index` in `render` is the row's position in the whole sorted list.
  `HighscoreView` passes its four columns (`username` asc, `totalWins`/
  `attempts`/`percentWin` numeric, default sort `totalWins` desc) and keeps the
  "a fresh table per tab" `key`. Numeric columns open descending; text columns
  ascending — same rule as today.
- `packages/web/src/views/HighscoreView.tsx`: use the shared `Tabs` and the new
  `SortableTable` props.
- `packages/web/src/views/GameList.tsx` (new): the panel. Props:
  `{ games, player, busy, onOpenGame, onJoin }`. State: `tab`
  (`'active' | 'finished'`), `query`, `onlyMine`. It splits `games` on
  `game.active`, filters by `query` (case-insensitive substring over name,
  `gameType` and player usernames) and by `onlyMine` (`youAreIn`; render the
  checkbox only when `player !== null`), and renders one `SortableTable` per
  tab with 10 rows per page. Columns, in the old order:
  `#` (unsortable, global index + 1), **Created** (`game.createdAt`, formatted
  with the existing `formatTimestamp`, sortable), **Name** (an anchor to
  `/game/<id>` with the current left-click handling, sortable), **Type**
  (`gameType`, sortable), **Number of players** (sortable), **Players**
  (usernames joined with `<br />`, unsortable), **Action**:
  - `youAreIn` → **Open** button (`onOpenGame`),
  - else active and not full → **Join** button (disabled while `busy`, then
    `onJoin`),
  - else active and full → **Full** (disabled),
  - else nothing.
  The Finished tab shows a caption with the total number of finished games
  (the old `caption`).
- `packages/web/src/views/LandingView.tsx`: replace the `<ul className="list">`
  games block with `<GameList … />`. Keep the "New game" form, the lobby chat
  and the highscore as they are.
- `packages/web/src/styles.css`: rename the `.highscore-table` rules to
  `.data-table` (the generic table's class), and add only what the games table
  needs (a right-aligned action cell, the filter row, the caption).

### Tests

- `packages/engine/test/create-game.test.ts` (new): `createGame` stores the
  `createdAt` it is given and `null` when it is not; `migrateGameState` defaults
  a missing one to `null` and keeps an existing one.
- `packages/server/test/api.test.ts`: a created game's summary (and the public
  summary) carries a non-null `createdAt`.
- `packages/web/src/views/GameList.test.tsx` (new): the tabs split on `active`;
  the search filters; "Show my games" keeps only `youAreIn` and is hidden when
  signed out; the page shows 10 rows with working Prev/Next; a column header
  sorts.
- `packages/web/src/views/SortableTable.test.tsx` (new): sorting and paging on
  a small generic fixture (guards the highscore behaviour too).

## Acceptance criteria

- [ ] The front page shows **Active games** and **Finished games** tabs; the
      active tab is selected first and each tab contains only its games.
- [ ] Both tabs are sortable tables with 10 rows per page and a pager.
- [ ] Search filters the visible games; "Show my games" keeps only games the
      signed-in player is in, and is not shown when signed out.
- [ ] A new game's summary (signed in and public) carries its `createdAt`.
- [ ] Old migrated games read back with `createdAt: null` and render.
- [ ] Hidden information is unaffected (`createdAt` is public).
- [ ] `pnpm -r typecheck`, `pnpm -r test` and `pnpm -r build` all pass.
- [ ] `docs/agents/decisions.md` records the createdAt addition and the
      deliberate differences from the old client above; `state.md` and the task
      board are updated.

## Follow-up

The first review round and the human raised these; fold them into the same
branch.

- **Fix** `GameList`'s "Show my games": a signed-in user who ticks it and signs
  out must not be left with a filtered (often empty) list and no visible
  control. Reset `onlyMine` (and any other filter state that only makes sense
  while signed in) when `player` becomes `null`.
- **Fix** the numeric-column direction: with an empty row set, clicking a
  numeric header must still open descending. Decide numeric-ness from the
  column, not from a row sample.
- **Record** the game-list UI deviations from old-civ-web in `decisions.md`:
  the search and "Show my games" apply to both tabs (old: active only) and the
  search matches name / type / usernames (old: every property); `Type` is
  sortable (the old finished table sorted only Created / Name / Number of
  players); numeric columns open descending on the first click (old ng-table:
  ascending); and the `Open` / `Full` actions are inherited from the rewrite,
  not the old client. Add the README "Deliberate improvements" note for these
  — but **not** for the caption (next point).
- **Keep** the corrected finished caption (finished games only). The user asked
  to fix the old bug (the old caption labelled the *all games* count as
  "finished") and explicitly asked for **no** README text about it.
- **Polish**: drop the trailing `<br />` on the last username in the Players
  cell; right-align the Action header to match its cells; memoize the two
  column arrays so the table's sort memo is not invalidated every render.
- **Beta sticker** (human request): a small, tasteful "Beta" badge immediately
  after the *Play Civilization* heading in `LandingView`. Use the existing
  theme variables (`--accent` / `--accent-text`) so it reads in both themes,
  keep it accessible (the word "Beta", not colour alone), and keep the diff
  small.

## Follow-up 2: front-page layout and lobby chat

The human tested the front page and hit these.

**The table overflowed its panel.** `.grid` is a two-column grid and
`.data-table` is wider than its column's share; a grid item's default
`min-width: auto` lets it push past its track, so the table drew over the Lobby
chat column. Fixes:

- `LandingView`: drop the `.grid` wrapper around the games panel; the games
  panel is full width.
- `SortableTable`: wrap the `<table>` in a `div.table-scroll` (`overflow-x:
  auto`) so a wide table scrolls inside its panel instead of overflowing the
  layout.
- `styles.css`: add `.table-scroll`, and `min-width: 0` on `.panel` so no future
  grid use can overflow the same way.

**Lobby chat moves to the very bottom** of the front page, after the highscore
(new order: intro, error, games, New game (signed in), highscore, Lobby chat).

**Lobby chat gets the shared pager.** Extract it into
`packages/web/src/views/LobbyChat.tsx`:

- Props: `messages` (newest first), `player`, `busy`, `onSend(message)`.
- Internal `message` state and `page` state (1-based, 10 per page, shared
  `Pager`).
- Render the current page's messages, the pager, then the send form (or the
  "Sign in to join the conversation." note when signed out).
- After a successful send, clear the input and return to page 1; clamp the page
  if the list shrinks.

`LandingView` keeps the `chat` state and the `reload`, and renders `LobbyChat`
in the bottom panel.

**Only the last three months of lobby chat are fetched.** In
`packages/server/src/routes/public.ts` the window is ~3 months (90 days) and the
messages are returned **newest first** instead of the old 14 days / oldest-first
50. The count cap goes away: the pager bounds what is shown. Record the change
in `decisions.md`.

Tests:

- `packages/server/test/api.test.ts`: replace the "latest two weeks and 50
  messages" test with one for the new window ("three months") and newest-first
  order, and assert there is no 50-message cap (e.g. 60 recent messages come
  back).
- `packages/web/src/views/LobbyChat.test.tsx` (new): newest-first, 10 per page
  with a working Prev/Next, the send form calls `onSend` with the trimmed text
  and clears, and a signed-out visitor sees the note instead of the form.

## Open questions

None. The human chose a sortable table on both tabs, the old search + "Show my
games", 10 rows per page, and adding `GameState.createdAt`.
