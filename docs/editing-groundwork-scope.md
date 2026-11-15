# Groundwork for phases 4, 5 and 7: scope

Status: **scoped 15 November 2026, not started.** One session, on `editing` itself, before
phases 4, 5 and 7a start. Parent: [editing-scope.md](editing-scope.md) ("Phases 4, 5 and 7: how
they run"). Read [editing-phase2-scope.md](editing-phase2-scope.md) first: it describes the
code this changes.

## Objective

Make it possible for three sessions to add markup kinds at the same time without editing the
same lines, and build the four plain shapes that both measuring and the remaining tools stand
on. No new behaviour beyond those four shapes and a grouped tool palette.

## Why this comes first

Today a markup kind is spread over `switch (m.kind)` blocks in `markup/types.ts`, `ops.ts`,
`spec.ts`, `geometry.ts` (23 places), `prefs.ts` and `engine/markupTool.ts` (37 places), and
the palette is a flat list of six buttons. Phases 4, 5 and 7 between them add about fifteen
kinds. Built in parallel on that layout they would collide in every one of those files.

## What to build

### 1. One file per kind

- `src/lib/markup/kinds/<kind>.ts`, each exporting a definition the rest of the code calls
  through: drawing operations, annotation spec, bounds, hit test, handles, dragging a handle,
  moving, default style, which properties the bar shows, and which drawing gesture makes it
  (drag between two points, drag a box, click points and finish, freehand, place at a click).
- `src/lib/markup/kinds/index.ts` is the registry: one import and one line per kind. It is
  the only file a later session edits to add a kind to the model.
- The gestures themselves stay in `markupTool.ts`, written once per gesture, not per kind.
- Move the five existing kinds across with **no change in behaviour**: every existing test
  must pass untouched. If a test has to change, that's a regression to explain, not to patch.

### 2. Grouped tool palette

**Flat when there's room, grouped when there isn't** (Matt, 15 November 2026). When the
toolbar is wide enough to hold every tool, show them all in one row, with a thin divider
between groups and no flyouts. Only when they don't all fit does the palette collapse to
groups, each a button showing its last-used tool with a flyout for the rest (press and hold,
or a small caret).

- Which layout applies is decided by the space available, measured against the full row's
  width (a hidden copy, as the properties bar does), never by which tool is active, so it
  doesn't jump while you work. Re-decided when the window or the toolbar's other contents
  change size.
- All or nothing: either every group is flat or every group is collapsed. No half-collapsed
  states to design or test.
- The groups still matter when flat: they set the order, the dividers and the shortcuts.

The groups:

| Group | Tools (this session builds those in bold) |
|---|---|
| Select | **select** |
| Lines | **arrow**, **line**, **polyline** |
| Shapes | **rectangle**, **ellipse**, **polygon**, **cloud** |
| Text | **text box**, callout, note |
| Pen | **pen**, highlighter |
| Measure | length, polyline length, area, angle, calibrate |
| Stamp | stamp, signature |

- `src/lib/markup/tools.ts`: the tool registry (id, group, label, tooltip, icon, shortcut,
  which kind and preset it makes). One line per tool; later sessions add theirs.
- Empty groups (Measure, Stamp) don't show until they have a tool.
- Letter shortcuts for every tool (known gap 7 in the phase 2 scope), listed in the
  Shortcuts dialog. Pressing a group's letter again steps through its tools.
- Flyouts reuse the properties bar's pop-out (`shell/popout.ts`, `PopChoice.svelte`) rather
  than a second mechanism.

### 3. Four plain shapes

| Tool | Annotation | Notes |
|---|---|---|
| Line | Line | The arrow kind with both ends "none": a preset, not a new kind. |
| Ellipse | Circle | Drag a box; Shift makes a circle. |
| Polyline | PolyLine | Click points, double-click or Enter to finish (the cloud's gesture). Optional line ends. |
| Polygon | Polygon | As polyline, closed, with fill. |

All four take the existing style controls (colour, weight, pattern, fill, both opacities).

### 4. Save enough to re-edit later

Add one private entry to every annotation Vellum writes: the markup's own model as JSON,
under a key with a Vellum prefix, plus the `/M` date it was written with. Other apps ignore
keys they don't know, so the file stays a standard PDF. Phase 7b uses it to bring a saved
markup back exactly as it was drawn; if another app has since changed the annotation (its
`/M` differs), the entry is ignored. Writing it now means files saved from here on are
re-editable once 7b lands. Nothing reads it yet.

### 5. Marked places for later sessions

Where a later session must touch a shared file (`App.svelte`, `PropertiesStrip.svelte`,
`src-tauri/src/annot/spec.rs`, `lib.rs`'s command list), leave a named comment block per
phase (`// Measuring`, `// Stamps`, `// Text markups`) so each adds inside its own block.

## Assumed (Matt to correct)

1. Tool groups and their membership as in the table.
2. When collapsed, a group button shows the last tool used in that group, remembered
   between runs. The collapse is all or nothing.
3. Shortcuts: V select, A arrow, L line, R rectangle, E ellipse, P polygon, C cloud, T text,
   D pen (draw), M measure, S stamp. Checked against existing shortcuts before adopting.
4. Line is a preset of arrow, so an arrow whose ends are both set to "none" and a line are
   the same thing.
5. The private re-edit entry is acceptable under "markups are standard PDF annotations": it
   adds to the standard keys, it doesn't replace any.

## Files in play

New: `src/lib/markup/kinds/*`, `src/lib/markup/tools.ts`. Changed: `markup/types.ts`,
`ops.ts`, `spec.ts`, `geometry.ts`, `prefs.ts`, `engine/markupTool.ts`,
`components/ToolPalette.svelte`, `PropertiesStrip.svelte`, `ShortcutsDialog.svelte`,
`App.svelte`, `src-tauri/src/annot/spec.rs` and `writer.rs` (the private entry).

## Steps

1. Registry and the five kinds moved; tests green with no test edits. Commit.
2. Gestures generalised in `markupTool.ts`. Commit.
3. Ellipse, polyline, polygon, line preset, with tests. Commit.
4. Tool registry, grouped palette, shortcuts. Commit.
5. Private re-edit entry in the spec and writer, with a cargo test. Commit.
6. `npm run check`, `npm test`, `cargo test`, a release build, run it: draw, save and reopen
   each of the nine tools. Update this file and hand over.

## Testing

- Vitest: each new kind's drawing operations, spec, hit test, handles and resize; the tool
  registry (every tool has a group, a unique shortcut, a kind that exists); the rule that
  picks flat or grouped from the widths; the gestures against the stub viewer.
- Cargo: an annotation written with the private entry reads back with it; PDFium still
  draws the file.
- Not automatable: how the flat row, the grouped palette and its flyouts look and feel, and
  the switch between them as the window narrows. Matt checks that.

## Done when

The nine tools draw, save and reopen in the release build; every earlier test passes
unchanged; adding a tenth kind means one new file, one registry line and one tool line.
