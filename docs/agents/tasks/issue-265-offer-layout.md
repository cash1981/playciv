# Separate trade offers and combine actions with conversation

- **Slug:** `issue-265-offer-layout`
- **Branch:** `feat/issue-265-offer-layout`
- **Issue:** [#265](https://github.com/cash1981/playciv/issues/265)
- **Status:** in progress

## Goal

Make the conversation area usable as the player's place to understand and
complete the next action. Keep trade offers in their own collapsible section,
so offer controls cannot push over or obscure the chat/order composer. Present
assisted actions alongside the conversation, while retaining the existing
timeline and manual order history.

## Boundaries

- Trade-offer creation and lifecycle behavior remain unchanged; this slice is
  presentation and component composition only.
- Assisted action controls keep their current engine/API behavior.
- The timeline remains public and the private log remains private.
- The layout must work without horizontal overflow at narrow widths.

## Verification

Add component/layout tests for the separate trade-offer section, the combined
conversation/actions area, and the preserved offer actions. Verify the desktop
and narrow browser layouts, then run typecheck, tests and build.
