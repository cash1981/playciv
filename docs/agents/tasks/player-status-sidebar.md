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

## Icon decisions (made by the human; all files are in `packages/web/public/status-icons/`)

| Stat | Icon |
| --- | --- |
| Coins | `coins.png` |
| Trade | `trade.png` (the red/blue orb from the culture track) |
| Culture | `culture.png` |
| Culture hand size | `culture-hand-size.svg` (the "+1" medallion) |
| Government | `government.svg` (red wax seal) next to the government **text** |
| Infantry / Artillery / Mounted / Aircraft | `infantry.png`, `artillery.png`, `mounted.png`, `aircraft.png` (medallions from the unit cards) |
| Stacking | `stacking.png` |
| Movement | the player-colour army flag with three speed lines behind it. Draw it as an inline React SVG so the flag takes the player's colour (pole and outline `#1b1b1b`, speed lines `#6b7479`, flag path as in the player-colour examples: `M33 12c7-4 15-3 24 2l-3 9 3 9c-9-5-17-6-24-2z`, pole `M31.5 6v50`, viewBox 64x64) |
| Combat | an orange-red 12-point starburst with a cream circle and the **total combat bonus** as bold text inside, like the "+2"/"+4" badge on the Barracks/Academy icons. Inline React SVG, the number is the engine-calculated `stats.combat`, shown as `+N`; use a smaller font for three characters. Reference rendering: 128x128 viewBox, burst radii 62/44, inner circle r=34 |
| Combat hand size | `combat-hand-size.png` (free text such as `+1` or `5+2`, show it as text beside the icon) |
| EftA / PE / MIC / Infra | `efta.png`, `pe.png`, `mic.png`, `infra.png` |

Credits owed on the About page (free Magnific icons need attribution): Stacking
(Layer icon by riajulislam) and Combat hand size (Swords icon, Magnific). The
source and author of the EftA, PE, MIC and Infra icons are not yet known; ask
the human before the PR is opened.

Player colours are lower-case names (blue, green, purple, red, yellow, white):
use the same value the status table uses for its swatch.

## Open questions

Author and licence of the EftA, PE, MIC and Infra icons (for the credit line).
