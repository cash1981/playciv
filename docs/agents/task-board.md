# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### great-person-automation

- **Owner:** opencode (orchestrator/coder)
- **Branch:** `feat/great-person-automation`
- **Brief:** `docs/agents/tasks/great-person-automation.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/engine/src/great-person-effects.ts` (new), `actions/player.ts`, `build-options.ts`, `assisted-cards.ts`, `assisted-culture.ts`, `assisted-abilities.ts`, `card-timing.ts`, `state.ts`, `migrate.ts`, `index.ts`
  - `packages/engine/test/great-person-*.test.ts`, `assisted-*.test.ts`, `build-options*.test.ts`, `player-action.test.ts`, `culture-advance*.test.ts`
  - `packages/server/src/routes/play.ts`, `routes/assisted-args.ts`
  - `packages/web/src/views/PlayableCards.tsx`, `AssistedActions.tsx`, `PhaseTabs.tsx`, `SotPanel.tsx`, `BuildPicker.tsx`, `TechPanel.tsx`, `GameView.tsx` and their tests
  - `packages/web/src/lib/api.ts`
  - `docs/agents/tasks/great-person-automation.md`, `decisions.md`, `state.md`, `task-board.md`
- **Notes:** based on `origin/main` at 530fb718. Review approved round 2; browser checked with a seeded local game. Movement effects (Cook, Ford) are deferred. The older live claims listed above are stale after their merges; check for new commits before editing shared files.


### trade-collection-timing

- **Owner:** opencode (orchestrator/coder)
- **Branch:** `fix/trade-collection-timing`
- **Brief:** `docs/agents/tasks/trade-collection-timing.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/engine/src/turn.ts`, `actions/new-turn.ts`, `actions/turn.ts`, `actions/player.ts`
  - `packages/engine/src/trade-collection.ts`, `trade-estimate.ts`
  - `packages/engine/test/trade-timing.test.ts`, `city-production.test.ts`, `assisted-culture-advance.test.ts`, `culture-advance-fixture.ts`
  - `packages/web/src/views/TradeOffers.tsx`, `TradeOffers.test.tsx`, `PhaseTabs.test.tsx`
  - `docs/agents/tasks/trade-collection-timing.md`, `docs/agents/decisions.md`
- **Notes:** based on `origin/main`. The `assisted-play-contract` and
  `action-panel-focus` claims are stale after their merges; their branches have no
  commits ahead of `origin/main`.

### spectator-readonly

- **Owner:** opencode (orchestrator/coder)
- **Branch:** `fix/spectator-readonly`
- **Brief:** `docs/agents/tasks/spectator-readonly.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/web/src/views/GameView.tsx`, `GameView.test.tsx`
  - `packages/web/src/views/BattlePanel.test.tsx`
  - `packages/web/src/views/SocialPolicyPanel.tsx`, `SocialPolicyPanel.test.tsx`
  - `packages/web/src/views/BoardView.tsx`, `BoardView.test.tsx`
  - `docs/agents/tasks/spectator-readonly.md`, `docs/agents/decisions.md`, `docs/agents/state.md`
- **Notes:** based on `origin/main`. The `assisted-play-contract` and
  `action-panel-focus` claims are stale after their merges; their branches have no
  commits ahead of `origin/main`.

### issue-265-trade-offers

- **Owner:** Codex (GPT-5)
- **Branch:** `feat/issue-265-trade-offers`
- **Brief:** `docs/agents/tasks/issue-265-trade-offers.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/engine/src/state.ts`, `migrate.ts`, `create-game.ts`, `errors.ts`, `log.ts`, `trade-offers.ts`, `index.ts`
  - `packages/engine/test/trade-offers*.test.ts`
  - `packages/engine/test/chat-orders-turns.test.ts`
  - `packages/server/src/routes/games.ts`, `context.ts`, `errors.ts`, `packages/server/test/trade-offers*.test.ts`
  - `packages/server/test/chat-orders.test.ts`
  - `packages/web/src/lib/api.ts`, `packages/web/src/views/ChatOrdersPanel.tsx`, `ChatOrdersPanel.css` and tests
  - `docs/agents/tasks/issue-265-trade-offers.md`, `docs/agents/decisions.md`
  - `AGENTS.md`, `docs/agents/conventions.md`
- **Notes:** Child slice based on `feat/assisted-play-contract`; the parent branch claim is a base dependency, not a concurrent edit. Issue #264 is owned by another agent and is out of scope.

### assisted-play-contract

- **Owner:** Claude (Sonnet 5.5)
- **Branch:** `feat/assisted-play-contract` (one PR, #271, by the human's choice; later parts are committed here)
- **Brief:** `docs/agents/tasks/assisted-play-contract.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/assisted.ts`, `state.ts`, `errors.ts`, `index.ts`, `actions/turn.ts`, `actions/board.ts`, `build-item.ts`, `build-options.ts`, `wonder-data.ts`, `terrain.ts`
  - `packages/engine/test/assisted*.test.ts`, `wonder-data.test.ts`
  - `packages/server/src/routes/play.ts`, `routes/board.ts`, `packages/server/test/assisted*.test.ts`
  - `packages/web/src/views/AssistedActions.tsx`, `AssistedActions.css`, `EndTurn.tsx`, `TechPanel.tsx`, `GameView.tsx`, `PhaseSummary.tsx`, `BoardView.tsx`, `BuildPicker.tsx`, `BuildPicker.css`, `buildFlow.ts`, `CityCard.tsx`, `styles.css`, `FaqView.tsx` and tests (`CitiesPanel.tsx` is removed)
  - `packages/web/src/views/ChatOrdersPanel.css`, its tests in `ChatOrdersPanel.test.tsx`, and the trade offer handlers and a comment in `ChatOrdersPanel.tsx` (composer overflow fix and the fixes for Copilot's review; the trade offers from #274 are already merged here)
  - `docs/agents/decisions.md`, `state.md`, `README.md`, `docs/agents/tasks/end-turn-actions.md`, `docs/agents/tasks/build-polish-wonders.md`, `docs/agents/tasks/assisted-gather.md`
  - Replacing, Great People and City Walls (part 12): `packages/engine/src/board.ts` (`flip` change), `actions/board.ts` (`replaceUnderGreatPerson`), `packages/engine/test/great-person-replace.test.ts`, `packages/server/test/assisted-walls-api.test.ts`
  - Devote to the Arts and Harvest (part 11): `packages/engine/data/tile-icons.json`, `src/tile-icons.ts`, `great-person-data.ts`, `city-gather.ts`, `city-actions.ts`, `limits.ts`, `terrain.ts`, `actions/board.ts`, `packages/web/src/views/CityGather.tsx`, `CityGather.test.tsx`, `hidden-info.test.ts`, `great-person-data.test.ts` and the tests of those
  - Part 13 (`docs/agents/tasks/assisted-sot.md`): `packages/engine/src/assisted-core.ts`, `assisted-sot.ts`, `assisted-abilities.ts`, `assisted-resources.ts`, `assisted-cards.ts`, `assisted-culture.ts`, `assisted-city.ts`, `card-timing.ts`, `city-founding.ts`, `sot.ts`, `city-production.ts`, `city-gather.ts` (scouts sent in Start of Turn only), `migrate.ts`, `actions/player.ts`, `actions/board.ts` (the assisted check of the board Undo only); `packages/server/src/routes/assisted-args.ts`, `routes/games.ts` (the replay blanking of the new view fields only); `packages/web/src/lib/api.ts`, `views/PhaseTabs.tsx`, `PhaseTabs.css`, `SotPanel.tsx`, `SotPanel.css`, `PlayableCards.tsx`, `PlayableCards.css`, `panelForTests.tsx`, `CityActions.tsx` (the phase tabs replace the panel body of `AssistedActions.tsx`; `YourCities.tsx` moves into the City Management tab)
  - Polish (`docs/agents/tasks/assisted-polish.md`): `packages/web/src/lib/toasts.ts`, `confirmation.ts`, `views/ToastRegion.tsx`, and their tests
- **Notes:** parts 1 to 13 are on this branch (contract and cards, culture advance, Great Person markers, phase summary and layout, city production, Build for buildings, figures and units, Start Building Program and Upgrade buildings, End turn in Your actions, build polish and wonders, Devote to the Arts and Harvest, replacing, Great People and City Walls, and the phase tabs with Start of Turn). The claim stays until PR #271 is merged; the sub-branch claims were released when they were merged here. The polish slice disables used social policies and wonders instead of confirming a repeat, keeps the success toast for 7 seconds and removes the viewer's username from its text; review approved it on 2026-10-24, with the accepted nits recorded in `assisted-polish.md`.

### action-panel-focus

- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Branch:** `feat/action-panel-focus` (from `feat/assisted-play-contract`)
- **Brief:** `docs/agents/tasks/action-panel-focus.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/engine/src/state.ts` (`AvailableAction.techName` only), `assisted.ts` (`availableActionsFor` only), `packages/engine/test/assisted.test.ts`
  - `packages/web/src/views/AssistedActions.tsx`, `AssistedActions.css`, `PlayableCards.tsx`, `PlayableCards.css`, `SotPanel.tsx`, `SotPanel.css`, `PhaseSummary.tsx`, `GameView.tsx` (`HandItem` anchor only), `ItemCard.tsx` (optional DOM id only), `HelpHint.tsx` and their tests
  - `docs/agents/tasks/action-panel-focus.md`, `docs/agents/decisions.md`
- **Notes:** Child slice based on `feat/assisted-play-contract`; the parent branch claim is a base dependency, not a concurrent edit.

### aircraft-unlocked

- **Owner:** Claude
- **Branch:** `feat/aircraft-unlocked`
- **Brief:** `docs/agents/tasks/aircraft-unlocked.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/engine/src/state.ts` (`PlayerStats` only), `migrate.ts`, `errors.ts`, `actions/player.ts`
  - `packages/server/src/routes/play.ts`, `packages/server/test/api.test.ts`
  - `packages/web/src/lib/api.ts`, `packages/web/src/views/StatusPanel.tsx`, `styles.css`
  - related tests, `docs/agents/decisions.md`
- **Notes:** adds an Aircraft-unlocked checkbox to Player status

### issue-302-figure-movement

- **Owner:** opencode (orchestrator/coder)
- **Branch:** `feat/issue-302-figure-movement`
- **Brief:** `docs/agents/tasks/issue-302-figure-movement.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/movement.ts` (new), `board.ts`, `actions/board.ts`, `errors.ts`, `index.ts`, `state.ts`, `assisted-cards.ts`, `card-timing.ts`
  - `packages/engine/test/movement.test.ts` (new), `board-history.test.ts`, `assisted-cards.test.ts`, `assisted-play-card.test.ts`
  - `packages/server/src/routes/board.ts`, `errors.ts`, `packages/server/test/board-api.test.ts`
  - `packages/web/src/lib/api.ts`, `packages/web/src/views/BoardView.tsx`, `BoardView.test.tsx`, `GameView.tsx`, `styles.css`
  - `docs/agents/tasks/issue-302-figure-movement.md`, `decisions.md`, `state.md`, `task-board.md`
- **Notes:** based on `origin/main` at `14dfd9a`. First slice: enforced map movement, highlight, undo/lock and the passive speed cards. The live `spectator-readonly`, `trade-collection-timing`, `assisted-play-contract` and `action-panel-focus` claims list the same web files but their branches have no commits ahead of `origin/main`; the overlapping paths are treated as stale after their merges.

---

## Format

Copy this block, fill it in, put it under "Live claims".

```markdown
### <slug>

- **Owner:** <agent or person> (<model>)
- **Branch:** `feat/<slug>`
- **Brief:** `docs/agents/tasks/<slug>.md`
- **Status:** claimed
- **Claimed paths:**
  - `packages/engine/src/...`
  - `packages/web/src/views/...`
- **Notes:** anything another agent needs to know to stay out of the way
```

---

## Shared resources

These are rewritten wholesale rather than edited, so only one task may own each
at a time. Claim them by name.

| Resource | Owned by |
| --- | --- |
| `packages/engine/data/board-assets.json` and `packages/web/public/board/` | free |
| `packages/web/public/items/` | free |
| `packages/engine/data/gamedata-faf-waw.json` | free |
| `packages/engine/src/state.ts` (`PlayerView` shape) | free |
| `packages/web/src/lib/api.ts` | free |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._
