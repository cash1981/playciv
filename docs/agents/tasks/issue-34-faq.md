# Issue #34 — FAQ page

- **Slug:** `issue-34-faq`
- **Branch:** `feat/issue-34-faq`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Visitors can open an FAQ page that explains account/game creation, joining,
turn and draw requirements, and how to use the current virtual board.

## Why

The old client had `old-civ-web/app/views/faq.html`; the rewrite has no FAQ.

## Scope

**In:**

- Add a public `/faq` route and a readable collapsible Q&A page.
- Refresh the old map/asset instructions for the current virtual board.

**Out:**

- Changing game rules or server behavior.
- Reintroducing the obsolete Google Slides/Spreadsheet workflow.

## Reference

Use `old-civ-web/app/views/faq.html` for the questions and answer intent, then
verify wording against the current UI and README.

## Approach

Add a static React view using the existing collapsible-panel pattern and route
it through the current app shell. Keep answers concise and public.

## Claimed paths

- `packages/web/src/App.tsx`
- `packages/web/src/views/FaqView.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/issue-34-faq.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] `/faq` renders for signed-out and signed-in visitors.
- [ ] It covers the old FAQ topics and current virtual-board workflow.
- [ ] Answers do not claim obsolete Google Slides/Spreadsheet steps.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser with keyboard-accessible disclosure controls.

## Open questions

None.
