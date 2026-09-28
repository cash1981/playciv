# Issue #191: wonders stay in the Wonders panel once moved onto the map

- **Slug:** `issue-191-wonders-stay-in-list`
- **Branch:** `feat/issue-191-wonders-stay-in-list`
- **Owner:** Claude (orchestrator, direct)
- **Status:** draft

## Goal

A wonder piece dragged out of the board's shared Wonders area (e.g. onto the
map) stays listed in the Wonders panel. It is removed from that list only
when the piece is deleted from the board entirely — via a Remove control
added to the panel itself, or the existing map-view Remove button.

## Why

Issue #191, filed directly by the human:

> The wonder in the wonder section disappears once you move it to the map.
> It should not. It should still be there.
> Only when removed entirely, or the remove button (implement if not there)
> the wonder should be removed the[sic] the section

## Scope

**In:**

- `WondersPanel.tsx`: stop gating the listed pieces on `isInWondersArea`
  (current geometric position); list every board piece with
  `category === 'wonder'` regardless of where it currently sits.
- `WondersPanel.tsx`: add a Remove control per wonder, calling the existing
  `api.removePiece(gameId, piece.id)` — the same action the map view's own
  Remove button already calls (`BoardView.tsx`), just reachable from this
  panel too.

**Out:**

- Any change to `removePiece`/`movePiece` in the engine
  (`packages/engine/src/actions/board.ts`) — both already exist and are
  already independent (`move` never deletes, `remove` deletes outright); this
  is a client-only panel fix.
- Any change to wonder ownership (`setWonderOwner`, issue #145) — ownership
  is already independent of a piece's `x`/`y`, so it needs no change to stay
  meaningful once a wonder can be shown while off the Wonders area.
- Reproducing the map view's other per-piece controls (rotate, to
  front/back) in this panel — only Remove is asked for.
- Making The Internet's raised coin caps (`setCoinSource`,
  `packages/engine/src/actions/player.ts`) or the Panama Canal coin row
  (`StatusPanel.tsx`'s `wonderOwners`) independent of `isInWondersArea` too.
  Round-1 review flagged that this panel showing a moved wonder's owner can
  now visually disagree with those two effects silently dropping at the same
  moment — a real, newly reachable inconsistency, but fixing it is an engine
  change out of scope for this client-only fix. Recorded as an accepted,
  documented consequence in `decisions.md` (2026-09-28), not resolved here.

## Reference

No old-system reference: old-civ-web has no client-side wonders panel at
all (wonders were dealt as hand cards, with no board to move them on), and
old-civ-rest's wonder handling is server-side draw logic only. The board and
this panel are both new-system (issue #109 board, issue #145 wonders-on-board,
issue #167 descriptions) — there is nothing to port here, only a gap in that
new design to close, per the human's direct report.

## Approach

- `WondersPanel.tsx`: change the `pieces` filter from
  `piece.category === 'wonder' && area !== undefined && isInWondersArea(view.board, piece)`
  to `piece.category === 'wonder'` — `view.board.pieces` already stops
  containing a piece the moment it is removed (`removePiece` filters it out
  of the array, per `packages/engine/src/actions/board.ts`), so "moved" and
  "removed" are already distinguished at the data level; the panel only
  needs to stop re-deriving "removed" from position. Drop the now-unused
  `area`/`WONDERS_AREA_ID`/`isInWondersArea` lookups if nothing else in the
  file needs them.
- Add a "Remove" button beside each wonder's Owner `<select>`, disabled when
  `busy || readOnly`, calling `run(() => api.removePiece(gameId, piece.id))`
  — mirroring `BoardView.tsx`'s existing map-view Remove button and its
  `danger` styling.

## Claimed paths

- `packages/web/src/views/WondersPanel.tsx`
- `packages/web/src/views/WondersPanel.test.tsx`

## Acceptance criteria

- [ ] A wonder piece moved out of the Wonders area (anywhere else on the
      board) still appears in the Wonders panel's list and count.
- [ ] Removing a wonder piece (from this panel's new Remove button, or the
      existing map-view Remove button) drops it from the Wonders panel's
      list and count.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: unchanged — the panel already reads public board
      pieces; nothing new is read or shown beyond what was already public.
- [ ] Verified in the browser: a wonder placed in the Wonders area, dragged
      onto the map, still shows in the panel; clicking the panel's Remove
      button removes it from both the panel and the map.

## Open questions

None that change the work materially.
