# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### civ-review-373

- **Owner:** orchestrator + three coders (Claude Sonnet 5.5)
- **Branch:** `feat/civ-abilities-romans-chinese-spain`
- **Brief:** `docs/agents/tasks/civ-review-373.md`
- **Status:** in review
- **Claimed paths:** `packages/engine/src/` (actions/arena.ts, actions/player.ts, assisted.ts, assisted-core.ts, assisted-sot.ts, build-options.ts, city-actions.ts, city-gather.ts, sot.ts, assisted-cards.ts, assisted-resources.ts, assisted-city.ts, city-founding.ts, errors.ts, migrate.ts, movement.ts, state.ts, tech-reveal-abilities.ts), `packages/engine/test/`, `packages/server/src/` (errors.ts, routes/arena.ts, routes/play.ts), `packages/server/test/`, `packages/web/src/views/` (GameView.tsx, BuildPicker.tsx, buildFlow.ts, CityCard.tsx, SotPanel.tsx) and their tests, `packages/web/src/lib/api.ts`, `docs/agents/decisions.md`, `docs/agents/limitations.md`
- **Notes:** PR #373 Copilot review (issue #368)

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
