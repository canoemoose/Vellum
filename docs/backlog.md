# Backlog

Everything that isn't built or checked yet, app-wide: the one list. Where a scope or brief
already covers an item, the entry here is short and links to it, and the detail stays there.
(The markup tools' own leftovers stay in
[editing-tool-consistency-brief.md](editing-tool-consistency-brief.md), "Later: asked for
during Matt's review".) When something here is picked up, it moves into that work's brief or
scope file and comes off this list. Last checked against every doc on 26 November 2026, after
0.2.0. The order to do things in is a separate file: [roadmap.md](roadmap.md).

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
- **No menu bar**: the menus are sparse, and most entries are also buttons or would sit better
  in Preferences, so what's left could be one drop-down off the Vellum title and the bar's
  height would go to the document (Matt, 26 November 2026). Starts with a table of every menu
  entry and where it would go.
- **A full-screen view**: the document and nothing else. Asked for by Matt on 26 November 2026
  with the menu bar, for the same reason: more room for the document. Nothing like it exists
  yet.

## Toolbars

- **The vertical toolbar**: a right-click menu on its drag handle to force stacked mode by hand.
- **The columns layout becomes a fixed two-up** when the slide sorter arrives (0.3.0), which
  takes over showing many pages at once. The spinner once planned here, for the number of
  columns, is dropped (Matt, 26 November 2026).
- **Movable toolbars**: consider toolbars the user can move and resize. Parked for now
  (Matt, 26 November 2026).

## Navigation

- **Ctrl and the mouse wheel**: Ctrl held swaps what the wheel does, in either navigation mode:
  zooming where it scrolls, scrolling where it zooms.
- **Right-click menus**: go over them as a set. The Markups panel's has one entry (Delete),
  which reads as thin; decide what belongs on each (jump to, properties, copy) or whether a
  one-entry menu should be something else. Noted by Matt on 25 November 2026.
- **Dragging the green box on the mini map is glitchy across page boundaries**: the map grows
  and shrinks as the view crosses from one page to the next, so the box jumps under the
  pointer mid-drag. Reported by Matt on 25 November 2026, not looked into. One idea (untried):
  hold the map's framing and size still for the length of a drag.

## The editor's unbuilt parts

Scoped in [editing-scope.md](editing-scope.md), which covers the whole editor. None has a brief
of its own yet.

- **Page operations** (phase 8): from the thumbnail sidebar, behind the edit lock: reorder,
  rotate, delete, extract, insert from another file, merge tabs, split. Designed as a virtual
  page list, so each is instant and undoable ("3. Page operations are a virtual page list" and
  "Page operations"). Brings unlocking by dragging a thumbnail
  ([edit-lock-brief.md](edit-lock-brief.md)) and the slide sorter above.
- **Form filling** (phase 6): filling in (and perhaps saving) a PDF's form fields, through
  PDFium's form module ("Form filling"). Staying on the list (Matt, 26 November 2026): the aim
  is to be the only PDF viewer anyone needs. Listed as not there yet in the README.
- **Document signing: investigate.** Digital signatures made with a certificate (not the drawn
  signature placed today, which is a picture): showing whether a signed file's signatures are
  valid, and signing a file. Signing and password protection on save were ruled out on
  13 November because PDFium can't write either and each needs another library
  ("Decisions made"); Matt asked on 26 November 2026 for it to be looked at again, for the
  same only-viewer-needed reason.
- **OCR search on scans**: the spike is done and Matt found it fine standalone (15 November);
  nothing is in the app. Design and steps: [ocr-search-scope.md](ocr-search-scope.md).
- **PDF layers** (optional content): a Layers tab beside Bookmarks, for drawings exported from
  AutoCAD and Revit. Parked by Matt on 13 November until after markup, which is now. First
  check that PDFium can list layers and switch them: [ui-review.md](ui-review.md), at the end.
- **Delete or cover an object on the page**: "Later phases". Not started. Parked for now
  (Matt, 26 November 2026).

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
  such a save. Not a patch fix: fonts have been left alone on purpose (Matt, 26 November
  2026), so embedding a font that has the glyphs is to be decided as one piece ([roadmap.md](roadmap.md),
  "Fonts"). First, a trial of the standard Symbol font for the engineering characters, which
  embeds nothing: if it works it can go in a patch (Matt, 26 November 2026). Meanwhile, mark the
  text box as it's typed (in the style bar) rather than only at the save.
- **Markup on images** (photos, scans), not an image editor: the same markup tools over an
  image file. Today markups can't be saved into an image.
- **Snapping, alignment and z-order for annotations**: snap and align markups to each other,
  and bring forward or send back. Perhaps arrives with layers.
- **A count tool**: [editing-scope.md](editing-scope.md), "Measuring" ("Later: count").
- **Printing with unsaved markups.** The scope says printing, and Save as PDF from the print
  dialog, include them ([editing-scope.md](editing-scope.md), "4. Edit state, undo and saving").
  Print composition reopens its files by path, and a search of the print code on 26 November
  found nothing that handles them. Try it first: print a file with a markup not yet saved.
- **Set the author in the app.** Markups carry an author (`markup/prefs.ts`) and nothing in
  the app sets one ([editing-phase2-scope.md](editing-phase2-scope.md), "Known problems and
  gaps"). Belongs with the preferences panel.
- **Edge**: a text box edited in Edge turns transparent and a callout loses its leader. Parked,
  waiting on a reference file made in Acrobat and edited in Edge
  ([editing-scope.md](editing-scope.md), "Matt's check in other apps").
- **Drag an image file onto a page as markup**:
  [editing-tool-consistency-brief.md](editing-tool-consistency-brief.md), "Not built".
- **Edit an image stamp**: deferred by Matt on 16 November, to see whether it's missed. A
  smaller version is planned in
  [stamp-library-dialogs-scope.md](stamp-library-dialogs-scope.md), step 6.
- **Smaller gaps written down in the phase scopes**, none looked at since:
  - Reading ([editing-phase1-scope.md](editing-phase1-scope.md), "Known problems"): a text
    request waits behind its worker's renders (6.3 s once, on the aerial drawing); a link into
    a rotated page may land at the wrong height; selecting by dragging doesn't scroll at the
    edge; the text cursor only appears once the page's text has loaded.
  - Foundation ([editing-phase2-scope.md](editing-phase2-scope.md), "Known problems and gaps"):
    typing with the view rotated is untried; the update banner resizes the canvas; the parse
    cost of reopening after a save.
  - Measuring ([editing-phase4-scope.md](editing-phase4-scope.md)): on `/UserUnit` pages the
    status bar's page size, the cursor coordinates and printing to scale take a unit as a
    point. No real `/UserUnit` sheet has been tried.
  - Text markups and the file's own annotations
    ([editing-phase7-scope.md](editing-phase7-scope.md), "Known gaps (7a)" and "(7b)"): a
    pasted text markup lands where it was copied from; nudging one records an empty undo step;
    quads round diagonal text are fat; other apps' notes scale with the zoom; a file changed
    by another app while open shows its old markups.
  - A dimension once vanished when its Weight slider was dragged (release build, not
    reproduced), and one file's settle times fall in two clusters for no known reason
    ([editing-scope.md](editing-scope.md), "Open on what is built").

## Speed

- **Zooming in and out in quick alternation goes stuttery** on the Xero drawing. Reported by
  Matt on 26 November 2026 (0.2.0), not looked into. His guess: renders being queued and
  cancelled in quick succession. The bench has no test for it: `--spin` is a steady spin one
  way, so reproducing it needs an alternating mode or a hand on the wheel.
- **Keep rendered views when switching tabs**: today a tab's rendered tiles are thrown away
  when you switch away from it, so coming back renders again. Keep them, and expire a tab
  left in the background after a while instead, as Chrome and other browsers do.
- **Fastest in every scenario**: what it would take (start-up, band delivery to the webview,
  the ease, and measuring the untested scenarios), and why "fastest on big CAD drawings" is
  the defensible claim instead. Parked by Matt, 24 Nov:
  [fastest-everywhere.md](fastest-everywhere.md).
- **The agreed next fix is band delivery to the webview**, if speed work continues. The order,
  and what else is open (the zoom comparison rerun in one session on all five drawings, the
  free-spin jerk to watch, feel measures not built), are in
  [speed-diagnosis-scope.md](speed-diagnosis-scope.md), "What is open".
- **Ideas never tried**, with numbers from 8 to 10 November (parked for now, Matt,
  26 November 2026; region bands is the one to pick up first):
  [speed-handoff.md](speed-handoff.md)'s ranked list (bands that cover only the region asked
  for, idea 1a; pre-parsing the neighbouring pages; cancelling mid-strip; a shorter settle
  after a pinch; bands by object count) and [speed-ideas.md](speed-ideas.md), section 1 (a
  cache of decoded images on disk, band boundaries that adapt, a "this page will be slow"
  sign, a deadline per worker).
- **Known since v0.1 and not gone back to** ([v0.1-report.md](v0.1-report.md), section 5, and
  [v0.1-handoff/engine.md](v0.1-handoff/engine.md)): progressive paint's extra memory (150 to
  460 MB on small files), print composition holding one worker for about 20 s, an image over
  120 MP needing its whole decode in memory, the 300-page file opening 47 ms slower.

## Other

- **Printing on real printers**: margins, trays, duplex and vector output on real drivers were
  never checked, and the manual layout's previews are capped at 4096 px
  ([v0.1-handoff/print.md](v0.1-handoff/print.md)).
- **How many files to remember**: 200 today; Matt wondered about matching Recent's 10
  ([ui-polish-scope.md](ui-polish-scope.md), "Still open").
- **Bring ARCHITECTURE.md up to 0.2.0**: it lists what it doesn't yet describe (measuring,
  stamps and signatures, the edit lock, the updater, the reset).
- **Delete `spikes/annot-writer/`**: the writer moved into the app in phase 2, and
  [editing-scope.md](editing-scope.md) ("Files in play") says to delete the spike once it had.
- **A full review of the code.** The review before 0.2.0 covered only the code that can damage
  a file, lose markup, leak a signature or strand installed copies
  ([review-0.2.0.md](review-0.2.0.md)). Never reviewed: the markup and measuring models, the
  viewer engine and the components (its tiers 2 to 4), and what its tiers never listed
  (rendering and image swaps, printing, text and search, the shell, image documents, the build
  and release tools). Asked for by Matt on 26 November 2026; after 0.2.1 on the roadmap. Needs
  a brief first.
- **An easter egg.**
- **Investigate KillerPDF** (another PDF viewer): what it does, and anything worth learning.
  Definitely wanted (Matt, 26 November 2026); on the roadmap beside 0.2.2.

## Homepage

- **A speed comparison section**: in the redesign and never built, waiting for figures taken
  in one session ([homepage-layout-brief.md](homepage-layout-brief.md), "Still to do"; the
  rerun is under Speed above).
- **"Vellum website" in the Help menu**: optional in [homepage-brief.md](homepage-brief.md),
  not built.

## Releases

- **Release candidates that update to newer release candidates.** Today an RC install is
  offered nothing until the full release. It's for people other than Matt whom he'd trust
  with a possibly broken build (Matt, 26 November 2026), not for a staged rollout. Scoped,
  nothing built:
  [rc-updates-scope.md](rc-updates-scope.md).
- **The update file's `notes` field holds placeholder text.** `latest.json` is written when the
  draft is made, before the notes exist, so it says "Replace this with what's new in this
  version, then publish." The app doesn't read the field ("What's new" opens the release page),
  so nobody sees it. Either leave the field empty in `.github/workflows/release.yml`
  (`releaseBody`) or have it say where the notes are.
- **Updating from a release candidate to the full release** hasn't been tried (0.1.4 to 0.2.0
  has, 25 November 2026).

## For Matt to check

Built and released, with no record of anyone having looked. Strike through what's done; three
weeks of daily use will have covered a lot of it.

- **The document icon in Explorer**: every view size at 100% and 150%; Vellum once, not twice,
  under Open with after an update; whether an uninstall leaves stale icons
  ([document-icon-brief.md](document-icon-brief.md), "Checking it").
- **In Acrobat**: a signature, text markups on real text, a page rotated in the file, a
  baked-in stamp ([editing-scope.md](editing-scope.md), "Open on what is built"); and a
  dimension's saved keys and imperial `/Measure`
  ([editing-tool-consistency-brief.md](editing-tool-consistency-brief.md), "For Matt to
  check", 5).
- **The two "For Matt to check" lists**, nine groups each: the tool consistency brief's and
  [edit-lock-brief.md](edit-lock-brief.md)'s. Neither records a result.
- **`site/img/og.png`** (the picture a shared link shows): that it is the current design.

## From the 0.2.0 review

Smaller faults found when the code that writes to files was reviewed before 0.2.0
([review-0.2.0.md](review-0.2.0.md)). None loses work on its own; none has been looked at since.

- Recovery: thrown away silently when the file changed since, or when the file's size and date
  couldn't be read; written for the active tab only, a second after a change; two offers on
  one launch may collide in `ask()`.
- Save: a `.vellum-save-*.tmp` file is left beside the drawing after a crash mid-save; Ctrl+S
  twice isn't guarded; after a failed commit some edited annotations are drawn twice until the
  next save; if the reopen also fails, "Save a copy" does nothing; no finiteness checks on
  markup numbers (a NaN would block every save with an obscure error; no source found).
- Writer: PDFDocEncoding strings from other apps decoded as Latin-1; a UTF-8 `/NM` fails the
  save; deleting an annotation leaves its `/IRT` replies; a second pop-up can be written; a
  dimension changed in another app loses its own `/Measure`; annotation positions after a
  rebuilt (repaired) save are assumed to keep their order.
- Signatures and stamps: baking assumes balanced `q`/`Q` in the page's content; the soft mask
  has no `/Interpolate`; a stamp of only `{author}` with no author prints "{AUTHOR}"; toggling
  a stamp's date line re-dates the main line; separator tidy-up eats dashes in file names; a
  turned crop can ask for a 4x buffer; HEIC orientation may be applied twice (check with one
  portrait iPhone photo; Matt saw one come in upright through the signature import on
  14 November, [signatures-backend.md](signatures-backend.md), before this doubt was raised).
- Updater: the count of other open Vellum windows is taken as zero when it fails; a failed
  install says "Nothing has changed" even if the installer had started; a retry downloads
  again; the unsaved-markups question comes after the download, not before; whether a
  cancelled install can be told from a successful one needs a real machine.
- README: "one check a day" and "sends nothing about you" slightly overstate.
- Print: queued title-block reads aren't cancelled when the dialog closes; reads for files
  closed by manual layout still run and warn; N-up ignores "Never enlarge small pages"
  (older bug); the canvas is drawn twice per resize step.
- Not reviewed at all: the markup and measuring models, the viewer engine, and the components
  (the review's tiers 2 to 4). See "A full review of the code" under Other.

## Look

- **Dialogs**: their styling overall is heavy, with a large header and footer each.
- **Tooltips**: their styling.
