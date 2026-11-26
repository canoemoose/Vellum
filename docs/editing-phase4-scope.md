# Phase 4, measuring and calibration: scope

Status: **built 15 November 2026** (autonomous, one session) on branch
`claude/editing-measure-803243`, merged into `editing` the same day. Progress, tests, what was
assumed and what isn't verified are at the end. One session, in its own worktree, branch
`editing-measure` cut from `editing` after the groundwork
([editing-groundwork-scope.md](editing-groundwork-scope.md)) lands. Parent:
[editing-scope.md](editing-scope.md) ("Measuring", and "Phases 4, 5 and 7: how they run").

## Objective

Measure a drawing: a length, a run of lengths, an area with its perimeter, an angle. Every
measurement reads out twice, at the drawing's scale and in millimetres on the paper. Set the
scale by calibrating against a known dimension. Measurements save as standard annotations
that other apps show as dimensions.

## What exists

- Scale detection from the title block (`src-tauri/src/scale.rs`, `doc_find_scale`) and a
  per-tab scale (`shell/scale.ts`: `DocScale`, the Drawing scale dialog, remembered per file).
  One scale per document today.
- The line, polyline and polygon kinds, the click-points gesture and the kind and tool
  registries, from the groundwork.
- A working `/Measure` dictionary from the phase 0 spike
  (`spikes/annot-writer/src/writer.rs`, `measure()`): Acrobat treated both the distance and
  the area as dimension markups.

## What to build

### Tools (Measure group)

| Tool | Gesture | Saved as |
|---|---|---|
| Length | Two clicks, or drag | Line, intent `LineDimension` |
| Polyline length | Click points, double-click or Enter | PolyLine, intent `PolyLineDimension` |
| Area | Click points, closes itself | Polygon, intent `PolygonDimension`; shows area and perimeter |
| Angle | Three clicks: one arm, the corner, the other arm | PolyLine; no standard angle type, so the value is in the label and `/Contents` |
| Calibrate | Two clicks, then type the real distance | Nothing saved; sets the scale |

Each measuring kind is its own file under `src/lib/markup/kinds/`, built on the plain
shape's geometry.

### Readouts

- **On the drawing:** the real-world value, as a label on the dimension. Lengths: text along
  the line, above it, never upside down. Areas: centred in the shape. Angles: at the corner,
  with an arc.
- **In the status bar,** while drawing and when a measurement is selected: both values
  ("12.40 m at 1:100, 124.0 mm on paper"). Polyline also shows the segment under the pointer.
- **For the markups list** (phase 7): export one function giving a measurement's two values
  as text, so the list needs no measuring code of its own.
- Measurements are **live**: computed from the geometry and the page's scale whenever drawn,
  never stored as text. Move a point and the value follows.

### Scale

- **Per-page scales.** The tab keeps its document scale and adds per-page overrides. The
  status bar shows the scale of the page in view. The Drawing scale dialog gains "This page
  only".
- **Calibrate:** pick two points on a known dimension, type its real length with a unit
  ("4.2 m", "4200", "4200mm"); the ratio is real over paper. Apply to this page or to every
  page. It replaces a detected scale and is remembered per file like a hand-set one.
- **Changing the scale re-values existing measurements** on those pages (they're live), and
  says how many changed.
- **No scale set:** the tools still work and show paper millimetres, marked as such, with
  "Calibrate" and "Set scale" one click away. Never show a real-world number from a guess.
- The scale a measurement was made at is written into its `/Measure` dictionary on save.

### Units and format (metric only)

*Superseded by [the tool consistency brief](editing-tool-consistency-brief.md), stage 5: imperial units (feet and inches with
fractions, inches, decimal feet and inches, ft², architectural scales), Auto following
View > Units, and units and decimals set per measurement from the bar (no longer file-wide;
"Apply its units and decimals to all measurements" is on the right-click menu). Dimensions
are now ortho-locked, placed in three clicks with an offset, with ends and a value font of
their own, saved with /LL, /LLE, /LLO and /CO; the angle is clicked corner first.*

- Real-world lengths: metres with two decimals from 1 m up, whole millimetres below.
  Areas: m² with two decimals. Angles: degrees with one decimal. Paper: mm with one decimal.
- A setting for units (automatic, always mm, always m) and decimals. Pure formatting
  function, tested.

### Picking points accurately

- Navigation keeps working mid-measurement (wheel zoom, middle-drag pan, Space-drag), so
  zooming in on each end is the main way to be precise. Verify this holds for every gesture.
- Shift constrains to 15 degree steps (existing behaviour), which gives horizontal and
  vertical. *(Superseded: measurements now start ortho-locked and Shift frees them; tool
  consistency brief, stage 5.)*
- A loupe: a magnified inset by the pointer while picking, taken from the canvas as drawn.
  It magnifies pixels rather than re-rendering, so it helps placement but adds no detail.
- Out: snapping to the drawing's own endpoints and intersections (its own later piece, per
  the parent scope).

### Look

Dimension lines are drawn like dimensions: a thin line (0.75 pt) with a bar at each end and
the value above. Default colour blue, so measurements read apart from red markups. The
ordinary style controls still apply, plus text size.

### Saving

- `AnnotSpec` gains a measure entry (scale ratio, units, number formats) inside the
  `// Measuring` block; the writer emits `/Measure` and the `/IT` intents above.
- The appearance, label included, is drawn by Vellum, as for every markup.

## Assumed (Matt to correct)

1. Metric only. Imperial (feet and inches) is left out until asked for. *(Superseded:
   imperial was added in the tool consistency brief, stage 5.)*
2. The format rules above (m from 1 m, mm below; two decimals).
3. Measurements are blue, 0.75 pt, with bar ends, by default.
4. A measurement keeps following the page's scale; it isn't frozen at the scale it was made
   at. Re-scaling a page re-values what's on it.
5. One scale per page, the same in both directions. A drawing with different horizontal and
   vertical scales, or several viewports at different scales on one sheet, measures wrongly
   outside the calibrated view; calibrate per measurement area if needed. Per-viewport scale
   regions are not in this phase.
6. The count tool is left for later, as the parent scope says.

## To check early (may change the design)

- **Pages with a `/UserUnit`** (very large sheets use it to exceed the 200 inch page limit):
  a point on such a page isn't 1/72 inch. Confirm what `doc_page_frame` reports and that
  paper millimetres come out right; add a synthetic fixture.
- **Rotated pages:** labels upright, values unchanged at every `/Rotate`.
- **Acrobat and Edge** redraw a dimension when it's edited there (phase 0); only how ours
  looks unedited matters.

## Files in play

New: `src/lib/markup/kinds/measure*.ts`, `src/lib/markup/measure.ts` (lengths, area,
perimeter, angle, formatting; pure), `src/lib/shell/pageScale.ts` (per-page scales,
calibration maths; pure), a calibrate dialog, a loupe component. Changed, inside the
`// Measuring` blocks: `kinds/index.ts`, `tools.ts`, `App.svelte`, `StatusBar.svelte`,
`ScaleDialog.svelte`, `shell/scale.ts`, settings, `annot/spec.rs`, `annot/writer.rs`.

## Steps

1. Pure maths and formatting, with tests. Commit.
2. Per-page scales and calibration (model, dialog, status bar). Commit.
3. Length, then polyline length, area, angle: kinds, labels, status readout. Commit each.
4. `/Measure` in the spec and writer, with cargo tests. Commit.
5. Loupe. Commit.
6. The `/UserUnit` and rotation checks. Check, tests, release build, run it on the heavy
   drawings in `C:\Users\matt.james\Documents\Repos\Vellum\test-files` (read only, never
   copied into the repo). Update this file, merge `editing` in, hand over.

## Testing

- Vitest: length, polyline, area by the shoelace formula against known shapes (a 10 m
  square at 1:100, a triangle, a concave shape, a self-crossing one), perimeter, angle in
  every quadrant, formatting at the unit boundaries, parsing typed distances, calibration,
  per-page overrides, re-valuing on a scale change, label placement never upside down.
- Cargo: a saved measurement carries `/Measure` and the right intent; PDFium draws it.
- Not automatable: how dimensions look at different zooms, the loupe's feel, and the
  values as Acrobat shows them. Matt checks those; give him one saved sample file and say
  what each value should read.

## Done when

On a real drawing: calibrate against a known dimension, measure a length, a run, an area
and an angle, see both readouts, save, reopen, and the values are still right; Acrobat
shows the length and area as dimensions.

## Progress

All six steps built, one or more commits each:

1. 5e71648: `markup/measure.ts`, the pure maths and formatting.
2. 75eadc7: `shell/pageScale.ts`, per-page scales. 612b2c7: the app side (below).
3. 2d15f1e: the four measuring kinds and Calibrate, `markup/dimension.ts` (their shared
   toolkit) and `markup/measurements.ts` (their values as text, re-valuing). d705d45: two
   small additions to `engine/markupTool.ts` (see "For the merge").
4. The `/Measure` dictionary, `/Cap`, and reading `/UserUnit`: `src-tauri/src/annot/measure.rs`.
5. 612b2c7: the loupe (`components/Loupe.svelte`), with the app wiring.
6. The `/UserUnit` and rotation checks (below), release build, run, this file.

## How it's built

- **Kinds:** `kinds/measureLength.ts`, `measurePath.ts` (polyline length), `measureArea.ts`,
  `measureAngle.ts`, `measureCalibrate.ts`. Each is the points gesture (Length and Calibrate:
  `min: 2, max: 2`, so two clicks finish it, and a drag makes one too; Angle `min: 3, max: 3`).
  Shift snaps to 15 degrees as for every points tool.
- **Live values:** a measurement carries `scale` (N in 1:N, or null), `userUnit`, `fmt`
  (units, decimals) and `labelSize`. Its drawing, label and annotation are pure functions of
  the markup. While it's being drawn `scale` is undefined and its page's is looked up
  (`setMeasureSource`, set by App.svelte); `finish` writes the page's in. App.svelte keeps
  every measurement on the open tab following its page's scale and the format: when either
  changes (or an undo brings back older values) it re-values them in place, with no undo
  step of their own, and a scale change says "N measurements re-valued at the new scale".
- **Calibrate** draws like a measurement but is never kept: `MarkupTool.keep` hands the
  finished shape to App.svelte, which opens `CalibrateDialog.svelte` and keeps nothing.
- **Per-page scales** are remembered per file in `settings.measure.pageScales`, beside the
  existing hand-set document scales; the tab's `scale` stays the document's.
- **For the markups list (phase 7):** `measurementText(m)` in `markup/measurements.ts` gives
  `{ real, paper }` as text ("12.40 m at 1:100", "124.0 mm on paper"; an angle has `paper:
  null`; null for anything that isn't a measurement). `measurementLine(m)` is the status
  bar's one-line form.
- **Saved:** Length is a Line with `/IT /LineDimension`, `/LE [/Butt /Butt]`, `/Cap true`,
  `/CP /Top`; Polyline length a PolyLine with `/IT /PolyLineDimension`; Area a Polygon with
  `/IT /PolygonDimension`; each with `/Measure` (`/R` the scale as text, `/X` converting user
  space to the label's unit, `/D` and `/A` in that unit and its square) and the label's text
  in `/Contents`. Angle is a plain PolyLine with "Angle 90.0°" in `/Contents` (no standard
  angle type). The appearance, label included, is Vellum's own, as for every markup.

## Checks that could change the design

- **`/UserUnit`:** PDFium reports a `/UserUnit` page's size in its own units, ignoring the
  key (cargo test `pdfium_reports_a_user_unit_page_in_its_own_units`, a synthetic two-page
  fixture with `/UserUnit 10` on page 2), so `doc_page_frame` and the page sizes are in
  units, not points. Vellum reads each page's `/UserUnit` with `lopdf`
  (`measure_user_units`) the first time a measuring tool is picked on a PDF tab, never on
  open, and multiplies paper lengths by it; `/Measure`'s `/X` factor includes it. Covered by
  Vitest (`paperMm`, a length at `/UserUnit 10`, its `/X` factor) and cargo
  (`user_units_read_back_per_page`). Not done: the status bar's page size and cursor
  coordinates, and printing to scale, still take a unit as a point on such pages (outside
  this phase's files; a one-line follow-up each once someone has a real `/UserUnit` sheet).
- **Rotated pages:** the model is in page coordinates with `/Rotate` applied, so values
  don't change with rotation (a test saves a length on a quarter-turned page and checks its
  value and its `/L` length in user space), and labels are laid out upright in that frame,
  which is the page as you see it. View rotation (R) turns the labels with the page, as it
  does every other markup's text.
- **Acrobat and Edge** redraw a dimension when it's edited there; not checked here.

## Tests (for Matt)

One command each: `npm test`, `cd src-tauri && cargo test` (this machine: `source
~/.vellum-toolchain/env.sh` first), `npm run check`.

- `src/lib/markup/measure.test.ts`: lengths open and closed; paper and real millimetres;
  `/UserUnit`; area by the shoelace formula for a 10 m square at 1:100, a triangle either
  way round, a concave L, a self-crossing bow tie (nets to nothing and is flagged); where an
  area's label goes, inside even for a C shape; angles in every quadrant, either arm first,
  never over 180; the formatting at every unit boundary (999 mm, 999.6 mm reads 1.00 m),
  always-mm and always-m, areas, angles, paper values; reading typed distances (4.2 m, 4200,
  4200mm, 4,2m, cm, km, and the ones refused); calibration and its limits; labels never
  upside down at every 7.5 degrees.
- `src/lib/markup/kinds/measure.test.ts`: each kind's two values and label, the paper value
  marked when there's no scale, values following a moved end, the dimension's look (0.75 pt
  blue line, bars square to it), labels above the line and upright at every 15 degrees,
  each kind's annotation (subtype, intent, `/Contents`, `/Measure` with a factor that turns
  the drawn length back into the label's value), paper `/Measure` with no scale, a
  `/UserUnit` page, a rotated page, the polyline's segment readout, the area's centred label
  and crossing warning, the angle's arc and label placement, a draft taking its page's scale
  and keeping it once made, re-valuing (counts, unchanged lists left alone, cleared scale
  back to paper), re-formatting and label size.
- `src/lib/engine/markupTool.measure.test.ts`, against the stub viewer: a length by two
  clicks with the live readout, by a drag with Shift, a polyline length with the segment
  under the pointer, an area closed on its first corner, an angle by three clicks, an angle
  dragged as two points dropped, Calibrate handing over its points and keeping nothing (no
  undo step), and picking points while zooming and panning between clicks.
- `src/lib/shell/pageScale.test.ts` and `src/lib/settings.measure.test.ts`: page overrides
  over the document scale, the status bar's text, remembering per file (capped, checked on
  read), the re-valued message, the stored settings.
- `src-tauri/tests/measure.rs`: a saved Line dimension carries `/IT`, `/Cap`, `/CP` and a
  full `/Measure`, and PDFium draws it; a markup without them gets none; `/UserUnit` per page;
  PDFium's page size on a `/UserUnit` page.
- `kinds/kinds.test.ts` (the shared "every kind" checks) got a sample of each new kind.
- Not covered by automated tests: the components (CalibrateDialog, Loupe, the status bar and
  dialog additions, the properties bar section) and App.svelte's wiring, except through the
  scripted run below; how anything looks.

## Assumed in building (Matt to correct)

Beyond the six "Assumed" above, all of which were built as written:

7. **The label's text size is the measurement's own** (8 pt by default), set in a "Value"
   section of the properties bar with the units and decimals, rather than the text box's
   text style. The label is Helvetica in the line's colour.
8. **Units and decimals are one setting for every measurement** (in the properties bar
   whenever a measuring tool or measurements are out): changing them re-writes every
   measurement on the open tab, as a scale change does. Decimals apply to metres and square
   metres; millimetres are always whole, paper values always one decimal. "Always mm" writes
   areas in mm².
9. **With no scale**, the label reads the paper length marked "(paper)", the status bar
   offers "No scale: Calibrate or Set scale", and the file gets a `/Measure` of "1:1
   (paper)" in mm. No real-world number is shown from a guess.
10. **Area labels** have two lines, the area and "Perimeter 40.00 m", centred in the shape
    (for an L or C shape whose centre falls outside, in the widest part across the middle).
    A self-crossing outline is measured as the shoelace formula does (lobes net against each
    other) and the label says "Outline crosses itself".
11. **Area's fill:** off by default; the ordinary fill control applies. The fill runs under
    the line rather than inside it (the polygon's inset isn't shared: a kind can't import
    another kind).
12. **Angle:** the smaller angle (0 to 180), the arc at 40% of the shorter arm (at most
    24 pt), the label beside it outside the arc, reading across the page. Dragging with the
    Angle tool makes nothing (an angle needs three points).
13. **Calibrate** is the fifth Measure tool (M pressed five times), drawn dashed. Its dialog
    takes "4.2 m", "4200", "4200mm", "420 cm", "4,2 m"; a bare number is millimetres. Every
    page (the default) sets the document's scale, clears page overrides and is remembered
    like a hand-set scale; This page only is remembered per file too.
14. **Measurements re-value without an undo step:** undo brings back geometry, and the
    values always follow the page's current scale. "Says how many changed" is a passing
    notice in the status bar; angles aren't counted.
15. *(Since: the measuring tools are on D; see the [tool consistency brief](editing-tool-consistency-brief.md).)*
    **Letters:** M for every Measure tool, stepping Length, Polyline length, Area, Angle,
    Calibrate.
16. **The loupe** shows whenever a measuring tool is out and the pointer is over the
    drawing: 132 px round, 4x, above and right of the pointer (flipping at the edges), with
    a crosshair. It copies the canvas pixels as drawn.
17. **The status bar's real-world cursor coordinates** now use the page's own scale, not the
    document's (one expression in App.svelte, marked).

## Run in the release build

`npm run tauri build -- --no-bundle` (8 min), then the exe (`--new-instance --debug`) on a
scratch copy of the synthetic `3-a3-40-pages.pdf`, driven over the DevTools protocol by a
throwaway script (not in the repo). It ran with its own WebView2 profile
(`WEBVIEW2_USER_DATA_FOLDER` pointed at a scratch folder), so Matt's settings were not
touched; instances were stopped by process path, never by name.

- Started with "Scale not set". M five times picked Calibrate; two clicks 50 mm apart
  showed "50.0 mm on paper: click the other end" while picking; the dialog showed "Scale
  1:100" for "5 m"; applied to every page: status "Scale 1:100", no markup kept.
- The loupe appeared (132 px) on a pointer move over the stage with a measuring tool out.
- Length: live "6.00 m at 1:100, 60.0 mm on paper", made "12.40 m at 1:100, 124.0 mm on
  paper". Polyline length: live "7.00 m ..., 70.0 mm on paper; this segment 4.00 m", made
  "7.00 m". Area (100 mm square, closed on its first corner): "100.00 m², perimeter 40.00 m
  at 1:100, 10000.0 mm², perimeter 400.0 mm on paper". Angles: "90.0°", "45.0°".
- Calibrate, This page only, "2500" over the same 50 mm: "Scale 1:50 (this page)" and "3
  measurements re-valued at the new scale". Calibrate again, every page, "5000mm": back to
  "Scale 1:100", "3 measurements re-valued".
- Ctrl+S, the first-save question, Save: "Saved measured-sample.pdf". The original bytes are
  kept and the update holds the Line (`/IT /LineDimension`, `/Cap`, `/CP /Top`, "12.40 m"),
  the PolyLine (`/PolyLineDimension`, "7.00 m"), the Polygon (`/PolygonDimension`, "100.00
  m², Perimeter 40.00 m") and two PolyLines ("Angle 90.0°", "Angle 45.0°"), each dimension
  with `/Measure /R (1:100)` and `/X` 0.0352778 m per unit.
- Reopened in a fresh instance: 40 pages, "Scale 1:100" remembered, no console errors or
  warnings in either run. (The saved markups are PDFium's to draw until phase 7b.)
- Not exercised in the run: the "No scale: Calibrate or Set scale" offer (the run went
  straight to Calibrate, which hides it), the Drawing scale dialog's This page only box, the
  properties bar's Value section. Each is a few lines of wiring; check them by hand.
- **Speed:** nothing on the open path or in the painter changed (`/UserUnit` is read only
  when a measuring tool is first picked), so the benchmark wasn't run.

## Not verified (for Matt)

- **The sample for Acrobat:** `phase4-measured-sample.pdf` in the shared notes folder
  (`AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_8fec389c-cac6-4aa2-b9e7-69cf94c12dd8`),
  made from the synthetic A3 file, page 1, at 1:100. It should read: length 12.40 m (124 mm
  on paper), polyline length 7.00 m (30 mm across then 40 mm down), area 100.00 m² with
  perimeter 40.00 m (a 100 mm square), angles 90.0° and 45.0°. In Acrobat the length,
  polyline and area should be dimension markups whose values match; the angles are plain
  polylines with the value in their comment.
- **How dimensions look** at different zooms: line weight, bar length, the label's gap above
  the line, the area's two-line label, the angle's arc and label, the dashed Calibrate line.
- **The loupe's feel:** size, magnification, where it sits, whether it lags the pointer,
  whether it gets in the way near the edges.
- **The dialogs and bar additions:** the Calibrate dialog, This page only in the Drawing
  scale dialog, the status bar's readout and No scale offer, the properties bar's Value
  section (label size, units, decimals).
- **The five new tool icons** (length, polyline length, area, angle, calibrate), drawn
  quickly at 16 px and never seen.
- **A real `/UserUnit` sheet** and the heavy client drawings in `test-files` were not
  measured (the synthetic fixture covers the maths). The `/UserUnit` read loads the file
  with `lopdf` once per tab when measuring starts; on a very large file values may take a
  moment to account for it (they follow when it arrives).
- Acrobat and Edge redrawing a dimension when it's edited there.

## For the merge

Shared edits outside a `// Measuring` block, each marked `// Measuring` where it sits:

- `engine/markupTool.ts` (no block there): a public `keep` hook and `drawingShape()` in a
  new `// Measuring` block before the text box section, and one line in each of `drawUp`
  and `finishPoints` (`if (this.keep && !this.keep(m)) return this.redraw();`) just before
  the new markup is committed. Phase 7a changes the points gesture's `make` to take the draw
  context as a second argument and edits `finishPoints` too: expect a conflict there, both
  sides additive. `drawingShape()` calls `c.def.draw.make(pts)` and will want the context
  passed if 7a's argument is required.
- `markup/kinds/kinds.test.ts`: five lines in `SAMPLES` (every phase adds there).
- `components/StatusBar.svelte`: one `{:else if measure}` branch between the notice and the
  hint. `components/dialogs/ScaleDialog.svelte`: the field's starting value, the submit
  routing and the Clear button's condition. `components/PropertiesStrip.svelte`: a block at
  the end of the `body` snippet and two snippets after it.
- `App.svelte`: `untrack` added to the svelte import; `{...measureStrip}` on
  `PropertiesStrip`, `{...measureBar}` on `StatusBar`, `{...measureScaleDialog}` on
  `ScaleDialog`; the cursor label's scale.
- `settings.ts`: a new import block at the top and `sanitiseMeasure` before `loadSettings`.
- `src-tauri/src/annot/mod.rs`: `pub mod measure;`.
- **Phase 7a's markups list:** add the measuring kinds to `LIST_TEXT` in
  `src/lib/markup/listing.ts` inside its `// Measuring` comment, using `measurementText(m)`
  from `src/lib/markup/measurements.ts` (`{ real, paper }`, `paper` null for an angle).
