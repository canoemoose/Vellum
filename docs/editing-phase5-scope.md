# Phase 5, stamps and signatures: scope

Status: **built 15 November 2026 and merged into `editing`**, autonomous, on branch `claude/editing-stamps-391fb7`
(the worktree's own name for `editing-stamps`). Progress, the bake spike's result, tests and
what isn't verified are at the end. One session, in its own worktree, branch
`editing-stamps` cut from `editing` after the groundwork
([editing-groundwork-scope.md](editing-groundwork-scope.md)) lands. Parent:
[editing-scope.md](editing-scope.md) ("Stamps and signatures", and "Phases 4, 5 and 7: how
they run"). The capture side is already built: read
[signatures-backend.md](signatures-backend.md), especially "For phase 5 proper".

## Objective

Sign a document and send it back: pick a signature from the library (or make one), put it on
the page, size it, save. Stamp a drawing APPROVED, FOR COMMENT or SUPERSEDED with a name and
date, or with your own image.

## What exists

- Making a signature (drawn, or a photo with the paper knocked out), the framing view, ink
  colours, and the DPAPI-encrypted library: components `SignaturePad.svelte` and
  `SignatureLibrary.svelte`, which take callbacks and need no app state; commands
  `signature_*`. Only reachable from the dev page (`npm run dev:signatures`).
- `getSignature(id)` gives the PNG; `getSignatureStrokes(id)` gives vector strokes for a
  drawn one.
- The kind and tool registries and the "place at a click" gesture, from the groundwork.

## What to build

### The stamp kind

One kind, `stamp`, a box on the page holding one of three things:

| Content | Drawn from | Used for |
|---|---|---|
| Vector strokes | Paths (the signature's own curves) | Drawn signatures: crisp at any zoom |
| Image | A PNG with transparency | Imported signatures, your own image stamps |
| Text stamp | Drawing operations (border, bold text, optional name and date line) | The built-in stamps |

- Place with a click (a sensible default size, centred on the pointer) or drag to size it.
  A preview follows the pointer before the click.
- Move and resize keep the aspect ratio. No rotation in this phase.
- Saved as a Stamp annotation with the print flag, like every markup.

### Images in the drawing pipeline

- A new drawing operation for an image, alongside paths and text (`markup/ops.ts`).
- Overlay: the painter draws it from a decoded bitmap, cached per image.
- Writer: `Appearance` gains images (resource name to PNG bytes) inside the `// Stamps`
  block; the writer decodes the PNG and writes an image XObject with a soft mask for the
  transparency. The same image placed several times in one save is written once.
- The groundwork's private re-edit entry must refer to an image by a hash, never carry the
  bytes a second time.

### Signatures in the app

- A Signature tool in the Stamp group opens a popover: the library (pick one to place),
  "New signature…" (the pad, in a dialog), rename and delete as the library already does.
- The pad's framing view needs room: the dialog is large and resizable.
- Move the `signature_*` error codes into `shell/messages.ts`. The dev page stays for
  working on the pad alone.

### Bake in, or keep movable

Agreed: on the first save after placing a signature, ask whether to bake it into the page
(it can't then be moved or lifted off) or keep it movable. Asked each time.

- **How to bake without rewriting the file:** append to the page's content rather than
  flattening through PDFium (whose flatten takes every annotation on the page, not one).
  The writer wraps the page's existing content in a saved graphics state, adds a new content
  stream that draws the signature, and appends both as an incremental update. The original
  bytes stay untouched, as with every markup save.
- **Prove this first** (step 1): on the heavy drawings and on files with one content stream,
  an array of them, and inherited resources; the result must render identically in PDFium
  apart from the signature, and pass qpdf's check. If it can't be made sound, fall back to
  keeping signatures movable only, and record why; don't reach for a full rewrite here.
- A baked signature is removed from the markups and can't be undone after the save. Undo
  before the save works as normal.
- The first-save warnings for signed, certified and "no changes" files apply as they do
  for markups.

### Text stamps

- Built in: APPROVED, FOR COMMENT, SUPERSEDED. Each takes an optional second line (name and
  date, filled from the author setting and today, editable before placing) and a colour.
- "Custom…": type your own wording, same style.
- Drawn as vectors (rounded border, bold capitals), sized by dragging.

### Your own stamps

- From an image (PNG or JPEG; transparency kept, no knock-out). Kept in a stamps library in
  the app data folder. Not encrypted: a stamp isn't a signature.
- From a PDF page: left out of this phase (see Assumed).

### Keeping signatures private

A signature is the one thing in Vellum that's sensitive, so:

- **Crash recovery** (`annot/commands.rs`, `recovery_write`) writes unsaved markups as
  plain JSON under `%LOCALAPPDATA%\Vellum\recovery\`. A placed signature must not land there
  readable. Protect recovery records with DPAPI (`signature/dpapi.rs`) from now on, and
  read old plain ones once so nothing is lost on upgrade.
- Signature images and strokes never go into settings, logs, or error messages. Log lines
  name a signature by id only.
- Copy and paste of a signature stays inside Vellum's own clipboard handling; nothing is put
  on the system clipboard as an image.

## Assumed (Matt to correct)

1. No rotation for stamps yet. A signature on a slanted line is rare; the framing view
   already levels the signature itself.
2. Default placed size: 50 mm wide for a signature, 60 mm for a text stamp, aspect kept.
3. The bake question offers "Bake in" and "Keep movable", with "Keep movable" as the safer
   default button, since baking can't be undone once saved.
4. Stamps made from a PDF page are left out: an image covers the need, and a PDF stamp
   means embedding another document's page as a form, which is a piece of work on its own.
5. Built-in stamp set is the three named in the parent scope plus Custom.
6. Encrypting every recovery record, not only ones holding a signature: one code path, and
   nothing lost by it.

Added while building (15 November 2026):

7. **A drawn signature is placed as its strokes** (vector paths, crisp at any zoom); an
   imported one as its picture. The ink colour is the one saved with the signature.
8. **The stamp tools open their pickers each time they're chosen** (palette, or S, which
   steps between Stamp and Signature). A panel drops from the top of the drawing area and
   catches clicks until something is picked, so nothing is placed by accident; closing it
   without picking goes back to Select. After placing, the tool stays on and places the same
   thing again (tools stay active, the agreed default).
9. **The properties bar is hidden for the stamp tools and for stamps on their own**: none of
   its controls (colour, weight, pattern) apply. A text stamp's colour is chosen in the
   picker before placing; to change it, place it again.
10. **Text stamps**: Helvetica Bold capitals, a 2.5 pt rounded border, the second line in
    Helvetica (an editable "Name, 15 Nov 2026", on by default), all scaled together with the
    box. Colours: each stamp's own (APPROVED green, FOR COMMENT blue, SUPERSEDED red, your
    own wording red) or one of green, blue, red, black. The picker remembers the second line
    on or off, the colour and your last wording (settings `stamps`), never the name and date
    text itself.
11. **Saved as**: /Subtype /Stamp, /Name /Approved, /ForComment (Acrobat's standard names),
    /Superseded, /Custom, /Signature or /Image, with /Contents "APPROVED" (plus the second
    line), "Signature" or "Image". The print flag as every markup.
12. **The bake question comes after the first-save confirmation** (so its warnings for
    signed and certified files come first), and on "Save a copy" too; Cancel cancels the
    save. It's asked only when the save has signatures placed since the last save.
13. **A baked signature is forgotten by undo** once the save succeeds: it's taken out of
    every undo and redo state, so undo can't bring back a copy as a markup over the baked
    one. Other undo steps still work.
14. **Image stamps keep up to 2000 px a side** (scaled down beyond), stored as PNG whether
    they came in as PNG or JPEG, named after the file. No rename (delete and add again).
15. **`VELLUM_DATA_DIR`** points the signature and stamp libraries at another folder, so
    scripted runs never touch the real library. Unset, nothing changes.

## Known gap this phase doesn't close

Printing and "Save as PDF" from the print dialog read the file from disk, so an unsaved
signature won't print (parent scope, Architecture 4). Sign, save, then print works. Fixing
print composition is separate work.

## Files in play

New: `src/lib/markup/kinds/stamp.ts`, `src/lib/markup/stamps.ts` (text stamp layouts; pure),
`src/lib/components/signature/SignaturePopover.svelte`, a stamp picker, a bake dialog,
`src-tauri/src/annot/image.rs` (PNG to XObject), `src-tauri/src/annot/bake.rs`,
`src-tauri/src/stamps.rs` (the stamps library). Changed, inside the `// Stamps` blocks:
`kinds/index.ts`, `tools.ts`, `markup/ops.ts`, `engine/markupPainter.ts`, `App.svelte`,
`shell/messages.ts`, `shell/save.ts`, `annot/spec.rs`, `annot/writer.rs`,
`annot/commands.rs` (recovery), `lib.rs`.

## Steps

1. Bake spike: append-to-content on the test files, compared and checked. Go or fall back.
   Commit with the result written here.
2. Image operation: ops, painter, writer XObject with soft mask; cargo tests. Commit.
3. Stamp kind with image and vector content; place, move, resize; tests. Commit.
4. Signature popover and pad dialog in the main window; error codes moved. Commit.
5. Recovery records protected with DPAPI, old ones still read. Commit.
6. Bake question and the bake save. Commit.
7. Text stamps, then image stamps and their library. Commit each.
8. Check, tests, release build, run it: make a signature, place it, save both ways, reopen.
   Update this file, merge `editing` in, hand over.

## Testing

- Vitest: the stamp kind (bounds, hit, aspect-locked resize), text stamp layout, the image
  operation's bounds, save wording for the bake question.
- Cargo: a PNG with transparency becomes an XObject with the right soft mask (checked by
  rendering through PDFium and sampling pixels: ink opaque, paper showing the page beneath);
  one image placed three times is written once; a baked page renders the same as before
  except for the signature; baking handles a single content stream, an array, and inherited
  resources; a recovery record on disk contains no readable PNG or stroke data; an old
  plain recovery record still loads.
- Not automatable: placing and sizing by hand, how the popover and stamps look, and the
  signed file in Acrobat, Edge and a phone's PDF viewer. Matt checks those.

## Done when

In the release build: open a document, place a saved signature, save it baked in and save
another copy with it movable, reopen both, and each looks right here and in Acrobat; a text
stamp and an image stamp do the same; no signature data is readable on disk outside the
encrypted library.

## Progress

### Step 1: the bake spike (go)

**Baking works without a rewrite.** `src-tauri/src/annot/bake.rs`, a new save change
`Change::Bake { spec }`: the stamp's appearance is written as a form XObject (the stream an
annotation would carry, images included), the page is copied forward with its /Contents
turned into `[q, ...the existing streams..., Q + draw the form]` and its own copy of its
resources (inherited ones resolved from the page tree, indirect ones copied rather than
changed, the form under a name the page doesn't use). Appended as an incremental update; the
original bytes stay where they were, and the existing streams are referred to, not copied.
An annotation with the same /NM on the page is removed in the same update.

Proved on (`cargo test --test stamps_bake`):

- Fixtures built with lopdf for each layout: one content stream; an array whose first stream
  leaves a `q`, a halving `cm` and a clip in force (without the wrap the stamp would come out
  half size, moved and clipped); /Contents pointing at an array object; resources inherited
  from /Pages whose image is already called `VellumStamp0` (the bake takes `VellumStamp1`);
  a page with no content; two pages sharing one indirect resources dictionary (the other page
  and the shared object are untouched). Each: original bytes kept, reads without repair, no
  annotation left, **not one pixel changed outside the stamp's box** (rendered by PDFium at
  3 px/pt with annotations on before, off after), the stamp drawn at full size where its box
  is. A stamp saved movable then baked draws the same pixels; two bakes on one page both draw.
- The real drawings in `test-files` and the five synthetic files (an ignored test,
  `real_files`, run by hand; nothing from the client files is in the repo): a 150 x 50 pt
  stamp baked onto page 1 of each and the page rendered at about 2000 px on the long side
  before and after. Every file: differences only within the stamp's box (on the /Rotate 90
  drawing, a 50 x 150 box as expected). 0.7 to 16 KB added (the 16 KB is a page whose
  resources were inline in its parent and are now copied onto the page), 1 to 95 ms.
- qpdf (pikepdf 10, in a scratch venv, as phase 0's `verify.py` did): no problems in any
  baked file. The one warning, a duplicated /PageMode in the Xero plan's catalogue, is in
  the original file too.

Fallback not needed.

### Steps 2 to 7

One commit per concern (`git log editing..` on the branch):

2. **Image operation** (5afd442): `ImageOp` in `markup/draw.ts`; the overlay decodes each
   picture once per hash (`engine/stampImages.ts`, at most 24 kept, a faint box until
   decoded); `pdf.ts` writes `cm` and `/Im<hash> Do`, upright on rotated pages; the writer
   (`annot/image.rs`) makes an image XObject with a `/SMask` from the alpha (none when the
   picture is opaque), keeps the hash under `/Vellum_Image`, and finds it again, so one
   picture in one save is written once. Stamp annotations get `/Name`.
3. **The stamp kind** (73cc946): `markup/kinds/stamp.ts` and `markup/stamps.ts` (what a stamp
   holds, text stamp layout, strokes as paths, base64 and hashing). Tools Stamp and Signature
   in the Stamp group, both on S.
4. **Signatures in the main window** (05fe245, 3a4fc5f): `SignaturePopover.svelte` (the
   library, "New signature…"), `SignatureDialog.svelte` (the pad, 920 x 720, resizable by its
   corner), both framed by a shared `StampPanel.svelte` or a modal. The `signature_*`
   messages moved into `shell/messages.ts`; the dev page still works on its own.
5. **Recovery records sealed with DPAPI** (035b4c7): `<key>.vrec`, a magic header and a DPAPI
   blob with its own entropy; a plain `<key>.json` from before is read once and sealed as
   it's read.
6. **The bake question and the bake save** (d87abf6, 05fe245): `shell/save.ts`
   (`bakeQuestion`, `newSignatureIds`, `withBakes`), `History.forget`, and the save path in
   `App.svelte`.
7. **Text stamps and image stamps** (4e4f75e, 05fe245): `StampPicker.svelte`; the image stamp
   library is `src-tauri/src/stamps.rs` (`stamp_list`, `_add`, `_get`, `_delete`).

Then `VELLUM_DATA_DIR` (149ba1d), and a fix found in the release run (27f689a): the picker
took every key, so S couldn't step from Stamp to Signature once it was open.

## Tests (for Matt)

One command each: `npm test`, `cd src-tauri && cargo test` (on this machine
`source ~/.vellum-toolchain/env.sh` first), `npm run check`.

What they cover, in plain terms:

- **Baking** (`src-tauri/tests/stamps_bake.rs`): see step 1. Every content layout named in
  the scope, the original bytes kept, nothing outside the stamp's box changing by a single
  pixel, the stamp at full size even when the old content leaves a scale and a clip behind,
  a name clash in inherited resources, shared resources left alone, baking over an
  annotation, two bakes on one page. `real_files` (ignored) runs the same on a folder of
  real drawings by hand.
- **Images in the file** (`stamps_image.rs`): a synthetic PNG with clear, half-clear and
  opaque parts, drawn by PDFium: the ink opaque over both white paper and a black block, the
  clear parts showing the page beneath, the half-clear part blended; the soft mask is there
  (and absent for an opaque picture); three placements of one picture write one image and
  one mask; a baked picture draws the same pixels as the annotation; a broken PNG or a bad
  hash is `[stamp_image]`.
- **Recovery records** (`stamps_recovery.rs`): a record holding a signature's strokes and
  picture has none of it readable on disk (the PNG's bytes, its base64, the stroke numbers,
  the words "signature" and "strokes", the file's path; UTF-8 or UTF-16), reads back
  exactly and leaves no temporary file; an old plain record loads and is sealed; a tampered
  record, or one with no header, is `[recovery_unreadable]` without its contents in the
  message; delete removes both kinds.
- **Image stamp library** (`stamps_library.rs`): transparency kept as it is (no knock-out),
  JPEG in and PNG out, big pictures scaled to 2000 px, tiny ones and junk refused; add, list
  in order, get, delete (twice is fine); ids that could escape the folder refused; names from
  the file.
- **Stamps in the model** (`src/lib/markup/stamps.test.ts`): text stamp layout (rounded
  border, bold capitals centred, the second line below, sizes with and without it),
  Acrobat's names, cleaning custom wording, the date and the default second line; strokes as
  curves through the midpoints with a dot for a single point, cropped to the ink, read from
  the library's stored form; a PNG's size from its header, hashing, base64 both ways; the
  image operation's bounds and its matrix on an upright and a turned page; placing at the
  default widths centred on the pointer with the content's aspect; fitting a dragged box;
  resizing from a corner with the opposite corner fixed and the aspect kept (never turned
  inside out); corner grips only; picking inside the box; drawing scaled into the box; the
  annotation (Stamp, /Name, no border, print flag, contents, fonts); the picture in the
  appearance once and the private copy holding only its hash. The registry test
  (`kinds.test.ts`) puts a text stamp through every kind's checks.
- **The bake question and the history** (`src/lib/shell/bake.test.ts`): the wording for one
  and several, and for a copy; only signatures placed since the last save count; the chosen
  additions become bakes and nothing else changes; a baked markup is forgotten from the
  present, the past and the future; the picker's remembered settings.
- **Messages**: the existing signature message tests pass against the moved codes.

Not covered by automated tests: the Svelte components (the project has no component test
set-up; their logic is in the tested modules), and anything about how it looks.

## Run in the release build

`npm run tauri build -- --no-bundle`, then `vellum.exe --new-instance --debug` driven over
the DevTools protocol by a throwaway script (not in the repo), on copies of the synthetic
`3-a3-40-pages.pdf`, **against a scratch profile**: `VELLUM_DATA_DIR` (signature and stamp
libraries), `LOCALAPPDATA` (recovery records) and `WEBVIEW2_USER_DATA_FOLDER` (the app's
settings) all pointed at a scratch folder. The scratch folders filled, so the app used
them; Matt's real signature library was never listed or read, and his settings weren't used.

- A synthetic drawn signature was added to the scratch library through `signature_add`.
- **Movable:** the Signature tool (from the collapsed palette's flyout) opened the picker
  showing it; picked; a click on the page placed it as strokes, 50 mm wide. A second later
  the recovery folder held one `.vrec` with none of "strokes", "signature", "stamp",
  "markups" or the ink colour readable. Ctrl+S: the first-save question, Save, then "Bake in
  the signature?" with Keep movable, Bake in, Cancel; Keep movable. The file: a Stamp
  annotation, /Name /Signature, with the re-edit entry; qpdf found no problems; the recovery
  record was gone.
- **Text stamp:** the Stamp tool's picker listed APPROVED, FOR COMMENT and SUPERSEDED with
  "Matt James, 15 Nov 2026" (the account's name: the scratch profile has no author set).
  APPROVED placed with a click and saved with Ctrl+S, no bake question (no new signature).
  The file: a second Stamp, /Name /Approved, /Contents with both lines; qpdf clean.
- **Baked:** on another copy, the signature placed and saved with Bake in. The file: no
  annotation, page 1's content now three streams, `/VellumStamp0` in its resources; qpdf
  clean. The overlay was empty after the save, and undo went back to an empty page, not to
  the signature.
- **Reopened** both files, each in a fresh instance: 40 pages, nothing left in the overlay
  (saved stamps are PDFium's to draw), no console errors or warnings in any run, nothing in
  the app's log.
- Found and fixed: with a picker open, pressing S again didn't step to the other stamp tool
  (27f689a).

**Not run:** "Save a copy" (its file picker is a Windows dialog the script can't drive; it
shares `askBake` and `saveChanges` with Save), "New signature…" and the pad in its dialog,
an image stamp (adding one goes through a Windows file picker too; the library and the image
path through the writer are covered by tests), dragging to size, and moving and resizing a
placed stamp by hand.

## Speed

The painter's operation loop gained one check (`op.t === "image"`), so `npm run bench -- --runs 3`
was run on the five synthetic files (this worktree has no `test-files`) with the `editing`
release exe (the groundwork's, read from its worktree) as "before" and this branch's as
"after". Medians of three, before / after:

| File | Cold start ms | First page ms | Settle fit / 400% / 1600% ms | Peak MB |
|---|---|---|---|---|
| 1-a1-200k-lines | 372 / 648 | 364 / 331 | 167 / 109 / 116 → 164 / 103 / 117 | 349 / 1044 |
| 2-a1-50k-text | 360 / 657 | 331 / 314 | 105 / 101 / 205 → 114 / 90 / 224 | 498 / 1162 |
| 3-a3-40-pages | 345 / 707 | 147 / 115 | 72 / 100 / 85 → 69 / 95 / 78 | 145 / 885 |
| 4-a1-raster | 343 / 661 | 681 / 814 | 155 / 102 / 246 → 152 / 110 / 241 | 1051 / 1441 |
| 5-a4-300-pages | 641 / 627 | 97 / 115 | 50 / 93 / 111 → 54 / 85 / 82 | 796 / 838 |

Pan held 60 fps everywhere in both. The cold start and memory columns looked like a
regression, but the "before" run was the odd one: the groundwork measured the same exe at
about 640 ms and 1050 MB, as this branch measures now. To settle it, both exes were run
again, interleaved (before, after, before, after; two runs each, `3-a3-40-pages`): cold start
628, 612, 820, 621 ms; first page 147, 131, 131, 131 ms; peak 923, 918, 906, 860 MB. No
difference beyond run-to-run noise. Three other sessions were building on this machine at the
same time, which is the likely cause of the spread. Nothing in this work is on the open path.

## Not verified (for Matt)

- **How everything looks and feels**: the two pickers (a panel dropped from the top of the
  drawing area), the text stamp previews in the picker (HTML likenesses, not the real
  drawing), the new icons for Stamp and Signature, the place preview following the pointer,
  the pad's dialog and whether its framing view has the room it needs (920 x 720 to start,
  resizable from the bottom-right corner).
- **Placing and sizing by hand**: click, drag to size, move, resize from the corners.
- **Text stamps' proportions**: 2.5 pt border, 6 pt corners and spacing were set by
  reasoning, never seen.
- **The signed file in Acrobat, Edge and a phone's PDF viewer**, both baked and movable. The
  movable one is a standard Stamp annotation with its own appearance; Acrobat may show its
  stamp icon in the comments list.
- **An imported (photo) signature and an image stamp in the app**: covered by tests through
  the writer and PDFium, never placed in the running app (both need a Windows file picker).
- **"Save a copy"** in the app (same reason).

To try: open a PDF, press S (Stamp) or S twice (Signature), or use the palette. In
Signature, "New signature…" opens the pad; save one and it's ready to place. Click on the
page to place, or drag to size. Ctrl+S asks about baking in. Esc goes back to Select.

## For the merge into `editing`

Edits outside the `// Stamps` blocks, each small and marked with a `// Stamps` comment:

- `markup/draw.ts`: the `Op` union line itself (`| ImageOp`) and one line in `opsBounds`.
- `markup/annotation.ts`: `appearance` gained `images?`; `Change` gained `{ op: "bake" }`.
- `markup/kinds/kinds.test.ts`: a `stamp:` line in `SAMPLES`. Every session that adds a kind
  must add a line there (the type demands one per kind), so expect a trivial conflict.
- `markup/history.ts`: a new `forget(ids)` method.
- `App.svelte`: one line in `setTool`, one in the `strip` derived, and the save path
  (`saveActive`, `writeSave`, `saveCopy`: the bake question and `saveChanges` in place of
  `t.marks.changes()`, `afterBake` after `markSaved()`); `<SignatureDialog>` before
  `{#if choice}`.
- `annot/writer.rs`: `get`, `resolve`, `appearance_stream` made `pub(super)`; the images
  call in `appearance_stream`; the `Change::Bake` arm. `annot/spec.rs`: `Change::Bake`.
  `annot/mod.rs`: two `pub mod` lines. `annot/commands.rs`: the three `recovery_*` command
  bodies now call the sealed versions.
- `lib.rs`: `pub mod stamps;`. `signature/mod.rs`: its library folder from
  `stamps::data_dir`. `signature/api.ts`: its messages now come from `shell/messages.ts`.

A shared piece that might want a different shape later: `DrawContext` (kinds/kind.ts) has
no way to say what a "place" tool places, so the stamp kind keeps what's armed in its own
module (`armStamp`). If another phase needs the same, a field on `DrawContext` would be the
tidier home.
