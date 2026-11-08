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

- No Rust or MSVC Build Tools on this machine; not elevated. Installed rustup per-user with the
  `x86_64-pc-windows-gnu` toolchain, plus a portable WinLibs MinGW in `~/.vellum-toolchain/mingw64`
  (needed for `dlltool`/`as`/`windres`). Build env: `source ~/.vellum-toolchain/env.sh`.
  `crate-type = ["rlib"]` because the MinGW linker can't emit the mobile cdylib (export limit).
- `npm` 12.0.2 warns it does not support Node 24.13.0. Pin a matching pair with Volta in package.json.
- Real file: `test-files/projectlayoutmarch2021.pdf`, 36 MB, 1 page, MediaBox 14400 x 746 pt
  (the PDF maximum width), 844 image XObjects. No `.gitignore` existed despite the brief; adding one.
- GPU: Windows only reports the Radeon 890M iGPU (the RTX 4060 isn't listed by WMI). WebView2 likely
  composites on the iGPU. Note in RESULTS.md.
- Displays: bench window lands on a 2560x1440 monitor at 100% and 60 Hz (dpr 1, fps capped at 60).
  `--dpr 2` override exists to measure HiDPI rendering cost.
- The first launch of a freshly built exe takes ~1 s longer (Defender scan). Harness does a warm-up launch.
- Real file analysis: 844 images = 731 JPEG tiles 1024x1024 + 113 Flate, 837 MP total. Fit-page
  render is JPEG-decode-bound in both engines (~1.2 s of decode).

## Stages

1. [x] Toolchain + scaffold: Tauri 2 + Svelte 5 + TS, window opens a PDF (CLI arg, dialog, drag-drop).
2. [x] View maths module + unit tests; input handling (CAD + Document modes, keyboard).
3. [x] Tile grid, LRU cache, compositor, pdf.js region renderer, settle/cancel scheduler, previews.
4. [x] Top bar (file, page n of N, zoom %, Fit page, Fit width, single/continuous, CAD/Doc).
5. [x] Instrumentation overlay + CSV perf log.
6. [x] `tools/gen-synthetic.mjs` (5 files) and `tools/bench.mjs` harness; bench mode in app.
7. [x] pdf.js measured. FAILS on the real file: first page 4.0 s, settle 1046/637/612 ms, 6.5 GB.
       Synthetic 2 (50k text) fails settle at fit (462 ms). Synthetic 1, 4 pass.
8. [x] PDFium renderer built and measured: single instance, then a pool of 8 instances (renamed DLL
       copies) with spatial-affinity bands, plus a large-image rule (one band). Real file: 664/138/97 ms,
       first page 2.4 s, 3.0 GB. Memory guard implemented but off (re-parse cost).
9. [x] README.md, ARCHITECTURE.md, RESULTS.md written. Installer builds (NSIS, pdfium.dll bundled).
       Recommendation: PDFium only; next phase = image level of detail for fit-page on image-heavy files.

## Open questions (batch for the end)

- More heavy real files. The stage plan (vector-dense, 74k paths) was added after the main
  runs and passes everything on both engines (RESULTS.md). Heavier rigging plots and venue plans
  would still be useful.
- Install MSVC Build Tools on the dev machine (the spike used the GNU toolchain + portable MinGW).
- Why PDFium x8 at DPR 2 is faster than at DPR 1 on the real file (unexplained).
- Does wheel zoom classify correctly on Matt's mice (debug overlay shows the last wheel event)?
