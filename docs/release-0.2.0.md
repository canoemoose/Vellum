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
- [ ] The six "Before 0.2.0" items in [review-0.2.0.md](review-0.2.0.md). **Nothing is tagged
      until these are done.**
- [ ] Check the three points under "Check before publishing" below.
- [ ] `node tools/set-version.mjs 0.2.0`, commit "Release 0.2.0", push `main`.
- [ ] `git tag v0.2.0`, `git push origin v0.2.0`; the workflow takes about 16 minutes.
- [ ] Publish the draft with the notes below (`gh release edit v0.2.0 --draft=false --latest
      --notes-file ...`, or on GitHub).
- [ ] Delete the unpublished `v0.2.0-rc2` draft release.
- [ ] After a minute, Help > Check for updates from a 0.1.4 install and from an rc3 install.
      Worth trying once on the way: cancel the installer, and see what the app says.

The app code on `main` has changed since rc3, so the fixes above have only been tried in a
development build, not an installed one. An rc4 would test them installed; Matt's call.

## Check before publishing

Written from the rc1 and rc3 notes and the code, not from using the app:

1. **Markups panel, "right-click to delete".** rc3 removed the delete button; the code shows a
   right-click menu with Delete. Confirm in the app.
2. **Scale dialog, "read scales from title blocks again".** Reworded from rc3's line. Check it
   matches what the button does and is called.
3. **The padlock.** rc1's line "Existing annotations in a file are editable behind the padlock"
   is replaced by the Edit lock section. Confirm nothing still calls it a padlock in a way the
   notes should mention.

If item 12 of the review (symbols outside Western European text saved as "?") isn't fixed for
0.2.0, add a line under a "Known limits" heading.

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
- Print: Actual and To scale never shrink a page to fit; a page too big for the sheet is cut off, with a warning. "Never enlarge small pages" is Fit only.
- File types: Vellum.PDF and Vellum.Image replace Vellum.Document. If Vellum was your default for PDFs or images, choose it again (Open with > Choose another app > Always).
- Rotate view: [ and ] (was R). R: Rectangle tool.
- Sidebar 260 px wide by default.
- F1 lists all shortcuts.

## Fixed

- Canvas flickered while the window or sidebar was resized.
```
