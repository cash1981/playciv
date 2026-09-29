# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### chat-orders

- **Owner:** Claude (orchestrator; coder role for slices)
- **Branch:** `feat/chat-orders`
- **Brief:** `docs/agents/tasks/chat-orders.md`
- **Status:** in progress (slice 1 of 3: engine and server)
- **Claimed paths:**
  - `packages/engine/src/turn.ts`, `state.ts`, `migrate.ts`, `errors.ts`
  - `packages/engine/src/actions/turn.ts`, `actions/draw.ts`
  - `packages/server/src/routes/games.ts`, `routes/play.ts`, `routes/admin.ts`
  - `packages/server/src/store/types.ts`, `d1.ts`, `json-file.ts`
  - `packages/worker/migrations/0004_chat_kind.sql`
- **Notes:** slices 2 (web) and 3 (new turn, marker) will claim `packages/web/...` and `engine/src/board.ts` when they start.

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
| `packages/engine/src/state.ts` (`PlayerView` shape) | chat-orders |
| `packages/web/src/lib/api.ts` | free |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
