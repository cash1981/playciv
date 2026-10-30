# Build costs: unit levels, wonder trade and wonder discounts

- **Slug:** `build-costs` · **Branch:** `fix/build-costs` · **Owner:** Claude (Opus 5.5) · **Status:** in progress

## Goal

A player reported, in the human's words: units have the wrong build cost ("level 1
costs 5, level 2 costs 7, level 3 costs 9, level 4 costs 11 and aircraft costs
12"); paying with trade does not take the trade automatically; and a wonder is
not cheaper with the tech that should discount it ("look in the tech cards for
the right wonder price").

## Scope

**In:** unit level from revealed techs for Build's cost (and the status value on
reveal); wonders checked against production and rushed with trade like every
other build; Angkor Wat discounted by Philosophy to 15, per the tech sheet.

**Out:** Leonardo's Workshop's 5-production units and other card effects on
cost (not asked).

## Reference

`decisions.md` "Assisted build". Tech reference sheet
`packages/web/public/help/Civ_Tech_FF-WW.-1.jpg` (Military Unit table, Wonders
table) and `-2.jpg` (tech cards with the wonder each unlocks and its price).

## Approach

- `build-options.ts`: `UNIT_LEVEL_TECHS` (Chivalry, Democracy, Mathematics,
  Logistics → II; Railroad, Gunpowder, Metal Casting → III; Combustion,
  Replacement Parts, Ballistics → IV). Level = max(status value, revealed techs).
- `actions/player.ts` `revealTech`: raise the unit status values on the first
  reveal, as Flight sets Aircraft.
- Wonders: `paymentFor` with the discounted cost; rush trade paid and refunded
  like a building.
- `wonder-data.ts`: Angkor Wat Philosophy 15.

## Claimed paths

- `packages/engine/src/build-options.ts`, `wonder-data.ts`, `actions/player.ts`
- `packages/engine/test/`, `packages/server/test/`, `packages/web/src/views/BuildPicker*`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Units cost 5/7/9/11 by the level the revealed techs give; aircraft 12
- [ ] A wonder above production asks for and pays rush trade; undo refunds it
- [ ] Angkor Wat costs 15 with Philosophy
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: unrevealed techs do not lower a cost
- [ ] Browser check: Build picker shows a wonder's trade
