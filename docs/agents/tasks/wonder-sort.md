# Wonder sorting

## Why

The owner asked for wonders to be listed by level (1, 2, 3) and alphabetically
within each level. Both lists showed them in whatever order they happened to be
in: the board palette in asset-manifest order, "Wonders in play" in the order
the pieces sit on the board.

## What

1. `WONDER_LEVELS` (name to 1, 2 or 3) and `compareWonderNames` in the engine,
   next to `WONDER_DESCRIPTIONS`. Level is the era on the Wonders sheet:
   Ancient 1, Medieval 2, Modern 3.
2. The board palette's Wonders category and the "Wonders in play" panel sort
   with it.

## Decisions

- A leading "The" is ignored when sorting alphabetically, so "The Pyramids"
  files under P. The card art names already strip it.
- A name the sheet does not know sorts after the known ones.

## Out of scope

The wonder deck order and the Wonders area on the board, which are placement,
not lists.

## Done when

Typecheck, test and build pass; the palette and the panel list wonders Ancient,
then Medieval, then Modern, alphabetical within each.
