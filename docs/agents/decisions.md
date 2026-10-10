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

Terrain checks are advisory client warnings, not server placement restrictions.
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

Source: `packages/engine/src/coins.ts`, `packages/engine/src/blockade.ts`
and related tests.

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

Source: `packages/engine/src/actions/arena.ts`, `actions/player.ts`, `state.ts`
and arena tests. The earlier auto-discard and automatic-only barbarian plans
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

Source: `engine/src/assisted.ts`, `culture-track.ts`, `server/src/routes/play.ts`,
`web/src/views/AssistedActions.tsx`, `PhaseSummary.tsx`, and the `assisted*`
tests. Not built: Great Person abilities that need a map marker, killing
markers, map tile 16a, free advances, hand limit, figures and military units (#264), offers (#265).

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
piece, pays and logs in one step, and the everyone votes undo reverses it. Figures
and military units are the next parts and reuse the same payload.

- Only legal choices are listed. Everything else is under "Why not the others" with
  a reason. A cost above the city's production is such a reason; the way out is to
  set the city's production by hand (decided with the human). Trade can cover a
  shortfall (rush, base rules p. 15): 3 trade for 1 production, the Americans get 2
  production per 3 trade, paid in whole steps and never more than needed.
- A building needs a revealed tech (the human's tech sheet, `BUILDING_TECH_UNLOCKS`).
  Once the upgraded form is unlocked only that form is built, and its tech alone is
  enough (base rules p. 22). Flipping already built basic buildings on learning the
  upgrade is a later action.
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

Source: `engine/src/build-options.ts`, `building-data.ts`, `assisted.ts` (the `build`
action), `actions/board.ts` (`isAssistedBoardChange`), `web/src/views/BuildPicker.tsx`,
`buildFlow.ts` and the `assisted-build*` tests.

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
