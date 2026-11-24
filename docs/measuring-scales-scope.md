# Measuring scales: scope

The second round of scale work: where a drawing's scale comes from, what happens when the
sources disagree, views at different scales on one sheet, and a scale per dimension. Nothing
here is built. Written 24 Nov 2026 from Matt's review of the per-page detection.

## Where things stand

Committed on `main` (24 Nov):

- **Title-block detection per page.** Each page's own text is read for a scale as it comes
  into view: ratios (1:100, 1:200 @ A3) and imperial (1/4" = 1'-0", 1" = 20'). PDFium's
  spurious line breaks are cleaned out first (`scale.rs` `clean_text`).
- **Resolution order** (`src/lib/shell/pageScale.ts` `resolvePageScale`): a scale set for the
  page > one set by hand for every page > the page's own title block > page 1's, borrowed and
  shown in amber > none.
- **Status bar** shows the page in view's scale; borrowed and "Scale not set" are amber.
- **Scale dialog** follows the page in view, says where its scale came from, offers "This page
  only", "Clear every page", and "Read scales from title blocks" while title blocks are being
  ignored (after a clear, or a scale set by hand for every page).
- A measurement records its scale in its own `/Measure` dictionary, and every measurement
  re-values when its page's scale changes.

## Objective

Every measurement uses the right scale for the view it's in, with no plausible-but-wrong
figures, and with as little setting by hand as the file allows.

## Agreed

1. **Read the PDF's own scale (viewports).** A page may list viewports (`/VP`), each a
   rectangle with a `/Measure` dictionary giving real distance per point. AutoCAD writes them:
   the Xero stage plan has a whole-sheet viewport at 0.35278 per pt (mm at 1:1) and a drawing
   viewport at 68.79197 per pt, which is 1:195. A fit-to-paper scale like that is still
   correct for measuring: it describes the geometry actually on the page.
2. **Disagreement means no scale.** When the viewport and the title block disagree (beyond
   rounding, say 0.5%), the page measures in paper units until one is picked. A wrong but
   plausible figure (1:195 against 1:200 is 2.5%) is the danger; paper units can't be mistaken
   for real ones, and measurements re-value once a scale is picked.
   - Status bar, amber: `Scale unclear: 1:195 or 1:200`; click opens the dialog.
   - Dialog: both offered, each with its source ("PDF metadata (drawing area)", "Title block").
   - When they agree, the scale is taken with no warning.
   - Metadata alone (no title block) is used when its units can be inferred; otherwise the
     page shows as not set, with the metadata offered in the dialog.
   - This is different from borrowing page 1's scale (a guess with nothing against it, kept).
3. **Clear a page or the whole document.** Today "Clear every page" clears the document, and
   a page can only drop a scale set for it by hand. A page should also be clearable on its
   own (measure on paper despite its title block or metadata), which needs a per-page "none".
4. **Re-run detection without visiting every page.** "Read scales from title blocks" exists
   for the document; extend it to metadata, and to pages not yet read (read them all in the
   background rather than as they come into view).
5. **Views at different scales on one sheet, and a scale per dimension.** A plan at 1:100
   with details at 1:20. Viewports give the areas for free where a file has them; otherwise
   areas drawn by hand, or a scale picked for one dimension. (Phase 4 left scale regions
   out: [editing-phase4-scope.md](editing-phase4-scope.md), "Assumed", 5.)

## Proposed, not yet agreed

- **The imperial form in brackets.** Always lead with the ratio; add the imperial form when
  the sheet wrote its scale in imperial, or units are imperial and the ratio is a standard
  imperial scale: `Scale 1:48 (1/4" = 1'-0")`. Tidy form, not the sheet's raw text. The
  dialog's source line matches.
- **Only unusual sources labelled in the status bar.** Title block is the normal case, so it
  goes unsaid (tooltip and dialog still say it): `Scale 1:48`, `Scale 1:50, this page`,
  `Scale 1:5000, from page 1` (amber), `Scale not set` (amber). Alternative: keep it, without
  brackets: `Scale 1:48, title block`.
- **A shorter marker than "(paper)"** on unscaled measurements. Labels are drawn into the PDF
  in a standard font (Helvetica, Courier, Courier Bold, by name, nothing embedded), so a
  symbol must exist in those fonts' standard character set: `*`, `°`, `†`, `§`, `~` do;
  most Unicode symbols don't. Candidates to put in front of Matt: `124.0 mm*` with the
  status bar explaining, `~124.0 mm`, or the paper figure in a muted colour with no marker
  (colour survives in the PDF but not a monochrome print).

## Not in this work

- **Scale by OCR**, for pages whose text was exploded to outlines (64 of 65 pages of MMA
  Curtis Hall). Follows OCR search ([ocr-search-scope.md](ocr-search-scope.md)). Curtis Hall
  is the test file for both that and multi-scale views (item 5).

## Files in play

- `src-tauri/src/pdfium.rs`: reading `/VP` and `/Measure`. PDFium has, as far as known, no
  public call for viewports, so this likely means reading the page dictionary directly.
  Check first.
- `src-tauri/src/scale.rs`: units inference and the agreement test.
- `src/lib/shell/pageScale.ts`: a per-page "none", metadata as a source, the "unclear" state.
- `src/App.svelte`: tab state (`detectedPages`, `scaleCleared`), the re-read action.
- `src/lib/components/StatusBar.svelte`, `src/lib/components/dialogs/ScaleDialog.svelte`.
- `src/lib/markup/kinds/measure*.ts`, `src/lib/markup/dimension.ts`: the paper marker.

## Steps

1. Spike: read `/VP` from the Xero plan and Bayou Towers (whose objects are compressed, so a
   byte search can't tell). Confirm whether PDFium exposes it; infer units from the
   whole-sheet viewport.
2. Metadata as a scale source, with the agreement test and the "unclear" state (items 1, 2).
3. Per-page clear and the background re-read (items 3, 4).
4. Status bar and dialog wording, once the proposals above are agreed.
5. The paper marker, once agreed.
6. Views at different scales and a scale per dimension (item 5): its own brief.

## Open questions

- The paper marker: which, if any (see Proposed).
- Imperial in brackets and dropping "title block" from the status bar: agree or amend.
- Units inference when a file has a drawing viewport but no whole-sheet one: assume mm,
  or treat as unknown?
- Multi-scale views: viewports only to start with, or hand-drawn areas from the first cut?
