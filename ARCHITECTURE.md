# Vellum rendering architecture

How a PDF or image gets from disk to pixels, so later phases build on this rather than around
it. The phase 0 measurements that shaped it are in [RESULTS.md](RESULTS.md); v0.1 removed
pdf.js (PDFium is the only PDF engine) and added document ids, image documents, text access
and progressive paint.

```
 input (wheel / drag / keys)
   │
   ▼
 View  { scale, tx, ty }            src/lib/view/viewMath.ts   (pure, unit-tested)
   │  screen = world * scale + t     world = PDF points, pages stacked by layout.ts
   │
   ├──► Compositor (every frame)     src/lib/engine/viewer.ts  draw()
   │      one viewport canvas, device pixels; draws per visible page:
   │      white page + shadow → low-res preview → fallback tiles (other scales) → sharp tiles
   │
   └──► Scheduler (on settle)        src/lib/engine/viewer.ts  onSettle() / plan() / pump()
          150 ms after the last input: work out missing tiles at the exact current scale,
          group them into regions, render each region band by band (each band drawn as it
          lands), slice into 512 px tiles
                │
                ▼
          Renderer interface          src/lib/render/types.ts   (every call takes a docId)
            └─ BackendRenderer        doc_* commands, RGBA over binary IPC
                 ├─ PdfiumRenderer    PDFs: PDFium pool in Rust (pdfium.rs)
                 └─ ImageRenderer     images: decoded and resampled in Rust (imagedoc.rs)
                │
                ▼
          TileCache (LRU, 512 MB)     src/lib/render/tiles.ts
          keyed (page, render scale, column, row) → ImageBitmap
```

## Coordinates

- **World**: PDF points (1/72 in). `layout.ts` stacks pages vertically with an 18 pt gap,
  each centred on x = 0 (continuous mode), or lays out one page (single mode).
- **Screen**: CSS pixels in the viewport. `screen = world * scale + (tx, ty)`.
- **Device**: screen × devicePixelRatio. Only the compositor and renderers see these.
- **Render scale** `rs = scale * dpr` (device pixels per point), rounded to 6 significant
  figures (`scaleKey`) so a given zoom always produces the same cache keys.
- Zoom 100% = actual size (1 pt = 96/72 CSS px). Range 5% to 6400%.

Zoom at cursor is `zoomAt()`: keep the world point under the cursor fixed while the scale
changes. It is the one bit of maths everything else depends on, so it has the most tests.

## Two-stage zoom

1. **Instant stage.** Every input changes the view and requests a frame. The compositor
   redraws from whatever bitmaps are cached, scaled to the new view. Nothing renders.
   Wheel notches animate (exponential ease, ~45 ms time constant) towards a target scale;
   touchpad pinch and drags apply directly. The exception: a flight or a wheel ease renders
   where it will land while it moves (below).
2. **Sharp stage.** After the last input ("settle": at once when a flight or a wheel ease
   lands, 150 ms after anything else, such as a pinch), `plan()` lists
   the tiles that cover the viewport at the render scale for the current zoom, plus a
   one-tile prefetch ring, skips any already cached or already rendering, and queues region
   renders: visible tiles first, nearest the centre first, then the ring, then a page
   preview if the page has none.

**Flights and wheel eases render ahead.** A flight (fit, typed zoom, actual size:
`animateTo`) knows where it will land, so it plans and starts that view's renders as it
begins (`renderAhead`), at the render scale it will land on. Those tiles go into the cache
but aren't drawn until it lands, so the picture swaps cleanly rather than sharpening in
patches mid-flight. Landing keeps those renders; any other input ends the flight and drops
them (`cancelFlight`). A wheel notch does the same for its ease (`renderWheelAhead`): the
landing view is the target scale about the cursor. Each further notch re-plans for the new
target and aborts renders at the previous one's scale (a band already running in PDFium
still finishes); every scale started during the gesture stays hidden until it lands.
Waiting for the notches to pause before rendering was tried and measured worse: on one
notch it pushed the render past the end of the ease, and bursts gained nothing clear. A pan
mid-ease moves the anchor, so the frame re-plans. Since rendering began during the ease,
which also covers the wait for another notch, there's no settle delay after it lands.

**Render scales** (`chooseRenderScale` in `tiles.ts`) are quantised to steps of 2^¼, so
zooming back and forth lands on scales already cached, and they run ahead of the display:
zooming in renders 1.25x past the new zoom (`RS_AHEAD`), so the next wheel notch in needs no
render. A render scale is kept while the display stays within 1.6x below it
(`RS_MAX_DOWN`): zooming out reuses the sharper tiles, downscaled, until they would be too
fine.

**Getting about** (all pure maths in `viewMath.ts` and `stickyPan.ts`, tested):

- **Fits and typed zooms ease** over 220 ms (`Viewer.animateTo`, `interpolateView`: the
  world point at the centre moves in a line and the scale changes geometrically) when they
  come from the toolbar, menus or keys. Opening a document still jumps.
- **Fit width keeps your place**: the point at the vertical centre stays put
  (`fitWidthKeepingY`), unless it's off the page, when it goes to the page's top.
- **Zoom is sticky at 100%, fit width and fit page**: a wheel notch that would cross one
  lands on it, the next carries on (`stickyZoomTarget`); a pinch holds there until it has
  gone 8% further.
- **Dragging is sticky at page edges**: a page edge reaching the viewport edge, or a page
  narrower than the view reaching its centre, holds for 24 px of drag, then carries on
  without a jump (`StickyAxis`, `Viewer.dragPan`). Wheel scrolling isn't sticky.
- **Resizing the window keeps the drawing in place**: the point at the centre stays at the
  centre (`keepCentre`), or, if the view was at a fit and hasn't been moved since, it
  refits.
- **Navigation mode is per document**: CAD (the wheel zooms) for pages bigger than A4,
  Document (the wheel scrolls) for A4 and smaller (`view/navMode.ts`), picked on open, kept
  per tab, overridable from the toolbar or the View menu ("Automatic" goes back).

A zoom clears the queue (it was planned for a view that no longer exists) and aborts
in-flight renders at the old scale. A pan does neither: its tiles stay valid, so rendering
carries on throughout a drag, re-planned every frame so the tiles nearest the viewport
centre come first, and the strip you uncover fills in as you go. Only the settle timer is
restarted, for the measurement and previews. "Settle to sharp" is measured from the settle
moment to the last visible tile landing.

## Why one compositor canvas instead of CSS-transformed tiles

The brief suggests transforming the existing bitmap with CSS during gestures. This spike
draws cached `ImageBitmap`s into one viewport-sized canvas instead. The effect is the
same (instant, slightly soft, then sharp), and it has three advantages:

- **No seams.** Every tile edge is snapped to a whole device pixel, computed from the same
  formula for both neighbours, so adjacent tiles share an exact edge at any scale. Scaled
  CSS layers antialias their edges independently and show hairline gaps.
- **One canvas, always within limits.** The canvas is the size of the window, so Chromium's
  16k px / 268 MP canvas caps never apply, whatever the zoom.
- **Renderer-agnostic.** PDF and image renderers both produce `ImageBitmap`s; the
  compositor doesn't know which made them.

Cost: a `drawImage` per visible tile per frame. Measured at 0.1 to 0.3 ms per frame at
1600x960, so it is nowhere near the frame budget.

## Regions, not tiles, per render call

Rendering N tiles separately would cost N calls, each with its own setup (pdf.js, the phase 0
alternative, walked the whole operator list per call regardless of clip). The scheduler instead groups missing
tiles into rectangles of up to 8 x 8 tiles (4096 px), renders each rectangle in one pass,
and slices it into tiles with `createImageBitmap(source, sx, sy, sw, sh)`. PDFium gets
the same requests; for it, region area matters more than call count.

## Previews and fallbacks

- Each page gets a low-resolution **preview** (longest side 2048 device px), drawn under the
  tiles so panning into unrendered areas shows soft content, never white. At fit zoom the
  preview is composed for free by downscaling the already-cached tiles; otherwise it is a
  low-priority render after the visible tiles.
- When the zoom changes, tiles from **every other cached scale** within reach are drawn
  (scaled) under the current scale's tiles, which is what makes the instant stage look right
  (`fallbackScales`): scales below the target down to 1/16 of it, coarsest first, then scales
  above it up to 4x, sharpest first, so the nearest sharper copy ends on top. All of them,
  not just the nearest: a render cancelled by the next wheel notch leaves a scale with only a
  band or two cached, and picking the two nearest let those scraps push a complete earlier
  render out, so the blurry preview showed through mid-zoom.

- **On disk** (v0.1): previews are also stored as WebP in
  `%LOCALAPPDATA%\Vellum\preview-cache` (`previewcache.rs`), keyed by the file's content key
  (size, modification time and an FNV-1a hash of its first and last MiB, so an edited file
  never shows a stale preview), capped at 256 MB with the least recently used deleted first.
  On open (and on attaching a tab) the viewer asks for the visible pages' stored previews
  (`doc_cached_preview`) and shows them before the first band; a newly made preview is
  encoded (`OffscreenCanvas.convertToBlob`) and stored (`doc_store_preview`) once per page
  per session, when the viewer is idle. `Viewer.diskPreviews = false` turns it off (the
  benchmark does, so every run is cold).

## Cache

`TileCache` is a `Map` used as an LRU (re-insert on access), with a per-page, per-scale
index so the compositor finds drawable tiles without scanning. Ceiling 512 MB of decoded
RGBA (w × h × 4). Tiles drawn at the target scale are touched every frame so they're never
the eviction victims. Evicted bitmaps are `close()`d immediately to release GPU memory.
Previews have their own 96 MB budget.

## Renderers

### PDFium (`pdfiumRenderer.ts`, `backendRenderer.ts`, `src-tauri/src/pdfium.rs`)

- `pdfium.dll` (prebuilt, from bblanchon/pdfium-binaries) loaded at runtime through the
  `pdfium-render` crate's raw bindings. Fetch it with `node tools/fetch-pdfium.mjs`.
- If `pdfium.dll` can't be found, opening fails with "pdfium.dll not found: run
  `node tools/fetch-pdfium.mjs`" (the directories searched go to stderr). There is no
  fallback renderer.
- **A pool of PDFium instances.** PDFium keeps all its state in DLL globals and is not
  thread-safe. Loading renamed copies (`pdfium.dll`, then
  `%TEMP%\vellum-pdfium\<size>-<mtime>\pdfium-1.dll`, …) gives each worker thread its own module, so
  N instances render truly in parallel. Default N = half the logical CPUs, at most 8
  (`--pdfium-threads` overrides). Each worker owns its instance, a map of open documents
  (document id → its own handle) and up to 16 parsed pages per document (least recently
  used evicted).
- **Shared, reused DLL copies.** The copies live in a folder named after the original DLL's
  size and modification time (`%TEMP%\vellum-pdfium\<size>-<mtime>\`), shared by every
  Vellum process and reused across launches. Writing fresh copies on every start (a v0.1
  interim with one folder per process) cost about 300 ms per open, because Windows Defender
  scans each new DLL before it loads. A missing copy is written under a temporary name and
  renamed into place, so a process starting at the same moment never loads half a file, and
  an existing complete copy is never overwritten (another process may have it mapped).
  Each start deletes, best effort, other folders and files under `vellum-pdfium` that are
  more than a minute old (older builds' copies, the interim per-process folders, the pre-v0.1
  flat layout); anything still loaded fails to delete and is skipped.
- **Spatial affinity.** The page is cut into N fixed bands along its long axis and worker *s*
  owns band *s*. Every region is split at band boundaries (`split_region`, a pure function
  with its own tests in `src-tauri/tests/bands.rs`: an off-by-one there would make two
  workers write the same bytes or one write past the buffer), each part goes to its band's
  worker, and all of them write straight into one shared RGBA buffer
  (`FPDFBitmap_CreateEx` over an external buffer with the full row stride). A whole-page
  render runs on all workers at once, and each image is decoded and cached by one worker
  only, render after render. (Round-robin dispatch was tried first: every worker ended up
  decoding every image, 13.6 GB on the real test file.)
- **Some renders go to one worker.** A small region (0.5 MP or less, `SMALL_REGION_PX`:
  zoomed out, usually one per page) renders whole on its page's own worker
  (`page % workers`), so with many pages on screen each page is parsed by one worker rather
  than all of them thrashing through `PAGES_PER_DOC`. So does any region of a page with an
  image swap or an image slow to decode (`pdfium_swap::one_band`, asked once per page through
  `bands_for_page` and cached).
- **Known limitation: zoomed in, few workers render.** Bands are fixed eighths of the page,
  so a view that covers a small part of the page falls in one to three bands and only those
  workers render it (on the aerial drawing at 1600%, two strips of 130 to 160 ms each). The
  fix (cut the region, not the page) is idea 1a in `docs/speed-handoff.md`.
- `FPDF_RenderPageBitmapWithMatrix` renders in RGBA order (`FPDF_REVERSE_BYTE_ORDER`); the
  buffer goes back as a raw binary IPC response and is wrapped in `ImageData` with no
  conversion. Streaming (progressive paint) is described below. Commands are `async` + `spawn_blocking`, so the window's event loop is never
  blocked.
- Two large region requests in flight from the front end, so one renders while the other's
  bytes become bitmaps; small regions, which each occupy one worker, up to one per worker.
- Cancellation skips queued requests and, within a request, every strip a worker hasn't
  started yet; a strip already inside PDFium runs to completion. PDFium's progressive API
  (`FPDF_RenderPageBitmap_Start` with a pause callback) would allow mid-strip abort (idea 7
  in `docs/speed-handoff.md`).
- **Memory guard (off by default).** PDFium caches every decoded image on the parsed page,
  which is how the real test file reaches 3 GB. `VELLUM_PDFIUM_TRIM_MB=<n>` closes and
  re-parses pages when the process tree passes *n* MB. On that file re-parsing costs 0.7 to
  1.9 s, which made fit renders 7 s, so it stays off; see RESULTS.md for the better fix.
- `VELLUM_PDFIUM_TIMING=1` prints per-call parse and render times to stderr.

## Documents (v0.1)

PDFs and images share one id space and one set of commands. `src-tauri/src/docs.rs` holds
the registry: `doc_open` decides the kind (extension first, `imagedoc::handles`; unknown
extensions are sniffed for `%PDF-` or image magic), allocates an id that is never reused in
the process, and opens the document on every PDFium worker (PDF) or decodes it once in
`imagedoc.rs` (image). Every other command takes the id and dispatches on kind; images
answer text, outline and scale queries with empty results.

| Command | Returns |
|---|---|
| `doc_open(path, password?)` | `DocInfo { docId, kind: "pdf"\|"image", numPages, sizes, meta, workers }`; `meta` = `{ fileSize, pdfVersion, title, author, subject, producer, creator, note }` |
| `doc_render(docId, region)` | raw RGBA, `w*h*4`; empty body if cancelled |
| `doc_render_stream(docId, region, onBand)` | bands over the channel (see Streaming); resolves to the band count, or null if cancelled |
| `doc_cancel(id)` | skips a region request (by `region.id`) that hasn't started |
| `doc_thumbnail(docId, page, maxSide)` | RGBA plus an 8-byte trailer: `w`, `h` as little-endian u32 |
| `doc_page_text(docId, page)` | the page's text (`FPDFText_GetText`) |
| `doc_outline(docId)` | `OutlineNode[]`: `{ title, page \| null, y \| null, children }`, y in points from the page top |
| `doc_find_scale(docId, page)` | `[{ ratio, text, bbox: [x0, y0, x1, y1], statedRatio, sheet }]` best first; bbox in page points, y down. "1:200 @A3" on an A1 page gives ratio 100, statedRatio 200, sheet "A3" |
| `doc_text_layer(docId, page)` | raw bytes: every character (code point, loose box in page points, generated flag) and the page's links as JSON (`text.rs`, `encode_layer`); parsed by `src/lib/text/layer.ts` |
| `doc_search_page(docId, page, query, matchCase, wholeWord)` | `{ chars, hits: [{ index, count, rects, before, text, after }], truncated }`, PDFium's own matcher, at most 1000 hits |
| `doc_close(docId)` | frees the document on every worker |

`region` is `{ id, page, rs, x, y, w, h }`: a device-pixel rect of the page bitmap at `rs`
device pixels per point, and a request id for cancellation (0 = never cancelled). Errors are
strings the UI shows as they are: "Password required", "Wrong password", "Not a PDF or
supported image", "pdfium.dll not found: run `node tools/fetch-pdfium.mjs`".

On the front end, `Renderer` (`src/lib/render/types.ts`) mirrors these with a `docId` on every
call. `BackendRenderer` implements it once over the commands; `PdfiumRenderer` and
`ImageRenderer` only differ in `name`, and `rendererFor(path)` picks one by extension. They
hold no per-document state, so one instance of each serves every tab. `Viewer.open(path,
password?)` closes the viewer's previous document in the backend.

### Text and drawing scale

`doc_page_text` and `doc_find_scale` load the page's text layer (`FPDFText_LoadPage`) on a
PDFium worker, like everything else. Scale detection reads one character per PDFium char
index (`FPDFText_GetUnicode`), so match positions map straight to `FPDFText_GetCharBox`.
The matching and ranking are pure (`src-tauri/src/scale.rs`, tested in `tests/scale.rs`):
`1:NNN`, `1 : NNN`, `1∶NNN`, and `1/NNN` for standard ratios from 1/10 only; times,
dates, paper sizes ("A1:50") and parts of larger numbers are rejected. Candidates outside
1..100000 are dropped; the rest are ordered by a score: position (0 at the top-left, 2 at
the bottom-right, since title blocks live there), +1.5 when "scale" appears in the 24
characters before, +0.5 for a standard ratio, −1.5 for 1:1.

### Text layer, links and search (`text.rs`, `src/lib/text/`, editing phase 1)

PDFium reports character, link and search boxes in PDF user space (y up, before `/Rotate`,
from the page box's own origin). `text::PageFrame` maps them into Vellum's page coordinates
(the page as rendered: `/Rotate` applied, y down from the top-left), from
`FPDFPage_GetRotation` and `FPDF_GetPageBoundingBox`; `doc_find_scale` uses it too. Text
layers and page searches run on the page's own worker (`page % workers`, as small renders do),
one page per job. The front end fetches a page's layer lazily (`engine/textTool.ts`: when the
pointer rests on the page while the viewer is idle, or when a selection starts there) and keeps
the last 12 per document. Selection, word and line ranges, highlight rectangles and link
hit-testing are pure (`src/lib/text/`); whole-document search (`engine/search.ts`) runs two
pages at a time from the current page, one session per document, stopping at 5,000 hits.
`Viewer.setHighlights(name, layer)` draws rectangles above the tiles with a multiply blend
(selection, search hits); `Viewer.revealRect(page, rect)` centres a hit and zooms in if it would
be too small to read. Links: `open_url` (`shell.rs`) hands http, https and mailto addresses to
the browser with `ShellExecuteW`; nothing else is followed.

### Markups (`src/lib/markup/`, `engine/markup*.ts`, `src-tauri/src/annot/`, editing phases 2 and 3)

Markups are plain objects in page points (`markup/types.ts`). Each one becomes a list of drawing
operations (`markup/ops.ts`): paths and lines of text. The same operations are painted on the
canvas (`engine/markupPainter.ts`, through `Viewer.setPainter`, above the tiles and highlights)
and turned into the annotation's appearance stream in PDF user space when saved
(`markup/pdf.ts`, using the page's frame from `doc_page_frame`), so the screen and the file
agree. Text uses Helvetica's widths (`markup/helvetica.ts`; Arial on screen has the same).
`engine/markupTool.ts` draws and edits; each tab has a `MarkupDoc` (undo history, what the file
holds, frames, selection). Saving: `annot_prepare` applies add / replace / delete specs with
`lopdf` and writes a temporary file beside the original; `Viewer.reopen` closes the document on
every PDFium worker (`doc_close_wait`; PDFium holds the file open), `annot_commit` renames the
file into place, and the document is reopened with the same view, tiles and previews, this
session's markups hidden in PDFium (`doc_hide_annots`) so the overlay keeps drawing them. Files
with broken cross-reference data are rewritten by PDFium first. Unsaved markups go to
`%LOCALAPPDATA%\Vellum\recovery` a second after each change and are offered back after a crash.

### Running code on a PDFium worker (`run_on_worker`)

PDFium is not thread-safe, so other Rust modules (printing, composition) must never call it
from their own threads. `PdfiumState::run_on_worker(|ctx: &mut WorkerCtx| -> R) -> Result<R,
String>` runs a closure on one worker (round robin) and waits for its result;
`run_on_worker_index(i, f)` picks the worker. `WorkerCtx` gives `bindings()` (that
instance's raw PDFium API, `&dyn PdfiumLibraryBindings` from `pdfium-render`),
`document(doc_id)` (that worker's `FPDF_DOCUMENT` for an open id) and `page(doc_id, index)`
(a cached parsed page; don't close it). Handles are only valid on that worker and during the
call. The closure runs between renders on that worker, so long jobs delay the tiles queued
behind them; it blocks the caller, so call it from `spawn_blocking`. A PDF built in memory
(for example a composed print job saved with `FPDF_SaveAsCopy`) becomes an ordinary
document with `Docs::open_pdf_bytes(&pdfium, bytes) -> DocInfo`: renderable, printable and
closed with `doc_close`.

### Page-load hook

Every page any worker renders, measures or reads is parsed in one place:
`pdfium.rs::load_page(bindings, doc, index)`, called only from the per-document page cache.
The image swaps and the 1/8 prototype hook in at render time instead (`render_strip` asks
`pdfium_swap::page_for_render`, then `pdfium_lod::page_for_render`), because each renders
from a second copy of the page in a second document handle.

## Streaming (progressive paint, v0.1)

The PDFium pool finishes bands at different times (on the aerial drawing, 0.3 to 1.8 s for
one fit render), so a region that waited for its slowest band showed nothing until the end.
Now each band is shown as it lands:

1. `doc_render_stream(docId, region, onBand)` splits the region with `split_region` and
   gives every band its own buffer (`render_stream` in pdfium.rs). As each worker finishes,
   its band goes down a Tauri channel as raw bytes: RGBA rows followed by a 16-byte trailer
   (x, y, w, h within the region, little-endian u32). Buffers are allocated with spare
   capacity for the trailer, so nothing is copied. The command resolves with the number of
   bands sent; channel messages can arrive after that, so the front end waits for the count.
   Images arrive as one band.
2. `BackendRenderer.renderRegionProgressive` copies each band into a region-sized buffer
   (`RegionAssembler`, pure and tested: it tracks the area covered inside each requested tile)
   and hands the viewer a `BandBitmap`: the band as a bitmap to draw now, plus every tile the
   band completed, sliced from the assembled buffer. A band whose tiles are all complete gets
   no bitmap of its own (one-band regions would otherwise upload twice).
3. The viewer puts completed tiles straight into the cache and keeps band bitmaps as
   "partials" for that job, drawn above the fallback layers and below the target-scale tiles,
   until the job finishes (or is aborted by a zoom), when they are closed. Previews and the
   two-stage zoom are unchanged: preview jobs still use the one-shot `doc_render`.

Measurements: "first band" is open (or settle) to the first band of visible content on screen
(the frame after it presented, like settle-to-sharp); "first page" is still open to every
visible tile sharp. `Viewer.whenFirstBand()` and `SharpEvent.settleToFirstBandMs` expose
them; the bench records both. On the aerial drawing at fit, settle to first band was 341 ms
against 724 ms to sharp. On open, parsing the page dominates the first band (about 0.7 s for
worker 0 alone): workers 1..N pre-parse page 1 as soon as the document opens so their parse
overlaps worker 0's (`VELLUM_PDFIUM_PREFETCH=0` turns this off). That makes the page sharp
sooner but its first band slightly later, because eight parallel parses contend.

`Viewer.progressive = false` falls back to whole-region renders.

## The viewer API (for the shell)

`src/lib/engine/viewer.ts` is Svelte-free; components call it and listen to `onUi`, which
fires (batched per microtask) with a `UiState` whenever something it reports changes.
`initialUiState()` gives a component its state before a viewer exists.

| Need | API |
|---|---|
| Open / close | `open(path, password?)` (closes the attached document), `close()` |
| Tabs | `detach(): DocView` keeps the document open in the backend and its page previews (trimmed to 32 MB) in the returned state; `attach(state)` restores view, page and rotation and shows the previews at once; `closeDetached(state)` frees a background tab. One viewer and one canvas serve every tab. |
| Zoom | `setZoom(z, sx?, sy?)` (1 = 100%), `zoomStep(±1)`, `zoomPreset(±1)` over `ZOOM_PRESETS`, `fit("page" \| "width")`, `actualSize()` |
| Pages | `gotoPage(i)`, `next/prev/first/lastPage()`, `gotoPagePoint(page, y)` (bookmarks), `centreOn(page, x, y)` (mini map drag) |
| Rotation | `setRotation(0 \| 90 \| 180 \| 270)`, `rotate(±1)`; view only, keeps the centre point, tiles stay valid |
| Layout / mode | `setLayoutMode("continuous" \| "single")`, `setNavMode("cad" \| "document")` |
| Observable state | `UiState`: `fileName, docId, kind, page, numPages, zoom, rotation, layoutMode, navMode, loading, error, cursor, pageViewport` |
| Cursor | `input.ts` calls `setPointer(x, y)` on pointer moves; `UiState.cursor` is `{ page, x, y }` in page points, or null off the pages. `pagePointAt(sx, sy)` for one-off queries. |
| Mini map | `previewFor(page)` (the cached preview bitmap and its scale; don't keep it), `viewportOnPage(page)` / `UiState.pageViewport` (viewport in page points, may extend past the page) |
| Thumbnails | `thumbnail(page, maxSide): Promise<ImageBitmap>` (caller owns the bitmap) |
| Theme change | `refreshCanvasColour()` then `requestFrame()` |

All page coordinates are **unrotated page points**, y down from the page's top-left, the same
space as `doc_find_scale` bounding boxes and outline targets. Convert to millimetres with
`pt * 25.4 / 72`.

### Rotation

`rotation.ts` maps page points to the rotated page (`rotatePoint`, `unrotateRect`, ...) and
gives the canvas transform that draws an unrotated bitmap into a rotated destination
(`rotatedDrawTransform`); all pure and tested. The layout stacks rotated page sizes. The
scheduler converts the visible world rect back to unrotated page coordinates before
working out tile ranges (`tileRangeForRect`), and the compositor maps each tile's page rect
to the screen and rounds its edges there, so tiles still share exact edges at 90°, 180° and
270°. Tiles and previews are cached unrotated, so rotating never re-renders anything.

### Thumbnails

`ThumbnailQueue` (`thumbnails.ts`) renders thumbnails top-down (lowest page first), up to
half the workers at once, and only while the viewer is idle for background work
(`Viewer.idleForThumbnails`): no animation, no settle pending, nothing queued, no input for
300 ms, and nothing rendering except renders that occupy a single worker (a small region or
a one-band page, such as Bayou's cover, whose 7 s render used to hold the thumbnails back).
The sidebar asks for a page's thumbnail as it scrolls into view and cancels the request if it
scrolls away first. Repeats share one render, results are cached per document (64 MB, LRU)
and dropped when the document closes. A page with a cached preview at least as sharp as the
thumbnail is downscaled from it without touching the backend; otherwise `doc_thumbnail`
renders it through the pool. A thumbnail render already inside PDFium can't be interrupted,
so a heavy page (about 1 s on the aerial drawing) can still delay a zoom that starts while it
runs.

## Images (`imagedoc.rs`)

Image files open as one-page documents through the same `doc_*` commands as PDFs;
`docs.rs` routes them to `imagedoc.rs` by extension (or content sniffing for unknown
extensions). `ImageDoc::open` decodes once on Tauri's blocking pool with the `image` crate,
applies the EXIF orientation, flattens alpha onto white and keeps two levels in memory: full
size and a quarter-size copy (each side divided by four). The page size is the pixel size at
the file's embedded DPI (EXIF/JFIF, PNG pHYs, TIFF resolution tags, BMP header, WebP EXIF)
when that's 150 or more, so a scanned drawing measures and prints at its true size, and at
96 DPI otherwise (`geom::effective_dpi`): cameras and phones write 72, which would open a
photo far too big, so photos show one image pixel per CSS pixel at 100%. A region render picks the smaller
level when it still has a source pixel per device pixel, maps the device-pixel region to a
fractional source rectangle (`imagedoc::geom::map_region`, which clips the parts off the page
and the half-pixel past the page's exact extent) and resamples just that with
`fast_image_resize` (bilinear convolution). Streaming sends an image region as one band.
Images over 120 megapixels are kept at half resolution, page size unchanged, and
`DocMeta.note` says so for the tab.

## Image swaps (`pdfium_swap.rs`)

PDFium keeps a decoded image between renders only while it's between about 12 and 60 MB
decoded, and converting through an ICC profile with a lookup table costs it 170 to 240 ms
per megapixel whenever it isn't kept: Bayou Towers' 24 MP cover scan cost 4.2 s on every
render. So on the first render of a page, each image is looked at (including images nested
in form XObjects) and swapped when its decoded size is over 60 MB, or it has a lookup-table
profile and is at least 0.5 MP; never images with transparency, nor 1-bit scans (which
PDFium keeps). Biggest first, at most 400 MB a page.

The swapped pixels come from our own decode (`jpeg-decoder`, and `moxcms` with tetrahedral
interpolation for a profile) for a plain grey or RGB JPEG whose profile passes a check, or
otherwise from PDFium's own decode, taken once (`FPDFImageObj_GetBitmap`): v4 table
profiles, CMYK, Lab, Indexed, non-JPEG. The check runs once per profile per process: a
17 x 17 x 17 grid of colours converted by both, ours used only if they agree (mean at most
one level, at most 1% of samples more than 8 off). `moxcms` matches PDFium closely on v2
profiles but not on v4 table profiles (it has no black-point compensation, which LittleCMS
applies to v4 perceptual).

The pixels are set (`FPDFImageObj_SetBitmap`) into a copy of the page loaded from a second
document handle (PDFium shares one image object per stream across a document, so the
original must stay untouched), and that copy is rendered at every scale. Each swapped page
has its own handle so closing it frees the pixels: at most 1 GB a worker, least recently
used closed first. Pages with a swap, or an image whose estimated decode is 150 ms or more,
render as one band, so only one worker ever holds the copy. `[swap]` lines on stderr log
every swap and profile check. Measurements and reasoning: `docs/bayou-image-scope.md`.

## Image level of detail (experimental, off: `pdfium_lod.rs`)

`pdfium_lod.rs` can render image-heavy pages from a second handle on the file whose large
JPEGs are swapped for 1/8 decodes, below a per-page scale threshold. It's off unless
`VELLUM_IMAGE_LOD=1` because it measured slower and used twice the memory on the aerial
drawing (see `docs/v0.1-handoff/lod.md`).

## Snap layouts on the custom title bar (`snap.rs`)

Windows 11 offers snap layouts when the window under the cursor answers WM_NCHITTEST with
HTMAXBUTTON, but the WebView2 child covering the client area is what gets asked. So a small
native child window of our own sits exactly over the HTML maximise button (the title bar
reports its rectangle in physical pixels through `snap_max_button` whenever it moves). It
answers HTMAXBUTTON, maximises or restores on click, and emits `snap://hover` so the HTML
button can still show its hover. It's layered at alpha 1 (invisible but hit-tested), and a
layered child window needs the app manifest to declare Windows 8 or later:
`src-tauri/app.manifest` (Tauri's Common Controls dependency plus a Windows 10/11
`supportedOS`), linked through `build.rs`.

## Shell (v0.1)

`src/App.svelte` wires the shell; components live in `src/lib/components/` and everything
that can be pure is in `src/lib/shell/` with Vitest tests (tab list, menu keyboard
navigation, paper names and coordinate text, scale choice and parsing, window placement,
formatting, shortcuts, theme maths, export size limits).

- **One viewer, many tabs.** The canvas and `Viewer` are shared. Switching tabs calls
  `viewer.detach()` (the document stays open in the backend with up to 32 MB of previews) and
  `viewer.attach()` for the target, so a tab comes back instantly with its view, page and
  rotation. A tab whose open was interrupted by a switch goes back to "pending" and reopens
  when it is next shown. Opens are queued (`openPaths`), so drops and forwarded launches wait
  their turn.
- **Window.** No native decorations; the title bar is HTML with `data-tauri-drag-region` on
  empty space only, window buttons call the Tauri window API. Size, position and maximised
  state are stored in the settings and restored before the window is shown, fitted to a
  monitor's work area (`shell/windowPlacement.ts`). Snap layouts on hovering maximise are
  not available on a custom title bar.
- **Single instance** (`src-tauri/src/shell.rs`): `tauri-plugin-single-instance` forwards a
  second launch's file to the running window (`vellum://open-files` event); files that
  arrive before the front end listens are queued and collected with `shell_take_pending`.
  `--bench`, `--new-instance` and `VELLUM_MULTI_INSTANCE` bypass it.
- **Themes.** Two token sets on `:root[data-theme]` in `src/app.css`. The accent is fixed (Deep
  teal, `#0d9488`): `--accent`, `--accent-soft` and `--accent-bd` on the root, plus a per-theme
  `--accent-text` for links. Components use tokens only.
- **Drawing scale.** On open, `findScale(docId, 0)`; the best candidate is adopted only from
  a title-block position (`shell/scale.ts`). Hand-set scales are remembered per file. The
  tab's scale feeds the status bar and `PrintContext`.
- **Settings** are one validated object in localStorage (`vellum.settings.v1`); print
  presets are WP-Print's own keys.
- **Installer.** NSIS, per user. `src-tauri/windows/installer-hooks.nsh` registers Vellum
  under "Open with" (`OpenWithProgids` + `Applications\vellum.exe`) for PDFs and the image
  types without becoming the default.

## Printing (`src-tauri/src/print/`, `src/lib/print/`)

The dialog and the manual layout are thin over a pure model (`src/lib/print/model/`) that
turns settings or hand placement into a **job**: sheets (size in points) of placed items
(document id, page, crop in displayed page points, position, scale, quarter-turn rotation),
stroked lines, text and an optional clip. Rust composes the job into a PDF and prints that.

- **Compose** (`compose.rs`, on one PDFium worker via `run_on_worker`): a new document, one
  page per sheet. Each placed page is a form XObject (`FPDF_NewXObjectFromPage`), cached per
  (page, crop) for the job, so a page tiled across many sheets is stored once, and placed
  with `FPDF_NewFormObjectFromXObject` and a matrix (`job::item_matrix`). A crop is the
  source page's crop box at the moment the XObject is made (that bounds a page XObject).
  Sources are reopened privately by path, so crops and annotation flattening never touch the
  viewer's documents. Images go through a scratch page. Tiles are clipped with
  `FPDFPage_TransFormWithClip` before the cut marks and stamp are added. The result is kept
  by job id (`print_compose`) for Save as PDF (`print_save_pdf`) or printing.
- **Print** (`gdi.rs`): `CreateDC` with the printer's DEVMODE (copies, collate, duplex,
  colour, paper and orientation per sheet via `ResetDC`), `StartDoc`, then per sheet either
  bands of 512 rows rendered at 300/600 dpi (`raster.rs`: the composed PDF open privately on
  one worker, each band one `run_on_worker_index` call so viewer renders interleave) and sent
  with `StretchDIBits`, or Vector: `FPDF_RenderPage` to the printer DC. Sheet coordinates are
  paper coordinates; the DC's origin is offset by `PHYSICALOFFSET`.
- **Front end**: `PrintDialog.svelte` (props `{ open, context, onClose }`, the shell's
  `PrintContext` in `src/lib/print/context.ts`), `ManualLayout.svelte`; `painter.ts` draws
  sheets from the job through the shared renderer (an item is a region render of its page).
  Settings and presets in localStorage under `vellum.print.*`.
- **Tests**: the model in Vitest; geometry, composition (rendered and measured) and a real
  Microsoft Print to PDF round trip in `cargo test` (`print_*`), the latter also from
  `npm test`.

## Navigation (`input.ts`)

The left button (without Space) goes to `InputCallbacks.left`: the text tool, which selects
text on or near characters, follows links on a click, and lets presses elsewhere fall through.
Wheel events are classified as notched mouse wheel or touchpad. Per event: deltaMode 1/2,
a single-axis whole multiple of 33.33 px (Chromium's pixels per system "line"; 100 at the
default of 3 lines), or a single-axis integer delta of at least 50 px, counts as a notch.
Per gesture (`WheelClassifier`): a touchpad scroll is a dense stream whose deltas ramp up,
so once any event is smooth, every event in the next 150 ms is smooth too, whatever its
size. Without that rule a fast two-finger flick crossed 50 px and zoomed. In CAD mode notches
zoom, touchpad scrolls pan. Touchpad pinch arrives as ctrl+wheel only if the window's
`zoomHotkeysEnabled` is on (wry ties WebView2's pinch-zoom setting to it); the wheel and key
handlers cancel the browser's own page zoom so the setting only serves to let the gesture through. Ctrl+wheel always zooms (pinch arrives as ctrl+wheel). Middle button
pans with pointer capture; its mousedown is cancelled to stop Windows autoscroll.

## WebView2 switches

The window sets `additionalBrowserArgs` in `tauri.conf.json`. Setting it replaces wry's
defaults, so the first part repeats them (`--disable-features=msWebOOUI,msPdfOOUI,
msSmartScreenProtection`: no mini menu, no SmartScreen). The second, `--enable-benchmarking`,
makes WebView2 ignore the feature experiments Microsoft downloads into each profile (the
`Variations*` files in `EBWebView`) and run every feature at its built-in default.

Why: in November 2026 an experiment that reached Matt's profile made the eyedropper
(`EyeDropper.open()`, in the colour picker) close 2 ms after opening with an `AbortError`, in
dev and release. A fresh profile, or the same profile without its `Variations*` files, worked;
Edge (its own profile) worked. The seeds are encrypted, so the feature couldn't be named and
switched off on its own. Costs: Vellum gets Microsoft's trial changes only once they're
standard in a runtime update (security fixes come in runtime updates regardless), and
`--enable-benchmarking` is a testing switch Microsoft could change. Every speed measurement
was taken on fresh profiles, which have no experiments either, so none of the numbers move.
Worth trying without it after a runtime update: if the eyedropper works on a profile that has
experiments, drop the switch. The colour picker logs a `[colour] eyedropper closed...` warning
whenever it closes without a colour, so a return shows up in the log.

Only the main window uses WebView2. A second window would need the same switches, or its own
data directory (WebView2 refuses different switches on one data directory).

## Instrumentation

- **F12** (or Ctrl+Shift+D, or `--debug`) toggles the overlay: live and last-active fps, draw
  cost, settle to sharp, render queue, cache size, previews, JS heap, process-tree memory
  and the last wheel event as classified (useful for diagnosing odd mice).
- Process memory is sampled in Rust every 200 ms across `vellum.exe` and all its
  `msedgewebview2.exe` children (private working set, as Task Manager shows it).
- While the overlay is up, each settle is appended to `%LOCALAPPDATA%\Vellum\perf-log.csv`.
  Benchmark runs append there too.
- `--bench <file> --bench-out <json>` runs the scripted sequence in `src/lib/perf/bench.ts`
  and exits; `tools/bench.mjs` drives it.

## Dependencies beyond the template

| Dependency | Why |
|---|---|
| `@tauri-apps/plugin-dialog` | File → Open dialog. |
| `@fontsource/inter`, `@fontsource/jetbrains-mono` | The brief's UI fonts, bundled so they work offline. |
| `vitest` (dev) | Unit tests; shares Vite's config, nothing else to set up. |
| `windows-sys` (Rust) | Process-tree memory sampling (Toolhelp + psapi). |
| `pdfium-render` (Rust) | Loads `pdfium.dll` and exposes its C API. Only the raw bindings are used. |
| `image` (Rust, jpeg/png/webp/tiff/bmp/gif only) | Decodes image documents, including EXIF orientation, 16-bit and CMYK JPEG. MIT/Apache. |
| `fast_image_resize` (Rust) | SIMD crop-and-resample of image regions, the job PDFium does for PDFs. MIT/Apache. |
| `jpeg-decoder` (Rust, no default features) | Scaled-IDCT 1/8 JPEG decode for the image LOD prototype. Pure Rust, builds on the GNU toolchain without NASM or CMake. MIT/Apache. |
| `tauri-plugin-single-instance` (Rust) | A second launch (Explorer "Open with") hands its file to the running window instead of opening another. The official Tauri plugin; MIT/Apache. |
| `windows` 0.62 (Rust; `Win32_Foundation`, `Win32_Graphics_Gdi`, `Win32_Graphics_Printing`, `Win32_Storage_Xps`) | Printer enumeration, capabilities, DEVMODE and the driver dialog, and GDI output (`StartDoc`, `StretchDIBits`). Same version `pdfium-render` uses for its HDC type. MIT/Apache. |
| `pdfium-render` feature `pdfium_use_win32` (Windows only) | Exposes `FPDF_RenderPage` with a GDI `HDC`, the Vector print path. No new crate. |
