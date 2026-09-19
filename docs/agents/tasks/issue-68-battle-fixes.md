# Battle bugs and improvements

- **Slug:** `issue-68-battle-fixes`
- **Branch:** `fix/issue-63-arena-ux` (same branch as the issue-63 UX pass, per
  the human's request — this is a continuation, not a new branch)
- **Owner:** Claude (Sonnet 5)
- **Status:** done

## Goal

Fix the bugs and improvements from
[issue #68](https://github.com/cash1981/playciv/issues/68), found testing the
merged arena UX pass (PR #67):

1. The standalone "End battle" button (draw-battlehand's own cleanup action,
   separate from the arena's "End battle") stayed enabled with nothing to do.
2. A unit dragged from the battlehand/barbarians into the arena should
   disappear from that list, not stay there tagged "In arena".
3. Arena unit cards were shrunk too far in the issue-63 UX pass — restore them
   to the same size as a battlehand card, until told otherwise.
4. Rotate should turn left (counter-clockwise) — that is the upgrade
   direction — and should show which tier the unit would become, so the
   player can adjust attack/health accordingly. Rotating a full 360° returns
   to the base card.
5. The Revealed and Discarded Items panel should show the newest reveal or
   discard first (it was not consistently doing so).
6. Battle, Techs, Revealed and Discarded Items, and Log should default to
   collapsed.
7. Chat should be its own collapsible section, separate from Log, capped to
   10 messages per page with client-side pagination.

## Why

Direct bug/feature feedback after testing PR #67 in the browser. No engine
rule change from the old system — this is entirely new-in-TS arena UI and
presentation work (see `docs/agents/decisions.md`).

## Approach

- **1 (End battle button).** `BattlePanel` now computes
  `hasStandaloneInBattleUnit` from `view.you.items` (any unit with
  `inBattle === true`) and only shows the standalone button when `battle
  === null` AND that is true. In practice this is only ever true if
  something went wrong clearing `inBattle` — after a normal arena end
  (`endBattleAction`) it is always false.
- **2 (disappear on placement).** `BattlePanel` filters `battlehand`/
  `barbarians` down to `availableBattlehand`/`availableBarbarians` (`!unit
  .inBattle`) before rendering the list and the header count. The "Place →"
  button no longer needs an `unit.inBattle` check since a placed unit is no
  longer in the list at all.
- **3 (card size).** `.arena-unit-card .card-art`/`.card-art img` back to the
  same `min-height`/`max-height` as `.card-grid.small` (battlehand's own
  size). `.arena-slot`/`.arena-unit-card` width bumped from 6rem to 7.5rem to
  match.
- **4 (rotate direction + stat preview).** `rotateArenaUnit` now calls
  `nextRotation(unit.rotation, false)` (counter-clockwise) and derives a 0–3
  "presses so far" level purely from the resulting angle
  (`rotationLevel()`, no new field), then sets `attack`/`health` to the
  card's pristine snapshot values plus that level — wrapping back to the
  base values after 4 presses (360°). Aircraft (`unit.unit.kind ===
  'aircraft'`) print no level ladder, so the stat suggestion is skipped for
  them; rotation stays cosmetic-only there, as it was for everyone before
  this diff. This does **not** read or write `UnitItem.level`/
  `unitLevelNames` — see `decisions.md` for why, and for a correction: the
  bonus progression is arithmetically the same as Java's ported (but never
  driven) `level - 1` formula, one press ahead of Java's level number; what's
  new is only that a rotate button drives it and that it stays out of the
  pristine card's own `level` field. The suggested values overwrite the
  arena's current attack/health, including any damage already tracked as
  reduced health — intentional, matching how rotating a physical card to a
  new level replaces its stats outright. The player can still hand-edit the
  values afterwards through the existing inputs.
- **5 (revealed sort).** `revealedFeed`'s fallback tiebreak (used only when
  two rows have no distinguishing timestamp or log entry) was ascending by
  seed order, which put the oldest of a tied group first — the opposite of
  "newest first". Flipped to descending. The primary timestamp-based sort was
  already newest-first and already tested; verified this directly against a
  live server before concluding only the fallback needed fixing.
- **6 (default collapsed).** `defaultOpen={false}` on the Battle, Techs,
  Revealed and Discarded Items, and Log `CollapsiblePanel`s. Social Policy is
  not a separate panel — it lives inside the Techs panel — so collapsing
  Techs collapses it too.
- **7 (chat panel).** Extracted the chat list/composer out of `LogPanel` into
  a new `ChatPanel.tsx`, its own `CollapsiblePanel id="chat"` (left open by
  default — not in the collapsed list). `api.chat` returns the whole history
  in one call (no server paging), so pagination here is a plain client-side
  slice: newest-first, 10 per page, Previous/Next, matching the pattern
  already used by `RevealedPanel`.

## Claimed paths

- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/LogPanel.tsx`
- `packages/web/src/views/ChatPanel.tsx` (new)
- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/RevealedPanel.tsx`
- `packages/web/src/styles.css`
- `packages/engine/src/actions/arena.ts`
- `packages/engine/src/actions/game.ts`
- `packages/engine/test/arena.test.ts`
- `packages/engine/test/revealed-feed.test.ts`
- `packages/server/test/api.test.ts`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] The standalone "End battle" button is hidden once there is nothing left
      to clean up.
- [ ] Placing a unit removes it from the battlehand/barbarians list (and its
      count) immediately.
- [ ] Arena cards are the same size as a battlehand card.
- [ ] Rotate turns counter-clockwise; attack/health preview one tier higher
      per press, from the base card, wrapping to base after 360°.
- [ ] Revealed and Discarded Items shows the newest reveal/discard first,
      including when two entries share no distinguishing timestamp.
- [ ] Battle, Techs, Revealed and Discarded Items, and Log start collapsed.
- [ ] Chat is its own panel, open by default, 10 messages per page.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
