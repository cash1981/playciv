# Roles

Four roles, three of them agents. The split exists to spend tokens where they
buy something: cheap models write code, expensive models decide whether the
code is right.

| Role | Model | May write | Spawns others |
| --- | --- | --- | --- |
| **Orchestrator** | strong (Opus) | yes | yes |
| **Coder** | cheap (Sonnet, or Haiku for mechanical work) | yes, inside claimed paths | no |
| **Reviewer** | strong (Opus) | **no** | no |
| **Rules checker** | strong (Opus) | **no** | no |

The orchestrator is the session you are talking to. The other three are defined
in `.claude/agents/` and spawned with the Agent tool.

## Why reviewers cannot write

A reviewer with an Edit tool will fix what it finds. That sounds helpful and is
not:

- The finding never reaches the orchestrator, so nobody decides whether the fix
  was the right one.
- The cheap coder never learns it was wrong, so it makes the same mistake next
  time.
- Two agents end up editing the same files, which is exactly what the task
  board exists to prevent.
- A silent fix inside a review looks, in the diff, like something the coder
  wrote and the reviewer approved. It was neither.

So the reviewer roles have `Read`, `Grep` and `Glob` and nothing else. No
`Write`, no `Edit`, no `Bash`. They read a diff and return a verdict; the
orchestrator acts on it.

They have no Bash either, so they cannot run the tests. That is on purpose: the
orchestrator runs the tests and hands over the real output. A reviewer that runs
its own commands can also write files through them.

## The gate

**Only the orchestrator approves.** Work continues past a review only on an
explicit approval, and the orchestrator is expected to disagree with the
reviewer when it has reason to — the report is evidence, not a verdict.

```
coder ──▶ orchestrator verifies ──▶ reviewer reads diff ──▶ report
                  ▲                                           │
                  │                                           ▼
                  └────── changes needed ◀──── orchestrator decides
                                                              │
                                                          approved
                                                              ▼
                                                             PR
```

## The agents

### `coder`

Writes the code. Gets: the task brief, the claimed paths, the conventions.

Told explicitly to stay inside its claimed paths, to run the verification
commands, and to report failures rather than working around them. It does not
get the Agent tool — no recursive spawning.

Use Haiku for mechanical work (renames, moving code, applying a decided
pattern) and Sonnet for anything needing judgement. Change the `model` line in
`.claude/agents/coder.md`.

### `reviewer`

Reads a diff and the brief it was meant to satisfy, and reports. Looks for:
correctness against the brief, hidden-information leaks, purity violations,
tests that pass by luck, and anything that contradicts `conventions.md`.

Returns a structured report — see `templates/review-report.md`. Every finding
carries a severity and a concrete failure case, so the orchestrator can judge
it rather than take it on faith.

### `rules-checker`

The specialist. Reads the change against `old-civ-rest` and answers one
question: does this match what Java does? Used whenever a change touches game
rules, the deck, the log texts, or a projection.

It is separate from `reviewer` because it is a different kind of reading —
cross-referencing a Java file, not judging TypeScript — and because it is worth
running on its own when a change is small but rule-bearing.

## Cost

The reason for the split: a feature might be 80% mechanical. Writing that on a
cheap model and checking it on an expensive one costs a fraction of writing it
all on the expensive one, and the check is where the expensive model earns its
keep.

Two things keep it from going wrong:

- The reviewer sees the **diff**, not the whole repo, so the expensive pass is
  small.
- The orchestrator runs the tests, so the reviewer is not paying to discover
  what a test run already proved.

If the cheap model needs three rounds on the same task, stop and do it on the
strong model. Three rejected rounds cost more than one good pass.
