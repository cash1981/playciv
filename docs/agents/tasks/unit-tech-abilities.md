# Tech resource abilities, slice 2 (#327)

- **Slug:** `unit-tech-abilities` · **Branch:** `feat/unit-tech-abilities` (PR 346) · **Owner:** orchestrator (Sonnet 5.5) · **Status:** in progress

## Goal

Everything left of issue #327 after the unit techs (slice 1, merged into this branch: Mathematics,
Ballistics, Gunpowder, Combustion, culture cards paying resources). The human, 2026-11-13: "fortsett
på resten så kan jeg teste alt samlet", on the same branch and PR. Follow the existing patterns
(`assisted-techs.ts`, `assisted.ts`, `assisted-communism.ts`, `assisted-gunpowder.ts`,
`assisted-tech-wounds.ts`, `assisted-resources.ts` incl. `spendAnyResources`/culture-card payment) and
read the "Unit tech abilities (#327)" and Assisted-play "Resources" topics in `decisions.md` first.
Card text: `packages/web/src/views/techText.ts`. Democracy and Printing Press already exist
(`coinPurchase` in `assisted.ts`): do not rebuild them, just cover them with a test if missing.

## Human decisions (do not re-ask)

- **Nuke = Uranium.** Atomic Theory: both parts automated: (a) "extra action with each city": one more
  city action per city this turn (see `confirmedAnotherCityAction` and the city-action counting in
  `city-actions.ts`); (b) nuke a non-capital city: the city and every building, wonder, figure and great
  person in its outskirts are removed through the engine (board history, so the vote undo restores
  them), with undo. Marie Curie's substitution applies as for any Uranium spend.
- **Cancel abilities** (Writing: Spy, City Management, cancel a city action; Civil Service: Spy, Any
  Time, cancel a culture event; Mass Media: Spy, Any Time, cancel a resource ability, the resources
  spent on it are lost): pay the Spy, name the target player (and action/card as free text where the
  picker has it), log it. The cancelled action is not blocked by the engine (no pending-action
  concept); the other player's existing undo vote or manual correction does the rest. Say so in
  `decisions.md`.
- **Monarchy** (Silk, City Management): two modes in the payload. `obsolete`: logged only (obsolescence
  is not tracked). `kill`: the engine draws a random (seeded, `random.ts`) unit card (infantry,
  artillery, mounted or aircraft, any item of kind unit) from the chosen opponent's hand and
  discards it; the public log names the discarded unit in full WITH its item number (a discard is open
  information; copy how Gunustavus Adolphus' discards are logged, `itemNumberText`). Undo returns the card to
  that hand while it is still in the discard pile; refuse the kill with a reason when the opponent
  holds no unit card (and spend nothing).
- All tech cards are once per turn (except healing), the usual usage key with confirmed repeat.
- Culture cards pay resources already (shared payment layer), so use `spendResource` /
  `spendAnyResources` for every payment and keep the Gift from Afar note behaviour.

## Scope

**Batch 1** (engine + server + web, tests for each):

1. **Production boosts:** Animal Husbandry (Wheat, +3), Construction (Wheat, +5), Banking (Wheat, +7),
   Plastics (Wheat, +10): City Management, one city of the player produces that much extra this turn.
   The player picks the city. The bonus counts in the city's production used for Build / the production
   estimate this turn only, derived from the applied action so the vote undo removes it (as the Communism
   lock is). Animal Husbandry's heal and Plastics' Start of Turn free build stay as they are.
2. **Pottery** (Any 2, City Management): pay two resources (`spendAnyResources`), add 1 coin to Pottery's
   coin counter, max 4 (see `coins.ts`, `coinSources`, how Democracy/Printing Press add their coin). Undo.
3. **Philosophy** (Any 3, City Management): pay three resources (generalise the Any-N helper to 3), draw a
   random great person card from the deck into the player's hand (seeded; see how other abilities draw a
   great person, e.g. Patronage / Start of Turn). The card is PRIVATE: the public line says only that a
   great person was gained; the name goes to the private log only (hidden-information invariant, add a
   projection test). Undo returns the card to the deck at its place if it is still in the hand.
4. **Education** (4 resources, one of each, City Management): pay four DIFFERENT resources (the player names
   four of the six kinds; token first, culture cards last as the shared layer does), then the player
   learns a new tech of their choice for free. Reuse the free-tech mechanism (`techGrants`, see Rationalism
   / hut / investment and how `revealTech` spends a grant), adapted so that it works in City Management;
   choose the smallest design and state it in `decisions.md`. Education's coin on building a wonder is
   already covered by `coins.ts` (check, test if missing). Undo while the grant is unused.
5. **Horseback Riding** (Silk, Trade phase): gain 9 trade; another player of the player's choice gains 6
   trade (target picker like `playCard` targets). Both counters change; public log; undo returns the Silk and
   takes both gains back (refuse when the target has spent the trade since, as Mother Teresa's undo does).
6. **Mysticism** (Spy, City Management): force an opponent to discard a coin token of the player's choice:
   choose the opponent and one of their coin counters (public stats, see Mother Teresa / Counterfeiters).
   Refuse when the opponent holds no coin. Undo gives the coin back.
7. **Writing, Civil Service, Mass Media:** as decided above.
8. **Monarchy:** as decided above.

**Batch 2** (a second coder run, after batch 1 is verified):

9. **Metalworking** (Iron, Battle): "when playing a unit from hand, add 3 to the attack of its strength":
   a Battle-panel button like Mathematics (`assisted-tech-wounds.ts`): pay the Iron, then the player picks
   one of their own units in the arena and its attack goes up by 3 (arena unit `attack` is user-entered;
   see `actions/arena.ts`); once per turn, undo while the unit's attack was not edited since.
10. **Atomic Theory:** as decided above.
11. **Bureaucracy** (once per turn, during research, switch one social policy; unlocks 1 coin): find what the
    engine already allows for policy switching in Research; make it a logged once-per-turn action that
    permits one switch if that is the smallest fitting design, and say what stays manual. The 1 coin on
    reveal is covered by the existing flat-coin handling (check with a test).

**Out:** automatic wonder obsolescence; automatic battle resolution; the passive halves of cards
(healing, hand-size, stacking and the like), which exist or stay manual.

## Reference

`docs/agents/decisions.md`: Assisted build, Resources, Unit tech abilities (#327), Great Person
cards, Coins. Issue #327 and its comment (Democracy, Printing Press, Education included).

## Approach

Slice by slice in the patterns above; record each rule in `decisions.md` (one topic section
"Tech resource abilities (#327)" for slice 2, rationale only) and any open gap in `limitations.md`.
Update `assisted-techs.ts`, `AssistedActionKind`/`AssistedEffect`, payload types in
`assisted-core.ts`, server parsers (`assisted-args.ts`), web pickers in `AssistedActions.tsx` and the
tech dialog. Tests next to each (engine, server route, web component).

## Claimed paths

- `packages/engine/src/` (assisted*, city-actions, city-production, coins, state, new files)
- `packages/engine/test/`, `packages/server/src/routes/`, `packages/server/test/`
- `packages/web/src/lib/api.ts`, `packages/web/src/views/AssistedActions.tsx`, `TechPanel.tsx`,
  `GameView.tsx`, `BattlePanel*`, tests next to them

## Acceptance criteria

- [ ] Every listed tech has an engine action with a regression test and undo
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: Philosophy's drawn card and Monarchy's hand are not visible to others; tests
- [ ] Browser check of the new pickers, if available

## Open questions

None. Education's "4 different resources" is read as four of the six kinds; flag it in `decisions.md`.
