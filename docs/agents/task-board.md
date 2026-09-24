# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### turn-order-phase-tracker

- **Owner:** Claude (Sonnet 5)
- **Branch:** `feat/turn-order-phase-tracker`
- **Brief:** `docs/agents/tasks/turn-order-phase-tracker.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/turn.ts`
  - `packages/engine/src/state.ts`
  - `packages/engine/src/actions/player.ts`
  - `packages/engine/src/index.ts`
  - `packages/server/src/notifications.ts`
  - `packages/web/src/views/TurnPanel.tsx`
  - `packages/web/src/views/TurnPanel.css`
  - `packages/web/src/views/GameView.tsx`
- **Notes:** Per-phase Save button next to Reveal (Reveal now saves-then-reveals
  in one click); a global "whose turn / which phase" status computed from
  reveal flags only (no order text), shown near the game title, in the
  end-turn log line and in the "it's your turn" email.

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
