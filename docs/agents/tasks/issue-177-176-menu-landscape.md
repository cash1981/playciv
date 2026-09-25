# Hamburger menu, a turn/phase title, and a landscape-aware layout

- **Slug:** `issue-177-176-menu-landscape`
- **Branch:** `feat/issue-177-176-menu-landscape`
- **Owner:** Claude (orchestrator, direct — no coder subagent for this one)
- **Status:** reopened — build fix in progress

## Goal

Two client-only fixes the human asked for together, in one PR:

- **Issue #177.** The top navigation and the game page header are decluttered.
  A single hamburger menu replaces the always-visible FAQ/About/Highscore/Rules
  links plus theme/sign-in controls, on every screen size (not just mobile).
  On a game page the same menu gains a "Game" section with Withdraw and (for
  the creator or an admin) Delete game, and "Back to games" is removed
  outright. `GameView`'s h1 stops showing the game name and instead shows,
  large, whose turn it is and which phase — the game name survives as a small
  subtitle next to it.
- **Issue #176.** In landscape on a phone, the board's dark background and the
  page's own background collide because every relevant breakpoint in
  `styles.css` keys off viewport *width* only (600/700/900px). A landscape
  phone is wide (700-930px) but short (350-430px), so it falls through to
  desktop-width rules in a viewport that is actually cramped. The same compact
  treatment those rules already give a narrow phone should also apply when the
  viewport is short, regardless of width.

## Why

Both from the human directly, each with a screenshot from their own phone
(issue #177 portrait, issue #176 landscape). Quoted from the GitHub issues:

> The top menu should be a proper menu, use a hamburger icon typical for
> mobile phone and the withdraw and delete game should be a menu action like
> the old-civ-web. The yellow colored stuff should be moved to menu. The blue
> should be big text instead of title of the game. the title should be
> instead next players phase turn. Too much clutter of text. We should
> minimize the verbosity. Red back to the games can be deleted.
> — issue #177

> Landscape mode the map draws over the blue background. The blue background
> should also use the entire width.
> — issue #176

Clarified live with the human before starting (chat, not the issue text):
hamburger menu applies everywhere, not just mobile; the game name is kept as
a small subtitle, not removed; scope beyond the explicitly-circled elements
(Withdraw/Delete/Back-to-games/title) is deliberately narrow — the
civilization tag, colour swatch and "Auto-refresh" toggle are untouched; and
for #176 a sound root-cause fix verified with the browser tool's viewport
emulation is enough — there is no real device here to match the screenshot
pixel-for-pixel.

## Scope

**In:**

- `Navigation.tsx` becomes a hamburger-triggered menu on every screen size:
  FAQ / About / Highscore / Rules-and-help submenu, theme toggle, sign
  in/out and username — same links as today, new presentation.
- A "Game" section inside that same menu, shown only on a game page: Withdraw
  (any player) and Delete game (creator or admin), moved out of `GameView`'s
  action row. This needs the menu component to receive the handful of
  game-scoped props/handlers `GameView` currently wires to its own Withdraw/
  Delete buttons.
- Remove the "Back to games" button from `GameView` (and from `Navigation`'s
  admin-screen case, which has the same button — the brand link already goes
  home from anywhere).
- `GameView`'s h1: whose-turn/which-phase text becomes the primary heading;
  the game name moves to a small subtitle/tag right beside or under it.
- `styles.css`: add height/orientation-aware variants of the mobile
  breakpoints (`.app` padding, topbar/nav compacting, `.board-layout`
  stacking, `.board-scroll` max-height) so a short-but-wide landscape phone
  gets the same compact treatment as a narrow phone. Audit `.app`/board
  containers for anything stopping them from using the full viewport width
  in that case.

**Out:**

- The civilization tag, colour swatch, and "Auto-refresh" toggle in
  `GameView`'s header row — left exactly as they are (human's explicit
  choice: minimal-risk option over rewriting the whole status row).
- Any change to `BoardView.tsx`'s own toolbar (the "Civilization Boardgame" /
  Zoom / Undo / Redo row) beyond what the new breakpoints do to it.
- Pixel-matching the human's own landscape screenshot exactly — no real
  device is available this session; a sound fix verified in an emulated
  landscape viewport is the bar.
- Any engine or server change. Both issues are presentational only.

## Reference

New UI, not a rules port, so the *old-civ-rest* Java backend has nothing to
say here. `old-civ-web/app/views/nav.html` is a direct precedent for the
menu shape, though: its single top navbar already had a contextual "Game
options" dropdown (`ng-if="navCtrl.GameOption.value.show"`) with "Withdraw
from game", and a separate "Admin settings" dropdown with "Delete game" —
both inside the same navbar as FAQ/About/Highscore, gated on being in a game
and on being an admin respectively. That is the shape this brief's "Game"
section follows, collapsed into the one hamburger menu instead of old
Bootstrap's two separate dropdowns.

## Approach

- `Navigation.tsx`: replace the `<nav>`/`<div className="topbar-actions">`
  pair with a single `<button>` (hamburger icon, `aria-expanded`,
  `aria-controls`) that toggles a menu panel — reuse the existing
  `<details>`/`navigation-dropdown` pattern already used for "Rules and
  help" (same fixed-panel-on-mobile CSS in `styles.css`'s `max-width: 600px`
  block) rather than inventing a new disclosure mechanism, and extend that
  same panel to render on every width, not just under 600px. Add an optional
  `game` prop: `{ onWithdraw, onDelete, canDelete, withdrawDisabled,
  deleteDisabled } | null`, rendered as an extra menu section only when
  non-null.
- `GameView.tsx`: stop rendering its own Withdraw/Delete buttons and the
  "Back to games" button; instead pass the equivalent handlers/guards up to
  wherever `Navigation` is rendered (check `App.tsx` for how `screen`/props
  already flow to `Navigation`, since the confirm dialogs
  (`window.confirm('Withdraw...')` / `'Delete this game permanently?'`) need
  to move with the actions). Replace the h1: keep the existing
  `TURN_PHASE_LABEL`/`activeTurn` logic that already computes the
  "Your turn — X phase" / "<name>'s turn — X phase" text (it is currently a
  `<span>` next to the h1), promote it to the h1, and move the game name
  (`displayedView.name`) to a small subtitle element next to or under it.
- `styles.css`: keep the existing `max-width` breakpoints as they are (they
  are also asserted byte-for-byte by `SiteMobileStyles.test.ts` per the
  file's own docblock — check that test before touching anything inside
  those blocks) and add new rules alongside them, for example
  `@media (max-height: 500px) and (orientation: landscape)`, mirroring the
  parts of the `max-width: 600px`/`700px`/`900px` blocks that matter for a
  short viewport (topbar/nav compacting, `.board-layout` column stacking,
  a tighter `.board-scroll` max-height, `.app` full width/padding). Check
  `.app`, `.topbar`, `.board-scroll`, `.board-panel` computed widths in a
  landscape emulation to confirm nothing is narrower than the viewport.

## Claimed paths

- `packages/web/src/views/Navigation.tsx`
- `packages/web/src/views/Navigation.test.tsx`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/GameView.test.tsx` (create if it does not exist —
  check first)
- `packages/web/src/App.tsx` (only if prop-threading `Navigation`'s new
  `game` section needs it)
- `packages/web/src/styles.css`

## Acceptance criteria

- [x] A hamburger icon opens/closes the site menu (FAQ/About/Highscore/Rules
      and help, theme, sign in/out) on mobile, tablet and desktop widths.
- [x] On a game page, the same menu has a Game section with Withdraw (any
      player) and Delete game (creator/admin only), each still asking for
      confirmation before acting, matching today's behaviour. Also covers
      an admin viewing a game they never joined (Delete only, no Withdraw)
      — a real regression caught in review round 1, now unit-tested.
- [x] "Back to games" no longer appears in the top navigation, on either the
      game or the admin screen (the issue's red button). `AdminView.tsx`'s
      own internal "Back to games" link — a different button, in the admin
      page's own content rather than the site nav, not touched by this
      brief's claimed paths — is unrelated and stays.
- [x] The game page's h1 shows whose turn / which phase it is; the game name
      is still visible, demoted to a subtitle.
- [x] The civilization tag, colour swatch and Auto-refresh toggle are
      unchanged.
- [x] `SiteMobileStyles.test.ts` still passes unedited (its two blocks are
      untouched) or is deliberately updated with a stated reason.
- [x] A landscape phone viewport (e.g. 812x375) gets the compact/mobile
      layout: `.app` and the board use the full viewport width, and the
      board panel does not visually overrun the rest of the page. Verified
      by measurement, not just visually: `document.documentElement
      .scrollWidth` went from 426 (overflowing) to 797, matching
      `clientWidth`.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [x] Hidden information: none — presentational only, no projection change.
- [x] Verified in the browser: mobile portrait (375x812), mobile landscape
      (812x375), tablet (800px), and desktop (1280x720), signed in and on a
      real game page. Dark theme only was actually opened; light theme was
      not separately checked — the new CSS uses only existing theme
      variables (`--line`, `--muted`, `--text`, `--panel`), so it should
      follow the theme automatically, but that is inference, not a look.

## Open questions

None outstanding — five were asked and answered by the human before this
brief was written (menu scope, game-name visibility, clutter-reduction
scope, landscape-verification bar, and Withdraw/Delete placement). See the
chat for the exact wording if a future reviewer needs it.
