# Task board

Who is working on what. **Claim before you edit; release when you stop.** Edit
only your own block. If a live claim lists a path you need, pick other work or
ask the orchestrator to sequence the tasks. Delete your block, with the brief,
in the branch's last commit.

Status: `claimed` · `in progress` · `in review` · `blocked`.

## Live claims

### civ-abilities-feedback

- **Owner:** coder (Claude Sonnet 5.5)
- **Branch:** `feat/civ-abilities-romans-chinese-spain`
- **Brief:** `docs/agents/tasks/civ-abilities-feedback.md`
- **Status:** in progress
- **Claimed paths:** `packages/engine/src/` (actions/arena.ts, actions/board.ts, actions/collect-token.ts, actions/player.ts, actions/tile-tokens.ts, actions/token-collection.ts, assisted-resources.ts, assisted-tech-abilities.ts, cancellation.ts, assisted.ts, assisted-core.ts, assisted-conquest.ts (new), conquest.ts (new), index.ts, movement.ts, errors.ts, state.ts, tech-reveal-abilities.ts), `packages/engine/test/`, `packages/server/src/` (errors.ts, routes incl. assisted-args.ts and games.ts), `packages/server/test/`, `packages/web/src/lib/api.ts`, `packages/web/src/views/GameView.tsx`, `packages/web/src/views/ConquestPrompt.tsx` and `.css` (new), `packages/web/src/views/PhaseTabs.tsx`, `packages/web/src/views/AssistedActions.tsx` and their tests, `docs/agents/decisions.md`, `docs/agents/limitations.md`
- **Notes:** PR #373 human review feedback (issue #368); follow-up: conquest offers for the Roman and Chinese conquest rewards

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
| `packages/engine/src/state.ts` (`PlayerView` shape) | civ-abilities-feedback |
| `packages/web/src/lib/api.ts` | civ-abilities-feedback |

## Queue

Ready work, most useful first. Taking one moves it to "Live claims".

_Nothing queued._
