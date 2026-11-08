# WP-Shell hand-over (branch `v0.1/shell`)

Brief: `docs/vellum-v0.1-brief.md` sections 1, 3.1 (UI parts), 3.2 and 7; mockups `Main` and
`Light`. Built on main after WP-Engine, WP-Images and WP-LOD were merged, so it uses the real
viewer API (no adapter was needed).

## What I built

- **Themes and tokens** (`src/app.css`, `src/lib/shell/theme.ts`): both token sets from the
  mockups on `:root[data-theme]`, Dark / Light / System (follows `prefers-color-scheme` live),
  four accents with "accent soft" (`2e` alpha) and a darkened accent border for filled buttons.
  Inter for UI, JetBrains Mono for numbers. The canvas colour follows the theme
  (`refreshCanvasColour()` on every change).
- **Title bar** (`TitleBar.svelte`): 40 px, no native decorations. Vellum mark, tabs (active tab on
  `--app` with a top-rounded border, inactive in `--tx3`, image icon on image tabs, an error icon
  on tabs that failed), file names truncated in the middle with the full path on hover, `+`
  opens the file dialog, minimise / maximise-restore / close. Drag region only on the brand and
  the empty space after the tabs; double-click there maximises (Tauri's drag region does that).
- **Tabs**: one Viewer and one canvas; switching detaches the current document (`viewer.detach()`)
  and attaches the next (`viewer.attach()`), so each tab keeps its zoom, page and rotation and
  comes back at once with its previews. Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+W, middle-click, drag to
  reorder, a context menu (Close tab, Close other tabs, Open containing folder, Copy path).
  Dropping files opens one tab each; opening a file that's already open switches to it. Opens
  are queued, so a drop or a forwarded launch never interrupts a file that's still opening.
  Tab model is pure (`src/lib/shell/tabs.ts`).
- **Single instance** (`src-tauri/src/shell.rs`, `tauri-plugin-single-instance`): a second
  launch forwards its file (made absolute against the sender's working directory) and exits;
  the running window opens it as a tab and comes to the front. Files forwarded before the front
  end is listening are queued in Rust and collected on start-up (`shell_take_pending`), so
  several files opened from Explorer at once all arrive. `--bench`, `--new-instance` and the
  `VELLUM_MULTI_INSTANCE` environment variable bypass it.
- **Menu bar** (`MenuBar.svelte`, `MenuPopup.svelte`, keyboard logic in `shell/menuNav.ts`):
  File, View, Document, Help. Open on click, switch on hover while open, close on Escape or an
  outside click; arrows, Home/End, type-ahead, Enter, Left/Right between menus and into
  submenus; Alt or F10 opens the first menu from the keyboard.
  - File: Open…, Open recent › (last 10, Clear), Export pages as images…, Reveal in Explorer,
    Print…, Document properties, Close tab.
  - View: zoom in/out, Fit page, Fit width, Actual size, Zoom › presets, Continuous / Single
    page, CAD / Document navigation, Sidebar, Mini map, Theme ›, Accent ›, Units ›,
    Performance overlay.
  - Document: Rotate view clockwise / anticlockwise, Drawing scale…, Properties.
  - Help: Keyboard shortcuts (searchable), About (version, PDFium build, licences).
- **Toolbar** (`Toolbar.svelte`): sidebar toggle; previous / editable page box / "of N" / next;
  zoom out, zoom % (JetBrains Mono; click for presets plus Fit page / Fit width / Actual size, or
  type "150", "150%", "1.5x"), zoom in, divider, Fit page, Fit width. Right-hand side left empty
  (markup tools, Search and Save are v0.2). Wraps when narrow.
- **Sidebar** (`Sidebar.svelte`, `Thumbnails.svelte`, `OutlineTree.svelte`): Pages and Outline,
  196 px default, drag the edge to resize (160 to 420 px, double-click resets), open/closed,
  width and tab remembered. Thumbnails are 132 px wide with the number below and an accent
  outline on the current page, which is scrolled into view. A thumbnail is only requested
  when its placeholder scrolls near view, through `viewer.thumbnail()` (low priority, cached
  per document), so a 300-page document opens no slower. Outline is the bookmark tree,
  loaded when the tab is first shown; click goes to the target (`gotoPagePoint`).
- **Mini map** (`MiniMap.svelte`): bottom-right, 150 × 106, `--map` fill, the current page's
  preview (`viewer.previewFor`) with the viewport (`UiState.pageViewport`) as an accent
  rectangle, drawn in the view's rotation. Drag the rectangle to pan, click elsewhere to jump
  there (`viewer.centreOn`). Toggle in View.
- **Status bar** (`StatusBar.svelte`): drawing scale ("Scale 1:200 (from title block)",
  "Scale 1:200", "Scale not set"; click opens the dialog), the mode's navigation hint, the
  cursor ("X 14.62  Y 8.03 m" with a scale, "X 312.4  Y 88.0 mm" without; inches and feet with
  imperial units) and the page size with its paper name ("A1 · 841 × 594 mm").
- **Drawing scale** (`ScaleDialog.svelte`, `shell/scale.ts`): on open the shell calls
  `renderer.findScale(docId, 0)` and adopts the best candidate only if it sits in a title-block
  position (bottom-right quarter, right-hand strip or bottom strip) and isn't 1:1. The dialog
  lists what was found on the page, common scales and a free entry ("1:200", "200", "1/200").
  A hand-set scale is remembered per file.
- **Password prompt** (`PasswordDialog.svelte`): "Password required" opens the prompt; "Wrong
  password" reopens it with the message; Cancel leaves the tab showing "This PDF is password
  protected" with an Enter password… button.
- **Files that can't be opened** show the backend's message in the tab with Try again and
  Close tab.
- **Document properties** (Ctrl+D): file, size, type and PDF version, pages, page sizes (with
  counts when mixed), title/author/subject/creator/producer, image note, drawing scale.
- **Export pages as images**: PNG or JPEG at 72/150/300/600 dpi, all / current / a range,
  into a chosen folder, with progress and Stop. Pages are rendered in strips through the
  renderer and composed on an `OffscreenCanvas`; pages that would exceed 16384 px a side or
  120 MP go out at a lower DPI and the result says so (`shell/exportPages.ts`).
- **Print hook**: File > Print… / Ctrl+P mounts WP-Print's `PrintDialog` with a `PrintContext`
  (open documents in tab order with their scales, active document, current page, the visible
  part of the current page in page points, `pickRegion()`, the renderer, the theme).
  `pickRegion()` shows a marquee overlay on the canvas (middle-drag and wheel still pan and
  zoom underneath); it resolves the rectangle in page points, or null on Escape or
  right-click.
- **Settings** (`src/lib/settings.ts`, every field validated on load): theme, accent, navigation
  and layout mode, sidebar open / width / tab, mini map, units, recent files, hand-set scales,
  window bounds and maximised state.
- **Window restore** (`shell/windowPlacement.ts`): size and position are saved (physical
  pixels, debounced) and restored before the window is shown, fitted onto the monitor work
  area the window overlaps most, or centred on the first monitor when its monitor has gone;
  maximised state restored on top of the normal bounds.
- **File associations** (`src-tauri/windows/installer-hooks.nsh`): NSIS hooks add
  `OpenWithProgids` entries for .pdf, .jpg, .jpeg, .png, .webp, .tif, .tiff, .bmp, .gif under
  HKCU plus an `Applications\vellum.exe` key, and remove them on uninstall. Tauri's own
  `fileAssociations` is not used because it writes each extension's default value, which makes
  Vellum the default wherever the user hasn't picked one. Installer stays NSIS, per user
  (`installMode: currentUser`).
- **Shell keys**: Ctrl+P, Ctrl+D, Ctrl+W, Ctrl+Tab, Ctrl+B (sidebar), F1 (shortcuts), R /
  Shift+R (rotate view). WebView2's own accelerators that don't belong in a viewer (F5 and
  Ctrl+R reload, Ctrl+F find, Ctrl+S save page, Ctrl+P print preview and similar) are
  swallowed.
- **Benchmark**: `--bench` shows only the 40 px title bar around the canvas, the same canvas
  size as the phase 0 top bar, so bench figures stay comparable; window restore and the
  single-instance plugin are skipped.

## Tests

`npm test` adds 9 files under `src/lib/shell/` plus `src/lib/settings.test.ts`: tab model,
menu keyboard navigation, paper naming and coordinate text, scale choice/parsing/status,
window placement, zoom/page-range/recent-file helpers, shortcut search (and that the About
box's PDFium build matches `tools/fetch-pdfium.mjs`), theme/accent maths, export size limits,
settings validation. `cargo test` adds `tests/shell.rs` (single-instance bypass, forwarded
paths, the pending queue). Components themselves have no automated tests; they were exercised
in the release exe (below).

## Assumptions (one line each)

- Cursor coordinates are measured from the page's bottom-left corner, y up, as in CAD.
- With imperial units, paper coordinates are inches and real-world ones feet.
- A detected scale is adopted only from a title-block position; otherwise "Scale not set", and the dialog offers what was found.
- Choosing the detected value in the dialog keeps "(from title block)"; any other value is "set by hand" and remembered per file (lower-cased path, 200 files).
- Scale detection runs on page 1 only.
- New window (Ctrl+N, section 7) is not built, so it's not in the File menu; nothing else depends on it.
- Rotate view is R / Shift+R: Ctrl+Shift+plus/minus would collide with input.ts's zoom keys, and Ctrl+R is WebView2 reload.
- Units (metric / imperial) live in the View menu; there's no settings dialog (out of scope).
- The sidebar is resizable, since "width" is a remembered setting.
- The empty window shows Open a file, a drop hint and up to six recent files.
- Export pages: 72/150/300/600 dpi, JPEG quality 0.92, existing files with the same names replaced, files named "<doc> p03.png".
- Menus are disabled rather than hidden when no document is open (Print, Export, Properties, zoom).
- The mini map is shown whenever a document is open and the toggle is on, even when the whole page is visible.
- `PrintContext.renderer` is the PDFium renderer singleton; it drives the same commands as the image renderer, so it serves image documents too.
- Window bounds are physical pixels; a maximised window keeps its earlier normal bounds.

## Viewer API used

All from `src/lib/engine/viewer.ts` as merged: `open`, `close`, `detach`, `attach`,
`closeDetached`, `onUi` / `uiState` / `initialUiState` (page, numPages, zoom, rotation, docId,
kind, cursor, pageViewport), `setZoom`, `zoomStep`, `fit`, `actualSize`, `gotoPage`,
`next/prevPage`, `gotoPagePoint`, `centreOn`, `rotate`, `setLayoutMode`, `setNavMode`,
`pagePointAt`, `viewportOnPage`, `previewFor`, `thumbnail`, `refreshCanvasColour`,
`requestFrame`, plus the public `view`, `layout`, `doc` and `rotation` for the marquee's
page-point maths. Renderer: `findScale`, `outline`, `renderRegion` (export). No engine file was
changed.

## ARCHITECTURE.md "Shell" section (for the integrator to paste)

> ## Shell (v0.1)
>
> `src/App.svelte` wires the shell; components live in `src/lib/components/` and everything
> that can be pure is in `src/lib/shell/` with Vitest tests (tab list, menu keyboard
> navigation, paper names and coordinate text, scale choice and parsing, window placement,
> formatting, shortcuts, theme maths, export size limits).
>
> - **One viewer, many tabs.** The canvas and `Viewer` are shared. Switching tabs calls
>   `viewer.detach()` (the document stays open in the backend with up to 32 MB of previews) and
>   `viewer.attach()` for the target, so a tab comes back instantly with its view, page and
>   rotation. A tab whose open was interrupted by a switch goes back to "pending" and reopens
>   when it is next shown. Opens are queued (`openPaths`), so drops and forwarded launches wait
>   their turn.
> - **Window.** No native decorations; the title bar is HTML with `data-tauri-drag-region` on
>   empty space only, window buttons call the Tauri window API. Size, position and maximised
>   state are stored in the settings and restored before the window is shown, fitted to a
>   monitor's work area (`shell/windowPlacement.ts`). Snap layouts on hovering maximise are
>   not available on a custom title bar.
> - **Single instance** (`src-tauri/src/shell.rs`): `tauri-plugin-single-instance` forwards a
>   second launch's file to the running window (`vellum://open-files` event); files that
>   arrive before the front end listens are queued and collected with `shell_take_pending`.
>   `--bench`, `--new-instance` and `VELLUM_MULTI_INSTANCE` bypass it.
> - **Themes.** Two token sets on `:root[data-theme]` in `src/app.css`; the accent is set as
>   `--accent`, `--accent-soft` and `--accent-bd` on the root. Components use tokens only.
> - **Drawing scale.** On open, `findScale(docId, 0)`; the best candidate is adopted only from
>   a title-block position (`shell/scale.ts`). Hand-set scales are remembered per file. The
>   tab's scale feeds the status bar and `PrintContext`.
> - **Settings** are one validated object in localStorage (`vellum.settings.v1`); print
>   presets are WP-Print's own keys.
> - **Installer.** NSIS, per user. `src-tauri/windows/installer-hooks.nsh` registers Vellum
>   under "Open with" (`OpenWithProgids` + `Applications\vellum.exe`) for PDFs and the image
>   types without becoming the default.

Dependency table rows:

> | `tauri-plugin-single-instance` (Rust) | A second launch (Explorer "Open with") hands its file to the running window instead of opening another. The official Tauri plugin; MIT/Apache. |

No npm dependencies were added. Window restore is done in the front end with the core window
API rather than `tauri-plugin-window-state`, because the brief wants restore clamped on screen
and the settings in one place; it costs about 60 lines plus tests.

## Run on the release exe

Release build (`npm run tauri build -- --no-bundle`, plus one full `npm run tauri build`
to check the NSIS hooks compile), launched from a worktree `run/` copy and driven over
WebView2's DevTools port with a throwaway script (not committed). Checked:

- stage plan opens; status bar reads "Scale 1:200 (from title block)", "A1 · 841 × 594 mm",
  cursor in metres ("X 67.91  Y 58.83 m"); typed zoom 400% and the presets list work; mini map
  click pans; thumbnails render.
- Aerial drawing, the five synthetic PDFs, a 3000 × 2000 JPEG, a password-protected PDF (made
  for the test: RC4, user password "vellum") and a text file named .pdf all open as tabs from
  second launches: one process, relative paths resolved, each tab correct on Ctrl+Tab.
  The 300-page document rendered 5 of 300 thumbnails (only those near view).
- Password: wrong password shows "Wrong password. Try again.", the right one opens.
  Unopenable file: "Couldn't open broken.pdf / Not a PDF or supported image" with Try again
  and Close tab.
- Menus by mouse and keyboard (Alt, arrows, type-ahead, Right into submenus, Escape);
  Theme > Light and Accent > Blue apply and persist; F1, Ctrl+D, Ctrl+P (placeholder dialog),
  Ctrl+W (left neighbour becomes active), tab drag-reorder, tab context menu.
- Scale dialog: setting 1:100 shows "Scale 1:100"; choosing the found 1:200 goes back to
  "(from title block)" and forgets the hand-set value.
- Window restore: size stable across launches; saved bounds off every monitor come back
  centred on the primary at the saved size; maximised state restored. `--new-instance` runs a
  second process.
- Screenshots: `docs/v0.1-screenshots/shell-dark.png` (File menu open, as in the mockup) and
  `shell-light.png`, captured with the DevTools protocol from the running exe.

Two bugs found this way and fixed: submenus didn't open when separators came before them in a
menu, and the window grew 16 px per launch (outer size saved, inner size restored), plus
restored bounds were rescaled when they moved onto a monitor with a different DPI.

## What I couldn't verify

- **Anything by eye beyond the two screenshots**: hover states, focus rings, the drag-region
  feel, double-click to maximise, resizing the undecorated window from its edges, touchpad and
  mouse behaviour in the shell (navigation itself is the unchanged engine).
- **File associations after install.** The installer builds with the hooks, but I didn't run
  it (it writes to the user's registry). To check: install, right-click a PDF, Open with:
  Vellum should be listed and the default app unchanged.
- **Drag and drop from Explorer**, the native Open and folder dialogs (Export pages needs the
  folder dialog, so the export path itself is untested end to end; its size rules are unit
  tested), Reveal in Explorer and Copy path.
- **Print marquee** (`pickRegion`): only reachable from WP-Print's dialog, which is still the
  placeholder on this branch.
- **Light/dark System theme** following a live OS change (the media-query listener is there).

## Known problems

1. **Scale bboxes on the aerial drawing lie outside its page.** `doc_find_scale` returns boxes
   with x up to about 13 300 pt while the page is 745 pt wide (263 × 5080 mm). The shell now
   ignores sub-4 pt text, so the aerial shows "Scale not set", but the engine's text
   coordinates for that page look wrong (rotation or a CropBox/UserUnit offset?). Worth a look
   by WP-Engine; the stage plan's boxes are right.
2. Windows 11 snap layouts on hovering maximise don't appear (custom title bar, as the brief
   accepted).
3. The print dialog's own Escape handling is WP-Print's; the placeholder ignores Escape.
4. Background tabs keep their documents open in the backend (by design of detach); many large
   tabs use a lot of memory. Closing a tab frees it.
5. A second instance with different WebView2 options (for example one launched with
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`) can't share the profile and fails to start; normal
   launches are unaffected.
6. The `.rsrc merge failure: multiple non-default manifests` linker warning predates this
   branch.
