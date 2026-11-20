# Civ abilities: review feedback

- **Slug:** `civ-abilities-feedback` · **Branch:** `feat/civ-abilities-romans-chinese-spain` · **Owner:** coder (Claude Sonnet 5.5) · **Status:** in progress

## Goal

Human decisions on PR #373 (issue #368):

1. Every ability log line that states a gain gives the amount and the new total, e.g. `gained 3 (14) culture ...`.
2. Chinese: village tokens give +3 culture too; the walled capital marker is put in the area at reveal; the player chooses the saved unit (`chineseSave` on end of battle, picker in the web UI).
3. Spain + Natural Religion: the army travels 4, a scout 3.
4. Indians: the metropolis marker is put in the area at reveal.
5. Arabs: +1 culture for each resource token spent (central hook in `assisted-resources.ts`, undo clamped).
6. Germans: one free unit per unit type is settled; record in decisions.md.
7. Update decisions.md and limitations.md.

## Scope

In: the items above with tests, and (follow-up) the conquest offers below. Out: setup phase, manual token removal.

## Acceptance criteria

- [ ] Each item has regression tests
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] No hidden information in new projections
- [ ] Browser check: not available to the coder; disclose

## Follow-up: conquest offers

Human decision: a Roman or Chinese conquest asks the player whether to take the reward, never an automatic gain.

1. The Chinese +3 for a village token at collection is removed (huts keep it).
2. An own army of a Roman or Chinese player that ends its move on a village token (both) or on another player's city
   (Romans) records a pending conquest (`GameState.pendingConquests`, one per player).
3. When the battle ends and that player won with the army still on the square against the matching side (barbarians for
   a village, the city owner for a city), an offer (`conquestOffers`, kept on `EndedBattle` so End battle's Undo
   removes an unanswered one) is created. Pending entries of the combatants are consumed whatever the outcome.
4. The assisted action `claimConquest` (`offerId`, `accept`) answers it: Romans advance one space for free, the Chinese
   gain 3 culture, or decline. Its undo reopens the offer.
5. Server wiring, the `you.conquestOffers` projection and a prompt in the web.
6. Also: the Chinese hut Undo no longer refuses when the culture is spent (clamped take-back); "saves no unit" is logged
   only when there was a candidate.
7. decisions.md and limitations.md.
