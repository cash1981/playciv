# Wonders on the board

## Why

Wonders are a first-class engine item kind, but they had no board presence:

- They were not in the piece palette, so a moderator could not put a wonder on
  the map.
- At game start the engine draws four ancient wonders (`drawStartingWonders`)
  straight into a player's **hand**. The owner asked for these to go onto the
  board instead, kept out of the hand, and recorded in the log.

The old system drew wonders on demand into the hand and rendered them as
text-only cards; it had no wonder art and no board. This is a deliberate
improvement over the old behaviour, agreed with the owner.

## What

1. **New `wonder` board-asset category.** Copy the 27 wonder images from
   `Civilization/Moderator/wonders` into `packages/web/public/board/wonders/`
   and add them to the manifest via `tools/board-assets.ps1`. The images are
   ~85 px and roughly square, so they need no scaling — they behave like any
   other one-square piece. Expose the category in the web palette.

2. **A shared "Wonders" area.** Add one extra area at the right of the
   player-area band, the same height as the player areas. The player areas
   shrink in width to make room. It is shared (not per player): every drawn or
   placed wonder lands here and tidies into the grid.

3. **Start-of-game wonders go to the board, not the hand.** `drawStartingWonders`
   (and the Egypt starting-units wonder) take the wonder off the deck, place it
   as a piece in the Wonders area, and write a public log line naming it. No
   wonder ever enters a hand, so nothing changes in the hand projection.

4. **Palette wonders are free-placement art**, like figures and cities:
   any wonder, any number, decoupled from the deck. This is only for the
   moderator to arrange the board; the "real" drawn wonders are the ones placed
   automatically at start.

## Out of scope

- The gift restriction (wonders/civ/units/greatperson/tiles cannot be given):
  already enforced server-side by `isTradable`; the UI change to hide the Give
  button is a **separate** follow-up branch.
- Per-owner colouring of wonder pieces. The log records who drew each wonder.

## Hidden information

Wonders on the board are public — that is the point of the change, and it is the
owner's explicit choice. Because wonders no longer enter any hand, the hand
projection is unchanged and there is nothing new to leak. A test asserts the
drawing player's hand holds no wonder and the board holds the wonder pieces.

## Done when

`pnpm -r typecheck && pnpm -r test && pnpm -r build` pass, the Wonders area
renders in the browser with the start wonders in it, and the change is through
the review gate.
