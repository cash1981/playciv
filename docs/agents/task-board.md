# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-244-removing-wonder

- **Owner:** Codex (GPT-6)
- **Branch:** `fix/issue-244-removing-wonder`
- **Brief:** `docs/agents/tasks/issue-244-removing-wonder.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/web/src/views/WondersPanel.tsx`
  - `packages/web/src/views/WondersPanel.test.tsx`
  - `packages/engine/src/actions/board.ts`
  - `packages/engine/src/board.ts`
  - `packages/engine/test/board.test.ts`
  - `packages/engine/test/culture-hand-size.test.ts`
  - `packages/engine/test/combat-bonus.test.ts`
  - `packages/server/src/routes/board.ts`
  - `packages/server/test/board-api.test.ts`
  - `packages/web/src/lib/api.ts`
  - `docs/agents/tasks/issue-244-removing-wonder.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`
  - `docs/agents/decisions.md`
- **Notes:** Waiting on the meaning of “disable” and the culture token behavior in issue #244.

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
