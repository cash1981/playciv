# Issue #253 A: finish coin sources and wonder eligibility

- **Slug:** `issue-253-a-coins`
- **Branch:** `feat/issue-253-a-coins`
- **Owner:** Codex
- **Status:** in progress

## Goal

Players can track Education's wonder coins and see/maintain Internet and Panama Canal coins according to the wonder's current ownership and usable state, including when the marker moves, becomes blockaded, is disabled, changes owner, or is restored by undo/time travel.

## Why

The requested slice is section A of [issue #253](https://github.com/cash1981/playciv/issues/253). The issue recommends A1 and A2 as the first release: they close gaps using values the game already tracks, while Bank/Adam Smith calculations and coin-purchase actions require broader city or phase modelling.

## Scope

**In:**

- Add Education (III) as a revealed coin source with 0 initial coins and a normal limit of 4. Keep awards manual; revealing Education or changing/placing a wonder does not award a coin.
- Let the active, unblocked owner of The Internet use its +2 capacity for Education and the four existing coin-token technologies. The ability follows ownerId in the Wonders area, a player's area, or the map; it is inactive while blockaded or disabled.
- Share the active-wonder eligibility calculation between the UI and engine validation.
- Store Panama Canal's accumulated coins with its wonder marker, so they remain on that wonder through owner changes and temporary blockade. Count them only for its active owner; blockade suppresses the contribution without deleting the tokens.
- Reconcile legacy games by transferring the current Panama owner's existing stored counter to the wonder marker on migration; unowned Panama counters do not contribute. Removing/disabling the owner makes the tokens inactive until it has an owner again.
- Keep undo/replay correct and preserve existing coin counters when a capacity falls; a player can lower a formerly valid counter.

**Out:**

- Bank per-building coins and Adam Smith, which need reliable building/city ownership and footprints (A3).
- Atomic Democracy/Printing Press purchases, which need turn/phase-use tracking (A4).
- Automatically awarding Education coins when a wonder is built; there is no explicit Build wonder action yet.

## Reference

- Issue #253 A1/A2 references the Education card and `TECH_TEXT`, `COIN_SOURCES`/`TECH_COIN_SOURCES`, `setCoinSource` and `coinSourcesOf`.
- Base rules and FAQ say coin tokens belong to the Panama Canal wonder and blockade makes them temporarily uncounted. The current code stores Panama's value in each player's `stats.coinSources` and only checks blockade, so it cannot safely follow wonder ownership.
- The current code/tests are the behaviour baseline. Current Panama blockade behavior and Internet capacity tests are in `packages/engine/test/coin-sources.test.ts` and `packages/engine/test/blockade.test.ts`.

## Approach

Add optional, backward-compatible coin-token data to wonder board pieces, migrate a legacy Panama balance into the currently owned wonder, and route Panama counter edits through that piece data. Add Education to the shared coin table and tech-source map. Factor active ownership/eligibility into an engine helper used by both the reducer and `StatusPanel`; determine active state from ownership and blockade, independently of display area. Derived player coin views and the UI should read the wonder-scoped balance only for its current active owner. Existing board snapshots should carry the field naturally so undo and replay restore it.

## Claimed paths

- `packages/engine/src/coins.ts`
- `packages/engine/src/actions/player.ts`
- `packages/engine/src/actions/board.ts`
- `packages/engine/src/board.ts`
- `packages/engine/src/state.ts`
- `packages/engine/src/migrate.ts`
- `packages/engine/test/coin-sources.test.ts`
- `packages/engine/test/blockade.test.ts`
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `docs/agents/decisions.md`

## Acceptance criteria

- [ ] Education is available only after reveal, starts at zero, is capped at 4 normally, permits up to 6 only while its owner has an active, unblocked Internet, and can still be lowered after losing capacity.
- [ ] Education is included in migration defaults and the coin total; removing the tech resets its counter.
- [ ] Internet capacity works in all supported board areas and is disabled by blockade or clearing/disabling ownership; UI and reducer agree.
- [ ] Panama tokens stay with the wonder across owner changes; only the active owner's total includes them. Blockade hides the contribution but preserves the token count.
- [ ] Existing games migrate the prior Panama counter from its current owner; undo/replay restores ownership and coin values consistently.
- [ ] Tests cover reveal/removal/migration, normal and Internet limits, area movement, blockade/unblock, disable/clear, reassignment, legacy values, and derived totals.
- [ ] Hidden information: Education's public counter stays unavailable while the tech is hidden; existing projection tests continue to pass.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser verified: coin row availability, capacity and Panama owner/disabled display.

## Open questions

None. Panama tokens are treated as belonging to the physical wonder, matching the rules' wording; for legacy data, the currently assigned owner's counter is the only unambiguous balance to migrate.
