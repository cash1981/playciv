# Current decisions

Read only the relevant topic. This is current rationale and compatibility
context, not a complete rules specification. Code/tests and the relevant FFG
references take precedence over historical plans. Update superseded entries
in place; retain a short reason for meaningful behavior changes. "(human)"
marks a rule that is the human's ruling rather than a rulebook reading.

Older logs, briefs and reversed decisions are retrievable through
[the Git history guide](../history/README.md); never apply an old entry without
checking the current code.

## Architecture and authority

- The Java/Angular systems are historical references, not the specification.
- Engine reducers are pure and return errors as values.
- Hono runs on Node with JSON storage locally and on a Cloudflare Worker with D1
  in production. Render/Mongo hosting is retired.

Source: `packages/engine/src/`, `packages/server/src/app.ts`,
`packages/server/src/store/`, `packages/worker/src/`.

## Privacy, projections and logs

- Only owners receive private hands, notes and logs; opponents see counts and
  revealed information.
- Great Person pyramid placement exposes an anonymous slot, not the card name.
- Publicly derived coins/combat/culture limits use revealed information even for
  the owner, so private research cannot leak through a total. Public totals never
  include hidden bonuses.
- Undo descriptions must not reveal more than the original public action.
- Log-number keys are independent of the public RNG stream.
- Never reconstruct historical revealed cards by matching display names to a
  current hand: duplicate names and redraws can reveal private cards.

Source: `state.ts`, `log.ts`, `coins.ts`, `combat-bonus.ts`, `culture-hand.ts`
under `packages/engine/src/`; privacy and projection tests under `test/`.

## Revealed and Discarded history

`revealedFeed` starts from the current public set (discard pile and non-hidden
hand items) and keeps a row for every public `DISCARD` entry, even after a
reshuffle or a hidden redraw: the discard was public, and its row does not reveal
where the card is now.

- An assisted card play that discards without a `DISCARD` line (Great
  Person/culture play), and a card discarded by a reward choice (`chooseReward`
  plus the advance's drawn cards), are kept the same way. Such a row uses the
  assisted record's time and log position even if the card is still in the pile,
  so it sorts with its play line.
- A resource hut spent into the discard pile shows from the pile; huts are never
  reshuffled.
- A revealed card that leaves the public set without a discard vanishes;
  technologies/social policies are never added from the log.

Source: `packages/engine/src/actions/game.ts` (`revealedFeed`),
`revealed-feed.test.ts`.

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
  adoption; saved-data compatibility outlives the removed admin migration tool.
  `yourTurn` still carries started-state compatibility.
- Do not rename already-applied duplicate-numbered `0004` SQL migrations.
  Deployment/cleanup procedures are in README's storage sections.
- Trade offers saved with one `recipientId` are read as a list of one
  (`migrateGameState`).

Source: `packages/engine/src/migrate.ts`, `packages/engine/src/board.ts`,
`packages/server/src/store/revision-chain.ts`, `packages/server/src/revision-delta.ts`,
`packages/server/test/revision-delta.test.ts` and Worker migrations.

## Timeline and turns

- The chat/orders timeline is the only mode, for running and finished games. The
  classic TurnPanel, mode switch, baton actions and admin migration UI are removed.
- Turn state derives from phase completion and the start marker.
- Out-of-turn draws require explicit confirmation.
- Posting the explanatory order row follows the authoritative game-state commit
  and can fail independently; do not roll back or blindly repeat the committed
  action.
- Layout: only the timeline is height-capped (screen minus about 40rem, between
  8rem and 32rem); thread and composer are not, so the page grows instead. A cap on
  the thread let the composer overflow and hide End turn and Send. Guarded by the
  stylesheet test in `ChatOrdersPanel.test.tsx`; retune 40rem if the composer
  changes size.

Source: `packages/engine/src/turn.ts`, `packages/server/src/routes/play.ts`,
`packages/web/src/views/ChatOrdersPanel.tsx`, `ChatOrdersPanel.css`.

## Board and manual bookkeeping

- New-game geometry is defined here, not by the old Google Presentation:
  two-player 16×8, three-player pyramid, five-player holed 28×18. Pre-shape
  three-player saves with pieces and five-player saves keep their old rectangle
  so pieces do not move; see [legacy layout limitations](limitations.md#game-behavior).
- Culture track: 21 positions with freely placed markers.
- Board undo targets the caller's latest consecutive actions; a new board action
  clears redo. Undoing board edits does not undo game actions.
- A moved piece keeps the pixel position where it is dropped, including in a
  player area. A new palette piece in a player area tidies into the next free
  slot (keeps collected huts in a row, #100).
- Each colour has six armies and two scouts. Russia gets one extra white army and
  Spain one extra white scout (`whiteFigureFor`), supply one each. Revealing the
  civ puts it in the player's area; only that civ's player is offered or may place
  it (`BOARD_ASSET_CIV_ONLY`); undoing the reveal takes it back. In blockade and
  City-state 4 rules a white figure counts as its civ's colour. Russia revealed
  before this rule gets no automatic army. Spain's extra scout is the human's
  ruling (the card says only "start with 2 scouts"), following #204 for Russia.
  White scout art and manifest entry come from `tools/board-assets.ps1`.
- Revealing a civilization does not need the turn (human): starting units are
  drawn with `confirmedOutOfTurn`, so any seat may reveal in any order, also
  after an undone reveal.
- Terrain checks are advisory client warnings, not server placement restrictions.
- Player status `stats.aircraft` (default false) means Aircraft is unlocked.
  First reveal of Flight ticks it; anyone may toggle it; it is not cleared when
  Flight is removed nor enforced when drawing Aircraft.
- Metropolis sprites are 170×82 px to cover two map routes; keep image size and
  manifest dimensions aligned (`tools/board-assets.ps1` normalizes them).
- Government selection and tech-pyramid placement are permissive bookkeeping
  unless a specific effect is automated. Change generated data through its
  generator/source, never by patching to encode a rule. The Military
  Tradition/Pacifism pairing is corrected by parsing and migration.
- The owner deliberately commits FFG piece/card artwork to this public repository,
  acknowledging it redistributes copyrighted artwork. Deleting files would not
  remove published copies from Git history; reversing this needs a separate,
  explicitly authorized history-cleanup decision.
- A disaster token decides its square's terrain (human): Drought desert, Forest
  forest, Grassland grassland, Water water, for building terrain, production,
  city founding, where a figure may stand and placement warnings (`terrainAt`;
  newest token wins; a token on a facedown tile leaves it unknown). It also
  replaces the printed trade (Drought and Water 1, Forest and Grassland 0); a
  building or Great Person on it gives its own.

Source: `packages/engine/src/board.ts`, `actions/board.ts`, `terrain.ts`,
`actions/player.ts`; tests `white-figures.test.ts`, `undo-civ-reveal.test.ts`,
`player-action.test.ts`.

## Coins, wonders and blockade

- Wonder ownership/bonuses do not depend on the piece staying in the shared
  Wonders area. Disabling a wonder clears its owner, keeps the piece, marks it
  `disabled` (drawn greyed with the blockade cross, logged publicly); assigning an
  owner re-enables it. Its culture token is unaffected; a disabled wonder grants no
  owner benefits. Manual assignment and disabling are public log lines.
- Panama's coins belong to the physical wonder and count for its active,
  unblockaded owner.
- Bank/Great Person/Adam Smith effects derive from board ownership and revealed
  cards; `placedBy` is not city ownership. The Coins tab lists Adam Smith only
  while his card is revealed and usable.
- Metropolis outskirts are the ten squares around two centres, excluding both.
- A Great Person with no tracked matching token is not assumed blockaded
  (compatibility with existing games).
- Scout-transfer coin corrections remain manual; see [limitations](limitations.md).
- The palette uses a single `coin1` marker named Coin.
- Reference dialogs move focus with `preventScroll` so `?` never scrolls the page.
- City-state 4 ("1 Culture & +2 Combat bonus"): +2 derived combat bonus for the
  player whose army or scout stood in its square first, once however many figures;
  the card need not be held. A later arrival (battle) does not get it. It passes
  only when the holder has no figure left there, to the colour there longest, and
  is not regained by returning. "First" is derived by replaying `board.history`
  (`cityStateHolderColour`) because stacking order changes; nothing is stored, so
  undo follows. The +1 culture half is not derived.

Source: `packages/engine/src/coins.ts`, `blockade.ts`, `combat-bonus.ts` and
related tests.

## Arena and card handling

- Arena turn indicators are advisory; participation and edits have their own
  permissions. Do not turn indicators into enforcement.
- Kills are reversible flags, not automatic discards (the earlier auto-discard
  plan, #71, is superseded). Reinforced-away cards stay locked until battle end.
  Loot remains manual.
- Gifting is restricted to tradable cards; Great Persons/civilizations are not
  freely giftable. Owners may explicitly discard a Great Person from hand or
  revealed cards, with log wording matching what was already visible.
- Standalone barbarian drawing is supported; initiation reuses the prepared hand
  or draws automatically.
- Only the player who ended a battle may undo End battle, until another battle
  begins. The projection exposes only `battleUndo.endedBy`, never the stored
  private unit identities.

**Undoing a civilization reveal.** The vote takes back what the reveal handed
out by itself, recorded as `GameLogEntry.civSetup`:

- Starting units and Egypt's wonder go back into the (reshuffled) deck; other civ
  cards return to the hand; starting tile, leader marker, starting tech (by the
  civ's own tech id, so a re-chosen copy stays) and government are removed; the
  starting tech's and Democracy's coin counters are cleared; returned units lose
  battle flags. Cards the player drew or chose stay.
- The start-of-game wonder deal is taken back whichever reveal triggered it, and
  dealt again by the next reveal that completes the table.
- Board pieces are removed as System history entries; `board.undoFloor` is set to
  the history length and Redo cleared, so board Undo cannot bring back pieces
  whose cards are in the deck.
- A reveal made before `civSetup` existed is rebuilt from the log and the board.
  It is refused (`CIV_REVEAL_NOT_UNDOABLE`, no undo offered) for Egypt and once
  shared wonders are dealt, since those cannot be tied to the reveal.
- A vote that has run cannot be voted again (`UNDO_ALREADY_DONE`).
- `civSetup` is server-side like `item`: opponents get the public log form only.

Arena unit values: the card label shows the unit's tier (printed values plus
rotation level, `arenaUnitTier`), never damage or hand edits; the ATK/HP fields
show current values. When a unit is placed or moved onto a front facing a living
unit, one round is resolved (`resolveArrival`): Artillery trumps Infantry,
Infantry trumps Mounted, Mounted trumps Artillery; a trumper strikes first and,
if that is lethal (attack >= opposing HP), takes no damage and the victim is
flagged `killed`; otherwise both lose the other's attack. The opponent's
*current* HP takes the damage, so earlier rounds persist. Rotating re-seeds the
unit to its new tier and re-applies only its opponent's blows. Later rounds and
corrections stay manual via the ATK/HP fields. Aircraft trump nothing. Tests:
`arena.test.ts` "face-off on arrival", `ArenaUnitCard.test.tsx`.

Source: `packages/engine/src/actions/arena.ts`, `actions/player.ts`,
`actions/undo.ts`, `state.ts`, arena tests and `undo-civ-reveal.test.ts`.

## Assisted play

Cards, culture advances, Great Person markers and city/phase actions use one
contract, `performAssistedAction` (`POST /api/games/:gameId/actions` with
`requestId` and `rev`). Every manual path stays (dragging pieces, editing
counters, Draw buttons, the culture marker); assisted actions are added beside
them and keep the game's existing undo rules (human). Each action has a
registry entry with `phase`, `group`, `status` and `reason`, computed once in
the engine; the browser decides no rule.

- **Once per turn.** Each card is used once per turn (`PlayerTurn.usedActions`,
  human). A second use asks and, with `confirmedRepeat`, is allowed because cards
  can grant another use; only the `used` refusal is lifted. Social policies and
  wonders are strict once (human): `repeatable: false`, button disabled,
  `confirmedRepeat` cannot lift it. Government changes and investments are strict
  once too (`strictOnce`), disabled by their own panel.
- **Resources** (human): pay with an unspent hut item of that name first, else a
  `resources/<name>` piece whose centre lies in the player's own area, which goes
  back to stock. Applies to every resource kind; a piece outside every area is
  never taken.
- **Undo** is the existing vote, extended to assisted log lines
  (`assistedActionId`). A reversal writes a "System:" line and refuses, vote left
  open, when a marker or token moved or a card left the hand. Board Undo refuses
  every board change an action made (`isAssistedBoardChange`): founded cities and
  the scout/city-state taken, harvested tokens, a wonder's coin, the leader marker
  of a free advance.
- **Culture advance** (`culture-track.ts`): 21 spaces in three levels of seven;
  Great Person on 3, 7, 12, 18. Cost by destination level: 3 culture; 5 culture +
  3 trade; 7 culture + 6 trade. Endowment for the Arts (`stats.efta`) takes 1 off
  the culture cost at 2 investments, 2 at 4. Ecology takes 1 trade off per 3
  coins (from the printed card text, not the human). Never below 0. Event spaces
  draw 1 (+1 Mysticism); Great Person spaces 1 (+1 Organized Religion, +1 Greeks);
  the player keeps one via a private, stored `pendingRewards` choice (a refresh
  resumes it, never redraws). The advance may repeat in a turn but not while a
  choice is pending. Space 21 draws a level III card and logs Culture Victory; it
  does not end the game or set a winner (human). Phase is City Management (an
  assumption the human has not confirmed). Undo moves the marker back, refunds and
  returns all drawn cards to the deck with a reshuffle; refused if a kept card left
  the hand.
- **Card choice publicity (#304):** the public line names the cards not kept
  (already in the public discard pile); the kept card stays secret. Undo returns
  all drawn cards and reshuffles; the earlier public line stays.
- **Culture hand limit (#248):** a hand with more culture cards than
  `cultureHandSizeOf` takes no culture card by an event advance (button
  unavailable) or gift (`tradeToPlayer`, `CULTURE_HAND_OVER`, 409). A culture Draw
  asks first and the server requires `confirmedOverLimit` (409 otherwise). A hand
  exactly at its size may take one more and sit one over; the advance then warns
  and Your hand shows a notice. The count includes hidden culture cards, the size
  counts only revealed cards, so an unrevealed Pottery or Valmiki can block early.
  Great Person spaces are never blocked. Trade offers are not checked.
- **Culture deck level warning:** drawing a culture deck whose level differs from
  the leader marker's level (Start counts as I) asks "Are you sure?"; client-side
  only, since Draw is a manual path. Moving the leader marker by hand charges and
  awards nothing.
- **Great Person supply:** a Great Person card is valid only while its marker type
  has supply (3 per type). Assisted and manual draws discard an invalid card faceup
  with a public line and continue (one reshuffle of Great Person discards); with no
  marker of any type left nothing is drawn. The kept card stays hidden and the
  marker goes into the owner's area.
- **Header turn focus** (`turnFocus.ts`): the header names the player furthest
  behind (lowest phase in `activeTurn.waitingFor`); ties go to the turn holder if
  in the tie, else the first listed; the viewer gets no preference. "Waiting for"
  lists the others at the earliest open phase. The engine's turn holder is
  unchanged and still used, on purpose, by the lobby (`nameOfUsersTurn`) and the
  out-of-turn Draw question.
- **Turn warning:** a request sent from a phase tab asks "It is not your turn…"
  when the header's player (`focusPlayer`) is not the viewer; navigation, Cancel,
  `?` hints and End turn never ask.
- **Page layout** (human): board, Your actions, Your cards, then the rest; the
  piece palette sits below the board (unconfirmed, reversible in `styles.css`).
  Shortcuts: Board, Actions (only when the panel is shown), Your cards, Tech tree.
  Chat and History shortcuts are removed on purpose.
- **Your actions panel** is shown to every player in a running game, never to a
  spectator or before start/after end. It holds End turn, the phase tabs and, in
  City Management, "Your cities" (city cards and city actions; human, the old
  Cities panel was hard to find). The panel for opponents' cities was removed
  (human); the projection still carries their `cities`.
- **End turn** in Your actions ends one phase: it marks the viewer's earliest open
  phase done (same request as the Order tab button, with turn and phase). Ending
  Research for everyone starts the next turn. The Order tab keeps its own End turn,
  "Not done" and Turn picker for now.
- **Panel focus** (human): tabs show only `ready` and `used` actions for the
  phase; a used row keeps its confirm-before-repeat press. Reasons live in the
  button `title` and a `?` help dialog, never as paragraphs. Start of Turn
  sections show only while they can be done, or as a disabled `Used` row. A
  blocked Advance culture stays visible, disabled, with its reason (human: players
  could not find it with a full hand).

Source: `engine/src/assisted.ts`, `assisted-core.ts`, `culture-track.ts`,
`culture-hand.ts`, `server/src/routes/play.ts`, `assisted-args.ts`,
`web/src/views/AssistedActions.tsx`, `PhaseTabs.tsx`, `EndTurn.tsx`,
`YourCities.tsx`, `turnFocus.ts`, `HelpHint.tsx`, and the `assisted*` tests.

### Phase tabs and Start of Turn (part 13)

Tabs: Start of Turn, Trade, City Management, Movement, Research; the viewer's open
phase is selected first. Rules read from base rulebook p. 12–14 and 26–27, W&W
p. 9–10, F&F p. 8–13, FAQ 2.0 and the card sheets.

- **Playing a card is a log line** (human): a culture event or Great Person card
  that names a timing ("Start of Turn:", "Any Time:", "A / B") is listed in that
  phase ("Any Time" in every tab). Play removes the card (discard, or faceup in
  place for a Great Person without "discard this card") and logs who played it
  and whom it names. The effect is never applied, because other players can
  cancel it, except the automated cards below and in "Great Person automation":
  Khalid ibn al-Walid moves the start player marker to the player (board undo
  refuses that move alone), Marco Polo gains trade up to the ceiling, St. Francis
  3 culture per unbuilt army, Orville Wright draws an aircraft card. A Great
  Person whose figures are all blockaded cannot be played.
- **Start of Turn gate:** needs Start of Turn as the open phase and a usage key
  once per turn.
- **Social policies** (none under Anarchy): Expansionism 1 trade per city plus 1
  per city-state with the player's figure on it (human); Pacifism 1 culture, 2 with
  a scout on the map; Patronage spends 1 culture, draws an event of the marker's
  level and keeps one, and needs one advance first (human: the start space has no
  level); Rationalism spends 6 or 11 trade for a level I or II `TechGrant`, spent
  when the tech is revealed in Start of Turn. Learning is not researching: no
  coins keep trade.
- **Mysticism's** extra card applies to every culture card draw (advance,
  Patronage, Cristo Redentor) (human).
- **Government:** one change per Start of Turn. A government whose tech was
  revealed last turn or this Start of Turn (`techRevealTurns`) is direct; anything
  else goes through Anarchy, and from Anarchy any known government is direct. The
  Pyramids and Dr. Martin Luther King avoid Anarchy. Democracy +2 trade,
  Fundamentalism 1 culture per army on the map, Feudalism harvests a resource
  chosen from the tile data around a city (human).
- **Invest** (F&F p. 13): one coin per turn, only coin tokens (sheet and tech
  cards), never printed coins or a wonder's coins (human). The Arabs advance one
  space free; a Public Education threshold gives a free tech grant.
- **Founding a city:** a scout (an army under the Republic) founds it: at most 2
  cities, 3 with Irrigation; not water; all eight neighbours revealed; no hut or
  village adjacent (Zulu may, then explore it); no enemy figure adjacent; no city
  closer than three squares, diagonals included, anyone's; no relic adjacent; a
  city-state on the square is destroyed for 3 culture, one adjacent forbids it.
  Romans advance one space free. Growing a capital into a metropolis only scrolls
  to the map (human).
- **Scouts send squares** (human): a scout sends its square to one city for the
  turn, to the capital when not sent. The square counts for that city's
  production and trade, and its culture/resource icons are offered only to that
  city's Devote and Harvest; coin icons stay manual. The square leaves the city it
  lies in when sent elsewhere (also by the default). A capital grown into a
  metropolis has no capital marker: an unsent scout then goes nowhere and is
  offered to every city, with a note. An English army is only sent by hand.
- **Wonders, Great Persons, techs, huts and relics** (`assisted-abilities.ts`,
  `sot:<ability>`): Stonehenge, Colossus, Louvre, Lorenzo de' Medici and Alan
  Turing (counts Russia's white army in the supply, human) add their numbers;
  Sydney Opera House advances free; Panama Canal adds a coin to the wonder (not
  investable); Cristo Redentor draws two events of a chosen level; Statue of
  Liberty, the Teacher hut and Atlantis grant a free tech chosen in the tech tree;
  Seven Cities of Gold ask which investment card gets 2 markers, with no coin and
  no free Arab advance (human). Relics are taken in Movement by hand and claimed
  in any later Start of Turn by the player whose board history removed the marker,
  once per game (`unavailable` afterwards, not `used`); only Atlantis and Seven
  Cities have a button (human). Great Wall, Hanging Gardens, Taj Mahal, Big Ben,
  Machu Picchu, Plastics and Ecology only log, once per turn. Wonder obsolescence
  is not tracked (human).
- **Judgements not settled with the human:** a card over the hand size can still
  be played (base p. 18 says discard first); a passive Great Person with a timing
  word is listed and only turned faceup by "use"; a grant is spent by the first
  matching-level hidden tech revealed in Start of Turn; "a scout placed this turn
  gathers next turn" is told, not enforced; English armies gathering as scouts are
  offered by hand only; the same resource icon harvested twice in a turn is warned,
  not tracked; a scout on a city centre or a second scout on a square sends
  nothing.
- **Not built:** Great Person abilities needing a map marker, killing markers, map
  tile 16a, effects of played cards on other players, metropolis growth, a guard
  for the owner's board Undo against changes a vote undo made itself (it can bring
  back a token the vote removed; the record stays undone).

Source: `assisted-sot.ts`, `assisted-abilities.ts`, `assisted-city.ts`,
`assisted-cards.ts`, `card-timing.ts`, `sot.ts`, `city-founding.ts`,
`web/src/views/PhaseTabs.tsx`, `SotPanel.tsx`, `PlayableCards.tsx` and the `sot*`
tests.

### Great Person automation

Automated passive/triggered cards (Valmiki, Adam Smith, Susan B. Anthony, Louis
Pasteur, Archimedes) get a Use button that reveals the card; the effect is
active while faceup. Unimplemented passive cards get no such button.

- **Archimedes:** pays once after every player finished Research
  (`startMissingTurns`): 3 culture per tech researched that turn (`researchTurns`)
  that no other player has revealed. Hidden research is ignored on purpose so the
  public total cannot reveal it. Recorded per tech; taken back by `removeTech` and
  undoing the reveal. Hidden or fully blockaded gives nothing.
- **William Shakespeare:** Advance culture asks to use him when the next space
  holds another player's marker; yes sends `cultureAdvanceSkip` past every
  consecutive occupied space. Needs him revealed and unblockaded; normal undo.
- **Louis Pasteur:** +1 stacking limit for rule checks; the manual `stacking`
  value stays bookkeeping and is not rewritten.
- **Michelangelo:** discards and arms a one-shot 5-production discount on the next
  wonder; build undo re-arms it.
- **Thomas Edison:** discards and grants a free tech restricted to the named
  player's revealed techs.
- **Mother Teresa:** stays faceup; once per turn moves a chosen coin token to the
  named player's sheet and makes a free culture advance; both undo together.
- **Marie Curie:** discards and arms a chosen resource as the next Uranium spend;
  returning the token restores the arm. No current action spends Uranium.
- **Captain James Cook and Henry Ford** feed travel speed (see Figure movement).

Source: `packages/engine/src/great-person-effects.ts`, `actions/player.ts`,
`assisted-cards.ts`, `assisted-culture.ts`, `assisted-resources.ts`,
`build-options.ts`, `great-person-automation.test.ts`, `assisted-gp.test.ts`.

### Figure movement (#302)

The board stores free pixel positions, but own map figures move by
`travelFigure` (`/travel` route): a cardinal breadth-first walk up to the travel
speed, checking path, water and ownership, writing position and spent movement
in one board history entry so board Undo restores both. The stored turn number
refreshes the allowance next turn. Battle and loot stay manual (human).

- **Speed:** total of the manual `mvmt` expression. Revealed Natural Religion +1
  for an army outside Anarchy unless the expression already has a `+` term (older
  saves recorded `3+1`); Henry Ford +1 while faceup; Captain James Cook doubles it
  for the turn (`card:Captain James Cook` marker, freed by undo). Spain's bonus
  and tech speed steps stay typed. Group movement is out of scope.
- **Pool** (human): each travel adds to `movement.used`; the figure may move again
  while speed is left. It locks when the pool is spent or the move ends on a hut,
  village or another player's figures (`MovementDestination.ends`). Board Undo
  takes moves back one at a time.
- **Water:** Sailing, Steam Power and Flight allow crossing and ending in water;
  England crosses but cannot end there. An unknown (tile-back) square is not water.
- **Huts and villages:** a move must stop on one; with Flight it flies over, but
  may not end there (rule 283).
- **Stacking:** travel may cross or end on a square with fewer of the player's
  own figures than `stackingLimitOf` (Pasteur included); the limit is absolute
  (rule 50) and counts only the player's own figures (rule 51).
  `MovementPlayer.stackingLimit` defaults to 1; the server passes the real value.
- **Other players' figures** (human): an army may end on them (`contact: true`,
  shown red, asked first, logged as settled by hand; the engine starts and removes
  nothing). Without Flight they cannot be crossed (rule 52); with Flight they may
  be crossed or landed on. A scout never attacks (rule 431): never lands, crosses
  only with Flight.
- **Exploring:** a square with no tile is fog (tile back), never walked onto and
  never a card destination. A figure next to fog may `exploreSquare` (`POST
  .../pieces/:id/explore`): spends 1 movement, draws the next TILES card and lays
  it in the covering slot (rotation 0, turned by hand). It neither moves nor
  locks the figure; any lock forbids exploring. It fails without spending when the
  card has no artwork. The tile card goes to the hand like any draw, so board Undo
  (two presses: tile, then movement) does not return it; explore-undo-explore to
  see more tiles is accepted for now (the draw line can be undone by vote).
  Test helper `coverMap` lays tile backs so older tests see no fog.
- **No gates:** `/travel` and explore have no phase or turn-holder check, matching
  the shared board. Freeform drag of one's own map figure is disabled in the UI;
  `movePiece` remains the manual tool for setups and off-map pieces.
- **Scout gathered squares** (rules 198, 257, 334, 341, 422–424): gathering reads
  the scout's current square and no icon use is recorded, so a scout moved in City
  Management gathers where it ended. The trade phase is not re-run.
- **Communism** (Spy, Movement phase): stamps a chosen square as locked for the
  turn; `communismLocksOf` derives locks from applied records (no saved field),
  public in `PlayerView.communismLocks`. Figures may enter but not leave a locked
  square in every movement path; a figure may be locked on water. A confirmed
  second use with another Spy is allowed.
- **Brandenburg Gate** (rules 209–214, 333): outskirts of every city of the owner
  (human) and city-states the owner holds are closed as an *ending* square for
  other players' figures in every movement path (group cards judged by the moved
  figures' owner); crossing is allowed; the centre is not outskirts. Disabled,
  unowned or blockaded on its own square: no effect. Not modelled: the Spy
  exception (rule 214) and the obligation to leave. Derived and public
  (`PlayerView.brandenburgZones`).
- **Not done:** automated battle, loot and figure removal.

Source: `engine/src/movement.ts`, `board.ts` (`PieceMovement`), `actions/board.ts`
(`travelFigure`), `explore.ts`, `actions/explore.ts`, `actions/draw.ts`
(`drawTileAt`), `communism.ts`, `assisted-communism.ts`, `brandenburg.ts`,
`server/src/routes/board.ts`, `web/src/views/BoardView.tsx`; tests `movement`,
`stacking-movement`, `explore`, `communism`, `brandenburg`, `assisted-gather`.

### Movement cards: Galileo, culture cards, Hannibal and Steam Power

All use the shared card map picker (`MapPickerContext`, as Build) with squares in
the `playCard` payload. The card and every moved figure are one assisted action:
board Undo refuses the moves (`BOARD_UNDO_ASSISTED`), the undo vote restores
positions and the card/resource, and undo is refused once a moved figure has been
moved or explored since. "Empty" means unofficial rules 61–63 (`empty-square.ts`):
no figure, building, Great Person, wonder, city-state, city, hut, village or relic
token; a disaster or other resource token does not block; a metropolis blocks
both squares it covers.

- **Galileo Galilei:** all the player's figures in a source square move to an
  empty outer-edge square (a square with a cardinal neighbour that is not a
  playable map square, including holes and steps). A source already on the edge
  may name itself (rule 332). No terrain or stacking gate. Moved figures are
  locked (`movement.reason: 'galileo'`).
- **Steam Power** (City Management, spends a Silk; text from card art): all
  figures in one square move to any explored water square and are locked
  (`'steamPower'`); a water source may name itself (rule 193+). Stacking limit
  applies; armies may land on other players' figures (manual battle), a group with
  a scout may not (rule 196). Communism-locked sources and Brandenburg outskirts are
  refused.
- Galileo and Steam Power refuse a source holding a figure either already moved
  this turn, rather than leave it behind.
- **Movement culture cards:** Migrants (2), Colonists (4), Immigrants (6) move one
  own figure by ordinary travel rules (asking which figure when several);
  Disoriented (2), Lost (3), Out of Position (4) move every figure of one other
  player in a square (the source names the target; no water at all, as printed).
  Destinations must be empty. They cross like travel: own figures while stacking
  room remains (the target's limit for group cards), others' only with Flight
  (human). They ignore and do not set the travel pool (rule 276); figures locked
  by Galileo or Steam Power cannot be targeted (rules 255, 287, 330). Their City
  Management policy-switch ability stays manual.
- **Hannibal** (City Management): move any or all figures from a source to a
  different square already holding one of the player's figures, capped by
  `stackingLimitOf` minus figures there. Does not touch the travel pool; Galileo-
  locked figures are not offered.

Source: `engine/src/galileo.ts`, `card-movement.ts`, `empty-square.ts`,
`steam-power.ts`, `assisted-steam-power.ts`, `assisted-cards.ts`,
`actions/board.ts` (`moveFigureWithMovementUnchecked`), `assisted-core.ts`
(`CardSquare`), `web/src/views/mapPick.ts`, `PlayableCards.tsx`; tests
`galileo`, `card-movement`, `hannibal`, `steam-power`.

### Tech in the Research tab

The Tech content (pyramid, picker, hidden-tech controls) renders in the Research
tab after the playable cards, not as a collapsible panel (human). A viewer
without the actions panel (spectator) gets it in a plain `Techs` panel below
Your cards, since public pyramids are information; a player sees exactly one
copy. The Tech tree shortcut and tech links select the Research tab first.

Source: `web/src/views/PhaseTabs.tsx`, `TechPanel.tsx`, `GameView.tsx`.

### Spectator read-only controls

A viewer without a seat (`view.you === null`) gets read-only Board, Battle and
Social policy controls, like replay and locked games; the server's authorization
is unchanged. `BattlePanel` treats `view.you === null` as read-only even without
the prop. A spectator's board has no replay outline or wording.

Source: `web/src/views/GameView.tsx` (`BattlePanel`), `SocialPolicyPanel.tsx`,
`BoardView.tsx` and their tests.

## Reopening a phase (2026-10-23)

- **Reopen** marks the viewer's latest ended phase of the active turn not done
  (`/turns/undone`, `unmarkPhaseDone`). Nothing else moves: the active turn and
  who is waited for derive from done flags.
- It does not cascade: later ended phases stay ended, and the note says so.
- Only the active turn is offered (reopening a finished Research would pull the
  game back). The request carries `rev`, so a stale press answers 409.

## Toasts (2026-10-23)

- Every game-page action ends in a toast: green success (7 s, human), red failure
  (about 8 s or closed); hover holds it. The in-page error box remains only before
  the game loads.
- Green text comes from `GET /api/games/:gameId/confirmation?after=<revision>`:
  for revisions after the page's that the player made, their private log text,
  else the public line, else "Done". Revisions by others never count, even with a
  private line for this player, so another's action is never shown as theirs. The
  route reads by caller id and needs sign-in, so no other player's private text
  can be returned (`api.test.ts`). It is separate on purpose: the history list
  keeps public naming even for the owner.
- The client turns the viewer's own name into "you"/"your" with second-person
  verbs; the route returns the raw line. Fetch failure shows "Done" without
  failing the action.
- Toasts clear on leaving the game or signing out; both live regions stay
  mounted for screen readers.

Source: `packages/web/src/lib/toasts.ts`, `confirmation.ts`, `views/ToastRegion.tsx`,
`GameView.tsx` (`run`), `packages/server/src/routes/games.ts`.

## Trade offers (#265)

**Offers.** An offer is an explicit state record in the Trade tab, not chat.
Terms are free prose, never parsed or executed: accepting records an agreement
only, and players settle with the existing trade controls.

- Only the intended sender or recipients may perform each transition; revision
  checks and request ids make retries and competing writes deterministic.
- The public view shows participants, terms, turn/phase context and status, never
  request ids or effect data. Deals are public to every viewer, spectators
  included (`tradeOffers`).
- An offer goes to one, several or all other players. One recipient: accept,
  decline or counter. Several: each acceptance means "I would"; the sender
  chooses among acceptors (`choose`, `chosenId`); declined when all decline; a
  counter from one leaves it open for the others.
- A counteroffer is a new offer linked by `parentOfferId`, forming a thread.
- Pending offers expire when a later turn is observed; accepted offers never
  expire.
- The Trade tab shows the current turn's deals with buttons; the chat's Trade
  deals tab (`TradeDealsPanel`) shows all deals read-only by thread and turn.

**Trade number.** The Trade tab and Status share `stats.trade`; Status is the
master. The engine sets it at the rules' moments:

- When the next turn starts, a player who chose a tech during the ending turn's
  Research (`Playerhand.researchTurns`, private, including a turn marked ahead)
  drops to their coin total, capped at the track. Revealing is not required;
  ending Research without choosing keeps the trade. A free tech learned in Start
  of Turn is not research; removing a tech clears its marker.
- When Start of Turn is marked done (Trade begins), the trade around the cities
  is added once, capped at the track. The amount added is recorded in
  `PlayerTurn.tradeCollected` (never negative), so undoing Start of Turn subtracts
  exactly that. A player who marked the new turn ahead is caught up after the
  reset. Marking Trade done or reopening never counts again.
- A hand-set trade is the override: before collection it skips the addition;
  after it clears the record. `setPlayerStat` for trade writes `trade:set`
  (`TRADE_SET_KEY`). "This turn" is the game's current turn, so a player a turn
  ahead loses the marks at rollover.
- Only a turn saved before this rule, not yet collected, gets a guess
  (`tradeEstimateOf`).
- The track ends at 27, 25 for the Japanese (human; `tradeCeilingOf`, also Marco
  Polo). `setPlayerStat` refuses more (`TRADE_ABOVE_CEILING`); "Add N" never
  lowers a balance already above it. Other gains are not trimmed yet.

**Trade around cities** uses the production outskirts walk
(`CityProduction.trade`): printed trade icons (`tile-icons.json`, read by eye,
unchecked), a building's or Great Person marker's trade in place of icons
(Artist 1, Humanitarian 1, Scientist 2; `great-person-data.ts`), nothing for a
blockaded or wonder square. A square shared by two own cities counts for each.
A scout's sent square counts for the receiving city (#292), read like outskirts
but never blockaded; nothing counts twice, and the owning city loses it. Never a
complete count: governments, techs, policies, wonders, card abilities and trade
limits are not counted, and the notes say so.

Source: `packages/engine/src/trade-offers.ts`, `trade-estimate.ts`,
`trade-collection.ts`, `city-production.ts`, `tile-icons.ts`, `limits.ts`,
`actions/turn.ts`, `actions/new-turn.ts`, `actions/player.ts`, `state.ts`, trade
routes in `packages/server/src/routes/games.ts`, `web/src/views/TradeOffers.tsx`,
`TradeDealsPanel.tsx`, and the API tests.

## City production

`cityProductionsOf` estimates production from the board and revealed cards only,
so every viewer gets the same figures (`cities` is public). It is never a
complete count; a hand-set `BoardPiece.productionOverride` (any player, 0–99,
board-undoable) always wins.

- Outskirts: forest 2, mountain 1, else 0 (human; forest matches base p. 26). A
  building replaces every icon on its square (p. 16) with `building-data.ts`
  values (the human's table). A Great Person marker replaces terrain (Builder 2,
  Humanitarian 1, Scientist 1). A wonder square counts 0, noted. Enemy figures
  blockade.
- Added per city: Infrastructure (`stats.infra`, max 3), Despotism +1, Chichen Itza
  +3 (owned, unblockaded), Susan B. Anthony +2, Military Science +1 per 3 coins. A
  Building Program marker doubles only the outskirts (W&W p. 7). Communism, Urban
  Development, Great Lighthouse and one-turn cards are noted, not computed.
- A square in two own cities counts for each, noted (legacy data; cities cannot
  overlap when built).
- An off-map city piece is not listed, so the status city count can exceed the
  list.

Source: `engine/src/city-production.ts`, `building-data.ts`, `blockade.ts`
(`cityFootprintsOf`), `actions/board.ts` (`setCityProductionOverride`),
`web/src/views/CityCard.tsx`, `YourCities.tsx`, `city-production*` tests.

## Assisted build

`buildOptionsOf` (own view only) lists what each city may build and where; the
`build` action places, pays and logs in one step and the vote undo reverses it.
It covers buildings, wonders, figures (placed) and military units (private card).

- Only legal choices are listed; the rest appear under "Why not the others" with
  a reason. Cost above production is such a reason; the way out is a hand-set
  production (human). Rush (p. 15): 3 trade per production (Americans 2 per 3),
  whole steps, never more than needed.
- **Unit cost** (p. 15–17, tech sheet Military Unit table): 5/7/9/11 by level,
  aircraft 12 with Flight. The level is the higher of the hand-set status value
  and the revealed techs (`UNIT_LEVEL_TECHS`: Chivalry, Democracy, Mathematics,
  Logistics → II; Railroad, Gunpowder, Metal Casting → III; Combustion,
  Replacement Parts, Ballistics → IV). The first reveal raises the status value,
  never lowers it, as Flight ticks Aircraft. Unrevealed techs count for nothing.
  Card effects on unit cost (Leonardo's Workshop) are not applied; the player
  covers them with a hand-set production.
- A building needs a revealed tech (`BUILDING_TECH_UNLOCKS`, the human's sheet).
  Once the upgraded form is unlocked only it is built, and its tech alone suffices
  (p. 22).
- Squares: own outskirts, never a centre or city-state, terrain allowed by
  `BUILDING_TERRAIN`, nothing built (see Replacing), no enemy figure (p. 27). The
  terrain table is advisory for manual placement and binding for Build; a wrongly
  read tile is worked around by placing by hand.
- One limited building per city (Market/Bank, Temple/Cathedral, Barracks/Academy;
  p. 16–17), counted over its outskirts whoever built it. Supply is the shared
  pool in `board.ts`. A shared square of two own cities may allow a second; no
  ruling found, not handled.
- A Building Program marker on the centre is used up by any build and restored by
  undo. Production used: hand-set, then doubled, then estimate.
- One action per city per turn (p. 15, human): Build, Start Building Program,
  Devote and Harvest count; Upgrade does not. A second asks and sends
  `confirmedRepeat`; without it the engine refuses (`used`, 409) after all other
  checks. A confirmed one is logged as such. Undone actions and earlier turns do
  not count (`cityActionsTakenThisTurn`, `CityActionOptions.actedThisTurn`).
- Placement is by tapping the square without Confirm (human), except a square with
  a note (enemy figure, replacement), which needs Confirm. Units keep Confirm. Rush
  trade is paid at the tap.
- **Take-back** (human): while City Management is not marked done, the owner
  removing a piece a build or Start Building Program placed (even if moved) runs
  `takeBackOpenBuild`: same effect as the vote undo plus a System line ending "It
  was removed before End turn."; the build line stays (deleting log lines would
  renumber board history counts). It closes any open undo vote on the line and
  sets `board.undoFloor`. After End turn, for older turns or another player's
  removal it is a plain removal with no refund. Upgrades and units are not taken
  back this way.
- **Wonders** (p. 17): any city may build a faceup market wonder (unowned pieces
  in the shared Wonders area, `marketWondersOf`). The cost (printed, or discounted
  with a revealed tech; `wonder-data.ts` equals the `Wonders` sheet by test) is
  **enforced like a building** (human, 2026-10-30, replacing "shown, not
  enforced"): rush trade is paid, refunded on undo; hammers from cards and Great
  Persons count through a hand-set production. Where the sheet and the tech cards
  (`public/help/Civ_Tech_FF-WW.-2.jpg`) differ, the cards win (human): Angkor Wat
  is 15 with Philosophy (`SHEET_CORRECTIONS`). Placed in outskirts on any non-water square, empty or
  holding the player's own building/wonder/Great Person, no enemy figure; one per
  city, not counted as the limited building. The market piece moves onto the
  square and gains its owner (two history entries).
- **Next market wonder** (human): the build draws the next wonder: ancient deck
  until four ancient are out, then medieval, then modern; "out" counts cards that
  left the deck, so removing a piece from the board frees nothing; nothing after
  twelve. Drawn as its own System line, guarded from board Undo. Vote undo and
  take-back return the wonder to its market spot, clear the owner, put the drawn
  wonder back on top of its deck, and floor board Undo. The vote undo is refused
  once the drawn wonder left the market or has an owner; the take-back then is a
  plain removal.
- **Replacing** (p. 17–18, human): a building or wonder may be built on the
  player's own building, wonder or Great Person (outskirts pieces count as the
  city owner's). The old piece is removed first (`removeReplaced`, own history
  entry), then legality is checked. A building returns to supply; a wonder is
  destroyed for the game (never re-enters market or deck); a Great Person goes to
  reserve. Another player's wonder or a city-state blocks the square. With one
  wonder or limited building already in a city, a new one may only replace it
  (`onlyReplacingOf`). With no supply left, a building may replace one of the same
  supply group (`sameSupply`). Replacing an identical building is allowed.
- **Great Person replaces, not covers** (p. 18, chosen by the human over his first
  description): placed on a building/wonder it removes it (building to supply,
  wonder destroyed). A replaced Great Person goes to the owner's player area in
  reserve, without effect, re-placeable by hand at any start of turn. Removing a
  marker later restores nothing. A manual drop arriving in the outskirts of the
  placer's city (`replaceUnderGreatPerson`, from `placePiece`/`movePiece`; nudges
  and re-drops on the same square replace nothing) removes the building/wonder and
  reserves any other Great Person as separate board-undoable entries; another
  player's wonder is left alone. Destroying a wonder by drop is confirmed first
  (`piecesReplacedByGreatPerson`) on every input path. A building dropped by hand on
  a Great Person is not automated.
- Vote undo and take-back restore the replaced piece exactly (`replaced`,
  `reserved`); board Undo cannot undo the removal alone. Known gap: a take-back
  restores the old piece even if another was placed there by hand since.
- **City Walls** (p. 17, Masonry, 7 production): a centre building with no square
  (`placement: 'none'`) that flips the city marker to its walled asset via the
  `flip` board change (same id and centre), one per city. The defensive +4 is not
  counted. No take-back by removal; the vote undo flips back.
- **Figures and units** (p. 15–17): army 4, scout 6; units by type level
  (`stats.infantry/artillery/mounted`, clamped 1–4): 5, 7, 9, 11; Aircraft 12 with
  revealed Flight. Figure squares: outskirts, never centre or city-state, water
  only with Sailing/Steam Power/Flight, below `stats.stacking` (read-only, default
  2), supply 6 armies and 2 scouts per colour. A scout is not offered a blockaded
  square; an army is, with a note that the outcome is manual. Hut/village squares
  are never offered (human; inert in practice since cities cannot be founded next
  to them).
- A unit card is drawn like Draw (reshuffling discards when empty) hidden into the
  hand; the public line names only the type and no item line is written. Undo
  returns it and reshuffles that unit deck so the next card is unknown (human); a
  build-undo-build may draw differently, accepted.
- **Start a Building Program** (W&W p. 7): free city action in open City
  Management, one marker per city (either metropolis centre counts), placed on the
  anchor centre. Its undo is refused while the marker is used.
- **Upgrade** (p. 22): flips the player's basic buildings of a family once the
  upgraded tech is revealed. The player's buildings are those in own city
  outskirts (`cityFootprintsOf`, never `placedBy`). No cost, no phase gate, by
  button only. The flipped piece keeps its square, centre and original `placedBy`.
  Undo restores original ids on top of the stack (z order not restored). Known
  gaps: a square in two players' outskirts lets both list it (first press wins);
  the record's `phase` reads CM when every phase is done.
- No automatic city-action-used marker for the phase: the player ends City
  Management themselves (human).

Source: `engine/src/build-options.ts`, `city-actions.ts`, `building-data.ts`,
`wonder-data.ts`, `assisted.ts` (`build`, `startBuildingProgram`,
`upgradeBuildings`, `takeBackOpenBuild`), `actions/board.ts`,
`server/src/routes/board.ts`, `web/src/views/BuildPicker.tsx`, `CityActions.tsx`,
`buildFlow.ts`; tests `assisted-build*`, `assisted-wonders`, `assisted-walls`,
`great-person-replace`, `BuildPicker.test.tsx`.

## Devote to the Arts and Harvest

City actions `devoteToTheArts` and `harvest` on the assisted contract.
`cityGatheringOf` reads from the board only; `cityActionsOf` adds status and the
projection carries it in `you.cityActions`. Payloads are parsed strictly.

- **Icon data:** resource icons and natural-wonder culture are recorded in
  `engine/data/tile-icons.json`, read by eye from tile images (base p. 7 key), in
  printed orientation (`squareIconsOfCell` undoes rotation). Unchecked against a
  printed list; manual paths remain. A tile with no entry is unknown, not empty.
- **Devote** (p. 17; metropolis base 2 from F&F): 1 culture (2 metropolis) plus
  each outskirts square's culture: a building's `building-data.ts` row, a wonder 1/2/3
  by era (`WONDER_CULTURE`, also when obsolete), a Great Person marker (Artist 2,
  Merchant 2, Humanitarian 1), each replacing printed icons; else a natural wonder
  icon. Enemy-occupied squares give nothing. Civ, government, tech and card effects
  are not counted (named in the panel). The player may type another number (0–99,
  `MAX_DEVOTE_CULTURE`), logged against the estimate.
- **Urban Development** (human's reading): +2 culture when the city's outskirts
  hold at least two different kinds of buildings/wonders (two Temples count once, a
  wonder always counts, Great Persons and blockaded squares do not). Only a
  revealed policy counts, none under Anarchy (human). The sum is in the owner's view
  only (`hidden-info.test.ts`). Its production half is only noted.
- **Indians:** +1 culture per outskirts square with an uncovered, unblockaded
  resource icon when devoting.
- **Harvest** (p. 18): one token of a resource whose icon is in the outskirts goes
  to the player's area as `resources/<name>`. Blockaded squares give nothing. A
  resource under a building, wonder, Great Person or disaster token is covered
  (human, also for scouts); a disaster token also covers culture for Devote
  (human). Market supply is as many as players, max five; an exhausted kind is
  disabled. Angkor Wat's second harvest is not built. Harvesting one icon twice a
  turn (FAQ) is not tracked, only noted.
- **Scouts** (p. 26): a scout outside the city's outskirts is offered with its
  square's culture/resource and what stands on it, read with no blockade, for the
  city it is sent to (see Phase tabs). Whether it was placed last turn is not
  tracked.
- **Undo:** Devote is refused when the culture has been spent; Harvest when the
  token left the player's area. Board Undo cannot take the token alone.

Source: `engine/src/city-gather.ts`, `tile-icons.ts`, `wonder-data.ts`,
`great-person-data.ts`, `terrain.ts` (`tileSquareAt`), `city-actions.ts`,
`assisted.ts`, `web/src/views/CityGather.tsx`; tests `assisted-gather.test.ts`,
`CityGather.test.tsx`, `assisted-city-actions-api.test.ts`.

## Accounts, mail and ratings

- Legacy SHA-1 accounts upgrade to scrypt on successful login.
- Password reset uses a separate derived signing key and expiring token;
  unknown-email responses must not enumerate accounts.
- Registration's fixed Writing answer is a spam speed bump, not a security
  boundary.
- Game creation sends no email. Ordinary notifications (including battle-turn
  mail) are held per player and game until the player opens the game; if not
  opened, one more may go after 24 hours. Opening re-arms the next message. Final
  messages are exceptions.
- Idle-turn reminders target a holder waiting over 72 hours, once per unchanged
  activity version; opening the game does not reset activity.
- Queued broadcasts keep indeterminate sends claimed until explicit resolution,
  with a release cooldown, to avoid duplicates. Respect opt-outs and current
  addresses at send time.
- Historical ratings use conservative available evidence; current results use
  board culture position and coins. Display scaling by 100 does not change the
  stored rating.

Source: `packages/server/src/auth.ts`, `routes/auth.ts`, `notifications.ts`,
`turn-reminders.ts`, `store/rating.ts`, and tests. README has operational
configuration and migration instructions.

### Caching and new deploys

- Content-hashed `/assets/` files are cached for a year (`immutable`,
  `packages/web/public/_headers`); `index.html` keeps the host default
  (`max-age=0, must-revalidate`).
- `vite build` writes a build id into the bundle (`__BUILD_ID__`) and
  `/version.json` (`no-store`); `UpdateBanner` offers, never forces, a reload when
  the deployed id differs (checked on visibility and every 5 minutes; off under
  `vite dev`). Id: `WORKERS_CI_COMMIT_SHA`, else `GITHUB_SHA`, else build time.
- Unverified until deployed: that `_headers` applies to the Worker's
  `env.ASSETS.fetch` responses.
- In development the web app imports the engine from `packages/engine/dist`;
  engine changes need `pnpm --filter @civ/engine build` (or `tsc --watch`) and a
  reload.
