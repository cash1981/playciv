# One coin marker

- **Slug:** `coin-marker-cleanup`
- **Branch:** `feat/coin-marker-cleanup`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** draft

## Goal

From the player's side: the board palette offers a single coin marker, labelled
"Coin". The four extra coin variants — `Coin`, `Coin 2`, `Coin 3` and `Coin 4` —
are gone, both from the palette and from the artwork shipped to the browser.

## Why

The human asked for it directly, with a screenshot of the marker palette:

> Kan du fjerne Coin, coin 2 og coin 3 med bilder og alt. Er unødvendig. Så
> bytter du navn fra coin 1 til Coin.

Asked whether `Coin 4` should stay as well, the human answered:

> Fjern coin 4 også. Skal bare være en coin igjen.

So all four non-`coin1` variants go, and `coin1` loses its number and becomes
plain `Coin`.

## Scope

**In:**

- `tools/board-assets.ps1`: exclude `markers/coin`, `markers/coin2`,
  `markers/coin3` and `markers/coin4`; give `markers/coin1` the label `Coin`.
- Regenerate `packages/engine/data/board-assets.json` from the script, as the
  repo requires (it is a generated file).
- Delete the four artwork files under
  `packages/web/public/board/markers/`.
- Point the tests that used `markers/coin` as a stand-in marker at
  `markers/coin1`, which survives.

**Out:**

- Migrating or repairing games that already placed one of the removed markers:
  a placed piece stores its own `path`, so an old `markers/coin` (or coin2/3/4)
  piece keeps its position but its image 404s now that the PNG is gone. The
  human asked for the images to go "med bilder og alt", so this is accepted, not
  fixed. No migration is added.
- Any change to how markers are limited or counted: markers have no supply
  limit, so nothing else depends on these ids.
- The `Coins` column in the player status panel — that is the coin *stat*, not a
  board piece, and is untouched.

## Reference

No game rule is involved. This is palette/asset housekeeping, so there is
nothing in `old-civ-rest` or `old-civ-web` to match; the reference is the
board-asset generator itself.

## Approach

`board-assets.ps1` already has an `$exclude` list (used for the white army in
issue #26) and a per-piece label override (`$wonderLabels`). Extend the same two
mechanisms rather than hand-editing the generated JSON:

- Add the four coin sources to `$exclude`.
- Add a small `$labelOverrides` map keyed by `"<category>/<basename>"` and give
  `marker/coin1` the label `Coin`. This is more general than `$wonderLabels`,
  which is wonder-name shaping rather than a literal override.
- Re-run the generator with `-Source` pointing at the shared
  `Civilization/Moderator` folder (the worktree has no copy; it is gitignored)
  and confirm the only manifest change is the coin block.
- `git rm` the four now-unreferenced PNGs from `packages/web/public/board/markers/`.

The surviving marker keeps the id `markers/coin1`; only its label changes. The
id is not player-visible, and renaming it would add generator machinery for no
gain.

## Claimed paths

- `tools/board-assets.ps1`
- `packages/engine/data/board-assets.json`
- `packages/web/public/board/markers/coin.png`, `coin2.png`, `coin3.png`, `coin4.png`
  (deleted)
- `packages/engine/test/board.test.ts`
- `packages/engine/test/board-history.test.ts`
- `packages/server/test/board-api.test.ts`
- `docs/agents/tasks/coin-marker-cleanup.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] The manifest contains exactly one marker whose label is `Coin`, with id
      `markers/coin1`, and no `markers/coin`, `markers/coin2`, `markers/coin3` or
      `markers/coin4` entry.
- [ ] `packages/web/public/board/markers/` no longer contains `coin.png`,
      `coin2.png`, `coin3.png` or `coin4.png`.
- [ ] Regenerating from the script reproduces the committed manifest unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: no `PlayerView`/projection change, so no new leak
      surface; the existing privacy tests still pass.
- [ ] Verified in the browser: the palette shows one Coin marker and placing it
      works.

## Open questions

None — the only ambiguity (`Coin 4`) was resolved by the human before work
started.
