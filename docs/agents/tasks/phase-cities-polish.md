# Phase focus, shortcuts and the city count popup

- **Slug:** `phase-cities-polish`
- **Branch:** `fix/phase-waiting-cities-popup`, branched from `feat/assisted-play-contract`
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in review

The human asked for three changes to the game page. Web only; the engine and
the server are unchanged.

## 1. The player furthest behind is the one who is up

The title, the colour chips and the "Waiting for" line were built from the turn
holder and from every player not done, including players ahead of the viewer.
With admin on Movement and cash1981 on City management, cash1981 read "Waiting
for admin (movement)" although cash1981 held things up.

- `focusPlayer` (`packages/web/src/views/turnFocus.ts`): among `activeTurn.waitingFor`
  take the lowest phase in `TURN_PHASES`. A tie goes to the turn holder
  (`activeTurn.username`) when they are in it, else the first in the list. The
  viewer gets no preference, so nobody reads "Your turn" for everybody at the
  start of a round (the human's decision after review).
- `turnTitle(activeTurn, viewerUsername)`: `Turn N · Your turn — <phase> phase`
  when the focus is the viewer, else `Turn N · <name>'s turn — <phase> phase`,
  with the focus player's own phase. Everyone done and no active turn are unchanged.
- `StatusPanel` tags the same player with "turn".
- `activePlayerOf` (colour chips) finds the focus player's seat by username.
- `waitingText` uses `earliestOthers`: the other players at the earliest open
  phase, with that phase ("Waiting for admin (city management)", several as
  "bob, carol (trade)"). Empty when the viewer is alone at the earliest phase.
- `TurnStatusStrip` and `outOfTurnQuestion` are unchanged (the strip shows
  everyone, the question keeps the holder).

## 2. Fewer page shortcuts

Board, Your cards, Tech tree and Cities (`cities`, the `CollapsiblePanel` id). [Moved to Your actions, see decisions.md: the shortcuts are now Board, Actions, Your cards, Tech tree.]
Chat and History are removed for now; the `chat` prop is gone. `goToPanel` stays
exported for the card choice button.

## 3. City arithmetic in a popup

The `<details>` in each city card is gone. The figure line reads
`Estimated production: 7` followed by a link styled button "Not a complete
count"; a hand-set figure keeps its line and gets "How the estimate is counted".
Both open `ReferenceDialog` (class `city-count-dialog`, max width 28rem, scrolls
at 320 px) titled "<city>: how the estimate is counted", with the same content
as before. The dialog is a sibling of the figure paragraph (a div is not valid
in a p). The link has an aria-label "<link text>: <city label>". Opponents' cities get the link too. Focus returns to the link on close.

## Files

`turnFocus.ts` (new), `ChatOrdersPanel.tsx`, `GameView.tsx`, `PhaseSummary.tsx`,
`CitiesPanel.tsx`, `CitiesPanel.css` (now `CityCard.css`), their tests, `decisions.md`, `state.md`.

## Open questions for the human

- When the viewer is tied with another player at the earliest phase, the
  "Waiting for" line lists that other player. Only a viewer who is alone at the
  earliest phase gets an empty line.
- Several players at the same earliest phase are grouped: "bob, carol (trade)".

## Handover

Done in this branch: the three changes, tests and the decisions entry. Not done:
a screenshot check in a browser. The claim on `task-board.md` is released.
