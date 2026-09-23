# Task board

Who is working on what, right now. **Claim before you edit. Release when you
stop.** Edit only your own block.

A claim is a list of paths. If a live claim lists a path you need, do not edit
it — pick other work or ask the orchestrator to sequence the tasks.

Status is one of: `claimed` · `in progress` · `in review` · `blocked` · `done`.

---

## Live claims

### issue-139-poll-retry

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `feat/issue-139-poll-retry`
- **Brief:** `docs/agents/tasks/issue-139-poll-retry.md`
- **Status:** review-approved (round 3; round 1's two minors - an unpinned 1 s
  back-off and an imprecise "GET is read-only" reason - fixed, round 2's one
  minor corrected in the state file) - PR to open, awaiting the human's merge.
  Claim kept until merged.
- **Claimed paths:**
  - `packages/web/src/lib/api.ts`
  - `packages/web/src/lib/api.test.ts`
  - `packages/web/src/views/GameView.tsx` (`loadConsistentLive`/`reload` region and the auto-refresh effect only)
  - `packages/web/src/views/GameView.test.tsx`
  - `docs/agents/tasks/issue-139-poll-retry.md`
  - `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`
- **Notes:** Follow-ups from #139 after #138/#138. Two changes: a bounded retry
  for `GET` on `502`/`503`/`504`, and a poll that skips the revision list while
  `rev` has not moved. Client-only. `packages/web/src/lib/api.ts` is claimed in
  the shared-resources table. `packages/web/src/views/GameView.tsx` is named in
  `issue-140-tech-policy-tabs` ("the panel list only"), but that PR (#143) is
  merged, the main checkout is clean and its branch is merged too, so the claim
  is stale and this edit is a different region; recorded rather than treated as
  a collision. No `rules-checker` pass: no game rule, deck, log text or
  projection changes.

### issue-140-tech-policy-tabs

- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Branch:** `feat/issue-140-tech-policy-tabs`
- **Brief:** `docs/agents/tasks/issue-140-tech-policy-tabs.md`
- **Status:** review-approved — PR #143 open, awaiting the human's merge. Claim
  kept until merged.
- **Claimed paths:**
  - `packages/engine/src/state.ts` (`OpaquePlayerhand` and `opaque()` only)
  - `packages/engine/test/hidden-info.test.ts`
  - `packages/web/src/views/PlayerTabs.tsx` (new), `packages/web/src/views/PlayerTabs.css` (new)
  - `packages/web/src/views/TechPanel.tsx`, `packages/web/src/views/TechPanel.test.tsx`
  - `packages/web/src/views/SocialPolicyPanel.tsx` (new), `packages/web/src/views/SocialPolicyPanel.test.tsx` (new)
  - `packages/web/src/views/GameView.tsx` (the panel list only)
  - `docs/agents/tasks/issue-140-tech-policy-tabs.md`
  - `docs/agents/task-board.md`
  - `docs/agents/state.md`, `docs/agents/decisions.md`, `README.md`
- **Notes:** Issue #140. Splits the combined Techs & Social policy panel into two
  panels, each with a tab per player. Other players' revealed social policies
  become visible through a new `OpaquePlayerhand.revealedSocialPolicies`
  projection (no new route). The human chose: own data as the first tab,
  username + player colour labels, pickers above the tabs. `styles.css` and
  `api.ts` are not touched. This claim replaced every claim that stood here
  before; all of those PRs are merged (checked with `gh pr list --state merged`),
  so their paths are free.

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
| `packages/web/src/lib/api.ts` | `issue-139-poll-retry` (DeepSeek V4.1 Flash) |

The last two are listed because almost every feature wants to touch them, which
makes them the most likely collision in the repo.

---

## Queue

Work that is ready to start, most useful first. Taking one means moving it to
"Live claims".

_Nothing queued._ `public-landing` shipped as issue #38's `LandingView`;
`anonymous-readonly` shipped as issues #81/#82.
