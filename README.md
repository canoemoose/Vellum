# Vellum

A fast PDF and image viewer for CAD drawings (stage plans, rigging plots, venue drawings).
Phase 0 was a rendering spike that settled on PDFium (see [RESULTS.md](RESULTS.md)); v0.1,
the first real app, is in progress (brief in
[docs/vellum-v0.1-brief.md](docs/vellum-v0.1-brief.md), status in
[docs/v0.1-report.md](docs/v0.1-report.md)). How it works is in
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

The PDFium library (the only renderer, see RESULTS.md) is downloaded automatically the first
time you run or build. To fetch it by hand:

```bash
node tools/fetch-pdfium.mjs
```

If it's missing, Vellum says so and shows this command.

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
`vellum.exe "C:\path\to\drawing.pdf"`. Images (JPEG, PNG, WebP, TIFF, BMP,
GIF) open the same way. Only one Vellum runs at a time: launching it again (or double-clicking
another file) opens that file as a new tab in the running window. Add `--new-instance` to start
a separate copy, or `--debug` to start with the performance overlay showing.

The installer registers Vellum under "Open with" for PDFs and those image types, without making
it the default app for any of them.

## Using it

Open files with **Ctrl+O**, the **+** at the end of the tabs, by dragging them onto the window,
from Explorer's "Open with", or from the command line. Each file gets its own tab, which keeps its
own zoom, page and rotation.

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
| Rotate view clockwise / anticlockwise | R / Shift+R | Same |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Same |
| Close tab | Ctrl+W, or middle-click the tab | Same |
| Print | Ctrl+P | Same |
| Document properties | Ctrl+D | Same |
| Sidebar (pages and bookmarks) | Ctrl+B | Same |
| Keyboard shortcuts | F1 | Same |
| Performance overlay | F12 (or Ctrl+Shift+D) | Same |

CAD or Document navigation, Continuous or Single page, the theme (Dark, Light or System), the
accent colour, units, the sidebar and the mini map are in the **View** menu; all of them, the
recent files and the window's size and position are remembered between launches.

The status bar shows the drawing scale (found in the title block when there is one; click it to
set it by hand), the cursor position (real-world metres when the scale is known, otherwise
millimetres on the paper, measured from the page's bottom-left corner) and the page size.

## Measuring performance

With the overlay showing (F12), every re-render is logged to
`%LOCALAPPDATA%\Vellum\perf-log.csv`.

The benchmark repeats a scripted open, zoom and pan sequence several times per file and
writes median results:

```bash
npm run gen:synthetic
npm run tauri build -- --no-bundle
npm run bench -- --runs 3 --pdfium-threads 8
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
