# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### tech-cancellations

- **Owner:** orchestrator (Claude)
- **Branch:** `feat/great-person-twain`
- **Brief:** `docs/agents/tasks/tech-cancellations.md`
- **Status:** in progress
- **Claimed paths:** `packages/engine/src/cancellation.ts`, `united-nations.ts`, `assisted-tech-abilities.ts`, `assisted-cards.ts`, `assisted-core.ts`, `assisted-resources.ts`, `assisted.ts`, `card-timing.ts`, `packages/server/src/routes/cancellation.ts`, `assisted-args.ts`, `packages/web/src/views/LogPanel.tsx`, `AssistedActions.tsx`, `PlayableCards.tsx`, `packages/web/src/lib/cancelPick.ts`, their tests, and `docs/agents/decisions.md`, `limitations.md`, `state.md`
- **Notes:** Writing, Civil Service and Mass Media become real cancellations; United Nations consent on culture events.

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
