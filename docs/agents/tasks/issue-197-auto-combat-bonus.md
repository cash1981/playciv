# Automatic combat bonus

- **Slug:** `issue-197-auto-combat-bonus`
- **Branch:** `claude/trusting-meitner-q7h0j4` (assigned by the session, not `feat/`)
- **Owner:** Claude
- **Status:** in review

## Goal

A player's combat bonus is calculated by the engine, not typed in. The Combat
cell in the Status panel's Modifier group is read-only.

## Why

Issue #197 (human): the combat bonus should be worked out from what the player
has, and recalculated whenever any of it is added or removed.

## Sources (from the human, no old-system reference)

| Source | Bonus |
| --- | --- |
| Barracks (building) | +2 each |
| Navy = the Shipyard building | +2 each |
| Academy (building) | +4 each |
| General (great person piece) | +4 each |
| MIC investments (`stats.mic`) | +4 per 2 investments, up to 6 investments (max +12) |
| Fundamentalism government | +4 |
| French civilization | +2 |
| Statue of Zeus, owned, in the Wonders area | +6 |

## Design

- `packages/engine/src/combat-bonus.ts`: `combatBonusOf(state, player)`, pure.
- Derived on read, like `cityCountOf`: `toPlayerView` (own and opponents) and
  `battleSummaries` use it, so it cannot go stale and needs no hook on the
  board, government or civilization actions. A stored `stats.combat` is ignored.
- `setPlayerStat` refuses `combat` with `STAT_NOT_EDITABLE` (HTTP 400). Combat
  can no longer be negative, since nothing subtracts.
- Buildings and generals are attributed by `placedBy`, the same rule as
  `buildingCountOf`.

## Out of scope

Manual adjustment on top of the calculated value (human: not for now).
