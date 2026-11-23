# Speed diagnosis (scope)

Started 18 November 2026. This file is the current truth: what we know, what is open, what is
next. The dated working log (measurements, bisects, dead ends, corrections) is in
[speed-diagnosis-log.md](speed-diagnosis-log.md); read only the parts you need. Earlier ideas
and their results: [speed-handoff.md](speed-handoff.md).

## What the benchmarking is for (Matt, 22 Nov)

(a) **Know where we are starting from**, in numbers, rather than "feels slow" or "feels fast".
(b) **One small, snappy, true number for the homepage** for this release. More speed work
follows the release.

## Where Vellum stands (main `2eab73b`, 23 Nov)

Vellum's own bench (`tools/bench.mjs --runs 3 --pdfium-threads 8 --size 1600x960`, cold
renders, median of 3 launches):

| | Aerial drawing | Curtis Hall, page 1 | Stage plan |
|---|---:|---:|---:|
| First band (ms) | 1464 | 82 | 180 |
| First page complete (ms) | 1999 | 131 | 314 |
| Settle to sharp, fit / 400% / 1600% (ms) | 450 / 67 / 152 | 66 / 104 / 85 | 119 / 88 / 83 |
| Peak memory (MB) | 3221 | 1049 | 986 |

How to read it:

- **Times start at the open command, not at launch.** The app takes a further 330 to 390 ms
  to start.
- **Settle to sharp starts after the settle delay**, so it leaves out the ease and the 60 or
  150 ms wait a user also sits through.
- **Curtis Hall is page 1 only, a light cover sheet.** Its dense pages are slower (page 48:
  243 / 235 / 151 ms on 8 Nov, a 2560 x 1400 window; not re-measured).
- **Peak memory has shifted outside Vellum.** The same old exe read about 1030 MB on Curtis
  Hall and the stage plan on 23 Nov against 352 and 339 MB on 18 Nov. Re-take any memory
  figure on the day before quoting it, and compare builds only within one session.
- Bayou and Silverstone are not in this bench.

## Against other viewers (`tools/viewer-bench`, 23 Nov, fixed build `2eab73b`)

**Launch to the whole sheet drawn**, ms from process start, median of 3 after a warm-up,
10 s quiet wait for every viewer, cold (fresh copy of the file each run, Vellum's preview
cache cleared). Every viewer ends on its own fit page, the whole sheet, sharp: viewers that
open on part of a sheet get their fit-page key as soon as anything shows. Raw results:
`bench-output/viewers/20261123-0017` (whole sheet), `-0142` (plain opens), `-0216` and
`-0231` (Acrobat re-runs).

| | Aerial | Curtis Hall p1 | Stage plan | Bayou | Silverstone |
|---|---:|---:|---:|---:|---:|
| **Vellum** | **2717** | 820 | 1066 | **999** | 985 |
| PDF-XChange | 6776 | **695** | 803 | 1184 | **753** |
| SumatraPDF | 4663 | 1131 | **766** | 1902 | 1222 |
| Foxit | 6429 | 819 | 1238 | 1471 | 1091 |
| Acrobat | 10625 | 1761 | 1885 | 1649 | 1926 |
| Chrome | 9909 | 5610 | 1851 | 21296 | 1630 |
| Edge | not measurable | | | | |

- **Vellum is fastest on the aerial drawing (1.7x the next, SumatraPDF) and on Bayou.** On
  the three vector drawings it is second to fourth, 0 to 300 ms behind the fastest
  (PDF-XChange twice, SumatraPDF once).
- **Against Acrobat: 1.65x to 3.9x faster** (Bayou 1.65, stage plan 1.77, Silverstone 1.96,
  Curtis Hall 2.15, aerial 3.9). Against Chrome 1.65x to 21x.
- **Vellum's figures are its plain opens**: it opens on fit page, so its open is already
  the whole sheet (checked in the frames: same picture as a fit page, sharp). Its whole-sheet
  runs were voided by the tool's check on three drawings, wrongly: Vellum's reference fit
  page, reached from fit width, keeps finer tiles and so differs from its own open by 9 to
  17% of pixels while the open frame matches a plain open exactly (0.0%). Not a bug: the open
  renders at or above display resolution (`chooseRenderScale` rounds up).
- **Acrobat** opens at fit width, so only its whole-sheet runs count. Its aerial and Curtis
  Hall figures are raw times from runs the tool voided because Windows' "Font Capture" error
  box sat over the reference frame; every timed frame was checked by eye (whole sheet, no
  box). Its stage plan figure is from the re-run; the first run agreed (1945).
- **Edge** ignores the fit-page key (Ctrl+\), so it never shows the whole sheet; left out.
- **Chrome on Bayou** shows nothing for 21 s (the cover scan), then the whole sheet.
- Some figures are from 2 of 3 runs: Foxit's aerial and PDF-XChange's Curtis Hall (the key
  went before the window could take it, and the check voided the run), Acrobat's Silverstone
  (the error box covered the timed view).

**Plain cold open** (process start to the view settled, each viewer on its own opening view,
so not like for like): Vellum 2717 / 820 / 1066 / 999 / 985 ms in the order above. Acrobat
opens at fit width (8477 / 1725 / 1976 / 1492 / 2090), as do Foxit and PDF-XChange on the
aerial drawing (top of the sheet only). The 18 Nov "1.3 to 2.0x faster than Acrobat" compared
these opens; the whole-sheet table replaces it.

**After a zoom gesture ends** (unchanged, 22 Nov): wheel zoom, aerial drawing, fit page to
512%: Vellum 503 and 521 ms last notch to settled, Chrome 180 and 182 ms. Typed zoom figures
across viewers are not usable.

## Proposed homepage number (for Matt, 23 Nov)

1. **"Shows the whole drawing about twice as fast as Adobe Acrobat."** True on all five
   drawings (1.65x to 3.9x, median 2.0x), from launch to the whole sheet drawn, measured the
   same way in both. The working is the table above. Recommended.
2. "The whole sheet in about a second": 0.82 to 1.07 s on four drawings from launch, 2.7 s on
   a 5 m aerial drawing. True, but needs the caveat and invites the question "on what?".
3. Not claimable: "fastest PDF viewer". PDF-XChange is quicker on three of five drawings.

## What is open

1. **The still blur after a zoom lands**: the ease, then a 60 ms settle delay that exists only
   for wheel notches, then the render. Design, not regression. **Fixed for flights, merged 23 Nov**
   (see "Next steps", 3). Wheel zoom in progress on branch `wheel-sharp`.
2. **Stage plan at 1600%**: 198 ms on 18 Nov, 82 to 83 ms on both old and new builds on
   23 Nov. Probably a bench artefact (stale same-scale renders), not proven. Watch, don't chase.
3. **Unexplained, low priority:** repeat fit renders of the aerial drawing took 1.26 s inside
   the app at `e337efb` but 2.3 s in a standalone PDFium probe; and the memory shift above.

Closed: the regression on very long pages (fixed 23 Nov, `2eab73b`: pages of 200,000+ objects
are banded even at fit; aerial fit 2339 → 450 ms). The suspected PDFium cost step between
render scales does not exist. Details in the log, "Step 1 of Next steps".

## Next steps, in the order agreed with Matt

1. ~~Fix the one-worker rule~~ **Done 23 Nov.**
2. ~~Re-run the open tests, launch to whole sheet as one timed step~~ **Done overnight
   23 Nov.** Homepage number proposed above; Matt to choose.
3. **The blur fix, for flights (typed zoom, fit, actual size): done, merged into main
   23 Nov (`9bf1a90`) after Matt tried it and judged it good.** No settle delay after a flight, and its destination renders during the
   220 ms ease, held off screen until it lands. Tests: 5 new (each fails on the old code), all
   1228 front-end and 270 Rust pass. Measured with `tools/bench.mjs --flight` (new: the zoom
   step as a flight, timed from landing to sharp), median of 3, same session, builds
   `9977b60` (before) and `8391230` (after):

   | Landing to sharp, fit / 400% / 1600% (ms) | Before | After |
   |---|---|---|
   | Curtis Hall p1 | 147 / 197 / 163 | 31 / 31 / 28 |
   | Stage plan | 196 / 180 / 160 | 31 / 29 / 27 |
   | Aerial drawing | 478 / 246 / 230 | 196 / – / 107 |

   About 30 ms is the floor: the bench waits for the frame that shows the tiles and one more.
   The aerial drawing's renders outlast the flight, so it lands part way through. Its 400%
   figure is a bench artefact (two of three runs caught the previous step's "sharp" report:
   the flight bench needs a frame's wait after `dropTiles` before `whenSharp`; one real run
   read 232 ms). Matt tried it on 23 Nov and judged it good. 2c (ease length) still needs his go-ahead.
   **3d. The wheel: go-ahead 23 Nov, building on branch `wheel-sharp`.** Each notch renders
   its landing view during the ease, held off screen until it lands, with no 60 ms wait once
   that render is under way. Plan (a): render on every notch, aborting the last; bench a
   burst of notches against a single notch, and fall back to (b), render once notches pause
   for a frame, only if bursts get slower.
4. **Then finish the cross-viewer zoom comparison** (parked, below).

## Overnight run, 22 to 23 Nov (autonomous): done

Matt away; asked for next step 2, then next step 3. Commits split by concern, none pushed.

- Doc tidy: log moved to speed-diagnosis-log.md (`18dbc97`).
- viewer-bench `--whole-sheet` and `--open-only` (`27a48bc`), fixes after the run
  (`717a455`). The check against a later fit page catches a lost key but not a viewer whose
  fit-page key does nothing (Edge), and wrongly voids a viewer whose reference keeps finer
  tiles (Vellum) or shows an error box (Acrobat): **check the saved frames by eye**, as
  always. Raw times of void runs are now kept for that.
- Results and the proposed homepage number: above.
- Blur fix for flights: branch `land-sharp` (`9977b60` bench option, `8391230` fix).
- Vellum's own bench was not re-run: the table at the top is from the fixed build, 23 Nov.
- A suspected Vellum bug (a soft picture after fit page pressed during an open) turned out
  to be the tool's comparison: see the Vellum bullet above.

## The cross-viewer wheel zoom test: parked 22 Nov, about an hour from usable

Design (Matt's choices): Ctrl+wheel with the pointer on the middle of the sheet, from fit
page to 4x the viewer's own fit-width level; main figure is last notch to settled.

- **Works:** finding the sheet's centre for any PDF from the screen (`Centre.cs`); per-viewer
  notch count from the warm-up launch; Vellum (42 notches, lands on the exact centre);
  Chrome (15 notches; its landing spot not checked against Vellum's); SumatraPDF's
  fit-width level in its own units.
- **To do:** Foxit and SumatraPDF drop notches sent 50 ms apart, so the warm-up count does
  not hold in the timed gesture: slow the pace (150 to 200 ms) or calibrate with whole
  gestures at pace (Matt to choose). PDF-XChange reached its target but was voided by the
  blank-view test, which needs sharp edges and so rejects soft aerial imagery: void only a
  flat view. The first summary table still prints an empty typed-zoom column.
- **Parked for good unless asked:** Acrobat (ignores injected wheels three ways; raises an
  error box during runs) and Edge (shows no zoom level). Both stay in the open table.
- **Not built:** drag, reopen time, running a folder of PDFs by default.

## Running the tools: traps found the hard way

- **Always set `VELLUM_EXE`** for `tools/viewer-bench`. Its default,
  `%LOCALAPPDATA%\Vellum\vellum.exe`, resolves to an 8 November build when started from
  Claude's Bash tool. Rebuild and copy aside after any code change.
- **Build Vellum with `npm run tauri build -- --no-bundle`**, never a bare `cargo build
  --release`: that leaves out Tauri's production feature and the exe looks for the dev server.
  This machine: `source ~/.vellum-toolchain/env.sh` and
  `CARGO_TARGET_DIR=C:/Users/matt.james/.vellum-target` first. Copy the exe aside with
  `pdfium.dll` and `WebView2Loader.dll`.
- **viewer-bench takes over the mouse and keyboard** on the primary monitor, and refuses to
  start while Acrobat, Foxit, PDF-XChange or SumatraPDF is open. Take the bench lock
  (`mkdir ~/.vellum-bench.lock`, `rmdir` after) for it and for `tools/bench.mjs`.
- **A step is finished after 10 s without change** (`--quiet`). Shorter cut Acrobat and
  SumatraPDF off. One look at the screen takes 23 ms: read anything under 50 ms as "a frame
  or two".
- **Check saved frames by eye** (`bench-output/viewers/<stamp>/frames/`) before quoting any
  figure: blank pages, blurred placeholders and wrong builds have each passed as results.
- `tools/bench.mjs` discards the app's stderr. To read `VELLUM_PDFIUM_TIMING=1` output, launch
  the exe directly: `vellum.exe <file> --bench --bench-out <json> --pdfium-threads 8
  --bench-size 1600x960 [--bench-page N-1]`.
- viewer-bench build: `cd tools/viewer-bench && dotnet build -c Release`. Modes: `run`,
  `wheelprobe`, `methodprobe`, `probe`, `open`. Raw results under `bench-output/` are
  gitignored.

## Constraints

- Ask Matt before adding instrumentation. `VELLUM_PDFIUM_TIMING=1`, `[swap]` logs, the F12
  overlay and `perf-log.csv` are fine to use.
- Matt judges visual and feel changes himself; tell him exactly what to try.
- Engine (`src/lib/engine`, `src/lib/render`, `src/lib/view`) stays free of Svelte;
  `viewMath.ts` stays pure and tested; `src-tauri/tests/bands.rs` keeps passing.
- UK English; log strings ASCII; em-dashes sparingly.

## Follow-ups outside this scope

- **The homepage's 97 ms** (the spike's settle to sharp at 1600%) is true but not what anyone
  waits for. Replace it with the number from next step 2. The homepage session owns the copy.
- **Feel measures not built:** input to first changed frame, frame pacing during a drag that
  keeps reaching new content, reopen time. The spike's pan test only draws cached bitmaps
  (log, "Follow-ups outside this scope").
