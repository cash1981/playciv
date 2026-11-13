# Display settings with sliders

- **Slug:** `display-settings` · **Branch:** `feat/display-settings` (stacked on `feat/player-status-sidebar`, PR #343) · **Owner:** Claude (Sonnet 5.5) · **Status:** claimed

## Goal

The "nice to have" of issue #342: "a settings page where player can modify the
size of the icons, map etc similar to above. So instead of having the
pre-chosen zooms we could have a slider." Must be mobile friendly (the human's
words: "husk at det må være mobil vennlig").

## Scope

**In:** a Display settings panel opened from a gear button in the Board panel
header, with sliders for map zoom (plus an Auto switch), status icon size and
status panel width, a Reset button, live preview, per-browser persistence.
The Zoom dropdown in the Board header is replaced by this.

**Out:** server-side or per-account storage (settings are per browser/device, in
`localStorage`); changing piece sizes on the board itself.

## Reference

`BoardView.tsx` (`ZOOM_STEPS`, `zoomChoice`, `autoZoom`, `fittingBoardZoom`, the
Zoom `<select>`), `BoardView.test.tsx` (tests that drive `getByLabelText('Zoom')`),
`PlayerStatusSidebar.tsx/.css`, `CollapsiblePanel.tsx` (localStorage convention:
try/catch, `civ.` key prefix), `ReferenceDialog.tsx` (existing dialog pattern).

## Approach

- `packages/web/src/lib/displaySettings.ts`: pure helpers. Shape
  `{ mapZoom: number | 'auto'; iconScale: number; sidebarWidth: number }`,
  defaults `auto`, 1, 16.5 (rem). Ranges: map zoom 0.25-1.5 step 0.05,
  icon scale 0.7-1.5 step 0.05, sidebar width 14-24 rem step 0.5. `parse` validates
  and clamps stored JSON and falls back to defaults on any problem; `serialise`;
  tests for clamping, garbage input, missing storage.
- A small hook/context so BoardView and PlayerStatusSidebar read the same
  settings; storage key `civ.display`; every storage access in try/catch; the
  page must render correctly with storage blocked.
- `DisplaySettings` panel: native `<input type="range">` per setting with a visible
  label and live value readout, an Auto switch for map zoom (when on, the zoom
  slider is disabled and shows the computed auto value), Reset to defaults. Opened
  by a gear button (accessible name "Display settings") in the board header; closes
  with Escape, a Close button and outside tap; focus returns to the gear.
- Effects: map zoom replaces the dropdown (`zoom` in BoardView becomes the
  setting, auto still uses `fittingBoardZoom` but without being limited to the
  old steps' stairs only where the old tests require it); icon scale and sidebar
  width reach the sidebar through CSS custom properties (`--pss-scale`,
  `--pss-width`) so no layout code duplicates them.
- Mobile (verify at 375px): the panel is a bottom sheet / full-width dialog, slider
  rows at least 44px tall with a large thumb, no horizontal overflow; the sidebar
  width slider is hidden or disabled with a short note at 900px and below, where the
  sidebar is stacked and full width.
- Update the existing BoardView tests that used the Zoom select to the new slider
  without weakening them; add tests for the settings panel and the helpers.

## Claimed paths

- `packages/web/src/lib/displaySettings.ts` (+ test)
- `packages/web/src/views/DisplaySettings.tsx`, `.css`, `.test.tsx`
- `packages/web/src/views/BoardView.tsx`, `BoardView.test.tsx`
- `packages/web/src/views/PlayerStatusSidebar.tsx`, `.css`, `.test.tsx`
- `packages/web/src/views/GameView.tsx`, `packages/web/src/styles.css`

## Acceptance criteria

- [ ] Map zoom, icon size and sidebar width adjustable by slider; Auto zoom still works; Reset restores defaults
- [ ] Settings survive a reload; blocked storage does not break the page
- [ ] Mobile friendly at 375px and desktop; keyboard and screen-reader usable
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: no game data involved; settings never leave the browser
- [ ] Browser check: desktop and phone width

## Open questions

None blocking.
