---
name: review-gate
description: Run the review cycle on the current feature branch — verify, hand the diff to a read-only reviewer on a stronger model, and decide whether to approve. Use when a coder reports done, before opening a pull request, or whenever the human asks for the work to be checked. Nothing merges without passing this.
---

# Review gate

The reviewer for every Codex review gate must be Sol (`gpt-5.6-sol`). Spawn the
reviewer with that model. Do not use Terra as the default reviewer. If Sol is
unavailable, stop and report the blocker instead of silently substituting a
weaker reviewer.

The check between "the code is written" and "the code is merged". The coder
never approves its own work: it is written on a cheaper model and read by a
stronger one that cannot write.

You are the orchestrator here. **You approve, not the reviewer.** Its report is
evidence; disagree with it when you have reason.

Run the gate **after the first implementation**, not once at the end, and run it
**to zero findings**: fix what it reports and review the new diff again, until a
round has nothing above a nit. A nit you choose to leave is recorded in the
verdict so the choice is visible.

## 1. Verify first

Run it yourself, and read the output:

```bash
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

Node and pnpm are not on the default PATH; prepend `C:\Program Files\nodejs`
when calling them from PowerShell.

If anything fails, **stop**. Send it back to the coder. There is no point
spending a strong model on a diff that does not compile.

Keep the exact numbers — test counts, failures — to hand to the reviewer. The
reviewer has no Bash tool and cannot find this out for itself, which is
deliberate.

## 2. Write the diff outside the repo

The reviewer reads a file; writing it into the working tree would pollute the
branch and show up in the diff it is reviewing.

```bash
git diff main...HEAD > "<scratchpad>/review-<slug>.diff"
```

Use the session scratchpad directory from your environment. Note the size: a
diff over a few thousand lines should be split by area, or the review will be
shallow everywhere instead of sharp somewhere.

## 3. Spawn the reviewer

Use the reviewer agent with model `gpt-5.6-sol`. Give it:

- the path to the diff,
- the path to the task brief, `docs/agents/tasks/<slug>.md`,
- the verification output from step 1, verbatim.

If the change touches game rules, the deck, log texts or a projection, also
spawn `rules-checker` with the same diff. Run them in the same message so they
work in parallel.

Both are read-only. Neither can fix what it finds, which is the point: every
finding reaches you.

## 4. Decide

Read the reports. For each finding, judge it yourself — check the claim against
the code rather than taking it on faith. Reviewers are wrong sometimes, and a
finding with no concrete failure case is a suspicion, not a defect.

Then:

- **Approved** — only when no finding above a nit remains. Say so explicitly,
  and the work may proceed to `/feature finish`.
- **Changes needed** — hand the findings back to the coder as a list, and run
  this gate again on the new diff afterwards. Do not quietly fix them yourself;
  the loop is what stops the same mistake recurring. Keep going until a round
  reports nothing above a nit.

Record the verdict in the task board block as `in review` → `done`, and append
anything worth keeping to `docs/agents/decisions.md`.

## 5. When to stop being cheap

If the coder has come back three times on the same task, stop. Three rejected
rounds on a cheap model cost more than one pass on a strong one. Say so and
switch the coder to the strong model; the review loop continues on the new diff.

## What must never pass

Regardless of the reviewer's verdict, do not approve when:

- a projection carries another player's hand, private log, or unrevealed cards,
  and no test proves otherwise;
- the change encodes an FFG rule that is not in the old system;
- it "fixes" old-system behaviour without recording the deviation in
  `docs/agents/decisions.md` and `README.md`;
- a test was deleted or loosened to make the suite pass;
- the engine gained a clock, a random number, I/O, or a `throw`.
