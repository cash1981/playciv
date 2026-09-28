# Issue #190: small improvements — grouped drawn items, combat bonus placement

- **Slug:** `issue-190-small-improvements`
- **Branch:** `feat/issue-190-small-improvements`
- **Owner:** Claude (orchestrator, direct)
- **Status:** draft

## Goal

Two small, unrelated client-only fixes the human filed together as one issue:

1. In the Revealed and Discarded Items panel, items of the same kind (huts,
   villages, great person tiles, wonders, techs, etc.) are grouped together
   instead of interleaved by draw time.
2. In the battle summary bar, a side's combat bonus (e.g. `+6`) is shown next
   to its HP total instead of next to its Attack total.

## Why

Issue #190, filed directly by the human:

> - Group drawn items together. Meaning huts, villages, greatperson tiles etc.
>   Now is sorted by when they where drawn.
> - In the battle section, combat bonus ie: +6 should go next to HP and not
>   attack.

## Scope

**In:**

- `RevealedPanel.tsx`: group the currently loaded page of items the way
  old-civ-web's `RevealedController.readKeysFromItems` did — Civilizations,
  Items (catch-all), Great Persons, Units, Tiles, Culture Cards, Huts,
  Villages, in `revealed.html`'s fixed section order — with a heading per
  non-empty bucket. Within a bucket, keep the existing newest-first order
  unchanged — only regrouping, no resort within a bucket.
- `GameView.tsx`'s battle summary bar: move the `combatBonus` suffix from the
  `ATK` span to the `HP` span.

**Out:**

- Changing the server's `revealed` feed ordering or pagination (issue #166) —
  grouping happens client-side over whatever page is already loaded.
- Any change to `combatBonus`'s value or how it is computed
  (`packages/engine/src/battle.ts` / `state.ts`) — display placement only.
- Grouping the battle summary bar itself, or reproducing old-civ-web's
  per-bucket collapse toggles — the human's issue only asked for the items to
  be grouped, not for the old client's separate collapse-per-section chrome.

## Reference

- Grouping: `old-civ-web/app/scripts/controllers/ReavledController.js`'s
  `readKeysFromItems` (lines 59-80) buckets `game.revealedItems` by item kind
  into `civs` / `items` (the else branch: wonder, city-state, tech, social
  policy) / `greatPersons` / `units` (infantry, artillery, mounted, aircraft)
  / `tiles` / `cultureCards` (cultureI/II/III) / `huts` / `villages`;
  `old-civ-web/app/views/partials/revealed.html` renders those eight buckets
  in that fixed order, each behind its own "Toggle …" collapse. The client
  this replaced (issue #51's Opponents panel; the actual predecessor of this
  panel is this same `revealed.html`/`RevealedController` pair, not a
  separate "Opponents" view) already grouped by kind — an earlier version of
  this brief wrongly said no old-client reference existed here, caught by
  read-only review; ported the real one instead of inventing a new grouping.
  `SHEET_NAME_ORDER`/`SHEET_LABEL` (23 sheet names) was considered and
  rejected as too fine-grained against the old client's 8 buckets, and not
  what the human's own wording ("huts, villages, greatperson tiles") names.
- Combat bonus: `packages/engine/src/battle.ts`'s `BattleSideSummary` doc
  comment and `packages/engine/src/actions/arena.ts`'s battle-winner scoring
  (`totalHealth + combatBonus`) already treat the bonus as tied to
  survivability/HP, not attack — this change only fixes where the client
  displays a number the engine already associates with HP. `old-civ-web` has
  no battle summary bar at all (this bar is new-system UI from issue #63), so
  there is no old-client placement to contradict either way.

## Approach

- `RevealedPanel.tsx`: a `bucketFor(entry)` function ports
  `readKeysFromItems`'s if/else chain (using the existing `isUnit` helper for
  the unit case); `groupByOldClientBucket(items)` buckets with a
  `Map<Bucket, RevealedEntry[]>`, then iterates the fixed `BUCKET_ORDER` and
  skips empty buckets. Render one `<h4>{BUCKET_LABEL[bucket]}</h4>` heading
  `<li>` (spanning the grid via a new `.revealed-group-heading` CSS rule) plus
  the bucket's `RevealedRow`s, inside the same `<ul className="card-grid
  scroll">` as before, so the existing scroll/grid CSS needs no other change.
- `GameView.tsx`: swap which span the `combatBonus` conditional string is
  appended to (from the `ATK` span to the `HP` span).

## Claimed paths

- `packages/web/src/views/RevealedPanel.tsx`
- `packages/web/src/views/RevealedPanel.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/BattlePanel.test.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [ ] The Revealed/Discarded panel groups loaded items into old-civ-web's
      eight buckets, in its fixed section order, each labelled and
      newest-first within itself.
- [ ] The battle summary bar shows the combat bonus beside HP, not ATK.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: unchanged — both changes rearrange already-public
      data (the revealed feed, the battle summary), no new field is read or
      shown.
- [ ] Verified in the browser: a game with a mix of revealed item kinds shows
      grouped headings in the Revealed panel; an active battle's summary bar
      shows `HP <n> (+<bonus>)` and a plain `ATK <n>`.

## Open questions

None that change the work materially — see Reference above for how the group
order and the HP/ATK call were settled by porting the old client rather than
inventing a rule.
