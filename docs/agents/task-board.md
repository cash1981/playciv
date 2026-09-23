# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-146-turnpanel-test-flake

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `fix/issue-146-turnpanel-test-flake`
- **Brief:** `docs/agents/tasks/issue-146-turnpanel-test-flake.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/web/src/views/TurnPanel.test.tsx`
  - `docs/agents/tasks/issue-146-turnpanel-test-flake.md`
  - `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`
- **Notes:** Issue #146. Test-only: removes the file's wall-clock waits
  (`waitFor`/`findBy*`) in favour of `act` flushes and
  `vi.dynamicImportSettled()`. The `issue-139-poll-retry` and
  `issue-140-tech-policy-tabs` claims that stood here were released in this
  change: their PRs (#148, #143) are merged and their paths are free. No
  `rules-checker` pass: no game rule, deck, log text or projection changes.

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
| `packages/web/src/lib/api.ts` | free (released with #148's merge) |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
