# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-168-tech-revamp

- **Owner:** Claude (Opus 5.5, orchestrator) + coder subagent (Sonnet 5)
- **Branch:** `feat/issue-168-tech-revamp`
- **Brief:** `docs/agents/tasks/issue-168-tech-revamp.md`
- **Status:** in progress
- **Claimed paths:**
  - `packages/engine/src/item.ts`
  - `packages/web/src/views/TechTree.tsx`
  - `packages/web/src/views/TechTree.test.tsx`
  - `packages/web/src/views/TechPanel.tsx`
  - `packages/web/src/views/TechPanel.test.tsx`
  - `packages/web/src/views/techText.ts` (new — written by the orchestrator, transcribed from
    `packages/web/public/help/Civ_Tech_FF-WW.-2.jpg`)
  - `packages/web/src/styles.css`
  - `tools/tech-assets.ps1` (new)
  - `packages/web/public/items/` (shared resource, see below)
- **Notes:** Implements issue #168 (tech tree with real card images, and a level-tabbed card
  browser replacing the tech combo box). Card source images
  (`Civilization/Moderator/techs/*.jpg`, gitignored) were already prepared and cropped in a
  separate session.

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
| `packages/web/public/items/` | issue-168-tech-revamp |
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
