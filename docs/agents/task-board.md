# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### mongodb-storage

- **Owner:** coder (Sonnet), orchestrated by Opus
- **Branch:** `feat/mongodb-storage` (off `chore/agent-workflow`)
- **Brief:** `docs/agents/tasks/mongodb-storage.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/server/src/auth.ts`
  - `packages/server/src/routes/auth.ts`
  - `packages/server/src/routes/public.ts` (new)
  - `packages/server/src/store/{types,json-file,mongo}.ts`
  - `packages/server/src/{app,index,seed-test-user}.ts`
  - `packages/server/package.json`
  - `packages/engine/src/{highscore,index}.ts`
  - `packages/engine/test/highscore.test.ts`
  - `packages/server/test/auth-legacy.test.ts`
- **Notes:** Reuses the shared `PlayerView`-adjacent `api.ts`? No — server-only.
  Claims `state.ts` shape? No. Adds `highscore` to the engine barrel; whoever
  takes `public-landing` builds the UI on top of `GET /api/highscore`.

Awaiting merge: `tech-tree` (approved through the review gate, verified in the
browser, PR to open for `feat/tech-tree`) and `mongodb-storage` (approved and
verified, PR open for `feat/mongodb-storage`).

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
| `tech-tree` | The tech pyramid, private and public | `tasks/tech-tree.md` |
| `public-landing` | Landing page: active games, highscore, open chat | `tasks/public-landing.md` |
| `anonymous-readonly` | Read-only access without an account, and the security pass that goes with it | `tasks/anonymous-readonly.md` |
