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
is the red scout recoloured by hand, so regenerating the manifest from the
Moderator art drops it (see `tools/board-assets.ps1`). The Spanish card says
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
