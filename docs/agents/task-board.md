# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### battle-discard-ownership

- **Owner:** Claude (Sonnet 5)
- **Branch:** `fix/battle-discard-ownership`
- **Brief:** `docs/agents/tasks/battle-discard-ownership.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/actions/draw.ts`
  - `packages/engine/src/actions/game.ts`
  - `packages/engine/src/migrate.ts`
  - `packages/engine/test/revealed-feed.test.ts`
  - `packages/engine/test/migrate.test.ts`
  - `packages/engine/test/draw.test.ts`
- **Notes:** Engine-only bugfix (no server/web change needed — `RevealedRow`
  already renders whatever `revealedFeed` gives it). Touches a projection and
  adds a migration, so both `reviewer` and `rules-checker` run on this.

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
