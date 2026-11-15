# Phase 5, stamps and signatures: scope

Status: **scoped 15 November 2026, not started.** One session, in its own worktree, branch
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
