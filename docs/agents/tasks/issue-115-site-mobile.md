# Mobile site shell, authentication and lobby workflows

- **Slug:** `issue-115-site-mobile`
- **Branch:** `feat/issue-115-site-mobile`
- **Owner:** Codex
- **Status:** in progress

## Goal

On a phone or tablet, the site shell, sign-in/account forms and lobby can be
used without accidental horizontal page scrolling or controls that are too
small to activate. Navigation, theme/sign-out actions, login/register/forgot
password, game search/filter/tabs/pagination, game creation/joining and lobby
chat remain usable in portrait and landscape while desktop behaviour stays the
same.

## Why

Issue #115 covers the whole site, not just the board and battle arena. The
board and arena interaction slices are now merged; this is the first remaining
route/form slice before the broader game-panel audit.

## Scope

**In:**

- Responsive navigation and top-level action layout at phone and tablet widths.
- Touch-sized controls and reflow for login/account forms, game filters,
  creation controls, tabs, pagination and lobby chat.
- Bounded table scrolling so game/highscore tables do not create document-wide
  horizontal overflow.
- Component/layout regression tests for the mobile-specific structure.

**Out:**

- Board, battle/arena gesture code (merged in PRs #127 and #130).
- Game-panel internals, turn orders, status tables, dialogs and admin pages;
  those belong to later issue #115 slices.
- React Native or a new drag-and-drop dependency.

## Reference

The existing React DOM implementation is the current product reference for
these routes. The old AngularJS equivalents are `old-civ-web/app/index.html`,
`old-civ-web/app/views/login.html` and `old-civ-web/app/views/list.html`.
No game rules or server contract changes are needed.

## Approach

Use CSS flex/grid reflow and bounded overflow, preserving the existing React
state and semantic controls. Add a compact mobile navigation disclosure while
keeping the desktop links visible. Keep form drafts in component state across
resize; do not remount based on orientation. Add tests for accessible controls,
mobile class hooks and table/chat containment.

## Claimed paths

- `packages/web/src/views/Navigation.tsx`
- `packages/web/src/views/LoginView.tsx`
- `packages/web/src/views/LandingView.tsx`
- `packages/web/src/views/GameList.tsx`
- `packages/web/src/views/LobbyChat.tsx`
- `packages/web/src/views/HighscoreView.tsx`
- `packages/web/src/styles.css`
- `packages/web/src/views/Navigation.test.tsx`
- `packages/web/src/views/LoginView.test.tsx`
- `packages/web/src/views/GameList.test.tsx`
- `packages/web/src/views/LobbyChat.test.tsx`
- `packages/web/src/views/HighscoreView.test.tsx`
- `docs/agents/tasks/issue-115-site-mobile.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`

## Acceptance criteria

- [ ] Navigation and account actions reflow without document overflow at 320px
  and 390px widths; all controls remain keyboard and touch reachable.
- [ ] Login, registration and forgot-password forms remain usable with the
  software keyboard and preserve entered values during resize/orientation.
- [ ] Game list filters, tabs, action buttons, pagination, game creation and
  lobby chat fit phone widths; wide tables scroll inside a bounded region.
- [ ] Desktop layout and existing semantics remain unchanged.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser at phone and tablet viewport sizes; real-device
  testing remains explicitly reported if unavailable.

## Open questions

None for this slice. The existing React DOM architecture remains the chosen
direction per issue #115.
