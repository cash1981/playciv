# City-state combat bonus

- **Slug:** `citystate-combat-bonus`
- **Branch:** `feat/citystate-combat-bonus`
- **Owner:** Claude
- **Status:** in review

## Goal

City-state 4 ("1 Culture & +2 Combat bonus") adds +2 to the combat bonus of a
player who has an army or scout of their own colour on its square.

## Rules given by the human

- Only city-state 4 (`city-states/cs4`).
- Several own figures on the square still give +2 once.
- Whoever occupies it first has it until killed there. A figure of another
  colour on the same square means a battle, and only the first one has the
  bonus (corrected by the human after the first version gave it to both).
  Derived by replaying the board history, not stored; it applies only while a
  figure of the holder's colour stands on the square, and then passes to the
  colour that has stood there longest.
- Ownership is the colour of the figure; the white army belongs to the Russian
  player.
- Only the figure on the square counts; holding the city-state card does not.

## Scope

**In:** `combatBonusOf`, `cityStateHolderColour` in `blockade.ts` (and thus the stats panel and battle HP bonus), a
regression test, a line in `decisions.md`.

**Out:** the +1 culture half of the card.
