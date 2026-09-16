# Review report — <slug>

The shape a reviewer returns. Reviewers cannot write files, so this is the
format of the **returned text**, not something saved to disk. The orchestrator
reads it and decides.

---

**Verdict:** approve · approve with nits · changes needed · reject

**Reviewed:** `<diff path>` against `docs/agents/tasks/<slug>.md`
**Verification handed to me:** typecheck <pass/fail> · tests <n passed / n failed> · build <pass/fail>

## Against the brief

For each acceptance criterion: met, not met, or not evidenced by the diff.

| Criterion | Verdict | Note |
| --- | --- | --- |
| … | met | |

## Findings

Most severe first. Anything below `minor` is a nit and goes in the last
section.

### <severity> — <one-line claim>

- **Where:** `path/to/file.ts:123`
- **What:** the defect, stated as a fact about the code.
- **How it fails:** concrete inputs or state, and the wrong result. A finding
  without a failure case is a guess; mark it as such.
- **Confidence:** certain · likely · unsure

Severities:

- **critical** — hidden information leaks, data loss, a rule that contradicts
  the Java reference, or a security hole.
- **major** — wrong behaviour a player would notice, a broken invariant, a test
  that passes by luck.
- **minor** — works, but will cause trouble: a missing edge case, a brittle
  assertion, an unclaimed shared file.

## Convention checks

Short, factual. Only mention what is actually wrong.

- Engine purity (no clock, no randomness, no mutation of input):
- Hidden information (nothing new in a projection without a test):
- Java reference (deliberate differences recorded):
- TypeScript (no `!`, `import type`, `.js` specifiers):
- Tests (fail when something real breaks):

## Nits

Things not worth a round trip. The orchestrator may take them or leave them.

## What I could not check

Be explicit. The reviewer cannot run anything, and a diff hides context.
Anything resting on code outside the diff, or on behaviour only a run would
show, belongs here rather than in a confident finding.
