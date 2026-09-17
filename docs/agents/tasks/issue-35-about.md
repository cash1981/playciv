# Issue #35 — About page

- **Slug:** `issue-35-about`
- **Branch:** `feat/issue-35-about`
- **Owner:** Codex (GPT-5)
- **Status:** in progress

## Goal

Visitors can open an About page explaining the project, its Apache 2.0
license, the Fantasy Flight Games trademark disclaimer, repository links and
the project contact address.

## Why

The old client had `old-civ-web/app/views/about.html`; the rewrite has no About
page.

## Scope

**In:**

- Add the About route and page.
- Include the legal notices, repository links and contact information from the
  old page/reference project.

**Out:**

- Authentication or account settings.
- Navigation-menu implementation beyond adding the page route/link target.

## Reference

`old-civ-web/app/views/about.html` and the repository's `README.md` provide the
existing project/legal wording. Do not invent contact details; preserve the
known project contact or ask if the source is ambiguous.

## Approach

Add a small static React view and route it through the current app shell. Keep
all links ordinary, keyboard accessible and safe for external navigation.

## Claimed paths

- `packages/web/src/App.tsx`
- `packages/web/src/views/AboutView.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/issue-35-about.md`
- `docs/agents/task-board.md`

## Acceptance criteria

- [ ] `/about` renders for signed-out and signed-in visitors.
- [ ] License, trademark disclaimer, repository links and contact are present.
- [ ] Existing game and authentication routes continue to work.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Verified in the browser, including external-link behavior.

## Open questions

None if the old About page contains the final contact details; otherwise stop
and ask before inventing them.
