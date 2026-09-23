# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### responsive-map-panels

- **Owner:** Codex (orchestrator and coder)
- **Branch:** `codex/responsive-map-panels`
- **Brief:** `docs/agents/tasks/responsive-map-panels.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/web/src/views/BoardView.tsx`
  - `packages/web/src/views/BoardView.test.tsx`
  - `packages/web/src/views/CollapsiblePanel.tsx`
  - `packages/web/src/views/CollapsiblePanel.test.tsx`
  - `packages/web/src/views/GameView.tsx`
  - `packages/web/src/views/LogPanel.tsx`
  - `packages/web/src/views/TechPanel.tsx`
  - `packages/web/src/views/SocialPolicyPanel.tsx`
  - `packages/web/src/views/TurnPanel.tsx`
  - `packages/web/src/views/ChatPanel.test.tsx`
  - `packages/web/src/views/OpponentHandPanel.test.tsx`
  - `packages/web/src/views/StatusPanel.test.tsx`
  - `packages/web/src/views/TechPanel.test.tsx`
  - `packages/web/src/views/SocialPolicyPanel.test.tsx`
  - `docs/agents/tasks/responsive-map-panels.md`
  - `docs/agents/state.md`
- **Notes:** Board zoom and default panel state only; existing stored panel choices remain authoritative.

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
