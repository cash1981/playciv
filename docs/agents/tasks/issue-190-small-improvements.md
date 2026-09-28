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

- `RevealedPanel.tsx`: group the currently loaded page of items by
  `item.sheetName`, in `SHEET_NAME_ORDER` (the existing port of Java's
  `SheetName` enum ordinal), with a heading per group using the existing
  `SHEET_LABEL`. Within a group, keep the existing newest-first order
  unchanged — only regrouping, no resort within a kind.
- `GameView.tsx`'s battle summary bar: move the `combatBonus` suffix from the
  `ATK` span to the `HP` span.

**Out:**

- Changing the server's `revealed` feed ordering or pagination (issue #166) —
  grouping happens client-side over whatever page is already loaded.
- Any change to `combatBonus`'s value or how it is computed
  (`packages/engine/src/battle.ts` / `state.ts`) — display placement only.
- Grouping the battle summary bar itself, or grouping anything by `kind`
  instead of `sheetName` — sheetName already carries the human-facing label
  and the old system's grouping order, so it is reused rather than inventing
  a second taxonomy.

## Reference

- Grouping order: `packages/engine/src/sheet-name.ts`'s `SHEET_NAME_ORDER`,
  itself a direct port of `no.asgari.civilization.server.SheetName`'s ordinal
  order, already used to sort items via `Item.compareTo` in the old system.
  No old-client UI reference groups this feed by kind — old-civ-web's
  Opponents panel this replaced (issue #51) was also a flat list — so this is
  a new UI arrangement, not a ported one; the order it groups by is old-system
  data, not a guessed one.
- Combat bonus: `packages/engine/src/battle.ts`'s `BattleSideSummary` doc
  comment and `packages/engine/src/actions/arena.ts`'s battle-winner scoring
  (`totalHealth + combatBonus`) already treat the bonus as tied to
  survivability/HP, not attack — this change only fixes where the client
  displays a number the engine already associates with HP.

## Approach

- `RevealedPanel.tsx`: derive `groups` from `items` with
  `Map<SheetName, RevealedEntry[]>`, iterate `SHEET_NAME_ORDER` and skip empty
  groups, render one `<h4>{SHEET_LABEL[sheetName]}</h4>` + `<ul>` of
  `RevealedRow`s per non-empty group instead of the single flat `<ul>`.
- `GameView.tsx`: swap which span the `combatBonus` conditional string is
  appended to (from the `ATK` span to the `HP` span).

## Claimed paths

- `packages/web/src/views/RevealedPanel.tsx`
- `packages/web/src/views/RevealedPanel.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/BattlePanel.test.tsx`

## Acceptance criteria

- [ ] The Revealed/Discarded panel groups loaded items by `sheetName`, in
      `SHEET_NAME_ORDER`, each group labelled and newest-first within itself.
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
order and the HP/ATK call were settled without inventing a rule.
