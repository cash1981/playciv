# Atlas redesign — a modern site look

- **Slug:** `atlas-redesign`
- **Branch:** `feat/atlas-redesign`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

The site gets a new visual identity — "Atlas" — without changing a single
behaviour. Every screen (lobby, game list, game page, board, battle, techs,
turn orders, admin, FAQ, about, highscore, login) keeps its markup, its
components and its data flow; only the stylesheet, the fonts and one purely
decorative backdrop layer change. Dark and light themes both get a deliberate
palette rather than a mechanical inversion, and the illustrated backdrop reads
well in both.

The player-facing change is: the app stops looking like a plain default form and
starts looking like the board game it is — warm parchment and brass in the light
theme, deep midnight blue with gold in the dark one, a serif display face for
headings, and a painted Civilization board backdrop behind everything.

The human asked for exactly this, in these words: *"Går det an å lage siten litt
mer moderne og sexy? Jeg ønsker et forslag der all funksjonalitet forblir og
fungerer sånn som den er, bare at det kommer et nytt design som er mer
'appealing' og flott å se på. Den skal fortsatt være mørk og lys tema som passer
godt til hvert design. ... Perhaps there should be a background image that is
civilization boardgame inspired."* They then chose the Atlas direction and the
`Boks · motiv` backdrop, and asked that the work be mobile first.

## Why

The current stylesheet says of itself, at the top, *"Deliberately plain. The
artwork comes later"*. The artwork has since arrived — 346 of 347 cards, the
map tiles, the culture track, the leaders, the wonders — but the shell around it
never caught up, so the game is dressed in default-grey form controls. This is
the "artwork comes later" pass.

It unblocks nothing technical; it is a presentation change the owner asked for.

## Scope

**In:**

- `packages/web/src/styles.css`: the `:root` and `:root[data-theme='light']`
  palettes, type scale, and the visual treatment of every existing selector —
  panels, buttons, tabs, tables, cards, the board, the log, chat, the footer,
  the navigation. No selector is removed.
- `packages/web/src/views/SiteBackdrop.tsx` (new): the decorative backdrop layer
  (painted map + scrim + a cartography line/compass overlay). `aria-hidden`,
  purely presentational, no state, no props.
- `packages/web/src/main.tsx`: renders `SiteBackdrop` once, beside `App`.
- `packages/web/public/theme/backdrop.jpg` (new asset): the illustrated
  backdrop, derived from the image the human supplied.
- `packages/web/public/fonts/` (new assets): self-hosted Marcellus (400) and
  Cinzel (variable 400–900), latin subset, with their OFL licence files.
- `@font-face` declarations, and the font stacks used by the stylesheet.

**Out:**

- **Any behaviour, markup, props or data.** No `.tsx` file other than
  `main.tsx`'s one added element changes. Explicitly out: a burger menu or any
  other change to `Navigation.tsx` — the mobile navigation already landed in PR
  #131 and its touch-sized grid is kept as it is.
- **Rewriting the responsive strategy.** The stylesheet stays desktop-first with
  `max-width` media queries, because PR #131's mobile contract (and
  `SiteMobileStyles.test.ts`) asserts that structure and those exact values.
  Converting the cascade to `min-width` is a separate, larger change; doing it
  here would invalidate just-merged mobile work. This is recorded in
  `decisions.md`.
- **Changing the board's scroll model.** A 16-column board cannot shrink to a
  390 px viewport and stay usable, so the board keeps scrolling inside its own
  region. The mobile-first rule allows an intentional scroll region explicitly.
- **Optimising the existing card art.** Noted in `state.md` as a known problem;
  not this task.

## Reference

There is no old-system reference for the look: `old-civ-web` was Bootstrap 3,
and this is a deliberate departure from it, approved by the human from mockups.
The *functionality* reference is unchanged — no rule, projection or log text is
touched, so `rules-checker` has nothing to check here.

The backdrop is the human's own supplied image, cropped to the lower painted
landscape so that the box's title block and publisher logos are not on screen.
Provenance and the trademark decision are recorded in `decisions.md`.

## Approach

1. **Palette and type first.** Replace the two `:root` blocks with the Atlas
   variables (`--bg`, `--bg-2`, `--panel`, `--panel-2`, `--line`, `--line-soft`,
   `--text`, `--muted`, `--accent`, `--accent-text`, `--shadow`, `--radius`,
   `--pill`, `--map-ink`, `--photo-opacity`, `--card-art-bg`, plus the font
   stacks) and keep every variable the current stylesheet already uses,
   including `--info`/`--success` — those two encode the deliberate Bootstrap
   `btn-info`/`btn-success` colours from the front-page work and must not drift.
2. **Every selector keeps its rule.** Restyle in place: the visual properties
   change, the selector list does not. The two mobile `@media` blocks from PR
   #131 are kept byte-for-byte, including `min-height: 2.75rem`, the
   `@media (max-width: 900px)` touch block and the `@media (max-width: 600px)`
   help-menu block with `max-height: calc(100dvh - 1.5rem)`.
3. **Backdrop.** A `position: fixed`, `aria-hidden` layer behind the app:
   painted map at low opacity, a theme-aware scrim over it, then the cartography
   overlay in `--map-ink`. `.app` gets `position: relative; z-index: 1` so the
   content stays above it.
4. **Fonts.** `@font-face` for the two self-hosted families, `font-display:
   swap`, and stacks that fall back to `ui-serif`/`Georgia` and
   `system-ui`/`Segoe UI`, so nothing depends on the network.
5. **Verify mobile first**, then tablet, then desktop, in both themes, with the
   browser connected.

## Claimed paths

- `packages/web/src/styles.css`
- `packages/web/src/views/SiteBackdrop.tsx` (new)
- `packages/web/src/views/SiteBackdrop.test.tsx` (new)
- `packages/web/src/main.tsx`
- `packages/web/public/theme/` (new assets)
- `packages/web/public/fonts/` (new assets)
- `docs/agents/tasks/atlas-redesign.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] No behaviour changes: `pnpm -r typecheck && pnpm -r test && pnpm -r build`
      pass, with the existing test counts unchanged plus the new backdrop test.
- [ ] `SiteMobileStyles.test.ts` passes **without being edited** — every string
      it asserts is still present verbatim.
- [ ] Every CSS selector that exists on `main` still exists; a reviewer can diff
      the selector sets and find nothing removed.
- [ ] The mobile-first contract still holds: at 390 px and 768 px there is no
      accidental horizontal overflow (only the board's own scroll region), the
      navigation stays a touch-sized grid, and the `2.75rem` touch minimums are
      still in force.
- [ ] Hidden information: untouched. No projection, no log text, no view shape
      changes.
- [ ] Verified in the browser at 390 px, 768 px and desktop, in both themes, and
      what was seen is reported.

## Open questions

None. The direction, the backdrop and the strength were chosen by the human
from mockups; the mobile-first requirement and the rebase onto the merged mobile
work were given explicitly.
