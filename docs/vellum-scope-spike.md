# Vellum — Phase 0 scope: rendering and navigation spike

**Status (26 November 2026): the brief for phase 0, kept as a record.** The spike is done
([RESULTS.md](../RESULTS.md)); section 1 is still a fair description of the product.

**Mode:** autonomous. Work through this without check-ins, batch any questions, and finish with a summary of what was built, assumptions made, measured results and flags.

**Working name:** Vellum (codename only; final name undecided).

## 1. What Vellum is (context, not this phase's scope)

A fast, modern PDF and image viewer for Windows, aimed at people who work with CAD-exported drawings (stage plans, rigging plots, venue drawings) as well as ordinary documents. Think macOS Preview, plus:

- CAD-style navigation (middle-drag pan, zoom at cursor).
- Markup and measurement on drawings.
- Serious print options, including manual layout of pages and images onto sheets.
- Opens images (JPG, PNG, TIFF, WebP, HEIC) as single-page documents.

UI mockups exist (dark and light main window, File menu, print dialog, manual print layout). They are reference for later phases, not this one.

## 2. Purpose of this phase

Answer one question with numbers: **can pdf.js inside Tauri render and navigate very large CAD PDFs smoothly enough, or does rendering need to move to PDFium in the Rust backend from the start?**

Build the thinnest possible viewer that opens a PDF and navigates it, measure it against heavy files, and recommend a rendering architecture.

## 3. Stack (decided)

- **Tauri 2** (WebView2 on Windows).
- **Svelte 5 + TypeScript** front end, Vite build.
- **pdf.js** (`pdfjs-dist`, latest stable) for rendering, running in its web worker.
- **npm** as package manager.
- Target: Windows 11 x64. Must also build and run in dev on Windows 10.
- If and only if pdf.js fails the acceptance criteria (section 7): prototype rendering through **PDFium** via the `pdfium-render` crate in the Rust backend, sending tiles to the front end, and measure again.

Licensing constraint: no AGPL dependencies (so no MuPDF). pdf.js (Apache 2.0) and PDFium (BSD/Apache) are fine.

## 4. In scope

### 4.1 App shell
- Single window, Tauri default decorations are fine for now.
- Open a file via: File → Open dialog, drag and drop onto the window, and command-line argument (so "Open with…" works).
- Minimal top bar: file name, page `n of N`, zoom percentage, Fit page, Fit width. Nothing else.
- Dark theme only for this phase, using the tokens in section 9.

### 4.2 Rendering
- Continuous vertical scroll of all pages with gaps between, plus a single-page mode toggle.
- Render only pages in or near the viewport; release offscreen canvases.
- **Tiled rendering at high zoom.** Chromium canvases cap out (roughly 16,384 px per side and around 268 MP area), and an A1 sheet at 800% blows through that. Render visible tiles at the current zoom, not whole pages.
- **Two-stage zoom:** during active pan or zoom, transform the existing bitmap with CSS (instant, slightly soft); once input settles (about 150 ms), re-render visible tiles sharp at the new scale. Cancel in-flight renders that are no longer needed.
- Render at device pixel ratio so it's sharp on high-DPI screens.
- A simple LRU tile cache with a memory ceiling.

### 4.3 Navigation (the important bit)
Default **CAD mode**:
- **Middle-button drag:** pan freely in both axes, 1:1 with the cursor. No autoscroll mode.
- **Mouse wheel:** zoom in and out **anchored at the cursor** (the point under the cursor stays put). Smooth, not stepped by huge jumps; about 10–15% per notch.
- **Double-click middle button:** fit page.
- **Space + left drag:** pan (for trackpads and mice without a usable middle button).
- **Shift + wheel:** horizontal scroll. **Ctrl + wheel:** also zooms (so it works for people with document-viewer habits).
- Trackpad: two-finger scroll pans, pinch zooms at the gesture centre.
- Keyboard: `+`/`-` zoom, `Ctrl+0` fit page, `Ctrl+1` actual size, PgUp/PgDn and Home/End for pages.

Also implement a **Document mode** toggle (wheel scrolls, Ctrl+wheel zooms) as a setting, since some PDFs are just documents. Remember the choice between launches.

Zoom range: 5% to 6400%.

### 4.4 Instrumentation
Built-in, toggled by `F12` or a debug flag, showing live:
- Frames per second during pan and zoom.
- Time from input settling to sharp re-render.
- Tiles in cache and estimated memory.
- JS heap where available.

Plus a log to file (`%LOCALAPPDATA%\Vellum\perf-log.csv` or similar) of each test run.

## 5. Out of scope for this phase
Markup, measuring, search, text selection beyond whatever pdf.js gives for free, thumbnails sidebar, tabs, menus, light theme, printing, images, saving, settings UI (beyond the mode toggle), installer and code signing.

## 6. Test files and procedure

### 6.1 Files
- **Matt will supply** his heaviest real PDFs (dense venue CAD exports, rigging plots). Look for them in a `test-files/` folder in the repo, which is git-ignored. If it's empty, ask in the final summary and run the synthetic tests anyway.
- **Generate synthetic stress files** with a script in `tools/` (Python or Node, your choice) and commit the script, not the output:
  1. A1 single page, 200,000 vector line segments plus hatching.
  2. A1 single page with 50,000 small text objects (simulates dimension-heavy drawings).
  3. 40-page A3 drawing set, moderate density per page.
  4. A1 page with one large embedded raster (8,000 × 6,000 px) and vectors over it.
  5. An ordinary 300-page text document (sanity check that document mode is fine).

### 6.2 Measurements per file
Record in `RESULTS.md` as a table:
- Cold app start to window shown (ms).
- Open to first page visible (ms).
- Pan fps at fit-page zoom, at 400% and at 1600%.
- Zoom-settle to sharp (ms) at the same three zooms.
- Peak memory (MB) after a scripted pan and zoom sequence.
- Any visual faults: blank tiles, seams between tiles, flicker, mis-rendered hatching or fonts.

Run each measurement at least three times and report the median. Note the test machine spec (this will be run on a Ryzen AI 9 HX 370 with an RTX 4060 laptop GPU and 32 GB RAM; add a note on how a weaker machine might fare).

## 7. Acceptance criteria (decision rule)
pdf.js passes if, on the synthetic files 1, 2 and 4 and the heaviest real file:
- Cold start ≤ 1 s.
- First page visible ≤ 1.5 s.
- Pan holds ≥ 50 fps at all three zoom levels (CSS transform stage).
- Sharp re-render after settle ≤ 300 ms at fit page and ≤ 500 ms at 1600%.
- No visible tile seams or missing content.
- Memory stays under 1.5 GB.

If pdf.js fails any of these, prototype the PDFium path (section 3) and run the same tests. A hybrid is acceptable and possibly ideal: PDFium for raster tiles, pdf.js only for text layer and annotations later.

## 8. Deliverables
1. Repo with the spike app, building with `npm run tauri dev` and `npm run tauri build`.
2. `README.md`: prerequisites (Rust, WebView2, Node), build and run steps in plain language for a technician, not a software developer.
3. `tools/` with the synthetic PDF generator.
4. `RESULTS.md`: the measurement tables, observations, and a **clear recommendation**: pdf.js only, PDFium, or hybrid, with the reasoning.
5. A short `ARCHITECTURE.md` describing the rendering pipeline (viewport → tiles → cache → canvas), so later phases build on it rather than around it.
6. Final summary message: what was built, assumptions, results headline, recommendation, and anything Matt needs to do (such as supplying test files).

## 9. Visual reference (dark theme tokens)
Use as CSS custom properties. Light theme comes later but structure the CSS so it's a second token set, not a rewrite.

```
--chrome:    #141517  /* title and status bars */
--app:       #1b1c1f  /* panels */
--ctl:       #232428  /* control groups */
--bd:        #2a2c31
--bd-strong: #34363c
--tx:        #e6e7ea
--tx2:       #c9cbd1
--tx3:       #9a9da5
--canvas:    #2b2d31  /* area behind pages */
--accent:    #e5484d
```
Font: Inter for UI, JetBrains Mono for numbers (zoom %, coordinates). Pages render on white with a soft shadow on the `--canvas` background.

## 10. Conventions
- UK English in UI text and docs.
- TypeScript strict mode. Keep components small; navigation logic in its own module with unit tests for the zoom-at-cursor maths.
- Commit in logical steps with clear messages.
- Don't add dependencies beyond what's needed; justify anything non-obvious in `ARCHITECTURE.md`.
