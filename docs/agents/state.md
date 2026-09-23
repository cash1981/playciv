# State

Where the project stands. Read this first; it is here so you do not have to
read the codebase to find out what is done.

Keep it short. One line per finished thing. Detail that is worth keeping goes
in `decisions.md`; detail that is not goes nowhere.

_Last updated: 2026-09-23_

## Health

| Check | Status |
| --- | --- |
| `pnpm -r typecheck` | passing |
| `pnpm -r test` | passing - 449 engine, 173 server, 123 web |
| `pnpm -r build` | passing |
| `main` pushed to `origin` | yes; PR #134 merged; open pull request: #136 (board tap-to-move) |

## Done

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
  PR #136 open.
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
  including the one-way `Military Tradition → Patronage` asymmetry, so nothing
  the server would accept is greyed out and nothing it would reject stays
  selectable. The Government reference was factored into shared
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
- **Card artwork.** 346 of 347 items have a picture; only Space Flight does
  not, because it is added in code rather than read from the spreadsheet. The
  hand renders as cards.
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

- **Space Flight has no artwork.** Nothing to fix; there is no such card.
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
