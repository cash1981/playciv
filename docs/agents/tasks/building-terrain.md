# Warn when a building is placed on the wrong terrain

- **Slug:** `building-terrain`
- **Branch:** `feat/building-terrain`
- **Owner:** Claude (orchestrator), coder role for the code
- **Status:** in progress
- **Issue:** https://github.com/cash1981/playciv/issues/255

## Goal

When a player drops or moves a building onto a map square whose terrain the rulebook
does not allow for it, the board asks "Library should be on grassland, but this
square is forest. Place anyway?". OK places it, Cancel does not. Nothing is ever
refused by the server: it is a soft rule.

## Why

Issue #255: "Some buildings are not allowed to be built on different squares. For
instance only harbor, navy and military dock is allowed to be built on water;
library, university, granary and aqueduct only on grassland; trading post only on
desert; workshop and iron mine only on mountain. If someone builds any of these
buildings on anything other than these terrains, then give a warning, but allow
the player to do it if they press ok."

## Reference

- Base rulebook p. 16 (`packages/web/public/help/civilization-rules.pdf`), the
  "Buildings, terrains allowed" table: Harbor water; Trading Post desert;
  Workshop/Iron Mine mountain; Library/University and Granary/Aqueduct grassland;
  Market/Bank, Temple/Cathedral and Barracks/Academy "any terrain except water (one
  per city)". The issue adds Shipyard and Military Dock (the navy buildings) on
  water. The "one per city" part is out of scope.
- Terrain per square is not in any data today. It lives only in the tile images. The
  file `packages/engine/data/tile-terrain.json` (already written, 43 tiles) holds 4
  rows of 4 terrain names per tile, top row first, in the image's printed
  orientation. It was read from the images by colour and by eye, so a few squares
  are guesses; the human will correct them in the file. Do not edit its values.
- Board geometry (`packages/engine/src/board.ts`): `SQUARE_SIZE` 94, `TILE_SQUARES`
  4, a tile piece (category `tile` or `civtile`, asset ids `tiles/...`) is 376 x 376,
  `squareOf` finds the square a piece centre is in, `rotation` is clockwise degrees.
  Tile pieces lie under all other pieces. `tiles/tileback` has no data. The
  displayed square (row r, column c) of a tile turned clockwise by 90 degrees comes
  from original (3-c, r); 180: (3-r, 3-c); 270: (c, 3-r).
- Existing code to read: `packages/web/src/views/BoardView.tsx` (the place and move
  paths: drop, click to place, click to move, drag end, nudge with the keys, tidy
  into a slot), `packages/engine/src/actions/board.ts`.

## Scope

**In:**

1. `packages/engine/src/terrain.ts` (new), pure:
   - `TERRAINS`, `Terrain` type; `terrainAt(board, x, y)` returns the terrain of the
     map square under board point (x, y), or `null` (no tile under it, a tile with no
     data such as the tile back, or the point is not on the map). Uses the topmost tile
     piece containing the point and the rotation mapping above.
   - `BUILDING_TERRAIN`: asset id (`buildings/harbor` ...) to the allowed terrains
     (`water`; `desert`; `mountain`; `grassland`; "any but water" as the other
     terrains).
   - `terrainWarning(board, assetId, centreX, centreY)` returns `null` or
     `{ terrain, allowed, message }`; the message is a plain sentence such as
     "A Library is meant for grassland, but this square is forest." Unknown terrain or
     a building with no rule gives `null`.
   - Validation of the data file at import is not needed, but a test must check that
     every `tile`/`civtile` asset id except `tiles/tileback` has an entry of 4 x 4 valid
     terrain names, and that every id in the file is a real asset.
   - Export from `index.ts`.
2. Web, `BoardView.tsx`: before every API call that places or moves a `building`
   piece (all the paths listed above), compute the piece's centre and call
   `terrainWarning`; if non-null, `window.confirm(message + " Place it anyway?")`
   (or an accessible dialog if the code base already has a confirm dialog component,
   prefer that), and only call the API on OK. Moving a piece that stays on the same
   terrain, or onto an unknown one, must not prompt. Keep one small helper so the
   paths do not repeat the logic.
3. Tests: engine tests for `terrainAt` over all four rotations with a hand-made tile
   piece and the real data (pick a tile with an asymmetric pattern), for the rules
   table, for no tile / tile back / off the map; web tests that a mis-placed Library
   asks first, OK places, Cancel does not call the API, a Harbor on water does not
   ask, a Market on water asks.
4. `docs/agents/decisions.md` (append) and `state.md` are done by the orchestrator;
   do not edit them.

**Out:**

- Refusing the placement on the server, or any engine-side flag: the warning is
  client-side only so the API stays permissive.
- Great Persons and wonders (any terrain except water), and "one per city".
- Editing the terrain values (the human reviews them).

## Claimed paths

- `packages/engine/src/terrain.ts` (new), `packages/engine/src/index.ts`,
  `packages/engine/data/tile-terrain.json` (read only for the coder), tests under
  `packages/engine/test/`
- `packages/web/src/views/BoardView.tsx` and its tests

## Acceptance criteria

- [ ] `terrainAt` is right for all four rotations (test with a real tile).
- [ ] The rules table matches the Reference above; tests cover each group.
- [ ] A building dropped, clicked, dragged, nudged or tidied onto the wrong terrain
      asks first; OK places, Cancel does not; the right terrain never asks.
- [ ] Data file test: every tile asset has a 4 x 4 entry of valid terrain names.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: nothing new reaches a client that was not already public
      (the board is public); no change to any projection.
- [ ] Verified in the browser: a Library on a forest square shows the question.

## Open questions

The terrain values of a few squares are guesses (see the PR). The code does not
depend on them.
