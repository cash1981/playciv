# Coin source column shows the civilization, and gets vertical dividers

- **Slug:** `issue-173-coin-source-civ-name`
- **Branch:** `feat/issue-173-coin-source-civ-name`
- **Owner:** Claude (orchestrator)
- **Status:** in review

## Goal

In the Player status panel's Coins tab (`StatusPanel.tsx`'s `CoinSection`),
each player's column is headed by their civilization name once they have
chosen one, not their login nickname — matching how the Status tab's own
"Civilization" column already labels players. The Coins table also gets the
same vertical column dividers the Status table already draws between its
column groups, so a wide row of counters is readable at a glance.

## Why

GitHub issue #173 (human, with a screenshot of the Coins tab): "Coin source
should have civ name not nickname" plus "Can we also get vertical bars like
the status table has". The nickname is already shown elsewhere (the Status
tab's Player column); the Coins tab is the one place a civilization name would
actually help distinguish players, since its rows are keyed by coin source,
not by player identity.

## Scope

**In:**

- `CoinSection`'s `<th>` per player: prefer `row.civilizationName`, falling
  back to `row.username` when no civilization is chosen yet (a game in
  progress before every player has revealed one, or a spectator view of a
  game that never fills every seat) — an empty header would be worse than the
  nickname it replaces.
- A vertical divider between each player's column in the Coins table, reusing
  the Status table's existing divider treatment (`border-left` on
  `.status-group-start`). In the Status table that class marks the first
  column of *every* group, including the very first one (it divides
  Government from the first stat group too) — the Coins table follows the
  same rule: every player column gets the divider, including the first
  player's, which then divides it from the "Coin source" label column.

**Out:**

- The Status tab's own Player/Civilization columns — unchanged, they already
  show both.
- Any change to `PlayerView`, `CoinSourceKey` or engine data — this is
  presentation only in `StatusPanel.tsx`/`styles.css`.

## Reference

No old-system reference: the Coins tab (issue #158) and its player-column
header are original to this project, not a port of `old-civ-rest` or
`old-civ-web`. The Status table's existing divider CSS
(`packages/web/src/styles.css`, "Vertical dividers between section groups")
is the pattern to reuse, per the issue's own wording.

## Approach

`StatusPanel.tsx`: in `CoinSection`'s header row, render
`row.civilizationName ?? row.username` instead of `row.username`, keeping the
swatch. Reuse the existing `status-group-start` class on every per-player
`<th>` and `<td>` (header, body and the `tfoot` Total row), giving each player
column the same `border-left` divider the Status table already draws.

## Claimed paths

- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `packages/web/src/styles.css`

## Acceptance criteria

- [x] The Coins tab's player column headers show the civilization name once
      chosen, and the nickname when not.
- [x] Each player's column in the Coins table (header, body and Total row) has
      a visible left divider.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: no change — civilization name is already public
      (the Status tab shows it), so nothing new can leak.
- [x] Verified in the browser: the Coins tab in a game with at least two
      players, at least one with a chosen civilization, one without.

## Open questions

None — the issue's own wording plus the existing Status-tab pattern (public
civilization name, same divider CSS) cover the ambiguity.
