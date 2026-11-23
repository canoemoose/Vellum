# Speed work: hand-over (8 November 2026)

For a fresh session picking up rendering, pan and zoom speed. Read this first, then
[v0.1-heavy-pdfs.md](v0.1-heavy-pdfs.md) (the Bayou image analysis) and the "Navigation"
and "Documents" parts of [ARCHITECTURE.md](../ARCHITECTURE.md).

## Where things stand

Matt's yardstick is Foxit: Vellum already beats most viewers on bitmap PDFs, Foxit still has
the edge on vector (Curtis Hall). His complaint was a visible wait and jump to sharp after a
zoom, plus multi-second stalls when zoomed out. Landed on main today:

| Commit | What |
|---|---|
| `49fdf92` | Bench options `--page N` and `--size WxH` |
| `e8c6172` | Cancelled renders skip every strip a worker hasn't started; small regions (≤ 0.5 MP) render whole on the page's own worker (`page % workers`) |
| `3899208` | Render scales quantised in 2^¼ steps and rendered a notch ahead on zoom-in (kept until 1.6x too fine on zoom-out); wheel zoom settles 60 ms after its ease lands (pinch keeps 150 ms); sharper cached copies drawn on top while tiles render; up to one small region per worker in flight |
| `1ccad08` | *10 Nov:* every cached scale is drawn under a rendering zoom, not just the two nearest, so scraps from cancelled renders no longer push a complete earlier render out and let the blurry preview show through |
| `9929e0a`, `847df53` | *10 Nov:* sidebar thumbnails render top-down, up to half the workers at once, drop pages scrolled away, and run beside a render that holds a single worker (Bayou's thumbnails no longer wait 6 s) |
| `acd32d2`, `7767993` | *10 and 11 Nov:* image swaps (`pdfium_swap.rs`): images PDFium would decode on every render are decoded once, with a per-profile colour check; Bayou fit 4.3 s → about 100 ms (idea 2) |
| (23 Nov) | Pages of 200k+ objects banded even when the region is small; the page profile (one band? object count?) is asked once per page, skipped if its render is cancelled; thumbnails always one worker; the front end asks the backend how many workers a render uses. Aerial fit 2339 → 450 ms (idea 2a) |
| branch `land-sharp` (23 Nov, not merged) | A flight (typed zoom, fit, actual size) renders its destination during the ease, held off screen until it lands, and settles on landing with no 60 ms wait. Landing to sharp on ordinary drawings about 150 to 200 ms → about 30 ms. Waiting for Matt's eyes (speed-diagnosis-scope.md, next step 3) |

Matt confirmed the zoom-out and pan stalls are fixed. *10 Nov:* he also judged thin lines at
up to 1.6x downscale (`RS_MAX_DOWN` in `src/lib/render/tiles.ts`) fine, so it stays.

### Numbers to beat

Curtis Hall page 48, 2560x1400 window, 8 PDFium threads, median of 3, settle→sharp in ms
(the stat starts *after* the settle delay, so add 60 ms for a wheel zoom):

| Build | Fit | 400% | 1600% |
|---|---:|---:|---:|
| Before today | 192 | 179 | 106 |
| Now (`3899208`) | 243 | 235 | 151 |

"Now" is slower per render because render-ahead draws more pixels; the win is that many
wheel notches need no render at all, which the bench can't see (it always zooms to a fresh
scale). Matt saw 250 to 350 ms in the stats box in real use before today.

Where the time goes on page 48 (from `VELLUM_PDFIUM_TIMING=1`):

- PDFium alone for a 2048x1536 region: fit 140 to 200 ms, 400% 25 to 40 ms, 1600% under 10 ms.
- At fit the 8 page bands are uneven: margin bands 16 to 20 ms, the dense middle 130 to
  150 ms. A render is as slow as its slowest band.
- First render of a page: each worker parses it, 230 to 550 ms (all 8 in parallel for a
  banded render).
- At 400% PDFium finishes in about 100 ms of a roughly 190 ms settle: **about 90 ms is
  the front end**. *Broken down 9 Nov (speed-ideas, Results C):* almost all of it is IPC.
  A 5 MB band takes 66 ms median from `Channel::send` to `onmessage` (211 ms p90, because
  bands queue at 140 to 200 MB/s); everything after receipt (assembly, band and tile
  bitmaps, cache) is 1 to 6 ms a band.

## Tried and rejected (don't redo without a new angle)

- **Start rendering mid-ease** (50 ms after the last wheel notch, at the landing scale).
  Notches more than 50 ms apart each started a full render that the next notch abandoned;
  before `e8c6172` cancelled work still ran to completion, so it piled up into 20 s hangs.
  With real cancellation it might now be viable, but the 60 ms settle took most of the gain.
- **More, smaller strips from a shared queue** (4 or 8 strips per worker, pulled by idle
  workers). Fit got slower (167 → 261 → 400 ms). A strip's cost tracks the objects crossing
  it, not its width, so thin slices of the dense middle each redo the same long lines and
  fills.

## Ideas, best first

1. **Cut the IPC cost of getting band pixels to the webview.** *Changed 9 Nov: test C
   measured it.* At 400% a 5 MB band takes 66 ms median (211 ms p90, bands queue) from
   `Channel::send` to `onmessage`; everything the front end does after that is about 3 ms.
   The real fix is the native surface under a transparent WebView2 (speed-ideas 4.1; test F
   says it's viable). The JS-side candidates (one bitmap per band, skipping the overlay,
   `OffscreenCanvas` assembly) are dropped: they shave the 3 ms, not the 66.
1a. **Bands are cut from the page, not from the view, so zoomed in only one to three
   workers render.** *Found 11 Nov; parked by Matt, important for later.* `split_region`
   divides the *page* into eight fixed bands along its long axis and sends band k to worker k.
   At fit the view covers the page and all eight work. Zoomed in, the view falls inside one
   or two page bands, so one or two workers render it and the rest idle. On the aerial
   drawing at 1600% a 4096 × ~3000 px region went out as two strips (4096 × 1435 and
   4096 × 1637, 131 to 163 ms each); at 400%, two or three strips of 200 to 280 ms. On Curtis
   Hall at 400% the view covers about a quarter of the page: two or three workers.
   - This is what Matt feels as a slow **zoom out, pan, zoom in** (the natural way round a
     drawing): on the aerial drawing from about 200% to 1200% at dpr 1, 315 ms settle→sharp,
     349 ms region render. Pausing before the zoom-in doesn't help, so it isn't left-over
     uncancellable work; plain panning is fine because it renders thin strips.
   - Fix: split the *region* into eight strips (along its own longer axis) instead of
     intersecting it with page bands. Expected on the aerial drawing at 1600%: slowest strip
     from about 150 ms to 20 to 30 ms, settle from about 210 ms to about 100 ms (the rest is
     the pixel transfer, idea 1). Keep `split_region`'s exact-coverage tests
     (`tests/bands.rs`): an off-by-one corrupts memory.
   - Risk: fixed page bands give each worker the same part of the page every time, so its
     decoded images get reused; region strips move with the view and may decode images
     again. Cheap for vector drawings, to be measured on image-heavy pages. Not the same as
     the rejected "more, smaller strips" (Tried and rejected, above), which was measured at
     fit, where region and page coincide.
   - Bench all five files at fit, 400% and 1600%, then Matt by feel.
2. **Heavy images.** *Done 11 Nov, checked by Matt; measurements and reasoning in
   [bayou-image-scope.md](bayou-image-scope.md), code in `src-tauri/src/pdfium_swap.rs`.*
   PDFium keeps a decoded image only between about 12 and 60 MB, and a lookup-table ICC
   profile costs it 170 to 240 ms per MP on every render it doesn't keep (Bayou's cover:
   4.2 s every render). Now swapped (decoded once, set into a second copy of the page): any
   image over 60 MB decoded, and any from 0.5 MP with a table profile. Pixels come from our
   decode plus `moxcms` when a per-profile check matches PDFium (v2 profiles do), otherwise
   from PDFium's own decode, once (v4 table profiles, CMYK, non-JPEG). Pages with a swap,
   or an image estimated at 150 ms or more to decode, render as one band. Bayou fit
   4,283 → about 100 ms. Colour still differs from Acrobat and Foxit (both richer); parked.
2a. **The aerial drawing (`projectlayoutmarch2021.pdf`) is slow at fit, and only at fit.**
   *Done 23 Nov: pages of 200,000 objects or more are
   banded even for a small region (`HEAVY_PAGE_OBJECTS`, `bands_for` in `pdfium.rs`).
   Aerial drawing, before / after: fit 2339 / 450 ms, first band 3432 / 1464 ms, peak
   memory 4998 / 3221 MB. Ordinary drawings unchanged. Details and the threshold's
   reasoning: speed-diagnosis-log.md, "Step 1 of Next steps". The notes below are the
   original probe.* *Probed 10 and 11 Nov; parked by Matt, may revisit with the native surface.* One
   746 × 14400 pt page with 327,207 objects (280,109 paths, 46,202 text, 896 images: 730
   DeviceRGB JPEG tiles of about 1 MP, 166 small Indexed images). Bench: first page about
   3.5 s, settle at fit 2.3 to 2.6 s, peak memory about 5 GB; 400% and 1600% are in line with
   the other files.
   - **Fit runs on one worker.** The fit view is a 70 × 1350 px strip, under the 0.5 MP
     `SMALL_REGION_PX`, so the whole render goes to the page's own worker: 2.2 to 2.4 s,
     every render, while seven workers idle. An eighth of the page takes 163 ms, so banded it
     would be roughly 300 ms. Fix: treat object-heavy pages (say over 50,000 objects) as
     never small. The small-region rule exists to stop workers thrashing when many pages are
     on screen, which doesn't apply to one giant page. Cost: every worker then parses the page
     (690 ms and 256 MB each).
   - **Two thirds of the fit time is images**, not vectors: images only 1,540 to 1,600 ms,
     paths only 800 ms, text only 7 ms. PDFium keeps the decoded images (the first fit render
     adds 2.3 GB to one instance, freed when the page closes) but shrinks 885 MP of them to a
     70 px strip on every render. That is what the ⅛ copies (`pdfium_lod.rs`, behind
     `VELLUM_IMAGE_LOD`) target; worth retrying with what we now know.
   - **Zoomed-in regions are cheap:** 512 × 512 at 400% takes 6 to 17 ms, 2048 × 512 27 to
     64 ms, and an off-screen 16 × 16 region 3 to 4 ms (PDFium culls well). Matt confirmed
     plain panning settles in a few tens of ms on this file and on Curtis Hall.
   - The earlier note that image work "can't help" was wrong: a single tile is cheap to
     decode, but at fit all 896 are resampled every render.
3. **One band for soft-mask and big-image pages.** *Superseded 11 Nov: banding the 50 MB sample
   turned out 2.4x faster at 400% than one band; pages now go to one band only for a swap or an
   image slow to decode (idea 2, bayou-image-scope.md).* *Was, 9 Nov, test D:* On the 50 MB sample,
   8-band strips cost 76 to 99% of what 2-band strips do, so banding multiplies the work.
   Extend the large-image one-band rule to these pages (speed-ideas 1.9).
4. **Pre-parse the next and previous page before they're needed.** First visit to a page
   costs 230 to 550 ms of parsing. *Tried 10 Nov for the pages on screen only: no gain, so
   it was stashed (`git stash list`, "Pre-parse visible pages").* A page on screen has
   already been parsed by the render that drew it: at fit a banded render parses it on all
   8 workers. Only a page first rendered small (one worker) and then zoomed into gained.
   Matt's measurement shows what the neighbour version would save: Curtis Hall at about
   400%, sidebar jump to a page parsed earlier at fit took 216 ms settle→sharp, to a page
   never visited 394 ms, so **about 180 ms per page** when stepping to the next one (not
   for sidebar jumps to a far page). The stash has the backend half ready (`prefetch` in
   `pdfium.rs`, the `doc_prefetch` command, a Rust test); the viewer would need to ask for
   the neighbours instead of the visible pages, one at a time and only while still idle,
   because a parse can't be cancelled and blocks that worker's next render. Measure memory
   per parsed page on Curtis Hall first (`PAGES_PER_DOC` is 16). Judged not worth it for
   now: build it only if paging through a document feels slow.
5. **Hold the old image until the new one is complete** (Foxit-style). Doesn't make sharp
   arrive sooner, but removes the visible band-by-band jump. Easy to try: don't draw target
   tiles or band overlays for a page until its visible set is complete, unless that takes
   longer than, say, 300 ms. Matt to judge by feel.
6. **Tune render-ahead.** `RS_AHEAD` (1.25), `RS_STEP` (2^¼) and `RS_MAX_DOWN` (1.6) in
   `tiles.ts`. If thin lines look faint at downscale, try `imageSmoothingQuality = "high"`
   only for scales drawn smaller than 1:1 before lowering `RS_MAX_DOWN`. Each render now
   costs 20 to 50 ms more; the trade is worth re-checking once idea 1 lands.
7. **True mid-strip cancel.** A strip already inside PDFium still runs to completion. PDFium's
   progressive API (`FPDF_RenderPageBitmap_Start` / `_Continue` with an `IFSDK_PAUSE`)
   would let a cancel stop it. Worth it only if heavy pages still show lag after a fast
   zoom-out.
8. **Shorter settle for trackpad pinch.** Still 150 ms after the last event. Matt uses a mouse
   90% of the time but doesn't want the trackpad to be bad; try 80 to 100 ms.
9. **Uneven bands on dense pages.** Splitting by area doesn't help (see above). A split by
   object count (bands sized so each holds a similar number of page objects, from
   `FPDFPageObj_GetBounds`) might. Research-y; only after 1 and 4. *9 Nov:* one PDFium
   thread renders all of page 48 at fit in 131 ms, the same as the dense band in an 8-worker
   render, so check first whether banding at fit helps this page at all.
10. **The 5 to 25% front-end settle gap** between `f9f0f10` and v0.1 noted in
   v0.1-heavy-pdfs.md is still unconfirmed. Settle it with an alternating 5-run bench.

Dropped by the 9 November tests ([speed-ideas.md](speed-ideas.md), Results):

- **MuPDF engine swap** (speed-ideas 4.3): 75% of PDFium's time at fit, 102% at 4×; misses
  the "under 70% at both sizes" bar.
- **Interim pass without anti-aliasing** (speed-ideas 1.5): anti-aliasing is 4.4% of the
  render.
- **JS-side front-end work** (old idea 1's candidates): about 3 ms a band of the 66.

## How to measure

Every cargo or tauri command needs the toolchain first:

```bash
source ~/.vellum-toolchain/env.sh && export CARGO_TARGET_DIR="C:/Users/matt.james/.vellum-target"
npm run tauri build -- --no-bundle
```

- **Copy the exe aside before benchmarking** (with `pdfium.dll` and `WebView2Loader.dll`
  beside it), e.g. to `%TEMP%\vellum-smoke\<name>\`. If Matt has Vellum open from
  `.vellum-target\release`, the build fails to link ("Permission denied"); don't kill his
  instance, ask him to close it.
- **Bench lock:** `mkdir C:/Users/matt.james/.vellum-bench.lock` before a run, `rmdir` after.
- **Bench:**
  `node tools/bench.mjs --runs 3 --pdfium-threads 8 --page 48 --size 2560x1400 --exe <exe> "test-files/3397 Drawings MMA Curtis Hall_Sec 1.pdf"`.
  Results go to `bench-output/pdfium-t8-p48-2560x1400/`. The bench measures one zoom to a
  fresh scale per rep, so it can't show render-ahead's benefit.
- **Per-strip timing:** run the exe directly with `VELLUM_PDFIUM_TIMING=1` and the bench
  flags (`<file> --bench --bench-out x.json --pdfium-threads 8 --bench-page 47 --bench-size 2560x1400`),
  stderr to a file. Logs page loads and every strip with its size and time.
- **PDFium in isolation:** an `#[ignore]` test in `src-tauri/tests/` that opens a file with
  `Docs::open` and times `PdfiumState::render` calls, run with
  `cargo test --release --test <name> -- --ignored --nocapture`. Delete it afterwards.
- Test files: `test-files/` (Curtis Hall is the vector one; pages around 48 are the worst;
  Bayou Towers is the heavy-image one).

## Working with Matt on this

Interactive: small steps, show each one. He judges visual and feel changes himself and his
reports are ground truth; tell him exactly what to try (file, page, gesture). Don't commit
until he asks. Ask before adding instrumentation he could answer by looking. Keep the
engine free of Svelte; navigation maths in `viewMath.ts` stays pure and tested.
