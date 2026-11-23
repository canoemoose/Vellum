# Speed diagnosis: why Vellum feels slower than its numbers (scope)

Started 18 November 2026. Interactive: Matt steers, each step is shown before the next, nothing
is committed until he asks. Source of truth for this piece of work; kept current as it goes.

## Start here (state at 23 November 2026)

**23 Nov: next step 1 is done.** The aerial drawing's
fit is back to v0.1 speed: 450 ms, first band 1464 ms, peak memory down 1.8 GB; ordinary
drawings unchanged. The "scale step" blamed on `71ae3f1` did not reproduce. See "Step 1 of
Next steps" near the end. The baseline table below is still the 18 Nov one, before the fix.

The sections below this one are the working log, in the order things happened; some early
statements were corrected later. This section is the current truth. A fresh session should
read this, then only the log sections it needs.

### What the benchmarking is for (Matt, 22 Nov)

(a) **Know where we are starting from**, in numbers, rather than "feels slow" or "feels fast".
(b) **One small, snappy, true number for the homepage** for this release. More speed work
follows the release.

### The baseline: where Vellum is today (main `bde9832`, unchanged since 17 Nov)

Vellum's own bench (`tools/bench.mjs`, cold renders, 8 PDFium threads, median of 3 launches,
18 Nov). Checked against the raw results on 22 Nov:

| | Aerial drawing | Curtis Hall, page 1 | Stage plan |
|---|---:|---:|---:|
| First page (ms) | 3449 | 123 | 280 |
| Settle to sharp, fit / 400% / 1600% (ms) | 2286 / 183 / 152 | 66 / 103 / 83 | 117 / 100 / 198 |
| Peak memory (MB) | 4347 | 352 | 339 |

How to read it:

- **First page starts at the open command, not at launch.** The app takes a further 330 to
  390 ms to start, so from launch the aerial drawing is about 3.8 s.
- **Settle to sharp starts after the settle delay**, so it leaves out the ease and the 60 or
  150 ms wait a user also sits through.
- **Curtis Hall is page 1 only, a light cover sheet.** Its dense pages are slower: the speed
  handoff has page 48 at 243 / 235 / 151 ms (8 Nov, a 2560 x 1400 window). Not re-measured.
- The aerial run had a 1600 x 920 viewport, the other two 1600 x 960. Too small to matter.
- Bayou and Silverstone were not run through this bench.

Against other viewers (`tools/viewer-bench`, from outside, cold):

- **Cold open, five drawings, from launch:** Vellum 665 to 890 ms on the four ordinary
  drawings, 3.8 s on the aerial one. Second to fourth of seven each time. Ratios recomputed
  from `20261118-1459/results.json` on 22 Nov:
  - behind the quicker of Foxit and PDF-XChange by 103 to 299 ms on ordinary drawings, and by
    2.0 s on the aerial one (where they open on the top of the sheet only);
  - **1.3x to 2.0x faster than Acrobat** on ordinary drawings (1.33, 1.73, 1.89, 2.03), 1.6x
    on the aerial one. An earlier "2.3x" in this doc and in chat was wrong;
  - 1.4x to 25x faster than Chrome, 1.25x to 5.3x faster than Edge;
  - SumatraPDF is quicker than Vellum on one drawing (the stage plan, 671 against 890 ms).
  Measured at the old 3 s wait for every viewer except Acrobat and SumatraPDF, whose opens
  were confirmed at 10 s.
- **Launch to the whole sheet drawn, aerial drawing:** Vellum first at 4.1 s (SumatraPDF 4.8,
  Foxit about 6.5, PDF-XChange about 6.7, Chrome about 9.7). Promising, not confirmed: the last
  three are sums of two steps taken at the old short wait.
- **After a zoom gesture ends, before the picture is final:**
  - wheel zoom, aerial drawing, fit page to 512%: **503 and 521 ms from the last notch to
    settled** (two runs). That includes the tail of Vellum's ease, so the still, blurry part
    is shorter than 500 ms; how much shorter is not measured. Chrome: 180 and 182 ms on the
    same test. Foxit, PDF-XChange and SumatraPDF: no sound figure yet;
  - typed zoom to a new level: 407 to 485 ms from Enter to settled across the five drawings.
    Taking off the 220 ms ease leaves **about 190 to 265 ms; inferred, not timed directly**;
  - a fit to a view already drawn: settled 250 to 310 ms from the key, so within about 30 to
    90 ms of the ease ending. No real blur in that case.

### What is wrong, with causes

1. **Fixed 23 Nov.** *Was:* fit and first open of a very long single page regressed 3 to 5x
   since v0.1 (aerial drawing: fit 437 ms to 2286 ms, first band 1.4 s to 3.4 s of white
   page, +1.8 GB). Cause: `e337efb` sends the thin fit view to one worker. Banding pages of
   200k+ objects restores it. The second suspect, a PDFium cost step between scales at
   `71ae3f1`, did not reproduce in isolation (see "Step 1 of Next steps").
2. **The still blur after a zoom lands**: the ease, then a 60 ms settle delay that exists
   only for wheel notches, then the render. Design, not regression.
3. **Stage plan at 1600%, repeat zooms 84 to 198 ms** since `71ae3f1`: not PDFium (strips take
   2 to 9 ms); probably same-scale renders for the previous view that are not cancelled.
   Partly a bench artefact. Not proven.
4. **Unexplained (23 Nov):** why repeat fit renders took 1.26 s inside the app at `e337efb`
   but 2.3 s in a standalone probe (no longer matters for the fix). Peak memory reads about
   650 to 700 MB higher than on 18 Nov with the *same* exe (Curtis Hall and the stage plan
   about 1030 MB against 352 and 339): something outside Vellum changed, perhaps WebView2.
   Re-take any memory figure before quoting it. *Explained:* the aerial drawing's 1.8 GB was
   one worker holding every decoded image of the whole page; bands hold only their own.

### Next steps, in the order agreed with Matt on 22 Nov

1. ~~**Fix the one-worker rule** for object-heavy single pages~~ **Done 23 Nov**: fit
   2339 → 450 ms, first band 3432 → 1464 ms, memory −1.8 GB. See "Step 1 of Next steps".
2. **Re-run the open tests on the fixed build** (they are sound) and make "launch to the whole
   sheet drawn" one timed step at the 10 s wait. **Propose the homepage number from that.**
   Fallback that needs no more work: "opens drawings 1.3 to 2x faster than Acrobat".
3. **The blur fix** (scope step 2: no settle delay after a flight, render during the ease,
   then the same for the wheel), measured with Vellum's own bench.
4. **Then finish the cross-viewer zoom comparison**, when the answer may have changed.

Interactive throughout: one thing at a time, show the design before building, short runs
before long ones, Matt's eyes on anything visual. No commit until he asks.

### The cross-viewer wheel zoom test: parked 22 Nov, about an hour from usable

Design (Matt's choices): Ctrl+wheel with the pointer on the middle of the sheet, from fit
page to 4x the viewer's own fit-width level; main figure is last notch to settled.

- **Works:** finding the sheet's centre for any PDF from the screen (`Centre.cs`); per-viewer
  notch count from the warm-up launch; Vellum (42 notches, lands on the exact centre, 503 and
  521 ms); Chrome (15 notches, 180 ms; its landing spot not checked against Vellum's);
  SumatraPDF's fit-width level in its own units.
- **To do:** Foxit and SumatraPDF drop notches sent 50 ms apart, so the warm-up count does
  not hold in the timed gesture: slow the pace (150 to 200 ms) or calibrate with whole
  gestures at pace (Matt had not chosen). PDF-XChange reached its target but was voided by the
  blank-view test, which needs sharp edges and so rejects soft aerial imagery: void only a
  flat view. The first summary table still prints an empty typed-zoom column.
- **Parked for good unless asked:** Acrobat (ignores injected wheels three ways; raises an
  error box during runs) and Edge (shows no zoom level). Both stay in the open table.
- **Not usable, do not quote:** any typed-zoom comparison, from 18 Nov or since.
- **Not built:** drag, reopen time, running a folder of PDFs by default (the per-file table
  is already gone, so any PDF passed on the command line works).

### Running the tools: traps found the hard way

- **Always set `VELLUM_EXE`** for `tools/viewer-bench`. Its default,
  `%LOCALAPPDATA%\Vellum\vellum.exe`, resolves to an 8 November build when started from
  Claude's Bash tool (not from PowerShell). Today's main build is at
  `%TEMP%\vellum-smoke\step1-main-bde9832\vellum.exe`; rebuild and copy aside after any
  code change (`source ~/.vellum-toolchain/env.sh`, GNU toolchain, as CLAUDE.md says).
- **It takes over the mouse and keyboard** on the primary monitor, and refuses to start while
  Acrobat, Foxit, PDF-XChange or SumatraPDF is open. Take the bench lock
  (`mkdir ~/.vellum-bench.lock`, `rmdir` after).
- **A step is finished after 10 s without change** (`--quiet`). Shorter cut Acrobat and
  SumatraPDF off. One look at the screen takes 23 ms: read anything under 50 ms as "a frame
  or two".
- **Check saved frames by eye** (`bench-output/viewers/<stamp>/frames/`) before quoting any
  figure: blank pages, blurred placeholders and wrong builds have each passed as results.
- Build: `cd tools/viewer-bench && dotnet build -c Release`. Modes: `run`, `wheelprobe`,
  `methodprobe`, `probe`, `open`. Raw results under `bench-output/` are gitignored.

## Objective

Get **actual facts** about how fast Vellum is against the other viewers, measured the way it
is used, then close the gaps those facts show. (The brief began as "why does Vellum feel
slower than its numbers"; Matt's context below turned it round.) Done means:

- the regression question answered (has rendering got slower since the spike, or does only the
  stopwatch differ?);
- a journey test in `tools/viewer-bench` that times every viewer over the same route on the
  same part of the same drawing, and its results written up;
- **for this release: at least one headline number for the homepage that is true and that we
  can show the working for.** Matt may ship with that one number and leave the rest of the
  speed work for later, so steps 1 and J are the minimum; the fixes can follow the release;
- whichever improvements Matt agrees are made, tested (Vitest for pure maths, `cargo test`),
  measured before and after with the same tool, and recorded in
  [speed-handoff.md](speed-handoff.md).

## Context from Matt (18 Nov)

Vellum *feels* fast in use, and never felt slower than the competition. The work started
because he wanted concrete numbers for the homepage and every number taken said Vellum was
slower. So the first question is not "why is it slow" but **"what is the feel made of, and
which measurement shows it?"** Working hypothesis, not yet measured: the feel comes from the
instant stage (the view responds within a frame to every wheel notch and drag, at 60 fps, on
drawings where other viewers re-render per step), while the stopwatches so far time a single
jump to a fully sharp frame, the one thing Foxit and PDF-XChange do best. Candidate measures
that would show it: input to first changed frame; frame pacing and longest freeze during a
run of wheel notches or a drag on a heavy drawing; reopen time (the preview cache). None of
these exist in `tools/viewer-bench` yet: step J adds them. The real gaps found so far still
stand and are worth closing: the still blur after a zoom lands, and the cold first open.

## What we know going in

- **The two stopwatches measure different things.** The spike's "settle → sharp" starts
  *after* input has settled; the external `tools/viewer-bench` (18 Nov,
  `bench-output/viewers/20261118-0237/summary.md`) starts at the keypress and stops when the
  middle of the window stops changing. For a typed zoom Vellum's path is: 220 ms ease
  (`Viewer.animateTo`) → 60 ms settle (`viewer.ts`, `WHEEL_SETTLE_MS`) → render (about
  100 to 200 ms). That adds up to the 400 to 460 ms the external bench saw on every file, against
  23 to 107 ms for Foxit and PDF-XChange, which jump straight to the new level. The homepage's
  97 ms is the spike's settle → sharp at 1600% on the aerial drawing: true, but not what a user
  waits for.
- **The ease alone is at least 220 ms** on any stopwatch that watches pixels, whatever the
  renderer does. Agreed with Matt (18 Nov): the ease is feedback, not waiting, because motion
  starts within a frame. **The number to chase is landing → sharp**: the time the view sits
  still and blurry after the motion stops. Today that is about 200 ms (60 ms settle plus the
  render), against 30 to 40 ms in total for Foxit. No new instrumentation is needed for it:
  landing → sharp is the settle delay plus the existing `settleToSharpMs` (F12 overlay,
  `perf-log.csv`).
- **Typed zoom is in the external bench because a script can type a number**, not because
  people zoom that way. Wheel zoom has the same shape (ease, 60 ms settle, render) and is used
  far more.
- **Step 2 has a floor.** Band transfer to the webview costs about 66 ms per 5 MB band
  (handoff idea 1; the real fix is the native surface, out of scope here). If render plus
  transfer exceeds the ease, the view still lands blurry, for less time. Expect "usually sharp
  on landing", not "always".
- **Opening** takes 0.68 to 0.84 s in the external bench on four of the five drawings, close
  to Foxit and PDF-XChange (0.55 to 1.0 s). **Its 671 ms for the aerial drawing is wrong**
  (found 18 Nov reading the tool, confirmed from its saved frame
  `frames/vellum-projectlayou-r1-open.bmp`): the tool clears Vellum's preview cache before
  every run, Vellum shows a blank white page at about 0.7 s, the picture takes over 3 s more,
  and the tool takes "unchanged for 3 s and not a uniform colour" as open. A white page on a
  dark background passes that test. The honest cold figure is about 3.8 s (bench first page
  3449 ms plus cold start), against Foxit 3.0 s and PDF-XChange 1.8 s. SumatraPDF's 0 ms on
  the same file is also an artefact.
- Earlier run-to-run variability came from Vellum restoring each file's remembered zoom
  (`App.svelte`, `setZoom(mem.zoom)`), not from rendering.
- The viewers zoomed into different parts of the sheet, so the external zoom comparison isn't
  like-for-like yet. Step J fixes that. `tools/viewer-bench` is uncommitted; don't commit it
  until Matt asks.

## Constraints

- Ask before adding instrumentation. The existing `VELLUM_PDFIUM_TIMING=1`, `[swap]` logs, the
  F12 overlay and `perf-log.csv` are fine to use.
- Matt judges visual and feel changes himself; tell him exactly what to try.
- Engine (`src/lib/engine`, `src/lib/render`, `src/lib/view`) stays free of Svelte; navigation
  maths in `viewMath.ts` stays pure and tested. `split_region`'s exact-coverage tests
  (`src-tauri/tests/bands.rs`) must keep passing.
- UK English; log strings ASCII; em-dashes sparingly.
- **Toolchain:** this machine's default Rust toolchain is `stable-x86_64-pc-windows-gnu`, so
  every cargo or tauri command needs `source ~/.vellum-toolchain/env.sh` first (as CLAUDE.md
  says), not MSVC. Release exe: `npm run tauri build -- --no-bundle`. Copy it aside (with
  `pdfium.dll` and `WebView2Loader.dll`) before benchmarking; take the bench lock
  (`mkdir ~/.vellum-bench.lock`) for each run.

## Files in play

- `src/lib/engine/viewer.ts`: `animateTo` (~830), `inputActivity` / `scheduleSettle` /
  `onSettle` / `plan` (~1220 to 1330), the flight in `frame()` (~1627).
- `src/App.svelte`: typed zoom and the zoom dropdown (~1977, ~2589), remembered zoom (~1675).
- `src/lib/render/tiles.ts` (`chooseRenderScale`), `src/lib/view/viewMath.ts`.
- `src-tauri/src/pdfium.rs` (`split_region`, `render_stream`), `pdfium_swap.rs`,
  `previewcache.rs`; `src-tauri/tests/bands.rs`.
- `tools/bench.mjs`, `src/lib/perf/bench.ts` (the spike bench).
- [speed-handoff.md](speed-handoff.md) (results go here), [ARCHITECTURE.md](../ARCHITECTURE.md).

## Steps

**Order agreed with Matt (18 Nov): 1, J, then 3 and 2 interleaved, then 4, then 5.** The
labels below are not the sequence. Measure before fixing: step J gives the homepage its
facts and every later fix an honest "before". Step 3 (cold first open) leads the fixes; 2a
goes in early for Matt to try while step 3's measurements run, and 2b onwards follows once
step 3's fix is in. Fixes stay separate changes, each with its own before and after numbers.

J. **Journey test in `tools/viewer-bench`** (Matt agreed to changing the tool for this; it is
   still uncommitted, so don't commit it until he asks). Read the tool first (`Bench.cs`,
   `Zoom.cs`, `Apps.cs`) and tell Matt what it can and can't time in another app's window
   before building: frame timing by screen capture may need the list below trimmed. The same
   route in every viewer, over the same part of the same drawing (fix the typed-zoom test's
   fairness problem the same way: same sheet region, same zoom levels):
   - a run of wheel notches into an area not yet rendered;
   - a long drag across the sheet, always reaching new content (not the spike's 400 px circle);
   - zoom out, pan, zoom in (the handoff's idea 1a case).
   For each: time from input to the first changed frame, the longest freeze, how evenly
   frames arrive, and time to sharp (pixels stop changing) at the end. Also reopen time for a
   file opened before, beside the cold open. Vellum's remembered zoom must not skew it (the
   tool's throwaway profile, or clear it). Run all seven viewers on the five drawings; results
   under `bench-output/viewers/`. **It may not flatter Vellum.** Report what it shows; if
   another viewer is as smooth, that is a fact too, and it aims the fixes.
   Then propose the headline number to Matt from those results, with its method in one
   sentence. Updating the homepage copy belongs to the homepage session.


1. **Like-for-like regression check.** Build today's release exe and run
   `npm run bench -- --runs 3 --pdfium-threads 8 --only projectlayoutmarch2021 --exe <copy>`
   (the spike's settings; the window is now 1600 × 1000 rather than 960). Compare with
   RESULTS.md: first page 2366 ms; settle → sharp 664 / 138 / 97 ms at fit / 400% / 1600%;
   peak 3034 MB. If anything is materially worse (say over 20%), build the spike commit in a
   worktree and run both with today's bench script to find out whether the code or the
   measurement moved. No code changes in this step.
2. **Land sharp on one-shot view changes.** Typed zoom, the dropdown, Fit and Actual size
   know their destination up front. In this order, each shown to Matt before the next:
   - **2a. No settle delay after a flight.** The 60 ms wait is there for another wheel notch;
     a flight has none. Plan and render the moment it lands. Safe, and worth about 60 ms alone.
   - **2b. Render during the flight, hold the result until landing.** Start the render for
     `flight.to` when the flight begins (choose its render scale then, plan for that view,
     don't abort it mid-flight), cancel it if the flight is interrupted. Keep arrived bands and
     tiles undrawn until the flight lands, so the picture swaps cleanly instead of sharpening
     in patches while it moves. Target: landing → sharp from about 200 ms to near zero when
     the render fits inside the ease. Risk: band IPC on the webview main thread making the
     ease stutter; Matt judges by eye.
   - **2c. Ease length, by feel.** On a big jump (82% to 328%) the content moves too fast to
     follow, so the ease keeps your bearings less than on fit page to fit width. Try a shorter
     ease for large zoom ratios or for typed numbers (one constant); Matt judges.
   - **2d. Wheel zoom, if 2b works.** The same idea for the wheel: render for the ease's
     target scale while it is still easing. The handoff rejected this before cancellation
     worked ("might now be viable"). Only with Matt's go-ahead after 2b.
   The planning maths that moves into pure functions gets Vitest cover.
3. **First open of image-heavy drawings.** Cold first open of the aerial drawing at fit is
   white for over 3 s. Measure first (clear the preview cache; `VELLUM_PDFIUM_TIMING=1`), then
   choose with Matt between: a cheap low-resolution first pass so something shows sooner;
   making fit faster (the handoff's idea 2a: fit runs on one worker because the 70 × 1350 px
   region is under `SMALL_REGION_PX`, and two thirds of the time is resampling 885 MP of JPEG
   tiles every render).
4. **Region-based bands (handoff idea 1a).** Split the requested region, not the page, into
   eight strips, so zoomed-in renders use every worker. Bench all five files at fit, 400% and
   1600% before and after; Matt then checks zoom out, pan, zoom in by feel.
5. **Record** before/after numbers and decisions in speed-handoff.md (and ARCHITECTURE.md
   where behaviour changes). Re-run step J's journey test after each fix for the after numbers.

## Open questions for Matt

1. ~~The ease: keep it or jump?~~ **Answered 18 Nov:** keep it, measure landing → sharp, render
   during it (step 2). Its length is tuned by feel in 2c.
2. **Step 1's scope:** today's build only, and build the spike commit only if the numbers moved
   by more than about 20% (the working assumption unless Matt says otherwise).
3. ~~What have people said feels slow?~~ **Answered 18 Nov:** nothing; it feels fast (see
   Context). The numbers were the problem, hence step J.
4. ~~Order of 2 and 3.~~ **Answered 18 Nov:** step 3 before step 2. The cold first open (over
   3 s of white) is the worst single moment and a first impression; the preview cache hides it
   from anyone who has opened the file before.

## Follow-ups outside this scope

- **The homepage's 97 ms** is true but is not what anyone waits for. Replace it with the
  headline number that comes out of step J. The homepage session owns that copy.
- **Why step J's path matters** (Matt, 18 Nov): the spike's pan test (`src/lib/perf/bench.ts`) is one
  400 px circle that ends where it began, run after rendering has gone idle. It moves at most
  400 px from the start, inside the one-tile (512 px) prefetch ring, so it only ever draws
  bitmaps already cached. Its 60 fps proves compositing is cheap, not that uncovering new
  drawing is smooth. A feel test needs a path that keeps reaching new content (a long drag
  across the sheet, a run of wheel notches into a fresh area), over the same part of the
  drawing in every viewer.

## Step 1 results (18 Nov)

Today's main (`bde9832`), release exe, `node tools/bench.mjs --runs 3 --pdfium-threads 8
--size 1600x960 --only projectlayoutmarch2021`, primary monitor 2560 × 1440 at 100%, disk
previews off (the bench does that). Results: `bench-output/summary-pdfium-t8-1600x960.md`.
`--size 1600x960` gives a 1600 × 920 viewport (the title bar comes out of it), against the
spike's 1600 × 960: 4% less area, too small to matter here.

| Aerial drawing | Spike (RESULTS.md) | 11 Nov run | Today | Today vs spike |
|---|---:|---:|---:|---:|
| Cold start (ms) | 661 | | 385 | faster |
| First page (ms) | 2366 | 4535 | 3449 | +46% |
| Settle → sharp, fit (ms) | 664 | 2481 | 2286 | 3.4x |
| Settle → sharp, 400% (ms) | 138 | 211 | 183 | +33% |
| Settle → sharp, 1600% (ms) | 97 | 130 | 152 | +57% |
| Peak memory (MB) | 3034 | | 4347 | +43% |
| Pan fps fit / 400% / 1600% | 60 / 60 / 60 | | 59 / 59 / 59 | same |

The "11 Nov run" column is the last surviving raw run in `bench-output/pdfium-t8/` (run 1
only), so nothing has moved since 11 Nov; the change is between the spike and then.

**A/B against the spike's code, same machine, same day** (`2b349fc`, the spike's own bench
script and in-app sequence, same PDFium DLL, 1600 × 960 viewport; worktree
`%TEMP%\vellum-spike-2b349fc`, results in its `bench-output/`). The spike reproduces
RESULTS.md closely, so the bench is sound and **the regression is real, in the code**:

| Aerial drawing | Spike code today | Main today | Change |
|---|---:|---:|---:|
| Cold start (ms) | 474 | 385 | faster |
| First page (ms) | 2666 | 3449 | +29% |
| Settle → sharp, fit (ms) | 800 | 2286 | 2.9x |
| Settle → sharp, 400% (ms) | 148 | 183 | +24% |
| Settle → sharp, 1600% (ms) | 100 | 152 | +52% |
| Peak memory (MB) | 2998 | 4347 | +45% |
| Pan fps fit / 400% / 1600% | 59 / 59 / 59 | 59 / 59 / 59 | same |

**Bisect (18 Nov).** Release exes at the commits either side of the two suspects, each with
its own bench script and PDFium DLL, `--runs 3 --pdfium-threads 8 --size 1600x960`, aerial
drawing. Raw results kept in `bench-output/bisect-*/` (gitignored). On main the suspects are
`e337efb` and `71ae3f1` (the handoff's `e8c6172` and `3899208` are their branch hashes).

| Build | First band | First page | Fit | 400% | 1600% | Peak MB |
|---|---:|---:|---:|---:|---:|---:|
| `2b349fc` spike | | 2666 | 800 | 148 | 100 | 2998 |
| `9a28dc0` v0.1 engine, before the suspects | 1399 | 2066 | 437 | 149 | 104 | 3008 |
| `e337efb` small renders on one worker | 3366 | 3366 | 1286 | 150 | 118 | 4771 |
| `71ae3f1` render-ahead, small renders in parallel | 3300 | 3300 | 2254 | 166 | 152 | 5005 |
| `bde9832` main today | 3449 | 3449 | 2286 | 183 | 152 | 4347 |

All times in ms, settle → sharp for the three zooms, medians of 3 launches.

What the bisect pins, and how sure each part is (reviewed 18 Nov; the two follow-up checks
below changed some of this):

- **The v0.1 engine work made the aerial drawing faster than the spike** (fit 800 → 437 ms,
  first page 2666 → 2066, first band 1.4 s). Measured.
- **`e337efb` moves fit from 437 to 1286 ms, first band from 1.4 to 3.4 s, and memory up
  1.8 GB.** Measured. The cause of the fit and first-band change is confirmed by check 1: the
  fit view went from eight bands on eight workers to one render on one worker.
- **`71ae3f1` moves fit from 1286 to 2254 ms** and zoomed renders up 16 to 34 ms. Measured.
  Check 1 pins the fit part to the render scale it chooses, not to parallel small renders.
- **Since `71ae3f1`:** fit unchanged, 400% +17 ms, memory 650 MB lower. Measured; causes not
  looked at.
- **The memory cause is not known.** An earlier draft said one worker decoding every image
  explains the 1.8 GB; that doesn't add up (the same images are decoded once each either way)
  and nothing measured supports it.

### Check 1: per-strip timing at fit (`VELLUM_PDFIUM_TIMING=1`, aerial drawing)

Logs in `bench-output/check12-20261118/timing-*.log`. Fit-view renders only:

| Build | What goes to PDFium at fit | Time |
|---|---|---:|
| `9a28dc0` | 8 bands of 50 × 120 px at rs 0.0667, one per worker | 138 to 364 ms each, repeat renders (first: 258 to 978) |
| `e337efb` | 1 render of 50 × 961 px at rs 0.0667, one worker | 2207 ms first, then 1253 to 1261 |
| `e337efb` | 1 render of 40 × 768 px at rs 0.0533 | 1257 to 1342 ms |
| `71ae3f1`, main | 1 render of 56 × 1071 px at rs 0.0743, one worker | 2227 to 2323 ms, every time |
| all three | page preview, 107 × 2048 px at rs 0.1422, one worker | 2279 to 2329 ms |

- The one-worker rule is confirmed as the cause at `e337efb`.
- **The extra second at `71ae3f1` is a scale effect.** Render-ahead and the 2^¼ steps move
  the fit render from rs 0.0667 to 0.0743 (11% larger, 24% more pixels), and PDFium's cost
  for the whole page jumps from about 1.26 s to about 2.25 s somewhere between those scales.
  At 0.0533 and 0.0667 a repeat render is 1.26 s; at 0.0743 and 0.1422 every render is about
  2.3 s. Why PDFium has that step is not known (RESULTS.md saw the same oddity the other way
  round: fit was faster at DPR 2 than at DPR 1). Worth a short probe in step 3: fit cost
  against scale on one worker, because a banded render will meet the same step.

### Check 2: do ordinary drawings show the regression? No.

`--runs 3 --pdfium-threads 8`, 1600 × 960 viewport, page 1, each build's own bench script.
Raw results in `bench-output/check12-20261118/out-*`.

| Curtis Hall (page 1) | First band | First page | Fit | 400% | 1600% | Peak MB |
|---|---:|---:|---:|---:|---:|---:|
| `2b349fc` spike | | 165 | 72 | 102 | 86 | 903 |
| `9a28dc0` | 113 | 113 | 71 | 102 | 102 | 954 |
| main | 81 | 123 | 66 | 103 | 83 | 352 |

| Xero stage plan | First band | First page | Fit | 400% | 1600% | Peak MB |
|---|---:|---:|---:|---:|---:|---:|
| `2b349fc` spike | | 313 | 120 | 105 | 88 | 929 |
| `9a28dc0` | 147 | 281 | 119 | 101 | 84 | 1022 |
| main | 163 | 280 | 117 | 100 | **198** | 339 |

- **The fit and first-page regression is specific to the aerial drawing's shape** (one very
  long page whose fit view is a thin strip under the 0.5 MP small-region limit). Ordinary
  sheets are level with the spike or better, and **main uses about a third of the memory**
  (350 MB against 900 to 1000).
- The render-ahead cost at 400% and 1600% does not show on these two files.
- **One new regression: the stage plan at 1600%, 84 → 198 ms, pinned to `71ae3f1`** by a
  second bisect (`bench-output/check3-20261118/`): `e337efb` 86 ms, `71ae3f1` 196 ms, main
  198 ms. In every launch on both slow builds the first repetition takes about 84 ms and the
  second and third about 200 ms, with the first band still at 50 ms, so the picture starts on
  time and one part of it arrives late on a repeat zoom. `71ae3f1` bundles render-ahead, the
  60 ms wheel settle, drawing sharper cached copies on top, and one small render per worker;
  which of them does it is not known. **It may be partly a bench artefact:** the bench drops
  the tiles before each repetition, then zooms away and back, which in real use would land
  on a scale render-ahead had already cached and need no render at all. Curtis Hall does not
  show it.
  **Per-strip log (check 4, `bench-output/check4-20261118/`): it is not PDFium.** At 1600%
  every strip on main renders in 2 to 9 ms, the same as on `e337efb`. What differs is what is
  asked for. On `e337efb` each repetition sends two regions (2048 × 1536 visible, 3072 × 2560
  ring, at rs 21.33). On main the first repetition also sends two, but the second and third
  send three, the largest 3584 × 3072 px (44 MB of pixels), all at rs 22.63. Likely reason,
  not proven (the log has no timestamps): with render-ahead the bench's zoom away and back
  stays on one render scale, so the regions planned for the "away" view are not aborted (only
  renders at *other* scales are) and their bands share the channel to the webview with the
  tiles the measurement is waiting for. At the handoff's 140 to 200 MB/s, 44 MB is 220 to
  310 ms of transfer, the right size for the extra 115 ms. So the cost is band transfer
  (handoff idea 1), queued behind work for a view that has gone. **Bench artefact in this
  exact form** (in real use the tiles would still be cached), **but the mechanism is real:**
  a zoom that stays within one render scale does not cancel the previous view's renders. That
  may be part of the slow "zoom out, pan, zoom in" in handoff idea 1a. To test when fixing:
  on a zoom, also abort same-scale regions that no longer touch the view or its ring.

**What this means for the plan.** The headline spike numbers were taken on the one file where
main has regressed; on ordinary drawings main is as fast and far lighter. Step 3's fix (stop
the small-region rule catching object-heavy single pages, handoff idea 2a) is still right for
the aerial drawing, with the scale step to probe alongside.

## Step J: what the tool can and can't time (read 18 Nov, nothing built)

`tools/viewer-bench` (C#, 860 lines) launches each viewer, places its window at 1600 × 1000,
and polls a GDI screen copy (`BitBlt`) of the middle of the window, comparing each grab with
the last. It drives viewers with injected keys, clicks and UI Automation; it already has a
`Wheel(x, y, notches)` helper, unused.

Can time, with additions:
- first change after an input (response latency), last change (settled), and every change in
  between, so the longest freeze and how evenly the picture updates during a gesture;
- wheel notches (helper exists) and a mouse drag (needs a few lines of input injection).

Can't, or only roughly:
- **Sharp against blurry.** It only knows "stopped changing". Fine for time to settled.
- **Blank against drawn.** The content test passes a white page on a dark surround (the
  aerial 671 ms above). Needs fixing before any open figure is quoted: require detail inside
  the page, not just two shades.
- **Finer than the screen.** It sees composited frames, 60 a second at best, and its own grab
  rate is unmeasured. Several results of 1 to 2 ms (PDF-XChange) are below anything it can
  resolve; treat figures under about 30 ms as "one frame or so".
- **The same route in every viewer, exactly.** Wheel zoom steps differ per viewer (and some
  need Ctrl), and a typed zoom keeps a different point fixed in each. Achievable: the same
  start (fit page), the same typed target zoom, the pointer at the same place on the sheet,
  then a drag of the same screen distance. Zoom-by-wheel is comparable only as "N notches",
  not as "to the same level".

### Journey test design (agreed 18 Nov), built in this order

1. **Fix what counts as open, then re-run the opens.** Two faults in `Bench.Settle`: a blank
   page on a contrasting surround passes the content test (Vellum, aerial drawing, 671 ms);
   and a viewer that has already drawn by the first screen grab is given 0 ms (SumatraPDF).
   Content must have detail in two directions, not just two shades; "already drawn at the
   first look" reports the time of that look, an upper bound.
2. **The same start in every viewer:** fit page, then a typed zoom to the same level, pointer
   at the same place on the sheet.
3. **A long drag** of the same screen distance across the sheet: first response, longest
   freeze, time to settled.
4. **A fixed number of wheel notches in and out**, same recordings. Compares "N notches", not
   "to the same zoom level".
5. **Reopen** of a file opened before, beside the cold open.

### Step J.1 result: corrected opens on the aerial drawing (18 Nov)

`Bench.Settle` now needs detail in two directions before a picture counts as content
(`Detailed`), and a viewer already drawn at the first look is given the time of that look, not
0 ms. Cold open, process start to the middle of the window settled, 3 runs after a warm-up:

| Viewer | Last night | Corrected | Runs |
|---|---:|---:|---|
| PDF-XChange Editor | 1836 | 1849 | 1849, 1835, 1869 |
| Foxit PDF Reader | 2983 | 3039 | 3027, 3041, 3039 |
| Vellum, main `bde9832` | 671 (blank page) | 3822 | 4040, 3822, 3809 |
| SumatraPDF | 0 (artefact) | 4593 | 4664, 3772, 4593 |

Foxit and PDF-XChange are unchanged by the fix, which is the check that it didn't move sound
results. Saved frames checked by eye: every viewer shows a drawn page. Results in
`bench-output/viewers/20261118-1435/` (Foxit, PDF-XChange, SumatraPDF) and `20261118-1444/`
(Vellum). So **on a cold open of this drawing Vellum is third of four, 0.8 s behind Foxit and
2 s behind PDF-XChange**; the bisect says about 1.3 s of that is the one-worker rule.

**Trap: which Vellum the tool runs.** By default it launches
`%LOCALAPPDATA%\Vellum\vellum.exe`. Started from Claude's Bash tool, that path resolves to a
different file from the real install: an 8 November pre-shell build (old top bar, no
`VELLUM_MULTI_INSTANCE`), not the 17 November exe that PowerShell and Explorer see there.
Probably the desktop app's packaged-app file redirection for AppData; not verified. The first
run today (`20261118-1435`, Vellum 2.5 s) measured that old build and is void for Vellum.
**Always set `VELLUM_EXE` to a known build** (today:
`%TEMP%\vellum-smoke\step1-main-bde9832\vellum.exe`), and check a saved frame shows the
title bar tabs. Last night's frames show the current interface, so those runs were a current
build.

### Step J.1 result: cold opens, all five drawings, seven viewers (18 Nov)

`bench-output/viewers/20261118-1459/` (`summary.md`, `results.json`, frames). Vellum is today's
main (`bde9832`) through `VELLUM_EXE`, preview cache cleared before every run. Process start to
the middle of the window settled, median of 3 after a warm-up, ms. All 35 open frames checked
by eye: every one shows a drawn page.

| Viewer | Curtis Hall | Bayou | Stage plan | Silverstone | Aerial |
|---|---:|---:|---:|---:|---:|
| PDF-XChange Editor | 561 | 1043 | 591 | 589 | 1825 |
| Foxit PDF Reader | 602 | 681 | 788 | 716 | 3022 |
| **Vellum (main)** | **665** | **849** | **890** | **826** | **3845** |
| SumatraPDF | 1046 | 1785 | 671 | 1119 | 4564 |
| Adobe Acrobat | 1351 | 1130 | 1541 | 1565 | 5982 |
| Google Chrome | 3330 | 21215 | 1269 | 1252 | 8186 |
| Microsoft Edge | 3406 | 4500 | 1914 | 1543 | 4817 |
| Vellum's place | 3rd | 2nd | 4th | 3rd | 3rd |

What it supports, and what it doesn't:

- **Vellum is in the leading group with Foxit and PDF-XChange, not ahead of it.** It is 103 to
  299 ms behind the quicker of the two on ordinary drawings (corrected 22 Nov; was "60 to 300").
- **It is clearly ahead of Acrobat** (1.3 to 2.0x on four drawings, 1.6x on the aerial;
  corrected 22 Nov, was "2.3x") **and
  of both browsers** (1.4x to 25x).
- Run-to-run spread is small everywhere (tens of ms), so these orderings are stable.
- **Not like-for-like on what is drawn.** The frames show the viewers open at different views:
  on the aerial drawing Vellum and SumatraPDF open at fit page (the whole 5 m sheet, all 837 MP
  of imagery), while Acrobat, Foxit, PDF-XChange and the browsers open at fit width or 100%,
  showing only the top of the sheet. Vellum is doing far more work in its 3.8 s. Same on the
  other files to a lesser degree. A fair open figure needs each viewer set to the same
  initial view, or the caveat stated.
- About 0.4 to 0.5 s of every Vellum figure is the app starting (WebView2); the others are
  native.

Typed-zoom figures in the same run are as last night (Vellum 412 to 460 ms, Foxit 40 to 108,
PDF-XChange 16 to 30) and carry the same caveats (the ease is counted; different regions).
~~SumatraPDF's zoom figures are void~~ **Corrected 18 Nov (Matt, watching):** SumatraPDF's
typed zoom *is* applied. The "got 99.1%" is the tool's fault: for SumatraPDF it works the level
out from the window width instead of reading it, so it always reports the fit-width level.
Frames confirm a zoomed, drawn view on four drawings, so those figures (256 to 722 ms) stand.
**On the aerial drawing SumatraPDF goes white at the typed 632.8%.** Matt reproduced the
tool's steps by hand: it zooms into a part of the sheet that is entirely white, so there is
nothing to draw. The 25 to 49 ms is a real zoom to an empty view: correct, and useless as a
comparison. It is the clearest case of the typed-zoom test's flaw: each viewer lands on a
different part of the sheet, and the tool does not check what it landed on. Until the test
controls where it lands, at least mark a zoom void when the landed view is blank. Acrobat's zoom is void on three drawings (its error
box covers the view).

### Step J.2: the same two views in every viewer (built 18 Nov, trial only)

After the open, the tool presses fit page (Ctrl+0; Chrome Ctrl+\) and then fit width
(Ctrl+2), timing each from the key press: first change on screen and settled. It reads the
zoom level back after each, and saves `-fitpage.bmp` and `-fitwidth.bmp` frames. New columns in
`results.json` (`FitPage*`, `FitWidth*`) and a second table in `summary.md`.

**The tool's resolution, now measured: one look at the screen takes 23 ms** (GDI grab plus
compare). Changes were stamped when the look began, so figures read up to 23 ms early: that is
where last night's 1 to 2 ms zooms came from. Now stamped when the grab returns: an upper
bound, at most one look late. Read anything under about 50 ms as "one or two looks".

Trial, Curtis Hall page 1, 2 runs (`bench-output/viewers/20261118-1542/`, taken before the
stamp change, so add up to 23 ms):

| Viewer | Fit page: first / settled | Fit width: first / settled | Levels |
|---|---:|---:|---|
| Vellum (main) | 5 to 39 / 192 to 213 ms | 4 to 28 / 193 to 212 ms | 73%, 82% |
| Foxit | 54 to 81 / 54 to 81 ms | 54 to 57 / 54 to 57 ms | 68%, 95% |
| PDF-XChange | 3 to 28 / 5 to 38 ms | 3 to 24 / 3 to 24 ms | 68%, 97% |
| Acrobat | 19 to 26 / 19 to 26 ms | 38 to 55 / 38 to 55 ms | 67%, 72% |

- **Vellum responds as fast as anything** (first change within one or two looks) **and
  finishes last**, because its picture keeps moving for the 220 ms ease; the others change
  once. This is the ease, measured from outside: 200 ms of motion, no visible wait after it
  on this small change (73% to 82% needs no new render).
- The levels differ between viewers because their toolbars and side panels take different
  amounts of the window; the views are the same by definition, not pixel for pixel.
- This drawing's two fits are close together, so it is a light test. The aerial drawing (fit
  page draws the whole sheet) is the heavy one; not yet run.

### Step J.2 on the aerial drawing (18 Nov)

`bench-output/viewers/20261118-1551/`, 3 runs after a warm-up, Vellum main through
`VELLUM_EXE`, stamps are now upper bounds (one look = 22 ms). First change / settled, ms:

| Viewer | Open | To fit page | To fit width | Open + fit page |
|---|---:|---:|---:|---:|
| Vellum (main) | 4111 (opens at fit page) | 17 / 250, a return | 44 / 265, a return | 4111 |
| SumatraPDF | 4806 (opens at fit page) | 47 / 47, a return | void | 4806 |
| Foxit | 3009 (opens at fit width) | 260 / 3496 | 147 / 147 | about 6500 |
| PDF-XChange | 1850 (opens at fit width) | 50 / 4819 | 29 / 29 | about 6670 |
| Chrome | 8112 (opens at fit width) | 111 / 1566 | 666 / 666 | about 9680 |
| Acrobat | 5994 | void | void | |

Frames checked by eye (`*-fitpage.bmp`, `*-fitwidth.bmp`, run 3).

- **The fair open comparison on this drawing is "launch to the whole sheet drawn".** Vellum
  and SumatraPDF open at fit page, so their open figure *is* that. Foxit, PDF-XChange and
  Chrome open on the top of the sheet and take 1.6 to 4.8 s more to draw the whole of it when
  asked. On that measure **Vellum is first at 4.1 s, then SumatraPDF 4.8, Foxit 6.5,
  PDF-XChange 6.7, Chrome 9.7**. (It is a sum of two timed steps for the last three, with
  untimed pauses between, not one stopwatch run.) After the one-worker fix Vellum's figure
  should drop by about 1.3 s.
- **Vellum's 250 ms to fit page is a return to a view it had already drawn**, not a first
  render: it keeps the tiles. Its own cold fit render is 2.3 s (step 1 bench), still quicker
  than Foxit's 3.5 s and PDF-XChange's 4.8 s for the same view. Whether those two keep a fit
  view once drawn is not tested: the journey should press each key twice (first visit,
  return).
- **Fit width is not the same view.** Vellum keeps your place, so it shows the middle of the
  sheet (aerial imagery); the others jump to the top (title block, line work). Also a return
  for every viewer (the tool fits width once, untimed, beforehand).
- **Void:** Acrobat's fit-page frame is a blank page (it had not drawn within the 2.5 s
  quiet period, and its error box voided two of three runs); SumatraPDF's fit-width frame is
  an unrendered blur, and its levels are computed, not read (so never trust "got N%" for it).
- Opens here are 150 to 300 ms higher for Vellum than the 15:00 run (3845): run-to-run on
  this file, not the stamp change (22 ms).

### Quiet period too short (Matt, watching, 18 Nov): fixed, Acrobat and SumatraPDF re-run

Matt saw the tool move on before Acrobat and SumatraPDF had loaded. Cause: a step counted as
finished after 2.5 s (zooms) or 3 s (opens) without change, and those two sit still for longer
than that before drawing this page. Now **10 s for every step** (`--quiet` to change), the
untimed fit width waits as long, and the fit-page step needs a drawn page. Re-run on the aerial
drawing, `bench-output/viewers/20261118-1606/`, frames checked by eye:

| | 2.5 to 3 s quiet | 10 s quiet |
|---|---:|---:|
| Acrobat open | 5994 | 5928 |
| SumatraPDF open | 4806 | 4586 |
| SumatraPDF to fit width, settled | 80 (a blur) | 4143 (drawn) |
| Acrobat to fit page / fit width | 200 / 183 (blank page) | void: its error box covers the view in every run |

- **The opens did not move**, so the open table above stands for these two.
- **SumatraPDF's fit width was cut short by 4 s.** Its typed zoom on this drawing goes white
  (see the correction above): void here, sound on the other four.
- **Acrobat's fit steps can't be timed on this drawing**: the frames now show the sheet drawn,
  but "Font Capture: Windows - Application Error" sits over the watched area each run.
- **Every figure taken with the short quiet period is suspect until re-run at 10 s**, not just
  these two viewers: the J.2 tables above for Foxit, PDF-XChange, Chrome and Vellum, and the
  typed-zoom figures. Their saved frames showed finished pictures, so large changes are
  unlikely, but that is an inference.

### Typed zoom from fit page: tried, not good enough (18 Nov). Step J paused by Matt, resumed 22 Nov.

Matt timed SumatraPDF by hand on the aerial drawing: from fit page, a typed zoom to about 660%
lands on real drawing and takes about 6 s (from fit width it lands on blank paper, 25 to 49 ms).
So the tool was changed to start the typed zoom from fit page, and to void a zoom that lands on
a blank view. Matt watched the run and stopped it part-way: **viewers still land on title
blocks and top-left corners, not the middle of the sheet.** Partial results
(`bench-output/viewers/20261118-1632/`, Vellum 3 runs and Foxit 1) are not for quoting.

Where step J stands:

- **Sound, with the caveats stated beside them:** cold opens on five drawings and seven
  viewers (table above; Acrobat and SumatraPDF confirmed at the 10 s wait, the other viewers
  measured at the 3 s wait).
- **Promising, not yet re-run at the 10 s wait:** launch to the whole sheet drawn on the aerial
  drawing (Vellum first). Needs one timed step rather than a sum, and all five drawings.
- **Not usable:** every typed-zoom comparison, from last night or today. Needs the tool to put
  every viewer on the middle of the sheet reliably before zooming (not solved: fit page then
  zoom does not do it in every viewer), and to check the landing.
- **Not built:** the drag, the wheel notches, reopen time.
- `tools/viewer-bench` changes today, all uncommitted: the two-direction content test, the
  first-look stamp, stamps after the grab, the look-time figure, timed fit page and fit width,
  the 10 s quiet period (`--quiet`), typed zoom from fit page, blank-landing void. Backups of
  the files before the first change are not kept in the repo.

### Zoom at the centre with Ctrl+wheel (22 Nov, Matt's choice: closest to real use)

Matt wants zoom benchmarks that land on the middle of the sheet, by Ctrl+wheel with the pointer
there, and a tool that runs any PDF dropped into a folder (no per-file tables).

**How the centre is found, for any PDF** (`tools/viewer-bench/Centre.cs`): press fit width,
grab the client area, press fit page, grab again. Where the two differ is the document area
(toolbars and panels don't change); at fit page every viewer centres the sheet in it. Inside it
the page is meant to be what differs from the surround, but on the aerial drawing that box came
out the same as the document area in every viewer, so the centre used is the document area's.
Fine at fit page; to revisit for viewers that don't centre the page.

**Probe** (`ViewerBench wheelprobe <files>`): find the centre, then six single Ctrl+wheel
notches there, reading the level and saving a frame after each. Aerial drawing,
`bench-output/viewers/wheelprobe-20261122-1953/`:

| Viewer | Levels after 0 to 6 notches | Stays on the middle? |
|---|---|---|
| Vellum (main) | 5, 5.6, 6.3, 7, 7.9, 8.8, 9.9 (12% a notch) | yes |
| Foxit | 1.14, 7.98, 8.33, 12.5, 25, 33.3, 43.7 (preset steps) | yes |
| PDF-XChange | 1.09, 6.25, 8.33, 12.5, 25, 33.3, 44.6 (preset steps) | yes |
| SumatraPDF | levels unreadable ("8" to "13") | unclear: early frames show the top of the sheet |
| Chrome | 128 to 487 (25% a notch) | no: never reached fit page (its key toggles, and the probe pressed it twice) |
| Acrobat | 1.02 throughout | no zoom: its error box was up and took the input |
| Edge | | document area not found |

To fix before timing: Chrome's fit-page toggle, Acrobat's error box (dismiss it before the
gesture, not only between runs), SumatraPDF's level readback, Edge. Then choose the timed
gesture: notch sizes differ by up to 7x, so "the same number of notches" lands at very different
levels; "notches to reach about the same level" (count per viewer from the probe) compares like
with like.

**Probe 3 (22 Nov, `wheelprobe-20261122-2010/`), after Matt saw Vellum, Foxit and PDF-XChange
land near the centre but on different parts.** The page is now found as the run of mostly-page
columns nearest the middle of the document area (the biggest run picked Vellum's mini map and
Acrobat's side panel), then its rows. Chrome and Edge's fit key is a toggle, handled. By eye:
Foxit and PDF-XChange now land on the same road interchange at 44%; SumatraPDF and Chrome land
on the same area at lower zoom; Vellum stays centred but only reaches 9.9% in six notches (its
12% notch). Still open: **Acrobat never zooms** (Ctrl+wheel ignored even with its error box
closed and the window in front); **SumatraPDF's zoom dialog misreports the level** (reads 8% to
13% while the frames show about 45%); **Edge's document area isn't found**; the page's rows come
out short in Foxit and PDF-XChange (white parts of the imagery look like their light surround),
so the centre's height still comes partly from the document area.

### SumatraPDF fixed, Acrobat parked (22 Nov)

**SumatraPDF.** Its percentages are on a different scale (its 100% is about Vellum's 360%,
steps follow a log-like law, its fits show as words: Matt, 22 Nov), so a target can't be read
off its box at fit width. The tool now sets SumatraPDF's smallest level, 8% (an A0 sheet still
fits across the window), measures the sheet's width on screen, and takes fit width as 8% x
document-area width / sheet width. Aerial drawing (`bench-output/viewers/20261122-2037/`):
sheet 288 px at 8% (286 expected from the page size), area 1499 px, fit width 41.6% (Vellum's
131% x 1499/1306 / 3.6 = 41.7%), target 166%, reached 176% after 33 notches. The per-file
page-width table is gone.

**Acrobat: parked by Matt ("it's slow anyway").** What is known: a real Ctrl+scroll zooms a
clean Acrobat (Matt, by hand, in an instance the tool opened with `open`, which raises no error
box). Three kinds of injected Ctrl+wheel never visibly zoomed it: SendInput after SetCursorPos,
SendInput after an injected mouse move, and WM_MOUSEWHEEL posted with MK_CONTROL to the window
under the pointer (`ViewerBench methodprobe acrobat <file>`). Its "Font Capture: Windows -
Application Error" box appears during runs but not on a plain open, even with no UI Automation
reads before the notches, so the trigger is unknown. In one probe its fit-page key didn't take.
Acrobat stays in the open table (1.1 to 6 s, well behind the leaders); no zoom figures.

**Edge: zoom parked by Matt (22 Nov).** Its PDF toolbar (Adobe-style, "Edit with Acrobat")
has zoom out, zoom in and a fit toggle but shows no zoom level anywhere (`probe edge`, frame
`bench-output/viewers/probe-edge.bmp`), so the 4x-fit-width target can't be found by counting
notches. Measuring the zoom from the screen (matching frames between notches) would work but
wasn't judged worth it. Edge stays in the open table (1.5 to 4.8 s); Chrome covers browsers for
zoom. So the wheel test runs on Vellum, Foxit, PDF-XChange, SumatraPDF and Chrome.

## Step 1 of Next steps: heavy pages banded at fit (22 and 23 Nov)

**Design** (agreed with Matt; reviewed by a second model, which added the cancel, threshold
and thumbnail points):

- Each page's own worker parses it once and reports a profile: does it need one band (a
  swapped or slow-to-decode image, as before) and how many objects it has, counting into
  form XObjects. The coordinator keeps it. `bands_for(w, h, profile, workers)` in
  `pdfium.rs` is the whole rule: one worker for a one-band page, or for a region of 0.5 MP
  or less on a page under `HEAVY_PAGE_OBJECTS` (200,000); otherwise every worker.
- Small renders now ask for the profile too (before, they asked nothing). The question
  carries the render's cancel flag and the worker skips it if cancelled, so scrolling past
  pages doesn't queue parses nobody needs. A cancelled answer is not remembered.
- Thumbnails always render on one worker: banding them would have every worker parse every
  heavy page for nothing urgent.
- The front end asks the backend how many workers a render occupies (`doc_known_bands`
  now takes the region's size) instead of assuming small means one. This only decides when
  thumbnails may run beside a render. Images keep the old assumption.
- `VELLUM_PDFIUM_TIMING=1` prints each page's object count and how long counting took.
- Tests: the rule in `tests/bands.rs` (both sides of both thresholds, one-band pages, never
  zero), a cancelled first render in `tests/cancel.rs`, three viewer tests for small renders.

**Choosing the threshold.** Object counts, page 1 unless stated:

| Page | Objects |
|---|---:|
| Aerial drawing | 327,207 |
| Curtis Hall p48 (densest ordinary page known) | 88,244 |
| Xero stage plan | 74,423 |
| Silverstone (three revisions) | 8,649 to 10,531 |
| Fieldwork Festival set | 9,672 |
| Curtis Hall p1 | 2,343 |
| 50 MB sample | 44 |
| Bayou cover (one scanned image; one band anyway) | 1 |

The handoff's 50,000 would have caught Curtis Hall and the stage plan, bringing back the
many-pages thrash `e337efb` fixed (40 pages: 81 s against 1.9 s). 200,000 sits 2.3x above
the densest ordinary page and 1.6x below the aerial drawing. Only page 1 of the Fieldwork
set and Bayou, and pages 1 and 48 of Curtis Hall, were counted.

**Results**, `tools/bench.mjs --runs 3 --pdfium-threads 8 --size 1600x960`, median of 3, old
(`%TEMP%\vellum-smoke\step1-main-bde9832`) and new (`%TEMP%\vellum-smoke\heavy-band`)
builds run back to back:

| Aerial drawing | Before | After |
|---|---:|---:|
| First band (ms) | 3432 | 1464 |
| First page complete (ms) | 3432 | 1999 |
| Settle to sharp, fit / 400% / 1600% (ms) | 2339 / 167 / 150 | 450 / 67 / 152 |
| Peak memory (MB) | 4998 | 3221 |

| | Curtis Hall p1, old / new | Stage plan, old / new |
|---|---|---|
| First band (ms) | 97 / 82 | 181 / 180 |
| First page (ms) | 114 / 131 | 314 / 314 |
| Fit / 400% / 1600% (ms) | 66 / 105 / 83 → 66 / 104 / 85 | 117 / 99 / 82 → 119 / 88 / 83 |
| Peak memory (MB) | 1029 / 1049 | 1027 / 986 |

- Fit is back to v0.1's 437 ms. The first band arrives at 1.5 s and the page completes
  half a second later, instead of a white page for 3.4 s.
- 400% on the aerial drawing also improved (167 → 67 ms), probably because every worker has
  already parsed the page by then. Not confirmed.
- Ordinary drawings: within noise. The stage plan's 1600% is 82 to 83 ms on both builds,
  against 198 ms on 18 Nov, which supports "partly a bench artefact" for problem 3.
- Peak memory: the old exe reads 650 to 700 MB higher than on 18 Nov on all three drawings.
  Not caused by this change (see "What is wrong", 4).

**Scale probe: no step found.** A throwaway test (deleted after) rendered the whole aerial
page on one PDFium instance, with the app's matrix and flags, at 12 scales from 0.0533 to
0.0884; fresh parse per scale, three renders each:

- First render 2.5 to 4.1 s; repeats 2.3 to 2.7 s at every scale from 0.0625 to 0.0743,
  bar one outlier (0.0718, about 3.9 s, with normal neighbours). No step.
- Private memory about 2.45 GB after the first render at every scale: PDFium keeps every
  decoded image regardless of scale, so a cache-size limit is not the mechanism.
- The 1.26 s repeats logged in the app at `e337efb` (rs 0.0533 and 0.0667) are not
  reproduced; nothing here goes below 1.9 s. So the extra second at `71ae3f1` came from
  something else in that commit, not the scale. Untested lead: in the app the page had
  first been rendered as the 0.1422 preview on the same worker. Dropped: the fix restores
  v0.1's fit, and the banded render won't meet a scale cliff.

## Progress

- 18 Nov: scope written and agreed in outline with Matt (ease stays; landing → sharp is the
  measure; order 1, J, 3 with 2 interleaved, 4, 5; one true headline number is the minimum
  for this release).
- 18 Nov: step 1 done. Regression confirmed by an A/B against the spike's code and pinned
  by a bisect to `e337efb` and `71ae3f1` (results above).
- 18 Nov: diagnosis reviewed; checks 1 and 2 run. The regression is specific to the aerial
  drawing. The stage plan's 1600% slowdown is pinned to `71ae3f1`: not PDFium, probably
  stale same-scale renders queued on the channel (check 4). The memory cause is open. No code changed. Next: step J.
- 22 Nov: zoom benchmarks resumed. Centre finding, wheel probe, SumatraPDF units and the timed
  wheel test built in `tools/viewer-bench`; sound for Vellum and Chrome only. Acrobat and Edge
  zoom parked. Cross-viewer zoom comparison parked in favour of fixing Vellum first; see
  "Start here". No Vellum code changed; nothing committed.
- 22 and 23 Nov: next step 1 done. Pages of 200k+ objects are banded even when the region is
  small; aerial fit 2339 → 450 ms, ordinary drawings unchanged. The scale step did not
  reproduce. All tests pass (1223 front end, 270 Rust).
  Next: step 2, re-run the open tests on this build and propose the homepage number.
