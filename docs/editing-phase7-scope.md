# Phase 7, remaining markup tools, text markups and the markups list: scope

Status: **7a built 15 November 2026** (branch `claude/editing-tools-c878a5`, merged
into `editing` the same day; progress, tests and what isn't verified are at the end of the 7a part).
**7b built 15 November 2026** on `editing` (progress, assumptions, tests and what isn't
verified are at the end of the 7b part). Two parts. **7a** is one session in its
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
  opened. *(Superseded by [the tool consistency brief](editing-tool-consistency-brief.md), stage 7: a note can be pinned
  open, and every note is written with a Popup, /Open when pinned, never printed.)*

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
  *(The view now rotates with ] and [; the tool consistency brief's stage 10 asks Matt to
  check in the running app that the icon and its pinned box stay upright as viewed.)*
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

### Progress (7b)

Built 15 November 2026, autonomous, one session, directly on `editing`. One commit per step:

1. c42603d: reading a file's annotations (`src-tauri/src/annot/read.rs`, `annot_read`), and the
   writer finding, replacing, deleting and moving an annotation by its position as read;
   `doc_hide_annots` also hides by position; a stamp's picture already in the file is reused.
2. e12d1b9: the 7a tidy-up: the text box's drawing, keys and sizing moved into
   `markup/textbox.ts`, so the callout no longer imports the text box kind.
3. b0661d8: the mapping into the model (`markup/fileAnnots.ts`) and the `foreign` kind.
4. b926343: the tab's model (`engine/markupDoc.ts`): reading in, the lock, lifting, what a save
   writes for them, finding them again after a save; the tool honours the lock; 7a's paste and
   nudge gaps.
5. 48ba349: the app: reading on open, lifting, the save path, the padlock, the list, the bench.
6. bc44e97: ids unique across pages (found reviewing).
7. This file, the runs and the bench.

### How it's built (7b)

- **Read with `lopdf`, not PDFium.** The scope said `FPDFAnnot_Get*`; two things changed that.
  PDFium's annotation API has no getter for /LE, /BS /D, /BE, /IT, /CL, /RD or /DA, which a
  faithful mapping needs; and every PDFium read loads (parses) the page on a render worker,
  which on a heavy drawing costs as much as rendering it, so reading every page for the list
  would load every page. `annot_read` reads the whole file once, straight from disk, on a
  blocking thread off the render workers, dropping stream contents as they load (a filter on
  `lopdf`'s loader), so a big drawing costs little more than its dictionaries. An encrypted file
  is read whole (`lopdf` ignores the filter there). Phase 0 proved positions and page order agree
  with PDFium's; `read.rs` also works out the page frame as PDFium does (CropBox clipped to the
  MediaBox, inherited, /Rotate), checked against PDFium in a test.
- **When:** once, in the background, as soon as a PDF tab opens (`readFileAnnots` in
  `App.svelte`), not per page on first view: one read covers the list too. Nothing waits for it
  except a crash-recovery restore and a save.
- **Into the model** (`fileAnnots.ts`, `fromFile`): an annotation with Vellum's entry whose /M
  still matches, of a kind this Vellum has, whose middle lies inside the annotation's box (a
  page turned since would fail that) comes back as the entry says: every kind, at every page
  rotation (tested). Image stamps get their picture from the file (`annot_stamp_images`, by the
  hash Vellum keeps beside each image), and a save reuses that picture rather than writing it
  again. Anything else is mapped from the standard keys: Square, Circle (inside /RD, the border
  inside the box), Line and PolyLine with their ends, Polygon (a cloud if /BE says so), Ink,
  FreeText (a callout if /IT and /CL say so; text style from /DA and /Q; /C as the background),
  Highlight, Underline, Squiggly (as underline), StrikeOut, Text (a note). Every other type
  becomes a `foreign` markup (`kinds/foreign.ts`): moved or deleted only, never restyled or
  copied, no tool.
- **Ids:** an annotation's /NM when it has one not already used, else `file-p<page>-a<index>`, the
  same every time the file is read (a crash-recovery record refers to them).
- **Who draws what** (`MarkupDoc`): PDFium keeps drawing an annotation from the file, with its
  own appearance, until it changes (`overlayDraws`). As a drag or a slider starts on one
  (`onLift`), or once a restyle, nudge or delete has changed it (`toLift` after every change), it
  is hidden in PDFium (by /NM where its /NM is its id, else by position) and its page's tiles are
  re-rendered (`Viewer.dropPageTiles`); the overlay draws it from then on. Merely selecting one
  changes nothing. Vellum's own notes are lifted as soon as they're read, so a saved note is a
  fixed size on screen again (PDFium ignores NoZoom).
- **Saving:** changes find an annotation by position (`at`) when its /NM isn't its id, so one
  without an /NM is replaced in place and gains one; a `foreign` one is moved by the writer
  (`Change` "move": /Rect and the geometry keys shifted, appearance kept, which follows /Rect).
  The writer keeps a map from current positions to positions as read, so deletes earlier in the
  same save don't throw out later ones. After a save, only what the overlay goes on drawing is
  hidden again in the reopened file (`hideAfterSave`), and the file is read again so each
  annotation's position is current (`reread`: by /NM where it has one, else by order, which a
  save never changes); a save waits for that read.
- **The lock:** per tab, locked on every open (the padlock beside the tools, and Edit > Unlock
  document). Locked, what came with the file can't be picked on the canvas, by the marquee, from
  the list (its row has no delete button) or by double-clicking a note, except your own Vellum
  markups (below). Unlocking asks first, naming why, if the file is certified, signed, or its
  permissions ask for no changes (`unlockWarnings` in `shell/save.ts`); otherwise it just
  unlocks. Locking again drops anything it no longer allows from the selection.
- **The list** shows the file's annotations with the session's: they're markups like any other.
- **Bench:** `runBench` now starts the same `annot_read` straight after the open, alongside the
  first page's render, and records it (`annotRead` in the bench JSON).

### Assumed (7b, Matt to correct)

1. As scoped: your own Vellum markups need no unlocking. "Your own" is: written by Vellum,
   unchanged since (its /M matches its private entry), and its author is your name (the
   settings' author, else the Windows display name), ignoring case. A markup Vellum wrote that
   another app has changed since needs the padlock, as anything else from the file does.
2. As scoped: an annotation from another app keeps its own look until it's changed; merely
   selecting it doesn't redraw it. Once changed it's Vellum's drawing from then on, in the file
   too (with Vellum's private entry), keeping its author.
3. Not read in: Popups (they belong to their parent), Links (navigation), Widgets (form fields,
   phase 6), annotations their own app hid (/F Hidden), and replies (/IRT): none is a markup
   on the page. Deleting an annotation removes its Popup, as before.
4. Another app's stamps (and file attachments, sounds, carets, redactions, 3D, private types)
   are `foreign`: moved or deleted, never redrawn. While one is moved and not yet saved, its
   new place shows as a dashed grey box (the original is hidden); after the save PDFium draws it
   there with its own appearance.
5. Measurements and highlighter strokes from other apps come back as plain lines, polylines,
   polygons and ink: their measuring or blending can't be read from the standard keys.
6. A text highlight from another app with no /CA comes back opaque (as the file draws it),
   though Vellum starts its own at 60%.
7. Reading the whole file once on open, rather than each page on first view (above). It's one
   read, off the render workers, and the bench shows no cost; per page would need either PDFium
   (which loads the page) or a second `lopdf` parse each time.
8. Unlocking says nothing when the file is ordinary. A "No markups to unlock" case isn't
   special-cased: unlocking a file with no annotations simply unlocks.

### Tests (7b, for Matt)

`npm test` (Vitest), `cd src-tauri && cargo test` (on this machine
`source ~/.vellum-toolchain/env.sh` first), `npm run check` (types).

- `src-tauri/tests/annot_read.rs`: every key Vellum writes reads back (non-ASCII text and the
  private entry included); an awkward /Annots (indirect array, a Popup, a null, an inline
  dictionary with no /NM, a hidden one, a reply, a link), with and without object streams,
  reads each markup at the position PDFium gives it; hiding by position with Popups and nulls in
  the list (and by /NM and position together); a delete, then a replace and a move by position
  in one save, each finding the right annotation after the earlier ones moved, the moved line
  drawn by PDFium where it now is; a dense page's annotation found though stream contents are
  dropped; a rotated, cropped page's frame matching PDFium's; a stamp's picture read back from
  the file and reused by hash on replace.
- `src/lib/markup/fileAnnots.test.ts`: every kind Vellum draws (18 samples, stamps of text and
  strokes, an image stamp's picture by hash) comes back exactly as drawn at each of the four
  page rotations; mapped from the standard keys instead once another app changed it, or when the
  page has turned since; each standard type mapped (square, circle, lines and their ends,
  polylines, polygons, clouds, ink, text boxes, callouts, notes, highlight, underline, squiggly,
  strike out), types Vellum doesn't understand (and malformed geometry) as `foreign`; the page's
  rotation and box origin; ids (from /NM, made up, never twice, the same on every read, across
  pages); the lock rule; colours, PDF dates and /DA.
- `src/lib/engine/markupDoc.files.test.ts`, against the stub viewer: reading in without an undo
  step (undo leaves the file's annotations alone); unchanged ones left to PDFium and Vellum's
  notes lifted at once; the lock on clicks, the list's select and delete, unlocking, and
  markups made here staying free after a save; a drag lifting by position and the save replacing
  in place; restyle, nudge and delete lifting; a foreign annotation moved, not restyled or
  copied, saved as a move, and moved again by only the new distance; after a save, what's hidden
  again, waiting for the re-read, and positions found again by /NM and by order; 7a's text
  markups not copied, and nudging one taking no undo step.
- `listing.test.ts`: the file's annotations listed, locked rows marked, a foreign type named.
  `shell/save.test.ts`: the unlock warnings.
- Not covered by automated tests: `App.svelte`'s wiring (reading on open, lifting, the save path,
  the padlock), `EditLock.svelte`, the list's locked rows, and how anything looks. The run
  below covers the wiring.

### Run (7b)

A throwaway driver (not in the repo) launched the exe with `--new-instance --debug`, scratch
folders for `WEBVIEW2_USER_DATA_FOLDER`, `VELLUM_DATA_DIR` and `LOCALAPPDATA` (so the recovery
folder and preview cache were scratch too), and drove it over the DevTools protocol through
`window.__vellum` and the page's own buttons, on scratch copies of the synthetic
`3-a3-40-pages.pdf` and a small file built by hand to stand in for one marked up in another app
(a Square without /NM with a Popup, a null entry, a Line with an /NM and an open arrow, Ink, a
Highlight with a multiply appearance, a FileAttachment, and a FreeText callout, each with its own
appearance, author "Pat Smith"). Markups were added through the tool's `addMarkups` (the
gestures themselves are covered by Vitest), moved with the tool's own pointer handlers and
nudges.

Each scenario ran twice: on a debug build while developing, then on the release build
(`npm run tauri build -- --no-bundle`, after the last code commit), each step in a fresh
instance. The release results:

- **Saved in an earlier session:** one of every kind (rectangle, line, cloud, text box, pen,
  ellipse, polyline, polygon, highlighter, callout, underline, note, the four measurements, a
  text stamp, a strokes signature kept movable) added to page 1 of the drawing and saved
  (first-save question, then the bake question, "Keep movable"). Reopened in a fresh instance:
  all 18 read back as Vellum's own and **identical to what was saved**, field for field; only
  the note was lifted at once. Without unlocking, the rectangle was nudged, the line restyled
  (blue, 3 pt) and the cloud deleted: each was editable, hidden in PDFium as it changed, and
  saved. A third instance read back 17, the three changes as made and still Vellum's own.
- **Marked up in another app:** all six annotations listed (Square without /NM as
  `file-p0-a0`, the Line by its /NM, Ink, Highlight, the FileAttachment as `foreign`, the
  callout), all PDFium's to draw, none editable while locked; a click on the square picked
  nothing. The padlock button unlocked it (no warning: an ordinary file). The square was then
  dragged with the tool's pointer handlers (lifted by position), the attachment nudged, the ink
  deleted, and saved. Reopened in a fresh instance: five annotations, the square now with /NM
  `file-p0-a0` and Vellum's entry, the rest as they were.
- **Read back outside the app** (debug run's file, by a throwaway cargo test, deleted after):
  `lopdf` and PDFium agree on every entry. The square replaced in place at position 0 with its
  Popup still beside it at 1, the null at 2, the line, highlight, the moved attachment (its own
  appearance, /Rect shifted by the nudge) and the callout after them; the page renders.
- No console errors or warnings in any run; `[annot] read` lines only on stderr.
- Not done: test-files (client drawings) weren't used; no real Acrobat or Edge file (none
  here); the gestures were driven through the tool's handlers rather than OS mouse events.

### Speed (7b)

`npm run bench -- --runs 3` on the five synthetic files, the release exe from before 7b (the
merge build, f18e177) against this one, interleaved file by file, alternating which went first,
with scratch data folders; the machine otherwise idle. `runBench` now starts the same
`annot_read` as the app straight after the open, alongside the first page's render. Medians of
three, before → after:

| File | First page ms | Settle fit / 400% / 1600% ms | Pan fps | Peak memory MB | Read (Rust ms / done, ms after open) |
|---|---|---|---|---|---|
| 1-a1-200k-lines | 330 → 314 | 153 / 95 / 120 → 173 / 114 / 126 | 60 everywhere, both | 1071 → 1049 | 0.4 / 253; 0.4 / 38; 0.6 / 34 |
| 2-a1-50k-text | 330 → 281 | 114 / 95 / 189 → 109 / 97 / 198 | | 1191 → 1188 | 0.3 / 44; 0.6 / 31; 0.6 / 32 |
| 3-a3-40-pages | 147 → 147 | 78 / 97 / 85 → 71 / 99 / 81 | | 891 → 916 | 0.4 / 209; 0.4 / 37; 0.9 / 59 |
| 4-a1-raster | 681 → 697 | 152 / 106 / 246 → 156 / 110 / 254 | | 1488 → 1523 | 9.6 / 106; 16.8 / 153; 8.2 / 77 |
| 5-a4-300-pages | 131 → 158 | 46 / 49 / 86 → 52 / 95 / 89 | | 806 → 841 | 3.6 / 228; 1.9 / 43; 2.8 / 60 |

The read itself takes 0.3 to 17 ms (the raster file's image streams are the most to skip) and is
done within 30 to 250 ms of the open. Within the spread seen before (7a's own runs moved
settles by up to 100 ms). File 5's 400% settle looked like a step, so it was run again
(3 + 3, the other way round): 48 → 93 again, but the individual settles are two clusters in
**both** builds (about 40 to 50 ms and 85 to 115 ms; before 5 of 9 low, after 4 of 9), so the
median falls on either side by chance; that settle happens long after the read is done.
Nothing here draws a markup, so the painter's new check never runs in the bench.

### Not verified (7b, for Matt)

- **How lifting looks.** When an annotation from the file is first dragged, PDFium's copy is
  hidden and its page's tiles re-render; until they arrive, the page's preview (which still has
  the annotation) shows under the overlay, so the old copy may show faintly for a moment.
- **How close Vellum's redraw is** to another app's appearance once one is changed: clouds,
  callouts and text boxes particularly (the scope's "how close is our redraw?"). Nothing here has
  real Acrobat or Edge samples; the stand-in file was made by hand. Keeping the other app's
  appearance until the annotation is actually changed is built, so selecting never redraws.
- **The padlock's place and icon** beside the tool palette (it takes a little of the palette's
  room, so the palette may collapse to groups a little sooner), and the dashed box a moved
  `foreign` annotation shows until the save.
- **Real files from Acrobat and Edge**, and a real signed or certified file through the unlock
  warning (covered by unit tests on the wording only).
- **Other apps' notes** stay PDFium's to draw until changed, so they still scale with the zoom;
  picking one uses the fixed on-screen size Vellum's notes have, which matches only at about
  100%.

### Known gaps (7b)

1. A tab's markups from the file are read once on open; if another app changes the file while
   it's open, the save's "changed on disk" question still applies, but the markups shown are as
   first read.