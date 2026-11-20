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

In: the items above with tests. Out: setup phase, conquest triggers, manual token removal.

## Acceptance criteria

- [ ] Each item has regression tests
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] No hidden information in new projections
- [ ] Browser check: not available to the coder; disclose
