# Vellum v0.1: the first real app

**Status (26 November 2026): the brief v0.1 was built from, kept as a record.** It is not how the
app is now (the accent, for one, became a fixed teal): see [ARCHITECTURE.md](../ARCHITECTURE.md).

**Mode:** autonomous, overnight, several workers in parallel. Nobody is at the keyboard. Make
decisions, record them, keep going. Batch questions into the final report.

**Goal:** turn the phase 0 spike into the first usable version of Vellum: a fast PDF and image
viewer for Windows with CAD navigation, the shell in the mockups, and printing including manual
sheet layout. Markup, measurement and search are **not** in v0.1; the mockups show them, and
section 4 says exactly what to leave out.

Read first, in this order: [CLAUDE.md](../CLAUDE.md), [ARCHITECTURE.md](../ARCHITECTURE.md),
[RESULTS.md](../RESULTS.md), the phase 0 brief [vellum-scope-spike.md](vellum-scope-spike.md)
(section 1 describes the product), then the mockups.

## 1. The mockups

`docs/mockups/` holds four screens, each as a PNG render and as HTML source under
`docs/mockups/project/` (the source is the truth for colours, sizes and spacing; read it):

| Screen | Files | Size |
|---|---|---|
| Viewer, dark theme, File menu open | `Main.png`, `project/Main.dc.html` | 1440 × 900 |
| Viewer, light theme | `Light.png`, `project/Light.dc.html` | 1440 × 900 |
| Print dialog | `Print.png`, `project/Print.dc.html` | 1080 × 780 |
| Print, manual layout | `PrintManual.png`, `project/PrintManual.dc.html` | 1240 × 800 |

`docs/mockups/static/` has the same four screens as plain HTML that opens in any browser (the
template holes filled in, theme and accent fixed), handy for measuring against. The PNG of the
print dialog cuts off below the Layout section; the Paper, Content and Advanced sections are in
the source.

Where a mockup and this brief disagree on *what* a control does, this brief wins; on *how it
looks*, the mockup wins. The mockups show v0.2 features too (markup tools, comment popover,
Markups sidebar tab, PDF layers, Save). Section 4 lists what to leave out; leave the space
clean rather than shipping dead buttons.

**Tokens.** Both themes are in the mockups' `<style>` blocks. Dark is the phase 0 set plus
`--bd-ctl #2f3136`, `--bd-input #3a3d44`, `--tx-pop #d4d6db`, `--tab-on #2a2c31`,
`--shadow rgba(0,0,0,0.45)`, `--map #e9e9e6`. Light: `--chrome #ebebe8`, `--app #f6f6f4`,
`--ctl #ffffff`, `--bd #dcdcd7`, `--bd-ctl #d6d6d0`, `--bd-strong #cfcfc8`, `--bd-input #c4c4bd`,
`--tx #1d1e21`, `--tx2 #3d3f45`, `--tx3 #5f6269`, `--tx-pop #2e3035`, `--canvas #d9d9d4`,
`--tab-on #e3e3de`, `--shadow rgba(0,0,0,0.18)`, `--map #ffffff`. The accent is a user setting
with four options: `#e5484d` (default), `#3b82f6`, `#14b8a6`, `#f59e0b`; "accent soft" is the
accent at 18% alpha (`2e`). Fonts: Inter for UI, JetBrains Mono for numbers (zoom, coordinates,
sizes), both already bundled. Filled accent buttons get a visible border (a darkened accent),
never `transparent`; it's a house rule, see the UI notes in the user's global instructions
if you have them, otherwise just do it.

## 2. Decisions already made (don't reopen)

- **PDFium is the only PDF engine.** pdf.js is removed in this phase (section 3.5). Reasons
  are in RESULTS.md. No hybrid.
- **Stack stays:** Tauri 2, Svelte 5 + TypeScript strict, Vite, Vitest, npm, Windows 11 x64
  target, must build and run on Windows 10.
- **The rendering architecture stays** as ARCHITECTURE.md describes it: one compositor canvas,
  world coordinates in points, region renders sliced into 512 px tiles, LRU cache, previews,
  two-stage zoom, the PDFium pool with spatial bands. Build on it. If the engine must change to
  support a feature, change it, keep its tests green, and update ARCHITECTURE.md in the same
  commit.
- **Navigation behaviour stays** exactly as the spike has it (CAD and Document modes, every
  binding in README.md, the wheel classifier, the 150 ms settle). Matt has tested it on a
  mouse, a precision touchpad and two machines and it is right. Don't "improve" it.
- **Custom title bar.** The mockups put document tabs and the window controls in the title
  bar, Chrome-style. So the window runs without native decorations, the title bar is HTML with
  a drag region, and minimise / maximise / close call the Tauri window API. Double-click on
  empty title bar space maximises. Windows 11 snap layouts on hover won't work on a custom
  bar; accept that and note it in the report.
- **Licence:** no AGPL. No MuPDF. PDFium (BSD), `image`, `windows` and friends (MIT/Apache)
  are fine.
- **No network, no telemetry, no auto-update** in v0.1.
- **Engine stays free of Svelte** (`src/lib/engine`, `src/lib/render`, `src/lib/view`,
  `src/lib/print/model`). Components call into it.

## 3. What v0.1 is

### 3.1 Documents
- Opens PDFs (as now) and **images** as single-page documents: JPEG, PNG, WebP, TIFF, BMP, GIF
  (first frame). HEIC is a stretch goal via Windows Imaging Component; skip it if it costs more
  than an hour and say so.
- Image page size: pixels at the image's embedded DPI (EXIF, TIFF, PNG pHYs) converted to
  points; 96 DPI when there is none. So "actual size" means what it says and printing at
  100% comes out right.
- Password-protected PDFs: prompt for the password (PDFium takes it on load), retry on a wrong one.
- Files that can't be opened show a clear message in the tab, not a blank canvas.
- **Drawing scale.** Each document has an optional scale (1:100 and so on). It drives "To
  scale" printing, the scale labels in manual layout, and the status bar's coordinates. Set it
  from Document → Drawing scale…; **auto-detect** on open by searching the page text (PDFium
  `FPDFText_*`) for a `1:NNN` pattern, preferring one near the bottom-right of the page
  (title blocks live there). The status bar shows "Scale 1:100 (from title block)" when
  detected, "Scale 1:100" when set by hand, "Scale not set" otherwise, and clicking it opens
  the dialog.

### 3.2 Shell (Main and Light mockups)
- **Title bar** (40 px, `--chrome`): Vellum mark and name at left, document tabs, a `+` tab
  button that opens the file dialog, then minimise / maximise / close at right. The active tab
  has the `--app` background and a top-rounded border; inactive tabs are plain text in `--tx3`;
  image tabs carry the small image icon. Tab titles are file names, truncated in the middle,
  full path on hover. Ctrl+Tab / Ctrl+Shift+Tab cycle, Ctrl+W closes, middle-click closes,
  drag to reorder. Dropping files on the window opens one tab per file. Opening a file that
  is already open switches to its tab. Each tab keeps its own view state.
- **Single instance.** A second launch (Explorer "Open with", double-click on an associated
  file) opens the file in the running instance as a new tab and focuses the window.
- **Menu bar** (32 px) in HTML so it follows the theme. The mockup shows File, Edit, View,
  Document, Markup, Tools, Help. v0.1 ships **File, View, Document, Help**; Edit, Markup and
  Tools are v0.2 and are not shown. Menus open on click, switch on hover while one is open,
  close on Escape or outside click, and are keyboard-navigable.
  - **File** (per mockup): New window (Ctrl+N, see section 7), Open… (Ctrl+O), Open recent ›
    (last 10, with Clear), then Export pages as images… (PNG or JPEG at a chosen DPI, page
    range, into a folder), Reveal in Explorer, then Print… (Ctrl+P), Document properties
    (Ctrl+D: file, size, pages, page sizes, PDF version, title/author/producer, drawing
    scale), then Close tab (Ctrl+W). Save and Save as… from the mockup belong to markup and
    are left out.
  - **View**: Zoom in / out, Fit page (Ctrl+0), Fit width, Actual size (Ctrl+1), zoom presets,
    Continuous / Single page, CAD / Document navigation, Sidebar (toggle), Mini map (toggle),
    Theme › Dark / Light / System, Accent › the four colours, Performance overlay (F12).
  - **Document**: Rotate view 90° clockwise / anticlockwise (view only, never the file),
    Drawing scale…, Properties (same as Ctrl+D).
  - **Help**: Keyboard shortcuts (a panel listing every binding), About (version, PDFium
    version, licences).
- **Toolbar** (48 px, wraps at narrow widths, per mockup): sidebar toggle; page group
  (previous, editable page box, "of N", next); zoom group (zoom out, zoom % in JetBrains Mono
  which opens a presets dropdown and accepts typing, zoom in, divider, Fit page, Fit width).
  The markup tools group, Search and Save on the mockup are v0.2: leave the right-hand side
  empty rather than disabled.
- **Sidebar** (196 px, collapsible, state remembered): tabs **Pages** and **Outline**; the
  Markups tab is v0.2. Pages shows thumbnails (132 px wide, number below, accent outline on the
  current page, scrolls to keep it in view), rendered through the engine at low priority so
  they never delay visible tiles, cached per document. Outline shows PDF bookmarks
  (`FPDFBookmark_*`) as a tree; click to go. On a 300-page document opening must not get slower.
- **Canvas**: as now, pages on white with the mockup's shadow, `--canvas` behind. Plus the
  **mini map** (bottom-right, 150 × 106, `--map` fill) showing the current page's preview with
  the viewport as an accent rectangle; drag the rectangle to pan; toggle in View.
- **Status bar** (28 px, `--chrome`): left, the drawing scale item from 3.1; centre, the
  navigation hint for the current mode ("Middle-drag pan · Scroll zoom at cursor · Space-drag
  pan · Double-middle-click fit"); right, cursor position in JetBrains Mono ("X 14.62  Y 8.03 m"
  in real-world units when the scale is known, else "X 312.4  Y 88.0 mm" on paper; inches as a
  setting), and the page size with its ISO name when it matches ("A1 · 841 × 594 mm").
- **Themes.** Dark, Light (tokens in section 1), System (follows `prefers-color-scheme`).
  Two token sets on `:root[data-theme]`; nothing hard-codes a colour. Pages always render on
  white.
- **Settings** persisted between launches (localStorage is fine): theme, accent, navigation
  mode, layout mode, sidebar open and width, mini map, units, recent files, print presets,
  last print settings, window size, position and maximised state (restore on launch, never
  off-screen).
- **File associations** in the installer: register Vellum as an "Open with" handler for .pdf
  and the image types, without taking over the default. Installer stays NSIS, per-user, no
  admin prompt.

### 3.3 Print dialog (Print mockup)
This is the feature that makes Vellum worth installing over Edge for this user base, and
it's the riskiest package. Prototype the printing path on the first evening before building
the UI on it.

The dialog is a 1080 × 780 modal; options on the left (430 px), live preview on the right,
footer with Save as PDF…, Save preset…, Cancel, Print.

**Must have, in the mockup's layout:**
- **Preset** row: a dropdown of named presets plus a save button. Presets store everything
  below except page range and copies.
- **Printer** (enumerated from Windows, system default preselected) and **Copies**.
- **Pages**: All N / Current / Range (text box appears, "1-3, 7") / View (what is on screen
  now, as a crop) / Marquee (drag a rectangle on the page, dialog hides while you drag).
- **Sizing**: Fit / Actual / To scale / Tile / Manual (opens 3.4). "Fit to" dropdown: printable
  area or full paper. An info line computes what Fit means in scale terms when the drawing
  scale is known ("A1 on A3 prints at 1:206. Choose 'To scale' for exactly 1:200."). To scale
  takes a ratio (presets 1:1 to 1:1000 plus custom). Tile prints a large page across several
  sheets with an overlap (mm) and cut marks.
- **Colour**: Colour / Greyscale / Black lines. Greyscale is PDFium's `FPDF_GRAYSCALE`; Black
  lines thresholds the rasterised sheet so every non-white mark prints solid black (what you
  want for site copies of CAD drawings).
- **Layout** section: pages per sheet (1, 2, 4, 6, 9, 16) and order; margins (printer minimum /
  none / custom mm); Centre on sheet; Auto-rotate each page; Page borders; Special: None /
  Tile with overlap and cut marks (Booklet is v0.2, leave it out of the list).
- **Paper** section: paper size and orientation from the printer's capabilities; "Choose tray
  by PDF page size" and "Shrink oversized pages only" for mixed-size sets; Two-sided (off,
  long edge, short edge) when the driver supports it; Collate; Reverse order.
- **Advanced** section: Send as Image 300 dpi / Image 600 dpi / Vector (see mechanism; Vector
  appears only if the vector path works); Printer properties… opens the driver's own dialog.
  "Thicken hairlines" is v0.2, leave it out.
- **Content** section: only the **Margin stamp** (file name, page, date, in the sheet margin)
  ships in v0.1. Markups, comment pins, form fields, comment summary and PDF layers are v0.2;
  leave the section out if the stamp is its only row, or keep the row inline.
- **Preview**: the sheet as it will print, printable area as a red dashed outline, sheet
  n of N with previous/next, legend. Updates live.
- **Save as PDF…** writes the composed output instead of printing.

**Mechanism.** Compose the output as a PDF with PDFium: a new document, each placed page
imported as a form XObject (`FPDF_NewXObjectFromPage` + `FPDF_NewFormObjectFromXObject`) with
a transform and clip, images as image objects, the stamp as text. That keeps vectors as
vectors and gives Save as PDF for free. Then print the composed PDF by rendering each sheet at
the printer's resolution in bands and sending them through GDI (`StartDoc` / `StartPage` /
`StretchDIBits`, via the `windows` crate), which works with every driver; this is "Image
300/600 dpi". `FPDF_RenderPage` to the printer DC is the vector path: try it, offer it as
"Vector" if it works, don't depend on it. Printer enumeration, paper sizes, duplex and tray
capabilities come from `EnumPrinters` / `DeviceCapabilities` / `DocumentProperties`.

**Verification without a printer:** "Microsoft Print to PDF" is on every Windows machine.
Print to it, open the output through PDFium, and check page count, page size and where the
content landed (render it and compare bounding boxes). Write that as an integration test that
runs from `npm test` when the printer exists and skips cleanly when it doesn't.

### 3.4 Manual print layout (PrintManual mockup)
A 1240 × 800 screen reached from Sizing → Manual, with a back arrow to the print dialog.
Left panel: Sheet size, Margins, Snap (to margins, to other pages, to a 5 mm grid), Align and
distribute (left, centres, tops, distribute horizontally), Auto-arrange this sheet, Duplicate
sheet, Clear sheet, and the hint "Middle-drag pans and scroll zooms here too. Drag a page edge
to crop; drag a corner to scale." Centre: sheet tabs (Sheet 1, Sheet 2, +) with "420 × 297 mm ·
3 items" at right, the sheet itself with the printable area dashed, items with accent selection
handles, a scale badge on each ("p3 · 1:200", "p7 · 48%", "p9 crop · 1:20"), snap guides, the
margin stamp; below, a page strip: "Add PDF or image" (also accepts drops from Explorer), then
every page of every open document and any image, with a dot on the ones already placed. Right
panel, the inspector for the selected item: source and scale description, Scale dropdown (ratio
or percent), X / Y in mm, Size, Rotate (0/90/180/270), Crop to a region of the page… and Reset
crop, Border and Scale label toggles, Remove from sheet. Footer: Save as PDF…, status ("2
sheets · Office laser (A3) · black lines"), Cancel, Print N sheets. "Save layout with PDF" and
"Include markups" are v0.2.

- The sheet editor reuses the engine's view maths for pan and zoom and renders items through
  the same tile pipeline (an item is a page at a scale with a crop rect: exactly a region
  render).
- The layout model (sheets, items, placement, scale, crop, rotation, snapping, alignment,
  auto-arrange) is a **pure TypeScript module under `src/lib/print/model/` with exhaustive
  tests**. The UI is thin over it, and the Rust composer takes its output.
- Layouts can be saved and loaded as JSON (File → Save layout… / Open layout…) so a recurring
  site set doesn't have to be rebuilt.

### 3.5 Engine work
- **Progressive first paint.** The PDFium pool finishes bands at different times; today a
  region waits for the slowest. Stream each band's pixels to the front end as it lands (a Tauri
  channel carrying raw bytes) so the drawing fills in from one edge. On the aerial test file
  the first band lands in about a third of a second instead of the page appearing at 2.4 s.
- **Multiple open documents** in the PDFium backend: `doc_open` returns a document id, render
  and close take it, each worker keeps a map of open documents and their parsed pages, closing
  a tab frees them. The front-end `Renderer` interface gets the same id.
- **Image documents** behind the same `Renderer` interface, decoded and resampled in Rust so
  huge scans never cross IPC in full: open decodes once (the `image` crate), keeps RGBA in
  memory with a two-level mip (full and quarter size), and `renderRegion` crops and resamples
  (`fast_image_resize`) exactly as the PDFium path does. Memory ceiling: an image over 120
  megapixels is opened at half resolution with a note in the tab.
- **Text access** for scale detection and document properties: `FPDFText_LoadPage` /
  `FPDFText_GetText` behind a `doc_page_text(docId, page)` command, and bookmarks behind
  `doc_outline(docId)`. Keep them on the worker threads like everything else.
- **Remove pdf.js:** `pdfjsRenderer.ts`, the `pdfjs-dist` dependency, `tools/copy-pdfjs-assets.mjs`,
  the postinstall hook, `public/pdfjs`, the `--renderer` flag and the Ctrl+Shift+R toggle. The
  fallback when `pdfium.dll` is missing becomes a clear error with the fetch instruction.
- **Tests the spike lacks:** the viewer scheduler (plan/pump/settle/measure) against a stub
  renderer with fake timers, the tile-region grouping edge cases, and in Rust the band
  splitting pulled out into a pure function (strip rects and buffer offsets) with unit tests,
  because an off-by-one there corrupts memory rather than drawing a seam.
- **Image level of detail, time-boxed prototype (one worker, one evening, behind
  `VELLUM_IMAGE_LOD=1`).** The aerial test file decodes 837 megapixels of JPEG to draw an
  81-pixel-tall strip. Approach to try: on page load, for image-heavy pages, read each image's
  raw JPEG (`FPDFImageObj_GetImageDataRaw`), decode at 1/8 with DCT scaling (libjpeg-turbo via
  the `mozjpeg-sys` or `turbojpeg` crate, whichever builds on this toolchain), and swap it in
  with `FPDFImageObj_SetBitmap` on a second copy of the page used for zooms below a threshold.
  Measure first page, fit settle and memory with the bench. If it works, leave it on by
  default; if not, leave the code behind the flag and write up why. Either way, numbers in the
  report. Don't let this package block anything else.

## 4. Out of scope for v0.1 (v0.2 candidates: don't start them, don't show them)
From the mockups: the markup tools group (Select, Highlight, Text, Pen, Shape, Measure,
Comment, Sign), the comment popover, the Markups sidebar tab, Search, Save / Save as, the
Edit, Markup and Tools menus, Booklet, Thicken hairlines, PDF layers, form fields, comment
pins and summary, "Save layout with PDF", "Include markups". Also: text selection, HEIC beyond
the stretch goal, auto-update, code signing, a settings dialog beyond View's items, mobile.

## 5. Work packages and ownership

Each package is one worker in its own git worktree on its own branch. Packages own files;
nobody edits another package's files. Shared files have one owner and the others send
requests through the integrator. Model: Opus for every worker; the integrator may be Opus too.

| Package | Branch | Owns | Depends on |
|---|---|---|---|
| **WP-Engine** | `v0.1/engine` | `src/lib/engine/**`, `src/lib/render/**`, `src/lib/view/**`, `src-tauri/src/pdfium.rs`, `src-tauri/src/lib.rs` (commands), `tools/`, ARCHITECTURE.md | nothing; delivers the document-id interface first (section 6) |
| **WP-Shell** | `v0.1/shell` | `src/App.svelte`, `src/lib/components/**` (except `print/`), `src/lib/settings.ts`, `src/lib/platform.ts`, `src/app.css`, themes, title bar, menus, tabs, sidebar, mini map, status bar, dialogs, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/**`, single-instance plugin, window commands | WP-Engine's document-id interface (code against section 6 from the start; stub until it lands) |
| **WP-Images** | `v0.1/images` | `src-tauri/src/imagedoc.rs`, `src/lib/render/imageRenderer.ts`, image file associations list | the `Renderer` interface; nothing else |
| **WP-Print** | `v0.1/print` | `src-tauri/src/print/**` (compose, GDI, printer enumeration), `src/lib/print/**` (layout model, pure, tested), `src/lib/components/print/**` (dialog, manual layout screen) | Shell's menu hook and the document-id interface; works standalone against a fixture PDF until then |
| **WP-LOD** | `v0.1/lod` | a new `src-tauri/src/pdfium_lod.rs` plus a small hook in `pdfium.rs` agreed with WP-Engine | WP-Engine; starts after WP-Engine's document-id change is merged |
| **Integrator** | `main` | merges, runs the whole test suite and the bench, smoke-runs the app, writes the report | everything |

Order of the night:
1. WP-Engine lands the document-id interface, text/outline commands and the pdf.js removal
   first (small, unblocks everyone), then progressive paint and tests.
2. WP-Shell, WP-Images and WP-Print start at once. WP-Print spends its first hours proving
   compose → Microsoft Print to PDF → check, before any dialog work.
3. WP-LOD starts once step 1 is merged.
4. Integrator merges in the order Engine, Images, Shell, Print, LOD, resolving conflicts in
   favour of the owner, runs everything, builds the installer, writes the report.

A package that finishes early picks up items from section 7 in its own files, or writes
tests for what it built. It does not start another package's work.

## 6. The interface everyone codes against

Agree this on the first commit of WP-Engine; the others build to it.

```ts
// src/lib/render/types.ts
export interface Renderer {
  readonly name: "pdfium" | "image";
  open(path: string, password?: string): Promise<DocInfo>;     // DocInfo gains { docId: number, kind: "pdf" | "image" }
  renderRegion(docId: number, req: RegionRequest, signal: AbortSignal): Promise<ImageBitmap[] | null>;
  // Progressive: optional per-band callback; a renderer that can't stream calls it once.
  renderRegionProgressive?(docId: number, req: RegionRequest, onBand: (b: BandBitmap) => void, signal: AbortSignal): Promise<void>;
  pageText?(docId: number, page: number): Promise<string>;
  outline?(docId: number): Promise<OutlineNode[]>;
  close(docId: number): Promise<void>;
}
```

Rust commands: `doc_open(path, password?) -> DocInfo{docId, numPages, sizes, kind, meta}`,
`doc_render(docId, region) -> bytes`, `doc_render_stream(docId, region, channel)`,
`doc_thumbnail(docId, page, maxSide) -> bytes`, `doc_page_text(docId, page) -> string`,
`doc_outline(docId) -> tree`, `doc_close(docId)`. Image documents use the same commands with
the same shapes; the backend dispatches on the document's kind. Print: `print_compose(layout)
-> composedDocId`, `print_printers()`, `print_capabilities(printer)`, `print_send(composedDocId,
printer, options)`, `print_save_pdf(composedDocId, path)`; `layout` is the JSON the pure model
emits.

Errors are strings the UI can show: "Wrong password", "Not a PDF or supported image",
"pdfium.dll not found: run `node tools/fetch-pdfium.mjs`".

## 7. Nice-to-haves if time allows (in this order)
1. Persistent preview cache on disk keyed by file hash, so reopening a heavy drawing shows
   something at once.
2. **New window** (Ctrl+N): a second Tauri window with its own tabs sharing the backend;
   drag a tab out to make one. Only if the multi-window plumbing is straightforward.
3. Keyboard shortcut panel searchable.
4. "Open containing folder" and "Copy path" on the tab context menu.

## 8. Quality bar

- **Tests are the worker's job, not Matt's.** Every pure module gets Vitest tests next to it.
  The print layout model (placement, scaling, snapping, alignment, auto-arrange, tiling
  maths) is pure and tested exhaustively; the GDI code is thin. Rust: `cargo test` covers the
  band splitting, image document geometry, print composition page maths. `npm test` and
  `cargo test` must pass on every branch before it is offered to the integrator.
- **Run the app, don't trust the build.** Before offering a branch, launch the release exe and
  open `test-files/projectlayoutmarch2021.pdf`, `test-files/Stage Plan Plenary &
  Breakout.pdf`, the synthetic set (`npm run gen:synthetic`), and an image. A green build has
  shipped a startup crash before.
- **Performance must not regress.** The integrator runs `npm run bench -- --runs 3 --renderer
  pdfium --pdfium-threads 8` at the end and compares with RESULTS.md. First page and settle
  figures may improve; they may not get worse by more than 10%. Progressive paint changes
  what "first page" means: record both "first band visible" and "all visible tiles sharp".
- **UK English** in UI text, docs, comments and commits. Log and console strings ASCII only.
  Em-dashes sparingly in UI copy; the mockups' "Print — Hall 3" style title is fine.
- **Commits:** imperative mood, sentence case, no trailing full stop, no prefix, split by
  concern. Never commit something known broken. **Never push.** Branches stay local; Matt
  pushes.
- **Dependencies:** add only what a package needs; justify each in ARCHITECTURE.md's table.
  Expected additions: `image`, `fast_image_resize`, `windows` (GDI, printing, window
  controls if Tauri's API falls short), `tauri-plugin-single-instance`, and for WP-LOD a
  libjpeg-turbo binding.
- **Docs:** ARCHITECTURE.md gets sections for the shell, images, printing and streaming;
  README.md's "Using it" table and the prerequisites stay true; CLAUDE.md's commands list
  stays true. Mark `PLAN.md` historical; the live scope file is this one and
  `docs/v0.1-report.md`.

## 9. Environment and gotchas (read these, they cost hours)

- **Toolchain.** This machine has the GNU Rust toolchain plus a portable MinGW, not MSVC. Every
  cargo or tauri command needs `source ~/.vellum-toolchain/env.sh` first (PowerShell:
  `$env:PATH = "$HOME\.vellum-toolchain\mingw64\bin;$env:PATH"`). Without it the build script
  panics in `tauri-winres` with `NotAttempted("windres")`. Leave `crate-type = ["rlib"]` alone.
- **PDFium** is loaded at runtime from `src-tauri/pdfium/bin/pdfium.dll` (fetched by
  `node tools/fetch-pdfium.mjs`, which the build runs). The pool loads renamed copies from
  `%TEMP%\vellum-pdfium\`. PDFium is not thread-safe: every call to one instance happens on
  that instance's worker thread. Keep it that way, including the new text, outline and
  compose calls.
- **The benchmark takes over the screen** (an always-on-top window for about half a minute per
  run) and summary files in `bench-output/` are overwritten per renderer tag. Only the
  integrator runs it, one run at a time, and copies the previous summaries aside first.
- **Single instance and testing.** Once the single-instance plugin is in, a second `vellum.exe`
  forwards its arguments to the first and exits. `--bench` and automated tests must bypass it
  (a flag, or a different instance key in bench mode) or every bench run after the first will
  silently do nothing.
- **Custom title bar and WebView2.** With decorations off, use `data-tauri-drag-region` on
  the empty title bar areas only, never on the tabs or buttons, or clicks there start a drag.
  Keep `zoomHotkeysEnabled: true` (it is what lets touchpad pinch reach the page).
- **Worktrees and `src-tauri/target`.** Each worktree gets its own target directory unless
  `CARGO_TARGET_DIR` points at a shared one. Use a shared one; cargo serialises builds on its
  lock, and the waiting is cheaper than five cold builds.
- **Windows file paths** with spaces and brackets exist in `test-files/`. Quote everything.
- **The 150 ms settle** and the wheel classifier are tuned by hand against real hardware.
  Don't change their constants.

## 10. The report (`docs/v0.1-report.md`)

Written by the integrator at the end, in this shape, in plain language for someone who will
read it over coffee before opening the app:

1. What was built, per package, with a screenshot of each main screen next to its mockup
   (`bench-output/` is git-ignored; put screenshots in `docs/v0.1-screenshots/`).
2. Benchmark table against RESULTS.md, same files, same columns, plus first-band-visible.
3. Assumptions made where the mockups or this brief were silent, each in one line.
4. What couldn't be verified and why (no physical printer, no HEIC codec, and so on).
5. Known problems and rough edges, honestly, most important first.
6. Questions for Matt, batched.
7. What to test first, as a short checklist he can walk through in ten minutes.

## 11. Definition of done

A fresh Windows 11 machine with nothing but the NSIS installer: install, double-click a PDF
and it opens in Vellum via "Open with"; open an image; open several files into tabs; switch
to the light theme and a different accent; the status bar shows the stage plan's scale from
its title block; print the stage plan to Microsoft Print to PDF at Fit and at 1:200 and
the output is right; tile the aerial drawing onto A3 sheets; lay two pages and an image out
on one A3 sheet by hand and Save as PDF; the aerial drawing shows its first band in under
half a second and everything after the initial load stays as snappy as the spike. `npm test`
and `cargo test` green on `main`, bench within 10% of RESULTS.md, report written.
