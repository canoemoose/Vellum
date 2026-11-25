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

## Fixed in this pass

| What | Where | Status |
|---|---|---|
| Print could run before per-page scales were read (To scale) | `PrintDialog.svelte` `scalesToRead`, `PrintDoc.scalePending` | fixed, committed, not tried in the app |
| A page in view waited behind Print's queued title-block reads | `limiter.ts` `promote`, `App.svelte` `detectPageScale` | fixed, committed, not tried in the app |
| Saves not flushed to disk before the rename (PDF, signature and stamp libraries, the pdfium.dll copy) | `src-tauri/src/fsutil.rs` | fixed, committed, not tried in the app |
| Manual layout called `findScale` detached from its renderer | `ManualLayout.svelte` `fileScales` | fixed, committed, not tried in the app |

## Before 0.2.0: can lose work or damage a file

| # | What | Where | Sure? | Fix |
|---|---|---|---|---|
| 1 | Edits made while a save is in progress are marked saved without being written; the recovery record goes too | `App.svelte` `writeSave` (`hideAfterSave`, `markSaved` read the live list after the awaits) | confirmed | Snapshot `markups` before `saveChanges`; mark only that saved |
| 2 | The recovery record is deleted about 1 s after a file opens, while "Restore them?" is still showing (`attach` -> `onChange` -> `scheduleRecovery` -> clean tab -> `recovery_delete`) | `App.svelte` `scheduleRecovery`, `afterOpenMarkups` | confirmed | Only delete records this session wrote; on the inactive-tab bail-out, restore into that tab's marks or keep the record |
| 3 | Typing in a text box while the file's annotations are first being read leaves an undo step without them; undo then save deletes them all | `markupTool.ts` `finishText` (`history.replace(e.before)`), also `gesture.before`, `previewBase` | pattern confirmed, needs the timing | Rebase by id onto the current list, or run `adopt` over the tool's held snapshots |
| 4 | A very large picture crashes the app on signature import: any `image` crate error (its 512 MiB limit included) falls back to WIC, which allows 30000 x 30000 | `signature/import.rs` `load_oriented`, `signature/wic.rs` | confirmed | Fall back to WIC only for unsupported formats; cap WIC at about 100 MP; cap the file size |
| 5 | A signature's picture is reused from the file by hash alone, so a prepared PDF can show another picture where you signed | `annot/image.rs` `image_in_file` | confirmed | Reuse only an `/Image` whose size matches (or re-hash it); or never reuse for signatures |
| 6 | A shared indirect `/Annots` array: a markup added to one page appears on every page that shares it | `annot/writer.rs` `annots_mut` | code confirmed; how common such files are is unknown | Give the page its own copy when another page references the array |

## Worth doing before 0.2.0 if time, else 0.2.1

| # | What | Where | Sure? |
|---|---|---|---|
| 7 | Undoing a saved deletion of a "foreign" annotation (a file attachment, say), then saving, writes a grey dashed square in its place | `kinds/foreign.ts` `spec`, `markupDoc.ts` `changes` | reported, plausible |
| 8 | Restoring a recovery record made before the file's annotations were read, then saving, deletes them | `App.svelte` `afterOpenMarkups` (the `marks.read` branch ignores `rec.saved`) | reported |
| 9 | Editing another app's annotation drops keys nobody touched (`/F` reset to Print, `/OC`, `/Subj`, `/RC` lost): a locked or hidden comment becomes printable and unlocked | `annot/writer.rs` about line 514 | reported |
| 10 | Finding an annotation by `/NM` takes the first match, including hidden ones, pop-ups and replies that the reader skips; position ids (`file-pN-aK`) written as `/NM` can later collide | `annot/writer.rs` `find`, `fileAnnots.ts` `idFor` | plausible |
| 11 | A save whose commit succeeds but whose reopen fails leaves baked signatures as unsaved; the next save draws them twice | `App.svelte` `writeSave` catch | plausible |
| 12 | Text outside WinAnsi (Δ, Ω, ≥, →, ⌀, ✓, CJK) is saved as "?" in the appearance other viewers show; `/Contents` stays right. Known limit (`fonts.ts` says so), but nothing warns the user | `fonts.ts` `toWinAnsi` | confirmed |
| 13 | With To scale, pages with no drawing scale use a percentage whose control is hidden when other pages have a scale | `PrintDialog.svelte` `scaleKnown` | confirmed |

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
