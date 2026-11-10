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
2. **Bayou-style heavy images.** *Built 10 Nov, awaiting Matt's check by eye; see
   [bayou-image-scope.md](bayou-image-scope.md).* The 4 s per render was PDFium converting
   the 24 MP scan through its 188 KB scanner ICC profile, every time; the JPEG decode itself
   is 78 ms. JPEGs of 16 MP or more are now decoded by us at full size, converted to sRGB
   with `moxcms` (matches PDFium to about a level per channel) and swapped in: fit 4,283 →
   187 ms, 400% 936 → 90 ms, about 155 MB more memory. No ¼ / ½ levels needed. Colour
   differs from Acrobat and Foxit (both richer); not the intent, black point or display
   path, parked.
2a. **The aerial drawing (`projectlayoutmarch2021.pdf`) is slow because of vectors, not
   images.** *Probed 10 Nov.* One 746 × 14400 pt page with 327,207 objects (280,109 paths,
   46,202 text, 896 images). Its 730 JPEG tiles are about 1 MP, DeviceRGB, no profile, and
   PDFium decodes one in 1.5 ms (ours 2.3 ms), so image work (our decode, the ⅛ LOD copies)
   can't help it. A whole-page render costs 1.3 to 2.4 s even at 50 × 965 px: the cost is
   walking the objects. Candidates: renders that touch fewer objects (bands sized by object
   count, idea 9) or a parse-once display list (the MuPDF idea, speed-ideas 4.3, dropped on
   Curtis Hall's numbers but this file is the case it was made for).
3. **One band for soft-mask and big-image pages.** *New 9 Nov: test D.* On the 50 MB sample,
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
