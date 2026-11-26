# Roadmap

**Status: drafted by Claude on 26 November 2026 after 0.2.0; Matt agreed the general shape the
same day and his changes are folded in** (forms stay, document signing to investigate, no menu
bar and a full-screen view, release candidates for trusted testers, loose ends rounded up into
a patch of their own, 0.2.2). The contents of each release are still a suggestion until its
brief is written.

The [backlog](backlog.md) is everything that isn't built, in no order. This file is the order:
what goes in which release, and why. It only names items; the detail stays in the backlog and
the scopes that points to. Every backlog item of any size is either in a release below or
under "Parked, for now". The small ones not named here are swept up when a release's brief is
written: a brief starts by going through the backlog for what belongs with it.

The reasoning behind the order:

1. **Trust before features.** Anything where a file comes out different from what the user
   saw goes first, in a patch.
2. **The only PDF viewer you need** (Matt). Nobody should have to open another app for
   something ordinary: that is why forms and signing are on the list even though they have
   nothing to do with drawings.
3. **Built for drawings.** Where two things cost the same, the one that matters to someone
   reading a CAD sheet goes first.
4. **Room for the document.** Chrome that can go, goes: fewer bars, a full-screen view.
5. **Each feature release has one headline**, as 0.2.0 had markup. It makes the release easy to
   describe and the homepage pill easy to write.
6. **Don't leave small things indefinitely.** A patch release rounds up loose ends as well as
   faults, so they don't sit behind every headline.

## 0.2.1: trust and bugs

No new features, and nothing that is only a nicety: those are 0.2.2.

**Trust**

- **Say so as it's typed** when a markup has a character other apps will show as "?" (Δ, Ω,
  ≥ and anything non-Latin), in the style bar, and not only at the save as 0.2.0 does. The
  fix proper is a font question, and fonts have been left alone on purpose (Matt): see
  "Fonts" in 0.4.0.
- **Try the standard Symbol font for those characters** (Matt). It is one of the fonts every
  PDF app already has, so using it embeds nothing and doesn't open the font question. A short
  trial first: write Δ, Ω, ≥, ≤, ≠ through it in a text box, a callout and a dimension, then
  look at the file in Acrobat, Edge and Bluebeam, and edit the box in one of them. If it
  holds up, it ships here or in the tweaks patch, whichever is open, and the warning above
  shrinks to the characters Symbol doesn't have. If it doesn't, nothing changes and it stays
  with "Fonts".
- **Printing with unsaved markups**: check it first. If they don't print, fix it here; if the
  fix is large, warn before printing and move the fix to 0.3.0.
- From the 0.2.0 review, Save: Ctrl+S pressed twice isn't guarded; a `.vellum-save-*.tmp`
  file is left beside the drawing after a crash mid-save; no checks that a markup's numbers
  are finite.
- The rest of that review's Recovery, Save and Writer groups, sized first. By rule 1, any that
  can lose work or change what's in a file belongs here and not in 0.2.2: recovery thrown
  away silently when the file has changed since, "Save a copy" doing nothing after a failed
  reopen, a deleted annotation leaving its replies behind, a dimension changed in another app
  losing its `/Measure`, text from other apps decoded in the wrong encoding.

**Reported by Matt**

- **Ctrl+wheel over the toolbars zooming the whole window**: fixed on `main` (8b313a2).
- **Zooming in and out in quick alternation goes stuttery** on the Xero drawing. Look into it;
  fix it here if the cause is what he suspects (renders queued and cancelled), else say what
  it is and schedule it.
- **Dragging the green box on the mini map** jumps across page boundaries.
- **The dimension loupe shows the dimension being placed**, covering what you're aiming at.

**Before it ships**

- **Matt's check list** in the backlog ("For Matt to check"): go through it once, so what it
  turns up lands here and not in 0.3.0. With it, one print to a real printer (margins, trays,
  duplex and vector output have never been checked on one).

## After 0.2.1: a full review of the code

Not a release: a piece of work whose findings feed the releases after it (Matt, 26 November
2026). The review before 0.2.0 looked only at the code that can damage a file, lose markup,
leak a signature or strand installed copies. Everything else has never been reviewed:

- the markup and measuring models, the viewer engine and the components (that review's own
  tiers 2 to 4);
- what its tiers never listed: rendering and image swaps in the back end, printing, text and
  search, the shell (tabs, settings, the window), image documents, the build and release
  tools.

It goes here because the known trust fixes shouldn't wait for it, and because 0.3.0 builds on
the markup models and the thumbnail sidebar, which are in the unreviewed part. What it finds is
sorted the same way as before: anything that can lose work or change a file goes out in a
patch at once; small things join 0.2.2; the rest goes on the backlog with a release. Its record
is a document like [review-0.2.0.md](review-0.2.0.md). It needs a brief first: the areas, the
order, and what counts as a finding.

The patch numbers aren't fixed (Matt): if the review finds something that shouldn't wait, it
goes out as the next patch and "tweaks" moves along to 0.2.3. Read "0.2.2" below as "the tweaks
patch", whatever its number ends up being.

## 0.2.2: tweaks

The loose ends, rounded up, with whatever small things the full review turns up. Each is small;
anything that turns out not to be goes back to the backlog.

- Text markups: a pasted one lands where it was copied from (leave them out of paste), and
  nudging one records an empty undo step.
- Selecting text by dragging doesn't scroll the view at the edge.
- From the 0.2.0 review:
  - Updater: a failed install says "Nothing has changed" even if the installer had started; the
    unsaved-markups question comes after the download, not before.
  - Stamps: a stamp of only `{author}` with no author prints "{AUTHOR}"; toggling a stamp's
    date line re-dates the main line.
  - Print: N-up ignores "Never enlarge small pages"; title-block reads aren't cancelled when
    the dialog closes.
  - README: "one check a day" and "sends nothing about you" slightly overstate.
  - Whatever else on that list proves small once looked at. What doesn't stays on the backlog.
- **Ctrl held swaps what the wheel does** in either navigation mode.
- **The vertical toolbar**: a right-click on its drag handle to force stacked mode.
- **The update file's placeholder notes**: a one-line change to the release workflow.
- **How many files to remember** (200, or Recent's 10): a decision, then one number.
- **The look of dialogs and tooltips**: dialogs are heavy, with a large header and footer
  each. Settled here, so the preferences panel in 0.3.0 is built in the new style.
- **Keep rendered views when switching tabs**, perhaps: here if it proves small (keep a
  tab's tiles, drop them after a while in the background), otherwise 0.3.0.
- Housekeeping: delete `spikes/annot-writer/`; bring `ARCHITECTURE.md` up to 0.2.0.
- **Investigate KillerPDF** (Matt: definitely): what it does and what's worth learning,
  written up before 0.3.0's brief so it can shape it. Reading, not building, so it rides
  alongside whichever patch is in hand.

Left out on purpose, though small: setting the author's name, which waits for the preferences
panel in 0.3.0.

## 0.3.0: Pages

Headline: **reorder, rotate, delete and merge pages.** Phase 8 of the editor. With it, a
rethink of where commands live, because page operations add a menu and that forces the
question.

- **Page operations**, from the thumbnail sidebar behind the edit lock. The design is done
  (a virtual page list) and the lock was built to guard exactly this. It needs a brief first.
- **The slide sorter** grid comes with it: the natural place to reorder a long set. It takes
  over showing many pages at once, so the columns layout becomes a fixed two-up and the
  spinner once planned for the number of columns is dropped (Matt).
- **Where commands live**, as one piece of design:
  - **A preferences panel**: a home for settings that have none (the author's name, tool
    defaults, the remembered-files count) and for the menu entries that are really settings.
  - **Right-click menus as a set**, including the new thumbnail menu.
  - **No menu bar**: with settings in Preferences and most other entries already on buttons,
    what's left fits one drop-down off the Vellum title, and the bar's height goes to the
    document. Starts with a table of every menu entry and where it would go.
  - **A full-screen view**: the document and nothing else, for reading a sheet or showing one
    on a screen in a room.
  - **"Vellum website" in the Help menu** is decided in that table, not before.
- **Release candidates that update to release candidates**, built before 0.3.0's first RC, so
  people Matt trusts with a possibly broken build can follow the RCs. 0.3.0's own RCs are the
  test, and the first time updating from an RC to the full release gets tried. The testers
  are two people Matt has named, so the scoped approach is enough: installing an RC is what
  puts a copy on the RC channel, and nothing in the app needs a switch
  ([rc-updates-scope.md](rc-updates-scope.md)).
- Built on reviewed code: the full review (above) is done before this starts.

Why this one next: it's the README's first promise, it finishes the editor's page side as
scoped, and Bluebeam and Acrobat users reach for it weekly.

## 0.4.0: Drawings

Headline: **layers, and measuring that snaps.** The release that only a drawing viewer would
make.

- **PDF layers**: a Layers tab beside Bookmarks. Start with the half-day check that PDFium can
  list and switch them; if it can't, this release changes shape, so do that check during 0.3.0.
- **Object snap for dimensions** (line ends, corners, intersections). Needs a spatial index of
  the page's paths, and its own measurement on the 74,000-path stage plan.
- **Measuring scales, round two**: the PDF's own viewport scales, and a scale for one area of a
  sheet. Curtis Hall is the test file.
- **OCR search on scans**, and with it **reading the scale by OCR**. The spike is done and Matt
  found it fine; it's wiring into the existing search.
- **A count tool**: small, same area.
- **Snapping, alignment and order for markups**: the same snapping machinery as object snap.
- **A panel of its own for Markups**: Layers adds a sidebar tab, so the sidebar is being
  rearranged anyway.
- **Fonts, as one piece, scoped first.** Vellum has deliberately not touched fonts: markup
  text uses the standard fonts every PDF app has, and nothing is embedded. That is why Δ, Ω
  and ≥ save as "?" for other apps. Decide it whole, not as a patch: which characters matter
  (engineering symbols first, other scripts after; the Symbol trial in 0.2.1 may already have
  dealt with the first group), and only then whether to ship and embed a font, with what that costs (a font to
  license, subsetting, bigger files, how other apps treat the box when they edit it). It sits
  here because symbols on dimensions and notes are a drawing matter.

## 0.5.0: The only viewer you need

Headline: **fill in forms and sign documents.**

- **Form filling** (phase 6 of the editor), through PDFium's form module.
- **Document signing: investigate first.** The term is a *digital signature* (also
  "certificate signing"): the file is signed with a certificate so anyone can check who signed
  it and that it hasn't changed since. That's different from the drawn signature Vellum places
  today, which is a picture. Two halves, to look at separately:
  - *Showing* whether a signed file's signatures are valid. Reading only; likely the smaller
    half, and useful on its own.
  - *Signing* a file. Ruled out on 13 November because PDFium can't write one and it needs
    another library ([editing-scope.md](editing-scope.md), "Decisions made"). The investigation
    is whether a Rust library can do it with certificates from the Windows store, and what
    Acrobat then says about the result.
- **Password protection on save** was ruled out in the same line for the same reason. Look at
  it in the same investigation: it's the other thing people open Acrobat for.
- **Markup on images**: Vellum opens images, so marking one up shouldn't need another app.
  With it, **dragging an image file onto a page** to place it as markup.
- **A better home page**, with thumbnails of recent files.

## 0.6.0: Compare

Headline: **two revisions side by side, and what changed.** The other thing drawing people ask
for, and nothing free does it well. Not scoped at all yet.

## 0.7.0: Windows

Headline: **tabs that tear off into their own window.** Large and touches everything, which is
why it's last; comparison covers much of the need before it.

These two are far enough off that the order is a guess. They are here so that they have a
place.

## Speed

Not a release of its own. 0.2.0 is fast where it's used, and Matt parked "fastest everywhere"
on 24 November. Specific complaints go into the next patch (the zoom stutter is in 0.2.1). If
the wider work is picked up again the order is already agreed in
[speed-diagnosis-scope.md](speed-diagnosis-scope.md): the one-session rerun, then band delivery
to the webview. Do the rerun before the homepage gets a speed comparison section, which waits
on it and has no release of its own.

The problems known since v0.1 (progressive paint's extra memory, print composition holding a
worker, very large images) have no release either: they are fixed when they show up in use,
which so far they haven't.

## Parked, for now

On the backlog, deliberately in no release (Matt, 26 November 2026). Not cut: they come back
when something makes them matter.

- **Movable toolbars.** The toolbar already docks to a side, and with the menu bar gone there
  is less to arrange.
- **Delete or cover an object on the page.** That's editing the drawing, not marking it up, and
  a filled rectangle covers most of the need.
- **Most of the untried speed ideas** in the 8 November lists. Region bands (idea 1a) is the
  one to pick up first if speed work resumes.
- **"Fastest everywhere"** (see Speed, above): parked by Matt on 24 November.
- **Markups edited in Edge** (a text box turns transparent, a callout loses its leader):
  parked since 13 November, waiting on a reference file made in Acrobat and edited in Edge.
- **Editing an image stamp**: deferred by Matt on 16 November, to see whether it's missed.

The easter egg isn't parked. It just doesn't get announced.
