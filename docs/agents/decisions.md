# Current decisions

Read only the relevant topic. This is current rationale and compatibility
context, not a complete rules specification. Code/tests and the relevant FFG
references take precedence over historical plans. Update superseded entries
in place; retain a short reason for meaningful behavior changes.

The former chronological log and task briefs are retrievable through
[the Git history guide](../history/README.md). It includes decisions that were
later reversed; never apply an old entry without checking the current code.

## Architecture and authority

The current implementation replaced the Java/Angular systems; they are useful
historical references, not the specification. Engine reducers are pure and
return errors as values. Hono runs on Node with JSON storage locally and on a
Cloudflare Worker with D1 in production. Render/Mongo hosting is retired.

Source: `packages/engine/src/`, `packages/server/src/app.ts`,
`packages/server/src/store/`, `packages/worker/src/`.

## Privacy, projections and logs

Only owners receive private hands, notes and logs. Opponents see counts and
revealed information. Great Person pyramid placement exposes an anonymous slot,
not the card name. Publicly derived coins/combat/culture limits use revealed
information even when viewed by the owner, so private research cannot leak
through a total. Undo descriptions must not reveal more than the original
public action. Log-number keys are independent of the public RNG stream.

Do not reconstruct historical revealed cards by matching display names to a
current hand: duplicate names and later redraws can reveal private cards.

Source: `state.ts`, `log.ts`, `coins.ts`, `combat-bonus.ts`, `culture-hand.ts`
under `packages/engine/src/`; privacy and projection tests under `test/`.

## Saves, migrations and revision chains

- Saves use compare-and-swap revisions. Private notes are omitted from replay
  snapshots; note writes may advance `rev` without adding a visible revision.
- Full keyframes bound delta chains. Unrecorded non-note changes seal the prior
  chain; compaction validates reconstruction, and cleanup retains a standalone
  final keyframe before removing older dependencies.
- `migrateGameState` must preserve an already-current state exactly, including
  JSON key order. Stored deltas depend on this invariant.
- Retain the historical board-change `clear` variant for replay/undo even
  though the clear-board action is removed.
- Retain `legacyOrdersCopied`, `legacyRevealsCopied` and classic load-time
  adoption. Removing the completed admin migration tool did not remove saved
  data compatibility. `yourTurn` still carries started-state compatibility.
- Do not rename already-applied duplicate-numbered `0004` SQL migrations.
  Deployment/cleanup procedures are documented in README's storage sections.

Source: `packages/engine/src/migrate.ts`, `packages/engine/src/board.ts`,
`packages/server/src/store/revision-chain.ts`, `packages/server/src/revision-delta.ts`,
`packages/server/test/revision-delta.test.ts` and Worker migrations.

## Timeline and turns

The chat/orders timeline is the only mode, for running and finished games.
The classic TurnPanel, mode switch, baton actions and admin migration UI are
removed. Turn state derives from phase completion and the start marker.
Out-of-turn draws require explicit confirmation. Posting the explanatory
order timeline row follows the authoritative game-state commit and can fail
independently; do not roll back or blindly repeat the committed action.

Layout: only the timeline is height-capped (the screen minus about 40rem for the
composer, between 8rem and 32rem); the thread and composer are not. When the
timeline and composer together are taller than the screen (Order mode adds the
Turn and Phase row, and the trade offer form is always there), the page grows.
A cap on the thread let the composer overflow under the next panel and hide End
turn and Send. The stylesheet test in `ChatOrdersPanel.test.tsx` guards this;
retune the 40rem if the composer changes size.

Source: `packages/engine/src/turn.ts`, `packages/server/src/routes/play.ts`,
`packages/web/src/views/ChatOrdersPanel.tsx`, `ChatOrdersPanel.css`.

## Board and manual bookkeeping

New-game board geometry is defined here, not by the old Google Presentation:
two-player boards are 16×8, three-player boards form a pyramid, and five-player
boards use a holed 28×18 layout. Pre-shape three-player saves with pieces and
five-player saves retain their old rectangle to avoid moving existing pieces;
see [legacy layout limitations](limitations.md#game-behavior). The culture track has 20 positions and freely placed
markers. Board undo targets the caller's latest consecutive actions; a new
board action clears redo. Undoing board edits does not undo game actions.

Each colour has six armies and two scouts. Russia gets one extra white army and
Spain one extra white scout (`whiteFigureFor` in `board.ts`), a supply of one
each. Revealing the civ puts that figure in the player's own area, so the
palette shows 0 left; removing it from the board makes it 1 again, and only a
player of that civ is offered it and may place it (`BOARD_ASSET_CIV_ONLY`).
Undoing the reveal takes it back. In the blockade and City-state 4 rules a white
figure counts as its civ's colour. Players who revealed Russia before this
change get no automatic army and place it from the palette. The white scout art
is made from the red scout by `tools/board-assets.ps1`, which also adds its
manifest entry. The Spanish card says
only "start with 2 scouts"; one extra scout follows the owner's request and the
issue #204 precedent for Russia, not a rulebook reading. Tests: `white-figures.test.ts`,
`undo-civ-reveal.test.ts`.

Terrain checks are advisory client warnings, not server placement restrictions.
Player status has an Aircraft checkbox under Units (`stats.aircraft`, default
false) meaning the player has unlocked Aircraft units. Revealing the Flight tech
for the first time ticks it; anyone can still tick or untick it by hand, and it
is neither cleared when Flight is removed nor enforced when drawing Aircraft.

Government selection and tech-pyramid placement remain permissive bookkeeping
unless a specific effect is explicitly automated. Generated data should be
changed through its generator/source process, not patched to encode a rule.
The Military Tradition/Pacifism pairing is corrected by parsing and migration.

The owner deliberately chose to commit FFG piece/card artwork to this public
repository, acknowledging that this redistributes copyrighted artwork. Deleting
files would not remove earlier published copies from Git history; reconsidering
that choice requires a separate, explicitly authorized history-cleanup decision.

Source: `packages/engine/src/board.ts`, `packages/engine/src/actions/board.ts`,
`packages/engine/src/terrain.ts`, `packages/engine/src/actions/player.ts`.

## Coins, wonders and blockade

Wonder ownership/bonuses do not depend on the piece staying in the shared
Wonders area. Disabling a wonder clears its ownership while leaving its board
piece. Panama's coins belong to the physical wonder and count for its active,
unblockaded owner. Bank/Great Person/Adam Smith effects derive from board
ownership and revealed cards; `placedBy` is not city ownership. Metropolis
outskirts include ten squares around two centers, excluding both centers.

A Great Person with no tracked matching token is not assumed blockaded, for
compatibility with existing games. Public totals never include hidden bonuses.
Scout-transfer corrections remain manual; see [limitations](limitations.md).
The palette uses a single `coin1` marker named Coin.

City-state 4 (`city-states/cs4`, "1 Culture & +2 Combat bonus") adds +2 to the
derived combat bonus of the player whose army or scout stood in its square
first, once however many figures stand there; the white army and white scout count
for the Russian and Spanish player. Holding the card is not required. A figure of another colour
that arrives later (a battle) does not get it. It passes on only when the
holder has no figure left there (killed or moved away), to the colour that has
stood there longest; it is not regained by coming back. "First" is found by
replaying `board.history` (`cityStateHolderColour`), because the stacking order
changes with bring to front; nothing is stored, and undo follows. The +1
culture half is not derived. Test: `combat-bonus.test.ts`.

Source: `packages/engine/src/coins.ts`, `packages/engine/src/blockade.ts`,
`packages/engine/src/combat-bonus.ts` and related tests.

## Arena and card handling

Arena turn indicators are advisory. Participation and edits have their own
permissions; do not turn indicators into new enforcement rules. Kills are
reversible flags, not automatic discards. Reinforced-away cards stay locked
until battle end. Loot remains manual. Gifting is restricted to tradable cards;
Great Persons/civilizations are not freely giftable. Owners can explicitly
discard a Great Person from hand or revealed cards, with public/private log
wording appropriate to what was already visible.

Standalone barbarian drawing is supported; initiation reuses the prepared hand
or draws automatically. Only the player who ended the battle may undo End
battle, until another battle begins. Undo restores battle state; the projection
exposes only `battleUndo.endedBy`, never the stored private unit identities.

An undo vote on a civilization's REVEAL entry takes back everything the reveal
handed out by itself, recorded on that entry as `GameLogEntry.civSetup`: the
starting units and Egypt's own wonder go back into the deck (the deck is
reshuffled), the other civ cards return to the hand, and the starting tile,
leader marker, starting tech and government are removed. Anything the player
drew or chose themselves stays in the hand. The start-of-game wonder deal only
holds while every seat has a civilization, so it is taken back too, whichever
reveal triggered it, and the next reveal that completes the table deals it
again. The board pieces are removed as history entries by the System, so the
owner's board Undo cannot bring back a piece whose card is already in the deck,
and the starting tech's and Democracy's coin counters are cleared. A reveal made
before `civSetup` existed is rebuilt from the log (the starting-unit draws and
civ discards right after the REVEAL line) and the board (the civ's tile and
leader asset). It is refused (`CIV_REVEAL_NOT_UNDOABLE`, and the private log
offers no undo) for Egypt and once the shared wonders are dealt, because those
wonders cannot be tied to a reveal. Before, such an undo only moved the civ
card into the deck and left the civilization set.
Taking back a reveal also sets `board.undoFloor` to the current history length
and clears Redo, so board Undo cannot revert anything made before it, such as a
piece the owner removed by hand, while its card is in the deck.
A vote that has run cannot be voted on again (`UNDO_ALREADY_DONE`), the starting
tech goes by the civ's own tech id so a copy the player chose again stays, and
returned units are no longer flagged in battle.
`civSetup` is server-side like `item`: opponents get the public log form only.
Tests: `packages/engine/test/undo-civ-reveal.test.ts`.

Source: `packages/engine/src/actions/arena.ts`, `actions/player.ts`,
`actions/undo.ts`, `state.ts` and arena tests. The earlier auto-discard and automatic-only barbarian plans
are superseded.

## Assisted play

Issue #260 and PR #271. Cards, culture advances and Great Person markers are
used through buttons that call one contract, `performAssistedAction` in
`engine/src/assisted.ts` (`POST /api/games/:gameId/actions` with `requestId` and
`rev`). Every manual path stays: dragging pieces, editing counters, the Draw
buttons and the culture marker. Assisted actions are added beside them.

- Each card is used once per turn (`PlayerTurn.usedActions`). A second use asks
  first and, once confirmed (`confirmedRepeat`), is allowed because Great Persons
  and culture cards can grant another use. Only the `used` refusal is lifted.
- A resource is paid by an unspent hut item of that name first, else a
  `resources/<name>` piece inside the player's own area, which goes back to stock.
  This holds for every resource kind.
- Undo is today's vote, extended to assisted log lines (`assistedActionId`). A
  reversal writes a new "System:" line and refuses, vote left open, when a marker
  moved or a card is gone. Board Undo refuses assisted board changes.
- Culture advance (`culture-track.ts`): 21 spaces, levels 1 to 3 of seven spaces,
  Great Person on 3, 7, 12 and 18, space 21 is Culture Victory and only logs.
  Cost 3 culture (level 1), 5 culture and 3 trade (level 2), 7 culture and 6 trade
  (level 3). Economic Foundations (`stats.efta`) lowers the culture cost by 1 at 2
  investments and 2 at 4; Ecology lowers trade by 1 per 3 coins. Phase: City
  Management. Event spaces draw 1 card (2 with Mysticism); Great Person spaces
  draw 1 plus 1 for Organized Religion plus 1 for the Greeks. The player keeps
  one in a private `pendingRewards` choice.
- Culture hand limit (#248): a hand with more culture cards than `cultureHandSizeOf`
  takes no culture card by a culture event advance (the button is unavailable with the
  reason) or a gift (`tradeToPlayer`, error `CULTURE_HAND_OVER`, 409) until it has
  discarded down or raised its size. A Draw of a culture deck asks first, like a used
  card or an out of turn draw: the client confirms, then sends `confirmedOverLimit`, and
  the server refuses a culture draw without it (409). A hand exactly at its size may take
  one more and sit one over while the player decides what to discard; the advance then
  warns (`warning` on the viewer's own `availableActions` entry) and Your hand shows a
  notice while over. Great Person spaces give a marker, not a culture card, so they are
  never blocked. Trade offers record an agreement only and are not checked.
- Drawing a culture deck whose level differs from the level of the space the leader
  marker stands on (Start counts as level I here, spaces 1 to 7 are I, 8 to 14 II, 15 to 21
  III; Patronage is stricter, see part 13) asks "Are you sure?" first. Client-side only, no server flag: the Draw button is a
  manual path. Moving the leader marker by hand charges and awards nothing.
  The card count includes every culture card in the hand, revealed or not, and the size
  counts only revealed cards, so an unrevealed Pottery or Valmiki can block early.
  Tests `assisted-culture-hand-limit.test.ts`, `GameView.test.tsx`, `chat-orders.test.ts`.
- A Great Person card is valid only when its marker type has supply (3 per
  type). Invalid draws are discarded faceup. With no marker of any type left,
  nothing is drawn. The kept card stays hidden in the hand and the marker piece
  goes into the owner's area.
- The game page shows a phase summary and shortcuts, and the order is board,
  Your actions, Your cards, then the rest (Your actions sat above the board for a
  while; the human moved it right under it, before Your hand). The piece palette sits below the board at every
  width; this is unconfirmed by the human and reversible in `styles.css`.
- The header shows the player furthest behind as the one who is up
  (`web/src/views/turnFocus.ts`): the title, the colour chips, the "turn" tag in
  Player status and "Waiting for" read the lowest phase in `activeTurn.waitingFor`,
  so a player who is ahead is never named as the one everyone waits for. In a tie
  the turn holder wins when they are in it, else the first in the list; the viewer
  gets no preference, so the title does not read "Your turn" for everybody at the
  start of a round. "Waiting for" lists the other players at the earliest open
  phase, so a viewer tied with others still sees them, and is empty when the viewer
  is alone there. The engine's turn holder is unchanged: the lobby row (the
  server's `nameOfUsersTurn`) and the out of turn question before a Draw still use
  it, on purpose. The status strip shows everyone.
- The page shortcuts are Board, Actions, Your cards and Tech tree. Actions is shown
  only when the Your actions panel is on the page (`hasActionsPanel`), so a spectator
  and a player with nothing in the panel get no dead button. Actions, and the "card
  choice waiting" button, open Your actions when a saved collapsed state hides it,
  and that open state is remembered like a manual click; the other shortcuts land
  on the heading of a collapsed panel without opening it. Chat and History are
  removed for now, on purpose; the chat and the log are still on the page.
- The viewer's city cards and the city actions (Upgrades, Build, Start Building
  Program, the production figure with its popup, and the field to set production by
  hand) live in "Your actions", in a section "Your cities" below the action list and
  a waiting card choice (task `cities-in-actions`). The human could not find them in
  the collapsed Cities panel at the bottom of the page. The panel is shown for a
  player who has a city on the map even when no card action and no choice is
  waiting; it never shows for a spectator, and it is not shown only to say "No
  cities of yours on the map yet." The Cities panel for the other players' cities
  was removed later (task `build-polish-wonders`): the human saw no use in it, and
  the board shows every city. The projection still carries the opponents' `cities`;
  nothing reads it on the page. The Build picker is inline in Your actions, so "Back
  to the picker" reopens that panel.
- **End turn** is a button at the top of "Your actions" (task `end-turn-actions`,
  `EndTurn.tsx`), the first Order tab control to move over: the human wants to
  migrate to an action panel step by step. It ends one phase, not the whole turn:
  it marks the viewer's earliest open phase in the active turn done, the same
  request as the Order tab button, and the turn and the phase go in the request. The
  other players then carry on in that phase, and ending Research for everybody
  starts the next turn, as before. The label stays "End turn" (aria-label "End turn:
  mark City management as done"), with a line saying which phase it marks, and on
  Research that the next turn starts when every player has ended it. Once the viewer
  has no open phase the button gives way to "You have ended turn N. Waiting for ...".
  A player in a running game now always has the panel, so it is shown even with no
  card action, choice or city; not for a spectator, before the game starts or after
  it ends. A player with no city yet therefore sees End turn above the tabs, and in the
  City Management tab "Your cities: No cities of yours on the map yet." (the line the
  cities task allowed "when the panel is shown for another reason"). After the last press the button gives way to a line
  that takes focus, but only if focus was lost, so a refresh from another device does
  not steal it. The Order tab keeps its End turn and "Not done" button for now; there is
  no undo in the panel yet, and it does not work ahead into the next turn the way the
  Order tab's Turn picker does.

### Phase tabs and Start of Turn (part 13, 2026-10-23)

The "Your actions" panel has one tab per phase (Start of Turn, Trade, City
Management, Movement, Research); the viewer's open phase is selected first and
any tab can be opened. Every action built before part 13 is under City Management.
Each action declares its `phase` and `group` in the registry, and a button shows
its `status` and `reason`; `not-owned` ones are hidden. Rules read from the base
rulebook p. 12 to 14 and 26 to 27, W&W p. 9 to 10, F&F p. 8 to 13, FAQ 2.0 and
the card sheets; the full list is in `tasks/assisted-sot.md`.

- **Playing a card is a log line.** A culture event or Great Person card that
  names a timing in its own text ("Start of Turn:", "Any Time:", "A / B") is
  listed in that phase, and "Any Time" cards in every tab. Play takes the card
  out of the hand (discard pile, or faceup in place for a Great Person without
  "discard this card"), and writes who played what and who it names. The effect
  is never applied: other players can cancel it and most effects need a choice on
  the map (the human). A Great Person whose figures are all blockaded cannot be
  played. The same cards can be played in their own phase (City Management,
  Movement, Research) by the same flow; that was not asked for and costs nothing.
- **Start of Turn gate.** Everything here needs Start of Turn to be the player's
  open phase, and a usage key once per turn (a confirmed repeat is allowed where a
  card can grant another use). Changing government and investing a coin are
  `strictOnce`: nothing grants a second one.
- **Social policies** (Anarchy switches them off): Expansionism 1 trade per city
  plus 1 per city-state with a figure of the player on it; Pacifism 1 culture, 2
  with a scout on the map; Patronage spends 1 culture and draws a culture event of
  the level the marker stands in and keeps one (with Mysticism it draws two and keeps
  one). It does not work until the marker has advanced once: the start space has no
  level (the human, 2026-10-23);
  Rationalism spends 6 or 11 trade for a level I or II tech and records a
  `TechGrant` that the tech panel spends when the tech is revealed in Start of Turn.
  Learning is not researching: no coins keep trade.
- **Government.** One change per Start of Turn. A government whose tech was revealed
  last turn or this Start of Turn (`techRevealTurns`) can be taken directly; any other
  change goes through Anarchy, and from Anarchy any known government is direct. The
  Pyramids and Dr. Martin Luther King avoid Anarchy. Democracy +2 trade, Fundamentalism
  1 culture per army on the map, Feudalism puts a harvested resource in the player's
  area. Which resources a city's outskirts hold is read from the tile data
  (`tile-icons.json`, the same list the city's Harvest button uses), so the player picks
  from what the map shows; a scout's square is not part of the outskirts.
- **Invest** (F&F p. 13): one coin per turn, only coin tokens (the sheet and the tech
  cards that hold tokens), never printed coins and never the coins on a wonder. The
  Arabs advance one space for free with it, a Public Education threshold gives a free
  tech grant.
- **Cities and scouts.** A scout (an army under the Republic) founds a city: at most 2
  cities, 3 with Irrigation; not on water; all eight neighbours revealed; no hut or
  village next to it (the Zulu may, and then explore the hut); no enemy figure next to
  it; no city closer than three squares, diagonals included (outskirts must not overlap, anyone's); no relic next to
  it; a city-state on the square is destroyed for 3 culture, a city-state next to it
  forbids it. The Romans advance one space for free. A scout sends its square to one
  city for the turn, and **to the capital when it is not sent** (the human, 2026-10-23):
  the square counts for that city's production, and its culture and resource icons are
  offered to that city's Devote to the Arts and Harvest only; the trade and coin icons stay
  manual. The square leaves the city it lies in when the scout goes to another one, in the
  production and in the gathering alike, also by the default (a scout in a non-capital
  city's outskirts goes to the capital unless it is sent to that city). A capital that grew
  into a metropolis has no capital marker: a scout that was not sent then goes nowhere and is
  offered to every city, with a note saying so. An English army is only ever sent by hand.
  Growing a capital into a metropolis only scrolls to the map.
- **Wonders, Great Persons, techs, huts and relics** (`assisted-abilities.ts`, kinds
  `sot:<ability>`): Stonehenge, The Colossus, The Louvre, Lorenzo de' Medici (1 culture
  per 3 coins) and Alan Turing (1 trade and 1 culture per 2 armies still in the supply)
  add their numbers; Sydney Opera House advances for free; Panama Canal adds a coin to
  the wonder (it counts as a coin and cannot be invested); Cristo Redentor draws two events of a chosen level (every culture event
  draw has Mysticism's extra card, so with it each of the two draws is a pick of one from
  two, and both picks wait as card choices); Statue of Liberty, the Teacher hut and
  Atlantis grant a free tech and the page goes to the tech tree for the player to choose
  and reveal it; the Seven Cities of Gold ask which investment card gets 2 markers and
  put them there without a coin (no free advance for the Arabs). A relic marker is taken
  in Movement; its ability is claimed in a Start of Turn by the player whose board
  history removed the marker, once per game, and a claimed relic is `unavailable`, not
  `used`, so no button offers a second use. The rest (Great Wall,
  Hanging Gardens, Taj Mahal, Big Ben, Machu Picchu after an invested coin, Plastics, and
  Ecology, which spends a Wheat) only log, once per turn: the choice is on the map. The
  other Great Person cards with a Start of Turn text (Henson, Mother Teresa, Giannini,
  Edison, Wright, Cousteau) go through the generic card play.
- **Undo.** Every action has a vote undo that writes a "System:" line and refuses, vote
  left open, when a token has moved or a card has left the hand. The board's own Undo
  leaves to that vote every board change an action made: the city a scout founded and
  the scout and city-state it took, a harvested token, a wonder's coin and the leader
  marker of a free advance (found missing in review of part 13 and fixed with tests).
- **Settled with the human, 2026-10-23:** whether a wonder is obsolete is not tracked (the
  player judges it, as for the Pyramids); the white army of the Russians counts as one of
  the armies in the supply for Turing; the Seven Cities of Gold give the Arabs no free
  advance and ask which investment card gets the 2 markers; Expansionism counts a city-state
  by the figure standing on it; a relic is taken in Movement and its ability is claimed in
  any later Start of Turn; only Atlantis (log, then the tech tree) and the investment relic
  have a Start of Turn button; Mysticism's extra card applies to every culture card draw
  (advance, Patronage, Cristo Redentor); Patronage needs one advance first; Feudalism's
  resources come from the tile data; the coins on a wonder are not coin tokens to invest; a
  scout goes to the capital unless it is sent to a city.
- **Judgements of this work, not settled with the human:** a card in the hand over the hand size can
  still be played (base rules p. 18 say to discard first; the game does not enforce it);
  a Great Person with a passive or triggered text and a timing word is listed as playable
  and is only turned faceup by "use"; the free tech of a grant is spent by the first
  hidden tech of a matching level revealed in a Start of Turn, whichever the player meant;
  a scout placed this turn gathers from next turn is told, not enforced; the English armies
  that gather as scouts are offered to Devote and Harvest by hand only; the same resource
  icon harvested twice in a turn (Feudalism and a city's Harvest, or two cities) is warned
  about, not tracked.

Source: `engine/src/assisted.ts`, `assisted-core.ts`, `assisted-sot.ts`,
`assisted-abilities.ts`, `assisted-city.ts`, `assisted-cards.ts`, `card-timing.ts`,
`sot.ts`, `city-founding.ts`, `culture-track.ts`, `server/src/routes/play.ts`,
`assisted-args.ts`, `web/src/views/AssistedActions.tsx`, `PhaseTabs.tsx`, `SotPanel.tsx`,
`PlayableCards.tsx`, `EndTurn.tsx`, `YourCities.tsx`, `CityCard.tsx`, `PhaseSummary.tsx`, and the `assisted*` and `sot*` tests. Not built:
Great Person abilities that need a map marker, killing markers, map tile 16a, the effect of a
played card on other players, growing a metropolis, Movement, Trade and Research actions
beyond their tabs, and a guard for the owner's board Undo against the board changes a vote
undo made itself (it can bring back a token that the vote removed; the record stays undone).

## Trade offers (#265)

Trade negotiation stays in the game conversation, but an offer is an explicit
state record rather than ordinary chat text. Terms are free prose and are never
parsed or executed: accepting records an agreement only, so players still use
the existing legal trade-window controls to settle resources. The public view
shows the two participants, terms, turn/phase context and lifecycle status; it
does not expose request ids or any effect data. Only the intended sender or
recipient may perform each transition, and revision checks plus request ids make
retries and competing writes deterministic. Pending offers expire when a later
turn is observed; accepted offers are never expired.

Source: `packages/engine/src/trade-offers.ts`, `state.ts`, the trade-offer routes
in `packages/server/src/routes/games.ts`, and the chat panel/API tests.

## City production

Issue #250 slice A and a first part of #264. `cityProductionsOf` in
`engine/src/city-production.ts` estimates each city's production from the board
and revealed cards only, so every viewer gets the same figures; `cities` is in the
public view of every player. It is an estimate, never a complete count, and a number
typed by hand (`BoardPiece.productionOverride`, any player in the game may set it,
0 to 99, undone by board Undo) always wins.

- Outskirts production: forest 2, mountain 1, everything else 0 (the human; forest
  2 is also the base rules p. 26 example). A building replaces every icon on its
  square (base rules p. 16) and gives the production in `building-data.ts`, the
  human's table (also trade, culture, coin, cost and combat bonus, for the Build
  part). Enemy figures blockade a square. A wonder or great person square counts 0
  and is named in the notes, because their icons are not in the data.
- Added to every city: Infrastructure (`stats.infra`, at most 3), Despotism +1,
  Chichen Itza +3 (owned, not blockaded), Susan B. Anthony +2 (revealed, her type
  not fully blockaded), Military Science +1 per 3 coins (revealed). A Building
  Program marker on a city centre shows a second figure that doubles only the
  outskirts (Wisdom and Warfare p. 7). Communism, Urban Development, the Great
  Lighthouse, scouts sending a square elsewhere and one-turn cards are named in the
  notes, not computed. A square in two of the player's own cities counts for each
  and says so (cities may not overlap when built, so this is old data).
- A city piece off the map is not listed, so the status board's city count can
  be higher than the list of cities (Your cities).
- The per city arithmetic (outskirts squares, modifiers, notes) is no longer an
  always present details block on each card. The figure line carries a link,
  "Not a complete count" ("How the estimate is counted" when the figure is set by
  hand), that opens the same content in a small dialog.

Source: `engine/src/city-production.ts`, `building-data.ts`, `blockade.ts`
(`cityFootprintsOf`), `actions/board.ts` (`setCityProductionOverride`),
`web/src/views/CityCard.tsx` (the card), `YourCities.tsx` and the
`city-production*` tests.

## Assisted build

Issue #264, part 2: a city builds a building from the Build button on its card in
Your actions. `buildOptionsOf` (`engine/src/build-options.ts`) works out, for the own view
only, what each city may build and where; the `build` assisted action places the
piece, pays and logs in one step, and the everyone votes undo reverses it. The same
action builds army and scout figures (placed like a building) and military units (a
private card, nothing placed).

- Only legal choices are listed. Everything else is behind a "Why not the others"
  link that opens the reasons in a popup, with a reason each. A cost above the city's production is such a reason; the way out is to
  set the city's production by hand (decided with the human). Trade can cover a
  shortfall (rush, base rules p. 15): 3 trade for 1 production, the Americans get 2
  production per 3 trade, paid in whole steps and never more than needed.
- A building needs a revealed tech (the human's tech sheet, `BUILDING_TECH_UNLOCKS`).
  Once the upgraded form is unlocked only that form is built, and its tech alone is
  enough (base rules p. 22). Flipping already built basic buildings on learning the
  upgrade is the Upgrade action below.
- Squares: the city's outskirts on the map, never a centre (either city's, any
  colour) or a city-state, known terrain that `BUILDING_TERRAIN` allows, nothing
  built there, no enemy figure (base rules p. 27). The terrain table is advisory for
  placing a piece by hand (a warning) and binding for assisted Build, so a wrongly
  recorded tile (the terrain data was read by eye) can block a legal square; the
  player then places the piece by hand, which stays a logged correction.
- One limited building per city in total (Market or Bank, Temple or Cathedral,
  Barracks or Academy; base rules p. 16 to 17), counted over the city's outskirts
  whoever built it. Supply is the shared pools in `board.ts`. A square shared by two
  of the player's own cities (old data; cities may not overlap when built) can give
  the neighbour a second limited building; not handled, no ruling found.
- A Building Program marker on the city centre is used up by any build (W&W p. 7) and
  restored by undo. The figure used is the hand set production if there is one, then
  the doubled figure, then the estimate.
- No automatic "city action used" marker: techs, culture cards and Great Persons
  allow several actions, so the player ends the phase themselves (the human).

**Build polish and wonders (task `build-polish-wonders`).**

- The picker shows no count of squares and no "Draws a card in secret"; the groups are
  Buildings, Wonders, Figures (placed on the map) and Units. The bar still says that a
  unit is a private card.
- **Build opens with a button per group** (the human): Buildings, Wonders, Figures, Units,
  only those with something to pick. A button shows that list, with Back to the buttons; a
  group that is alone is shown at once. The choice is local to the picker and the engine is
  unchanged.
- A building, a wonder or a figure is placed by the tap on its square, with no Confirm
  (the human; first only figures, then all three): it can be moved, and removing it takes
  the build back. The exception is a square with a note (an enemy figure stands there, so
  the outcome is settled by hand): its note is read first and Confirm places the army. A
  unit has no square and keeps Confirm. A rush pays its trade at the tap too; removing the
  piece gives it back. After a refusal Confirm shows, so the same square can be tried again.
- **"Possible actions" box in Your actions** (the human): the assisted actions (Advance
  culture and the card buttons) sit in a box under their own heading, above Your cities,
  styled like a city card. With the phase tabs (part 13) each tab has the box for its own
  phase, its groups as sub-headings, and "Your cities" follows it in City Management. After a successful Advance culture the page scrolls to Your hand
  (it waits for a card choice that is open, which is above the hand, and goes when it has
  been kept). The city name is the larger text on a city card and the production figure the
  smaller; Build and Start Building Program share a row when there is room.
- The city card says "Production override" for the hand-set figure, and the picker "Production
  override: N" (it said "set by hand").
- **Removing a built piece before End turn takes the build back** (the human): the owner
  removes the building, wonder, figure or Building Program marker a build or a start put on
  the board, while their City Management is not marked done. `takeBackOpenBuild` then does
  what the undo vote does (the piece goes, the trade comes back, a used Building Program marker
  is put back, the record is `undone`) and adds a System line ending "It was removed before
  End turn."; the line that reported the build stays (the human allowed that instead of
  deleting a log line, which would also have meant renumbering the board history's line counts).
  The piece may have been moved first. After End turn, for the phase of an older turn, and for
  another player's removal, it is a plain removal as before, with no refund. A take-back closes an
  undo vote open on the line (it could never pass any more) and sets `board.undoFloor`, as taking
  back a civilization reveal does, so the owner's board Undo cannot bring the piece back while the
  build stays undone and the trade refunded (the vote undo has no such floor, except after a wonder
  build, whose drawn card it puts back in the deck). Upgrades and units are not taken back this way (an
  upgrade is several pieces, a unit a drawn card); the vote undo still covers every action.
  The web calls the same remove route; the server decides.
- **Wonders** (base rules p. 17): any city can produce a wonder that is faceup in the market,
  which is the wonder pieces in the shared Wonders area that nobody owns (`marketWondersOf`).
  The picker tells what it costs: the printed cost, or the lower cost when the player has revealed
  the tech on the card, with the other price beside it (`wonder-data.ts`, read from the `Wonders`
  sheet; a test keeps the two equal). **The cost is not enforced** (the human): cards, scouts,
  Great Persons and other effects add hammers and how to count them is not settled, so a wonder
  is offered whatever the city produces, no trade is paid for it and a rush flag pays nothing. The
  Building Program marker is still used up. Angkor Wat is 15 with Theology, not the 10 the sheet
  has (`SHEET_CORRECTIONS`, until the spreadsheet is fixed); the United Nations at 20 with no
  discount is right. It goes in the city's outskirts on any terrain but water, on a square with
  nothing on it or one of the player's own buildings or wonders (see "Replacing" below) and no
  enemy figure; one wonder per city, whoever owns the one there, and it does not count against
  the limited building. The build moves the market piece onto the square (it
  is not a new piece) and makes the player its owner, as two board history entries. **The next
  wonder is drawn into the market by the build** (the human): a game has four wonders of each era,
  so it comes from the ancient deck until four ancient wonders are out, then from the medieval deck
  until four medieval ones are out, then from the modern one. "Out" is a card that has left the deck
  (the nine of an era less what is still in it), wherever it went: the market, an owner, the map,
  Egypt's own area or a hand. It is counted from the deck so that a wonder piece taken off the board
  does not make room for another. An era with no card left is skipped, and nothing is drawn when
  twelve are out. The draw is a System line of its own ("drew X and placed it in the Wonders
  area") and its board entry is guarded from the board Undo. The vote undo and the take-back
  return the wonder to where it stood in the market (the next free spot when another wonder has
  been placed on it), clear the owner and put the drawn wonder back as the next card of its deck,
  and then the board Undo is floored (`undoFloor`), so it cannot bring the drawn piece back while
  its card is in the deck. The vote undo is refused when the drawn wonder is no longer in the
  Wonders area or has an owner; the take-back then becomes a plain removal, so removing the wonder
  after another player took the one drawn after it is an ordinary removal, with no refund. The log reads "built the Colossus in City B2 on square C2". Not built: the wonder abilities.

**Replacing, Great People and City Walls (the human, after trying Build).**

- **Replacing** (base rules p. 17 and 18, the human): a building or wonder may be built on a square that
  holds one of the player's own buildings, wonders or Great People; a wonder may replace a building and
  the other way round. The old piece is removed first (`removeReplaced`, a board history entry of its own), then the
  new one goes on the empty square, and the new piece must be legal there (terrain, no blockade). A
  building goes back to the supply; a wonder is destroyed: its piece leaves the board and it is not
  put in the market or the deck again (the deck is counted from the cards that left it, so nothing
  takes its place). A Great Person is held in reserve instead (see below). Another player's wonder
  (`ownerId` set to another player) and a city-state keep a square taken. A building or Great Person
  in a city's outskirts counts as the city owner's, whoever put it there, as for Upgrade. The square says what it replaces (`BuildSquare.replaces` and
  `note`), and a square with a note is not placed by the tap but needs Confirm, so a destroyed wonder
  is never a mis-tap; the board marks it "Replace".
- **One wonder and one limited building per city** now means a new one may only take the place of the
  one already there: for a wonder the only square is the existing wonder's, for a limited building
  the existing limited building's (`onlyReplacingOf`). The reason in Why not the others says so.
- **The supply**: with none of a building left, it can still be built on one of the player's own
  buildings of the same supply group (a Granary and an Aqueduct share one), since the old one goes
  back first (`sameSupply`).
- **A Great Person replaces, it does not cover** (base rules p. 18, which the human chose over his first
  description, where the person only disabled the building under it and the building worked again when
  the marker went). A Great Person placed on a building or wonder replaces it as on p. 17: the building
  is removed (back to the supply), a wonder is destroyed. A Great Person that is itself replaced, by a
  building or wonder built on its square or by another Great Person placed there, is held in reserve:
  its marker goes to the owner's own player area (the civilization sheet) and has no effect off the map;
  it can be placed again at the start of any turn, which is a manual move as before. Taking a marker off
  a square later does not bring back what it replaced.
  - **Build over a Great Person** (`removeReplaced`, `reserved` in the `build` effect): the person is
    moved to the player's area as a board history entry, the new piece goes on the empty square, and
    the undo vote moves it back to its square exactly (refused when it has been moved out of the area
    since); removing the new piece by hand is then a plain removal with no refund, as when the wonder
    drawn after a wonder build is gone.
  - **A Great Person dropped on a square** (`replaceUnderGreatPerson`, `actions/board.ts`, called by
    `placePiece` and `movePiece`): when the marker arrives on a square (it was placed there, or it came
    from another square or from the player area; a nudge or a re-drop on its own square replaces nothing,
    so a building left beside a marker on purpose stays) in the outskirts of a city of the
    player who placed it, the building or wonder there is removed and any other Great Person there is
    moved to that player's area, each as a history entry after the move, so the board Undo gives them
    back one step at a time and Redo goes forward again. Another player's wonder is left alone, and a
    marker dropped anywhere else is the plain move it was. A building dropped on a Great Person by hand
    is not automated: Build is how a building replaces one. A drop that would destroy a wonder is asked
    about first (the human's choice): `BoardView`'s `terrainAllows` uses the same read-only query as the
    engine (`piecesReplacedByGreatPerson`) and shows "Placing the Artist here destroys the Colossus, which
    cannot be built again for the rest of the game. Place it anyway?" before it sends the drop, on every
    path (palette, drag, tap, arrow-key nudge). Buildings and Great People are replaced without a question,
    since the board Undo gives them back. A drop onto a blockaded own square still replaces: the board does
    not enforce placement rules, as before.
- **City Walls** (base rules p. 17, Masonry card: 7 production): a building in the city centre, offered
  in the Buildings list as `walls` with no square (`placement: 'none'`). Building them flips the city
  marker to its walled asset (`cities/<colour><kind>walled2`) as a new board change, `flip`: the same
  piece id, the same centre, only another asset and size, so a typed production, the city's record and
  the city's other actions stay. One per city; a walled marker (China's capital, or an earlier build) says
  so in Why not the others. The build costs production, rush trade and the Building Program marker like
  any building and is the city's action. The +4 when defending a walled city is not counted anywhere. A
  take-back by removing the piece is not offered (the piece is the city); the undo vote flips it back.
- **Upgrade** (base rules p. 22) is unchanged: learning the tech flips every basic building of the family
  at once, the "Upgrade buildings" block. Building the upgraded form on a basic one replaces it like any
  other building.
- The undo vote and the take-back put the replaced piece back exactly as it was (`replaced` in the
  `build` effect, `reserved` for a Great Person); the board Undo cannot take back the removal alone.
  Known gap: a take-back puts the old piece back on its old square even when another piece has been put
  there by hand since (the vote undo has the same check as other builds: the new piece must still be
  on its square). A building may also replace an identical one (a Library on a Library), which costs
  production and changes nothing; it is not blocked. Tests: `assisted-build.test.ts`,
  `assisted-wonders.test.ts`, `assisted-walls.test.ts`, `great-person-replace.test.ts`, the server
  `assisted-walls-api.test.ts` and `BuildPicker.test.tsx`.

**Figures and units (#264 parts 3 and 4).**

- Costs (base rules p. 15 to 17): army 4, scout 6. A unit costs by the player's level
  for its type, read from `stats.infantry`, `stats.artillery` or `stats.mounted`
  (clamped to 1 to 4, never changed): 5, 7, 9, 11. Aircraft cost 12 and need a revealed
  Flight. Rush, the hand set production and the Building Program marker work as for
  buildings; the marker is used up by any build.
- Figure squares: outskirts on the map, never a centre or a city-state, water only with
  a revealed Sailing, Steam Power or Flight, below the stacking limit `stats.stacking`
  (armies and scouts together; read only, default 2), supply 6 armies and 2 scouts per
  colour counted anywhere on the board. A scout is not offered a blockaded square. An
  army is, with a note that the outcome (a battle, or killed scouts and loot) is not
  automated. The rulebook settles this only for movement, so it is left to the player.
- A hut or village marker on a square: scouts may not enter it and only armies take it (the
  human). The engine never offers such a square to a new figure. The human says this never
  matters for Build: a city cannot be founded with a hut or village next to it (the marker must
  be removed first), so none stands in a city's outskirts during City Management. The rule is
  inert and left in place; if it ever matters, a newly built army may take the square.
- A unit card is drawn like the Draw button does (reshuffling discards when the deck is
  empty) and goes hidden into the hand. The public line names the type only, never the
  card, and no item log line is written, so the old item undo cannot take it back
  alone. Undo puts the card back in its deck and shuffles that unit deck again, as the
  older item undo does, so the next card is unknown (the human's decision). A build then
  undo then build can therefore draw a different card; that is accepted.
  Great Person cards and the old item undo still reshuffle the whole deck on undo; that
  is the older behaviour and a possible redraw loop there is not addressed here.

**City actions: start a Building Program, upgrade buildings.**

- Start a Building Program (W&W p. 7) is a city action in the player's open City Management
  phase, free, one marker per city (a marker on either centre of a metropolis counts). The
  marker goes on the anchor centre square. A build in that city uses it up (see above); undo
  of the start is refused while the marker is gone, so a build must be undone first.
- Upgrade (base rules p. 22) flips the player's basic buildings of a family to the upgraded
  form once the upgraded form's tech is revealed (the basic form's tech is not needed). The
  player's buildings are those inside the outskirts of the player's own cities, found with
  `cityFootprintsOf`, never by `placedBy`. A building in nobody's outskirts or in another
  player's city is left alone. No cost, no phase gate (the tech may be learned in Research), not
  automatic: the player presses a button, and moving pieces by hand stays possible. The supply
  pool is shared by both forms, so a flip never changes the count.
- A flipped building keeps its square and the original piece's `placedBy`, so the combat bonus
  and the building count of whoever placed it follow the form change and nothing moves between
  players. The new piece keeps the old one's centre, not its top left corner, because the two
  artworks differ by a few pixels. Undo restores the original pieces, with their ids, on top of
  the piece stack (z order is not restored; the same as the build undo).
- Known gaps: a square in the outskirts of two players' cities lets both list the building and
  the first press wins; the record's `phase` reads CM when every phase of the turn is done.

Source: `engine/src/build-options.ts`, `city-actions.ts`, `building-data.ts`, `wonder-data.ts`, `assisted.ts` (the `build`,
`startBuildingProgram` and `upgradeBuildings` actions and `takeBackOpenBuild`), `actions/board.ts` (`isAssistedBoardChange`), `server/src/routes/board.ts`
(remove), `web/src/views/BuildPicker.tsx`,
`CityActions.tsx`, `CityCard.tsx`, `YourCities.tsx`, `buildFlow.ts` and the `assisted-build*` tests.

## Devote to the Arts and Harvest

Follow-up of issue #264, same branch and PR as the other city actions. Two buttons on the city
card in Your actions, `devoteToTheArts` and `harvest` in `engine/src/assisted.ts`, with the same
`/actions` route, request id rules and undo vote as every assisted action. `cityGatheringOf`
(`engine/src/city-gather.ts`) reads what a city can gather from the board only; `cityActionsOf`
adds the status (phase, market supply) and the projection carries it in `you.cityActions`.

- **Icon data.** The resource icons (wheat, silk, incense, iron) and the culture icon of a natural
  wonder are printed on the tile images only. `engine/data/tile-icons.json` records them, read by
  eye from every tile image against the key on p. 7 of the base rulebook, in the printed
  orientation like `tile-terrain.json` (`squareIconsOfCell` undoes the rotation). It is not checked
  against a printed list: a wrong entry gives a wrong offer, and the manual path (drag the token,
  edit the counter) is still there. A tile with no entry is unknown, not empty. Trade, production
  and coin icons, huts and villages are not in it. Test `assisted-gather.test.ts` checks the file's
  shape and the rotation.
- **Devote to the Arts** (base rules p. 17; metropolis base 2 from Fame and Fortune): 1 culture
  for the city (2 for a metropolis) plus the culture of each outskirts square: a building gives
  its row of `building-data.ts`, a wonder marker 1 (ancient), 2 (medieval) or 3 (modern) culture
  (`WONDER_CULTURE`, also when the wonder is obsolete, p. 27) and a Great Person marker its icons
  (`great-person-data.ts`: Artist 2, Merchant 2, Humanitarian 1, the others none). Each replaces
  the square's printed icons (p. 16); a bare square gives its natural wonder icon. The marker
  culture was read by eye from the 33 images, the Great Person icons by a second reader as well, and
  is not in any sheet. A square an enemy figure stands in gives nothing, a wonder's marker included
  (p. 27). The effects of a civilization, government, tech or card, and the culture a Great Person
  card gives when it is revealed or discarded, are not counted and are named in the panel. The
  culture goes to `stats.culture`. The player may type another number (0 to 99,
  `MAX_DEVOTE_CULTURE`), as before; the log then says the estimate was something else.
- **Urban Development** (social policy, the human's reading of the card): a city with at least two
  different buildings or wonders in its outskirts gets 2 extra culture when devoted. "Different"
  is read as different kinds: two Temples count once, a wonder always counts as one more, a Great
  Person is not a building, a blockaded square is not used and does not count, a building outside
  the outskirts does not. Only a revealed policy counts (the human's ruling); one that is chosen but still hidden
  does not, and none does under Anarchy ("Your social policies have no effect"). The sum is in the owner's view only (`hidden-info.test.ts`).
  When the policy is chosen but the city falls short, the panel says how many it found. The
  production half of the card (3 extra production) is still only named in the production notes.
- **Harvest** (p. 18): one token of a resource whose icon is in the city's outskirts goes to the
  player's area as a `resources/<name>` piece, which is where a resource is paid from. A blockaded
  square gives nothing. A resource under a building, a wonder, a Great Person or a disaster token is
  covered and cannot be harvested (the human's ruling, for the city and for a scout); the panel
  names it. A disaster token covers the square's culture icon in Devote too (the human's ruling). The market is the supply of `board.ts` (as many as there are players, at most five, the
  pieces on the board being what is gone); a kind that is out is listed disabled. Angkor Wat's
  second harvest is not built.
- **Indians** (civilization sheet): +1 culture for each outskirts square with an uncovered, unblockaded
  resource icon when devoted.
- **Scouts** (p. 26): a scout of the player's outside the city's own outskirts is offered with its
  square's culture or resource, and what it stands on: a building (also one in another city's
  outskirts), a wonder, a Great Person or a culture icon. Which city a scout is sent to, and whether it was placed the turn
  before, are not tracked, so every city offers every scout and the player chooses; the panel
  says so. A scout's square is read with no blockade.
- **One action per city per turn** (base rules p. 15; the human's ruling after the first version
  tracked nothing). Build, Start Building Program, Devote to the Arts and Harvest are the city's
  action; Upgrade buildings is not. `cityActionsTakenThisTurn` (`assisted.ts`) lists the applied,
  not undone records of this turn for the city; `CityActionOptions.actedThisTurn` carries it to the
  client. The game does not forbid a second action: the client asks (`window.confirm`, "has already
  acted this turn (...). Do it anyway?") when Build, Devote or Harvest is opened and when Start
  Building Program is pressed, then sends `confirmedRepeat`. The engine refuses a second action
  without it (status `used`, HTTP 409), after every check that makes the action impossible, so a
  refusal says what is wrong first. A confirmed one is logged "(a second action of this city this
  turn, confirmed by the player)". An undone action and an earlier turn do not count.
- **Not tracked:** the rule that one resource icon cannot be harvested twice in a turn (FAQ). The
  harvest panel and the FAQ say so.
- **Undo.** Devote: refused when the culture has been spent (less than was added is left).
  Harvest: refused when the token is gone or has left the player's area. The plain board Undo
  cannot take the token back alone (`isAssistedBoardChange`).
- **Payloads** are parsed strictly (`parseDevotePayload`, `parseHarvestPayload`).

Source: `engine/src/city-gather.ts`, `tile-icons.ts`, `wonder-data.ts`, `great-person-data.ts`,
`terrain.ts` (`tileSquareAt`),
`city-actions.ts`, `assisted.ts`, `web/src/views/CityGather.tsx`, tests `assisted-gather.test.ts`,
`CityGather.test.tsx` and `assisted-city-actions-api.test.ts`. Brief `tasks/assisted-gather.md`.

## Accounts, mail and ratings

Legacy SHA-1 accounts upgrade to scrypt on successful login. Password reset
uses a separate derived signing key and expiring token; unknown-email responses
must not enumerate accounts. Registration's fixed Writing answer is a spam
speed bump, not a security boundary.

Game creation sends no email. Ordinary notifications wait for the previous
notification to be acknowledged by opening the game; battle/final messages have
specific exceptions. Idle-turn reminders target a holder waiting over 72 hours,
once per unchanged activity version; opening the game does not reset activity.
Queued broadcasts keep indeterminate sends claimed until explicit resolution,
with a release cooldown, to avoid duplicate deliveries. Respect opt-outs and
current addresses at send time.

Historical ratings use conservative available evidence; current results use
board culture position and coins. Display scaling by 100 does not change the
stored rating.

Source: `packages/server/src/auth.ts`, `routes/auth.ts`, `notifications.ts`,
`turn-reminders.ts`, `store/rating.ts`, and their tests. README contains operational
configuration and migration instructions.
