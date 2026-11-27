# Known limitations

Observations, not an authorized backlog. Recheck the cited code before acting.

## Game behavior

- **Engineering:** cancelling the first build of a split also takes back the second, which the cancel list does not say;
  cancelling only the second leaves the first. Remaining production comes from the first build's recorded cost and production,
  so a hand-set production changed between the two builds is not seen. Engineering is offered only when the build is the city's
  first action: a build that is itself an extra action (Atomic Theory, Lovelace, a confirmed repeat) cannot be split.
- **Setup phase:** a game revealed before the setup phase existed, and a civilization revealed after turn 1's Start of Turn,
  has no setup (no tab, no gate); the player places the capital by hand. Existing Greek players keep Despotism. Starting
  trade counts printed trade icons only (no techs, policies or governments). The American great person needs a revealed
  policy before the draw. Setup checks a capital square with the founding rules, which cannot refuse on a fresh start tile. A player passes the turn only with End turn on the Setup tab (the Order tab's End turn is held back
  while a step is missing); before any pass the holder is the start player.
- **Social policy cap:** a lost city does not force a policy back: the panel prompts and blocks choosing until the player
  removes one. The cap counts city pieces on the map, so a city placed by hand counts.
- **Japanese research discount:** research spends no trade in the engine, so the discount of 3 is shown (tech tree, Tesla's
  check) but not charged. Rationalism's learning gets no discount (unofficial rulings 93, 398). Notre-Dame's second research
  and Porcelain Tower are not modelled.
- **Civilization abilities not automated:**
  - Not modelled: Mongol loot, Russian sacrifice (no enemy-army-city model), Zulu metropolis hut exploring. The German free
    resource is a log line only.
  - Arab culture covers resource spends only; taking a token off the board by hand is not a spend.
  - A Chinese board Undo of a hut collection is refused once the culture it gave is spent (deliberate: it is one player alone,
    and a clamped take-back would let them collect the hut again for 3 more); correct the culture counter by hand. The same
    refusal applies to the End battle undo of a spent Aztec reward.
  - Chinese casualties that may still be saved stay out of every discard reshuffle until the Chinese save or the next battle
    (there is no decline action), so an empty unit deck can answer `NO_MORE_ITEMS` meanwhile.
  - The Spanish migration cannot tell an old save from a player who typed `2` on purpose when no reveal setup records the
    choice: that `2` becomes `2+1` on load. A `3+1` saved by an earlier build (no migration marker) loads as `4`. The Spanish
    free-building credit counts every tile explored, including ones the players later move or remove by hand.
  - A great person drawn by hand in the Draw panel, or gained outside an assisted action, gives the Greeks and Aztecs nothing
    extra: the player draws the units by hand. A free Aztec unit drawn before its Great Person was undone stays in the hand.
- **Killed units and the Chinese save:** End battle discards only the players' killed units; killed barbarians are still
  discarded by hand with Discard barbarians. The Chinese save has no undo of its own (only Undo end battle, by the player who
  ended the battle), and its window closes when the next battle starts.
- **Conquests:** the offer (a village for every civ, with the Roman free advance or the Chinese 3 culture; a city for the
  Romans) comes from a heuristic, not from a conquest the game knows: an own army ended its last qualifying move on a village
  or (Romans) another player's city, and that player then won an arena battle against the barbarians (village) or the city's
  owner (city) with the army still on that square.
  - It cannot tell what the battle was fought for, so a win elsewhere with the army on the square counts. A battle settled by
    hand outside the arena, or a city walked into with no defender, makes no offer (take the reward by hand). A city that
    changes owner is not modelled.
  - Only each player's last qualifying move is pending. A board Undo of that move leaves it in place; it counts only while the
    army stands on the recorded square, and a newer move or the next battle replaces or uses it up.
  - The village fight question is asked by the web client from what it sees; when the engine ignores it (another player's
    figures on the square, a battle already active) the army just moves.
- **Legacy board layouts:** pre-shape three- and five-player saves that already hold pieces keep 16×16 rectangular slots; only
  an empty three-player board moves into the pyramid. On the legacy five-player rectangle, player 5 shares player 1's starting
  corner. `engine/test/board.test.ts` pins this; reshaping would move existing pieces.
- **Legacy wonder hands:** older saves may keep wonder cards in `player.items`. Migration counts them for `wondersDealt` but
  does not move them to the board.
- **Legacy Egypt setup:** older saves backfill `wondersDealt` from `hasWonder || setupComplete`, so an Egypt revealed earlier
  never gets the three-ancient/one-medieval deal. Deliberately forward-only (`migrate.ts`).
- **A square another scout sends:** the Start of Turn panel still offers the second scout's city choice; choosing a city is
  refused with a reason.
- **Scout-held Bank coins:** board derivation does not model scout transfers; the Sheet is the manual correction.
- **Ending on an own city centre:** F&F p. 7 lets figures cross friendly centres "as long as they don't end their movement
  there"; travel still lets a figure that is not disbanded stop there (the centre-scout rule assumes it). Ask the human before
  forbidding it.
- **Who opens the arena:** the defended city is found from the battle's attacker (the initiator) standing on the defender's
  city. If the city's owner initiates against the army in their city, no city bonus is counted and the fortification stays. Ask
  the human whether to look both ways.
- **Arena edits:** `runBattleAction` in `GameView.tsx` returns early while busy, so a debounced stat save can be dropped (found
  by inspection, not reproduced).
- **Revealed feed:** the history fetch is capped at 100 items; there is no full pagination.
- **Trade offer retries:** the chat panel keeps one request id per offer until a send succeeds. If the server stored an offer
  but the response was lost and the player never retried, sending the same words later returns the old outcome.

### Cancellation

- Only structured assisted city actions, culture events and resource abilities can be selected for cancellation. Abilities
  without records and unstructured square/building targets stay manual; Bread and Circuses does not infer targeting from a
  card's owner.
- Reaction choices show the current hand; the server also checks historical availability on submission. King is tested only
  against the saved state just before the cancellation he undoes.
- Only recorded abilities that spent a resource can be selected (a note-only or free ability cannot). A Spy that is only a
  piece on the board (no item) cannot pay a cancel. Mass Media's immunity of its holder's culture events is not enforced.
- The United Nations is the player's own confirmation that its owner agreed, not an in-game approval request, and it is asked
  only for a named player or the figures a group move takes; a culture event aimed at an unstructured building or square
  stays manual.
- Missing exact legacy baselines cannot be guessed from a log prefix. A cancellation cannot cross roster changes or reach behind
  an earlier cancellation (each seals the history through itself). These corrections need table agreement: there is no
  automatic command replay, speculative draw or timeout, and nothing stops players from playing on before a cancellation.
- The public log records each cancellation, counter and King protection; the Revealed and Discarded feed does not yet
  synthesize entries for the cards they spent.

## Storage and delivery

- Archived Mongo `pbf` data is for historical statistics only.
- Manually deleting a middle revision delta is unsafe; use cleanup/compaction.
- Broadcast recipient claims and `lastRunAt` are separate writes in `notifications.ts` (a small release-stuck race). Never
  auto-retry an indeterminate send to work around it.
- Production deployment, D1 migration and scheduled-mail status must be checked in the target environment.

## Scope

- No tournaments or websockets; refresh polls.
- Bearer tokens cannot be revoked individually; disabled accounts are checked per request.
- Some card images exceed 1 MB.
- Asset regeneration needs untracked source material. Check that local Military Science artwork is the intended replacement
  before running the generator.
- **Player status sidebar:** the per-source Coins counters can only be edited in the Coins panel below the map (the sidebar
  shows the read-only total), so that panel cannot be retired. With an editor open, tapping another stat saves the open one
  first; the editor row closes and the grid shifts, so that tap can miss and a second tap may be needed.
- **Display settings** are per browser: two tabs do not sync, and the tab that saves last overwrites all three values. Auto
  zoom still uses the old fitting steps.
- **Group travel:** which figures drop out as the selection shrinks follows the order on the square after the tapped one; tap
  another figure to start from it. A group's Undo also takes back a token or relic collected in the same move, which a Redo
  does not give again (as for one figure). The cost of a group exploration (1 movement for each figure) is the human's decision,
  not the rulebook's.
- **Movement routes:**
  - Defection, Mass Defection and Wholesale Defection are not automated against a route. Open questions for the human: where
    an interruption cuts the move (before or on the square entered), what happens with several reactions or a cancelled one,
    whether the route is revealed to reacting players, and how a hidden card in the reacting hand stays private.
  - A route cannot be cut at a chosen square. A move without a recorded route (before routes existed, or via the API without
    `route`) cannot be reconstructed.
  - Waypoint planning is greedy (see `decisions.md`), so a narrow corridor can report no way although one exists; add the
    squares as extra waypoints. Desktop drag along a route is not built.
  - The route bar sits at the end of the page for keyboard users (Escape cancels); a rejected Move clears the preview.
  - Checked in headless Chrome at 360 px and, for the route preview and group playback, in a desktop browser harness; not on a
    real touch device.
- **Route playback:** not checked on a real device; it only follows the figure; a battle or loot that happened on the way is not shown. Going back one revision
  does not play the route in reverse. When more than 4 moves arrive at once, the newest 4 play and a group can be cut in half.

## Per-card and per-tech gaps

- **Jim Henson:** wound markers are kept on the hand (`hensonWounds`), not on the card, so the count stays with the player if the
  card changes hands or is discarded and drawn again. Wonders put on the board by hand add no wound.
- **A. P. Giannini / Frida Kahlo:** Giannini's Start of Turn section stays hidden, unexplained, when no building can be placed.
  Frida Kahlo is listed as ready on the culture start space and refuses only when played.
- **Zheng He:** his look is a list in the private log; the map shows no marker on the squares it read. A token drawn from keeps
  its piece on the map, so a later look gives that piece a new item. An undone draw puts the item in the shuffled deck, so
  earlier lines can go stale. A piece collected into an area is not listed by a later look.
- **Jerry Garcia:** the all-city devotion counts no scout's square and offers no Charles Darwin conversion; correct a figure on
  the culture counter by hand.
- **Unit techs:**
  - Wounds dealt by Mathematics or Ballistics cannot be undone (correct health by hand).
  - Combustion removes the building or turns the walls back itself (like Gunpowder's destroy) and its undo restores them, but
    the engine cannot tell that the army really ended its move there or attacked the city. It never targets the player's own
    walls or buildings in the outskirts of their own city; a building in the outskirts of cities of two colours has no owner
    and is a target.
  - Marie Curie's armed substitute still replaces a real Uranium token in a payment, so Gunpowder naming Uranium while she is
    armed pays the substitute. With the substitute and a real Uranium token both in hand, Gunpowder's warning (or its
    needs-resource block) can disagree with what a payment would spend; the hand-set tokens decide.
- **Tech resource abilities:**
  - A production boost is derived from its record and a Build does not consume it, so undoing the boost after a Build used it
    does not refund that Build.
  - The cancels (Writing, Civil Service, Mass Media) are made from the log and rewind the game (see `decisions.md`).
    Education's and Code of Laws' coins are automatic once per turn, and the undo of a build or of End battle takes them off. If
    two wonders are built in one turn and the first (the one that earned Education's coin) is undone, the second is not
    credited: type the coin in by hand.
  - Writing is available in any open phase (human), although its card says City Management. Education's free tech is not
    listed in the City Management tab: the page goes to the tech tree when it arrives and the Start of Turn view lists it.
  - Monarchy's kill is refused while a battle is on; Philosophy's undo reshuffles the Great Person deck. Unverified: killing a
    unit with Monarchy after End battle, undoing End battle, then undoing Monarchy puts the card back in the hand without its
    `inBattle` flag while its unit stands in the live arena again.
- **Metalworking, Atomic Theory, Bureaucracy:**
  - Metalworking adds to the typed attack and cannot tell a unit "played from hand" from one already in the arena.
  - A nuke leaves a figure on the city's centre square, resource tokens, huts and city-states, and does not touch records that
    refer to destroyed pieces (undoing an earlier build of a destroyed building may refuse). Its undo refuses only when a piece
    of the city is on the board again or a city now stands on one of its centre squares, so a figure or building that moved onto
    an outskirts square is stacked on by the restore. A nuke of a capital (marker or metropolis) is refused.
  - Gunpowder's destroy has similar caveats: its undo refuses when the piece is on the board again or a building, wonder, city
    or city-state now stands on the square, and an assisted Build or Upgrade record that points to the destroyed piece refuses
    its own undo until the Gunpowder is undone.
  - Atomic Theory's extra action is per city and not tracked against the cities' production. Bureaucracy only logs: the policy
    switch is by hand and not limited.
- **Navy:** a battle begun by placing the army where an enemy figure stands (ruling 189) is resolved by hand, as for any army
  placed on an enemy square. A Military Dock counts as a Shipyard under the confirmed house rule.
- **Agriculture:**
  - Friendly figures move together into a chosen neighbouring outskirts square, with buildings/wonders destroyed and Great
    Persons reserved automatically. Ruling 123's exceptional centre disbanding and partial-group displacement stay manual; if
    no neighbouring outskirts square fits the whole group, relocate it by hand first.
  - A Zulu hut in the new outskirts is allowed and noted in the log line but not explored (ruling 108), and cannot be the
    displacement destination until explored. An unclaimed relic in the new outskirts blocks growth (confirmed by the human).
  - A capital that cannot grow yet may grow in a later Start of Turn (ruling 119): nothing remembers that, the button simply
    stays until a side is legal. Undo is refused after a city action was taken with the metropolis (a build in its new outskirts
    goes first).
  - The button shows in every phase tab and also in the Start of Turn tab's own Metropolis section, so it can appear twice there.
- **Space Flight:** the Tech victory line is a separate log entry, so undoing the reveal by vote removes the tech but leaves the
  line, and revealing it again writes a second line. The game never ends by itself on it; the players name the winner.
- **Animal Husbandry and Biology heal:** the cap is the health the card has at its level, so a unit whose health was typed
  higher by hand is not healed, and a unit whose card was not rotated to its level is capped at the lower figure. Units
  reinforced away are no longer in play and are not healed. A used heal cannot be undone after Animal Husbandry healed a wound
  or a healed unit's health was edited; correct it by hand.
- **Hut and village tokens:** the village prompt offers the draw at once. If the rulebook has a battle for the village, settle
  it by hand first and confirm afterwards; the engine does not model it. Tokens follow a tile only while their centres lie on
  it, so a token dragged off its tile by hand stays where it was put.
- **Relics:** taking one removes the marker. The Ark's first advance and the School of Confucius are claimed at once; the Ark's
  second advance and Attila's two units are "Relics" buttons, Atlantis and Seven Cities of Gold are Start of Turn buttons. A
  claim blocked at the moment of the move (a full culture hand, a waiting card choice) stays as a button with its reason. A
  scout and an army cannot be moved together, so a scout joins an army on a relic square after it; a movement card moving a
  scout can still cross hut, village and relic squares (it cannot end on them).

## Battle cards

- Leonidas and Joan of Arc cannot be played after End battle (Florence Nightingale can); the ender can Undo end battle, play the
  card and end again. Sun Tzu's pass has no undo (correct the trade by hand).
- Florence Nightingale marks the units killed at the time she is played; a unit killed later is not saved.
- Zhukov's wound has no undo, and a kill taken back after a wound was dealt leaves that wound dealt (the next real kill then
  earns none). He counts from the moment he is played; units dead before are not owed.
- Gustavus Adolphus counts "unlocked" as the unit decks infantry, mounted and artillery, and aircraft with Flight; unit levels
  are not checked. End battle does not empty the battlehand (only Reveal battlehand or a new draw does), so with no battle on he
  also counts units that fought and came back to it; reveal the battlehand first.
