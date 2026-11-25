# Releasing 0.2.0: where it stands and the notes

Working file for the 0.2.0 release. Delete it once 0.2.0 is published. The steps themselves are
under Releasing in [CLAUDE.md](../CLAUDE.md); the review that is holding the release is
[review-0.2.0.md](review-0.2.0.md).

## Where it stands (25 November 2026)

- [x] rc3 checked on a real install by Matt, updating from 0.1.4: the document icon, and Vellum
      listed once in "Open with".
- [x] Fixes since rc3, on `main`: the sidebar width reset, the canvas strobing on resize,
      per-page scales in Print and in manual layout, Actual and To scale never shrinking, Print
      waiting for scales, saves flushed to disk.
- [x] README rewritten and pushed.
- [x] The six "Before 0.2.0" items in [review-0.2.0.md](review-0.2.0.md), and items 7 to 13
      as well (25 November). Most are covered by tests only: see the Status column there.
- [x] rc4 (25 November) tried installed by Matt. It turned up, all fixed on `main` and in rc5:
      an existing markup drawn twice while edited on image-heavy pages; the old one lingering
      until the view moved, or flashing back from the preview; the re-render queued behind
      sidebar thumbnails; the "?" warning too easy to miss (now a question before the save);
      "?" shown in Vellum itself until the markup was touched; thumbnails and the mini map
      never showing markups; previews stored to disk without saved markups.
- [x] rc5 (25 November) installed and tried by Matt: the five checks below are good.
- [x] After rc5, on `main` (25 November), tried by Matt in a development build, not in an
      installed one: new installs follow the Windows theme; Help > About > Reset… and
      `--reset`; a sheet's edge can be scrolled or dragged in to the middle of the window; the
      last page is selected at the end of a continuous set.
- [ ] Check the three points under "Check before publishing" below.
- [x] `node tools/set-version.mjs 0.2.0`, commit "Release 0.2.0", push `main`.
- [x] `git tag v0.2.0`, `git push origin v0.2.0`; the workflow takes about half an hour.
- [ ] Publish the draft with the notes below (`gh release edit v0.2.0 --draft=false --latest
      --notes-file ...`, or on GitHub).
- [ ] Delete the unpublished `v0.2.0-rc2` draft release, and the rc4 and rc5 drafts.
- [ ] After a minute, Help > Check for updates from a 0.1.4 install and from an rc install.
      Worth trying once on the way: cancel the installer, and see what the app says.

## Tried in rc5

Tried by Matt on 25 November, first in a development build and then in the installed rc5:
all five good.

1. Unlock a file and move a markup that came with it, on a page with a big image (the
   Fieldwork site map): the original goes as the drag starts, the page stays sharp, and
   moving a second one doesn't bring the first back.
2. The same straight after opening a long file, while the sidebar is still filling.
3. Thumbnails and the mini map: a drawn markup appears on both as it's drawn; a moved one
   moves on both. Curtis Hall (marked up), page 64: its cloud and rectangle show on both.
4. A text box with a delta or a greater-or-equal sign: Save asks first; Cancel leaves it
   unsaved; saved and reopened, Vellum shows the characters without the box being touched.
5. Save, then go on editing without reopening; crash recovery (end Vellum in Task Manager,
   reopen, Restore); signature import from a phone photo. Carried over from the rc4 list.

Not seen and not worth holding the release for: Print waiting for scales (the Fieldwork set
reads too fast to show it), and the "Unscaled" box in Print, which needs one PDF whose page 1
has no scale and a later page has (a cover sheet in front of drawings).

## Check before publishing

Written from the rc1 and rc3 notes and the code, not from using the app:

1. **Markups panel, "right-click to delete".** rc3 removed the delete button; the code shows a
   right-click menu with Delete. Confirm in the app.
2. **Scale dialog, "read scales from title blocks again".** Reworded from rc3's line. Check it
   matches what the button does and is called.
3. **The padlock.** rc1's line "Existing annotations in a file are editable behind the padlock"
   is replaced by the Edit lock section. Confirm nothing still calls it a padlock in a way the
   notes should mention.

Item 12 of the review (symbols outside Western European text saved as "?") is only asked
about in 0.2.0, not fixed (the fix, an embedded font, is on the backlog for 0.2.1): the notes
say so under "Known limits".

## The notes

Style: terse changelog, no prose. Everything since 0.1.4 (rc1 and rc3 merged, rc3's changes
folded into the features they changed, fixes to things that never shipped in 0.1.x left out).
The `Highlights:` line feeds the homepage's hero pill.

```markdown
Highlights: Markup, measuring and signatures

## Added

**Markup** (saved as standard PDF annotations)
- Line tools: Arrow (A), Line and Polyline (L). Line ends: none, open, filled, dot, bar, slash.
- Shape tools: Rectangle (R), Ellipse (E), Polygon (G), Revision cloud (C). Polygon drag creates a regular polygon, 3 to 12 sides.
- Freehand: Pen (P), Highlighter (H).
- Text: Text box, Callout, Note (T). Notes can be pinned open (saved as an open pop-up).
- Text markups: highlight, underline, strikethrough on selected text.
- Stamps (S): standard and custom text stamps with fields ({author}, {date}, {time}, {file}, {page}); image stamps with background removal.
- Signatures (S): drawn or imported from a photo; stored in an encrypted library. On save: keep as an annotation or bake into page content.
- Image (I): place from file or clipboard. Crop, border, opacity.
- Rotation: stamps, signatures, images, polygons and clouds. Grip, or [ and ] for 90°, Shift for 15°.
- Style per tool, remembered: colour, weight, opacity, dash, fill (None, White, red, yellow, green, blue, grey), text style.
- Markups panel: every markup, as lines. Click to jump to it; right-click to delete.
- Markups show on the sidebar thumbnails and the mini map as they're drawn or moved.

**Edit lock**
- Edit file switch beside the page layout buttons. Markups that came with the file are locked until it's on.
- Click a locked markup to unlock the file from it.
- Unlocked file shown in the status bar and on its tab.

**Measuring** (D)
- Length, Polyline length, Area, Angle. Calibrate from a known dimension.
- Scale per page: read from each page's own title block as it comes into view, set by hand for one page or all, or calibrated. Metric (1:100) and imperial: architectural (1/4" = 1'-0") and engineering (1" = 20').
- A page with no scale of its own uses page 1's: status bar in amber, "(from page 1)", and a notice when measuring.
- Scale dialog: follows the page in view and shows where its scale came from. Clear every page; read scales from title blocks again.
- Dimensions: two points, then a third click sets the dimension line offset. Movable value. Ends: bar, tick, arrow. Value font: Helvetica, Courier, Courier Bold.
- Units: mm, m, feet and inches (fractions to 1/64"), inches, decimal feet, decimal inches. Auto picks units by a fixed rule; explicit units keep their decimals.

**Reading**
- Text search.
- Text selection and copy.
- PDF links.

**Editing and saving**
- Save, Save a copy. Nothing is written until saved.
- Save asks first when text holds characters other PDF apps can't show (see Known limits).
- Undo and redo.
- Cut, copy, paste and select all for markups, via the system clipboard.
- Crash recovery of unsaved markups.
- Shift constrains every drawing tool: 15° for lines, square for boxes, proportional resize.
- Right-click while placing points: Finish, Remove last point, Cancel.

**Speed**
- Zoom flights and wheel zooms render the destination view while they move; sharp on landing.
- Very heavy pages are drawn in bands even when zoomed out.

**Windows**
- Document icon for PDFs set to open in Vellum.

## Changed

- Print: To scale and the scale note use each page's own drawing scale. Manual layout likewise, including files added to it.
- Print: the scale note describes the sheet in the preview, not always the first.
- Print: To scale on a mix of pages with and without a drawing scale shows both the ratio and the percentage the unscaled pages print at.
- Print: Actual and To scale never shrink a page to fit; a page too big for the sheet is cut off, with a warning. "Never enlarge small pages" is Fit only.
- File types: Vellum.PDF and Vellum.Image replace Vellum.Document. If Vellum was your default for PDFs or images, choose it again (Open with > Choose another app > Always).
- Rotate view: [ and ] (was R). R: Rectangle tool.
- Sidebar 260 px wide by default.
- Scroll and pan: the edge of a sheet bigger than the window can be brought in to the middle of the window (was held at the window's edge).
- Theme follows Windows on a new install (was dark). Existing installs keep theirs.
- F1 lists all shortcuts.

## Fixed

- Canvas flickered while the window or sidebar was resized.
- Continuous layout: a short last page was never the selected page in the sidebar.

## Known limits

- Text in a markup is saved in the standard PDF fonts, which hold Western European characters only. Others (Δ, Ω, ≥, ≤, ≠, non-Latin scripts) show as "?" in other PDF apps, and in Vellum's own prints and thumbnails; Vellum's page shows them as typed. ° and ± are fine.
```
