# Review before 0.2.0 (25 November 2026)

0.2.0 is the first version that writes to people's files, so the code that can damage a file,
lose markup, leak a signature or strand installed copies ("tier 1") was reviewed before the
release. This is the list of what was found and where each item stands. Update the Status
column as items are fixed; delete the file once everything in "Before 0.2.0" is done and the
rest has moved to [backlog.md](backlog.md).

How it was reviewed: today's changes since rc3 by hand; the save path, recovery, clipboard,
signature storage and the edit lock by hand; the updater, the annotation writer and reader,
signature import and baking, and undo and document state by Opus reviewers. "Confirmed" means
the code path was read again after the reviewer reported it. Tiers 2 to 4 (markup and measuring
models, the viewer engine, components) have not been reviewed.

## Brief: fix the six "Before 0.2.0" items

For one Opus session, working autonomously (Matt's autonomous mode in `~/.claude/CLAUDE.md`:
work through, state assumptions, batch questions at the end, commit when done, split by
concern, never push).

**Objective.** Fix items 1 to 6 in the table "Before 0.2.0" below, each with a test that fails
before the fix and passes after, and nothing else. Items 7 to 13 and "Later" are out of scope
unless a fix for 1 to 6 makes one of them trivial and safe, in which case say so in the
hand-over rather than widening the change quietly.

**Before changing anything.** Each item's "Where" and "Fix" came from reading, mostly by a
reviewer. Read the path yourself first and confirm the bug is as described. If one turns out
not to be a bug, or the suggested fix is wrong, don't force it: write down what you found
against the item and move on.

**Notes per item.**

1. *Edits during a save marked as saved.* The suggested fix is a snapshot of `markups` taken
   where `saveChanges` is computed, passed to `hideAfterSave` and `markSaved`. Check
   `afterBake` and `rereadFileAnnots` against a list that changed during the save. Blocking
   input for the length of a save was considered and set aside (a large file takes seconds);
   say so if the snapshot can't be made right. The logic to test lives in `markupDoc.ts`, which
   has unit tests; `App.svelte` has none, so keep what goes in there thin.
2. *Recovery record deleted after open.* Two parts: only delete a record this session wrote
   (or one the user answered Discard to, or a save made redundant); and after Restore, if the
   tab is no longer active, restore into that tab's marks or keep the record, never drop it
   silently. Recovery writes stay unflushed on purpose (see `fsutil.rs` and the comment in
   `annot/commands.rs`).
3. *Text box typed while annotations are read.* `history.adopt` patches the history's states
   but not the snapshots the tool holds (`editing.before`, `gesture.before`, `previewBase`).
   Prefer rebasing by id onto the current list in `finishText` and the gesture's end over
   adding another place that must remember to adopt. Test at the `markupTool`/`history` level
   with an adopt landing mid-edit, then undo: the file's annotations must still be there.
4. *Huge picture crashes signature import.* Fall back to WIC only when the `image` crate says
   the format is unsupported, never on a limits error; cap what WIC will decode (about 100
   megapixels) and the file size read; the preview path (`preview_bytes`) has the same
   exposure. An oversized picture should come back as the existing "too large" error, in words
   a user can act on. HEIC must still import.
5. *Signature picture reused by hash alone.* Reuse from the file only an object that is an
   `/Image` of the expected width and height; re-hashing the stored pixels is better if it's
   cheap. Reuse within one save (`image_in_update`) is fine as it is.
6. *Shared `/Annots` array.* When the array a page points at is referenced by any other page,
   give this page its own copy before changing it. Build the test PDF in the test (lopdf is
   already a dependency): two pages sharing one indirect, empty `/Annots`; add a markup to page
   1; page 2 must have none, and the file must still open in PDFium. Check deletes and edits
   through the same path, not only adds.

**Constraints.**

- Conventions in the repo's `CLAUDE.md`: UK English, ASCII in log strings, Vitest beside the
  code, the engine free of Svelte. Rust needs `source ~/.vellum-toolchain/env.sh` on this
  machine before any cargo command.
- `npm run check`, `npm test` and `cd src-tauri && cargo test` all pass before each commit.
  `cargo test` takes about two minutes; one suite does a real print to "Microsoft Print to
  PDF".
- A green build is not "tested". Where a fix can be exercised by running the app
  (`npm run tauri dev`), do it; where it needs timing or a special file you can't produce,
  say plainly in the hand-over that it is covered by the test only.
- Don't change the save's outer shape (temp file beside the original, renamed over it) or the
  update path. Don't touch `src-tauri/tauri.conf.json`'s updater settings or public key.
- No version bump, no tag, no push. The release steps are in [release-0.2.0.md](release-0.2.0.md)
  and are Matt's to start.

**Done looks like.** Six commits (or fewer, with reasons, if an item wasn't a bug), each item's
row in the table marked with its status and commit, the release checklist in
[release-0.2.0.md](release-0.2.0.md) ticked for the review items, and a hand-over that says in
plain terms: what changed, what each new test covers, what was only verified by test and not in
the app, any assumption made, and anything found on the way that Matt should know about.

## Fixed in this pass

| What | Where | Status |
|---|---|---|
| Print could run before per-page scales were read (To scale) | `PrintDialog.svelte` `scalesToRead`, `PrintDoc.scalePending` | fixed, committed, not tried in the app |
| A page in view waited behind Print's queued title-block reads | `limiter.ts` `promote`, `App.svelte` `detectPageScale` | fixed, committed, not tried in the app |
| Saves not flushed to disk before the rename (PDF, signature and stamp libraries, the pdfium.dll copy) | `src-tauri/src/fsutil.rs` | fixed, committed, not tried in the app |
| Manual layout called `findScale` detached from its renderer | `ManualLayout.svelte` `fileScales` | fixed, committed, not tried in the app |

## Before 0.2.0: can lose work or damage a file

All six fixed and committed on 25 November 2026, each with a test that fails without the fix.
"Not tried in the app" means covered by the tests only: the timing or file each needs couldn't be
produced by hand here.

| # | What | Where | Sure? | Fix | Status |
|---|---|---|---|---|---|
| 1 | Edits made while a save is in progress are marked saved without being written; the recovery record goes too | `App.svelte` `writeSave` (`hideAfterSave`, `markSaved` read the live list after the awaits) | confirmed | Snapshot `markups` before `saveChanges`; mark only that saved | fixed, `fa9e3f5`: `writeSave` keeps the list the changes were worked out from and passes it to `hideAfterSave` and `markSaved`; still dirty afterwards, it writes a fresh recovery record instead of deleting it. `afterBake` and `rereadFileAnnots` checked: both work from `saved`, which is now the snapshot. Not tried in the app |
| 2 | The recovery record is deleted about 1 s after a file opens, while "Restore them?" is still showing (`attach` -> `onChange` -> `scheduleRecovery` -> clean tab -> `recovery_delete`) | `App.svelte` `scheduleRecovery`, `afterOpenMarkups` | confirmed | Only delete records this session wrote; on the inactive-tab bail-out, restore into that tab's marks or keep the record | fixed, `4b8327f`: `lib/shell/recovery.ts` (`RecoveryRecords`, `restoreTarget`). A clean tab deletes only a record this session wrote; Discard, Don't save, a save and a stale record still delete. A restore whose tab is no longer shown goes into that tab (file read) or leaves the record for the next open. Not tried in the app |
| 3 | Typing in a text box while the file's annotations are first being read leaves an undo step without them; undo then save deletes them all | `markupTool.ts` `finishText` (`history.replace(e.before)`), also `gesture.before`, `previewBase` | pattern confirmed, needs the timing | Rebase by id onto the current list, or run `adopt` over the tool's held snapshots | fixed, `53fb6bd`: `history.ts` `rebase`, used by `finishText`, move and resize drags and the style preview. A text box opened and left untyped while they arrive no longer records a step. Test only (needs the timing) |
| 4 | A very large picture crashes the app on signature import: any `image` crate error (its 512 MiB limit included) falls back to WIC, which allows 30000 x 30000 | `signature/import.rs` `load_oriented`, `signature/wic.rs` | confirmed | Fall back to WIC only for unsupported formats; cap WIC at about 100 MP; cap the file size | fixed, `3be61d0`: 100 MP cap in both decoders (checked from the header, before decoding), WIC never after a limits error, files over 256 MiB refused unread, WIC's buffer allocated fallibly; new message `picture_too_large`. Preview and import both covered. WIC is still tried after a decoding error (not only "unsupported"): with the cap that's safe and keeps odd JPEGs WIC can read. HEIC and JPEG XR tests still pass |
| 5 | A signature's picture is reused from the file by hash alone, so a prepared PDF can show another picture where you signed | `annot/image.rs` `image_in_file` | confirmed | Reuse only an `/Image` whose size matches (or re-hash it); or never reuse for signatures | fixed, `44b84a9`: reused only when the file's object is an `/Image` with the same size, colour space and decoded pixels, nothing that changes how it draws, and the same soft mask (or none). A stamp sent with no picture (one read from this file whose picture couldn't be read back) still reuses the file's `/Image` by hash: nothing was supplied to swap |
| 6 | A shared indirect `/Annots` array: a markup added to one page appears on every page that shares it | `annot/writer.rs` `annots_mut` | code confirmed; how common such files are is unknown | Give the page its own copy when another page references the array | fixed, `57e5921`: the page gets a direct copy of the array before it changes. Adds and deletes tested on a two-page file built in the test, which PDFium still opens; edits change the annotation object itself, so are unaffected |

## Also fixed before 0.2.0 (were "if time, else 0.2.1")

| # | What | Where | Sure? | Status |
|---|---|---|---|---|
| 7 | Undoing a saved deletion of a "foreign" annotation (a file attachment, say), then saving, writes a grey dashed square in its place | `kinds/foreign.ts` `spec`, `markupDoc.ts` `changes` | reported, plausible | fixed, `538aa2c`: confirmed by test. A saved deletion of one Vellum can't redraw now leaves every undo state (as a baked signature does), and `changes` never adds one |
| 8 | Restoring a recovery record made before the file's annotations were read, then saving, deletes them | `App.svelte` `afterOpenMarkups` (the `marks.read` branch ignores `rec.saved`) | reported | fixed, `594be30`: confirmed by reading. `recovery.ts` `restoredMarkups` keeps the file's annotations the record never knew of; ones it lists as saved but not present stay deleted |
| 9 | Editing another app's annotation drops keys nobody touched (`/F` reset to Print, `/OC`, `/Subj`, `/RC` lost): a locked or hidden comment becomes printable and unlocked | `annot/writer.rs` about line 514 | reported | fixed, `83c5d41`: confirmed by test. A redraw keeps the old `/F`, `/OC`, `/Subj` and `/Lang`, and `/RC` while `/Contents` is unchanged (new text drops the stale rich text) |
| 10 | Finding an annotation by `/NM` takes the first match, including hidden ones, pop-ups and replies that the reader skips; position ids (`file-pN-aK`) written as `/NM` can later collide | `annot/writer.rs` `find`, `fileAnnots.ts` `idFor` | plausible | fixed, `7484592`: confirmed by test. `find` by `/NM` now skips what the reader skips (`read.rs` `passed_over`). The collision half turned out to be the same fault: the reader and the writer both take the first match in page order, so once they skip the same entries they agree on which annotation an id means, duplicate `/NM`s included. No change to `idFor` |
| 11 | A save whose commit succeeds but whose reopen fails leaves baked signatures as unsaved; the next save draws them twice | `App.svelte` `writeSave` catch | plausible | fixed, `8f395d0`: confirmed by reading. `Viewer.reopen` throws `ReopenFailed` when the work in between succeeded; `writeSave` then marks the save done (markups saved, signatures baked, recovery record settled) and says the file couldn't be shown again |
| 12 | Text outside WinAnsi (Δ, Ω, ≥, →, ⌀, ✓, CJK) is saved as "?" in the appearance other viewers show; `/Contents` stays right. Known limit (`fonts.ts` says so), but nothing warns the user | `fonts.ts` `toWinAnsi` | confirmed | warned, `a3886d2`: the "Saved" message names the characters other apps will show as "?". The limit itself stays (it needs an embedded font): keep the "Known limits" line in the notes |
| 13 | With To scale, pages with no drawing scale use a percentage whose control is hidden when other pages have a scale | `PrintDialog.svelte` `scaleKnown` | confirmed | fixed, `ca55aab`: a mix shows both controls, the percentage labelled "Unscaled". Not looked at in the app |

## Later

- Recovery: thrown away silently when the file changed since, or when the file's size and date
  couldn't be read; written for the active tab only, a second after a change; two offers on
  one launch may collide in `ask()`.
- Save: a `.vellum-save-*.tmp` file is left beside the drawing after a crash mid-save; Ctrl+S
  twice isn't guarded; after a failed commit some edited annotations are drawn twice until the
  next save; if the reopen also fails, "Save a copy" does nothing; no finiteness checks on
  markup numbers (a NaN would block every save with an obscure error; no source found).
- Writer: PDFDocEncoding strings from other apps decoded as Latin-1; a UTF-8 `/NM` fails the
  save; deleting an annotation leaves its `/IRT` replies; a second pop-up can be written; a
  dimension changed in another app loses its own `/Measure`; annotation positions after a
  rebuilt (repaired) save are assumed to keep their order.
- Signatures and stamps: baking assumes balanced `q`/`Q` in the page's content; the soft mask
  has no `/Interpolate`; a stamp of only `{author}` with no author prints "{AUTHOR}"; toggling
  a stamp's date line re-dates the main line; separator tidy-up eats dashes in file names; a
  turned crop can ask for a 4x buffer; HEIC orientation may be applied twice (check with one
  portrait iPhone photo).
- Updater: the count of other open Vellum windows is taken as zero when it fails; a failed
  install says "Nothing has changed" even if the installer had started; a retry downloads
  again; the unsaved-markups question comes after the download, not before; whether a
  cancelled install can be told from a successful one needs a real machine.
- README: "one check a day" and "sends nothing about you" slightly overstate.
- Print: queued title-block reads aren't cancelled when the dialog closes; reads for files
  closed by manual layout still run and warn; N-up ignores "Never enlarge small pages"
  (older bug); the canvas is drawn twice per resize step.

## Checked and fine

The outer save (temp file beside the original, renamed over it, original untouched on failure,
changed-on-disk detected); coordinates on rotated and offset pages and with `/UserUnit`; the
incremental update (cross-reference type, `/Prev`, `/ID`, encryption); round trip of Vellum's
own markups; unsaved-work prompts on every close path and on "Install and restart"; every
editing command against the edit lock; the clipboard (and signatures never on it); DPAPI use,
signature and recovery storage; baking position and shared resources; stamp fields filled once;
undo across a save; history bounded and sharing images; the 0.1.4 to 0.2.0 update path, version
comparison and release workflow.
