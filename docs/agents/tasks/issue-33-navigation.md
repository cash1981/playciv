# Issue #33 — Navigation menu with rulebook and help links

- **Slug:** `issue-33-navigation`
- **Branch:** `feat/issue-33-navigation`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Players can open a consistent navigation menu from the application shell and
reach the rulebooks, reference images, FAQ, About page and highscore.

## Why

The old app exposed these resources from `old-civ-web/app/views/nav.html`; the
rewrite currently only has a minimal top bar.

## Scope

**In:**

- Add a navigation menu to the shared application shell.
- Link the six rule/reference resources named in issue #33.
- Link FAQ, About and Highscore routes/pages.

**Out:**

- Writing or rewriting rulebook content.
- Implementing the FAQ or About pages themselves; those are issues #34 and #35.

## Reference

The old client is `old-civ-web/app/views/nav.html`. Preserve the existing
application routes and use the current public assets or explicit external URLs
for documents that are not in the repository.

## Approach

Add a reusable navigation component or section in the shared app shell, with
responsive/accessibile links for signed-in and signed-out users. Keep the
menu links read-only and make external documents open safely in a new tab.

## Claimed paths

- `packages/web/src/App.tsx`
- `packages/web/src/views/Navigation.tsx`
- `packages/web/src/styles.css`
- `packages/web/public/`
- `docs/agents/tasks/issue-33-navigation.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] The navigation is visible and usable on public and authenticated pages.
- [ ] All rule/reference links from issue #33 are present and have meaningful labels.
- [ ] FAQ, About and Highscore are reachable from the menu.
- [ ] Existing login, game and admin navigation still works.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser at desktop and narrow viewport widths.

## Open questions

- [ ] Confirm the final URLs/assets for the rulebook PDFs and tech overview images.
