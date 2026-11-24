# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### reposition-built-figure

- **Owner:** Claude (Sonnet 5.5)
- **Branch:** `fix/reposition-built-figure`
- **Brief:** `docs/agents/tasks/reposition-built-figure.md`
- **Status:** in progress
- **Claimed paths:** `packages/engine/src/build-reposition.ts`, `packages/engine/src/build-options.ts` (append), `packages/engine/src/state.ts` (own view field), `packages/engine/src/index.ts`, `packages/server/src/routes/board.ts`, `packages/web/src/views/BoardView.tsx`, `packages/web/src/views/GameView.tsx`, `packages/web/src/lib/api.ts`
- **Notes:** small, self-contained; mergeable into `feat/civ-abilities-romans-chinese-spain` (#373)

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
| `packages/engine/src/state.ts` (`PlayerView` shape) | reposition-built-figure |
| `packages/web/src/lib/api.ts` | reposition-built-figure |

## Queue

Ready work, most useful first. Taking one moves it to "Live claims".

_Nothing queued._
