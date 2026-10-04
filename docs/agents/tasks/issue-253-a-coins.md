# Issue #253 A: finish coin sources and wonder eligibility

- **Slug:** `issue-253-a-coins`
- **Branch:** `feat/issue-253-a-coins`
- **Owner:** Codex
- **Status:** done

## Goal

Players can track eligible coin sources and complete low-cost coin bookkeeping without repeated arithmetic: Education, Internet and Panama Canal (A1/A2), derived Bank and Adam Smith coins (A3), and atomic Democracy/Printing Press coin purchases (A4).

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

**Still out of scope:**

- Automatically awarding Education coins when a wonder is built; there is no explicit Build wonder action yet.
- Terrain coin derivation, which needs structured terrain/scout data.

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

- [x] Education is available only after reveal, starts at zero, is capped at 4 normally, permits up to 6 only while its owner has an active, unblocked Internet, and can still be lowered after losing capacity.
- [x] Education is included in migration defaults and the coin total; removing the tech resets its counter.
- [x] Internet capacity works in all supported board areas and is disabled by blockade or clearing/disabling ownership; UI and reducer agree.
- [x] Panama tokens stay with the wonder across owner changes; only the active owner's total includes them. Blockade hides the contribution but preserves the token count.
- [x] Existing games migrate the prior Panama counter from its current owner; undo/replay restores ownership and coin values consistently.
- [x] Tests cover reveal/removal/migration, normal and Internet limits, area movement, blockade/unblock, disable/clear, reassignment, legacy values, and derived totals.
- [x] Hidden information: Education's public counter stays unavailable while the tech is hidden; owner and opponent projections both return zero.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass.
- [ ] Browser verified: no authenticated local game was available; StatusPanel behavior is covered by tests.

## Open questions

None. Panama tokens are treated as belonging to the physical wonder, matching the rules' wording; for legacy data, the currently assigned owner's counter is the only unambiguous balance to migrate.


## Follow-up scope: A3/A4

This continuation completes issue #253 A3 and A4 on top of A1/A2 in PR #254.

- Derive one coin per Bank only when its board location has a unique nearby city owner matching the player and the Bank is not blockaded. `placedBy` alone does not prove Bank ownership. Keep the existing Sheet row available for coin sources whose ownership/placement cannot be derived (including scout transfers and incomplete maps).
- Derive Adam Smith's separate +1 coin only while the Great Person card is revealed/in hand and its matching Merchant/Explorer type remains usable under the existing all-tokens-blockaded policy. Do not replace or merge this with Merchant token coins; hidden cards add no public coin.
- Add atomic Democracy tech and Printing Press coin purchase actions. Each checks a revealed matching tech, sufficient trade/culture, effective coin capacity (including Internet), and once-per-player-per-turn usage. Debit and coin grant commit together; a failed action changes neither.
- Reuse the saved player turn keyed by its turn number for usage markers. Do not infer timing from piece movement or card reveal. Preserve manual counter editing for correction; the new purchase action is restricted to the current City Management turn and its CM phase not being marked done.
- Cover actions through the engine, Hono routes and Coins UI. Keep payment/use details public, as these are shared status-board actions.


### A3/A4 acceptance

- [x] Bank coins are derived per unblocked Bank in the unique city footprint that owns it. Placement alone is not ownership. Existing Bank values survive as a compatibility floor; the Sheet source remains available for incomplete map/scout bookkeeping.
- [x] Adam Smith adds one separate derived coin while revealed, in hand, and usable under the existing Great Person blockade policy. The Merchant token coin remains separate. Hidden card names and values do not leak.
- [x] Democracy (6 trade) and Printing Press (5 culture) purchases debit and add a coin atomically during the player's open City Management phase, once per turn, with active Internet capacity and failed-action coverage.
- [x] Per-turn action use is stored in the migrated player turn and exposed as public bookkeeping; no separate clock or inferred timing is added.
- [x] Engine, server API and Coins panel tests cover purchases, capacity, hidden information, map ownership and blockade.
- The derived Bank owner uses the engine's existing eight-neighbor city footprint. Extra metropolis outskirts and scout-held squares are not inferred; use Sheet for those until the board model tracks them.
- Interactive browser verification remains unavailable without an authenticated local game; the panel behavior is covered by tests.
