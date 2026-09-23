# TurnPanel test flake under CPU load

- **Slug:** `issue-146-turnpanel-test-flake`
- **Branch:** `fix/issue-146-turnpanel-test-flake`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

`packages/web/src/views/TurnPanel.test.tsx` passes in a full-suite run on a
loaded machine exactly as it does on an idle one: none of its awaits may depend
on how quickly wall-clock time moves.

## Why

Issue #146, filed while verifying #139: the file failed twice in roughly
fourteen full runs, always one test, never the same one, only under load — the
file took about 5.4 s in the failing runs against 0.3-0.6 s when passing.

Reproduced on 2026-09-23 in the main checkout, without any synthetic load, in
6 full `pnpm --filter @civ/web test` runs, 2 of which failed:

- `MarkdownEditor lifecycle > saves from the fallback and unmounts safely while
  Crepe is still loading` failed at `TurnPanel.test.tsx:235` with
  `AssertionError: expected [] to have a length of 1 but got +0` — the
  `waitFor(() => expect(milkdownLifecycle.instances).toHaveLength(1))` ran out
  of its 1 s wall-clock deadline before Vite had finished serving the mocked
  editor's dynamic imports.
- In another run the same file was killed by Vitest's 5 s test timeout, and
  while passing, its tests take 6.2-7.1 s in a full run against 2.3 s when the
  file runs alone.

The cause is the one the issue names: `findBy*`/`waitFor` poll against a
one-second wall-clock deadline while the 15 parallel workers keep the machine
busy, and the dynamic imports the editor starts inside its effect are served by
the same saturated Vite pipeline.

## Scope

**In:**

- `packages/web/src/views/TurnPanel.test.tsx` only.

**Out:**

- The other files that timed out at Vitest's 5 s deadline in the same full run
  (`BoardView`, `LoginView`, `StatusPanel`). They are real, but they are not
  the file #146 names and their waits have different owners; making them
  deterministic is a separate task if they keep failing. Reported to the human
  with this change.
- Any production code. `MarkdownEditor` and `TurnPanel` are correct; only the
  tests race the clock.
- Raising `testTimeout` or lowering `maxWorkers` to hide the race. The issue
  asks for waits independent of wall-clock time, not a bigger deadline.

## Reference

No old-system reference: this is test infrastructure. The relevant contracts
are Vitest's `vi.dynamicImportSettled()` and `act`, and Testing Library's
`waitFor`, whose 1 s default only engages wall-clock timers when `vi`
fake-timer APIs are not detected — they are not, because it looks for a global
`jest` (`@testing-library/dom` 10.4.2 `helpers.js`).

## Approach

1. Add one helper, `settle()`, that flushes the mocked `api` promises and the
   React updates they trigger through `act` — the same `await act(async () =>
   Promise.resolve())` idiom the file already uses — and replace every
   `await screen.findBy*` whose condition is promise-driven with `await
   settle()` plus the matching `screen.getBy*`.
2. In the two `MarkdownEditor lifecycle` tests, replace the waits on
   `milkdownLifecycle.instances` with `await vi.dynamicImportSettled()`, which
   waits on the module runner's own bookkeeping instead of a wall-clock
   deadline, then assert synchronously.
3. Remove the now-unused `waitFor` import. Keep every existing assertion; add
   comments only where the reason for the change is not obvious.

## Claimed paths

- `packages/web/src/views/TurnPanel.test.tsx`
- `docs/agents/tasks/issue-146-turnpanel-test-flake.md`
- `docs/agents/task-board.md`, `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [ ] `TurnPanel.test.tsx` contains no `waitFor`/`findBy*` wall-clock polling;
      every await is a microtask/`act` flush or `vi.dynamicImportSettled()`.
- [ ] Every existing test and assertion survives; none is weakened, skipped or
      deleted. The file still fails if the behaviour it pins breaks.
- [ ] The full web suite passes in repeated runs, including under CPU load
      (the count and the load reported honestly in the PR).
- [ ] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass.
- [ ] Hidden information: not applicable — no engine, projection or route is
      touched.
- [ ] Verified in the browser: not applicable — test-only change.

## Open questions

None. The scope question (the other three files) is answered above: out, and
reported.
