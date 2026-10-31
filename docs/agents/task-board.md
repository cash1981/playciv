# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### great-person-arts

- **Owner:** Claude Code (Sonnet 5.5)
- **Branch:** `feat/great-person-arts`
- **Brief:** `docs/agents/tasks/great-person-arts.md`
- **Status:** in progress
- **Claimed paths:** `packages/engine/src/assisted*.ts`, `card-timing.ts`, `city-actions.ts`, `state.ts`, `packages/server/src/routes/play.ts`, `packages/web/src/views/{CityGather,CityCard,BuildPicker}.tsx`, `packages/web/src/lib/api.ts`
- **Notes:** `state.ts` is claimed only for effect types, not the `PlayerView` shape.

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
