# Groundwork for phases 4, 5 and 7: scope

Status: **built 15 November 2026** (autonomous, one session, on `editing`), ready for phases
4, 5 and 7a. Progress, what the tests cover and what isn't verified are at the end. One
session, on `editing` itself, before phases 4, 5 and 7a start. Parent: [editing-scope.md](editing-scope.md) ("Phases 4, 5 and 7: how
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
   between runs (`markup.lastInGroup` in the settings). The collapse is all or nothing.
3. **Shortcuts, changed from the scoped list: Rectangle is B (box), not R**, because R
   already rotates the view (Shift+R back). The rest as scoped: V select, A arrow, L line,
   E ellipse, P polygon, C cloud, T text box, D pen. **Polyline has no letter of its own:
   it's L pressed again** (L, L), the "press again to step through" rule, which the Measure
   (M) and Stamp (S) groups will use too. A letter is never shared across groups, and N
   and R stay the view's (a test checks both).
4. Line is a preset of arrow, so an arrow whose ends are both set to "none" and a line are
   the same thing. A selected arrow with no ends is called "Line" in the properties bar.
   The Line tool's ends are fixed (its properties bar has no Ends section); select a line
   and give it ends to make it an arrow.
5. The private re-edit entry is acceptable under "markups are standard PDF annotations": it
   adds to the standard keys, it doesn't replace any. It's one key, `/Vellum_Markup`, a
   text string holding JSON (`{ v, m, markup }`): a string at the top level of the
   annotation, so phase 7b can read it through PDFium (`FPDFAnnot_GetStringValue`), which
   can't read into a nested dictionary.
6. Clicking out a shape (polyline, polygon, and now the cloud too, since the gesture is
   shared): Shift snaps each point to 15 degrees from the last; a closed shape shows its
   closing edge as you go and finishes on a click on its first point. Both are new for the
   cloud. Dragging instead of clicking: a rectangle for polygon and cloud, a straight
   two-point line for polyline.
7. Polyline starts with no ends (the arrow keeps its open head); both take the same six
   end styles.
8. Styles are remembered per tool, not per kind, so Line and Arrow keep their own colours.
   Styles saved before this (keyed by kind) carry over, because a kind's own tool has the
   kind's name.
9. Ellipse and polygon fill inside the line's inner edge, like the rectangle and cloud.
   On a polygon's very sharp corners the inset is held to 4 line weights, as a line join
   would be; only visible with a see-through line over a fill.

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

## Progress

All six steps done, one commit each:

1. 10e36b2: the five kinds in `src/lib/markup/kinds/`, the registry in `kinds/index.ts`.
   Every existing test passed unedited.
2. d7e58a8: the gestures, once each, in `engine/markupTool.ts`.
3. 55e2832: ellipse, polyline, polygon (Line is a tool preset, step 4).
4. 70e7aef: `markup/tools.ts`, the flat-or-grouped palette, letters, the Shortcuts dialog.
5. 6115b07: the private re-edit entry, front end and writer.
6. ae2c66d: the named blocks. Then a `max` for the points gesture (an angle's three
   clicks), the release build, the run and this file.

## How it's built (for phases 4, 5 and 7)

- **A kind** is a definition (`kinds/kind.ts`, `KindDef`) in its own file: label, default
  style, which properties bar controls apply (fill, ends, text), gesture, drawing
  operations, its part of the annotation spec, bounds, hit test, grips, dragging a grip,
  moving, and optional hooks (`finish` once drawn, `settle` after a move or resize,
  `restyled`, `typed` for text typed on the canvas, `saved` for what the re-edit entry
  keeps). The kind adds its markup type to the model by declaration merging
  (`declare module "../base" { interface MarkupKinds { ... } }`), so the `Markup` union
  needs no shared edit. Registering it is one entry in `kinds/index.ts`; the type check
  fails until a declared kind is registered.
- **Kind files import only the leaf toolkits**: `base.ts` (types, styles), `draw.ts`
  (operations: paths, fitted dashes, fills inside the line, arcs, line ends, the ended
  line, text boxes), `shape.ts` (distances, box and vertex grips, dragging them, snapping,
  simplifying), `annotation.ts` (the spec type, dates, /LE, /RD), `pdf.ts`, `fonts.ts`,
  `dash.ts`. `types.ts`, `ops.ts`, `geometry.ts` and `spec.ts` keep their old exports and
  dispatch through the registry, so a kind importing them would make a cycle.
- **Gestures** (`Draw` in `kind.ts`): line, box (with an optional click for a
  default-sized one), points (open or closed, `min`, optional `max`, dragged as a box or a
  line), freehand, place (click places, drag sizes, preview follows the pointer). Tested
  with stand-in kinds for place and `max`, since no kind uses them yet.
- **A tool** is one line in `markup/tools.ts`: id, group, label, tip, icon, letter, kind,
  preset. Tool ids are what `MarkupTool.tool` holds and what styles are remembered by.
- **Named blocks** (`// Measuring`, `// Stamps`, `// Text markups`, as HTML comments in
  markup) in: `kinds/index.ts`, `tools.ts`, `App.svelte` (imports, the markup section, the
  stage's overlays), `PropertiesStrip.svelte`, `StatusBar.svelte`, `ScaleDialog.svelte`,
  `shell/scale.ts`, `settings.ts`, `markup/annotation.ts` (AnnotSpec), `markup/draw.ts`
  (the op types), `markup/pdf.ts` and `engine/markupPainter.ts` (their op loops),
  `shell/messages.ts`, `shell/save.ts`, `engine/textTool.ts`, `Sidebar.svelte`,
  `annot/spec.rs` (AnnotSpec and Appearance), `annot/writer.rs`, `annot/commands.rs`,
  `lib.rs`'s command list. Phase 5's scope names `markup/ops.ts` for the image op: the op
  types now live in `draw.ts` (ops.ts re-exports them).
- **One existing test helper changed:** `src-tauri/tests/annot.rs` built `AnnotSpec` field by
  field, so any new field broke it. `AnnotSpec` and `Appearance` now derive `Default` and the
  helper ends with `..Default::default()`. Same assertions; later phases add fields freely.

## Tests (for Matt)

One command each: `npm test` (Vitest), `cd src-tauri && cargo test` (Rust; on this machine
`source ~/.vellum-toolchain/env.sh` first), `npm run check` (types).

- Every earlier test passes, none edited (the Rust helper above aside).
- `src/lib/markup/kinds/kinds.test.ts`: every registered kind draws, saves, has a box, grips
  and moves; styles keep line ends only where a kind has them; Line is called a line and
  saves with no ends; the ellipse's curves, its fill inside the line, its Circle annotation
  and /RD, picking on its outline (inside only when filled), Shift keeping proportions;
  polyline's ends facing outwards, its PolyLine annotation, picking on segments only, Shift
  snapping a dragged point; the polyline drawing exactly what the arrow does for two
  points; polygon's closed outline, Polygon annotation and fill, the inset for either
  winding and sharp corners, Shift on the first corner.
- `src/lib/engine/markupTool.gestures.test.ts`, against the stub viewer: ellipse by drag
  and Shift circle; polyline clicked out, finished by double-click or Enter, abandoned by
  Esc, Shift snapping, too few points; a straight polyline by dragging; polygon closing on
  its first corner (and not with two); a rectangular polygon by dragging, nothing for a
  sliver; changing tool abandons a shape; the Line tool draws an arrow with no ends and
  the Arrow tool still its head; a line under 4 px makes nothing; placing at a click and
  sizing by a drag; a points kind finishing by itself at its `max`.
- `src/lib/markup/tools.test.ts`: every tool has a unique id, a known group, a letter and
  an icon; every kind has a tool and every tool's kind exists; no letter is shared across
  groups and none takes N or R; palette order and empty groups hidden; letters step
  through a shared letter; the tooltips' and Shortcuts dialog's letters; the Line preset
  winning over a remembered style; which tool a markup belongs to; the last tool per group;
  the flat-or-grouped rule.
- `src/lib/markup/reedit.test.ts`: the entry is in every spec with the version, the spec's
  own /M and the whole markup; it reads back while /M matches and is ignored otherwise.
- `src-tauri/tests/annot.rs`, new test: the entry is written beside the standard keys only
  where given, PDFium reads the whole JSON back unchanged (escapes and a degree sign
  included), and PDFium still draws the annotations.
- Not covered by automated tests: the palette component itself (only its rule is tested),
  how anything looks.

## Run in the release build

`npm run tauri build -- --no-bundle`, then the exe (`--new-instance --debug`) driven over the
DevTools protocol by a throwaway script (not in the repo), on a copy of the synthetic
`3-a3-40-pages.pdf`, as the phase 2 run was:

- Each of the nine tools picked by its letter (A, L, L again, B, E, P, C, T, D) and drawn:
  drags for arrow, line, rectangle, ellipse and pen; clicks and a double-click for the
  polyline; clicks and a click on the first corner for the polygon; clicks and Enter for the
  cloud; a click and typing for the text box. Nine markups; Esc went back to Select.
- The palette: flat with all ten buttons at full width; with the page narrowed to 760 px
  it collapsed to Select, Text and Pen plus two group buttons (Lines, Shapes), and went
  back to flat when widened. Counted from the page, not looked at.
- Ctrl+S, the first-save question, Save: the original bytes were kept and the update holds
  Line, Line, PolyLine, Square, Circle, Polygon, Polygon (the cloud), FreeText and Ink, each
  with a `/Vellum_Markup` entry.
- Reopened in a fresh instance: the file opened, nothing left in the overlay (the saved
  markups are PDFium's to draw until 7b), no console errors or warnings in either run.
- The Arrow tool drew without a head here: this machine's saved settings already had the
  arrow at no ends and 20 pt from earlier use, and the tool kept to them. The tests check
  the default arrow has its head.
- The run went through the app's own settings, so they now remember the Lines and Shapes
  groups' last tools and that the scratch copy's first save was confirmed. Harmless.

## Speed

The painter's overlay pass changed (the place preview, the registry lookups), so
`npm run bench -- --runs 3` was run before (the release exe built from 7829ca9, the last code
commit before this work) and after (this branch), on the five synthetic files only (this
worktree has no `test-files/`). Medians of three, before / after:

| File | Cold start ms | First page ms | Settle fit / 400% / 1600% ms | Peak MB |
|---|---|---|---|---|
| 1-a1-200k-lines | 643 / 640 | 331 / 331 | 162 / 108 / 111 → 158 / 101 / 239 | 1086 / 1045 |
| 2-a1-50k-text | 662 / 634 | 280 / 281 | 106 / 99 / 212 → 112 / 89 / 208 | 1183 / 1138 |
| 3-a3-40-pages | 637 / 644 | 147 / 147 | 69 / 98 / 85 → 67 / 100 / 81 | 905 / 867 |
| 4-a1-raster | 629 / 643 | 730 / 665 | 159 / 109 / 247 → 146 / 108 / 250 | 1529 / 1482 |
| 5-a4-300-pages | 627 / 621 | 114 / 97 | 47 / 87 / 84 → 51 / 86 / 81 | 774 / 850 |

Pan held 60 fps everywhere in both. No change beyond run-to-run noise, with one outlier:
the 200k-lines settle at 1600% (111 → 239 ms), which the text drawing's 1600% figure
(212 / 208) shows is that zoom's normal spread; nothing in this work touches rendering.

## Not verified (for Matt)

- **How the palette looks and feels**: the flat row with its dividers, the collapsed group
  buttons (icon plus a narrow caret), the flyout (PopChoice's list, opening downwards), press
  and hold (450 ms), and the switch as the window narrows. To try: open a PDF, narrow the
  window until the tools no longer fit, and widen it again.
- **The new icons** (line, polyline, ellipse, polygon): drawn quickly at 16 px, never seen.
- How ellipses, polylines and polygons look on screen and in Acrobat and Edge (written to
  the PDF specification; PDFium in Vellum draws them from Vellum's own appearance).
- The rubber band's closing edge for polygons and clouds, and Shift snapping while clicking
  points, by hand with a mouse.

## For the three sessions

- Free letters to take: M for Measure (repeat to step through its tools), S for Stamp, H
  for the highlighter (Pen group). A letter can't be shared across groups.
- An angle is a points kind with `min: 3, max: 3`.
- The image op (phase 5) and blend mode (phase 7) have blocks in `draw.ts`, `pdf.ts`,
  `markupPainter.ts` and `Appearance` in `spec.rs`.
- `editingMarkup()` returns any `typed` kind with `rect`, `text` and `textStyle`, so a
  callout with those fields gets the text editor for free; its `TextEditor` placement in
  `App.svelte` still assumes the box is the markup's `rect`.
- The properties bar's thin-column size is measured with a text box's controls (the
  largest). A kind with more controls than a text box needs that hidden copy changed.

