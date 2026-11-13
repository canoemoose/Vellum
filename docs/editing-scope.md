# Editing, markup and reading: scope

Status: **draft for review** (13 November 2026). Nothing is built. This is the source of truth
for the work; update it as phases land.

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
| Form filling | Yes (`FORM_*`, `FPDF_FFLDraw`) | Later phase. |
| Save | `FPDF_SaveAsCopy`, full rewrite or incremental | |
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
- **Candidate library:** `lopdf` (MIT), which reads and writes PDF objects and has an
  incremental-document mode. **Not yet verified** on our files; that's phase 0.
- After a save the file is reopened on the PDFium workers and the changed pages' tiles are
  dropped, so what's on screen is what's in the file.

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
- Save writes to a temporary file beside the original and renames over it, so a crash or a
  full disk never leaves half a file. If the file changed on disk since it was opened, ask.
- Images can't hold annotations: a marked-up image offers "Save as PDF" (the image on a page
  at its page size, markups as annotations).
- Printing and Save as PDF from the print dialog include unsaved markups.

### 5. The edit lock

Matt asked for destructive edits behind an unlock, "unless you have a better idea". My
proposal keeps the lock but draws the line at **adding versus changing what the file came
with**:

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
   memory, lifting an existing annotation. **Exit:** go with `lopdf`, or write down what else.
1. **Reading, part one:** search, text selection, copy, links. No save path needed.
2. **Foundation:** markup model, overlay, select tool, history, unsaved state, save / save a
   copy / confirm once, close prompts, edit lock, toolbar centre and properties strip.
3. **First five markup tools:** arrow, rectangle, cloud, text box, pen.
4. **Measuring** and calibration.
5. **Stamps and signatures.**
6. **Form filling.**
7. **Remaining markup tools** (line, ellipse, polyline, polygon, callout, highlighter), the
   markups list, and **reading, part two** (text highlight, underline, strikethrough, notes).
8. **Page operations.**
9. **Later phases**, each scoped when reached.

## How this work runs (Matt, 13 November 2026)

- **A new session picks this up** (Opus), working from this document. It was scoped in a
  different session, so anything not written here is not known to the builder.
- **On its own branch**, not `main`. Suggested name: `editing`. Phases are committed as they
  land; nothing is pushed or merged without Matt asking.
- **Merging back makes a new version.** The app is 0.1.0 today (in `package.json`,
  `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`; no git tags yet). Suggested: 0.2.0
  at the merge, bumped in all three in one commit and tagged `v0.2.0`.
- **Start with phase 0** and stop at its exit for Matt's check in Acrobat, Edge and Preview
  before building on the writer.
- Read first: [ARCHITECTURE.md](../ARCHITECTURE.md), `docs/v0.1-handoff/engine.md` and
  `shell.md`, and the toolchain notes in [CLAUDE.md](../CLAUDE.md).

## Release pipeline (candidate, not yet decided)

Matt may want a GitHub Actions build and an update mechanism pointed at it. Separate from the
editing work and independent of it: it can be built on `main` before or after the merge, and
is best kept off the `editing` branch so the two don't tangle.

- **Build:** a workflow on `windows-latest` (which has the MSVC toolchain this repo is
  documented to build with), triggered by a `v*` tag: `npm ci`, `node tools/fetch-pdfium.mjs`,
  `npm test`, `cargo test`, `npm run tauri build`, then attach the NSIS installer to a GitHub
  Release. `tauri-apps/tauri-action` does the build-and-release half.
- **Updates:** Tauri's updater plugin, pointed at the release's `latest.json`. It checks on
  start (or from Help), downloads the new installer and runs it. The installer is already
  per-user NSIS, which is what the updater expects.
- **Needs from Matt:** an updater signing key pair (generated once; the private key and its
  password go in the repository's Actions secrets, the public key in `tauri.conf.json`). This
  is Tauri's own update signature, not Windows code signing.
- **To check before building it:**
  - The print round-trip test needs "Microsoft Print to PDF" on the runner; skip it there if
    it's missing.
  - Whether the repository is public (the updater fetches releases without credentials).
  - Without a Windows code-signing certificate the installer still triggers SmartScreen on
    first download; updates through the updater don't. A certificate is a cost decision.
  - First CI build on MSVC: v0.1 was built on the GNU toolchain, so this is also the first
    proof the documented toolchain works.

## Defaults I've assumed (correct any in one pass)

| Question | Assumed |
|---|---|
| Tool behaviour after drawing | Stays in the tool (CAD habit); Esc or V returns to select. |
| Navigation while a tool is active | Unchanged: middle-drag pans, wheel zooms, Space+drag pans. |
| Line weights and text sizes | In points on paper, not screen pixels, so they print as drawn. |
| Author on markups | Windows user name, editable in settings. |
| Pen and touch | Pointer events work with a pen; pressure ignored (ink annotations have one width). |
| Markups when printing | Printed by default, with a toggle in the print dialog. |
| Existing annotations | Editable when unlocked; otherwise display only. |
| Autosave | None. |

## Testing

Mine to set up and run. Plan:

- **Model** (Vitest): geometry, hit-testing, handles, history, page list, measurement maths in
  both scales, search hit mapping. Pure, so fully covered.
- **Writer** (`cargo test`): write each annotation type, reopen with PDFium, read it back with
  `FPDFAnnot_Get*`, render it and compare pixels with the overlay's drawing of the same
  markup. Incremental update leaves the original bytes identical (checked byte for byte).
- **Not automatable, for Matt:** how markups look and edit in Acrobat, Edge and Preview; how
  the tools feel; pen input.

## Risks

- **`lopdf` on real files:** malformed-but-tolerated PDFs (CAD exporters produce plenty),
  encryption, memory on large files. Phase 0 exists to find out. Fallback: a narrow
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
  strip, markups and search sidebar tabs), `src-tauri/src/annot/` (writer), `src-tauri/src/`
  text and annotation-read commands.
- Changed: `src/lib/engine/input.ts` (tool routing), `src/lib/engine/viewer.ts` (overlay hook,
  page list, tile keys), `src/lib/components/Toolbar.svelte` (centre slot), `Sidebar.svelte`,
  `Thumbnails.svelte`, `src/lib/shell/tabs.ts` (unsaved state), `src-tauri/src/pdfium.rs`,
  `docs.rs`, print composition (unsaved markups).

## Open questions for Matt

None open: the first round was answered on 13 November 2026 and is recorded under "Decisions
made". The table of assumed defaults above is still unreviewed.
