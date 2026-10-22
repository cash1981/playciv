# Your cities in "Your actions"

- **Slug:** `cities-in-actions`
- **Branch:** `feat/cities-in-actions`, branched from `feat/assisted-play-contract`
- **Owner:** Claude (Sonnet 5.5)
- **Status:** in review

The human could not find the city controls in the collapsed "Cities" panel far
down the page and asked for everything to live in "Your actions". Web only; the
engine and the server are unchanged.

## What changes

1. **Your actions gets a section "Your cities"** (an `h3`, like the card choice
   above it). It holds the Upgrades block (`CityActions`, now an `h4`) and the
   viewer's own city cards, exactly as the Cities panel showed them: the label,
   the production figure with its "Not a complete count" link and popup, the
   Building Program line, Build with its inline picker, Start Building Program,
   and the form to set production by hand. The Build flow (`useBuildFlow`,
   `BuildBar`, board pick mode) is unchanged; `AssistedActionsPanel` takes the
   same `build` prop `CitiesPanel` had.
2. **The panel renders when the viewer has cities** even with no assisted action
   and no waiting choice. It still renders nothing for a spectator. One
   predicate, `hasActionsPanel(view)`, decides it for the panel and for the
   shortcut.
3. **Order inside the panel:** the action list, then a waiting card choice, then
   "Your cities". The choice stays above the long city list, so it is not pushed
   off the screen, and the panel title still says how many choices are waiting.
4. **No city on the map:** the section says "No cities of yours on the map yet."
   only when the panel is shown for another reason. The panel is not rendered
   just for that line.
5. **The Cities panel keeps the other players' cities,** read only. For a player
   it is titled "Opponents' cities (N)" and is not rendered when no opponent has a
   city on the map. For a spectator it is "Cities (N)" with every city, and keeps
   "No cities on the map." when there is none. N counts the cities listed. It no
   longer takes `busy`, `readOnly`, `run` or `build`.
6. **Shortcuts:** `Cities` is replaced by `Actions` (key `actions`). A player sees
   Board, Actions, Your cards, Tech tree; a spectator sees Board, Your cards, Tech
   tree. `PageShortcuts` gets an `actions` prop, true when the panel is rendered.
7. **Scrolling:** choosing a square mode still scrolls the board into view (the
   board sits right below the panel). "Back to the picker" now opens the Your
   actions panel, not the Cities panel, when it was collapsed. `goToPanel('actions')`
   for the card choice button is untouched.

## Files

- `AssistedActions.tsx`, `.css`: the section, `hasActionsPanel`, the `build` prop.
- `CityCard.tsx` (new), `CityCard.css` (renamed from `CitiesPanel.css`): the card
  and its parts, one component for own and opponent cities.
- `YourCities.tsx` (new): the section. `CitiesPanel.tsx`: the other players' cities.
- `CityActions.tsx`, `BuildPicker.tsx`, `buildFlow.ts`, `BoardView.tsx`: heading
  level, `goBackToPicker`, comments.
- `GameView.tsx`, `PhaseSummary.tsx`, `FaqView.tsx`, `README.md`, `decisions.md`,
  `state.md`, and the tests of all of the above.

## Constraints kept

- No duplicate DOM ids: the own cards are in one place only, the Cities panel
  lists nobody's own cities, and the by-hand input id stays `city-production-<piece>`.
- Accessible names are unchanged: `Build in <city>`, `Start Building Program in
  <city>`, `Not a complete count: <city>`.
- A test proves the Cities panel no longer lists the viewer's own cities, and one
  proves a player with cities and no assisted action sees Build in Your actions.

## Open questions for the human

- The section sits below the action list and a waiting choice. Putting "Your
  cities" first would push a waiting choice off the screen on a phone.
- The note "Cities that are not on the map are not listed." stays in the
  Opponents' cities panel only; Your cities does not repeat it.
- A viewer who collapsed Your actions earlier keeps it collapsed (the open state
  is remembered per browser), so the city controls hide with it until they open it.
  The "Actions" shortcut lands on the heading but does not open it.

## Handover

Done: all seven changes above, with tests and the decisions entry. The claim on
`task-board.md` is released. Not done: a check in a real browser (only jsdom
tests and the build), and the read-only review round, which is the
orchestrator's step.
