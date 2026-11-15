# Vellum

A PDF and image viewer for people who open drawings, not documents.

Stage plans, rigging plots, venue drawings, 1:19 aerial photos, sixty-year-old scanned
blueprints: the files that make general-purpose PDF readers sit and think. Vellum opens them
fast, zooms where your cursor is, and prints them at a scale you chose rather than one the
printer driver made up.

It's for Windows, it's built with Tauri, and it renders with PDFium (the engine inside Chrome),
because the rendering spike tried the alternatives and PDFium won. The numbers are in
[RESULTS.md](RESULTS.md).

## What it's good at

- **Opening big drawings quickly, and staying smooth.** Pages render as tiles, low-resolution
  previews fill the gaps while you move, and previews are cached on disk so a drawing you opened
  yesterday is on screen before you've let go of the mouse. Huge embedded JPEGs are decoded by
  Vellum itself, once, with their colour profile applied, instead of by PDFium on every redraw.
- **Navigating like a CAD program.** The wheel zooms at the cursor, middle-drag pans, double
  middle-click fits the page. Office documents get Document navigation instead (the wheel
  scrolls), picked automatically from the page size. **N** swaps them if it guesses wrong.
- **Knowing where you are.** A mini map for drawings bigger than the window. The drawing scale
  read from the title block, so the status bar shows real-world metres under the cursor. Tabs
  that remember each file's page, zoom, rotation, layout and mini map, next time as well as
  this time.
- **Printing properly.**
  - **Sizing:** Fit, Actual size, To scale (a real ratio like 1:200 when the drawing scale is
    known, a percentage when it isn't), or Tile with cut marks.
  - **Manual layout:** lay pages and crops out by hand across as many sheets as you need, with
    scale labels. It's remembered with the file you printed from.
  - **Black lines:** turns grubby scans into clean linework. Paper texture and stains go,
    lines go solid black, and blueprints are flipped to black on white, page by page.
  - **Save as PDF** honours all of that, colour modes included.
- **Images too.** JPEG, PNG, WebP, TIFF, BMP and GIF open the same way.

## What it isn't (yet)

- **An editor.** No markup, no annotations, no measuring tools. Markup and light editing are
  next on the list; PDF layers come alongside or after them.
- **Cross-platform.** It's Windows-only: printing talks to GDI and the driver directly. Most of
  the rest would port; nobody's asked.
- **A document reader.** No text search, no forms. If your PDF is mostly words, Edge already
  does that well.

## Installing and updates

The installer for the latest version is on the
[releases page](https://github.com/canoemoose/Vellum/releases/latest). Windows SmartScreen
warns about it the first time, because the installer isn't code signed: "More info", then
"Run anyway".

After that, Vellum keeps itself up to date. It looks for a new version when it starts, at most
once a day, and shows a small notice when there is one; nothing downloads until you press
"Install and restart", and your tabs come back afterwards. The check is one request to GitHub
and sends nothing about you or your files. Turn it off, or check on demand, from the Help menu.

## Getting it running

You need these once:

1. **Node.js through [Volta](https://volta.sh).** `package.json` pins the versions; Volta
   picks them up.
2. **Rust**, from <https://rustup.rs>, defaults are fine.
3. **Microsoft C++ Build Tools** ("Build Tools for Visual Studio", with **Desktop development
   with C++**). Rust needs them to link Windows programs.
4. **WebView2 Runtime.** Already on Windows 11 and current Windows 10. Older machines: the
   "Evergreen Bootstrapper" from Microsoft.

Tauri's own list is at <https://tauri.app/start/prerequisites/> if you want the long version.

Then, in this folder:

```bash
npm install
```

```bash
npm run tauri dev
```

PDFium (`pdfium.dll`) downloads itself the first time you run or build. To fetch it by hand:

```bash
node tools/fetch-pdfium.mjs
```

To open a file straight away in development:

```bash
npm run tauri dev -- -- "C:\path\to\drawing.pdf"
```

Release builds: `npm run tauri build -- --no-bundle` makes the exe. A copied exe needs
`pdfium.dll` beside it. Installers are built and signed by GitHub Actions from a version tag,
not at the desk; the steps are under Releasing in [CLAUDE.md](CLAUDE.md).

The exe takes a file path, so Explorer's "Open with" works. Only one Vellum runs at a time:
opening another file adds a tab to the running window. `--new-instance` starts a separate one,
`--debug` starts with the performance overlay. The installer adds Vellum to "Open with" for PDFs
and images without making itself the default for anything; that's your call.

## Using it

Open files with **Ctrl+O**, the **+** after the tabs, by dropping them on the window, or from
Explorer. New files open in the Continuous layout; files you've opened before open as you left
them. Hover over a tab for a preview of where you were.

| Action | CAD navigation | Document navigation |
|---|---|---|
| Pan | Middle-drag, or Space+drag | Same |
| Zoom at cursor | Mouse wheel | Ctrl+wheel |
| Scroll | Touchpad two-finger scroll | Mouse wheel |
| Horizontal scroll | Shift+wheel | Shift+wheel |
| Pinch zoom | Touchpad pinch | Touchpad pinch |
| Fit page | Double middle-click, Ctrl+0 | Same |
| Fit width | Ctrl+2 | Same |
| Actual size | Ctrl+1 | Same |
| Zoom in / out | + / - | Same |
| Single page / Continuous / Columns | Ctrl+Shift+1 / 2 / 3 | Same |
| Switch navigation | N | Same |
| Previous / next page | Page Up / Page Down | Same |
| First / last page | Home / End | Same |
| Rotate the view | ] / [ | Same |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Same |
| Close tab | Ctrl+W, or middle-click the tab | Same |
| Print | Ctrl+P | Same |
| Document properties | Ctrl+D | Same |
| Sidebar (pages and bookmarks) | Ctrl+B | Same |
| All the shortcuts | F1 | Same |
| Performance overlay | F12 (or Ctrl+Shift+D) | Same |
| Menus from the keyboard | Alt or F10 | Same |

The **View** menu has navigation, layout, theme (Dark, Light or System), units (paper sizes,
read-outs, and measurements set to Auto), the sidebar and
the mini map (Automatic, Show or Hide). The mini map resizes from its top-left corner
(double-click resets it); click or drag inside it to move around.

The status bar shows the drawing scale (click it to set it by hand when the title block doesn't
say), the cursor position (metres on site when the scale is known, millimetres on paper when it
isn't, from the page's bottom-left corner) and the page size.

### Printing, briefly

**Ctrl+P.** Pick the printer and paper (A sizes first; the US sizes the driver insists on are
under "Other sizes"), then Pages, then Layout:

- **Automatic** sizes each page by the Sizing you pick, with N-up, centring, borders and a
  margin stamp under Arrangement.
- **Manual** opens the layout editor. Drag pages in from the strip, crop by dragging an edge,
  scale from a corner or by ratio, label with file name, page and scale in any mix. Back in the
  dialog, Colour, Output and Advanced apply to it as they would to anything else.

The preview zooms (wheel; drag to move; double-click to fit). For Black lines, use **View 1:1**:
it judges dots, and you can only judge dots at print resolution.

## How it's built

Rust does the heavy work; the web view draws the interface.

- **`src-tauri/`** (Rust): PDFium on a pool of worker threads, tile rendering, the disk preview
  cache, image documents, colour profiles, print composition, GDI printing, and the Black lines
  filter.
- **`src/lib/engine`, `src/lib/render`, `src/lib/view`** (TypeScript, no Svelte): the viewer,
  tile scheduling, input, and the navigation maths. The maths is pure and tested, and stays
  that way.
- **`src/lib/print`** (TypeScript): the print model (automatic layout, manual layout, page
  ranges, settings) as pure functions, plus the preview painter.
- **`src/`** (Svelte 5): the shell. Components call into the engine; the engine never imports
  Svelte.

The long version is [ARCHITECTURE.md](ARCHITECTURE.md). Speed work starts at
[docs/speed-handoff.md](docs/speed-handoff.md): what's been measured, what's been tried, what
didn't work.

## Tests

```bash
npm test
```

runs the TypeScript tests (Vitest): navigation maths, layouts, the print model, Black lines,
settings, menus and keys. Then:

```bash
cd src-tauri && cargo test
```

runs the Rust ones: documents, images, colour swaps, the preview cache, print composition and
geometry, Black lines, and a real print to "Microsoft Print to PDF".

`npm run check` type-checks the lot (svelte-check, strict).

## Measuring performance

With the overlay showing (F12), every re-render is logged to
`%LOCALAPPDATA%\Vellum\perf-log.csv`.

The benchmark runs a scripted open, zoom and pan sequence several times per file and reports
medians:

```bash
npm run gen:synthetic
```

```bash
npm run tauri build -- --no-bundle
```

```bash
npm run bench -- --runs 3 --pdfium-threads 8
```

Drop your own PDFs in `test-files\` (git ignores it) and they're included. Results go to
`bench-output\` (also ignored): a summary table and a screenshot at each zoom level, for
spotting seams and missing content. The benchmark window stays on top; leave the machine alone
until it's done.

## Licence

Vellum is MIT licensed ([LICENSE](LICENSE)). It ships PDFium and a few hundred open-source
crates and packages; `tauri build` collects every one of their notices and licences into
`THIRD-PARTY-NOTICES.txt` ([tools/make-notices.mjs](tools/make-notices.mjs)), which the
installer puts beside the exe and Help > About opens.

## Where things are written down

- [ARCHITECTURE.md](ARCHITECTURE.md): how it works.
- [RESULTS.md](RESULTS.md) and [PLAN.md](PLAN.md): the rendering spike and why PDFium.
- [docs/vellum-v0.1-brief.md](docs/vellum-v0.1-brief.md) and
  [docs/v0.1-report.md](docs/v0.1-report.md): what v0.1 set out to do, and where it got to.
- [docs/ui-review.md](docs/ui-review.md): the interface review, every decision, and what's
  still open.
- [CLAUDE.md](CLAUDE.md): commands and conventions in one place.
