# Figure limits (#204) and header, chat and panel order (#206)

- **Slug:** `issue-204-206-figure-limits-and-header`
- **Branch:** `feat/issue-204-206-figure-limits-and-header`
- **Owner:** Claude (orchestrator), coder agent for the code
- **Status:** in progress

## Goal

Two small changes in one PR, both **mobile first**: it must look right and be
simple on a phone-width screen (375px) before anything else.

1. Each colour can only ever put 6 army figures and 2 scouts on the board.
   Russia additionally gets exactly one white army figure, and only the player
   who is Russia may place it.
2. Civilization, colour and player name are shown in that order: in the game
   header (for the player whose turn it is) and in the chat, where the
   nickname and civ are coloured. The "Turn orders" panel moves up to sit right
   after the Draw panel.

## Why

Issue #204: "All civs can only build a maximum of 6 army figures and 2 scouts.
Except Russia which when picked, will get a white army figure (you can find it
in moderator/figures/whitearmy.png folder). The figure can be placed in russia
player area." The human then clarified: exactly **1** extra white army, and
"Kun Russland skal få plassere de" (only Russia may place it).

Issue #206: "I would like 'Civ color playername' in that order ... and in chat.
You can color the nickname and civ in the chat box. The turn order box should
be the first after draw button, so move that up. Keep all other sortings."

Answers given by the human to the open questions:

- Header: the chips follow the **active player**, not the viewer, and come
  before the name: `[Greeks] [■ Green] s3s3's turn — start of turn phase`, the
  game name stays as small text after it.
- Chat: coloured name, civ as small text, one line per message header.
- Panel order: Draw, Turn orders, Log/Chat pair, then the rest as before.
- Limits: like buildings, a countdown in the palette, disabled at zero, and
  rejected by the engine.

## Scope

**In:**

- `boardAssetLimit` for `category === 'figure'`: `*army` is 6, `*scout` is 2,
  `figures/whitearmy` is 1. Counted per asset id, so per colour.
- `figures/whitearmy` added to the asset manifest and served from
  `packages/web/public/board/figures/whitearmy.png` (source:
  `Moderator/figures/whitearmy.png`, which is untracked, so copy the file into
  the public folder). Remove `figures/whitearmy` from `$exclude` in
  `tools/board-assets.ps1` so a regeneration keeps it. `pwsh` is not on this
  machine, so edit the JSON by hand with the same shape as the other figures
  (`width` 36, `height` 51) and say so in the commit message.
- Engine: `placePiece` rejects `figures/whitearmy` unless the placing player's
  `civilization?.name === 'Russians'`. New `EngineError` kind, message in
  `errors.ts`, HTTP 403 mapping in `packages/server/src/errors.ts` (or the
  status the neighbouring "not allowed" errors use).
- Palette: the white army is only listed for a viewer who is Russians. Other
  figures show the remaining count like buildings do.
- Header chips and chat as described above, mobile first.
- Move `TurnPanel` in `GameView.tsx` to directly after `DrawPanel`, before the
  Log/Chat `panel-pair`.

**Out:**

- Enforcing the limit on `movePiece` or `removePiece`: removing a piece frees
  the slot by itself, since the count is derived from the pieces on the board.
- Recolouring or making the white flag artwork transparent. The file is an
  opaque 36x51 RGB image (white flag on white); use it as delivered.
- Turn-order tabs inside the Turn orders panel: not asked for.
- Historical chat messages from a player who has withdrawn: shown as plain
  text without civ or colour if they cannot be matched by username.

## Reference

New feature; the old system had no board model (`board.ts` header says so), so
there is no old-civ-rest or old-civ-web behaviour to reproduce for the board
limits. The limit numbers come straight from the issue. Nothing here touches a
game rule or the deck, so `rules-checker` is not needed.

## Approach

- `packages/engine/src/board.ts`: extend `boardAssetLimit` and
  `remainingBoardAssetCount` (its `used` filter already matches on `assetId`
  for non-building categories).
- `packages/engine/src/actions/board.ts`: the Russia check in `placePiece`
  (not `placeUnchecked`, which engine-internal callers use).
- `packages/web/src/views/BoardView.tsx`: `BoardPalette` gets a
  `viewerIsRussia` style prop (name up to the coder) and filters the white
  army; `GameView.tsx` passes it from `displayedView.you?.civilization?.name`.
- Header in `GameView.tsx`: look up the active player among `you` and
  `opponents` by `activeTurn.username` (fall back to the opponent with
  `yourTurn`), then render chips before the `h1` text. Stack on narrow screens
  (flex-wrap; chips on their own line above the title is fine).
- Chat in `ChatPanel.tsx`: it needs a username to `{civilization, color}`
  lookup, passed as a prop from `GameView.tsx` (built from the view; no API or
  `PlayerView` shape change, so no shared-resource claim on those).
  Text colours must stay readable on the dark background (Blue and Purple in
  particular), so use a small CSS class per colour with tuned shades rather
  than the raw colour name.

## Claimed paths

- `packages/engine/src/board.ts`
- `packages/engine/src/actions/board.ts`
- `packages/engine/src/errors.ts`
- `packages/engine/data/board-assets.json` (shared resource)
- `packages/web/public/board/figures/whitearmy.png` (shared resource)
- `packages/engine/test/board.test.ts`, `packages/engine/test/board-*.test.ts`
- `packages/server/src/errors.ts`, `packages/server/test/board-api.test.ts`
- `packages/web/src/views/BoardView.tsx` (+ test), `GameView.tsx` (+ test),
  `ChatPanel.tsx` (+ test), the web stylesheet
- `tools/board-assets.ps1`
- `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md` if it lists
  board limits

## Acceptance criteria

- [ ] A colour cannot place a 7th army or a 3rd scout (`BOARD_ASSET_LIMIT_REACHED`).
      Removing one frees a slot. Two colours are counted separately.
- [ ] `figures/whitearmy`: limit 1; a non-Russian player is rejected, the
      Russian player is accepted once and refused a second time.
- [ ] Palette shows `(n)` remaining on figures, disables at zero, and lists the
      white army only for a Russian viewer.
- [ ] Header shows the active player's civ and colour before their name, and
      stays correct when it is not the viewer's turn.
- [ ] Chat shows civ (small), then coloured name, then message; unmatched
      usernames still render.
- [ ] "Turn orders" is directly after Draw.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
- [ ] Hidden information: nothing new is projected. Civilization is already
      public once revealed, colour is already public; a test shows an
      unrevealed civilization gives no chip and no chat civ text.
- [ ] Verified in the browser at 375px wide and at desktop width.

## Open questions

None outstanding; all five were answered by the human before starting.
