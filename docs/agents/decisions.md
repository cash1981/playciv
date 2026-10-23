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

Source: `packages/engine/src/turn.ts`, `packages/server/src/routes/play.ts`,
`packages/web/src/views/ChatOrdersPanel.tsx`.

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
- A Great Person card is valid only when its marker type has supply (3 per
  type). Invalid draws are discarded faceup. With no marker of any type left,
  nothing is drawn. The kept card stays hidden in the hand and the marker piece
  goes into the owner's area.
- The game page shows a phase summary and shortcuts, and the order is board,
  Your cards, then the rest. The piece palette sits below the board at every
  width; this is unconfirmed by the human and reversible in `styles.css`.

### Phase tabs and Start of Turn (part 9, 2026-10-23)

The "Your actions" panel has one tab per phase (Start of Turn, Trade, City
Management, Movement, Research); the viewer's open phase is selected first and
any tab can be opened. Every action built before part 9 is under City Management.
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
  the level the marker stands in (the start space counts as level I) and keeps one;
  Rationalism spends 6 or 11 trade for a level I or II tech and records a
  `TechGrant` that the tech panel spends when the tech is revealed in Start of Turn.
  Learning is not researching: no coins keep trade.
- **Government.** One change per Start of Turn. A government whose tech was revealed
  last turn or this Start of Turn (`techRevealTurns`) can be taken directly; any other
  change goes through Anarchy, and from Anarchy any known government is direct. The
  Pyramids and Dr. Martin Luther King avoid Anarchy. Democracy +2 trade, Fundamentalism
  1 culture per army on the map, Feudalism puts a harvested resource in the player's
  area (which resource a square has is not in the map data, so the player names it).
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
  city for the turn and only production moves; the trade, culture, coin and resource
  icons stay manual. Growing a capital into a metropolis only scrolls to the map.
- **Wonders, Great Persons, techs, huts and relics** (`assisted-abilities.ts`, kinds
  `sot:<ability>`): Stonehenge, The Colossus, The Louvre, Lorenzo de' Medici (1 culture
  per 3 coins) and Alan Turing (1 trade and 1 culture per 2 armies still in the supply)
  add their numbers; Sydney Opera House advances for free; Panama Canal adds a coin to
  the wonder; Cristo Redentor draws two events of a chosen level and keeps both; Statue
  of Liberty, the Teacher hut and Atlantis grant a free tech; the Seven Cities of Gold put
  two investment markers on a chosen card without a coin. A relic is claimed by the
  player whose board history removed its marker, once per game. The rest (Great Wall,
  Hanging Gardens, Taj Mahal, Big Ben, Machu Picchu after an invested coin, Plastics, and
  Ecology, which spends a Wheat) only log, once per turn: the choice is on the map. The
  other Great Person cards with a Start of Turn text (Henson, Mother Teresa, Giannini,
  Edison, Wright, Cousteau) go through the generic card play.
- **Undo.** Every action has a vote undo that writes a "System:" line and refuses, vote
  left open, when a token has moved or a card has left the hand. The board's own Undo
  leaves to that vote every board change an action made: the city a scout founded and
  the scout and city-state it took, a harvested token, a wonder's coin and the leader
  marker of a free advance (found missing in review of part 9 and fixed with tests).
- **Assumptions the human should confirm:** whether a wonder is obsolete is not tracked
  (the player judges it, as for the Pyramids); the white army of the Russians counts as
  one of the armies in the supply for Turing; relic claims accept any Start of Turn
  after the marker was removed, not only the next one; a free investment of the Seven
  Cities of Gold gives the Arabs no advance; Expansionism counts a city-state by the
  figure standing on it; Mysticism's extra card is not added to Cristo Redentor's two.

Source: `engine/src/assisted.ts`, `assisted-core.ts`, `assisted-sot.ts`,
`assisted-abilities.ts`, `assisted-city.ts`, `assisted-cards.ts`, `card-timing.ts`,
`sot.ts`, `city-founding.ts`, `culture-track.ts`, `server/src/routes/play.ts`,
`assisted-args.ts`, `web/src/views/AssistedActions.tsx`, `PhaseTabs.tsx`, `SotPanel.tsx`,
`PlayableCards.tsx`, `PhaseSummary.tsx`, and the `assisted*` and `sot*` tests. Not built:
Great Person abilities that need a map marker, killing markers, map tile 16a, hand limit,
the effect of a played card on other players, growing a metropolis, Movement, Trade and
Research actions beyond their tabs (#264 harvest and devote), offers (#265).

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
  be higher than the Cities panel.

Source: `engine/src/city-production.ts`, `building-data.ts`, `blockade.ts`
(`cityFootprintsOf`), `actions/board.ts` (`setCityProductionOverride`),
`web/src/views/CitiesPanel.tsx` and the `city-production*` tests.

## Assisted build

Issue #264, part 2: a city builds a building from the Build button in the Cities
panel. `buildOptionsOf` (`engine/src/build-options.ts`) works out, for the own view
only, what each city may build and where; the `build` assisted action places the
piece, pays and logs in one step, and the everyone votes undo reverses it. The same
action builds army and scout figures (placed like a building) and military units (a
private card, nothing placed).

- Only legal choices are listed. Everything else is under "Why not the others" with
  a reason. A cost above the city's production is such a reason; the way out is to
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

Source: `engine/src/build-options.ts`, `city-actions.ts`, `building-data.ts`, `assisted.ts` (the `build`,
`startBuildingProgram` and `upgradeBuildings` actions), `actions/board.ts` (`isAssistedBoardChange`), `web/src/views/BuildPicker.tsx`,
`CityActions.tsx`, `CitiesPanel.tsx`, `buildFlow.ts` and the `assisted-build*` tests.

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
