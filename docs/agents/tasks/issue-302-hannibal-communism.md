# Hannibal and Communism (issue #302)

- **Slug:** `issue-302-hannibal-communism`
- **Branch:** `feat/issue-302-figure-movement` (same PR as the other movement slices)
- **Owner:** opencode (orchestrator/coder)
- **Status:** in review
- **Issue:** [#302](https://github.com/cash1981/playciv/issues/302)

## Goal

Hannibal can move any or all of the player's figures from one square to another
square that already contains their figures without exceeding the stacking limit.
Communism's Spy ability can lock a map square for the Movement phase: figures may
enter it but may not leave it that turn, including figures on water.

## Scope

**In:**

- Hannibal: source and destination both have the player's figures; source and
  destination differ; selected figures fit the effective stacking limit at the
  destination; a Galileo-locked figure is not offered; card undo restores
  everything.
- Communism: a Movement-phase assisted action spending a Spy, choosing any map
  square, with a public lock. The lock affects normal travel, Galileo, movement
  culture cards and Hannibal. Undo returns the Spy and removes the lock.
- A locked square may be entered but not left; a figure on water can be locked
  even without Sailing.

**Out:**

- Steam Power, Brandenburg Gate, and scout/icon follow-ups.
- Automatic map-tile discovery and battle/loot/stacking.

## Acceptance criteria

- [x] Hannibal moves any/all figures within the stacking limit and undo restores.
- [x] Communism spends a Spy, locks the chosen square publicly, and undo reverses it.
- [x] All implemented movement paths cannot leave a locked square.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Verified in the browser by the human.

## Handover

Rules and source references are under "Hannibal and Communism (#302)" in decisions.
Validation: `pnpm -r typecheck` passed; `pnpm -r test` passed (engine 72 files /
2162 tests, web 63 files / 1152 tests, server 40 files / 850 tests);
`pnpm -r build` passed.
