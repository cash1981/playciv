# Assisted play polish: used actions, toast lifetime, toast text

- **Slug:** `assisted-polish` (a small slice on `feat/assisted-play-contract`, the
  branch the human asked for; same PR #271)
- **Branch:** `feat/assisted-play-contract`
- **Owner:** Claude (orchestrator), coder and reviewer roles per `roles.md`
- **Status:** done

## Review

Independent read-only review approved on 2026-10-24. Accepted nits, not blockers:
arena verbs (`places`, `kills`, `undoes`, `ends`) are not in the you-form map; a
target whose username begins with the viewer's name plus a space (`Alice` vs
`Alice Smith`) can be shortened by the `from`/`to` rewrite; and the New turn line
`Turn N: <name> starts` is not rewritten (the toast is only shown to the actor).

## Goal

Three changes the human asked for after trying the assisted actions (2026-10-24):

1. A social policy or wonder is used once per turn. When it has been used, its
   button is disabled; there is no confirmation asking to use it again.
2. The green notification after an action stays for 7 seconds instead of 4.
3. The notification does not show the viewer's username. Whoever pressed the
   button already knows the action is theirs.

## Decisions

- Social policies and wonders are strict once per turn: `confirmedRepeat` cannot
  lift their `used` refusal. The viewer's own `availableActions` entries now say
  whether a used action may be repeated (`repeatable`), so the client disables
  the used button instead of guessing the rule from its group. Government
  changes and investments were already strict once; they are not
  `availableActions` buttons and their own panel already disables them.
- Great Persons, culture cards and coin purchases keep the existing confirmed
  repeat: a card can grant another use, so the player is the override there.
- The success toast stays 7 seconds. The failure toast stays 8 seconds.
- `confirmationText` replaces the viewer's own username with "you"/"your" (and
  capitalises the start) and leaves every other player's name alone. The server
  route still returns the raw private/public log text; the wording is a display
  concern of the web app.

## Scope

In: `AvailableAction.repeatable`, strict-once flags for the social policies and
wonders, the disabled used button, the toast duration, the confirmation text and
their tests. The Great Person hidden-info API test also gets a test-only fix: it
keeps the drawn cards but leaves a card name that is also a public Start of Turn
button label out of the name checks (the id is still checked), so a public label
is not mistaken for a leaked card name.

Out: changing the stored log text, the revision history, or other players' view
of an action; changing the repeat behaviour of Great Persons, culture cards or
coin purchases.

## Claimed paths

- `packages/engine/src/assisted.ts`, `assisted-core.ts`, `assisted-sot.ts`,
  `assisted-abilities.ts`, `state.ts`
- `packages/engine/test/assisted*.test.ts`
- `packages/server/test/assisted-gp-api.test.ts` (the test-only fix above)
- `packages/web/src/views/AssistedActions.tsx`, `GameView.tsx`, `ToastRegion.tsx`,
  their tests and `packages/web/src/lib/toasts.ts`, `confirmation.ts`
- `docs/agents/tasks/assisted-polish.md`, `docs/agents/decisions.md`,
  `docs/agents/state.md`, `docs/agents/task-board.md`

## Acceptance criteria

- [x] A used social policy and a used wonder show a disabled button, never a
      confirmation, and the server refuses a `confirmedRepeat` for them.
- [x] A used Great Person or culture card still asks before a confirmed repeat.
- [x] The success toast closes after 7 seconds and still has its close button.
- [x] The success toast says "You used …" / "Your … was undone", not the
      viewer's username, and leaves another player's name untouched.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build`
