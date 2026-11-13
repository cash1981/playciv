# Unit tech abilities (#327)

- **Slug:** `unit-tech-abilities` · **Branch:** `feat/unit-tech-abilities` · **Owner:** orchestrator (Sonnet 5.5) · **Status:** in progress

## Goal

First slice of issue #327 ("Automate the tech resource abilities"): the unit techs.
The human, 2026-11-13: "Begynn med unit techene. Dersom noen revealer en tech så
oppgraderer du automatisk level på den uniten. I tillegg så implementerer du også det
som står på kortene ... se på hva som er implementert tidligere, og gjør det på
tilsvarende måte."

The automatic level raise on reveal already exists (`revealTech` in
`actions/player.ts`, `UNIT_LEVEL_TECHS` in `build-item.ts`); the human confirmed the
scope is only the card abilities. Add regression tests for the level raise if a unit
tech lacks one.

## Scope

**In** (the human chose all unit techs, including Combustion):

- **Mathematics** (II, Iron, Battle): deal up to 3 wounds, spread across enemy units.
- **Ballistics** (IV, Iron, Battle): deal up to 6 wounds, spread across enemy units.
  Both: a button in the Battle panel; pay the Iron, then the player spreads the wounds
  over living enemy units in the arena like Georgy Zhukov's wound buttons
  (`zhukovWound`). With undo.
- **Gunpowder** (III, Any 2, City Management): obsolete an ancient or medieval wonder,
  or destroy a building. The player pays two resource tokens of their choice ("Any N"
  payment, reusable for Pottery and Philosophy later); the ability is logged and the
  choice between obsolete wonder and destroy building is made by hand (obsolete is not
  tracked in the engine). With undo.
- **Combustion** (IV, passive): once per turn, when an army ends its movement on a
  building, destroy that building; an army attacking a walled city destroys the walls
  first. Treat like the existing passive/logged abilities; follow the pattern the
  Movement abilities use (Communism, `assisted-communism.ts`). Pick the smallest design
  that fits the existing flow and say what was left manual.

**Out:** Metalworking and all other techs of #327 (later slices); automatic wonder
obsolescence; automatic battle resolution.

## Reference

- Issue #327 and its comment (Democracy, Printing Press, Education are to be included
  later). Card text: `packages/web/src/views/techText.ts`.
- Wiring pattern: `assisted-techs.ts` (table), `assisted.ts` (registry),
  `assisted-communism.ts` and `assisted-steam-power.ts` (resource spend, usage key,
  undo), `assisted-resources.ts` (`findResourceToken` / `spendResource` /
  `returnResource`).
- Battle wounds: `zhukovWound` in `actions/arena.ts`, `battle-cards.ts`,
  `server/src/routes/arena.ts`, `web/src/lib/api.ts`, `GameView.tsx` (Zhukov row).
- `docs/agents/decisions.md`: Assisted build, Great Person generals (Zhukov).

## Approach

Follow the existing patterns above; decide details in the code and record the rules in
the matching `decisions.md` topic. Update the checklist in the issue only after review.

## Claimed paths

- `packages/engine/src/` (assisted*, arena, battle*, state, communism-style new files)
- `packages/engine/test/`
- `packages/server/src/routes/arena.ts`, `packages/server/test/`
- `packages/web/src/lib/api.ts`, `packages/web/src/views/GameView.tsx`,
  `packages/web/src/views/*Battle*`, tests next to them

## Acceptance criteria

- [ ] Each of the four techs has an engine action with a regression test and undo
- [ ] Reveal raises the unit level; tests cover every unit tech
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: nothing new is private; confirm the projection test still passes
- [ ] Browser check of the Battle panel and the tech dialog button, if available

## Open questions

None.

## Amendment 2026-11-13 (human answers after review)

- **Gunpowder "Any":** the six resources (Incense, Iron, Silk, Wheat, Spy, Uranium) are right. Resources
  from culture cards count too (A Gift from Afar, A Generous Gift, A Princely Gift: played as a resource,
  see `card-timing.ts` `asResource`). Shared payment layer in `assisted-resources.ts`: token first (existing rule),
  else a culture card in hand that can be played as that resource, which is discarded; availability counts
  such a card and carries a `warning` naming the card; the log names it; undo returns the card to the hand.
  This applies to every resource ability, not only Gunpowder.
- **Combustion:** the player's own buildings are never targets (own walls already excluded). The player
  chooses WHICH army figure acts (payload names the figure, the square is derived); one use per turn.
- **Mathematics/Ballistics and every tech card except healing:** once per turn (not per battle); only
  healing abilities (Animal Husbandry, Biology) are once per battle. Record this in decisions.md.
