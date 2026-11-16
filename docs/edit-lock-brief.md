# The edit lock, the Markups list and measurement numbers: modification brief

Status: **agreed with Matt on 16 November 2026. Step 1 is built and uncommitted (awaiting
Matt's look); the rest is not built.** Nothing in it is open. For the 0.2.0 markup release, after `0.2.0-rc1`.
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

### 1. The switch: its own block, on the left (built, uncommitted)

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
page layout), `App.svelte`, `components/MarkupsList.svelte`. Type check and Vitest pass.
Matt has not yet said it looks right: level with and the same height as the groups beside
it; whether the label earns its width on a narrow window; whether the off state shows.

### 2. Unlock where you hit it

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

### 3. Indicators, status only

- **Status bar:** an open padlock and "File unlocked" while the active file is unlocked.
- **Tab:** a small open padlock on the tab of any unlocked file, so it shows across several
  open files.
- Both show only while unlocked (locked is the normal state), and neither does anything
  when clicked: the switch is the one place to lock again.

Where: `components/StatusBar.svelte`, the tab strip component, fed from each tab's
`marks.unlocked` in `App.svelte`.

### 4. The menu

Edit > "Unlock file…" / "Lock file" stays.

### 5. The sidebar and the Markups list

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

### 6. How a measurement's number is written

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

### 7. A value that doesn't fit between the points

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

### 8. The context bar

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

## Not doing

- A lock control in the context bar (it isn't Select's option), in the Markups panel, or a
  clickable one on the tab.
- Restyling dialogs and tooltips, and the rest of the backlog.

## How this gets built

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
