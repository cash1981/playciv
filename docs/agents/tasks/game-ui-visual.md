# Game UI — zoom panning and tech-tree layout

- **Slug:** `game-ui-visual`
- **Branch:** `feat/game-fixes`
- **Owner:** coder, orchestrated by Opus (browser verification by the orchestrator)
- **Status:** in progress

## Goal

Two visual fixes: (1) when the board is zoomed up it can be panned with
scrollbars instead of overflowing off-screen; (2) the tech-tree pyramid stays
inside its panel — its left edge reachable, not clipped, and not overlapping the
turn-orders panel.

## Why

- Task 3 (human): "When you zoom the map it goes out of view. If we keep the
  size and make it bigger, add sliders so you can drag the map up/down and side
  to side." (See the human's 100%-zoom screenshot.)
- ChatGPT #4: "The tech tree is not displaying correctly. It should float and
  show the entire view, not display over the turn orders." Terra confirmed a CSS
  risk: centred over-wide tech rows can make the left side unreachable
  (`styles.css` `.tech-pyramid` uses `align-items: center; overflow-x: auto`).

## What I traced

- `.board-scroll` (`styles.css:295`) is `flex: 1; overflow: auto` but has **no
  height bound**, and `.board-layout` is `align-items: flex-start`, so the frame
  grows vertically to full content height and pushes the page — no vertical
  scrollbar. `.board-frame` is sized `width*zoom+28 × height*zoom+28`
  (`BoardView.tsx:298`), so horizontal scroll already works inside the flexed
  width; only the vertical axis overflows the viewport. Default zoom is 0.4.
- `.tech-pyramid` (`styles.css:~593`) is a flex column, `align-items: center`,
  `overflow-x: auto`. A row wider than the column is centred, so its left end
  scrolls out of reach (you cannot scroll left past the centre). It lives in
  `.grid` (`grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`) beside
  the turn-orders and log panels.

## Scope

**In:**
- **Board panning:** give `.board-scroll` a bounded height so both scrollbars
  appear and the zoomed board can be panned in both axes without growing the
  page. A viewport-relative cap (e.g. `max-height: 80vh`) is fine; keep the
  existing `overflow: auto`. Confirm horizontal panning still works at high zoom.
- **Tech pyramid:** make the pyramid scroll from its left edge — the whole row,
  including its left end, must be reachable. Change `align-items: center` to
  left-alignment (`flex-start`) for the rows, or otherwise ensure overflow
  scrolls from the start, so no row is clipped. Keep the pyramid contained
  within its grid column so it never visually overlaps the turn-orders panel.
  The pyramid should still read as a pyramid (rows centred *relative to each
  other* is desirable, but not at the cost of clipping the left — prefer a
  layout that centres only when the content fits and left-aligns/scrolls when it
  does not).

**Out:**
- Collapsible panels (already done by Luna — `CollapsiblePanel`).
- Log timestamp format and sorting (already done).
- Any engine/server change. This is CSS/JSX only.
- Changing the default zoom level or adding separate slider widgets — scrollbars
  from `overflow: auto` are the "sliders" the human means (drag up/down, side to
  side). Only add a real slider control if scrollbars prove insufficient.

## Claimed paths

- `packages/web/src/styles.css`
- `packages/web/src/views/BoardView.tsx` (only if a wrapper/height is needed
  beyond CSS)
- `packages/web/src/views/TechPanel.tsx` / `TechTree.tsx` (only if the fix needs
  a class change, not just CSS)

## Acceptance criteria

- [ ] At high zoom (e.g. 100%), the board is contained in a scroll area with
      both horizontal and vertical scrollbars; scrolling reveals every edge of
      the board, and the page itself does not grow to the board's full height.
- [ ] The tech pyramid's leftmost slot in every row is reachable/visible (not
      clipped by centring), and the pyramid does not overlap the turn-orders
      panel at any column width.
- [ ] `pnpm -r typecheck && pnpm -r build` pass (no test suite for web; the
      orchestrator verifies rendering in the browser).

## Verification note

The orchestrator will verify both in the browser (DOM measurements via
`javascript_tool`, since screenshots can be blank when the pane is backgrounded):
board-scroll `scrollWidth`/`scrollHeight` exceed `clientWidth`/`clientHeight` at
high zoom, and each `.tech-pyramid-row`'s first `.tech-slot` has a non-negative
`getBoundingClientRect().left` within the scroll container.
