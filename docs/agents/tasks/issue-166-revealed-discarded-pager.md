# Revealed/Discarded panel: bounded initial list with "Load more"

- **Slug:** `issue-166-revealed-discarded-pager`
- **Branch:** `feat/issue-166-revealed-discarded-pager`
- **Owner:** Claude (orchestrator + coder)
- **Status:** done

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

- [x] On first load, at most 6 items are shown (or fewer, or none, if the feed
      is smaller).
- [x] "Load more" fetches and shows 5 more items, cumulative, until the whole
      feed has been shown; then the control is disabled. **Amended in
      review:** up to the server's pre-existing 100-item cap (`MAX_REVEALED_SIZE`,
      issue #51) — past that, "Load more" disables with an explanation instead
      of looping forever, and items beyond the 100th are unreachable from this
      panel. The human chose to accept this rather than widen scope to the
      server; see the 2026-09-25 entry in `decisions.md`.
- [x] `historical` (replay) mode has the same shape, sliced client-side.
- [x] No hidden information regression: still only ever renders
      `RevealedEntry` items already returned by the (unchanged) server route.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (556
      engine, 208 server, 245 web tests).
- [ ] Verified in the browser: a game with more than 6 revealed/discarded
      items shows 6, then 11 after one "Load more" click, then the rest. **Not
      done** — reproducing a live game with 100+ revealed/discarded rows
      would need playing through most of a game via the UI or hand-seeding
      the JSON store, disproportionate for this fix's size. Left to the human
      to confirm visually; the interaction itself (6 → 11 → 16 → … → cap) is
      exercised end-to-end against a faithful mock of the real server route in
      `RevealedPanel.test.tsx`.

## Open questions

None — the growing-list interpretation, and later the 100-item cap tradeoff,
were both confirmed with the human before/during implementation.
