# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### game-fixes-core

- **Owner:** coder (Sonnet), orchestrated by Opus
- **Branch:** `feat/game-fixes` (off `feat/mongodb-storage`, which carries
  Luna's earlier bug-fix commits plus the MongoDB work)
- **Brief:** `docs/agents/tasks/game-fixes-core.md`
- **Status:** in progress — the four testable engine/server findings
- **Claimed paths:**
  - `packages/engine/src/actions/player.ts` (endTurn error only)
  - `packages/engine/src/errors.ts`
  - `packages/server/src/errors.ts`
  - `packages/server/src/routes/play.ts`
  - `packages/server/src/routes/games.ts`
  - `packages/server/src/context.ts`
  - `packages/engine/test/`, `packages/server/test/`
- **Notes:** Continues Luna's `game-ui-bugfixes` on a new branch off
  `feat/mongodb-storage`. This brief covers only the testable engine/server
  findings (membership on endturn/taketurn, GAME_NOT_STARTED, log timestamp
  stamping on create, newest-first tiebreak). The client-visual items (timestamp
  display, tech-tree float/overlap, collapsible panels, pyramid overflow) and the
  three new tasks (duplicate start-player asset, civ-tile L-shape placement, tile
  snap-on-move, zoom panning) are separate briefs to follow.

Recently merged: `tech-tree` and `mongodb-storage`. The latter added `highscore`
to the engine barrel and `GET /api/highscore`; whoever takes `public-landing`
builds the UI on that endpoint rather than re-deriving highscore.

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
