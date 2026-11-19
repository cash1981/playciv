# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### civ-abilities-romans-chinese-spain

- **Owner:** orchestrator (Claude Sonnet 5.5)
- **Branch:** `feat/civ-abilities-romans-chinese-spain`
- **Brief:** `docs/agents/tasks/civ-abilities-romans-chinese-spain.md`
- **Status:** in progress
- **Claimed paths:** `packages/engine/src/assisted.ts`, `assisted-city.ts`, `actions/token-collection.ts`, `actions/player.ts`, `actions/undo.ts`, `packages/engine/src/actions/tile-tokens.ts`, `actions/board.ts`, `state.ts`, `errors.ts`, `actions/arena.ts`, `battle-cards.ts`, `packages/server/src/errors.ts`, `actions/player.ts` (revealTech), `build-item.ts`, `tech-reveal-abilities.ts`, `culture-track.ts`, `actions/explore.ts`, `assisted-city.ts`, `metropolis.ts`, `assisted-resources.ts`, `city-actions.ts`, `actions/collect-token.ts`, `packages/web/src/views/SotPanel.tsx`, `packages/web/src/views/GameView.tsx` (text only), `packages/engine/test/`, `packages/web/src/views/*.test.tsx`, `docs/agents/decisions.md`
- **Notes:** issue #368 first batch

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
