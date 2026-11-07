# Vellum phase 0: results

**Question:** can pdf.js inside Tauri render and navigate very large CAD PDFs smoothly enough,
or does rendering need to move to PDFium in the Rust backend?

**Recommendation: PDFium, from the start, as the only rendering engine.** Run it as a pool of
instances with spatial affinity (as prototyped). Keep pdf.js out of the product. Fit-page
rendering of image-heavy drawings still needs one more piece of work (image level of detail,
below) before it meets the targets. No configuration tested passes every criterion on your
real drawing, but PDFium gets closest by a wide margin and its remaining failures have known
fixes. pdf.js's failures are structural.

## Headline

On the one real drawing supplied (`projectlayoutmarch2021.pdf`):

| | pdf.js | PDFium, 8 instances | Target |
|---|---:|---:|---:|
| First page visible | 3.3 s | 2.4 s | 1.5 s |
| Sharp after settle, fit / 400% / 1600% | 1532 / 874 / 797 ms | 664 / 138 / 97 ms | 300 / – / 500 ms |
| Peak memory | 6.2 GB | 3.0 GB | 1.5 GB |

- **pdf.js fails on the real drawing at every zoom.** It walks every object on the page for
  every render, however little is visible, so zooming in never gets cheaper (about 800 ms at
  1600%). It also keeps all 844 decoded images in memory: 6.2 GB.
- **PDFium culls what's off-screen**, so zoomed renders cost only what's visible: 97 ms at
  1600%. Rendering runs in Rust, off the UI thread, and in parallel across instances.
- **Both fail fit page and first page on this file.** It holds 837 megapixels of aerial
  imagery (731 JPEG tiles at 1024²). At fit page every one of those pixels is decoded and
  resampled down to about 50 × 960 screen pixels. That's an image pipeline problem, not a vector
  one, and it needs level-of-detail decoding (see "What would close the gap").
- **Panning is never the problem.** Every file, engine and zoom holds 58–60 fps, which is this
  display's refresh cap. The compositor spends 0.2–0.4 ms per frame.
- **pdf.js's strengths are narrow.** It beat PDFium on pure vector lines (98 against 148 ms at
  fit) and on one huge embedded image (41 against 423 ms), because the GPU composites those.
  PDFium is within target on both apart from the big-image fit case, which the same image work
  fixes.

## Test machine and method

- AMD Ryzen AI 9 HX 370 (12 cores, 24 threads), 32 GB RAM, Windows 11 Pro (build 26200).
  WMI reports only the Radeon 890M iGPU (the RTX 4060 in the brief isn't visible to Windows
  here; it's probably in hybrid mode, with WebView2 on the iGPU). WebView2 runtime 157.
- Benchmark window: 1600 × 960 CSS px on a 2560 × 1440 monitor at **100% scaling and 60 Hz**,
  so device pixel ratio 1 and fps capped at 60. HiDPI cost measured separately with `--dpr 2`.
- Release build, no debugger. `tools/bench.mjs` launches the app 3 times per file; each launch
  runs the scripted sequence in `src/lib/perf/bench.ts` and exits. **Figures are medians of
  all samples across the 3 launches** (3 launches × 3 repetitions for settle and pan).
- **Cold start** = process spawn to the first frame after the window is shown. Rust init is
  about 20 ms of that; WebView2 startup is the rest. The OS file cache was warm, and a warm-up
  launch keeps Defender's first-run scan of a freshly built exe (about 1 s, once) out of the
  figures. True cold start after a reboot couldn't be measured unattended.
- **First page** = open command to every visible tile sharp at fit page, on screen.
- **Settle → sharp** = from the moment input settles (150 ms after the last input) to the
  frame showing every visible tile at the new scale *having been presented*: we draw it, then
  wait for the next animation frame, which Chromium paces on GPU completion. Tiles are dropped
  before each repetition, so every sample is a cold render at that scale. The zoom step is an
  animated ×1.25 towards the target, centred on the page.
- **Pan** = 2 s continuous circular pan (radius 400 px, about 1250 px/s) driven per frame,
  after rendering has gone idle. This is the "transform the existing bitmap" stage.
- **Peak memory** = maximum private working set summed across `vellum.exe` and all its
  WebView2 processes, sampled every 200 ms through the whole sequence (what Task Manager shows).
- Screenshots at each zoom are saved with the results so faults can be checked by eye.

## Results against the acceptance criteria

Section 7 applies to the real drawing and synthetic files 1, 2 and 4. "PDFium ×1" is a single
instance; "PDFium ×8" is the pool (one renamed DLL copy per worker, page split into 8 bands).
For file 4 the ×8 column comes from the final build, which keeps pages dominated by one large
image on a single band. (The earlier pooled build decoded that image once per band: 1656 MB.)

#### projectlayoutmarch2021.pdf (acceptance file)

| Measure | Target | pdf.js | PDFium ×1 | PDFium ×8 |
|---|---|---:|---:|---:|
| Cold start (ms) | ≤ 1000 | 647 ✓ | 578 ✓ | 661 ✓ |
| First page visible (ms) | ≤ 1500 | 3267 ✗ | 3117 ✗ | 2366 ✗ |
| Pan fps, fit page | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 400% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 1600% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Settle → sharp, fit (ms) | ≤ 300 | 1532 ✗ | 1494 ✗ | 664 ✗ |
| Settle → sharp, 400% (ms) | – | 874 | 196 | 138 |
| Settle → sharp, 1600% (ms) | ≤ 500 | 797 ✗ | 140 ✓ | 97 ✓ |
| Peak memory (MB) | < 1536 | 6176 ✗ | 2984 ✗ | 3034 ✗ |
| Worst pan frame (ms) | – | 34 | 32 | 34 |
| Missing tiles / errors | none | none | none | none |

#### 1-a1-200k-lines.pdf (acceptance file)

| Measure | Target | pdf.js | PDFium ×1 | PDFium ×8 |
|---|---|---:|---:|---:|
| Cold start (ms) | ≤ 1000 | 665 ✓ | 560 ✓ | 635 ✓ |
| First page visible (ms) | ≤ 1500 | 446 ✓ | 314 ✓ | 296 ✓ |
| Pan fps, fit page | ≥ 50 | 59 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 400% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 1600% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Settle → sharp, fit (ms) | ≤ 300 | 98 ✓ | 258 ✓ | 148 ✓ |
| Settle → sharp, 400% (ms) | – | 94 | 162 | 120 |
| Settle → sharp, 1600% (ms) | ≤ 500 | 95 ✓ | 125 ✓ | 110 ✓ |
| Peak memory (MB) | < 1536 | 953 ✓ | 688 ✓ | 848 ✓ |
| Worst pan frame (ms) | – | 67 | 19 | 34 |
| Missing tiles / errors | none | none | none | none |

#### 2-a1-50k-text.pdf (acceptance file)

| Measure | Target | pdf.js | PDFium ×1 | PDFium ×8 |
|---|---|---:|---:|---:|
| Cold start (ms) | ≤ 1000 | 616 ✓ | 581 ✓ | 646 ✓ |
| First page visible (ms) | ≤ 1500 | 781 ✓ | 280 ✓ | 264 ✓ |
| Pan fps, fit page | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 400% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 1600% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Settle → sharp, fit (ms) | ≤ 300 | 466 ✗ | 201 ✓ | 100 ✓ |
| Settle → sharp, 400% (ms) | – | 197 | 112 | 92 |
| Settle → sharp, 1600% (ms) | ≤ 500 | 216 ✓ | 100 ✓ | 88 ✓ |
| Peak memory (MB) | < 1536 | 1868 ✗ | 741 ✓ | 922 ✓ |
| Worst pan frame (ms) | – | 19 | 33 | 34 |
| Missing tiles / errors | none | none | none | none |

#### 3-a3-40-pages.pdf

| Measure | Target | pdf.js | PDFium ×1 | PDFium ×8 |
|---|---|---:|---:|---:|
| Cold start (ms) | ≤ 1000 | 661 ✓ | 557 ✓ | 610 ✓ |
| First page visible (ms) | ≤ 1500 | 147 ✓ | 80 ✓ | 98 ✓ |
| Pan fps, fit page | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 400% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 1600% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Settle → sharp, fit (ms) | ≤ 300 | 27 ✓ | 53 ✓ | 48 ✓ |
| Settle → sharp, 400% (ms) | – | 26 | 108 | 94 |
| Settle → sharp, 1600% (ms) | ≤ 500 | 30 ✓ | 101 ✓ | 92 ✓ |
| Peak memory (MB) | < 1536 | 497 ✓ | 683 ✓ | 706 ✓ |
| Worst pan frame (ms) | – | 35 | 18 | 35 |
| Missing tiles / errors | none | none | none | none |

#### 4-a1-raster.pdf (acceptance file)

| Measure | Target | pdf.js | PDFium ×1 | PDFium ×8 |
|---|---|---:|---:|---:|
| Cold start (ms) | ≤ 1000 | 701 ✓ | 562 ✓ | 638 ✓ |
| First page visible (ms) | ≤ 1500 | 898 ✓ | 447 ✓ | 864 ✓ |
| Pan fps, fit page | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 400% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 1600% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Settle → sharp, fit (ms) | ≤ 300 | 41 ✓ | 459 ✗ | 423 ✗ |
| Settle → sharp, 400% (ms) | – | 34 | 279 | 317 |
| Settle → sharp, 1600% (ms) | ≤ 500 | 34 ✓ | 265 ✓ | 359 ✓ |
| Peak memory (MB) | < 1536 | 1309 ✓ | 735 ✓ | 793 ✓ |
| Worst pan frame (ms) | – | 18 | 35 | 34 |
| Missing tiles / errors | none | none | none | none |

#### 5-a4-300-pages.pdf

| Measure | Target | pdf.js | PDFium ×1 | PDFium ×8 |
|---|---|---:|---:|---:|
| Cold start (ms) | ≤ 1000 | 613 ✓ | 567 ✓ | 608 ✓ |
| First page visible (ms) | ≤ 1500 | 114 ✓ | 47 ✓ | 100 ✓ |
| Pan fps, fit page | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 400% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Pan fps, 1600% | ≥ 50 | 60 ✓ | 60 ✓ | 60 ✓ |
| Settle → sharp, fit (ms) | ≤ 300 | 30 ✓ | 26 ✓ | 29 ✓ |
| Settle → sharp, 400% (ms) | – | 29 | 117 | 98 |
| Settle → sharp, 1600% (ms) | ≤ 500 | 28 ✓ | 94 ✓ | 93 ✓ |
| Peak memory (MB) | < 1536 | 423 ✓ | 656 ✓ | 634 ✓ |
| Worst pan frame (ms) | – | 33 | 33 | 34 |
| Missing tiles / errors | none | none | none | none |

## Variants

**pdf.js with its default CPU-backed canvases** (`--renderer pdfjs-cpu`; the app's pdf.js
path uses GPU canvases). No better overall, and worse on the real drawing.

| File | Cold start (ms) | First page (ms) | Pan fps fit / 400% / 1600% | Settle→sharp ms fit / 400% / 1600% | Peak memory (MB) | Faults |
|---|---:|---:|---|---|---:|---|
| projectlayoutmarch2021.pdf | 680 | 3717 | 60 / 60 / 60 | 1686 / 791 / 939 | 6943 | none detected |
| 1-a1-200k-lines.pdf | 640 | 448 | 60 / 60 / 60 | 133 / 132 / 109 | 1019 | none detected |
| 2-a1-50k-text.pdf | 645 | 731 | 60 / 60 / 60 | 370 / 235 / 250 | 1047 | none detected |
| 4-a1-raster.pdf | 610 | 897 | 60 / 60 / 60 | 69 / 43 / 42 | 1715 | none detected |

**HiDPI (`--dpr 2`, four times the pixels, as on a laptop panel at 200%).** Pan still holds
58–60 fps on both engines. pdf.js settle times barely move, because it's bound by walking
objects, not by pixels.

pdf.js:

| File | Cold start (ms) | First page (ms) | Pan fps fit / 400% / 1600% | Settle→sharp ms fit / 400% / 1600% | Peak memory (MB) | Faults |
|---|---:|---:|---|---|---:|---|
| projectlayoutmarch2021.pdf | 648 | 3063 | 60 / 60 / 60 | 1013 / 665 / 637 | 6533 | none detected |
| 1-a1-200k-lines.pdf | 609 | 414 | 60 / 60 / 60 | 98 / 103 / 90 | 1280 | none detected |
| 2-a1-50k-text.pdf | 635 | 815 | 60 / 60 / 60 | 453 / 186 / 186 | 1571 | none detected |
| 4-a1-raster.pdf | 765 | 864 | 59 / 58 / 59 | 47 / 44 / 47 | 1422 | none detected |

PDFium ×8 (this run predates the large-image band rule, hence 2.1 GB on file 4):

| File | Cold start (ms) | First page (ms) | Pan fps fit / 400% / 1600% | Settle→sharp ms fit / 400% / 1600% | Peak memory (MB) | Faults |
|---|---:|---:|---|---|---:|---|
| projectlayoutmarch2021.pdf | 619 | 1665 | 59 / 59 / 60 | 374 / 321 / 308 | 3417 | none detected |
| 1-a1-200k-lines.pdf | 590 | 465 | 59 / 60 / 59 | 200 / 305 / 288 | 1403 | none detected |
| 2-a1-50k-text.pdf | 616 | 381 | 60 / 60 / 60 | 132 / 212 / 263 | 1510 | none detected |
| 4-a1-raster.pdf | 690 | 1017 | 58 / 59 / 60 | 497 / 385 / 408 | 2112 | none detected |

PDFium ×8 at DPR 2 was *faster* on the real drawing than at DPR 1 (first page 1.7 s, fit
374 ms, against 2.4 s and 664 ms). I haven't found out why. My guess is that PDFium picks a
different image downsampling path when the output is larger, but that's unverified. It's worth
understanding, because it suggests the fit-page cost isn't fixed.

## Visual faults

- **No blank tiles, no seams, no missing content** in any run. Every settle reported all
  visible tiles present. I checked screenshots at fit, 400% and 1600% by eye for the real
  drawing and files 1 and 2. Tile edges are snapped to whole device pixels from a shared
  formula, so neighbours can't gap.
- **Dense hatching at fit page** (1.5–3.5 pt spacing at 41%) renders as near-solid grey in both
  engines, because the lines are under a pixel apart. PDFium's tone is slightly darker. At 400%
  both resolve it correctly and look identical.
- **Text** (50k dimension labels, including rotated ones) is correct in both at all zooms.
- **Flicker** can't be judged from screenshots. Worth a look by eye: Ctrl+Shift+R switches
  renderer live, then pan and zoom around the real drawing.

## Why pdf.js can't be tuned into passing

1. **No spatial culling.** pdf.js executes the page's whole operator list for every render and
   lets the canvas clip. On the real drawing that's about 800 ms per render at any zoom, and it
   runs on the WebView's main thread (time-sliced, but still there).
2. **Images live in the WebView.** Decoded images are held as bitmaps for the life of the page:
   6.2 GB on the real drawing. The 50k-text file reached 1.9 GB.
3. **One thread.** Canvas drawing can't be spread over cores; PDFium instances can.
4. The knobs that exist were tried: GPU against CPU canvases (no help), and rendering whole
   regions in one pass rather than per tile (already the design).

## Why PDFium, and why not a hybrid

- It wins wherever the content is complex, which is what CAD exports are: 7–8× faster zoomed
  on the real drawing, 2–5× faster on dense text, and half the memory.
- It runs in Rust, so heavy renders never touch the UI thread, and it scales with cores. The
  pool cut fit-page time on the real drawing from 1494 ms to 664 ms.
- It already provides what later phases need: text extraction and search (`FPDFText_*`),
  annotations (`FPDFAnnot_*`), page objects for measuring and snapping, and printing. So the
  brief's "pdf.js for the text layer" hybrid isn't needed. Two engines would mean two parsers
  that can disagree about the same file, and two memory footprints.
- Licence: PDFium is BSD/Apache. The prebuilt DLL (bblanchon/pdfium-binaries, 4 MB compressed)
  is bundled in the installer.
- Costs: about 650 MB baseline memory against pdf.js's 420 MB on light documents (extra
  instances and IPC buffers); simple pages re-render in about 100 ms rather than 30 ms (both
  invisible in use); and a native dependency to keep up to date.

## What would close the gap (next phase)

1. **Image level of detail (the big one).** At low zoom, decode JPEG images at 1/2, 1/4 or 1/8
   scale (libjpeg-turbo does this almost for free through DCT scaling) and cache those, so fit
   page on the real drawing touches about 13 MP instead of 837 MP. That should fix fit page,
   first page and memory together. It needs either a PDFium build that exposes scaled decode, or
   our own pass that renders page images at the right level. This is the main engineering risk;
   prototype it first.
2. **Persistent preview cache.** Store each page's preview on disk, keyed by file hash, so
   reopening a heavy drawing shows something immediately.
3. **Progressive first paint.** Bands finish at different times (335–1046 ms on the real
   drawing). Show each band as it lands instead of waiting for all of them.
4. **Large single images on PDFium** are re-decoded on every render (file 4: about 420 ms at
   fit, against 41 ms on pdf.js). The level-of-detail cache fixes this too.
5. **Memory guard.** Bounding PDFium's decoded-image cache by closing pages works, but
   re-parsing the real drawing costs 0.7–1.9 s, so it made fit renders 7 s. It's in the code but
   off (`VELLUM_PDFIUM_TRIM_MB`). Level of detail makes it unnecessary.

## How a weaker machine would fare

- **Panning:** fine anywhere. The compositor uses 0.2–0.4 ms of a 16.7 ms frame at DPR 1 and
  stays well under a millisecond at DPR 2, so even an old Intel iGPU has a large margin.
  120/144 Hz displays weren't available to test.
- **pdf.js settle times scale with single-thread speed.** A 2018-era U-series laptop is about
  2× slower single-threaded than this Zen 5, so expect roughly double (real drawing about
  1.6–3 s).
- **PDFium scales with cores.** The pool uses half the logical CPUs (max 8). A 4-core/8-thread
  machine gets 4 instances, so fit-page work on the real drawing would take roughly 1.2 s,
  while zoomed renders stay quick because they touch only 1–2 bands.
- **Memory doesn't change with the machine**; it's driven by the content. On a 16 GB laptop,
  pdf.js's 6 GB for the real drawing would push other apps into swap. PDFium's 3 GB is
  uncomfortable but survivable, and level of detail fixes it.

## Reproducing

```bash
npm run gen:synthetic
npm run tauri build -- --no-bundle
npm run bench -- --runs 3 --renderer pdfjs
npm run bench -- --runs 3 --renderer pdfium --pdfium-threads 8
node tools/results-table.mjs pdfjs pdfium-t8
```

Raw per-run JSON, screenshots and summaries land in `bench-output/` (git-ignored).
