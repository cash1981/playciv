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
4. **No way to show which unit level a card represents.** A physical unit card
   prints several levels, one per edge (e.g. an Artillery card reads Archer,
   Catapult, Cannon or Mobile Artillery depending on which way it faces).
   Requested mid-session: add a "Rotate" button per arena unit, the same idea
   as the existing board-piece rotate button, so players can spin the card to
   the level they mean. Cosmetic only — it does not change `attack`/`health`,
   which stay independently user-entered (see `decisions.md`).

## Why

Direct feedback after testing the merged feature in the browser (see chat).
Not a new rule change — purely a client-side presentation and interaction fix.
No engine or server change is expected.

## Scope

**In:**
- `packages/web/src/views/GameView.tsx` — remove the `pending` confirmation
  step; place immediately on drop/click; restructure the arena markup to a
  single frame with two side-by-side horizontal-scroll rows; add a Rotate
  button per arena unit.
- `packages/web/src/views/ItemCard.tsx` — optional `rotation` prop, applied as
  a CSS transform on the card art.
- `packages/web/src/styles.css` — one shared `.arena-frame` border, horizontal
  `.arena-row` layout for fronts, smaller `.arena-unit-card`.
- `packages/web/src/lib/api.ts` — `rotateArenaUnit` client method.
- `packages/engine/src/battle.ts` — `ArenaUnit.rotation: Rotation` (reuses
  `board.ts`'s `Rotation`/`nextRotation`, same four-way rotation as a board
  piece).
- `packages/engine/src/actions/arena.ts` — `rotateArenaUnit` reducer; seed
  `rotation: 0` in `placeUnitInArena`.
- `packages/engine/src/migrate.ts` — backfill `rotation: 0` on arena units
  from states saved before this change.
- `packages/server/src/routes/arena.ts` — `POST .../arena/:arenaUnitId/rotate`.

**Out:**
- Any change to who may place/kill/end-turn (issue #65, already fixed).
- Automatic attack/health changes from rotation — the printed level is
  cosmetic; combat stats stay independently user-entered, per the original
  issue-63 brief ("Unit upgrades ... applying automatically" was explicitly
  out of scope there too).

## Claimed paths

- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/ItemCard.tsx`
- `packages/web/src/styles.css`
- `packages/web/src/lib/api.ts`
- `packages/engine/src/battle.ts`
- `packages/engine/src/actions/arena.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/test/arena.test.ts`
- `packages/server/src/routes/arena.ts`
- `packages/server/test/api.test.ts`

## Acceptance criteria

- [ ] The arena renders as one bordered frame containing both sides, not two
      separately bordered boxes.
- [ ] Dropping a card on a front, or clicking "Place →", places the unit
      immediately (no separate Confirm step) with attack/health seeded from
      the card.
- [ ] Arena unit cards are visibly smaller than a battlehand card; many units
      on one side scroll horizontally rather than growing the panel tall.
- [ ] Each arena unit has a Rotate button that cycles the card's visual
      rotation 0→90→180→270→0, shared through the server (both sides see the
      same orientation), without touching attack/health.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
