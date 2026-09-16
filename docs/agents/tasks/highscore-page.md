# Task: Highscore page (front end)

## Why

The original AngularJS app (`old-civ-web/app/views/highscore.html` +
`HighscoreController.js`) served a public Highscore page with sortable,
paginated tables. The engine (`packages/engine/src/highscore.ts`) and the
server (`GET /api/highscore`, public; MongoDB read via
`finishedGamesForHighscore`) already reproduce all the data. Only the web
front end is missing.

## What the human asked for

- A Highscore page reached from a link in the top bar, on its own route
  (`/highscore`), like the original which was its own page.
- **Public**: visible before sign-in (the API needs no token).
- **Full ng-table parity**: click any column header to sort, default
  `totalWins` descending, 10 rows per page with pager controls.
- **Full tab structure**: two top-level tabs (Player / Civilization), each
  with sub-tabs Total wins, 2 / 3 / 4 / 5 player game — exactly as the
  original.

## Scope (packages/web only)

1. `src/lib/api.ts` — re-export `HighscoreResult` from `@civ/engine`; add
   `api.highscore()` → `GET /api/highscore` (works without a token).
2. `src/views/SortableTable.tsx` — reusable table: 4 columns (name label
   passed in), click-to-sort (asc/desc toggle), default `totalWins` desc,
   pagination 10/page.
3. `src/views/HighscoreView.tsx` — fetches once, renders the two-level tabs
   and the captions with the totals, wiring each tab to the matching
   `WinnerEntry[]` list from the response.
4. `src/App.tsx` — a `highscore` screen + `/highscore` route, a top-bar link,
   and rendering the view even when signed out (a Highscore link on the login
   screen too).
5. `src/styles.css` — tab, table, sort-indicator and pager styles, matching
   the existing dark theme (no Bootstrap).

## Notes / decisions

- `WinnerEntry.percentWin` is a preformatted string (`"50.0 %"`). Sorting it
  as text (what the original ng-table did) orders `"100.0 %"` before
  `"50.0 %"`. We sort the numeric columns (`totalWins`, `attempts`,
  `percentWin`) numerically and `username` as text. This is a UI-only choice,
  not a game rule, so it lives in a code comment, not `decisions.md`.
- No engine or server change — the data contract is already ported and tested.

## Definition of done

`pnpm -r typecheck && pnpm -r test && pnpm -r build` green; reviewer pass;
verified in the browser that the tables load from `/api/highscore`, sort on
header click, and page.
