# Vellum homepage: layout brief

Follows [homepage-redesign-brief.md](homepage-redesign-brief.md), which follows
[homepage-brief.md](homepage-brief.md). Everything in those still stands (relative paths, no
third-party requests, no client-side JavaScript needed, the download-button build, APCA, UK
English, phone width, both themes equally finished, the speed section
waiting for real numbers, the Pages workflow) unless this file changes it. This brief changes
the hero, the stats strip, the features grid and, if Matt keeps it, the footer, and adds a
band showing both themes. That band brings the page's first script; "no client-side
JavaScript needed" still holds, because everything works without it.

## Status: built, with changes (24 Nov 2026)

Built on `claude/homepage-6e3655`. Matt reviewed the built page and changed several things, so
**where this section and the brief below disagree, this section is what the page does.** The
rest of the brief is kept as the record of what was asked for first.

- **Hero.** Not the window running off the right edge: that looked broken on wide screens (a
  blank quarter on the left, the window falling off the right). From 1280 px (not 1100) the
  text and the whole window sit side by side, centred as one block; below that it's the stack.
  The text column is `clamp(440px, 36vw, 620px)` and the headline `clamp(40px, 3.3vw, 58px)`,
  sized so the headline breaks at its comma: "Built for drawings, / not documents." The nav is
  as wide as the hero block from 1280 px, so the mark sits over the headline. The faint grid
  is back, behind the text only, and there is more glow.
- **Number band.** Now **16 ms**, labelled "zoom to sharp", with the caption "Sharp the moment
  you stop zooming." and the small print "Wheel zoom, typical drawings." The figure is from
  `docs/speed-diagnosis-scope.md` on `main` ("Zoom to sharp in 16 ms", Matt, 23 Nov,
  provisional) and is true of 0.2.0, not 0.1.4: **the page should not go live before 0.2.0.**
  It runs from the zoom finishing to sharp, for one wheel notch, on typical drawings; keep
  the small print with it. Less space above and below the band than first built.
- **Features.** As briefed. Card text rewritten with Matt; captions kept to two or three
  lines. Under the cards only the "Images too" line remains; the Fieldwork Festival line and
  the map credits moved to the footer.
- **Themes band.** The diagonal is fixed: no drag handle, no slider. The Dark and Light
  buttons stay. The picture leads with the page's own theme on the left and swaps with it.
- **Footer.** The title block was dropped (too heavy, one drawing nod too many). A plain
  footer: links (source, release notes, all versions, licence, notices), the no-tracking
  note, then the screenshot and map credits. Matt's name is not on the page.
- **Section titles.** Each breaks at a set point (`<br>` in the page). On the three that break
  in two, the second line is a step dimmer with a gentle fade of its own; the closing title is
  one solid colour.
- **Download notes.** "Vellum is for Windows PCs" shows on phones and tablets (CSS), and the
  script adds a Mac or Linux version and hides the phone one on a Windows tablet.
- **From the release, at build time** (`tools/build-site.mjs`): the pill's feature text comes
  from a `Highlights:` line in the release notes (none: the pill shows only "New in 0.2"),
  and a "Try the 0.2.0-rc1 release candidate" line appears under the download button while a
  published prerelease is ahead of the latest release.
- **Kept out of git:** the title block footer, the drag handle and the revisions-table build
  code, as `mockups/title-block-footer-and-drag.patch` on the machine that built this.
- **Still to do:** recapture `site/img/og.png` (it shows the old design); the speed section;
  and the 16 ms figure's remaining checks in the speed scope. *(The page went live with 0.2.0
  on 25 November. All three are in [backlog.md](backlog.md); `og.png` was last replaced on
  24 November and hasn't been checked against this line.)*

## Why

Matt's verdict on the redesign (commit aa313df): it needs more oomph.

- At 1920 x 1080 the stacked hero text takes about 730 px, so all you see is the headline and
  the top strip of the screenshot.
- The feature tiles don't fit together. Every card shows a whole shrunken window pinned
  top-left, so they all look the same, and row partners come out at different heights.

Sixteen ideas were mocked up in `mockups/ideas/` (untracked in this worktree; open
`mockups/ideas/index.html` in Edge or Chrome, `t` flips the theme). Matt picked the ones
below. The mockups use the real stylesheet and screenshots, so they're close to finished, but
treat their CSS as a sketch: positions were set by eye and the crops are done in CSS.

## 1. Hero: split on wide screens, tighter stack on narrow

Reference: [mockups/ideas/h8-combined.html](../mockups/ideas/h8-combined.html). Same copy
and parts as now (pill, headline, lede, both buttons, meta line, screenshot); only the layout
changes.

- **From 1100 px wide:** a grid the full width of the page with three columns: a gutter of
  `max(24px, (100vw - 1180px) / 2)`, so the text lines up with the rest of the page's content
  edge; the text, at most 440 px; and the screenshot, after a 56 px gap. The screenshot is
  drawn at a fixed 1180 px wide and runs off the right edge of the page (the section clips
  it; the page must never scroll sideways). Don't cap the grid's width the way the mockup
  does (`max-width: 1440px`): with the gutter worked out from `100vw`, that pushes the text
  about 240 px right at 1920 and hides a third of the window. How much of the window shows
  depends on the width: about 580 px at 1100 (the mini map is cut off), about 1054 px at 1920.
  Past about 2360 px the window ends short of the edge; let it, with its rounded corner,
  rather than stretching it. Everything sits vertically
  centred in a section at least `100vh` minus the nav, so at 1920 x 1080 the whole hero,
  window included, is on the first screen. Text left-aligned. The glow sits behind the window
  (`radial-gradient` at about 75% 45%). The meta line breaks after the size.
- **Below 1100 px:** the current stacked hero, tightened. About 52 px top padding, headline
  `clamp(40px, 5.4vw, 68px)`, lede on one line where it fits (19 px), 44 px between the meta
  line and the screenshot, window full width with a blurred pool of glow behind it. Centred.
  The meta line runs on one line, separated by middle dots.
- Keep the screenshot flat (no tilt, no fade), as the redesign brief says.
- The headline keeps its gradient text fill.
- Drop the faint background grid behind the headline if it fights the split; Matt didn't see
  it in the mockup.

## 2. One huge number, replacing the stats strip

Reference: [mockups/ideas/b1-number.html](../mockups/ideas/b1-number.html). Directly under
the hero, where the stats strip is now.

- **97 ms**, centred, in the mono face at `clamp(120px, 22vw, 300px)`, with the heading
  gradient as its fill and "ms" smaller in the muted colour.
- Under it, a dimension line the full width of the figure: end ticks, 45° oblique slashes,
  in the accent colour, labelled "LET GO TO SHARP" in small spaced capitals beneath.
- The caption under it: "From letting go of the mouse to a sharp image at 1600%, on the
  heaviest real drawing we tested." The figure and its claim are unchanged from the current
  page; don't reword the 1600% or "heaviest real drawing" parts.
- The other two stats stay as a quiet line underneath, side by side: **1:200** (prints to a
  real scale) and **0** (accounts, cookies or analytics). Wrap on a phone.
- A soft radial glow behind the band.
- **The draw-in:** the dimension line scales out from the centre as the band scrolls into
  view, then the ticks, slashes and label fade in. CSS scroll-driven animation only
  (`animation-timeline: view()`), inside `@supports (animation-timeline: view())` and
  `prefers-reduced-motion: no-preference`. Everywhere else, and with reduced motion, it's
  simply drawn. No script.
- Accessibility: the dimension line is `aria-hidden`; the number and its caption read as
  one sentence to a screen reader ("97 milliseconds", via visually hidden text if the visible
  "ms" reads badly).

## 3. Features: detail callouts

Reference: [mockups/ideas/f1-callouts.html](../mockups/ideas/f1-callouts.html). This
replaces the bento grid. Same five features, same headings and copy as the current page;
the line about images and map credits under the grid stays.

- **Close-ups, not whole windows.** Each card shows a crop of the thing it's about, not a
  shrunken full window. Picture first, text under it.
- **Grid:** six columns. Row 1: Quick on big drawings (4) and Moves like CAD (2). Row 2: Real-world
  scale (3) and Markup, stamps and signatures (3). Row 3: Prints to scale (6). Crops are
  chosen so the pictures in a row come out the same height (a picture-first card means every
  picture in a row starts and ends on the same line, whatever the text length). One column
  below 960 px.
- **Crops** (capture pixels, from the 2146 x 1343 captures; x, y, width, height). Start from
  these and adjust by eye:

  | Card | Capture | Crop |
  |---|---|---|
  | Quick on big drawings | detail | 750, 180, 890, 600 |
  | Moves like CAD | site | 1530, 470, 610, 822 (portrait); below 960 px: 1395, 860, 745, 430 |
  | Real-world scale | measure | 536, 470, 1190, 760 |
  | Markup, stamps and signatures | markup | 900, 350, 1190, 760 |
  | Prints to scale | print | 150, 400, 1830, 600 |

- **Export the crops as their own images.** The mockup crops in CSS, which would make a phone
  download every full capture. Write them as WebP files beside the captures, dark and light,
  at about twice their largest displayed size (e.g. `img/crop-markup-dark.webp`), and use
  `<picture>` for the theme (and for the Moves like CAD narrow crop). A small Node script in
  `tools/` that re-cuts them from the captures is better than doing it by hand, so they can be
  regenerated when the captures change. It must not add anything to the published page's
  runtime; a dev dependency is fine if you need one, but say what and why.
- **Detail markers:** a small circle at the top left of each picture, split across the
  middle, with the card number over the total ("1" over "5"), like a drawing's detail
  reference. Text colour line on the card background.
- **Leaders:** on each picture, one accent line from a small label to a dot on the thing the
  card is about. The labels, in mono, white on the accent with its darker border:
  1. "every deck panel, at 221%"
  2. "mini map"
  3. "28.00 m, at 1:100"
  4. "revision cloud"
  5. "A3 on A4, exactly 1:200"

  Check each one is true of its picture. In particular, the measure capture's figure has to
  read 28.00 m at 1:100, and the print capture has to be A3 on A4 at 1:200. If one isn't,
  change the label to what the picture shows. Positions are in percent of the picture, so
  they hold at any width; nudge them until the dot lands on the target in both themes.
- The markers and leaders are decoration: `aria-hidden`, and the image alt text carries the
  meaning.

## 4. Both themes, and buttons to switch them

Reference: the first, draggable split in
[mockups/ideas/h7-themes.html](../mockups/ideas/h7-themes.html). A band of its own, after the
features. Heading along the lines of "Light or dark, it follows Windows.", with a line
saying the app follows the Windows setting and can be set either way.

**The page already follows the system theme** (`prefers-color-scheme` in the stylesheet, and
`<picture>` sources for the screenshots). That stays the default. This band adds a way to
override it.

- **The split:** the hero capture in dark and light, one over the other, divided on a
  diagonal (`clip-path` polygon), with a thin line along the cut and a round handle on it.
  With no script it's a fixed diagonal through the middle: both themes visible, nothing to
  do. With the script, dragging the handle (pointer events, and arrow keys when it has focus,
  as a slider with `role="slider"` and `aria-valuenow`) moves the cut.
- **The buttons:** a two-way segmented control under the split, Dark and Light, with the
  current theme pressed (`aria-pressed`). On load that's whichever the system gave. Either
  one switches the whole page. There's no "match Windows" option: nothing is remembered, so
  a refresh puts the page back on the system theme. They're in the HTML with `hidden` and the
  script reveals them, so a visitor with no script never sees buttons that do nothing.
- **How the override works:**
  - The script sets `data-theme="dark"` or `"light"` on `<html>`.
  - The CSS has the dark token set under
    `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and
    again under `:root[data-theme="dark"]`, with the light set the same way. Write each set
    once if you can (the build could expand it); if not, keep the two copies side by side
    with a comment so they don't drift.
  - `<picture>` sources follow the system, not the attribute, so the script must also switch
    them: set each dark `<source>`'s `media` to `all` or `not all`. That covers every screenshot on the
    page, the new crops included.
  - The `theme-color` meta tags need the same treatment.
- **Not remembered.** The choice lasts for the visit and isn't stored anywhere. The page
  promises no cookies and nothing stored, and that stays literally true.
- One small inline script, no library. The page must still work fully without it.

## 5. Footer as a title block (Matt: "maybe")

Reference: [mockups/ideas/b3-titleblock.html](../mockups/ideas/b3-titleblock.html). Build it
last, in its own commit, so it can be dropped without touching the rest. Matt decides on it
once he's seen the built page.

- A bordered grid of five columns: Project (the name, mark and one-line description, three
  rows tall), then Drawn by (Matt James), Licence (MIT, linked), Scale (1:1), Rev (the
  version from the release); Source (GitHub, release notes); Notices (third-party, also in
  Help > About); Tracking (None); a "NO COOKIES" stamp, rotated a few degrees in the accent
  colour; and a revisions table across the bottom.
- **The revisions table comes from the GitHub releases at build time**, like the download
  button: the latest three published, non-prerelease releases, each with its version, date
  and the first line of its notes (shortened to fit). That needs the list endpoint
  (`/releases`), not `/releases/latest`; the same rules apply (no drafts, no prereleases, a
  failed call must never break the page). On failure, leave the table out and keep the rest
  of the title block. Add tests in `tools/build-site.test.mjs` (or wherever the existing ones
  live) for the parsing and the fallback.
- Keep the current footer's no-tracking sentence about the update check somewhere in it; it's
  a fact people look for.
- Two columns on a phone.

## Drawing nods

The redesign brief allowed one drawing nod on the page (the 97 ms dimension line). Matt has
now picked three things that use them: the dimension line (b1), the detail markers and leaders
(f1), and possibly the title block (b3). That's deliberate. Nothing else should get one: no
grid references, no sheet borders, no drawing-style section headings.

## Comparison table: out for now

Take the comparison section out of the page (and its nav link, if any). It's too big for what
it says, and its rows were picked for being things Vellum does that the others don't, so
they read as arbitrary and flatten real differences (Foxit is clearly better than Acrobat,
and the table can't show it). Four of its cells also still wait on Matt's checks in Windows
Sandbox. It stays in git history (commit aa313df) and in the redesign brief. If it comes
back, Matt will choose the categories by hand; don't reuse the old rows.

## Numbers that will change

The 97 ms headline is being re-measured, and the speed section (and the figures any speed
chart or dimension label would show) may land in a later build. So:

- Build the number band with the current 97 ms and its current caption, but put the figure,
  its unit and its caption in one obvious place (a comment at the top of the band, or values
  filled in at build time like the download button) so changing them is one edit.
- The speed section stays out of this build.

## Out of scope

The speed section, the install section and the closing call to action are unchanged, apart
from following the new spacing where it obviously applies.

## Done looks like

- `site/index.html`, `site/style.css` and any new images and tools rebuilt to this brief;
  `npm run site` builds it and the existing tests pass.
- Dark and light both finished. At 1920 x 1080 the whole hero is on the first screen. Phone
  width works with no page-level sideways scroll, including the hero's window running off
  the edge.
- Contrast checked with APCA in both themes, including the leader labels (white on accent)
  and the muted "ms".
- With no script, the themes band shows a fixed diagonal and no buttons, and the page still
  follows the system theme.
- Committed to `claude/homepage-6e3655` by concern (hero, number band, features and crops,
  themes band, footer last). Not pushed, not merged. `mockups/` stays untracked.
- Matt checks the look himself: tell him the command to open the built page.
