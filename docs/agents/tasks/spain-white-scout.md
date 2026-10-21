# Spain's white scout

- **Slug:** `spain-white-scout`
- **Branch:** `feat/spain-white-scout`
- **Owner:** Claude
- **Status:** in review

## Goal

Russia (one white army) and Spain (one white scout) get a figure on top of the
six armies and two scouts of their colour. Revealing the civ puts it in the
player's own area, where the palette counts it as used. Removing it makes it
available again, so it can always be rebuilt.

## Why

Human: "Det som er utfordringen er hvis man remover den hvite scout eller
armien, så er det ingen måte å bygge den på nytt. […] plasser den i player area,
men sørg da for at det da vises 0 for Pieces / white scout/army og at dersom man
remover så settes denne til 1 og kan flyttes tilbake."

## Scope

**In:**

- `figures/whitescout` asset (red scout recoloured), supply of one, Spain only.
- Auto-placement of the civ's white figure in the player's area on reveal;
  undo-reveal takes it back through the recorded `pieceIds`.
- White figures count as their civ's colour in blockade and City-state 4.
- Palette offers a white figure to that civ's player only.

**Out:**

- Placing the army for players who revealed Russia before this change.
- A rule that stops other players removing the figure; everyone can move every piece.

## Reference

Spanish card: "The Spanish start with 2 scouts." Read as one extra scout.
See the board section of [decisions](../decisions.md).

## Acceptance criteria

- [x] `pnpm -r typecheck && pnpm -r test` pass
- [x] Hidden information: no projection changes
- [ ] Verified in the browser

## Handover

See the pull request.
