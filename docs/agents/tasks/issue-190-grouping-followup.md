# Issue #190 follow-up: grouping belongs in the hand, not in Revealed/Discarded

- **Slug:** `issue-190-grouping-followup`
- **Branch:** `feat/issue-190-grouping-followup`
- **Owner:** Claude (orchestrator, direct)
- **Status:** in progress

## Goal

The Revealed and Discarded Items panel goes back to a flat, newest-first list
(its behaviour before issue #190). The player's own "Your hand" panel gains
the kind-based grouping instead — items grouped under headings (Civilizations,
Items, Great Persons, Units, Tiles, Culture Cards, Huts, Villages) rather than
in whatever order the API returns them.

## Why

Issue #190 was implemented against the wrong panel. The human's direct
correction:

> Jeg tror du har helt misforstått hva jeg mente. Det er ikke revealed og
> discarded som skal grupperes på sheetname, men det som er i hånda di.
> Revealed og discarded skal sorteres på det siste som ble discarded akkurat
> som tidligere. Så dette må revertes tilbake og riktig sortering skal kun da
> ligge under "min hånd" Your hand

Translation: it's not Revealed/Discarded that should be grouped by kind, it's
what's in your hand. Revealed/Discarded should sort by most-recently-discarded,
same as before. Revert that, and grouping belongs only under "Your hand".

## Scope

**In:**

- `RevealedPanel.tsx`: remove `bucketFor`/`groupByOldClientBucket`/
  `BUCKET_ORDER`/`BUCKET_LABEL` and the grouped rendering; go back to mapping
  `items` straight into `RevealedRow`s in their existing (already newest-first)
  order — the panel's pre-issue-#190 shape. `RevealedRow` itself, the
  server-side `revealedFeed` sort, and the "Load more"/pagination logic are
  untouched; only the render is de-grouped.
- `RevealedPanel.test.tsx`: remove or rewrite the grouping-heading assertions
  added for issue #190; restore/add a test asserting a flat, newest-first
  render.
- `styles.css`: drop `.revealed-group-heading` and its two related rules if
  nothing else references them after the panel change.
- `GameView.tsx`'s `HandPanel`: group `items` (`view.you?.items ?? []`) the
  same way — same eight buckets, same fixed order, same "keep existing order
  within a bucket" rule — before rendering `HandItem`s. `LootControls` and
  `GreatPersonDiscardControls` (which read the same flat `items` array) are
  unaffected; only the `<ul className="card-grid scroll">` map at
  GameView.tsx:651-662 changes shape.
- A small test addition for `HandPanel` asserting hand items render grouped
  under headings in the fixed order.

**Out:**

- The battle summary bar's combat-bonus placement (HP vs ATK) — the other half
  of the original issue #190/PR #192, unrelated and already correct. Not
  touched.
- Per-bucket collapse toggles old-civ-web's `useritems.html` had — issue #190's
  own decision record already rejected this extra chrome for Revealed/
  Discarded, on the grounds that the issue only asked for grouping, not more
  UI. Same reasoning applies to the hand panel; a heading per non-empty bucket
  is enough.
- Porting `useritems.html`'s Tech pyramid section — a separate, already-built
  feature in this port, not part of hand-item grouping.
- "Other players' hands" (`OpponentsPanel`-equivalent) grouping — the human
  named "your hand"/"min hånd" specifically; opponents' hands are out of scope
  unless asked for separately.

## Reference

- `old-civ-web/app/scripts/controllers/ReavledController.js:59-80` +
  `old-civ-web/app/views/partials/revealed.html` group the Revealed/Discarded
  feed by kind. This is what issue #190 ported — correctly, against the
  Revealed panel, per the old client. The human's follow-up here is a
  deliberate deviation from that reference for *this* panel: recorded in
  `decisions.md` as a human-directed choice, not a misreading of the old
  client.
- `old-civ-web/app/scripts/controllers/UserItemController.js:53-74` +
  `old-civ-web/app/views/partials/useritems.html` (lines 54-332 for the eight
  sections) independently duplicate the *exact same* bucketing logic and
  order for the player's own hand view. This confirms the human's requested
  new home for the grouping has real old-client precedent — it just wasn't
  ported when issue #190 was done, because that task's investigation only
  looked at `ReavledController`, not `UserItemController`.

## Approach

- Extract the bucketing (`bucketFor`, `groupByOldClientBucket`, `BUCKET_ORDER`,
  `BUCKET_LABEL`, the `Bucket` type) out of `RevealedPanel.tsx` into a small
  shared module (e.g. `packages/web/src/views/itemBuckets.ts`) so `HandPanel`
  can reuse it verbatim instead of a second hand-rolled copy — unlike old-
  civ-web's two independent copies, this port has one implementation used by
  two panels rather than reproducing the duplication.
  `RevealedPanel.tsx` then drops its own copy and its grouped render; the
  hand panel imports the shared module and renders headings the same way
  `RevealedPanel` used to.
- Keep `RevealedRow` and `HandItem` exactly as they are; only what wraps them
  changes.

## Claimed paths

- `packages/web/src/views/RevealedPanel.tsx`
- `packages/web/src/views/RevealedPanel.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/GameView.test.tsx`
- `packages/web/src/views/itemBuckets.ts` (new)
- `packages/web/src/styles.css`
- `docs/agents/decisions.md`
- `docs/agents/state.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] Revealed/Discarded panel renders a flat, newest-first list again — no
      group headings, `atCap`/pagination/refresh behaviour unchanged.
- [ ] "Your hand" panel renders items grouped under the eight fixed-order
      headings, non-empty buckets only, preserving existing item order within
      each bucket.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: unchanged — both panels already only ever show data
      already scoped to be visible to this client (the hand panel already only
      renders `view.you.items`); grouping is a display-only change.
- [ ] Verified in the browser: both panels checked against a real game with a
      mixed hand/discard pile.

## Open questions

None that change the work materially — the human's message directly settles
both where grouping belongs and what Revealed/Discarded should look like
instead.
