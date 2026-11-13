# Known limitations

Observations, not an authorized backlog. Recheck the cited code before acting.

## Game behavior

- **Legacy board layouts:** pre-shape three- and five-player saves that already
  hold pieces keep 16×16 rectangular slots; only an empty three-player board is
  moved into the pyramid. On the legacy five-player rectangle, player 5 shares
  player 1's starting corner. `engine/test/board.test.ts` pins this; reshaping
  would move existing pieces.
- **Legacy wonder hands:** older saves may keep wonder cards in `player.items`.
  Migration counts them for `wondersDealt` but does not move them to the board.
- **Legacy Egypt setup:** older saves backfill `wondersDealt` from
  `hasWonder || setupComplete`, so an Egypt revealed earlier never gets the
  three-ancient/one-medieval deal. Deliberately forward-only (`migrate.ts`).
- **Zulu starting units:** `actions/player.ts` deals four artillery; the
  printed/legacy rule may be three. Ask the human before changing it.
- **A square another scout sends:** the Start of Turn panel still offers the
  second scout's city choice; choosing a city is refused with a reason (#319).
- **Scout-held Bank coins:** board derivation does not model scout transfers;
  the Sheet is the manual correction.
- **Game-chat permissions:** `POST /api/games/:gameId/chat` checks login and
  game locking, not membership, so a non-member can post although the UI hides
  the composer. Whether that is intended is undecided.
- **Ending on an own city centre:** F&F p. 7 lets figures cross friendly
  centres "as long as they don't end their movement there"; travel still lets a
  figure that is not disbanded stop there (the #319 centre-scout rule assumes
  it). Ask the human before forbidding it.
- **Who opens the arena:** the defended city is found from the battle's
  attacker (the initiator) standing on the defender's city. If the city's owner
  initiates against the army in their city, no city bonus is counted and the
  fortification stays. Ask the human whether to look both ways.
- **Arena edits:** `runBattleAction` in `GameView.tsx` returns early while busy,
  so a debounced stat save can be dropped (found by inspection, not reproduced).
- **Revealed feed:** the history fetch is capped at 100 items; there is no full
  pagination.
- **Trade offer retries:** the chat panel keeps one request id per offer until a
  send succeeds. If the server stored an offer but the response was lost and the
  player never retried, sending the same words later returns the old outcome.

## Storage and delivery

- Archived Mongo `pbf` data is for historical statistics only.
- Manually deleting a middle revision delta is unsafe; use cleanup/compaction.
- Broadcast recipient claims and `lastRunAt` are separate writes in
  `notifications.ts` (a small release-stuck race). Never auto-retry an
  indeterminate send to work around it.
- Production deployment, D1 migration and scheduled-mail status must be checked
  in the target environment.

## Scope

- No tournaments or websockets; refresh polls.
- Bearer tokens cannot be revoked individually; disabled accounts are checked
  per request.
- Some card images exceed 1 MB.
- Player status sidebar (#342): the per-source Coins counters can only be edited in
  the Player status panel's Coins tab, so that panel cannot be retired yet.
- Player status sidebar (#342): with an editor open, tapping another stat saves the
  open one first. The editor row closes and the grid shifts up, so that tap can miss
  and a second tap may be needed.
- Display settings (#342) are per browser: two tabs in one browser do not sync, and
  the tab that saves last overwrites all three values. Auto zoom still uses the
  old fitting steps.
- Asset regeneration needs untracked source material. Check that local Military
  Science artwork is the intended replacement before running the generator.

- Jim Henson's wound markers are kept on the hand (`hensonWounds`), not on the card: if the card changes hands or is discarded and drawn again, the count stays with the player. Wonders put on the board by hand add no wound.
- A. P. Giannini's Start of Turn section stays hidden when no building can be placed, with no explanation. Frida Kahlo is listed as ready on the culture start space and refuses only when played.
- Zheng He's look is a list in the private log; the map shows no marker on the squares it read. A token drawn from keeps its piece on the map, and a later look would give that piece a new item. An undone draw puts the item in the shuffled deck, so earlier lines can then be stale. A piece collected into an area is not listed by a later look.
- Jerry Garcia's all-city devotion counts no scout's square and offers no Charles Darwin conversion; a figure can be corrected on the culture counter by hand.
- Unit tech abilities (#327): wounds dealt by Mathematics or Ballistics cannot be undone (health is corrected by hand). Gunpowder's effect (obsolete a wonder or destroy a building) and Combustion's building or wall removal stay manual, and a Combustion undo only frees the turn's use. Combustion never targets the player's own walls or buildings in the outskirts of their own city; a building in the outskirts of cities of two colours has no owner and is a target. Marie Curie's armed substitute still replaces a real Uranium token in a payment (existing behaviour, not changed here), so Gunpowder naming Uranium while she is armed pays the substitute resource. With her armed and both the substitute token and a real Uranium token in hand, Gunpowder's warning (or its needs-resource block) can disagree with what a payment would spend; the hand-set tokens decide.
- Tech resource abilities (#327, slice 2): a production boost is derived from its record and a Build does not consume it, so undoing the boost after a Build used it does not refund that Build. The cancels (Writing, Civil Service, Mass Media) never stop the cancelled action; Monarchy's obsolete and the wonder coin of Education stay manual. Writing is available in any open phase (human), although its card says City Management. The free tech of Education is not listed in the City Management tab: the page goes to the tech tree when it arrives and the Start of Turn view lists it. Monarchy's kill never picks a unit placed in an arena (open rules question for the human: is that right?); Philosophy's undo reshuffles the Great Person deck.
- Metalworking, Atomic Theory and Bureaucracy (#327, batch 2): Metalworking adds to the typed attack and cannot tell a unit "played from hand" from one already in the arena. A nuke leaves a figure on the city's centre square, resource tokens, huts and city-states, and does not touch records that refer to destroyed pieces (undoing an earlier build of a destroyed building afterwards may refuse); the nuke's undo refuses only when a piece of the city is on the board again or a city now stands on one of its centre squares, so a figure or building that has moved onto an outskirts square is stacked on by the restore; a nuke of a player's own city, and of a capital, is refused (reading of the card: confirm with the human). Atomic Theory's extra action is per city and not tracked against the cities' production. Bureaucracy only logs: the policy switch itself is by hand and is not limited.

## Battle cards

- Leonidas and Joan of Arc cannot be played after End battle (Florence Nightingale can); the ender can Undo end battle,
  play the card and end again. Sun Tzu's pass has no undo (the trade is corrected by hand).
- Florence Nightingale marks the units killed at the time she is played; a unit killed later is not saved.
- Zhukov's wound has no undo, and a kill taken back after a wound was dealt leaves that wound dealt (the next real
  kill then earns none). He is counted from the moment he is played; units dead before are not owed.
- Gustavus Adolphus counts "unlocked" as the unit decks infantry, mounted and artillery, and aircraft with Flight; unit
  levels are not checked. The battlehand is not emptied by End battle (only by Reveal battlehand or a new draw), so
  with no battle on Gustavus also counts units that fought and came back to it; reveal the battlehand first.
