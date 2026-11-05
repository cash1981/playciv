# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### cancellation-reactions

- **Owner:** Copilot (orchestrator; coder implementation)
- **Branch:** `feat/great-person-twain` (isolated integration worktree)
- **Brief:** `docs/agents/tasks/cancellation-reactions.md`
- **Status:** in progress
- **Claimed paths:** `packages/engine/src/` cancellation, assisted-card, state and projection integration; corresponding engine tests; `packages/server/src/context.ts`, cancellation/play routes and corresponding tests; `packages/web/src/lib/api.ts`, cancellation/card/game/timeline views and tests; `README.md`, relevant sections of `docs/agents/decisions.md` and `limitations.md`.
- **Notes:** Preserve the existing uncommitted cross-phase target-list improvements. Implement a response window only for actual cancellations; no speculative execution while a dispute is open.

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
