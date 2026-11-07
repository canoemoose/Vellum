# Vellum Phase 0: build plan

Source of truth for the rendering/navigation spike. Brief: [docs/vellum-scope-spike.md](docs/vellum-scope-spike.md).
Updated as each stage finishes, so work can resume after a context reset.

## The question

Can pdf.js inside Tauri (WebView2) render and navigate very large CAD PDFs smoothly enough,
or must rendering move to PDFium in the Rust backend? Answer with numbers.

## Key decisions from the brief

- Stack: Tauri 2, Svelte 5 + TypeScript (strict), Vite, `pdfjs-dist` latest stable in its worker, npm.
- Licence: no AGPL (so no MuPDF). pdf.js and PDFium only.
- CAD navigation by default (middle-drag pan, wheel zoom at cursor ~12%/notch, middle double-click
  fit page, Space+left drag, Shift+wheel horizontal, Ctrl+wheel zoom, pinch zoom, keyboard).
  Document mode toggle (wheel scrolls), remembered between launches. Zoom 5% to 6400%.
- Continuous vertical layout plus single-page toggle. Render only near-viewport content.
- Tiled rendering, two-stage zoom (instant transform, sharp re-render ~150 ms after input settles),
  cancel stale renders, render at devicePixelRatio, LRU tile cache with a memory ceiling.
- Instrumentation overlay (F12): fps, settle-to-sharp, tile cache size/memory, JS heap; CSV log in
  `%LOCALAPPDATA%\Vellum\perf-log.csv`.
- Acceptance (section 7) on synthetic 1, 2, 4 and the heaviest real file: cold start <= 1 s, first page
  <= 1.5 s, pan >= 50 fps at fit/400%/1600%, sharp after settle <= 300 ms (fit) and <= 500 ms (1600%),
  no seams/missing content, memory < 1.5 GB. Fail anything: prototype PDFium (`pdfium-render`) and re-measure.
- Dark theme only, tokens from brief section 9, structured so light is a second token set.

## My design decisions

- **Single compositor canvas, not CSS-transformed tile elements.** One viewport-sized canvas
  (device pixels) redrawn on rAF from cached `ImageBitmap` tiles. The "transform the existing bitmap"
  stage is done by drawing cached tiles scaled, which is the same idea as a CSS transform but with
  integer-snapped tile edges, so no hairline seams, and both renderers (pdf.js, PDFium) feed the same
  bitmap cache. Rationale and trade-offs go in ARCHITECTURE.md.
- **World coordinates in PDF points.** View = scale `s` (CSS px per pt) and offset `t`;
  `screen = world * s + t`. Zoom 100% = actual size (1 pt = 96/72 CSS px).
- **Render a region per pass, slice into tiles.** pdf.js walks the whole page's operator list for every
  render call regardless of clip, so N small tiles cost N full passes. Instead, on settle, render the
  bounding box of missing tiles per page in one pass and slice into 512 px tiles for the cache.
- **Low-res page preview** under the tiles so panning into unrendered areas shows soft content, not blanks.
- **Renderer interface** (`open`, `renderRegion`, `cancel`) with pdf.js and PDFium implementations,
  selectable by `--renderer pdfium` / debug toggle.
- **Benchmark mode** built into the app (`--bench <pdf> --bench-out <json>`): scripted open, zoom,
  pan and settle sequence, writes results and exits. A Node harness (`tools/bench.mjs`) launches the
  release exe N times, samples process-tree memory, and computes medians into RESULTS.md tables.
- File loading: Rust command returns bytes as a binary IPC response; pdf.js `getDocument({ data })`.
- Settings persistence: `localStorage` (WebView2 profile is persistent). Good enough for one toggle.
- Unit tests: Vitest (shares Vite config, zero extra tooling) for the view maths and tile grid.

## Environment findings

- No Rust or MSVC Build Tools on this machine; not elevated. Plan: per-user rustup install.
  Try the `x86_64-pc-windows-gnu` toolchain first (no admin); fall back to MSVC if Tauri won't build.
- `npm` 12.0.2 warns it does not support Node 24.13.0. Pin a matching pair with Volta in package.json.
- Real file: `test-files/projectlayoutmarch2021.pdf`, 36 MB, 1 page, MediaBox 14400 x 746 pt
  (the PDF maximum width), 844 image XObjects. No `.gitignore` existed despite the brief; adding one.
- GPU: Windows only reports the Radeon 890M iGPU (the RTX 4060 isn't listed by WMI). WebView2 likely
  composites on the iGPU. Note in RESULTS.md.

## Stages

1. [ ] Toolchain + scaffold: Tauri 2 + Svelte 5 + TS, window opens a PDF (CLI arg, dialog, drag-drop).
2. [ ] View maths module + unit tests; input handling (CAD + Document modes, keyboard).
3. [ ] Tile grid, LRU cache, compositor, pdf.js region renderer, settle/cancel scheduler, previews.
4. [ ] Top bar (file, page n of N, zoom %, Fit page, Fit width, single/continuous, CAD/Doc).
5. [ ] Instrumentation overlay + CSV perf log.
6. [ ] `tools/gen-synthetic.mjs` (5 files) and `tools/bench.mjs` harness; bench mode in app.
7. [ ] Run measurements (3 runs, median), write RESULTS.md.
8. [ ] If pdf.js fails: PDFium renderer in Rust, measure again.
9. [ ] README.md, ARCHITECTURE.md, final summary.

## Open questions (batch for the end)

- (filled in as found)
