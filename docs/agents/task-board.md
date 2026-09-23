# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-97-color-choice

- **Owner:** Codex (Astra orchestrator, Sol coder)
- **Branch:** `feat/issue-97-color-choice`
- **Brief:** `docs/agents/tasks/issue-97-color-choice.md`
- **Status:** in progress
- **Claimed paths:**
  - `docs/agents/tasks/issue-97-color-choice.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`
  - `docs/agents/decisions.md`
  - `packages/engine/src/actions/game.ts`
  - `packages/engine/src/errors.ts`
  - `packages/engine/test/game-action.test.ts`
  - `packages/server/src/routes/games.ts`
  - `packages/server/src/errors.ts`
  - `packages/server/test/api.test.ts`
  - `packages/web/src/lib/api.ts`
  - `packages/web/src/views/LandingView.tsx`
  - `packages/web/src/views/GameList.tsx`
  - `packages/web/src/views/GameList.test.tsx`
  - `packages/web/src/views/LandingView.test.tsx`
- **Notes:** Color selection on creation and joining, including safe takeover of withdrawn hands.

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

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
