# Replace the culture track artwork

- **Slug:** `culture-track-artwork`
- **Branch:** `feat/culture-track-artwork`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in review

## Goal

The board shows the correct culture track. The band above the map keeps the
height it has today and behaves exactly as before — leader markers are placed
and read back by the same rules — but the picture behind them is
`Civilization/Moderator/map/culturetrack.png` instead of the file under
`DoC/PBF Modding Material/`.

## Why

The human: *"Jeg har implementert feil culture track. Denne skal erstattes med
den som ligger i Civilization/map/culturetrack.png. Behold samme størrelse og
funksjonalitet som originalen."*

The current artwork is the wrong track. The new file is the track the human
wants, but it is a genuinely different track: it is narrower (2572 x 216 versus
3349 x 215) and it has **20 spaces** between Start and Culture Victory, not the
27 the current measurement assumes. The human chose, when asked:

- follow the new artwork, so **20 spaces** and the geometry measured off it;
- keep **today's band height**, so the board does not grow.

## Scope

**In:**

- Swap `packages/web/public/board/culture-track.png` for the new artwork.
- Point `tools/board-assets.ps1` at `map/culturetrack.png`.
- Update the manifest's `cultureTrack` size to the new file's real size
  (2572 x 216).
- Re-measure `CULTURE_SECTIONS`, `CULTURE_START_FRACTION` and
  `CULTURE_VICTORY_FRACTION` in `packages/engine/src/board.ts` for 20 spaces.
- Tune `CULTURE_TRACK_SCALE` so the band height stays at today's 164 px.
- Update the engine tests and the comments/docs that say "27 spaces".

**Out:**

- Any culture-track *rules*. The track stays a marker only; nothing enforces
  what advancing costs or what a culture event does. That is unchanged and out
  of scope — see `decisions.md`, 2026-09-15.
- The number of culture *cards* (`CULTURE_1/2/3` in `gamedata.test.ts`). Unrelated.

## Reference

Neither `old-civ-rest` nor `old-civ-web` has a culture track or leader markers,
so there is no old-system behaviour to port. The track is the human's design and
the human is the authority for it; they have answered the two questions above.

## Approach

`tools/board-assets.ps1` already copies the culture track on its own and records
its natural size, so only the source path changes. The artwork is copied at its
native 2572 x 216 — it is not resized — and the manifest records that size.

The band height is `boardWidth * height / width * CULTURE_TRACK_SCALE`. With the
new, less-wide artwork the natural aspect height is larger, so
`CULTURE_TRACK_SCALE` drops from 1.7 to **1.3** to keep the printed height at
164 px, the same as before. Nothing else in the board geometry changes.

The 20 spaces were measured off the artwork by finding the dark divider columns
between the tiles: three groups of 7, 7 and 6 spaces separated by the carved
pillars, with the first space measured on its own because the Start pillar sits
between it and the Start panel.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/data/board-assets.json`
- `packages/engine/test/culture-track.test.ts`
- `packages/engine/test/board.test.ts` (comment only)
- `packages/web/public/board/culture-track.png`
- `tools/board-assets.ps1`
- `docs/agents/tasks/culture-track-artwork.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] The culture track image served by the web app is the new artwork.
- [ ] `CULTURE_TRACK_CELLS` is 20 and markers placed on a space read that space
      back, including START and Culture Victory.
- [ ] The culture track band height is unchanged (164 px at board width 1504).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: no change to any projection; the track exposes no
      player data.
- [ ] Verified in the browser: the board renders the new track and a leader
      marker sits in the space it is dropped on.

## Open questions

None. Both material choices were put to the human and answered.
