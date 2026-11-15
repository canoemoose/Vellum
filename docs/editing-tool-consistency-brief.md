# Tool consistency and behaviour: modification brief

Status: **agreed with Matt on 15 November 2026; being built on `editing`.** Done: stages 1 to 7 and 9.
Parent:
[editing-scope.md](editing-scope.md). The markup tools were built by four sessions in
parallel (groundwork, phases 4, 5, 7a, then 7b), so the same gesture behaves differently
from tool to tool, and some tools needed rethinking once Matt had used them. This brief is
every change agreed, in the order to build them.

Tags in brackets (D6, A11, O3) are the item numbers from the discussion, kept so a decision
can be traced back.

## How this gets built

- **One Opus session, working autonomously, using subagents** for the parts that can run
  side by side.
- Branch `editing`. Commit as each stage is done, split by concern. **No push, nothing to
  `main`, no tags or releases.**
- Stages 1 to 3 change the shared code every later stage builds on (`engine/markupTool.ts`,
  `markup/tools.ts`, `App.svelte`, `components/PropertiesStrip.svelte`, `markup/prefs.ts`),
  so do them first and in order, in the main session.
- Stages 4 to 9 are largely separate and are the ones to hand to subagents. Two writers
  must never be in the same file at once. The files that several stages want are
  `engine/markupTool.ts`, `App.svelte`, `PropertiesStrip.svelte` and the Rust writer
  (`src-tauri/src/annot/`): give each subagent its own files (a kind's file, a new module)
  and keep the joins in those shared files for the main session, or run those stages one
  after another.
- Stage 10 is last and belongs to the main session.
- Update this file's status line and tick stages off as they land. Record anything a stage
  could not do, or did differently, under that stage.

Constraints carried from the earlier phases:

- Client drawings in `test-files` are read-only: never copied into the repo, nothing
  derived from them committed.
- A signature's image or strokes must never be readable outside the encrypted library: not
  on disk, in logs, settings, fixtures, the repo, or the system clipboard (stage 9). Don't
  read, copy or change Matt's real signature library or settings: scripted runs set
  `WEBVIEW2_USER_DATA_FOLDER` and `VELLUM_DATA_DIR` to scratch folders.
- Matt checks everything visual himself. Don't build screenshot harnesses. Do run the app
  to catch crashes; a green build is not "tested".
- On this machine every cargo or tauri command needs `source ~/.vellum-toolchain/env.sh`
  first.
- UK English in UI text, docs and comments. Log strings ASCII only. Em-dashes sparingly in
  UI copy.

## The rules

These are what the changes below add up to. Where a case isn't listed, follow the rule.

1. **One gesture, one behaviour.** Tools that share a gesture behave identically in it:
   same Shift, same minimum size, same ways to finish. A kind chooses a gesture; it
   doesn't adjust it.
2. **Shift toggles the lock.** Every tool that draws or drags a line or a box has a lock:
   straight or ortho for lines, square for a box being drawn, proportions kept for a box
   being resized, 15° steps for rotating. Most tools start unlocked and Shift locks;
   dimensions start locked and Shift frees them.
3. **Typing tools end the same way.** Esc, Ctrl+Enter or a click elsewhere finishes, and
   that click does nothing else.
4. **Tooltips are written per gesture,** not per tool.
5. **A tool stays armed after use only if you'd use it again straight away.**
6. **The context bar shows only controls that do something** for the tool or selection.
7. **Every control in the context bar changes the selection, and each tool remembers its
   own last settings.** A tool's remembered settings change when you set them with the
   tool out, or restyle the markup that tool has just drawn (still selected from drawing
   it). Restyling an older markup changes that markup only.
8. **Shortcut letters:** variants of one thing share a letter; different things get their
   own. A shared letter picks the tool last used in that family; pressing again steps;
   Shift+letter steps back.
9. **If PDF has no way to say it, don't build it.**

## Stage 1: gestures and Shift ✓

Rules 1 to 5. Where: `engine/markupTool.ts`, `markup/tools.ts`, `markup/shape.ts`,
`engine/input.ts`.

- **Shift everywhere** [D1]. Pen and highlighter both draw straight with Shift. Every
  line or box gesture honours rule 2.
- **Line and Arrow can be clicked out** as well as dragged, as Length can [D7].
- **Shift squares a dragged box** for Polygon (see stage 6), Cloud and Area [D7].
- **One minimum size** for every dragged box: under 4 px either way makes nothing [D7].
- **Finish and cancel by mouse** [D10]. For every click-out tool (polyline, polygon,
  cloud, polyline length, area): right-click opens a three-line menu at the pointer:
  Finish, Remove last point, Cancel. Backspace removes the last point, and so does Ctrl+Z
  while a shape is being clicked out (today it undoes the previous markup). Uses the
  existing context menu in `App.svelte`.
- **Typing tools** [D2, D7]. Clicking away from a note ends typing and doesn't place
  another. An empty note or callout is kept, so it can be filled in later. An empty text
  box is kept if it has a border or fill, and discarded only when nothing would show it's
  there. Where: `components/NoteLayer.svelte`, `components/TextEditor.svelte`.
- **Calibrate goes back** [D3]. After calibrating or cancelling, return to the measuring
  tool that was out before, else Length. Where: `App.svelte` (`applyCalibration`).
- **Tooltips from the gesture** [D7]. The how-to text comes from the gesture, with a test
  that tools sharing a gesture read the same.

Already consistent, keep it so: every tool selects what it just drew and stays in the
tool; Esc abandons a half-clicked shape, then returns to Select, then clears the
selection; switching tools abandons a half-clicked shape; double-click to edit works only
from Select, for text boxes, callouts and notes alike.

Built (as done):

- The "line" gesture is gone: Arrow and Line draw with the clicked-points gesture, two
  points at most, as Length does. A drag too small to count is now taken as a click (it
  starts clicking out the shape) rather than making nothing.
- The gesture's lock lives in one function (`lockTo` in `engine/markupTool.ts`); a kind
  sets `lock: "ortho"` to start locked (stage 5 uses it).
- A text box clicked rather than dragged: a drag under 4 px either way makes the clicked
  box (was 8 px both ways).
- Rule 3 applies in Select too: a click away from a text box being edited (opened with a
  double-click) ends the typing and doesn't select anything. The note editor hands its
  "end typing" to the markup tool (`typingElsewhere`), so the click that ends it never
  places another note.
- Tooltips: `gestureTip` in `markup/tools.ts`; a tool adds only `before` ("pick a stamp")
  or `after` (Calibrate's "then type its real length", the note's double-click). The
  callout and the angle carry `say`, the wording of what their clicks mean.
- The Edit menu's Undo also takes back a point while a shape is being clicked out.

## Stage 2: shortcut letters ✓

Rule 8 [O2]. Where: `markup/tools.ts` (`key`, `toolForKey`, `toolTip`), the key handler
in `App.svelte`, the F1 list, `tools.test.ts` (its "view's own letters" test changes).

| Key | Tool |
|---|---|
| V | Select |
| A | Arrow |
| L | Line, Polyline |
| R | Rectangle |
| E | Ellipse |
| C | Revision cloud |
| G | Polygon |
| T | Text box, Callout, Note |
| P | Pen |
| H | Highlighter; with text selected, highlights it [D15] |
| D | Length, Polyline length, Area, Angle |
| S | Stamp, Signature |
| I | Image (stage 8) |
| [ and ] | Rotate the view anticlockwise, clockwise (was R) |

- Arrow is on A only, not in the L cycle.
- Calibrate has no letter; it stays on the Measure flyout and the menu.
- M is left unused. N still switches navigation.
- Pen on P, Polygon on G, and Ellipse and Cloud staying on E and C were shown to Matt
  without objection; his to change.
- Tooltips and the F1 shortcuts list are generated from the table, so they can't drift.

Built (as done): the last tool used per letter is remembered between runs
(`settings.markup.lastForKey`). The F1 list has one line per letter ("Line or Polyline
tool: the one last used; L again for the next, Shift+L for the one before"), so a tool no
longer reads "L twice". The palette's flyout shows Calibrate without a letter.

## Stage 3: the context bar and what tools remember ✓

Rules 6 and 7. Where: `App.svelte` (`strip`, `measureStrip`, `stripStyle`, `stampsOnly`),
`components/PropertiesStrip.svelte`, `markup/prefs.ts`, `markup/measurements.ts`.

- **Stamps show no dead controls** [D4]. With a stamp or signature selected in Select the
  bar shows colour, opacity and weight, none of which do anything. Cause: `stampsOnly`
  returns on the tool before it ever looks at the selection. (What a stamp's bar does
  offer is stage 8.)
- **Calibrate has no bar** [A2].
- **Highlighter loses line pattern** [A7].
- **Line is just a line** [A1, D15]. No ends control for the Line tool or a selected line.
  Arrow no longer offers "None" at both ends, so neither turns into the other. Polyline
  keeps its ends control (a bent leader has no other tool).
- **Several kinds selected** [A8]: show only the controls they all have.
- **Dropdowns that say everything twice** [D8]. Decimal places and units show each choice
  as a sample and again as its label ("2 decimals" twice). The sample shows the effect
  ("12.40"), the label names it (`DECIMAL_OPTS`, `UNIT_OPTS`, `wordSample`). Check every
  other dropdown in the bar for the same.
- **Units and decimals change the selection** [A4], like every other control, and the
  tool remembers them. Today `reformat` rewrites every measurement in the file. "Apply to
  all measurements" goes on the right-click menu for the rare case.
- **Each tool remembers its own style** [A3, A5]. The measuring tools already do; leave
  them (linear and area dimensions may want different colours). Text box and callout
  stop sharing one text style: `settings.markup.text` splits per tool, existing settings
  carried over to both.
- **Restyling an old markup doesn't change the tool** [A6]: rule 7.

Built (as done):

- Which controls show is one pure function, `barFor` in `markup/bar.ts`, for a tool or a
  selection (the intersection). A kind with `noBar` (Calibrate; stamps until stage 8) gets
  no bar; `controls.pattern: false` drops the pattern alone (the highlighter).
- An arrow's ends: whichever end is "None", the other end's list leaves "None" out.
- Rule 7 is "remember only with a tool out": with a tool out the selection can only be
  what it just drew (switching tools clears it), so in Select nothing is remembered.
- The measuring tools share one remembered format and label size, as before (all five
  tools are one family); only the per-selection change is new. The file-wide re-format on
  every format change is gone; "Apply its units and decimals to all measurements" is on the
  canvas right-click menu with a measurement selected.
- Dropdowns: units list a length written that way ("1240 mm") beside the name
  ("Millimetres"); decimals a number ("12.40") beside "2 decimal places". The box shows the
  short form ("mm", "0.00"). The other dropdowns (font, size, spacing, pattern, ends, label
  size) already show a picture beside a name.
- Text markups (highlight, underline, strike) still remember a variant's colour when one
  just made is restyled, as before; their "tool" is the text selection.

## Stage 4: the arrowhead ✓

- **A filled arrowhead doesn't meet its line** [D14]. Cause: the line is stopped half a
  line weight short of the head's base and relies on a round line end to bridge the gap
  (`lineEnd` in `markup/draw.ts`, "filled": `back: len * Math.cos(HEAD_ANGLE) + width / 2`).
  A round end only touches the base at its middle; a flat end doesn't reach at all.
  Change: the line ends flat exactly on the head's base, at every weight and opacity, on
  screen and in the saved file. Check the dot end for the same. Matt confirms by eye.

Built differently: the line keeps its round end where it stopped (half a weight short of
the base); the filled head instead reaches back to it with a neck the line's width, less
the half disc the round end fills. Same look as a flat end on the base, with no gap at
the corners and no overlap at any opacity, and patterned lines keep their round dashes.
The dot had the same fault (the line's round end ran inside it): it now leaves that bite
out, as a hole wound the other way. Tested by area in `markup/arrowhead.test.ts`. One
thing to look for by eye: a faint seam where the line meets the head, from anti-aliasing
two shapes edge to edge.

## Stage 5: dimensions ✓

Where: `markup/kinds/measure*.ts`, `markup/measure.ts`, `markup/dimension.ts`,
`markup/measurements.ts`, the Rust writer and reader for the saved keys.

- **Ortho-locked by default; Shift frees** [D6]. Ortho is horizontal or vertical on the
  page. The view only ever turns by quarter turns, so it's the same lines either way.
  Calibrate is ortho-locked too.
- **Placed the CAD way** [D6]: click, click, then a third click sets how far the dimension
  line sits from its points, with extension lines back to them. A third click on the
  points leaves it in line.
- **The value** [D6] sits above the line, or to its right on a vertical one, and reads
  from the bottom or the right of the page in its own orientation, so the saved file is
  right for the next reader. Its grip moves it along and off the line; double-click the
  grip puts it back. On polyline length and area the value moves; there's no line to pull
  out.
- **Ends** [D15]: bars, ticks or arrows, in the context bar.
- **Font** [D6]: Courier, Courier Bold or Helvetica for the value (all three are written
  without embedding), as one setting. Matt picks by eye on a real sheet, so make it easy
  to switch.
- **Saved with the standard keys** [D6]: `/LL`, `/LLE`, `/LLO` for the pulled-out line,
  `/CO` for the moved value, so other apps draw the same thing.
- **Angle: corner first** [D9]. Click the corner, then each arm. The first arm is
  ortho-locked, the second free. Where: `kinds/measureAngle.ts`.
- **Imperial** [A9]. Values are held in millimetres; only the text changes.
  - "Auto" follows View > Units. In an imperial view it is feet and inches with fractions.
  - The units dropdown gains four entries beside "mm" and "m": feet and inches with
    fractions (12' 4 1/2"), inches with fractions (148 1/2"), decimal feet (12.38 ft) and
    decimal inches (148.50 in).
  - With a fractional entry the decimals control becomes precision, 1/2" to 1/64" (Matt
    asked for 1/32" at least). Fractions reduce (16/32" reads 1/2").
  - Areas in ft². Angles unaffected.
  - The scale box accepts architectural scales (1/4" = 1'-0", which is 1:48) and shows
    them that way in an imperial view. Calibrate accepts a distance typed in either
    system.
- **A measurement pasted onto a page with another scale** takes that page's scale at once
  [A14]. `revalue` exists; make sure paste goes through it.

Built (as done), dimensions: each clicked point has its own lock (`Draw.lock` takes a list
of per-point locks, each optionally from a named earlier point; `lockTo` is still the one
place it's applied), and the tooltip names the locked click. Length, Polyline length, Area
and Calibrate start level or upright (Polyline length and Area chosen too: runs and rooms on
plans are mostly square); the angle's first arm does and its second is free (Shift snaps it
from the corner). Dragging a Length's end grip is ortho-locked as well. Length takes three
clicks: the third sets the offset; on the points (within a grip's reach), a double-click on
the second point, or a drag leaves it in line. While clicking, the measuring tools show the
shape itself (`preview`), not a rubber band. The value sits above the line, or right of an
exactly vertical one (a near-vertical line keeps it above), reading from the bottom or the
right of the page as rotated by /Rotate. Length, Polyline length and Area have a value grip
(double-click puts it back, `KindDef.resetHandle`); Length also has a grip that pulls the
dimension line out. Ends (bars, 45° ticks at double weight, filled arrows) and the value
font (Helvetica, Courier, Courier Bold) are per measurement, in a "Dimension" section of the
bar, remembered in `settings.measure.look`. Saved: /LE, /LL, /LLE, /LLO (gap 2 pt, overrun
3 pt) and /CO, written for every Length so other apps put the caption where Vellum's value
is; the /LL sign follows poppler (LL on the anticlockwise normal of /L), which differs from
a literal reading of the spec: check in Acrobat. A file's Line with /IT /LineDimension now
reads in as a Length. Angles are clicked corner first but stored in the old order. Paste
already goes through `revalue` (tested). Measurements from before draw exactly as they did.

Built (as done), Imperial [A9]: `markup/imperial.ts` writes and reads feet and inches. With
a fractional unit the decimals control becomes Precision, 1/2" to 1/64" (default 1/16");
fractions reduce and rounding carries (11' 11 63/64" at 1/32" reads 12' 0"). Areas in ft²
(two decimals where the control is a precision). Auto is resolved when the text is made:
each measurement carries the view's system (`fmt.system`), and App rewrites Auto ones in
place, with no undo step, when View > Units changes, so drawing stays pure (this marks the
file changed, as a scale change does). Auto in an imperial view is feet and inches from a
foot up and inches below (6 1/2", not 0' 6 1/2"), decided on the rounded value. Halves now
round away from zero after unit conversion, metric too (12.375 ft reads 12.38). The scale
box reads 1/4" = 1'-0" and 1" = 20' (held as a ratio), shows them that way in an imperial
view with architectural and engineering presets; the status bar, readouts and `/R` follow.
Calibrate takes either system; a bare number is still millimetres. The saved `/Measure`
writes feet and inches as whole feet (`/F /T`) then inches as a fraction (`/F /F`, `/D` the
denominator), and areas as sq ft (not checked in Acrobat). Paper read-outs stay in mm.

## Stage 6: shapes ✓

- **Polygon: drag with Sides** [D11].
  - Dragging with Polygon makes a regular polygon, from the centre out, turning to follow
    the pointer; Shift locks a flat side to the bottom.
  - "Sides" (3 to 12) in the context bar, default 6, remembered. It still works on the
    shape afterwards until a corner is dragged, when the shape becomes freeform and Sides
    goes.
  - Keeping it apart from Rectangle: Rectangle is corner to corner, any proportion;
    Polygon is centre out, equal sides. The tooltips say "drag corner to corner" and "drag
    from the centre".
  - Clicking out a freeform polygon is unchanged. Cloud and Area keep dragging a
    rectangle.
- **A bounding box to resize by** [A11]. A selected polygon, cloud, polyline, area or
  polyline length shows a box with eight grips, as a pen stroke does today, as well as its
  corner grips. Box grips are square and sit on the box; corner grips are round and sit on
  the shape. Shift keeps proportions.
- **Adding and removing corners** [A11]: double-click an edge adds a corner; the
  right-click menu on a corner removes it.

Built (as done): Polygon's drag is a gesture option (`drag: "regular"`): a corner on the
pointer, Shift a flat side at the bottom as viewed (down worked out from the viewer, so it
follows the quarter turns). Sides is remembered per tool (`settings.markup.sides`) and
changes a selected regular polygon in one undo step, keeping centre, size and turn. The
regular parameters ride only in Vellum's saved copy (`/Vertices` unchanged) and count only
while they match the corners, so older and foreign polygons load freeform. A polygon also
goes freeform when a corner is added or removed or its box is stretched out of proportion
(moving or a Shift resize keeps it regular). The five shapes of points use `pointGrips` /
`dragPointGrip` (`markup/shape.ts`): round corner grips, the box's eight square grips and a
dashed outline; Shift keeps proportions from side grips too; where a corner sits on a box
grip the corner wins. Corners (`markup/corners.ts`, chosen by gesture: points with no fixed
count) never go below 3 closed or 2 open. The pen keeps its four corner grips (the brief's
"eight, as a pen stroke does" was not quite what the pen has).

## Stage 7: notes ✓

- **Notes can stay open** [D12]. A note has a pin: unpinned it's an icon you hover; pinned
  its text shows in a small box beside the icon. Saved as the standard open pop-up
  (`/Open`), so other apps show it open too. Pop-ups don't print; a callout is the tool
  for text that must print.

Built (as done): a note has `pinned`. The pin is in the note editor's header (the editor
opens on every new note), and the pinned box has an unpin pin; there is no context-bar
control. Each pin or unpin is one undo step on that note; new notes start unpinned. The
pinned box is HTML beside the icon's on-screen extent: upright at any view rotation, a fixed
size on screen (up to 200 × 140 px), its left border in the note's colour, hidden while the
note's editor is open. It takes the pointer only in Select (a click opens the editor); with
any other tool out, drawing goes through it. Every note is written with a Popup annotation
(/Parent, /Rect 200 × 120 pt beside the icon, /Open when pinned, /F NoZoom and NoRotate,
never Print) at the end of /Annots, with the note's /Popup pointing to it; unpinned notes
get a closed one, so pinning only changes /Open. Replacing a note updates its pop-up (or
adds one); deleting removes it and any Popup naming the note as parent; reading takes the
pin from /Open. Hiding a note in PDFium hides its linked pop-up, so a saved pinned note
isn't drawn twice (the thumbnails and mini map may still show PDFium's open pop-up).

## Stage 8: stamps, signatures and images

- **Rotate handles** [D5] on stamps, signatures and images: Shift steps by 15°; resizing
  works in the stamp's own frame. Overrides phase 5's "no stamp rotation".
- **A new one starts upright as viewed** [A16]. Today, placed while the view is turned, it
  comes out sideways. Text boxes can't follow (see "Not built"); they stay upright on the
  page.
- **An Image tool** [D13] in the toolbar, in the Stamp group after Signature, letter I:
  pick a file, then click to place or drag to size. Nothing is added to the stamp library.
  Phase 5 already built the drawing, the saved image with transparency, and sizing.
  Anything over 2000 px on its long side is scaled down on the way in. Dropping an image
  file on the window still opens it as a document.
- **Pickers in the context bar** [O3]. Matt: "probably, I'd need to see it". Build it so
  he can, and keep the popouts working behind `VELLUM_STAMP_POPOUTS=1` until he's chosen.
  - Stamp tool out: "Stamp: APPROVED ▾", the date line toggle and colour. The dropdown
    lists the stamps with a small preview each, styled like the tool flyouts.
  - Signature tool out: "Signature: (thumbnail) ▾", with "New signature…" at the bottom.
    Drawing a new one still opens its dialog; only the choosing moves.
  - One placed and selected: the same bar, so a text stamp's colour can be changed after
    placing. Opacity is offered for both, and made to work.
  - The tool remembers the last stamp or signature, so picking the tool goes straight to
    placing.

## Stage 9: selecting, copying and pasting ✓

Where: `engine/markupTool.ts` (`clipboard`), the key handler and menus in `App.svelte`.

- **Cut** (Ctrl+X) [A12].
- **Select all** [A12]: Ctrl+A selects the page's markups when a markup is already
  selected or a markup tool is out; otherwise it selects text as now.
- **Paste at the pointer** [A13]: the middle of the copied markups lands on the pointer;
  with the pointer off the page (menu or keyboard), the middle of the view.
- **The system clipboard** [A15]. Today the markup clipboard is a private array. Copying
  markups puts them on the system clipboard in Vellum's own format instead. Then there is
  one clipboard: whatever was copied last, anywhere, is what Ctrl+V pastes (markups, or a
  picture as an Image markup [D13]), and markups paste between Vellum windows. Other apps
  ignore the format. Confirm in the app that Windows' clipboard history (Win+V) doesn't
  keep it.
  - **Signatures are the exception.** A signature's image never goes on the system
    clipboard. A copied signature travels as a reference that only the running app that
    copied it can resolve; pasted into another Vellum window it is skipped with a message.

Built (as done):

- `src-tauri/src/clipboard.rs` puts markups on Windows' clipboard in a registered format
  ("Vellum.Markups.v1", JSON), with the three standard formats that keep it out of
  clipboard history and the cloud clipboard ("ExcludeClipboardContentFromMonitorProcessing",
  "CanIncludeInClipboardHistory" 0, "CanUploadToCloudClipboard" 0). Reading takes Vellum's
  format first, else a picture ("PNG", else CF_DIB), scaled to 2000 px on its long side.
- `markup/clip.ts` writes and reads the JSON: a signature is only `{signature: ref, page,
  bounds}`; the markup itself stays in the copying tool's memory under a per-run id. What's
  read back is checked as a saved copy is (known kind, a style, a box); anything else is
  skipped.
- Ctrl+A with a drawing tool out switches to Select first (a drawing tool's selection is
  only what it just drew, rule 7), then selects the page's markups. The Edit menu has
  "Select all markups on the page" beside the text one, and "Cut markups".
- The Edit menu's Paste lands in the middle of the view; Ctrl+V at the pointer when it's on
  a page.
- The real clipboard isn't touched by any test (it's Matt's): Win+V and pasting between
  two windows are on the list to check by eye.

## Stage 10: checks, docs and hand-over

- **Check in the running app** [A17]: the note icon and its pinned text stay upright as
  viewed; the regular polygon's "flat side at the bottom" follows the view; the F1 list
  includes every tool.
- **View > Units** [A9]: the menu's wording now matches what it does (it sets measuring's
  Auto as well as paper sizes and read-outs).
- Update [editing-scope.md](editing-scope.md), the phase scope files this overrides
  (phase 4: metric only, file-wide format; phase 5: no rotation, the popouts), and the
  shortcut letters wherever the docs list them.
- Type check, all Vitest and cargo tests, a release build, and launch it on a file.
- Hand over in plain terms: what's covered by tests, what isn't, and the list of things
  for Matt to check by eye, stage by stage.

## Not built

By rule 9, checked against the standard on 15 November:

| Markup | Rotates? | Why |
|---|---|---|
| Stamp, signature, image | **Yes** (stage 8) | A stamp is its drawn appearance; editors don't redraw it. |
| Line, arrow, polyline, polygon, cloud, pen, highlighter | Could (rotate the points) | Not asked for. |
| Rectangle | No | A Square is an upright box. Saving a rotated one as a polygon would make two ways to draw a rectangle. |
| Ellipse | No | A Circle is an upright box. |
| Text box, callout | No | ISO 32000-2's free text table has no rotation entry. Acrobat's quarter turns are its own key, and reports say rotation is lost when another app edits the box. |

Also not built: dragging an image file onto a page as markup.

## Later: a preferences panel

Matt: "At some point we're going to have to bite the bullet and make a separate
preferences panel." Not part of this brief. Things decided here that are settings without
a proper home, and would move there:

- The dimension font (stage 5).
- Default units, decimals or fraction precision for new measurements.
- Whether dimensions start ortho-locked, if that ever needs turning off.
- Each tool's remembered style, with a way to reset it.
- The image size limit.

Until it exists, each of these is remembered from last use or fixed, and nothing new goes
in a menu just to give it somewhere to live.

## Testing

Each rule gets a Vitest test written against the gesture, not the kind, so a new kind
can't opt out. Shortcut letters, tooltips and the F1 list are tested from the one table.
Rotation, dimension geometry, regular polygons and imperial formatting (fractions,
reduction, architectural scales) are pure maths and fully testable. The saved keys are
checked in cargo tests and by PDFium drawing them. Feel, handle placement, the dimension
font, the pickers, and how other apps show the saved files are Matt's to check.
