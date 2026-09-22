# Social policy card reference

- **Slug:** `issue-101-social-policy-reference`
- **Branch:** `feat/issue-101-social-policy-reference`
- **Owner:** orchestrator (DeepSeek V4.1 Flash)
- **Status:** in progress

## Goal

In the **Techs & Social policy** panel a player can read every social policy
card — its picture, its printed text and its flipside — before choosing one,
through the same `?` reference the Government column already offers. The
dropdown keeps showing names only, and a chosen policy's own picture still
appears only once it has been chosen.

The same dropdown also stops offering a card the engine would reject: a policy
already held, or one whose flipside is already held, is greyed out and carries
the reason, so it cannot be chosen again and the rejection is visible before the
click rather than only as an error afterwards.

## Why

Issue #101, quoted exactly:

> Would be nice to get the same ? and pictures and text of social policies as we
> have with government so that users can read what the social policies are
> before choosing it. Only when they choose the actual image appears

Government got a `?` help button and a card-reference modal in issue #43;
social policy was deliberately left as a bare dropdown. Asking the human which
shape they wanted, they chose the reference card **with the flipside shown**.

The human then added a second request, quoted exactly:

> dersom man velger en policy og en annen SP som er baksiden (...) så skal du gi
> en feilmelding, i tillegg til at det rett og slett ikke skal være mulig å
> velge denne policien. Den bør være grået ut fra kombo boksen

So the dropdown greys out what the engine will reject. The rule is the old
backend's, not a new one: `PlayerAction.chooseSocialPolicy` (Java) throws
`BAD_REQUEST` when the chosen policy's `flipside` is already in the player's
hand, and returns null for a policy chosen twice;
`SOCIAL_POLICY_FLIPSIDE_TAKEN` / `SOCIAL_POLICY_ALREADY_CHOSEN` are the port.

## Scope

**In:**

- A `?` button beside the "choose a card" dropdown in the social policy section
  of `TechPanel`, opening a modal with all eight social policy cards: picture,
  name, printed text and flipside name.
- Grey out (and refuse selection of) a policy the player already holds, and one
  whose flipside the player already holds, each with the reason shown, plus a
  short message naming which cards cannot be chosen and why.
- Generalise the government reference into shared pieces so both references use
  one implementation and one set of styles.

**Out:**

- Any engine, server, data or API change. The catalogue is already public
  through `GET /api/games/:id/socialpolicies` (which `TechPanel` already calls
  for the dropdown), and the text is `SocialPolicyItem.description` — the
  `SOCIAL_POLICY` sheet's own description column. Nothing new reaches a client.
- Enforcing the card effects. They are a player aid; the engine already records
  a chosen policy without applying it, and the flipside restriction is already
  enforced by `chooseSocialPolicy`.
- Changing the dropdown's contents (names only) or the chosen-card list. The
  issue's "only when they choose the actual image appears" is exactly today's
  behaviour for the chosen list and is kept.
- Modelling social policies as board or deck items, or a new route.

## Reference

The old system has no social-policy UI: players tracked policies in the
per-game Google Sheet embedded by `old-civ-web/app/views/partials/asset.html`,
and social policies were chosen through the Java `PlayerAction`. There is
therefore no old screen to reproduce — this is a presentational addition and it
invents no rule. The card text is the spreadsheet's, read by
`packages/engine/src/gamedata.ts` (`SOCIAL_POLICY`, column B) and already on
`SocialPolicyItem.description`.

The flipside rule comes from `PlayerAction.chooseSocialPolicy`
(`old-civ-rest/.../action/PlayerAction.java`): it rejects a policy whose
`flipside` equals a name the player already holds, and its test
`chooseSocialPolicyThenFlipside` chooses `Rationalism` and expects `Patronage`
to be refused. The check is **directional** — only the candidate's own
`flipside` is compared — and the client must mirror that exact comparison, not
a symmetric "same pair" one: `Military Tradition` points at `Patronage` while
`Patronage` points at `Rationalism`, so the engine allows `Patronage` after
`Military Tradition` but not the reverse. Greying out anything the engine would
accept would be inventing a rule.

The pattern to mirror is the government reference in
`packages/web/src/views/StatusPanel.tsx` (issue #43/governments).

## Approach

- New `ReferenceDialog.tsx`: the modal shell — backdrop, `role="dialog"`,
  `aria-modal`, heading with a Close button, the Tab focus trap and
  Escape-to-close, and focus returning to the trigger when it unmounts. It is
  parameterised by `titleId`, `title`, `onClose`, `returnFocusTo` and children.
- New `ReferenceCard.tsx`: one reference card — optional artwork, centred name
  and the caller's text paragraphs.
- `StatusPanel.tsx` composes both for the government reference, dropping its
  inline modal and its two focus effects. The card/grid/shell CSS is renamed
  from `government-*` to generic `reference-*`, and the round help button from
  `government-help` to `help-button`, since both references now use it.
- `TechPanel.tsx` composes both for social policy: `showPolicyReference` state,
  a ref for the `?`, and the fetched `policies` list rendered with
  `itemImageUrl()` (the engine's own file-name rule) plus `description` and
  `flipside`.
- `TechPanel.tsx` also computes, from the viewer's own `socialPolicies`, which
  options the engine would reject — the same name, or the candidate's
  `flipside` — greys those `<option>`s out with the reason appended, disables
  the Choose button for a blocked selection, and prints a short message naming
  the unavailable cards. A blocked pick that somehow reaches the API still
  surfaces the engine's message through `run`, unchanged.

## Claimed paths

- `packages/web/src/views/ReferenceDialog.tsx` (new)
- `packages/web/src/views/ReferenceCard.tsx` (new)
- `packages/web/src/views/TechPanel.tsx`
- `packages/web/src/views/TechPanel.test.tsx`
- `packages/web/src/views/StatusPanel.tsx`
- `packages/web/src/views/StatusPanel.test.tsx`
- `packages/web/src/styles.css`
- `docs/agents/tasks/issue-101-social-policy-reference.md`
- `docs/agents/task-board.md`
- `docs/agents/state.md`, `docs/agents/decisions.md`

## Acceptance criteria

- [x] The social policy section has a `?` button beside the dropdown; it opens
      a modal listing all eight policies with picture, name, description and
      flipside.
- [x] The dropdown still lists names only, and a chosen policy's picture still
      appears only in the chosen list.
- [x] Escape, the Close button and the backdrop all close the modal; focus
      returns to the `?`.
- [x] A spectator sees the same read-only reference.
- [x] A policy already held, and one whose own flipside is already held, is
      disabled in the dropdown with its reason, and a message names the
      unavailable cards; every other option stays selectable and choosing one
      still calls `chooseSocialPolicy`. The block matches the engine's
      directional check, including the `Military Tradition` → `Patronage`
      asymmetry.
- [x] The government reference is unchanged for the user and its existing test
      still passes, now through the shared pieces.
- [x] Hidden information: the reference renders the already-public catalogue
      only. A web test asserts the eight names/descriptions/flipsides come from
      the fetched `socialPolicies`, and the panel never gains an opponent's
      chosen or hidden policy.
- [x] `pnpm -r typecheck && pnpm -r test && pnpm -r build` all pass
      (449 engine, 173 server, 120 web).
- [x] Verified in the browser against a local server on a private port: the
      dropdown listed all eight policies; choosing `Rationalism` put its card in
      the chosen list and then greyed out `Rationalism` (already chosen) and
      `Patronage` (flipside of `Rationalism`) with the message "Patronage
      (flipside of Rationalism), Rationalism (already chosen) cannot be
      chosen."; the `?` opened a modal of all eight cards with their art loaded
      (`naturalWidth > 0`), printed text and flipside; Escape closed it and
      returned focus to the `?`; no console errors.

## Open questions

None. The human answered the one that mattered — include the flipside on each
reference card.
