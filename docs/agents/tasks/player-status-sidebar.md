# Player status sidebar

- **Slug:** `player-status-sidebar` · **Branch:** `feat/player-status-sidebar` · **Owner:** Claude (Sonnet 5.5) · **Status:** claimed

## Goal

Issue #342: a read-only player status view to the right of the map, in the
style of the Terraforming Mars player panel on Board Game Arena. "Start by
showing username - civ name (+ the civ marker icon from the culture track) -
government (text only). Keep the width manageable and mobile friendly."
Every value in today's Player status panel is shown with an icon whose
`alt`/`title` names it. The old Player status panel stays for now.

Icons: Coins, Trade, Culture, Culture hand size, Infantry, Artillery, Mounted,
Aircraft, Stacking, Movement, Combat, Combat hand size, EftA, Infra, MIC, PE.
Existing artwork is reused; the human picks from suggestions for the rest.

## Scope

**In:** read-only sidebar beside the map (stacked under it on narrow screens),
one block per player, icon set under `packages/web/public/`, tests.

**Out:** editing from the sidebar; removing the old panel; the "nice to have"
settings page with zoom/icon-size sliders (separate follow-up).

## Reference

- `StatusPanel.tsx` (columns, `Row` building from `view.you` / `view.opponents`)
- `leaderAssetId` in `packages/engine/src/board.ts` (civ marker by colour)
- `BoardView.tsx` `.board-layout` / `.board-scroll`

## Approach

New `PlayerStatusSidebar` component fed the same `PlayerView` data as
`StatusPanel` (no new server fields, so no new hidden information). Placed in
`.board-layout` as a flex row on wide screens and a stacked block on narrow ones.
A shared stat-icon map keeps icon, label and `alt` text in one place.

## Claimed paths

- `packages/web/src/views/PlayerStatusSidebar.tsx`, `.css`, `.test.tsx`
- `packages/web/src/views/BoardView.tsx`, `GameView.tsx`, `packages/web/src/styles.css`
- `packages/web/public/status-icons/`

## Acceptance criteria

- [ ] Every stat in the old panel is shown with an icon and accessible name
- [ ] Read-only: no inputs, no api calls
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: only fields already shown to opponents; a test checks that nothing beyond public stats and revealed civ/government appears
- [ ] Browser check: desktop and phone width

## Open questions

Icon choices for the ten missing icons (shown to the human as a picker).
