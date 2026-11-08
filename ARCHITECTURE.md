# Vellum rendering architecture (phase 0)

How a PDF gets from disk to pixels, so later phases build on this rather than around it.
The measurements that shaped it are in [RESULTS.md](RESULTS.md).

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
          group them into regions, render each region once, slice into 512 px tiles
                │
                ▼
          Renderer interface          src/lib/render/types.ts
            ├─ PdfjsRenderer          pdf.js; parse in worker, draw on main thread
            └─ PdfiumRenderer         PDFium on a Rust thread, RGBA over binary IPC
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
- **Renderer-agnostic.** pdf.js and PDFium both produce `ImageBitmap`s; the compositor
  doesn't know which made them.

Cost: a `drawImage` per visible tile per frame. Measured at 0.1 to 0.3 ms per frame at
1600x960, so it is nowhere near the frame budget.

## Regions, not tiles, per render call

pdf.js walks the page's entire operator list on every render call regardless of clip, so
rendering N tiles separately costs N full passes. The scheduler instead groups missing
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

### pdf.js (`pdfjsRenderer.ts`)

- `pdfjs-dist` with its worker. The file is read by Rust and handed over as bytes.
- One reusable canvas for regions; `page.render()` with a translate transform for the region
  offset. `enableHWA: true` (GPU canvases); pdf.js's default is CPU canvases.
- Renders one region at a time: canvas drawing runs on the main thread (pdf.js slices it
  into ~15 ms chunks), so concurrency would only interleave the same thread.

### PDFium (`pdfiumRenderer.ts`, `src-tauri/src/pdfium.rs`)

- `pdfium.dll` (prebuilt, from bblanchon/pdfium-binaries) loaded at runtime through the
  `pdfium-render` crate's raw bindings. Fetch it with `node tools/fetch-pdfium.mjs`.
- **A pool of PDFium instances.** PDFium keeps all its state in DLL globals and is not
  thread-safe. Loading renamed copies (`pdfium.dll`, `%TEMP%\vellum-pdfium\pdfium-1.dll`, …)
  gives each worker thread its own module, so N instances render truly in parallel. Default
  N = half the logical CPUs, at most 8 (`--pdfium-threads` overrides). Each worker owns its
  instance, the open document and up to 16 parsed pages.
- **Spatial affinity.** The page is cut into N fixed bands along its long axis and worker *s*
  owns band *s*. Every region is split at band boundaries, each part goes to its band's
  worker, and all of them write straight into one shared RGBA buffer
  (`FPDFBitmap_CreateEx` over an external buffer with the full row stride). A whole-page
  render runs on all workers at once, and each image is decoded and cached by one worker
  only, render after render. (Round-robin dispatch was tried first: every worker ended up
  decoding every image, 13.6 GB on the real test file.)
- `FPDF_RenderPageBitmapWithMatrix` renders in RGBA order (`FPDF_REVERSE_BYTE_ORDER`); the
  buffer goes back as a raw binary IPC response and is wrapped in `ImageData` with no
  conversion. Commands are `async` + `spawn_blocking`, so the window's event loop is never
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
| `pdfjs-dist` | The renderer under test. |
| `@tauri-apps/plugin-dialog` | File → Open dialog. |
| `@fontsource/inter`, `@fontsource/jetbrains-mono` | The brief's UI fonts, bundled so they work offline. |
| `vitest` (dev) | Unit tests; shares Vite's config, nothing else to set up. |
| `windows-sys` (Rust) | Process-tree memory sampling (Toolhelp + psapi). |
| `pdfium-render` (Rust) | Loads `pdfium.dll` and exposes its C API. Only the raw bindings are used. |
