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

## Against other viewers (`tools/viewer-bench`, 18 Nov, before the fix)

Being replaced by the overnight run below. Until then:

- **Cold open, five drawings, from launch:** Vellum 665 to 890 ms on the four ordinary
  drawings, 3.8 s on the aerial one (now about 2 s faster, not re-measured). Second to fourth
  of seven each time:
  - **1.3x to 2.0x faster than Acrobat** on ordinary drawings (1.33, 1.73, 1.89, 2.03);
  - behind the quicker of Foxit and PDF-XChange by 103 to 299 ms on ordinary drawings;
  - 1.4x to 25x faster than Chrome, 1.25x to 5.3x faster than Edge;
  - SumatraPDF quicker on one drawing (the stage plan, 671 against 890 ms).
  Taken at a 3 s quiet wait except Acrobat and SumatraPDF (10 s).
- **Launch to the whole sheet drawn, aerial drawing:** Vellum first at 4.1 s before the fix.
  Not sound: the other viewers' figures are sums of two steps at the old short wait.
- **After a zoom gesture ends:** wheel zoom, aerial drawing, fit page to 512%: Vellum 503 and
  521 ms last notch to settled, Chrome 180 and 182 ms. Typed zoom figures are not usable.

## What is open

1. **The still blur after a zoom lands**: the ease, then a 60 ms settle delay that exists only
   for wheel notches, then the render. Design, not regression. Next step 2.
2. **Stage plan at 1600%**: 198 ms on 18 Nov, 82 to 83 ms on both old and new builds on
   23 Nov. Probably a bench artefact (stale same-scale renders), not proven. Watch, don't chase.
3. **Unexplained, low priority:** repeat fit renders of the aerial drawing took 1.26 s inside
   the app at `e337efb` but 2.3 s in a standalone PDFium probe; and the memory shift above.

Closed: the regression on very long pages (fixed 23 Nov, `2eab73b`: pages of 200,000+ objects
are banded even at fit; aerial fit 2339 → 450 ms). The suspected PDFium cost step between
render scales does not exist. Details in the log, "Step 1 of Next steps".

## Next steps, in the order agreed with Matt

1. ~~Fix the one-worker rule~~ **Done 23 Nov.**
2. **Re-run the open tests on the fixed build, launch to whole sheet drawn as one timed step,
   propose the homepage number.** Running overnight 23 to 24 Nov (below). Fallback that needs
   no more work: "opens drawings 1.3 to 2x faster than Acrobat".
3. **The blur fix**: no settle delay after a flight, render during the ease, then the same
   for the wheel; measured with Vellum's own bench. Interactive: Matt judges by eye.
4. **Then finish the cross-viewer zoom comparison** (parked, below).

## Overnight run, 23 to 24 Nov (autonomous)

Matt away; questions batched for the morning, commits split by concern, no push.

**Steps and status:**

1. Tidy this doc; log moved to speed-diagnosis-log.md. *Done.*
2. viewer-bench: launch to whole sheet drawn as one timed step. *Design:* launch, press the
   viewer's fit-page key as soon as the window first shows anything, time on the launch
   stopwatch until settled (10 s quiet). Then read the zoom level: if it isn't the viewer's
   fit-page level (taken from a normal fit page in the same launch), the key was lost and
   the run is void. A mode with no zoom tests keeps launches short.
3. Trial on Vellum and one other viewer, frames checked.
4. Full run: plain cold open and launch to whole sheet, five drawings, seven viewers, one
   warm-up and 3 runs each, 10 s quiet for every viewer.
5. Check the saved frames by eye; void anything blank, blurred or wrong.
6. Refresh Vellum's own bench on the fixed build (the table above, if it moved).
7. Write up here, propose the homepage number with its working.
8. Commit: viewer-bench change, then docs.

**Assumptions:** the fixed build is `%TEMP%\vellum-smoke\heavy-band\vellum.exe` (`2eab73b`);
the five drawings are the 18 Nov set; median of 3 as before.

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
