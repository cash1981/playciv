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

- Engine reducers are pure and return errors as values.
- Hono runs on Node with JSON storage locally and on a Cloudflare Worker with D1
  in production. Render/Mongo hosting is retired.

Source: `packages/engine/src/`, `packages/server/src/app.ts`,
`packages/server/src/store/`, `packages/worker/src/`.

## Privacy, projections and logs

- Only owners receive private hands, notes and logs; opponents see counts and revealed information.
- Great Person placement exposes an anonymous slot, not the card name.
- Publicly derived coins/combat/culture limits use revealed information even for the owner, so private research cannot leak
  through a total. Public totals never include hidden bonuses.
- Undo descriptions must not reveal more than the original public action.
- Log-number keys are independent of the public RNG stream.
- Never reconstruct historical revealed cards by matching display names to a current hand: duplicate names and redraws can
  reveal private cards.
- **Item numbers** (human 2026-11-04): a plain count from 1, shuffled once per game, so a number says nothing about catalogue
  order or a card's place in a deck, and the same card has another number in another game. Items made later continue from the
  end; existing games keep their numbers. The number on a hidden tech or policy line is a keyed per-player permutation of the
  item number (short, 1-999 then by block of 999, unique within a player's view), so the same card differs between players.
- **Renumbering:** a card of a shuffled deck that goes back in the deck (reshuffled discard, undone draw or build) gets a new
  number, so a public discard or reveal cannot be matched to a later hidden draw or trade line. The number is a keyed
  permutation of `itemCounter` (`deckWith`, from 100000, no random numbers), not the next plain count, because a player sees the
  counter in a policy they choose and could predict a plain count. A reward choice keeps the cards it discarded
  (`effect.discarded`) so a later renumbering does not rewrite the Revealed and Discarded history; older records are named only
  while the card is still in the pile.
- **Log lines (#337):** every line that plays, draws, keeps, discards, replaces, gives, loots or places a card carries its item
  number; a played card and the cards its effect moves are numbered separately. Tech and policy numbers stay the per-player ones. A hidden card is named by number only in the
  public line and in full in the owner's private line; open information (played or discarded card, revealed or placed unit) is
  named in full with its number. The private log never falls back to the public line (the route drops empty private entries),
  so a line everyone can read is written to both (`appendOpenLog`, the played-card line).
- A log line that gains or spends trade, culture or coins gives the new total in parentheses after the amount ("gained 4 (14)
  trade", "spent 6 (8) trade to learn a level I tech"). A conversion shows each side's new total; undo lines do the same ("5 (3)
  culture removed"); a culture advance names what it spent; a free advance spends nothing.
- **Battlehand is hidden** (human, 2026-11-19): opponents and spectators get the number of units drawn
  (`numberOfBattlehandUnits`), never the units, until a unit is placed in the arena or the hand is revealed. Redrawing is
  allowed without revealing, because a draw can have the wrong number; each draw and redraw, also of 0 units, is a public log
  line so a redraw shows. Leonidas counts the number drawn.

Source: `state.ts`, `log.ts`, `coins.ts`, `combat-bonus.ts`, `culture-hand.ts`
under `packages/engine/src/`; privacy and projection tests under `test/`.

## Revealed and Discarded history

`revealedFeed` starts from the current public set (discard pile and non-hidden hand items) and keeps a row for every public
`DISCARD` entry, even after a reshuffle or a hidden redraw: the discard was public, and its row does not reveal where the card
is now.

- An assisted card play that discards without a `DISCARD` line (Great Person/culture play) and a card discarded by a reward
  choice (`chooseReward` plus the advance's drawn cards) are kept the same way. Such a row uses the assisted record's time and
  log position even if the card is still in the pile, so it sorts with its play line.
- A resource hut spent into the discard pile shows from the pile; huts are never reshuffled.
- A revealed card that leaves the public set without a discard vanishes; technologies/social policies are never added from the
  log.

Source: `packages/engine/src/actions/game.ts` (`revealedFeed`), `revealed-feed.test.ts`.

## Saves, migrations and revision chains

- Saves use compare-and-swap revisions. Private notes are omitted from replay snapshots; note writes may advance `rev` without
  adding a visible revision.
- Full keyframes bound delta chains. Unrecorded non-note changes seal the prior chain; compaction validates reconstruction, and
  cleanup keeps a standalone final keyframe before removing older dependencies. The historical full-snapshot backlog is
  converted and new saves use deltas; the admin interface no longer exposes compaction, but server-side conversion and legacy
  read support stay for any remaining historical revisions.
- `migrateGameState` must preserve an already-current state exactly, including JSON key order: stored deltas depend on it.
- Keep the historical board-change `clear` variant for replay/undo although the clear-board action is gone.
- Keep `legacyOrdersCopied`, `legacyRevealsCopied` and classic load-time adoption (saved data outlives the removed admin
  migration tool); `yourTurn` still carries started-state compatibility.
- Trade offers saved with one `recipientId` are read as a list of one.
- Do not rename already-applied duplicate-numbered `0004` SQL migrations. Deployment/cleanup procedures are in README's storage
  sections.

Source: `packages/engine/src/migrate.ts`, `packages/engine/src/board.ts`,
`packages/server/src/store/revision-chain.ts`, `packages/server/src/revision-delta.ts`,
`packages/server/test/revision-delta.test.ts` and Worker migrations.

## Timeline and turns

- The chat/orders timeline is the only mode, for running and finished games.
- Turn state derives from phase completion and the start marker.
- Out-of-turn draws require explicit confirmation.
- The explanatory order row is posted after the authoritative game-state commit and can fail independently; do not roll back or
  blindly repeat the committed action.
- Only the timeline is height-capped (screen minus about 40rem, between 8rem and 32rem); thread and composer are not, so the
  page grows. A cap on the thread let the composer overflow and hide End turn and Send. Guarded by the stylesheet test in
  `ChatOrdersPanel.test.tsx`; retune 40rem if the composer changes size.

Source: `packages/engine/src/turn.ts`, `packages/server/src/routes/play.ts`,
`packages/web/src/views/ChatOrdersPanel.tsx`, `ChatOrdersPanel.css`.

## Board and manual bookkeeping

- New-game geometry is defined here: two-player 16×8, three-player pyramid, five-player holed 28×18. Pre-shape three-player
  saves with pieces and five-player saves keep their old rectangle so pieces do not move; see
  [legacy layout limitations](limitations.md#game-behavior).
- Culture track: 21 positions with freely placed markers.
- A civilization revealed before the table is full is laid out while every seat is still number 0, so its starting tile lands
  in the first corner. When the game starts and seats are numbered, such tiles move and turn to their owner's corner (a system board
  change, so nobody's Undo reverts it); otherwise a later player's tile was drawn underneath and looked missing.
- Board undo targets the caller's latest consecutive actions; a new board action clears redo. Undoing board edits does not undo
  game actions.
- A moved piece keeps the pixel position where it is dropped, also in a player area. A new palette piece in a player area tidies
  into the next free slot (keeps collected huts in a row).
- Each colour has six armies and two scouts. Russia gets one extra white army and Spain one extra white scout
  (`whiteFigureFor`), supply one each. Revealing the civ puts it in the player's area; only that civ's player is offered or may
  place it (`BOARD_ASSET_CIV_ONLY`); undoing the reveal takes it back. In blockade and City-state 4 rules a white figure counts
  as its civ's colour. Russia revealed before this rule gets no automatic army. Spain's extra scout is the human's ruling (the
  card says only "start with 2 scouts"). White scout art and manifest entry come from `tools/board-assets.ps1`.
- Revealing a civilization does not need the turn (human): starting units are drawn with `confirmedOutOfTurn`, so any seat may
  reveal in any order, also after an undone reveal.
- Terrain checks are advisory client warnings, not server placement restrictions.
- A disaster token decides its square's terrain (human): Drought desert, Forest forest, Grassland grassland, Water water, for
  building terrain, production, city founding, where a figure may stand and placement warnings (`terrainAt`; newest token wins;
  a token on a facedown tile leaves it unknown). It also replaces the printed trade (Drought and Water 1, Forest and Grassland
  0); a building or Great Person on it gives its own.
- `stats.aircraft` (default false) means Aircraft is unlocked. First reveal of Flight ticks it; anyone may toggle it; it is not
  cleared when Flight is removed nor enforced when drawing Aircraft.
- Metropolis sprites are 170×82 px to cover two map routes; keep image size and manifest dimensions aligned
  (`tools/board-assets.ps1` normalizes them).
- Government selection and tech-pyramid placement are permissive bookkeeping unless a specific effect is automated. Change
  generated data through its generator/source, never by patching to encode a rule. The Military Tradition/Pacifism pairing is
  corrected by parsing and migration.
- The owner deliberately commits FFG piece/card artwork to this public repository, acknowledging it redistributes copyrighted
  artwork. Deleting files would not remove published copies from Git history; reversing this needs a separate, explicitly
  authorized history-cleanup decision.
- **Player status sidebar (#342):** a view beside the map (under it at 900px and below) shows every status value per player with
  an icon whose `alt`/`title` names it, built only from fields the old panel showed (`username`, `color`, civilization name,
  `government`, `stats`); it adds nothing to `PlayerView`. A hidden civilization shows a colour swatch, not a leader marker.
  - Tap a value to edit it (shared validation `parseStatInput`); Aircraft is a switch; Government is a select whose `?` opens the
    government card reference. Coins total, Culture hand size and Combat stay read-only; the per-source Coins counters live in
    the **Coins** panel (`CoinsPanel`, collapsed state `civ.panel.coins`).
  - Spectators, replay and locked games get no edit controls (the government is text, `?` still works); controls are disabled
    while a save runs. An untouched editor never saves, so a value another member changed during a refresh is not overwritten.
  - At 900px and below the sidebar can be minimised ("Player overview", remembered under `civ.panel.player-status`, default open);
    beside the map it is always fully shown.
- **Display settings (#342):** a gear in the Board header opens sliders for map zoom (25-150 %, with an Auto switch), status icon
  size (70-150 %) and status panel width (14-24 rem; no effect at 900px and below), plus an "Icons per row" setting (1-4, Auto
  by default; `sidebarColumns` → `--pss-columns`) and a "Show labels" switch (on by default; settings saved before it existed (a stored explicit off is kept)
  get labels on). Values are kept per browser in `localStorage` under `civ.display`; nothing is stored on the server. Stat groups
  use CSS `auto-fit` columns that scale with icon size (a group has four stats, so four is the most). Auto zoom snaps to the old
  fitting steps (capped at 100 %); only a manual choice is continuous. Visible labels of the four investments are abbreviations
  (EftA, Infra, MIC, PE); tooltips, alt text and accessible names use the full names.

Source: `packages/engine/src/board.ts`, `actions/board.ts`, `terrain.ts`,
`actions/player.ts`; tests `white-figures.test.ts`, `undo-civ-reveal.test.ts`,
`player-action.test.ts`.

## Coins, cards, wonders and blockade

- Wonder ownership and bonuses do not depend on the piece staying in the shared Wonders area. Disabling a wonder clears its
  owner, keeps the piece, marks it `disabled` (greyed, blockade cross) and grants no owner benefits; assigning an owner
  re-enables it. Its culture token is unaffected. Assigning and disabling are public log lines.
- Panama's coins belong to the physical wonder and count for its active, unblockaded owner.
- Bank, Great Person and Adam Smith effects derive from board ownership and revealed cards; `placedBy` is never city
  ownership. The Coins panel lists Adam Smith only while his card is revealed and usable.
- Metropolis outskirts are the ten squares around two centres, excluding both.
- A Great Person with no tracked matching token is not assumed blockaded (compatibility with existing games).
- Frank Lloyd Wright counts building pieces on map squares in the outskirts of the player's own cities (none without a city);
  trade is capped at the track ceiling, as for Marco Polo, and undo clamps at zero. Albert Einstein turns a chosen whole
  amount (1 to what the player holds) either way; culture into trade is refused beyond the trade ceiling (his form offers only what the track has room for). Undoing
  Einstein is refused when the resource he gave was spent or giving back would pass the trade track. Both are City Management
  cards.
- Andrew Carnegie banks `floor(coins / 3)` free advances (`freeAdvances` for turn `freeAdvancesTurn`, own view only), capped
  by the spaces left on the track; refused without a leader marker.
  - The Advance and Shakespeare buttons spend one per advance instead of the price, in that turn's City Management only, one
    space at a time, so the usual stops apply (card choice, Mysticism discard, hand size, the deck).
  - Unspent advances lapse with the turn; Carnegie gives free advances once a turn, so the bank is never mixed with another grant. An undone advance returns its free
    advance to its own turn's bank only; the card cannot be undone once one is spent.
- A Great Person kept after use is used once: while its play is applied and the card is faceup the hand shows "In effect"
  with no Use button, and a second play is refused. William Shakespeare is in effect as soon as he is faceup (his skip is a
  choice of the advance buttons). Undoing the play brings Use back.
- Jim Henson keeps wound markers as `hensonWounds`: a wonder built with him faceup (type not blockaded) adds one (public
  line), undoing the build removes it. His Start of Turn button gives that much culture and trade; no Play button.
- Jacques Cousteau builds 1 to 3 Harbors for free in Start of Turn on empty water squares in the outskirts of the player's
  cities (no unlock or production needed; no one-per-city limit, as the card names none; no replacement). The player picks squares from the engine's list and the card is discarded; one undo removes
  them.
- Jerry Garcia devotes every city of the player in one play, for the culture the board gives each city (scouts' squares not
  sent), as the capital's city action: the capital counts as having acted ("Devote to the Arts (Jerry Garcia)"); other cities
  may still act with no question. A capital is a `capital` piece or a metropolis; without one the play is refused. A card play
  has no second-action question, so a Garcia play on a capital that already acted is not refused or asked about; the log says
  so, or says the action came from Ada Lovelace when her credit is left.
- Ada Lovelace is an "extra city action" credit: a city action that is not its city's first, taken after her play, carries her
  play's id (`lovelaceCreditId`). While a play of hers this turn has no such action, a city's second action needs no question
  (`extraAction` on the city options, own view) and the log says it came from her. A second action confirmed before she was
  played uses no credit; undoing an action frees only its own credit; her play cannot be undone while an action carrying its
  id is in force. Anarchy is not enforced for the capital, so her anarchy clause needs nothing.
- Every extra city action goes through `extraCityActionFor` (`assisted-core.ts`) for the question, log line and credit used.
  Order: Atomic Theory (a city that has acted once), Monarchy, then the cards.
  - **Monarchy** (human, 2026-11-14): the capital of a player under that government takes one more action each turn with no
    question, but not the same action as its first (a Garcia devotion counts as a devotion). The same action again is refused
    with no confirmation to lift it (the card forbids it); a third action and any other city's second action are asked about
    as before. Playing Jerry Garcia is refused by the same rule in either order, so the card stays in the hand; outside
    Monarchy it plays with a note when the capital had acted (human, 2026-11-14).
  - Atomic Theory and the cards do not stack on Monarchy: one extra action, not two. Monarchy is derived from the government
    (no record, no undo) and comes before the cards so the free action uses no credit.
  - **Supply Drop** (human, 2026-11-14) is a credit like Ada's, but counts only when played in City Management (its Start of
    Turn timing gains 7 trade) and only for a non-capital city; Ada's stays for the capital. A non-capital city uses a Supply
    Drop credit before an Ada one.
- Akira Kurosawa, faceup and not blockaded, pays his holder 1 culture for every city another player devotes (also each city of
  Garcia's play), in the same log line; the holder's own devotions pay nothing. Undo takes the culture back as far as it is
  still there, and the undo line says when it was spent.
- Charles Darwin, faceup and not blockaded, adds a box to Devote to the Arts (`darwin` on the option): the city's culture (or
  the typed number) becomes the same amount of trade up to the track end, once a turn (`person:Charles Darwin` on the turn
  record). Undo returns both and frees him; blocked if that trade was spent. A devotion changed by Darwin or Kurosawa names
  the card play behind it (`darwinActivationId`, `cardActionId`), and that card play cannot be undone until the devotion is.
- A. P. Giannini, faceup and not blockaded when the coin is invested, gives a free building: the `invest` effect carries
  `giannini: true` and the Start of Turn action `gianniniBuild` (once a turn, usage key `giannini`) builds it. Invest is once a turn, so he gives at most one building a turn.
  - Choice and placement are as in Build: unlocked buildings (a basic building whose upgrade is unlocked is left out) on a
    square Build would offer in a city's outskirts; star buildings (Market, Bank, Temple, Cathedral, Barracks, Academy) are
    once per city and replace the city's; a building may replace one of the player's own (a Great Person goes back to the
    player area). No cost, no production. It is not a city action: no second-action question, no Ada credit.
  - Board Undo refuses the placement, like Cousteau's Harbors. Undoing the investment, or the play that turned him faceup, is
    refused while the building stands. Undoing the building puts back what it replaced and works when the piece was removed by
    hand, so the investment is never stuck, provided the old piece can stand again (square free, no other star building in the
    city); refused when the piece was moved or replaced by a later build, upgrade or free building still in force.
- Frida Kahlo discards the culture cards the player ticks (none allowed) and draws up to the culture hand size from the deck of
  the area the culture marker is in, the level Patronage uses (a Great Person space and the last space are in an area; only the start space has none: refused, card stays).
  - With Mysticism each place is a draw of two with one kept, a pending choice each (`<request id>`, `<request id>:2`, as
    Cristo Redentor does); she waits for an earlier choice. An empty deck reshuffles the discard pile, which can deal a just
    discarded card back.
  - The public line names each discarded card in full with its item number and gives drawn cards by number only; the private
    log repeats both in full, so an opponent can later check nothing was swapped (human 2026-11-04; with Mysticism the choice's
    line names the card not kept). Discards go to the public discard pile and the Revealed and Discarded list.
  - Undo returns drawn cards to the deck (also after the choices) and discards to the hand; refused when a kept card has left
    the hand or a discard has left the pile.
- Nikola Tesla (human, 2026-11-03, #301) is played in Research on a tech of level II, III or IV added in this Research phase
  (`researchTurns`) and shows it one pyramid row lower. The tech still costs its own level's trade (II 11, III 16, IV 21; 3
  less for the Japanese, see "Japanese research discount").
  - The move is the manual `setTechSlot` (`withTechSlot`): `level` stays, the row changes. Not stated by the human: the row
    below must have a free place (5, 4, 3, 2, 1 techs from level I to V, Newton's placed Great Person counting) and a tech
    already moved by hand is not offered.
  - The public line only says a tech was placed one level lower (it may be hidden); the player's log names it. Undo restores
    the row; refused when the tech was moved again or removed.
- Cancellation (#301, #336; human, 2026-11-05) takes effect at once as an event in `cancellation.ts`. There is no dispute,
  response window, pass or pause: players are trusted to wait for each other (human). Gameplay, chat, notes and orders are
  never blocked.
  - Twain targets another player's city action or culture event; Jousting Tourney and Primetime TV target culture events;
    Bread and Circuses requires actual targeting of its holder or a recorded moved figure of theirs (targeting a cancellation
    card does not target its owner). Unstructured square/building targets stay manual. Printed texts are in
    `gamedata-faf-waw.json`; no local rulebooks were available.
  - Tech cancellations (human, 2026-11-14): Writing (city action), Civil Service (culture event) and Mass Media (resource
    ability) cancel like Twain but pay with a Spy instead of a card: a hand token or a culture card playable as one (A Gift
    from Afar), chosen by the player; a Spy that is only a board piece is refused. The tech must be revealed, unused this
    turn, and the Spy held both before the target and now (the cost is paid after the rewind). They are made from the log
    (`POST /cancellations` with `tech` and `payment`), never as an assisted action.
  - Who stops what: a culture event by Jousting Tourney, Primetime TV, Civil Service, Twain and Bread and Circuses (when aimed
    at the holder); a city action by Twain and Writing; a culture card's event by Jousting Tourney, Primetime TV, Civil
    Service and another player's Twain; a tech's event (resource ability) by Primetime TV, Mass Media and another player's
    Twain. A counter spends the cancelled event's Spy again, so a countered tech event loses the Spy.
- Resource abilities (human, 2026-11-15): every recorded tech ability that spent a resource (production boosts, Pottery,
  Philosophy, Education, Horseback Riding, Mysticism, Gunpowder, Metalworking, Atomic Theory, Monarchy, Communism,
  Mathematics and Ballistics, Steam Power, Ecology, and the Incense cards Chivalry, Currency and Metal Casting;
  `resourceAbilityOf`) can be cancelled from the log by another player's Twain, Primetime TV or Mass Media (a Spy). Writing,
  Civil Service, Jousting Tourney and Bread and Circuses cannot. A free ability (healing, Bureaucracy) is not one.
  - A cancelled ability keeps its cost, as a cancelled culture card stays discarded: the rewind returns its resources and they
    are spent again (same tokens or cards; a map piece removed again), and the tech counts as used this turn (Mass Media: "the
    resources spent to activate that ability are lost"). A counter rewinds to before the cancellation, so nothing is spent
    twice.
  - A cancelled use keeps holding the turn's usage key even if the first use of a confirmed repeat is undone later, and a
    Marie Curie substitute it consumed is not armed again.
  - **Mass Media's "your culture events cannot be canceled"** (human text "regardless of other game effects") is enforced in
    `cancellationRefusal` (`twain.ts`): a revealed Mass Media makes its owner's culture-card events an invalid target for every
    canceller, in the list and on submit, with nothing paid. A hidden Mass Media does not shield (it is private and not in play); nor does it shield a city
    action or resource ability.
- Cancellation edge cases (2026-11-15):
  - Dr. Martin Luther King protects a city action taken while he was faceup and unblocked even if he has since left the hand
    or been blockaded (`kingFaceupAtAction`; older records use the saved game before it), as the rewind would bring him back.
  - Only Ada Lovelace's extra city action is immune; a Supply Drop action can be cancelled and still uses up its Supply Drop
    (that play cannot be undone and gives no further action).
  - Bread and Circuses reads figure owners recorded when the card moved them (`cardMove.owners`), so later removal changes
    nothing.
  - Board history entries made after a rewind (a cancelled ability's resources removed again, the collected icon of the
    canceller's Spy) are recorded as `keptHistoryIds` and board Undo refuses them.
  - A counter keeps what was written by the turn of the game it returns to, so earlier turns' orders are never reopened.
- United Nations (human, 2026-11-14): culture events cannot target its owner against their will. The game cannot ask, so
  playing a culture event that names an owner (a chosen target, or every other player) or moves an owner's figures
  (Disoriented, Lost, Out of Position) needs the player's confirmation that each owner agreed (`consents`); the log says "with
  the agreement of X (United Nations)". A blockaded wonder protects nobody. No in-game approval request exists.
- Counters act on the latest event only, by an event of their own, and rewind to the saved state before it: Jousting Tourney
  and Primetime TV counter a culture cancellation; Twain counters another player's culture cancellation (it cannot itself be
  culture-countered); King is protection: he undoes a cancellation of his holder's city action, is revealed (public) and
  **keeps Twain in hand**, as the human chose. Garcia's devotion and Lovelace's extra actions keep their printed exclusions; a
  faceup King makes his holder's city actions uncancellable. Every card played is spent exactly once, except Twain when King
  protects.
- Cards are checked against the saved baseline and the live hand (reward candidates, blockade, ownership). Inactive games
  cannot take a cancellation, admin participants included; committed-request retries are idempotent. Spectators are read-only,
  including game chat; admin chat moderation remains.
- A cancellation restores the exact before-action revision, keeps the cancelled city's action spent (or discards the target
  culture event), spends the cards played and reshuffles changed decks once (a counter reshuffles nothing). Later gameplay
  shows in the log as "Undone:", never deleted. Current notes and order text/versions survive. Turns before the rollback
  target keep their baseline completion/revision flags even if their orders were edited; from the target turn on, restored
  phase flags reopen affected work, including revised orders in baseline-completed phases.
- Eligibility starts at the turn cancellation was adopted (`floorTurn`), and every event seals the log through itself
  (`sealedThrough`) so a later rewind cannot refund its cards. There is no explicit history confirmation (human). Older
  corrections and roster changes require table agreement. A save from the time of disputes loses its `cases` and
  `acknowledgements` on load; an open dispute is dropped.
- The log carries the buttons (human). Playing Twain, Jousting Tourney, Primetime TV or Bread and Circuses scrolls to the log
  and starts a cancel mode: only lines the card can act on (an action, or the latest cancellation for a counter) get a red
  Cancel button, after a confirmation; the mode ends after one use, on Stop or when the card is gone. King needs no mode: his
  holder sees Protect on the latest cancellation of their city action. There is no cancellation panel.
- Undo votes: a player with an undo waiting gets a notice on every page load (once per load, players only) linking to the
  vote; the vote box and Yes button are green. Voting rules are unchanged.
- Cancellation state stores revision references, never snapshots (an event stores `priorRevision`). Exact baselines are
  captured even after note-only revision gaps; a primary action log is not assumed to be the first line of its revision.
  Legacy targets are adopted only with an exact preceding revision; missing history fails atomically. Idempotence fingerprints
  and selected inputs stay private; projections whitelist the viewer's own cancellation cards with the public log lines each
  can act on. Targets carry labels and blocking reasons, not log suffixes.
- Zheng He (human, #301) writes one private line for each hut or village piece on a map square (square and name) and for each
  hut or village item another player holds. Map pieces are anonymous and a draw takes the top card, so the look fixes the
  items: the sheet's top item is taken out of the deck and set under each piece without one (`GameState.underTokens`, never
  projected). Shuffles (item undo, Frida Kahlo) cannot change what was seen.
  - Draw Hut and Draw Village ask which token the draw is from when there is a choice (`drawTokens` in the view): a button
    per map piece, and per moved piece that still has an item under it, named by the square it was read on ("C2 (in cash1981's
    area)"); a moved piece with nothing under it equals a random draw and is not listed. The last button is "Random hut (not
    from a token)".
  - A chosen token gives the item under it (the top card when nobody has looked); its piece stays put, to be moved by hand
    (`DrawInput.fromPieceId`; a token a figure ends its move on is collected automatically, see Figure movement), and a public
    line says where.
  - A draw with no piece never gives an item under a piece still on the board, and gives the item under a deleted piece, one
    per draw, so every other item stays under its piece, safe from shuffles and from a board undo restoring its piece. A token
    placed after the look stays anonymous.
  - Undoing the card puts the items still under a piece back, shuffles their sheets twice and says so privately; an item a draw
    already took stays where it went.
- Discarding a Great Person from the hand asks first: it does not use the card (Play does), and a killed Great Person is
  discarded unused (human).
- Scout-transfer coin corrections remain manual; see [limitations](limitations.md).
- The palette uses a single `coin1` marker named Coin.
- Reference dialogs move focus with `preventScroll` so `?` never scrolls the page.
- City-state 4 ("1 Culture & +2 Combat bonus"): +2 derived combat bonus for the player whose army or scout stood in its square
  first, once however many figures; the card need not be held. A later arrival (battle) does not get it. It passes only when
  the holder has no figure left there, to the colour there longest, and is not regained by returning. "First" is derived by
  replaying `board.history` (`cityStateHolderColour`) since stacking order changes; nothing is stored, so undo follows. The
  +1 culture half is not derived.
- **Defended city** (base p. 23, F&F p. 7 and 9; human 2026-10-30): a battle is for a city when one of the attacker's armies
  stands on a centre of one of the defender's cities (a battle has no square of its own). The defender's combat bonus then adds
  +6 city or +12 capital (a metropolis is the capital), +4 walled, +2 metropolis, +2 fortification (`cityDefenceOf`,
  `BattleSideSummary.cityDefence`, public). End battle removes the fortification whoever won (human), as the ender's board
  change; Undo end battle restores it (`EndedBattle.fortification`). The +3 hand size is out of scope.
- Fortification and caravan markers are read from the board, so hand-placed ones on a centre count in existing games too. An
  undo puts a used-up marker back only while its city has no other one (`cityMarkerMayReturn`).
- **Arena placement log** (human 2026-11-03): placing a unit is not logged until its player ends their battle turn (or the
  battle ends), so a unit taken back first is never revealed (`ArenaUnit.announced`; absent means announced).

Source: `packages/engine/src/coins.ts`, `blockade.ts`, `combat-bonus.ts`, `city-defence.ts`, `actions/arena.ts`,
`cancellation.ts`, `twain.ts`, `assisted-core.ts` and related tests.

## Arena and card handling

- Arena turn indicators are advisory; participation and edits have their own permissions. Do not enforce them.
- Kills are reversible flags during the battle. End battle discards the cards of killed units of the player sides, unless
  Florence Nightingale saved them, each with a public `DISCARD` line (human, #373). Killed barbarians stay with their
  controller, who uses Discard barbarians. Loot stays manual.
- Undo end battle returns the cards to their former hand/battlehand places, locked, and supersedes their discard lines.
  A card that comes back after End battle (the Chinese, Nightingale) supersedes its discard line too, so a vote undo
  cannot return it twice. Reinforced-away cards stay locked until battle end.
- Gifting is restricted to tradable cards; Great Persons/civilizations are not freely giftable. Owners may explicitly
  discard a Great Person from hand or revealed cards, with log wording matching what was already visible.
- Standalone barbarian drawing is supported; initiation reuses the prepared hand or draws automatically.
- Only the player who ended a battle may undo End battle, until another battle begins. Until then every viewer sees the
  final arena read-only (`lastBattle`, totals frozen as at End battle). Its units were face up; card, slot and battle
  ids and card log numbers are scrubbed because the cards are back in hidden hands. Reinforced-away units are not shown.
  A card with log number 0 shows no "#".
- Taking a unit off its front (return to hand, move) undoes that arrival: the fallen unit it replaced returns, and the
  unit and the opponent still facing it regain health and kill flag, so a unit killed on arrival moves away alive. A unit
  edited by hand since (stats, kill toggle, rotate), moved away (even back to the same front) or displaced keeps its
  state. This is one arrival, not a battle-wide undo stack.

**Undoing a civilization reveal.** The vote takes back what the reveal handed out, recorded as `GameLogEntry.civSetup`
(server-side like `item`; opponents get the public log form only):

- Starting units and Egypt's wonder go back into the (reshuffled) deck; other civ cards return to the hand. Starting
  tile, leader marker, starting tech (by the civ's own tech id, so a re-chosen copy stays) and government are removed;
  the starting tech's and Democracy's coin counters are cleared; returned units lose battle flags. Cards the player drew
  or chose stay.
- The start-of-game wonder deal is taken back whichever reveal triggered it, and dealt again by the next reveal that
  completes the table.
- Board pieces are removed as System history entries; `board.undoFloor` is set to the history length and Redo cleared,
  so board Undo cannot restore pieces whose cards are in the deck.
- A reveal from before `civSetup` existed is rebuilt from the log and board; refused (`CIV_REVEAL_NOT_UNDOABLE`, no undo
  offered) for Egypt and once shared wonders are dealt, since those cannot be tied to the reveal.
- A vote that has run cannot be voted again (`UNDO_ALREADY_DONE`).

**Battle Great Persons** (#301; human 2026-11-02). A battle card is `ready` for a combatant of the active battle in any
phase and is listed in every phase tab and the Battle panel; outside a battle it is `wrong-phase`, except Gustavus
Adolphus. The barbarians' controller is no combatant. Undo of a card play (vote) takes the bonus or mark back from the
current battle or the one End battle set aside (so Undo end battle does not restore it); once that battle is gone only
the card returns.

- **Leonidas:** defender only, with fewer units in the battle than the opponent: units drawn for him (battlehand or
  barbarians), or those put in the arena (arena plus reinforced away, killed or not) if more. Ready as soon as the
  battlehands are drawn (human, 2026-11-03: 5 against 3). Need not be faceup; playing reveals him. Kept; +8 combat bonus
  until battle end (`Battle.cardBonuses`, in `combatBonus` and so in the winner); once per battle. Played after the last
  unit and before End battle.
- **Joan of Arc:** defender only, discarded; adds the player's unspent culture (not spent); refused with none. "At the
  start of a battle" is not enforced, as with Leonidas (the arena has no start): playable until End battle.
- **Florence Nightingale:** discarded; every killed unit of the player, also one a later unit replaced on its front,
  gets `ArenaUnit.saved` (SAVED); it still counts as killed for the result and End battle does not discard its card.
  Refused when none of the player's units is killed.
  - Played "after a battle" (human, 2026-11-03): also on the battle End battle just set aside, by whichever combatant
    holds her, until the next battle starts. The cards End battle discarded then return to the hand
    (`BattleCardEffect.returned`; her vote undo discards them again). Refused, saving nothing, when none of them is
    still on the pile (a reshuffle took them); only units whose cards return are marked.
  - A play made during the battle cannot be undone once End battle has closed it while the saved cards are in the hand
    ("Undo End battle first"). SAVED marks show in the final arena and Undo end battle restores them; the mark goes when
    the death is taken back (kill toggle, face-off undo).
  - A saved unit another unit replaced on its front is listed as a saved casualty in the active and final arena
    (`LastBattleView.savedDeparted`).
- **Sun Tzu:** an arena button (`sunTzuPass`, `POST /battle/arena/sun-tzu`), not a card play: spends 3 trade, turns the
  card faceup (kept), flips the battle turn, once per battle (`Battle.sunTzu`). Enabled on the player's own battle turn
  only; refused while the card is still being chosen between; not in the playable-card list. No assisted undo: correct
  the trade by hand.
- **Georgy Zhukov:** either combatant; played (revealed, kept) once per battle (`Battle.zhukov`). One wound is owed per
  unit of the player killed that was not already dead when played (a kill taken back after a wound was dealt leaves
  that wound dealt). Human: manual activation, the player picks the unit; with no enemy unit nothing happens. The
  Battle panel offers a wound on each living enemy unit (`zhukovWound`, `POST /battle/arena/zhukov`): -1 health, a unit
  at 0 is killed, which can earn the other side a wound if it played Zhukov too. The play cannot be undone once a wound
  was dealt; the wound has no undo (correct health by hand).
- **Gustavus Adolphus** (human 2026-11-02: he acts before the battle; discard drawn units to draw new ones of another
  type; no link to Zhukov): played with or without a battle on (then only by a combatant), on units drawn for the battle
  and not in an arena (battlehand, not `inBattle`). They go to the discard pile and one new unit card per discard is
  drawn into the hand and battlehand from the deck the player chose (`units`: infantry, mounted, artillery, aircraft
  only with Flight). The arena is untouched. Listed in the Battle panel under the battlehand and in the phase tabs.
  - Public line (human 2026-11-03): the card with item number; each discarded unit in full with item number (open,
    "Artillery 3.1 item number #54"); each built unit by type and item number only (hidden, "Infantry item number
    #61"). The player's own log repeats them in full.
  - Undo works while the new cards are still free in the hand and the discarded ones on the pile (new cards go back into
    their decks, reshuffled); never once a new unit has been in the arena while that battle is active or set aside.

**Arena unit values.** The card label shows the unit's tier (printed values plus rotation level, `arenaUnitTier`), never
damage or hand edits; ATK/HP fields show current values.

- Placing or moving a unit onto a front facing a living unit resolves one round (`resolveArrival`). Artillery trumps
  Infantry, Infantry trumps Mounted, Mounted trumps Artillery; Aircraft trump nothing. A trumper strikes first and, if
  lethal (attack >= opposing HP), takes no damage and the victim is flagged `killed`; otherwise both lose the other's
  attack. The opponent's *current* HP takes the damage, so earlier rounds persist. Later rounds and corrections stay
  manual via ATK/HP. Rotating re-seeds the unit to its new tier and re-applies only its opponent's blows.
- Taking an arrival back returns the HP its round took, also after a manual kill toggle (the toggle and any other HP
  edit stay; human, 2026-11-14).
- Metalworking's +3 fights the round again (`refightWithAttack`): both units revert to their pre-round state and the
  round is recomputed with the new attack (an Infantry that now out-hits the Mounted kills it and keeps its HP); only
  while both still have what the round left them with. `undoRefight` restores the pair as the unboosted round left
  them: the arriving unit while it is still in the arena, its opponent only while it still faces it; otherwise only the
  attack goes back (human, 2026-11-14).
- Mathematics and Ballistics wounds kill a unit at 0 HP without a manual kill.

Source: `packages/engine/src/actions/arena.ts`, `actions/player.ts`, `actions/undo.ts`, `state.ts`, arena tests and
`undo-civ-reveal.test.ts`.

## Assisted play

Cards, culture advances, Great Person markers and city/phase actions use one contract, `performAssistedAction`
(`POST /api/games/:gameId/actions` with `requestId` and `rev`). Every manual path stays (dragging pieces, editing
counters, Draw buttons, the culture marker); assisted actions sit beside them and keep the game's existing undo rules
(human). Each action has a registry entry with `phase`, `group`, `status` and `reason`, computed once in the engine; the
browser decides no rule.

- **Once per turn** (human). Each card is used once per turn (`PlayerTurn.usedActions`). A second use asks and, with
  `confirmedRepeat`, is allowed because cards can grant another use; only the `used` refusal is lifted. Social policies
  and wonders are strict once (`repeatable: false`, `confirmedRepeat` cannot lift it); so are government changes and
  investments (`strictOnce`), disabled by their own panel.
- **Resources** (human): automatic payments use an unspent hut or village item of that name first, else a
  `resources/<name>` piece centred in the player's own area, which goes back to stock. A piece outside every area is
  never taken.
  - **A culture card counts as a resource** (human, 2026-11-13): with no token, a hand card whose play rule lists the
    resource is played as it and discarded to `discardedItems` as `playCard` does (A Gift from Afar, A Generous Gift:
    Iron, Wheat, Spy, Silk; A Princely Gift: Iron, Uranium, Spy, Wheat, Silk; `card-timing.ts`). A pending reward
    candidate never pays. The candidate with the fewest allowed resources goes first, keeping A Princely Gift (the only
    Uranium card) for last. Lives in the shared payment layer (`assisted-resources.ts`), so every resource ability
    benefits except Incense (no card can be played as Incense).
  - The action stays ready with a `warning` naming the card (viewer's own availability only). The public line reads
    "played <card name> item number #N as <resource>" instead of "spent 1 <resource>" (`itemNumberText`).
  - A Gift from Afar also gives a coin token to another player of the player's choice, who is not asked for here; its
    warning and log line add "another player of your choice also gets a coin token: give it by hand" (A Generous and A Princely Gift add nothing). The Marie Curie substitute applies as for a token; undo returns the
    card to the hand and out of the discard pile.
- **Explicit resource payments** (human, 2026-11-13): every assisted resource-cost action shares one payment selector,
  offering only the viewer's unspent hut/village items in hand, resource pieces centred in their own area, and usable
  resource culture cards in hand.
  - Fixed costs restrict each slot to its resource; Any N accepts any held payable resource. Tokens and cards are
    identified individually: two copies can pay twice, but no physical payment or one-shot Marie Curie substitution
    counts twice. An explicit choice may play a Gift while holding a token.
  - Server and engine validate the complete payment and consume exactly those choices, with no fallback. A stale
    selection disables submission. Callers without `payments` keep automatic token-first behaviour. Choices are private
    to the viewer's `availableActions`, never in public action records or opponent/spectator views.
- **Hand-resource origins and icons** (human, 2026-11-13): spending a hut or village from the hand also removes one
  matching `resources/hut` or `resources/village` icon centred in the player's own area.
  - The hand item's kind decides the icon, not the resource name (Iron may come from either). Icons have no link to held
    items. Never take a map, foreign-area, different-kind or still-bound uncollected token. A missing icon neither
    blocks spending nor removes another icon.
  - The removed icon is recorded with the payment and restored on undo (duplicate and supply checks); Board Undo cannot
    return it alone. Records without an icon stay compatible.
  - Every hand payment is named publicly with origin and item number, e.g. `Wheat (hut) item number #210`; repeated
    resources keep distinct numbers. Applies to automatic, explicit, fixed, Any N and one-of-each payments; unrelated
    held items stay private.
- **Undo** is the existing vote, extended to assisted log lines (`assistedActionId`). A reversal writes a "System:" line
  and is refused, vote left open, when a marker or token moved or a card left the hand. Board Undo refuses every board
  change an action made (`isAssistedBoardChange`): founded cities and the scout/city-state taken, harvested tokens, a
  wonder's coin, the leader marker of a free advance.
- **Culture advance** (`culture-track.ts`): 21 spaces in three levels of seven; Great Person on 3, 7, 12, 18.
  - Cost by destination level: 3 culture; 5 culture + 3 trade; 7 culture + 6 trade. Endowment for the Arts
    (`stats.efta`) takes 1 off the culture cost at 2 investments, 2 at 4. Ecology takes 1 trade off per 3 coins (from
    the printed card text, not the human). Never below 0.
  - Event spaces draw 1 (+1 Mysticism); Great Person spaces draw 1 (+1 Organized Religion, +1 Greeks); the player keeps
    one via a private, stored `pendingRewards` choice (a refresh resumes it, never redraws). The advance may repeat in a
    turn but not while a choice is pending.
  - Space 21 draws a level III card and logs Culture Victory; it does not end the game or set a winner (human).
  - Phase is City Management (an assumption the human has not confirmed).
  - Undo moves the marker back, refunds, and returns all drawn cards to the deck with a reshuffle; refused if a kept
    card left the hand.
- **Space Flight** (human, 2026-11-15): first reveal writes one public line, "<player> has researched Space Flight and
  reached space: a Tech victory" (`revealTech`). Like the Culture Victory space it only logs: the game does not end and
  no winner is set, because a Military victory can still be won, also by another player in the same turn; players name
  the winner when they end the game.
- **Card choice publicity (#304):** the public line names the cards not kept (already in the public discard pile); the
  kept card stays secret. Undo returns all drawn cards and reshuffles; the earlier public line stays.
- **Culture hand limit (#248):** a hand with more culture cards than `cultureHandSizeOf` takes no culture card by an
  event advance (button unavailable) or gift (`tradeToPlayer`, `CULTURE_HAND_OVER`, 409). A culture Draw asks first and
  the server requires `confirmedOverLimit` (409 otherwise). A hand exactly at its size may take one more and sit one
  over; the advance then warns and Your hand shows a notice. The count includes hidden culture cards but the size
  counts only revealed ones, so an unrevealed Pottery or Valmiki can block early. Great Person spaces are never blocked;
  trade offers are not checked.
- **Culture deck level warning:** drawing a culture deck whose level differs from the leader marker's level (Start
  counts as I) asks "Are you sure?"; client-side only, since Draw is a manual path. Moving the leader marker by hand
  charges and awards nothing.
- **Great Person supply:** a Great Person card is valid only while its marker type has supply (3 per type). Assisted and
  manual draws discard an invalid card faceup with a public line and continue (one reshuffle of Great Person discards);
  with no marker of any type left nothing is drawn. The kept card stays hidden and the marker goes to the owner's area.
- **Header turn focus** (`turnFocus.ts`): the header names the player furthest behind (lowest phase in
  `activeTurn.waitingFor`); ties go to the turn holder if in the tie, else the first listed; the viewer gets no
  preference. "Waiting for" lists the others at the earliest open phase. The engine's turn holder is unchanged and
  deliberately still used by the lobby (`nameOfUsersTurn`) and the out-of-turn Draw question.
- **Turn warning:** a request from a phase tab asks "It is not your turn…" when the header's player (`focusPlayer`) is
  not the viewer; navigation, Cancel, `?` hints and End turn never ask. Also asked before a board figure move or explore
  (highlighted squares); a raw piece drag does not. The engine still allows all of it.
- **Page layout** (human): board, Your actions, Your cards, then the rest; the piece palette sits below the board
  (unconfirmed, reversible in `styles.css`). Shortcuts: Board, Actions (only when the panel is shown), Your cards, Tech
  tree; Chat and History shortcuts are removed on purpose.
- **Your actions panel** is shown to every player in a running game, never to a spectator or before start/after end. It
  holds End turn, the phase tabs and, in City Management, "Your cities" (city cards and actions; human: the old Cities
  panel was hard to find). The opponents' cities panel was removed (human); the projection still carries their `cities`.
- **End turn** in Your actions ends one phase: it marks the viewer's earliest open phase done (same request as the Order
  tab button). Ending Research for everyone starts the next turn. The Order tab keeps its own End turn, "Not done" and
  Turn picker for now.
- **Panel focus** (human): tabs show only `ready` and `used` actions for the phase; a used row keeps its
  confirm-before-repeat press. Reasons live in the button `title` and a `?` help dialog, never as paragraphs. Start of
  Turn sections show only while they can be done, or as a disabled `Used` row. A blocked Advance culture stays visible,
  disabled, with its reason (human: players could not find it with a full hand).

Source: `engine/src/assisted.ts`, `assisted-core.ts`, `culture-track.ts`, `culture-hand.ts`, `server/src/routes/play.ts`,
`assisted-args.ts`, `web/src/views/AssistedActions.tsx`, `PhaseTabs.tsx`, `EndTurn.tsx`, `YourCities.tsx`, `turnFocus.ts`,
`HelpHint.tsx`, and the `assisted*` tests.

### Phase tabs and Start of Turn (part 13)

Tabs: Start of Turn, Trade, City Management, Movement, Research; the viewer's open phase is selected first. Rules from
base rulebook p. 12–14 and 26–27, W&W p. 9–10, F&F p. 8–13, FAQ 2.0 and the card sheets.

- **Playing a card is a log line** (human): a culture event or Great Person card naming a timing ("Start of Turn:", "Any
  Time:", "A / B") is listed in that phase ("Any Time" in every tab). Play removes the card (discard, or faceup in place
  for a Great Person without "discard this card") and logs who played it and whom it names. The effect is not applied,
  because other players can cancel it, except the automated cards here and in "Great Person automation": Khalid ibn
  al-Walid moves the start player marker to the player (board undo refuses that move alone), Marco Polo gains trade up to
  the ceiling, St. Francis 3 culture per unbuilt army, Orville Wright draws an aircraft card. A Great Person whose figures
  are all blockaded cannot be played.
- **Start of Turn gate:** needs Start of Turn as the open phase and a usage key once per turn.
- **Social policies** (none under Anarchy): Expansionism 1 trade per city plus 1 per city-state with the player's figure
  on it (human); Pacifism 1 culture, 2 with a scout on the map; Patronage spends 1 culture, draws an event of the
  marker's level and keeps one, and needs one advance first (human: the start space has no level); Rationalism spends 6
  or 11 trade for a level I or II `TechGrant`, spent when the tech is revealed in Start of Turn. Learning is not
  researching: no coins keep trade.
- **Military Tradition** (#311, City Management): once an army has been built with Build this turn, one button per unit
  type draws a free unit card (aircraft need Flight), once per turn whatever the type; its take-back is a plain removal. An army placed by hand, or built and then removed or
  undone, does not count. The build's vote undo is refused while the free unit stands on it.
- **Mysticism's** extra card applies to every culture card draw (advance, Patronage, Cristo Redentor) (human).
- **Government:** one change per Start of Turn. A government whose tech was revealed last turn or this Start of Turn
  (`techRevealTurns`) is direct; anything else goes through Anarchy, and from Anarchy any known government is direct. The
  Pyramids and Dr. Martin Luther King avoid Anarchy. Democracy +2 trade, Fundamentalism 1 culture per army on the map,
  Feudalism harvests a resource chosen from the tile data around a city (human).
- **Invest** (F&F p. 13): one coin per turn, only coin tokens (sheet and tech cards), never printed coins or a wonder's
  coins (human). The Arabs advance one space free; a Public Education threshold gives a free tech grant.
- **Founding a city:** by a scout (an army under the Republic). At most 2 cities, 3 with Irrigation; not water; all eight
  neighbours revealed; no hut, village, relic or enemy figure adjacent (Zulu may found next to a hut or village, then
  explore it); no city of anyone closer than three squares, diagonals included. A city-state on the square is destroyed for 3
  culture; one adjacent forbids founding. Romans advance one space free. Agriculture grows the capital by its own button.
- **Scouts send squares** (human): a scout sends its square to one city for the turn, to the capital when not sent (the
  metropolis is the capital, see Assisted build). The square counts for that city's production and trade, and its
  culture/resource icons are offered only to that city's Devote and Harvest; coin icons stay manual.
  - With no capital an unsent scout is offered to every city, with a note. With a capital, a scout that sends nothing (a
    second one on a square, or one on a city centre) is offered to no city.
  - A square goes to one city only (human, #319): sending one another scout already sends is refused; if two sends meet
    anyway (an undo vote or a scout moved back revives an older one), the latest keeps the square.
  - A scout on a centre of the player's own city never sends its square (human, #319), capital or not, nor does an
    English army: the send is refused, the panel offers none, an older send lapses.
  - An English army is sent by hand only; once sent it gathers like a scout for that city (`gathersForCity`) and nowhere
    else. An unsent one is offered to no city.
- **Wonders, Great Persons, techs, huts and relics** (`assisted-abilities.ts`, `sot:<ability>`):
  - Stonehenge, Colossus, Louvre, Lorenzo de' Medici and Alan Turing (counts Russia's white army in the supply, human)
    add their numbers; Sydney Opera House advances free; Panama Canal adds a coin to the wonder (not investable); Cristo
    Redentor draws two events of a chosen level.
  - Statue of Liberty, the Teacher hut and Atlantis grant a free tech chosen in the tech tree. Seven Cities of Gold ask
    which investment card gets 2 markers, with no coin and no free Arab advance (human).
  - A relic is claimed in any later Start of Turn by the player whose board history removed the marker, once per game
    (`unavailable` afterwards, not `used`). Atlantis and Seven Cities of Gold have a Start of Turn button; the other
    relics are under "Relic markers" (human).
  - Great Wall, Hanging Gardens, Taj Mahal, Big Ben, Machu Picchu, Plastics and Ecology only log, once per turn. Wonder
    obsolescence is not tracked (human).
- **Judgements not settled with the human:** a card over the hand size can still be played (base p. 18 says discard
  first); a passive Great Person with a timing word is listed and only turned faceup by "use"; a grant is spent by the
  first matching-level hidden tech revealed in Start of Turn; "a scout placed this turn gathers next turn" is told, not
  enforced; the same resource icon harvested twice in a turn is warned, not tracked.
- **Not built:** Great Person abilities needing a map marker, killing markers, map tile 16a, effects of played cards on
  other players, metropolis growth, and a guard for the owner's board Undo against changes a vote undo made itself (it can
  bring back a token the vote removed; the record stays undone).

Source: `assisted-sot.ts`, `assisted-abilities.ts`, `assisted-city.ts`, `assisted-cards.ts`, `card-timing.ts`, `sot.ts`,
`city-founding.ts` and `web/src/views/PhaseTabs.tsx`, `SotPanel.tsx`, `PlayableCards.tsx`.

### Great Person automation

Valmiki, Adam Smith, Susan B. Anthony, Louis Pasteur and Archimedes get a Use button that reveals the card; the effect is
active while faceup. Unimplemented passive cards get no such button.

- **Archimedes:** pays once after every player finished Research (`startMissingTurns`): 3 culture per tech researched
  that turn (`researchTurns`) that no other player has revealed. Hidden research is ignored so the public total cannot
  reveal it. Taken back by `removeTech` and by undoing the reveal. Hidden or fully blockaded gives nothing.
- **William Shakespeare:** Advance culture asks to use him when the next space holds another player's marker; yes skips
  every consecutive occupied space (`cultureAdvanceSkip`). Needs him revealed and unblockaded; normal undo.
- **Louis Pasteur:** +1 stacking limit for rule checks; the manual `stacking` value stays bookkeeping, never rewritten.
- **Michelangelo:** discards and arms a one-shot 5-production discount on the next wonder; build undo re-arms it.
- **Thomas Edison:** discards and grants a free tech restricted to the named player's revealed techs.
- **Mother Teresa:** stays faceup; once per turn moves a chosen coin token to the named player's sheet and makes a free
  culture advance; both undo together.
- **Marie Curie:** discards and arms a chosen resource as the next Uranium spend; returning the token restores the arm.
  No current action spends Uranium.
- **Captain James Cook and Henry Ford** feed travel speed (see Figure movement).

Source: `packages/engine/src/great-person-effects.ts`, `actions/player.ts`, `assisted-cards.ts`, `assisted-culture.ts`,
`assisted-resources.ts`, `build-options.ts`.

### Figure movement (#302)

Own map figures move by `travelFigure` (`/travel` route), not free drags: a cardinal breadth-first walk up to the travel
speed, checking path, water and ownership, writing position and spent movement in one board history entry so board Undo
restores both. The stored turn number refreshes the allowance next turn. Battle and loot stay manual (human).

- **Tech speed** (human, 2026-11-14): a revealed tech gives a travel speed (Horseback Riding 3, Sailing 4, Steam Power 5,
  Flight 6; `TECH_SPEEDS`, `techSpeedOf`). The highest counts; they do not add up. The base is the larger of the typed
  base (first term of `mvmt`) and that speed, so a higher typed base (hand correction) wins; typed `+` terms are bonuses
  on top (`splitMovement`). Spain's +1 is part of the base the reveal writes (`3`); `splitMovement` takes it out of the
  typed base and adds it on top of the tech speed, so Spain with Sailing is 5 plus any typed bonus. Natural Religion, Henry Ford and Captain James Cook apply on top of the tech speed. A hidden tech gives
  nothing. The status sidebar shows the tech's speed as the Movement value when it exceeds what is typed.
- **Tech stacking limit** (human, 2026-11-15): a revealed tech gives a stacking limit (Masonry 3, Printing Press 4,
  Biology 5, Replacement Parts 6; `TECH_STACKING`, `techStackingOf`). The highest counts; hidden techs give nothing.
  `stackingLimitOf` is the larger of the typed `stacking` stat and that limit, so a higher typed value wins. Russia's
  printed +1 and active Louis Pasteur's +1 are added on top (#360): Russians have 3 initially, 4 with Masonry, 5 with
  Masonry and Pasteur. Hidden or fully blockaded Pasteur gives nothing; Russia's bonus remains.
  - The typed stat is a base override, not a total including bonuses. Existing saves cannot tell a manually typed Russian
    bonus from another correction, so no values are rewritten; players who typed it must remove it.
  - Every engine rule check reads `stackingLimitOf`. Own and opponent projections expose the effective numeric
    `stackingLimit`, derived only from public eligibility, so group-move pickers match the engine without receiving
    hidden cards. The sidebar shows the tech's limit as the Stacking value when it exceeds what is typed.
- **Speed:** total of the manual `mvmt` expression. Revealed Natural Religion gives an army +1 outside Anarchy unless the
  expression already has a `+` term; while it is active any `+` term is read as its bonus, so a scout with a typed `+1`
  (older saves recorded `3+1`) loses a point. Henry Ford +1 while faceup; Captain James Cook doubles it for the turn
  (`card:Captain James Cook` marker, freed by undo).
- **Pool** (human): each travel adds to `movement.used`; the figure may move again while speed is left. It locks when the
  pool is spent or the move ends on a hut, village or another player's figures (`MovementDestination.ends`). Board Undo
  takes moves back one at a time.
- **Routes** (#362): the web preview sends the explicit squares to enter (tap a destination, optional waypoints; tapping
  another destination continues the route with the old one as a waypoint, and the square's label says "Continue the route";
  a square the route already passes, a walk-and-explore preview or an illegal continuation start over with the shortest way;
  Remove last stop drops the destination and is disabled when the stop before is only a crossing square; Add waypoint is
  disabled when no square is left within the movement).
  - `checkRoute` validates them with the search's per-square rules (`figureRulesOf`: crossing versus ending, huts, foreign
    figures, stacking, fog, Communism lock, Brandenburg), allows no repeated square and charges the route's own length, so
    a detour costs more than the shortest way. The route must end on the requested square. The server re-validates
    against the current board, which rejects a stale preview.
  - `planRoute` plans the preview: a shortest leg per waypoint, later targets reserved. It is greedy, so a first leg can
    take squares a later leg needs.
  - A group with a scout can end on a hut or village the scouts may not enter (huts are open to scouts under Pacifism,
    villages never): the armies go on alone with their own movement left, the scouts stay and remain free to move; the
    route summary says so.
  - The route is stored on the `move` board change (`route`) and shown in board history and the **public log**:
    `cash1981 moved Army D3 → E3 → E4 (2 squares)` (`from D3 to E4` when no route is known; a shift inside a square is not
    logged; exploring logs `explored E5 with Army on E4 (1 movement)`). Undo and Redo of a travel move add their own public
    line so the log never claims a figure stands where it does not. The log is public because positions are on the board
    anyway. One Undo takes the whole move back.
  - `/travel` without a route charges the shortest distance and records no route; the way taken is never reconstructed,
    also for moves before #362.
  - **Explore ahead:** fog the figure is not next to but could reach (destination not ending the move, 1 movement to
    spare) is also marked Explore. Tapping it previews the walk to the nearest square beside it, and "Move and explore" sends the travel,
    reloads, then runs the ordinary explore, so a refused exploration leaves the figure moved, with its Undo. The walk
    never stops on a square that ends a move or on a relic, so no token, relic or village question is asked on it, and no
    disband offer is made on an own city centre (move there first).
- **Stacks** (human, 2026-11-26): a figure that arrives on a square (travel, Build, reposition) takes the first free spot of
  `FIGURE_SLOTS` (`figureSpotIn`: middle, right, left, then below and above; a spot is taken when a figure's centre is
  within 12 px), so figures on one square can be tapped one by one. Figures already standing, and a stack arranged by
  hand, do not move.
  - **Group travel** (`actions/travel-group.ts`: `travelGroup`, `exploreGroup`; `POST /board/travel-group`,
    `/board/explore-group`): the viewer's figures on one square with movement left go along one route, each checked and
    charged by `travelFigureCollecting` as if alone (its own speed, so the slowest sets the range). All or nothing. The
    web (Movement phase only) selects the whole stack; tapping the selected figure again, or the "Moving n of m" button,
    takes one off (the tapped figure always stays).
  - The group stops where any one figure would end its move; then everything works as for one figure: a hut or village is
    drawn once, a relic taken (only the army that takes it ends its move), the fight for a village started and a battle on
    another player's figures settled by hand, all by the group's army (its first figure when it has none; that figure
    moves last). A scout that may not end somewhere keeps a mixed group off that square. The group needs room for all its
    figures under the stacking limit on its destination (the preview leaves out squares without it).
  - On an own city centre the whole group may disband, army first, so a mixed group leaves a fortification (the
    orchestrator's tie-break, not yet confirmed by the human: a city holds one marker and the first figure sets it).
  - One public line names every figure (`moved Red army and Red scout together B2 → C2 → C3 (2 squares)`, with the battle
    note on another player's figures), written before what the move itself logs (a token drawn, a relic taken).
  - **Exploring as a group** (human, 2026-11-26): one tile is drawn and every figure spends 1 movement.
  - Every board entry of a group action carries one `group` id, so one Undo takes it all back and one Redo brings it again.
    A refused step (such as an assisted relic claim) refuses the whole Undo; a step that offers no Redo (a collected
    token, a Spanish building) leaves no Redo for the whole group.
- **Route playback** (#362, `web/src/lib/moveReplay.ts`): when a newer board arrives (auto refresh, Forward, or Live after
  a replay) the figure steps through each recorded route, one square per 320 ms, before resting on its real position.
  Display only; the board is never changed. Moves of one group walk together; others wait for the one before, and figures waiting
  their turn are held on their start square. A reload that leaves the history unchanged does not cut playback short. Plays
  the newest 4 route moves, also the viewer's own and redo. A walking figure cannot be moved or grabbed until it arrives.
  Moves without a recorded route, undo and jumps back never animate; off for `prefers-reduced-motion`.
- **Water:** Sailing, Steam Power and Flight allow crossing and ending in water; England crosses but cannot end there (no
  Navigation needed). An unknown (tile-back) square is not water. Navigation (human, 2026-11-24) crosses but does not end
  in water either. Exception, also for England: a figure may stop in water that touches fog to explore from there, if it
  has movement left; its next move takes it to land, by hand, not enforced.
- **Huts and villages:** a move must stop on one; with Flight it may fly over or land on it (human, 2026-11-17); landing
  ends the move (`ends`).
  - Ruling 283 ("cross but not end on a hut or village with Flight") belongs to the Migrants, Colonists and Immigrants
    cards (rulings 278–287), not ordinary travel. Culture-card moves keep it: they may cross but need an empty square.
  - Not automated: a village is entered only after winning a barbarian battle (Zulu take villages free, ruling 113), and
    a scout may not enter a hut or village (core rules), except huts with Pacifism.
- **Stacking:** travel may cross or end on a square with fewer of the player's own figures than `stackingLimitOf` (Pasteur
  included); the limit is absolute (rule 50) and counts only the player's own figures (rule 51).
  `MovementPlayer.stackingLimit` defaults to 1; the server passes the real value.
- **Other players' figures** (human): an army may end on them (`contact: true`, shown red, asked first, logged as settled
  by hand; the engine starts and removes nothing). Without Flight they cannot be crossed (rule 52); with Flight they may
  be crossed or landed on. A scout never attacks (rule 431): never lands, crosses only with Flight.
- **Exploring:** a square with no tile is fog (tile back), never walked onto and never a card destination. A figure next to
  fog may `exploreSquare` (`POST .../pieces/:id/explore`): spends 1 movement, draws the next TILES card and lays it in the
  covering slot, turned so its arrow (bottom edge of the art) faces the side explored from (figure south of the tile 0,
  west 90, north 180, east 270); it can still be turned by hand. It neither moves nor locks the figure; any lock forbids
  exploring. It fails without spending when the card has no artwork. Test helper `coverMap` lays tile backs so older tests
  see no fog.
  - A drawn tile card (exploration or manual Draw) never enters the hand: it goes to the discard pile and shows in Revealed
    and Discarded Items, dated by its draw line (human, #373; tiles are not reshuffled, so never drawn twice). Board Undo
    (two presses: tile, then movement) does not return it; explore-undo-explore to see more tiles is accepted for now (the
    draw line can be undone by vote).
- **No gates:** `/travel` and explore have no phase or turn-holder check, matching the shared board. One's own map figure
  may be dragged or arrow-nudged only inside its own square (`arrangeWithinSquare`) to arrange a stack (human): a plain
  `movePiece` that keeps the spent movement and spends none; a drop in another square springs back. `movePiece` remains
  the manual tool for setups and off-map pieces.
- **Scout gathered squares** (rules 198, 257, 334, 341, 422–424): gathering reads the scout's current square and records
  no icon use, so a scout moved in City Management gathers where it ended. The trade phase is not re-run.
- **Communism** (Spy, Movement phase): stamps a chosen square as locked for the turn; `communismLocksOf` derives locks from
  applied records (no saved field), public in `PlayerView.communismLocks`. Figures may enter but not leave a locked square
  in every movement path; a figure may be locked on water. A confirmed second use with another Spy is allowed.
- **Brandenburg Gate** (rules 209–214, 333): the outskirts of every city of the owner (human) and of city-states the owner
  holds are closed as an *ending* square for other players' figures in every movement path (group cards judged by the
  moved figures' owner); crossing is allowed; the centre is not outskirts. Disabled, unowned or blockaded on its own
  square: no effect. Not modelled: the Spy exception (rule 214) and the obligation to leave. Derived and public
  (`PlayerView.brandenburgZones`).
- **Disbanding** (F&F p. 7–8, human 2026-10-30): travel only (not cards or drag) onto a centre of an own city asks first;
  `travelFigure({ disband: true })` then removes the army or scout (back to supply) and puts a fortification (army) or
  caravan (scout) on that square, in one `disband` board change after the move: board Undo gives the figure back, then the
  move. One marker per city of either kind; a later disband only removes the figure. The shared pool of 15 markers is not
  limited. Effects: City production (caravan); Coins, wonders and blockade (fortification).
- **Hut and village tokens on tiles** (#364): `data/tile-icons.json` records each exploration tile's hut and village icons
  (`token`, printed orientation, read by eye from the tile images; starting tiles have none). Tiles 15a–17a, 22b and 23b
  carry a relic instead.
  - A tile laid on a map slot by exploration or manual draw, or brought onto a slot from a player area, gets one
    `resources/hut` or `resources/village` piece on each such square, once (`seedTileTokens`). Tokens carry
    `BoardPiece.tileId`; a tile counts as seeded while one of those placements is still in the history, so an undone one
    seeds again. A tile already on the map that is only set into another slot, or placed from the palette, gets none.
  - Tokens move (`move` change `tokens`) and turn (`rotate` change `tokens`) with their tile, staying on the same printed
    squares.
  - Seeding adds one board history entry per token after the tile's own, so board Undo takes the tokens off, then the
    tile, then (for exploration) refunds the movement. Hut and village pieces are not a limited supply (#116).
- **Relic markers** (Fame and Fortune p. 9, Wisdom and Warfare): `data/tile-icons.json` `relics` gives tiles 15a
  (Atlantis), 16a (School of Confucius), 17a (Seven Cities of Gold; relic square is forest, as the rulebook says), 22b
  (Attila's Village) and 23b (Ark of the Covenant) their relic and printed square. A laid tile gets the matching
  `relics/…` marker, seeded, turned, carried and undone like hut and village tokens (`tileTokenSquares`), unless that
  relic is already on the map.
  - **Scouts** may not enter a hut or village square (base rules p. 15 and 20; not even crossing, with or without Flight;
    a revealed Pacifism lets them onto huts), nor a relic square unless one of the owner's armies already stands there
    (`scoutForbiddenSquares`; a Republic makes no difference). Movement cards (Galileo, culture events) skip the scout
    restrictions on squares they cross but cannot end on any marker square.
  - **Taking:** an army that ends its move on a relic square, with the player confirming (`collectToken`, the same prompt
    as a hut), has the marker removed as the next board history entry credited to the player (which the relic claim
    reads); its movement is over for the turn. Board Undo puts the marker back, then takes the move back. A public line
    names the ability. Passing through, declining, or moving onto another player's figures (the battle comes first)
    leaves the marker.
  - **Claims:** Atlantis (a free tech) and Seven Cities of Gold (two free investment markers) are Start of Turn buttons.
    The other three are `relic:*` assisted actions in `assisted-relics.ts` (phase `ANY`, group "Relics", once the marker
    is off the map):
    - **Ark of the Covenant:** two free culture-track advances, one at a time (`performAdvance` with `free`, so Mysticism,
      the culture hand limit, a waiting card choice and the end of the track still apply). `takeRelic` makes the first the
      moment the army takes the marker; the second is the button.
    - **Attila's Village:** two free units of the chosen types (infantry, artillery, mounted, aircraft with Flight),
      drawn into the hand as for Military Tradition; the public line names the type only (button).
    - **School of Confucius:** draws two Great Persons, one more for the Greeks and one more for a revealed Organized
      Religion, which stack (Greeks with it draw four); keep one of the drawn (human; the rulebook's
      draw-two-then-two-more reading for the Greeks is not used). Claimed at once by `takeRelic` through the usual pending
      choice. A claim blocked at that moment (a full culture hand) leaves the button with its reason.
  - **Undo:** a claim is undone by vote. While a claim stands (Atlantis and Seven Cities included), board Undo refuses to
    put its marker back (`BOARD_UNDO_ASSISTED`, `relic-claims.ts`). Once a vote has taken back the Ark's advance or a
    School of Confucius claim whose Great Person marker was placed, board Undo stops there (`undoFloor`, as for
    Philosophy), since walking back past it would replay the forward move; the army and marker are then put back by hand.
- **Collecting a token** (#364): `travelFigureCollecting` (the `/travel` route's `collectToken`) is `travelFigure` plus,
  when the player confirmed in the web (a hut or village is the only reason a move ends on a square with no figures), the
  draw from that piece (`draw` with `fromPieceId`, so what Zheng He saw under it is what is drawn), the token moved into
  the player's area and a `TokenCollection` record (`GameState.tokenCollections`, never projected: it names the card).
  - Board Undo takes the token and card back first, then the move on the next press. The card is bound back under the
    piece, so the player's knowledge of it never becomes the next card anyone draws; the draw's own log line can no longer
    be voted back; a public line says so; the redo stack is cleared. Refused (`BOARD_UNDO_TOKEN_CARD_GONE`) once the card
    has left the hand.
  - Without the confirmation, with another player's figures on the square (the battle comes first, also for a direct API
    request), or when no hut or village is left, the move stands and the token stays, to be drawn by hand. Flight cannot
    end on a hut or village, so it collects none.
- **Not done:** automated battle, loot and figure removal.
- **Overlay only in Movement** (human, 2026-11-24): the yellow movement squares of a selected figure are drawn only while
  the viewer's current phase is Movement (`currentPhaseOf`; none after every phase is done). The figure is still a
  movement figure in every phase: no free Move button, and a drag only arranges it inside its square.

Source: `engine/src/movement.ts`, `board.ts` (`PieceMovement`), `actions/board.ts` (`travelFigure`), `actions/travel-group.ts`,
`actions/tile-tokens.ts`, `actions/token-collection.ts`, `tile-icons.ts`, `disband.ts`, `explore.ts`, `actions/explore.ts`,
`actions/draw.ts` (`drawTileAt`), `communism.ts`, `assisted-communism.ts`, `brandenburg.ts`, `server/src/routes/board.ts`,
`web/src/views/BoardView.tsx`, `web/src/lib/moveReplay.ts`.

### Movement cards: Galileo, culture cards, Hannibal and Steam Power

All use the shared card map picker (`MapPickerContext`, as Build) with squares in the `playCard` payload. The card and
every moved figure are one assisted action: board Undo refuses the moves (`BOARD_UNDO_ASSISTED`); the undo vote restores
positions and the card/resource, and is refused once a moved figure has moved or explored since. "Empty" means unofficial
rules 61-63 (`empty-square.ts`): no figure, building, Great Person, wonder, city-state, city, hut, village or relic
token. A disaster or other resource token does not block; a metropolis blocks both squares it covers.

- **Galileo Galilei:** all the player's figures in a source square move to an empty outer-edge square (a square with a
  cardinal neighbour that is not a playable map square, holes and steps included). A source already on the edge may name
  itself (rule 332). No terrain or stacking gate. Moved figures are locked (`movement.reason: 'galileo'`).
- **Steam Power** (City Management, spends a Silk; text from card art): all figures in one square move to any explored
  water square and are locked (`'steamPower'`); a water source may name itself (rule 193+). The stacking limit applies;
  armies may land on other players' figures (manual battle), a group with a scout may not (rule 196). Communism-locked
  sources and Brandenburg outskirts are refused.
- Galileo and Steam Power refuse a source holding a figure already moved this turn, rather than leave it behind.
- **Movement culture cards:** Migrants (2), Colonists (4), Immigrants (6) move one own figure by ordinary travel rules.
  Disoriented (2), Lost (3), Out of Position (4) move every figure of one other player in a square (no water at all, as
  printed). Destinations must be empty. They cross like travel: own figures while stacking room remains (the target's
  limit for group cards), others' only with Flight (human). They ignore and do not set the travel pool (rule 276);
  figures locked by Galileo or Steam Power cannot be targeted (rules 255, 287, 330). Their policy-switch ability stays
  manual.
- **Hannibal** (City Management): move any or all figures from a source to a different square already holding one of the
  player's figures, capped by `stackingLimitOf` minus figures there. Does not touch the travel pool; Galileo-locked
  figures are not offered.

Source: `engine/src/galileo.ts`, `card-movement.ts`, `empty-square.ts`, `steam-power.ts`, `assisted-steam-power.ts`,
`assisted-cards.ts`, `web/src/views/mapPick.ts`.

### Unit tech abilities (#327)

First slice of automating tech resource abilities: Mathematics, Ballistics, Gunpowder, Combustion (human, 2026-11-13).
A level raise on reveal never lowers a level, and only a hidden copy counts (`revealTech`, `UNIT_LEVEL_TECHS`).

Undo votes below return what was paid (Mathematics and Ballistics do not refund their Iron) and refuse, with a reason, when the board no longer matches what the
action did. Where a board piece is removed or flipped, board Undo cannot take it back alone (`isAssistedBoardChange`) nor
walk back through the restoration (`undoFloor`); the vote puts it back exactly (`placeBack`), refused when the piece is
on the board again, another building, wonder, city or city-state now stands on its square, or the freed supply place was used by another build
(`restoreSupplyBlock`). The same holds for a wonder disable (Gunpowder or Monarchy `obsolete`: the vote restores owner
and flag exactly, refused when they changed since) and for the Atomic Theory nuke (each piece back exactly via `placeBack`).

- **Mathematics (3 wounds) and Ballistics (6), Iron, Battle:** assisted actions (phase `ANY`, group "Battle", usage key
  `card:<tech>`, once per turn with the usual confirmed repeat). Ready only in a battle the player fights in (not the
  barbarian controller), with the tech revealed and an Iron token. Pressing pays the Iron and records the wounds owed in
  `Battle.techWounds`; the player deals them with `techWound` (`POST /battle/arena/tech-wound`).
  - The player chooses the wounds per enemy unit (human, 2026-11-14): an OK/Cancel popup, from 1 up to what is owed and
    what the unit has health for; the engine refuses anything else. A larger choice runs into the second set of a
    confirmed repeat (the first set is dealt first; each record is undone on its own). A unit at 0 is killed; own and
    killed units are refused. Zhukov's wound stays one at a time. The player may stop early; the rest is lost when the
    battle ends.
  - Undo removes the owed wounds from the current battle or the one End battle set aside. Refused once a wound was dealt
    there (health is corrected by hand) and once the battle is gone (a new one started), since dealt wounds cannot be
    ruled out; the Iron is not refunded then.
- **Gunpowder (Any 2, City Management):** pays two resources the player names (`payload.resources`) from Incense, Iron,
  Silk, Wheat, Spy, Uranium (human, 2026-11-13), via `spendAnyResources` (also used by Pottery and Philosophy).
  - The names are a preference: each is paid by its own token, a missing one by any other unspent token, and only the
    remaining shortfall by culture cards (never the same card twice), so a card is never burned while a token could pay.
    The names do not choose the card: the fewest-allowed card goes first, the rule availability uses, so its warning names
    exactly the cards played (except while Marie Curie is armed and the player holds both the armed substitute and a real
    Uranium token; see limitations.md). The log says each card is played "as" the resource it was assigned, currently
    always Iron. The shared explicit-payment selector names exact tokens or cards; `payments` is authoritative when
    supplied, `resources` stays for compatibility.
  - Effect (human, 2026-11-13; `assisted-gunpowder.ts`), by `mode`. `obsolete` (`wonderPieceId`) disables an ANCIENT or
    MEDIEVAL wonder a player owns that is not already disabled through `disableWonder` (same board change and history entry as the hand-made disable
    and Monarchy: owner cleared, piece drawn crossed out, culture token unaffected). `destroy` (`buildingPieceId`)
    removes any building on a map square, whoever's, never a wonder or a city, through `removePiece`; the line names the
    building, its square and whose outskirts it stood in ("no single player's" outside every outskirts or in those of
    two colours; owner as the coin rules read it).
  - Both target lists come from the public board (`obsoletableWondersOf`, `destroyableBuildingsOf`), so the web lists
    what the engine accepts; an ineligible target is refused with nothing spent. With neither target the button is
    unusable and says why; with one it stays ready and warns which is missing.
- **Combustion (passive, Movement):** the engine has no trigger on the end of a move, so it is a once-per-turn, no-cost
  assisted action in the open Movement phase (group "Movement abilities"). The payload is the player's own army piece id
  on a map square; the square and the building or walls follow (`combustionTargetFor`; the web lists one entry per army
  standing on something to destroy).
  - Never the player's own: the owner's walled city is never a target; a building is the player's own when its square is
    in the footprint of exactly one colour's cities (`pieceCityOwnerColor`, as the coin and blockade rules, without the
    "placed by" fallback). A building in another player's outskirts, outside every outskirts, or in those of two colours
    is a target. Walls come before buildings.
  - Automated (human, 2026-11-14): a building is removed as Gunpowder's destroy does (`restoreDestroyedBuilding` on
    undo); the walls of a walled city turn the marker back to its plain side (`flipPieceUnchecked`,
    `unwalledAssetIdOf`). Undo also refuses when the city is gone or its marker is no longer on the plain side; records
    made before the automation only free the use.
  - Manual: judging that the army really ended its movement there or attacked the city.
- **Tech coins** (Education, Code of Laws; human, 2026-11-14; `tech-coins.ts`): each adds its own coin (max 4, or 6 with
  an active Internet, like every tech counter). Requires the tech revealed, the counter below its limit and no coin
  earned yet this turn (usage key `coin:<tech>`, written with the coin and removed with it). A hand-typed coin counts
  toward the limit. "Once per turn" counts the game's turn number, so a defender who wins during another player's turn
  earns it for that turn.
  - Education: earned by building a wonder (not a building, unit or walls), recorded as `educationCoin` on the build
    record, so undoing the build takes it off; log "Education gained a coin (n/4)".
  - Code of Laws: earned by the winner when End battle is pressed (a draw goes to the defender; a barbarian side wins
    for nobody), recorded as `endedBattle.codeOfLawsCoin`, so undoing End battle (the ender alone) takes it off.
- **Animal Husbandry and Biology heal** (human, 2026-11-15; #354): free, once per battle (`Battle.heals`, not a turn
  key; a confirmed repeat gives no extra use), in a battle the player fights in, on own living arena units up to the
  health the card has at its level (`arenaUnitTier`; a killed unit stays dead). Own Battle-panel buttons
  (`animalHusbandryHeal`, `biologyHeal`), separate from Animal Husbandry's production boost; not resource abilities, so
  nothing can cancel them.
  - Animal Husbandry owes 3 wounds, healed with `healUnits` (`POST /battle/arena/heal`) in the number chosen per unit,
    stoppable early. Undo is refused once a wound was healed.
  - Biology heals every wounded unit (refused when none is wounded). Undo restores each unit's health while it still
    holds what the heal gave it, and only until End battle.
- **Once per turn, not per battle** (human, 2026-11-13): Mathematics, Ballistics and every tech card are once per turn
  (`card:<tech>` with the confirmed repeat); only the healing abilities are once per battle.

Source: `engine/src/assisted-tech-wounds.ts`, `assisted-gunpowder.ts`, `assisted-combustion.ts`, `combustion.ts`,
`assisted-resources.ts`, `battle-cards.ts` (`TECH_WOUNDS`), `actions/arena.ts`, `server/src/routes/arena.ts`,
`web/src/views/GameView.tsx` (Battle panel), `AssistedActions.tsx`.

### Tech resource abilities (#327)

Second slice (human, 2026-11-13): Animal Husbandry, Construction, Banking, Plastics, Pottery, Philosophy, Education,
Horseback Riding, Mysticism, Writing, Civil Service, Mass Media and Monarchy; Metalworking, Engineering, Atomic Theory,
Bureaucracy and Agriculture follow. Democracy and Printing Press were already automated (`coinPurchase`).

- **One shape** (`assisted-tech-abilities.ts`, `techAbility`): tech revealed, phase open, `card:<tech>` once per turn with
  the confirmed repeat, payload checked BEFORE anything is paid (a refusal spends nothing), every payment through the
  shared layer (exact explicit choices, otherwise token first and culture cards only for the shortfall; the Gift from
  Afar note), then the ability's own part. Undo takes that part back or refuses with a reason, then returns exactly what
  was paid. The web uses one picker per kind (`ASSISTED_TECH_PICKERS` in `assisted-techs.ts`, a leaf table the web
  reads); server parsers are strict and the engine decides legality.
- **Choices are a popup** (human, 2026-11-14; `ChoiceDialog.tsx`): every ability that asks something opens one OK/Cancel
  popup; Escape or a click outside cancels; nothing is sent until OK. Only choices that can be carried out are offered:
  Monarchy shows "Obsolete an ancient wonder" only when a player owns one and "Kill a random unit" only outside a battle
  and with an opponent holding a unit card; Gunpowder and Atomic Theory hide the obsolete/destroy and nuke modes the
  same way (Atomic Theory's extra action only while the viewer's City Management is open, the nuke only in Movement with
  a city to nuke). A single mode has no radio; with no valid choice the popup does not open and a hint says why.
- **Production boosts** (Wheat, City Management; +3, +5, +7, +10): the player names one of their cities. The bonus is
  not stored on the city: `cityProductionsOf` sums the applied, not undone, records of this turn that name the city
  (like the Communism lock), so the undo vote removes it and it ends with the turn. It enters `boost`, `estimate`, the
  Building Program figure (after the doubling, as every modifier) and a per-city modifier; a hand-set number does not
  include it, so a Build adds it to that number too. A Build does not use it up: a second Build in the city counts it
  again. Undoing a boost after a Build used it does not refund that Build (limitations).
- **Pottery** (Any 2): one coin on its counter, capacity 4 (+2 with an active Internet). Undo refuses when the counter
  holds no coin.
- **Philosophy** (Any 3): a Great Person is gained as a culture advance's Great Person space gains one
  (`gainGreatPerson`). With no marker left the button is blocked and nothing is paid. The card is private: the public
  line names the marker type and item number, the name only the owner's log. Undo puts the card back in the deck,
  shuffled twice as every draw undo is, and takes the marker; refused once the card has left the hand. It does not go
  back "at its place": the owner has seen the card, so a known top card would be a leak.
- **Education** (Incense, Iron, Silk and Wheat, one of each; human, 2026-11-13): exactly these four kinds; the shared
  selector chooses which held token or card pays each. The route accepts explicit `payments`; a call without args still
  pays automatically with the usual repeat confirmation.
  - Automatic payment uses each kind's own token first, else a culture card that can be played as it (Gift from Afar,
    Generous Gift, Princely Gift: Iron, Wheat, Spy, Silk), each card once; a token of another kind never stands in. No
    card can be played as Incense, so an Incense token is always needed. The warning names every card that would be
    played and the line says "played <card> item number #N as <kind>" (`spendEachResource`).
  - The free tech reuses `TechGrant` with `phase: 'CM'`: `revealTech` spends a grant whose phase equals the open phase
    (no phase means Start of Turn), so a Start of Turn grant is not spent in City Management and the reverse. The player
    chooses and reveals the tech in the tech tree. Undo is refused once a tech was learned with it. The wonder coin is
    automatic (see **Tech coins**).
- **Horseback Riding** (Silk, Trade phase): +9 trade for the player, +6 for another player they name, each stopped at the
  end of the trade track. Undo is refused when either has spent it.
- **Mysticism** (Spy): the opponent loses one coin token on the counter the player names. Only counters that hold tokens
  count (`INVESTABLE_COIN_SOURCES`; printed and wonder coins are not tokens), read from the public status board. Refused
  when the opponent holds no coin there. Undo gives the coin back.
- **Cancels** (Writing, Civil Service, Mass Media: Spy, any open phase; Writing is City Management on its card, but
  players act at different paces and nothing is blocked anyway (human, 2026-11-13); Mass Media says the resources of the
  cancelled ability are lost): the Spy is paid, and the other player and free text for what is cancelled are logged. The
  game has no pending action, so it never blocks the cancelled thing: the other player undoes it with the vote or
  corrects it by hand, and the line says so. The real cancel is made from the log (see "Cancellation" above, where Mass
  Media's shield for culture events is enforced). The legacy `playCard` of Jousting Tourney and Bread and Circuses, which
  only logs the card, also refuses a named player who has Mass Media revealed (`massMediaShield`).
- **Monarchy** (Silk, City Management):
  - `obsolete` (`wonderPieceId`) disables a wonder (human, 2026-11-13) as Gunpowder's does (`setWonderOwner` with
    `disable: true`, #306). Eligible: an ANCIENT wonder (`wonder-data.ts`) on the board that a player owns (the user's
    own included) and that is not already disabled (`obsoletableWondersOf`). The public line names the wonder and its
    former owner. With none eligible it is refused with nothing spent, and the button, which stays ready for the kill,
    warns so. Undo restores owner and flag exactly; refused when the wonder is gone, its owner or disabled mark changed,
    or the former owner left.
  - `kill` takes one random unit card from the chosen other player's hand with the game's seed and discards it. Refused
    with nothing paid while any battle is on (human, 2026-11-13), in the action and as a button warning (the button
    stays ready because `obsolete` is not limited by a battle; the web disables the kill mode), and when the opponent
    holds no unit card. A battle set aside by End battle is over, so a kill is allowed then, and the pick is every unit
    card in the hand (a unit End battle sent back is an ordinary standing unit). Units drawn for a battle and not placed
    (the battlehand) are in the hand and can be picked; undo puts such a card back in the battlehand too.
  - A discard is open information: the line names the unit in full with its item number (as Gustavus Adolphus'
    discards do), only after the discard; the rest of the hand stays private. Undo returns the card while it is still in
    the discard pile.
- **Metalworking** (Iron, Battle; button in the Battle panel beside Mathematics and Ballistics): adds 3 to the typed
  `attack` of one of the player's own living arena units (`placedBy`), once per turn. A unit not yet announced is not
  named in the public line (as the arena's own lines do not); the owner's private line names it. Undo is refused when
  the unit is gone or its attack was edited since. A unit that fell in the round its own arrival fought, and has not
  been touched since, may still take it (the +3 belongs to the unit's play): the round is fought again and the unit may
  now live (`fellOnArrival`; human, 2026-11-14). A kill toggled by hand later does not block the undo giving the round's
  HP back (`undoRefight` restores both units through `restoredVitals`).
- **Engineering** (#354; "once per turn, when spending production from a city, you may split the production to purchase
  two items"; human, 2026-11-15): no button, picker or payload change. With Engineering revealed and unused, the player
  does two ordinary builds in one city.
  - The second build is allowed with no "already acted" question when the city's only action this turn is one applied
    build whose record holds `cost` and `production` (a record without them offers no second build).
    `engineeringSecondBuild` derives it and `buildOptionsOf` shows `production` = that production minus the first cost,
    never below 0 (`engineering: { firstCost, fullProduction }`). The marker, the caravan and a boost the first build
    used are not counted again, and hammers the first item adds do not help the second (ruling 80: simultaneous split).
    Any shortfall is rushed with trade as usual (a rushed first build leaves 0).
  - The second build's record carries `effect.engineering.firstRecordId` and `usageKey` `card:Engineering`, so a
    confirmed repeat cannot override the key and its undo frees it. It is not a city action of its own (it does not
    count towards Atomic Theory, Monarchy, Lovelace or Supply Drop, and takes no credit), so Engineering is once per turn
    even with Atomic Theory (ruling 166). A third action or one of another kind behaves as before; the refusal adds that
    Engineering is spent.
  - Undoing the first build while the second stands is refused ("undo the second build first"); removing the first
    build's piece by hand is a plain removal (`takeBackOpenBuild` returns undefined).
  - A Mark Twain / Writing / Civil Service cancel rewinds the log: cancelling the FIRST build takes back both and frees
    the key; cancelling only the second leaves the first and frees the key, and the cancelled second no longer counts as
    an action, so the split may be made again at once (ruling 165). Only a cancelled second whose first build was undone
    afterwards still counts as the city's action.
  - The other allowance wins (human, 2026-11-15): when Atomic Theory, the capital's extra action under Monarchy (a
    different action only), an unused Ada Lovelace or Supply Drop credit (`extraCityActionFor`) or a confirmed repeat can
    cover the second build, it is a whole action with the city's full production and Engineering stays unused
    (`buildOptionsOf` offers no `engineering`; `apply` recomputes options without it for a confirmed repeat). The split
    applies only when nothing else covers the second build. The web never asks the already-acted question while the split
    is offered, so a confirmed repeat with full production is reachable through the engine and API only.
- **Atomic Theory** (Uranium; Marie Curie's substitution applies through the shared layer): one action, one use a turn,
  two modes.
  - `extraActions` (City Management): every city may take one more city action, derived from the applied record
    (`atomicExtraActionFor`): a city that has acted once acts again without the question, noted in its line; one that has
    acted twice is back to the question (and to an Ada Lovelace credit, which Atomic Theory covers first so none is
    wasted). A city that already took a second action (confirmed, or with a Lovelace credit) before Atomic Theory gets
    nothing from it: its third falls back to the confirm question. Undo is refused while any city has taken two actions
    in the turn the allowance was given in (counted from the record's own turn), whatever made the second possible
    (confirmed repeat, Lovelace or Atomic Theory): the records cannot tell which, and refusal is the safe side.
  - `nuke` (Movement, `cityPieceId`): the target is any city that is not a capital (neither the capital marker nor the
    metropolis, which only a capital grows into: `capitalOf`), the player's own included (human, 2026-11-13: the point
    may be to kill the many enemy figures around it). What stands in the outskirts goes whoever owns it, so nuking an own
    city also destroys the player's own buildings, wonders, figures and great persons; the web marks the player's own
    city, never preselects it, lists other players' cities first, takes targets from the public board
    (`nukeTargetsOf`) and asks before a nuke. With no legal target the action is refused and nothing is spent.
  - It removes, as separate board history entries, every building, wonder, figure and Great Person marker on a square of
    the city's outskirts, the caravan, fortification and Building Program markers on its centre, and the city. A figure
    on the centre square, resource tokens, huts and city-states stay. The line names everything destroyed with its
    square.
  - Records naming the destroyed city: a production boost and a scout assignment are read only for cities still on the
    map, so they are harmless and count again if the undo restores the city; city-action records are not checked against
    the board (`cityActionCountsThisTurn`), so they still count. Dead end: after a nuke of an own city the undo of
    `extraActions` can be refused because of such a record that took two actions; undo the nuke first.
  - Undo of a nuke is also refused when a city (any player's) now stands on a centre square of the destroyed one or the
    shared supply no longer holds all the pieces (counted together per pool: another player's build may have used a
    freed place of the six Libraries and Universities, an army or a Great Person marker; undo that build first).
- **Bureaucracy** (once per turn, Research): the engine never limits when or how often a social policy is chosen,
  removed or revealed (`actions/player.ts`), so there is nothing to permit. The action is a once-per-turn logged note in
  the open Research phase, costs nothing, and the switch stays manual in the social policy panel. The 1 coin is the
  existing flat-coin handling on reveal (`coinOnReveal`).
- **Agriculture** (#354; human, 2026-11-15): "Immediately grow your capital into a metropolis" is an assisted action with
  no payment and `phase: 'ANY'` (the card says "immediately", and ruling 128 lets it happen in another player's Start of
  Turn), listed under Cities. The player taps one of the highlighted squares next to the capital (map picker, as
  Communism); the tapped square names the side (`direction` north, west, east or south).
  - The engine flips the capital piece to the metropolis piece (`flipPieceUnchecked`, one board history entry; same piece
    id, so records naming the capital, a Building Program marker and a scout assignment survive). A walled capital
    becomes the walled metropolis (`redcapitalwalled2` to `redmetropoliswalled2`). The marker lies on the capital's
    square and the neighbouring one, one pixel towards the capital so the capital's square stays the anchor centre and
    the city keeps its name ("Metropolis D4"); north and south turn it 90 degrees.
  - "Once per game" is derived: the capital marker is gone afterwards (`capitalOf` falls back to the metropolis), so the
    button reads "Your capital is already a metropolis."
  - Legality (`metropolis.ts`, `metropolisGrowthsOf`; rulings 116-128 and the founding rules): the new square may be
    water (Fame and Fortune p. 10, human 2026-11-24); the metropolis is then land for movement (`metropolisSquares` in
    `movement.ts`, "a makeshift bridge", for every player, travel and the movement cards) and Steam Power no longer
    offers it as a water square. All eight squares around the new square are on the map and revealed; no village, no hut
    (the Zulu may, ruling 108) and no city-state in the new outskirts or on the new square; no other city centre within
    three squares (ruling 118); no enemy figure on the new square (ruling 120), while enemy figures in the outskirts do
    not matter (121). An unclaimed relic in the new outskirts stops growth (human, 2026-11-16). A city-state beside a
    legally founded capital is impossible; the defensive check on the growing square remains, without a city-state
    destruction rule. The web works out the legal squares from the public board (same function), the engine decides
    again on the press, and the reason lists what stops each of the four sides when none is legal.
  - Undo vote turns the marker back exactly as it stood, walls included; refused when the metropolis is gone, shows
    another face (walls built since) or was moved, or when a city action was taken with it since (a build in the new
    outskirts). Board Undo cannot take the flip alone nor walk back past the vote (`undoFloor`).
  - **Overbuilding and displacement** (human, 2026-11-16, #359): buildings and wonders on the growing square are
    destroyed; a Great Person returns to the player area as reserve (Build's overbuilding helpers, rulings 125-127).
    Friendly armies and scouts do not block the side. The player chooses a second highlighted square for the whole
    displaced group, adjacent to the growing square and in the metropolis outskirts (122); the request carries optional
    `figureTarget`, required only when figures are displaced.
    - Water needs a revealed Sailing, Steam Power or Flight. The full group must fit the effective stacking limit
      **after overbuilding**; scouts cannot attack; Brandenburg Gate's protected squares remain forbidden. The map picker
      previews the limit from public data; the engine re-checks after overbuilding, before moving any figure.
    - Reserving the only unblocked Scientist can disable Louis Pasteur's +1 when the remaining Scientists are
      blockaded; a later legal placement on an unblocked square re-enables it, not before.
    - Displacement spends no movement. An army displaced onto enemies starts a manually resolved battle (124).
    - Every removal, reserve move and displacement belongs to the same action and undo vote. Undo restores them exactly
      and refuses if a displaced figure changed, a reserved person left reserve, a destroyed piece returned, its supply
      was reused, or the growing square is now occupied.
    - Exceptional centre disbanding and partial-group displacement (123) remain manual; the ordinary outskirts relocation
      does not choose or destroy figures for the player.

Source: `engine/src/assisted-tech-abilities.ts`, `assisted-atomic-theory.ts`, `atomic-theory.ts`,
`assisted-bureaucracy.ts`, `assisted-agriculture.ts`, `metropolis.ts`, `assisted-resources.ts` (`spendEachResource`),
`city-production.ts` (`boost`), `build-options.ts`, `actions/player.ts` (`revealTech`), `assisted-techs.ts`,
`server/src/routes/assisted-args.ts`, `web/src/views/AssistedActions.tsx` (`TechPickerForm`).

### Tech in the Research tab

The Tech content (pyramid, picker, hidden-tech controls) renders in the Research tab after the playable cards, not as a
collapsible panel (human). A viewer without the actions panel (spectator) gets it in a plain `Techs` panel below Your
cards, since public pyramids are information; a player sees exactly one copy. The Tech tree shortcut and tech links
select the Research tab first.

Source: `web/src/views/PhaseTabs.tsx`, `TechPanel.tsx`, `GameView.tsx`.

### Spectator read-only controls

A viewer without a seat (`view.you === null`) gets read-only Board, Battle and Social policy controls, like replay and
locked games; the server's authorization is unchanged. `BattlePanel` treats `view.you === null` as read-only even without
the prop. A spectator's board has no replay outline or wording.

Source: `web/src/views/GameView.tsx` (`BattlePanel`), `SocialPolicyPanel.tsx`, `BoardView.tsx`.

### Card pictures in the action panel (#367)

"Possible actions" shows a small picture of the card beside a tech or Great Person action, and "Cards you can play" beside
a culture card or Great Person. Techs are looked up in the public `view.techs`, hand cards in `view.you.items` only, so
nothing hidden is read. The description stays behind the `?` button. The picture is decorative (empty alt) when the row
names the card in text.

Source: `web/src/views/ActionCardThumb.tsx`, `AssistedActions.tsx`, `PlayableCards.tsx`.

### Civilization abilities (#368)

- **Gain log format:** a line that states a gain gives the amount and the new total in parentheses (`gained 3 (14) culture
  from the hut on B4 as the Chinese`). A take-back line gives the amount really taken and the total left ("took back 2 of
  3 (0) culture").
- **Romans:** a wonder build advances the leader marker one space for free, as a city does (`freeAdvanceStatus`,
  `performAdvance` with `free`). A wonder is refused before placement while that advance is stopped (card choice waiting,
  hand over its size); the end of the track stops nothing. Undo takes the advance back first and refuses if the marker has
  moved on.
- **Village fight (human):** an army (not a scout, not a Zulu army) that ends its move on a village is asked whether to
  fight the barbarians for it. OK sends `fightVillage` with the move (`travelFigureCollecting`): the army moves, the
  battle starts at once (`initiateBattle`) and the token is never drawn by the move, even if `collectToken` is also sent (the Battle panel scrolls into view when a battle was started). The engine treats `fightVillage` as a
  plain move for a scout, a disbanding move, a square without a village or with another player's figures, and while a
  battle is active. Cancel just moves there. Zulu keep "Draw the village now?". Every civ gets the village itself through
  the conquest offer.
- **Conquest offers** (every civ for a village, Romans also for another player's city; human: always a prompt, never an
  automatic gain). Accepting a village moves its token to the player's area and its card to the hand (`collectMapToken`,
  no Chinese hut culture) plus the civ's extra: Romans advance one space on the culture track for free per village or city
  conquered, Chinese gain 3 culture per village. A decline leaves the token on the map (it can still be drawn by hand).
  The game has no conquest event, so `conquest.ts` infers it:
  1. An own army ending its move on a village token (any civ; a village drawn on the move records nothing unless the civ has an extra) or, for Romans, on a centre square of another player's city
     is stored as the player's pending conquest (`GameState.pendingConquests`, server only, one per player, a newer move
     replaces it). A scout never conquers; a disbanding move records nothing.
  2. When the battle ends (`endBattleAction`) and that player won with that army still on the square, against the matching
     side (barbarians for a village, the city's owner for a city), an offer is made (`GameState.conquestOffers`). A loss, a
     draw (the defender wins) or an army that moved away makes none. Every combatant's pending conquest is used up
     whatever the outcome (a player who only controls the barbarians loses nothing).
  3. `claimConquest` (`assisted-conquest.ts`, `{ offerId, accept }`, owner only) answers it. A stopped Roman advance (card
     choice waiting, hand over its size) refuses the answer with the reason and the offer stays; at the end of the track
     the offer is closed and logged with no gain. The village is taken after the extra; if the token has left the square or
     no village card is left, the extra is taken alone, and a civ without an extra then only closes the offer (token gone)
     or is refused with the reason (no card). A decline closes and logs the offer.
  4. The claim's undo vote reopens the offer and takes everything back (token, card, Roman advance via the effect's
     reverse, Chinese culture). Because the reopened offer can be answered again, the undo is refused, not clamped, while
     the card has left the hand, the Chinese culture is no longer all there or the Roman marker has moved on. The board
     Undo cannot take the claimed token back (`isAssistedBoardChange`), and the claim's undo seals it (`undoFloor`).
  5. The offer is kept on the `EndedBattle` record with the pending conquests it used up. Undoing End battle withdraws an
     open offer and returns those (unless the player has made a newer move), so ending again can offer again; it is refused
     (`ASSISTED_UNDO_BLOCKED`, 409) once the offer is answered: undo the answer first.
  6. Only the owner sees the offer (`you.conquestOffers`, empty in a replayed revision), as a prompt in "Your actions" and
     in the Battle panel (`ConquestPrompt.tsx`) with civ-specific accept buttons and [No thanks]. `villageGone` (token left
     the square) offers only the extra, or [Close]; `blocked` disables the Roman advance with the reason; `nothing` (no
     leader marker on the track, or the last space) says what accepting still does. The pending conquest is never
     projected.

  Heuristic limits, on purpose: the same player, an army whose last qualifying move ended on the village or city, and a
  battle won against the matching side with that army still there count as the conquest, whatever the battle was fought
  for. A battle fought by hand outside the arena makes no offer. A city that changes owner is not modelled. A city with no
  army to defend it is walked into without a battle and makes no offer.
- **Chinese:**
  - A figure that collects a **hut** (`collectMapToken`, shared with figure moves) gives +3 culture at once, with no
    battle. A **village** token or a relic gives nothing (the village's 3 comes only via the conquest offer). The culture
    is kept on the `TokenCollection`; the board Undo takes it back with the token and is refused once it is no longer all
    there (`BOARD_UNDO_TOKEN_CULTURE_SPENT`, 409). This is deliberately not clamped: a board Undo is one player alone, so
    clamping would let them spend the 3, undo, and collect the same hut for 3 more.
  - The walled capital (`cities/<colour>capitalwalled2`) is placed in setup (#374), not at the reveal.
  - Saving a killed unit (civ sheet; human design): after End battle (either side) discards the killed units' cards, and
    until the next battle starts, the Chinese combatant (attacker or defender, also against barbarians) may save one of
    their own killed units whose card is still on the pile. `chineseSaveAction` returns the card to the hand, marks the unit
    `saved`, keeps it on `endedBattle.chineseSaved` and logs it. Once per battle (`CHINESE_SAVE_UNAVAILABLE`, 409, also
    outside the window or for anyone else); a non-candidate unit is `CHINESE_SAVE_INVALID` (400). Only the Chinese player's
    view carries the choices (`you.chineseSave`, real arena ids); the opponent sees only the public line. The prompt is in
    the Battle panel and "Your actions", counted as a waiting choice. No separate undo: Undo end battle takes the save back.
- **Spanish:** the reveal sets `stats.mvmt` from `2` to `3` and logs it (human, 2026-11-24: Spain's +1 is part of the base,
  so `2+1` is kept for Natural Religion on an army). A value the player already typed is left alone. `civSetup` records
  what it set, and the reveal undo restores it only if the value is still the one it set. With Natural Religion the army
  travels 4 and a scout 3: `splitMovement` takes Spain's 1 out of the typed base (a tech replaces only what is under it:
  Sailing gives Spain 5) and `travelSpeedOf` adds it back; a typed `+` term (`3+1`) is the army's Natural Religion speed,
  as for every civ. Anarchy turns Natural Religion off, not Spain's +1. Earlier saves are migrated once per game
  (`GameState.spanishMovementMigrated`, never projected; set by `createGame` and on the first load, so new games are never
  migrated, which keeps the army and scout speed with Sailing and Natural Religion): plain `2` becomes `3`, legacy `b+k` becomes `(b+1)+(k-1)`; later
  edits are never touched.
- **Spanish free building (explore):** a tile the Spanish explore (`exploreSquare`, scout or army) gives one credit
  (`spanishFreeBuildings`, server only; credits left = grants minus applied `spanishBuild` records, so undoing the build
  returns it). The player picks a basic building (not an upgrade, wall or wonder; no unlock needed) and a square in the
  Giannini picker, shown above the phase tabs while a credit is held; the one-star-building-per-city rule is Build's
  (`legalFreeBuildings`). The board Undo of the credited tile takes an unspent credit back and is refused
  (`BOARD_UNDO_SPANISH_BUILDING_USED`) when it is spent. The build reuses effect kind `gianniniBuild`, so its seals apply.
- **Japanese strength** (human, 2026-11-24): "infantry units have +1 in strength"; strength is the wounds a unit deals
  (`ArenaUnit.attack`). `placeUnitInArena` adds 1 to the attack sent for a Japanese player's infantry card, as attacker or
  defender, and keeps it as `attackBonus` (absent on other units and older saves). The bonus is per unit and fixed at
  placement, so it is not in `combat-bonus.ts`. `rotateArenaUnit` reseeds attack as printed + `attackBonus` + level, and
  `arenaUnitTier` counts it in attack only. Metalworking's +3 stacks. A barbarian unit a Japanese player controls gets
  none. A hand edit of the attack wins until the next rotation.
- **Japanese research discount** (human, 2026-11-24): "Require 3 less trade to research new techs of any level", display
  only, all levels, Space Flight too. `researchTradeCostOf(level, civilizationName)` (`research-cost.ts`) is the one cost
  table: 6, 11, 16, 21, 27 for levels I-V (shown to everyone), 3 less for the Japanese, `null` outside levels 1-5. The Tech
  tree shows it on empty slots and Nikola Tesla checks trade against it (a Japanese player needs 13 for level III).
  Research spends no trade in the engine, so nothing is charged. Excluded by unofficial rulings 91-93, 233, 398:
  Rationalism's costs, Notre-Dame's second research, Porcelain Tower. The Japanese dial already ends at 25
  (`tradeCeilingOf`).
- **Aztecs (end of battle):** the Aztec player gains 3 trade for winning and 1 culture per unit killed (both sides
  counted) in a battle they fought as a player, not the barbarians they only control. Trade stops at the ceiling
  (`tradeCeilingOf`): only what fits is gained, logged and kept on `endedBattle`. `undoEndBattle` takes back exactly that
  and is refused (`END_BATTLE_UNDO_AZTEC_SPENT`, 409) when the Aztec player no longer holds all of it: the ender undoes
  alone, so a partial take-back would let a spent reward be earned again.
- **Aztecs (free units for Great Persons):** "each time they gain a great person, may build 2 unlocked units of their
  choice for free", modelled like Attila's Village (`assisted-aztecs.ts`). Every Great Person kept through an assisted gain
  (`takeGreatPersonMarker`: culture track, card choice, Philosophy, School of Confucius) gives 2 credits, written on the
  marker (`aztecCredits`) and in `GameState.aztecFreeUnits` (server only, never projected; the owner sees "N of M left").
  One button per unlocked unit type draws one card of that type (aircraft needs Flight) and uses a credit; the public line
  names the type, the private line the card. Undoing a use returns the card to its deck and the credit, but is refused
  while the card has left the hand or the Great Person behind the credit was undone (else a credit would come from
  nothing). Undoing the Great Person takes back its unused credits, never below 0; a unit already drawn stays.
- **Germans and Greeks** (first reveal of a tech, `revealTech`; never for the starting tech):
  - Germans: revealing a tech in `UNIT_LEVEL_TECHS` (or Flight) draws one free unit card per unit type it upgrades or
    unlocks, also when the type is already further up, with no cap (human: Logistics gives three), and logs that they may
    take one resource from the market (taken by hand).
  - Greeks: 1 culture per other player who does not have the tech revealed. Only public information counts, so the amount
    never reveals whether another player is researching the same tech (Greeks may get one more than the card says then).
    Players and hidden techs are never named.
  - Both are kept in `techRevealEffects` (server only) and taken back when the tech is taken back by undo vote or
    `removeTech` (`tech-reveal-abilities.ts`). A take-back that cannot recover all of the reward (culture spent, unit card
    left the hand) leaves a `paid` record, so revealing again pays nothing more; a complete take-back leaves none. A
    returned unit card loses its battle lock.
- **Zulu:** a city founded next to huts, or on one, collects them at once (`actions/collect-token.ts`, shared with figure
  moves; no Chinese culture). The founding line names the huts collected and those left on the map (no card left). The undo
  vote returns tokens and cards; the board Undo leaves them to the vote. Metropolis growth next to huts is still by hand.
- **Arabs:**
  - The civ reveal puts one token of each resource kind (`RESOURCE_KINDS`) in the area, as pieces of the reveal, so its
    undo removes them; a kind out of supply is skipped and logged.
  - Each resource spent gives +1 culture (`ARAB_RESOURCE_CULTURE`): the human chose 1, the FAQ 2.0 ("Advanced Arabia")
    value; the printed card says 2. Every spend funnels through `spendResource` (`assisted-resources.ts`), so it counts
    once however reached (single, any N, one of each, chosen payments, event cards, a cancellation's Spy, tokens, huts or
    villages in hand, culture cards played as a resource, `playCard` of a resource card, whose undo takes the culture
    back). The line names the resource really spent (a Marie Curie or Indian wildcard substitute is named the same in gain
    and take-back); the amount is kept on the `SpentResource` (`arabCulture`). `returnResource` takes back what is still
    there (never below 0) and says how much. A resource a cancelled ability spent stays spent, with its culture. Not
    spends: taking a token off the board by hand, a hut used as a hut (Start of Turn free tech), free coin investments.
- **Indians:** the capital is a metropolis (`cities/<colour>metropolis2`, two squares), placed in setup (#374). A token of
  any other resource (Spy and Uranium included) pays a request for incense, iron, silk or wheat, after the real resource
  and before a culture card (a card is lost, a token is not); Spy and Uranium requests get no wildcard. An Any cost (and
  its picker) has no wildcard options: it already tries every kind. The spend is recorded with `asResource` ("spent 1 Silk
  as Iron").
- **Americans:** the free great person is drawn in setup (#374).
- **Egyptians (free build):** once per turn, in City Management, the Egyptians may build an unlocked building or City Walls
  for free (FAQ, rulings 80, 81, 164). A choice offers `freeBuild` (`freeOnly` when the city could not pay); the payload
  `free: true` asks for it. It takes the city's action like any build, costs no production or trade (the caravan is not
  used up), still uses the Building Program marker, and is never split with Engineering (the first build of a split is not
  free). Wonders, figures and units are refused. The use is the turn key `civ:Egyptians:free-build`, so an undo by vote
  gives it back; a second free build in a turn is refused.
- **Undo of a gain that may be spent** (Greek culture, Aztec trade and culture, Arab culture, German free unit card): these
  are take-backs by vote (or by the ender of a battle). The undo takes back as much as is still there, says how much (or
  that a card could not be returned), never refuses and never goes below 0; a German card also copied into the battle hand
  is removed from both. Exceptions, refused once the gain is no longer all there because a clamped take-back would let the
  player earn it again: the Chinese hut culture (board Undo), the Aztec reward (End battle undo; both one player alone) and
  a conquest answer. Removing a tech by hand cannot be refused (a correction path), so it keeps the `paid` record.
- **Philosophy and great person draws:** Philosophy draws as a Great Person space does (`rewardDrawCount`: one, +1
  Organized Religion, +1 Greeks; Organized Religion adds nothing in Anarchy), keeping one through a pending reward whose
  choice takes the marker. The Greeks' extra draw applies to every assisted great person gain.
- **Markers and sealing:** walled-capital and metropolis markers lying in a player area are not cities (`ownCityPieces`,
  `cityCountOf`), so they do not block founding. The vote undo of a Roman advance (wonder, city), an Arab invest with a
  free advance, Mother Teresa, Sydney Opera House and a Zulu city that collected huts seals the board Undo (`undoFloor`),
  since their reversal writes its own board moves. A plain Advance button is not sealed.

Source: `assisted.ts`, `assisted-city.ts`, `assisted-resources.ts`, `assisted-aztecs.ts`, `assisted-culture.ts`,
`assisted-conquest.ts`, `conquest.ts`, `tech-reveal-abilities.ts`, `movement.ts`, `research-cost.ts`, `actions/arena.ts`,
`actions/collect-token.ts`, `actions/undo.ts` under `packages/engine/src/`; server `routes/assisted-args.ts`; web
`GameView.tsx` (`BattlePanel`), `ConquestPrompt.tsx`, `BoardView.tsx`.

### Setup phase (#374)

Human, 2026-11-24 (answers in issue #374). One-time per player, steps in any order, shown as a **Setup tab first in "Your
actions"** (not a `TurnPhase`, not part of Start of Turn). Engine: `setup.ts` and `assisted-setup.ts` (`setupGreatPerson`).
Route `POST /api/games/:id/setup` (steps capital, figure, trade, wonder, finish, pass; `undo`).

- **Who:** `Playerhand.setup` is written when a civilization is revealed while the player's turn-1 Start of Turn is not done.
  A later reveal, and every save from before setup existed, has no record: no Setup tab, no gate.
- **Derived status:** step status is read from the board and hand (capital on the map, own figures on the map, a social
  policy, the great person record, Egypt's wonder on the map), so manual board edits cannot desync it. The record keeps only
  `required`, `finished`, the counted trade and which pieces setup placed (`placed`, `historyIds`).
- **Capital:** one of the four central squares of the player's own starting tile, not water, nothing on it. Chinese get
  `capitalwalled2`, Indians `metropolis2` (an anchor square and a direction, both squares central), others `capital2`. It can
  be moved until setup is over; moving lifts the steps that depend on it (counted trade is taken back, setup's figures and
  Egypt's wonder go back to the area). A civ marker already in the area from an older reveal is reused. The reveal places no
  city marker. Setup only moves or undoes a capital it placed itself.
- **Figures:** one colour army and one scout from the supply on legal squares in the capital's outskirts (on the map, not
  water, no city, within the stacking limit counting all the player's figures, no foreign figure for a scout). Russians move
  their white army and Spanish their white scout from the area (placed at the reveal).
- **Social policy:** `chooseSocialPolicy`; done at one policy, two for the French (`startingSocialPolicies`; see "Social
  policy slots"). A French player who finished setup with one policy is not reopened; one still in setup needs the second.
- **Great person (Americans):** an assisted action like Philosophy, `phase: 'ANY'`: a random draw of 1, or 2 with a revealed
  Organized Religion, one kept through `chooseReward`, the other discarded public; the marker goes to the player's area. It
  needs a policy and none hidden (the draw count must not leak a hidden policy). Undo is the normal vote, never solo, so a
  random draw cannot be re-rolled. The public line names no card (marker type and item number are public).
- **Starting trade:** the trade icons in the capital's outskirts, counted as the Trade phase does (`tradeAroundCitiesOf`,
  capped by `tradeCeilingOf`), added to `stats.trade` and recorded; solo undo takes back exactly that (floor 0). It does
  **not** touch turn 1's `tradeCollected`: the normal Trade collection of turn 1 adds more.
- **Government:** forced by the civilization, an automatic row. `startingGovernmentFor` gives the Greeks Democracy (with its
  coin counter; undoing the reveal clears it). Existing Greek players are not migrated.
- **Egypt's wonder:** the wonder dealt into Egypt's area at the reveal is placed in setup on an empty legal square in the
  capital's outskirts.
- **Gate:** `markPhasesDone` refuses Start of Turn done, also through `upToPhase`, with `SETUP_INCOMPLETE` (409) until the
  steps are done (capital, figures, policy, trade, plus great person for Americans and wonder for Egyptians), per player. A
  pass records `finished`, so removing the capital by hand later does not close it again. The End turn buttons on the other
  tabs and the Order tab are disabled with `you.setup.blocksTurn` while a step is missing; a complete but unfinished setup
  lets them through, and that press finishes setup implicitly.
- **Finish setup:** a primary button in the Setup tab (`{ step: 'finish' }`), enabled when `blocksTurn === null`. It sets
  `finished` and logs "<name> finished setup" once; the Setup tab goes. Refused with `SETUP_REFUSED` (400, the gate's
  reason) while a step is missing; a repeat answers the same state.
- **Passing the turn on:** civilizations are chosen in turn order, so a player can hand the turn on before finishing. **End
  turn on the Setup tab** calls `{ step: 'pass' }` (`passSetup`), never marks a phase, sets `PlayerSetup.passed` and logs
  "<name> passed the turn on in setup" (no card named). It needs a civilization and an open setup; idempotent; steps stay
  doable and nothing is blocked or lifted. `you.setup.passed` is the viewer's own.
- **Holder follows passes:** `turnHolder` (`turnHolderStage` in `turn.ts`) has a setup stage that exists only in the first
  turn and applies while some player has `passed` and has never marked Start of Turn done (`passed` is not cleared, so later
  turns and a passer who has marked it do not count). Finishing their setup afterwards does not end it (the pass was made so
  the next player can choose a civilization). The holder is the first player from the start player clockwise who has not
  marked Start of Turn done and has no civilization yet or a required setup that is neither finished nor passed;
  `activeTurnStatus.stage` is `'setup'` and the header says "choosing civilization / setup". With no such player the normal
  rule applies. The same holder drives the out-of-turn draw warning (`requireTurn` in `actions/draw.ts`: after a pass the
  passer gets `NOT_YOUR_TURN` on a draw, the stage holder does not) and the 72-hour turn reminders (`turn-reminders.ts`).
  `turnHolderChanged` mails the stage holder "choose your civilization and do your setup" and a holder with an own
  unfinished setup "finish your setup"; `finish` and `pass` call it (best effort). Setup steps pass the actor's id
  (`actorId`), so they never mail the player who pressed the button.
- **Undo:** capital, figure, trade and wonder each have a solo undo (one player alone, refused while a later step needs
  it), idempotent when the step is not done. Setup pieces are sealed against the board Undo (`isAssistedBoardChange`).
  Undoing the civ reveal is refused after setup progress (`CIV_REVEAL_SETUP_STARTED`, 409; undo the steps first).
- **Hidden information:** `you.setup` is the viewer's own; opponents and spectators get only the public `SETUP` log lines.

### Social policy slots (#378)

Human, 2026-11-24: keep the flow (the player is scrolled to the Social policy panel and chooses there); add the French
extra policy, the pick after a new city and a limit. Rule: Wisdom and Warfare rulebook p. 10, "Social Policies". Engine:
`social-policy-slots.ts` (`socialPolicySlots`, `startingSocialPolicies`), `chooseSocialPolicy`.

- **Derived, never stored:** `maximum = cities + (French ? 1 : 0)` (`ownCityPieces`: capital, city and metropolis pieces of
  the player's colour whose centre is on a playable map square, so a marker in a player area, the wonders area, a gutter or
  off the board does not count; a conquered city counts), `held` = policies held, `free = max(0, maximum - held)`. Until
  the player's setup is finished `cities` is at least 1, so the starting policy can be chosen before the capital is
  placed; afterwards the real count rules, so losing the last city leaves no slot (a game saved before setup existed keeps
  the floor). A manual city, a conquest, a nuke or an undo of the city moves the maximum with no bookkeeping.
- **Enforced on choosing only:** `chooseSocialPolicy` answers `SOCIAL_POLICY_LIMIT` (400) when `free` is 0, after the
  already-held and flipside checks. Removing is unchanged, so a switch (Bureaucracy, culture cards) is remove then choose.
  Anarchy keeps the policies (rulings 389-390): they still count.
- **Over the cap is shown, not enforced:** after a city is lost `held` can exceed `maximum`. The rulebook has the player
  return a policy of their choice; the game does not force it, the panel says "remove one" and choosing is blocked until
  they do.
- **View:** `you.socialPolicySlots` `{ maximum, held, free }` is the viewer's own and counts only (no policy name); `null` in
  a replayed revision. Opponents keep `numberOfSocialPolicies` and get nothing new.
- **Web:** a status line above the picker says how many more may be adopted or why none; Choose is disabled with that reason
  at `free === 0`. The page scrolls to the panel (`goToPanel('social-policy', true)`) when the maximum rises above the value
  last seen in this session and a slot is free (taking a policy back does not move the page), not on first render and not
  for a replay. The found-city log line says "may now adopt another social policy" when `free > 0`.

## Reopening a phase (2026-10-23)

- **Reopen** marks the viewer's latest ended phase of the active turn not done (`/turns/undone`, `unmarkPhaseDone`). It
  does not cascade: later ended phases stay ended (the note says so), and nothing else moves: the active turn and who is waited for derive from the done flags. Only the active turn is offered (reopening a finished Research would pull
  the game back). The request carries `rev`, so a stale press answers 409.

## Toasts (2026-10-23)

- Every game-page action ends in a toast: green success (7 s, human), red failure (about 8 s or closed); hover holds it.
  The in-page error box remains only before the game loads. Both live regions stay mounted for screen readers. Toasts clear on leaving the game or signing out.
- Green text comes from `GET /api/games/:gameId/confirmation?after=<revision>`: the player's own private log text for
  revisions they made after the page's, else the public line, else "Done". Revisions by others never count, so another's
  action is never shown as theirs. The route reads by caller id and needs sign-in, so no other player's private text can be
  returned. It is separate because the history list keeps public naming even for the owner.
- The client turns the viewer's own name into "you"/"your"; a fetch failure shows "Done" without failing the action.

Source: `packages/web/src/lib/toasts.ts`, `confirmation.ts`, `views/ToastRegion.tsx`, `packages/server/src/routes/games.ts`.

## Trade offers (#265)

**Offers.** An offer is an explicit state record in the Trade tab, not chat. Terms are free prose, never parsed or
executed: accepting records an agreement only, and players settle with the existing trade controls.

- Only the intended sender or recipients may perform each transition; revision checks and request ids make retries and
  competing writes deterministic.
- The public view shows participants, terms, turn/phase context and status, never request ids or effect data. Deals are
  public to every viewer, spectators included.
- An offer goes to one, several or all other players. One recipient: accept, decline or counter. Several: each acceptance
  means "I would"; the sender chooses among acceptors; declined when all decline; a counter from one leaves it open for the
  others. A counteroffer is a new offer linked by `parentOfferId`, forming a thread.
- Pending offers expire when a later turn is observed; accepted offers never expire.
- The Trade tab shows the current turn's deals with buttons; the chat's Trade deals tab (`TradeDealsPanel`) shows all
  deals read-only by thread and turn.

**Trade number.** The Trade tab and Status share `stats.trade`; Status is the master. The engine sets it at the rules'
moments:

- When the next turn starts, a player who chose a tech during the ending turn's Research (`Playerhand.researchTurns`,
  private, including a turn marked ahead) drops to their coin total, capped at the track. Revealing is not required; ending
  Research without choosing keeps the trade; removing a tech clears its marker. A free tech learned in Start of Turn is not research.
- When Start of Turn is marked done, the trade around the cities is added once, capped at the track, and recorded in
  `PlayerTurn.tradeCollected` so undoing Start of Turn subtracts exactly that. A player who marked the new turn ahead is
  caught up after the reset. Marking Trade done or reopening never counts again.
- A hand-set trade (`setPlayerStat` writes `trade:set`, `TRADE_SET_KEY`) is the override: before collection it skips the addition, after it clears the record. "This turn" is the game's current turn, so a player a turn
  ahead loses the marks at rollover. A turn saved before this rule and not yet collected gets a guess (`tradeEstimateOf`).
- The track ends at 27, 25 for the Japanese (human; `tradeCeilingOf`, also Marco Polo). `setPlayerStat` refuses more
  (`TRADE_ABOVE_CEILING`); "Add N" never lowers a balance already above it. Other gains are not trimmed yet.

**Trade around cities** uses the production outskirts walk (`CityProduction.trade`): printed trade icons (`tile-icons.json`,
read by eye, unchecked), or a building's or Great Person marker's trade in place of icons (Artist 1, Humanitarian 1,
Scientist 2); nothing for a blockaded or wonder square. A square shared by two own cities counts for each. A scout's sent
square counts for the receiving city (#292), read like outskirts but never blockaded; nothing counts twice, and the owning
city loses it. Never a complete count: governments, techs, policies, wonders, card abilities and trade limits are not
counted, and the notes say so.

Source: `packages/engine/src/trade-offers.ts`, `trade-estimate.ts`, `trade-collection.ts`, `city-production.ts`,
`limits.ts`, `actions/turn.ts`, `actions/new-turn.ts`, `actions/player.ts`, trade routes in
`packages/server/src/routes/games.ts`, `web/src/views/TradeOffers.tsx`, `TradeDealsPanel.tsx`.

## City production

`cityProductionsOf` estimates production from the board and revealed cards only, so every viewer gets the same figures
(`cities` is public). It is never a complete count; a hand-set `BoardPiece.productionOverride` (any player, 0-99,
board-undoable) always wins.

- Outskirts: forest 2, mountain 1, else 0 (human; forest matches base p. 26). A building replaces every icon on its
  square (p. 16) with `building-data.ts` values (the human's table). A Great Person marker replaces terrain (Builder 2,
  Humanitarian 1, Scientist 1). A wonder square counts 0, noted. Enemy figures blockade.
- Added per city: Infrastructure (`stats.infra`, max 3), Despotism +1, Chichen Itza +3 (owned, unblockaded), Susan B.
  Anthony +2, Military Science +1 per 3 coins. A Building Program marker doubles only the outskirts (W&W p. 7). Communism,
  Urban Development, Great Lighthouse and one-turn cards are noted, not computed.
- A square in two own cities counts for each, noted (legacy data; cities cannot overlap when built). An off-map city piece
  is not listed, so the status city count can exceed the list.

Source: `engine/src/city-production.ts`, `building-data.ts`, `blockade.ts` (`cityFootprintsOf`), `actions/board.ts`
(`setCityProductionOverride`), `web/src/views/CityCard.tsx`, `YourCities.tsx`.

## Assisted build

`buildOptionsOf` (own view only) lists what each city may build and where; `build` places, pays and logs in one step and the
vote undo reverses it. It covers buildings, wonders, figures (placed) and military units (private card).

**Costs and legality**

- Only legal choices are listed; the rest appear under "Why not the others". Cost above production is such a reason; the
  way out is a hand-set production (human). Rush (p. 15): 3 trade per production (Americans 2 per 3), whole steps, never
  more than needed.
- **Unit cost** (p. 15-17): 5/7/9/11 by level (`stats.infantry/artillery/mounted`, 1-4), aircraft 12 with revealed Flight;
  army 4, scout 6. The level is the higher of the hand-set status value and the revealed techs (`UNIT_LEVEL_TECHS`:
  Chivalry, Democracy, Mathematics, Logistics -> II; Railroad, Gunpowder, Metal Casting -> III; Combustion, Replacement
  Parts, Ballistics -> IV); a reveal raises the status value, never lowers it. Unrevealed techs count for nothing. Card
  effects on unit cost (Leonardo's Workshop) are not applied; use a hand-set production.
- A building needs a revealed tech (`BUILDING_TECH_UNLOCKS`, the human's sheet). Once the upgraded form is unlocked only it
  is built, and its tech alone suffices (p. 22).
- Squares: own outskirts, never a centre or city-state, terrain allowed by `BUILDING_TERRAIN`, nothing built (see
  Replacing), no enemy figure (p. 27). The terrain table is advisory for manual placement and binding for Build.
- One limited building per city (Market/Bank, Temple/Cathedral, Barracks/Academy; p. 16-17), counted over its outskirts
  whoever built it; supply is the shared pool in `board.ts`. A shared square of two own cities may allow a second; no
  ruling found, not handled.
- Production used: hand-set, then doubled, then estimate. A Building Program marker on the centre is used up by any build
  and restored by undo.
- **Caravan** (F&F p. 7, human 2026-10-30): a caravan marker on a centre adds 2 to the production used (never doubled), and
  every Build in the city uses it up, needed or not (`effect.caravan`, restored by the undo vote, board Undo refused).
  Devote and Harvest keep it.
- One action per city per turn (p. 15, human): Build, Start Building Program, Devote and Harvest count; Upgrade does not.
  A second asks and sends `confirmedRepeat`; without it the engine refuses (`used`, 409) after all other checks. Undone
  actions and earlier turns do not count. No automatic city-action-used marker: the player ends City Management themselves
  (human).
- Placement is by tapping the square without Confirm (human), except a square with a note (enemy figure, replacement),
  which needs Confirm. Units keep Confirm. Rush trade is paid at the tap.
- **Take-back** (human): while City Management is not marked done, the owner removing a piece a build or Start Building
  Program placed (even if moved) runs `takeBackOpenBuild`: the vote undo's effect plus a System line "It was removed before
  End turn."; the build line stays (deleting log lines would renumber board history counts). It closes any open undo vote
  on the line and sets `board.undoFloor`. Otherwise removal is plain with no refund. Upgrades and units are not taken back.

**Wonders** (p. 17)

- Any city may build a faceup market wonder (`marketWondersOf`). The cost (printed, or discounted with a revealed tech;
  `wonder-data.ts` equals the `Wonders` sheet by test) is **enforced like a building** (human, 2026-10-30): rush trade is
  paid, refunded on undo; hammers from cards and Great Persons count through a hand-set production. Angkor Wat is 15 with
  Theology (`SHEET_CORRECTIONS` until the sheet is fixed); Philosophy on the tech sheet is from later rules and gives no
  discount (human, 2026-10-30).
- Placed in outskirts on any non-water square, empty or holding the player's own building/wonder/Great Person, no enemy
  figure; one per city, not counted as the limited building. The market piece moves onto the square and gains its owner.
- **Next market wonder** (human): the build draws the next wonder: ancient until four ancient are out, then medieval, then
  modern; "out" counts cards that left the deck, so removing a piece from the board frees nothing; nothing after twelve.
  Drawn as its own System line, guarded from board Undo. Vote undo and take-back return the wonder to its market spot,
  clear the owner, put the drawn wonder back on top of its deck, and floor board Undo. The vote undo is refused once the
  drawn wonder left the market or has an owner; the take-back then is a plain removal.

**Replacing** (p. 17-18, human)

- A building or wonder may be built on the player's own building, wonder or Great Person (outskirts pieces count as the
  city owner's). The old piece is removed first (`removeReplaced`), then legality is checked. A building returns to supply;
  a wonder is destroyed for the game; a Great Person goes to reserve. Another player's wonder or a city-state blocks the
  square. With one wonder or limited building already in a city, a new one may only replace it (`onlyReplacingOf`). With no
  supply left, a building may replace one of the same supply group (`sameSupply`). Replacing an identical building is
  allowed.
- **Great Person replaces, not covers** (p. 18, human's choice): placed on a building/wonder it removes it. A replaced
  Great Person goes to the owner's player area in reserve, without effect, re-placeable by hand at any start of turn.
  Removing a marker later restores nothing. A manual drop in the outskirts of the placer's city
  (`replaceUnderGreatPerson`; nudges and re-drops on the same square replace nothing) removes the building/wonder and
  reserves any other Great Person as separate board-undoable entries; another player's wonder is left alone. Destroying a
  wonder by drop is confirmed first on every input path. A building dropped by hand on a Great Person is not automated.
- Vote undo and take-back restore the replaced piece exactly (`replaced`, `reserved`); board Undo cannot undo the removal
  alone. Known gap: a take-back restores the old piece even if another was placed there by hand since.
- **City Walls** (p. 17, Masonry, 7 production): a centre building with no square (`placement: 'none'`) that flips the city
  marker to its walled asset via the `flip` board change, one per city. Its +4 counts in a battle for the city (see Coins,
  wonders and blockade). No take-back by removal; the vote undo flips back.

**Figures and units**

- Figure squares (p. 15-17): outskirts, never centre or city-state (except held ones below), water only with
  Sailing/Steam Power/Flight, below `stats.stacking` (read-only, default 2); supply 6 armies and 2 scouts per colour. A
  scout is not offered a blockaded square; an army is, with a note that the outcome is manual. Hut/village squares are never
  offered (human).
- **Held city-states** (W&W p. 9, human, #319): a city-state the player holds (`cityStateHolderColour`, as for Brandenburg
  Gate; army or scout) is part of their capital's outskirts, so the capital may build a figure on it under the same
  stacking, water and blockade rules. Other cities, buildings and wonders may not. The capital's production and trade
  estimate counts each held city-state's printed trade (cs1 3, cs5 1) and production (cs3 1, cs5 1); there is no base +1
  trade per city-state (Expansionism's 1 is its own Start of Turn gain); culture, coin, resource and combat icons are not
  counted.
- **The metropolis is the capital** (human, #319): only the capital can grow into a metropolis, so `capitalOf` falls back
  to the metropolis when no capital marker is on the map (held city-states, unsent scouts).
- **Navy** (#354; human, 2026-11-15; rulings 186 to 189): "Each time you build an army with a city action, you may place
  that unit in the outskirts of a city with a shipyard."
  - With Navy revealed (chosen but unrevealed changes nothing), an **army** (not scouts or other items) may go in the
    building city's own outskirts or the legal squares in the outskirts of any own city with a Shipyard piece
    (`shipyardCellsOf`). The building city pays and uses its action; only the square may lie elsewhere.
  - Normal army rules apply per square; water still needs revealed Sailing, Steam Power or Flight (a Shipyard alone does
    not allow water). A capital with a Shipyard counts its held city-states as outskirts, so another city may build on one
    (rulings 39, 188).
  - Ruling 189 (an army may be placed where enemy figures stand, a battle follows, except on the Shipyard square itself when
    an enemy figure stands on it) refuses a square only when reached through the other city; the building city's own
    outskirts keep the older rule, and the battle stays manual.
  - `build` checks the target against the choice's `squares`; the refusal reads "... is not in the outskirts of that city
    or of one of your cities with a Shipyard." The web only shows `choice.squares`.
  - **House rule** (human, 2026-11-16): a Military Dock counts as a Shipyard, including the enemy-on-dock restriction;
    upgrading the building does not remove Navy eligibility.
  - Source: `build-options.ts` (`figureCellsOf`, `figureSquaresOf`).
- A unit card is drawn like Draw (reshuffling discards when empty) hidden into the hand; the public line names only the
  type and no item line is written. Undo returns it and reshuffles that unit deck so the next card is unknown (human); a
  build-undo-build may draw differently, accepted.
- **Reposition a built figure** (human, 2026-11-24): an army or scout that a Build placed can be moved to another legal
  square of the same city, free, while that City Management is open (the `takeBackOpenBuild` boundary: applied build,
  owner, current turn, CM not marked done).
  - Nothing is paid or refunded and the build stays one applied action. Squares follow the build's own rules
    (`figureSquaresFor`) computed without the figure itself; its own square is not offered. Refused when the figure has
    travelled this turn, was dragged off its square, or a later applied action names it (a scout sent to a city, a city
    founded). Buildings, wonders, units and walls are not moved.
  - The build's record follows the figure so its undo vote still removes it. The move's history entry is listed in
    `effect.repositioned`, so the board Undo, sealed for a build's entries, cannot send it back. A public log line says
    "moved the army from B3 to C2" (human, 2026-11-24).
  - `you.repositionableFigures` is own view only and blanked in a replay. The web shows blue squares for the selected
    figure; dragging it onto one (human, 2026-11-24) makes the same call; a drop elsewhere springs back. The `/travel`
    route has no phase check.

**Other city actions**

- **Start a Building Program** (W&W p. 7): free city action in open City Management, one marker per city (either
  metropolis centre counts), placed on the anchor centre. Its undo is refused while the marker is used.
- **Upgrade** (p. 22): flips the player's basic buildings of a family once the upgraded tech is revealed. The player's
  buildings are those in own city outskirts (`cityFootprintsOf`, never `placedBy`). No cost, no phase gate, by button only.
  The flipped piece keeps its square, centre and original `placedBy`. Undo restores original ids on top of the stack (z
  order not restored). Known gaps: a square in two players' outskirts lets both list it (first press wins); the record's
  `phase` reads CM when every phase is done.

Source: `engine/src/build-options.ts`, `build-reposition.ts`, `city-actions.ts`, `building-data.ts`, `wonder-data.ts`,
`assisted.ts` (`build`, `startBuildingProgram`, `upgradeBuildings`, `takeBackOpenBuild`), `actions/board.ts`,
`server/src/routes/board.ts`, `web/src/views/BuildPicker.tsx`, `CityActions.tsx`, `buildFlow.ts`.

## Devote to the Arts and Harvest

City actions `devoteToTheArts` and `harvest` on the assisted contract. `cityGatheringOf` reads from the board only;
`cityActionsOf` adds status and the projection carries it in `you.cityActions`. Payloads are parsed strictly.

- **Icon data:** resource icons and natural-wonder culture are in `engine/data/tile-icons.json`, read by eye from tile
  images (base p. 7 key) in printed orientation. Unchecked against a printed list; manual paths remain. A tile with no
  entry is unknown, not empty.
- **Devote** (p. 17; metropolis base 2 from F&F): 1 culture (2 metropolis) plus each outskirts square's culture: a
  building's `building-data.ts` row, a wonder 1/2/3 by era (`WONDER_CULTURE`, also when obsolete), a Great Person marker
  (Artist 2, Merchant 2, Humanitarian 1), each replacing printed icons; else a natural wonder icon. Enemy-occupied squares
  give nothing. Civ, government, tech and card effects are not counted (named in the panel). The player may type another
  number (0-99, `MAX_DEVOTE_CULTURE`), logged against the estimate.
- **Urban Development** (human's reading): +2 culture when the city's outskirts hold at least two different kinds of
  buildings/wonders (two Temples count once, a wonder always counts, Great Persons and blockaded squares do not). Only a
  revealed policy counts, none under Anarchy (human). The sum is in the owner's view only. Its production half is only
  noted.
- **Indians:** +1 culture per outskirts square with an uncovered, unblockaded resource icon when devoting.
- **Harvest** (p. 18): one token of a resource whose icon is in the outskirts goes to the player's area as
  `resources/<name>`. Blockaded squares give nothing. A resource under a building, wonder, Great Person or disaster token
  is covered (human, also for scouts); a disaster token also covers culture for Devote (human). Market supply is as many as
  players, max five; an exhausted kind is disabled. Angkor Wat's second harvest is not built. Harvesting one icon twice a
  turn (FAQ) is only noted.
- **Scouts** (p. 26): a scout outside the city's outskirts is offered with its square's culture/resource and what stands
  on it, read with no blockade, for the city it is sent to (see Phase tabs). Whether it was placed last turn is not tracked.
- **Undo:** Devote is refused when the culture has been spent; Harvest when the token left the player's area. Board Undo
  cannot take the token alone.

Source: `engine/src/city-gather.ts`, `tile-icons.ts`, `wonder-data.ts`, `great-person-data.ts`, `terrain.ts`,
`city-actions.ts`, `assisted.ts`, `web/src/views/CityGather.tsx`.

## Accounts, mail and ratings

- Legacy SHA-1 accounts upgrade to scrypt on successful login.
- Password reset uses a separate derived signing key and expiring token; unknown-email responses must not enumerate
  accounts.
- Registration's fixed Writing answer is a spam speed bump, not a security boundary.
- Game creation sends no email. Ordinary notifications (including battle-turn mail) are held per player and game until
  the player opens the game; if not opened, one more may go after 24 hours. Opening re-arms the next message. Final
  messages are exceptions.
- Idle-turn reminders target a holder waiting over 72 hours, once per unchanged activity version; opening the game does
  not reset activity.
- Queued broadcasts keep indeterminate sends claimed until explicit resolution, with a release cooldown, to avoid
  duplicates. Respect opt-outs and current addresses at send time.
- Historical ratings use conservative available evidence; current results use board culture position and coins. Display
  scaling by 100 does not change the stored rating.

Source: `packages/server/src/auth.ts`, `routes/auth.ts`, `notifications.ts`, `turn-reminders.ts`, `store/rating.ts`. README
has operational configuration and migration instructions.

### Caching and new deploys

- Content-hashed `/assets/` files are cached for a year (`immutable`, `packages/web/public/_headers`); `index.html` keeps
  the host default (`max-age=0, must-revalidate`).
- `vite build` writes a build id (`__BUILD_ID__`) and `/version.json` (`no-store`); `UpdateBanner` offers, never forces, a
  reload when the deployed id differs (checked on visibility and every 5 minutes; off under `vite dev`). Id:
  `WORKERS_CI_COMMIT_SHA`, else `GITHUB_SHA`, else build time.
- Unverified until deployed: that `_headers` applies to the Worker's `env.ASSETS.fetch` responses.
- In development the web app imports the engine from `packages/engine/dist`; engine changes need
  `pnpm --filter @civ/engine build` (or `tsc --watch`) and a reload.

## Private games and board area colour (#347, #348)

- A game created with `invitedUsernames` is private: `GameState.invitedPlayerIds` holds the creator and the invited
  account ids (absent on a public game, so no migration). `joinGame` answers `NOT_INVITED` (403) to anyone else, a
  withdrawn player's seat included.
- The creator must name exactly `numOfPlayers - 1` distinct, existing, enabled accounts other than themself (nobody else
  can join, and fewer would leave a game that never starts). A malformed `invitedUsernames` is a 400, never a quietly public
  game. Each invitee is mailed the game link once, without the per-game hold.
- A seat freed by a withdrawal in a private game can only be retaken by an invited account that is not seated. The invite list cannot be
  changed afterwards.
- The invite field autocompletes from `GET /api/players/search?q=` (signed in; usernames only, caller and disabled
  accounts left out, prefix matches first, at most 8).
- A private game stays in `/api/games` and `/api/public/games` for everyone; the summary's `mayJoin` is false for a viewer
  who is not invited and the lobby then shows no Join button. Anyone with the direct link can still spectate, and a
  finished game still counts in the highscore; the invitation controls who may play.
- On the board, a player's area is filled with their colour (not only the border and name tab), and the shared Wonders area
  with the wonder accent, in every theme.
- The invite mail is not throttled: any signed-in account can mail any enabled account an invitation, and the game name is
  the sender's text. The repo has no rate limiting anywhere and the mail carries the unsubscribe link; add a per-sender
  limit if it is ever abused.

