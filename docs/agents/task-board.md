# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-193-arrow-key-nudge

- **Owner:** Claude (Sonnet 5, orchestrator; coder on a cheaper model)
- **Branch:** `feat/issue-193-arrow-key-nudge`
- **Brief:** `docs/agents/tasks/issue-193-arrow-key-nudge.md`
- **Status:** in review (round 2 implemented per the updated brief; awaiting
  reviewer)
- **Claimed paths:**
  - `packages/engine/src/actions/board.ts`
  - `packages/server/src/context.ts`
  - `packages/server/src/routes/board.ts`
  - `packages/web/src/lib/api.ts`
  - `packages/web/src/views/BoardView.tsx`
  - `packages/web/src/views/BoardView.test.tsx`
  - `packages/engine/test/board.test.ts`
  - `packages/server/test/board-api.test.ts`
- **Notes:** Arrow keys nudge the selected board piece. Round 1 was client-
  only; round 2 adds a `snap: false` opt-out on `movePiece` so a nudge is not
  re-tidied into a player-area grid slot or re-snapped to a map-tile slot.
  Every existing caller of `movePiece`/`api.movePiece` is unaffected (the new
  field is optional and defaults to current snapping behaviour).
  `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass (engine 561,
  web 259, server 209 tests). Not verified in a real browser — no browser
  available to this agent; see the handback report.

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
| `packages/web/src/lib/api.ts` | `issue-193-arrow-key-nudge` (adding an optional 5th param to `movePiece`; every existing call site unaffected) |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
