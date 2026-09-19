# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-79-barbarian-draw-and-winner

- **Owner:** Claude (Sonnet 5)
- **Branch:** `fix/issue-63-arena-ux`
- **Brief:** `docs/agents/tasks/issue-79-barbarian-draw-and-winner.md`
- **Status:** in review
- **Claimed paths:**
  - `packages/web/src/views/GameView.tsx`
  - `packages/web/src/lib/api.ts`
  - `packages/server/src/routes/play.ts`
  - `packages/engine/src/state.ts`
  - `packages/engine/src/actions/arena.ts`
  - `packages/engine/test/arena.test.ts`
- **Notes:** removes the manual barbarian-draw button and adds a battle-winner
  log line to `endBattleAction`. Awaiting review-gate.

Recently done on `feat/game-fixes` (PR to open): core game bug fixes, tile
snap-on-move, duplicate start-player removal, zoom panning, tech-tree layout.

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

| Slug | What | Brief |
| --- | --- | --- |
| `public-landing` | Landing page: active games, highscore, open chat | `tasks/public-landing.md` |
| `anonymous-readonly` | Read-only access without an account, and the security pass that goes with it | `tasks/anonymous-readonly.md` |
