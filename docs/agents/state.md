# State

Where the project stands. Read this first; it is here so you do not have to
read the codebase to find out what is done.

Keep it short. One line per finished thing. Detail that is worth keeping goes
in `decisions.md`; detail that is not goes nowhere.

_Last updated: 2026-09-25_

## Health

| Check | Status |
| --- | --- |
| `pnpm -r typecheck` | passing |
| `pnpm -r test` | passing - 548 engine, 208 server, 241 web on `feat/issue-173-coin-source-civ-name` (an intermittent `StatusPanel` timeout under full-run load is tracked under "Known problems") |
| `pnpm -r build` | passing |
| `main` pushed to `origin` | yes |

## Done

- **Issue #173: the Coins tab heads each player's column with their
  civilization, and draws a vertical divider between every column.** The
  human, with a screenshot: "Coin source should have civ name not nickname"
  plus "Can we also get vertical bars like the status table has". Both were
  small: `CoinSection` (`StatusPanel.tsx`) now renders
  `row.civilizationName ?? row.username` in each `<th>` — the username stays
  as the fallback for a player who has not revealed a civilization yet, since
  an empty header would be worse than the nickname it replaces — and every
  per-player cell (header, body and the `tfoot` Total row) reuses the Status
  table's existing `status-group-start` class for its `border-left` divider.
  The Coins table's `<thead>` has a single row, unlike the Status table's two,
  so a new `.status-table thead tr:only-child th.status-group-start` CSS rule
  was needed alongside the existing selectors — read-only reviewed and
  confirmed it cannot also start matching the Status table (whose `<thead>`
  keeps two rows). No old-system reference: the Coins tab (issue #158) is
  original to this project. No hidden-information change — `civilizationName`
  reads the same `PlayerView.civilization` field the Status tab's own
  Civilization column already shows, which the engine only populates once a
  player actually reveals their civilization. Read-only review approved in one
  round, two nits left as-is (a test fixture could reuse one `coinView()` call;
  a revealed player's counter buttons keep their username in `aria-label` while
  the header now shows the civ name — the username is the unambiguous
  identity, so this was left deliberately). 2 new web tests (241 total,
  548 engine, 208 server unchanged). Full checks pass. Browser-verified against
  a real local server: registered two users, joined a 2-player game, revealed
  one player's civilization ("French") through the real reveal API, and
  confirmed the Coins tab showed "FRENCH" for that column and the username for
  the other, with a visible divider between every column; the Status tab was
  unaffected. Branch `feat/issue-173-coin-source-civ-name`.

- **Issues #177/#176: a hamburger menu with a Game section, a turn/phase
  title, and a landscape-width fix.** Two client-only issues from the
  human, one PR. Issue #177: `Navigation` collapses FAQ/About/Highscore/
  Rules-and-help and the theme/sign-in controls behind a single hamburger
  `<details>` menu, on every screen width — the human explicitly asked for
  this on desktop too, not just mobile. On a game page the same menu gains
  a "Game" section (Withdraw for any player, Delete for the creator or an
  admin — matching old-civ-web's `nav.html`, whose own "Admin settings"
  dropdown gated Delete on the admin flag alone, membership-independent),
  moved out of `GameView`'s action row via a new `onGameActions` callback
  prop; `App.tsx` holds the resulting state and threads it to both
  `Navigation` and `GameView`, since they are siblings, not parent/child.
  "Back to games" is gone from the top nav on both the game and admin
  screens (a different, unrelated "Back to games" link inside `AdminView`'s
  own page content is untouched). `GameView`'s h1 swaps from the game's
  name to "Your turn — X phase" / "<name>'s turn — X phase" (previously a
  `<span>` beside it); the name becomes a small subtitle. The civilization
  tag, colour swatch and Auto-refresh toggle are deliberately untouched —
  the human's explicit minimal-risk choice. Issue #176: `.board-layout`
  already switched to a column below 900px width, but `.board-scroll`/
  `.board-palette` only got `width: 100%` below 700px — so a landscape
  phone (700-930px wide, ~350-430px tall) fell into that gap and each sized
  itself off its own content instead of the container, overflowing the
  page horizontally (verified live: `document.documentElement.scrollWidth`
  went from 426 to matching `clientWidth` after the fix). Closed with a new
  rule at the same 900px condition, plus a separate
  `@media (max-height: 500px) and (orientation: landscape)` block that
  reclaims vertical space and stacks the full-width board/palette (tighter
  `.app`/`.topbar` padding, `.board-scroll` max-height 80vh → 55vh)
  regardless of width. Two read-only review rounds:
  round 1 found a real regression (an admin viewing a game they had not
  joined lost Delete game entirely, since the gating logic bailed out
  before checking the admin role) and a real test-coverage gap (the
  riskiest logic — who gets which button — had no test at all); both fixed
  by extracting the gating into a pure, now-unit-tested `gameMenuGate`
  function, plus several nits (a `.spacer` class collision that broke the
  hamburger's right-alignment at 700-900px width, a dead guard clause, a
  misattributed CSS comment). Round 2: approved with nits (a scope-wording
  fix to the brief, one more test tying the disabled flags to the rendered
  `disabled` attribute). 5 new `GameMenuActions`/`gameMenuGate` tests, 3 new
  Navigation tests. A later merge from `main` retained the `gameMenuGate`
  tests but dropped their named import; the reopened build fix restored it.
  Its review also caught and closed the short-landscape 901-930px gap, with
  a source-contract regression test for the complete height-based block.
  Full checks pass (548 engine, 208 server, 239 web).
  Browser-verified: mobile portrait (375x812, menu open/closed/nested
  submenu, Game section for a player and separately for creator/admin, no
  Back to games anywhere), tablet (800px, hamburger right-aligned), desktop
  (1280x720, anchored flyout dropdown), landscape (812x375, no horizontal
  overflow before/after measured directly). Two unrelated pre-existing bugs
  were found and spun off separately rather than folded in: a "Reveal"
  button that overflows the viewport at 375px width (`TurnPanel.css`'s
  `.turn-phase-heading` had no `flex-wrap`), and a `@media (max-width:
  900px)` block in `styles.css` that never closes, silently scoping a large
  chunk of item-card CSS to under-900px viewports only. Branch
  `feat/issue-177-176-menu-landscape`.
- **The turn phase heading row no longer overflows the page at phone width.**
  Found incidentally while browser-verifying an unrelated branch: `.turn-phase-
  heading` (`TurnPanel.css`) — the row holding a phase's label, save-status
  badge, Save button and Reveal/Save & reveal/Revealed button — was
  `display: flex` with no `flex-wrap`, so at 375px width it overflowed the
  page horizontally (`document.documentElement.scrollWidth` 428 vs
  `clientWidth` 375). One-line fix: `flex-wrap: wrap`. Confirmed live
  (`scrollWidth` back to matching `clientWidth`, the row visibly wrapping for
  a long phase label and staying single-line for a short one) and read-only
  reviewed with no findings above a nit (wrap is a no-op wherever content
  already fits; the opponent read-only view and the private-log heading,
  which reuse the same class, both benefit the same way; no RTL/long-content
  concern applies). Branch `fix/turnpanel-reveal-button-overflow`.
- **Draw is the first panel after the board.** The existing Draw panel now
  appears above the responsive Log/Chat pair; Hand and every later panel keep
  their previous order. A `GameView` regression test pins the board, Draw,
  Log/Chat and Hand composition directly. Read-only review approved after the
  first round required this stronger composition-level test. Full checks pass
  (548 engine, 208 server, 223 web tests), and a local spectator browser pass
  confirmed Draw above Log after the board. Branch
  `feat/draw-before-chat-log`.

- **Item card styles no longer inherit the 900px breakpoint.** Closed the
  navigation/touch-target media query immediately after `.board-palette`,
  keeping both board layout rules scoped to 900px while restoring the item
  card rules and nested 600px query to their intended scope. Brace counts
  remain balanced (321/321). Read-only review approved with no findings;
  typecheck, all tests (540 engine, 205 server, 218 web) and build pass.
  Browser-verified at 2530px: the revealed German ItemCard showed its art,
  title, description and status badge correctly; the Metalworking card view
  showed its art and text. Branch `fix/styles-900px-unclosed-media-query`.

- **Issue #175: Military Tradition's flipside was a data typo, not a one-way
  design.** The source spreadsheet had `Military Tradition` pointing at
  `Patronage` instead of back at `Pacifism`, the only one of the four
  social-policy flipside pairs that wasn't symmetric. Corrected at parse time
  in `gamedata.ts` (not by hand-editing the generated JSON, so re-running
  `pnpm gamedata` cannot silently reintroduce it), with a real-data symmetry
  test in `gamedata.test.ts`. `migrateGameState` also corrects any game saved
  before the fix, both the catalogue and a player's already-chosen copy, so
  existing games stop reproducing the bug without a fresh deal. See
  `decisions.md`, 2026-09-25, which supersedes the 2026-09-22 entry that had
  read this exact asymmetry as intentional.

- **Issue #171: the reveal flow was already correct; the real gap was
  migrating a pre-shape board.** A new end-to-end test
  (`board-tiles.test.ts`, `draw` → `revealItem` → `placeStartingTile` for
  every player in turn order, asserting no two starting tiles' rectangles
  overlap) proves a freshly created 3- or 5-player game seats every player
  correctly today. `board` is computed once at game creation and never
  recomputed, and the three-/five-player shape fields were all added in one
  commit on this branch — so the only board this can rescue is one saved
  before that commit, with no shape fields at all. `migrateGameState` now
  re-seats such a board at the correct shape, but only when it is empty (no
  pieces yet — re-seating under existing pieces would create new overlaps)
  and the same size as the saved board (three players: yes, 16 x 16 either
  way; five players: no, the correct map is a bigger 28 x 18, and resizing
  would shift every already-placed piece — deliberately left as a known
  limitation). This does not confirm what produced the human's report: it
  is the best explanation that survived their answers (fresh game, normal
  reveal order), closes a real gap either way, but may not be enough — see
  `decisions.md`'s "Consequence".

- **Issue #109: the three-player pyramid and the five-player map with a hole.**
  The board carries its shape as a list of playable 4 x 4 slots with a
  half-tile placement grid, and one starting slot per player in playernumber
  order. Three players get the ten-slot stepped pyramid from the base rulebook
  (starts top, bottom right, bottom left); five players get the 28 x 18
  twenty-two-slot map from Fame and Fortune with the hole at squares 12..16 by
  8..14 and five starts clockwise from the top, so the overlapping player-5
  corner is gone. Tile snapping, drawn-tile placement, square names, fog and
  the client's green mat all follow the slots; the hole and the outside get no
  fog, no mat, no name and no snap target. Old saves gain the rectangle shape
  in `migrateGameState` with no piece moved; one-, two- and four-player games
  are unchanged. Deliberately no re-seating of saved three/five-player games
  (none exist) and no movement rules (the engine has none). Read-only review
  approved with nits only; full checks pass (499 engine, 199 server, 183 web
  tests) and the browser showed both shapes, the hole, and a tile dropped over
  the hole staying unsnapped. See `decisions.md` for the snap-tolerance
  consequence.
- **Issue #174: board Undo is scoped to the acting player, and gets a Redo.**
  Undo used to take back whatever the board's single most recent change was,
  regardless of who made it — reported directly by the human, who also lost
  a change to an accidental extra undo with no way back. Before starting, the
  human answered four clarifying questions (no old-system reference exists
  for the board at all): Undo only works while the caller's own change is
  still the board's very last one — it does not reach back past another
  player's more recent, unrelated moves; undo/redo supports a full stack,
  delivered by chaining single steps rather than a separate buffer; Redo is
  cleared by *any* further change, by anyone; and Redo itself is not scoped
  to whoever undid the change, matching the board's existing "everyone may
  move everything" rule. `Board` gained a `redo: readonly BoardHistoryEntry[]`
  array; `undoLastBoardChange` now refuses with a new `BOARD_UNDO_NOT_YOURS`
  error unless the history's last entry belongs to the caller, moving it onto
  `redo` instead of dropping it; a new `redoLastBoardChange` pops it back.
  `BoardView` gained a `youId` prop to gate the Undo button and a new Redo
  button. Round 1 review found three real gaps (all fixed): `README.md`
  still described the old unscoped rule, no `decisions.md` entry despite the
  brief promising one, and a server test that asserted against a stale HTTP
  response captured before the refused undo, so it could never fail. Also
  fixed from round 1's nits: a redone entry's `logLength` is now refreshed to
  the log's current length rather than kept stale, which could otherwise run
  backwards along history if an unrelated action grew the log while the
  change sat on the redo stack. Round 2 approved, with three more wording-only
  doc nits closed on top. 8 new engine tests, 5 new server-route tests, 4 new
  web tests. Full checks pass. No browser tool was available this session (a
  Chrome extension install was started but not completed); the visual pass —
  button enablement in a live game, and layout of the two buttons in the panel
  header at mobile width — is left to the human. Branch
  `feat/issue-174-board-undo-redo`.

- **Issue #167: each wonder in the Wonders panel shows its printed effect.**
  The Wonders sheet's Description column was already parsed into
  `WonderItem.description` (unlike the Tech sheet's, which is always empty —
  see `techText.ts`), but that text was dropped once a wonder became a board
  piece (issue #145). A new pure `wonderReference()` reader in
  `packages/engine/src/gamedata.ts` returns every wonder's name/era/text with
  no RNG or ids, and now backs both a static `WONDER_DESCRIPTIONS` export
  (name → text, computed once, like `GOVERNMENT_CARDS`) and `readWonders`
  itself, so there is one parser instead of two. `WondersPanel` looks up each
  in-play piece's description by its label and renders it with the same
  `card-text` styling `ItemCard` already uses for a hand card. The
  `rules-checker` found the old client (`old-civ-web`) already showed this
  same text in the hand/revealed views before wonders moved to the shared
  board — this restores lost old-system behaviour rather than inventing
  anything. Review round 1 found three minor gaps, all fixed: a type-unsound
  `Object.fromEntries` call that resolved to `any`, no test pinning that a
  board-asset manifest label always has a matching description (now added,
  guarding against future label/sheet-name drift), and no regression pin on
  the refactored `readWonders`' shuffle order for a fixed seed (now added).
  Round 2 approved. 4 new engine tests, 1 new web test. Verified: the wonder
  text is confirmed present in the built web bundle and in a running local
  server's deck; no browser tool was connected this session, so the visual
  pass in a real game page is left to the human. Branch
  `feat/issue-167-wonder-descriptions`.

- **Turn orders: per-phase save, and a whose-turn/which-phase status.** Each
  phase section (SOT, Trade, City management, Movement, Research) now has its
  own Save button beside Reveal; Reveal saves the phase first if it has
  unsaved edits — reading the editor directly and trusting the same
  live-dirty signal `saveAll` already used, not just `values`, so a keystroke
  Milkdown has not yet flushed can no longer be silently skipped and the
  previous, stale text revealed in its place (a round-1 review finding, now
  covered by a `TurnPanel.test.tsx` regression test). A new pure
  `currentPhaseStatus`/`activeTurnStatus` pair (`turn.ts`/`state.ts`) derives
  who is on turn and which of the five phases they should be working on, from
  the already-public `revealed` flags only, never order text (proven by a
  `toPlayerView` leak test); it is exposed as `PlayerView.activeTurn`, shown
  in the game title row next to "Your turn"/"<opponent>'s turn", logged as a
  `System:` line on `endTurn`/`takeTurn`, and named in the "it's your turn"
  email. The Great Person Khalid's turn-steal is explicitly out of scope,
  confirmed with the human — filed as a future issue, not guessed at. Two
  review rounds (round 1: one major finding on the live-dirty race, fixed;
  round 2: approved with nits, the cheap ones fixed — a `revealed`-flag
  consistency rule between the two new helpers, letting Save clear an
  emptied phase, a `PlayerView | unknown` type tightened, and one more
  decision recorded). Browser-verified end to end against a real dev server:
  the title status, the Save/"Save & reveal" buttons, and the `endTurn` log
  line and email phase all matched. 15 new engine tests (513 total), 2 new
  server tests (205 total, one an intermittent flake in the new test itself
  from `actions/game.ts`'s start-player shuffle, fixed and confirmed over 8
  repeated runs), 4 new web tests (213 total). Full checks pass. Branch
  `feat/turn-order-phase-tracker`; PR not yet opened. See
  `docs/agents/tasks/turn-order-phase-tracker.md` and `decisions.md`.

- **Issue #168 follow-up: freeform tech-pyramid repositioning, for Nikola
  Tesla and Sir Isaac Newton.** A player can move any of their own chosen
  techs to a different pyramid row (`TechItem.slot`, a stepper control on
  their own tab only) and can place the Great Person "Sir Isaac Newton" as a
  permanent blank occupant of a row (`Playerhand.pyramidPlacements`, a
  Newton-only "Place in tech pyramid" button in the hand). Neither Tesla's
  nor Newton's printed rule is implemented or checked — the human explicitly
  asked for the bare capability only, self-managed by the player, with no
  legality checking and no public log entry for a move or a placement; three
  new engine actions (`setTechSlot`, `placeGreatPersonInPyramid`,
  `setPyramidPlacementSlot`) do nothing but persist what the owner asks for,
  gated only by ownership. A round-1 review caught a real hidden-information
  bug: the first version exposed a placed Great Person's *name* to opponents,
  contradicting Newton's printed "facedown... blank tech card" text; fixed by
  scrubbing the name out of the public projection (`OpaquePlayerhand` carries
  only `{ slot }`, the owner's own view keeps `{ name, slot }`) and proven by
  tests at the engine, server and UI layers. Two other round-1 findings and
  two round-2 nits were also fixed (a missing `decisions.md`/`README.md`
  entry, a weak ownership test, a missing image error fallback, two
  non-null assertions). Round 2: approve. 17 new engine tests (503 total), 1
  new server-route test file addition (204 total), 14 new web tests (204
  total). Full checks pass. Two design calls made without a full
  confirmation from the human — immediate public visibility of a *slot* (not
  identity), and a stepper control instead of drag-and-drop — are recorded as
  open/reversible in `decisions.md`. Same branch as issue #168's PR #170
  (more commits, not a new PR, per the human's request). See
  `docs/agents/tasks/issue-168-tech-revamp-pyramid-reposition.md` and
  `decisions.md`.

- **Issue #168: the tech tree shows real card art, and a level-tabbed picker
  replaces the tech combo box.** A researched pyramid slot (`TechTree.tsx`) now
  shows the tech's card image (name and `title` stay as the fallback/alt text),
  including level 5, Space Flight, which never had art before. Choosing a tech
  to research is no longer a `<select>`: `TechPanel.tsx` now has a `Tabs` bar
  for levels 1-5 filtering the level's available techs into a `card-grid` of
  `ItemCard`s; clicking one opens a `ReferenceDialog`/`ReferenceCard` detail
  view with the full card art, its effect text (see below) and a "Research"
  button that closes the dialog unconditionally (so a rejected `chooseTech`
  leaves the page's error banner visible, not hidden behind the modal) before
  calling the API. `itemImage()`'s `tech` case now resolves to `.jpg` instead
  of sharing the `.png` constant with `hut`/`village`, since the 45 card
  photos (`Civilization/Moderator/techs/*.jpg`, gitignored, cropped and
  background-removed in a separate session) are jpg; a new
  `tools/tech-assets.ps1`, modeled on `tools/item-assets.ps1`, copies and
  renames them into `packages/web/public/items/` via an explicit map (not a
  derived transform — several tech names don't transform mechanically from the
  photo filenames). Neither `TechItem` nor `chooseTech`/`availableTechs`
  changed; this is presentation only. `TechItem.description` is `null` for
  every tech (the spreadsheet's "Description" column was never filled in), so
  the per-tech effect/unlock text shown in the dialog is a new client-side
  file, `packages/web/src/views/techText.ts`, transcribed by the orchestrator
  from the tech reference sheet the old client already ships
  (`packages/web/public/help/Civ_Tech_FF-WW.-2.jpg`) rather than invented;
  Space Flight has no entry there (added in code, not from the spreadsheet);
  its line ("Immediately win the game with a Tech victory.") is the human's
  own text, added directly, not a transcription. A visible disclaimer in the
  dialog says
  the text is reference-only and not engine-enforced, matching
  `SocialPolicyPanel`'s existing one. Two review rounds, both approved (round 1
  "approve with nits" — two nits promoted to real bugs and fixed: the dialog
  swallowing the Research error, and the missing disclaimer; round 2
  "approve", one cosmetic nit fixed directly). 3 new engine tests (486 total),
  11 new web tests (190 total, replacing the removed `<select>` coverage).
  Full checks pass. Browser verification not done in this session — left to
  the human; see `docs/agents/tasks/issue-168-tech-revamp.md` and
  `decisions.md`. Branch `feat/issue-168-tech-revamp`.

- **The coin mark sits in the top bar, linked home.** The favicon coin is shown
  again inside the `.brand` anchor, to the left of the "Civilization playciv"
  wordmark, so clicking it goes to `/`. Asset-only and presentational:
  `Navigation.tsx` gets an `<img class="brand-icon" src="/favicon.ico" alt="">`,
  `styles.css` sizes it `1.35rem` square with `align-self: center` while
  `.brand` keeps its baseline alignment, and a `Navigation` test pins the link
  and the icon `src`/`alt`. No new artwork; the existing icon is reused. Review
  approved with two nits, both fixed. Full checks pass (476 engine, 197 server,
  169 web). Branch `feat/header-coin-icon`; PR #160. Per the human's request the
  review/test gate was not re-run after the final cosmetic commit.
- **Issue #158: the Coins tab offers only the sources a player actually has.**
  A source now gets a counter only where it is real — a revealed coin-token
  tech, the revealed Organized Religion policy, the Democracy government, the
  Panama Canal wonder in the Wonders area — plus the four always-available rows
  Bank, Great People, Terrain and Sheet. A player cell without the source is
  empty and a row with no cell is not drawn. `removeTech`, `removeSocialPolicy`
  and `setPlayerGovernment` reset the affected counter; a counter that still
  holds coins stays visible, so a value can never be hidden. The Great People
  helper text is gone. Display is the only restriction: anyone may still edit
  any counter, and the engine gate is unchanged. Read-only review approved with
  no functional findings (one minor was this entry, two nits, one taken); full
  checks pass (485 engine, 199 server, 179 web). Browser-verified against a
  local server: only the four unconditional rows at first; Code of Laws and
  Democracy (Govt) appeared for the owner alone; counter edits moved the total;
  a government change and a tech removal cleared their row and counter; Panama
  Canal appeared after placing and owning the wonder, Organized Religion after
  choosing and revealing it, and its removal cleared it; a Panama piece dragged
  out of the Wonders area kept its counter visible; the console was clean. No
  screenshot was possible (browser window not visible). Branch
  `feat/issue-158-valid-coins`; PR #161 open.

- **Issue #97 join color picker follow-up (PR #158).** Replaced the inline
  color selector with a compact visual dialog that shows only colors still
  available, updates if availability changes, and restores focus on close.
  Read-only review approved with zero findings; typecheck and build pass, and
  all tests pass (476 engine, 199 server, 169 web). Browser-verified.

- **Current game rating evidence and display.** Fresh finished games rank
  nonwinners using the actual culture marker step and the coin total from
  player status; the old migration's estimates remain unchanged. The rating
  column shows rounded OpenSkill points on a 100-times scale, including valid
  negative values, while sorting and cached API values stay unscaled.
  Read-only review approved with no findings; full checks pass (476 engine,
  199 server, 169 web tests). Branch `fix/rating-current-state`.

- **Issue #87: multiplayer rating and durable highscore cache.** OpenSkill rates
  two- to five-player results using the explicit winner and conservative
  tech/culture/printed-coin evidence for other placements; uncertain players
  tie. A repeatable one-time script imports 247 old results from the archived
  export (238 have multiple recorded players and affect rating). The full public
  highscore response is cached in D1 or the local JSON store and rebuilt only
  after relevant data changes, with version checks against concurrent writes.
  The page has a numeric sortable rating column. Two read-only review rounds;
  the second had zero findings. Final checks pass: 474 engine, 195 server, 166
  web tests, plus typecheck and build for all packages. Branch
  `codex/issue-87-rating`. Browser check showed the new Rating column and sort
  indicator; the running shared API had no rating data, while numeric values
  were checked in the web test. Production backfill remains an operator step after
  merge. See `docs/agents/tasks/issue-87-rating.md`.

- **Issue #97: player color selection.** Creators select any of five board colors; players joining a fresh seat select among currently free colors. A replacement retains the withdrawn hand's color. Engine validation rejects unsupported, taken or conflicting replacement colors, while old requests without a color still auto-assign. Public summaries expose selectable colors without private hand data. Read-only review approved with zero findings; old-system differences are recorded in `decisions.md`. Full checks pass (475 engine, 184 server, 167 web). A browser pass could not run because local server and client ports were occupied.

- **Responsive board and panel defaults.** The board starts at the largest zoom step that fits its available width, up to 100%, and follows container resizing; the manual selector remains available. New visitors see only Log, Draw, Your hand, and Turn orders open, while each browser's existing and later panel choices persist. Client-only, with no rules or projection change. Review-approved in round 2 after restoring the coordinate-label gutter. Full checks pass (473 engine, 182 server, 165 web).

- **Issue #142: opponents' public hands.** Each opponent and spectator sees one
  generic face-down card per held culture card, hut, village, great person and
  unit, grouped by player and category. The projection sends only five numeric
  counts, never item data. A local two-player spectator browser pass showed all
  five card backs and confirmed revision replay removed the unit back when
  rewound. Review gate approved with no findings; the old-system check confirmed
  this is a human-requested extension using the old client's item categories.
  Full checks pass (473 engine, 179 server, 154 web tests).

- **Issue #145: wonders in play have explicit owners, and The Internet raises
  coin limits.** The Wonders panel lists pieces in the shared Wonders area,
  lets any member assign or clear an owner, and shows an unassigned state.
  Ownership is public board data recorded in board history, so replay and undo
  preserve it. The Internet owner can hold up to 6 coins on Code of Laws,
  Pottery, Democracy and Printing Press; moving the wonder out of the Wonders
  area or changing its owner removes that allowance, while existing excess
  counters can still be lowered. No coins are awarded automatically. Review
  approved in round 2; PR #150 open. 2 new engine, 1 server and 3 web tests.
  Full checks pass (472 engine, 179 server, 152 web). Browser verification remains for the
  human: the local app started, but the Codex browser bridge timed out opening
  it. See `decisions.md`.

- **The old site icon is back.** The React client's `index.html` had no icon,
  so the browser tab, a bookmark and a phone home-screen shortcut showed
  nothing. The old AngularJS client's files are copied in byte for byte:
  `old-civ-web/app/favicon.ico` (32038 bytes) to
  `packages/web/public/favicon.ico`, and the old apple-touch icon
  `old-civ-web/app/apple-touch-icon.png` (19363 bytes, SHA-256 identical to the
  `images/icons/coin.png` the old `index.html` actually pointed at) to
  `packages/web/public/apple-touch-icon.png`. `packages/web/index.html` links
  both from the site root; the old `shortcut icon` spelling becomes the modern
  `rel="icon"` and the old `?v=2` cache-buster is dropped (Vite fingerprints the
  build). Asset-only: no engine, server, route or projection change, so nothing
  can leak. Verified: `pnpm -r typecheck` and `pnpm -r build` pass; the built
  `dist/` carries both files at its root; `vite preview` answers
  `GET /favicon.ico` with `200 image/x-icon 32038` and
  `GET /apple-touch-icon.png` with `200 image/png 19363`. Branch `feat/favicon`;
  the review gate was waived by the human on request (Sol unavailable). Final
  `pnpm -r test`: 468 engine, 178 server, 148 web all pass.

- **Issue #146: the `TurnPanel` test file no longer races the wall clock.** The
  file's `findBy*`/`waitFor` calls polled Testing Library's one-second deadline
  while the full suite's parallel workers starved them, and the `MarkdownEditor
  lifecycle` test's wait for the mocked editor's dynamic imports — served
  through the same Vite transform pipeline — was reproduced failing twice in
  six full web-suite runs on an idle machine, and twice in two runs under
  twelve CPU burners. The waits are now an `act` flush of the mocked api
  promises (`settle()`) and `vi.dynamicImportSettled()` for the imports;
  nothing in the file depends on wall-clock time any more. Test-only: no
  engine, server, route or projection change, and no test added or removed (24
  in the file, 148 web total; the file runs faster, about 2.3 s to 1 s alone).
  Verified under twelve CPU burners on 16 logical cores: three full web suites
  and one full `pnpm -r test` green (468 engine, 178 server, 148 web), while
  the old file failed 2 of 2 full web suites under the same load with the same
  `expected [] to have a length of 1`. Branch
  `fix/issue-146-turnpanel-test-flake`; PR #151 open; see `decisions.md`.

- **Coin sources per player, with a Coins section in Player status.** The panel
  has a second section behind a tab bar. It lists the reference sheet's fifteen
  coin sources — Code of Laws, Pottery, Civil Service, Democracy, Printing
  Press, Bureaucracy, Railroad, Computers, Bank, Democracy (Govt), Great
  People, Terrain, Panama Canal, Organized Religion and Sheet — with one column
  per player and `− / +` counters. The techs that hold coin tokens cap at 4,
  the static "1 coin" sources at 1, and Sheet and Panama Canal have no limit.
  The Status table's Coins cell is the read-only sum (`totalCoins`);
  `PlayerStats.coins` is replaced by `PlayerStats.coinSources`, and a legacy
  `coins` number is dropped on migration, per the human. `setCoinSource` and
  `POST /api/games/:id/players/:targetId/coin` mirror the stat route. *The
  Internet*'s +2 cap is implemented by issue #145. Branch `feat/coin-tab`;
  review-approved in two read-only rounds (round 1's one minor, the
  documentation this entry is part of, fixed). 18 new engine tests (468
  total), 4 server (178), 5 web (141). Browser-verified against a local server:
  the tab, the 15 rows, `+` to 4 then disabled, four 200s on `/coin`, the
  read-only total, and a reload with the value kept. See `decisions.md`.

- **The 10 s poll skips the history when nothing has moved, and a gateway blip
  is retried.** Two client-only follow-ups from issue #139. `GameView` reloads
  through `loadAfterKnownRevision`: it reads the view first and, when `view.rev`
  equals the revision already applied, keeps the revision list it has; otherwise
  it reads the history-first pair (issue #70). Since `rev` also advances on a
  private note that writes no revision, the comparison is against the applied
  view's revision, not the newest revision number. `api.ts` retries a **GET**
  twice (250 ms, then 1 s) on `502`/`503`/`504` and never retries a write, which
  is what the human's original "and a few retries it suddenly worked" wanted.
  Client-only: no engine, server, route or projection change. Verified:
  `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (450 engine,
  174 server, 143 web). One `TurnPanel.test.tsx` test - a file not in this diff -
  failed twice in roughly 14 full-suite runs, and only under heavy machine load:
  the file took about 5.4 s in those runs against 0.3-0.6 s when passing. It did
  not reproduce in 5 consecutive full-suite runs afterwards, and the new tests
  here use virtual timers or plain promises and never flaked. Filed as issue
  #146. Branch `feat/issue-139-poll-retry`; merged as PR #148; see `decisions.md`.
- **Coin sources per player, with a Coins section in Player status.** The panel
  has a second section behind a tab bar. It lists the reference sheet's fifteen
  coin sources — Code of Laws, Pottery, Civil Service, Democracy, Printing
  Press, Bureaucracy, Railroad, Computers, Bank, Democracy (Govt), Great
  People, Terrain, Panama Canal, Organized Religion and Sheet — with one column
  per player and `− / +` counters. The techs that hold coin tokens cap at 4,
  the static "1 coin" sources at 1, and Sheet and Panama Canal have no limit.
  The Status table's Coins cell is the read-only sum (`totalCoins`);
  `PlayerStats.coins` is replaced by `PlayerStats.coinSources`, and a legacy
  `coins` number is dropped on migration, per the human. `setCoinSource` and
  `POST /api/games/:id/players/:targetId/coin` mirror the stat route. *The
  Internet*'s +2 cap is implemented by issue #145. Branch `feat/coin-tab`;
  review-approved in two read-only rounds (round 1's one minor, the
  documentation this entry is part of, fixed). 18 new engine tests (468
  total), 4 server (178), 5 web (141). Browser-verified against a local server:
  the tab, the 15 rows, `+` to 4 then disabled, four 200s on `/coin`, the
  read-only total, and a reload with the value kept. See `decisions.md`.

- **Down to a single coin marker.** The board palette had five coin variants;
  it now has one. `Coin`, `Coin 2`, `Coin 3` and `Coin 4` are removed from the
  manifest and their artwork deleted, and the old `Coin 1` is relabelled `Coin`.
  The human asked for it directly, with a screenshot, and confirmed `Coin 4` goes
  too. Built through `tools/board-assets.ps1` (the four sources added to
  `$exclude`, plus a new general `$labelOverrides` map) rather than hand-editing
  the generated JSON; the README marker count goes 11 → 7. The three test files
  that used `markers/coin` only as a stand-in marker now use `markers/coin1`, and
  one new engine test pins the absence of the four ids and the survivor's `Coin`
  label (450 engine tests). A previously placed coin piece keeps its stored
  position but its image 404s now the PNG is gone — accepted with the request,
  no migration. Branch `feat/coin-marker-cleanup`; review-approved in two
  read-only rounds (round 1's one nit, a missing guard test, fixed).

- **Issue #140: techs and social policy get their own panel, each with a tab
  per player.** The combined "Techs & Social policy" panel is split in two. Each
  panel has a tab bar — the viewer first, then one tab per opponent — labelled
  with the username and accented with the player's board colour, the turn-order
  tab convention the human picked. The viewer's own tab keeps the controls
  (Research, Reveal/Remove, hidden badges, "None chosen."); another player's tab
  is read-only and shows only what that player has revealed. Other players'
  revealed social policies are visible for the first time, through a new
  `OpaquePlayerhand.revealedSocialPolicies` projection that mirrors
  `revealedTechs` — no new route, and hidden policies/techs still never leave
  their owner's view (the leak test fails if the filter is removed). The pickers
  and the `?` policy reference stay above the tabs, so a spectator keeps them.
  The client no longer calls `GET /techs/revealed`; that route and
  `revealedTechsForAllPlayers` stay as the port of Java's `/tech/all`. 7 new web
  tests (136 total: `TechPanel` 9, new `SocialPolicyPanel` 10, replacing the old
  panel's 12). Branch `feat/issue-140-tech-policy-tabs`; merged as PR #143;
  review-approved in two
  read-only rounds (reviewer `deepseek/deepseek-v4-pro` with the human's
  approval, as Sol is unavailable; round 1 had two nits, both fixed), and the
  `rules-checker` confirmed Java never exposed social policies so nothing is
  invented. Browser-verified in a fresh two-player game: both panels render,
  switching tabs swaps the pyramid/cards, the opponent's hidden policy is absent
  from the viewer's DOM, clicking Reveal updated the owner's card after the
  reload, the ARIA wiring is correct and the console is clean. Screenshots were
  not possible (browser window not visible). See `decisions.md`.

- **Another player's turn-order text no longer bleeds into your own tab.** Turn
  drafts and live-dirty markers were keyed by turn and phase only, and wired for
  whichever player tab was showing. The real Milkdown editor flushes its
  document through `onChange` on unmount, and Crepe can serialize that document
  differently from the value it was given, so opening an opponent's tab wrote
  their text into the signed-in player's draft — where it reappeared on return
  and would have been submitted by "Save all changes". `TurnPanel` now records
  drafts and live-dirty markers only for the signed-in player's own workspace.
  Client-only: no engine, server or projection change. Branch
  `fix/turn-order-draft-bleed`; review-approved in two read-only rounds — round 1
  showed the first attempt (a read-only guard in `MarkdownEditor`) could drop the
  own player's final keystrokes while `busy` made their editor transiently
  read-only, so it was removed. 1 new web test (124 total). Browser verification
  left to the human.

- **A game page no longer fails with a raw `JSON.parse` message.** Opening a
  game intermittently answered `503 error code: 1102` - Cloudflare's "Worker
  exceeded resource limits" - from `GET /api/games/:id/revisions`, and the
  client's unguarded `JSON.parse` turned that plain-text page into a
  `SyntaxError` the game page then showed verbatim. The route was building a
  list of titles by reading the `state` column (the whole game state) of every
  revision and parsing each one, then discarding all of it. A new
  `Repository.listGameRevisionSummaries` selects the metadata without `state`,
  so the HTTP response is unchanged and the D1 read and the parsing are gone;
  `api.ts` now parses defensively and reports a non-JSON body as an `ApiError`
  naming the status. Auto-refresh moves from 30 s to 10 s at the human's
  request, in the same branch because the poll was the heaviest request on the
  page. `GameRevisionMetadata` is new; `Repository` gains one method. Verified:
  `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (449 engine,
  174 server, 129 web), and a repository test asserts the summary query does not
  select `state`. No browser pass: the banner needs a non-JSON 5xx, which no
  local route produces. Branch `fix/revisions-503`; PR #138 open; see
  `decisions.md`.

- **Tapping a board piece on touch arms the move in the same tap.** On a phone,
  one touch on an existing board piece now both selects it and arms destination
  mode, so the next tap on the board moves it there — the same two-tap flow as
  a palette asset. Touch-dragging the marked piece still drags it, a completed
  drag disarms the mode so a later stray tap cannot move the piece again, an
  8 px swipe still pans without moving, and a tap outside the board still
  clears the selection. This restores what commit `93bf305` ("Make map taps
  deselect touch pieces") removed; `state.md` had kept claiming it existed.
  Client-only: no engine, server, projection or CSS change. Branch
  `feat/board-tap-to-move`; review-approved in one read-only round with nothing
  above a nit (reviewer `deepseek/deepseek-v4-pro`, as Sol is unavailable);
  PR #136, merged.
  3 new web tests (123 total). Browser-verified in a real 390 x 844 CSS
  viewport: one tap armed the piece, the next tap sent `movePiece` (HTTP 200,
  the exact tapped board coordinate), a drag moved and disarmed, a swipe sent
  nothing, and the document had no horizontal overflow.

- **Issue #101: a social policy card reference, and unavailable policies greyed
  out.** The Techs & Social policy panel's "choose a card" dropdown now has a
  `?` button that opens a modal of all eight social policy cards — picture,
  printed text and flipside — like the Government column has had since issue
  #43. A policy the viewer already holds, or one whose own flipside the viewer
  holds, is disabled in the dropdown with its reason and named in a message, so
  the engine's `SOCIAL_POLICY_ALREADY_CHOSEN` / `SOCIAL_POLICY_FLIPSIDE_TAKEN`
  rejection is visible before the click. The client mirrors the engine's
  directional flipside check exactly (Java `PlayerAction.chooseSocialPolicy`),
  so nothing the server would accept is greyed out and nothing it would reject
  stays selectable — at the time this landed, that included a one-way
  `Military Tradition → Patronage` asymmetry, later found to be a data typo
  and corrected (issue #175; all four pairs are symmetric now). The Government
  reference was factored into shared
  `ReferenceDialog` / `ReferenceCard` with generic `reference-*` CSS; its only
  behaviour change is that focus returns to the `?` on close. Client-only: no
  engine, server or projection change — the reference renders the already-public
  `state.socialPolicies` catalogue. Branch `feat/issue-101-social-policy-reference`;
  review-approved in one read-only round with nothing above a nit (both nits
  fixed). 6 new web tests (120 total). Browser-verified against a local server:
  choosing `Rationalism` greyed out `Rationalism` and `Patronage` with the
  message, the `?` opened the eight-card modal with all art loaded, and Escape
  closed it and returned focus, with no console errors. See `decisions.md`.
- **A revealed turn-order version identical to the editor is hidden.** After a
  reveal the newest history version is the text still in the phase editor, so
  the panel printed the same order twice - once struck through and greyed above,
  once normally below. The `TurnHistory` component in `TurnPanel.tsx` now drops
  any version whose Markdown exactly equals the editor text, and renders nothing
  when none remain; versions that differ stay, oldest first, with their reveal
  timestamps. The stored `TurnOrderVersion[]` is untouched, so the public record
  and the reveal state are unchanged. Branch `feat/turn-history-hide-current`;
  review-approved in one read-only round with no findings above a nit. 2 new web
  tests (111 web total). No browser was connected, so the visual pass is left to
  the human; see `decisions.md`.

- **The site gets the Atlas look.** The stylesheet's own header said "Deliberately
  plain. The artwork comes later."; this is that pass. The site-wide palette,
  type and surfaces become parchment-and-brass in the light theme and
  midnight-blue-and-gold in the dark one, with self-hosted `Marcellus`/`Cinzel`
  for headings and the brand, and a painted board backdrop behind every page.
  The game page's panel order also changes: Log and Chat move from the bottom of
  the stack to directly under the board, side by side when the viewport has room.
  Data, props and behaviour are untouched — the game view's change is a reorder
  of its existing panel children. `styles.css` is restyled in place,
  and no selector, media query or custom property was removed
  (`removedClasses: []`, `removedMedia: []`, `removedVars: []` against `main`).
  PR #131's two mobile blocks are byte-identical, so `SiteMobileStyles.test.ts`
  passes unedited and the `2.75rem` touch minimums, the grid navigation and the
  `calc(100dvh - 1.5rem)` help menu still apply. New `SiteBackdrop.tsx`
  (decorative, `aria-hidden`, painted under `.app`), its test, two OFL fonts with
  their licences and one backdrop JPEG under `public/`. 3 new web tests (112
  total). Three further adjustments came out of the human testing it: `.app`
  grows with the viewport past the old fixed 1200 px (`max(1200px, min(94vw,
  2200px))`), so the board has room on a large screen while a sliver of the
  backdrop stays visible; each player-status row carries the player's colour as
  `--player-color`, which its bottom border takes, so a row stays identifiable
  when the status board is scrolled sideways; and a `.tech-pyramid-block`
  fieldset no longer forces the whole document wider than a phone screen — that
  last one was a pre-existing bug (a `fieldset` will not shrink below its
  content's minimum width), fixed here because it broke the mobile-first
  guarantee this change makes. Verified against the live app inside real 320 px,
  390 px, 768 px, 1280 px, 1600 px, 1920 px and 2560 px viewports: the panel
  stack is one column at every width, the new Log/Chat pair is one column on the
  phone and two above it, there is no
  accidental horizontal page overflow, and 44 px touch targets and WCAG AA
  contrast (measured 4.8-13.9) hold in both themes.
  No screenshots were captured — the browser window was not visible — so the
  visual pass is left to the human. Branch `feat/atlas-redesign`; the deliberate
  desktop-first responsive decision and the backdrop's provenance are in
  `decisions.md`. Merged as PR #133.

- **A revealed turn-order version identical to the editor is hidden.** After a
  reveal the newest history version is the text still in the phase editor, so
  the panel printed the same order twice - once struck through and greyed above,
  once normally below. The `TurnHistory` component in `TurnPanel.tsx` now drops
  any version whose Markdown exactly equals the editor text, and renders nothing
  when none remain; versions that differ stay, oldest first, with their reveal
  timestamps. The stored `TurnOrderVersion[]` is untouched, so the public record
  and the reveal state are unchanged. Branch `feat/turn-history-hide-current`;
  review-approved in one read-only round with no findings above a nit. 2 new web
  tests (111 web total). No browser was connected, so the visual pass is left to
  the human; see `decisions.md`.

- **The Techs list hides revealed techs.** In the Techs panel's "Yours" list a
  researched technology that has already been revealed kept a row tagged
  `revealed` with a `Remove` button, even though the pyramid above it already
  shows the tech. The human asked for the row to go ("just remove the boxes"),
  so the list is now filtered to still-hidden techs; a revealed tech stays on
  the viewer's pyramid. A follow-up also drops the viewer's own pyramid from the
  all-players section (renamed "Revealed by everyone" to "Revealed by other
  players"), so it is no longer drawn twice. Client-only: `Player.techsChosen`
  and the engine are untouched, so nothing was removed from the game. Empty
  states: `None chosen.` / `All researched techs are revealed.` for the list,
  and `Nobody has chosen a civilization yet.` / `No other player has chosen a
  civilization yet.` for the other-players section. Social policies keep their
  rows (no pyramid). Branch `feat/hide-revealed-techs`; review-approved in two
  read-only rounds with no findings above a nit. 6 web tests for the panel (100
  web total). No browser was connected, so the visual pass is left to the human;
  see `decisions.md`.

- **Issue #115, PR 1 (board mobile interactions).** The board now supports
  tap/select/place for palette assets and tap/select/move for existing pieces,
  while retaining desktop drag-and-drop. Pending placement/move states expose
  an accessible Cancel action; board panning, multi-pointer gestures,
  pointer-cancel/lost-capture cleanup and mouse movement tolerance prevent
  accidental writes. Tapping an existing or starting tile while a palette
  asset is armed now places the asset there instead of selecting the tile.
  On touch, selecting an existing piece immediately arms move mode so the
  next board tap moves it; tapping outside the board clears the selection.
  The board palette is responsive on narrow screens and
  exhausted/replay controls are disabled. Review-approved on branch
  `feat/issue-115-board`; real-device verification remains in the final issue
  Touch dragging now works on an already-marked piece without taking away
  board panning; tiles and starting tiles remain in a dedicated bottom
  stratum through movement, reorder and replay. Full checks pass (449 engine,
  173 server, 94 web tests). Removing a selected piece now also clears any
  stale movement mode so another player-area resource can be selected and
  removed immediately.
- **The front page's Action column comes first.** The Active games table's
  `Open` / `Join` / `Full` column moved from last to first, so on a narrow
  screen the buttons are reachable without scrolling the table sideways; the
  other six columns keep their order, and the Finished games table (which has no
  Action column) is unchanged. `.action-cell` is now left-aligned. This is a
  deliberate deviation from the old client's column order (`old-civ-web`'s
  `list.html` had Action last), recorded in `decisions.md` and `README.md`.
  Branch `feat/front-page-actions-first`; review-approved in two read-only
  rounds (reviewer `deepseek/deepseek-v4-pro`; Sol unavailable). 1 new web test
  (95 total). No browser was connected, so the light/dark visual pass is left to
  the human.
- **The front page's Open and Join buttons are coloured.** The game list's
  `Open` and `Join` actions were plain grey default buttons, so the two things a
  signed-in player can do on the front page were hard to see beside the
  disabled `Full`. `Open` now uses an `info` variant (the old `list.html` Join
  button's Bootstrap `.btn-info` teal: light `#5bc0de` / `#46b8da` / white,
  dark `#1f7f94`) and `Join` a green `success` variant (Bootstrap `.btn-success`
  in light `#5cb85c` / `#4cae4c` / white, dark `#2f7d43`), per the human's
  follow-up *"I want green color for join"*. `Full` stays grey; no layout or
  behaviour change. New `GameList` test asserts both variants and that `Full`
  has neither. Branch `feat/front-page-join-colors`; review-approved in two
  rounds (reviewer `deepseek/deepseek-v4-pro`), PR #123 open. 1 new web test
  (87 total). No browser was connected, so the light/dark visual pass is left to
  the human; see `decisions.md`.
- **Issue #125.** Each turn-order section (SOT, TRADE, CM, MOVEMENT, RESEARCH)
  keeps a history of every version its owner has revealed, shown oldest-first
  above the current editor as greyed, slightly transparent, struck-through text
  with the reveal's timestamp. A version is written only by `revealTurnOrder`
  (never by a save) and carries the caller-supplied ISO timestamp; revealing an
  already-revealed phase is a no-op. `PlayerTurn.history` therefore changes from
  Java's deduplicated list of *saved* order strings to
  `TurnOrderVersion { markdown, at }`; `withOrder` no longer touches it,
  `publicTurn` masks only the current text of an unpublished phase, and
  `withoutCurrentOrderInHistory` is deleted. Legacy string histories are dropped
  on migration — they were never displayed, mixed published and unpublished
  orders, and carried no timestamps. The human chose to replace the save-based
  field rather than add a second one; see `decisions.md`. Branch
  `feat/issue-125-turn-order-reveal-history`; review-approved in two read-only
  rounds, and the `rules-checker` found only the documented replacement. 5 new
  engine tests (448 total), 1 new web test (88 total). No browser was connected,
  so the visual pass is left to the human. The history shows the raw Markdown
  source; noted in the brief. A follow-up after the human's review gives every
  phase editor a fixed height and its own scrollbar (SOT/CM/MOVEMENT `10rem`,
  TRADE/RESEARCH `6rem`) and caps the revealed history in its own scroll area;
  the private log keeps its default size. The history wraps long lines rather
  than scrolling horizontally.
- **Only Tradable cards can be given away.** The hand's "Give" control was drawn
  on every card, but `tradeToPlayer` only accepts Java's `Tradable` set (Culture
  I/II/III, Hut, Village); every other kind returned `ITEM_NOT_FOUND`, so the
  control invited a click that could not succeed. The Give control
  (`GiveControl` in `GameView.tsx`) is now rendered only for a Tradable item, so
  Great Person, Civ, City-state, units, wonders, tiles, techs and social
  policies no longer offer it; the engine gate is unchanged. (An earlier pass on
  this branch wrongly *enabled* gifting Great Person and Civ; that is reverted —
  see `decisions.md`.) Also declared `@types/node` on `packages/engine`, whose
  tests import `node:fs`/`node:url`; a lockfile refresh had dropped the hoisting
  accident it relied on, breaking `pnpm -r typecheck` on `main`. Branch
  `feat/gift-greatperson-civ`.
- **Creating a game sends no email.** The new-game broadcast to every account is
  removed outright: `POST /api/games` now sends nothing, and the `gameCreated`
  notification, the `broadcastNewGames` option and the `MAIL_BROADCAST_NEW_GAMES`
  variable are gone. `GLOBAL_COOLDOWN_MS`, `globalScope` and `runInBackground`
  (whose only production caller it was) go with it; the other five triggers, the
  30-minute per-player-in-game cooldown, the unsubscribe links, `disableEmail`
  and the admin mass mail are unchanged. Branch `feat/remove-new-game-email`.
- **Issue #116.** Huts and Villages are no longer capped at the player count in
  the board palette: a two-player game showed "Hut (2)" / "Village (2)" and
  refused a third piece. `boardAssetLimit` returns `undefined` for
  `resources/hut` and `resources/village`; wheat, iron, silk and incense keep
  the issue #49 player-count cap, and buildings and Great Persons are untouched.
  No client change — the palette already hides the count and the exhausted state
  for an unlimited asset. Branch `fix/issue-116-hut-village-unlimited`;
  review-approved after two read-only rounds (round one's findings all fixed).
  1 new engine test (430 total) and 1 new web test (74 total).
- **Read-only review loop in OpenCode.** OpenCode gets the missing read-only
  `reviewer` agent under `.opencode/agents/`, and every change now runs through
  the read-only reviewer after the first implementation, iterating until a round
  reports nothing above a nit. The rule is stated in `AGENTS.md`,
  `workflow.md`, `roles.md` and both review-gate skill copies (Claude and
  Codex); the old claim that OpenCode had no reviewer is corrected. Branch
  `chore/opencode-readonly-review-loop`; review-approved in two read-only
  rounds. Documentation-only; no test counts change.
- **Buy Me a Coffee in the footer.** The site-wide footer now shows a Buy Me a
  Coffee button beside the PayPal donate button, from the exact markup the owner
  supplied (`buymeacoffee.com/cash1981`). A plain image link, not the provider's
  JavaScript widget; the PayPal form is untouched. The supplied code had no
  `target`/`rel`/`alt`, so the client's external-link convention and an `alt`
  were added. Branch `feat/buymeacoffee-footer`; review self-checked in
  OpenCode (no game rules involved). 1 new web test (73 total).
- **Discard a random great person of a type.** The "Your hand" panel offers a
  random discard for each Great Person type the player holds two or more of —
  the case the human described, where two Generals are held and one is killed.
  The pure engine `discardRandomGreatPerson` shuffles the matching cards with
  the seeded RNG and reuses `discardItem`'s discard pile, with a public log line
  that says "has randomly discarded" (the human asked for the loot-style
  wording); a new `NOTHING_TO_DISCARD` error maps to 404. New mechanic with no
  old-system counterpart, specified by the human (see `decisions.md`). Branch
  `feat/great-person-discard`; review-approved (reviewer `deepseek/deepseek-v4-pro`;
  Sol unavailable) and the read-only `rules-checker` confirmed there is no
  old-system equivalent. 5 new engine tests, 3 server, 4 web. Verified end to
  end against a running server: a hand of Artist-or-Thinker + two Generals
  offered only "General", and one random General was discarded with the public
  "has randomly discarded" line. No browser pass was possible — no browser was
  connected to the session.
- **The start-of-game wonder deal is logged as System.** The four ancient
  wonders dealt once every civilization is revealed were credited to the last
  player who revealed a civ; they are now logged as `System: drew <wonder> and
  placed it in the Wonders area`. `drawWonderToBoard` gained an optional `actor`
  (default the player), and only `drawStartingWonders` passes `system`; manual
  draws still credit the player. Branch `feat/great-person-discard`.
- **Starting tile orientation.** Every civilization's starting tile was laid
  facing outwards: the artwork is uniform (all sixteen tiles carry the arrow on
  the bottom edge pointing up), but `startingCorner` assumed it pointed down and
  its per-corner table was wrong. The top two corners now turn 180° and the
  bottom two stay at 0°, so every arrow points at the middle. In the same
  branch, the two-player 16 × 8 board puts player 2 in the opposite south-east
  corner (M5–P8) and runs both arrows along the long axis at each other (90° and
  270°). Branch `fix/starting-tile-orientation`; the human waived the review gate
  and verified in the browser instead. 1 new engine test (429 total).

- **Culture track artwork.** The board shows the correct track,
  `Moderator/map/culturetrack.png` (2572 × 216), instead of the wrong
  `DoC/PBF Modding Material/culture track.png`. It has 20 spaces in three groups
  of 7, 7 and 6 rather than 27, so the cell geometry, START and Culture Victory
  fractions, tests and docs were re-measured, and `CULTURE_TRACK_SCALE` drops
  from 1.7 to 1.3 to keep the band's 164 px height. The track stays a marker
  only. Branch `feat/culture-track-artwork`; review-approved, PR to open.
- **Movement as an expression (issue #102).** The Player status board's
  Movement column now accepts the table shorthand `3+1` for natural religion's
  +1: `PlayerStats.mvmt` is literal text (a base plus zero or more `+bonus`
  parts), shared validation in `isMovementValue`/`MOVEMENT_VALUE_PATTERN`, a
  generic `setPlayerStat` so a Movement expression on a numeric stat is a
  compile error too, and `migrateGameState` converting an older numeric value.
  It stays pure bookkeeping, never used in a calculation. New engine, server and
  web tests cover the expression, the invalids, and the migration. Branch
  `fix/issue-102-movement-text`; review-approved (reviewer
  `deepseek/deepseek-v4-pro`, as Sol was unavailable).
- **Turn-order reveal follow-up.** Reveal now waits for saved phase content,
  logs `Turn <n> - <username> revealed <phase> phase`, and requires a new
  reveal after editing a published phase. Branch
  `fix/turn-order-reveal-followup`, review-approved and pushed; awaiting merge.
- **Admin email broadcast (issue #92).** The old `GameAction.sendMailToAll` —
  unreachable in Java, its `PUT /admin/mail` caller commented out — is back as
  `POST /api/admin/email/broadcast` (admin only). The admin page gains a "Send
  email to all players" panel: an editable subject (default "Message from cash
  at playciv.app"), the WYSIWYG Markdown editor whose body `marked` renders to
  HTML (the Markdown source stays as the plain-text fallback), and a checkbox to
  also mail unsubscribed players. Each mail keeps the `Hello <username>`
  greeting and the unsubscribe link; one send failure is logged and skipped. The
  untrusted-HTML and in-request-volume caveats are in `decisions.md` and
  `README.md`. 8 new server tests (the broadcast plus the mailer's HTML field)
  and 4 web tests. Review-approved on branch `feat/issue-92-admin-email-broadcast`;
  PR to open.

- **Cloudflare observability config.** `wrangler.jsonc` now persists the
  dashboard-supplied invocation-log and trace settings; Wrangler dry-run
  accepts the config. Branch `chore/cloudflare-observability`, review-approved.
- **Turn-order reveal hotfix.** Each SOT, TRADE, CM, MOVEMENT and RESEARCH
  order stays private until its owner reveals it; public projections mask
  unrevealed text/history, old games migrate as public, and the UI has a
  per-phase Reveal button. Branch `fix/turn-order-reveal`, review-approved and
  pushed; awaiting merge.
- **Password reset (issue #37).** `PUT /api/auth/newpassword` mails a one-hour
  signed reset link and `GET /api/auth/verify/{token}` applies it; the login
  screen has the old "Forgot password" form. The link carries the scrypt hash of
  the new password, so nothing is stored server-side and the plaintext is never
  persisted; an unknown email answers 200 so accounts cannot be enumerated. Four
  new server tests and one web test. Deliberate differences from Java are in
  `decisions.md` and `README.md`. Branch `feat/issue-37-password-reset`,
  awaiting review.
- **Email notifications (issue #30).** Resend mailer in the Node API with every
  old trigger except the new-game broadcast (your turn, join, chat, game ended,
  game deleted, the five turn-phase updates), the 30-minute per-player-in-game
  throttle, `disableEmail` and the unauthenticated stop/start links. The
  new-game broadcast was gated by `MAIL_BROADCAST_NEW_GAMES` and later removed
  outright; the two deliberate differences from Java (link on every mail,
  unsubscribe honoured everywhere) are in `decisions.md` and `README.md`. 21 new
  server tests.
- **OpenCode agents.** OpenCode gets the `coder`, `reviewer` and `rules-checker`
  roles under `.opencode/agents/`, mirroring `.claude/agents/`. The `reviewer`
  and `rules-checker` are read-only and the coder cannot spawn subagents. Every
  change goes through the read-only reviewer after the first implementation,
  iterating until a round reports nothing above a nit (see `workflow.md`); the
  earlier claim that OpenCode had no reviewer is superseded. Skills still load
  from `.claude/skills/`.
- **The port itself.** Deck, items, draws, reshuffle, hands, techs, social
  policy, trade, turns, undo voting, chat, game lifecycle. Every Java action
  class has a counterpart and a test file naming it.
- **Server.** Hono over the engine (one HTTP codebase for Node and Cloudflare
  Workers), scrypt passwords, HMAC bearer tokens, JSON-file repository standing
  in for MongoDB.
- **Cloudflare deploy.** A `packages/worker` Cloudflare Worker serves the built
  SPA (static assets) and runs the Hono API itself for `/api/*` against D1
  (issue #72). It holds no second host. Local development is unchanged:
  `pnpm dev` runs the Node server against the JSON file. See `decisions.md`.
- **Storage is Cloudflare D1 (issue #72).** `D1Repository` implements
  `Repository` over the Worker's `DB` binding; MongoDB Atlas, the `mongodb`
  driver, `render.yaml` and the Render proxy are gone. Only the data the app
  uses is migrated: 554 `player` accounts and 310 old `pbf` games (full
  documents archived chunked), 247 with a winner. The old `chat` (87,756),
  `gamelog` (66,288) and `tournament` data is dropped — the mongodump backup
  keeps it. The re-created D1 database now holds the reduced import, verified by
  count (554 players, 310 `pbf`, 876 `pbf_doc` chunks, 247 finished). Local dev keeps
  the JSON file; `D1Repository` is tested through a `node:sqlite` adapter, and
  the root requires Node 24+. First review round fixed Unicode username lookup
  (`0002_username_lower.sql`), made the migration fail on a wrong `--dump`
  instead of writing an empty file, and stopped the D1 tests from skipping
  themselves. See `tasks/issue-72-d1.md`.
- **Client.** React and Vite: login, game list, game page, hand, draws, battle,
  techs, turn orders, log, undo votes, chat.
- **Issues #54 and #56.** Game and lobby chat show local log-format timestamps;
  the board header now reads only **Civilization Boardgame**.
- **Board.** 16 × 16 map from the PowerPoint template, free pixel placement,
  stacking by array order, seven palette categories, map tiles that place
  themselves, starting tiles in the right corner with the arrow inwards.
- **Player areas.** A band below the map, one per player, pieces tidy into rows.
- **Wonders on the board.** A `wonder` board-asset category (27 pieces, art from
  `Civilization/Moderator/wonders`) shows in the piece palette. A shared
  **Wonders** area sits at the right of the player-area band — the player areas
  shrink to make room — and every wonder drawn at game start, or drawn manually,
  is placed there and named in a public log line instead of going into a hand.
  Manual wonder draws stay turn-gated like any other draw; a `wondersDealt` flag
  (not board pieces) decides whether the start-of-game deal has run, so palette
  art never cancels it. Verified in the browser.
- **City-states on the board.** A `citystate` board-asset category (the five
  neutral city-states cs1–cs5, art from `Civilization/Moderator/city-states`,
  capped to one square) shows in the piece palette, so a city-state can be placed
  on the map like a city. Placing one does not count towards a player's city
  count (`cityCountOf` filters `category === 'city'`). Verified in the browser.
- **Board history.** Every change recorded as a semantic operation, giving exact
  undo and step-by-step replay with the log trimmed to each step.
- **Everything in English.**
- **Culture track.** A band above the map, 20 spaces in three groups of 7, 7 and
  6, measured off `Moderator/map/culturetrack.png`. Leader markers are placed
  freely, not snapped to a space, so they can be nudged anywhere and can share a
  space; the log still names the nearest space. Choosing a civilization places
  that leader on Start. The band is drawn `CULTURE_TRACK_SCALE` (1.3×) taller
  than its bare aspect so it reads well at any zoom (issue #22); 1.3 keeps the
  printed band the same height as before the artwork was replaced.
- **Card artwork.** Every item, including Space Flight, has a picture (see
  issue #168 below for its tech art specifically). The hand renders as cards.
- **MongoDB storage (superseded by D1, issue #72).** `MongoRepository` ran
  against the restored `playciv` database, with the JSON file as fallback. It
  reused `player`/`chat`, read old `pbf` games for highscore, and stored new
  games in `game_state`. Old SHA-1 logins verify and upgrade to scrypt — that
  behaviour is unchanged in `D1Repository`. Highscore matched Java
  (Andrius 39/68, cash 36/58). See the D1 entry above.
- **Highscore UI.** A public `/highscore` page (branch `feat/highscore-page`)
  porting `old-civ-web`'s: two-level Player/Civilization tabs over Total and
  2/3/4/5-player sub-tabs, sortable and paginated (10/page, default `totalWins`
  desc), reading `GET /api/highscore`. See `tasks/highscore-page.md`.
- **Tech tree.** The AngularJS pyramid, private and public: your own techs
  (hidden ones badged) and one public pyramid per player from
  `revealedTechsForAllPlayers`. Verified in the browser; the hidden-info test
  is proven load-bearing.
- **Issue #13.** Hidden technologies retain their yellow border without the
  cropped "only you" badge in the tech pyramid.
- **Issue #14.** The destructive "Clear board" action is gone end to end: the
  UI control, the `clearBoard` reducer, the `POST /board/clear` route and the
  `api.clearBoard` method are all removed. Undo and replay remain, and the
  `{ kind: 'clear' }` history variant is kept so older cleared games still
  replay.
- **Issue #15.** Opening or joining a game uses `/game/<gameid>`, restores on
  refresh, and synchronizes browser back navigation.
- **Issue #16.** Players can remove their own social policies; the action is
  logged and exposed through the UI/API.
- **Board size.** Two-player games use a 16 × 8 board (A–P, 1–8); three- to
  five-player games use the full 16 × 16 board (A–P, 1–16). (Issue #17 asked for
  a smaller two-player map; the size was settled with the owner as 16 × 8, after
  a brief detour through 8 × 8 and full 16 × 16. See `decisions.md`.)
- **Delete game.** Game creators and enabled admins can permanently delete
  active or ended games; other players are denied.
- **Typecheck build order.** Engine declarations are rebuilt automatically
  before recursive typecheck, so clean checkouts do not use stale `dist` files.
- **Admin user management.** Accounts persist `role` and `disabled`, disabled
  accounts are rejected server-side, admins can manage users without password
  hashes in API responses, and the protected web admin page uses role lookup
  from storage rather than token claims.
- **Issue #21.** Joining a game now opens that game immediately after the join
  request succeeds.
- **Issue #23.** Social-policy choose, reveal and removal logs now retain one
  player-specific item number, while a reselected policy gets a fresh number.
- **Issue #20.** Added a persisted light theme, white board surroundings and
  `tileback.png` fog of war for empty map slots; dark remains the default.
- **Issue #19.** The admin user page pages 10 at a time in the browser, filters
  by username or email, and edits a username or email inline. The PATCH route and
  both repositories now accept a `username` change, rejected with `USERNAME_TAKEN`
  when another account already uses that name (case-insensitive).
- **Issue #26.** The white army figure is removed from the board palette: gone
  from the manifest and the public art, and excluded in `tools/board-assets.ps1`
  so a regeneration keeps it out.
- **Issue #33.** Added the responsive navigation menu and bundled rule/help
  resources, with links to FAQ, About and Highscore.
- **Issue #34.** Added a public FAQ with current virtual-board and join-flow
  guidance, replacing obsolete Google Slides instructions.
- **Issue #35.** Added the public About page with license, FFG disclaimer,
   repository links and contact information.
- **Issue #38.** Added the anonymous landing page with public games, highscore
  and lobby chat, including public-data privacy regression coverage.
  **Issue #43.** A "Player status" panel replaces the old asset spreadsheet: one
  row per player, most columns auto-derived (culture-track level, city/building
  counts, techs, policies, hand, units), plus four editable stats (coins, trade,
  culture, victory points) that any game member may edit via `setPlayerStat`
  (`POST /api/games/:id/players/:targetId/stat`), logged publicly. Building
  ownership falls back to `placedBy` since building art has no colour variant.
- **Player status details.** Replaced obsolete status columns with grouped,
  editable Units and Cards, default modifiers, and EftA/Infra/MIC/PE values;
  older saved stats are migrated with defaults and Combat supports signed
  modifiers.
- **Issue #49.** Board supplies are now finite and visible: building counts
  come from the physical reference sheet, resources have one pool per type
  sized to the player count, and Great Person board assets have three pieces
  per type. Placement is rejected at zero and removal restores supply.
- **Issue #49 correction.** Building availability now uses the physical counts
  from the reference image: Market/Bank 5, Temple/Cathedral 5,
  Barracks/Academy 5, Granary/Aqueduct 6, Library/University 6, Workshop 6,
  Harbor 10, Tradingpost 6, Shipyard 5, and Ironmine 6.
- **Issue #51.** The Opponents panel is replaced by a **Revealed and Discarded
  Items** panel: a chronological, newest-first feed of every public item — the
  card, who revealed or owns it, and whether it was revealed, discarded, or
  both. `revealedFeed` builds it from the public set (discarded items plus
  non-hidden hand items, so hidden hands and techs never appear) and enriches it
  from the log for chronology, the revealing player, and revealed-then-discarded
  (one row, both facts, keyed by item identity). The route pages it server-side
  (`?page=&size=`, default 20, capped 100) so the browser never loads the whole
  history or every image at once. The `opponents` data stays on the view for the
  turn banner, Player status and the trade dropdown. Browser-verified.

- **Issue #63.** Battle arena: initiate (attacker vs player or barbarians), drag-and-drop units from battlehand/barbarians to positional arena fronts, manual attack/health inputs per unit, kill button, advisory turn marker, per-side HP+attack summaries, `endBattleTurn` / `endBattleArena` actions, concurrent-write protection via `rev` counter (409 on mismatch), and a 30-second auto-refresh toggle (top-right, persisted in `localStorage`). No server-side turn enforcement. `battle: Battle | null` and `rev: number` added to `GameState` and `PlayerView`; migrated with `?? null` / `?? 0`. All checks pass on `feat/issue-63-battle-arena`.
- **Issue #65.** `killArenaUnit` and `endBattleTurn` now reject non-participants with `NOT_IN_THIS_BATTLE`, matching `endBattleAction`'s existing guard. The "End turn", "End battle" and per-unit "Kill" buttons are hidden client-side for non-participants. `setArenaUnitStat` stays open to any game member on purpose (see `decisions.md`).
- **Issue #63 UX pass.** Fixed three problems found testing the merged arena in the browser: the arena is now one shared bordered frame (was two separate boxes), placing a unit is immediate with no confirmation step (was easy to miss, looked broken), and arena cards are smaller with a horizontal scrollbar per side (was an ever-growing vertical stack). Also added a cosmetic Rotate button per arena unit (`ArenaUnit.rotation`, reusing the board's `Rotation`/`nextRotation`) so a card can be spun to whichever printed unit level it represents — independent of the manually-entered attack/health. Browser-verified with two live accounts.
- **Issue #68.** Seven more fixes on the same branch: the standalone "End battle" cleanup button now hides once nothing is left `inBattle`; a unit disappears from the battlehand/barbarians list the moment it is placed in the arena; arena cards are back to full battlehand-card size; Rotate now turns counter-clockwise and suggests the next tier's attack/health (base + presses, wrapping after 360°, skipped for aircraft which print no level ladder); the Revealed and Discarded Items panel's fallback tiebreak (entries with no distinguishing timestamp) now also sorts newest-first; Battle/Techs/Revealed/Log default to collapsed; Chat is now its own collapsible panel with 10-per-page client-side pagination (`ChatPanel.tsx`, split out of `LogPanel.tsx`).
- **Issue #71.** Five more fixes on the same branch: `initiateBattle` now opens the turn with the defender, not the attacker; a `CollapsiblePanel`'s open/closed state persists to `localStorage` across a reload; an arena card's own displayed name/number now tracks its live attack/health instead of the frozen printed snapshot; killing an arena unit is now an undoable toggle (`ArenaUnit.killed`) rather than an immediate removal, made permanent (source card discarded, matching each source's own discard convention) only when the battle actually ends; added `moveArenaUnit` (reposition) and `returnArenaUnitToHand` (undo a placement), both restricted to the unit's own side, with drag-and-drop support and a same-position/wrong-side no-op guard. A review round caught and fixed a real bug in the first pass: the "collapse repeated log lines" helper had carried the card on the log entry's `item` field for correlation, which made these entries reachable through the undo system and would have corrupted the game on an accepted undo — fixed to match on message text instead, never on `item`. A follow-up fixed a regression the live-stat display itself introduced: `ItemCard` now takes an optional `labelOverride`, so the caption text can show an arena unit's live attack/health without mutating the `item` passed to it — the mutated clone had pointed `itemImage()`'s filename lookup at a card art file that does not exist (every printed card has one specific attack/health pair), so the art silently went blank on the first rotate or stat edit.
- **Issue #69.** Turn orders now use color-accented username tabs with a
    per-player turn selector and five WYSIWYG Markdown phase editors. Only the
    signed-in player's unlocked turn is editable; opponents remain read-only.
    The redundant aggregate order list is gone, and a private, explicitly saved
    **Private log** tab reuses `gamenote` without adding public log entries.
- **Issue #74.** Two more fixes on the same branch: arena cards now face each other across the table (the attacker's row gets a base +180° visual rotation on top of its own printed-level rotation, since it renders above the defender's row); and a killed unit no longer blocks its own front — placing or moving a unit onto a front that still holds a killed one reinforces it, moving the fallen unit into `Battle.departedUnits` (see issue #75 below for what happens to its card).
- **Issue #75.** Reverted the auto-discard-on-end-battle behaviour issue #71 had added, per the human's direct correction: ending a battle now returns every arena unit's card to hand exactly like an unkilled one's — `inBattle` cleared, nothing more — restoring the original issue-63 decision that the player discards a killed unit themselves. A follow-up design question (a reinforced-away unit's card becoming placeable again mid-battle would reopen the issue #68 bug) was put to the human directly: the card stays locked (`inBattle: true`) for the rest of the battle. `Battle` gained `departedUnits: readonly ArenaUnit[]` for this; `endBattleAction` frees `[...battle.arena, ...battle.departedUnits]` together, at the same moment. `ArenaUnit.killed`, the kill/undo-kill toggle, the DEAD tag, and `battleSummaries` excluding killed units from totals are unchanged.
- **Issue #79.** Two more fixes on the same branch: removed the manual "Draw 3" barbarian button and its `POST /battle/barbarians` route/`api.drawBarbarians` client method — `initiateBattle` already auto-draws 3 barbarians for the left-side player, so the button only invited drawing early or twice; "Discard" stays. `endBattleAction` now logs the winner when a battle ends: each side's remaining HP plus its combat bonus (`PlayerStats.combat`, issue #43, always 0 for barbarians), higher wins, a draw goes to the defender — a new arena-only mechanic specified directly by the human, with no counterpart in the old system. `battleSummaries` is now exported from `state.ts` so `endBattleAction` can reuse it.
- **Issue #70.** Added immutable full-game revision snapshots and secure viewer-specific historical endpoints, with compare-and-set writes and transactional Mongo persistence. A global Back / Forward / Live bar now replays the complete game page, keeps chat/private notes outside history, disables game mutations in replay, and preserves the selected revision while live updates arrive. Browser-verified and review-approved.
- **Issue #78.** Added the old manual loot controls to Your hand: the losing
  player chooses the receiving opponent and randomly transfers one Culture
  Card (one combined Culture I/II/III pool), Hut or Village. The route retains
  the old explicit-sheet and error behaviour. Browser-verified and
  review-approved.
- **Issues #81 and #82.** Every read-only game route (`GET /api/games/:gameId`, its revision history, techs, social policies, turn orders, undo status, the revealed feed, the board-piece catalogue) now accepts a request with no bearer token, not just one from a signed-in non-member — `toPlayerView`/`opaque()` already projected a non-member safely, this only stops the routes rejecting one before reaching it. A present-but-invalid/expired/disabled token still 401s/403s exactly as before, so a real player's expired session cannot be mistaken for their own game turning read-only. The client renders the game screen for a signed-out visitor, hides the four write-only action buttons for a non-member, no longer treats a spectator's failed write as a sign-out, and the game list links each name to `/game/:id`. Withdrawing now navigates back to the games list on success instead of trying to reload a game the withdrawn player can no longer act on. Review-approved (one round of findings, all fixed); browser-verified with a real second account withdrawing, and an anonymous request against a live game.
- **Issue #43 Governments.** Player status now stores a public government per player, defaults and migrates to Despotism, applies the Rome/Russia/Japan starting exceptions, and lets any member update the shared value with a public log entry. The supplied artwork and accessible text for all eight *Wisdom and Warfare* cards open from a `?` help button in a keyboard-accessible modal; Social Policy remains discoverable in the open Techs panel. Spectator and replay controls are read-only; browser-verified and review-approved.
- **Issue #77.** A site-wide footer under every screen: the copyright line, the Apache 2.0 license link and the old PayPal donate button (the exact encrypted hosted button from `old-civ-web`). Patreon is dropped on purpose; see `decisions.md`.
- **Issue #40.** The register form asks the old fixed question ("What is China's starting tech?") and `POST /api/auth/register` now requires a `securityAnswer` field, accepting only `writing` case-insensitive, so a direct API call can no longer skip the gate the old client enforced alone. The client refuses a wrong answer before calling the API, as `RegisterController.js` did. The question is a speed bump, not a security boundary, and server enforcement is a deliberate improvement over Java — recorded in `decisions.md` and `README.md`. Review-approved on branch `feat/issue-40-signup-security-question`, PR to open; the route is covered by the Hono tests and the form by `LoginView.test.tsx` (no browser connection was available for a manual pass).
- **Game list tabs.** The front page splits its single list into **Active games**
  and **Finished games** tabs, each a sortable table paged at ten rows, with the
  old search box and a real "Show my games" membership filter; this is
  `old-civ-web`'s `list.html` split, rebuilt on the shared `SortableTable` (now
  generic, with `Tabs`/`Pager` split out). `GameState.createdAt` is new, stamped
  by the server on create and defaulted to `null` by `migrateGameState`, so the
  old Created column has a source. A follow-up fixed the "Show my games" filter
  surviving a sign-out, made a numeric column open descending even on an empty
  table (direction now comes from the column, not a sample row), right-aligned
  the Action header, dropped the Players cell's trailing line break, memoised
  the column arrays, and added a **Beta** badge after the *Play Civilization*
  heading. Branch `feat/games-list-tabs`; the deliberate differences from the old
  client and the createdAt addition are in `decisions.md` and `README.md`. 4 new
  engine tests, 1 server test, 13 web tests. A second follow-up made the games
  panel full width (the table had drawn over the chat column), moved the lobby
  chat to the bottom as its own `LobbyChat` panel with the shared pager (ten per
  page), and changed `GET /api/chat` to return ~3 months newest first with no
  50-message cap; 1 server test replaced, 5 new web tests.
- **Issue #40.** The register form asks the old fixed question ("What is China's starting tech?") and `POST /api/auth/register` now requires a `securityAnswer` field, accepting only `writing` case-insensitive, so a direct API call can no longer skip the gate the old client enforced alone. The client refuses a wrong answer before calling the API, as `RegisterController.js` did. The question is a speed bump, not a security boundary, and server enforcement is a deliberate improvement over Java — recorded in `decisions.md` and `README.md`. Review-approved and merged as PR #94; the route is covered by the Hono tests and the form by `LoginView.test.tsx` (no browser connection was available for a manual pass).

## In progress

_Nothing._

## Next, in order

_Nothing queued._

## Known problems and loose ends

- **A `StatusPanel` government-reference test intermittently times out under
  the full run.** `StatusPanel.test.tsx > StatusPanel governments > shows every
  government in each dropdown and every reference card with all effects` is
  synchronous and renders the whole government reference (8 cards, all
  effects). It takes about 3.8 s when its file runs alone, but can exceed 5 s -
  vitest's default - under the full parallel web run when the machine is loaded,
  failing `pnpm -r test`. It failed the same way on `main` before this branch
  (`876cf6b`), so it is not caused by the favicon change; it was likely made
  heavier by the Coins section `coin-tab` added to the same panel. It passed in
  the final verification run here (468 engine, 178 server, 148 web). Raising that
  one test's timeout, or splitting the assertion, would remove it.

- **A non-member's board is still interactive (found in the `board-tap-to-move`
  mobile pass).** On a public game page a signed-out visitor can tap a piece and
  tap a destination; the move is sent and fails with 401 `Missing bearer token`,
  shown as an error banner. `GameView.tsx` passes `readOnly={replaying}` to
  `BoardView`, while the other panels use `displayedView.you === null ||
  replaying`. The palette, Undo and the piece actions would all honour a
  `readOnly` board, so the fix is one line plus a test — but `GameView.tsx` is
  listed in live claims (atlas-redesign `panel order only`,
  gift-greatperson-civ `GiveControl only`), so it was reported, not fixed. The
  same pass found no horizontal overflow on the game page at 390 px or 320 px,
  and the wide status table scrolls inside its own `.scroll-x` as designed.

- **Game fixes done on `feat/game-fixes`** (off `feat/mongodb-storage`), each
  through the review gate: membership on endturn/taketurn (403 for non-members),
  `GAME_NOT_STARTED` (409) instead of a misleading "Couldn't find player",
  log timestamp stamping on game creation, deterministic newest-first log sort,
  map tiles snap to the grid on move (bug #6), and the duplicate
  `startplayer_100_100` marker removed. Client-visual: board zoom now pans with
  scrollbars (task 3) and the tech pyramid no longer clips its left edge or
  overlaps the turn orders — both browser-verified. Civ-tile auto-placement,
  the `dd.MM.yyyy hh:mm:ss` log format, log sorting and collapsible panels were
  already in place (Luna) and confirmed working. 297 engine + 51 server tests
  pass. Branch pushed; PR still to open.

- **Card images are large** — up to 1 MB each, straight from the old client.
  Fine locally, wasteful over a network. Nobody has decided to optimise them.
- **Authentication is development grade.** scrypt and signed bearer tokens that
  cannot be revoked before they expire. Better than the Java original's
  unsalted SHA-1 over HTTP Basic, not reviewed for production.
- **FFG artwork is committed to a public repository.** The human decided this
  deliberately; see `decisions.md`.
- **Browser screenshots in the Claude preview pane fail** when the window is in
  the background. DOM inspection through `javascript_tool` works and is the
  reliable way to verify the client.

## Deferred on purpose

Migrating old `pbf` games to playable form · tournament collection · email
notification · `AdminAction` · websockets for live updates.
