# Follow-ups after the UI review (13 November 2026)

Matt: "Fix the other bits, write a sensible technical-human focussed readme.md with attitude."
Autonomous; uncommitted (shared checkout, see `docs/ui-review.md`).

## Steps

1. [x] **Paper list: A sizes first.** The driver's list, with A sizes (A0 to A6 and their
   variants) first in size order, then everything else under "Other sizes" in the driver's
   order. UK users: US sizes get no special place. Print dialog and manual layout.
2. [x] **One margin list.** Both screens offer Printer minimum, None, 5, 10, 15 mm and Custom
   (any mm). Print keeps `marginMode` + `customMarginMm`; the manual layout's mode becomes
   "printer" | "none" | a number of mm.
3. [x] **Label columns line up** between the always-visible settings and the sections.
4. [x] **Save as PDF honours Greyscale and Black lines.** Colour saves the composed PDF as now
   (vector). Greyscale and Black lines save a raster PDF at the Send as resolution (Vector
   counts as 600 dpi), page by page as printing does, built from bands so memory stays bounded
   per band (PDFium keeps the encoded images until save). Black lines and greyscale use 8-bit
   grey images.
5. [x] **README.md rewritten**: technical, human, with attitude. What it is, why, what it does
   well, how to build, how it's built, what's missing.
6. [x] Checks, tests (Vitest, cargo), docs.

## Not doing

- Keeping sharp tiles across tab switches (memory trade-off; offered earlier, not asked for).
  *(Asked for since: [backlog.md](backlog.md), "Speed".)*
- Vector recolouring for Black lines (raster is the right tool for scans).

## Result

All done and uncommitted. `npm run check` clean; Vitest 410 passed; every `cargo test` suite
passed, including the new `print_rasterpdf`. Not looked at by eye: the paper and margin
dropdowns, the aligned labels, and a Black lines PDF opened in a viewer (the test checks sheet
sizes, ink positions and JPEG strips, not how it looks).
