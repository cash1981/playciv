# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

Recently done on `feat/game-fixes` (PR to open): core game bug fixes, tile
snap-on-move, duplicate start-player removal, zoom panning, tech-tree layout.

### wonders-board

- **Owner:** Claude (Opus 4.8)
- **Branch:** `feat/wonders-board`
- **Brief:** `docs/agents/tasks/wonders-board.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/board.ts`
  - `packages/engine/src/state.ts` (`boardAreas` only, not the `PlayerView` hand shape)
  - `packages/engine/src/actions/board.ts`
  - `packages/engine/src/actions/draw.ts`
  - `packages/engine/src/actions/player.ts`
  - `packages/engine/data/board-assets.json` and `packages/web/public/board/`
  - `tools/board-assets.ps1`
  - `packages/web/src/views/BoardView.tsx`
  - `packages/web/src/styles.css` (board-area rules only)
  - `packages/engine/test/`, `packages/server/test/`
- **Notes:** Adds a `wonder` board-asset category (art copied from
  `Civilization/Moderator/wonders`), a shared **Wonders** area at the right of
  the player-area band (the two player areas shrink in width to make room), and
  redirects the start-of-game wonder draw off the hand and onto that board area,
  with a public log line. Does **not** touch the item/hand `PlayerView` shape or
  `api.ts`. The gift-restriction UI (part 3 of the request) is a separate
  follow-up, not in this branch.

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
