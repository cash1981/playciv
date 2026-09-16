# Issue #4 — leader markers start on START, and can be moved onto it

- **Slug:** `issue-4-markers-start`
- **Branch:** `fix/4-markers-start-on-start` (off `main`)
- **Owner:** coder, orchestrated by Opus
- **Status:** in progress
- **GitHub:** https://github.com/cash1981/playciv/issues/4

## Goal

When a player reveals a civilization, its leader marker is placed on the **START**
panel at the far left of the culture track (what the player calls "culture track
0"), not on space 1. A marker can also be dragged onto START and it snaps there.

## Why

Issue #4: the markers appear on the first grey space (culture 1) but should sit
on the START panel to its left, and there is currently no way to drop a marker
on START.

## What I traced (culture-track geometry)

`packages/engine/src/board.ts`:
- `CULTURE_SECTIONS` / `CULTURE_CELL_FRACTIONS` give the 27 grey spaces as
  fractions of the 3349-px track image width. `CULTURE_TRACK_CELLS === 27`.
- `cultureCellCenter(board, step)` maps a 1-based `step` (clamped 1..27) to a
  board pixel centre.
- `cultureStepOf(board, piece)` returns the nearest space 1..27, or null off the
  band.
- `cultureSlot(...)` snaps a dropped marker to the nearest space and lanes
  markers that share a space.
- `placeLeaderMarker` in `packages/engine/src/actions/player.ts` places the
  leader at `cultureCellCenter(board, 1)` — space 1. **This is the bug.**

I measured the START panel on `culture-track.png` (decoded the PNG, warmth of
the parchment end panel vs the grey spaces): the START panel is x 0..88 of 3349,
**centre fraction ≈ 0.0131**. (The Culture Victory panel at the other end is
fraction ≈ 0.9870 — that is issue #7, not this one; do not add it here.)

## Approach

Introduce START as **position 0**, keeping the grey spaces numbered 1..27 so
existing space numbering is unchanged. Build the position model so issue #7 can
append a VICTORY position later without reworking it:

1. Add `const CULTURE_START_FRACTION = 0.0131` (the measured START centre) with a
   comment noting it was measured off the artwork.
2. Build `CULTURE_POSITION_FRACTIONS = [CULTURE_START_FRACTION, ...CULTURE_CELL_FRACTIONS]`
   — index 0 = START, indices 1..27 = the spaces. Keep `CULTURE_TRACK_CELLS = 27`
   (the count of grey *spaces*); add a separate count for positions if useful.
3. `cultureCellCenter(board, step)`: clamp `step` to `0..CULTURE_POSITION_FRACTIONS.length-1`
   and index directly (no `-1`). So `cultureCellCenter(board, 0)` is START and
   `cultureCellCenter(board, 1)` is space 1 (unchanged pixel value).
4. `cultureStepOf(board, piece)`: search all of `CULTURE_POSITION_FRACTIONS` and
   return the index (0 for START, 1..27 for spaces). A marker on the START panel
   returns 0.
5. `cultureSlot(...)`: unchanged logic, but it now snaps to the nearest of the
   positions including START.
6. `placeLeaderMarker` (player.ts): place at `cultureCellCenter(board, 0)` (START)
   instead of 1. Keep the same lane-stepping for several leaders sharing START.
7. `locationOf` (board.ts): for culture position 0 return `culture START`
   (readable), and `culture <n>` for 1..27 as before.

Do **not** add the VICTORY (28) position — that is issue #7.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/src/actions/player.ts` (placeLeaderMarker only)
- `packages/engine/test/culture-track.test.ts`

## Acceptance criteria

- [ ] Revealing a civilization places its leader on START: `cultureStepOf(marker)
      === 0`, and the marker's centre is at `cultureCellCenter(board, 0)`.
- [ ] A marker dragged to the far-left START region snaps to START (step 0), and
      one dragged to a grey space still snaps to 1..27 as before.
- [ ] Space numbering is unchanged: `cultureStepOf` on space 1 is still 1, on
      space 27 still 27; `CULTURE_TRACK_CELLS` still 27.
- [ ] Several leaders revealing onto START are laned apart (different y), not
      stacked on top of each other.
- [ ] `locationOf` reports START readably (e.g. `culture START`) and a move log
      reads sensibly (e.g. "… moved Japanese (Red) from culture START to
      culture 9").
- [ ] Update `culture-track.test.ts` for the new START behaviour (the tests at
      the old "step 0 clamps to 1", "leader placed on step 1", and the
      "from culture 1" move description will change). Do not weaken tests — they
      should now assert START.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass. Report real output.

## Out of scope

- The Culture Victory position (#7).
- Any client change — the client already renders whatever pixel position the
  engine returns, and START is just another position. (The orchestrator will
  confirm in the browser.)
