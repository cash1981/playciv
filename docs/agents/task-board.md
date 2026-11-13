# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### unit-tech-abilities

- **Owner:** orchestrator (Sonnet 5.5)
- **Branch:** `feat/unit-tech-abilities` (worktree `../civ-unit-tech-abilities`, PR 346)
- **Brief:** `docs/agents/tasks/unit-tech-abilities.md`
- **Status:** in progress (slice 2: the rest of #327)
- **Claimed paths:** `packages/engine/src/assisted*`, `city-actions.ts`, `city-production.ts`, `coins.ts`, `state.ts`, `packages/server/src/routes/`, `packages/web/src/lib/api.ts`, `packages/web/src/views/AssistedActions.tsx`, `TechPanel.tsx`, `GameView.tsx`
- **Notes:** claims `state.ts` (`PlayerView` shape) and `api.ts` shared resources

## Format

```markdown
### <slug>

- **Owner:** <agent or person> (<model>)
- **Branch:** `feat/<slug>`
- **Brief:** `docs/agents/tasks/<slug>.md`
- **Status:** claimed
- **Claimed paths:** `packages/engine/src/...`, `packages/web/src/views/...`
- **Notes:** anything another agent needs to stay out of the way
```

## Shared resources

Rewritten wholesale, so only one task may own each at a time. Claim by name.

| Resource | Owned by |
| --- | --- |
| `packages/engine/data/board-assets.json` and `packages/web/public/board/` | free |
| `packages/web/public/items/` | free |
| `packages/engine/data/gamedata-faf-waw.json` | free |
| `packages/engine/src/state.ts` (`PlayerView` shape) | free |
| `packages/web/src/lib/api.ts` | free |

## Queue

Ready work, most useful first. Taking one moves it to "Live claims".

_Nothing queued._
