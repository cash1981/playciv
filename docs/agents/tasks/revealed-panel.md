# Task: Revealed and Discarded Items panel (issue #51)

Replace the **Opponents** panel with a **Revealed and Discarded Items** panel:
a chronological, server-paginated list of every publicly known item, showing who
revealed it and whether it was revealed, discarded, or both.

## Decisions (confirmed with the owner)

- **Status / dedup.** Deduplicate a feed row by item identity (`itemNumber`). An
  item revealed and later discarded shows once, carrying both `revealed` and
  `discarded`. The log may still show both lines; that is fine.
- **Order.** Chronological, newest first, one flat list. Each row is tagged with
  its type. No category grouping.
- **Pagination.** Server-backed. The route takes `?page=&size=`, returns a
  bounded page plus the total. Default size 20. Only the current page's images
  load in the browser (native lazy loading).
- **Scope.** Minimal v1, no category filter.

## What is public (hidden-info rule 4)

The feed contains only what is already public:

- **Discarded items** (`state.discardedItems`) — public in this game; a reshuffle
  draws from them and the old `getAllRevealedItems` returned them all. Includes
  silently discarded cards (e.g. the civs a player did not pick), which keep
  their `ownerId`.
- **Non-hidden hand items** (`player.items` with `hidden === false`) — revealed
  and kept.

Hidden hand items and hidden techs must never appear. The log only *enriches*
already-public rows (chronology, revealing player, revealed-then-discarded); it
never adds a row that is not in the public set, so an item revealed and later
returned to the deck or re-hidden does not leak.

## Data model

Engine projection `revealedFeed(state)` returns, newest first:

```
interface RevealedEntry {
  item: Item          // a public item: non-hidden hand item or discarded item
  playerId: string | null   // item.ownerId, the revealing/owning player
  username: string | null   // resolved from players + withdrawnPlayers
  revealed: boolean
  discarded: boolean
  createdAt: string | null  // newest matching log timestamp, for ordering
}
```

Build: seed the map (keyed by `itemNumber`) from discarded items
(`discarded`) and non-hidden hand items (`revealed`); then walk `state.log` and
for each entry with an item and logType `REVEAL`/`DISCARD` that is already in the
map, OR the reveal/discard flags and keep the newest `createdAt`. Sort by
`createdAt` desc, nulls last, stable.

## Paths

- `packages/engine/src/actions/game.ts` — add `revealedFeed` and the
  `RevealedEntry` type (co-located with the projection, already re-exported by
  `index.ts`'s `export * from './actions/game.js'`); keep `allRevealedItems`.
- `packages/server/src/routes/games.ts` — `/revealed` takes `page`/`size`,
  returns `{ items, total, page, size }`.
- `packages/web/src/lib/api.ts` — `revealed(gameId, page, size)` + DTOs.
- `packages/web/src/views/GameView.tsx` — drop the Opponents panel, add
  `RevealedPanel`.
- `packages/web/src/views/RevealedPanel.tsx` — new.
- `packages/web/src/styles.css` — a `discarded` tag if needed.
- Tests: `packages/engine/test/revealed-feed.test.ts`,
  `packages/server/test/api.test.ts`, `packages/web/src/views/RevealedPanel.test.tsx`.

## Acceptance criteria (from the issue)

- Opponents panel removed, replaced by Revealed and Discarded Items.
- Deduplicated by item identity.
- Revealing player shown when known.
- Revealed-but-kept items stay visible.
- Revealed-then-discarded shown once with both facts.
- Pagination bounded server-side.
- Hidden hands and hidden techs protected by regression tests.
