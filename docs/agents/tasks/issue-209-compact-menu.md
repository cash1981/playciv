# Compact mobile menu with Rules and Actions submenus (#209)

- **Slug:** `issue-209-compact-menu`
- **Branch:** `feat/issue-209-compact-menu`
- **Owner:** Claude (orchestrator), coder agent for the code
- **Status:** in progress

## Goal

The site menu is small, easy to use with a thumb, and never traps the user,
on a phone first and then on desktop.

## Why

Issue #209, "Menu looks bad on mobile": "The icons are big, no close button".
Then, in chat, the human looked at a mockup and asked for: smaller menu items;
the rules grouped in a submenu called **Rules**; the game actions in their own
submenu called **Actions**. A later screenshot of the live site showed two
bugs the redesign must fix: opening "Rules and help" lays the link list over
the whole page with the words "Rules and help" floating in the middle of it,
and when the open menu is scrolled the hamburger disappears, so there is no
way to close it. The human: "Rules and help står fortsatt der og når man
scroller så forsvinner hamburger menyen. Den bør være med."

The approved mockup is described under Approach.

## Scope

**In:**

- Mobile (max-width 600px): opening the menu shows a full-screen sheet. Its
  header row is always visible while the list scrolls (sticky, or the list
  scrolls inside the sheet under a fixed header) and holds the brand or the
  word "Menu" and a **close (X) button**. Escape and choosing an item close
  it too.
- Rows are plain full-width rows about 44px high (touch minimum), 15px text,
  hairline separators, no pill borders, left aligned. Order: FAQ, About,
  Highscore, Great persons, **Rules** (submenu), **Actions** (submenu, only
  while a game page is showing), then a footer row with the theme toggle,
  Admin (admin only), the username and Sign out, all small.
- **Rules** replaces "Rules and help". It folds out inline (accordion), never
  as an overlay. Inside, three labelled groups, rows about 40px, each opening
  in a new tab, each with an external-link icon:
  - Rulebooks: Base game, Fame and Fortune, Wisdom and Warfare
  - Help: Official FAQ 2.0, Unofficial rules summary
  - Charts (F&F / W&W): Overview, Tech overview
  Same hrefs as today's `helpLinks`; only the labels and grouping change.
- **Actions** replaces the "Game" group. Same three actions and same
  visibility rules as today (Withdraw for players, End game and Delete game
  for creator/admin, End game hidden once the game has ended), same confirm
  dialogs, red text. Nothing new to decide about behaviour.
- Desktop (above 600px): keep the dropdown from the hamburger, but with the
  same compact rows and the same two inline submenus (no nested overlay).
  Add a close affordance there too, since it costs nothing (X in the header,
  Escape, click outside if that is already how it behaves).
- Only one submenu open at a time is fine and simpler; not required.

**Out:**

- Changing what any menu action does, the End game dialog, the Great persons
  dialog, routes, or the top bar outside the menu.
- New menu items.
- A light-theme redesign: use the existing CSS variables and check both themes.

## Reference

New UI, no game rule involved, so no old-system reference and no rules-checker.
`nav.html` in old-civ-web had "Game options" and "Admin settings" dropdowns;
the human chose a different structure (Rules and Actions submenus), so that is
a deliberate deviation from the old layout, to be noted in decisions.md.

## Approach

- `packages/web/src/views/Navigation.tsx`: restructure the markup. Use
  `<details>`/`<summary>` for Rules and Actions if that keeps it accessible
  and simple, or buttons with `aria-expanded`; either way keyboard operable.
  The main menu's open state must be controllable so the X and Escape can
  close it and focus returns to the hamburger (there is already focus return
  logic for the dialogs; reuse the pattern). Keep `closeMenuAfterAction`
  semantics: choosing a link or action closes the menu, toggling a submenu
  does not.
- CSS: the current menu rules are spread over several media blocks and
  patched with overrides (see `.navigation-menu`, `.navigation-dropdown`,
  `.main-dropdown`, `.site-navigation`, `.navigation-game-actions` and the
  `max-width: 600px` and `900px` blocks). Replace the menu's rules with one
  clear block, ideally in a new `Navigation.css` imported by
  `Navigation.tsx` (the repo already does this with `BattleMobile.css`), and
  delete the old menu rules that it makes dead. Do not break the other users
  of shared selectors: grep before deleting (`.navigation-menu` may be used by
  the admin or landing views).
- Tests in `Navigation.test.tsx`: Rules and Actions submenus, groups and
  labels, close button and Escape close the menu, choosing an item closes it,
  toggling a submenu does not, Actions absent outside a game, rows visible per
  role exactly as before.

## Claimed paths

- `packages/web/src/views/Navigation.tsx`, `Navigation.test.tsx`
- `packages/web/src/views/Navigation.css` (new) and `packages/web/src/styles.css` (menu rules only)
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] At 375px: menu rows are about 44px, no horizontal scroll, the close X is
      visible at the top of the sheet at every scroll position.
- [ ] Rules folds out inline, three groups, nothing floats over other content,
      no text "Rules and help" anywhere.
- [ ] Actions submenu holds Withdraw / End game / Delete game with today's
      visibility rules; absent when no game page is showing.
- [ ] Escape and the X close the menu; focus returns to the hamburger.
- [ ] Works in dark and light theme, and at desktop width.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` pass
- [ ] Hidden information: none involved.
- [ ] Verified in the browser at 375px and desktop width.

## Open questions

None outstanding.
