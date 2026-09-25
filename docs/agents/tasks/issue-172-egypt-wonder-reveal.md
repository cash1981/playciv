# Issue #172: Egypt's reveal draws its own wonder but suppresses the game's

- **Slug:** `issue-172-egypt-wonder-reveal`
- **Branch:** `feat/issue-172-egypt-wonder-reveal`
- **Owner:** Claude (orchestrator)
- **Status:** draft

## Goal

When Egypt is one of the revealed civilizations, the game still deals a full
start-of-game wonder set to the shared Wonders area once every player has
revealed their civilization — Egypt's own bonus wonder is no longer mistaken
for that deal. Egypt's own wonder goes straight into Egypt's own player area
on the board, not the shared Wonders area, and is credited to Egypt in the
public log.

## Why

Human bug report (issue #172): "When Egypt is revealed, they are supposed to
draw a wonder. The system draws a wonder, but forgets to draw 3 ancients and 1
more medieval wonder. The first wonder drawn should be marked for Egypt and
the logs should say so. Extra bonus if the first Egyptian wonder can be placed
in the players who owns it player area. The other 4 wonders should appear
where wonders normally appear in the game."

Clarified directly with the human before starting (five questions asked, since
no old-system reference covers a medieval wonder at setup at all):

- The total deal, once Egypt is in play: Egypt's own ancient wonder counts as
  the first of the set; the shared Wonders area still gets 3 more ancient
  wonders **and** 1 medieval wonder (so the shared area ends up with the same
  4-card count it would have anyway, just 3 ancient + 1 medieval instead of 4
  ancient, plus Egypt's separate one).
- Egypt's own wonder is placed directly in Egypt's own player area on the
  board, in this same fix (not deferred).
- Forward-only: no migration for existing saved games.
- The medieval-wonder rule has no old-system source; it is the human's own
  call for this repo, recorded here and in `decisions.md` as a deliberate
  deviation from `old-civ-rest`, not a guessed FFG rule.

## Scope

**In:**

- Egypt's own starting wonder (drawn during `drawStartingItems`) no longer
  sets `wondersDealt`, and is placed in Egypt's own player board area instead
  of the shared Wonders area.
- The start-of-game bulk deal (`drawStartingWonders`, fires once every seat is
  filled and every player has a civilization) draws 3 `ANCIENT_WONDERS` + 1
  `MEDIEVAL_WONDERS` into the shared Wonders area when Egypt is among the
  players, and the existing 4 `ANCIENT_WONDERS` otherwise.
- Public log lines: Egypt's own wonder is credited to Egypt (not "System"),
  worded like the existing per-player draw message; the bulk deal keeps its
  existing "System" wording.

**Out:**

- Migrating already-saved games — none are known to be stuck mid-setup with
  Egypt in play, and the human asked for forward-only.
- Any additional Egypt rule (e.g. an in-hand effect for the wonder) — out of
  scope for this bug, which is only about the missing draws and placement.

## Reference

`old-civ-rest/src/main/java/no/asgari/civilization/server/action/PlayerAction.java`:

- `drawStartingItems` (around line 372): Egypt draws one `ANCIENT_WONDERS`
  item alongside its starting units.
- `shouldDrawWonders` / `drawStartingWonders` (around lines 269-331): the bulk
  four-ancient-wonder deal, gated on every player having a civilization and no
  wonder existing anywhere yet.

Java's own check for "no wonder anywhere yet" already has the same bug this
issue reports — Egypt's private wonder counts against it, so the bulk deal
never fires when Egypt is in the game. This repo's engine ported that exactly
(see `decisions.md`, 2026-09-17, "shouldDrawWonders gates on wondersDealt ...
so Egypt still suppresses the bulk draw, as in Java"). There is no old-system
reference for drawing a medieval wonder at setup; that part is new, per the
human's direct answer above.

## Approach

`packages/engine/src/actions/draw.ts`:

- `drawWonderToBoard` gains a `destination: 'wonders' | 'own-area'` parameter
  (default `'wonders'`, so the manual draw route and the bulk system deal are
  unchanged). When `'own-area'`, the piece is placed in the calling player's
  own board area (via `playerAreas`/`areaSlotRegion`, the same helpers
  `wondersArea` already uses) and the log message reads "...placed it in
  `<username>`'s area" instead of "...placed it in the Wonders area".

`packages/engine/src/actions/player.ts`:

- `drawStartingItems`: Egypt's `ANCIENT_WONDERS` draw passes
  `destination: 'own-area'` and no longer sets `wondersDealt: true`.
- `drawStartingWonders`: checks whether any player's `civilization.name` is
  `'Egyptians'`. If so, draws 3 `ANCIENT_WONDERS` + 1 `MEDIEVAL_WONDERS` (all
  `destination: 'wonders'`, `actor: 'system'`); otherwise draws the existing 4
  `ANCIENT_WONDERS`. Still sets `wondersDealt: true` at the end either way —
  this function is now the only thing that sets the flag.
- `shouldDrawWonders` is unchanged in shape; its behaviour changes as a
  consequence of `wondersDealt` no longer being set early by Egypt's own draw.

## Claimed paths

- `packages/engine/src/actions/draw.ts`
- `packages/engine/src/actions/player.ts`
- `packages/engine/test/player-action.test.ts`
- `packages/engine/test/draw-action.test.ts`
- `docs/agents/decisions.md`
- `docs/agents/state.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] A game with Egypt among the revealed civs, once every seat's civ is
      revealed: Egypt's own hand/board has one `wonder` piece in Egypt's own
      player area, credited to Egypt in the public log; the shared Wonders
      area has 3 `ANCIENT_WONDERS` + 1 `MEDIEVAL_WONDERS`, credited to System.
- [ ] A game with no Egypt: unchanged — 4 `ANCIENT_WONDERS` in the shared
      Wonders area, credited to System, `wondersDealt` true.
- [ ] No wonder ever lands in a hand (existing invariant, still holds).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: unaffected — wonders are already public once drawn,
      on either the shared area or a player's own area.
- [ ] Verified in the browser if a session is available: Egypt's own wonder in
      its player area, the other 4 in the Wonders area, correct log lines.

## Open questions

None outstanding — resolved with the human before starting (see "Why").
