# Speed: further ideas and a two-hour test plan (8 November 2026)

Companion to [speed-handoff.md](speed-handoff.md) (where things stand, what was tried) and
[v0.1-heavy-pdfs.md](v0.1-heavy-pdfs.md) (the Bayou image analysis). Nothing here repeats
those; read them first. The yardstick throughout is Foxit on Curtis Hall page 48.

## Results (9 November 2026)

Section 5's tests A to F, run on main at `3899208` (release exe copied to
`%TEMP%\vellum-smoke\`), bench lock held for every timing. Medians of at least five runs.
All probes and config changes were removed afterwards; nothing here is in the code. Test G is
Matt's and not done yet.

### A. MuPDF against PDFium, one thread, whole page 48

Fit is 1980×1400 (119.73 dpi, MediaBox 1190.52 × 841.92 pt); 4× is 7919×5600 (478.92 dpi).
PDFium: a throwaway `#[ignore]` test, one instance, `FPDF_RenderPageBitmapWithMatrix` with the
app's flags into a whole-page bitmap, five processes. MuPDF: prebuilt `mutool` 1.28.5
(1.28.6's Windows zip isn't published), `draw -st`, five processes, page 48 six times each.
mutool's per-page time includes loading and interpreting the page every time (it has no
warm path), so it compares with PDFium's parse plus first render.

| | Fit (ms) | 4× (ms) |
|---|---:|---:|
| PDFium parse (FPDF_LoadPage) | 129 | 129 |
| PDFium first render after parse | 132 | 288 |
| **PDFium cold (parse + first render)** | **261** | **417** |
| PDFium warm (page already parsed) | 131 | 287 |
| **MuPDF, default (display list)** | **196** | **426** |
| MuPDF, `-D` (no display list) | 192 | 432 |
| MuPDF at 1 dpi (load + interpret, almost no raster) | 149 | 149 |
| MuPDF raster only (estimate: default minus 1 dpi) | ~47 | ~277 |

Cold, MuPDF is 75% of PDFium at fit and 102% at 4×. The raster-only estimate is about 36%
of PDFium at fit and 96% at 4×. The display list is worth nothing in a one-shot mutool run
(as expected; it pays only when one parse is rendered many times). PDFium open was 12 ms
(62 ms on the first, cold-disk process).

Side observation, not a test result: one PDFium thread renders the *whole* page at fit in
131 ms, which is the same as the handoff's dense middle band (130 to 150 ms) in an 8-worker
render. At fit on this page, banding buys almost nothing; the slowest band costs what the
page does.

### B. Anti-aliasing share (PDFium, page 48 at fit, warm)

Five processes, seven alternating renders of each flag set per process (median of the
per-process medians). No run includes the parse.

| Flags | ms |
|---|---:|
| App flags (`FPDF_ANNOT \| FPDF_REVERSE_BYTE_ORDER`) | 130.9 |
| + `NO_SMOOTHPATH \| NO_SMOOTHTEXT \| NO_SMOOTHIMAGE` | 125.1 |
| + `FPDF_RENDER_LIMITEDIMAGECACHE` (vs app flags re-run: 131.5) | 131.7 |

Anti-aliasing is 4.4% of the render. The limited image cache changes nothing.

### C. Front-end breakdown (Curtis Hall page 48, bench at 2560×1400, 8 threads)

Throwaway probes: Rust logged a wall-clock time just before each band's `Channel::send`; the
front end logged, per band, receipt in `channel.onmessage`, the `RegionAssembler.addBand`
copy, the band bitmap, the first and last tile `createImageBitmap`, and the band reaching
`onBand` (tiles into the cache). The bench (`--bench-page 47`, fit / 400% / 1600%, three
zooms each) drove the zooms instead of the wheel; five runs, 2100 bands. Page 48's parse
happens before the timed zooms. The two clocks agree to within about 5 ms (the smallest
send-to-receive gap was −4.9 ms), so read IPC figures as ±5 ms.

Median per band, ms (p90 in brackets):

| Zoom (rs) | Band MB | Send → receive (IPC) | `addBand` copy | Band bitmap | Last tile bitmap | Receive → tiles in cache |
|---|---:|---:|---:|---:|---:|---:|
| 400% (8.0) | 5.0 | **65.9** (211) | 0.5 | 2.2 | 2.6 (10.5) | 2.7 (11.2) |
| 1600% (32.0) | 15.1 | **101.3** (328) | 0.7 | 7.0 | 5.0 (12.1) | 5.8 (14.0) |
| fit (3.36) | 1.0 | **26.7** (59) | 0.1 | 0.9 | 1.1 (5.8) | 1.2 (6.4) |

`Channel::send` itself returns in under 0.1 ms. Bands queue: at 400% the first band of a
region takes 29 ms from send to receive and the later ones 103 ms; effective throughput is
140 to 200 MB/s. Everything the front end does after receipt is 1 to 6 ms a band.

### D. Soft-mask band scaling (`sample-50-MB-pdf-file.pdf`, one page)

`VELLUM_PDFIUM_TIMING=1`, bench at 2560×1400, five runs at 8 threads and five at 2. Per-strip
median at the same render scale:

| rs | 8 threads: px / strip, ms | 2 threads: px / strip, ms | 8-band cost ÷ 2-band cost (ideal 0.25) |
|---|---|---|---:|
| 1.83 (first render, right after the parse) | 0.52 MP, 163 | 2.10 MP, 164 | 0.99 |
| 2.38 (fit zoom) | 0.89 MP, 62 | 3.56 MP, 82 | 0.76 |
| 1.68 (start of the fit zoom) | 0.45 MP, 58 | 1.78 MP, 70 | 0.83 |

Every run's first render follows the page parse (337 to 420 ms per worker with 8 parsing
at once, about 150 ms with 2). Settle to sharp, 8 against 2 threads: fit 182 / 200, 400%
261 / 249, 1600% 217 / 218 ms. The page is not caught by the large-image one-band rule (it
rendered in 8 bands). The test can't say whether the soft mask or the big image's resample
is the per-band fixed cost; either way the cost follows the page, not the band.

### E. WebGPU in our WebView2

Over the DevTools protocol (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`;
release builds have no devtools window) in the release exe: `!!navigator.gpu` is `true`;
`requestAdapter()` returns a hardware adapter (AMD, `rdna-3`, not fallback,
`maxTextureDimension2D` 16384, `maxBufferSize` 2 GiB, `shader-f16`, `timestamp-query`);
`requestDevice()` succeeds. WebView2 runtime is Edge 157. One machine only.

### F. Transparent WebView2

`"transparent": true` in place of `backgroundColor` on the main window, `html, body, #app`
transparent in `app.css`, `npm run tauri dev`, then `.stage` made transparent and its canvas
hidden through the DevTools protocol. The window behind Vellum showed through the whole stage;
the custom title bar, menus, toolbar, sidebar and status bar drew normally. Reverted. Not
checked: resize, maximise, snap, the drag region, or any performance effect.

### Answers

- **Q1** No, not by the plan's bar: MuPDF is 75% of PDFium at fit and 102% at 4× (cold), so not
  under 70% at both sizes and within 20% at 4×. No MuPDF spike; the gap is the front end and
  the parse-per-worker. (Its fit raster alone looks about three times faster; noted, not acted on.)
- **Q2** 4.4%, under 15%: drop idea 1.5.
- **Q3** Before the first probe fires: send-to-receive is 66 ms median per 400% band (211 ms
  p90, as bands queue) against about 3 ms of front-end work, so WebView2's channel delivery is
  the cost and the native surface (idea 4.1) is the real fix.
- **Q4** With the page: 8 bands cost 76 to 99% of what 2 bands cost each, not 25%. Render
  these pages as one band (idea 1.9).
- **Q5** Yes, both, on this machine: WebGPU gives a hardware adapter (idea 4.2 can run in the
  webview) and a transparent WebView2 shows what's behind it (idea 4.1 is viable).

Nothing was skipped or left incomplete.

## 1. Ideas for tricky PDFs

Roughly in order of value. None of these is started.

1. **Persistent on-disk cache keyed by file identity.** Bayou's 4 s image decode is paid on
   every open, and drawing sets get opened many times across a job. Cache the decoded-image
   pyramid, a small whole-page preview per page and the per-page cost profile (item 6) under
   app data, keyed by path plus size, mtime and a hash of the first megabyte. Cap the total
   size, evict oldest first. Turns every "slow once" fix in v0.1-heavy-pdfs.md into "slow
   once ever".
2. **Route by image metadata before the first render.** v0.1-heavy-pdfs.md waits for a
   render to prove slow (over 500 ms) before decoding an image ourselves. PDFium reports an
   image's width, height, bit depth and colour space without decoding it
   (`FPDFImageObj_GetImageMetadata`). A 24 MP JPEG with an ICC colour space can go straight
   to the own-decode path, which fixes the 4.5 s first paint, not only re-renders.
3. **Per-page downscale tolerance.** `RS_MAX_DOWN` (1.6 in `tiles.ts`) is one global
   compromise. Image pages tolerate downscale; vector pages, where thin lines are the
   content, don't. Make the limit depend on page content: 1.6 for image-only pages, about
   1.2 for vector. Keeps the render-ahead win where it's harmless.
4. **A box-filtered pyramid for 1-bit scans.** Bayou pages 2 to 13 are 182 MP 1-bit images
   shown at fit, about 1/12 scale. Nearest or bilinear sampling of 1-bit data at that ratio
   drops thin scanned lines or makes them sparkle on pan. A greyscale pyramid built once
   from the decoded bitmap (about 11 MB at quarter size) looks much better. Check whether
   page 2 at fit looks ragged today before building it.
5. **Cheaper interim passes on slow pages.** PDFium has flags to skip anti-aliasing of paths,
   text and images (`FPDF_RENDER_NO_SMOOTHPATH`, `_NO_SMOOTHTEXT`, `_NO_SMOOTHIMAGE`). A
   page already known to be slow could use them, or render at half scale, for the first
   pass, with the full-quality pass following. Only worth it if anti-aliasing is a real
   share of the dense band's cost (test B below).
6. **A per-page cost profile.** Adaptive band boundaries, affinity, pre-decode, hold-old-
   image and downscale tolerance all want the same input: what this page cost last time and
   why. Record it once per page (band timings, image sizes, whether it has transparency),
   keep it in the on-disk cache, and the other ideas become lookups instead of heuristics.
7. **Adaptive band boundaries from the last render.** At fit on page 48 the dense middle
   band takes 130 to 150 ms while margin bands take 16 to 20 ms, so six of eight workers
   idle for most of the render. Instead of the object-count split (handoff idea 8), remember
   per-page band timings and move boundaries so each band's last measured time is similar.
   No PDFium object walk needed; pages are revisited often enough to pay off.
8. **Tell the user when a page will be slow.** If the cost profile or image metadata says a
   page will take over a second, show a quiet progress indicator rather than a frozen view.
9. **Check soft masks and transparency groups scale with the region.** The 50 MB sample has
   a soft mask. PDFium composites transparency groups in full buffers, so banding may make
   each band redo the whole group. If band cost on that page doesn't drop as bands shrink,
   those pages should render as one band, as big-image pages already do (test D).
10. **A deadline per worker.** A pathological page shouldn't stall the pool. Pair the
    progressive-render cancel (handoff idea 6) with a per-render deadline that surfaces
    "this page is slow" rather than hanging.

## 2. Other engines

| Engine | Expectation on vector | Cost | Notes |
|---|---|---|---|
| **MuPDF** (Artifex) | Faster, possibly by a wide margin | AGPL, or a paid commercial licence | The serious contender. Display lists: parse a page once into an immutable list, render it from any number of threads at any scale and band. Removes our biggest structural cost (every worker parses every page: 8 × 230 to 550 ms on Curtis Hall). Rust crate `mupdf` exists. Fidelity close to PDFium but not identical (fonts, anti-aliasing). |
| PDFium, Skia backend | Similar | Build PDFium ourselves | Chrome's viewer switched to it in 2023/24. Not expected to be faster on paths. Low value. |
| Foxit PDF SDK, Apryse (PDFTron), Nutrient (PSPDFKit) | Fast, native, properly multi-threaded | Expensive | Nutrient is a heavily modified PDFium fork; the others are their own engines. Trial licence only if MuPDF doesn't close the gap. |
| pdf.js | Already measured (RESULTS.md) | Free | Won narrowly on pure lines, lost everywhere else. |

## 3. How Foxit probably does it

Inference, not knowledge of their source. PDFium *is* Foxit's engine as it stood in 2014
when Google open-sourced it; Foxit has had twelve years of commercial work on their branch
since, including thread safety, progressive rendering and a display-list cache. The larger
difference is architectural: Foxit draws the page straight to the window through the native
graphics stack. Even where its UI is web-based, the page bitmap never crosses an IPC
boundary, is never re-wrapped as `ImageData` and never goes through `createImageBitmap`.
Vellum's roughly 90 ms front end on a 100 ms render (handoff, "Where the time goes") is
exactly the cost Foxit doesn't pay. Foxit also holds the old image until the new one is
complete, which is why it feels smooth even where it isn't faster.

## 4. Wild ideas

1. **Native surface under a transparent WebView2.** Foxit's trick in Tauri. The webview
   draws only the chrome, with a transparent background. Behind it a native Direct2D
   surface on the same window draws the page: PDFium renders into a bitmap that becomes a
   D2D bitmap and goes to screen with no copies. Pan and zoom of cached tiles become GPU
   compositing for free. Windows-only, which is the target anyway. Medium effort; deletes
   the front-end cost rather than shaving it. Feasibility check: test F.
2. **Stop rasterising vector pages at all.** Extract the page as a display list (paths,
   glyph outlines, image placements) through PDFium's page-object API or MuPDF's device
   interface, then render it on the GPU with Vello, the Rust compute-shader 2D renderer
   built for exactly this path density. Zoom becomes frame-rate: no tiles, no settle delay,
   no render-ahead, and lines are drawn at precisely the display scale so the thin-line
   worry disappears. Vello runs in the browser through WebGPU (WebView2 supports it; test
   E) or natively on the surface from idea 1. Pages with shadings, blend modes or soft masks
   fall back to the raster path. Highest payoff, highest risk, mostly fidelity: fonts are
   right only if glyph outlines come from the library, not system fonts.
3. **MuPDF display list plus cost-weighted bands.** The conservative version of idea 2: one
   parse, N threads rendering the same list, bands sized from the previous render's
   timings. Probably a 2× on fit zoom for Curtis Hall with no fidelity risk beyond the
   engine swap. Test A decides whether this is worth a spike.
4. **MuPDF compiled to wasm inside the webview.** Removes IPC entirely, but wasm is slower
   than native and threading needs cross-origin isolation headers. Likely a net loss.
   Listed so nobody tries it twice.

## 5. Two-hour test plan

Goal: leave with five answers, no code changes kept. Everything here is a throwaway probe
or a command-line measurement. Matt does the two visual checks; the rest is for whoever
is driving.

Questions:

- **Q1** Is MuPDF's rasteriser faster than PDFium's on Curtis Hall page 48? (A)
- **Q2** How much of the dense band's cost is anti-aliasing? (B)
- **Q3** Where do the 90 front-end milliseconds go? (C)
- **Q4** Do soft-mask pages scale with the band or with the page? (D)
- **Q5** Are the two wild ideas even possible in our WebView2? (E, F)

Plus two five-minute visual checks (G).

### Before starting (15 min)

```bash
source ~/.vellum-toolchain/env.sh && export CARGO_TARGET_DIR="C:/Users/matt.james/.vellum-target"
```

- Build the current main once (`npm run tauri build -- --no-bundle`) and copy the exe with
  `pdfium.dll` and `WebView2Loader.dll` to `%TEMP%\vellum-smoke\main\`. Matt closes any
  Vellum open from `.vellum-target\release` first.
- Download the prebuilt Windows `mutool.exe` from mupdf.com (releases page, the Windows
  zip) into its own empty folder, say `%TEMP%\mupdf\`. No build needed. If the download is
  not available for any reason, skip test A rather than trying to build `mupdf-sys` on the
  GNU toolchain; that is a day, not an hour.
- Page 48 of Curtis Hall is index 47 in our bench flags and page 48 in mutool (1-based).
  Note its MediaBox in points from `mutool info -M` so the dpi for "fit in 2560×1400" can
  be worked out: `dpi = 72 × min(2560 / width_pt, 1400 / height_pt)`.

### A. MuPDF against PDFium, single thread, whole page (30 min)

Apples to apples: both engines render the whole page at the same pixel size on one thread.

1. PDFium: the `#[ignore]` isolation test described in the handoff ("PDFium in isolation"),
   with `--pdfium-threads 1`, page 47, the fit pixel size and 4× that size. Time five
   renders, report the median. First render includes the parse; report it separately.
2. MuPDF: `mutool draw -st -r <fit dpi> -o nul "test-files/3397 Drawings MMA Curtis Hall_Sec 1.pdf" 48`
   and again at 4× the dpi. `-st` prints timing. Run each five times (mutool exits between
   runs, so every run includes open and parse; compare against PDFium's *first* render,
   and subtract the open cost shown by `mutool info` timing if it's significant).
3. Also run with `-D` (disable display list) at fit, to see what the display list is worth
   on this page.

Reading it: if MuPDF is under 70% of PDFium's time at both sizes, idea 4.3 is worth a
proper spike with the Rust crate (parse once, 8 threads on one display list). If it's within
20%, the engine isn't the problem and the gap is the front end and the parse-per-worker,
which items 1 and 3 in the handoff address without an engine swap.

### B. Anti-aliasing share (20 min)

Same isolation test, page 47 at fit, `FPDF_RenderPageBitmap` flags 0 against
`FPDF_RENDER_NO_SMOOTHPATH | FPDF_RENDER_NO_SMOOTHTEXT | FPDF_RENDER_NO_SMOOTHIMAGE`. Median
of five each. Also one render with `FPDF_RENDER_LIMITEDIMAGECACHE` to see if it changes
anything on this file (720 small images).

Reading it: under 15% difference, drop idea 1.5 entirely. Over 30%, the interim pass
without anti-aliasing is worth a feel test.

### C. Front-end breakdown (40 min)

The one test that needs probes in the app. Throwaway; they come out afterwards. In the band
receive path (`RegionAssembler.addBand` and the tile cache fill in `src/lib/render`), log
`performance.now()` deltas for: channel message received → band copied into the region
buffer → band overlay bitmap created → each tile's `createImageBitmap` resolved → tile in
cache. Print one line per band to the console, run the exe from `%TEMP%\vellum-smoke\probe\`,
zoom page 48 to 400% a few times with the stats box open, read the lines.

Reading it: the biggest bucket decides handoff idea 1's first move. If `createImageBitmap`
per tile dominates, do one bitmap per band and draw sub-rects. If the copy into the region
buffer dominates, move assembly to a worker with `OffscreenCanvas`. If the time is before
the first probe fires (message arrival itself), the IPC body is being copied by WebView2 and
the native surface (idea 4.1) is the real fix.

### D. Soft-mask band scaling (15 min)

Run `%TEMP%\vellum-smoke\main\vellum.exe` with `VELLUM_PDFIUM_TIMING=1` on
`sample-50-MB-pdf-file.pdf`, stderr to a file, at the default 8 threads and again with
`--pdfium-threads 2`. Compare per-strip times at fit.

Reading it: with 8 bands each band should cost about a quarter of what it costs with 2.
If 8 bands cost nearly the same each as 2 bands do, PDFium is compositing the whole
transparency group per band and the page should render as one band (idea 1.9).

### E. WebGPU in our WebView2 (5 min)

In the running app's devtools console: `!!navigator.gpu` and
`await navigator.gpu?.requestAdapter()`. An adapter object means Vello in the webview is
possible (idea 4.2); null means it would have to be native (idea 4.1 first).

### F. Transparent WebView2 over a native surface (10 min)

Set `"transparent": true` on the main window in `tauri.conf.json`, give `body` a
transparent background, run dev. If the desktop shows through where the page would be, a
native surface can sit behind the webview and idea 4.1 is viable. Revert afterwards.
(Tauri on Windows needs the `macos-private-api` feature only on macOS; on Windows
transparency is supported out of the box but check it doesn't break the shell's title bar.)

### G. Matt's visual checks (10 min total)

- **Thin lines at downscale.** Curtis Hall page 48, wheel-zoom out slowly from 400% to fit
  and stop between notches. Do thin lines go faint or patchy at any step before the sharp
  render lands? This decides whether `RS_MAX_DOWN` stays at 1.6 or idea 1.3 is needed.
- **Scan quality at fit.** Bayou Towers page 2 at fit, then pan slowly. Do thin scanned
  lines drop out or shimmer? Decides whether idea 1.4 earns its place.

### After the session

Record the five answers at the top of this file under a "Results" heading, with the
numbers, and update the "Ideas, best first" list in speed-handoff.md to reflect them.
Remove every probe from test C before anything is committed.
