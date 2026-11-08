# WP-Print handoff

Branch `v0.1/print`. Printing for v0.1: the print dialog (brief 3.3), the manual sheet layout
(3.4), PDF composition with PDFium and output through GDI.

## What was built

**Rust (`src-tauri/src/print/`)**

- `job.rs`: the job JSON the front end's model emits (sheets of placed items, lines, texts,
  an optional sheet clip) and the pure geometry: item matrices with clockwise quarter turns,
  PDFium's page matrix and its inverse (crops given in displayed page coordinates, through
  any `/Rotate` and offset media box), paper matching, print bands, colour modes.
- `compose.rs`: builds the output PDF on one PDFium worker (`run_on_worker`). Every placed
  page is a form XObject (`FPDF_NewXObjectFromPage` + `FPDF_NewFormObjectFromXObject` and a
  transform), so vectors stay vectors; one XObject per (source page, crop) per job, so a page
  tiled over nine sheets is stored once (tested: six sheets of a page with an incompressible
  image are under 1.2 times one sheet). Crops set the source page's crop box before the
  XObject is made (that is what bounds a page XObject). Tiles are clipped with
  `FPDFPage_TransFormWithClip` (`q <rect> W n ... Q`) and the cut marks and stamp are added
  after it, outside the clip. Images go through a one-page scratch PDF, JPEGs embedded as
  they are, everything else decoded and embedded as a bitmap. Text (stamp, labels) is
  Helvetica.
- `raster.rs`: renders a composed sheet in bands on one worker, keeping its own handle to the
  composed PDF in a worker thread-local between calls, so the viewer's renders interleave
  with printing and a heavy sheet's images are decoded once and freed when the sheet is done.
- `gdi.rs`: printers (`EnumPrinters`, default first), capabilities (`DeviceCapabilities`:
  papers, trays, duplex, collate, colour, copies), unprintable margins per paper and
  orientation (an information context's `PHYSICALOFFSET`), the driver's own properties
  dialog (`DocumentProperties` with `DM_IN_PROMPT`, kept per printer for the session), and
  sending: `StartDoc` / `StartPage`, per-sheet paper and orientation with `ResetDC`, copies
  and collation through the DEVMODE (repeated sheets when the driver can't), duplex,
  greyscale/monochrome, then either 512-row bands at 300 or 600 dpi through `StretchDIBits`
  or, for Vector, `FPDF_RenderPage` straight to the printer DC. One job at a time.
- `mod.rs`: the commands `print_features`, `print_compose`, `print_save_pdf`,
  `print_release`, `print_printers`, `print_capabilities`, `print_margins`,
  `print_properties`, `print_send` (progress over a channel), `print_cancel`. Composed jobs
  live in a process-wide store until released.

**Front end**

- `src/lib/print/model/`: the pure layout model (no Svelte). `auto.ts` (Fit, Actual, To scale,
  Tile with overlap and cut marks, n-up 1/2/4/6/9/16 in either order, margins, centring,
  auto-rotate, shrink oversized only, paper by page size, borders, stamp, the info line),
  `manual.ts` (placement, scale about the centre, ratio, rotation, corner scaling, edge crops
  in every rotation, crop region, reset crop, sheets, labels, the job), `snap.ts` (margins,
  other items, 5 mm grid), `arrange.ts` (align left / centres / tops, distribute, auto-arrange
  by shelf packing with one shared shrink factor), `serial.ts` (save and load layouts),
  `settings.ts` (settings, presets, standard scales), `pages.ts` (page ranges).
- `src/lib/print/`: `api.ts` (typed commands), `store.ts` (localStorage, `vellum.print.*`),
  `sources.ts` (what All / Current / Range / View / Marquee mean), `painter.ts` (draws sheets
  for the preview and the editor through the shared renderer: an item is a region render
  of its page, cached and drawn with the item's transform and clip).
- `src/lib/components/print/PrintDialog.svelte`: the dialog, props `{ open, context, onClose }`
  as before. `ManualLayout.svelte`: the manual layout screen.

## Tests

- `npm test`: 86 model and source tests, plus `src/lib/print/printToPdf.test.ts`, which runs
  the Rust end-to-end test below (`cargo test --test print_gdi`) and skips cleanly when it
  can't (not Windows, no cargo, `VELLUM_SKIP_PRINT_TEST=1`, or no Microsoft Print to PDF).
  With a warm `CARGO_TARGET_DIR` it takes about 15 s; cold, the Rust build takes minutes.
- `cargo test`: `print_geometry` (12 pure tests), `print_compose` (13: placement, rotation,
  source `/Rotate`, crops including of rotated pages, two crops of one page, sheet clip versus
  marks, lines and text, one copy per tiled page, several sources and sheets, the fallback to
  the open document, PNG and JPEG images, bad jobs), `print_gdi` (4: Image 600 dpi, Image
  300 dpi black lines and Vector through the real Microsoft Print to PDF driver, each checked
  for page count, A4 portrait and A3 landscape page sizes and the mark's position to 1 pt;
  capabilities and zero margins).
- `print_inspect` is a tool, not a test: `VELLUM_INSPECT="a.pdf;b.pdf" cargo test --test
  print_inspect -- --ignored --nocapture` prints page sizes and ink bounding boxes.

- `print_inspect` reports the centroid of strongly blue pixels too (with
  `VELLUM_INSPECT_BLUE_BELOW_MM` to ignore the top of the page), used to place a test image.
- Testing switch: `VELLUM_PRINT_TO_FILE=<folder>` sends every job for a file-writing driver
  (Microsoft Print to PDF) to `vellum-print-<ms>.pdf` there instead of the driver's save box.

## What I ran and checked (release exe, built from a throwaway merge of `v0.1/shell` + this branch)

All through the dialog in the real app, driven over the WebView2 DevTools protocol, printed to
Microsoft Print to PDF and checked with `print_inspect`:

| Job | Output | Check |
|---|---|---|
| Stage plan (A1, 841 × 594 mm), Fit, A3 | 1 page, 420 × 297 mm | ink 0–418.3 × 2.6–297.0 mm = source ink (0–837.7 × 5.0–594.1) × 0.4994, centred, as computed |
| Stage plan, To scale 1:200 on A3, drawing scale set to 1:100 | 1 page, 420 × 297 mm | ink 0–418.6 × 2.4–297.0 mm = source × exactly 0.5: 1 m on site is 5 mm on paper |
| Aerial (263 × 5080 mm strip), Tile on A3, 10 mm overlap, stamp | 13 pages, all 297 × 420 mm | one column of 13 portrait tiles (auto-rotate chose the fewest sheets), cut marks to 0.4 mm of the edges; 90 s for 13 sheets at 600 dpi (about 20 s composing) |
| Manual: two pages of `3-a3-40-pages.pdf` and a 2400 × 1600 px JPEG at 200 dpi, auto-arranged on one A3 sheet, Save as PDF | 1 page, 420 × 297 mm, 307 KB (vector) | the image's blue disc centred at (75.7, 223.7) mm, exactly where the editor's X/Y (0, 173.2 mm) and 49.7% put it |

Also: the dialog opens from Ctrl+P with the installed printers (default first); the info line
reads the drawing scale; preview, sheet navigation, Manual and Back; in manual layout, drag to
move (with snapping), corner scaling (opposite corner fixed), edge crop (content stays put),
Add PDF or image through the real Open dialog, double-click in the strip to place, auto-arrange,
the inspector; Save as PDF through the real Save dialog. Files added in manual layout open in
the backend and are closed when the dialog closes (unless a tab has them).

Screenshots: `docs/v0.1-screenshots/print.png`, `print-manual.png` (DevTools protocol capture of
the running exe).

## Vector

**Works**, with Microsoft Print to PDF: `FPDF_RenderPage` to the printer DC gives correct page
sizes and positions (to 1 pt) and a 1.4 KB vector file where the 600 dpi raster is about 4 MB.
So "Vector (smallest job)" is offered in Advanced, but the default stays **Image, 600 dpi**,
which works with every driver; Vector on real printer drivers (PCL, PostScript, the big
plotter drivers) is unverified, and that's where GDI vector output usually goes wrong
(hairlines, transparency, very large paths). `print::VECTOR_WORKS` turns the option off.

## Assumptions (one line each)

- Default output is Image 600 dpi; Vector is offered, not chosen.
- Greyscale and Black lines are applied to the raster in Rust (Rec. 601 luma; any channel
  under 245 becomes black), so preview and print match; for Vector, greyscale is
  `FPDF_GRAYSCALE` and Black lines falls back to greyscale (no thresholding a vector stream).
- The margin stamp sits in a 10 pt strip at the bottom of the printable area, which layouts
  keep clear: the printer's own margin can't be printed on.
- Tile cut marks sit in an 8 pt band inside the printable area (same reason); tiles print at
  100%.
- "Tile" in Sizing and "Tile with overlap and cut marks" in Layout > Special are the same
  switch.
- The Content section is left out: the margin stamp is its only v0.1 row, so it's a row in
  Layout.
- Orientation lives in the Paper section (Automatic / Portrait / Landscape); Automatic is
  "Auto-rotate each page" (sheet orientation per page, or the one with fewer tiles).
- Fit's info line suggests the *nearest* standard scale ("1:206, choose To scale for 1:200"),
  as the brief's example does, and says when a scale runs a few mm past the printable area.
- "Choose tray by PDF page size" picks the printer paper matching each page's size and lets
  the driver choose the tray (`DMBIN_AUTO`); otherwise the selected paper.
- Copies beyond the driver's own limit are sent as repeated sheets (collated or not).
- Presets store everything but page range, pages mode and copies; Marquee and View aren't
  remembered between prints.
- Presets can be replaced and deleted from the save-preset row (the mockup has no delete).
- Save layout / Open layout are buttons in the manual screen's left panel (integrator's call),
  saved as JSON with file paths; missing files are reported and their items dropped.
- The manual layout survives Back and Manual again while the dialog is open, not between
  prints.
- "Include markups" per item is not shown (v0.2).
- Annotations: a placed page's annotations are flattened into the composed copy
  (`FPDFPage_Flatten`, print appearance) so the print matches the screen; the viewer's own
  documents are never modified (composition works on private copies).
- Password-protected PDFs can't be reopened privately without their password: they compose
  from the viewer's open handle (crop box restored afterwards), without flattening.
- Images: JPEGs without an EXIF rotation, and not CMYK, are embedded as they are; others are
  decoded and embedded as raw BGR (bigger files).
- One print job at a time (Microsoft Print to PDF lost one of three concurrent jobs).

## Couldn't verify without a physical printer

- Real drivers: margins other than zero (the offset maths for `PHYSICALOFFSET` is exercised
  only with Microsoft Print to PDF's zero margins), trays, duplex, collation, copies,
  monochrome, mixed paper sizes with `ResetDC` mid-job, and Vector output quality.
- Printer properties… (the driver's dialog) was not opened: it needs a person.
- Print speed on a real spooler; 600 dpi A3 sheets are about 14 MB a band, 140 MB a sheet of
  raster data into the spooler.

## Known problems

1. **Scale detection reads "1:200 @A3" as the A1 page's scale** (engine's `scale.rs`,
   reported to the integrator): on the stage plan every scale-aware figure is off by two until
   the scale is set by hand to 1:100. Not a print bug, but it's what users will see first.
2. Composition runs on one PDFium worker and blocks it: about 20 s for the aerial drawing,
   during which that worker's band of the viewer doesn't render.
3. Tiled output from Microsoft Print to PDF is large (102 MB for 13 aerial tiles) because
   it's raster; Vector or Save as PDF (which is vector) are smaller.
4. The manual editor's item previews are region renders capped at 4096 px a side, so deep
   zoom on a large item is soft.
5. Annotation flattening and the crop-box approach assume well-formed pages; a page whose
   crop box is outside its media box composes as the intersection.
6. Files dropped from Explorer onto the manual layout also reach the shell's own drop handler
   (the integrator is adding a guard in the shell).
7. Vector: Black lines prints as greyscale.
8. The Black lines *preview* looks heavier than the print: the threshold runs on the
   downsampled preview, where every anti-aliased grey edge turns black; at 300/600 dpi lines
   keep their weight.
9. Untouched by these tests: two-sided, trays and Printer properties (see above), and the
   Marquee pick (the shell's overlay; the dialog hides and waits for it, but I didn't drag
   one).

## ARCHITECTURE.md "Printing" section (to paste)

> ## Printing (`src-tauri/src/print/`, `src/lib/print/`)
>
> The dialog and the manual layout are thin over a pure model (`src/lib/print/model/`) that
> turns settings or hand placement into a **job**: sheets (size in points) of placed items
> (document id, page, crop in displayed page points, position, scale, quarter-turn rotation),
> stroked lines, text and an optional clip. Rust composes the job into a PDF and prints that.
>
> - **Compose** (`compose.rs`, on one PDFium worker via `run_on_worker`): a new document, one
>   page per sheet. Each placed page is a form XObject (`FPDF_NewXObjectFromPage`), cached per
>   (page, crop) for the job, so a page tiled across many sheets is stored once, and placed
>   with `FPDF_NewFormObjectFromXObject` and a matrix (`job::item_matrix`). A crop is the
>   source page's crop box at the moment the XObject is made (that bounds a page XObject).
>   Sources are reopened privately by path, so crops and annotation flattening never touch the
>   viewer's documents. Images go through a scratch page. Tiles are clipped with
>   `FPDFPage_TransFormWithClip` before the cut marks and stamp are added. The result is kept
>   by job id (`print_compose`) for Save as PDF (`print_save_pdf`) or printing.
> - **Print** (`gdi.rs`): `CreateDC` with the printer's DEVMODE (copies, collate, duplex,
>   colour, paper and orientation per sheet via `ResetDC`), `StartDoc`, then per sheet either
>   bands of 512 rows rendered at 300/600 dpi (`raster.rs`: the composed PDF open privately on
>   one worker, each band one `run_on_worker_index` call so viewer renders interleave) and sent
>   with `StretchDIBits`, or Vector: `FPDF_RenderPage` to the printer DC. Sheet coordinates are
>   paper coordinates; the DC's origin is offset by `PHYSICALOFFSET`.
> - **Front end**: `PrintDialog.svelte` (props `{ open, context, onClose }`, the shell's
>   `PrintContext` in `src/lib/print/context.ts`), `ManualLayout.svelte`; `painter.ts` draws
>   sheets from the job through the shared renderer (an item is a region render of its page).
>   Settings and presets in localStorage under `vellum.print.*`.
> - **Tests**: the model in Vitest; geometry, composition (rendered and measured) and a real
>   Microsoft Print to PDF round trip in `cargo test` (`print_*`), the latter also from
>   `npm test`.

## Dependencies (rows for ARCHITECTURE.md)

| Dependency | Why |
|---|---|
| `windows` 0.62 (Rust; `Win32_Foundation`, `Win32_Graphics_Gdi`, `Win32_Graphics_Printing`, `Win32_Storage_Xps`) | Printer enumeration, capabilities, DEVMODE and the driver dialog, and GDI output (`StartDoc`, `StretchDIBits`). Same version `pdfium-render` uses for its HDC type. MIT/Apache. |
| `pdfium-render` feature `pdfium_use_win32` (Windows only) | Exposes `FPDF_RenderPage` with a GDI `HDC`, the Vector print path. No new crate. |

No npm dependencies. `src/lib/print/node-shim.d.ts` types the three Node modules the
`npm test` hook uses rather than adding `@types/node`.

## For the integrator

- `src-tauri/src/lib.rs`: `pub mod print;` and ten `print::print_*` commands, marked
  `// WP-Print`. Cargo.toml: one `# WP-Print` block. Capability needed:
  `"dialog:allow-save"` (you've got it).
- `npm test` compiles and runs `cargo test --test print_gdi` (minutes when cold; set
  `CARGO_TARGET_DIR` to the shared target, or `VELLUM_SKIP_PRINT_TEST=1` to skip).
- The merge with `v0.1/shell` conflicts only in `lib.rs` (both lists of commands, keep both)
  and `Cargo.lock` (take either and let cargo update it).
