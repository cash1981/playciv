# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### chat-orders

- **Owner:** Claude (orchestrator; coder role)
- **Branch:** `feat/chat-orders` (PR #218, all three slices)
- **Brief:** `docs/agents/tasks/chat-orders.md`
- **Status:** in review (three full reviews and a final round done; waiting for the human to test and merge)
- **Claimed paths:** everything listed in the brief, released when #218 merges.

### coin-defaults

- **Owner:** Claude (orchestrator; coder role)
- **Branch:** `feat/coin-defaults`
- **Brief:** `docs/agents/tasks/coin-defaults.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/coins.ts`
  - `packages/engine/src/actions/player.ts`
  - `packages/engine/test/coin-sources.test.ts`
  - `docs/agents/decisions.md`, `docs/agents/state.md`, `README.md`

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
| `packages/web/src/lib/api.ts` | chat-orders |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
