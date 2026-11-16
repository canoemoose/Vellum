# Stamp and signature library dialogs: scope

Status: **in progress on `editing`** (15 to 16 November 2026). Steps 1 to 3b built, nothing
committed yet; next is step 4. App-wide requests Matt raised along the way are in
[backlog.md](backlog.md) (on `main`). Part of Matt's review of the tool
consistency brief ([editing-tool-consistency-brief.md](editing-tool-consistency-brief.md));
follows the stamp grid (the Stamp and Signature buttons open a grid of tiles beside the
toolbar; the context bar only appears once one is placed; "Replace…" swaps a placed one).

## Objective

One place to look after each library, opened from the grid's "Manage stamps…" or "Manage
signatures…" (and, for signatures, "+ New"). It replaces the old drop-down panels (the Stamp
panel, the Signature panel) and `VELLUM_STAMP_POPOUTS=1`.

Option A of the mock-ups: one list, edited in place. Each dialog has two views: the list, and
an editor for adding (and, for image stamps, editing again).

## Decisions (Matt, 15 November)

- **Your own text stamps are a list**, not one remembered wording. "+ Your wording" in the grid
  adds to it (a tile each); the dialog edits a wording or its colour, or deletes it. Fields
  (`{author}`, `{date}`, `{time}`, `{file}`, `{page}`) work in them. The old single wording
  carries over as the first entry.
- **Built-in stamps** (APPROVED, FOR COMMENT, SUPERSEDED) are shown and can't be changed.
- **Image stamps**: add, rename, delete; adding opens an editor: frame (crop, straighten,
  quarter turns: SignatureFrame, as signature import uses), remove the background keeping
  colours (a tolerance slider, live preview), a name.
- **Signatures**: one dialog for managing and for making new: the list (rename, delete, the
  tidy-up for files that can't be read) and the pad (draw, or import with framing). "+ New"
  opens it on the pad; save goes back to the list with the new one armed.
- **Originals are kept** for image stamps, so "Edit" can crop again from the whole picture.

## Steps

1. **Your text stamps as a list.** Settings `stamps.texts: { label, colour }[]` (migrating
   `custom`); the grid shows a tile for each; "+ Your wording" adds one. **Done**
   (`sanitiseOwnTexts`, tests in `markup/fields.test.ts`).
2. **Image stamp rename.** `stamp_rename` in `src-tauri/src/stamps.rs`, `renameStamp` in
   `stamps/api.ts`. **Done**, with a test in `tests/stamps_library.rs`.
3. **The Stamps dialog, list view.** Built in (read only); your text stamps (wording, colour,
   delete, add); image stamps (name, delete, "Add a picture…" for now straight from a file).
   **Built** (`components/signature/StampsDialog.svelte`, from the grid's "Manage stamps…");
   waiting for Matt's check.
3a. **Wording with chips** (asked for mid-way): `FieldInput.svelte`, a one-line box showing
   fields as chips; "{" offers them, "}" or Enter makes the chip, Backspace takes one whole,
   a chip's tooltip says what it will be; plain `{field}` text underneath. Used by the second
   line, adding a text stamp (one shared `OwnTextAdder`, grid and dialog alike) and the
   dialog's wording rows; the field buttons (`FieldChips`) are the app's small buttons.
   **Built**, waiting for Matt's check.
3b. **Each stamp's own second line** (asked for mid-way): every text stamp, built in or your
   own, has its own on/off and wording; empty wording takes the default (`StampPrefs.line`,
   set at the top of Manage stamps). `StampLine`, `lineOf`, `subFor`, `withLine` in
   `markup/stamps.ts`, tests in `markup/fields.test.ts`. The grid's section is "Second line
   for <the armed stamp>"; Manage stamps has a second-line row under each stamp. The bar's
   Second line still switches one placed stamp (and, tool out, that stamp's remembered one).
   **Built**, waiting for Matt's check (with 3a's field menu now opening at the caret).
4. **The Signatures dialog**: the list (from SignatureLibrary) and the pad (SignaturePad,
   SignatureFrame) as the two views of one dialog. Retire SignaturePopover and SignatureDialog.
5. **The image stamp editor**: SignatureFrame for framing; background removal that keeps
   colour (Rust, beside `prepare` in `stamps.rs`); a name. "Add a picture…" opens it.
6. **Keep originals** (`<id>.orig.<ext>` beside each stamp) and "Edit" in the list.
7. **Retire the old panels**: StampPicker, StampPanel, SignaturePopover, `VELLUM_STAMP_POPOUTS`.
8. Tests, the brief's notes, the README's stamp section.

## Files in play

`src/lib/markup/stamps.ts` (prefs), `src/lib/settings.ts`, `src/App.svelte`,
`src/lib/components/signature/` (StampGrid, new StampsDialog and SignaturesDialog, the pad
and frame), `src/lib/stamps/api.ts`, `src-tauri/src/stamps.rs`, `src-tauri/src/lib.rs`.

## Constraints

- A signature's picture or strokes never leave the encrypted library: thumbnails in memory
  only, nothing in settings, logs or the clipboard.
- UK English; ASCII log strings; em-dashes sparingly; filled buttons have a visible border.
- Interactive: each step shown to Matt before the next; nothing committed until he asks.

## Open questions

- Whether the background removal also needs a "pick the background colour" eyedropper, or
  white paper is enough to start.
