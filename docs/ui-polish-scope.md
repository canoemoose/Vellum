# UI polish before daily use: scope (11 November 2026)

## Objective

Fix the small things that make Vellum feel unfinished, so Matt can install it properly and
use it day to day. Checked by Matt by eye in the dev build (`npm run tauri dev`, which
reloads as front-end files change); nothing is committed until he asks.

## Status (12 November)

Everything below is built and passes the tests (front end 309, Rust 134); none of it is
checked by Matt yet unless it says so. How it works is in ARCHITECTURE.md ("Getting about",
"Snap layouts on the custom title bar").

| # | Item | What was built | Where |
|---|---|---|---|
| 1 | Hand cursor everywhere | Arrow on all controls; the drawing keeps arrow / open hand with Space / closed hand dragging; the mini map shows a closed hand while dragging | `app.css`, `Toolbar.svelte`, `MiniMap.svelte` |
| 2 | Thumbnails don't grow with the sidebar | Thumbnails fill the column (32 px margins, A-series height cap), scaled live while dragging, re-rendered 250 ms after it stops; first render at the saved width | `Thumbnails.svelte` |
| 3 | Mini map nonsensical at the extremes | Shown when a page in view is cut off at the left or right (zoomed into a page, or where columns meet), or is taller than the view (inside a long page like the aerial drawing at fit width, its top included) (`mapUseful`). In both navigation modes, so an A4 document read at fit width on a landscape screen shows the map throughout; View > Mini map turns it off for that file, remembered. It never hides while the pointer is over it or dragging in it (Matt: it vanished under a drag to the top). Not while just scrolling from page to page, where the window and thumbnails already show where you are (Matt, 12 Nov, after three earlier rules: whole page in view flickered while scrolling; page bigger than the view missed where four pages meet; side cuts only missed the aerial drawing at fit width). Appears once that has held 300 ms and fades in; hides at once; when the view box would be under 8 px, a small box and crosshair lines across the map | `App.svelte`, `MiniMap.svelte`, `viewMath.ts` |
| 4 | Fit width jumps to the top | Keeps the point at the vertical centre, unless it's off the page (`fitWidthKeepingY`) | `viewer.ts`, `viewMath.ts` |
| 5 | Resizing leaves the drawing top-left anchored | Keeps the centre point centred (`keepCentre`), or refits if at a fit and not moved since | `viewer.ts`, `viewMath.ts` |
| 6 | No snap layouts on the maximise button | Native overlay over the HTML button answering HTMAXBUTTON; hover reported back; needed an app manifest declaring Windows 10/11 for the layered child window. Matt to check it's invisible, that hovering shows the flyout, and that clicking still maximises and restores | `snap.rs`, `TitleBar.svelte`, `app.manifest`, `build.rs` |
| 7 | Wheel zoom should stick at 100%, fit width, fit page | A notch that would cross one lands on it, the next carries on (`stickyZoomTarget`); a pinch holds until 8% further | `viewer.ts`, `viewMath.ts` |
| 8 | Panning should stick at page edges | Dragging holds 24 px at page edges (and at centre for pages narrower than the view), then carries on with no jump (`StickyAxis`). Wheel scrolling isn't sticky: page-at-a-time scrolling at fit page is still undecided | `stickyPan.ts`, `viewer.ts`, `input.ts` |
| 9 | Navigation mode hidden; could pick itself | Per document: CAD for pages bigger than A4, Document for A4 and smaller (agreed), picked on open, kept per tab; toggle in the toolbar with mouse icons (magnifier: wheel zooms; arrows: wheel scrolls); View menu "Automatic navigation" goes back | `navMode.ts`, `viewer.ts`, `Toolbar.svelte`, `App.svelte` |
| 10 | Page and zoom boxes jammed top-left | Agreed layout, a variant of B (`docs/mockups/toolbar-options.html`): pages and page layout on the left, straight after the sidebar toggle (lining them up with the drawing's edge was tried and looked worse); centre kept for markup tools; navigation mode and zoom on the right, search to follow | `Toolbar.svelte` |
| 11 | Fits don't ease (Matt, 12 Nov) | Fit page, fit width, actual size and typed or menu zooms ease over 220 ms (`animateTo`, `interpolateView`); opening a document still jumps | `viewer.ts`, `viewMath.ts`, `input.ts`, `App.svelte` |
| 13 | Top-left looks busy (Matt, 12 Nov) | The thumbnail list's default dark scrollbar track matched the canvas and read as part of the drawing: scrollbars are now thin, on a transparent track, app-wide | `app.css` |
| 12 | Photo DPI | Embedded DPI used only at 150 or more, else 96, so a phone photo is pixel for pixel at 100% and scans keep their true size (`effective_dpi`) | `imagedoc.rs` |

| 14 | Hovering the thumbnail scrollbar jumps the list to the top (Matt, 12 Nov). *Fixed, confirmed by Matt.* | Likely cause: Windows 11 scrollbars widen on hover, which changed the list's measured width, which the thumbnails were sized from, reflowing the list. Thumbnails now size from the sidebar's width and the list keeps a stable scrollbar gutter. Matt then saw it scroll to the *selected* page's thumbnail (up or down), so the effect that does that was re-running though the page hadn't changed (cause not found by reading); it now acts only when the page actually changes. The divider also stops resizing if its pointer capture is lost. Matt to retest | `Thumbnails.svelte`, `Sidebar.svelte` |
| 15 | A page could be scrolled wholly off screen (Matt, 12 Nov) | `constrainView` now keeps a document smaller than the view wholly in view, and stops a larger one's edges at the 16 px margin (it used to keep only 64 px visible) | `viewMath.ts` |
| 16 | Single-page layout should scroll on to the next page (Matt, 12 Nov) | Wheel scrolling on against a page's end gathers; past 60 px it turns to the next page's top (or the previous page's bottom). At fit page that's a page per notch | `viewer.ts` (`scrollBy`), `input.ts` |
| 17 | No canvas scrollbars (Matt, 12 Nov) | Thin overlay scrollbars on the drawing in Document navigation only, each shown when there's something to scroll on its axis; drag the thumb or click the track for a screenful | `CanvasScrollbars.svelte`, `view/scrollbar.ts` |
| 18 | Layouts want buttons (Matt, 12 Nov) | Single page, Continuous and Columns as icon buttons on the left, after the page navigator (moved there at Matt's request). Columns (agreed: a count Matt sets): rows of N pages in equal cells, N from View > Columns across (2 to 6, saved, 2 by default). Switching to Columns, or changing N, fits the whole row with the current page's row at the top; Fit width in Columns fits the row, Fit page one page (Matt, 12 Nov) | `layout.ts`, `settings.ts`, `viewer.ts`, `Toolbar.svelte`, `App.svelte` |
| 19 | Which thumbnails are highlighted (Matt, 12 Nov) | Every page on screen gets a light accent outline in the sidebar; the current page (the page navigator's, Page Up/Down's) keeps the strong one. Agreed with Matt over "the whole row"; it marks pages only, never a viewport box, so it doesn't duplicate the mini map | `viewer.ts` (`visiblePages`), `Thumbnails.svelte` |
| 20 | The map can't show where you are across pages (Matt, 12 Nov) | The map now shows the pages the view touches (usually one; across a page break or a columns row, two to four), from their previews, with the view box across them, and eases to a new framing over 220 ms when that set changes. Works in world coordinates (`unionRect`, `lerpRect`, `Viewer.centreOnWorld`) | `MiniMap.svelte`, `App.svelte`, `viewMath.ts`, `viewer.ts` |
| 21 | The map's fixed landscape box draws the aerial drawing as a 5 px strip (Matt, 12 Nov) | The map takes the shape of what it shows at a constant width, 136 px at default size, its height following the shape (`mapBox`; first built at a constant area, changed at Matt's request; within 1:6 to 6:1, widened from 1:3 at Matt's request, and never more than 60% of the drawing area); longer than that, it shows a window of the limit's shape onto the page around the view, which follows as you move (`mapFraming`). Shape changes ease with the reframing; the window following you snaps, so it doesn't lag | `MiniMap.svelte`, `viewMath.ts` |
| 22 | Mini map resizable (Matt, 12 Nov) | A grip on its top-left corner (it's anchored bottom-right), shown on hover: drag up or left to grow it, double-click to reset. It can be made as big as the drawing area less a 16 px gutter; at default size an automatic shape stays within 60% of it, and that limit grows with the size set (`mapLimits`). Remembered only up to the guards (the size at which it reaches 60% of the drawing area, `mapGuardSize`); a bigger blow-up lasts until a document opens, when it's back to the remembered size (Matt). One size for the whole app, kept across tab switches | `MiniMap.svelte`, `settings.ts`, `viewMath.ts` (`mapBox`) |
| 23 | More per document (Matt, 12 Nov) | Remembered per file across opens (`shell/docMemory.ts`, in settings, the 200 most recently used): where you were (page, zoom, position), rotation, layout and columns, a navigation mode you chose, and the mini map's on/off and size (size only up to the guards). A file opened for the first time gets the default mini map, automatic navigation, and the last layout chosen. Kept per tab while open; saved a second after the view settles, on tab switch and close, and as the window closes. Mini map on/off is now per file (View > Mini map), no longer app-wide. Sidebar, theme, accent and units stay app-wide | `docMemory.ts`, `settings.ts`, `viewer.ts`, `App.svelte`, `MiniMap.svelte` |

## Still open

- **Wheel scrolling at fit page:** in single-page layout it's now a page per notch (item 16); in continuous layout it scrolls smoothly as before.
- **Search and markup tools:** their places in the toolbar are kept; the features aren't built.
- **App identity:** authorship and identifier (`engineering.event.vellum`, "Event
  Engineering") in `src-tauri/Cargo.toml` and `tauri.conf.json`. Vellum is a personal
  project, so these should change before installing; the identifier names the settings
  folder, so changing it later means a fresh profile. Waiting on Matt for the name.
- **When the mini map shows: parked as it is (Matt, 12 Nov).** Four geometric rules in a day, each fixing one case and breaking another, because whether the map is useful depends on context (finding your way round a drawing, or reading a document), which page dimensions only stand in for. Two lessons for whoever revisits it: decide it by context, not dimensions (one idea, not taken: default on for CAD navigation and off for Document, the View > Mini map choice per file being the real signal); and the map must never appear and disappear in normal scrolling, because a map that fades in and out between pages looks broken, however good the reason.
- **Mini map and tall pages, to revisit if it's in the way:** making tall pages count in CAD navigation only would keep documents read at fit width clear of the map while the aerial drawing keeps it. Built and tried, then kept out (Matt, 12 Nov); `mapUseful` still takes the flag, so it's a one-line change in `App.svelte`.
- **How many files to remember:** 200 (about 40 KB). Matt wondered about matching Recent (10); open.
- **More from Matt as he finds them.**

## Then

Release build and installer; Matt installs and uses it for a while.
