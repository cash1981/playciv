# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### assisted-play-contract

- **Owner:** Claude (Sonnet 5.5)
- **Branch:** `feat/assisted-play-contract`
- **Brief:** `docs/agents/tasks/assisted-play-contract.md`
- **Status:** claimed
- **Claimed paths:**
  - `packages/engine/src/assisted.ts`, `state.ts`, `migrate.ts`, `index.ts`, `errors.ts`, `log.ts`, `actions/player.ts`, `actions/undo.ts`
  - `packages/server/src/routes/play.ts`, `errors.ts`
  - `packages/web/src/lib/api.ts`, `views/AssistedActions.tsx`, `GameView.tsx`, `TechPanel.tsx`, `StatusPanel.tsx`, `LogPanel.tsx`
  - `docs/agents/decisions.md`, `state.md`, `README.md`
- **Notes:** issue #260, first slice. Draft brief, waiting for the human's go.

_No live claims._


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
| `packages/engine/src/state.ts` (`PlayerView` shape) | assisted-play-contract |
| `packages/web/src/lib/api.ts` | free |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
