# The edit lock, the Markups list and measurement numbers: modification brief

Status: **agreed with Matt on 16 November 2026; all eight steps built on `editing`, 16 November
(one session, autonomous). Awaiting Matt's look: see "For Matt to check" at the end.** Nothing
in it is open. For the 0.2.0 markup release, after `0.2.0-rc1`.
Parent: [editing-scope.md](editing-scope.md), "The edit lock". Came out of the backlog item
"The markup toolbar: move the padlock, and go through the tools' order".

## What the lock is

**It is the file's lock, not a tool's** (Matt). Today it guards the annotations that came
with the file. When page operations are built (phase 8) it will guard reordering, adding
and deleting pages too. Every decision below follows from that: it belongs with the
document's controls, not with Select or the markup tools.

## Decided

### The tool order stays

Draw, then write, which is the order people expect (Matt): Select, Lines, Shapes, Text,
Pen, Measure, Stamp, with the flyouts as they are (Rectangle, Ellipse, Polygon, Revision
cloud; Pen, Highlighter). Ideas considered and dropped: Text ahead of Lines, Revision cloud
first in Shapes, Highlighter with the Text tools.

The navigation mode toggle stays prominent in the toolbar's right zone: the mode changes
by itself from file to file, so it has to be visible at a glance (Matt). It is not a
candidate for the status bar or a preferences panel.

### 1. The switch: its own block, on the left ✓

- The padlock leaves the markup tools. Beside them it read as switching the tools on,
  which is the one danger to avoid: drawing a new markup never needs the lock.
- It is an "Edit file" switch in a block of its own in the toolbar's left zone, after the
  page layout buttons: padlock icon, the label, a small switch (accent when unlocked).
- Not beside the navigation mode toggle either (where it effectively was): two unrelated
  switches side by side.
- Wording is "Edit file" throughout: the switch, its tooltip, the unlock question, the
  Markups list's tooltip on a locked row, and the menu ("Unlock file…", "Lock file").
- This is the only control that locks again.

Built in `components/EditLock.svelte`, `components/Toolbar.svelte` (a `lock` snippet after
page layout), `App.svelte`, `components/MarkupsList.svelte`. Committed as built. Matt has not
yet said it looks right: level with and the same height as the groups beside it; whether the
label earns its width on a narrow window; whether the off state shows.

### 2. Unlock where you hit it ✓

A markup that came with the file can be selected while the file is locked, and shows a
padlock on its selection in place of grips. Clicking the padlock, or trying to drag the
markup, asks the same unlock question the switch does; on "Unlock" the file unlocks and the
markup stays selected, ready to change.

- Today a locked markup can't be picked at all (`MarkupDoc.editable`, and the checks on it
  in `engine/markupTool.ts`: picking, marquee, select all, cut, delete). The change is to
  picking only: a click selects it; it still can't be moved, restyled, cut or deleted, a
  marquee and select all still leave it out, and the context bar shows nothing for it
  beyond saying it came with the file.
- A file with no warnings unlocks without a question today (`unlockWarnings` in
  `shell/save.ts`); from the padlock or a drag it should always ask, briefly, since the
  user didn't go to the switch on purpose. Wording: "This markup came with the file. Unlock
  the file to change it?" with the same warnings added when there are any.
- The Markups list's locked rows pick the markup in the same way.
- When page operations arrive, dragging a thumbnail does the same. Not built now; say so in
  the scope.
- For Matt to judge once built: whether the padlock on the selection is obvious enough, or
  a first-time user just thinks the markup is stuck.

Built: `MarkupTool.select` no longer filters by the lock and `topAt` picks anything; every
change path skips what the lock keeps instead (`selectedChangeable`: restyle and its live
preview, delete, cut, nudge, sides, turning, the measuring and dimension controls, stamp
changes), so a mixed selection changes only its free markups. A restyle that changes nothing
records no undo step. The padlock is drawn just out from the top-right corner of the
selection's box as shown, on an accent disc with a darker rim, the box dashed. What asks:
clicking the padlock, starting a drag on the markup, and (added) double-clicking a locked text
box or note to type into it. A plain click asks nothing. The context bar shows only a label,
"Rectangle, in the file: locked" ("3 markups, in the file: locked" for several), with no
controls. Locking again keeps the selection (it shows the padlock) rather than dropping it, as
it did before. The Markups list's locked rows pick in the same way (they go through the same
`select`).

### 3. Indicators, status only ✓

- **Status bar:** an open padlock and "File unlocked" while the active file is unlocked.
- **Tab:** a small open padlock on the tab of any unlocked file, so it shows across several
  open files.
- Both show only while unlocked (locked is the normal state), and neither does anything
  when clicked: the switch is the one place to lock again.

Where: `components/StatusBar.svelte`, the tab strip component, fed from each tab's
`marks.unlocked` in `App.svelte`.

Built: the status bar's "File unlocked" sits before the cursor position, in the accent text
colour, with a tooltip saying what it means and that Edit file locks it. The tab's padlock (12
px, accent text colour) sits after the title, before the unsaved-markups dot. The tab strip is
`components/TitleBar.svelte`.

### 4. The menu ✓

Edit > "Unlock file…" / "Lock file" stays. (The wording went in with step 1.)

### 5. The sidebar and the Markups list ✓

Matt: the sidebar's tab strip is cramped, and so are dimensions inside the Markups list.

**The sidebar is wider.** Three word tabs (Pages, Bookmarks, Markups) share its width, and
at the default 196 px they get about 60 px each. Keep the words (icon-only tabs were
considered and dropped). Default about 240 px, minimum about 220 px, maximum unchanged at
420 (`SIDEBAR_DEFAULT`, `SIDEBAR_MIN` in `settings.ts`). A remembered width below the new
minimum is pulled up to it. The exact widths are Matt's to adjust by eye.

**Rows are laid out as lines, not left to wrap** (Matt). Today a row's text is one run,
clamped to two lines, so an area's values are cut off mid-number. Each row has designed
lines, each a single line that shortens with an ellipsis:

1. The kind, and for a measurement its value, where the eye lands: "Length 12.40 m",
   "Area 100.00 m²", "Angle 45.0°".
2. What it says or what qualifies it: a text box's or note's words (this line alone may
   run to two lines); for a measurement, "at 1:100", or "Perimeter 40.00 m, at 1:100" for
   an area. Absent when there's nothing to say.
3. Author and date, muted. Kept on every row (Matt).

The on-paper values leave the list: they stay in the status bar when the measurement is
selected and in the row's tooltip. Where: `components/MarkupsList.svelte`,
`markup/listing.ts` (`LIST_TEXT`, which wants a value and a qualifier in place of one
string), `markup/measurements.ts` (`measurementText` already has the parts).

**No delete x on rows.** It's a destructive control beside the one you click to jump to a
markup, appearing on hover, and it takes width from every row. A row does one thing: jump
to the markup and select it. Delete is the Delete key once a row is selected (as now) and
a "Delete" item on the row's right-click menu. Locked rows offer neither.

A panel of its own for Markups stays in the backlog.

Built: 240 px default, 220 minimum. `listing.ts` gives each row a `value`, the second line
(`text`) and a tooltip (`tip`); `LIST_TEXT` returns `{ value, text, tip }`, and
`measurements.ts` has `measurementParts` for it. A measurement with no scale reads its paper
value with "on paper, no scale set" under it; an area that crosses itself says so on the
second line. The value is semibold, beside the kind. Author and date share the third line,
"Matt James · 14:05". The row's right-click menu holds Delete only (its markup is picked
first); a locked row has no menu. `contain-intrinsic-size` is now 58 px (three lines).

### 6. How a measurement's number is written ✓

Found by Matt: on a file at 1:1, a 2.4 mm length read "2 mm" at scale and "2.4 mm" on
paper. Cause: real-world millimetres are always written whole (`formatLength` in
`markup/measure.ts`); the decimals setting only reaches metres. So the dimension on the
sheet, and in the saved file, was wrong for detail work.

Other apps (AutoCAD, Bluebeam, Acrobat; from memory, not checked) all do the same dull
thing: one unit, a fixed number of decimals, chosen by the user. Vellum's trouble comes from
"Auto", which changes unit at a metre. So the two are split cleanly:

- **An explicit unit behaves as everywhere else.** mm, m, or an imperial unit: the decimals
  (or fraction) control does exactly what it says in that unit. "mm" honours decimals:
  2.4 mm at one decimal, 2.40 mm at two. Areas the same (mm² honours decimals).
- **"Auto" means Vellum picks, and has no precision control.** Fixed rule (Matt's): below a
  metre, millimetres to three significant figures (2.40 mm, 24.4 mm, 244 mm, 850 mm); from
  a metre up, metres to two decimals (1.24 m, 12.44 m). Trailing zeros are kept. The unit
  is still decided on the rounded value, so 999.6 mm reads 1.00 m.
- With Auto chosen, the context bar hides the decimals control, and the units dropdown
  shows Auto by a sample pair, "2.40 mm · 12.44 m" (the dropdown rule: the sample shows the
  effect). Its tooltip states the rule.
- **At 1:1, one value.** Real and on-paper are the same length, so the status bar and the
  row's tooltip drop "on paper".
- Imperial Auto is unchanged (feet and inches with fractions).
- **Areas under Auto** follow the same rule (Matt confirmed): below a square
  metre, mm² to three significant figures; from a square metre up, m² to two decimals.
- Existing measurements keep their stored format; under Auto their text changes to the new
  rule the next time they're valued, which is what's wanted.

Considered and dropped: a significant-figures control, Coarse / Normal / Fine levels for
Auto, tying precision to the scale, and a status bar warning when a dimension is more
precise than the drawing supports (it depends on zoom, would fire constantly, and the
on-paper value already lets the reader judge).

Where: `markup/measure.ts` (`formatLength`, `formatArea`, `lengthUnit`), the measuring
kinds' labels, `components/PropertiesStrip.svelte` (`UNIT_OPTS`, `DECIMAL_OPTS`),
`markup/measurements.ts` (the status bar line). Tests: the table above as cases, the
metre boundary, explicit mm with decimals, and one value at 1:1.

Built as written. Also: the saved `/Measure` number format follows the same rule (an explicit
unit's decimals; Auto two decimals in metres and three figures of the typical value in
millimetres), so other apps' readouts agree. Below a millimetre Auto keeps three figures
(0.300 mm); zero reads 0.00 mm. With an explicit mm or m, the units list's sample shows the
current decimals (1240.00 mm). Auto's tooltip reads "Auto: millimetres to three figures below
a metre, metres to two decimals from a metre up". "At 1:1, one value" is exactly a ratio of 1.

### 7. A value that doesn't fit between the points ✓

Matt: when a dimension's number doesn't fit between its points, move it to one side and
extend the dimension line automatically.

- **When:** the value's width, with a little clearance, is more than the room on the
  dimension line between its ends (inside the arrowheads, ticks or bars).
- **What:** the value sits beyond one end, on the line, and the dimension line runs on past
  that end to carry it. This is what already happens when the value is dragged past an end
  (Matt's review, "the line runs on to it"); it now happens without being asked.
- **Which end** (Claude's choice, shown to Matt without objection): beyond the second point clicked, as
  AutoCAD puts it beside the second extension line. The click order then chooses the side.
- **Arrow ends** (Matt confirmed): when the value has moved out because
  there's no room, arrows flip to the outside, pointing in at the points, as CAD draws a
  tight dimension. Bars and ticks stay as they are.
- Only while the value hasn't been moved by hand (`value` unset). A value the user has
  dragged stays where it was put; double-clicking its grip puts it back to automatic.
- Re-decided whenever anything changes the fit: the points, the scale, the units or
  precision, the font or the label size.
- Saved as it is drawn: `/CO` carries the value's place, so other apps show it the same.
- Length only. Polyline length, area and angle have no dimension line between two points.

Where: `markup/kinds/measureLength.ts` (the label's place and the line's extent),
`markup/dimension.ts`. Pure geometry, so tested: fits, just fits, doesn't fit, each
orientation, a hand-moved value left alone. How it looks is Matt's to judge.

Built: the room is the dimension line's length less each end's reach along it (an arrow's
length; a tick's lean, half the tick times sin 45°; a bar none), and the value needs its width
plus 2 pt either side (`valueFits`, `VALUE_CLEAR`). Out of room it sits past the second point
by that end's reach plus 2 pt, above the line as usual, decided at draw time (`autoSlide` in
`lengthValueAt`), so it follows every change by itself and /CO is written from where it's
drawn. Turned-out arrows are drawn as heads with their tips on the points, a plain line
between, and a run past the first point twice a head's length to carry its arrow. Only
measurements made since stage 5 (with an offset) move out: older ones draw as they did.

### 8. The context bar ✓

Four things Matt found (`components/PropertiesStrip.svelte`, `components/WeightControl.svelte`,
`markup/palette.ts`, the bar's label in `App.svelte`).

**The palettes run in the same order, with the same number of swatches.** Line and text
colours and fills were two lists written at different times: different hue order, the
neutral at opposite ends. Every group keeps eight swatches (Matt: an uneven count makes the
stacked bar look silly), and a fill sits under its line colour:

| Slot | Line and text | Fill |
|---|---|---|
| 1 | Red | Pale red |
| 2 | Orange | Pale orange |
| 3 | Yellow | Pale yellow |
| 4 | Green | Pale green |
| 5 | Blue | Pale blue |
| 6 | Magenta | White |
| 7 | Black | None |
| 8 | Custom | Custom |

Pale grey goes (custom covers it) and None moves from first to seventh. Matt to judge None's
place once he sees it; the alternative is None first and every fill one column along. Both
lists live in `markup/palette.ts`. A fill already saved in a colour that's no longer a
preset shows as the custom swatch, as any other colour does.

**The selected swatch's ring has room.** The ring stays outside the swatch as it is (Matt
likes it). It makes a selected swatch 24 px across in a bar laid out for 16, with about a
pixel to spare. Give the bar enough padding that the ring is a few pixels clear of the
bar's edge and of its neighbours in all three layouts (row, stacked, thin column). The
amount is Matt's to judge.

**The weight box is the field.** Today the box is a button showing the weight, and its
pop-out holds a slider and a second, typeable copy of the number. Make the box itself the
field (type a weight, Enter to set, Esc to put it back); clicking or focusing it pops out
the slider alone. The mouse wheel over the box still steps it. One number, in one place.
While in here, look for how a weight could reach a dimension as zero or not a number: one
vanished when its Weight slider was dragged (release build, not reproduced).

**No "tool" in the bar's label.** It reads "Arrow tool" with the tool out, "Arrow" the
moment one is drawn and selected, so the word comes and goes while working with one tool.
The label is the kind's name either way; several selected reads "3 markups".

Built: fills are `FILL_COLOURS` in `markup/palette.ts` (Pale orange is new, [1, 0.9, 0.78]; the
others keep their colours, so saved fills still match). Ring room: the bar's padding is 8 px
top and bottom (was 5), the thin column's 8 px at the sides (was 6), and swatches sit 7 px
apart in every layout (was 5 in a row), so the ring stands 3 to 4 px clear; the stamp dialog's
swatches match. The weight box is now a text field with "pt" inside it; focusing or clicking
it drops the slider out; Enter sets (and leaves the field selected), Esc puts it back and
leaves the field, leaving it (a click elsewhere) also sets what was typed. The label uses the
tool's own name ("Arrow"), which is the kind's name.

The vanishing dimension: no path was found by which the slider, the typed field or the wheel
hands a dimension zero or not a number. The slider's stops are all finite and at least
0.25 pt; typing and the wheel clamp. Two weak spots, both now closed: `clampWeight` passed
NaN straight through `Math.max` (so a markup arriving with no weight, stepped by the wheel,
would get NaN and draw nothing); and a slider drag that ended without its `change` event (the
pop-out closing or the bar redrawing under the drag) left the previewed weight showing, never
set. Not reproduced, so not proven to be the cause. If it happens again, the console's first
error is what's wanted.

## Not doing

- A lock control in the context bar (it isn't Select's option), in the Markups panel, or a
  clickable one on the tab.
- Restyling dialogs and tooltips, and the rest of the backlog.

## How this gets built

(As done: built on the `editing` branch, one commit or two per step, not on `main`, as the
session that started this one asked. `main` still sits at `0.2.0-rc1`.)

- One Opus session, autonomous, on `main` (the editing worktree is level with `main` at
  `09a3cdc` and has the built target directory; work there and fast-forward `main`, or
  work on `main` directly). Step 1's changes are in that worktree's working tree,
  uncommitted: keep them, and adjust if Matt asks.
- Commit per step, split by concern. No push, no tag, no release.
- Tests are the builder's: Vitest against the rule (a locked markup can be picked but not
  changed; the unlock path from a pick and from a drag; marquee and select all still skip
  it), `npm run check`, `cargo test`, a release exe built and seen to open a file.
- Matt checks everything visual himself; no screenshot harnesses.
- The usual constraints: `source ~/.vellum-toolchain/env.sh` before cargo or tauri;
  scripted runs use scratch `WEBVIEW2_USER_DATA_FOLDER` and `VELLUM_DATA_DIR` and
  `--new-instance`; client drawings in `test-files` are read-only; never read or change
  Matt's signature library or settings; UK English; log strings ASCII.
- Update [editing-scope.md](editing-scope.md) ("The edit lock": the file's lock, pages
  later, where it lives and why) and take the item off [backlog.md](backlog.md).
- Hand over: what changed, what's tested and what isn't in plain terms, and what Matt
  should look at.

## Matt's review of the build (17 November)

Changed on `editing` after his first look at the release exe:

- Step 1: kept as built ("Edit file" and the switch).
- Step 2: a selection of only locked markups shows **no context bar** at all (it had a label,
  "Rectangle, in the file: locked"); the padlock says it. Mixed in, the bar is the free ones'.
- Step 3: the open padlock read closed at 12 px. It's now drawn with the body to the left and
  the shackle swung out on its right leg, in the tab, the status bar and the switch. The status
  bar line stays shown only while unlocked.
- Step 5: the sidebar opens at **260 px** (220 minimum). Nothing in the toolbar lines up at a
  fixed place (the page box's width follows the page count), so it's a round number. The value in
  a Markups row is regular weight: the monospaced face ships one weight and the synthesised bold
  was too heavy.
- Step 6: Auto's name in the Units list is just "Auto" (the sample beside it shows the rule);
  imperial Auto likewise, with the sample `8 1/2" · 12' 4 1/2"`.
- Step 7: a dimension's arrowhead grows with its weight above 0.75 pt, keeping its shape (9.6
  times the weight long; unchanged at 0.75). Ticks are the line's weight (were twice it), and
  bars and ticks are one stroked path with the extension lines, so the overlap no longer paints
  twice and reads heavier. A value slid past an end by hand turns the arrows out, as one that
  moved there for want of room does; each end without a run gets one to carry its arrow.
- Step 8: Pale orange went (too like pale yellow) and Pale grey is back at its old colour. The
  fills run **None, White, Pale red, Pale yellow, Pale green, Pale blue, Pale grey**, then
  custom, so they no longer sit under their line colours. The weight box is 60 px (40 compact) so
  "0.75" fits.
- Arrowheads no longer count against the room for the value (it sits above them), so switching
  a dimension to arrows never sends its value outside: it goes out only where it wouldn't fit
  between bars, or is slid out by hand.
- The weight box: a press anywhere in it, the "pt" too, opens the slider.
- Tool order: **Select, Pen, Highlighter**, then **Line, Arrow, Polyline**, then shapes, text,
  measuring and stamps.

## For Matt to check

By eye, in the app (`npm run tauri dev`, or the release exe):

1. **The Edit file switch** (step 1): level with and the same height as the page layout
   buttons; whether "Edit file" earns its width on a narrow window; whether the off state reads.
2. **A locked markup's selection** (step 2): open a file with someone else's annotations, click
   one. Is the padlock (top-right of the dashed box) obvious, or does the markup just look
   stuck? Click it, then try dragging: both should ask, with "This markup came with the file".
3. **The indicators** (step 3): the status bar's "File unlocked" and the tab's padlock, with two
   files open and one unlocked.
4. **The sidebar** (step 5): 260 px wide. Are the tabs comfortable? A width remembered below
   220 opens at 220.
5. **Markups list rows** (step 5): a length, an area, an angle, a text box with long words, a
   note. Line breaks and ellipses; the value's weight; right-click Delete.
6. **Measurement numbers** (step 6): Auto on a small detail at 1:1 (2.40 mm); explicit mm with
   one decimal; the Auto sample pair in the Units list; the decimals control gone under Auto.
7. **A tight dimension** (step 7): a short Length with bars, ticks, then arrows. Where the value
   lands past the second point, the run carrying it, the arrows turned out. Then save and open
   in Acrobat: is the caption where Vellum draws it?
8. **The context bar** (step 8): the fills, None first; the ring's clearance in the row,
   stacked and thin column layouts; the weight field (type, Enter, Esc, wheel, slider); the
   label with a tool out and with one drawn.
9. **This round** (the review above): the open padlock in a tab; a 2 pt Length with arrows,
   ticks and bars beside its extension lines; a value slid past either end with arrows; the
   weight box showing 0.75; the new tool order.
