# Issue #20 — Choose between dark and light themes

- **Slug:** `issue-20-theme-switch`
- **Branch:** `feat/issue-20-theme-switch`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Users can switch the web app between the existing dark theme and a readable
white/light theme from the application header. The choice remains in effect
when the page is refreshed, while dark remains the default for existing users.

## Why

Issue #20 asks: “Now we have a dark theme, I want option to choose a white
theme also.” A light option improves readability for users who prefer a white
interface without changing the existing default.

## Scope

**In:**

- Add a light theme palette alongside the existing dark CSS variables.
- Add a theme toggle in the shared application header, including public pages.
- Persist the selected theme in browser local storage and apply it before the
  app renders.
- Add focused tests where the current web test setup can support them, plus
  browser verification of both themes and refresh persistence.

**Out:**

- Per-game or per-component theme choices; the issue asks for an application
  theme.
- Server-side storage or account synchronization; local browser preference is
  sufficient for this UI-only request.
- Reworking game artwork, board assets or card images beyond ensuring the
  surrounding interface remains readable.

## Reference

The current theme is defined by CSS variables in `packages/web/src/styles.css`
and the shared header is rendered by `packages/web/src/App.tsx`. There is no
theme selector in the old client or current rewrite, so this is a new UI
feature rather than a business-rule port.

## Approach

Define dark and light variable sets using a root data attribute, load a saved
preference from `localStorage` with dark as the fallback, and render one toggle
button in the shared header. Keep the theme state in `App` so every screen uses
the same preference.

## Claimed paths

- `packages/web/src/App.tsx`
- `packages/web/src/theme.ts`
- `packages/web/src/styles.css`
- `packages/web/src/main.tsx`
- `packages/web/index.html`
- `docs/agents/tasks/issue-20-theme-switch.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] Dark remains the default when no preference is stored.
- [ ] A user can switch to a readable white/light theme from the header.
- [ ] The selected theme applies across lobby, highscore, admin and game views.
- [ ] Refreshing the page preserves the selected theme.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Browser verification: both themes are visibly applied and the choice
  survives a refresh.

## Open questions

None. The issue explicitly requests a white alternative; dark remains the
backward-compatible default.
