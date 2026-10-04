# Great persons and buildings are blockaded by enemy figures

- **Slug:** `great-person-disable`
- **Branch:** `fix/great-person-disable`
- **Owner:** Claude (orchestrator), coder role for the code
- **Status:** in review
- **Issue:** https://github.com/cash1981/playciv/issues/241

## Goal

When an enemy army or scout stands in the same square as a building or a Great
Person token on the map, that piece stops working for its owner, and the game
shows and counts it that way by itself:

- the piece is drawn as disabled on the board (greyed, struck through);
- a blockaded General or building no longer adds to the owner's combat bonus
  (a General is worth 4, so the bonus drops by 4);
- a Builder, Merchant or Humanitarian token placed in the outskirts of one of
  the owner's cities gives 1 coin, and gives it only while it is on the map and
  not blockaded (removed, killed or blockaded: the coin goes);
- the Great Person *card* in the owner's hand is shown as disabled (struck
  through, with a tag) when every token of that type the owner has on the map is
  blockaded.

## Why

Issue #241, "Great person / building fixes and improvement". The human wrote:

> Since enemy figure can stand on top of a greatperson, you have to "disable"
> one random one if you have two generals for instance. [...] If enemy figure
> (scout or army) stands on top of a greatperson, that greatperson is disabled.
> So if on a general, your combat bonus decreases with -4 combat bonus. The same
> goes if enemy figure stands on top of a building. That building is then
> disabled. [...] If Builder, merchant og humanitarian is chosen, we should be
> able to increase coin for owner automatically. Decrease automatically too if
> it is removed (killed)

Answers in chat (2026-10-04): the disabling is automatic when an enemy figure
moves on top; the card in the hand matters as much as the icon on the board;
combat -4 on the player's stats; "1 coin when the token is placed around one of
your cities, not when it is placed in your player area"; the rule is a base game
rule, nothing to do with the expansions; the owner of a piece is the owner of the
city it belongs to.

## Reference

This is the base game **blockade** rule, so it is a printed rule, not a new one.

- Base rulebook (`packages/web/public/help/civilization-rules.pdf`) p. 27: "A
  square in a city's outskirts that contains one or more enemy figures (either
  scouts or armies) does not generate production, trade, culture, coins, or
  resources for the city's owner. A square may be blockaded even if it contains a
  building or a great person." p. 18: great people are placed in the outskirts of
  the owner's cities and "have no effect when not on the map".
- Official FAQ 2.0 p. 2 and p. 5 (`Civilization FAQ_v2.0.pdf`): a blockading
  scout cannot send the combat bonus home; "If a great person token is
  blockaded, can the blockaded player use a great person's card ability of that
  type? It depends. If a player has at least one great person token matching the
  card's type that is not blockaded, the card ability can be used. If [not], the
  card ability cannot be used for as long as the token is blockaded."
- Consequence: the "disable one random General" button the issue first asked for
  is not needed. Which token is blockaded is a fact on the board, and the card is
  disabled only when *all* tokens of its type are. Do **not** add a random-disable
  action. The existing `discardRandomGreatPerson` (a General is killed) stays as
  it is.
- Existing code: `combat-bonus.ts` (issue #197, derives the combat bonus from the
  board, attributing buildings and generals by `placedBy`), `coins.ts` (the
  `greatPeople` counter is manual, max 1), `state.ts` (`withDerivedStats`,
  `opaque`, `toPlayerView`, `cityCountOf`, `cityColorOf`), `board.ts`
  (`squareOf`, `findPiece`, the `figure`, `city`, `building`, `greatperson`
  categories). Board pieces carry no owner or colour for buildings and great
  persons; figures and cities carry the colour in the asset id.
- Wonders are also blockaded (p. 27). Left out at first; the human asked for them
  afterwards, so they are in scope: see `decisions.md`, 2026-10-04.

## Scope

**In:**

1. A new engine module `packages/engine/src/blockade.ts`, pure and derived (no
   stored state, so undo, redo, time travel and old games work unchanged):
   - `pieceOwnerColor(...)`: the colour that owns a `building` or `greatperson`
     piece. The unique colour of the `city` pieces (capital, city, metropolis,
     walled or not; not `citystate`) in the same square or any of the 8 squares
     around it (the city's outskirts). If no such city, or cities of more than one
     colour, fall back to the colour of the `placedBy` player; if that is unknown
     too, the piece has no owner and is never blockaded and gives no coin.
   - `isBlockaded(...)`: the piece is on a map square (`squareOf` not `null`, so
     the player areas and culture track never count) and a `figure` piece (army
     or scout, any colour) of a different colour than the owner is in the same
     square. `figures/whitearmy` is the Russian player's extra army: treat it as
     that player's colour (find the Russia player; check how the civ is named in
     `gamedata`/`create-game`); if there is no Russia player, it counts as an
     enemy of everyone.
   - `blockadedPieceIds(...)`: ids of every blockaded `building` and `greatperson`
     piece on the board.
   - `blockadedGreatPersonTypes(...)`: for a player, the card `type` strings that
     have at least one token of the player's colour on the map and **all** of
     them blockaded. Token to card type: `great people/artist` = "Artist or
     Thinker", `builder` = "Builder or Inventor", `general` = "General",
     `humanitarian` = "Humanitarian", `merchant` = "Merchant or Explorer",
     `scientist` = "Scientist". A type with no token on the map is not listed
     (the human may not track tokens; "no token" must not look like "disabled").
   - `greatPersonCoinsOf(...)`: the number of `great people/builder`, `merchant`
     and `humanitarian` tokens owned by the player, standing in the outskirts of
     one of the player's cities (a token in a player area or off the map gives
     nothing), and not blockaded.
2. `combat-bonus.ts`: a blockaded piece adds nothing (barracks, shipyard,
   military dock, academy, general). Attribution stays by `placedBy` as today.
3. Coins: `coinSources.greatPeople` becomes derived, like the combat bonus. A
   helper (for example `coinSourcesOf(state, player)`) overrides `greatPeople`
   with `greatPersonCoinsOf`; use it everywhere the counters are read:
   `withDerivedStats`, `opaque` in `state.ts`, `culture-hand.ts` (Computers),
   `server/src/store/rating.ts`, and the Coins tab in
   `web/src/views/StatusPanel.tsx`. The row becomes read-only in the UI with a
   help text such as "Builder, Merchant and Humanitarian on the map in your
   cities' outskirts"; its `max` becomes `null`. `setCoinSource` must refuse the
   `greatPeople` key (use an existing error kind if one fits, otherwise a clear
   new one with its HTTP mapping). The stored value is ignored on read; do not
   write a migration.
4. `PlayerView`: add public `blockadedPieceIds: readonly string[]` (derived from
   the public board only) and, on `PlayerViewSelf` only, `blockadedGreatPersonTypes`.
5. Wonders (added at the human's request after the first review): a wonder marker on a
   map square is blockaded by an enemy figure in its square; owner = `ownerId`'s colour,
   else the city colour, else `placedBy`. Effects: Statue of Zeus (+6 combat), Cristo
   Redentor (+4 culture hand size) and the Panama Canal counter (shown as 0, stored value
   kept) stop while blockaded; the Coins tab tags the Panama cell. These three effects
   need an explicit `ownerId`.
6. Web:
   - `BoardView`: a blockaded piece is drawn greyed with a diagonal strike and a
     title/tooltip "Blockaded by an enemy figure". Keep it keyboard and screen
     reader friendly (an accessible label, not colour alone).
   - The hand: a `greatperson` card whose `type` is in `blockadedGreatPersonTypes`
     gets a "Blockaded" tag and struck-through text. Cards stay usable for
     discard, give and so on; this is a marker, not a lock.
   - Coins tab: the Great People row shows the derived number, no input.
7. `docs/agents/decisions.md` (append), `docs/agents/state.md`.

**Out:**

- A random-disable action or button (see Reference).
- Production, trade and culture of blockaded squares (the game does not compute
  those from the board), and a tag on the Wonders panel.
- Changing how `placedBy` is used for the combat bonus.
- A migration of the old manual `greatPeople` counters.

## Approach

Everything is a pure function of `GameState` (or of `Board` plus the player list),
placed in `blockade.ts` and exported from `index.ts`. The board model is
unchanged. `state.ts` calls it from `withDerivedStats`, `opaque` and
`toPlayerView`. Server needs only the projection change (and `rating.ts` using the
derived coins). Web reads `view.blockadedPieceIds` and
`view.you.blockadedGreatPersonTypes`.

## Claimed paths

- `packages/engine/src/blockade.ts` (new) and its test
- `packages/engine/src/combat-bonus.ts`
- `packages/engine/src/coins.ts`
- `packages/engine/src/state.ts` (`PlayerView`, `PlayerViewSelf`, the derived read)
- `packages/engine/src/culture-hand.ts`
- `packages/engine/src/actions/player.ts` (`setCoinSource` only)
- `packages/engine/src/errors.ts`, `packages/engine/src/index.ts`
- `packages/server/src/store/rating.ts`, and the server error mapping if a new
  error kind is added
- `packages/web/src/views/BoardView.tsx`, `GameView.tsx`, `StatusPanel.tsx`,
  `packages/web/src/styles.css` and their tests
- `docs/agents/decisions.md`, `docs/agents/state.md`, this brief

Shared resources: `packages/engine/src/state.ts` (`PlayerView` shape) is listed as
owned by `chat-orders`, which is merged and not on the live claims; take it.

## Acceptance criteria

- [ ] Engine tests for `blockade.ts`: enemy army and scout in the square
      blockade a building and a great person; own figure does not; a figure in
      the next square does not; a piece in a player area or off the map is never
      blockaded; two cities of different colours around a square fall back to
      `placedBy`; white army treated as Russia's; city-state pieces are not
      owners.
- [ ] Combat: a General (+4) and a Barracks (+2) stop counting while blockaded and
      count again when the figure leaves; with two generals and one blockaded the
      drop is 4. The battle summary uses the same number.
- [ ] Coins: a Merchant in the outskirts of an own city gives 1, in the player area
      gives 0, blockaded gives 0, removed gives 0; Builder and Humanitarian the
      same; two tokens give 2. `culture-hand` (Computers) and the rating use the
      derived value. A manual `setCoinSource('greatPeople', ...)` is refused.
- [ ] Cards: a type is listed only when it has tokens and all are blockaded; one
      free token keeps it out; no token at all keeps it out.
- [ ] Undo and redo of a figure move change the result back and forth (derived).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Wonders: an owned wonder on the map is blockaded by an enemy figure and not by its
      owner's own figure; one in the Wonders area or a player area never is; Zeus, Cristo Redentor and Panama Canal drop and return.
- [ ] Hidden information: `blockadedGreatPersonTypes` is derived from the public
      board and the viewer's colour only, never from the hand, and is absent from
      `opponents`. A test builds two players, one holding a General card and one
      not, with the same board, and asserts the opponent view is identical and
      contains no field that depends on the hand.
- [ ] Verified in the browser: a board with a General token and an enemy army on
      the same square shows the struck-through piece and the struck-through hand
      card, and the Coins tab shows the derived Great People number.

## Open questions

None open. Settled with the human in chat on 2026-10-04 (see Why). One choice made
by the orchestrator from the rulebook and FAQ: no random-disable button, because
the FAQ makes the card disabled only when every token of its type is blockaded.
