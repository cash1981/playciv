# Review report — <slug>

The text a reviewer returns (reviewers cannot write files). The orchestrator
decides.

**Verdict:** approve · approve with nits · changes needed · reject
**Reviewed:** `<diff>` against `docs/agents/tasks/<slug>.md`
**Verification given:** typecheck <pass/fail> · tests <passed/failed> · build <pass/fail>

## Against the brief

| Criterion | met / not met / not evidenced | Note |
| --- | --- | --- |

## Findings

Most severe first.

### <severity> — <one-line claim>

- **Where:** `path/to/file.ts:123`
- **What:** the defect, as a fact about the code.
- **How it fails:** concrete inputs and the wrong result; without one, mark it a guess.
- **Confidence:** certain · likely · unsure

Severities: **critical** (hidden-information leak, data loss, a rule contradicting
rulebooks or tests, security hole), **major** (visible wrong behavior, broken
invariant, test passing by luck), **minor** (missing edge case, brittle
assertion, unclaimed shared file). Anything less is a nit.

## Conventions

Only what is wrong: engine purity, hidden information, recorded behavior
changes, TypeScript rules, tests that fail when something real breaks.

## Nits

## Not checked

What rests on code outside the diff or on runtime behavior.
