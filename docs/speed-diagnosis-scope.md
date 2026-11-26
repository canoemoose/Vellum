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

From before the zoom fixes (flights, wheel, the 4 px landing): the settle-to-sharp row is
out of date; for zoom, see "The cross-viewer zoom test" below. The open figures stand.

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

## Homepage number: "Zoom to sharp in 16 ms" (Matt, 23 Nov, provisional)

Matt wanted a number that feels small. Chosen: **"Zoom to sharp in 16 ms."** From the app
bench after the flight and wheel fixes (`tools/bench.mjs --wheel 1` and `--flight`),
landing to sharp, fit / 400% / 1600%:

| | One wheel notch (ms) | Typed zoom or fit (ms) |
|---|---|---|
| Curtis Hall | 16 / 17 / 17 | 31 / 31 / 28 |
| Stage plan | 17 / 17 / 17 | 31 / 29 / 27 |

Provisional until:

1. **It is measured from the screen**, as the Acrobat comparison was (`tools/viewer-bench`).
   *Done 24 Nov (single notches, below):* from the zoom finishing to sharp, Vellum 0 / 33 /
   49 ms on Curtis Hall / the stage plan / the aerial drawing (16 to 17 ms in-app plus the
   screen's grab interval), after the 4 px landing fix it exposed. From the screen the
   honest wording is "a frame or two". Only Foxit matches it, on the stage plan only. Still
   to do: the same run with every viewer in one session, on all five drawings.
2. **"On typical drawings" goes with it** (a subline or footnote): the aerial drawing lands
   sharp 50 to 500 ms after a zoom, its large bands being slow to reach the screen.
3. **16 ms is one frame at 60 Hz**: on a faster screen it is one frame, less than 16 ms.
4. Typed zooms and fits measure about 30 ms, not 16: "zoom" on the homepage should mean the
   wheel, or the line says "a frame or two".

Not chosen: "Shows the whole drawing about twice as fast as Adobe Acrobat" (true on all five
drawings, 1.65x to 3.9x, median 2.0x; still usable elsewhere); "the whole sheet in about a
second" (the stage plan takes 1,066 ms). Not claimable: "fastest PDF viewer" (PDF-XChange is
quicker on three of five drawings).

## What is open

1. **The zoom comparison in one session.** The other viewers' zoom figures were taken before
   Vellum's 4 px landing; Bayou and Silverstone were left out to keep the run short. Rerun
   all five viewers on all five drawings with the final build (about 35 minutes, machine
   unusable) before quoting any zoom figure. Matt: later.
2. **Watch: a jerk on a slow free-spin** of the wheel (3d below). Fix (d) if it comes back.
3. **Band delivery on heavy drawings:** after a zoom on the aerial drawing, a third of
   notches take 480 to 720 ms to sharpen, spent getting bands of up to 20 MB to the webview
   (handoff idea 1), not in PDFium.
4. **Stage plan at 1600%**: 198 ms on 18 Nov, 82 to 83 ms on both old and new builds on
   23 Nov. Probably a bench artefact (stale same-scale renders), not proven. Watch, don't chase.
5. **Unexplained, low priority:** repeat fit renders of the aerial drawing took 1.26 s inside
   the app at `e337efb` but 2.3 s in a standalone PDFium probe; and the memory shift above.

Closed: the still blur after a zoom lands (flights `9bf1a90`, wheel `d90b120`, both 23 Nov;
the ease's soft tail `cc93208`, 24 Nov). The regression on very long pages (fixed 23 Nov, `2eab73b`: pages of 200,000+ objects
are banded even at fit; aerial fit 2339 → 450 ms). The suspected PDFium cost step between
render scales does not exist. Details in the log, "Step 1 of Next steps".

## Next steps, in the order agreed with Matt

1. ~~Fix the one-worker rule~~ **Done 23 Nov.**
2. ~~Re-run the open tests, launch to whole sheet as one timed step~~ **Done overnight
   23 Nov.** Homepage number chosen (provisional): see above.
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
   read 232 ms). Matt tried it on 23 Nov and judged it good. 2c (ease length) dropped 23 Nov: it was
   my guess that big jumps move too fast to follow, never something Matt saw.
   **3d. The wheel: done, option (a), Matt's choice 23 Nov after the (b) comparison
   below; merged into main 23 Nov, with one thing to watch (the free-spin jerk, below).** Each notch renders
   its landing view during the ease, held off screen until it lands, with no 60 ms wait once
   that render is under way. Plan (a): render on every notch, aborting the last; bench a
   burst of notches against a single notch, and fall back to (b), render once notches pause
   for a frame, only if bursts get slower.
   6 new tests (each fails on the old code), all 1233 front-end pass.
   `tools/bench.mjs --wheel N` (new: N notches 40 ms apart, timed from landing to sharp;
   the bench also now skips a stale "sharp" report from the step before). Median of 3,
   same session, `wheel-before` = the same tree with main's viewer.ts:

   | Landing to sharp, fit / 400% / 1600% (ms) | 1 notch before | after | 3 notches before | after |
   |---|---|---|---|---|
   | Curtis Hall p1 | 133 / 183 / 150 | 16 / 33 / 17 | 149 / 166 / 200 | 15 / 176 / 45 |
   | Stage plan | 183 / 167 / 150 | 16 / 17 / 17 | 200 / 250 / 183 | 16 / 132 / 89 |
   | Aerial drawing | 533 / 233 / 200 | 516 / 50 / 199 | 648 / 284 / 216 | 583 / 283 / 192 |

   One notch: ordinary drawings land sharp (about 16 ms is the bench's floor). A burst gains
   less, and nothing at Curtis Hall 400%: each notch's renders are aborted by the next, but a
   band already running finishes first, holding the workers. Not slower than before, so by
   the rule above (a) stands, but (b) would likely recover the burst. The aerial drawing, looked
   at 23 Nov (timing log, plus a throwaway test of the bench's steps at its page size):
   - **Fit is a bench artefact.** Its fit is 5%, the minimum zoom, so the bench's start
     "1.25x out" is clamped and the notch barely moves (a 32 ms ease). Both builds time a
     cold render from `dropTiles`; nothing to hide it in. A flight always takes 220 ms, which
     is why flights gained there.
   - **400% and 1600%: the scheduling is right.** Every landing tile is planned during the
     ease, at the scale it lands on, rendered once, and nothing is planned after landing.
     PDFium's bands finish in 30 to 175 ms, inside the 240 ms ease. Yet landing to sharp
     is still 50 to 200 ms and swings run to run (this run: 150 to 167 at 400%, 49 to 66 at
     1600%; the bench's medians the other way round). So the time goes after PDFium:
     getting bands of up to about 20 MB each to the webview and into the cache, the IPC cost
     of handoff idea 1. Likely, not proven: band delivery competes with the ease's frames
     on the webview's main thread. Proving it needs front-end timestamps (not added).
   - **(b) built and benched 23 Nov: worse.** A wheel ease starts rendering once notches
     pause for 50 ms (`WHEEL_PAUSE_MS`). Same session, median of 3, landing to sharp (ms),
     fit / 400% / 1600% (Matt's own Vellum was open, sharing WebView2's browser process,
     which also lowers the memory figures):

     | | 3 notches before | (a) | (b) | 1 notch (a) | (b) |
     |---|---|---|---|---|---|
     | Curtis Hall | 133 / 166 / 200 | 16 / 97 / 83 | 17 / 45 / 104 | 16 / 17 / 17 | 16 / 99 / 66 |
     | Stage plan | 183 / 200 / 167 | 16 / 58 / 111 | 16 / 68 / 71 | 17 / 17 / 17 | 16 / 99 / 70 |
     | Aerial drawing | 566 / 282 / 215 | 666 / 299 / 225 | 433 / 200 / 200 | 384 / 200 / 100 | 468 / 50 / 245 |

     On a burst (a) and (b) are within the noise (this session's (a) burst was much better
     than the first session's). On one notch, the common case, (b) costs 50 to 80 ms at 400%
     and 1600%: the pause pushes the render past the end of the ease. Back to (a) (Matt, 23 Nov);
     (b) removed.
   - **Watch: a jerk on a slow, steady free-spin (Matt, 23 Nov).** With the MX Master's
     wheel free-rolling (still one event per notch, just no detents), a slow continuous
     spin on Curtis Hall p61 between 80 and 800% felt jerky; the old build and 0.2.0-rc2
     slightly, this build more. Not noticeable with the wheel notched, and hard to tell
     even free-rolling. `tools/bench.mjs --spin --page 61` (new: ten notches in from 80% at
     100, 200 and 300 ms gaps, every frame timed) found no difference, at 1380 x 850 or
     2560 x 1320: 0 to 2 dropped frames per spin, none over 50 ms, both builds. So the
     page draws on time; if the jerk is real it is outside the frame loop. Untested
     guesses: wheel events delayed in WebView2's browser process by band IPC during the
     spin, or late presentation. Matt merged as is (a single notch's gain is clear, the
     jerk is faint). If it comes back in use, the fix is (d): a notch within 500 ms of the
     last behaves as before (no render during the ease, 60 ms settle), so a spin is the
     old code by construction and a single notch keeps the gain.
4. ~~**The cross-viewer zoom comparison, as single notches**~~ **Run 23 to 24 Nov** (below);
   it found and fixed the ease's soft tail. One same-session rerun left (open, 1).
5. **Then, if speed work continues: band delivery to the webview** (handoff idea 1), the
   biggest gain left; scope it first.
   Being fastest in every scenario (start-up, band delivery, the ease, untested scenarios)
   was thought through on 24 Nov and parked: [fastest-everywhere.md](fastest-everywhere.md),
   in the backlog.

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

## The cross-viewer zoom test: single notches (agreed 23 Nov, run 23 to 24 Nov)

Replaces the parked 4x wheel gesture (22 Nov; its notes are in the log and git history).
The figure behind "Zoom to sharp in 16 ms", measured from the screen in every viewer.

**Measure (Matt, 23 Nov): from the zoom finishing to sharp.** The ease is the zoom, not a
wait (the view moves on the next frame), so each viewer is timed from when its picture
stops moving, whether it eases (Vellum) or jumps (Chrome). Also reported: notch to first
change, and notch to sharp (the total).

**Single notches, not a gesture** (Matt, 23 Nov): a multi-notch gesture makes the pace a
hidden variable (more time between notches lets viewers render intermediate zooms, which
helps or hurts each differently), and Foxit and SumatraPDF dropped notches sent 50 ms
apart. One notch at a time from a settled, sharp view has no pace, and matches the in-app
figure.

Design (as built, 23 Nov; `ViewerBench.exe run --notches`, code in `tools/viewer-bench/Notch.cs`):

1. Per launch: open, fit page, find the sheet's centre (`Centre.Find`), pointer there. Then
   six times: one Ctrl+wheel notch, record until still for the quiet time. Each notch starts
   settled and sharp; six cover fit page up to several times fit, at each viewer's own step.
2. Every screen grab during a notch is kept with its time (about every 20 ms). **Sharp** =
   the last change. **Zoom finished** = the first picture from which every later one has
   the final picture's geometry, sharp or not: the **alignment test**. The view is cut into
   3 x 3 regions; in each, the shift that best lines the picture up with the final one is
   found by correlation, first on every third pixel (up to 12 px), then on full-resolution
   pixels (up to 3 px). A region has moved only on a confident shift (a good match that
   clearly beats no shift) of more than the tolerance.
3. **Tolerance 2 px (Matt, 23 Nov):** Chrome's stretched frames (the old picture scaled to
   the new zoom, then replaced by a sharp one) sit 1 to 2 px from the final position; Matt
   judged one "in place". The same rule applied to Vellum counts the last 25 to 67 ms of its
   ease (within 1 to 2 px, drawn from the previous tiles scaled) as finished, so its screen
   figure is sometimes above its in-app 17 ms. 1 px and 2 px gave identical results.
4. **What failed first, so it isn't tried again:** block means within 6 levels (a soft
   render's thin lines come out lighter or darker, so soft counted as moving); block-by-block
   correlation (sparse line work in 24 px blocks is too fragile: Chrome's stretched frame had
   a quarter of blocks under 0.4); exact alignment (misses stretched frames 1 to 2 px off).
   The check that exposed them: Matt reading saved frames. Vellum's in-app figure alone
   can't validate the test, because Vellum never shows a soft stage.
5. **Check on the method:** Vellum runs with `VELLUM_PERF_LOG`, logging each landing to sharp
   from inside the app; `analyse <run dir> [--tolerance px] [--why]` re-runs the test on a
   run's saved grabs (`--keep-raw`) and prints each picture's verdict. `--frames` saves every
   changed grab full size in colour, marked FINISHED and SHARP.
6. Viewers: Vellum, Chrome, SumatraPDF, Foxit, PDF-XChange; Edge tried separately (it ignores
   the fit-page key, which `Centre.Find` uses). Acrobat stays out: it ignores injected wheel
   events. Run (Matt, 23 Nov: two hours was too long): Curtis Hall, the stage plan and the
   aerial drawing, two launches each, no warm-up (it only ever helped open times), quiet
   2.5 s; about 20 minutes.

**Results (23 to 24 Nov; per-notch data in `bench-output/viewers/notches-*`).** Zoom finished
to sharp / notch to sharp, median of 12 notches (two launches of six), from the screen:

| | Curtis Hall | Stage plan | Aerial drawing |
|---|---|---|---|
| Vellum, ease landing at 4 px (24 Nov) | 0 / 114 ms | 33 / 115 | 49 / 146 |
| Vellum before (formal landing) | 0 / 182 | 82 / 196 | 101 / 199 |
| Chrome | 0 / 447 | 133 / 164 | 209 / 382 |
| SumatraPDF | 0 / 81 | 132 / 181 | 1,400 / 1,448 |
| Foxit | 0 / 64 | 0 / 98 | 215 / 465 |
| PDF-XChange | 15 / 64 | 66 / 113 | 166 / 231 |

Edge could not be measured (it ignores the fit-page key `Centre.Find` uses). Vellum's own
landing-to-sharp is 17 ms throughout; the screen adds its grab interval (about 20 ms). On the
aerial drawing four of Vellum's twelve notches take 480 to 720 ms (its in-app log agrees):
band delivery, see 3d.

**Found by it, and fixed (24 Nov): the ease's tail.** Vellum's exponential wheel ease spent
its last 60 to 80 ms creeping through the final couple of pixels with the sharp tiles held
back, so from the screen the stage plan went sharp about 80 ms after the zoom looked
finished. Revealing the tiles early changed nothing measurable (the bench's "sharp" is the
last change, and the creep kept changing pixels). Landing once under `LAND_PX` device pixels
are left at the window's corners did: 1.5 px cut 82 to 66 ms; 4 px to 33 ms, and every zoom
ends 70 to 80 ms sooner. Matt compared 1.5 and 4 px by eye and saw no snap. Flights use the
same rule.

**For the homepage line:** "Zoom to sharp in 16 ms" is Vellum's in-app figure; from the screen
it is a frame or two (33 ms on the stage plan, grab resolution included). Only Foxit matches
it there, by holding the old picture until the new one is ready (98 ms from the notch against
Vellum's 115). On the whole wait from the notch, Foxit and PDF-XChange are quicker on light
drawings (no ease); Vellum is quickest on the heavy one.

Trial (Curtis Hall, Vellum and Chrome, six notches each): Chrome's real cost there is the
wait before anything moves (up to 700 ms; Vellum 13 to 50 ms); soft stages are occasional
in both (Chrome 33 and 118 ms; Vellum 25 to 67 ms on three notches, 0 on the rest).

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
  *(Done: the homepage shows 16 ms.)*
- **Feel measures not built:** input to first changed frame, frame pacing during a drag that
  keeps reaching new content, reopen time. The spike's pan test only draws cached bitmaps
  (log, "Follow-ups outside this scope").
