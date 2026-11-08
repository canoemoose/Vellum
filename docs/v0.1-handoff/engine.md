# WP-Engine hand-over (branch `v0.1/engine`)

Brief: `docs/vellum-v0.1-brief.md` section 3.5 and the WP-Engine row of section 5. The
interface, streaming and viewer API are written up in ARCHITECTURE.md ("Documents (v0.1)",
"Streaming", "The viewer API (for the shell)"); this file is what the integrator and Matt
need beyond that.

## What I built

**Phase 1 (document ids, unblocks the other packages)**
- Multiple open documents. The backend keeps any number of documents under one id space
  for PDFs and images (`src-tauri/src/docs.rs`); each PDFium worker keeps a map of open
  documents with up to 16 parsed pages each. Commands: `doc_open`, `doc_render`,
  `doc_render_stream`, `doc_cancel`, `doc_thumbnail`, `doc_page_text`, `doc_outline`,
  `doc_find_scale`, `doc_close` (plus `doc_cached_preview` / `doc_store_preview`, below).
  Errors are UI-ready strings.
- Front-end `Renderer` per brief section 6, with a `docId` on every call; one
  `BackendRenderer` class implements it, `PdfiumRenderer` / `ImageRenderer` only differ in
  name, `rendererFor(path)` picks one.
- Image seam: `src-tauri/src/imagedoc.rs` stub with the final signatures and
  `src/lib/render/imageRenderer.ts`. Both now belong to WP-Images.
- Text access: page text (`FPDFText_GetText`) and bookmarks (`FPDFBookmark_*`), on the
  worker threads.
- Drawing-scale detection (`doc_find_scale`): `1:NNN`, `1 : NNN`, `1∶NNN`, standard `1/NNN`,
  ranked by a pure, tested function (`src-tauri/src/scale.rs`). The stage plan gives
  `1:200` from its title block in 9 ms.
- `PdfiumState::run_on_worker` / `run_on_worker_index` for WP-Print, and
  `Docs::open_pdf_bytes` to make a composed PDF an ordinary document.
- Page-load seam for WP-LOD: `pdfium.rs::load_page` is the only place pages are parsed.
- PDFium DLL copies shared and reused across launches (`%TEMP%\vellum-pdfium\<size>-<mtime>\`), written atomically and never overwritten; other folders cleaned on start. An interim per-process scheme cost about 300 ms per open in Defender scans (found by the integrator's bench).
- pdf.js removed: renderer, `pdfjs-dist`, asset copy script, postinstall hook, `--renderer`
  flag (still consumed so old command lines don't break), Ctrl+Shift+R. A missing
  `pdfium.dll` is now the error "pdfium.dll not found: run `node tools/fetch-pdfium.mjs`".

**Phase 2**
- Progressive paint: each band streams to the front end as raw bytes over a Tauri channel
  as soon as its worker finishes, is drawn at once, and the tiles it completes go straight
  into the cache. Previews and the two-stage zoom are unchanged.
- Workers 1..N pre-parse page 1 right after open (switch: `VELLUM_PDFIUM_PREFETCH=0`).
- Viewer features for the shell (all Svelte-free): detach / attach per tab, view rotation,
  cursor and viewport in page points as UI state, `centreOn`, `gotoPagePoint`, zoom presets,
  `previewFor` (mini map), low-priority thumbnails, `refreshCanvasColour`.
- Persistent preview cache on disk (brief section 7, item 1): reopening a heavy drawing
  shows its page at once.
- Bench records "first band" (open to first band on screen) next to "first page" (open to
  all visible tiles sharp), plus settle-to-first-band per zoom.
- Tests the spike lacked: the viewer scheduler against a stub renderer with fake timers,
  region-grouping edge cases, band splitting in Rust as a pure function, plus band assembly,
  rotation maths, thumbnails, tabs, scale detection, kind sniffing and the preview cache.

## Tests

- `npm test`: 99 tests (Vitest). New files: `engine/viewer.test.ts` (scheduler),
  `engine/viewer.features.test.ts` (progressive paint, rotation, page points, tabs, disk
  previews), `engine/thumbnails.test.ts`, `render/assembler.test.ts`, `render/regions.test.ts`,
  `view/rotation.test.ts`. Shared stubs in `engine/testkit.ts`.
- `cd src-tauri && cargo test`: `tests/bands.rs` (every pixel written exactly once, never past
  the buffer, across awkward sizes and band counts), `tests/scale.rs`, `tests/docs.rs`,
  `tests/previewcache.rs`, `tests/args.rs`.
- Not covered by automated tests: the PDFium calls themselves (text, outline, streaming,
  metadata) and the Tauri channel. Those were checked by running the release exe (below).

## Run on the release exe

`node tools/bench.mjs --runs 1 --pdfium-threads 8 --exe run/vellum.exe <files>` on the final
release build, one run per file, on a machine shared with four other workers' builds (so read
it as a smoke test, not a benchmark). All seven PDFs open, render, go sharp at every zoom and
pan at 60 fps with no render errors; the PNG fails with "Image support not built yet" as
expected until WP-Images lands. First band = open to first band on screen; first page = open
to every visible tile sharp.

| File | Cold start (ms) | First band (ms) | First page (ms) | Pan fps fit / 400% / 1600% | Settle→sharp ms fit / 400% / 1600% | Peak memory (MB) | Faults |
|---|---:|---:|---:|---|---|---:|---|
| projectlayoutmarch2021.pdf | 1185 | 1799 | 2600 | 60 / 60 / 60 | 672 / 149 / 113 | 3013 | none detected |
| Stage Plan Plenary & Breakout.pdf | 732 | 448 | 548 | 60 / 60 / 60 | 112 / 99 / 90 | 994 | none detected |
| 1-a1-200k-lines.pdf | 669 | 562 | 679 | 60 / 60 / 59 | 169 / 129 / 109 | 1117 | none detected |
| 2-a1-50k-text.pdf | 674 | 514 | 564 | 60 / 60 / 60 | 102 / 99 / 95 | 1105 | none detected |
| 3-a3-40-pages.pdf | 617 | 397 | 414 | 60 / 60 / 60 | 48 / 110 / 117 | 988 | none detected |
| 4-a1-raster.pdf | 414 | 965 | 965 | 60 / 60 / 60 | 415 / 288 / 351 | 854 | none detected |
| 5-a4-300-pages.pdf | 401 | 432 | 448 | 60 / 60 / 60 | 46 / 86 / 106 | 110 | none detected |
| test-image.png | – | – | – | – / – / – | – / – / – | – | 1 failed runs |

## Decisions and assumptions (one line each)

- One renderer class serves PDFs and images; the backend dispatches on kind, so `ImageRenderer` is a named subclass.
- Kind detection: extension first (`imagedoc::handles`), then sniffing for `%PDF-` or image magic.
- Document ids are never reused within a process.
- `Viewer.open` closes the attached document; tabs detach first. One viewer and canvas serve every tab; detached tabs keep up to 32 MB of page previews, tiles are dropped.
- All page-coordinate APIs use unrotated page points, y down from the top-left (same as scale bboxes and outline targets).
- Rotation is per document view and resets to 0 on open; cached tiles are unrotated, so rotating renders nothing.
- Scale ranking: position (bottom-right best), +1.5 for "scale" just before, +0.5 for standard ratios, −1.5 for 1:1; ratios outside 1..100000 dropped; slash form only for standard ratios ≥ 10.
- Outline: bookmarks with no destination in this document have `page: null`; the walk is capped at 20 000 nodes and depth 64 (cycle-safe).
- Text, outline and scale jobs go to PDFium workers round robin (each may parse the page on its own worker).
- Stream framing: band pixels then a 16-byte trailer (x, y, w, h); the command returns the band count because channel messages can arrive after it resolves.
- A band whose tiles are already complete gets no overlay bitmap (saves a second upload for one-band regions).
- Thumbnails run one at a time, only when the viewer is idle (no queue, no renders, 300 ms since input), newest first, 64 MB cache, downscaled from a cached preview when one is sharp enough.
- Preview cache key: size + mtime + FNV-1a of first and last MiB, not a full-file hash (hashing 837 MP files on every open costs more than it saves). Cache capped at 256 MB, WebP quality 0.85, off in `--bench`.
- Pre-parsing on all workers is on by default; it favours "all sharp" over "first band" on open (see known problems).
- `tools/bench.mjs` defaults to `--renderer pdfium`, rejects anything else, and finds the exe through `CARGO_TARGET_DIR` when set.
- `LaunchArgs.renderer` is no longer sent by Rust; `platform.ts` (WP-Shell's) still declares it, harmless.
- No new dependencies (npm or Rust). `pdfjs-dist` removed; ARCHITECTURE.md's table updated.

## What I couldn't verify

- **Anything visual beyond one snapshot.** I checked that every test file opens, renders and
  goes sharp with no render errors, and looked at one bench snapshot (the stage plan at fit, correct).
  Matt should look at: progressive fill on the aerial drawing (bands appear across the page
  before it goes sharp), rotation at 90/180/270 (no seams, correct orientation), and that
  nothing flickers when a band's overlay hands over to tiles.
- **Image documents end to end.** `imagedoc.rs` is a stub until WP-Images lands; opening an
  image currently fails with "Image support not built yet" (checked).
- **Password-protected PDFs.** The "Password required" / "Wrong password" mapping follows
  PDFium's error codes, but there's no protected file in `test-files/`.
- **Benchmark figures.** Single runs on a machine shared with four other workers' builds.
  Not comparable with RESULTS.md; the integrator's quiet-machine run is the real one.
- **Disk preview on reopen in the UI.** The store and the read path are unit-tested and a
  real run wrote `%LOCALAPPDATA%\Vellum\preview-cache\<key>-p0.webp`, but I can't see whether
  the soft page appears instantly on a second open.

## Known problems and rough edges

1. **First band on open is parse-bound on the aerial drawing.** Settle to first band at fit is
   about 0.35 s (the brief's "a third of a second"), but on *open* the page has to be parsed
   first (about 0.7 s on one worker, about 1.1 s when eight parse at once), so open to first
   band is 1.5 to 1.8 s. Pre-parsing on every worker made "first page" (all sharp) faster
   (about 3.2 s → 2.5 to 2.8 s in noisy single runs) but the first band slightly later.
   `VELLUM_PDFIUM_PREFETCH=0` restores the old order for comparison. The real fix is WP-LOD's
   or a scaled-decode PDFium build.
2. **Progressive paint costs about 160 to 190 MB of peak memory** on small drawings (the stage plan
   1056 against 899 MB with `--no-progressive`, the A3 set 893 against 701 MB; single runs).
   Pre-parsing is not the cause (the stage plan 1045 against 1040 MB with `VELLUM_PDFIUM_PREFETCH=0`).
   The likely causes are the extra copies held while a region streams: the JS region buffer
   in `RegionAssembler`, each band's channel buffer, and each band's overlay bitmap, freed
   only when the region completes or by GC. Ways to cut it: assemble tile-sized buffers
   instead of one region buffer, and skip band overlays for regions of a few tiles. First
   page is the same either way.
3. A thumbnail render already inside PDFium can't be interrupted; on a heavy page (about 1 s)
   a zoom that starts meanwhile waits for it. Thumbnails only start when the viewer has been
   idle for 300 ms, so this needs bad timing.
4. Cancelling still only skips requests that haven't started (unchanged from the spike).
5. Old DLL-copy folders are only removed on a later start (a running process's DLLs
   can't be deleted on exit), and only if over a minute old.
6. `doc_find_scale` on the aerial drawing returns `1:10` / `1:5` from small text, since it has
   no title-block scale; the shell should present it as a guess (it is the top candidate, not
   a certainty).

## For the integrator to fold in (not my files)

- README.md: remove "If it's missing, Vellum falls back to pdf.js" (it now shows the fetch
  instruction), the `--renderer pdfjs` sentence, the "Switch renderer" row of the table, and
  the `npm run bench -- --runs 3 --renderer pdfjs` line. Mention `VELLUM_PDFIUM_PREFETCH=0`
  only if you want it public.
- CLAUDE.md: bench command becomes `npm run bench -- --runs 3 [--pdfium-threads 8] [--dpr 2] [--only name]`
  (`--renderer pdfium` is accepted and is the default). Add to the toolchain notes: a release
  exe copied elsewhere needs `WebView2Loader.dll` beside it (GNU target), and a shared
  `CARGO_TARGET_DIR` is honoured by `tools/bench.mjs`.
- WP-Shell: use `initialUiState()` for the component's initial `UiState` (it gained fields),
  and call `refreshCanvasColour()` + `viewer.requestFrame()` after a theme change, or the
  canvas background keeps the old theme's colour.
- WP-Images: `docs.rs` calls `ImageDoc::open / page_size / note / render_region / thumbnail`;
  streaming sends images as one band, so `render_region` speed is what the user feels.
- WP-Print: `run_on_worker` closures run between renders on that worker; keep them short or
  split work across `run_on_worker_index(i, ...)`.
