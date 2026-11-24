# Fastest in every scenario: what it would take (parked)

**Status: parked by Matt, 24 Nov 2026.** Not scheduled; listed in [backlog.md](backlog.md),
"Speed". Written in answer to "what would we have to do to be the fastest PDF viewer in all
scenarios?". Figures from [speed-diagnosis-scope.md](speed-diagnosis-scope.md) as of
24 Nov (the open comparison of 22 to 23 Nov; the single-notch zoom comparison of 23 to
24 Nov, whose other-viewer figures predate Vellum's 4 px landing). Re-check them before
acting on any of this.

## Where Vellum loses today

| Scenario | Who's faster | By how much |
|---|---|---|
| Open, light drawings (launch to whole sheet drawn) | PDF-XChange on 3 of 5 drawings; SumatraPDF on the stage plan | 100 to 300 ms |
| Zoom, light drawings, whole wait (notch to sharp) | Foxit, PDF-XChange, SumatraPDF | about 50 ms (64 against 114 ms) |
| Zoom, heavy drawings | nobody yet, but a third of notches on the aerial drawing take 480 to 720 ms | |
| Everything not measured | unknown | |

Where it wins: the heaviest open (aerial drawing, 1.7x the next viewer), about 2x Acrobat on
every open, the heavy zoom, and zoom finished to sharp on every drawing (a frame or two).

## What it would take

1. **Start-up (opens).** 330 to 390 ms of every cold open goes on starting the app (WebView2
   plus Tauri) before the PDF is asked for; native viewers don't pay that. Levers: parse and
   render the first page in Rust from process start, overlapping the webview starting (they
   overlap only partly now); a first low-resolution picture as soon as the window exists; a
   warm resident process (as Acrobat does) for repeat opens, not the first. Realistic gain
   150 to 300 ms, about the size of the gap. Medium work, mostly Rust and the start-up path;
   care needed not to slow first paint.
2. **Band delivery to the webview (heavy drawings).** At high zoom, bands of up to 20 MB are
   copied across IPC and decoded on the webview's main thread: the 480 to 720 ms notches on
   the aerial drawing, and probably most heavy-drawing waits. Options run from shared memory
   or smaller pixel formats up to a native drawing surface that bypasses the webview for the
   canvas, which could also cure the free-spin jerk (speed-diagnosis-scope.md, 3d) and some
   of the open cost. Largest gain left, largest work: weeks, needs a scope first. This is
   handoff idea 1 in [speed-handoff.md](speed-handoff.md).
3. **The ease (a product decision, not engineering).** On light drawings Foxit and
   PDF-XChange win the whole wait only because they don't animate: instant, then sharp.
   Vellum's ease is now about 100 ms of its 114. To win that row: shorten the ease (halving
   its time constant gives about 60 ms, roughly level) or drop it, as considered and decided
   against on 18 Nov. Either costs the sense of place the ease gives. Only matters if the
   claim is about the whole wait; on zoom finished to sharp Vellum already wins.
4. **Measure everything else first.** "All scenarios" also means page turns and scrolling in
   a multi-page set (Fieldwork), text search, thumbnails, printing, photos and scans, and
   other machines (a slower laptop, a 4K screen). None is compared with other viewers yet;
   some may be wins, some bigger losses than the above. Mostly viewer-bench work, about a day
   per scenario to build and run.

## View

"Fastest PDF viewer in all scenarios" can't be defended: one counter-example sinks it, and
start-up alone means a native viewer will likely always open a small file a little sooner.
The defensible position is the one the architecture is built for: **fastest on big CAD
drawings** (multi-worker PDFium, banding, image swaps, render-ahead). Vellum already wins the
heaviest open and the heavy zoom, and (2) would widen both.

Suggested order if picked up: the same-session zoom rerun (speed-diagnosis-scope.md, "What
is open" 1) to confirm where things stand; scope band delivery (2); start-up (1); decide the
ease (3) whenever wanted.
