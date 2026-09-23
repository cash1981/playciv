# Rating evidence from current game state

- **Slug:** `rating-current-state`
- **Branch:** `fix/rating-current-state`
- **Owner:** Codex
- **Status:** done

## Goal

For newly finished games, compare the players' actual culture marker positions and their coin totals from player status when ranking nonwinners for the rating result. Keep the one-time historical backfill's conservative card and printed-coin estimates unchanged.

Display the conservative rating as whole points on a 100-times scale, as requested after implementation began. Keep the underlying OpenSkill value and API/cache format unchanged; negative values are valid conservative estimates.

## Acceptance criteria

- A fresh game's culture evidence comes from each player's leader marker position on the board at finish, including START as position zero.
- Owned, drawn, or discarded culture cards do not affect fresh-game placement when the marker is elsewhere.
- Fresh-game coin evidence remains the sum of `stats.coinSources`, matching player status.
- Historical migration behavior and its imported results remain unchanged.
- Regression tests cover marker position taking precedence over cards and status coin totals.
- The highscore displays `26.62` as `2662` while retaining numeric sort order and the sign of negative ratings.
- `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, followed by a read-only review with no actionable findings.
