# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-174-board-undo-redo

- **Owner:** Claude (Sonnet 5)
- **Branch:** `feat/issue-174-board-undo-redo`
- **Brief:** `docs/agents/tasks/issue-174-board-undo-redo.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/board.ts`
  - `packages/engine/src/actions/board.ts`
  - `packages/engine/src/errors.ts`
  - `packages/engine/src/migrate.ts`
  - `packages/server/src/routes/board.ts`
  - `packages/server/src/errors.ts`
  - `packages/web/src/lib/api.ts`
  - `packages/web/src/views/BoardView.tsx`
  - `packages/web/src/views/GameView.tsx`
  - `packages/web/src/views/FaqView.tsx`
  - `packages/engine/test/board-history.test.ts`
  - `packages/server/test/board-api.test.ts`
- **Notes:** touches the shared `packages/web/src/lib/api.ts` — adding
  `redoBoard` only, no change to existing exports.

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
| `packages/web/src/lib/api.ts` | `issue-174-board-undo-redo` |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
