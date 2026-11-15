# Phase 4, measuring and calibration: scope

Status: **scoped 15 November 2026, not started.** One session, in its own worktree, branch
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

- Real-world lengths: metres with two decimals from 1 m up, whole millimetres below.
  Areas: m² with two decimals. Angles: degrees with one decimal. Paper: mm with one decimal.
- A setting for units (automatic, always mm, always m) and decimals. Pure formatting
  function, tested.

### Picking points accurately

- Navigation keeps working mid-measurement (wheel zoom, middle-drag pan, Space-drag), so
  zooming in on each end is the main way to be precise. Verify this holds for every gesture.
- Shift constrains to 15 degree steps (existing behaviour), which gives horizontal and
  vertical.
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

1. Metric only. Imperial (feet and inches) is left out until asked for.
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
