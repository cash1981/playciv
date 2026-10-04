# Typing jumps the cursor, and auto-refresh is hard to read

- **Slug:** `typing-cursor`
- **Branch:** `claude/pr-218-default-view-wlml28`
- **Owner:** Claude
- **Status:** done

## Goal

Writing a chat message, an order or the private log never loses the cursor or
the text typed, however slow the page is to render. The player can see at a
glance whether auto-refresh is on, also from the chat panel where they are
writing.

## Why

The human: "When writing order or chat the cursor suddenly jumps down. Its
really annoying. Not sure if it is because of auto refresh or not. ... Also it
is difficult to know if auto refresh is on or not. Can you make it more clear?"

Found in a real browser against the real editor. It is not auto-refresh.
Milkdown reports a change 200 ms after the last keystroke. The parent stores it
and passes it back as `value`. If the player typed one more character before
that value was rendered (a long timeline makes the render slow), the editor
holds newer text than `value`, and the effect in `MarkdownEditor` wrote the
stale `value` over the document: the text reverts, focus is lost and the cursor
goes. Auto-refresh only makes it likelier, because each poll is a heavy render.

## Scope

**In:**

- `MarkdownEditor`: a `value` that is an echo of what the editor itself
  reported is never written back into the editor. A real external change (a
  cleared draft after Send, a note saved from another tab) still is.
- A clear auto-refresh indicator: a switch with a state dot in the game header,
  and a status line in the chat panel.
- Tests for both.

**Out:**

- Safari does not keep the composer still when the timeline above it grows
  (no scroll anchoring). Not reproducible here, not changed.

## Acceptance criteria

- [x] Typing with pauses around 200 ms into a game with a long timeline keeps
  all the text and the focus (checked in a real browser).
- [x] A cleared draft after Send still empties the editor.
- [x] The header shows on or off with a dot and in words; the chat panel says
  it too.
