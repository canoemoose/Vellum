# Phases 2 and 3, markup foundation and the first five tools: scope

Status: **built, waiting for Matt's review** (14 November 2026), autonomous, on `editing`. The brief is
[editing-scope.md](editing-scope.md) (phases 2 and 3, "Architecture", "Decisions made", the
agreed defaults). Decisions not in the brief are under "Assumed" for Matt to correct in one pass.
Stop at the end of phase 3 for Matt's review.

## Objective

Draw an arrow, rectangle, revision cloud, text box or pen stroke on a drawing; select, move,
resize, restyle, delete, undo; save it into the file as a standard annotation (Ctrl+S, confirmed
once per file) or save a copy; never lose work (unsaved dot, prompts on close and quit, crash
recovery). Opening and viewing must not get slower.

## Design

### One geometry, in TypeScript

- **Model** (`src/lib/markup/`, pure, Vitest): a markup is a plain object in Vellum page
  coordinates (points, y down, the page as rendered with `/Rotate` applied): id, kind, geometry,
  style, text, author, dates.
- **Appearance** (`src/lib/markup/appearance.ts`, pure): turns a markup into drawing operations
  (paths, fills, text runs). The same operations draw the overlay on the canvas and become the
  annotation's appearance stream when saved, so what you draw is what other apps show. Ported
  from the phase 0 spike's Rust (`spikes/annot-writer/src/appearance.rs`), including cloud
  scallops, arrowheads, Helvetica metrics and line breaking, and upright text on rotated pages.
- **Spec** (`src/lib/markup/spec.ts`, pure): a markup becomes an annotation spec in PDF user space
  (subtype, rect, line, vertices, ink list, border, colours, opacity, text, the appearance
  stream's operators and box). The page's frame (rotation and page box, `text::PageFrame`) comes
  from a new `doc_page_frame` command.
- **Writer** (`src-tauri/src/annot/`, from the spike's `writer.rs`): plumbing only. Opens the file
  with `lopdf` (decrypting with the tab's password), applies add / replace / delete specs by
  annotation id (`/NM`), appends the update, writes a temporary file beside the original and
  renames it over. `annot_inspect` reports what the first-save confirmation needs: signed,
  certified level, permissions, malformed (`xref_recovery`), encrypted.

### On screen

- **Overlay:** the viewer gets a page painter hook; markups are drawn by the compositor on top of
  the tiles and highlights, from the appearance operations, in the view's rotation. Drawing is
  pure canvas work: nothing is rendered by PDFium while you draw.
- **After a save** the document is closed on the PDFium workers, the file replaced, the document
  reopened at the same view (`Viewer.reopen`), and this session's markups are hidden in PDFium
  (`doc_hide_annots` by id) so the overlay stays the one drawing them and they stay editable.
  The file has to be closed for the rename: PDFium holds it open.

### Tools and editing

- Tools: Select (default) and Rectangle in phase 2; Arrow, Cloud, Text box, Pen in phase 3. A tool
  stays active after drawing (agreed default); Esc or V returns to Select.
- Select: click a markup to select it (handles), Shift+click to add, drag on empty drawing for a
  marquee, drag to move, handles to resize, arrow keys to nudge (Shift for 10x), Delete, Ctrl+C /
  Ctrl+V for markups when markups are selected, Shift constrains. Text selection and links still
  work in Select where no markup is under the pointer.
- History per tab: undo / redo (Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z) over the tab's markups as
  snapshots.
- Properties bar, floating over the canvas while a tool or markup is selected: line colour and
  opacity, line weight (points on paper), line pattern, fill colour and opacity; text size and
  colour. Each tool remembers its last style. See "Properties bar" under Progress.
- Edit lock: a padlock per tab, locked on every open. Adding and editing this session's markups
  are free; editing annotations already in the file and (later) page operations need it. On
  unlock, warn if the file is signed or forbids changes.

### Saving and not losing work

- Unsaved state per tab: a dot on the tab; Save, Don't save, Cancel on closing a tab, on quitting
  (window close) and before "Install and restart".
- Ctrl+S saves into the original after a one-off confirmation per file (it says whether the save
  appends or rewrites, and warns for certified, "no commenting" and malformed files as decided);
  "Save a copy…" (Ctrl+Shift+S) writes elsewhere and keeps you on the original.
- If the file changed on disk since it was opened, ask before saving over it.
- Failure (in use, read-only, gone) says why and offers Save a copy; the edits are kept.
- Crash recovery: unsaved markups are written to `%LOCALAPPDATA%\Vellum\recovery\` a second after
  each change and deleted on save or discard; opening the file again after an unexpected close
  offers them back.
- Images can't hold annotations: markups on an image tab offer "Save as PDF" (later; see below).

## Assumed (Matt to correct)

1. "Save a copy" keeps you on the original, with your changes still unsaved there (as Acrobat's
   Save a Copy).
2. Cloud: click points and double-click (or Enter) to finish; or press and drag to draw a
   rectangular cloud in one go.
3. Text box: drag a box, or click for a default-width box; type; Esc or a click outside finishes;
   double-click a text box to edit its text.
4. Arrow: drag from tail to head; Shift snaps to 15 degree steps.
5. Default styles: red 1.5 pt lines; text 10 pt black in a box with a 1 pt red border and white
   fill. Scaled to the paper? No: points on paper, as agreed, so they look thin on A1 at fit.
6. Canvas text uses Arial, which has Helvetica's widths, so text wraps the same on screen and in
   the file.
7. Markup tools are off on image tabs (their tooltip says why): a markup there couldn't be
   saved, and "Save as PDF" for images is left for later.
8. Editing annotations that were already in the file (lifting them) waits until after phase 3.
   **The edit lock's padlock is not built yet:** with nothing to unlock (no lifting, no page
   operations), it would be a button that does nothing. It comes with the first thing it guards;
   the rule (adding and this session's markups are free) is how the tool already behaves.
9. Crash recovery offers markups back only if the file hasn't changed since (same size and
   time); otherwise the recovery record is dropped, since the markups may not fit the file.
10. "Save" in the menu is disabled while nothing is unsaved; Ctrl+S then does nothing.
11. Arrow keys nudge the selection by a screen pixel (Shift: 10).

## Files in play

New: `src/lib/markup/*`, `src/lib/engine/markupTool.ts`, components for the tool bar centre,
properties strip, save / close dialogs; `src-tauri/src/annot/*`, `src-tauri/tests/annot.rs`.
Changed: `viewer.ts` (painter hook, reopen), `input.ts`, `App.svelte`, `Toolbar.svelte`,
`TitleBar.svelte` (dot), `lib.rs`, `pdfium.rs` (hide annotations), `src-tauri/Cargo.toml` (lopdf),
settings (tool styles, confirmed files, author).

## Steps

1. Writer into `src-tauri/src/annot/`, `doc_page_frame`, `annot_inspect`, `annot_save`,
   `doc_hide_annots`; cargo tests.
2. Model, appearance, spec, history (pure, Vitest), porting the spike's geometry.
3. Viewer painter hook and reopen; markup tool (select, rectangle); input routing.
4. Save path, unsaved state and prompts, confirmation, crash recovery, edit lock, toolbar,
   properties strip.
5. Phase 3 tools: arrow, cloud, text box, pen.
6. Tests, check, release build, run it, hand over.

## Progress

- Step 1 done (b8e51eb): `src-tauri/src/annot/` (`spec.rs`, `writer.rs` from the spike,
  `commands.rs`), `lopdf ~0.47` with default features off, `tests/annot.rs` (6 tests: append
  keeps the original bytes, replace keeps the object, delete, prepare beside the file then
  rename once PDFium has closed it, changed-on-disk refused, hiding by /NM stops PDFium drawing
  it, a malformed file is rebuilt first). Found: renaming over the file works once the document
  is closed on every worker (`wait_idle`); printing flattens annotations with the print flag, so
  markups print.
- Step 2 done (09d5165): `src/lib/markup/` (`types`, `helvetica`, `ops`, `pdf`, `spec`,
  `geometry`, `history`), 18 Vitest tests. Text in page coordinates needs no rotation handling;
  `pdf.ts` carries the reading direction into user space, so it stays upright on rotated pages.
- Step 3 done (2f87893): `Viewer.setPainter`, `Viewer.reopen` (keeps tiles and previews: only
  annotations change, and ours are hidden in PDFium again before anything renders),
  `engine/markupDoc.ts`, `markupPainter.ts`, `markupTool.ts` (all five tools, select, handles,
  marquee, nudge, delete, copy and paste, text editing state), 12 Vitest tests.
- Step 4 done (241b12f, 6241bc4): markup preferences in the settings, `shell/save.ts` (wording,
  recovery key), toolbar tools, properties strip, text editor overlay, Save / Save a copy with
  the first-save confirmation, prompts on closing a tab, quitting and updating, an unsaved dot
  on tabs, crash recovery. The phase 3 tools came with step 3: they share the machinery.
- Run in the release build (215f2fd) through a throwaway DevTools script on copies of the
  synthetic A1, with `--debug`: all five tools drawn, a markup selected by clicking its edge,
  nudged and the nudge undone, Ctrl+S through the first-save question, the arrow deleted and
  saved again with no question, the close-tab question (Cancel kept the work), and a crash
  (process killed with unsaved markups) followed by the recovery question, Restore, and a save
  that added only the unsaved markup. qpdf found no problems in the saved files; the original
  bytes were kept every time; every annotation carries "Matt James" as author. No console
  errors, no panics.
- Found and fixed that way: the properties strip sat in the page layout, so showing or hiding
  it resized the canvas and, at a fit zoom, the drawing jumped under the pointer. It now floats
  over the top of the canvas.

- Properties bar, polished with Matt interactively after the run above:
  - It floats over the canvas and docks against any edge, anywhere along it, snapping to the
    middle; dragged by its 6-dot grip, which stays under the pointer. The dock is remembered
    (`markup.dock` in the settings; `shell/dock.ts`).
  - On a side it is a thin column (one swatch wide, no words) when the drawing area is tall
    enough for the largest bar (a text box's, measured from a hidden copy), otherwise a stack of
    labelled sections. Decided by the area, never by the tool, so it doesn't jump between tools.
  - Every palette has the same number of swatches and ends with a custom colour
    (`ColourPicker.svelte`: saturation and brightness, hue, hex, eyedropper).
  - Line and fill have separate opacities (Matt's choice), each a slider under its palette
    (beside it in the column). Fills are drawn only inside the line's inner edge, so a
    see-through line and fill don't overlap; on clouds the fill follows each scallop. In the
    file, `/GS0` carries both (`/CA` line, `/ca` fill) and there's no annotation-wide `/CA`.
  - Line weight is a box that drops a slider out of the bar at right angles (quarter points
    below 1 pt, halves to 4 pt, wholes to 20 pt; `markup/weight.ts`); the pattern is a box that
    drops a list of six patterns the same way (`markup/dash.ts`, `shell/popout.ts`).
  - Sliders show their value live while dragged and make one undo step when let go
    (`MarkupTool.preview`).
  - With a drawing tool active, a change restyles the shape just drawn as well as the next ones;
    picking a drawing tool clears an earlier selection, so it isn't restyled by mistake.
  - The canvas no longer takes presses on overlays (the bar, the text editor) (`input.ts`).

## Tests (for Matt)

- `npm test`: the markup model (`src/lib/markup/markup.test.ts`: drawing operations, the page
  frame at every rotation, upright text on rotated pages, specs for each kind, hit-testing,
  handles, resizing, Shift constraints, simplifying pen strokes, undo, what a save changes),
  the markup tool against a stub viewer (`engine/markupTool.test.ts`: every tool, selecting,
  moving, resizing, marquee, nudge, delete, copy and paste, text boxes, live previews, restyling
  the shape just drawn), the save wording and preferences (`shell/save.test.ts`), the
  properties bar's maths (`shell/dock.test.ts`, `shell/popout.test.ts`, `markup/weight.test.ts`,
  `markup/dash.test.ts`), and colour conversion.
- `cd src-tauri && cargo test`: `tests/annot.rs` (appending, replacing, deleting, preparing and
  renaming, changed-on-disk, hiding in PDFium, malformed files, recovery names).
- Not covered by automated tests: the Svelte components (toolbar tools, properties strip, text
  editor, dialogs) other than through the scripted run above; how anything looks.

## Known problems and gaps

1. **Markups saved in an earlier session aren't editable**: once you close and reopen a file,
   your markups are ordinary annotations drawn by PDFium. Editing them needs "lifting" (reading
   them back into the model), planned for after phase 3; so does the padlock.
2. **Edge fixes deferred** (from phase 0): text boxes turning transparent and callouts losing
   their leader when edited in Edge. Waiting for Matt's Acrobat reference file.
3. **Text**: Helvetica only, so characters outside Western European text come out as "?"; no
   bold, italic or alignment; the text box grows downwards to fit but never shrinks.
4. **The author can't be changed in the app**: the setting exists (`markup.author`) but there's
   no settings dialog to edit it yet. The account's display name is used.
5. **Rotated view while typing in a text box**: the editor is rotated with the view; not tried.
6. The update banner (release pipeline) appearing also resizes the canvas and refits a view at
   fit zoom; not changed here.
7. Tool shortcuts: only V and Esc (back to Select). Letters for each tool weren't in the brief.
8. A save reopens the document in PDFium (it has to close the file to replace it); tiles and
   previews are kept so nothing flashes, but on the heaviest drawings the first new render
   after a save waits for the page to be parsed again (about 0.7 s on the aerial drawing).

## Not verified (for Matt)

- Saved markups with separate line and fill opacity, and the dotted patterns, in Acrobat and
  Edge: written to the PDF specification but not yet opened there.
- How it all looks and feels: tool icons, the floating properties bar, handles, the text
  editor lining up with the saved text, cloud scallop size, line weights at different zooms.
- The saved markups in Acrobat, Edge and Preview (the appearance streams are built the same way
  as phase 0's samples, now from TypeScript).
- Pen input with a real pen; touch.
- Saving encrypted and signed files from the app (the writer is tested on them in phase 0 and
  `tests/annot.rs`, but not through the app).
- The quit prompt from the window's close button and "Install and restart" (the code path is
  the same as the tab prompt, which was tried).

