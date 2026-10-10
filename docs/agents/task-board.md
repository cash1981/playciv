# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

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
  - `packages/engine/src/assisted.ts`, `state.ts`, `errors.ts`, `index.ts`, `actions/turn.ts`
  - `packages/engine/test/assisted*.test.ts`
  - `packages/server/src/routes/play.ts`, `packages/server/test/assisted*.test.ts`
  - `packages/web/src/views/AssistedActions.tsx`, `TechPanel.tsx`, `GameView.tsx`, `PhaseSummary.tsx`, `BoardView.tsx`, `styles.css`, `FaqView.tsx` and tests
  - `docs/agents/decisions.md`, `state.md`, `README.md`
- **Notes:** parts 1 to 5 are on this branch (contract and cards, culture advance, Great Person markers, phase summary and layout, city production). The claim stays until PR #271 is merged; the sub-branch claims were released when they were merged here.

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
