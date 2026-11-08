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
   touchpad pinch and drags apply directly.
2. **Sharp stage.** 150 ms after the last input ("settle"), `plan()` lists the tiles that
   cover the viewport at the exact current scale, plus a one-tile prefetch ring, skips any
   already cached, and queues region renders: visible tiles first, nearest the centre
   first, then the ring, then a page preview if the page has none.

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
- When the zoom changes, tiles from the two nearest **other scales** are drawn (scaled)
  under the current scale's tiles, which is what makes the instant stage look right.

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
  `%TEMP%\vellum-pdfium\p<pid>\pdfium-1.dll`, …) gives each worker thread its own module, so
  N instances render truly in parallel. Default N = half the logical CPUs, at most 8
  (`--pdfium-threads` overrides). Each worker owns its instance, a map of open documents
  (document id → its own handle) and up to 16 parsed pages per document (least recently
  used evicted).
- **Per-process DLL copies.** The copies live in a folder named after the process id, so
  several Vellum processes at once (benchmarks, parallel test builds) never overwrite a DLL
  another has loaded. Loaded DLLs can't be deleted while their process runs, so each start
  deletes the other processes' folders that are more than a minute old (a folder still in
  use fails to delete and is skipped) plus the pre-v0.1 flat-layout copies.
- **Spatial affinity.** The page is cut into N fixed bands along its long axis and worker *s*
  owns band *s*. Every region is split at band boundaries (`split_region`, a pure function
  with its own tests in `src-tauri/tests/bands.rs`: an off-by-one there would make two
  workers write the same bytes or one write past the buffer), each part goes to its band's
  worker, and all of them write straight into one shared RGBA buffer
  (`FPDFBitmap_CreateEx` over an external buffer with the full row stride). A whole-page
  render runs on all workers at once, and each image is decoded and cached by one worker
  only, render after render. (Round-robin dispatch was tried first: every worker ended up
  decoding every image, 13.6 GB on the real test file.)
- `FPDF_RenderPageBitmapWithMatrix` renders in RGBA order (`FPDF_REVERSE_BYTE_ORDER`); the
  buffer goes back as a raw binary IPC response and is wrapped in `ImageData` with no
  conversion. Streaming (progressive paint) is described below. Commands are `async` + `spawn_blocking`, so the window's event loop is never
  blocked.
- Two region requests in flight from the front end, so one renders while the other's bytes
  become bitmaps.
- Cancellation skips queued requests; a render already inside PDFium runs to completion.
  PDFium's progressive API (`FPDF_RenderPageBitmap_Start` with a pause callback) would allow
  mid-render abort; not needed at the region sizes used here.
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
| `doc_find_scale(docId, page)` | `[{ ratio, text, bbox: [x0, y0, x1, y1] }]` best first; bbox in page points, y down |
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
Work that must happen once per parsed page (WP-LOD's downsampled image swap) hooks in
there.

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

`ThumbnailQueue` (`thumbnails.ts`) runs one thumbnail at a time and only while the viewer is
idle for background work: nothing queued or rendering, no settle pending and no input for
300 ms. Newest requests go first (the pages the user just scrolled to), repeats share one
render, results are cached per document (64 MB, LRU) and dropped when the document closes. A
page with a cached preview at least as sharp as the thumbnail is downscaled from it without
touching the backend; otherwise `doc_thumbnail` renders it through the pool. A thumbnail
render already inside PDFium can't be interrupted, so a heavy page (about 1 s on the aerial
drawing) can still delay a zoom that starts while it runs.

## Navigation (`input.ts`)

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
