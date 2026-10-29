# Movement culture cards (issue #302)

- **Slug:** `issue-302-movement-cards`
- **Branch:** `feat/issue-302-figure-movement` (same PR as the movement and Galileo slices)
- **Owner:** opencode (orchestrator/coder)
- **Status:** in review
- **Issue:** [#302](https://github.com/cash1981/playciv/issues/302)

## Goal

Playing Migrants, Colonists or Immigrants in Movement, or Disoriented, Lost or
Out of Position in City Management, asks for map squares and carries out the
printed movement: one own figure for the first three, every figure of another
player in a square for the last three. The card undo vote restores the figures
and returns the card.

## Scope

**In:**

- Migrants 2, Colonists 4, Immigrants 6: one own figure to an empty square,
  using the ordinary cardinal travel rules for figures, huts/villages, water and
  Flight.
- Disoriented 2, Lost 3, Out of Position 4: all figures of the other player whose
  figures are in the source square, together, to an empty square, with no water
  and no diagonals. The source square names the player; there is no target
  picker.
- Empty follows rules 61 to 63 through `empty-square.ts`.
- A figure moved by its normal travel may still be moved by these cards; they do
  not spend or set the normal movement lock.
- A figure locked by Galileo this City Management is not a valid choice.
- One card and all moved figures are one assisted action with one undo vote.
- The card form uses the shared board picker and confirmation popup. Multiple
  figures in a one-figure source get a figure selector. A group source must hold
  figures of exactly one other player.

**Out:**

- The City Management social-policy switch of Migrants/Colonists/Immigrants:
  manual through the Social policy panel, as decided.
- Hannibal, Communism and Steam Power.
- Brandenburg Gate and scout/icon follow-ups.

## Acceptance criteria

- [x] The six cards show their movement flow only in the right phase; the policy
  switch is still manual.
- [x] Sources and destinations follow the card allowance and the empty-square,
  water, hut/village and figure rules.
- [x] One-figure cards move exactly the chosen figure; group cards move the whole
  group of the named player.
- [x] Card undo restores figures and the card; board Undo refuses the individual
  moves.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Verified in the browser by the human.

## Handover

The rules are recorded under "Movement culture cards (#302)" in decisions.
Validation: `pnpm -r typecheck` passed; `pnpm -r test` passed (engine 70 files /
2149 tests, web 63 files / 1150 tests, server 40 files / 850 tests);
`pnpm -r build` passed.
