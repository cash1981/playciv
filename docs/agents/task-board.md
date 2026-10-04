# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### great-person-disable

- **Owner:** Claude (orchestrator) with the coder role
- **Branch:** `fix/great-person-disable`
- **Brief:** `docs/agents/tasks/great-person-disable.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/blockade.ts` (new), `combat-bonus.ts`, `coins.ts`, `state.ts`, `culture-hand.ts`, `errors.ts`, `index.ts`
  - `packages/engine/src/actions/player.ts` (`setCoinSource` only)
  - `packages/server/src/store/rating.ts`
  - `packages/web/src/views/BoardView.tsx`, `GameView.tsx`, `StatusPanel.tsx`, `packages/web/src/styles.css`
- **Notes:** issue #241. Derived blockade rule, no stored state.

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
