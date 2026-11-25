# Backlog

Things Matt has asked for that aren't scheduled yet, app-wide. Work on a branch keeps its own
list in its brief (the markup tools': [editing-tool-consistency-brief.md](editing-tool-consistency-brief.md),
"Later: asked for during Matt's review"). When something here is picked up, it moves into
that work's brief or scope file and comes off this list.

## Windows and layout

- **More than one window**: tabs that can be torn off into a window of their own, and dragged
  back. (Pasting markups between windows waits on this to be checked.)
- **A "slide sorter" grid layout**: every page as a thumbnail in a grid, to see and reorder
  a set. Comes with PDF editing (page operations).
- **Dual-pane comparison and diff**: two drawings (or two revisions of one) side by side,
  and a view of what changed between them.
- **A better home page** (what shows with no document open), perhaps with thumbnails of recent
  documents.
- **A panel of its own for Markups**, rather than sharing the sidebar. (The sidebar was widened
  and the list's rows laid out as lines in [edit-lock-brief.md](edit-lock-brief.md).)
- **A preferences panel** of its own, app-wide. Recorded with the markup work in
  [editing-tool-consistency-brief.md](editing-tool-consistency-brief.md), "Later: a
  preferences panel".
- **Perhaps no menu bar**: would everything fit in one drop-down menu off the Vellum title?
  Needs a look at what the menus hold first.

## Toolbars

- **The vertical toolbar**: a right-click menu on its drag handle to force stacked mode by hand.
- **The columns layout**: the number of columns in a spinner beside the column layout button.
- **Movable toolbars**: consider toolbars the user can move and resize.

## Navigation

- **Ctrl and the mouse wheel**: Ctrl held swaps what the wheel does, in either navigation mode:
  zooming where it scrolls, scrolling where it zooms.

## Markup and measuring

- **The dimension loupe shows the dimension being placed**, which covers the very targets
  you're trying to click on. The loupe should show the drawing only.
- **Object snap for dimensions**: snap to what's in the drawing (line ends, corners,
  intersections) while placing a dimension.
- **Measuring scales, round two**: the PDF's own scale (viewports), the title block and
  metadata disagreeing, clearing one page, re-reading every page, and the items below.
  Scoped in [measuring-scales-scope.md](measuring-scales-scope.md).
- **A scale for one measurement, or one area of a sheet**, for pages that hold views at
  different scales (a plan at 1:100 with details at 1:20). Today a page has one scale (each
  page's own title block, or one set by hand). A measurement already records its scale in
  its `/Measure` dictionary; scale regions within a page are the fuller answer. Phase 4 left
  them out ([editing-phase4-scope.md](editing-phase4-scope.md), "Assumed", 5).
- **Read the drawing scale by OCR on pages with no text layer.** Scale detection reads the
  page's text, so drawings whose text was exploded to outlines on export find nothing: 64 of
  the 65 pages of the MMA Curtis Hall set, whose views are labelled 1/4" = 1'-0" and the like.
  Follows OCR coming into the app (search first: [ocr-search-scope.md](ocr-search-scope.md)).
  Curtis Hall is the test file, and with several views per sheet at different scales it's also
  the test case for a scale per measurement or area (above).
- **Save every character so other PDF apps show it.** Text in a markup is drawn with the
  standard fonts, which hold Western European characters only: Δ, Ω, ≥, ≤, ≠ and non-Latin
  scripts are drawn as "?" for every other app (Vellum shows them as typed). 0.2.0 asks before
  such a save. The fix is to embed a font that has the glyphs, in the annotation writer; top of
  the list for 0.2.1. Failing that, mark the text box as it's typed (in the style bar) rather
  than only at the save.
- **Markup on images** (photos, scans), not an image editor: the same markup tools over an
  image file. Today markups can't be saved into an image.
- **Snapping, alignment and z-order for annotations**: snap and align markups to each other,
  and bring forward or send back. Perhaps arrives with layers.

## Speed

- **Keep rendered views when switching tabs**: today a tab's rendered tiles are thrown away
  when you switch away from it, so coming back renders again. Keep them, and expire a tab
  left in the background after a while instead, as Chrome and other browsers do.
- **Fastest in every scenario**: what it would take (start-up, band delivery to the webview,
  the ease, and measuring the untested scenarios), and why "fastest on big CAD drawings" is
  the defensible claim instead. Parked by Matt, 24 Nov:
  [fastest-everywhere.md](fastest-everywhere.md).

## Other

- **PDF forms**: filling in (and perhaps saving) a PDF's form fields. Other viewers do it, so
  Vellum will, eventually. Listed as not there yet in the README.
- **An easter egg.**
- **Investigate KillerPDF** (another PDF viewer): what it does, and anything worth learning.

## Releases

- **Release candidates that update to newer release candidates.** Today an RC install is
  offered nothing until the full release. Worth building once there are enough users that a
  staged rollout matters; until then, full releases and patch releases. Scoped, nothing built:
  [rc-updates-scope.md](rc-updates-scope.md).

## Look

- **Dialogs**: their styling overall is heavy, with a large header and footer each.
- **Tooltips**: their styling.
