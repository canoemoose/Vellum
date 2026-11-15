# Phase 7, remaining markup tools, text markups and the markups list: scope

Status: **scoped 15 November 2026, not started.** Two parts. **7a** is one session in its
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
