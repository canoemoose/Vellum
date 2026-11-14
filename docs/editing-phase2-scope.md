# Phases 2 and 3, markup foundation and the first five tools: scope

Status: **in progress** (14 November 2026), autonomous, on `editing`. The brief is
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
- Properties strip under the toolbar while a tool or markup is selected: colour, line weight
  (points on paper), fill, opacity, dash; text size and colour. Each tool remembers its last style.
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
7. Markups on image tabs are drawn but can't be saved into the image; "Save as PDF" is left for
   later and the save says so.
8. Editing annotations that were already in the file (lifting them) waits until after phase 3;
   phase 2's lock is built and gates nothing else yet.

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

- (updated as steps land)
