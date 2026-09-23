# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-87-rating

- **Owner:** Codex (orchestrator and coder)
- **Branch:** `codex/issue-87-rating`
- **Brief:** `docs/agents/tasks/issue-87-rating.md`
- **Status:** in progress
- **Claimed paths:**
  - `docs/agents/tasks/issue-87-rating.md`, `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
  - `packages/engine/src/highscore.ts`, `packages/engine/src/index.ts`, `packages/engine/test/highscore.test.ts`
  - `packages/server/src/migrate/`, `packages/server/src/store/`, `packages/server/src/routes/public.ts`, `packages/server/src/routes/games.ts`, `packages/server/src/routes/auth.ts`, `packages/server/package.json`, `packages/server/test/`
  - `packages/worker/migrations/`, `packages/web/src/views/HighscoreView.tsx`, `packages/web/src/lib/api.ts`, `packages/web/test/`, `pnpm-lock.yaml`
- **Notes:** Issue #87 rating and complete highscore cache. No overlap with current live claims.

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
