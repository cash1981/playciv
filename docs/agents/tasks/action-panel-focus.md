# Action panel focus

- **Slug:** `action-panel-focus`
- **Branch:** `feat/action-panel-focus` (from `feat/assisted-play-contract`)
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** in review

## Goal

Show only what is actionable in "Your actions". A disabled or used button keeps its
button, but its sentence moves into a `?` help dialog and the button's title. Actions
that cannot be pressed yet (no resource, wrong phase, not owned, otherwise unavailable)
are left out; an action that was used this turn stays visible and disabled until the
next turn, when the engine decides again.

The "Cards you can play" list drops the card descriptions. A card's name links to the
same card in your hand. Actions that belong to a tech card link their name to the tech
panel instead (resource abilities included).

"Found a city here" scrolls to the map after it succeeds.

"Invest a coin" appears only while a coin can be invested or after the investment was
used this turn. Its guide text and the four investment-card texts move behind `?`, next
to the investment-card picker.

## Scope

In: `AssistedActions.tsx`, `PlayableCards.tsx`, `SotPanel.tsx`, their CSS and tests,
`PhaseSummary.tsx` (panel/item navigation), `GameView.tsx` (`HandItem` anchor),
`ItemCard.tsx` (optional DOM id), engine `AvailableAction.techName` (projection only),
`state.ts`/`assisted.ts` projection tests, `docs/agents/decisions.md`.

Out: engine rules, action payloads, the phase guide above the tabs, government and
scouting rules, card effects.

## Acceptance criteria

- [x] Ready, used, and warning state still come from the engine; no rule is re-derived
      in the browser.
- [x] Disabled or used buttons in the action panel and the status table have the reason
      in `title` and in a `?` dialog, not as inline text. The tech detail dialog keeps it
      inline, because that dialog already is the card reference. Used cards keep the
      existing confirm-before-repeat behavior.
- [x] Inactive actions are not listed; used actions stay visible with the Used tag and keep
      the existing confirm-before-repeat behavior.
- [x] Playable card names link to the matching card in the hand; descriptions are gone.
- [x] Tech-backed action names link to the tech panel.
- [x] Found a city goes to the map after a successful press.
- [x] Invest is hidden without a coin, compact when used, and its card reference is a
      `?` dialog opened next to the card picker.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build`
- [x] Hidden-information tests still pass (no hand data added to another player's view).
