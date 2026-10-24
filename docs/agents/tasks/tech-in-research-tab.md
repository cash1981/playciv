# Tech in the Research tab

- **Slug:** `tech-in-research-tab`
- **Branch:** `feat/tech-in-research-tab`
- **Owner:** opencode (as orchestrator/coder)
- **Status:** ready for review

## Goal

The whole Tech panel (the tech pyramid, the available-tech picker and the
hidden-tech controls) sits inside the Research tab of "Your actions", below the
cards that can be played in Research. It is no longer a separate panel lower on
the game page.

## Why

The human asked: "Kan du flytte hele innholdet i tech inni research fanen under
actions. Legg det under eventuelt andre kort som går an å spilles under research
fasen." Research is where a tech is learned, so the tech contents belong with
that phase's actions.

## Scope

**In:**

- `packages/web/src/views/PhaseTabs.tsx` and CSS if spacing needs it: render the
  existing `TechPanel` in the Research tab after `PlayableCardList`.
- `packages/web/src/views/GameView.tsx`: stop rendering a second Tech panel for
  a viewer who has the actions panel; keep it for a viewer without one
  (spectator or no actions) so public tech pyramids do not disappear.
- `packages/web/src/views/PhaseSummary.tsx`: the Tech tree shortcut and
  tech-backed action links select the Research tab before scrolling to the
  Tech panel.
- Web tests for the moved content, the panel order and the shortcut.
- `docs/agents/decisions.md`, `docs/agents/state.md`, this brief.

**Out:**

- Engine rules and projections.
- Changing what the Tech panel itself does.
- Removing access to opponents' public pyramids.

## Reference

Current decisions: "Phase tabs and Start of Turn (part 13)" and "Action panel
focus", plus the page-shortcut paragraph before them. Current code:
`PhaseTabs.tsx`, `TechPanel.tsx`, `GameView.tsx`, `PhaseSummary.tsx`.

## Approach

- Pass `reloadCount` and `historical` down from `GameView` to
  `PhaseActionsPanel`; render `TechPanel` in the `RESEARCH` branch of
  `PhaseBody`.
- Keep the standalone `TechPanel` in the page only when `hasActionsPanel` is
  false, so a spectator still sees the public tech pyramids and an ended/no-action
  player does too.
- In `goToPanel`, when `key === 'techs'` and the Research tab exists but is not
  selected, click that tab and scroll to the Tech panel after the tab has
  mounted. The DOM click reuses the tabs' own selection logic; no duplicated
  phase state.
- The Tech panel stays a `CollapsiblePanel`, so its saved open state and focus
  behaviour are unchanged.

## Claimed paths

- `packages/web/src/views/PhaseTabs.tsx`, `PhaseTabs.css`
- `packages/web/src/views/GameView.tsx`
- `packages/web/src/views/PhaseSummary.tsx`
- `packages/web/src/views/TechPanel.tsx` (only if a wrapper prop is needed)
- `packages/web/src/views/PhaseTabs.test.tsx`, `GameView.test.tsx`,
  `PhaseSummary.test.tsx`
- `docs/agents/decisions.md`, `state.md`, this brief

## Acceptance criteria

- [ ] The Research tab lists the Tech panel content below the playable cards.
- [ ] A player with the actions panel has exactly one Tech panel on the page.
- [ ] A spectator and a viewer without the actions panel still get one Tech panel.
- [ ] The Tech tree shortcut and tech-backed action links bring the Research tab
      into view and land on the Tech panel.
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: no test data or projection changes; the Tech panel's
      existing hidden-tech behaviour is untouched.
- [ ] Verified in the browser: the Research tab and the Tech tree shortcut.

## Handover

Validation: `pnpm -r typecheck && pnpm -r test && pnpm -r build` all passed
(engine 2005, server 843 and web 1073 tests). The web tests cover the Research
tab order, the tab selection from a tech link, the free-tech grant, and the
spectator fallback. Browser check not performed: no dev server was running in
this worktree. After merge, keep the durable rationale in `decisions.md` and
retire this brief in a later change.
