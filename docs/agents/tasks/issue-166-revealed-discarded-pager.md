# Revealed/Discarded panel: bounded initial list with "Load more"

- **Slug:** `issue-166-revealed-discarded-pager`
- **Branch:** `feat/issue-166-revealed-discarded-pager`
- **Owner:** Claude (orchestrator + coder)
- **Status:** draft

## Goal

The Revealed and Discarded Items panel shows at most 6 items when a game page
loads. A "Load more" button fetches 5 more from the server and adds them to
the same list, until every item in the feed has been shown.

## Why

GitHub issue #166: "There should be a maximum of 6 items on discarded /
revealed page. Then when you push the next page you can server side load the
next 5." Confirmed with the human that this means a growing list (load more),
not a traditional Previous/Next pager with a smaller page size.

## Scope

**In:**

- `RevealedPanel` (`packages/web/src/views/RevealedPanel.tsx`): replace the
  fixed `PAGE_SIZE = 20` Previous/Next pager with a growing `visibleSize`
  state, starting at 6, incremented by 5 per "Load more" click. Re-requests
  page 1 with the larger size each time (the endpoint already returns the
  first N items of the full feed, so this naturally reads as "add 5 more").
  Same treatment for the `historical` (replay) branch, sliced client-side.
- Its test file (`RevealedPanel.test.tsx`), extended to cover the new
  behaviour.

**Out:**

- The server route (`packages/server/src/routes/games.ts`) and the engine
  projection (`revealedFeed`) — both already support arbitrary `page`/`size`
  and need no change.
- Any other panel's pagination (Tech, Log, etc.) — out of scope for this
  issue.

## Reference

No old-system precedent: `old-civ-web`'s `ReavledController.js` /
`revealed.html` dumped the entire revealed/discarded history with no
pagination at all. This whole panel and its page/size mechanism is new,
introduced under issue #51. Issue #166 only changes the numbers and the
interaction shape (growing list instead of a page-swap pager); confirmed with
the human, not invented.

## Approach

- Replace `page`/`PAGE_SIZE` state with `visibleSize` (initial 6).
- `load(size)` requests `api.revealed(gameId, 1, size)` (or slices
  `historical.revealed` the same way) and replaces `data` wholesale — no
  client-side appending, so there is no risk of duplicate or stale entries if
  the underlying feed changes between loads.
- Effect depends on `[gameId, historical, reloadCount, visibleSize]` so an
  external refresh (`reloadCount`) keeps the current `visibleSize` rather than
  resetting to 6, matching the current panel's behaviour of staying where the
  viewer left it.
- "Load more" button: `disabled={items.length >= total}`, increments
  `visibleSize` by 5. Drop the old page-overshoot correction effect — it no
  longer applies once there is no "current page" to fall off the end of.
- Keep the existing "Refresh" button, re-running `load(visibleSize)`.

## Claimed paths

- `packages/web/src/views/RevealedPanel.tsx`
- `packages/web/src/views/RevealedPanel.test.tsx`

## Acceptance criteria

- [ ] On first load, at most 6 items are shown (or fewer, or none, if the feed
      is smaller).
- [ ] "Load more" fetches and shows 5 more items, cumulative, until the whole
      feed has been shown; then the control is disabled.
- [ ] `historical` (replay) mode has the same shape, sliced client-side.
- [ ] No hidden information regression: still only ever renders
      `RevealedEntry` items already returned by the (unchanged) server route.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser: a game with more than 6 revealed/discarded
      items shows 6, then 11 after one "Load more" click, then the rest.

## Open questions

None — the growing-list interpretation was confirmed with the human before
starting.
