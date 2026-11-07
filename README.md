# Vellum (phase 0 spike)

A fast PDF viewer for CAD drawings (stage plans, rigging plots, venue drawings). This
repository is the **phase 0 rendering spike**: the thinnest viewer that opens a PDF and
navigates it, built to measure whether pdf.js is good enough or rendering must move to
PDFium. The answer is in [RESULTS.md](RESULTS.md); how it works is in
[ARCHITECTURE.md](ARCHITECTURE.md).

## What you need installed (once)

1. **Node.js** via **Volta**. With Volta installed, the right Node and npm versions are picked
   up automatically from `package.json`. Get Volta from <https://volta.sh>.
2. **Rust**. Install from <https://rustup.rs> and accept the defaults.
3. **Microsoft C++ Build Tools**. Download "Build Tools for Visual Studio" from
   <https://visualstudio.microsoft.com/visual-cpp-build-tools/> and tick
   **Desktop development with C++**. Rust needs this to link Windows programs.
4. **WebView2 Runtime**. Already part of Windows 11 and up-to-date Windows 10. If the app
   won't start on an older Windows 10 machine, install the "Evergreen Bootstrapper" from
   <https://developer.microsoft.com/microsoft-edge/webview2/>.

Full background: <https://tauri.app/start/prerequisites/> (Windows section).

## First-time setup

Open a terminal (PowerShell or Windows Terminal) in this folder and run:

```bash
npm install
```

The PDFium library (the default renderer, see RESULTS.md) is downloaded automatically the first
time you run or build. To fetch it by hand:

```bash
node tools/fetch-pdfium.mjs
```

If it's missing, Vellum falls back to pdf.js.

## Run it

Development mode (opens a window, reloads when the code changes):

```bash
npm run tauri dev
```

To open a file straight away in development mode:

```bash
npm run tauri dev -- -- "C:\path\to\drawing.pdf"
```

Build a proper release (an installer in `src-tauri\target\release\bundle\nsis\`):

```bash
npm run tauri build
```

Just the program, no installer (faster; ends up at `src-tauri\target\release\vellum.exe`):

```bash
npm run tauri build -- --no-bundle
```

The release program takes a file path, so Windows "Open with…" works:
`vellum.exe "C:\path\to\drawing.pdf"`. Add `--renderer pdfjs` to use pdf.js instead of PDFium (the default),
and `--debug` to start with the performance overlay showing.

## Using it

Open a file with **Ctrl+O**, by clicking the file name in the top bar, by dragging a PDF onto
the window, or from the command line.

| Action | CAD mode (default) | Document mode |
|---|---|---|
| Pan | Middle-button drag, or Space + left drag | Same |
| Zoom at cursor | Mouse wheel | Ctrl + wheel |
| Scroll | Touchpad two-finger scroll | Mouse wheel |
| Horizontal scroll | Shift + wheel | Shift + wheel |
| Pinch zoom | Touchpad pinch | Touchpad pinch |
| Fit page | Double-click middle button, Ctrl+0 | Ctrl+0 |
| Actual size | Ctrl+1 | Ctrl+1 |
| Zoom in / out | + / - | + / - |
| Previous / next page | Page Up / Page Down | Same |
| First / last page | Home / End | Same |
| Performance overlay | F12 (or Ctrl+Shift+D) | Same |
| Switch renderer (PDFium / pdf.js) | Ctrl+Shift+R | Same |

The CAD/Document switch and Continuous/Single page switch are in the top bar and are
remembered between launches.

## Measuring performance

With the overlay showing (F12), every re-render is logged to
`%LOCALAPPDATA%\Vellum\perf-log.csv`.

The benchmark repeats a scripted open, zoom and pan sequence several times per file and
writes median results:

```bash
npm run gen:synthetic
npm run tauri build -- --no-bundle
npm run bench -- --runs 3 --renderer pdfjs
npm run bench -- --runs 3 --renderer pdfium
```

Put your own PDFs in `test-files\` (ignored by git) and they're included automatically.
Results land in `bench-output\` (also ignored): a summary table per renderer plus a
screenshot at each zoom level for checking seams and missing content. The benchmark window
stays on top while it runs; leave the machine alone until it finishes.

## Tests

```bash
npm test
```

runs the unit tests (zoom-at-cursor maths, page layout, tile grid and cache).
`cd src-tauri` then `cargo test` runs the Rust ones (command-line parsing).
