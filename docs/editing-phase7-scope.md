# Phase 7, remaining markup tools, text markups and the markups list: scope

Status: **7a built 15 November 2026** (branch `claude/editing-tools-c878a5`, not yet merged
into `editing`; progress, tests and what isn't verified are at the end of the 7a part).
**7b not started.** Two parts. **7a** is one session in its
own worktree, branch `editing-tools`, cut from `editing` after the groundwork
([editing-groundwork-scope.md](editing-groundwork-scope.md)) lands, alongside phases 4 and 5.
**7b** runs after 4, 5 and 7a are merged, on `editing`. Parent:
[editing-scope.md](editing-scope.md) ("Markup tools", "Reading", "Existing annotations",
"The edit lock", and "Phases 4, 5 and 7: how they run").

The plain shapes (line, ellipse, polyline, polygon) that the parent scope lists under
phase 7 are built in the groundwork, because measuring needs them.

## 7a: the rest of the tools, text markups, the list

### Objective

Finish the markup set, mark up text as a reader would (highlight, underline, strike
through, notes), and list every markup in a sidebar tab.

### Callout (Text group)

- A text box with a leader: click what it points at, click the elbow or drag straight to
  where the box goes, then type. Saved as FreeText with a callout line (`/CL`) and intent
  `FreeTextCallout`; `AnnotSpec` already has the fields.
- The leader's end takes the arrow end styles. Moving the box keeps the tip where it is;
  the tip and elbow have their own handles.
- **Parked:** callouts lose their leader when edited in Edge (phase 0). The fix needs
  Matt's reference file made in Acrobat. Without it, build to the specification and leave
  the comparison as an open item.

### Highlighter (Pen group)

Freehand, wide and see-through, darkening what's under it rather than covering it: Ink with
the multiply blend mode. `Appearance` gains a blend mode inside the `// Text markups` block;
the overlay uses the canvas's multiply. Default yellow, 12 pt, 40% opacity. Shift draws a
straight stroke.

### Text markups

- With text selected (phase 1's selection, `engine/textTool.ts`): Highlight, Underline and
  Strike through, from a small bar that appears by the selection, the Edit menu and
  shortcuts. Each makes one annotation covering the selected lines, from the selection's
  character boxes (`/QuadPoints`).
- New kind `textmark` with a variant; colour and opacity in the properties bar. Highlight
  uses multiply, as the highlighter does.
- They select, restyle and delete like any markup, but don't move or resize: they belong to
  the text.
- Rotated pages and rotated text: the quads follow the text's own direction. Test at every
  page rotation.

### Notes (Text group)

- A sticky note: click to place an icon, type in a small editor beside it. Saved as a Text
  annotation with its wording in `/Contents`. Double-click to edit; hover shows the text.
- The icon is a fixed size on screen at any zoom, as other apps draw it.
- No separate Popup annotation is written; other apps make their own when the note is
  opened.

### Markups list

- A "Markups" tab in the sidebar: this session's markups grouped by page, each with an
  icon for its type, its text (or a measurement's two values, through the function phase 4
  exports), author and date. Click to jump there and select it; Delete removes it. Selecting
  on the canvas highlights the row.
- Rows are keyed by markup id and each row's look is fixed when it's added; no positional
  styling, since rows come and go.
- No statuses, replies or filters (parent scope).
- In 7a the list shows markups made this session. Annotations already in the file join it
  in 7b.

### Assumed (Matt to correct)

1. Callout gesture: tip first, then the box.
2. Highlighter defaults: yellow, 12 pt, 40%.
3. Text markups are made from a bar by the selection plus shortcuts (Ctrl+H is taken by
   nothing today; check before adopting), not by picking a tool first and then dragging
   over text.
4. Notes show their text on hover and edit on double-click.
5. The list sorts by page, then top to bottom on the page.

### Files in play

New: `src/lib/markup/kinds/callout.ts`, `highlighter.ts`, `textmark.ts`, `note.ts`,
`src/lib/components/MarkupsList.svelte`, a selection bar, a note editor. Changed, inside the
`// Text markups` blocks: `kinds/index.ts`, `tools.ts`, `engine/textTool.ts`, `App.svelte`,
`Sidebar.svelte`, settings (`SidebarTab`), `annot/spec.rs`, `annot/writer.rs`.

### Steps

1. Highlighter and the blend mode through ops, painter and writer. Commit.
2. Callout. Commit.
3. Text markups from a selection. Commit.
4. Notes. Commit.
5. Markups list. Commit.
6. Check, tests, release build, run it on a text-heavy PDF and a drawing. Update this file,
   merge `editing` in, hand over.

### Testing

- Vitest: each kind's operations, spec, hit test and handles; quads from character boxes
  on plain, multi-line and rotated text; a callout's tip staying put when the box moves;
  the list's grouping and order.
- Cargo: blend mode, quad points, callout line and note icon written correctly; PDFium
  draws each.
- Not automatable: how highlights look over text and over drawings, the selection bar's
  placement, and each type in Acrobat and Edge. Matt checks those.

### Progress (7a)

Built 15 November 2026, autonomous, one session, on branch `claude/editing-tools-c878a5`
(the worktree's name for `editing-tools`). One commit per step:

1. adb364d: the highlighter, and the multiply blend mode through the drawing ops, the
   painter, the appearance and the writer. Also `/QuadPoints` and a note's `/Name` in the
   spec, used by later steps.
2. e48ea13: the callout.
3. 4cfe921: text markups from a selection, the selection bar, the Edit menu items and
   shortcuts.
4. 86dfb77: notes.
5. fcc5979: the Markups tab.
6. This file, the run, and a Rust test that PDFium draws a note's and a callout's own
   appearance.

`editing` had not moved since this branch was cut (f3eda5f), so `git merge editing` was a
no-op ("Already up to date"); the checks below ran on this branch as it is.

### How it's built (7a)

- **Highlighter** (`kinds/highlighter.ts`): an Ink kind of its own, freehand, whose path
  carries `blend: "multiply"` (`PathOp`, in `draw.ts`'s block). The overlay paints it with the
  canvas's `multiply`; `pdf.ts` names `/GS0` for a blended path even when it's opaque; the spec's
  `blend` ("Multiply") makes the writer add `/BM` to the appearance's `/GS0`
  (`Writer::set_blend`, making `/GS0` if there was none). Shift draws a straight stroke: a
  change to the shared freehand gesture, so the pen has it too.
- **Callout** (`kinds/callout.ts`): tip, optional elbow, box, text. Drawn as the leader
  (`endedLine`, head at the tip) under a text box drawn exactly as `kinds/text.ts` draws one
  (`textOps`, now exported); its spec is the text box's (`text.spec`) plus `/IT
  /FreeTextCallout`, `/CL`, one `/LE` and `/RD`. The leader meets the middle of the box's side
  facing the elbow (or the tip). Clicked out with the points gesture (`min: 2, max: 3`, drag
  makes a line), which now passes the draw context (the bar's text style) and starts typing
  for a typed kind.
- **Text markups** (`kinds/textmark.ts`, `text/quads.ts`): one kind with a variant
  (highlight, underline, strike) and one quad per selected line, made by
  `selectionLines()` in `engine/textTool.ts`'s block from the selection's character boxes.
  A quad is the extent of its line's boxes along and across the reading direction (from the
  first and last character's centres, snapped to the page's axes within 3 degrees), corners
  in `/QuadPoints` order (top left, top right, bottom left, bottom right as the text reads).
  The kind is flagged `ofText` (`kind.ts`): no tool, never moved or resized, and a press on
  one selects it and goes on to text selection. `lineless` drops weight and pattern from the
  properties bar. The selection bar is `components/SelectionBar.svelte`, placed in
  `App.svelte`'s block from `selectionEnd()`.
- **Notes** (`kinds/note.ts`, `components/NoteLayer.svelte`, `markup/pin.ts`): the icon's
  paths are pinned (`PathOp.pin`); the painter scales them about the pin to one point per CSS
  pixel and records that scale (`pinView`), which the note's box, picking and selection box
  use. `NoteLayer` holds the editor and the hover text and listens on the stage itself.
- **Markups tab** (`components/MarkupsList.svelte`, `markup/listing.ts`): rows keyed by
  markup id, no positional styling, `content-visibility: auto` per row. Wired through
  `Sidebar.svelte` (`markups`, `onPickMarkup`, `onDeleteMarkup` props) from `App.svelte`.
- **The seam for measurements**: `LIST_TEXT` in `markup/listing.ts`, a map from kind to a
  function giving the list's text. Phase 4 registers its exported function there, one line
  per measuring kind, inside the `// Measuring` comment. (A kind definition carrying its own
  `listText` is also honoured, untyped.)

### Changes outside the `// Text markups` blocks (for the merge)

Each is small and marked with a `Text markups` comment where it isn't self-explanatory.

1. `markup/kinds/kind.ts`: the points gesture's `make(pts, ctx)` gained the draw context as a
   second argument (existing kinds ignore it; a measuring kind that declares `make(pts)`
   still type-checks). New optional flags `ofText` and `lineless` in a new `// Text markups`
   block in `KindDef`.
2. `engine/markupTool.ts` (it has no block): Shift in the freehand gesture; the points
   gesture passing the draw context; `finishPoints` starting typing for a typed kind; in
   `down()`, the `ofText` case; in `hover()`, no move cursor over an `ofText` markup; in
   `paint()`, a dashed box for a selected markup with no grips; public `addMarkups`,
   `updateMarkup`, `removeMarkup` after `clearSelection()`. **Most likely to meet phase 4's
   changes**, if it touched the points gesture.
3. `markup/kinds/text.ts`: `textOps` exported; `fitText` fits any markup with `rect`, `text`
   and `textStyle` (it checked for the text kind). The callout imports from `./text`, which
   the groundwork's rule ("never another kind") says not to; the alternative was copying the
   text box's drawing and keys. Moving `textOps`, `fitText` and `holdText` into a toolkit
   (`textbox.ts`) after the merge would restore the rule.
4. `markup/tools.ts`: the callout, note and highlighter lines sit beside their groups, not in
   the block at the end, because `tools.test.ts` checks the list is in group order. Phases 4
   and 5 add groups after Pen, so their block lines are fine where they are.
5. Tests: `kinds.test.ts` gains four samples and two guards in the "every kind" test
   (`ofText` kinds skip moving and grips; a note has no grips); `tools.test.ts`'s "every kind
   has a tool" skips `ofText` kinds. Explained here because the groundwork said a changed test
   is a regression to explain: these kinds don't move (text markups) or resize (notes), by
   design.
6. `components/PropertiesStrip.svelte`: the Weight section is wrapped in
   `{#if !kinds.every((k) => kindOf(k).lineless)}`. Phase 5's stamps may want the same flag.
7. `src-tauri/src/annot/writer.rs`: `set_blend` after `appearance_stream`, and its call
   after the appearance is made in `build()` (marked). `appearance_stream` itself is
   unchanged, for phase 5.
8. `engine/markupPainter.ts`: one import line.
9. `App.svelte`: three Edit menu items (Highlight, Underline, Strike through text) and three
   props on `<Sidebar>`. Everything else is in its blocks.
10. `components/Sidebar.svelte`: the Markups content branch before `{:else}`.
11. `shell/shortcuts.ts`: one line in "Text and links".
12. `settings.ts`: `SidebarTab` and its check (as the comment there invited) and an import.

### Assumed (7a, Matt to correct)

1. **Callout** (as scoped, tip first): the box is 120 pt wide, beside the last point on the
   side away from the point before it, centred on it vertically. The leader meets the middle
   of the box's side facing it. A drag or a double-click makes no elbow. Moving the callout
   moves its box and elbow; the tip stays. Default ends: an open arrow at the tip. The tail
   end setting is drawn at the box end too, but only the head goes into `/LE` (PDF allows one).
2. **Letters**: H for the highlighter. T steps through the Text group: text box, callout
   (T twice), note (T three times). No letter of its own for notes.
3. **Highlighter** as scoped (yellow, 12 pt, 40%); Shift's straight stroke also works for
   the pen, as the gesture is shared.
4. **Text markups have no tool or palette button** (scope assumption 3): the bar by the
   selection (Highlight, Underline, Strike through, and Copy), the Edit menu, and Ctrl+H,
   Ctrl+U, Ctrl+Shift+X. Ctrl+H and Ctrl+U are WebView2 accelerators the shell already blocks,
   so nothing else had them; Ctrl+Shift+X follows Pages and Notes on the Mac. The registry's
   rule that every kind has a tool now exempts these (above).
5. Text markup defaults: highlight the palette's yellow at 60%, multiplied; underline blue
   and strike through red, opaque. Each variant remembers the colour and opacity it was last
   made or restyled with (`settings.textMarks`). The underline sits 88% of the way down the
   line's box and the strike through 58%, each a fourteenth of the line's height thick.
6. Marking clears the text selection and selects the new markups (so the bar restyles them at
   once). A selection over several pages makes one markup per page.
7. A press on a text markup selects it and then selects text as usual, so highlighted text
   can still be copied. Text markups aren't written with `/Contents` (other apps would show the
   marked text as a comment); the marked text is kept in Vellum's own entry for the list.
8. **Notes**: the icon is a yellow sheet with a turned corner and lines of writing, 20 CSS px on
   screen, written 20 pt square with `/Name /Note` and the NoZoom flag (not NoRotate: the
   appearance is already turned for the page's rotation). An empty note stays (as Acrobat
   keeps them). Placing one opens its editor beside it; double-click (in Select) edits;
   Esc, Ctrl+Enter or a click elsewhere finishes; the text shows after the pointer rests on the
   icon for 0.3 s.
9. **The list**: by page, then top to bottom and left to right (as scoped). Dates show the time
   today, else the day and month (and year if not this year). A row's delete button shows on
   hover or when selected. Clicking a row returns to Select.

### Tests (7a, for Matt)

`npm test` (Vitest, which also runs some Rust), `cd src-tauri && cargo test` (on this
machine `source ~/.vellum-toolchain/env.sh` first), `npm run check` (types).

- `src/lib/markup/kinds/textkinds.test.ts`: the highlighter's defaults, its one multiplied
  stroke, its Ink annotation with Multiply and `/GS0` named even when opaque; the callout's
  attach point on each side, its leader with and without an elbow, the head at the tip, its
  FreeText callout keys (`/IT`, `/CL` in user space, one `/LE`, `/RD` placing the box), a
  rotated page, moving keeping the tip, its grips (the middle one making an elbow, box grips
  resizing, the tip grip), picking on box and leader, growing to fit its text; text markups'
  drawing (highlight fills, underline and strike positions and thickness, a line running down
  the page), their annotations and `/QuadPoints` (and on a rotated page), picking, no grips,
  not moving, labels; the note's pinned icon, its Text annotation, picking at the drawn size
  as the zoom changes, the pin scale from the canvas transform, moving.
- `src/lib/text/quads.test.ts`: quads for one line, part of a line, several lines (skipping
  the generated breaks), text running right, down, up and left (every page rotation), a lone
  character, nothing selected, and diagonal text.
- `src/lib/engine/markupTool.textmarks.test.ts`, against the stub viewer: the highlighter
  freehand and straight with Shift; the callout dragged, clicked with an elbow, clicked with
  a double-click, abandoned when nothing is typed, its tip staying when the box is dragged;
  text markups from a two-page selection (one per page, their text, one undo step, where the
  bar goes); a press on a highlight selecting it and leaving the press to text, and it not
  moving or nudging; a note placed centred, its text as one undo step, dragged.
- `src/lib/markup/listing.test.ts`: grouping and order, row contents, text cut short and
  quoted, the measurement seam, dates. `src/lib/settings.textmarks.test.ts`: the Markups tab
  remembered, remembered colours checked.
- `src-tauri/tests/annot_text.rs`: multiply darkens (black stays black, white turns yellow)
  where normal covers; the blend joins an existing opacity; `/QuadPoints`, a note's `/Name`
  and flags, a callout's `/CL`, single `/LE` and `/RD` written and read back by PDFium as
  their types; PDFium draws a note's and a callout's own appearance.
- Not covered by automated tests: the Svelte components (selection bar, note layer, markups
  list), the shortcuts, and how anything looks.

### Run in the release build (7a)

`npm run tauri build -- --no-bundle`, then the exe (`--new-instance --debug`) driven over the
DevTools protocol with real mouse and key events by a throwaway script (not in the repo), on
scratch copies of the synthetic `3-a3-40-pages.pdf` (a drawing) and `5-a4-300-pages.pdf`
(300 pages of body text). Matt's WebView2 local storage (the settings) was copied before and
put back after, and the recovery folder was checked unchanged, so his settings are as they were.

- Drawing: H, a freehand highlighter stroke and a straight one with Shift (two points); T, T
  for the callout, clicked tip, elbow and box, typed, Esc; a second callout dragged from its
  tip, typed; T again for a note, clicked, its editor opened with the focus, typed, Esc; Esc
  back to Select. Five markups with their text.
- Text: a drag over the first line then Ctrl+H (highlighted, selection cleared); a drag over
  three lines then the selection bar's Underline (three quads); a drag then Ctrl+Shift+X; a
  click on the highlight selected it.
- Both: the Markups tab listed every markup (five, three), in page order with type, text,
  time and author; clicking the first row selected its markup and highlighted the row.
- Ctrl+S, the first-save question, Save. The update holds 2 Ink (with `/BM /Multiply`),
  2 FreeText (`/IT /FreeTextCallout`, `/CL`), 1 Text (`/Name /Note`) in the drawing; one
  Highlight (with `/BM /Multiply`), Underline and StrikeOut, each with `/QuadPoints`, in the
  text file; every one with its `/Vellum_Markup` entry.
- Reopened each in a fresh instance: opened, nothing left in the overlay (PDFium draws the
  saved markups until 7b), no console errors or warnings in any run.
- Not done: test-files (client drawings) were not used; rotated pages were not run in the
  app (the quads at every rotation are covered in Vitest, and the page-to-user mapping is
  the one every other kind uses).

### Speed (7a)

The painter's operation loop gained two checks (blend, pin), so `npm run bench -- --runs 3`
was run on the five synthetic files, before (the `editing` worktree's release exe, built
from the groundwork with the same painter as f3eda5f) and after (this branch), back to back
on an otherwise idle machine. Medians of three, before / after:

| File | First page ms | Settle fit / 400% / 1600% ms | Pan fps |
|---|---|---|---|
| 1-a1-200k-lines | 348 / 315 | 158 / 108 / 116 → 161 / 106 / 138 | 60 everywhere, both |
| 2-a1-50k-text | 314 / 331 | 113 / 94 / 201 → 111 / 94 / 282 | |
| 3-a3-40-pages | 114 / 197 | 78 / 99 / 85 → 71 / 110 / 89 | |
| 4-a1-raster | 664 / 714 | 155 / 105 / 247 → 149 / 116 / 283 | |
| 5-a4-300-pages | 148 / 113 | 50 / 94 / 81 → 52 / 113 / 109 | |

Within the spread seen before (the groundwork's own runs moved 1600% settles by 100 ms);
nothing here draws a markup, so the painter's extra checks never run in the bench. Two
oddities, neither attributable to this work: the after run's peak memory fell from about
800 to 1,170 MB to 100 to 900 MB on four files, and its cold starts from about 640 to
about 400 ms. Worth a look by whoever next touches the bench's memory sampling.

### Not verified (7a, for Matt)

- **How everything looks**: the highlighter and text highlights over text and over
  drawings (yellow at 40% and 60%, multiplied), the underline and strike through positions
  and thickness, the note icon (drawn quickly, never seen), the note editor and its hover
  text, the callout's leader and arrow, the selection bar's place beside a selection, and the
  new tool icons (callout, note, highlighter).
- **The sidebar with three tabs** at its default 196 px: "Pages", "Bookmarks", "Markups" may
  be tight.
- **Each type in Acrobat and Edge**: written to the specification, not opened there. The
  callout comparison with Edge stays parked until Matt's Acrobat reference file exists
  (phase 0's finding that Edge drops the leader when it edits a callout).
- **After saving**, notes and text markups are PDFium's to draw: a note then scales with the
  zoom (PDFium ignores NoZoom) until 7b brings it back into the overlay.
- The note icon turns with the view's rotation (R); other apps keep notes upright.
- Quads on diagonal (not square) text are approximate: character boxes are upright, so a
  quad round diagonal text is fatter than the text.

### Known gaps (7a)

1. Copy and paste of a text markup pastes it in the same place (it can't move), on the
   current page: on another page it lands over whatever is there. Probably text markups
   should be left out of paste.
2. Nudging a selected text markup records an undo step that changes nothing you can see.
3. A text markup's colour is remembered per variant from restyling (seen while it's
   selected); undoing a restyle is remembered too.

## 7b: annotations already in the file

Runs once 4, 5 and 7a are merged, so it can bring back every kind.

### Objective

Close known gap 1 from phases 2 and 3: once a file is closed and reopened, its markups are
ordinary annotations drawn by PDFium and can't be edited. After 7b they can, and so can
other apps' annotations, behind the padlock.

### What to build

- **Read:** a backend command returning a page's annotations (type, box, colours, border,
  vertices, line ends, ink, text, author, date, `/NM`, and Vellum's private re-edit entry
  when present), through `FPDFAnnot_Get*`. Read on first view of a page, and for the whole
  document in the background for the list, as search does.
- **Into the model:** an annotation carrying Vellum's own entry, unchanged since Vellum
  wrote it, comes back exactly as drawn. Anything else is mapped from the standard keys as
  far as they go; a type Vellum doesn't understand can be moved or deleted but not restyled.
- **Lifting:** when one is first selected for editing it's hidden in PDFium
  (`doc_hide_annots` exists; extend it to annotations without a Vellum `/NM`, by position on
  the page), its tiles re-rendered, and the overlay draws it from then on. Saving replaces
  the original annotation in place.
- **The padlock** (parent scope, "The edit lock"): per tab, locked on every open. Unlocking
  makes annotations that came with the file selectable; on unlock, say so if the file is
  signed or forbids changes.
- **The list** shows the file's annotations alongside this session's.
- **How close is our redraw?** A lifted cloud or callout made in another app is redrawn by
  Vellum and may shift slightly. Compare on samples from Acrobat and Edge before and after
  lifting; where the difference is visible, keep the other app's appearance until the
  markup is actually changed, not merely selected.

### Assumed (Matt to correct)

1. **Your own Vellum markups need no unlocking,** even from an earlier session: an
   annotation written by Vellum whose author matches yours is free to edit. Everything
   else that came with the file needs the padlock. The parent scope's rule is "changing
   what the file came with needs unlocking"; this narrows it so you aren't unlocking to
   fix yesterday's arrow.
2. A lifted annotation keeps its original look until changed, as above.

### Testing

- Cargo: every kind Vellum writes reads back to the same model (save, read, compare);
  annotations from the phase 0 samples read without loss of position; hiding by position
  works with Popups and nulls in the page's list.
- Vitest: the mapping from standard keys for each type; the lock rules (who may edit what).
- Not automatable: how lifted annotations from other apps look. Matt checks with real
  marked-up files.

### Done when

Reopen a file saved yesterday and move, restyle and delete its markups; unlock a file
marked up in Acrobat and move one of its annotations; save; both apps show the result.
