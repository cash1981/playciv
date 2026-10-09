# Assisted play: Great Person cards and their tokens

- **Slug:** `assisted-gp-tokens`
- **Branch:** `feat/assisted-gp-tokens`, branched from `feat/assisted-play-contract` (PR #271)
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in progress
- **Issue:** [#260](https://github.com/cash1981/playciv/issues/260), the Great Person part of [#252](https://github.com/cash1981/playciv/issues/252)

The human wants this work kept off `feat/assisted-play-contract` while they test
it: this branch is merged into that branch, and pushed there, only when the human
says it is ready.

## Goal

Gaining a Great Person is one flow: draw the card, take the matching marker, keep
the card secret, let the player put the marker on the map or leave it next to their
sheet (the rulebook calls that "reserve"). The culture advance onto a Great Person
space uses it, and a "Gain Great Person" button covers every other way of gaining
one (Philosophy, the Americans, and so on).

## Why

The human: "I neste fase ønsker jeg at du tar great person brikker ... Jeg tror det
at vi har det som nå at spilleren kan override tilfelle det er en bug eller så lenge
vi ikke har implementert alt. Det er utrolig mye regler, edge caser, wonders og great
persons ... Så all funksjonalitet må kunne overstyres."

So nothing manual may be taken away: dragging a marker, moving the culture marker,
editing culture and trade, the Draw button, discarding a card by hand all keep
working exactly as today. Assisted actions are added beside them.

## Reference (printed rules, read from the PDFs in `packages/web/public/help/`)

Fame and Fortune p. 11 to 12, "Gaining Great People":

- The player draws a card from the Great Person deck without showing it. The card
  names the person; the player takes the marker type that matches the card (artist,
  builder, general, humanitarian, scientist; the industrialist marker matches the
  "Great Merchant or Explorer" cards). The marker may be placed on the board or held
  in reserve; the card stays facedown and secret.
- If no marker of the drawn card's type is available, the card is discarded faceup
  and the player draws again until a type is available. If no marker of any type is
  available, the player receives no Great Person.
- The Greeks draw until they have two valid cards to choose between. The human
  adds: Organized Religion gives one more, and they stack (so up to three valid
  cards), and the player keeps one.
- A Great Person ability needs at least one marker of the card's type on the map.
  Reserve-only markers give nothing. (Not built here; the existing blockade code
  already reasons about markers on the map.)
- Killing a marker and the random discard of excess cards is not built here.

In the engine: marker artwork `great people/{artist,builder,general,humanitarian,
merchant,scientist}`, supply 3 each (`boardAssetLimit`, `remainingBoardAssetCount`),
the card `type` to marker table in `packages/engine/src/blockade.ts` (lines 39 to
44), the culture advance reward flow and `pendingRewards` in `assisted.ts`, and
owner by player area in the resource spending of the same file.

## Scope

**In:**

- A pure `gainGreatPerson` step used by both the culture advance (Great Person
  space) and a new registry action `gainGreatPerson` ("Gain Great Person",
  repeatable, any phase, vote undo). It draws until it has the needed number of
  valid cards (1, plus 1 for Organized Religion, plus 1 for the Greeks; the same
  counts as `rewardDrawCount`), where valid means the card's marker type has supply
  left. An invalid draw goes to the discard pile and a public line names it (the
  rulebook says faceup). If no valid card can be drawn, the player receives
  nothing and the public line says so; the culture advance still moves and is paid.
  Stop cleanly when the deck and discards are exhausted; no reshuffle loop.
- Keeping a card (at once when one valid card, or through the existing private
  `chooseReward`) takes the matching marker: a board piece of that marker is put in
  the player's own area, tidied into the next free slot, through the board history.
  The public line names the marker type, not the card ("took a scientist great
  person marker into reserve"). The card stays hidden in the hand.
- Undo by the existing vote reverses it: the marker piece leaves the board, the
  kept card and the rejected or discarded cards go back to the deck as the culture
  advance undo does, and a pending choice is dropped. It refuses, vote left open, if
  the marker piece has since moved out of the owner's area or left the board (the
  same rule as the culture advance marker).
- The board's own Undo must not undo the marker's placement by itself (same
  protection as the other assisted board changes).
- Hidden information: the card identity never reaches another viewer; the marker
  type does (it is a board piece). Rejected cards are public by the rulebook; the
  candidates of a pending choice are not. Tests at engine and server level.
- Web: the "Gain Great Person" button in "Your actions" with its reason, the same
  private choice UI as today (the "token step is still by hand" sentence goes away
  because the token is now taken), and the marker visible in the player's area.
- Manual paths stay untouched, with a test that proves it: a player can still draw a
  Great Person with the Draw button, move or remove the marker, and edit counters
  after the assisted flow.

**Out, and why:**

- Placing the marker on the map for the player (they drag it; a place button is a
  later step) and the ability eligibility from markers on the map (#252 slice B).
- Killing markers, the excess random discard, overbuilding (#252 slice B).
- Reconciling old games (the human wants manual correction instead).
- Map tile 16a, the Americans' and other free Great Persons as automatic triggers.

## Claimed paths

- `packages/engine/src/assisted.ts`, `culture-track.ts`, `state.ts`, `errors.ts`,
  `index.ts`, `actions/board.ts`
- `packages/engine/test/assisted-gp*.test.ts`, `packages/server/test/assisted-gp*.test.ts`
- `packages/server/src/routes/play.ts`
- `packages/web/src/views/AssistedActions.tsx` and tests
- `docs/agents/decisions.md`, `state.md`, `README.md`

## Acceptance criteria

- [ ] A Great Person space advance with a valid card gives the card (hidden) and a
      marker piece of the right type in the player's own area, with one public line
      naming the marker type and no card name.
- [ ] A card whose marker type is exhausted is discarded faceup (public line) and
      another is drawn; with every type exhausted nothing is received and the advance
      is still paid and moved.
- [ ] Greeks and Organized Religion give up to three valid cards to choose between;
      the choice is private and survives a refresh; keeping one takes its marker; the
      others are discarded.
- [ ] "Gain Great Person" does the same outside a culture advance, any phase, with
      idempotency by request id and a vote undo.
- [ ] Undo removes the marker, restores the cards, and refuses (vote open) when the
      marker was moved out of the owner's area.
- [ ] The board Undo cannot undo the marker placement alone.
- [ ] Hidden information: another player and a spectator never see the card identity
      or pending candidates; the marker type is public.
- [ ] Manual Draw, marker moves, counters and culture marker moves still work after.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (suites run one
      at a time).
- [ ] Verified in the browser: a Great Person space advance and the button.

## Open questions

- Where rejected and unchosen Great Person cards go: the rulebook says the bottom of
  the Great Person deck; the engine's discard pile is reshuffled into the deck when
  the deck runs out, which approximates it. Taken as acceptable, recorded in
  `decisions.md`.
