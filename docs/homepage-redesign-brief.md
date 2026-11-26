# Vellum homepage: redesign brief

**Status (26 November 2026): built, then largely replaced** by
[homepage-layout-brief.md](homepage-layout-brief.md): the stats strip (and its 97 ms), the
features grid and the comparison table here were changed or dropped there. Its speed section
was never built ([backlog.md](backlog.md), "Homepage").

Follows [homepage-brief.md](homepage-brief.md). Everything there still stands (relative paths,
no third-party requests, no client-side JavaScript needed, the download-button build, APCA,
UK English, phone width, the Pages workflow) unless this file changes it. Only the look and
the section order change, plus a new comparison section.

## Why

Matt's verdict on the first build: too basic. A centred logo and title, one screenshot and six
identical cards on a flat background read as a template and say nothing about drawings. He
wants a polished product page. A "the whole page is a drawing sheet" direction was mocked up
and rejected as pastiche.

## The agreed direction

The reference is `mockups/2-dark.html` (never in git, and deleted on
26 November 2026 once the page was built; it
loads the screenshots from `../site-dist/img/`, so run `npm run site` first and open it in a
real browser, not the preview pane). Treat it as a sketch of layout and tone, not finished CSS.
Take from it:

1. **Sticky nav**: mark and name left; Features, Install, GitHub links and a small Download
   button right. Blurred translucent background. On a phone, only the mark and the button.
2. **Hero**: a pill linking to the release notes ("New in 0.2.0: markup, measuring and
   signatures"; built from the release like the button), the headline **"Built for drawings,
   not documents."**, the lede "A fast PDF and image viewer for stage plans, site layouts and
   scanned blueprints.", the download button plus a secondary "See what it does" button, and
   the meta line (Free · Windows 10 and 11 · size · keeps itself up to date). A soft teal
   radial glow and a faint grid that fades out behind the headline.
3. **Hero screenshot flat.** No perspective tilt, no fade mask: the drawing's linework is the
   point and must not be skewed. A large soft drop shadow is fine.
4. **Stats strip** of three: **97 ms** (sharp at 1600% on the heaviest real drawing tested),
   **1:200** (prints to a real scale, read from the title block), **0** (accounts, cookies or
   analytics). The 97 ms figure gets the one drawing nod on the page: a dimension line under
   the number, end ticks plus oblique 45° slashes, in the accent colour (see `.dimn` in the
   mockup). Nowhere else.
5. **Features as a bento grid**: one large card (Quick on big drawings, detail screenshot), two
   small (Moves like CAD, Real-world scale), two half-width (Markup, stamps and signatures;
   Prints to scale). Screenshots cropped inside the cards from the top-left so the toolbar
   shows. Images-too goes into the line under the grid with the map credits. Keep the existing
   copy where the mockup shortened it carelessly; tighten, don't lose facts.
6. **Comparison table** (new, below).
7. **Speed comparison** (new, below): a slot for a chart. The numbers are being measured now
   by another session; build the section once they arrive (they'll be sent to you), not with
   invented figures.
8. **Install**: "Windows will warn you the first time", the two steps as numbered cards, the
   reassurance line, the SmartScreen image. `smartscreen.webp` stays a placeholder until Matt
   captures it.
9. **Closing call to action**: icon with a teal glow, "Open your next drawing in Vellum.", the
   who-made-it line (Matt James, opens site and venue drawings for a living, free and open
   source), the download button.
10. **Footer**: source, MIT licence, third-party notices, the no-tracking line.

### Both themes

The mockup is dark only. The page still follows the system theme. Design dark first (it's the
showcase), then make a light set that is equally deliberate: not an inverted afterthought. Use
the `*-light.webp` screenshots there. Re-check contrast with APCA in both.

## Comparison table

Heading "How it compares." Free editions on Windows, checked November 2026. Columns: Vellum
(highlighted), Acrobat Reader, Foxit Reader, PDF-XChange, SumatraPDF, Edge, Chrome. Marks: yes
(filled accent dot with a tick), partly (half-filled), no (a dim dash). Every "partly" carries
its reason: on hover is not enough for touch or screen readers, so give it real text too
(footnote numbers, or visually hidden text plus a visible short note; your call). On a phone
the table scrolls sideways inside its own box with the feature column sticky; the page itself
never scrolls sideways.

| Row (subtitle) | Vellum | Acrobat Reader | Foxit Reader | PDF-XChange | SumatraPDF | Edge | Chrome |
|---|---|---|---|---|---|---|---|
| Wheel zooms at the cursor (no Ctrl, no tool to switch to) | yes | partly: Hand tool only | partly: Hand tool only | no | partly: right button held plus wheel | no | no |
| Middle-drag pans (like CAD, not autoscroll) | yes | no | no | no | no | no | no |
| Reads the scale off the drawing (from the title block, nothing to calibrate) | yes | partly: only scale data stored in the PDF, if turned on | partly: same as Acrobat | **unverified** | no | no | no |
| Measures in real units | yes | yes | yes | yes | no | no | no |
| Prints at a true scale (1:200, not a percentage) | yes | partly: percentage only | partly: percentage only | partly: percentage only | no | partly: percentage only | partly: percentage only |
| Tiled printing with cut marks | yes | yes | yes | yes | no | no | no |
| Writes markups into the PDF (clouds, arrows, text and stamps, as standard annotations anyone can see) | yes | yes | yes | yes | partly: no clouds, no drawn signature | partly: pen, highlighter and text only | partly: pen and text only, may be flattened into the page |
| Opens TIFF, PNG and JPEG (as a drawing, however big) | yes | no | no | partly: converts to PDF first | yes | partly: PNG and JPEG as a browser image | partly: PNG and JPEG as a browser image |

**Not publishable until Matt checks these by hand** (he will, in Windows Sandbox): PDF-XChange's
scale cell; whether Acrobat Reader still has the Hand-tool wheel-zoom setting; whether
PDF-XChange's free mode watermarks measurements, stamps or signatures; whether Reader's new
interface still has the cloud tool. Mark these cells in the HTML with a comment so they're easy
to find. SumatraPDF 3.7 (in pre-release) adds measuring; re-check before each release.

Rows deliberately left out because every viewer ties: no account needed, stamps and
signatures.

## Speed comparison (when the numbers arrive)

Measured from outside every app the same way (screen recording, frame where the picture stops
changing), so Vellum's own internal timings are not mixed in. Two measures per drawing: open to
a sharp first page, and zoom to 1600% to sharp. Matt wants the result published even where
Vellum doesn't win (Foxit is expected to be quicker on some vector drawings): an honest chart
is more believable. Horizontal bars, one group per measure, Vellum in the accent colour and the
rest neutral, values in mono with units, a one-line note on the machine and method. Plain HTML
and CSS bars, no chart library, no script.

Note: the Adobe figures come from full Acrobat (same rendering engine as Reader), because
Reader can't sit alongside Matt's Acrobat install. Label the bar "Adobe Acrobat" and say so in
the method note.

## Done looks like

- `site/index.html` and `site/style.css` rebuilt to this brief; `npm run site` builds it.
- Dark and light both finished; phone width works with no page-level sideways scroll.
- The comparison table in, with the unverified cells commented.
- The speed section in once the numbers arrive (until then, leave it out rather than stub it).
- `mockups/` deleted or left untracked; don't commit it.
- Committed to `claude/homepage-6e3655` by concern. Not pushed, not merged.
- Matt checks the look himself: tell him the command to open the built page in his browser.
