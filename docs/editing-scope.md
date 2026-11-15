# Editing, markup and reading: scope

Status: **phases 0 to 3 done and reviewed by Matt; phase 4 (measuring) is next**
(15 November 2026). The signatures back end (part of phase 5) and the OCR search spike
(phase 9) were built on side branches and are merged into `editing`, along with `main` at
0.1.4. See "Phase 0 results" below,
[editing-phase1-scope.md](editing-phase1-scope.md) and
[editing-phase2-scope.md](editing-phase2-scope.md). This
is the source of truth for the work; update it as phases land. "Matt" is the owner; "the
builder" is whoever (person or session) is doing the work from this document.

## Objective

Turn Vellum from a viewer into something you can mark up, measure, read and lightly edit in,
without losing what it's good at: speed on heavy drawings. It should also be a decent everyday
PDF reader, not only a drawing tool.

## Decisions made (Matt, 13 November 2026)

- **Markups are standard PDF annotations**, saved into the file, so Bluebeam, Acrobat and Edge
  show them and can edit the basic types. No private sidecar format.
- **Strands in scope:** markup tools, reading, measuring, page operations.
- **Stamps and signatures** are in, as part of markup (Preview-style picture signatures, not
  certificate signing).
- **Measuring reads out two ways:** at the drawing's scale (real-world size) and at paper scale
  (millimetres on the sheet).
- **Destructive edits sit behind an "unlock to edit" step** (design below).
- **Saving:** Ctrl+S overwrites the original only after a one-off confirmation for that file;
  "Save a copy" is always alongside.
- **The job:** annotating drawings for crew, measuring for Matt's own planning, and signing
  and returning documents. Not redlining for other people to act on, so the markups list and
  round-trip editing in other apps matter less than measuring, signing and how markups print.
- **Interoperability is checked against** Acrobat, Edge/Chrome and macOS Preview. No Bluebeam
  licence, so Bluebeam behaviour is untested.
- **The edit lock** is as drawn below: adding is free, changing what the file came with needs
  unlocking.
- **First five tools:** arrow, rectangle, cloud, text box, pen.
- **Order:** reading first; measuring and signatures ahead of the second cut of markup tools.
- **Form filling is in the main plan**, after signatures (sign-and-return documents have
  fields).
- **Signatures:** ask on the first save after placing one whether to bake it into the page.
- **Later phases to investigate:** OCR search on scans, place image / delete object.
- **Ruled out:** in-place paragraph editing (PDFium has no text-editing model), certificate
  signing and password protection on save (PDFium can't write either; each needs another
  library). Revisit only if asked.
- **Certified files** (14 November, phase 0 finding 2): saving markups into a file certified
  "no changes" or "form filling only" warns once, naming the certifier, then goes ahead.
- **"No commenting" permission** (14 November, finding 3): treated like a certified file, a
  warning on the first save.
- **Malformed files** (14 November, finding 1): the first-save confirmation says "This file has
  errors; saving rewrites it", and nothing more.
- Reference for feature ideas only: RonnyM82/Open-Source-PDF-Editor. It's AGPL (PyMuPDF), so
  no code can come from it.

## What PDFium can and can't do (checked against the bundled bindings)

Checked in `pdfium-render` 0.9.5's bindings and `src-tauri/pdfium/include/fpdf_annot.h`
(PDFium chromium/8138).

| Need | PDFium | Consequence |
|---|---|---|
| Draw existing annotations | Yes (`FPDF_ANNOT`, already on) | Other apps' markups already show. |
| Read annotations (type, rect, colour, border, vertices, line ends, ink, text) | Yes (`FPDFAnnot_Get*`) | Existing markups can be listed and loaded for editing. |
| Create square, circle, ink, free text, highlight, underline, strikeout, squiggly, note, stamp, link | Yes (`FPDFPage_CreateAnnot`) | |
| **Create line, polygon, polyline** | **No** (`FPDFAnnot_IsSupportedSubtype` excludes them) | No arrows, dimensions, clouds or area shapes through PDFium. |
| **Set vertices, line ends, cloud border, callout leader, measure dictionary** | **No** (only strings, rect, colour, border, flags) | Same. |
| Set a custom appearance | Yes (`FPDFAnnot_SetAP`), as a raw content string | |
| Page operations (import, delete, move, rotate, new) | Yes | |
| Add, move, remove page objects; flatten | Yes | Place image, delete object, flatten signatures. |
| Text: characters, boxes, find, links | Yes | Search, selection, text markups, clickable links. |
| Form filling | Yes (`FORM_*`, `FPDF_FFLDraw`) | Phase 6. |
| Save | `FPDF_SaveAsCopy`, full rewrite or incremental | Used only when PDFium itself changed the document (see "Two kinds of save"). |
| Identify an annotation by its object number | No (index on the page only) | The writer matches existing annotations by position in the page's `/Annots` array: PDFium's index is that position, Popups and nulls included (checked in phase 0). |
| Write encrypted files, create digital signatures | No | Ruled out above. |

**The main finding:** PDFium's annotation writer covers the document-reader types but not the
drawing ones. Half the markup set (arrow, line, polyline, polygon, cloud, callout, every
measurement) can't be created through it. So Vellum needs **its own annotation writer**.

## Architecture

### 1. Vellum owns the markup model; PDFium only renders saved files

- **Model** (`src/lib/markup/`, pure TypeScript, Vitest): each markup is a plain object in
  unrotated page points (type, geometry, style, text, author, dates, id). Hit-testing, handles,
  move/resize, snapping and the undo history are pure functions over it.
- **Live drawing:** markups being made or edited are drawn by Vellum on an overlay above the
  compositor canvas, straight from the model. Nothing is re-rendered by PDFium while you draw,
  so tiles stay valid and drawing costs nothing on a heavy page.
- **Writer** (`src-tauri/src/annot/`): on save, turns the model into annotation dictionaries
  with appearance streams and appends them to the file as a PDF **incremental update**. The
  original bytes are untouched and the save is fast whatever the file size (a 36 MB drawing
  gains a few kilobytes). This is also the gentlest thing to do to an issued drawing.
- **Library:** `lopdf` 0.47 (MIT), which reads and writes PDF objects and has an
  incremental-document mode. Verified in phase 0 (go; see "Phase 0 results").
- After a save the file is reopened on the PDFium workers and the changed pages' tiles are
  dropped, so what's on screen is what's in the file.
- **Text is laid out once, the same way in both places.** A text box wraps identically on the
  overlay and in the saved appearance only if both use the same character widths, so line
  breaking is a pure function over the built-in font's published metrics, shared by the
  overlay and the writer, not left to the canvas.
- **Scale:** a page's annotations are read on first view of that page, not all on open, and
  the overlay draws only what's in view. Opening a file must not get slower (check with the
  existing bench).

**Two kinds of save.** The "original bytes untouched" promise holds for the common case and
not for every case:

- *Append only* (markups, measurements, stamps, text markups; edits to existing annotations):
  our writer appends an incremental update. Nothing before it changes.
- *Rebuild* (page operations, flattening a signature, placing or deleting page content): PDFium
  has to rewrite the file, then our writer appends the annotations. The file is new throughout.
  The first-save confirmation should say which kind is about to happen.
- Filled form values are PDFium's change; whether they can be saved incrementally
  (`FPDF_INCREMENTAL`) rather than by a rebuild is to be checked in phase 6.

### 2. Existing annotations

On open, a page's annotations are read into the model (`FPDFAnnot_Get*`) but stay drawn by
PDFium in the tiles. When one is first selected for editing it is "lifted": hidden on the
workers (`FPDFAnnot_SetFlags`), its tiles re-rendered, and from then on drawn by the overlay.
Types Vellum understands are fully editable; anything else (3D, multimedia, another app's
private types) can be moved or deleted but not restyled. Needs a spike: how close our redraw
is to the original's appearance, particularly clouds and callouts made in other apps.

### 3. Page operations are a virtual page list

The tab holds a list of pages, each pointing at a source document and page, with an added
rotation. Reorder, delete, rotate, insert and merge edit only that list (instant, undoable).
On save, a new document is built from the list with `FPDF_ImportPagesByIndex` on one worker,
as print composition already does, then markups are appended. The tile cache key changes from
page index to source page, so reordering never re-renders.

### 4. Edit state, undo and saving

- One history per tab covering markups, page operations and content edits.
- A tab knows when it has unsaved changes: a dot on the tab, a prompt on close and on quit.
  The edit state belongs to the tab, not the viewer: it must survive `detach()`/`attach()`
  when switching tabs (one viewer serves them all).
- If the save fails (file open in another app, read-only, network drive gone), say why and
  offer "Save a copy"; never lose the edits.
- Save writes to a temporary file beside the original and renames over it, so a crash or a
  full disk never leaves half a file. If the file changed on disk since it was opened, ask.
- Images can't hold annotations: a marked-up image offers "Save as PDF" (the image on a page
  at its page size, markups as annotations).
- Printing and Save as PDF from the print dialog include unsaved markups. Print composition
  reopens its sources by path today (`compose.rs`), so it would miss them: it needs to take
  the tab's current state saved to memory instead.

### 5. The edit lock

Matt asked for destructive edits behind an unlock. Agreed design: the line is **adding versus
changing what the file came with**:

- **Always free:** adding markups, measurements, stamps and signatures; editing or deleting
  markups you added this session; searching, selecting and copying.
- **Needs "Edit document" unlocked** (a padlock in the toolbar, per tab, locked again on every
  open): deleting, reordering or permanently rotating pages; inserting pages; moving, restyling
  or deleting annotations that were already in the file; placing images into or deleting
  objects from the page content; flattening.
- Unlocking is also what makes page objects and old annotations selectable, so a stray click
  while panning can never grab part of the drawing. That's the practical gain beyond safety.
- On unlock, say so if the file is digitally signed (saving changes invalidates it) or its
  permissions ask for no modification.
- Phase 0 found that a *certified* file breaks when markups are merely added, which this lock
  treats as free, so that warning can't wait for the unlock: it comes on the first save (see
  "Decisions made"), as does the one for a "no commenting" permission.
- Nothing reaches the disk until Save in either state, and everything is undoable.

Alternative considered: no lock, with the first-save confirmation listing the destructive
changes. Rejected because it protects the file but not against accidental grabs.

## Strands

### Reading

- **Search:** Ctrl+F, the toolbar slot already reserved; hits highlighted on the page and
  listed in a sidebar tab; next/previous. Whole document, searched in the background.
- **Text selection and copy:** drag to select by character boxes, double-click a word, Ctrl+C.
  Needs a "select" tool that coexists with CAD navigation (left drag is free in CAD mode).
- **Text markups:** highlight, underline, strikethrough on a selection; sticky notes.
- **Links:** clickable web links and internal jumps.
- New backend command for a page's character boxes. Search and selection need no save path,
  so this half can ship before any editing exists.

### Markup tools

Proposed set, all standard annotation types:

| Tool | Annotation type |
|---|---|
| Arrow, line | Line |
| Rectangle, ellipse | Square, Circle |
| Polyline, polygon | PolyLine, Polygon |
| Revision cloud | Polygon with cloudy border effect |
| Text box, callout | FreeText (callout with leader) |
| Pen | Ink |
| Highlighter (freehand) | Ink, multiply blend |
| Stamp, signature | Stamp |

- **Style:** colour, line weight, fill, opacity, dash, arrowheads; text size and colour. A
  properties strip appears when a tool or markup is selected, and each tool remembers its last
  style.
- **Text font:** one built-in sans (Helvetica, a standard PDF font needing no embedding) to
  start. Other fonts and non-Latin text need font embedding: later.
- **Markups list:** a sidebar tab listing markups by page (type, text, author, date), click to
  jump, delete. No statuses, replies or filters to start; that's Bluebeam's territory and can
  wait for a reason.
- **Standard editing:** select, multi-select, move, resize, rotate where the type allows,
  copy/paste, delete, nudge with arrows, Shift to constrain.

### Stamps and signatures

- **Signature capture:** draw with mouse or pen, or import a photo or scan with the paper
  knocked out to transparent. No live webcam capture.
- **Library:** stored in the user's profile, encrypted with Windows' per-user data protection
  (DPAPI) so another account on the machine can't read it.
- **Placing:** as a Stamp annotation, movable until saved. On the first save after placing a
  signature, Vellum **asks** whether to bake it into the page (it can't then be moved or
  lifted off) or keep it movable. Stamps stay as annotations.
- **Stamps:** a small built-in set of text stamps (APPROVED, FOR COMMENT, SUPERSEDED, with
  optional name and date), plus your own from an image or PDF.

### Measuring

- **Tools:** length, polyline length, area and perimeter, angle. Later: count.
- **Two readouts for every measurement:** real-world at the drawing's scale (the scale Vellum
  already detects or you set) and on paper in millimetres. The label shows the first; both
  show in the status bar and the markups list.
- **Calibrate:** click two points, type the real distance; sets the tab's scale. Per-page
  scales for sets that mix them.
- **Saved** as Line / PolyLine / Polygon annotations carrying the standard measure dictionary,
  so other apps show the dimension and its value. Editable as live dimensions only in Vellum.
- **Snapping:** first cut is free-hand picking with Shift for horizontal/vertical and a zoomed
  loupe for precision. Snapping to the drawing's own endpoints and intersections is a separate
  later piece: it means reading every path on the page (74,000 on the stage plan) into a
  spatial index, and it deserves its own measurement.

### Page operations

From the thumbnail sidebar, behind the edit lock: drag to reorder, multi-select, rotate
permanently, delete, extract to a new file, insert pages from another file, merge open tabs,
split. "Extract" is the one that doesn't need the lock (it writes a new file).

### Form filling

PDFium's form module (`FORM_*`, `FPDF_FFLDraw`), the one Chrome uses: text fields, tick boxes,
radio buttons, lists. Needs a form environment per worker, focus and keyboard routed to the
backend, and redraws of the fields as they change. Filled values save through PDFium, then
markups are appended as usual. Not behind the edit lock: filling a form is what it's for.
To check when scoped in detail: XFA forms (the build we ship has no XFA; those would show
their fallback page), and script-driven fields (no JavaScript engine in our build, so
calculated totals won't update).

### Later phases (investigate, then scope separately)

- **OCR search on scans:** Windows' built-in OCR; search only, nothing written back.
- **Place image / delete object:** drop an image into the page content, remove or cover an
  object. Behind the edit lock.
- **PDF layers:** still parked (see `docs/ui-review.md`); unaffected by this work.

## Phases

Each phase ships on its own. Order is by dependency, then by value per day of work.

0. **Spike: the writer.** Append a line, polygon, cloud, free text and measured line to the
   heavy test files by incremental update with `lopdf`; reopen in Vellum; Matt opens them in
   Acrobat, Edge and macOS Preview. Also: files with object streams and
   cross-reference streams, encrypted files, signed files, a 36 MB file's load time and
   memory, lifting an existing annotation, matching an existing annotation to its object in
   the file, and appending to an encrypted file (new strings and streams must be encrypted
   with the file's key). **Exit:** go with `lopdf`, or write down what else.
   **Done (13 November 2026): go with `lopdf`.** Everything automatable passed, and Matt
   checked the samples in Chrome, Acrobat, Foxit, PDF-XChange and Edge. macOS Preview is an
   accepted gap. See "Phase 0 results".
1. **Reading, part one:** search, text selection, copy, links. No save path needed.
   **Done (built 13 November 2026, reviewed by Matt as it went):** see
   [editing-phase1-scope.md](editing-phase1-scope.md) for what was assumed, measured and not
   verified.
2. **Foundation:** markup model, overlay, select tool, history, unsaved state, save / save a
   copy / confirm once, close prompts, crash recovery, edit lock, toolbar centre and
   properties strip. Built
   with the rectangle tool as its test case, so there is something to draw, save and reopen;
   nothing here is worth releasing until phase 3.
3. **First five markup tools:** arrow, rectangle, cloud, text box, pen.
   **Phases 2 and 3 done (built 14 November 2026; Matt reviewed the tools as they were
   built, and phase 2 has nothing to review on its own):** see
   [editing-phase2-scope.md](editing-phase2-scope.md). Not yet built from phase 2: the edit
   lock's padlock (nothing to unlock until lifting or page operations exist).
4. **Measuring** and calibration. **Next.**
5. **Stamps and signatures.** The capture side is built but stands alone (photo import,
   encrypted library, drawing pad, framing view; `npm run dev:signatures`): see
   [signatures-backend.md](signatures-backend.md). Still to do: reach it from the main
   window and place a signature on a page as a stamp.
6. **Form filling.**
7. **Remaining markup tools** (line, ellipse, polyline, polygon, callout, highlighter), the
   markups list, and **reading, part two** (text highlight, underline, strikethrough, notes).
8. **Page operations.**
9. **Later phases**, each scoped when reached. OCR search has its spike and design in
   [ocr-search-scope.md](ocr-search-scope.md); nothing is wired into the app.

## Phase 0 results (13 November 2026)

**Verdict: go with `lopdf` 0.47.** It appends annotations as an incremental update to every
kind of file we tried, keeps the original bytes identical, encrypts what it appends with the
file's own key, and costs milliseconds. The fallback (our own narrow append-only writer) isn't
needed; if `lopdf` ever regresses, its incremental path is about 200 lines we could own.

The code is in `spikes/annot-writer/` (a standalone crate, not part of the app build), with
a README on how to run it and what each sample should show. Its `writer.rs`, `appearance.rs`
and `helvetica.rs` are shaped to move to `src-tauri/src/annot/` in phase 2.

### What was tested and how

Nine markups (arrow, rectangle, cloud, text box, pen, polygon, callout, distance, area) went
onto page 1, and the last page where there is one, of the five synthetic files and of 15
variants made from them (`fixtures.py`, with qpdf and pyHanko). Each output was then checked
four ways, automatically: the original bytes are unchanged; PDFium (Vellum's DLL, Vellum's
render flags) finds every annotation by its id, with the right type and rectangle, and draws
something in each; `lopdf` reads its own output back; and a second save on top of the first
works too. qpdf (`verify.py`, no code shared with either) found no structural problem in any
of the 22 samples. The existing v0.1 release build opened and rendered six of them in bench
mode with no faults.

| Check | Result |
|---|---|
| Classic xref table, object streams + xref stream | Both work; the update uses the file's own kind of cross-reference. Hybrid files (a table plus `/XRefStm`) are handled by `lopdf` on read, but there was no way to make one, so untested. |
| Encrypted: RC4 40 and 128, AES-128, AES-256 (R6), with and without object streams, with a user password | All work. `lopdf` decrypts on load with the password and encrypts the appended strings and streams with the file's key; nothing we write appears in clear (checked). A wrong password is refused. |
| Signed (approval) and certified (DocMDP 2 and 3) | The signatures stay intact and valid for the revision they signed (pyHanko). pyHanko can't judge whether added comments are *permitted* (it says so, and treats an annotation written by its own writer the same way); that's for Acrobat (samples 14 to 16). |
| Load time and memory | The 36 MB aerial drawing: 13 to 15 ms to parse, 4 ms to write, +38 KB. The four other real drawings (1 to 62 MB): 2 to 23 ms, under 10 ms to write, +11 to 13 KB. Memory while saving is about 2.3 times the file (the bytes plus `lopdf`'s parsed copy), freed after. Read-only runs; nothing derived from the client drawings was written. |
| Matching an existing annotation to its object | PDFium's annotation index is the position in the page's `/Annots` array, counting Popups and null entries: matched 6 of 6 on a fixture built to be awkward (Popup, null, indirect array, object streams), and 8 of 8 on the aerial drawing. Page order also matches between `lopdf` and PDFium on all five real files. |
| Lifting an existing annotation | `FPDFAnnot_SetFlags(hidden)` takes effect on the next render of the *same open page*: no page reload needed, and it holds when the page is reloaded. Lifting is: set the flag on every worker's copy, drop that page's tiles. |
| Editing and deleting an existing annotation | Replacing keeps the object number (so other apps' popups and replies still point at it); deleting also removes its Popup. Checked on the fixture, classic and object-stream versions. |
| PDFium rewrites first, then our writer appends ("Two kinds of save") | Works after both a full rewrite and PDFium's own incremental save; PDFium's annotation survives. |
| Rotated page (`/Rotate 90`) | Works, once text is laid out in the reader's frame (see findings). |
| Malformed file (wrong xref offsets) | Doesn't work as an append: see findings. Works through the rebuild path. |

### Findings that change the later phases

1. **Malformed files must be rebuilt, not appended to.** `lopdf` reads a file with broken
   cross-reference data by scanning it (`xref_recovery` is set), and so does PDFium, but an
   update appended to it points back at the broken table and qpdf then can't open the file
   at all. So when `xref_recovery` is set, the save is the *rebuild* kind: PDFium rewrites the
   file, then our writer appends (sample 18). The first-save confirmation should say so. None
   of the five real drawings needed it.
2. **Certified files conflict with "adding is always free".** Adding any markup to a file
   certified with "no changes" or "form filling only" (DocMDP 1 or 2) breaks the
   certification (sample 16 shows how Acrobat reports it). The writer already reads the
   DocMDP level. The edit-lock design says adding markups needs no unlock; it needs at least
   a warning before the first save into such a file. Ordinary (approval) signatures survive:
   the signed revision stays valid and the markups show as later changes.
3. **Permissions are not enforced by `lopdf`.** A file whose permissions say "no commenting"
   (sample 13) takes our markups like any other, because the file key comes from the user
   password, which is usually empty. Whether Vellum honours the permission is Matt's call
   (open question below).
4. **The password is needed again at save time.** Encrypted files are decrypted with the same
   password PDFium was given on open, so the tab must keep it (in memory only) until it's
   closed.
5. **Text on rotated pages.** The aerial drawing is stored with `/Rotate`, so this isn't an
   edge case. Text boxes, callouts and measurement labels are laid out in the reader's frame:
   the appearance stream rotates the text by the page's rotation, and FreeText gets Acrobat's
   `/Rotate` key so it stays upright when edited there. The overlay (phase 2) must draw text
   the same way, and the shared line-breaking function wraps to the box's on-screen width.
6. **Helvetica metrics are settled.** The width table in `helvetica.rs` matches Adobe's AFM
   exactly (checked against reportlab's copy), so the shared, pure line-breaking function can
   carry the same table into TypeScript.
7. **Page coordinates.** The model is in unrotated page points, y down; the writer works in
   PDF user space, y up, from the page's CropBox (else MediaBox) origin, which isn't always
   0,0. The conversion belongs in one tested function; `Writer::page_box` gives what it needs.
8. **Load the file into `lopdf` only when saving.** Parsing is cheap enough (15 ms on the
   36 MB drawing) that nothing needs to be parsed at open, so "opening must not get slower"
   holds by construction. Reading annotations for display stays with PDFium.
9. **`lopdf`'s default features** pull in rayon and chrono. Phase 2 should try
   `default-features = false` and see what the app actually needs. Pin the minor version,
   since the writer leans on its incremental-save and encryption behaviour, and re-run the
   writer tests on any upgrade.
10. **What goes into `src-tauri/Cargo.toml` and when:** `lopdf`, in phase 2, when the writer
    moves into the app. That's one of the files the release pipeline also touches.

### Matt's check in other apps (13 November 2026)

- **Chrome:** shows every markup; can't select or edit them (its viewer doesn't edit
  annotations).
- **Acrobat, Foxit, PDF-XChange:** show every markup; moving or editing one restyles it in
  that app's own way.
- **Edge:** likewise restyles on move or edit. A callout loses its leader entirely and
  becomes a plain transparent text box; text boxes turn transparent. It treats the area as a
  measurement; the distance gets a comment icon whose comment doesn't give the value (the
  value is only in the drawing).
- **Measurements in Acrobat:** both the distance and the area are treated as dimension
  markups, so the `/Measure` dictionary works there.
- **Signatures in Acrobat:** 14 (signed) "at least one signature requires validating"; 15
  (certified, comments allowed) validity unknown because the signer can't be verified (the
  throwaway test certificate, expected) and notes that changes were made; 16 (certified, no
  comments) certification invalid. As predicted: confirms finding 2.

What it means: every app draws our appearance streams as written, so markups *look* right
everywhere until someone edits them elsewhere. On edit, each app redraws from the annotation
dictionary, so how close it stays depends on which keys that app reads. The decisions above
say round-trip editing in other apps matters less than how markups look and print, so this
is acceptable as it stands. Edge's transparent text boxes look like it reads the background
from a key other than the `/C` we write (PDF 2.0 also allows `/IC` on FreeText); untested.
**Deferred to phase 3** (Matt, 13 November 2026): when the text box and callout tools are
built, compare against a reference file whose text box, callout and distance were made in
Acrobat and edited in Edge; copy whatever keys differ, or record Edge as the limit if
Acrobat's own markups break there too.

### What phase 0 could not verify

- **Sample 19 in Acrobat:** the edits are right (old square and line replaced in place, note
  gone). It looked duplicated only because the new red arrow lines up with the edited red
  line and the new red rectangle sits beside the edited square; a sample's layout problem,
  not the writer's. All nine markups, labels, cloud scallops and callout arrowhead draw as
  written.
- **macOS Preview:** not checked (it needs an old Mac brought back to life). Accepted as a
  gap: every app tried drew our appearance streams as written, and nothing in the plan
  depends on Preview's behaviour. Check it opportunistically.
- Bluebeam (no licence).
- A hybrid-reference file (no tool here writes one) and a real encrypted or signed drawing
  (none in `test-files/`).
- Reopening in the current Vellum build on a password-protected sample (the bench can't pass
  a password; PDFium opened it fine in the spike).

## How this work runs (Matt, 13 November 2026)

- **A new session picks this up** (Opus), working from this document. It was scoped in a
  different session, so anything not written here is not known to the builder.
- **On its own branch**, not `main`. Suggested name: `editing`. Phases are committed as they
  land; nothing is pushed or merged without Matt asking.
- **Merging back makes a new version**, suggested 0.2.0 (see "Release pipeline" below for
  how the number is set and the release cut).
- **Start with phase 0** and stop at its exit for Matt's check in Acrobat, Edge and Preview
  before building on the writer.
- Read first: [ARCHITECTURE.md](../ARCHITECTURE.md), `docs/v0.1-handoff/engine.md` and
  `shell.md`, and the toolchain notes in [CLAUDE.md](../CLAUDE.md).

## Release pipeline (separate work, in parallel)

A GitHub Actions build and an in-app updater are scoped in
[release-pipeline-scope.md](release-pipeline-scope.md), built on their own branch
(`release-pipeline`) and merged to `main` first. What that means here:

- Pick up `main` once it lands, so `editing` has CI and the updater.
- It touches `tauri.conf.json`, `Cargo.toml`, `package.json`, `lib.rs`, `App.svelte`, the menu,
  About and `settings.ts` lightly. Expect small merges there.
- Its "Install and restart" closes the app through the shell, so the unsaved-changes prompt
  built in phase 2 must cover that path too.
- By then the app will be at 0.1.2 (the pipeline's two proving releases). The version at the
  merge is set with `tools/set-version.mjs` (0.2.0 suggested), and the release is cut by
  pushing a `v0.2.0` tag, which needs Matt's say-so.

## Defaults (agreed with Matt, 14 November 2026)

| Question | Assumed |
|---|---|
| Tool behaviour after drawing | Stays in the tool (CAD habit); Esc or V returns to select (left drag selects text and follows links, as phase 1 built). |
| Navigation while a tool is active | Unchanged: middle-drag pans, wheel zooms, Space+drag pans. |
| Line weights and text sizes | In points on paper, not screen pixels, so they print as drawn. |
| Author on markups | The Windows account's display name ("Matt James", not the login "matt.james"), falling back to the login; editable in settings. It's written into the file, so recipients see it. |
| Pen and touch | Pointer events work with a pen; pressure ignored (ink annotations have one width). |
| Markups when printing | Printed by default, with a toggle in the print dialog. |
| Existing annotations | Editable when unlocked; otherwise display only. |
| Autosave | None: the file is written only on Save. **Crash recovery** instead: unsaved markups are kept in Vellum's app data as you work and offered back the next time that file opens after an unexpected close. Part of phase 2. |

## Testing

The builder sets up, writes and runs the tests (Matt is new to automated testing: hand over
in plain terms what's covered, what isn't, and the one command). Plan:

- **Model** (Vitest): geometry, hit-testing, handles, history, page list, measurement maths in
  both scales, search hit mapping. Pure, so fully covered.
- **Writer** (`cargo test`): write each annotation type, reopen with PDFium, read it back with
  `FPDFAnnot_Get*`, render it and compare pixels with the overlay's drawing of the same
  markup. Incremental update leaves the original bytes identical (checked byte for byte).
- **Not automatable, for Matt:** how markups look and edit in Acrobat, Edge and Preview; how
  the tools feel; pen input.
- **Phase 0 spike** (`spikes/annot-writer/`): `cargo test --release --manifest-path
  spikes/annot-writer/Cargo.toml` (appearance maths, Helvetica metrics, append, chained saves,
  replace and delete, encryption) and the `samples` command plus `verify.py` for the full
  matrix. These tests move with the writer in phase 2.

## Risks

- **`lopdf` on real files:** checked in phase 0 on all five real drawings and the fixtures:
  fine, including encryption and memory. Malformed files take the rebuild path (finding 1).
  Remaining exposure: CAD exporters we haven't seen. Fallback unchanged: a narrow
  append-only writer of our own that parses just the cross-reference table and page tree.
- **Appearance fidelity:** every viewer draws our markups from the appearance stream we write,
  so they look the same everywhere, but an app that edits one regenerates it its own way.
- **Two writers:** PDFium for page operations and flattening, ours for annotations. Kept
  apart by order: PDFium rebuilds first, annotations are appended last.
- **Overlay versus saved render:** a markup must not shift or change weight when it goes from
  overlay to tile after a save. The pixel-comparison test guards it.
- **Worker state:** each PDFium worker has its own copy of the document, so a lift or reload
  must reach all of them.

## Files in play

- New: `src/lib/markup/` (model, tools, history), `src/lib/components/` (overlay, properties
  strip, markups and search sidebar tabs), `src-tauri/src/annot/` (writer, moved from
  `spikes/annot-writer/src/` in phase 2), `src-tauri/src/` text and annotation-read commands.
- Phase 0: `spikes/annot-writer/` (standalone crate; delete it once the writer has moved).
- Changed: `src/lib/engine/input.ts` (tool routing), `src/lib/engine/viewer.ts` (overlay hook,
  page list, tile keys), `src/lib/components/Toolbar.svelte` (centre slot), `Sidebar.svelte`,
  `Thumbnails.svelte`, `src/lib/shell/tabs.ts` (unsaved state), `src-tauri/src/pdfium.rs`,
  `docs.rs`, print composition (unsaved markups).

## Open questions for Matt

None open. The first round was answered on 13 November 2026, the questions raised by phase 0
on 14 November (both under "Decisions made"), and the defaults table was agreed on 14
November.
