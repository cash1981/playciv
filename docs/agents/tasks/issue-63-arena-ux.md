# Battle arena UX fixes

- **Slug:** `issue-63-arena-ux`
- **Branch:** `fix/issue-63-arena-ux`
- **Owner:** Claude (Sonnet 5)
- **Status:** in progress

## Goal

Fix three problems the human found testing the merged battle arena (issue #63,
PR #66):

1. **Two bordered boxes instead of one shared arena.** `.arena-column` draws
   its own border per side; the human wants one shared frame around both
   sides, with the two columns inside it.
2. **Placing a unit looked like it did nothing.** Clicking "Place →" (or
   dropping a card) only opens a confirmation form with editable ATK/HP
   fields, rendered far below the arena grid — easy to miss, and a unit that
   is dragged/clicked does not visibly land anywhere until a separate
   "Confirm" click. Fix: place immediately (seeded from the card's own
   attack/health), reusing the existing inline ATK/HP inputs already on a
   placed `ArenaUnitCard` for any correction afterwards. This matches the
   brief (issue-63-battle-arena.md): "seeded from card values but editable"
   never required a pre-placement confirmation step.
3. **Arena unit cards are too large.** With several units per side the column
   grows tall and cards are oversized. Shrink the card presentation inside the
   arena and lay fronts out horizontally with a scrollbar instead of an
   ever-growing vertical stack, so many units per side stay usable.

## Why

Direct feedback after testing the merged feature in the browser (see chat).
Not a new rule change — purely a client-side presentation and interaction fix.
No engine or server change is expected.

## Scope

**In:**
- `packages/web/src/views/GameView.tsx` — remove the `pending` confirmation
  step; place immediately on drop/click; restructure the arena markup to a
  single frame with two side-by-side horizontal-scroll rows.
- `packages/web/src/styles.css` — one shared `.arena-frame` border, horizontal
  `.arena-row` layout for fronts, smaller `.arena-unit-card`.

**Out:**
- Any engine or server change — this is presentation only.
- Any change to who may place/kill/end-turn (issue #65, already fixed).

## Claimed paths

- `packages/web/src/views/GameView.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [ ] The arena renders as one bordered frame containing both sides, not two
      separately bordered boxes.
- [ ] Dropping a card on a front, or clicking "Place →", places the unit
      immediately (no separate Confirm step) with attack/health seeded from
      the card.
- [ ] Arena unit cards are visibly smaller than a battlehand card; many units
      on one side scroll horizontally rather than growing the panel tall.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
